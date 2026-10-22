import * as THREE from 'three';
import { softCircleTex, sparkTex, ringTex, slashTex, smokeTex, VFX_TEX } from './assets.js';
import { ImpactLights } from './impact-lights.js';
import { CombatVfx } from './combat-vfx.js';
import { ImpactVfx, HERO_IMPACT_PALETTE, IMPACT_KIND } from './impact-vfx.js';
import { spawnSanctum } from './sanctum-vfx.js';
import { HeroEffectFocus } from './hero-effect-focus.js';
import { WeaponTrail, createWeaponTrailMaterial } from './weapon-trail.js';
import { bloomLoadFor, compactCombatStatus, decorativeBurstGain, boundedFeedbackGain, combatTextRegions, combatTextViewport, heroCombatTextRegion, placeCombatStatus } from './combat-feedback.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _tintHsl = { h: 0, s: 0, l: 0 }, _tintColor = new THREE.Color(), _sigRing = new THREE.Color();
/** 불꽃·폭발 원화(주황 결)를 차가운 영웅색(보라·청·비취)으로 칠할 때 원화 색을 밝기로 바꿔 색을 살리는 비율.
 * 따뜻한 색(빨강~노랑)과 흰빛·크림은 원화 그대로(0). 예전에는 보라를 곱해 주황·분홍 불기둥이 됐다. */
export function textureTintMix(color) {
  _tintColor.set(color).getHSL(_tintHsl);
  if (_tintHsl.s < .25) return 0;
  const h = _tintHsl.h;
  return h <= .17 || h >= .95 ? 0 : .85;
}
// 원화 rgb 를 밝기(채도 없는 결)로 바꾸는 GLSL 조각. uTint 0 이면 원본.
const TINT_GLSL = 'vec3 bsTint(vec3 c, float k) { float l = dot(c, vec3(.3, .59, .11)); return mix(c, vec3(l * 1.35), k); }\n';
const preparationOwners = new WeakMap();
// 플립북 셰이더 원문(모듈 상수: 호출마다 템플릿 문자열을 다시 만들지 않는다).
const FLIPBOOK_VERT = `uniform float uScale; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); mv.xy += position.xy * uScale; gl_Position = projectionMatrix * mv; }`;
const FLIPBOOK_FRAG = `uniform sampler2D uTex; uniform float uFrame, uAlpha, uTint; uniform vec2 uGrid; uniform vec3 uColor; varying vec2 vUv;
        ${TINT_GLSL}
        void main(){ float f = floor(uFrame); float cx = mod(f, uGrid.x); float cy = floor(f / uGrid.x); vec2 uv = (vUv + vec2(cx, uGrid.y - 1.0 - cy)) / uGrid; vec4 t = texture2D(uTex, uv); float lum = max(t.r, max(t.g, t.b)); gl_FragColor = vec4(bsTint(t.rgb, uTint) * uColor, lum * uAlpha); }`;
export const DUST_COLOR = 0x6a5f52, DUST_OPACITY = .34;

/**
 * Authored ability signatures keep the silhouette of each school distinct while
 * reusing the existing pooled particles and VFX atlas. Values are immutable so
 * a party client cannot mutate another skill's visual contract at runtime.
 */
export const ABILITY_VFX_PROFILES = Object.freeze({
  // The primary/secondary atlas pair is part of the visual contract. Reusing a
  // colour alone made steel/nature impacts read as the same spell in a busy
  // party fight, so every school now has a unique silhouette pair.
  steel: Object.freeze({ ground: 'circle_gold', flash: 'slash', secondary: 'holy_burst', color: 0xffd060, accent: 0xffffff, radius: 2.8, burst: 14, light: 0.9 }),
  // 화염: 크림 강조색(0xffd060)·밝은 주황 폭발 원화가 가산으로 겹쳐 흰 코어가 됐다. 진홍 쪽 주황과 불씨 주황으로 낮춘다.
  fire: Object.freeze({ ground: 'circle_demon', flash: 'explosion', secondary: 'phoenix', color: 0xff5418, accent: 0xff8a26, radius: 3.6, burst: 20, light: 1.2, pillar: true, flashGain: .72 }),
  // 냉기 강조색은 흰빛(0xdff8ff) 대신 진한 하늘색: 눈보라·절대영도에서 얼음 원화와 겹쳐 화면이 하얗게 덮였다.
  // 서리: 옅은 하늘색(0x5fcfff) 기운이 지면·고리에 흰빛으로 번졌다. 진한 청 결정색으로.
  frost: Object.freeze({ ground: 'circle_gold', flash: 'ice', secondary: 'shockwave', color: 0x2f8cff, accent: 0x62b4ff, radius: 3.4, burst: 16, light: 1.0, groundColor: 0x1466f0, groundScale: .8, flashGain: .7 }),
  arcane: Object.freeze({ ground: 'circle_gold', flash: 'lightning_chain', secondary: 'lightning', color: 0x70b8ff, accent: 0xd7f4ff, radius: 3.0, burst: 15, light: 1.0, groundColor: 0x3a5cff, groundScale: .8 }),
  nature: Object.freeze({ ground: 'circle_gold', flash: 'phoenix', secondary: 'dust', color: 0x63e08a, accent: 0xd7ff9d, radius: 3.3, burst: 18, light: 0.85 }),
  void: Object.freeze({ ground: 'circle_demon', flash: 'singularity', secondary: 'blood_burst', color: 0x8f55ff, accent: 0xd5a6ff, radius: 3.2, burst: 18, light: 1.1 }),
});

function checkPreparedPrograms(renderer, gl, properties, bindings) {
  if (gl.isContextLost()) throw new Error('render preparation context lost');
  if (renderer.getContext() !== gl || renderer.properties !== properties) throw new Error('render preparation renderer state changed');
  for (const [material, program] of bindings) {
    if (!properties.has(material) || properties.get(material).currentProgram !== program || !program.program) {
      throw new Error('render preparation material or program was disposed or replaced');
    }
  }
}

function checkCachedProgramBindings(renderer, gl, properties, bindings) {
  checkPreparedPrograms(renderer, gl, properties, []);
  for (const { material, cache, key, program, handle } of bindings) {
    if (!properties.has(material) || properties.get(material).programs !== cache
      || cache.get(key) !== program || program.program !== handle) {
      throw new Error('render preparation cached material or program was disposed or replaced');
    }
  }
}

function captureCompiledPrograms(renderer, gl, properties, materials, captured) {
  if (captured.gl && (captured.gl !== gl || captured.properties !== properties)) {
    throw new Error('render preparation renderer state changed');
  }
  captured.gl = gl; captured.properties = properties;
  captured.lastMaterials = materials;
  const bindings = [], byProgram = new Map();
  for (const material of materials) {
    if (!properties.has(material)) throw new Error('render preparation material was not compiled');
    const cache = properties.get(material).programs;
    if (!(cache instanceof Map) || !cache.size) throw new Error('render preparation program cache is unavailable');
    for (const [key, program] of cache) {
      if (!program?.program || typeof program.isReady !== 'function') throw new Error('render preparation program readiness is unavailable');
      const binding = { material, cache, key, program, handle: program.program };
      bindings.push(binding);
      if (!byProgram.has(program)) byProgram.set(program, []);
      byProgram.get(program).push(binding);
      if (!captured.programs.has(program)) captured.programs.set(program, []);
      const existing = captured.programs.get(program);
      if (!existing.some(b => b.material === material && b.cache === cache && b.key === key)) existing.push(binding);
    }
  }
  checkCachedProgramBindings(renderer, gl, properties, bindings);
  return { bindings, byProgram };
}

function compilePreparedScene(renderer, scene, camera, targetScene, isCurrent, captured = null) {
  if (!isCurrent()) return Promise.resolve(false);
  // r170 compileAsync's timer reads mutable material properties without a
  // cancellation/error guard. Own the same readiness cadence over captured
  // programs instead, so stop/context recovery cannot leave zombie timers.
  if (THREE.REVISION !== '170' || typeof renderer.compile !== 'function'
    || typeof renderer.getContext !== 'function' || typeof renderer.extensions?.get !== 'function'
    || typeof renderer.properties?.has !== 'function' || typeof renderer.properties?.get !== 'function') {
    return Promise.reject(new Error('render preparation requires Three r170 compilation API'));
  }
  const gl = renderer.getContext(), properties = renderer.properties;
  if (typeof gl?.isContextLost !== 'function') return Promise.reject(new Error('render preparation has no WebGL context API'));
  let pending, cached;
  try {
    checkPreparedPrograms(renderer, gl, properties, []);
    const materials = renderer.compile(scene, camera, targetScene);
    pending = new Map();
    for (const material of materials) {
      if (!properties.has(material)) throw new Error('render preparation material was not compiled');
      const program = properties.get(material).currentProgram;
      if (!program?.program || typeof program.isReady !== 'function') throw new Error('render preparation program readiness is unavailable');
      pending.set(material, program);
    }
    checkPreparedPrograms(renderer, gl, properties, pending);
    if (captured) {
      cached = captureCompiledPrograms(renderer, gl, properties, materials, captured);
      pending = new Map([...cached.byProgram.keys()].map(program => [program, program]));
    }
  } catch (error) { return Promise.reject(error); }
  return new Promise((resolve, reject) => {
    let poll, deadline, finished = false;
    const finish = (ready, error = null) => {
      if (finished) return; finished = true;
      if (poll !== undefined) clearTimeout(poll);
      if (deadline !== undefined) clearTimeout(deadline);
      if (error) reject(error); else resolve(ready);
    };
    const check = () => {
      poll = undefined;
      if (finished) return;
      try {
        if (!isCurrent()) { finish(false); return; }
        if (cached) checkCachedProgramBindings(renderer, gl, properties, cached.bindings);
        else checkPreparedPrograms(renderer, gl, properties, pending);
        for (const [material, program] of pending) {
          if (cached) checkCachedProgramBindings(renderer, gl, properties, cached.byProgram.get(program));
          else checkPreparedPrograms(renderer, gl, properties, [[material, program]]);
          const ready = program.isReady();
          if (cached && !isCurrent()) { finish(false); return; }
          if (cached) checkCachedProgramBindings(renderer, gl, properties, cached.byProgram.get(program));
          else checkPreparedPrograms(renderer, gl, properties, [[material, program]]);
          if (ready) pending.delete(material);
        }
        if (!pending.size) finish(true); else poll = setTimeout(check, 10);
      } catch (error) { finish(false, error); }
    };
    deadline = setTimeout(() => finish(false, new Error('render preparation timeout')), 30000);
    try {
      // Match r170: KHR gets an immediate first check; otherwise wait 10 ms.
      if (renderer.extensions.get('KHR_parallel_shader_compile') !== null) check();
      else poll = setTimeout(check, 10);
    } catch (error) { finish(false, error); }
  });
}

