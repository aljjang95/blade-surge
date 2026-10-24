import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { createLootVisual } from '../src/game/loot-visual.js';
import { LootModelLibrary, LOOT_MODEL_SIZE, LOOT_RIM } from '../src/game/loot-models.js';
import { LootAuras, LOOT_AURA, LOOT_AURA_LITE } from '../src/game/loot-auras.js';
import { DropSystem } from '../src/game/drops.js';
import { ParticlePool } from '../src/engine/fx.js';
import { acquireItemGeometry, itemForgeCacheSize } from '../src/engine/item-forge.js';
import { armorStyle } from '../src/game/armor-appearance.js';
import { resolveItemForm, itemFormHeroIds } from '../src/ui/item-visual-forms.js';
import { ITEM_BY_ID as ITEMS, RARITIES } from '../src/data/items.js';
const ITEM_BY_ID: Record<string, any> = ITEMS;
import { projectSurfaceUV, surfaceRole, applyDungeonStoneDetail, applySurfaceDetail, SURFACE_TEXTURES } from '../src/engine/surface-textures.js';
import { mergeSkinned } from '../src/engine/assets.js';

const meshesOf = (root: THREE.Object3D) => { const list: THREE.Mesh[] = []; root.traverse((o: any) => { if (o.isMesh) list.push(o); }); return list; };
const never = () => new Promise<any>(() => {});

test('fallback slot shapes stay distinct, shared per slot and never cast shadows', () => {
  const materials = new Map(); const counts = new Set();
  for (const [id,slot] of [['w_iron','weapon'],['a_leather','armor'],['b_worn','boots'],['r_copper','ring']]) {
    // Catalogue IDs are asserted below; typo fallback must not hide a bad test.
    const a = createLootVisual({id,rarity:'N'},materials), b = createLootVisual({id,rarity:'N'},materials);
    expect(a.userData.lootSlot).toBe(slot);
    expect(a.children).toHaveLength(2);
    const m = a.children[0] as THREE.Mesh, n = b.children[0] as THREE.Mesh;
    expect(m.geometry).toBe(n.geometry); expect(m.material).toBe(n.material);
    expect(meshesOf(a).every(mesh => !mesh.castShadow)).toBe(true);
    expect(m.geometry.getAttribute('uv').count).toBe(m.geometry.getAttribute('position').count);
    const size = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3());
    expect(size.length()).toBeGreaterThan(.5); expect(size.length()).toBeLessThan(2);
    counts.add(m.geometry.getAttribute('position').count);
  }
  expect(counts.size).toBe(4); expect(materials.size).toBe(4);
});

test('field drops reuse the inventory 3D source of each item id and the battle hero form', () => {
  const library = new LootModelLibrary({ load: never });
  for (const [id, form] of [['w_iron', 'sword'], ['b_worn', 'boots'], ['r_copper', 'ring'], ['w_dragon', 'sword']]) {
    const def = ITEM_BY_ID[id], root = library.build({ id, rarity: def.rarity });
    expect(root.userData.lootSource).toBe('forge');
    // 인벤 3D 보기(buildGearModel)와 같은 공유 버퍼 그 자체다.
    const lease = acquireItemGeometry(form, def);
    try { expect(meshesOf(root).map(mesh => mesh.geometry)).toEqual([lease.geometry]); } finally { lease.release(); }
  }
  // 영웅 문맥: 궁수는 활, 마도사는 지팡이, 암살자 S 이상은 쌍단검 두 자루가 같은 형상을 나눠 쓴다.
  const forms = new Set();
  for (const heroId of itemFormHeroIds()) {
    const def = ITEM_BY_ID.w_flame, form = resolveItemForm(def, heroId), root = library.build({ id: def.id, rarity: 'E' }, { heroId });
    const lease = acquireItemGeometry(form.form, def), meshes = meshesOf(root);
    try {
      expect(meshes).toHaveLength(form.count);
      for (const mesh of meshes) expect(mesh.geometry).toBe(lease.geometry);
    } finally { lease.release(); }
    forms.add(form.form + 'x' + form.count);
  }
  expect([...forms].sort()).toEqual(['axex2', 'bowx1', 'daggerx2', 'staffx1', 'swordx1']);
  // 방어구: 실제 갑옷 파츠(armor-appearance)를 기사 기준으로 입힌 그 색 · 형상.
  const armor = library.build({ id: 'a_knight', rarity: 'E' }), style = armorStyle(ITEM_BY_ID.a_knight, 'knight');
  expect(armor.userData.lootSource).toBe('armor-rig');
  const colors = meshesOf(armor).map(mesh => (mesh.material as THREE.MeshStandardMaterial).color.getHex());
  expect(colors).toContain(style.body); expect(colors).toContain(style.trim);
  for (const mesh of meshesOf(armor)) { expect(mesh.geometry.getAttribute('skinIndex')).toBeUndefined(); expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(100); }
  library.dispose();
});

