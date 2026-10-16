"""Temporary signed HTTPS transfer, using uncatalogued private storage objects.

Service credentials remain on the server. Only scoped, expiring transfer URLs
and the public anon key are returned to the local uploader. No bucket/RLS changes.
"""
import sys,json,hashlib,time,subprocess,urllib.request,urllib.error,zipfile,shutil,base64
from pathlib import Path
from storage_helpers import gateway,psql,literal,SCHOOL,BUCKET
ROOT=Path('/root/primesecure-library-stage')
PLAN=ROOT/'https-transfer-plan.json'
base,key=gateway()
headers={'apikey':key,'Authorization':'Bearer '+key}
def api(path,data=None,method=None,extra=None):
    body=None if data is None else json.dumps(data).encode()
    request=urllib.request.Request(base+'/storage/v1'+path,data=body,method=method,headers={**headers,'Content-Type':'application/json',**(extra or {})})
    with urllib.request.urlopen(request,timeout=90) as response:return json.load(response)
def status(plan,phase,**fields):
    data=json.dumps({'phase':phase,**fields}).encode()
    request=urllib.request.Request(base+'/storage/v1/object/'+BUCKET+'/'+plan['prefix']+'/status.json',data=data,method='POST',headers={**headers,'Content-Type':'application/json','x-upsert':'true'})
    with urllib.request.urlopen(request,timeout=30) as response:response.read()
def get(path):
    return urllib.request.urlopen(urllib.request.Request(base+'/storage/v1/object/authenticated/'+BUCKET+'/'+path,headers=headers),timeout=90)
def existing(plan):
    names=','.join(literal(p['path']) for p in plan['parts'])
    return json.loads(psql("select coalesce(json_agg(name),'[]') from storage.objects where bucket_id="+literal(BUCKET)+" and name in ("+names+");"))
def setup():
    plan=json.loads(PLAN.read_text());assert plan['prefix']==SCHOOL+'/seed-transfer/'+plan['sha256'][:20]
    bucket=json.loads(psql("select json_build_object('public',public,'mime',allowed_mime_types,'limit',file_size_limit) from storage.buckets where id="+literal(BUCKET)))
    assert bucket['public'] is False
    assert not bucket['mime'] or 'application/octet-stream' in bucket['mime']
    assert not bucket['limit'] or max(p['size'] for p in plan['parts'])<=bucket['limit']
    present=existing(plan)
    urls=[]
    for part in plan['parts']:
        if part['path'] not in present:
            result=api('/object/upload/sign/'+BUCKET+'/'+part['path'],{},'POST')
            urls.append({**part,'url':'https://api.robokorda.duckdns.org/storage/v1'+result['url']})
    status(plan,'awaiting_upload',received_parts=len(present),total_parts=len(plan['parts']))
    read=api('/object/sign/'+BUCKET+'/'+plan['prefix']+'/status.json',{'expiresIn':7200},'POST')
    ack=api('/object/upload/sign/'+BUCKET+'/'+plan['prefix']+'/ack',{},'POST')
    inspected=json.loads(subprocess.run(['docker','inspect','supabase-kong'],capture_output=True,text=True,check=True).stdout)[0]
    env=dict(x.split('=',1) for x in inspected['Config']['Env'] if '=' in x);anon=env['SUPABASE_ANON_KEY']
    assert json.loads(base64.urlsafe_b64decode(anon.split('.')[1]+'==='))['role']=='anon'
    log=(ROOT/'https-transfer-worker.log').open('ab')
    subprocess.Popen(['python3',str(Path(__file__)), '--worker'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    print(json.dumps({'parts':urls,'existing_parts':len(present),'anon_key':anon,'status_url':'https://api.robokorda.duckdns.org/storage/v1'+read['signedURL'],'ack_url':'https://api.robokorda.duckdns.org/storage/v1'+ack['url']}))
def worker():
    plan=json.loads(PLAN.read_text());deadline=time.time()+7000
    try:
        while True:
            present=existing(plan)
            status(plan,'awaiting_upload',received_parts=len(present),total_parts=len(plan['parts']))
            if len(present)==len(plan['parts']):break
            assert time.time()<deadline,'Transfer expired before all parts arrived'
            time.sleep(8)
        status(plan,'verifying_archive')
        dest=ROOT/'https-archive.part';full=hashlib.sha256()
        with dest.open('wb') as output:
            for part in plan['parts']:
                sha=hashlib.sha256();size=0
                with get(part['path']) as response:
                    while chunk:=response.read(1024*1024):
                        size+=len(chunk);sha.update(chunk);full.update(chunk);output.write(chunk)
                assert (size,sha.hexdigest())==(part['size'],part['sha256'])
        assert full.hexdigest()==plan['sha256']
        archive=ROOT/'library-expansion.zip';dest.replace(archive)
        bundle=ROOT/'bundle';bundle.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as z:
            assert sum(i.file_size for i in z.infolist())<700000000
            for i in z.infolist():
                assert (bundle/i.filename).resolve().is_relative_to(bundle.resolve())
                assert ((i.external_attr>>16)&0o170000)!=0o120000
            z.extractall(bundle)
        command=['python3',str(ROOT/'import-expansion.py'),str(bundle)]
        extra=ROOT/'openstax-manifest.json'
        if extra.exists():
            snapshot=ROOT/'openstax-import-snapshot.json';snapshot.write_text(json.dumps(json.loads(extra.read_text())))
            command+=['--openstax',str(snapshot)]
        status(plan,'validating_catalog')
        subprocess.run(command,check=True)
        status(plan,'publishing_catalog')
        subprocess.run(command+['--apply'],check=True)
        report=json.loads((bundle/'import-report.json').read_text())
        status(plan,'published',report=report)
        # The local uploader saves the report then acknowledges receipt.
        while time.time()<deadline:
            try:
                with get(plan['prefix']+'/ack') as response:
                    if response.read(16)==b'ack':break
            except urllib.error.HTTPError as error:
                if error.code not in (400,404):raise
            time.sleep(5)
        paths=[p['path'] for p in plan['parts']]+[plan['prefix']+'/status.json',plan['prefix']+'/ack']
        api('/object/'+BUCKET,{'prefixes':paths},'DELETE')
        (ROOT/'https-transfer-cleanup.json').write_text(json.dumps({'deleted_transfer_objects':len(paths),'report':report}))
        print('Transfer complete and temporary objects removed',flush=True)
    except Exception as error:
        status(plan,'error',error=type(error).__name__+': '+str(error)[:350]);raise
if __name__=='__main__':worker() if '--worker' in sys.argv else setup()
