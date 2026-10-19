"""Apply a reviewed storage-only token lifetime change; never restart auth or DB.

The signed object URL remains path-scoped and expires after two hours, matching
the documented upload workflow. No signing keys, JWT settings or bucket access
policies change. Keep a private compose backup and prove the other container IDs
are unchanged. Execute the server mode over the existing support SSH connection.
"""
import argparse, base64, importlib.util, json, re, shutil, subprocess, time
from datetime import datetime, timezone
from pathlib import Path
import urllib.parse, urllib.request

CONFIG=Path('/root/supabase/docker/docker-compose.yml')
TTL=7200

def require(ok, message):
    if not ok: raise RuntimeError(message)

def inspect(name):
    return json.loads(subprocess.check_output(['docker','inspect',name]))[0]

def run(apply=False):
    storage=inspect('supabase-storage')
    require(storage['Config']['Image']=='supabase/storage-api:v1.48.26','Storage image changed; review required')
    labels=storage['Config']['Labels']
    require(labels['com.docker.compose.project.config_files']==str(CONFIG),'Unexpected compose source')
    others={name:inspect(name)['Id'] for name in ['supabase-db','supabase-auth','supabase-kong']}
    text=CONFIG.read_text()
    # Target exactly the storage service, never other environment sections.
    match=re.search(r'(?ms)^  storage:\n(?:(?!^  [A-Za-z0-9_-]+:).)*',text)
    require(match is not None,'Storage service block missing')
    block=match.group()
    require(len(re.findall(r'^    environment:\s*$',block,re.M))==1,'Unexpected environment format')
    require('UPLOAD_SIGNED_URL_EXPIRATION_TIME' not in block and 'SIGNED_UPLOAD_URL_EXPIRATION_TIME' not in block,'TTL already configured; inspect instead')
    replacement=block.replace('    environment:\n','    environment:\n      UPLOAD_SIGNED_URL_EXPIRATION_TIME: "7200"\n',1)
    if not apply:
        print(json.dumps({'storage_image':storage['Config']['Image'],'new_signed_upload_ttl':TTL,'other_services_unchanged':list(others)}));return
    backup=Path('/root/primesecure-backups')/('upload-ttl-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(CONFIG,backup/'docker-compose.before.yml');(backup/'docker-compose.before.yml').chmod(0o600)
    CONFIG.write_text(text[:match.start()]+replacement+text[match.end():])
    command=['docker','compose','-f',str(CONFIG)]
    try:
        # Resolved configuration stays in memory, never logs credentials.
        resolved=json.loads(subprocess.check_output(command+['config','--format','json'],cwd=CONFIG.parent,stderr=subprocess.PIPE))
        require(str(resolved['services']['storage']['environment']['UPLOAD_SIGNED_URL_EXPIRATION_TIME'])==str(TTL),'Resolved TTL differs')
    except Exception:
        shutil.copy2(backup/'docker-compose.before.yml',CONFIG)
        raise RuntimeError('Configuration validation failed; original restored') from None
    result=subprocess.run(command+['up','-d','--no-deps','--pull','never','--no-build','storage'],cwd=CONFIG.parent,capture_output=True,text=True,timeout=90)
    require(result.returncode==0,'Storage apply failed; private backup retained for recovery')
    spec=importlib.util.spec_from_file_location('storage_helper','/root/primesecure-explore-stage/storage_helpers.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    base,key=helper.gateway()
    # An existing immutable destination is only signed, not written or changed.
    path='shared/0cacf466-1084-470d-a912-65621ca8f1a6/recovered-ec39cb5b0b5d01cf003ce4df37c9f05736472f5458220128f14ea26749046b76.psapk'
    lifetime=None
    for attempt in range(12):
        try:
            request=urllib.request.Request(base+'/storage/v1/object/upload/sign/primesecure-hub/'+path,data=b'{}',method='POST',headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
            with urllib.request.urlopen(request,timeout=5) as response: signed=json.load(response)
            token=urllib.parse.parse_qs(urllib.parse.urlsplit(signed['url']).query)['token'][0]
            payload=token.split('.')[1];claims=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
            lifetime=claims['exp']-claims['iat']
            if lifetime==TTL:break
        except OSError:pass
        time.sleep(2)
    require(lifetime==TTL,'Storage not verified healthy with expected TTL; inspect private backup')
    require(all(inspect(name)['Id']==identity for name,identity in others.items()),'An unrelated container identity changed')
    report={'backup':str(backup),'signed_upload_ttl_seconds':lifetime,'storage_healthy':True,'auth_db_gateway_unchanged':True,'storage_container_changed':storage['Id']!=inspect('supabase-storage')['Id']}
    (backup/'result.json').write_text(json.dumps(report));(backup/'result.json').chmod(0o600)
    print(json.dumps(report),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args();run(args.apply)
