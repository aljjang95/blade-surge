import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { CHAPTER_DRESS, chapterDressFor } from '../src/data/chapter-dress.js';
import { ENEMIES, CHAPTERS, CHAPTER_SPECIES, stageDef } from '../src/data/stages.js';
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
  // 6장(잔향 장)은 승객 갈래가 졸병 자리를 맡는다(아래 6장 테스트).
  expect(chapterSpeciesId({ chapter: { id: 6 } }, 'skel_minion')).toBe('ch6_passenger');
  expect(chapterSpeciesId({ chapter: { id: 1 }, expedition: {} }, 'skel_minion')).toBe('skel_minion');
  expect(chapterSpeciesId({ chapter: { id: 1 } }, 'bone_orc')).toBe('bone_orc');
  // 3장: 서리 해골 사서·망령 검열관 갈래. 같은 종이 나오는 6장과 원정은 그대로, 7장은 7장 해골 시민 몸이다.
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'ghost')).toBe('ch3_censor');
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'skel_shield')).toBe('ch3_shelfguard');
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'bone_orc')).toBe('ch3_keykeeper');
  expect(chapterSpeciesId({ chapter: { id: 3 } }, 'golem_guard')).toBe('golem_guard');
  expect(chapterSpeciesId({ chapter: { id: 3 }, expedition: {} }, 'ghost')).toBe('ghost');
  expect(chapterSpeciesId({ chapter: { id: 6 } }, 'ghost')).toBe('ch6_passenger_drift');
  expect(chapterSpeciesId({ chapter: { id: 7 } }, 'skel_shield')).toBe('ch7_citizen_ledger');
  // 4장: 따개비 수부·미끼등 아귀 갈래. 같은 종이 나오는 5장(왕관)·원정은 그대로, 진화한 독침벌은 옛 몸.
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'squidle')).toBe('ch4_drowned');
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'golem_guard')).toBe('ch4_plankguard');
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'abyss_seer')).toBe('ch4_lurer_seer');
  expect(chapterSpeciesId({ chapter: { id: 4 } }, 'armabee_evo')).toBe('armabee_evo');
  expect(chapterSpeciesId({ chapter: { id: 4 }, expedition: {} }, 'squidle')).toBe('squidle');
  // 5장은 같은 종이 왕관 전용 몸(왕관 병사·왕관 고리 주술사)으로 바뀐다.
  expect(chapterSpeciesId({ chapter: { id: 5 } }, 'alien')).toBe('ch5_crownsoldier');
  expect(chapterSpeciesId({ chapter: { id: 5 } }, 'abyss_seer')).toBe('ch5_seer');
  // 부유 촉수는 5장 편성에 없고 왕관 고리 주술사가 소환한다 — 5장에서는 소환 갈래 몸으로 나온다(2026-10-29).
  expect(chapterSpeciesId({ chapter: { id: 5 } }, 'squidle')).toBe('ch5_dawnninja_called');
  expect(chapterSpeciesId({ chapter: { id: 5 }, expedition: {} }, 'ninja')).toBe('ninja');
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

test('5장 중간 보스는 아스텔 몸, 5장 관문·보스 지원병은 새벽 가면 닌자 몸, 갈래는 원본 수치를 그대로 복사한다', async () => {
  const { ENEMIES: E, CHAPTER_SPECIES, speciesSourceId } = await import('../src/data/stages.js');
  const ENEMIES = E as Record<string, any>;
  expect(ENEMIES.crown_midboss.model).toBe('Ch5_Astel');
  for (const rank of ['captain', 'warden', 'midboss', 'finalboss']) expect(ENEMIES[`crown_${rank}`].summon, rank).toBe('ch5_dawnninja');
  for (const [src, id] of Object.entries(CHAPTER_SPECIES[5]) as [string, string][]) {
    expect(speciesSourceId(id), id).toBe(src);
    for (const k of ['hp', 'atk', 'spd', 'range', 'atkTime', 'exp', 'gold', 'scale', 'ranged', 'behavior', 'summon', 'armor', 'meleeRole', 'dodge']) expect(ENEMIES[id][k], `${id}.${k}`).toEqual(ENEMIES[src][k]);
    expect(ENEMIES[id].model, id).toMatch(/^Ch5_/);
    expect(ENEMIES[id].ghostly, id).toBeUndefined();
  }
  // 분홍·연보라·살구 색조가 보라·금 몸을 탁하게 해 뺐다(원본은 그대로).
  for (const id of ['ch5_dawnninja_flare', 'ch5_seer', 'ch5_seer_herald']) expect(ENEMIES[id].tint, id).toBeUndefined();
  expect(ENEMIES.bomb_abyss.tint).toBe('#ff70ff');
  expect(ENEMIES.ch5_dawnninja.meleeRole).toBe('flanker');
});

