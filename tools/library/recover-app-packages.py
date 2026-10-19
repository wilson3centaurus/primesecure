#!/usr/bin/env python3
"""Audit complete Android 11 app sets and plan existing-catalog repairs.

Default: local audit only. --inventory reads the scoped server catalog over SSH.
--stage additionally requires --plan and --approved-plan-sha256; it ONLY uploads
new immutable objects and verifies them. No mode changes catalog rows. --publish
is deliberately reserved for main's reviewed transaction and requires a backup.
No device commands, service keys, SQL migrations, deletes or upserts are used.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import ssl
import subprocess
import sys
import time
import urllib.parse
import uuid
import zipfile

SCHOOL = '14eea188-73b1-40bc-8f8d-15afbea27ffa'
HOST = '178.238.227.229'
API = 'https://api.robokorda.duckdns.org'
BUCKET = 'primesecure-hub'
MIME = 'application/vnd.primesecure.apk-set+zip'
LIMIT = 500_000_000
ABIS = ('arm64-v8a', 'armeabi-v7a', 'armeabi')
ANDROID = 'http://schemas.android.com/apk/res/android'
PART = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.apk', re.I)
HEX = re.compile(r'[0-9a-f]{64}')
SOURCE = Path('C:/Users/XO/Desktop/Prime Secure')
SDK = Path.home() / 'AppData/Local/Android/Sdk/build-tools/37.0.0'
JAVA = Path('C:/Program Files/Android/Android Studio/jbr/bin/java.exe')
REMOTE_HELPER = '/root/primesecure-explore-stage/storage_helpers.py'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def sha_file(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1_048_576), b''):
            h.update(chunk)
    return h.hexdigest()


def regular(path, parent):
    require(path.is_file() and not path.is_symlink() and path.resolve().parent == parent.resolve(), 'Missing or unsafe source file: ' + path.name)
    require(0 < path.stat().st_size <= LIMIT, 'Source file exceeds 500 MB or is empty: ' + path.name)
    return path


def run(command):
    result = subprocess.run([str(x) for x in command], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=90)
    require(result.returncode == 0, 'SDK verification failed: ' + result.stderr.strip()[-600:])
    require(len(result.stdout) < 12_000_000, 'SDK output exceeds audit bound')
    return result.stdout


def xmltree(text):
    """Parse aapt's typed tree while retaining Android attribute namespaces."""
    namespaces, stack, roots = {}, [], []
    for line in text.splitlines():
        stripped, indent = line.strip(), len(line) - len(line.lstrip())
        if stripped.startswith('N: '):
            prefix, uri = stripped[3:].split('=', 1)
            namespaces[prefix] = uri
        elif stripped.startswith('E: '):
            name = stripped[3:].split(' ', 1)[0]
            node = {'name': name, 'attrs': {}, 'children': []}
            while stack and stack[-1][0] >= indent:
                stack.pop()
            (stack[-1][1]['children'] if stack else roots).append(node)
            stack.append((indent, node))
        elif stripped.startswith('A: '):
            require(bool(stack), 'Attribute without XML element')
            match = re.match(r'A: ([^=(]+)(?:\(0x[0-9a-fA-F]+\))?=(.*)', stripped)
            require(match is not None, 'Unrecognized aapt attribute')
            name, value = match.groups()
            if ':' in name:
                prefix, name = name.split(':', 1)
                namespace = namespaces.get(prefix, 'unknown:' + prefix)
            else:
                namespace = ''
            key = (namespace, name)
            require(key not in stack[-1][1]['attrs'], 'Duplicate manifest attribute')
            if value.startswith('"'):
                quoted = re.match(r'"(?:[^"\\]|\\.)*"', value)
                require(quoted is not None, 'Invalid aapt string')
                value = json.loads(quoted.group())
            elif value.startswith('(type '):
                typed = re.fullmatch(r'\(type 0x([0-9a-fA-F]+)\)(0x[0-9a-fA-F]+|-?\d+)', value)
                require(typed is not None, 'Unrecognized typed attribute')
                value = int(typed[2], 0)
            # References/codenames stay strings, so integer security checks fail closed.
            stack[-1][1]['attrs'][key] = value
    require(len(roots) == 1 and roots[0]['name'] == 'manifest', 'Missing unique manifest root')
    return roots[0]


