// 분대 편성 — 방 명단을 '역할이 다른 몬스터를 순서대로 섞은 무리'가 아니라 역할 조합 분대로 짠다.
// 2026-10-27 대표님 피드백("같은 던전에서 같은 몬스터, 오합지졸 느낌, 단계에 맞는 정체성이 없다")과
// 직접 플레이 실측(1-1 모든 일반 방에 10~11종이 섞임)에서 출발했다.
//  - 단계 곡선: X-1 은 기본 3종 + 원거리 1종으로 시작해 관문마다 새 역할 하나를 소개한다(학습 → 응용 → 시험).
//  - 분대: 방패 전열·습격대·포격진·의식·매복·폭파조·종 대열·분쇄대. 방마다 주 분대(테마)가 정해져 같은 던전이라도 방의 성격이 다르다.
//  - 보상: 명단 풀(stage.rosterFor())은 그대로 두고 고르는 방식만 바꾼다(정산 stageRankValues 와 같은 풀).
// 순수 함수다. Battle.prototype.roomRoster.call({ stage, rosterSize }) 테스트 경로에서도 돈다.
import { ENEMIES } from '../data/stages.js';

/** 몬스터 정의의 역할. 행동 코드(behavior·meleeRole)에서 읽는다. */
/** 분대 편성·정예 접두사·지역 특성을 쓰는 전투인지: 캠페인 혼자 플레이(원정·파티 제외 — 파티 게스트 스냅샷에 이 상태가 실리지 않는다). */
export function campaignCombat(stage) { return !!stage && Number.isInteger(stage.st) && !stage.expedition && !stage.party; }

// 5장부터 캠페인 적 공격 ×1.3. 적 공격은 배율^0.7, 영웅 체력·방어는 전투력에 비례해 커져 7-10 보스가 영웅을 쓰러뜨리는 데
// 처치 시간의 10배가 걸렸다(권장 전투력 61%로도 승리). 보상·정산·배율(scale)은 그대로 두고 위협만 되살린다. 원정·파티 제외.
export const LATE_CHAPTER_FROM = 5, LATE_CHAPTER_ATK = 1.3;
export function campaignAtkMul(stage) { return campaignCombat(stage) && (stage.chapter?.id ?? stage.ch) >= LATE_CHAPTER_FROM ? LATE_CHAPTER_ATK : 1; }

export function speciesRole(def) {
  if (!def) return 'line';
  if (def.behavior === 'shield') return 'tank';
  if (def.behavior === 'shaman') return 'support';
  if (def.behavior === 'bomber') return 'bomber';
  if (def.behavior === 'burrower') return 'ambush';
  if (def.behavior === 'bellringer') return 'special';
  if (def.meleeRole === 'flanker') return 'flanker';
  if (def.meleeRole === 'charger') return 'striker';
  if (def.meleeRole === 'crusher') return 'bruiser';
  if (def.ranged) return 'ranged';
  return 'line';
}

// 대형 위치: 앞(+)은 진입한 영웅 쪽, 뒤(-)는 방 안쪽. 측면 침투는 옆으로 벌린다.
export const ROLE_FORMATION = { tank: 2, bruiser: 1.2, line: .4, striker: .6, bomber: .9, ambush: 0, special: -.4, flanker: 0, ranged: -2.4, support: -3 };
export const ROLE_SIDE = { flanker: 2.2 };

/** 역할이 없을 때 대신 세울 역할. */
const FALLBACK = { tank: ['line'], support: ['ranged', 'line'], ranged: ['line'], bomber: ['line'], flanker: ['striker', 'line'], striker: ['flanker', 'line'], bruiser: ['tank', 'line'], ambush: ['line'], special: ['tank', 'line'], line: ['tank', 'bruiser', 'striker', 'flanker'] };

