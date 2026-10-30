// units.json 생성기 (읽기 전용 조사 도구 — 저장소 밖 스크래치에서 실행). 입력: marathon 16시드 일별 로그(days-marathon.json).
import fs from 'node:fs';
import { CHAPTERS } from '/home/user/bs-3month/src/data/stages.js';
import { EXPEDITION_DEPTHS } from '/home/user/bs-3month/src/data/expedition-depths.js';
import { EXPEDITION_CONQUESTS } from '/home/user/bs-3month/src/data/expedition-conquests.js';
import { DUNGEON_REGION } from '/home/user/bs-3month/src/data/region-dungeons.js';
import { EXPEDITION_ROUTES } from '/home/user/bs-3month/src/data/expedition-routes.js';
import { ARENA_RIVALS } from '/home/user/bs-3month/src/data/expansion.js';
import { ACHIEVEMENTS } from '/home/user/bs-3month/src/game/achievements.js';
import { poolUpToFloor } from '/home/user/bs-3month/src/game/kill-ledger.js';
import { GEAR_DEX_MILESTONES } from '/home/user/bs-3month/src/game/gear-dex.js';
import { EVENT_WEEKS, TORMENT } from '/home/user/bs-3month/src/data/content-90d.js';
import { perRun } from '/home/user/bs-3month/tools/economy-estimate.mjs';

const R = '/home/user/bs-3month/';
const S = '/tmp/claude-0/-home-user-blade-surge/fa8e9051-5a5a-564a-887a-e3ba2373c88e/scratchpad/';
const dump = JSON.parse(fs.readFileSync(S + 'work/days-marathon.json', 'utf8'));
const seeds = Object.keys(dump);
const NS = seeds.length;

// ---------- 증거 줄 번호 ----------
const cache = {};
function L(file, pat) {
  cache[file] ||= fs.readFileSync(R + file, 'utf8').split('\n');
  const i = cache[file].findIndex((l) => l.includes(pat));
  if (i < 0) throw new Error(`증거 못 찾음 ${file} ${pat}`);
  return `${file}:${i + 1}`;
}
const EV = {
  chapters: L('src/data/stages.js', 'export const CHAPTERS'),
  simStage: L('tools/sim-90d.mjs', 'const MIN_STAGE'),
  simPersona: L('tools/sim-90d.mjs', 'marathon: {'),
  tower: L('src/data/content-90d.js', 'export const TOWER'),
  torment: L('src/data/content-90d.js', 'export const TORMENT'),
  events: L('src/data/content-90d.js', 'export const EVENT_WEEKS'),
  hell: L('src/data/content-90d.js', 'export const HELL_DIFFICULTY'),
  chOpen: L('src/data/chapter-open.js', 'export const CHAPTER_OPEN'),
  join: L('src/data/hero-roster.js', 'export const HERO_CAMPAIGN_JOIN'),
  ach: L('src/game/achievements.js', 'export const ACHIEVEMENTS'),
  steps: L('src/data/journey.js', 'export const JOURNEY_STEPS'),
  daily: L('src/data/journey.js', 'export const DAILY_CONTRACTS'),
  weekly: L('src/data/journey.js', 'export const WEEKLY_CONTRACTS'),
  newbie: L('src/game/newbie-event.js', 'export const NEWBIE'),
  dex: L('src/game/gear-dex.js', 'export const GEAR_DEX_MILESTONES'),
  routes: L('src/data/expedition-routes.js', 'export const EXPEDITION_ROUTES'),
  depths: L('src/data/expedition-depths.js', 'export const EXPEDITION_DEPTHS'),
  conq: L('src/data/expedition-conquests.js', 'export const EXPEDITION_CONQUESTS'),
  arena: L('src/data/expansion.js', 'export const ARENA_RIVALS'),
  recipes: L('src/data/expansion.js', 'export const RECIPES'),
  quests: L('src/data/expansion.js', 'export const EXPEDITION_QUESTS'),
  pass: L('src/data/shop.js', 'export const BATTLE_PASS'),
  gacha: L('src/data/shop.js', 'export const GACHA'),
  legend: L('src/game/legend-rank.js', 'export const LEGEND'),
  grade: L('src/data/hero-grades.js', 'export const GRADE_UP_COST'),
  runes: L('src/data/runes.js', 'export const RUNES'),
  mastery: L('src/data/masterworks.js', 'export const MASTERY_NODES'),
  skills: L('src/data/skill-tree.js', 'export const SKILL_MAX_LV'),
  gates: L('src/data/skill-tree.js', 'export const BASIC_SKILL_GATES'),
  towns: L('src/data/campaign-towns.js', 'export const CAMPAIGN_TOWNS'),
  codex: L('src/data/lore.js', 'export const CODEX'),
  heroes: L('src/data/heroes.js', 'export const HEROES'),
  knightAwk: L('src/data/heroes.js', "id: 'chain_bind'"),
  firstSortie: L('src/ui/first-sortie.js', 'export const FIRST_SORTIE_ID'),
  banners: L('src/data/gacha-banners.js', 'export const GACHA_BANNERS'),
  rift: L('src/game/journey-rifts.js', 'export const RIFT_RULES'),
  mmo: 'docs/MMO_DESIGN.md:78',
  mmo7: L('docs/MMO_DESIGN.md', '### 7.1 구조'),
  mmoRaid: L('docs/MMO_DESIGN.md', '### 7.4 주간 레이드'),
  mmoArena: L('docs/MMO_DESIGN.md', '### 3.10 PvP'),
  mmoGuild: L('docs/MMO_DESIGN.md', '### 3.7 길드'),
  spec33: L('docs/SPEC_720H.md', '### 3.3 7~12장'),
  essentials: L('docs/RPG_ESSENTIALS.md', '### E5 우편함'),
  social: L('src/social/integration.js', '블레이드 서지 ↔ tll-social'),
  party: L('src/main.js', "import { PartySession }"),
  sssr: L('tools/sim-90d.mjs', 'const sssrDay'),
  hunt: L('docs/HUNT_GROWTH_V2.md', '| 1-1 | 1 → 5'),
  pctable: L('src/data/skill-tree.js', '입문 레벨 곡선'),
};

// ---------- 유틸 ----------
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function firstDay(seed, pred) { const d = dump[seed].days; for (let i = 0; i < d.length; i++) if (pred(d[i], i)) return d[i].day; return null; }
/** 16시드 중 과반이 도달하면 중앙값 일, 아니면 null(= 90일 안에 p50 미도달). */
function p50Day(pred) {
  const v = seeds.map((s) => firstDay(s, pred)).filter((x) => x !== null);
  if (v.length * 2 <= NS) return { day: null, reached: v.length };
  return { day: Math.ceil(median(v)), reached: v.length, min: Math.min(...v), max: Math.max(...v) };
}
const hardSum = (x) => x.hard.adept + x.hard.nightmare + x.hard.hell;
function phaseOf(day) { return day <= 1 ? 'P1' : day <= 7 ? 'P2' : day <= 30 ? 'P3' : day <= 60 ? 'P4' : 'P5'; }
const cumOfDay = (day) => Math.round((day - 0.5) * 480);

const units = [];
const ids = new Set();
function add(u) {
  if (ids.has(u.id)) throw new Error('중복 id ' + u.id);
  ids.add(u.id);
  if (u.kind === 'unique' && !(u.minutes > 0)) throw new Error('minutes<=0 ' + u.id);
  if (u.kind === 'repeatable' && !(u.capHours > 0)) throw new Error('capHours<=0 ' + u.id);
  units.push(u);
}
const r1 = (n) => Math.round(n * 10) / 10;

// ---------- 상수(보수적 사람 속도 가정; 모두 sim-90d.mjs / content-90d.js 와 같은 값) ----------
const STAGE_MIN = 3, HARD_MIN = 4, FLOOR_MIN = 3.5, RUN_MIN = TORMENT.minutesPerRun;
const SIMNOTE = 'marathon(8h/일=120분×4세션, 손기술 0.85) 16시드(0~15) p50';

