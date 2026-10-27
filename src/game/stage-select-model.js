// 스테이지 선택 화면의 순수 모델. 저장·진행·해금 판정을 읽기만 하고 아무것도 쓰지 않는다.
// 화면(src/ui/stage-select.js)은 이 결과만 그리고, 입장은 기존 startStage / 준비창(openDestination)이 맡는다.
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../data/stages.js';
import { chapterOpenLabel, isChapterOpen } from '../data/chapter-open.js';
import { MATERIALS } from '../data/expansion.js';
import { expeditionDepth } from '../data/expedition-depths.js';
import { dungeonJourney } from '../ui/dungeon-journey.js';

export const STAGE_SELECT_STORAGE_KEY = 'blade-surge.stage-select.v1';
export const STAGE_SELECT_TABS = Object.freeze(['campaign', 'dungeon']);
export const STAGE_SELECT_INTRO = '처음이라면 1-1부터! 관문을 깨면 다음 관문이 열려요';

const LAST_STAGE = CHAPTERS.length * STAGES_PER_CHAPTER;
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const fmt = (value) => Number(value || 0).toLocaleString('ko-KR');

/**
 * 기기별 화면 기억(첫 안내를 봤는지, 마지막으로 고른 위치). 잘못된 값은 버리고 기본값으로 돌린다. 멱등이다.
 * last.followed=true 는 '그때의 추천을 골랐다'는 뜻이다. 다음에 열 때 지난 위치가 아니라 새 추천으로 연다.
 * @param {unknown} raw
 * @returns {{ introSeen: boolean, last: null | { tab: 'campaign', ch: number, st: number, followed: boolean } | { tab: 'dungeon', id: string, depth: 'standard'|'deep', followed: boolean } }}
 */
export function normalizeStageSelectMemory(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {any} */ (raw) : {};
  const introSeen = value.introSeen === true;
  const last = value.last && typeof value.last === 'object' ? value.last : null;
  const followed = last?.followed === true;
  if (last?.tab === 'campaign' && isInt(last.ch, 1, CHAPTERS.length) && isInt(last.st, 1, STAGES_PER_CHAPTER)) return { introSeen, last: { tab: 'campaign', ch: last.ch, st: last.st, followed } };
  if (last?.tab === 'dungeon' && typeof last.id === 'string' && /^[a-z0-9_]{1,64}$/.test(last.id)) return { introSeen, last: { tab: 'dungeon', id: last.id, depth: last.depth === 'deep' ? 'deep' : 'standard', followed } };
  return { introSeen, last: null };
}

/** 저장 공간이 막힌 브라우저(사이트 데이터 차단)는 getter 가 예외를 던진다. 그때는 기본값으로 이번 창에서만 기억한다. */
export function readStageSelectMemory(storage) {
  try {
    const raw = (storage === undefined ? globalThis.localStorage : storage)?.getItem(STAGE_SELECT_STORAGE_KEY);
    return normalizeStageSelectMemory(raw ? JSON.parse(raw) : null);
  } catch { return normalizeStageSelectMemory(null); }
}
/**
 * 화면을 열 때 쓸 기억. 저장 공간을 읽을 수 없거나 마지막 쓰기가 실패했으면 이번 세션 사본을 그대로 쓴다
 * (차단된 브라우저에서 첫 안내가 열 때마다 다시 뜨거나 같은 세션의 마지막 선택을 잊지 않게).
 * @param {unknown} session 이번 세션에 들고 있는 기억  @param {boolean|undefined} lastWriteOk 마지막 쓰기 결과(쓴 적 없으면 undefined)
 */
export function refreshStageSelectMemory(session, lastWriteOk, storage) {
  if (session && lastWriteOk === false) return normalizeStageSelectMemory(session);
  try {
    const raw = (storage === undefined ? globalThis.localStorage : storage)?.getItem(STAGE_SELECT_STORAGE_KEY);
    if (raw === null || raw === undefined) return session ? normalizeStageSelectMemory(session) : normalizeStageSelectMemory(null);
    return normalizeStageSelectMemory(JSON.parse(raw));
  } catch { return normalizeStageSelectMemory(session); }
}
export function writeStageSelectMemory(memory, storage) {
  try { (storage === undefined ? globalThis.localStorage : storage)?.setItem(STAGE_SELECT_STORAGE_KEY, JSON.stringify(normalizeStageSelectMemory(memory))); return true; } catch { return false; }
}

