// 서버 권위 컷오버 게이트 검증(docs/SERVER_AUTHORITY_GATES.md): 처치 원장 · 여정 단계 · 도감 보상 · 병합.
import { describe, expect, test } from 'bun:test';
import { v1Harness } from './helpers/v1-harness';
import { stageDef, ENEMIES } from '../src/data/stages.js';
import { applyDifficulty, DIFFICULTIES } from '../src/game/difficulty.js';
import { plausibilityFor, validateFacts } from '../src/shared/settlement.js';
import { stageSpeciesPool, poolUpToFloor, slainSpecies, normalizeSlain } from '../src/game/kill-ledger.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { createSeededRng } from '../src/shared/rng.js';
import { OPS, validateOp } from '../src/shared/v1-ops.js';
import { normalizeSave } from '../src/game/save.js';
import { sanitizeLegacySave, LEGACY_EPOCH, ONE_TIME, DAILY_MAX } from '../src/shared/legacy-sanitize.js';
import { mergeServerOwned, SERVER_OWNED_KEYS } from '../src/shared/state-hash.js';
import { achievementRows, achievementStats, ACHIEVEMENTS } from '../src/game/achievements.js';
import { newbieStats, NEWBIE_MISSIONS } from '../src/game/newbie-event.js';
import { periodAt, claimJourneyStep as claimStepCore, journeySteps, normalizeJourney, JOURNEY_ATTEST_MIN_CLEARED } from '../src/game/journey-core.js';
import { JOURNEY_STEPS } from '../src/data/journey.js';

const STAGE = applyDifficulty(stageDef(1, 1), DIFFICULTIES.story);
const LIMITS = plausibilityFor(STAGE);
const POOL = [...stageSpeciesPool(stageDef(1, 1))] as string[];
const FOREIGN = 'forge_finalboss'; // 2장 보스: 1-1 풀 밖
const DAY = 86400000;

const legit = (over: Record<string, unknown> = {}) => ({ win: true, elapsedMs: LIMITS.minClearMs + 30000, kills: { normal: 40, elite: 2, boss: 1 },
  roomsCleared: 5, hpLost: 500, revives: 0, damageDealt: 1000, stars: 3, ...over });

async function ready() {
  const h = await v1Harness();
  const a = await h.session();
  let n = 0;
  const start = async () => (await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'knight', cid: 'run-start-' + String(++n).padStart(4, '0') }, a.token)).body as { runId: string };
  const settle = (runId: string, body: unknown) => h.send('POST', `/runs/${runId}/settle`, body, a.token);
  const doc = async () => (await h.send('GET', '/me', undefined, a.token)).body.doc;
  /** 시간을 충분히 흘리고 정산한다. */
  const run = async (facts: unknown) => { const t = await start(); h.advance(LIMITS.minClearMs + 40000); return { t, r: await settle(t.runId, facts) }; };
  return { h, a, start, settle, doc, run };
}
async function withDoc(h: Awaited<ReturnType<typeof v1Harness>>, accountId: string, state: unknown) {
  const text = JSON.stringify(state);
  h.db.sqlite.query('UPDATE account_docs SET doc = ?, bytes = ? WHERE account_id = ?').run(text, Math.min(text.length, 262144), accountId);
}
const fresh = (now: number) => EconomyCore.fromState(null, { now: () => now, rng: createSeededRng(7) }) as any;

