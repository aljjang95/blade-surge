import { describe, expect, test } from 'bun:test';
import { badgeRect, isCompact, layoutFor, protectedZone, rectsOverlap, resolveControlsTop, tickerRect } from '../src/ui/layout.js';

const VIEWPORTS = [[844, 390], [800, 360], [1280, 590], [1440, 900], [932, 430]];

describe('패널 배치', () => {
  test('폰 가로는 좁은 화면, 데스크톱은 넓은 화면', () => {
    expect(isCompact(844, 390)).toBe(true);
    expect(isCompact(800, 360)).toBe(true);
    expect(isCompact(1440, 900)).toBe(false);
  });
  test('사이드 시트는 화면의 약 45%이고 최소 폭을 지킨다', () => {
    expect(layoutFor(1440, 900).sideWidth).toBe(560);
    expect(layoutFor(844, 390).sideWidth).toBe(380);
    expect(layoutFor(800, 360).sideWidth).toBe(360);
    expect(layoutFor(320, 600).sideWidth).toBe(320);
  });
  test('소식 상세는 충분히 넓을 때만 오른쪽 열', () => {
    expect(layoutFor(1440, 900).boardSplit).toBe(true);
    expect(layoutFor(844, 390).boardSplit).toBe(false);
  });
});

describe('보호 영역', () => {
  test('가로 가운데 1/3이고 세로는 HUD 아래부터 조작 버튼 위까지', () => {
    const zone = protectedZone({ width: 900, height: 400, hudBottom: 70, controlsTop: 300 });
    expect(zone).toEqual({ left: 300, right: 600, top: 70, bottom: 300 });
  });
  test('범위를 벗어난 값은 화면 안으로 맞춘다', () => {
    const zone = protectedZone({ width: 900, height: 400, hudBottom: 500, controlsTop: 100 });
    expect(zone.top).toBe(400);
    expect(zone.bottom).toBe(400);
  });
  test('겹침 판정', () => {
    expect(rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 20, bottom: 20 })).toBe(true);
    expect(rectsOverlap({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  });
});

describe('전투 중 채팅 띠는 어떤 화면에서도 보호 영역을 가리지 않는다', () => {
  for (const [w, h] of VIEWPORTS) {
    test(w + 'x' + h, () => {
      const hudBottom = Math.round(h * 0.2), controlsTop = Math.round(h * 0.62);
      for (const lines of [1, 2]) {
        const rect = tickerRect({ width: w, height: h, hudBottom, controlsTop, lines });
        expect(rectsOverlap(rect, rect.zone)).toBe(false);
        expect(rect.right).toBeLessThanOrEqual(w / 3);
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.top).toBeGreaterThanOrEqual(hudBottom);
        expect(rect.bottom).toBeLessThanOrEqual(h);
      }
    });
  }
  test('줄 수는 최대 2줄', () => {
    const a = tickerRect({ width: 844, height: 390, hudBottom: 60, lines: 5 });
    const b = tickerRect({ width: 844, height: 390, hudBottom: 60, lines: 2 });
    expect(a.bottom).toBe(b.bottom);
  });
});

describe('조작 버튼 상단 계산', () => {
  test('보이는 조작 요소 중 가장 위쪽을 쓴다', () => {
    expect(resolveControlsTop({ tops: [250.7, 301], hudBottom: 80, height: 390 })).toBe(250);
  });
  test('보호 영역이 뒤집히면(조작 상단이 HUD 하단 이하) 화면 높이의 70%', () => {
    expect(resolveControlsTop({ tops: [60], hudBottom: 80, height: 390 })).toBe(273);
    expect(resolveControlsTop({ tops: [80], hudBottom: 80, height: 390 })).toBe(273);
  });
  test('보이는 요소가 없거나 값이 이상해도 70%', () => {
    expect(resolveControlsTop({ tops: [], hudBottom: 80, height: 500 })).toBe(350);
    expect(resolveControlsTop({ tops: [NaN, undefined], hudBottom: null, height: 500 })).toBe(350);
  });
  test('HUD 하단을 모르면 0으로 본다', () => {
    expect(resolveControlsTop({ tops: [200], hudBottom: null, height: 500 })).toBe(200);
  });
});

