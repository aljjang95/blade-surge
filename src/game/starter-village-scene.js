import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STARTER_ZONES, STARTER_DUMMIES, STARTER_FENCE_ARC, STARTER_VILLAGE_VERSION, STARTER_BEDS, STARTER_CLUTTER, FORGE_POSTS } from '../data/starter-village.js';

// 첫 마을 초보자 구역 장면(src/data/starter-village.js 배치). citadel-hub-scene 이 바닥·구역 소품을 이 모듈에 맡긴다.
// 원칙: 재질별 병합(정적 소품) + 인스턴싱(돌길 조약돌·풀·꽃·울타리) — 구역 전체가 수십 개 draw call 안에 든다.
// 시간 의존 연출(허수아비 흔들림·화로 깜빡임·포탈 소용돌이)은 update(dt)만 쓰며 Math.random 을 프레임에서 부르지 않는다.

/** 결정적 의사난수(배치 전용). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 햇살 정원 마을 기본 색(시안 선택 뒤 조정). 바닥 녹지·돌길·흙 마당·목재·회벽·지붕.
export const STARTER_PALETTE = Object.freeze({
  grass: 0x6b9443, grassDeep: 0x557c3a, path: 0xb3aa98, pathDark: 0x7d776c, dirt: 0xc49a6a, dirtDark: 0x9c7650,
  wood: 0x8a5e3b, woodDark: 0x5f3f27, plaster: 0xeee3c8, roof: 0xc0603c, roofDark: 0x96462d, stone: 0x9a9890, stoneDark: 0x6f6e6a,
  straw: 0xe0bf6a, cloth: 0x3f8f86, clothWarm: 0xd5853a, brass: 0xd6a752, ember: 0xff8a3a, portal: 0x8fe3ff, paper: 0xf4ead2,
  flowers: Object.freeze([0xffd36e, 0xff8fa3, 0xb6a4ff, 0xfff4e0]),
});

/** 길 위인지(풀·꽃을 비운다). 중앙 남북 통로, 동서 가지, 게시판 마당, 훈련장, 대장간 마당. */
export function onStarterPath(x, z, pad = 0) {
  const f = STARTER_ZONES.fountain, st = STARTER_ZONES.statue;
  if (Math.abs(x) < 1.7 + pad && z > -10.4 && z < 11.6) return true;
  if (Math.hypot(x - f.x, z - f.z) < f.radius + 1.9 + pad) return true;
  if (Math.hypot(x - st.x, z - st.z) < 2.4 + pad) return true;
  if (Math.abs(z - 1.3) < 1.2 + pad && x > -5 && x < 6.4) return true;
  if (Math.hypot(x - STARTER_ZONES.board.x, z - STARTER_ZONES.board.z) < 2.1 + pad) return true;
  if (Math.hypot(x - STARTER_ZONES.training.x, z - STARTER_ZONES.training.z) < STARTER_ZONES.training.radius + .5 + pad) return true;
  if (x > 4.2 - pad && x < 10.6 + pad && z > -4.2 - pad && z < 1.6 + pad) return true;
  if (x > 4.6 - pad && x < 9.6 + pad && z > 2.6 - pad && z < 7.6 + pad) return true;
  if (Math.hypot(x - STARTER_ZONES.portal.x, z - STARTER_ZONES.portal.z) < 3 + pad) return true;
  return false;
}

/**
 * @param {{ root: THREE.Group, owned: { geometries: Set<any>, materials: Set<any>, textures: Set<any> }, environmentTexture?: any, quality?: string }} options
 */
