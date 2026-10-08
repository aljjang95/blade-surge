import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';
import { HeroEffectFocus } from '../src/engine/hero-effect-focus.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

function withArc(options: any, check: (fx: any, mesh: THREE.Mesh, item: any) => void) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const gradient = { addColorStop() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    getContext: () => ({ createLinearGradient: () => gradient, fillRect() {} }),
  }) } });
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, { scene: new THREE.Scene(), focus: new HeroEffectFocus(), items: [], _mats: {} });
  try {
    fx.slashArc(new THREE.Vector3(10, 0, -5), .65, 0xff3030, { radius: 3, arc: 110, life: .8, ...options });
    check(fx, fx.items[0].obj, fx.items[0]);
  } finally {
    while (fx.items.length) fx._finishItem(0);
    for (const material of Object.values(fx._mats)) (material as THREE.Material).dispose();
    if (saved) Object.defineProperty(globalThis, 'document', saved); else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('적의 바닥 예고는 실제 FX 갱신에도 도형을 늘리거나 회전시키지 않고 공격 직전까지 보인다', () => {
  for (const fps of [30, 60, 120]) withArc({ telegraph: true, height: .1, thickness: 1 }, (_fx, mesh, item) => {
    mesh.updateMatrixWorld(true); const initial = mesh.matrixWorld.clone();
    const point = new THREE.Vector3(3, 0, 0).applyMatrix4(initial);
    for (let frame = 0; frame / fps < item.life; frame++) {
      const elapsed = frame / fps; item.update(elapsed / item.life, elapsed, 1 / fps);
      mesh.updateMatrixWorld(true);
      expect(mesh.matrixWorld.equals(initial)).toBe(true);
      expect(new THREE.Vector3(3, 0, 0).applyMatrix4(mesh.matrixWorld).equals(point)).toBe(true);
      expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThanOrEqual(.65);
    }
  });
});

test('일반 참격 연출의 크기·회전·감쇠는 예고 도형 수리 뒤에도 유지한다', () => {
  withArc({ telegraph: false }, (_fx, mesh, item) => {
    item.update(.25, .2, 1 / 60);
    const first = { scale: mesh.scale.x, angle: mesh.rotation.z, opacity: (mesh.material as THREE.MeshBasicMaterial).opacity };
    item.update(.75, .6, 1 / 60);
    expect(mesh.scale.x).toBeGreaterThan(first.scale);
    expect(mesh.rotation.z).toBeGreaterThan(first.angle);
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(first.opacity);
  });
});

test('기본 근접 예고의 명목 경계는 실제 피해 범위를 빠짐없이 포함하고 판정 수치는 유지한다', () => {
  for (const angle of [0, 1.02, 1.095]) for (const distance of [1.5, 2.45]) {
    const f = createCombatFlowFixture(runtime), enemy: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z);
    let warning: any;
    f.game.fx.slashArc = (_position: any, yaw: number, _color: number, options: any) => {
      if (options.telegraph) warning = { yaw, ...options };
    };
    enemy.yaw = 0; enemy.startAttack(1.6);
    f.player.pos.set(enemy.pos.x + Math.sin(angle) * distance, 0, enemy.pos.z + Math.cos(angle) * distance);
    enemy.doAttack();
    expect(f.events.incoming).toHaveLength(1);
    expect(distance).toBeLessThan(warning.radius);
    expect(angle).toBeLessThan(warning.arc * Math.PI / 360);
    expect(warning.radius).toBeCloseTo(enemy.def.range + .6, 10);
    expect(warning.arc * Math.PI / 360).toBeCloseTo(1.1, 10);
  }
});