test('5장 일반 방은 새 몸이 85% 이상이다(10방×16)', async () => {
  const { stageDef } = await import('../src/data/stages.js');
  const { composeRoom } = await import('../src/game/squads.js');
  for (let st = 1; st <= 10; st++) {
    const s: any = stageDef(5, st), R = s.combatRosterFor();
    let n = 0, fresh = 0;
    for (let room = 1; room <= 10; room++) for (const id of composeRoom(R, st, room, s.idx, 16).list) { n++; if (id.startsWith('ch5_')) fresh++; }
    expect(fresh / n, `5-${st}`).toBeGreaterThanOrEqual(0.85);
    for (const id of [...s.rosterFor().trash, ...s.rosterFor().ranged]) expect(id.startsWith('ch5_'), `5-${st} ${id}`).toBe(false);
  }
});

test('6장(잔향): 졸병 자리는 승객 갈래, 나머지는 경로 고향 장 몸의 잔향, 증인은 중간 보스', async () => {
  const { ENEMIES: E, CHAPTER_SPECIES, chapterSpeciesId, chapterSpeciesSwap, speciesSourceId, stageDef } = await import('../src/data/stages.js');
  const { composeRoom } = await import('../src/game/squads.js');
  const ENEMIES = E as Record<string, any>;
  expect(ENEMIES.homecoming_midboss.model).toBe('Ch6_Witness');
  for (const rank of ['captain', 'warden', 'midboss', 'finalboss']) expect(ENEMIES[`homecoming_${rank}`].summon, rank).toBe('ch6_passenger');
  for (const [src, id] of Object.entries(CHAPTER_SPECIES[6]) as [string, string][]) {
    expect(speciesSourceId(id), id).toBe(src);
    for (const k of ['hp', 'atk', 'spd', 'range', 'atkTime', 'exp', 'gold', 'scale', 'ranged', 'behavior', 'summon', 'armor', 'meleeRole', 'dodge']) expect(ENEMIES[id][k], `${id}.${k}`).toEqual(ENEMIES[src][k]);
    expect(ENEMIES[id].model, id).toMatch(/^Ch6_/);
  }
  expect(ENEMIES.ch6_passenger_drift.ghostly).toBeUndefined();
  expect(ENEMIES.ghost.ghostly).toBe(true);
  // 경로의 고향 장 몸(잔향): 귀항 등대(4장 고향)·용광로(2장 고향)·서고(3장 고향). 승객 갈래가 먼저다.
  expect(chapterSpeciesId({ chapter: { id: 6 }, dungeon: { id: 'beacon' } }, 'bomb_abyss')).toBe('ch4_lurer_bomb');
  expect(chapterSpeciesId({ chapter: { id: 6 }, dungeon: { id: 'beacon' } }, 'squidle')).toBe('ch6_passenger_tide');
  expect(chapterSpeciesId({ chapter: { id: 6 }, dungeon: { id: 'kiln' } }, 'ash_burrower')).toBe('ch2_ashimp');
  expect(chapterSpeciesId({ chapter: { id: 6 }, dungeon: { id: 'archive' } }, 'blob_green')).toBe('ch3_moldkeeper');
  expect(chapterSpeciesId({ chapter: { id: 6 }, dungeon: { id: 'procession' } }, 'skel_shield')).toBe('ch1_tombguard');
  expect(chapterSpeciesId({ chapter: { id: 6 }, dungeon: { id: 'procession' } }, 'hywirl')).toBe('hywirl');
  expect(chapterSpeciesId({ chapter: { id: 6 }, dungeon: { id: 'beacon' }, expedition: {} }, 'squidle')).toBe('squidle');
  // 다른 장은 경로와 무관하다.
  expect(chapterSpeciesSwap(4, 'kiln')).toBe(CHAPTER_SPECIES[4]);
  expect(chapterSpeciesSwap(7, 'belfry')).toBe(CHAPTER_SPECIES[7]);
  for (let st = 1; st <= 10; st++) {
    const s: any = stageDef(6, st), R = s.combatRosterFor();
    let n = 0, passenger = 0;
    for (let room = 1; room <= 10; room++) for (const id of composeRoom(R, st, room, s.idx, 16).list) { n++; if (id.startsWith('ch6_')) passenger++; }
    expect(passenger / n, `6-${st}`).toBeGreaterThanOrEqual(0.4);
    expect(passenger / n, `6-${st}`).toBeLessThanOrEqual(0.65);
    for (const id of [...s.rosterFor().trash, ...s.rosterFor().ranged]) expect(/^ch\d_/.test(id), `6-${st} ${id}`).toBe(false);
  }
});

