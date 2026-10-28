// 계승 콘텐츠(docs/GEAR_VAULT_INHERIT.md 덩어리 4): vaultRelay 임무·마일스톤 보상·우편·문장 획득처(현금 판매 금지).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { normalizeSave } from '../src/game/save.js';
import { stageDef } from '../src/data/stages.js';
import { applyDifficulty, DIFFICULTIES, resolveDifficulty } from '../src/game/difficulty.js';
import { DAILY_CONTRACTS, WEEKLY_CONTRACTS } from '../src/data/journey.js';
import { contractRows, claimContract, normalizeJourney } from '../src/game/journey-core.js';
import { JourneyService } from '../src/game/journey-service.js';
import { GEAR_DEX_MILESTONES } from '../src/game/gear-dex.js';
import { normalizeVault, relayToday, VAULT_INHERIT } from '../src/game/gear-vault.js';
import { IAP_REWARD_KEYS, IAP_BY_ID } from '../src/shared/iap-catalog.js';
import { SKUS, PASS_TRACK } from '../src/data/shop.js';
import { SEASON, TORMENT } from '../src/data/content-90d.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { applySettlement, plausibilityFor } from '../src/shared/settlement.js';
import { createSeededRng } from '../src/shared/rng.js';
import { grandfather } from './helpers/legacy-roster';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const T = Date.UTC(2026, 9, 28, 3);   // 수요일 12:00 KST
const DAY = 86400000;
let clock = T;
const newEco = () => { clock = T; const e: any = grandfather(new Economy({ now: () => clock, storage: memory(), rng: () => .5 })); e.s.gold = 10_000_000; e.s.lineageSigil = 20; return e; };
/** knight 가 얻은 장비를 금고 → 의식으로 mage 가 받아 착용한다. 받은 장비 uid 를 돌려준다. */
const receive = (eco: any, rarity = 'L', slot = 'weapon') => {
  const it = eco.addItem(rarity, slot, undefined, 0, 'knight'); expect(eco.vaultDeposit(it.uid).ok).toBe(true);
  expect(eco.vaultRitual(it.uid, 'mage').ok).toBe(true); eco.equip('mage', it.uid); return it.uid as number;
};
const win = (eco: any, heroId = 'mage') => { eco.s.selected = heroId; return eco.completeStage(applyDifficulty(stageDef(1, 1), DIFFICULTIES.story), 3); };
const relayCount = (eco: any, kind: 'daily' | 'weekly' = 'daily') => { eco.s.journey = normalizeJourney(eco.s.journey); return contractRows(eco.s.journey, clock)[kind].find((r: any) => r.stat === 'vaultRelay').cur; };

