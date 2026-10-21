import { expect, test } from 'bun:test';
import { displaySize, renderPixelRatio, resolveQuality } from '../src/platform/mobile-display.js';

test('auto quality is capability based while a player choice is preserved', () => {
  expect(resolveQuality('auto', { cores: 8, memory: 8, touch: true })).toBe('mid');
  expect(resolveQuality('auto', { cores: 8, memory: 8 })).toBe('high');
  expect(resolveQuality('auto', { cores: 2, memory: 8 })).toBe('low');
  expect(resolveQuality('high', { cores: 2, memory: 2, touch: true })).toBe('high');
});

test('canvas sizing stays on the layout viewport during browser visual viewport changes', () => {
  const host = { innerWidth: 390, innerHeight: 844, visualViewport: { width: 390, height: 430, scale: 1 } };
  expect(displaySize(host)).toEqual({ width: 390, height: 844 });
  host.visualViewport.scale = 2;
  expect(displaySize(host)).toEqual({ width: 390, height: 844 });
  expect(displaySize({ innerWidth: 0, innerHeight: NaN })).toEqual({ width: 1, height: 1 });
});

test('mobile full-screen targets stay within pixel budget in either orientation and every quality', () => {
  for (const [width, height] of [[320,568],[390,844],[915,412],[1024,1366],[2732,2048]]) {
    // 동적 해상도의 출발점(최대치) 예산: 전체 화면 후처리 버퍼의 상한이다. 부하가 보이면 거버너가 여기서 아래로 내린다.
    for (const [quality, budget, cap] of [['low',600000,1],['mid',1600000,2],['high',2200000,2.5]] as const) {
      const ratio = renderPixelRatio({ width, height, dpr: 3, quality, touch: true });
      expect(width * height * ratio ** 2).toBeLessThanOrEqual(budget + .001);
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(cap);
    }
  }
  expect(renderPixelRatio({ width:1920, height:1080, dpr:3, quality:'high' })).toBe(2);
  expect(renderPixelRatio({ width:390, height:844, dpr:NaN })).toBe(1);
});
