"""Offline guard/transaction tests. Never load an SSH key or contact any server."""
import copy
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, call, patch
import zipfile

SPEC = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-reviewed-agent.py'))
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)


def release(code=22):
    return dict(id=f'00000000-0000-4000-8000-{code:012d}', version_code=code,
                version_name='0.8.5', storage_path='releases/old.apk',
                sha256='a'*64, active=True, notes='unchanged', created_by=None, created_at='before')


def reviewed():
    return dict(id='00000000-0000-4000-8000-000000000037',
                **{k: v for k, v in p.identity().items() if k not in ('bytes', 'source_commit', 'signer')})


def snapshot(rows):
    return dict(database='postgres', school='Rusununguko ZIMFEP High School', private_bucket=True,
                triggers=0, rules=0, rows=rows)


class Guards(unittest.TestCase):
    def test_missing_row_and_exact_paused_row_only(self):
        self.assertEqual('insert-paused', p.classify([release()]))
        self.assertEqual('existing-paused', p.classify([release(), reviewed()]))
        for key, bad in [('active', True), ('version_name', 'other'), ('sha256', 'b'*64),
                         ('storage_path', 'different.apk'), ('version_code', 38)]:
            row = reviewed(); row[key] = bad
            with self.subTest(key=key), self.assertRaises(p.GuardError):
                p.classify([row])
        with self.assertRaises(p.GuardError):
            p.classify([reviewed(), reviewed()])

    def test_proves_all_existing_fields_not_just_active_flags(self):
        before = [release()]
        p.prove_unchanged(before, before + [reviewed()], 'insert-paused')
        p.prove_unchanged(before + [reviewed()], before + [reviewed()], 'existing-paused')
        for key, bad in [('active', False), ('notes', 'changed'), ('sha256', 'b'*64)]:
            after = copy.deepcopy(before) + [reviewed()]; after[0][key] = bad
            with self.subTest(key=key), self.assertRaises(p.GuardError):
                p.prove_unchanged(before, after, 'insert-paused')
        with self.assertRaises(p.GuardError):
            p.prove_unchanged(before, [reviewed()], 'insert-paused')

    def test_backend_private_bucket_and_side_effect_guards(self):
        for key, bad in [('database', 'other'), ('school', 'other'), ('private_bucket', False),
                         ('private_bucket', None), ('triggers', 1), ('rules', 1)]:
            state = snapshot([]); state[key] = bad
            with self.subTest(key=key), self.assertRaises(p.GuardError):
                p.validate_snapshot(state)

    def test_sql_has_no_activation_update_device_or_upsert(self):
        sql = p.insert_sql().lower()
        self.assertIn('insert into public.agent_releases', sql)
        self.assertIn(',false,', sql)
        for forbidden in ['update ', 'delete ', 'on conflict', 'devices', 'device_safety', 'true', 'set_config']:
            self.assertNotIn(forbidden, sql)
        self.assertEqual(f'releases/37-{p.SHA}.apk', p.OBJECT)

    def test_reviewed_identity_pins_are_unchanged(self):
        self.assertEqual((37, '0.9.4', 'd3853b790e442f62d50b6a76e07bb860e55e0bb4',
                          '9e4ac2da321d5bae3fc7bdb7bdbc58302122c83169754b0e0aafbd762135339b',
                          3_164_829,
                          '9f83efe0a3d3399f899619ef35eb43df4f51f8c61e237bf1b547dce3482eaa79'),
                         (p.CODE, p.VERSION, p.SOURCE, p.SHA, p.SIZE, p.SIGNER))

    def test_local_proof_signer_manifest_and_hash_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); apk = root/'app.apk'; proof = root/'proof.json'
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('classes.dex', b'fixture')
            evidence = dict(p.identity(), signature_verified=True, same_installed_fleet_signer=True, test_only=False)
            proof.write_text(json.dumps(evidence))

            def sdk(argv, **kwargs):
                if 'rev-parse' in argv: text = p.SOURCE
                elif 'show' in argv: return SimpleNamespace(returncode=0, stdout=b'# reviewed helper\n')
                elif 'verify' in argv: text = 'Signer #1 certificate SHA-256 digest: ' + p.SIGNER
                elif 'badging' in argv: text = f"package: name='{p.PACKAGE}' versionCode='37' versionName='0.9.4'"
                else: text = 'A: android:testOnly=(type 0x12)0x0'
                return SimpleNamespace(returncode=0, stdout=text)

            with patch.object(p, 'digest', return_value=(p.SIZE, p.SHA)), patch.object(p.subprocess, 'run', side_effect=sdk):
                plan = p.verify_local(apk, proof, root, root)
                self.assertEqual(p.identity(), plan['release'])
                for key, bad in [('source_commit', 'x'*40), ('signature_verified', False), ('sha256', 'a'*64)]:
                    broken = dict(evidence); broken[key] = bad; proof.write_text(json.dumps(broken))
                    with self.subTest(key=key), self.assertRaises(p.GuardError):
                        p.verify_local(apk, proof, root, root)
                proof.write_text(json.dumps(evidence))
                with patch.object(p, 'digest', return_value=(p.SIZE, 'bad')), self.assertRaises(p.GuardError):
                    p.verify_local(apk, proof, root, root)
                for signer in ['0'*64, p.SIGNER + '\nSigner #2 certificate SHA-256 digest: ' + p.SIGNER]:
                    original = sdk
                    def bad_signer(argv, **kwargs):
                        return SimpleNamespace(returncode=0, stdout='Signer #1 certificate SHA-256 digest: '+signer) if 'verify' in argv else original(argv, **kwargs)
                    with patch.object(p.subprocess, 'run', side_effect=bad_signer), self.assertRaises(p.GuardError):
                        p.verify_local(apk, proof, root, root)
                for attributes in ['A: android:testOnly=(type 0x12)0xffffffff',
                                   'A: android:testOnly=(type 0x12)0x0\nA: android:debuggable=(type 0x12)0xffffffff']:
                    def bad_manifest(argv, **kwargs):
                        return SimpleNamespace(returncode=0, stdout=attributes) if 'xmltree' in argv else sdk(argv, **kwargs)
                    with patch.object(p.subprocess, 'run', side_effect=bad_manifest), self.assertRaises(p.GuardError):
                        p.verify_local(apk, proof, root, root)