def manifest_part(text, name):
    root = xmltree(text)
    get = lambda node, key, namespace=ANDROID: node['attrs'].get((namespace, key))
    children = lambda tag: [n for n in root['children'] if n['name'] == tag]
    require(len(children('uses-sdk')) <= 1 and len(children('application')) <= 1, 'Duplicate SDK/application element')
    sdk = children('uses-sdk')[0] if children('uses-sdk') else {'attrs': {}}
    app = children('application')[0] if children('application') else {'attrs': {}, 'children': []}
    package = get(root, 'package', '')
    require(isinstance(package, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+', package), 'Invalid package name')
    code, major = get(root, 'versionCode'), get(root, 'versionCodeMajor') or 0
    require(type(code) is int and type(major) is int and 0 <= code <= 0xffffffff and 0 <= major <= 0xffffffff, 'Invalid manifest version code')
    minimum = get(sdk, 'minSdkVersion')
    minimum = 1 if minimum is None else minimum
    require(type(minimum) is int and minimum >= 1, 'Invalid/codename minimum SDK')
    split = get(root, 'split', '') or ''
    require(isinstance(split, str), 'Invalid split identifier')
    types = lambda value: [s.strip() for s in (value or '').split(',') if s.strip()]
    meta_required = any(get(n, 'name') == 'com.android.vending.splits.required' and get(n, 'value') in (1, 0xffffffff, True) for n in app['children'] if n['name'] == 'meta-data')
    return {'name': name, 'package': package, 'version_code': str((major << 32) | code), 'version_name': get(root, 'versionName') or '',
            'split': split, 'min_sdk': minimum, 'required_types': types(get(root, 'requiredSplitTypes')), 'split_types': types(get(root, 'splitTypes')),
            'requires_splits': get(root, 'isSplitRequired') in (1, 0xffffffff, True) or get(app, 'isSplitRequired') in (1, 0xffffffff, True) or meta_required,
            'dependencies': [get(n, 'name') for n in children('uses-split')], 'config_for_split': get(root, 'configForSplit', '') or ''}


def signer_digests(output):
    # SDK 37 labels scheme signers as "V3.0 Signer:"; older builds use
    # "Signer #1". Source Stamp Signer is deliberately excluded.
    certs = re.findall(r'^(?:Signer #\d+|V[1-4](?:\.\d+)? Signer(?: #\d+)?):? certificate SHA-256 digest: ([0-9a-fA-F]{64})\s*$', output, re.M)
    require(bool(certs), 'No verified APK signer certificates')
    return sorted({c.lower() for c in certs})


def inspect_part(path, sdk, java, identity=None):
    part = dict(identity) if identity is not None else manifest_part(run([sdk / 'aapt.exe', 'dump', 'xmltree', path, 'AndroidManifest.xml']), path.name)
    # Compatible packages must verify for API 30. Incompatible ones are still
    # audited at their declared floor so they retain an explicit exclusion.
    verification_sdk = str(max(30, part['min_sdk']))
    output = run([java, '-jar', sdk / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', '--min-sdk-version', verification_sdk, '--max-sdk-version', verification_sdk, path])
    part['signers'] = signer_digests(output)
    part['sha256'], part['size'] = sha_file(path), path.stat().st_size
    libraries = defaultdict(list)
    with zipfile.ZipFile(path) as archive:
        require(len(archive.infolist()) <= 100_000, 'APK has too many ZIP entries')
        for entry in archive.infolist():
            match = re.fullmatch(r'lib/([^/]+)/([^/]+\.so)', entry.filename)
            if match:
                libraries[match[1]].append(match[2])
    part['libraries'] = dict(libraries)
    return part


def validate_parts(parts):
    require(1 <= len(parts) <= 100, 'Need 1..100 APK parts')
    require(sum(p['size'] for p in parts) <= LIMIT, 'Raw APK bytes exceed 500 MB')
    names, split_names = set(), set()
    for p in parts:
        require(PART.fullmatch(p['name']) is not None and p['name'].lower() not in names, 'Unsafe/duplicate part filename')
        require(p['split'] not in split_names, 'Duplicate base/split manifest')
        names.add(p['name'].lower()); split_names.add(p['split'])
    bases = [p for p in parts if not p['split']]
    require(len(bases) == 1 and bases[0]['name'] == 'base.apk', 'Need exact base.apk with base manifest')
    base = bases[0]
    graph, library_groups = {}, defaultdict(lambda: defaultdict(set))
    for p in parts:
        require((p['package'], p['version_code'], p['signers']) == (base['package'], base['version_code'], base['signers']), 'Package/version/signing certificate mismatch')
        dependencies = p['dependencies'] + ([p['config_for_split']] if p['config_for_split'] else [])
        require(all(isinstance(d, str) and d and d in split_names and d != p['split'] for d in dependencies), 'Missing/self split dependency')
        graph[p['split']] = dependencies
        require(not p['requires_splits'] or len(parts) > 1, 'Required splits missing')
        supplied = {t for other in parts if other is p or other['config_for_split'] == p['split'] or (not p['split'] and not other['config_for_split']) for t in other['split_types']}
        require(set(p['required_types']) <= supplied, 'Required split types missing')
        feature = p['config_for_split'] or (p['split'] if p['split'] and not p['split'].startswith('config.') else '')
        for abi, libraries in p['libraries'].items():
            library_groups[feature][abi].update(libraries)
    def visit(name, active, seen):
        require(name not in active, 'Cyclic split dependencies')
        if name not in seen:
            for dep in graph[name]:
                visit(dep, active | {name}, seen)
            seen.add(name)
    seen = set()
    for name in graph:
        visit(name, set(), seen)
    compatible = set(ABIS)
    for group in library_groups.values():
        required = set().union(*group.values())
        compatible &= {abi for abi in ABIS if required <= group.get(abi, set())}
    require(bool(compatible), 'Native libraries cannot satisfy the Primebook ARM ABI list')
    return {'package': base['package'], 'version_code': base['version_code'], 'version_name': base['version_name'],
            'base_sha256': base['sha256'], 'min_sdk': max(p['min_sdk'] for p in parts),
            'compatible_abis': [abi for abi in ABIS if abi in compatible], 'signers': base['signers']}


def validate_archive(path, parts):
    regular(path, path.parent)
    expected = {p['name']: p for p in parts}
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        require(1 <= len(members) <= 100 and {e.filename for e in members} == set(expected) and len(members) == len(expected), 'Archive parts differ from original folder')
        require(sum(e.file_size for e in members) <= LIMIT, 'Archive raw APK bytes exceed 500 MB')
        for entry in members:
            require(PART.fullmatch(entry.filename) is not None and entry.compress_type == zipfile.ZIP_STORED and not entry.flag_bits & 1, 'Require safe flat unencrypted STORE APK entries')
            require(entry.file_size == entry.compress_size == expected[entry.filename]['size'], 'Archive entry size mismatch')
            digest, count = hashlib.sha256(), 0
            with archive.open(entry) as stream:
                for chunk in iter(lambda: stream.read(1_048_576), b''):
                    count += len(chunk); require(count <= entry.file_size, 'Archive expands beyond declared size'); digest.update(chunk)
            require(count == entry.file_size and digest.hexdigest() == expected[entry.filename]['sha256'], 'Archive APK bytes differ from signed originals')
    return {'archive': str(path.resolve()), 'sha256': sha_file(path), 'size': path.stat().st_size}


def archive_name(folder):
    return re.sub(r'[^a-zA-Z0-9._-]', '_', folder) + '.psapk'


def audit(source, originals, sdk, java, workers=2):
    require(sdk.name == '37.0.0' and (sdk / 'aapt.exe').is_file() and (sdk / 'lib/apksigner.jar').is_file() and java.is_file(), 'SDK 37 aapt/apksigner and Java are required')
    require(source.is_dir() and originals.is_dir() and not source.is_symlink() and not originals.is_symlink(), 'Unsafe/missing input directories')
    report = json.loads((source / 'compatibility-report.json').read_text(encoding='utf-8-sig'))
    require(isinstance(report, list) and 1 <= len(report) <= 100, 'Compatibility report exceeds app bound')
    listed = {r['folder']: r for r in report}
    require(len(listed) == len(report), 'Duplicate report folders')
    require(len({archive_name(name) for name in listed}) == len(listed), 'Normalized archive filenames collide')
    entries = list(originals.iterdir())
    require(all(p.is_dir() or (p.name == 'backup-inventory.csv' and p.is_file() and not p.is_symlink() and p.resolve().parent == originals.resolve()) for p in entries), 'Unexpected file in original app backup root')
    folders = sorted(p for p in entries if p.is_dir())
    require(all(f.is_dir() and not f.is_symlink() and f.resolve().parent == originals.resolve() for f in folders) and {f.name for f in folders} == set(listed), 'Original folders differ from report; review inventory first')
    def inspect(folder):
        row = {'folder': folder.name, 'status': 'invalid', 'reported': listed[folder.name], 'parts': []}
        try:
            files = sorted(folder.iterdir())
            require(1 <= len(files) <= 100 and sum(f.stat().st_size for f in files) <= LIMIT, 'Folder count/bytes exceed limits')
            require(all(PART.fullmatch(f.name) for f in files), 'Original folder contains non-APK entries')
            base_file = regular(folder / 'base.apk', folder)
            row['base_sha256'] = sha_file(base_file)
            identity = manifest_part(run([sdk / 'aapt.exe', 'dump', 'xmltree', base_file, 'AndroidManifest.xml']), 'base.apk')
            row.update(package=identity['package'], version_code=identity['version_code'], min_sdk=identity['min_sdk'])
            for f in files:
                regular(f, folder)
                row['parts'].append(inspect_part(f, sdk, java, identity if f.name == 'base.apk' else None))
            row.update(validate_parts(row['parts']))
            if row['min_sdk'] > 30:
                row['status'] = 'excluded_min_sdk'
                row['reason'] = 'Requires Android API ' + str(row['min_sdk']) + '; retain catalog and let main review visibility'
            else:
                path = source / archive_name(folder.name)
                row.update(validate_archive(path, row['parts']))
                old = listed[folder.name]
                require((old.get('package'), old.get('sha256'), old.get('bytes'), old.get('parts')) == (row['package'], row['sha256'], row['size'], len(row['parts'])), 'Compatibility report differs from fresh audit')
                row['status'] = 'validated'
        except (ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
            row['reason'] = str(error)[:900]
            if row.get('min_sdk', 0) > 30:
                row['status'] = 'excluded_min_sdk'
        return row
    with ThreadPoolExecutor(max_workers=workers) as pool:
        rows = list(pool.map(inspect, folders))
    return rows


def build_plan(local, inventory):
    require(inventory.get('school_id') == SCHOOL and inventory.get('school_name') == 'Rusununguko ZIMFEP High School', 'Wrong server school scope')
    require(inventory.get('school_count') == 1, 'Other schools now exist: shared recovery requires a new main review')
    items = inventory['items']
    require(len(items) <= 1000, 'Unexpected catalog size')
    by_package, by_hash = defaultdict(list), defaultdict(list)
    for row in local:
        if row.get('package') and row.get('base_sha256'):
            by_package[row['package']].append(row); by_hash[row['base_sha256']].append(row)
    duplicates = Counter((i.get('package_name'), i.get('sha256')) for i in items)
    mapping = []
    for item in items:
        require(item['kind'] == 'app' and item['school_id'] in (None, SCHOOL), 'Out-of-scope catalog row')
        entry = {'id': item['id'], 'title': item['title'], 'package': item.get('package_name'), 'old_path': item['storage_path'], 'scope': 'shared' if item['school_id'] is None else 'school', 'status': 'unmatched_untouched'}
        package_rows = by_package.get(item.get('package_name'), [])
        hash_rows = by_hash.get(item.get('sha256'), [])
        candidates = [r for r in package_rows if r['base_sha256'] == item.get('sha256')]
        if len(candidates) == 1:
            candidate = candidates[0]
            entry.update(folder=candidate['folder'], min_sdk=candidate.get('min_sdk'), base_sha256=candidate['base_sha256'], local_status=candidate['status'])
        if duplicates[(item.get('package_name'), item.get('sha256'))] > 1:
            entry.update(status='quarantined_duplicate_catalog', reason='Multiple catalog rows share package and base hash; titles are not identity')
        elif not candidates and (package_rows or hash_rows):
            entry.update(status='quarantined_identity_mismatch', reason='Both verified original base hash and package must match')
        elif len(candidates) > 1:
            entry.update(status='quarantined_duplicate_local', reason='Ambiguous local package/base hash')
        elif candidates:
            row = candidates[0]
            if row['status'] != 'validated':
                entry.update(status=row['status'], reason=row.get('reason', 'Local validation failed'))
            elif item.get('verified_old_sha256') != row['base_sha256'] or item.get('verified_old_size') != next(p['size'] for p in row['parts'] if p['name'] == 'base.apk'):
                entry.update(status='quarantined_storage_mismatch', reason='Server object bytes not verified against the original base APK')
            else:
                prefix = item['storage_path'].split('/')
                expected_scope = 'shared' if item['school_id'] is None else SCHOOL
                try:
                    require(len(prefix) == 3 and prefix[0] == expected_scope and str(uuid.UUID(prefix[1])) == prefix[1] and '..' not in item['storage_path'], 'Original path does not have the expected scope/UUID prefix')
                    target = '/'.join(prefix[:2]) + '/recovered-' + row['sha256'] + '.psapk'
                    require(target != item['storage_path'], 'Recovery would overwrite current object')
                    entry.update(status='ready', new_path=target, sha256=row['sha256'], size=row['size'], archive=row['archive'], mime=MIME, before=item)
                except ValueError as error:
                    entry.update(status='quarantined_path', reason=str(error))
        mapping.append(entry)
    result = {'schema': 1, 'school_id': SCHOOL, 'created_at': datetime.now(timezone.utc).isoformat(), 'device_sdk': 30, 'device_abis': list(ABIS), 'local': local, 'inventory': inventory, 'mapping': mapping,
              'counts': {'local': dict(Counter(r['status'] for r in local)), 'catalog': dict(Counter(r['status'] for r in mapping)), 'ready_bytes': sum(r.get('size', 0) for r in mapping if r['status'] == 'ready')},
              'publish_sql_notes': ['Main must save a full catalog/access/defaults backup before its separately reviewed transaction.', 'UPDATE existing IDs only, guarding the exact old package, base hash, scope and storage path.', 'Replace only storage_path, mime_type, size and sha256 with verified staged values; retain all other metadata and identifiers.', 'Do not insert catalog rows, delete originals, change preinstall/default/access settings, or globally unpublish excluded/duplicate rows.', 'Recheck shared impact and baseline drift immediately before commit; excluded/duplicate rows need main review.']}
    result['plan_sha256'] = hashlib.sha256(canonical(result)).hexdigest()
    return result


def blocked_report(local, reason):
    return {'status': 'blocked_inventory', 'school_id': SCHOOL, 'local': local, 'mapping': [], 'plan_sha256': None,
            'audit_sha256': hashlib.sha256(canonical(local)).hexdigest(),
            'counts': {'local': dict(Counter(r['status'] for r in local)), 'catalog': {'unavailable': True}, 'stageable': 0},
            'blocker': reason + '; no catalog identity or old-object hash is assumed.',
            'catalog_read': False, 'stageable': False, 'catalog_changed': False}


def connect():
    import paramiko
    client = paramiko.SSHClient()
    client.load_system_host_keys(str(Path.home() / '.ssh/known_hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(HOST, username='root', key_filename=str(Path.home() / '.ssh/primesecure_support_ed25519'), timeout=20, banner_timeout=30, auth_timeout=45, allow_agent=False, look_for_keys=False)
    client.get_transport().set_keepalive(10)
    return client


def start_remote(client, mode):
    script = Path(__file__).with_name('recover-app-packages-server.py').read_text(encoding='utf-8')
    command = 'python3 -B -c ' + shlex.quote(script) + ' --mode ' + shlex.quote(mode) + ' --helper ' + shlex.quote(REMOTE_HELPER)
    return client.exec_command(command, timeout=900)


def inventory_remote(local):
    query = {'packages': sorted({r['package'] for r in local if r.get('package')}), 'base_hashes': sorted({r['base_sha256'] for r in local if r.get('base_sha256')})}
    client = connect()
    try:
        input_stream, output, error = start_remote(client, 'inventory')
        input_stream.write(json.dumps(query) + '\n'); input_stream.flush(); input_stream.channel.shutdown_write()
        data = output.read(48_000_001)
        require(len(data) <= 48_000_000, 'Server inventory exceeds bound')
        require(output.channel.recv_exit_status() == 0, 'Server inventory failed: ' + error.read(2000).decode(errors='replace'))
        return json.loads(data)
    finally:
        client.close()


def approved_plan(plan, approval):
    expected = plan.get('plan_sha256')
    require(HEX.fullmatch(approval or '') is not None and approval == expected, 'Staging requires main approval of this exact plan SHA-256')
    payload = dict(plan); payload.pop('plan_sha256', None)
    require(hashlib.sha256(canonical(payload)).hexdigest() == expected, 'Plan content changed after review')
    rows = [r for r in plan['mapping'] if r['status'] == 'ready']
    require(1 <= len(rows) <= 100 and len({r['new_path'] for r in rows}) == len(rows), 'Invalid staging batch')
    for row in rows:
        candidates = [r for r in plan['local'] if r['folder'] == row['folder'] and r['status'] == 'validated']
        require(len(candidates) == 1 and candidates[0]['min_sdk'] <= 30, 'Staging row lacks a validated Android 11 source')
        require(all(row[key] == candidates[0][key] for key in ('package', 'base_sha256', 'sha256', 'size', 'archive')), 'Staging row differs from the validated local source')
    return rows


def checked_signed_url(url, path):
    parsed, origin = urllib.parse.urlsplit(url), urllib.parse.urlsplit(API)
    require(parsed.scheme == 'https' and parsed.netloc == origin.netloc and not parsed.fragment, 'Untrusted signed URL origin')
    require(urllib.parse.unquote(parsed.path) == '/storage/v1/object/upload/sign/' + BUCKET + '/' + path, 'Signed URL path escaped allowlist')
    query = urllib.parse.parse_qs(parsed.query)
    require(set(query) == {'token'} and len(query['token']) == 1, 'Unexpected signed URL query')
    return parsed


def stage(plan, approval):
    rows = approved_plan(plan, approval)
    # All local packages are revalidated before opening the signer. Fresh hashes
    # alone are insufficient evidence for an edited validation report.
    for row in rows:
        source = Path(row['archive'])
        require(0 < source.stat().st_size == row['size'] <= LIMIT and sha_file(source) == row['sha256'], 'Staged source changed after review')
    client, verified = connect(), []
    try:
        input_stream, output, error = start_remote(client, 'serve')
        input_stream.write(json.dumps({'plan': plan}) + '\n'); input_stream.flush()
        def request(payload):
            input_stream.write(json.dumps(payload) + '\n'); input_stream.flush()
            line = output.readline(100_000)
            require(bool(line), 'Server signer ended; no URL or service credential is logged')
            answer = json.loads(line)
            require(answer.get('ok') is True, answer.get('error', 'Signer rejected operation'))
            return answer
        for row in rows:
            for attempt in range(3):
                try:
                    with Path(row['archive']).open('rb') as source:
                        h = hashlib.sha256()
                        for chunk in iter(lambda: source.read(1_048_576), b''):
                            h.update(chunk)
                        require(source.tell() == row['size'] and h.hexdigest() == row['sha256'], 'Local archive changed before staging')
                        source.seek(0)
                        signed = request({'op': 'sign', 'path': row['new_path']})
                        if not signed['exists']:
                            url = checked_signed_url(signed['url'], row['new_path'])
                            connection = http.client.HTTPSConnection(url.hostname, timeout=180, context=ssl.create_default_context())
                            try:
                                connection.request('PUT', url.path + '?' + url.query, body=source, headers={'Content-Type': MIME, 'Content-Length': str(row['size']), 'x-upsert': 'false'})
                                response = connection.getresponse(); response.read(8192)
                                require(response.status in (200, 201, 400, 409), 'Signed upload HTTP ' + str(response.status))
                            finally:
                                connection.close()
                        request({'op': 'verify', 'path': row['new_path']})
                    verified.append({'id': row['id'], 'path': row['new_path'], 'sha256': row['sha256']})
                    print(json.dumps({'staged_verified': len(verified), 'total': len(rows)}), flush=True)
                    break
                except (OSError, http.client.HTTPException, ValueError):
                    if attempt == 2:
                        raise RuntimeError('Staging failed; immutable objects may remain, catalog unchanged') from None
                    time.sleep(2 ** attempt)
        input_stream.channel.shutdown_write()
        require(output.channel.recv_exit_status() == 0, 'Signer did not finish cleanly')
        return verified
    finally:
        client.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE / 'Packaged Apps - Android 11')
    parser.add_argument('--originals', type=Path, default=SOURCE / 'App Packages')
    parser.add_argument('--sdk', type=Path, default=SDK)
    parser.add_argument('--java', type=Path, default=JAVA)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--inventory', action='store_true', help='Read scoped live catalog; no uploads or catalog changes')
    parser.add_argument('--inventory-json', type=Path, help='Scoped inventory exported by main from the same server helper')
    parser.add_argument('--offline', action='store_true', help='With --inventory, save a blocked report without attempting SSH')
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--audit-report', type=Path, help='Save local SDK audit before contacting server')
    parser.add_argument('--reuse-audit', type=Path, help='Reuse a completed local audit after rechecking every source hash')
    parser.add_argument('--stage', action='store_true', help='Upload only after main approves the exact plan digest')
    parser.add_argument('--approved-plan-sha256')
    parser.add_argument('--publish', action='store_true', help='Reserved; publication belongs to main')
    parser.add_argument('--backup', type=Path)
    args = parser.parse_args(argv)
    require(not args.offline or (args.inventory and not args.stage and not args.inventory_json), '--offline requires inventory-only mode')
    if args.publish:
        require(args.backup is not None and args.backup.is_file(), '--publish requires an existing reviewed backup')
        raise ValueError('Catalog publication is intentionally disabled here; main owns the reviewed backup/SQL transaction')
    if args.stage:
        require(args.plan is not None, '--stage requires a reviewed plan')
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        approved_plan(plan, args.approved_plan_sha256)
        fresh = audit(args.source, args.originals, args.sdk, args.java, args.workers)
        expected = {r['folder']: r for r in plan['local']}
        require(canonical(fresh) == canonical([expected[r['folder']] for r in fresh]), 'Local package validation changed since main review')
        result = {'plan_sha256': plan['plan_sha256'], 'staged': stage(plan, args.approved_plan_sha256), 'catalog_changed': False}
    else:
        if args.reuse_audit:
            saved = json.loads(args.reuse_audit.read_text(encoding='utf-8'))
            require(saved['source'] == str(args.source.resolve()) and saved['originals'] == str(args.originals.resolve()) and saved['sdk'] == str(args.sdk.resolve()), 'Audit cache source/SDK differs')
            local = saved['local']
            require(saved['audit_sha256'] == hashlib.sha256(canonical(local)).hexdigest(), 'Audit cache was edited')
            for row in local:
                require((args.originals / row['folder']).resolve().parent == args.originals.resolve() and not (args.originals / row['folder']).is_symlink(), 'Cached folder escaped original source')
                base = regular(args.originals / row['folder'] / 'base.apk', args.originals / row['folder'])
                require(sha_file(base) == row.get('base_sha256'), 'Original base changed since audit')
                for part in row['parts']:
                    path = regular(base.parent / part['name'], base.parent)
                    require(path.stat().st_size == part['size'] and sha_file(path) == part['sha256'], 'Original split changed since audit')
                if row['status'] == 'validated':
                    require(validate_archive(args.source / archive_name(row['folder']), row['parts']) == {k: row[k] for k in ('archive', 'sha256', 'size')}, 'Archive changed since audit')
        else:
            local = audit(args.source, args.originals, args.sdk, args.java, args.workers)
        if args.audit_report:
            args.audit_report.parent.mkdir(parents=True, exist_ok=True)
            cached = {'source': str(args.source.resolve()), 'originals': str(args.originals.resolve()), 'sdk': str(args.sdk.resolve()), 'local': local, 'audit_sha256': hashlib.sha256(canonical(local)).hexdigest()}
            with args.audit_report.open('x', encoding='utf-8') as stream:
                json.dump(cached, stream, indent=2)
        print(json.dumps({'local_audit': dict(Counter(r['status'] for r in local)), 'next': 'read-only server inventory' if args.inventory else 'local report'}), flush=True)
        if args.inventory_json:
            require(not args.inventory, 'Choose live inventory or a main-exported inventory snapshot')
            result = build_plan(local, json.loads(args.inventory_json.read_text(encoding='utf-8')))
        elif args.inventory and args.offline:
            result = blocked_report(local, 'SSH port 22 is externally confirmed unavailable; this run made no connection attempt')
        elif args.inventory:
            try:
                result = build_plan(local, inventory_remote(local))
            except Exception as error:
                result = blocked_report(local, 'Read-only server inventory failed (' + type(error).__name__ + ')')
        else:
            result = {'local': local, 'counts': dict(Counter(r['status'] for r in local)), 'catalog_read': False}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open('x', encoding='utf-8') as stream:
            json.dump(result, stream, indent=2)
    print(json.dumps({'counts': result.get('counts'), 'plan_sha256': result.get('plan_sha256'), 'report': str(args.report) if args.report else None, 'catalog_changed': False}))
    return 2 if result.get('status') == 'blocked_inventory' else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'error': str(error), 'catalog_changed': False}), file=sys.stderr)
        sys.exit(1)
