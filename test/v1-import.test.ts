import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { v1Harness } from './helpers/v1-harness';
import { GACHA } from '../src/data/shop.js';

const NOW = Date.UTC(2026, 9, 20);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/saves/${name}`, import.meta.url), 'utf8');
const save = (name: string) => JSON.parse(fixture(name));
const installId = () => crypto.randomUUID();

const DAY = 86400000;
/** ageDays: 서버가 계정을 만든 뒤 지난 날수(정화 상한의 경과일 기준). 세이브 안의 created는 상한에 쓰이지 않는다. */
async function imported(name: string, ageDays = 0) {
  const h = await v1Harness();
  h.setNow(NOW - ageDays * DAY);
  const first = await h.session();
  h.setNow(NOW);
  const a = ageDays ? { ...first, ...await h.session(first.deviceKey) } : first;
  const id = installId();
  const r = await h.send('POST', '/import', { installId: id, save: save(name) }, a.token);
  return { h, a, r, id };
}

describe('MMO P1-G 로컬 세이브 임포트·정화 (골든 세이브)', () => {
  test('신규 세이브: 그대로 그림자 임포트', async () => {
    const { h, a, r } = await imported('new.json');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('shadow');
    expect(r.body.report.clamped).toEqual({});
    expect(r.body.doc.gold).toBe(12000);
    expect((await h.send('GET', '/me', undefined, a.token)).body.legacy.status).toBe('shadow');
  });

  test('중반 세이브: 진행·장착·장비 보존, 절삭 없음', async () => {
    const { r } = await imported('mid.json', 10);
    const src = save('mid.json');
    expect(r.body.report.clamped).toEqual({});
    expect(r.body.doc.gold).toBe(2_400_000);
    expect(r.body.doc.progress.unlocked).toBe(25);
    expect(r.body.doc.heroes.knight.level).toBe(32);
    expect(r.body.doc.inventory).toEqual(src.inventory);
    expect(r.body.doc.heroes.knight.equip).toEqual(src.heroes.knight.equip);
    expect(r.body.report.days).toBe(10);
  });

  test('후반 세이브: 60일 경과 상한 안이면 그대로', async () => {
    const { r } = await imported('late.json', 60);
    expect(r.body.report.clamped).toEqual({});
    expect(r.body.doc.gold).toBe(90_000_000);
    expect(r.body.doc.progress.unlocked).toBe(60);
    expect(r.body.doc.inventory.length).toBe(30);
  });

  test('변조 골드 1e15: 절삭 보고서, 결제 기록 제외, 감사·보상 보류, 원문 보존', async () => {
    const { h, a, r } = await imported('gold-1e15.json');
    expect(r.body.status).toBe('shadow');
    expect(r.body.report.severe).toBe(true);
    expect(r.body.report.clamped.gold.from).toBe(1e15);
    expect(r.body.doc.gold).toBe(r.body.report.clamped.gold.to);
    expect(r.body.doc.gold).toBeLessThan(1e8);
    expect(r.body.report.clamped.gems.from).toBe(9e12);
    expect(r.body.doc.purchases).toEqual([]);
    expect(r.body.doc.spentKRW).toBe(0);
    expect(r.body.doc.vip).toBe(0);
    expect(r.body.doc.pass.premium).toBe(false);
    expect(r.body.report.droppedPaid.spentKRW).toBe(999000);
    expect(h.db.sqlite.query("SELECT kind FROM sanctions WHERE account_id = ?").all(a.accountId)).toEqual([{ kind: 'payout_hold' }]);
    expect(h.db.sqlite.query("SELECT kind FROM audit_flags WHERE account_id = ?").all(a.accountId)).toEqual([{ kind: 'import-clamped' }]);
    const raw = h.db.sqlite.query('SELECT doc FROM legacy_saves WHERE account_id = ?').get(a.accountId) as { doc: string };
    expect(JSON.parse(raw.doc).gold).toBe(1e15);
  });

  test('손상 JSON은 400, 아무것도 저장하지 않는다', async () => {
    const h = await v1Harness();
    h.setNow(NOW);
    const a = await h.session();
    const r = await h.send('POST', '/import', `{"installId":"${installId()}","save":${fixture('corrupt.json')}}`, a.token);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('json');
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM legacy_saves').get()).toEqual({ n: 0 });
  });

  test('구버전 세이브(스키마 없음·레거시 천장·SP 이전 스킬): 이관 규칙 그대로', async () => {
    const { r } = await imported('legacy-v0.json');
    expect(r.body.status).toBe('shadow');
    expect(r.body.doc.schemaVersion).toBe(1);
    expect(r.body.doc.gacha.pity).toBe(Math.min(77, GACHA.pity - 1));
    expect(r.body.doc.heroes.knight.grade).toBeString();
    expect(r.body.doc.gold).toBe(50_000);
  });

  test('재임포트 거부(같은 계정·같은 설치 id), 진행한 계정은 덮어쓰지 않는다', async () => {
    const { h, a, id } = await imported('mid.json');
    expect((await h.send('POST', '/import', { installId: installId(), save: save('late.json') }, a.token)).body.error).toBe('already-imported');
    const b = await h.session();
    expect((await h.send('POST', '/import', { installId: id, save: save('late.json') }, b.token)).body.error).toBe('install-imported');
    // b는 서버에서 먼저 진행했다(명령 1회) → 로컬 세이브는 보관만, 문서는 그대로.
    await h.cmd(b.token, 'claimMail', [1]);
    const late = await h.send('POST', '/import', { installId: installId(), save: save('late.json') }, b.token);
    expect(late.body.status).toBe('rejected');
    expect(late.body.report.reason).toBe('account-has-progress');
    expect(late.body.doc.gold).toBe(12000);
  });

  test('created 조작(과거로)은 무시된다: 상한의 경과일은 서버 계정 생성 시각 기준', async () => {
    const h = await v1Harness();
    h.setNow(NOW);
    const a = await h.session();
    const s = save('new.json'); s.created = 1; s.gold = 5e9;
    const r = await h.send('POST', '/import', { installId: installId(), save: s }, a.token);
    expect(r.body.report.created).toBe(NOW);
    expect(r.body.report.days).toBe(1);
    expect(r.body.doc.gold).toBeLessThan(5e9);
    // 같은 세이브를 created만 바꿔 다른 계정(같은 서버 계정 나이)에 올려도 결과가 같다.
    const b = await h.session();
    const s2 = save('new.json'); s2.created = Date.UTC(2026, 6, 1); s2.gold = 5e9;
    const r2 = await h.send('POST', '/import', { installId: installId(), save: s2 }, b.token);
    expect(r2.body.doc.gold).toBe(r.body.doc.gold);
    expect(r2.body.report.days).toBe(1);
  });

  test('방금 만든 계정에 후반 세이브를 올리면 서버 기준 상한으로 절삭되고 원문은 보존된다', async () => {
    const { h, a, r } = await imported('late.json', 0);
    expect(r.body.report.clamped.gold.from).toBe(90_000_000);
    expect(r.body.doc.gold).toBeLessThan(90_000_000);
    const raw = h.db.sqlite.query('SELECT doc FROM legacy_saves WHERE account_id = ?').get(a.accountId) as { doc: string };
    expect(JSON.parse(raw.doc).gold).toBe(90_000_000);
  });

  test('그림자 스냅샷은 임포트가 먼저다: 임포트 전·거부된 임포트 뒤에는 409, 임포트 뒤에는 통과', async () => {
    const h = await v1Harness();
    h.setNow(NOW - 60 * DAY);
    const first = await h.session();
    h.setNow(NOW);
    const a = { ...first, ...await h.session(first.deviceKey) };
    const snap = (cid: string, body: unknown = save('late.json')) => h.send('POST', '/shadow/snapshot', { cid, save: body }, a.token);
    const before = (await h.send('GET', '/me', undefined, a.token)).body;
    const early = await snap('snap-before-import');
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('import-required');
    expect((await h.send('GET', '/me', undefined, a.token)).body.rev).toBe(before.rev);
    expect((await h.send('POST', '/import', { installId: installId(), save: save('mid.json') }, a.token)).body.status).toBe('shadow');
    const later = await snap('snap-after-import');
    expect(later.status).toBe(200);
    expect(later.body.clamped).toEqual({});
    // 서버에서 먼저 진행해 임포트가 rejected 된 계정도 스냅샷으로 우회할 수 없다.
    const bad = await h.session();
    await h.cmd(bad.token, 'claimMail', [1]);
    expect((await h.send('POST', '/import', { installId: installId(), save: save('mid.json') }, bad.token)).body.status).toBe('rejected');
    const blocked = await h.send('POST', '/shadow/snapshot', { cid: 'snap-rejected-1', save: save('late.json') }, bad.token);
    expect(blocked.body.error).toBe('import-required');
  });
});