export function buildStarterVillage({ root, owned, environmentTexture = null, quality = 'high' }) {
  const P = STARTER_PALETTE, low = quality === 'low';
  const group = new THREE.Group(); group.name = 'StarterVillage'; root.add(group);
  const mat = (color, options = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .86, metalness: .02, ...options });
    if (environmentTexture) { m.envMap = environmentTexture; m.envMapIntensity = .3; }
    owned.materials.add(m); return m;
  };
  const glow = (color, options = {}) => { const m = new THREE.MeshBasicMaterial({ color, ...options }); owned.materials.add(m); return m; };
  const M = {
    grass: mat(P.grass), grassDeep: mat(P.grassDeep), path: mat(0xffffff, { roughness: .92 }), dirt: mat(P.dirt, { roughness: .96 }),
    dirtDark: mat(P.dirtDark), wood: mat(P.wood), woodDark: mat(P.woodDark), plaster: mat(P.plaster), roof: mat(P.roof), roofDark: mat(P.roofDark),
    stone: mat(P.stone), stoneDark: mat(P.stoneDark), straw: mat(P.straw, { roughness: .95 }), cloth: mat(P.cloth, { side: THREE.DoubleSide }),
    clothWarm: mat(P.clothWarm, { side: THREE.DoubleSide }), brass: mat(P.brass, { metalness: .55, roughness: .45 }),
    iron: mat(0x4a4d55, { metalness: .6, roughness: .5 }), paper: mat(P.paper, { side: THREE.DoubleSide }),
    red: mat(0xc8463a), ember: glow(P.ember), emberCore: glow(0xffd27a),
  };
  for (const key of ['grass', 'grassDeep', 'dirt', 'dirtDark', 'red']) M[key].userData.bake = 'ground';
  for (const key of ['wood', 'woodDark', 'plaster', 'roof', 'roofDark', 'stone', 'stoneDark', 'straw', 'cloth', 'clothWarm', 'paper']) M[key].userData.bake = 'matte';
  for (const key of ['brass', 'iron']) M[key].userData.bake = 'metal';
  M.emberCore.userData.bake = 'glow';
  const transform = new THREE.Object3D();
  const bins = new Map();
  // 정적 조각은 재질 색을 정점 색으로 구워 묶음(바닥·무광·금속·발광) 하나로 병합한다. 재질이 수십 개여도 draw call 은 묶음 수만큼이다.
  const bakeKey = material => material.userData.bake || null;
  function bakeColor(geometry, color) {
    const count = geometry.getAttribute('position').count, array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { array[i * 3] = color.r; array[i * 3 + 1] = color.g; array[i * 3 + 2] = color.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    return geometry;
  }
  const bakedMaterials = {
    ground: mat(0xffffff, { vertexColors: true, roughness: .95 }), matte: mat(0xffffff, { vertexColors: true, roughness: .84 }),
    metal: mat(0xffffff, { vertexColors: true, roughness: .45, metalness: .55 }), glow: glow(0xffffff, { vertexColors: true }),
  };
  const add = (geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    transform.position.set(x, y, z); transform.rotation.set(rx, ry, rz); transform.scale.set(sx, sy, sz); transform.updateMatrix();
    const flat = geometry.index ? geometry.toNonIndexed() : geometry; if (flat !== geometry) geometry.dispose();
    flat.applyMatrix4(transform.matrix);
    if (!bins.has(material)) bins.set(material, []); bins.get(material).push(flat);
  };
  const box = (w, h, d, m, x, y, z, ry = 0, rx = 0, rz = 0) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, rx, ry, rz);
  const cyl = (r, h, m, x, y, z, n = 10, rTop = r, rx = 0, rz = 0) => add(new THREE.CylinderGeometry(rTop, r, h, n), m, x, y, z, rx, 0, rz);
  /** 로컬 좌표(원점 x0,z0, 회전 yaw)에서 놓는 도우미. */
  const local = (x0, z0, yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (x, z) => [x0 + x * c + z * s, z0 - x * s + z * c];
    return {
      box: (w, h, d, m, x, y, z, ry = 0, rx = 0, rz = 0) => { const [wx, wz] = at(x, z); box(w, h, d, m, wx, y, wz, yaw + ry, rx, rz); },
      cyl: (r, h, m, x, y, z, n = 10, rTop = r) => { const [wx, wz] = at(x, z); cyl(r, h, m, wx, y, wz, n, rTop); },
      add: (geometry, m, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const [wx, wz] = at(x, z); add(geometry, m, wx, y, wz, rx, yaw + ry, rz, sx, sy, sz); },
    };
  };
  const random = seeded(0x5747);

  // ---------------- 바닥: 잔디 판 + 흙 마당 + 돌길 가장자리 ----------------
  box(25.1, .08, 25.1, M.grass, 0, -.045, 0);
  for (let i = 0; i < 26; i++) {
    // 짙은 잔디 얼룩(높이 차 없이)으로 넓은 녹지의 단조로움을 깬다.
    const x = -11 + random() * 22, z = -11 + random() * 22;
    if (onStarterPath(x, z, .4)) continue;
    add(new THREE.CircleGeometry(.7 + random() * 1.2, 9), M.grassDeep, x, .002, z, -Math.PI / 2, random() * 6);
  }
  const yard = STARTER_ZONES.training;
  add(new THREE.CircleGeometry(yard.radius, 40), M.dirt, yard.x, .006, yard.z, -Math.PI / 2);
  add(new THREE.RingGeometry(yard.radius - .02, yard.radius + .22, 40), M.dirtDark, yard.x, .007, yard.z, -Math.PI / 2);
  // 대장간 마당과 상점 앞마당은 흙바닥.
  box(6.2, .01, 5.6, M.dirt, 7.4, .004, -1.3); box(5, .01, 5, M.dirt, 7.1, .004, 5.1);

  // ---------------- 돌길: 조약돌 인스턴싱(색 변화 포함) ----------------
  const cobbles = [];
  const lay = (x, z) => { if (Math.abs(x) <= 12.2 && Math.abs(z) <= 12.2) cobbles.push([x, z]); };
  const step = low ? .62 : .48;
  const F = STARTER_ZONES.fountain, S = STARTER_ZONES.statue;
  for (let z = 11.6; z > -8; z -= step) for (let x = -1.6; x <= 1.61; x += step) {
    const cx = x + (random() - .5) * .12 + ((Math.round(z / step) % 2) ? step / 2 : 0);
    if (Math.hypot(cx - F.x, z - F.z) < F.radius + .35 || Math.hypot(cx - S.x, z - S.z) < 1.05) continue;
    lay(cx, z);
  }
  // 분수와 영웅상 둘레의 둥근 광장.
  for (let r = F.radius + .45; r < F.radius + 3.3; r += step) for (let a = 0; a < Math.PI * 2; a += step / r) lay(F.x + Math.cos(a) * r, F.z + Math.sin(a) * r);
  for (let r = 1.25; r < 2.4; r += step) for (let a = 0; a < Math.PI * 2; a += step / r) lay(S.x + Math.cos(a) * r, S.z + Math.sin(a) * r);
  for (let x = -4.8; x < 6.2; x += step) for (let z = .3; z <= 2.31; z += step) if (Math.abs(x) > 1.7) lay(x, z + (random() - .5) * .1);
  for (let a = 0; a < Math.PI * 2; a += .2) for (const r of [1.2, 1.75]) lay(STARTER_ZONES.board.x + Math.cos(a) * r, STARTER_ZONES.board.z + Math.sin(a) * r);
  for (let a = 0; a < Math.PI * 2; a += .16) for (const r of [2.2, 2.75]) lay(STARTER_ZONES.portal.x + Math.cos(a) * r, STARTER_ZONES.portal.z + Math.sin(a) * r);
  const cobbleGeometry = new THREE.CylinderGeometry(.21, .23, .06, 6); owned.geometries.add(cobbleGeometry);
  const cobbleMesh = new THREE.InstancedMesh(cobbleGeometry, M.path, cobbles.length);
  const tint = new THREE.Color(), light = new THREE.Color(P.path), dark = new THREE.Color(P.pathDark);
  cobbles.forEach(([x, z], i) => {
    transform.position.set(x, .012, z); transform.rotation.set(0, random() * Math.PI, 0);
    const s = .82 + random() * .36; transform.scale.set(s, 1, s * (.8 + random() * .3)); transform.updateMatrix();
    cobbleMesh.setMatrixAt(i, transform.matrix); cobbleMesh.setColorAt(i, tint.copy(dark).lerp(light, .15 + random() * .7));
  });
  cobbleMesh.name = 'Starter_Cobbles'; cobbleMesh.receiveShadow = true; cobbleMesh.computeBoundingSphere(); group.add(cobbleMesh);

  // ---------------- 풀·꽃: 인스턴싱 두 묶음 ----------------
  const tuftGeometry = new THREE.ConeGeometry(.09, .34, 4); owned.geometries.add(tuftGeometry);
  const flowerGeometry = new THREE.IcosahedronGeometry(.075, 0); owned.geometries.add(flowerGeometry);
  const tufts = [], flowers = [];
  for (let i = 0; i < (low ? 160 : 300); i++) {
    const x = -12 + random() * 24, z = -12 + random() * 24;
    if (onStarterPath(x, z, .15)) continue;
    tufts.push([x, z, random()]);
    if (random() < .3) flowers.push([x + (random() - .5) * .3, z + (random() - .5) * .3, Math.floor(random() * P.flowers.length)]);
  }
  const tuftMesh = new THREE.InstancedMesh(tuftGeometry, mat(0x7fae55, { roughness: .95 }), tufts.length);
  tufts.forEach(([x, z, r], i) => {
    transform.position.set(x, .1, z); transform.rotation.set((r - .5) * .4, r * 6, (r - .5) * .3); const s = .55 + r * .5; transform.scale.set(s, s, s); transform.updateMatrix();
    tuftMesh.setMatrixAt(i, transform.matrix); tuftMesh.setColorAt(i, tint.setHex(r > .5 ? 0x7fae55 : 0x6a9846));
  });
  tuftMesh.name = 'Starter_Grass'; tuftMesh.computeBoundingSphere(); group.add(tuftMesh);
  const flowerMesh = new THREE.InstancedMesh(flowerGeometry, mat(0xffffff, { roughness: .7 }), Math.max(1, flowers.length));
  flowers.forEach(([x, z, c], i) => {
    transform.position.set(x, .3, z); transform.rotation.set(0, 0, 0); transform.scale.setScalar(1); transform.updateMatrix();
    flowerMesh.setMatrixAt(i, transform.matrix); flowerMesh.setColorAt(i, tint.setHex(P.flowers[c]));
  });
  flowerMesh.count = flowers.length; flowerMesh.name = 'Starter_Flowers'; flowerMesh.computeBoundingSphere(); group.add(flowerMesh);

  // ---------------- 둘레: 낮은 돌담 + 생울타리, 남쪽 입구는 비움 ----------------
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const p = -11.2 + i * 2.04;
      if (Math.abs(p) > 2.4) box(2, .5, .46, i % 3 ? M.stone : M.stoneDark, p, .22, side * 12.55);   // 남(+z)·북(-z), 가운데는 입구·포탈
      box(.46, .5, 2, i % 3 ? M.stone : M.stoneDark, side * 12.55, .22, p);
    }
    // 담 위 둥근 생울타리(동서 담만, 카메라 쪽 남쪽 담은 낮게 둔다).
    for (let i = 0; i < 9; i++) {
      const p = -10.6 + i * 2.65;
      add(new THREE.SphereGeometry(.6, 8, 6), M.grassDeep, side * 12.6, .72, p, 0, i, 0, 1.3, .75, 1.6);
    }
  }

  // ---------------- 훈련장: 울타리, 허수아비 3, 바닥 표적 ----------------
  const fencePosts = [];
  for (let a = STARTER_FENCE_ARC.from; a <= STARTER_FENCE_ARC.to + 1e-6; a += (STARTER_FENCE_ARC.to - STARTER_FENCE_ARC.from) / 16) fencePosts.push(a);
  fencePosts.forEach((a, i) => {
    const x = yard.x + Math.cos(a) * (yard.radius + .1), z = yard.z + Math.sin(a) * (yard.radius + .1);
    cyl(.07, .9, M.wood, x, .45, z, 6, .06);
    if (i < fencePosts.length - 1) {
      const b = fencePosts[i + 1], nx = yard.x + Math.cos(b) * (yard.radius + .1), nz = yard.z + Math.sin(b) * (yard.radius + .1);
      const length = Math.hypot(nx - x, nz - z), yaw = Math.atan2(-(nz - z), nx - x);
      for (const y of [.42, .74]) box(length, .06, .05, M.woodDark, (x + nx) / 2, y, (z + nz) / 2, yaw);
    }
  });
  for (const r of [.55, 1.05]) add(new THREE.RingGeometry(r, r + .08, 32), M.red, yard.x + .6, .012, yard.z + .3, -Math.PI / 2);
  // 허수아비는 흔들려야 하므로 각자 작은 묶음(같은 재질 공유)으로 둔다.
  const dummyNodes = STARTER_DUMMIES.map(({ x, z, yaw }) => {
    const node = new THREE.Group(); node.position.set(x, 0, z); node.rotation.y = yaw; group.add(node);
    const pivot = new THREE.Group(); node.add(pivot);
    const parts = new Map();
    const put = (geometry, material, px, py, pz, rx = 0, ry = 0, rz = 0) => {
      geometry.rotateX(rx); geometry.rotateY(ry); geometry.rotateZ(rz); geometry.translate(px, py, pz);
      const flat = geometry.index ? geometry.toNonIndexed() : geometry; if (flat !== geometry) geometry.dispose();
      if (!parts.has(material)) parts.set(material, []); parts.get(material).push(flat);
    };
    put(new THREE.CylinderGeometry(.06, .07, 1.5, 6), M.wood, 0, .75, 0);
    put(new THREE.CylinderGeometry(.26, .22, .7, 8), M.straw, 0, 1.12, 0);
    put(new THREE.CylinderGeometry(.27, .27, .08, 8), M.woodDark, 0, .92, 0);
    put(new THREE.CylinderGeometry(.27, .27, .08, 8), M.woodDark, 0, 1.36, 0);
    put(new THREE.BoxGeometry(1.1, .08, .08), M.wood, 0, 1.3, 0);
    put(new THREE.SphereGeometry(.2, 10, 8), M.straw, 0, 1.66, 0);
    put(new THREE.CylinderGeometry(.22, .22, .05, 14), M.red, 0, 1.15, .24, Math.PI / 2);
    put(new THREE.CylinderGeometry(.12, .12, .055, 12), M.paper, 0, 1.15, .25, Math.PI / 2);
    const pieces = [];
    for (const [material, list] of parts) for (const piece of list) pieces.push(bakeColor(piece, material.color));
    const geometry = mergeGeometries(pieces); for (const piece of pieces) piece.dispose(); owned.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, bakedMaterials.matte); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'Starter_Dummy'; pivot.add(mesh);
    cyl(.32, .08, M.woodDark, x, .04, z, 10);
    return { node, pivot, angle: 0, velocity: 0 };
  });
  // 훈련장 입구 옆 무기 걸이(연습용 목검).
  { const L = local(yard.x + yard.radius + .2, yard.z - 1.9, -Math.PI / 2);
    L.box(1.4, .08, .1, M.woodDark, 0, .95, 0); for (const sx of [-.65, .65]) L.box(.09, 1, .09, M.wood, sx, .5, 0);
    for (const sx of [-.4, 0, .4]) L.box(.07, .9, .03, M.wood, sx, .7, .08, 0, 0, .12); }

  // ---------------- 첫 의뢰 게시판 ----------------
  { const b = STARTER_ZONES.board, L = local(b.x, b.z, .35);
    for (const sx of [-.95, .95]) L.box(.14, 2.2, .14, M.woodDark, sx, 1.1, 0);
    L.box(2.1, 1.25, .1, M.wood, 0, 1.45, 0);
    L.box(2.3, .1, .2, M.woodDark, 0, 2.1, 0); L.box(2.3, .1, .2, M.woodDark, 0, .8, 0);
    L.add(new THREE.ConeGeometry(1.6, .6, 4, 1), M.roof, 0, 2.5, 0, 0, Math.PI / 4, 0, 1, 1, .42);
    const notes = [[-.6, 1.62, -.06], [-.05, 1.7, .04], [.55, 1.58, .1], [-.42, 1.18, -.1], [.25, 1.15, .05]];
    notes.forEach(([x, y, r], i) => L.box(.42, .52, .012, i === 1 ? M.clothWarm : M.paper, x, y, .07, 0, 0, r));
    L.add(new THREE.SphereGeometry(.05, 6, 4), M.red, -.05, 1.92, .09); L.add(new THREE.SphereGeometry(.05, 6, 4), M.red, .55, 1.81, .09);
    // 게시판 옆 걸린 등.
    L.box(.5, .05, .05, M.woodDark, 1.18, 2.02, 0); L.box(.2, .26, .2, M.ember, 1.36, 1.84, 0); }

  // ---------------- 대장간: 열린 작업장 지붕 + 화로 + 모루 + 무기 진열대 ----------------
  const forge = STARTER_ZONES.forge;
  { const L = local(forge.x, forge.z, 0);
    for (const [px, pz] of FORGE_POSTS) L.box(.22, 2.8, .22, M.woodDark, px, 1.4, pz);
    L.box(5.8, .14, .26, M.woodDark, 0, 2.85, -2.2); L.box(5.8, .14, .26, M.woodDark, 0, 2.85, 1.6);
    L.box(6.2, .12, 4.6, M.roof, 0, 3.15, -.3, 0, -.16); L.box(6.3, .08, .3, M.roofDark, 0, 2.86, 1.85, 0, -.16);
    L.box(5.6, 2.6, .25, M.plaster, 0, 1.3, -2.35); L.box(5.6, .3, .3, M.woodDark, 0, .15, -2.35);
    // 굴뚝.
    L.box(.9, 4.6, .9, M.stone, 1.7, 2.3, -2.2); L.box(1.05, .2, 1.05, M.stoneDark, 1.7, 4.65, -2.2); }
  { // 화로(hearth): 돌 화덕 + 불빛.
    const h = { x: 9.3, z: -2.6 }, L = local(h.x, h.z, -Math.PI / 2);
    L.box(2.2, 1, 1.6, M.stone, 0, .5, 0); L.box(2.4, .16, 1.8, M.stoneDark, 0, 1.06, 0);
    L.box(1.2, .5, .1, M.emberCore, 0, .62, .81); L.box(1.5, .14, .12, M.iron, 0, .95, .82);
    L.add(new THREE.ConeGeometry(.42, .5, 6), M.ember, 0, 1.4, 0); }
  { // 모루.
    const L = local(7.1, -.4, -.3);
    L.box(.42, .55, .42, M.woodDark, 0, .27, 0); L.box(.7, .18, .3, M.iron, 0, .64, 0); L.add(new THREE.ConeGeometry(.15, .38, 4), M.iron, .5, .64, 0, 0, 0, -Math.PI / 2);
    L.box(.08, .06, .45, M.wood, -.1, .76, .12); L.box(.16, .12, .12, M.iron, -.1, .78, .32); }
  { // 무기 진열대.
    const L = local(5.2, -2.9, 0);
    L.box(1.8, .1, .3, M.woodDark, 0, 1.25, 0); L.box(1.8, .1, .3, M.woodDark, 0, .35, 0); for (const sx of [-.85, .85]) L.box(.1, 1.4, .3, M.wood, sx, .7, 0);
    for (const [sx, tilt] of [[-.5, .05], [-.15, -.04], [.2, .03], [.55, -.06]]) {
      L.box(.07, 1.1, .02, M.iron, sx, .85, .12, 0, 0, tilt); L.box(.24, .05, .06, M.brass, sx, .32 + .02, .12, 0, 0, tilt);
    }
    L.cyl(.32, .05, M.cloth, -1.25, .75, .1, 12); }

  // ---------------- 상점 앞마당 차양(상인 좌판 위) ----------------
  { const m = STARTER_ZONES.market, L = local(m.x + .5, m.z + .7, -Math.PI / 2);
    for (const sx of [-1.3, 1.3]) for (const sz of [-.8, .8]) L.box(.1, 2.5, .1, M.wood, sx, 1.25, sz);
    for (let i = 0; i < 6; i++) L.box(.46, .05, 1.9, i % 2 ? M.clothWarm : M.plaster, -1.15 + i * .46, 2.55 - Math.abs(i - 2.5) * .04, 0, 0, .12);
    for (const [sx, c] of [[-.8, M.red], [-.3, M.brass], [.3, M.cloth]]) L.cyl(.18, .32, c, sx, 1.05, -.2, 8);
    L.box(.6, .5, .5, M.wood, 1.7, .25, .9); L.box(.5, .4, .5, M.woodDark, 1.75, .7, .9, .3); }

  // ---------------- 시작 영웅상(팔각 받침 + 검을 든 기사 실루엣) ----------------
  { const st = STARTER_ZONES.statue, L = local(st.x, st.z, 0);
    L.cyl(.95, .3, M.stoneDark, 0, .15, 0, 8); L.cyl(.78, .9, M.stone, 0, .75, 0, 8); L.cyl(.86, .12, M.stoneDark, 0, 1.24, 0, 8);
    L.add(new THREE.CircleGeometry(.28, 6), M.cloth, 0, .8, .78); L.add(new THREE.CircleGeometry(.18, 6), M.brass, 0, .8, .79);
    // 조각상(돌 재질): 다리·몸통·망토·머리·치켜든 검.
    for (const sx of [-.13, .13]) L.box(.16, .5, .2, M.stone, sx, 1.55, 0);
    L.cyl(.27, .62, M.stone, 0, 2.08, 0, 8, .23); L.box(.5, .7, .08, M.stoneDark, 0, 1.95, -.2);
    L.add(new THREE.SphereGeometry(.26, 10, 8), M.stone, 0, 2.62, 0);
    L.box(.12, .55, .12, M.stone, .32, 2.45, 0, 0, 0, -.5); L.box(.07, 1.1, .03, M.stone, .52, 3.1, 0, 0, 0, -.15); L.box(.26, .06, .08, M.stone, .44, 2.6, 0);
    L.add(new THREE.CylinderGeometry(.24, .24, .06, 10), M.stoneDark, -.32, 2.05, .12, Math.PI / 2, 0, .2);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; L.add(new THREE.IcosahedronGeometry(.12, 0), i % 3 === 0 ? M.red : i % 3 === 1 ? M.straw : M.paper, Math.cos(a) * 1.05, .34, Math.sin(a) * 1.05); } }

  // ---------------- 광장 분수 ----------------
  const water = mat(0x5fd6d8, { roughness: .15, metalness: .1, transparent: true, opacity: .85 });
  { const f = STARTER_ZONES.fountain, L = local(f.x, f.z, 0);
    L.cyl(f.radius, .5, M.stone, 0, .25, 0, 16); L.cyl(f.radius + .08, .1, M.stoneDark, 0, .52, 0, 16);
    L.add(new THREE.CircleGeometry(f.radius - .14, 24), water, 0, .44, 0, -Math.PI / 2);
    L.cyl(.24, 1.1, M.stone, 0, .9, 0, 8); L.cyl(.62, .18, M.stone, 0, 1.5, 0, 12, .7); L.add(new THREE.CircleGeometry(.55, 16), water, 0, 1.6, 0, -Math.PI / 2);
    L.cyl(.1, .5, M.stone, 0, 1.85, 0, 6); L.add(new THREE.SphereGeometry(.14, 8, 6), M.brass, 0, 2.15, 0); }
  // 물줄기: 가산 혼합 원뿔(update 에서 살짝 맥동).
  const jetMaterial = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending });
  owned.materials.add(jetMaterial);
  const jetGeometry = new THREE.ConeGeometry(.58, .62, 16, 1, true); owned.geometries.add(jetGeometry);
  const jet = new THREE.Mesh(jetGeometry, jetMaterial); jet.position.set(STARTER_ZONES.fountain.x, 1.8, STARTER_ZONES.fountain.z); jet.rotation.x = Math.PI; group.add(jet);

  // ---------------- 출격 포탈: 돌 아치 + 계단 + 소용돌이 ----------------
  const portal = STARTER_ZONES.portal;
  { const L = local(portal.x, portal.z, 0);
    for (let i = 0; i < 3; i++) L.box(4.8 - i * .5, .14, 1.4 - i * .25, i % 2 ? M.stone : M.stoneDark, 0, .07 + i * .14, .5 - i * .1);
    for (const sx of [-1.75, 1.75]) { L.box(.85, 3.6, .85, M.stone, sx, 1.8, 0); L.box(1.05, .25, 1.05, M.stoneDark, sx, 3.7, 0); L.box(1.05, .3, 1.05, M.stoneDark, sx, .15, 0); }
    L.add(new THREE.TorusGeometry(1.75, .42, 6, 18, Math.PI), M.stone, 0, 3.6, 0);
    L.box(.55, .7, .5, M.brass, 0, 5.25, 0);
    for (const sx of [-2.9, 2.9]) { L.cyl(.12, 1.2, M.iron, sx, .6, .9, 6); L.cyl(.3, .2, M.brass, sx, 1.25, .9, 8, .38); L.add(new THREE.ConeGeometry(.24, .5, 6), M.ember, sx, 1.6, .9); } }
  // 소용돌이 원판(캔버스 나선 텍스처, 가산 혼합). 회전만 update 에서 바꾼다.
  let swirl = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
      grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.35, 'rgba(160,236,255,.9)'); grad.addColorStop(.8, 'rgba(60,150,255,.55)'); grad.addColorStop(1, 'rgba(20,60,160,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 6;
      for (let arm = 0; arm < 4; arm++) { g.beginPath(); for (let t = 0; t < 1; t += .02) { const a = arm * Math.PI / 2 + t * 5.5, r = 10 + t * 110; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } g.stroke(); }
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; owned.textures.add(texture);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      owned.materials.add(material);
      const geometry = new THREE.CircleGeometry(1.45, 40); owned.geometries.add(geometry);
      swirl = new THREE.Mesh(geometry, material); swirl.position.set(portal.x, 2.25, portal.z); swirl.scale.set(1, 1.45, 1);
      swirl.name = 'Starter_PortalSwirl'; swirl.renderOrder = 2; group.add(swirl);
    }
  }

  // ---------------- 등불 기둥(입구 길·분수·포탈 길) ----------------
  const lanternGlass = glow(0xffd58a); lanternGlass.userData.bake = 'glow';
  const lanternPost = (x, z, face = 1) => {
    cyl(.09, 2.3, M.woodDark, x, 1.15, z, 6, .07); cyl(.2, .14, M.stoneDark, x, .07, z, 8);
    box(.55, .07, .07, M.woodDark, x + face * .25, 2.2, z);
    const lx = x + face * .48; box(.26, .32, .26, lanternGlass, lx, 1.92, z); box(.32, .05, .32, M.iron, lx, 2.1, z); box(.32, .05, .32, M.iron, lx, 1.75, z);
    add(new THREE.ConeGeometry(.2, .16, 4), M.iron, lx, 2.2, z, 0, Math.PI / 4);
  };
  for (const side of [-1, 1]) { for (const z of [10.8, 6.6]) lanternPost(side * 2.25, z, -side); lanternPost(side * 2.3, -7.4, -side); }

  // ---------------- 꽃밭(돌 테두리 + 촘촘한 꽃) ----------------
  const bedFlowers = [], soil = mat(0x5e4330, { roughness: 1 });
  const leafy = mat(0x4f7a36, { roughness: .9 }); soil.userData.bake = 'ground'; leafy.userData.bake = 'matte';
  const bed = (x, z, w, d, yaw = 0) => {
    const L = local(x, z, yaw);
    L.box(w + .16, .16, d + .16, M.stoneDark, 0, .08, 0); L.box(w, .05, d, soil, 0, .15, 0);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < Math.round(w * d * 16); i++) {
      const lx = (random() - .5) * w * .9, lz = (random() - .5) * d * .85;
      bedFlowers.push([x + lx * c + lz * sn, z - lx * sn + lz * c, Math.floor(random() * P.flowers.length), .22 + random() * .16]);
    }
  };
  for (const [x, z, w, d, yaw] of STARTER_BEDS) {
    bed(x, z, w, d, yaw);
    // 꽃 아래 잎 덩어리(흙이 비어 보이지 않게).
    for (let k = 0; k < Math.max(2, Math.round(w / .55)); k++) { const t = (k + .5) / Math.max(2, Math.round(w / .55)) - .5; add(new THREE.SphereGeometry(.28, 7, 5), leafy, x + t * w * Math.cos(yaw), .2, z - t * w * Math.sin(yaw), 0, k, 0, 1.2, .55, d * 1.2); }
  }
  const bedMesh = new THREE.InstancedMesh(flowerGeometry, mat(0xffffff, { roughness: .7 }), bedFlowers.length);
  bedFlowers.forEach(([x, z, c, y], i) => {
    transform.position.set(x, y, z); transform.rotation.set(0, (x * 7 + z * 3) % 6, 0); transform.scale.setScalar(1.55); transform.updateMatrix();
    bedMesh.setMatrixAt(i, transform.matrix); bedMesh.setColorAt(i, tint.setHex(P.flowers[c]));
  });
  bedMesh.name = 'Starter_FlowerBeds'; bedMesh.computeBoundingSphere(); group.add(bedMesh);
  // 둥근 덤불 무더기(담 안쪽 모서리·건물 사이).
  for (const [x, z, r] of [[-11, -10.6, .9], [-10.2, -9.4, .7], [11, -10.4, .85], [10.4, 10.6, .8], [-10.8, 10.8, .9], [-11.2, -4.2, .7], [11.2, 9.2, .7], [3.6, -10.2, .6], [-3.7, -10.3, .6]])
    add(new THREE.SphereGeometry(r, 8, 6), M.grassDeep, x, r * .55, z, 0, 0, 0, 1.15, .8, 1.1);

  // ---------------- 통·상자 무더기 ----------------
  const barrel = (x, z) => { cyl(.3, .78, M.wood, x, .39, z, 10, .27); for (const y of [.18, .6]) cyl(.31, .05, M.iron, x, y, z, 10); cyl(.27, .02, M.woodDark, x, .79, z, 10); };
  const crate = (x, z, sz = .62, ry = 0, y = 0) => { box(sz, sz, sz, M.wood, x, y + sz / 2, z, ry); box(sz + .02, .07, sz + .02, M.woodDark, x, y + sz * .5, z, ry); };
  STARTER_CLUTTER.forEach(([kind, x, z], i) => {
    if (kind === 'barrel') barrel(x, z);
    else if (kind === 'crate') { crate(x, z, .62, i * .7); if (i % 2) crate(x + .05, z, .42, i * 1.3, .62); }
  });

  // ---------------- 깃발 기둥(파랑·금색) ----------------
  const bannerBlue = mat(0x2f57a6, { side: THREE.DoubleSide }), bannerGold = M.brass; bannerBlue.userData.bake = 'matte';
  const banner = (x, z, yaw = 0) => {
    const L = local(x, z, yaw);
    L.cyl(.07, 3.4, M.woodDark, 0, 1.7, 0, 6); L.box(.9, .06, .06, M.woodDark, 0, 3.25, 0); L.add(new THREE.SphereGeometry(.09, 6, 4), bannerGold, 0, 3.45, 0);
    L.box(.78, 1.5, .03, bannerBlue, 0, 2.45, .05); L.add(new THREE.ConeGeometry(.39, .4, 3), bannerBlue, 0, 1.55, .05, Math.PI, 0, 0, 1, 1, .08);
    L.add(new THREE.OctahedronGeometry(.17, 0), bannerGold, 0, 2.55, .08, 0, 0, 0, 1, 1.3, .25);
  };
  for (const [kind, x, z] of STARTER_CLUTTER) if (kind === 'banner') banner(x, z, x < 0 ? -.3 : .3);

  // ---------------- 줄 깃발(훈련장·상점 위) ----------------
  const flagCloth = [M.clothWarm, bannerBlue, M.straw, M.red];
  const bunting = (ax, az, bx, bz, h = 3) => {
    const n = Math.max(4, Math.round(Math.hypot(bx - ax, bz - az) / .55)), yaw = Math.atan2(-(bz - az), bx - ax);
    box(Math.hypot(bx - ax, bz - az), .025, .025, M.woodDark, (ax + bx) / 2, h - .18, (az + bz) / 2, yaw);
    for (let i = 1; i < n; i++) {
      const t = i / n, sag = Math.sin(t * Math.PI) * .35;
      add(new THREE.ConeGeometry(.16, .34, 3), flagCloth[i % flagCloth.length], ax + (bx - ax) * t, h - .38 - sag, az + (bz - az) * t, Math.PI, yaw, 0, 1, 1, .1);
    }
  };
  { const y = STARTER_ZONES.training; cyl(.07, 3.2, M.woodDark, y.x - 2.4, 1.6, y.z - 2.6, 6); cyl(.07, 3.2, M.woodDark, y.x + 2.2, 1.6, y.z - 2.8, 6); bunting(y.x - 2.4, y.z - 2.6, y.x + 2.2, y.z - 2.8, 3.2); }

  // ---------------- 반목조 오두막(담 바깥, 광장을 향함) ----------------
  // 회벽 + 짙은 목재 골조 + 주황 기와 맞배지붕 + 굴뚝 + 창가 꽃상자(시안 C34). 모두 같은 재질 묶음에 병합된다.
  const window_ = mat(0x3d5f86, { roughness: .3, metalness: .2 }); window_.userData.bake = 'metal';
  const gable = (w, h, d) => { const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]); const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2); return g; };
  function cottage(x0, z0, yaw, { w = 4.4, d = 3.4, h = 2.5, upper = true } = {}) {
    const L = local(x0, z0, yaw), top = .45 + h + (upper ? 1.9 : 0), roofH = d * .62;
    L.box(w + .3, .45, d + .3, M.stoneDark, 0, .2, 0);
    L.box(w, h, d, M.plaster, 0, .45 + h / 2, 0);
    if (upper) L.box(w + .3, 1.9, d + .3, M.plaster, 0, .45 + h + .95, 0);
    // 골조: 모서리 기둥, 층 보, 앞면 가새.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.box(.16, top - .45, .16, M.woodDark, sx * (w / 2 + (upper ? .15 : 0)), .45 + (top - .45) / 2, sz * (d / 2 + (upper ? .15 : 0)));
    for (const y of [.5, .45 + h, top - .05]) { L.box(w + .42, .14, .14, M.woodDark, 0, y, d / 2 + .16); L.box(w + .42, .14, .14, M.woodDark, 0, y, -d / 2 - .16); }
    for (const sx of [-w / 4, w / 4]) L.box(.12, h, .1, M.woodDark, sx, .45 + h / 2, d / 2 + .06);
    for (const sx of [-1, 1]) L.box(.1, Math.hypot(w / 4, h) * .92, .08, M.woodDark, sx * w * .38, .45 + h / 2, d / 2 + .07, 0, 0, sx * Math.atan2(w / 4, h));
    // 지붕: 박공 회벽 + 기와 두 판 + 기와 줄 + 용마루.
    L.add(gable(w + .3, roofH, d + .3), M.plaster, 0, top, 0);
    const slope = Math.atan2(roofH, (d + .3) / 2), plate = Math.hypot(roofH, (d + .3) / 2) + .55;
    for (const sz of [-1, 1]) {
      L.box(w + .9, .16, plate, M.roof, 0, top + roofH / 2 + .02, sz * (d + .3) / 4, 0, sz * slope);
      for (let k = 1; k < 4; k++) { const t = k / 4; L.box(w + .92, .05, .1, M.roofDark, 0, top + roofH * (1 - t) + .12, sz * ((d + .3) / 2) * t, 0, sz * slope); }
    }
    L.box(w + 1, .2, .26, M.roofDark, 0, top + roofH + .06, 0);
    L.box(.7, roofH + 1.2, .7, M.stone, w * .3, top + roofH * .5 + .3, -d * .2); L.box(.85, .16, .85, M.stoneDark, w * .3, top + roofH + .95, -d * .2);
    // 창·문·꽃상자(앞면 +z).
    for (const sx of upper ? [-w * .28, w * .28] : [-w * .28]) {
      L.box(.7, .8, .06, window_, sx, .45 + h * .58, d / 2 + .04); L.box(.84, .1, .1, M.wood, sx, .45 + h * .58 - .45, d / 2 + .1);
      L.box(.8, .22, .26, M.wood, sx, .45 + h * .58 - .58, d / 2 + .2);
      for (let f = 0; f < 4; f++) L.add(new THREE.IcosahedronGeometry(.09, 0), f % 2 ? M.red : M.paper, sx - .27 + f * .18, .45 + h * .58 - .42, d / 2 + .24);
      if (upper) { L.box(.62, .7, .06, window_, sx, .45 + h + .95, d / 2 + .19); L.box(.72, .18, .22, M.wood, sx, .45 + h + .5, d / 2 + .3); }
    }
    L.box(.95, 1.7, .08, M.wood, upper ? 0 : w * .2, .45 + .85, d / 2 + .05); L.box(1.1, .12, .12, M.woodDark, upper ? 0 : w * .2, .45 + 1.76, d / 2 + .09);
    L.box(1.3, .18, .5, M.stone, upper ? 0 : w * .2, .09, d / 2 + .4);
  }
  // 서쪽(훈련장 뒤)·동쪽(대장간 뒤)·북쪽 모서리. 광장 담(±12.55) 바깥이라 걷기 경계와 겹치지 않는다.
  cottage(-15.4, -7.2, Math.PI / 2, { w: 4.6 }); cottage(-15.2, 1.4, Math.PI / 2, { w: 4, upper: false }); cottage(-15.6, 8.8, Math.PI / 2, { w: 4.2 });
  cottage(15.6, -8.6, -Math.PI / 2, { w: 4.4 }); cottage(15.4, 6.6, -Math.PI / 2, { w: 4.6 });
  cottage(-8.6, -15.4, 0, { w: 4.4, upper: false }); cottage(8.8, -15.6, 0, { w: 4.8 });

  // ---------------- 병합 마무리 ----------------
  const merged = [], baked = new Map();
  for (const [material, pieces] of bins) {
    const key = bakeKey(material);
    if (key) { if (!baked.has(key)) baked.set(key, []); baked.get(key).push(...pieces.map(piece => bakeColor(piece, material.color))); continue; }
    const geometry = mergeGeometries(pieces); for (const piece of pieces) piece.dispose();
    if (!geometry) continue; owned.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; mesh.castShadow = !material.isMeshBasicMaterial && !material.transparent;
    mesh.name = 'Starter_Static'; group.add(mesh); merged.push(mesh);
  }
  for (const [key, pieces] of baked) {
    const geometry = mergeGeometries(pieces); for (const piece of pieces) piece.dispose();
    if (!geometry) continue; owned.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, bakedMaterials[key]); mesh.receiveShadow = key !== 'glow'; mesh.castShadow = key === 'matte' || key === 'metal';
    mesh.name = 'Starter_Baked_' + key; group.add(mesh); merged.push(mesh);
  }

  // ---------------- 시간 연출 ----------------
  let time = 0, practiceCount = 0;
  const emberBase = new THREE.Color(P.ember), emberHot = new THREE.Color(0xffc067);
  return {
    version: STARTER_VILLAGE_VERSION,
    group,
    staticBatches: merged.length,
    /** 훈련장 연습 한 번: 가장 가까운 허수아비가 맞은 방향으로 흔들린다. 맞은 허수아비 id 를 돌려준다. */
    strike(position = null, power = 1) {
      let best = 0, bestDistance = Infinity;
      if (position) STARTER_DUMMIES.forEach((dummy, i) => { const d = Math.hypot(dummy.x - position.x, dummy.z - position.z); if (d < bestDistance) { bestDistance = d; best = i; } });
      else best = practiceCount % STARTER_DUMMIES.length;
      practiceCount++;
      dummyNodes[best].velocity += 4.2 * Math.max(.3, Math.min(2, power));
      return STARTER_DUMMIES[best].id;
    },
    /** 허수아비 흔들림 각도(QA·테스트). */
    dummyAngles: () => dummyNodes.map(entry => entry.angle),
    update(dt, reducedMotion = false) {
      const step = Math.min(Math.max(dt, 0), .05);
      time += step;
      for (const entry of dummyNodes) {
        // 감쇠 스프링: 맞으면 기울었다가 제자리로 돌아온다.
        entry.velocity += (-entry.angle * 38 - entry.velocity * 5.2) * step;
        entry.angle += entry.velocity * step;
        if (reducedMotion) { entry.angle = 0; entry.velocity = 0; }
        entry.pivot.rotation.x = entry.angle * .5;
      }
      if (swirl && !reducedMotion) swirl.rotation.z -= step * 1.4;
      if (!reducedMotion) jet.scale.set(1, 1 + .08 * Math.sin(time * 5.1), 1);
      if (!reducedMotion) M.ember.color.copy(emberBase).lerp(emberHot, .5 + .5 * Math.sin(time * 7.3) * Math.sin(time * 3.1));
    },
  };
}
