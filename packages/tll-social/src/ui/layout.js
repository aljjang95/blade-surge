// 화면 배치 계산: DOM에 의존하지 않는 순수 함수(테스트 대상)

/** 폰 가로(844x390 등)처럼 좁고 낮은 화면인가. */
export function isCompact(width, height) {
  return height <= 520 || width <= 900;
}

/**
 * 화면 크기에서 패널 배치를 정한다.
 * - sideWidth: 사이드 시트(채팅·파티 모집) 폭. 시안 C12는 화면의 45%.
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
