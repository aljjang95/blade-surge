import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('editor', Path(__file__).parents[1] / 'scoped-edit.py')
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)

class EditorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.root_patch = patch.object(e, 'ROOT', self.root)
        self.state_patch = patch.object(e, 'STATE', self.root / 'work/edit-bridge')
        self.root_patch.start(); self.state_patch.start()
        self.addCleanup(self.root_patch.stop); self.addCleanup(self.state_patch.stop)
        (self.root / 'src').mkdir()
        self.path = self.root / 'src/game.js'
        self.before = 'const 이름 = "원본";\r\n'.encode('utf-8')
        self.path.write_bytes(self.before)
        self.m = {'path': 'src/game.js', 'before_sha256': e.digest(self.before), 'old': '원본', 'new': '수정', 'count': 1}

    def apply(self):
        return e.apply(self.m, e.prepare(self.m)[3]['plan_sha256'])

    def test_plan_is_read_only(self):
        e.prepare(self.m)
        self.assertEqual(self.path.read_bytes(), self.before)
        self.assertFalse(e.STATE.exists())

    def test_apply_rollback_preserves_korean_and_crlf(self):
        r = self.apply()
        self.assertEqual(self.path.read_bytes(), self.before.replace('원본'.encode(), '수정'.encode()))
        self.assertEqual(e.rollback(r['id'])['status'], 'rolled-back')
        self.assertEqual(self.path.read_bytes(), self.before)
        e.rollback(r['id'])
        self.assertEqual(self.path.read_bytes(), self.before)

    def test_changed_source_refused(self):
        self.path.write_text('later edit', encoding='utf-8')
        with self.assertRaises(e.Refused): self.apply()
        self.assertEqual(self.path.read_text(), 'later edit')

    def test_wrong_plan_refused(self):
        with self.assertRaises(e.Refused): e.apply(self.m, '0' * 64)
        self.assertEqual(self.path.read_bytes(), self.before)

    def test_ambiguous_count_refused(self):
        for count in (0, 2, True, 1001):
            with self.subTest(count=count), self.assertRaises(e.Refused):
                e.prepare({**self.m, 'count': count})

    def test_empty_old_and_noop_refused(self):
        for changes in ({'old': ''}, {'new': '원본'}, {'new': '\x00'}):
            with self.subTest(changes=changes), self.assertRaises(e.Refused): e.prepare({**self.m, **changes})

    def test_path_boundaries(self):
        denied = ['../outside.js', '/src/game.js', 'src/../game.js', 'C:/game.js', 'src\\game.js', '.git/config', 'docs/.env', 'tools/deploy.mjs', 'docs/constitution.md', 'src/CON.txt', 'src/a.js:stream', 'src/a.js.', 'work/other/a.js', 'src/icon.png', 'tools/scoped-edit.py']
        for p in denied:
            with self.subTest(path=p), self.assertRaises(e.Refused): e.target(p)

    def test_later_changes_block_rollback(self):
        r = self.apply(); self.path.write_text('owner edit', encoding='utf-8')
        with self.assertRaises(e.Refused): e.rollback(r['id'])
        self.assertEqual(self.path.read_text(), 'owner edit')

    def test_backup_tamper_refused(self):
        r = self.apply()
        (e.STATE / 'receipts' / r['id'] / 'before.txt').write_text('bad')
        with self.assertRaises(e.Refused): e.rollback(r['id'])

    def test_lock_is_not_stolen(self):
        e.ensure_state(); (e.STATE / 'lock').write_text('other owner')
        with self.assertRaises(FileExistsError): self.apply()
        self.assertEqual((e.STATE / 'lock').read_text(), 'other owner')

    def test_second_apply_refused(self):
        self.apply()
        with self.assertRaises(e.Refused): self.apply()

    def test_unknown_receipt_and_traversal_refused(self):
        for ident in ('../a', 'z'*32, ''):
            with self.subTest(ident=ident), self.assertRaises(e.Refused): e.rollback(ident)
