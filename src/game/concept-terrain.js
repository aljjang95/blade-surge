import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DUNGEON_SURFACE } from './dungeon-surface.js';
import { mulberry32 } from './world.js';

// 컨셉 던전(2026-10-16 root 컨셉 원화 2패널)의 자체 생성 절차 지형.
// 보행면은 모두 y=0 평지이며, 충돌 마스크(Floor) 경계에 난간을 세워 보이는 경계와 실제 경계를 맞춘다.
// 큰 높낮이(절벽·채석장 단)는 보행 영역 밖의 배경 볼륨으로만 번안하고, 올라갈 수 있어 보이는 가짜 계단은 두지 않는다.
export const CONCEPT_STYLES = Object.freeze({
  glacier: Object.freeze({
    key: 'glacier', deck: 0xc3cede, deckSide: 0x5d6f8f, deckDepth: 1.1, parapet: 0x6f7fa3, parapetH: 1.05, post: 0x3f4f75, cap: 0xd8b25a,
    ringH: 1.05, below: { y: -1.05, color: 0x2fcfd0, emissive: 0x0c7c86, emissiveIntensity: .55, roughness: .18, metalness: .05 },
    cliff: { side: 0x5b74b4, top: 0xeef7ff, near: 6, far: 13, minH: 5, maxH: 17, radius: [2.2, 3.8], islands: true },
    crystal: 0xff5fa2, crystalLight: 0xff7fbf, sigil: 0xe1c06a,
  }),
  quarry: Object.freeze({
    // 컨셉의 모래빛 채석 바닥 / 구리 절벽 / 용융 금 해자 대비를 살린다(전체 주황 일색 방지).
    key: 'quarry', deck: 0xe6d6bc, deckSide: 0x8a5232, deckDepth: 1.6, parapet: 0xa8643c, parapetH: 1.15, post: 0x5e3420, cap: 0xe8b443,
    ringH: 1.6, below: { y: -1.45, color: 0xffa23a, emissive: 0xff7a12, emissiveIntensity: .85, roughness: .5, metalness: .1 },
    cliff: { side: 0x9c5634, top: 0xcf9460, near: 5, far: 8, minH: 4, maxH: 15, radius: [2.4, 4.4], islands: false },
    crystal: 0xffb42e, crystalLight: 0xffa340, sigil: 0xe8b443,
  }),
});

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rectOf = r => ({ x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.h / 2, z1: r.z + r.h / 2 });
export const isDiskRoom = room => room?.shape === 'disk';
export const roomRadius = room => Math.min(room.w, room.h) / 2;

const openMasks = new WeakMap();
/** 봉인 해제 뒤의 마스크(같은 셀 채우기 규칙). 결계 자리는 나중에 열리는 길이라 경계 계산에서는 바닥으로 본다. */
function unsealedMask(floor) {
  let entry = openMasks.get(floor);
  if (entry?.source === floor.mask) return entry.mask;
  const saved = floor.mask; floor.mask = new Uint8Array(saved.length);
  try { for (const r of [...floor.rooms, ...floor.corridors]) isDiskRoom(r) ? floor.fillDisk(r, 1) : floor.fillRect(r, 1); entry = { source: saved, mask: floor.mask }; }
  finally { floor.mask = saved; }
  openMasks.set(floor, entry); return entry.mask;
}
export function conceptOpen(floor, x, z) {
  const cx = Math.floor(x - floor.minX), cz = Math.floor(z - floor.minZ);
  if (cx < 0 || cz < 0 || cx >= floor.cols || cz >= floor.rows) return false;
  return unsealedMask(floor)[cz * floor.cols + cx] === 1;
}

