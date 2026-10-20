import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Renderer } from '../src/engine/renderer.js';
import { Actor } from '../src/game/actor.js';
import { Enemy } from '../src/game/enemies.js';
import { Battle as RpgBattle } from '../src/game/rpg-battle.js';
import { FX } from '../src/engine/fx.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';

const noop = () => {};

function rendererFixture(extra: Record<string, unknown> = {}) {
  const r: any = Object.assign(Object.create(Renderer.prototype), {
    camera: new THREE.PerspectiveCamera(43, 880 / 400, .1, 120), _width: 880, _height: 400, battleMinimumAspect: 0,
    rig: { target: new THREE.Vector3(2, 0, -4), pos: new THREE.Vector3(2, 6.8, 4.4), offset: new THREE.Vector3(0, 6.8, 8.4),
      lookOffset: new THREE.Vector3(0, 1.1, 0), side: 0, mode: 'battle', fov: 43, lag: 7.5, trauma: 0, zoom: 0, base: { y: 6.8, z: 8.4, fov: 43 } },
    battleCamera: { yaw: 0, pitch: 0, zoom: 100 }, battleOcclusion: { update: noop }, time: 0, flash: 0, aberr: 0, radial: 0, desat: 0,
    quality: 'high', postFxEnabled: true,
    u: Object.fromEntries(['uFlash', 'uAberr', 'uRadial', 'uDesat', 'uTime'].map(key => [key, { value: 0 }])), ...extra,
  });
  r.u.uFlashColor = { value: new THREE.Color() };
  for (let i = 0; i < 30; i++) r.update(1 / 60, 1 / 60);   // 카메라 보간이 정착한 구도
  return r;
}

test('타격 shake·punch 호출은 카메라 위치·FOV를 한 프레임도 바꾸지 않는다(줌 펄스·킥 없음)', () => {
  const r = rendererFixture(), quiet = rendererFixture();
  const fov = r.camera.fov;
  for (let i = 0; i < 40; i++) {
    if (i % 3 === 0) { r.shake(1, 1, 0); r.punch(2); }
    r.update(1 / 60, 1 / 60); quiet.update(1 / 60, 1 / 60);
    expect(r.camera.position.distanceTo(r.rig.pos)).toBe(0);
    expect(r.camera.position.distanceTo(quiet.camera.position)).toBe(0);
    expect(r.camera.fov).toBe(fov);
  }
});

test('사용자 드래그·핀치 시점 값은 연속 타격 중에도 그대로 반영되고 되튀지 않는다', () => {
  const user = { yaw: 35, pitch: 8, zoom: 125 };
  const hit = rendererFixture({ battleCamera: { ...user } }), calm = rendererFixture({ battleCamera: { ...user } });
  for (let i = 0; i < 60; i++) { hit.shake(.8, 0, 1); hit.punch(1.5); hit.update(1 / 60, 1 / 60); calm.update(1 / 60, 1 / 60); }
  expect(hit.battleCamera).toEqual(user);
  expect(hit.camera.position.distanceTo(calm.camera.position)).toBe(0);
  expect(hit.camera.fov).toBe(calm.camera.fov);
});

test('동작 줄이기는 색수차·방사형 블러·강한 플래시를 끈다', () => {
  const reduced = rendererFixture({ postFxEnabled: false });
  reduced.aberr = 2; reduced.radial = .6; reduced.flashScreen(.9, 0xffffff); reduced.update(1 / 60, 1 / 60);
  expect(reduced.u.uAberr.value).toBe(0); expect(reduced.u.uRadial.value).toBe(0); expect(reduced.u.uFlash.value).toBeLessThanOrEqual(.25);
});

test('색수차·방사형 블러·플래시는 상한 안에서만 올라가고 낮은 화질은 방사형 블러를 끈다', () => {
  const r = rendererFixture();
  r.aberr = 50; r.radial = 50; r.flashScreen(9, 0xffffff); r.update(0, 0);
  expect(r.u.uAberr.value).toBeGreaterThan(0); expect(r.u.uAberr.value).toBeLessThanOrEqual(.025);
  expect(r.u.uRadial.value).toBeGreaterThan(0); expect(r.u.uRadial.value).toBeLessThanOrEqual(.07);
  expect(r.u.uFlash.value).toBeGreaterThan(.25); expect(r.u.uFlash.value).toBeLessThanOrEqual(.6);
  const low = rendererFixture({ quality: 'low' });
  low.aberr = 1; low.radial = .5; low.update(0, 0);
  expect(low.u.uAberr.value).toBeGreaterThan(0); expect(low.u.uRadial.value).toBe(0);
});

