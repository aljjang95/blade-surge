import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ENCOUNTER_ART, MOB_ART, RIFT_ART, resolveEnemyPortrait } from '../src/data/encounter-art.js';
import { ENCOUNTER_MODELS, CAMPAIGN_MODELS } from '../src/data/encounter-models.js';
import { BOSS_SIGNATURES } from '../src/data/boss-encounters.js';
import { CHAPTERS, STAGES_PER_CHAPTER, ENEMIES, stageDef } from '../src/data/stages.js';
import { RIGS, rigOf } from '../src/data/rigs.js';
import { buildCatalogue } from '../src/game/rpg-catalogue.js';
import { Enemy } from '../src/game/enemies.js';
import { stageKeyArt } from '../src/ui/meta.js';
import { createPreviewEnemy } from '../src/ui/enemy-preview.js';
import { audio } from '../src/engine/audio.js';

const enemies = ENEMIES as Record<string, any>;
const sources: Record<string, string> = {
  procession: 'glass_hour_sovereign', greenhouse: 'verdigris_sentinel', tribunal: 'sable_mirage_empress', confluence: 'comet_bastion',
  kiln: 'cinder_chain_executor', uprising: 'ash_colossus', archive: 'nightglass_archivist', reverseRiver: 'astral_leviathan',
  beacon: 'obsidian_hydra', lostShip: 'obsidian_hydra', emptyThrones: 'sable_mirage_empress', addresses: 'comet_bastion',
};

test('all 60 campaign objectives, card/detail portraits and catalogue locations select the actual spawned boss', () => {
  const catalogue = buildCatalogue();
  for (const chapter of CHAPTERS) for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
    const stage = stageDef(chapter.id, st), id = stage.dungeonBossId || stage.encounter.enemyId;
    const actual = enemies[id], storyBoss = st === 5 || st === 10;
    const legacy = `${chapter.encounterPrefix || chapter.theme}_${stage.encounter.rank}`;
    const source = enemies[storyBoss ? legacy : sources[stage.dungeon.id]];
    expect(stage.encounter.enemyId).toBe(legacy); // Save and spawn-input compatibility.
    expect(stage.encounter.dungeonBossId).toBe(storyBoss ? null : id);
    if (storyBoss) expect(id).toBe(legacy); else expect(id).not.toBe(legacy);
    expect(stage.encounter.name).toBe(actual.name);
    expect(stage.objective).toBe(`${stage.dungeon.name}의 전투 방을 정리해 봉인을 해제하고 ${actual.name} 처치`);
    expect(actual.model).toBe(source.model);
    expect(actual.portrait).toBe(source.portrait);
    expect(stageKeyArt(stage)).toBe(actual.portrait);
    const roster = stage.rosterFor();
    const expected = [...new Set([...roster.trash, ...roster.ranged, ...roster.elite, id])].sort();
    const listed = catalogue.filter(entry => entry.locations.some((place: any) => place.code === stage.code)).map(entry => entry.id).sort();
    expect(listed).toEqual(expected);
    if (!storyBoss) expect(catalogue.find(entry => entry.id === legacy)?.locations).toEqual([]);
  }
  expect(stageKeyArt({ encounter: { enemyId: 'garden_finalboss' } })).toBe(ENCOUNTER_ART.garden_finalboss);
  expect(stageKeyArt({ dungeonBossId: 'missing', encounter: { enemyId: 'garden_finalboss' } })).toBeNull();
});

test('named midpoint and finale bosses preserve the approved narrative, original portraits and dedicated finale rigs', () => {
  for (const chapter of CHAPTERS) for (const st of [5, 10]) {
    const stage = stageDef(chapter.id, st), id = stage.encounter.enemyId, def = enemies[id];
    expect(stage.dungeonBossId).toBeNull();
    expect(stage.encounter.name).toBe(def.name);
    expect(stageKeyArt(stage)).toBe(ENCOUNTER_ART[id]);
    if (st === 10) expect(def.model).toBe((CAMPAIGN_MODELS as Record<string, string>)[id]);
  }
  expect(stageDef(1, 5)).toMatchObject({ title: '애도의 기사', encounter: { name: '애도의 기사 세렌' } });
  expect(stageDef(1, 10)).toMatchObject({ title: '종왕 에일른', encounter: { name: '종왕 에일른' } });
  expect(stageDef(1, 5).story.opening).toContain('세렌');
  expect(stageDef(1, 10).story.aftermath).toContain('에일른');
});

test('dungeon variant advice and phase hints describe only their real signature attacks', () => {
  for (const id of new Set(Object.values(sources))) {
    const def = enemies[id];
    const signatures = [...new Set<string>(def.phasePatterns.flat())].filter(key => Object.hasOwn(BOSS_SIGNATURES, key));
    expect(signatures.length).toBeGreaterThan(0);
    for (const key of signatures) {
      const signature = BOSS_SIGNATURES[key as keyof typeof BOSS_SIGNATURES];
      expect(def.tactic).toContain(signature.name);
      expect(def.tactic).toContain(signature.cue);
    }
    expect(def.tactic).not.toMatch(/제단|포자|밸브|모래 발자국|세 머리|냉각로를 활성화/);
    for (const [phase, hint] of (def.phaseHints as string[]).entries()) {
      const actual = [...new Set<string>(def.phasePatterns[phase])].filter(key => Object.hasOwn(BOSS_SIGNATURES, key));
      expect(hint).toBe(actual.map(key => `${BOSS_SIGNATURES[key as keyof typeof BOSS_SIGNATURES].name}: ${BOSS_SIGNATURES[key as keyof typeof BOSS_SIGNATURES].cue}`).join(' · '));
    }
  }
  for (const chapter of CHAPTERS) for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
    const stage = stageDef(chapter.id, st);
    if (stage.dungeonBossId) expect(stage.encounter.tactic).toBe(enemies[sources[stage.dungeon.id]].tactic);
  }
});