// =====================================================================
// P0 — 첫 30분: 온보딩 + 1장 1~9관문
// =====================================================================
add({ id: 'onboarding-start', name: '시작: 게스트 입장·시작 영웅 확인·조작 안내', phase: 'P0', kind: 'unique', track: 'story', minutes: 2, cumMinutes: 2,
  source: 'estimate:타이틀→시작 영웅→1-1 조작 안내 화면 전환 합 약 2분(시뮬레이터는 온보딩 시간을 모델링하지 않음, 실측 없음)', status: 'live', evidence: EV.firstSortie });

const ch1 = CHAPTERS[0];
const stageTitles = {};
{ const { stageDef } = await import(R + 'src/data/stages.js'); for (let c = 1; c <= 7; c++) for (let s = 1; s <= 10; s++) stageTitles[`${c}-${s}`] = stageDef(c, s).title; }
for (let s = 1; s <= 10; s++) {
  const idx = s, cum = 2 + 3 * s;
  const mid = s === 5, boss = s === 10;
  add({ id: `story-1-${s}`, name: `${ch1.name} ${1}-${s} ${stageTitles['1-' + s]}${mid ? ' (중간 보스)' : boss ? ' (지역 보스)' : ''}`,
    phase: cum <= 30 ? 'P0' : 'P1', kind: 'unique', track: 'story', minutes: STAGE_MIN, cumMinutes: cum,
    source: `calc:1관문 × ${STAGE_MIN}분(sim MIN_STAGE; 실측 AUTO 전투 1-1 168초·1-2 144초·1-3 211초, HUNT_GROWTH_V2.md) + 온보딩 2분 누적; 1일차 스토리 우선 순서`,
    status: 'live', evidence: `${EV.simStage}, ${EV.hunt}` });
}
add({ id: 'level-5', name: '영웅 Lv.5: 세 번째 기본 스킬 해금', phase: 'P0', kind: 'unique', track: 'growth', minutes: 1, cumMinutes: 17,
  source: 'calc:관문 1-5 클리어 후 Lv.5(EARLY_LEVEL_EXP+levelExperienceMultiplier로 스토리 순서 재현, 골드 훈련 제외) — 1-5 판과 시간이 겹쳐 1분', status: 'live', evidence: EV.gates });

// =====================================================================
// 스토리 2~7장 (분할: X-1~4, X-5 중간 보스, X-6~9, X-10 지역 보스)
// =====================================================================
function storyDay(lastIdx) { return p50Day((x) => x.story >= lastIdx); }
const storyParts = [['a', 1, 4, ''], ['mid', 5, 5, ' 중간 보스'], ['b', 6, 9, ''], ['boss', 10, 10, ' 지역 보스']];
const storyDayOf = {};
for (let c = 2; c <= 7; c++) {
  const ch = CHAPTERS[c - 1];
  for (const [key, s0, s1, tag] of storyParts) {
    const lastIdx = (c - 1) * 10 + s1;
    const pd = storyDay(lastIdx);
    storyDayOf[`${c}-${s1}`] = pd.day;
    const n = s1 - s0 + 1;
    add({ id: `story-${c}-${key}`, name: `${c}장 ${ch.name} ${c}-${s0}${s1 > s0 ? '~' + s1 : ''}${tag}`, phase: phaseOf(pd.day), kind: 'unique', track: 'story',
      minutes: n * STAGE_MIN, cumMinutes: cumOfDay(pd.day), day: pd.day,
      source: `calc:${n}관문 × ${STAGE_MIN}분(sim MIN_STAGE); 도달일 sim ${SIMNOTE} 관문 ${lastIdx} 클리어 D${pd.day}(최소 D${pd.min}~최대 D${pd.max})`,
      status: c === 7 ? 'live' : 'live', evidence: `${EV.chapters}, ${c === 7 ? EV.chOpen : EV.simStage}`, ...(c === 7 ? { note: '7장은 시즌 W1(2026-10-26)부터 개방, 운영 배포 e95c29a9에 포함' } : {}) });
  }
}
// 영웅 합류(스토리 속 동료): 마라톤 시작 영웅 = 기사(sim hero knight) → 법사·도적·궁수·광전사 합류
for (const [hid, name, stageClear] of [['mage', '대마도사 리아', 20], ['rogue', '암살자 카인', 30], ['ranger', '바람추적자 실바', 40], ['barbarian', '광전사 드라칸', 60]]) {
  const pd = storyDay(stageClear);
  add({ id: `join-${hid}`, name: `동료 합류: ${name} (${stageClear / 10}-10 클리어)`, phase: phaseOf(pd.day), kind: 'unique', track: 'growth', minutes: 1, cumMinutes: cumOfDay(pd.day), day: pd.day,
    source: `calc:HERO_CAMPAIGN_JOIN=${stageClear + 1}(진행도) — ${stageClear / 10}-10 클리어 판과 겹침 1분; 도달일 sim ${SIMNOTE} D${pd.day}`, status: 'live', evidence: EV.join });
}
// 지역 마을(허브)
for (let c = 1; c <= 7; c++) {
  const pd = c === 1 ? { day: 1 } : storyDay(c * 10);
  add({ id: `town-${c}`, name: `${c}장 마을 개방(상점·의뢰·던전 허브)`, phase: c === 1 ? 'P1' : phaseOf(pd.day), kind: 'unique', track: 'story', minutes: 1, cumMinutes: c === 1 ? 40 : cumOfDay(pd.day), day: pd.day,
    source: `calc:${c}-10 클리어로 개방(regionUnlockedBy); 클리어 판과 겹쳐 1분. 도달일 sim ${SIMNOTE}`, status: 'live', evidence: EV.towns });
}

// =====================================================================
// 난이도 숙련·악몽·지옥 (장당 2분할: X-1~5, X-6~10), 순서는 마라톤 regionFirst 순
// =====================================================================
const HD = { adept: ['숙련', 0], nightmare: ['악몽', 0], hell: ['지옥', 0] };
const seqBase = (diff, c) => c === 1 ? { adept: 0, nightmare: 10, hell: 20 }[diff] : { adept: 30, nightmare: 90, hell: 150 }[diff] + (c - 2) * 10;
for (const diff of ['adept', 'nightmare', 'hell']) {
  for (let c = 1; c <= 7; c++) {
    for (const [half, s0, s1] of [['1', 1, 5], ['2', 6, 10]]) {
      const end = seqBase(diff, c) + s1;
      const pd = p50Day((x) => hardSum(x) >= end);
      const n = s1 - s0 + 1;
      add({ id: `${diff}-${c}-${half}`, name: `${HD[diff][0]} ${c}장 ${CHAPTERS[c - 1].name} ${c}-${s0}~${s1}`, phase: phaseOf(pd.day), kind: 'unique', track: 'story',
        minutes: n * HARD_MIN, cumMinutes: cumOfDay(pd.day), day: pd.day,
        source: `calc:${n}관문 × ${HARD_MIN}분(sim MIN_HARD); 도달일 sim ${SIMNOTE} 난이도 클리어 누계 ${end}회 D${pd.day}(D${pd.min}~D${pd.max}); 순서=regionFirst(1장 숙련→악몽→지옥으로 T1 해금 뒤 2~7장 난이도별)`,
        status: 'live', evidence: `${EV.hell}, tools/sim-90d.mjs:395` });
    }
  }
}

