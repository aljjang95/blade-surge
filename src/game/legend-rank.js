// 전설 수련(Legend Rank) — 영웅 Lv.80 이후 EXP가 흘러가는 끝없는 성장 축(docs/SPEC_720H.md 3.1).
// 순수 규칙이다: 시계·저장·골드는 호출자(Economy 정산 트랜잭션)가 맡고, 여기서는 상태를 검사·갱신해 결과만 돌려준다.
//  - 계정 공통 저장 키 `legend: { version, rank, exp, points, nodes }`. 영웅을 바꿔도 유지된다.
//  - 단계 r → r+1 필요 EXP = baseExp × (1 + r × growth)(선형 증가, 단계 상한 없음).
//  - 단계마다 점수 1. 점수는 네 갈래 판(칼날·철벽·폭풍·약탈)의 노드(갈래당 6개, 최대 20단계)에 넣는다.
//    노드 효과는 체감 감소 eff × L / (L + k): 장비·강화·룬이 계속 주력이 되도록 한 노드를 몰아 올릴수록 효율이 떨어진다.
//  - 5단계마다 키스톤 하나가 열린다(칼날→철벽→폭풍→약탈 순서로 갈래마다 5개, 단계 100에서 모두 열림).
//    키스톤은 전투 동사를 바꾸는 효과 플래그일 뿐 스탯을 늘리지 않는다. 전투/연출은 legendStats().flags 를 읽어 켠다.
//  - 점수 재분배(respec)는 골드가 든다(재련처럼 골드 싱크).
import { boundedInt } from './rpg-core.js';

const frozen = (value) => Object.freeze(value);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const LEGEND_VERSION = 1;
export const LEGEND_MAX_RANK = 100000;
const MAX_EXP = 1_000_000_000_000;            // 한 번에 받을 수 있는 EXP 상한(정산 입력 방어)
const MAX_COUNTER = 1_000_000_000;

export const LEGEND = frozen({
  baseExp: 400000,              // 0→1 단계 필요 EXP
  growth: 0.10,                 // 단계마다 필요 EXP 증가율(선형)
  k: 10,                        // 체감 감소 계수: 효과 = eff × L / (L + k)
  maxNodeLevel: 20,
  keystoneEvery: 5,             // 5단계마다 키스톤 하나
  respecBase: 50000, respecPerPoint: 3000,
  caps: frozen({ goldPct: 0.30, dropPct: 0.20 }),
});

/** 갈래 순서 = 키스톤이 열리는 순서. */
export const LEGEND_BRANCHES = frozen([
  frozen({ id: 'blade', name: '칼날', tagline: '공격·치명' }),
  frozen({ id: 'wall', name: '철벽', tagline: '체력·방어·회피 회복' }),
  frozen({ id: 'storm', name: '폭풍', tagline: '몰이 반경·진공 세기·재사용 대기' }),
  frozen({ id: 'plunder', name: '약탈', tagline: '골드·드랍' }),
]);

/**
 * 노드 24개. stat 은 legendStats() 가 합산하는 키, eff 는 이 노드를 20단계까지 올렸을 때의 극한값이 아니라
 * "L→∞ 극한"이다(20단계 효과 = eff × 20/30 ≈ 67%).
 * 전투에 바로 이어지는 키: atkPct·hpPct·def·crit·critDmg·ultGain(heroEquipBonus 에 합산).
 * 정산에 이어지는 키: goldPct·stonePct·fragmentPct(completeStage). 나머지는 전투·UI 레인이 읽는 값이다.
 */
