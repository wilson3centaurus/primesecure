"""Publish an explicitly reviewed, staged APK repair batch; retain every original object.

The full affected catalog/access/default state is backed up privately on the server.
Only storage metadata on matched apps and visibility of unsafe matched apps changes.
No devices, app defaults, school access or agent rollout settings are modified.
"""
import argparse, hashlib, importlib.util, json, shlex, sys
from datetime import datetime, timezone
from pathlib import Path

SCHOOL='14eea188-73b1-40bc-8f8d-15afbea27ffa'
MIME='application/vnd.primesecure.apk-set+zip'

def require(ok,message):
    if not ok:raise RuntimeError(message)

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()

def publish(plan,approval):
    data=dict(plan);digest=data.pop('plan_sha256',None)
    require(digest==approval and hashlib.sha256(canonical(data)).hexdigest()==digest,'Plan digest changed')
    require(plan['school_id']==SCHOOL and plan['inventory']['school_count']==1,'School scope changed')
    spec=importlib.util.spec_from_file_location('storage','/root/primesecure-explore-stage/storage_helpers.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    literal=helper.literal
    ready=[r for r in plan['mapping'] if r['status']=='ready']
    unsafe=[r for r in plan['mapping'] if r['status']=='excluded_min_sdk' or r['status'].startswith('quarantined_') or r['status']=='invalid']
    require(0<len(ready)<=100 and len(ready)+len(unsafe)<=150,'Unexpected repair count')
    ids=[r['id'] for r in ready+unsafe]
    require(len(set(ids))==len(ids),'Duplicate repair identity')
    id_sql=','.join(literal(str(__import__('uuid').UUID(i)))+'::uuid' for i in ids)
    snapshot_sql=f"""select jsonb_build_object('school_count',(select count(*) from public.schools),
      'school_id',(select id from public.schools order by id limit 1),
      'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.hub_items i where i.id in ({id_sql})),
      'access',(select coalesce(jsonb_agg(to_jsonb(a) order by a.item_id,a.school_id),'[]') from public.hub_access a where a.item_id in ({id_sql})),
      'defaults',(select coalesce(jsonb_agg(to_jsonb(d) order by d.item_id,d.school_id),'[]') from public.hub_app_defaults d where d.item_id in ({id_sql})));"""
    snapshot=json.loads(helper.psql(snapshot_sql));require(snapshot['school_count']==1,'Other schools now exist; stop for review')
    require(snapshot.get('school_id')==SCHOOL,'School identity changed; stop for review')
    expected=json.loads(json.dumps({i['id']:i for i in plan['inventory']['items'] if i['id'] in ids}))
    for item in expected.values():
        for key in ['verified_old_size','verified_old_sha256','object_verification_error']:item.pop(key,None)
    require({i['id']:i for i in snapshot['items']}==expected,'Affected catalog changed after review')
    for name in ['access','defaults']:
        old=[r for r in plan['inventory'][name] if r['item_id'] in ids]
        require(canonical(snapshot[name])==canonical(old),name+' changed after review')
    # SHA-256 the actual private stored bytes immediately before publication.
    base,key=helper.gateway()
    import urllib.request,urllib.parse
    for row in ready:
        require(row['new_path'].startswith(('shared/' if row['scope']=='shared' else SCHOOL+'/')) and '..' not in row['new_path'] and row['new_path'].endswith('.psapk'),'Unsafe staged path')
        request=urllib.request.Request(base+'/storage/v1/object/authenticated/primesecure-hub/'+urllib.parse.quote(row['new_path'],safe='/'),headers={'apikey':key,'Authorization':'Bearer '+key})
        h=hashlib.sha256();size=0
        with urllib.request.urlopen(request,timeout=180) as response:
            for chunk in iter(lambda:response.read(1048576),b''):
                size+=len(chunk);require(size<=500000000,'Oversized staged object');h.update(chunk)
        require(size==row['size'] and h.hexdigest()==row['sha256'],'Staged bytes differ from reviewed plan')
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup=Path('/root/primesecure-backups')/('app-package-recovery-'+stamp)
    backup.mkdir(mode=0o700)
    for name,value in [('before.json',snapshot),('reviewed-plan.json',plan)]:
        file=backup/name;file.write_text(json.dumps(value,indent=2),encoding='utf-8');file.chmod(0o600)
    # Bound waits before taking any lock; these settings expire at commit/rollback.
    sql=['begin;',"set local lock_timeout='5s';","set local statement_timeout='60s';",
         "set local idle_in_transaction_session_timeout='60s';",
         "select pg_advisory_xact_lock(hashtext('primesecure-app-package-recovery'));",
         'lock table public.schools in share mode;',
         f"do $scope$ begin if (select count(*) from public.schools)<>1 or not exists (select 1 from public.schools where id={literal(SCHOOL)}::uuid) then raise exception 'School scope changed; recovery stopped';end if;end $scope$;",
         'lock table public.hub_items,public.hub_access,public.hub_app_defaults in share row exclusive mode;']
    # Compare all old fields once more under locks, not only an ID or title.
    for item in snapshot['items']:
        sql.append(f"do $guard$ begin if (select to_jsonb(i) from public.hub_items i where id={literal(item['id'])}::uuid) is distinct from {literal(json.dumps(item))}::jsonb then raise exception 'Catalog drift; recovery stopped';end if;end $guard$;")
    for name,table in [('access','hub_access'),('defaults','hub_app_defaults')]:
        sql.append(f"do $guard$ begin if (select coalesce(jsonb_agg(to_jsonb(v) order by v.item_id,v.school_id),'[]') from public.{table} v where v.item_id in ({id_sql})) is distinct from {literal(json.dumps(snapshot[name]))}::jsonb then raise exception 'Access/default drift; recovery stopped';end if;end $guard$;")
    for row in ready:
        sql.append(f"update public.hub_items set storage_path={literal(row['new_path'])},mime_type={literal(MIME)},size={int(row['size'])},sha256={literal(row['sha256'])} where id={literal(row['id'])}::uuid;")
    if unsafe:sql.append('update public.hub_items set published=false where id in ('+','.join(literal(r['id'])+'::uuid' for r in unsafe)+');')
    sql.append('commit;')
    helper.psql('\n'.join(sql))
    after=json.loads(helper.psql(snapshot_sql));require(after['access']==snapshot['access'] and after['defaults']==snapshot['defaults'],'Access/default preservation check failed')
    for row in ready:
        item=next(i for i in after['items'] if i['id']==row['id']);before=expected[row['id']]
        require(item['storage_path']==row['new_path'] and item['sha256']==row['sha256'] and item['published']==before['published'] and item['preinstall']==before['preinstall'],'Publication verification failed')
    require(all(not i['published'] for i in after['items'] if i['id'] in {r['id'] for r in unsafe}),'Unsafe app remains published')
    result={'repaired':len(ready),'unsafe_withdrawn':len(unsafe),'backup':str(backup),'defaults_preserved':True,'access_preserved':True,'original_storage_objects_retained':True,'devices_modified':0,'plan_sha256':digest}
    file=backup/'result.json';file.write_text(json.dumps(result,indent=2));file.chmod(0o600)
    print(json.dumps(result),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--server',action='store_true');parser.add_argument('--plan',type=Path);parser.add_argument('--approved-plan-sha256',required=True);args=parser.parse_args()
    if args.server:return publish(json.load(sys.stdin),args.approved_plan_sha256)
    require(args.plan is not None,'Specify the reviewed plan')
    import paramiko
    client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=15,allow_agent=False,look_for_keys=False)
    try:
        command='python3 -B -c '+shlex.quote(Path(__file__).read_text())+' --server --approved-plan-sha256 '+shlex.quote(args.approved_plan_sha256)
        inp,out,err=client.exec_command(command,timeout=1200);inp.write(args.plan.read_text());inp.flush();inp.channel.shutdown_write()
        output=out.read().decode();error=err.read().decode();require(out.channel.recv_exit_status()==0,'Recovery failed: '+error[-1800:]);print(output.strip())
    finally:client.close()
if __name__=='__main__':main()