// =====================================================================
// 무한의 성 5층 단위
// =====================================================================
for (let f0 = 1; f0 <= 206; f0 += 5) {
  const f1 = f0 + 4;
  const pd = p50Day((x) => x.tower >= f1);
  if (pd.day === null) continue;
  const reg = Math.ceil(f1 / 10), boss = f1 % 10 === 0 ? ' (지역 최종 보스)' : ' (중간 보스)';
  add({ id: `tower-${String(f0).padStart(3, '0')}`, name: `무한의 성 ${f0}~${f1}층${boss}`, phase: phaseOf(pd.day), kind: 'unique', track: 'endgame', minutes: r1(5 * FLOOR_MIN), cumMinutes: cumOfDay(pd.day), day: pd.day,
    source: `calc:5층 × ${FLOOR_MIN}분(TOWER.minutesPerFloor); 도달일 sim ${SIMNOTE} 최고층 ${f1} D${pd.day}(주간 상한 capBase30+15/주에 묶임)`, status: 'live', evidence: EV.tower });
}

// =====================================================================
// 고통 단계: T1 해금(minutes 1) + T2..T25 돌파(증분 = 단계 사이 고통 판수 × 4.5분)
// =====================================================================
function cumRuns(seed) { const out = []; let c = 0; for (const x of dump[seed].days) { out.push(c); c += x.tormentRuns; } return out; }
const crs = Object.fromEntries(seeds.map((s) => [s, cumRuns(s)]));
function tierPos(seed, tier) { // 그 단계 도달 시점까지의 누적 판수(도달한 날은 절반 지점)
  const day = firstDay(seed, (x) => x.torment >= tier); if (day === null) return null;
  const d = dump[seed].days[day - 1];
  return crs[seed][day - 1] + d.tormentRuns / 2;
}
const WIN = [['P1', 0, 1], ['P2', 1, 7], ['P3', 7, 30], ['P4', 30, 60], ['P5', 60, 90]]; // [phase, 시작일(제외), 끝일(포함)]
const PORD = { P1: 0, P2: 1, P3: 2, P4: 3, P5: 4 };
const crsEnd = (s, d) => (d >= 90 ? crs[s][89] + dump[s].days[89].tormentRuns : crs[s][d]); // d일 끝까지의 누적 고통 판
const tormentTotals = {}; for (const [w, d0, d1] of WIN) tormentTotals[w] = mean(seeds.map((s) => crsEnd(s, d1) - crsEnd(s, d0))) * RUN_MIN;
function posOf(s, t) { return t <= 1 ? 0 : tierPos(s, t); }
const tiers = [];
for (let t = 1; t <= 50; t++) {
  const pd = p50Day((x) => x.torment >= t);
  if (pd.day === null) break;
  const part = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 };
  if (t >= 2) {
    let n = 0;
    for (const s of seeds) {
      const a = posOf(s, t - 1), b = posOf(s, t); if (a === null || b === null) continue; n++;
      for (const [w, d0, d1] of WIN) { const lo = crsEnd(s, d0), hi = crsEnd(s, d1); part[w] += Math.max(0, Math.min(b, hi) - Math.max(a, lo)) * RUN_MIN; }
    }
    for (const w of Object.keys(part)) part[w] /= n;
  }
  tiers.push({ t, pd, part });
}
const lead = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 }; // 돌파 단계가 완료된 구간과 다른 구간에서 쓴 벽 앞 파밍 시간
for (const { t, pd, part } of tiers) {
  if (t === 1) {
    add({ id: 'torment-01', name: '고통 T1 해금: 한 지역 지옥 10관문 클리어 → 에너지 0 난이도', phase: phaseOf(pd.day), kind: 'unique', track: 'endgame', minutes: 1, cumMinutes: cumOfDay(pd.day), day: pd.day,
      source: `calc:지옥 1장 클리어 판과 겹침 1분; 도달일 sim ${SIMNOTE} D${pd.day}`, status: 'live', evidence: EV.torment });
    continue;
  }
  const own = phaseOf(pd.day); let m = 0, carry = 0;
  for (const w of Object.keys(part)) { if (w === own) m += part[w]; else { lead[w] += part[w]; carry += part[w]; } }
  add({ id: `torment-${String(t).padStart(2, '0')}`, name: `고통 T${t} 돌파${t === 10 ? ' (고대 장비 접두 해금)' : t === 25 ? ' (태고 장비 접두 해금)' : ''}`, phase: own, kind: 'unique', track: 'endgame', minutes: Math.max(1, Math.round(m)), cumMinutes: cumOfDay(pd.day), day: pd.day,
    source: `sim:${SIMNOTE} 고통 T${t - 1}→T${t} 사이 고통 판 × ${RUN_MIN}분(TORMENT.minutesPerRun) = 총 ${Math.round(m + carry)}분 중 이 단위의 구간(${own}) 몫 ${Math.round(m)}분${carry > 0.5 ? ` (다른 구간에 걸친 ${Math.round(carry)}분은 그 구간의 rep-torment-lead 로 분리)` : ''}. 전투력 벽 사이 반복 파밍 시간을 포함한 증분`, status: 'live', evidence: `${EV.torment}, ${EV.simPersona}`,
    note: '증분의 대부분은 같은 관문 반복(전투력 벽 파밍). 전설 수련 EXP·장비 tp 성장이 같은 판에서 동시에 오르므로 전설·장비 단위는 minutes:1' });
}
for (const [w, v] of Object.entries(lead)) if (v >= 6) add({ id: `rep-torment-lead-${w.toLowerCase()}`, name: `고통 단계 벽 앞 파밍(다음 단계 돌파 전 전투력 대기) — ${w}`, phase: w, kind: 'repeatable', track: 'endgame', capHours: r1(v / 60), cumMinutes: cumOfDay(Math.round((WIN.find((x) => x[0] === w)[1] + WIN.find((x) => x[0] === w)[2]) / 2) || 1),
  source: `sim:${SIMNOTE} 구간 경계(${w})를 넘어 이어진 고통 T 돌파 증분의 앞 구간 몫 ${Math.round(v)}분`, status: 'live', evidence: EV.torment, note: '고통 T 돌파 증분이 구간 경계를 넘어가 그 구간 몫을 따로 센 분량(이중 계산 방지)' });

{ // T25 이후: p50 미돌파 구간(T26 도전) — 남은 고통 판 시간도 빠짐없이 센다
  const lastT = tiers[tiers.length - 1].t;
  const tail = seeds.map((s) => { const a = tierPos(s, lastT); if (a === null) return null; return crsEnd(s, 90) - a; }).filter((x) => x !== null);
  add({ id: `torment-${lastT + 1}-chase`, name: `고통 T${lastT + 1}~ 도전 구간(90일 안 p50 미돌파: T${lastT + 1}~는 과반 시드가 90일 안에 못 넘김)`, phase: 'P5', kind: 'unique', track: 'endgame', minutes: Math.round(mean(tail) * RUN_MIN), cumMinutes: cumOfDay(88), day: 88,
    source: `sim:${SIMNOTE} T${lastT} 이후 D90까지 남은 고통 판 평균 ${r1(mean(tail))}판 × ${RUN_MIN}분`, status: 'live', evidence: EV.torment, note: '목표(T26)를 90일 안에 못 넘기는 시드가 과반이라 완료 단위가 아니라 진행 중 구간' });
}

