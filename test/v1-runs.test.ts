import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { stageDef } from '../src/data/stages.js';
import { applyDifficulty, DIFFICULTIES } from '../src/game/difficulty.js';
import { killDrops, plausibilityFor, referenceRooms, rollRunLoot, serverRating, stageRankValues } from '../src/shared/settlement.js';
import { rollKillLoot } from '../src/shared/loot-roll.js';
import { lootTable } from '../src/data/loot-tables.js';
import { seededStream } from '../src/shared/rng.js';

const STAGE = applyDifficulty(stageDef(1, 1), DIFFICULTIES.story);
const LIMITS = plausibilityFor(STAGE);
const legit = (over: Record<string, unknown> = {}) => ({ win: true, elapsedMs: LIMITS.minClearMs + 30000, kills: { normal: 40, elite: 2, boss: 1 },
  roomsCleared: 5, hpLost: 500, revives: 0, damageDealt: 1000, stars: 3, ...over });

async function ready() {
  const h = await v1Harness();
  const a = await h.session();
  let n = 0;
  const start = async (token = a.token) => {
    const r = await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'run-start-' + String(++n).padStart(4, '0') }, token);
    expect(r.status).toBe(200);
    return r.body as { runId: string; lootSeed: number; expiresAt: number };
  };
  const settle = (runId: string, body: unknown, token?: string) => h.send('POST', `/runs/${runId}/settle`, body, token ?? a.token);
  const gold = async () => (await h.send('GET', '/me', undefined, a.token)).body.doc;
  return { h, a, start, settle, gold };
}

