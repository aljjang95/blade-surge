import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import MANIFEST from '../src/data/item-weapon-glb.json';
import { ITEMS_OF } from '../src/data/items.js';
import { acquireItemGeometry, buildItemGeometry, createItemMaterial } from '../src/engine/item-forge.js';
import {
  ITEM_WEAPON_GLB_BUDGET, itemWeaponGlb, itemWeaponGlbEntry, preloadItemWeaponGlbs, resetItemWeaponGlbsForTest,
} from '../src/engine/item-weapon-glb.js';
import { inspectWeaponGlb, registerItemWeapon, sha256 } from '../tools/art/register-item-weapon.mjs';

const root = new URL('../', import.meta.url).pathname;
const FIXTURE = join(root, 'test/fixtures/item-weapon-sword-prepped.glb');
const COLORED = join(root, 'public/models/dungeon-forge-v2/forge-sword-v2.glb');   // COLOR_0 이 있어 등록 불가여야 한다.
const weapon: any = (ITEMS_OF as any)('E', 'weapon')[0];

const fixtureLoad = async () => {
  const bytes = readFileSync(FIXTURE);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
};
const manifestOf = (form = 'sword') => ({ items: [{ id: weapon.id, form, file: '/x.glb', sha256: '', bytes: 0, triangles: 456, source: { tripoTaskId: 't', concept: 'c' } }] });

afterEach(() => resetItemWeaponGlbsForTest());

test('매니페스트: 스키마 · 파일 해시 · 예산 (등록 항목이 있으면 모두 검사)', () => {
  expect(Array.isArray(MANIFEST.items)).toBe(true);
  const ids = new Set<string>();
  for (const item of MANIFEST.items as any[]) {
    expect(item.id).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    expect(ids.has(item.id)).toBe(false); ids.add(item.id);
    expect(['sword', 'greatsword']).toContain(item.form);
    expect(item.file).toBe(`/models/item-weapons/${item.id}.glb`);
    expect(item.source.tripoTaskId).toBeTruthy();
    const path = join(root, 'public', item.file);
    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(sha256(bytes)).toBe(item.sha256);
    expect(bytes.length).toBe(item.bytes);
    const report = inspectWeaponGlb(bytes);
    expect(report.errors).toEqual([]);
    expect(report.triangles).toBe(item.triangles);
    expect(item.triangles).toBeLessThanOrEqual(ITEM_WEAPON_GLB_BUDGET.triangles);
  }
});

test('등록 도구: 픽스처 GLB 를 임시 위치에 등록하고 해시 · 삼각형 · 규약을 기록한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'item-weapon-'));
  try {
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({ items: [] }));
    const { entry } = await registerItemWeapon({ id: 'fixture-sword', form: 'sword', input: FIXTURE, taskId: 'task-1', concept: '시험', manifestPath, outDir: join(dir, 'glb') });
    const bytes = readFileSync(FIXTURE);
    expect(entry).toMatchObject({ id: 'fixture-sword', form: 'sword', file: '/models/item-weapons/fixture-sword.glb', sha256: sha256(bytes), bytes: bytes.length, triangles: 456 });
    expect(readFileSync(join(dir, 'glb/fixture-sword.glb')).equals(bytes)).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).items).toHaveLength(1);
    // 다시 등록하면 교체한다(중복 항목 없음).
    await registerItemWeapon({ id: 'fixture-sword', form: 'sword', input: FIXTURE, taskId: 'task-2', manifestPath, outDir: join(dir, 'glb') });
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).items).toHaveLength(1);
    // 검성 외 형태와 정점색 GLB 는 거부한다.
    await expect(registerItemWeapon({ id: 'bad-axe', form: 'axe', input: FIXTURE, taskId: 't', manifestPath, outDir: join(dir, 'glb') })).rejects.toThrow('검성 전용');
    await expect(registerItemWeapon({ id: 'bad-color', form: 'sword', input: COLORED, taskId: 't', manifestPath, outDir: join(dir, 'glb') })).rejects.toThrow('정점색');
    expect(existsSync(join(dir, 'glb/bad-color.glb'))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GLB 검사: 눕거나 원점이 밖에 있는 무기, 삼각형 예산 초과를 잡는다', () => {
  expect(inspectWeaponGlb(readFileSync(FIXTURE)).ok).toBe(true);
  expect(inspectWeaponGlb(readFileSync(FIXTURE)).gripFraction).toBeCloseTo(.18, 2);
  // JSON 청크만 고쳐 GLB 를 다시 조립한다.
  const original = readFileSync(FIXTURE), jsonLength = original.readUInt32LE(12);
  const doc = JSON.parse(original.toString('utf8', 20, 20 + jsonLength));
  const rebuild = (edit: (d: any) => void) => {
    const d = JSON.parse(JSON.stringify(doc)); edit(d);
    let text = JSON.stringify(d); while (Buffer.byteLength(text) % 4) text += ' ';
    const bin = original.subarray(20 + jsonLength);
    const head = Buffer.alloc(20); head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + Buffer.byteLength(text) + bin.length, 8); head.writeUInt32LE(Buffer.byteLength(text), 12); head.writeUInt32LE(0x4e4f534a, 16);
    return Buffer.concat([head, Buffer.from(text), bin]);
  };
  const positionOf = (d: any) => d.accessors[d.meshes[0].primitives[0].attributes.POSITION];
  expect(inspectWeaponGlb(rebuild(() => {})).ok).toBe(true);
  const outside = inspectWeaponGlb(rebuild(d => { positionOf(d).min[1] = 0.1; }));
  expect(outside.errors.join(' ')).toContain('원점');
  const lying = inspectWeaponGlb(rebuild(d => { positionOf(d).max[0] = 5; }));
  expect(lying.errors.join(' ')).toContain('길이축');
  const heavy = inspectWeaponGlb(rebuild(d => { const p = d.meshes[0].primitives[0]; d.accessors[p.indices].count = 4001 * 3; }));
  expect(heavy.errors.join(' ')).toContain('삼각형 예산');
  const colored = inspectWeaponGlb(rebuild(d => { d.meshes[0].primitives[0].attributes.COLOR_0 = 0; }));
  expect(colored.errors.join(' ')).toContain('정점색');
});

