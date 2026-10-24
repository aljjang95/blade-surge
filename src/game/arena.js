import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VFX_TEX } from '../engine/assets.js';
import { getPart } from '../engine/assets.js';
import { buildRegionArchitecture, buildTownDecor, townDecorFor } from './region-architecture.js';
import { ROOM_TYPE, isStarArchive, mulberry32 } from './world.js';
import { STAR_ARCHIVE_TEXTURES } from '../engine/surface-textures.js';
import { buildCitadelHubScene, townLibraryProps } from './citadel-hub-scene.js';
import { activeTownId, TOWN_THEMES, takeEmergingGates } from '../data/citadel-hub.js';
import { buildLobbyWorld } from './lobby-world.js';
import { activeCampaignSkin } from '../data/campaign-towns.js';
import { BattleOcclusion } from '../engine/battle-occlusion.js';
import { softCircleTex } from '../engine/assets.js';
import { applyDungeonSurface, collectDungeonTiles, projectDungeonSurface } from './dungeon-surface.js';
import { buildOpenFieldScene, FIELD_ATMOSPHERES } from './open-field-scene.js';
import { libraryAssets } from '../engine/library-assets.js';
import { buildConceptTerrain } from './concept-terrain.js';
import { collectDungeonWallSegments, fitDungeonWallSegments, DUNGEON_WALL_CLEARANCE } from './dungeon-walls.js';
import { buildGlassGardenDecor } from './glass-garden-decor.js';
import { glassGardenKitTemplates, preloadGlassGardenKit } from '../engine/glass-garden-kit.js';

const THEMES = {
  garden: { fog: 0x172b2b, bg: 0x172b2b, hemi: [0xa0b5ae, 0x283930], sun: 0xffedca, sunI: 2.3, torch: 0x8adbd0, tint: 0xcbd0b8 },
  forge:  { fog: 0x201818, bg: 0x201818, hemi: [0x9b8a81, 0x251c1b], sun: 0xffd4ae, sunI: 2.2, torch: 0xff833c, tint: 0xa3a2a4 },
  frost:  { fog: 0x172535, bg: 0x172535, hemi: [0xb4cfe1, 0x233445], sun: 0xe5f1ff, sunI: 2.2, torch: 0x94e4ff, tint: 0xb9c9e0 },
  tide:   { fog: 0x102930, bg: 0x102930, hemi: [0x82b2c5, 0x122935], sun: 0xc9f0f1, sunI: 2.3, torch: 0x66dccb, tint: 0x9ab8bb },
  crown:  { fog: 0x2b2734, bg: 0x2b2734, hemi: [0xc9b8ca, 0x342b3c], sun: 0xffebc8, sunI: 2.4, torch: 0xffd99b, tint: 0xe1d5c1 },
  crypt:  { fog: 0x0b0a16, bg: 0x0b0a16, hemi: [0x5a6aa0, 0x1a1420], sun: 0xb8c4ff, sunI: 2.6, torch: 0xff8a2a, tint: 0xd8dcff },
  throne: { fog: 0x160a08, bg: 0x160a08, hemi: [0xa06040, 0x201008], sun: 0xffc090, sunI: 2.5, torch: 0xff6a20, tint: 0xffd8c0 },
  abyss:  { fog: 0x0e0716, bg: 0x0e0716, hemi: [0x7a40a0, 0x150a20], sun: 0xd0a0ff, sunI: 2.4, torch: 0xa060ff, tint: 0xe0c8ff },
  lobby:  { fog: 0x0a0812, bg: 0x0a0812, hemi: [0x6a5a90, 0x1a1420], sun: 0xffe0c0, sunI: 3.4, torch: 0xffa040, tint: 0xffffff },
};
// Region themes set the broad palette; authored dungeon landmarks add the
// readable in-game identity that the campaign map promises.
const DUNGEON_ATMOSPHERES = {
  memorial: { fog: 0x142828, bg: 0x0d1b1d, hemi: [0xadccd0, 0x172d28], sun: 0xffedd4, sunI: 2.5, torch: 0x86e1c5, tint: 0xbbc9c0 },
  kiln: { fog: 0x261716, bg: 0x160d0d, hemi: [0xc99a7d, 0x311717], sun: 0xffc18c, sunI: 2.5, torch: 0xff7034, tint: 0xd8a28b },
  archive: { fog: 0x18263c, bg: 0x0e1727, hemi: [0xb8d8f2, 0x233752], sun: 0xd8edff, sunI: 2.5, torch: 0x86d7ff, tint: 0xb7cbed },
  beacon: { fog: 0x0d3037, bg: 0x08212b, hemi: [0x80d2d2, 0x123643], sun: 0xb5f6ef, sunI: 2.55, torch: 0x4be6d2, tint: 0x9adbd1 },
  tribunal: { fog: 0x2a2139, bg: 0x171323, hemi: [0xd1b7d6, 0x342743], sun: 0xffe1bd, sunI: 2.65, torch: 0xf5a2d4, tint: 0xd5c0d8 },
  confluence: { fog: 0x19312b, bg: 0x0d211d, hemi: [0xb5dbc3, 0x204139], sun: 0xffe8b9, sunI: 2.55, torch: 0x9be6ba, tint: 0xb8d2ac },
  glacier: { fog: 0x8fcfe0, bg: 0x6fb4d8, hemi: [0xe3f5ff, 0x2a5d76], sun: 0xfff6e8, sunI: 2.7, torch: 0xff7fbf, tint: 0xd5e2f2 },
  quarry: { fog: 0xd8a47c, bg: 0xc98a5c, hemi: [0xffeeda, 0x5c3a24], sun: 0xffd9b0, sunI: 2.55, torch: 0xffa040, tint: 0xf2cfa0 },
};
const TILE = 4;
export const STAR_ARCHIVE_ATMOSPHERE = Object.freeze({
  fog: 0x263448, bg: 0x162235, hemi: [0xc9d5eb, 0x363945],
  sun: 0xe8f0ff, sunI: 2.15, torch: 0x8accff, tint: 0xd1d8e2,
});
const rnd = (a, b) => a + Math.random() * (b - a);

