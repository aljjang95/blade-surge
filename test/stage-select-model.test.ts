import { expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import {
  STAGE_SELECT_STORAGE_KEY, normalizeStageSelectMemory, readStageSelectMemory, writeStageSelectMemory, refreshStageSelectMemory,
  powerTone, nextCampaignStage, campaignStages, dungeonStages, stageSelectModel, selectedEntry, isRecommendedSelection, entryAction, landingPrefer, selectionSelector,
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
  expect(normalizeStageSelectMemory(normalizeStageSelectMemory(camp))).toEqual(camp as any);
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
  const prefer: any = stageSelectModel(inputs(eco, expedition, { memory: { last: { tab: 'campaign', ch: 1, st: 2 } }, prefer: { tab: 'dungeon', id: 'glass_garden' } }));
  expect(prefer.selection).toEqual({ tab: 'dungeon', id: 'glass_garden', depth: 'standard' });
  expect(isRecommendedSelection(exact, { tab: 'campaign', ch: 1, st: 4 })).toBe(true);
  expect(isRecommendedSelection(exact, { tab: 'campaign', ch: 1, st: 2 })).toBe(false);
});

test('던전 탭(지역 판정): 신규 저장 = 지역 1 던전 4곳 + 다음 마을 예고 1줄, 숨은 던전 없음, 사유는 dungeonAccess 문구', () => {
  const { eco, expedition } = fresh();
  const result: any = dungeonStages({ expedition, power: eco.heroPower(eco.s.selected), energy: eco.s.energy });
  const region = (expedition as any).regionDungeons();
  expect(result.dungeons.map((d: any) => d.id)).toEqual(['glass_garden', 'bellfall_crypt', 'rootbound_grotto', 'hollowbell_arboretum']);
  expect(result.dungeons.map((d: any) => d.id)).toEqual(region.visibleIds);
  expect(result.dungeons.some((d: any) => region.teaserIds.includes(d.id))).toBe(false);
  expect(result.total).toBe(4); expect(result.open).toBe(1);
  expect(result.teaser).toMatchObject({ region: 2, unlockCode: '1-10' });
  expect(result.teaser.reason).toBe(region.teaser.reason);
  const bell = result.dungeons.find((d: any) => d.id === 'bellfall_crypt');
  expect(bell.depths[0].lockReason).toBe(expedition.dungeonAccess('bellfall_crypt', { depth: 'standard' }).error);
  const garden = result.dungeons.find((d: any) => d.id === 'glass_garden');
  expect(garden.depths.map((d: any) => d.depth)).toEqual(['standard', 'deep']);
  expect(garden.depths[0]).toMatchObject({ unlocked: true, cost: 4 });
  expect(garden.depths[1]).toMatchObject({ unlocked: false, lockReason: expedition.dungeonAccess('glass_garden', { depth: 'deep' }).error });
  expect(garden.depths[1].rewards.some((r: any) => r.id === 'first')).toBe(true);
  expect(entryAction(garden.depths[1]).enabled).toBe(false);
  // 숨은 던전은 기억·직접 선택으로도 고를 수 없다.
  const hidden = region.teaserIds[0];
  const model: any = stageSelectModel(inputs(eco, expedition, { memory: { last: { tab: 'dungeon', id: hidden, depth: 'standard' } } }));
  expect(model.selection).toEqual({ tab: 'campaign', ch: 1, st: 1 });
  // 단일 소스 교체: 넘긴 판정을 그대로 쓴다.
  const swapped: any = dungeonStages({ expedition, power: 0, source: { nodes: [{ dungeon: { id: 'glass_garden', name: '정원', stage: { recPower: 2600 }, energy: 4, minLevel: 1, rewards: {} }, unlocked: false, reason: '마을 해금 필요', wins: 0, cleared: false }], teaser: null } });
  expect(swapped.dungeons[0].depths[0]).toMatchObject({ unlocked: false, lockReason: '마을 해금 필요' });
  expect(swapped.teaser).toBeNull();
});

