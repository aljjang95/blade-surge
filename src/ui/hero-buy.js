// 미보유 영웅 카드의 "보석으로 바로 영입" 구역(HERO_DIRECT_PURCHASE.enabled 일 때만). 꺼져 있거나 영입할 수 없는 영웅(소유·곧 합류·데뷔 전)이면 빈 문자열이라 화면에 아무것도 나오지 않는다.
import { fmt } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** @param {any} eco @param {string} id */
export function heroBuyButtonHtml(eco, id) {
  const q = eco.heroBuyQuote(id);
  if (q.reason !== null && q.reason !== 'gems') return '';
  const label = `보석으로 바로 영입 · ${fmt(q.price)}`;
  const why = q.reason === 'gems' ? `<p class="hl-why" id="hl-buy-why">보석이 ${fmt(q.price - q.have)}개 부족합니다</p>` : `<p class="hl-lead" id="hl-buy-why">캠페인 합류를 기다리지 않고 지금 바로 동료로 영입합니다. 합류할 때 중복 지급은 없습니다.</p>`;
  return `<section class="hl-box" data-lock="gem-buy"><h3>보석으로 바로 영입</h3>${why}<button type="button" class="hl-btn ${q.reason === 'gems' ? 'hl-gray' : 'hl-gold'}" id="h-gem-buy" aria-describedby="hl-buy-why"${q.reason === 'gems' ? ' disabled' : ''}>${esc(label)}</button></section>`;
}