function checkCapturedReadiness(renderer, objects, captured, targetMaterials = null) {
  const { gl, properties, programs } = captured;
  checkPreparedPrograms(renderer, gl, properties, []);
  for (const object of objects) object.traverse(o => {
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!material) continue;
      if (!properties.has(material) || (targetMaterials && !targetMaterials.has(material))) {
        throw new Error('targeted render preparation requested material was not compiled for its target');
      }
      const record = properties.get(material), program = record.currentProgram;
      const bindings = programs.get(program);
      if (!bindings?.some(b => b.material === material && b.cache === record.programs
        && b.cache.get(b.key) === program && program.program === b.handle)) {
        throw new Error('targeted render preparation requested material or program was disposed or replaced');
      }
    }
  });
}

async function prepareCompiledReflection(renderer, captured, isCurrent, checkReadiness) {
  if (!isCurrent()) return false;
  const { gl, properties, programs } = captured;
  if (!programs.size) { checkReadiness(); return isCurrent(); }
  if (typeof gl.getProgramParameter !== 'function' || typeof gl.LINK_STATUS !== 'number') {
    throw new Error('targeted render preparation has no WebGL readiness API');
  }
  checkReadiness();
  for (const [program, bindings] of programs) {
    // 실제 출격/복구 준비에서만 이미 획득한 캐시의 양면 프로그램까지 반사한다.
    // 부트 기본 경로와 게임 프레임에는 추가 draw나 준비 레지스트리가 없다.
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (!isCurrent()) return false;
    const check = () => {
      checkCachedProgramBindings(renderer, gl, properties, bindings);
      checkReadiness();
    };
    check();
    if (typeof program.getUniforms !== 'function' || typeof program.getAttributes !== 'function') {
      throw new Error('targeted render preparation program reflection is unavailable');
    }
    const linked = gl.getProgramParameter(program.program, gl.LINK_STATUS);
    if (!isCurrent()) return false;
    check();
    if (linked !== true) {
      const log = gl.getProgramInfoLog?.(program.program) || 'No program diagnostic available';
      throw new Error(`Targeted shader program did not link: ${log}`);
    }
    program.getUniforms();
    if (!isCurrent()) return false;
    check();
    program.getAttributes();
    if (!isCurrent()) return false;
    check();
  }
  if (!isCurrent()) return false;
  for (const bindings of programs.values()) checkCachedProgramBindings(renderer, gl, properties, bindings);
  checkReadiness();
  return true;
}

async function prepareObjectReflection(renderer, objects, isCurrent) {
  if (!isCurrent()) return false;
  if (!objects.length) return true;
  // This narrow adapter relies on the pinned Three r170 program-reflection API.
  // Do not silently report readiness after a renderer/version change.
  if (THREE.REVISION !== '170' || typeof renderer.getContext !== 'function'
    || typeof renderer.properties?.has !== 'function' || typeof renderer.properties?.get !== 'function') {
    throw new Error('targeted render preparation requires Three r170 program reflection');
  }
  const gl = renderer.getContext(), properties = renderer.properties, programs = new Set(), bindings = new Map();
  if (typeof gl?.isContextLost !== 'function' || typeof gl.getProgramParameter !== 'function' || typeof gl.LINK_STATUS !== 'number') {
    throw new Error('targeted render preparation has no WebGL readiness API');
  }
  const checkContext = () => checkPreparedPrograms(renderer, gl, properties, bindings);
  checkContext();
  for (const object of objects) object.traverse(o => {
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!material) continue;
      if (!renderer.properties.has(material)) throw new Error('targeted render preparation material was not compiled');
      const program = renderer.properties.get(material).currentProgram;
      if (!program?.program || typeof program.getUniforms !== 'function' || typeof program.getAttributes !== 'function') {
        throw new Error('targeted render preparation program reflection is unavailable');
      }
      bindings.set(material, program);
      programs.add(program);
    }
  });
  for (const program of programs) {
    // Yield between this small set of measured loot/warning signatures so the
    // native loading view can paint; no game step or render runs here.
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (!isCurrent()) return false;
    checkContext();
    const linked = gl.getProgramParameter(program.program, gl.LINK_STATUS);
    checkContext();
    if (linked !== true) {
      const log = gl.getProgramInfoLog?.(program.program) || 'No program diagnostic available';
      throw new Error(`Targeted shader program did not link: ${log}`);
    }
    // compileAsync alone can leave ACTIVE_UNIFORMS/attributes waiting on first
    // combat draw. These r170 calls populate its existing per-program caches.
    program.getUniforms(); checkContext(); program.getAttributes(); checkContext();
  }
  return isCurrent();
}

// ============ GPU Points 파티클 풀 ============
export class ParticlePool {
  /** @param {THREE.Scene} scene @param {{max?: number, texture?: THREE.Texture, blending?: THREE.Blending, depthWrite?: boolean}} [options] */
  constructor(scene, { max = 1500, texture, blending = THREE.AdditiveBlending, depthWrite = false } = {}) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.size0 = new Float32Array(max); this.shrink = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture }, uScale: { value: 400 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite, blending,
    });
    this.mesh = new THREE.Points(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
    scene.add(this.mesh); this.geo = g; this.mat = m;
  }
  emit(x, y, z, vx, vy, vz, color, size, life, { grav = 9, drag = 0.98, shrink = 1 } = {}) {
    let i;
    if (this.n < this.max) i = this.n++; else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size; this.size0[i] = size; this.alpha[i] = 1; this.age[i] = 0; this.life[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.shrink[i] = shrink;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { // swap-remove
        n--; if (i !== n) { this._copy(n, i); i--; } continue;
      }
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.35; this.vel[i * 3] *= 0.7; this.vel[i * 3 + 2] *= 0.7; }
      const t = this.age[i] / this.life[i];
      this.alpha[i] = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      this.size[i] = this.size0[i] * (1 + (this.shrink[i] - 1) * t);
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    // 그리는 입자 구간만 전송한다. 0개일 때는 drawRange만 닫으면 된다.
    if (n > 0) for (const attribute of Object.values(this.geo.attributes)) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, n * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
  _copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; this.col[to * 3 + k] = this.col[from * 3 + k]; }
    this.size[to] = this.size[from]; this.size0[to] = this.size0[from]; this.alpha[to] = this.alpha[from]; this.age[to] = this.age[from]; this.life[to] = this.life[from]; this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.shrink[to] = this.shrink[from];
  }
}

