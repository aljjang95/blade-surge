import { expect, test } from 'bun:test';
import { DUNGEONS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { BOSS_SIGNATURES } from '../src/data/boss-encounters.js';
import { ENEMIES } from '../src/data/stages.js';
import { routeObjectiveForStage } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';

// Independent accepted totals: [required holds, total additional enemy waves].
// A treasure room alone is not an altar, and reinforcement counts are per elite.
const contracts: Record<string, { standard: number[]; deep: number[] }> = {
  glass_garden: { standard: [1, 0], deep: [2, 0] },
  ember_vault: { standard: [0, 2], deep: [0, 2] },
  star_archive: { standard: [0, 0], deep: [2, 0] },
  bellfall_crypt: { standard: [3, 0], deep: [2, 2] },
  cinder_tide_lock: { standard: [2, 4], deep: [3, 4] },
  nightglass_observatory: { standard: [0, 0], deep: [2, 0] },
  eclipse_hydra_vault: { standard: [0, 0], deep: [0, 4] },
  ashforge_catacomb: { standard: [0, 0], deep: [0, 4] },
  astral_leviathan_spire: { standard: [0, 0], deep: [2, 2] },
  verdigris_sanctum: { standard: [0, 0], deep: [2, 4] },
  sable_mirage_basin: { standard: [0, 0], deep: [0, 4] },
  comet_bastion: { standard: [0, 0], deep: [2, 4] },
};

// Disallow the specific unsupported interactions, without freezing prose or
// rejecting narrative names such as a hydra's three heads or a ruined orbit.
const unsupportedInstructions = /밸브|냉각로|(?:기록|기록물)\s*(?:세|3)\s*장|(?:별자리|성좌).*(?:복원|밟)|가짜 왕좌.*(?:깨|파괴)|궤도 고리.*정렬|생명 제단|포자 폭발|(?:세|3) 머리.*(?:들리|고개)|발자국.*환영|보라색 모래시계|푸른 궤도선/;

test('all twelve exported dungeons have exactly one standard and one deep contract', () => {
  const ids = Object.keys(contracts).sort();
  expect(DUNGEONS.map(d => d.id).sort()).toEqual(ids);
  expect(EXPEDITION_DEPTHS.map(d => d.id).sort()).toEqual(ids);
  expect(EXPEDITION_DEPTHS.every(d => d.depth === 'deep')).toBe(true);
});

for (const [id, contract] of Object.entries(contracts)) {
  for (const depth of ['standard', 'deep'] as const) {
    test(`${id}/${depth}: published instructions match playable holds, waves and boss cues`, () => {
      const definition: any = (depth === 'standard' ? DUNGEONS : EXPEDITION_DEPTHS).find(d => d.id === id);
      const stage = buildExpeditionStage('dungeon', id, null, { depth });
      const world = buildExpeditionWorld(stage);
      const route = routeObjectiveForStage(stage);
      const treasure = world.rooms.filter(r => r.type === 'treasure').length;
      const elites = world.rooms.filter(r => r.type === 'elite').length;
      const { attunement, reinforcements } = stage.expedition.mechanics;
      const holds = route ? route.gates.length : attunement ? treasure : 0;
      expect([holds, elites * reinforcements]).toEqual(contract[depth]);
      expect(stage.objective).toBe(definition.objective);
      expect(stage.encounter.tactic).toBe(definition.tactic);
      if (depth === 'standard') expect(definition.stage.objective).toBe(definition.objective);

      // Parse the numerical promises instead of snapshotting complete sentences.
      const altarCount = stage.objective.match(/보물방\s*(\d+)곳/);
      expect(Number(altarCount?.[1] || 0)).toBe(route ? 0 : holds);
      if (id === 'cinder_tide_lock') {
        expect(Number(stage.objective.match(/냉각 밸브\s*(\d+)개/)?.[1])).toBe(holds);
        expect(stage.encounter.tactic).toMatch(/1\.4초 예고/);
        expect(stage.encounter.tactic).toMatch(/청록 조작판.*2초 유지/);
      } else if (holds) {
        expect(stage.encounter.tactic).toMatch(/적.*처치.*중심.*2초.*공명/);
        if (!route) expect(stage.objective).toMatch(/2초\s*공명/);
      }
      if (!holds) expect(stage.objective).not.toMatch(/공명|제단/);
      const waves = stage.objective.match(/정예방\s*(\d+)곳의 증원 각\s*(\d+)회/);
      expect(Number(waves?.[1] || 0) * Number(waves?.[2] || 0)).toBe(contract[depth][1]);
      if (reinforcements) {
        expect(Number(waves?.[1])).toBe(elites);
        expect(Number(waves?.[2])).toBe(reinforcements);
      }
      expect(stage.objective).toMatch(/모든 구역.*정화/);
      expect(stage.objective).toMatch(/처치|쓰러뜨리/);
      for (const copy of [definition.objective, definition.tactic, stage.objective, stage.encounter.tactic]) {
        expect(id === 'cinder_tide_lock' ? copy.replaceAll('밸브', '') : copy).not.toMatch(unsupportedInstructions);
      }

      const enemy = (ENEMIES as Record<string, any>)[stage.encounter.enemyId];
      expect(stage.encounter.tactic).toContain(enemy.tactic);
      const signatures = BOSS_SIGNATURES as Record<string, { name: string; cue: string }>;
      const patterns = new Set<string>((enemy.phasePatterns || [enemy.pattern]).flat());
      for (const [key, signature] of Object.entries(signatures)) {
        if (patterns.has(key)) {
          expect(stage.encounter.tactic).toContain(signature.name);
          expect(stage.encounter.tactic).toContain(signature.cue);
        } else {
          expect(stage.encounter.tactic).not.toContain(signature.name);
        }
      }
    });
  }
}

test('standard bellfall promises three ordered gates, deep keeps two unordered treasure holds', () => {
  const standard = buildExpeditionStage('dungeon', 'bellfall_crypt', null);
  const route = routeObjectiveForStage(standard)!;
  expect(route.gates.map(g => g.roomId)).toEqual([2, 3, 5]);
  expect(route.holdSeconds).toBe(2);
  expect(route.radius).toBe(3);
  expect(standard.objective).toMatch(/세 개의 종문.*순서/);
  expect(standard.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
  expect(standard.encounter.tactic).toMatch(/순서가 아닌 종문.*기다/);
  expect(standard.encounter.tactic).toMatch(/종문 3곳.*모든 구역.*봉인/);

  const deep = buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' });
  expect(routeObjectiveForStage(deep)).toBeNull();
  expect(deep.objective).not.toMatch(/종문|역순/);
  expect(deep.encounter.tactic).toMatch(/공명 순서는 자유/);
});

test('atmospheric descriptions do not retain removed interaction instructions', () => {
  for (const definition of [...DUNGEONS, ...EXPEDITION_DEPTHS]) {
    expect(definition.description).not.toMatch(/냉각선을 다시 잇|심장로를 식히|성좌를 다시 잇|궤도를 다시 맞추|진짜 왕좌를 찾아|본체를 드러내|고리가 무너지기 전에/);
  }
});
