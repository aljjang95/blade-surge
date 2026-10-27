import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ROOM_PROPS, RoomProps, propSpots, roomPropsAllowed } from '../src/game/room-props.js';

const fxProxy: any = new Proxy({}, { get: () => () => {} });

function makeHero(x = 0, z = 0) {
  return { alive: true, maxHp: 200, pos: new THREE.Vector3(x, 0, z), hurts: [] as any[], hurt(dmg: number, opts: any) { this.hurts.push({ dmg, opts }); } };
}
function makeEnemy(x: number, z: number, extra: any = {}) {
  const e: any = {
    alive: true, spawning: false, maxHp: 100, stun: 0, slow: 0, slowT: 0, pos: new THREE.Vector3(x, 0, z), hurts: [] as any[], gathers: [] as any[],
    hurt(dmg: number, opts: any) { this.hurts.push({ dmg, opts }); },
    gather(x: number, z: number, a: number, b: number) { this.gathers.push([x, z, a, b]); },
    ...extra,
  };
  return e;
}
function setup(theme: string, stageExtra: any = {}) {
  const hero = makeHero(0, 0);
  const game: any = {
    scene: new THREE.Scene(), fx: fxProxy, ui: { toast() {}, combatCue() {} }, player: hero, enemies: [] as any[],
    world: { resolve: (_x0: number, _z0: number, x: number, z: number) => [x, z] },
    stage: { st: 1, chapter: { id: 1, theme }, ...stageExtra },
  };
  const rp = new RoomProps(game);
  const room: any = { x: 0, z: 0, w: 14, h: 14, entryX: 10, entryZ: 0 };
  return { hero, game, rp, room };
}
// 장치 하나만 세운 뒤 그 위치를 영웅 기준 원점으로 옮겨 계산을 단순화한다.
function place(theme: string) {
  const s = setup(theme);
  s.rp.placeFor(s.room);
  const prop = s.rp.list[0];
  return { ...s, prop };
}

test('roomPropsAllowed: 캠페인(st 정수)만 true, 원정·파티·비정수 st 는 false', () => {
  expect(roomPropsAllowed({ st: 3 })).toBe(true);
  expect(roomPropsAllowed({ st: 3, expedition: true })).toBe(false);
  expect(roomPropsAllowed({ st: 3, party: true })).toBe(false);
  expect(roomPropsAllowed({ st: 'x' })).toBe(false);
  expect(roomPropsAllowed({ st: 1.5 })).toBe(false);
  expect(roomPropsAllowed(null)).toBe(false);
});

test('propSpots: 작은 방은 1개, 넓이 380 이상 방은 2개이며 모두 방 안쪽', () => {
  const small = { x: 5, z: -3, w: 14, h: 14 }, big = { x: -4, z: 8, w: 22, h: 18 };
  expect(propSpots(small, 15, -3).length).toBe(1);
  const spots = propSpots(big, -20, 8);
  expect(spots.length).toBe(2);
  for (const [room, list] of [[small, propSpots(small, 15, -3)], [big, spots]] as const) {
    for (const s of list) {
      expect(Math.abs(s.x - room.x)).toBeLessThan(room.w / 2);
      expect(Math.abs(s.z - room.z)).toBeLessThan(room.h / 2);
    }
  }
  // 진입 지점이 방 중심과 같아도 NaN 이 나오지 않는다
  for (const s of propSpots(small, 5, -3)) { expect(Number.isFinite(s.x)).toBe(true); expect(Number.isFinite(s.z)).toBe(true); }
});

test('placeFor: 지역 테마별 장치를 세우고 같은 방엔 두 번 세우지 않으며 파티·원정·미지정 테마엔 세우지 않는다', () => {
  const { rp, room } = setup('forge');
  rp.placeFor(room);
  expect(rp.list.length).toBe(1);
  expect(rp.list[0].kind).toBe(ROOM_PROPS.forge.kind);
  expect(room.props.length).toBe(1);
  rp.placeFor(room);
  expect(rp.list.length).toBe(1);
  for (const extra of [{ party: true }, { expedition: true }]) {
    const s = setup('forge', extra); s.rp.placeFor(s.room); expect(s.rp.list.length).toBe(0);
  }
  const none = setup('unknown'); none.rp.placeFor(none.room); expect(none.rp.list.length).toBe(0);
});

