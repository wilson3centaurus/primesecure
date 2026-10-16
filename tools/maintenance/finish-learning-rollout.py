"""Run on the PrimeSecure server: verify learning-library flow, publish 0.8.5 paused, clean isolated QA.
No keys or account passwords leave the server. No real device is changed unless --device is supplied.
"""
import argparse, datetime, hashlib, json, pathlib, subprocess, urllib.error, urllib.request, uuid
VERSION_CODE=22
APK_SHA='ff0dcaabe58387b1a2a01dfb8e0ff70a38ba664b5081d70a5f97b923e457fc53'
RELEASE='https://github.com/wilson3centaurus/primesecure/releases/download/v0.8.5/'

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--device',type=uuid.UUID);args=parser.parse_args()
 c=json.loads(subprocess.check_output(['docker','inspect','supabase-kong']))[0]
 env=dict(x.split('=',1) for x in c['Config']['Env'] if '=' in x)
 service=env['SUPABASE_SERVICE_KEY'];ip=next(iter(c['NetworkSettings']['Networks'].values()))['IPAddress'];base='http://'+ip+':8000'
 def request(path,body=None,method=None,token=None,mime='application/json'):
  data=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
  req=urllib.request.Request(base+path,data=data,method=method,headers={'apikey':service,'Authorization':'Bearer '+(token or service),'Content-Type':mime,'Prefer':'return=representation'})
  with urllib.request.urlopen(req,timeout=60) as response:
   raw=response.read()
   return json.loads(raw) if raw and 'application/json' in response.headers.get('Content-Type','') else raw
 def sql(statement):
  r=subprocess.run(['docker','exec','-i','supabase-db','psql','-X','-U','supabase_admin','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,check=True,timeout=60)
  return r.stdout.strip()
 qa_path=pathlib.Path('/root/primesecure-qa-session.json')
 if qa_path.exists():
  qa=json.loads(qa_path.read_text());school=str(uuid.UUID(qa['schoolId']));aid=str(uuid.UUID(qa['adminId']));uid=str(uuid.UUID(qa['deviceUserId']))
  assert json.loads(sql("select to_json(name) from public.schools where id='"+school+"'"))=='PrimeSecure QA temporary','Unexpected QA scope; refusing mutation'
  tokens={who:request('/auth/v1/token?grant_type=password',{'email':qa[who+'Email'],'password':qa['password']})['access_token'] for who in ['admin','device']}
  def rpc(name,body,who='admin'):return request('/rest/v1/rpc/'+name,body,token=tokens[who])
  checks=[]
  try:
   rid=str(uuid.uuid4());payload={'p_request_id':rid,'p_action':'request_resource','p_payload':{'name':'Library rollout QA','resource_type':'Past exam papers','form_level':'Form QA','subject':'Chemistry','reason':'Temporary integration check'}}
   first=rpc('device_offline_action',payload,'device');second=rpc('device_offline_action',payload,'device');assert first==second
   rows=request('/rest/v1/hub_requests?id=eq.'+first['id']+'&select=id,kind,status',token=tokens['admin']);assert len(rows)==1 and rows[0]['kind']=='resource';checks.append('offline request idempotency')
   request('/rest/v1/hub_requests?id=eq.'+first['id'],{'status':'reviewing'},'PATCH',tokens['admin'])
   assert any(r['name']=='Library rollout QA' and r['status']=='reviewing' for r in rpc('device_hub',{},'device')['resource_requests']);checks.append('staff review reaches student catalog')
   for path in [['Form QA','Chemistry','Notes'],['Form QA','Chemistry','Revision']]:rpc('staff_library_folder',{'p_school':school,'p_shared':False,'p_action':'create','p_path':path})
   source=school+'/'+str(uuid.uuid4())+'/qa.txt';dest=school+'/'+str(uuid.uuid4())+'/qa.txt';data=b'PrimeSecure temporary library integration fixture'
   request('/storage/v1/object/primesecure-hub/'+source,data,'POST',tokens['admin'],'text/plain')
   item={'school_id':school,'kind':'resource','title':'Library QA fixture','form_level':'Form QA','subject':'Chemistry','category':'Notes','storage_path':source,'mime_type':'text/plain','size':len(data)}
   original=request('/rest/v1/hub_items',item,token=tokens['admin'])[0]
   request('/storage/v1/object/copy',{'bucketId':'primesecure-hub','sourceKey':source,'destinationKey':dest},token=tokens['admin'])
   item.update(storage_path=dest,category='Revision');copied=request('/rest/v1/hub_items',item,token=tokens['admin'])[0]
   assert request('/storage/v1/object/authenticated/primesecure-hub/'+source,token=tokens['admin'])==data
   assert request('/storage/v1/object/authenticated/primesecure-hub/'+dest,token=tokens['admin'])==data;checks.append('private storage copy preserves original bytes')
   rpc('staff_library_folder',{'p_school':school,'p_shared':False,'p_action':'rename','p_path':['Form QA','Chemistry'],'p_name':'Science'})
   rows=request('/rest/v1/hub_items?school_id=eq.'+school+'&select=id,subject',token=tokens['admin']);assert all(r['subject']=='Science' for r in rows);checks.append('folder rename updates contained files')
   request('/rest/v1/hub_items?id=eq.'+original['id'],{'category':'Revision'},'PATCH',tokens['admin'])
   rpc('staff_library_folder',{'p_school':school,'p_shared':False,'p_action':'delete','p_path':['Form QA','Science','Notes']});checks.append('move then empty-folder deletion')
   print(json.dumps({'live_library_checks':'passed','checks':checks}))
  finally:
   objects=json.loads(sql("select coalesce(json_agg(name),'[]') from storage.objects where bucket_id='primesecure-hub' and name like '"+school+"/%'"))
   if objects:request('/storage/v1/object/primesecure-hub',{'prefixes':objects},'DELETE')
   sql("begin; delete from public.schools where id='"+school+"' and name='PrimeSecure QA temporary'; delete from auth.sessions where user_id in ('"+aid+"','"+uid+"'); commit;")
   for user in [aid,uid]:request('/auth/v1/admin/users/'+user,method='DELETE')
   qa_path.unlink();print('Isolated QA accounts, school and files removed.')
 with urllib.request.urlopen(RELEASE+'primesecure-0.8.5-22.apk',timeout=90) as response:apk=response.read()
 assert hashlib.sha256(apk).hexdigest()==APK_SHA,'APK checksum mismatch'
 path='releases/22-'+APK_SHA[:16]+'.apk'
 existing=request('/rest/v1/agent_releases?version_code=eq.22&select=id,sha256,active,storage_path')
 if existing:
  assert len(existing)==1 and existing[0]['sha256']==APK_SHA and existing[0]['storage_path']==path,'Install code already belongs to another file'
 else:
  try:request('/storage/v1/object/agent/'+path,apk,'POST',mime='application/vnd.android.package-archive')
  except urllib.error.HTTPError as e:
   if e.code not in (400,409):raise
  assert hashlib.sha256(request('/storage/v1/object/agent/'+path)).hexdigest()==APK_SHA
  existing=request('/rest/v1/agent_releases',{'version_code':22,'version_name':'0.8.5','sha256':APK_SHA,'storage_path':path,'active':False,'notes':'Pilot: five-minute failed-update retries, offline learning requests. Same fleet signer; non-test-only. Test before fleet rollout.'})
 assert hashlib.sha256(request('/storage/v1/object/agent/'+path)).hexdigest()==APK_SHA
 print(json.dumps({'published':'0.8.5','code':22,'active':existing[0]['active'],'hosted_hash_verified':True}))
 if args.device:
  did=str(args.device);rows=request('/rest/v1/devices?id=eq.'+did+'&select=id,agent_version_code,status')
  assert len(rows)==1 and rows[0]['status']=='active','Choose an active enrolled pilot'
  if rows[0]['agent_version_code']>=22:print('Pilot already has this install code or a newer one; no pin changed.');return
  admins=request('/rest/v1/profiles?role=eq.super_admin&select=id&limit=1');assert admins
  admin=str(uuid.UUID(admins[0]['id']));release=str(uuid.UUID(existing[0]['id']))
  backup=pathlib.Path('/root/primesecure-backups');backup.mkdir(exist_ok=True)
  (backup/('pilot-safety-before-0.8.5-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')+'.json')).write_text(json.dumps(request('/rest/v1/device_safety_controls?device_id=eq.'+did)))
  sql("begin; select set_config('request.jwt.claim.sub','"+admin+"',true); set local role authenticated; select public.staff_device_safety('"+did+"','install_recovery','"+release+"'); commit;")
  print('0.8.5 selected for the specified pilot only. Keep it online. Automatic updates are held by this selection until resumed.')
if __name__=='__main__':main()
