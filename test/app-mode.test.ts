import { expect, test } from 'bun:test';
import { displayState } from '../src/platform/app-mode.js';

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
