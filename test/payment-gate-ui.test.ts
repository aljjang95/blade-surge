import { expect, test } from 'bun:test';
import { Meta } from '../src/ui/meta.js';
import { Economy } from '../src/game/economy.js';
import { SKUS } from '../src/data/shop.js';

// 서버 검증 결제가 연결된 상태를 흉내 내는 가짜 서비스. 카탈로그에 있는 상품(광고 제거·스타터·월정액·패스)만 판매 중이다.
function fakeBilling(buy: (id: string) => Promise<any> = async () => ({ ok: false, reason: 'cancelled' })) {
  const items: Record<string, any> = {
    remove_ads: { id: 'remove_ads_v1', formattedPrice: '₩4,900', sellable: true },
    starter: { id: 'starter_pack_v1', formattedPrice: '₩1,200', sellable: true },
    monthly: { id: 'monthly_card_v1', formattedPrice: '₩5,900', sellable: true },
    pass: { id: 'season_pass_s1', formattedPrice: '₩9,900', sellable: true },
  };
  return { available: () => true, productForShopSku: (sku: string) => items[sku] || null, buy };
}

function metaWith(pay: boolean, billing: any = fakeBilling()) {
  const eco: any = new Economy();
  if (pay) eco.setBilling(billing);
  const modals: string[] = [], toasts: string[] = [];
  const ui: any = { modal: (html: string, options?: any) => { modals.push(html); options?.onOpen?.({ querySelector: () => ({}) }); }, toast: (m: string) => toasts.push(m), closeModal() {}, paySheet: async () => true, confirm: async () => true, purchaseDone() {} };
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

test('결제가 연결돼도 카탈로그에서 판매 중인 현금 상품만 나오고 가격은 Play 값이다', () => {
  const { eco, meta } = metaWith(true);
  expect(eco.paymentAvailable()).toBe(true);
  const hot = meta.shopSkus('hot').filter((x: any) => x.kind === 'cash').map((x: any) => x.id).sort();
  expect(hot).toEqual(['monthly', 'remove_ads', 'starter']);
  // 카탈로그 밖·비활성 상품(보석 팩·성장·VIP 등)은 계속 숨긴다. 보석·패키지 탭도 비어 있어 감춘다.
  const ids = meta.shopTabs().map((t: any) => t.id);
  expect(ids).not.toContain('gem'); expect(ids).not.toContain('pack');
  for (const id of ['growth', 'gem1', 'gem3'])
    expect(['hot', 'gem', 'pack', 'enh'].flatMap((t) => meta.shopSkus(t)).some((x: any) => x.id === id)).toBe(false);
  expect(meta.payOn()).toBe(false); // 보석 충전·초월 패키지 입구는 판매 상품이 없어 계속 숨는다
  expect(meta.vipShown()).toBe(false);
});

test('판매 불가(eligible 아님·Play 가격 없음) 상품은 결제가 연결돼도 숨는다', () => {
  const billing = fakeBilling();
  const { meta } = metaWith(true, { ...billing, productForShopSku: (sku: string) => sku === 'starter' ? { id: 'starter_pack_v1', formattedPrice: '₩1,200', sellable: false } : sku === 'monthly' ? { id: 'monthly_card_v1', formattedPrice: null, sellable: true } : billing.productForShopSku(sku) });
  const ids = meta.shopSkus('hot').filter((x: any) => x.kind === 'cash').map((x: any) => x.id);
  expect(ids).toEqual(['remove_ads']);
});

test('프로필 창은 결제가 없으면 목업·누적 결제·VIP 멤버십 입구를 내지 않는다', () => {
  const { meta, modals } = metaWith(false);
  meta.showProfile();
  const html = modals[0];
  for (const text of ['목업', '누적 결제', '다음 VIP', 'VIP 멤버십', '₩', 'm-vip']) expect(html).not.toContain(text);
  expect(html).toContain('총 소환');
});

test('프로필 창은 결제가 연결돼도 VIP·누적 결제를 보이지 않는다(판매하지 않음)', () => {
  const { meta, modals } = metaWith(true);
  meta.showProfile();
  for (const text of ['목업', '누적 결제', '다음 VIP', 'VIP 멤버십', 'm-vip']) expect(modals[0]).not.toContain(text);
});

test('결제 연결 뒤 구매가 실패하면 조용히 넘기지 않고 이유별 토스트를 띄운다(취소는 조용히)', async () => {
  let reason = 'storage';
  const { eco, meta, toasts } = metaWith(true, fakeBilling(async () => ({ ok: false, reason })));
  meta.refreshTop = () => {}; meta.renderPass = () => {};
  await meta.buy('starter');
  await meta.buyPass();
  expect(toasts.length).toBe(2);
  expect(toasts.every((t) => t.includes('저장하지 못해'))).toBe(true);
  reason = 'cancelled'; toasts.length = 0;
  await meta.buy('starter');
  expect(toasts.length).toBe(0);
  reason = 'pending';
  await meta.buy('starter');
  expect(toasts).toEqual(['결제 대기 중 — 승인되면 자동 지급']);
  // 결제가 연결돼도 기존 현금 경로는 직접 지급하지 않는다.
  expect(eco.purchase('starter')).toEqual({ ok: false, reason: 'use-billing' });
  expect(eco.buyPass()).toEqual({ ok: false, reason: 'use-billing' });
  expect(meta.purchaseFailText({ ok: false, reason: 'storage' })).toContain('저장하지 못해');
  expect(meta.purchaseFailText({ ok: false, reason: 'once' })).toContain('이미 구매');
  expect(meta.purchaseFailText(undefined)).toBe('구매하지 못했습니다');
});
