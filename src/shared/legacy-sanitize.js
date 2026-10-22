// MMO P1-G: 로컬 세이브 정화 규칙 (docs/MMO_DESIGN.md 4장 "정화(sanitize) 규칙").
// 1) 구조·ID 검증은 기존 normalizeSave(EconomyCore.fromState)를 그대로 쓴다.
// 2) 재화 상한 = 시작 재화 + 일회성 원천 + 일 최대 획득률 × 경과일. 초과분은 절삭하고 보고서에 남긴다.
// 3) 결제 관련 필드는 가져오지 않는다(결제가 없었다). 4) 상한의 100배를 넘으면 severe(감사·보상 보류).
// 수치는 "가정"이다: 일 최대 획득률은 economy-estimate의 8시간/일 연속 플레이 상한보다 넉넉히(×1.5 이상) 잡아
// 정당한 헤비 플레이어를 깎지 않는 쪽으로 보수했다. 베타 지표로 보정한다.
import { EconomyCore } from '../game/economy-core.js';
import { HEROES } from '../data/heroes.js';

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

export function elapsedDays(created, now) {
  const from = Number.isSafeInteger(created) ? Math.min(now, Math.max(LEGACY_EPOCH, created)) : now;
  return { from, days: Math.max(1, Math.ceil((now - from) / DAY)) };
}

/**
 * @param {unknown} raw 로컬 세이브 원문(JSON 객체)
 * @param {{ now: number, createdAt?: number }} opts 서버 시계, 서버 계정 생성 시각(있으면 경과일의 기준이며 세이브의 created는 무시한다)
 * @returns {{ ok: true, state: any, report: any } | { ok: false, reason: string, report: any }}
 */
export function sanitizeLegacySave(raw, { now, createdAt }) {
  let eco;
  try { eco = EconomyCore.fromState(raw, { now: () => now, rng: () => 0.5 }); }
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
  for (const key of CURRENCIES) s[key] = clamp(key, Number(s[key]) || 0, (fresh[key] || 0) + ONE_TIME[key] + DAILY_MAX[key] * days);
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
  // 결제 기록·기간제 권한은 가져오지 않는다(현금 상품이 없었다. remove_ads_v1은 스토어 원장이 정본).
  const paid = { purchases: s.purchases.length, spentKRW: s.spentKRW, vip: s.vip, premiumPass: !!s.pass.premium };
  Object.assign(s, { purchases: [], spentKRW: 0, vip: 0, vipUntil: 0, monthlyUntil: 0, monthlyClaimed: 0, firstPurchaseUsed: {} });
  s.pass = { ...s.pass, premium: false, claimedPrem: [] };
  s.energy = Math.min(Number(s.energy) || 0, fresh.energy + 200);
  s.energyT = now;
  s.created = from;
  return { ok: true, state: s, report: { clamped, severe, days, created: from, droppedPaid: paid, schemaVersion: s.schemaVersion } };
}
