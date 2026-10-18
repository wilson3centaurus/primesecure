"""Prepare, inspect or publish the user-authorized local image folder replacement.

Scoped signed upload URLs are kept only in ignored artifacts; no service key is exported.
"""
import argparse, concurrent.futures, hashlib, json, mimetypes, ssl, time, urllib.request, urllib.error, uuid, threading
from pathlib import Path
import certifi, paramiko

REPO=Path(__file__).resolve().parents[2]
SOURCE=Path('C:/Users/XO/Desktop/Prime Secure/images')
STAGE=REPO/'artifacts/explore-replacement'
SCHOOL='14eea188-73b1-40bc-8f8d-15afbea27ffa'
REMOTE='/root/primesecure-explore-stage'
TLS=ssl.create_default_context(cafile=certifi.where())

def connect():
    client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=12,banner_timeout=15,auth_timeout=15,allow_agent=False,look_for_keys=False)
    client.get_transport().set_keepalive(10);return client

def remote(client,command,stream=False):
    _,out,err=client.exec_command(command)
    if stream:
        for line in out:print(line.strip(),flush=True)
        result=''
    else:result=out.read().decode()
    error=err.read().decode()
    if out.channel.recv_exit_status():raise RuntimeError('Remote operation failed: '+error[-1200:])
    return result

def prepare():
    rows=[];used_paths=set()
    for file in sorted(SOURCE.rglob('*')):
        if not file.is_file():continue
        if file.is_symlink():raise ValueError('Symlink rejected: '+str(file))
        relative=file.relative_to(SOURCE);parts=relative.parts
        if not 2<=len(parts)<=3:raise ValueError('Unsupported folder depth: '+str(relative))
        size=file.stat().st_size
        if not 0<size<=500000000:raise ValueError('Invalid file size: '+str(relative))
        digest=hashlib.sha256()
        with file.open('rb') as source:
            for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
        sha=digest.hexdigest()
        mime=mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        identity=str(uuid.uuid5(uuid.NAMESPACE_URL,'primesecure:'+SCHOOL+':explore:'+relative.as_posix()+':'+sha))
        storage_path=SCHOOL+'/explore/'+sha+file.suffix.lower()
        if storage_path in used_paths:storage_path=SCHOOL+'/explore/'+sha+'-'+identity+file.suffix.lower()
        used_paths.add(storage_path)
        rows.append({'id':identity, 'relative':relative.as_posix(),'title':file.stem[:160],'description':'Learning resource supplied by the school.','form_level':'Explore & grow','subject':parts[0],'category':parts[1] if len(parts)==3 else '', 'storage_path':storage_path,'mime_type':mime,'size':size,'sha256':sha})
    STAGE.mkdir(parents=True,exist_ok=True);manifest={'school':SCHOOL,'root':'Explore & grow','files':rows}
    (STAGE/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'local_files':len(rows),'folders':len({r['subject'] for r in rows}),'bytes':sum(r['size'] for r in rows),'largest':max(r['size'] for r in rows)}),flush=True)
    return manifest

def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['inspect','prepare','upload','publish']);args=parser.parse_args()
    manifest=prepare()
    if args.mode=='prepare':return
    client=connect()
    try:
        remote(client,'mkdir -p -m 700 '+REMOTE)
        with client.open_sftp() as sftp:
            for name in ['storage_helpers.py','replace-explore-server.py']:sftp.put(str(REPO/'tools/library'/name),REMOTE+'/'+name)
            sftp.put(str(STAGE/'manifest.json'),REMOTE+'/manifest.json')
        command='python3 '+REMOTE+'/replace-explore-server.py '
        if args.mode=='inspect':
            try:print(remote(client,command+'inspect'))
            finally:client.close()
            return
        if args.mode=='publish':
            try:remote(client,command+'publish --manifest '+REMOTE+'/manifest.json',stream=True)
            finally:client.close()
            return
        # Sign just before each request: this server's upload tokens expire in 60 seconds.
        signing_in,signing_out,signing_error=client.exec_command(command+'serve --manifest '+REMOTE+'/manifest.json')
    except BaseException:
        client.close();raise
    signing_lock=threading.Lock()
    def signed_url(row,check=False):
        with signing_lock:
            signing_in.write(json.dumps({'path':row['storage_path'],'check':check})+'\n');signing_in.flush()
            line=signing_out.readline()
            if not line:raise RuntimeError('Upload signer connection ended')
            return json.loads(line)
    count=0
    def upload(row):
        file=SOURCE.joinpath(*row['relative'].split('/'));data=file.read_bytes()
        if len(data)!=row['size'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Local file changed after preparation')
        for attempt in range(4):
            try:
                signed=signed_url(row,check=attempt==0)
                if signed['exists']:return
                request=urllib.request.Request(signed['url'],data=data,headers={'Content-Type':row['mime_type'],'x-upsert':'false'},method='PUT')
                with urllib.request.urlopen(request,timeout=120,context=TLS) as response:response.read()
                return
            except urllib.error.HTTPError as error:
                detail=error.read(8192).decode(errors='replace')
                if error.code in (400,409) and ('Duplicate' in detail or 'already exists' in detail):return
                if attempt==3:raise RuntimeError('Upload failed HTTP '+str(error.code)) from None
            except (TimeoutError,OSError):
                if attempt==3:raise RuntimeError('Upload connection failed') from None
            time.sleep(2**attempt)
    print(json.dumps({'upload_objects':len(manifest['files'])}),flush=True)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for _ in pool.map(upload,manifest['files']):
                count+=1
                if count%25==0:print(json.dumps({'uploaded':count,'total':len(manifest['files'])}),flush=True)
        print('Uploads staged. Run publish to verify every object and replace the catalog.',flush=True)
    finally:client.close()

if __name__=='__main__':main()