class Transactions(unittest.TestCase):
    def run_publish(self, rows, operation, backup_fails=False, altered=False):
        before = snapshot(rows)
        after_rows = copy.deepcopy(rows) + ([reviewed()] if operation == 'insert-paused' else [])
        if altered: after_rows[0]['active'] = not after_rows[0]['active']
        after = snapshot(after_rows)
        events, backups = [], {}
        transaction = Mock()
        transaction.query.side_effect = lambda sql: (events.append(sql), before if len(events) == 1 else after)[1]
        transaction.commit.side_effect = lambda: events.append('COMMIT')
        store = Mock(); store.read_hash.return_value = (p.SIZE, p.SHA)
        def write(path, data):
            if backup_fails: raise OSError('fixture backup failure')
            backups[path.name] = data
            events.append(path.name)
        with patch.object(p, 'ReleaseTransaction', return_value=transaction), patch.object(p, 'private_json', side_effect=write):
            if backup_fails or altered:
                with self.assertRaises((p.GuardError, OSError)):
                    p.publish_paused(Path('/private/backup'), store, Path('/private/apk'))
                transaction.commit.assert_not_called()
            else:
                result = p.publish_paused(Path('/private/backup'), store, Path('/private/apk'))
                self.assertTrue(result['other_rows_unchanged'])
                self.assertFalse(result['devices_modified'])
                self.assertEqual({str(r['version_code']): r['active'] for r in rows},
                                 json.loads(json.dumps(backups['before.json']))['active_flags'])
                self.assertLess(events.index('before.json'), 2)
                self.assertLess(events.index('verified-before-commit.json'), events.index('COMMIT'))
            transaction.close.assert_called_once()
            store.ensure.assert_called_once_with('agent', p.OBJECT, Path('/private/apk'), p.SIZE, p.SHA, p.MIME)
        return events

    def test_backup_precedes_insert_and_all_other_rows_preserved(self):
        events = self.run_publish([release()], 'insert-paused')
        self.assertIn('lock table public.agent_releases', events[0])
        self.assertIn('insert into public.agent_releases', events[2])

    def test_exact_paused_rerun_is_not_updated(self):
        events = self.run_publish([release(), reviewed()], 'existing-paused')
        self.assertNotIn('insert into', events[2])

    def test_id_column_is_optional_and_flags_cover_every_version(self):
        for with_id in (False, True):
            with self.subTest(with_id=with_id):
                rows = [release(21), release(22)]
                rows[0]['active'] = False
                paused = reviewed()
                if not with_id:
                    for row in rows:
                        row.pop('id')
                    paused.pop('id')
                self.run_publish(rows, 'insert-paused')
                self.run_publish(rows + [paused], 'existing-paused')

    def test_backup_failure_never_inserts_or_commits(self):
        self.assertEqual(1, len(self.run_publish([release()], 'insert-paused', backup_fails=True)))

    def test_unexpected_other_row_change_rolls_back(self):
        self.run_publish([release()], 'insert-paused', altered=True)

    def test_storage_mismatch_never_opens_transaction(self):
        storage = Mock(); storage.read_hash.return_value = (p.SIZE, 'bad')
        with patch.object(p, 'ReleaseTransaction') as transaction, self.assertRaises(p.GuardError):
            p.publish_paused(Path('/private'), storage, Path('/private/apk'))
        transaction.assert_not_called()

    def test_default_inspect_does_not_make_private_dirs_or_upload(self):
        helper = "class Storage:\n def __init__(self,*a): pass\n def read_hash(self,*a): return None\ndef gateway(): return ('private','server-only')\n"
        import hashlib
        plan = dict(release=p.identity(), storage_helper=helper, storage_helper_sha256=hashlib.sha256(helper.encode()).hexdigest())
        with patch.object(p, 'snapshot_readonly', return_value=snapshot([])), patch.object(p, 'private_directory') as directories, patch.object(p, 'publish_paused') as publish:
            self.assertEqual('inspect', p.server_main(plan, False)['mode'])
            directories.assert_not_called(); publish.assert_not_called()