test('every catalogue drop builds shared, shadowless resources at a readable size', () => {
  const cached = itemForgeCacheSize(), library = new LootModelLibrary({ load: never });
  const sizes: Record<string, number[]> = {};
  for (const def of Object.values(ITEM_BY_ID) as any[]) {
    const a = library.build({ id: def.id, rarity: def.rarity }), b = library.build({ id: def.id, rarity: def.rarity });
    const ma = meshesOf(a), mb = meshesOf(b);
    expect(ma.length).toBeGreaterThan(0); expect(mb).toHaveLength(ma.length);
    ma.forEach((mesh, i) => {
      expect(mesh).not.toBe(mb[i]);
      expect(mesh.geometry).toBe(mb[i].geometry); expect(mesh.material).toBe(mb[i].material);
      expect(mesh.castShadow).toBe(false);
    });
    const size = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()).length();
    expect(size).toBeGreaterThan(.5); expect(size).toBeLessThan(2);
    expect(a.userData.lootRestY).toBeGreaterThan(.5);
    (sizes[a.userData.lootSource] ||= []).push(size);
  }
  // 병기고 24종만 비동기 원본을 기다리는 폴백이고 나머지는 모두 인벤 원본이다.
  expect(sizes.fallback).toHaveLength(Object.values(ITEM_BY_ID).filter((def: any) => def.modelNode).length);
  expect(sizes.forge.length + sizes['armor-rig'].length + sizes.fallback.length).toBe(Object.keys(ITEM_BY_ID).length);
  // 같은 id · 등급은 재질 하나, 등급이 다르면 윤곽광 유니폼이 다른 재질이고 형상은 같다.
  const n = meshesOf(library.build({ id: 'w_iron', rarity: 'N' }))[0], l = meshesOf(library.build({ id: 'w_iron', rarity: 'L' }))[0];
  expect(n.geometry).toBe(l.geometry); expect(n.material).not.toBe(l.material);
  const key = (n.material as THREE.Material).customProgramCacheKey();
  expect(key).toContain('loot-rim-v1'); expect(key).toContain('character-bloom-v1');
  expect(key).toBe((l.material as THREE.Material).customProgramCacheKey());
  expect(LOOT_MODEL_SIZE.weapon).toBeLessThan(2);
  const rims = RARITIES.map(rarity => LOOT_RIM[rarity as keyof typeof LOOT_RIM][0]);
  expect(rims).toEqual([...rims].sort((x, y) => x - y));
  // 라이브러리를 버리면 인벤과 함께 쓰던 대장간 공유 버퍼 임대도 모두 돌아간다.
  expect(itemForgeCacheSize()).toBeGreaterThan(cached);
  library.dispose(); expect(itemForgeCacheSize()).toBe(cached);
});

