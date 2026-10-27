import { expect, test } from 'bun:test';
import { SEASON, TOWER, EVENT_WEEKS, EVENT_EFFECT_KINDS, HELL_DIFFICULTY } from '../src/data/content-90d.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, applyDifficulty } from '../src/game/difficulty.js';
import {
  normalizeEndgame, migrateEndgame, towerWeekId, seasonAt, activeEvents, eventCalendar, applyEventRewards, recordDifficultyClear, chapterClearedAt,
  towerCap, towerFloorSource, towerScale, towerStage, towerFirstClearRewards, recordTowerClear, towerChest, claimTowerChest, towerSummary,
} from '../src/game/endgame-core.js';
import { Economy } from '../src/game/economy.js';
import { CHAPTERS, stageDef } from '../src/data/stages.js';
import { lootTable } from '../src/data/loot-tables.js';
import { normalizeSave } from '../src/game/save.js';
import { contractRows, claimContract } from '../src/game/journey-core.js';

const DAY = 86400000, WEEK = 7 * DAY;
const at = (week: number, day = 0, hour = 12) => SEASON.startMs + week * WEEK + day * DAY + hour * 3600000;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const ecoAt = (nowMs: number) => new Economy({ now: () => nowMs, storage: memory(), rng: () => .5 });

test('시즌 주차는 월요일 05:00 KST 경계로 넘어가고 13주마다 다음 시즌이 된다', () => {
  expect(new Date(SEASON.startMs).toISOString()).toBe('2026-10-25T20:00:00.000Z');
  expect(seasonAt(SEASON.startMs - 1)).toMatchObject({ preseason: true, week: 0, season: 1 });
  expect(seasonAt(SEASON.startMs)).toMatchObject({ preseason: false, week: 0, day: 0, weekend: false });
  expect(seasonAt(at(0, 5))).toMatchObject({ week: 0, day: 5, weekend: true });
  expect(seasonAt(at(1) - 12 * 3600000 - 1).week).toBe(0);
  expect(seasonAt(at(13))).toMatchObject({ season: 2, week: 0, absoluteWeek: 13 });
});

test('이벤트 달력 13주는 구현된 효과만 쓰고 주말 이벤트는 토·일에만 켜진다', () => {
  expect(EVENT_WEEKS).toHaveLength(SEASON.weeks);
  for (const [i, w] of EVENT_WEEKS.entries()) {
    expect(w.week).toBe(i);
    expect(w.effects.length).toBeGreaterThan(0);
    for (const e of w.effects) expect(EVENT_EFFECT_KINDS).toContain(e.kind);
  }
  expect(activeEvents(SEASON.startMs - 1)).toEqual([]);
  expect(activeEvents(at(0)).map((e) => e.id)).toEqual(['muster']);
  expect(activeEvents(at(2, 1))).toEqual([]);              // 대장간 주말: 화요일은 꺼짐
  expect(activeEvents(at(2, 5)).map((e) => e.id)).toEqual(['forge-weekend']);
  const cal = eventCalendar(at(12, 2), 3);
  expect(cal.map((c) => c.id)).toEqual(['season-finale', 'muster', 'tower-open']);
  expect(cal[0]).toMatchObject({ current: true, active: true });
});

test('이벤트 보상은 완료 보상에만 곱하고 입력을 바꾸지 않는다', () => {
  const base = { gold: 1000, exp: 300, stones: 2, firstGems: 60 };
  expect(applyEventRewards(base, activeEvents(at(0)), 'campaign')).toEqual({ gold: 1500, exp: 300, stones: 2, firstGems: 60 });
  expect(applyEventRewards(base, activeEvents(at(7)), 'campaign')).toEqual({ gold: 1300, exp: 300, stones: 4, firstGems: 60 });
  expect(applyEventRewards(base, activeEvents(at(3)), 'campaign').exp).toBe(390);
  expect(base).toEqual({ gold: 1000, exp: 300, stones: 2, firstGems: 60 });
  expect(applyEventRewards({ gold: 100, gems: 50 }, activeEvents(at(9)), 'tower')).toEqual({ gold: 200, gems: 100 });
  expect(applyEventRewards({ gold: 100 }, activeEvents(at(9)), 'campaign')).toEqual({ gold: 100 });
});

