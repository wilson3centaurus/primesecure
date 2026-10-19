"""Offline publisher contracts: mocked server helper/psql/storage, temporary backups.

Run: python -B tools/library/publish-recovered-apps-test.py -v
SQL assertions inspect emitted statements; they do not execute PostgreSQL or prove
live lock/rollback behavior. All plans and object bytes here are synthetic.
"""
import copy
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.parse
import urllib.request


SPEC = importlib.util.spec_from_file_location(
    'recovered_publisher', Path(__file__).with_name('publish-recovered-apps.py'))
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)

VERIFICATION_FIELDS = ('verified_old_size', 'verified_old_sha256', 'object_verification_error')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def seal(plan):
    plan.pop('plan_sha256', None)
    plan['plan_sha256'] = sha(publisher.canonical(plan))
    return plan


def batch(ready_count=2, unsafe_count=3):
    """Include both scopes, every unsafe category and an unrelated untouched row."""
    inventory = {'school_count': 1, 'items': [], 'access': [], 'defaults': []}
    plan = {'school_id': publisher.SCHOOL, 'inventory': inventory, 'mapping': []}
    objects = {}
    statuses = ('excluded_min_sdk', 'quarantined_duplicate_catalog', 'invalid')
    for number in range(ready_count + unsafe_count + 1):
        identity = f'00000000-0000-4000-8000-{number + 1:012d}'
        scope = 'shared' if number % 2 == 0 else 'school'
        prefix = 'shared' if scope == 'shared' else publisher.SCHOOL
        old = f'{prefix}/{identity}/original.apk'
        item = dict(id=identity, kind='app', school_id=None if scope == 'shared' else publisher.SCHOOL,
                    title="Student's app — café\nreviewed", package_name=f'offline.app{number}',
                    storage_path=old, mime_type='application/vnd.android.package-archive',
                    size=10 + number, sha256=sha(f'original-{number}'.encode()),
                    published=number % 2 == 1, preinstall=number % 2 == 0,
                    created_at='2026-10-18T00:00:00+00:00', metadata={'keep': number})
        # Published unsafe fixtures make withdrawal observable.
        if ready_count <= number < ready_count + unsafe_count:
            item['published'] = True
        item.update(verified_old_size=item['size'], verified_old_sha256=item['sha256'],
                    object_verification_error=None)
        inventory['items'].append(item)
        inventory['access'].append(dict(item_id=identity, school_id=publisher.SCHOOL, enabled=number % 2 == 0))
        inventory['defaults'].append(dict(item_id=identity, school_id=publisher.SCHOOL, preinstall=number % 2 == 1))
        row = dict(id=identity, scope=scope, old_path=old)
        if number < ready_count:
            payload = (b'PK\0synthetic staged archive\xff' + str(number).encode())
            if number == 0:
                payload += b'x' * 1048576  # Exercise more than one hash/read chunk.
            path = f'{prefix}/{identity}/recovered-{sha(payload)}.psapk'
            row.update(status='ready', new_path=path, size=len(payload), sha256=sha(payload))
            objects[path] = payload
        elif number < ready_count + unsafe_count:
            row['status'] = statuses[(number - ready_count) % len(statuses)]
        else:
            row['status'] = 'unmatched_untouched'
        plan['mapping'].append(row)
    return seal(plan), objects


def snapshots(plan):
    affected = {row['id'] for row in plan['mapping'] if row['status'] != 'unmatched_untouched'}
    before = copy.deepcopy(plan['inventory'])
    # Current server identity is new snapshot evidence, not a frozen-plan field.
    before['school_id'] = publisher.SCHOOL
    before['items'] = [item for item in before['items'] if item['id'] in affected]
    for item in before['items']:
        for field in VERIFICATION_FIELDS:
            item.pop(field, None)
    for name in ('access', 'defaults'):
        before[name] = [row for row in before[name] if row['item_id'] in affected]
    after = copy.deepcopy(before)
    by_id = {item['id']: item for item in after['items']}
    for row in plan['mapping']:
        if row['status'] == 'ready':
            by_id[row['id']].update(storage_path=row['new_path'], mime_type=publisher.MIME,
                                    size=row['size'], sha256=row['sha256'])
        elif row['id'] in affected:
            by_id[row['id']]['published'] = False
    return before, after