test('armory GLB drops show the slot fallback, then swap to the shared original after a prepared load', async () => {
  const geometry = new THREE.BoxGeometry(.3, 1.2, .1), material = new THREE.MeshStandardMaterial({ vertexColors: true });
  let resolve!: (value: any) => void;
  const loaded = new Promise(r => { resolve = r; }), urls: string[] = [];
  const library = new LootModelLibrary({ load: (url: string) => { urls.push(url); return loaded; } });
  const prepared: THREE.Object3D[] = [];
  const kept = library.build({ id: 'arm_aegis_weapon', rarity: 'U' }, { prepare: (object: THREE.Object3D) => { prepared.push(object); } });
  const picked = library.build({ id: 'arm_aegis_weapon', rarity: 'U' });
  expect(kept.userData.lootSource).toBe('fallback'); expect(kept.userData.lootPendingSource).toBe('armory-glb');
  expect(urls).toEqual(['/models/armory-v1/' + ITEM_BY_ID.arm_aegis_weapon.modelNode + '.glb']);
  delete picked.userData.lootPendingSource;   // 주운 드랍(drops._remove)과 같은 취소
  const scene = new THREE.Group(); scene.add(new THREE.Mesh(geometry, material)); resolve({ scene });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  expect(prepared).toHaveLength(1);
  expect(kept.userData.lootSource).toBe('armory-glb');
  expect(meshesOf(kept).map(mesh => mesh.geometry)).toEqual([geometry]);
  expect(meshesOf(kept).every(mesh => !mesh.castShadow && mesh.material !== material)).toBe(true);
  expect(picked.userData.lootSource).toBe('fallback');
  // 이후 드랍은 곧바로 원본을 쓰고 같은 재질을 공유한다.
  const next = library.build({ id: 'arm_aegis_weapon', rarity: 'U' });
  expect(next.userData.lootSource).toBe('armory-glb');
  expect(meshesOf(next)[0].material).toBe(meshesOf(kept)[0].material);
  // 모르는 id 는 기본 슬롯 형상이다.
  expect(library.build({ id: 'no_such_item', rarity: 'N' }).userData.lootSource).toBe('fallback');
  library.dispose(); material.dispose();
});

test('rarity auras share two instanced draws and scale from a faint N ring to a tall L beam', () => {
  const auras = new LootAuras({ capacity: 8 }), scene = new THREE.Scene();
  auras.attach(scene);
  expect(scene.children).toHaveLength(0);
  const slots = RARITIES.map(rarity => auras.acquire(rarity));
  slots.forEach((slot, i) => auras.set(slot, RARITIES[i], i, 0, 1, 1, 1));
  auras.update(1 / 60);
  expect(scene.children).toEqual([auras.ground, auras.beam]);
  expect(auras.ground.isInstancedMesh && auras.beam.isInstancedMesh).toBe(true);
  expect(auras.ground.count).toBe(5); expect(auras.beam.count).toBe(5);
  expect(auras.beamParams.getX(slots[0])).toBe(0);   // N: 기둥 없음
  const heights = ['S', 'E', 'U', 'L'].map(rarity => LOOT_AURA[rarity as keyof typeof LOOT_AURA].beam![0]);
  expect(heights).toEqual([...heights].sort((x, y) => x - y));
  const radii = RARITIES.map(rarity => LOOT_AURA[rarity as keyof typeof LOOT_AURA].ground[0]);
  expect(radii).toEqual([...radii].sort((x, y) => x - y));
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
  auras.beam.getMatrixAt(slots[4], matrix); scale.setFromMatrixScale(matrix);
  expect(scale.y).toBeCloseTo(LOOT_AURA.L.beam![0]);
  auras.setLite(true); auras.set(slots[4], 'L', 4, 0, 1, 1, 1);
  auras.beam.getMatrixAt(slots[4], matrix); scale.setFromMatrixScale(matrix);
  expect(scale.y).toBeCloseTo(LOOT_AURA.L.beam![0] * LOOT_AURA_LITE.height);
  // 반납한 슬롯은 다시 쓰이고, 모두 반납하면 장면에서 떨어진다.
  auras.release(slots[2]); expect(auras.acquire('E')).toBe(slots[2]);
  auras.clear();
  expect(scene.children).toHaveLength(0); expect(auras.ground.count).toBe(0);
  expect(auras.ground.material).toBe(auras.groundMaterial); expect(auras.beam.material).toBe(auras.beamMaterial);
  expect(auras.texture.image.width).toBe(32); expect(auras.texture.image.height).toBe(128);
});

