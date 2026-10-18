"""Server-side, scoped Explore & grow replacement. Credentials never leave this process.

Old catalog rows and folders are backed up; old objects are retained for recovery.
Only the explicitly selected school's Explore & grow resources are replaced.
"""
import argparse, json, hashlib, uuid, urllib.request, sys, subprocess
from datetime import datetime, timezone
from pathlib import Path
from storage_helpers import SCHOOL, BUCKET, Storage, psql, literal, gateway, require

ROOT = 'Explore & grow'

def current():
    return json.loads(psql("select json_build_object('school',(select name from schools where id="+literal(SCHOOL)+"::uuid),'items',(select coalesce(json_agg(i),'[]') from hub_items i where kind='resource' and school_id="+literal(SCHOOL)+"::uuid and form_level="+literal(ROOT)+"),'folders',(select coalesce(json_agg(f),'[]') from hub_folders f where school_id="+literal(SCHOOL)+"::uuid and path[1]="+literal(ROOT)+"),'bucket',(select json_build_object('private',not public,'limit',file_size_limit) from storage.buckets where id="+literal(BUCKET)+"));"))

def replacement_sql(rows, old_items):
    records=literal(json.dumps(rows));school=literal(SCHOOL);root=literal(ROOT)
    baseline=literal(json.dumps(sorted(old_items,key=lambda r:r['id'])))
    return f"""begin;
select pg_advisory_xact_lock(hashtextextended({school},0));
lock table public.hub_items in share row exclusive mode;
do $guard$ begin
if (select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]'::jsonb) from public.hub_items i where kind='resource' and school_id={school}::uuid and form_level={root}) is distinct from {baseline}::jsonb then
raise exception 'Explore & grow changed after backup; replacement cancelled';end if;
end $guard$;
delete from public.hub_items where kind='resource' and school_id={school}::uuid and form_level={root};
delete from public.hub_folders where school_id={school}::uuid and path[1]={root};
insert into public.hub_folders(school_id,scope,path) values({school}::uuid,{school},array[{root}]);
do $replace$ declare r jsonb; path text[]; n integer; begin
for r in select value from jsonb_array_elements({records}::jsonb) loop
insert into public.hub_items(id,school_id,kind,title,description,form_level,subject,category,storage_path,mime_type,size,sha256,published)
values((r->>'id')::uuid,{school}::uuid,'resource',r->>'title',r->>'description',r->>'form_level',r->>'subject',r->>'category',r->>'storage_path',r->>'mime_type',(r->>'size')::bigint,r->>'sha256',true);
path:=array[r->>'form_level',r->>'subject'];if r->>'category'<>'' then path:=path||array[r->>'category'];end if;
for n in 1..cardinality(path) loop insert into public.hub_folders(school_id,scope,path) values({school}::uuid,{school},path[1:n]) on conflict do nothing;end loop;
end loop;end $replace$;
commit;"""

def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['inspect','sign','serve','publish']);parser.add_argument('--manifest',type=Path)
    args=parser.parse_args();before=current();require(before['school']=='Rusununguko ZIMFEP High School','Wrong school');require(before['bucket']['private'],'Bucket must stay private')
    if args.mode=='inspect':
        storage=json.loads(subprocess.run(['docker','inspect','supabase-storage'],capture_output=True,text=True,check=True).stdout)[0]
        env=dict(value.split('=',1) for value in storage['Config']['Env'] if '=' in value)
        limits={name:value for name,value in env.items() if name in ['FILE_SIZE_LIMIT','UPLOAD_SIGNED_URL_EXPIRATION_TIME']}
        shared=int(psql("select count(*) from public.hub_items i join public.hub_access a on a.item_id=i.id where a.school_id="+literal(SCHOOL)+"::uuid and i.school_id is null and i.kind='resource' and i.form_level="+literal(ROOT)+";"))
        print(json.dumps({'school':before['school'],'old_files':len(before['items']),'old_folders':len(before['folders']),'old_bytes':sum(x['size'] for x in before['items']),'enabled_shared_files_in_root':shared,'bucket':before['bucket'],'storage_limits':limits}));return
    manifest=json.loads(args.manifest.read_text());require(manifest['school']==SCHOOL and manifest['root']==ROOT,'Wrong replacement scope');rows=manifest['files'];require(rows,'Empty replacement rejected')
    for row in rows:
        require(row['form_level']==ROOT and row['storage_path'].startswith(SCHOOL+'/explore/') and '..' not in row['storage_path'],'Invalid resource scope')
        require(0<row['size']<=500000000 and len(row['sha256'])==64,'Invalid resource')
    base,key=gateway();storage=Storage(base,key)
    def sign(row):
        path=row['storage_path']
        request=urllib.request.Request(base+'/storage/v1/object/upload/sign/'+BUCKET+'/'+path,data=b'{}',headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
        with urllib.request.urlopen(request,timeout=30) as response:result=json.load(response)
        return 'https://api.robokorda.duckdns.org/storage/v1'+result['url']
    if args.mode=='serve':
        allowed={r['storage_path']:r for r in rows}
        for line in sys.stdin:
            query=json.loads(line);row=allowed[query['path']]
            existing=storage.read_hash(BUCKET,row['storage_path']) if query.get('check') else None
            require(existing is None or existing==(row['size'],row['sha256']),'Conflicting immutable object')
            print(json.dumps({'exists':existing is not None,'url':None if existing else sign(row)}),flush=True)
        return
    if args.mode=='sign':
        signed=[]
        for path,row in {r['storage_path']:r for r in rows}.items():
            existing=storage.read_hash(BUCKET,path)
            if existing==(row['size'],row['sha256']):continue
            require(existing is None,'Conflicting immutable object')
            signed.append({'path':path,'signed_url':sign(row),'relative':row['relative'],'size':row['size'],'sha256':row['sha256'],'mime_type':row['mime_type']})
        print(json.dumps({'uploads':signed}));return
    for n,row in enumerate({r['storage_path']:r for r in rows}.values()):
        require(storage.read_hash(BUCKET,row['storage_path'])==(row['size'],row['sha256']),'Stored file verification failed: '+row['relative'])
        if (n+1)%100==0:print(json.dumps({'verified_objects':n+1}),flush=True)
    backup_dir=Path('/root/primesecure-backups');backup_dir.mkdir(exist_ok=True,mode=0o700)
    backup=backup_dir/('explore-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
    backup.write_text(json.dumps(before));backup.chmod(0o600)
    sql=replacement_sql(rows,before['items'])
    # Detect edits made while upload/verification was in progress; never silently discard them.
    require(current()['items']==before['items'],'Explore & grow changed during verification; inspect before retrying')
    psql(sql)
    after=current();require(len(after['items'])==len(rows),'Published resource count mismatch')
    expected={r['id']:r['sha256'] for r in rows};require(all(expected.get(r['id'])==r['sha256'] for r in after['items']),'Published hash mismatch')
    report={'status':'published','school':before['school'],'files':len(rows),'folders':len(after['folders']),'bytes':sum(r['size'] for r in rows),'removed_catalog_files':len(before['items']),'backup':str(backup),'old_objects_retained_for_recovery':True}
    (args.manifest.parent/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)

if __name__=='__main__':main()