test('6장 승객 갈래 의상은 귀환 청록 발광이고, 잔향 몸은 고향 장 의상을 잔향으로 입는다', () => {
  for (const id of Object.values(CHAPTER_SPECIES[6]) as string[]) {
    const spec = chapterDressFor({ chapter: { id: 6 }, dungeon: { id: 'beacon' } }, id, 'tll_ch6_passenger')!;
    expect(spec, id).toBe(CHAPTER_DRESS[6].species[id]);
    expect(spec.emissive, id).toBeTruthy();
    for (const key of spec.props || []) expect(DRESS_PROP_KEYS).toContain(key);
  }
  const echo = chapterDressFor({ chapter: { id: 6 }, dungeon: { id: 'beacon' } }, 'ch4_drowned_anchor', 'tll_ch4_drowned')!;
  expect(echo.props).toEqual(CHAPTER_DRESS[4].species.ch4_drowned_anchor.props);
  expect(echo.emissive).toBe('#13403a');
});

test('가독성 약한 갈래는 색만이 아니라 실루엣 소품으로 갈린다(4장 빛주머니·5장 견습·새벽불·6장 짐꾼·길 잃은 승객)', () => {
  const pick = (ch: number, id: string) => (CHAPTER_DRESS as any)[ch].species[id].props || [];
  expect(pick(4, 'ch4_lurer_seer')).toContain('glowPouchesLarge');
  expect(pick(5, 'ch5_dawnninja_squire')).toContain('squireBokken');
  expect(pick(5, 'ch5_seer_ember')).toContain('dawnBrazier');
  expect(pick(6, 'ch6_passenger_porter')).toContain('luggagePack');
  expect(pick(6, 'ch6_passenger_lost')).toContain('lostLantern');
  for (const key of ['glowPouchesLarge', 'squireBokken', 'dawnBrazier', 'luggagePack', 'lostLantern']) expect(DRESS_PROP_KEYS).toContain(key);
});

test('7장 관문·보스 지원병은 해골 시민 몸, 갈래는 원본 수치를 그대로 복사하고 종지기·보스 몸은 그대로다', async () => {
  const { ENEMIES: E, CHAPTER_SPECIES, speciesSourceId } = await import('../src/data/stages.js');
  const ENEMIES = E as Record<string, any>;
  for (const rank of ['captain', 'warden', 'midboss', 'finalboss']) expect(ENEMIES[`belltower_${rank}`].summon, rank).toBe('ch7_citizen');
  expect(ENEMIES.bell_ringer.model).toBe('Bell_Ringer');
  expect((CHAPTER_SPECIES[7] as Record<string, string>).bell_ringer).toBeUndefined();
  for (const [src, id] of Object.entries(CHAPTER_SPECIES[7]) as [string, string][]) {
    expect(speciesSourceId(id), id).toBe(src);
    for (const k of ['hp', 'atk', 'spd', 'range', 'atkTime', 'exp', 'gold', 'scale', 'visualScale', 'ranged', 'behavior', 'summon', 'armor', 'meleeRole', 'dodge']) expect(ENEMIES[id][k], `${id}.${k}`).toEqual(ENEMIES[src][k]);
    expect(ENEMIES[id].model, id).toMatch(/^Ch7_(Citizen|Tuner)/);
    expect(ENEMIES[id].ghostly, id).toBeUndefined();
  }
  // 해골 사제의 연두 색조는 황동 몸을 초록으로 물들여 뺐다(원본은 그대로).
  expect(ENEMIES.ch7_tuner_cantor.tint).toBeUndefined();
  expect(ENEMIES.skel_priest.tint).toBe('#b0ffc0');
  expect(ENEMIES.ch7_citizen_fuse.behavior).toBe('bomber');
});

