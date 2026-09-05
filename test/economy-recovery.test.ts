import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { ITEM_POOL } from '../src/data/items.js';

const key = 'bladesurge_save_v1';
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

describe('진행 저장 복구', () => {
  test('실패 환급은 primary·backup·복구 원본 값 모두 차감 전 상태를 보존한다', () => {
    const eco = new Economy(); eco.s.energy = 350; eco.s.energyT = 123456; eco.save();
    const snapshot = { energy: eco.s.energy, energyT: eco.s.energyT };
    eco.spendEnergy(6); expect(eco.s.energy).toBe(344);
    expect(eco.rollbackEnergy(snapshot)).toBe(true);
    for (const saved of [values.get(key)!, values.get(key + '_backup')!, eco._lastGoodSave]) {
      expect(JSON.parse(saved).energy).toBe(350); expect(JSON.parse(saved).energyT).toBe(123456);
    }
    values.set(key, '{broken'); const recovered = new Economy();
    expect(recovered.s.energy).toBe(350); expect(recovered.storageStatus).toBe('recovered');
    // 생성자의 정상 시간 진행 이전에 읽은 복구 데이터의 시각도 보존된다.
    expect(recovered.load().energyT).toBe(123456);
  });
  test('환급 백업 기록 실패는 성공이 아니며 기존 차감 백업을 제거한다', () => {
    const eco = new Economy(); eco.s.energy = 350; eco.s.energyT = 123456; eco.save(); eco.spendEnergy(6);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (k: string) => values.get(k) ?? null, removeItem: (k: string) => values.delete(k),
      setItem: (k: string, value: string) => { if (k.endsWith('_backup')) throw new Error('quota'); values.set(k, value); },
    } });
    expect(eco.rollbackEnergy({ energy: 350, energyT: 123456 })).toBe(false);
    expect(values.has(key + '_backup')).toBe(false); expect(eco.storageStatus).toBe('unavailable');
  });
  test('손상된 장비 순번과 안전 정수 끝의 UID를 복구한 뒤 새 드랍도 유지한다', () => {
    const source = new Economy(); const item = source.addItem('N', 'weapon'); source.equip('knight', item.uid);
    for (const nearLimit of [false, true]) {
      const raw = structuredClone(source.s); raw.invSeq = Number.MAX_SAFE_INTEGER;
      if (nearLimit) { raw.inventory[0].uid = Number.MAX_SAFE_INTEGER - 1; raw.heroes.knight.equip.weapon = Number.MAX_SAFE_INTEGER - 1; }
      values.set(key, JSON.stringify(raw));
      const recovered = new Economy();
      expect(recovered.hero().equip.weapon).toBe(recovered.s.inventory[0].uid);
      expect(recovered.s.invSeq).toBe(2);
      const drop = recovered.addItem('N', 'weapon'); recovered.save();
      const reload = new Economy();
      expect(reload.s.inventory.some((entry: { uid: number }) => entry.uid === drop.uid)).toBe(true);
      expect(reload.s.inventory.length).toBe(2);
    }
  });
  test('전체 초기화는 복구 원본까지 지우고 실패를 숨기지 않는다', () => {
    const eco = new Economy(); values.set(key + '_recovery', 'old-private-save');
    expect(eco.reset()).toBe(true); expect(values.has(key + '_recovery')).toBe(false);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { removeItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
    expect(eco.reset()).toBe(false);
  });
  test('부분 구형 저장은 유효 진행을 보존하며 빠진 중첩 구조만 채운다', () => {
    values.set(key, JSON.stringify({ gold: 23456, heroes: { knight: { level: 17, skills: [3, 2, 2, 1] } }, progress: { unlocked: 4 }, settings: { music: false } }));
    const eco = new Economy();
    expect(eco.s.gold).toBe(23456); expect(eco.hero().level).toBe(17);
    expect(eco.hero().skills).toEqual([3, 2, 2, 1, 1, 1]);
    expect(eco.s.progress.stars).toEqual({}); expect(eco.s.settings.sfx).toBe(true);
    expect(eco.heroPower('knight')).toBeGreaterThan(0);
  });
  test('손상된 선택 영웅·장비·배열·숫자 때문에 부트가 막히지 않는다', () => {
    values.set(key, JSON.stringify({ selected: 'missing', heroes: null, inventory: [null, { uid: 1, id: 'bad' }], pass: null, quests: { claimed: null }, energy: 'NaN', gold: -3 }));
    const eco = new Economy();
    expect(eco.s.selected).toBe('knight'); expect(eco.s.inventory).toEqual([]);
    expect(eco.s.gold).toBe(0); expect(Number.isFinite(eco.s.energy)).toBe(true);
    expect(() => eco.quests()).not.toThrow(); expect(() => eco.heroPower('knight')).not.toThrow();
  });
  test('유효 영웅·장비·장착·첫구매·진행은 저장 후 동일하게 복구한다', () => {
    const eco = new Economy(); const inst = eco.addItem('N', 'weapon'); eco.equip('knight', inst.uid);
    eco.s.firstPurchaseUsed.gem1 = true; eco.s.progress.stars['1-1'] = 3; eco.s.gold = 45678; eco.save();
    const reload = new Economy();
    expect(reload.s.gold).toBe(45678); expect(reload.hero().equip.weapon).toBe(inst.uid);
    expect(reload.s.inventory).toEqual(eco.s.inventory);
    expect(reload.s.firstPurchaseUsed.gem1).toBe(true); expect(reload.s.progress.stars['1-1']).toBe(3);
  });
  test('깨진 JSON은 마지막 정상 백업을 복구하며 원본을 남긴다', () => {
    const eco = new Economy(); eco.s.gold = 33333; eco.save(); eco.s.gold = 44444; eco.save();
    values.set(key, '{broken');
    const reload = new Economy();
    expect(reload.s.gold).toBe(33333); expect(reload.storageStatus).toBe('recovered');
    expect(values.get(key + '_recovery')).toBe('{broken');
  });
  test('저장 실패를 성공으로 보고하지 않는다', () => {
    const eco = new Economy();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() { throw new Error('quota'); } } });
    expect(eco.save()).toBe(false); expect(eco.storageStatus).toBe('unavailable');
  });
  test('초기화 후 손상 복구가 초기화 이전 진행을 되살리지 않는다', () => {
    const eco = new Economy(); eco.s.gold = 999999; eco.save(); eco.reset();
    values.set(key, '{broken');
    const reload = new Economy();
    expect(reload.s.gold).toBe(12000);
  });
  test('대량 장비도 spread 호출 한도에 걸리지 않으며 중복 uid를 제외한다', () => {
    const eco = new Economy();
    const raw = { ...eco.fresh(), inventory: Array.from({ length: 120000 }, (_, i) => ({ uid: i + 1, id: ITEM_POOL.weapon[0].id, enh: 0 })) };
    raw.inventory.push(raw.inventory[0]);
    const s = normalizeSave(raw, eco.fresh());
    expect(s.inventory.length).toBe(120000); expect(s.invSeq).toBe(120001);
  });
});

