import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { BURROW, Burrow, applyBurrowDepth } from '../src/game/burrow.js';
import { validPartyWarning } from '../src/party/combat-effects.js';
import { validPartySnapshot } from '../src/party/protocol.js';
import { ENEMIES } from '../src/data/stages.js';

function fixture(playerAt = 8) {
  const hits: any[] = [];
  const player = { alive: true, pos: new THREE.Vector3(playerAt, 0, 0), hurt: (dmg: number, opts: any) => hits.push({ dmg, opts }) };
  const game: any = { active: true, player, fx: {}, renderer: {} };
  const enemy: any = {
    game, player, alive: true, spawning: false, state: 'chase', stun: 0, atk: 20, scale: 1, gatherT: 0, telegraph: 0, special: null,
    pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), kb: new THREE.Vector3(), model: { position: new THREE.Vector3(), visible: true },
    announced: 0, announceSkill() { this.announced++; },
  };
  const burrow = new Burrow(enemy, () => 0);
  return { enemy, player, burrow, hits };
}
// Actor 의 이동을 흉내 낸다: 속도를 위치에 적분.
function step(f: ReturnType<typeof fixture>, dt = 1 / 60) {
  const d = f.enemy.pos.distanceTo(f.player.pos);
  const busy = f.burrow.update(dt, d);
  f.enemy.pos.addScaledVector(f.enemy.vel, dt);
  return busy;
}

test('잠복종 3종은 burrower 행동이며 정원·용광로·설원 로스터에 들어 있다', () => {
  for (const id of ['grave_burrower', 'ash_burrower', 'frost_burrower']) {
    const def = (ENEMIES as any)[id];
    expect(def.behavior).toBe('burrower');
    expect(def.boss || def.elite || def.ranged || def.meleeRole).toBeFalsy();
  }
});

test('쿨다운 뒤 숨고, 숨은 동안은 spawning 으로 조준·피격에서 빠지며 플레이어 쪽으로 다가간다', () => {
  const f = fixture(8);
  let t = 0;
  while (!f.burrow.phase && t < BURROW.firstCooldown + 1) { step(f); t += 1 / 60; }
  expect(f.burrow.phase).toBe('sink');
  expect(f.enemy.spawning).toBe(true);
  expect(f.enemy.special).toBe('burrow');
  while (f.burrow.phase === 'sink') step(f);
  expect(f.burrow.phase).toBe('tunnel');
  expect(f.enemy.model.visible).toBe(false);
  const before = f.enemy.pos.distanceTo(f.player.pos);
  for (let i = 0; i < 10; i++) step(f);
  expect(f.enemy.pos.distanceTo(f.player.pos)).toBeLessThan(before);
});

test('예고 원 동안 반쯤 드러나 맞을 수 있고, 끝나면 반경 안의 플레이어만 띄운다', () => {
  const f = fixture(8);
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  expect(f.burrow.phase).toBe('mark');
  expect(f.enemy.spawning).toBe(false);
  expect(f.enemy.model.visible).toBe(true);
  expect(f.enemy.telegraph).toBeGreaterThan(0);
  expect(f.enemy.announced).toBe(1);
  for (let i = 0; i < 120 && f.burrow.phase === 'mark'; i++) step(f);
  expect(f.burrow.phase).toBe(null);
  expect(f.burrow.erupted).toBe(1);
  expect(f.hits.length).toBe(1);
  expect(f.hits[0].dmg).toBeCloseTo(20 * BURROW.damageMul);
  expect(f.hits[0].opts.kb).toBe(BURROW.knockback);
  expect(f.enemy.model.position.y).toBe(0);
  expect(f.burrow.damageMul()).toBe(BURROW.exposedDamageMul);
  expect(f.enemy.stun).toBeGreaterThan(0);
});

test('예고 중 플레이어가 반경 밖으로 피하면 피해가 없다', () => {
  const f = fixture(8);
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  f.player.pos.set(f.burrow.x + BURROW.radius + .5, 0, f.burrow.z);
  for (let i = 0; i < 120 && f.burrow.phase === 'mark'; i++) step(f);
  expect(f.burrow.erupted).toBe(1);
  expect(f.hits.length).toBe(0);
});

test('예고 중 기절시키면 솟구치기가 취소되고 무방비로 끌려 나온다', () => {
  const f = fixture(8);
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  f.enemy.stun = .5;
  step(f);
  expect(f.burrow.phase).toBe(null);
  expect(f.burrow.fizzled).toBe(1);
  expect(f.hits.length).toBe(0);
  expect(f.burrow.damageMul()).toBe(BURROW.exposedDamageMul);
  expect(f.enemy.spawning).toBe(false);
});

test('몰이 중이거나 사거리 밖이면 숨지 않는다', () => {
  const far = fixture(BURROW.maxDistance + 2);
  for (let i = 0; i < 400; i++) step(far);
  expect(far.burrow.phase).toBe(null);
  const gathered = fixture(8);
  gathered.enemy.gatherT = 99;
  for (let i = 0; i < 400; i++) step(gathered);
  expect(gathered.burrow.phase).toBe(null);
});

test('죽거나 해제되면 몸 위치와 표시를 되돌린다', () => {
  const f = fixture(8);
  for (let i = 0; i < 600 && f.burrow.phase !== 'tunnel'; i++) step(f);
  f.burrow.dispose();
  expect(f.enemy.model.visible).toBe(true);
  expect(f.enemy.model.position.y).toBe(0);
  expect(f.enemy.spawning).toBe(false);
});