test('7장 일반 방은 새 몸(종지기 포함)이 85% 이상이다(10방×16), 보상 명단은 그대로', async () => {
  const { stageDef } = await import('../src/data/stages.js');
  const { composeRoom } = await import('../src/game/squads.js');
  for (let st = 1; st <= 10; st++) {
    const s: any = stageDef(7, st), R = s.combatRosterFor();
    let n = 0, fresh = 0;
    for (let room = 1; room <= 10; room++) for (const id of composeRoom(R, st, room, s.idx, 16).list) { n++; if (id.startsWith('ch7_') || id === 'bell_ringer') fresh++; }
    expect(fresh / n, `7-${st}`).toBeGreaterThanOrEqual(0.85);
    for (const id of [...s.rosterFor().trash, ...s.rosterFor().ranged]) expect(id.startsWith('ch7_'), `7-${st} ${id}`).toBe(false);
  }
});

test('7장 Tripo 갈래 의상은 BRASS 재배치 없이 발광만, 손 소품과 겹치는 장식 소품은 없다', () => {
  for (const id of Object.values(CHAPTER_SPECIES[7]) as string[]) {
    const spec = chapterDressFor({ chapter: { id: 7 } }, id, 'tll_ch7_citizen')!;
    expect(spec, id).toBe(CHAPTER_DRESS[7].species[id]);
    expect(spec.emissive, id).toBeTruthy();
    expect(spec.remap, id).toBeUndefined();
    for (const key of spec.props || []) { expect(DRESS_PROP_KEYS).toContain(key); expect(['bellLedger', 'tuningFork', 'spiritBell'], `${id} ${key}`).not.toContain(key); }
  }
});

test('가독성 2차: 6장 서두르는·바닷길·이끼 승객, 7장 늦은·짐꾼·폭음 시민, 울림 잔향·떠도는 조율사는 저마다 다른 실루엣 소품을 가진다', async () => {
  const { MONSTER_ROSTER } = await import('../src/data/monster-roster.js');
  const pick = (ch: number, id: string): string[] => (CHAPTER_DRESS as any)[ch].species[id].props || [];
  const groups: [number, string[]][] = [
    [6, ['ch6_passenger', 'ch6_passenger_hurry', 'ch6_passenger_tide', 'ch6_passenger_moss', 'ch6_passenger_porter', 'ch6_passenger_lost']],
    [7, ['ch7_citizen_late', 'ch7_citizen_hauler', 'ch7_citizen_fuse']],
    [7, ['ch7_tuner_echo', 'ch7_tuner_drift']],
  ];
  const ROSTER = MONSTER_ROSTER as Record<string, any>;
  for (const [ch, ids] of groups) {
    // 같은 몸을 쓰는 갈래끼리 (소품 묶음 + 손 소켓) 윤곽 서명이 겹치지 않는다. 몸빛(color)은 서명에 넣지 않는다.
    const E = ENEMIES as Record<string, any>;
    const sign = (id: string) => { const r = ROSTER[E[id].model]; return JSON.stringify([[...pick(ch, id)].sort(), r.weapon?.asset || null, r.offhand?.asset || null]); };
    const signs = ids.map(sign);
    expect(new Set(signs).size, `${ch}장 ${ids.join(',')} ${signs.join(' ')}`).toBe(ids.length);
  }
  expect(pick(6, 'ch6_passenger_hurry')).toContain('hurryClock');
  expect(pick(6, 'ch6_passenger_tide')).toContain('tideOar');
  expect(pick(6, 'ch6_passenger_moss')).toContain('mossCap');
  expect(pick(7, 'ch7_citizen_late')).toContain('lateScarf');
  expect(ROSTER[(ENEMIES as Record<string, any>).ch7_citizen_late.model].weapon.asset).toBe('tll_ch1_handbell');
  expect(pick(7, 'ch7_citizen_hauler')).toContain('haulerRope');
  expect(pick(7, 'ch7_citizen_fuse')).toContain('fuseKeg');
  expect(pick(7, 'ch7_tuner_echo')).toContain('echoRings');
  expect(pick(7, 'ch7_tuner_drift')).toContain('driftChimes');
  for (const key of ['hurryClock', 'tideOar', 'mossCap', 'lateScarf', 'haulerRope', 'fuseKeg', 'echoRings', 'driftChimes']) {
    expect(DRESS_PROP_KEYS).toContain(key);
    expect(dressPropTriangles(key, 1.6), key).toBeLessThan(1200);
  }
});