// =====================================================================
// 전설 수련 단계(경험치 → 점수, 키스톤은 5·10·15·20 단계): minutes 1 (고통 판과 시간 겹침)
// =====================================================================
const legendMarks = [];
for (let r = 5; r <= 100; r += 5) legendMarks.push(r);
for (let r = 125; r <= 350; r += 25) legendMarks.push(r);
{
  const pd = p50Day((x) => x.level >= 80);
  add({ id: 'level-80', name: '영웅 Lv.80 만렙 → 이후 EXP가 전설 수련으로 흐름', phase: phaseOf(pd.day), kind: 'unique', track: 'endgame', minutes: 1, cumMinutes: cumOfDay(pd.day), day: pd.day,
    source: `sim:${SIMNOTE} 영웅 레벨 80 D${pd.day}(D${pd.min}~D${pd.max}); 같은 판과 겹침 1분`, status: 'live', evidence: 'src/game/rpg-core.js:3, docs/ENDGAME.md:9' });
}
for (const r of legendMarks) {
  const pd = p50Day((x) => x.legendRank >= r);
  if (pd.day === null) continue;
  const kst = r <= 20 ? ` (키스톤 ${['칼날', '철벽', '폭풍', '약탈'][(r / 5 - 1) % 4]} 개방)` : r === 100 ? ' (키스톤 20개 모두 개방)' : '';
  add({ id: `legend-${String(r).padStart(3, '0')}`, name: `전설 수련 ${r}단계${kst}`, phase: phaseOf(pd.day), kind: 'unique', track: 'endgame', minutes: 1, cumMinutes: cumOfDay(pd.day), day: pd.day,
    source: `sim:${SIMNOTE} 전설 단계 ${r} D${pd.day}(D${pd.min}~D${pd.max}); 고통 판 EXP로 오르므로 시간 중복 → 1분`, status: 'live', evidence: EV.legend });
}

// =====================================================================
// 영웅 성장: 스킬 해금(Lv), 별, 초월, 룬, 강화, 장비 접두
// =====================================================================
const lvl = (L) => p50Day((x) => x.level >= L);
const earlyStage = { 8: 10, 10: 12, 20: 19, 30: 27 }; // 스토리 재현(q10): Lv→해당 레벨에 닿는 관문 번호(골드 훈련 제외)
for (const [L, label, ev] of [[8, '영웅 Lv.8: 궁극기 해금', EV.gates], [10, '기사 Lv.10: 각성 스킬 1 「성쇄·결박」', EV.knightAwk], [20, '기사 Lv.20: 각성 스킬 2 「천상의 성역」', EV.knightAwk], [30, '기사 Lv.30: 각성 스킬 3 「성검·태양파쇄」', EV.knightAwk], [50, '기사 Lv.50: 각성 스킬 4 「천상·신벌강림」', EV.knightAwk], [60, '영웅 Lv.60: 엔드게임 허브 안내 개방', 'src/game/endgame-hub.js:15'], [70, '영웅 Lv.70', 'src/data/heroes.js:63']]) {
  const pd = lvl(L);
  const stage = earlyStage[L];
  const phase = stage ? (2 + 3 * stage <= 30 ? 'P0' : 'P1') : phaseOf(pd.day);
  add({ id: `level-${L}`, name: label, phase, kind: 'unique', track: 'growth', minutes: 1, cumMinutes: stage ? 2 + 3 * stage : cumOfDay(pd.day), day: stage ? 1 : pd.day,
    source: stage ? `calc:스토리 순서로 EXP 재현(q10) ${stage}관문 도달 시 Lv.${L}; 같은 판과 겹침 1분` : `sim:${SIMNOTE} 영웅 레벨 ${L} D${pd.day}(D${pd.min}~D${pd.max}); 같은 판과 겹침 1분`, status: 'live', evidence: ev });
}
for (const [star, d] of [[2, 2], [3, 4], [4, 8], [5, 14]]) {
  const pm = seeds.map((s) => dump[s].milestones.find((m) => m.label === `별 ${star}`)?.day).filter(Boolean);
  const day = Math.ceil(median(pm));
  add({ id: `hero-star-${star}`, name: `주력 영웅 별 ${star}단계`, phase: phaseOf(day), kind: 'unique', track: 'growth', minutes: 1, cumMinutes: cumOfDay(day), day,
    source: `sim:${SIMNOTE} 영웅 조각으로 별 ${star} (마일스톤 'star') D${day}; 사냥 중 조각 획득 → 1분`, status: 'live', evidence: 'src/data/heroes.js:218 (starShards 20/40/80/160)' });
}
{
  const sd = Math.ceil(median(seeds.map((s) => dump[s].sssrDay)));
  add({ id: 'hero-sssr', name: '주력 영웅 SSSR 초월 (조각 220 · 초월석 30 · 골드 150만)', phase: phaseOf(sd), kind: 'unique', track: 'growth', minutes: 1, cumMinutes: cumOfDay(sd), day: sd,
    source: `sim:${SIMNOTE} 무과금 SSSR일 D${sd}(ECONOMY_PACE 30분 기준 일수를 플레이 분량으로 환산); 사냥 중 재료 획득 → 1분`, status: 'live', evidence: `${EV.grade}, ${EV.sssr}` });
}
const runeIII = [[1, 'III 룬 첫 정밀 제작'], [4, 'III 룬 4개(소켓 효과 확장)'], [10, 'III 룬 10개'], [18, 'III 룬 18개(우선 룬 계열 완성)']];
for (const [n, label] of runeIII) {
  const pd = p50Day((x) => x.runes[2] >= n);
  if (pd.day === null) continue;
  add({ id: `rune-iii-${n}`, name: `룬 합성: ${label}`, phase: phaseOf(pd.day), kind: 'unique', track: 'gear', minutes: 1, cumMinutes: cumOfDay(pd.day), day: pd.day,
    source: `sim:${SIMNOTE} runes[III] ≥ ${n} D${pd.day}(D${pd.min}~D${pd.max}); 드랍·가루로 사냥 중 진행 → 1분`, status: 'live', evidence: EV.runes });
}
const enhMin = (x) => Math.min(...x.enh.split(' ').map((t) => Number(t.split('+')[1])));
for (const e of [10, 12, 14, 15]) {
  const pd = p50Day((x) => enhMin(x) >= e);
  add({ id: `enhance-all-${e}`, name: `장비 4부위 모두 +${e} 강화`, phase: phaseOf(pd.day), kind: 'unique', track: 'gear', minutes: 1, cumMinutes: cumOfDay(pd.day), day: pd.day,
    source: `sim:${SIMNOTE} 4부위 최소 강화 ≥ +${e} D${pd.day}(D${pd.min}~D${pd.max}); 강화는 사냥 골드로 → 1분`, status: 'live', evidence: 'src/data/items.js:167 (ENH_MAX 20)' });
}
{
  const pd10 = p50Day((x) => x.torment >= 10), pd25 = p50Day((x) => x.torment >= 25);
  add({ id: 'gear-ancient', name: '고대 장비 접두(고통 T10+ 드랍, 파워 ×(1+0.265×단계))', phase: phaseOf(pd10.day), kind: 'unique', track: 'gear', minutes: 1, cumMinutes: cumOfDay(pd10.day), day: pd10.day,
    source: `sim:${SIMNOTE} T10 도달 D${pd10.day}; 고통 판과 겹침 1분`, status: 'live', evidence: 'src/data/item-tier.js:8, docs/ENDGAME.md:13' });
  add({ id: 'gear-primal', name: '태고 장비 접두(고통 T25+ 드랍)', phase: phaseOf(pd25.day), kind: 'unique', track: 'gear', minutes: 1, cumMinutes: cumOfDay(pd25.day), day: pd25.day,
    source: `sim:${SIMNOTE} T25 도달 D${pd25.day}(14/16시드); 고통 판과 겹침 1분`, status: 'live', evidence: 'src/data/item-tier.js:8, docs/ENDGAME.md:13' });
}

