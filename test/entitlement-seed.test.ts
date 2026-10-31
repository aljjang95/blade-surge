import { expect, test } from 'bun:test';
import { Economy, SAVE_STORAGE_KEY } from '../src/game/economy.js';
import { SAVE_STORAGE_KEY as RESET_KEY } from '../src/game/account-reset.js';
import { createMemoryStorage } from '../src/game/economy-core.js';

test('저장 키 상수가 account-reset과 같다', () => expect(RESET_KEY).toBe(SAVE_STORAGE_KEY));

test('entitlementSeed: 결제 권한만 옮기고 진행·재화·유료 보석은 새 시작값이다', () => {
  const eco: any = new Economy({ storage: createMemoryStorage() });
  Object.assign(eco.s, { gold: 9e9, gems: 777, paidGems: 500, adsRemoved: true, iapApplied: ['op-1'], purchases: ['pass'], spentKRW: 4900, vip: 2, monthlyUntil: 123 });
  eco.s.progress.unlocked = 40; eco.s.pass.premium = true; eco.s.pass.xp = 99; eco.s.roster.paid = ['mage'];
  eco.s.avatars.owned = ['free_a', 'paid_a']; eco.s.avatars.paid = { paid_a: 'op-9' };
  const seed = JSON.parse(eco.entitlementSeed());
  expect(seed.adsRemoved).toBe(true); expect(seed.iapApplied).toEqual(['op-1']); expect(seed.purchases).toEqual(['pass']); expect(seed.spentKRW).toBe(4900); expect(seed.vip).toBe(2); expect(seed.monthlyUntil).toBe(123);
  expect(seed.pass.premium).toBe(true); expect(seed.pass.xp).toBe(0); expect(seed.roster.paid).toEqual(['mage']);
  expect(seed.avatars.paid).toEqual({ paid_a: 'op-9' }); expect(seed.avatars.owned).toContain('paid_a'); expect(seed.avatars.owned).not.toContain('free_a');
  expect(seed.gold).toBe(12000); expect(seed.gems).toBe(1500); expect(seed.paidGems).toBe(0); expect(seed.progress.unlocked).toBe(1); expect(seed.roster.starterChosen).toBe(false);
  // 다시 읽어도 시작 영웅 선택부터이고 권한이 남는다.
  const storage: any = createMemoryStorage(); storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(seed));
  const loaded: any = new Economy({ storage });
  expect(loaded.s.adsRemoved).toBe(true); expect(loaded.s.roster.starterChosen).toBe(false);
});
