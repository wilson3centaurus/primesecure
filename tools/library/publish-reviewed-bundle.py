"""Resumable private SFTP transfer; accepts only the known SSH host key.

Uploads reviewed files, then starts server-side validation/import. No password or
service key is copied. A failed connection can be retried without starting over.
"""
from pathlib import Path
import hashlib,json,time,shlex
import paramiko

ROOT=Path(__file__).resolve().parents[2]
STAGE='/root/primesecure-library-stage'
archive=ROOT/'artifacts/school-library-expansion/library-expansion.zip'
expected=hashlib.sha256(archive.read_bytes()).hexdigest()
client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=8,banner_timeout=12,auth_timeout=12,allow_agent=False,look_for_keys=False)
client.get_transport().set_keepalive(5)
try:
    sftp=client.open_sftp();remote=STAGE+'/library-expansion.zip'
    try: offset=sftp.stat(remote).st_size
    except FileNotFoundError: offset=0
    assert offset<=archive.stat().st_size
    if offset:
        with sftp.open(remote,'rb') as existing,archive.open('rb') as local:
            for start in {0,max(0,offset-65536)}:
                existing.seek(start);local.seek(start);count=min(65536,offset-start)
                assert existing.read(count)==local.read(count),'Remote partial upload differs; refusing to overwrite'
    print(json.dumps({'resume_bytes':offset,'total_bytes':archive.stat().st_size}),flush=True)
    with sftp.open(remote,'ab' if offset else 'wb') as output,archive.open('rb') as source:
        output.set_pipelined(True)
        source.seek(offset);next_report=offset+5000000
        while chunk:=source.read(1024*1024):
            output.write(chunk);offset+=len(chunk)
            if offset>=next_report:print(json.dumps({'uploaded_bytes':offset}),flush=True);next_report=offset+5000000
    for name in ['import-expansion.py','storage_helpers.py']:
        sftp.put(str(ROOT/'tools/library'/name),STAGE+'/'+name)
    runner='''import hashlib,json,subprocess,zipfile,time,os
from pathlib import Path
root=Path('/root/primesecure-library-stage')
archive=root/'library-expansion.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==EXPECTED
dest=root/'bundle';dest.mkdir(exist_ok=True)
with zipfile.ZipFile(archive) as z:
 assert sum(i.file_size for i in z.infolist())<700000000
 for info in z.infolist():
  target=(dest/info.filename).resolve()
  assert target.is_relative_to(dest.resolve()) and not ((info.external_attr>>16)&0o170000)==0o120000
 z.extractall(dest)
print('Archive checksum verified and extracted',flush=True)
command=['python3',str(root/'import-expansion.py'),str(dest)]
subprocess.run(command,check=True)
extra=root/'openstax-manifest.json'
if extra.exists():
 snapshot=root/'openstax-import-snapshot.json'
 snapshot.write_text(json.dumps(json.loads(extra.read_text())))
 command+=['--openstax',str(snapshot)]
subprocess.run(command+['--apply'],check=True)
print('PUBLISH_COMPLETE',flush=True)
'''.replace('EXPECTED',repr(expected))
    with sftp.open(STAGE+'/publish-library.py','w') as output:output.write(runner)
    stdin,stdout,stderr=client.exec_command('nohup python3 '+STAGE+'/publish-library.py > '+STAGE+'/publish-progress.log 2>&1 < /dev/null &')
    assert stdout.channel.recv_exit_status()==0,stderr.read().decode()
    print('Server-side verified publication started',flush=True)
finally:client.close()