test('런타임: 매니페스트에 있고 형태가 같으면 GLB 지오메트리 · 재질을 쓴다(정점색 없음, 발광 칠 가능)', async () => {
  await preloadItemWeaponGlbs({ manifest: manifestOf('sword'), load: fixtureLoad });
  expect(itemWeaponGlb(weapon.id, 'sword')).not.toBeNull();
  const geometry = buildItemGeometry('sword', weapon);
  expect(geometry.attributes.position.count).toBeGreaterThan(0);
  expect(geometry.attributes.color).toBeUndefined();
  // 렌더 계약: 재질 배열로 붙으므로 0번 재질을 가리키는 그룹이 전체를 덮어야 그려진다.
  const drawCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  expect(geometry.groups).toEqual([{ start: 0, count: drawCount, materialIndex: 0 }]);
  expect(geometry.boundingBox || (geometry.computeBoundingBox(), geometry.boundingBox)).toBeTruthy();
  const [material] = createItemMaterial(weapon, 'sword');
  expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
  expect((material as THREE.MeshStandardMaterial).vertexColors).toBe(false);
  // 발광은 색 텍스처로 곱하고(픽스처에 텍스처가 없으면 null) 절차적 무기보다 약하게 칠한다.
  expect((material as THREE.MeshStandardMaterial).emissiveMap).toBe((material as THREE.MeshStandardMaterial).map);
  expect(material.userData.emissiveScale).toBeGreaterThan(0);
  expect(material.userData.emissiveScale).toBeLessThan(1);
  expect((material as THREE.MeshStandardMaterial).metalness).toBeLessThanOrEqual(0.3);
  expect((material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0);
  // look.js 의 강화 빛은 emissive 를 직접 칠한다.
  (material as THREE.MeshStandardMaterial).emissive.set('#ff8800');
  expect(itemWeaponGlb(weapon.id, 'sword')!.material.emissive.getHex()).toBe(0);
  // 소켓 bounds 맞춤: 손잡이 원점 · 날 방향(+Y) 규약대로 원본 bounds 에 맞춘다.
  const bounds = new THREE.Box3(new THREE.Vector3(-.3, -.25, -.1), new THREE.Vector3(.3, 1.4, .1));
  const lease = acquireItemGeometry('sword', weapon, bounds);
  expect(lease.geometry.boundingBox!.min.y).toBeCloseTo(-.25, 4);
  expect(lease.geometry.boundingBox!.max.y).toBeCloseTo(1.4, 4);
  expect(lease.geometry.groups.length).toBe(1);
  expect(lease.geometry.groups[0].materialIndex).toBe(0);
  lease.release();
  for (const part of [material]) part.dispose();
});

test('form 이 매니페스트와 다르면 null 이고 기존 절차적 무기로 폴백한다', async () => {
  await preloadItemWeaponGlbs({ manifest: manifestOf('sword'), load: fixtureLoad });
  expect(itemWeaponGlbEntry(weapon.id, 'sword')).not.toBeNull();
  expect(itemWeaponGlbEntry(weapon.id, 'greatsword')).toBeNull();
  expect(itemWeaponGlb(weapon.id, 'axe')).toBeNull();
  const procedural = buildItemGeometry('greatsword', weapon);
  expect(procedural.attributes.color).toBeDefined();
  expect((createItemMaterial(weapon, 'greatsword')[0] as THREE.MeshStandardMaterial).vertexColors).toBe(true);
  expect((createItemMaterial(weapon)[0] as THREE.MeshStandardMaterial).vertexColors).toBe(true);
});

test('GLB 가 없거나 로딩이 실패하면 경고 한 번만 남기고 절차적 무기를 쓴다', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const failing = { manifest: manifestOf('sword'), load: async () => { throw new Error('404'); } };
    await preloadItemWeaponGlbs(failing);
    await preloadItemWeaponGlbs(failing);
    expect(itemWeaponGlb(weapon.id, 'sword')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(buildItemGeometry('sword', weapon).attributes.color).toBeDefined();
    // 검성 외 형태(도끼)는 매니페스트에 있어도 로딩하지 않고 폴백한다.
    resetItemWeaponGlbsForTest();
    await preloadItemWeaponGlbs({ manifest: manifestOf('axe'), load: fixtureLoad });
    expect(itemWeaponGlb(weapon.id, 'axe')).toBeNull();
  } finally { warn.mockRestore(); }
});

test('빈 매니페스트(기본): 선로드는 아무것도 하지 않고 모든 무기는 절차적이다', async () => {
  if (MANIFEST.items.length) return;   // 실제 항목이 등록된 뒤에는 해당 없음
  await preloadItemWeaponGlbs();
  expect(itemWeaponGlb(weapon.id, 'sword')).toBeNull();
  expect(buildItemGeometry('sword', weapon).attributes.color).toBeDefined();
});
