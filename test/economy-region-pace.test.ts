import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { lootTable, recommendedLevel, levelExperienceMultiplier } from '../src/data/loot-tables.js';
import { DIFFICULTY_ORDER, DIFFICULTIES, applyDifficulty } from '../src/game/difficulty.js';
import { stageDef, ENEMIES } from '../src/data/stages.js';
import { MATERIALS } from '../src/data/expansion.js';
import { levelExp } from '../src/data/heroes.js';
import { Economy } from '../src/game/economy.js';
import { DropSystem } from '../src/game/drops.js';
import { Battle } from '../src/game/battle.js';
import { Floor } from '../src/game/world.js';
import { monsterXp } from '../src/game/rpg-core.js';
import { lootReport } from '../tools/loot-report.mjs';
import { progressionEstimate } from '../tools/progression-estimate.mjs';
import { perRun } from '../tools/economy-estimate.mjs';

const epics = (t: ReturnType<typeof lootTable>) => t.gearWeights.E + t.gearWeights.U + t.gearWeights.L;
const materials = (t: ReturnType<typeof lootTable>) => t.materials.reduce((n: number, m: any) => n + m.n * m.chance, 0);

test('전 장·계급·난이도에서 E 이상 확률·재료 수량이 단조 증가하며 두 인자 호출은 스토리다', () => {
  for (const rank of ['normal', 'elite', 'boss']) for (let ch = 1; ch <= 6; ch++) {
    expect(lootTable(ch, rank)).toBe(lootTable(ch, rank, 'story'));
    for (const [d, difficulty] of DIFFICULTY_ORDER.entries()) {
      const t = lootTable(ch, rank, difficulty);
      expect((Object.values(t.gearWeights) as number[]).reduce((n, w) => n + w, 0)).toBeCloseTo(100, 8);
      expect(materials(t)).toBeGreaterThan(0);
      for (const m of t.materials) { expect(MATERIALS.some(x => x.id === m.id)).toBe(true); expect(Number.isInteger(m.n)).toBe(true); }
      if (ch > 1) {
        expect(epics(t)).toBeGreaterThanOrEqual(epics(lootTable(ch - 1, rank, difficulty)));
        expect(materials(t)).toBeGreaterThanOrEqual(materials(lootTable(ch - 1, rank, difficulty)));
      }
      if (d > 0) {
        expect(epics(t)).toBeGreaterThanOrEqual(epics(lootTable(ch, rank, DIFFICULTY_ORDER[d - 1])));
        expect(materials(t)).toBeGreaterThan(materials(lootTable(ch, rank, DIFFICULTY_ORDER[d - 1])));
      }
      if (ch >= 4) {
        expect(t.materials).toHaveLength(2);
        expect(materials(t)).toBeGreaterThan(materials(lootTable(ch - 3, rank, difficulty)));
      }
    }
  }
  expect(lootTable(6, 'normal').gearWeights.N).toBe(10);
});

test('드랍 보고서 72행(4난이도×6지역×3등급)은 가치 0·완전 중복이 없으며 후반 재료가 실제 정련 가치로 반영된다', () => {
  const report = lootReport();
  expect(report.rows).toHaveLength(72);
  expect(report.zeroValue).toEqual([]); expect(report.duplicates).toEqual([]);
  for (const row of report.rows) {
    expect(row.goldEquivalent).toBeGreaterThan(row.gold);
    expect(Object.values(row.gearDistribution).reduce((n, p) => n + p, 0)).toBeCloseTo(1, 9);
    expect(row.gearCount).toBeGreaterThan(0);
  }
});

