// 상점·소환 화면용 짧은 단축 일수 문구. 계산은 economy-pace(ECONOMY_PACE)가, 노출 여부는 growth-flow paceLabel 이 정한다.
import { paceLabel } from '../data/growth-flow.js';
import { ECONOMY_PACE } from '../data/economy-pace.js';

/**
 * 상품(skuId) 또는 'ssrTicket' 의 단축 문구. paceLabel 이 null 이면(단축 0일·없는 키) null 이라 아무것도 표시하지 않는다.
 * @returns {{ text: string, basis: string, saved: string, full: string } | null}
 */
export function paceShort(key) {
  const full = paceLabel(key);
  if (!full) return null;
  const s = ECONOMY_PACE.savings[key];
  return {
    text: s.target + ' ' + s.freeDays + '일→' + s.withDays + '일',
    saved: '−' + s.days + '일',
    basis: '무과금 스토리 ' + ECONOMY_PACE.minutesPerDay + '분/일·별 승급 제외 예상',
    full,
  };
}
