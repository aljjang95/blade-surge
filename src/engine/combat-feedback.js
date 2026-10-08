// 표시 전용이다. 난수를 소비하거나 전투 이벤트를 변경하지 않는다.
/**
 * @typedef {{left: number, top: number, right: number, bottom: number}} CombatTextRect
 * @typedef {{x?: number, y?: number, bounds?: CombatTextRect}} RecentCombatText
 */
const STATUS_COPY = Object.freeze({
  BLOCK: Object.freeze({ key: 'block', label: '방어' }),
  'GUARD BREAK': Object.freeze({ key: 'guard-break', label: '가드 붕괴' }),
  BREAK: Object.freeze({ key: 'posture-break', label: '균형 붕괴' }),
  MISS: Object.freeze({ key: 'miss', label: '빗나감' }),
});

export function compactCombatStatus(text) {
  return Object.hasOwn(STATUS_COPY, text) ? STATUS_COPY[text] : null;
}

export function decorativeBurstGain(size) {
  // 작은 접촉은 그대로 두고 넓은 폭발·충격파가 겹칠 때의 백색 번짐만 낮춘다.
  // 크기·판정·수명·알파 곡선은 바꾸지 않는 장식 RGB 상한이다.
  return Number.isFinite(size) ? 1 - Math.max(0, Math.min(1, (size - 4) / 8)) * .72 : 1;
}

export function boundedFeedbackGain(gain) {
  return Number.isFinite(gain) ? Math.max(.2, Math.min(1, gain)) : 1;
}

function validRegion(rect) {
  return rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    && rect.right > rect.left && rect.bottom > rect.top;
}

export function combatTextViewport(rect) {
  if (!validRegion(rect)) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: rect.right - rect.left, height: rect.bottom - rect.top };
}

/**
 * @param {CombatTextRect[]} regions
 * @param {CombatTextRect | null} [viewport=null]
 */
export function combatTextRegions(regions, viewport = null) {
  // DOMRect의 후속 변경이 배치 결과에 섞이지 않도록 화면 좌표만 복사한다.
  const leftOffset = viewport?.left || 0, topOffset = viewport?.top || 0;
  return (Array.isArray(regions) ? regions : []).slice(0, 12).filter(validRegion)
    .map(({ left, top, right, bottom }) => ({ left: left - leftOffset, top: top - topOffset,
      right: right - leftOffset, bottom: bottom - topOffset }));
}

/** 현재 transform을 읽지 않고 알려진 HUD 애니메이션의 전체 테두리 영역을 예약한다.
 * 입력은 변형 없는 #hud 직접 자식의 offset 기반 레이아웃 좌표다. 그림자는 포함하지 않는다.
 */
export function combatHudAnimationRegion(id, box, oathVisual = false) {
  if (!validRegion(box)) return null;
  const width = box.right - box.left, height = box.bottom - box.top;
  let left = box.left, right = box.right, top = box.top, bottom = box.bottom;
  if (id === 'combo') {
    const sine = Math.sin(4 * Math.PI / 180), originX = box.right, originY = (box.top + box.bottom) / 2;
    const vertical = 1.4 * (width * sine + height / 2);
    left = originX - 1.4 * (width + height / 2 * sine);
    right = originX + 1.4 * height / 2 * sine;
    top = originY - vertical; bottom = originY + vertical;
  } else if (id === 'kill-streak') {
    left = box.left - width / 2; right = box.left + width / 2;
    top = oathVisual ? box.top - 4 : box.top - height / 2;
    bottom = oathVisual ? box.bottom : box.top + height / 2;
  } else if (id === 'combat-cue') {
    left = box.left - width * .54; right = box.left + width * .54;
    top = box.top - height * .04 - 12; bottom = box.bottom + height * .04;
  }
  // offset 좌표와 크기의 정수 반올림에 여유를 둔다.
  return { left: left - 3, right: right + 3, top: top - 3, bottom: bottom + 3 };
}