class WireProtocol(unittest.TestCase):
    @staticmethod
    def rows():
        rows = []
        for code in range(1, 24):
            row = release(code)
            row.update(id=f'release-{code}', storage_path=f'releases/{code}.apk', active=code % 2 == 0,
                       notes='Pilot "quoted" notes\nsecond line\r\npath\\name; Unicode: café')
            rows.append(row)
        return rows

    def test_sql_requires_compact_jsonb_serialization_for_line_protocol(self):
        # json_agg(record) adds physical newlines between records, even under psql -At.
        # This static contract guards the SQL itself; mocked JSON alone cannot catch that.
        sql = ' '.join(p.SNAPSHOT_SQL.lower().split())
        self.assertTrue(sql.startswith('select jsonb_build_object('))
        self.assertIn('jsonb_agg(to_jsonb(r) order by version_code)', sql)
        self.assertIn("'[]'::jsonb", sql)
        self.assertNotRegex(sql, r'\b(?:json_agg|json_build_object|row_to_json|jsonb_pretty)\s*\(')
        for flag in ('-X', '-q', '-A', '-t'):
            self.assertIn(flag, p.PSQL)

    def test_real_reader_consumes_two_compact_snapshots_with_23_rows_and_escaped_notes(self):
        before = snapshot(self.rows())
        after = snapshot(self.rows() + [reviewed()])
        # PostgreSQL jsonb::text uses one physical line, including for embedded note newlines.
        wire = '\n'.join(json.dumps(value, ensure_ascii=False) for value in (before, after)) + '\n'
        self.assertEqual(2, len(wire.splitlines()))
        process = Mock(stdin=Mock(closed=False), stdout=io.StringIO(wire))
        process.poll.return_value = 0
        with patch.object(p.subprocess, 'Popen', return_value=process), \
             patch.object(p.select, 'select', return_value=([process.stdout], [], [])) as ready:
            transaction = p.ReleaseTransaction()
            try:
                actual_before = transaction.query(p.SNAPSHOT_SQL)
                self.assertEqual(before, actual_before)
                self.assertEqual(23, len(actual_before['rows']))
                self.assertEqual(after, transaction.query(p.SNAPSHOT_SQL))
                self.assertEqual('', process.stdout.read())
                self.assertEqual(2, ready.call_count)
            finally:
                transaction.close()
        self.assertEqual([p.SNAPSHOT_SQL + '\n'] * 2,
                         [call.args[0] for call in process.stdin.write.call_args_list])
        process.stdin.close.assert_called_once()
        process.wait.assert_not_called()

    def test_old_multiline_aggregate_fails_closed_before_backup_insert_or_commit(self):
        rows = self.rows()
        metadata = json.dumps({k: v for k, v in snapshot(rows).items() if k != 'rows'})[:-1]
        old_wire = metadata + ', "rows": [' + ', \n '.join(json.dumps(row) for row in rows) + ']}\n'
        self.assertEqual(23, len(old_wire.splitlines()))
        self.assertEqual(snapshot(rows), json.loads(old_wire))  # Valid JSON as a whole, not per line.
        process = Mock(stdin=Mock(closed=False), stdout=io.StringIO(old_wire))
        process.poll.return_value = 0
        storage = Mock(); storage.read_hash.return_value = (p.SIZE, p.SHA)
        with patch.object(p.subprocess, 'Popen', return_value=process), \
             patch.object(p.select, 'select', return_value=([process.stdout], [], [])), \
             patch.object(p, 'private_json') as backup:
            with self.assertRaises(json.JSONDecodeError):
                p.publish_paused(Path('/private/backup'), storage, Path('/private/apk'))
            backup.assert_not_called()
        self.assertEqual(1, process.stdin.write.call_count)
        sql = process.stdin.write.call_args.args[0].lower()
        self.assertIn('lock table public.agent_releases', sql)
        self.assertNotIn('insert into', sql)
        self.assertNotIn('commit;', sql)
        process.stdin.close.assert_called_once()
        self.assertTrue(process.stdout.closed)


