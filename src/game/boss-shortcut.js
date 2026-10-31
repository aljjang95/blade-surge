// 보스 직행 조건(2026-10-28 대표님 실기기 피드백 "보스로 바로 가는 건 내 전투력이 던전 권장보다 훨씬 높을 때만").
// 이미 별 3으로 정복한 관문이거나, 출격 때 전투력이 권장 전투력의 1.5배 이상일 때만 남은 구역을 건너뛸 수 있다.
export const BOSS_SHORTCUT_POWER_MUL = 1.5;

/** @param {{power:number, recPower:number, stars:number}} p */
export function bossShortcutRule({ power = 0, recPower = 0, stars = 0 } = {}) {
  const need = Math.ceil((Number(recPower) || 0) * BOSS_SHORTCUT_POWER_MUL);
  if ((Number(stars) || 0) >= 3) return { ok: true, reason: 'stars', need };
  if (need > 0 && (Number(power) || 0) >= need) return { ok: true, reason: 'power', need };
  return { ok: false, reason: 'locked', need };
}

/** 관문 화면 한 줄 안내. */
export function bossShortcutLabel(rule) {
  if (rule.ok) return rule.reason === 'stars' ? '보스 직행 가능 · 별 3 정복 관문' : '보스 직행 가능 · 전투력 권장의 1.5배 이상';
  return `보스 직행 조건 · 별 3 정복 또는 전투력 ${rule.need.toLocaleString('ko-KR')} 이상`;
}

/** 하단 출격 띠용 짧은 안내(작은 화면에서도 한 줄). */
export function bossShortcutShort(rule) {
  if (rule.ok) return rule.reason === 'stars' ? '보스 직행 가능 · ★3 정복' : '보스 직행 가능 · 전투력 충족';
  return `보스 직행: ★3 또는 전투력 ${rule.need.toLocaleString('ko-KR')}`;
}
