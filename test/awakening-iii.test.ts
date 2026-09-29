import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { AWAKENING_III, solarLaneNodes } from '../src/game/awakening-iii.js';
import { HEROES } from '../src/data/heroes.js';
import { SKILLS } from '../src/game/skills.js';
import { audio } from '../src/engine/audio.js';

test('solar lane nodes advance in a deterministic forward line', () => {
  const nodes = solarLaneNodes(new THREE.Vector3(2, 1, 3), new THREE.Vector3(1, 0, 0));
  expect(nodes.map(n => n.toArray())).toEqual([[4.5, 0, 3], [7, 0, 3], [9.5, 0, 3], [12, 0, 3]]);
  expect(solarLaneNodes(new THREE.Vector3(), new THREE.Vector3())[0].z).toBe(2.5);
  expect(HEROES.knight.skills[6].unlock).toBe(30);
  expect(SKILLS.sunbreaker).toBe(AWAKENING_III.sunbreaker);
});

test('Sunbreaker travels out, returns with vacuum, and caps each enemy to one hit per pass', () => {
  const enemy: any = { alive: true, spawning: 0, radius: .6, pos: new THREE.Vector3(0, 0, 5) };
  const player: any = { alive: true, pos: new THREE.Vector3(), forward: (out: THREE.Vector3) => out.set(0, 0, 1) };
  const timers: { at: number; run: () => void }[] = [], hits: number[] = [], pulls: number[] = [], beams: number[] = [], slashes: number[] = [];
  const game: any = { active: true, enemies: [enemy], after: (at: number, run: () => void) => timers.push({ at, run }),
    damageEnemy: (_e: unknown, dmg: number) => hits.push(dmg), vacuum: (at: THREE.Vector3) => pulls.push(at.z),
    fx: { groundTex() {}, shockTex() {}, holyBurst() {}, boltTex(from: THREE.Vector3, to: THREE.Vector3) { beams.push(to.z - from.z); },
      slashSprite(_at: THREE.Vector3, dir: THREE.Vector3) { slashes.push(dir.z); } } };
  const ctx: any = { dmg: 100, data: {} };
  AWAKENING_III.sunbreaker.cast(game, player, ctx);
  expect(ctx.data.solarLane.map((n: THREE.Vector3) => n.z)).toEqual([2.5, 5, 7.5, 10]);
  expect(timers).toHaveLength(8);
  timers.sort((a, b) => a.at - b.at).forEach(t => t.run());
  expect(hits).toHaveLength(2);
  expect(hits[0]).toBeCloseTo(100);
  expect(hits[1]).toBeCloseTo(75);
  expect(pulls).toEqual([7.5, 5, 2.5, 0]);
  expect(beams.filter(x => x > 0)).toHaveLength(5); // persistent lane plus four outward pulses
  expect(beams.filter(x => x < 0)).toHaveLength(4);
  expect(slashes).toEqual([1, 1, 1, 1, -1, -1, -1, -1]);
});

test('delayed solar pulses stop after battle exit or player death', () => {
  const timers: (() => void)[] = [], events: string[] = [];
  const player: any = { alive: true, pos: new THREE.Vector3(), forward: (out: THREE.Vector3) => out.set(0, 0, 1) };
  const game: any = { active: true, enemies: [], after: (_at: number, run: () => void) => timers.push(run),
    damageEnemy: () => events.push('hit'), vacuum: () => events.push('pull'),
    fx: { groundTex() {}, shockTex: () => events.push('shock'), holyBurst: () => events.push('burst'), boltTex: () => events.push('beam'), slashSprite: () => events.push('slash') } };
  AWAKENING_III.sunbreaker.cast(game, player, { dmg: 100, data: {} });
  expect(events).toEqual(['beam']);
  events.length = 0;
  game.active = false; timers.forEach(run => run());
  expect(events).toEqual([]);
  game.active = true; player.alive = false; timers.forEach(run => run());
  expect(events).toEqual([]);
});

test('the wider lane reaches nearby flank enemies without becoming a radial hit', () => {
  const near: any = { alive: true, spawning: 0, radius: .6, pos: new THREE.Vector3(3.1, 0, 5) };
  const far: any = { alive: true, spawning: 0, radius: .6, pos: new THREE.Vector3(3.8, 0, 5) };
  const player: any = { alive: true, pos: new THREE.Vector3(), forward: (out: THREE.Vector3) => out.set(0, 0, 1) };
  const timers: { at: number; run: () => void }[] = [], hits = new Map<any, number>();
  const game: any = { active: true, enemies: [near, far], after: (at: number, run: () => void) => timers.push({ at, run }),
    damageEnemy: (enemy: any, dmg: number) => hits.set(enemy, (hits.get(enemy) || 0) + dmg), vacuum() {},
    fx: { groundTex() {}, boltTex() {}, slashSprite() {}, shockTex() {}, holyBurst() {} } };
  AWAKENING_III.sunbreaker.cast(game, player, { dmg: 100, data: {} });
  timers.sort((a, b) => a.at - b.at).forEach(t => t.run());
  expect(hits.get(near)).toBeCloseTo(175);
  expect(hits.has(far)).toBe(false);
});

test('the first uncached skill shout plays once after loading, and never after battle exit', async () => {
  const sound = audio as any;
  const saved = { load: sound._loadVoice, bark: sound.bark, buffer: sound.voiceBuf.hero_knight_skill6 };
  const played: string[] = [];
  let finish!: (value: object) => void;
  try {
    delete sound.voiceBuf.hero_knight_skill6;
    sound._loadVoice = () => new Promise<object>(resolve => { finish = resolve; });
    sound.bark = (name: string) => played.push(name);
    const game: any = { active: true };
    const player: any = { alive: true, skillCtx: { sk: { id: 'sunbreaker' } } };
    AWAKENING_III.sunbreaker.start(game, player);
    finish({}); await Promise.resolve();
    expect(played).toEqual(['hero_knight_skill6']);

    sound.voiceBuf.hero_knight_skill6 = {};
    AWAKENING_III.sunbreaker.start(game, player);
    expect(played).toHaveLength(1);

    delete sound.voiceBuf.hero_knight_skill6;
    AWAKENING_III.sunbreaker.start(game, player);
    game.active = false;
    finish({}); await Promise.resolve();
    expect(played).toHaveLength(1);
  } finally {
    sound._loadVoice = saved.load; sound.bark = saved.bark;
    if (saved.buffer) sound.voiceBuf.hero_knight_skill6 = saved.buffer;
    else delete sound.voiceBuf.hero_knight_skill6;
  }
});