class SafeDiagnostics(unittest.TestCase):
    SECRET = 'Bearer server-only-secret https://private.invalid/?token=secret'

    def remote_failure(self, result, status=1):
        client = Mock()
        inp, out, err = Mock(), Mock(), Mock()
        out.read.return_value = json.dumps(result).encode()
        err.read.return_value = self.SECRET.encode()
        out.channel.recv_exit_status.return_value = status
        client.exec_command.return_value = (inp, out, err)
        with self.assertRaises(p.GuardError) as raised:
            p.remote_run(client, {'release': p.identity()}, apply=True)
        inp.channel.shutdown_write.assert_called_once()
        err.read.assert_called_once()
        return p.error_report(raised.exception)

    def test_publish_error_type_and_frame_survive_remote_hop_without_message(self):
        store = Mock(); store.read_hash.return_value = (p.SIZE, p.SHA)
        transaction = Mock()
        transaction.query.return_value = snapshot([release()])
        with patch.object(p, 'ReleaseTransaction', return_value=transaction), \
             patch.object(p, 'private_json', side_effect=KeyError(self.SECRET)):
            try:
                p.publish_paused(Path('/private/backup'), store, Path('/private/apk'))
            except KeyError as error:
                diagnostic = p.error_report(error)
            else:
                self.fail('Expected backup failure')
        self.assertEqual('KeyError', diagnostic['error_type'])
        self.assertEqual(['publish_paused'], [frame['function'] for frame in diagnostic['error_frames']])
        self.assertEqual({'source', 'function', 'line'}, set(diagnostic['error_frames'][0]))
        self.assertNotIn(self.SECRET, json.dumps(diagnostic))
        transaction.commit.assert_not_called()
        transaction.close.assert_called_once()
        forwarded = self.remote_failure(diagnostic)
        self.assertEqual(diagnostic['error_type'], forwarded['error_type'])
        self.assertEqual(diagnostic['error_frames'], forwarded['error_frames'])
        self.assertNotIn(self.SECRET, json.dumps(forwarded))

    def test_reviewed_helper_frame_does_not_include_source_locals_or_cause(self):
        helper = {}
        exec(compile('def gateway(secret):\n try:\n  raise ValueError(secret)\n except ValueError as error:\n  raise RuntimeError(secret) from error\n',
                     '<reviewed-storage_helpers>', 'exec'), helper)
        try:
            helper['gateway'](self.SECRET)
        except RuntimeError as error:
            report = p.error_report(error)
        self.assertEqual('RuntimeError', report['error_type'])
        self.assertEqual([dict(source='reviewed-storage-helper', function='gateway', line=5)],
                         report['error_frames'])
        self.assertEqual({'error', 'error_type', 'error_frames'}, set(report))
        self.assertNotIn(self.SECRET, json.dumps(report))

    def test_remote_payload_messages_paths_and_unknown_identifiers_are_discarded(self):
        valid = dict(source='publisher', function='publish_paused', line=123)
        frames = [dict(valid, payload=self.SECRET, filename=self.SECRET), self.SECRET,
                  dict(valid, source=self.SECRET), dict(valid, function=self.SECRET),
                  dict(valid, line=self.SECRET), dict(valid, line=True), dict(valid, line=-1)]
        for kind in ('KeyError', self.SECRET, [], None):
            with self.subTest(kind=kind):
                report = self.remote_failure(dict(error=self.SECRET, error_type=kind,
                                                  error_frames=frames, payload=self.SECRET), status=0)
                self.assertEqual('KeyError' if kind == 'KeyError' else 'Exception', report['error_type'])
                self.assertEqual([valid], report['error_frames'])
                self.assertNotIn(self.SECRET, json.dumps(report))

    def test_legacy_server_without_frames_preserves_original_type(self):
        report = self.remote_failure(dict(error=self.SECRET, error_type='KeyError'))
        self.assertEqual('KeyError', report['error_type'])
        self.assertEqual([], report['error_frames'])

    def test_malformed_remote_output_and_failed_status_remain_redacted(self):
        client = Mock()
        inp, out, err = Mock(), Mock(), Mock()
        err.read.return_value = self.SECRET.encode()
        client.exec_command.return_value = (inp, out, err)
        for wire, status in ((self.SECRET, 1), ('[]', 1), ('{}', 1)):
            with self.subTest(wire=wire):
                out.read.return_value = wire.encode()
                out.channel.recv_exit_status.return_value = status
                with self.assertRaises(p.GuardError) as raised:
                    p.remote_run(client, {})
                self.assertNotIn(self.SECRET, json.dumps(p.error_report(raised.exception)))

    def test_unknown_exception_class_name_and_guard_subclass_message_are_redacted(self):
        for base in (RuntimeError, p.GuardError):
            error = type('SecretCredentialClassName', (base,), {})(self.SECRET)
            report = p.error_report(error)
            self.assertEqual('Exception', report['error_type'])
            self.assertEqual(p.FAILURE, report['error'])
            self.assertNotIn('SecretCredentialClassName', json.dumps(report))

    def test_python_c_entrypoint_emits_safe_frames_without_file_global(self):
        # Execute the SSH runner's exact source form locally, failing before any I/O.
        source = Path(p.__file__).read_text(encoding='utf-8')
        output = io.StringIO()
        with patch.object(p.sys, 'argv', ['-c', '--server', '--apply']), \
             patch.object(p.sys, 'stdin', io.StringIO(json.dumps({'payload': self.SECRET}))), \
             patch.object(p.sys, 'stdout', output), \
             patch.object(p.subprocess, 'run') as run, \
             patch.object(p.subprocess, 'Popen') as popen, \
             self.assertRaises(SystemExit) as raised:
            exec(compile(source, '<string>', 'exec'), {'__name__': '__main__'})
        self.assertEqual(1, raised.exception.code)
        run.assert_not_called(); popen.assert_not_called()
        diagnostic = json.loads(output.getvalue())
        self.assertEqual('KeyError', diagnostic['error_type'])
        self.assertEqual(['<module>', 'main', 'server_main'],
                         [frame['function'] for frame in diagnostic['error_frames']])
        self.assertNotIn(self.SECRET, output.getvalue())
        forwarded = self.remote_failure(diagnostic)
        self.assertEqual(diagnostic['error_frames'], forwarded['error_frames'])


