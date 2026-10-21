import * as THREE from 'three';
import { InstanceRing, VfxRng } from './combat-vfx.js';

// 타격·치명타·처치 순간의 '임팩트 프레임' 층. 인스턴스 메시 한 장(드로우콜 1)에 다섯 가지 모양을 셰이더로 그린다.
//  0 코어 섬광(하얗게 달아오른 중심 + 영웅색 테), 1 불똥 줄기(속도 방향으로 늘어남), 2 별빛 섬광(치명타 십자 광채),
//  3 충격 고리(얇게 퍼지는 원), 4 베기 자국(날 방향 초승달이 한쪽에서 그어지며 나타남).
// CPU 는 낼 때만 칸을 쓰고, 프레임마다 하는 일은 시계(uTime) 갱신뿐이다. 시계는 FX.update 의 sim dt 라
// 히트스톱 동안 섬광이 그 자리에 '정지 화면'으로 남는다. 난수는 전투 난수와 분리된 VfxRng 만 쓴다(Math.random 미사용).

export const IMPACT_KIND = Object.freeze({ core: 0, streak: 1, star: 2, ring: 3, cut: 4 });

/** 영웅별 타격 색 언어: core = 달아오른 중심, accent = 불똥·고리·자국. 기본 공격·스킬 모두 같은 색 계열을 쓴다. */
export const HERO_IMPACT_PALETTE = Object.freeze({
  knight: Object.freeze({ core: 0xfff4cc, accent: 0xffc23a }),
  barbarian: Object.freeze({ core: 0xffe0b8, accent: 0xff5a1e }),
  mage: Object.freeze({ core: 0xe6f6ff, accent: 0x5aa8ff }),
  rogue: Object.freeze({ core: 0xf6e6ff, accent: 0xb466ff }),
  ranger: Object.freeze({ core: 0xeafff2, accent: 0x3fe0a0 }),
  default: Object.freeze({ core: 0xfff0d0, accent: 0xffc870 }),
});
const CRIT_COLOR = 0xffd23a, CRIT_HOT = 0xfff6d0, KILL_COLOR = 0xffe2a0;

/** 등급별 접촉 강도. 크기는 m, 수명은 초. 고리는 무거운 타격·둔기에서만. */
export const IMPACT_TIERS = Object.freeze({
  light: Object.freeze({ core: .7, coreLife: .09, cut: 1.45, ring: 1.1, streaks: 4, speed: 9, streakLife: .17 }),
  heavy: Object.freeze({ core: .95, coreLife: .11, cut: 1.95, ring: 1.6, streaks: 6, speed: 11.5, streakLife: .2 }),
  finisher: Object.freeze({ core: 1.1, coreLife: .13, cut: 2.35, ring: 2.0, streaks: 8, speed: 13, streakLife: .22 }),
  counter: Object.freeze({ core: 1.05, coreLife: .12, cut: 2.2, ring: 1.9, streaks: 8, speed: 12.5, streakLife: .22 }),
  boss: Object.freeze({ core: 1.0, coreLife: .11, cut: 2.1, ring: 1.8, streaks: 6, speed: 11.5, streakLife: .2 }),
});
export const IMPACT_CAPACITY = 384;
/** 한 프레임에 새로 낼 수 있는 칸 상한(군중 동시 타격에도 업로드·채움 비용이 일정하다). */
export const IMPACT_FRAME_BUDGET = 72;