/** 분대 틀. key 는 이 분대가 성립하려면 반드시 있어야 하는 역할이다. */
export const SQUADS = {
  vanguard: { name: '방패 전열', key: 'tank', slots: ['tank', 'line', 'line', 'ranged', 'tank'], hint: '방패는 정면을 막습니다. 옆·뒤로 돌거나 마무리 타격으로 가드를 깨세요.' },
  artillery: { name: '포격진', key: 'ranged', need: 2, slots: ['tank', 'ranged', 'ranged', 'line', 'ranged'], hint: '뒷줄 원거리부터 노리세요. 방패병을 돌아 들어가면 사격이 멎습니다.' },
  ritual: { name: '주술 의식', key: 'support', slots: ['support', 'line', 'line', 'tank', 'line'], hint: '녹색 고리의 주술사가 치유하고 소환합니다. 먼저 쓰러뜨리세요.' },
  ambush: { name: '매복', key: 'ambush', slots: ['ambush', 'ambush', 'line', 'ambush', 'line'], hint: '땅이 갈라지는 원에서 솟구칩니다. 원 밖으로 비킨 뒤 솟은 직후의 무방비를 치세요.' },
  demolition: { name: '폭파조', key: 'bomber', slots: ['bomber', 'line', 'bomber', 'bruiser', 'line'], hint: '자폭병을 무리 속으로 끌어모으면 연쇄 폭발이 적을 쓸어 냅니다.' },
  skirmish: { name: '습격대', key: 'flanker', slots: ['flanker', 'flanker', 'line', 'striker', 'line'], hint: '자객이 옆으로 돌아 찌릅니다. 예고 선을 보고 회피한 뒤 반격하세요.' },
  brawlers: { name: '분쇄대', key: 'bruiser', slots: ['bruiser', 'line', 'bruiser', 'striker', 'line'], hint: '내려찍기 원 밖으로 빠졌다가 큰 몸이 멈춘 틈에 몰아치세요.' },
  bellhost: { name: '종 대열', key: 'special', slots: ['special', 'line', 'tank', 'line', 'ranged'], hint: '종지기의 고리 사이 빈틈으로 피하세요. 종을 깨면 주변 적이 기절합니다.' },
  rabble: { name: '선봉 무리', key: 'line', slots: ['line', 'line', 'line', 'ranged', 'line'], hint: '' },
};

// 소개 순서: 기본(일반·방패) → 지역 상징(잠복·종지기) → 폭발 → 측면 → 돌격 → 분쇄. 원거리는 기본 → 둘째 → 주술사.
const TRASH_ORDER = ['line', 'tank', 'signature', 'bomber', 'flanker', 'striker', 'bruiser', 'ambush', 'special'];

function rank(id, signatureId) {
  const role = speciesRole(ENEMIES[id]);
  return id === signatureId ? TRASH_ORDER.indexOf('signature') : TRASH_ORDER.indexOf(role);
}

/**
 * 단계(1~10)에서 쓸 수 있는 종과 이번 단계에 새로 소개되는 종.
 * @param {{trash:string[],ranged:string[]}} R @param {number} st
 */