class SftpGuards(unittest.TestCase):
    def test_all_sftp_paths_are_absolute_posix_on_windows_and_posix_clients(self):
        payload = b'offline staged APK fixture'
        sha = p.hashlib.sha256(payload).hexdigest()
        directory = '/root/primesecure-release-stage'
        remote = f'{directory}/{p.CODE}-{sha}.apk'
        private = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
        regular = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_size=len(payload))
        for stage in (PureWindowsPath(directory), PurePosixPath(directory)):
            for existing in (True, False):
                with self.subTest(stage=type(stage).__name__, existing=existing):
                    sftp = Mock()
                    sftp.lstat.side_effect = ([private, regular] if existing else
                                             [FileNotFoundError(), private, FileNotFoundError(), regular])
                    upload = MagicMock()
                    upload.__enter__.return_value = upload
                    sftp.open.side_effect = ([io.BytesIO(payload)] if existing else
                                            [upload, io.BytesIO(payload)])
                    apk = Mock()
                    apk.open.return_value = io.BytesIO(payload)
                    with patch.object(p, 'STAGE', stage), patch.object(p, 'SIZE', len(payload)), \
                         patch.object(p, 'SHA', sha):
                        p.stage_apk(sftp, apk)
                    if existing:
                        self.assertEqual([call(directory), call(remote)], sftp.lstat.call_args_list)
                        sftp.open.assert_called_once_with(remote, 'rb')
                        sftp.mkdir.assert_not_called()
                        apk.open.assert_not_called()
                    else:
                        self.assertEqual([call(directory), call(directory), call(remote), call(remote)],
                                         sftp.lstat.call_args_list)
                        sftp.mkdir.assert_called_once_with(directory, mode=0o700)
                        self.assertEqual([call(remote, 'wx'), call(remote, 'rb')], sftp.open.call_args_list)
                        upload.chmod.assert_called_once_with(0o600)
                        upload.write.assert_called_once_with(payload)
                        apk.open.assert_called_once_with('rb')
                    sftp.remove.assert_not_called()
                    sftp.rmdir.assert_not_called()
                    sftp.rename.assert_not_called()

    def test_reject_symlink_public_stage_partial_or_mismatching_existing_file(self):
        private = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
        regular = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_size=p.SIZE)
        for directory, file in [(SimpleNamespace(st_mode=stat.S_IFLNK | 0o700, st_uid=0), regular),
                                (SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0), regular),
                                (private, SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_size=5)),
                                (private, SimpleNamespace(st_mode=stat.S_IFLNK | 0o600, st_uid=0, st_size=p.SIZE))]:
            sftp = Mock(); sftp.lstat.side_effect = [directory, file]
            with self.assertRaises(p.GuardError): p.stage_apk(sftp, Path('unused'))
            sftp.open.assert_not_called()
        sftp = Mock(); sftp.lstat.side_effect = [private, regular]
        sftp.open.return_value = io.BytesIO(b'mismatching')
        with self.assertRaises(p.GuardError): p.stage_apk(sftp, Path('unused'))
        sftp.open.assert_called_once_with((p.STAGE/f'{p.CODE}-{p.SHA}.apk').as_posix(), 'rb')