test('걸어서 근접 거리에 붙은 뒤에도 쿨다운마다 발밑으로 파고든다', () => {
  const f = fixture(2.6);
  let surfaced = 0;
  for (let i = 0; i < 60 * 20; i++) { step(f); if (!f.burrow.phase && f.burrow.erupted > surfaced) { surfaced = f.burrow.erupted; f.enemy.pos.set(0, 0, 0); f.player.pos.set(2.6, 0, 0); f.enemy.stun = 0; } }
  expect(f.burrow.erupted).toBeGreaterThanOrEqual(2);
});


test('예고 중 피격 기절은 즉시 취소하고 그 타격의 넉백을 지우지 않는다', () => {
  const f = fixture(8);
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  // Enemy.hurt 가 하는 순서: 넉백 적용 → 기절 → burrow.interrupt()
  f.enemy.kb.set(14, 0, 0); f.enemy.stun = .01; f.burrow.interrupt();
  expect(f.burrow.phase).toBe(null);
  expect(f.burrow.fizzled).toBe(1);
  expect(f.enemy.kb.length()).toBe(14);
  step(f);
  expect(f.burrow.erupted).toBe(0);
});

test('다른 경로의 기절도 이동을 지우기 전에 확인해 넉백을 남긴다', () => {
  const f = fixture(8);
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  f.enemy.kb.set(0, 0, 9); f.enemy.stun = .3;
  f.burrow.update(1 / 60, 1);
  expect(f.burrow.fizzled).toBe(1);
  expect(f.enemy.kb.length()).toBe(9);
});

test('전투가 끝나면 진행 중인 잠행을 피해 없이 거둔다', () => {
  const f = fixture(8);
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  f.enemy.game.active = false;
  for (let i = 0; i < 120; i++) step(f);
  expect(f.burrow.phase).toBe(null);
  expect(f.burrow.erupted).toBe(0);
  expect(f.hits.length).toBe(0);
  expect(f.enemy.model.visible).toBe(true);
  expect(f.enemy.spawning).toBe(false);
  expect(f.burrow.damageMul()).toBe(1);
});

test('파티 모드 호스트도 잠행하고, 솟구침은 반경 안의 모든 생존 파티원에게 들어간다', () => {
  const f = fixture(8);
  const ally: any[] = [];
  const friend = { alive: true, pos: new THREE.Vector3(0, 0, 0), hurt: (dmg: number) => ally.push(dmg) };
  const far = { alive: true, pos: new THREE.Vector3(40, 0, 0), hurt: () => { throw new Error('far member hit'); } };
  f.enemy.game.stage = { party: true };
  f.enemy.game.app = { party: { livingPlayers: () => [f.player, friend, far] } };
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  expect(f.burrow.phase).toBe('mark');
  friend.pos.set(f.burrow.x + 1, 0, f.burrow.z);
  for (let i = 0; i < 120 && f.burrow.phase === 'mark'; i++) step(f);
  expect(f.burrow.erupted).toBe(1);
  expect(f.hits.length).toBe(1);
  expect(ally.length).toBe(1);
});

test('호스트는 숨은 깊이와 예고 원판을 파티 표시용 값으로 내보낸다', () => {
  const f = fixture(8);
  expect(f.burrow.depth()).toBe(0);
  expect(f.burrow.partyWarning('e1')).toBe(null);
  for (let i = 0; i < 600 && f.burrow.phase !== 'tunnel'; i++) step(f);
  expect(f.burrow.depth()).toBe(1);
  for (let i = 0; i < 600 && f.burrow.phase !== 'mark'; i++) step(f);
  step(f);
  expect(f.burrow.depth()).toBeGreaterThan(.4);
  expect(f.burrow.depth()).toBeLessThan(1);
  const w: any = f.burrow.partyWarning('e1');
  expect(validPartyWarning(w)).toBe(true);
  expect(w).toMatchObject({ kind: 'disk', radius: BURROW.radius, x: f.burrow.x, z: f.burrow.z, duration: BURROW.mark });
  expect(w.remaining).toBeGreaterThan(0);
  expect(w.id).toBe('e1:burrow:0');
});

test('게스트 복제본은 받은 깊이로 가라앉고, 완전히 숨으면 감추고 조준에서 빠진다', () => {
  const replica: any = { scale: 1, spawning: false, model: { position: new THREE.Vector3(), visible: true } };
  applyBurrowDepth(replica, 1);
  expect(replica.model.visible).toBe(false);
  expect(replica.spawning).toBe(true);
  applyBurrowDepth(replica, .5);
  expect(replica.model.visible).toBe(true);
  expect(replica.spawning).toBe(false);
  expect(replica.model.position.y).toBeCloseTo(-.5 * BURROW.depth);
  applyBurrowDepth(replica, undefined);
  expect(replica.model.position.y).toBe(0);
});

test('파티 스냅샷 검증은 0~1 범위의 숨은 깊이만 받는다', () => {
  const actor = (id: string) => ({ id, x: 0, z: 0, yaw: 0, hp: 10, maxHp: 10, state: 'idle', anim: null });
  const snap = (sub?: number) => ({ tick: 1, elapsed: 1, roomsCleared: 0, bossDefeated: false, portal: null, events: [], rooms: [],
    players: ['a', 'b'].map((id) => ({ ...actor(id), heroId: 'knight', ult: 0, cds: [] })),
    enemies: [{ ...actor('e1'), key: 'grave_burrower', boss: false, elite: false, ...(sub === undefined ? {} : { sub }) }] });
  expect(validPartySnapshot(snap())).toBe(true);
  expect(validPartySnapshot(snap(.5))).toBe(true);
  expect(validPartySnapshot(snap(1.5))).toBe(false);
  expect(validPartySnapshot(snap(-.1))).toBe(false);
});