test('strike: 사거리·호 안이면 발동(used), 호 밖·멀면 안 되고 이미 사용한 장치는 다시 발동 안 함', () => {
  const { rp, prop } = place('garden');
  prop.x = 0; prop.z = 3;
  const origin = new THREE.Vector3(0, 0, 0);
  rp.strike(origin, Math.PI, 4, 90); // 뒤를 보고 휘두름
  expect(prop.used).toBe(false);
  rp.strike(origin, 0, 1, 90); // 사거리 부족 (3 > 1+1.1)
  expect(prop.used).toBe(false);
  rp.strike(origin, 0, 4, 90);
  expect(prop.used).toBe(true);
  const before = rp.game._propsUsed;
  rp.strike(origin, 0, 4, 90);
  expect(rp.game._propsUsed).toBe(before);
  // 360도는 방향 무관
  const b = place('garden'); b.prop.x = 0; b.prop.z = -3;
  b.rp.strike(origin, 0, 4, 360);
  expect(b.prop.used).toBe(true);
});

test('keg: 발동 직후 효과 없음, 1초 뒤 반경 5 안 적과 영웅(maxHp*0.12)만 피해', () => {
  const { game, rp, hero, prop } = place('forge');
  prop.x = 20; prop.z = 0; hero.pos.set(22, 0, 0);
  const near = makeEnemy(23, 0), far = makeEnemy(30, 0);
  game.enemies.push(near, far);
  rp.trigger(prop);
  expect(prop.used).toBe(true);
  expect(near.hurts.length).toBe(0);
  expect(hero.hurts.length).toBe(0);
  rp.update(0.9);
  expect(near.hurts.length).toBe(0);
  rp.update(0.2);
  expect(near.hurts.length).toBe(1);
  expect(near.hurts[0].dmg).toBeCloseTo(100 * 0.45);
  expect(far.hurts.length).toBe(0);
  expect(hero.hurts.length).toBe(1);
  expect(hero.hurts[0].dmg).toBeCloseTo(200 * 0.12);
  rp.update(1);
  expect(near.hurts.length).toBe(1);
});

test('keg: 영웅이 반경 밖이면 영웅은 안 다친다', () => {
  const { rp, hero, prop } = place('forge');
  prop.x = 20; prop.z = 0; hero.pos.set(30, 0, 0);
  rp.trigger(prop); rp.update(1.1);
  expect(hero.hurts.length).toBe(0);
});

test('bell: 즉시 반경 6 안 적을 기절, 밖은 그대로', () => {
  const { game, rp, prop } = place('garden');
  prop.x = 20; prop.z = 0;
  const near = makeEnemy(24, 0), far = makeEnemy(27, 0);
  game.enemies.push(near, far);
  rp.trigger(prop);
  expect(near.hurts[0].opts.stun).toBeCloseTo(1.8);
  expect(far.hurts.length).toBe(0);
  expect(near.hurts[0].dmg).toBeCloseTo(100 * 0.06);
});

test('crystal: 반경 안 적에 slow 0.5 / slowT 4 와 기절 설정', () => {
  const { game, rp, prop } = place('frost');
  prop.x = 20; prop.z = 0;
  const near = makeEnemy(23, 0), far = makeEnemy(30, 0);
  game.enemies.push(near, far);
  rp.trigger(prop);
  expect(near.slow).toBeCloseTo(0.5);
  expect(near.slowT).toBeCloseTo(4);
  expect(near.hurts[0].opts.stun).toBeCloseTo(2.2);
  expect(far.slow).toBe(0);
  expect(far.slowT).toBe(0);
});