class CliGuards(unittest.TestCase):
    def test_only_explicit_apply_can_stage_or_publish(self):
        for args in ([], ['--inspect'], ['--apply']):
            client = MagicMock()
            fake_paramiko = SimpleNamespace(SSHClient=lambda: client, RejectPolicy=Mock())
            with self.subTest(args=args), patch.dict('sys.modules', paramiko=fake_paramiko), \
                 patch.object(p, 'verify_local', return_value={'release': p.identity()}), \
                 patch.object(p, 'remote_run', return_value={'mode': 'fixture'}) as remote, \
                 patch.object(p, 'stage_apk') as stage, patch('sys.stdout', new_callable=io.StringIO):
                p.main(args)
                if args == ['--apply']:
                    stage.assert_called_once()
                    self.assertEqual(2, remote.call_count)
                    self.assertEqual({'apply': True}, remote.call_args.kwargs)
                else:
                    stage.assert_not_called()
                    client.open_sftp.assert_not_called()
                    remote.assert_called_once_with(client, {'release': p.identity()})
                client.close.assert_called_once()
                client.connect.assert_called_once()
                self.assertFalse(client.connect.call_args.kwargs['look_for_keys'])
                self.assertFalse(client.connect.call_args.kwargs['allow_agent'])

    def test_bad_local_artifact_never_connects(self):
        client = Mock()
        with patch.dict('sys.modules', paramiko=SimpleNamespace(SSHClient=lambda: client)), \
             patch.object(p, 'verify_local', side_effect=p.GuardError('fixture invalid artifact')), self.assertRaises(p.GuardError):
            p.main(['--apply'])
        client.connect.assert_not_called()

    def test_apply_and_inspect_are_mutually_exclusive(self):
        with patch('sys.stderr', new_callable=io.StringIO), self.assertRaises(SystemExit) as error:
            p.main(['--apply', '--inspect'])
        self.assertEqual(2, error.exception.code)


if __name__ == '__main__':
    unittest.main()
