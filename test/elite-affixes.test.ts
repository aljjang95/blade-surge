import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ELITE_AFFIXES, EliteAffixes, pickAffixes } from '../src/game/elite-affixes.js';

const noop: any = new Proxy(() => {}, { get: () => noop, apply: () => undefined });
const fxProxy: any = new Proxy({}, { get: () => () => {} });

function makeHero(x = 0, z = 0) {
  const hero: any = {
    alive: true, invuln: 0, yaw: 0, maxHp: 100, pos: new THREE.Vector3(x, 0, z), hurts: [] as any[], knocks: [] as any[],
    hurt(dmg: number, opts: any) { this.hurts.push({ dmg, opts }); },
    knockback(dx: number, dz: number, f: number) { this.knocks.push({ dx, dz, f }); },
  };
  return hero;
}
function makeGame(hero: any) {
  return { active: true, fx: fxProxy, ui: noop, player: hero, enemies: [] as any[], world: null };
}
function makeEnemy(game: any, hero: any, x = 0, z = 0, extra: any = {}) {
  const e: any = {
    game, player: hero, alive: true, spawning: false, state: 'chase', stun: 0, atk: 10, maxHp: 1000, hp: 1000, packId: 0, pack: null,
    telegraph: 0, atkCd: 1, flash() {}, pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(1, 0, 0),
    model: {}, hurts: [] as any[],
    distTo(o: any) { return Math.hypot(this.pos.x - o.pos.x, this.pos.z - o.pos.z); },
    hurt(dmg: number, opts: any) { this.hurts.push({ dmg, opts }); },
    ...extra,
  };
  game.enemies.push(e);
  return e;
}
function build(keys: string[], hx = 0, ex = 0) {
  const hero = makeHero(hx, 0), game = makeGame(hero), e = makeEnemy(game, hero, ex, 0);
  const aff = new EliteAffixes(e, keys);
  e.affixes = aff;
  return { hero, game, e, aff };
}

test('pickAffixes: 결과 키는 모두 ELITE_AFFIXES 안에 있다', () => {
  for (let r = 0; r < 20; r++) for (let s = 0; s < 6; s++) for (const st of [1, 3, 4, 7]) for (const el of [false, true]) {
    for (const k of pickAffixes(r, s, st, r % 3, el)) expect(k in ELITE_AFFIXES).toBe(true);
  }
});

test('pickAffixes: 4단계 미만 일반방은 1개, 4단계 이상 또는 정예방은 서로 다른 2개', () => {
  for (let r = 0; r < 20; r++) for (let s = 0; s < 6; s++) {
    expect(pickAffixes(r, s, 3, 0, false).length).toBe(1);
    expect(pickAffixes(r, s, 1, 2, false).length).toBe(1);
    for (const out of [pickAffixes(r, s, 4, 0, false), pickAffixes(r, s, 9, 1, false), pickAffixes(r, s, 2, 0, true)]) {
      expect(out.length).toBe(2);
      expect(out[0]).not.toBe(out[1]);
    }
  }
});

test('pickAffixes: 같은 입력은 항상 같은 결과', () => {
  for (let r = 0; r < 10; r++) expect(pickAffixes(r, 2, 5, 1, false)).toEqual(pickAffixes(r, 2, 5, 1, false));
});

test('pickAffixes: 방·단계 조합을 돌리면 8종이 모두 한 번 이상 나온다', () => {
  const seen = new Set<string>();
  for (let r = 0; r < 12; r++) for (let s = 0; s < 6; s++) for (const k of pickAffixes(r, s, 5, 0, false)) seen.add(k);
  expect([...seen].sort()).toEqual(Object.keys(ELITE_AFFIXES).sort());
});

test('frenzy: 거리 9 안 아군 사망마다 쌓이고 5에서 멈추며 speedMul 은 1+0.1*스택', () => {
  const { game, e, aff } = build(['frenzy']);
  expect(aff.speedMul).toBe(1);
  const ally = makeEnemy(game, e.player, 5, 0);
  for (let i = 1; i <= 5; i++) { aff.allyDied(ally); expect(aff.frenzy).toBe(i); expect(aff.speedMul).toBeCloseTo(1 + 0.1 * i); }
  aff.allyDied(ally);
  expect(aff.frenzy).toBe(5);
  expect(aff.speedMul).toBeCloseTo(1.5);
});

test('frenzy: 거리 9 밖 아군·자기 자신·죽은 정예는 스택이 안 쌓인다', () => {
  const { game, e, aff } = build(['frenzy']);
  aff.allyDied(makeEnemy(game, e.player, 9.5, 0));
  aff.allyDied(e);
  expect(aff.frenzy).toBe(0);
  e.alive = false;
  aff.allyDied(makeEnemy(game, e.player, 2, 0));
  expect(aff.frenzy).toBe(0);
  // frenzy 접두사가 없으면 쌓이지 않는다
  const other = build(['volatile']);
  other.aff.allyDied(makeEnemy(other.game, other.e.player, 2, 0));
  expect(other.aff.frenzy).toBe(0);
});

test('warding: 방패막 중 반경 7 안 아군 피해 0.4배, 밖이거나 꺼져 있으면 그대로', () => {
  const { game, e, aff } = build(['warding']);
  const near = makeEnemy(game, e.player, 6, 0), far = makeEnemy(game, e.player, 8, 0);
  expect(aff.wardFilter(near, 100)).toBe(100);
  aff.wardOn = 3;
  expect(aff.wardFilter(near, 100)).toBeCloseTo(40);
  expect(aff.wardFilter(far, 100)).toBe(100);
});

