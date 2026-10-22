import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';
import { HeroEffectFocus } from '../src/engine/hero-effect-focus.js';
import { ImpactVfx, IMPACT_KIND } from '../src/engine/impact-vfx.js';
import { Enemy } from '../src/game/enemies.js';
import { ENEMIES } from '../src/data/stages.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

function withFx(check: (fx: any) => void, { impact = false } = {}) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    getContext: () => ({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, fillRect() {}, beginPath() {}, arc() {}, fill() {} }),
  }) } });
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, { scene: new THREE.Scene(), focus: new HeroEffectFocus(), items: [], _mats: {}, quality: 'high' });
  if (impact) fx.impact = new ImpactVfx(fx.scene);
  try { check(fx); } finally {
    while (fx.items.length) fx._finishItem(0);
    for (const material of Object.values(fx._mats)) (material as THREE.Material).dispose();
    fx.impact?.dispose?.();
    if (saved) Object.defineProperty(globalThis, 'document', saved); else Reflect.deleteProperty(globalThis, 'document');
  }
}
const step = (fx: any, t: number) => { for (const it of [...fx.items]) { it.t += t; if (it.t < it.life) it.update?.(it.t / it.life, it.t, t); } };

test('보스 예고 부채꼴은 판정과 같은 정면·반각·반경으로 그려지고 경고 시간 동안 채움이 0→1 로 차오른 뒤 터짐 잔상으로 사라진다', () => {
  for (const yaw of [0, Math.PI / 3, -Math.PI / 2, 2.4]) withFx((fx) => {
    const mesh = fx.slashArc(new THREE.Vector3(4, 0, -2), yaw, 0xff3030, { radius: 3.8, arc: 126, telegraph: true, boss: true, life: .9 });
    const u = mesh.material.uniforms;
    expect(mesh.name).toBe('BossWarn');
    expect(u.shape.value).toBe(3);
    expect(u.arc.value).toBeCloseTo(THREE.MathUtils.degToRad(63), 8);
    expect(u.size.value.x).toBeCloseTo(7.6, 8);
    // 국소 +x(셰이더의 부채꼴 중심선)가 적 정면 (sin yaw, cos yaw)을 향한다.
    mesh.updateMatrixWorld(true);
    const ahead = new THREE.Vector3(.5, 0, 0).applyMatrix4(mesh.matrixWorld).sub(mesh.position).normalize();
    expect(ahead.x).toBeCloseTo(Math.sin(yaw), 6); expect(ahead.z).toBeCloseTo(Math.cos(yaw), 6);
    step(fx, .45); expect(u.progress.value).toBeCloseTo(.5, 6); expect(u.fired.value).toBe(0);
    step(fx, .44); expect(u.progress.value).toBeGreaterThan(.98);
    step(fx, .05); expect(u.fired.value).toBe(1); expect(u.opacity.value).toBeLessThan(1);
    expect(fx.items[0].life).toBeCloseTo(1.2, 8);
  });
});

test('보스 예고 고리는 판정 반경(r1) 원판으로, 일반 적 예고는 기존 가산 고리로 남는다', () => {
  withFx((fx) => {
    const disk = fx.ring(new THREE.Vector3(), 0xff3030, { r0: 4.2, r1: 4.8, telegraph: true, boss: true, life: 1 });
    expect(disk.material.uniforms.shape.value).toBe(0);
    expect(disk.scale.x).toBeCloseTo(9.6, 8); expect(disk.scale.z).toBeCloseTo(9.6, 8);
    expect(disk.material.blending).toBe(THREE.NormalBlending);
    fx.ring(new THREE.Vector3(), 0xff3030, { r0: 4.2, r1: 4.8, telegraph: true, life: 1 });
    expect(fx.items[1].obj.name).not.toBe('BossWarn');
  });
});

// three 객체 id(generateUUID)가 Math.random 을 쓰는 것은 기존 모든 FX 와 같다. 모이는 조각(VfxRng)은 Math.random 을 더 부르지 않는다.
test('보스 차지 빛의 모이는 조각은 Math.random 을 쓰지 않고, 광구 밝기에 상한이 있으며, 동작 줄이기는 모이는 조각을 내지 않는다', () => {
  const draws: number[] = [];
  // 첫 회는 텍스처·재질 캐시 준비(객체 id)가 섞이므로 두 번째부터 비교한다.
  for (const reduced of [false, true, false]) withFx((fx) => {
    const random = Math.random; let calls = 0; Math.random = () => { calls++; return random(); };
    try {
      const before = fx.impact.spawned;
      const sprite = fx.bossCharge(new THREE.Vector3(1, 0, 2), 0xe0c184, { life: 1.1, scale: 2.25, reduced });
      const n = fx.impact.spawned - before;
      if (reduced) expect(n).toBe(0); else { expect(n).toBe(10); expect(fx.impact.ring.a.aShape[fx.impact.lastSlot * 4]).toBe(IMPACT_KIND.streak); }
      let peak = 0, size = 0;
      for (let t = 0; t < 1.2; t += 1 / 60) { step(fx, 1 / 60); const c = sprite.material.color; peak = Math.max(peak, c.r, c.g, c.b); size = Math.max(size, sprite.scale.x); }
      expect(peak).toBeLessThanOrEqual(.92);
      expect(size).toBeLessThanOrEqual(1.1 * 2.25);
      expect(sprite.material.depthTest).toBe(false);
    } finally { Math.random = random; }
    draws.push(calls);
  }, { impact: true });
  expect(draws[2]).toBe(draws[1]);
});