/** 1m 마스크 셀 경계를 직선 구간으로 합친다. 원형 방 둘레는 링이 따로 맡는다. */
export function conceptBoundaryRuns(floor) {
  const disks = floor.rooms.filter(isDiskRoom);
  // 원 둘레의 계단형 1m 경계(바깥 법선이 반지름 방향)만 링이 맡는다. 원에 붙은 회랑 옆면은 직선 난간으로 남긴다.
  const near = (x, z, nx, nz) => disks.some(d => {
    const dx = x - d.x, dz = z - d.z, dist = Math.hypot(dx, dz);
    return Math.abs(dist - roomRadius(d)) < 1.6 && (dx * nx + dz * nz) / Math.max(dist, 1e-6) > .45;
  });
  const open = (cx, cz) => conceptOpen(floor, floor.minX + cx + .5, floor.minZ + cz + .5);
  const runs = [];
  // side: 0 북(-z) 1 남(+z) 2 서(-x) 3 동(+x)
  for (const side of [0, 1]) for (let cz = 0; cz < floor.rows; cz++) {
    let start = -1;
    for (let cx = 0; cx <= floor.cols; cx++) {
      const ez = side ? cz + 1 : cz, wx = floor.minX + cx + .5, wz = floor.minZ + ez;
      const edge = cx < floor.cols && open(cx, cz) && !open(cx, cz + (side ? 1 : -1)) && !near(wx, wz, 0, side ? 1 : -1);
      if (edge && start < 0) start = cx;
      if (!edge && start >= 0) { runs.push({ axis: 'x', side, a: floor.minX + start, b: floor.minX + cx, at: floor.minZ + ez }); start = -1; }
    }
  }
  for (const side of [2, 3]) for (let cx = 0; cx < floor.cols; cx++) {
    let start = -1;
    for (let cz = 0; cz <= floor.rows; cz++) {
      const ex = side === 3 ? cx + 1 : cx, wx = floor.minX + ex, wz = floor.minZ + cz + .5;
      const edge = cz < floor.rows && open(cx, cz) && !open(cx + (side === 3 ? 1 : -1), cz) && !near(wx, wz, side === 3 ? 1 : -1, 0);
      if (edge && start < 0) start = cz;
      if (!edge && start >= 0) { runs.push({ axis: 'z', side, a: floor.minZ + start, b: floor.minZ + cz, at: floor.minX + ex }); start = -1; }
    }
  }
  return runs.filter(r => r.b - r.a >= .99);
}

/** 원형 방 둘레의 난간 조각. 바깥이 열린 곳(회랑 입구)은 비운다. */
export function conceptRingSegments(floor, room, step = 1.6) {
  const r = roomRadius(room), n = Math.max(16, Math.ceil(Math.PI * 2 * r / step)), out = [];
  for (let i = 0; i < n; i++) {
    const a = (i + .5) / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    // 조각 양 끝과 가운데에서 바깥 두 거리를 본다. 원을 관통해 들어오는 회랑은 원 바로 바깥부터 열려 있다.
    // 원 자체의 1m 셀은 반지름 + 셀 대각선 반(0.71) 안쪽까지 걸치므로 r+1.0부터, 가까운 이웃 방은 잡지 않게 r+1.5까지만 본다.
    let gap = false;
    for (const t of [-.45, 0, .45]) for (const k of [1, 1.5]) {
      const b = a + t * Math.PI * 2 / n;
      if (conceptOpen(floor, room.x + Math.cos(b) * (r + k), room.z + Math.sin(b) * (r + k))) gap = true;
    }
    out.push({ angle: a, gap, x: room.x + c * r, z: room.z + s * r, length: Math.PI * 2 * r / n });
  }
  return out;
}

/** 보행 영역에서의 거리(2m 격자, 대각 근사)와 북쪽 개활지 거리. 배경 볼륨 배치에만 쓴다. */
function distanceField(floor, pad, cell = 2) {
  const b = floor.bounds, minX = b.minX - pad, minZ = b.minZ - pad;
  const cols = Math.ceil((b.maxX - b.minX + pad * 2) / cell), rows = Math.ceil((b.maxZ - b.minZ + pad * 2) / cell);
  const d = new Float32Array(cols * rows).fill(1e6), D = Math.SQRT2 * cell;
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) if (conceptOpen(floor, minX + (x + .5) * cell, minZ + (z + .5) * cell)) d[z * cols + x] = 0;
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const i = z * cols + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + cell); if (z > 0) v = Math.min(v, d[i - cols] + cell);
    if (x > 0 && z > 0) v = Math.min(v, d[i - cols - 1] + D); if (x < cols - 1 && z > 0) v = Math.min(v, d[i - cols + 1] + D);
    d[i] = v;
  }
  for (let z = rows - 1; z >= 0; z--) for (let x = cols - 1; x >= 0; x--) {
    const i = z * cols + x; let v = d[i];
    if (x < cols - 1) v = Math.min(v, d[i + 1] + cell); if (z < rows - 1) v = Math.min(v, d[i + cols] + cell);
    if (x < cols - 1 && z < rows - 1) v = Math.min(v, d[i + cols + 1] + D); if (x > 0 && z < rows - 1) v = Math.min(v, d[i + cols - 1] + D);
    d[i] = v;
  }
  // 카메라는 영웅의 남쪽(+z) 위에 있다. 보행 영역 남쪽의 볼륨은 북쪽 개활지와의 거리로 높이를 제한한다.
  const north = new Float32Array(cols * rows).fill(1e6);
  for (let x = 0; x < cols; x++) { let last = -1e6; for (let z = 0; z < rows; z++) { if (d[z * cols + x] === 0) last = z; north[z * cols + x] = (z - last) * cell; } }
  // 이웃 열까지 가장 가까운 북쪽 개활지를 본다(격자 반올림에도 카메라 쪽을 낮게).
  const northNear = new Float32Array(cols * rows);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    let v = north[z * cols + x]; if (x > 0) v = Math.min(v, north[z * cols + x - 1]); if (x < cols - 1) v = Math.min(v, north[z * cols + x + 1]);
    northNear[z * cols + x] = v;
  }
  const at = (wx, wz, grid) => { const x = Math.floor((wx - minX) / cell), z = Math.floor((wz - minZ) / cell); return x < 0 || z < 0 || x >= cols || z >= rows ? 1e6 : grid[z * cols + x]; };
  // 바깥 테두리에서 보행 영역을 건너지 않고 닿는 칸. 닿지 않는 칸은 순환 동선 안쪽(다리 사이 물, 채석장 안 구덩이)이다.
  const outer = new Float32Array(cols * rows), queue = [];
  for (let x = 0; x < cols; x++) for (const z of [0, rows - 1]) queue.push(z * cols + x);
  for (let z = 0; z < rows; z++) for (const x of [0, cols - 1]) queue.push(z * cols + x);
  for (const i of queue) outer[i] = d[i] > 0 ? 1 : 0;
  while (queue.length) {
    const i = queue.pop(); if (!outer[i]) continue;
    const x = i % cols, z = (i - x) / cols;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, n = nz * cols + nx;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows || outer[n] || d[n] === 0) continue;
      outer[n] = 1; queue.push(n);
    }
  }
  return { minX, minZ, cols, rows, cell, dist: (x, z) => at(x, z, d), northGap: (x, z) => at(x, z, northNear), outer: (x, z) => at(x, z, outer) === 1 };
}

