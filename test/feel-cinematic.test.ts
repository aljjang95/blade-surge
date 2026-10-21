import { expect, test } from 'bun:test';
import { FEEL, cameraKick, cinematicBeat } from '../src/game/feel.js';
import { HITSTOP_CAP } from '../src/game/combat-motion.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();
const C = FEEL.camera;

test('카메라 펀치 곡선: 0 에서 시작해 kickIn 에 정점, kickOut 뒤 정확히 0, 단조·연속, 상한', () => {
  expect(cameraKick(0, 1)).toBe(0);
  expect(cameraKick(C.kickIn, 1)).toBeCloseTo(1, 9);
  expect(cameraKick(C.kickIn + C.kickOut, 1)).toBe(0);
  expect(cameraKick(5, 1)).toBe(0);
  expect(cameraKick(-.1, 1)).toBe(0); expect(cameraKick(NaN, 1)).toBe(0); expect(cameraKick(.03, NaN)).toBe(0);
  expect(cameraKick(C.kickIn, 99)).toBeCloseTo(C.kickMax, 9);
  let prev = 0, maxStep = 0, prevT = -1;
  for (let i = 0; i <= 240; i++) {
    const t = i / 240, v = cameraKick(t, 1);
    if (t <= C.kickIn) expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
    else if (prevT > C.kickIn) expect(v).toBeLessThanOrEqual(prev + 1e-12);
    maxStep = Math.max(maxStep, Math.abs(v - prev)); prev = v; prevT = t;
  }
  // 240Hz 표본 간 변화가 정점의 9% 이하(들어가는 70ms 펀치 구간의 최대 기울기), 한 프레임에 뚝 끊기는 점프가 없다.
  expect(maxStep).toBeLessThan(.09);
  // 복귀 구간은 60fps 한 프레임에 정점의 10% 미만씩만 돌아온다(되튐 없이 미끄러지게).
  for (let t = C.kickIn; t < C.kickIn + C.kickOut; t += 1 / 60) expect(cameraKick(t, 1) - cameraKick(t + 1 / 60, 1)).toBeLessThan(.1);
});

test('연출 박자: 동작 줄이기는 정지만 남기고 슬로우·펀치를 끈다, 슬로우는 모두 복귀 구간을 가진다', () => {
  for (const kind of ['ultStart', 'ultRelease', 'bossKill']) {
    const full = cinematicBeat(kind, false)!, reduced = cinematicBeat(kind, true)!;
    expect(reduced.slowmo).toBeNull(); expect(reduced.kick).toBe(0); expect(reduced.stop).toBe(full.stop);
    if (full.slowmo) { expect(full.slowmo.ease).toBeGreaterThan(0); expect(full.slowmo.ease).toBeLessThanOrEqual(full.slowmo.sec); }
    expect(full.stop).toBeLessThanOrEqual(HITSTOP_CAP);
    expect(full.kick).toBeLessThanOrEqual(C.kickMax);
  }
  expect(cinematicBeat('nope')).toBeNull();
  // 보스 처치 펀치가 궁극기 발동보다 크다(가장 큰 박자)
  expect(cinematicBeat('bossKill')!.kick).toBeGreaterThan(cinematicBeat('ultRelease')!.kick);
});

test('실제 Battle.playBeat: 시간 시계·렌더러에 나눠 보내고, 동작 줄이기에서는 정지만', () => {
  const run = (reduced: boolean, kind: string) => {
    const f = createCombatFlowFixture(runtime, 'knight'); const kicks: number[] = [];
    f.game.app.reducedMotion.matches = reduced; (f.game.renderer as any).kick = (n: number) => kicks.push(n);
    (f.game as any).playBeat(kind);
    return { tc: f.game.timeCtl, kicks, f };
  };
  const boss = run(false, 'bossKill'), B = FEEL.cinematic.bossKill;
  expect(boss.tc.stop).toBeCloseTo(B.stop, 9); expect(boss.tc.slow).toBeCloseTo(B.scale, 9);
  expect(boss.tc.slowT).toBeCloseTo(B.sec, 9); expect(boss.tc.slowEase).toBeCloseTo(B.ease, 9); expect(boss.kicks).toEqual([B.kick]);
  const quiet = run(true, 'bossKill');
  expect(quiet.tc.stop).toBeCloseTo(B.stop, 9); expect(quiet.tc.slowT).toBe(0); expect(quiet.kicks).toEqual([]);
  // 슬로우가 끝날 때 배율이 1 로 이어진다(복귀 구간 마지막 프레임의 시뮬레이션 속도가 0.9 이상)
  const f = boss.f; let lastScale = 0;
  for (let i = 0; i < 200 && (f.game.timeCtl.slowT > 0 || f.game.timeCtl.stop > 0); i++) { stepCombatFlow(f, 1 / 60); if (f.game.timeCtl.slowT > 0) lastScale = f.game.timeCtl.scale; }
  expect(lastScale).toBeGreaterThan(.9);
});

test('실제 Player 궁극기: 시전 순간에만 ultRelease 가 한 번 불린다(일반 스킬은 아님)', () => {
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player; const calls: any[] = [];
  (f.game as any).ultRelease = (who: any) => calls.push(who);
  (f.game as any).ultCinematic = () => {};
  const ultIdx = p.def.skills.findIndex((s: any) => s.ult);
  p.ult = p.ultMax; p.heroLevel = 99; p.skillLevels[ultIdx] = 1;
  expect(p.tryCastSkill(ultIdx)).toBe(true);
  for (let i = 0; i < 240 && p.state === 'ult'; i++) stepCombatFlow(f, 1 / 60);
  expect(calls).toEqual([p]);
  const g = createCombatFlowFixture(runtime, 'knight'), q: any = g.player; const other: any[] = [];
  (g.game as any).ultRelease = (who: any) => other.push(who);
  expect(q.tryCastSkill(0)).toBe(true);
  for (let i = 0; i < 240 && q.state === 'skill'; i++) stepCombatFlow(g, 1 / 60);
  expect(other).toEqual([]);
});
