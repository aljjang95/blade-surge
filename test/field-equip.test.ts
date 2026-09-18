import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Economy } from '../src/game/economy.js';
import { Battle } from '../src/game/battle-base.js';
import { decideFieldEquip, applyFieldEquip, setTierText, normalizeAutoEquip, AUTO_EQUIP_MODES } from '../src/game/field-equip.js';
import { normalizeSave } from '../src/game/save-base.js';
import { HEROES as HERO_DEFS, heroStats } from '../src/data/heroes.js';
import { ITEM_BY_ID as ITEM_TABLE, SETS } from '../src/data/items.js';
import { stageDef } from '../src/data/stages.js';

const HEROES = HERO_DEFS as Record<string, any>;
const ITEM_BY_ID = ITEM_TABLE as Record<string, any>;

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

/** 실제 Battle.prototype 의 장착 훅을 최소 상태로 돌린다 — 렌더·오디오·FX 는 밖에 둔다 */
function fakeBattle(eco: any, heroId = 'knight') {
  const hero = eco.hero(heroId), def = HEROES[heroId];
  const stats = heroStats(def, hero, eco.heroEquipBonus(heroId));
  const toasts: string[] = [], looks: any[] = [], bursts: any[] = [];
  const player: any = { def, stats, maxHp: stats.hp, hp: stats.hp, alive: true, pos: new THREE.Vector3(), refreshLook(equip: any) { looks.push({ ...equip }); return {}; } };
  const b: any = Object.create(Battle.prototype);
  Object.assign(b, { app: { eco }, player, heroId, stage: stageDef(1, 1), active: true, setBonus: [], procs: new Set(), timers: [],
    sp: { summons: [], configureSummons(defs: any[]) { b.sp.summons = defs; } },
    fx: { groundTex() {}, holyBurst(_p: any, o: any) { bursts.push(o); } }, ui: { toast(msg: string) { toasts.push(msg); } } });
  const runTimers = () => { for (const t of b.timers.splice(0)) t.fn(); };
  return { b, player, toasts, looks, bursts, runTimers };
}

test('빈 슬롯의 드랍은 집는 순간 장착되고, 같은 등급 두 번째 드랍에서 세트가 켜진다', () => {
  const eco = new Economy();
  const { b, player, toasts, looks, bursts, runTimers } = fakeBattle(eco);
  const baseAtk = player.stats.atk, baseHp = player.maxHp;
  expect(eco.setCount()).toBe(0);

  const weapon = eco.fieldDrop('N');
  // 실제 드랍 순서와 무관하게 무기·방어구 순서를 고정한다
  weapon.id = ITEM_BY_ID.w_iron.id;
  const first = b.onLootPickup(weapon);
  expect(first.equipped).toBe(true); expect(first.reason).toBe('empty'); expect(first.slot).toBe('weapon');
  expect(eco.hero('knight').equip.weapon).toBe(weapon.uid);
  expect(player.stats.atk).toBe(baseAtk + ITEM_BY_ID.w_iron.atk);
  expect(player.maxHp).toBe(baseHp);
  expect(first.progress).toEqual(expect.objectContaining({ n: 1, tier: 0 })); expect(first.progress.set.id).toBe('recruit');
  expect(first.activated).toEqual([]);
  expect(looks).toHaveLength(1); expect(looks[0].weapon?.uid).toBe(weapon.uid);
  expect(eco.setCount()).toBe(0);

  // 잃은 체력은 보존되고, 늘어난 최대 체력만 더해진다
  player.hp = player.maxHp - 300;
  const armor = eco.fieldDrop('N'); armor.id = ITEM_BY_ID.a_leather.id;
  const second = b.onLootPickup(armor);
  expect(second.equipped).toBe(true);
  expect(second.activated).toHaveLength(1);
  expect(second.activated[0].set.id).toBe('recruit'); expect(second.activated[0].tier).toBe(2); expect(second.activated[0].text).toBe('공격력 +5%');
  expect(second.progress).toEqual(expect.objectContaining({ n: 2, tier: 2 }));
  expect(eco.setCount()).toBe(1);
  expect(player.maxHp).toBeGreaterThan(baseHp);
  expect(player.hp).toBe(player.maxHp - 300);
  expect(b.setBonus.map((a: any) => a.set.id)).toEqual(['recruit']);
  // 발동 연출은 게임 시간 타이머로 예약되고, 전투가 끝났으면 뜨지 않는다
  expect(toasts).toHaveLength(0);
  runTimers();
  expect(toasts).toHaveLength(1); expect(toasts[0]).toContain('신병 세트 2세트 발동'); expect(toasts[0]).toContain('공격력 +5%');
  expect(bursts).toHaveLength(1);
  // 저장에도 반영된다 — 새 세이브를 읽어도 장착이 남는다
  expect(new Economy().hero('knight').equip).toEqual(expect.objectContaining({ weapon: weapon.uid, armor: armor.uid }));
});

