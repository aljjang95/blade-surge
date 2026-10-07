import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { spawnCharacter, disposeCharacter } from '../engine/assets.js';
import { CITADEL_HUB, CITADEL_HUB_HOTSPOTS, CITADEL_HUB_PROPS, CITADEL_HUB_ASSET_ROOT } from '../data/citadel-hub.js';
import { preloadEnvironmentKit, buildEnvironmentInstances } from '../engine/environment-kit-asset.js';
import { CanopySightline } from '../engine/canopy-sightline.js';
import { createCitadelGateDesignLibrary } from './citadel-gate-designs.js';

const templates = new Map();
const pending = new Map();
const loader = new GLTFLoader();

/**
 * 시각 자산은 선택 사항이며 제한된 실패 뒤에도 광장 플레이를 유지한다.
 * @param {{ quality?: string, fetcher?: (path: string, init?: RequestInit) => Promise<Response> }} [options]
 */
export async function preloadCitadelHubAssets({ quality = 'high', fetcher = globalThis.fetch } = {}) {
  const environmentReady = preloadEnvironmentKit({ fetcher });
  const suffix = quality === 'low' ? '-lod1' : '';
  const assets = [...new Set([...CITADEL_HUB_HOTSPOTS.filter(s => s.kind !== 'dungeon'), ...CITADEL_HUB_PROPS].map(s => s.asset).filter(Boolean)), `${CITADEL_HUB_ASSET_ROOT}paving.glb`];
  const results = await Promise.all(assets.map(async basePath => {
    const selected = suffix ? basePath.replace(/\.glb$/, `${suffix}.glb`) : basePath;
    if (!pending.has(selected)) pending.set(selected, (async () => {
      for (const path of selected === basePath ? [basePath] : [selected, basePath]) {
        try {
          const response = await fetcher(path, { signal: AbortSignal.timeout(4500) });
          if (!response.ok) continue;
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 3000000) continue;
          const gltf = await loader.parseAsync(bytes, path.slice(0, path.lastIndexOf('/') + 1));
          templates.set(basePath, gltf.scene);
          return true;
        } catch { /* Individual visual failures do not block the game. */ }
      }
      return false;
    })());
    return { path: basePath, loaded: await pending.get(selected) };
  }));
  return { loaded: results.filter(r => r.loaded).length, total: assets.length, results, environment: await environmentReady };
}