describe('A1/A2 처치 원장: 서버 정산', () => {
  test('승리 정산: quests.kills += kills+summonedKills, 풀 안 종만 slain, 영수증 killLedger', async () => {
    const { run, doc } = await ready();
    const before = await doc();
    const species = { ch1_mourner: 30, skel_minion: 10, [FOREIGN]: 1 };
    const { r } = await run(legit({ summonedKills: { normal: 5 }, species }));
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('ok');
    expect(r.body.killLedger).toEqual({ kills: 48, species: 2, dropped: 1 });
    const after = await doc();
    expect(after.quests.kills).toBe((before.quests.kills || 0) + 48);
    expect(after.slain.kills).toEqual({ ch1_mourner: 30, skel_minion: 10 });
    expect(after.slain.kills[FOREIGN]).toBeUndefined();
  });

  test('패배 정산도 처치 수와 종을 센다', async () => {
    const { h, start, settle, doc } = await ready();
    const before = await doc();
    const t = await start();
    h.advance(30000);
    const r = await settle(t.runId, { win: false, elapsedMs: 25000, kills: { normal: 10 }, species: { skel_minion: 10 } });
    expect(r.status).toBe(200);
    expect(r.body.killLedger).toEqual({ kills: 10, species: 1, dropped: 0 });
    const after = await doc();
    expect(after.quests.kills).toBe((before.quests.kills || 0) + 10);
    expect(after.slain.kills).toEqual({ skel_minion: 10 });
  });

  test('rejected(보스 상한 초과·너무 빠름)는 0, 영수증 killLedger 0', async () => {
    const { h, start, settle, doc, run } = await ready();
    const before = await doc();
    const tooMany = await run(legit({ kills: { normal: 40, elite: 2, boss: LIMITS.kills.boss + 1 }, species: { skel_minion: 40 } }));
    expect(tooMany.r.body.verdict).toBe('rejected');
    expect(tooMany.r.body.killLedger).toEqual({ kills: 0, species: 0, dropped: 0 });
    const t = await start();
    h.advance(2000);
    const fast = await settle(t.runId, legit({ elapsedMs: 2000, species: { skel_minion: 40 } }));
    expect(fast.body.verdict).toBe('rejected');
    expect(fast.body.killLedger).toEqual({ kills: 0, species: 0, dropped: 0 });
    const after = await doc();
    expect(after.quests.kills || 0).toBe(before.quests.kills || 0);
    expect(Object.keys(after.slain?.kills || {})).toEqual([]);
  });

  test('같은 티켓 재정산은 replayed, quests.kills·slain 이 다시 늘지 않는다', async () => {
    const { run, settle, doc } = await ready();
    const { t, r } = await run(legit({ species: { skel_minion: 43 } }));
    expect(r.body.verdict).toBe('ok');
    const mid = await doc();
    const again = await settle(t.runId, legit({ kills: { normal: 400, elite: 30, boss: 1 }, species: { skel_minion: 431 } }));
    expect(again.body.replayed).toBe(true);
    expect(again.body.killLedger).toEqual(r.body.killLedger);
    const end = await doc();
    expect(end.quests.kills).toBe(mid.quests.kills);
    expect(end.slain).toEqual(mid.slain);
  });

  test('위조: species 합이 처치 합보다 크면 id 순서로 잘리고 초과분은 dropped', async () => {
    const { run, doc } = await ready();
    const { r } = await run(legit({ species: { ch1_mourner: 40, skel_minion: 40 } })); // 합 80 > 43
    expect(r.body.verdict).toBe('ok');
    // id 정렬 순서로 채운다: ch1_mourner 40 + skel_minion 3, 나머지 37 은 dropped
    expect(r.body.killLedger).toEqual({ kills: 43, species: 2, dropped: 37 });
    expect((await doc()).slain.kills).toEqual({ ch1_mourner: 40, skel_minion: 3 });
  });

  test('위조: 풀 밖 종만 보고하면 전부 dropped, slain 비어 있음, 처치 수는 센다', async () => {
    const { run, doc } = await ready();
    const { r } = await run(legit({ species: { [FOREIGN]: 1, ch7_citizen: 2 } }));
    expect(r.body.killLedger).toEqual({ kills: 43, species: 0, dropped: 3 });
    const d = await doc();
    expect(Object.keys(d.slain?.kills || {})).toEqual([]);
    expect(d.quests.kills).toBeGreaterThanOrEqual(43);
  });

  test('구 클라이언트(species 없음) 사실도 통과하고 처치 수만 센다', async () => {
    const { run, doc } = await ready();
    const { r } = await run(legit());
    expect(r.body.verdict).toBe('ok');
    expect(r.body.killLedger).toEqual({ kills: 43, species: 0, dropped: 0 });
    const d = await doc();
    expect(d.quests.kills).toBeGreaterThanOrEqual(43);
    expect(Object.keys(d.slain?.kills || {})).toEqual([]);
  });

  test('HTTP: 형식이 틀린 species 는 400', async () => {
    const { start, settle, h } = await ready();
    const t = await start();
    h.advance(LIMITS.minClearMs + 40000);
    const r = await settle(t.runId, legit({ species: { 'skel-minion': 1 } }));
    expect(r.status).toBe(400);
  });
});

