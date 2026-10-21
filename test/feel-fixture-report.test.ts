import { expect, test } from 'bun:test';
import { FRAME_MS, flinch, frozenMs, knockbackDistance, transitions, windows } from '../tools/feel-fixture-report.mjs';
import { ImpactClock } from '../src/game/combat-motion.js';

// 지표 계산이 게임 시계와 같은 규칙인지 확인한다(측정 도구가 틀리면 전후 비교 표가 거짓이 된다).
test('정지 ms 는 ImpactClock 이 실제로 멈춘 실시간과 같다', () => {
  for (const sec of [.05, .072, .12, .144]) {
    const c = new ImpactClock(); c.hitstop(sec);
    const rows: any[] = [{ stop: c.stop }]; let frozen = 0;
    for (let i = 0; i < 20; i++) { const sim = c.step(1 / 60); frozen += (1 / 60 - sim) * 1000; rows.push({ stop: c.stop }); }
    expect(frozenMs(rows)).toBeCloseTo(frozen, 6);
  }
});

test('넉백 이동은 속도 × 시간 배율 / 60 의 합', () => {
  const rows = [{ sc: 1, e: [{ kb: 6 }] }, { sc: 0, e: [{ kb: 6 }] }, { sc: .5, e: [{ kb: 3 }] }];
  expect(knockbackDistance(rows, 0)).toBeCloseTo(6 / 60 + 1.5 / 60, 9);
});

test('플린치 정점과 10% 아래로 가라앉는 시각', () => {
  const rows = [0, .2, .5, .3, .1, .04, 0].map(mr => ({ e: [{ mr }] }));
  const f = flinch(rows, 0);
  expect(f.peak).toBe(.5); expect(f.settleMs).toBeCloseTo(5 * FRAME_MS, 9);
});

test('클립 전환: 섞임 길이와 튐 비율(전환 프레임 회전 / 주변 중앙값)', () => {
  const rows: any[] = [];
  for (let f = 1; f <= 20; f++) rows.push({ f, pa: f < 10 ? 'A' : 'B', pose: f === 10 ? 30 : 5, w: f >= 10 && f < 14 ? [['A', .5], ['B', .5]] : [['x', 1]] });
  const [t] = transitions(rows);
  expect(t.from).toBe('A'); expect(t.to).toBe('B'); expect(t.popDeg).toBe(30); expect(t.popRatio).toBe(6);
  expect(t.blendMs).toBeCloseTo(5 * FRAME_MS, 9);
});

test('창 구간은 공격 시작 기준 ms 로 열고 닫힌다', () => {
  const rows = [1, 2, 3, 4, 5, 6].map(f => ({ f, cq: f >= 3 && f < 5 }));
  expect(windows(rows, 1, 7, 'cq')).toEqual([[33.3, 66.7]]);
});
