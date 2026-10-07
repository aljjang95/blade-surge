import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Group, Scene, Vector3, Color } from 'three';

const noop = () => {};

/** 선택 소스의 실제 Player/Enemy/Actor/충돌/접촉 시계를 사용하며 모델·DOM·음향만 제외한다. */
export async function loadCombatFlowRuntime(project = process.cwd()) {
  const read = name => import(pathToFileURL(path.join(project, name)).href);
  const [player, enemy, battle, heroes, stages, rigs, expedition, clock, crowd, roles, progression] = await Promise.all([
    read('src/game/player.js'), read('src/game/enemies.js'), read('src/game/battle-base.js'),
    read('src/data/heroes.js'), read('src/data/stages.js'), read('src/data/rigs.js'),
    read('src/game/expedition-combat.js'), read('src/game/combat-motion.js'),
    read('src/game/crowd-contact.js'), read('src/game/mob-roles.js'), read('src/game/progression.js'),
  ]);
  return { ...player, ...enemy, ...battle, ...heroes, ...stages, ...rigs, ...expedition, ...clock, ...crowd, ...roles, ...progression };
}

function actorFields(game, point, rig) {
  const root = new Group(), model = new Group(), motionRoot = new Group();
  root.add(motionRoot); motionRoot.add(model); root.position.copy(point); game.scene.add(root);
  return { game, root, model, motionRoot, pos: root.position, rig, clips: {},
    mixer: { update: noop, stopAllAction: noop, uncacheRoot: noop, getRoot: () => model },
    yaw: 0, vel: new Vector3(), kb: new Vector3(), hp: 100, maxHp: 100, radius: .7,
    alive: true, dead: false, disposed: false, deathT: -1, stun: 0, slow: 0, slowT: 0,
    invuln: 0, mats: [], flashT: 0, flashColor: new Color(), _impact: null, _attackMotion: null,
    play(name) { this.actionName = name; return this.action = { timeScale: 1 }; },
    playTimed(name) { return this.play(name); },
  };
}

export function createCombatFlowFixture(runtime, heroId = 'knight') {
  const stage = runtime.buildExpeditionStage('dungeon', 'glass_garden', null);
  const world = runtime.buildExpeditionWorld(stage), room = world.rooms[1];
  room.spawned = true; room.discovered = true;
  const game = Object.create(runtime.Battle.prototype);
  const fx = { lite: true, dmgLayer: { children: [] }, glow: { emit: noop } };
  for (const name of ['damage', 'burst', 'directional', 'flash', 'dust', 'embers', 'ring', 'slashSprite',
    'slashArc', 'castCircle', 'groundTex', 'shockTex', 'explosion', 'dustPuff', 'light', 'holyBurst',
    'iceBurst', 'abilitySignature', 'ghost', 'firePillar', 'clearAll', 'boltTex', 'scorch']) fx[name] = noop;
  fx.trail = () => ({ stop: noop }); fx.orb = () => new Group();
  const input = { enabled: true, move: { x: 0, y: 0 }, queue: [], attackHeld: false,
    press(name) { if (this.enabled && !this.queue.includes(name)) this.queue.push(name); },
    consume(name) { const at = this.queue.indexOf(name); if (at < 0) return false; this.queue.splice(at, 1); return true; },
    clear() { this.queue.length = 0; this.attackHeld = false; this.move.x = this.move.y = 0; },
  };
  const events = {
    hits: /** @type {Array<{at:number,enemy:*,amount:number,x:number,z:number,basic:boolean,skill:string|null}>} */ ([]),
    incoming: /** @type {Array<{at:number,damage:number,kb:number,beforeState:string,afterState:string}>} */ ([]),
    damageTaken: 0, kills: 0, objectiveInterrupts: 0,
    shakes: /** @type {number[]} */ ([]), flashes: /** @type {number[]} */ ([]),
  };
  Object.assign(game, { stage, world, active: true, paused: false, bossDefeated: false, scene: new Scene(),
    enemies: [], timers: [], projectiles: [], maxAlive: 24, elapsed: 0, combo: 0, maxCombo: 0, comboT: 0,
    dmgDealt: 0, _contactBudget: null, _startGeneration: 1, input, fx, events,
    app: { reducedMotion: { matches: false } }, timeCtl: new runtime.ImpactClock(),
    renderer: { shake: n => events.shakes.push(n), flashScreen: n => events.flashes.push(n), punch: noop },
    ui: { toast: noop, setCombo: noop, hurtVignette: noop, combatCue: noop }, hasProc: () => false,
    routeObjectives: { interrupt: () => events.objectiveInterrupts++ },
    onPlayerDeath() { this.active = false; }, onEnemyDeath() { events.kills++; },
    bossShed: noop, bossPhase: noop, onPerfectDodge: noop,
  });
  const hero = runtime.HEROES[heroId], rarity = runtime.RARITY[hero.rarity].mult;
  const stats = { ...hero.base, hp: hero.base.hp * rarity, atk: hero.base.atk * rarity };
  const player = Object.create(runtime.Player.prototype);
  Object.assign(player, actorFields(game, new Vector3(room.x, 0, room.z), runtime.RIGS.kaykit), {
    def: hero, stats, hp: stats.hp, maxHp: stats.hp, heroLevel: 1,
    skillLevels: hero.skills.map(() => 1), skillLoadout: [4, 5], cds: hero.skills.map(() => 0),
    maxMp: runtime.MP_BASE, mp: runtime.MP_BASE, mpRegen: runtime.MP_REGEN_PER_SEC, ult: 0, ultMax: 100, ultGainLock: 0, dodgeCd: 0,
    state: 'idle', stateT: 0, auto: false, comboIdx: 0, comboQueued: false, attackBufferT: 0,
    dodgeBufferT: 0, hitDone: false, stormT: 0, hurtFeedbackT: 0, dr: 0, drT: 0,
    buffs: { atk: 1, spd: 1, atkSpd: 1, t: 0 }, beacon: { update: noop, setFocus: noop },
    look: { aura: null, trailColor: hero.color }, moveDir: new Vector3(), sprintT: 0, sprint: 0,
    footT: 0, perfectWindow: 0, perfectCd: 0, counterWindow: 0,
  });
  game.player = player;
  const hurtPlayer = runtime.Player.prototype.hurt;
  player.hurt = function(damage, opts) {
    const beforeHp = this.hp, beforeState = this.state, accepted = hurtPlayer.call(this, damage, opts);
    if (this.hp < beforeHp) events.incoming.push({ at: game.elapsed, damage: beforeHp - this.hp,
      kb: opts?.kb ?? 2, beforeState, afterState: this.state });
    return accepted;
  };
  const damageEnemy = runtime.Battle.prototype.damageEnemy;
  game.damageEnemy = function(enemy, damage, opts) {
    const before = enemy.hp;
    damageEnemy.call(this, enemy, damage, opts);
    if (enemy.hp < before) events.hits.push({ at: this.elapsed, enemy, amount: before - enemy.hp,
      x: enemy.pos.x, z: enemy.pos.z, basic: !!opts?.basic, skill: player.skillCtx?.sk.id || null });
  };
  return { runtime, game, player, room, events };
}