// ---------- 다른 영웅 육성(시간은 고통 판과 겹침 — 같은 판 EXP로 키움) ----------
const others = [['mage', '대마도사 리아'], ['rogue', '암살자 카인'], ['ranger', '바람추적자 실바'], ['barbarian', '광전사 드라칸']];
others.forEach(([hid, name], i) => {
  const d50 = 17 + i * 10, d80 = 22 + i * 10;
  for (const [L, d, label] of [[50, d50, `Lv.50 (각성 스킬 4종 모두 해금)`], [80, d80, 'Lv.80 만렙(전설 수련 계정 공통 누적)']]) {
    add({ id: `hero-${hid}-lv${L}`, name: `${name} ${label}`, phase: phaseOf(d), kind: 'unique', track: 'growth', minutes: 1, cumMinutes: cumOfDay(d), day: d,
      source: `estimate:기사 Lv.80(D12) 뒤 영웅 1명당 약 10일씩 순차 육성 가정(기사는 캠페인 포함 12일, 전체 EXP ${(265147788 / 1e6).toFixed(0)}M ÷ 고통 T1 판 EXP 18.4만 ≈ 1,440판 ≈ 108시간). 시간은 고통 판과 같은 판이라 겹침 1분`, status: 'live', evidence: `${EV.heroes}, ${EV.join}`,
      note: '다른 영웅 육성 소요는 시뮬레이터 미모델(기사 단일). 장비 이전·고통 단계 클리어 가능 여부는 미검증' });
  }
});
for (const [hid, name, d] of [['werewolf', '늑대인간 족장', 35], ['blackcat', '검은 고양이 사냥꾼', 60]]) {
  add({ id: `hero-${hid}-summon`, name: `${name} 소환 영입(소환 전용 SSR, 천장 80)`, phase: phaseOf(d), kind: 'unique', track: 'collection', minutes: 1, cumMinutes: cumOfDay(d), day: d,
    source: 'estimate:소환 300보석/회, 천장 80회(24,000보석) 대비 마라톤 보석 수입 미모델(시뮬레이터가 소환을 제외) — 영입 시점 임의 배치', status: 'live', evidence: `${EV.gacha}, ${EV.banners}`, note: '무과금 도달일 미검증. 소환 전용 영웅 2명 + 14일 픽업 로테이션(werewolf·blackcat·knight·barbarian)' });
}

// =====================================================================
// 원정(던전·심층·정복·아레나) — 시뮬레이터 밖. 시간은 MMO_DESIGN 7.x '솔로 3~6분' 하한 3분(표준), 심층 5분
// =====================================================================
const DUNGEON_MIN = 3, DEEP_MIN = 5, CONQ_MIN = 5, ARENA_MIN = 3;
const routeById = Object.fromEntries(EXPEDITION_ROUTES.map((r) => [r.id, r]));
for (const r of EXPEDITION_ROUTES) {
  const ch = DUNGEON_REGION[r.id] || 1;
  const open = ch === 1 ? 1 : storyDay((ch - 1) * 10).day;
  const day = r.id === 'glass_garden' ? 1 : Math.max(open + 1, 2); // 1일차 에너지는 캠페인이 다 씀(시뮬레이터 starved 근거) → 다음 날부터
  add({ id: `route-${r.id}`, name: `원정 ${r.name} 첫 클리어 (${ch}장 지역·에너지 ${r.energy}·탐험 Lv.${r.minLevel})`, phase: phaseOf(day), kind: 'unique', track: 'expedition', minutes: DUNGEON_MIN, cumMinutes: cumOfDay(day), day,
    source: `estimate:솔로 던전 3~6분(MMO_DESIGN 2.2 세션 설명)의 하한 ${DUNGEON_MIN}분. 개방일 = ${ch}장 지역 마을 개방 직전 장 클리어일(sim ${SIMNOTE}), 탐험 레벨(minLevel ${r.minLevel}) 충족은 가정`, status: 'live', evidence: `${EV.routes}, src/data/region-dungeons.js:6` });
}
for (const d of EXPEDITION_DEPTHS) {
  const code = d.unlockCode; const c = Number(code.split('-')[0]);
  const day = storyDay(c * 10).day + 1; // 기본 원정 선행 + 캠페인 X-10 별 1
  add({ id: `deep-${d.id}`, name: `심층 원정 ${routeById[d.id]?.name || d.id} (${code} 클리어·기본 원정 선행·에너지 ${d.energy})`, phase: phaseOf(day), kind: 'unique', track: 'expedition', minutes: DEEP_MIN, cumMinutes: cumOfDay(day), day,
    source: `estimate:심층은 표준(3분)에 장치·증원 목표(제단/밸브/왕좌 등) 수행이 더해져 5분 가정 — 실측 없음. 개방 ${code} 클리어일+1일`, status: 'live', evidence: EV.depths });
}
for (const c of EXPEDITION_CONQUESTS) {
  const dep = EXPEDITION_DEPTHS.find((d) => d.id === c.dungeonId);
  const cc = Number(dep.unlockCode.split('-')[0]);
  const day = storyDay(cc * 10).day + 2;
  add({ id: `conquest-${c.id}`, name: `전술 공략 「${c.name}」 (${routeById[c.dungeonId]?.name} 심층)`, phase: phaseOf(day), kind: 'unique', track: 'expedition', minutes: CONQ_MIN, cumMinutes: cumOfDay(day), day,
    source: `estimate:심층 재도전으로 목표(${c.kind}) 달성 5분 가정, 실측 없음. 개방 심층 클리어 +1일`, status: 'live', evidence: EV.conq });
}
ARENA_RIVALS.forEach((a, i) => {
  const day = Math.max(1, Math.ceil((i + 1) / 3));
  add({ id: `arena-${a.id}`, name: `AI 결투장 ${a.rank}단계 「${a.name}」 승리 (에너지 0)`, phase: phaseOf(day), kind: 'unique', track: 'expedition', minutes: ARENA_MIN, cumMinutes: cumOfDay(day), day,
    source: 'estimate:보스형 1대1 결투 약 3분, 실측 없음. 난이도 순서대로 하루 2~3명 가정', status: 'live', evidence: EV.arena });
});
// 공방 제작(재료는 던전 클리어당 3개)
for (const [id, name, mats, items] of [['glasswarden', '유리 파수꾼 세트 4종(유리잎 9×4)', 36, 4], ['emberknight', '잿불 기사 세트 4종(불씨핵 9×4)', 36, 4], ['starreader', '별독자 세트 4종(별가루 9×4)', 36, 4], ['storm_blade', '뇌명검(유리잎 9)', 9, 1], ['phoenix_blade', '불사조의 검(불씨핵 12)', 12, 1], ['frost_blade', '한설검(별가루 12)', 12, 1]]) {
  const m = Math.ceil(mats / 3) * DUNGEON_MIN;
  const day = ['glasswarden', 'storm_blade'].includes(id) ? 2 : ['emberknight', 'phoenix_blade'].includes(id) ? 3 : 4;
  add({ id: `craft-${id}`, name: `공방 제작: ${name}`, phase: phaseOf(day), kind: 'unique', track: 'gear', minutes: m, cumMinutes: cumOfDay(day), day,
    source: `calc:재료 ${mats}개 ÷ 던전 클리어당 3개(rewards.materials) × ${DUNGEON_MIN}분; 개방일은 estimate(재료 던전 개방 뒤)`, status: 'live', evidence: EV.recipes });
}
add({ id: 'expedition-quests-11', name: '탐험 퀘스트 11종 완료(서약·정원 3회·결투 5회·던전 10회 등)', phase: 'P2', kind: 'unique', track: 'expedition', minutes: 1, cumMinutes: cumOfDay(3), day: 3,
  source: 'calc:각 퀘스트 조건이 위 원정·결투 단위와 겹쳐 1분', status: 'live', evidence: EV.quests });
add({ id: 'expedition-level-20', name: '탐험 레벨 20 (원정 XP 누적 약 2.6만, 레벨당 골드 150)', phase: 'P2', kind: 'unique', track: 'expedition', minutes: 1, cumMinutes: cumOfDay(4), day: 4,
  source: 'estimate:accountLevelXp 합산(L20 ≈ 25,650XP) ÷ 원정 첫 클리어 XP 합(표준 3.1k+심층 8.5k) — 위 원정 단위와 겹침', status: 'live', evidence: 'src/data/expansion.js:260, src/game/expedition-economy.js:152' });