export function heroCombatTextRegion(area, width, height) {
  if (!area || ![area.x, area.y, area.z, area.w, width, height].every(Number.isFinite)
    || area.z <= 0 || area.w <= 0 || width <= 0 || height <= 0) return null;
  return {
    left: (area.x - area.z) * width - 16,
    right: (area.x + area.z) * width + 16,
    top: (1 - area.y - area.w) * height - 16,
    bottom: (1 - area.y + area.w) * height + 16,
  };
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

/** 짧은 상태어의 기존 상승 애니메이션 전체 범위를 고려한다.
 * 이 함수만 후보 24개, 저장한 HUD 영역 12개, 최근 문구 40개로 계산량을 제한한다.
 * 기존 FX.damage의 620ms 기록과 원래 배치 패턴 검색 범위는 변경하지 않는다.
 * 모든 위치가 가려지면 가장 덜 겹치는 화면 안 후보를 유지한다.
 * @param {{x: number, y: number, label: string, lift: number, width: number, height: number, hero?: CombatTextRect | null, regions?: CombatTextRect[], recent?: RecentCombatText[]}} options
 */
export function placeCombatStatus({ x, y, label, lift, width, height, hero = null, regions = [], recent = [] }) {
  const vw = Number.isFinite(width) && width > 0 ? width : 1;
  const vh = Number.isFinite(height) && height > 0 ? height : 1;
  const originX = Number.isFinite(x) ? x : vw / 2, originY = Number.isFinite(y) ? y : vh / 2;
  // 글자 12px·줄 높이 16px에 테두리·여백·회전·기존 최대 확대를 포함한다.
  const halfW = Math.min(vw / 2, (String(label).length * 12 + 14) * .78 + 3);
  const halfH = 20, rise = Number.isFinite(lift) ? Math.abs(lift) : 68;
  const minX = Math.min(vw / 2, halfW + 8), maxX = Math.max(minX, vw - halfW - 8);
  const maxY = Math.max(vh / 2, vh - halfH - 8), minY = Math.min(maxY, halfH + rise + 8);
  const clampX = value => Math.max(minX, Math.min(maxX, value));
  const clampY = value => Math.max(minY, Math.min(maxY, value));
  const candidates = [[originX, originY], [minX, originY], [maxX, originY],
    [originX, minY], [originX, maxY]];
  const actor = validRegion(hero) ? hero : null;
  if (actor) {
    const left = actor.left - halfW - 8, right = actor.right + halfW + 8;
    for (const row of [originY, (actor.top + actor.bottom) / 2, actor.bottom + rise + halfH + 8]) {
      candidates.push([left, row], [right, row]);
    }
  }
  const obstacles = regions.slice(0, 12).filter(validRegion);
  // UI 영역마다 가장 가까운 바깥쪽 한 곳만 후보에 추가한다.
  for (const rect of obstacles) {
    const edges = [[rect.left - halfW - 8, originY], [rect.right + halfW + 8, originY],
      [originX, rect.top - halfH - 8], [originX, rect.bottom + rise + halfH + 8]];
    let nearest = edges[0], distance = Infinity;
    for (const edge of edges) {
      const d = Math.hypot(clampX(edge[0]) - originX, clampY(edge[1]) - originY);
      if (d < distance) { distance = d; nearest = edge; }
    }
    candidates.push(nearest);
  }
  const recentEntries = recent.slice(-40);
  let best = null, bestScore = Infinity, bestHardScore = Infinity, bestHeroBlocked = true;
  for (const candidate of candidates.slice(0, 24)) {
    const cx = clampX(candidate[0]), cy = clampY(candidate[1]);
    const bounds = { left: cx - halfW, right: cx + halfW, top: cy - rise - halfH, bottom: cy + halfH };
    const heroOverlap = actor ? overlap(bounds, actor) : 0;
    const heroBlocked = heroOverlap > 0;
    let blocked = heroBlocked || bounds.left < 0 || bounds.right > vw || bounds.top < 0 || bounds.bottom > vh;
    let hardScore = heroOverlap, score = 0;
    for (const rect of obstacles) {
      const area = overlap(bounds, rect);
      if (area) { blocked = true; hardScore += 1000 + area; }
    }
    for (const entry of recentEntries) {
      const rect = validRegion(entry.bounds) ? entry.bounds : {
        left: entry.x - 30, right: entry.x + 30, top: entry.y - 24, bottom: entry.y + 24,
      };
      if (validRegion(rect)) score += overlap(bounds, rect) * .1;
    }
    score += Math.hypot(cx - originX, cy - originY) * .01;
    // 가려지지 않는 후보를 먼저 고른다. 문구 밀도는 HUD 가림을 정당화하지 않는다.
    const better = !best || (blocked !== best.blocked ? !blocked
      : heroBlocked !== bestHeroBlocked ? !heroBlocked
        : hardScore !== bestHardScore ? hardScore < bestHardScore : score < bestScore);
    if (better) {
      bestScore = score; bestHardScore = hardScore; bestHeroBlocked = heroBlocked;
      best = { x: cx, y: cy, bounds, blocked };
    }
  }
  return best ?? {
    x: clampX(originX), y: clampY(originY), blocked: true,
    bounds: { left: clampX(originX) - halfW, right: clampX(originX) + halfW,
      top: clampY(originY) - rise - halfH, bottom: clampY(originY) + halfH },
  };
}