test('6장 심층 원정(dungeon 없음)도 경로 고향 장 Tripo 몸과 6장 승객·의상으로 바뀐다, 다른 원정은 그대로', async () => {
  const { buildExpeditionStage } = await import('../src/game/expedition-combat.js');
  const { chapterSpeciesId, speciesSourceId, CHAPTER_SPECIES: SP } = await import('../src/data/stages.js');
  const { expeditionRoster } = await import('../src/game/expedition-combat.js');
  const deep: any = buildExpeditionStage('dungeon', 'star_archive', null, { depth: 'deep' });
  expect(deep.dungeon).toBeNull();
  expect(deep.chapter.id).toBe(6);
  // 6-10 경로(confluence → 4장 바닷길): 4장 아귀·수부와 6장 승객이 함께 나온다.
  const ids = new Set<string>();
  for (const type of ['normal', 'elite', 'treasure']) for (const id of expeditionRoster(deep, { type })) ids.add(chapterSpeciesId(deep, id));
  const fresh = [...ids].filter((id) => id !== speciesSourceId(id));
  expect(fresh.some((id) => id.startsWith('ch4_')), [...ids].join(',')).toBe(true);
  expect(fresh.some((id) => id.startsWith('ch6_')), [...ids].join(',')).toBe(true);
  expect(chapterSpeciesId(deep, 'squidle')).toBe(SP[6].squidle);
  expect(chapterSpeciesId(deep, 'glub')).toBe(SP[4].glub);
  // 보스(심층 전용 정의)는 바뀌지 않는다.
  expect(chapterSpeciesId(deep, deep.encounter.enemyId)).toBe(deep.encounter.enemyId);
  // 의상: 6장 승객은 6장 의상, 고향 장 몸은 4장 의상의 잔향.
  expect(chapterDressFor(deep, 'ch6_passenger_tide', 'tll_ch6_passenger')).toBe(CHAPTER_DRESS[6].species.ch6_passenger_tide);
  expect(chapterDressFor(deep, 'ch4_lurer', 'tll_ch4_lurer')!.emissive).toBe('#13403a');
  // 표준 원정·다른 장 심층은 그대로(전용 로스터·아트).
  const standard: any = buildExpeditionStage('dungeon', 'star_archive', null);
  expect(chapterSpeciesId(standard, 'squidle')).toBe('squidle');
  expect(chapterDressFor(standard, 'squidle', null)).toBeNull();
  const ember: any = buildExpeditionStage('dungeon', 'ember_vault', null, { depth: 'deep' });
  expect(chapterSpeciesId(ember, 'squidle')).toBe('squidle');
});

test('6장 심층 전술 공략의 표식 대상은 장 전용 몸으로 나와도 원래 종 id로 맞춘다', async () => {
  const { ConquestRun } = await import('../src/game/expedition-conquests.js');
  const { chapterSpeciesId } = await import('../src/data/stages.js');
  const proto: any = ConquestRun.prototype;
  const room = {}, ctx: any = { rooms: new Map([[room, { targetType: 'squidle', expected: 3, spawned: 0, deaths: 0, target: null, success: false }]]), def: { priority: 'first' } };
  const deep = { chapter: { id: 6 }, ch: 6, st: 10, dungeon: null, expedition: { kind: 'dungeon', id: 'star_archive', depth: 'deep' } };
  const swapped = chapterSpeciesId(deep, 'squidle');
  expect(swapped).not.toBe('squidle');
  expect(proto.enemyDefinition.call(ctx, swapped, { name: '승객' }, room).name).toContain('표식');
  const enemy: any = {};
  proto.spawn.call(ctx, enemy, swapped, room);
  expect(enemy.conquestTarget).toBe(true);
});