test('drop lifecycle: deterministic landing, sparkles and pickup without Math.random in the frame loop', () => {
  const run = () => {
    const scene = new THREE.Scene(), emits: number[][] = [], picked: string[] = [];
    const fx = { lite: false, glow: { emitIfFree: (...args: any[]) => (emits.push(args.slice(0, 6).map(Number)), true) }, groundTex() {}, holyBurst() {}, burst() {}, light() {}, ring() {}, pillar() {} };
    const system: any = Object.create(DropSystem.prototype);
    const game = { stage: {}, scene, heroId: 'ranger', player: { alive: true, pos: new THREE.Vector3(40, 0, 40) }, fx,
      renderer: { camera: new THREE.PerspectiveCamera(), flashScreen() {} },
      ui: { lootPopup(def: any) { picked.push(def.id); }, flyReward() {} }, rollDrop() { return null; } };
    Object.assign(system, { game, scene, items: [], magnetR: 4.2, pickR: 1.1, _matCache: {} });
    system.clear(); system.setup(null);
    RARITIES.forEach((rarity, i) => system.spawn(new THREE.Vector3(i * 3, 0, 0), 'item', { id: ['w_iron', 'w_steel', 'w_flame', 'w_storm', 'w_dragon'][i], rarity }, { spread: 0 }));
    // 튀어오름 궤적은 기존처럼 게임 난수(앱은 시드 고정)로 정해진다. 두 실행의 시작 궤적을 같게 맞춘다.
    for (const it of system.items) { it.mesh.position.y = .8; it.vy = 5; it.spin = 2; it.mesh.rotation.set(0, 0, 0); }
    const random = Math.random;
    Math.random = () => { throw new Error('frame loop used Math.random'); };
    try {
      for (let frame = 0; frame < 180; frame++) system.update(1 / 60);
      const items = system.items as any[];
      expect(items.every(it => it.state === 'idle' && it.land > .5)).toBe(true);
      expect(items.every(it => it.mesh.scale.x === 1 && it.mesh.scale.y === 1)).toBe(true);
      for (const it of items) for (const mesh of meshesOf(it.mesh)) expect(mesh.castShadow).toBe(false);
      expect(items.map(it => it.mesh.userData.lootSource)).toEqual(['forge', 'forge', 'forge', 'forge', 'forge']);
      expect(system.auras.used).toBe(5); expect(scene.children).toContain(system.auras.ground);
      const state = system.auras.groundState;
      expect(items.map(it => state.getY(it.aura))).toEqual([1, 1, 1, 1, 1]);
      // 반짝임: N 없음, 등급이 높을수록 자주
      const near = (x: number) => emits.filter(e => Math.abs(e[0] - x) < 1).length;
      expect(near(0)).toBe(0); expect(near(3)).toBeLessThan(near(6)); expect(near(6)).toBeLessThan(near(12));
      game.player.pos.set(6, 0, 0);
      for (let frame = 0; frame < 120; frame++) system.update(1 / 60);
    } finally { Math.random = random; }
    game.player.pos.set(3, 0, 0); for (let frame = 0; frame < 60; frame++) system.update(1 / 60);
    game.player.pos.set(0, 0, 0); for (let frame = 0; frame < 60; frame++) system.update(1 / 60);
    game.player.pos.set(9, 0, 0); for (let frame = 0; frame < 60; frame++) system.update(1 / 60);
    game.player.pos.set(12, 0, 0); for (let frame = 0; frame < 60; frame++) system.update(1 / 60);
    expect(system.items).toHaveLength(0); expect(system.auras.used).toBe(0);
    expect(scene.children).toHaveLength(0);
    system.lootModels.dispose();
    return { emits, picked };
  };
  const first = run(), second = run();
  expect(first.picked.sort()).toEqual(['w_dragon', 'w_flame', 'w_iron', 'w_steel', 'w_storm']);
  expect(second.emits).toEqual(first.emits);
});