const VERT = `
  attribute vec3 aOrigin; attribute vec3 aVel; attribute vec4 aShape; attribute vec3 aColor; attribute vec2 aLife; attribute vec2 aMotion;
  uniform float uTime;
  varying vec2 vUv; varying vec3 vColor; varying float vK; varying float vKind;
  void main() {
    float t = uTime - aLife.x;
    float k = t / max(aLife.y, 0.001);
    vUv = position.xy * 2.0; vColor = aColor; vK = k; vKind = aShape.x;
    if (t < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float kind = aShape.x;
    // 줄기만 감속·중력으로 움직이고, 나머지는 접촉점에 붙어 있다.
    float drag = 7.0, s = (1.0 - exp(-drag * t)) / drag;
    vec3 p = aOrigin + aVel * s; p.y -= 0.5 * aMotion.y * t * t;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float e = 1.0 - pow(1.0 - min(k * 1.6, 1.0), 3.0);
    float size = aShape.y * mix(aMotion.x, 1.0, e);
    vec2 axis = vec2(cos(aShape.z), sin(aShape.z));
    float stretch = aShape.w;
    if (kind > 0.5 && kind < 1.5) {
      vec3 vNow = aVel * exp(-drag * t) - vec3(0.0, aMotion.y * t, 0.0);
      vec2 vv = (mat3(viewMatrix) * vNow).xy; float sp = length(vv);
      if (sp > 0.0001) axis = vv / sp;
      stretch = 1.0 + min(sp * 0.16, 5.5) * aShape.w;
      size *= 1.0 - k * 0.55;
    }
    vec2 perp = vec2(-axis.y, axis.x);
    mv.xy += axis * position.x * size * stretch + perp * position.y * size;
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = `
  varying vec2 vUv; varying vec3 vColor; varying float vK; varying float vKind;
  void main() {
    float k = vK; if (k >= 1.0) discard;
    vec2 uv = vUv; float r = length(uv);
    float a = 0.0; vec3 col = vColor;
    if (vKind < 0.5) {
      // 코어: 짧게 터졌다 사라지는 하얀 심 + 영웅색 테
      float body = exp(-r * r * 7.0), hot = exp(-r * r * 30.0);
      a = (body * 0.42 + hot) * pow(1.0 - k, 1.8);
      col = mix(vColor, vec3(1.0), clamp(hot * 1.4, 0.0, 1.0));
    } else if (vKind < 1.5) {
      // 줄기: 앞(+x)이 달아오른 캡슐
      float along = 1.0 - smoothstep(0.35, 1.0, abs(uv.x));
      float across = 1.0 - smoothstep(0.0, 1.0, abs(uv.y));
      a = along * across * across * (1.0 - k);
      col = mix(vColor, vec3(1.0), smoothstep(-0.1, 0.9, uv.x) * 0.75);
    } else if (vKind < 2.5) {
      // 별빛: 긴 십자 4갈래 + 짧은 대각 4갈래 + 둥근 심
      float ang = atan(uv.y, uv.x);
      float main = pow(abs(cos(ang * 2.0)), 26.0), diag = pow(abs(sin(ang * 2.0)), 70.0) * 0.5;
      float rays = (main + diag) * exp(-r * 1.5) * (1.0 - smoothstep(0.82, 1.0, r));
      float hot = exp(-r * r * 46.0);
      a = (rays * 1.35 + hot) * pow(1.0 - k, 1.3);
      col = mix(vColor, vec3(1.0), clamp(hot + main * exp(-r * 6.0), 0.0, 1.0));
    } else if (vKind < 3.5) {
      // 충격 고리: 바깥으로 퍼지며 가늘어진다
      float R = mix(0.22, 0.94, 1.0 - pow(1.0 - k, 2.6));
      float w = mix(0.13, 0.035, k);
      a = exp(-pow((r - R) / w, 2.0)) * pow(1.0 - k, 1.2);
      col = mix(vColor, vec3(1.0), 0.25 * (1.0 - k));
    } else {
      // 베기 자국: 날 방향(+x)으로 그어지는 초승달. 끝은 가늘고 중앙은 두껍다.
      float curve = 0.42 * uv.x * uv.x - 0.2;
      float th = 0.16 * (1.0 - uv.x * uv.x) + 0.012;
      float d = abs(uv.y - curve);
      float blade = (1.0 - smoothstep(th * 0.35, th, d)) * (1.0 - smoothstep(0.86, 1.0, abs(uv.x)));
      float reveal = smoothstep(-0.05, 0.12, mix(-1.1, 1.25, min(1.0, k * 3.2)) - uv.x);
      float glow = exp(-d * d / (th * th * 6.0)) * 0.35 * (1.0 - smoothstep(0.8, 1.0, abs(uv.x)));
      a = (blade + glow) * reveal * (k < 0.35 ? 1.0 : 1.0 - (k - 0.35) / 0.65);
      col = mix(vColor, vec3(1.0), (1.0 - smoothstep(0.0, th * 0.45, d)) * 0.85);
    }
    a = clamp(a, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }`;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const _c = new THREE.Color(), _view = new THREE.Vector3(), _dir = new THREE.Vector3();

/** 타격 임팩트 층. FX 가 소유하며 FX.update(dt) 로 시계가 흐른다. */
export class ImpactVfx {
  /** @param {THREE.Scene} scene @param {{focus?: {bind: Function}|null, camera?: THREE.Camera|null, seed?: number}} [options] */
  constructor(scene, { focus = null, camera = null, seed = 0x1a9c7e55 } = {}) {
    this.enabled = true; this.lite = false; this.clock = 0; this.seed = seed >>> 0; this.rng = new VfxRng(this.seed);
    this.camera = camera; this.budget = IMPACT_FRAME_BUDGET; this.spawned = 0;
    this.uTime = { value: 0 };
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime }, vertexShader: VERT, fragmentShader: FRAG,
      // 적 몸에 가려지지 않게 깊이 검사 없이 맨 위에 짧게 그린다(수명 0.1~0.3초).
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
    });
    focus?.bind?.(material);
    this.ring = new InstanceRing(scene, new THREE.PlaneGeometry(1, 1), material, IMPACT_CAPACITY,
      { aOrigin: 3, aVel: 3, aShape: 4, aColor: 3, aLife: 2, aMotion: 2 }, 14);
    this.mesh = this.ring.mesh;
  }
  setQuality(q) { this.lite = q === 'low'; }
  setWarm(on) {
    this.warm = Math.max(0, (this.warm || 0) + (on ? 1 : -1));
    this.ring.sync(this.clock); this._applyWarm();
  }
  _applyWarm() { if (this.warm > 0) { this.mesh.visible = true; this.mesh.count = Math.max(1, this.ring.high); } }
  update(dt) {
    this.budget = IMPACT_FRAME_BUDGET;
    if (Number.isFinite(dt) && dt > 0) this.clock += dt;
    if (this.clock > 1800 && this.clock >= this.ring.lastExpiry) { this.clear(); return; }
    this.uTime.value = this.clock;
    this.ring.flush(); this.ring.sync(this.clock); this._applyWarm();
  }
  /** 칸 하나를 쓴다. 예산이 없으면 false. */
  _emit(kind, x, y, z, size, color, life, { vx = 0, vy = 0, vz = 0, angle = 0, stretch = 1, grow = .35, gravity = 0 } = {}) {
    if (!this.enabled || this.budget <= 0 || !(life > 0) || !(size > 0)) return false;
    this.budget--;
    const slot = this.ring.claim(this.clock + life), A = this.ring.a, i3 = slot * 3, i4 = slot * 4, i2 = slot * 2;
    A.aOrigin[i3] = x; A.aOrigin[i3 + 1] = y; A.aOrigin[i3 + 2] = z;
    A.aVel[i3] = vx; A.aVel[i3 + 1] = vy; A.aVel[i3 + 2] = vz;
    A.aShape[i4] = kind; A.aShape[i4 + 1] = size; A.aShape[i4 + 2] = angle; A.aShape[i4 + 3] = stretch;
    _c.set(color); A.aColor[i3] = _c.r; A.aColor[i3 + 1] = _c.g; A.aColor[i3 + 2] = _c.b;
    A.aLife[i2] = this.clock; A.aLife[i2 + 1] = life;
    A.aMotion[i2] = grow; A.aMotion[i2 + 1] = gravity;
    this.spawned++;
    return true;
  }
  /** 화면 기준 날 각도(라디안). 카메라가 없으면 대각선. */
  _screenAngle(dir) {
    const e = this.camera?.matrixWorld?.elements;
    if (!e || !dir || !(dir.x * dir.x + dir.z * dir.z > 1e-8)) return -.65;
    return Math.atan2(dir.x * e[4] + dir.y * e[5] + dir.z * e[6], dir.x * e[0] + dir.y * e[1] + dir.z * e[2]);
  }
  _streaks(pos, dir, n, speed, life, color, { up = 2.2, spread = .9, size = .2 } = {}) {
    const rng = this.rng;
    let dx = dir?.x || 0, dz = dir?.z || 0; const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) { dx /= dl; dz /= dl; } else { const a = rng.next() * 6.2831853; dx = Math.cos(a); dz = Math.sin(a); }
    for (let i = 0; i < n; i++) {
      const a = (rng.next() - .5) * 2 * spread, c = Math.cos(a), s = Math.sin(a);
      const sp = speed * (.55 + rng.next() * .7);
      const vx = (dx * c - dz * s) * sp, vz = (dx * s + dz * c) * sp, vy = up * (.3 + rng.next() * 1.1);
      this._emit(IMPACT_KIND.streak, pos.x, pos.y, pos.z, size * (.7 + rng.next() * .6), color, life * (.7 + rng.next() * .6),
        { vx, vy, vz, stretch: .9, grow: 1, gravity: 16 });
    }
  }
  /**
   * 적 한 점의 타격 임팩트. kind: slash(베기 자국) / blunt(충격 고리) / magic(별빛). crit 이면 금빛 십자 섬광과 고리를 더한다.
   * @returns {number} 쓴 칸 수
   */
  hit(pos, dir, { hero = '', kind = 'slash', tier = 'light', crit = false, reduced = false } = {}) {
    if (!this.enabled || !pos) return 0;
    const before = this.spawned;
    const T = IMPACT_TIERS[tier] || IMPACT_TIERS.light, P = HERO_IMPACT_PALETTE[hero] || HERO_IMPACT_PALETTE.default;
    const heavy = tier !== 'light', angle = this._screenAngle(dir);
    // 카메라 쪽으로 살짝 당겨 적 몸 표면 위에 뜨게 한다.
    _view.copy(pos);
    if (this.camera) { _dir.setFromMatrixPosition(this.camera.matrixWorld).sub(pos); const l = _dir.length(); if (l > 1e-3) _view.addScaledVector(_dir, .35 / l); }
    const x = _view.x, y = _view.y, z = _view.z;
    if (reduced) { this._emit(IMPACT_KIND.core, x, y, z, T.core * .7, P.core, .08, { grow: 1 }); return this.spawned - before; }
    this._emit(IMPACT_KIND.core, x, y, z, T.core, crit ? CRIT_HOT : P.core, T.coreLife, { grow: .45 });
    if (kind === 'blunt') this._emit(IMPACT_KIND.ring, x, y, z, T.ring * 1.15, P.accent, .2, { grow: 1 });
    else if (kind === 'magic') this._emit(IMPACT_KIND.star, x, y, z, T.core * 1.3, P.accent, .14, { angle: .4, grow: .6 });
    else this._emit(IMPACT_KIND.cut, x, y, z, T.cut, P.accent, heavy ? .2 : .16, { angle, stretch: 1.25, grow: .92 });
    if (heavy && kind !== 'blunt' && !this.lite) this._emit(IMPACT_KIND.ring, x, y, z, T.ring, P.accent, .18, { grow: 1 });
    const n = this.lite ? Math.ceil(T.streaks / 2) : T.streaks;
    this._streaks(_view, dir, n, T.speed, T.streakLife, P.accent, { spread: kind === 'blunt' ? 1.4 : .75, size: heavy ? .32 : .26 });
    if (crit) {
      // 치명타: 금빛 십자 별빛 + 큰 고리 + 금 불똥. 영웅색과 별개로 모든 영웅에서 같은 신호다.
      this._emit(IMPACT_KIND.star, x, y + .05, z, T.core * 3.2, CRIT_COLOR, .2, { angle: angle * .25, grow: .4 });
      if (!this.lite) this._emit(IMPACT_KIND.ring, x, y, z, T.ring * 1.5, CRIT_COLOR, .24, { grow: 1 });
      this._streaks(_view, dir, this.lite ? 2 : 4, T.speed * 1.15, T.streakLife * 1.1, CRIT_COLOR, { spread: 1.6, size: .3 });
    }
    return this.spawned - before;
  }
  /** 처치 확정: 따뜻한 큰 섬광 + 고리 + 위로 튀는 불똥. elite/boss 는 더 크다. */
  kill(pos, { elite = false, boss = false, hero = '', reduced = false } = {}) {
    if (!this.enabled || !pos) return 0;
    const before = this.spawned, k = boss ? 1.8 : elite ? 1.35 : 1, P = HERO_IMPACT_PALETTE[hero] || HERO_IMPACT_PALETTE.default;
    const x = pos.x, y = pos.y + 1, z = pos.z;
    this._emit(IMPACT_KIND.core, x, y, z, 1.3 * k, KILL_COLOR, reduced ? .1 : .16, { grow: .5 });
    if (reduced) return this.spawned - before;
    this._emit(IMPACT_KIND.ring, x, y, z, 2.3 * k, P.accent, .26, { grow: 1 });
    this._emit(IMPACT_KIND.star, x, y, z, 1.8 * k, KILL_COLOR, .16, { angle: .2, grow: .5 });
    const n = this.lite ? 3 : boss ? 10 : elite ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2831853 + this.rng.next() * .5, sp = 6 + this.rng.next() * 5 * k;
      this._emit(IMPACT_KIND.streak, x, y, z, .24 * k, i % 2 ? KILL_COLOR : P.accent, .26 + this.rng.next() * .12,
        { vx: Math.cos(a) * sp, vy: 3 + this.rng.next() * 4, vz: Math.sin(a) * sp, stretch: .9, grow: 1, gravity: 18 });
    }
    return this.spawned - before;
  }
  /** 스킬 착탄 한 점의 짧은 '임팩트 프레임'(코어 + 고리 + 별빛). 텍스처 연출 위에 얹어 중심을 또렷하게 만든다. */
  burst(pos, color, { size = 2, reduced = false } = {}) {
    if (!this.enabled || !pos) return 0;
    const before = this.spawned, s = clamp(Number.isFinite(size) ? size : 2, .5, 6);
    this._emit(IMPACT_KIND.core, pos.x, pos.y, pos.z, s, color, .14, { grow: .4 });
    if (reduced) return this.spawned - before;
    this._emit(IMPACT_KIND.star, pos.x, pos.y, pos.z, s * 1.2, color, .16, { angle: .3, grow: .5 });
    this._emit(IMPACT_KIND.ring, pos.x, pos.y, pos.z, s * 1.4, color, .24, { grow: 1 });
    return this.spawned - before;
  }
  /** 살아 있는 칸 수(점검·테스트용). */
  live() { return this.ring.live(this.clock); }
  clear() { this.ring.clear(); this.clock = 0; this.uTime.value = 0; this.rng = new VfxRng(this.seed); this.budget = IMPACT_FRAME_BUDGET; }
  dispose() { this.ring.dispose(); }
}
