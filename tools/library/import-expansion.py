"""Validate and atomically seed a school-private, checksum-reviewed resource batch.

Run on the self-hosted server. Default is read-only; --apply uploads immutable
objects and adds catalog rows. Existing user resources are never overwritten.
"""
import argparse,json,hashlib,uuid,sys,re,subprocess,shutil
from pathlib import Path
from datetime import datetime,timezone
from storage_helpers import SCHOOL,BUCKET,Storage,psql,literal,gateway,require,digest_file

def catalog_sql(records):
    data=literal(json.dumps(records));school=literal(SCHOOL)
    sql="""begin;
select pg_advisory_xact_lock(hashtext('primesecure-reviewed-learning-resource-import'));
lock table public.hub_items in share row exclusive mode;
do $seed$
declare r jsonb; current_bytes bigint; extra_bytes bigint; n integer;
begin
select coalesce(sum(size),0) into current_bytes from public.hub_items i where kind='resource' and published and (school_id=SCHOOL::uuid or (school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=SCHOOL::uuid)));
select coalesce(sum((value->>'size')::bigint),0) into extra_bytes from jsonb_array_elements(RECORDS::jsonb) where not exists(select 1 from public.hub_items i where i.kind='resource' and i.sha256=value->>'sha256' and (i.school_id=SCHOOL::uuid or (i.school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=SCHOOL::uuid))));
if current_bytes+extra_bytes>1000000000 then raise exception 'Library budget exceeded during import';end if;
for r in select value from jsonb_array_elements(RECORDS::jsonb) loop
 if not exists(select 1 from public.hub_items i where kind='resource' and sha256=r->>'sha256' and (school_id=SCHOOL::uuid or (school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id=SCHOOL::uuid)))) then
 insert into public.hub_items(id,school_id,kind,title,description,form_level,subject,category,storage_path,mime_type,size,sha256,source_url,published,preinstall)
 values((r->>'id')::uuid,SCHOOL::uuid,'resource',r->>'title',r->>'description',r->>'form_level',r->>'subject',r->>'category',r->>'storage_path',r->>'mime_type',(r->>'size')::bigint,r->>'sha256',r->>'source_url',true,false);
 end if;
 for n in 1..3 loop
 insert into public.hub_folders(school_id,scope,path) values(SCHOOL::uuid,SCHOOL,(array[r->>'form_level',r->>'subject',r->>'category'])[1:n]) on conflict(scope,path) do nothing;
 end loop;
end loop;
end $seed$;
commit;""".replace('SCHOOL',school).replace('RECORDS',data)
    return sql

def main():
    parser=argparse.ArgumentParser();parser.add_argument('bundle',type=Path);parser.add_argument('--apply',action='store_true');parser.add_argument('--openstax',type=Path)
    args=parser.parse_args();manifest=json.loads((args.bundle/'manifest.json').read_text());require(manifest['school_id']==SCHOOL,'Wrong school')
    rows=manifest['resources']
    for row in rows:
        require(re.fullmatch(r'[a-f0-9]{24}\.(pdf|png)',row['filename']) is not None,'Unsafe bundle filename')
        row['_file']=args.bundle/'files'/row['filename']
    if args.openstax:
        for row in json.loads(args.openstax.read_text()):row['_file']=args.openstax.parent/row['filename'];rows.append(row)
    unique={}
    for row in rows:
        require(re.fullmatch(r'[a-f0-9]{64}',row['sha256']) is not None,'Invalid SHA256')
        require(digest_file(row['_file'])==(row['size'],row['sha256']),'File checksum mismatch')
        require(0<row['size']<90000000,'Invalid file size')
        require(row['source_url'].startswith('https://') and row.get('license') and row.get('attribution'),'Missing provenance')
        require(all(isinstance(row.get(k),str) and row[k].strip() for k in ['title','form_level','subject','category']),'Missing folder metadata')
        require(len(row['title'])<=160 and len(row['description'])<=5000,'Oversized catalog field')
        unique.setdefault(row['sha256'],row)
    rows=list(unique.values())
    existing=json.loads(psql("select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.hub_items i where kind='resource' and (school_id="+literal(SCHOOL)+"::uuid or (school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id="+literal(SCHOOL)+"::uuid)));"))
    hashes={r['sha256'] for r in existing}
    pending=[r for r in rows if r['sha256'] not in hashes]
    baseline=sum(r['size'] for r in existing if r['published'])
    total=baseline+sum(r['size'] for r in pending)
    require(total<=1000000000,'School resource catalog exceeds the user 1GB cap')
    print(json.dumps({'status':'validated','existing':len(existing),'new':len(pending),'total_bytes':total}),flush=True)
    if not args.apply:return
    backup=Path('/root/primesecure-backups');backup.mkdir(exist_ok=True)
    snapshot=json.loads(psql("select jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.hub_items i where kind='resource'),'access',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.hub_access a),'folders',(select coalesce(jsonb_agg(to_jsonb(f)),'[]') from public.hub_folders f));"))
    backup_file=backup/('library-expansion-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json');backup_file.write_text(json.dumps(snapshot));backup_file.chmod(0o600)
    limits=json.loads(psql("select json_build_object('public',public,'limit',file_size_limit) from storage.buckets where id='primesecure-hub';"))
    require(limits['public'] is False,'Expected private bucket')
    if limits['limit']:require(all(r['size']<=limits['limit'] for r in pending),'Existing bucket limit exceeded')
    service=subprocess.run(['docker','inspect','supabase-storage'],capture_output=True,text=True,check=True)
    environment=dict(value.split('=',1) for value in json.loads(service.stdout)[0]['Config']['Env'] if '=' in value)
    global_limit=environment.get('FILE_SIZE_LIMIT','')
    require(global_limit.isdigit() and int(global_limit)>0,'Cannot verify existing storage service file limit')
    require(all(r['size']<=int(global_limit) for r in pending),'Existing global storage file limit exceeded')
    require(shutil.disk_usage('/').free>sum(r['size'] for r in pending)+1000000000,'Insufficient server disk reserve')
    base,key=gateway();storage=Storage(base,key);records=[]
    for n,row in enumerate(pending):
        sha=row['sha256'];extension='.png' if row['mime_type']=='image/png' else '.pdf'
        path=SCHOOL+'/learning/'+sha[:20]+extension
        storage.ensure(BUCKET,path,row['_file'],row['size'],sha,row['mime_type'])
        records.append({k:v for k,v in row.items() if not k.startswith('_') and k!='copyright_excerpt'} | {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'primesecure:school-learning:'+SCHOOL+':'+sha)),'storage_path':path})
        if (n+1)%20==0: print(json.dumps({'verified_uploads':n+1,'of':len(pending)}),flush=True)
    school=literal(SCHOOL)
    psql(catalog_sql(records))
    result=json.loads(psql("select json_build_object('resources',count(*),'bytes',sum(size),'categories',json_object_agg(category,n)) from (select category,count(*) n,sum(size) size from public.hub_items i where kind='resource' and published and (school_id="+school+"::uuid or (school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id="+school+"::uuid))) group by category) q;"))
    # Count separately: the grouped query reports category count in resources.
    result['resources']=int(psql("select count(*) from public.hub_items i where kind='resource' and published and (school_id="+school+"::uuid or (school_id is null and exists(select 1 from public.hub_access a where a.item_id=i.id and a.school_id="+school+"::uuid)));"))
    result.update(status='published',added=len(pending),backup=str(backup_file))
    (args.bundle/'import-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)

if __name__=='__main__':main()
