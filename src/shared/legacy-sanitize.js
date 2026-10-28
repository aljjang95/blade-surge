// MMO P1-G: 로컬 세이브 정화 규칙 (docs/MMO_DESIGN.md 4장 "정화(sanitize) 규칙").
// 1) 구조·ID 검증은 기존 normalizeSave(EconomyCore.fromState)를 그대로 쓴다.
// 2) 재화 상한 = 시작 재화 + 일회성 원천 + 일 최대 획득률 × 경과일. 초과분은 절삭하고 보고서에 남긴다.
// 3) 결제 관련 필드는 가져오지 않는다(결제가 없었다). 4) 상한의 100배를 넘으면 severe(감사·보상 보류).
import { GACHA_BANNERS } from '../data/gacha-banners.js';
// 수치는 "가정"이다: 일 최대 획득률은 economy-estimate의 8시간/일 연속 플레이 상한보다 넉넉히(×1.5 이상) 잡아
// 정당한 헤비 플레이어를 깎지 않는 쪽으로 보수했다. 베타 지표로 보정한다.
import { EconomyCore } from '../game/economy-core.js';
import { HEROES } from '../data/heroes.js';
import { HERO_LEGACY_IDS, HERO_POLICY, HERO_STARTER_POLICY_SINCE } from '../data/hero-roster.js';
import { normalizeRunes, normalizeBlessing } from '../game/rune-economy.js';
import { normalizeLegend } from '../game/legend-rank.js';
import { CHAPTERS } from '../data/stages.js';
import { STAGES_PER_CHAPTER } from '../data/campaign-shape.js';
import { isChapterOpen } from '../data/chapter-open.js';
import { DIFFICULTY_ORDER } from '../game/difficulty.js';
import { resolveCampaignTown } from '../data/campaign-towns.js';

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
 * 캠페인 진행 속도 상한(가정): 관문 수 = 일회성 + 일당 × 경과일. 7장 70관문을 헤비 플레이어가 사흘 안에 끝내도 깎지 않게 넉넉히 잡았다.
 * 베타 지표(실제 클리어 속도)로 보정한다.
 */
export const PROGRESS_PACE = Object.freeze({ oneTime: 20, daily: 20 });
const STAGE_KEY = /^(\d+)-(\d+)$/;
const floorOf = (key) => { const m = STAGE_KEY.exec(key); return m ? (+m[1] - 1) * STAGES_PER_CHAPTER + +m[2] : 0; };
const HELL_RANK = DIFFICULTY_ORDER.indexOf('hell');
const chapterOf = (key) => { const m = STAGE_KEY.exec(key); return m ? +m[1] : 0; };

/**
 * 진행도 정화(가져오기·그림자 스냅샷 공통). 클라이언트가 보낸 progress.unlocked·stars·endgame(peak·고통 단계)를 그대로 믿지 않는다.
 * 1) 개방 시각(CHAPTER_OPEN)이 지나지 않은 장의 기록은 버린다(서버 시계 now 기준).
 * 2) 클리어한 관문 수가 진행 속도 상한(PROGRESS_PACE × 경과일)을 넘으면 앞쪽 관문부터 상한까지만 남긴다.
 * 3) unlocked 는 저장값이 아니라 남은 별점 기록에서 다시 계산한다(마지막 클리어 관문 + 1). 별점 없는 unlocked 만 올린 조작은 잘린다.
 * 4) 서버 문서가 이미 가진 진행(서버 정산·이전 정화를 거친 값)은 깎지 않는다(바닥값).
 * 5) endgame.peak 는 남은 별점 관문만, 고통 단계 best 는 지옥으로 한 지역(10관문)을 끝낸 기록이 남을 때만 둔다.
 * @returns {Record<string, { from: number, to: number }>} 보고서용 절삭 기록
 */
