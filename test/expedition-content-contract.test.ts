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
  ember_vault: { standard: [0, 2], deep: [3, 2] },
  star_archive: { standard: [0, 0], deep: [2, 0] },
  bellfall_crypt: { standard: [3, 0], deep: [3, 2] },
  cinder_tide_lock: { standard: [2, 4], deep: [3, 4] },
  nightglass_observatory: { standard: [3, 0], deep: [5, 0] },
  eclipse_hydra_vault: { standard: [3, 0], deep: [4, 4] },
  ashforge_catacomb: { standard: [4, 0], deep: [4, 4] },
  astral_leviathan_spire: { standard: [0, 0], deep: [2, 2] },
  verdigris_sanctum: { standard: [3, 0], deep: [2, 4] },
  sable_mirage_basin: { standard: [3, 0], deep: [4, 4] },
  comet_bastion: { standard: [4, 0], deep: [5, 4] },
};

// Disallow the specific unsupported interactions, without freezing prose or
// rejecting narrative names such as a hydra's three heads or a ruined orbit.
const unsupportedInstructions = /밸브|냉각로|(?:기록|기록물)\s*(?:세|3)\s*장|(?:별자리|성좌).*(?:복원|밟)|가짜 왕좌.*(?:깨|파괴)|궤도 고리.*정렬|생명 제단|포자 폭발|(?:세|3) 머리.*(?:들리|고개)|발자국.*환영|보라색 모래시계|푸른 궤도선/;

