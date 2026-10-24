// 기존 이용자 보호(BM_DESIGN 11.6-1) 회귀: 소셜 프로필 생성 시각(서버 기록)만이 정책 1 증거이고,
// 증거 없는 정책 1 주장은 정책 2 + 소환권 10 보상(계정당 1회)으로 처리된다.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { newDeviceKey, ORIGIN, v1Harness } from './helpers/v1-harness';
import { HERO_LEGACY_COMPENSATION, HERO_LEGACY_IDS, HERO_STARTER_POLICY_SINCE } from '../src/data/hero-roster.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 26); // 컷오버(2026-10-24T07:26:22Z) 뒤
const BEFORE = HERO_STARTER_POLICY_SINCE - 5 * DAY;
const AFTER = HERO_STARTER_POLICY_SINCE + 1 * DAY;
const save = (name = 'new.json') => JSON.parse(readFileSync(new URL(`./fixtures/saves/${name}`, import.meta.url), 'utf8'));
const installId = () => crypto.randomUUID();
const COMP = HERO_LEGACY_COMPENSATION.tickets;

/** 소셜 프로필을 profileAt 시각에 만들고(null이면 만들지 않음) NOW에 세션을 연다. */
async function setup(profileAt: number | null, env: Record<string, string> = {}) {
  const h = await v1Harness({ social: true, env });
  const key = newDeviceKey();
  if (profileAt !== null) {
    h.setNow(profileAt);
    expect((await h.social!.call('POST', '/profile', key, { name: '기존모험가' })).status).toBe(201);
  }
  h.setNow(NOW);
  const a = await h.session(key);
  return { h, a, key };
}
const importSave = (h: any, a: any, s: unknown = save()) => h.send('POST', '/import', { installId: installId(), save: s }, a.token);
const legacyCount = (h: any) => (h.db.sqlite.query('SELECT COUNT(*) AS n FROM legacy_saves').get() as { n: number }).n;
const compRows = (h: any) => (h.db.sqlite.query("SELECT COUNT(*) AS n FROM wallet_ledger WHERE op_id LIKE 'legacy-comp:%'").get() as { n: number }).n;
const me = async (h: any, a: any) => (await h.send('GET', '/me', undefined, a.token)).body;
const policy2Save = () => ({ ...save(), roster: { policy: 2, owned: ['knight'], starter: 'knight', starterChosen: true, paid: [] } });