export function spawnCombatFlowEnemy(fixture, x, z, options = {}) {
  const { runtime, game, room } = fixture, def = runtime.ENEMIES[options.id || 'skel_minion'];
  const enemy = Object.create(runtime.Enemy.prototype);
  Object.assign(enemy, actorFields(game, new Vector3(x, 0, z), runtime.RIGS[runtime.rigOf(def.model)]), {
    def, hp: def.hp, maxHp: def.hp, atk: def.atk, state: 'chase', stateT: 0,
    isBoss: !!def.boss, isElite: !!def.elite, spawning: false, atkCd: .8,
    hitAt: .5, attackDur: def.atkTime, attackDone: false, telegraph: 0,
    stagger: 0, poison: 0, phase: 0, patternTurn: 0, enraged: false,
    special: null, behavior: def.behavior || null, guardBroken: 0, blocks: 0,
    fuse: -1, healT: 5, summonT: 8, homeRoom: room, packSide: game.enemies.length % 2 ? -1 : 1,
    gatherT: 0, gatherBlockT: 0, ...options,
  });
  if (def.meleeRole) enemy.mobRole = new runtime.MobRole(enemy);
  game.enemies.push(enemy);
  return enemy;
}

/** Battle.update의 타이머→입력→Player→Enemy→군중 접촉 순서. 화면·보상·방 생성은 측정하지 않는다. */
export function stepCombatFlow(fixture, realDt) {
  const { game, player, runtime, events } = fixture;
  if (!game.active || game.paused) return 0;
  const dt = game.timeCtl.step(realDt); game.elapsed += dt;
  for (let i = game.timers.length - 1; i >= 0; i--) {
    const timer = game.timers[i]; timer.t -= dt;
    if (timer.t <= 0) { game.timers.splice(i, 1); timer.fn(); }
  }
  player.handleInput(game.input, dt); player.update(dt);
  const hp = player.hp;
  for (let i = game.enemies.length - 1; i >= 0; i--) game.enemies[i].update(dt);
  events.damageTaken += hp - player.hp;
  runtime.resolveCrowdContacts(game.enemies, player, game.world, dt);
  game.updateProjectiles(dt);
  return dt;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** 실제 이동·피격·기본 공격·Lv1 몰이. 2000회는 통합 담당이 브라우저 검수 뒤 직렬 실행한다. */
export function runCombatFlowScenario(runtime, { seed = 20261008, fps = 60, hero = 'knight', seconds = 8 } = {}) {
  const originalRandom = Math.random; Math.random = seeded(seed);
  try {
    const f = createCombatFlowFixture(runtime, hero), { game, player, events } = f;
    const skillIndex = hero === 'knight' ? 1 : hero === 'barbarian' ? 0 : 2;
    const center = player.pos.clone().add(new Vector3(0, 0, hero === 'knight' ? 1.2 : 0));
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI * 2 / 12 + (Math.random() - .5) * .15;
      const radius = hero === 'knight' ? 5.65 + Math.random() * 1.15 :
        hero === 'barbarian' ? 4.5 + Math.random() * .9 : 7.6 + Math.random() * .7;
      spawnCombatFlowEnemy(f, center.x + Math.sin(angle) * radius, center.z + Math.cos(angle) * radius,
        { id: i === 0 ? 'elite_skel_captain' : 'skel_minion' });
    }
    const hitRadius = hero === 'knight' ? 5 : hero === 'barbarian' ? 3.8 : 6.8;
    const initialTargets = game.enemies.map(enemy => ({ enemy, x: enemy.pos.x, z: enemy.pos.z,
      distance: enemy.pos.distanceTo(center), outside: enemy.pos.distanceTo(center) > hitRadius + enemy.radius * .5 }));
    const initialRadius = Math.max(...game.enemies.map(e => e.pos.distanceTo(center)));
    const initialHp = player.hp;
    let movement = 0, hurtSeconds = 0, lowestHp = player.hp, firstHitRadius = null, firstHitAt = null;
    let previousX = player.pos.x, previousZ = player.pos.z, lastPress = -1, spawnedFollowup = false;
    game.input.press('skill' + skillIndex);
    for (let frame = 0; frame < fps * seconds && game.active; frame++) {
      const time = frame / fps;
      // 다음 소규모 무리는 실제 AI로 공격하게 한다. 위치를 당기거나 공격 상태를 강제하지 않는다.
      if (!spawnedFollowup && time >= 2) {
        spawnedFollowup = true;
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 2 / 5;
          spawnCombatFlowEnemy(f, player.pos.x + Math.sin(angle) * 1.65, player.pos.z + Math.cos(angle) * 1.65, { atkCd: 0 });
        }
      }
      game.input.move.x = time >= 2.8 && time < 4 ? .6 : 0; game.input.move.y = 0;
      if (time >= 4) {
        const target = player.nearestEnemy(20), distance = target ? player.distTo(target) : Infinity;
        if (target) {
          const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
          const amount = distance > (player.def.ranged ? 6 : 2.2) ? 1 : .2;
          game.input.move.x = dx / d * amount; game.input.move.y = dz / d * amount;
        }
        if (distance < (player.def.ranged ? 8 : 3.6) && time - lastPress >= .18) {
          game.input.press('attack'); lastPress = time;
        }
      }
      stepCombatFlow(f, 1 / fps);
      movement += Math.hypot(player.pos.x - previousX, player.pos.z - previousZ);
      previousX = player.pos.x; previousZ = player.pos.z;
      if (player.state === 'hurt') hurtSeconds += 1 / fps;
      lowestHp = Math.min(lowestHp, player.hp);
      if (firstHitAt === null && events.hits.length) {
        firstHitAt = events.hits[0].at;
        firstHitRadius = Math.max(0, ...game.enemies.filter(e => e.alive).map(e => e.pos.distanceTo(center)));
      }
    }
    const firstContacts = events.hits.filter(hit => Math.abs(hit.at - firstHitAt) < 1e-8);
    const contactMovement = firstContacts.map(hit => {
      const initial = initialTargets.find(target => target.enemy === hit.enemy);
      if (!initial) return null;
      const distance = Math.hypot(hit.x - center.x, hit.z - center.z);
      return { startedOutside: initial.outside, initialRadius: initial.distance, contactRadius: distance,
        enteredHitRadius: initial.outside && distance <= hitRadius + hit.enemy.radius * .5,
        movedDistance: Math.hypot(hit.x - initial.x, hit.z - initial.z), isElite: hit.enemy.isElite };
    }).filter(Boolean);
    const output = { seed, fps, hero, seconds, initialRadius, firstHitAt, firstHitRadius,
      initialOutsideCount: initialTargets.filter(target => target.outside).length,
      gatheredIntoFirstContact: contactMovement.filter(contact => contact.enteredHitRadius).length,
      firstContactMovement: contactMovement,
      kills: events.kills, outgoingHits: events.hits.length, damageDealt: game.dmgDealt,
      damagePerRealSecond: game.dmgDealt / seconds,
      damageTaken: initialHp - player.hp, minHpRatio: lowestHp / initialHp, movement, hurtSeconds,
      lightDamageCount: events.incoming.filter(hit => hit.kb < 6).length,
      heavyDamageCount: events.incoming.filter(hit => hit.kb >= 6).length,
      lightInterruptions: events.incoming.filter(hit => hit.kb < 6 && hit.beforeState !== 'hurt' && hit.afterState === 'hurt').length,
      aliveEnemies: game.enemies.filter(e => e.alive).length,
      finalClusterRadius: Math.max(0, ...game.enemies.filter(e => e.alive).map(e => e.pos.distanceTo(center))),
      alive: player.alive, allEnemiesWalkable: game.enemies.every(e => game.world.walkable(e.pos.x, e.pos.z)),
      sourcePhases: 'ImpactClock + timers + Player.handleInput/update + Enemy.update + Actor/Floor.resolve + resolveCrowdContacts',
      scope: '단일 방 Lv1 전투 성분 시뮬. GLB/DOM/오디오/프레임 성능·층 보상·전체 완주는 측정하지 않음' };
    for (const enemy of game.enemies) enemy.mobRole?.dispose();
    return output;
  } finally { Math.random = originalRandom; }
}

