import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gearLook } from '../data/gear-catalog.js';
import { fitForgedWeapon } from './forged-weapons.js';

const cache = new Map();
export const ITEM_WEAPON_FORMS = Object.freeze({
  '1H_Sword': 'sword', '2H_Sword': 'greatsword', '1H_Sword_Offhand': 'sword',
  '1H_Axe': 'axe', '2H_Axe': 'greataxe', '1H_Axe_Offhand': 'axe',
  '1H_Wand': 'wand', '2H_Staff': 'staff', Knife: 'dagger', Knife_Offhand: 'dagger', Bow: 'bow',
});

const MATTE_SURFACES = new Set(['wood', 'bone', 'cloth', 'straw', 'leather']);
// 금속/비금속 PBR 마스크를 정점에 굽고 한 배치로 병합한다. 쌍수도 드로우콜을 늘리지 않는다.
function assembler(palette, surface = 'metal') {
  const pieces = [[], []];
  return {
    add(geometry, color, position = [0, 0, 0], scale = [1, 1, 1], glow = 0, forceMatte = undefined) {
      geometry.scale(...scale); geometry.translate(...position);
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      if (flat !== geometry) geometry.dispose();
      flat.deleteAttribute('uv');
      const rgb = new THREE.Color(color), colors = new Float32Array(flat.attributes.position.count * 3), positions = flat.attributes.position;
      const matte = forceMatte ?? (color === palette.grip || MATTE_SURFACES.has(surface));
      const tint = new THREE.Color(), rust = new THREE.Color('#8d4526');
      for (let i = 0; i < positions.count; i++) {
        tint.copy(rgb);
        // 부식과 나무결은 고정 좌표의 색으로 굽는다. 프레임 난수·텍스처 할당은 없다.
        if (surface === 'rust' && color === palette.metal) {
          const spot = Math.sin(positions.getY(i) * 31 + positions.getX(i) * 71) * Math.cos(positions.getY(i) * 13);
          tint.lerp(rust, spot > -.1 ? .75 : .15);
        }
        if (surface === 'wood') tint.multiplyScalar(.88 + Math.sin(positions.getX(i) * 140 + positions.getY(i) * 9) * .12);
        tint.toArray(colors, i * 3);
      }
      flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      flat.setAttribute('forgeGlow', new THREE.BufferAttribute(new Float32Array(positions.count).fill(glow), 1));
      flat.setAttribute('forgeMetal', new THREE.BufferAttribute(new Float32Array(positions.count).fill(matte ? 0 : 1), 1));
      pieces[matte ? 1 : 0].push(flat);
    },
    finish() {
      const batches = pieces.map(parts => parts.length ? mergeGeometries(parts, false) : null);
      const geometry = mergeGeometries(batches.filter(Boolean), false);
      for (const parts of pieces) for (const piece of parts) piece.dispose();
      for (const batch of batches) batch?.dispose();
      if (!geometry) throw Error('아이템 형상 병합 실패');
      geometry.addGroup(0, geometry.attributes.position.count, 0);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

function polygon(points, depth = .045) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .006, bevelThickness: .006, bevelSegments: 1, steps: 1, curveSegments: 4 }).translate(0, 0, -depth / 2);
}
const sphere = (r) => new THREE.SphereGeometry(r, 10, 6);
const gem = (r) => new THREE.OctahedronGeometry(r);
const ring = (r, t, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 6, 20, arc);
const rod = (r, h) => new THREE.CylinderGeometry(r, r, h, 8);
const profiles = ['straight', 'broad', 'curved', 'serrated', 'leaf', 'flamberge', 'cleaver', 'needle'];

