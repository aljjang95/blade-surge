import { expect, test } from 'bun:test';
import { DUNGEONS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { BOSS_SIGNATURES } from '../src/data/boss-encounters.js';
import { ENEMIES } from '../src/data/stages.js';
import { routeObjectiveForStage, ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';

// Independent accepted totals: [existing altar/route holds, additional waves].
// Astral choices have an independent four-confirmation contract below.
// A treasure room alone is not an altar, and reinforcement counts are per elite.
const contracts: Record<string, { standard: number[]; deep: number[] }> = {
  glass_garden: { standard: [1, 0], deep: [2, 0] },
  ember_vault: { standard: [0, 2], deep: [0, 2] },
  star_archive: { standard: [0, 0], deep: [2, 0] },
  bellfall_crypt: { standard: [3, 0], deep: [3, 2] },
  cinder_tide_lock: { standard: [2, 4], deep: [3, 4] },
  nightglass_observatory: { standard: [3, 0], deep: [5, 0] },
  eclipse_hydra_vault: { standard: [3, 0], deep: [0, 4] },
  ashforge_catacomb: { standard: [4, 0], deep: [0, 4] },
  astral_leviathan_spire: { standard: [0, 0], deep: [2, 2] },
  verdigris_sanctum: { standard: [3, 0], deep: [2, 4] },
  sable_mirage_basin: { standard: [3, 0], deep: [0, 4] },
  comet_bastion: { standard: [4, 0], deep: [5, 4] },
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
      const altarHolds = attunement && (!route || ('coexistAttunement' in route && route.coexistAttunement)) ? treasure : 0;
      const selectionRoute = !!route && 'kind' in route && route.kind === 'constellations';
      const holds = (selectionRoute ? 0 : route?.gates.length || 0) + altarHolds;
      const selections = selectionRoute ? route!.gates.length : 0;
      expect(selections).toBe(id === 'astral_leviathan_spire' && depth === 'standard' ? 4 : 0);
      expect([holds, elites * reinforcements]).toEqual(contract[depth]);
      expect(stage.objective).toBe(definition.objective);
      expect(stage.encounter.tactic).toBe(definition.tactic);
      if (depth === 'standard') expect(definition.stage.objective).toBe(definition.objective);

      // Parse the numerical promises instead of snapshotting complete sentences.
      const altarCount = stage.objective.match(/보물방\s*(\d+)곳/);
      expect(Number(altarCount?.[1] || 0)).toBe(altarHolds);
      if (id === 'cinder_tide_lock') {
        expect(Number(stage.objective.match(/냉각 밸브\s*(\d+)개/)?.[1])).toBe(holds);
        expect(stage.encounter.tactic).toMatch(/1\.4초 예고/);
        expect(stage.encounter.tactic).toMatch(/청록 조작판.*2초 유지/);
      } else if (id === 'nightglass_observatory') {
        expect(Number(stage.objective.match(/기록\s*(\d+)장/)?.[1])).toBe(3);
        expect(stage.encounter.tactic).toMatch(/적.*처치.*빛 안.*2초 유지/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(depth === 'deep' ? ['3번', '2번', '1번'] : ['1번', '2번', '3번']);
        if (depth === 'deep') expect(stage.objective).toMatch(/역순.*보물방 2곳/);
      } else if (id === 'astral_leviathan_spire' && depth === 'standard') {
        expect(Number(stage.objective.match(/별자리\s*(\d+)개/)?.[1])).toBe(4);
        expect(stage.encounter.tactic).toMatch(/모래시계 단서를 1초 읽고.*문자·도형 판에서 1초 유지/);
        expect(stage.encounter.tactic).toMatch(/오답.*판 밖.*재시도/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번', '4번']);
      } else if (id === 'verdigris_sanctum' && depth === 'standard') {
        expect(stage.objective).toMatch(/생명 제단 세 개/);
        expect(stage.encounter.tactic).toMatch(/적.*처치.*빛 안.*2초.*정화/);
        expect(stage.encounter.tactic).toMatch(/차례가 아닌.*1초.*포자/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
      } else if (id === 'ashforge_catacomb' && depth === 'standard') {
        expect(Number(stage.objective.match(/과열 용광로\s*(\d+)곳/)?.[1])).toBe(holds);
        expect(stage.encounter.tactic).toMatch(/1\.4초 예고/);
        expect(stage.encounter.tactic).toMatch(/청록 조작판.*2초 유지/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번', '4번']);
      } else if (id === 'eclipse_hydra_vault' && depth === 'standard') {
        expect(Number(stage.objective.match(/역류 밸브 (세|3) ?개/) ? 3 : 0)).toBe(holds);
        expect(stage.encounter.tactic).toMatch(/적.*처치.*빛 안.*2초.*잠그/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
      } else if (id === 'comet_bastion' && depth === 'standard') {
        expect(Number(stage.objective.match(/궤도 고리 (네|4) ?개/) ? 4 : 0)).toBe(holds);
        expect(stage.encounter.tactic).toMatch(/적.*처치.*룬석을 몸으로 밀어 별 표식/);
        expect(stage.encounter.tactic).toMatch(/안쪽이 안전.*중심 유성.*푸른 선 밖/);
        expect(stage.encounter.tactic).toMatch(/어느 순서/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번', '4번']);
      } else if (id === 'comet_bastion' && depth === 'deep') {
        // 공명 제단은 궤도 고리 5개로 교체됐다. 문구의 숫자는 정의(def)에서 읽어 맞춘다.
        const deep = route as typeof ROUTE_OBJECTIVES.comet_deep;
        expect(deep.kind).toBe('deep-orbits');
        expect('coexistAttunement' in deep).toBe(false);
        expect(deep.gates.map(g => g.roomId)).toEqual([1, 2, 3, 5, 7]);
        expect(Number(stage.objective.match(/궤도 고리 (\d+)곳/)?.[1])).toBe(holds);
        expect(stage.objective).toMatch(/정렬·쉼터 연결/);
        expect(stage.objective).not.toMatch(/공명|제단|보물방/);
        const tactic = stage.encounter.tactic;
        expect(Number(tactic.match(/붕괴 (\d+(?:\.\d+)?)초/)?.[1])).toBe(deep.collapseSeconds);
        expect(Number(tactic.match(/쉼터에 (\d+(?:\.\d+)?)초 머물러/)?.[1])).toBe(deep.connectSeconds);
        expect(tactic).toContain('유성 폭풍이 ' + ['한', '두', '세', '네'][deep.storm.shelters.length - 1] + ' 번');
        expect(tactic).toMatch(/붉은 원 안에서는 청록 빈 원만 안전/);
        expect(tactic).toMatch(/그 고리만 처음 위치/);
        expect(tactic).toMatch(/어느 순서/);
        // 보스 신호 문구(oath_shelter 의 '공명 속 빈 원')는 보스 전술 소유이므로 고리 안내 부분만 검사한다.
        expect(tactic.slice(0, tactic.indexOf((ENEMIES as Record<string, any>).comet_bastion.tactic))).not.toMatch(/공명|제단/);
        expect(tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번', '4번', '5번']);
      } else if (id === 'bellfall_crypt' && depth === 'deep') {
        // 공명 제단은 종문 3개로 교체됐다. 문구의 숫자는 정의(def)에서 읽어 맞춘다.
        const deep = route as typeof ROUTE_OBJECTIVES.bellfall_deep;
        expect(deep.kind).toBe('reverse-bells');
        expect('coexistAttunement' in deep).toBe(false);
        expect(deep.gates.map(g => g.roomId)).toEqual([2, 3, 5]);
        expect(stage.objective).toMatch(/종문 3개 점등.*소등 순서의 역순으로 공명/);
        expect(stage.objective).not.toMatch(/보물방|제단/);
        const tactic = stage.encounter.tactic;
        expect(Number(tactic.match(/(\d+(?:\.\d+)?)초 뒤부터/)?.[1])).toBe(deep.toll.lead);
        expect(Number(tactic.match(/(\d+(?:\.\d+)?)초 간격/)?.[1])).toBe(deep.toll.gap);
        expect(Number(tactic.match(/반경 (\d+)/)?.[1])).toBe(deep.radius);
        expect(Number(tactic.match(/(\d+)초 머물러/)?.[1])).toBe(deep.holdSeconds);
        expect(Number(tactic.match(/(\d+)초를 채우면 불협/)?.[1])).toBe(deep.holdSeconds);
        // 불협 피해는 hurt 에 넘기는 최대 체력 비율이고 방어로 경감된다(리뷰 b04-review P1). 문구가 그 사실을 함께 적어야 한다.
        expect(Number(tactic.match(/최대 체력 (\d+)% 기준의 피해\(방어력으로 줄어듭니다\)/)?.[1])).toBe(Math.round(deep.discord.damage * 100));
        expect(Number(tactic.match(/불협 (\d+)회부터/)?.[1])).toBe(deep.guideAfter);
        expect(tactic).toMatch(/마지막에 꺼진 종부터 거꾸로/);
        expect(tactic).toMatch(/다시 켜져 소등을 처음부터/);
        // 보스 신호 문구('마지막 울림 뒤 반격')는 보스 전술 소유이므로 종문 안내 부분만 검사한다.
        expect(tactic.slice(0, tactic.indexOf((ENEMIES as Record<string, any>).glass_hour_sovereign.tactic))).not.toMatch(/공명 순서는 자유|마지막 울림|제단/);
        // 정답 순서는 문구에 쓰지 않는다. 종문 번호는 위치 안내(1번 → 2번 → 3번)로만 나온다.
        expect(tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
      } else if (id === 'sable_mirage_basin' && depth === 'standard') {
        expect(Number(stage.objective.match(/가짜 왕좌 (세|3) ?개/) ? 3 : 0)).toBe(holds);
        expect(stage.encounter.tactic).toMatch(/적.*처치.*보라 모래시계가 멈춘 동안.*다섯 차례 공격/);
        expect((route as any).hits).toBe(5);
        expect(stage.encounter.tactic).toMatch(/도는 동안.*반사/);
        expect(stage.encounter.tactic).toMatch(/어느 순서/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
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
        const checked = id === 'cinder_tide_lock' ? copy.replaceAll('밸브', '')
          : id === 'eclipse_hydra_vault' && depth === 'standard' ? copy.replaceAll('밸브', '')
          : id === 'verdigris_sanctum' && depth === 'standard' ? copy.replaceAll('생명 제단', '').replaceAll('포자가 터져', '')
          : id === 'sable_mirage_basin' && depth === 'standard' ? copy.replaceAll('가짜 왕좌', '왕좌')
          : id === 'comet_bastion' ? copy.replaceAll('궤도 고리', '고리').replaceAll('푸른 궤도선', '푸른 선')
          : id === 'nightglass_observatory' ? copy.replace(/기록\s*3장/g, '')
          : id === 'astral_leviathan_spire' && depth === 'standard' && selectionRoute
            ? copy.replaceAll('별자리 4개 순서대로 복원', '') : copy;
        expect(checked).not.toMatch(unsupportedInstructions);
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

test('standard bellfall promises three ordered gates, deep promises reverse-order bells instead of free altars', () => {
  const standard = buildExpeditionStage('dungeon', 'bellfall_crypt', null);
  const route = routeObjectiveForStage(standard)!;
  expect(route.gates.map(g => g.roomId)).toEqual([2, 3, 5]);
  expect((route as { holdSeconds?: number }).holdSeconds).toBe(2);
  expect((route as { radius?: number }).radius).toBe(3);
  expect(standard.objective).toMatch(/세 개의 종문.*순서/);
  expect(standard.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
  expect(standard.encounter.tactic).toMatch(/순서가 아닌 종문.*기다/);
  expect(standard.encounter.tactic).toMatch(/종문 3곳.*모든 구역.*봉인/);

  const deep = buildExpeditionStage('dungeon', 'bellfall_crypt', null, { depth: 'deep' });
  expect(routeObjectiveForStage(deep)).toBe(ROUTE_OBJECTIVES.bellfall_deep);
  expect(deep.objective).toMatch(/종문.*역순/);
  expect(deep.objective).not.toMatch(/보물방/);
  expect(deep.encounter.tactic).not.toMatch(/공명 순서는 자유/);
});

test('atmospheric descriptions do not retain removed interaction instructions', () => {
  for (const definition of [...DUNGEONS, ...EXPEDITION_DEPTHS]) {
    expect(definition.description).not.toMatch(/냉각선을 다시 잇|심장로를 식히|성좌를 다시 잇|궤도를 다시 맞추|진짜 왕좌를 찾아|본체를 드러내|고리가 무너지기 전에/);
  }
});

test('Astral exact implemented standard promise does not permit deep or unsupported star interactions', () => {
  const standard = buildExpeditionStage('dungeon', 'astral_leviathan_spire', null);
  expect(routeObjectiveForStage(standard)?.gates.map(g => g.roomId)).toEqual([1, 3, 4, 6]);
  const deep = buildExpeditionStage('dungeon', 'astral_leviathan_spire', null, { depth: 'deep' });
  expect(routeObjectiveForStage(deep)).toBeNull();
  expect(deep.objective).not.toMatch(/별자리|성좌/);
  // The shared rejection stays intact: only the exact standard promise is
  // stripped above. These fragments must still be rejected in every route.
  for (const copy of ['별자리 5개 복원', '성좌 4곳 복원', '별자리를 밟으세요', '별자리 파편을 모아 복원']) {
    expect(copy.replaceAll('별자리 4개 순서대로 복원', '')).toMatch(unsupportedInstructions);
  }
});
