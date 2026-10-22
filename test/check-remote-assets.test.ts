import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// tools/check-remote-assets.mjs: 현재 매니페스트와 --previous(이전 릴리스) 매니페스트의 remote 파일이 대상 폴더에 같은 해시로 남아 있는지 본다.
const sha16 = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const run = (args: string[]) => {
  const result = Bun.spawnSync(['node', 'tools/check-remote-assets.mjs', ...args], { cwd: new URL('../', import.meta.url).pathname });
  return { code: result.exitCode, out: result.stdout.toString() };
};

test('이전 릴리스 매니페스트의 remote 파일이 호스트에서 사라졌으면 실패한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-remote-'));
  try {
    mkdirSync(join(dir, 'host/img'), { recursive: true }); mkdirSync(join(dir, 'prev'), { recursive: true });
    writeFileSync(join(dir, 'host/img/a.webp'), 'new-a');
    const now = { schema: 'blade-surge.asset-manifest.v1', hashLength: 16, remote: { 'img/a.webp': { h: sha16('new-a'), b: 5, g: 'x' } } };
    const old = { schema: 'blade-surge.asset-manifest.v1', hashLength: 16, remote: { 'img/a.webp': { h: sha16('old-a'), b: 5, g: 'x' }, 'img/gone.webp': { h: sha16('g'), b: 1, g: 'x' } } };
    writeFileSync(join(dir, 'now.json'), JSON.stringify(now)); writeFileSync(join(dir, 'prev/asset-manifest.json'), JSON.stringify(old));
    const clean = run([join(dir, 'now.json'), join(dir, 'host')]);
    expect(clean.code).toBe(0);
    const withPrevious = run([join(dir, 'now.json'), join(dir, 'host'), '--previous', join(dir, 'prev/asset-manifest.json')]);
    expect(withPrevious.code).toBe(1);
    expect(withPrevious.out).toContain('"previousFiles":2');
    expect(withPrevious.out).toContain('img/gone.webp(이전 릴리스 prev): 호스트에 없음');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