test('지옥 난이도는 가장 높은 배율과 보상, 별도 드랍 행을 가진다', () => {
  expect(DIFFICULTY_ORDER).toEqual(['story', 'adept', 'nightmare', 'hell']);
  const hell = DIFFICULTIES.hell, nm = DIFFICULTIES.nightmare;
  for (const k of ['enemyHp', 'enemyAtk', 'enemyDensity', 'rewardMul', 'expMul'] as const) expect(hell[k]).toBeGreaterThan(nm[k]);
  expect(hell.name).toBe(HELL_DIFFICULTY.name);
  const t = lootTable(6, 'boss', 'hell'), n = lootTable(6, 'boss', 'nightmare');
  expect(t.stones3).toBeGreaterThan(n.stones3);
  expect(t.gearWeights.L).toBeGreaterThanOrEqual(n.gearWeights.L);
  expect(lootTable(3, 'elite', 'hell').gearWeights.L).toBeGreaterThan(lootTable(3, 'elite', 'nightmare').gearWeights.L);
  const s = applyDifficulty(stageDef(6, 10), hell);
  expect(s.difficultyId).toBe('hell');
  expect(s.rewards.gold).toBe(Math.floor(stageDef(6, 10).rewards.gold * hell.rewardMul));
});

test('난이도 최고 기록은 낮아지지 않고 지역 전체 클리어를 판정한다', () => {
  const s = normalizeEndgame(null);
  expect(recordDifficultyClear(s, 1, 1, 'nightmare')).toBe(true);
  expect(recordDifficultyClear(s, 1, 1, 'adept')).toBe(false);
  expect(s.peak['1-1']).toBe(2);
  expect(recordDifficultyClear(s, CHAPTERS.length + 1, 1, 'story')).toBe(false);
  expect(recordDifficultyClear(s, 1, 1, 'mythic')).toBe(false);
  expect(chapterClearedAt(s, 1, 'nightmare')).toBe(false);
  for (let st = 2; st <= 10; st++) recordDifficultyClear(s, 1, st, 'hell');
  expect(chapterClearedAt(s, 1, 'nightmare')).toBe(true);
  expect(chapterClearedAt(s, 1, 'hell')).toBe(false);
});

test('엔드게임 저장은 잘못된 값을 버리고 두 번 정규화해도 같다', () => {
  const raw = { peak: { '1-1': 3, '9-1': 2, 'x': 1, '2-2': -5, '2-3': 99 }, tower: { best: -3, week: 'a', weekCleared: 2.5, chestWeek: 4 }, receipts: ['ok:1', 'bad id', 7] };
  const once = normalizeEndgame(raw), twice = normalizeEndgame(once);
  expect(once).toEqual(twice);
  expect(once.peak).toEqual({ '1-1': 3, '2-3': 3 });
  expect(once.tower).toEqual({ best: 0, week: 0, weekCleared: 0, chestWeek: 4 });
  expect(once.receipts).toEqual(['ok:1']);
  const save = normalizeSave({ endgame: raw }, ecoAt(at(0)).fresh());
  expect(save.endgame).toEqual(once);
});

