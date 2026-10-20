// 화면 배치 계산: DOM에 의존하지 않는 순수 함수(테스트 대상)

/** 폰 가로(844x390 등)처럼 좁고 낮은 화면인가. */
export function isCompact(width, height) {
  return height <= 520 || width <= 900;
}

/**
 * 화면 크기에서 패널 배치를 정한다.
 * - sideWidth: 사이드 시트(채팅·파티 모집) 폭. 시안 C17는 화면의 45%.
 * - margin: 넓은 화면 프레임(친구·명예의 전당·소식) 바깥 여백.
 */
export function layoutFor(width, height) {
  const w = Math.max(0, Number(width) || 0), h = Math.max(0, Number(height) || 0);
  const compact = isCompact(w, h);
  const sideWidth = Math.round(Math.min(Math.max(w * 0.45, compact ? 320 : 380), Math.min(560, w)));
  const margin = compact ? 6 : Math.round(Math.min(32, Math.max(12, w * 0.02)));
  // 소식 상세는 넓은 화면에서만 오른쪽 열로 두고, 좁으면 목록을 덮는 상세 화면으로 바꾼다.
  const boardSplit = w - margin * 2 >= 1000;
  return { width: w, height: h, compact, sideWidth, margin, boardSplit, portrait: h > w };
}

/**
 * 전투 중 플레이를 가리면 안 되는 보호 영역.
 * 가로 가운데 1/3, 세로는 상단 HUD 아래부터 조작 버튼 위까지.
 */
export function protectedZone({ width, height, hudBottom = 0, controlsTop = height }) {
  const top = Math.max(0, Math.min(hudBottom, height));
  const bottom = Math.max(top, Math.min(controlsTop, height));
  return { left: width / 3, right: (width * 2) / 3, top, bottom };
}

/** @param {{left:number,top:number,right:number,bottom:number}} a @param {{left:number,top:number,right:number,bottom:number}} b */
export function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * 전투 중 채팅 띠의 자리. 화면 왼쪽 1/3 안, 상단 HUD 아래 가장자리에 최대 2줄을 둔다.
 * 폭을 왼쪽 1/3 안으로 제한해 보호 영역과 겹치지 않게 한다.
 */
export function tickerRect({ width, height, hudBottom = 0, controlsTop = height, lines = 2, lineHeight = 17, inset = 8, maxWidth = 340 }) {
  const zone = protectedZone({ width, height, hudBottom, controlsTop });
  const count = Math.max(1, Math.min(2, lines | 0 || 1));
  const left = inset;
  const right = Math.max(left + 80, Math.min(zone.left - inset, left + maxWidth));
  const top = Math.min(Math.max(inset, hudBottom + 6), Math.max(inset, height - count * lineHeight - inset));
  return { left, top, right, bottom: top + count * lineHeight + 6, zone };
}

/**
 * 조작 버튼 상단(보호 영역의 아래 경계)을 정한다.
 * 보이는 조작 요소의 상단만 받는다. 요소가 없거나 결과가 HUD 하단 이하(영역이 뒤집힘)이면 화면 높이의 70%를 쓴다.
 * @param {{ tops: number[], hudBottom?: number | null, height: number }} input
 */
export function resolveControlsTop({ tops, hudBottom = 0, height }) {
  const safe = Math.round((Number(height) || 0) * 0.7);
  const values = (Array.isArray(tops) ? tops : []).filter(value => Number.isFinite(value));
  if (!values.length) return safe;
  const top = Math.floor(Math.min(...values));
  const bottom = Number.isFinite(hudBottom) ? hudBottom : 0;
  return top > bottom ? top : safe;
}

/**
 * 미확인 배지의 자리. 띠 줄 끝 오른쪽 → 띠 아래 → 빈 곳 훑기 순서로, 보호 영역·기존 HUD 버튼·띠와 겹치지 않는 첫 자리를 쓴다.
 * 모두 겹치면 띠 아래(clear=false)로 돌려준다.
 * @param {{
 *   ticker: { left: number, top: number, right: number, bottom: number },
 *   tickerVisible?: boolean,
 *   size: { width: number, height: number },
 *   screen: { width: number, height: number },
 *   zone: { left: number, top: number, right: number, bottom: number },
 *   obstacles?: { left: number, top: number, right: number, bottom: number }[],
 *   gap?: number,
 * }} input
 */
export function badgeRect({ ticker, tickerVisible = true, size, screen, zone, obstacles = [], gap = 4 }) {
  const bw = Math.max(1, size.width), bh = Math.max(1, size.height);
  const make = (left, top) => ({ left, top, right: left + bw, bottom: top + bh });
  const blockers = obstacles.filter(o => o && [o.left, o.top, o.right, o.bottom].every(Number.isFinite));
  if (tickerVisible) blockers.push(ticker);
  const fits = r => r.left >= 0 && r.top >= 0 && r.right <= screen.width && r.bottom <= screen.height
    && !rectsOverlap(r, zone) && !blockers.some(o => rectsOverlap(r, o));
  const below = make(ticker.left, tickerVisible ? ticker.bottom + 2 : ticker.top);
  const ordered = tickerVisible ? [make(ticker.right + gap, ticker.top), below] : [below];
  for (const candidate of ordered) if (fits(candidate)) return { ...candidate, clear: true };
  const lefts = [...new Set([ticker.left, ticker.right + gap, ...blockers.map(o => o.right + gap)])].sort((a, b) => a - b);
  const lastTop = Math.max(ticker.top, screen.height - bh);
  for (let top = ticker.top; top <= lastTop; top += 4) {
    for (const left of lefts) {
      const candidate = make(left, top);
      if (fits(candidate)) return { ...candidate, clear: true };
    }
  }
  return { ...below, clear: false };
}
