import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { EconomyCore } from '../src/game/economy-core.js';
import { createSeededRng } from '../src/shared/rng.js';
import { parityHash } from '../src/shared/state-hash.js';
import { OPS, validateOp } from '../src/shared/v1-ops.js';
import { ENERGY } from '../src/data/shop.js';
import { HERO_ORDER, HEROES } from '../src/data/heroes.js';

/** 테스트용 시작 문서: 장비·재화가 넉넉한 계정. 서버 DB와 클라이언트가 같은 문서에서 출발한다. */
function richState(now: number) {
  const eco = EconomyCore.fromState(null, { now: () => now, rng: createSeededRng(7) });
  eco.s.gold = 50_000_000; eco.s.gems = 200_000; eco.s.stones = 5000; eco.s.stones2 = 500; eco.s.stones3 = 200; eco.s.fragments = 300;
  eco.s.transcendStones = 200; eco.s.protect = 50; eco.s.bless = 50; eco.s.skillResets = 5;
  for (const id of HERO_ORDER) { eco.s.heroes[id].level = 30; eco.s.heroes[id].shards = 500; }
  for (const r of ['N', 'S', 'E', 'U', 'L', 'N', 'S', 'E', 'N', 'S', 'E', 'N']) eco.addItem(r);
  eco.s.pass.xp = 1500;
  eco.s.quests.kills = 200; eco.s.quests.stages = 20; eco.s.quests.pulls = 20;
  return eco.snapshot();
}
async function withDoc(h: Awaited<ReturnType<typeof v1Harness>>, accountId: string, state: unknown) {
  const text = JSON.stringify(state);
  h.db.sqlite.query("UPDATE account_docs SET doc = ?, bytes = ? WHERE account_id = ?").run(text, Math.min(text.length, 262144), accountId);
}