add({ id: 'expedition-level-50', name: '탐험 레벨 50 만렙 (누적 XP 95,550)', phase: 'P3', kind: 'unique', track: 'expedition', minutes: 1, cumMinutes: cumOfDay(14), day: 14,
  source: 'estimate:심층 반복(회당 XP 600~880, 에너지 6~8)으로 약 110판이면 도달하나 시뮬레이터가 에너지·시간을 캠페인·고통에 쓰므로 시점은 임의', status: 'live', evidence: 'src/data/expansion.js:260, src/game/expedition-economy.js:152' });

// =====================================================================
// 온보딩 1일차: 여정 6단계, 신규 7일, 시즌 패스, 출석
// =====================================================================
const stepDefs = [['oath', '모험가의 첫 서약(탐험 퀘스트 보상 수령)', 1], ['garden', '첫 정원 정화(유리 정원 실전 1회)', 4], ['craft', '내 손으로 만든 준비(공방 제작 1회)', 2], ['equip', '몸을 지킬 장비(갑옷 장착)', 1], ['enhance', '한 단계 더 단단하게(장비 +1 강화)', 1], ['mastery', '남겨진 경험(명성으로 영구 숙련 습득)', 3]];
for (const [id, name, min] of stepDefs) {
  add({ id: `journey-${id}`, name: `성장 여정: ${name}`, phase: 'P1', kind: 'unique', track: 'growth', minutes: min, cumMinutes: 60, day: 1,
    source: `estimate:안내 화면 이동·1회 수행 ${min}분 가정(정원 정화는 던전 ${DUNGEON_MIN}분 + 이동). 실측 없음`, status: 'live', evidence: EV.steps });
}
for (let d = 1; d <= 7; d++) {
  add({ id: `newbie-day-${d}`, name: `신규 7일 여정 ${d}일차 (미션 3개)${d === 7 ? ' + 완주 상자(SSR 확정권 1·보석 300)' : ''}`, phase: d === 1 ? 'P1' : 'P2', kind: 'unique', track: 'liveops', minutes: 1, cumMinutes: cumOfDay(d), day: d,
    source: 'calc:미션 진척은 관문·처치·강화·레벨·소환 저장 값에서 읽음(진행 중 자동) → 1분. 기간 14일(openDays)', status: 'live', evidence: EV.newbie });
}
add({ id: 'battle-pass-30', name: '시즌 패스 30단계 완주(레벨당 100XP, 판당 60~120XP)', phase: 'P1', kind: 'unique', track: 'liveops', minutes: 1, cumMinutes: 150, day: 1,
  source: 'calc:RPG_ESSENTIALS E5 기록 — 판당 60~120XP로 첫날 30~50판이면 3,000XP 완주 → 사냥 중 자동, 1분(약한 장기 목표)', status: 'live', evidence: `${EV.pass}, ${EV.essentials}` });

// =====================================================================
// 업적(52단계 → 라인별 2단계 묶음), 도감
// =====================================================================
const killsPerRun = Math.round(229);
const dayKills = (() => { // 마라톤 p50 누적 처치 수(추정): 관문/난이도/고통/성 판수 × 판당 229 + 반복 파밍
  const out = [];
  for (let day = 1; day <= 90; day++) {
    const per = seeds.map((s) => { const d = dump[s].days; let tot = 0; for (let i = 0; i < day; i++) { const x = d[i], p = d[i - 1]; const storyD = x.story - (p ? p.story : 0), hardD = hardSum(x) - (p ? hardSum(p) : 0), towD = x.tower - (p ? p.tower : 0); const farmMin = Math.max(0, x.usedMin - storyD * 3 - hardD * 4 - towD * 3.5 - x.tormentRuns * 4.5); tot += (storyD + hardD + towD + x.tormentRuns + farmMin / 4) * killsPerRun; } return tot; });
    out.push(median(per));
  }
  return out;
})();
const dayOfKills = (n) => { const i = dayKills.findIndex((v) => v >= n); return i < 0 ? null : i + 1; };
const species = poolUpToFloor(70).size;
function achDay(line, target) {
  switch (line.stat) {
    case 'kills': return { day: dayOfKills(target), src: `sim 판수 × 판당 처치 ${killsPerRun}(economy-estimate perRun 70관문: 일반 222+정예 6+보스 1) 누적 추정` };
    case 'cleared': return { day: p50Day((x) => x.story >= target).day, src: `sim ${SIMNOTE} 캠페인 ${target}관문 클리어` };
    case 'level': return { day: p50Day((x) => x.level >= target).day ?? p50Day((x) => x.level >= target).day, src: `sim ${SIMNOTE} 영웅 Lv.${target}` };
    case 'tower': return { day: p50Day((x) => x.tower >= target).day, src: `sim ${SIMNOTE} 무한의 성 ${target}층` };
    case 'attend': return { day: target <= 90 ? target : null, src: `calc:하루 1회 접속 = 출석 ${target}일차` };
    case 'enhance': return { day: null, src: 'estimate' };
    case 'pulls': return { day: null, src: 'estimate' };
    case 'heroes': return { day: null, src: 'estimate' };
    case 'steps': return { day: 1, src: 'calc:성장 여정 6단계는 1일차' };
    case 'species': return { day: null, src: 'estimate' };
    default: return { day: null, src: 'estimate' };
  }
}
// 강화 횟수: 누적 골드 수입 비례로 분배(estimate) — 마라톤 강화 총 시도 수
const totalTries = Math.round(mean(seeds.map((s) => dump[s].totals.enhanceTries)));
const goldCum = (() => { const out = []; const per = seeds.map((s) => { let c = 0; return dump[s].days.map((x) => (c += x.goldEarned)); }); for (let i = 0; i < 90; i++) out.push(median(per.map((p) => p[i]))); return out; })();
const dayOfTries = (n) => { const tot = goldCum[89]; const i = goldCum.findIndex((g) => (g / tot) * totalTries >= n); return i < 0 ? null : i + 1; };
const speciesDay = (n) => { // 종 풀 크기(관문별)로 도감 종 수: 관문 클리어 순서 → 종 수
  for (let f = 1; f <= 70; f++) if (poolUpToFloor(f).size >= n) return { floor: f, day: storyDay(f).day };
  return { floor: null, day: null };
};
const heroOwned = [[2, 1, 'join-mage'], [4, 2, 'join-ranger']];
function tierInfo(line, last) {
  let day, srcTxt;
  if (line.stat === 'enhance') { day = dayOfTries(last.target); srcTxt = `estimate:강화 누적 시도 ${last.target}회 — 마라톤 90일 총 시도 ${totalTries}회를 누적 골드 수입 비례로 배분`; }
  else if (line.stat === 'pulls') { day = last.target <= 50 ? 3 : last.target <= 150 ? 20 : last.target <= 400 ? 55 : null; srcTxt = `estimate:소환 ${last.target}회(300보석/회 = ${last.target * 300}보석) — 시뮬레이터는 소환을 모델링하지 않음, 도달일 임의`; }
  else if (line.stat === 'heroes') { day = last.target <= 2 ? 1 : last.target <= 4 ? 2 : last.target <= 6 ? 35 : null; srcTxt = `estimate:동료 ${last.target}명 — 시작 1 + 합류 4 = 5명(D1~D2), 6명째부터 소환 전용 SSR(전체 7명이라 9·12명 단계는 구조상 도달 불가)`; }
  else if (line.stat === 'species') { const sd = speciesDay(last.target); day = sd.day; srcTxt = `calc:도감 ${last.target}종 — 종 풀(poolUpToFloor) ${last.target}종이 열리는 관문 ${sd.floor}를 클리어하는 날, sim ${SIMNOTE}. 전체 풀 ${species}종`; }
  else { const a = achDay(line, last.target); day = a.day; srcTxt = line.stat === 'kills' ? `calc:${a.src}` : a.src.startsWith('calc:') ? a.src : `sim:${a.src}`; }
  return { day, srcTxt };
}
for (const line of ACHIEVEMENTS) {
  const tiers = line.tiers;
  for (let i = 0; i < tiers.length; i += 2) {
    const grp = tiers.slice(i, i + 2);
    const infos = grp.map((g) => ({ g, ...tierInfo(line, g) })).filter((x) => x.day !== null && x.day !== undefined && x.day <= 90);
    if (!infos.length) continue; // 90일 안에 닿지 않거나 구조상 도달 불가
    const last = infos[infos.length - 1];
    const skipped = grp.length - infos.length;
    add({ id: `ach-${line.id}-${i / 2 + 1}`, name: `업적 「${line.name}」 ${i + 1}${infos.length > 1 ? '~' + (i + infos.length) : ''}단계 (목표 ${infos.map((x) => x.g.target).join('·')})`, phase: phaseOf(last.day), kind: 'unique', track: 'collection', minutes: 1, cumMinutes: cumOfDay(last.day), day: last.day,
      source: last.srcTxt, status: 'live', evidence: EV.ach, note: '평생 누적 목표라 다른 활동과 시간이 겹침(1분)' + (skipped ? ` — 같은 묶음의 ${skipped}단계(목표 ${grp.slice(infos.length).map((x) => x.target).join('·')})는 90일 안에 도달하지 못해 제외` : '') });
  }
}
// 도감(장비·로어)
for (const m of GEAR_DEX_MILESTONES) {
  const day = { drop25: 1, drop50: 3, drop75: 12, drop100: 40, kin5: 6, kin15: 18, kin30: 45 }[m.id];
  add({ id: `dex-knight-${m.id}`, name: `장비 도감(기사): ${m.kind === 'drop' ? '드랍 ' + m.need + '%' : '계승 ' + m.need + '종'}${m.title ? ' · 칭호 「' + m.title + '」' : ''}`, phase: phaseOf(day), kind: 'unique', track: 'collection', minutes: 1, cumMinutes: cumOfDay(day), day,
    source: 'estimate:장비 드랍·계승 수집률은 시뮬레이터가 종류별로 추적하지 않음 — 드랍 판수와 겹침, 도달일 임의 배치(영웅 1명 기준, 영웅 7명 각각 별도 수령 가능)', status: 'live', evidence: EV.dex });
}
add({ id: 'dex-other-heroes', name: '장비 도감: 다른 영웅 6명의 마일스톤 7개씩(총 42개 수령)', phase: 'P4', kind: 'unique', track: 'collection', minutes: 1, cumMinutes: cumOfDay(45), day: 45,
  source: 'estimate:영웅별 수령(gearDex.claimed[heroId]) — 영웅 육성 단위와 겹침, 시점 임의', status: 'live', evidence: EV.dex });
