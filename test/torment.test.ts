import { expect, test } from 'bun:test';
import { SEASON, TORMENT, HELL_DIFFICULTY } from '../src/data/content-90d.js';
import {
  DIFFICULTIES, DIFFICULTY_ORDER, applyDifficulty, resolveDifficulty, availableDifficulties, availableTorments, tormentId, tormentTierOf, tormentScale, tormentMul, tormentUnlockedTier,
} from '../src/game/difficulty.js';
import { normalizeEndgame } from '../src/game/endgame-core.js';
import { recordTormentRun, tormentStatus, tormentDayId } from '../src/game/torment-core.js';
import { Economy } from '../src/game/economy.js';
import { stageDef } from '../src/data/stages.js';
import { lootTable } from '../src/data/loot-tables.js';
import { normalizeSave } from '../src/game/save.js';
import { campaignStage, parseStageCode } from '../src/shared/settlement.js';

const DAY = 86400000;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const clock = { now: SEASON.startMs + 3 * DAY + 12 * 3600000 };
const newEco = () => new Economy({ now: () => clock.now, storage: memory(), rng: () => .5 });
/** 1지역 10관문 지옥 클리어(고통 단계 해금 조건)와 6지역까지 진행도 */
const hellCleared = (eco: any, chapters = [1]) => {
  eco.s.progress.unlocked = 60;
  for (const ch of chapters) for (let st = 1; st <= 10; st++) eco.s.endgame.peak[`${ch}-${st}`] = 3;
  return eco;
};

test('고통 단계 id 해석: torment-1~50 만 인정하고 나머지는 0', () => {
  expect(tormentTierOf('torment-1')).toBe(1);
  expect(tormentTierOf('torment-50')).toBe(50);
  for (const bad of ['torment-0', 'torment-51', 'torment-05', 'torment-', 'torment-1x', 'hell', '', undefined, null, 7, 'TORMENT-3', 'torment--1', 'torment-1.5']) expect(tormentTierOf(bad as any)).toBe(0);
  expect(tormentId(12)).toBe('torment-12');
  for (let n = 1; n <= TORMENT.maxTier; n++) expect(Object.hasOwn(DIFFICULTIES, tormentId(n))).toBe(true);
  expect(Object.hasOwn(DIFFICULTIES, 'torment-51')).toBe(false);
  // 기존 4 난이도 순서·최고 기록 순위는 그대로(고통 단계는 순위 표 밖)
  expect(DIFFICULTY_ORDER).toEqual(['story', 'adept', 'nightmare', 'hell']);
});

test('배율: 적 체력·공격은 지옥 × M(n), 보상 ×(1+rewardStep·n), EXP ×(expBase+expStep·n), 에너지 0', () => {
  const t0 = tormentScale(0);
  expect(t0.enemyHp).toBeCloseTo(HELL_DIFFICULTY.enemyHp, 10); expect(t0.rewardMul).toBeCloseTo(HELL_DIFFICULTY.rewardMul, 10);
  for (const n of [1, 7, 30, 50]) {
    const t = tormentScale(n), d = DIFFICULTIES[tormentId(n)] as any;
    expect(t.enemyHp).toBeCloseTo(HELL_DIFFICULTY.enemyHp * (1 + TORMENT.curve.A * (1 - Math.exp(-n / TORMENT.curve.tau)) + TORMENT.curve.B * n), 8);
    expect(t.enemyAtk).toBeCloseTo(HELL_DIFFICULTY.enemyAtk * tormentMul(n), 8);
    expect(t.rewardMul).toBeCloseTo(HELL_DIFFICULTY.rewardMul * (1 + TORMENT.rewardStep * n), 8);
    expect(t.expMul).toBeCloseTo(HELL_DIFFICULTY.expMul * (TORMENT.expBase + TORMENT.expStep * n), 8);
    expect(t.enemyDensity).toBe(HELL_DIFFICULTY.enemyDensity);
    expect(d).toMatchObject({ enemyHp: t.enemyHp, enemyAtk: t.enemyAtk, rewardMul: t.rewardMul, expMul: t.expMul, tormentTier: n, energy: 0 });
  }
  // 단계가 오를수록 단조 증가
  for (let n = 2; n <= TORMENT.maxTier; n++) {
    expect(tormentScale(n).enemyHp).toBeGreaterThan(tormentScale(n - 1).enemyHp);
    expect(tormentScale(n).rewardMul).toBeGreaterThan(tormentScale(n - 1).rewardMul);
  }
  expect(tormentScale(NaN).tier).toBe(0); expect(tormentScale(999).tier).toBe(TORMENT.maxTier);
});

