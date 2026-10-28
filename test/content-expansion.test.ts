import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ALL_DUNGEONS, NEW_DUNGEONS, DUNGEON_BOSS_PATTERNS } from '../src/data/expansion.js';
import { TOWNS, TOWN_STORY, freshTownState, normalizeTownState } from '../src/data/towns.js';
import { FIELD_CONTENT, fieldForTown } from '../src/data/open-fields.js';
import { TownService } from '../src/game/town-service.js';
import { townBossPattern, townDungeonCombat } from '../src/game/town-combat.js';
import { townHazardPattern } from '../src/game/region-hazards.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { buildExpeditionStage, buildExpeditionWorld, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';
import { townHub } from '../src/data/citadel-hub.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function make() {
  const eco = new Economy();
  eco.s.gold = 100_000;
  eco.s.expedition.materials = { glass_leaf: 100, ember_core: 100, star_dust: 100 };
  return { eco, service: new TownService(eco) };
}

test('콘텐츠 확장은 18개 던전을 세 마을에 6개씩 고유 기믹·조합·보스로 연결한다', () => {
  // 컨셉 던전 2곳(world 레인)은 마을 관문이 아니라 던전 목록으로만 노출되어 마을 18곳 계약과 별개다.
  expect(ALL_DUNGEONS).toHaveLength(20);
  expect(ALL_DUNGEONS.filter((d: any) => !d.layout?.concept)).toHaveLength(18);
  expect(TOWNS.every(town => town.dungeonIds)).toBe(true);
  expect(TOWNS.every(town => town.dungeonIds.length === 6)).toBe(true);
  expect(new Set(TOWNS.flatMap(town => town.dungeonIds)).size).toBe(18);
  const added: any[] = NEW_DUNGEONS;
  expect(added).toHaveLength(6);
  for (const raw of added) {
    const dungeon: any = raw;
    expect(dungeon.mechanic?.id).toBeTruthy();
    expect(dungeon.roster?.trash.length).toBeGreaterThanOrEqual(4);
    expect(dungeon.roster?.ranged.length).toBeGreaterThanOrEqual(2);
    expect(dungeon.roster?.elite.length).toBeGreaterThanOrEqual(2);
    expect(DUNGEON_BOSS_PATTERNS[dungeon.id].length).toBeGreaterThanOrEqual(3);
    expect(townDungeonCombat(dungeon.id)?.boss.enemyId).toBe(dungeon.bossEnemy);
    expect(townBossPattern(dungeon.id)).toBe(DUNGEON_BOSS_PATTERNS[dungeon.id][0]);
  }
});

test('신규 던전은 명시 레이아웃·실제 월드·마을 6게이트로 import부터 연결된다', () => {
  for (const dungeon of NEW_DUNGEONS) {
    expect(EXPEDITION_LAYOUTS[dungeon.id]).toBeTruthy();
    const world = buildExpeditionWorld(buildExpeditionStage('dungeon', dungeon.id, null));
    expect(world.rooms.at(-1)?.type).toBe('boss');
  }
  for (const town of TOWNS) expect(townHub(town.id).hotspots.filter((spot: any) => spot.kind === 'dungeon')).toHaveLength(6);
});

test('마을 필드는 채집·정예·숨은 보물·이벤트 메타데이터와 기믹 hazard를 가진다', () => {
  expect(Object.keys(FIELD_CONTENT)).toHaveLength(4);
  for (const town of TOWNS) {
    const field = fieldForTown(town.id)!;
    expect(field.townId).toBe(town.id);
    expect(field.gathering.material).toBeTruthy();
    expect(field.gathering.nodes).toBeGreaterThan(0);
    expect(field.elites.length).toBeGreaterThan(0);
    expect(field.hiddenTreasures.length).toBeGreaterThan(0);
    expect(field.events.length).toBeGreaterThan(0);
  }
  const room: any = { x: 0, z: 0, w: 26, h: 24 };
  const hazard = townHazardPattern('rootbound_grotto', 'garden', room, { x: 0, z: 0 }, 0, false);
  expect(hazard.length).toBeGreaterThan(0);
  expect(hazard.some(entry => entry.safeRadius >= 1.2)).toBe(true);
});

test('구 저장은 기존 진행을 보존하면서 신규 의뢰·대장장이·스토리 상태를 채운다', () => {
  const legacy = { currentTownId: 'emberport', unlockedTownIds: ['oathhold', 'emberport'], purchased: ['oathhold_blade'], learned: { knight: ['oathhold_knight_aftershock'] } };
  const state: any = normalizeTownState(legacy);
  expect(state.currentTownId).toBe('emberport');
  expect(state.purchased).toEqual(['oathhold_blade']);
  expect(state.learned.knight).toEqual(['oathhold_knight_aftershock']);
  expect(state.fields.oathhold.gathered).toBe(0);
  expect(state.requests.active).toEqual([]);
  expect(state.blacksmith.enhancements).toEqual({});
  expect(state.story.starcrest.stage).toBe(0);
  expect(freshTownState().story.oathhold.stage).toBe(0);
});

