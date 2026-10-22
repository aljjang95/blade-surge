import * as THREE from 'three';
import { FEEL, shardCount, waveParams } from '../game/feel.js';

// 전투 VFX 2종(처치 파편, 묶음 처치 충격파). 둘 다 InstancedMesh 한 장·드로우콜 한 번이고 궤적은 정점 셰이더가 해석식으로 푼다.
// CPU 는 낼 때(spawn)만 칸 하나를 쓰고, 프레임마다 하는 일은 시계(uTime) 갱신뿐이라 파편 수와 무관하게 할당·업로드가 없다.
// 시계는 FX.update(dt) 로 들어오는 sim dt 만 더한다(Date·setTimeout 없음) — 히트스톱에는 같이 멈추고 슬로우에는 같이 느려진다.

/** 전투 난수와 분리된 VFX 전용 스트림(mulberry32). 시드가 같으면 같은 모양이 나온다. */
export class VfxRng {
  constructor(seed = 0x5eed1234) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const NEVER = -1e9;
const _hsl = { h: 0, s: 0, l: 0 };
const WHITE = new THREE.Color(1, 1, 1);

/** 적 재질 색 평균에서 파편 팔레트(기본·밝은 쪽)를 만든다. 할당 없이 두 Color 를 채운다. */
export function enemyPalette(enemy, base, accent) {
  const S = FEEL.vfx.shards, mats = enemy?.mats;
  let r = 0, g = 0, b = 0, n = 0;
  if (mats) for (let i = 0; i < mats.length && n < 4; i++) { const c = mats[i]?.color; if (c) { r += c.r; g += c.g; b += c.b; n++; } }
  if (n) base.setRGB(r / n, g / n, b / n);
  else base.set(enemy?.isBoss ? 0xd05050 : enemy?.isElite ? 0xd8a838 : 0x9a94b0);
  // 어두운 모델도 바닥 위에서 읽히도록 채도를 올리고 명도를 범위 안으로 묶는다.
  base.getHSL(_hsl);
  base.setHSL(_hsl.h, Math.min(1, _hsl.s * S.saturation), clamp(_hsl.l, S.lightMin, S.lightMax));
  base.getHSL(_hsl);
  accent.setHSL(_hsl.h, _hsl.s * .9, Math.min(.92, _hsl.l + S.accentLift));
  return base;
}

/** 고정 용량 링 버퍼. 가장 오래된 칸부터 덮어쓰고, 살아 있는 구간만 그리도록 count/visible 을 관리한다. 타격 섬광(impact-vfx)도 같은 링을 쓴다. */
export class InstanceRing {
  constructor(scene, geometry, material, capacity, attributes, renderOrder) {
    this.capacity = capacity; this.cursor = 0; this.high = 0; this.lastExpiry = NEVER; this.lo = capacity; this.hi = -1;
    this.expiry = new Float32Array(capacity).fill(NEVER);
    /** @type {Record<string, Float32Array>} */
    this.a = {}; this.defs = attributes;
    for (const name in attributes) {
      const size = attributes[name];
      this.a[name] = new Float32Array(capacity * size);
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(this.a[name], size).setUsage(THREE.DynamicDrawUsage));
    }
    this.geometry = geometry; this.material = material;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.scene = scene; scene.add(this.mesh);
    this._wipe();
  }
  _wipe() { if (this.a.aLife) for (let i = 0; i < this.capacity; i++) { this.a.aLife[i * 2] = NEVER; this.a.aLife[i * 2 + 1] = 1; } }
  /** 칸 하나를 차지한다(가득 차면 가장 오래된 칸을 재활용). */
  claim(expiresAt) {
    const i = this.cursor; this.cursor = (i + 1) % this.capacity;
    if (i + 1 > this.high) this.high = i + 1;
    this.expiry[i] = expiresAt; if (expiresAt > this.lastExpiry) this.lastExpiry = expiresAt;
    if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i;
    return i;
  }
  /** 이번 프레임에 쓴 칸 구간만 GPU 로 올린다. */
  flush() {
    if (this.hi < 0) return;
    const n = this.hi - this.lo + 1;
    for (const name in this.defs) {
      const attribute = this.geometry.attributes[name], size = this.defs[name];
      attribute.clearUpdateRanges(); attribute.addUpdateRange(this.lo * size, n * size); attribute.needsUpdate = true;
    }
    this.lo = this.capacity; this.hi = -1;
  }
  /** 시계 기준으로 살아 있는 칸 수(점검·테스트용 O(capacity), 프레임 경로에서는 부르지 않는다). */
  live(clock) { let n = 0; for (let i = 0; i < this.capacity; i++) if (this.expiry[i] > clock) n++; return n; }
  sync(clock) {
    const on = clock < this.lastExpiry;
    this.mesh.visible = on; this.mesh.count = on ? this.high : 0;
  }
  clear() {
    this.expiry.fill(NEVER); this._wipe(); this.cursor = 0; this.high = 0; this.lastExpiry = NEVER;
    this.lo = 0; this.hi = this.capacity - 1; this.flush();
    this.mesh.visible = false; this.mesh.count = 0;
  }
  dispose() { this.scene.remove(this.mesh); this.geometry.dispose(); this.material.dispose(); this.mesh.dispose?.(); }
}

