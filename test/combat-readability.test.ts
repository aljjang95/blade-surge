import { describe, expect, test } from 'bun:test';
import { CombatReadability, READ_COLOR, READABILITY } from '../src/game/combat-readability.js';

// 표시 층 없이(장면 없음) 규칙만 검사한다: 계측·체력 막대 유지·최소 섬광·난수 미사용.
const enemy = (over: any = {}): any => ({ alive: true, spawning: false, hp: 100, maxHp: 100, radius: .7, def: { scale: 1 }, pos: { x: 0, y: 0, z: 0 }, flashT: 0,
  flashed: [] as number[], flash(c: number, t: number) { this.flashT = t; this.flashed.push(t); }, ...over });

function battle(enemies: any[]) {
  const player = { alive: true, pos: { x: 0, z: 0 }, lockTarget: null, distTo: (o: any) => Math.hypot(o.pos.x, o.pos.z),
    nearestEnemy: () => enemies.find(e => e.alive) || null };
  return { scene: null, active: true, player, enemies, app: {} } as any;
}

describe('combat readability', () => {
  test('hit/whiff/shot stats only count the hero', () => {
    const e = enemy(), b = battle([e]), r = new CombatReadability(b);
    r.reset({ id: 'ranger', ranged: true });
    r.shot(b.player); r.shot({}); r.hit(e, 10, true, b.player); r.hit(e, 10, false, {}); r.whiff({ x: 0, y: 1, z: 0 }, b.player);
    expect(r.stats).toMatchObject({ shots: 1, hits: 1, crits: 1, whiffs: 1 });
  });
  test('every hit gives at least a short flash, but never shortens a longer one', () => {
    const e = enemy(), b = battle([e]), r = new CombatReadability(b);
    r.hit(e, 1, false, b.player);
    expect(e.flashed).toEqual([READABILITY.minFlash]);
    e.flashT = .2; r.hit(e, 1, false, b.player);
    expect(e.flashed.length).toBe(1);
  });
  test('hit marks the enemy for the hp bar and the lag bar starts at the pre-hit fill', () => {
    const e = enemy({ hp: 60 }), b = battle([e]), r = new CombatReadability(b);
    r.hit(e, 40, false, b.player);
    expect(e._rdHitT).toBe(READABILITY.barHold);
    expect(e._rdLag).toBe(1);
  });
  test('does not consume Math.random', () => {
    const e = enemy(), b = battle([e]), r = new CombatReadability(b);
    const orig = Math.random; let calls = 0; Math.random = () => { calls++; return orig(); };
    try { r.reset({ id: 'knight' }); r.hit(e, 5, true, b.player); r.whiff({ x: 1, y: 1, z: 1 }, b.player); r.update(1 / 60); } finally { Math.random = orig; }
    expect(calls).toBe(0);
  });
  test('barbarian marker colour is kept away from the enemy red', () => {
    expect(READ_COLOR.barbarian).not.toBe(0xff3b30);
    for (const id of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) expect((READ_COLOR as any)[id]).toBeGreaterThan(0);
  });
});