describe('A1 validateFacts species 형식', () => {
  const base = () => legit();
  const bad = (species: unknown) => validateFacts({ ...base(), species } as any);
  test('정상·빈 값·생략은 통과', () => {
    expect(validateFacts(base() as any)).toBeNull();
    expect(bad({})).toBeNull();
    expect(bad({ skel_minion: 100000 })).toBeNull();
    expect(bad(Object.fromEntries(Array.from({ length: 64 }, (_, i) => ['mob_' + i, 1])))).toBeNull();
  });
  test('실제 적 id 의 대문자(dungeon_reverseRiver_captain 등)는 통과', () => {
    expect(bad({ dungeon_reverseRiver_captain: 1, dungeon_crackedNave_warden: 1 })).toBeNull();
  });
  test('65종 이상·특수문자·음수·소수·100001·배열·null 은 species', () => {
    expect(bad(Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['mob_' + i, 1])))).toBe('species');
    expect(bad({ 'skel-minion': 1 })).toBe('species');
    expect(bad({ 'skel minion': 1 })).toBe('species');
    expect(bad({ '1skel': 1 })).toBe('species');
    expect(bad({ skel_minion: -1 })).toBe('species');
    expect(bad({ skel_minion: 1.5 })).toBe('species');
    expect(bad({ skel_minion: 100001 })).toBe('species');
    expect(bad({ skel_minion: '5' })).toBe('species');
    expect(bad({ skel_minion: NaN })).toBe('species');
    expect(bad([])).toBe('species');
    expect(bad(null)).toBe('species');
    expect(bad('x')).toBe('species');
  });
});

