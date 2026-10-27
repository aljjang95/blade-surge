import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CHAPTERS, ENEMIES, STAGES_PER_CHAPTER, stageDef } from '../src/data/stages.js';
import { CHAPTER_COUNT } from '../src/data/campaign-shape.js';
import { CHAPTER_SCENES, stageStory } from '../src/data/campaign-story.js';
import { CAMPAIGN_TOWNS, campaignTown, campaignTownMusic } from '../src/data/campaign-towns.js';
import { BOSS_ENCOUNTERS, BOSS_RANK_ENCOUNTERS, BOSS_SIGNATURES } from '../src/data/boss-encounters.js';
import { MONSTER_ROSTER } from '../src/data/monster-roster.js';
import { CAMPAIGN_MODELS } from '../src/data/encounter-models.js';
import { REGION_CUE_PLAN, TOWN_CUE_PLAN, BOSS_CUE_PLAN, MUSIC_TRACKS, musicForScene } from '../src/data/music.js';
import { lootTable, recommendedLevel } from '../src/data/loot-tables.js';
import { SEASON_START_MS, chapterOpenLabel } from '../src/data/chapter-open.js';
import { campaignStages } from '../src/game/stage-select-model.js';
import { BOSS_SIGNATURE_CAPACITY, planBossSignature } from '../src/game/boss-signatures.js';
import { hazardContains, hazardPattern } from '../src/game/region-hazards.js';
import { nextBossPattern } from '../src/game/enemies.js';
import { buildLobbyWorld } from '../src/game/lobby-world.js';
import { Floor } from '../src/game/world.js';
import { buildRegionArchitecture } from '../src/game/region-architecture.js';
import { STORY_DUNGEONS } from '../src/data/story-dungeons.js';
import { dungeonVisualFor } from '../src/data/dungeon-visuals.js';
import manifest from '../asset-library/manifest.json';

const enemies = ENEMIES as Record<string, any>;
const assets = new Set(manifest.assets.map((asset: any) => asset.id));
const stage7 = (st: number) => stageDef(7, st) as any;
const ROOM = { x: 40, z: -30, w: 28, h: 28 };