describe('전투 보상 영수증', () => {
  test('골드와 모든 강화 재료만 실제 수령량 그대로 한 번 더 지급한다', () => {
    const eco = new Economy(); eco.s.vipUntil = Date.now() + 100000;
    const receipt = eco.completeStage(eco.nextStage(), 3, { fieldGold: 37, fieldStones: 5, fieldStones2: 3, fieldStones3: 2, fieldFragments: 4 });
    const before = structuredClone(eco.s);
    const rewards = eco.doubleStageRewards(receipt)!;
    for (const reward of rewards) expect(eco.s[reward.k as keyof typeof eco.s]).toBe(before[reward.k as keyof typeof before] + reward.n);
    expect(rewards).toEqual(receipt.got.filter((g: { k: string }) => ['gold', 'stones', 'stones2', 'stones3', 'fragments'].includes(g.k)));
    expect(eco.s.gems).toBe(before.gems); expect(eco.hero().exp).toBe(before.heroes.knight.exp);
    const after = JSON.stringify(eco.s);
    expect(eco.doubleStageRewards(receipt)).toBeNull(); expect(JSON.stringify(eco.s)).toBe(after);
  });
  test('다른 세션 영수증/위조 영수증/잘못된 소환 수량은 지급·차감하지 않는다', () => {
    const eco = new Economy(), other = new Economy();
    const receipt = other.completeStage(other.nextStage(), 3);
    const before = JSON.stringify(eco.s);
    expect(eco.doubleStageRewards(receipt)).toBeNull();
    expect(eco.doubleStageRewards({ got: [{ k: 'gold', n: 999999 }] })).toBeNull();
    expect(eco.pull(100000)).toBeNull(); expect(eco.pull(-1)).toBeNull();
    expect(eco.claimPass(0, false)).toBeNull(); expect(eco.claimPass(1.5, false)).toBeNull();
    expect(JSON.stringify(eco.s)).toBe(before);
  });
});