test('5장 법정 경로(와 모든 5장 관문)에는 옛 몸이 섞이지 않는다: 편성·던전 대장·주술사 소환까지 5장 몸', () => {
  const { chapterSpeciesId, speciesSourceId } = require('../src/data/stages.js');
  const E = ENEMIES as Record<string, any>;
  let tribunal = 0;
  for (let st = 1; st <= 10; st++) {
    const s: any = stageDef(5, st), R = s.combatRosterFor();
    if (s.dungeon.id === 'tribunal') tribunal++;
    const spawnable = new Set<string>([...R.trash, ...R.ranged]);
    for (const id of [...spawnable]) if (E[id].summon) spawnable.add(E[id].summon);
    for (const bossId of [s.encounter.enemyId, s.dungeonBossId].filter(Boolean)) spawnable.add(E[bossId].summon || 'skel_minion');
    for (const raw of spawnable) {
      const id = chapterSpeciesId(s, raw);
      expect(id !== speciesSourceId(id) && /^Ch5_/.test(E[id].model), `${s.code} ${s.dungeon.id} ${raw}→${id} ${E[id].model}`).toBe(true);
    }
    // 보상 명단은 그대로다.
    for (const id of [...s.rosterFor().trash, ...s.rosterFor().ranged, ...s.rosterFor().elite]) expect(id.startsWith('ch5_'), `${s.code} ${id}`).toBe(false);
  }
  expect(tribunal).toBeGreaterThanOrEqual(4);
  // 소환 갈래는 원본 수치 그대로(환영 사냥개의 보라 색조만 뺐다).
  expect(E.ch5_dawnninja_mirage.hp).toBe(E.mirage_hound.hp);
  expect(E.ch5_dawnninja_mirage.tint).toBeUndefined();
  expect(E.ch5_crownsoldier_levy.atk).toBe(E.orc_blob.atk);
});

test('1~4·6·7장 모든 관문·6장 심층 원정의 소환 졸병(연쇄 소환 포함)은 그 장 전용 몸으로 나온다', async () => {
  const { chapterSpeciesId, speciesSourceId, CHAPTER_SPECIES: SP } = await import('../src/data/stages.js');
  const { buildExpeditionStage, expeditionRoster } = await import('../src/game/expedition-combat.js');
  const { ALL_DUNGEONS } = await import('../src/data/expansion.js');
  const { EXPEDITION_ROUTES: ROUTES } = await import('../src/data/expedition-routes.js');
  const E = ENEMIES as Record<string, any>;
  // 잔향 장(6장)은 승객 갈래 또는 경로 고향 장 몸이면 된다.
  const bodyOk = (ch: number, model: string) => ch === 6 ? /^Ch[1-6]_/.test(model) : new RegExp(`^Ch${ch}_`).test(model);
  const check = (s: any, ch: number, starts: string[]) => {
    const q = [...starts], seen = new Set<string>();
    while (q.length) {
      const raw = q.shift()!;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const id = chapterSpeciesId(s, raw);
      if (E[id].summon) q.push(E[id].summon);
      expect(id !== speciesSourceId(id) && bodyOk(ch, E[id].model), `${s.code} ${s.dungeon?.id} ${raw}→${id} ${E[id].model}`).toBe(true);
      // 수치·행동은 원본 그대로(보상·경제 불변).
      for (const k of ['hp', 'atk', 'spd', 'range', 'exp', 'gold', 'scale', 'ranged', 'behavior', 'summon', 'meleeRole', 'dodge']) expect(E[id][k], `${id}.${k}`).toEqual(E[raw][k]);
    }
    return seen.size;
  };
  for (const ch of [1, 2, 3, 4, 6, 7]) for (let st = 1; st <= 10; st++) {
    const s: any = stageDef(ch, st), R = s.combatRosterFor();
    const starts = [s.encounter.enemyId, s.dungeonBossId].filter(Boolean).map((b: string) => E[b].summon || 'skel_minion');
    for (const id of [...R.trash, ...R.ranged, ...R.elite]) { const d = E[chapterSpeciesId(s, id)]; if (d.summon) starts.push(d.summon); }
    check(s, ch, starts);
    // 보상 명단은 원래 종 id 그대로다.
    for (const id of [...s.rosterFor().trash, ...s.rosterFor().ranged, ...s.rosterFor().elite]) expect(/^ch\d_/.test(id), `${s.code} ${id}`).toBe(false);
  }
  // 6장 심층 원정: 심층 보스(소환 유지)와 원정 명단의 주술사가 부르는 졸병.
  let deepRuns = 0;
  for (const d of [...(ALL_DUNGEONS as any[]), ...((ROUTES || []) as any[])]) {
    let deep: any;
    try { deep = buildExpeditionStage('dungeon', d.id, null, { depth: 'deep' }); } catch { continue; }
    if (deep.chapter?.id !== 6) continue;
    deepRuns++;
    const starts = deep.expeditionEnemy.summon ? [deep.expeditionEnemy.summon] : [];
    for (const type of ['normal', 'elite', 'treasure']) for (const id of expeditionRoster(deep, { type })) { const def = E[chapterSpeciesId(deep, id)]; if (def?.summon) starts.push(def.summon); }
    check(deep, 6, starts);
  }
  expect(deepRuns).toBeGreaterThan(0);
  // 대표 자리: 1-1 행렬 대장의 종의 잔영 → 종소리 원령, 2-1 용광로 → 사슬 방패 장인, 3-8 역류 → 성운 쪽지 검열관과 별자리 서가 사서.
  expect(chapterSpeciesId(stageDef(1, 1), 'bell_wisp')).toBe('ch1_mourner_bell');
  expect(chapterSpeciesId(stageDef(2, 1), 'chain_forger')).toBe('ch2_anvilguard_chain');
  expect(chapterSpeciesId(stageDef(3, 8), 'astral_orbitling')).toBe('ch3_shelfguard_star');
  // 6장 용광로 경로는 2장 몸의 잔향, 꼬마 오크만 승객 갈래.
  expect(chapterSpeciesId(stageDef(6, 2), 'chain_forger')).toBe(SP[2].chain_forger);
  expect(chapterSpeciesId(stageDef(6, 3), 'orc_blob')).toBe('ch6_passenger_stray');
  // 원정(표준)은 그대로다.
  expect(chapterSpeciesId(buildExpeditionStage('dungeon', 'star_archive', null), 'nightglass_page')).toBe('nightglass_page');
});

