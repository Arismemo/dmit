#!/usr/bin/python3
"""Runtime for one isolated instance; configuration is supplied by root-owned units."""
import asyncio
import json
import os
import pathlib
import pwd
import subprocess
import sys

ROOT = pathlib.Path('/etc/isolated-instances')

def config(name):
    return json.loads((ROOT / name / 'runtime.json').read_text())

def namespace(name):
    path = pathlib.Path('/run/netns') / name
    if not path.exists():
        subprocess.run(['/usr/sbin/ip', 'netns', 'add', name], check=True)
    subprocess.run(['/usr/sbin/ip', '-n', name, 'link', 'set', 'lo', 'up'], check=True)

async def relay(reader, writer, upstream):
    other = None
    async def copy(src, dst):
        while data := await src.read(65536):
            dst.write(data)
            await dst.drain()
        if dst.can_write_eof():
            dst.write_eof()
    try:
        remote, other = await asyncio.open_unix_connection(upstream)
        await asyncio.gather(copy(reader, other), copy(remote, writer))
    except (OSError, ConnectionError):
        pass
    finally:
        writer.close()
        if other:
            other.close()

async def serve(name):
    servers = []
    for port, kind in ((7890, 'http'), (7891, 'socks')):
        sock = f'/run/isolated-instances/{name}/{kind}.sock'
        servers.append(await asyncio.start_server(lambda r, w, p=sock: relay(r, w, p), '127.0.0.1', port))
    await asyncio.gather(*(s.serve_forever() for s in servers))

def launch(name, argv):
    if os.geteuid() != 0:
        sys.exit('Run the launcher as root.')
    cfg = config(name)
    account = pwd.getpwnam(name)
    subprocess.run(['/bin/systemctl', 'start', f'iso-{name}-relay.service'], check=True)
    home = account.pw_dir
    env = {'HOME': home, 'USER': name, 'LOGNAME': name, 'PATH': home + '/.local/bin:/usr/bin:/bin',
           'LANG': 'C.UTF-8', 'SHELL': '/bin/bash',
           'HTTP_PROXY': 'http://127.0.0.1:7890', 'HTTPS_PROXY': 'http://127.0.0.1:7890',
           'http_proxy': 'http://127.0.0.1:7890', 'https_proxy': 'http://127.0.0.1:7890',
           'ALL_PROXY': 'socks5h://127.0.0.1:7891', 'all_proxy': 'socks5h://127.0.0.1:7891',
           'NO_PROXY': 'localhost,127.0.0.1,::1', 'no_proxy': 'localhost,127.0.0.1,::1'}
    if 'TERM' in os.environ:
        env['TERM'] = os.environ['TERM']
    os.chdir(home + '/workspace')
    cmd = ['/usr/sbin/ip', 'netns', 'exec', name, '/usr/bin/setpriv', '--reuid=' + name,
           '--regid=' + name, '--init-groups', '--no-new-privs', '--bounding-set=-all',
           '/usr/bin/env', '-i'] + [f'{k}={v}' for k, v in env.items()] + [__file__, 'guard', name] + argv
    os.execv(cmd[0], cmd)

def guard(name, argv):
    cfg = config(name)
    try:
        r = subprocess.run(['/usr/bin/curl', '-fsS', '--noproxy', '', '--proxy', 'http://127.0.0.1:7890',
                            '--connect-timeout', '5', '--max-time', '15', 'https://claude.ai/cdn-cgi/trace'],
                           check=True, capture_output=True, text=True, timeout=18)
        trace = dict(x.split('=', 1) for x in r.stdout.splitlines() if '=' in x)
        if trace.get('ip') != cfg['expected_ip'] or trace.get('loc') != cfg['expected_country']:
            sys.exit('Egress mismatch; launch refused.')
    except (OSError, subprocess.SubprocessError, ValueError):
        sys.exit('Egress could not be verified; launch refused.')
    if not argv:
        argv = [str(pathlib.Path.home() / '.local/bin/claude')]
    os.execvpe(argv[0], argv, os.environ)

if __name__ == '__main__':
    action, name, *args = sys.argv[1:]
    if not name.startswith('ci-') or not all(c.islower() or c.isdigit() or c == '-' for c in name):
        sys.exit('Invalid instance name.')
    if action == 'namespace': namespace(name)
    elif action == 'relay': asyncio.run(serve(name))
    elif action == 'launch': launch(name, args)
    elif action == 'guard': guard(name, args)
    else: sys.exit('Unknown action.')
