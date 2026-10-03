import { HEROES } from '../data/heroes.js';
import { stageDef } from '../data/stages.js';
import { retryEnergyForResult, runRouteLabel } from '../game/run-history.js';
import { comparableRunContext } from '../game/run-personal-goals.js';

const controls = { manual:'수동', auto:'AUTO', mixed:'수동·AUTO 혼합' };
export const personalControlLabel = value => controls[value] || '조작 미기록';
export const personalMetricLabel = metric => ({ time:'시간', perfects:'정확 회피', breaks:'균형 붕괴' })[metric] || '목표';
export const personalMetricValue = (metric, value) => metric === 'time' ? `${value.toFixed(2)}초` : `${value}회`;
export function personalContextLabel(value) {
  const context = comparableRunContext(value);
  return context ? `${HEROES[context.heroId].name} · 출격 Lv.${context.heroLevel} · ${personalControlLabel(context.control)}` : '비교 조건 미기록';
}
export function personalTargetLabel(receipt) {
  return `다음 목표 · ${personalMetricLabel(receipt.metric)} ${personalMetricValue(receipt.metric,receipt.target)} ${receipt.metric==='time'?'이하':'이상'}`;
}
export function personalResultLabel(result) {
  if (!result) return '';
  if (!result.eligible) return result.reason === 'defeat' ? '개인 목표 · 패배 기록은 최고 기록과 비교하지 않습니다.'
    : '개인 목표 · 경로·영웅·출격 레벨·조작 조건이 달라 비교하지 않습니다.';
  // Keep the terminal time exact here: rounding 10.004 to 10.00 must not make
  // a missed 10.00-second target look achieved. Summary/targets use cents.
  const actual=result.metric==='time'?`${String(result.value)}초`:personalMetricValue(result.metric,result.value);
  return `개인 목표 ${result.achieved?'달성':'다음에도 도전'} · ${personalMetricLabel(result.metric)} ${actual} · 목표 ${personalMetricValue(result.metric,result.target)} ${result.metric==='time'?'이하':'이상'}`;
}
/** Catalog hint only. The existing departure methods retain every access/cost/refund check. */
export function personalDeparture(value) {
  const context = comparableRunContext(value);
  if (!context) return null;
  const route = context.route;
  if (route.kind === 'campaign') {
    const [ch,st] = route.id.split('-').map(Number);
    return { kind:'campaign', label:runRouteLabel(route), energy:stageDef(ch,st).energy };
  }
  return { kind:'dungeon', label:runRouteLabel(route), energy:retryEnergyForResult({ kind:route.kind, id:route.id, depth:route.depth }),
    id:route.id, options:{ rift:!!route.riftId, depth:route.depth, conquestId:route.conquestId ?? undefined } };
}