describe('MMO P1-E 런 티켓·정산', () => {
  test('정상 정산: 서버 규칙으로 보상, 영수증과 /me 일치, 첫 클리어 해금', async () => {
    const { h, start, settle, gold } = await ready();
    const t = await start();
    h.advance(LIMITS.minClearMs + 40000);
    const r = await settle(t.runId, legit());
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('ok');
    expect(r.body.first).toBe(true);
    expect(r.body.got.find((g: any) => g.k === 'gems')?.n).toBe(STAGE.rewards.firstGems);
    const doc = await gold();
    expect(doc.progress.unlocked).toBe(2);
    expect(doc.gold).toBe(r.body.doc.gold);
    expect(doc.gold).toBeGreaterThan(12000 + STAGE.rewards.gold);
    // 같은 정산 재전송은 같은 영수증, 추가 지급 없음
    const again = await settle(t.runId, legit({ kills: { normal: 400, elite: 30, boss: 1 } }));
    expect(again.body.replayed).toBe(true);
    expect((await gold()).gold).toBe(doc.gold);
  });

  test('클라이언트 미리보기 드랍 = 서버 지급 드랍(같은 lootSeed)', async () => {
    const { h, start, settle } = await ready();
    const t = await start();
    // 클라이언트 쪽: 처치마다 같은 순수 함수로 미리 굴린다.
    const values = stageRankValues(STAGE);
    let previewGold = 0;
    const previewItems: string[] = [];
    for (const [rank, n] of [['normal', 40], ['elite', 2], ['boss', 1]] as const) for (let k = 0; k < n; k++) {
      const drops = rollKillLoot(lootTable(1, rank, 'story'), seededStream(t.lootSeed, rank, k), { baseGold: values[rank].gold, scale: STAGE.scale, rank });
      for (const d of drops) { if (d.kind === 'gold') previewGold += d.amount! * d.count!; if (d.kind === 'item') previewItems.push(d.id!); }
    }
    h.advance(LIMITS.minClearMs + 40000);
    const r = await settle(t.runId, legit());
    const items = r.body.doc.inventory.map((x: any) => x.id);
    for (const id of previewItems) expect(items).toContain(id);
    const server = rollRunLoot(STAGE, t.lootSeed, legit() as any);
    expect(server.gold).toBe(previewGold);
    expect(server.items.map((x: any) => x.id)).toEqual(previewItems);
    expect(killDrops(STAGE, t.lootSeed, 'boss', 0)).toEqual(killDrops(STAGE, t.lootSeed, 'boss', 0));
  });

  test('위조 정산 매트릭스 10종: 모두 지급 0', async () => {
    const { h, a, start, settle, gold } = await ready();
    const other = await h.session();
    const before = await gold();
    const cases: [string, (runId: string) => Promise<{ status: number; body: any }>][] = [];
    // 1) 중복: 이미 정산된(거부된) 티켓 재전송
    // 2) 만료 3) 타인 티켓 4) 초단시간 5) 처치 수 초과 6) 피해 초과 7) 소모품 초과 8) 음수 9) NaN 10) 알 수 없는 필드
    const forged: Record<string, () => Promise<{ status: number; body: any }>> = {
      duplicate: async () => { const t = await start(); await settle(t.runId, legit({ elapsedMs: 10 })); return settle(t.runId, legit()); },
      expired: async () => { const t = await start(); h.advance(2 * 3600 * 1000 + 1); const s = await h.session(a.deviceKey); return settle(t.runId, legit(), s.token); },
      foreignTicket: async () => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return settle(t.runId, legit(), other.token); },
      tooFast: async () => { const t = await start(); h.advance(2000); return settle(t.runId, legit({ elapsedMs: 2000 })); },
      tooManyKills: async () => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return settle(t.runId, legit({ kills: { normal: LIMITS.kills.normal + 1, elite: 2, boss: 1 } })); },
      tooMuchDamage: async () => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return settle(t.runId, legit({ damageDealt: 1e14 })); },
      consumables: async () => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return settle(t.runId, legit({ consumables: { potion: 5 } })); },
      negative: async () => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return settle(t.runId, legit({ kills: { normal: -5, elite: 0, boss: 1 } })); },
      nan: async () => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return settle(t.runId, '{"win":true,"elapsedMs":NaN,"kills":{}}'); },
      unknownField: async () => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return settle(t.runId, legit({ gold: 999999 })); },
    };
    const results: Record<string, any> = {};
    for (const [name, run] of Object.entries(forged)) {
      // 정산마다 세션을 새로 받는다(만료 케이스가 시계를 옮긴다).
      a.token = (await h.session(a.deviceKey)).token; other.token = (await h.session(other.deviceKey)).token;
      const r = await run();
      results[name] = { status: r.status, verdict: r.body.verdict, got: r.body.got?.length ?? 0, loot: r.body.loot?.length ?? 0 };
      expect(r.status === 200 ? r.body.verdict : 'refused').not.toBe('ok');
      expect(r.body.got?.length ?? 0).toBe(0);
      expect(r.body.loot?.length ?? 0).toBe(0);
    }
    const s = await h.session(a.deviceKey);
    const after = (await h.send('GET', '/me', undefined, s.token)).body.doc;
    // 에너지 외에는 아무것도 늘지 않았다.
    for (const key of ['gold', 'gems', 'stones', 'stones2', 'stones3', 'fragments', 'tickets', 'transcendStones']) expect(after[key]).toBe(before[key]);
    expect(after.inventory.length).toBe(before.inventory.length);
    expect(after.progress.unlocked).toBe(1);
    expect(h.db.sqlite.query("SELECT COUNT(*) AS n FROM audit_flags").get()).not.toEqual({ n: 0 });
    void cases; void results;
  });

  test('티켓 없는/모르는 런, 잠긴 스테이지, 미정산 티켓 상한', async () => {
    const { h, a, start, settle } = await ready();
    expect((await settle('0'.repeat(32), legit())).status).toBe(404);
    expect((await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-5', heroId: 'knight', cid: 'locked-000001' }, a.token)).body.error).toBe('locked');
    expect((await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '9-9', heroId: 'knight', cid: 'bad-0000001' }, a.token)).status).toBe(400);
    for (let i = 0; i < 5; i++) await start();
    expect((await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'sixth-00001' }, a.token)).status).toBe(429);
  });

  test('티켓 시작은 cid 멱등이며 에너지를 한 번만 쓴다', async () => {
    const { h, a } = await ready();
    const body = { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'same-start-1' };
    const first = await h.send('POST', '/runs/start', body, a.token);
    const again = await h.send('POST', '/runs/start', body, a.token);
    expect(again.body.runId).toBe(first.body.runId);
    expect((await h.send('GET', '/me', undefined, a.token)).body.doc.energy).toBe(100 - STAGE.energy);
  });

  test('별·풀클리어는 서버가 계산한다: 위조 {stars:3, fullClear:true}는 보상을 못 받는다', async () => {
    const forgedFacts = legit({ stars: 3, fullClear: true, roomsCleared: 1, hpLost: 2800 });
    const honestFacts = legit({ roomsCleared: referenceRooms(STAGE), hpLost: 0 });
    delete (forgedFacts as any).stars; delete (honestFacts as any).stars;
    const run = async (extra: Record<string, unknown>, base: Record<string, unknown>) => {
      const { h, a, start, settle, gold } = await ready();
      const before = await gold();
      const t = await start();
      h.advance(LIMITS.minClearMs + 40000);
      const r = await settle(t.runId, { ...base, ...extra });
      expect(r.status).toBe(200);
      const after = await gold();
      return { r, stars: after.progress.stars['1-1'], goldGain: after.gold - before.gold, items: after.inventory.length - before.inventory.length };
    };
    const honest = await run({}, honestFacts);
    // 위조: 클라이언트가 3별·풀클리어를 주장하지만 방 1개·피해 과다 → 서버 계산은 1별·풀클리어 없음.
    const forged = await run({ stars: 3, fullClear: true }, forgedFacts);
    expect(forged.r.body.stars).toBe(1);
    expect(forged.r.body.fullClear).toBe(false);
    expect(forged.stars).toBe(1);
    expect(honest.r.body.stars).toBe(3);
    expect(honest.r.body.fullClear).toBe(true);
    // 풀클리어 보너스(골드 +40%, 장비 1개)는 위조 쪽에 없다.
    expect(forged.r.body.got.find((g: any) => g.k === 'gold')?.n ?? 0).toBeLessThan(honest.r.body.got.find((g: any) => g.k === 'gold')?.n ?? 0);
    expect(forged.items).toBeLessThan(honest.items);
    // 순수 함수 경계: 부활이 있으면 1별, stars·fullClear 필드는 계산에 영향이 없다.
    expect(serverRating(STAGE, { win: true, roomsCleared: referenceRooms(STAGE), hpLost: 0, revives: 1, stars: 3, fullClear: true } as any, 1000).stars).toBe(1);
    expect(serverRating(STAGE, { win: true, roomsCleared: 0, hpLost: 0, stars: 3, fullClear: true } as any, 1000)).toMatchObject({ stars: 2, fullClear: false });
    expect(serverRating(STAGE, { win: true, roomsCleared: 0, hpLost: 900, stars: 3, fullClear: true } as any, 1000)).toMatchObject({ stars: 1, fullClear: false });
  });

  test('패배 정산은 처치 경험치만 남고 재화·진행은 없다', async () => {
    const { h, start, settle, gold } = await ready();
    const before = await gold();
    const t = await start();
    h.advance(30000);
    const r = await settle(t.runId, { win: false, elapsedMs: 25000, kills: { normal: 10 } });
    expect(r.status).toBe(200);
    expect(r.body.got).toEqual([]);
    const after = await gold();
    expect(after.gold).toBe(before.gold);
    expect(after.progress.unlocked).toBe(1);
    expect(after.heroes.knight.exp + after.heroes.knight.level * 1e6).toBeGreaterThan(before.heroes.knight.exp + before.heroes.knight.level * 1e6);
  });
});