/** 추천 전투력 대비 내 전투력 색. 이상=ok(초록), 80% 이상=close(노랑), 그 밑=low(빨강). */
export function powerTone(power, recPower) {
  const mine = Number(power) || 0, need = Number(recPower) || 0;
  if (!need || mine >= need) return 'ok';
  return mine >= need * 0.8 ? 'close' : 'low';
}

/** 캠페인 진행이 가리키는 다음 관문(Economy.nextStage 와 같은 규칙). */
export function nextCampaignStage(progress) {
  const idx = Math.max(1, Math.min(Number(progress?.unlocked) || 1, LAST_STAGE));
  return { ch: Math.ceil(idx / STAGES_PER_CHAPTER), st: ((idx - 1) % STAGES_PER_CHAPTER) + 1 };
}
const stageIndex = (ch, st) => (ch - 1) * STAGES_PER_CHAPTER + st;
const campaignUnlocked = (progress, ch, st, now = Date.now()) => stageIndex(ch, st) <= Math.max(1, Number(progress?.unlocked) || 1) && isChapterOpen(ch, now);
// 시간 개방 지역은 개방 시각 전이면 진행도와 무관하게 개방 시각을 안내한다.
const stageLockReason = (ch, st, now = Date.now()) => !isChapterOpen(ch, now) ? `${chapterOpenLabel(ch)} 개방` : st === 1 ? `${ch - 1}-10 클리어 시 해금` : `${ch}-${st - 1} 클리어 시 해금`;

/**
 * 한 지역의 관문 X-1 … X-10. X-5 중간 보스, X-10 지역 보스.
 * @param {{ progress: any, chapter: number, power: number, heroLevel: number, energy?: number|null, difficulty?: { name?: string, rewardMul?: number, expMul?: number } | ((ch: number, st: number) => { name?: string, rewardMul?: number, expMul?: number }), now?: number }} input
 */
export function campaignStages({ progress, chapter, power, heroLevel, energy = null, difficulty = null, now = Date.now() }) {
  const ch = isInt(chapter, 1, CHAPTERS.length) ? chapter : 1;
  const next = nextCampaignStage(progress);
  const stars = progress?.stars || {};
  const list = [];
  for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
    const stage = stageDef(ch, st);
    const unlocked = campaignUnlocked(progress, ch, st, now), got = Math.max(0, Math.min(3, Number(stars[stage.code]) || 0));
    const mode = (typeof difficulty === 'function' ? difficulty(ch, st) : difficulty) || {};
    const rewardMul = Number(mode.rewardMul) || 1, expMul = Number(mode.expMul) || 1;
    // 고통 단계는 에너지 0(applyDifficulty 와 같은 규칙).
    const tormentCost = mode.tormentTier ? 0 : stage.energy;
    const rewards = [{ id: 'gold', name: '골드', amount: Math.floor(stage.rewards.gold * rewardMul) }, { id: 'exp', name: '경험치', amount: Math.floor(stage.rewards.exp * expMul) }];
    if (!got) rewards.push({ id: 'gems', name: '첫 클리어 보석', amount: stage.rewards.firstGems });
    list.push({
      kind: 'campaign', key: `campaign:${stage.code}`, ch, st, code: stage.code, title: stage.title,
      rank: stage.encounter.rank, rankLabel: stage.regionBoss ? '지역 보스' : stage.midboss ? '중간 보스' : stage.encounter.label,
      enemyName: stage.encounter.name, midboss: !!stage.midboss, regionBoss: !!stage.regionBoss, boss: !!stage.boss,
      unlocksChapter: stage.unlocksChapter || null,
      unlocked, stars: got, cleared: got > 0, recommended: next.ch === ch && next.st === st,
      lockReason: unlocked ? '' : stageLockReason(ch, st, now),
      recommendedLevel: stage.recommendedLevel, heroLevel: Number(heroLevel) || 1,
      levelTone: (Number(heroLevel) || 1) >= stage.recommendedLevel ? 'ok' : (Number(heroLevel) || 1) >= stage.recommendedLevel - 2 ? 'close' : 'low',
      recPower: stage.recPower, power: Number(power) || 0, powerTone: powerTone(power, stage.recPower),
      cost: tormentCost, enoughEnergy: Number.isFinite(energy) ? Number(energy) >= tormentCost : true,
      difficultyName: mode.name || '', difficultyId: mode.id || '', tormentTier: Number(mode.tormentTier) || 0, rewards,
    });
  }
  const chapters = CHAPTERS.map((entry) => ({
    id: entry.id, name: entry.name, color: entry.color, unlocked: campaignUnlocked(progress, entry.id, 1, now),
    cleared: Array.from({ length: STAGES_PER_CHAPTER }, (_, i) => Number(stars[`${entry.id}-${i + 1}`]) > 0).filter(Boolean).length,
    lockReason: campaignUnlocked(progress, entry.id, 1, now) ? '' : !isChapterOpen(entry.id, now) ? `${chapterOpenLabel(entry.id)} 개방` : `${entry.id - 1}-10 클리어 시 열림`,
  }));
  return { chapter: ch, chapterName: CHAPTERS[ch - 1].name, chapters, stages: list, next };
}

