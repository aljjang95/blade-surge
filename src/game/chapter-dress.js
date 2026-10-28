import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chapterDressFor } from '../data/chapter-dress.js';

// 장별 몬스터 의상 — 몸 색조·기본 발광과 뼈에 붙는 저폴리 소품(관·묘비 방패·종·촛불 관·꽃).
// 소품 하나는 정점색 병합 지오메트리 1~2개(불투명 + 발광)다. 지오메트리·재질은 소품 종류와 몸 키별로 공유하고,
// Actor.dispose 가 공유 재질을 지우지 않도록 userData.sharedDress 를 단다.
// 좌표: 소품은 '모델 공간 휴식 자세' 축(+Y 위, +Z 앞)으로 짓고, 붙는 뼈의 휴식 행렬 역으로 소켓을 맞춘다.
// 길이 단위는 몸 키(heightM)에 대한 비율이다(같은 소품이 슬라임·거인에게 같은 비율로 붙는다).

const _inv = new THREE.Matrix4(), _boneM = new THREE.Matrix4(), _want = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

const C = {
  wood: 0x4a3626, woodDark: 0x2f2219, cloth: 0x4f7d72, clothDark: 0x2c3b38, stone: 0x8f9894, stoneDark: 0x6c7471,
  bronze: 0x8b6a3c, bronzeDark: 0x5c4426, ivory: 0xe9e1c8, lily: 0xf4f7ef, leaf: 0x5f8f6a, iron: 0x4b5254,
  glowTeal: 0x8ff5dc, glowFlame: 0xfff1c2, glowName: 0x6fe0c4,
};

/** 정점색을 칠하고 위치·회전을 굽는다. */
export function piece(geometry, color, at = [0, 0, 0], rot = [0, 0, 0], scale = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
  const col = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  _e.set(THREE.MathUtils.degToRad(rot[0]), THREE.MathUtils.degToRad(rot[1]), THREE.MathUtils.degToRad(rot[2]));
  _want.compose(_p.set(at[0], at[1], at[2]), _q.setFromEuler(_e), scale ? new THREE.Vector3(...scale) : _s);
  g.applyMatrix4(_want);
  return g;
}

/** 관 실루엣(좁은 위·넓은 어깨·좁은 발) 외곽선을 두께만큼 돌출한다. */
function coffinShape(w, l) {
  const s = new THREE.Shape();
  s.moveTo(-w * .32, -l * .5); s.lineTo(w * .32, -l * .5); s.lineTo(w * .5, l * .22); s.lineTo(w * .36, l * .5);
  s.lineTo(-w * .36, l * .5); s.lineTo(-w * .5, l * .22); s.closePath();
  return s;
}
export function tombShape(w, l) {
  const s = new THREE.Shape();
  s.moveTo(-w * .5, -l * .5); s.lineTo(w * .5, -l * .5); s.lineTo(w * .5, l * .5 - w * .5);
  s.absarc(0, l * .5 - w * .5, w * .5, 0, Math.PI, false); s.closePath();
  return s;
}
export const extrude = (shape, depth) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, -depth / 2); return g; };
/** 종 단면을 돌려 만든다(입이 아래). 높이 1 기준. */
export function bellGeometry(r, segments = 10) {
  const pts = [[0, 1], [r * .35, .98], [r * .5, .82], [r * .58, .5], [r * .78, .18], [r, 0], [r * .9, -.03]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, segments); return g;
}