test('실제 onKill은 출격 스냅샷 난이도로 두 재료를 지급하고 소환수·무리 졸개는 제외한다', () => {
  for (const difficulty of Object.values(DIFFICULTIES)) {
    const stage = applyDifficulty(stageDef(6, 10), difficulty), spawned: any[] = [];
    const system: any = Object.create(DropSystem.prototype);
    Object.assign(system, { game: { stage, rollDrop: () => null, app: { eco: { beginFieldRewards: () => ({}) } } }, spawn: (...args: any[]) => spawned.push(args) });
    const enemy = { def: { gold: 20 }, pos: new THREE.Vector3(), isBoss: true };
    const random = Math.random; Math.random = () => .99;
    try {
      system.onKill(enemy, stage);
      expect(spawned.filter(x => x[1] === 'material').map(x => x[2])).toEqual(lootTable(6, 'boss', difficulty.id).materials.map((m: any) => ({ id: m.id, n: m.n })));
      const before = spawned.length;
      system.onKill({ ...enemy, packFollower: true }, stage); expect(spawned).toHaveLength(before);
      system.onKill({ ...enemy, summoned: true }, stage);
      expect(spawned.slice(before).some(x => ['heroShard', 'transcendStone', 'material'].includes(x[1]))).toBe(false);
    } finally { Math.random = random; }
  }
});

test('장 끝 도달 레벨과 다음 장 권장 차이는 -3~+1이며 하루 시간·에너지 한도를 지킨다', () => {
  const report = progressionEstimate();
  expect(report.chapters.map(c => c.level)).toEqual([20, 29, 35, 39, 42, 44]);
  for (const chapter of report.chapters.filter(c => c.gap !== null)) {
    expect(chapter.gap!).toBeGreaterThanOrEqual(-3); expect(chapter.gap!).toBeLessThanOrEqual(1);
    expect(chapter.nextRecommended).toBe(recommendedLevel(chapter.chapter + 1));
  }
  expect(report.stages).toHaveLength(60);
  for (const day of new Set(report.stages.map(s => s.day))) {
    const stages = report.stages.filter(s => s.day === day);
    expect(stages.length * 3).toBeLessThanOrEqual(30);
    expect(stages.reduce((n, s) => n + s.energy, 0)).toBeLessThanOrEqual(110);
  }
  expect(progressionEstimate({ minutesPerDay: 60 }).chapters.at(-1)!.day).toBeLessThanOrEqual(report.chapters.at(-1)!.day);
});

test('처치 XP는 실제 roster·monsterXp와 같고 정산 XP에만 마지막 레벨 보정을 적용한다', () => {
  const random = Math.random; Math.random = () => .99;
  try {
    const stage = stageDef(1, 1), floor = new Floor(stage.idx, stage.chapter.theme, undefined, stage.dungeon?.layout);
    const game = { stage, rosterSize: Battle.prototype.rosterSize };
    const mean = perRun(1).combatExp;
    let actual = 0;
    for (const room of floor.rooms) for (const id of Battle.prototype.roomRoster.call(game, room)) {
      const runtimeId = id === stage.encounter.enemyId ? stage.dungeonBossId || id : id;
      actual += monsterXp((ENEMIES as any)[runtimeId], stage.scale);
    }
    expect(mean).toBeGreaterThanOrEqual(actual);
    expect(mean - actual).toBeLessThan(300);
    // 서비스의 실제 정산으로 추정 공식의 보정 시점을 확인한다.
    const eco = Object.create(Economy.prototype);
    eco.s = Economy.prototype.fresh.call(eco); eco.listeners = []; eco.bonusReceipts = new WeakSet(); eco.save = () => true;
    const hero = eco.hero();
    Economy.prototype.addHeroExp.call(eco, 'knight', Math.floor(mean), { silent: true });
    const beforeLevel = hero.level;
    const receipt = eco.completeStage(stage, 3, { fullClear: true });
    expect(receipt.combatExp).toBe(0);
    expect(receipt.exp).toBe(Math.floor((stage.rewards.exp + Math.floor(stage.rewards.exp * .5)) * levelExperienceMultiplier(beforeLevel, recommendedLevel(1, 1))));
    expect(levelExp(20)).toBe(2321);
  } finally { Math.random = random; }
});
