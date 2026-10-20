#!/usr/bin/env bun
// 실제 RPG 처치 XP는 즉시 지급된다. 정산 XP에만 정산 직전 레벨 보정을 적용한다.
import { levelExp } from '../src/data/heroes.js';
import { stageDef, CHAPTERS } from '../src/data/stages.js';
import { recommendedLevel, levelExperienceMultiplier } from '../src/data/loot-tables.js';
import { ENERGY } from '../src/data/shop.js';
import { perRun, TOTAL_STAGES } from './economy-estimate.mjs';

export function progressionEstimate({ minutesPerDay = 30, stageMin = 3, fullClear = true } = {}) {
  let level = 1, exp = 0, day = 1, usedMinutes = 0, energy = ENERGY.max, totalCombatExp = 0, totalStageExp = 0;
  const stages = [], chapters = [];
  const gain = amount => {
    exp += amount;
    while (level < 80 && exp >= levelExp(level)) { exp -= levelExp(level); level++; }
  };
  for (let idx = 1; idx <= TOTAL_STAGES; idx++) {
    const run = perRun(idx, { fullClear }), stage = stageDef(run.ch, run.st);
    let waitMinutes = Math.max(0, run.energy - energy) * ENERGY.regenSec / 60;
    if (usedMinutes + waitMinutes + stageMin > minutesPerDay) {
      day++; usedMinutes = 0; energy = ENERGY.max;
      waitMinutes = 0;
    }
    if (stageMin > minutesPerDay || run.energy > ENERGY.max) throw new RangeError('하루 시간·에너지로 한 판을 완료할 수 없습니다.');
    energy += waitMinutes * 60 / ENERGY.regenSec - run.energy; usedMinutes += waitMinutes + stageMin;
    energy = Math.min(ENERGY.max, energy + stageMin * 60 / ENERGY.regenSec);
    const beforeLevel = level, combatExp = run.combatExp;
    // rpg-battle.spawnEnemy → monsterXp → onEnemyDeath.grantCombatXp. 정산에서 다시 더하지 않는다.
    gain(combatExp);
    const stageExp = Math.floor((stage.rewards.exp + (fullClear ? Math.floor(stage.rewards.exp * .5) : 0))
      * levelExperienceMultiplier(level, recommendedLevel(run.ch, run.st)));
    gain(stageExp); totalCombatExp += combatExp; totalStageExp += stageExp;
    stages.push({ code: stage.code, day, energy: run.energy, beforeLevel, level, combatExp, stageExp });
    if (run.st === 10) {
      const nextRecommended = run.ch < CHAPTERS.length ? recommendedLevel(run.ch + 1) : null;
      chapters.push({ chapter: run.ch, level, nextRecommended, gap: nextRecommended === null ? null : level - nextRecommended,
        day, playedMinutes: (idx - 1) * stageMin + stageMin });
    }
  }
  return { assumptions: { minutesPerDay, stageMin, fullClear, difficulty: 'story', energyMax: ENERGY.max,
    notes: ['한 영웅 Lv1부터 첫 클리어 순서, 모든 방 처치·항상 승리', 'RPG 처치 XP는 즉시 지급, 클리어 XP만 권장 레벨 보정',
      '일반방 정예 35%는 기댓값, 소환수·무리 졸개 XP 0, 수동 골드 훈련 제외', '하루 한 세션, 밤사이 에너지 100 회복·전투 중 자연 회복, 추가 구매 없음'] },
    chapters, stages, totalCombatExp, totalStageExp };
}

if (import.meta.main) {
  const report = progressionEstimate();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('스토리 첫 클리어 · 하루 30분 · 판당 3분 · 전 구역 정화 · 에너지 상한 포함');
    console.table(report.chapters);
    console.log(report.assumptions.notes.join('\n'));
  }
}
