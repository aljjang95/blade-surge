import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Group, Scene, Vector3, Color } from 'three';

const noop = () => {};
const FX_FIELDS = { dmgLayer: { children: [] }, glow: { emit: noop }, lite: true, trail: () => ({ stop: noop }), orb: () => new Group() };
const quiet = new Proxy({}, { get: (_, key) => Object.hasOwn(FX_FIELDS, key) ? FX_FIELDS[key] : noop });

/** 실제 BattleBase 방 흐름(enterRoom·명단·pending·정화)과 Player/Enemy/Floor 소스를 화면·DOM·음향 없이 돌린다. */
export async function loadCrowdFlowRuntime(project = process.cwd()) {
  const read = name => import(pathToFileURL(path.join(project, name)).href);
  const [player, enemy, battle, heroes, stages, expedition, crowd, world, renderer, ranger, rigs] = await Promise.all([
    read('src/game/player.js'), read('src/game/enemies.js'), read('src/game/battle-base.js'),
    read('src/data/heroes.js'), read('src/data/stages.js'), read('src/game/expedition-combat.js'),
    read('src/game/crowd-contact.js'), read('src/game/world.js'), read('src/engine/renderer.js'), read('src/game/ranger-aim.js'), read('src/data/rigs.js'),
  ]);
  return { ...player, ...enemy, ...battle, ...heroes, ...stages, ...expedition, ...crowd, ...world, ...renderer, ...ranger, ...rigs };
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** 원정 던전 한 판. 진입·스폰·추격·정화·봉인·포탈은 실제 BattleBase.update 경로를 사용한다. */
export function createCrowdFlowFixture(runtime, { route = 'bellfall_crypt', hero = 'knight', auto = false, maxAlive = 24 } = {}) {
  // 'campaign:N' 은 무한의 성 N층(BattleBase.start 와 같은 Floor 생성), 그 밖은 원정 던전 id.
  const floorNo = /^campaign:(\d+)$/.exec(route)?.[1];
  const stage = floorNo ? runtime.stageDef(Math.floor((+floorNo - 1) / runtime.STAGES_PER_CHAPTER) + 1, (+floorNo - 1) % runtime.STAGES_PER_CHAPTER + 1)
    : runtime.buildExpeditionStage('dungeon', route, null);
  const world = floorNo ? new runtime.Floor(stage.idx, stage.chapter.theme, undefined, stage.dungeon?.layout) : runtime.buildExpeditionWorld(stage);
  const game = Object.create(runtime.Battle.prototype);
  const fakeModel = () => ({ scene: new Group(), animations: [] });
  const models = new Proxy({}, { get: () => fakeModel() });
  const input = { enabled: true, move: { x: 0, y: 0 }, queue: [], attackHeld: false,
    press(name) { if (this.enabled && !this.queue.includes(name)) this.queue.push(name); },
    consume(name) { const at = this.queue.indexOf(name); if (at < 0) return false; this.queue.splice(at, 1); return true; },
    clear() { this.queue.length = 0; this.attackHeld = false; this.move.x = this.move.y = 0; }, update: noop,
  };
  const rig = { preset: 'action', target: new Vector3(), pos: new Vector3(), offset: new Vector3(0, 6.8, 8.4),
    lookOffset: new Vector3(), base: { ...runtime.CAMERA_PRESETS.action }, side: 0, fov: 43, lag: 7.5 };
  const log = { kills: [], rooms: new Map(), victory: false, defeat: false };
  Object.assign(game, { app: { models, eco: { s: { quests: { kills: 0 } } }, reducedMotion: { matches: false } },
    stage, world, active: true, paused: false, bossDefeated: false, scene: new Scene(), input, fx: quiet,
    enemies: [], timers: [], projectiles: [], pending: [], holes: [], maxAlive, peakAlive: 0, elapsed: 0,
    combo: 0, maxCombo: 0, comboT: 0, kills: 0, waveKilled: 0, killStreak: 0, killStreakT: 0, dmgDealt: 0,
    roomsCleared: 0, treasureRooms: 0, impactT: 0, _startGeneration: 1, timeCtl: new runtime.TimeCtl(),
    renderer: { rig, shake: noop, punch: noop, flashScreen: noop }, ui: quiet, arena: { update: noop, openSeal: noop },
    drops: { onKill: noop, spawn: noop, update: noop }, hasProc: () => false, rollDrop: () => null,
    curRoom: world.startRoom, bossKey: 'boss', heroId: hero, setBonus: [],
    victory() { log.victory = true; this.active = false; }, onPlayerDeath() { log.defeat = true; this.active = false; },
  });
  world.startRoom.discovered = true;
  const def = runtime.HEROES[hero], rarity = runtime.RARITY[def.rarity].mult;
  const stats = { ...def.base, hp: def.base.hp * rarity * 4, atk: def.base.atk * rarity };
  const player = Object.create(runtime.Player.prototype), root = new Group(), model = new Group(), motionRoot = new Group();
  root.add(motionRoot); motionRoot.add(model); game.scene.add(root);
  Object.assign(player, { game, root, model, motionRoot, pos: root.position, rig: runtime.RIGS?.kaykit || {}, clips: {},
    mixer: { update: noop, stopAllAction: noop, uncacheRoot: noop, getRoot: () => model, clipAction: () => ({}) },
    yaw: 0, vel: new Vector3(), kb: new Vector3(), radius: .7, alive: true, dead: false, disposed: false, deathT: -1,
    stun: 0, slow: 0, slowT: 0, invuln: 0, mats: [], flashT: 0, flashColor: new Color(), _impact: null, _attackMotion: null,
    play(name) { this.actionName = name; return this.action = { timeScale: 1 }; }, playTimed(name) { return this.play(name); },
    def, stats, hp: stats.hp, maxHp: stats.hp, heroLevel: 1, skillLevels: def.skills.map(() => 1), skillLoadout: [4, 5],
    cds: def.skills.map(() => 0), maxMp: runtime.MP_BASE, mp: runtime.MP_BASE, mpRegen: runtime.MP_REGEN_PER_SEC,
    ult: 0, ultMax: 100, ultGainLock: 0, dodgeCd: 0, state: 'idle', stateT: 0, auto, comboIdx: 0, comboQueued: false,
    attackBufferT: 0, dodgeBufferT: 0, hitDone: false, stormT: 0, hurtFeedbackT: 0, dr: 0, drT: 0,
    buffs: { atk: 1, spd: 1, atkSpd: 1, t: 0 }, beacon: { update: noop, setFocus: noop }, look: { aura: null, trailColor: def.color },
    moveDir: new Vector3(), sprintT: 0, sprint: 0, footT: 0, perfectWindow: 0, perfectCd: 0, counterWindow: 0, _autoHubCounts: [],
    rangerAim: def.weapon === 'bow' && !auto && runtime.RangerAim ? new runtime.RangerAim() : null, bowLayers: null,
  });
  player.pos.set(world.startRoom.x, 0, world.startRoom.z);
  game.player = player;
  const onEnemyDeath = runtime.Battle.prototype.onEnemyDeath;
  game.onEnemyDeath = function(enemy) {
    const around = this.enemies.filter(e => e !== enemy && e.alive && !e.spawning && e.pos.distanceTo(this.player.pos) < 7);
    log.kills.push({ at: this.elapsed, room: enemy.homeRoom?.id ?? -1, playerRoom: this.world.roomAt(this.player.pos.x, this.player.pos.z)?.id ?? -1,
      near: around.length, nearOriginal: around.filter(e => !e.packFollower).length, follower: !!enemy.packFollower });
    return onEnemyDeath.call(this, enemy);
  };
  const markCleared = runtime.Battle.prototype.markCleared;
  game.markCleared = function(room) { const was = room.cleared; markCleared.call(this, room); if (!was && room.cleared) (log.rooms.get(room.id) || log.rooms.set(room.id, {}).get(room.id)).clearedAt = this.elapsed; };
  const enterRoom = runtime.Battle.prototype.enterRoom;
  game.enterRoom = function(room) { if (room && !room.spawned && !room.cleared) (log.rooms.get(room.id) || log.rooms.set(room.id, {}).get(room.id)).enteredAt = this.elapsed; return enterRoom.call(this, room); };
  return { runtime, game, player, world, stage, log };
}

const clearLine = (world, a, b) => {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / .5));
  for (let i = 1; i < n; i++) { const t = i / n; if (!world.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
  return true;
};
const NEAR_CELLS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
/** 사람처럼 벽을 돌아가는 봇 길찾기. 목표가 벽에 붙은 셀이면 가까운 내부 셀에서 거리장을 만든다. */
function botDir(world, goal, from) {
  let flow = world.buildFlow(goal.x, goal.z);
  for (let r = 1; !flow && r <= 3; r++) for (const [ox, oz] of NEAR_CELLS) { flow = world.buildFlow(goal.x + ox * r, goal.z + oz * r); if (flow) break; }
  return world.flowDir(flow, from.x, from.z);
}

/** 사람 플레이를 흉내 낸 단순 수동 입력: 보이는 적에게 붙어 치고, 3마리 이상이면 스킬, 가까운 예고는 회피. 시야에 없으면 미니맵처럼 남은 적·방으로 길찾기. */
function manualInput(f, time, memo) {
  const { game, player, world } = f, input = game.input;
  input.move.x = input.move.y = 0;
  if (!player.alive) return;
  // 몰이 주행: 첫 교전 뒤 kite 초 동안 적을 무시하고 다음 방들로 달려 무리를 끌고 간다.
  if (memo.kite > 0 && memo.kiteFrom !== undefined && time - memo.kiteFrom < memo.kite) {
    const rooms = world.rooms.filter(r => !r.spawned && !r.cleared && !(world.sealed && r === world.bossRoom));
    rooms.sort((a, b) => Math.hypot(a.x - player.pos.x, a.z - player.pos.z) - Math.hypot(b.x - player.pos.x, b.z - player.pos.z));
    const goal = rooms[0] || world.rooms.find(r => r.spawned && !r.cleared && Math.hypot(r.x - player.pos.x, r.z - player.pos.z) > 8);
    const dir = goal && botDir(world, goal, player.pos);
    if (dir) { input.move.x = dir[0]; input.move.y = dir[1]; }
    return;
  }
  if (memo.kite > 0 && memo.kiteFrom === undefined && game.enemies.some(e => e.alive && !e.spawning && player.distTo(e) < 9)) { memo.kiteFrom = time; return; }
  if (memo.kite > 0 && memo.kiteFrom !== undefined && memo.turnAt === undefined) {
    memo.turnAt = time;
    const alive = game.enemies.filter(e => e.alive && !e.spawning);
    memo.train = { at: +time.toFixed(2), alive: alive.length, within8: alive.filter(e => player.distTo(e) < 8).length,
      within14: alive.filter(e => player.distTo(e) < 14).length, behindWall: alive.filter(e => !clearLine(world, e.pos, player.pos)).length,
      fromOtherRooms: alive.filter(e => player.distTo(e) < 14 && e.homeRoom !== world.roomAt(player.pos.x, player.pos.z)).length };
  }
  const list = game.enemies.filter(e => e.alive && !e.spawning);
  let target = null, best = Infinity;
  for (const e of list) { const d = player.distTo(e); if (d < 11 && d < best && clearLine(world, player.pos, e.pos)) { best = d; target = e; } }
  const reach = player.def.ranged ? 7 : 2.1;
  if (target) {
    const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z, l = Math.hypot(dx, dz) || 1;
    if (best > reach) { input.move.x = dx / l; input.move.y = dz / l; }
    const near = list.filter(e => player.distTo(e) < 5).length;
    if (near >= 3 && time - memo.skillAt > .6) { for (const slot of [1, 2, 0, 4, 5]) { const i = player.combatSkillIndex(slot); if (player.def.skills[i] && player.cds[i] <= 0 && player.unlocked(i)) { input.press('skill' + slot); memo.skillAt = time; break; } } }
    if (best < reach + 1.4 && time - memo.attackAt >= .18) { input.press('attack'); memo.attackAt = time; }
    // 사람처럼 곧 떨어질 예고(0.4초 이내)에만, 같은 예고에는 한 번만 구른다(쿨타임 유무와 무관한 같은 규칙).
    const threat = list.find(e => e.telegraph > 0 && e.telegraph <= .4 && player.distTo(e) < (e.isBoss ? 5.5 : 4));
    if (threat && time - memo.dodgeAt > .25 && !(threat === memo.dodgeFrom && time < memo.dodgeUntil)) {
      input.press('dodge'); memo.dodgeAt = time; memo.dodgeFrom = threat; memo.dodgeUntil = time + threat.telegraph + .2;
      const sx = player.pos.x - threat.pos.x, sz = player.pos.z - threat.pos.z, sl = Math.hypot(sx, sz) || 1; input.move.x = sx / sl; input.move.y = sz / sl;
    }
    return;
  }
  let goal = null;
  if (game.portal) goal = game.portal.pos;
  else if (list.length) { let bd = Infinity; for (const e of list) { const d = player.distTo(e); if (d < bd) { bd = d; goal = e.pos; } } memo.chasingHidden = true; }
  else {
    const rooms = world.rooms.filter(r => !r.cleared && !(world.sealed && r === world.bossRoom));
    rooms.sort((a, b) => Math.hypot(a.x - player.pos.x, a.z - player.pos.z) - Math.hypot(b.x - player.pos.x, b.z - player.pos.z));
    goal = rooms[0] || null;
  }
  if (!goal) return;
  const dir = botDir(world, goal, player.pos);
  if (dir) { input.move.x = dir[0]; input.move.y = dir[1]; }
  else { const dx = goal.x - player.pos.x, dz = goal.z - player.pos.z, l = Math.hypot(dx, dz) || 1; input.move.x = dx / l; input.move.y = dz / l; }
}

export function runCrowdFlow(runtime, { seed = 20261016, route = 'bellfall_crypt', hero = 'knight', auto = false, fps = 60, seconds = 420, maxAlive = 24, inspect = null, trace = null, kite = 0 } = {}) {
  const originalRandom = Math.random; Math.random = seeded(seed);
  try {
    const f = createCrowdFlowFixture(runtime, { route, hero, auto, maxAlive }), { game, player, world, log } = f;
    const memo = { attackAt: -1, skillAt: -1, dodgeAt: -1, kite };
    const track = new Map();
    let stuckSeconds = 0, engagedSum = 0, engagedFrames = 0, maxEngaged = 0, pathMeters = 0, backtrackMeters = 0, hiddenChaseSeconds = 0;
    let wallSeparatedSeconds = 0, frames = 0, overlapPairsMax = 0, engagedOriginalSum = 0, engagedOriginalFrames = 0;
    const entered = new Set();
    let px = player.pos.x, pz = player.pos.z;
    for (let frame = 0; frame < fps * seconds && game.active; frame++) {
      const time = frame / fps;
      memo.chasingHidden = false;
      if (!auto) manualInput(f, time, memo);
      game.update(1 / fps);
      frames++;
      if (trace && frame % fps === 0) trace(f, time);
      const step = Math.hypot(player.pos.x - px, player.pos.z - pz); px = player.pos.x; pz = player.pos.z;
      pathMeters += step;
      const here = world.roomAt(player.pos.x, player.pos.z);
      if (here) { if (entered.has(here.id) && here.spawned && !here.cleared && game.enemies.every(e => !e.alive || e.homeRoom !== here || e.pos.distanceTo(player.pos) > 11)) backtrackMeters += step; entered.add(here.id); }
      if (memo.chasingHidden) hiddenChaseSeconds += 1 / fps;
      let engaged = 0, engagedOriginal = 0;
      for (const e of game.enemies) {
        if (!e.alive || e.spawning) continue;
        const d = e.pos.distanceTo(player.pos);
        if (d < 6) { engaged++; if (!e.packFollower) engagedOriginal++; }
        const rec = track.get(e) || { x: e.pos.x, z: e.pos.z, t: 0, stuck: 0, run: 0, maxRun: 0 };
        rec.t += 1 / fps;
        if (rec.t >= 1) {
          const moved = Math.hypot(e.pos.x - rec.x, e.pos.z - rec.z);
          // 발각 전 경계 중인 무리는 멈춰 있는 것이 정상이다. 공격 차례를 기다리며 4.8~5.5m 를 도는 근접 적도 제외하고
          // 추격(또는 귀환) 중 6m 밖에서 멈춘 경우만 센다.
          const hunting = !e.pack || e.pack.aggro || e.pack.returning;
          if (hunting && e.state === 'chase' && d > 6 && moved < .4 && !e.def.ranged) { rec.stuck += 1; rec.run += 1; rec.maxRun = Math.max(rec.maxRun, rec.run); stuckSeconds += 1; }
          else rec.run = 0;
          rec.x = e.pos.x; rec.z = e.pos.z; rec.t = 0;
        }
        if (d > 3 && !clearLine(world, e.pos, player.pos)) wallSeparatedSeconds += 1 / fps;
        track.set(e, rec);
      }
      let overlap = 0; const alive = game.enemies.filter(e => e.alive && !e.spawning);
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) if (alive[i].pos.distanceTo(alive[j].pos) < .35) overlap++;
      overlapPairsMax = Math.max(overlapPairsMax, overlap);
      if (engaged) { engagedSum += engaged; engagedFrames++; }
      if (engagedOriginal) { engagedOriginalSum += engagedOriginal; engagedOriginalFrames++; }
      maxEngaged = Math.max(maxEngaged, engaged);
      if (player.state === 'idle' && player.hp < player.maxHp * .5) player.hp = Math.min(player.maxHp, player.hp + player.maxHp * .002);
    }
    const kills = log.kills, solo = kills.filter(k => k.near === 0).length, pack = kills.filter(k => k.near >= 3).length;
    // 기존 명단만: 졸개를 뺀 처치와, 졸개를 뺀 주변 수로 다시 센다(졸개가 지표를 부풀리지 않았는지 따로 본다).
    const originals = kills.filter(k => !k.follower);
    const soloOriginal = originals.filter(k => k.nearOriginal === 0).length, packOriginal = originals.filter(k => k.nearOriginal >= 3).length;
    const offRoom = kills.filter(k => k.room !== k.playerRoom).length;
    const rooms = [...log.rooms.entries()].map(([id, r]) => ({ id, type: world.rooms[id].type, enteredAt: r.enteredAt ?? null, clearedAt: r.clearedAt ?? null,
      clearSec: r.enteredAt != null && r.clearedAt != null ? +(r.clearedAt - r.enteredAt).toFixed(2) : null }));
    // 문 앞 혼잡처럼 잠깐 밀리는 것은 빼고, 4초 넘게 연속으로 멈춘 추격자만 고착으로 센다.
    const stuckEnemies = [...track.values()].filter(r => r.maxRun >= 4).length;
    const longestStuckSec = Math.max(0, ...[...track.values()].map(r => r.maxRun));
    inspect?.(f);
    for (const e of game.enemies) e.mobRole?.dispose?.();
    return { seed, route, hero, auto, kite, train: memo.train || null, fps, seconds: +game.elapsed.toFixed(2), victory: log.victory, defeat: log.defeat,
      bossDefeated: !!game.bossDefeated, roomsCleared: world.rooms.filter(r => r.cleared && r.type !== 'start').length,
      totalRooms: world.rooms.length - 1, kills: kills.length, soloKillRatio: kills.length ? +(solo / kills.length).toFixed(3) : 0,
      packKillRatio: kills.length ? +(pack / kills.length).toFixed(3) : 0, offRoomKills: offRoom,
      originalKills: originals.length, followerKills: kills.length - originals.length,
      soloKillRatioOriginal: originals.length ? +(soloOriginal / originals.length).toFixed(3) : 0,
      packKillRatioOriginal: originals.length ? +(packOriginal / originals.length).toFixed(3) : 0,
      meanEngagedOriginal: engagedOriginalFrames ? +(engagedOriginalSum / engagedOriginalFrames).toFixed(2) : 0,
      meanEngaged: engagedFrames ? +(engagedSum / engagedFrames).toFixed(2) : 0, maxEngaged, peakAlive: game.peakAlive,
      stuckEnemySeconds: stuckSeconds, stuckEnemies, longestStuckSec, wallSeparatedEnemySeconds: +wallSeparatedSeconds.toFixed(1),
      hiddenChaseSeconds: +hiddenChaseSeconds.toFixed(1), backtrackMeters: +backtrackMeters.toFixed(1), pathMeters: +pathMeters.toFixed(1),
      overlapPairsMax, playerHpRatio: +(player.hp / player.maxHp).toFixed(3), rooms,
      allEnemiesWalkable: game.enemies.every(e => !e.alive || world.walkable(e.pos.x, e.pos.z)) };
  } finally { Math.random = originalRandom; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), get = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const runtime = await loadCrowdFlowRuntime(path.resolve(get('--project', process.cwd())));
  const routes = get('--routes', 'bellfall_crypt,glass_garden,ember_vault,cinder_tide_lock').split(',');
  const heroes = get('--heroes', 'knight,mage').split(','), modes = get('--modes', 'manual,auto').split(',');
  const runs = Number(get('--runs', '1')), rows = [];
  for (const route of routes) for (const hero of heroes) for (const mode of modes) for (let i = 0; i < runs; i++)
    rows.push(runCrowdFlow(runtime, { seed: 20261016 + i, route, hero, auto: mode === 'auto', kite: mode === 'kite' ? Number(get('--kite', '12')) : 0,
      fps: Number(get('--fps', '60')), seconds: Number(get('--seconds', '420')) }));
  console.log(JSON.stringify(args.includes('--rooms') ? rows : rows.map(({ rooms, ...rest }) => rest), null, 1));
}
