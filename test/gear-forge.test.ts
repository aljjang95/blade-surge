import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GEAR_ITEMS, gearLook } from '../src/data/gear-catalog.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { buildItemGeometry, acquireItemGeometry, itemForgeCacheSize, buildGearModel, createItemMaterial } from '../src/engine/item-forge.js';
import { WEAPON_ELEMENT } from '../src/data/weapon-looks.js';
import { applyLook, LOOKS } from '../src/game/look.js';
import { HEROES } from '../src/data/heroes.js';
import { Actor } from '../src/game/actor.js';
import { disposeCharacter } from '../src/engine/assets.js';

const items = ITEM_BY_ID as Record<string, any>;
const positionsHash = (geometry: THREE.BufferGeometry) => createHash('sha256').update(Buffer.from(geometry.attributes.position.array.buffer)).digest('hex');

test('칼 문장은 리카소에서 날 폭보다 크게 돌출해 실루엣에 보인다', () => {
  const look = (gearLook(items.w_rune) as any).weapon, crestY = .3 + look.length * .06;
  const halfWidth = (crest: string) => {
    const geometry = buildItemGeometry('sword', { id: `crest_probe_${crest}`, slot: 'weapon', look: { weapon: { ...look, crest } } });
    const position = geometry.attributes.position; let max = 0;
    for (let i = 0; i < position.count; i++) if (Math.abs(position.getY(i) - crestY) < .1) max = Math.max(max, Math.abs(position.getX(i)));
    geometry.dispose(); return max;
  };
  const bare = halfWidth('none');
  for (const crest of ['orb', 'crystal', 'crescent', 'cage', 'flame', 'star']) expect(halfWidth(crest)).toBeGreaterThan(bare * 1.2);
});

test('아이콘 대상 반지·신발은 실제 정점 형상이 모두 다르다', () => {
  for (const slot of ['ring', 'boots']) {
    const targets = Object.values(items).filter(item => item.slot === slot && item.icon?.startsWith('/img/gear/'));
    const signatures = new Set<string>();
    for (const item of targets) { const geometry = buildItemGeometry(slot, item); signatures.add(positionsHash(geometry)); geometry.dispose(); }
    expect(signatures.size).toBe(targets.length);
  }
});

test('원료·속성 팔레트와 금속/손잡이 PBR 마스크를 게임·아이콘이 공유한다', () => {
  for (const id of ['w_steel', 'w_bronze', 'w_hunter', 'w_flame', 'w_frost', 'w_rune', 'w_knight', 'w_sun', 'w_king']) {
    expect((gearLook(items[id]) as any).weapon.palette.accent).toBe((WEAPON_ELEMENT as any)[id][0]);
  }
  expect((gearLook(items.w_rusty) as any).weapon.surface).toBe('rust');
  expect((gearLook(items.w_wood) as any).weapon.surface).toBe('wood');
  for (const id of ['w_iron', 'w_wood', 'w_flame']) {
    const geometry = buildItemGeometry('sword', items[id]), metal = geometry.attributes.forgeMetal, glow = geometry.attributes.forgeGlow;
    expect(geometry.groups).toHaveLength(1);
    expect(Array.from(metal.array)).toContain(0);
    if (id === 'w_wood') expect(Array.from(metal.array).every(value => value === 0)).toBe(true);
    else expect(Array.from(metal.array)).toContain(1);
    if (id === 'w_flame') expect(Math.max(...glow.array)).toBeGreaterThan(1);
    const material = createItemMaterial(items[id])[0];
    expect(material.metalness).toBeGreaterThanOrEqual(.75); expect(material.metalness).toBeLessThanOrEqual(.9);
    expect(material.roughness).toBeGreaterThanOrEqual(.25); expect(material.roughness).toBeLessThanOrEqual(.4);
    geometry.dispose(); material.dispose();
  }
});

test('기사 N/S/E 기존 무기 12종은 색을 제외한 실제 정점 형상이 서로 다르다', () => {
  const ids = ['w_iron', 'w_rusty', 'w_wood', 'w_cleaver', 'w_steel', 'w_bronze', 'w_hunter', 'w_guard', 'w_flame', 'w_frost', 'w_rune', 'w_knight'];
  const signatures = new Set<string>();
  for (const id of ids) {
    const geometry = buildItemGeometry('sword', items[id]); signatures.add(positionsHash(geometry));
    expect(geometry.groups.length).toBeLessThanOrEqual(2); expect(geometry.attributes.color.count).toBe(geometry.attributes.position.count);
    expect(geometry.boundingBox!.min.y).toBeLessThan(0); expect(geometry.boundingBox!.max.y).toBeGreaterThan(0); geometry.dispose();
  }
  expect(signatures.size).toBe(ids.length);
});

test('8가지 영웅 무기 형식은 모든 신규 무기 외형을 서로 다른 단일 배치로 해석한다', () => {
  for (const form of ['sword', 'greatsword', 'axe', 'greataxe', 'wand', 'staff', 'dagger', 'bow']) {
    const signatures = new Set<string>();
    for (const item of GEAR_ITEMS.filter(item => item.slot === 'weapon')) {
      const geometry = buildItemGeometry(form, item); signatures.add(positionsHash(geometry));
      expect(Array.from(geometry.attributes.position.array).every(Number.isFinite)).toBe(true); geometry.dispose();
    }
    expect(signatures.size).toBe(12);
  }
  for (const item of GEAR_ITEMS.filter(item => item.slot === 'ring' || item.slot === 'boots')) {
    const mesh = buildGearModel(item);
    expect(mesh.geometry.attributes.color).toBeDefined(); expect(mesh.children).toHaveLength(0); mesh.userData.dispose(); mesh.userData.dispose();
  }
  expect(itemForgeCacheSize()).toBe(0);
});

