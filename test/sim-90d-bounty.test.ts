import { expect, test } from 'bun:test';
import { simulate } from '../tools/sim-90d.mjs';

test('marathon seed 0: bounties fill day 1 and the run is deterministic', () => {
  const a = simulate('marathon', 0, { days: 3 }), b = simulate('marathon', 0, { days: 3 });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(a.days[0].bountyMin).toBeGreaterThan(0);
  expect(a.days[0].bountyDone).toBeGreaterThan(0);
  expect(a.days[0].hunterRank).toBeGreaterThanOrEqual(1);
  expect(a.bountyLog.length).toBeGreaterThan(0);
}, 60000);
