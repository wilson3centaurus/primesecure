"""Recreate the reviewed private bundle directly on the school server.

Called from an isolated checkout under /root/primesecure-library-stage. Publisher
PDFs must match reviewed hashes. Generated literature/robotics keeps attribution.
"""
from pathlib import Path
import json,sys,os,hashlib,urllib.request,concurrent.futures,subprocess,shutil,time,signal,importlib.util,fcntl
ROOT=Path(__file__).resolve().parents[2];STAGE=ROOT/'artifacts/school-library-expansion'
STAGE.mkdir(parents=True,exist_ok=True);INPUTS=json.loads((Path(__file__).parent/'source-inputs-2026-10.json').read_text())
TRANSFER=Path('/root/primesecure-library-stage')
spec=importlib.util.spec_from_file_location('transfer',TRANSFER/'https-transfer-server.py');transfer=importlib.util.module_from_spec(spec);spec.loader.exec_module(transfer)
plan=json.loads(transfer.PLAN.read_text())
def progress(phase,**fields):transfer.status(plan,phase,**fields)
def fetch(url,path,expected=None):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists() and expected and hashlib.sha256(path.read_bytes()).hexdigest()==expected:return
    with urllib.request.urlopen(url,timeout=90) as response:data=response.read(90000001)
    assert 0<len(data)<=90000000,'Publisher file exceeds staging cap'
    if expected:assert hashlib.sha256(data).hexdigest()==expected,'Publisher content changed from reviewed checksum'
    path.write_bytes(data)
def fetch_report(row,path):
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==row['sha256']:return
    path.parent.mkdir(parents=True,exist_ok=True)
    deadline=time.time()+3600
    # This publisher is unreachable from the server's network. Accept only the
    # checksum-identical original already downloaded and reviewed on the PC.
    while time.time()<deadline:
        try:
            with transfer.get(plan['prefix']+'/reports/'+row['sha256']+'.pdf') as response:data=response.read(20000001)
            assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256']
            path.write_bytes(data);return
        except urllib.error.HTTPError as error:
            if error.code not in (400,404):raise
            time.sleep(5)
    raise RuntimeError('Waiting for the verified report transfer timed out')
def static_download(task):
    kind,row=task;result=dict(row)
    try:
        if kind=='official':
            path=STAGE/'official-pdfs'/row['filename'];fetch_report(row,path)
            import fitz
            with fitz.open(path) as doc:result['first_text']=' '.join(doc[i].get_text() for i in range(min(2,len(doc))))[:6000]
        elif kind=='shona':fetch(row['source_url'],STAGE/'shona'/row['filename'])
        elif kind=='novels':fetch(row['url'],STAGE/'gutenberg'/row['filename'],row['sha256'])
        elif kind=='maths':fetch(row['source_url'],ROOT/'artifacts/learning-library/files'/row['filename'],row['sha256'])
        else:fetch(row['url'],STAGE/'downloads/sparkfun-v41a.pdf',row['sha256'])
    except Exception as e:result.update(success=False,error=type(e).__name__+': '+str(e)[:150])
    return kind,result