// 처치 확정 섬광: 한 프레임에 낼 수 있는 상한과 색(공유 인스턴스라 호출마다 할당하지 않는다)
const KILL_CONFIRM_PER_FRAME = 10;
const KILL_COLOR = new THREE.Color(0xffe9a8);
// 가산 노출 예산: 큰 장식(폭발·섬광·마법진)이 짧은 시간에 겹쳐 화면이 하얗게 날아가는 것을 막는다.
// 최근 장식 면적(지름² 합)이 SOFT 를 넘으면 새 장식의 RGB 만 SOFT/누적 비율로 낮춘다(하한 FLOOR). 크기·수명·알파·난수는 그대로다.
// 누적은 sim 시간 TAU 초로 지수 감쇠한다. 예고(telegraph)는 예산에 넣지도 낮추지도 않는다.
export const FX_EXPOSURE = Object.freeze({ soft: 170, floor: .5, tau: .35, groundWeight: .5 });
// 카메라를 향하는 텍스처 섬광의 최대 화면 지름(월드 m, 최종 확대 시점). 모바일 가로 화면의 전투 폭은 약 20m라
// 12m 넘는 빌보드(용참·성광 폭발 24m, 냉기 서명 16m)는 영웅·적·다음 예고를 통째로 하얗게 덮었다.
// 넓은 장악감은 지면 원진·충격파(바닥에 눕는 층)가 맡고, 서 있는 섬광은 이 지름 안에서 모양을 보여 준다.
export const TEX_FLASH_MAX_DIAMETER = 10;
// 장식 지면층(마법진·충격 고리) 색 규칙: 파스텔(밝기 높고 채도 낮음)은 가산으로 3~4겹 쌓이면 흰색이 된다
// (성역 0xfff3b0·시간 봉인 0xc0d8ff·눈보라 0x80e0ff 가 화면을 하얗게 덮음). 색상은 지키고 밝기를 낮추고 채도를 올려
// 겹쳐도 영웅색(금·청·보라·비취·주황)으로 남게 한다. 이미 진한 색(밝기 ≤ pastel)과 예고(telegraph)는 손대지 않는다.
export const DECAL_COLOR = Object.freeze({ pastel: .7, light: .6, lightKeep: .4, satMin: .82, greyLight: .72 });
const _decalHsl = { h: 0, s: 0, l: 0 };
/** 지면 장식 색을 겹쳐도 하얗게 날지 않는 진한 색으로 바꿔 out 에 쓴다(할당 없음). */
export function vividDecalColor(color, out) {
  out.set(color).getHSL(_decalHsl, THREE.SRGBColorSpace);
  let { h, s, l } = _decalHsl;
  if (s < .12) { if (l > DECAL_COLOR.greyLight) out.setHSL(h, s, DECAL_COLOR.greyLight, THREE.SRGBColorSpace); return out; }
  if (l <= DECAL_COLOR.pastel) return out;
  return out.setHSL(h, Math.max(s, DECAL_COLOR.satMin), DECAL_COLOR.light + (l - DECAL_COLOR.pastel) * DECAL_COLOR.lightKeep, THREE.SRGBColorSpace);
}
/** texFlash 의 최종 지름 size*(0.4+grow) 가 상한을 넘지 않게 size 를 줄인다. 작은 섬광은 그대로다. */
export function texFlashFitSize(size, grow = 1.3) {
  if (!Number.isFinite(size) || size <= 0) return size;
  const reach = 0.4 + Math.max(0, Number.isFinite(grow) ? grow : 0);
  return Math.min(size, TEX_FLASH_MAX_DIAMETER / reach);
}
// ============ 일회성 메시 이펙트(스프라이트/링/참격/기둥) 관리 ============
const _orbWhite = new THREE.Color(1, 1, 1);
export class FX {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.focus = new HeroEffectFocus();
    this.sparks = new ParticlePool(scene, { max: 1500, texture: sparkTex() });
    this.glow = new ParticlePool(scene, { max: 1200, texture: softCircleTex() });
    this.smoke = new ParticlePool(scene, { max: 400, texture: smokeTex(), blending: THREE.NormalBlending });
    this.focus.bind(this.sparks.mat); this.focus.bind(this.glow.mat);
    this.items = []; // {obj, t, life, update}
    this.impactLights = new ImpactLights(scene);
    // 처치 파편·묶음 처치 충격파: 인스턴스 풀 2장(드로우콜 2). 시계는 아래 update(dt) 의 sim dt.
    this.vfx = new CombatVfx(scene, { focus: this.focus });
    // 타격·치명타·처치 임팩트 프레임: 인스턴스 1장(드로우콜 1). 시계는 vfx 와 같은 sim dt.
    this.impact = new ImpactVfx(scene, { focus: this.focus, camera });
    this.lights = this.impactLights.slots;
    this.dmgLayer = document.getElementById('dmg-layer');
    this.dmgPool = []; this.maxDmg = 40; this._killBudget = KILL_CONFIRM_PER_FRAME;
    this._damageRecent = []; this._damageSerial = 0;
    this._damageRandomState = 0x6d2b79f5;
    this._combatTextRegions = [];
    this._combatTextViewport = null;
    this.quality = 'high';
    this._mats = {};
    this._transparentMats = new Map();
    this._depthMats = new Map();
    this.plane1 = new THREE.PlaneGeometry(1, 1);
    this.plane2 = new THREE.PlaneGeometry(2, 2);
    this.trails = [];
    this._exposure = 0;
  }
  setQuality(q) { this.quality = q; this.impactLights.setEnabled(q !== 'low'); this.vfx?.setQuality(q); this.impact?.setQuality(q); }
  get lite() { return this.quality === 'low'; }
  add(obj, life, update, onEnd) { this.scene.add(obj); this.items.push({ obj, t: 0, life, update, onEnd }); return obj; }
  /** paused: 전투 일시정지(Battle.update 가 시간을 멈춘 상태)에서는 전투 VFX 시계를 흘리지 않는다. */
  update(dt, paused = false) {
    this._killBudget = KILL_CONFIRM_PER_FRAME;
    if (dt > 0 && this._exposure > 0) this._exposure *= Math.exp(-dt / FX_EXPOSURE.tau);
    // 인스턴스 임팩트 층(서명·타격)의 밝은 면적도 블룸 자동 감쇠 부하에 넣는다(색은 낮추지 않는다).
    if (this.impact?.load > 0) { this._exposure = (this._exposure || 0) + this.impact.load; this.impact.load = 0; }
    this.sparks.update(dt); this.glow.update(dt); this.smoke.update(dt); this.vfx?.update(paused ? 0 : dt); this.impact?.update(paused ? 0 : dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt; const k = it.t / it.life;
      if (k >= 1) { this._finishItem(i); continue; }
      it.update?.(k, it.t, dt);
    }
    this.impactLights.update(dt);
    for (let i = this.trails.length - 1; i >= 0; i--) { const tr = this.trails[i]; tr.update(dt); if (tr.dead) { this.scene.remove(tr.mesh); this.trails.splice(i, 1); } }
  }
  /** 렌더러 블룸 감쇠용 현재 부하(0~1). */
  bloomLoad() { return bloomLoadFor(this._exposure || 0); }
  /** 새 장식 하나의 노출 배율(0.5~1)을 돌려주고 그 면적을 누적한다. */
  _exposureGain(size, weight = 1) {
    const area = Number.isFinite(size) ? Math.max(0, size) ** 2 * weight : 0;
    const before = this._exposure || 0;
    this._exposure = before + area;
    return before > FX_EXPOSURE.soft ? Math.max(FX_EXPOSURE.floor, FX_EXPOSURE.soft / before) : 1;
  }
  light(pos, color, intensity = 6, dist = 9, life = 0.35) {
    this.impactLights.emit(pos, color, intensity * 2.5, dist, life);
  }
  _mat(key, make, { telegraph = false } = {}) {
    return this._mats[key] || (this._mats[key] = telegraph ? make() : this.focus.bind(make()));
  }
  _keep(material, { telegraph = false } = {}) {
    // These are the program-affecting features used by this FX module. Color,
    // opacity, texture identity and animation frames are uniforms, not cache keys.
    const key = [material.type, material.blending, material.side, material.forceSinglePass, material.transparent, material.fog, material.toneMapped,
      !!material.map, material.vertexShader || '', material.fragmentShader || '', telegraph].join('|');
    material.userData.telegraph = telegraph;
    if (!telegraph) this.focus.bind(material);
    // Material.clone does not retain shader callbacks. Rebind the prepared variant.
    this._mat(key, () => material.clone(), { telegraph });
    return material;
  }
  _finishItem(index) {
    const [it] = this.items.splice(index, 1);
    this.scene.remove(it.obj); it.onEnd?.();
    it.obj.traverse?.((o) => { if (o.geometry && o.userData.ownGeo) o.geometry.dispose(); });
  }
  async prepare(renderer, models, renderTarget, preparationObjects = [], readinessObjects = preparationObjects, isCurrent = () => true, targetPreparations = [], { reflectCompiledPrograms = false } = {}) {
    // Run while stageStarting blocks game frames/input. compileAsync must finish
    // with the battle's actual lights/fog/shadows before any combat draw uses it.
    const callerCurrent = () => !this._disposed && isCurrent();
    if (!callerCurrent()) return false;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!callerCurrent()) return false;
    if (!this._primed) {
      const p = new THREE.Vector3(), mark = this.items.length;
      this.flash(p, 0xffffff); this.ring(p, 0xffffff); this.pillar(p, 0xffffff); this.firePillar(p);
      this.slashArc(p, 0, 0xffffff); this.castCircle(p, 0xffffff);
      // Enemy windups keep their original shader and must also be ready before combat.
      this.flash(p, 0xffffff, { telegraph: true }); this.ring(p, 0xffffff, { telegraph: true });
      this.slashArc(p, 0, 0xffffff, { telegraph: true }); this.castCircle(p, 0xffffff, { telegraph: true });
      this.flipbook(p, 'explosion'); this.flipbook(p, 'dust', { blending: THREE.NormalBlending });
      this._keep(new THREE.MeshBasicMaterial({ color: 0xffffff } )).dispose();
      this._keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })).dispose();
      this._keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })).dispose();
      // 리본의 밝은 날과 색 잔광도 같은 실제 전투 타깃의 셰이더로 준비한다.
      this._trailMaterial(0xffffff).dispose();
      this._keep(new THREE.MeshBasicMaterial({ map: softCircleTex(), transparent: true, depthWrite: false })).dispose();
      // Coins/material drops use untextured PBR, unlike the textured model atlases.
      this._keep(new THREE.MeshStandardMaterial()).dispose();
      while (this.items.length > mark) this._finishItem(this.items.length - 1);
      this._primed = true;
    }
    const warm = new THREE.Scene();
    for (const material of Object.values(this._mats)) warm.add(material.isSpriteMaterial ? new THREE.Sprite(material) : new THREE.Mesh(this.plane1, material));
    for (const gltf of Object.values(models)) {
      warm.add(gltf.scene.clone(true));
      // Ghostly/dead actors switch to transparent materials. Keep those programs
      // ready too, so an otherwise smooth first hit does not hitch on its kill.
      gltf.scene.traverse((o) => {
        // 사망 시 정적 장식 메시도 투명해진다(해골 자객의 양면 메시 등).
        // 스킨 메시만 준비하면 그 장식의 앞/뒷면 셰이더가 처치마다 재생성된다.
        if (!o.isMesh) return;
        const transparent = (source) => {
          if (!this._transparentMats.has(source)) { const m = source.clone(); m.transparent = true; this._transparentMats.set(source, m); }
          return this._transparentMats.get(source);
        };
        const ghost = o.clone(); ghost.material = Array.isArray(o.material) ? o.material.map(transparent) : transparent(o.material);
        warm.add(ghost);
      });
    }
    // RenderPass draws into the composer's linear target, not the sRGB screen.
    // Preparing against the screen would retain different programs and still
    // force compilation when a skill reaches the actual battle render target.
    const previousOwner = preparationOwners.get(renderer);
    const owner = { originalTarget: previousOwner ? previousOwner.originalTarget : renderer.getRenderTarget() };
    preparationOwners.set(renderer, owner);
    const valid = () => callerCurrent() && preparationOwners.get(renderer) === owner;
    const captured = reflectCompiledPrograms ? { programs: new Map(), gl: null, properties: null } : null;
    const targetReadiness = [];
    const originalParents = [];
    this.vfx?.setWarm(true); this.impact?.setWarm(true);
    try {
      for (const object of new Set(preparationObjects)) {
        originalParents.push({ object, parent: object.parent }); warm.add(object);
      }
      const textures = new Set([...Object.values(VFX_TEX), sparkTex(), softCircleTex(), ringTex(), slashTex(), smokeTex()]);
      warm.traverse((o) => {
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) {
          for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
          for (const uniform of Object.values(m.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
        }
      });
      for (const texture of textures) if (texture) renderer.initTexture(texture);
      renderer.setRenderTarget(renderTarget);
      await compilePreparedScene(renderer, this.scene, this.camera, null, valid, captured);
      if (!valid()) return false;
      await compilePreparedScene(renderer, warm, this.camera, this.scene, valid, captured);
      if (!valid()) return false;
      if (renderer.shadowMap.enabled) {
        // The shadow renderer uses a fog-free scene and depth materials of its
        // own. Color-material compilation alone misses the first monster shadow.
        const shadowTarget = new THREE.Scene(), shadowWarm = new THREE.Scene();
        this.scene.traverseVisible((o) => { if (o.isLight) shadowTarget.add(o.clone()); });
        const addShadow = (o) => {
          if (!o.isMesh || !o.castShadow) return;
          const depth = (source) => {
            const side = source.shadowSide ?? (source.side === THREE.FrontSide ? THREE.BackSide : source.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
            const key = [!!o.isSkinnedMesh, !!o.isInstancedMesh, !!o.instanceColor, !!o.morphTexture,
              JSON.stringify(Object.fromEntries(Object.entries(o.geometry.morphAttributes).map(([k, v]) => [k, v.length]))),
              side, !!source.map, source.map?.channel, !!source.alphaMap, source.alphaMap?.channel, source.alphaTest > 0, source.alphaHash, !!source.displacementMap].join('|');
            if (!this._depthMats.has(key)) this._depthMats.set(key, new THREE.MeshDepthMaterial({
              depthPacking: THREE.RGBADepthPacking, side, map: source.map ?? null, alphaMap: source.alphaMap ?? null,
              alphaTest: source.alphaTest, alphaHash: source.alphaHash, displacementMap: source.displacementMap ?? null,
              displacementScale: source.displacementScale ?? 1, displacementBias: source.displacementBias ?? 0,
            }));
            return this._depthMats.get(key);
          };
          const object = o.clone(false); object.material = Array.isArray(o.material) ? o.material.map(depth) : depth(o.material); shadowWarm.add(object);
        };
        this.scene.traverse(addShadow); warm.traverse(addShadow);
        await compilePreparedScene(renderer, shadowWarm, this.camera, shadowTarget, valid, captured);
        if (!valid()) return false;
      }
      // 내 캐릭터 마스크처럼 조명 없는 별도 타깃도 같은 취소 가능한
      // 컴파일 소유자 안에서 준비한다. 추가 warm draw/그림자 패스는 없다.
      for (const preparation of targetPreparations) {
        if (!valid() || !preparation.isCurrent()) return false;
        renderer.setRenderTarget(preparation.target);
        const targetCurrent = () => valid() && preparation.isCurrent();
        await compilePreparedScene(renderer, preparation.scene, this.camera, null, targetCurrent, captured);
        if (!targetCurrent()) return false;
        if (captured) {
          const entry = { objects: preparation.readinessObjects, materials: captured.lastMaterials };
          checkCapturedReadiness(renderer, entry.objects, captured, entry.materials);
          targetReadiness.push(entry);
        } else {
          const reflected = await prepareObjectReflection(renderer, preparation.readinessObjects, targetCurrent);
          if (!targetCurrent() || !reflected) return false;
        }
      }
      renderer.setRenderTarget(renderTarget);
      if (captured) return await prepareCompiledReflection(renderer, captured,
        () => valid() && targetPreparations.every(preparation => preparation.isCurrent()), () => {
          checkCapturedReadiness(renderer, readinessObjects, captured);
          for (const entry of targetReadiness) checkCapturedReadiness(renderer, entry.objects, captured, entry.materials);
        });
      return await prepareObjectReflection(renderer, readinessObjects, valid);
    } finally {
      this.vfx?.setWarm(false); this.impact?.setWarm(false);
      try {
        for (const { object, parent } of originalParents) {
          if (object.parent === warm) { warm.remove(object); if (parent && valid()) parent.add(object); }
        }
      }
      finally {
        // A superseded preparation must not overwrite the newer loading pass.
        // The latest owner inherits the original target and restores it once.
        if (preparationOwners.get(renderer) === owner) {
          preparationOwners.delete(renderer); renderer.setRenderTarget(owner.originalTarget);
        }
      }
    }
  }

  // ---------- 파티클 프리셋 ----------
  burst(pos, color, { n = 18, speed = 7, size = 0.35, life = 0.5, grav = 12, up = 0.5, pool = 'sparks', spread = 1, shrink = 0.2 } = {}) {
    const p = this[pool]; const c = new THREE.Color(color);
    if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * Math.PI * spread, s = speed * (0.4 + Math.random() * 0.8);
      p.emit(pos.x, pos.y, pos.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up * speed, Math.sin(a) * Math.cos(e) * s, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), { grav, shrink });
    }
  }
  directional(pos, dir, color, { n = 14, speed = 9, size = 0.3, life = 0.4, spread = 0.5 } = {}) {
    const c = new THREE.Color(color); if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const s = speed * (0.5 + Math.random());
      _v.set(dir.x + (Math.random() - 0.5) * spread, 0.25 + Math.random() * 0.5, dir.z + (Math.random() - 0.5) * spread).normalize().multiplyScalar(s);
      this.sparks.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), { grav: 14, shrink: 0.1 });
    }
  }
  /** 접촉 하나에 날·둔기·마법의 실루엣 하나만 남기고 불꽃은 기존 풀을 쓴다. */
  contact(pos, dir, color, { size = 1.6, particles = 5, light = false, kind = 'slash', tier = 'light', crit = false } = {}) {
    const count = Number.isFinite(particles) ? Math.max(0, Math.min(12, Math.round(particles))) : 0;
    const radius = Number.isFinite(size) ? Math.max(.4, Math.min(2, size)) : 1;
    const reduced = count === 0, heavy = tier !== 'light';
    const e = this.camera?.matrixWorld.elements;
    const angle = e && dir.lengthSq() > 0
      ? Math.atan2(dir.x * e[4] + dir.y * e[5] + dir.z * e[6], dir.x * e[0] + dir.y * e[1] + dir.z * e[2]) : -.65;
    // 둔기는 중심이 빈 충격 고리, 참격은 진행 방향의 얇은 날, 마법은 짧은 별빛이다.
    // 흰 플래시와 참격 아틀라스를 중첩하지 않아 적 몸과 다음 예고를 비워 둔다.
    const slash = kind === 'slash', blunt = kind === 'blunt';
    // 크림색(0xfff0d0) 바탕 번짐은 영웅 강조색으로 바꾼다: 군중을 한꺼번에 칠 때 적마다 크림 구름이 생기던 원인(검성 방패 강타·광전사 회전베기).
    const pal = HERO_IMPACT_PALETTE[this._heroId()];
    // 마법 타격도 영웅색으로(옅은 하늘색 0xa0e0ff 바탕 번짐은 대마도사 처치·연계마다 흰 거품으로 보였다).
    if (pal && !crit) color = pal.accent;
    // 또렷한 모양(자국·고리·별빛·불똥)은 impact 층이 그린다. 이 부드러운 스프라이트는 바탕 번짐으로만 남겨 적 몸을 크림색 타원으로 덮지 않는다.
    const cue = this.flash(pos, color, {
      size: reduced ? radius : radius * .5, life: reduced ? .08 : tier === 'finisher' ? .14 : .10,
      angle: reduced || blunt ? 0 : slash ? angle : Math.PI / 4,
      stretch: reduced || blunt ? 1 : slash ? (heavy ? 2 : 1.7) : 1.12,
      tex: blunt && !reduced ? 'ring' : 'spark', contact: true, stationary: reduced,
    });
    // Three r170의 제거한 흰 flash는 재질·sprite UUID로 난수 8회를 썼다.
    // 강타의 texFlash도 UUID 8회와 회전 1회를 썼다. 표시 정리만으로 이후
    // 전투·드랍의 난수 진행을 바꾸지 않되 제거한 렌더 자원은 만들지 않는다.
    const retiredRandomDraws = 8 + ((tier === 'finisher' || particles > 5) && !this.lite ? 9 : 0);
    for (let i = 0; i < retiredRandomDraws; i++) Math.random();
    if (count > 0) this.directional(pos, dir, color, {
      n: this.lite ? Math.min(3, count) : count, speed: heavy ? 11 : 7,
      size: heavy ? .25 : .18, life: .18, spread: blunt ? .7 : slash ? .2 : .4,
    });
    if (light && !reduced) this.light(pos, color, 3.2, 3.5, .1);
    // 임팩트 프레임(코어·베기 자국/고리/별빛·불똥, 치명타 금빛 십자): 인스턴스 층이라 fx.items·불꽃 풀·난수를 건드리지 않는다.
    this.impact?.hit(pos, dir, { hero: this._heroId(), kind, tier, crit: !!crit, reduced });
    this._comboLayer(pos, dir, tier, reduced);
    return cue;
  }
  /**
   * A bounded, authored impact language for skills. It deliberately composes
   * the existing atlas/particle pool instead of allocating a new GPU system per
   * hit. The same elapsed-time FX scheduler handles pause, cleanup and mobile
   * quality reduction for every part of the signature.
   */
  abilitySignature(pos, profile = 'arcane', { scale = 1, life = 0.48, heavy = false } = {}) {
    const spec = ABILITY_VFX_PROFILES[profile] || ABILITY_VFX_PROFILES.arcane;
    const k = Math.max(0.35, Math.min(2.4, Number.isFinite(scale) ? scale : 1));
    const t = Math.max(0.18, Math.min(2.2, Number.isFinite(life) ? life : 0.48));
    const anchor = pos.clone();
    // 차가운 학파(서리·비전)의 옅은 하늘색 지면 원판은 가산으로 겹쳐 흰 원판이 됐다: 진한 청 groundColor 와 .8배 반경을 쓴다.
    const groundK = k * (spec.groundScale ?? 1);
    this.groundTex(anchor, spec.ground, spec.groundColor ?? spec.color, {
      r0: spec.radius * 0.18 * groundK,
      r1: spec.radius * groundK,
      life: t,
      spin: profile === 'void' ? -1.8 : profile === 'frost' ? 0.8 : 1.25,
      y: 0.075,
      fadeIn: 0.08,
      hold: heavy ? t * 0.24 : 0,
    });
    // 고리 띠 두께는 반지름에 비례해 6m 넘는 무거운 서명에서 흰 도넛이 됐다(눈보라·시간 봉인). 흰 강조색 대신 학파 색을 낮춰 쓴다.
    _sigRing.set(spec.color).multiplyScalar(heavy ? .5 : .75);
    this.ring(anchor, _sigRing, { r0: spec.radius * 0.22 * k, r1: spec.radius * 1.16 * k, life: Math.min(t, 0.56), width: heavy ? 0.72 : 0.48 });
    const flashSize = spec.radius * (heavy ? 1.45 : 1.05) * k;
    this.texFlash(anchor.clone().setY(anchor.y + 0.6), spec.flash, spec.color, {
      size: flashSize, gain: decorativeBurstGain(flashSize) * (spec.flashGain ?? 1),
      life: Math.min(t, heavy ? 0.7 : 0.42),
      spin: profile === 'void' ? 1.35 : profile === 'arcane' ? 0.7 : 0.35,
      grow: heavy ? 1.6 : 1.2,
      y: 0,
    });
    // A smaller secondary atlas cue gives each school a readable after-image
    // without allocating a new effect system. It remains enabled on lite
    // devices so the spell silhouette does not collapse to a coloured ring.
    this.texFlash(anchor.clone().setY(anchor.y + 0.32), spec.secondary, spec.accent, {
      size: spec.radius * (heavy ? 0.9 : 0.62) * k,
      life: Math.min(t, heavy ? 0.56 : 0.3),
      spin: profile === 'void' ? -1.1 : profile === 'arcane' ? 0.95 : -0.45,
      grow: heavy ? 1.25 : 0.9,
      y: 0,
    });
    this.burst(anchor.clone().setY(anchor.y + 0.55), spec.accent, {
      n: Math.round(spec.burst * (heavy ? 1.35 : 1)),
      speed: (heavy ? 13 : 8) * k,
      size: (heavy ? 0.42 : 0.28) * k,
      life: Math.min(t, heavy ? 0.72 : 0.42),
      up: heavy ? 1.1 : 0.55,
      grav: profile === 'frost' ? 5 : 13,
      spread: profile === 'void' ? 0.72 : 1,
    });
    if (spec.pillar && !this.lite) this.firePillar(anchor, { height: 4.2 * k, width: 1.05 * k, life: Math.min(t, 0.65), color: spec.color });
    if (profile === 'fire') this._fireImpact(anchor, k, heavy);
    this.light(anchor, spec.color, (heavy ? 10 : 5) * spec.light * k, (heavy ? 12 : 7) * k, Math.min(t, 0.45));
    return spec;
  }
  /** 화염 착탄 임팩트 층(인스턴스, 난수는 VfxRng): 진홍 폭발 고리 두 겹 + 방사형 불씨 파편 + 솟는 짧은 불꽃. Math.random·fx.items 를 건드리지 않는다. */
  _fireImpact(pos, k = 1, heavy = false) {
    const I = this.impact; if (!I) return 0;
    const before = I.spawned, rng = I.rng, y = (pos.y || 0) + .5;
    I._emit(IMPACT_KIND.ring, pos.x, y, pos.z, 3.4 * k, 0xd8261a, .34, { grow: 1 });
    I._emit(IMPACT_KIND.ring, pos.x, y, pos.z, 2.2 * k, 0xff6a1e, .26, { grow: 1, delay: .04 });
    if (this.lite) return I.spawned - before;
    for (let i = 0, n = heavy ? 10 : 7; i < n; i++) {
      const a = (i / n) * 6.2831853 + rng.next() * .5, sp = (7 + rng.next() * 5) * k;
      I._emit(IMPACT_KIND.shard, pos.x, y, pos.z, .26 * k, i % 2 ? 0xff8a26 : 0xe8341c, .42 + rng.next() * .14,
        { vx: Math.cos(a) * sp, vy: 3 + rng.next() * 4, vz: Math.sin(a) * sp, angle: rng.next() * 6.2831853, stretch: 1.8, grow: .8, gravity: 14 });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 6.2831853 + rng.next(), r = (.5 + rng.next() * .8) * k;
      I._emit(IMPACT_KIND.flame, pos.x + Math.cos(a) * r, .4, pos.z + Math.sin(a) * r, .5 * k, i % 2 ? 0xff8a26 : 0xff4a14, .5 + rng.next() * .15, { vy: 2, grow: .5, gravity: -6, delay: .03 * i });
    }
    return I.spawned - before;
  }
  dust(pos, { n = 10, color = 0x8a7a6a, size = 1.4, life = 0.9, speed = 2.5 } = {}) {
    const c = new THREE.Color(color); if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()); this.smoke.emit(pos.x, pos.y + 0.2, pos.z, Math.cos(a) * s, 0.6 + Math.random(), Math.sin(a) * s, c, size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6), { grav: -0.6, drag: 0.94, shrink: 1.8 }); }
  }
  embers(pos, color, { n = 8, radius = 1, life = 1.2, size = 0.22, rise = 2.5 } = {}) {
    const c = new THREE.Color(color); if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * radius; this.glow.emit(pos.x + Math.cos(a) * r, pos.y + Math.random() * 0.5, pos.z + Math.sin(a) * r, (Math.random() - 0.5) * 1.2, rise * (0.5 + Math.random()), (Math.random() - 0.5) * 1.2, c, size * (0.5 + Math.random()), life * (0.6 + Math.random() * 0.8), { grav: -1, drag: 0.97, shrink: 0.2 }); }
  }
  aura(pos, color, n = 3) { this.embers(pos, color, { n, radius: 0.8, life: 0.8, size: 0.3, rise: 2 }); }

  /** 처치 확정 섬광: 파티클 풀만 써서 드로우콜·메시·재질을 늘리지 않는다. 한 프레임 상한이 있어 군중 처치에도 일정하다. */
  killConfirm(pos) {
    if (!(this._killBudget > 0)) return;
    this._killBudget--;
    // 크게 터졌다 빠르게 사그라드는 따뜻한 섬광 한 점 + 방사형 불꽃 몇 점
    // 큰 크림색 구(3.4)는 적을 베이지 덩어리로 덮었다. 또렷한 처치 섬광은 impact.kill 이 맡고 여기서는 작은 잔광만 남긴다.
    // 크림색 잔광 구(1.6)는 처치마다 흰 구름으로 남았다. 영혼 불꽃·파편(impact.kill)이 신호를 맡으니 잔광은 작게(1.0).
    this.glow.emit(pos.x, pos.y + 1, pos.z, 0, 0.5, 0, KILL_COLOR, this.lite ? .8 : 1.0, 0.2, { grav: 0, drag: 0.9, shrink: 0.2 });
    const n = this.lite ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this._killBudget * 0.7, s = 7 + (i % 2) * 3;
      this.sparks.emit(pos.x, pos.y + 1, pos.z, Math.cos(a) * s, 2.5 + (i % 3), Math.sin(a) * s, KILL_COLOR, 0.34, 0.32, { grav: 14, shrink: 0.1 });
    }
  }

  /** 적 한 마리의 처치 파편 폭발(적 팔레트 색, 넉백 방향). 낸 파편 수를 돌려준다. */
  deathShatter(enemy, { reduced = false } = {}) {
    if (enemy?.pos) this.impact?.kill(enemy.pos, { elite: !!enemy.isElite, boss: !!enemy.isBoss, hero: this._heroId(), reduced });
    return this.vfx?.shatter(enemy, { reduced }) || 0;
  }
  /** 평타 연계 층: 조종 영웅이 평타 연계 중이면 휘두름 한 번당 한 번(첫 접촉점) 단계별 연계 연출을 낸다.
   *  판정·피해·난수와 무관하다(영웅 상태만 읽는다). 같은 연계 항목을 .25초 안에 다시 치면(다단 회전·군중) 건너뛴다. */
  _comboLayer(pos, dir, tier, reduced) {
    const t = this.focus?.target, combo = t?.def?.combo;
    if (!this.impact || !t?.alive || t.state !== 'attack' || !t.current || !combo?.length) return 0;
    const step = Math.max(0, combo.indexOf(t.current)); if (combo[step] !== t.current) return 0;
    const clock = this.impact.clock;
    if (this._comboSwing === t.current && clock >= this._comboSwingAt && clock - this._comboSwingAt < .25) return 0;
    this._comboSwing = t.current; this._comboSwingAt = clock;
    return this.impact.combo(pos, dir, { hero: t.def.id, step, steps: combo.length, finisher: !!t.current.finisher || tier === 'finisher', reduced });
  }
  /** 현재 조종 중인 영웅 id(타격 색 언어용). 초점 대상이 없으면 빈 값. */
  _heroId() { const t = this.focus?.target; return t?.alive ? (t.def?.id || '') : ''; }
  /** 묶음 처치 단계(0~3) 충격파 + 방사형 빛줄기. 기존 shockTex 링 자리를 대신한다(반지름은 FEEL.kill.multiSteps[].ring). */
  multiKillWave(pos, step, { reduced = false } = {}) { return !!this.vfx?.wave(pos, step, { reduced }); }

  // ---------- 스프라이트 플래시 ----------
  /** @param {THREE.Vector3} pos @param {THREE.ColorRepresentation} color
   * @param {{size?: number, life?: number, tex?: string, angle?: number|null, stretch?: number, contact?: boolean, telegraph?: boolean, stationary?: boolean}} [options]
   */
  flash(pos, color, { size = 2.2, life = 0.18, tex = 'spark', angle = null, stretch = 1, contact = false, telegraph = false, stationary = false } = {}) {
    const m = this._keep(new THREE.SpriteMaterial({ map: tex === 'spark' ? sparkTex() : tex === 'ring' ? ringTex() : softCircleTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1 }), { telegraph });
    const initial = stationary ? size : size * (contact ? .6 : .3);
    const s = new THREE.Sprite(m); s.position.copy(pos); s.scale.set(initial * stretch, initial / stretch, 1); s.material.rotation = angle ?? Math.random() * Math.PI; s.renderOrder = 11;
    this.add(s, life, (k) => {
      const radius = size * (stationary ? 1 : contact ? .6 + .4 * Math.min(1, k / .18) : .3 + k * 1.2);
      s.scale.set(radius*stretch,radius/stretch,1); m.opacity = contact ? (1-k)**1.7 : 1-k;
    }, () => m.dispose());
    return s;
  }
  // ---------- 지면 충격파 링 ----------
  ring(pos, color, { r0 = 0.3, r1 = 4, life = 0.45, width = 0.5, y = 0.08, vertical = false, thick = 1, telegraph = false } = {}) {
    // 평면 링은 양면을 한 번에 그린다. 준비 단계에도 같은 패스 설정을 전달한다.
    const m = this._keep(new THREE.MeshBasicMaterial({ map: ringTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, opacity: 1 }), { telegraph });
    if (!telegraph && !vertical) vividDecalColor(color, m.color);
    const mesh = new THREE.Mesh(this.plane2, m); mesh.position.copy(pos); mesh.position.y += y; mesh.renderOrder = 9;
    if (vertical) mesh.lookAt(this.camera.position); else mesh.rotation.x = -Math.PI / 2;
    if (telegraph && !vertical) {
      // 적 예고 고리: 위험 경계는 r1 에 고정하고(예전처럼 사그라들지 않는다), 안쪽 채움이 타격 시점까지 차오른다.
      const fill = this._telegraphFill(this._diskGeometry(), color); fill.scale.setScalar(.001); mesh.add(fill);
      mesh.scale.set(r1, r1, r1 * thick);
      return this.add(mesh, life, (k) => { m.opacity = .55 + .45 * k; this._growTelegraphFill(fill, k, .97); }, () => { m.dispose(); fill.material.dispose(); });
    }
    this.add(mesh, life, (k) => { const e = 1 - Math.pow(1 - k, 3); const r = r0 + (r1 - r0) * e; mesh.scale.set(r, r, r * thick); m.opacity = (1 - k) * 1.2; }, () => m.dispose());
  }
  // ---------- 참격 아크 (지면 평행, 캐릭터 전방) ----------
  slashArc(pos, yaw, color, { radius = 2.4, arc = 140, life = 0.22, height = 1.1, tilt = 0, flip = false, thickness = 0.55, telegraph = false } = {}) {
    const a = THREE.MathUtils.degToRad(arc);
    const geo = new THREE.RingGeometry(radius * (1 - thickness), radius, 24, 1, -a / 2, a);
    // uv: u 를 각도 방향으로
    const uv = geo.attributes.uv; const p = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) { const x = p.getX(i), y = p.getY(i); const ang = Math.atan2(y, x); const rr = Math.hypot(x, y); uv.setXY(i, (ang + a / 2) / a, (rr - radius * (1 - thickness)) / (radius * thickness)); }
    const m = this._keep(new THREE.MeshBasicMaterial({ map: slashTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, opacity: 1 }), { telegraph });
    const mesh = new THREE.Mesh(geo, m); mesh.userData.ownGeo = true; mesh.renderOrder = 12;
    mesh.position.copy(pos); mesh.position.y += height;
    mesh.rotation.order = 'YXZ'; mesh.rotation.y = yaw - Math.PI / 2 + (flip ? 0 : 0); mesh.rotation.x = -Math.PI / 2 + tilt * (flip ? -1 : 1);
    const dir = flip ? -1 : 1;
    // 공격 범위를 읽는 예고는 판정까지 같은 크기·방향을 유지한다. 안쪽 채움이 적에게서 바깥으로 차올라 남은 시간을 보여 준다.
    if (telegraph) {
      const fill = this._telegraphFill(geo, color); fill.scale.setScalar(.001); mesh.add(fill);
      return this.add(mesh, life, (k) => { m.opacity = .8 + .2 * k; this._growTelegraphFill(fill, k, 1); }, () => { m.dispose(); fill.material.dispose(); });
    }
    const update = (k) => { const e = 1 - Math.pow(1 - k, 2); mesh.scale.setScalar(0.7 + e * 0.6); m.opacity = 1 - e; mesh.rotation.z = dir * (e - 0.5) * 0.9; };
    this.add(mesh, life, update, () => m.dispose());
  }
  /** 예고 채움: 같은 색의 일반 블렌딩 면(가산이 아니라 밝은 바닥에서도 붉게 읽힌다). 부모 예고 메시의 자식으로 붙는다. */
  _telegraphFill(geometry, color) {
    const m = this._keep(new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, opacity: 0 }), { telegraph: true });
    const fill = new THREE.Mesh(geometry, m); fill.renderOrder = 8; fill.position.z = .004;
    return fill;
  }
  /** 남은 시간 k(0→1)만큼 채움을 키운다. 끝 0.15 구간은 진하게 맥동해 '곧 맞는다'를 알린다. */
  _growTelegraphFill(fill, k, reach) {
    const e = Math.max(.02, Math.min(1, k)) * reach;
    fill.scale.set(e, e, 1);
    fill.material.opacity = .16 + .26 * k * k + (k > .85 ? .14 * Math.sin((k - .85) / .15 * Math.PI) : 0);
  }
  _diskGeometry() { return this._disk || (this._disk = new THREE.CircleGeometry(1, 40)); }
  // ---------- 검격 파동 (수직 초승달, 이동) ----------
  crescent(pos, dir, color, { size = 1.8, life = 0.5, speed = 0, tilt = -0.75 } = {}) {
    const geo = new THREE.RingGeometry(size * 0.55, size, 32, 1, Math.PI * 0.2, Math.PI * 0.6);
    const uv = geo.attributes.uv; const p = geo.attributes.position; const a0 = Math.PI * 0.2, a = Math.PI * 0.6;
    for (let i = 0; i < uv.count; i++) { const x = p.getX(i), y = p.getY(i); const ang = Math.atan2(y, x); uv.setXY(i, (ang - a0) / a, (Math.hypot(x, y) - size * 0.55) / (size * 0.45)); }
    const m = this._keep(new THREE.MeshBasicMaterial({ map: slashTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
    const mesh = new THREE.Mesh(geo, m); mesh.userData.ownGeo = true; mesh.renderOrder = 12; mesh.position.copy(pos);
    const d = dir.clone().normalize();
    // 진행 방향에 수직인 평면(로컬 +Z = 진행 방향) + 카메라 쪽으로 기울임
    mesh.lookAt(pos.clone().add(d)); mesh.rotateX(tilt);
    this.add(mesh, life, (k, t, dt) => { mesh.position.addScaledVector(d, speed * dt); m.opacity = k < 0.7 ? 1 : (1 - k) / 0.3; const sc = 1 + k * 0.5; mesh.scale.set(sc, sc, 1); }, () => m.dispose());
    return mesh;
  }
  // ---------- 빛의 기둥 ----------
  pillar(pos, color, { radius = 0.9, height = 9, life = 0.6, delay = 0 } = {}) {
    const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 16, 1, true);
    const m = this._keep(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.1, vUv.y); float edge = pow(abs(sin(vUv.x * 6.283 * 4.0 + uK * 6.0)), 3.0) * 0.5 + 0.5; a *= edge * (1.0 - uK) * 0.42; gl_FragColor = vec4(uColor, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(geo, m); mesh.userData.ownGeo = true; mesh.position.copy(pos); mesh.position.y += height / 2; mesh.scale.set(0.1, 1, 0.1); mesh.renderOrder = 8;
    this.add(mesh, life + delay, (k, t) => { const kk = Math.max(0, (t - delay) / life); mesh.visible = t >= delay; const s = kk < 0.2 ? kk / 0.2 : 1 - (kk - 0.2) / 0.8 * 0.6; mesh.scale.set(s, 1, s); m.uniforms.uK.value = kk; }, () => m.dispose());
  }
  // ---------- 번개 ----------
  lightning(from, to, color = 0x9ad8ff, { life = 0.28, width = 0.16, segs = 12, jitter = 0.7, branches = 2 } = {}) {
    const group = new THREE.Group();
    const m = this._keep(new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    const build = () => {
      while (group.children.length) { const c = group.children.pop(); c.geometry.dispose(); }
      const mk = (a, b, w, n) => {
        const pts = [a.clone()]; const d = b.clone().sub(a); const len = d.length(); const perp = new THREE.Vector3(-d.z, 0, d.x).normalize();
        for (let i = 1; i < n; i++) { const t = i / n; const p = a.clone().addScaledVector(d, t); p.addScaledVector(perp, (Math.random() - 0.5) * jitter * len * 0.25); p.y += (Math.random() - 0.5) * jitter * len * 0.2; pts.push(p); }
        pts.push(b.clone());
        const pos = []; const camDir = this.camera.position.clone().sub(a).normalize();
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i], p1 = pts[i + 1]; const seg = p1.clone().sub(p0); const side = seg.clone().cross(camDir).normalize().multiplyScalar(w * (1 - i / pts.length * 0.5));
          const A = p0.clone().add(side), B = p0.clone().sub(side), C = p1.clone().add(side), D = p1.clone().sub(side);
          pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, B.x, B.y, B.z, D.x, D.y, D.z, C.x, C.y, C.z);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 13; group.add(mesh);
        return pts;
      };
      const pts = mk(from, to, width, segs);
      for (let b = 0; b < branches; b++) { const i = 1 + Math.floor(Math.random() * (pts.length - 2)); const p = pts[i]; const end = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -1 - Math.random() * 2, (Math.random() - 0.5) * 3)); mk(p, end, width * 0.5, 5); }
    };
    build(); let acc = 0;
    this.add(group, life, (k, t, dt) => { acc += dt; if (acc > 0.05) { acc = 0; build(); } m.opacity = 1 - k * k; }, () => { m.dispose(); group.children.forEach((c) => c.geometry.dispose()); });
  }
  // ---------- 발광 구체 (투사체 본체) ----------
  orb(color, size = 0.4) {
    const g = new THREE.Group();
    // 탄 심은 순백 대신 탄 색을 45% 밝힌 색: 하얀 구가 후광과 겹쳐 대마도사 평타·처치마다 흰 거품으로 보였다.
    const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 12, 10), this._keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(_orbWhite, .45) })));
    const halo = new THREE.Sprite(this._keep(new THREE.SpriteMaterial({ map: softCircleTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))); halo.scale.setScalar(Math.min(size * 4, 2.6));   // 큰 탄(화염구 .9)의 3.6m 가산 후광은 블룸과 겹쳐 크림색 덩어리였다
    g.add(core, halo); g.userData.halo = halo; g.userData.core = core; return g;
  }
  // ---------- 그을음 데칼 ----------
  scorch(pos, { radius = 2, life = 4, color = 0x000000 } = {}) {
    if (this.lite) return;
    const m = this._keep(new THREE.MeshBasicMaterial({ map: softCircleTex(), color, transparent: true, depthWrite: false, opacity: 0.7 }));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), m); mesh.userData.ownGeo = true; mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos); mesh.position.y = 0.04; mesh.renderOrder = 1;
    this.add(mesh, life, (k) => { m.opacity = 0.7 * (1 - k); }, () => m.dispose());
  }
  // ---------- 무기 트레일 (리본) ----------
  _trailMaterial(color) {
    // 셰이더 준비본만 보관하며 자산 캐시가 소유하는 텍스처를 복제하지 않는다.
    this._mat('weaponTrail', () => createWeaponTrailMaterial(slashTex(), color));
    return this.focus.bind(createWeaponTrailMaterial(slashTex(), color));
  }
  trail(getPoints, color, options = {}) {
    // 연계 단계가 오를수록 궤적이 길게 남고 넓어진다(마지막 타 = 1.4배 수명). 판정 시간·게인 곡선은 그대로다.
    const t = this.focus?.target, combo = t?.def?.combo, step = combo?.length > 1 && t.current ? combo.indexOf(t.current) : -1;
    if (step > 0) {
      const s = step / (combo.length - 1);
      options = { ...options, life: (options.life ?? .24) * (1 + .4 * s), width: Math.min(1, (options.width ?? 1) * (1 + .14 * s)) };
    }
    const tr = new WeaponTrail(getPoints, this._trailMaterial(color), options);
    this.scene.add(tr.mesh); this.trails.push(tr); return tr;
  }
  // ---------- 잔상 (스킨드 메시 스냅샷) ----------
  ghost(root, color, { life = 0.45, opacity = 0.7, at = null } = {}) {
    if (this.lite) return;
    const parts = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const src = o.geometry; const cnt = src.attributes.position.count; const arr = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { o.getVertexPosition(i, _v); _v.applyMatrix4(o.matrixWorld); arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); if (src.index) g.setIndex(src.index.clone());
      parts.push(g);
    });
    if (!parts.length) return;
    const m = this._keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    const grp = new THREE.Group(); for (const g of parts) { const mm = new THREE.Mesh(g, m); mm.userData.ownGeo = true; grp.add(mm); }
    if (at) { root.getWorldPosition(_v); grp.position.set(at.x - _v.x, 0, at.z - _v.z); }   // 분신: 지오메트리가 월드 좌표로 구워져 있어 그룹 오프셋으로 옮긴다
    this.add(grp, life, (k) => { m.opacity = opacity * (1 - k); }, () => m.dispose());
  }
  // ========== GPT 생성 VFX 텍스처 기반 이펙트 ==========
  // This factory is used only by flat ground/cast/bolt/slash/shock planes. The back-face
  // pass cannot contribute visible pixels, so retain both sides in one draw.
  _addMat(tex, color, { blending = THREE.AdditiveBlending, telegraph = false } = {}) { return this._keep(new THREE.MeshBasicMaterial({ map: tex, color, blending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, opacity: 1 }), { telegraph }); }
  /** 카메라를 향하는 텍스처 플래시 (holy_burst, ice, shockwave 등) */
  texFlash(pos, name, color = 0xffffff, { size = 3, life = 0.35, spin = 0, grow = 1.3, y = 1, gain = 1 } = {}) {
    size = texFlashFitSize(size, grow);
    const tex = VFX_TEX[name]; if (!tex) return this.flash(pos, color, { size, life });
    const m = this._keep(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, rotation: Math.random() * Math.PI * 2 }));
    m.color.multiplyScalar(boundedFeedbackGain(gain) * this._exposureGain(size));
    const sp = new THREE.Sprite(m); sp.position.copy(pos); sp.position.y += y; sp.scale.setScalar(size * 0.4); sp.renderOrder = 11;
    this.add(sp, life, (k, t, dt) => { const e = 1 - Math.pow(1 - k, 2); sp.scale.setScalar(size * (0.4 + e * grow)); m.opacity = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75; m.rotation += spin * dt; }, () => m.dispose());
    return sp;
  }
  /** 지면 텍스처 (마법진 / 충격파 링). 회전·확대·페이드
   * @param {THREE.Vector3} pos
   * @param {string} name
   * @param {THREE.ColorRepresentation} [color]
   * @param {{r0?: number, r1?: number, life?: number, spin?: number, y?: number, fadeIn?: number, hold?: number, telegraph?: boolean, gain?: number}} [options]
   */
  groundTex(pos, name, color = 0xffffff, { r0 = 0.2, r1 = 4, life = 0.5, spin = 1, y = 0.06, fadeIn = 0.15, hold = 0, telegraph = false, gain = 1 } = {}) {
    // 적의 실제 예고와 일반 마법진은 원래 밝기를 유지한다. 장식 호출만 RGB를 제한한다.
    const intensity = telegraph ? 1 : boundedFeedbackGain(gain) * this._exposureGain(r1 * 2, FX_EXPOSURE.groundWeight);
    if (!VFX_TEX[name]) {
      // 폴백 고리도 같은 색 규칙 → 밝기 순서다(고리가 받은 색은 이미 진하므로 다시 바뀌지 않는다).
      const c = telegraph ? color : vividDecalColor(color, new THREE.Color());
      return this.ring(pos, intensity < 1 ? new THREE.Color(c).multiplyScalar(intensity) : c, { r0, r1, life, y, telegraph });
    }
    const tex = VFX_TEX[name];
    const m = this._addMat(tex, color, { telegraph });
    if (!telegraph) vividDecalColor(color, m.color);
    m.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(this.plane2, m); mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos); mesh.position.y = y; mesh.renderOrder = 8;
    this.add(mesh, life, (k, t, dt) => { const e = 1 - Math.pow(1 - k, 3); const r = r0 + (r1 - r0) * e; mesh.scale.set(r, r, 1); mesh.rotation.z += spin * dt; m.opacity = k < fadeIn ? k / fadeIn : (hold > 0 ? (k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35) : 1 - (k - fadeIn) / (1 - fadeIn)); }, () => m.dispose());
    return mesh;
  }
  /** 아군 화살 궤적(인스턴스 층, 드로우콜 0 추가). 명중 정지용 표를 돌려준다. */
  arrowStreak(pos, dir, speed, life, style) { return this.impact?.arrowStreak(pos, dir, speed, life, style) ?? null; }
  /** 지속 영역(성역): 얇은 경계 원 + 차례로 솟는 가는 빛기둥. 드로우콜 2. 낮은 화질은 기둥을 반으로 줄인다. */
  sanctum(pos, { radius = 8, life = 7, color = 0xffc845 } = {}) {
    return spawnSanctum(this, pos, { radius, life, color, pillars: this.lite ? 4 : 8, gain: this._exposureGain(radius * 2, FX_EXPOSURE.groundWeight) });
  }
  /** 시전 마법진: 캐스터 아래에서 회전, 커졌다가 사라짐 */
  castCircle(pos, color = 0xffd060, { radius = 2.4, life = 0.9, demon = false, telegraph = false } = {}) {
    return this.groundTex(pos, demon ? 'circle_demon' : 'circle_gold', color, { r0: radius * 0.4, r1: radius, life, spin: 1.6, y: 0.07, fadeIn: 0.2, hold: 0.35, telegraph });
  }
  /** 플립북 (explosion / dust 4x4 아틀라스) — 빌보드 셰이더 */
  flipbook(pos, name, { size = 3, life = 0.6, color = 0xffffff, cols = 4, rows = 4, y = 1, blending = THREE.AdditiveBlending, opacity = 1, gain = 1 } = {}) {
    const tex = VFX_TEX[name]; if (!tex) return this.burst(pos, color, { n: 20 });
    const m = this._keep(new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uFrame: { value: 0 }, uGrid: { value: new THREE.Vector2(cols, rows) }, uColor: { value: new THREE.Color(color).multiplyScalar(boundedFeedbackGain(gain) * this._exposureGain(size)) }, uScale: { value: size }, uAlpha: { value: opacity }, uTint: { value: blending === THREE.AdditiveBlending ? textureTintMix(color) : 0 } },
      vertexShader: FLIPBOOK_VERT, fragmentShader: FLIPBOOK_FRAG,
      transparent: true, depthWrite: false, blending, side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(this.plane1, m); mesh.position.copy(pos); mesh.position.y += y; mesh.renderOrder = 12; mesh.frustumCulled = false;
    const frames = cols * rows;
    this.add(mesh, life, (k) => { m.uniforms.uFrame.value = Math.min(frames - 1, k * frames); m.uniforms.uAlpha.value = opacity * (k > 0.85 ? (1 - k) / 0.15 : 1); }, () => m.dispose());
    return mesh;
  }
  explosion(pos, { size = 4, color = 0xffffff, life = 0.55, opacity = 1 } = {}) { this.flipbook(pos, 'explosion', { size, life, color, y: size * 0.35, opacity, gain: decorativeBurstGain(size) }); }
  // 먼지는 발밑에 낮게 깔린 옅은 흙빛이다. 예전(높이 0.3×크기, 불투명도 .75)은 처치·강타 순간 적 몸을 베이지 덩어리로 덮었다.
  // 먼지는 흙빛 낮은 구름이다. 밝은 황토(0x8f826f, 불투명 .42)는 처치마다 적 위에 크림색 덩어리로 보였다(군중 처치 6개).
  dustPuff(pos, { size = 3, life = 0.9, color = DUST_COLOR } = {}) { this.flipbook(pos, 'dust', { size, life, color, y: size * 0.16, blending: THREE.NormalBlending, opacity: DUST_OPACITY }); }
  /** 화염 기둥: 교차 2장 + UV 스크롤 */
  _fireMaterial(tex, color) {
    const make = () => {
      // Retain MeshBasic's alpha, fog and output transforms; only scrolling differs.
      const uniforms = THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms);
      uniforms.map.value = tex; uniforms.diffuse.value.set(color); uniforms.uOffset = { value: 0 }; uniforms.uTint = { value: textureTintMix(color) };
      return new THREE.ShaderMaterial({
        uniforms, defines: { USE_MAP: '', MAP_UV: 'uv' },
        vertexShader: THREE.ShaderLib.basic.vertexShader,
        fragmentShader: 'uniform float uOffset, uTint;\n' + TINT_GLSL + THREE.ShaderLib.basic.fragmentShader.replace('#include <map_fragment>',
          // The authored flame is not vertically tileable. A traveling distortion
          // flows upward while anchoring all four edges, keeping its base and tip.
          THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )',
            'texture2D( map, vMapUv + vec2( sin( vMapUv.y * 16.0 + uOffset * 6.283185 ) * 0.022, sin( vMapUv.y * 12.0 + uOffset * 6.283185 ) * 0.035 ) * sin( vMapUv.y * 3.141593 ) * sin( vMapUv.x * 3.141593 ) )')
            + '\n\tdiffuseColor.rgb = bsTint( diffuseColor.rgb / max( diffuse, vec3( .001 ) ), uTint ) * diffuse;'),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
      });
    };
    // _keep clones texture uniforms. This program keeps the asset itself shared.
    this._mat('firePillar', make);
    return this.focus.bind(make());
  }
  firePillar(pos, { height = 6, width = 2.2, life = 0.8, color = 0xffb060 } = {}) {
    const tex = VFX_TEX.fire_pillar; if (!tex) return this.pillar(pos, color, { radius: width / 2, height, life });
    const g = new THREE.Group(); g.position.copy(pos); g.renderOrder = 12;
    const m = this._fireMaterial(tex, color);
    for (let i = 0; i < 2; i++) { const p = new THREE.Mesh(this.plane1, m); p.scale.set(width, height, 1); p.position.y = height / 2; p.rotation.y = i * Math.PI / 2; g.add(p); }
    return this.add(g, life, (k, t) => { const s = k < 0.15 ? k / 0.15 : 1; g.scale.set(s, k < 0.15 ? k / 0.15 : 1 + k * 0.1, s); m.uniforms.uOffset.value = -t * 1.6; m.uniforms.opacity.value = k > 0.6 ? (1 - k) / 0.4 : 1; }, () => m.dispose());
  }
  /** 텍스처 번개: 두 점 사이 빌보드 스트립 */
  boltTex(from, to, color = 0x9ad8ff, { width = 1.6, life = 0.25 } = {}) {
    const tex = VFX_TEX.lightning; if (!tex) return this.lightning(from, to, color, { life });
    const d = to.clone().sub(from); const len = d.length(); const mid = from.clone().add(to).multiplyScalar(0.5);
    const m = this._addMat(tex, color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, len), m); mesh.userData.ownGeo = true; mesh.position.copy(mid); mesh.renderOrder = 13;
    // 로컬 +Y 를 d 방향으로, 평면 법선은 카메라 쪽으로
    const up = d.clone().normalize(); const toCam = this.camera.position.clone().sub(mid).normalize(); const right = new THREE.Vector3().crossVectors(up, toCam).normalize(); const normal = new THREE.Vector3().crossVectors(right, up);
    const basis = new THREE.Matrix4().makeBasis(right, up, normal); mesh.quaternion.setFromRotationMatrix(basis);
    let acc = 0; this.add(mesh, life, (k, t, dt) => { acc += dt; if (acc > 0.05) { acc = 0; mesh.scale.x = 0.7 + Math.random() * 0.6; m.map = tex; } m.opacity = 1 - k * k; }, () => m.dispose());
  }
  /** 텍스처 참격 (slash.webp) — 진행방향에 수직, 이동 */
  slashSprite(pos, dir, color = 0xfff0a0, { size = 3, life = 0.5, speed = 0, tilt = -0.6, flip = false } = {}) {
    const tex = VFX_TEX.slash; if (!tex) return this.crescent(pos, dir, color, { size, life, speed, tilt });
    const m = this._addMat(tex, color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m); mesh.userData.ownGeo = true; mesh.position.copy(pos); mesh.renderOrder = 12;
    const d = dir.clone().normalize(); mesh.lookAt(pos.clone().add(d)); mesh.rotateX(tilt); if (flip) mesh.rotateZ(Math.PI);
    this.add(mesh, life, (k, t, dt) => { mesh.position.addScaledVector(d, speed * dt); m.opacity = k < 0.6 ? 1 : (1 - k) / 0.4; const sc = 1 + k * 0.6; mesh.scale.set(sc, sc, 1); }, () => m.dispose());
    return mesh;
  }
  /** 얼음 결정 폭발 */
  // 얼음 결정 원화는 중심이 거의 흰색이라 진한 하늘색으로 칠한다(옅은 0xc0f0ff 는 가산으로 흰 덩어리가 됐다).
  iceBurst(pos, { size = 3, life = 0.5, color = 0x6cc8ff } = {}) { this.texFlash(pos, 'ice', color, { size, life, spin: 0.5, grow: 1.0, y: 0.6, gain: .8 }); }
  holyBurst(pos, { size = 6, life = 0.4, color = 0xfff0c0 } = {}) { this.texFlash(pos, 'holy_burst', color, { size, life, spin: 1.2, grow: 1.6, y: 1.2, gain: decorativeBurstGain(size) }); }
  /** @param {THREE.Vector3} pos
   * @param {THREE.ColorRepresentation} [color]
   * @param {{r1?: number, life?: number}} [options]
   */
  shockTex(pos, color = 0xffe080, { r1 = 6, life = 0.45 } = {}) { this.groundTex(pos, 'shockwave', color, { r0: 0.5, r1, life, spin: 0.4, y: 0.1, fadeIn: 0.05, gain: decorativeBurstGain(r1) }); }

  // ---------- 데미지 숫자 ----------
  _damageRandom() {
    // 화면 표시·animationend 수명이 전투와 보상의 전역 난수 순서를 바꾸지 않는다.
    this._damageRandomState = (Math.imul(this._damageRandomState, 1664525) + 1013904223) >>> 0;
    return this._damageRandomState / 4294967296;
  }
  setCombatTextRegions(regions, layerBounds = null) {
    this._combatTextViewport = combatTextViewport(layerBounds);
    this._combatTextRegions = combatTextRegions(regions, this._combatTextViewport);
  }
  damage(worldPos, value, { crit = false, kind = '', text = null, finisher = false, boss = false, heavy = false } = {}) {
    const el = this.dmgPool.length ? this.dmgPool.pop() : document.createElement('div');
    if (el._dmgDone) { el.removeEventListener('animationend', el._dmgDone); el._dmgDone = null; }
    if (this.dmgLayer.children.length >= this.maxDmg) {
      const old = this.dmgLayer.firstChild;
      if (old) {
        if (old._dmgDone) { old.removeEventListener('animationend', old._dmgDone); old._dmgDone = null; }
        this.dmgLayer.removeChild(old); this.dmgPool.push(old);
      }
    }
    const status = text !== null;
    const compact = status ? compactCombatStatus(text) : null;
    const classes = ['dmg'];
    if (crit) classes.push('crit');
    if (kind) classes.push(kind);
    if (finisher) classes.push('finisher');
    else if (boss) classes.push('boss');
    else if (heavy) classes.push('heavy');
    if (status) classes.push('status');
    if (compact) classes.push('compact-status');
    el.className = classes.join(' ');
    el.textContent = compact?.label ?? text ?? (crit ? `${Math.round(value)}!` : Math.round(value));
    if (compact) el.dataset.combatStatus = compact.key;
    else delete el.dataset.combatStatus;
    const tag = status ? '' : finisher ? 'FINISH' : crit ? 'CRIT' : boss ? 'BOSS' : kind === 'skill' ? 'SKILL' : heavy ? 'HEAVY' : '';
    el.dataset.tag = tag;
    el.setAttribute('aria-hidden', 'true');
    const vw = Math.max(1, window.innerWidth || 1), vh = Math.max(1, window.innerHeight || 1);
    _v.copy(worldPos); _v.y += 1.9 + this._damageRandom() * 0.5; _v.x += (this._damageRandom() - 0.5) * 0.8; _v.project(this.camera);
    const projectedX = (_v.x * 0.5 + 0.5) * vw, projectedY = (-_v.y * 0.5 + 0.5) * vh;
    const portrait = vh > vw;
    const safeTop = portrait ? Math.min(170, vh * 0.24) : Math.min(104, vh * 0.18);
    const safeBottom = portrait ? Math.min(320, vh * 0.28) : Math.min(126, vh * 0.2);
    const x = Math.max(26, Math.min(vw - 26, projectedX));
    const y = Math.max(safeTop, Math.min(vh - safeBottom, projectedY));
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this._damageRecent = this._damageRecent.filter((entry) => now - entry.t < 620);
    const patterns = [[0, 0], [-22, -8], [22, -18], [-30, 16], [30, 10], [0, -26]];
    let offset = patterns[this._damageSerial++ % patterns.length];
    for (const candidate of patterns) {
      const crowded = this._damageRecent.some((entry) => Math.hypot(entry.x - (x + candidate[0]), entry.y - (y + candidate[1])) < 36);
      if (!crowded) { offset = candidate; break; }
    }
    let placedX = Math.max(24, Math.min(vw - 24, x + offset[0]));
    let placedY = Math.max(safeTop, Math.min(vh - safeBottom, y + offset[1]));
    const lift = finisher ? -112 : crit ? -92 : heavy || boss ? -78 : kind === 'heal' ? -58 : -68;
    let bounds;
    if (compact) {
      const view = this._combatTextViewport;
      const textWidth = view?.width || vw, textHeight = view?.height || vh;
      const target = this.focus?.target;
      const hero = target?.alive && !target.dead && !target.disposed
        ? heroCombatTextRegion(this.focus.area.value, textWidth, textHeight) : null;
      // 새 상태어만 실제 표시 영역의 로컬 좌표로 투영한다. 숫자의 기존 배치는 유지한다.
      const placement = placeCombatStatus({
        x: view ? (_v.x * .5 + .5) * textWidth + offset[0] * 2 : placedX + offset[0],
        y: view ? (-_v.y * .5 + .5) * textHeight + offset[1] : placedY,
        label: compact.label, lift, width: textWidth, height: textHeight,
        hero, regions: this._combatTextRegions || [], recent: this._damageRecent,
      });
      // 기존 CSS 이동을 유지한다. 실제 중심에는 이미 --dmg-x가 포함돼 있다.
      placedX = placement.x - offset[0]; placedY = placement.y; bounds = placement.bounds;
    }
    this._damageRecent.push({ x: placedX, y: placedY, t: now, ...(bounds ? { bounds } : {}) });
    el.style.left = placedX + 'px'; el.style.top = placedY + 'px';
    el.style.setProperty('--dmg-x', offset[0] + 'px');
    el.style.setProperty('--dmg-lift', lift + 'px');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    this.dmgLayer.appendChild(el);
    const done = () => { if (el.parentNode) el.parentNode.removeChild(el); this.dmgPool.push(el); el.removeEventListener('animationend', done); el._dmgDone = null; };
    el._dmgDone = done;
    el.addEventListener('animationend', done);
  }
  clearDamage() { while (this.dmgLayer.firstChild) this.dmgLayer.removeChild(this.dmgLayer.firstChild); }
  clearAll() {
    while (this.items.length) this._finishItem(this.items.length - 1);
    this.impactLights.clear();
    for (const t of this.trails) { this.scene.remove(t.mesh); t.dispose(); }
    this.trails.length = 0;
    for (const pool of [this.sparks, this.glow, this.smoke]) { pool.n = 0; pool.geo.setDrawRange(0, 0); }
    this._exposure = 0;
    this.vfx?.clear(); this.impact?.clear();
    this.clearDamage();
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this.clearAll();
    for (const pool of [this.sparks, this.glow, this.smoke]) { this.scene.remove(pool.mesh); pool.geo.dispose(); pool.mat.dispose(); }
    this.vfx?.dispose(); this.impact?.dispose();
    for (const slot of this.impactLights.slots) this.scene.remove(slot.light);
    this.plane1.dispose(); this.plane2.dispose(); this._disk?.dispose();
    for (const material of new Set([...Object.values(this._mats), ...this._transparentMats.values(), ...this._depthMats.values()])) material.dispose();
    this._mats = {}; this._transparentMats.clear(); this._depthMats.clear();
    // Asset and particle textures belong to the shared asset cache.
  }
}