/** The visible geometry and collision data refer to the same ground plane (y=0). */
export function buildCitadelHubScene({ models = {}, environmentTexture = null, quality = 'high', assets = templates, camera = null } = {}) {
  const root = new THREE.Group(); root.name = 'Citadel_PlayableHub';
  const geometryOwned = new Set(), materialsOwned = new Set(), texturesOwned = new Set();
  const characters = [], markers = new Map(), labels = [], gateNodes = new Map();
  const gateDesigns = createCitadelGateDesignLibrary({ environmentTexture, quality });
  let authoredAssetCount = 0;
  const mat = (color, options = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .88, metalness: .03, ...options });
    if (environmentTexture) { m.envMap = environmentTexture; m.envMapIntensity = .25; }
    materialsOwned.add(m); return m;
  };
  const basic = (color, options = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, ...options }); materialsOwned.add(m); return m;
  };
  const stone = mat(0x455d65), slate = mat(0x3b535e), ivory = mat(0xd9d5c5);
  const gold = mat(0xb69b68, { metalness: .35, roughness: .68 });
  const shadowStone = mat(0x263e48), wood = mat(0x715e48), teal = mat(0x518b81);
  const transform = new THREE.Object3D();
  function batch(parent = root) {
    const bins = new Map();
    const add = (geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      transform.position.set(x, y, z); transform.rotation.set(rx, ry, rz); transform.scale.set(1, 1, 1);
      transform.updateMatrix(); geo.applyMatrix4(transform.matrix);
      if (!bins.has(material)) bins.set(material, []); bins.get(material).push(geo);
    };
    const box = (w, h, d, material, x, y, z, ry = 0) => add(new THREE.BoxGeometry(w, h, d), material, x, y, z, 0, ry);
    const cylinder = (r, h, material, x, y, z, sides = 12, rTop = r) => add(new THREE.CylinderGeometry(rTop, r, h, sides), material, x, y, z);
    const ring = (r, tube, material, x, y, z, rx = -Math.PI / 2, arc = Math.PI * 2) => add(new THREE.TorusGeometry(r, tube, 5, 36, arc), material, x, y, z, rx);
    const finish = () => {
      for (const [material, pieces] of bins) {
        const geometry = mergeGeometries(pieces); for (const piece of pieces) piece.dispose();
        if (!geometry) continue;
        geometryOwned.add(geometry);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true; mesh.castShadow = false; parent.add(mesh);
      }
    };
    return { add, box, cylinder, ring, finish };
  }
  const plaza = batch();
  plaza.box(25.6, .32, 25.6, shadowStone, 0, -.22, 0);
  plaza.box(25.1, .08, 25.1, stone, 0, -.045, 0);
  const pavingPath = `${CITADEL_HUB_ASSET_ROOT}paving.glb`;
  const pavingSource = (assets instanceof Map ? assets.get(pavingPath) : assets[pavingPath]);
  // Broad low-contrast paving provides scale without disguising the routes.
  if (!pavingSource) for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) {
    const x = -11.5 + col * 2.09, z = -11.5 + row * 2.09;
    plaza.box(2.03, .012, 2.03, (row + col) % 4 === 0 ? slate : stone, x, -.006, z);
  }
  // A flush compass and inlaid perimeter walk, never a raised hero pedestal.
  plaza.ring(3.4, .028, gold, 0, .037, 0); plaza.ring(3.1, .018, ivory, 0, .039, 0);
  for (const axis of [0, Math.PI / 2]) {
    plaza.box(.06, .008, 24, gold, 0, .04, 0, axis);
    plaza.box(.025, .008, 24, ivory, .19 * Math.cos(axis), .04, -.19 * Math.sin(axis), axis);
  }
  for (const side of [-1, 1]) {
    plaza.box(24.1, .01, .12, gold, 0, .035, side * 9.5);
    plaza.box(.12, .01, 24.1, gold, side * 9.5, .035, 0);
  }
  // The edge is outside the movement bounds; no hidden collision walls cross a route.
  for (const side of [-1, 1]) {
    plaza.box(25.4, .38, .32, ivory, 0, .16, side * 12.62);
    plaza.box(.32, .38, 25.4, ivory, side * 12.62, .16, 0);
    plaza.box(25.4, .04, .37, gold, 0, .37, side * 12.62);
    plaza.box(.37, .04, 25.4, gold, side * 12.62, .37, 0);
  }
  plaza.finish();

  function cloneAsset(path, parent) {
    const source = assets instanceof Map ? assets.get(path) : assets[path];
    const template = source?.scene || source;
    if (!template) return false;
    const clone = template.clone(true), clonedMaterials = new Map();
    clone.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false; node.receiveShadow = true;
      const materialCopy = material => {
        if (!clonedMaterials.has(material)) {
          const copy = material.clone(); materialsOwned.add(copy); clonedMaterials.set(material, copy);
          if (environmentTexture && copy.isMeshStandardMaterial) { copy.envMap = environmentTexture; copy.envMapIntensity = .3; }
        }
        return clonedMaterials.get(material);
      };
      node.material = Array.isArray(node.material) ? node.material.map(materialCopy) : materialCopy(node.material);
    });
    parent.add(clone); authoredAssetCount++; return true;
  }

  // One shared tile buffer per authored material draws all 100 paving tiles.
  if (pavingSource) {
    const source = pavingSource.scene || pavingSource;
    source.updateMatrixWorld(true);
    const top = new THREE.Box3().setFromObject(source).max.y;
    source.traverse(node => {
      if (!node.isMesh) return;
      const copy = material => {
        const next = material.clone(); materialsOwned.add(next);
        if (environmentTexture && next.isMeshStandardMaterial) { next.envMap = environmentTexture; next.envMapIntensity = .25; }
        return next;
      };
      const material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      const tiles = new THREE.InstancedMesh(node.geometry, material, 100);
      const placement = new THREE.Matrix4(); let index = 0;
      for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
        placement.makeTranslation(-10.8 + col * 2.4, -top, -10.8 + row * 2.4);
        placement.multiply(node.matrixWorld); tiles.setMatrixAt(index++, placement);
      }
      tiles.name = 'Citadel_AuthoredPaving'; tiles.receiveShadow = true; tiles.castShadow = false;
      tiles.computeBoundingSphere(); root.add(tiles);
    });
    authoredAssetCount++;
  }

  function textLabel(spot, y) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 180;
    const context = canvas.getContext('2d'); if (!context) return null;
    context.fillStyle = 'rgba(17,39,47,.72)'; context.fillRect(2, 2, 764, 176);
    context.strokeStyle = spot.accent || '#c8bea8'; context.lineWidth = 5; context.strokeRect(2, 2, 764, 176);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = '#f5efdf'; context.font = '600 46px "Noto Sans KR", system-ui, sans-serif';
    context.fillText(spot.label, 384, 70, 722);
    context.fillStyle = spot.accent || '#aec7ca'; context.font = '500 26px system-ui, sans-serif';
    const subtitle = spot.kind === 'dungeon' ? `Lv.${spot.minLevel}  ·  에너지 ${spot.energy}` : spot.subtitle;
    context.fillText(subtitle, 384, 128, 714);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texturesOwned.add(texture);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
    materialsOwned.add(material);
    const sprite = new THREE.Sprite(material); sprite.position.set(spot.x, y, spot.z);
    const isNpc = ['merchant', 'trainer', 'steward'].includes(spot.kind);
    sprite.scale.set(isNpc ? 2.3 : 3.6, isNpc ? .539 : .844, 1);
    if (isNpc) sprite.position.y = 2.25;
    sprite.userData.hotspotId = spot.id; root.add(sprite); labels.push({ sprite, spot, isNpc }); return sprite;
  }

  for (const spot of CITADEL_HUB_HOTSPOTS) {
    const node = new THREE.Group(); node.name = `Citadel_Hotspot_${spot.id}`;
    node.userData.hotspotId = spot.id; node.position.set(spot.x, 0, spot.z); node.rotation.y = spot.yaw;
    root.add(node); gateNodes.set(spot.id, node);
    const isGate = ['dungeon', 'campaign', 'arena'].includes(spot.kind);
    if (isGate) {
      node.add(gateDesigns.build(spot));
      textLabel(spot, 4.12);
    } else {
      if (!cloneAsset(spot.asset, node)) {
        if (models[spot.model]) {
          const actor = spawnCharacter(models[spot.model]);
          const idle = actor.clips.Idle; if (idle) actor.mixer.clipAction(idle).play();
          actor.mixer.update(0); actor.root.scale.multiplyScalar(.92); node.add(actor.root); characters.push(actor);
          actor.root.traverse(o => { if (o.isMesh) o.castShadow = false; });
        } else {
          const b = batch(node), coat = mat(spot.accent || '#83bdb5');
          b.cylinder(.28, .78, coat, 0, .77, 0, 8, .19);
          b.add(new THREE.SphereGeometry(.17, 10, 8), ivory, 0, 1.43, 0);
          for (const side of [-1, 1]) { b.box(.13, .46, .15, shadowStone, side * .12, .23, 0); b.box(.13, .55, .13, coat, side * .29, .95, 0); }
          b.cylinder(.22, .16, gold, 0, 1.58, 0, 8, .15); b.finish();
        }
      }
      textLabel(spot, 2.48);
    }
    const material = basic(spot.accent || '#b3d9ca', { transparent: true, opacity: .18, side: THREE.DoubleSide, depthWrite: false });
    const geometry = new THREE.RingGeometry(isGate ? .92 : .63, isGate ? 1.04 : .73, 40); geometryOwned.add(geometry);
    const marker = new THREE.Mesh(geometry, material); marker.rotation.x = -Math.PI / 2; marker.position.set(spot.x, .05, spot.z);
    marker.userData.hotspotId = spot.id; root.add(marker); markers.set(spot.id, marker);
  }

  const booth = batch(); let authoredStall = false;
  for (const prop of CITADEL_HUB_PROPS) {
    const node = new THREE.Group(); node.name = `Citadel_Prop_${prop.id}`;
    node.position.set(prop.x, 0, prop.z); node.rotation.y = prop.yaw; root.add(node);
    if (cloneAsset(prop.asset, node)) { if (prop.kind === 'stall') authoredStall = true; continue; }
    const b = batch(node);
    if (prop.kind === 'bench') {
      b.box(1.94, .12, .65, wood, 0, .46, 0);
      b.box(1.94, .35, .1, teal, 0, .69, -.27);
      for (const side of [-1, 1]) b.box(.16, .45, .55, ivory, side * .75, .22, 0);
    } else if (prop.kind === 'planter') {
      b.box(2, .44, .6, ivory, 0, .22, 0); b.box(1.83, .045, .44, shadowStone, 0, .46, 0);
      for (const x of [-.6, 0, .6]) b.add(new THREE.IcosahedronGeometry(.32, 0), teal, x, .72, 0);
    } else if (prop.kind === 'lamp') {
      b.cylinder(.13, 1.95, gold, 0, .98, 0); b.cylinder(.19, .11, ivory, 0, .055, 0);
      b.box(.25, .33, .25, ivory, 0, 2.13, 0); b.add(new THREE.ConeGeometry(.22, .2, 4), gold, 0, 2.4, 0);
    } else if (prop.kind === 'stall') {
      b.box(2.5, .14, .7, wood, 0, .83, 0);
      for (const x of [-1, 1]) b.box(.14, .79, .55, wood, x, .4, 0);
      b.box(2.3, .48, .035, teal, 0, .59, -.365); b.box(2.35, .035, .08, gold, 0, .81, -.39);
    }
    b.finish();
  }
  const bottleMaterials = [mat(0x96ddbc, { roughness: .35 }), mat(0xc89c7d, { roughness: .4 }), mat(0x83bddd, { roughness: .4 })];
  for (let i = 0; i < 9; i++) {
    const x = -7.22 + i * .21, z = authoredStall ? 7.08 : i % 2 ? 7.31 : 7.46;
    const y = authoredStall ? 1.22 : .99;
    booth.cylinder(.065, .18, bottleMaterials[i % 3], x, y, z, 8, .05);
    booth.cylinder(.023, .09, gold, x, y + .13, z, 8);
  }
  booth.finish();

  // 기존 충돌·입구와 같은 광장을 쓰며 높은 수목은 이동 경계 밖에 둔다.
  const grove = [];
  for (const side of [-1, 1]) {
    for (const z of [-8.4, -2.8, 3.5]) {
      grove.push({ asset: z === -2.8 ? 'broadleaf-tree' : 'evergreen-tree', x: side * 15.4, z,
        y: -.42, yaw: side * .7, scale: z === -2.8 ? .85 : .9 });
    }
    grove.push({ asset: 'broadleaf-tree', x: side * 13.8, z: -16.8, y: -.4, yaw: side, scale: 1.05 });
    grove.push({ asset: 'mossy-rock-cluster', x: side * 6, z: -4.8, y: .47, yaw: side, scale: .28 });
    for (const z of [-5.5, 4.5]) grove.push({ asset: 'lantern', x: side * 13.7, z, y: -.35, scale: .92 });
  }
  grove.push({ asset: 'timber-cottage', x: -9, z: 13.7, y: -.4, yaw: Math.PI, scale: .72 });
  const gardenAssets = buildEnvironmentInstances(grove, { name: 'Citadel_PlazaGarden' });
  if (gardenAssets.userData.batchCount) root.add(gardenAssets);
  const courtyardTrees = buildEnvironmentInstances([-1, 1].map(side => ({
    asset: 'broadleaf-tree', x: side * 6, z: -4.8, y: .47, yaw: side * .9, scale: .57,
  })), { name: 'Citadel_CourtyardTrees' });
  const canopySightline = new CanopySightline();
  courtyardTrees.traverse(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) canopySightline.bind(material);
  });
  if (courtyardTrees.userData.batchCount) root.add(courtyardTrees);

  // 물약상의 직물, 상자와 화단을 정적 배치로 묶어 시장의 쓰임을 읽게 한다.
  const market = batch(), cloth = mat(0x477b6c), earth = mat(0x2e5041), bloom = mat(0xb9d6a5);
  const lawn = mat(0x365a46), pathStone = mat(0x6b7f80);
  // 낮은 녹지와 넓은 돌길이 같은 지면에서 광장의 구역을 읽게 한다.
  market.box(4.6, .008, 23.8, pathStone, 0, .019, 0);
  market.box(24.6, .008, 2.15, pathStone, 0, .019, -2.5);
  for (const side of [-1, 1]) {
    market.add(new THREE.CircleGeometry(1, 24).scale(2.1, 3.2, 1), lawn, side * 6, .024, -3.2, -Math.PI / 2);
    market.add(new THREE.RingGeometry(.96, 1, 24).scale(2.28, 3.38, 1), ivory, side * 6, .025, -3.2, -Math.PI / 2);
  }
  if (!authoredStall) {
    for (const side of [-1, 1]) {
      market.box(.14, 2.65, .14, wood, -6.4 + side * 1.1, 1.32, 7.75);
      market.box(.13, 2.4, .13, wood, -6.4 + side * 1.1, 1.2, 6.8);
    }
    market.box(2.52, .06, 1.28, cloth, -6.4, 2.66, 7.32);
  }
  for (const side of [-1, 1]) {
    market.box(.65, .6, .62, wood, -6.4 + side * .85, .3, 7.47);
    market.box(.7, .07, .66, gold, -6.4 + side * .85, .64, 7.47);
    for (const z of [-4.8, -1.3]) {
      market.box(1.6, .06, .4, earth, side * 6, z === -4.8 ? .49 : -.01, z);
      if(z!==-4.8)continue;
      for(let i=0;i<6;i++) {
        const x=side*6-.72+i*.29;
        market.add(new THREE.IcosahedronGeometry(.15,0),i%2?teal:bloom,x,.67+(i%2)*.08,z);
      }
    }
  }
  for (const side of [-1, 1]) {
    // 바닥의 정원 문양은 단차 없이 벤치와 나무를 한 구역으로 묶는다.
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      market.add(new THREE.CircleGeometry(.18, 6), cloth, side * 6 + Math.cos(angle) * 2.1, .04,
        -3.2 + Math.sin(angle) * 3.2, -Math.PI / 2);
    }
  }
  market.finish();

  let disposed = false, nearestId = null;
  root.userData = {
    version: 'citadel-playable-hub-v1', spatial: CITADEL_HUB, hotspots: CITADEL_HUB_HOTSPOTS,
    authoredAssetCount,
    environmentInstanceCount: gardenAssets.userData.instanceCount + courtyardTrees.userData.instanceCount,
    hotspotNodes: gateNodes,
    highlightHotspot(id) {
      if (id === nearestId) return; nearestId = id || null;
      for (const [key, marker] of markers) marker.material.opacity = key === nearestId ? .74 : .18;
      for (const { sprite, spot, isNpc } of labels) {
        sprite.visible = !nearestId || (spot.id === nearestId && !isNpc);
        sprite.material.opacity = spot.id === nearestId ? 1 : isNpc ? .6 : .84;
      }
    },
    update(dt, state = {}) {
      if (disposed) return;
      const { nearestId: nextId, nearest, reducedMotion = false, playerPosition } = state;
      canopySightline.setTarget(playerPosition);
      if (camera) canopySightline.update(camera.position); else canopySightline.disable();
      if (Object.hasOwn(state, 'nearestId') || Object.hasOwn(state, 'nearest')) this.highlightHotspot(nextId ?? nearest?.id ?? null);
      if (!reducedMotion) for (const actor of characters) actor.mixer.update(Math.min(dt, .05));
      if (playerPosition) for (const { sprite, spot, isNpc } of labels) {
        const distance = Math.hypot(spot.x - playerPosition.x, spot.z - playerPosition.z), selected = spot.id === nearestId;
        sprite.visible = (!nearestId || (selected && !isNpc)) && (selected || distance < (isNpc ? 9 : quality === 'low' ? 12 : 30));
        if (isNpc) {
          sprite.material.opacity = selected ? 1 : Math.min(.65, Math.max(.2, (9 - distance) / 5));
          sprite.scale.set(selected ? 2.75 : 2.3, selected ? .645 : .539, 1);
        }
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      gateDesigns.dispose();
      gardenAssets.userData.dispose();
      courtyardTrees.userData.dispose(); canopySightline.reset();
      for (const actor of characters) disposeCharacter(actor.root, actor.mixer);
      for (const geometry of geometryOwned) geometry.dispose();
      for (const material of materialsOwned) material.dispose();
      for (const texture of texturesOwned) texture.dispose();
      root.traverse(node => { if (node.isInstancedMesh) node.dispose(); });
      root.removeFromParent();
    },
  };
  return root;
}