// 소품: bones 후보(앞이 우선) 또는 root(모델 원점=발밑 기준, 뼈 없는 슬라임·원령), at(몸 키 비율, 모델 축), rot(도), scale(배), build(h) → { solid: [], glow: [] }
const PROPS = {
  coffin: { bones: ['Spine2', 'Spine1', 'Spine', 'head'], at: [0, .02, -.12], rot: [-8, 0, 0], scale: 1.25, build: (h) => ({
    solid: [
      piece(extrude(coffinShape(.2 * h, .44 * h), .07 * h), C.wood),
      piece(new THREE.BoxGeometry(.21 * h, .025 * h, .075 * h), C.woodDark, [0, .1 * h, 0]),
      piece(new THREE.BoxGeometry(.21 * h, .025 * h, .075 * h), C.woodDark, [0, -.12 * h, 0]),
      // 어깨에 걸친 상복 끈 두 가닥.
      piece(new THREE.BoxGeometry(.025 * h, .2 * h, .08 * h), C.cloth, [.07 * h, .12 * h, .05 * h], [-25, 0, 0]),
      piece(new THREE.BoxGeometry(.025 * h, .2 * h, .08 * h), C.cloth, [-.07 * h, .12 * h, .05 * h], [-25, 0, 0]),
    ],
    glow: [piece(new THREE.BoxGeometry(.012 * h, .16 * h, .004 * h), C.glowName, [0, .02 * h, -.037 * h]), piece(new THREE.BoxGeometry(.09 * h, .012 * h, .004 * h), C.glowName, [0, .06 * h, -.037 * h])],
  }) },
  mourningHood: { bones: ['Head', 'head'], at: [0, .2, -.01], rot: [-6, 0, 0], scale: 2.2, build: (h) => ({
    solid: [
      piece(new THREE.ConeGeometry(.085 * h, .17 * h, 8, 1, true), C.cloth, [0, .02 * h, 0]),
      // 등 뒤로 늘어진 두건 자락.
      piece(new THREE.BoxGeometry(.13 * h, .2 * h, .012 * h), C.cloth, [0, -.1 * h, -.06 * h], [12, 0, 0]),
    ],
    glow: [],
  }) },
  darkHood: { bones: ['Head', 'head'], at: [0, .04, -.01], rot: [-8, 0, 0], build: (h) => ({
    solid: [
      piece(new THREE.ConeGeometry(.08 * h, .15 * h, 8, 1, true), C.clothDark, [0, .02 * h, 0]),
      piece(new THREE.BoxGeometry(.11 * h, .17 * h, .012 * h), C.clothDark, [0, -.09 * h, -.055 * h], [14, 0, 0]),
      // 팔에 감은 상장(喪章) 대신 목에 두른 청록 띠.
      piece(new THREE.TorusGeometry(.065 * h, .012 * h, 4, 10), C.cloth, [0, -.08 * h, 0], [90, 0, 0]),
    ],
    glow: [],
  }) },
  mourningVeil: { bones: ['Head', 'head'], at: [0, .19, -.02], rot: [-6, 0, 0], scale: 2.2, build: (h) => ({
    solid: [
      piece(new THREE.ConeGeometry(.09 * h, .14 * h, 10, 1, true), C.clothDark, [0, .03 * h, 0]),
      piece(new THREE.BoxGeometry(.18 * h, .32 * h, .012 * h), C.clothDark, [0, -.15 * h, -.07 * h], [10, 0, 0]),
      piece(new THREE.BoxGeometry(.02 * h, .1 * h, .01 * h), C.lily, [.05 * h, .08 * h, .03 * h], [0, 0, -30]),
    ],
    glow: [],
  }) },
  tombShield: { bones: ['Spine2', 'Spine1', 'Spine'], at: [.1, -.1, .17], rot: [-6, -14, 0], scale: 1.5, build: (h) => ({
    solid: [
      piece(extrude(tombShape(.2 * h, .32 * h), .045 * h), C.stone),
      piece(new THREE.BoxGeometry(.23 * h, .04 * h, .06 * h), C.stoneDark, [0, -.16 * h, 0]),
      piece(new THREE.SphereGeometry(.035 * h, 6, 4), C.leaf, [.06 * h, -.13 * h, .03 * h], [0, 0, 0], [1, .6, .7]),
    ],
    // 지워진 이름 자리: 희미하게 빛나는 긁힌 줄 세 개.
    glow: [-.01, .04, .09].map((y, i) => piece(new THREE.BoxGeometry((.11 - i * .02) * h, .01 * h, .004 * h), C.glowName, [0, y * h, .024 * h])),
  }) },
  candleCrown: { bones: ['Head', 'head'], at: [0, .25, 0], rot: [0, 0, 0], scale: 1.9, build: (h) => {
    const solid = [piece(new THREE.TorusGeometry(.07 * h, .012 * h, 4, 12), C.bronze, [0, 0, 0], [90, 0, 0])], glow = [];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2, x = Math.sin(a) * .07 * h, z = Math.cos(a) * .07 * h, tall = (.05 + (i % 2) * .025) * h;
      solid.push(piece(new THREE.CylinderGeometry(.011 * h, .012 * h, tall, 5), C.ivory, [x, tall / 2, z]));
      glow.push(piece(new THREE.ConeGeometry(.012 * h, .035 * h, 5), C.glowFlame, [x, tall + .016 * h, z]));
    }
    return { solid, glow };
  } },
  brokenBell: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .04, -.17], rot: [-15, 0, 12], scale: 1.7, build: (h) => ({
    solid: [
      piece(bellGeometry(.13 * h), C.bronze, [0, -.1 * h, 0], [0, 0, 0], [1, .24 * h, 1]),
      piece(new THREE.TorusGeometry(.03 * h, .008 * h, 4, 8), C.bronzeDark, [0, .15 * h, 0]),
      piece(new THREE.BoxGeometry(.18 * h, .02 * h, .02 * h), C.woodDark, [0, .07 * h, .06 * h], [0, 0, 20]),
    ],
    // 종 몸통의 금(빛나는 균열).
    glow: [piece(new THREE.BoxGeometry(.008 * h, .12 * h, .006 * h), C.glowName, [.04 * h, -.02 * h, .085 * h], [0, 0, 18])],
  }) },
  brokenBellLarge: { bones: ['Spine2', 'Spine1', 'Spine'], at: [0, .05, -.2], rot: [-12, 0, -10], scale: 1.8, build: (h) => ({
    solid: [
      piece(bellGeometry(.17 * h, 12), C.bronze, [0, -.13 * h, 0], [0, 0, 0], [1, .32 * h, 1]),
      piece(new THREE.TorusGeometry(.04 * h, .01 * h, 4, 8), C.bronzeDark, [0, .2 * h, 0]),
      piece(new THREE.CylinderGeometry(.012 * h, .012 * h, .3 * h, 5), C.iron, [.08 * h, .03 * h, .05 * h], [0, 0, 70]),
    ],
    glow: [piece(new THREE.BoxGeometry(.01 * h, .17 * h, .006 * h), C.glowName, [.05 * h, -.03 * h, .11 * h], [0, 0, 16]), piece(new THREE.BoxGeometry(.01 * h, .08 * h, .006 * h), C.glowName, [.03 * h, .04 * h, .1 * h], [0, 0, -30])],
  }) },
  bellCrown: { bones: ['Head', 'head'], at: [0, .26, 0], rot: [0, 0, 0], scale: 2.1, build: (h) => {
    const solid = [piece(new THREE.CylinderGeometry(.085 * h, .075 * h, .04 * h, 10, 1, true), C.bronze)], glow = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, x = Math.sin(a) * .085 * h, z = Math.cos(a) * .085 * h;
      solid.push(piece(new THREE.ConeGeometry(.018 * h, .06 * h, 4), C.bronzeDark, [x, .045 * h, z]));
      solid.push(piece(bellGeometry(.025 * h, 6), C.bronze, [x, -.05 * h, z], [0, 0, 0], [1, .035 * h, 1]));
    }
    glow.push(piece(new THREE.TorusGeometry(.086 * h, .006 * h, 3, 18), C.glowTeal, [0, .02 * h, 0], [90, 0, 0]));
    return { solid, glow };
  } },
  funeralBanner: { bones: ['Spine2', 'Spine1', 'Spine'], at: [.09, .1, -.16], rot: [-6, 0, -6], scale: 1.6, build: (h) => ({
    solid: [
      piece(new THREE.CylinderGeometry(.008 * h, .008 * h, .62 * h, 5), C.woodDark, [0, .12 * h, 0]),
      piece(new THREE.BoxGeometry(.16 * h, .26 * h, .006 * h), C.clothDark, [-.085 * h, .27 * h, 0]),
      piece(new THREE.BoxGeometry(.16 * h, .03 * h, .008 * h), C.cloth, [-.085 * h, .41 * h, 0]),
    ],
    glow: [piece(new THREE.TorusGeometry(.03 * h, .005 * h, 3, 10), C.glowName, [-.085 * h, .28 * h, .005 * h])],
  }) },
  spiritBell: { root: true, at: [0, .32, .16], rot: [0, 0, 0], scale: 2.2, build: (h) => ({
    solid: [
      piece(bellGeometry(.06 * h, 8), C.bronze, [0, -.02 * h, 0], [0, 0, 0], [1, .09 * h, 1]),
      piece(new THREE.CylinderGeometry(.004 * h, .004 * h, .12 * h, 3), C.bronzeDark, [0, .12 * h, 0]),
    ],
    glow: [piece(new THREE.SphereGeometry(.018 * h, 6, 4), C.glowTeal, [0, -.035 * h, 0])],
  }) },
  spiritHalo: { root: true, at: [0, .98, -.04], rot: [90, 0, 0], scale: 1.5, build: (h) => ({
    solid: [],
    glow: [piece(new THREE.TorusGeometry(.16 * h, .008 * h, 3, 24), C.glowTeal)],
  }) },
  graveLilies: { root: true, at: [0, .86, 0], rot: [0, 0, 0], scale: 2.6, build: (h) => {
    const solid = [], glow = [];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + .4, x = Math.sin(a) * .06 * h, z = Math.cos(a) * .06 * h, tilt = 18 + i * 6;
      solid.push(piece(new THREE.CylinderGeometry(.005 * h, .006 * h, .1 * h, 3), C.leaf, [x, .03 * h, z], [Math.cos(a) * tilt, 0, -Math.sin(a) * tilt]));
      solid.push(piece(new THREE.ConeGeometry(.03 * h, .05 * h, 6, 1, false), C.lily, [x * 1.4, .095 * h, z * 1.4], [180 + Math.cos(a) * tilt, 0, -Math.sin(a) * tilt]));
      glow.push(piece(new THREE.SphereGeometry(.007 * h, 4, 3), C.glowFlame, [x * 1.4, .085 * h, z * 1.4]));
    }
    return { solid, glow };
  } },
};
export const DRESS_PROP_KEYS = Object.freeze(Object.keys(PROPS));

