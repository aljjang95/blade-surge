// .blend 미리보기용 런타임 활 형상(OBJ) 추출: bun tools/art/export-ranger-runtime-bow.mjs <out.obj>
import { installRangerRuntimeLoader } from './ranger-runtime-loader.mjs'; installRangerRuntimeLoader();
import { writeFileSync } from 'node:fs';
const { loadHeroModel, spawnCharacter } = await import('../../src/engine/assets.js');
const gltf = await loadHeroModel('ranger', 1);
const inst = spawnCharacter(gltf);
const bow = inst.root.getObjectByName('Bow');
const g = bow.geometry, p = g.attributes.position, idx = g.index;
let out = '# 런타임 forge-bow-v2 적합 형상 (Bow 노드 로컬)\n';
for (let i = 0; i < p.count; i++) out += 'v ' + p.getX(i) + ' ' + p.getY(i) + ' ' + p.getZ(i) + '\n';
for (let i = 0; i < idx.count; i += 3) out += 'f ' + (idx.getX(i)+1) + ' ' + (idx.getX(i+1)+1) + ' ' + (idx.getX(i+2)+1) + '\n';
writeFileSync(process.argv[2], out);
console.log('verts', p.count, 'tris', idx.count / 3);

