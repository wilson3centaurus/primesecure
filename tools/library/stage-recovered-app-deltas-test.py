"""Offline only. No SSH connections, devices, storage or catalog mutations."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

spec = importlib.util.spec_from_file_location('delta', Path(__file__).with_name('stage-recovered-app-deltas.py'))
delta = importlib.util.module_from_spec(spec); spec.loader.exec_module(delta)
APP_ID = '11111111-1111-4111-8111-111111111111'
UPLOAD_ID = '22222222-2222-4222-8222-222222222222'
BASE, SPLIT = b'PK\0signed base apk\xff', b'PK\0unchanged split apk\xfe'
sha = lambda value: hashlib.sha256(value).hexdigest()


def plan_for(path):
    parts = [{'name': 'base.apk', 'size': len(BASE), 'sha256': sha(BASE)}, {'name': 'split_config.arm64_v8a.apk', 'size': len(SPLIT), 'sha256': sha(SPLIT)}]
    before = {'id': APP_ID, 'kind': 'app', 'school_id': None, 'package_name': 'test.app', 'storage_path': 'shared/' + UPLOAD_ID + '/old.apk', 'sha256': sha(BASE), 'verified_old_sha256': sha(BASE), 'verified_old_size': len(BASE)}
    local = {'folder': 'Example', 'status': 'validated', 'package': 'test.app', 'min_sdk': 24, 'size': path.stat().st_size, 'sha256': delta.digest(path)[1], 'base_sha256': sha(BASE), 'archive': str(path), 'parts': parts}
    row = {'id': APP_ID, 'folder': 'Example', 'status': 'ready', 'before': before, 'package': 'test.app', 'archive': str(path), 'old_path': before['storage_path'], 'new_path': 'shared/' + UPLOAD_ID + '/recovered-' + local['sha256'] + '.psapk', 'size': local['size'], 'sha256': local['sha256'], 'base_sha256': sha(BASE)}
    plan = {'school_id': delta.SCHOOL, 'inventory': {'school_count': 1}, 'local': [local], 'mapping': [row]}
    return seal(plan)


def seal(plan):
    plan.pop('plan_sha256', None); plan['plan_sha256'] = hashlib.sha256(delta.canonical(plan)).hexdigest(); return plan


def archive(path, compression=zipfile.ZIP_STORED, descriptor=False):
    class Pipe(io.BytesIO):
        def seekable(self): return False
        def seek(self, *args): raise io.UnsupportedOperation()
    stream = Pipe() if descriptor else None
    with zipfile.ZipFile(stream if stream is not None else path, 'w', compression=compression) as output:
        output.comment = b'Preserved ZIP footer comment'
        output.writestr('base.apk', BASE)
        output.writestr('split_config.arm64_v8a.apk', SPLIT)
    if stream is not None:
        path.write_bytes(stream.getvalue())


class DeltaTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name); self.source = self.root / 'approved.psapk'; archive(self.source)
        self.plan = plan_for(self.source); self.row = self.plan['mapping'][0]; self.parts = self.plan['local'][0]['parts']

    def paths(self):
        result = {}
        for name, data in [('base.apk', BASE), ('split_config.arm64_v8a.apk', SPLIT)]:
            path = self.root / name; path.write_bytes(data); result[name] = path
        return result

    def test_real_store_recipe_reconstructs_byte_identical_archive(self):
        delta.approved_rows(self.plan, self.plan['plan_sha256'])
        recipe = delta.recipe_for(self.row, self.parts)
        output = self.root / 'rebuilt.psapk'; delta.reconstruct(self.row, recipe, self.paths(), output)
        self.assertEqual(output.read_bytes(), self.source.read_bytes())
        self.assertEqual(delta.digest(output), (self.row['size'], self.row['sha256']))
        self.assertEqual(sum(p['size'] for p in recipe['parts'] if p['name'] != 'base.apk'), len(SPLIT))
        self.assertLess(sum(len(base64.b64decode(s['raw'])) for s in recipe['segments'] if 'raw' in s), delta.RAW_LIMIT)

    def test_streaming_data_descriptors_are_preserved_in_raw_ranges(self):
        archive(self.source, descriptor=True); plan = plan_for(self.source); row = plan['mapping'][0]
        recipe = delta.recipe_for(row, self.parts); output = self.root / 'descriptor-rebuilt.psapk'
        delta.reconstruct(row, recipe, self.paths(), output)
        self.assertEqual(output.read_bytes(), self.source.read_bytes())
        self.assertIn(b'PK\x07\x08', output.read_bytes())

    def test_wrong_approval_and_unsealed_edits_fail(self):
        for approval in [None, '', 'f' * 64]:
            with self.assertRaises(ValueError): delta.approved_rows(self.plan, approval)
        changed = copy.deepcopy(self.plan); changed['mapping'][0]['package'] = 'other.app'
        with self.assertRaises(ValueError): delta.approved_rows(changed, self.plan['plan_sha256'])

    def test_scope_paths_versions_and_unverified_base_cannot_be_resealed(self):
        for change in [lambda p: p.update(school_id='other'), lambda p: p['inventory'].update(school_count=2), lambda p: p['mapping'][0].update(new_path='shared/../other.psapk'), lambda p: p['mapping'][0]['before'].update(school_id='other'), lambda p: p['mapping'][0]['before'].update(verified_old_sha256='f' * 64), lambda p: p['local'][0].update(min_sdk=32), lambda p: p['local'][0]['parts'][1].update(name='../split.apk')]:
            changed = copy.deepcopy(self.plan); change(changed); seal(changed)
            with self.subTest(change=change), self.assertRaises(ValueError): delta.approved_rows(changed, changed['plan_sha256'])

    def test_compressed_or_changed_archive_is_rejected(self):
        archive(self.source, compression=zipfile.ZIP_DEFLATED)
        changed = plan_for(self.source)
        with self.assertRaisesRegex(ValueError, 'STORE'): delta.recipe_for(changed['mapping'][0], self.parts)
        archive(self.source)
        with self.source.open('ab') as output: output.write(b'extra')
        with self.assertRaises(ValueError): delta.recipe_for(self.row, self.parts)

    def test_local_central_filename_mismatch_is_rejected(self):
        payload = bytearray(self.source.read_bytes()); payload[30] = ord('z'); self.source.write_bytes(payload)
        changed = plan_for(self.source)
        with self.assertRaisesRegex(ValueError, 'filenames differ'): delta.recipe_for(changed['mapping'][0], self.parts)

    def test_bad_part_bytes_never_reconstruct_as_approved(self):
        recipe = delta.recipe_for(self.row, self.parts); paths = self.paths(); paths['base.apk'].write_bytes(b'wrong base')
        with self.assertRaisesRegex(ValueError, 'SHA differs'): delta.reconstruct(self.row, recipe, paths, self.root / 'bad.psapk')
        self.assertFalse((self.root / 'bad.psapk').exists())

    def test_recipe_tamper_duplicate_missing_and_extra_segments_fail(self):
        recipe = delta.recipe_for(self.row, self.parts)
        for mutate in [lambda r: r['parts'][1].update(name='../x.apk'), lambda r: r['parts'][1].update(sha256='f' * 64), lambda r: r['segments'].append({'part': 'base.apk'}), lambda r: r['segments'].append({'file': '/etc/passwd'}), lambda r: r['segments'].append({'raw': 'invalid@base64'}), lambda r: r['segments'].append({'raw': base64.b64encode(b'x' * (delta.RAW_LIMIT+1)).decode()})]:
            changed = copy.deepcopy(recipe); mutate(changed)
            with self.assertRaises((ValueError, TypeError)): delta.check_recipe(self.row, self.parts, changed)

    def test_same_length_header_tamper_fails_final_sha(self):
        recipe = delta.recipe_for(self.row, self.parts); raw = bytearray(base64.b64decode(recipe['segments'][0]['raw'])); raw[4] ^= 1
        recipe['segments'][0]['raw'] = base64.b64encode(raw).decode()
        delta.check_recipe(self.row, self.parts, recipe)
        with self.assertRaisesRegex(ValueError, 'approved SHA'): delta.reconstruct(self.row, recipe, self.paths(), self.root / 'tampered.psapk')

    def test_resume_prefix_is_checked_without_transferring_base(self):
        recipe = delta.recipe_for(self.row, self.parts)
        split = next(p for p in recipe['parts'] if p['name'] != 'base.apk')
        self.assertEqual(delta.digest(self.source, 5, split['offset']), (5, sha(SPLIT[:5])))
        self.assertNotEqual(delta.digest(self.source, 5, split['offset'])[1], sha(b'wrong'))
        self.assertEqual(delta.digest(self.source, 0, split['offset']), (0, sha(b'')))

    def test_reconstruction_is_exclusive_and_retains_existing_output(self):
        recipe = delta.recipe_for(self.row, self.parts); target = self.root / 'existing.psapk'; target.write_bytes(b'keep')
        with self.assertRaises(FileExistsError): delta.reconstruct(self.row, recipe, self.paths(), target)
        self.assertEqual(target.read_bytes(), b'keep')

    def test_prepare_cli_has_no_network_or_storage_calls(self):
        plan = self.root / 'plan.json'; plan.write_text(json.dumps(self.plan)); report = self.root / 'recipes.json'
        with patch.object(delta, 'connect', side_effect=AssertionError('No SSH allowed')), patch.object(delta, 'stream_store', side_effect=AssertionError('No storage allowed')), patch('builtins.print'):
            delta.main(['--plan', str(plan), '--approved-plan-sha256', self.plan['plan_sha256'], '--report', str(report)])
        result = json.loads(report.read_text()); self.assertEqual(result['split_upload_bytes'], len(SPLIT)); self.assertEqual(result['reused_base_bytes'], len(BASE)); self.assertFalse(result['catalog_changed'])

    def test_private_gateway_and_redirects_cannot_leak_server_credentials(self):
        self.assertEqual(delta.private_gateway('http://172.18.0.2:8000').hostname, '172.18.0.2')
        for address in ['https://example.org', 'http://8.8.8.8:8000', 'http://172.18.0.2:9000', 'http://secret@172.18.0.2:8000', 'http://172.18.0.2:8000/elsewhere']:
            with self.subTest(address=address), patch.object(delta.urllib.request, 'build_opener', side_effect=AssertionError('No request allowed')), self.assertRaises(ValueError):
                delta.read_store(address, 'server-only-key', self.row['old_path'])
        with self.assertRaisesRegex(ValueError, 'redirects'):
            delta.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.test')

    def cache(self):
        path = self.root / 'cached-recipes.json'
        path.write_text(json.dumps({'plan_sha256': self.plan['plan_sha256'], 'recipes': [delta.recipe_for(self.row, self.parts)]}))
        return path

    def test_cached_cli_fresh_hashes_whole_archive_once_without_inner_pass(self):
        cache = self.cache(); plan = self.root / 'plan.json'; plan.write_text(json.dumps(self.plan)); report = self.root / 'resumed.json'
        with patch.object(delta, 'digest', wraps=delta.digest) as hashes, patch.object(delta, 'recipe_for', side_effect=AssertionError('No inner preparation pass')), patch.object(delta, 'connect', side_effect=AssertionError('No SSH allowed')), patch('builtins.print'):
            delta.main(['--plan', str(plan), '--approved-plan-sha256', self.plan['plan_sha256'], '--recipes', str(cache), '--report', str(report)])
        self.assertEqual(hashes.call_args_list, [((self.source,), {})])
        self.assertEqual(json.loads(report.read_text())['recipes'], json.loads(cache.read_text())['recipes'])

    def test_cache_wrong_plan_missing_duplicate_and_bad_offsets_rejected(self):
        cache = self.cache(); original = json.loads(cache.read_text())
        for mutate in [lambda c: c.update(plan_sha256='f' * 64), lambda c: c.update(recipes=[]), lambda c: c['recipes'].append(c['recipes'][0]), lambda c: c['recipes'][0]['parts'][1].update(offset=-1), lambda c: c['recipes'][0]['parts'][1].update(offset=True), lambda c: c['recipes'][0]['parts'][1].update(offset=0)]:
            changed = copy.deepcopy(original); mutate(changed); cache.write_text(json.dumps(changed))
            with self.subTest(mutate=mutate), patch.object(delta, 'connect', side_effect=AssertionError('No SSH allowed')), self.assertRaises(delta.GuardError):
                delta.reuse_recipes(self.plan, [self.row], self.plan['plan_sha256'], cache)

    def test_cache_rehash_rejects_same_size_source_mutation(self):
        cache = self.cache(); content = bytearray(self.source.read_bytes()); content[-1] ^= 1; self.source.write_bytes(content)
        with self.assertRaisesRegex(delta.GuardError, 'hash differs'):
            delta.reuse_recipes(self.plan, [self.row], self.plan['plan_sha256'], cache)

    def test_cache_checks_every_archive_before_stage(self):
        cache = self.cache(); plan = copy.deepcopy(self.plan); second = copy.deepcopy(self.row)
        second['id'] = '33333333-3333-4333-8333-333333333333'; second['archive'] = str(self.root / 'missing.psapk')
        recipe = copy.deepcopy(json.loads(cache.read_text())['recipes'][0]); recipe['id'] = second['id']
        cached = json.loads(cache.read_text()); cached['recipes'].append(recipe); cache.write_text(json.dumps(cached))
        with patch('builtins.print'), patch.object(delta, 'digest', wraps=delta.digest) as hashes, self.assertRaisesRegex(delta.GuardError, 'missing/changed'):
            delta.reuse_recipes(plan, [self.row, second], self.plan['plan_sha256'], cache)
        self.assertEqual(hashes.call_count, 1)

    def test_internal_store_posts_exact_verified_archive_without_overwrite(self):
        expected = (self.row['size'], self.row['sha256']); helper = Mock(); helper.gateway.return_value = ('http://172.18.0.2:8000', 'server-only-key')
        connection = Mock(); connection.getresponse.return_value.status = 201
        before = copy.deepcopy(self.plan)
        with patch.object(delta, 'read_store', side_effect=[None, expected]), patch.object(delta.http.client, 'HTTPConnection', return_value=connection):
            delta.stream_store(helper, self.row, self.source)
        args, kwargs = connection.request.call_args
        self.assertEqual(args[0], 'POST'); self.assertIn(self.row['new_path'], args[1])
        self.assertEqual(kwargs['headers']['Content-Type'], delta.MIME)
        self.assertEqual(kwargs['headers']['Content-Length'], str(self.row['size']))
        self.assertEqual(kwargs['headers']['x-upsert'], 'false')
        self.assertEqual(kwargs['headers']['apikey'], 'server-only-key')
        connection.close.assert_called_once(); self.assertEqual(self.plan, before)

    def test_existing_immutable_object_is_verified_or_conflict_refused(self):
        expected = (self.row['size'], self.row['sha256']); helper = Mock(); helper.gateway.return_value = ('http://172.18.0.2:8000', 'server-only-key')
        with patch.object(delta, 'read_store', return_value=expected), patch.object(delta.http.client, 'HTTPConnection', side_effect=AssertionError('No replacement allowed')):
            delta.stream_store(helper, self.row, self.source)
        with patch.object(delta, 'read_store', return_value=(1, 'f' * 64)), patch.object(delta.http.client, 'HTTPConnection', side_effect=AssertionError('No overwrite allowed')), self.assertRaisesRegex(ValueError, 'Immutable'):
            delta.stream_store(helper, self.row, self.source)

    def test_post_status_alone_cannot_claim_success(self):
        helper = Mock(); helper.gateway.return_value = ('http://172.18.0.2:8000', 'server-only-key')
        for status in [201, 400, 409, 500]:
            connection = Mock(); connection.getresponse.return_value.status = status
            with self.subTest(status=status), patch.object(delta, 'read_store', side_effect=[None, None]), patch.object(delta.http.client, 'HTTPConnection', return_value=connection), self.assertRaises(ValueError):
                delta.stream_store(helper, self.row, self.source)

    def test_bad_recipe_batch_is_rejected_before_connecting(self):
        recipe = delta.recipe_for(self.row, self.parts)
        for batch in [[], [recipe, recipe]]:
            with patch.object(delta, 'connect', side_effect=AssertionError('No SSH allowed')), self.assertRaisesRegex(ValueError, 'batch'):
                delta.stage(self.plan, batch, self.plan['plan_sha256'])

    def test_store_read_checks_exact_source_identity_and_500mb_cap(self):
        response = Mock(); response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        response.headers = {'Content-Length': str(len(BASE))}; response.read.side_effect = [BASE, b'']
        opener = Mock(); opener.open.return_value = response
        with patch.object(delta.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(delta.read_store('http://172.18.0.2:8000', 'server-only-key', self.row['old_path'], expected=(len(BASE), sha(BASE))), (len(BASE), sha(BASE)))
        response.headers = {'Content-Length': '500000001'}
        with patch.object(delta.urllib.request, 'build_opener', return_value=opener), self.assertRaisesRegex(ValueError, 'cap'):
            delta.read_store('http://172.18.0.2:8000', 'server-only-key', self.row['old_path'])


if __name__ == '__main__': unittest.main()
