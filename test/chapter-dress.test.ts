import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { CHAPTER_DRESS, chapterDressFor } from '../src/data/chapter-dress.js';
import { ENEMIES, CHAPTERS, stageDef } from '../src/data/stages.js';
import { attachDressProp, DRESS_PROP_KEYS, dressPropTriangles } from '../src/game/chapter-dress.js';
import { CHAPTER_GRADES, gradeAtmosphere, sceneryPlacements } from '../src/game/chapter-scenery.js';

test('1장 의상은 1장 로스터의 모든 잡몹·원거리·정예·보스를 덮고 존재하는 적·소품만 가리킨다', () => {
  const garden = CHAPTER_DRESS[1];
  for (const id of Object.keys(garden.species)) {
    if (!id.startsWith('garden_')) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
    for (const key of garden.species[id].props || []) expect(DRESS_PROP_KEYS).toContain(key);
  }
  for (const spec of Object.values(garden.assets)) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  // 처음 30분(1장 1~10관문) 로스터의 각 적이 종 표나 몸 표로 의상을 받는다.
  const def: any = stageDef(1, 1);
  const roster = typeof def.combatRosterFor === 'function' ? def.combatRosterFor() : null;
  const ids = roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : ['skel_minion', 'ghost', 'skel_mage'];
  for (const id of ids) expect(garden.species[id] || null, id).toBeTruthy();
});

test('2장 의상은 2장 로스터 전부와 중간·최종 보스를 덮는다', () => {
  const forge = CHAPTER_DRESS[2];
  for (const id of Object.keys(forge.species)) if (!id.startsWith('forge_')) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
  for (const spec of [...Object.values(forge.species), ...Object.values(forge.assets)]) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  const def: any = stageDef(2, 1);
  const roster = def.combatRosterFor?.();
  const ids = roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : [];
  // 화염 정령·독침벌(fire_phoenix 몸)은 이미 불새 실루엣이라 의상을 입히지 않는다.
  for (const id of ids) if (!['hywirl', 'armabee'].includes(id)) expect(forge.species[id], id).toBeTruthy();
});

test('3장 의상은 3장 로스터 전부와 중간·최종 보스를 덮는다', () => {
  const frost = CHAPTER_DRESS[3];
  for (const id of Object.keys(frost.species)) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
  for (const spec of [...Object.values(frost.species), ...Object.values(frost.assets)]) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  const def: any = stageDef(3, 1);
  const roster = def.combatRosterFor?.();
  for (const id of roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : []) expect(frost.species[id], id).toBeTruthy();
  // 2장 보스 id 도 실제 적 정의가 있어야 의상이 조용히 빠지지 않는다.
  expect((ENEMIES as Record<string, unknown>).forge_midboss).toBeTruthy();
  expect((ENEMIES as Record<string, unknown>).forge_finalboss).toBeTruthy();
});

test('4장 의상은 4장 로스터와 confluence 경로 적, 중간·최종 보스를 덮는다', () => {
  const deep = CHAPTER_DRESS[4];
  for (const id of Object.keys(deep.species)) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
  for (const spec of [...Object.values(deep.species), ...Object.values(deep.assets)]) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  const def: any = stageDef(4, 1);
  const roster = def.combatRosterFor?.();
  // 진화한 독침벌은 이미 불새 실루엣이라 몸 기준 색만 받는다.
  for (const id of roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : []) if (id !== 'armabee_evo') expect(deep.species[id], id).toBeTruthy();
});

test('5장 의상은 crown·tribunal 로스터와 중간·최종 보스를 덮는다', () => {
  const crown = CHAPTER_DRESS[5];
  for (const id of Object.keys(crown.species)) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
  for (const spec of [...Object.values(crown.species), ...Object.values(crown.assets)]) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  for (const st of [1, 3]) {
    const def: any = stageDef(5, st);
    const roster = def.combatRosterFor?.();
    // 화염 정령은 이미 불새 실루엣이라 몸 기준 색만 받는다.
    for (const id of roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : []) if (id !== 'hywirl') expect(crown.species[id], `${st}:${id}`).toBeTruthy();
  }
});

