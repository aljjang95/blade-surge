import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { SKUS } from '../src/data/shop.js';
import { IAP_BY_SHOP_SKU } from '../src/shared/iap-catalog.js';
import { Meta } from '../src/ui/meta.js';
import { Economy } from '../src/game/economy.js';
import { WITHDRAWAL_NOTICE, INSTANT_GRANT_CONSENT, PURCHASE_CHECKS, MINOR_CONSENT, SUBSCRIPTION_NOTICE, LEGAL_PAGES, paymentNoticeHtml, legalLinksHtml } from '../src/ui/legal-links.js';

// 카탈로그(IAP_BY_SHOP_SKU)에 아직 없는 현금 SKU 허용 목록(지금은 없음 — 모든 현금 SKU가 카탈로그 정본과 짝이다).
const PENDING_CATALOG: string[] = [];

test('상점의 현금(kind:cash) SKU는 전부 카탈로그 shopSku에 있다 (카탈로그 밖 목업 금지)', () => {
  const cash = SKUS.filter((s: any) => s.kind === 'cash').map((s: any) => s.id);
  expect(cash.length).toBeGreaterThan(0);
  for (const id of cash) expect(Boolean((IAP_BY_SHOP_SKU as any)[id]) || PENDING_CATALOG.includes(id)).toBe(true);
});

test('현금 SKU에는 하드코딩 가격 문구(priceLabel·₩)가 없고 카탈로그 밖 목업은 지워졌다', () => {
  for (const s of SKUS.filter((x: any) => x.kind === 'cash')) {
    expect((s as any).priceLabel).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('₩');
  }
  for (const id of ['gem4', 'gem5', 'gem6', 'vip_pass', 'boss_pack', 'transcend_pack', 'enh_pack']) expect(SKUS.some((s: any) => s.id === id)).toBe(false);
});

test('성장 패키지는 계약 보상·계정당 1회이고 확률형(소환권)이 없다', () => {
  const g: any = SKUS.find((s: any) => s.id === 'growth');
  expect(g.rewards).toEqual({ gems: 2400, gold: 200000, transcendStones: 5, stones: 100 });
  expect(g.once).toBe(true);
  expect(g.rewards.tickets).toBeUndefined(); expect(g.rewards.ssrTicket).toBeUndefined();
});

test('결제 고지 문구에 "환불 불가"가 없고 철회 안내·링크가 있다', () => {
  const html = paymentNoticeHtml({ id: 'starter', rewards: { gems: 1000, ssrTicket: 1 } }) + legalLinksHtml() + WITHDRAWAL_NOTICE + INSTANT_GRANT_CONSENT + SUBSCRIPTION_NOTICE;
  expect(html).not.toMatch(/환불\s*불가|환불불가/);
  expect(WITHDRAWAL_NOTICE).toBe('구매 후 7일 이내 사용하지 않은 상품·보석은 청약철회할 수 있습니다. 사용했거나 즉시 지급되어 사용된 부분은 철회가 제한됩니다.');
  const n = paymentNoticeHtml({ id: 'starter', rewards: { gems: 1000 } });
  expect(n).toContain('/refund.html'); expect(n).toContain('/terms.html'); expect(n).toContain('/odds.html');
  expect(n).toContain('target="_blank"'); expect(n).toContain('rel="noopener"');
  expect(paymentNoticeHtml({ id: 'remove_ads', rewards: {} })).not.toContain('/odds.html');
  expect(paymentNoticeHtml({ id: 'monthly', rewards: { gems: 1200 } }, { subscription: true })).toContain('Google Play 구독 관리에서 언제든 해지');
});