/**
 * 던전 목록의 단일 소스: 지역 마을 해금 판정(region-dungeon-gate, app.expedition.regionDungeons()).
 * 보이는(visible) 던전만 목록에 오고, 아직 열리지 않은 바로 다음 지역은 예고(teaser) 한 줄로만 알린다. 숨은 던전은 나오지 않는다.
 * 입장 가능 여부·잠금 사유는 dungeonAccess(지역+탐험 레벨)의 문구를 그대로 쓴다. 판정을 모르는 서비스(테스트 대역)는 전체 목록이다.
 * @param {{ s: any, dungeonAccess: (id: string, options: { depth: string }) => { ok: boolean, error?: string|null }, regionDungeons?: () => any }} expedition
 * @returns {{ nodes: Array<{ dungeon: any, unlocked: boolean, reason: string, wins: number, cleared: boolean }>, teaser: null | { region: number, town: string, reason: string, unlockCode: string } }}
 */
export function stageSelectDungeonSource(expedition) {
  const journey = dungeonJourney(expedition);
  const nodes = journey.nodes.map((node) => ({ dungeon: node.dungeon, unlocked: node.unlocked, reason: node.reason || '', wins: node.wins, cleared: node.cleared }));
  const teaser = journey.teaser ? { region: journey.teaser.region, town: journey.teaser.town, reason: journey.teaser.reason, unlockCode: journey.teaser.unlockCode } : null;
  return { nodes, teaser };
}

const materialRewards = (rewards) => [
  ...(rewards?.gold ? [{ id: 'gold', name: '골드', amount: rewards.gold }] : []),
  ...Object.entries(rewards?.materials || {}).map(([id, amount]) => ({ id, amount, name: MATERIALS.find((material) => material.id === id)?.name || id })),
];

/**
 * 던전 탭 목록. 지역 판정으로 보이는 던전 전부(탐험 레벨로 잠긴 곳은 사유 표시) + 다음 마을 예고 한 줄.
 * 각 던전은 기본/심층 단계를 갖고, 심층은 정의가 있는 던전만 보인다.
 * @param {{ expedition: any, power: number, energy?: number|null, source?: ReturnType<typeof stageSelectDungeonSource> }} input
 */
export function dungeonStages({ expedition, power, energy = null, source = undefined }) {
  const { nodes, teaser } = source || stageSelectDungeonSource(expedition);
  const open = nodes.filter((node) => node.unlocked);
  const depthWins = expedition?.s?.depthWins || {};
  const entry = (node, depth) => {
    const definition = depth === 'deep' ? expeditionDepth(node.dungeon.id) : node.dungeon;
    if (!definition) return null;
    const access = depth === 'deep' ? expedition.dungeonAccess(node.dungeon.id, { depth: 'deep' }) : { ok: node.unlocked, error: node.reason };
    const recPower = depth === 'deep' ? Math.floor(2600 * (Number(definition.scale) || 1)) : Number(node.dungeon.stage?.recPower) || 0;
    const wins = depth === 'deep' ? Number(depthWins[node.dungeon.id]) || 0 : node.wins;
    const rewards = materialRewards(definition.rewards);
    if (depth === 'deep' && !wins && definition.firstRewards?.gold) rewards.push({ id: 'first', name: '첫 심층 클리어 골드', amount: definition.firstRewards.gold });
    return {
      kind: 'dungeon', key: `dungeon:${node.dungeon.id}:${depth}`, id: node.dungeon.id, depth, depthLabel: depth === 'deep' ? '심층' : '기본',
      name: definition.name || node.dungeon.name, art: definition.art || node.dungeon.art, accent: node.dungeon.accent || '#d9c5a0',
      unlocked: !!access?.ok, lockReason: access?.ok ? '' : access?.error || '입장 조건을 확인해 주세요.',
      minLevel: Number(definition.minLevel) || 1, wins, cleared: wins > 0,
      recPower, power: Number(power) || 0, powerTone: powerTone(power, recPower),
      cost: Number(definition.energy) || 0, enoughEnergy: Number.isFinite(energy) ? Number(energy) >= (Number(definition.energy) || 0) : true,
      rewards,
    };
  };
  const list = nodes.map((node) => ({ id: node.dungeon.id, name: node.dungeon.name, unlocked: node.unlocked, depths: [entry(node, 'standard'), entry(node, 'deep')].filter(Boolean) }));
  return { dungeons: list, open: open.length, total: nodes.length, teaser };
}