test('6장 잔향은 경로의 고향 장 의상에 귀환 청록 발광을 덧입히고 보스는 직접 정한다', () => {
  // procession(1장 고향)·kiln(2장 고향) 경로.
  const garden = chapterDressFor({ chapter: { id: 6 }, dungeon: { id: 'procession' } }, 'skel_minion', 'bone_knight')!;
  expect(garden.props).toEqual(CHAPTER_DRESS[1].species.skel_minion.props);
  expect(garden.emissive).toBe('#13403a');
  const forge = chapterDressFor({ chapter: { id: 6 }, dungeon: { id: 'kiln' } }, 'orc', 'goblin_brute')!;
  expect(forge.props).toEqual(CHAPTER_DRESS[2].species.orc.props);
  // 고향 장에 없는 종은 1~5장 중 먼저 찾은 의상.
  expect(chapterDressFor({ chapter: { id: 6 }, dungeon: { id: 'kiln' } }, 'squidle', 'star_owl')!.props).toEqual(CHAPTER_DRESS[4].species.squidle.props);
  expect(chapterDressFor({ chapter: { id: 6 }, dungeon: { id: 'kiln' } }, 'homecoming_finalboss', 'goblin_chief')!.props).toContain('brokenBellLarge');
  for (const id of Object.keys(CHAPTER_DRESS[6].species)) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
});

test('7장 의상은 종탑 로스터를 덮고 Tripo 전용 몸(종지기·오르벤·카델)은 비운다', () => {
  const bell = CHAPTER_DRESS[7];
  for (const id of Object.keys(bell.species)) expect((ENEMIES as Record<string, unknown>)[id], id).toBeTruthy();
  for (const spec of [...Object.values(bell.species), ...Object.values(bell.assets)]) for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  const def: any = stageDef(7, 1);
  const roster = def.combatRosterFor?.();
  for (const id of roster ? [...roster.trash, ...roster.ranged, ...roster.elite] : []) if (!['bell_ringer', 'bomb_slime'].includes(id)) expect(bell.species[id], id).toBeTruthy();
  expect(chapterDressFor({ chapter: { id: 7 } }, 'bell_ringer', 'tll_ch7_bellringer')).toBeNull();
});

test('의상은 캠페인 장에만 입히고 원정은 제외한다', () => {
  expect(chapterDressFor({ chapter: { id: 1 } }, 'skel_minion', 'bone_knight')?.props).toContain('coffin');
  expect(chapterDressFor({ chapter: { id: 1 }, expedition: { id: 'x' } }, 'skel_minion', 'bone_knight')).toBeNull();
  expect(chapterDressFor({ chapter: { id: 8 } }, 'skel_minion', 'bone_knight')).toBeNull();
  // 종 표에 없는 1장 경로 보스는 몸 기준 의상.
  expect(chapterDressFor({ chapter: { id: 1 } }, 'dungeon_tribunal_captain', 'ember_drake')).toBeTruthy();
  expect(CHAPTERS[0].theme).toBe('garden');
});

test('소품은 예산(소품당 1,200 삼각형) 안이고 뼈 휴식 행렬 기준으로 붙는다', () => {
  for (const key of DRESS_PROP_KEYS) expect(dressPropTriangles(key, 2.5), key).toBeLessThan(1200);
  const root = new THREE.Group(); root.scale.setScalar(0.4);
  const hips = new THREE.Bone(); hips.name = 'mixamorigHips'; hips.position.y = 1;
  const spine = new THREE.Bone(); spine.name = 'mixamorig:Spine2'; spine.position.y = .4; spine.rotation.x = .7; spine.scale.setScalar(100);
  hips.add(spine); root.add(hips); root.updateWorldMatrix(true, true);
  const socket = attachDressProp(root, 'coffin', 2.5)!;
  expect(socket).toBeTruthy();
  expect(socket.parent).toBe(spine);
  // 소켓 월드 축 = 모델 축(뼈 회전·cm 배율 상쇄), 위치 = 뼈 + at × 키.
  root.updateWorldMatrix(true, true);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  socket.matrixWorld.decompose(p, q, s);
  expect(s.x).toBeCloseTo(0.4 * 1.25, 4);
  expect(p.y).toBeCloseTo(0.4 * (1.4 + 0.02 * 2.5), 4);
  expect(p.z).toBeCloseTo(0.4 * (-0.12 * 2.5), 4);
  expect(attachDressProp(new THREE.Group(), 'coffin', 2)).toBeNull();
});