describe('7장 금 간 종탑의 도시: 데이터', () => {
  test('일곱 번째 지역이며 crypt 테마·belltower 조우 접두사·10관문 서사를 가진다', () => {
    expect(CHAPTER_COUNT).toBe(7);
    const chapter = CHAPTERS[6] as any;
    expect(chapter).toMatchObject({ id: 7, theme: 'crypt', encounterPrefix: 'belltower', boss: 'belltower_finalboss' });
    expect(CHAPTER_SCENES[6]).toHaveLength(STAGES_PER_CHAPTER);
    const titles = new Set<string>();
    for (let st = 1; st <= 10; st++) {
      const stage = stage7(st), story = stageStory(7, st);
      expect(stage.title).toBe(story.title);
      for (const text of [story.opening, story.revelation, story.aftermath]) expect(text.length).toBeGreaterThan(20);
      titles.add(stage.title);
    }
    expect(titles.size).toBe(10);
    expect(stage7(1).story.opening).toContain('종');
  });

  test('X-5 중간 보스·X-10 최종 보스·수문장 3·7, 6장 대비 권장 레벨 46→49 단조 증가', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(st => stage7(st).encounter.rank)).toEqual(
      ['captain', 'captain', 'warden', 'captain', 'midboss', 'captain', 'warden', 'captain', 'captain', 'finalboss']);
    expect(stage7(5).midboss).toBe(true);
    expect(stage7(10).regionBoss).toBe(true);
    expect(stage7(10).unlocksChapter).toBeNull();
    expect((stageDef(6, 10) as any).unlocksChapter).toBe(7);
    const levels = Array.from({ length: 10 }, (_, i) => stage7(i + 1).recommendedLevel);
    expect(levels[0]).toBe(46); expect(levels[9]).toBe(49);
    for (let i = 1; i < 10; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    expect(levels[0]).toBeGreaterThan((stageDef(6, 10) as any).recommendedLevel - 1);
    expect(recommendedLevel(7, 10)).toBe(49);
    // 6장 → 7장 경계에서 배율·체력·에너지가 줄지 않는다.
    expect(stage7(1).scale).toBeGreaterThan(stageDef(6, 10).scale);
    expect(stage7(1).energy).toBeGreaterThanOrEqual(stageDef(6, 10).energy);
    expect(stage7(1).recPower).toBeGreaterThan(stageDef(6, 10).recPower);
  });

  test('모든 관문은 종지기가 섞인 종탑 경로이며 관문 대장·수문장은 경로 보스 변형이다', () => {
    const routes = new Set<string>();
    for (let st = 1; st <= 10; st++) {
      const stage = stage7(st);
      routes.add(stage.dungeon.id);
      expect(['bellstreet', 'belfry', 'crackedNave']).toContain(stage.dungeon.id);
      expect(stage.dungeon.landmark).toBe('belltower');
      expect(stage.waves.flat()).toContain('bell_ringer');
      if (st === 5 || st === 10) expect(stage.dungeonBossId).toBeNull();
      else expect(stage.dungeonBossId).toBe(`dungeon_${stage.dungeon.id}_${stage.encounter.rank}`);
      expect(dungeonVisualFor(stage).key).toBe('belltower');
    }
    expect(routes.size).toBe(3);
    expect(stage7(1).dungeon.id).toBe('bellstreet');
    expect(stage7(10).dungeon.id).toBe('crackedNave');
  });

  test('중간·최종 보스는 스탯만 다른 리스킨이 아니라 고유 페이즈 3개와 종 기술을 가진다', () => {
    const mid = enemies.belltower_midboss, fin = enemies.belltower_finalboss, warden = enemies.belltower_warden;
    for (const def of [mid, fin, warden]) {
      expect(def.signatureBoss).toBe(true);
      expect(def.phasePatterns).toHaveLength(3);
      for (let phase = 0; phase < 3; phase++) expect(def.phasePatterns[phase].map((_: string, i: number) => nextBossPattern(def, i, phase))).toEqual(def.phasePatterns[phase]);
      expect(def.tactic.length).toBeGreaterThan(20);
    }
    expect(BOSS_ENCOUNTERS.belltower_finalboss.phases.flat().filter(k => k in BOSS_SIGNATURES)).toEqual(expect.arrayContaining(['bell_threefold', 'bell_crack']));
    expect(Object.keys(BOSS_RANK_ENCOUNTERS)).toEqual(['belltower_warden', 'belltower_midboss']);
    expect(mid.phasePatterns.flat()).toContain('bell_pair');
    expect(fin.phasePatterns.flat()).toContain('bell_threefold');
    expect(mid.phasePatterns.flat()).not.toContain('bell_threefold');   // 세 박자 종소리는 최종 보스만
    expect(fin.hp).toBeGreaterThan(mid.hp);
    expect(mid.name).toBe('종탑 수문 기사 오르벤'); expect(fin.name).toBe('금 간 대종의 주인 카델');
    // 다른 지역 보스의 기술 이름을 가져다 쓰지 않는다.
    for (const key of ['bell_pair', 'bell_threefold', 'bell_crack']) expect(BOSS_SIGNATURES[key as keyof typeof BOSS_SIGNATURES].cue.length).toBeGreaterThan(10);
  });

  test('장 상수: 드랍 표 7행, 개방 데이터, 마을 7번째는 종탑 도시', () => {
    expect(lootTable(7, 'boss').chapter).toBe(7);
    const boss6 = lootTable(6, 'boss'), boss7 = lootTable(7, 'boss');
    expect(boss7.goldMultiplier).toBeGreaterThan(boss6.goldMultiplier);
    expect(boss7.expMultiplier).toBeGreaterThan(boss6.expMultiplier);
    expect(boss7.stones).toBeGreaterThan(boss6.stones);
    expect(boss7.gearWeights.L).toBeGreaterThanOrEqual(boss6.gearWeights.L);
    expect(boss7.materials.length).toBeGreaterThanOrEqual(2);
    expect(CAMPAIGN_TOWNS).toHaveLength(7);
    expect(campaignTown(7)).toMatchObject({ id: 'bellspire', theme: 'crypt', scenery: 'belltower' });
  });
});

