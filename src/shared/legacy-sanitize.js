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
import { normalizeGearDex, seedGearDex, setGearDex } from '../game/gear-dex.js';
import { normalizeRunes, normalizeBlessing } from '../game/rune-economy.js';
import { normalizeLegend } from '../game/legend-rank.js';
import { CHAPTERS } from '../data/stages.js';
import { progressItemLevel } from '../data/loot-tables.js';
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
  fragments: 500, protect: 10, bless: 10, transferScroll: 5, transcendStones: 40, skillResets: 3, heroShards: 200, material: 500,
});
/** 일회성 원천 합(환영 우편·임무·첫 클리어·패스 무료 트랙 등, 가정). */
export const ONE_TIME = Object.freeze({
  gold: 2000000, gems: 40000, tickets: 200, ssrTickets: 10, sweep: 30, stones: 2000, stones2: 500, stones3: 200,
  fragments: 2000, protect: 20, bless: 20, transferScroll: 5, transcendStones: 100, skillResets: 10, heroShards: 400, material: 2000,
});
const CURRENCIES = ['gold', 'gems', 'tickets', 'ssrTickets', 'sweep', 'stones', 'stones2', 'stones3', 'fragments', 'protect', 'bless', 'transferScroll', 'transcendStones', 'skillResets'];

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 캠페인 진행 속도 상한(가정): 인정하는 마지막 관문 번호 = 일회성 + 일당 × 경과일. 7장 70관문을 이틀 안에 끝낸 기록까지 깎지 않게 넉넉히 잡았다.
 * 베타 지표(실제 클리어 속도)로 보정한다.
 */
export const PROGRESS_PACE = Object.freeze({ oneTime: 40, daily: 20 });
const STAGE_KEY = /^(\d+)-(\d+)$/;
const floorOf = (key) => { const m = STAGE_KEY.exec(key); return m ? (+m[1] - 1) * STAGES_PER_CHAPTER + +m[2] : 0; };
const NIGHTMARE_RANK = DIFFICULTY_ORDER.indexOf('nightmare');
const chapterOf = (key) => { const m = STAGE_KEY.exec(key); return m ? +m[1] : 0; };

/**
 * 진행도 정화(가져오기·그림자 스냅샷 공통). 클라이언트가 보낸 progress.unlocked·stars·endgame(peak·고통 단계)를 그대로 믿지 않는다.
 * 1) 개방 시각(CHAPTER_OPEN)이 지나지 않은 장의 기록은 버린다(서버 시계 now 기준).
 * 2) 클라이언트 별점은 1번 관문부터 끊김 없이 이어진 구간만, 관문 번호가 속도 상한(PROGRESS_PACE × 경과일) 이하인 곳까지 인정한다.
 * 3) unlocked 는 저장값이 아니라 남은 별점 기록에서 다시 계산한다(마지막 클리어 관문 + 1). 별점 없는 unlocked 만 올린 조작은 잘린다.
 * 4) 서버 문서가 이미 가진 진행(서버 정산·이전 정화를 거친 값)은 깎지 않는다(바닥값).
 * 5) endgame.peak 는 남은 관문만(악몽 이상은 3별 관문만), 고통 단계 best 는 서버 문서 값까지만.
 * @returns {{ clamped: Record<string, { from: number, to: number }>, tampered: boolean }} 절삭 기록과 조작 표시(열리지 않은 장·건너뛴 관문 뒤의 기록)
 */