test('bind-pose UV and GUI material maps preserve face/skin colors and texture ownership', () => {
  const geometry = projectSurfaceUV(new THREE.BoxGeometry(1,2,1));
  expect(Array.from(geometry.attributes.uv.array).every(Number.isFinite)).toBe(true);
  expect(surfaceRole('Warm porcelain')).toBe('skin'); expect(surfaceRole('Woven mantle')).toBe('cloth');
  const texture = new THREE.Texture(); SURFACE_TEXTURES['hero-weave'] = texture;
  const cloth = new THREE.MeshStandardMaterial({color:0x337788}); const original = cloth.color.getHex();
  applySurfaceDetail(cloth, 'cloth'); expect(cloth.bumpMap).toBe(texture); expect(cloth.map).toBe(texture);
  expect(cloth.roughnessMap).toBeNull();
  expect(cloth.color.getHex()).toBe(original);
  const skin = new THREE.MeshStandardMaterial(); applySurfaceDetail(skin,'skin'); expect(skin.bumpMap).toBeNull();
  let disposed = false; texture.addEventListener('dispose',()=>{disposed=true;}); cloth.dispose(); expect(disposed).toBe(false);
  delete SURFACE_TEXTURES['hero-weave']; geometry.dispose(); skin.dispose(); texture.dispose();
});



test('CC0 dungeon stone owns PBR bindings without transferring shared texture ownership', () => {
  const diffuse = new THREE.Texture(), normal = new THREE.Texture(), roughness = new THREE.Texture();
  SURFACE_TEXTURES['dungeon-stone-diffuse'] = diffuse; SURFACE_TEXTURES['dungeon-stone-normal'] = normal; SURFACE_TEXTURES['dungeon-stone-roughness'] = roughness;
  const material = new THREE.MeshStandardMaterial({ color: 0x8e98ae }); const color = material.color.getHex();
  applyDungeonStoneDetail(material);
  expect(material.map).toBe(diffuse); expect(material.normalMap).toBe(normal); expect(material.roughnessMap).toBe(roughness);
  expect(material.userData.surfaceTexture).toBe('polyhaven-medieval-wall-02'); expect(material.color.getHex()).toBe(color);
  let disposed = 0; for (const texture of [diffuse, normal, roughness]) texture.addEventListener('dispose', () => disposed++);
  material.dispose(); expect(disposed).toBe(0);
  delete SURFACE_TEXTURES['dungeon-stone-diffuse']; delete SURFACE_TEXTURES['dungeon-stone-normal']; delete SURFACE_TEXTURES['dungeon-stone-roughness'];
  diffuse.dispose(); normal.dispose(); roughness.dispose();
});

