import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyGateStoneSurface, onGateStoneSurface, preloadGateStoneSurface } from './gate-stone-surface.js';

// 자체 생성 12칸 원화의 큰 구조를 직접 모델링한다. 기존 입장·충돌 데이터는 읽기만 한다.
export const CITADEL_GATE_REFERENCE = 'citadel-gates-20261008';
export const CITADEL_GATE_DESIGNS = Object.freeze({
  glass_garden: 'crystal-greenhouse', ember_vault: 'armored-vault', star_archive: 'layered-star-library',
  bellfall_crypt: 'hanging-bell-mausoleum', cinder_tide_lock: 'valve-sluice',
  nightglass_observatory: 'armillary-observatory', eclipse_hydra_vault: 'three-headed-rib-maw',
  ashforge_catacomb: 'anvil-furnace', astral_leviathan_spire: 'leviathan-bone-spire',
  verdigris_sanctum: 'copper-leaf-sanctuary', sable_mirage_basin: 'sandstone-crescent',
  comet_bastion: 'meteor-battlement', campaign: 'oath-banner', arena: 'crossed-blade-arena',
});

// 구조물의 재질과 별개로 던전 안쪽의 균열 색을 유지한다. 캠페인·투기장은 포털이 아니다.
export const CITADEL_GATE_PORTALS = Object.freeze({
  glass_garden: 0x62efbd, ember_vault: 0xff9846, star_archive: 0x9cbcff,
  bellfall_crypt: 0x88dfc3, cinder_tide_lock: 0x51dfe3, nightglass_observatory: 0xa48aff,
  eclipse_hydra_vault: 0xff5278, ashforge_catacomb: 0xff7146, astral_leviathan_spire: 0x70c6ff,
  verdigris_sanctum: 0x5fe5aa, sable_mirage_basin: 0xffcf79, comet_bastion: 0xbd8fff,
});

const EXTRA_GATE_DESIGNS = Object.freeze({ rootbound_grotto: 'verdigris_sanctum', hollowbell_arboretum: 'bellfall_crypt',
  slagwater_foundry: 'ashforge_catacomb', emberwake_drydock: 'cinder_tide_lock', aurora_icewell: 'nightglass_observatory', crownfall_glacier: 'sable_mirage_basin' });
const EXTRA_GATE_PORTALS = Object.freeze({ rootbound_grotto: 0x5fe5aa, hollowbell_arboretum: 0x88dfc3,
  slagwater_foundry: 0xff7146, emberwake_drydock: 0x51dfe3, aurora_icewell: 0xa48aff, crownfall_glacier: 0xffcf79 });

// 둥근 쐐기돌 아치를 얹는 루트. 나머지는 평평한 상인방이라 포털을 낮은 모양으로 둔다.
const ARCH_ROUTES = Object.freeze(new Set(['glass_garden', 'star_archive', 'bellfall_crypt', 'nightglass_observatory',
  'eclipse_hydra_vault', 'astral_leviathan_spire', 'verdigris_sanctum', 'sable_mirage_basin', 'campaign']));
// 돌 표면의 이끼 양(0~1). 적힌 루트만 이끼가 많고 나머지는 거의 없다.
const MOSS_AMOUNT = Object.freeze({ bellfall_crypt: 1, verdigris_sanctum: .8, eclipse_hydra_vault: .55, campaign: .55,
  comet_bastion: .5, star_archive: .45, astral_leviathan_spire: .4, nightglass_observatory: .4, sable_mirage_basin: .35 });
const ARCH_CENTER = 2.352, ARCH_INNER = 1.125;

