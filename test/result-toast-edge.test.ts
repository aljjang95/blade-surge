import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { UI } from '../src/ui/ui.js';

// 세로 결과 화면의 알림 띠(첫 클리어 보상 등)는 VICTORY·카드가 아니라 바닥 행동 줄 바로 위에 선다.
const g: any = globalThis;
const saved = { matchMedia: g.matchMedia, innerHeight: g.innerHeight };
afterEach(() => { g.matchMedia = saved.matchMedia; g.innerHeight = saved.innerHeight; });

function fakeUi(portrait: boolean, rects: { top: number, height: number }[]) {
  g.matchMedia = (q: string) => ({ matches: q.includes('portrait') ? portrait : false });
  g.innerHeight = 844;
  const props = new Map<string, string>();
  const layer = { style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) } };
  const result = { querySelectorAll: () => rects.map((r) => ({ getBoundingClientRect: () => r })) };
  const ui: any = Object.assign(Object.create(UI.prototype), { el: { toast: layer, result } });
  return { ui, props };
}

test('세로: 소환 권유·행동 줄 중 가장 위쪽 바로 위에 알림을 둔다', () => {
  const { ui, props } = fakeUi(true, [{ top: 676, height: 52 }, { top: 742, height: 86 }]);
  ui.placeResultToasts();
  expect(props.get('--result-toast-bottom')).toBe(`${844 - 676 + 6}px`);
});

test('세로: 숨은 버튼(높이 0)은 건너뛰고, 잴 것이 없으면 CSS 기본값으로 돌아간다', () => {
  const a = fakeUi(true, [{ top: 0, height: 0 }, { top: 742, height: 86 }]);
  a.ui.placeResultToasts();
  expect(a.props.get('--result-toast-bottom')).toBe(`${844 - 742 + 6}px`);
  const b = fakeUi(true, []);
  b.props.set('--result-toast-bottom', '99px');
  b.ui.placeResultToasts();
  expect(b.props.has('--result-toast-bottom')).toBe(false);
});

test('가로: 변수를 지우고 density-result.css 고정 규칙에 맡긴다', () => {
  const { ui, props } = fakeUi(false, [{ top: 300, height: 48 }]);
  props.set('--result-toast-bottom', '99px');
  ui.placeResultToasts();
  expect(props.has('--result-toast-bottom')).toBe(false);
});

test('세로 CSS: 결과 화면에서 알림 띠를 위(top)가 아니라 바닥 변수에 붙인다', () => {
  const css = readFileSync(new URL('../src/ui/clear-loop.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = css.slice(css.indexOf('@media (orientation: portrait)'));
  expect(block).toContain('body:has(#result.show) #toast-layer');
  expect(block).toMatch(/top:\s*auto/);
  expect(block).toContain('var(--result-toast-bottom');
});