const SHARD_VERT = `
  attribute vec3 aOrigin; attribute vec3 aVel; attribute vec4 aSpin; attribute vec3 aScale; attribute vec3 aColor; attribute vec2 aLife;
  uniform float uTime, uGravity, uDrag, uGlow;
  varying vec3 vColor; varying vec3 vN; varying float vAlpha; varying float vGlow;
  vec3 rotateAxis(vec3 v, vec3 a, float ang) { float c = cos(ang), s = sin(ang); return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }
  void main() {
    float t = uTime - aLife.x;
    float k = t / max(aLife.y, 0.001);
    vAlpha = 0.0; vColor = aColor; vN = vec3(0.0, 1.0, 0.0); vGlow = 0.0;
    if (t < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float s = (1.0 - exp(-uDrag * t)) / uDrag;
    vec3 p = aOrigin + vec3(aVel.x * s, aVel.y * s - 0.5 * uGravity * t * t, aVel.z * s);
    p.y = max(p.y, 0.04);
    float size = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.62, 1.0, k));
    float ang = aSpin.w * t * (1.0 - 0.5 * k);
    vec3 local = rotateAxis(position * aScale * size, aSpin.xyz, ang);
    vN = rotateAxis(normal, aSpin.xyz, ang);
    vAlpha = 1.0 - smoothstep(0.55, 1.0, k);
    vGlow = 1.0 - smoothstep(0.0, uGlow, t);
    gl_Position = projectionMatrix * viewMatrix * vec4(p + local, 1.0);
  }`;
const SHARD_FRAG = `
  varying vec3 vColor; varying vec3 vN; varying float vAlpha; varying float vGlow;
  void main() {
    float lit = max(dot(normalize(vN), normalize(vec3(0.35, 0.8, 0.45))), 0.0);
    vec3 c = vColor * (0.55 + 0.7 * lit);
    c = mix(c, vec3(1.0, 0.94, 0.78), vGlow * 0.65);
    gl_FragColor = vec4(c, vAlpha);
    if (gl_FragColor.a < 0.02) discard;
  }`;

const WAVE_VERT = `
  attribute vec3 aCenter; attribute vec4 aParams; attribute vec4 aShape; attribute vec3 aColor; attribute vec2 aLife;
  uniform float uTime;
  varying vec2 vP; varying vec4 vS; varying vec4 vT; varying vec3 vColor;
  void main() {
    float t = uTime - aLife.x;
    float k = t / max(aLife.y, 0.001);
    vP = vec2(0.0); vS = vec4(0.0); vT = vec4(0.0); vColor = aColor;
    if (t < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float e = 1.0 - pow(1.0 - k, 3.0);
    float R = mix(0.35, aParams.x, e);
    float edge = aShape.x;
    float halfSize = R * 1.2 + edge * 2.0;
    vP = position.xy * halfSize;
    vS = vec4(R, k, edge, aShape.y);
    vT = vec4(aShape.z, aShape.w, aParams.y, aParams.x);
    gl_Position = projectionMatrix * viewMatrix * vec4(aCenter + vec3(vP.x, 0.0, vP.y), 1.0);
  }`;
const WAVE_FRAG = `
  varying vec2 vP; varying vec4 vS; varying vec4 vT; varying vec3 vColor;
  void main() {
    float d = length(vP), R = vS.x, k = vS.y, w = vS.z;
    // 바깥쪽은 부드럽게 끊기고 안쪽은 꼬리처럼 사그라드는 충격파 단면(굴절·왜곡 없음, 가산만).
    float front = 1.0 - smoothstep(R, R + w * 0.55, d);
    float lead = exp(-pow((d - (R - w * 0.12)) / (w * 0.32), 2.0));
    float tail = exp(-max(R - d, 0.0) / (w * 1.6)) * front * smoothstep(0.0, w * 0.6, d);
    float ring = clamp(lead + tail * 0.28, 0.0, 1.0);
    float a = ring * vS.w * pow(1.0 - k, 1.5);
    if (vT.x > 0.5) {
      // 방사형 빛줄기: 각도 칸마다 길이·굵기가 다르고 파면과 함께 바깥으로 달린다.
      float u = atan(vP.y, vP.x) / 6.2831853 + 0.5;
      float id = floor(u * vT.x);
      float h = fract(sin((id + vT.z * 31.0) * 127.1) * 43758.5453);
      float lane = abs(fract(u * vT.x) - 0.5) * 2.0;
      float len = R * (0.22 + 0.4 * h);
      float prog = clamp((d - (R - len)) / max(len, 0.001), 0.0, 1.0);
      float thick = (0.2 + 0.3 * h) * (0.35 + 0.65 * prog);
      float ray = (1.0 - smoothstep(0.0, thick, lane)) * smoothstep(R - len, R - len * 0.3, d) * (1.0 - smoothstep(R, R + 0.25 + 0.15 * R * h, d));
      a += ray * vT.y * pow(1.0 - k, 2.2);
    }
    a = clamp(a, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), lead * 0.45), a);
  }`;