function metaWith(confirm: (...a: any[]) => Promise<boolean>) {
  const eco: any = new Economy();
  const items: Record<string, any> = {
    starter: { id: 'starter_pack_v1', formattedPrice: '₩1,200', sellable: true },
    monthly: { id: 'monthly_card_v1', formattedPrice: '₩5,900', sellable: true, type: 'subscription' },
  };
  eco.setBilling({ available: () => true, productForShopSku: (s: string) => items[s] || null, buy: async () => ({ ok: false, reason: 'cancelled' }) });
  const ui: any = { toast() {}, confirm, closeModal() {}, modal() {}, purchaseDone() {}, paySheet: async () => false };
  return Object.assign(Object.create(Meta.prototype), { eco, ui, shopTab: 'hot', trackFunnel() {}, refreshTop() {}, renderShop() {} });
}

test('구매 확인 창은 철회 고지와 동의 체크를 요구하고, 구독은 자동 갱신 문구를 낸다', async () => {
  const calls: any[] = [];
  const meta: any = metaWith(async (...a) => { calls.push(a); return false; });
  await meta.buy('starter'); await meta.buy('monthly');
  expect(calls.length).toBe(2);
  for (const [, body, opt] of calls) {
    expect(body).toContain(WITHDRAWAL_NOTICE); expect(body).toContain('/refund.html'); expect(body).not.toMatch(/환불\s*불가/);
    // 즉시 지급 철회 제한 동의 + 연령·법정대리인 동의 확인, 둘 다 필수(기본 미체크)
    expect(opt.check).toEqual(PURCHASE_CHECKS);
    expect(opt.check).toContain(INSTANT_GRANT_CONSENT); expect(opt.check).toContain(MINOR_CONSENT);
  }
  expect(calls[0][1]).not.toContain('자동 갱신'); expect(calls[1][1]).toContain('자동 갱신');
});

test('상점·로딩 화면(index.html)에 정책 링크 줄이 있고 가챠에 확률 정보 링크가 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const page of Object.values(LEGAL_PAGES)) expect(html.split(`href="${page.href}"`).length - 1).toBeGreaterThanOrEqual(2);
  expect(html).toContain('id="shop-legal"');
  expect(html).not.toMatch(/환불\s*불가/);
});

test('구매 확인 창: 필수 체크 두 개(기본 미체크)를 모두 체크해야 구매 버튼이 켜진다', async () => {
  const { UI } = await import('../src/ui/ui.js');
  let html = '', onOpen: any = null;
  const ui: any = Object.assign(Object.create(UI.prototype), { modal: (h: string, o: any) => { html = h; onOpen = o.onOpen; }, closeModal() {} });
  const done = ui.confirm('구매 확인', '본문', { ok: '구매하기', check: PURCHASE_CHECKS });
  expect(html).toContain(INSTANT_GRANT_CONSENT); expect(html).toContain(MINOR_CONSENT);
  expect(html).not.toContain('checked');
  const boxes = [{ checked: false, onchange: null as any }, { checked: false, onchange: null as any }];
  const ok: any = { disabled: false, onclick: null };
  const root: any = { querySelector: (q: string) => (q === '#m-ok' ? ok : null), querySelectorAll: () => boxes, onkeydown: null };
  ok.focus = () => {};
  onOpen(root);
  expect(ok.disabled).toBe(true);
  boxes[0].checked = true; boxes[0].onchange();
  expect(ok.disabled).toBe(true);
  boxes[1].checked = true; boxes[1].onchange();
  expect(ok.disabled).toBe(false);
  ok.onclick();
  expect(await done).toBe(true);
});

test('정책 시행일·결정 반영: 세 페이지 시행일 2026년 11월 6일, 탈퇴 시 소멸 사전 고지, 결제대행 국외이전 해당 없음', () => {
  const read = (p: string) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
  for (const p of ['terms.html', 'refund.html', 'privacy.html']) expect(read(p)).toContain('시행일: 2026년 11월 6일');
  expect(read('terms.html')).toContain('탈퇴와 함께 소멸');
  expect(read('privacy.html')).toContain('국외 이전에 해당하지 않습니다(국내 처리)');
});
