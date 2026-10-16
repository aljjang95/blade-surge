import { expect, test } from 'bun:test';
import { bootStartLabel, displayState, fullscreenResultMessage } from '../src/platform/app-mode.js';

test('an installed fullscreen launch is distinct from the Fullscreen API in a browser tab', () => {
  const view: any = { matchMedia: (query: string) => ({ matches: query === '(display-mode: fullscreen)' }) };
  const doc: any = { fullscreenElement: null, fullscreenEnabled: true, documentElement: { requestFullscreen() {} } };
  expect(displayState(view, {} as any, doc)).toEqual({ appMode: true, fullscreen: false, canFullscreen: true });
  doc.fullscreenElement = doc.documentElement;
  expect(displayState(view, {} as any, doc)).toEqual({ appMode: false, fullscreen: true, canFullscreen: true });
});

test('iOS home-screen launch works without offering an unsupported fullscreen control', () => {
  const view: any = { matchMedia: () => ({ matches: false }) };
  expect(displayState(view, { standalone: true } as any, { documentElement: {} } as any)).toEqual({ appMode: true, fullscreen: false, canFullscreen: false });
  expect(displayState(view, {} as any, { documentElement: {} } as any)).toEqual({ appMode: false, fullscreen: false, canFullscreen: false });
});

test('시작 버튼은 실제 전체화면 API가 있을 때만 전체화면을 약속한다', () => {
  const browser = { appMode: false, fullscreen: false, canFullscreen: true };
  expect(bootStartLabel(browser, true)).toBe('전체화면 · 가로로 시작');
  expect(bootStartLabel({ ...browser, canFullscreen: false }, true)).toBe('터치하여 시작');
  expect(bootStartLabel(browser, false)).toBe('터치하여 시작');
  expect(bootStartLabel({ ...browser, appMode: true }, true)).toBe('터치하여 시작');
  expect(bootStartLabel({ ...browser, fullscreen: true }, true)).toBe('터치하여 시작');
});

test('전체화면 거절과 미지원은 서로 다른 실제 대안을 안내하고 성공은 안내하지 않는다', () => {
  expect(fullscreenResultMessage({ fullscreen: 'unavailable', orientation: 'unsupported' })).toContain('거절');
  const unsupported = fullscreenResultMessage({ fullscreen: 'unsupported', orientation: 'unsupported' });
  expect(unsupported).toContain('지원하지 않습니다'); expect(unsupported).toContain('홈 화면');
  expect(fullscreenResultMessage({ fullscreen: 'active', orientation: 'unavailable' })).toBe('');
  expect(fullscreenResultMessage(undefined)).toBe('');
});
