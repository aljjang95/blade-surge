import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Box3, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { fitForgedWeapon, FORGED_WEAPON_FORMS } from '../src/engine/forged-weapons.js';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url));
const glb = (path: string) => { const b = read(path); return JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12))); };

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