test('무한의 성 층은 지역을 돌고 5층·10층이 중간·최종 보스, 적 배율은 층 번호로 오른다', () => {
  expect(towerFloorSource(1)).toMatchObject({ ch: 1, st: 1 });
  expect(towerFloorSource(15)).toMatchObject({ ch: 2, st: 5 });
  expect(towerFloorSource(60)).toMatchObject({ ch: 6, st: 10 });
  expect(towerFloorSource(61)).toMatchObject({ ch: 1, st: 1, cycle: 1 });
  for (let f = 2; f <= 300; f++) expect(towerScale(f)).toBeGreaterThan(towerScale(f - 1));
  const s = towerStage(25);
  expect(s.code).toBe('T25'); expect(s.tower).toEqual({ floor: 25, sourceCode: '3-5' });
  expect(s.scale).toBeCloseTo(towerScale(25)); expect(s.energy).toBe(0);
  expect(s.boss).toBe(true); expect((s as any).midboss).toBe(true); expect((s as any).unlocksChapter).toBe(null);
  expect(s.dungeon).toBe(stageDef(3, 5).dungeon);
  expect(s.idx).toBe(stageDef(3, 5).idx);  // 방 구성은 원본 관문 그대로
  expect(stageDef(3, 5).scale).not.toBe(s.scale); // 원본 정의는 바뀌지 않는다
});

test('무한의 성은 다음 층만, 시즌 상한까지, 영수증 한 번씩 기록된다', () => {
  const s = normalizeEndgame(null), now = at(0);
  expect(towerCap(now)).toBe(TOWER.capBase);
  expect(towerCap(at(4))).toBe(TOWER.capBase + 4 * TOWER.capPerWeek);
  expect(towerCap(SEASON.startMs - 1)).toBe(TOWER.capBase);
  expect(recordTowerClear(s, { floor: 2, receiptId: 'tower:a', nowMs: now })).toEqual({ ok: false, error: 'order' });
  const first = recordTowerClear(s, { floor: 1, receiptId: 'tower:a', nowMs: now });
  expect(first.ok).toBe(true);
  expect(recordTowerClear(s, { floor: 2, receiptId: 'tower:a', nowMs: now })).toEqual({ ok: false, error: 'duplicate' });
  expect(recordTowerClear(s, { floor: 2, receiptId: 'bad id', nowMs: now })).toEqual({ ok: false, error: 'invalid' });
  s.tower.best = TOWER.capBase;
  expect(recordTowerClear(s, { floor: TOWER.capBase + 1, receiptId: 'tower:b', nowMs: now })).toEqual({ ok: false, error: 'cap' });
  expect(recordTowerClear(s, { floor: TOWER.capBase + 1, receiptId: 'tower:b', nowMs: at(1) }).ok).toBe(true);
});

test('첫 돌파 보상은 층 구간에 따라 상위 재화가 붙고 성 개방 주에는 1.5배다', () => {
  expect(towerFirstClearRewards(1)).toEqual({ gold: 300, stones: 2 });
  expect(towerFirstClearRewards(10)).toMatchObject({ stones2: 1, stones3: 1, gems: 50 });
  expect(towerFirstClearRewards(25)).toMatchObject({ transcendStones: 1 });
  const s = normalizeEndgame(null), r = recordTowerClear(s, { floor: 1, receiptId: 't:1', nowMs: at(1) });
  expect(r.ok && r.rewards).toEqual({ gold: 450, stones: 3 });
});

test('주간 보급 상자는 이번 주 돌파가 있어야 열리고 주마다 한 번이다', () => {
  const s = normalizeEndgame(null);
  expect(towerChest(s, at(0)).ready).toBe(false);
  for (let f = 1; f <= 20; f++) recordTowerClear(s, { floor: f, receiptId: `t:${f}`, nowMs: at(0) });
  const chest = towerChest(s, at(0));
  expect(chest).toMatchObject({ ready: true, claimed: false, weekCleared: 20 });
  expect(chest.tier?.floor).toBe(20);
  const claim = claimTowerChest(s, at(0, 3));
  expect(claim).toEqual({ ok: true, rewards: { gold: 6000, stones: 15, stones2: 4, gems: 50 } });
  expect(claimTowerChest(s, at(0, 4))).toEqual({ ok: false, error: 'claimed' });
  expect(towerChest(s, at(1)).ready).toBe(false);   // 새 주: 아직 돌파 없음
  recordTowerClear(s, { floor: 21, receiptId: 't:21', nowMs: at(1) });
  expect(towerChest(s, at(1)).ready).toBe(true);
});