test('1장 대기 보정은 경로 색을 장 색 쪽으로 섞고 다른 장은 그대로 둔다', () => {
  const tribunal = { fog: 0x2a2139, bg: 0x171323, hemi: [0xd1b7d6, 0x342743], torch: 0xf5a2d4, tint: 0xd5c0d8 };
  const graded = gradeAtmosphere(tribunal, 1);
  expect(graded.fog).not.toBe(tribunal.fog);
  const g = new THREE.Color(graded.fog), target = new THREE.Color(CHAPTER_GRADES[1].fog), from = new THREE.Color(tribunal.fog);
  expect(Math.abs(g.g - target.g)).toBeLessThan(Math.abs(from.g - target.g));
  expect(gradeAtmosphere(tribunal, 7)).toBe(tribunal);
});

test('장 소품은 방 가장자리 띠에만, 문 근처를 비워 결정적으로 놓인다', () => {
  const floor = { seed: 7, rooms: [{ id: 0, x: 0, z: 0, w: 20, h: 16 }, { id: 1, x: 30, z: 0, w: 20, h: 16 }], gates: [{ x: 10, z: 0, w: 2, h: 8 }] };
  const a = sceneryPlacements(floor, 1), b = sceneryPlacements(floor, 1);
  expect(a).toEqual(b);
  const all = Object.values(a).flat();
  expect(all.length).toBeGreaterThan(6);
  for (const it of all) {
    const room = floor.rooms[it.room];
    const edge = Math.min(room.w / 2 - Math.abs(it.x - room.x), room.h / 2 - Math.abs(it.z - room.z));
    expect(edge).toBeGreaterThanOrEqual(.79);
    expect(edge).toBeLessThanOrEqual(1.81);
    expect(Math.abs(it.x - 10) < 3.2 && Math.abs(it.z) < 6.2).toBe(false);
  }
  expect(sceneryPlacements(floor, 8)).toEqual({});
});

test('도감은 1~4장 전용 종의 실제 출현 위치를 잡는다', async () => {
  const { buildCatalogue } = await import('../src/game/rpg-catalogue.js');
  const byId = new Map(buildCatalogue().map((e: any) => [e.id, e]));
  for (const id of ['ch1_coffinbearer', 'ch1_mourner', 'ch1_tombguard', 'ch1_mourner_wail', 'ch2_smith', 'ch2_emberimp', 'ch2_smith_line', 'ch2_emberimp_line', 'ch2_emberimp_bomb', 'ch1_mourner_dirge', 'ch1_hoodbearer', 'ch1_gravewisp', 'ch2_anvilguard', 'ch2_ashimp', 'ch3_censor', 'ch3_censor_slip', 'ch3_censor_tome', 'ch3_censor_quill', 'ch3_librarian', 'ch3_shelfguard', 'ch3_keykeeper', 'ch3_icecrawler', 'ch3_moldkeeper', 'ch4_drowned', 'ch4_drowned_line', 'ch4_drowned_anchor', 'ch4_drowned_coral', 'ch4_plankguard', 'ch4_deckhand', 'ch4_drowned_drift', 'ch4_lurer', 'ch4_lurer_bomb', 'ch4_lurer_seer', 'ch4_lurer_glim']) {
    const entry: any = byId.get(id);
    expect(entry, id).toBeTruthy();
    expect(entry.locations.length, id).toBeGreaterThan(0);
  }
});

test('1·2장 편성 밖에서 생기는 적(소환·정예 접두사)도 장 전용 종으로 바뀐다', async () => {
  const { chapterSpeciesId } = await import('../src/data/stages.js');
  expect(chapterSpeciesId({ chapter: { id: 1 } }, 'skel_minion')).toBe('ch1_coffinbearer');
  expect(chapterSpeciesId({ chapter: { id: 2 } }, 'orc')).toBe('ch2_smith');
  expect(chapterSpeciesId({ chapter: { id: 6 } }, 'skel_minion')).toBe('skel_minion');
  expect(chapterSpeciesId({ chapter: { id: 1 }, expedition: {} }, 'skel_minion')).toBe('skel_minion');
  expect(chapterSpeciesId({ chapter: { id: 1 } }, 'bone_orc')).toBe('bone_orc');
  // 3장: 서리 해골 사서·망령 검열관 갈래. 같은 종이 나오는 6·7장과 원정은 그대로다.
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'ghost')).toBe('ch3_censor');
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'skel_shield')).toBe('ch3_shelfguard');
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'bone_orc')).toBe('ch3_keykeeper');
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'golem_guard')).toBe('golem_guard');
  expect(chapterSpeciesId({ chapter: { id: 3 }, expedition: {} }, 'ghost')).toBe('ghost');
  expect(chapterSpeciesId({ chapter: { id: 6 } }, 'ghost')).toBe('ghost');
  expect(chapterSpeciesId({ chapter: { id: 7 } }, 'skel_shield')).toBe('skel_shield');
  // 4장: 따개비 수부·미끼등 아귀 갈래. 같은 종이 나오는 5장(왕관)·원정은 그대로, 진화한 독침벌은 옛 몸.
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'squidle')).toBe('ch4_drowned');
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'golem_guard')).toBe('ch4_plankguard');
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'abyss_seer')).toBe('ch4_lurer_seer');
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'armabee_evo')).toBe('armabee_evo');
  expect(chapterSpeciesId({ chapter: { id: 4 }, expedition: {} }, 'squidle')).toBe('squidle');
  expect(chapterSpeciesId({ chapter: { id: 5 } }, 'alien')).toBe('alien');
  expect(chapterSpeciesId({ chapter: { id: 5 } }, 'abyss_seer')).toBe('abyss_seer');
});