describe('A3 여정 단계 서버 명령 claimJourneyStep', () => {
  test('명령표·validateOp', () => {
    expect(OPS.claimJourneyStep).toBeDefined();
    expect(validateOp('claimJourneyStep', ['oath'])).not.toBeNull();
    expect(validateOp('claimJourneyStep', [])).toBeNull();
    expect(validateOp('claimJourneyStep', [5])).toBeNull();
  });

  /** 갑옷을 장착한 문서를 만든다. */
  const docWith = (now: number, unlocked: number, { armor = true, enh = 0 } = {}) => {
    const eco = fresh(now);
    eco.s.progress.unlocked = unlocked;
    if (armor) { const it = eco.addItem('N', 'armor'); eco.equip(eco.s.selected, it.uid); if (enh) it.enh = enh; }
    return eco.snapshot();
  };

  test('unlocked=1(클리어 0): oath 수령 가능, garden 은 incomplete, 보상은 골드 + 강화석 10', async () => {
    const h = await v1Harness();
    const a = await h.session();
    await withDoc(h, a.accountId, docWith(h.now(), 1));
    const before = (await h.send('GET', '/me', undefined, a.token)).body.doc;
    const garden = await h.cmd(a.token, 'claimJourneyStep', ['garden']);
    expect(garden.status).toBe(422);
    const oath = await h.cmd(a.token, 'claimJourneyStep', ['oath']);
    expect(oath.status).toBe(200);
    const after = (await h.send('GET', '/me', undefined, a.token)).body.doc;
    expect(after.gold - before.gold).toBe(JOURNEY_STEPS[0].rewards.gold as number);
    expect(after.stones - before.stones).toBe(10);
    expect(after.journey.claimedSteps).toEqual(['oath']);
    // 클리어 0 이라 garden 은 여전히 불가
    expect((await h.cmd(a.token, 'claimJourneyStep', ['garden'])).status).toBe(422);
  });

  test('판정 에러 코드: incomplete / prerequisite / claimed / unknown (순수 함수, attest)', () => {
    const now = Date.now();
    const save = docWith(now, 1);
    const st = normalizeJourney(null);
    const try_ = (id: string) => claimStepCore(st, save, id, { attest: true }) as any;
    expect(try_('garden').error).toBe('incomplete');
    expect(try_('equip').error).toBe('prerequisite'); // 갑옷은 장착됐지만 앞 단계(oath..craft) 미수령
    expect(try_('nope').error).toBe('unknown');
    expect(try_('oath').ok).toBe(true);
    expect(try_('oath').error).toBe('claimed');
  });

  test('unlocked=2(클리어 1): garden 가능 / craft·mastery 도 기기증언 바닥값 충족', async () => {
    const h = await v1Harness();
    const a = await h.session();
    await withDoc(h, a.accountId, docWith(h.now(), 2));
    expect((await h.cmd(a.token, 'claimJourneyStep', ['garden'])).status).toBe(422); // 순서 위반(oath 먼저)
    expect((await h.cmd(a.token, 'claimJourneyStep', ['oath'])).status).toBe(200);
    expect((await h.cmd(a.token, 'claimJourneyStep', ['garden'])).status).toBe(200);
    expect((await h.cmd(a.token, 'claimJourneyStep', ['garden'])).status).toBe(422); // claimed
    expect(JOURNEY_ATTEST_MIN_CLEARED.garden).toBe(1);
  });

  test('equip 단계: 갑옷을 장착하지 않으면 attest 여도 incomplete, 장착하면 순서대로 수령', () => {
    const now = Date.now();
    const bare = docWith(now, 2, { armor: false });
    const st = normalizeJourney(null);
    for (const id of ['oath', 'garden', 'craft']) expect((claimStepCore(st, bare, id, { attest: true }) as any).ok).toBe(true);
    const r = claimStepCore(st, bare, 'equip', { attest: true }) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBe('incomplete');
    const worn = docWith(now, 2);
    const st2 = normalizeJourney(null);
    for (const id of ['oath', 'garden', 'craft', 'equip']) expect((claimStepCore(st2, worn, id, { attest: true }) as any).ok).toBe(true);
    // 강화 +0 이면 enhance 는 서버 문서로 판정되어 incomplete
    expect((claimStepCore(st2, worn, 'enhance', { attest: true }) as any).error).toBe('incomplete');
    const enhanced = docWith(now, 2, { enh: 1 });
    const st3 = normalizeJourney(null);
    for (const id of ['oath', 'garden', 'craft', 'equip', 'enhance', 'mastery']) expect((claimStepCore(st3, enhanced, id, { attest: true }) as any).ok).toBe(true);
  });

  test('클라이언트 경로(attest 없음)는 기존 조건 그대로', () => {
    const now = Date.now();
    const save = docWith(now, 70); // 진행이 높아도 증언은 인정되지 않는다
    const st = normalizeJourney(null);
    expect((claimStepCore(st, save, 'oath') as any).error).toBe('incomplete');
    save.expedition = { ...(save.expedition || {}), claimed: ['first_oath'] };
    expect((claimStepCore(st, save, 'oath') as any).ok).toBe(true);
    expect((claimStepCore(st, save, 'garden') as any).error).toBe('incomplete');
    const rows = journeySteps(save);
    expect(rows.find((r: any) => r.id === 'garden')!.complete).toBe(false);
    expect(journeySteps(save, { attest: true }).find((r: any) => r.id === 'garden')!.complete).toBe(true);
  });

  test('Economy.claimJourneyStep: 클라이언트는 전체 조건, attest 는 서버 판정; 보상 gold + stones 10', () => {
    const now = Date.now();
    const eco = fresh(now);
    expect(eco.claimJourneyStep('oath').error).toBe('incomplete');
    const g = eco.s.gold, s = eco.s.stones;
    const r = eco.claimJourneyStep('oath', { attest: true });
    expect(r.ok).toBe(true);
    expect(eco.s.gold - g).toBe(JOURNEY_STEPS[0].rewards.gold as number);
    expect(eco.s.stones - s).toBe(10);
    expect(eco.claimJourneyStep('oath', { attest: true }).error).toBe('claimed');
  });

  test('단계 수령 후 steps 가 늘어 7일 여정 d3c·업적 wayfarer 가 열리고, 최종 상자는 한 번만', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const eco = docWith(h.now(), 2) as any;
    eco.newbie = { start: periodAt(h.now()).day - 2, claimed: [], final: false }; // 3일차
    await withDoc(h, a.accountId, eco);
    const d3c = () => h.cmd(a.token, 'claimNewbie', ['d3c']);
    expect((await d3c()).status).toBe(422); // steps 0
    await h.cmd(a.token, 'claimJourneyStep', ['oath']);
    expect((await d3c()).status).toBe(422); // steps 1
    await h.cmd(a.token, 'claimJourneyStep', ['garden']);
    const doc = (await h.send('GET', '/me', undefined, a.token)).body.doc;
    expect(newbieStats(doc).steps).toBe(2);
    expect((await d3c()).status).toBe(200);
    // 업적 wayfarer: steps 3 이상이면 1단계
    await h.cmd(a.token, 'claimJourneyStep', ['craft']);
    const doc3 = (await h.send('GET', '/me', undefined, a.token)).body.doc;
    expect(achievementRows(doc3.achievements, achievementStats(doc3)).find((r: any) => r.id === 'wayfarer')!.ready).toBe(true);
    expect((await h.cmd(a.token, 'claimAchievement', ['wayfarer'])).status).toBe(200);
  });

  test('7일 최종 상자 claimNewbie(final)는 한 번만(두 번째 null/거부)', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const eco = fresh(h.now());
    eco.s.newbie = { start: periodAt(h.now()).day - 6, claimed: NEWBIE_MISSIONS.map((m: any) => m.id), final: false };
    await withDoc(h, a.accountId, eco.snapshot());
    const first = await h.cmd(a.token, 'claimNewbie', ['final']);
    expect(first.status).toBe(200);
    const second = await h.cmd(a.token, 'claimNewbie', ['final']);
    expect(second.status).toBe(422);
    // 순수 경로도 같다
    const local = fresh(h.now());
    local.s.newbie = { start: periodAt(h.now()).day - 6, claimed: NEWBIE_MISSIONS.map((m: any) => m.id), final: false };
    expect(local.claimNewbie('final')).not.toBeNull();
    expect(local.claimNewbie('final')).toBeNull();
  });
});

