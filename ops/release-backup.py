#!/usr/bin/env python3
"""Freeze stopped application data before restart; archive and verify the frozen copy afterwards."""
from contextlib import closing
import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
import tarfile
import time
import urllib.request
import urllib.error
from urllib.parse import urlparse
from pathlib import Path


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def manifest(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise RuntimeError('Backup source must contain ordinary files and directories')
        if path.is_file():
            if path.stat().st_nlink != 1:
                raise RuntimeError('Backup source must not contain hard links')
            result[path.relative_to(root).as_posix()] = digest(path)
    return result


def freeze(data, destination):
    data, destination = Path(data).absolute(), Path(destination).absolute()
    for path in (data, destination.parent):
        for ancestor in [path, *path.parents]:
            if ancestor.is_symlink():
                raise RuntimeError('Backup paths must not use symbolic links')
    if not data.is_dir() or destination.exists() or data == destination or data in destination.parents or destination in data.parents:
        raise RuntimeError('Snapshot must be a new directory outside application data')
    started = time.monotonic()
    before = manifest(data)
    shutil.copytree(data, destination)
    destination.chmod(0o700)
    if manifest(data) != before or manifest(destination) != before:
        raise RuntimeError('Data changed while freezing; keep the copy and abort cutover')
    report = {'files': before, 'freezeMs': round((time.monotonic() - started) * 1000)}
    index = destination.with_name(destination.name + '.manifest.json')
    index.write_text(json.dumps(report, indent=2)); index.chmod(0o600)
    return report


def archive(snapshot, output):
    snapshot, output = Path(snapshot).absolute(), Path(output).absolute()
    if output.exists() or snapshot in output.parents:
        raise RuntimeError('Archive must be a new file outside the snapshot')
    expected = json.loads(snapshot.with_name(snapshot.name + '.manifest.json').read_text())['files']
    if manifest(snapshot) != expected:
        raise RuntimeError('Frozen snapshot changed before archiving')
    with tarfile.open(output, 'x:gz') as tar:
        output.chmod(0o600)
        tar.add(snapshot, arcname='data', recursive=True)
    seen = {}
    with tarfile.open(output, 'r:gz') as tar:
        for member in tar:
            if not member.isfile():
                if not member.isdir():
                    raise RuntimeError('Archive contains a non-ordinary member')
                continue
            name = Path(member.name).relative_to('data').as_posix()
            stream = tar.extractfile(member)
            value = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                value.update(chunk)
            seen[name] = value.hexdigest()
    if seen != expected:
        raise RuntimeError('Archive verification failed')
    for db in snapshot.rglob('*.sqlite'):
        with closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)) as connection:
            if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Snapshot database integrity check failed')
    report = {'archiveSha256': digest(output), 'verifiedFiles': len(seen), 'archiveVerified': True}
    checksum = output.with_name(output.name + '.sha256')
    checksum.write_text(report['archiveSha256'] + '  ' + output.name + '\n'); checksum.chmod(0o600)
    return report


def probe(url, seconds):
    parsed = urlparse(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.path.endswith('/api/auth/me') or not 0 < seconds <= 300:
        raise ValueError('Probe requires an explicit loopback authentication-read URL and a duration up to 300 seconds')
    started = time.monotonic(); samples = []; unavailable_at = None; longest = 0
    while time.monotonic() - started < seconds:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code; error.close()
        except (OSError, urllib.error.URLError):
            status = 0
        elapsed = round((time.monotonic() - started) * 1000)
        ready = status in (200, 401)
        samples.append({'elapsedMs': elapsed, 'status': status})
        if not ready and unavailable_at is None:
            unavailable_at = elapsed
        if ready and unavailable_at is not None:
            longest = max(longest, elapsed - unavailable_at); unavailable_at = None
        time.sleep(0.2)
    if unavailable_at is not None:
        longest = max(longest, round((time.monotonic() - started) * 1000) - unavailable_at)
    return {'samples': samples, 'longestObservedUnavailableMs': longest, 'endedReady': samples[-1]['status'] in (200, 401)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    stopped = sub.add_parser('freeze')
    stopped.add_argument('data'); stopped.add_argument('snapshot'); stopped.add_argument('--stopped-container', required=True)
    packed = sub.add_parser('archive')
    packed.add_argument('snapshot'); packed.add_argument('output')
    monitor = sub.add_parser('probe')
    monitor.add_argument('url'); monitor.add_argument('output'); monitor.add_argument('--seconds', type=float, default=60)
    args = parser.parse_args()
    if args.action == 'freeze':
        info = json.loads(subprocess.check_output(['docker', 'inspect', args.stopped_container]))[0]
        if info['State']['Running']:
            raise RuntimeError('Stop the application before freezing its data')
        report = freeze(args.data, args.snapshot)
        print(json.dumps({'verifiedFiles': len(report['files']), 'freezeMs': report['freezeMs']}))
    elif args.action == 'archive':
        print(json.dumps(archive(args.snapshot, args.output)))
    else:
        result = probe(args.url, args.seconds)
        output = Path(args.output)
        with output.open('x') as stream:
            output.chmod(0o600); json.dump(result, stream, indent=2)
        print(json.dumps({'longestObservedUnavailableMs': result['longestObservedUnavailableMs'], 'endedReady': result['endedReady']}))


if __name__ == '__main__':
    main()
