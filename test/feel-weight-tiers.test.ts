import { expect, test } from 'bun:test';
import { FEEL, hitWeight, knockbackDecay, knockbackTravel, weightedHitstop } from '../src/game/feel.js';
import { HITSTOP_CAP, ImpactClock } from '../src/game/combat-motion.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();
const B = FEEL.hitstop.base;
const ms = (s: number) => Math.round(s * 1000);

test('히트스톱 등급: 경타·평타 < 치명타 < 강타 < 반격 < 마무리, 평타 리듬은 60ms 이하', () => {
  const order = [B.light, B.basic, B.crit, B.heavy, B.counter, B.finisher];
  for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  expect(ms(B.basic)).toBeLessThanOrEqual(60);
  expect(B.crit - B.basic).toBeGreaterThanOrEqual(.02);   // 치명타가 평타와 손으로 구분되는 차이(1프레임 이상)
  expect(B.received).toBeGreaterThan(B.basic);
  expect(FEEL.hitstop.max).toBeLessThan(HITSTOP_CAP);
});

test('처치 타격은 등급 기본보다 무겁고 레퍼런스 구간(처치 120–180ms)에 든다', () => {
  const kill = hitWeight({ killed: true });
  // 졸개 평타 처치: 평타보다 길지만 경타 리듬을 끊지 않을 만큼
  const basicKill = weightedHitstop(B.basic, kill);
  expect(basicKill).toBeGreaterThan(B.basic); expect(ms(basicKill)).toBeLessThanOrEqual(70);
  // 마무리 처치, 정예 마무리 처치
  const finisherKill = weightedHitstop(B.finisher, kill);
  expect(ms(finisherKill)).toBeGreaterThanOrEqual(120); expect(ms(finisherKill)).toBeLessThanOrEqual(180);
  const eliteKill = weightedHitstop(B.finisher, hitWeight({ killed: true, elite: true }));
  expect(eliteKill).toBe(FEEL.hitstop.max);
  expect(ms(eliteKill)).toBeLessThanOrEqual(180);
});

test('정지 시계가 등급 정지를 실제 프레임으로 소비한다(60fps 기준 프레임 수)', () => {
  const frames = (sec: number) => { const c = new ImpactClock(); c.hitstop(sec); let n = 0; for (let i = 0; i < 30; i++) if (c.step(1 / 60) < 1 / 60 - 1e-9) n++; return n; };
  expect(frames(B.basic)).toBe(3);
  expect(frames(B.crit)).toBe(5);
  expect(frames(weightedHitstop(B.finisher, hitWeight({ killed: true })))).toBe(9);
});

test('넉백 곡선: 지수 마찰, 프레임 크기와 무관, 총 이동은 v/-ln(keep)', () => {
  expect(knockbackDecay(0)).toBe(1);
  expect(knockbackDecay(1)).toBeCloseTo(FEEL.knockback.keep, 10);
  expect(knockbackDecay(NaN)).toBe(1);
  const travel = (v: number, dt: number) => { let x = 0; for (let t = 0; t < 4; t += dt) { x += v * dt; v *= knockbackDecay(dt); } return x; };
  // 오일러 적분은 dt 만큼 앞서므로 해석값과 dt 크기 오차 안에서 같다.
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) expect(Math.abs(travel(5, dt) - knockbackTravel(5))).toBeLessThan(5 * dt + 1e-3);
  expect(knockbackTravel(5)).toBeCloseTo(5 / Math.log(50), 6);
  // 마찰 반감기 0.18초 안팎: 0.3초 뒤 속도는 처음의 30% 아래
  expect(knockbackDecay(.3)).toBeLessThan(.31);
  expect(knockbackTravel(-1)).toBe(0);
});

test('적 넉백(실제 Actor.update)은 히트스톱(dt 0) 동안 멈추고 풀리면 해석 거리만큼 간다', () => {
  const f = createCombatFlowFixture(runtime, 'knight');
  const e: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 2);
  e.alive = false; e.state = 'dead';   // AI 이동 없이 Actor 의 넉백 적분만 남긴다
  const x0 = e.pos.x; e.knockback(1, 0, 4);
  for (let i = 0; i < 6; i++) e.update(0);
  expect(e.pos.x).toBe(x0);
  for (let i = 0; i < 240; i++) e.update(1 / 60);
  expect(e.pos.x - x0).toBeGreaterThan(knockbackTravel(4) - .1);
  expect(e.pos.x - x0).toBeLessThan(knockbackTravel(4) + .1);
});

test('영웅이 강타(kb≥6)를 맞으면 짧게 정지하고, 경타·동작 줄이기·무적은 정지하지 않는다', () => {
  const heavy = createCombatFlowFixture(runtime, 'knight');
  expect(heavy.player.hurt(20, { dirz: 1, kb: 7 })).toBe(true);
  expect(heavy.game.timeCtl.stop).toBeCloseTo(B.received, 6);
  expect(heavy.player.state).toBe('hurt');
  // 정지 동안 시뮬레이션 시간이 흐르지 않는다
  const before = heavy.game.elapsed; stepCombatFlow(heavy, 1 / 60); expect(heavy.game.elapsed).toBe(before);

  const light = createCombatFlowFixture(runtime, 'knight');
  expect(light.player.hurt(20, { dirz: 1, kb: 2 })).toBe(true);
  expect(light.game.timeCtl.stop).toBe(0);

  const reduced = createCombatFlowFixture(runtime, 'knight');
  reduced.game.app.reducedMotion.matches = true;
  expect(reduced.player.hurt(20, { dirz: 1, kb: 7 })).toBe(true);
  expect(reduced.game.timeCtl.stop).toBe(0);

  const dodging = createCombatFlowFixture(runtime, 'knight');
  dodging.player.invuln = 1;
  expect(dodging.player.hurt(20, { dirz: 1, kb: 7 })).toBe(false);
  expect(dodging.game.timeCtl.stop).toBe(0);
});

test('영웅 달리기 재생 배율은 실제 이동 속도를 따라가 디딤발 미끄러짐 비를 목표값으로 맞춘다', async () => {
  const { heroRunTempo } = await import('../src/game/feel.js');
  const L = FEEL.locomotion;
  for (const [id, stride] of Object.entries(L.heroRunStride)) {
    for (const speed of [5.6, 7.2, 9]) {
      const ts = heroRunTempo(id, speed);
      if (ts > L.min && ts < L.max) expect(speed / (stride * ts)).toBeCloseTo(L.targetSlide, 6);
    }
    expect(heroRunTempo(id, 1000)).toBe(L.max); expect(heroRunTempo(id, .1)).toBe(L.min);
  }
  // 실측 보폭이 없는 영웅은 예전 고정 배율
  expect(heroRunTempo('unknown', 6, 0)).toBeCloseTo(1.1, 9); expect(heroRunTempo('unknown', 6, 1)).toBeCloseTo(1.45, 9);
  // 실제 Player.handleInput 경로: 걷기 시작과 질주에서 같은 미끄러짐 비
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player, dt = 1 / 60;
  f.game.input.move.x = 1;
  p.handleInput(f.game.input, dt);
  const first = p.vel.length() / (L.heroRunStride.knight * p.action.timeScale);
  for (let i = 0; i < 120; i++) p.handleInput(f.game.input, dt);
  expect(p.sprint).toBe(1);
  const sprint = p.vel.length() / (L.heroRunStride.knight * p.action.timeScale);
  expect(first).toBeCloseTo(L.targetSlide, 3); expect(sprint).toBeCloseTo(L.targetSlide, 3);
});