describe('vaultRelay (받은 장비로 클리어)', () => {
  test('계승 의식으로 받은 장비를 끼고 이기면 1, 같은 uid 는 하루 한 번만', () => {
    const eco = newEco(); const uid = receive(eco);
    win(eco); expect(relayCount(eco)).toBe(1); expect(relayCount(eco, 'weekly')).toBe(1);
    win(eco); win(eco); expect(relayCount(eco)).toBe(1);
    expect(eco.s.vault.rl.uids).toEqual([uid]);
  });

  test('받지 않은 장비(hops 0)·다른 영웅이 낀 받은 장비·미착용은 세지 않는다', () => {
    const eco = newEco(); const own = eco.addItem('L', 'weapon', undefined, 0, 'mage'); eco.equip('mage', own.uid);
    win(eco); expect(relayCount(eco)).toBe(0);
    const uid = receive(eco, 'L', 'armor'); eco.s.heroes.mage.equip.armor = null;       // 받았지만 끼지 않음
    win(eco); expect(relayCount(eco)).toBe(0);
    eco.equip('mage', uid); win(eco, 'rogue'); expect(relayCount(eco)).toBe(0);          // 다른 영웅이 이김
    win(eco, 'mage'); expect(relayCount(eco)).toBe(1);
  });

  test('왕복 이동(되돌리기·재의식)으로 오르지 않고, 다음 날에는 다시 1', () => {
    const eco = newEco(); const uid = receive(eco);
    win(eco); expect(relayCount(eco)).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(eco.vaultDeposit(uid).ok).toBe(true);
      expect(eco.vaultWithdraw(uid, 'mage').ok || eco.vaultRitual(uid, 'mage').ok).toBe(true);
      eco.equip('mage', uid); win(eco);
    }
    expect(relayCount(eco)).toBe(1);
    clock += DAY; win(eco); expect(relayCount(eco)).toBe(1);   // 새 날의 카운터에서 1
    expect(eco.s.vault.rl.uids).toEqual([uid]);
  });

  test('서로 다른 받은 장비 두 개는 각각 한 번씩(판마다 하나)', () => {
    const eco = newEco(); receive(eco, 'L', 'weapon'); receive(eco, 'L', 'armor');
    win(eco); expect(relayCount(eco)).toBe(1); win(eco); expect(relayCount(eco)).toBe(2); win(eco); expect(relayCount(eco)).toBe(2);
  });

  test('클라이언트가 보고한 값은 쓰지 않는다: 서버 정산(applySettlement)이 같은 판정을 한다', () => {
    const eco = EconomyCore.fromState(null, { now: () => T, rng: createSeededRng(5) }) as any; eco.s.roster.owned.push('mage');
    const it = eco.addItem('L', 'weapon', undefined, 0, 'knight'); eco.vaultDeposit(it.uid); eco.s.gold = 1e9; eco.s.lineageSigil = 9;
    expect(eco.vaultRitual(it.uid, 'mage').ok).toBe(true); eco.equip('mage', it.uid);
    const stage = applyDifficulty(stageDef(1, 1), DIFFICULTIES.story) as any, lim = plausibilityFor(stage);
    const facts = { win: true, elapsedMs: lim.minClearMs + 30000, kills: { normal: 40, elite: 2, boss: 1 }, roomsCleared: 5, hpLost: 0, revives: 0, damageDealt: 1000, stars: 3 };
    applySettlement(eco, stage, { heroId: 'mage', lootSeed: 77 }, facts as any, 'ok');
    expect(eco.s.journey.daily.actions.vaultRelay).toBe(1);
    applySettlement(eco, stage, { heroId: 'mage', lootSeed: 78 }, facts as any, 'ok');
    expect(eco.s.journey.daily.actions.vaultRelay).toBe(1);
    applySettlement(eco, stage, { heroId: 'mage', lootSeed: 79 }, { ...facts, win: false } as any, 'ok');   // 패배는 세지 않는다
    expect(eco.s.journey.daily.actions.vaultRelay).toBe(1);
  });

  test('vault.rl 정규화: 쓴 적 없으면 필드 없음, 잘못된 값 정화, 멱등, 날짜는 앞으로만', () => {
    expect(normalizeVault({ v: 1, expansions: 0, day: 0, used: 0 })).toEqual({ v: 1, expansions: 0, day: 0, used: 0 });
    const bad = normalizeVault({ rl: { day: 5, uids: [3, 3, -1, 'x', 1.5, 9] } });
    expect(bad.rl).toEqual({ day: 5, uids: [3, 9] }); expect(JSON.stringify(normalizeVault(bad))).toBe(JSON.stringify(bad));
    expect(normalizeVault({ rl: { day: 5, uids: [] } }).rl).toBeUndefined();
    expect(normalizeVault({ rl: { day: 5, uids: Array.from({ length: 40 }, (_, i) => i + 1) } }).rl!.uids.length).toBe(VAULT_INHERIT.relayUidsMax);
    expect(relayToday(bad, T).uids).toEqual([]); expect(relayToday({ rl: { day: 10 ** 7, uids: [4] } }, T)).toEqual({ day: 10 ** 7, uids: [4] });
    const saved = normalizeSave(JSON.parse(JSON.stringify(newEco().s)), newEco().fresh()); expect('rl' in saved.vault).toBe(false);
  });
});