function crest(a, kind, x, y, color, size = .16) {
  if (kind === 'none') return;
  if (kind === 'orb') a.add(sphere(size), color, [x, y, 0]);
  else if (kind === 'crystal') a.add(gem(size), color, [x, y, 0], [.8, 1.5, .8]);
  else if (kind === 'crescent') a.add(ring(size, .026, Math.PI * 1.4), color, [x, y, 0]);
  else if (kind === 'cage') {
    a.add(ring(size, .023), color, [x, y, 0]);
    a.add(ring(size, .023).rotateY(Math.PI / 2), color, [x, y, 0]);
    a.add(gem(size * .55), color, [x, y, 0]);
  } else {
    const points = [];
    const teeth = kind === 'star' ? 5 : 3;
    for (let i = 0; i < teeth * 2; i++) {
      const angle = i / (teeth * 2) * Math.PI * 2 + Math.PI / 2, r = size * (i % 2 ? .45 : 1);
      points.push([Math.cos(angle) * r, Math.sin(angle) * r * (kind === 'flame' ? 1.3 : 1)]);
    }
    a.add(polygon(points, .07), color, [x, y, 0]);
  }
}

function grip(a, look, h = .33) {
  const p = look.palette;
  a.add(rod(.043, h), p.grip, [0, -.025, 0]);
  for (let i = 0; i < 4; i++) a.add(ring(.043, .009).rotateX(Math.PI / 2), p.accent, [0, -.13 + i * .068, 0]);
  const y = -.025 - h / 2;
  if (look.pommel === 'ring') a.add(ring(.065, .022), p.accent, [0, y, 0]);
  else if (look.pommel === 'spike') a.add(new THREE.ConeGeometry(.057, .16, 6).rotateZ(Math.PI), p.metal, [0, y - .03, 0]);
  else if (look.pommel === 'gem') a.add(gem(.069), look.gem || p.accent, [0, y, 0]);
  else if (look.pommel === 'tassel') a.add(new THREE.ConeGeometry(.065, .20, 8), p.accent, [0, y - .07, 0]);
  else a.add(sphere(.06), p.accent, [0, y, 0]);
  const gy = .16;
  if (look.guard === 'none') return;
  if (look.guard === 'disc') a.add(rod(.13, .045), p.accent, [0, gy, 0]);
  else if (look.guard === 'basket') a.add(ring(.14, .023, Math.PI * 1.5), p.accent, [0, .025, 0]);
  else if (look.guard === 'crescent') a.add(ring(.16, .035, Math.PI).rotateZ(Math.PI), p.accent, [0, gy + .015, 0]);
  else if (look.guard === 'wing') a.add(polygon([[-.24, .10], [-.10, 0], [0, .03], [.10, 0], [.24, .10], [.12, -.06], [-.12, -.06]]), p.accent, [0, gy, 0]);
  else a.add(new THREE.BoxGeometry(.36, .05, .085), p.accent, [0, gy, 0]);
}

function blade(a, look, height, width) {
  const points = [], steps = look.profile === 'serrated' ? 12 : 8;
  for (const side of [-1, 1]) {
    for (let j = 0; j <= steps; j++) {
      const i = side < 0 ? j : steps - j, t = i / steps;
      let w = width, bend = 0;
      if (look.profile === 'broad') w *= 1.5 - t * .4;
      if (look.profile === 'curved') bend = t * t * width * 2.4;
      if (look.profile === 'serrated') w *= i % 2 ? 1.45 : .8;
      if (look.profile === 'leaf') w *= .55 + Math.sin(t * Math.PI) * 1.2;
      if (look.profile === 'flamberge') bend = Math.sin(t * Math.PI * 5) * width * .5;
      if (look.profile === 'cleaver') w *= 1.65;
      if (look.profile === 'needle') w *= .38;
      if (i === steps) w *= look.profile === 'cleaver' ? .85 : 0;
      points.push([bend + side * w, .19 + t * height]);
    }
  }
  a.add(polygon(points, width * .42), look.palette.metal);
  if (look.surface === 'lava') {
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) {
      const y = .25 + height * (i + .5) / 8, x = Math.sin(i * 1.7) * width * .4;
      a.add(new THREE.BoxGeometry(width * .48, .022, .014).rotateZ(i % 2 ? .7 : -.7), look.palette.accent, [x, y, side * (width * .21 + .014)], [1, 1, 1], 1.1);
    }
  } else if (look.surface === 'rune') {
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) a.add(polygon([[-.018, .03], [.018, 0], [-.018, -.03], [0, 0]], .014), look.palette.accent, [0, .30 + height * i / 6, side * (width * .21 + .014)], [1, 1, 1], .35);
  } else for (const side of [-1, 1]) a.add(new THREE.BoxGeometry(.018, height * .62, .014), look.palette.accent, [0, .28 + height * .32, side * (width * .21 + .014)]);
  if (look.surface === 'wood') for (const x of [-.03, .025]) for (const side of [-1, 1]) a.add(new THREE.BoxGeometry(.007, height * .80, .014), look.palette.grip, [x, .25 + height * .40, side * (width * .21 + .014)]);
}

