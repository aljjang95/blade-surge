import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyDungeonStoneDetail, applySurfaceDetail } from '../../src/engine/surface-textures.js';
import { Floor } from '../../src/game/world.js';
import { stageDef } from '../../src/data/stages.js';
import { STORY_DUNGEONS } from '../../src/data/story-dungeons.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../../src/game/expedition-combat.js';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const baseline = JSON.parse(fs.readFileSync(new URL('../fixtures/region-architecture-ae2260e.json', import.meta.url), 'utf8'));
const inputs = JSON.parse(fs.readFileSync(new URL('../fixtures/region-architecture-inputs.json', import.meta.url), 'utf8'));
if (inputs.rendererSourceSha256 !== baseline.originalSourceSha256) throw Error('Historical renderer input identity changed');
const source = fs.readFileSync(new URL('../fixtures/region-architecture-ae2260e.source.txt', import.meta.url));
if (createHash('sha256').update(source).digest('hex') !== baseline.originalSourceSha256) throw Error('Historical renderer source differs from the pinned Git blob');
if (THREE.REVISION !== '170') throw Error('Historical renderer proof requires its pinned Three.js r170 dependency');

// 검증된 역사 원본의 import만 현재 런타임 의존성으로 결박한다. 렌더러 본문은 수정하지 않는다.
const imports = ["import * as THREE from 'three';", "import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';",
  "import { applyDungeonStoneDetail, applySurfaceDetail } from '../engine/surface-textures.js';"];
let body = source.toString('utf8');
for (const statement of imports) {
  if (body.split(statement).length !== 2) throw Error('Historical renderer import contract changed');
  body = body.replace(statement, '');
}
export const buildHistoricalArchitecture = new Function('THREE', 'mergeGeometries', 'applyDungeonStoneDetail', 'applySurfaceDetail',
  body.replace('export function buildRegionArchitecture', 'function buildRegionArchitecture') + '\nreturn buildRegionArchitecture;')(
  THREE, mergeGeometries, applyDungeonStoneDetail, applySurfaceDetail);

export const architectureCases = ['crypt', 'throne', 'abyss', 'garden', 'forge', 'frost', 'tide', 'crown']
  .map(theme => [`floor4-${theme}`, theme, () => new Floor(4, theme)]);
architectureCases.push(['campaign-1-1', 'garden', () => {
  const stage = stageDef(1, 1); return new Floor(stage.idx, stage.chapter.theme, undefined, stage.dungeon.layout);
}]);
architectureCases.push(['garden-loop', 'garden', () => buildExpeditionWorld(buildExpeditionStage('dungeon', 'glass_garden', null))]);
const storyMarks = new Set();
for (const map of Object.values(STORY_DUNGEONS)) {
  if (storyMarks.has(map.landmark)) continue;
  storyMarks.add(map.landmark);
  architectureCases.push([`story-${map.landmark}`, 'garden', () => new Floor(51, 'garden', undefined, map.layout)]);
}

export function historicalFloor(name, makeFloor) {
  const floor = makeFloor();
  if (name === 'garden-loop') { delete floor.rooms[3].gardenMastery; floor.rooms[3].label = ''; }
  assertHistoricalInput(name, floor);
  return floor;
}

export function assertHistoricalInput(name, floor) {
  if (hash([floor.rooms, floor.corridors, Array.from(floor.mask), Array.from(floor.inner), floor.gates, floor.sealed]) !== inputs.cases[name]) {
    throw Error(`${name}: frozen starting floor changed`);
  }
}

export function materialShape(material) {
  return { type: material.type, color: material.color.toArray(), emissive: material.emissive.toArray(),
    emissiveIntensity: material.emissiveIntensity, roughness: material.roughness, metalness: material.metalness,
    vertexColors: material.vertexColors, transparent: material.transparent, opacity: material.opacity,
    side: material.side, depthTest: material.depthTest, depthWrite: material.depthWrite,
    map: material.map?.name || null, normalMap: material.normalMap?.name || null,
    roughnessMap: material.roughnessMap?.name || null, bumpMap: material.bumpMap?.name || null,
    bumpScale: material.bumpScale, normalScale: material.normalScale.toArray(),
    shader: material.onBeforeCompile.toString(), cacheKey: material.customProgramCacheKey() };
}

export function geometryFingerprint(group) {
  const records = group.children.flatMap(mesh => mesh.userData.roomRanges
    ? mesh.userData.roomRanges.map(range => ({ mesh, range }))
    : [{ mesh, range: { roomId: Number(mesh.name.split('-').at(-2)), materialRole: Number(mesh.name.split('-').at(-1)),
      start: 0, count: mesh.geometry.getAttribute('position').count } }]);
  records.sort((a, b) => a.range.roomId - b.range.roomId || a.range.materialRole - b.range.materialRole);
  const digest = createHash('sha256');
  for (const { mesh, range } of records) {
    digest.update(JSON.stringify([range.roomId, range.materialRole, range.count]));
    for (const name of Object.keys(mesh.geometry.attributes).sort()) {
      const attr = mesh.geometry.getAttribute(name), bytes = attr.array.BYTES_PER_ELEMENT;
      digest.update(JSON.stringify([name, attr.itemSize, attr.normalized, attr.array.constructor.name]));
      digest.update(new Uint8Array(attr.array.buffer, attr.array.byteOffset + range.start * attr.itemSize * bytes, range.count * attr.itemSize * bytes));
    }
  }
  return digest.digest('hex');
}

export function architectureFingerprint(group) {
  const materials = new Map();
  for (const mesh of group.children) materials.set(mesh.userData.materialRole ?? Number(mesh.name.split('-').at(-1)), mesh.material);
  return { geometrySha256: geometryFingerprint(group), metadataSha256: hash([group.userData.roomDetails, group.userData.landmarks]),
    materialsSha256: hash([...materials.entries()].sort(([a], [b]) => a - b).map(([role, material]) => [role, materialShape(material)])) };
}