describe('A4 도감 보상(hunter)', () => {
  const ids = Object.keys(ENEMIES);
  const hunter = (save: any) => achievementRows(save.achievements, achievementStats(save)).find((r: any) => r.id === 'hunter')!;
  test('hunter 업적이 있고 stat 은 species', () => {
    const def = ACHIEVEMENTS.find((x: any) => x.id === 'hunter')!;
    expect(def.stat).toBe('species');
    expect(def.tiers.map((t: any) => t.target)).toEqual([10, 25, 50, 80, 120]);
  });
  test('stat species = slain.kills 에서 1 이상인 종 수(0 은 제외, 모르는 id 는 제외)', () => {
    const save: any = { slain: { seeded: true, kills: { [ids[0]]: 3, [ids[1]]: 0, [ids[2]]: 1, not_a_mob: 9 } } };
    expect(slainSpecies(save)).toBe(2);
    expect(achievementStats(save).species).toBe(2);
    expect(hunter(save).cur).toBe(2);
  });
  test('rpg.bestiary 만 있고 slain 이 비면 0(기기 도감은 서버 판정에 쓰지 않는다)', () => {
    const bestiary = Object.fromEntries(ids.slice(0, 30).map((id) => [id, { kills: 5 }]));
    const save: any = { rpg: { bestiary }, slain: { seeded: false, kills: {} } };
    expect(achievementStats(save).species).toBe(0);
    expect(hunter(save).ready).toBe(false);
    expect(achievementStats({ rpg: { bestiary } }).species).toBe(0);
  });
  test('10종을 채우면 1단계 수령, 재수령 불가(서버 명령)', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const eco = fresh(h.now());
    eco.s.slain = { seeded: true, kills: Object.fromEntries(ids.slice(0, 9).map((id) => [id, 1])) };
    await withDoc(h, a.accountId, eco.snapshot());
    expect((await h.cmd(a.token, 'claimAchievement', ['hunter'])).status).toBe(422); // 9종
    eco.s.slain.kills[ids[9]] = 1;
    await withDoc(h, a.accountId, eco.snapshot());
    const before = (await h.send('GET', '/me', undefined, a.token)).body.doc.gold;
    expect((await h.cmd(a.token, 'claimAchievement', ['hunter'])).status).toBe(200);
    expect((await h.send('GET', '/me', undefined, a.token)).body.doc.gold - before).toBe(15000);
    expect((await h.cmd(a.token, 'claimAchievement', ['hunter'])).status).toBe(422); // 2단계는 25종 필요
    const local = fresh(h.now());
    local.s.slain = eco.s.slain;
    expect(local.claimAchievement('hunter')).not.toBeNull();
    expect(local.claimAchievement('hunter')).toBeNull();
  });
});