class OfflineRun:
    """Only the publisher's entry point runs; every external dependency is replaced."""
    def __init__(self, root, plan, objects):
        self.root, self.plan, self.objects = root, plan, copy.deepcopy(objects)
        self.before, self.after = snapshots(plan)
        self.events, self.statements = [], []
        self.transaction_error = None
        self.snapshot_reads = 0
        self.output = io.StringIO()
        self.helper = SimpleNamespace(literal=Mock(side_effect=literal), psql=Mock(side_effect=self.psql),
                                      gateway=Mock(return_value=('http://storage.invalid:8000', 'offline-only-key')))
        self.loader = Mock()
        self.spec = SimpleNamespace(loader=self.loader)
        self.load_spec = Mock(return_value=self.spec)
        self.load_module = Mock(return_value=self.helper)
        self.urlopen = Mock(side_effect=self.read_object)
        self.paths = Mock(side_effect=self.backup_path)

    def backup_path(self, path):
        if path != '/root/primesecure-backups':
            raise AssertionError(f'Unexpected filesystem destination: {path}')
        return self.root

    def backups(self):
        return list(self.root.iterdir())

    def psql(self, sql):
        self.statements.append(sql)
        if sql.lstrip().startswith('select jsonb_build_object('):
            self.events.append('snapshot')
            self.snapshot_reads += 1
            if self.snapshot_reads > 2:
                raise AssertionError('Unexpected extra catalog read')
            return json.dumps(self.before if self.snapshot_reads == 1 else self.after)
        if not sql.startswith('begin;'):
            raise AssertionError('Unexpected SQL statement')
        self.events.append('transaction')
        directories = self.backups()
        if len(directories) != 1:
            raise AssertionError('Backup must exist before transaction submission')
        directory = directories[0]
        if json.loads((directory / 'before.json').read_text(encoding='utf-8')) != self.before:
            raise AssertionError('Full pre-publication snapshot was not backed up')
        if json.loads((directory / 'reviewed-plan.json').read_text(encoding='utf-8')) != self.plan:
            raise AssertionError('Exact frozen plan was not backed up')
        if (directory / 'result.json').exists():
            raise AssertionError('Success recorded before transaction completed')
        if self.transaction_error:
            raise RuntimeError(self.transaction_error)
        return ''

    def read_object(self, request, timeout):
        prefix = 'http://storage.invalid:8000/storage/v1/object/authenticated/primesecure-hub/'
        if request.get_method() != 'GET' or not request.full_url.startswith(prefix):
            raise AssertionError('Only private staged-object reads are allowed')
        path = urllib.parse.unquote(request.full_url[len(prefix):])
        if path not in self.objects or timeout != 180:
            raise AssertionError('Unreviewed storage object requested')
        self.events.append('storage:' + path)
        return io.BytesIO(self.objects[path])

    def publish(self, approval):
        with ExitStack() as stack:
            stack.enter_context(patch.object(publisher.importlib.util, 'spec_from_file_location', self.load_spec))
            stack.enter_context(patch.object(publisher.importlib.util, 'module_from_spec', self.load_module))
            stack.enter_context(patch.object(publisher, 'Path', self.paths))
            stack.enter_context(patch.object(urllib.request, 'urlopen', self.urlopen))
            stack.enter_context(patch('sys.stdout', self.output))
            publisher.publish(self.plan, approval)

    def transaction(self):
        return next(sql for sql in self.statements if sql.startswith('begin;'))


class PublisherTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='offline-recovered-publisher-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        # Fail closed if a future publisher bypasses the mocked helper or URL reader.
        for target in ('socket.socket.connect', 'socket.socket.connect_ex', 'socket.create_connection',
                       'socket.getaddrinfo',
                       'subprocess.Popen', 'os.system'):
            guard = patch(target, side_effect=AssertionError('Offline test: external I/O forbidden'))
            guard.start()
            self.addCleanup(guard.stop)
        ssh = SimpleNamespace(SSHClient=Mock(side_effect=AssertionError('Offline test: SSH forbidden')))
        guard = patch.dict('sys.modules', paramiko=ssh)
        guard.start()
        self.addCleanup(guard.stop)
        self.runs = 0

    def run_for(self, plan=None, objects=None):
        if plan is None:
            plan, objects = batch()
        self.runs += 1
        root = self.root / str(self.runs)
        root.mkdir()
        return OfflineRun(root, plan, objects)

    def assert_no_side_effects(self, run, helper_loaded=False, snapshot_reads=0):
        if not helper_loaded:
            run.load_spec.assert_not_called()
            run.load_module.assert_not_called()
            run.loader.exec_module.assert_not_called()
        self.assertEqual(snapshot_reads, run.helper.psql.call_count)
        self.assertFalse(any(sql.startswith('begin;') for sql in run.statements))
        run.helper.gateway.assert_not_called()
        run.urlopen.assert_not_called()
        run.paths.assert_not_called()
        self.assertEqual([], run.backups())
        self.assertEqual('', run.output.getvalue())

    def test_exact_approval_digest_rejects_before_helper_catalog_storage_or_backup(self):
        plan, objects = batch()
        for approval in (None, '', 'f' * 64, plan['plan_sha256'].upper()):
            with self.subTest(approval=approval):
                run = self.run_for(copy.deepcopy(plan), objects)
                with self.assertRaisesRegex(RuntimeError, 'Plan digest changed'):
                    run.publish(approval)
                self.assert_no_side_effects(run)

    def test_tampered_mapping_inventory_and_self_consistent_reseal_need_exact_approval(self):
        plan, objects = batch()
        approval = plan['plan_sha256']
        for change in ('mapping', 'inventory', 'resealed', 'missing_digest'):
            with self.subTest(change=change):
                changed = copy.deepcopy(plan)
                if change == 'inventory':
                    default = changed['inventory']['defaults'][0]
                    default['preinstall'] = not default['preinstall']
                elif change == 'missing_digest':
                    changed.pop('plan_sha256')
                else:
                    changed['mapping'][0]['new_path'] += '.tampered'
                    if change == 'resealed':
                        seal(changed)
                run = self.run_for(changed, objects)
                with self.assertRaisesRegex(RuntimeError, 'Plan digest changed'):
                    run.publish(approval)
                self.assert_no_side_effects(run)

    def test_school_and_inventory_school_count_reject_even_with_matching_digest(self):
        for field, value in (('school_id', '00000000-0000-4000-8000-999999999999'),
                             ('school_count', 0), ('school_count', 2)):
            with self.subTest(field=field, value=value):
                plan, objects = batch()
                (plan if field == 'school_id' else plan['inventory'])[field] = value
                seal(plan)
                run = self.run_for(plan, objects)
                with self.assertRaisesRegex(RuntimeError, 'School scope changed'):
                    run.publish(plan['plan_sha256'])
                self.assert_no_side_effects(run)

    def test_live_school_count_drift_stops_before_storage_or_backup(self):
        for count in (0, 2):
            with self.subTest(count=count):
                run = self.run_for()
                run.before['school_count'] = count
                with self.assertRaisesRegex(RuntimeError, 'Other schools now exist'):
                    run.publish(run.plan['plan_sha256'])
                self.assert_no_side_effects(run, helper_loaded=True, snapshot_reads=1)

    def test_live_sole_school_missing_null_or_replaced_id_stops_before_storage_or_backup(self):
        for identity in ('missing', None, '00000000-0000-4000-8000-999999999999'):
            with self.subTest(identity=identity):
                run = self.run_for()
                self.assertEqual(1, run.before['school_count'])
                if identity == 'missing':
                    run.before.pop('school_id')
                else:
                    run.before['school_id'] = identity
                with self.assertRaisesRegex(RuntimeError, 'School identity changed; stop for review'):
                    run.publish(run.plan['plan_sha256'])
                self.assert_no_side_effects(run, helper_loaded=True, snapshot_reads=1)

    def test_any_catalog_field_missing_row_or_extra_row_drift_blocks_publication(self):
        for change in ('title', 'published', 'preinstall', 'storage_path', 'metadata', 'missing', 'extra'):
            with self.subTest(change=change):
                run = self.run_for()
                item = run.before['items'][0]
                if change == 'missing':
                    run.before['items'].pop()
                elif change == 'extra':
                    extra = copy.deepcopy(item)
                    extra['id'] = '00000000-0000-4000-8000-999999999999'
                    run.before['items'].append(extra)
                elif change in ('published', 'preinstall'):
                    item[change] = not item[change]
                else:
                    item[change] = 'changed'
                with self.assertRaisesRegex(RuntimeError, 'Affected catalog changed after review'):
                    run.publish(run.plan['plan_sha256'])
                self.assert_no_side_effects(run, helper_loaded=True, snapshot_reads=1)

    def test_access_and_default_added_removed_or_modified_rows_block_publication(self):
        for name in ('access', 'defaults'):
            for change in ('added', 'removed', 'modified'):
                with self.subTest(name=name, change=change):
                    run = self.run_for()
                    if change == 'added':
                        run.before[name].append(copy.deepcopy(run.before[name][0]))
                    elif change == 'removed':
                        run.before[name].pop()
                    else:
                        run.before[name][0]['school_id'] = '00000000-0000-4000-8000-999999999999'
                    with self.assertRaisesRegex(RuntimeError, name + ' changed after review'):
                        run.publish(run.plan['plan_sha256'])
                    self.assert_no_side_effects(run, helper_loaded=True, snapshot_reads=1)

    def test_staged_hash_and_size_mismatch_even_on_last_object_never_submit_transaction(self):
        for change in ('hash', 'truncated', 'oversize', 'missing'):
            with self.subTest(change=change):
                run = self.run_for()
                path = run.plan['mapping'][1]['new_path']
                original = run.objects[path]
                if change == 'hash':
                    run.objects[path] = bytes([original[0] ^ 1]) + original[1:]
                elif change == 'truncated':
                    run.objects[path] = original[:-1]
                elif change == 'oversize':
                    run.objects[path] += b'extra'
                else:
                    run.urlopen.side_effect = [io.BytesIO(run.objects[run.plan['mapping'][0]['new_path']]),
                                               FileNotFoundError('Synthetic missing staged object')]
                with self.assertRaises((RuntimeError, FileNotFoundError)) as error:
                    run.publish(run.plan['plan_sha256'])
                if change != 'missing':
                    self.assertEqual('Staged bytes differ from reviewed plan', str(error.exception))
                self.assertEqual(1, run.helper.psql.call_count)
                self.assertEqual(2, run.urlopen.call_count)
                run.paths.assert_not_called()
                self.assertEqual([], run.backups())
                self.assertEqual('', run.output.getvalue())

    def test_backup_failure_prevents_transaction_submission(self):
        run = self.run_for()
        with patch.object(Path, 'write_text', side_effect=OSError('Synthetic backup failure')):
            with self.assertRaisesRegex(OSError, 'backup failure'):
                run.publish(run.plan['plan_sha256'])
        self.assertEqual(1, run.helper.psql.call_count)
        self.assertEqual(1, len(run.backups()))
        self.assertEqual([], list(run.backups()[0].iterdir()))
        self.assertEqual('', run.output.getvalue())

    def test_duplicate_identity_or_unexpected_batch_count_blocks_catalog_and_storage(self):
        for change in ('duplicate', 'no_ready', 'too_many_ready', 'too_many_affected'):
            with self.subTest(change=change):
                plan, objects = batch()
                if change == 'duplicate':
                    plan['mapping'][1]['id'] = plan['mapping'][0]['id']
                elif change == 'no_ready':
                    for row in plan['mapping'][:2]:
                        row['status'] = 'invalid'
                elif change == 'too_many_ready':
                    plan, objects = batch(101, 0)
                else:
                    plan, objects = batch(100, 51)
                seal(plan)
                run = self.run_for(plan, objects)
                message = 'Duplicate repair identity' if change == 'duplicate' else 'Unexpected repair count'
                with self.assertRaisesRegex(RuntimeError, message):
                    run.publish(plan['plan_sha256'])
                self.assert_no_side_effects(run, helper_loaded=True)

    def test_unsafe_staged_paths_are_rejected_before_object_read_or_transaction(self):
        for path in ('other-school/staged.psapk', 'shared/../staged.psapk', 'shared/staged.apk'):
            with self.subTest(path=path):
                plan, objects = batch()
                plan['mapping'][0]['new_path'] = path
                seal(plan)
                run = self.run_for(plan, objects)
                with self.assertRaisesRegex(RuntimeError, 'Unsafe staged path'):
                    run.publish(plan['plan_sha256'])
                self.assertEqual(1, run.helper.psql.call_count)
                run.urlopen.assert_not_called()
                run.paths.assert_not_called()
                self.assertEqual([], run.backups())
                self.assertEqual('', run.output.getvalue())

    def test_transaction_guard_error_keeps_backup_without_success_or_post_read(self):
        for message in ('School scope changed; recovery stopped', 'Catalog drift; recovery stopped',
                        'Access/default drift; recovery stopped'):
            with self.subTest(message=message):
                run = self.run_for()
                run.transaction_error = message
                with self.assertRaisesRegex(RuntimeError, re.escape(message)):
                    run.publish(run.plan['plan_sha256'])
                self.assertEqual(2, run.helper.psql.call_count)
                self.assertEqual({'before.json', 'reviewed-plan.json'},
                                 {path.name for path in run.backups()[0].iterdir()})
                self.assertEqual('', run.output.getvalue())

    def test_transaction_timeouts_are_local_and_precede_all_lock_acquisition(self):
        run = self.run_for()
        run.publish(run.plan['plan_sha256'])
        statements = run.transaction().splitlines()
        self.assertEqual(["set local lock_timeout='5s';", "set local statement_timeout='60s';",
                          "set local idle_in_transaction_session_timeout='60s';"], statements[1:4])
        self.assertIn('pg_advisory_xact_lock(', statements[4])
        self.assertTrue(all('lock ' not in sql and 'update ' not in sql for sql in statements[1:4]))
        self.assertNotIn('set local', run.statements[0])
        self.assertNotIn('set local', run.statements[-1])

    def test_transaction_timeout_failures_keep_backups_and_never_emit_success(self):
        for message in ('canceling statement due to lock timeout',
                        'canceling statement due to statement timeout',
                        'terminating connection due to idle-in-transaction timeout'):
            with self.subTest(message=message):
                run = self.run_for()
                run.transaction_error = message
                with self.assertRaisesRegex(RuntimeError, re.escape(message)):
                    run.publish(run.plan['plan_sha256'])
                self.assertEqual(2, run.helper.psql.call_count)
                self.assertEqual({'before.json', 'reviewed-plan.json'},
                                 {path.name for path in run.backups()[0].iterdir()})
                self.assertEqual('', run.output.getvalue())

    def assert_transaction_contract(self, run):
        statements = run.transaction().splitlines()
        self.assertEqual('begin;', statements[0])
        self.assertEqual(["set local lock_timeout='5s';", "set local statement_timeout='60s';",
                          "set local idle_in_transaction_session_timeout='60s';"], statements[1:4])
        self.assertEqual("select pg_advisory_xact_lock(hashtext('primesecure-app-package-recovery'));", statements[4])
        self.assertEqual('lock table public.schools in share mode;', statements[5])
        self.assertIn('(select count(*) from public.schools)<>1', statements[6])
        self.assertIn(f'or not exists (select 1 from public.schools where id={literal(publisher.SCHOOL)}::uuid)', statements[6])
        self.assertIn("raise exception 'School scope changed; recovery stopped'", statements[6])
        self.assertEqual('lock table public.hub_items,public.hub_access,public.hub_app_defaults in share row exclusive mode;', statements[7])
        guards = [line for line in statements if line.startswith('do $guard$')]
        self.assertEqual(len(run.before['items']) + 2, len(guards))
        for item, guard in zip(run.before['items'], guards):
            self.assertIn(f"where id={literal(item['id'])}::uuid", guard)
            self.assertIn('select to_jsonb(i)', guard)
            self.assertIn('is distinct from ' + literal(json.dumps(item)) + '::jsonb', guard)
            self.assertIn("raise exception 'Catalog drift; recovery stopped'", guard)
        ready = [row for row in run.plan['mapping'] if row['status'] == 'ready']
        unsafe = [row for row in run.plan['mapping'] if row['status'] not in ('ready', 'unmatched_untouched')]
        ids = ','.join(literal(row['id']) + '::uuid' for row in ready + unsafe)
        for name, table, guard in zip(('access', 'defaults'), ('hub_access', 'hub_app_defaults'), guards[-2:]):
            self.assertIn(f'from public.{table} v where v.item_id in ({ids})', guard)
            self.assertIn('order by v.item_id,v.school_id', guard)
            self.assertIn('is distinct from ' + literal(json.dumps(run.before[name])) + '::jsonb', guard)
            self.assertIn("raise exception 'Access/default drift; recovery stopped'", guard)
        updates = [line for line in statements if line.startswith('update ')]
        expected = [f"update public.hub_items set storage_path={literal(row['new_path'])},mime_type={literal(publisher.MIME)},size={row['size']},sha256={literal(row['sha256'])} where id={literal(row['id'])}::uuid;" for row in ready]
        if unsafe:
            expected.append('update public.hub_items set published=false where id in (' +
                            ','.join(literal(row['id']) + '::uuid' for row in unsafe) + ');')
        self.assertEqual(expected, updates)
        self.assertLess(max(statements.index(guard) for guard in guards), statements.index(updates[0]))
        self.assertEqual('commit;', statements[-1])
        self.assertEqual(8 + len(guards) + len(updates) + 1, len(statements))
        untouched = run.plan['mapping'][-1]['id']
        for sql in run.statements:
            self.assertNotIn(untouched, sql)
            self.assertNotRegex(sql.lower(), r'\b(?:insert|delete|truncate|alter|drop)\b')
        for table, alias, column in (('hub_items', 'i', 'id'), ('hub_access', 'a', 'item_id'),
                                     ('hub_app_defaults', 'd', 'item_id')):
            self.assertIn(f'from public.{table} {alias} where {alias}.{column} in ({ids})', run.statements[0])
        self.assertIn("'school_count',(select count(*) from public.schools)", run.statements[0])
        self.assertIn("'school_id',(select id from public.schools order by id limit 1)", run.statements[0])
        self.assertEqual(run.statements[0], run.statements[-1])

    def test_valid_synthetic_34_ready_18_unsafe_scoped_transaction_and_preservation_counts(self):
        plan, objects = batch(34, 18)
        frozen = copy.deepcopy(plan)
        run = self.run_for(plan, objects)
        run.publish(plan['plan_sha256'])
        self.assertEqual(frozen, plan)
        self.assertNotIn('school_id', plan['inventory'])
        self.assertEqual(objects, run.objects)
        self.assertEqual(3, run.helper.psql.call_count)
        self.assertEqual(34, run.urlopen.call_count)
        run.load_spec.assert_called_once_with('storage', '/root/primesecure-explore-stage/storage_helpers.py')
        run.loader.exec_module.assert_called_once_with(run.helper)
        run.helper.gateway.assert_called_once_with()
        self.assertEqual(['snapshot'] + ['storage:' + row['new_path'] for row in plan['mapping'][:34]] +
                         ['transaction', 'snapshot'], run.events)
        for call in run.urlopen.call_args_list:
            request = call.args[0]
            self.assertEqual('offline-only-key', request.get_header('Apikey'))
            self.assertEqual('Bearer offline-only-key', request.get_header('Authorization'))
            self.assertIsNone(request.data)
        self.assert_transaction_contract(run)
        result = json.loads(run.output.getvalue())
        self.assertEqual(dict(repaired=34, unsafe_withdrawn=18, backup=str(run.backups()[0]),
                              defaults_preserved=True, access_preserved=True,
                              original_storage_objects_retained=True, devices_modified=0,
                              plan_sha256=plan['plan_sha256']), result)
        self.assertEqual(result, json.loads((run.backups()[0] / 'result.json').read_text()))
        self.assertEqual({'before.json', 'reviewed-plan.json', 'result.json'},
                         {path.name for path in run.backups()[0].iterdir()})
        saved = json.loads((run.backups()[0] / 'before.json').read_text(encoding='utf-8'))
        self.assertEqual((52, 52, 52), tuple(len(saved[name]) for name in ('items', 'access', 'defaults')))
        self.assertEqual(saved['access'], run.after['access'])
        self.assertEqual(saved['defaults'], run.after['defaults'])

    def test_valid_ready_only_batch_never_emits_withdrawal_update(self):
        plan, objects = batch(2, 0)
        run = self.run_for(plan, objects)
        run.publish(plan['plan_sha256'])
        self.assert_transaction_contract(run)
        self.assertNotIn('set published=false', run.transaction())
        result = json.loads(run.output.getvalue())
        self.assertEqual((2, 0), (result['repaired'], result['unsafe_withdrawn']))

    def test_post_publication_preservation_and_visibility_failures_never_emit_success(self):
        for change in ('access', 'defaults', 'storage_path', 'sha256', 'published', 'preinstall', 'unsafe'):
            with self.subTest(change=change):
                run = self.run_for()
                if change in ('access', 'defaults'):
                    run.after[change].pop()
                    message = 'Access/default preservation check failed'
                elif change == 'unsafe':
                    run.after['items'][2]['published'] = True
                    message = 'Unsafe app remains published'
                else:
                    item = run.after['items'][0]
                    item[change] = not item[change] if change in ('published', 'preinstall') else 'changed'
                    message = 'Publication verification failed'
                with self.assertRaisesRegex(RuntimeError, message):
                    run.publish(run.plan['plan_sha256'])
                self.assertEqual(3, run.helper.psql.call_count)
                self.assertEqual('', run.output.getvalue())
                self.assertFalse((run.backups()[0] / 'result.json').exists())


if __name__ == '__main__':
    unittest.main()