let solidMaterial = null, glowMaterial = null;
function materials() {
  if (!solidMaterial) {
    solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: .08 });
    glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    solidMaterial.userData.sharedDress = glowMaterial.userData.sharedDress = true;
  }
  return [solidMaterial, glowMaterial];
}

const geometryCache = new Map();
/** 소품 지오메트리(불투명·발광)를 몸 키별로 한 번만 만든다. */
function propGeometry(key, h) {
  const id = `${key}|${h.toFixed(2)}`;
  let hit = geometryCache.get(id);
  if (!hit) {
    const built = PROPS[key].build(h);
    const merge = (list) => {
      if (!list.length) return null;
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const part of list) part.dispose();
      g.computeBoundingSphere(); g.userData.sharedDress = true;
      return g;
    };
    hit = { solid: merge(built.solid), glow: merge(built.glow) };
    geometryCache.set(id, hit);
  }
  return hit;
}

/** 소품 몸 상대 삼각형 수(성능 예산 기록·테스트용). */
export function dressPropTriangles(key, h = 2) {
  const { solid, glow } = propGeometry(key, h);
  const tri = (g) => g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
  return tri(solid) + tri(glow);
}

function findBone(root, names) {
  for (const name of names) {
    const pattern = new RegExp(`^(?:mixamorig\\d*[:_]?)?${name}$`, 'i');
    let hit = null;
    root.traverse((o) => { if (!hit && o.isBone && pattern.test(o.name || '')) hit = o; });
    if (hit) return hit;
  }
  return null;
}