export const LEGEND_NODES = frozen([
  // 칼날
  { id: 'blade_edge', branch: 'blade', name: '예리한 날', stat: 'atkPct', eff: 0.20 },
  { id: 'blade_cleave', branch: 'blade', name: '휘몰이 베기', stat: 'atkPct', eff: 0.15 },
  { id: 'blade_keen', branch: 'blade', name: '날카로운 눈', stat: 'crit', eff: 0.08 },
  { id: 'blade_fury', branch: 'blade', name: '격노', stat: 'critDmg', eff: 0.40 },
  { id: 'blade_hunter', branch: 'blade', name: '사냥꾼의 직감', stat: 'bossDmgPct', eff: 0.15 },
  { id: 'blade_focus', branch: 'blade', name: '일격의 집중', stat: 'ultGain', eff: 0.30 },
  // 철벽
  { id: 'wall_bulk', branch: 'wall', name: '단단한 몸', stat: 'hpPct', eff: 0.20 },
  { id: 'wall_vigor', branch: 'wall', name: '끈질김', stat: 'hpPct', eff: 0.15 },
  { id: 'wall_plate', branch: 'wall', name: '강철 가죽', stat: 'def', eff: 600 },
  { id: 'wall_regen', branch: 'wall', name: '숨 고르기', stat: 'regenPct', eff: 0.02 },
  { id: 'wall_roll', branch: 'wall', name: '구르기 회복', stat: 'dodgeRecoverPct', eff: 0.25 },
  { id: 'wall_guard', branch: 'wall', name: '첫 방패', stat: 'openShieldPct', eff: 0.10 },
  // 폭풍
  { id: 'storm_radius', branch: 'storm', name: '넓은 몰이', stat: 'radiusPct', eff: 0.25 },
  { id: 'storm_vacuum', branch: 'storm', name: '깊은 진공', stat: 'vacuumPct', eff: 0.30 },
  { id: 'storm_chain', branch: 'storm', name: '이어지는 소용돌이', stat: 'vacuumPct', eff: 0.20 },
  { id: 'storm_cdr', branch: 'storm', name: '숨 가쁜 소용돌이', stat: 'cdr', eff: 0.12 },
  { id: 'storm_gale', branch: 'storm', name: '질풍', stat: 'speedPct', eff: 0.10 },
  { id: 'storm_eye', branch: 'storm', name: '폭풍의 눈', stat: 'ultGain', eff: 0.25 },
  // 약탈
  { id: 'plunder_gold', branch: 'plunder', name: '약탈 골드', stat: 'goldPct', eff: 0.30 },
  { id: 'plunder_drop', branch: 'plunder', name: '약탈 드랍', stat: 'dropPct', eff: 0.20 },
  { id: 'plunder_ore', branch: 'plunder', name: '광석꾼', stat: 'stonePct', eff: 0.25 },
  { id: 'plunder_frag', branch: 'plunder', name: '조각 수집가', stat: 'fragmentPct', eff: 0.25 },
  { id: 'plunder_magnet', branch: 'plunder', name: '자력', stat: 'pickupPct', eff: 0.50 },
  { id: 'plunder_luck', branch: 'plunder', name: '운 좋은 날', stat: 'rarityPct', eff: 0.10 },
].map((node) => frozen(node)));

const NODE_BY_ID = frozen(Object.fromEntries(LEGEND_NODES.map((node) => [node.id, node])));

/**
 * 키스톤 20개(갈래마다 5개). 효과는 모두 전투 동사 변화다(스탯 키스톤 금지).
 * 열리는 단계 = keystoneEvery × 순번: 순번 1=칼날 1, 2=철벽 1, 3=폭풍 1, 4=약탈 1, 5=칼날 2 ...
 */
export const LEGEND_KEYSTONES = frozen([
  // 칼날
  ['blade_afterimage', 'blade', '잔영', '3타째마다 참격 잔영이 한 번 더 베고 지나간다'],
  ['blade_execute', 'blade', '처형', '체력 15% 이하인 적은 치명이 반드시 터진다'],
  ['blade_riposte', 'blade', '맞받아치기', '피격 직후 0.6초 안의 첫 공격이 주변 충격파가 된다'],
  ['blade_pierce', 'blade', '관통', '참격이 첫 적을 지나 뒤의 적까지 이어진다'],
  ['blade_surge', 'blade', '서지', '스킬 적중 5번마다 다음 기본 공격이 광역 참격이 된다'],
  // 철벽
  ['wall_bulwark', 'wall', '불굴', '치명 피해를 맞아도 체력 1로 한 번 버틴다(한 판에 한 번)'],
  ['wall_thorns', 'wall', '가시', '근접 공격을 맞으면 공격자에게 되돌려 준다'],
  ['wall_second_wind', 'wall', '재기', '체력 30% 이하가 되면 3초간 회복이 빨라진다(한 판에 한 번)'],
  ['wall_stagger', 'wall', '버티기', '넉백을 한 번 무시하고 대신 주변 적을 밀어낸다'],
  ['wall_aegis', 'wall', '방패 의지', '회피 직후 1초간 피해 감소 막이 생긴다'],
  // 폭풍
  ['storm_afterswirl', 'storm', '잔류 회오리', '진공 끝에 작은 회오리가 1초 남는다'],
  ['storm_second_pull', 'storm', '두 번째 당김', '진공이 끝나면 가장 가까운 다른 무리를 한 번 더 끌어당긴다'],
  ['storm_slow', 'storm', '정체', '진공 중심에 묶인 적은 이동이 느려진다'],
  ['storm_burst', 'storm', '폭주', '몰이한 적이 20마리 이상이면 진공 끝에 폭발한다'],
  ['storm_gale_step', 'storm', '질풍걸음', '재사용 대기가 끝나는 순간 2초간 이동이 빨라진다'],
  // 약탈
  ['plunder_tide', 'plunder', '끌어당김', '떨어진 보상이 멀리서도 플레이어 쪽으로 흘러 온다'],
  ['plunder_bounty', 'plunder', '현상금', '정예를 쓰러뜨리면 골드 주머니가 한 번 더 터진다'],
  ['plunder_scout', 'plunder', '척후', '방에 들어서면 근처 보물 위치가 표시된다'],
  ['plunder_spoils', 'plunder', '전리품 폭발', '보스를 쓰러뜨리면 골드가 사방으로 터진다'],
  ['plunder_pillar', 'plunder', '빛기둥', '전설 장비가 떨어지면 빛기둥이 서서 어디서든 보인다'],
].map(([id, branch, name, effect], i) => frozen({ id, branch, name, effect, unlockRank: LEGEND.keystoneEvery * (i % 5 * 4 + LEGEND_BRANCHES.findIndex((b) => b.id === branch) + 1) })));

