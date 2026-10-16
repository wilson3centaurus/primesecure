"""Small HTTPS file transfers for a publisher unreachable from the server."""
import json,hashlib,ssl,time,urllib.request,urllib.error,concurrent.futures
from pathlib import Path
import paramiko,certifi
ROOT=Path(__file__).resolve().parents[2];STAGE=ROOT/'artifacts/school-library-expansion';cache=STAGE/'report-cache-urls.json'
if cache.exists():signed=json.loads(cache.read_text())
else:
    client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=8,banner_timeout=12,auth_timeout=12,allow_agent=False,look_for_keys=False)
    try:
        stdin,stdout,stderr=client.exec_command('python3 -');stdin.write((ROOT/'tools/library/cache-reviewed-reports.py').read_text());stdin.channel.shutdown_write()
        data=stdout.read();error=stderr.read();assert stdout.channel.recv_exit_status()==0,error.decode()[-500:]
        signed=json.loads(data);cache.write_text(json.dumps(signed));cache.chmod(0o600)
    finally:client.close()
keys=json.loads((STAGE/'signed-transfer.json').read_text());TLS=ssl.create_default_context(cafile=certifi.where())
headers={'apikey':keys['anon_key'],'Content-Type':'application/pdf','x-upsert':'false'}
def upload(row):
    data=(STAGE/'official-pdfs'/row['filename']).read_bytes();assert hashlib.sha256(data).hexdigest()==row['sha256'] and len(data)==row['size']
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(row['url'],data=data,headers=headers,method='PUT'),context=TLS,timeout=300) as response:response.read()
            return row['size']
        except urllib.error.HTTPError as error:
            detail=error.read(8192).decode(errors='replace')
            if error.code in (400,409) and ('already exists' in detail or 'Duplicate' in detail):return row['size']
            if attempt==2:raise RuntimeError('Verified PDF transfer HTTP '+str(error.code)) from None
        except (OSError,TimeoutError):
            if attempt==2:raise RuntimeError('Verified PDF transfer interrupted; rerun to resume') from None
        time.sleep(2**attempt)
done=0;size=0
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    futures=[executor.submit(upload,row) for row in signed['parts']]
    for future in concurrent.futures.as_completed(futures):
        size+=future.result();done+=1
        print(json.dumps({'verified_pdfs_transferred':done,'of':len(futures),'bytes':size}),flush=True)
print('Reviewed report transfer complete',flush=True)
