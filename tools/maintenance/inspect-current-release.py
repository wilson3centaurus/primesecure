"""Read-only, aggregate live audit for the current PrimeSecure release.

Uses the pinned support SSH key. It prints no student names, messages, tokens,
credentials, or device identifiers and performs no database or storage writes.
"""
import json
from pathlib import Path
import paramiko

PSQL = "docker exec -i supabase-db psql -X -q -A -t -U supabase_admin -d postgres -v ON_ERROR_STOP=1"
SQL = r"""
select jsonb_build_object(
  'database', current_database(),
  'school', (select name from public.schools where id='14eea188-73b1-40bc-8f8d-15afbea27ffa'),
  'releases', (select coalesce(jsonb_agg(jsonb_build_object(
      'code',version_code,'version',version_name,'active',active,'created_at',created_at,
      'sha256',left(sha256,12)) order by version_code desc),'[]'::jsonb)
    from public.agent_releases where version_code >= 70),
  'fleet_versions', (select coalesce(jsonb_agg(to_jsonb(q) order by q.agent_version_code desc nulls last),'[]'::jsonb)
    from (select agent_version_code,agent_version,count(*) devices,
      count(*) filter(where last_seen_at > now()-interval '20 minutes') online,
      count(*) filter(where last_seen_at > now()-interval '24 hours') seen_24h
      from public.devices where school_id='14eea188-73b1-40bc-8f8d-15afbea27ffa' and status<>'retired'
      group by agent_version_code,agent_version) q),
  'class_state', (select jsonb_build_object(
      'total',count(*),'legacy_only',count(*) filter(where coalesce(form_level,'')='' and class_form is not null),
      'missing',count(*) filter(where coalesce(form_level,'')='' and class_form is null),
      'mapped',count(*) filter(where coalesce(form_level,'')<>'' and coalesce(class_name,'')<>''))
    from public.devices where school_id='14eea188-73b1-40bc-8f8d-15afbea27ffa' and status<>'retired'),
  'catalog', (select jsonb_build_object(
      'apps',count(*) filter(where kind='app' and published),
      'wallpapers',count(*) filter(where kind='wallpaper' and published),
      'resources',count(*) filter(where kind='resource' and published),
      'explore',count(*) filter(where kind='resource' and published and lower(form_level) in ('explore & grow','explore and grow')))
    from public.hub_items where school_id is null or school_id='14eea188-73b1-40bc-8f8d-15afbea27ffa'),
  'chat_schema', to_regclass('primesecure.student_chat_messages') is not null
);
"""

def main():
    client=paramiko.SSHClient()
    client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('178.238.227.229',username='root',key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),timeout=15,allow_agent=False,look_for_keys=False)
    try:
        stdin,stdout,stderr=client.exec_command(PSQL)
        stdin.write(SQL);stdin.flush();stdin.channel.shutdown_write()
        result=stdout.read().decode().strip();error=stderr.read().decode()
        if stdout.channel.recv_exit_status(): raise RuntimeError('Live read-only audit failed: '+error[-800:])
        payload=json.loads(result)
        if payload.get('school')!='Rusununguko ZIMFEP High School': raise RuntimeError('Backend identity mismatch')
        print(json.dumps(payload,indent=2))
    finally: client.close()

if __name__=='__main__': main()