test('의뢰는 잠금·수락·진행·완료·재진입을 저장하고 보상을 중복 지급하지 않는다', () => {
  const { eco, service } = make();
  const id = 'oathhold_daily_clear';
  expect(service.acceptRequest('emberport', 'emberport_daily_elite')).toEqual({ ok: false, reason: 'locked' });
  expect(service.acceptRequest('oathhold', id)).toEqual({ ok: true, requestId: id });
  expect(service.acceptRequest('oathhold', id)).toEqual({ ok: false, reason: 'accepted' });
  expect(service.recordRequestProgress('oathhold', 'field', 4)).toMatchObject({ ok: true, updated: [] });
  expect(service.claimRequest('oathhold', id)).toEqual({ ok: false, reason: 'incomplete' });
  expect(service.recordRequestProgress('oathhold', 'dungeon', 1)).toMatchObject({ ok: true, updated: [id] });
  const gold = eco.s.gold;
  expect(service.claimRequest('oathhold', id)).toMatchObject({ ok: true, requestId: id });
  expect(eco.s.gold).toBe(gold + 450);
  // 반복 의뢰는 보상 뒤 다시 수락해야 하므로 두 번 받을 수 없다(docs/TOWN_AUDIT.md).
  const repeat = 'oathhold_repeat_gather';
  service.acceptRequest('oathhold', repeat); service.recordRequestProgress('oathhold', 'field', 1);
  expect(service.claimRequest('oathhold', repeat)).toMatchObject({ ok: true });
  expect(service.claimRequest('oathhold', repeat)).toEqual({ ok: false, reason: 'not-accepted' });
  expect(service.claimRequest('oathhold', id)).toEqual({ ok: false, reason: 'completed' });
});

test('대장장이는 재료 부족·제작 성공·강화 성공을 저장하고 알림을 호출한다', () => {
  const { eco, service } = make();
  const updates: unknown[] = [];
  service.onChange((value: any) => updates.push(value));
  eco.s.expedition.materials.glass_leaf = 0;
  expect(service.craft('oathhold', 'storm_blade')).toEqual({ ok: false, reason: 'materials' });
  eco.s.expedition.materials.glass_leaf = 9;
  const crafted = service.craft('oathhold', 'storm_blade');
  expect(crafted.ok).toBe(true);
  const item: any = eco.s.inventory.at(-1)!;
  expect(item.id).toBe('w_storm');
  expect(service.blacksmith('oathhold').find((recipe: any) => recipe.id === 'storm_blade')?.crafted).toBe(true);
  eco.s.stones = 100; eco.s.gold = 100_000;
  const enhanced = service.enhance('oathhold', item.uid, {});
  expect(enhanced.ok).toBe(true);
  expect((service.ensureState() as any).blacksmith.enhancements[String(item.uid)]).toBe(1);
  expect(updates.length).toBeGreaterThanOrEqual(2);
});

test('대장장이 저장 실패는 골드·재료·인벤토리·제작 기록을 롤백한다', () => {
  const { eco, service } = make();
  const before = structuredClone(eco.s);
  eco.save = () => false;
  expect(service.craft('oathhold', 'storm_blade')).toEqual({ ok: false, reason: 'storage' });
  expect(eco.s).toEqual(before);
  expect((service.ensureState() as any).blacksmith.crafted).toEqual([]);
});

test('스토리는 세 단계만 순서대로 열리고 잠금·미완료·재진입을 거부한다', () => {
  const { service } = make();
  expect(TOWN_STORY.oathhold).toHaveLength(3);
  expect(service.advanceStory('emberport')).toEqual({ ok: false, reason: 'locked' });
  expect(service.advanceStory('oathhold')).toEqual({ ok: false, reason: 'incomplete' });
  service.progressStory('oathhold', 'dungeon', 1);
  expect(service.advanceStory('oathhold')).toMatchObject({ ok: true, stage: 1 });
  expect(service.advanceStory('oathhold')).toEqual({ ok: false, reason: 'incomplete' });
  service.progressStory('oathhold', 'field', 1);
  expect(service.advanceStory('oathhold')).toMatchObject({ ok: true, stage: 2 });
  service.progressStory('oathhold', 'dungeon', 4);
  expect(service.advanceStory('oathhold')).toMatchObject({ ok: true, stage: 3 });
  expect(service.advanceStory('oathhold')).toEqual({ ok: false, reason: 'complete' });
});

test('필드·의뢰·스토리 진행은 저장 실패 때 상태를 남기지 않는다', () => {
  const { eco, service } = make();
  eco.save = () => false;
  expect(service.acceptRequest('oathhold', 'oathhold_daily_clear')).toEqual({ ok: false, reason: 'storage' });
  expect((service.ensureState() as any).requests.active).toEqual([]);
  expect(service.recordFieldProgress('oathhold', 'gather', 1)).toEqual({ ok: false, reason: 'storage' });
  expect((service.ensureState() as any).fields.oathhold.gathered).toBe(0);
  expect(service.progressStory('oathhold', 'dungeon', 1)).toEqual({ ok: false, reason: 'storage' });
  expect((service.ensureState() as any).story.oathhold.progress).toEqual({});
});

test('신규 던전은 원정 경제 카탈로그에서 시작되고 강화 저장 실패는 원복된다', () => {
  const { eco, service } = make();
  const route = new ExpeditionEconomy(eco);
  eco.s.expedition.level = 3;
  expect(route.dungeonAccess('rootbound_grotto').ok).toBe(true);
  expect(route.begin('dungeon', 'rootbound_grotto')).toMatchObject({ ok: true });
  const crafted = service.craft('oathhold', 'storm_blade');
  expect(crafted.ok).toBe(true);
  const item: any = eco.s.inventory.at(-1);
  eco.s.stones = 100;
  eco.save = () => false;
  expect(service.enhance('oathhold', item.uid)).toEqual({ ok: false, reason: 'storage' });
  expect(eco.s.inventory.find((entry: any) => entry.uid === item.uid)?.enh).toBe(0);
  expect((service.ensureState() as any).blacksmith.enhancements).toEqual({});
});