def main():
    # Stop the earlier archive-waiting job; the signed status URL is reused.
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:
            cmd=(p/'cmdline').read_bytes().replace(b'\0',b' ').decode()
            if cmd.startswith('python3 '+str(TRANSFER/'https-transfer-server.py')+' --worker'):os.kill(int(p.name),signal.SIGTERM)
        except (FileNotFoundError,ProcessLookupError,PermissionError):pass
    progress('downloading_on_server')
    progress('downloading_exam_documents')
    web=Path('/var/tmp/primesecure-library-web')
    web.mkdir(exist_ok=True)
    # Browser runs as nobody, with no access to root's keys or database credentials.
    for src,dest in [(TRANSFER/'browser/node_modules',web/'node_modules'),(TRANSFER/'browsers',web/'browsers'),(TRANSFER/'browser-libs',web/'libs')]:
        if not dest.exists():shutil.copytree(src,dest)
    shutil.copyfile(Path(__file__).parent/'mirror-sytbay.cjs',web/'mirror-sytbay.cjs')
    (web/'inputs.json').write_text(json.dumps({'sytbay':INPUTS['sytbay']}))
    out=web/'out';out.mkdir(exist_ok=True);out.chmod(0o700);os.chown(out,65534,65534)
    environment={**os.environ,'PRIMESECURE_WEB_STAGE':str(web),'PLAYWRIGHT_BROWSERS_PATH':str(web/'browsers'),'LD_LIBRARY_PATH':str(web/'libs/usr/lib/x86_64-linux-gnu')}
    subprocess.run(['runuser','-u','nobody','--','env','LD_LIBRARY_PATH='+environment['LD_LIBRARY_PATH'],'PLAYWRIGHT_BROWSERS_PATH='+environment['PLAYWRIGHT_BROWSERS_PATH'],'PRIMESECURE_WEB_STAGE='+str(web),'/opt/node-v20.19.6-linux-x64/bin/node',str(web/'mirror-sytbay.cjs')],check=True)
    downloaded=json.loads((out/'sytbay-downloads.json').read_text());assert all(r.get('success') for r in downloaded),'Some browser downloads failed checksum validation'
    shutil.copytree(out/'sytbay-pdfs',STAGE/'sytbay-pdfs',dirs_exist_ok=True);shutil.copyfile(out/'sytbay-downloads.json',STAGE/'sytbay-downloads.json')
    progress('downloading_on_server')
    tasks=[(kind,row) for kind in ['shona','novels','maths','official'] for row in INPUTS[kind]]+[('sparkfun',INPUTS['sparkfun'])]
    results={k:[] for k in ['official','shona','novels','maths','sparkfun']}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for n,(kind,row) in enumerate(executor.map(static_download,tasks),1):
            results[kind].append(row)
            if n%20==0:progress('downloading_on_server',publisher_downloads=n,total=len(tasks));print(json.dumps({'publisher_downloads':n,'of':len(tasks)}),flush=True)
    for key,name in [('official','official-downloads.json'),('shona','shona-downloads.json'),('novels','novel-candidates.json')]:
        (STAGE/name).write_text(json.dumps(results[key]))
    maths=ROOT/'artifacts/learning-library';maths.mkdir(parents=True,exist_ok=True)
    (maths/'downloaded-textbooks.json').write_text(json.dumps(results['maths']))
    failures=[r for rows in results.values() for r in rows if r.get('success') is False]
    assert not failures,'Publisher download failures: '+json.dumps([{'title':r.get('title'),'error':r.get('error')} for r in failures])[:800]
    progress('preparing_offline_books')
    environment={**os.environ,'PRIMESECURE_LIBRARY_FONT':'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'}
    for name in ['prepare-expansion.py','review-expansion.py']:
        subprocess.run(['python3',str(Path(__file__).parent/name)],env=environment,check=True,cwd=ROOT)
    manifest=json.loads((STAGE/'bundle/manifest.json').read_text());assert len(manifest['resources'])==361,'Prepared resource count differs from reviewed batch'
    progress('publishing_catalog')
    extra=TRANSFER/'openstax-manifest.json';snapshot=TRANSFER/'openstax-import-snapshot.json';snapshot.write_text(json.dumps(json.loads(extra.read_text())))
    storage_env=dict(v.split('=',1) for v in json.loads(subprocess.check_output(['docker','inspect','supabase-storage']))[0]['Config']['Env'] if '=' in v)
    limit=min(45000000,int(storage_env['FILE_SIZE_LIMIT'])-1024)
    progress('splitting_large_textbooks')
    subprocess.run(['python3',str(Path(__file__).parent/'split-openstax-volumes.py'),str(snapshot),'--limit',str(limit)],check=True)
    progress('publishing_catalog')
    command=['python3',str(Path(__file__).parent/'import-expansion.py'),str(STAGE/'bundle'),'--openstax',str(TRANSFER/'openstax-volumes.json')]
    subprocess.run(command,check=True);subprocess.run(command+['--apply'],check=True)
    report=json.loads((STAGE/'bundle/import-report.json').read_text());progress('published',report=report)
    deadline=time.time()+900
    while time.time()<deadline:
        try:
            with transfer.get(plan['prefix']+'/ack') as response:
                if response.read(16)==b'ack':break
        except urllib.error.HTTPError as error:
            if error.code not in (400,404):raise
        time.sleep(5)
    paths=[p['path'] for p in plan['parts']]+json.loads(transfer.PLAN.read_text()).get('extra_paths',[])+[plan['prefix']+'/ack',plan['prefix']+'/status.json']
    transfer.api('/object/'+transfer.BUCKET,{'prefixes':paths},'DELETE')
    remaining=transfer.psql("select count(*) from storage.objects where bucket_id="+transfer.literal(transfer.BUCKET)+" and name like "+transfer.literal(plan['prefix']+'/%')+';')
    assert remaining=='0'
    (TRANSFER/'mirror-cleanup.json').write_text(json.dumps({'remaining_transfer_objects':0,'report':report}))
    print('PUBLISH_COMPLETE; temporary transfer objects removed',flush=True)
if __name__=='__main__':
    lock=(TRANSFER/'mirror.lock').open('a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:print('Reviewed library mirror already running');sys.exit(0)
    try:main()
    except Exception as error:progress('error',error=type(error).__name__+': '+str(error)[:600]);raise
