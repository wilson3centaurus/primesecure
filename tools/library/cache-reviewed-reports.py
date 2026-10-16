"""Server-only setup of write-only URLs for already-reviewed official PDFs."""
import sys,json,urllib.request
from pathlib import Path
ROOT=Path('/root/primesecure-library-stage');sys.path.insert(0,str(ROOT))
from storage_helpers import gateway,SCHOOL,BUCKET,psql,literal
base,key=gateway();headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}
plan_path=ROOT/'https-transfer-plan.json';plan=json.loads(plan_path.read_text())
assert plan['prefix'].startswith(SCHOOL+'/seed-transfer/')
inputs=json.loads((ROOT/'workspace/tools/library/source-inputs-2026-10.json').read_text())
parts=[];paths=[]
for row in inputs['official']:
    path=plan['prefix']+'/reports/'+row['sha256']+'.pdf';paths.append(path)
    present=psql("select exists(select 1 from storage.objects where bucket_id="+literal(BUCKET)+" and name="+literal(path)+");")== 't'
    if present:continue
    request=urllib.request.Request(base+'/storage/v1/object/upload/sign/'+BUCKET+'/'+path,data=b'{}',headers=headers,method='POST')
    with urllib.request.urlopen(request,timeout=30) as response:result=json.load(response)
    parts.append({'filename':row['filename'],'sha256':row['sha256'],'size':row['bytes'],'url':'https://api.robokorda.duckdns.org/storage/v1'+result['url']})
plan['extra_paths']=list(set(plan.get('extra_paths',[])+paths))
temp=plan_path.with_suffix('.tmp');temp.write_text(json.dumps(plan));temp.replace(plan_path)
print(json.dumps({'parts':parts}))
