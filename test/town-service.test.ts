import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { TownService } from '../src/game/town-service.js';
import { TOWNS, TOWN_SHOP } from '../src/data/towns.js';
import { ITEM_BY_ID, ITEM_POOL } from '../src/data/items.js';

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

test('마을은 6개 던전과 필드를 노출하고 성채만 기본 해금한다', () => {
  const { service } = make();
  expect(TOWNS).toHaveLength(3);
  expect(service.towns().map(town => town.dungeonIds)).toEqual([
    ['glass_garden', 'eclipse_hydra_vault', 'ember_vault', 'bellfall_crypt', 'rootbound_grotto', 'hollowbell_arboretum'],
    ['cinder_tide_lock', 'ashforge_catacomb', 'star_archive', 'nightglass_observatory', 'slagwater_foundry', 'emberwake_drydock'],
    ['astral_leviathan_spire', 'verdigris_sanctum', 'sable_mirage_basin', 'comet_bastion', 'aurora_icewell', 'crownfall_glacier'],
  ]);
  expect(service.towns().map(town => town.fieldId)).toEqual(['windmeadow', 'dawnward_city', 'skywind_pass']);
  expect(service.towns().map(town => town.unlocked)).toEqual([true, false, false]);
  const gear = TOWN_SHOP.flatMap(item => 'itemId' in item ? [{ ...item, def: (ITEM_BY_ID as any)[item.itemId] }] : []).filter(item => ['weapon', 'armor'].includes(item.def.slot));
  expect(gear.map(item => item.def.appearanceTier)).toEqual(gear.map(item => TOWNS.find(town => town.id === item.townId)?.tier));
  // 마을 전용 장비는 드랍·가챠 풀에 섞이지 않고, 기존 아이템 정의에는 appearanceTier가 없다.
  expect(Object.values(ITEM_POOL).flat().some((item: any) => 'appearanceTier' in item)).toBe(false);
});

test('기존 던전 승리와 영웅 레벨을 마이그레이션해 즉시 마을을 해금한다', () => {
  const { eco } = make();
  const raw = structuredClone(eco.s);
  raw.towns = undefined;
  raw.heroes.knight.level = 15;
  for (const id of TOWNS[0].dungeonIds.slice(0, 4)) raw.expedition.stats[id] = 1;
  const migrated = eco.migrate(raw);
  expect(migrated.towns.unlockedTownIds).toEqual(['oathhold', 'emberport']);
  expect(migrated.gold).toBe(raw.gold);
  expect(migrated.heroes.knight.level).toBe(15);
});

test('이동·장비 구매·소모품 구매는 저장되고 잠금·재구매·재료 부족을 거부한다', () => {
  const { eco, service } = make();
  expect(service.travel('emberport')).toEqual({ ok: false, reason: 'locked' });
  for (const id of TOWNS[0].dungeonIds.slice(0, 4)) eco.s.expedition.stats[id] = 1;
  eco.hero().level = 5;
  expect(service.travel('emberport')).toEqual({ ok: true });
  const item = service.buy('emberport', 'emberport_mail');
  expect(item.ok).toBe(true);
  const mail: any = eco.s.inventory.find((entry: any) => entry.id === 'a_town_ember');
  expect(mail).toBeTruthy();
  expect(service.shop('emberport').find(offer => offer.id === 'emberport_mail')?.appearanceTier).toBe(2);
  expect(service.buy('emberport', 'emberport_mail')).toEqual({ ok: false, reason: 'sold-out' });
  // 구매한 마을 장비는 기존 장착·저장 정규화를 그대로 통과한다.
  eco.equip('knight', mail.uid);
  expect(eco.migrate(structuredClone(eco.s)).heroes.knight.equip.armor).toBe(mail.uid);
  expect(service.buy('emberport', 'emberport_overdrive').ok).toBe(true);
  const saved = JSON.stringify(eco.s);
  expect(service.buy('emberport', 'emberport_ruby')).toMatchObject({ ok: true });
  expect(saved).not.toBe(JSON.stringify(eco.s));
  eco.s.gold = 0;
  expect(service.buy('emberport', 'emberport_blade')).toEqual({ ok: false, reason: 'gold' });
  eco.s.gold = 100_000; eco.s.expedition.materials.ember_core = 0;
  expect(service.buy('emberport', 'emberport_blade')).toEqual({ ok: false, reason: 'materials' });
  expect(service.buy('starcrest', 'starcrest_mail')).toEqual({ ok: false, reason: 'locked' });
});

test('교관은 영웅 레벨·골드·재료·중복 습득 실패를 반환하고 학습을 저장한다', () => {
  const { eco, service } = make();
  expect(service.learn('oathhold', 'oathhold_knight_aftershock', 'knight')).toEqual({ ok: false, reason: 'level' });
  eco.hero('knight').level = 3;
  const learned = service.learn('oathhold', 'oathhold_knight_aftershock', 'knight');
  expect(learned).toMatchObject({ ok: true, offerId: 'oathhold_knight_aftershock', heroId: 'knight' });
  expect(service.learn('oathhold', 'oathhold_knight_aftershock', 'knight')).toEqual({ ok: false, reason: 'learned' });
  expect(service.trainer('oathhold', 'knight').find(item => item.id === 'oathhold_knight_aftershock')?.learned).toBe(true);
});

test('잠긴 마을의 해금 진행도는 이전 마을 클리어 수와 남은 레벨 조건을 보여 준다', () => {
  const { eco, service } = make();
  for (const id of TOWNS[0].dungeonIds.slice(0, 3)) eco.s.expedition.stats[id] = 1;
  eco.hero().level = 3;
  const [, ember, star] = service.towns();
  // 막대는 이전 마을(서약의 성채) 던전 3곳을 센다. 잠긴 마을 자신의 던전 수(0)가 아니다.
  expect(ember.progress).toEqual({ cleared: 3, required: 4, level: { current: 3, required: 5 } });
  expect(ember.requirement.text).toBe('이전 마을 던전 1곳 더 클리어 · 영웅 레벨 5 필요 (현재 3)');
  expect(star.progress.cleared).toBe(0);
  eco.s.expedition.stats[TOWNS[0].dungeonIds[3]] = 1;
  // 던전 조건을 채워도 레벨이 모자라면 레벨 조건만 남는다.
  expect(service.towns()[1]).toMatchObject({ unlocked: false, requirement: { text: '영웅 레벨 5 필요 (현재 3)' } });
  eco.hero().level = 5;
  expect(service.towns()[1].unlocked).toBe(true);
});