const smooth = (r) => new THREE.SphereGeometry(r, 16, 10);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const loop = (points, tube, closed = true) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), points.length * 2, tube, 8, closed);
const circle = (count, point) => Array.from({ length: count }, (_, i) => point(i / count * Math.PI * 2));

// 반지: 띠·보석·어깨 장식이 아이콘 크기에서 실루엣으로 읽히도록 크게 만든다.
function buildRing(a, r) {
  const p = r.palette, R = r.radius || .27, matte = MATTE_SURFACES.has(r.surface);
  const put = (geometry, color, position = [0, 0, 0], scale = [1, 1, 1], flat = matte) => a.add(geometry, color, position, scale, 0, flat);
  const band = (radius, tube, arc = Math.PI * 2) => new THREE.TorusGeometry(radius, tube, 10, 56, arc);
  let mounts = [[0, R + .08, 0]], bezel = true, scale = 1;
  if (r.band === 'plain') put(band(R, .055), p.metal, [0, 0, 0], [1, 1, 1.7]);
  else if (r.band === 'twist') {
    // 두 가닥을 반대 위상으로 감아 굵은 꼬임이 보이게 한다.
    for (const [phase, color] of [[0, p.metal], [Math.PI, p.grip]]) put(loop(circle(112, t => {
      const radial = R + .034 * Math.cos(7 * t + phase);
      return v3(Math.cos(t) * radial, Math.sin(t) * radial, .048 * Math.sin(7 * t + phase));
    }), .03), color);
  } else if (r.band === 'claw') {
    put(band(R, .042), p.metal); bezel = false;
    if (r.stone === 'none') {
      // 보석이 없는 발톱 띠는 다섯 갈래 왕관이 된다.
      for (let i = 0; i < 5; i++) {
        const angle = Math.PI / 2 + (i - 2) * .34;
        put(new THREE.ConeGeometry(.04, .22, 6).rotateZ(angle - Math.PI / 2), p.metal, [Math.cos(angle) * (R + .1), Math.sin(angle) * (R + .1), 0]);
        put(smooth(.035), p.accent, [Math.cos(angle) * (R + .22), Math.sin(angle) * (R + .22), 0]);
      }
    } else for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      put(new THREE.CylinderGeometry(.016, .032, .32, 6).rotateZ(sx * .38).rotateX(-sz * .38), p.metal, [sx * .115, R + .1, sz * .095]);
    }
  } else if (r.band === 'double') {
    put(band(R, .036), p.metal, [0, 0, -.08]); put(band(R, .036), p.grip, [0, 0, .08]);
    put(new THREE.BoxGeometry(.08, .05, .2), p.metal, [0, R + .015, 0]);
  } else if (r.band === 'signet') {
    put(band(R, .048), p.metal);
    put(new THREE.CylinderGeometry(.17, .14, .08, 28), p.metal, [0, R + .04, 0]);
    mounts = [[0, R + .12, 0]]; bezel = false; scale = .78;
    if (r.stone === 'none') put(starPlate(.11).rotateX(-Math.PI / 2), p.accent, [0, R + .085, 0]);
  } else if (r.band === 'wave') {
    put(loop(circle(128, t => { const radial = R + .04 * Math.sin(9 * t); return v3(Math.cos(t) * radial, Math.sin(t) * radial, 0); }), .042), p.metal);
  } else {
    // 열린 띠: 두 끝이 앞뒤로 엇갈리며 보석을 하나씩 문다.
    const gap = .5, points = Array.from({ length: 64 }, (_, i) => {
      const u = i / 63, angle = Math.PI / 2 + gap + u * (Math.PI * 2 - gap * 2);
      return v3(Math.cos(angle) * R, Math.sin(angle) * R, -.07 + u * .14);
    });
    put(loop(points, .046, false), p.metal); bezel = false;
    const ends = [[Math.cos(Math.PI / 2 + gap) * (R + .04), Math.sin(Math.PI / 2 + gap) * (R + .04), -.07], [Math.cos(Math.PI / 2 - gap) * (R + .04), Math.sin(Math.PI / 2 - gap) * (R + .04), .07]];
    if (r.stone === 'none') for (const end of ends) put(smooth(.06), p.metal, end);
    mounts = r.stone === 'marquise' ? [[0, R + .07, 0]] : r.stone === 'cluster' ? [...ends, [0, R + .1, 0]] : ends;
    scale = r.stone === 'marquise' ? 1 : .8;
  }
  for (const mount of r.stone === 'none' ? [] : mounts) ringStone(put, r.stone, mount, scale, bezel, p);
  if (r.shoulder === 'gems') for (const side of [-1, 1]) {
    const angle = Math.PI / 2 + side * .85;
    put(gem(.055), p.accent, [Math.cos(angle) * (R + .03), Math.sin(angle) * (R + .03), 0], [1, 1, .7]);
  } else if (r.shoulder === 'wings') for (const side of [-1, 1]) {
    put(polygon([[0, 0], [.17, .11], [.25, .03], [.15, -.01], [.21, -.06], [.06, -.04]].map(([x, y]) => [x * side, y]), .03), p.metal, [side * .1, R + .02, 0]);
  } else if (r.shoulder === 'beads') for (let i = 0; i < 7; i++) {
    const angle = -Math.PI / 2 + (i - 3) * .3;
    for (const z of [-.05, .05]) put(smooth(.026), p.accent, [Math.cos(angle) * R, Math.sin(angle) * R, z]);
  }
}

