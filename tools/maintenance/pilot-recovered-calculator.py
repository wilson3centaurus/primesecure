"""One existing test device: verify native .psapk installation without changing listings.

Run server-side with --queue only after the approved catalog batch is published.
The command uses the actual school catalog path, including the native installer's
fresh approval checks. No uninstall, copy, enrollment, fleet command or catalog
update is performed. The default status check is read-only.
"""
import argparse, hashlib, importlib.util, json
from pathlib import Path

PLAN='f3c9bccf482f8ff0cdb46ba5d5c01c1c73c15f1ab20fed9636c0d802ab42030d'
SCHOOL='14eea188-73b1-40bc-8f8d-15afbea27ffa'
DEVICE='23893643-e4c4-4b39-bc30-c9af77721c97'
ITEM='dba67cbf-fb60-43c6-a82e-7d27a0392804'
COMMAND='789cc9b6-4aad-4df7-85e0-a7a50ec17437'
ROOT=Path('/root/recovery-staging/app-package-deltas')/PLAN

def require(ok,message):
    if not ok:raise RuntimeError(message)

def run(mode):
    plan=json.loads((ROOT/'plan.json').read_text())
    payload=dict(plan);expected=payload.pop('plan_sha256')
    require(expected==PLAN and hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()==PLAN,'Plan changed')
    row=next(r for r in plan['mapping'] if r['id']==ITEM and r['status']=='ready')
    require(row['package']=='all.in.one.calculator','Wrong pilot package')
    source=ROOT/(row['sha256']+'.psapk')
    spec=importlib.util.spec_from_file_location('h','/root/primesecure-explore-stage/storage_helpers.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    literal=helper.literal
    state=json.loads(helper.psql("select json_build_object('device',(select json_build_object('school',school_id,'code',agent_version_code,'status',status) from devices where id='"+DEVICE+"'),'command',(select json_build_object('id',id,'device_id',device_id,'type',type,'payload',payload,'status',status,'result',result,'executed_at',executed_at) from commands where id='"+COMMAND+"'),'item',(select json_build_object('path',storage_path,'sha256',sha256,'size',size,'published',published,'kind',kind,'package',package_name) from hub_items where id='"+ITEM+"'));"))
    require(state['device']['school']==SCHOOL and state['device']['code']>=37 and state['device']['status']=='active','Pilot device identity/version/status differs')
    if mode=='status':
        print(json.dumps(state));return
    base,key=helper.gateway();storage=helper.Storage(base,key)
    require(state['item']=={'path':row['new_path'],'sha256':row['sha256'],'size':row['size'],'published':True,'kind':'app','package':row['package']},'Reviewed catalog replacement not published yet')
    require(source.is_file() and not source.is_symlink() and source.stat().st_size==row['size'],'Calculator archive not staged yet')
    require(hashlib.sha256(source.read_bytes()).hexdigest()==row['sha256'],'Staged calculator hash differs')
    require(storage.read_hash('primesecure-hub',row['new_path'])==(row['size'],row['sha256']),'Catalog storage differs')
    request_payload={'bucket':'primesecure-hub','hub_item_id':ITEM,'storage_path':row['new_path'],'package':row['package'],'sha256':row['sha256'],'name':'Calculator complete-package pilot verification'}
    if state['command']:
        require(state['command']['device_id']==DEVICE and state['command']['type']=='install_apk' and state['command']['payload']==request_payload,'Existing command differs')
    else:
        helper.psql("begin; do $pilot$ begin if not exists(select 1 from devices where id='"+DEVICE+"' and school_id='"+SCHOOL+"' and status='active' and agent_version_code>=37) then raise exception 'Pilot no longer eligible';end if;end $pilot$; insert into commands(id,device_id,school_id,type,payload) values('"+COMMAND+"','"+DEVICE+"','"+SCHOOL+"','install_apk',"+literal(json.dumps(request_payload))+"::jsonb);commit;")
    print(json.dumps({'command_id':COMMAND,'device_id':DEVICE,'package':row['package'],'catalog_changed':False,'fleet_rollout':False,'sha256':row['sha256']}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--queue',action='store_true');args=p.parse_args()
    run('queue' if args.queue else 'status')
