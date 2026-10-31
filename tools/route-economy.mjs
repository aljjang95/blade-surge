// 던전 동선 경제 비교 — 보스 직행(최단 경로 방 + 보스) vs 전부 사냥(모든 방 + 전체 정화 보너스).
// 같은 층 생성기(Floor)로 관문마다 정화 방 수·처치·골드·경험치 기댓값을 계산한다(tools/economy-estimate.mjs perRun).
// 시간은 방 수 비례 모형(방당 시간 동일, 보스 방 가중치 BOSS_ROOM_W)이며 tools/route-compare.mjs 헤드리스 실측으로 보정한다.
//   사용: bun tools/route-economy.mjs [--json]
import { perRun } from './economy-estimate.mjs';
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../src/data/stages.js';
import { routeObjectiveForStage } from '../src/data/route-objectives.js';

export const BOSS_ROOM_W = 3;   // 보스 방 1곳 ≈ 일반 방 3곳의 시간(보스 체력·패턴)
const total = CHAPTERS.length * STAGES_PER_CHAPTER;

/** 관문 하나의 두 동선 비교. stageExpMul: 전체 정화 보너스 경험치 +50%(economy.completeStage fullClearBonus). */
export function routeCompare(idx) {
  const full = perRun(idx, { fullClear: true }), direct = perRun(idx, { fullClear: false, route: 'direct' });
  const stage = stageDef(full.ch, full.st);
  const exp = (r, bonus) => r.combatExp + stage.rewards.exp * (bonus ? 1.5 : 1);
  const kills = (r) => r.kills.normal + r.kills.elite + r.kills.boss;
  const time = (r) => (r.rooms - 1) + BOSS_ROOM_W;   // 방 수(보스 방 제외) + 보스 가중
  const timeShare = time(direct) / time(full);
  return { idx, code: full.code, puzzle: !!routeObjectiveForStage(stage), rooms: { full: full.rooms, direct: direct.rooms }, timeShare: +timeShare.toFixed(3),
    perRun: { killShare: +(kills(direct) / kills(full)).toFixed(3), goldShare: +(direct.gold / full.gold).toFixed(3), expShare: +(exp(direct, false) / exp(full, true)).toFixed(3) },
    perMinute: { gold: +((direct.gold / full.gold) / timeShare).toFixed(3), exp: +((exp(direct, false) / exp(full, true)) / timeShare).toFixed(3) } };
}

export function routeReport() {
  const rows = []; for (let i = 1; i <= total; i++) rows.push(routeCompare(i));
  const open = rows.filter(r => !r.puzzle), mean = (k, f) => +(open.reduce((a, r) => a + f(r), 0) / open.length).toFixed(3);
  return { stages: rows.length, directStages: open.length, mean: { timeShare: mean('t', r => r.timeShare), killShare: mean('k', r => r.perRun.killShare),
    goldShare: mean('g', r => r.perRun.goldShare), expShare: mean('e', r => r.perRun.expShare), goldPerMin: mean('gm', r => r.perMinute.gold), expPerMin: mean('em', r => r.perMinute.exp) }, rows };
}

if (import.meta.main) {
  const rep = routeReport();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rep, null, 1));
  else {
    console.log(`관문 ${rep.stages}개 중 직행 가능 ${rep.directStages}개(장치 목표 관문 제외)`);
    console.log('평균(직행/전부):', JSON.stringify(rep.mean));
    for (const r of rep.rows.filter(r => r.st === undefined && (r.idx % 10 === 1 || r.idx % 10 === 5 || r.idx % 10 === 0)))
      console.log(r.code.padEnd(5), `방 ${r.rooms.direct}/${r.rooms.full}`, `시간 ${r.timeShare}`, `판당 골드 ${r.perRun.goldShare} 경험치 ${r.perRun.expShare}`, `분당 골드 ${r.perMinute.gold} 경험치 ${r.perMinute.exp}`, r.puzzle ? '(장치 관문: 직행 없음)' : '');
  }
}
