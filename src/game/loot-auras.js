// 필드 장비 드랍의 등급 연출: 바닥 링·글로우(착지 충격 링 포함)와 세로 빛기둥.
// 모든 드랍이 인스턴스 메시 두 장(바닥 1 · 기둥 1)을 나눠 쓴다. 드랍 수와 상관없이 드로우콜 2, 재질 · 형상 · 텍스처는 하나씩.
// 드랍별 값(색 · 세기 · 착지 진행 · 사라짐)은 인스턴스 속성에 쓰고, 프레임 갱신은 미리 만든 배열만 고친다(할당 없음).
// 기둥은 셰이더에서 세로축만 카메라를 보는 원통형 빌보드다. 코드로 만든 세로 그라디언트 텍스처(가운데 심 + 바깥 번짐)를 가산 혼합한다.
import * as THREE from 'three';
import { RARITY_COLOR } from '../data/items.js';

/**
 * 등급별 연출 값. ground: [반지름, 글로우, 링, 착지 충격, 룬 점선], beam: [높이, 폭, 세기] (null = 기둥 없음), gain = 색 배율(블룸 문턱 위로).
 * N 은 아주 약한 바닥 링만, S 부터 기둥이 생기고 E·U·L 로 갈수록 높고 넓고 밝다.
 */
export const LOOT_AURA = Object.freeze({
  // 2026-10-30 드랍 모델 축소에 맞춰 바닥 반지름 · 기둥 폭을 줄였다(높이 · 세기 = 등급 신호는 유지).
  N: { ground: [.48, .08, .14, .45, 0], beam: null, gain: 1 },
  S: { ground: [.58, .14, .42, .65, 0], beam: [1.7, .42, .42], gain: 1.15 },
  E: { ground: [.68, .2, .62, .85, .25], beam: [3.6, .6, .62], gain: 1.45 },
  U: { ground: [.8, .26, .8, 1, .6], beam: [5.2, .74, .78], gain: 1.85 },
  L: { ground: [.95, .32, 1, 1, 1], beam: [7.4, .9, .95], gain: 2.4 },
});
/** 저화질: 기둥 높이 · 세기를 줄인다(바닥 링은 그대로 둬 등급은 계속 읽힌다). */
export const LOOT_AURA_LITE = Object.freeze({ height: .68, intensity: .8 });
export const LOOT_AURA_CAPACITY = 96;
export const LOOT_IMPACT_TIME = .5;