/** 동일 반경의 생존 표적에서 실제 Player.update 종료까지 회오리 횟수와 피해 상한을 셈한다. */
export function countWhirlwindContacts(runtime, fps) {
  const originalRandom = Math.random; Math.random = seeded(20261008);
  try {
    const f = createCombatFlowFixture(runtime, 'barbarian');
    spawnCombatFlowEnemy(f, f.player.pos.x, f.player.pos.z + 1.7, { hp: 100000, maxHp: 100000, atkCd: 100 });
    f.player.tryCastCombatSkill(0);
    const cast = f.player.skillCtx;
    for (let frame = 0; frame < fps * 3 && !cast.done; frame++) stepCombatFlow(f, 1 / fps);
    return { fps, done: cast.done, ticks: cast.data.n || 0, acceptedHits: f.events.hits.length,
      damage: f.game.dmgDealt, damageUpperBound: (cast.data.n || 0) * cast.dmg * 1.1 * f.player.stats.critDmg,
      lastHitAt: f.events.hits.at(-1)?.at ?? null, firstHitAt: f.events.hits[0]?.at ?? null };
  } finally { Math.random = originalRandom; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const startedAt = new Date().toISOString();
  const args = process.argv.slice(2), get = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const count = Number(get('--runs', '2000')), project = path.resolve(get('--project', process.cwd()));
  const mode = get('--mode', 'candidate');
  if (!['candidate', 'baseline'].includes(mode)) throw new Error('--mode: candidate 또는 baseline');
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('--runs 범위: 1..10000');
  const runtime = await loadCombatFlowRuntime(project), rows = [];
  for (let i = 0; i < count; i++) rows.push(runCombatFlowScenario(runtime, { seed: 20261008 + i,
    fps: [30, 60, 120][i % 3], hero: ['knight', 'barbarian', 'mage'][Math.floor(i / 3) % 3] }));
  const sourceHashes = {};
  for (const file of ['src/game/player.js', 'src/game/enemies.js', 'src/game/skills.js', 'src/game/crowd-gather.js']) {
    const target = path.join(project, file);
    sourceHashes[file] = fs.existsSync(target) ? createHash('sha256').update(fs.readFileSync(target)).digest('hex') : null;
  }
  const failures = rows.flatMap((row, index) => {
    const errors = [];
    if (Object.values(row).some(value => typeof value === 'number' && !Number.isFinite(value))) errors.push('non-finite');
    if (!row.allEnemiesWalkable) errors.push('floor-collision');
    if (mode === 'candidate' && (!row.alive || row.lightInterruptions > 0 || row.gatheredIntoFirstContact < 6)) errors.push('combat-flow');
    return errors.length ? [{ index, seed: row.seed, hero: row.hero, fps: row.fps, errors }] : [];
  });
  const whirlwind = [30, 60, 120].map(fps => countWhirlwindContacts(runtime, fps));
  for (const row of whirlwind) if (!row.done || row.damage > row.damageUpperBound + 1e-6) failures.push({ fps: row.fps, errors: ['whirlwind-damage-bound'] });
  const result = { startedAt, finishedAt: new Date().toISOString(), project,
    sourceKind: 'working-tree-source', sourceHashes, runs: count, startedSeed: 20261008,
    mode, passed: failures.length === 0, failures, whirlwind, rows };
  const out = get('--out', null);
  if (out) fs.writeFileSync(path.resolve(out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  else console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
