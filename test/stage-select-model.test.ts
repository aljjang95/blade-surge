import { expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import {
  STAGE_SELECT_STORAGE_KEY, normalizeStageSelectMemory, readStageSelectMemory, writeStageSelectMemory,
  powerTone, nextCampaignStage, campaignStages, dungeonStages, stageSelectModel, selectedEntry, isRecommendedSelection, entryAction,
} from '../src/game/stage-select-model.js';

const fresh = () => { const eco = new Economy(); return { eco, expedition: new ExpeditionEconomy(eco) }; };
const inputs = (eco: any, expedition: any, extra: any = {}) => ({
  progress: eco.s.progress, expedition, power: eco.heroPower(eco.s.selected), heroLevel: eco.hero().level, energy: eco.s.energy, ...extra,
});
const memoryStore = () => { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; };

test('기억 정규화: 잘못된 값은 버리고 멱등이다', () => {
  expect(normalizeStageSelectMemory(null)).toEqual({ introSeen: false, last: null });
  expect(normalizeStageSelectMemory('x')).toEqual({ introSeen: false, last: null });
  expect(normalizeStageSelectMemory([1])).toEqual({ introSeen: false, last: null });
  expect(normalizeStageSelectMemory({ introSeen: 'true', last: { tab: 'campaign', ch: 7, st: 1 } })).toEqual({ introSeen: false, last: null });
  expect(normalizeStageSelectMemory({ introSeen: true, last: { tab: 'campaign', ch: 1, st: 2.5 } })).toEqual({ introSeen: true, last: null });
  expect(normalizeStageSelectMemory({ last: { tab: 'dungeon', id: '../x' } }).last).toBeNull();
  const ok = normalizeStageSelectMemory({ introSeen: true, last: { tab: 'dungeon', id: 'glass_garden', depth: 'weird', followed: 1 }, extra: 9 });
  expect(ok).toEqual({ introSeen: true, last: { tab: 'dungeon', id: 'glass_garden', depth: 'standard', followed: false } });
  expect(normalizeStageSelectMemory(ok)).toEqual(ok);
  const camp = { introSeen: false, last: { tab: 'campaign', ch: 2, st: 5, followed: true } };
  expect(normalizeStageSelectMemory(normalizeStageSelectMemory(camp))).toEqual(camp);
});

test('기억 읽기·쓰기: 저장 공간 예외·손상 JSON 은 기본값', () => {
  const store = memoryStore();
  expect(readStageSelectMemory(store)).toEqual({ introSeen: false, last: null });
  expect(writeStageSelectMemory({ introSeen: true, last: { tab: 'campaign', ch: 1, st: 3 } }, store)).toBe(true);
  expect(JSON.parse(store.values.get(STAGE_SELECT_STORAGE_KEY)!)).toEqual({ introSeen: true, last: { tab: 'campaign', ch: 1, st: 3, followed: false } });
  expect(readStageSelectMemory(store).last).toEqual({ tab: 'campaign', ch: 1, st: 3, followed: false });
  store.values.set(STAGE_SELECT_STORAGE_KEY, '{broken');
  expect(readStageSelectMemory(store)).toEqual({ introSeen: false, last: null });
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  expect(readStageSelectMemory(throwing)).toEqual({ introSeen: false, last: null });
  expect(writeStageSelectMemory({ introSeen: true }, throwing)).toBe(false);
});

test('전투력 색과 다음 관문', () => {
  expect(powerTone(3000, 2600)).toBe('ok');
  expect(powerTone(2100, 2600)).toBe('close');
  expect(powerTone(1000, 2600)).toBe('low');
  expect(nextCampaignStage({ unlocked: 1 })).toEqual({ ch: 1, st: 1 });
  expect(nextCampaignStage({ unlocked: 4 })).toEqual({ ch: 1, st: 4 });
  expect(nextCampaignStage({ unlocked: 11 })).toEqual({ ch: 2, st: 1 });
  expect(nextCampaignStage({ unlocked: 999 })).toEqual({ ch: 6, st: 10 });
});

test('신규 저장: 캠페인 탭, 1-1 추천·선택, 나머지 잠김(사유 한 줄), 첫 안내 표시', () => {
  const { eco, expedition } = fresh();
  const before = structuredClone(eco.s);
  const model: any = stageSelectModel(inputs(eco, expedition));
  expect(model.tab).toBe('campaign');
  expect(model.selection).toEqual({ tab: 'campaign', ch: 1, st: 1 });
  expect(model.intro).toBe(true);
  const stages = model.campaign.stages;
  expect(stages).toHaveLength(10);
  expect(stages[0]).toMatchObject({ code: '1-1', unlocked: true, recommended: true, cleared: false, lockReason: '' });
  expect(stages[1]).toMatchObject({ code: '1-2', unlocked: false, lockReason: '1-1 클리어 시 해금' });
  expect(stages[4]).toMatchObject({ midboss: true, rankLabel: '중간 보스' });
  expect(stages[9]).toMatchObject({ regionBoss: true, rankLabel: '지역 보스', unlocksChapter: 2 });
  expect(stages[0].rewards.map((r: any) => r.id)).toEqual(['gold', 'exp', 'gems']);
  expect(stages[0].cost).toBeGreaterThan(0);
  expect(model.campaign.chapters[1]).toMatchObject({ id: 2, unlocked: false, lockReason: '1-10 클리어 시 열림' });
  const entry = selectedEntry(model);
  expect(entry.code).toBe('1-1');
  expect(entryAction(entry)).toMatchObject({ enabled: true, reason: '' });
  expect(entryAction(stages[2])).toMatchObject({ enabled: false, reason: '1-2 클리어 시 해금' });
  // 읽기 전용
  expect(eco.s).toEqual(before);
});

test('1-3 까지 깬 저장: 추천·기본 선택은 1-4, 별 기록 반영, 첫 안내 없음', () => {
  const { eco, expedition } = fresh();
  eco.s.progress.unlocked = 4; eco.s.progress.stars = { '1-1': 3, '1-2': 2, '1-3': 1 };
  const model: any = stageSelectModel(inputs(eco, expedition));
  expect(model.selection).toEqual({ tab: 'campaign', ch: 1, st: 4 });
  expect(model.intro).toBe(false);
  const stages = model.campaign.stages;
  expect(stages[0]).toMatchObject({ stars: 3, cleared: true });
  expect(stages[0].rewards.map((r: any) => r.id)).toEqual(['gold', 'exp']);
  expect(stages[3]).toMatchObject({ recommended: true, unlocked: true });
  expect(stages[4].unlocked).toBe(false);
});

test('마지막 선택 기억: 지난 관문 그대로, 추천을 골랐으면 새 추천, 잠긴 기억은 무시', () => {
  const { eco, expedition } = fresh();
  eco.s.progress.unlocked = 4; eco.s.progress.stars = { '1-1': 3, '1-2': 2, '1-3': 1 };
  const exact: any = stageSelectModel(inputs(eco, expedition, { memory: { introSeen: true, last: { tab: 'campaign', ch: 1, st: 2 } } }));
  expect(exact.selection).toEqual({ tab: 'campaign', ch: 1, st: 2 });
  const followed: any = stageSelectModel(inputs(eco, expedition, { memory: { last: { tab: 'campaign', ch: 1, st: 3, followed: true } } }));
  expect(followed.selection).toEqual({ tab: 'campaign', ch: 1, st: 4 });
  const locked: any = stageSelectModel(inputs(eco, expedition, { memory: { last: { tab: 'campaign', ch: 3, st: 1 } } }));
  expect(locked.selection).toEqual({ tab: 'campaign', ch: 1, st: 4 });
  const dungeon: any = stageSelectModel(inputs(eco, expedition, { memory: { last: { tab: 'dungeon', id: 'glass_garden', depth: 'standard' } } }));
  expect(dungeon.tab).toBe('dungeon');
  expect(selectedEntry(dungeon)).toMatchObject({ id: 'glass_garden', depth: 'standard', unlocked: true });
  // 던전 카드로 직접 고른 던전이 기억보다 먼저다.
  const prefer: any = stageSelectModel(inputs(eco, expedition, { memory: { last: { tab: 'campaign', ch: 1, st: 2 } }, prefer: { tab: 'dungeon', id: 'eclipse_hydra_vault' } }));
  expect(prefer.selection).toEqual({ tab: 'dungeon', id: 'eclipse_hydra_vault', depth: 'standard' });
  expect(isRecommendedSelection(exact, { tab: 'campaign', ch: 1, st: 4 })).toBe(true);
  expect(isRecommendedSelection(exact, { tab: 'campaign', ch: 1, st: 2 })).toBe(false);
});

test('던전 탭: 열린 던전 전부 + 다음 잠긴 1곳, 심층은 정의가 있을 때만·조건 사유', () => {
  const { eco, expedition } = fresh();
  const result: any = dungeonStages({ expedition, power: eco.heroPower(eco.s.selected), energy: eco.s.energy });
  const open = result.dungeons.filter((d: any) => d.unlocked);
  expect(open.length).toBe(result.open);
  expect(result.dungeons.length).toBe(result.open + 1);
  expect(result.hiddenLocked).toBe(result.total - result.dungeons.length);
  const locked = result.dungeons.find((d: any) => !d.unlocked);
  expect(locked.depths[0].lockReason).toMatch(/탐험 레벨 \d+ 필요/);
  const garden = result.dungeons.find((d: any) => d.id === 'glass_garden');
  expect(garden.depths.map((d: any) => d.depth)).toEqual(['standard', 'deep']);
  expect(garden.depths[0]).toMatchObject({ unlocked: true, cost: 4 });
  expect(garden.depths[1]).toMatchObject({ unlocked: false, lockReason: '캠페인 2-10 클리어 필요' });
  expect(garden.depths[1].rewards.some((r: any) => r.id === 'first')).toBe(true);
  expect(entryAction(garden.depths[1]).enabled).toBe(false);
  // 단일 소스 교체: 다른 판정을 넘기면 그 판정을 그대로 쓴다.
  const swapped: any = dungeonStages({ expedition, power: 0, source: [{ dungeon: { id: 'glass_garden', name: '정원', stage: { recPower: 2600 }, energy: 4, minLevel: 1, rewards: {} }, unlocked: false, reason: '마을 해금 필요', wins: 0, cleared: false }] });
  expect(swapped.dungeons[0].depths[0]).toMatchObject({ unlocked: false, lockReason: '마을 해금 필요' });
});

test('캠페인 완주 저장은 던전 탭이 추천, 에너지 부족은 입장 가능하되 사유 표시', () => {
  const { eco, expedition } = fresh();
  eco.s.progress.unlocked = 60; eco.s.progress.stars = { '6-10': 1 };
  const model: any = stageSelectModel(inputs(eco, expedition, { energy: 0, dungeonRecommended: { id: 'glass_garden', depth: 'standard' } }));
  expect(model.finished).toBe(true);
  expect(model.selection).toEqual({ tab: 'dungeon', id: 'glass_garden', depth: 'standard' });
  const action = entryAction(selectedEntry(model));
  expect(action.enabled).toBe(true);
  expect(action.reason).toContain('에너지가 부족');
});

test('지역 화면을 따로 고를 수 있고 난이도 배율이 보상에 반영된다', () => {
  const { eco, expedition } = fresh();
  const model: any = stageSelectModel(inputs(eco, expedition, { chapter: 2 }));
  expect(model.campaign.chapter).toBe(2);
  expect(model.campaign.stages.every((s: any) => !s.unlocked)).toBe(true);
  expect(selectedEntry(model)).toBeNull();
  const base: any = campaignStages({ progress: eco.s.progress, chapter: 1, power: 0, heroLevel: 1 });
  const boosted: any = campaignStages({ progress: eco.s.progress, chapter: 1, power: 0, heroLevel: 1, difficulty: { name: '숙련', rewardMul: 2, expMul: 1 } });
  expect(boosted.stages[0].rewards[0].amount).toBe(base.stages[0].rewards[0].amount * 2);
  expect(boosted.stages[0].difficultyName).toBe('숙련');
});
