import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { HEROES, heroStats } from '../src/data/heroes.js';
import { SLOTS, craftable } from '../src/data/items.js';
import { grandfather } from './helpers/legacy-roster';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let writes = 0;
beforeEach(() => {
  writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => writes++, removeItem: () => writes++ } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });
const actual = (eco: Economy, id: keyof typeof HEROES = 'knight') => heroStats(HEROES[id], eco.hero(id), eco.heroEquipBonus(id));

test('세트 1→2→3→4개 및 해제 비교가 실제 적용값과 일치하고 미리보기는 저장하지 않는다', () => {
  const eco = new Economy();
  for (let i = 0; i < SLOTS.length; i++) {
    const item = { uid: eco.s.invSeq++, id: craftable('frost', SLOTS[i])!.id, enh: i * 3 };
    eco.s.inventory.push(item);
    const saved = JSON.stringify(eco.s), count = writes, preview = eco.previewItem('knight', item.uid)!;
    expect(JSON.stringify(eco.s)).toBe(saved); expect(writes).toBe(count);
    expect(preview.before).toEqual(actual(eco));
    eco.equip('knight', item.uid);
    expect(preview.after).toEqual(actual(eco));
    expect(preview.afterBonus.procs).toEqual(eco.heroEquipBonus('knight').procs);
    expect(preview.afterBonus.procs.join(',')).toBe(i === 0 ? '' : i === 3 ? 'frost_shatter,frost_pillar' : 'frost_shatter');
  }
  const uid = eco.hero().equip.boots;
  const preview = eco.previewItem('knight', uid)!;
  expect(preview.remove).toBe(true); expect(preview.afterBonus.procs.join(',')).toBe('frost_shatter');
  eco.unequip('knight', 'boots'); expect(preview.after).toEqual(actual(eco));
});

test('다른 영웅의 장비는 비교만 보여 주고 바로 옮겨 장착하지 않는다(금고를 거쳐야 한다, docs/GEAR_OWNERSHIP_VAULT.md)', () => {
  const eco = grandfather(new Economy()); eco.grantHero('barbarian'); eco.s.gold = 1e9;
  const item = eco.addItem('N', 'weapon', undefined, 0, 'barbarian'); item.enh = 12; eco.equip('barbarian', item.uid);
  const before = JSON.stringify(eco.s), preview = eco.previewItem('knight', item.uid)!;
  expect(preview.owner).toBe('barbarian'); expect(JSON.stringify(eco.s)).toBe(before);
  expect(eco.equip('knight', item.uid)).toBe(false);
  expect(eco.hero('barbarian').equip.weapon).toBe(item.uid); expect(eco.hero('knight').equip.weapon).not.toBe(item.uid);
  // 금고: 바바리안이 맡기고(해제) 기사가 꺼내면 장착된다. 결과 능력치는 미리보기와 같다.
  expect(eco.vaultDeposit(item.uid).ok).toBe(true); expect(eco.hero('barbarian').equip.weapon).toBeNull();
  expect(eco.vaultWithdraw(item.uid, 'knight').ok).toBe(true);
  eco.equip('knight', item.uid);
  expect(eco.hero('knight').equip.weapon).toBe(item.uid); expect(preview.after).toEqual(actual(eco));
});

test('강화된 저등급과 무강화 장비 교체도 최종 스탯·기본 세트 계산을 공유한다', () => {
  const eco = new Economy();
  const current = eco.addItem('N', 'weapon'); current.enh = 20; eco.equip('knight', current.uid);
  const incoming = eco.addItem('S', 'weapon');
  const preview = eco.previewItem('knight', incoming.uid)!;
  expect(preview.current?.uid).toBe(current.uid); expect(preview.after.atk).toBeLessThan(preview.before.atk);
  eco.equip('knight', incoming.uid); expect(preview.after).toEqual(actual(eco));
  expect(eco.previewItem('missing', incoming.uid)).toBeNull(); expect(eco.previewItem('knight', -1)).toBeNull();
});