test('이미 고른 부위는 기본 설정에서 바꾸지 않고, 더 강하면 교체 모드에서만 전투력이 오를 때 바꾼다', () => {
  const eco = new Economy();
  const { b, player } = fakeBattle(eco);
  const iron = eco.fieldDrop('N'); iron.id = 'w_iron';
  expect(b.onLootPickup(iron).equipped).toBe(true);
  const atkWithIron = player.stats.atk;

  const better = eco.fieldDrop('S'); better.id = ITEM_BY_ID.w_iron.id;
  // 같은 무기라도 이미 고른 부위는 건드리지 않는다
  const occupied = b.onLootPickup(better);
  expect(occupied.equipped).toBe(false); expect(occupied.reason).toBe('occupied');
  expect(eco.hero('knight').equip.weapon).toBe(iron.uid);

  eco.s.settings.autoEquip = 'better';
  const sWeapon = eco.addItem('S', 'weapon');
  const swapped = b.onLootPickup(sWeapon);
  expect(swapped.equipped).toBe(true); expect(swapped.reason).toBe('better'); expect(swapped.replaced?.uid).toBe(iron.uid);
  expect(eco.hero('knight').equip.weapon).toBe(sWeapon.uid);
  expect(player.stats.atk).toBeGreaterThan(atkWithIron);
  // 세트가 풀려 전투력이 내려가는 교체는 하지 않는다: N 무기로 되돌아가지 않는다
  const weaker = eco.addItem('N', 'weapon');
  const kept = b.onLootPickup(weaker);
  expect(kept.equipped).toBe(false); expect(kept.reason).toBe('weaker');
  expect(eco.hero('knight').equip.weapon).toBe(sWeapon.uid);
  // 가방에는 전부 남아 있다 — 자동 장착은 드랍을 없애지 않는다
  for (const inst of [iron, better, sWeapon, weaker]) expect(eco.s.inventory.some((x: any) => x.uid === inst.uid)).toBe(true);
});

test('끄기 설정, 다른 영웅의 장비, 파티 전투, 쓰러진 영웅에서는 장착하지 않는다', () => {
  const eco = new Economy();
  const { b, player } = fakeBattle(eco);
  const ring = eco.addItem('N', 'ring');
  eco.s.settings.autoEquip = 'off';
  expect(b.onLootPickup(ring)).toEqual(expect.objectContaining({ equipped: false, reason: 'off' }));
  expect(eco.hero('knight').equip.ring).toBeNull();

  eco.s.settings.autoEquip = 'empty';
  eco.equip('barbarian', ring.uid);
  expect(decideFieldEquip(eco, 'knight', ring.uid)).toEqual(expect.objectContaining({ equip: false, reason: 'owned' }));
  expect(eco.hero('barbarian').equip.ring).toBe(ring.uid);

  const boots = eco.addItem('N', 'boots');
  b.stage = { ...b.stage, party: { id: 'party' } };
  expect(b.onLootPickup(boots)).toBeNull();
  expect(applyFieldEquip(b, boots)).toBeNull();
  b.stage = stageDef(1, 1);
  player.alive = false;
  expect(b.onLootPickup(boots)).toBeNull();
  player.alive = true; b.active = false;
  expect(b.onLootPickup(boots)).toBeNull();
  expect(eco.hero('knight').equip.boots).toBeNull();
  expect(decideFieldEquip(eco, 'knight', 999999)).toEqual({ equip: false, reason: 'invalid' });
});

test('자동 장착 설정은 세이브 정규화로 보정되고 기본값은 빈 슬롯만이다', () => {
  const eco = new Economy();
  expect(eco.s.settings.autoEquip).toBe('empty');
  const fresh = eco.fresh();
  expect(normalizeSave({ settings: { autoEquip: 'weird' } }, fresh).settings.autoEquip).toBe('empty');
  expect(normalizeSave({ settings: { autoEquip: 'better' } }, fresh).settings.autoEquip).toBe('better');
  expect(normalizeSave({ settings: { autoEquip: 'off' } }, fresh).settings.autoEquip).toBe('off');
  expect(normalizeSave({}, fresh).settings.autoEquip).toBe('empty');
  for (const mode of AUTO_EQUIP_MODES) expect(normalizeAutoEquip(mode)).toBe(mode);
  expect(normalizeAutoEquip(undefined)).toBe('empty'); expect(normalizeAutoEquip(true as any)).toBe('empty');
});

test('세트 단계 문구 — 스탯 세트는 수치, 테마 세트는 발동 설명', () => {
  expect(setTierText(SETS.recruit, 2)).toBe('공격력 +5%');
  expect(setTierText(SETS.recruit, 4)).toBe('공격력 +10% · HP +10%');
  expect(setTierText(SETS.dragon, 4)).toContain('궁극기 수급 +30%');
  expect(setTierText(SETS.frost, 2)).toBe(SETS.frost.two.text);
});