test('화면 흔들림 설정은 직접 고른 true/false 만 저장하고 미선택·손상 값은 null 로 둔다', () => {
  const values = new Map<string, string>(), previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  try {
    const fresh = new Economy().s;
    expect(fresh.settings.screenShake).toBeNull();
    for (const [input, expected] of [[true, true], [false, false], [undefined, null], ['yes', null], [1, null], [null, null]] as const) {
      const raw = structuredClone(fresh); raw.settings.screenShake = input as any;
      expect(normalizeSave(raw, new Economy().s).settings.screenShake).toBe(expected);
    }
    // 이 필드가 없던 기존 저장도 다른 설정을 유지한 채 열린다
    const legacy = structuredClone(fresh); delete legacy.settings.screenShake; legacy.settings.music = false;
    const migrated = normalizeSave(legacy, new Economy().s);
    expect(migrated.settings.screenShake).toBeNull(); expect(migrated.settings.music).toBe(false);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('처치 연출은 렌더 피벗만 위로 튀며 돌고 끝나면 정확히 제자리로 돌아오며 게임 난수를 쓰지 않는다', () => {
  const actor: any = Object.assign(Object.create(Actor.prototype), {
    motionRoot: new THREE.Group(), game: { app: { reducedMotion: { matches: false } } }, state: 'dead', launchT: -1, launchH: 0, launchTilt: 0, launchSpin: 0, mixer: { update: noop },
  });
  const random = Math.random; let calls = 0;
  Math.random = () => { calls++; return .5; };
  try {
    actor.launchOnKill(1.3);
    let peak = 0;
    for (let i = 0; i < 20; i++) { Actor.prototype.updateCombatPose.call(actor, 1 / 60); peak = Math.max(peak, actor.motionRoot.position.y); }
    expect(peak).toBeGreaterThan(.8); expect(peak).toBeLessThan(2.4);   // 보이지만 화면 밖으로 날아가지 않는다
    for (let i = 0; i < 30; i++) Actor.prototype.updateCombatPose.call(actor, 1 / 60);
    expect(actor.launchT).toBe(-1);
    expect(actor.motionRoot.position.y).toBe(0); expect(actor.motionRoot.rotation.y).toBe(0); expect(actor.motionRoot.rotation.x).toBe(0);
    expect(calls).toBe(0);
    // 동작 줄이기에서는 시작조차 하지 않는다
    actor.game.app.reducedMotion.matches = true; actor.launchOnKill(1);
    expect(actor.launchT).toBe(-1);
  } finally { Math.random = random; }
});

test('처치 연출은 마무리타·치명타·스킬 처치에만 일반 몹에게 걸리고 보스·정예·일반 평타 처치는 제외한다', () => {
  const run = (flair: { crit?: boolean; finisher?: boolean } | null, extra: Record<string, unknown> = {}) => {
    let launched = 0, flashed = 0;
    const enemy: any = { gatherT: 0, gatherBlockT: 0, clearDashWarning: noop, clearSupportCast: noop, signatures: null, mobRole: null,
      die: noop, kb: new THREE.Vector3(), eyeMat: null, isBoss: false, isElite: false, launchOnKill: () => launched++, flash: () => flashed++,
      game: { onEnemyDeath: noop }, ...extra };
    (Enemy.prototype.kill as any).call(enemy, 1, 0, 6, flair);
    return { launched, flashed, flair: enemy.killFlair };
  };
  expect(run({ finisher: true })).toEqual({ launched: 1, flashed: 1, flair: true });
  expect(run({ crit: true })).toEqual({ launched: 1, flashed: 1, flair: true });
  expect(run(null)).toEqual({ launched: 0, flashed: 0, flair: false });
  expect(run({ finisher: true }, { isBoss: true })).toEqual({ launched: 0, flashed: 0, flair: false });
  expect(run({ crit: true }, { isElite: true })).toEqual({ launched: 0, flashed: 0, flair: false });
});

function withFx(run: (fx: FX) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, createLinearGradient: () => gradient, fillRect() {}, clearRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => context }), getElementById: () => ({ firstChild: null }) } });
  const fx = new FX(new THREE.Scene(), new THREE.PerspectiveCamera());
  try { run(fx); } finally {
    fx.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('처치 확정 섬광은 파티클 풀만 쓰고 한 프레임 상한이 있어 군중 처치에도 메시·드로우가 늘지 않는다', () => withFx(fx => {
  const items = fx.items.length, children = fx.scene.children.length, random = Math.random; let calls = 0;
  Math.random = () => { calls++; return .5; };
  try {
    const at = new THREE.Vector3(1, 0, 2);
    for (let i = 0; i < 60; i++) fx.killConfirm(at);
    expect(fx.glow.n).toBe(10); expect(fx.sparks.n).toBe(60);   // 프레임당 10회 × (섬광 1 + 불꽃 6)
    expect(fx.items.length).toBe(items); expect(fx.scene.children.length).toBe(children);
    expect(calls).toBe(0);
    fx.update(1 / 60);   // 다음 프레임에 예산이 다시 열린다
    const before = fx.glow.n; fx.killConfirm(at);
    expect(fx.glow.n).toBe(before + 1);
  } finally { Math.random = random; }
}));

test('데미지 숫자는 동시 12개(치명타·마무리 20개)까지, 한 프레임 신규 6개까지만 띄우고 피해 처리는 모두 유지한다', () => {
  const children: unknown[] = []; let shown = 0;
  const player = { stats: { crit: 0, critDmg: 2, ultGain: 1 }, auto: true, addUlt: noop };
  const battle: any = Object.assign(Object.create(RpgBattle.prototype), {
    active: true, paused: false, player, combo: 0, maxCombo: 0, dmgDealt: 0, app: { reducedMotion: { matches: false } }, ui: { setCombo: noop },
    fx: { dmgLayer: { children }, damage: () => { shown++; children.push(0); } },
  });
  const enemy: any = { alive: true, spawning: false, pos: new THREE.Vector3(), def: { scale: 1 }, hurt: () => 10 };
  for (let i = 0; i < 30; i++) battle.damageEnemy(enemy, 10, { noProc: true });
  expect(battle.combo).toBe(30); expect(battle.dmgDealt).toBe(300);   // 숫자 억제는 피해 계산에 영향이 없다
  expect(shown).toBe(6);
  for (let frame = 0; frame < 5; frame++) { battle.dmgFrame = 0; for (let i = 0; i < 30; i++) battle.damageEnemy(enemy, 10, { noProc: true }); }
  expect(children.length).toBe(12);
  const before = shown;
  battle.dmgFrame = 0; battle.damageEnemy(enemy, 10, { noProc: true, finisher: true });
  expect(shown).toBe(before + 1); expect(children.length).toBe(13);
});
