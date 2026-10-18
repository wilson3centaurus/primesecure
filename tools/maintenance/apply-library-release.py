"""Inspect/apply explicitly named, reviewed migrations to the linked self-hosted school backend.

No auth/database restart. A private schema-only backup precedes a transactional batch.
Uses the existing support key and verified SSH host; secrets are never printed.
"""
import argparse, hashlib, json, re, shlex, sys
from datetime import datetime, timezone
from pathlib import Path
import paramiko

REPO=Path(__file__).resolve().parents[2]
PSQL='docker exec -i supabase-db psql -X -q -A -t -U supabase_admin -d postgres -v ON_ERROR_STOP=1'

def run(client,command,data=None):
    inp,out,err=client.exec_command(command)
    if data is not None:inp.write(data);inp.flush();inp.channel.shutdown_write()
    result=out.read().decode();error=err.read().decode()
    if out.channel.recv_exit_status():raise RuntimeError('Backend operation failed: '+error[-1200:])
    return result.strip()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('migrations',nargs='+');parser.add_argument('--apply',action='store_true');parser.add_argument('--install-retention',action='store_true');args=parser.parse_args()
    files=[]
    for name in args.migrations:
        if not re.fullmatch(r'\d{14}_[a-z0-9_]+\.sql',name):raise ValueError('Specify migration filenames, not paths')
        file=REPO/'supabase/migrations'/name;sql=file.read_text(encoding='utf-8-sig')
        files.append({'name':name,'sha256':hashlib.sha256(sql.encode()).hexdigest(),'sql':sql})
    client=paramiko.SSHClient();client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=15,allow_agent=False,look_for_keys=False)
    try:
        check=json.loads(run(client,PSQL,"select json_build_object('database',current_database(),'school',(select name from public.schools where id='14eea188-73b1-40bc-8f8d-15afbea27ffa'),'history',to_regclass('supabase_migrations.schema_migrations')::text,'folder_delete_exists',to_regprocedure('public.staff_delete_library_folders(uuid,boolean,jsonb)') is not null,'max_agent_code',(select max(version_code) from public.agent_releases),'max_installed_code',(select max(agent_version_code) from public.devices));"))
        if check['school']!='Rusununguko ZIMFEP High School':raise ValueError('Backend identity mismatch')
        print(json.dumps({'backend':check,'reviewed':[{'name':f['name'],'sha256':f['sha256']} for f in files]}),flush=True)
        if not args.apply:return
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');directory='/root/primesecure-backups/library-release-'+stamp
        run(client,'mkdir -m 700 '+shlex.quote(directory))
        # Schema only; no student documents or private messages leave the database.
        run(client,'docker exec supabase-db pg_dump -U supabase_admin -d postgres --schema-only --schema public --schema storage > '+shlex.quote(directory+'/schema-before.sql')+' && chmod 600 '+shlex.quote(directory+'/schema-before.sql'))
        sql='begin;\nselect pg_advisory_xact_lock(hashtext(\'primesecure-library-release\'));\n'+'\n'.join(f['sql'] for f in files)+'\ncommit;'
        run(client,PSQL,sql)
        with client.open_sftp() as sftp:
            with sftp.open(directory+'/applied.json','w') as out:out.write(json.dumps([{'name':f['name'],'sha256':f['sha256']} for f in files]))
            sftp.chmod(directory+'/applied.json',0o600)
        if args.install_retention:
            require_cron=run(client,'systemctl is-active cron')
            if require_cron!='active':raise RuntimeError('Migrations applied, but cron is not running; configure retention before accepting evidence')
            run(client,'mkdir -p -m 700 /root/primesecure-maintenance')
            with client.open_sftp() as sftp:
                for local,remote in [(REPO/'tools/library/storage_helpers.py','/root/primesecure-maintenance/storage_helpers.py'),(REPO/'tools/maintenance/resource-retention.py','/root/primesecure-maintenance/resource-retention.py'),(REPO/'tools/maintenance/resource-retention.cron','/etc/cron.d/primesecure-resource-retention')]:
                    sftp.put(str(local),remote);sftp.chmod(remote,0o644 if remote.startswith('/etc/cron.d/') else 0o600)
            print(run(client,'python3 /root/primesecure-maintenance/resource-retention.py --apply'),flush=True)
        print(json.dumps({'applied':[f['name'] for f in files],'backup':directory,'services_restarted':[]}),flush=True)
    finally:client.close()

if __name__=='__main__':main()
