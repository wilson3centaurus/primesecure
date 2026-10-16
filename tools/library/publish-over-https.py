"""Fallback for unstable SSH bulk transfers. Signed URLs stay in ignored artifacts."""
from pathlib import Path
import hashlib,json,time,urllib.request,urllib.error,concurrent.futures,threading,ssl
import paramiko,certifi
TLS=ssl.create_default_context(cafile=certifi.where())
ROOT=Path(__file__).resolve().parents[2];STAGE='/root/primesecure-library-stage'
archive=ROOT/'artifacts/school-library-expansion/library-expansion.zip'
cache=archive.parent/'signed-transfer.json'
if cache.exists():
    signed=json.loads(cache.read_text());assert signed['archive_sha256']==hashlib.sha256(archive.read_bytes()).hexdigest()
else:
    data=archive.read_bytes();sha=hashlib.sha256(data).hexdigest();prefix='14eea188-73b1-40bc-8f8d-15afbea27ffa/seed-transfer/'+sha[:20];parts=[]
    for n,start in enumerate(range(0,len(data),8*1024*1024)):
        chunk=data[start:start+8*1024*1024];parts.append({'path':prefix+'/'+str(n).zfill(3)+'.part','offset':start,'size':len(chunk),'sha256':hashlib.sha256(chunk).hexdigest()})
    client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=8,banner_timeout=12,auth_timeout=12,allow_agent=False,look_for_keys=False)
    client.get_transport().set_keepalive(5)
    try:
        sftp=client.open_sftp()
        for name in ['https-transfer-server.py','import-expansion.py','storage_helpers.py']:sftp.put(str(ROOT/'tools/library'/name),STAGE+'/'+name)
        with sftp.open(STAGE+'/https-transfer-plan.json','w') as output:output.write(json.dumps({'sha256':sha,'prefix':prefix,'parts':parts}))
        stdin,stdout,stderr=client.exec_command('python3 '+STAGE+'/https-transfer-server.py')
        # This response contains scoped transfer URLs; do not print it.
        result=stdout.read();error=stderr.read();assert stdout.channel.recv_exit_status()==0,error.decode()[-800:]
        signed=json.loads(result);signed['archive_sha256']=sha;cache.write_text(json.dumps(signed));cache.chmod(0o600)
    finally:client.close()
    print(json.dumps({'https_parts':len(parts),'already_received':signed['existing_parts']}),flush=True)
headers={'apikey':signed['anon_key'],'Authorization':'Bearer '+signed['anon_key'],'Content-Type':'application/octet-stream','x-upsert':'false'}
completed=0;lock=threading.Lock()
def upload(part):
    global completed
    with archive.open('rb') as source:source.seek(part['offset']);chunk=source.read(part['size'])
    assert hashlib.sha256(chunk).hexdigest()==part['sha256']
    for attempt in range(3):
        try:
            request=urllib.request.Request(part['url'],data=chunk,headers=headers,method='PUT')
            with urllib.request.urlopen(request,timeout=180,context=TLS) as response:response.read()
            break
        except urllib.error.HTTPError as error:
            detail=error.read(8192).decode(errors='replace')
            if error.code in (400,409) and ('Duplicate' in detail or 'already exists' in detail or '"statusCode":"409"' in detail):break
            if attempt==2:raise RuntimeError('HTTPS part upload failed HTTP '+str(error.code)) from None
            time.sleep(2**attempt)
        except (TimeoutError,OSError):
            if attempt==2:raise RuntimeError('HTTPS part upload connection failed') from None
            time.sleep(2**attempt)
    with lock:
        completed+=1;print(json.dumps({'completed_https_parts':completed,'of':len(signed['parts'])}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:list(executor.map(upload,signed['parts']))
print('All HTTPS parts sent; waiting for server verification and publication',flush=True)
previous=None
for n in range(360):
    try:
        with urllib.request.urlopen(urllib.request.Request(signed['status_url'],headers={'apikey':signed['anon_key']}),timeout=30,context=TLS) as response:state=json.load(response)
    except (urllib.error.URLError,TimeoutError):time.sleep(5);continue
    if state!=previous:print(json.dumps(state),flush=True);previous=state
    if state['phase']=='published':
        (archive.parent/'live-import-report.json').write_text(json.dumps(state['report'],indent=2))
        with urllib.request.urlopen(urllib.request.Request(signed['ack_url'],data=b'ack',headers=headers,method='PUT'),timeout=30,context=TLS) as response:response.read()
        print('Publication verified; cleanup acknowledged',flush=True);break
    if state['phase']=='error':raise RuntimeError('Server import failed: '+state.get('error','unknown error'))
    time.sleep(5)
else:raise RuntimeError('Timed out waiting for server publication; transfer URLs remain private and expire')