/** 혜성 기사단장 보스방 푸른 궤도선 문구: 숫자는 정의(route.boss)에서 읽어 맞추고, 보스 시그니처 안내보다 앞에 있다(BUNDLE-06). */
function expectCometBossCopy(tactic: string, boss: any) {
  expect(boss.enemy).toBe('comet_bastion');
  expect(Number(tactic.match(/보스방에는 푸른 궤도선이 그려집니다\. 기사단장이 공격하지 않는 틈에 (\d+(?:\.\d+)?)초 유성 예고/)?.[1])).toBe(boss.warning);
  expect(tactic).toContain(['첫', '두', '세', '네', '다섯'][boss.centerEvery - 1] + ' 번째마다 중심 유성이 선 안쪽을 덮으면');
  expect(Number(tactic.match(/최대 체력 (\d+)%\)/)?.[1])).toBe(Math.round(boss.damage * 100));
  expect(tactic).toMatch(/평소 유성은 푸른 선 바깥에 떨어지니 선 안쪽이 안전/);
  expect(tactic).toMatch(/중앙을 버리고 푸른 선 바깥으로 피하세요/);
  expect(tactic).toMatch(/유성 예고 동안 기사단장은 새 공격을 시작하지 않습니다/);
  expect(tactic.indexOf('보스방에는 푸른 궤도선이')).toBeGreaterThan(0);
  expect(tactic.indexOf('보스방에는 푸른 궤도선이')).toBeLessThan(tactic.indexOf((ENEMIES as Record<string, any>).comet_bastion.tactic));
}

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
      } else if (id === 'eclipse_hydra_vault' && depth === 'deep') {
        // 공명 제단이 없는 심층은 역류 밸브 4곳 봉인으로 바뀌었다. 문구의 숫자·순서는 정의(def)에서 읽어 맞춘다.
        const deep = route as typeof ROUTE_OBJECTIVES.eclipse_deep;
        expect(deep).toBe(ROUTE_OBJECTIVES.eclipse_deep);
        expect(deep.gates.map(g => g.roomId)).toEqual([2, 4, 7, 5]);
        expect('coexistAttunement' in deep).toBe(false);
        expect(Number(stage.objective.match(/역류 밸브 (\d+)곳을 순서대로 봉인/)?.[1])).toBe(holds);
        expect(stage.objective).not.toMatch(/공명|제단|보물방/);
        const tactic = stage.encounter.tactic;
        expect(tactic).toMatch(/적을 처치한 뒤\(정예방은 증원 2회까지\)/);
        expect(Number(tactic.match(/연속 (\d+(?:\.\d+)?)초간 밸브를 봉인/)?.[1])).toBe(deep.holdSeconds);
        expect(tactic).toMatch(/청록 빛 안/);
        // 번호는 1번부터 마지막 번호까지 순서대로 한 번 나오고, 마지막 밸브는 앞 번호로 가는 길에 먼저 지나쳐 기다린다.
        const steps = tactic.match(/\d번 → (?:\d번 → )*\d번/)![0];
        expect(steps).toBe(deep.gates.map((_, i) => (i + 1) + '번').join(' → '));
        expect(tactic).toContain(deep.gates.length + '번 밸브는 ' + (deep.gates.length - 1) + '번으로 가는 길에 먼저 지나치니 차례를 기다렸다가');
        expect(tactic).toMatch(/되돌아가 봉인하세요/);
        expect(tactic).toContain('밸브 ' + deep.gates.length + '곳과 모든 구역을 정화하면 보스 봉인이 풀립니다');
        // 밸브 안내는 보스 전술보다 앞에 있다.
        expect(tactic.indexOf('밸브')).toBeLessThan(tactic.indexOf((ENEMIES as Record<string, any>).obsidian_hydra.tactic));
      } else if (id === 'ashforge_catacomb' && depth === 'deep') {
        // 정예방 증원만 있던 심층은 심장로 4곳 냉각으로 바뀌었다. 문구의 숫자·번호 순서는 정의(def)에서 읽어 맞춘다.
        const deep = route as typeof ROUTE_OBJECTIVES.ashforge_deep;
        expect(deep).toBe(ROUTE_OBJECTIVES.ashforge_deep);
        expect(deep.gates.map(g => g.roomId)).toEqual([2, 4, 5, 7]);
        expect('coexistAttunement' in deep).toBe(false);
        expect(Number(stage.objective.match(/심장로 (\d+)곳을 망치 충격파 뒤 순서대로 냉각/)?.[1])).toBe(holds);
        expect(stage.objective).not.toMatch(/공명|제단|보물방/);
        const tactic = stage.encounter.tactic;
        expect(tactic).toMatch(/적을 처치한 뒤\(정예방은 증원 2회까지\)/);
        const steps = tactic.match(/\d번 → (?:\d번 → )*\d번/)![0];
        expect(steps).toBe(deep.gates.map((_, i) => (i + 1) + '번').join(' → '));
        expect(tactic.match(/\d번/g)).toEqual(deep.gates.map((_, i) => (i + 1) + '번'));
        expect(tactic).toMatch(/망치 충격파가 한 번 지나가면 조작판이 반대편으로 옮겨 가 열립니다/);
        expect(Number(tactic.match(/행동 없이 (\d+(?:\.\d+)?)초 유지/)?.[1])).toBe(deep.holdSeconds);
        expect(tactic).toMatch(/청록 조작판/);
        expect(tactic).toMatch(/사슬에 묶인 불씨가 풀려납니다/);
        expect(tactic).toMatch(/이탈·공격·회피·피격·일시정지하면 유지 시간이 초기화/);
        expect(tactic).toContain('심장로 ' + deep.gates.length + '곳과 모든 구역을 정화하면 보스 봉인이 풀립니다');
        // 심장로 안내는 보스 전술보다 앞에 있다.
        expect(tactic.indexOf('심장로')).toBeLessThan(tactic.indexOf((ENEMIES as Record<string, any>).ash_colossus.tactic));
      } else if (id === 'ember_vault' && depth === 'deep') {
        // 정예방 증원만 있던 심층은 냉각 밸브 3곳 개방으로 바뀌었다. 문구의 숫자·번호 순서는 정의(def)에서 읽어 맞춘다.
        const deep = route as typeof ROUTE_OBJECTIVES.ember_deep;
        expect(deep).toBe(ROUTE_OBJECTIVES.ember_deep);
        expect(deep.gates.map(g => g.roomId)).toEqual([2, 3, 4]);
        expect('coexistAttunement' in deep).toBe(false);
        expect(Number(stage.objective.match(/냉각 밸브 (\d+)곳을 밀물 뒤 순서대로 개방/)?.[1])).toBe(holds);
        expect(stage.objective).not.toMatch(/공명|제단|보물방/);
        expect(stage.objective).toMatch(/모든 구역 정화 → 선단 압류관 처치$/);
        const tactic = stage.encounter.tactic;
        const bossTactic = (ENEMIES as Record<string, any>).cinder_chain_executor.tactic as string;
        expect(tactic).toMatch(/적을 처치한 뒤\(정예방은 증원 1회까지\)/);
        const steps = tactic.match(/\d번 → (?:\d번 → )*\d번/)![0];
        expect(steps).toBe(deep.gates.map((_, i) => (i + 1) + '번').join(' → '));
        expect(tactic.match(/\d번/g)).toEqual(deep.gates.map((_, i) => (i + 1) + '번'));
        expect(tactic).toMatch(/밀물이 한 번 지나가면 조작판이 반대편으로 옮겨 가 열립니다/);
        expect(tactic).toMatch(/다음 밀물 경고 전까지/);
        expect(Number(tactic.match(/행동 없이 (\d+(?:\.\d+)?)초 유지/)?.[1])).toBe(deep.holdSeconds);
        expect(tactic).toMatch(/청록 조작판/);
        expect(tactic).toMatch(/파란 밀물 띠 안에 있으면 피해를 입습니다/);
        // 밀물 문구 안에 재벼림 심층의 망치 충격파 문구가 섞이지 않는다.
        expect(stage.objective + tactic.slice(0, tactic.indexOf(bossTactic))).not.toMatch(/망치|충격파|심장로|불씨/);
        // 냉각 밸브 안내는 보스 전술보다 앞에 있다.
        expect(tactic.indexOf('냉각 밸브')).toBeLessThan(tactic.indexOf(bossTactic));
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
        expectCometBossCopy(stage.encounter.tactic, (route as any).boss);
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
        expectCometBossCopy(tactic, (deep as any).boss);
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
        // 종문 안내 부분(보스 합창 장막 문장 앞까지)에는 제단·자유 순서 문구가 없다.
        const gateCopy = tactic.slice(0, tactic.indexOf('보스는 합창 장막'));
        expect(gateCopy.length).toBeGreaterThan(0);
        expect(gateCopy).not.toMatch(/공명 순서는 자유|마지막 울림|제단/);
        // 보스 합창 장막: 문구의 숫자는 counter 정의에서 읽어 맞추고, 원안 문구가 목표와 전술 양쪽에 있다.
        const counter = deep.counter;
        expect(Number(tactic.match(/받는 피해가 (\d+)% 줄어듭니다/)?.[1])).toBe(Math.round((1 - counter.veil) * 100));
        expect(Number(tactic.match(/마지막 울림 직후 (\d+(?:\.\d+)?)초 동안만 장막이 걷혀/)?.[1])).toBe(counter.window);
        expect(Number(tactic.match(/걷혀 (\d+(?:\.\d+)?)배 피해/)?.[1])).toBe(counter.open);
        expect(tactic).toMatch(/그 동안 보스는 새 공격을 시작하지 않습니다/);
        expect(tactic).toMatch(/삼중 조종은 기절·경직으로 끊기지 않으니/);
        expect(tactic.indexOf('보스는 합창 장막')).toBeLessThan(tactic.indexOf((ENEMIES as Record<string, any>).glass_hour_sovereign.tactic));
        expect(stage.objective).toMatch(/마지막 울림 직후 반격으로 멈춘 합창의 주권자 처치$/);
        // 정답 순서는 문구에 쓰지 않는다. 종문 번호는 위치 안내(1번 → 2번 → 3번)로만 나온다.
        expect(tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
      } else if (id === 'sable_mirage_basin' && depth === 'standard') {
        expect(Number(stage.objective.match(/가짜 왕좌 (세|3) ?개/) ? 3 : 0)).toBe(holds);
        expect(stage.encounter.tactic).toMatch(/적.*처치.*보라 모래시계가 멈춘 동안.*다섯 차례 공격/);
        expect((route as any).hits).toBe(5);
        expect(stage.encounter.tactic).toMatch(/도는 동안.*반사/);
        expect(stage.encounter.tactic).toMatch(/어느 순서/);
        expect(stage.encounter.tactic.match(/\d번/g)).toEqual(['1번', '2번', '3번']);
      } else if (id === 'sable_mirage_basin' && depth === 'deep') {
        // 정예방 증원만 있던 심층은 가짜 왕좌 4곳 파괴와 거울 미궁 탈출로 바뀌었다. 문구의 숫자는 정의(def)에서 읽어 맞춘다.
        const deep = route as typeof ROUTE_OBJECTIVES.sable_deep;
        expect(deep).toBe(ROUTE_OBJECTIVES.sable_deep);
        expect(deep.gates.map(g => g.roomId)).toEqual([2, 3, 5, 6]);
        expect('coexistAttunement' in deep).toBe(false);
        expect(Number(stage.objective.match(/가짜 왕좌 (\d+)곳 파괴/)?.[1])).toBe(holds);
        expect(stage.objective).not.toMatch(/공명|제단|보물방/);
        expect(stage.objective).toMatch(/모든 구역 정화 → 거울 미궁 탈출 → 환영 여왕 처치$/);
        const tactic = stage.encounter.tactic;
        expect(tactic).toMatch(/적을 처치한 뒤\(정예방은 증원 2회까지\)/);
        expect(Number(tactic.match(/멈춘 동안 왕좌를 (\d+)번 공격해/)?.[1])).toBe(deep.hits);
        expect(Number(tactic.match(/번 공격해 (\d+)곳을 모두 부수세요/)?.[1])).toBe(deep.gates.length);
        expect(tactic).toMatch(/도는 동안 때리면 모래가 반사됩니다/);
        expect(tactic).toContain('왕좌 ' + deep.gates.length + '곳과 모든 구역을 정화하면 거울 전당에 거울 두 개가 섭니다');
        expect(tactic).toMatch(/사라지는 모래 발자국과 멈춘 모래시계를 따라 제한 시간 안에 진짜 거울에 닿으면 보스 봉인이 풀립니다/);
        expect(tactic).toMatch(/환영 거울은 모래를 반사하고, 시간이 다 되면 거울이 무너져 피해를 입은 뒤 다시 시작합니다/);
        // 왕좌 번호 순서 안내는 없고(순서 자유), 숫자 번호는 균열 횟수와 같은 '5번'뿐이다.
        expect(tactic.match(/\d번/g)).toEqual([deep.hits + '번']);
        // 왕좌·거울 안내는 보스 전술보다 앞에 있다.
        expect(tactic.indexOf('거울 전당')).toBeLessThan(tactic.indexOf((ENEMIES as Record<string, any>).sable_mirage_empress.tactic));
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
          : id === 'eclipse_hydra_vault' ? copy.replaceAll('밸브', '')
          // 잿불금고 심층은 약속한 '냉각 밸브'만 면제한다. 그 밖의 '밸브'(냉각로·역류 밸브 등)는 계속 거른다.
          : id === 'ember_vault' && depth === 'deep' ? copy.replaceAll('냉각 밸브', '')
          : id === 'verdigris_sanctum' && depth === 'standard' ? copy.replaceAll('생명 제단', '').replaceAll('포자가 터져', '')
          : id === 'sable_mirage_basin' && depth === 'standard' ? copy.replaceAll('가짜 왕좌', '왕좌')
          // 심층은 약속한 거울 미궁 안내 문장 하나(발자국을 따라 진짜 거울로)만 면제하고 그 밖의 발자국·환영 안내는 계속 거른다.
          : id === 'sable_mirage_basin' && depth === 'deep'
            ? copy.replaceAll('가짜 왕좌', '왕좌').replaceAll('사라지는 모래 발자국과 멈춘 모래시계를 따라', '')
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

test('혜성 기사단장 전술(캠페인 공용)은 보스방 궤도선을 약속하지 않고 실제 시그니처 세 가지만 안내한다', () => {
  const tactic = (ENEMIES as Record<string, any>).comet_bastion.tactic as string;
  expect(tactic).not.toMatch(/푸른 궤도선|궤도선 안쪽/);
  // 궤도선·유성 규칙은 개인 기본 원정 일반·심층의 boss 정의가 있는 경로에서만 약속한다.
  for (const depth of ['standard', 'deep'] as const) {
    const stage = buildExpeditionStage('dungeon', 'comet_bastion', null, { depth });
    expect((routeObjectiveForStage(stage) as any).boss.enemy).toBe('comet_bastion');
    expect(stage.encounter.tactic).toContain(tactic);
  }
  for (const key of Object.keys(ROUTE_OBJECTIVES)) {
    if (key !== 'comet_standard' && key !== 'comet_deep') expect('boss' in (ROUTE_OBJECTIVES as Record<string, object>)[key]).toBe(false);
  }
});
