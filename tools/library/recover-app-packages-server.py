#!/usr/bin/env python3
"""Ephemeral SSH inventory/signer. Uses existing server storage_helpers only.

Executed with python -B -c over SSH, never installed as a service. Inventory is
SELECT-only. Serve issues allowlisted signed URLs and reads/verifies objects.
There is deliberately no catalog mutation or publication operation.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

SCHOOL = '14eea188-73b1-40bc-8f8d-15afbea27ffa'
BUCKET = 'primesecure-hub'
API = 'https://api.robokorda.duckdns.org'
LIMIT = 500_000_000
HEX = re.compile(r'[0-9a-f]{64}')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def emit(value):
    print(json.dumps(value), flush=True)


def input_json():
    line = sys.stdin.readline(48_000_001)
    require(bool(line) and len(line.encode()) <= 48_000_000 and line.endswith('\n'), 'Request exceeds bound or is incomplete')
    return json.loads(line)


def inventory(helper, query, verify=True):
    packages, hashes = query.get('packages', []), query.get('base_hashes', [])
    require(0 < len(packages) <= 100 and len(hashes) <= 100, 'Invalid inventory package count')
    require(all(isinstance(p, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+', p) for p in packages), 'Invalid inventory package')
    require(all(isinstance(h, str) and HEX.fullmatch(h) for h in hashes), 'Invalid inventory base hash')
    school, names, digests = helper.literal(SCHOOL), helper.literal(json.dumps(packages)), helper.literal(json.dumps(hashes))
    sql = f"""begin read only;
with selected as (
 select i.* from public.hub_items i where i.kind='app' and
 (i.school_id={school}::uuid or (i.school_id is null and
 (i.package_name in (select jsonb_array_elements_text({names}::jsonb)) or i.sha256 in (select jsonb_array_elements_text({digests}::jsonb)))))
)
select json_build_object(
 'school_id',{school},'school_name',(select name from public.schools where id={school}::uuid),
 'school_count',(select count(*) from public.schools),
 'items',(select coalesce(json_agg(i order by id),'[]'::json) from selected i),
 'access',(select coalesce(json_agg(a order by item_id,school_id),'[]'::json) from public.hub_access a where item_id in (select id from selected)),
 'defaults',(select coalesce(json_agg(d order by item_id,school_id),'[]'::json) from public.hub_app_defaults d where item_id in (select id from selected)),
 'bucket',(select json_build_object('private',not public,'limit',file_size_limit) from storage.buckets where id='primesecure-hub'));
