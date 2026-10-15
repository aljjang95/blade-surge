import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Group } from 'three';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from './combat-flow-sim.mjs';

// 혜성 기사단장 보스전 푸른 궤도선 밸런스 시뮬(BUNDLE-06 4.4).
// combat-flow-sim 의 실제 Player/Enemy/BossSignatures 경로로 혜성 기사단장(일반: 일반 원정 stage 의 보스 정의·bossHp·scale,
// 심층: {depth:'deep'} stage)과 AUTO 영웅을 실제 보스방(world.bossRoom)에 두고 보스 처치까지 1/60초로 돌린다.
// 켬은 실제 CometBossOrbit 을 붙이고 game.routeObjectives = { autoEvade } 를 달아 실제 AUTO 회피 경로를 쓰며, 끔은 붙이지 않는다.
// Battle.update 순서(player → orbit.update → enemies)를 그대로 맞춘다. 난수는 시드로 고정한다.
// 이 도구는 결과만 보고한다. first·every·damage 수치 판정과 조정은 사용하는 쪽이 한다.
//
// 사용: node tools/comet-boss-sim.mjs [--depths=standard,deep] [--seeds=1,2,3] [--heroes=knight,mage] [--hero-level=45]
//        [--max-seconds=600] [--json] [--determinism] [--project=<경로>]
//   --hero-level=<레벨>: 실제 heroStats 공식(레벨당 +8%, 장비·별 없음)으로 영웅 스탯을 정한다. 기본 45. 스킬 레벨은 1로 고정한다.
//   --determinism: 모든 판을 한 번 더 돌려 결과가 같은지 확인한다(다르면 mismatches 에 담고 종료 코드 1).

const DT = 1 / 60;
const noop = () => {};
/** 화면·연출 객체의 없는 메서드는 아무것도 하지 않는 함수로 대신한다(ui.ultCinema 등 시뮬이 보지 않는 연출). */
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

/** 한 판: 보스방에서 AUTO 영웅 1명과 혜성 기사단장 1마리. 난수는 시드로 고정한다. */
export function runBossSim(runtime, CometBossOrbit, bossDef, { depth = 'standard', hero = 'knight', seed = 1, orbit = true, maxSeconds = 600, heroLevel = 45 } = {}) {
  const originalRandom = Math.random; Math.random = seeded(seed);
  try {
    const stage = depth === 'deep' ? runtime.buildExpeditionStage('dungeon', 'comet_bastion', null, { depth: 'deep' })
      : runtime.buildExpeditionStage('dungeon', 'comet_bastion', null);
    const world = runtime.buildExpeditionWorld(stage);
    const fixture = createCombatFlowFixture(runtime, hero), { game, player, events } = fixture;
    const room = world.bossRoom;
    room.spawned = true; room.discovered = true;
    Object.assign(game, { stage, world, curRoom: room, boss: null, bossDefeated: false });
    fixture.room = room;
    game.ui = lenient({ ...game.ui, toast: noop, showBoss: noop });
    game.renderer = lenient({ ...game.renderer });
    // 각성 스킬이 구체의 core 메시를 읽으므로 빈 core 를 달아 준다.
    game.fx.orb = () => { const orb = new Group(); orb.userData.core = new Group(); return orb; };
    game.fx = lenient(game.fx);
    // 보스 소환(summonMinions → after → spawnEnemy)은 실제 규칙을 그대로 쓰고, 모델이 필요한 spawnEnemy 만 시뮬 적으로 대신한다.
    game.spawnEnemy = (type, near, at = room) => {
      const angle = Math.random() * Math.PI * 2;
      return spawnCombatFlowEnemy(fixture, near.x + Math.cos(angle) * 3, near.z + Math.sin(angle) * 3, { id: type, homeRoom: at });
    };
    player.pos.set(room.x - 4, 0, room.z);
    const stats = runtime.heroStats(runtime.HEROES[hero], { level: heroLevel, star: 1 });
    Object.assign(player.stats, stats); player.maxHp = player.hp = stats.hp; player.heroLevel = heroLevel;
    player.auto = true;

    // Enemy 생성자와 같은 방식으로 체력·공격력을 정한다: hp = floor(def.hp × stage.scale), atk = def.atk × stage.scale^0.7.
    const def = stage.expeditionEnemy;
    const maxHp = Math.floor(def.hp * stage.scale);
    const boss = spawnCombatFlowEnemy(fixture, room.x + 4, room.z, { id: stage.encounter.enemyId, def, hp: maxHp, maxHp,
      atk: def.atk * Math.pow(stage.scale, 0.7), atkCd: 1.2, isBoss: true });
    boss.runtimeSpeciesId = stage.encounter.enemyId;
    boss.signatures = new runtime.BossSignatures(boss);
    game.boss = boss;
    game.enemies.length = 0; game.enemies.push(boss);

    const ring = orbit ? new CometBossOrbit(bossDef, world) : null;
    if (ring) {
      // 실제 AUTO 가 쓰는 경로: Player.autoMove 가 game.routeObjectives.autoEvade 를 묻는다.
      game.routeObjectives = { ...game.routeObjectives, autoEvade: p => ring.autoEvade(p) };
      // Battle.update 순서(player.update → routeObjectives.update → enemies.update)를 그대로 맞춘다.
      const playerUpdate = player.update;
      player.update = function(dt) { playerUpdate.call(this, dt); ring.update(game, dt); };
    }
    let killSeconds = null;
    for (let frame = 0, n = Math.round(maxSeconds / DT); frame < n && game.active; frame++) {
      stepCombatFlow(fixture, DT);
      if (!boss.alive) { killSeconds = game.elapsed; break; }
    }
    if (ring) { game.bossDefeated = !boss.alive; ring.update(game, DT); ring.stop(); }
    return { depth, hero, seed, orbit: !!orbit, heroLevel, killSeconds: killSeconds === null ? null : round(killSeconds),
      strikes: ring ? ring.strikes : 0, centerStrikes: ring ? ring.centerStrikes : 0, hits: ring ? ring.hits : 0,
      attackStartsDuringWarn: ring ? ring.attackStartsDuringWarn : 0,
      heroDamageTaken: Math.round(events.damageTaken), heroDied: !player.alive, bossAttacks: boss.attackSequence || 0 };
  } finally { Math.random = originalRandom; }
}

