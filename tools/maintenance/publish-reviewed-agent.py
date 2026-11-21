#!/usr/bin/env python3
"""Inspect or publish ONLY reviewed 0.9.44-preload-chat/76, PAUSED.

No activation or device-command API exists in this tool. Publication makes the
verified APK available to the catalogue without rolling it out to any device.

  python tools/maintenance/publish-reviewed-agent.py --inspect  # default; read-only SSH
  python tools/maintenance/publish-reviewed-agent.py --apply    # explicit private upload/insert

Uses pinned known_hosts and the existing support key ONLY when main() connects.
No app/API/signing-secret config is read; SSH alone loads the support key at connect.
Server gateway credentials never leave the server.
An interrupted staging upload is never overwritten; investigate it manually.
Storage and PostgreSQL cannot share a transaction: failure may leave an immutable
orphan APK, never an activated release. Re-run --inspect to resolve ambiguous results.
"""
from __future__ import annotations

import argparse
import builtins
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shlex
import stat
import subprocess
import sys
import types
import uuid
import zipfile

CODE, VERSION = 76, '0.9.44-preload-chat'
SOURCE = '03c10f8fa71d9ed0508a12bb6800e41bdd9b038f'
SHA = '3996886dab97153ae9564fb66ddcd582fd43e6c2fb048a324fa4ddbac587a17f'
SIZE = 5_287_761
SIGNER = '9f83efe0a3d3399f899619ef35eb43df4f51f8c61e237bf1b547dce3482eaa79'
PACKAGE = 'com.robokorda.primesecure'
STAGE = Path('/root/primesecure-release-stage')
OBJECT = f'releases/{CODE}-{SHA}.apk'
MIME = 'application/vnd.android.package-archive'
HOST = '178.238.227.229'
PSQL = ['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-q', '-A', '-t',
        '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
SNAPSHOT_SQL = """select jsonb_build_object(
 'database',current_database(),
 'school',(select name from public.schools where id='14eea188-73b1-40bc-8f8d-15afbea27ffa'),
 'private_bucket',(select not public from storage.buckets where id='agent'),
 'triggers',(select count(*) from pg_trigger where tgrelid='public.agent_releases'::regclass
             and not tgisinternal and tgenabled <> 'D'),
 'rules',(select count(*) from pg_rules where schemaname='public' and tablename='agent_releases'),
 'rows',(select coalesce(jsonb_agg(to_jsonb(r) order by version_code),'[]'::jsonb) from public.agent_releases r));"""


class GuardError(ValueError):
    """Credential-free, constant diagnostic suitable for printing."""


FAILURE = 'Operation failed; no activation/device writes were requested. Inspect before retry.'
ERROR_TYPES = frozenset(name for name, value in vars(builtins).items()
                       if isinstance(value, type) and issubclass(value, BaseException)) | {
    'GuardError', 'JSONDecodeError', 'TimeoutExpired', 'CalledProcessError',
    'HTTPError', 'URLError', 'SSHException', 'AuthenticationException',
    'BadHostKeyException', 'NoValidConnectionsError', 'SFTPError',
}
FRAME_FUNCTIONS = {
    'publisher': frozenset({
        '<module>', 'require', 'digest', 'identity', 'classify', 'validate_snapshot',
        'prove_unchanged', 'insert_sql', 'verify_local', 'command', 'private_directory',
        'private_json', 'snapshot_readonly', '__init__', 'query', 'commit', 'close',
        'publish_paused', 'server_main', 'stage_apk', 'remote_run', 'main',
        '<dictcomp>', '<listcomp>', '<genexpr>',
    }),
    'reviewed-storage-helper': frozenset({
        '<module>', 'require', 'gateway', '__init__', 'url', 'read_hash', 'ensure',
        '<dictcomp>', '<listcomp>', '<genexpr>',
    }),
}


def safe_diagnostics(value):
    """Accept only known type/frame identifiers, never messages, paths or locals."""
    kind = value.get('error_type')
    kind = kind if isinstance(kind, str) and kind in ERROR_TYPES else 'Exception'
    frames = []
    candidates = value.get('error_frames')
    if isinstance(candidates, list):
        for frame in candidates[:32]:
            if not isinstance(frame, dict):
                continue
            source, function, line = (frame.get(key) for key in ('source', 'function', 'line'))
            if (isinstance(source, str) and source in FRAME_FUNCTIONS
                    and isinstance(function, str) and function in FRAME_FUNCTIONS[source]
                    and type(line) is int and 0 < line <= 100_000):
                frames.append(dict(source=source, function=function, line=line))
    return dict(error_type=kind, error_frames=frames)


class RemoteError(GuardError):
    def __init__(self, result):
        super().__init__('Remote operation failed; inspect private staging before retry')
        self.diagnostics = safe_diagnostics(result)


def error_report(error):
    if isinstance(error, RemoteError):
        return dict(error=str(error), **error.diagnostics)
    frames, trace = [], error.__traceback__
    while trace is not None:
        code = trace.tb_frame.f_code
        source = ('publisher' if code.co_filename == error_report.__code__.co_filename else
                  'reviewed-storage-helper' if code.co_filename == '<reviewed-storage_helpers>' else None)
        if source is not None:
            frames.append(dict(source=source, function=code.co_name, line=trace.tb_lineno))
        trace = trace.tb_next
    diagnostic = safe_diagnostics(dict(error_type=type(error).__name__, error_frames=frames))
    return dict(error=str(error) if type(error) is GuardError else FAILURE, **diagnostic)


def require(ok, message):
    if not ok:
        raise GuardError(message)


def digest(path):
    h, size = hashlib.sha256(), 0
    with path.open('rb') as source:
        for data in iter(lambda: source.read(65536), b''):
            size += len(data)
            require(size <= SIZE, 'APK exceeds reviewed byte count')
            h.update(data)
    return size, h.hexdigest()


def identity():
    return dict(version_code=CODE, version_name=VERSION, sha256=SHA, storage_path=OBJECT,
                active=False, bytes=SIZE, source_commit=SOURCE, signer=SIGNER)


def classify(rows):
    collisions = [r for r in rows if r['version_code'] == CODE or r['storage_path'] == OBJECT or r['sha256'] == SHA]
    require(len(collisions) <= 1, 'Multiple conflicting release identities')
    if not collisions:
        return 'insert-paused'
    row = collisions[0]
    require(all(row.get(k) == identity()[k] for k in ('version_code', 'version_name', 'sha256', 'storage_path'))
            and row.get('active') is False, 'Existing release differs or is active; refusing any change')
    return 'existing-paused'


def validate_snapshot(snapshot):
    require(snapshot['database'] == 'postgres' and snapshot['school'] == 'Rusununguko ZIMFEP High School', 'Backend identity mismatch')
    require(snapshot['private_bucket'] is True, 'Agent storage bucket must already exist and be private')
    require(snapshot['triggers'] == snapshot['rules'] == 0, 'Unexpected release trigger/rule; review side effects before publishing')
    return classify(snapshot['rows'])


def prove_unchanged(before, after, operation):
    require(classify(after) == 'existing-paused', 'Published row is not the exact paused release')
    if operation == 'existing-paused':
        require(before == after, 'Existing release rows changed')
    else:
        require(len(after) == len(before) + 1 and [r for r in after if r['version_code'] != CODE] == before,
                'Other release rows or active flags changed; transaction must roll back')


def insert_sql():
    # All values are reviewed constants. No UPDATE, ON CONFLICT, activation, RPC or device statement.
    return ("insert into public.agent_releases(version_code,version_name,storage_path,sha256,active,notes) "
            f"values ({CODE},'{VERSION}','{OBJECT}','{SHA}',false,"
            f"'Reviewed source {SOURCE}; same fleet signer. PAUSED pending separate rollout approval.');")


def verify_local(apk, proof_path, sdk, repo):
    require(apk.is_file() and not apk.is_symlink(), 'Reviewed APK is missing or is a symlink')
    proof = json.loads(proof_path.read_text(encoding='utf-8'))
    expected = identity()
    require(all(proof.get(k) == expected[k] for k in ('version_code', 'version_name', 'sha256', 'bytes', 'source_commit', 'signer')),
            'Build proof differs from the reviewed artifact/source')
    require(proof.get('signature_verified') is True and proof.get('same_installed_fleet_signer') is True
            and proof.get('test_only') is False, 'Build proof lacks release signing checks')
    require(digest(apk) == (SIZE, SHA), 'APK size/SHA differs from reviewed build proof')

    def command(argv):
        result = subprocess.run(argv, capture_output=True, text=True, timeout=90)
        require(result.returncode == 0, 'Local SDK/git verification failed')
        return result.stdout

    require(command(['git', '-C', str(repo), 'rev-parse', SOURCE + '^{commit}']).strip() == SOURCE, 'Reviewed source commit is missing')
    cert = command([str(sdk/'apksigner.bat'), 'verify', '--verbose', '--print-certs', str(apk)])
    require(re.findall(r'Signer #\d+ certificate SHA-256 digest: (\w+)', cert) == [SIGNER], 'APK does not have exactly the installed fleet signer')
    badging = command([str(sdk/'aapt.exe'), 'dump', 'badging', str(apk)])
    require(f"package: name='{PACKAGE}' versionCode='{CODE}' versionName='{VERSION}'" in badging, 'APK package/version mismatch')
    manifest = command([str(sdk/'aapt.exe'), 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'])
    require(re.search(r'android:testOnly[^\r\n]*=\(type 0x12\)0x0\b', manifest)
            and not re.search(r'android:debuggable[^\r\n]*=\(type 0x12\)(?!0x0\b)', manifest),
            'APK must be non-test-only and non-debuggable')
    with zipfile.ZipFile(apk) as archive:
        require(archive.testzip() is None, 'APK ZIP integrity failure')
    helper = subprocess.run(['git', '-C', str(repo), 'show', SOURCE + ':tools/library/storage_helpers.py'],
                            capture_output=True, check=True, timeout=15).stdout
    return dict(release=expected, storage_helper=helper.decode('utf-8'),
                storage_helper_sha256=hashlib.sha256(helper).hexdigest())


def private_directory(path):
    require(path == STAGE or path.parent == STAGE, 'Directory escaped fixed staging root')
    if not path.exists():
        path.mkdir(mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'Server stage must be a private root-owned directory, not a symlink')


def private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as out:
        json.dump(value, out, sort_keys=True, indent=2)
        out.flush()
        os.fsync(out.fileno())


def snapshot_readonly():
    result = subprocess.run(PSQL, input='begin read only;\n' + SNAPSHOT_SQL + '\ncommit;',
                            capture_output=True, text=True, timeout=45)
    require(result.returncode == 0, 'Read-only release inspection failed')
    return json.loads(result.stdout)


class ReleaseTransaction:
    """Keep the table lock while a host-private, durable before-image is written."""
    def __init__(self):
        self.process = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, text=True, bufsize=1)

    def query(self, sql):
        self.process.stdin.write(sql + '\n')
        self.process.stdin.flush()
        ready, _, _ = select.select([self.process.stdout], [], [], 45)
        require(ready, 'Database transaction timed out; refusing publication')
        line = self.process.stdout.readline()
        require(line, 'Database transaction failed; refusing publication')
        return json.loads(line)

    def commit(self):
        self.process.stdin.write('commit;\n')
        self.process.stdin.close()
        require(self.process.wait(timeout=45) == 0, 'Release commit failed; inspect before retry')

    def close(self):
        if not self.process.stdin.closed:
            self.process.stdin.close()
        if self.process.poll() is None:
            # Closing the connection without COMMIT rolls back, including on proof/backup failure.
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process.stdout.close()


def publish_paused(backup, store, source):
    store.ensure('agent', OBJECT, source, SIZE, SHA, MIME)
    require(store.read_hash('agent', OBJECT) == (SIZE, SHA), 'Stored APK SHA verification failed')
    transaction = ReleaseTransaction()
    try:
        before = transaction.query("begin; set local lock_timeout='10s'; set local statement_timeout='30s'; "
                                   "set local idle_in_transaction_session_timeout='60s'; "
                                   'lock table public.agent_releases in share row exclusive mode;\n' + SNAPSHOT_SQL)
        operation = validate_snapshot(before)
        # version_code is unique in the reviewed schema and is present in every snapshot.
        private_json(backup/'before.json', dict(release=identity(), snapshot=before,
                     active_flags={str(r['version_code']): r['active'] for r in before['rows']}))
        after = transaction.query((insert_sql() if operation == 'insert-paused' else '') + '\n' + SNAPSHOT_SQL)
        validate_snapshot(after)
        prove_unchanged(before['rows'], after['rows'], operation)
        proof = dict(operation=operation, release=identity(), snapshot=after, other_rows_unchanged=True,
                     prior_active_flags_unchanged=True, devices_modified=False)
        private_json(backup/'verified-before-commit.json', proof)
        transaction.commit()
        private_json(backup/'committed.json', proof)
        return dict(operation=operation, release=identity(), backup=str(backup), other_rows_unchanged=True,
                    prior_active_flags_unchanged=True, devices_modified=False)
    finally:
        transaction.close()


def server_main(plan, apply):
    require(plan['release'] == identity(), 'Remote release plan differs from reviewed constants')
    helper = plan['storage_helper'].encode('utf-8')
    require(hashlib.sha256(helper).hexdigest() == plan['storage_helper_sha256'], 'Storage helper transport hash mismatch')
    snapshot = snapshot_readonly()
    operation = validate_snapshot(snapshot)
    module = types.ModuleType('storage_helpers')
    exec(compile(helper, '<reviewed-storage_helpers>', 'exec'), module.__dict__)
    storage = module.Storage(*module.gateway())
    existing = storage.read_hash('agent', OBJECT)
    require(existing is None or existing == (SIZE, SHA), 'Existing immutable storage object differs')
    if not apply:
        return dict(mode='inspect', operation=operation, release=identity(), rows=snapshot['rows'],
                    storage='absent' if existing is None else 'verified', devices_modified=False)
    private_directory(STAGE)
    source = STAGE/f'{CODE}-{SHA}.apk'
    info = source.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'Staged APK must be private, root-owned and not a symlink')
    require(digest(source) == (SIZE, SHA), 'Staged APK differs from reviewed bytes')
    backup = STAGE/('backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex)
    private_directory(backup)
    return publish_paused(backup, storage, source)


def stage_apk(sftp, apk):
    # SFTP targets Linux even when this client runs on Windows.
    directory = STAGE.as_posix()
    try:
        info = sftp.lstat(directory)
    except FileNotFoundError:
        sftp.mkdir(directory, mode=0o700)
        info = sftp.lstat(directory)
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'SFTP staging directory is unsafe')
    remote = (STAGE/f'{CODE}-{SHA}.apk').as_posix()
    try:
        info = sftp.lstat(remote)
    except FileNotFoundError:
        with sftp.open(remote, 'wx') as out, apk.open('rb') as source:
            out.chmod(0o600)
            for data in iter(lambda: source.read(65536), b''):
                out.write(data)
        info = sftp.lstat(remote)
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077 and info.st_size == SIZE,
            'Existing/staged SFTP file is unsafe or incomplete; refusing overwrite')
    h, size = hashlib.sha256(), 0
    with sftp.open(remote, 'rb') as source:
        for data in iter(lambda: source.read(65536), b''):
            size += len(data)
            require(size <= SIZE, 'SFTP file exceeds reviewed size')
            h.update(data)
    require((size, h.hexdigest()) == (SIZE, SHA), 'SFTP bytes differ; refusing overwrite/publication')