test('소환 전용 갈래는 도감에 싣지 않고 의상·색조·불투명 몸 규칙을 따른다', async () => {
  const { speciesSourceId } = await import('../src/data/stages.js');
  const E = ENEMIES as Record<string, any>;
  const summonOnly = ['ch1_mourner_bell', 'ch1_mourner_comet', 'ch1_mourner_night', 'ch1_hoodbearer_mirage', 'ch1_coffinbearer_moss', 'ch1_tombguard_frost',
    'ch2_emberimp_called', 'ch2_anvilguard_chain', 'ch2_emberimp_haze', 'ch2_smith_apprentice', 'ch2_emberimp_scribe', 'ch2_anvilguard_mirror', 'ch2_emberimp_spark', 'ch2_anvilguard_star',
    'ch3_censor_night', 'ch3_shelfguard_mirror', 'ch3_librarian_shade', 'ch3_censor_comet', 'ch3_censor_bell', 'ch3_censor_astral', 'ch3_shelfguard_star',
    'ch4_lurer_comet', 'ch4_lurer_night', 'ch4_plankguard_mirror', 'ch4_drowned_mist', 'ch6_passenger_stray'];
  for (const id of summonOnly) {
    const ch = Number(id[2]);
    expect(E[id].tint, id).toBeUndefined();
    expect(CHAPTER_DRESS[ch].species[id], id).toBeTruthy();
    for (const key of CHAPTER_DRESS[ch].species[id].props || []) expect(DRESS_PROP_KEYS).toContain(key);
    expect(chapterDressFor(stageDef(ch, 1), id, null), id).toBe(CHAPTER_DRESS[ch].species[id]);
    expect((CHAPTER_SPECIES as any)[ch][speciesSourceId(id)], id).toBe(id);
  }
  // 혼령 자리 임프·아귀·검열관은 불투명한 Tripo 몸이다(원본 혜성 불씨·밤유리 서기관은 그대로 반투명).
  for (const id of ['ch2_emberimp_spark', 'ch3_censor_comet', 'ch4_lurer_comet']) expect(E[id].ghostly, id).toBeUndefined();
  expect(E.comet_spark.ghostly).toBe(true);
  // 도감은 전투 편성에 나오는 id만 싣는다 — 소환 전용 갈래는 없다.
  const { CODEX, codexEnemyId } = await import('../src/data/lore.js');
  const codexIds = new Set(CODEX.map((entry: any) => codexEnemyId(entry)).filter(Boolean));
  for (const id of summonOnly) expect(codexIds.has(id), id).toBe(false);
  // 원래 종의 도감 항목은 그대로 남는다(소환 전용 원본은 원래도 없을 수 있어 편성 갈래로 확인).
  for (const id of ['skel_minion', 'ghost', 'orc', 'squidle']) expect(codexIds.has(id), id).toBe(true);
});