test('geyser: 발동 시 gather 호출, 0.6초 뒤 추가 피해 한 번', () => {
  const { game, rp, prop } = place('tide');
  prop.x = 20; prop.z = 0;
  const near = makeEnemy(26, 0);
  game.enemies.push(near);
  rp.trigger(prop);
  expect(near.gathers.length).toBe(1);
  expect(near.gathers[0].slice(0, 2)).toEqual([20, 0]);
  expect(near.stun).toBeCloseTo(0.6);
  expect(near.hurts.length).toBe(0);
  rp.update(0.5);
  expect(near.hurts.length).toBe(0);
  rp.update(0.2);
  expect(near.hurts.length).toBe(1);
  expect(near.hurts[0].dmg).toBeCloseTo(100 * 0.18);
  rp.update(1);
  expect(near.hurts.length).toBe(1);
});

test('lantern: 0.45초 간격으로 3번만 피해', () => {
  const { game, rp, prop } = place('crown');
  prop.x = 20; prop.z = 0;
  const near = makeEnemy(23, 0);
  game.enemies.push(near);
  rp.trigger(prop);
  rp.update(0.01); // 첫 파동은 즉시
  expect(near.hurts.length).toBe(1);
  rp.update(0.3);
  expect(near.hurts.length).toBe(1);
  rp.update(0.2);
  expect(near.hurts.length).toBe(2);
  rp.update(0.45);
  expect(near.hurts.length).toBe(3);
  rp.update(2);
  expect(near.hurts.length).toBe(3);
  expect(near.hurts[0].dmg).toBeCloseTo(100 * 0.09);
});

test('정예 0.3배·보스 0.12배 비율 피해, 잠복 중(under)·사망·스폰 중 적은 제외', () => {
  const { game, rp, prop } = place('forge');
  prop.x = 20; prop.z = 0;
  const normal = makeEnemy(22, 0), elite = makeEnemy(22, 1, { isElite: true }), boss = makeEnemy(22, -1, { isBoss: true });
  const under = makeEnemy(21, 0, { burrow: { phase: 'under' } }), surfaced = makeEnemy(21, 1, { burrow: { phase: 'mark' } });
  const dead = makeEnemy(21, 2, { alive: false }), spawning = makeEnemy(21, -2, { spawning: true });
  game.enemies.push(normal, elite, boss, under, surfaced, dead, spawning);
  rp.trigger(prop); rp.update(1.1);
  expect(normal.hurts[0].dmg).toBeCloseTo(45);
  expect(elite.hurts[0].dmg).toBeCloseTo(45 * 0.3);
  expect(boss.hurts[0].dmg).toBeCloseTo(45 * 0.12);
  expect(under.hurts.length).toBe(0);
  expect(dead.hurts.length).toBe(0);
  expect(spawning.hurts.length).toBe(0);
  expect(surfaced.hurts.length).toBe(1);
});

test('보스는 기절 시간이 20% 로 줄어든다', () => {
  const { game, rp, prop } = place('garden');
  prop.x = 20; prop.z = 0;
  const boss = makeEnemy(22, 0, { isBoss: true });
  game.enemies.push(boss);
  rp.trigger(prop);
  expect(boss.hurts[0].opts.stun).toBeCloseTo(1.8 * 0.2);
});

test('clearRoom: 그 방 장치만 list 에서 빼고 메시를 그룹에서 제거, 다른 방은 유지', () => {
  const { game, rp, room } = setup('garden');
  rp.placeFor(room);
  const other: any = { x: 40, z: 0, w: 14, h: 14 };
  rp.placeFor(other);
  expect(rp.list.length).toBe(2);
  const mesh = room.props[0].mesh;
  rp.clearRoom(room);
  expect(rp.list.length).toBe(1);
  expect(rp.list[0].room).toBe(other);
  expect(room.props.length).toBe(0);
  expect(rp.group.children.includes(mesh)).toBe(false);
  rp.clearRoom({ x: 1 }); // props 없는 방도 오류 없음
  expect(game.scene.children.includes(rp.group)).toBe(true);
});

test('dispose: 오류 없이 끝나고 그룹을 씬에서 떼며 목록을 비운다', () => {
  for (const theme of Object.keys(ROOM_PROPS)) {
    const s = setup(theme === 'crypt' ? 'garden' : theme);
    s.rp.placeFor(s.room);
    expect(() => s.rp.dispose()).not.toThrow();
    expect(s.rp.list.length).toBe(0);
    expect(s.game.scene.children.includes(s.rp.group)).toBe(false);
  }
});