test('Economy: 무한의 성 정산은 진행도·에너지·별을 바꾸지 않고 한 번만 지급한다', () => {
  const eco = ecoAt(at(0, 1));
  expect(eco.towerSummary().unlocked).toBe(false);
  expect(eco.nextTowerStage()).toBe(null);
  eco.s.progress.unlocked = TOWER.unlockStageIdx;
  const stage = eco.nextTowerStage();
  expect(stage?.tower.floor).toBe(1);
  const before = { gold: eco.s.gold, stones: eco.s.stones, energy: eco.s.energy, unlocked: eco.s.progress.unlocked, stars: { ...eco.s.progress.stars } };
  const r: any = eco.completeTowerFloor(stage, { receiptId: 'tower:1', fieldGold: 50 });
  expect(r.ok).toBe(true);
  expect(eco.s.gold - before.gold).toBe(300 + 50);
  expect(eco.s.stones - before.stones).toBe(2);
  expect(eco.s.energy).toBe(before.energy);
  expect(eco.s.progress.unlocked).toBe(before.unlocked);
  expect(eco.s.progress.stars).toEqual(before.stars);
  expect(eco.s.endgame.tower.best).toBe(1);
  expect(eco.completeTowerFloor(stage, { receiptId: 'tower:1' })).toMatchObject({ ok: false });
  expect(eco.completeTowerFloor(stage, { receiptId: 'tower:1b' })).toMatchObject({ ok: false, error: 'order' });
  const rows = contractRows(eco.s.journey, at(0, 1));
  expect(rows.daily.find((c: any) => c.id === 'daily_tower')).toMatchObject({ cur: 1, ready: true });
  expect(rows.weekly.find((c: any) => c.id === 'weekly_tower')).toMatchObject({ cur: 1, ready: false });
  expect(eco.claimTowerChest()).toMatchObject({ ok: true });
  expect(eco.towerSummary()).toMatchObject({ best: 1, next: 2, chest: { claimed: true } });
});

test('Economy: 캠페인 완료는 난이도 기록·하드 임무를 남기고 이벤트는 완료 골드에만 붙는다', () => {
  const pre = ecoAt(SEASON.startMs - DAY), muster = ecoAt(at(0, 1));
  const a: any = pre.completeStage(pre.nextStage(), 3), b: any = muster.completeStage(muster.nextStage(), 3);
  const gold = (r: any) => r.got.find((g: any) => g.k === 'gold').n;
  expect(gold(b)).toBe(Math.floor(stageDef(1, 1).rewards.gold * 1.5));
  expect(gold(a)).toBe(stageDef(1, 1).rewards.gold);
  expect(muster.s.endgame.peak['1-1']).toBe(0);
  muster.s.progress.unlocked = 3;
  const adept = applyDifficulty(stageDef(1, 1), DIFFICULTIES.adept);
  muster.completeStage(adept, 3);
  expect(muster.s.endgame.peak['1-1']).toBe(1);
  expect(contractRows(muster.s.journey, at(0, 1)).daily.find((c: any) => c.id === 'daily_hard')?.cur).toBe(1);
  const view = towerSummary(muster.s.endgame, muster.s.progress, at(0, 1));
  expect(view).toMatchObject({ unlocked: false, best: 0, next: 1, source: '1-1' });
});