describe('의뢰 · 문장 획득처', () => {
  test('일일·주간 vaultRelay 의뢰는 한 개씩, 보상은 문장뿐이고 JourneyService 가 지급한다', () => {
    const d = DAILY_CONTRACTS.filter((c) => c.stat === 'vaultRelay'), w = WEEKLY_CONTRACTS.filter((c) => c.stat === 'vaultRelay');
    expect(d.length).toBe(1); expect(w.length).toBe(1); expect(d[0].rewards).toEqual({ lineageSigil: 1 }); expect(w[0].rewards).toEqual({ lineageSigil: 3 });
    const eco = newEco(), svc = new JourneyService({ eco, expedition: { reward: () => ({}) } } as any); eco.s.lineageSigil = 0;
    const st = normalizeJourney(null); st.day = 100; st.week = 15;
    st.daily.actions.vaultRelay = 1; const r = claimContract(st, 'daily', d[0].id) as any;
    expect(r.ok).toBe(true); svc.grant(r); expect(eco.s.lineageSigil).toBe(1);
    expect(claimContract(st, 'daily', d[0].id)).toMatchObject({ ok: false, error: 'claimed' });   // 중복 수령 불가
  });

  test('주 수급 약 8~10개: 일일 7일 + 주간 + 패스·고통 단계는 별도 일회성', () => {
    const daily = DAILY_CONTRACTS.find((c) => c.stat === 'vaultRelay')!.rewards as any, weekly = WEEKLY_CONTRACTS.find((c) => c.stat === 'vaultRelay')!.rewards as any;
    const perWeek = daily.lineageSigil * 7 + weekly.lineageSigil;
    expect(perWeek).toBeGreaterThanOrEqual(8); expect(perWeek).toBeLessThanOrEqual(10);
  });

  test('고통 단계 새 최고 기록이 5의 배수일 때만 문장(그 단계 한 번)', () => {
    const clk = { now: SEASON.startMs + 3 * DAY + 12 * 3600000 };
    const eco: any = new Economy({ now: () => clk.now, storage: memory(), rng: () => .5 }); eco.s.progress.unlocked = 60;
    for (let st = 1; st <= 10; st++) eco.s.endgame.peak[`1-${st}`] = 3;
    const at = (tier: number) => applyDifficulty(stageDef(1, 10), resolveDifficulty(eco.s, 1, 10, 'torment-' + tier)) as any;
    const sigilOf = (r: any) => r.got.filter((g: any) => g.k === 'lineageSigil').reduce((a: number, g: any) => a + g.n, 0);
    eco.s.endgame.torment.best = 3;
    const t4 = eco.completeStage(at(4), 3); expect(t4.torment.newBest).toBe(true); expect(sigilOf(t4)).toBe(0);
    const t5 = eco.completeStage(at(5), 3); expect(t5.torment).toMatchObject({ newBest: true, best: 5 }); expect(sigilOf(t5)).toBe(VAULT_INHERIT.tormentSigil);
    expect(eco.s.lineageSigil).toBe(VAULT_INHERIT.tormentSigil);
    const again = eco.completeStage(at(5), 3); expect(again.torment.newBest).toBe(false); expect(sigilOf(again)).toBe(0);   // 같은 단계 반복은 새 기록이 아님
    void TORMENT;
  });

  test('시즌 패스: 무료 트랙 10·20·30레벨에 1개씩만, 프리미엄에는 없다', () => {
    expect(PASS_TRACK.filter((r: any) => 'lineageSigil' in r.free).map((r: any) => r.lv)).toEqual([10, 20, 30]);
    expect(PASS_TRACK.every((r: any) => !('lineageSigil' in r.prem))).toBe(true);
    const eco = newEco(); eco.s.lineageSigil = 0; eco.s.pass.xp = 100 * 30;
    expect(eco.claimPass(10, false)!.some((g: any) => g.k === 'lineageSigil')).toBe(true); expect(eco.s.lineageSigil).toBe(1);
    expect(eco.claimPass(10, false)).toBeNull();   // 중복 수령 불가
  });

  test('현금 판매 금지: IAP 보상 키·상점 SKU·IAP 카탈로그에 계승 문장이 없다', () => {
    expect((IAP_REWARD_KEYS as readonly string[]).includes('lineageSigil')).toBe(false);
    expect(JSON.stringify(SKUS)).not.toContain('lineageSigil'); expect(JSON.stringify(IAP_BY_ID)).not.toContain('lineageSigil');
    expect(JSON.stringify(SKUS).toLowerCase()).not.toContain('sigil');
    // 서버 IAP 지급 경로가 문장을 받아 주지 않는다: 정규화된 보상에서 버려진다.
    const eco = newEco(); eco.s.lineageSigil = 0;
    const gold0 = eco.s.gold; eco.applyIapState({ grants: [{ opId: 'g1', productId: 'x', rewards: { lineageSigil: 99, gold: 1 } }] });
    expect(eco.s.gold).toBe(gold0 + 1);   // 지급 경로는 실제로 돌았고(골드 1), 문장만 버려진다
    expect(eco.s.lineageSigil).toBe(0);
  });
});

