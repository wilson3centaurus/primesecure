#!/usr/bin/env python3
"""Prepare exact STORE-ZIP recipes; optionally stage approved splits over SFTP.

Default is LOCAL preparation only. --stage requires the exact approved plan
digest. No catalog, access/default, quota, service or device changes are made.
Only split bytes cross SFTP: base.apk is fetched and verified on the server.
The reconstructed archive must equal the already approved .psapk SHA-256.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import stat
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

SCHOOL = '14eea188-73b1-40bc-8f8d-15afbea27ffa'
BUCKET = 'primesecure-hub'
MIME = 'application/vnd.primesecure.apk-set+zip'
ROOT = Path('/root/recovery-staging/app-package-deltas')
HELPER = Path('/root/primesecure-explore-stage/storage_helpers.py')
LIMIT, RAW_LIMIT, CHUNK = 500_000_000, 262_144, 1_048_576
HEX = re.compile(r'[0-9a-f]{64}')
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.apk', re.I)


class GuardError(ValueError):
    """Only constant, credential-free safety messages may use this exception."""


def require(ok, message):
    if not ok:
        raise GuardError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def digest(path, size=None, offset=0):
    h, count = hashlib.sha256(), 0
    with path.open('rb') as source:
        source.seek(offset)
        while size is None or count < size:
            chunk = source.read(min(CHUNK, size-count) if size is not None else CHUNK)
            if not chunk:
                break
            count += len(chunk); require(count <= LIMIT, 'Source exceeds 500 MB'); h.update(chunk)
    require(size is None or count == size, 'Source is truncated')
    return count, h.hexdigest()


def approved_rows(plan, approval):
    require(HEX.fullmatch(approval or '') and plan.get('plan_sha256') == approval, 'Exact approved plan digest is required')
    content = dict(plan); content.pop('plan_sha256', None)
    require(hashlib.sha256(canonical(content)).hexdigest() == approval, 'Plan changed after approval')
    require(plan.get('school_id') == SCHOOL and plan['inventory']['school_count'] == 1, 'Wrong plan school scope')
    rows = [r for r in plan['mapping'] if r['status'] == 'ready']
    require(1 <= len(rows) <= 100 and len({r['id'] for r in rows}) == len(rows) and len({r['new_path'] for r in rows}) == len(rows), 'Invalid staging app batch')
    for r in rows:
        b = r['before']; parts = b['storage_path'].split('/')
        require(str(uuid.UUID(r['id'])) == r['id'] and b['id'] == r['id'] and b['kind'] == 'app' and b['school_id'] in (None, SCHOOL), 'Invalid existing app identity')
        require(len(parts) == 3 and parts[0] == ('shared' if b['school_id'] is None else SCHOOL) and str(uuid.UUID(parts[1])) == parts[1] and '..' not in b['storage_path'] and '\\' not in b['storage_path'], 'Unsafe original storage prefix')
        require(r['old_path'] == b['storage_path'] and r['new_path'] == '/'.join(parts[:2]) + '/recovered-' + r['sha256'] + '.psapk' and r['old_path'] != r['new_path'], 'Unsafe immutable destination')
        require(HEX.fullmatch(r['sha256']) and HEX.fullmatch(r['base_sha256']) and type(r['size']) is int and 0 < r['size'] <= LIMIT, 'Invalid archive size/hash')
        require(r['package'] == b['package_name'] and r['base_sha256'] == b['sha256'] == b['verified_old_sha256'], 'Unverified server base identity')
        local = [x for x in plan['local'] if x['folder'] == r['folder'] and x['status'] == 'validated']
        require(len(local) == 1 and local[0]['min_sdk'] <= 30, 'Missing validated Android 11 source')
        require(all(local[0][key] == r[key] for key in ('package', 'base_sha256', 'sha256', 'size', 'archive')), 'Mapping differs from validated source')
        source_parts = local[0]['parts']
        require(1 <= len(source_parts) <= 100 and len({p['name'].lower() for p in source_parts}) == len(source_parts), 'Invalid source part count/names')
        require(all(NAME.fullmatch(p['name']) and HEX.fullmatch(p['sha256']) and type(p['size']) is int and 0 < p['size'] <= LIMIT for p in source_parts), 'Unsafe source part')
        base = [p for p in source_parts if p['name'] == 'base.apk']
        require(len(base) == 1 and base[0]['sha256'] == r['base_sha256'] and base[0]['size'] == b['verified_old_size'], 'Base part differs from verified stored object')
        require(sum(p['size'] for p in source_parts) <= LIMIT, 'Raw APK sum exceeds 500 MB')
    return rows


def source_parts(plan, row):
    return next(r['parts'] for r in plan['local'] if r['folder'] == row['folder'])


def recipe_for(row, expected_parts):
    path = Path(row['archive'])
    require(path.is_file() and not path.is_symlink() and path.stat().st_size == row['size'], 'Archive missing/changed')
    require(digest(path) == (row['size'], row['sha256']), 'Archive hash differs from approved plan')
    expected = {p['name']: p for p in expected_parts}
    segments, parts, cursor, raw_size = [], [], 0, 0
    with zipfile.ZipFile(path) as archive, path.open('rb') as source:
        entries = sorted(archive.infolist(), key=lambda entry: entry.header_offset)
        require(len(entries) == len(expected) and {e.filename for e in entries} == set(expected), 'Archive part list differs from validated originals')
        for entry in entries:
            p = expected[entry.filename]
            require(NAME.fullmatch(entry.filename) and entry.compress_type == zipfile.ZIP_STORED and not entry.flag_bits & 1 and entry.file_size == entry.compress_size == p['size'], 'Require flat unencrypted STORE entries of exact size')
            source.seek(entry.header_offset); header = source.read(30)
            require(len(header) == 30 and header[:4] == b'PK\x03\x04', 'Invalid local ZIP header')
            fields = struct.unpack('<4s5H3L2H', header)
            require(fields[3] == 0 and not fields[2] & 1, 'Local ZIP method/flags differ')
            name_bytes, extra = source.read(fields[-2]), fields[-1]
            require(name_bytes == entry.filename.encode('ascii'), 'Local and central ZIP filenames differ')
            offset = entry.header_offset + 30 + len(name_bytes) + extra
            require(cursor <= entry.header_offset and offset + p['size'] <= archive.start_dir, 'Overlapping/out-of-range ZIP data')
            require(raw_size + offset-cursor <= RAW_LIMIT, 'ZIP recipe metadata exceeds bound')
            source.seek(cursor); raw = source.read(offset-cursor); raw_size += len(raw)
            if raw:
                segments.append({'raw': base64.b64encode(raw).decode('ascii')})
            require(digest(path, p['size'], offset) == (p['size'], p['sha256']), 'Archived APK bytes differ from validated originals')
            parts.append({'name': p['name'], 'size': p['size'], 'sha256': p['sha256'], 'offset': offset})
            segments.append({'part': p['name']}); cursor = offset + p['size']
        source.seek(cursor); tail = source.read(RAW_LIMIT + 1); raw_size += len(tail)
        require(source.tell() == row['size'] and raw_size <= RAW_LIMIT, 'ZIP tail/metadata exceeds bound')
        if tail:
            segments.append({'raw': base64.b64encode(tail).decode('ascii')})
    result = {'id': row['id'], 'sha256': row['sha256'], 'size': row['size'], 'parts': parts, 'segments': segments}
    check_recipe(row, expected_parts, result)
    return result


def check_recipe(row, expected_parts, recipe):
    require((recipe['id'], recipe['sha256'], recipe['size']) == (row['id'], row['sha256'], row['size']), 'Recipe archive identity differs')
    expected, supplied = {p['name']: p for p in expected_parts}, recipe['parts']
    require(len(supplied) == len(expected) and len({p['name'] for p in supplied}) == len(supplied) and {p['name'] for p in supplied} == set(expected), 'Recipe parts differ')
    for p in supplied:
        require(NAME.fullmatch(p['name']) and (p['size'], p['sha256']) == (expected[p['name']]['size'], expected[p['name']]['sha256']), 'Unsafe or unapproved recipe part')
        require(type(p.get('offset')) is int and 0 <= p['offset'] <= row['size'] - p['size'], 'Unsafe recipe part offset')
    offsets = {p['name']: p['offset'] for p in supplied}
    require(1 <= len(recipe['segments']) <= 201, 'Too many recipe segments')
    seen, raw_bytes, total = [], 0, 0
    for segment in recipe['segments']:
        if set(segment) == {'raw'}:
            require(isinstance(segment['raw'], str) and len(segment['raw']) <= RAW_LIMIT * 2, 'Raw segment exceeds bound')
            raw = base64.b64decode(segment['raw'], validate=True); raw_bytes += len(raw); total += len(raw)
        elif set(segment) == {'part'}:
            require(segment['part'] in expected, 'Recipe references unknown part')
            require(offsets[segment['part']] == total, 'Recipe part offset differs from ZIP ranges')
            seen.append(segment['part']); total += expected[segment['part']]['size']
        else:
            raise ValueError('Unsupported recipe segment')
    require(raw_bytes <= RAW_LIMIT and sorted(seen) == sorted(expected) and total == row['size'] <= LIMIT, 'Recipe coverage/size differs from approved archive')


def reuse_recipes(plan, rows, approval, path):
    """Reuse ZIP ranges only after every approved archive is freshly hashed."""
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 48_000_000, 'Unsafe or oversized recipe cache')
    cached = json.loads(path.read_text(encoding='utf-8'))
    require(isinstance(cached, dict) and cached.get('plan_sha256') == approval, 'Recipe cache belongs to a different approved plan')
    recipes = cached.get('recipes'); by_id = {r['id']: r for r in rows}
    require(isinstance(recipes, list) and len(recipes) == len(rows) and {r['id'] for r in recipes} == set(by_id), 'Cached recipe batch differs')
    for recipe in recipes:
        row = by_id[recipe['id']]
        check_recipe(row, source_parts(plan, row), recipe)
    for index, row in enumerate(rows, 1):
        archive = Path(row['archive'])
        require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size == row['size'], 'Cached source archive missing/changed')
        require(digest(archive) == (row['size'], row['sha256']), 'Cached source archive hash differs from approved plan')
        emit({'event': 'local_archive_verified', 'id': row['id'], 'apps': index, 'total': len(rows)})
    return recipes


def reconstruct(row, recipe, paths, target):
    """Exclusive local build. No storage operation happens before this passes."""
    expected = {p['name']: p for p in recipe['parts']}
    for name, p in expected.items():
        require(NAME.fullmatch(name) and name in paths and not paths[name].is_symlink(), 'Unsafe or missing reconstruction part')
        require(digest(paths[name]) == (p['size'], p['sha256']), 'Reconstruction part SHA differs')
    h, size = hashlib.sha256(), 0
    with target.open('xb') as output:
        os.chmod(target, 0o600)
        for segment in recipe['segments']:
            if 'raw' in segment:
                data = base64.b64decode(segment['raw'], validate=True); output.write(data); h.update(data); size += len(data)
            else:
                with paths[segment['part']].open('rb') as source:
                    for data in iter(lambda: source.read(CHUNK), b''):
                        output.write(data); h.update(data); size += len(data); require(size <= LIMIT, 'Archive exceeds bound')
        output.flush(); os.fsync(output.fileno())
    require((size, h.hexdigest()) == (row['size'], row['sha256']), 'Reconstructed archive does not match approved SHA; no upload permitted')


def private_dir(path):
    require(path == Path('/root') or path.is_relative_to(Path('/root/recovery-staging')), 'Directory escaped fixed recovery root')
    if not path.exists():
        private_dir(path.parent); path.mkdir(mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid == 0 and not info.st_mode & 0o077, 'Staging directory must be root-owned, private and not a symlink')


def private_gateway(base):
    import ipaddress
    parsed = urllib.parse.urlsplit(base)
    require(parsed.scheme == 'http' and parsed.port == 8000 and not parsed.username and not parsed.password and parsed.path in ('', '/') and not parsed.query and not parsed.fragment, 'Unexpected private gateway')
    require(ipaddress.ip_address(parsed.hostname).is_private, 'Gateway must remain inside private Docker network')
    return parsed


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, *args, **kwargs):
        raise GuardError('Private storage redirects are forbidden')


def stream_store(helper, row, source):
    base, key = helper.gateway(); parsed = private_gateway(base)
    old = read_store(base, key, row['new_path'])
    require(old is None or old == (row['size'], row['sha256']), 'Immutable storage destination differs')
    if old is None:
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=120)
        try:
            with source.open('rb') as body:
                connection.request('POST', '/storage/v1/object/' + BUCKET + '/' + urllib.parse.quote(row['new_path'], safe='/'), body=body, headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': MIME, 'Content-Length': str(row['size']), 'x-upsert': 'false'})
                response = connection.getresponse(); response.read(8192)
                require(response.status in (200, 201, 400, 409), 'Private storage POST failed')
        finally:
            connection.close()
    require(read_store(base, key, row['new_path']) == (row['size'], row['sha256']), 'Stored archive SHA verification failed')


def read_store(base, key, path, destination=None, expected=None):
    private_gateway(base)
    request = urllib.request.Request(base + '/storage/v1/object/authenticated/' + BUCKET + '/' + urllib.parse.quote(path, safe='/'), headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=120) as response:
            require(int(response.headers.get('Content-Length', 0)) <= LIMIT, 'Stored source exceeds cap')
            h, size, deadline = hashlib.sha256(), 0, time.monotonic() + 300
            output = destination.open('xb') if destination else None
            try:
                if output:
                    os.chmod(destination, 0o600)
                for data in iter(lambda: response.read(CHUNK), b''):
                    size += len(data); require(size <= LIMIT and time.monotonic() < deadline, 'Stored source exceeds size/time bound'); h.update(data)
                    if output:
                        output.write(data)
            finally:
                if output:
                    output.close()
            result = (size, h.hexdigest())
            require(expected is None or result == expected, 'Exact server base hash/size differs')
            return result
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        if error.code == 400:
            try:
                detail = json.loads(error.read(8192))
                if str(detail.get('statusCode')) == '404' or detail.get('error') in ('not_found', 'Not Found'):
                    return None
            except (ValueError, TypeError):
                pass
        raise ValueError('Private storage read failed') from None


def baseline(helper, plan, rows):
    ids = helper.literal(json.dumps([r['id'] for r in rows]))
    current = json.loads(helper.psql("begin read only; select json_build_object('schools',(select count(*) from public.schools),'items',(select json_agg(i order by id) from public.hub_items i where id in(select jsonb_array_elements_text(" + ids + "::jsonb)::uuid))); commit;"))
    require(current['schools'] == 1, 'School scope changed since review')
    items = {r['id']: r for r in current['items'] or []}
    for row in rows:
        old = {k: v for k, v in row['before'].items() if k not in ('verified_old_sha256', 'verified_old_size', 'object_verification_error')}
        require(items.get(row['id']) == old, 'Catalog baseline changed; main review required')


def emit(value):
    print(json.dumps(value), flush=True)


def server(plan, recipes, approval):
    import fcntl
    rows = approved_rows(plan, approval); directory = ROOT / approval; private_dir(directory)
    require(len(recipes) == len(rows) and {r['id'] for r in recipes} == {r['id'] for r in rows}, 'Recipe batch differs')
    by_id, recipes = {r['id']: r for r in rows}, {r['id']: r for r in recipes}
    for row in rows:
        check_recipe(row, source_parts(plan, row), recipes[row['id']])
    lock_path = directory / 'lease.lock'
    require(not lock_path.is_symlink(), 'Unsafe lease path')
    with lock_path.open('a+b') as lease:
        os.chmod(lock_path, 0o600); fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        spec = importlib.util.spec_from_file_location('delta_storage', HELPER); helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
        require(helper.SCHOOL == SCHOOL and helper.BUCKET == BUCKET, 'Wrong server helper scope')
        baseline(helper, plan, rows)
        emit({'ok': True, 'phase': 'ready', 'apps': len(rows)})
        for line in sys.stdin:
            require(len(line) <= 1024, 'Command exceeds bound'); query = json.loads(line)
            require(query.get('op') in ('inspect', 'assemble') and query.get('id') in by_id, 'Command is not allowlisted')
            row = by_id[query['id']]; recipe = recipes[row['id']]
            parts_dir = directory / 'parts' / row['id']; private_dir(parts_dir)
            paths = {p['name']: parts_dir / p['name'] for p in recipe['parts'] if p['name'] != 'base.apk'}
            if query['op'] == 'inspect':
                state = {}
                for p in recipe['parts']:
                    if p['name'] == 'base.apk':
                        continue
                    path = paths[p['name']]
                    require(not path.is_symlink(), 'Unsafe staged part')
                    size, sha = digest(path) if path.exists() else (0, hashlib.sha256(b'').hexdigest())
                    require(size <= p['size'], 'Staged split is larger than approved part')
                    state[p['name']] = {'size': size, 'sha256': sha}
                emit({'ok': True, 'parts': state})
                continue
            base, key = helper.gateway(); base_dir = directory / 'bases'; private_dir(base_dir)
            paths['base.apk'] = base_dir / (row['base_sha256'] + '.apk')
            expected = (row['before']['verified_old_size'], row['base_sha256'])
            if not paths['base.apk'].exists():
                emit({'event': 'fetch_server_base', 'id': row['id'], 'bytes': expected[0]})
                # An interrupted base fetch keeps a private partial file. A new
                # unique attempt cannot overwrite that or any existing cache.
                temporary = base_dir / (row['base_sha256'] + '-' + uuid.uuid4().hex + '.partial')
                require(read_store(base, key, row['old_path'], temporary, expected) == expected, 'Verified server base is missing')
                os.link(temporary, paths['base.apk'])
            require(not paths['base.apk'].is_symlink() and digest(paths['base.apk']) == expected, 'Cached server base differs')
            output = directory / (row['sha256'] + '.psapk')
            if not output.exists():
                temporary = directory / (row['sha256'] + '-' + uuid.uuid4().hex + '.building')
                reconstruct(row, recipe, paths, temporary); os.link(temporary, output)
            require(not output.is_symlink() and digest(output) == (row['size'], row['sha256']), 'Rebuilt archive differs')
            emit({'event': 'archive_verified', 'id': row['id'], 'sha256': row['sha256']})
            baseline(helper, plan, [row]); stream_store(helper, row, output)
            emit({'ok': True, 'id': row['id'], 'sha256': row['sha256'], 'path': row['new_path'], 'catalog_changed': False})


def connect():
    import paramiko
    client = paramiko.SSHClient(); client.load_system_host_keys(str(Path.home() / '.ssh/known_hosts')); client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect('178.238.227.229', username='root', key_filename=str(Path.home() / '.ssh/primesecure_support_ed25519'), timeout=20, banner_timeout=30, auth_timeout=45, allow_agent=False, look_for_keys=False, compress=True)
    client.get_transport().set_keepalive(10)
    return client


def sftp_directory(sftp, path):
    require(path == Path('/root') or path.is_relative_to(Path('/root/recovery-staging')), 'SFTP path escaped fixed root')
    name = path.as_posix()
    try:
        info = sftp.lstat(name)
    except FileNotFoundError:
        sftp_directory(sftp, path.parent); sftp.mkdir(name, mode=0o700); info = sftp.lstat(name)
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'SFTP directory is not private/root-owned or is a symlink')


def sftp_immutable(sftp, path, data):
    try:
        info = sftp.lstat(path.as_posix())
        require(stat.S_ISREG(info.st_mode) and info.st_size == len(data), 'Existing metadata differs')
        with sftp.open(path.as_posix(), 'rb') as old:
            require(old.read(len(data)+1) == data, 'Existing metadata bytes differ')
        return
    except FileNotFoundError:
        pass
    with sftp.open(path.as_posix(), 'wx') as target:
        target.write(data)
    sftp.chmod(path.as_posix(), 0o600)


def stage(plan, recipes, approval):
    rows = approved_rows(plan, approval); by_id = {r['id']: r for r in rows}; directory = ROOT / approval
    require(len(recipes) == len(rows) and {r['id'] for r in recipes} == set(by_id), 'Recipe batch differs')
    for recipe in recipes:
        check_recipe(by_id[recipe['id']], source_parts(plan, by_id[recipe['id']]), recipe)
    client = connect(); receipts = []
    try:
        with client.open_sftp() as sftp:
            sftp.get_channel().settimeout(120)
            sftp_directory(sftp, directory)
            code = Path(__file__).read_bytes(); runner = directory / ('runner-' + hashlib.sha256(code).hexdigest() + '.py')
            recipe_hash = hashlib.sha256(canonical(recipes)).hexdigest()
            plan_file, recipe_file = directory / 'plan.json', directory / ('recipes-' + recipe_hash + '.json')
            for path, data in [(runner, code), (plan_file, canonical(plan)), (recipe_file, canonical(recipes))]:
                sftp_immutable(sftp, path, data)
            command = 'python3 -B ' + shlex.quote(runner.as_posix()) + ' --server --plan ' + shlex.quote(plan_file.as_posix()) + ' --recipes ' + shlex.quote(recipe_file.as_posix()) + ' --approved-plan-sha256 ' + approval
            input_stream, output, error = client.exec_command(command, timeout=900)
            def response():
                while True:
                    line = output.readline(131073); require(bool(line), 'Server stage ended; service credentials are never logged')
                    require(len(line) <= 131072 and line.endswith('\n'), 'Server response exceeds bound or is incomplete')
                    result = json.loads(line)
                    if 'event' in result:
                        emit(result); continue
                    require(result.get('ok') is True, 'Server rejected delta staging')
                    return result
            require(response().get('phase') == 'ready', 'Server did not acquire staging lease')
            def request(value):
                input_stream.write(json.dumps(value) + '\n'); input_stream.flush(); return response()
            for recipe in sorted(recipes, key=lambda r: sum(p['size'] for p in r['parts'] if p['name'] != 'base.apk')):
                row = by_id[recipe['id']]; existing = request({'op': 'inspect', 'id': row['id']})['parts']
                for p in recipe['parts']:
                    if p['name'] == 'base.apk':
                        continue
                    prior = existing[p['name']]; count = prior['size']
                    require(type(count) is int and 0 <= count <= p['size'] and digest(Path(row['archive']), count, p['offset'])[1] == prior['sha256'], 'Resume prefix differs; refusing append')
                    require(digest(Path(row['archive']), p['size'], p['offset'])[1] == p['sha256'], 'Local split changed')
                    if count == p['size']:
                        continue
                    remote = directory / 'parts' / row['id'] / p['name']
                    try:
                        info = sftp.lstat(remote.as_posix()); require(stat.S_ISREG(info.st_mode) and info.st_size == count, 'Part changed since prefix check')
                    except FileNotFoundError:
                        require(count == 0, 'Resume part disappeared')
                    with Path(row['archive']).open('rb') as source, sftp.open(remote.as_posix(), 'ab') as target:
                        sftp.chmod(remote.as_posix(), 0o600); target.set_pipelined(True)
                        source.seek(p['offset']+count); announced = count
                        while count < p['size']:
                            data = source.read(min(CHUNK, p['size']-count)); require(bool(data), 'Local split truncated'); target.write(data); count += len(data)
                            if count-announced >= 8*CHUNK or count == p['size']:
                                target.flush(); emit({'event': 'split_upload', 'id': row['id'], 'part': p['name'], 'bytes': count, 'total': p['size']}); announced = count
                    require(sftp.stat(remote.as_posix()).st_size == p['size'], 'Remote split size differs')
                receipt = request({'op': 'assemble', 'id': row['id']})
                require((receipt.get('id'), receipt.get('sha256'), receipt.get('path'), receipt.get('catalog_changed')) == (row['id'], row['sha256'], row['new_path'], False), 'Server receipt differs from approved destination')
                receipts.append(receipt)
                emit({'event': 'staged_receipt', **receipt})
                emit({'event': 'staged_verified', 'apps': len(receipts), 'total': len(rows)})
            input_stream.channel.shutdown_write(); require(output.channel.recv_exit_status() == 0, 'Server stage exit failed')
    finally:
        client.close()
    return receipts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--approved-plan-sha256', required=True)
    parser.add_argument('--recipes', type=Path, help='Reuse a prior recipe report after fresh whole-archive SHA verification; no inner-part preparation pass')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--stage', action='store_true')
    parser.add_argument('--server', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    require(not (args.server and args.stage), 'Choose one execution side')
    require(args.plan.stat().st_size <= 48_000_000, 'Plan exceeds bound')
    plan = json.loads(args.plan.read_text(encoding='utf-8')); rows = approved_rows(plan, args.approved_plan_sha256)
    if args.server:
        require(args.plan.resolve() == ROOT / args.approved_plan_sha256 / 'plan.json' and args.recipes is not None and args.recipes.resolve().parent == args.plan.resolve().parent and not args.recipes.is_symlink(), 'Unsafe server input location')
        require(args.recipes.stat().st_size <= 48_000_000, 'Recipes exceed bound')
        server(plan, json.loads(args.recipes.read_text()), args.approved_plan_sha256); return
    recipes = reuse_recipes(plan, rows, args.approved_plan_sha256, args.recipes) if args.recipes else [recipe_for(row, source_parts(plan, row)) for row in rows]
    result = {'plan_sha256': args.approved_plan_sha256, 'apps': len(rows), 'archive_bytes': sum(r['size'] for r in rows), 'reused_base_bytes': sum(r['before']['verified_old_size'] for r in rows), 'split_upload_bytes': sum(p['size'] for r in recipes for p in r['parts'] if p['name'] != 'base.apk'), 'recipe_raw_bytes': sum(len(base64.b64decode(s['raw'])) for r in recipes for s in r['segments'] if 'raw' in s), 'recipes': recipes, 'catalog_changed': False}
    if args.stage:
        require(args.report is not None and not args.report.exists(), 'Staging requires a NEW receipt report path')
        result['staged'] = stage(plan, recipes, args.approved_plan_sha256)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open('x', encoding='utf-8') as output:
            json.dump(result, output, indent=2)
    emit({k: v for k, v in result.items() if k not in ('recipes', 'staged')})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Exception messages from HTTP libraries can contain credentials/URLs.
        emit({'ok': False, 'error_type': type(error).__name__, **({'reason': str(error)} if isinstance(error, GuardError) else {}), 'catalog_changed': False})
        sys.exit(1)
