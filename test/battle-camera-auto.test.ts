import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { AUTO_CAMERA, BattleAutoCamera, autoCameraGoal, criticalStep, wrapDegrees } from '../src/engine/battle-camera-auto.js';
import { battleCameraOffset } from '../src/engine/camera-control.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save-base.js';

const actor = (x: number, z: number, extra: Record<string, unknown> = {}) => ({ alive: true, spawning: false, pos: new THREE.Vector3(x, 0, z), radius: .7, telegraph: 0, ...extra });
const ctxOf = (extra: Record<string, unknown> = {}) => ({ player: actor(0, 0), enemies: [], boss: null, base: { yaw: 0, pitch: 0, zoom: 100 },
  current: { yaw: 0, pitch: 0, zoom: 100 }, bearing: 0, walkable: null, camera: null, calm: 0, ...extra });
const goal = () => ({ yaw: 0, pitch: 0, zoom: 100, threat: null });
// 실제 렌더러와 같은 배치: 기본 오프셋을 사용자 값으로 돌린 위치에서 영웅 위를 본다.
const cameraFor = (value: { yaw: number, pitch: number, zoom: number }, aspect = 915 / 412) => {
  const cam = new THREE.PerspectiveCamera(46, aspect, .1, 120), off = battleCameraOffset({ x: 0, y: 12.5, z: 8.5 }, value);
  cam.position.set(off.x, off.y, off.z); cam.lookAt(0, 1, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  return cam;
};

describe('전투 카메라 AUTO', () => {
  test('임계 감쇠 스프링은 넘치지 않고 수렴하며 최대 속도를 지킨다', () => {
    const state = { v: 0 }; let x = 0, peak = 0;
    for (let i = 0; i < 600; i++) { const prev = x; x = criticalStep(x, 90, state, 'v', 3, 1 / 60, 70); peak = Math.max(peak, x); expect(Math.abs(x - prev)).toBeLessThanOrEqual(70 / 60 + 1e-9); }
    expect(peak).toBeLessThanOrEqual(90 + 1e-9); expect(x).toBeCloseTo(90, 3);
    expect(wrapDegrees(190)).toBe(-170); expect(wrapDegrees(-540)).toBe(-180);
  });
  test('기본 설정은 고정 쿼터뷰다: 위협 추적과 무리 줌이 꺼져 있다', () => {
    expect(AUTO_CAMERA.followThreat).toBe(false); expect(AUTO_CAMERA.crowdZoom).toBe(false);
    expect(AUTO_CAMERA.yawMaxRate).toBeLessThanOrEqual(30);
  });
  test('보스·예고 적이 카메라 뒤에 있어도 전투 중에는 yaw 가 current 그대로다', () => {
    const current = { yaw: 17, pitch: 0, zoom: 100 };
    const behind = autoCameraGoal(ctxOf({ boss: actor(.5, 10), current }), goal());
    expect(behind.yaw).toBe(17); expect(behind.engaged).toBe(true);
    const telegraph = autoCameraGoal(ctxOf({ enemies: [actor(0, 8, { telegraph: .6 })], current }), goal());
    expect(telegraph.yaw).toBe(17); expect(telegraph.engaged).toBe(true);
    expect(autoCameraGoal(ctxOf({ boss: actor(2, -9) }), goal()).yaw).toBe(0);
  });
  test('followThreat:true 로 바꾸면 옛 원뿔 동작이 살아 있다', () => {
    const cfg = { ...AUTO_CAMERA, followThreat: true } as any;
    const behind = autoCameraGoal(ctxOf({ boss: actor(.5, 10) }), goal(), cfg);
    expect(Math.abs(behind.yaw)).toBeGreaterThan(100);
    const b = behind.yaw * Math.PI / 180, fx = -Math.sin(b), fz = -Math.cos(b), d = Math.hypot(.5, 10);
    expect(Math.acos((fx * .5 + fz * 10) / d) * 180 / Math.PI).toBeCloseTo(cfg.frontCone, 3);
    const portrait = autoCameraGoal(ctxOf({ boss: actor(.5, 10), camera: cameraFor({ yaw: 0, pitch: 0, zoom: 100 }, 390 / 844) }), goal(), cfg);
    expect(Math.abs(portrait.yaw)).toBeGreaterThan(Math.abs(behind.yaw) + 30);
    expect(autoCameraGoal(ctxOf({ boss: actor(2, -9) }), goal(), cfg).yaw).toBe(0);
    expect(autoCameraGoal(ctxOf({ enemies: [actor(0, 8), actor(1, 9)] }), goal(), cfg).yaw).toBe(0);
    expect(Math.abs(autoCameraGoal(ctxOf({ enemies: [actor(0, 8, { telegraph: .6 })] }), goal(), cfg).yaw)).toBeGreaterThan(100);
    // 지역 방위(side)가 있어도 원뿔 판정은 실제 카메라 정면 기준이다.
    const bearing = Math.atan2(3, 8.5), s = autoCameraGoal(ctxOf({ boss: actor(-3, 9), bearing }), goal(), cfg);
    const rad = bearing + s.yaw * Math.PI / 180, sx = -Math.sin(rad), sz = -Math.cos(rad), sd = Math.hypot(3, 9);
    expect(Math.acos((sx * -3 + sz * 9) / sd) * 180 / Math.PI).toBeCloseTo(cfg.frontCone, 3);
  });
  test('engaged 는 보스 사거리 안이거나 threatRange 안에 적이 있을 때만 true 다', () => {
    expect(autoCameraGoal(ctxOf(), goal()).engaged).toBe(false);
    expect(autoCameraGoal(ctxOf({ enemies: [actor(0, 8)] }), goal()).engaged).toBe(true);
    expect(autoCameraGoal(ctxOf({ enemies: [actor(0, AUTO_CAMERA.threatRange + 3)] }), goal()).engaged).toBe(false);
    expect(autoCameraGoal(ctxOf({ boss: actor(0, AUTO_CAMERA.bossRange - 2) }), goal()).engaged).toBe(true);
    expect(autoCameraGoal(ctxOf({ boss: actor(0, AUTO_CAMERA.bossRange + 5) }), goal()).engaged).toBe(false);
    expect(autoCameraGoal(ctxOf({ boss: actor(0, 5, { alive: false }) }), goal()).engaged).toBe(false);
  });
  test('위협이 사라지고 잠잠하면 지역 기본 시점으로 돌아간다', () => {
    const ctx = ctxOf({ base: { yaw: 25, pitch: 4, zoom: 96 }, current: { yaw: -60, pitch: 0, zoom: 100 } });
    expect(autoCameraGoal({ ...ctx, calm: 1 }, goal()).yaw).toBe(-60);
    expect(autoCameraGoal({ ...ctx, calm: AUTO_CAMERA.calmReturn }, goal()).yaw).toBe(25);
  });
  test('적이 주변에 있으면(예고 없어도) calm 이 0 으로 유지되고 사용자가 돌린 yaw 는 기본 방위로 돌아가지 않는다', () => {
    const auto = new BattleAutoCamera(), value = { yaw: -60, pitch: 0, zoom: 100 }; auto.resume(); auto.calm = 0;
    for (let i = 0; i < 60 * 10; i++) { auto.step(1 / 60, value, ctxOf({ enemies: [actor(2, -4), actor(-3, -6)], current: value })); expect(auto.calm).toBe(0); }
    expect(value.yaw).toBe(-60);
  });
  test('적이 없고 calmReturn 이 지나면 base.yaw 로 천천히(yawMaxRate 이하) 돌아간다', () => {
    const auto = new BattleAutoCamera(), value = { yaw: -60, pitch: 0, zoom: 100 }; auto.resume(); auto.calm = 0;
    let prev = value.yaw, maxStep = 0, early = 0;
    for (let i = 0; i < 60 * 20; i++) {
      auto.step(1 / 60, value, ctxOf({ current: value }));
      maxStep = Math.max(maxStep, Math.abs(value.yaw - prev)); prev = value.yaw;
      if (i === Math.floor(AUTO_CAMERA.calmReturn * 60) - 6) early = value.yaw;
    }
    expect(early).toBe(-60);
    expect(maxStep).toBeLessThanOrEqual(AUTO_CAMERA.yawMaxRate / 60 + 1e-9); expect(maxStep).toBeGreaterThan(0);
    expect(Math.abs(value.yaw)).toBeLessThan(1);
  });
  test('무리 퍼짐으로 줌이 바뀌지 않고, 벽이 영웅을 가리면 내려다본다', () => {
    const tight = autoCameraGoal(ctxOf({ enemies: [actor(1, -1), actor(-1, -2)] }), goal()).zoom;
    const wide = autoCameraGoal(ctxOf({ enemies: [actor(9, -2), actor(-8, -4), actor(0, 3)] }), goal()).zoom;
    expect(tight).toBe(AUTO_CAMERA.steadyZoom); expect(wide).toBe(AUTO_CAMERA.steadyZoom);
    expect(autoCameraGoal(ctxOf({ base: { yaw: 0, pitch: 0, zoom: 90 }, enemies: [actor(9, -2), actor(-8, -4)] }), goal()).zoom).toBeCloseTo(90 * AUTO_CAMERA.steadyZoom / 100, 9);
    // 카메라 쪽(+z) 바닥 2칸 뒤가 벽이다.
    const walled = autoCameraGoal(ctxOf({ walkable: (_x: number, z: number) => z < 1.5 }), goal());
    expect(walled.pitch).toBeGreaterThan(AUTO_CAMERA.steadyPitch + 5);
    expect(autoCameraGoal(ctxOf({ walkable: () => true }), goal()).pitch).toBe(AUTO_CAMERA.steadyPitch);
  });
  test('보스 예고 범위가 화면 밖으로 넘치면 투영 기준으로 줌을 줄여 안전 상자 안에 넣는다', () => {
    const boss = actor(9, -4, { radius: 1.6 });
    let value = { yaw: 0, pitch: 0, zoom: 130 };
    const auto = new BattleAutoCamera(); auto.resume();
    for (let i = 0; i < 360; i++) auto.step(1 / 60, value, ctxOf({ boss, current: value, camera: cameraFor(value) }));
    const cam = cameraFor(value), reach = AUTO_CAMERA.bossReach + boss.radius;
    for (const [x, z] of [[boss.pos.x + reach, boss.pos.z], [boss.pos.x - reach, boss.pos.z], [boss.pos.x, boss.pos.z + reach], [boss.pos.x, boss.pos.z - reach]]) {
      const p = new THREE.Vector3(x, 0, z).project(cam);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1); expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
    expect(value.zoom).toBeLessThan(130);
  });
  test('보스전 중 한 번 줄어든 줌은 보스가 화면 가운데로 와도 커지지 않고, 보스가 죽고 잠잠해지면 풀린다', () => {
    const auto = new BattleAutoCamera(), value = { yaw: 0, pitch: 0, zoom: 130 }; auto.resume();
    const boss = actor(9, -4, { radius: 1.6 });
    let prev = Infinity, low = Infinity;
    const run = (seconds: number, at: [number, number]) => {
      boss.pos.set(at[0], 0, at[1]);
      for (let i = 0; i < 60 * seconds; i++) {
        auto.step(1 / 60, value, ctxOf({ boss, current: value, camera: cameraFor(value) }));
        expect(auto.goal.zoom).toBeLessThanOrEqual(prev + 1e-9); prev = auto.goal.zoom; low = Math.min(low, value.zoom);
      }
    };
    run(6, [9, -4]); const shrunk = auto.goal.zoom;
    expect(shrunk).toBeLessThan(100); expect(auto.bossZoom).toBe(shrunk);
    run(6, [0, -6]);
    expect(auto.goal.zoom).toBeLessThanOrEqual(shrunk); expect(value.zoom).toBeLessThanOrEqual(130);
    // 보스가 죽으면 calmReturn 이 지나기 전에도 줌이 풀리거나, 늦어도 지난 뒤에는 반드시 풀려 base 로 돌아온다.
    boss.alive = false;
    for (let i = 0; i < 60 * (AUTO_CAMERA.calmReturn + 1); i++) auto.step(1 / 60, value, ctxOf({ boss, current: value, camera: cameraFor(value) }));
    expect(auto.bossZoom).toBeNull();
    for (let i = 0; i < 60 * 25; i++) auto.step(1 / 60, value, ctxOf({ boss, current: value, camera: cameraFor(value) }));
    expect(value.zoom).toBeCloseTo(AUTO_CAMERA.steadyZoom, 0);
  });
  test('일반 적이 예고 중이어도 투영 맞춤 줌이 걸리지 않는다', () => {
    const v = { yaw: 0, pitch: 0, zoom: 130 };
    const g = autoCameraGoal(ctxOf({ enemies: [actor(11, -6, { telegraph: .8, radius: 2 })], current: v, camera: cameraFor(v) }), goal());
    expect(g.zoom).toBe(AUTO_CAMERA.steadyZoom); expect(g.threat).not.toBeNull();
  });
  test('손대면 즉시 멈추고, 무입력 뒤에야 천천히 복귀하며 같은 입력이면 같은 결과다', () => {
    // 사용자가 yaw 를 -60 으로 돌린 뒤 적이 없는 상황.
    const run = () => {
      const auto = new BattleAutoCamera(), value = { yaw: -60, pitch: 0, zoom: 100 }, trace: number[] = [];
      auto.interrupt();
      for (let i = 0; i < 60 * 10; i++) { auto.step(1 / 60, value, ctxOf({ current: value })); trace.push(value.yaw); }
      return trace;
    };
    const trace = run(), held = Math.floor(AUTO_CAMERA.resumeDelay * 60) - 1;
    expect(trace[held]).toBe(-60);
    // 복귀 첫 0.3초는 아주 느리게, 이후 기본 방위 쪽으로 간다.
    expect(Math.abs(trace[held + 18] + 60)).toBeLessThan(3);
    expect(trace[trace.length - 1]).toBeGreaterThan(-60 + 10);
    for (let i = 1; i < trace.length; i++) expect(Math.abs(trace[i] - trace[i - 1])).toBeLessThanOrEqual(AUTO_CAMERA.yawMaxRate / 60 + 1e-9);
    expect(run()).toEqual(trace);
    const auto = new BattleAutoCamera(); auto.resume(); expect(auto.holding).toBe(false); auto.interrupt(); expect(auto.holding).toBe(true);
    // 이동 중에는 yaw 가 더 천천히 돈다.
    const turn = (moving: boolean) => { const a = new BattleAutoCamera(), v = { yaw: -60, pitch: 0, zoom: 100 }; a.resume(); for (let i = 0; i < 120; i++) a.step(1 / 60, v, ctxOf({ current: v, moving })); return Math.abs(v.yaw + 60); };
    expect(turn(false)).toBeGreaterThan(0); expect(turn(true)).toBeLessThan(turn(false) * .7);
  });
  test('새 스테이지 직후에는 투영 맞춤을 쉬고 이전 속도와 bossZoom 을 버린다', () => {
    const auto = new BattleAutoCamera(); auto.resume(); auto.velocity.yaw = 50; auto.bossZoom = 75; auto.restart();
    expect(auto.velocity.yaw).toBe(0); expect(auto.bossZoom).toBeNull();
    const v = { yaw: 0, pitch: 0, zoom: 130 }, boss = actor(9, -4, { radius: 1.6 });
    auto.step(1 / 60, v, ctxOf({ boss, current: v, camera: cameraFor(v) }));
    expect(auto.goal.zoom).toBeGreaterThan(80);
  });
  test('AUTO 설정은 기본 켬, 이전 저장은 켬으로 이관, 끈 값은 보존된다', () => {
    const fresh = new Economy().s; expect(fresh.settings.cameraAuto).toBe(true);
    const legacy = structuredClone(fresh); delete legacy.settings.cameraAuto;
    expect(normalizeSave(legacy, new Economy().s).settings.cameraAuto).toBe(true);
    const off = structuredClone(fresh); off.settings.cameraAuto = false;
    expect(normalizeSave(off, new Economy().s).settings.cameraAuto).toBe(false);
    const bad = structuredClone(fresh); bad.settings.cameraAuto = 'no' as any;
    expect(normalizeSave(bad, new Economy().s).settings.cameraAuto).toBe(true);
  });
  test('다른 보스가 나오면 앞 보스의 물러난 줌을 이어받지 않는다', () => {
    const auto = new BattleAutoCamera(); auto.resume();
    const first = actor(9, -4, { radius: 1.6 }), value = { yaw: 0, pitch: 0, zoom: 100 };
    for (let i = 0; i < 240; i++) auto.step(1 / 60, value, ctxOf({ boss: first, current: value, camera: cameraFor(value) }));
    expect(auto.bossZoom).not.toBeNull();
    const next = actor(0, -3, { radius: .6 });
    auto.step(1 / 60, value, ctxOf({ boss: next, enemies: [actor(1, -1)], current: value, camera: cameraFor(value) }));
    expect(auto.bossRef).toBe(next);
    expect(auto.goal.zoom).toBeGreaterThanOrEqual(AUTO_CAMERA.steadyZoom - 1e-9);
  });
});
