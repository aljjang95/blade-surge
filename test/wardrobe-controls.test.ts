import { expect, test } from 'bun:test';
import { clampWardrobeZoom, wardrobeCameraFrame, WARDROBE_ZOOM_MAX } from '../src/expansion/wardrobe.jsx';

const frame = { offset: [0, 0, 0], scale: 1, height: 2.7, radius: 1.2 };

test('확대 배율은 1~최대 범위로 제한된다', () => {
  expect(clampWardrobeZoom(.2)).toBe(1);
  expect(clampWardrobeZoom(99)).toBe(WARDROBE_ZOOM_MAX);
  expect(clampWardrobeZoom(NaN)).toBe(1);
});

test('확대하면 카메라가 가까워지고 시선이 상반신으로 올라가며 캐릭터 안으로 들어가지 않는다', () => {
  const full = wardrobeCameraFrame(frame, 190, 330, 36, 1);
  const close = wardrobeCameraFrame(frame, 190, 330, 36, WARDROBE_ZOOM_MAX);
  expect(close.distance).toBeLessThan(full.distance);
  expect(close.lookY).toBeGreaterThan(full.lookY);
  expect(close.lookY).toBeLessThanOrEqual(frame.height * .75);
  expect(close.distance).toBeGreaterThan(frame.radius * .9);
  expect(wardrobeCameraFrame(frame, 190, 330, 36, 50).distance).toBe(close.distance);
});