describe('7장: 종탑 보스 장판 (세 박자 종소리 → 겹치는 한가운데만 안전)', () => {
  const origin = { x: ROOM.x, z: ROOM.z - 6 }, target = { x: ROOM.x + 5, z: ROOM.z + 3 };
  const plan = (key: string, phase = 0, turn = 0) => planBossSignature(key, { room: ROOM, origin, target, phase, turn })!;
  const hitAt = (p: ReturnType<typeof plan>, x: number, z: number) => p.events.filter(e => hazardContains(e, x, z)).length;

  test('모든 종 기술은 예산(6) 안이고 모든 페이즈·회전에서 마지막 타격 뒤 반격 창이 있다', () => {
    for (const key of ['bell_pair', 'bell_threefold', 'bell_crack']) for (let phase = 0; phase < 3; phase++) for (let turn = 0; turn < 2; turn++) {
      const p = plan(key, phase, turn);
      expect(p.events.length).toBeGreaterThan(0); expect(p.events.length).toBeLessThanOrEqual(BOSS_SIGNATURE_CAPACITY);
      expect(p.duration).toBeGreaterThan(p.lastStrike);
      for (const e of p.events) { expect(e.warnAt).toBeLessThan(e.at); expect(e.at - e.warnAt).toBeGreaterThanOrEqual(0.9); }
    }
  });

  test('bell_threefold: 방 한가운데 안전 지대는 세 고리와 마지막 울림을 모두 비껴 가고, 그 밖은 어디든 맞는다', () => {
    for (let phase = 0; phase < 3; phase++) for (let turn = 0; turn < 2; turn++) {
      const p = plan('bell_threefold', phase, turn);
      expect(p.events.filter(e => e.type === 'ring')).toHaveLength(3);
      const last = p.events.at(-1)!;
      expect(last.type).toBe('disk'); expect(last.safeRadius).toBeGreaterThan(1.5);
      expect(last.at).toBeGreaterThan(Math.max(...p.events.filter(e => e.type === 'ring').map(e => e.at)));
      // 한가운데(안전 지대 안)는 어떤 박자에도 맞지 않는다.
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, -1], [1.5, -1.2]]) expect(hitAt(p, ROOM.x + dx, ROOM.z + dz)).toBe(0);
      // 안전 반경 밖 격자는 어느 한 박자에는 반드시 맞는다(고리 띠 또는 마지막 울림).
      for (let x = -12; x <= 12; x += 1.5) for (let z = -12; z <= 12; z += 1.5) {
        if (Math.hypot(x, z) <= last.safeRadius + .01) continue;
        expect(hitAt(p, ROOM.x + x, ROOM.z + z)).toBeGreaterThan(0);
      }
    }
  });

  test('bell_pair: 두 종 사이 한가운데는 어느 고리에도 맞지 않고 종마다 번갈아 울린다', () => {
    for (let phase = 0; phase < 3; phase++) {
      const p = plan('bell_pair', phase, 0);
      expect(hitAt(p, ROOM.x, ROOM.z)).toBe(0);
      expect(p.events.every(e => e.type === 'ring')).toBe(true);
      const centres = p.events.map(e => Math.round(e.x));
      for (let i = 1; i < centres.length; i++) expect(centres[i]).not.toBe(centres[i - 1]);   // 교대
      expect(new Set(centres).size).toBe(2);
    }
    expect(plan('bell_pair', 2).events.length).toBeGreaterThan(plan('bell_pair', 0).events.length);
  });

  test('bell_crack: 세 종을 잇는 균열선 세 줄이 차례로 갈라지고 삼각형 한가운데는 비어 있다', () => {
    const p = plan('bell_crack', 0, 0);
    expect(p.events.filter(e => e.type === 'lane')).toHaveLength(3);
    expect(hitAt(p, ROOM.x, ROOM.z)).toBe(0);
    const times = p.events.map(e => e.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(plan('bell_crack', 1).events.some(e => e.type === 'disk')).toBe(true);
  });
});

describe('7장: 시간 개방과 선택 화면', () => {
  const progress = { unlocked: 61, stars: { '6-10': 3 } };
  test('개방 전에는 진행도를 채워도 잠기고 문구는 개방 시각, 개방 뒤에는 열린다', () => {
    const before: any = campaignStages({ progress, chapter: 7, power: 0, heroLevel: 46, now: SEASON_START_MS - 1 });
    expect(before.stages.every((s: any) => !s.unlocked)).toBe(true);
    expect(before.stages[0].lockReason).toBe(`${chapterOpenLabel(7)} 개방`);
    expect(before.chapters[6]).toMatchObject({ id: 7, unlocked: false, lockReason: `${chapterOpenLabel(7)} 개방` });
    const after: any = campaignStages({ progress, chapter: 7, power: 0, heroLevel: 46, now: SEASON_START_MS });
    expect(after.stages[0].unlocked).toBe(true);
    expect(after.stages[1].unlocked).toBe(false);   // 진행도는 여전히 순서대로
    expect(after.stages[1].lockReason).toBe('7-1 클리어 시 해금');
    expect(after.chapters[6].unlocked).toBe(true);
  });
});

