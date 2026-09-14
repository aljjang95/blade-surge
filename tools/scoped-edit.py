#!/usr/bin/env python3
"""Repository-scoped text editing. No shell, network, permission or Git writes."""
from __future__ import annotations
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 2 * 1024 * 1024
ALLOWED = {'src', 'test', 'docs', 'tools'}
EXTENSIONS = {'.js', '.mjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.json', '.md', '.txt', '.py'}
DENIED = re.compile(r'(^\.|secret|credential|token|auth|deploy|vault|constitution|governance|owner-goal|policy|scoped-edit)', re.I)
STATE = ROOT / 'work' / 'edit-bridge'

class Refused(ValueError):
    pass

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')

def safe_chain(path: Path) -> None:
    """Reject symlinks, Windows junctions and multiply-linked regular files."""
    relative = path.relative_to(ROOT)
    current = ROOT
    for part in (None, *relative.parts):
        if part is not None:
            current /= part
        if not os.path.lexists(current):
            continue
        s = current.lstat()
        if stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400:
            raise Refused('Links/reparse points are not supported')
        if stat.S_ISREG(s.st_mode) and s.st_nlink != 1:
            raise Refused('Hard-linked files are not supported')

def target(name: str) -> Path:
    if not isinstance(name, str) or not name or '\\' in name or ':' in name:
        raise Refused('Use a repository-relative path with forward slashes')
    parts = name.split('/')
    if any(not re.fullmatch(r'[\w-][\w.\-]*', p) or p.endswith('.') or DENIED.search(p) for p in parts):
        raise Refused('Protected or non-canonical path')
    if any(re.fullmatch(r'(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?', p, re.I) for p in parts):
        raise Refused('Reserved device path')
    scratch = len(parts) >= 4 and parts[:3] == ['work', 'edit-bridge', 'scratch']
    if parts[0] not in ALLOWED and not scratch:
        raise Refused('Path is outside the editable project scope')
    p = ROOT.joinpath(*parts)
    if p.suffix not in EXTENSIONS:
        raise Refused('Only supported text file extensions may be edited')
    safe_chain(p)
    return p

def read_bounded(path: Path) -> bytes:
    safe_chain(path)
    if not path.is_file() or path.stat().st_size > LIMIT:
        raise Refused('Expected an existing file of at most 2 MiB')
    with path.open('rb') as f:
        data = f.read(LIMIT + 1)
    if len(data) > LIMIT or b'\x00' in data:
        raise Refused('Oversized or binary content')
    data.decode('utf-8')
    return data

def ensure_state() -> None:
    safe_chain(STATE)
    (STATE / 'receipts').mkdir(parents=True, exist_ok=True)
    safe_chain(STATE / 'receipts')