test('보스 일반 패턴은 모두 boss 바닥 예고·차지 빛을 쓰고, 경고 시간은 기존 attackDur×hitAt 그대로다', () => {
  for (const pattern of ['spin', 'slam', 'soulrain', 'fan', 'basic']) {
    const warnings: any[] = [], charges: any[] = [];
    const enemy = Object.create(Enemy.prototype);
    Object.assign(enemy, {
      def: { ...(ENEMIES as Record<string, any>).garden_midboss, pattern: [pattern], phasePatterns: null, kit: null },
      pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), yaw: 0, isBoss: true, phase: 0, patternTurn: 0, atk: 40,
      A: (key: string) => key, playTimed: () => {}, announceSkill: () => {},
      game: { enemies: [], scene: new THREE.Scene(), player: { pos: new THREE.Vector3(0, 0, 3) },
        fx: { ring: (...a: any[]) => warnings.push(a.at(-1)), slashArc: (...a: any[]) => warnings.push(a.at(-1)), flash: () => {}, castCircle: () => {},
          bossCharge: (_p: unknown, _c: unknown, o: any) => charges.push(o) } },
    });
    enemy.startAttack(3);
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) { expect(w.boss).toBe(true); expect(w.telegraph).toBe(true); expect(w.life).toBeCloseTo(enemy.attackDur * enemy.hitAt, 8); }
    expect(charges).toHaveLength(1);
    expect(charges[0].life).toBeCloseTo(enemy.attackDur * enemy.hitAt, 8);
  }
});

test('보스 돌진 통로는 보스 예고 셰이더로 그려지고 출발(.45) 지점까지 남은 시간 채움이 차오른다', () => {
  const f = createCombatFlowFixture(runtime), enemy: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z, { id: 'boss_demon', partyId: 'dash-boss' });
  f.player.pos.set(enemy.pos.x, 0, enemy.pos.z + 8);
  const random = Math.random; Math.random = () => .1;
  try { enemy.startAttack(8); } finally { Math.random = random; }
  expect(enemy.special).toBe('dash');
  const u = enemy.dashWarning.mesh.material.uniforms;
  expect(enemy.dashWarning.mesh.material.fragmentShader).toContain('atan(p.y,p.x)');
  expect(u.progress.value).toBe(0);
  let last = 0;
  for (let i = 0; i < 120 && enemy.stateT < enemy.attackDur * .45 - 1 / 60; i++) { enemy.update(1 / 60); expect(u.progress.value).toBeGreaterThanOrEqual(last); last = u.progress.value; }
  expect(last).toBeGreaterThan(.9);
  enemy.dashWarning.dispose();
});

test('파티 손님 화면: 보스 일반 패턴 경고(id ":boss")는 보스 예고 셰이더로, 일반 적 경고는 기존 셰이더로 그린다', async () => {
  const { PartyCombatEffects } = await import('../src/party/combat-effects.js');
  const { enemyPartyWarnings } = await import('../src/game/enemies.js');
  const make = (isBoss: boolean) => enemyPartyWarnings({ alive: true, spawning: false, partyId: 'p1', state: 'attack', attackDone: false, attackDur: 1.8, hitAt: .55,
    stateT: .2, special: 'spin', isBoss, pos: { x: 0, z: 0 }, yaw: 0, def: { range: 3 } })[0];
  const boss = make(true), mob = make(false);
  expect(boss.id).toContain(':boss'); expect(boss.color).toBe(0xff3030); expect(mob.id).not.toContain(':boss');
  const effects = new PartyCombatEffects(new THREE.Scene());
  effects.update([boss, { ...mob, id: 'p1:mob' }]);
  expect(effects.slots[0].mesh.material).toBe(effects.slots[0].boss);
  expect(effects.slots[1].mesh.material).toBe(effects.slots[1].plain);
  effects.dispose();
});