test('applyDifficulty: 고통 단계 스냅샷은 에너지 0·권장 레벨 80이고 원본 관문과 지옥 이하 난이도는 바뀌지 않는다', () => {
  const base = stageDef(6, 10), hellStage = applyDifficulty(base, DIFFICULTIES.hell), t = applyDifficulty(base, DIFFICULTIES['torment-10']) as any;
  expect(t.energy).toBe(0); expect(t.recommendedLevel).toBe(TORMENT.recLevel);
  expect(base.energy).toBeGreaterThan(0);
  expect(hellStage.energy).toBe(base.energy); expect((hellStage as any).recommendedLevel).toBeUndefined();
  expect(t.difficultyId).toBe('torment-10');
  expect(t.rewards.gold).toBe(Math.floor(base.rewards.gold * tormentScale(10).rewardMul));
  expect(t.rewards.exp).toBe(Math.floor(base.rewards.exp * tormentScale(10).expMul));
  expect(t.rewards.exp).toBeGreaterThan(hellStage.rewards.exp * 1.9);
  expect(t.campaignDifficulty.combatExpMul).toBeCloseTo(TORMENT.expBase + TORMENT.expStep * 10, 8);
});

test('해금: 지옥 10관문 클리어 → T1, 최고 클리어 단계 +1, 관문별 지옥 클리어 필요', () => {
  const eco = newEco();
  expect(tormentUnlockedTier(eco.s)).toBe(0);
  expect(availableTorments(eco.s, 1, 1)).toEqual([]);
  // 지역을 다 못 끝낸 지옥은 해금하지 않는다
  eco.s.endgame.peak['1-1'] = 3;
  expect(tormentUnlockedTier(eco.s)).toBe(0);
  hellCleared(eco);
  expect(tormentUnlockedTier(eco.s)).toBe(1);
  expect(availableTorments(eco.s, 1, 3).map((d: any) => d.id)).toEqual(['torment-1']);
  expect(availableTorments(eco.s, 2, 1)).toEqual([]);        // 그 관문을 지옥으로 깨지 않았다
  eco.s.endgame.torment.best = 4;
  expect(tormentUnlockedTier(eco.s)).toBe(5);
  expect(availableTorments(eco.s, 1, 10)).toHaveLength(5);
  eco.s.endgame.torment.best = 50;
  expect(tormentUnlockedTier(eco.s)).toBe(50);
  // 일반 난이도 목록(로비 선택기)은 그대로 4개
  expect(availableDifficulties(eco.s, 1, 1)).toHaveLength(4);
});