function ringStone(put, kind, [x, y, z], s, bezel, p) {
  if (kind === 'round') { put(smooth(.125 * s), p.accent, [x, y, z], [1, 1, 1], false); if (bezel) put(rod(.1 * s, .05), p.metal, [x, y - .08 * s, z]); }
  else if (kind === 'square') {
    put(new THREE.BoxGeometry(.19 * s, .15 * s, .19 * s).rotateY(Math.PI / 4), p.accent, [x, y, z], [1, 1, 1], false);
    if (bezel) put(new THREE.BoxGeometry(.24 * s, .05, .24 * s).rotateY(Math.PI / 4), p.metal, [x, y - .08 * s, z]);
  } else if (kind === 'marquise') {
    put(gem(.14 * s), p.accent, [x, y, z], [1.9, .75, .85], false);
    if (bezel) put(rod(.08 * s, .045), p.metal, [x, y - .07 * s, z], [2.3, 1, 1]);
  } else if (kind === 'cluster') {
    put(gem(.1 * s), p.accent, [x, y + .02, z], [1, 1, 1], false);
    for (const [dx, dz] of [[-.12, 0], [.12, 0], [0, -.1], [0, .1]]) put(gem(.065 * s), p.accent, [x + dx * s, y - .03, z + dz * s], [1, 1, 1], false);
  }
}

function starPlate(size) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const angle = i / 10 * Math.PI * 2 + Math.PI / 2, radius = size * (i % 2 ? .45 : 1);
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return polygon(points, .02);
}

