"""Owner-only scheduled removal of expired capture frames and requested originals.

Run on the backend with storage_helpers.py beside it. Access expiry is enforced
by RLS independently; this job removes the underlying retained data as well.
"""
import argparse, json, re, urllib.request
from storage_helpers import gateway, psql, literal, require

def cleanup(apply=False):
    frames=int(psql('select count(*) from public.remote_capture_frames where expires_at<=now();'))
    rows=json.loads(psql("select coalesce(json_agg(t),'[]') from (select id,storage_path from public.device_file_transfers where cleaned_at is null and expires_at<=now() order by expires_at limit 1000) t;"))
    for row in rows:
        require(re.fullmatch(r'[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}/original',row['storage_path']) is not None,'Unexpected original storage path; no deletion performed')
    if not apply:return {'expired_frames':frames,'expired_originals':len(rows),'applied':False}
    psql('select remote_control_internal.purge_expired_frames();')
    if rows:
        base,key=gateway()
        for offset in range(0,len(rows),100):
            batch=rows[offset:offset+100]
            request=urllib.request.Request(base+'/storage/v1/object/device-file-originals',data=json.dumps({'prefixes':[row['storage_path'] for row in batch]}).encode(),headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='DELETE')
            with urllib.request.urlopen(request,timeout=90) as response:response.read()
            # Audit rows remain. Mark only after the Storage API has removed blobs.
            ids=','.join(literal(row['id'])+'::uuid' for row in batch)
            psql('update public.device_file_transfers set cleaned_at=now() where expires_at<=now() and id in ('+ids+');')
    return {'removed_frames':frames,'removed_originals':len(rows),'applied':True}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    print(json.dumps(cleanup(args.apply)),flush=True)