test('resolveDifficulty: 닫힌 단계 요청은 해금된 가장 높은 단계로, 지옥 클리어 전이면 지옥/하위로 내려간다', () => {
  const eco = hellCleared(newEco());
  expect(resolveDifficulty(eco.s, 1, 5, 'torment-1').id).toBe('torment-1');
  expect(resolveDifficulty(eco.s, 1, 5, 'torment-9').id).toBe('torment-1');
  eco.s.endgame.torment.best = 6;
  expect(resolveDifficulty(eco.s, 1, 5, 'torment-9').id).toBe('torment-7');
  expect(resolveDifficulty(eco.s, 1, 5, 'torment-3').id).toBe('torment-3');
  // 지옥을 깨지 못한 관문에서는 지옥(닫혀 있으면 스토리)으로
  expect(resolveDifficulty(eco.s, 2, 1, 'torment-3').id).toBe('story');
  const fresh = newEco();
  expect(resolveDifficulty(fresh.s, 1, 1, 'torment-1').id).toBe('story');
  expect(resolveDifficulty(fresh.s, 1, 1, 'torment-999').id).toBe('story');
  // 서버 정산과 같은 경로(campaignStage)가 같은 스냅샷을 만든다
  const stage = campaignStage(eco.s, '1-5', 'torment-3') as any;
  expect(stage.difficultyId).toBe('torment-3'); expect(stage.energy).toBe(0);
  expect(campaignStage(fresh.s, '1-5', 'torment-3')?.difficultyId).toBe('story');
  expect(parseStageCode('1-5')).toEqual({ ch: 1, st: 5 });
});

test('드랍 표: 고통 단계는 지옥보다 깊고 5단계마다 한 칸 더 깊다. 알 수 없는 id는 스토리 표', () => {
  const hell = lootTable(6, 'boss', 'hell'), t1 = lootTable(6, 'boss', 'torment-1'), t6 = lootTable(6, 'boss', 'torment-6'), t50 = lootTable(6, 'boss', 'torment-50');
  expect(t1.stones3).toBeGreaterThan(hell.stones3);
  expect(t6.stones3).toBeGreaterThan(t1.stones3);
  expect(t50.stones3).toBeGreaterThan(t6.stones3);
  expect(lootTable(6, 'boss', 'torment-5')).toBe(t1);              // 같은 깊이 칸은 같은 표
  expect(lootTable(6, 'boss', 'torment-51')).toBe(lootTable(6, 'boss', 'story'));
  expect(t50.transcendStones.chance).toBeGreaterThanOrEqual(hell.transcendStones.chance);
  // 장비 등급 가중: 높은 등급 질량이 지옥 이상
  const high = (w: any) => w.E + w.U + w.L;
  expect(high(t50.gearWeights)).toBeGreaterThanOrEqual(high(hell.gearWeights));
});

test('엔드게임 정화: 고통 단계 기록은 기본값에서 시작하고 손상 값은 버리며 두 번 정화해도 같다', () => {
  const e = normalizeEndgame(null);
  expect(e.torment).toEqual({ best: 0, today: { day: 0, runs: 0 } });
  expect(normalizeEndgame({ torment: { best: 9999, today: { day: -3, runs: 'x' } } }).torment).toEqual({ best: TORMENT.maxTier, today: { day: 0, runs: 0 } });
  expect(normalizeEndgame({ torment: 5 }).torment).toEqual(e.torment);
  const filled = normalizeEndgame({ torment: { best: 12, today: { day: 4, runs: 30 } } });
  expect(filled.torment).toEqual({ best: 12, today: { day: 4, runs: 30 } });
  expect(normalizeEndgame(filled)).toEqual(filled);
  const eco = newEco();
  const once = normalizeSave({ progress: { unlocked: 3, stars: {} } }, eco.fresh()), twice = normalizeSave(once, eco.fresh());
  expect(twice).toEqual(once);
});

test('하루 판 수: 첫 fullRuns 판만 풀 보상, 그 뒤는 감쇠, 다음 날(05:00 KST) 초기화, 시계를 되돌려도 초기화되지 않는다', () => {
  const state = normalizeEndgame(null), t0 = SEASON.startMs + 1 * DAY + 3600000;
  for (let i = 0; i < TORMENT.fullRuns; i++) expect(recordTormentRun(state, { tier: 1, st: 3, nowMs: t0 + i * 1000 }).full).toBe(true);
  expect(recordTormentRun(state, { tier: 1, st: 3, nowMs: t0 }).full).toBe(false);
  expect(tormentStatus(state, t0)).toMatchObject({ runsToday: TORMENT.fullRuns + 1, fullLeft: 0 });
  // 시계를 하루 전으로 되돌려도 오늘 기록이 0 으로 돌아가지 않는다
  expect(recordTormentRun(state, { tier: 1, st: 3, nowMs: t0 - DAY }).full).toBe(false);
  // 다음 날 05:00 KST 경계
  const boundary = SEASON.startMs + 2 * DAY;
  expect(tormentDayId(boundary - 1)).toBe(tormentDayId(t0));
  expect(tormentDayId(boundary)).toBe(tormentDayId(t0) + 1);
  expect(recordTormentRun(state, { tier: 1, st: 3, nowMs: boundary }).full).toBe(true);
  expect(tormentStatus(state, boundary)).toMatchObject({ runsToday: 1, fullLeft: TORMENT.fullRuns - 1 });
  expect(tormentStatus(state, boundary + 3 * DAY)).toMatchObject({ runsToday: 0, fullLeft: TORMENT.fullRuns });
});