test('3장 중간 보스는 오르딘 몸, 3장 관문·보스 지원병은 검열관 몸으로 나온다', async () => {
  const { ENEMIES: E } = await import('../src/data/stages.js');
  const ENEMIES = E as Record<string, any>;
  expect(ENEMIES.frost_midboss.model).toBe('Ch3_Ordin');
  for (const rank of ['captain', 'warden', 'midboss', 'finalboss']) expect(ENEMIES[`frost_${rank}`].summon, rank).toBe('ch3_censor');
  // 원본 종 수치를 그대로 복사한다(보상·경제 불변).
  for (const [id, src] of [['ch3_censor', 'ghost'], ['ch3_shelfguard', 'skel_shield'], ['ch3_censor_tome', 'skel_mage'], ['ch3_icecrawler', 'frost_burrower']]) {
    expect(ENEMIES[id].hp, id).toBe(ENEMIES[src].hp);
    expect(ENEMIES[id].behavior, id).toBe(ENEMIES[src].behavior);
  }
});

test('4장 중간 보스는 마렌 몸, 4장 관문·보스 지원병은 수부 몸, 원령 자리 수부·아귀는 불투명이다', async () => {
  const { ENEMIES: E, CHAPTER_SPECIES, speciesSourceId } = await import('../src/data/stages.js');
  const ENEMIES = E as Record<string, any>;
  expect(ENEMIES.tide_midboss.model).toBe('Ch4_Maren');
  for (const rank of ['captain', 'warden', 'midboss', 'finalboss']) expect(ENEMIES[`tide_${rank}`].summon, rank).toBe('ch4_drowned');
  // 원본 종 수치·행동을 그대로 복사한다(보상·경제 불변). 색조만 경고등·빛주머니 아귀에서 바꾼다.
  for (const [src, id] of Object.entries(CHAPTER_SPECIES[4]) as [string, string][]) {
    expect(speciesSourceId(id), id).toBe(src);
    for (const k of ['hp', 'atk', 'spd', 'range', 'atkTime', 'exp', 'gold', 'scale', 'ranged', 'behavior', 'summon', 'armor', 'meleeRole']) expect(ENEMIES[id][k], `${id}.${k}`).toEqual(ENEMIES[src][k]);
    expect(ENEMIES[id].model, id).toMatch(/^Ch4_/);
  }
  expect(ENEMIES.ch4_drowned_drift.ghostly).toBeUndefined();
  expect(ENEMIES.ch4_lurer_glim.ghostly).toBeUndefined();
  expect(ENEMIES.ghost.ghostly).toBe(true);
  expect(ENEMIES.ghost_skull.ghostly).toBe(true);
  expect(ENEMIES.bomb_abyss.tint).toBe('#ff70ff');
});

test('4장 일반 방은 새 몸이 85% 이상이다(10방×16)', async () => {
  const { stageDef } = await import('../src/data/stages.js');
  const { composeRoom } = await import('../src/game/squads.js');
  for (let st = 1; st <= 10; st++) {
    const s: any = stageDef(4, st), R = s.combatRosterFor();
    let n = 0, fresh = 0;
    for (let room = 1; room <= 10; room++) for (const id of composeRoom(R, st, room, s.idx, 16).list) { n++; if (id.startsWith('ch4_')) fresh++; }
    expect(fresh / n, `4-${st}`).toBeGreaterThanOrEqual(0.85);
    // 보상 명단은 원래 종 그대로.
    for (const id of [...s.rosterFor().trash, ...s.rosterFor().ranged]) expect(id.startsWith('ch4_'), `4-${st} ${id}`).toBe(false);
  }
});
