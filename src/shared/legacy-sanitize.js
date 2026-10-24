// MMO P1-G: 로컬 세이브 정화 규칙 (docs/MMO_DESIGN.md 4장 "정화(sanitize) 규칙").
// 1) 구조·ID 검증은 기존 normalizeSave(EconomyCore.fromState)를 그대로 쓴다.
// 2) 재화 상한 = 시작 재화 + 일회성 원천 + 일 최대 획득률 × 경과일. 초과분은 절삭하고 보고서에 남긴다.
// 3) 결제 관련 필드는 가져오지 않는다(결제가 없었다). 4) 상한의 100배를 넘으면 severe(감사·보상 보류).
// 수치는 "가정"이다: 일 최대 획득률은 economy-estimate의 8시간/일 연속 플레이 상한보다 넉넉히(×1.5 이상) 잡아
// 정당한 헤비 플레이어를 깎지 않는 쪽으로 보수했다. 베타 지표로 보정한다.
import { EconomyCore } from '../game/economy-core.js';
import { HEROES } from '../data/heroes.js';
import { HERO_POLICY } from '../data/hero-roster.js';
import { normalizeRunes, normalizeBlessing } from '../game/rune-economy.js';

export const LEGACY_EPOCH = Date.UTC(2026, 6, 1);
const DAY = 86400000;
export const INVENTORY_CAP = 3000;

/** 재화별 일 최대 획득률(가정). */
export const DAILY_MAX = Object.freeze({
  gold: 3000000, gems: 5000, tickets: 40, ssrTickets: 2, sweep: 30, stones: 600, stones2: 200, stones3: 80,
  fragments: 500, protect: 10, bless: 10, transcendStones: 40, skillResets: 3, heroShards: 200, material: 500,
});
/** 일회성 원천 합(환영 우편·임무·첫 클리어·패스 무료 트랙 등, 가정). */
export const ONE_TIME = Object.freeze({
  gold: 2000000, gems: 40000, tickets: 200, ssrTickets: 10, sweep: 30, stones: 2000, stones2: 500, stones3: 200,
  fragments: 2000, protect: 20, bless: 20, transcendStones: 100, skillResets: 10, heroShards: 400, material: 2000,
});
const CURRENCIES = ['gold', 'gems', 'tickets', 'ssrTickets', 'sweep', 'stones', 'stones2', 'stones3', 'fragments', 'protect', 'bless', 'transcendStones', 'skillResets'];

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 영웅 소유 정본 정화. 클라이언트가 보낸 roster.paid·owned는 버리고 서버가 아는 값으로 만든다.
 * - paid = 서버 권한(entitled.heroes) 그대로
 * - 정책 1(5명 소유)은 서버 문서가 이미 정책 1일 때(서버 기록)만 유지한다. 클라이언트 데이터(save.created·roster 유무)로는 절대 주지 않는다:
 *   클라이언트 시각은 저장 나이를 증명하지 못해 17,900원 전원 해금을 우회하는 통로가 되기 때문이다.
 *   기존 이용자 보호용 서버 증거 경로는 V1 개방 게이트다(docs/BM_DESIGN.md 11.6).
 * - 그 밖에는 가져오기 경로 모두 정책 2 + 시작 영웅 1명(서버가 기억하는 선택 > 원본 시작 영웅 > 원본 selected > knight) + 서버 문서가 이미 가진 owned, starterChosen=true
 * @param {unknown} raw
 * @param {{ serverRoster?: any, entitledHeroes?: readonly string[] }} opts
 * @returns {{ roster: any, grandfathered: boolean }}
 */
export function trustedRoster(raw, { serverRoster, entitledHeroes }) {
  const ids = Object.keys(HEROES);
  const known = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && ids.includes(id)))];
  const paid = known(entitledHeroes);
  const rr = isRecord(raw?.roster) ? raw.roster : null;
  if (serverRoster?.policy === HERO_POLICY.LEGACY) {
    return { grandfathered: true, roster: { policy: HERO_POLICY.LEGACY, owned: ids.slice(), starter: null, starterChosen: true, paid } };
  }
  const server = isRecord(serverRoster) ? serverRoster : null;
  const pick = (v) => (typeof v === 'string' && ids.includes(v) ? v : null);
  const starter = (server?.starterChosen === true ? pick(server.starter) : null)
    ?? (rr?.starterChosen === true ? pick(rr.starter) : null) ?? pick(raw?.selected) ?? 'knight';
  // 시작 영웅을 아직 고르지 않은 서버 문서(새 계정의 기본값)의 owned는 신뢰하지 않는다(기본 영웅이 덤으로 붙는 것을 막는다).
  const owned = [...new Set([starter, ...(server?.starterChosen === true ? known(server.owned) : [])])];
  return { grandfathered: false, roster: { policy: HERO_POLICY.STARTER, owned, starter, starterChosen: true, paid } };
}

export function elapsedDays(created, now) {
  const from = Number.isSafeInteger(created) ? Math.min(now, Math.max(LEGACY_EPOCH, created)) : now;
  return { from, days: Math.max(1, Math.ceil((now - from) / DAY)) };
}