export function trustedProgress(s, { now, days, serverProgress, serverEndgame }) {
  const clamped = {};
  let tampered = false;
  const floors = CHAPTERS.length * STAGES_PER_CHAPTER;
  const sp = isRecord(serverProgress) ? serverProgress : {};
  const serverStars = isRecord(sp.stars) ? sp.stars : {};
  const stars = isRecord(s.progress?.stars) ? s.progress.stars : {};
  const cap = PROGRESS_PACE.oneTime + PROGRESS_PACE.daily * days;
  const before = { unlocked: Number(s.progress?.unlocked) || 1, cleared: Object.values(stars).filter((v) => v > 0).length };
  // 서버가 이미 아는 관문은 항상 남긴다(바닥값).
  const keep = {};
  for (const [key, v] of Object.entries(serverStars)) if (STAGE_KEY.test(key) && Number.isInteger(v) && v > 0) keep[key] = Math.min(3, v);
  const serverTop = Math.max(Object.keys(keep).reduce((m, key) => Math.max(m, floorOf(key)), 0), (Number.isSafeInteger(sp.unlocked) ? sp.unlocked : 1) - 1);
  // 클라이언트 관문은 1번부터 끊김 없이 이어진 구간만 인정한다(관문 N은 N-1을 깬 뒤에만 들어갈 수 있다).
  // 열리지 않은 장에서 멈추고, 그 구간의 끝은 속도 상한(관문 번호 ≤ cap)을 넘지 않는다. 서버가 아는 진행까지는 이어진 것으로 본다.
  const byFloor = new Map(Object.entries(stars).filter(([key, v]) => v > 0 && STAGE_KEY.test(key)).map(([key, v]) => [floorOf(key), [key, v]]));
  let top = serverTop;
  for (let f = 1; f <= floors; f++) {
    const hit = byFloor.get(f);
    const known = f <= serverTop;
    if (!hit) { if (known) continue; break; }
    const [key, v] = hit;
    if (!known && (!isChapterOpen(chapterOf(key), now) || f > cap)) break;
    keep[key] = Math.max(keep[key] ?? 0, v);
    top = Math.max(top, f);
  }
  // 이어진 구간 밖에 남은 별점: 열리지 않은 장의 기록이나 건너뛴 관문 뒤의 기록은 정상 플레이로 생길 수 없다(조작 표시).
  for (const [f, [key]] of byFloor) if (!(key in keep) && (!isChapterOpen(chapterOf(key), now) || (f > top + 1 && f <= cap))) tampered = true;
  const unlocked = Math.max(1, Math.min(floors, top + 1));
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
    // 남은 관문의 난이도 기록만, 악몽 이상은 그 관문이 3별일 때만(악몽은 3별 관문에서 열린다) 인정한다.
    for (const [key, rank] of Object.entries(clientPeak)) if (key in keep) peak[key] = keep[key] >= 3 ? rank : Math.min(rank, NIGHTMARE_RANK - 1);
    for (const [key, rank] of Object.entries(sPeak)) if (Number.isInteger(rank)) peak[key] = Math.max(peak[key] ?? -1, rank);
    const keptClient = Object.keys(clientPeak).filter((key) => key in keep).length;
    if (keptClient < Object.keys(clientPeak).length) clamped['endgame.peak'] = { from: Object.keys(clientPeak).length, to: keptClient };
    // 고통 단계 최고 기록은 서버 문서 값까지만 인정한다(가져오기·스냅샷으로 올릴 수 없음). 단계는 서버 정산으로만 오른다.
    const serverBest = Number.isSafeInteger(se.torment?.best) ? se.torment.best : 0;
    const best = Number(s.endgame.torment?.best) || 0;
    const nextBest = Math.min(best, serverBest);
    if (nextBest < best) clamped['endgame.torment.best'] = { from: best, to: nextBest };
    s.endgame = { ...s.endgame, peak, torment: { ...s.endgame.torment, best: nextBest } };
  }
  return { clamped, tampered };
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
 * @param {{ now: number, createdAt?: number, allowance?: Record<string, number>, entitled?: { passPremium?: boolean, monthlyUntil?: number, heroes?: readonly string[] }, serverRoster?: any, serverGacha?: any, serverPaidGems?: number, legacyProof?: { source: string, at: number } | null, serverProgress?: any, serverEndgame?: any, serverGearDex?: any, serverLineageSigil?: number, serverSigilClaims?: any, snapshot?: boolean }} opts
 *   서버 시계, 서버 계정 생성 시각(있으면 경과일의 기준이며 세이브의 created는 무시한다),
 *   allowance = 서버가 영수증 검증 뒤 지급한 유료 보상 합(필드별 상한 가산), entitled = 서버 권한 표의 유효 결제 권한(heroes = 영웅 권한),
 *   serverRoster = 서버 문서의 현재 roster(신뢰값), legacyProof = 서버가 조회한 컷오버 전 기록({ source, at }; 클라이언트 값 금지)
 * @returns {{ ok: true, state: any, report: any } | { ok: false, reason: string, report: any }}
 */