test('warding: update 로 7초 주기 방패막이 켜지고 정예가 최대 체력 8% 이상 받으면 깨지며 기절', () => {
  const { e, aff } = build(['warding']);
  aff.update(3.1, 5);
  expect(aff.wardOn).toBeGreaterThan(0);
  expect(aff.wardHp).toBeCloseTo(80);
  // 8% 미만은 유지
  expect(aff.wardFilter(e, 50)).toBe(50);
  expect(aff.wardOn).toBeGreaterThan(0);
  // 누적 8% 이상이면 깨짐
  aff.wardFilter(e, 40);
  expect(aff.wardOn).toBe(0);
  expect(e.stun).toBeGreaterThanOrEqual(0.8);
});

test('warding: breakWard 는 방패막이 꺼져 있으면 아무 일도 하지 않는다', () => {
  const { e, aff } = build(['warding']);
  aff.breakWard();
  expect(e.stun).toBe(0);
  aff.wardOn = 2; aff.breakWard();
  expect(aff.wardOn).toBe(0);
  expect(e.stun).toBeGreaterThanOrEqual(0.8);
});

test('tether: 추격 중 거리 3.5~12 에서 쿨다운이 끝나면 1초 예고(true, 속도 0) 뒤 영웅을 끌고 피해', () => {
  const { hero, e, aff } = build(['tether'], 8, 0);
  expect(aff.update(1, 8)).toBe(false); // 쿨다운 5초 남음
  expect(aff.update(4.1, 8)).toBe(true);
  expect(aff.tetherT).toBeCloseTo(1);
  e.vel.set(3, 0, 0);
  expect(aff.update(0.5, 8)).toBe(true);
  expect(e.vel.length()).toBe(0);
  expect(hero.knocks.length).toBe(0);
  expect(aff.update(0.6, 8)).toBe(true);
  expect(hero.knocks.length).toBe(1);
  expect(hero.hurts.length).toBe(1);
  expect(hero.hurts[0].dmg).toBeCloseTo(e.atk * 0.6);
  expect(hero.knocks[0].f).toBeCloseTo(Math.min(16, 8 * 2.2));
});

test('tether: 영웅이 invuln 이면 끌려가지도 맞지도 않는다', () => {
  const { hero, aff } = build(['tether'], 8, 0);
  aff.update(5.1, 8);
  hero.invuln = 0.3;
  aff.update(1.1, 8);
  expect(hero.knocks.length).toBe(0);
  expect(hero.hurts.length).toBe(0);
});

test('tether: chase 가 아니거나 거리 범위 밖이면 시작하지 않는다', () => {
  for (const [state, d] of [['idle', 8], ['chase', 3], ['chase', 12.5]] as const) {
    const { e, aff } = build(['tether'], 8, 0);
    e.state = state;
    expect(aff.update(6, d)).toBe(false);
    expect(aff.tetherT).toBe(-1);
  }
});

test('volatile: onDeath 1.2초 뒤 반경 4.4 안 적과 영웅에게 폭발 피해, 밖은 무사', () => {
  const { hero, game, e, aff } = build(['volatile'], 3, 0);
  const near = makeEnemy(game, hero, 2, 2), far = makeEnemy(game, hero, 10, 0);
  e.alive = false;
  aff.onDeath();
  expect(aff.deathT).toBeCloseTo(1.2);
  aff.update(1.0, 3);
  expect(near.hurts.length).toBe(0);
  expect(hero.hurts.length).toBe(0);
  aff.update(0.3, 3);
  expect(near.hurts.length).toBe(1);
  expect(near.hurts[0].dmg).toBeCloseTo(e.atk * 4);
  expect(far.hurts.length).toBe(0);
  expect(e.hurts.length).toBe(0);
  expect(hero.hurts.length).toBe(1);
  expect(hero.hurts[0].dmg).toBeCloseTo(e.atk * 2);
  // 한 번만 터진다
  aff.update(1, 3);
  expect(near.hurts.length).toBe(1);
});

test('volatile: 영웅이 반경 밖이면 영웅은 안 다친다', () => {
  const { hero, e, aff } = build(['volatile'], 6, 0);
  e.alive = false; aff.onDeath(); aff.update(1.3, 6);
  expect(hero.hurts.length).toBe(0);
});

test('commandMul: 지휘관 접두사 생존 리더가 10 안이면 1.35, 아니면 1', () => {
  const { game, hero, e, aff } = build(['commander'], 0, 0);
  const pack: any = { leader: e };
  e.pack = pack;
  const minion = makeEnemy(game, hero, 5, 0, { pack });
  expect(EliteAffixes.commandMul(minion)).toBe(1.35);
  minion.pos.set(10.5, 0, 0);
  expect(EliteAffixes.commandMul(minion)).toBe(1);
  minion.pos.set(5, 0, 0);
  e.alive = false;
  expect(EliteAffixes.commandMul(minion)).toBe(1);
  e.alive = true;
  e.affixes = new EliteAffixes(e, ['frenzy']);
  expect(EliteAffixes.commandMul(minion)).toBe(1);
  e.affixes = aff;
  expect(EliteAffixes.commandMul(e)).toBe(1); // 리더 자신
  expect(EliteAffixes.commandMul(makeEnemy(game, hero, 1, 0))).toBe(1); // 무리 없음
});