test('동일 형식·ID·소켓은 공유하고 마지막 참조가 반환될 때만 한 번 폐기한다', () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-.2, -.3, -.06), new THREE.Vector3(.2, 1.2, .06));
  const a = acquireItemGeometry('sword', items.w_iron, bounds), b = acquireItemGeometry('sword', items.w_iron, bounds);
  expect(a.geometry).toBe(b.geometry); expect(itemForgeCacheSize()).toBe(1);
  let disposals = 0; a.geometry.addEventListener('dispose', () => disposals++);
  a.release(); a.release(); expect(disposals).toBe(0);
  b.release(); b.release(); expect(disposals).toBe(1); expect(itemForgeCacheSize()).toBe(0);
  expect(a.geometry.boundingBox!.min.y).toBeCloseTo(bounds.min.y, 5); expect(a.geometry.boundingBox!.max.y).toBeCloseTo(bounds.max.y, 5);
});

async function rig(heroId: string) {
  const root = new THREE.Group(), looks = (LOOKS as any)[heroId];
  const forms: Record<string, string> = { '1H_Sword': 'sword', '2H_Sword': 'greatsword', '1H_Sword_Offhand': 'sword', '1H_Axe': 'axe', '2H_Axe': 'greataxe', '1H_Axe_Offhand': 'axe', '1H_Wand': 'wand', '2H_Staff': 'staff', Knife: 'dagger', Knife_Offhand: 'dagger', Bow: 'bow' };
  for (const name of looks.weaponNodes) {
    if (!forms[name]) continue;
    const bytes = readFileSync(`public/models/dungeon-forge-v2/forge-${forms[name]}-v2.glb`);
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const node = new THREE.Group(); node.name = name; node.position.set(.2, .3, .4); root.add(node);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((mesh: any) => {
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      if (forms[name] === 'bow') geometry.rotateX(Math.PI / 2);
      geometry.computeBoundingBox();
      node.userData.weaponForgeBounds = { min: geometry.boundingBox!.min.toArray(), max: geometry.boundingBox!.max.toArray() };
      node.add(new THREE.Mesh(geometry, mesh.material.clone()));
    });
  }
  return root;
}

test('장착·등급 교체·해제는 소켓 원본을 보존하고 Actor/미리보기 폐기는 소유 자원만 정리한다', async () => {
  for (const heroId of Object.keys(LOOKS)) {
    const a = await rig(heroId), b = await rig(heroId), def = (HEROES as any)[heroId];
    const nodeName = (LOOKS as any)[heroId].weapon.N[0], node = a.getObjectByName(nodeName)!;
    const mesh = node.children[0] as THREE.Mesh, original = mesh.geometry, originalMaterial = mesh.material;
    let originalDisposals = 0; original.addEventListener('dispose', () => originalDisposals++);
    const position = node.position.clone();
    applyLook(a, def, { weapon: { id: 'w_iron' } }); applyLook(b, def, { weapon: { id: 'w_iron' } });
    const shared = mesh.geometry, bMesh = b.getObjectByName(nodeName)!.children[0] as THREE.Mesh;
    expect(shared).toBe(bMesh.geometry); expect(node.position).toEqual(position);
    let disposals = 0; shared.addEventListener('dispose', () => disposals++);
    applyLook(a, def, { weapon: { id: 'w_iron', enh: 15 } }); expect(mesh.geometry).toBe(shared);
    applyLook(a, def, { weapon: { id: 'w_dragon' } }); expect(disposals).toBe(0);
    expect(a.getObjectByName(nodeName)!.visible).toBe((LOOKS as any)[heroId].weapon.L.includes(nodeName));
    applyLook(a, def, {}); expect(mesh.geometry).toBe(original); expect(mesh.material).toBe(originalMaterial);
    const mixer = new THREE.AnimationMixer(b);
    const actor: any = { game: { scene: new THREE.Scene() }, root: b, model: b, mixer };
    Actor.prototype.dispose.call(actor); Actor.prototype.dispose.call(actor);
    expect(disposals).toBe(1); expect(originalDisposals).toBe(0);
    applyLook(a, def, { weapon: { id: 'w_iron' } });
    disposeCharacter(a, new THREE.AnimationMixer(a)); expect(itemForgeCacheSize()).toBe(0);
  }
});

test('병기고 modelNode 무기는 절차적 교체 경로를 소비하지 않는다', async () => {
  const root = await rig('knight'), mesh = root.getObjectByName('1H_Sword')!.children[0] as THREE.Mesh, original = mesh.geometry;
  const armory = Object.values(items).find(item => item.modelNode && item.slot === 'weapon');
  expect(armory).toBeDefined(); applyLook(root, HEROES.knight, { weapon: { id: armory.id } });
  expect(mesh.geometry).toBe(original); expect(itemForgeCacheSize()).toBe(0);
});