describe('A5 병합: 가져오기·스냅샷', () => {
  const NOW = Date.UTC(2026, 10, 20);
  const base = () => fresh(NOW).snapshot() as any;
  const stars = (from: number, to: number) => Object.fromEntries(Array.from({ length: (to - from + 1) * 10 }, (_, i) => [`${from + Math.floor(i / 10)}-${(i % 10) + 1}`, 3]));
  const sanitize = (raw: any, opts: Record<string, unknown> = {}) => {
    const r = sanitizeLegacySave(raw, { now: NOW, createdAt: LEGACY_EPOCH, ...opts }) as any;
    expect(r.ok).toBe(true);
    return r;
  };
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  test('비스냅샷: 도감 처치는 진행 범위 풀 안 종만, 합계 ≤ quests.kills, seeded=true; 7장 종 주장은 빠짐', () => {
    const raw = base();
    raw.progress.unlocked = 11; raw.progress.stars = stars(1, 1);
    raw.quests.kills = 1000;
    raw.rpg = { bestiary: { ch1_mourner: { kills: 600 }, skel_minion: { kills: 600 }, ch7_citizen: { kills: 500 }, [FOREIGN]: { kills: 500 } } };
    const r = sanitize(raw);
    expect(r.state.slain.seeded).toBe(true);
    expect(r.state.slain.kills.ch7_citizen).toBeUndefined();
    expect(r.state.slain.kills[FOREIGN]).toBeUndefined();
    expect(Object.keys(r.state.slain.kills).every((id) => poolUpToFloor(11).has(id))).toBe(true);
    expect(sum(r.state.slain.kills)).toBeLessThanOrEqual(r.state.quests.kills);
    expect(r.state.slain.kills.ch1_mourner).toBe(600);
    expect(r.state.slain.kills.skel_minion).toBe(400);
  });

  test('진행이 1장 초반(unlocked=1)인데 7장 종을 주장하면 빠진다, 1-1 종은 인정', () => {
    const raw = base();
    raw.quests.kills = 5000;
    raw.rpg = { bestiary: { ch7_citizen: { kills: 100 }, [FOREIGN]: { kills: 100 }, skel_minion: { kills: 100 } } };
    raw.slain = { seeded: false, kills: { ch7_tuner_drift: 50 } };
    const r = sanitize(raw);
    expect(r.state.progress.unlocked).toBe(1);
    expect(r.state.slain.kills).toEqual({ skel_minion: 100 });
    expect(r.state.slain.seeded).toBe(true);
  });

  test('slain.kills 와 bestiary 중 큰 값을 쓴다', () => {
    const raw = base();
    raw.quests.kills = 5000;
    raw.slain = { seeded: false, kills: { skel_minion: 300 } };
    raw.rpg = { bestiary: { skel_minion: { kills: 100 }, ghost: { kills: 40 } } };
    expect(sanitize(raw).state.slain.kills).toEqual({ ghost: 40, skel_minion: 300 });
  });

  test('quests.kills 가 ONE_TIME + DAILY_MAX × 경과일을 넘으면 절삭하고 report.clamped 에 기록', () => {
    const raw = base();
    raw.quests.kills = 99_999_999;
    const r = sanitize(raw, { createdAt: NOW - 2 * DAY });
    const cap = ONE_TIME.kills + DAILY_MAX.kills * r.report.days;
    expect(r.report.days).toBeGreaterThan(0);
    expect(r.state.quests.kills).toBe(cap);
    expect(r.report.clamped['quests.kills']).toEqual({ from: 99_999_999, to: cap });
    const ok = base(); ok.quests.kills = 1000;
    expect(sanitize(ok, { createdAt: NOW - 2 * DAY }).report.clamped['quests.kills']).toBeUndefined();
  });

  test('serverKills 가 더 크면 바닥값 유지(절삭 상한보다 커도)', () => {
    const raw = base();
    raw.quests.kills = 10;
    expect(sanitize(raw, { serverKills: 5000 }).state.quests.kills).toBe(5000);
    expect(sanitize(raw, { serverKills: 5 }).state.quests.kills).toBe(10);
    const big = base(); big.quests.kills = 99_999_999;
    expect(sanitize(big, { createdAt: NOW - DAY, serverKills: 90_000_000 }).state.quests.kills).toBeGreaterThanOrEqual(90_000_000);
  });

  test('serverSlain.seeded=true 면 스냅샷은 서버 값 그대로(기기 값 무시)', () => {
    const server = { seeded: true, kills: { skel_minion: 7 } };
    const raw = base();
    raw.quests.kills = 5000;
    raw.slain = { seeded: true, kills: { ghost: 999, skel_minion: 999 } };
    raw.rpg = { bestiary: { skel_minion: { kills: 900 }, ghost_skull: { kills: 900 } } };
    expect(sanitize(raw, { snapshot: true, serverSlain: server }).state.slain).toEqual(server);
  });

  test('외부 가져오기(계정당 1회)는 서버가 seeded=true 여도 한 번 병합한다(서버 값은 바닥)', () => {
    const raw = base();
    raw.quests.kills = 5000;
    raw.rpg = { bestiary: { skel_minion: { kills: 3 } } };
    const r = sanitize(raw, { serverSlain: { seeded: true, kills: { skel_minion: 7, ghost: 1 } } });
    expect(r.state.slain).toEqual({ seeded: true, kills: { ghost: 1, skel_minion: 7 } });
    raw.rpg.bestiary.skel_minion.kills = 40;
    expect(sanitize(raw, { serverSlain: { seeded: true, kills: { skel_minion: 7 } } }).state.slain.kills.skel_minion).toBe(40);
  });

  test('서버가 seeded=false 면 서버 값은 바닥값으로 합쳐지고 seeded=true', () => {
    const raw = base();
    raw.quests.kills = 5000;
    raw.rpg = { bestiary: { skel_minion: { kills: 10 } } };
    const r = sanitize(raw, { serverSlain: { seeded: false, kills: { skel_minion: 50, ghost: 2 } } });
    expect(r.state.slain).toEqual({ seeded: true, kills: { ghost: 2, skel_minion: 50 } });
  });

  test('HTTP 가져오기: 새 계정(문서 seeded=true)도 기기 도감을 상한 검사 후 한 번 옮긴다', async () => {
    const h = await v1Harness();
    h.setNow(NOW - 30 * DAY);
    const first = await h.session();
    h.setNow(NOW);
    const a = { ...first, ...await h.session(first.deviceKey) };
    const raw = fresh(NOW).snapshot() as any;
    raw.quests.kills = 800;
    raw.rpg = { bestiary: { skel_minion: { kills: 500 } } };
    const r1 = await h.send('POST', '/import', { installId: crypto.randomUUID(), save: raw }, a.token);
    expect(r1.status).toBe(200);
    expect(r1.body.doc.slain).toEqual({ seeded: true, kills: { skel_minion: 500 } });
  });

  test('HTTP 가져오기: 서버 문서가 seeded=false 면 한 번만 병합하고 이후 재주입은 무시', async () => {
    const h = await v1Harness();
    h.setNow(NOW - 30 * DAY);
    const first = await h.session();
    h.setNow(NOW);
    const a = { ...first, ...await h.session(first.deviceKey) };
    const server = fresh(NOW);
    server.s.slain = { seeded: false, kills: {} };
    await withDoc(h, a.accountId, server.snapshot());
    const raw = fresh(NOW).snapshot() as any;
    raw.quests.kills = 800;
    raw.rpg = { bestiary: { skel_minion: { kills: 500 }, [FOREIGN]: { kills: 50 } } };
    const r1 = await h.send('POST', '/import', { installId: crypto.randomUUID(), save: raw }, a.token);
    expect(r1.status).toBe(200);
    expect(r1.body.doc.slain).toEqual({ seeded: true, kills: { skel_minion: 500 } });
    raw.rpg.bestiary.skel_minion.kills = 700; raw.rpg.bestiary.ghost = { kills: 99 };
    const r2 = await h.send('POST', '/import', { installId: crypto.randomUUID(), save: raw }, a.token);
    if (r2.status === 200) expect(r2.body.doc.slain).toEqual({ seeded: true, kills: { skel_minion: 500 } });
  });

  test('normalizeSave: slain 없는 옛 저장은 seeded:false, 새 저장은 seeded:true, 모르는 종 id 는 버림', () => {
    const f = fresh(NOW);
    expect(f.s.slain).toEqual({ seeded: true, kills: {} });
    const old = f.snapshot() as any; delete old.slain;
    expect(EconomyCore.fromState(old, { now: () => NOW }).s.slain).toEqual({ seeded: false, kills: {} });
    expect(normalizeSave(old, fresh(NOW).s).slain).toEqual({ seeded: false, kills: {} });
    const dirty = { ...old, slain: { seeded: true, kills: { skel_minion: 4, hacker_mob: 99, __proto__x: 1, ghost: -3, ghost_skull: 1.5 } } };
    expect(normalizeSave(dirty, fresh(NOW).s).slain).toEqual({ seeded: true, kills: { skel_minion: 4 } });
    expect(normalizeSlain(null)).toEqual({ seeded: false, kills: {} });
  });

  test('mergeServerOwned 가 slain 을 서버 값으로 덮는다', () => {
    expect(SERVER_OWNED_KEYS).toContain('slain');
    const local = { gold: 1, slain: { seeded: true, kills: { ghost: 999 } } };
    const server = { slain: { seeded: true, kills: { skel_minion: 3 } } };
    expect(mergeServerOwned(local, server).slain).toEqual(server.slain);
    expect(mergeServerOwned(local, {}).slain).toEqual(local.slain);
  });
});

