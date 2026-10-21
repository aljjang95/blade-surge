// 대표님 규칙(2026-10-18): UI 는 실제 플레이(영웅·앞길·위험물·착지점)를 가리지 않고, 월드를 따라다니는 표식은 HUD 를 가리지 않는다.
// 이 모듈은 화면 좌표 사각형만 다루는 순수 함수다. DOM 읽기는 collectHudBlockers 한 곳에 모아 호출자가 느린 주기로만 부른다.

/** 전투 HUD 중 월드 표식(대상 이름표 등)이 올라타면 안 되는 요소들. 숨겨진 요소는 크기가 0이라 자동으로 빠진다. */
export const HUD_BLOCKER_SELECTORS = Object.freeze([
  '.hud-player', '.hud-center .wave', '.hud-center .stage-name', '.hud-right-top', '#btn-map', '#objective',
  '#combo', '#kill-streak', '#bossbar', '.joy-base', '.actions .skill-btn', '#btn-dodge', '#btn-attack',
  '.exp-potions', '.oath-camera-details', '.battle-camera-controls',
]);

export const rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** 실제 겹친 면적(px²). 테스트와 겹침 점검 도구가 같은 정의를 쓴다. */
export function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 화면에 그려진 HUD 요소의 사각형 목록. 레이아웃을 읽으므로 매 프레임 부르지 않는다(0.4초 주기·크기 변경 때만). */
export function collectHudBlockers(hud, selectors = HUD_BLOCKER_SELECTORS) {
  const out = [];
  if (!hud?.querySelectorAll) return out;
  for (const selector of selectors) {
    for (const el of hud.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect?.();
      if (r && r.width > 0 && r.height > 0) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, id: el.id || selector });
    }
  }
  return out;
}

/**
 * rect 를 blockers 밖으로 가장 적게 밀어낸다. 화면(bounds) 안에 머물면서 maxShift 이내로 비킬 수 없으면 hidden 을 돌려준다.
 * out 에 dx/dy(원래 위치에 더할 값)와 hidden 을 쓴다. 프레임 루프에서 부르므로 객체·배열·클로저를 만들지 않는다.
 */
export function placeOutside(out, left, top, right, bottom, blockers, bounds, maxShift = 40) {
  out.dx = 0; out.dy = 0; out.hidden = false;
  if (!(Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom))) { out.hidden = true; return out; }
  const hasBounds = !!bounds;
  // 화면 밖으로 나간 표식은 먼저 화면 안으로 당긴다(HUD 가 없는 가장자리).
  if (hasBounds) {
    const sx = left < bounds.left ? bounds.left - left : right > bounds.right ? bounds.right - right : 0;
    const sy = top < bounds.top ? bounds.top - top : bottom > bounds.bottom ? bounds.bottom - bottom : 0;
    left += sx; right += sx; out.dx += sx; top += sy; bottom += sy; out.dy += sy;
  }
  for (let pass = 0; pass <= blockers.length; pass++) {
    let hit = null;
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i];
      if (left < b.right && right > b.left && top < b.bottom && bottom > b.top) { hit = b; break; }
    }
    if (!hit) break;
    // 네 방향(왼쪽·오른쪽·위·아래) 중 화면 안에 남으면서 가장 적게 움직이는 쪽을 고른다.
    let bestX = 0, bestY = 0, bestCost = Infinity;
    for (let k = 0; k < 4; k++) {
      const mx = k === 0 ? hit.left - right : k === 1 ? hit.right - left : 0;
      const my = k === 2 ? hit.top - bottom : k === 3 ? hit.bottom - top : 0;
      if (hasBounds && (left + mx < bounds.left || right + mx > bounds.right || top + my < bounds.top || bottom + my > bounds.bottom)) continue;
      const cost = Math.abs(mx) + Math.abs(my);
      if (cost < bestCost) { bestCost = cost; bestX = mx; bestY = my; }
    }
    if (bestCost === Infinity) { out.hidden = true; return out; }
    left += bestX; right += bestX; top += bestY; bottom += bestY; out.dx += bestX; out.dy += bestY;
  }
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    if (left < b.right && right > b.left && top < b.bottom && bottom > b.top) { out.hidden = true; return out; }
  }
  if (out.dx * out.dx + out.dy * out.dy > maxShift * maxShift) out.hidden = true;
  return out;
}