describe('미확인 배지 자리', () => {
  const SIZE = { width: 52, height: 20 };
  for (const [w, h] of VIEWPORTS) {
    test(w + 'x' + h + ': 띠 오른쪽 끝이 HUD 버튼에 막히면 다른 자리로 간다', () => {
      const hudBottom = Math.round(h * 0.2), controlsTop = Math.round(h * 0.62);
      const ticker = tickerRect({ width: w, height: h, hudBottom, controlsTop, lines: 2 });
      // 띠 줄 끝 오른쪽과 띠 아래 첫 자리를 덮는 '시점' 같은 버튼
      const camera = { left: ticker.right, top: ticker.top - 4, right: ticker.right + 90, bottom: ticker.bottom + 26 };
      const spot = badgeRect({ ticker, tickerVisible: true, size: SIZE, screen: { width: w, height: h }, zone: ticker.zone, obstacles: [camera] });
      expect(spot.clear).toBe(true);
      expect(rectsOverlap(spot, camera)).toBe(false);
      expect(rectsOverlap(spot, ticker)).toBe(false);
      expect(rectsOverlap(spot, ticker.zone)).toBe(false);
      expect(spot.left).toBeGreaterThanOrEqual(0);
      expect(spot.right).toBeLessThanOrEqual(w);
      expect(spot.bottom).toBeLessThanOrEqual(h);
    });
  }
  test('띠 오른쪽에 자리가 있으면 거기, 보호 영역에 닿으면 띠 아래에 둔다', () => {
    const narrow = tickerRect({ width: 844, height: 390, hudBottom: 70, controlsTop: 240, lines: 1, maxWidth: 120 });
    expect(badgeRect({ ticker: narrow, tickerVisible: true, size: SIZE, screen: { width: 844, height: 390 }, zone: narrow.zone }))
      .toMatchObject({ left: narrow.right + 4, top: narrow.top, clear: true });
    const wide = tickerRect({ width: 844, height: 390, hudBottom: 70, controlsTop: 240, lines: 1 });
    expect(badgeRect({ ticker: wide, tickerVisible: true, size: SIZE, screen: { width: 844, height: 390 }, zone: wide.zone }))
      .toMatchObject({ left: wide.left, top: wide.bottom + 2, clear: true });
  });
  test('띠가 없으면 띠 자리 첫 칸, 버튼에 막히면 비켜 선다', () => {
    const ticker = tickerRect({ width: 844, height: 390, hudBottom: 70, controlsTop: 240, lines: 1 });
    const first = badgeRect({ ticker, tickerVisible: false, size: SIZE, screen: { width: 844, height: 390 }, zone: ticker.zone });
    expect(first).toMatchObject({ left: ticker.left, top: ticker.top });
    const button = { left: 0, top: ticker.top - 2, right: 140, bottom: ticker.top + 40 };
    const moved = badgeRect({ ticker, tickerVisible: false, size: SIZE, screen: { width: 844, height: 390 }, zone: ticker.zone, obstacles: [button] });
    expect(moved.clear).toBe(true);
    expect(rectsOverlap(moved, button)).toBe(false);
  });
  test('자리가 전혀 없으면 clear=false로 띠 아래를 돌려준다', () => {
    const ticker = { left: 8, top: 10, right: 100, bottom: 40 };
    const everything = { left: 0, top: 0, right: 300, bottom: 300 };
    const spot = badgeRect({ ticker, tickerVisible: true, size: SIZE, screen: { width: 300, height: 300 }, zone: { left: 100, right: 200, top: 0, bottom: 300 }, obstacles: [everything] });
    expect(spot.clear).toBe(false);
  });
});
