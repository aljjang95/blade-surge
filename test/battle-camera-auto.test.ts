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
  test('보스가 카메라 뒤·옆이면 정면 원뿔 경계까지만 돌리고, 앞에 있으면 그대로 둔다', () => {
    // 기본 방위에서 카메라 정면은 -z 다. 보스가 +z(카메라 뒤)에 있으면 돌려야 한다.
    const behind = autoCameraGoal(ctxOf({ boss: actor(.5, 10) }), goal());
    expect(Math.abs(behind.yaw)).toBeGreaterThan(100);
    const b = behind.yaw * Math.PI / 180, fx = -Math.sin(b), fz = -Math.cos(b), d = Math.hypot(.5, 10);
    expect(Math.acos((fx * .5 + fz * 10) / d) * 180 / Math.PI).toBeCloseTo(AUTO_CAMERA.frontCone, 3);
    // 세로 화면은 위협을 화면 세로축에 더 가깝게 세운다.
    const portrait = autoCameraGoal(ctxOf({ boss: actor(.5, 10), camera: cameraFor({ yaw: 0, pitch: 0, zoom: 100 }, 390 / 844) }), goal());
    expect(Math.abs(portrait.yaw)).toBeGreaterThan(Math.abs(behind.yaw) + 30);
    const ahead = autoCameraGoal(ctxOf({ boss: actor(2, -9) }), goal());
    expect(ahead.yaw).toBe(0);
    // 예고 중이 아닌 일반 적 무리로는 돌리지 않는다.
    expect(autoCameraGoal(ctxOf({ enemies: [actor(0, 8), actor(1, 9)] }), goal()).yaw).toBe(0);
    expect(Math.abs(autoCameraGoal(ctxOf({ enemies: [actor(0, 8, { telegraph: .6 })] }), goal()).yaw)).toBeGreaterThan(100);
  });
  test('위협이 사라지고 잠잠하면 지역 기본 시점으로 돌아간다', () => {
    const ctx = ctxOf({ base: { yaw: 25, pitch: 4, zoom: 96 }, current: { yaw: -60, pitch: 0, zoom: 100 } });
    expect(autoCameraGoal({ ...ctx, calm: 1 }, goal()).yaw).toBe(-60);
    expect(autoCameraGoal({ ...ctx, calm: AUTO_CAMERA.calmReturn }, goal()).yaw).toBe(25);
  });
  test('무리 반경·보스 크기에 맞춰 줌이 물러나고, 벽이 영웅을 가리면 내려다본다', () => {
    const tight = autoCameraGoal(ctxOf({ enemies: [actor(1, -1), actor(-1, -2)] }), goal()).zoom;
    const wide = autoCameraGoal(ctxOf({ enemies: [actor(9, -2), actor(-8, -4), actor(0, 3)] }), goal()).zoom;
    expect(tight).toBe(100); expect(wide).toBeLessThan(85);
    const bigBoss = autoCameraGoal(ctxOf({ boss: actor(0, -6, { radius: 3 }) }), goal()).zoom;
    expect(bigBoss).toBeLessThan(90); expect(bigBoss).toBeGreaterThanOrEqual(AUTO_CAMERA.bossZoomMin);
    // 카메라 쪽(+z) 바닥 2칸 뒤가 벽이다.
    const walled = autoCameraGoal(ctxOf({ walkable: (_x: number, z: number) => z < 1.5 }), goal());
    expect(walled.pitch).toBeGreaterThan(5);
    expect(autoCameraGoal(ctxOf({ walkable: () => true }), goal()).pitch).toBe(0);
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
  test('손대면 즉시 멈추고, 무입력 뒤에야 천천히 복귀하며 같은 입력이면 같은 결과다', () => {
    const run = () => {
      const auto = new BattleAutoCamera(), value = { yaw: 0, pitch: 0, zoom: 100 }, boss = actor(.5, 10), trace: number[] = [];
      auto.interrupt();
      for (let i = 0; i < 60 * 8; i++) { auto.step(1 / 60, value, ctxOf({ boss, current: value })); trace.push(value.yaw); }
      return trace;
    };
    const trace = run(), held = Math.floor(AUTO_CAMERA.resumeDelay * 60) - 1;
    expect(trace[held]).toBe(0);
    // 복귀 첫 0.3초는 아주 느리게, 이후 목표로 간다.
    expect(Math.abs(trace[held + 18])).toBeLessThan(3);
    expect(Math.abs(trace[trace.length - 1])).toBeGreaterThan(100);
    expect(run()).toEqual(trace);
    const auto = new BattleAutoCamera(); auto.resume(); expect(auto.holding).toBe(false); auto.interrupt(); expect(auto.holding).toBe(true);
    // 이동 중에는 yaw 가 더 천천히 돈다.
    const turn = (moving: boolean) => { const a = new BattleAutoCamera(), v = { yaw: 0, pitch: 0, zoom: 100 }; a.resume(); for (let i = 0; i < 120; i++) a.step(1 / 60, v, ctxOf({ boss: actor(.5, 10), current: v, moving })); return Math.abs(v.yaw); };
    expect(turn(true)).toBeLessThan(turn(false) * .7);
  });
  test('지역 방위(side)가 있어도 원뿔 판정은 실제 카메라 정면 기준이다', () => {
    const bearing = Math.atan2(3, 8.5), b = autoCameraGoal(ctxOf({ boss: actor(-3, 9), bearing }), goal());
    const rad = bearing + b.yaw * Math.PI / 180, fx = -Math.sin(rad), fz = -Math.cos(rad), d = Math.hypot(3, 9);
    expect(Math.acos((fx * -3 + fz * 9) / d) * 180 / Math.PI).toBeCloseTo(AUTO_CAMERA.frontCone, 3);
  });
  test('새 스테이지 직후에는 투영 맞춤을 쉬고 이전 속도를 버린다', () => {
    const auto = new BattleAutoCamera(); auto.resume(); auto.velocity.yaw = 50; auto.restart();
    expect(auto.velocity.yaw).toBe(0);
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
});