describe('7장: 지역 기믹·음악·마을·건축·자산 슬롯', () => {
  test('crypt 지역 기믹은 세 고리가 겹치는 한가운데를 비워 둔다', () => {
    const room = { x: 0, z: 0, w: 28, h: 28, type: 'boss' };
    for (let cycle = 0; cycle < 4; cycle++) {
      const pattern = hazardPattern('crypt', room, { x: 5, z: 5 }, cycle, true);
      expect(pattern).toHaveLength(3); expect(pattern.every(h => h.type === 'ring')).toBe(true);
      for (const [x, z] of [[0, 0], [.8, .8], [-1, .5]]) expect(pattern.some(h => hazardContains(h, x, z))).toBe(false);
      expect(pattern.some(h => hazardContains(h, 7.5, 0))).toBe(true);
    }
    expect(hazardPattern('crypt', room, { x: 0, z: 0 }, 0, false)).toHaveLength(2);
  });

  test('전용 곡이 없으면 서리 서고 곡으로 이어지고 TODO 전용 BGM 이 데이터에 남는다', () => {
    const stage = stageDef(7, 1);
    expect(musicForScene({ stage })).toBe('regions/frost');
    expect(musicForScene({ stage, boss: true })).toBe('regions/boss');
    expect(musicForScene({ stage: stageDef(7, 5), boss: true })).toBe('expansion/flow-combat');
    expect(musicForScene({ stage: JSON.parse(JSON.stringify(stage)) })).toBe('regions/frost');   // 복원된 객체도 같다
    expect(REGION_CUE_PLAN.find(c => c.region === 'belltower')).toMatchObject({ fallback: 'regions/frost', status: 'external-gui-pending', todo: '전용 BGM' });
    expect(TOWN_CUE_PLAN.find(c => c.chapter === 7)).toMatchObject({ town: 'bellspire', fallback: 'regions/frost', todo: '전용 BGM' });
    expect(BOSS_CUE_PLAN.filter(c => c.region === 'belltower').map(c => c.rank).sort()).toEqual(['finale', 'midboss']);
    expect(campaignTownMusic(7)).toBe('regions/frost');
    expect(MUSIC_TRACKS.every(track => !track.includes('belltower'))).toBe(true);   // 깨진 URL 이 없다
  });

  test('종탑 마을 풍경과 종탑 경로 건축이 예외 없이 만들어지고 정리된다', () => {
    const world = buildLobbyWorld({ quality: 'high', skin: campaignTown(7) });
    expect(world.userData.campaignChapter).toBe(7);
    let meshes = 0; world.traverse((node: any) => { if (node.isMesh || node.isPoints) meshes++; });
    expect(meshes).toBeGreaterThan(8); expect(meshes).toBeLessThan(140);
    world.userData.dispose(); world.userData.dispose();
    for (const id of ['bellstreet', 'belfry', 'crackedNave']) {
      const map = (STORY_DUNGEONS as any)[id];
      const floor = new Floor(61, 'crypt', undefined, map.layout);
      const group = buildRegionArchitecture(floor, 'crypt');
      expect(group.userData.landmarks.every((l: any) => l.kind === 'belltower')).toBe(true);
      expect(group.children.length).toBeGreaterThan(0);
      group.userData.dispose();
    }
  });

  test('Tripo 슬롯: asset 은 예정 키, fallback 은 이미 저장소에 있는 라이브러리 자산이다', () => {
    const slots: Record<string, string> = { Bell_Ringer: 'tll_ch7_bellringer', Bell_Warden: 'tll_ch7_midboss', Bell_Sovereign: 'tll_ch7_finalboss' };
    for (const [model, asset] of Object.entries(slots)) {
      const entry = (MONSTER_ROSTER as Record<string, any>)[model];
      expect(entry.asset).toBe(asset);
      expect(assets.has(entry.fallback), model).toBe(true);
      expect(assets.has(entry.asset)).toBe(false);   // 아직 수집 전. 수집되면 코드 변경 없이 이 키가 우선한다.
      expect(entry.scale).toBeGreaterThan(0);
    }
    expect((CAMPAIGN_MODELS as Record<string, string>).belltower_finalboss).toBe('Bell_Sovereign');
    expect(enemies.belltower_finalboss.model).toBe('Bell_Sovereign');
    expect(enemies.belltower_midboss.model).toBe('Bell_Warden');
    expect(enemies.bell_ringer.model).toBe('Bell_Ringer');
  });

  test('모든 7장 몬스터 모델은 로스터에 있고 관문 방마다 종지기 수가 과하지 않다', () => {
    for (let st = 1; st <= 10; st++) {
      const stage = stage7(st);
      for (const wave of stage.waves) {
        for (const id of wave) expect(MONSTER_ROSTER[enemies[id].model as keyof typeof MONSTER_ROSTER], id).toBeDefined();
        const ringers = wave.filter((id: string) => id === 'bell_ringer').length;
        expect(ringers).toBeGreaterThan(0); expect(ringers / wave.length).toBeLessThan(0.2);
      }
    }
  });

  test('THREE 은 이 테스트에서 월드를 만들 수 있다(환경 확인)', () => {
    expect(new THREE.Group().children).toHaveLength(0);
  });
});