/** 기둥 텍스처(32×128): R = 가운데 밝은 심, G = 바깥 번짐. 아래는 짧게 차오르고 위로 갈수록 사라진다. */
export function beamTexture() {
  const w = 32, h = 128, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = (y + .5) / h;
    const vertical = Math.min(1, v / .05) * Math.pow(1 - v, 1.25) * (1 + 1.1 * Math.exp(-v * 12)) / 2.1;
    for (let x = 0; x < w; x++) {
      const u = ((x + .5) / w) * 2 - 1, i = (y * w + x) * 4;
      const core = Math.exp(-((u / .13) ** 2)), halo = Math.exp(-((u / .42) ** 2)) * (1 - Math.abs(u) ** 4);
      data[i] = Math.round(255 * Math.min(1, core * vertical * 1.6));
      data[i + 1] = Math.round(255 * Math.min(1, halo * vertical * 1.35));
      data[i + 2] = 0; data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.generateMipmaps = false;
  texture.name = 'loot-beam-gradient'; texture.needsUpdate = true;
  return texture;
}

const GROUND_VERTEX = `
attribute vec3 aColor; attribute vec4 aGround; attribute vec2 aState;
varying vec2 vUv; varying vec3 vColor; varying vec4 vGround; varying vec2 vState; varying float vPhase;
void main() {
  vUv = uv; vColor = aColor; vGround = aGround; vState = aState;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vPhase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 1.3;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const GROUND_FRAGMENT = `
uniform float uTime;
varying vec2 vUv; varying vec3 vColor; varying vec4 vGround; varying vec2 vState; varying float vPhase;
void main() {
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  if (r > 1.0) discard;
  float pulse = 0.82 + 0.18 * sin(uTime * 3.2 + vPhase);
  // 안쪽 부드러운 글로우 + 얇은 링(+ 상위 등급은 천천히 도는 룬 점선)
  float glow = exp(-r * r * 9.0) * vGround.x;
  float ring = exp(-pow((r - 0.42) / 0.05, 2.0)) * vGround.y;
  float ang = atan(p.y, p.x);
  float dash = smoothstep(0.35, 0.5, abs(fract(ang * 1.909859 + uTime * 0.12) - 0.5) * 2.0);
  float rune = exp(-pow((r - 0.55) / 0.022, 2.0)) * dash * vGround.w;
  // 착지 충격 링: 진행값 k(0→1)에 따라 밖으로 퍼지며 사라진다.
  float k = vState.x, e = 1.0 - pow(1.0 - k, 3.0);
  float impact = k < 1.0 ? exp(-pow((r - mix(0.12, 0.96, e)) / (0.035 + 0.07 * e), 2.0)) * (1.0 - k) * vGround.z : 0.0;
  float settle = smoothstep(0.0, 0.35, k);
  float a = ((glow + ring + rune) * pulse * settle + impact * 1.4) * vState.y * smoothstep(1.0, 0.9, r);
  gl_FragColor = vec4(vColor * (1.0 + impact), clamp(a, 0.0, 1.0));
}`;
const BEAM_VERTEX = `
attribute vec3 aColor; attribute vec2 aBeam;
varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vPhase;
void main() {
  vUv = uv; vColor = aColor; vAlpha = aBeam.x * aBeam.y;
  mat4 m = modelMatrix * instanceMatrix;
  vec3 center = m[3].xyz;
  float width = length(m[0].xyz), height = length(m[1].xyz);
  vec3 toCamera = cameraPosition - center; toCamera.y = 0.0;
  vec3 right = normalize(vec3(toCamera.z, 0.0, -toCamera.x) + vec3(1e-4, 0.0, 0.0));
  vPhase = center.x * 1.7 + center.z * 1.3;
  vec3 world = center + right * position.x * width + vec3(0.0, position.y * height, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const BEAM_FRAGMENT = `
uniform sampler2D uMap; uniform float uTime;
varying vec2 vUv; varying vec3 vColor; varying float vAlpha; varying float vPhase;
void main() {
  vec4 t = texture2D(uMap, vUv);
  // 위로 흐르는 빛줄기와 느린 맥동. 심은 흰빛 쪽으로 밝게.
  float flow = 0.7 + 0.3 * sin(vUv.y * 17.0 - uTime * 4.6 + vPhase);
  float pulse = 0.84 + 0.16 * sin(uTime * 2.7 + vPhase * 0.7);
  float a = (t.r + t.g * 0.62 * flow) * pulse * vAlpha;
  vec3 color = mix(vColor, vec3(1.0) * max(vColor.r, max(vColor.g, vColor.b)), t.r * 0.45);
  gl_FragColor = vec4(color, clamp(a, 0.0, 1.0));
}`;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

/** 드랍들이 함께 쓰는 바닥 · 기둥 인스턴스 층. */
export class LootAuras {
  constructor({ capacity = LOOT_AURA_CAPACITY } = {}) {
    this.capacity = capacity; this.time = { value: 0 }; this.lite = false;
    this.free = []; for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    this.used = 0; this.top = 0; this.active = new Uint8Array(capacity);
    const ground = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.groundColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.groundParams = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.groundState = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    ground.setAttribute('aColor', this.groundColor); ground.setAttribute('aGround', this.groundParams); ground.setAttribute('aState', this.groundState);
    const beam = new THREE.PlaneGeometry(1, 1).translate(0, .5, 0);
    this.beamColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.beamParams = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    beam.setAttribute('aColor', this.beamColor); beam.setAttribute('aBeam', this.beamParams);
    this.texture = beamTexture();
    const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
    this.groundMaterial = new THREE.ShaderMaterial({ ...common, uniforms: { uTime: this.time }, vertexShader: GROUND_VERTEX, fragmentShader: GROUND_FRAGMENT });
    this.groundMaterial.polygonOffset = true; this.groundMaterial.polygonOffsetFactor = -2; this.groundMaterial.polygonOffsetUnits = -2;
    this.beamMaterial = new THREE.ShaderMaterial({ ...common, side: THREE.DoubleSide, uniforms: { uTime: this.time, uMap: { value: this.texture } }, vertexShader: BEAM_VERTEX, fragmentShader: BEAM_FRAGMENT });
    this.ground = new THREE.InstancedMesh(ground, this.groundMaterial, capacity); this.ground.name = 'loot-aura-ground';
    this.beam = new THREE.InstancedMesh(beam, this.beamMaterial, capacity); this.beam.name = 'loot-aura-beam';
    for (const mesh of [this.ground, this.beam]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.count = 0; mesh.visible = false;
    }
    this.ground.renderOrder = 7; this.beam.renderOrder = 9;
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) { this.ground.setMatrixAt(i, this._zero); this.beam.setMatrixAt(i, this._zero); }
  }
  /** 그릴 장면. 드랍이 하나라도 있을 때만 장면에 붙고, 모두 사라지면 떨어진다(빈 장면 · 로비에 드로우콜을 남기지 않는다). */
  attach(scene) { if (this.scene && this.scene !== scene) this.scene.remove(this.ground, this.beam); this.scene = scene; }
  setLite(lite) { this.lite = !!lite; }
  /** 슬롯 하나를 빌린다. 꽉 차면 -1(연출 없이 장비만 보인다). */
  acquire(rarity) {
    if (!this.free.length) return -1;
    const slot = /** @type {number} */ (this.free.pop()), spec = LOOT_AURA[rarity] || LOOT_AURA.N;
    this.active[slot] = 1; this.used++; this.top = Math.max(this.top, slot + 1);
    _c.set(RARITY_COLOR[rarity] || RARITY_COLOR.N).multiplyScalar(spec.gain);
    this.groundColor.setXYZ(slot, _c.r, _c.g, _c.b);
    this.groundParams.setXYZW(slot, spec.ground[1], spec.ground[2], spec.ground[3], spec.ground[4]);
    this.groundState.setXY(slot, 0, 0);
    this.beamColor.setXYZ(slot, _c.r, _c.g, _c.b);
    this.beamParams.setXY(slot, spec.beam ? spec.beam[2] * (this.lite ? LOOT_AURA_LITE.intensity : 1) : 0, 0);
    for (const a of [this.groundColor, this.groundParams, this.groundState, this.beamColor, this.beamParams]) a.needsUpdate = true;
    return slot;
  }
  /**
   * 슬롯 위치 · 상태를 갱신한다.
   * @param {number} slot @param {string} rarity @param {number} x @param {number} z
   * @param {number} impact 착지 충격 진행(0~1, 1 = 끝) @param {number} fade 전체 세기(0~1) @param {number} rise 기둥 솟음(0~1)
   */
  set(slot, rarity, x, z, impact, fade, rise) {
    if (slot < 0) return;
    const spec = LOOT_AURA[rarity] || LOOT_AURA.N, r = spec.ground[0] * 2;
    _m.compose(_p.set(x, .06, z), _q.identity(), _s.set(r, 1, r)); this.ground.setMatrixAt(slot, _m);
    this.groundState.setXY(slot, impact, fade);
    if (spec.beam) {
      const height = spec.beam[0] * (this.lite ? LOOT_AURA_LITE.height : 1) * rise;
      _m.compose(_p.set(x, 0, z), _q, _s.set(spec.beam[1], Math.max(1e-3, height), 1)); this.beam.setMatrixAt(slot, _m);
      this.beamParams.setY(slot, fade);
    }
  }
  release(slot) {
    if (slot < 0 || !this.active[slot]) return;
    this.active[slot] = 0; this.used--; this.free.push(slot);
    this.ground.setMatrixAt(slot, this._zero); this.beam.setMatrixAt(slot, this._zero);
    this.groundState.setXY(slot, 1, 0); this.beamParams.setXY(slot, 0, 0);
    while (this.top > 0 && !this.active[this.top - 1]) this.top--;
  }
  /** 프레임 끝에 한 번: 그릴 범위와 GPU 업로드 표시만 바꾼다. */
  update(dt) {
    this.time.value += dt;
    for (const mesh of [this.ground, this.beam]) { mesh.count = this.top; mesh.visible = this.used > 0; mesh.instanceMatrix.needsUpdate = true; }
    if (this.used > 0 && this.scene && this.ground.parent !== this.scene) this.scene.add(this.ground, this.beam);
    else if (this.used === 0 && this.ground.parent) this.ground.parent.remove(this.ground, this.beam);
    this.groundState.needsUpdate = true; this.beamParams.needsUpdate = true;
    this.groundColor.needsUpdate = true; this.beamColor.needsUpdate = true; this.groundParams.needsUpdate = true;
  }
  clear() { for (let i = 0; i < this.capacity; i++) this.release(i); this.update(0); }
  /** 출격 준비용: 같은 형상 · 재질 · 인스턴싱 정의를 쓰는 껍데기(그리기 1개). */
  preparation() {
    const ground = new THREE.InstancedMesh(this.ground.geometry, this.groundMaterial, 1), beam = new THREE.InstancedMesh(this.beam.geometry, this.beamMaterial, 1);
    for (const mesh of [ground, beam]) { mesh.frustumCulled = false; mesh.setMatrixAt(0, _m.identity()); }
    return [ground, beam];
  }
}