// 신발: 모양별 높이·발끝·끈 구조가 달라 같은 색이어도 실루엣이 갈린다.
function buildBoots(a, b) {
  const p = b.palette, shape = b.shape;
  const H = { shoe: .14, slipper: .1, sandal: .14, clog: .16, boot: .52, greave: .74, sabaton: .44 }[shape] ?? .5;
  const tall = ['boot', 'greave', 'sabaton'].includes(shape), cz = tall ? -.04 : -.02;
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  for (const side of [-1, 1]) {
    const x0 = side * .19;
    const put = (geometry, color, [x, y, z], scale = [1, 1, 1], matte = true) => a.add(geometry, color, [x0 + x, y, z], scale, 0, matte);
    if (shape === 'clog') {
      put(box(.25, .1, .48), p.grip, [0, -.01, .08]);
      for (const z of [-.06, .24]) put(box(.25, .09, .07), p.metal, [0, -.105, z]);
      for (const z of [.13, .25]) put(new THREE.TorusGeometry(.125, .03, 6, 16, Math.PI), p.accent, [0, .04, z]);
    } else if (shape === 'sandal') {
      put(box(.25, .045, .48), p.metal, [0, -.04, .08]);
      // 발등 끈은 몸통 색, 뒤꿈치·발목은 장식 색으로 나눠 밝은 팔레트에서도 구조가 보이게 한다.
      for (const [z, turn] of [[.24, .5], [.24, -.5], [.07, .45], [.07, -.45]]) put(box(.27, .03, .05).rotateY(turn), p.grip, [0, 0, z]);
      // 뒤꿈치 받침과 발목 고리 하나가 밑창에 이어져 떠 있는 끈처럼 보이지 않게 한다.
      put(box(.22, .1, .05), p.accent, [0, .03, -.14]);
      put(new THREE.TorusGeometry(.11, .022, 6, 20).rotateX(Math.PI / 2), p.accent, [0, .1, -.06], [1, 1, 1.25]);
      for (const sx of [-1, 1]) put(box(.03, .12, .03), p.accent, [sx * .1, .05, -.02]);
    } else if (shape === 'slipper') {
      put(box(.24, .03, .44), p.metal, [0, -.045, .06]);
      put(box(.22, .09, .34), p.grip, [0, .01, .04]);
      put(smooth(.11), p.grip, [0, .01, .2], [1, .5, 1.1]);
      put(loop([v3(0, .02, .25), v3(0, .06, .36), v3(0, .15, .42), v3(0, .21, .36)], .034, false), p.grip, [0, 0, 0]);
      put(smooth(.04), p.accent, [0, .21, .35]);
    } else {
      put(box(.25, .05, .48), p.metal, [0, -.04, .08], [1, 1, 1], shape !== 'sabaton');
      if (shape === 'sabaton') {
        for (let i = 0; i < 4; i++) put(box(.25, .055, .13), p.metal, [0, .02 + i * .035, .3 - i * .085], [1, 1, 1], false);
        put(new THREE.ConeGeometry(.1, .22, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), p.metal, [0, 0, .44], [1.2, .6, 1], false);
        put(new THREE.CylinderGeometry(.145, .13, H - .08, 14), p.metal, [0, (H - .08) / 2 + .06, cz], [1, 1, 1], false);
        for (const y of [.18, .34]) put(new THREE.TorusGeometry(.148, .016, 6, 20).rotateX(Math.PI / 2), p.accent, [0, y, cz], [1, 1, 1], false);
        put(box(.22, .06, .3), p.grip, [0, 0, .1]);
      } else {
        put(box(.23, .13, .36), p.grip, [0, .045, .06]);
        put(smooth(.115), p.grip, [0, .04, .24], [1, .62, 1.15]);
        if (shape === 'shoe') put(box(.15, .03, .12), p.accent, [0, .115, .05]);
        else put(new THREE.CylinderGeometry(.13, .13, H - .06, 16), p.grip, [0, (H - .06) / 2 + .04, cz]);
        if (shape === 'greave') {
          put(box(.18, .44, .05), p.metal, [0, .42, .095], [1, 1, 1], false);
          put(smooth(.11), p.metal, [0, .7, .08], [1.05, .9, .6], false);
        }
      }
    }
    // 목 장식
    if (b.cuff === 'fold') put(tall ? new THREE.CylinderGeometry(.18, .165, .14, 18) : new THREE.CylinderGeometry(.15, .14, .07, 18), p.accent, [0, H - (tall ? .05 : .03), cz]);
    else if (b.cuff === 'fur') put(tall ? new THREE.TorusGeometry(.15, .075, 8, 20).rotateX(Math.PI / 2) : new THREE.TorusGeometry(.13, .055, 8, 20).rotateX(Math.PI / 2), p.accent, [0, H - .01, cz]);
    else if (b.cuff === 'plate') {
      put(new THREE.CylinderGeometry(.22, .145, .14, 12), p.metal, [0, H, cz], [1, 1, 1], false);
      put(box(.16, .22, .04), p.metal, [0, H + .06, cz + .13], [1, 1, 1], false);
    } else if (b.cuff === 'wing') {
      // 낮은 신발의 날개는 뒤꿈치에 붙인다.
      put(polygon([[0, 0], [.16, .07], [.34, .24], [.26, .09], [.33, .04], [.17, -.02]], .03).rotateY(Math.PI / 2), p.metal, [side * .15, tall ? H - .04 : .02, tall ? cz : -.1], [1, 1, 1], false);
    }
    // 끈 장식
    if (b.strap === 'buckles') {
      const bands = tall ? [[H * .45, cz, .14, 1], [H * .75, cz, .14, 1]] : [[.06, .08, .13, 1.7]];
      for (const [y, z, radius, stretch] of bands) {
        put(new THREE.TorusGeometry(radius, .02, 6, 20).rotateX(Math.PI / 2), p.accent, [0, y, z], [1, 1, stretch]);
        put(box(.07, .06, .03), p.metal, [0, y, z + radius * stretch + .02], [1, 1, 1], false);
      }
    } else if (b.strap === 'laces') {
      if (tall) for (let y = .14; y < H - .06; y += .09) for (const turn of [-.6, .6]) put(box(.12, .018, .018).rotateZ(turn), p.accent, [0, y, cz + .135]);
      else for (const z of [0, .07, .14]) for (const turn of [-.6, .6]) put(box(.12, .018, .018).rotateY(turn), p.accent, [0, .12, z]);
    } else if (b.strap === 'studs') {
      for (let i = 0; i < 5; i++) put(smooth(.028), p.metal, [side * .125, 0, -.1 + i * .09], [1, 1, 1], false);
      if (tall) for (const y of [H * .35, H * .55, H * .75]) put(smooth(.026), p.metal, [side * .14, y, cz], [1, 1, 1], false);
    }
  }
}

