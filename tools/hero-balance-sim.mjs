import path from 'node:path';
import { Group } from 'three';
import { pathToFileURL } from 'node:url';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from './combat-flow-sim.mjs';

/**
 * 영웅 균형 시뮬레이터. 실제 Player/Enemy/BattleBase 전투 코드(combat-flow-sim 픽스처)로
 * 스킬별 1회 피해·기본 연타 DPS·60초 순환 추정을 모든 영웅에 같은 방식으로 잰다.
 * 적은 움직이지 않는 허수아비(update 생략, 체력 무한대급)이고 마나·쿨다운·궁극기 게이지는 시전 가능하게 채운다.
 */
export const HEROES_ALL = ['knight', 'barbarian', 'werewolf', 'mage', 'rogue', 'ranger'];
export const SSR_SET = ['knight', 'barbarian', 'werewolf'];
export const FPS = 60;
export const SKILL_WINDOW = 3;    // 시전 뒤 피해를 모으는 시간(초)
export const BUFF_WINDOW = 6;     // 버프 배율 측정용 기본 연타 시간(초)
export const BASIC_WINDOW = 10;   // 기본 연타 DPS 측정 시간(초)
export const ULT_COOLDOWN = 30;   // 궁극기 순환 주기(초) — 게이지 충전 기준 가정
export const SEEDS = 16;          // 치명타 난수를 평균내는 시드 수(고정 시드열 → 결정적)
const HUGE_HP = 1e12;

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

const noop = () => {};
// 어떤 속성·호출도 받아 주는 무시용 객체(fx.smoke.emit 같은 중첩 호출용).
const sink = new Proxy(function sink() {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : typeof k === 'symbol' ? undefined : sink), apply: () => sink });

/** 시나리오 한 판을 만든다: situation 'A'(무리 12마리 고리) | 'B'(단일 2.5m 앞). */
function setup(runtime, heroId, situation) {
  const f = createCombatFlowFixture(runtime, heroId);
  const { game, player } = f;
  // 픽스처가 이름만 열거한 fx 외의 호출(aura 등)도 조용히 넘긴다.
  // fx.impact 는 없는 채로 둬서 서명 연출을 건너뛰고, 나머지 미지정 호출은 무시한다. 나머지 미지정 호출은 무시한다.
  const lenient = (target, skip = []) => new Proxy(target, { get: (t, k) => (k in t ? t[k] : skip.includes(k) || typeof k === 'symbol' ? undefined : sink) });
  game.fx.orb = () => { const g = new Group(); g.userData.core = new Group(); return g; };
  game.fx = lenient(game.fx, ['impact']);
  game.ui = lenient(game.ui);
  game.renderer = lenient(game.renderer);
  // 각성 스킬 해금용 레벨만 올린다. 스탯·희귀도 배율은 픽스처(레벨 1) 그대로다.
  player.heroLevel = 99;
  player.mp = player.maxMp = 1e6;
  player.ult = player.ultMax;
  const spawnDummy = (x, z) => {
    const e = spawnCombatFlowEnemy(f, x, z, { hp: HUGE_HP, maxHp: HUGE_HP, atkCd: 1e9 });
    e.update = noop; // 고정 배치: 이동·공격·넉백 이동 없음
    return e;
  };
  if (situation === 'A') {
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI * 2 / 12 + (Math.random() - .5) * .15;
      const radius = 3 + Math.random() * 4;
      spawnDummy(player.pos.x + Math.sin(angle) * radius, player.pos.z + Math.cos(angle) * radius);
    }
  } else spawnDummy(player.pos.x, player.pos.z + 2.5);
  return f;
}

function withSeed(seed, fn) {
  const original = Math.random; Math.random = seeded(seed);
  try { return fn(); } finally { Math.random = original; }
}

function cleanup(f) { for (const e of f.game.enemies) e.mobRole?.dispose?.(); }

function run(f, seconds, onFrame) {
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) { onFrame?.(i); stepCombatFlow(f, 1 / FPS); }
}

const sumFrom = (f, from, pick = () => true) => f.events.hits.filter(h => h.at >= from - 1e-9 && pick(h)).reduce((s, h) => s + h.amount, 0);

/** 스킬 하나를 새 픽스처에서 한 번 시전하고 3초간 준 피해 합과 버프 정보를 돌려준다. */
function measureSkill(runtime, heroId, situation, index, seed) {
  return withSeed(seed, () => {
    const f = setup(runtime, heroId, situation);
    const { player, game } = f;
    const sk = player.def.skills[index];
    const t0 = game.elapsed;
    const cast = player.tryCastSkill(index);
    if (!cast) { cleanup(f); return { cast: false, damage: 0, buff: null }; }
    const buffAtk = () => player.buffs.atk * player.buffs.atkSpd;
    run(f, SKILL_WINDOW);
    const damage = sumFrom(f, t0);
    // 버프 판정: 시전 직후 상태 확인은 위 3초 안에 끝나므로 별도 판정(아래)에서 같은 시드로 다시 잰다.
    cleanup(f);
    return { cast: true, damage, ult: !!sk.ult, buffAtk: buffAtk() };
  });
}

