"""Verify actual enrolled-device catalog contracts; simulated versions roll back.

No device command, file download, fleet rollout or persistent database mutation.
Execute server-side after publishing the reviewed recovery plan.
"""
import hashlib, importlib.util, json
from pathlib import Path

PLAN='f3c9bccf482f8ff0cdb46ba5d5c01c1c73c15f1ab20fed9636c0d802ab42030d'
DEVICE='23893643-e4c4-4b39-bc30-c9af77721c97'
SCHOOL='14eea188-73b1-40bc-8f8d-15afbea27ffa'

def require(ok,message):
    if not ok:raise RuntimeError(message)

def run():
    root=Path('/root/recovery-staging/app-package-deltas')/PLAN
    plan=json.loads((root/'plan.json').read_text());payload=dict(plan);digest=payload.pop('plan_sha256')
    require(digest==PLAN and hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()==PLAN,'Reviewed plan differs')
    spec=importlib.util.spec_from_file_location('h','/root/primesecure-explore-stage/storage_helpers.py')
    h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
    ready=[r for r in plan['mapping'] if r['status']=='ready']
    unsafe=[r for r in plan['mapping'] if r['status']=='excluded_min_sdk' or r['status'].startswith('quarantined_')]
    state=json.loads(h.psql("select jsonb_build_object('device',(select jsonb_build_object('auth',auth_user_id,'school',school_id,'code',agent_version_code,'status',status) from devices where id='"+DEVICE+"'),'items',(select jsonb_agg(to_jsonb(i)) from hub_items i where id in(select jsonb_array_elements_text("+h.literal(json.dumps([r['id'] for r in ready+unsafe]))+"::jsonb)::uuid)));"))
    require(state['device']['school']==SCHOOL and state['device']['status']=='active' and state['device']['code']>=37,'Pilot identity/status/version changed')
    items={i['id']:i for i in state['items']}
    for row in ready:
        i=items[row['id']]
        require(i['storage_path']==row['new_path'] and i['sha256']==row['sha256'] and i['size']==row['size'],'Catalog replacement differs')
    require(all(not items[r['id']]['published'] for r in unsafe),'Unsafe listing remains published')
    expected={r['id'] for r in ready if items[r['id']]['published']}
    auth=state['device']['auth'];results={}
    for code in [33,34,37]:
        # Closing/rolling back also removes the simulated version and notifications.
        sql="begin; set local lock_timeout='5s'; set local statement_timeout='30s'; update devices set agent_version_code="+str(code)+" where id='"+DEVICE+"'; set local role authenticated; do $claims$ begin perform set_config('request.jwt.claim.sub',"+h.literal(auth)+",true);perform set_config('request.jwt.claims',"+h.literal(json.dumps({'sub':auth,'role':'authenticated'}))+",true);end $claims$; select jsonb_build_object('ids',(select coalesce(jsonb_agg(i->>'id'),'[]') from jsonb_array_elements(v->'items') i where i->>'kind'='app'),'sets',(select count(*) from jsonb_array_elements(v->'items') i where i->>'kind'='app' and i->>'storage_path' like '%.psapk'),'update_required',v->'apk_set_update_required') from (select public.device_hub() v) q; rollback;"
        result=json.loads(h.psql(sql));seen=set(result['ids'])
        require(not seen.intersection(r['id'] for r in unsafe),'Unsafe app leaked into device catalog')
        if code<34:
            require(result['sets']==0 and result['update_required'] is True and not seen.intersection(expected),'Old agent received an APK set')
        else:
            require(expected.issubset(seen) and result['sets']>=len(expected),'Compatible agent did not receive corrected sets')
        results[str(code)]={'corrected_sets_visible':len(seen.intersection(expected)),'all_apk_sets':result['sets'],'update_required':result['update_required']}
    after=json.loads(h.psql("select jsonb_build_object('code',agent_version_code,'status',status) from devices where id='"+DEVICE+"';"))
    require(after['code']>=37 and after['status']=='active','Simulated version was not rolled back')
    print(json.dumps({'reviewed_replacements':len(ready),'unsafe_unpublished':len(unsafe),'version_checks':results,'simulated_versions_rolled_back':True,'persistent_device_changes':False,'app_launches_not_proven':True}))

if __name__=='__main__':run()
