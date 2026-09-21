import { afterEach, expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import { weeklyFrontier } from '../src/data/seasonal-content.js';
import { BOSS_SIGNATURES } from '../src/data/boss-encounters.js';
import { ENEMIES } from '../src/data/stages.js';
import { Actor } from '../src/game/actor.js';
import { Enemy } from '../src/game/enemies.js';
import { Player } from '../src/game/player.js';
import { DropSystem } from '../src/game/drops.js';
import { BossSignatures, planBossSignature } from '../src/game/boss-signatures.js';
import { RegionHazards, hazardContains, hazardPattern } from '../src/game/region-hazards.js';
import { isRecoveryOpportunity } from '../src/game/apex-combat.js';
import { PartyCombatEffects, validPartyWarning } from '../src/party/combat-effects.js';

const noop = () => {};
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

// Real authored weekly snapshots exercise the production stage validator too.
const frontiers = new Map<string, any>();
for (let day = 1; day <= 365; day++) {
  const frontier = weeklyFrontier(new Date(Date.UTC(2026, 0, day)));
  frontiers.set(frontier.effectId, frontier);
}
function stageFor(effectId?: string, boundary = 'solo'): any {
  const frontier = effectId ? frontiers.get(effectId) : null;
  if (effectId && !frontier) throw Error(`Missing authored frontier: ${effectId}`);
  const stage: any = { scale: 1, chapter: { theme: 'frost' }, encounter: { rank: 'finalboss' },
    expedition: { kind: 'dungeon', id: frontier?.routeId || 'star_archive', depth: 'standard' },
    ...(frontier ? { frontier } : {}) };
  if (boundary === 'campaign') delete stage.expedition;
  if (boundary === 'party') stage.party = { id: 'party' };
  if (boundary === 'arena') stage.expedition.kind = 'arena';
  if (boundary === 'deep') stage.expedition.depth = 'deep';
  if (boundary === 'rift') stage.riftId = 'test-rift';
  if (boundary === 'conquest') stage.expedition.conquestId = 'test-conquest';
  if (boundary === 'route') stage.expedition.id = 'unrelated-route';
  if (boundary === 'invalid') stage.frontier = { effects: frontier?.effects };
  return stage;
}

function combatFixture(stage = stageFor()) {
  const room: any = { x: 0, z: 0, w: 26, h: 24, type: 'normal', spawned: true, cleared: false };
  const start: any = { type: 'start', cleared: true }, treasure: any = { type: 'treasure', cleared: true };
  let currentRoom: any = room;
  const damage: number[] = [];
  let perfects = 0;
  const game: any = { stage, scene: new THREE.Scene(), active: true, paused: false, elapsed: 0,
    roomsCleared: 2, enemies: [],
    world: { rooms: [start, treasure, room], roomAt: () => currentRoom },
    fx: { damage: (_p: any, amount: number) => damage.push(amount), burst: noop, dust: noop, embers: noop },
    renderer: { shake: noop, flashScreen: noop, camera: new THREE.PerspectiveCamera() },
    ui: { toast: noop, hurtVignette: noop, flyReward: noop }, hasProc: () => false,
    onPerfectDodge: () => { perfects++; }, rollDrop: () => null };
  // Only skeletal/audio presentation is stubbed; movement, dodge, damage and CDs are production methods.
  const player: any = Object.create(Player.prototype);
  Object.assign(player, { game, alive: true, pos: new THREE.Vector3(), vel: new THREE.Vector3(), moveDir: new THREE.Vector3(),
    stats: { def: 0, spd: 10 }, buffs: { spd: 1 }, hp: 1000, maxHp: 1000, invuln: 0,
    def: { id: 'test', skills: [{}, {}, {}, { ult: true }, {}] }, cds: [4, .5, 0, 30, 7],
    perfectWindow: 0, perfectCd: 0, dodgeCd: 0, state: 'idle', sprintT: 0, footT: 0, stun: 0,
    action: {}, play: noop, flash: noop, knockback: noop, stopTrail: noop });
  game.player = player;
  game.app = { party: { livingPlayers: () => [player] } };
  return { game, player, room, start, treasure, damage, perfects: () => perfects,
    setRoom: (next: any) => { currentRoom = next; } };
}
function regionFixture(stage = stageFor(), theme = 'frost') {
  stage.chapter.theme = theme;
  const f = combatFixture(stage), hazards = new RegionHazards(f.game);
  hazards.room = f.room; hazards.cooldown = 99;
  cleanup.push(() => hazards.dispose());
  return { ...f, hazards };
}
function bossFixture(stage = stageFor()) {
  const f = combatFixture(stage);
  const enemy: any = Object.create(Enemy.prototype);
  Object.assign(enemy, { game: f.game, def: (ENEMIES as any).garden_finalboss, pos: new THREE.Vector3(),
    homeRoom: f.room, alive: true, spawning: false, state: 'attack', stateT: 0, phase: 0, patternTurn: 0,
    hp: 100, maxHp: 100, attackSequence: 1, atk: 100, yaw: 0, isBoss: true, stun: 0,
    vel: new THREE.Vector3(), rig: { hit: [] }, A: (s: string) => s, playTimed: noop, play: noop });
  const caster = new BossSignatures(enemy); enemy.signatures = caster; f.game.enemies = [enemy];
  cleanup.push(() => caster.dispose());
  return { ...f, enemy, caster };
}
function moveSpeed(stage: any, sprint = false, slow = false) {
  const f = combatFixture(stage); f.player.sprintT = sprint ? 1.5 : 0; f.player.slow = slow ? .5 : 0;
  f.player.handleInput({ move: { x: 1, y: 0 }, consume: () => false }, .01);
  return f.player.vel.x;
}
function takeHit(stage: any) {
  const f = combatFixture(stage); f.player.hurt(100); return 1000 - f.player.hp;
}
function perfectDodge(stage: any) {
  const f = combatFixture(stage); f.player.dodge(new THREE.Vector3(1, 0, 0));
  expect(f.perfects()).toBe(0); expect(f.player.cds).toEqual([4, .5, 0, 30, 7]);
  expect(f.player.hurt(100)).toBe(false);
  return f;
}
function collectedGold(stage: any, summoned = false, rank = 'normal') {
  const f = combatFixture(stage), drops: any = Object.create(DropSystem.prototype);
  Object.assign(drops, { game: f.game, scene: f.game.scene, items: [], magnetR: 4.2, pickR: 1.1, _matCache: {}, _lootMaterials: new Map() });
  drops.clear(); drops.setup(null);
  cleanup.push(() => {
    drops.clear(); drops._geoCoin.dispose(); drops._matCoin.dispose();
    for (const material of Object.values(drops._matCache) as THREE.Material[]) material.dispose();
  });
  const random = spyOn(Math, 'random').mockReturnValue(.5);
  try {
    drops.onKill({ pos: new THREE.Vector3(), def: { gold: 10 }, summoned, isBoss: rank === 'boss', isElite: rank === 'elite' }, stage);
    const gold = drops.items.filter((item: any) => item.kind === 'gold');
    for (const item of gold) drops.collect(item);
    return { gold: drops.gold, coins: gold.length };
  } finally { random.mockRestore(); }
}

for (const [effectId, lead] of [['telegraph_lead', .3], ['signature_lead', .2]] as const) {
  test(`${effectId}: every signature/phase delays real strikes, keeps warning starts and recovery length`, () => {
    const f = bossFixture(stageFor(effectId));
    for (const key of Object.keys(BOSS_SIGNATURES)) for (const phase of [0, 1, 2]) {
      f.enemy.phase = phase;
      const base = planBossSignature(key, { room: f.room, origin: f.enemy.pos, target: f.player.pos, phase })!;
      const plan = f.caster.start(key);
      expect(plan.events).toHaveLength(base.events.length);
      for (let i = 0; i < plan.events.length; i++) {
        expect(plan.events[i]).toEqual({ ...base.events[i], at: base.events[i].at + lead });
        expect(plan.events[i].at - plan.events[i].warnAt).toBeCloseTo(base.events[i].at - base.events[i].warnAt + lead);
      }
      expect(plan.lastStrike).toBeCloseTo(base.lastStrike + lead);
      expect(plan.duration).toBeCloseTo(base.duration + lead);
      expect(plan.duration - plan.lastStrike).toBeCloseTo(base.duration - base.lastStrike);
      const first = plan.events.find(event => event.warnAt === 0);
      if (first) expect(f.caster.warnings()[0].remaining).toBe(first.at);
    }
  });

  test(`${effectId}: Enemy attack clock hits only after extra lead and opens recovery after final hit`, () => {
    const actorUpdate = spyOn(Actor.prototype, 'update').mockImplementation(noop);
    try {
      const f = bossFixture(stageFor(effectId)); f.player.pos.x = 3.5;
      f.enemy.startAttack(3.5);
      const plan = f.caster.plan!;
      expect(f.enemy.attackDur).toBe(plan.duration);
      expect(f.enemy.telegraph).toBe(plan.lastStrike);
      const first = plan.events[0];
      f.enemy.update(first.at - lead + .001);
      expect(f.damage).toHaveLength(0); expect(f.caster.fired).toBe(0);
      f.enemy.update(lead - .002); expect(f.damage).toHaveLength(0);
      f.enemy.update(.002); expect(f.damage).toHaveLength(1); expect(f.caster.fired).toBe(1);
      f.enemy.update(0); expect(f.damage).toHaveLength(1);
      f.enemy.update(plan.lastStrike - lead - f.enemy.stateT);
      expect(f.enemy.attackDone).toBe(false); expect(isRecoveryOpportunity(f.enemy)).toBe(false);
      f.enemy.update(lead + .001);
      expect(f.enemy.attackDone).toBe(true); expect(isRecoveryOpportunity(f.enemy)).toBe(true);
      f.enemy.update(plan.duration - f.enemy.stateT + .001);
      expect(f.enemy.state).toBe('chase'); expect(f.caster.plan).toBeNull();
    } finally { actorUpdate.mockRestore(); }
  });
}

test('frontier signature cancellation cannot resurrect a delayed or generic hit; invalid key fails before events access', () => {
  const actorUpdate = spyOn(Actor.prototype, 'update').mockImplementation(noop);
  try {
    for (const effect of ['telegraph_lead', 'signature_lead']) for (const reason of ['death', 'stun', 'hurt', 'inactive', 'bossDefeated', 'clear']) {
      const f = bossFixture(stageFor(effect)); let genericHits = 0;
      f.enemy.doAttack = () => genericHits++; f.enemy.startAttack(3.5);
      if (reason === 'death') f.enemy.alive = false;
      if (reason === 'stun') f.enemy.stun = 2;
      if (reason === 'hurt') f.enemy.state = 'hurt';
      if (reason === 'inactive') f.game.active = false;
      if (reason === 'bossDefeated') f.game.bossDefeated = true;
      if (reason === 'clear') f.caster.clear();
      f.caster.update(4); f.enemy.update(.1); f.enemy.update(3.5);
      expect(f.damage).toEqual([]); expect(genericHits).toBe(0); expect(f.caster.warnings()).toEqual([]);
    }
    const f = bossFixture(stageFor('signature_lead')); f.caster.start('bell_toll');
    expect(() => f.caster.start('unknown')).toThrow('Unknown boss signature: unknown');
    expect(f.caster.plan).toBeNull(); expect(f.caster.slots.every(slot => !slot.mesh.visible)).toBe(true);
  } finally { actorUpdate.mockRestore(); }
});

test('region telegraph adds .3 to actual warning/strike delay, and signature-only lead leaves it unchanged', () => {
  for (const theme of ['garden', 'forge', 'frost', 'tide', 'crown']) for (const effect of ['telegraph_lead', 'signature_lead']) {
    const f = regionFixture(stageFor(effect), theme);
    const base = hazardPattern(theme, f.room, f.player.pos, 0, false);
    f.hazards.spawn(f.room);
    expect(f.hazards.slots.filter(slot => slot.hazard).map((slot: any) => slot.hazard.delay))
      .toEqual(base.map(h => h.delay + (effect === 'telegraph_lead' ? .3 : 0)));
    expect(f.hazards.getPartyWarnings().map(warning => warning.duration))
      .toEqual(f.hazards.slots.filter(slot => slot.hazard).map((slot: any) => slot.hazard.delay));
  }
  const f = regionFixture(stageFor('telegraph_lead'));
  f.hazards.spawn(f.room); f.hazards.update(1.701);
  expect(f.damage).toHaveLength(0); expect(f.hazards.slots[0].mesh.material.uniforms.fired.value).toBe(0);
  f.hazards.update(.298); expect(f.damage).toHaveLength(0);
  f.hazards.update(.002); expect(f.damage).toEqual([60]); expect(f.player.slowT).toBe(1.2);
  f.hazards.update(.01); expect(f.damage).toHaveLength(1);
});

test('pending frontier hazards cancel on room/game changes and delayed invulnerable hits apply no slow', () => {
  for (const reason of ['cleared', 'room', 'inactive', 'paused', 'bossDefeated', 'dead']) {
    const f = regionFixture(stageFor('telegraph_lead')); f.hazards.spawn(f.room); f.hazards.update(.4);
    if (reason === 'cleared') f.room.cleared = true;
    if (reason === 'room') f.setRoom(f.start);
    if (reason === 'inactive') f.game.active = false;
    if (reason === 'paused') f.game.paused = true;
    if (reason === 'bossDefeated') f.game.bossDefeated = true;
    if (reason === 'dead') f.player.alive = false;
    f.hazards.update(2.1);
    expect(f.damage).toEqual([]); expect(f.hazards.getPartyWarnings()).toEqual([]);
    expect(f.hazards.slots.every(slot => !slot.mesh.visible)).toBe(true);
  }
  const f = regionFixture(stageFor('telegraph_lead'));
  f.player.invuln = 1; f.hazards.spawn(f.room); f.hazards.update(2.01);
  expect(f.damage).toEqual([]); expect(f.player.slowT).toBeUndefined(); expect(f.hazards.hits).toBe(0);
});

test('smaller region circles/lanes preserve safe ground, length and matching local/party warning geometry', () => {
  for (const theme of ['garden', 'forge', 'frost', 'tide', 'crown']) for (const cycle of [0, 1]) {
    const f = regionFixture(stageFor('hazard_radius'), theme); f.hazards.cycle = cycle;
    const base = hazardPattern(theme, f.room, f.player.pos, cycle, false);
    f.hazards.spawn(f.room);
    const warnings = f.hazards.getPartyWarnings(); expect(warnings.every(validPartyWarning)).toBe(true);
    const remote = new PartyCombatEffects(new THREE.Scene()); cleanup.push(() => remote.dispose()); remote.update(warnings);
    const visible = remote.slots.filter(slot => slot.mesh.visible);
    for (let i = 0; i < base.length; i++) {
      const h: any = f.hazards.slots[i].hazard!, original: any = base[i], mesh = f.hazards.slots[i].mesh;
      if (h.type === 'lane') {
        expect(h.width).toBeCloseTo(original.width * .9); expect(h.length).toBe(original.length);
        expect(h.safeRadius).toBe(original.safeRadius);
      } else {
        expect(h.radius).toBeCloseTo(original.radius * .9);
        if (h.type === 'ring') expect(h.safeRadius).toBeCloseTo(original.radius * .78);
      }
      expect(warnings[i].radius).toBe(h.radius || 0); expect(warnings[i].width).toBe(h.width || 0);
      expect(mesh.scale.x).toBe(h.type === 'lane' ? h.length : h.radius * 2);
      expect(mesh.scale.z).toBe(h.type === 'lane' ? h.width : h.radius * 2);
      expect(mesh.material.uniforms.safeRadius.value).toBe(h.safeRadius);
      expect(visible[i].mesh.scale.x).toBeCloseTo(mesh.scale.x);
      expect(visible[i].mesh.scale.z).toBeCloseTo(mesh.scale.z);
      expect(visible[i].mesh.material.uniforms.safeRadius.value).toBe(h.safeRadius);
      for (let x = -12; x <= 12; x += .37) for (let z = -12; z <= 12; z += .37) {
        if (hazardContains(h, x, z)) expect(hazardContains(original, x, z)).toBe(true);
      }
      // Put the real player in the removed outer strip, then inside retained danger.
      const r = h.type === 'lane' ? original.width * .475 : original.radius * .95;
      f.player.pos.set(h.x + (h.type === 'lane' ? -Math.sin(h.angle) : 1) * r, 0,
        h.z + (h.type === 'lane' ? Math.cos(h.angle) : 0) * r);
      expect(hazardContains(h, f.player.pos.x, f.player.pos.z)).toBe(false);
    }
  }
  const f = regionFixture(stageFor('hazard_radius'));
  f.hazards.spawn(f.room); f.player.pos.x = 2.2; f.hazards.update(1.71);
  expect(f.damage).toEqual([]); // Old disk radius 2.3 hit here; radius 2.07 does not.
  f.player.pos.x = 0; f.hazards.spawn(f.room); f.hazards.update(1.71); expect(f.damage).toEqual([60]);
});

test('warning color changes region and signature meshes/warning data and resets on next unmodified cast', () => {
  const region = regionFixture(stageFor('warning_color'));
  const boss = bossFixture(stageFor('warning_color'));
  region.hazards.spawn(region.room); const plan = boss.caster.start('bell_toll');
  expect(plan.color).toBe(0x78f7ff);
  for (const warning of [...region.hazards.getPartyWarnings(), ...boss.caster.warnings()]) expect(warning.color).toBe(0x78f7ff);
  for (const slot of [...region.hazards.slots.filter(s => s.hazard), ...boss.caster.slots.filter(s => s.event)]) {
    expect(slot.mesh.material.uniforms.color.value.getHex()).toBe(0x78f7ff);
  }
  region.game.stage = stageFor(); boss.game.stage = stageFor();
  region.hazards.spawn(region.room); boss.caster.start('bell_toll');
  expect(region.hazards.getPartyWarnings()[0].color).not.toBe(0x78f7ff);
  expect(boss.caster.warnings()[0].color).not.toBe(0x78f7ff);
});

test('movement multiplier reaches real velocity and composes with sprint and slow', () => {
  expect(moveSpeed(stageFor('route_speed'))).toBeCloseTo(11);
  expect(moveSpeed(stageFor('route_speed'), true)).toBeCloseTo(15.95);
  expect(moveSpeed(stageFor('route_speed'), true, true)).toBeCloseTo(7.975);
});

test('first combat protection ignores cleared start/treasure and stops after any combat room clears', () => {
  const f = combatFixture(stageFor('first_room_guard'));
  expect(f.game.roomsCleared).toBe(2); f.player.hurt(100); expect(f.damage).toEqual([85]);
  const later = { ...f.room }; f.game.world.rooms.push(later); f.room.cleared = true; f.setRoom(later);
  f.game.roomsCleared = 0; f.player.hurt(100); expect(f.damage).toEqual([85, 100]);
  for (const type of ['start', 'treasure']) {
    const g = combatFixture(stageFor('first_room_guard')); g.room.type = type;
    g.player.hurt(100); expect(g.damage).toEqual([100]);
  }
  for (const type of ['normal', 'elite', 'boss']) {
    const g = combatFixture(stageFor('first_room_guard')); g.room.type = type;
    g.player.hurt(100); expect(g.damage).toEqual([85]);
  }
});

test('confirmed perfect dodge reduces ordinary CDs once, floors zero and leaves ultimate/perfect/dodge gates intact', () => {
  const f = perfectDodge(stageFor('perfect_reset'));
  expect(f.perfects()).toBe(1); expect(f.player.cds).toEqual([3, 0, 0, 30, 6]);
  expect(f.player.perfectCd).toBe(1.2); const dodgeCd = f.player.dodgeCd;
  f.player.hurt(100); expect(f.perfects()).toBe(1); expect(f.player.cds).toEqual([3, 0, 0, 30, 6]);
  expect(f.player.dodgeCd).toBe(dodgeCd); expect(f.player.hp).toBe(1000);
  for (const [window, cooldown, invuln] of [[0, 0, 1], [.28, .5, 1], [.28, 0, 0]]) {
    const g = combatFixture(stageFor('perfect_reset'));
    g.player.perfectWindow = window; g.player.perfectCd = cooldown; g.player.invuln = invuln;
    g.player.hurt(100); expect(g.perfects()).toBe(0); expect(g.player.cds).toEqual([4, .5, 0, 30, 7]);
  }
});

test('gold per kill is exactly two collectible gold per real kill, never multiplied by elite/boss coin count or paid for summons', () => {
  for (const rank of ['normal', 'elite', 'boss']) {
    const base = collectedGold(stageFor(), false, rank), boosted = collectedGold(stageFor('ash_drop'), false, rank);
    expect(boosted.gold - base.gold).toBe(2); expect(boosted.coins - base.coins).toBe(1);
    expect(collectedGold(stageFor('ash_drop'), true, rank)).toEqual(base);
  }
});

for (const boundary of ['campaign', 'party', 'arena', 'deep', 'rift', 'conquest', 'route', 'invalid']) {
  test(`${boundary}: all frontier combat hooks reject ineligible stages and keep party warnings callable`, () => {
    expect(moveSpeed(stageFor('route_speed', boundary))).toBe(10);
    expect(takeHit(stageFor('first_room_guard', boundary))).toBe(100);
    const dodge = perfectDodge(stageFor('perfect_reset', boundary));
    expect(dodge.player.cds).toEqual([4, .5, 0, 30, 7]); expect(dodge.player.perfectCd).toBe(1.2);
    const baseStage = stageFor('ash_drop', boundary); delete baseStage.frontier;
    expect(collectedGold(stageFor('ash_drop', boundary))).toEqual(collectedGold(baseStage));
    for (const effect of ['telegraph_lead', 'signature_lead', 'warning_color', 'hazard_radius']) {
      const f = bossFixture(stageFor(effect, boundary)), plan = f.caster.start('bell_toll');
      expect(plan).toEqual(planBossSignature('bell_toll', { room: f.room, origin: f.enemy.pos, target: f.player.pos })!);
      const r = regionFixture(stageFor(effect, boundary)); r.hazards.spawn(r.room);
      expect(r.hazards.slots.filter(slot => slot.hazard).map((slot: any) => slot.hazard))
        .toEqual(hazardPattern('frost', r.room, r.player.pos, 0, false));
      expect(r.hazards.getPartyWarnings().every(validPartyWarning)).toBe(true);
      expect(r.hazards.getPartyWarnings()[0].color).toBe(0x85dfff);
    }
  });
}

test('ordinary enemy windup and ring display ignore the narrowed telegraph effect', () => {
  const actorUpdate = spyOn(Actor.prototype, 'update').mockImplementation(noop);
  try {
    const snapshot = (stage: any) => {
      const f = bossFixture(stage); f.enemy.signatures = null; f.enemy.isBoss = false;
      Object.assign(f.enemy, { special: null, attackDone: false, attackDur: 2, hitAt: .5, stateT: 0,
        def: { atkTime: 2, range: 3 }, telegraph: 1 });
      const ring = new THREE.Mesh(new THREE.RingGeometry(), new THREE.MeshBasicMaterial());
      f.enemy.telegraphRing = ring; cleanup.push(() => { ring.geometry.dispose(); ring.material.dispose(); });
      let hits = 0; f.enemy.doAttack = () => hits++;
      f.enemy.update(.4); f.enemy.updateSkillTelegraph();
      const result = { warning: f.enemy.telegraph, scale: ring.scale.x, opacity: ring.material.opacity };
      f.enemy.update(.599); expect(hits).toBe(0); f.enemy.update(.002); expect(hits).toBe(1);
      return result;
    };
    expect(snapshot(stageFor('telegraph_lead'))).toEqual(snapshot(stageFor()));
  } finally { actorUpdate.mockRestore(); }
});
