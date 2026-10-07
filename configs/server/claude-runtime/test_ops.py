#!/usr/bin/env python3
"""Fixtures contain dummy text only. Tests never contact the production host."""
import contextlib, fcntl, importlib.machinery, importlib.util, io, json, os, pathlib, pwd, subprocess, sys, tarfile, tempfile, types, unittest
from unittest import mock

HERE = pathlib.Path(__file__).parent.resolve()


def module(name):
    loader = importlib.machinery.SourceFileLoader(name.replace('-', '_'), str(HERE / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


class OpsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name)
        self.home = self.base / 'home'
        (self.home / '.claude').mkdir(parents=True)
        (self.home / '.claude' / 'settings.json').write_text('{"fixture":true}')
        (self.home / '.claude.json').write_text('{"fixture":"dummy"}')
        (self.home / '.claude' / 'hook').write_text('#!/bin/sh\nexit 0\n')
        (self.home / '.claude' / 'hook').chmod(0o700)
        self.backups = self.base / 'backups'
        self.config = self.base / 'runtime.json'
        self.config.write_text(json.dumps({'runtime_home': str(self.home), 'runtime_user': pwd.getpwuid(os.getuid()).pw_name, 'expected_ip': '48.46.113.162', 'expected_org': 'Comcast', 'http_proxy': 'http://127.0.0.1:7890'}))

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, name, *args, ok=True):
        result = subprocess.run([sys.executable, str(HERE / name), '--config', str(self.config), *map(str, args)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result

    def backup(self):
        self.run_script('claude-session-backup', '--backup-dir', self.backups)
        return self.backups / 'latest.tar.gz'

    def test_backup_restore_roundtrip_and_private_modes(self):
        archive = self.backup()
        self.run_script('claude-session-restore', archive, '--check-only')
        destination = self.base / 'restored'
        self.run_script('claude-session-restore', archive, '--destination', destination)
        for rel in ('.claude.json', '.claude/settings.json', '.claude/hook'):
            self.assertEqual((self.home / rel).read_bytes(), (destination / rel).read_bytes())
        self.assertEqual((destination / '.claude/hook').stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.backups.stat().st_mode & 0o777, 0o700)
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)

    def test_retention_and_latest(self):
        for _ in range(12):
            self.backup()
        self.assertEqual(len(list(self.backups.glob('session-*.tar.gz'))), 10)
        self.assertTrue((self.backups / 'latest.tar.gz').exists())

    def test_backup_fails_missing_required_file(self):
        (self.home / '.claude.json').unlink()
        self.run_script('claude-session-backup', '--backup-dir', self.backups, ok=False)
        self.assertFalse((self.backups / 'latest.tar.gz').exists())

    def test_backup_rejects_symlink_and_does_not_advance_latest(self):
        original = self.backup().readlink()
        (self.home / '.claude' / 'outside').symlink_to('/etc/passwd')
        self.run_script('claude-session-backup', '--backup-dir', self.backups, ok=False)
        self.assertEqual((self.backups / 'latest.tar.gz').readlink(), original)

    def test_backup_excludes_debug_cache_and_latest_symlink(self):
        debug = self.home / '.claude' / 'debug'
        debug.mkdir()
        (debug / 'session.txt').write_text('diagnostic fixture')
        (debug / 'latest').symlink_to(debug / 'session.txt')
        archive = self.backup()
        self.run_script('claude-session-restore', archive, '--check-only')
        with tarfile.open(archive) as tf:
            names = tf.getnames()
            self.assertIn('.claude.json', names)
            self.assertIn('.claude/settings.json', names)
            self.assertFalse(any(pathlib.PurePosixPath(name).parts[:2] == ('.claude', 'debug') for name in names))

    def test_concurrent_backup_lock(self):
        self.backup()
        with open(self.backups / '.backup.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.run_script('claude-session-backup', '--backup-dir', self.backups, ok=False)

    def make_archive(self, extra):
        path = self.base / 'malicious.tar.gz'
        with tarfile.open(path, 'w:gz') as tf:
            directory = tarfile.TarInfo('.claude')
            directory.type = tarfile.DIRTYPE
            tf.addfile(directory)
            tf.addfile(tarfile.TarInfo('.claude.json'), io.BytesIO(b''))
            tf.addfile(extra, io.BytesIO(b''))
        return path

    def test_restore_rejects_traversal_absolute_links_and_duplicate(self):
        for name, kind in [('../escaped', tarfile.REGTYPE), ('/escaped', tarfile.REGTYPE), ('.claude/link', tarfile.SYMTYPE), ('.claude/hard', tarfile.LNKTYPE), ('.claude.json', tarfile.REGTYPE), ('.claude/fifo', tarfile.FIFOTYPE)]:
            with self.subTest(name=name):
                entry = tarfile.TarInfo(name)
                entry.type = kind
                entry.linkname = '/etc/passwd'
                path = self.make_archive(entry)
                self.run_script('claude-session-restore', path, '--check-only', ok=False)
        self.assertFalse((self.base / 'escaped').exists())

    def test_restore_rejects_corrupt_archive(self):
        path = self.base / 'corrupt.tar.gz'
        path.write_bytes(b'not-a-tar')
        self.run_script('claude-session-restore', path, '--check-only', ok=False)

    def test_restore_refuses_nonempty_destination(self):
        self.run_script('claude-session-restore', self.backup(), '--destination', self.home, ok=False)

    def test_live_process_detection(self):
        mod = module('claude-session-restore')
        result = types.SimpleNamespace(stdout=str(os.getuid()) + ' claude /home/claude/.local/share/claude/versions/2.0\n')
        with mock.patch.object(mod.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(ValueError, 'running'):
                mod.check_running(pwd.getpwuid(os.getuid()).pw_name)

    def test_live_restore_preserves_pre_restore_backup(self):
        archive = self.backup().resolve()
        (self.home / '.claude.json').write_text('changed-before-restore')
        mod = module('claude-session-restore')
        args = ['restore', str(archive), '--config', str(self.config), '--backup-dir', str(self.backups)]
        with mock.patch.object(sys, 'argv', args), mock.patch.object(mod.os, 'geteuid', return_value=0), mock.patch.object(mod.os, 'chown'), mock.patch.object(mod, 'check_running'), contextlib.redirect_stdout(io.StringIO()):
            mod.main()
        self.assertEqual((self.home / '.claude.json').read_text(), '{"fixture":"dummy"}')
        with tarfile.open(self.backups / 'latest.tar.gz') as tf:
            self.assertEqual(tf.extractfile('.claude.json').read(), b'changed-before-restore')

    def test_live_restore_rolls_back_if_second_replace_fails(self):
        archive = self.backup().resolve()
        (self.home / '.claude.json').write_text('preserve-me')
        (self.home / '.claude/settings.json').write_text('preserve-settings')
        mod = module('claude-session-restore')
        args = ['restore', str(archive), '--config', str(self.config), '--backup-dir', str(self.backups)]
        real_replace = os.replace
        def replace(src, dst):
            if '.session-restore-' in str(src) and pathlib.Path(src).name == '.claude.json':
                raise OSError('injected replace failure')
            return real_replace(src, dst)
        with mock.patch.object(sys, 'argv', args), mock.patch.object(mod.os, 'geteuid', return_value=0), mock.patch.object(mod.os, 'chown'), mock.patch.object(mod, 'check_running'), mock.patch.object(mod.os, 'replace', side_effect=replace), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(OSError, 'injected'):
                mod.main()
        self.assertEqual((self.home / '.claude.json').read_text(), 'preserve-me')
        self.assertEqual((self.home / '.claude/settings.json').read_text(), 'preserve-settings')

    def test_health_success_mismatch_transient_failure_and_bridge_down(self):
        mod = module('proxy-health-check')
        out_json = self.base / 'status.json'
        out_text = self.base / 'status'
        args = ['proxy-health-check', '--config', str(self.config), '--status-json', str(out_json), '--status-text', str(out_text)]
        ok = {'ip': '48.46.113.162', 'loc': 'US', 'org_source': 'ipinfo.io'}
        cases = [(0, dict(ok, org='AS7922 Comcast Cable'), 0), (0, dict(ok, org=None, org_source=None), 0),
                 (0, dict(ok, org='AS0 Hosting'), 1), (0, dict(ok, loc='HK', org='Comcast'), 1),
                 (0, {'ip': '137.175.65.78', 'loc': 'US', 'org': 'Other', 'org_source': 'ipinfo.io'}, 1), (0, TimeoutError(), 1), (1, None, 1)]
        for bridge_rc, probe_result, expected in cases:
            with self.subTest(probe_result=str(probe_result)):
                with mock.patch.object(sys, 'argv', args), mock.patch.object(mod.subprocess, 'run', return_value=types.SimpleNamespace(returncode=bridge_rc)) as run, mock.patch.object(mod, 'probe') as probe, mock.patch.object(mod, 'stop_claude', return_value=1) as stop, contextlib.redirect_stdout(io.StringIO()):
                    if isinstance(probe_result, Exception):
                        probe.side_effect = probe_result
                    else:
                        probe.return_value = probe_result
                    self.assertEqual(mod.main(), expected)
                    self.assertEqual(json.loads(out_json.read_text())['healthy'], expected == 0)
                    self.assertNotIn('restart', run.call_args.args[0])
                    if bridge_rc:
                        probe.assert_not_called()
                    mismatch = isinstance(probe_result, dict) and (probe_result['ip'] != '48.46.113.162' or probe_result['loc'] != 'US')
                    self.assertEqual(stop.called, mismatch)
                    self.assertEqual(json.loads(out_json.read_text())['enforced'], mismatch)

    def test_health_reuses_recent_org_for_same_ip_only(self):
        mod = module('proxy-health-check')
        now = mod.datetime.datetime.now(mod.datetime.timezone.utc)
        path = self.base / 'status.json'
        prev = {'observed_ip': '48.46.113.162', 'observed_org': 'Comcast', 'org_source': 'ipwho.is', 'org_checked_at': now.isoformat()}
        path.write_text(json.dumps(prev))
        self.assertEqual(mod.recent_org(path, now)['org'], 'Comcast')
        self.assertIsNone(mod.recent_org(path, now + mod.datetime.timedelta(seconds=mod.ORG_RECHECK_SECONDS + 1)))
        config = json.loads(self.config.read_text())
        with mock.patch.object(mod, 'fetch_json', return_value='ip=48.46.113.162\nloc=US\n') as fetch:
            result = mod.probe(config, mod.recent_org(path, now))
        self.assertEqual((result['org'], fetch.call_count), ('Comcast', 1))
        with mock.patch.object(mod, 'fetch_json', side_effect=['ip=1.2.3.4\nloc=US\n', ValueError('429'), ValueError('429')]):
            self.assertIsNone(mod.probe(config, mod.recent_org(path, now))['org'])

    def test_health_connect_is_explicit_and_falls_back_on_rate_limit(self):
        mod = module('proxy-health-check')
        config = json.loads(self.config.read_text())
        bodies = {'claude.ai': (200, b'fl=1\nip=48.46.113.162\nloc=US\n'),
                  'ipinfo.io': (429, b'{}'),
                  'ipwho.is': (200, b'{"ip":"48.46.113.162","connection":{"isp":"Comcast Cable","org":"AviationAI"}}')}
        hosts = []
        def make(*_, **__):
            conn = mock.MagicMock()
            conn.set_tunnel.side_effect = lambda host, port: hosts.append((host, port))
            def getresponse():
                status, body = bodies[hosts[-1][0]]
                return types.SimpleNamespace(status=status, read=lambda n: body)
            conn.getresponse.side_effect = getresponse
            return conn
        with mock.patch.object(mod.http.client, 'HTTPSConnection', side_effect=make):
            result = mod.probe(config)
        self.assertEqual((result['ip'], result['loc'], result['org_source']), ('48.46.113.162', 'US', 'ipwho.is'))
        self.assertIn('Comcast', result['org'])
        self.assertEqual(hosts, [('claude.ai', 443), ('ipinfo.io', 443), ('ipwho.is', 443)])
        bodies['claude.ai'] = (200, b'fl=1\n')
        hosts.clear()
        with mock.patch.object(mod.http.client, 'HTTPSConnection', side_effect=make), self.assertRaises(ValueError):
            mod.probe(config)

if __name__ == '__main__':
    unittest.main(verbosity=2)