test('최고 단계: 지역 최종 보스(X-10) 클리어만 올리고, 해금 단계보다 높은 단계는 올리지 않는다', () => {
  const state = normalizeEndgame(null), now = SEASON.startMs + DAY;
  expect(recordTormentRun(state, { tier: 1, st: 9, nowMs: now })).toMatchObject({ best: 0, newBest: false });
  expect(recordTormentRun(state, { tier: 1, st: 10, nowMs: now })).toMatchObject({ best: 1, newBest: true });
  expect(recordTormentRun(state, { tier: 1, st: 10, nowMs: now })).toMatchObject({ best: 1, newBest: false });
  expect(recordTormentRun(state, { tier: 5, st: 10, nowMs: now }).best).toBe(1);   // T2 까지만 열려 있다
  expect(recordTormentRun(state, { tier: 2, st: 10, nowMs: now }).best).toBe(2);
  expect(recordTormentRun(state, { tier: 1, st: 10, nowMs: now }).best).toBe(2);   // 낮은 단계 재클리어는 내리지 않는다
  expect(recordTormentRun(state, { tier: 2.5, st: 10, nowMs: now }).best).toBe(2);
  state.torment.best = TORMENT.maxTier;
  expect(recordTormentRun(state, { tier: TORMENT.maxTier + 1, st: 10, nowMs: now }).best).toBe(TORMENT.maxTier);
});

const stageAt = (eco: any, ch: number, st: number, id: string) => applyDifficulty(stageDef(ch, st), resolveDifficulty(eco.s, ch, st, id));
const goldOf = (r: any) => r.got.find((g: any) => g.k === 'gold')?.n || 0;
const stonesOf = (r: any) => r.got.find((g: any) => g.k === 'stones')?.n || 0;

test('정산: 고통 단계는 에너지를 쓰지 않고, 풀 보상 판 이후 골드·재료는 35%, EXP는 100%', () => {
  const eco = hellCleared(newEco()); eco.s.hero = undefined;
  const energy = eco.s.energy, stage = stageAt(eco, 1, 5, 'torment-1') as any;
  expect(stage.difficultyId).toBe('torment-1'); expect(stage.energy).toBe(0);
  const gold0 = eco.s.gold;
  const first = eco.completeStage(stage, 3, { fieldGold: 1000, fieldStones: 20 });
  expect(first.torment).toMatchObject({ tier: 1, full: true, runs: 1, best: 0, newBest: false, fullLeft: TORMENT.fullRuns - 1 });
  expect(eco.s.energy).toBe(energy);
  const fullGold = goldOf(first), fullStones = stonesOf(first);
  expect(fullGold).toBeGreaterThan(stage.rewards.gold);
  expect(eco.s.gold).toBe(gold0 + fullGold);
  // 풀 보상 판을 다 쓴다
  for (let i = 1; i < TORMENT.fullRuns; i++) expect(eco.completeStage(stage, 3, { fieldGold: 1000, fieldStones: 20 }).torment.full).toBe(true);
  const decayed = eco.completeStage(stage, 3, { fieldGold: 1000, fieldStones: 20 });
  expect(decayed.torment).toMatchObject({ full: false, runs: TORMENT.fullRuns + 1, fullLeft: 0 });
  expect(goldOf(decayed) / fullGold).toBeCloseTo(TORMENT.decayMul, 1);
  expect(stonesOf(decayed)).toBeLessThan(fullStones);
  expect(decayed.exp).toBe(first.exp);
  expect(decayed.combatExp).toBe(first.combatExp);
  // 다음 날이면 다시 풀 보상
  clock.now += DAY;
  try { expect(eco.completeStage(stage, 3, { fieldGold: 1000, fieldStones: 20 }).torment).toMatchObject({ full: true, runs: 1 }); } finally { clock.now -= DAY; }
});