/** 표면 UV를 월드 좌표에 투영해 겹친 바닥 판이 같은 결을 보이게 한다. */
function worldUv(geometry, scale = 4) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = Math.abs(n.getY(i)), nx = Math.abs(n.getX(i));
    uv[i * 2] = (ny > .5 ? x : nx > .5 ? z : x) / scale; uv[i * 2 + 1] = (ny > .5 ? z : y) / scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** 흐르는 물·용융 금 줄무늬. 캔버스 없이 만들어 테스트 환경에서도 같은 장면이 지어진다. */
function stripeTexture(a, b) {
  const size = 64, data = new Uint8Array(4 * size);
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  for (let i = 0; i < size; i++) {
    const t = .5 + .5 * Math.sin(i / size * Math.PI * 6) * Math.sin(i / size * Math.PI * 2 + 1.3);
    const c = ca.clone().lerp(cb, t);
    data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, 1, size); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** @param {import('./world.js').Floor} floor @param {'glacier'|'quarry'} key
 * @param {{ quality?: string, bindSightline?: ((material: THREE.Material) => void) | null }} [options] */
export function buildConceptTerrain(floor, key, { quality = 'high', bindSightline = null } = {}) {
  const style = CONCEPT_STYLES[key];
  if (!style) throw new RangeError('알 수 없는 컨셉 지형입니다.');
  const group = new THREE.Group(); group.name = 'concept-' + key;
  const owned = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const random = mulberry32((floor.seed || 1) ^ 0x6c0de);
  const mat = (params, bound = true, Type = THREE.MeshStandardMaterial) => {
    const m = new Type(params); owned.materials.add(m); if (bound) bindSightline?.(m); return m;
  };
  const geo = g => { owned.geometries.add(g); return g; };
  const animated = [];
  const stats = { parapetRuns: 0, ringSegments: 0, ringGaps: 0, columns: 0, crystals: 0, posts: 0 };
  group.userData.conceptKey = key; group.userData.stats = stats;

  // ---- 보행면: 방·회랑 판을 한 번 병합한다(그림자 받음, 시선 셰이더 없음) ----
  const deckParts = [];
  for (const r of [...floor.rooms, ...floor.corridors]) {
    const g = isDiskRoom(r) ? new THREE.CylinderGeometry(roomRadius(r), roomRadius(r) * .985, style.deckDepth, 64) : new THREE.BoxGeometry(r.w, style.deckDepth, r.h);
    g.translate(r.x, -style.deckDepth / 2, r.z); deckParts.push(worldUv(g));
  }
  const deckGeometry = geo(mergeGeometries(deckParts.map(g => g.index ? g.toNonIndexed() : g)));
  for (const g of deckParts) g.dispose();
  const deckMaterial = mat({ color: style.deck, roughness: .9, metalness: 0 }, false);
  if (DUNGEON_SURFACE.texture) { deckMaterial.map = DUNGEON_SURFACE.texture; deckMaterial.bumpMap = DUNGEON_SURFACE.texture; deckMaterial.bumpScale = .02; }
  const deck = new THREE.Mesh(deckGeometry, deckMaterial); deck.name = 'concept-deck'; deck.receiveShadow = true; group.add(deck);

  // ---- 바닥 아래: 청록 물 / 용융 금 해자 ----
  const b = floor.bounds, pad = 46;
  const belowTexture = stripeTexture(style.below.color, key === 'glacier' ? 0x9ff6f2 : 0xffe08a); owned.textures.add(belowTexture);
  belowTexture.repeat.set(1, (b.maxX - b.minX + pad * 2) / 9);
  const { y: belowY, ...belowLook } = style.below;
  const belowMaterial = mat({ ...belowLook, map: belowTexture }, false);
  const below = new THREE.Mesh(geo(new THREE.PlaneGeometry(b.maxX - b.minX + pad * 2, b.maxZ - b.minZ + pad * 2)), belowMaterial);
  below.rotation.x = -Math.PI / 2; below.position.set((b.minX + b.maxX) / 2, belowY, (b.minZ + b.maxZ) / 2); below.receiveShadow = true;
  below.name = key === 'glacier' ? 'concept-tide-water' : 'concept-molten-moat'; group.add(below);
  animated.push(dt => { belowTexture.offset.y = (belowTexture.offset.y + dt * (key === 'glacier' ? .045 : .02)) % 1; });

  // ---- 경계 난간: 마스크 경계 직선 + 원형 링(입구는 틈) ----
  const parapetParts = [], posts = [], tallPosts = [];
  const T = .7, H = style.parapetH;
  for (const run of conceptBoundaryRuns(floor)) {
    const len = run.b - run.a, mid = (run.a + run.b) / 2, out = run.side === 1 || run.side === 3 ? T / 2 : -T / 2;
    const g = run.axis === 'x' ? new THREE.BoxGeometry(len + T, H, T) : new THREE.BoxGeometry(T, H, len + T);
    if (run.axis === 'x') g.translate(mid, H / 2, run.at + out); else g.translate(run.at + out, H / 2, mid);
    parapetParts.push(g); stats.parapetRuns++;
    const count = Math.max(1, Math.round(len / 6));
    for (let i = 0; i <= count; i++) {
      const t = run.a + len * i / count;
      posts.push(run.axis === 'x' ? { x: t, z: run.at + out } : { x: run.at + out, z: t });
    }
  }
  for (const room of floor.rooms.filter(isDiskRoom)) {
    const segs = conceptRingSegments(floor, room), r = roomRadius(room), RH = style.ringH;
    segs.forEach((s, i) => {
      if (s.gap) { stats.ringGaps++; return; }
      const g = new THREE.BoxGeometry(s.length + .12, RH, T);
      g.rotateY(-s.angle + Math.PI / 2); g.translate(room.x + Math.cos(s.angle) * (r + T / 2), RH / 2, room.z + Math.sin(s.angle) * (r + T / 2));
      parapetParts.push(g); stats.ringSegments++;
      const prev = segs[(i + segs.length - 1) % segs.length], next = segs[(i + 1) % segs.length];
      const at = (a) => ({ x: room.x + Math.cos(a) * (r + T / 2), z: room.z + Math.sin(a) * (r + T / 2) });
      if (prev.gap) tallPosts.push(at(s.angle - Math.PI / segs.length));
      if (next.gap) tallPosts.push(at(s.angle + Math.PI / segs.length));
      if (i % 5 === 0) posts.push(at(s.angle));
    });
  }
  if (parapetParts.length) {
    const parapet = new THREE.Mesh(geo(mergeGeometries(parapetParts.map(g => g.toNonIndexed()))), mat({ color: style.parapet, roughness: .82, metalness: .05 }));
    for (const g of parapetParts) g.dispose();
    parapet.name = 'concept-parapet'; parapet.castShadow = true; parapet.receiveShadow = true; group.add(parapet);
    group.userData.parapet = parapet;
  }
  const instanced = (name, geometry, material, list, apply) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo(geometry), material, list.length), o = new THREE.Object3D();
    list.forEach((item, i) => { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); apply(o, item, i); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); });
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); group.add(mesh); return mesh;
  };
  const postMaterial = mat({ color: style.post, roughness: .7, metalness: .1 }), capMaterial = mat({ color: style.cap, roughness: .32, metalness: .85, emissive: style.cap, emissiveIntensity: .12 });
  const allPosts = [...posts.map(p => ({ ...p, h: H + .9 })), ...tallPosts.map(p => ({ ...p, h: H + 2.6 }))];
  stats.posts = allPosts.length;
  instanced('concept-posts', new THREE.BoxGeometry(.95, 1, .95), postMaterial, allPosts, (o, p) => { o.position.set(p.x, p.h / 2, p.z); o.scale.set(1, p.h, 1); });
  instanced('concept-post-caps', new THREE.ConeGeometry(.7, .8, 4), capMaterial, allPosts, (o, p) => { o.position.set(p.x, p.h + .38, p.z); o.rotation.y = Math.PI / 4; });

  // ---- 배경 볼륨: 얼음 절벽 기둥 / 구리 채석장 절벽 ----
  const field = distanceField(floor, pad);
  const cliffs = [], islands = [];
  const cliff = style.cliff;
  for (let z = field.minZ; z < field.minZ + field.rows * field.cell; z += 3.6) for (let x = field.minX; x < field.minX + field.cols * field.cell; x += 3.6) {
    const px = x + (random() - .5) * 2.6, pz = z + (random() - .5) * 2.6, d = field.dist(px, pz), roll = random(), h0 = random(), r0 = random();
    if (!field.outer(px, pz)) {
      // 순환 동선 안쪽: 컨셉의 열린 청록 물/채석 구덩이를 살리고 시야를 막지 않게 낮은 얼음섬·잔해만.
      if (d > 3 && roll < (cliff.islands ? .14 : .22)) islands.push({ x: px, z: pz, h: (cliff.islands ? .5 : .2) + h0 * 1.5, r: .9 + r0 * 1.1, yaw: roll * 9 });
      continue;
    }
    if (d < cliff.near) { if (cliff.islands && d > 4.5 && roll < .1) islands.push({ x: px, z: pz, h: .8 + h0 * 1.6, r: .9 + r0 * 1.2, yaw: roll * 9 }); continue; }
    // 먼 바깥은 안개에 묻히므로 성기게 둔다(삼각형·그림자 비용).
    if (roll > (d < cliff.near + 10 ? .62 : d < cliff.near + 26 ? .78 : .22)) continue;
    {
      let h = cliff.minH + (cliff.maxH - cliff.minH) * smooth(cliff.near, cliff.near + 22, d) * (.6 + .4 * h0);
      const gap = field.northGap(px, pz);
      // 2m 격자 거리는 실제보다 최대 한 칸 길다. 한 칸 덜어 카메라 쪽 시야를 보수적으로 지킨다.
      if (gap < 30) h = Math.min(h, Math.max(1.4, (gap - 5) * .5));
      cliffs.push({ x: px, z: pz, h, r: cliff.radius[0] + (cliff.radius[1] - cliff.radius[0]) * r0, yaw: roll * Math.PI * 2 });
    }
  }
  stats.columns = cliffs.length + islands.length;
  const columnGeometry = key === 'glacier' ? new THREE.CylinderGeometry(.82, 1, 1, 6) : new THREE.BoxGeometry(1.6, 1, 1.25);
  const bottom = style.below.y - .4;
  const sideMaterial = mat({ color: cliff.side, roughness: key === 'glacier' ? .45 : .88, metalness: key === 'glacier' ? .08 : .02, flatShading: true });
  const topMaterial = mat({ color: cliff.top, roughness: .62, metalness: 0, flatShading: true });
  const both = [...cliffs, ...islands];
  instanced('concept-cliffs', columnGeometry, sideMaterial, both, (o, c) => { o.position.set(c.x, bottom + (c.h - bottom) / 2, c.z); o.rotation.y = c.yaw; o.scale.set(c.r, c.h - bottom, c.r); });
  instanced('concept-cliff-tops', key === 'glacier' ? new THREE.CylinderGeometry(.86, .86, 1, 6) : new THREE.BoxGeometry(1.7, 1, 1.35), topMaterial, both, (o, c) => { o.position.set(c.x, c.h + .12, c.z); o.rotation.y = c.yaw; o.scale.set(c.r, .45, c.r); });

  // ---- 수정 군락(분홍 / 호박) ----
  const crystals = [];
  for (const room of floor.rooms) {
    const n = room.type === 'boss' ? 7 : isDiskRoom(room) ? 6 : 2;
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2, rr = (isDiskRoom(room) ? roomRadius(room) : Math.max(room.w, room.h) / 2) + 2.8 + random() * 3.5;
      const x = room.x + Math.cos(a) * rr, z = room.z + Math.sin(a) * rr;
      if (field.dist(x, z) < 1.6 || field.northGap(x, z) < 8) continue;
      for (let k = 0; k < 3; k++) crystals.push({ x: x + (random() - .5) * 1.6, z: z + (random() - .5) * 1.6, s: .6 + random() * .8, tilt: (random() - .5) * .7, yaw: random() * 6.3 });
    }
  }
  stats.crystals = crystals.length;
  instanced('concept-crystals', new THREE.OctahedronGeometry(1, 0), mat({ color: style.crystal, emissive: style.crystal, emissiveIntensity: .5, roughness: .2, metalness: .1, flatShading: true }), crystals,
    (o, c) => { o.position.set(c.x, c.s * 1.3, c.z); o.rotation.set(c.tilt, c.yaw, c.tilt * .5); o.scale.set(c.s * .45, c.s * 1.7, c.s * .45); });

  // ---- 원형 마당 문양(바닥 높이, 시선 셰이더 없음) ----
  const sigilParts = [];
  for (const room of floor.rooms.filter(isDiskRoom)) {
    const r = roomRadius(room);
    for (const f of [.24, .48, .7]) { const g = new THREE.RingGeometry(r * f - .14, r * f + .14, 72); g.rotateX(-Math.PI / 2); g.translate(room.x, .025, room.z); sigilParts.push(g); }
    for (let i = 0; i < 8; i++) { const g = new THREE.PlaneGeometry(.22, r * .46); g.rotateX(-Math.PI / 2); g.translate(0, .026, -r * .47); g.rotateY(i * Math.PI / 4); g.translate(room.x, 0, room.z); sigilParts.push(g); }
  }
  if (sigilParts.length) {
    const sigil = new THREE.Mesh(geo(mergeGeometries(sigilParts.map(g => g.index ? g.toNonIndexed() : g))), mat({ color: style.sigil, emissive: style.sigil, emissiveIntensity: .35, roughness: .35, metalness: .7, polygonOffset: true, polygonOffsetFactor: -2 }, false));
    for (const g of sigilParts) g.dispose();
    sigil.name = 'concept-court-sigil'; sigil.receiveShadow = true; group.add(sigil);
  }

  if (key === 'glacier') buildGlacierLandmarks(floor, group, { mat, geo, instanced, animated, random, field, owned });
  else buildQuarryLandmarks(floor, group, { mat, geo, instanced, animated, random, field, owned });

  // 지역 조명(점광원 수 고정: 수정·용융 빛 4개). 물·수정 반사가 블룸으로 하얗게 번지지 않게 낮게 둔다.
  const lights = [];
  const lightRooms = [...floor.rooms].sort((a, b) => (isDiskRoom(b) ? 1 : 0) - (isDiskRoom(a) ? 1 : 0)).slice(0, 4);
  for (const room of lightRooms) {
    const l = new THREE.PointLight(style.crystalLight, quality === 'low' ? 5 : 7, 22, 2); l.position.set(room.x, 4.5, room.z - (isDiskRoom(room) ? roomRadius(room) * .55 : room.h * .35));
    group.add(l); lights.push(l);
  }
  group.userData.lights = lights;
  let t = 0;
  group.userData.update = dt => { t += dt; for (const fn of animated) fn(dt, t); };
  let disposed = false;
  group.userData.dispose = () => {
    if (disposed) return; disposed = true; group.removeFromParent();
    group.traverse(node => { if (node.isInstancedMesh) node.dispose(); });
    for (const g of owned.geometries) g.dispose(); for (const m of owned.materials) m.dispose(); for (const x of owned.textures) x.dispose();
  };
  return group;
}

