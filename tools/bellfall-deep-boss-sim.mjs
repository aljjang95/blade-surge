import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Group } from 'three';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from './combat-flow-sim.mjs';

// 종락 심층 보스 합창 장막 밸런스 시뮬(BUNDLE-05 4.4).
// combat-flow-sim 의 실제 Player/Enemy/BossSignatures 경로로 심층 보스(stage 의 bossHp·scale)와 AUTO 영웅을 한 방에 두고
// 보스 처치까지 1/60초로 돌린다. 카운터 켬은 실제 BellfallDeepCounter 를 붙이고, 끔은 붙이지 않는다.
// 이 도구는 결과만 보고한다. veil·open·window 수치 판정은 사용하는 쪽이 한다.
//
// 사용: node tools/bellfall-deep-boss-sim.mjs [--seeds=1,2,3] [--heroes=knight,mage] [--max-seconds=600] [--json] [--project=<경로>]
//   --hero-level=<레벨>: 실제 heroStats 공식(레벨당 +8%, 장비·별 없음)으로 영웅 스탯을 정한다. 기본 20.
//     심층 원정 입장 레벨(minLevel 2)은 클리어 수준이 아니라 입장 조건이라, 기본 1레벨 스탯(combat-flow-sim 기본)으로는 켬/끔 모두 보스에게 진다.
//     기본 20은 카운터 끔에서 보스가 대략 2분 안에 쓰러지도록 고른 시뮬 입력이며 게임 수치가 아니다. 스킬 레벨은 1로 고정한다.

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

/** 한 판: 보스방에서 AUTO 영웅 1명과 심층 보스 1마리. 난수는 시드로 고정한다. */
export function runBossSim(runtime, BellfallDeepCounter, counterDef, { hero = 'knight', seed = 1, counter = true, maxSeconds = 600, heroLevel = 20 } = {}) {
  const originalRandom = Math.random; Math.random = seeded(seed);
  try {
    const stage = runtime.buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' });
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

    const veil = counter ? new BellfallDeepCounter(counterDef, world) : null;
    // Battle.update 순서(player.update → routeObjectives.update → enemies.update)를 그대로 맞춘다.
    if (veil) {
      const playerUpdate = player.update;
      player.update = function(dt) { playerUpdate.call(this, dt); veil.update(game, dt); };
    }
    let seqInWindow = 0, attacksInWindow = 0, killSeconds = null;
    for (let frame = 0, n = Math.round(maxSeconds / DT); frame < n && game.active; frame++) {
      const wasOpen = veil?.state === 'open', seqBefore = boss.attackSequence || 0;
      stepCombatFlow(fixture, DT);
      // 창이 이미 열려 있던 프레임 안에서 새 공격이 시작되면 센다(창이 닫히는 마지막 프레임 경계는 제외).
      if (wasOpen && veil.state === 'open' && (boss.attackSequence || 0) !== seqBefore) attacksInWindow++;
      seqInWindow = boss.attackSequence || 0;
      if (!boss.alive) { killSeconds = game.elapsed; break; }
    }
    if (veil) { game.bossDefeated = !boss.alive; veil.update(game, DT); veil.stop(); }
    const result = { hero, seed, counter: !!counter, heroLevel, killSeconds: killSeconds === null ? null : round(killSeconds),
      windows: veil ? veil.windows : 0, broken: veil ? veil.broken : 0,
      heroDamageTaken: Math.round(events.damageTaken), heroDied: !player.alive,
      bossAttacks: seqInWindow, attacksInWindow,
      ...(veil ? { veiledHits: veil.veiledHits, openHits: veil.openHits, veiledDamage: Math.round(veil.veiledDamage), openDamage: Math.round(veil.openDamage) } : {}) };
    return result;
  } finally { Math.random = originalRandom; }
}

/** 영웅별 켬/끔 처치 시간 중앙값과 비. 처치 못 한 판은 중앙값에서 빼고 개수를 따로 센다. */
export function summarize(rows) {
  const out = [];
  for (const hero of [...new Set(rows.map(r => r.hero))]) {
    const on = rows.filter(r => r.hero === hero && r.counter), off = rows.filter(r => r.hero === hero && !r.counter);
    const kills = list => list.filter(r => r.killSeconds !== null).map(r => r.killSeconds);
    const onMedian = median(kills(on)), offMedian = median(kills(off));
    out.push({ hero, runs: on.length, onKillMedian: round(onMedian), offKillMedian: round(offMedian),
      ratio: onMedian !== null && offMedian ? round(onMedian / offMedian) : null,
      onKilled: kills(on).length, offKilled: kills(off).length,
      onDeaths: on.filter(r => r.heroDied).length, offDeaths: off.filter(r => r.heroDied).length,
      minWindows: on.length ? Math.min(...on.map(r => r.windows)) : null,
      attacksInWindow: on.reduce((n, r) => n + r.attacksInWindow, 0) });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const get = (name, fallback) => { const hit = args.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
  const seeds = get('seeds', '1,2,3').split(',').map(Number), heroes = get('heroes', 'knight,mage').split(',');
  const maxSeconds = Number(get('max-seconds', '600')), heroLevel = Number(get('hero-level', '20')), project = path.resolve(get('project', process.cwd()));
  if (!seeds.length || seeds.some(s => !Number.isSafeInteger(s))) throw new Error('--seeds: 정수 목록');
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || !Number.isSafeInteger(heroLevel) || heroLevel < 1) throw new Error('--max-seconds: 양수, --hero-level: 1 이상의 정수');
  const runtime = await loadCombatFlowRuntime(project);
  const { BossSignatures } = await import(pathToFileURL(path.join(project, 'src/game/boss-signatures.js')).href);
  const { BellfallDeepCounter } = await import(pathToFileURL(path.join(project, 'src/game/bellfall-deep-counter.js')).href);
  const { ROUTE_OBJECTIVES } = await import(pathToFileURL(path.join(project, 'src/data/route-objectives.js')).href);
  runtime.BossSignatures = BossSignatures;
  const counterDef = ROUTE_OBJECTIVES.bellfall_deep.counter;
  const rows = [];
  for (const hero of heroes) for (const seed of seeds) for (const counter of [true, false]) {
    rows.push(runBossSim(runtime, BellfallDeepCounter, counterDef, { hero, seed, counter, maxSeconds, heroLevel }));
  }
  const summary = summarize(rows);
  if (args.includes('--json')) console.log(JSON.stringify({ counterDef, maxSeconds, heroLevel, rows, summary }, null, 2));
  else {
    console.log('counter def', JSON.stringify(counterDef), 'maxSeconds', maxSeconds, 'heroLevel', heroLevel);
    for (const r of rows) console.log(JSON.stringify(r));
    console.log('--- 영웅별 중앙값 비(켬/끔) ---');
    for (const s of summary) console.log(JSON.stringify(s));
  }
}