def atomic_write(path: Path, data: bytes) -> None:
    safe_chain(path)
    fd, tmp = tempfile.mkstemp(prefix='edit-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def load_manifest(name: str) -> dict:
    p = Path(name)
    p = p if p.is_absolute() else ROOT / p
    try:
        p.relative_to(STATE / 'inputs')
    except ValueError:
        raise Refused('Manifest must be in work/edit-bridge/inputs')
    if '..' in p.parts:
        raise Refused('Non-canonical manifest path')
    value = json.loads(read_bounded(p))
    required = {'path', 'before_sha256', 'old', 'new', 'count'}
    if not isinstance(value, dict) or set(value) != required:
        raise Refused('Manifest requires exactly path, before_sha256, old, new, count')
    return value

def prepare(m: dict) -> tuple[Path, bytes, bytes, dict]:
    p = target(m['path'])
    before = read_bounded(p)
    if not isinstance(m['before_sha256'], str) or digest(before) != m['before_sha256']:
        raise Refused('Source changed: expected SHA-256 does not match')
    old, new, count = m['old'], m['new'], m['count']
    if not isinstance(old, str) or not old or not isinstance(new, str) or type(count) is not int or not 1 <= count <= 1000:
        raise Refused('Expected nonempty old text, new text and count 1..1000')
    a, b = old.encode('utf-8'), new.encode('utf-8')
    if before.count(a) != count:
        raise Refused('Exact replacement count does not match')
    after = before.replace(a, b)
    if len(after) > LIMIT or b'\x00' in after or after == before:
        raise Refused('Replacement must be bounded nonbinary and nonempty as a change')
    info = {'path': m['path'], 'before_sha256': digest(before), 'after_sha256': digest(after), 'count': count}
    info['plan_sha256'] = digest(json_bytes(info))
    return p, before, after, info

def apply(m: dict, expected_plan: str) -> dict:
    ensure_state()
    lock = STATE / 'lock'
    safe_chain(lock)
    with lock.open('x', encoding='utf-8') as f:
        f.write(str(os.getpid()))
    try:
        p, before, after, info = prepare(m)
        if expected_plan != info['plan_sha256']:
            raise Refused('Expected plan digest does not match')
        ident = uuid.uuid4().hex
        journal = STATE / 'receipts' / ident
        journal.mkdir()
        atomic_write(journal / 'before.txt', before)
        receipt = {**info, 'id': ident, 'status': 'prepared'}
        atomic_write(journal / 'receipt.json', json_bytes(receipt))
        if read_bounded(p) != before:
            raise Refused('Source changed before application')
        atomic_write(p, after)
        if read_bounded(p) != after:
            raise Refused('Write verification failed; preserve journal for recovery')
        receipt['status'] = 'applied'
        atomic_write(journal / 'receipt.json', json_bytes(receipt))
        return receipt
    finally:
        lock.unlink()

def rollback(ident: str) -> dict:
    if not re.fullmatch(r'[a-f0-9]{32}', ident):
        raise Refused('Invalid receipt identifier')
    ensure_state()
    lock = STATE / 'lock'
    safe_chain(lock)
    with lock.open('x', encoding='utf-8') as f:
        f.write(str(os.getpid()))
    try:
        journal = STATE / 'receipts' / ident
        r = json.loads(read_bounded(journal / 'receipt.json'))
        p = target(r['path'])
        before = read_bounded(journal / 'before.txt')
        if digest(before) != r['before_sha256']:
            raise Refused('Backup digest mismatch')
        current = read_bounded(p)
        if digest(current) not in {r['before_sha256'], r['after_sha256']}:
            raise Refused('Later edits exist; rollback will not overwrite them')
        if current != before:
            atomic_write(p, before)
        if read_bounded(p) != before:
            raise Refused('Rollback verification failed')
        r['status'] = 'rolled-back'
        atomic_write(journal / 'receipt.json', json_bytes(r))
        return r
    finally:
        lock.unlink()

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('info').add_argument('path')
    for command in ('plan', 'apply'):
        p = sub.add_parser(command)
        p.add_argument('manifest')
        if command == 'apply':
            p.add_argument('--expected-plan', required=True)
    sub.add_parser('rollback').add_argument('receipt')
    args = parser.parse_args()
    if json.loads((ROOT / 'package.json').read_text('utf-8')).get('name') != 'blade-surge':
        raise Refused('This tool is bound to the blade-surge repository')
    if args.command == 'info':
        data = read_bounded(target(args.path))
        result = {'path': args.path, 'bytes': len(data), 'sha256': digest(data)}
    elif args.command == 'rollback':
        result = rollback(args.receipt)
    else:
        m = load_manifest(args.manifest)
        if args.command == 'apply':
            result = apply(m, args.expected_plan)
        else:
            _, before, after, result = prepare(m)
            result['diff'] = ''.join(difflib.unified_diff(before.decode('utf-8').splitlines(True), after.decode('utf-8').splitlines(True), fromfile=m['path'], tofile=m['path']))
    print(json_bytes(result).decode('utf-8'), end='')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({'status': 'refused', 'reason': str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
