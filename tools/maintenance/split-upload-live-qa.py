"""Create/clean one ephemeral school-admin login for a bounded uploader browser check.
No existing users are modified. The password is never printed.
"""
import argparse, importlib.util, json, secrets, shlex, uuid
from pathlib import Path
import paramiko

SCHOOL='14eea188-73b1-40bc-8f8d-15afbea27ffa'
LOCAL=Path(__file__).resolve().parents[2]/'artifacts/split-upload-session.private.json'
REMOTE=r'''
import importlib.util,json,sys,urllib.request,urllib.error
spec=importlib.util.spec_from_file_location('h','/root/primesecure-explore-stage/storage_helpers.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
data=json.load(sys.stdin);base,key=h.gateway()
def request(path,body=None,method=None):
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as r:return json.loads(r.read() or b'{}')
if data['mode']=='prepare':
 user=request('/auth/v1/admin/users',{'id':data['userId'],'email':data['email'],'password':data['password'],'email_confirm':True})
 assert user['id']==data['userId']
 h.psql("insert into public.profiles(id,school_id,role,full_name) values("+h.literal(user['id'])+"::uuid,"+h.literal(data['school'])+"::uuid,'school_admin','Split APK upload QA') on conflict(id) do update set school_id=excluded.school_id,role=excluded.role,full_name=excluded.full_name;")
 print(json.dumps({'prepared':True,'userId':user['id']}))
else:
 # Delete only the known UUID identity and verify its special QA name/email.
 user=request('/auth/v1/admin/users/'+data['userId']);assert user['email']==data['email'] and data['email'].startswith('split-upload-qa-')
 profile=json.loads(h.psql('select row_to_json(p) from public.profiles p where id='+h.literal(data['userId'])+'::uuid'));assert profile['full_name']=='Split APK upload QA' and profile['school_id']==data['school']
 # Browser tests use deliberately incomplete APKs: remove only their unreferenced objects.
 import re
 paths=data.get('qaPaths',[]);assert len(paths)<=4
 for path in paths:
  assert re.fullmatch(re.escape(data['school'])+r'/[0-9a-f-]{36}/[A-Za-z0-9._-]+',path)
  assert h.psql('select count(*) from public.hub_items where storage_path='+h.literal(path))=='0'
 if paths:request('/storage/v1/object/primesecure-hub',{'prefixes':paths},'DELETE')
 request('/auth/v1/admin/users/'+data['userId'],method='DELETE');print(json.dumps({'temporary_user_deleted':True}))
'''

def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['prepare','cleanup']);args=p.parse_args()
 if args.mode=='prepare':
  if LOCAL.exists():raise RuntimeError('QA session already exists; cleanup it first')
  uid=str(uuid.uuid4());data={'school':SCHOOL,'userId':uid,'email':'split-upload-qa-'+uid+'@example.invalid','password':secrets.token_urlsafe(32)}
  LOCAL.write_text(json.dumps(data),encoding='utf-8')
 else:data=json.loads(LOCAL.read_text())
 data['mode']=args.mode
 client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
 client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=15,allow_agent=False,look_for_keys=False)
 try:
  inp,out,err=client.exec_command('python3 -B -c '+shlex.quote(REMOTE));inp.write(json.dumps(data));inp.flush();inp.channel.shutdown_write();output=out.read().decode();error=err.read().decode()
  if out.channel.recv_exit_status():raise RuntimeError('Temporary QA account operation failed: '+error[-1200:])
  print(output.strip())
 finally:client.close()
 if args.mode=='cleanup':LOCAL.unlink()
if __name__=='__main__':main()