def remote_run(client, plan, apply=False):
    source = Path(__file__).read_text(encoding='utf-8')
    command = 'python3 -c ' + shlex.quote(source) + ' --server ' + ('--apply' if apply else '--inspect')
    inp, out, err = client.exec_command(command, timeout=300)
    inp.write(json.dumps(plan)); inp.flush(); inp.channel.shutdown_write()
    text = out.read().decode('utf-8')
    # Deliberately never echo raw SSH/Python/SDK stderr or a gateway environment.
    err.read()
    status = out.channel.recv_exit_status()
    try:
        result = json.loads(text)
    except ValueError:
        raise GuardError('Remote operation failed; inspect private staging before retry') from None
    require(isinstance(result, dict), 'Invalid remote inspection response')
    if 'error' in result:
        # Retain the original type/frames, but never trust a remote message or payload.
        raise RemoteError(result)
    require(status == 0, 'Remote operation failed; inspect private staging before retry')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--inspect', action='store_true', help='Read-only local verification and remote inspection (default)')
    mode.add_argument('--apply', action='store_true', help='Upload reviewed APK and insert paused release only')
    parser.add_argument('--apk', type=Path)
    parser.add_argument('--proof', type=Path)
    parser.add_argument('--sdk', type=Path, help='Local Android SDK build-tools directory (default 35.0.0)')
    parser.add_argument('--server', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.server:
        return server_main(json.load(sys.stdin), args.apply)
    repo = Path(__file__).resolve().parents[2]
    sdk = args.sdk or Path(os.environ['LOCALAPPDATA'])/'Android/Sdk/build-tools/35.0.0'
    apk = args.apk or repo/f'artifacts/primesecure-{VERSION}-{CODE}.apk'
    plan = verify_local(apk, args.proof or repo/f'artifacts/verification-{VERSION}-native.json', sdk, repo)
    print(json.dumps(dict(local_verified=plan['release'], mode='apply' if args.apply else 'inspect')), flush=True)
    import paramiko  # No SSH key access on import, during tests, or --help.
    client = paramiko.SSHClient()
    client.load_system_host_keys(str(Path.home()/'.ssh/known_hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        print(json.dumps({'phase':'connecting_verified_ssh_host'}),flush=True)
        client.connect(HOST, username='root', key_filename=str(Path.home()/'.ssh/primesecure_support_ed25519'),
                       timeout=45, banner_timeout=45, auth_timeout=45, allow_agent=False, look_for_keys=False)
        client.get_transport().set_keepalive(10)
        print(json.dumps({'phase':'read_only_release_inspection'}),flush=True)
        inspected = remote_run(client, plan)
        if not args.apply:
            return inspected
        print(json.dumps({'phase':'private_artifact_staging'}),flush=True)
        with client.open_sftp() as sftp:
            stage_apk(sftp, apk)
        print(json.dumps({'phase':'publish_paused_only'}),flush=True)
        return remote_run(client, plan, apply=True)
    finally:
        client.close()


if __name__ == '__main__':
    try:
        print(json.dumps(main()), flush=True)
    except Exception as error:
        # Never expose generic exceptions: a third-party message can contain credentials.
        print(json.dumps(error_report(error)), flush=True)
        sys.exit(1)