// A seal owns its three generated meshes. Texture maps remain shared VFX assets.
function disposeSeal(seal) {
  seal.removeFromParent();
  seal.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
}

export class Arena {
  constructor(scene, dungeonGltf, renderer, landmarkGltf = null, hubModels = {}) {
    this.scene = scene; this.gltf = dungeonGltf; this.renderer = renderer; this.landmarkGltf = landmarkGltf;
    this.hubModels = hubModels;
    this.occlusion = renderer.battleOcclusion ??= new BattleOcclusion();
    this.group = new THREE.Group(); scene.add(this.group);
    this.lights = []; this.torches = []; this.torchPos = []; this.t = 0;
    this.doors = []; this.seals = []; this.ownedMaterials = new Set(); this.ownedGeometry = new Set();
  }
  /** 보스 봉인 결계 — 복도 입구를 막는 붉은 룬 장막. 구역을 전부 정화하면 openSeal 로 깨진다 */
  buildSeals(floorData) {
    for (const s of this.seals) disposeSeal(s); this.seals.length = 0;
    if (!floorData.sealed) return;
    for (const g of floorData.gates) {
      // 장막(반투명 검붉은 판) + 마법진(circle_demon, 회전) + 발밑 룬. 가산 판 하나로는 밝은 바닥 위에서 거의 안 보였다 (스크린샷 대조)
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 4.2, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x5a0a1c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false }));
      wall.position.set(g.x, 2.1, g.z); if (g.axis === 'z') wall.rotation.y = Math.PI / 2; wall.renderOrder = 2;
      const tex = VFX_TEX.circle_demon;
      const sigil = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2),
        new THREE.MeshBasicMaterial({ map: tex || null, color: 0xff3050, transparent: true, opacity: 0.95, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sigil.position.set(0, -0.05, 0.02); sigil.renderOrder = 3; wall.add(sigil);
      const rune = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.2, 6),
        new THREE.MeshBasicMaterial({ color: 0xff6070, transparent: true, opacity: 0.7, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      rune.position.set(0, -2.02, 0); rune.rotation.x = Math.PI / 2; rune.renderOrder = 3;
      wall.userData.rune = rune; wall.userData.sigil = sigil; wall.add(rune);
      this.group.add(wall); this.seals.push(wall);
    }
  }
  openSeal(fx) {
    for (const s of this.seals) {
      const p = s.position.clone().setY(0);
      fx?.shockTex(p, 0xff4060, { r1: 8, life: 0.7 }); fx?.firePillar(p, { height: 8, width: 3.2, life: 0.9, color: 0xff4060 }); fx?.burst(p.clone().setY(1.5), 0xff8090, { n: 30, speed: 9, size: 0.45, up: 1 });
      disposeSeal(s);
    }
    this.seals.length = 0;
  }
  clearSky() {
    if (!this.skyGroup) return;
    this.skyGroup.removeFromParent();
    this.skyGroup.traverse((node) => { if (node.geometry) node.geometry.dispose(); if (node.material) { for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose(); } });
    this.skyGroup = null;
  }
  clear() {
    this.occlusion.reset();
    delete this.group.userData.dungeonWalls;
    this.clearSky();
    this.lobbyHall?.userData.dispose(); this.lobbyHall = null;
    this.lobbyWorld?.userData.dispose(); this.lobbyWorld = null; this.renderer.lobbyOccluders = [];
    this.regionArchitecture?.userData.dispose(); this.regionArchitecture = null;
    this.fieldScene?.userData.dispose(); this.fieldScene = null;
    this.conceptTerrain?.userData.dispose(); this.conceptTerrain = null;
    this.townDecor?.userData.dispose(); this.townDecor = null;
    this.glassGardenDecor?.userData.dispose(); this.glassGardenDecor = null;
    for (const material of this.ownedMaterials) material.dispose(); this.ownedMaterials.clear();
    for (const geometry of this.ownedGeometry) geometry.dispose(); this.ownedGeometry.clear();
    for (const s of this.seals) disposeSeal(s);
    while (this.group.children.length) { const c = this.group.children.pop(); c.traverse?.((o) => { if (o.isInstancedMesh) o.dispose(); }); }
    for (const l of this.lights) { l.shadow?.dispose(); this.scene.remove(l); }
    this.lights.length = 0; this.torches.length = 0; this.torchPos.length = 0; this.doors.length = 0; this.seals.length = 0;
  }
  _meshOf(name) { const p = this.gltf.scene.getObjectByName(name); let m = null; p?.traverse((o) => { if (!m && o.isMesh) m = o; }); return { mesh: m, part: p }; }
  /**
   * 인스턴싱. 층 전체를 하나의 InstancedMesh 로 묶으면 바운딩 스피어가 층 전체를 덮어
   * **프러스텀 컬링이 절대 안 걸린다** — 안 보이는 방까지 매 프레임 그린다.
   * 그래서 공간 청크(CHUNK 유닛 격자)로 쪼개 각 덩어리가 따로 컬링되게 한다.
   * castShadow=false 인 것(바닥 등)은 그림자 패스에서 통째로 빠져 삼각형이 절반 난다.
   */
  instanced(name, transforms, tint, opts = {}) {
    if (!transforms.length) return;
    const { mesh: src, part } = this._meshOf(name); if (!src) return;
    const { castShadow = true, chunk = 44 } = opts;
    const mat = src.material.clone(); this.ownedMaterials.add(mat); if (tint) mat.color.multiply(new THREE.Color(tint));
    part.updateWorldMatrix(true, true);
    const local = new THREE.Matrix4().copy(part.matrixWorld).invert().multiply(src.matrixWorld);
    let wallAlignment = null;
    if (opts.alignedWall) {
      // 압축 정점의 해독·파트 내부 변환을 먼저 적용한 치수다. 원본 버퍼와 지오메트리는 건드리지 않는다.
      const bounds = new THREE.Box3().setFromBufferAttribute(src.geometry.getAttribute('position')).applyMatrix4(local);
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      if (![size.x, size.y, size.z].every(value => Number.isFinite(value) && value > 1e-6)) throw new Error('던전 벽 자산의 치수가 올바르지 않습니다.');
      wallAlignment = { width: size.x, height: size.y, depth: size.z,
        bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
      local.premultiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
    }
    let geometry = src.geometry;
    if (opts.dungeonSurface && applyDungeonSurface(mat)) {
      geometry = projectDungeonSurface(src.geometry, local, TILE);
      this.ownedGeometry.add(geometry);
    }
    if (opts.starArchiveSurface || opts.starArchiveStone) {
      mat.color.set(opts.starArchiveStone ? 0xbfc5d2 : 0x9da3b0); mat.vertexColors = false;
      mat.map = STAR_ARCHIVE_TEXTURES.floor || null;
      mat.bumpMap = null; mat.normalMap = null; mat.roughnessMap = null;
      mat.roughness = .64; mat.metalness = .12;
      mat.userData.surfaceTexture = opts.starArchiveStone ? 'star-archive-marble-frame' : 'star-archive-floor';
      const stone = !!opts.starArchiveStone;
      // 이미지 내 4×4 줄눈을 10m마다 반복한다. 인스턴스 회전·청크와 무관한 월드 UV다.
      mat.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_MAP
            vec4 archivePoint = vec4(position, 1.0);
            vec3 archiveNormal = normal;
            #ifdef USE_INSTANCING
              archivePoint = instanceMatrix * archivePoint;
              archiveNormal = mat3(instanceMatrix) * archiveNormal;
            #endif
            vec3 archiveWorld = (modelMatrix * archivePoint).xyz;
            archiveNormal = abs(mat3(modelMatrix) * archiveNormal);
            vMapUv = ${stone ? '(archiveNormal.y > .5 ? archiveWorld.xz : archiveNormal.x > archiveNormal.z ? archiveWorld.zy : archiveWorld.xy)' : 'archiveWorld.xz'} / 10.0;
          #endif`);
      };
      mat.customProgramCacheKey = () => 'star-archive-world-marble-v2-' + stone;
      mat.envMap = this.renderer.characterEnvironment?.texture || null;
      mat.envMapIntensity = .35;
    }
    if (opts.cutaway) this.occlusion.bind(mat);

    // 공간 버킷으로 분할
    const buckets = new Map();
    for (const t of transforms) {
      const k = `${Math.floor(t.x / chunk)},${Math.floor(t.z / chunk)}`;
      (buckets.get(k) || buckets.set(k, []).get(k)).push(t);
    }
    const o = new THREE.Object3D(); const out = [];
    for (const list of buckets.values()) {
      const im = new THREE.InstancedMesh(geometry, mat, list.length);
      if (opts.dungeonSurface) im.name = `dungeon-surface-${name}`;
      if (wallAlignment) {
        im.name = `dungeon-wall-${name}`;
        im.userData.dungeonWall = { sourceName: name, sourceDimensions: wallAlignment,
          clearance: DUNGEON_WALL_CLEARANCE, instances: [] };
      }
      list.forEach((t, i) => {
        if (wallAlignment) {
          const clearance = t.clearance ?? DUNGEON_WALL_CLEARANCE;
          const outward = wallAlignment.depth / 2 + clearance;
          o.position.set(t.x + t.normalX * outward, t.y || 0, t.z + t.normalZ * outward);
          o.scale.set(t.length / wallAlignment.width, 1, 1);
          im.userData.dungeonWall.instances.push({ index: i, boundary: { ...t.boundary },
            length: t.length, normal: { x: t.normalX, z: t.normalZ },
            center: { x: o.position.x, z: o.position.z },
            clearance, innerFace: { x: t.x + t.normalX * clearance, z: t.z + t.normalZ * clearance } });
        } else {
          o.position.set(t.x, t.y || 0, t.z); o.scale.setScalar(t.s || 1);
        }
        o.rotation.set(0, t.ry || 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix.multiply(local));
      });
      im.castShadow = castShadow; im.receiveShadow = true; im.frustumCulled = true;
      im.computeBoundingSphere?.();   // 청크 기준 타이트한 바운드 → 컬링이 실제로 걸린다
      this.group.add(im); out.push(im);
    }
    return out[0];
  }
  place(name, x, z, ry = 0, s = 1, tint) {
    const p = getPart(this.gltf, name); p.position.set(x, 0, z); p.rotation.y = ry; p.scale.setScalar(s);
    p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (tint) { o.material = o.material.clone(); this.ownedMaterials.add(o.material); o.material.color.multiply(new THREE.Color(tint)); } } });
    this.group.add(p); return p;
  }

  placeLibraryProps(asset, transforms) {
    const source = this.hubModels[asset.id]?.scene;
    if (!source || !this.hubModels[asset.id]?.scene.userData.libraryAsset || !transforms.length) return false;
    source.updateMatrixWorld(true);
    source.traverse((node) => {
      if (!node.isMesh || node.isSkinnedMesh) return;
      const material = node.material;
      const mesh = new THREE.InstancedMesh(node.geometry, material, transforms.length);
      const local = node.matrixWorld.clone();
      const object = new THREE.Object3D();
      transforms.forEach((transform, index) => {
        object.position.set(transform.x, 0, transform.z); object.rotation.set(0, transform.ry || 0, 0); object.scale.setScalar(transform.s || 1); object.updateMatrix();
        mesh.setMatrixAt(index, object.matrix.multiply(local));
      });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      this.group.add(mesh);
    });
    return true;
  }

  // ================= 로비 (기존 소형 아레나) =================
  buildLobby() {
    this.clear();
    const T = THEMES.lobby;
    // 현재 마을의 하늘·안개·조명. 서약의 성채 값은 기존 광장과 같다.
    // 캠페인 지역 마을(2~6지역)이 열려 있으면 그 마을의 하늘·안개·조명을 쓴다. 1지역은 서비스 마을 값 그대로다.
    const townId = activeTownId(), skin = activeCampaignSkin(), A = (skin || TOWN_THEMES[townId] || TOWN_THEMES.oathhold).atmosphere;
    this.scene.background = new THREE.Color(A.bg); this.scene.fog.color.set(A.fog); this.scene.fog.density = A.density;
    const hemi = new THREE.HemisphereLight(A.hemi[0], A.hemi[1], A.hemiI); this.scene.add(hemi); this.lights.push(hemi);
    const sun = new THREE.DirectionalLight(A.sun, A.sunI); sun.position.set(...A.sunPos); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -15; sun.shadow.camera.right = sun.shadow.camera.top = 15;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50; sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.02;
    this.scene.add(sun); this.lights.push(sun);
    this.lobbyHall = buildCitadelHubScene({ models: this.hubModels, environmentTexture: this.renderer.characterEnvironment.texture, quality: this.renderer.quality, camera: this.renderer.camera,
      townId, skin, libraryProps: townLibraryProps(townId, this.hubModels), emerging: takeEmergingGates() }); this.group.add(this.lobbyHall);
    this.lobbyWorld = buildLobbyWorld({ quality: this.renderer.quality, townId, skin }); this.group.add(this.lobbyWorld);
    this.renderer.lobbyOccluders = [];this.lobbyHall.traverse(o=>{if(o.isMesh)this.renderer.lobbyOccluders.push(o);});
    this.lobbyHall.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.material.envMap = this.renderer.characterEnvironment.texture; o.material.envMapIntensity = .3; } });
    const rim = new THREE.DirectionalLight(A.rim, A.rimI); rim.position.set(2, 4, -4);
    this.scene.add(rim); this.lights.push(rim);
    this.floorData = null;
  }

  // ================= 무한의 성 — 한 층 전체 =================
  buildSky(visual, seed = 1) {
    const sky = visual?.sky || { top: 0x101828, horizon: 0x64778a, ground: 0x18202c, stars: 0xcfe8ff, celestial: 0xffd9a2, density: .25 };
    const group = this.skyGroup = new THREE.Group(); group.name = `sky-${visual?.key || 'memorial'}`; group.renderOrder = -10;
    const geometry = new THREE.SphereGeometry(105, 32, 18);
    const colors = [];
    const top = new THREE.Color(sky.top), horizon = new THREE.Color(sky.horizon), ground = new THREE.Color(sky.ground);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i) / 105;
      const t = Math.max(0, Math.min(1, (y + .05) / 1.05));
      const color = y < .05 ? ground.clone().lerp(horizon, Math.max(0, (y + 1) / 1.05)) : horizon.clone().lerp(top, t);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false })));
    const random = mulberry32((seed || 1) ^ 0x7f31);
    const points = [];
    for (let i = 0; i < Math.floor(220 * (sky.density ?? .25)); i++) {
      const theta = random() * Math.PI * 2, y = .16 + random() * .78, radius = 96;
      const ring = Math.sqrt(1 - y * y); points.push(Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius);
    }
    const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    group.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: sky.stars, size: .34, transparent: true, opacity: .8, depthWrite: false, fog: false })));
    // The browser receives the authored glow texture; headless Bun tests do not
    // expose a canvas/document, so keep the procedural sky itself test-safe.
    if (typeof document !== 'undefined') {
      const celestial = new THREE.Sprite(new THREE.SpriteMaterial({ map: softCircleTex(), color: sky.celestial, transparent: true, opacity: .9, depthWrite: false, fog: false }));
      celestial.position.set(-36, 42, -76); celestial.scale.setScalar(8); group.add(celestial);
    }
    this.scene.add(group);
  }
  /** 랜드마크 원본을 재질별 병합 지오메트리로 만든다(층 정리 때 소유 지오메트리로 회수). 병합할 수 없으면 null → 기존 복제 경로. */
  _landmarkBatches(source) {
    source.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(source.matrixWorld).invert(), local = new THREE.Matrix4();
    const bins = new Map(); let failed = false;
    source.traverse((node) => {
      if (failed || !node.isMesh) return;
      if (node.isSkinnedMesh || Array.isArray(node.material)) { failed = true; return; }
      const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
      geometry.applyMatrix4(local.multiplyMatrices(inverse, node.matrixWorld));
      if (!bins.has(node.material)) bins.set(node.material, { parts: [], castShadow: false, receiveShadow: false });
      const bin = bins.get(node.material); bin.parts.push(geometry);
      bin.castShadow ||= node.castShadow; bin.receiveShadow ||= node.receiveShadow;
    });
    const batches = [];
    for (const [material, bin] of bins) {
      const geometry = failed ? null : mergeGeometries(bin.parts);
      for (const part of bin.parts) part.dispose();
      if (!geometry) failed = true;
      else { this.ownedGeometry.add(geometry); batches.push({ geometry, material, castShadow: bin.castShadow, receiveShadow: bin.receiveShadow }); }
    }
    if (failed) { for (const batch of batches) { batch.geometry.dispose(); this.ownedGeometry.delete(batch.geometry); } return null; }
    return batches;
  }
  mountLandmarks(floorData, visual) {
    if (!this.landmarkGltf || !visual?.landmark) return;
    const source = this.landmarkGltf.scene.getObjectByName(`TLL_Dungeon_${visual.landmark}_Landmark`);
    if (!source) return;
    const slots = floorData.rooms.filter((room) => !room.objectiveProp &&
      (room.type === ROOM_TYPE.BOSS || room.type === ROOM_TYPE.ELITE || room.type === ROOM_TYPE.TREASURE)).slice(0, 4);
    if (!slots.length) return;
    // 랜드마크 하나가 메시 수십 개(별빛 서고 58개)라 방마다 통째로 복제하면 draw call이 수백 개 늘어난다.
    // 재질별로 한 번 병합한 뒤 방 슬롯에 인스턴싱해 같은 모양·배치를 재질 수만큼의 draw call로 그린다.
    const batches = this._landmarkBatches(source);
    if (batches) {
      const object = new THREE.Object3D();
      for (const batch of batches) {
        const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, slots.length);
        slots.forEach((room, index) => {
          object.position.set(room.x, 0, room.z - room.h / 2 + 2.6); object.rotation.copy(source.rotation); object.rotation.y = (room.id % 4) * Math.PI / 2;
          object.scale.setScalar(room.type === ROOM_TYPE.BOSS ? 1.18 : .72); object.updateMatrix(); mesh.setMatrixAt(index, object.matrix);
        });
        mesh.name = `${source.name}-batch`; mesh.castShadow = batch.castShadow; mesh.receiveShadow = batch.receiveShadow;
        mesh.computeBoundingSphere(); this.group.add(mesh);
      }
      return;
    }
    for (const room of slots) {
      const landmark = source.clone(true); landmark.position.set(room.x, 0, room.z - room.h / 2 + 2.6); landmark.rotation.y = (room.id % 4) * Math.PI / 2; landmark.scale.setScalar(room.type === ROOM_TYPE.BOSS ? 1.18 : .72); landmark.name = `${source.name}-${room.id}`; this.group.add(landmark);
    }
  }
  buildFloor(floorData, theme = 'crypt', visual = null) {
    this.clear();
    this.floorData = floorData;
    const visualKey = visual?.landmark || floorData.layout?.landmark || 'crypt';
    const field = floorData.layout?.field;
    const concept = floorData.layout?.concept;
    const archive = isStarArchive(floorData);
    const T = { ...(THEMES[theme] || THEMES.crypt), ...(DUNGEON_ATMOSPHERES[visualKey] || {}), ...(FIELD_ATMOSPHERES[field] || {}), ...(archive ? STAR_ARCHIVE_ATMOSPHERE : {}) };
    const random = mulberry32((floorData.seed || floorData.floor * 7919) ^ 0x51a7);
    const rnd = (a, b) => a + random() * (b - a);
    // 컨셉 던전은 먼 절벽·수문이 보이는 열린 분지라 안개를 옅게 둔다.
    this.scene.background = new THREE.Color(T.bg); this.scene.fog.color.set(T.fog); this.scene.fog.density = archive ? .014 : field ? .008 : concept ? .011 : .026;
    this.buildSky(visual, floorData.seed || floorData.floor || 1);

    const hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], archive ? 1.05 : 1.5); this.scene.add(hemi); this.lights.push(hemi);
    // 넓은 맵이라 태양 그림자 카메라는 플레이어를 따라다니게 (update 에서 갱신)
    const sun = new THREE.DirectionalLight(T.sun, T.sunI); sun.position.set(10, 22, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -22; sun.shadow.camera.right = sun.shadow.camera.top = 22;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 70; sun.shadow.bias = -0.0018; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target); this.lights.push(sun, sun.target); this.sun = sun;

    if (field) {
      this.fieldScene = buildOpenFieldScene(floorData, this.renderer.quality);
      this.fieldScene.traverse(node => { if(node.isMesh && node.name !== 'field-walkable-ground' && node.name !== 'field-ocean' && node.name !== 'field-backdrop')this.occlusion.bind(node.material); });
      this.group.add(this.fieldScene); this.buildSeals(floorData); this.mountTownDecor(floorData); return;
    }

    if (concept) {
      // 자체 생성 컨셉 지형: 보행면·충돌 경계 난간·배경 볼륨을 한 모듈이 소유하고 시선 셰이더만 공유한다.
      this.conceptTerrain = buildConceptTerrain(floorData, concept, { quality: this.renderer.quality, bindSightline: material => this.occlusion.bind(material) });
      this.group.add(this.conceptTerrain); this.buildSeals(floorData); return;
    }

    // ---- 바닥 (방 + 복도) ----
    const tiles = collectDungeonTiles(floorData, random, TILE);
    this.group.userData.dungeonSurface = { sampledTiles: tiles.sampledTiles, uniqueTiles: tiles.uniqueTiles };
    for (const k in tiles.transforms) this.instanced(k, tiles.transforms[k], T.tint, { castShadow: false, dungeonSurface: true, starArchiveSurface: archive });

    // ---- 벽: 1m 건축 마스크 경계 바깥에 정렬한다 ----
    const walls = { wall: [], wall_cracked: [], wall_broken: [], wall_arched: [], wall_window_open: [] };
    // 예전 4m 표본의 난수 소비 횟수는 그대로 두어 뒤의 방 장식 배치를 보존한다.
    let legacyVariantDraws = 0;
    const W = floorData;
    const step = TILE;
    const seen = new Set();
    for (const rect of [...floorData.rooms, ...floorData.corridors]) {
      const x0 = Math.floor((rect.x - rect.w / 2) / step) * step, x1 = Math.ceil((rect.x + rect.w / 2) / step) * step;
      const z0 = Math.floor((rect.z - rect.h / 2) / step) * step, z1 = Math.ceil((rect.z + rect.h / 2) / step) * step;
      for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
        const cx = x + step / 2, cz = z + step / 2;
        // 4방향 중 걷기 불가 쪽에 벽
        const sides = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]];
        for (const [dx, dz, ry] of sides) {
          const nx = cx + dx * step, nz = cz + dz * step;
          if (W.walkable(nx, nz)) continue;
          const kk = `${Math.round(cx)}_${Math.round(cz)}_${dx}_${dz}`;
          if (seen.has(kk)) continue; seen.add(kk);
          random(); legacyVariantDraws++;
        }
      }
    }
    // 자산의 실제 두께로 1m 홈의 반대편 보행 셀까지 검사한다.
    const wallDepths = {};
    for (const name in walls) {
      const { mesh, part } = this._meshOf(name); if (!mesh) continue;
      part.updateWorldMatrix(true, true);
      const local = new THREE.Matrix4().copy(part.matrixWorld).invert().multiply(mesh.matrixWorld);
      const bounds = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position')).applyMatrix4(local);
      wallDepths[name] = bounds.max.z - bounds.min.z;
    }
    const alignedWalls = fitDungeonWallSegments(floorData, collectDungeonWallSegments(floorData), wallDepths);
    for (const wall of alignedWalls) walls[wall.variant].push(wall);
    this.group.userData.dungeonWalls = { segments: alignedWalls.length, legacyVariantDraws };
    for (const k in walls) this.instanced(k, walls[k], T.tint, { cutaway: true, alignedWall: true, starArchiveStone: archive });

    // ---- 방 장식 ----
    const pillars = [], banners = [];
    const props = ['barrel_large', 'barrel_small_stack', 'crates_stacked', 'box_stacked', 'rubble_half', 'keg', 'trunk_large_A', 'table_medium_broken', 'candle_triple', 'sword_shield_broken'];
    const libraryPropByTarget = new Map(libraryAssets('prop').filter((asset) => asset.replaces).map((asset) => [asset.replaces, asset]));
    const libraryPropTransforms = new Map();
    const addLibraryProp = (name, transform) => {
      const asset = libraryPropByTarget.get(name);
      if (!asset) return false;
      if (!this.hubModels[asset.id]?.scene.userData.libraryAsset) return false;
      const list = libraryPropTransforms.get(asset) || []; list.push(transform); libraryPropTransforms.set(asset, list); return true;
    };
    for (const r of floorData.rooms) {
      const hw = r.w / 2 - 1.6, hh = r.h / 2 - 1.6;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pillars.push({ x: r.x + sx * hw, z: r.z + sz * hh, s: r.type === ROOM_TYPE.BOSS ? 1.25 : 1 });
      if (r.type === ROOM_TYPE.BOSS) {
        banners.push({ x: r.x - 5, z: r.z - r.h / 2 + 0.6, ry: 0 }, { x: r.x + 5, z: r.z - r.h / 2 + 0.6, ry: 0 });
        if (!floorData.layout) this.place('stairs_wide', r.x, r.z - r.h / 2 + 2.2, 0, 1, T.tint);
      }
      if (r.type === ROOM_TYPE.TREASURE && !r.objectiveProp) { const chest = { x: r.x, z: r.z, ry: rnd(0, 6.28), s: 1.2 }; this.chestPoses?.set(r.id, chest); if (!this.interactiveChests && !addLibraryProp('chest_gold', chest)) this.place('chest_gold', chest.x, chest.z, chest.ry, chest.s); this.place('coin_stack_large', r.x + 1.6, r.z + 1.2, 0, 1); this.place('coin_stack_medium', r.x - 1.7, r.z + 0.9, 0, 1); }
      const n = floorData.layout ? 0 : 2 + Math.floor(random() * 3);
      for (let i = 0; i < n; i++) {
        const px = r.x + rnd(-1, 1) * (r.w / 2 - 2.2), pz = r.z + rnd(-1, 1) * (r.h / 2 - 2.2);
        if (Math.hypot(px - r.x, pz - r.z) < 3.5) continue;
        const prop = props[Math.floor(random() * props.length)], transform = { x: px, z: pz, ry: rnd(0, 6.28), s: rnd(0.9, 1.1) }; if (!addLibraryProp(prop, transform)) this.place(prop, transform.x, transform.z, transform.ry, transform.s);
      }
      // 방마다 횃불 2개
      for (const [ox, oz] of [[-hw, 0], [hw, 0]]) {
        const lx = r.x + ox, lz = r.z + oz;
        if (!archive) this.torchPos.push(new THREE.Vector3(lx, 2.6, lz));
        if (this.torches.length < 14) {
          const intensity = archive ? 9 : 22;
          const l = new THREE.PointLight(T.torch, intensity, 15, 2); l.position.set(lx, archive ? 5 : 3, lz);
          this.scene.add(l); this.lights.push(l); this.torches.push({ l, i0: intensity, seed: this.torches.length * 1.7, room: r });
        }
      }
      // 방 역할은 기존 지역 건축 배치에 병합된 실제 회랑 문턱 표식이 나타낸다.
    }
    for (const [asset, transforms] of libraryPropTransforms) this.placeLibraryProps(asset, transforms);
    if (!archive) this.instanced('pillar_decorated', pillars, T.tint, { cutaway: true });
    this.instanced('banner_shield_red', banners);
    this.regionArchitecture = buildRegionArchitecture(floorData, theme);
    this.regionArchitecture.traverse(node => {
      if (archive && node.isMesh && node.material.isMeshStandardMaterial) {
        node.material.envMap = this.renderer.characterEnvironment?.texture || null;
        node.material.envMapIntensity = .45;
      }
      if (node.isMesh && !node.userData.surface) for (const material of Array.isArray(node.material) ? node.material : [node.material]) this.occlusion.bind(material);
    });
    this.group.add(this.regionArchitecture);
    if (!archive) {
      this.mountTownDecor(floorData);
      this.mountLandmarks(floorData, visual || { landmark: visualKey });
      this.mountGlassGardenDecor(floorData);
    }
    this.buildSeals(floorData);
  }

  /** 잿불 항구·별마루 설원 던전과 필드에 마을 테마 장식(라이브러리 소품 우선, 없으면 절차적)을 얹는다. */
  mountTownDecor(floorData) {
    const townId = townDecorFor(floorData); if (!townId) return;
    const libraryProps = libraryAssets('prop').filter((asset) => asset.tags?.includes('town:' + townId))
      .map((asset) => ({ asset, scene: this.hubModels[asset.id]?.scene })).filter((entry) => entry.scene?.userData?.libraryAsset);
    this.townDecor = buildTownDecor(floorData, townId, { libraryProps });
    this.group.add(this.townDecor);
  }

  /** 첫 던전 유리 정원만: Blender 소품 키트를 방 가장자리에 방별 병합 메시로 얹는다. 키트가 없으면 조용히 건너뛴다. */
  mountGlassGardenDecor(floorData) {
    if (floorData.expeditionRouteId !== 'glass_garden') return;
    const templates = glassGardenKitTemplates();
    if (!templates) { preloadGlassGardenKit().catch(() => {}); return; }
    const decor = buildGlassGardenDecor(floorData, { templates, quality: this.renderer.quality, occlusion: this.occlusion });
    this.glassGardenDecor = decor; this.group.add(decor);
  }

  update(dt, fx, playerPos) {
    this.regionArchitecture?.userData.update?.(dt);
    this.fieldScene?.userData.update(dt);
    this.conceptTerrain?.userData.update(dt);
    if (this.skyGroup && playerPos) this.skyGroup.position.set(playerPos.x, 0, playerPos.z);
    this.occlusion.setTarget(this.floorData ? playerPos : null);
    this.t += dt;
    for (const s of this.seals) { s.material.opacity = 0.5 + Math.sin(this.t * 4) * 0.08; const r = s.userData.rune, g = s.userData.sigil; if (r) { r.rotation.z += dt * 0.8; r.material.opacity = 0.55 + Math.sin(this.t * 6) * 0.2; } if (g) { g.rotation.z -= dt * 0.5; g.material.opacity = 0.8 + Math.sin(this.t * 5) * 0.15; } }
    for (const t of this.torches) t.l.intensity = t.i0 * (0.85 + Math.sin(this.t * 13 + t.seed) * 0.08 + Math.sin(this.t * 31 + t.seed * 3) * 0.07);
    if (this.sun && playerPos) {
      const archive = isStarArchive(this.floorData);
      this.sun.position.set(playerPos.x + (archive ? -6 : 10), archive ? 18 : 22, playerPos.z + (archive ? -8 : 8));
      this.sun.target.position.copy(playerPos); this.sun.target.updateMatrixWorld();
    }
    if (fx && this.torchPos.length && Math.random() < dt * 24 && playerPos) {
      const p = this.torchPos[Math.floor(Math.random() * this.torchPos.length)];
      if (Math.abs(p.x - playerPos.x) < 22 && Math.abs(p.z - playerPos.z) < 22)
        fx.embers(p, 0xff9a30, { n: 1, radius: 0.2, life: 0.9, size: 0.3, rise: 1.5 });
    }
  }
}


