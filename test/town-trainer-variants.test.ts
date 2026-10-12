import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { SKILLS } from '../src/game/skills.js';
import { HEROES } from '../src/data/heroes.js';
import { TOWN_TRAINER } from '../src/data/towns.js';

const HERO_DEFS = HEROES as Record<string, any>;

// 어떤 속성이든 호출 가능한 무동작 객체 — 연출(fx·renderer·orb)만 흡수하고 판정 기록에는 섞이지 않는다.
const inert: any = new Proxy(function () {}, { get: (_t, key) => key === Symbol.toPrimitive ? () => 0 : inert, apply: () => inert });
const plain = (value: unknown): unknown => value instanceof THREE.Vector3 ? value.toArray().map(n => +n.toFixed(3))
  : Array.isArray(value) ? value.map(plain)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => !['source', 'owner', 'skillCast', 'trail', 'visual'].includes(k)).map(([k, v]) => [k, plain(v)]))
  : typeof value === 'number' ? +value.toFixed(3) : value;

function runSkill(heroId: string, skillId: string, learned: string[]) {
  const log: unknown[] = [], timers: Array<() => void> = [];
  const enemy: any = { alive: true, spawning: 0, isBoss: false, isElite: false, radius: .6, pos: new THREE.Vector3(0, 0, 3),
    gather: (...args: unknown[]) => { log.push(['gather', ...args.map(plain)]); return true; } };
  const game: any = {
    active: true, enemies: [enemy], input: { move: { x: 0, y: 0 } }, fx: inert, renderer: inert, timeCtl: inert, scene: inert, ui: inert,
    app: { eco: { s: { towns: { learned: { [heroId]: learned } } } } },
    after: (_t: number, run: () => void) => timers.push(run),
    hitRadius: (...args: unknown[]) => log.push(['hitRadius', ...args.map(plain)]),
    hitArea: (...args: unknown[]) => log.push(['hitArea', ...args.slice(1).map(plain)]),
    spawnProjectile: (spec: unknown) => log.push(['projectile', plain(spec)]),
    vacuum: (...args: unknown[]) => log.push(['vacuum', ...args.map(plain)]),
    damageEnemy: (_e: unknown, ...args: unknown[]) => log.push(['damage', ...args.map(plain)]),
    hasProc: () => false, skillCooldown: (s: number) => s,
  };
  const p: any = { def: HERO_DEFS[heroId], game, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, alive: true,
    stats: { spd: 6 }, buffs: {}, jobResource: 0, model: inert, beacon: inert,
    forward: (out: THREE.Vector3) => out.set(0, 0, 1), distTo: (e: any) => e.pos.length(), nearestEnemy: () => enemy,
    gainJobResource() {}, play() {}, playTimed() {}, startTrail() {}, stopTrail() {}, face() {} };
  game.player = p;
  const impl: any = (SKILLS as any)[skillId], c: any = { dmg: 100, data: {}, t: 0, cast: false, level: 1 };
  impl.start?.(game, p, c);
  impl.cast?.(game, p, c); c.cast = true;
  for (let t = 0; t < (impl.total || impl.dur || .8); t += .05) { c.t = t; impl.update?.(game, p, c, .05); }
  impl.end?.(game, p, c);
  for (let i = 0; i < timers.length && i < 400; i++) timers[i]();
  return JSON.stringify(log);
}

test('판매되는 교관 기술 15종은 모두 습득 전후로 실제 판정·투사체·흡인 기록을 바꾼다', () => {
  expect(TOWN_TRAINER).toHaveLength(15);
  for (const offer of TOWN_TRAINER) {
    expect(HERO_DEFS[offer.heroId].skills.some((skill: any) => skill.id === offer.skillId)).toBe(true);
    const before = runSkill(offer.heroId, offer.skillId, []), after = runSkill(offer.heroId, offer.skillId, [offer.id]);
    expect({ offer: offer.id, changed: before !== after }).toEqual({ offer: offer.id, changed: true });
    // 같은 조건을 다시 돌리면 같은 기록이 나와 차이가 우연이 아님을 보인다.
    expect(runSkill(offer.heroId, offer.skillId, [offer.id])).toBe(after);
  }
});

test('다른 영웅의 습득 기록은 이 영웅의 스킬을 바꾸지 않는다', () => {
  expect(runSkill('knight', 'shield_bash', [])).toBe(runSkill('knight', 'shield_bash', ['oathhold_barbarian_aftershock']));
});