const findCampaign = (campaign, ch, st) => campaign.chapter === ch ? campaign.stages.find((stage) => stage.st === st) : null;
const findDungeon = (dungeons, id, depth) => dungeons.dungeons.find((entry) => entry.id === id)?.depths.find((entry) => entry.depth === depth) || null;

/**
 * 화면 전체 모델. 기본 선택 순서:
 * 1) prefer(던전 카드로 직접 고른 던전 등) → 2) 기억한 마지막 선택(그때 추천을 골랐다면 지금 추천) → 3) 추천(다음 관문).
 * 잠긴 위치는 기본 선택이 되지 않는다(목록에서는 고를 수 있지만 입장 불가 사유를 보여 준다).
 * @param {{ progress: any, expedition: any, power: number, heroLevel: number, energy?: number|null, memory?: any,
 *   prefer?: { tab: 'campaign', ch: number, st: number } | { tab: 'dungeon', id: string, depth?: string } | null,
 *   dungeonRecommended?: { id: string, depth?: string } | null, chapter?: number | null, difficulty?: any, source?: any, now?: number }} input
 */
export function stageSelectModel({ progress, expedition, power, heroLevel, energy = null, memory = null, prefer = null, dungeonRecommended = null, chapter = null, difficulty = null, source = undefined, now = Date.now() }) {
  // now: 규칙 시계(호출부가 ecoClock(eco) 로 넘긴다). 기기 시계만 쓰면 신뢰 시계와 어긋나 선택 화면과 startStage 의 개방 판정이 갈린다.
  const saved = normalizeStageSelectMemory(memory);
  const next = nextCampaignStage(progress);
  const finished = Number(progress?.stars?.[`${CHAPTERS.length}-${STAGES_PER_CHAPTER}`]) > 0;
  const dungeons = dungeonStages({ expedition, power, energy, source });
  const firstOpenDungeon = dungeons.dungeons.find((entry) => entry.unlocked);
  const recDungeon = (dungeonRecommended && findDungeon(dungeons, dungeonRecommended.id, dungeonRecommended.depth === 'deep' ? 'deep' : 'standard')?.unlocked)
    ? { id: dungeonRecommended.id, depth: dungeonRecommended.depth === 'deep' ? 'deep' : 'standard' }
    : firstOpenDungeon ? { id: firstOpenDungeon.id, depth: 'standard' } : null;
  // 캠페인을 끝낸 저장은 던전이 추천, 그 밖에는 다음 관문이 추천이다.
  const recommended = finished && recDungeon ? { tab: 'dungeon', ...recDungeon } : { tab: 'campaign', ch: next.ch, st: next.st };
  const usable = (pick) => {
    if (!pick) return null;
    if (pick.tab === 'campaign' && isInt(pick.ch, 1, CHAPTERS.length) && isInt(pick.st, 1, STAGES_PER_CHAPTER) && campaignUnlocked(progress, pick.ch, pick.st, now)) return { tab: 'campaign', ch: pick.ch, st: pick.st };
    if (pick.tab === 'dungeon' && typeof pick.id === 'string') {
      const depth = pick.depth === 'deep' ? 'deep' : 'standard';
      if (findDungeon(dungeons, pick.id, depth)?.unlocked) return { tab: 'dungeon', id: pick.id, depth };
    }
    return null;
  };
  // '그때 추천을 골랐다'는 기억은 지금의 추천으로 푼다. 캠페인을 완주했으면(6-10 클리어) 캠페인 기억도 전체 추천(던전)으로 연다.
  const followedPick = !saved.last?.followed ? null
    : saved.last.tab === 'dungeon' ? (recDungeon ? { tab: 'dungeon', ...recDungeon } : null)
    : finished ? recommended : { tab: 'campaign', ch: next.ch, st: next.st };
  const remembered = saved.last ? (saved.last.followed ? followedPick : saved.last) : null;
  const selection = usable(prefer) || usable(remembered) || usable(recommended) || { tab: 'campaign', ch: next.ch, st: next.st };
  const viewChapter = isInt(chapter, 1, CHAPTERS.length) ? chapter : selection.tab === 'campaign' ? selection.ch : next.ch;
  const campaign = campaignStages({ progress, chapter: viewChapter, power, heroLevel, energy, difficulty, now });
  const anyStars = Object.values(progress?.stars || {}).some((value) => Number(value) > 0);
  return {
    tab: selection.tab, selection, recommended, campaign, dungeons, finished,
    // 첫 안내: 이 기기에서 본 적이 없고 캠페인 별 기록이 하나도 없는 저장(신규)만. 이미 관문을 깬 기존 저장은 띄우지 않는다.
    intro: !saved.introSeen && !anyStars,
    introText: STAGE_SELECT_INTRO,
  };
}