/** 단계 r → r+1 필요 EXP. */
export function legendExpFor(rank) {
  const r = Number.isSafeInteger(rank) ? Math.max(0, Math.min(LEGEND_MAX_RANK, rank)) : 0;
  return Math.floor(LEGEND.baseExp * (1 + r * LEGEND.growth));
}

const spentOf = (nodes) => Object.values(nodes).reduce((a, n) => a + n, 0);

/** 저장에서 읽은 전설 수련. 알 수 없는 노드·범위 밖 값은 버리고, points 는 항상 rank - 사용한 점수다(조작해도 늘지 않는다). */
export function normalizeLegend(raw) {
  const r = object(raw) ? raw : {};
  const rank = boundedInt(r.rank, 0, 0, LEGEND_MAX_RANK);
  const nodes = {};
  for (const [id, level] of Object.entries(object(r.nodes) ? r.nodes : {})) {
    if (!Object.hasOwn(NODE_BY_ID, id)) continue;
    const value = boundedInt(level, 0, 0, LEGEND.maxNodeLevel);
    if (value > 0) nodes[id] = value;
  }
  // 점수보다 많이 쓴 저장은 노드를 모두 되돌려 준다(골드 없이, 손상 복구).
  if (spentOf(nodes) > rank) for (const id of Object.keys(nodes)) delete nodes[id];
  const exp = Math.min(boundedInt(r.exp, 0, 0, MAX_COUNTER), Math.max(0, legendExpFor(rank) - 1));
  return { version: LEGEND_VERSION, rank, exp, points: rank - spentOf(nodes), nodes };
}

/**
 * Lv.80 이후 EXP 를 쌓는다. state 를 제자리에서 바꾸고 이번에 오른 단계와 새로 열린 키스톤을 돌려준다.
 * 입력이 정수가 아니거나 음수면 아무것도 하지 않는다.
 */
export function grantLegendExp(state, amount) {
  const none = { gained: 0, ranks: 0, rank: boundedInt(state?.rank), exp: boundedInt(state?.exp), points: boundedInt(state?.points), keystones: [] };
  if (!object(state) || !Number.isFinite(amount) || amount <= 0) return none;
  const gained = Math.min(MAX_EXP, Math.floor(amount));
  if (gained <= 0) return none;
  const before = state.rank | 0;
  let rank = before, exp = state.exp + gained;
  // 반복 횟수는 EXP 입력 상한(1조)에서 baseExp 로 나눈 값 이하라 안전하다(필요 EXP 가 단계마다 늘어난다).
  while (rank < LEGEND_MAX_RANK) {
    const need = legendExpFor(rank);
    if (exp < need) break;
    exp -= need; rank++;
  }
  if (rank >= LEGEND_MAX_RANK) exp = 0;
  const ranks = rank - before;
  state.rank = rank; state.exp = Math.min(MAX_COUNTER, exp); state.points += ranks;
  return { gained, ranks, rank, exp: state.exp, points: state.points, keystones: LEGEND_KEYSTONES.filter((k) => k.unlockRank > before && k.unlockRank <= rank).map((k) => k.id) };
}