export function trustedProgress(s, { now, days, serverProgress, serverEndgame }) {
  const clamped = {};
  const floors = CHAPTERS.length * STAGES_PER_CHAPTER;
  const sp = isRecord(serverProgress) ? serverProgress : {};
  const serverStars = isRecord(sp.stars) ? sp.stars : {};
  const stars = isRecord(s.progress?.stars) ? s.progress.stars : {};
  const cap = PROGRESS_PACE.oneTime + PROGRESS_PACE.daily * days;
  const before = { unlocked: Number(s.progress?.unlocked) || 1, cleared: Object.values(stars).filter((v) => v > 0).length };
  // 서버가 이미 아는 관문은 항상 남기고, 나머지는 열린 장 + 앞쪽 관문부터 속도 상한까지.
  const keep = {};
  for (const [key, v] of Object.entries(serverStars)) if (STAGE_KEY.test(key) && Number.isInteger(v) && v > 0) keep[key] = Math.min(3, v);
  const rest = Object.entries(stars).filter(([key, v]) => v > 0 && !(key in keep) && isChapterOpen(chapterOf(key), now)).sort((a, b) => floorOf(a[0]) - floorOf(b[0]));
  for (const [key, v] of rest) { if (Object.keys(keep).length >= cap) break; keep[key] = v; }
  const top = Object.keys(keep).reduce((m, key) => Math.max(m, floorOf(key)), 0);
  const unlocked = Math.max(1, Math.min(floors, top + 1), Math.min(floors, Number.isSafeInteger(sp.unlocked) ? sp.unlocked : 1));
  s.progress = { ...s.progress, stars: keep, unlocked };
  // 마을 상태는 정화된 진행에서 다시 정한다(잘린 지역의 마을이 현재 마을로 남지 않게).
  if (isRecord(s.campaignTown)) { const town = resolveCampaignTown(s.progress, s.campaignTown); s.campaignTown = { current: town.current, celebrated: town.celebrated }; }
  const after = Object.keys(keep).length;
  if (after < before.cleared) clamped['progress.stars'] = { from: before.cleared, to: after };
  if (unlocked < before.unlocked) clamped['progress.unlocked'] = { from: before.unlocked, to: unlocked };
  if (isRecord(s.endgame)) {
    const se = isRecord(serverEndgame) ? serverEndgame : {};
    const sPeak = isRecord(se.peak) ? se.peak : {};
    const peak = {};
    const clientPeak = isRecord(s.endgame.peak) ? s.endgame.peak : {};
    for (const [key, rank] of Object.entries(clientPeak)) if (key in keep) peak[key] = rank;
    for (const [key, rank] of Object.entries(sPeak)) if (Number.isInteger(rank)) peak[key] = Math.max(peak[key] ?? -1, rank);
    const keptClient = Object.keys(clientPeak).filter((key) => key in keep).length;
    if (keptClient < Object.keys(clientPeak).length) clamped['endgame.peak'] = { from: Object.keys(clientPeak).length, to: keptClient };
    // 고통 단계는 지옥으로 한 지역(10관문)을 끝낸 기록이 정화 뒤에도 남을 때만 저장값을 쓴다(difficulty.js tormentUnlockedTier 와 같은 기준).
    const hellPerChapter = {};
    for (const [key, rank] of Object.entries(peak)) if (rank >= HELL_RANK) hellPerChapter[chapterOf(key)] = (hellPerChapter[chapterOf(key)] || 0) + 1;
    const hellRegion = Object.values(hellPerChapter).some((n) => n >= STAGES_PER_CHAPTER);
    const serverBest = Number.isSafeInteger(se.torment?.best) ? se.torment.best : 0;
    const best = Number(s.endgame.torment?.best) || 0;
    const nextBest = hellRegion ? best : Math.min(best, serverBest);
    if (nextBest < best) clamped['endgame.torment.best'] = { from: best, to: nextBest };
    s.endgame = { ...s.endgame, peak, torment: { ...s.endgame.torment, best: nextBest } };
  }
  return clamped;
}

