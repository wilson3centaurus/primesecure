"""Offline tests; no SSH, storage writes, catalog writes or device actions."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


tool = load('recover-app-packages')
server = load('recover-app-packages-server')
HASH = 'a' * 64
ARCHIVE_HASH = 'b' * 64
ID = '11111111-1111-4111-8111-111111111111'
PREFIX = '22222222-2222-4222-8222-222222222222'


def part(**changes):
    result = {'name': 'base.apk', 'package': 'test.app', 'version_code': '1', 'version_name': '1.0', 'split': '', 'min_sdk': 24, 'required_types': [], 'split_types': [], 'requires_splits': False, 'dependencies': [], 'config_for_split': '', 'size': 8, 'sha256': HASH, 'signers': ['c' * 64], 'libraries': {}}
    result.update(changes)
    return result


def local(**changes):
    result = {'folder': 'Original', 'status': 'validated', 'package': 'test.app', 'base_sha256': HASH, 'min_sdk': 24, 'sha256': ARCHIVE_HASH, 'size': 200, 'archive': 'C:/reviewed/app.psapk', 'parts': [part()]}
    result.update(changes)
    return result


def item(**changes):
    result = {'id': ID, 'title': 'Untrusted display title', 'kind': 'app', 'package_name': 'test.app', 'school_id': None, 'storage_path': 'shared/' + PREFIX + '/old.apk', 'sha256': HASH, 'size': 8, 'verified_old_sha256': HASH, 'verified_old_size': 8, 'preinstall': True, 'published': True}
    result.update(changes)
    return result


def inventory(items=None):
    return {'school_id': tool.SCHOOL, 'school_name': 'Rusununguko ZIMFEP High School', 'school_count': 1, 'items': items if items is not None else [item()], 'access': [{'item_id': ID, 'school_id': tool.SCHOOL}], 'defaults': [{'item_id': ID, 'school_id': tool.SCHOOL}]}


class RecoveryTests(unittest.TestCase):
    def test_archive_name_matches_original_packager(self):
        self.assertEqual(tool.archive_name('Riddles_&_Brain_Teasers'), 'Riddles___Brain_Teasers.psapk')
        self.assertEqual(tool.archive_name('Color Sort!'), 'Color_Sort_.psapk')

    def test_sdk37_signer_format_excludes_source_stamp(self):
        for prefix in ['Signer #1', 'V3.0 Signer:', 'V2 Signer #1:']:
            text = prefix + ' certificate SHA-256 digest: ' + HASH + '\nSource Stamp Signer: certificate SHA-256 digest: ' + ARCHIVE_HASH + '\n'
            self.assertEqual(tool.signer_digests(text), [HASH])
        with self.assertRaises(ValueError):
            tool.signer_digests('Source Stamp Signer: certificate SHA-256 digest: ' + HASH)

    def test_manifest_namespaces_and_required_flags(self):
        text = '''N: android=http://schemas.android.com/apk/res/android
N: attacker=urn:untrusted
  E: manifest (line=1)
    A: package="test.app" (Raw: "test.app")
    A: android:versionCode(0x0101021b)=(type 0x10)0x1
    A: android:requiredSplitTypes(0x0101064e)="base__abi,base__density"
    A: android:isSplitRequired(0x01010591)=(type 0x12)0xffffffff
    E: uses-sdk (line=2)
      A: android:minSdkVersion(0x0101020c)=(type 0x10)0x20
      A: attacker:minSdkVersion=(type 0x10)0x1
    E: application (line=3)
'''
        result = tool.manifest_part(text, 'base.apk')
        self.assertEqual(result['min_sdk'], 32)
        self.assertEqual(result['required_types'], ['base__abi', 'base__density'])
        self.assertTrue(result['requires_splits'])
        for invalid in [text.replace('0x20', '"Vanilla"'), text.replace('package="test.app"', 'package="../app"'), text + '    E: uses-sdk (line=4)\n']:
            with self.assertRaises(ValueError):
                tool.manifest_part(invalid, 'base.apk')

    def test_complete_parts_and_arm_abi(self):
        base = part(required_types=['base__abi'], requires_splits=True)
        split = part(name='split.apk', split='config.arm64_v8a', split_types=['base__abi'], libraries={'arm64-v8a': ['libapp.so']})
        result = tool.validate_parts([base, split])
        self.assertEqual(result['compatible_abis'], ['arm64-v8a'])
        self.assertEqual(result['base_sha256'], HASH)
        self.assertEqual(tool.validate_parts([part(min_sdk=32)])['min_sdk'], 32)
        self.assertEqual(tool.validate_parts([part()])['compatible_abis'], list(tool.ABIS))

    def test_identity_signature_version_dependencies_and_bounds(self):
        base = part()
        split = part(name='split.apk', split='config.en')
        cases = [[], [base, part()], [base, {**split, 'package': 'other.app'}], [base, {**split, 'version_code': '2'}], [base, {**split, 'signers': ['d' * 64]}], [base, {**split, 'dependencies': ['missing']}], [base, {**split, 'config_for_split': 'missing'}], [part(requires_splits=True)], [part(required_types=['base__density'])], [part(name='../base.apk')], [part(size=tool.LIMIT + 1)], [base] * 101]
        for parts in cases:
            with self.subTest(parts=parts), self.assertRaises(ValueError):
                tool.validate_parts(parts)
        cycle = [base, part(name='a.apk', split='a', dependencies=['b']), part(name='b.apk', split='b', dependencies=['a'])]
        with self.assertRaisesRegex(ValueError, 'Cyclic'):
            tool.validate_parts(cycle)

    def test_arm_library_completeness(self):
        for libraries in [{'x86_64': ['app.so']}, {'arm64-v8a': ['a.so'], 'x86_64': ['a.so', 'b.so']}]:
            with self.assertRaisesRegex(ValueError, 'ABI'):
                tool.validate_parts([part(libraries=libraries)])
        self.assertEqual(tool.validate_parts([part(libraries={'armeabi-v7a': ['a.so'], 'x86': ['a.so']})])['compatible_abis'], ['armeabi-v7a'])

    def test_real_archive_preserves_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.psapk'
            data = b'APK\0\xffPK123'
            parts = [part(size=len(data), sha256=hashlib.sha256(data).hexdigest())]
            with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
                archive.writestr('base.apk', data)
            result = tool.validate_archive(path, parts)
            self.assertEqual(result['sha256'], tool.sha_file(path))
            self.assertEqual(result['size'], path.stat().st_size)
            for name, compression, payload in [('base.apk', zipfile.ZIP_DEFLATED, data), ('../base.apk', zipfile.ZIP_STORED, data), ('base.apk', zipfile.ZIP_STORED, b'different')]:
                with zipfile.ZipFile(path, 'w', compression=compression) as archive:
                    archive.writestr(name, payload)
                with self.assertRaises(ValueError):
                    tool.validate_archive(path, parts)

    def test_matching_uses_package_and_verified_base_hash_never_title(self):
        before = inventory()
        plan = tool.build_plan([local()], before)
        row = plan['mapping'][0]
        self.assertEqual(row['status'], 'ready')
        self.assertEqual(row['new_path'], 'shared/' + PREFIX + '/recovered-' + ARCHIVE_HASH + '.psapk')
        self.assertEqual(row['id'], ID)
        self.assertEqual(row['before'], before['items'][0])
        self.assertTrue(row['before']['preinstall'])
        self.assertEqual(tool.approved_plan(plan, plan['plan_sha256']), [row])
        for mismatch in [item(package_name='other.app'), item(sha256='e' * 64), item(verified_old_sha256='e' * 64), item(verified_old_size=9)]:
            status = tool.build_plan([local()], inventory([mismatch]))['mapping'][0]['status']
            self.assertTrue(status.startswith('quarantined_'))

    def test_duplicate_math_games_duolingo_quarantined_even_if_titles_differ(self):
        rows = [item(title='Math Games'), item(id='33333333-3333-4333-8333-333333333333', title='Duolingo')]
        plan = tool.build_plan([local(min_sdk=32, status='excluded_min_sdk')], inventory(rows))
        self.assertEqual([r['status'] for r in plan['mapping']], ['quarantined_duplicate_catalog'] * 2)
        self.assertEqual([r['min_sdk'] for r in plan['mapping']], [32, 32])
        self.assertTrue(all(r['local_status'] == 'excluded_min_sdk' for r in plan['mapping']))
        self.assertEqual(plan['counts']['ready_bytes'], 0)

    def test_exclusions_unmatched_and_other_school_safety(self):
        self.assertEqual(tool.build_plan([local(status='excluded_min_sdk', min_sdk=32)], inventory())['mapping'][0]['status'], 'excluded_min_sdk')
        untouched = item(package_name='other.standalone', sha256='d' * 64)
        self.assertEqual(tool.build_plan([local()], inventory([untouched]))['mapping'][0]['status'], 'unmatched_untouched')
        with self.assertRaises(ValueError):
            tool.build_plan([local()], inventory([item(school_id='other-school')]))
        multiple = inventory(); multiple['school_count'] = 2
        with self.assertRaises(ValueError):
            tool.build_plan([local()], multiple)

    def test_path_prefix_quarantine_and_local_ambiguity(self):
        for path in ['shared/explore/old.apk', 'shared/' + PREFIX + '/folder/old.apk', tool.SCHOOL + '/' + PREFIX + '/old.apk', 'shared/' + PREFIX + '/../old.apk']:
            self.assertEqual(tool.build_plan([local()], inventory([item(storage_path=path)]))['mapping'][0]['status'], 'quarantined_path')
        self.assertEqual(tool.build_plan([local(), local(folder='Copy')], inventory())['mapping'][0]['status'], 'quarantined_duplicate_local')

    def test_staging_requires_exact_approval_and_plan_integrity(self):
        plan = tool.build_plan([local()], inventory())
        for approval in [None, '', 'a' * 64]:
            with self.assertRaises(ValueError):
                tool.approved_plan(plan, approval)
        tampered = copy.deepcopy(plan); tampered['mapping'][0]['new_path'] = 'shared/escape.psapk'
        with self.assertRaises(ValueError):
            tool.approved_plan(tampered, plan['plan_sha256'])
        with patch.object(tool, 'connect', side_effect=AssertionError('Must not contact server')):
            with self.assertRaises(ValueError):
                tool.stage(plan, None)
        replaced = copy.deepcopy(plan); replaced['mapping'][0]['archive'] = 'C:/unrelated/private.key'
        replaced.pop('plan_sha256'); replaced['plan_sha256'] = hashlib.sha256(tool.canonical(replaced)).hexdigest()
        with self.assertRaisesRegex(ValueError, 'validated local source'):
            tool.approved_plan(replaced, replaced['plan_sha256'])
        with self.assertRaisesRegex(ValueError, 'validated source'):
            server.allowlist(replaced, inventory())

    def test_signer_allowlist_and_baseline_drift(self):
        current = inventory()
        plan = tool.build_plan([local()], current)
        allowed = server.allowlist(plan, current)
        self.assertEqual(list(allowed), [plan['mapping'][0]['new_path']])
        for mutate in [lambda value: value['items'][0].update(title='changed'), lambda value: value['defaults'].clear(), lambda value: value.update(school_count=2)]:
            changed = copy.deepcopy(current); mutate(changed)
            with self.assertRaises(ValueError):
                server.allowlist(plan, changed)
        changed = copy.deepcopy(plan); changed['mapping'][0]['new_path'] = 'shared/elsewhere/recovered.psapk'
        changed.pop('plan_sha256'); changed['plan_sha256'] = hashlib.sha256(tool.canonical(changed)).hexdigest()
        with self.assertRaises(ValueError):
            server.allowlist(changed, current)

    def test_signed_url_restricts_origin_path_and_token(self):
        path = 'shared/' + PREFIX + '/recovered-' + ARCHIVE_HASH + '.psapk'
        valid = tool.API + '/storage/v1/object/upload/sign/' + tool.BUCKET + '/' + path + '?token=short-lived'
        tool.checked_signed_url(valid, path)
        for bad in [valid.replace('https:', 'http:'), valid.replace('api.robokorda.duckdns.org', 'attacker.example'), valid + '&redirect=x', valid.replace(path, 'shared/other.psapk')]:
            with self.assertRaises(ValueError):
                tool.checked_signed_url(bad, path)

    def test_publish_is_disabled_even_with_backup(self):
        with self.assertRaisesRegex(ValueError, 'backup'):
            tool.main(['--publish'])
        with tempfile.NamedTemporaryFile() as backup:
            with self.assertRaisesRegex(ValueError, 'disabled'):
                tool.main(['--publish', '--backup', backup.name])

    def test_inventory_failure_saves_blocked_report_without_stage_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'blocked-plan.json'
            with patch.object(tool, 'audit', return_value=[local()]), patch.object(tool, 'inventory_remote', side_effect=TimeoutError()), patch('builtins.print'):
                self.assertEqual(tool.main(['--inventory', '--report', str(path)]), 2)
            result = json.loads(path.read_text())
            self.assertEqual(result['status'], 'blocked_inventory')
            self.assertIsNone(result['plan_sha256'])
            self.assertFalse(result['stageable'])
            self.assertEqual(result['mapping'], [])
            with self.assertRaises(ValueError):
                tool.approved_plan(result, result['audit_sha256'])

    def test_offline_inventory_never_attempts_ssh(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'blocked-plan.json'
            with patch.object(tool, 'audit', return_value=[local()]), patch.object(tool, 'connect', side_effect=AssertionError('No SSH permitted')), patch('builtins.print'):
                self.assertEqual(tool.main(['--inventory', '--offline', '--report', str(path)]), 2)
            self.assertFalse(json.loads(path.read_text())['stageable'])


if __name__ == '__main__':
    unittest.main()
