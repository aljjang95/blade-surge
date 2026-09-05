// PRD §2: 표본 누락/패배/시간초과를 정상 완주로 승인하지 않는다.
export const BANDS = {
  errors: { max: 0, label: '콘솔 에러' }, bootMs: { max: 12000, label: '부트 시간(ms)' },
  floorClearSec: { min: 150, max: 420, label: '층 클리어(초)' }, killsPerFloor: { min: 35, label: '층당 처치' },
  maxAliveSeen: { min: 14, label: '동시 생존 최대' }, dropsPerFloor: { min: 8, label: '층당 드랍' },
  longestDryStreakSec: { max: 35, label: '무보상 최장(초)' }, hitTakenRatio: { min: 0.05, max: 0.45, label: '피격 비율' },
  avgFrameMs: { max: 42, label: '평균 프레임(ms)' }, p95FrameMs: { max: 90, label: 'p95 프레임(ms)' },
  rhythmBeats: { min: 6, label: '도파민 8박자 발화' }, drawCalls: { max: 420, label: '드로우콜' },
};
export const REGRESSION = { avgFrameMs: 1.15, drawCalls: 1.20 };
export function assessMetrics(metrics) {
  const failures = Object.entries(BANDS).filter(([key, band]) => !Number.isFinite(metrics[key]) || metrics[key] < (band.min ?? -Infinity) || metrics[key] > (band.max ?? Infinity)).map(([key]) => key);
  if (metrics._won !== true) failures.push('floor-not-won');
  return failures;
}
export function compareMetrics(base, head) {
  const failures = Object.keys(BANDS).filter((key) => !Number.isFinite(base[key]) || !Number.isFinite(head[key]) || (REGRESSION[key] && base[key] > 0 && head[key] > base[key] * REGRESSION[key]));
  failures.push(...assessMetrics(head));
  if (!Number.isSafeInteger(base._seed) || base._seed < 0 || base._seed > 0xffffffff || base._seed !== head._seed) failures.push('seed-mismatch');
  return [...new Set(failures)];
}