/** 입구 안쪽을 채우는 부채꼴 메시. 중심 하나와 아치 윤곽 정점 segments 개, 삼각형 segments 개. */
function archPortalGeometry(segments, tall = false) {
  // 둥근 아치 루트는 기둥머리 높이(2.352)부터 반원으로 올라가 쐐기돌 아치 안쪽 면을 가득 채운다.
  const halfWidth = ARCH_INNER, bottom = .06, shoulder = tall ? ARCH_CENTER : 2.15, crown = tall ? ARCH_CENTER + ARCH_INNER : 2.45;
  const center = bottom + (crown - bottom) * .459;
  const positions = [0, center, -.09], uvs = [.5, .5], index = [];
  // 윤곽 둘레를 길이로 고르게 나눠 정점을 놓는다: 아래 → 오른 기둥 → 머리 반타원 → 왼 기둥.
  const archRy = crown - shoulder, side = shoulder - bottom;
  const arcLength = Math.PI * (3 * (halfWidth + archRy) - Math.sqrt((3 * halfWidth + archRy) * (halfWidth + 3 * archRy))) / 2;
  const total = halfWidth * 2 + side * 2 + arcLength;
  const pointAt = s => {
    if (s < halfWidth) return [s, bottom];
    s -= halfWidth; if (s < side) return [halfWidth, bottom + s];
    s -= side; if (s < arcLength) { const a = (s / arcLength) * Math.PI; return [halfWidth * Math.cos(a), shoulder + archRy * Math.sin(a)]; }
    s -= arcLength; if (s < side) return [-halfWidth, shoulder - s];
    s -= side; return [-halfWidth + s, bottom];
  };
  for (let i = 0; i < segments; i++) {
    const [x, y] = pointAt(total * i / segments);
    const a = Math.atan2(y - center, x);
    positions.push(x, y, -.09); uvs.push(.5 + .5 * Math.cos(a), .5 + .5 * Math.sin(a));
  }
  for (let i = 0; i < segments; i++) index.push(0, 1 + i, 1 + (i + 1) % segments);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** 같은 루트는 항상 같은 돌 색·균열·이끼가 나오도록 하는 작은 난수기. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 기둥 중심 간격(한쪽). 기둥 충돌 원은 src/data/citadel-hub.js 에서 같은 값(1.5)과 반지름 .5 로 둔다.
const P = 1.5;
const COLORS = Object.freeze({
  ivory: 0xe1dfca, stone: 0x72898b, dark: 0x293842, iron: 0x45535e, bronze: 0xb98a48,
  gold: 0xd4b875, copper: 0xbb7650, glass: 0x65bda7, ice: 0x91cbe4, sapphire: 0x37628a,
  cyan: 0x91e6d7, ember: 0xffb25a, moss: 0x657568, obsidian: 0x2c3c46,
  jade: 0x468e75, sand: 0xc7ac80, violet: 0x74628d, bone: 0xcbd9cf,
});
const MOSS_COLORS = Object.freeze([0x6f9a3a, 0x86a83f, 0x4f7a2e]);

/**
 * 14개 구조물은 네 공유 재질로 병합하고, 12개 균열은 하나의 공유 셰이더만 사용한다.
 * @param {{ environmentTexture?: THREE.Texture | null, quality?: string }} [options]
 */
export function createCitadelGateDesignLibrary({ environmentTexture = null, quality = 'high' } = {}) {
  const materials = new Map(), geometries = new Set(), groups = new Set();
  let disposed = false, portalTime = 0;
  const segments = quality === 'low' ? 8 : 12, low = quality === 'low';
  const stoneUnsubscribers = [];
  function material(role) {
    if (!materials.has(role)) {
      const next = role === 'glow'
        ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
        : new THREE.MeshStandardMaterial({ vertexColors: true,
          roughness: role === 'metal' ? .46 : role === 'crystal' ? .27 : .88,
          metalness: role === 'metal' ? .65 : role === 'crystal' ? .12 : .025 });
      if (environmentTexture && next.isMeshStandardMaterial) { next.envMap = environmentTexture; next.envMapIntensity = .32; }
      next.name = `Citadel_Gate_Shared_${role}`; materials.set(role, next);
      // 돌 재질만 손그림 돌 질감을 곱한다. 낮음 품질은 생략하고, 로드 전·실패 시에는 정점 색만으로 그대로 그린다.
      if (role === 'stone' && !low) {
        if (!applyGateStoneSurface(next)) {
          stoneUnsubscribers.push(onGateStoneSurface(() => { if (!disposed) applyGateStoneSurface(next); }));
          preloadGateStoneSurface();
        }
      }
    }
    return materials.get(role);
  }

  function portalMaterial() {
    if (!materials.has('portal')) {
      const next = new THREE.ShaderMaterial({
        vertexColors: true, side: THREE.DoubleSide, toneMapped: false, fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { portalTime: { value: 0 } }]),
        vertexShader: `
          varying vec2 portalUv;
          varying vec3 portalTint;
          #include <fog_pars_vertex>
          void main() {
            portalUv = uv;
            portalTint = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: `
          uniform float portalTime;
          varying vec2 portalUv;
          varying vec3 portalTint;
          #include <fog_pars_fragment>
          float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 q) {
            vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          void main() {
            // uv.x 가 음수인 정점은 포털 안쪽이 아니라 돌에 새긴 룬·보석이다. 같은 재질로 그려 draw call 을 늘리지 않는다.
            if (portalUv.x < -0.5) {
              float pulse = 0.86 + 0.14 * sin(portalTime * 1.7 + portalTint.r * 5.0 + portalUv.y * 9.0);
              gl_FragColor = vec4(mix(portalTint, vec3(1.0), 0.12) * 1.3 * pulse, 1.0);
              #include <fog_fragment>
              #include <colorspace_fragment>
              return;
            }
            // uv 는 입구 윤곽을 단위 원으로 펼친 좌표다. 반경 1 이 아치 테두리, 0 이 터널 가장 안쪽이다.
            vec2 p = (portalUv - 0.5) * 2.0;
            float radius = min(length(p), 1.0);
            float angle = atan(p.y, p.x);
            float phase = portalTint.r * 4.0 + portalTint.b * 3.0;
            float t = portalTime;
            // 깊이: 바깥에서 안쪽으로 빨려 들어가는 터널. 1/r 원근으로 고리가 안쪽에서 촘촘해진다.
            float depthCoord = 0.32 / (radius + 0.12) + t * 0.55;
            float rings = pow(0.5 + 0.5 * sin(depthCoord * 6.2832 + phase), 3.0);
            float swirl = noise(vec2(angle * 2.2 + depthCoord * 1.7, depthCoord * 2.4 - t * 0.2));
            float mist = noise(p * 3.1 + vec2(t * 0.17, -t * 0.23)) * 0.6 + noise(p * 6.3 - vec2(t * 0.29, t * 0.11)) * 0.4;
            float tunnel = smoothstep(1.0, 0.05, radius);
            vec3 color = mix(portalTint * 0.06, vec3(0.006, 0.012, 0.03), smoothstep(0.15, 0.95, radius));
            color += portalTint * (0.16 + 0.42 * rings * swirl) * tunnel * (0.45 + 0.55 * mist);
            // 안쪽 깊은 곳의 부드러운 빛: 목적지가 저 너머에 있다는 신호.
            float core = exp(-radius * radius * 9.0);
            color += mix(portalTint, vec3(1.0), 0.55) * core * (0.85 + 0.15 * sin(t * 1.3 + phase));
            // 위로 떠오르는 빛 알갱이.
            vec2 grid = vec2(p.x * 7.0, p.y * 7.0 - t * 0.9);
            vec2 cell = floor(grid), local = fract(grid) - 0.5;
            float seed = hash(cell);
            float mote = smoothstep(0.11, 0.0, length(local - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6)) * step(0.72, seed);
            color += mix(portalTint, vec3(1.0), 0.7) * mote * (0.5 + 0.5 * sin(t * 3.0 + seed * 40.0)) * smoothstep(1.0, 0.6, radius);
            // 테두리: 안쪽 그늘 한 줄 뒤에 선명한 빛 가장자리가 아치를 따라 흐른다.
            float edge = exp(-pow((radius - 0.955) * 30.0, 2.0));
            float innerShade = smoothstep(0.78, 0.93, radius) * (1.0 - smoothstep(0.93, 0.97, radius));
            float flow = 0.6 + 0.4 * pow(0.5 + 0.5 * sin(angle * 5.0 - t * 1.4 + phase), 2.0);
            color *= 1.0 - innerShade * 0.55;
            color += mix(portalTint, vec3(1.0), 0.35) * edge * flow * 1.6;
            gl_FragColor = vec4(color, 1.0);
            #include <fog_fragment>
            #include <colorspace_fragment>
          }
        `,
      });
      next.name = 'Citadel_Gate_Shared_portal'; materials.set('portal', next);
    }
    return materials.get('portal');
  }

  function addPortal(root, route, tall, runeParts) {
    const color = CITADEL_GATE_PORTALS[route] ?? EXTRA_GATE_PORTALS[route];
    if (color === undefined) return;
    // 에너지 원판은 충돌·선택 대상이 아니다. 기존 좌우 기둥의 이동 통로를 바꾸지 않는다.
    // 원판 대신 입구 윤곽(곧은 기둥 사이 + 둥근 머리)을 채우는 부채꼴. 테두리 정점의 uv 를 단위 원 위에 둬
    // 셰이더의 반경 1 이 실제 아치 가장자리를 따라간다. 입구 삼각형 수는 높음 48, 낮음 32 로 같다.
    const opening = archPortalGeometry(quality === 'low' ? 32 : 48, tall).toNonIndexed();
    const count = opening.getAttribute('position').count, tint = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = tint.r; colors[i * 3 + 1] = tint.g; colors[i * 3 + 2] = tint.b; }
    opening.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // 룬·보석 조각(uv.x = -1)을 같은 메시에 합친다. 각 조각의 색은 포털 색에 면별 밝기를 곱한 값이다.
    const parts = [opening];
    for (const rune of runeParts) {
      const n = rune.getAttribute('position').count, shade = rune.getAttribute('shade'), tinted = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const k = shade ? shade.getX(i) : 1;
        tinted[i * 3] = tint.r * k; tinted[i * 3 + 1] = tint.g * k; tinted[i * 3 + 2] = tint.b * k;
        uv[i * 2] = -1; uv[i * 2 + 1] = (i * 0.37) % 1;
      }
      rune.deleteAttribute('shade');
      rune.setAttribute('color', new THREE.BufferAttribute(tinted, 3)); rune.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      parts.push(rune);
    }
    const geometry = parts.length > 1 ? mergeGeometries(parts, false) : opening;
    if (!geometry) throw new Error(`입구 포털 geometry 병합 실패: ${route}`);
    if (geometry !== opening) for (const part of parts) part.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, portalMaterial()); mesh.name = `Citadel_Portal_${route}`;
    mesh.userData.portalVisual = true; mesh.userData.route = route;
    mesh.raycast = () => {}; mesh.castShadow = false; mesh.receiveShadow = false;
    root.add(mesh);
  }

  function build(spot) {
    if (disposed) throw new Error('폐기한 입구 라이브러리는 다시 사용할 수 없습니다.');
    const visualRoute = EXTRA_GATE_DESIGNS[spot.route] || spot.route;
    const design = CITADEL_GATE_DESIGNS[visualRoute];
    if (!design) throw new Error(`입구 디자인이 없는 경로: ${spot.route}`);
    const root = new THREE.Group(); root.name = `Citadel_Gate_${design}`;
    const bins = new Map(), transform = new THREE.Object3D(), tint = new THREE.Color(), toneColor = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
    const rng = seededRandom(hashString(spot.route));
    const portalColor = CITADEL_GATE_PORTALS[spot.route] ?? EXTRA_GATE_PORTALS[spot.route];
    const tall = ARCH_ROUTES.has(visualRoute), mossAmount = low ? 0 : (MOSS_AMOUNT[visualRoute] ?? 0);
    const runeParts = [];

    /** 돌마다 밝기·채도·색상을 조금씩 달리한다(텍스처 없이 정점 색으로). */
    function tone(hex, amount = .06) {
      toneColor.setHex(hex); toneColor.getHSL(hsl);
      const l = hsl.l * (1 + (rng() - .5) * 2 * amount), s = hsl.s * (1 + (rng() - .5) * amount * 2), h = hsl.h + (rng() - .5) * amount * .12;
      toneColor.setHSL((h + 1) % 1, Math.min(1, s), Math.min(1, l)); return toneColor.getHex();
    }
    function mul(hex, k) { toneColor.setHex(hex); toneColor.multiplyScalar(k); return toneColor.getHex(); }
    /**
     * shade: 숫자면 조각 아래쪽이 어두워지는 세로 그림자 세기, 함수면 (x, y, z) 로 계산한 밝기 배율.
     * 조각 사이 이음매가 보이게 하는 값이다.
     */
    function add(source, role, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shade = 0) {
      // Box/Circle과 비색인 Icosahedron을 혼합해도 같은 속성 계약으로 병합한다.
      const geometry = source.index ? source.toNonIndexed() : source;
      if (geometry !== source) source.dispose();
      geometry.deleteAttribute('uv');
      transform.position.set(x, y, z); transform.rotation.set(rx, ry, rz); transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      const position = geometry.getAttribute('position'), count = position.count, colors = new Float32Array(count * 3);
      let minY = Infinity, maxY = -Infinity;
      if (typeof shade === 'number' && shade) {
        for (let i = 0; i < count; i++) { const v = position.getY(i); if (v < minY) minY = v; if (v > maxY) maxY = v; }
      }
      const span = Math.max(maxY - minY, 1e-5);
      tint.setHex(color);
      for (let i = 0; i < count; i++) {
        let k = 1;
        if (typeof shade === 'function') k = shade(position.getX(i), position.getY(i), position.getZ(i));
        else if (shade) k = 1 - shade * Math.pow(1 - (position.getY(i) - minY) / span, 1.4);
        colors[i * 3] = tint.r * k; colors[i * 3 + 1] = tint.g * k; colors[i * 3 + 2] = tint.b * k;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      if (!bins.has(role)) bins.set(role, []); bins.get(role).push(geometry);
    }
    function block(w, h, d, role, color, x, y, z = 0, rz = 0) {
      const bevel = Math.min(.035, w * .09, h * .09, d * .09);
      const shape = new THREE.Shape(), a = w / 2 - bevel, b = h / 2 - bevel;
      shape.moveTo(-a, -b); shape.lineTo(a, -b); shape.lineTo(a, b); shape.lineTo(-a, b); shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * bevel, steps: 1,
        bevelEnabled: true, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel });
      geometry.translate(0, 0, -(d - 2 * bevel) / 2);
      // 돌·금속 판은 아래가 조금 어둡고 조각마다 색이 약간 다르다. 발광 면은 그대로 둔다.
      add(geometry, role, role === 'glow' ? color : tone(color, .045), x, y, z, 0, 0, rz, role === 'glow' ? 0 : .24);
    }
    function beam(a, b, width, depth, role, color, z = 0) {
      block(Math.hypot(b[0] - a[0], b[1] - a[1]), width, depth, role, color,
        (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
    function cylinder(r, h, role, color, x, y, z = 0, top = r) {
      add(new THREE.CylinderGeometry(top, r, h, segments), role, role === 'glow' ? color : tone(color, .04), x, y, z, 0, 0, 0, role === 'glow' ? 0 : .2);
    }
    function ring(r, tube, role, color, x, y, z = 0, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2) {
      add(new THREE.TorusGeometry(r, tube, 4, segments * 2, arc), role, color, x, y, z, rx, ry, rz);
    }
    function crystal(x, y, z, height, radius, color = COLORS.ice, rz = 0) {
      const shape = new THREE.LatheGeometry([new THREE.Vector2(0, -height / 2),
        new THREE.Vector2(radius * .7, -height * .2), new THREE.Vector2(radius, height * .13),
        new THREE.Vector2(0, height / 2)], 5);
      add(shape, 'crystal', color, x, y, z, 0, .3, rz);
    }
    function leaf(x, y, z, width, height, angle, color) {
      const shape = new THREE.Shape(); shape.moveTo(0, -height / 2);
      shape.lineTo(width / 2, height * .06); shape.lineTo(width * .24, height * .34);
      shape.lineTo(0, height / 2); shape.lineTo(-width * .24, height * .34);
      shape.lineTo(-width / 2, height * .06); shape.closePath();
      add(new THREE.ExtrudeGeometry(shape, { depth: .065, bevelEnabled: true,
        bevelThickness: .02, bevelSize: .025, bevelSegments: 1, steps: 1 }), 'metal', color, x, y, z, 0, 0, angle);
      const dx = -Math.sin(angle), dy = Math.cos(angle);
      beam([x - dx * height * .43, y - dy * height * .43],
        [x + dx * height * .39, y + dy * height * .39], .025, .035, 'metal', COLORS.gold, z + .085);
    }

    // ---- 석조 공통 빌더: 굵은 기둥, 큼직한 쐐기돌 아치, 상인방, 포털 색 룬, 이끼·덩굴 ----
    /** 네 모서리를 깎은 팔각형 단면. 꼭짓점이 충돌 원(반지름 .5) 안에 들어가도록 깎는 크기를 정한다. */
    function octagon(hx, hz, c) {
      const shape = new THREE.Shape();
      shape.moveTo(hx, -hz + c); shape.lineTo(hx, hz - c); shape.lineTo(hx - c, hz); shape.lineTo(-hx + c, hz);
      shape.lineTo(-hx, hz - c); shape.lineTo(-hx, -hz + c); shape.lineTo(-hx + c, -hz); shape.lineTo(hx - c, -hz);
      shape.closePath(); return shape;
    }
    /** 아래에서 위로 쌓는 깎은 돌 덩이. y0 이 바닥이다. */
    function slab(hx, hz, c, h, role, color, x, y0, z = 0, ao = .34, ry = 0) {
      const geometry = new THREE.ExtrudeGeometry(octagon(hx, hz, c), { depth: h, steps: 1, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      add(geometry, role, role === 'glow' ? color : tone(color, .08), x, y0, z, 0, ry, 0, ao);
    }
    /** 앞(+z) 또는 뒤(-z) 평면 위의 가는 선 면. 균열·룬에 쓴다. */
    function lineGeometry(ax, ay, bx, by, width, z, sign = 1) {
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len * width / 2, ny = dx / len * width / 2;
      const p = [[ax + nx, ay + ny], [ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny]];
      const order = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2], positions = [], normals = [];
      for (const i of order) { positions.push(p[i][0], p[i][1], z); normals.push(0, 0, sign); }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      return geometry;
    }
    /** 포털 색으로 빛나는 룬 선. 포털이 없는 관문(캠페인)은 금박 선으로 대신한다. */
    function rune(ax, ay, bx, by, width, z, bothSides = true, shade = 1) {
      for (const sign of bothSides ? [1, -1] : [1]) {
        const geometry = lineGeometry(ax, ay, bx, by, width, z * sign, sign);
        if (portalColor !== undefined) {
          const n = geometry.getAttribute('position').count;
          geometry.setAttribute('shade', new THREE.BufferAttribute(new Float32Array(n).fill(shade), 1));
          runeParts.push(geometry);
        } else add(geometry, 'metal', COLORS.gold, 0, 0, 0);
      }
    }
    /** 얕은 균열: 아래로 갈라지는 세 토막의 어두운 선. */
    function crack(px, offset, y, z, length) {
      let cx = px + offset, cy = y;
      for (let i = 0; i < 3; i++) {
        const nx = Math.min(px + .16, Math.max(px - .16, cx + (rng() - .5) * length * .5)), ny = cy - length / 3;
        add(lineGeometry(cx, cy, nx, ny, .016, z), 'stone', 0x1d262b); cx = nx; cy = ny;
      }
    }
    /** 이끼·그을음 같은 불규칙한 얼룩 면. */
    function blob(cx, cy, z, w, h, role, color) {
      const points = [], count = 6, positions = [], normals = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * .4, radius = .62 + rng() * .5;
        points.push([cx + Math.cos(a) * w / 2 * radius, cy + Math.sin(a) * h / 2 * radius]);
      }
      for (let i = 0; i < count; i++) {
        const next = points[(i + 1) % count];
        positions.push(cx, cy, z, points[i][0], points[i][1], z, next[0], next[1], z); normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      add(geometry, role, color);
    }
    /** 기둥 앞면 위 얼룩: 가운데 x 와 폭을 충돌 원(반지름 .5) 안으로 맞춘다. */
    function pillarBlob(px, offset, cy, z, w, h, role, color) {
      const reach = Math.max(0, Math.min(.33, Math.sqrt(Math.max(0, .5 * .5 - z * z))) - w * .56), cx = px + Math.max(-reach, Math.min(reach, offset));
      blob(cx, Math.max(cy, h * .6 + .01), z, w, h, role, color);
    }
    function mossColor() { return MOSS_COLORS[Math.floor(rng() * MOSS_COLORS.length)]; }
    /** 앞 평면 위 마름모 잎(삼각형 2개). angle 은 잎 끝이 향하는 기울기다. */
    function leafQuad(cx, cy, w, h, angle, z, color) {
      const c = Math.cos(angle), s = Math.sin(angle);
      const at = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
      const p = [at(0, h / 2), at(w / 2, 0), at(0, -h / 2), at(-w / 2, 0)], positions = [], normals = [];
      for (const i of [0, 2, 1, 0, 3, 2]) { positions.push(p[i][0], p[i][1], z); normals.push(0, 0, 1); }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      add(geometry, 'stone', color);
    }
    /**
     * 늘어진 덩굴: 아래로 갈수록 가늘어지는 리본(구간마다 삼각형 2개)과 홀수 마디마다 달린 큰 잎.
     * center±limit 안에서만 흔들려 기둥 충돌 원을 벗어나지 않는다.
     */
    function strand(sx, sy, length, z, { width = .07, center = sx, limit = .28, leaves = true } = {}) {
      const count = Math.max(3, Math.round(length / .22)) + 1, step = length / (count - 1), points = [[sx, sy]];
      let px = sx;
      for (let i = 1; i < count; i++) { px = Math.min(center + limit, Math.max(center - limit, px + (rng() - .5) * .12)); points.push([px, sy - step * i]); }
      for (let i = 0; i < count - 1; i++) {
        const taper = 1 - .55 * i / (count - 1);
        add(lineGeometry(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], width * taper, z), 'stone', 0x3a6326);
      }
      if (!leaves) return;
      for (let i = 1; i < count; i++) {
        const dir = i % 2 ? 1 : -1, taper = 1 - .35 * i / (count - 1);
        // 잎은 기울어 옆으로 튀어나오므로 중심을 더 안쪽(±.2)에 둬 충돌 원(반지름 .5) 안에 둔다.
        const lx = Math.min(center + .2, Math.max(center - .2, points[i][0] + dir * .09 * taper));
        leafQuad(lx, points[i][1] - .02, .19 * taper, .29 * taper, -dir * (.5 + rng() * .4), z + .004, mossColor());
      }
    }
    /** 돌 윗면에 얹힌 납작한 초록 이끼 덩어리. rz 는 얹힌 면의 기울기다. */
    function clump(x, y, z, r, rz = 0) {
      // 아래 꼭짓점이 얹힌 면 위에 오도록 반높이(.55 r)만큼 띄운다.
      add(new THREE.OctahedronGeometry(r, 0).scale(1.55, .55, 1.2), 'stone', mossColor(), x, y + r * .55, z, 0, 0, rz);
    }
    /** 마름모 보석 판: 금빛 틀 위에 포털 색 보석 면을 박는다. 포털이 없는 관문은 금 결정으로 대신한다. */
    function gemPlate(cx, cy, z, hw, hh) {
      const plate = new THREE.Shape();
      plate.moveTo(0, hh * 1.25); plate.lineTo(hw * 1.35, 0); plate.lineTo(0, -hh * 1.25); plate.lineTo(-hw * 1.35, 0); plate.closePath();
      add(new THREE.ExtrudeGeometry(plate, { depth: .05, bevelEnabled: false }), 'metal', COLORS.gold, cx, cy, z);
      const zf = z + .06;
      if (portalColor !== undefined) {
        const T = [cx, cy + hh, zf], B = [cx, cy - hh, zf], L = [cx - hw, cy, zf], R = [cx + hw, cy, zf], F = [cx, cy, zf + .07];
        const faces = [[T, L, F, 1], [T, F, R, .82], [B, F, L, .62], [B, R, F, .48]], positions = [], normals = [], shade = [];
        for (const [a, b, c, k] of faces) { positions.push(...a, ...b, ...c); normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1); shade.push(k, k, k); }
        const gem = new THREE.BufferGeometry();
        gem.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        gem.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        gem.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
        runeParts.push(gem);
      } else crystal(cx, cy, zf + .04, hh * 2, hw, COLORS.gold);
    }

    /**
     * 기둥 하나: 계단식 받침 3단(맨 아래 폭 .92) → 엇갈린 크기의 깎은 돌 4단(단 사이 어두운 줄눈) → 기둥보다 넓은 기둥머리 2단.
     * 모든 꼭짓점이 기둥 충돌 원(반지름 .5) 안에 든다. round 는 원통 기둥, bands 는 금속 띠와 리벳,
     * plate 는 리벳 금속판, runes 는 포털 색 세로 룬이다.
     */
    function pillar(x, color, role, o) {
      if (role === 'metal') color = mul(color, 1.9);
      const side = x < 0 ? -1 : 1, faces = [], courses = [], moss = role === 'stone' && !low ? mossAmount : 0;
      let y = 0;
      for (const [hx, hz, c, h, k] of [[.46, .31, .14, .15, .8], [.42, .29, .13, .13, .9], [.385, .275, .12, .12, .97]]) {
        slab(hx, hz, c, h, role, mul(color, k), x, y, 0, .42); faces.push({ y0: y, y1: y + h, face: hz }); y += h;
      }
      const base = y, heights = [.45, .37, .46, .37];
      // 줄눈: 돌 단 안쪽의 어두운 심이 단 사이 틈으로 비친다.
      slab(.3, .2, .08, 2.05 - base, role, mul(color, .26), x, base, 0, 0);
      heights.forEach((h, i) => {
        const gap = .018;
        if (o.round) {
          const r = i % 2 ? .335 : .36;
          cylinder(r, h - gap, role, mul(color, i % 2 ? .94 : 1.03), x, y + h / 2); courses.push({ y0: y, y1: y + h, face: r });
        } else {
          const hx = (i % 2 ? .345 : .375) + (rng() - .5) * .008, hz = .255 + (rng() - .5) * .008;
          slab(hx, hz, .1, h - gap, role, mul(color, i % 2 ? .93 : 1.03), x + (rng() - .5) * .008, y + gap / 2, 0, .4); courses.push({ y0: y, y1: y + h, face: hz });
        }
        y += h;
      });
      // 기둥머리: 기둥보다 넓은 두 단. 위 단의 꼭대기(2.352)에 아치가 얹힌다.
      slab(.41, .28, .12, .15, role, mul(color, .97), x, y, 0, .3); y += .15;
      slab(.44, .3, .13, ARCH_CENTER - y, role, mul(color, 1.06), x, y, 0, .3);
      const front = o.round ? .375 : Math.max(...courses.map(course => course.face)) + .02;
      if (o.bands) {
        for (const seam of [base + heights[0], base + heights[0] + heights[1] + heights[2]]) {
          slab(.4, .285, .12, .075, 'metal', o.bands, x, seam - .0375, 0, .3);
          if (!low) for (const dx of [-.18, .18]) add(new THREE.ConeGeometry(.028, .04, 4), 'metal', COLORS.gold, x + dx, seam, .285 + .012, Math.PI / 2);
        }
      }
      if (o.plate) {
        // 리벳 금속판: 기둥 앞면 가운데에 붙인 두꺼운 판과 네 귀퉁이 리벳.
        const py = o.plateY ?? 1.75, pz = o.round ? .36 : .255;
        block(.5, .52, .06, 'metal', o.plate, x, py, pz + .02);
        if (!low) for (const dx of [-.19, .19]) for (const dy of [-.2, .2]) add(new THREE.ConeGeometry(.03, .045, 4), 'metal', COLORS.gold, x + dx, py + dy, pz + .075, Math.PI / 2);
      }
      if (o.runes) {
        // 세로 룬 문양: 마름모 + 세로선. 높이 .56, 포털 색.
        const top = 1.56, s = .115;
        for (const [ax, ay, bx, by] of [[0, top, -s, top - s], [-s, top - s, 0, top - 2 * s], [0, top - 2 * s, s, top - s], [s, top - s, 0, top]]) rune(x + ax, ay, x + bx, by, .04, front);
        rune(x, top - 2 * s, x, 1.0, .04, front);
        for (const dx of [-.11, .11]) rune(x + dx, top - 2 * s - .02, x + dx, 1.0, .03, front);
        rune(x - .09, 1.16, x + .09, 1.16, .03, front);
      }
      if (moss > 0) {
        // 이끼는 받침과 맨 아래 단에 몰리고, 균열은 가운데 단에 한 줄 간다.
        for (const face of [...faces, courses[0]]) {
          if (rng() < Math.min(1, moss * .95)) pillarBlob(x, (rng() - .5) * .12, face.y0 + .06 + rng() * .08, face.face + .011, .2 + rng() * .1, .09 + rng() * .08, 'stone', mossColor());
        }
        { const course = courses[1 + Math.floor(rng() * 2)]; crack(x, rng() < .5 ? -.15 : .15, course.y1 - .06 - rng() * .08, course.face + .011, .26 + rng() * .1); }
        // 기둥머리 바깥쪽 윗면에 얹힌 이끼 덩어리와 앞면에서 아래로 늘어진 덩굴.
        const outward = side * (.28 + rng() * .08);
        clump(x + outward, ARCH_CENTER + .005, (rng() - .5) * .16, .19 + rng() * .05, -side * .08);
        clump(x + outward * .55, ARCH_CENTER + .005, .1 + rng() * .05, .14 + rng() * .04, 0);
        // 아치 아랫돌 앞에서 기둥 앞면으로 길게 늘어진 덩굴(이끼가 많은 루트는 두 줄)과, 기둥 앞면 중간쯤 짧은 한 줄.
        const longCount = moss >= .7 ? 2 : 1;
        for (let v = 0; v < longCount; v++) {
          strand(x - side * (.1 + v * .17), 2.72 - v * .12, 1.15 + rng() * .45, .345, { width: .085, center: x, limit: .28 });
        }
        if (moss >= .5) strand(x + side * .13, 2.1, .55 + rng() * .25, .27, { width: .06, center: x, limit: .28, leaves: false });
      }
    }
    /**
     * 큼직한 쐐기돌 아치: 돌 하나가 반지름 방향 .45, 앞뒤 .6 이고 돌마다 높이가 달라 바깥 윤곽이 울퉁불퉁하다.
     * 돌 사이에는 어두운 뒷받침이 비치는 틈이 있고, 가운데 이맛돌은 앞으로 .12 더 튀어나와 마름모 보석 판을 단다.
     * 안쪽 둘레(반지름 ARCH_INNER)는 포털 윤곽과 맞닿는다.
     */
    function voussoirArch(color, role = 'stone', o = {}) {
      const cy = ARCH_CENTER, I = ARCH_INNER, thick = o.thick ?? .45, half = .3, perSide = low ? 3 : 4, bevel = o.bevel ?? !low;
      // 어두운 뒷받침 반원: 돌 사이 틈과 돌 아래쪽에 비친다.
      const backing = new THREE.Shape();
      backing.moveTo(I, 0); backing.lineTo(I + thick * .85, 0); backing.absarc(0, 0, I + thick * .85, 0, Math.PI, false);
      backing.lineTo(-I, 0); backing.absarc(0, 0, I, Math.PI, 0, true);
      add(new THREE.ExtrudeGeometry(backing, { depth: .34, curveSegments: low ? 3 : 5, bevelEnabled: false }), role, mul(color, .22), 0, cy, -.17, 0, 0, 0);
      for (const side of [1, -1]) {
        const weights = Array.from({ length: perSide }, () => .72 + rng() * .56), sum = weights.reduce((a, b) => a + b, 0);
        let angle = 0; const span = Math.PI / 2 - half;
        weights.forEach((weight, index) => {
          const t0 = angle, t1 = angle + span * weight / sum; angle = t1;
          // 풍화: 돌마다 바깥 두 모서리의 높이가 서로 다르고(이웃 돌과 계단처럼 어긋남), 지붕점이 뾰족하거나 한쪽 모서리가 떨어져 나간다.
          const gap = bevel ? .045 : .03, rough = o.rough ?? .16, mid = (t0 + t1) / 2;
          const outerA = I + thick + (rng() - .5) * rough, outerB = I + thick + (rng() - .5) * rough, outer = (outerA + outerB) / 2;
          const depth = .6 + (index % 2 ? -.05 : .04) + (rng() - .5) * .02, offset = (rng() - .5) * .012;
          const map = (r, t) => [side * r * Math.cos(t), r * Math.sin(t)];
          const polygon = [map(I, t0 + gap), map(I, t1 - gap), map(outerB, t1 - gap)];
          // 떨어져 나간 모서리: 바깥 모서리 바로 안쪽으로 파인 꼭짓점 하나(삼각형 4개).
          if (!low && rng() < .45) polygon.push(map(outerB - .07 - rng() * .05, t1 - gap - (t1 - t0) * (.16 + rng() * .1)));
          polygon.push(map(Math.max(outerA, outerB) + .02 + rng() * .06, mid + (rng() - .5) * .12 * (t1 - t0)), map(outerA, t0 + gap));
          const shape = new THREE.Shape(); polygon.forEach(([px, py], i) => i ? shape.lineTo(px, py) : shape.moveTo(px, py)); shape.closePath();
          const geometry = new THREE.ExtrudeGeometry(shape, bevel
            ? { depth: depth - .04, steps: 1, bevelEnabled: true, bevelThickness: .02, bevelSize: .012, bevelSegments: 1 }
            : { depth, steps: 1, bevelEnabled: false });
          geometry.translate(0, 0, -(bevel ? depth - .04 : depth) / 2 + offset);
          // 안쪽(포털 쪽)이 어둡고 바깥이 밝아 두께가 읽히고, 돌마다 밝기가 조금씩 다르다.
          add(geometry, role, tone(mul(color, index % 2 ? .9 : 1.04), .09), 0, cy, 0, 0, 0, 0, (x, y) => .66 + .34 * Math.min(1, Math.max(0, (Math.hypot(x, y - cy) - I) / thick)));
          const face = depth / 2 + offset + .012, dirX = side * Math.cos(mid), dirY = Math.sin(mid), perpX = -dirY, perpY = dirX;
          const mx = side * (I + thick / 2) * Math.cos(mid), my = cy + (I + thick / 2) * Math.sin(mid), kind = index % 3;
          if (o.runes !== false) {
            // 돌마다 다른 룬: 방사선, 마름모, 두 줄.
            const at = (u, v) => [mx + (u * perpX + v * dirX), my + (u * perpY + v * dirY)];
            const seg = (u1, v1, u2, v2, w) => { const [ax, ay] = at(u1, v1), [bx, by] = at(u2, v2); rune(ax, ay, bx, by, w, face); };
            if (kind === 0) seg(0, -.15, 0, .15, .045);
            else if (kind === 1) for (const [p, q] of [[[.1, 0], [0, .1]], [[0, .1], [-.1, 0]], [[-.1, 0], [0, -.1]], [[0, -.1], [.1, 0]]]) seg(p[0], p[1], q[0], q[1], .035);
            else for (const k of [-.07, .07]) seg(k, -.14, k, .14, .035);
          }
          if (!low && role === 'stone' && mossAmount > 0 && rng() < Math.min(1, mossAmount * 1.6)) {
            // 바깥 둘레 윗면에 얹힌 이끼 덩어리.
            clump(side * (outer + .02) * Math.cos(mid), cy + (outer + .02) * Math.sin(mid), offset + (rng() - .5) * .12, .2 + rng() * .08, side > 0 ? mid - Math.PI / 2 : Math.PI / 2 - mid);
          }
        });
      }
      // 가운데 이맛돌: 아래로 뾰족하게 내려오고 위로 솟으며 앞으로 .12 더 튀어나온다.
      const key = [[0, I - .22], [.31, I], [.45, I + .36], [.4, I + .56], [.18, I + .7], [0, I + .74]];
      const shape = new THREE.Shape(); [...key, ...key.slice(1, -1).reverse().map(([px, py]) => [-px, py])].forEach(([px, py], i) => i ? shape.lineTo(px, py) : shape.moveTo(px, py)); shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: .83, steps: 1, bevelEnabled: true, bevelThickness: .035, bevelSize: .03, bevelSegments: 1 });
      geometry.translate(0, 0, -.415);
      add(geometry, role, tone(mul(color, 1.1), .05), 0, cy, 0, 0, 0, 0, (x, y) => .8 + .2 * Math.min(1, Math.max(0, (y - cy - I + .2) / .9)));
      if (o.gem !== false) gemPlate(0, cy + I + .4, .45, .17, .27);
      // 이맛돌 윗면을 덮는 큰 이끼 덮개.
      if (!low && role === 'stone' && mossAmount >= .4) clump(.03, cy + I + .74, -.02, .3 + rng() * .06, (rng() - .5) * .1);
    }
    /**
     * 상인방: 두꺼운 좌우 블록 사이에 가운데 이맛돌 블록이 .12 앞으로 나온다. 블록 사이 틈에는 어두운 심이 비친다.
     */
    function lintel(color, role, o = {}) {
      const bottom = ARCH_CENTER, h = o.h ?? .5, kh = o.keyH ?? .76;
      block(3.9, h - .08, .4, role, mul(color, .26), 0, bottom + h / 2, 0);
      for (const side of [-1, 1]) {
        block(1.44, h, .6, role, mul(color, side < 0 ? 1.02 : .96), side * 1.2, bottom + h / 2, 0);
        if (!low && o.studs !== false) for (const dx of [.78, 1.12, 1.46, 1.8]) add(new THREE.ConeGeometry(.028, .045, 4), 'metal', COLORS.gold, side * dx, bottom + .1, .3 + .015, Math.PI / 2);
      }
      block(.9, kh, .84, role, mul(color, 1.12), 0, bottom + kh / 2, 0);
      if (o.gem !== false) gemPlate(0, bottom + kh / 2, .42, .15, .22);
    }
    function posts(color, role = 'stone', options = false) {
      const o = typeof options === 'object' ? options : { round: options };
      const settings = { round: !!o.round, runes: o.runes ?? role !== 'metal', bands: o.bands ?? null, plate: o.plate === true ? COLORS.bronze : (o.plate || null), plateY: o.plateY };
      for (const side of [-1, 1]) pillar(side * P, color, role, settings);
    }
    function vent(x, color = COLORS.ember) {
      block(.3, .6, .04, 'glow', color, x, 1.0, .275);
      for (const offset of [-.1, 0, .1]) block(.03, .64, .035, 'metal', COLORS.iron, x + offset, 1.0, .305);
    }
    function wheel(x, y, radius, color = COLORS.bronze, z = .22) {
      ring(radius, .04, 'metal', color, x, y, z);
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        beam([x, y], [x + Math.cos(angle) * radius * .91, y + Math.sin(angle) * radius * .91],
          .045, .07, 'metal', color, z);
      }
      add(new THREE.SphereGeometry(.07, 6, 4), 'metal', COLORS.gold, x, y, z + .03);
    }

    switch (visualRoute) {
      case 'glass_garden': {
        posts(COLORS.glass, 'crystal', { bands: COLORS.bronze }); voussoirArch(COLORS.bronze, 'metal', { bevel: false });
        // 온실 지붕은 둥근 아치 뒤로 솟은 불투명 유리 면과 실제 격자다.
        const roof = new THREE.Shape(); roof.moveTo(-2.1, 2.4); roof.lineTo(0, 4.75); roof.lineTo(2.1, 2.4); roof.closePath();
        add(new THREE.ExtrudeGeometry(roof, { depth: .08, bevelEnabled: false }), 'crystal', COLORS.glass, 0, 0, -.24);
        for (const side of [-1, 1]) {
          beam([0, 4.74], [side * 2.1, 2.41], .08, .1, 'metal', COLORS.bronze, -.16);
          beam([side * .8, 3.9], [side * 1.7, 2.41], .05, .08, 'metal', COLORS.gold, -.16);
          crystal(side * 1.76, 2.8, 0, .56, .13, COLORS.cyan);
        }
        break;
      }
      case 'ember_vault': {
        posts(COLORS.iron, 'metal', { plate: true }); lintel(COLORS.iron, 'metal');
        beam([-1.75, 2.9], [-.95, 3.6], .28, .5, 'metal', COLORS.dark);
        beam([-.95, 3.6], [.95, 3.6], .28, .5, 'metal', COLORS.iron);
        beam([.95, 3.6], [1.75, 2.9], .28, .5, 'metal', COLORS.dark);
        wheel(0, 3.6, .46, COLORS.bronze, .46);
        for (const side of [-1, 1]) {
          vent(side * P); block(.34, .26, .03, 'glow', COLORS.ember, side * P, 2.6, .32);
          cylinder(.17, .34, 'metal', COLORS.bronze, side * P, 3.03);
        }
        break;
      }
      case 'star_archive': {
        posts(COLORS.ivory, 'stone', { bands: COLORS.sapphire });
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) block(.58 - i * .1, .15, .48, 'stone', i % 2 ? COLORS.sapphire : COLORS.ivory, side * 1.74, 2.43 + i * .16);
          crystal(side * 1.74, 3.1, 0, .64, .12);
          crystal(side * 1.96, 2.85, 0, .36, .07);
        }
        voussoirArch(COLORS.ivory, 'stone');
        break;
      }
      case 'bellfall_crypt': {
        posts(COLORS.moss); voussoirArch(COLORS.stone, 'stone');
        for (const side of [-1, 1]) {
          cylinder(.25, side < 0 ? .7 : .85, 'stone', COLORS.stone, side * 1.74, side < 0 ? 2.72 : 2.8, 0, .15);
          add(new THREE.ConeGeometry(.27, .36, 5), 'stone', COLORS.moss, side * 1.74, side < 0 ? 3.25 : 3.4);
        }
        beam([0, 3.3], [0, 3.1], .055, .06, 'metal', COLORS.bronze, .3);
        cylinder(.3, .43, 'metal', COLORS.bronze, 0, 2.9, .3, .14);
        ring(.29, .035, 'metal', COLORS.gold, 0, 2.7, .3, Math.PI / 2);
        add(new THREE.SphereGeometry(.075, 6, 4), 'metal', COLORS.gold, 0, 2.55, .3);
        break;
      }
      case 'cinder_tide_lock': {
        posts(COLORS.iron, 'metal', { round: true }); lintel(COLORS.iron, 'metal');
        for (const side of [-1, 1]) {
          cylinder(.09, 1.95, 'metal', COLORS.copper, side * P, 1.2, .33);
          block(.07, 1.5, .025, 'glow', COLORS.cyan, side * (P - .27), 1.3, .3);
          wheel(side * P, .98, .15, COLORS.copper, .34);
        }
        beam([-1.6, 3.08], [1.6, 3.08], .24, .3, 'metal', COLORS.copper);
        block(3.2, .055, .07, 'glow', COLORS.cyan, 0, 3.09, .17);
        wheel(0, 3.55, .42, COLORS.copper, .3);
        block(1.1, .085, .22, 'metal', COLORS.iron, 0, 4.05);
        break;
      }
      case 'nightglass_observatory': {
        posts(COLORS.sapphire); voussoirArch(COLORS.sapphire, 'stone', { gem: false });
        for (const side of [-1, 1]) crystal(side * 1.74, 2.95, 0, .5, .1);
        ring(.34, .03, 'metal', COLORS.gold, 0, 3.92, .55);
        ring(.34, .026, 'metal', COLORS.bronze, 0, 3.92, .55, .45, .8);
        ring(.34, .026, 'metal', COLORS.gold, 0, 3.92, .55, 1.12, -.65);
        add(new THREE.IcosahedronGeometry(.19, 1), 'crystal', COLORS.ice, 0, 3.92, .55);
        add(new THREE.CylinderGeometry(.125, .09, .61, segments), 'metal', COLORS.bronze, 1.2, 3.72, 0, 0, 0, -1.05);
        ring(.1, .027, 'crystal', COLORS.sapphire, 1.55, 3.45, .06, .2, .6);
        break;
      }
      case 'eclipse_hydra_vault': {
        posts(COLORS.obsidian, 'stone', { round: true, bands: COLORS.bronze }); voussoirArch(COLORS.obsidian, 'stone');
        for (const side of [-1, 1]) {
          for (let i = 0; i < 4; i++) {
            const a = .22 + i * .3, ca = Math.cos(a) * side, sa = Math.sin(a);
            beam([ca * (ARCH_INNER + .08), ARCH_CENTER + sa * (ARCH_INNER + .08)], [ca * (ARCH_INNER - .12), ARCH_CENTER + sa * (ARCH_INNER - .12)], .12, .2, 'stone', COLORS.bone, .12);
          }
          crystal(side * 1.76, 2.95, -.03, .8, .19, COLORS.obsidian, side * .4);
        }
        for (const [x, y, angle, scale] of [[-1.38, 3.55, .7, 1], [0, 4.5, 0, .85], [1.38, 3.55, -.7, 1]]) {
          add(new THREE.IcosahedronGeometry(.3 * scale, 0).scale(1, .72, 1), 'stone', COLORS.obsidian, x, y, .06, 0, 0, angle);
          block(.36 * scale, .12, .22, 'stone', COLORS.dark, x, y - .14 * scale, .24, angle);
          for (const side of [-1, 1]) {
            add(new THREE.SphereGeometry(.05, 6, 4), 'glow', COLORS.cyan, x + side * .12 * scale, y + .03, .3);
            crystal(x + side * .18 * scale, y + .27 * scale, 0, .36 * scale, .06, COLORS.obsidian, -side * .25);
          }
          crystal(x, y - .15 * scale, .32, .22, .05, COLORS.cyan, Math.PI);
        }
        break;
      }
      case 'ashforge_catacomb': {
        posts(COLORS.iron, 'metal', { plate: true }); lintel(COLORS.dark, 'metal');
        block(1.9, .28, .55, 'metal', COLORS.iron, 0, 3.2);
        for (const side of [-1, 1]) {
          beam([side * 1.0, 3.22], [side * 1.7, 3.42], .19, .4, 'metal', COLORS.iron);
          vent(side * P); cylinder(.2, side < 0 ? .7 : .52, 'metal', COLORS.dark, side * P, side < 0 ? 3.2 : 3.11);
          cylinder(.24, .085, 'metal', COLORS.bronze, side * P, side < 0 ? 3.58 : 3.4);
        }
        beam([-.15, 3.1], [.25, 3.92], .1, .18, 'metal', COLORS.bronze, .46);
        block(.65, .28, .23, 'metal', COLORS.gold, .26, 3.84, .46, -.35);
        break;
      }
      case 'astral_leviathan_spire': {
        posts(COLORS.bone, 'stone', { bands: COLORS.gold }); voussoirArch(COLORS.sapphire, 'crystal', { thick: .44, bevel: false });
        for (const side of [-1, 1]) {
          for (let i = 0; i < 2; i++) {
            beam([side * 1.85, 2.5 + i * .2], [side * (1.35 - i * .3), 3.5 + i * .3], .1, .19, 'stone', COLORS.bone, -.28);
          }
          beam([side * 1.78, 2.45], [side * 1.92, 3.85], .085, .21, 'stone', COLORS.ivory, -.18);
          crystal(side * 1.78, 3.05, .05, .55, .08);
        }
        break;
      }
      case 'verdigris_sanctum': {
        posts(COLORS.jade, 'stone', { round: true }); voussoirArch(COLORS.copper, 'metal', { thick: .42 });
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const a = .15 + i * .42, lx = side * 1.86 * Math.cos(a), ly = ARCH_CENTER + 1.86 * Math.sin(a);
            leaf(lx, ly, .0, .49, .66, -side * (.5 + i * .5), i % 2 ? COLORS.jade : COLORS.copper);
          }
          beam([side * (P - .1), .3], [side * (P - .2), 2.1], .055, .08, 'metal', COLORS.copper, .4);
          beam([side * (P + .1), .35], [side * (P + .05), 2.15], .045, .08, 'metal', COLORS.bronze, .34);
        }
        leaf(0, 4.4, 0, .49, .72, 0, COLORS.jade); crystal(0, 4.78, .12, .3, .08, COLORS.cyan);
        break;
      }
      case 'sable_mirage_basin': {
        posts(COLORS.sand); voussoirArch(COLORS.sand, 'stone', { gem: false, bevel: false });
        for (const side of [-1, 1]) {
          add(new THREE.ConeGeometry(.17, .55, 4), 'metal', COLORS.bronze, side * 1.74, 2.72);
        }
        ring(.38, .07, 'metal', COLORS.gold, 0, 3.92, .56, 0, 0, .67, Math.PI * 1.57);
        add(new THREE.IcosahedronGeometry(.25, 1).scale(1, 1, .45), 'crystal', COLORS.violet, 0, 3.92, .5);
        break;
      }
      case 'comet_bastion': {
        posts(COLORS.stone); lintel(COLORS.stone, 'stone');
        for (const side of [-1, 1]) {
          block(.8, .6, .62, 'stone', COLORS.stone, side * P, 3.15);
          for (const offset of [-.28, 0, .28]) block(.16, .24, .58, 'stone', COLORS.stone, side * P + offset, 3.6);
                  }
        crystal(0, 3.95, .1, 1.0, .32, COLORS.ice, -.18);
        break;
      }
      case 'campaign': {
        posts(COLORS.ivory); voussoirArch(COLORS.ivory, 'stone', { bevel: false });
        for (const side of [-1, 1]) {
          block(.4, .66, .05, 'stone', COLORS.sapphire, side * 1.78, 3.1, .07);
          beam([side * 1.78, 2.5], [side * 1.78, 3.5], .04, .08, 'metal', COLORS.gold, .03);
        }
        break;
      }
      case 'arena': {
        posts(COLORS.iron, 'metal', { plate: true }); lintel(COLORS.iron, 'metal');
        for (const side of [-1, 1]) {
          beam([side * .62, 3.1], [-side * .62, 4.0], .12, .1, 'metal', COLORS.ivory, .52);
          beam([side * .71, 3.12], [side * .43, 2.88], .06, .13, 'metal', COLORS.gold, .54);
          crystal(side * P, 3.2, 0, .55, .1, COLORS.gold);
        }
        ring(.37, .055, 'metal', COLORS.gold, 0, 3.55, .44);
        break;
      }
    }

    try {
      for (const [role, pieces] of bins) {
        const merged = mergeGeometries(pieces, false);
        if (!merged) throw new Error(`입구 geometry 병합 실패: ${spot.route}/${role}`);
        geometries.add(merged); merged.computeBoundingBox(); merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, material(role)); mesh.name = `Citadel_Gate_${role}`;
        mesh.castShadow = false; mesh.receiveShadow = role !== 'glow'; root.add(mesh);
      }
    } finally { for (const pieces of bins.values()) for (const piece of pieces) piece.dispose(); }
    addPortal(root, spot.route, tall, runeParts);
    root.userData = { designId: design, route: spot.route, reference: CITADEL_GATE_REFERENCE,
      portal: Object.hasOwn(CITADEL_GATE_PORTALS, spot.route) || Object.hasOwn(EXTRA_GATE_PORTALS, spot.route),
      batchCount: root.children.length, originalGeometry: true };
    groups.add(root); return root;
  }

  return {
    build,
    update(dt, reducedMotion = false) {
      if (disposed) return;
      // 한 장면의 공유 시간만 갱신한다. 감속 모션은 출렁임 없이 같은 정지 프레임을 보여준다.
      if (!reducedMotion && Number.isFinite(dt)) portalTime = (portalTime + Math.max(0, Math.min(dt, .05))) % 3600;
      const next = materials.get('portal');
      if (next) next.uniforms.portalTime.value = reducedMotion ? 0 : portalTime;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const unsubscribe of stoneUnsubscribers) unsubscribe();
      stoneUnsubscribers.length = 0;
      for (const group of groups) group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const next of materials.values()) next.dispose();
      groups.clear(); geometries.clear(); materials.clear();
    },
  };
}
