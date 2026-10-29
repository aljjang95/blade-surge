// 엔드게임 허브(읽기 전용 순수 규칙). 만렙 뒤 "무엇을 하는지"를 저장 상태 하나로 정해 다음 목표 최대 3개를 돌려준다.
// 규칙의 정본은 docs/ENDGAME.md. 무작위·시계 호출·저장 변경이 없다(시계는 호출자가 nowMs 로 넘긴다).
import { TORMENT } from '../data/content-90d.js';
import { CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';
import { EXPEDITION_DEPTHS } from '../data/expedition-depths.js';
import { EXPEDITION_ROUTES } from '../data/expedition-routes.js';
import { dungeonVisibility } from './region-dungeon-gate.js';
import { HEROES } from '../data/heroes.js';
import { HERO_LEVEL_CAP } from './rpg-core.js';
import { DIFFICULTY_ORDER, tormentUnlockedTier } from './difficulty.js';
import { normalizeEndgame, activeEvents, towerSummary } from './endgame-core.js';
import { normalizeLegend, legendExpFor } from './legend-rank.js';

/** 허브가 로비에 처음 보이는 영웅 레벨. 전설 수련(Lv.80)·고통 권장 레벨(80)보다 20 앞서 "만렙 뒤"를 미리 알린다. */
export const ENDGAME_INTRO_LEVEL = 60;
export const MAX_GOALS = 3;
const NIGHTMARE = DIFFICULTY_ORDER.indexOf('nightmare'), HELL = DIFFICULTY_ORDER.indexOf('hell');
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 계정에서 가장 높은 영웅 레벨(미보유 영웅은 1레벨이라 따로 거르지 않는다). */
export function highestHeroLevel(save) {
  let max = 1;
  for (const [id, hero] of Object.entries(object(save?.heroes) ? save.heroes : {})) if (HEROES[id]) max = Math.max(max, Math.min(HERO_LEVEL_CAP, Math.floor(Number(hero?.level) || 1)));
  return max;
}

/** 지역별 악몽·지옥 클리어 관문 수. */
function chapterRows(peak) {
  return CHAPTERS.map((_, i) => {
    let nightmare = 0, hell = 0;
    for (let st = 1; st <= STAGES_PER_CHAPTER; st++) { const rank = peak[`${i + 1}-${st}`] ?? -1; if (rank >= NIGHTMARE) nightmare++; if (rank >= HELL) hell++; }
    return { ch: i + 1, nightmare, hell };
  });
}
/** 값이 가장 큰 행(동률이면 앞 지역). */
const best = (rows, key) => rows.reduce((a, r) => (!a || r[key] > a[key] ? r : a), null);

/**
 * 엔드게임 허브가 열려 있는지와 그 이유. 아래 중 하나면 열린다.
 *  1) 영웅 최고 레벨 ≥ ENDGAME_INTRO_LEVEL  2) 어느 지역이든 지옥 관문을 클리어  3) 전설 수련·고통 단계 기록이 있음.
 * 무한의 성(2-10 클리어)은 캠페인 초반에 열려 엔드게임 신호로 쓰지 않는다.
 */
export function endgameUnlock(save) {
  const level = highestHeroLevel(save), eg = normalizeEndgame(save?.endgame), legend = normalizeLegend(save?.legend);
  if (level >= ENDGAME_INTRO_LEVEL) return { unlocked: true, reason: 'level', level };
  if (Object.values(eg.peak).some((rank) => rank >= HELL)) return { unlocked: true, reason: 'hell', level };
  if (legend.rank > 0 || legend.exp > 0 || eg.torment.best > 0) return { unlocked: true, reason: 'record', level };
  return { unlocked: false, reason: null, level };
}

const goal = (priority, id, title, why, progress, target) => ({ priority, id, title, why, progress, target });
const bar = (cur, max, text) => ({ cur: Math.max(0, Math.min(cur, max)), max, text });

/**
 * 다음 목표(최대 3개). 후보마다 우선순위 숫자를 주고 작은 순(동률은 id 순)으로 3개를 고른다.
 *   1 전설 점수 미분배 · 2 주간 보급 수령 · 10 Lv.80 · 15 성문 개방 주간의 탑 · 20 악몽→지옥→고통 사다리 · 30 전설 수련 · 40 무한의 성 · 50 심층 원정(기본 원정 미클리어면 그 기본 원정).
 * @param {any} save  Economy 저장(s). 바꾸지 않는다.
 * @param {{ nowMs?: number, limit?: number }} [options]  limit: 고를 개수(기본 3, 시험용으로 늘릴 수 있다)
 * @returns {{ unlocked: boolean, reason: string|null, level: number, goals: Array<{id:string,title:string,why:string,progress:{cur:number,max:number,text:string},target:{screen:string,arg?:string,depth?:string},priority:number}>, season: {id:string,name:string,tagline:string}|null }}
 */
export function endgameGoals(save, { nowMs = 0, limit = MAX_GOALS } = {}) {
  const gate = endgameUnlock(save), events = activeEvents(nowMs), season = events[0] ? { id: events[0].id, name: events[0].name, tagline: events[0].tagline } : null;
  if (!gate.unlocked) return { ...gate, goals: [], season };
  const level = gate.level, eg = normalizeEndgame(save?.endgame), legend = normalizeLegend(save?.legend), progress = object(save?.progress) ? save.progress : {};
  const rows = chapterRows(eg.peak), tormentTier = tormentUnlockedTier({ endgame: eg }), tormentBest = eg.torment.best;
  const out = [];

  if (legend.points > 0) out.push(goal(1, 'legend-points', `전설 점수 ${legend.points}점 분배`, '전설 단계마다 얻은 점수를 갈래 노드에 넣으면 공격·체력·재화 획득이 바로 오릅니다.', bar(0, legend.points, `남은 점수 ${legend.points}`), { screen: 'legend' }));

  const tower = towerSummary(eg, progress, nowMs);
  if (tower.unlocked && tower.chest.ready) out.push(goal(2, 'tower-chest', '주간 보급 상자 받기', '이번 주에 무한의 성을 돌파했다면 최고 층에 맞는 골드·강화석·초월석 상자를 한 번 받습니다.', bar(1, 1, '수령 가능'), { screen: 'tower' }));

  if (level < HERO_LEVEL_CAP) out.push(goal(10, 'level', `영웅 Lv.${HERO_LEVEL_CAP} 달성`, `Lv.${HERO_LEVEL_CAP}부터 넘치는 경험치가 전설 수련으로 쌓이고, 고통 단계도 이 레벨을 기준으로 맞춰져 있습니다.`, bar(level, HERO_LEVEL_CAP, `Lv.${level} / ${HERO_LEVEL_CAP}`), { screen: 'stage' }));

  const towerEvent = events.some((e) => e.effects.some((fx) => fx.kind === 'towerFirstClear'));
  const towerGoal = () => {
    const cap = tower.cap, bossText = tower.boss === 'final' ? '지역 최종 보스' : tower.boss === 'mid' ? '중간 보스' : '관문 대장';
    return goal(towerEvent ? 15 : 40, 'tower', `무한의 성 ${tower.next}층 (${bossText})`,
      towerEvent ? `${season.name} 주간: 첫 돌파 보상이 늘어납니다. 에너지 없이 하루 한두 층씩 오르는 상설 콘텐츠입니다.` : '에너지 없이 다음 한 층에 도전하는 상설 콘텐츠입니다. 10층마다 보석, 25층마다 초월석을 줍니다.',
      bar(tower.best, cap, `최고 ${tower.best}층 / 이번 주 상한 ${cap}층`), { screen: 'tower' });
  };
  if (tower.unlocked && !tower.capped && towerEvent) out.push(towerGoal());

  // 악몽 → 지옥 → 고통 사다리: 가장 앞 단계 하나만 목표가 된다.
  if (tormentTier >= 1) {
    // T50(최고 단계)을 깼으면 더 오를 단계가 없다 — 불가능한 목표로 세 칸을 차지하지 않는다.
    if (tormentBest < TORMENT.maxTier) {
    const marks = TORMENT.itemPrefixes.map((p) => ({ tier: p.from, name: p.name })).sort((a, b) => a.tier - b.tier), next = marks.find((m) => m.tier > tormentBest);
    const cap = next ? next.tier : TORMENT.maxTier, name = next ? `${next.name} 장비` : '최고 단계';
    out.push(goal(20, 'torment', `고통 ${tormentBest + 1}단계 도전 (목표 T${cap} ${name})`,
      `에너지 0으로 반복하는 지옥 위의 난이도입니다. T${marks[0].tier}부터 고대, T${marks[1].tier}부터 태고 장비가 나오고, 경험치가 커서 전설 수련도 함께 오릅니다.`,
      bar(tormentBest, cap, `최고 T${tormentBest} / T${cap}`), { screen: 'stage' }));
    }
  } else {
    const hellRow = best(rows.filter((r) => r.nightmare >= STAGES_PER_CHAPTER && r.hell < STAGES_PER_CHAPTER), 'hell');
    if (hellRow) out.push(goal(20, 'hell', `${hellRow.ch}장 지옥 10관문 클리어`, '한 지역의 지옥 10관문을 모두 깨면 고통 단계 T1이 열리고, 이후 고대·태고 장비를 노릴 수 있습니다.', bar(hellRow.hell, STAGES_PER_CHAPTER, `${hellRow.ch}장 지옥 ${hellRow.hell}/${STAGES_PER_CHAPTER}`), { screen: 'stage' }));
    else {
      const row = best(rows.filter((r) => r.nightmare < STAGES_PER_CHAPTER), 'nightmare');
      if (row) out.push(goal(20, 'nightmare', `${row.ch}장 악몽 10관문 클리어`, '한 지역의 10관문을 모두 악몽으로 깨면 그 지역에서 지옥이 열립니다. 악몽은 관문 ★3이 필요합니다.', bar(row.nightmare, STAGES_PER_CHAPTER, `${row.ch}장 악몽 ${row.nightmare}/${STAGES_PER_CHAPTER}`), { screen: 'stage' }));
    }
  }

  if (level >= HERO_LEVEL_CAP || legend.rank > 0 || legend.exp > 0) {
    const need = legendExpFor(legend.rank);
    out.push(goal(30, 'legend', `전설 수련 ${legend.rank + 1}단계`, '만렙 뒤 경험치가 끝없이 쌓이는 성장 축입니다. 5단계마다 전투 동사를 바꾸는 키스톤이 열립니다.', bar(legend.exp, need, `경험치 ${fmt(legend.exp)} / ${fmt(need)}`), { screen: 'legend' }));
  }

  if (tower.unlocked && !tower.capped && !towerEvent) out.push(towerGoal());

  // 심층 원정은 dungeonAccess(expedition-economy.js)와 같은 조건을 본다: 캠페인 X-10, 탐험 레벨, 지역 개방, 기본 원정 첫 클리어.
  // 캠페인은 열렸는데 기본 원정을 아직 안 깼으면 심층 대신 그 기본 원정을 안내한다(잠긴 심층을 가리키지 않게).
  const exp = save?.expedition || {}, expLevel = Number(exp.level) || 1;
  const candidates = EXPEDITION_DEPTHS.filter((d) => d.depth === 'deep' && Number(progress.stars?.[d.unlockCode]) >= 1 && !(exp.depthWins?.[d.id] > 0)
    && dungeonVisibility(save, d.id).open && expLevel >= d.minLevel);
  const deep = candidates.find((d) => exp.stats?.[d.id]);
  const basic = deep ? null : candidates.map((d) => EXPEDITION_ROUTES.find((r) => r.id === d.id)).find((r) => r && expLevel >= (r.minLevel || 1));
  if (deep) out.push(goal(50, 'expedition', `심층 원정: ${deep.name}`, '캠페인 보스 뒤의 이야기를 잇는 던전입니다. 첫 클리어 보상이 있고 심층 원정 기록이 쌓입니다.', bar(0, 1, '첫 클리어 대기'), { screen: 'expedition', arg: deep.id, depth: 'deep' }));
  else if (basic) out.push(goal(50, 'expedition-basic', `기본 원정: ${basic.name}`, '이 던전의 기본 원정을 한 번 깨면 심층 원정이 열립니다.', bar(0, 1, '첫 클리어 대기'), { screen: 'expedition', arg: basic.id, depth: 'standard' }));

  const goals = out.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
  return { ...gate, goals, season };
}
