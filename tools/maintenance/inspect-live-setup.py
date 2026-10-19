"""Read school-visible setup counters through the scoped temporary QA login.
No student files, auth tokens or passwords are printed; no writes are made.
"""
import json, subprocess, sys, urllib.request, ssl, certifi
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
qa=json.loads((ROOT/'artifacts/split-upload-session.private.json').read_text())
config=json.loads(subprocess.check_output([sys.executable,str(ROOT/'tools/pc-setup/Read-PublicConfig.py'),str(ROOT/'artifacts/primesecure-0.9.1-34.apk')],text=True))
def request(path,body=None,token=None):
    req=urllib.request.Request(config['url']+path,data=json.dumps(body).encode() if body is not None else None,headers={'apikey':config['anon'],'Authorization':'Bearer '+(token or config['anon']),'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=25,context=ssl.create_default_context(cafile=certifi.where())) as r:return json.load(r)
token=request('/auth/v1/token?grant_type=password',{'email':qa['email'],'password':qa['password']})['access_token']
out={
 'devices':request('/rest/v1/devices?select=id,agent_version_code,model,last_seen_at,sync_revision,sync_applied_revision,status&auth_user_id=not.is.null&status=neq.retired',token=token),
 'setup':request('/rest/v1/device_setup_progress?select=device_id,reported_at,report',token=token),
 'wallpapers':request('/rest/v1/hub_items?kind=eq.wallpaper&published=eq.true&select=id,size,created_at&order=created_at.desc&limit=200',token=token),
 'events':request('/rest/v1/device_events?select=received_at,code,version,details&order=received_at.desc&limit=12',token=token),
}
out['wallpaper_count']=len(out['wallpapers']);out['wallpapers']=out['wallpapers'][:2]
print(json.dumps(out,indent=2))