/**
 * 영웅 소유 정본 정화. 클라이언트가 보낸 roster.paid·owned는 버리고 서버가 아는 값으로 만든다.
 * - paid = 서버 권한(entitled.heroes) 그대로
 * - 정책 1(5명 소유)은 서버 기록으로만 준다: 서버 문서가 이미 정책 1이거나, 서버가 기록한 컷오버 전 증거(legacyProof,
 *   소셜 프로필 생성 시각 < HERO_STARTER_POLICY_SINCE)가 있을 때. 클라이언트 데이터(save.created·roster 유무)로는 절대 주지 않는다:
 *   클라이언트 시각은 저장 나이를 증명하지 못해 17,900원 전원 해금을 우회하는 통로가 되기 때문이다(docs/BM_DESIGN.md 11.6).
 * - legacyClaim = 원본이 정책 1을 주장(roster 없음 또는 policy 1)했지만 서버 증거가 없어 정책 2가 된 경우. 보상 대상 표시일 뿐 소유는 늘지 않는다.
 * - 그 밖에는 가져오기 경로 모두 정책 2 + 시작 영웅 1명(서버가 기억하는 선택 > 원본 시작 영웅 > 원본 selected > knight) + 서버 문서가 이미 가진 owned, starterChosen=true
 * @param {unknown} raw
 * @param {{ serverRoster?: any, entitledHeroes?: readonly string[], legacyProof?: { source: string, at: number } | null }} opts
 * @returns {{ roster: any, grandfathered: boolean, legacyClaim: boolean }}
 */
export function trustedRoster(raw, { serverRoster, entitledHeroes, legacyProof = null }) {
  const ids = Object.keys(HEROES);
  const known = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && ids.includes(id)))];
  const paid = known(entitledHeroes);
  const rr = isRecord(raw?.roster) ? raw.roster : null;
  const server = isRecord(serverRoster) ? serverRoster : null;
  const proven = server?.policy === HERO_POLICY.LEGACY
    || (isRecord(legacyProof) && Number.isSafeInteger(legacyProof.at) && legacyProof.at < HERO_STARTER_POLICY_SINCE);
  if (proven) {
    // 정책 1: 원래 다섯 영웅 + 서버 문서가 이미 기록한 소환 전용 영웅(가져오기 원본의 owned 는 믿지 않는다).
    const owned = [...new Set([...ids.filter((id) => HERO_LEGACY_IDS.includes(id)), ...known(server?.owned)])];
    return { grandfathered: true, legacyClaim: false, roster: { policy: HERO_POLICY.LEGACY, owned, starter: null, starterChosen: true, paid } };
  }
  // 시작 영웅은 소환 전용(gachaOnly)일 수 없다: 가져오기 selected 조작으로 소환 전용 SSR을 얻는 길을 막는다.
  const pick = (v) => (typeof v === 'string' && ids.includes(v) && !HEROES[v].gachaOnly ? v : null);
  const starter = (server?.starterChosen === true ? pick(server.starter) : null)
    ?? (rr?.starterChosen === true ? pick(rr.starter) : null) ?? pick(raw?.selected) ?? 'knight';
  // 시작 영웅을 아직 고르지 않은 서버 문서(새 계정의 기본값)의 owned는 신뢰하지 않는다(기본 영웅이 덤으로 붙는 것을 막는다).
  const owned = [...new Set([starter, ...(server?.starterChosen === true ? known(server.owned) : [])])];
  const legacyClaim = isRecord(raw) && (!rr || rr.policy === HERO_POLICY.LEGACY);
  return { grandfathered: false, legacyClaim, roster: { policy: HERO_POLICY.STARTER, owned, starter, starterChosen: true, paid } };
}

export function elapsedDays(created, now) {
  const from = Number.isSafeInteger(created) ? Math.min(now, Math.max(LEGACY_EPOCH, created)) : now;
  return { from, days: Math.max(1, Math.ceil((now - from) / DAY)) };
}

/**
 * @param {unknown} raw 로컬 세이브 원문(JSON 객체)
 * @param {{ now: number, createdAt?: number, allowance?: Record<string, number>, entitled?: { passPremium?: boolean, monthlyUntil?: number, heroes?: readonly string[] }, serverRoster?: any, serverGacha?: any, serverPaidGems?: number, legacyProof?: { source: string, at: number } | null, serverProgress?: any, serverEndgame?: any }} opts
 *   서버 시계, 서버 계정 생성 시각(있으면 경과일의 기준이며 세이브의 created는 무시한다),
 *   allowance = 서버가 영수증 검증 뒤 지급한 유료 보상 합(필드별 상한 가산), entitled = 서버 권한 표의 유효 결제 권한(heroes = 영웅 권한),
 *   serverRoster = 서버 문서의 현재 roster(신뢰값), legacyProof = 서버가 조회한 컷오버 전 기록({ source, at }; 클라이언트 값 금지)
 * @returns {{ ok: true, state: any, report: any } | { ok: false, reason: string, report: any }}
 */
