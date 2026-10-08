import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { ENCOUNTER_MODELS } from '../src/data/encounter-models.js';
import { ENEMIES } from '../src/data/stages.js';
import { fitForgedWeapon, FORGED_WEAPON_FORMS } from '../src/engine/forged-weapons.js';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url));
const glb = (path: string) => { const b = read(path); return JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12))); };

test('단조 팩은 실제 Blender 출력과 원본 불변 해시를 보존한다', () => {
  const manifest = JSON.parse(read('docs/assets/dungeon-forge-v2.json').toString());
  expect(manifest.authoring).toBe('Blender headless');
  for (const [path, hash] of Object.entries(manifest.preservedSources)) expect(createHash('sha256').update(read(String(path))).digest('hex')).toBe(String(hash));
  for (const file of manifest.files) expect(createHash('sha256').update(read(String(file.path))).digest('hex')).toBe(file.sha256);
  expect(createHash('sha256').update(read(String(manifest.sourceScript.path))).digest('hex')).toBe(manifest.sourceScript.sha256);
});

test('네 병사 외형은 기존 애니메이션 리그에 결합하는 색 속성 단일 재질이다', () => {
  const names = ['Skeleton_Vanguard', 'Skeleton_Skirmisher', 'Skeleton_Runekeeper', 'Skeleton_Bulwark'];
  let total = 0;
  for (const name of names) {
    const variant = (ENCOUNTER_MODELS as any)[name];
    const file = `public/models/tll/encounters/${variant.file}.glb`, fitting = glb(file), source = glb(`public/models/${variant.base}.glb`);
    total += read(file).length;
    expect(fitting.materials).toHaveLength(1); expect(fitting.images || []).toHaveLength(0); expect(fitting.animations || []).toHaveLength(0);
    const bones = new Set(source.skins.flatMap((skin: any) => skin.joints.map((i: number) => source.nodes[i].name.replaceAll('.', ''))));
    for (const node of fitting.nodes.filter((n: any) => n.mesh !== undefined)) expect(bones.has(node.extras.tllBone.replaceAll('.', ''))).toBe(true);
    const triangles = fitting.meshes.flatMap((m: any) => m.primitives).reduce((sum: number, p: any) => {
      expect(p.attributes.COLOR_0).toBeDefined(); return sum + fitting.accessors[p.indices].count / 3;
    }, 0);
    expect(triangles).toBeLessThan(1800);
  }
  expect(total).toBeLessThan(250_000);
  expect((ENEMIES as any).skel_minion.model).toBe(names[0]); expect((ENEMIES as any).skel_mage.model).toBe(names[2]);
  expect((ENEMIES as any).garden_finalboss.model).toBe('Skeleton_BellKing');
});

test('모든 직업 무기는 단일 메시/재질이며 새 리그나 애니메이션을 추가하지 않는다', () => {
  for (const form of new Set(Object.values(FORGED_WEAPON_FORMS).flatMap(forms => Object.values(forms)))) {
    const json = glb(`public/models/dungeon-forge-v2/forge-${form}-v2.glb`);
    expect(json.materials).toHaveLength(1); expect(json.meshes).toHaveLength(1); expect(json.meshes[0].primitives).toHaveLength(1);
    expect(json.skins || []).toHaveLength(0); expect(json.animations || []).toHaveLength(0);
    expect(json.meshes[0].primitives[0].attributes.COLOR_0).toBeDefined();
  }
});

test('무기 장착은 비대칭 AABB 중심 대신 소켓 원점을 보존하고 날 방향을 맞춘다', () => {
  const original = new BufferGeometry();
  original.setAttribute('position', new Float32BufferAttribute([0,0,0, .5,1,0, 0,-.3,.08],3));
  const snapshot = Array.from(original.attributes.position.array);
  const cases = [
    { form: 'axe', axis: 'y', bounds: new Box3(new Vector3(-.589,-.273,-.092), new Vector3(.126,.971,.092)) },
    { form: 'bow', axis: 'z', bounds: new Box3(new Vector3(-.873,-.079,-1.139), new Vector3(.128,.079,1.139)) },
    { form: 'staff', axis: 'y', bounds: new Box3(new Vector3(-.245,-.900,-.146), new Vector3(.331,1.254,.146)) },
  ];
  for (const {form,axis,bounds} of cases) {
    const fitted = fitForgedWeapon(original,bounds,form), position = fitted.attributes.position, box = fitted.boundingBox!;
    expect(new Vector3().fromBufferAttribute(position,0).length()).toBeLessThan(1e-8);
    expect(box.min[axis as 'y'|'z']).toBeCloseTo(bounds.min[axis as 'y'|'z'],5);
    expect(box.max[axis as 'y'|'z']).toBeCloseTo(bounds.max[axis as 'y'|'z'],5);
    if(form==='axe')expect(position.getX(1)).toBeLessThan(0);
    expect(Array.from(original.attributes.position.array)).toEqual(snapshot); fitted.dispose();
  }
  original.dispose();
});