test('시계를 되돌려도 주간 보급을 다시 받을 수 없고 시즌 전 주차는 1주차와 다르다', () => {
  expect(towerWeekId(SEASON.startMs - 1)).toBe(1);
  expect(towerWeekId(at(0))).toBe(2);
  expect(towerWeekId(at(3))).toBe(5);
  const s = normalizeEndgame(null);
  recordTowerClear(s, { floor: 1, receiptId: 't:1', nowMs: at(2) });
  expect(claimTowerChest(s, at(2)).ok).toBe(true);
  // 기기 시계를 1주 되돌림: 주차는 뒤로 가지 않고 수령 완료로 남는다
  expect(towerChest(s, at(1)).claimed).toBe(true);
  expect(claimTowerChest(s, at(1))).toEqual({ ok: false, error: 'claimed' });
  recordTowerClear(s, { floor: 2, receiptId: 't:2', nowMs: at(1) });
  expect(s.tower.week).toBe(towerWeekId(at(2)));
  expect(claimTowerChest(s, at(1))).toEqual({ ok: false, error: 'claimed' });
  expect(claimTowerChest(s, SEASON.startMs - 1)).toEqual({ ok: false, error: 'claimed' });
  // 다음 주(실제로 앞으로)에는 다시 돌파하면 받는다
  recordTowerClear(s, { floor: 3, receiptId: 't:3', nowMs: at(3) });
  expect(claimTowerChest(s, at(3)).ok).toBe(true);
  // 시즌 전 수령은 1주차 수령을 막지 않는다
  const p = normalizeEndgame(null);
  recordTowerClear(p, { floor: 1, receiptId: 'p:1', nowMs: SEASON.startMs - DAY });
  expect(claimTowerChest(p, SEASON.startMs - DAY).ok).toBe(true);
  recordTowerClear(p, { floor: 2, receiptId: 'p:2', nowMs: at(0) });
  expect(claimTowerChest(p, at(0)).ok).toBe(true);
  expect(towerChest(p, at(0)).nextResetAt).toBe(at(1, 0, 0));
});

test('탑 상한에 닿은 주에는 탑 임무가 달성으로 처리되고 같은 목록으로만 수령된다', () => {
  const journey = ecoAt(at(0)).s.journey;
  const plain = contractRows(journey, at(0)).daily.find((c: any) => c.id === 'daily_tower');
  expect(plain).toMatchObject({ cur: 0, ready: false });
  const waived = contractRows(journey, at(0), { waived: ['towerFloors'] });
  expect(waived.daily.find((c: any) => c.id === 'daily_tower')).toMatchObject({ cur: 1, ready: true, waived: true });
  expect(waived.weekly.find((c: any) => c.id === 'weekly_tower')).toMatchObject({ cur: 5, ready: true });
  expect(waived.daily.find((c: any) => c.id === 'daily_hard')).toMatchObject({ cur: 0, ready: false });
  expect(claimContract(journey, 'daily', 'daily_tower')).toMatchObject({ ok: false });
  expect(claimContract(journey, 'daily', 'daily_tower', { waived: ['towerFloors'] })).toMatchObject({ ok: true });
});

test('엔드게임 이전 저장은 별점과 최근 전투 기록의 난이도 승리를 이월한다', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ runId: i + 1, floor: i + 1, outcome: 'victory', boonIds: [],
    details: { route: { kind: 'campaign', id: `1-${i + 1}`, difficultyId: 'nightmare' }, control: 'auto' } }));
  history.push({ runId: 99, floor: 11, outcome: 'defeat', boonIds: [], details: { route: { kind: 'campaign', id: '2-1', difficultyId: 'nightmare' }, control: 'auto' } });
  const raw = { progress: { unlocked: 12, stars: { '1-1': 3, '2-1': 1 }, difficulty: 'story' }, masterworks: { history } };
  const save: any = normalizeSave(raw, ecoAt(at(0)).fresh());
  expect(save.endgame.peak['1-1']).toBe(2);
  expect(save.endgame.peak['2-1']).toBe(0);   // 패배는 이월하지 않는다
  expect(chapterClearedAt(save.endgame, 1, 'nightmare')).toBe(true);
  expect(migrateEndgame({})).toEqual(normalizeEndgame(null));
  // 이미 엔드게임이 있는 저장은 다시 이월하지 않는다
  expect(normalizeSave({ ...raw, endgame: { peak: {} } }, ecoAt(at(0)).fresh()).endgame.peak).toEqual({});
});
