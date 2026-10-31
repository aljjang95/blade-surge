import { expect, test } from 'bun:test';
import { HAZARD_AUTO, hazardContains } from '../src/game/region-hazards.js';
import { RegionHazards } from '../src/game/region-hazards.js';

// THREE 장면 없이 autoEscape 만 시험한다(slots 만 채운 가짜 인스턴스).
function hazards(theme: string, disks: any[]) {
  const h: any = Object.create(RegionHazards.prototype);
  h.game = { stage: { chapter: { theme } } };
  h.slots = disks.map(d => ({ hazard: { type: 'disk', radius: 2.3, delay: 1.7, ...d }, age: d.age || 0 }));
  return h;
}
const player = (x: number, z: number) => ({ pos: { x, z }, yaw: 0 });

test('3장 원판 안이면 모든 대기 원판 밖 지점을 준다', () => {
  const h = hazards('frost', [{ x: 0, z: 0 }, { x: 4, z: 0, delay: 2.05 }]);
  const out = h.autoEscape(player(.5, 0));
  expect(out).toBeTruthy();
  for (const s of h.slots) expect(hazardContains(s.hazard, out.x, out.z)).toBe(false);
  expect(out.left).toBeCloseTo(1.7, 5);
});

test('원판 밖·터진 원판·다른 장은 null', () => {
  expect(hazards('frost', [{ x: 0, z: 0 }]).autoEscape(player(2.3 + HAZARD_AUTO.margin + .1, 0))).toBeNull();
  expect(hazards('frost', [{ x: 0, z: 0, age: 1.8 }]).autoEscape(player(0, 0))).toBeNull();
  expect(hazards('forge', [{ x: 0, z: 0 }]).autoEscape(player(0, 0))).toBeNull();
});
