import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Group } from 'three';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from './combat-flow-sim.mjs';

// 잿불금고 심층 사슬 집행자 후방 노출 보스전 모의(BUNDLE-14).
// combat-flow-sim 의 실제 Player/Enemy/BossSignatures/군중 접촉 경로로 심층 보스(stage 의 bossHp·scale·몸 반지름)와 AUTO 영웅을 보스방에 두고
// 보스 처치까지 1/60초로 돌린다. 모드:
//   off     — 후방 노출 없음(기준선)
//   on      — 실제 EmberRearExposure 를 붙이고 AUTO 가 autoFlank 로 등 뒤로 돈다(후보)
//   noflank — 후방 노출은 붙이되 AUTO 우회 훅을 주지 않는다(등 뒤로 돌지 않는 플레이어의 손해 상한 관찰)
// 이 도구는 결과만 보고한다. window·rear·front 수치 판정은 사용하는 쪽(PLAN)이 한다.
//
// 사용: node tools/ember-deep-boss-sim.mjs [--seeds=1,2,3] [--heroes=knight,mage] [--modes=on,off,noflank] [--max-seconds=600] [--hero-level=20] [--json] [--project=<경로>]

const DT = 1 / 60;
const noop = () => {};
const lenient = target => new Proxy(target, { get: (t, key) => (key in t ? t[key] : noop) });

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const median = list => {
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round = (n, digits = 3) => n === null || n === undefined ? n : Math.round(n * 10 ** digits) / 10 ** digits;

/** 한 판: 보스방에서 AUTO 영웅 1명과 심층 보스 1마리. 난수는 시드로 고정한다. */
export function runBossSim(runtime, EmberRearExposure, rearDef, { hero = 'knight', seed = 1, mode = 'on', maxSeconds = 600, heroLevel = 20 } = {}) {
  const originalRandom = Math.random; Math.random = seeded(seed);
  try {
    const stage = runtime.buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
    const world = runtime.buildExpeditionWorld(stage);
    const fixture = createCombatFlowFixture(runtime, hero), { game, player, events } = fixture;
    const room = world.bossRoom;
    room.spawned = true; room.discovered = true;
    Object.assign(game, { stage, world, curRoom: room, boss: null, bossDefeated: false });
    fixture.room = room;
    game.ui = lenient({ ...game.ui, toast: noop, showBoss: noop });
    game.renderer = lenient({ ...game.renderer });
    game.fx.orb = () => { const orb = new Group(); orb.userData.core = new Group(); return orb; };
    game.fx = lenient(game.fx);
    game.spawnEnemy = (type, near, at = room) => {
      const angle = Math.random() * Math.PI * 2;
      return spawnCombatFlowEnemy(fixture, near.x + Math.cos(angle) * 3, near.z + Math.sin(angle) * 3, { id: type, homeRoom: at });
    };
    player.pos.set(room.x - 4, 0, room.z);
    const stats = runtime.heroStats(runtime.HEROES[hero], { level: heroLevel, star: 1 });
    Object.assign(player.stats, stats); player.maxHp = player.hp = stats.hp; player.heroLevel = heroLevel;
    player.auto = true;

    const def = stage.expeditionEnemy;
    const maxHp = Math.floor(def.hp * stage.scale);
    // 몸 반지름은 실제 Enemy 생성자처럼 0.7 × scale 이다(군중 접촉이 영웅을 이만큼 밀어낸다).
    const boss = spawnCombatFlowEnemy(fixture, room.x + 4, room.z, { id: stage.encounter.enemyId, def, hp: maxHp, maxHp,
      atk: def.atk * Math.pow(stage.scale, 0.7), atkCd: 1.2, isBoss: true, radius: .7 * def.scale, homeRoom: room });
    boss.runtimeSpeciesId = stage.encounter.enemyId;
    boss.signatures = new runtime.BossSignatures(boss);
    game.boss = boss;
    game.enemies.length = 0; game.enemies.push(boss);

    const rear = mode === 'off' ? null : new EmberRearExposure(rearDef, world);
    if (rear && mode === 'on') game.routeObjectives.autoFlank = p => rear.autoFlank(p);
    // Battle.update 순서(player.update → routeObjectives.update → enemies.update)를 그대로 맞춘다.
    if (rear) {
      const playerUpdate = player.update;
      player.update = function(dt) { playerUpdate.call(this, dt); rear.update(game, dt); };
    }
    let attacksInWindow = 0, killSeconds = null, exposedFrames = 0, openedAt = -1;
    let windowsWithRear = 0, rearSeen = false, rearBefore = 0;
    const firstRear = [];
    for (let frame = 0, n = Math.round(maxSeconds / DT); frame < n && game.active; frame++) {
      const wasExposed = rear?.state === 'exposed', seqBefore = boss.attackSequence || 0;
      stepCombatFlow(fixture, DT);
      const exposed = rear?.state === 'exposed';
      if (exposed) exposedFrames++;
      if (!wasExposed && exposed) { openedAt = game.elapsed; rearSeen = false; rearBefore = rear.rearHits; }
      if (exposed && !rearSeen && rear.rearHits > rearBefore) { rearSeen = true; windowsWithRear++; firstRear.push(game.elapsed - openedAt); }
      if (wasExposed && exposed && (boss.attackSequence || 0) !== seqBefore) attacksInWindow++;
      if (!boss.alive) { killSeconds = game.elapsed; break; }
    }
    if (rear) { game.bossDefeated = !boss.alive; rear.update(game, DT); rear.stop(); }
    return { hero, seed, mode, heroLevel, killSeconds: killSeconds === null ? null : round(killSeconds),
      windows: rear ? rear.windows : 0, broken: rear ? rear.broken : 0, windowsWithRear,
      firstRearMedian: round(median(firstRear)), exposedSeconds: round(exposedFrames * DT),
      heroDamageTaken: Math.round(events.damageTaken), heroDied: !player.alive,
      bossAttacks: boss.attackSequence || 0, attacksInWindow,
      ...(rear ? { rearHits: rear.rearHits, frontHits: rear.frontHits, sideHits: rear.sideHits, rearDamage: Math.round(rear.rearDamage), frontDamage: Math.round(rear.frontDamage) } : {}) };
  } finally { Math.random = originalRandom; }
}

/** 영웅·모드별 처치 시간 중앙값과 off 대비 비. 처치 못 한 판은 중앙값에서 빼고 개수를 따로 센다. */
export function summarize(rows) {
  const out = [];
  for (const hero of [...new Set(rows.map(r => r.hero))]) {
    const kills = list => list.filter(r => r.killSeconds !== null).map(r => r.killSeconds);
    const off = median(kills(rows.filter(r => r.hero === hero && r.mode === 'off')));
    for (const mode of [...new Set(rows.map(r => r.mode))]) {
      const list = rows.filter(r => r.hero === hero && r.mode === mode), med = median(kills(list));
      out.push({ hero, mode, runs: list.length, killMedian: round(med), ratioToOff: med !== null && off ? round(med / off) : null,
        killed: kills(list).length, deaths: list.filter(r => r.heroDied).length,
        windows: list.reduce((n, r) => n + r.windows, 0), windowsWithRear: list.reduce((n, r) => n + r.windowsWithRear, 0),
        attacksInWindow: list.reduce((n, r) => n + r.attacksInWindow, 0) });
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const get = (name, fallback) => { const hit = args.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
  const seeds = get('seeds', '1,2,3').split(',').map(Number), heroes = get('heroes', 'knight,mage').split(',');
  const modes = get('modes', 'on,off,noflank').split(',');
  const maxSeconds = Number(get('max-seconds', '600')), heroLevel = Number(get('hero-level', '20')), project = path.resolve(get('project', process.cwd()));
  if (!seeds.length || seeds.some(s => !Number.isSafeInteger(s))) throw new Error('--seeds: 정수 목록');
  if (modes.some(m => !['on', 'off', 'noflank'].includes(m))) throw new Error('--modes: on,off,noflank');
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || !Number.isSafeInteger(heroLevel) || heroLevel < 1) throw new Error('--max-seconds: 양수, --hero-level: 1 이상의 정수');
  const runtime = await loadCombatFlowRuntime(project);
  const { BossSignatures } = await import(pathToFileURL(path.join(project, 'src/game/boss-signatures.js')).href);
  const { EmberRearExposure } = await import(pathToFileURL(path.join(project, 'src/game/ember-rear-exposure.js')).href);
  const { ROUTE_OBJECTIVES } = await import(pathToFileURL(path.join(project, 'src/data/route-objectives.js')).href);
  runtime.BossSignatures = BossSignatures;
  const rearDef = ROUTE_OBJECTIVES.ember_deep.rear;
  const rows = [];
  for (const hero of heroes) for (const seed of seeds) for (const mode of modes) {
    rows.push(runBossSim(runtime, EmberRearExposure, rearDef, { hero, seed, mode, maxSeconds, heroLevel }));
  }
  const summary = summarize(rows);
  if (args.includes('--json')) console.log(JSON.stringify({ rearDef, maxSeconds, heroLevel, rows, summary }, null, 2));
  else {
    console.log('rear def', JSON.stringify(rearDef), 'maxSeconds', maxSeconds, 'heroLevel', heroLevel);
    for (const r of rows) console.log(JSON.stringify(r));
    console.log('--- 영웅·모드별 중앙값 ---');
    for (const s of summary) console.log(JSON.stringify(s));
  }
}