test('mixed imported UV/tangent layouts are never sent to an incompatible skin merge', () => {
  const scene = new THREE.Group(), bone = new THREE.Bone(); scene.add(bone);
  const skeleton = new THREE.Skeleton([bone]), material = new THREE.MeshStandardMaterial();
  for (let i=0;i<3;i++) {
    const geometry = new THREE.BoxGeometry();
    if(i===2) geometry.deleteAttribute('uv');
    const mesh = new THREE.SkinnedMesh(geometry,material); mesh.name=`Part_${i}`;
    mesh.bind(skeleton); scene.add(mesh);
  }
  mergeSkinned(scene);
  const meshes = scene.children.filter(o=>o instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh[];
  expect(meshes).toHaveLength(2);
  expect(meshes.map(m=>m.geometry.attributes.position.count).sort((a,b)=>a-b)).toEqual([24,48]);
  for(const mesh of meshes) mesh.geometry.dispose(); material.dispose(); skeleton.dispose();
});

function liveDrops(glow: any) {
  const scene = new THREE.Scene(), system: any = Object.create(DropSystem.prototype);
  const game = { stage: {}, scene, heroId: 'knight', player: { alive: true, pos: new THREE.Vector3(40, 0, 40) },
    fx: { lite: false, glow, groundTex() {}, holyBurst() {}, burst() {} },
    renderer: { camera: new THREE.PerspectiveCamera(), flashScreen() {} }, ui: { lootPopup() {}, flyReward() {} }, rollDrop() { return null; } };
  Object.assign(system, { game, scene, items: [], magnetR: 4.2, pickR: 1.1, _matCache: {} });
  system.clear(); system.setup(null);
  return system;
}

test('idle sparkles skip a saturated real glow pool instead of consuming Math.random', () => {
  const scene = new THREE.Scene(), texture = new THREE.Texture();
  const pool = new ParticlePool(scene, { max: 6, texture }), white = new THREE.Color(1, 1, 1);
  expect(pool.emitIfFree(0, 0, 0, 0, 0, 0, white, 1, 99)).toBe(true);
  while (pool.n < pool.max) pool.emit(0, 0, 0, 0, 0, 0, white, 1, 99);
  const system = liveDrops(pool);
  for (const [id, rarity] of [['w_flame', 'E'], ['w_storm', 'U'], ['w_dragon', 'L']]) system.spawn(new THREE.Vector3(0, 0, 0), 'item', { id, rarity }, { spread: 0 });
  const before = Array.from(pool.life);
  const random = Math.random; let calls = 0;
  Math.random = () => { calls++; return .5; };
  try {
    expect(pool.emitIfFree(0, 0, 0, 0, 0, 0, white, 1, 1)).toBe(false);
    // 풀 입자의 수명이 남아 있는 동안(반짝임 수십 번 분량) 대기 장비를 돌린다.
    for (let frame = 0; frame < 180; frame++) system.update(1 / 60);
  } finally { Math.random = random; }
  expect(calls).toBe(0);
  expect(system.items.every((it: any) => it.state === 'idle' && it.sparks > 3)).toBe(true);
  expect(pool.n).toBe(pool.max); expect(Array.from(pool.life)).toEqual(before);
  system.lootModels.dispose(); pool.geo.dispose(); pool.mat.dispose(); texture.dispose();
});

test('tall weapon drops arc and spread before landing instead of settling on the first frame', () => {
  const system = liveDrops({ emitIfFree: () => true });
  const random = Math.random; let seed = 11;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  try { system.spawn(new THREE.Vector3(0, 0, 0), 'item', { id: 'w_iron', rarity: 'N' }, { spread: 1.4 }); }
  finally { Math.random = random; }
  const it = system.items[0], restY = it.mesh.userData.lootRestY;
  expect(restY).toBeGreaterThan(.9);   // 키 큰 무기: 예전 시작 높이(0.6~0.9)보다 높다
  expect(it.mesh.position.y).toBeGreaterThan(restY);
  let peak = it.mesh.position.y, airborne = 0;
  for (let frame = 0; frame < 120 && it.state === 'fly'; frame++) { system.update(1 / 60); peak = Math.max(peak, it.mesh.position.y); airborne++; }
  expect(airborne).toBeGreaterThan(12);
  expect(peak).toBeGreaterThan(restY + .5);
  expect(it.state).toBe('idle');
  expect(Math.hypot(it.mesh.position.x, it.mesh.position.z)).toBeGreaterThan(.3);
  system.lootModels.dispose();
});
