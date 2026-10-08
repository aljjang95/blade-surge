import { expect, test } from 'bun:test';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy } from '../tools/combat-flow-sim.mjs';
import { BossSignatures } from '../src/game/boss-signatures.js';
import { hazardContains } from '../src/game/region-hazards.js';
import { validPartyWarning } from '../src/party/combat-effects.js';

const runtime = await loadCombatFlowRuntime();

function fixture(yaw = 0, signature = false) {
  const f = createCombatFlowFixture(runtime), enemy: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z, { id: 'boss_demon', partyId: 'dash-boss' });
  if (signature) enemy.signatures = new BossSignatures(enemy);
  enemy.yaw = yaw;
  f.player.pos.set(enemy.pos.x + Math.sin(yaw) * 8, 0, enemy.pos.z + Math.cos(yaw) * 8);
  const random = Math.random; Math.random = () => .1;
  try { enemy.startAttack(8); } finally { Math.random = random; }
  expect(enemy.special).toBe('dash');
  return { ...f, enemy, origin: enemy.pos.clone(), warning: { ...enemy.partyDashWarning } };
}

function finish(f: ReturnType<typeof fixture>, fps: number) {
  for (let frame = 0; frame < fps * 3 && !f.enemy.attackDone; frame++) f.enemy.update(1 / fps);
  expect(f.enemy.attackDone).toBe(true);
}

test('보스 돌진의 로컬 재사용 메시와 파티 경고는 같은 고정 통로이며 준비 중 이동하지 않는다', () => {
  for (const yaw of [0, Math.PI / 4, -Math.PI / 3]) for (const fps of [30, 60, 120]) {
    const f = fixture(yaw), mesh = f.enemy.dashWarning.mesh;
    try {
      const dto = f.enemy.getPartyWarnings()[0];
      expect(validPartyWarning(dto)).toBe(true); expect(dto.kind).toBe('lane'); expect(dto.type).toBeUndefined();
      expect(mesh.position.x).toBe(dto.x); expect(mesh.position.z).toBe(dto.z);
      expect(mesh.rotation.y).toBe(-dto.angle); expect(mesh.scale.x).toBe(dto.length); expect(mesh.scale.z).toBe(dto.width);
      expect(mesh.material.uniforms.shape.value).toBe(2);
      for (let frame = 0; (frame + 1) / fps < f.enemy.attackDur * .45; frame++) {
        f.enemy.update(1 / fps);
        expect(f.enemy.pos.equals(f.origin)).toBe(true);
        expect(mesh.visible).toBe(true);
        expect(f.events.incoming).toHaveLength(0);
        expect(f.enemy.partyDashWarning).toEqual(f.warning);
      }
    } finally { f.enemy.dispose(); }
  }
});

test('돌진 도착점과 통로 안에 있는 영웅은 맞고 통로 옆으로 이동한 영웅은 피한다', () => {
  for (const fps of [30, 60, 120]) for (const inside of [false, true]) {
    const f = fixture();
    try {
      f.player.pos.set(f.origin.x + (inside ? 2.5 : 3.25), 0, f.origin.z + 8);
      expect(hazardContains(f.warning, f.player.pos.x, f.player.pos.z)).toBe(inside);
      finish(f, fps);
      expect(f.events.incoming.length > 0).toBe(inside);
      expect(f.enemy.dashWarning.mesh.visible).toBe(false);
      expect(f.enemy.getPartyWarnings()).toEqual([]);
    } finally { f.enemy.dispose(); }
  }
});

test('실제 Floor 벽슬라이드가 돌진 원점 밖으로 밀어도 경고 통로 밖 영웅은 도착점에 가까워도 맞지 않는다', () => {
  for (const fps of [30, 60, 120]) {
    const f = fixture(Math.PI / 4), world = f.game.world;
    try {
      const column = Math.floor(f.origin.x - world.minX) + 1;
      for (let row = 0; row < world.rows; row++) world.mask[row * world.cols + column] = 0;
      f.player.pos.set(f.origin.x - 1.5, 0, f.origin.z + 6);
      expect(hazardContains(f.warning, f.player.pos.x, f.player.pos.z)).toBe(false);
      finish(f, fps);
      expect(f.enemy.distTo(f.player)).toBeLessThan(3.2);
      expect(world.walkable(f.enemy.pos.x, f.enemy.pos.z)).toBe(true);
      expect(f.events.incoming).toHaveLength(0);
    } finally { f.enemy.dispose(); }
  }
});

test('돌진 중단·사망·종료·폐기는 경고와 뒤늦은 피해를 남기지 않는다', () => {
  for (const reason of ['hurt', 'stun', 'death', 'stop', 'bossDefeated', 'dispose']) {
    const f = fixture(), mesh = f.enemy.dashWarning.mesh;
    try {
      if (reason === 'hurt') f.enemy.hurt(1, { kb: 6 });
      if (reason === 'stun') f.enemy.stun = .001;
      if (reason === 'death') f.enemy.kill(0, 0, 1);
      if (reason === 'stop') f.game.active = false;
      if (reason === 'bossDefeated') f.game.bossDefeated = true;
      if (reason === 'dispose') f.enemy.dispose(); else f.enemy.update(1 / 60);
      expect(mesh.visible).toBe(false);
      expect(f.enemy.getPartyWarnings()).toEqual([]);
      const hp = f.player.hp;
      f.enemy.doAttack();
      expect(f.player.hp).toBe(hp);
    } finally { f.enemy.dispose(); }
  }
});

test('돌진 경고는 1개 메시를 재사용하고 고유기 보스는 기존 6개 슬롯만 쓰며 이중 폐기하지 않는다', () => {
  for (const signature of [false, true]) {
    const f = fixture(0, signature), view = f.enemy.dashWarning, mesh = view.mesh;
    const objects = f.game.scene.children.length; let geometryDisposals = 0, materialDisposals = 0;
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
    if (signature) {
      expect(mesh).toBe(f.enemy.signatures.slots[0].mesh);
      expect(f.enemy.signatures.group.children).toHaveLength(6);
    }
    const random = Math.random; Math.random = () => .1;
    try {
      for (let i = 0; i < 20; i++) {
        f.enemy.startAttack(8);
        expect(f.enemy.dashWarning).toBe(view);
        expect(f.game.scene.children).toHaveLength(objects);
      }
    } finally { Math.random = random; f.enemy.dispose(); f.enemy.dispose(); }
    expect(geometryDisposals).toBe(1); expect(materialDisposals).toBe(1);
  }
});
