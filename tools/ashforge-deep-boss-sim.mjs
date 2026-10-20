import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Group } from 'three';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from './combat-flow-sim.mjs';

// 재벼림 제련소 심층 거수 사슬 끊기 보스전 모의(BUNDLE-15). ember-deep-boss-sim.mjs(BUNDLE-14)와 같은 방식이다.
// combat-flow-sim 의 실제 Player/Enemy/BossSignatures/군중 접촉 경로로 심층 보스(stage 의 bossHp·scale·몸 반지름)와 AUTO 영웅을 보스방에 두고
// 보스 처치까지 1/60초로 돌린다. 모드:
//   off    — 사슬 끊기 없음(기준선)
//   on     — 실제 AshforgeChainBreak 를 붙이고 AUTO 가 autoHold 로 열린 기둥에 가서 버틴다(후보)
//   nohold — 사슬 끊기는 붙이되 AUTO 버티기 훅을 주지 않는다(기둥을 무시하는 플레이어: 망치 뒤 묶임만 받는다)
// 이 도구는 결과만 보고한다. 수치 판정은 사용하는 쪽(PLAN)이 한다.
//
// 사용: bun tools/ashforge-deep-boss-sim.mjs [--seeds=1,2,3] [--heroes=knight,mage] [--modes=on,off,nohold] [--max-seconds=600] [--hero-level=20] [--json] [--project=<경로>]

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
export function runChainSim(runtime, AshforgeChainBreak, chainDef, { hero = 'knight', seed = 1, mode = 'on', maxSeconds = 600, heroLevel = 20 } = {}) {
  const originalRandom = Math.random; Math.random = seeded(seed);
  try {
    const stage = runtime.buildExpeditionStage('dungeon', 'ashforge_catacomb', null, { depth: 'deep' });
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

    const chains = mode === 'off' ? null : new AshforgeChainBreak(chainDef, world);
    if (chains && mode === 'on') game.routeObjectives.autoHold = p => chains.autoHold(p);
    // Battle.update 순서(player.update → routeObjectives.update → enemies.update)를 그대로 맞춘다.
    if (chains) {
      const playerUpdate = player.update;
      player.update = function(dt) { playerUpdate.call(this, dt); chains.update(game, dt); };
    }
    // 시간은 게임 시간(stepCombatFlow 가 돌려주는 dt, 히트스톱 반영)으로 센다.
    let attacksPinned = 0, attacksExposed = 0, killSeconds = null, openTime = 0, exposedTime = 0, openedAt = -1, bossMovedPinned = 0, bossMovedMax = 0;
    // 묶임이 이어지는 동안의 누적 밀림(묶이기 시작한 위치에서 가장 멀어진 거리).
    let pinX = NaN, pinZ = NaN, pinDriftMax = 0;
    const cutAfterOpen = [], windowLog = [];
    for (let frame = 0, n = Math.round(maxSeconds / DT); frame < n && game.active; frame++) {
      const before = chains?.state, seqBefore = boss.attackSequence || 0, bx = boss.pos.x, bz = boss.pos.z;
      const dt = stepCombatFlow(fixture, DT);
      const now = chains?.state;
      if (now === 'open') openTime += dt;
      if (now === 'exposed') exposedTime += dt;
      if (before !== 'open' && now === 'open') { openedAt = game.elapsed; windowLog.push({ heroState: player.alive ? player.state : 'dead', side: chains.pullSide, cut: false, bossDied: false, heroToPillar: round(Math.hypot(player.pos.x - chains.pillar.x, player.pos.z - chains.pillar.z), 2) }); }
      if (before === 'open' && now === 'exposed') { cutAfterOpen.push(game.elapsed - openedAt); windowLog[windowLog.length - 1].cut = true; }
      const pinnedBefore = before === 'open' || before === 'exposed', pinnedNow = now === 'open' || now === 'exposed';
      if (pinnedBefore && pinnedNow && (boss.attackSequence || 0) !== seqBefore) attacksPinned++;
      if (before === 'exposed' && now === 'exposed' && (boss.attackSequence || 0) !== seqBefore) attacksExposed++;
      // 묶인 스텝(추격 단계이고 pins 참)에서 보스가 움직인 스텝 수와 한 스텝 최대 이동(군중 접촉·넉백 관찰용).
      const pinnedStep = pinnedBefore && pinnedNow && boss.state === 'chase' && chains.pins(boss);
      if (pinnedStep) {
        const moved = Math.hypot(boss.pos.x - bx, boss.pos.z - bz);
        if (moved > 1e-6) { bossMovedPinned++; bossMovedMax = Math.max(bossMovedMax, moved); }
        if (Number.isNaN(pinX)) { pinX = bx; pinZ = bz; }
        pinDriftMax = Math.max(pinDriftMax, Math.hypot(boss.pos.x - pinX, boss.pos.z - pinZ));
      } else pinX = pinZ = NaN;
      if (!boss.alive) { killSeconds = game.elapsed; if ((before === 'open') && windowLog.length) windowLog[windowLog.length - 1].bossDied = true; break; }
    }
    if (chains) { game.bossDefeated = !boss.alive; chains.update(game, DT); chains.stop(); }
    return { hero, seed, mode, heroLevel, killSeconds: killSeconds === null ? null : round(killSeconds),
      windows: chains ? chains.windows : 0, cuts: chains ? chains.cuts : 0, misses: chains ? chains.misses : 0, broken: chains ? chains.broken : 0,
      cutAfterOpenMedian: round(median(cutAfterOpen)), openSeconds: round(openTime), exposedSeconds: round(exposedTime), windowLog,
      heroDamageTaken: Math.round(events.damageTaken), heroDied: !player.alive,
      bossAttacks: boss.attackSequence || 0, attacksPinned, attacksExposed, bossMovedPinned, bossMovedMax: round(bossMovedMax, 4), pinDriftMax: round(pinDriftMax, 4),
      ...(chains ? { exposedDamage: Math.round(chains.exposedDamage) } : {}) };
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
        windows: list.reduce((n, r) => n + r.windows, 0), cuts: list.reduce((n, r) => n + r.cuts, 0), cutsMedian: median(list.map(r => r.cuts)),
        broken: list.reduce((n, r) => n + r.broken, 0), attacksPinned: list.reduce((n, r) => n + r.attacksPinned, 0), attacksExposed: list.reduce((n, r) => n + r.attacksExposed, 0),
        pinDriftMax: Math.max(0, ...list.map(r => r.pinDriftMax)),
        bossMovedPinned: list.reduce((n, r) => n + r.bossMovedPinned, 0) });
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const get = (name, fallback) => { const hit = args.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
  const seeds = get('seeds', '1,2,3').split(',').map(Number), heroes = get('heroes', 'knight,mage').split(',');
  const modes = get('modes', 'on,off,nohold').split(',');
  const maxSeconds = Number(get('max-seconds', '600')), heroLevel = Number(get('hero-level', '20')), project = path.resolve(get('project', process.cwd()));
  if (!seeds.length || seeds.some(s => !Number.isSafeInteger(s))) throw new Error('--seeds: 정수 목록');
  if (modes.some(m => !['on', 'off', 'nohold'].includes(m))) throw new Error('--modes: on,off,nohold');
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || !Number.isSafeInteger(heroLevel) || heroLevel < 1) throw new Error('--max-seconds: 양수, --hero-level: 1 이상의 정수');
  const runtime = await loadCombatFlowRuntime(project);
  const { BossSignatures } = await import(pathToFileURL(path.join(project, 'src/game/boss-signatures.js')).href);
  const { AshforgeChainBreak } = await import(pathToFileURL(path.join(project, 'src/game/ashforge-chain-break.js')).href);
  const { ROUTE_OBJECTIVES } = await import(pathToFileURL(path.join(project, 'src/data/route-objectives.js')).href);
  runtime.BossSignatures = BossSignatures;
  const chainDef = ROUTE_OBJECTIVES.ashforge_deep.chains;
  const rows = [];
  for (const hero of heroes) for (const seed of seeds) for (const mode of modes) {
    rows.push(runChainSim(runtime, AshforgeChainBreak, chainDef, { hero, seed, mode, maxSeconds, heroLevel }));
  }
  const summary = summarize(rows);
  if (args.includes('--json')) console.log(JSON.stringify({ chainDef, maxSeconds, heroLevel, rows, summary }, null, 2));
  else {
    console.log('chain def', JSON.stringify(chainDef), 'maxSeconds', maxSeconds, 'heroLevel', heroLevel);
    for (const r of rows) console.log(JSON.stringify(r));
    console.log('--- 영웅·모드별 중앙값 ---');
    for (const s of summary) console.log(JSON.stringify(s));
  }
}
