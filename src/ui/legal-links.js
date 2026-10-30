// 약관·청약철회·확률 고지. 결제 확인 창, 상점·설정·로딩 화면의 링크 줄이 같은 문구와 주소를 쓴다(docs/PAYMENT_COMPLIANCE.md 4.2).
// "환불 불가" 문구는 쓰지 않는다(공정위 사례). 철회 제한은 제한 사실과 범위만 밝힌다.

export const LEGAL_PAGES = Object.freeze({
  terms: Object.freeze({ href: '/terms.html', label: '이용약관' }),
  refund: Object.freeze({ href: '/refund.html', label: '청약철회·환불' }),
  privacy: Object.freeze({ href: '/privacy.html', label: '개인정보처리방침' }),
  support: Object.freeze({ href: '/support.html', label: '고객센터' }),
  odds: Object.freeze({ href: '/odds.html', label: '확률 정보' }),
});

export const WITHDRAWAL_NOTICE = '구매 후 7일 이내 사용하지 않은 상품·보석은 청약철회할 수 있습니다. 사용했거나 즉시 지급되어 사용된 부분은 철회가 제한됩니다.';
export const INSTANT_GRANT_CONSENT = '구매 즉시 지급되며 지급된 보상을 사용하면 그만큼 청약철회가 제한됩니다.';
/** 결제 전 연령·법정대리인 동의 확인 체크(기본 미체크, 약관 제10조). 별도 연령 인증은 두지 않는다. */
export const MINOR_CONSENT = '만 19세 이상이거나, 만 19세 미만으로서 법정대리인(부모 등)의 동의를 받았습니다.';
/** 구매 확인 창의 필수 체크(모두 체크해야 구매 버튼이 켜진다). */
export const PURCHASE_CHECKS = Object.freeze([INSTANT_GRANT_CONSENT, MINOR_CONSENT]);
/** 회원 탈퇴 전 고지(약관 제4조의2). */
export const WITHDRAW_PAID_NOTICE = '청약철회·환불이 가능한 유료 재화가 있으면 탈퇴 전에 고객센터로 환불을 신청해 주세요. 환불 신청 없이 탈퇴하면 남은 유료 재화(보석·이용권·구매 권한)는 탈퇴와 함께 소멸합니다.';
/** 미성년자 결제 전 고지(약관의 법정대리인 동의 조항과 같은 내용). */
export const MINOR_NOTICE = '미성년자는 결제 전에 법정대리인(부모 등)의 동의를 받아 주세요. 동의 없이 한 결제는 미성년자 본인 또는 법정대리인이 취소할 수 있습니다.';
export const SUBSCRIPTION_NOTICE = '자동 갱신 상품입니다. Google Play 구독 관리에서 언제든 해지할 수 있습니다.';

import { BUSINESS_INFO as B } from '../shared/business-info.js';

const link = (page) => `<a href="${page.href}" target="_blank" rel="noopener">${page.label}</a>`;

/** 화면 가장자리에 작게 놓는 링크 줄(새 탭). */
export function legalLinksHtml(pages = ['terms', 'refund', 'privacy', 'support', 'odds'], cls = 'legal-links') {
  return `<nav class="${cls}" aria-label="약관 및 정책">${pages.map((k) => link(LEGAL_PAGES[k])).join('<span aria-hidden="true"> · </span>')}</nav>`;
}

/** 소환(가챠) 재료가 들어가는 상품인지. 확률 정보 링크를 함께 보인다. */
export function summonRelated(sku) {
  if (!sku) return false;
  if (sku.id === 'pass') return true;
  const r = sku.rewards || {};
  return !!(sku.gems || r.gems || r.tickets || r.ssrTicket);
}

/**
 * 결제 확인 창 고지(인라인 요소만 — confirm 의 <p> 안에 들어간다).
 * @param {{ id?: string, rewards?: object, gems?: number }} sku @param {{ subscription?: boolean }} [opt]
 */
export function paymentNoticeHtml(sku, { subscription = false } = {}) {
  const pages = ['refund', 'terms'];
  if (summonRelated(sku)) pages.push('odds');
  const links = pages.map((k) => link(LEGAL_PAGES[k])).join(' · ');
  return `<span class="pay-notice">${subscription ? `<span class="pay-notice-sub">${SUBSCRIPTION_NOTICE}</span>` : ''}<span>${WITHDRAWAL_NOTICE}</span><span class="pay-notice-minor">${MINOR_NOTICE}</span><span class="pay-notice-links">${links}</span></span>`;
}

const bizEsc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 사업자 정보(접이식, 작은 글씨). 상점 하단·설정 안쪽에만 둔다 — 전투·필드 화면 위에는 올리지 않는다. */
export function businessInfoHtml(cls = 'biz-info') {
  const rows = [['상호', B.name], ['대표자', B.representative], ['사업자등록번호', B.registrationNo], ['통신판매업 신고번호', B.mailOrderNo], ['주소', B.address], ['연락처', `${B.email} · 전화 ${B.phone}`], ['게임제작업 등록번호', B.gameProductionNo]];
  return `<details class="${cls}"><summary>사업자 정보</summary><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${bizEsc(v)}</dd>`).join('')}</dl></details>`;
}