export function buildItemGeometry(form, item) {
  const look = gearLook(item), spec = look.weapon || look.ring || look.boots;
  const a = assembler(spec.palette, spec.surface);
  if (form === 'ring') buildRing(a, look.ring);
  else if (form === 'boots') buildBoots(a, look.boots);
  else {
    const w = look.weapon, p = w.palette, index = profiles.indexOf(w.profile);
    if (form === 'bow') {
      const height = 1.0 * w.length;
      const curve = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => {
        const t = i / 8 * 2 - 1;
        return new THREE.Vector3(-(Math.cos(t * Math.PI / 2) * (.20 + index * .018) + (w.profile === 'flamberge' ? Math.sin(t * 8) * .045 : 0)), t * height, 0);
      }));
      a.add(new THREE.TubeGeometry(curve, 24 + index * 2, .034 * w.width, 6, false), p.metal);
      a.add(rod(.008, height * 2), p.accent);
      a.add(rod(.057, .23), p.grip, [-.20 - index * .018, 0, 0]);
      crest(a, w.crest, -.12, height * .70, p.accent, .10);
    } else if (form === 'axe' || form === 'greataxe') {
      const h = (form === 'greataxe' ? 1.45 : 1.05) * w.length;
      grip(a, w); a.add(rod(.045 * w.width, h), p.grip, [0, h / 2 + .12, 0]);
      const edge = .32 * w.width, y = h * .86;
      const teeth = w.profile === 'serrated' ? 8 : 4, points = [[.025, y - .19], [.18, y - .22]];
      for (let i = 0; i <= teeth; i++) {
        const t = i / teeth;
        points.push([edge + Math.sin(t * Math.PI) * (.10 + index * .009) + (w.profile === 'serrated' && i % 2 ? .08 : 0), y - .25 + t * .54]);
      }
      points.push([.025, y + .16]); a.add(polygon(points, .09), p.metal);
      if (form === 'greataxe') a.add(polygon(points.map(([x, py]) => [-x, py]), .09), p.metal);
      crest(a, w.crest, 0, h + .18, p.accent, .08);
    } else if (form === 'wand' || form === 'staff') {
      const h = (form === 'staff' ? 1.48 : .72) * w.length;
      grip(a, w); a.add(rod(.036 + index * .003, h), p.metal, [0, h / 2 + .15, 0]);
      a.add(ring(.095 * w.width, .022).rotateX(Math.PI / 2), p.accent, [0, h + .10, 0]);
      crest(a, w.crest, 0, h + .28, w.gem || p.accent, .14 * w.width);
    } else {
      grip(a, w, form === 'greatsword' ? .43 : .33);
      const bladeHeight = (form === 'dagger' ? .55 : form === 'greatsword' ? 1.4 : 1.0) * w.length, bladeWidth = (form === 'greatsword' ? .105 : .072) * w.width;
      blade(a, w, bladeHeight, bladeWidth);
      // 문장은 가드 위 리카소에 날 폭보다 크게 달아 정면 실루엣에서 읽히게 한다.
      crest(a, w.crest, 0, .3 + bladeHeight * .06, p.accent, bladeWidth * 1.7);
    }
  }
  const geometry = a.finish();
  if (form === 'boots') { geometry.scale(1, 1, look.boots.length || 1); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return geometry;
}