/** 난이도×영웅별 켬/끔 처치 시간 중앙값과 비, 사망 수, 피격률. 처치 못 한 판은 중앙값에서 빼고 개수를 따로 센다. */
export function summarize(rows) {
  const out = [];
  for (const depth of [...new Set(rows.map(r => r.depth))]) for (const hero of [...new Set(rows.map(r => r.hero))]) {
    const on = rows.filter(r => r.depth === depth && r.hero === hero && r.orbit), off = rows.filter(r => r.depth === depth && r.hero === hero && !r.orbit);
    const kills = list => list.filter(r => r.killSeconds !== null).map(r => r.killSeconds);
    const onMedian = median(kills(on)), offMedian = median(kills(off));
    const strikes = on.reduce((n, r) => n + r.strikes, 0), hits = on.reduce((n, r) => n + r.hits, 0);
    out.push({ depth, hero, runs: on.length, onKillMedian: round(onMedian), offKillMedian: round(offMedian),
      ratio: onMedian !== null && offMedian ? round(onMedian / offMedian) : null,
      onKilled: kills(on).length, offKilled: kills(off).length,
      onDeaths: on.filter(r => r.heroDied).length, offDeaths: off.filter(r => r.heroDied).length,
      minStrikes: on.length ? Math.min(...on.map(r => r.strikes)) : null,
      strikes, centerStrikes: on.reduce((n, r) => n + r.centerStrikes, 0), hits, hitRate: strikes ? round(hits / strikes) : null,
      attackStartsDuringWarn: on.reduce((n, r) => n + r.attackStartsDuringWarn, 0) });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const get = (name, fallback) => { const hit = args.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
  const depths = get('depths', 'standard,deep').split(','), seeds = get('seeds', '1,2,3').split(',').map(Number), heroes = get('heroes', 'knight,mage').split(',');
  const maxSeconds = Number(get('max-seconds', '600')), heroLevel = Number(get('hero-level', '45')), project = path.resolve(get('project', process.cwd()));
  if (!seeds.length || seeds.some(s => !Number.isSafeInteger(s))) throw new Error('--seeds: 정수 목록');
  if (!depths.length || depths.some(d => !['standard', 'deep'].includes(d))) throw new Error('--depths: standard,deep');
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || !Number.isSafeInteger(heroLevel) || heroLevel < 1) throw new Error('--max-seconds: 양수, --hero-level: 1 이상의 정수');
  const runtime = await loadCombatFlowRuntime(project);
  const load = name => import(pathToFileURL(path.join(project, name)).href);
  const { BossSignatures } = await load('src/game/boss-signatures.js');
  const { CometBossOrbit } = await load('src/game/comet-boss-orbit.js');
  const { ROUTE_OBJECTIVES } = await load('src/data/route-objectives.js');
  runtime.BossSignatures = BossSignatures;
  const bossDef = ROUTE_OBJECTIVES.comet_standard.boss;
  const rows = [], mismatches = [];
  for (const depth of depths) for (const hero of heroes) for (const seed of seeds) for (const orbit of [true, false]) {
    const options = { depth, hero, seed, orbit, maxSeconds, heroLevel };
    const row = runBossSim(runtime, CometBossOrbit, bossDef, options);
    rows.push(row);
    if (args.includes('--determinism')) {
      const again = runBossSim(runtime, CometBossOrbit, bossDef, options);
      if (JSON.stringify(again) !== JSON.stringify(row)) mismatches.push({ first: row, second: again });
    }
  }
  const summary = summarize(rows);
  const determinism = args.includes('--determinism') ? { checked: rows.length, mismatches } : undefined;
  if (args.includes('--json')) console.log(JSON.stringify({ bossDef, maxSeconds, heroLevel, rows, summary, ...(determinism ? { determinism } : {}) }, null, 2));
  else {
    console.log('boss def', JSON.stringify(bossDef), 'maxSeconds', maxSeconds, 'heroLevel', heroLevel);
    for (const r of rows) console.log(JSON.stringify(r));
    console.log('--- 난이도×영웅별 중앙값 비(켬/끔) ---');
    for (const s of summary) console.log(JSON.stringify(s));
    if (determinism) console.log('--- 결정성 ---', JSON.stringify({ checked: determinism.checked, mismatches: mismatches.length }));
  }
  if (mismatches.length) process.exitCode = 1;
}