describe('MMO P1-D 서버 규칙 엔진', () => {
  test('/cmd 멱등: 같은 cid 2회 → 효과 1회', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const body = { cid: 'same-cid-0001', op: 'claimMail', args: [1] };
    const first = await h.send('POST', '/cmd', body, a.token);
    expect(first.status).toBe(200);
    expect(first.body.doc.gems).toBe(1500 + 500);
    const again = await h.send('POST', '/cmd', body, a.token);
    expect(again.body.replayed).toBe(true);
    expect(again.body.rev).toBe(first.body.rev);
    const me = await h.send('GET', '/me', undefined, a.token);
    expect(me.body.doc.gems).toBe(2000);
    expect(me.body.rev).toBe(2);
    // 다른 계정이 같은 cid를 써도 서로 간섭하지 않는다.
    const b = await h.session();
    expect((await h.send('POST', '/cmd', body, b.token)).body.replayed).toBeUndefined();
  });

  test('낡은 baseRev는 409, /me 재조회 후 성공', async () => {
    const h = await v1Harness();
    const a = await h.session();
    await h.cmd(a.token, 'claimMail', [1]);
    const stale = await h.cmd(a.token, 'claimDaily', [], { baseRev: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.rev).toBe(2);
    const me = await h.send('GET', '/me', undefined, a.token);
    expect((await h.cmd(a.token, 'claimDaily', [], { baseRev: me.body.rev })).status).toBe(200);
  });

  test('허용 op만 실행하고 형식이 틀린 인자는 거부한다', async () => {
    const h = await v1Harness();
    const a = await h.session();
    for (const [op, args] of [['addRewards', [{ gems: 1e9 }]], ['purchase', ['gems_1']], ['pull', [10]], ['__proto__', []], ['claimMail', ['1']], ['claimMail', [1, 2]], ['equip', ['knight', -1]]] as const) {
      const r = await h.cmd(a.token, op, args as unknown as unknown[]);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('op');
    }
    const rejected = await h.cmd(a.token, 'levelUpHero', ['nobody']);
    expect(rejected.status).toBe(422);
    expect((await h.send('GET', '/me', undefined, a.token)).body.rev).toBe(1);
    expect(validateOp('enhance', [1, true, false])).toBe(OPS.enhance);
  });

  test('서버 시계 에너지: 기기 시계 +1일 조작 → 추가 에너지 0, 서버 시간 경과만 회복', async () => {
    const h = await v1Harness();
    const a = await h.session();
    // 에너지를 바닥낸다(1-1은 에너지 6).
    let starts = 0;
    for (;;) {
      const r = await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'drain-' + String(starts).padStart(6, '0') }, a.token,
        { date: new Date(h.now() + 86400000).toUTCString() });
      if (r.status === 429) { // 미정산 티켓 상한 → 정산(패배)으로 비운다
        const open = h.db.sqlite.query("SELECT run_id FROM run_tickets WHERE state = 'open'").all() as { run_id: string }[];
        for (const t of open) await h.send('POST', `/runs/${t.run_id}/settle`, { win: false, elapsedMs: 1000, kills: {} }, a.token);
        continue;
      }
      if (r.status !== 200) { expect(r.body.error).toBe('energy'); break; }
      starts++;
    }
    expect(starts).toBe(Math.floor(ENERGY.max / 6));
    const left = (await h.send('GET', '/me', undefined, a.token)).body.doc.energy;
    expect(left).toBe(ENERGY.max - starts * 6);
    // 클라이언트가 시간을 보내도(알 수 없는 필드) 거부된다.
    expect((await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'clock-cheat-1', clientTime: h.now() + 86400000 }, a.token)).body.error).toBe('unknown-field');
    h.advance(ENERGY.regenSec * 1000 * 2);
    expect((await h.send('GET', '/me', undefined, a.token)).body.doc.energy).toBe(left + 2);
    // 서버 시계를 되돌려도 에너지가 늘지 않는다.
    h.advance(-ENERGY.regenSec * 1000 * 10);
    const fresh = await h.session(a.deviceKey);
    expect((await h.send('GET', '/me', undefined, fresh.token)).body.doc.energy).toBe(left);
  });

  test('일일 출석은 서버 날짜 기준으로 하루 1회', async () => {
    const h = await v1Harness();
    const a = await h.session();
    expect((await h.cmd(a.token, 'claimDaily', [])).status).toBe(200);
    expect((await h.cmd(a.token, 'claimDaily', [])).status).toBe(422);
    h.advance(86400000);
    expect((await h.cmd((await h.session(a.deviceKey)).token, 'claimDaily', [])).status).toBe(200);
  });

  test('문서 256KB 상한을 넘기는 변경은 413', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const state = richState(h.now()) as any;
    state.inventory = Array.from({ length: 10000 }, (_, i) => ({ uid: i + 1, id: state.inventory[0].id, enh: 0 }));
    state.invSeq = 10001;
    await withDoc(h, a.accountId, state);
    const r = await h.cmd(a.token, 'claimMail', [1]);
    expect(r.status).toBe(413);
  });

  test('패리티: 녹화된 명령열 200개를 클라이언트 Economy와 서버 /cmd에 흘려 상태 해시 일치', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const start = richState(h.now());
    await withDoc(h, a.accountId, start);
    const client = EconomyCore.fromState(structuredClone(start), { now: () => h.now(), rng: () => 0.5 });
    const rng = createSeededRng(20261022);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
    const recorded: [string, unknown[]][] = [];
    for (let i = 0; i < 200; i++) {
      const hero = pick(HERO_ORDER), uids = client.s.inventory.map((x: any) => x.uid);
      const uid = uids.length ? pick(uids) : 1;
      const choices: [string, unknown[]][] = [
        ['levelUpHero', [hero]], ['promoteHero', [hero]], ['transcend', [hero]], ['learnSkill', [hero, 4 + Math.floor(rng() * 3)]],
        ['resetSkills', [hero, rng() < 0.5]], ['setSkillLoadout', [hero, Math.floor(rng() * 2), 4 + Math.floor(rng() * 3)]],
        ['selectHero', [hero]], ['equip', [hero, uid]], ['unequip', [hero, pick(['weapon', 'armor', 'ring', 'boots'])]],
        ['sellItem', [uid]], ['salvage', [[uid]]], ['craftSetItem', [pick(Object.keys(HEROES).length ? ['dragon', 'shadow', 'holy'] : []), pick(['weapon', 'armor'])]],
        ['claimPass', [1 + Math.floor(rng() * 16), false]], ['claimQuest', [pick(['k30', 'k100', 's3', 's10', 'p10'])]], ['claimMail', [1]],
        ['claimDaily', []], ['setDifficulty', [pick(['story', 'adept', 'nightmare']), 1, 1]], ['equipAvatar', [hero, null]],
      ];
      recorded.push(pick(choices));
    }
    let mismatches = 0, applied = 0;
    for (const [op, args] of recorded) {
      const def = validateOp(op, args);
      expect(def).not.toBeNull();
      const local = def!.run(client, ...args);
      const localOk = def!.ok(local);
      const server = await h.cmd(a.token, op, args, { clientHash: parityHash(client.s) });
      expect(server.status === 200).toBe(localOk);
      if (server.status === 200) { applied++; if (!server.body.match) mismatches++; }
    }
    expect(applied).toBeGreaterThan(40);
    expect(mismatches).toBe(0);
    const me = await h.send('GET', '/me', undefined, a.token);
    expect(me.body.stateHash).toBe(parityHash(client.s));
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM parity_log WHERE match = 0').get()).toEqual({ n: 0 });
  });

  test('강화(서버 난수)는 서버 결과가 정본이며 재료 차감은 규칙과 같다', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const start = richState(h.now());
    await withDoc(h, a.accountId, start);
    const uid = (start as any).inventory[0].uid;
    const r = await h.cmd(a.token, 'enhance', [uid, false, false]);
    expect(r.status).toBe(200);
    expect(r.body.result.ok).toBe(true);
    expect(r.body.doc.gold).toBeLessThan((start as any).gold);
  });
});