describe('Codex 리뷰 반영(PR #435)', () => {
  const NOW = Date.UTC(2026, 10, 20);
  test('소환 종은 장 전용 몸 변환 뒤 다시 소환하는 종까지 풀에 든다(1-8 → ch1_tombguard_frost)', async () => {
    const { stageSpeciesPool } = await import('../src/game/kill-ledger.js');
    const { stageDef } = await import('../src/data/stages.js');
    expect(stageSpeciesPool(stageDef(1, 8)).has('ch1_tombguard_frost')).toBe(true);
  });

  test('대문자 보스 id 도 그 관문 풀에 있으면 원장에 들어간다', async () => {
    const { stageSpeciesPool, clampSpecies } = await import('../src/game/kill-ledger.js');
    const { stageDef } = await import('../src/data/stages.js');
    const pool = stageSpeciesPool(stageDef(3, 8));
    const upper = [...pool].find((id) => /[A-Z]/.test(id));
    expect(upper).toBeDefined();
    expect(clampSpecies({ [upper!]: 1 }, pool, 1).species).toEqual({ [upper!]: 1 });
  });

  test('반복 스냅샷은 여정 단계 수령 기록을 서버 값으로 둔다(비워서 재수령 차단)', async () => {
    const { sanitizeLegacySave } = await import('../src/shared/legacy-sanitize.js');
    const raw = fresh(NOW).snapshot() as any;
    raw.journey = { ...(raw.journey || {}), claimedSteps: [] };
    const snap = sanitizeLegacySave(raw, { now: NOW, createdAt: NOW - 3 * DAY, snapshot: true, serverJourney: { claimedSteps: ['oath'] } }) as any;
    expect(snap.state.journey.claimedSteps).toEqual(['oath']);
    raw.journey.claimedSteps = ['oath', 'garden'];
    const again = sanitizeLegacySave(raw, { now: NOW, createdAt: NOW - 3 * DAY, snapshot: true, serverJourney: { claimedSteps: [] } }) as any;
    expect(again.state.journey.claimedSteps).toEqual([]);
  });

  test('서버 문서 적용은 여정 단계 수령 기록만 서버 값으로, 의뢰는 로컬 값 유지', async () => {
    const { mergeServerOwned } = await import('../src/shared/state-hash.js');
    const local = { journey: { claimedSteps: [], daily: { wins: 3 } }, gold: 1 };
    const out = mergeServerOwned(local, { journey: { claimedSteps: ['oath', 'garden'], daily: { wins: 0 } }, gold: 9 }) as any;
    expect(out.journey.claimedSteps).toEqual(['oath', 'garden']);
    expect(out.journey.daily.wins).toBe(3);
    expect(out.gold).toBe(9);
  });
});