export function sanitizeLegacySave(raw, { now, createdAt, allowance = {}, entitled = {}, serverRoster, serverGacha, serverPaidGems = 0, legacyProof = null, serverProgress, serverEndgame }) {
  let eco;
  // 영웅 소유는 클라이언트 값(roster.paid·owned)을 믿지 않고 서버 값으로 덮어쓴 원본을 정화한다.
  const { roster, grandfathered, legacyClaim } = trustedRoster(raw, { serverRoster, entitledHeroes: entitled.heroes, legacyProof });
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
  // 진행도(unlocked·별점·엔드게임)는 개방 시각·속도 상한·서버 기록으로 정화한다(조작 저장으로 지역·영웅 합류·고통 단계 건너뛰기 차단).
  Object.assign(clamped, trustedProgress(s, { now, days, serverProgress, serverEndgame }));
  for (const v of Object.values(clamped)) if (v.from > v.to * 100 && v.to > 0) severe = true;
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
  // 고통 단계 장비 파워(tp)·전설 수련도 서버 명령이 생기기 전까지 가져오지 않는다(조작 세이브로 tp 50 장비·전설 단계 주입 방지).
  for (const item of s.inventory) delete item.tp;
  s.legend = normalizeLegend(undefined);
  // 결제 기록·기간제 권한은 세이브에서 가져오지 않는다(정본은 서버 결제 원장·권한 표, worker/v1/iap.ts).
  // 단 서버 권한이 유효하면 그 권한으로 이미 받은 기록(패스 프리미엄 수령 단계·월정액 수령일)은 지우지 않는다(중복 수령 차단).
  const droppedPaid = { purchases: s.purchases.length, spentKRW: s.spentKRW, vip: s.vip, premiumPass: !!s.pass.premium };
  const keepMonthly = Number(entitled.monthlyUntil) > now ? s.monthlyClaimed : 0;
  Object.assign(s, { purchases: [], spentKRW: 0, vip: 0, vipUntil: 0, monthlyUntil: Number(entitled.monthlyUntil) > now ? entitled.monthlyUntil : 0, monthlyClaimed: keepMonthly, firstPurchaseUsed: {} });
  const claimedPrem = entitled.passPremium && Array.isArray(s.pass.claimedPrem) ? s.pass.claimedPrem.filter((lv) => Number.isSafeInteger(lv) && lv >= 1 && lv <= 1000) : [];
  s.pass = { ...s.pass, premium: !!entitled.passPremium, claimedPrem };
  // 정화가 끝난 상태에서도 paid는 서버 권한과 같다(정규화가 어떤 값을 만들었든 마지막에 한 번 더 덮어쓴다).
  if (isRecord(s.roster)) s.roster.paid = [...roster.paid];
  // 소환 상태 중 값이 곧 보상인 필드(마일리지·픽업 확정·장비 픽업 확정·초보자 사용 횟수)는 서버 문서 값으로 덮는다.
  // 없으면 0·false(초보자는 서버 기록이 없을 때만 0). 천장(pity·gearPity)은 기존처럼 정화 범위 안의 저장값을 쓴다.
  const sg = isRecord(serverGacha) ? serverGacha : {};
  const int = (v, max) => (Number.isSafeInteger(v) && v > 0 ? Math.min(v, max) : 0);
  s.gacha = { ...s.gacha, mileage: int(sg.mileage, 100000), guarantee: sg.guarantee === true, gearGuarantee: sg.gearGuarantee === true,
    beginner: int(sg.beginner, GACHA_BANNERS.beginner.limit), beginnerSsr: sg.beginnerSsr === true };
  // 유료 보석 몫은 서버가 결제 지급으로 기록한 값만(총액 이하).
  s.paidGems = Math.min(Math.max(0, Math.floor(Number(serverPaidGems) || 0)), Math.max(0, Math.floor(Number(s.gems) || 0)));
  s.energy = Math.min(Number(s.energy) || 0, fresh.energy + 200);
  s.energyT = now;
  s.created = from;
  return { ok: true, state: s, report: { clamped, severe, days, created: from, droppedPaid, schemaVersion: s.schemaVersion, roster: { policy: roster.policy, grandfathered, legacyClaim, proof: grandfathered && legacyProof ? legacyProof.source : null } } };
}