/** 기본 연타: 공격 버튼을 seconds초 유지해 준 피해 합. */
function measureBasic(runtime, heroId, situation, seconds, seed) {
  return withSeed(seed, () => {
    const f = setup(runtime, heroId, situation);
    f.game.input.attackHeld = true;
    run(f, seconds);
    const damage = sumFrom(f, 0, h => h.basic);
    cleanup(f);
    return damage;
  });
}

/**
 * 버프 스킬 배율: (시전 완료 뒤 6초 기본 연타 피해) ÷ (버프 없는 6초 기본 연타 피해).
 * 시전 뒤 player.buffs 가 올라간 스킬만 버프 스킬로 본다(영웅 구분 없이 같은 규칙).
 */
function measureBuff(runtime, heroId, situation, index, seed) {
  return withSeed(seed, () => {
    const f = setup(runtime, heroId, situation);
    const { player, game } = f;
    if (!player.tryCastSkill(index)) { cleanup(f); return null; }
    let guard = 0;
    while (player.state === 'skill' && guard++ < FPS * 5) stepCombatFlow(f, 1 / FPS);
    const isBuff = player.buffs.atk > 1 || player.buffs.atkSpd > 1;
    if (!isBuff) { cleanup(f); return null; }
    const durationLeft = player.buffs.t;
    game.input.attackHeld = true;
    const t0 = game.elapsed;
    run(f, BUFF_WINDOW);
    const buffed = sumFrom(f, t0, h => h.basic);
    cleanup(f);
    return { buffed, durationLeft, atk: player.buffs.atk };
  });
}

const mean = xs => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const seedList = n => Array.from({ length: n }, (_, i) => 20261024 + i);

/** 영웅 하나의 전체 측정. 모든 영웅 같은 방식. */
export function measureHero(runtime, heroId, { seeds = SEEDS } = {}) {
  const hero = runtime.HEROES[heroId], list = seedList(seeds), out = { hero: heroId, skills: [], basic: {}, buffs: {}, cycle: {} };
  hero.skills.forEach((sk, index) => {
    const row = { index, id: sk.id, name: sk.name, ult: !!sk.ult, cd: sk.cd || 0, A: 0, B: 0, cast: true, buff: null };
    for (const sit of ['A', 'B']) {
      const rs = list.map(seed => measureSkill(runtime, heroId, sit, index, seed));
      if (rs.some(r => !r.cast)) row.cast = false;
      row[sit] = mean(rs.map(r => r.damage));
    }
    out.skills.push(row);
  });
  for (const sit of ['A', 'B']) {
    out.basic[sit] = mean(list.map(seed => measureBasic(runtime, heroId, sit, BASIC_WINDOW, seed))) / BASIC_WINDOW;
    // 버프 스킬 배율
    const base6 = mean(list.map(seed => measureBasic(runtime, heroId, sit, BUFF_WINDOW, seed)));
    for (const row of out.skills) {
      if (row.ult) continue;
      const rs = list.map(seed => measureBuff(runtime, heroId, sit, row.index, seed));
      if (rs.some(r => !r)) continue;
      const mult = mean(rs.map(r => r.buffed)) / (base6 || 1);
      (out.buffs[row.id] ||= { duration: rs[0].durationLeft, atk: rs[0].atk })[sit] = mult;
    }
  }
  // 60초 순환 추정(초당 피해): Σ 스킬/쿨다운 + 궁극기/30 + 기본 연타 × (1 + Σ 버프 가동률 × (배율−1))
  for (const sit of ['A', 'B']) {
    let skillDps = 0, ultDps = 0, uptimeBonus = 0;
    for (const row of out.skills) {
      if (row.ult) { ultDps += row[sit] / ULT_COOLDOWN; continue; }
      skillDps += row[sit] / row.cd;
      const buff = out.buffs[row.id];
      if (buff) uptimeBonus += Math.min(1, buff.duration / row.cd) * Math.max(0, buff[sit] - 1);
    }
    const basicPart = out.basic[sit] * (1 + uptimeBonus);
    out.cycle[sit] = { skills: skillDps, ult: ultDps, basic: basicPart, total: skillDps + ultDps + basicPart };
  }
  return out;
}