/** 형식·ID 단위 공유 버퍼. 소켓 치수별 파생 형상도 같은 항목에서 관리한다.
 * @param {string} form
 * @param {any} item
 * @param {THREE.Box3|null} bounds
 */
export function acquireItemGeometry(form, item, bounds = null) {
  const key = `${form}:${item.id}`;
  let entry = cache.get(key);
  if (!entry) { entry = { geometry: buildItemGeometry(form, item), fitted: new Map(), refs: 0 }; cache.set(key, entry); }
  let geometry = entry.geometry;
  if (bounds) {
    const signature = [...bounds.min.toArray(), ...bounds.max.toArray()].join(',');
    if (!entry.fitted.has(signature)) {
      try { entry.fitted.set(signature, fitForgedWeapon(geometry, bounds, form)); }
      catch (error) {
        if (entry.refs === 0) { cache.delete(key); entry.geometry.dispose(); }
        throw error;
      }
    }
    geometry = entry.fitted.get(signature);
  }
  entry.refs++;
  let released = false;
  return { geometry, release() {
    if (released) return; released = true;
    if (--entry.refs === 0) {
      cache.delete(key); entry.geometry.dispose();
      for (const fitted of entry.fitted.values()) fitted.dispose();
    }
  } };
}

export function itemForgeCacheSize() { return cache.size; }
export function createItemMaterial(item) {
  const surface = gearLook(item).weapon?.surface;
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: surface === 'ice' ? .25 : .33, metalness: .82 });
  // 균열 파츠만 발광한다. 날·손잡이 전체를 발광 덩어리로 만들지 않는다.
  metal.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float forgeGlow;\nattribute float forgeMetal;\nvarying float vForgeGlow;\nvarying float vForgeMetal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvForgeGlow = forgeGlow;\nvForgeMetal = forgeMetal;');
    shader.fragmentShader = 'varying float vForgeGlow;\nvarying float vForgeMetal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * vForgeGlow;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vForgeMetal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.83, roughnessFactor, vForgeMetal);');
  };
  metal.customProgramCacheKey = () => 'gear-pbr-cracks-v2';
  return [metal];
}

/** 아이콘과 런타임이 같은 원본 형상을 소비한다. 반환 메시가 자신의 참조를 소유한다. */
export function buildGearModel(item, form = item.slot === 'weapon' ? 'sword' : item.slot) {
  const lease = acquireItemGeometry(form, item), material = createItemMaterial(item);
  const mesh = new THREE.Mesh(lease.geometry, material); mesh.name = `Gear_${item.id}`;
  let disposed = false;
  mesh.userData.dispose = () => { if (disposed) return; disposed = true; mesh.removeFromParent(); lease.release(); for (const part of material) part.dispose(); };
  return mesh;
}