test('던전 탭(지역 판정): 1-10 클리어 저장은 지역 2 던전이 보이고 예고는 지역 3', () => {
  const { eco, expedition } = fresh();
  eco.s.progress.unlocked = 11; eco.s.progress.stars = { '1-10': 1 };
  const result: any = dungeonStages({ expedition, power: 0, energy: eco.s.energy });
  const ids = result.dungeons.map((d: any) => d.id);
  expect(ids).toEqual((expedition as any).regionDungeons().visibleIds);
  for (const id of ['ember_vault', 'cinder_tide_lock', 'glass_garden', 'bellfall_crypt']) expect(ids).toContain(id);
  expect(result.teaser).toMatchObject({ region: 3, unlockCode: '2-10' });
  expect(result.dungeons.find((d: any) => d.id === 'ember_vault').depths[0].lockReason).toBe(expedition.dungeonAccess('ember_vault', { depth: 'standard' }).error);
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

test('지역 지도: 6지역 모두 U자 노드 10개(윗줄 1→5, 아랫줄 6→10), 844×390 상자에서 서로 떨어짐', async () => {
  const { STAGE_MAPS, DEFAULT_STAGE_NODES, stageMapFor } = await import('../src/data/stage-select-maps.js');
  expect(Object.keys(STAGE_MAPS)).toEqual(['1', '2', '3', '4', '5', '6']);
  expect(DEFAULT_STAGE_NODES.map(([x]: any) => Math.round(x * 100))).toEqual([12, 31, 50, 69, 88, 88, 69, 50, 31, 12]);
  for (const map of [...Object.values(STAGE_MAPS), { nodes: DEFAULT_STAGE_NODES }]) {
    expect(map.nodes).toHaveLength(10);
    map.nodes.slice(0, 5).forEach(([, y]: any) => { expect(y).toBeGreaterThan(0.2); expect(y).toBeLessThan(0.4); });
    map.nodes.slice(5).forEach(([, y]: any) => { expect(y).toBeGreaterThan(0.62); expect(y).toBeLessThan(0.8); });
    for (let i = 0; i < 4; i++) { expect(map.nodes[i + 1][0]).toBeGreaterThan(map.nodes[i][0]); expect(map.nodes[i + 6][0]).toBeLessThan(map.nodes[i + 5][0]); }
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
      expect(Math.hypot((map.nodes[i][0] - map.nodes[j][0]) * 427, (map.nodes[i][1] - map.nodes[j][1]) * 171)).toBeGreaterThanOrEqual(60);
    }
  }
  expect(stageMapFor(99).nodes).toBe(DEFAULT_STAGE_NODES);
});

test('지도 상자 2.5:1 고정과 노드 크기(최소 40px), 꼬리표가 아랫줄과 겹치지 않음', async () => {
  const { fitStageMapBox, layoutStageMap, DEFAULT_STAGE_NODES } = await import('../src/data/stage-select-maps.js');
  expect(fitStageMapBox(500, 400)).toEqual([500, 200]);
  expect(fitStageMapBox(500, 150)).toEqual([375, 150]);
  for (const [w, h] of [[427, 171], [354, 141.6], [676, 270.4]]) {
    const layout = layoutStageMap(DEFAULT_STAGE_NODES, w, h);
    expect(layout.node).toBeGreaterThanOrEqual(40); expect(layout.node).toBeLessThanOrEqual(56);
    const [top, bottom] = [layout.points[0][1], layout.points[9][1]];
    // 윗줄 노드 아래(반지름 + 꼬리표 약 16px)가 아랫줄 노드 위쪽(보스 반지름)보다 위
    expect(top + layout.node / 2 + 16).toBeLessThanOrEqual(bottom - layout.boss / 2 + 1);
    expect(layout.points[4][0]).toBeCloseTo(w * 0.88, 5);
  }
});

test('캠페인 완주(6-10 클리어) 뒤 추천을 따랐던 캠페인 기억은 던전 추천으로 연다', () => {
  const { eco, expedition } = fresh();
  eco.s.progress.unlocked = 60; eco.s.progress.stars = { '6-10': 1 };
  const model: any = stageSelectModel(inputs(eco, expedition, { memory: { introSeen: true, last: { tab: 'campaign', ch: 6, st: 10, followed: true } }, dungeonRecommended: { id: 'glass_garden', depth: 'standard' } }));
  expect(model.selection).toEqual({ tab: 'dungeon', id: 'glass_garden', depth: 'standard' });
  // 추천이 아닌 곳을 골랐던 기억(반복 사냥)은 완주 뒤에도 그 자리 그대로.
  const exact: any = stageSelectModel(inputs(eco, expedition, { memory: { last: { tab: 'campaign', ch: 6, st: 10, followed: false } } }));
  expect(exact.selection).toEqual({ tab: 'campaign', ch: 6, st: 10 });
});

test('저장 실패·차단: 두 번째 열기에도 세션 기억(introSeen·last)을 유지한다', () => {
  const failing = { getItem: () => null, setItem() { throw new Error('quota'); } };
  let memory: any = refreshStageSelectMemory(undefined, undefined, failing);
  expect(memory).toEqual({ introSeen: false, last: null });
  memory = { ...memory, introSeen: true };
  let ok = writeStageSelectMemory(memory, failing);
  expect(ok).toBe(false);
  memory = { ...refreshStageSelectMemory(memory, ok, failing), last: { tab: 'campaign', ch: 1, st: 1, followed: true } };
  ok = writeStageSelectMemory(memory, failing);
  const second = refreshStageSelectMemory(memory, ok, failing);
  expect(second).toEqual({ introSeen: true, last: { tab: 'campaign', ch: 1, st: 1, followed: true } });
  // 읽기 자체가 막힌 경우에도 세션 사본을 쓴다.
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  expect(refreshStageSelectMemory(second, undefined, blocked)).toEqual(second);
  // 정상 저장이면 저장된 값을 읽는다.
  const store = memoryStore();
  writeStageSelectMemory({ introSeen: true, last: null }, store);
  expect(refreshStageSelectMemory({ introSeen: false, last: null }, true, store).introSeen).toBe(true);
});

test('landingPrefer: 카드 던전의 실제 단계를 넘기고 선택이 없으면 null', () => {
  expect(landingPrefer({ dungeon: { id: 'glass_garden' }, depth: 'deep' }, 'glass_garden')).toEqual({ tab: 'dungeon', id: 'glass_garden', depth: 'deep' });
  expect(landingPrefer({ dungeon: { id: 'glass_garden' }, depth: 'standard' }, 'glass_garden')).toEqual({ tab: 'dungeon', id: 'glass_garden', depth: 'standard' });
  expect(landingPrefer({ dungeon: { id: 'other' }, depth: 'deep' }, 'glass_garden')?.depth).toBe('standard');
  expect(landingPrefer(null, 'glass_garden')?.depth).toBe('standard');
  expect(landingPrefer({ dungeon: { id: 'a' }, depth: 'deep' }, null)).toBeNull();
});

test('selectionSelector: 관문·던전 단계 버튼을 다시 찾는 선택자', () => {
  expect(selectionSelector({ tab: 'campaign', ch: 2, st: 5 })).toBe('[data-ch="2"][data-st="5"]');
  expect(selectionSelector({ tab: 'dungeon', id: 'glass_garden', depth: 'deep' })).toBe('[data-dungeon-id="glass_garden"][data-depth="deep"]');
  expect(selectionSelector({ tab: 'dungeon', id: 'x', depth: 'weird' })).toBe('[data-dungeon-id="x"][data-depth="standard"]');
  expect(selectionSelector(null)).toBeNull();
});