test('portraits only use authored identity bindings and all referenced image/model assets ship', () => {
  const art = new Set([...Object.values(ENCOUNTER_ART), ...Object.values(MOB_ART), ...Object.values(RIFT_ART)]);
  for (const path of art) {
    const bytes = readFileSync(new URL(`../public${path}`, import.meta.url));
    expect(bytes.byteLength).toBeGreaterThan(10000);
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
  }
  for (const [id, def] of Object.entries(enemies)) {
    if (def.portrait) expect(art.has(def.portrait)).toBe(true);
    else expect(resolveEnemyPortrait(id, def)).toBeNull();
    const variant = (ENCOUNTER_MODELS as Record<string, { base: string, file: string }>)[def.model];
    expect(existsSync(new URL(`../public/models/${variant?.base || def.model}.glb`, import.meta.url))).toBe(true);
    if (variant) expect(existsSync(new URL(`../public/models/tll/encounters/${variant.file}.glb`, import.meta.url))).toBe(true);
  }
  for (const id of ['skel_minion', 'ghost', 'orc', 'elite_skel_captain']) {
    expect(enemies[id].portrait).toBeUndefined();
    expect(resolveEnemyPortrait(id, enemies[id])).toBeNull();
  }
  for (const model of new Set(Object.values(enemies).map(def => def.model))) {
    expect(resolveEnemyPortrait('unknown', { model })).toBeNull();
  }
  expect(resolveEnemyPortrait('unknown', {})).toBeNull();
  expect(resolveEnemyPortrait('bell_wisp', {})).toBe(MOB_ART.bell_wisp);
});

function visualFixture() {
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#ddd3ab' });
  const weaponMaterial = new THREE.MeshStandardMaterial({ color: '#aaaaaa' });
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const root = new THREE.Group(), body = new THREE.Mesh(geometry, bodyMaterial); body.name = 'Body'; root.add(body);
  const right = new THREE.Bone(), left = new THREE.Bone(); right.name = 'handslotr'; left.name = 'handslotl'; root.add(right, left);
  const weapons = new THREE.Group();
  for (const name of ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Shield_Large_A']) {
    const part = new THREE.Mesh(geometry, weaponMaterial); part.name = name; weapons.add(part);
  }
  const animations = ['Idle', 'Idle_Combat', 'Flying_Idle'].map(name => new THREE.AnimationClip(name, 1, []));
  return { gltf: { scene: root, animations }, weapons: { scene: weapons }, bodyMaterial, weaponMaterial, geometry };
}

test('preview uses real Enemy visuals, including weapons, ghost/elite treatment and rig scale, without consuming source resources', () => {
  for (const id of ['skel_minion', 'skel_rogue', 'ghost', 'elite_skel_captain', 'dungeon_procession_finalboss']) {
    const def = enemies[id], f = visualFixture(), scene = new THREE.Scene();
    const enabled = audio.enabled;
    let sourceDisposals = 0, instanceDisposals = 0;
    for (const source of [f.bodyMaterial, f.weaponMaterial, f.geometry]) source.addEventListener('dispose', () => sourceDisposals++);
    const enemy = createPreviewEnemy(scene, f.gltf, f.weapons, def);
    expect(enemy).toBeInstanceOf(Enemy);
    expect(audio.enabled).toBe(enabled);
    expect(enemy.def).toBe(def);
    expect(enemy.root.parent).toBe(scene);
    expect(enemy.spawning).toBe(false);
    expect(enemy.model.scale.x).toBeCloseTo(def.scale * RIGS[rigOf(def.model)].scale);
    expect(enemy.pos.y).toBe(RIGS[rigOf(def.model)].hover);
    if (def.weapon) expect(enemy.node('handslot.r')?.getObjectByName(def.weapon)).toBeDefined();
    if (def.shield) expect(enemy.node('handslot.l')?.getObjectByName(def.shield)).toBeDefined();
    if (id === 'skel_rogue') expect(enemy.node('handslot.l')?.getObjectByName('Skeleton_Blade')).toBeDefined();
    const instanceMaterials = new Set<THREE.Material>();
    enemy.model.traverse((node: any) => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        expect(material).not.toBe(f.bodyMaterial); expect(material).not.toBe(f.weaponMaterial);
        instanceMaterials.add(material);
      }
    });
    if (def.ghostly) expect((enemy.model.getObjectByName('Body') as THREE.Mesh).material).toMatchObject({ transparent: true, opacity: .8, depthWrite: false });
    for (const material of instanceMaterials) material.addEventListener('dispose', () => instanceDisposals++);
    enemy.dispose();
    expect(scene.children).toHaveLength(0);
    expect(sourceDisposals).toBe(0);
    expect(instanceDisposals).toBe(instanceMaterials.size);
    f.bodyMaterial.dispose(); f.weaponMaterial.dispose(); f.geometry.dispose();
  }
});