add({ id: 'codex-monsters', name: '몬스터·보스·지역 도감 열람(135항목: 지역 7·보스 14·몬스터 106·영웅 8)', phase: 'P3', kind: 'unique', track: 'collection', minutes: 1, cumMinutes: cumOfDay(10), day: 10,
  source: `calc:도감 항목은 처치·클리어로 열림(스토리 3일 이내 대부분) — 사냥과 겹침; 처치 종 풀 ${species}종`, status: 'live', evidence: EV.codex });
add({ id: 'masterworks-mastery', name: '영구 숙련 노드 9개(명성 6·10·16, 공격·생존·통찰 3갈래)', phase: 'P2', kind: 'unique', track: 'growth', minutes: 6, cumMinutes: cumOfDay(5), day: 5,
  source: 'estimate:명성 합계 96(6+10+16 ×3갈래). 원정 완료 명성이 판당 소량이라 약 6분치 원정 추가 — 실측 없음', status: 'live', evidence: EV.mastery });

// =====================================================================
// 시즌 이벤트(13주 — 보상 배율만 바꿈, 새 플레이 시간 없음 → minutes 1)
// =====================================================================
EVENT_WEEKS.forEach((w, i) => {
  const day = i * 7 + 1;
  add({ id: `event-w${String(i + 1).padStart(2, '0')}`, name: `시즌 이벤트 W${i + 1} 「${w.name}」 — ${w.tagline}`, phase: phaseOf(day), kind: 'unique', track: 'liveops', minutes: 1, cumMinutes: cumOfDay(day), day,
    source: 'calc:보상 배율만 바꾸고 새 콘텐츠 시간은 없음(applyEventRewards) → 목표 개수용 1분; 시즌 시작 2026-10-26 05:00 KST 기준 주차', status: 'live', evidence: EV.events });
});

// =====================================================================
// planned: 7장 이후 지역, 주간 레이드, 아레나 시즌, 길드, 균열 단계
// =====================================================================
{
  // 7장 실측 오프셋: 스토리 끝 → 숙련/악몽/지옥 끝
  const base = storyDayOf['7-10'];
  const off = ['adept', 'nightmare', 'hell'].map((df) => p50Day((x) => hardSum(x) >= seqBase(df, 7) + 10).day - base);
  const open = { 8: 1, 9: 1, 10: 29, 11: 50, 12: 71 };
  const nm = { 8: '빈 왕좌의 평원', 9: '심연으로 열린 문', 10: '빙하 아래의 별', 11: '황동 채석장의 노을', 12: '균열의 중심' };
  for (const c of [8, 9, 10, 11, 12]) {
    const sd = { 8: base + 1, 9: base + 3, 10: 29, 11: 50, 12: 71 }[c];
    add({ id: `plan-story-${c}`, name: `${c}장 ${nm[c]}(가칭) 10관문 + 신규 AI 동사 몬스터·보스 2종`, phase: phaseOf(sd), kind: 'unique', track: 'story', minutes: 10 * STAGE_MIN, cumMinutes: cumOfDay(sd), day: sd,
      source: `calc:10관문 × ${STAGE_MIN}분; 개방 ${c <= 9 ? 'W1' : 'W' + (c === 10 ? 5 : c === 11 ? 8 : 11)}(SPEC_720H 3.3), 마라톤은 앞 장 클리어 직후 진입`, status: 'planned', evidence: `${EV.spec33}, ${EV.mmo7}` });
    ['adept', 'nightmare', 'hell'].forEach((df, k) => {
      const dd = sd + off[k];
      add({ id: `plan-${df}-${c}`, name: `${HD[df][0]} ${c}장 ${nm[c]} 10관문`, phase: phaseOf(dd), kind: 'unique', track: 'story', minutes: 10 * HARD_MIN, cumMinutes: cumOfDay(dd), day: dd,
        source: `calc:10관문 × ${HARD_MIN}분; 7장 실측 오프셋(스토리 끝 → ${HD[df][0]} 끝 +${off[k]}일) 적용`, status: 'planned', evidence: `${EV.spec33}, ${EV.hell}` });
    });
  }
  const raids = ['시계종의 주권자', '녹청 온실의 성역수', '쌍화구 쇠사슬 집행자', '밤유리 기록관', '흑요룡 삼두', '합류 수로의 유성기사', '네 왕좌의 환영 여왕', '성운 레비아탄', '재벼림 거수', '균열 군주 I', '균열 군주 II(시즌 파이널)'];
  raids.forEach((nmr, i) => {
    const day = (i + 1) * 7 + 1;
    add({ id: `plan-raid-w${i + 2}`, name: `주간 월드 보스 W${i + 2}: ${nmr}`, phase: phaseOf(day), kind: 'unique', track: 'social', minutes: 10, cumMinutes: cumOfDay(day), day,
      source: 'estimate:마일스톤형 레이드 1회 약 10분(MMO_DESIGN 3.8·7.4에 시간 기준 없음) — 미구현이라 실측 불가', status: 'planned', evidence: EV.mmoRaid });
  });
  [[1, 15], [2, 43], [3, 71]].forEach(([n, day]) => add({ id: `plan-arena-s${n}`, name: `아레나 시즌 ${n}(4주, 비동기 AI 빌드 스냅샷)`, phase: phaseOf(day), kind: 'unique', track: 'social', minutes: 20, cumMinutes: cumOfDay(day), day,
    source: 'estimate:시즌 주 3회 × 약 3분 + 빌드 정비 — 미구현이라 실측 불가', status: 'planned', evidence: EV.mmoArena }));
  add({ id: 'plan-guild', name: '길드 개설·가입·주간 목표(W2 개방)', phase: 'P3', kind: 'unique', track: 'social', minutes: 15, cumMinutes: cumOfDay(8), day: 8,
    source: 'estimate:가입·개설·목표 1주 약 15분, 길드 레이드 점수 별도 — 미구현', status: 'planned', evidence: EV.mmoGuild });
  add({ id: 'plan-rift-r30', name: '균열 R1~R30 단계 확장(일일 모디파이어)', phase: 'P3', kind: 'unique', track: 'endgame', minutes: 30, cumMinutes: cumOfDay(15), day: 15,
    source: 'estimate:현재 일일 균열은 단계 없이 보너스 1종(journey-rifts.js); R1~R30은 설계만 — 30단계 × 판당 약 1분 증분 가정', status: 'planned', evidence: EV.rift });
}