/** 여러 영웅을 재서 SSR 셋 평균 대비 비율과 werewolf 판정을 붙인다. */
export function runHeroBalance(runtime, { heroes = HEROES_ALL, seeds = SEEDS } = {}) {
  const results = {};
  for (const id of heroes) results[id] = measureHero(runtime, id, { seeds });
  const ssr = SSR_SET.filter(id => results[id]);
  const avg = sit => mean(ssr.map(id => results[id].cycle[sit].total));
  const ssrAvg = { A: avg('A'), B: avg('B') };
  for (const id of heroes) {
    results[id].vsSsrAvg = { A: results[id].cycle.A.total / ssrAvg.A, B: results[id].cycle.B.total / ssrAvg.B };
  }
  return { seeds, ssrAvg, results, verdict: judge(results, ssr) };
}

/** werewolf 판정: barbarian 대비 0.95~1.06배(A·B), SSR 최고치의 1.06배 이하, 고유 두 스킬이 실제 피해를 낸다. */
export function judge(results, ssr = SSR_SET) {
  const reasons = [], w = results.werewolf, b = results.barbarian;
  if (!w || !b) return { pass: false, reasons: ['werewolf·barbarian 측정이 필요하다'] };
  for (const sit of ['A', 'B']) {
    const ratio = w.cycle[sit].total / b.cycle[sit].total;
    const top = Math.max(...ssr.filter(id => results[id]).map(id => results[id].cycle[sit].total));
    const vsTop = w.cycle[sit].total / top;
    if (ratio < 0.95 || ratio > 1.06) reasons.push(`${sit}: werewolf/barbarian 순환 추정 ${ratio.toFixed(3)}배 (허용 0.95~1.06)`);
    if (vsTop > 1.06) reasons.push(`${sit}: werewolf가 SSR 최고치의 ${vsTop.toFixed(3)}배 (허용 ≤1.06)`);
  }
  for (const id of ['blood_howl', 'moonlit_hunt']) {
    const row = w.skills.find(s => s.id === id);
    if (!row) reasons.push(`${id} 스킬이 werewolf 스킬 목록에 없다`);
    else if (!row.cast) reasons.push(`${id} 시전 실패`);
    else if (!(row.A > 0 || row.B > 0)) reasons.push(`${id} 피해가 0이다`);
    else if (!(row.A > 0 && row.B > 0)) reasons.push(`${id} 피해가 한쪽 상황에서 0이다 (A=${row.A.toFixed(0)}, B=${row.B.toFixed(0)})`);
  }
  return { pass: reasons.length === 0, reasons };
}

const fmt = n => Math.round(n).toLocaleString('en-US');
const pct = n => (n * 100).toFixed(1) + '%';

export function formatReport(report) {
  const lines = [`영웅 균형 시뮬레이터 (시드 ${report.seeds}개 평균, ${FPS}fps, 적 고정 허수아비)`, ''];
  for (const [id, r] of Object.entries(report.results)) {
    lines.push(`■ ${id}`);
    lines.push('  스킬                      쿨다운   A(무리)    B(단일)  비고');
    for (const s of r.skills) {
      const buff = r.buffs[s.id];
      const note = !s.cast ? '시전 안 됨!' : buff ? `버프 배율 A×${buff.A.toFixed(2)} B×${buff.B.toFixed(2)} (${buff.duration.toFixed(1)}s)` : '';
      lines.push(`  ${s.id.padEnd(22)} ${(s.ult ? 'ULT' : String(s.cd) + 's').padStart(6)} ${fmt(s.A).padStart(9)} ${fmt(s.B).padStart(10)}  ${note}`);
    }
    lines.push(`  기본 연타 DPS            A ${fmt(r.basic.A)}   B ${fmt(r.basic.B)}`);
    for (const sit of ['A', 'B']) {
      const c = r.cycle[sit];
      lines.push(`  60초 순환 추정 ${sit}: ${fmt(c.total)}/s (스킬 ${fmt(c.skills)} + 궁극 ${fmt(c.ult)} + 연타 ${fmt(c.basic)})  SSR 평균 대비 ${pct(r.vsSsrAvg[sit])}`);
    }
    lines.push('');
  }
  lines.push(`SSR 셋 평균 순환 추정: A ${fmt(report.ssrAvg.A)}/s, B ${fmt(report.ssrAvg.B)}/s`);
  lines.push(report.verdict.pass ? '판정: 통과' : '판정: 실패\n  - ' + report.verdict.reasons.join('\n  - '));
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const get = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const seeds = Number(get('--seeds', String(SEEDS)));
  const heroes = get('--heroes', null)?.split(',') ?? HEROES_ALL;
  const runtime = await loadCombatFlowRuntime(path.resolve(get('--project', process.cwd())));
  const report = runHeroBalance(runtime, { heroes, seeds });
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  if (args.includes('--assert') && !report.verdict.pass) {
    if (args.includes('--json')) console.error(report.verdict.reasons.join('\n'));
    process.exitCode = 1;
  }
}
