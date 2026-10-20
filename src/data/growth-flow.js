// 성장·과금 흐름(보석 → 소환 → 중복 조각 → 초월 → 더 강한 전투)의 단일 계약.
// 상점·소환·초월 화면이 이 파일만 읽어 상품 용도와 부족 재료의 구할 곳을 같은 말로 보여 준다.
// 현금 상품은 결제 연결 전까지 지급하지 않는다(Economy.paymentAvailable). 여기서는 용도 표시만 정한다.
import { GRADE_UP_COST, gradeUpCost, heroGrade, nextGrade } from './hero-grades.js';
import { GACHA } from './shop.js';
import { ECONOMY_PACE } from './economy-pace.js';

export const GROWTH_FLOW = Object.freeze([
  Object.freeze({ id: 'gems', label: '보석', hint: '출석·임무·첫 클리어·패스 무료 보상' }),
  Object.freeze({ id: 'summon', label: '소환', hint: `1회 ${GACHA.single} · 10회 ${GACHA.ten} · SSR 확정권` }),
  Object.freeze({ id: 'shards', label: '중복 조각', hint: `이미 가진 영웅 = 조각 ${GACHA.dupShards} · 보스 처치 시 출전 영웅 조각` }),
  Object.freeze({ id: 'transcend', label: '초월', hint: 'SR → SSR → SSSR' }),
  Object.freeze({ id: 'battle', label: '더 강한 전투', hint: '능력치·스킬 피해·재사용 대기·궁극기 충전' }),
]);

const fmt = (n) => Number(n).toLocaleString('ko-KR');

/** 하루 30분·1장 반복 기댓값. 상품의 실제 대상과 무료 기준을 같은 문구에 남긴다. */
export function paceLabel(skuIdOrKey) {
  const saving = ECONOMY_PACE.savings[skuIdOrKey];
  if (!saving || saving.days <= 0) return null;
  const action = skuIdOrKey === 'ssrTicket' ? '확정권 1장' : '보상 수령';
  return `${saving.target} · 무과금 약 ${saving.freeDays}일 → ${action} 시 약 ${saving.withDays}일 (30분/일 예상)`;
}

/**
 * 상점 상품이 성장 흐름에서 맡는 용도. 여러 보상을 담은 묶음은 가장 희소한 용도 하나를 고른다.
 * @returns {{ role: 'transcend'|'summon'|'reset'|'gold'|'gear'|'energy', label: string } | null}
 */
export function skuFlowRole(sku) {
  if (!sku) return null;
  const r = sku.rewards || {};
  if (r.transcendStones || r.heroChoiceShards) return { role: 'transcend', label: `초월 재료 · SSR ${GRADE_UP_COST.SSR.transcendStones}개 · SSSR ${GRADE_UP_COST.SSSR.transcendStones}개 필요` };
  if (r.ssrTicket) return { role: 'summon', label: 'SSR 확정 소환 · 중복이면 조각' };
  if (r.skillResets) return { role: 'reset', label: '스킬 트리 초기화 · 투자 SP 전액 반환' };
  const gems = sku.gems || r.gems || 0;
  if (r.tickets || gems) {
    const pulls = (r.tickets || 0) + Math.floor(gems / GACHA.single);
    return { role: 'summon', label: `소환 ${fmt(pulls)}회분 · 중복 영웅은 초월 조각` };
  }
  if (r.gold) return { role: 'gold', label: `초월 골드(SSR ${fmt(GRADE_UP_COST.SSR.gold)})·영웅 레벨업` };
  if (r.stones || r.stones2 || r.stones3 || r.protect || r.bless) return { role: 'gear', label: '장비 강화' };
  if (r.energy) return { role: 'energy', label: '원정 에너지 · 보스 조각 파밍' };
  return null;
}

/** 초월 재료가 부족할 때 구할 곳. quote 는 Economy.transcendQuote 결과. */
export function shortageRoutes(quote) {
  const cost = quote?.cost, have = quote?.have || {};
  if (!quote?.next || !cost) return [];
  const routes = [];
  if ((have.shards || 0) < cost.shards) routes.push({ key: 'shards', label: '소환', route: 'gacha', hint: `중복 소환 1회 조각 ${GACHA.dupShards} · 이 영웅으로 보스 처치 시 조각` });
  if ((have.transcendStones || 0) < cost.transcendStones) routes.push({ key: 'transcendStones', label: '상점', route: 'shop-enh', hint: '보석으로 초월석 구매 · 보스 처치 시 초월석' });
  if ((have.gold || 0) < cost.gold) routes.push({ key: 'gold', label: '골드', route: 'shop-gold', hint: '보석으로 골드 구매 · 스테이지 골드' });
  return routes;
}

/** 다음 초월까지 조각 진행. 최고 등급이면 need/next 가 null. */
export function shardProgress(def, state) {
  const grade = heroGrade(def, state), cost = gradeUpCost(grade);
  return { have: Math.max(0, Math.floor(Number(state?.shards) || 0)), need: cost ? cost.shards : null, grade, next: nextGrade(grade) };
}