describe('기존 이용자 보호: 서버 증거(소셜 프로필 생성 시각)와 보상', () => {
  test('1. 컷오버 전 소셜 프로필 + 옛 저장: 정책 1, 5명 소유, 증거 social-profile', async () => {
    const { h, a } = await setup(BEFORE);
    const r = await importSave(h, a);
    expect(r.status).toBe(200);
    expect(r.body.doc.roster.policy).toBe(1);
    expect([...r.body.doc.roster.owned].sort()).toEqual([...HERO_LEGACY_IDS].sort());
    expect(r.body.report.roster.grandfathered).toBe(true);
    expect(r.body.report.roster.legacyClaim).toBe(false);
    expect(r.body.report.roster.proof).toBe('social-profile');
  });

  test('2. 컷오버 뒤 프로필 / 프로필 없음 + 옛 저장: 정책 2, 1명, legacyClaim, 그림자는 보상 없음', async () => {
    for (const at of [AFTER, null]) {
      const { h, a } = await setup(at);
      const before = save().tickets;
      const r = await importSave(h, a);
      expect(r.body.status).toBe('shadow');
      expect(r.body.doc.roster.policy).toBe(2);
      expect(r.body.doc.roster.owned.length).toBe(1);
      expect(r.body.report.roster.grandfathered).toBe(false);
      expect(r.body.report.roster.legacyClaim).toBe(true);
      expect(r.body.report.compensation).toBeUndefined();
      expect(r.body.doc.tickets).toBe(before);
    }
  });

  test('3. save.created 위조(아주 옛날)여도 증거 없으면 정책 2', async () => {
    const { h, a } = await setup(null);
    const s = save(); s.created = 1;
    const r = await importSave(h, a, s);
    expect(r.body.doc.roster.policy).toBe(2);
    expect(r.body.doc.roster.owned.length).toBe(1);
    expect(r.body.report.roster.legacyClaim).toBe(true);
    // 컷오버 뒤 프로필에 위조 created를 더해도 같다.
    const b = await setup(AFTER);
    const s2 = save(); s2.created = Date.UTC(2026, 6, 1);
    const r2 = await importSave(b.h, b.a, s2);
    expect(r2.body.doc.roster.policy).toBe(2);
  });

  test('4. roster.policy 2 저장은 legacyClaim false', async () => {
    const { h, a } = await setup(null);
    const r = await importSave(h, a, policy2Save());
    expect(r.body.doc.roster.policy).toBe(2);
    expect(r.body.report.roster.legacyClaim).toBe(false);
    const b = await setup(null, { V1_SERVER_AUTHORITY_PERCENT: '100' });
    const t0 = save().tickets;
    const r2 = await importSave(b.h, b.a, policy2Save());
    expect(r2.body.status).toBe('imported');
    expect(r2.body.report.compensation).toBeUndefined();
    expect(r2.body.doc.tickets).toBe(t0);
  });

  test('5. 서버 권위 계정: 증거 없는 옛 저장 import 즉시 소환권 +10, 세션 재발급해도 추가 지급 없음', async () => {
    const { h, a, key } = await setup(null, { V1_SERVER_AUTHORITY_PERCENT: '100' });
    expect(a.authority).toBe('server');
    const base = save().tickets;
    const r = await importSave(h, a);
    expect(r.body.status).toBe('imported');
    expect(r.body.report.compensation).toEqual({ tickets: COMP });
    expect(r.body.doc.tickets).toBe(base + COMP);
    for (let i = 0; i < 2; i++) await h.session(key);
    const m = await me(h, a);
    expect(m.doc?.tickets ?? m.state?.tickets ?? m.tickets).toBe(base + COMP);
    expect(compRows(h)).toBe(0); // 가져오기 보상은 import 원장 한 줄에 포함(별도 legacy-comp 행 없음)
  });

  test('6. 그림자 import(legacyClaim) 뒤 컷오버 세션: +10 정확히 한 번, 원장 legacy-comp 1행', async () => {
    const { h, a, key } = await setup(null);
    const base = save().tickets;
    const r = await importSave(h, a);
    expect(r.body.status).toBe('shadow');
    expect(r.body.doc.tickets).toBe(base);
    h.env.V1_SERVER_AUTHORITY_PERCENT = '100';
    const s1 = await h.session(key);
    expect(s1.authority).toBe('server');
    const read = async () => {
      const m = await me(h, s1);
      return (m.doc ?? m.state ?? m).tickets;
    };
    expect(await read()).toBe(base + COMP);
    await h.session(key); await h.session(key);
    expect(await read()).toBe(base + COMP);
    expect(compRows(h)).toBe(1);
  });

  test('7. 증거 있는 그림자 import: 컷오버 세션 보상 없음, 정책 1 유지, shadow/snapshot 뒤에도 유지', async () => {
    const { h, a, key } = await setup(BEFORE);
    const base = save().tickets;
    const r = await importSave(h, a);
    expect(r.body.status).toBe('shadow');
    expect(r.body.doc.roster.policy).toBe(1);
    const snap = await h.send('POST', '/shadow/snapshot', { cid: 'snap-evidence-01', save: save() }, a.token);
    expect(snap.status).toBe(200);
    h.env.V1_SERVER_AUTHORITY_PERCENT = '100';
    const s1 = await h.session(key);
    expect(s1.authority).toBe('server');
    const m = await me(h, s1);
    const doc = m.doc ?? m.state ?? m;
    expect(doc.tickets).toBe(base);
    expect(doc.roster.policy).toBe(1);
    expect(compRows(h)).toBe(0);
  });

  test('8. 허브 /internal/evidence 실패: /import 503 social-unavailable, legacy_saves 행 없음', async () => {
    const { h, a } = await setup(BEFORE);
    const real = h.social!.hub;
    (h.env as any).SOCIAL = { idFromName: (n: string) => n, get: () => ({ fetch: (req: Request) =>
      new URL(req.url).pathname === '/internal/evidence' ? Promise.resolve(new Response('{}', { status: 500 })) : real.fetch(req) }) };
    const r = await importSave(h, a);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('social-unavailable');
    expect(legacyCount(h)).toBe(0);
  });

  test('9. 차단된 소셜 프로필은 증거가 아니다', async () => {
    const { h, a } = await setup(BEFORE);
    h.social!.sqlite.query('UPDATE players SET banned = 1 WHERE id = ?').run(a.accountId);
    const r = await importSave(h, a);
    expect(r.status).toBe(200);
    expect(r.body.doc.roster.policy).toBe(2);
    expect(r.body.report.roster.legacyClaim).toBe(true);
  });

  test('10. 정화 경과일은 계정 나이가 아니라 소셜 나이 기준', async () => {
    const { h, a } = await setup(NOW - 60 * DAY);
    const r = await importSave(h, a, save('mid.json'));
    expect(r.body.report.days).toBe(60);
    const b = await setup(null);
    const r2 = await importSave(b.h, b.a, save('mid.json'));
    expect(r2.body.report.days).toBe(1);
  });

  test('11. 공개 소셜 라우터로 /internal/evidence는 404, 허브 직접 호출도 헤더 없으면 404', async () => {
    const { handleSocialRequest } = await import('../packages/tll-social/src/server/router');
    const { h, a } = await setup(BEFORE);
    const body = JSON.stringify({ playerId: a.accountId });
    for (const headers of [{}, { 'x-social-internal': '1' }]) {
      const res = await handleSocialRequest(new Request(ORIGIN + '/api/social/internal/evidence', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body }),
        { APP_ORIGIN: ORIGIN, SOCIAL: h.social!.namespace as any }, { gameId: 'blade-surge' } as any);
      expect(res.status).toBe(404);
    }
    const direct = await h.social!.hub.fetch(new Request('https://social.internal/internal/evidence', { method: 'POST', body }));
    expect(direct.status).toBe(404);
    const ok = await h.social!.hub.fetch(new Request('https://social.internal/internal/evidence', { method: 'POST', headers: { 'x-social-internal': '1' }, body }));
    expect(ok.status).toBe(200);
    expect((await ok.json() as any).createdAt).toBe(BEFORE);
  });
});
