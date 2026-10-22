// 진행 안내(다음 스테이지·새 지역·권장 레벨 대비 상태·대표 보상)의 순수 데이터 계산.
// 권장 레벨 수치는 loot-tables.js(recommendedLevel)만 읽고, 화면(결과·캠페인)이 이 파일의 결과만 문구로 바꾼다.
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from './stages.js';
import { lootTable, levelExperienceMultiplier, recommendedLevel } from './loot-tables.js';
import { MATERIALS } from './expansion.js';
import { RARITY_INFO } from './items.js';

const TOTAL_STAGES = CHAPTERS.length * STAGES_PER_CHAPTER;
/** 권장 레벨 부족이 이 값 이하면 '도전 가능', 넘으면 '레벨 부족'. */
export const NEAR_GAP = 3;
/** 이 값 이상 높으면 경험치 보정이 최저(×0.5)에 닿아 '너무 쉬움'이다(levelExperienceMultiplier 가 ±10 에서 한계). */
export const OVER_GAP = 10;

const MATERIAL_NAME = Object.fromEntries(MATERIALS.map((m) => [m.id, m.name]));
const pct = (v) => { const p = v * 100; return (p >= 10 || Number.isInteger(p) ? Math.round(p) : Math.round(p * 10) / 10) + '%'; };

/** 가중치 표에서 에픽(E) 이상이 나올 확률(0~1). */
export function epicOrBetterChance(weights) {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  return total > 0 ? ((weights.E || 0) + (weights.U || 0) + (weights.L || 0)) / total : 0;
}

/**
 * 영웅 레벨과 스테이지 권장 레벨의 관계.
 * ready: 권장 이상, under: 권장 미만(near 면 도전 가능, 아니면 레벨 부족), over: 권장보다 크게 높아 경험치 보정이 최저.
 */
export function levelStatus(heroLevel, recLevel) {
  const hero = Math.max(1, Math.floor(Number(heroLevel) || 1)), rec = Math.max(1, Math.floor(Number(recLevel) || 1));
  const gap = rec - hero;
  const status = gap > 0 ? 'under' : -gap >= OVER_GAP ? 'over' : 'ready';
  return { status, levelGap: gap, near: status === 'under' && gap <= NEAR_GAP, expMul: levelExperienceMultiplier(hero, rec) };
}

/** 화면 문구와 색조. tone: good | warn | bad | muted. */
export function levelStatusLabel(heroLevel, recLevel) {
  const s = levelStatus(heroLevel, recLevel);
  if (s.status === 'ready') return { ...s, tone: 'good', text: '준비 완료', detail: '권장 레벨 이상 · 경험치 ×' + s.expMul.toFixed(2) };
  if (s.status === 'over') return { ...s, tone: 'muted', text: '너무 쉬움', detail: '권장보다 ' + -s.levelGap + ' 높음 · 경험치 ×' + s.expMul.toFixed(2) };
  if (s.near) return { ...s, tone: 'warn', text: '도전 가능', detail: 'Lv.' + s.levelGap + ' 부족 · 어렵지만 가능 · 경험치 ×' + s.expMul.toFixed(2) };
  return { ...s, tone: 'bad', text: '레벨 부족', detail: 'Lv.' + s.levelGap + ' 부족 · 먼저 레벨을 올리세요 · 경험치 ×' + s.expMul.toFixed(2) };
}

/** 난이도별 대표 보상: 보스 전리품 표에서 계산한 장비 확률과 재료. */
export function bossLootSummary(chapter, difficulty = 'story') {
  const boss = lootTable(chapter, 'boss', difficulty);
  return {
    gearRolls: boss.gearRolls,
    epicChance: epicOrBetterChance(boss.gearWeights),
    materials: boss.materials.map((m) => ({ id: m.id, name: MATERIAL_NAME[m.id] || m.id, n: m.n, chance: m.chance })),
  };
}

/** @typedef {{ gearRolls: number, gearChance: number, epicChance: number }} RankLoot */

/**
 * 스테이지 전리품 안내 문구 묶음. 난이도를 바꾸면 값이 바뀐다.
 * @returns {{ lines: string[], boss: RankLoot, elite: RankLoot, normal: RankLoot }}
 */
export function lootGuide(chapter, difficulty = 'story') {
  const boss = lootTable(chapter, 'boss', difficulty), elite = lootTable(chapter, 'elite', difficulty), normal = lootTable(chapter, 'normal', difficulty);
  const summary = (t) => ({ gearRolls: t.gearRolls, gearChance: t.gearChance, epicChance: epicOrBetterChance(t.gearWeights) });
  const epic = RARITY_INFO.E.name;
  const mats = boss.materials.map((m) => (MATERIAL_NAME[m.id] || m.id) + ' ×' + m.n).join(' · ');
  const guide = { boss: summary(boss), elite: summary(elite), normal: summary(normal) };
  guide.lines = [
    '보스 장비 ' + boss.gearRolls + '개 확정 · ' + epic + ' 이상 ' + pct(guide.boss.epicChance),
    '정예 장비 ' + elite.gearRolls + '개 확정 · ' + epic + ' 이상 ' + pct(guide.elite.epicChance),
    '일반 적 장비 ' + pct(normal.gearChance) + ' · ' + epic + ' 이상 ' + pct(guide.normal.epicChance),
    '보스 재료 ' + mats,
  ];
  return guide;
}

/** 진행도(progress.unlocked)가 가리키는 다음 출격 스테이지 번호(1~60). */
function frontierIndex(progress) {
  return Math.max(1, Math.min(TOTAL_STAGES, Math.floor(Number(progress?.unlocked) || 1)));
}

/**
 * 다음 출격 안내.
 * @param {{ unlocked?: number, stars?: Record<string, number>, difficulty?: string } | undefined} progress eco.s.progress
 * @param {number | undefined} heroLevel 출전 영웅 레벨
 */
export function nextGuide(progress, heroLevel) {
  const idx = frontierIndex(progress);
  const ch = Math.ceil(idx / STAGES_PER_CHAPTER), st = ((idx - 1) % STAGES_PER_CHAPTER) + 1;
  const def = stageDef(ch, st);
  const rec = recommendedLevel(ch, st);
  const difficulty = ['story', 'adept', 'nightmare', 'hell'].includes(progress?.difficulty) ? progress.difficulty : 'story';
  const level = levelStatus(heroLevel, rec);
  return {
    stage: { ch, st, code: def.code, title: def.title },
    chapterName: CHAPTERS[ch - 1].name,
    newRegion: st === 1 && ch > 1,
    allCleared: idx === TOTAL_STAGES && (progress?.stars?.[def.code] || 0) > 0,
    recommendedLevel: rec,
    levelGap: level.levelGap,
    status: level.status,
    representativeDrops: bossLootSummary(ch, difficulty),
  };
}