test('정산: X-10 클리어가 다음 고통 단계를 연다. 낮은 관문은 열지 않는다', () => {
  const eco = hellCleared(newEco());
  const low = eco.completeStage(stageAt(eco, 1, 4, 'torment-1'), 3);
  expect(low.torment.newBest).toBe(false); expect(eco.s.endgame.torment.best).toBe(0);
  const top = eco.completeStage(stageAt(eco, 1, 10, 'torment-1'), 3);
  expect(top.torment).toMatchObject({ newBest: true, best: 1 });
  expect(tormentUnlockedTier(eco.s)).toBe(2);
  // 지옥 기록은 고통 단계 클리어로 바뀌지 않는다
  expect(eco.s.endgame.peak['1-10']).toBe(3);
  // 일반 지옥 판은 고통 단계 기록을 만들지 않는다
  const before = structuredClone(eco.s.endgame.torment);
  const hell = eco.completeStage(stageAt(eco, 1, 10, 'hell'), 3);
  expect(hell.torment).toBeNull(); expect(eco.s.endgame.torment).toEqual(before);
});

test('소탕은 고통 단계에서 쓸 수 없다(에너지 0 무전투 보상 방지)', () => {
  const eco = hellCleared(newEco()); eco.s.sweep = 3; eco.s.progress.stars['1-5'] = 3;
  const gold = eco.s.gold;
  expect(eco.sweep(stageAt(eco, 1, 5, 'torment-1'))).toBeNull();
  expect(eco.s.sweep).toBe(3); expect(eco.s.gold).toBe(gold);
});

test('Lv.80 영웅의 고통 단계 EXP는 전설 수련으로 간다(영웅 레벨 상한 80이면 권장 레벨 보정 없음)', () => {
  const eco = hellCleared(newEco()); const hero = eco.hero('knight'); hero.level = 80; hero.exp = 0;
  const t = eco.completeStage(stageAt(eco, 1, 5, 'torment-1'), 3);
  const h = eco.completeStage(stageAt(eco, 1, 5, 'hell'), 3);
  expect(t.legend).not.toBeNull();
  // 권장 레벨 80 → 가중 1.0, 낮은 장 지옥은 0.5 가중
  expect(t.exp / (stageDef(1, 5).rewards.exp * tormentScale(1).expMul)).toBeGreaterThan(0.99);
  expect(h.exp / (stageDef(1, 5).rewards.exp * HELL_DIFFICULTY.expMul)).toBeCloseTo(0.5, 1);
});

test('정산: 풀 보상 판 이후에는 보스 완료 조각(5)도 감쇠한다(리뷰 P2)', () => {
  const eco = hellCleared(newEco()); eco.s.hero = undefined;
  const stage = stageAt(eco, 1, 10, 'torment-1') as any;
  expect(stage.boss).toBeTruthy();
  const fragsOf = (r: any) => r.got.find((g: any) => g.k === 'fragments')?.n || 0;
  const full = eco.completeStage(stage, 3);
  expect(fragsOf(full)).toBe(5);
  for (let i = 1; i < TORMENT.fullRuns; i++) eco.completeStage(stage, 3);
  const decayed = eco.completeStage(stage, 3);
  expect(decayed.torment.full).toBe(false);
  expect(fragsOf(decayed)).toBe(Math.floor(5 * TORMENT.decayMul));
});