/** 노드 하나의 효과값(체감 감소). */
export const nodeValue = (node, level) => level > 0 ? node.eff * level / (level + LEGEND.k) : 0;

/** 갈래별 사용한 점수. */
export function branchPoints(state) {
  const out = Object.fromEntries(LEGEND_BRANCHES.map((b) => [b.id, 0]));
  for (const [id, level] of Object.entries(object(state?.nodes) ? state.nodes : {})) if (NODE_BY_ID[id]) out[NODE_BY_ID[id].branch] += level;
  return out;
}

/** 열린 키스톤 목록(단계만으로 정해진다). */
export const legendKeystones = (rank) => LEGEND_KEYSTONES.filter((k) => k.unlockRank <= (Number.isSafeInteger(rank) ? rank : 0));

/**
 * 전투·정산이 읽는 합산 효과. 반환 키:
 *  atkPct hpPct def crit critDmg ultGain(전투 스탯 — Economy.heroEquipBonus 가 합산),
 *  goldPct(상한) stonePct fragmentPct dropPct(상한) pickupPct rarityPct(정산·드랍),
 *  radiusPct vacuumPct cdr speedPct bossDmgPct regenPct dodgeRecoverPct openShieldPct(전투 레인이 읽는 값),
 *  flags(열린 키스톤 id), points(남은 점수), rank.
 */
export function legendStats(state) {
  const s = normalizeLegend(state), out = { rank: s.rank, points: s.points, flags: legendKeystones(s.rank).map((k) => k.id) };
  for (const node of LEGEND_NODES) out[node.stat] ??= 0;
  for (const [id, level] of Object.entries(s.nodes)) { const node = NODE_BY_ID[id]; out[node.stat] += nodeValue(node, level); }
  out.goldPct = Math.min(LEGEND.caps.goldPct, out.goldPct); out.dropPct = Math.min(LEGEND.caps.dropPct, out.dropPct);
  out.def = Math.floor(out.def);
  return out;
}

/** 점수를 노드에 넣는다(n 점). 점수 부족·상한·알 수 없는 노드는 거절하고 state 를 바꾸지 않는다. */
export function allocate(state, nodeId, n = 1) {
  if (!object(state) || !object(state.nodes)) return { ok: false, error: 'state' };
  if (typeof nodeId !== 'string' || !Object.hasOwn(NODE_BY_ID, nodeId)) return { ok: false, error: 'node' };
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false, error: 'amount' };
  const level = state.nodes[nodeId] || 0;
  if (level + n > LEGEND.maxNodeLevel) return { ok: false, error: 'max' };
  if (state.points < n) return { ok: false, error: 'points' };
  state.nodes[nodeId] = level + n; state.points -= n;
  return { ok: true, nodeId, level: level + n, points: state.points };
}

/** 점수 재분배에 드는 골드(쓴 점수가 없으면 0). */
export const respecCost = (state) => { const spent = spentOf(normalizeLegend(state).nodes); return spent ? LEGEND.respecBase + LEGEND.respecPerPoint * spent : 0; };

/**
 * 모든 노드를 되돌려 점수를 환급한다. gold 는 호출자의 현재 골드이며 이 함수는 골드를 차감하지 않는다
 * (정산 트랜잭션이 cost 를 빼고 실패하면 되돌린다). 성공하면 {ok, cost, refunded}.
 */
export function respec(state, gold) {
  if (!object(state) || !object(state.nodes)) return { ok: false, error: 'state', cost: 0 };
  const spent = spentOf(state.nodes);
  if (!spent) return { ok: false, error: 'empty', cost: 0 };
  const cost = LEGEND.respecBase + LEGEND.respecPerPoint * spent;
  if (!Number.isFinite(gold) || gold < cost) return { ok: false, error: 'gold', cost };
  state.nodes = {}; state.points += spent;
  return { ok: true, cost, refunded: spent };
}

/** 영웅 전투 스탯에 더할 몫(Economy.heroEquipBonus 가 합산하는 키만). */
export function legendBonus(state) {
  const s = legendStats(state);
  return { atkPct: s.atkPct, hpPct: s.hpPct, def: s.def, crit: s.crit, critDmg: s.critDmg, ultGain: s.ultGain };
}