// =====================================================================
// repeatable (phase별 상한)
// =====================================================================
const phaseDays = { P1: [1, 1], P2: [2, 7], P3: [8, 30], P4: [31, 60], P5: [61, 90] };
// 시뮬레이터 farm 버킷: 에너지로 가장 보상 큰 관문 반복(= usedMin − 신규 클리어·성·고통)
function farmMin(a, b) {
  const per = seeds.map((s) => { let sum = 0; const d = dump[s].days; for (let i = a - 1; i < b; i++) { const x = d[i], p = d[i - 1]; const storyD = x.story - (p ? p.story : 0), hardD = hardSum(x) - (p ? hardSum(p) : 0), towD = x.tower - (p ? p.tower : 0); sum += Math.max(0, x.usedMin - storyD * 3 - hardD * 4 - towD * 3.5 - x.tormentRuns * 4.5); } return sum; });
  return mean(per);
}
const SIMIDS = /^(story|tower|torment|adept|nightmare|hell|rep-torment-lead|rep-farm)-/;
for (const [ph, [a, b]] of Object.entries(phaseDays)) {
  const days = b - a + 1, weeks = days / 7, mid = cumOfDay(Math.round((a + b) / 2));
  add({ id: `rep-daily-${ph.toLowerCase()}`, name: `일일 의뢰 9종(던전 3승·균열·탑 1층·하드 2판·소환·강화) — ${ph}`, phase: ph, kind: 'repeatable', track: 'liveops', capHours: r1(days * 12 / 60), cumMinutes: mid,
    source: `calc:던전 3승 × ${DUNGEON_MIN}분 + 회전 던전 1승 × ${DUNGEON_MIN}분 = 12분/일(나머지 의뢰는 사냥 중 자동) × ${days}일; 보상은 하루 고정(골드·강화석)`, status: 'live', evidence: EV.daily });
  if (ph !== 'P1') add({ id: `rep-weekly-${ph.toLowerCase()}`, name: `주간 의뢰 8종(던전 7승·서로 다른 던전 3곳 등) — ${ph}`, phase: ph, kind: 'repeatable', track: 'liveops', capHours: r1(weeks * 21 / 60), cumMinutes: mid,
    source: `calc:던전 7승 × ${DUNGEON_MIN}분 = 21분/주(나머지 주간 의뢰는 겹침) × ${r1(weeks)}주; 주 1회 보상`, status: 'live', evidence: EV.weekly });
  add({ id: `rep-rift-${ph.toLowerCase()}`, name: `오늘의 균열(회전 던전 변형 1종, 모디파이어 보너스) — ${ph}`, phase: ph, kind: 'repeatable', track: 'liveops', capHours: r1(days * 5 / 60), cumMinutes: mid,
    source: `estimate:균열 1판 약 5분 × ${days}일, 실측 없음(일일 1회 보너스)`, status: 'live', evidence: EV.rift });
  add({ id: `rep-party-${ph.toLowerCase()}`, name: `협동 파티 던전(4인, 협동 보너스 일 3회) — ${ph}`, phase: ph, kind: 'repeatable', track: 'social', capHours: r1(days * 27 / 60), cumMinutes: mid,
    source: `estimate:MMO_DESIGN 2.2 '파티 8~10분' × 협동 보너스 일 3회(3.6) = 27분/일 × ${days}일 — 다른 이용자가 있어야 성립`, status: 'live', evidence: `${EV.party}, ${EV.mmo}`, note: '상대(파티원)가 필요해 단독 이용자는 채울 수 없음' });
  // 시뮬레이터 farm 버킷에서 위 비시뮬 활동(원정·제작·의뢰 등 live)이 차지하는 시간을 뺀다 — 하루 480분은 한 번만 센다
  const extras = units.filter((u) => u.phase === ph && u.status === 'live' && !SIMIDS.test(u.id)).reduce((t, u) => t + (u.kind === 'repeatable' ? u.capHours * 60 : u.minutes), 0);
  const simFarm = farmMin(a, b);
  const displaced = ph === 'P1' || ph === 'P2' ? 0 : extras; // P1·P2 는 시뮬레이터의 '할 일 없음'(starved) 시간이 흡수
  const fm = Math.max(0, simFarm - displaced);
  if (fm >= 6) add({ id: `rep-farm-${ph.toLowerCase()}`, name: `에너지 반복 파밍(가장 보상 큰 관문 재도전: 강화석·장비·룬 재료) — ${ph}`, phase: ph, kind: 'repeatable', track: 'gear', capHours: r1(fm / 60), cumMinutes: mid,
    source: `sim:${SIMNOTE} farm 시간 = usedMin − 신규 클리어(스토리·난이도·성)·고통 판 (D${a}~D${b}) ${r1(simFarm / 60)}h에서 위 비시뮬 활동 ${r1(displaced / 60)}h를 뺀 값; 에너지 리젠(시간당 20)이 상한을 정함`, status: 'live', evidence: 'tools/sim-90d.mjs:421, src/data/shop.js:64', note: '같은 보상 상한(강화석·장비)을 공유하는 단일 단위' });
}

// ---------- 고통 시간 보정: 구간별 합이 시뮬레이터 총 고통 시간(시드 평균)과 같도록 ----------
for (const w of Object.keys(tormentTotals)) {
  const mine = units.filter((u) => u.phase === w && (u.id === 'torment-01' ? false : u.id.startsWith('torment-') || u.id.startsWith('rep-torment-lead')));
  const sum = mine.reduce((t, u) => t + (u.kind === 'repeatable' ? u.capHours * 60 : u.minutes), 0);
  if (!sum) continue;
  const f = tormentTotals[w] / sum;
  if (Math.abs(f - 1) < 0.01) continue;
  for (const u of mine) {
    if (u.kind === 'repeatable') u.capHours = r1(u.capHours * f); else u.minutes = Math.max(1, Math.round(u.minutes * f));
    u.source += ` [구간 ${w} 고통 시간 합을 시뮬레이터 총량 ${Math.round(tormentTotals[w])}분에 맞추려 ×${f.toFixed(2)} 보정(시드마다 도달 단계가 달라 평균 증분의 합이 어긋남)]`;
  }
}

// ---------- 정렬·저장 ----------
const order = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
units.sort((a, b) => order[a.phase] - order[b.phase] || (a.cumMinutes ?? 0) - (b.cumMinutes ?? 0) || a.id.localeCompare(b.id));
fs.writeFileSync(S + 'units.json', JSON.stringify(units, null, 1));
console.log('units', units.length);