export function stageCurve(R, st) {
  const trash = [...new Set(R.trash)], ranged = [...new Set(R.ranged)];
  // 지역 상징: 종지기가 있으면 종지기, 없으면 잠복형.
  const signatureId = trash.find((id) => ENEMIES[id]?.behavior === 'bellringer') || trash.find((id) => ENEMIES[id]?.behavior === 'burrower') || null;
  // 일반 몹은 두 종만 먼저 세우고, 나머지 일반 몹은 특수 역할을 다 소개한 뒤에 섞는다.
  const lines = trash.filter((id) => id !== signatureId && speciesRole(ENEMIES[id]) === 'line');
  const order = [...lines.slice(0, 2), ...trash.filter((id) => !lines.slice(0, 2).includes(id)).map((id, i) => ({ id, i, r: lines.includes(id) ? 99 : rank(id, signatureId) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id)];
  // 일반 몹 두 종(같은 역할이면 앞 둘)과 방패를 먼저 세운다.
  const tCount = Math.min(order.length, 2 + Math.max(1, st));
  const rOrder = ranged.map((id, i) => ({ id, i, r: ENEMIES[id]?.behavior === 'shaman' ? 1 : 0 })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id);
  const rCount = st >= 4 ? rOrder.length : st >= 3 ? Math.min(2, rOrder.length) : 1;
  const T = order.slice(0, tCount), RG = rOrder.slice(0, rCount);
  const prevT = order.slice(0, Math.min(order.length, 2 + Math.max(1, st - 1))), prevR = st - 1 >= 4 ? rOrder : st - 1 >= 3 ? rOrder.slice(0, 2) : rOrder.slice(0, 1);
  const fresh = st > 1 ? [...T.filter((id) => !prevT.includes(id)), ...RG.filter((id) => !prevR.includes(id))] : [];
  return { trash: T, ranged: RG, featured: fresh[0] || null, signatureId };
}

/** 결정적 해시(무작위 없이 방·단계마다 다른 선택). */
function hash(a, b, c = 0) { let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return (h ^ (h >>> 15)) >>> 0; }

/**
 * 한 방의 일반 명단(정예 제외)을 분대로 짠다.
 * @returns {{list:string[], squadOf:number[], roles:string[], theme:string, secondary:string|null, featured:string|null}}
 */
export function composeRoom(R, st, roomId, stageIdx, n, { featuredRoom = false } = {}) {
  const curve = stageCurve(R, st);
  const byRole = {};
  for (const id of [...curve.trash, ...curve.ranged]) (byRole[speciesRole(ENEMIES[id])] ||= []).push(id);
  const has = (role, k = 1) => (byRole[role]?.length || 0) >= k || (role === 'ranged' && k === 2 && (byRole.ranged?.length || 0) + (byRole.support?.length || 0) >= 2);
  const featuredRole = curve.featured ? speciesRole(ENEMIES[curve.featured]) : null;
  const avail = Object.entries(SQUADS).filter(([k, s]) => k !== 'rabble' && has(s.key, s.need || 1));
  const weight = ([k, s]) => (s.key === featuredRole ? 2 : 1) * (k === 'vanguard' || k === 'artillery' ? 1 : 1.5);
  const pick = (seed, skip) => {
    const pool = avail.filter(([k]) => k !== skip); if (!pool.length) return 'rabble';
    let total = 0; for (const e of pool) total += weight(e);
    let r = (seed % 1000) / 1000 * total;
    for (const e of pool) { r -= weight(e); if (r < 0) return e[0]; }
    return pool[pool.length - 1][0];
  };
  const featuredTheme = featuredRole && avail.find(([, s]) => s.key === featuredRole)?.[0];
  const theme = featuredRoom && featuredTheme ? featuredTheme : avail.length ? pick(hash(roomId, stageIdx, 1)) : 'rabble';
  const secondary = avail.length > 1 ? pick(hash(roomId, stageIdx, 2), theme) : 'rabble';
  const squads = Math.max(1, Math.min(5, Math.round(n / 4)));
  const turn = {}, list = [], squadOf = [], roles = [];
  const choose = (role) => {
    for (const r of [role, ...(FALLBACK[role] || []), 'line']) {
      const ids = byRole[r]; if (!ids?.length) continue;
      const k = turn[r] = (turn[r] ?? hash(roomId, stageIdx, r.length) % ids.length) + 1;
      return ids[k % ids.length];
    }
    return curve.trash[0] || R.trash[0];
  };
  for (let i = 0; i < n; i++) {
    const sq = i % squads, slot = Math.floor(i / squads);
    const tpl = SQUADS[sq % 2 === 0 ? theme : secondary];
    const id = choose(tpl.slots[slot % tpl.slots.length]);
    list.push(id); squadOf.push(sq); roles.push(speciesRole(ENEMIES[id]));
  }
  // 새로 소개되는 종이 분대 틀에 자리가 없는 역할(일반·돌격)이면 같은 역할(없으면 일반) 자리 셋을 그 종으로 바꿔 소개 방에서 꼭 보이게 한다.
  if (featuredRoom && curve.featured && !list.includes(curve.featured)) {
    let left = Math.min(3, Math.ceil(n / 5));
    for (const want of [featuredRole, 'line']) for (let i = 0; i < n && left > 0; i++) if (roles[i] === want && list[i] !== curve.featured) { list[i] = curve.featured; roles[i] = featuredRole; left--; }
  }
  return { list, squadOf, roles, theme, secondary, featured: curve.featured };
}