/**
 * @param {unknown} raw 로컬 세이브 원문(JSON 객체)
 * @param {{ now: number, createdAt?: number, allowance?: Record<string, number>, entitled?: { passPremium?: boolean, monthlyUntil?: number } }} opts
 *   서버 시계, 서버 계정 생성 시각(있으면 경과일의 기준이며 세이브의 created는 무시한다),
 *   allowance = 서버가 영수증 검증 뒤 지급한 유료 보상 합(필드별 상한 가산), entitled = 서버 권한 표의 유효 결제 권한(heroes = 영웅 권한),
 *   serverRoster = 서버 문서의 현재 roster(신뢰값; 정책 1은 이 값에서만 유지된다)
 * @returns {{ ok: true, state: any, report: any } | { ok: false, reason: string, report: any }}
 */
export function sanitizeLegacySave(raw, { now, createdAt, allowance = {}, entitled = {}, serverRoster }) {
  let eco;
  // 영웅 소유는 클라이언트 값(roster.paid·owned)을 믿지 않고 서버 값으로 덮어쓴 원본을 정화한다.
  const { roster, grandfathered } = trustedRoster(raw, { serverRoster, entitledHeroes: entitled.heroes });
  const input = isRecord(raw) ? { ...raw, roster } : raw;
  try { eco = EconomyCore.fromState(input, { now: () => now, rng: () => 0.5 }); }
  catch { return { ok: false, reason: 'corrupt', report: { clamped: {}, severe: false } }; }
  const fresh = EconomyCore.fromState(null, { now: () => now, rng: () => 0.5 }).s;
  const s = eco.snapshot();
  // 세이브 안의 created는 클라이언트가 고칠 수 있으므로, 서버가 아는 계정 생성 시각이 있으면 그것만 쓴다.
  const { from, days } = elapsedDays(createdAt !== undefined ? createdAt : raw?.created, now);
  const clamped = {};
  let severe = false;
  const clamp = (path, value, cap) => {
    if (!(value > cap)) return value;
    clamped[path] = { from: value, to: cap };
    if (value > cap * 100) severe = true;
    return cap;
  };
  const paid = (key) => (Number.isSafeInteger(allowance[key]) && allowance[key] > 0 ? allowance[key] : 0);
  for (const key of CURRENCIES) s[key] = clamp(key, Number(s[key]) || 0, (fresh[key] || 0) + ONE_TIME[key] + DAILY_MAX[key] * days + paid(key));
  for (const id of Object.keys(HEROES)) {
    const h = s.heroes[id];
    if (h) h.shards = clamp(`heroes.${id}.shards`, Number(h.shards) || 0, ONE_TIME.heroShards + DAILY_MAX.heroShards * days);
  }
  for (const key of Object.keys(s.expedition?.materials || {})) {
    s.expedition.materials[key] = clamp(`materials.${key}`, Number(s.expedition.materials[key]) || 0, ONE_TIME.material + DAILY_MAX.material * days);
  }
  if (s.inventory.length > INVENTORY_CAP) {
    const equipped = new Set(Object.values(s.heroes).flatMap((h) => Object.values(h.equip)).filter(Boolean));
    const keep = s.inventory.filter((x) => equipped.has(x.uid));
    for (const item of s.inventory) if (!equipped.has(item.uid) && keep.length < INVENTORY_CAP) keep.push(item);
    clamped.inventory = { from: s.inventory.length, to: keep.length };
    s.inventory = keep.sort((a, b) => a.uid - b.uid);
  }
  // 룬·전운은 서버 소유 명령이 생기기 전까지 가져오지 않는다(조작 세이브로 룬·가루·보관 각인 주입 방지). 첫 개방 선물만 남는 기본값.
  s.runes = normalizeRunes(undefined); s.blessing = normalizeBlessing(undefined);
  for (const item of s.inventory) delete item.sockets;
  // 결제 기록·기간제 권한은 세이브에서 가져오지 않는다(정본은 서버 결제 원장·권한 표, worker/v1/iap.ts).
  // 단 서버 권한이 유효하면 그 권한으로 이미 받은 기록(패스 프리미엄 수령 단계·월정액 수령일)은 지우지 않는다(중복 수령 차단).
  const droppedPaid = { purchases: s.purchases.length, spentKRW: s.spentKRW, vip: s.vip, premiumPass: !!s.pass.premium };
  const keepMonthly = Number(entitled.monthlyUntil) > now ? s.monthlyClaimed : 0;
  Object.assign(s, { purchases: [], spentKRW: 0, vip: 0, vipUntil: 0, monthlyUntil: Number(entitled.monthlyUntil) > now ? entitled.monthlyUntil : 0, monthlyClaimed: keepMonthly, firstPurchaseUsed: {} });
  const claimedPrem = entitled.passPremium && Array.isArray(s.pass.claimedPrem) ? s.pass.claimedPrem.filter((lv) => Number.isSafeInteger(lv) && lv >= 1 && lv <= 1000) : [];
  s.pass = { ...s.pass, premium: !!entitled.passPremium, claimedPrem };
  // 정화가 끝난 상태에서도 paid는 서버 권한과 같다(정규화가 어떤 값을 만들었든 마지막에 한 번 더 덮어쓴다).
  if (isRecord(s.roster)) s.roster.paid = [...roster.paid];
  s.energy = Math.min(Number(s.energy) || 0, fresh.energy + 200);
  s.energyT = now;
  s.created = from;
  return { ok: true, state: s, report: { clamped, severe, days, created: from, droppedPaid, schemaVersion: s.schemaVersion, roster: { policy: roster.policy, grandfathered } } };
}