export class CombatVfx {
  /** @param {THREE.Scene} scene @param {{focus?: {bind: Function}|null, seed?: number}} [options] */
  constructor(scene, { focus = null, seed = 0x5eed1234 } = {}) {
    const S = FEEL.vfx.shards, W = FEEL.vfx.wave;
    this.enabled = true; this.lite = false; this.clock = 0; this.seed = seed >>> 0; this.rng = new VfxRng(this.seed);
    this.budget = S.frameBudget; this.shardsSpawned = 0; this.wavesSpawned = 0;
    this.uTime = { value: 0 };
    this.baseColor = new THREE.Color(); this.accentColor = new THREE.Color(); this._c = new THREE.Color();
    const shardMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uGravity: { value: S.gravity }, uDrag: { value: S.drag }, uGlow: { value: S.glowSec } },
      vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, transparent: true, depthWrite: true,
    });
    this.shards = new InstanceRing(scene, new THREE.TetrahedronGeometry(1, 0), shardMat, S.capacity,
      { aOrigin: 3, aVel: 3, aSpin: 4, aScale: 3, aColor: 3, aLife: 2 }, 12);
    const waveMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,   // 양면을 한 번에(인스턴스 1드로우)
    });
    // 영웅 주변에서는 기존 가산 이펙트와 같은 규칙으로 옅어진다(영웅 윤곽을 덮지 않는다).
    focus?.bind?.(waveMat);
    this.waves = new InstanceRing(scene, new THREE.PlaneGeometry(2, 2), waveMat, W.capacity,
      { aCenter: 3, aParams: 4, aShape: 4, aColor: 3, aLife: 2 }, 9);
  }
  setQuality(q) { this.lite = q === 'low'; }
  /** FX.prepare 동안만: 첫 처치 전에도 두 셰이더가 실제 전투 타깃으로 컴파일되도록 메시를 count 1 로 보이게 한다(칸이 비어 아무것도 그려지지 않는다).
   * 준비가 겹쳐(새 준비가 이전 준비를 대체) 돌 수 있어 참조 횟수로 센다: 마지막 준비가 끝날 때만 원래 상태로 돌린다. */
  setWarm(on) {
    this.warm = Math.max(0, (this.warm || 0) + (on ? 1 : -1));
    for (const ring of [this.shards, this.waves]) ring.sync(this.clock);
    this._applyWarm();
  }
  _applyWarm() {
    if (!(this.warm > 0)) return;
    for (const ring of [this.shards, this.waves]) { ring.mesh.visible = true; ring.mesh.count = Math.max(1, ring.high); }
  }
  /** dt 는 sim 시간(초). 히트스톱 중 0 이면 모든 파편·파면이 그대로 멈춘다. */
  update(dt) {
    this.budget = FEEL.vfx.shards.frameBudget;
    if (Number.isFinite(dt) && dt > 0) this.clock += dt;
    // 오래 이어진 세션에서 float32 시계가 거칠어지지 않도록, 아무것도 안 보일 때만 0 으로 되돌린다.
    if (this.clock > 1800 && this.clock >= this.shards.lastExpiry && this.clock >= this.waves.lastExpiry) { this.clear(); return; }
    this.uTime.value = this.clock;
    this.shards.flush(); this.waves.flush();
    this.shards.sync(this.clock); this.waves.sync(this.clock);
    this._applyWarm();
  }

  /** 적 한 마리의 파편 폭발. 낸 파편 수를 돌려준다. enemy: pos, kb(넉백 벡터), mats, def.scale, isBoss/isElite. */
  shatter(enemy, { reduced = false } = {}) {
    if (!this.enabled || !enemy?.pos) return 0;
    const S = FEEL.vfx.shards, A = this.shards.a, rng = this.rng;
    const n = Math.min(shardCount(enemy, { lite: this.lite, reduced }), this.budget);
    if (n <= 0) return 0;
    this.budget -= n;
    enemyPalette(enemy, this.baseColor, this.accentColor);
    const body = clamp(enemy.def?.scale ?? 1, S.sizeByScale[0], S.sizeByScale[1]);
    const ox = enemy.pos.x, oy = enemy.pos.y + S.bodyHeight * body * S.heightFrac, oz = enemy.pos.z;
    let dx = enemy.kb?.x || 0, dz = enemy.kb?.z || 0;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-3) { dx /= dl; dz /= dl; } else { const a = rng.next() * 6.2831853; dx = Math.cos(a); dz = Math.sin(a); }
    const px = -dz, pz = dx;   // 넉백 방향에 수직인 옆 벡터
    for (let j = 0; j < n; j++) {
      const life = S.life * (1 - S.lifeJitter + 2 * S.lifeJitter * rng.next());
      const slot = this.shards.claim(this.clock + life), i3 = slot * 3, i4 = slot * 4, i2 = slot * 2;
      const fwd = S.speed * (1 - S.speedJitter + 2 * S.speedJitter * rng.next());
      const side = (rng.next() - .5) * 2 * S.spread, back = (rng.next() - .5) * S.spread * .8;
      const up = S.up + S.upJitter * rng.next();
      A.aOrigin[i3] = ox + (rng.next() - .5) * .3; A.aOrigin[i3 + 1] = oy + (rng.next() - .5) * .4; A.aOrigin[i3 + 2] = oz + (rng.next() - .5) * .3;
      A.aVel[i3] = dx * (fwd + back) + px * side; A.aVel[i3 + 1] = up; A.aVel[i3 + 2] = dz * (fwd + back) + pz * side;
      // 회전축은 단위 벡터(구면 균등), 속도는 부호 무작위.
      const ay = rng.next() * 2 - 1, at = rng.next() * 6.2831853, ar = Math.sqrt(1 - ay * ay);
      A.aSpin[i4] = ar * Math.cos(at); A.aSpin[i4 + 1] = ay; A.aSpin[i4 + 2] = ar * Math.sin(at);
      A.aSpin[i4 + 3] = S.spin * (.5 + rng.next()) * (rng.next() < .5 ? -1 : 1);
      const size = S.size * body * (1 - S.sizeJitter + 2 * S.sizeJitter * rng.next()), stretch = 1 + rng.next() * 1.1;
      A.aScale[i3] = size * stretch; A.aScale[i3 + 1] = size * (.45 + rng.next() * .35); A.aScale[i3 + 2] = size * (.7 + rng.next() * .5);
      const pick = rng.next(), c = pick < S.accentShare ? this.accentColor : this._c.copy(this.baseColor);
      if (pick >= S.accentShare && pick < S.accentShare + S.darkShare) this._c.multiplyScalar(S.darkScale);
      A.aColor[i3] = c.r; A.aColor[i3 + 1] = c.g; A.aColor[i3 + 2] = c.b;
      A.aLife[i2] = this.clock; A.aLife[i2 + 1] = life;
    }
    this.shardsSpawned += n;
    return n;
  }

  /** 묶음 처치 단계(0~3)의 지면 충격파 + 방사형 빛줄기. 한 칸 = 한 파면. 성공하면 true. */
  wave(pos, step, { reduced = false } = {}) {
    if (!this.enabled || !pos) return false;
    const P = waveParams(step, { lite: this.lite, reduced });
    if (!P) return false;
    const A = this.waves.a, slot = this.waves.claim(this.clock + P.life), i3 = slot * 3, i4 = slot * 4, i2 = slot * 2;
    A.aCenter[i3] = pos.x; A.aCenter[i3 + 1] = (pos.y || 0) + FEEL.vfx.wave.height; A.aCenter[i3 + 2] = pos.z;
    A.aParams[i4] = P.radius; A.aParams[i4 + 1] = this.rng.next();   // y: 줄기 무늬 시드
    A.aShape[i4] = P.edge; A.aShape[i4 + 1] = P.gain; A.aShape[i4 + 2] = P.rays; A.aShape[i4 + 3] = P.rayGain;
    this._c.set(P.color); A.aColor[i3] = this._c.r; A.aColor[i3 + 1] = this._c.g; A.aColor[i3 + 2] = this._c.b;
    A.aLife[i2] = this.clock; A.aLife[i2 + 1] = P.life;
    this.wavesSpawned++;
    return true;
  }

  /** 전투 시작·정리: 모든 칸을 비우고 시계·난수를 처음 값으로 되돌린다(같은 입력 → 같은 모양). */
  clear() {
    this.shards.clear(); this.waves.clear();
    this.clock = 0; this.uTime.value = 0; this.rng = new VfxRng(this.seed); this.budget = FEEL.vfx.shards.frameBudget;
  }
  dispose() { this.shards.dispose(); this.waves.dispose(); }
}
