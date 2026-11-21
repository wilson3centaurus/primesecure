"""Apply the 500 MB APK ceiling to this self-hosted storage deployment.

Run on the server with --apply. Backups stay root-only on the server.
Only the storage container is recreated; database/auth are not restarted.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from datetime import datetime, timezone

LIMIT = 500_000_000
COMPOSE = Path('/root/supabase/docker/docker-compose.yml')
NGINX = Path('/etc/nginx/sites-enabled/api.robokorda.duckdns.org').resolve()


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    container = json.loads(run('docker', 'inspect', 'supabase-storage'))[0]
    env = dict(v.split('=', 1) for v in container['Config']['Env'] if '=' in v)
    print(json.dumps({'storage_limit_before': env.get('FILE_SIZE_LIMIT'), 'target_bytes': LIMIT}))
    if not args.apply:
        return
    assert os.geteuid() == 0, 'Run as root'
    original_compose = COMPOSE.read_text()
    original_nginx = NGINX.read_text()
    # This deployment uses one literal FILE_SIZE_LIMIT in the storage service.
    new_compose, count = re.subn(r'(?m)^(\s+FILE_SIZE_LIMIT:)\s*\d+\s*$', rf'\g<1> {LIMIT}', original_compose)
    assert count == 1, 'Unexpected storage compose layout; no files changed'
    assert 'server_name api.robokorda.duckdns.org;' in original_nginx
    new_nginx, count = re.subn(r'client_max_body_size\s+\w+;', 'client_max_body_size 600m;', original_nginx)
    assert count == 1, 'Unexpected API nginx layout; no files changed'
    backup = Path('/root/primesecure-backups') / ('apk-limit-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(parents=True, mode=0o700)
    for source, name in [(COMPOSE, 'docker-compose.yml'), (NGINX, 'api-nginx.conf')]:
        dest = backup / name
        shutil.copy2(source, dest)
        dest.chmod(0o600)
    try:
        COMPOSE.write_text(new_compose)
        NGINX.write_text(new_nginx)
        run('docker', 'compose', 'config', '--quiet', cwd=COMPOSE.parent)
        run('nginx', '-t')
    except Exception:
        COMPOSE.write_text(original_compose)
        NGINX.write_text(original_nginx)
        raise
    run('docker', 'exec', 'supabase-db', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
        f"update storage.buckets set file_size_limit={LIMIT} where id in ('primesecure-hub','apks');")
    run('docker', 'compose', 'up', '-d', '--no-deps', 'storage', cwd=COMPOSE.parent)
    run('systemctl', 'reload', 'nginx')
    current = json.loads(run('docker', 'inspect', 'supabase-storage'))[0]
    assert f'FILE_SIZE_LIMIT={LIMIT}' in current['Config']['Env']
    print(json.dumps({'storage_limit': LIMIT, 'gateway_body_limit': '600m', 'backup': str(backup), 'changed_services': ['storage', 'nginx reload']}))


if __name__ == '__main__':
    main()