/** 선택된 항목 상세(캠페인 관문 또는 던전 단계). 화면에 보이지 않는 지역의 관문이면 null. */
export function selectedEntry(model, selection = model.selection) {
  if (selection?.tab === 'campaign') return findCampaign(model.campaign, selection.ch, selection.st);
  if (selection?.tab === 'dungeon') return findDungeon(model.dungeons, selection.id, selection.depth === 'deep' ? 'deep' : 'standard');
  return null;
}

/** 로비 던전 카드가 가리키는 던전을 선택창의 우선 선택으로 만든다. 카드의 실제 단계(심층 등)를 유지한다. */
export function landingPrefer(landing, selectedId) {
  if (!selectedId) return null;
  const depth = landing?.dungeon?.id === selectedId && landing.depth === 'deep' ? 'deep' : 'standard';
  return { tab: 'dungeon', id: selectedId, depth };
}

/** 목록 버튼을 다시 찾는 선택자(관문은 ch/st, 던전은 id/depth). 목록이 통째로 바뀐 뒤 초점 복원에 쓴다. */
export function selectionSelector(selection) {
  if (selection?.tab === 'campaign') return `[data-ch="${selection.ch}"][data-st="${selection.st}"]`;
  if (selection?.tab === 'dungeon') return `[data-dungeon-id="${selection.id}"][data-depth="${selection.depth === 'deep' ? 'deep' : 'standard'}"]`;
  return null;
}

/** 선택이 그 탭의 현재 추천과 같은가(기억할 때 followed 로 남긴다). */
export function isRecommendedSelection(model, selection) {
  if (!selection) return false;
  if (selection.tab === 'campaign') return model.campaign.next.ch === selection.ch && model.campaign.next.st === selection.st;
  const rec = model.recommended.tab === 'dungeon' ? model.recommended : null;
  const first = model.dungeons.dungeons.find((entry) => entry.unlocked);
  const target = rec || (first ? { id: first.id, depth: 'standard' } : null);
  return !!target && target.id === selection.id && target.depth === (selection.depth === 'deep' ? 'deep' : 'standard');
}

/** 입장 버튼 상태와 읽기 이름. 잠김·에너지 부족이면 막힌 이유 한 줄. 에너지 부족은 기존 서비스가 충전 안내를 띄우므로 버튼은 누를 수 있다. */
export function entryAction(entry) {
  if (!entry) return { enabled: false, reason: '관문이나 던전을 골라 주세요.', label: '입장' };
  if (!entry.unlocked) return { enabled: false, reason: entry.lockReason || '아직 잠겨 있습니다.', label: '잠김' };
  const reason = entry.enoughEnergy ? '' : `에너지가 부족합니다 · 필요 ${fmt(entry.cost)}`;
  return { enabled: true, reason, label: '입장' };
}