/** 빙하 조수 분지: 두 아치 수문과 폭포, 다리 교각, 설원 침엽수. */
function buildGlacierLandmarks(floor, group, { mat, geo, instanced, animated, random, field, owned }) {
  const stone = mat({ color: 0x55658c, roughness: .7, metalness: .08 }), gold = mat({ color: 0xd8b25a, roughness: .3, metalness: .85, emissive: 0x6a4a10, emissiveIntensity: .2 });
  const fallTexture = stripeTexture(0xbff7ff, 0x5fd8e6); owned.textures.add(fallTexture); fallTexture.repeat.set(1, 3);
  const fallMaterial = mat({ color: 0xd8fbff, map: fallTexture, transparent: true, opacity: .78, depthWrite: false, side: THREE.DoubleSide }, false, THREE.MeshBasicMaterial);
  animated.push(dt => { fallTexture.offset.y = (fallTexture.offset.y + dt * .9) % 1; });
  const start = floor.rooms[0], boss = floor.rooms.find(r => r.type === 'boss');
  const arches = [];
  // 시작 테라스 서쪽, 보스 마당 동쪽 끝 바깥에 수문 아치. 카메라 반대편이 아니라 좌우 끝에 둬 시야를 막지 않는다.
  if (start) arches.push({ x: start.x - start.w / 2 - 3.2, z: start.z, yaw: Math.PI / 2 });
  if (boss) arches.push({ x: boss.x + roomRadius(boss) + 3.4, z: boss.z, yaw: Math.PI / 2 });
  const archParts = [], trimParts = [], falls = [];
  for (const a of arches) {
    const m = new THREE.Matrix4().makeRotationY(a.yaw).setPosition(a.x, 0, a.z);
    for (const side of [-1, 1]) { const g = new THREE.BoxGeometry(2.2, 9.5, 2.4); g.translate(side * 4.6, 4.75, 0); g.applyMatrix4(m); archParts.push(g); }
    const arc = new THREE.TorusGeometry(4.6, 1.05, 8, 20, Math.PI); arc.translate(0, 9.5, 0); arc.applyMatrix4(m); archParts.push(arc);
    const trim = new THREE.TorusGeometry(4.6, .32, 6, 24, Math.PI); trim.translate(0, 9.5, .95); trim.applyMatrix4(m); trimParts.push(trim);
    const fall = new THREE.PlaneGeometry(6.6, 11); fall.translate(0, 4.4, -1.4); fall.applyMatrix4(m); falls.push(fall);
  }
  if (archParts.length) {
    const arch = new THREE.Mesh(geo(mergeGeometries(archParts.map(g => g.index ? g.toNonIndexed() : g))), stone); arch.name = 'concept-tide-arches'; arch.castShadow = true; group.add(arch);
    const trim = new THREE.Mesh(geo(mergeGeometries(trimParts.map(g => g.index ? g.toNonIndexed() : g))), gold); trim.name = 'concept-tide-arch-trim'; group.add(trim);
    const fall = new THREE.Mesh(geo(mergeGeometries(falls)), fallMaterial); fall.name = 'concept-waterfalls'; fall.renderOrder = 1; group.add(fall);
    for (const g of [...archParts, ...trimParts, ...falls]) g.dispose();
  }
  // 다리 교각: 회랑과 긴 다리 방 아래 양옆에 6m 간격.
  const piers = [];
  for (const r of [...floor.corridors, ...floor.rooms.filter(room => !isDiskRoom(room) && Math.max(room.w, room.h) / Math.min(room.w, room.h) > 1.6)]) {
    const long = r.w >= r.h, len = long ? r.w : r.h, n = Math.floor(len / 6);
    for (let i = 1; i < n; i++) for (const side of [-1, 1]) {
      const t = -len / 2 + len * i / n, x = long ? r.x + t : r.x + side * (r.w / 2 - .5), z = long ? r.z + side * (r.h / 2 - .5) : r.z + t;
      if (field.dist(long ? x : x + side * 1.2, long ? z + side * 1.2 : z) === 0) continue;
      piers.push({ x, z });
    }
  }
  instanced('concept-bridge-piers', new THREE.BoxGeometry(1.5, 1, 1.5), stone, piers, (o, p) => { o.position.set(p.x, -1.8, p.z); o.scale.set(1, 2.2, 1); });
  // 바깥 절벽 위 침엽수(남쪽 전경 제외)
  const pines = [];
  for (let i = 0; i < 90 && pines.length < 40; i++) {
    const b = floor.bounds, x = b.minX - 30 + random() * (b.maxX - b.minX + 60), z = b.minZ - 30 + random() * (b.maxZ - b.minZ + 60);
    const d = field.dist(x, z); if (d < 9 || field.northGap(x, z) < 40) continue;
    pines.push({ x, z, s: 1.2 + random() * 1.4 });
  }
  instanced('concept-pines', new THREE.ConeGeometry(1, 2.6, 6), mat({ color: 0x1f5a5a, roughness: .8, flatShading: true }), pines, (o, p) => { o.position.set(p.x, 7 + p.s * 2, p.z); o.scale.setScalar(p.s); });
}
/** 석양 황동 채석장: 회전하는 황동 도르래 두 개, 매달린 광석 상자, 청록 깃발, 용융 금 낙수. */
function buildQuarryLandmarks(floor, group, { mat, geo, instanced, animated, random, field, owned }) {
  const brass = mat({ color: 0xd9a441, roughness: .34, metalness: .88, emissive: 0x5a3608, emissiveIntensity: .18 });
  const timber = mat({ color: 0x5b3420, roughness: .85, metalness: 0 });
  const court = floor.rooms.filter(isDiskRoom).sort((a, b) => roomRadius(b) - roomRadius(a))[0] || floor.rooms[0];
  const r = isDiskRoom(court) ? roomRadius(court) : Math.max(court.w, court.h) / 2;
  const wheels = [];
  // 바퀴(테·살·축)와 지지대는 각각 한 지오메트리로 병합해 도르래당 draw call 2개로 둔다.
  const wheelParts = [new THREE.TorusGeometry(4.4, .42, 8, 32), new THREE.CylinderGeometry(.8, .8, 1.1, 12).rotateX(Math.PI / 2)];
  for (let i = 0; i < 8; i++) wheelParts.push(new THREE.BoxGeometry(.28, 8.6, .28).rotateZ(i * Math.PI / 8));
  const wheelGeometry = geo(mergeGeometries(wheelParts.map(g => g.index ? g.toNonIndexed() : g)));
  const legParts = [-1, 1].map(leg => new THREE.BoxGeometry(.7, 12, .7).rotateZ(leg * -.16).translate(leg * 3.3, -5.6, leg * .3));
  const legGeometry = geo(mergeGeometries(legParts.map(g => g.toNonIndexed())));
  for (const g of [...wheelParts, ...legParts]) g.dispose();
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(wheelGeometry, brass); wheel.name = 'concept-pulley-wheel'; wheel.castShadow = true;
    const pivot = new THREE.Group(); pivot.position.set(court.x + side * (r * .82), 11.5, court.z - r - 9); pivot.rotation.y = side * .35; pivot.add(wheel); group.add(pivot);
    const legs = new THREE.Mesh(legGeometry, timber); legs.castShadow = true; pivot.add(legs);
    wheels.push({ wheel, speed: side * .32 });
  }
  // 두 도르래 사이 케이블에 매달린 광석 상자(마당 북쪽 위 높은 곳)
  const crate = new THREE.Group(); crate.name = 'concept-ore-crate';
  const box = new THREE.Mesh(geo(new THREE.BoxGeometry(2.6, 2, 2.2)), timber); crate.add(box);
  const bandParts = [-.7, .7].map(y => new THREE.BoxGeometry(2.7, .22, 2.3).translate(0, y, 0));
  crate.add(new THREE.Mesh(geo(mergeGeometries(bandParts.map(g => g.toNonIndexed()))), brass)); for (const g of bandParts) g.dispose();
  const ore = new THREE.Mesh(geo(new THREE.OctahedronGeometry(.9, 0)), mat({ color: 0xffb42e, emissive: 0xff8a10, emissiveIntensity: .9, flatShading: true })); ore.position.y = 1.2; crate.add(ore);
  const hangX = court.x, hangZ = court.z - r - 6;
  const cable = new THREE.Mesh(geo(new THREE.CylinderGeometry(.06, .06, 1, 5)), timber);
  const crateRoot = new THREE.Group(); crateRoot.position.set(hangX, 15.5, hangZ); group.add(crateRoot);
  crate.position.y = -4.5; crateRoot.add(crate); cable.scale.y = 4.5; cable.position.y = -2.25; crateRoot.add(cable);
  const spanLeft = new THREE.Vector3(court.x - r * .82, 15.8, court.z - r - 9), spanRight = new THREE.Vector3(court.x + r * .82, 15.8, court.z - r - 9);
  const span = new THREE.Mesh(geo(new THREE.CylinderGeometry(.07, .07, spanLeft.distanceTo(spanRight), 5)), timber);
  span.position.copy(spanLeft).lerp(spanRight, .5); span.rotation.z = Math.PI / 2; group.add(span);
  animated.push((dt, t) => { for (const w of wheels) w.wheel.rotation.z += dt * w.speed; crateRoot.rotation.z = Math.sin(t * .7) * .08; crateRoot.rotation.x = Math.sin(t * .53 + 1) * .05; });
  // 마당 둘레 청록 깃발(입구 틈 제외)
  const banners = [];
  if (isDiskRoom(court)) for (const s of conceptRingSegments(floor, court)) if (!s.gap && banners.length < 10 && Math.sin(s.angle) < .2 && random() < .35) banners.push({ x: court.x + Math.cos(s.angle) * (r + 1.1), z: court.z + Math.sin(s.angle) * (r + 1.1), yaw: -s.angle + Math.PI / 2 });
  instanced('concept-banners', new THREE.PlaneGeometry(1.4, 3.2), mat({ color: 0x2f8f93, roughness: .8, side: THREE.DoubleSide, emissive: 0x0b3a3c, emissiveIntensity: .25 }), banners,
    (o, p) => { o.position.set(p.x, 3.6, p.z); o.rotation.y = p.yaw; });
  // 북쪽 절벽면의 용융 금 낙수
  const fallTexture = stripeTexture(0xffe9a0, 0xff8a14); owned.textures.add(fallTexture); fallTexture.repeat.set(1, 2);
  const falls = [];
  for (const room of floor.rooms) {
    const x = room.x + (random() - .5) * room.w * .6, z = room.z - (isDiskRoom(room) ? roomRadius(room) : room.h / 2) - 8.5;
    if (field.dist(x, z) < 5) continue;
    const g = new THREE.PlaneGeometry(2.2, 9); g.translate(x, 2.5, z); falls.push(g);
  }
  if (falls.length) {
    const fall = new THREE.Mesh(geo(mergeGeometries(falls)), mat({ color: 0xffd27a, map: fallTexture, transparent: true, opacity: .88, depthWrite: false, side: THREE.DoubleSide }, false, THREE.MeshBasicMaterial));
    for (const g of falls) g.dispose();
    fall.name = 'concept-gold-falls'; fall.renderOrder = 1; group.add(fall);
    animated.push(dt => { fallTexture.offset.y = (fallTexture.offset.y + dt * .5) % 1; });
  }
}