/**
 * 소품 하나를 뼈에 붙인다. 모델은 아직 애니메이션을 재생하기 전(휴식 자세)이어야 한다.
 * @returns {THREE.Group | null}
 */
export function attachDressProp(model, key, heightM) {
  const prop = PROPS[key];
  if (!prop) return null;
  const bone = prop.root ? model : findBone(model, prop.bones);
  if (!bone) return null;
  const h = heightM > 0 ? heightM : 2;
  model.updateWorldMatrix(true, true);
  // 뼈의 모델 공간 휴식 행렬. 모델 배율은 양변에서 지워지므로 등장 연출(배율 0.01)과 무관하다.
  if (prop.root) _boneM.identity();
  else { _inv.copy(model.matrixWorld).invert(); _boneM.multiplyMatrices(_inv, bone.matrixWorld); }
  _p.setFromMatrixPosition(_boneM).add(new THREE.Vector3(prop.at[0] * h, prop.at[1] * h, prop.at[2] * h));
  _e.set(THREE.MathUtils.degToRad(prop.rot[0]), THREE.MathUtils.degToRad(prop.rot[1]), THREE.MathUtils.degToRad(prop.rot[2]));
  _want.compose(_p, _q.setFromEuler(_e), new THREE.Vector3().setScalar(prop.scale || 1));
  const socket = new THREE.Group(); socket.name = `ChapterDress_${key}`;
  socket.matrix.copy(_boneM.invert().multiply(_want)); socket.matrixAutoUpdate = false;
  const [solidMat, glowMat] = materials(), geo = propGeometry(key, h);
  if (geo.solid) { const m = new THREE.Mesh(geo.solid, solidMat); m.castShadow = false; m.frustumCulled = false; socket.add(m); }
  if (geo.glow) { const m = new THREE.Mesh(geo.glow, glowMat); m.castShadow = false; m.frustumCulled = false; socket.add(m); }
  bone.add(socket);
  return socket;
}

