import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CitadelHubUI, nearInitialCollapsed } from '../src/ui/citadel-hub.js';

// 마을 걷기 입구 카드가 조이스틱(좌하)을 가려 이동이 눌리지 않던 문제: 작은 화면은 기본 접힘, 저장한 선택이 우선.
test('near card defaults collapsed on small screens and honors the stored choice', () => {
  expect(nearInitialCollapsed(null, 390, 844)).toBe(true);
  expect(nearInitialCollapsed(null, 360, 800)).toBe(true);
  expect(nearInitialCollapsed(null, 844, 390)).toBe(true);
  expect(nearInitialCollapsed(null, 740, 360)).toBe(true);
  expect(nearInitialCollapsed(null, 1024, 768)).toBe(false);
  expect(nearInitialCollapsed('0', 360, 800)).toBe(false);
  expect(nearInitialCollapsed('1', 1280, 800)).toBe(true);
});

test('toggle updates aria-expanded, label and persists only on user action', () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } });
  const attrs: Record<string, string> = {};
  const view: any = Object.assign(Object.create(CitadelHubUI.prototype), {
    root: { dataset: {} as Record<string, string> },
    nearToggle: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } });
  view.setNearCollapsed(true);
  expect(view.root.dataset.nearCollapsed).toBe('true'); expect(attrs['aria-expanded']).toBe('false'); expect(attrs['aria-label']).toBe('안내 펼치기');
  expect(store.size).toBe(0);
  view.setNearCollapsed(false, true);
  expect(view.root.dataset.nearCollapsed).toBe('false'); expect(attrs['aria-expanded']).toBe('true'); expect(attrs['aria-label']).toBe('안내 접기');
  expect(store.get('bladesurge.hubNearCollapsed')).toBe('0');
  Reflect.deleteProperty(globalThis, 'localStorage');
  expect(() => view.setNearCollapsed(true, true)).not.toThrow();
});

test('near card never captures touches over the stick and stays below it in portrait', () => {
  const css = readFileSync('src/ui/ux-pass.css', 'utf8');
  expect(css).toMatch(/\.citadel-hub-ui \.citadel-hub-near \{[^}]*pointer-events:\s*none/);
  expect(css).toMatch(/\.citadel-hub-ui \.citadel-hub-stick \{[^}]*z-index:\s*3/);
  expect(css).toMatch(/\.citadel-hub-near-toggle \{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
  expect(css).toMatch(/@media \(orientation: portrait\) \{\s*:root:root:root:root \.citadel-hub-ui \.citadel-hub-near \{[^}]*max-height:\s*82px/);
  expect(readFileSync('src/ui/citadel-hub.js', 'utf8')).toContain('aria-controls="citadel-hub-near-detail"');
});