describe('도감 마일스톤 보상 · 우편', () => {
  test('보상은 재료·문장뿐(능력치·현금 키 없음), 일회성 총량이 정해져 있다', () => {
    const allowed = ['stones', 'stones2', 'stones3', 'fragments', 'bless', 'protect', 'lineageSigil'];
    for (const m of GEAR_DEX_MILESTONES) { expect(Object.keys(m.rewards).length).toBeGreaterThan(0); for (const k of Object.keys(m.rewards)) expect(allowed).toContain(k); expect(m.rewards).not.toHaveProperty('gems'); }
    const total = GEAR_DEX_MILESTONES.reduce((a, m) => a + ((m.rewards as any).lineageSigil || 0), 0);
    expect(total).toBe(9); expect(GEAR_DEX_MILESTONES.filter((m) => m.title).length).toBeGreaterThanOrEqual(3);
  });

  test('수령하면 표의 보상이 정확히 한 번 지급된다(재료·문장), 같은 영웅의 다른 마일스톤은 별도', () => {
    const eco = newEco(), ids = Object.keys(ITEM_BY_ID); eco.s.lineageSigil = 0;
    eco.s.gearDex = { v: 1, drop: {}, kin: { mage: ids.slice(0, 15) }, claimed: {} };
    const s0 = eco.s.stones2, st3 = eco.s.stones3;
    const a = eco.gearDexClaim('mage', 'kin5'), b = eco.gearDexClaim('mage', 'kin15');
    expect(a.ok && b.ok).toBe(true);
    expect(eco.s.lineageSigil).toBe(1 + 2); expect(eco.s.stones2 - s0).toBe(5); expect(eco.s.stones3 - st3).toBe(2);
    const before = JSON.stringify([eco.s.lineageSigil, eco.s.stones2, eco.s.stones3]);
    expect(eco.gearDexClaim('mage', 'kin5')).toMatchObject({ ok: false, reason: 'claimed' });
    expect(JSON.stringify([eco.s.lineageSigil, eco.s.stones2, eco.s.stones3])).toBe(before);
    expect(eco.gearDexClaim('mage', 'kin30')).toMatchObject({ ok: false, reason: 'locked' });
  });

  test('우편 2종: 계승 안내·도감 안내는 보상 없는 안내이고, 수령(확인)은 멱등', () => {
    const eco = newEco();
    const m3 = eco.s.mail.find((m: any) => m.id === 3), m4 = eco.s.mail.find((m: any) => m.id === 4);
    expect(m3.title).toContain('계승 의식'); expect(m4.title).toContain('도감');
    expect(m3.rewards).toEqual({}); expect(m4.rewards).toEqual({});
    const before = JSON.stringify([eco.s.gold, eco.s.gems, eco.s.lineageSigil]);
    expect(eco.claimMail(3)).toEqual([]); expect(eco.claimMail(3)).toBeNull();   // 두 번째는 받을 것이 없다
    expect(JSON.stringify([eco.s.gold, eco.s.gems, eco.s.lineageSigil])).toBe(before);
  });

  test('이전 저장도 정규화하면 새 우편이 읽지 않음으로 붙고 기존 수령 표시는 유지', () => {
    const eco = newEco(); const raw = JSON.parse(JSON.stringify(eco.s)); raw.mail = [{ id: 1, read: true }, { id: 2, read: true }];
    const out = normalizeSave(raw, eco.fresh());
    expect(out.mail.map((m: any) => [m.id, m.read])).toEqual([[1, true], [2, true], [3, false], [4, false]]);
  });
});
