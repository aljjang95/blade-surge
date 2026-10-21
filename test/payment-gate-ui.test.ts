import { expect, test } from 'bun:test';
import { Meta } from '../src/ui/meta.js';
import { Economy } from '../src/game/economy.js';
import { SKUS } from '../src/data/shop.js';

function metaWith(pay: boolean) {
  const eco: any = new Economy();
  if (pay) eco.paymentAvailable = () => true;
  const modals: string[] = [], toasts: string[] = [];
  const ui: any = { modal: (html: string, options?: any) => { modals.push(html); options?.onOpen?.({ querySelector: () => ({}) }); }, toast: (m: string) => toasts.push(m), closeModal() {}, paySheet: async () => true };
  const meta: any = Object.assign(Object.create(Meta.prototype), { eco, ui, shopTab: 'hot', trackFunnel() {} });
  return { eco, meta, modals, toasts };
}

test('결제가 연결되지 않으면 현금(₩) 상품이 어느 상점 탭에도 나오지 않는다', () => {
  const { eco, meta } = metaWith(false);
  expect(eco.paymentAvailable()).toBe(false);
  expect(meta.payOn()).toBe(false);
  const ids = meta.shopTabs().map((t: any) => t.id);
  expect(ids).not.toContain('gem'); expect(ids).not.toContain('pack');
  expect(ids).toEqual(expect.arrayContaining(['hot', 'enh', 'gold', 'energy']));
  for (const tab of ['hot', 'gem', 'pack', 'enh', 'gold', 'energy']) {
    for (const sku of meta.shopSkus(tab)) {
      expect(sku.kind).toBe('gem');
      expect(sku.priceLabel).toBeUndefined();
      expect(JSON.stringify(sku)).not.toContain('₩');
    }
  }
  expect(meta.shopSkus('hot').length).toBeGreaterThan(0);
  // 보석·골드·에너지로 실제 살 수 있는 인게임 재화 상품은 그대로 남는다.
  const free = SKUS.filter((x: any) => x.kind === 'gem').map((x: any) => x.id).sort();
  const shown = new Set(['hot', 'enh', 'gold', 'energy'].flatMap((t) => meta.shopSkus(t).map((x: any) => x.id)));
  expect(free.every((id: string) => shown.has(id))).toBe(true);
});

test('결제가 연결되면(paymentAvailable=true) 현금 상품과 보석·패키지 탭이 다시 나온다', () => {
  const { meta } = metaWith(true);
  expect(meta.payOn()).toBe(true);
  const ids = meta.shopTabs().map((t: any) => t.id);
  expect(ids).toEqual(expect.arrayContaining(['hot', 'gem', 'pack', 'enh', 'gold', 'energy']));
  expect(meta.shopSkus('gem').length).toBe(SKUS.filter((x: any) => x.tab === 'gem').length);
  expect(meta.shopSkus('pack').some((x: any) => x.id === 'vip_pass')).toBe(true);
});

test('프로필 창은 결제가 없으면 목업·누적 결제·VIP 멤버십 입구를 내지 않는다', () => {
  const { meta, modals } = metaWith(false);
  meta.showProfile();
  const html = modals[0];
  for (const text of ['목업', '누적 결제', '다음 VIP', 'VIP 멤버십', '₩', 'm-vip']) expect(html).not.toContain(text);
  expect(html).toContain('총 소환');
});

test('프로필 창은 결제가 연결돼도 목업 문구 없이 VIP 정보만 보인다', () => {
  const { meta, modals } = metaWith(true);
  meta.showProfile();
  expect(modals[0]).not.toContain('목업');
  expect(modals[0]).toContain('누적 결제'); expect(modals[0]).toContain('m-vip');
});

test('구매 시트 뒤 구매가 실패하면 조용히 넘기지 않고 이유별 토스트를 띄운다', async () => {
  const { eco, meta, toasts } = metaWith(true);
  eco.purchase = () => ({ ok: false, reason: 'payment-unavailable' });
  eco.buyPass = () => ({ ok: false, reason: 'payment-unavailable' });
  await meta.buy('starter');
  await meta.buyPass();
  expect(toasts.length).toBe(2);
  expect(toasts.every((t) => t.includes('결제가 아직 연결되지 않아'))).toBe(true);
  expect(meta.purchaseFailText({ ok: false, reason: 'storage' })).toContain('저장하지 못해');
  expect(meta.purchaseFailText({ ok: false, reason: 'once' })).toContain('이미 구매');
  expect(meta.purchaseFailText(undefined)).toBe('구매하지 못했습니다');
});