commit;"""
    result = json.loads(helper.psql(sql))
    require(result['school_name'] == 'Rusununguko ZIMFEP High School' and result['school_count'] == 1, 'School scope changed; main review required')
    require(result['bucket']['private'] and result['bucket']['limit'] >= LIMIT, 'Private bucket / 500 MB limit check failed')
    require(len(result['items']) <= 1000, 'Catalog count exceeds bound')
    if verify:
        # Only matching original packages/hashes are read; unrelated standalone
        # catalog apps remain untouched and are not downloaded or reclassified.
        base, key = helper.gateway()
        for row in result['items']:
            if row.get('package_name') in packages or row.get('sha256') in hashes:
                try:
                    existing = read_hash(base, key, row['storage_path'])
                    if existing is not None:
                        row['verified_old_size'], row['verified_old_sha256'] = existing
                    else:
                        row['object_verification_error'] = 'Stored object missing'
                except (ValueError, OSError):
                    row['object_verification_error'] = 'Stored object could not be verified within source limits'
    return result


def read_hash(base, key, path):
    require(isinstance(path, str) and '\\' not in path and '..' not in path and not path.startswith('/'), 'Unsafe stored path')
    request = urllib.request.Request(base + '/storage/v1/object/authenticated/' + BUCKET + '/' + urllib.parse.quote(path, safe='/'), headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            require(int(response.headers.get('Content-Length', 0)) <= LIMIT, 'Stored object exceeds 500 MB')
            digest, size = hashlib.sha256(), 0
            for chunk in iter(lambda: response.read(1_048_576), b''):
                size += len(chunk); require(size <= LIMIT, 'Stored object exceeds 500 MB'); digest.update(chunk)
            return size, digest.hexdigest()
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
        raise ValueError('Storage read failed HTTP ' + str(error.code)) from None


def allowlist(plan, current):
    payload = dict(plan); expected = payload.pop('plan_sha256', None)
    require(expected is not None and hashlib.sha256(canonical(payload)).hexdigest() == expected, 'Changed plan')
    require(plan.get('school_id') == SCHOOL and current['school_count'] == 1, 'Invalid recovery scope')
    current_items = {row['id']: row for row in current['items']}
    old_inventory = plan['inventory']
    # Access/default drift is relevant to future enrollment and shared impact.
    require(current['access'] == old_inventory['access'] and current['defaults'] == old_inventory['defaults'], 'Access/default configuration changed after review')
    allowed = {}
    for row in plan['mapping']:
        if row['status'] != 'ready':
            continue
        candidates = [r for r in plan['local'] if r['folder'] == row['folder'] and r['status'] == 'validated']
        require(len(candidates) == 1 and candidates[0]['min_sdk'] <= 30, 'Missing validated Android 11 source')
        require(all(row[k] == candidates[0][k] for k in ('package', 'base_sha256', 'sha256', 'size', 'archive')), 'Mapping differs from validated source')
        require(row['id'] in current_items, 'Catalog app disappeared')
        existing, before = dict(current_items[row['id']]), dict(row['before'])
        for value in (existing, before):
            for name in ['verified_old_sha256', 'verified_old_size', 'object_verification_error']:
                value.pop(name, None)
        require(existing == before, 'Catalog app changed after review')
        require(existing['kind'] == 'app' and existing['school_id'] in (None, SCHOOL), 'Out-of-scope catalog app')
        require(existing['package_name'] == row['package'] and existing['sha256'] == row['base_sha256'], 'Package/base hash mismatch')
        require(HEX.fullmatch(row['sha256']) is not None and type(row['size']) is int and 0 < row['size'] <= LIMIT, 'Invalid staged object')
        prefix = existing['storage_path'].split('/')
        require(len(prefix) == 3 and prefix[0] == ('shared' if existing['school_id'] is None else SCHOOL), 'Wrong original path scope')
        require(str(uuid.UUID(prefix[1])) == prefix[1], 'Original path lacks UUID prefix')
        target = '/'.join(prefix[:2]) + '/recovered-' + row['sha256'] + '.psapk'
        require(row['new_path'] == target and target != existing['storage_path'] and target not in allowed, 'Staging path escaped immutable allowlist')
        allowed[target] = row
    require(1 <= len(allowed) <= 100, 'Invalid staging object count')
    return allowed


def serve(helper, plan):
    local = plan['local']
    query = {'packages': sorted({r['package'] for r in local if r.get('package')}), 'base_hashes': sorted({r['base_sha256'] for r in local if r.get('base_sha256')})}
    current = inventory(helper, query, verify=False)
    allowed = allowlist(plan, current)
    base, key = helper.gateway()
    # Verify the exact old stored bytes again before issuing any upload token.
    for row in allowed.values():
        require(read_hash(base, key, row['old_path']) == (row['before']['verified_old_size'], row['base_sha256']), 'Old object changed after review')
    for line in sys.stdin:
        require(len(line) <= 2048, 'Signer message too large')
        query = json.loads(line)
        row = allowed.get(query.get('path'))
        require(row is not None and query.get('op') in ('sign', 'verify'), 'Signer path/operation is not allowlisted')
        existing = read_hash(base, key, row['new_path'])
        require(existing is None or existing == (row['size'], row['sha256']), 'Immutable destination contains different bytes')
        if query['op'] == 'verify':
            require(existing == (row['size'], row['sha256']), 'Staged object verification failed')
            emit({'ok': True, 'verified': True})
        elif existing is not None:
            emit({'ok': True, 'exists': True})
        else:
            path = urllib.parse.quote(row['new_path'], safe='/')
            request = urllib.request.Request(base + '/storage/v1/object/upload/sign/' + BUCKET + '/' + path, data=b'{}', method='POST', headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=30) as response:
                signed = json.load(response)
            relative = signed['url']
            require(relative.startswith('/object/upload/sign/' + BUCKET + '/') and '\n' not in relative, 'Unexpected gateway signed URL')
            # Service credentials stay in this process; only a scoped upload URL
            # is returned over SSH, just before this individual upload begins.
            emit({'ok': True, 'exists': False, 'url': API + '/storage/v1' + relative})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['inventory', 'serve'], required=True)
    parser.add_argument('--helper', type=Path, required=True)
    args = parser.parse_args()
    require(str(args.helper) == '/root/primesecure-explore-stage/storage_helpers.py', 'Unreviewed server helper path')
    spec = importlib.util.spec_from_file_location('recovery_storage_helpers', args.helper)
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    require(helper.SCHOOL == SCHOOL and helper.BUCKET == BUCKET, 'Server helper scope differs')
    request = input_json()
    if args.mode == 'inventory':
        emit(inventory(helper, request))
    else:
        serve(helper, request['plan'])


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never echo request lines, signed tokens, Docker env or service keys.
        emit({'ok': False, 'error': 'Scoped recovery check failed; inspect current inventory and reviewed plan'})
        sys.exit(1)