const remapCache = new Map();
/**
 * 손그림 텍스처의 색상(hue) 범위를 장 팔레트로 옮긴 복제 텍스처. 밝기는 보존해 무늬·음영을 살린다.
 * hue 범위 안 픽셀은 mix, 밖은 baseMix 만큼 섞는다. 텍스처·팔레트별로 한 번만 만들고 공유한다(브라우저 전용).
 * @param {THREE.Texture} map @param {{ dark: string, light: string, hues: [number, number], mix: number, baseMix?: number }} remap
 */
export function remapTexture(map, remap) {
  const image = map?.image;
  if (!image || typeof document === 'undefined' || !(image.width > 0)) return null;
  const key = `${map.uuid}|${remap.dark}|${remap.light}|${remap.hues}|${remap.mix}|${remap.baseMix || 0}`;
  if (remapCache.has(key)) return remapCache.get(key);
  let texture = null;
  try {
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale)), h = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h), px = data.data;
    // 텍스처 바이트는 sRGB 이므로 팔레트도 '#rrggbb' 그대로 0~255 로 섞는다.
    const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const d = rgb(remap.dark), l = rgb(remap.light);
    const [h0, h1] = remap.hues, mix = remap.mix, base = remap.baseMix || 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
      let hue = 0;
      if (c > 0) hue = max === r ? 60 * (((g - b) / c) % 6) : max === g ? 60 * ((b - r) / c + 2) : 60 * ((r - g) / c + 4);
      if (hue < 0) hue += 360;
      // 채도가 낮은 픽셀(뼈·회색)은 범위 밖으로 본다.
      const inRange = c > 24 && hue >= h0 && hue <= h1;
      const k = inRange ? mix : base;
      if (!k) continue;
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      px[i] = r + ((d[0] + (l[0] - d[0]) * lum) - r) * k;
      px[i + 1] = g + ((d[1] + (l[1] - d[1]) * lum) - g) * k;
      px[i + 2] = b + ((d[2] + (l[2] - d[2]) * lum) - b) * k;
    }
    ctx.putImageData(data, 0, 0);
    texture = new THREE.CanvasTexture(canvas);
    texture.flipY = map.flipY; texture.colorSpace = map.colorSpace; texture.wrapS = map.wrapS; texture.wrapT = map.wrapT;
    texture.channel = map.channel; texture.offset.copy(map.offset); texture.repeat.copy(map.repeat); texture.rotation = map.rotation; texture.center.copy(map.center);
    texture.anisotropy = map.anisotropy; texture.userData.sharedDress = true;
  } catch { texture = null; }
  remapCache.set(key, texture);
  return texture;
}

/**
 * 적에게 장 의상을 입힌다. 몸 재질(인스턴스 복제본)에 색조·기본 발광을 주고 소품을 붙인다.
 * @param {{ model: THREE.Object3D, mats: THREE.Material[], libraryAsset?: { id?: string, heightM?: number } | null, def?: any }} enemy
 * @param {*} stage @param {string} species
 * @returns {{ species: string, props: string[] } | null}
 */
export function dressEnemy(enemy, stage, species) {
  const spec = chapterDressFor(stage, species, enemy.libraryAsset?.id);
  if (!spec) return null;
  if (spec.remap) for (const m of enemy.mats) { const t = m.map && remapTexture(m.map, spec.remap); if (t) { m.map = t; m.needsUpdate = true; } }
  if (spec.color && spec.amount) { const c = new THREE.Color(spec.color); for (const m of enemy.mats) m.color?.lerp(c, spec.amount); }
  if (spec.emissive) { const c = new THREE.Color(spec.emissive); for (const m of enemy.mats) if (m.emissive) { m.userData.baseEmissive = c.clone(); m.emissive.copy(c); } }
  const props = [];
  for (const key of spec.props || []) if (attachDressProp(enemy.model, key, enemy.libraryAsset?.heightM)) props.push(key);
  return { species, props, ghostGlow: spec.ghostGlow || null };
}
