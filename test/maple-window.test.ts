import { expect, test } from 'bun:test';
import { clampWindowPosition, defaultWindowPosition, hotkeyBlockedReason, isCompactViewport } from '../src/ui/maple-window.js';

const lobby = { code: 'KeyI', mode: 'lobby', stageStarting: false, modalOpen: false, dialogOpen: false, expeditionOpen: false, companionOpen: false, bootVisible: false, hubWalk: false, targetEditable: false };

test('좁은 가로 화면만 중앙 배치 모드로 판정한다', () => {
  expect(isCompactViewport(1280, 720)).toBe(false);
  expect(isCompactViewport(844, 390)).toBe(true);
  expect(isCompactViewport(640, 360)).toBe(true);
});

test('창 위치는 화면 안으로 되돌리고, 화면보다 큰 창은 여백에 붙인다', () => {
  const base = { width: 300, height: 400, viewportWidth: 1280, viewportHeight: 720 };
  expect(clampWindowPosition({ ...base, x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
  expect(clampWindowPosition({ ...base, x: 5000, y: 5000 })).toEqual({ x: 1280 - 300 - 6, y: 720 - 400 - 6 });
  expect(clampWindowPosition({ ...base, x: -50, y: -50 })).toEqual({ x: 6, y: 6 });
  expect(clampWindowPosition({ width: 900, height: 500, viewportWidth: 640, viewportHeight: 360, x: 200, y: 200 })).toEqual({ x: 6, y: 6 });
});

test('기본 자리는 왼쪽(장비) · 오른쪽(인벤토리)이 겹치지 않는다', () => {
  const size = { viewportWidth: 1280, viewportHeight: 720 };
  const left = defaultWindowPosition('left', { ...size, width: 300, height: 320 }), right = defaultWindowPosition('right', { ...size, width: 320, height: 420 });
  expect(left.x + 300).toBeLessThanOrEqual(right.x);
  expect(left.y).toBeGreaterThanOrEqual(6);
});

test('단축키는 입력창 · 다른 모달 · 전투 중에 무시하고 로비에서는 처리한다', () => {
  expect(hotkeyBlockedReason(lobby)).toBeNull();
  expect(hotkeyBlockedReason({ ...lobby, targetEditable: true })).toBe('typing');
  expect(hotkeyBlockedReason({ ...lobby, modalOpen: true })).toBe('other-modal');
  expect(hotkeyBlockedReason({ ...lobby, dialogOpen: true })).toBe('other-modal');
  expect(hotkeyBlockedReason({ ...lobby, mode: 'battle' })).toBe('not-lobby');
  expect(hotkeyBlockedReason({ ...lobby, stageStarting: true })).toBe('stage-starting');
  expect(hotkeyBlockedReason({ ...lobby, expeditionOpen: true })).toBe('other-panel');
  expect(hotkeyBlockedReason({ ...lobby, ctrl: true })).toBe('modifier');
  expect(hotkeyBlockedReason({ ...lobby, repeat: true })).toBe('modifier');
});

test('거점 걷기 중 E 는 상호작용 키라 가로채지 않고 I 는 그대로 처리한다', () => {
  expect(hotkeyBlockedReason({ ...lobby, hubWalk: true, code: 'KeyE' })).toBe('hub-interact');
  expect(hotkeyBlockedReason({ ...lobby, hubWalk: true, code: 'KeyI' })).toBeNull();
});