export function sanitizeLegacySave(raw, { now, createdAt, allowance = {}, entitled = {}, serverRoster, serverGacha, serverPaidGems = 0, legacyProof = null, serverProgress, serverEndgame, serverGearDex, serverLineageSigil, serverSigilClaims, snapshot = false }) {
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
  const progress = trustedProgress(s, { now, days, serverProgress, serverEndgame });
  Object.assign(clamped, progress.clamped);
  // 정상 플레이로 생길 수 없는 진행 기록(열리지 않은 장, 건너뛴 관문 뒤)은 severe(감사·보상 보류).
  if (progress.tampered) severe = true;
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
  for (const item of s.inventory) { delete item.tp; delete item.il; }   // il(스테이지 장비 레벨)도 같은 이유로 가져오지 않는다.
  // 가져온 il 대신 서버가 정화한 진행도의 장비 레벨을 모든 장비에 다시 준다(저장 정화의 il 이월과 같은 규칙). 없으면 il 이 붙은 새 필드 드랍이
  // 가져온 유니크·레전드리를 앞섰다(2026-10-29 신고). 정화된 진행도라 조작 세이브로 il 을 부풀릴 수 없다.
  { const il = progressItemLevel(s.progress); if (il > 1) for (const item of s.inventory) item.il = il; }
  s.legend = normalizeLegend(undefined);
  // 계승 문장은 가져오지 않는다(외부 저장으로 재화 주입 금지). 도감은 가져온 장비로 다시 만든 드랍 도감 + 서버 문서 값(수령 기록 포함)만 인정한다:
  // 가져온 kin·claimed 는 버린다(마일스톤 보상 주입·재수령 방지).
  // 그림자 스냅샷(snapshot)은 외부 가져오기가 아니라 같은 계정의 반복 동기화다: 문장 잔액·도감은 서버 문서 값을 그대로 유지하고(소급·삭제 없음),
  // 로컬이 보낸 값은 쓰지 않는다. 문장·도감은 서버 명령(vaultRitual·gearDexClaim·claimJourneySigil)으로만 바뀐다.
  delete s.lineageSigil; delete s.sigilClaims;
  // 클리어 카드(docs/CLEAR_LOOP.md)는 서버 정산(completeStage)만 만든다. 가져온 카드 보상은 버린다(조작 세이브로 보상 주입 방지, 보안 리뷰 P2).
  delete s.clearCard;
  if (snapshot) {
    const claims = (Array.isArray(serverSigilClaims) ? serverSigilClaims : []).filter((k) => typeof k === 'string');   // 의뢰 문장 수령 기록도 서버 값 그대로(재수령 차단)
    if (claims.length) s.sigilClaims = claims.slice(-16);
    const sigil = Number.isSafeInteger(serverLineageSigil) && serverLineageSigil > 0 ? serverLineageSigil : 0;
    if (sigil > 0) s.lineageSigil = sigil;
    // 드랍 도감만 클라이언트가 실제 드랍 때 기록한 항목(원본 gearDex.drop)을 더하되, 지금 그 영웅이 가진 장비로 뒷받침되는 것만 인정한다.
    // 소유만으로 채우는 소급(seedGearDex)은 하지 않으므로 이동·꺼내기로는 도감이 늘지 않는다. kin·claimed 는 서버 문서 값만.
    const sv = normalizeGearDex(serverGearDex), own = normalizeGearDex(raw?.gearDex)?.drop || {}, held = {};
    for (const x of s.inventory) if (x.owner) (held[x.owner] ||= new Set()).add(x.id);
    const drop = {};
    for (const h of Object.keys(HEROES)) { const l = [...new Set([...(sv?.drop?.[h] || []), ...(own[h] || []).filter((id) => held[h]?.has(id))])]; if (l.length) drop[h] = l; }
    setGearDex(s, normalizeGearDex({ drop, kin: sv?.kin, claimed: sv?.claimed }));
  } else {
    const sv = normalizeGearDex(serverGearDex), mine = seedGearDex(s), merge = (a, b) => { const o = {}; for (const h of Object.keys(HEROES)) { const l = [...new Set([...(a?.[h] || []), ...(b?.[h] || [])])]; if (l.length) o[h] = l; } return o; };
    setGearDex(s, normalizeGearDex({ drop: merge(sv?.drop, mine?.drop), kin: sv?.kin, claimed: sv?.claimed }));
  }
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
