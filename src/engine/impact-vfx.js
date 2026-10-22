import * as THREE from 'three';
import { InstanceRing, VfxRng } from './combat-vfx.js';

// 타격·치명타·처치 순간의 '임팩트 프레임' 층. 인스턴스 메시 한 장(드로우콜 1)에 다섯 가지 모양을 셰이더로 그린다.
//  0 코어 섬광(하얗게 달아오른 중심 + 영웅색 테), 1 불똥 줄기(속도 방향으로 늘어남), 2 별빛 섬광(치명타 십자 광채),
//  3 충격 고리(얇게 퍼지는 원), 4 베기 자국(날 방향 초승달이 한쪽에서 그어지며 나타남).
// CPU 는 낼 때만 칸을 쓰고, 프레임마다 하는 일은 시계(uTime) 갱신뿐이다. 시계는 FX.update 의 sim dt 라
// 히트스톱 동안 섬광이 그 자리에 '정지 화면'으로 남는다. 난수는 전투 난수와 분리된 VfxRng 만 쓴다(Math.random 미사용).

export const IMPACT_KIND = Object.freeze({ core: 0, streak: 1, star: 2, ring: 3, cut: 4, beam: 5, mark: 6, shard: 7, flame: 8 });
// 7 파편: 날카로운 마름모(처치 파편·치명타 잔광 눈금). 8 영혼 불꽃: 아래가 둥글고 위가 뾰족한 물방울, 음의 중력으로 천천히 오른다.
// 5 광선: 시작점에서 aVel(월드 벡터) 끝까지 aMotion.x(m/s) 속도로 머리가 나아가고 aShape.w(m) 뒤에서 꼬리가 따라온다.
//   화살 비행 궤적과 같은 속도로 그어져 '관통 일직선'을 읽게 한다. aShape.z = 모양(0 직선, 1 덩굴 물결, 2 쌍나선 바람).
// 6 지면 표식: 월드 XZ 평면에 눕는 표식. aShape.z = 회전, aShape.w = 모양(0 조준 원, 1 부채꼴, 2 가시 고리, 3 나침 고리, 4 시계판).
export const BEAM_STYLE = Object.freeze({ line: 0, vine: 1, gale: 2 });
export const MARK_STYLE = Object.freeze({ reticle: 0, fan: 1, thorn: 2, compass: 3, clock: 4 });

/** 영웅별 타격 색 언어: core = 달아오른 중심, accent = 불똥·고리·자국. 기본 공격·스킬 모두 같은 색 계열을 쓴다. */
export const HERO_IMPACT_PALETTE = Object.freeze({
  knight: Object.freeze({ core: 0xfff4cc, accent: 0xffc23a }),
  barbarian: Object.freeze({ core: 0xffe0b8, accent: 0xff5a1e }),
  mage: Object.freeze({ core: 0xe6f6ff, accent: 0x5aa8ff }),
  rogue: Object.freeze({ core: 0xf6e6ff, accent: 0xb466ff }),
  ranger: Object.freeze({ core: 0xeafff2, accent: 0x3fe0a0 }),
  default: Object.freeze({ core: 0xfff0d0, accent: 0xffc870 }),
});
const CRIT_COLOR = 0xffd23a, CRIT_DEEP = 0xffa81e, KILL_COLOR = 0xffe2a0;

/** 영웅별 평타 연계 언어. 단계(0 → 마지막)가 오를수록 grow 만큼 커지고, 마지막 타는 시그니처 마무리를 더한다.
 *  knight 금빛 호, ranger 비취 화살 착탄, mage 비전 청 구체, rogue 보라 교차 베기, barbarian 불씨 주황 내려찍기. */
export const HERO_COMBO = Object.freeze({
  knight: Object.freeze({ shape: 'arc', color: 0xffc23a, hot: 0xffe27a, base: 1.55, grow: .5 }),
  ranger: Object.freeze({ shape: 'arrow', color: 0x3fe0a0, hot: 0x9fffd8, base: .7, grow: .45 }),
  mage: Object.freeze({ shape: 'orb', color: 0x5aa8ff, hot: 0x9fd0ff, base: .85, grow: .5 }),
  rogue: Object.freeze({ shape: 'cross', color: 0xb466ff, hot: 0xe2b8ff, deep: 0x8a3cff, base: 1.2, grow: .45 }),
  barbarian: Object.freeze({ shape: 'smash', color: 0xff5a1e, hot: 0xff9a3a, base: 1.1, grow: .55 }),
});

/** 등급별 접촉 강도. 크기는 m, 수명은 초. 고리는 무거운 타격·둔기에서만. */
export const IMPACT_TIERS = Object.freeze({
  light: Object.freeze({ core: .7, coreLife: .09, cut: 1.45, ring: 1.1, streaks: 4, speed: 9, streakLife: .17 }),
  heavy: Object.freeze({ core: .95, coreLife: .11, cut: 1.95, ring: 1.6, streaks: 6, speed: 11.5, streakLife: .2 }),
  finisher: Object.freeze({ core: 1.1, coreLife: .13, cut: 2.35, ring: 2.0, streaks: 8, speed: 13, streakLife: .22 }),
  counter: Object.freeze({ core: 1.05, coreLife: .12, cut: 2.2, ring: 1.9, streaks: 8, speed: 12.5, streakLife: .22 }),
  boss: Object.freeze({ core: 1.0, coreLife: .11, cut: 2.1, ring: 1.8, streaks: 6, speed: 11.5, streakLife: .2 }),
});
/** 궁수 화살 궤적 언어(모두 비취 계열). tail = 꼬리 길이 m, width = 반폭 m, glow = 넓은 옅은 번짐 한 줄을 더할지, style = 광선 모양.
 *  기본 평타는 짧은 꼬리, 관통은 길고 곧은 선 + 번짐, 일제 사격은 중간, 폭풍(궁극기)은 쌍나선 바람, 속박은 덩굴 물결이다. */
export const ARROW_STREAKS = Object.freeze({
  basic: Object.freeze({ tail: 4.5, width: .065, color: 0x3fe0a0, glow: 0, style: 0, muzzle: 0 }),
  finisher: Object.freeze({ tail: 7, width: .1, color: 0x3fe0a0, glow: .26, style: 0, muzzle: .55 }),
  pierce: Object.freeze({ tail: 13, width: .1, color: 0x52f0b4, glow: .34, style: 0, muzzle: .8 }),
  volley: Object.freeze({ tail: 6, width: .08, color: 0x3fe0a0, glow: .2, style: 0, muzzle: .5 }),
  retreat: Object.freeze({ tail: 5, width: .075, color: 0x7affc8, glow: 0, style: 0, muzzle: .45 }),
  storm: Object.freeze({ tail: 9, width: .12, color: 0x3fe0a0, glow: .3, style: 2, muzzle: .7 }),
  quick: Object.freeze({ tail: 5, width: .07, color: 0x9fffd8, glow: 0, style: 0, muzzle: .5 }),
  bind: Object.freeze({ tail: 8, width: .1, color: 0x63e08a, glow: .22, style: 1, muzzle: .55 }),
  gale: Object.freeze({ tail: 7, width: .09, color: 0x3fe0a0, glow: .24, style: 2, muzzle: .5 }),
});
export const IMPACT_CAPACITY = 512;
/** 한 프레임에 새로 낼 수 있는 칸 상한(군중 동시 타격에도 업로드·채움 비용이 일정하다). */
export const IMPACT_FRAME_BUDGET = 72;
/** 같은 자리 겹침 억제: STACK_SEC 초 안에 STACK_DIST m 안쪽을 다시 치면 코어·자국을 다시 그리지 않고 불똥만 낸다.
 *  관통 화살 7발·회전베기 연타가 한 적에 코어를 3~4겹 쌓아 하얀 덩어리가 되던 것을 막는다. 고정 길이 배열이라 할당이 없다. */
export const IMPACT_STACK = Object.freeze({ slots: 24, sec: .07, dist: .9 });

const VERT = `
  attribute vec3 aOrigin; attribute vec3 aVel; attribute vec4 aShape; attribute vec3 aColor; attribute vec2 aLife; attribute vec2 aMotion;
  uniform float uTime;
  varying vec2 vUv; varying vec3 vColor; varying float vK; varying float vKind; varying float vStyle; varying float vSize;
  void main() {
    float t = uTime - aLife.x;
    // 광선은 aShape.z, 지면 표식은 aShape.w 에 모양 번호를 담는다.
    vStyle = aShape.x > 5.5 ? aShape.w : aShape.z;
    float k = t / max(aLife.y, 0.001);
    vUv = position.xy * 2.0; vColor = aColor; vK = k; vKind = aShape.x; vSize = aShape.y;
    if (t < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float kind = aShape.x;
    if (kind > 4.5 && kind < 5.5) {
      // 광선: 머리 = 속도×시간(끝에서 멈춤), 꼬리 = 머리 - 꼬리 길이. 화면에서 선 방향으로 늘이고 옆으로 폭만큼.
      float L = length(aVel), speed = aMotion.x;
      float head = speed > 0.0 ? min(L, t * speed) : L;
      float tail = aShape.w > 0.0 ? clamp(t * max(speed, 0.001) - aShape.w, 0.0, L) : 0.0;
      vec3 dirW = aVel / max(L, 0.0001);
      vec3 pw = aOrigin + dirW * mix(tail, head, position.x + 0.5);
      vec4 mvb = viewMatrix * vec4(pw, 1.0);
      vec2 ax = (mat3(viewMatrix) * dirW).xy; float al = length(ax);
      ax = al > 0.0001 ? ax / al : vec2(1.0, 0.0);
      mvb.xy += vec2(-ax.y, ax.x) * position.y * aShape.y * 2.0;
      vUv = vec2(position.x * 2.0, position.y * 2.0);
      gl_Position = projectionMatrix * mvb;
      return;
    }
    if (kind > 5.5 && kind < 6.5) {
      // 지면 표식: 처음 20% 동안 1.35배에서 제자리로 좁혀 들어온다(조준이 '잡히는' 느낌).
      float e0 = 1.0 - pow(1.0 - min(k * 5.0, 1.0), 3.0);
      float sz = aShape.y * mix(1.35, 1.0, e0);
      float c = cos(aShape.z), sn = sin(aShape.z);
      vec2 q = vec2(position.x * c - position.y * sn, position.x * sn + position.y * c) * sz * 2.0;
      gl_Position = projectionMatrix * viewMatrix * vec4(aOrigin + vec3(q.x, 0.0, q.y), 1.0);
      return;
    }
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
  varying vec2 vUv; varying vec3 vColor; varying float vK; varying float vKind; varying float vStyle; varying float vSize;
  void main() {
    float k = vK; if (k >= 1.0) discard;
    vec2 uv = vUv; float r = length(uv);
    float a = 0.0; vec3 col = vColor;
    if (vKind > 4.5 && vKind < 5.5) {
      // 광선: 가운데 하얀 심 + 영웅색 번짐. 머리(+x)가 가장 밝고 꼬리로 갈수록 옅어진다.
      float y = uv.y;
      if (vStyle > 0.5 && vStyle < 1.5) y -= sin(uv.x * 9.0 + k * 18.0) * 0.32;
      float along = pow(clamp(uv.x * 0.5 + 0.5, 0.0, 1.0), 1.4);
      float core = exp(-y * y * 70.0), glow = exp(-y * y * 5.0) * 0.4;
      if (vStyle > 1.5) {
        // 쌍나선 바람: 심 양옆을 꼬이며 감는 두 가닥.
        float w1 = uv.y - sin(uv.x * 7.0 - k * 22.0) * 0.55, w2 = uv.y + sin(uv.x * 7.0 - k * 22.0) * 0.55;
        glow += (exp(-w1 * w1 * 40.0) + exp(-w2 * w2 * 40.0)) * 0.55;
      }
      float headHot = smoothstep(0.82, 1.0, uv.x);
      a = (core * (0.55 + 0.45 * along) + glow * along) * (0.35 + 0.65 * along) * (1.0 - smoothstep(0.78, 1.0, k));
      a *= 1.0 - smoothstep(0.92, 1.0, abs(uv.x));
      col = mix(vColor, vec3(1.0), clamp(core * (0.45 + headHot * 0.5), 0.0, 1.0));
    } else if (vKind > 5.5 && vKind < 6.5) {
      // 지면 표식: 얇은 선 위주(바닥 가산 면적을 작게). 마지막 25% 에 사라진다.
      float fade = (k < 0.12 ? k / 0.12 : 1.0) * (1.0 - smoothstep(0.75, 1.0, k));
      float ang = atan(uv.y, uv.x);
      if (vStyle < 0.5) {
        // 조준 원: 바깥 원 + 안쪽 점선 원 + 네 방향 눈금 + 중심 점
        float ring = exp(-pow((r - 0.86) / 0.035, 2.0));
        float dash = exp(-pow((r - 0.55) / 0.03, 2.0)) * step(0.0, sin(ang * 8.0 + k * 6.0));
        float tick = (1.0 - smoothstep(0.035, 0.07, min(abs(uv.x), abs(uv.y)))) * step(0.6, r) * step(r, 0.82);
        float dot0 = exp(-r * r * 140.0);
        a = (ring + dash * 0.7 + tick * 0.9 + dot0) * fade;
      } else if (vStyle < 1.5) {
        // 부채꼴: +x 방향 ±0.42rad 안쪽, 가장자리 두 선과 바깥 호가 또렷하고 안은 옅다
        float hw = 0.42, inA = 1.0 - smoothstep(hw - 0.02, hw, abs(ang));
        float edgeL = exp(-pow((abs(ang) - hw) * r / 0.03, 2.0)) * step(r, 0.98);
        float arc = exp(-pow((r - 0.95) / 0.03, 2.0)) * inA;
        float sweep = smoothstep(0.0, 1.0, k * 3.0);
        a = ((inA * 0.12 * step(r, 0.95) + arc) * step(r, sweep + 0.02) + edgeL * 0.8) * fade;
      } else if (vStyle < 2.5) {
        // 가시 고리: 얇은 원 + 안쪽으로 찌르는 가시 10개(속박)
        float ring = exp(-pow((r - 0.8) / 0.04, 2.0));
        float sp = pow(abs(cos(ang * 5.0 + 0.3)), 30.0) * step(0.45, r) * step(r, 0.8) * (1.0 - (0.8 - r) / 0.35 * 0.6);
        a = (ring + sp) * fade;
      } else if (vStyle > 3.5) {
        // 시계판: 원 + 12 눈금 + 수명 동안 한 바퀴 도는 바늘과 그 뒤로 옅어지는 부채꼴 잔광(시간 봉인)
        float ring = exp(-pow((r - 0.92) / 0.025, 2.0));
        float ticks = pow(abs(cos(ang * 6.0)), 90.0) * step(0.78, r) * step(r, 0.9);
        float hand = 1.5708 - k * 6.2832;
        vec2 hd = vec2(cos(hand), sin(hand));
        float along = dot(uv, hd), perp = abs(uv.x * hd.y - uv.y * hd.x);
        float needle = (1.0 - smoothstep(0.012, 0.03, perp)) * step(0.0, along) * step(along, 0.86);
        float behind = mod(hand - ang + 6.2832 * 4.0, 6.2832);
        float wake = exp(-behind * 2.2) * step(r, 0.9) * 0.22;
        a = (ring + ticks + needle + wake) * fade;
      } else {
        // 나침 고리: 큰 원 + 일곱 갈래 눈금(폭풍 일곱 화살)
        float ring = exp(-pow((r - 0.9) / 0.03, 2.0)) + exp(-pow((r - 0.62) / 0.02, 2.0)) * 0.5;
        float rays = pow(abs(cos(ang * 3.5)), 60.0) * step(0.62, r) * step(r, 0.9);
        a = (ring + rays) * fade;
      }
      // 흰색 섞임은 작은 표식(반경 ≤ 1m)만 20%, 큰 표식(≥ 3m)은 0 — 넓은 금빛 선이 청회색 바닥 위에서 복숭아·파스텔로 바래지 않게.
      col = mix(vColor, vec3(1.0), 0.2 * (1.0 - smoothstep(1.0, 3.0, vSize)));
    } else if (vKind < 0.5) {
      // 코어: 짧게 터졌다 사라지는 하얀 심 + 영웅색 테
      float body = exp(-r * r * 7.0), hot = exp(-r * r * 30.0);
      a = (body * 0.3 + hot) * pow(1.0 - k, 1.8);
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
    } else if (vKind > 6.5 && vKind < 7.5) {
      // 파편: 가로로 긴 날카로운 마름모. 심만 조금 밝고 몸은 영웅색이라 작게 많이 튀어도 하얗게 뭉치지 않는다.
      float d = abs(uv.x) * 0.62 + abs(uv.y) * 1.7;
      a = (1.0 - smoothstep(0.8, 0.92, d)) * (k < 0.55 ? 1.0 : 1.0 - (k - 0.55) / 0.45);
      col = mix(vColor, vec3(1.0), (1.0 - smoothstep(0.0, 0.3, d)) * 0.4);
    } else if (vKind > 7.5 && vKind < 8.5) {
      // 영혼 불꽃: 아래 둥근 몸(중심 y=-.35, 반지름 .42) 위로 가늘어지는 혀. 처음 10% 에 켜지고 마지막 45% 에 꺼진다.
      float y = uv.y + 0.35;
      float w = y < 0.0 ? sqrt(max(0.0, 0.1764 - y * y)) : 0.42 * max(0.0, 1.0 - y / 1.25);
      float body = (1.0 - smoothstep(w * 0.55, w, abs(uv.x))) * step(-0.42, y);
      float hot = exp(-(uv.x * uv.x + y * y) * 14.0);
      a = (body * 0.85 + hot * 0.25) * min(1.0, k * 10.0) * (k < 0.55 ? 1.0 : 1.0 - (k - 0.55) / 0.45);
      col = mix(vColor, vec3(1.0), hot * 0.35);
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
const _c = new THREE.Color(), _view = new THREE.Vector3(), _dir = new THREE.Vector3(), _pos = new THREE.Vector3();

/** 타격 임팩트 층. FX 가 소유하며 FX.update(dt) 로 시계가 흐른다. */
export class ImpactVfx {
  /** @param {THREE.Scene} scene @param {{focus?: {bind: Function}|null, camera?: THREE.Camera|null, seed?: number}} [options] */
  constructor(scene, { focus = null, camera = null, seed = 0x1a9c7e55 } = {}) {
    this.enabled = true; this.lite = false; this.clock = 0; this.seed = seed >>> 0; this.rng = new VfxRng(this.seed);
    this.camera = camera; this.budget = IMPACT_FRAME_BUDGET; this.spawned = 0;
    this.recent = new Float32Array(IMPACT_STACK.slots * 4).fill(-1e9); this.recentAt = 0;
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
  _emit(kind, x, y, z, size, color, life, { vx = 0, vy = 0, vz = 0, angle = 0, stretch = 1, grow = .35, gravity = 0, delay = 0 } = {}) {
    if (!this.enabled || this.budget <= 0 || !(life > 0) || !(size > 0)) return false;
    this.budget--;
    const start = this.clock + (delay > 0 ? delay : 0);
    const slot = this.ring.claim(start + life), A = this.ring.a, i3 = slot * 3, i4 = slot * 4, i2 = slot * 2;
    this.lastSlot = slot;
    A.aOrigin[i3] = x; A.aOrigin[i3 + 1] = y; A.aOrigin[i3 + 2] = z;
    A.aVel[i3] = vx; A.aVel[i3 + 1] = vy; A.aVel[i3 + 2] = vz;
    A.aShape[i4] = kind; A.aShape[i4 + 1] = size; A.aShape[i4 + 2] = angle; A.aShape[i4 + 3] = stretch;
    _c.set(color); A.aColor[i3] = _c.r; A.aColor[i3 + 1] = _c.g; A.aColor[i3 + 2] = _c.b;
    A.aLife[i2] = start; A.aLife[i2 + 1] = life;
    A.aMotion[i2] = grow; A.aMotion[i2 + 1] = gravity;
    this.spawned++;
    return true;
  }
  /** 최근 같은 자리(시간·거리) 타격이면 true. 아니면 이 자리를 기록하고 false. */
  _stacked(pos) {
    const R = this.recent, n = IMPACT_STACK.slots, d2 = IMPACT_STACK.dist * IMPACT_STACK.dist;
    for (let i = 0; i < n; i++) {
      const j = i * 4; if (this.clock - R[j + 3] > IMPACT_STACK.sec) continue;
      const dx = R[j] - pos.x, dy = R[j + 1] - pos.y, dz = R[j + 2] - pos.z;
      if (dx * dx + dy * dy + dz * dz < d2) return true;
    }
    const j = this.recentAt * 4; this.recentAt = (this.recentAt + 1) % n;
    R[j] = pos.x; R[j + 1] = pos.y; R[j + 2] = pos.z; R[j + 3] = this.clock;
    return false;
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
    if (!crit && !reduced && this._stacked(pos)) {
      this._streaks(_view, dir, this.lite ? 1 : 2, T.speed, T.streakLife, P.accent, { spread: .75, size: .22 });
      return this.spawned - before;
    }
    // 코어는 영웅 강조색 번짐 + 셰이더의 하얀 심이다. 크림색 코어는 군중을 한꺼번에 칠 때 적마다 크림 덩어리로 겹쳐 보였다.
    if (reduced) { this._emit(IMPACT_KIND.core, x, y, z, T.core * .7, P.accent, .08, { grow: 1 }); return this.spawned - before; }
    // 치명타 코어는 금색 본색(하얀 심은 셰이더가 작게 그린다). 크림색 코어는 백화로 읽혔다.
    this._emit(IMPACT_KIND.core, x, y, z, T.core, crit ? CRIT_COLOR : P.accent, T.coreLife, { grow: .45 });
    if (kind === 'blunt') this._emit(IMPACT_KIND.ring, x, y, z, T.ring * 1.15, P.accent, .2, { grow: 1 });
    else if (kind === 'magic') this._emit(IMPACT_KIND.star, x, y, z, T.core * 1.3, P.accent, .14, { angle: .4, grow: .6 });
    else this._emit(IMPACT_KIND.cut, x, y, z, T.cut, P.accent, heavy ? .2 : .16, { angle, stretch: 1.25, grow: .92 });
    if (heavy && kind !== 'blunt' && !this.lite) this._emit(IMPACT_KIND.ring, x, y, z, T.ring, P.accent, .18, { grow: 1 });
    const n = this.lite ? Math.ceil(T.streaks / 2) : T.streaks;
    this._streaks(_view, dir, n, T.speed, T.streakLife, P.accent, { spread: kind === 'blunt' ? 1.4 : .75, size: heavy ? .32 : .26 });
    if (crit) this._crit(_view, dir, angle, T);
    if (!this.lite) this._heroHit(hero, _view, dir, angle, T, P, heavy);
    return this.spawned - before;
  }
  /** 치명타 공통 신호(영웅과 무관): 짧고 날카로운 금빛 십자(.14초) → 진한 금 충격 고리 → 네 갈래 금 파편 눈금이 .4초 남는다.
   *  크게 번지는 별빛 대신 가는 십자와 고리로 읽게 해 백화를 늘리지 않고, 판정 뒤 .2~.4초 화면에도 '치명'이 남는다. */
  _crit(at, dir, angle, T) {
    // 십자와 눈금은 적 머리 위(+.55m)에 띄운다. 위에서 내려다보는 카메라에서 영웅 바로 앞 적의 타격점은 영웅 몸과 겹쳐
    // 영웅 초점 마스크(.45배)에 눌려 보이지 않았다. 고리는 접촉점에 남는다.
    const x = at.x, y = at.y + .55, z = at.z;
    this._emit(IMPACT_KIND.star, x, y, z, T.core * 2.7, CRIT_COLOR, .14, { angle: 0, grow: .55 });
    this._emit(IMPACT_KIND.ring, x, at.y, z, T.ring * 1.35, CRIT_DEEP, .3, { grow: 1 });
    if (this.lite) { this._streaks(at, dir, 2, T.speed * 1.15, T.streakLife, CRIT_COLOR, { spread: 1.6, size: .28 }); return; }
    // 십자 네 끝에 금 파편 눈금: 화면 기준 상하좌우로 짧게 밀려나며 .42초 머문다(잔광).
    const e = this.camera?.matrixWorld?.elements;
    for (let i = 0; i < 4; i++) {
      const a = i * 1.5707963, c = Math.cos(a), sn = Math.sin(a);
      // 화면 x축(e0..2)·y축(e4..6)으로 펼친다. 카메라가 없으면 월드 XZ.
      const vx = e ? (e[0] * c + e[4] * sn) * 2.2 : c * 2.2, vy = e ? (e[1] * c + e[5] * sn) * 2.2 : sn * 2.2, vz = e ? (e[2] * c + e[6] * sn) * 2.2 : 0;
      this._emit(IMPACT_KIND.shard, x, y, z, .3, CRIT_COLOR, .42, { vx, vy, vz, angle: a, stretch: 1.5, grow: .6, delay: .03 });
    }
    this._streaks(at, dir, 3, T.speed * 1.15, T.streakLife * 1.1, CRIT_COLOR, { spread: 1.6, size: .28 });
  }
  /** 영웅별 타격 결(같은 코어·자국 위에 한 겹): 검성 금빛 X 광채, 광전사 솟는 불씨, 암살자 엇갈린 잔상 자국, 대마도사 원소 고리, 궁수 관통 선. */
  _heroHit(hero, at, dir, angle, T, P, heavy) {
    const x = at.x, y = at.y, z = at.z;
    if (hero === 'knight') {
      if (heavy) this._emit(IMPACT_KIND.star, x, y, z, T.core * 1.9, P.accent, .13, { angle: .785, grow: .5 });
    } else if (hero === 'barbarian') {
      for (let i = 0, n = heavy ? 4 : 2; i < n; i++) {
        const a = this.rng.next() * 6.2831853, sp = 1.2 + this.rng.next() * 1.8;
        this._emit(IMPACT_KIND.streak, x, y - .2, z, .15, i % 2 ? 0xff9a3a : P.accent, .45 + this.rng.next() * .25,
          { vx: Math.cos(a) * sp, vy: 3.5 + this.rng.next() * 2.5, vz: Math.sin(a) * sp, stretch: .5, grow: 1, gravity: -2 });
      }
    } else if (hero === 'rogue') {
      // 엇갈린 두 번째 자국이 한 박자(.035초) 늦게 그어져 X 자 잔상을 남긴다.
      this._emit(IMPACT_KIND.cut, x, y + .04, z, T.cut * .85, 0xe2b8ff, .16, { angle: angle + 1.25, stretch: 1.2, grow: .92, delay: .035 });
    } else if (hero === 'mage') {
      this._emit(IMPACT_KIND.ring, x, y, z, T.ring * .8, P.accent, .16, { grow: 1 });
    } else if (hero === 'ranger' && dir) {
      _dir.set(dir.x, 0, dir.z); if (_dir.lengthSq() > 1e-6) { _dir.normalize(); _pos.copy(at).addScaledVector(_dir, -1.1); this.beam(_pos, _dir, 2.4, P.accent, { width: .05, fade: .12 }); }
    }
  }
  /** 처치 확정: 작고 날카로운 영웅색 섬광 + 고리 + 방사형 파편 + 위로 오르는 영혼 불꽃. elite/boss 는 더 크다.
   *  자주 나오는 신호라 크림색 큰 별빛 대신 영웅색 파편·불꽃으로 '확실히 죽었다'를 읽힌다(백화 방지). */
  kill(pos, { elite = false, boss = false, hero = '', reduced = false } = {}) {
    if (!this.enabled || !pos) return 0;
    const before = this.spawned, k = boss ? 1.8 : elite ? 1.35 : 1, P = HERO_IMPACT_PALETTE[hero] || HERO_IMPACT_PALETTE.default;
    const x = pos.x, y = pos.y + 1, z = pos.z;
    this._emit(IMPACT_KIND.core, x, y, z, .9 * k, boss || elite ? KILL_COLOR : P.accent, reduced ? .1 : .13, { grow: .5 });
    if (reduced) return this.spawned - before;
    this._emit(IMPACT_KIND.ring, x, y, z, 2 * k, P.accent, .24, { grow: 1 });
    this._emit(IMPACT_KIND.star, x, y, z, 1.3 * k, boss || elite ? KILL_COLOR : P.accent, .12, { angle: .2, grow: .5 });
    // 방사형 파편: 진행 방향으로 늘어난 마름모가 튀었다 떨어진다(영웅색 / 처치 금색 번갈아).
    const n = this.lite ? 4 : boss ? 10 : elite ? 8 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2831853 + this.rng.next() * .5, sp = 7 + this.rng.next() * 5 * k, vy = 3 + this.rng.next() * 4;
      this._emit(IMPACT_KIND.shard, x, y, z, .22 * k, i % 3 === 0 ? KILL_COLOR : P.accent, .34 + this.rng.next() * .12,
        { vx: Math.cos(a) * sp, vy, vz: Math.sin(a) * sp, angle: this.rng.next() * 6.2831853, stretch: 1.7, grow: .8, gravity: 16 });
    }
    // 영혼 불꽃: 쓰러진 자리에서 영웅색 작은 불꽃이 천천히 올라 .6초 남는다(판정 뒤 화면에서도 '처치'가 읽힌다).
    const flames = this.lite ? 1 : boss ? 4 : elite ? 3 : 2;
    for (let i = 0; i < flames; i++) {
      const a = this.rng.next() * 6.2831853, r = i ? .25 + this.rng.next() * .3 : 0;
      this._emit(IMPACT_KIND.flame, x + Math.cos(a) * r, y + .25, z + Math.sin(a) * r, (i ? .32 : .42) * k, i ? (HERO_COMBO[hero]?.hot ?? P.accent) : P.accent, .58 + this.rng.next() * .14,
        { vy: 1.5, grow: .5, gravity: -4.5, delay: .04 + i * .05 });
    }
    if (!this.lite) this._heroKill(hero, pos, P, k);
    return this.spawned - before;
  }
  /** 영웅별 처치 결: 검성 하늘로 오르는 금빛 광선, 광전사 솟는 불씨 무리, 대마도사 겹고리, 암살자 바닥 그림자 가시 문양, 궁수 조여드는 조준 원. */
  _heroKill(hero, pos, P, k) {
    if (hero === 'knight') {
      _pos.set(pos.x, .1, pos.z); _dir.set(0, 1, 0);
      this.beam(_pos, _dir, 3.6 * k, P.accent, { speed: 22, tail: 2.2, width: .12 });
    } else if (hero === 'barbarian') {
      for (let i = 0; i < 5; i++) {
        const a = this.rng.next() * 6.2831853, r = this.rng.next() * .6;
        this._emit(IMPACT_KIND.streak, pos.x + Math.cos(a) * r, pos.y + .4, pos.z + Math.sin(a) * r, .17, i % 2 ? 0xff9a3a : P.accent, .6 + this.rng.next() * .3,
          { vx: Math.cos(a) * 1.2, vy: 4 + this.rng.next() * 3, vz: Math.sin(a) * 1.2, stretch: .5, grow: 1, gravity: -2 });
      }
    } else if (hero === 'mage') {
      // 하얀 P.core 큰 고리(3.2m)는 처치마다 흰 구름으로 보였다. 비전 청 겹고리로 작게.
      this._emit(IMPACT_KIND.ring, pos.x, pos.y + 1, pos.z, 2.6 * k, P.accent, .28, { grow: 1, delay: .05 });
    } else if (hero === 'rogue') {
      this.mark(pos, P.accent, { radius: 1.2 * k, life: .45, style: MARK_STYLE.thorn, angle: this.rng.next() * 6.28 });
    } else if (hero === 'ranger') {
      this.mark(pos, P.accent, { radius: .95 * k, life: .35, style: MARK_STYLE.reticle });
    }
  }
  /**
   * 평타 연계 한 번(휘두름 1회당 한 번, 맞은 대표 한 점)의 영웅별 연계 층. step 0 → steps-1 로 오를수록 크고 길어지며
   * 마지막 타(finisher)는 시그니처 마무리를 더한다. 피해·판정과 무관한 표시 층이고 난수는 VfxRng 만 쓴다.
   * @param {any} pos @param {any} dir
   * @param {{hero?: string, step?: number, steps?: number, finisher?: boolean, reduced?: boolean}} [opts]
   * @returns {number} 쓴 칸 수
   */
  combo(pos, dir, { hero = '', step = 0, steps = 1, finisher = false, reduced = false } = {}) {
    const C = HERO_COMBO[hero];
    if (!this.enabled || !pos || !C || reduced) return 0;
    const before = this.spawned, last = Math.max(1, steps - 1), s = clamp(step / last, 0, 1);
    const g = (1 + C.grow * s) * (finisher ? 1.18 : 1), lite = this.lite;
    const angle = this._screenAngle(dir), flip = step % 2 ? 1 : -1;
    _view.copy(pos);
    if (this.camera) { _dir.setFromMatrixPosition(this.camera.matrixWorld).sub(pos); const l = _dir.length(); if (l > 1e-3) _view.addScaledVector(_dir, .45 / l); }
    const x = _view.x, y = _view.y, z = _view.z;
    let dx = dir?.x || 0, dz = dir?.z || 0; const dl = Math.hypot(dx, dz); if (dl > 1e-4) { dx /= dl; dz /= dl; } else { dx = 0; dz = -1; }
    if (C.shape === 'arc') {
      // 검성: 단계마다 위아래로 번갈아 그어지는 금빛 호. 오를수록 길고 두껍다. 마무리는 엇갈린 두 호 + 금빛 X 광채 + 하늘 광선.
      this._emit(IMPACT_KIND.cut, x, y, z, C.base * g, C.color, .2 + .06 * s, { angle: angle + flip * (.35 + .25 * s), stretch: 1.3 + .25 * s, grow: .9 });
      if (s > .45 && !lite) this._emit(IMPACT_KIND.cut, x, y + .08, z, C.base * g * .72, C.hot, .16, { angle: angle + flip * (.35 + .25 * s), stretch: 1.2, grow: .9, delay: .03 });
      if (finisher) {
        this._emit(IMPACT_KIND.cut, x, y + .05, z, C.base * g * 1.1, C.color, .26, { angle: angle - flip * .9, stretch: 1.4, grow: .9, delay: .04 });
        this._emit(IMPACT_KIND.star, x, y, z, 1.9 * g, C.color, .16, { angle: .785, grow: .5, delay: .04 });
        if (!lite) { _pos.set(pos.x, .1, pos.z); _dir.set(0, 1, 0); this.beam(_pos, _dir, 4.2, C.color, { speed: 26, tail: 2.4, width: .13, delay: .05 }); }
      }
    } else if (C.shape === 'arrow') {
      // 궁수: 비취 화살 착탄 — 조여드는 조준 원이 단계마다 커지고, 날아온 방향 뒤로 짧은 착탄 선. 마무리는 가시 고리 + 충격 고리.
      this.mark(pos, C.color, { radius: C.base * g, life: .3 + .08 * s, style: MARK_STYLE.reticle, y: .05 });
      if (!lite) { _pos.copy(_view).addScaledVector(_dir.set(dx, 0, dz), -1.4 * g); this.beam(_pos, _dir, 1.6 * g, C.hot, { width: .045 + .02 * s, fade: .14 }); }
      for (let i = 0, n = lite ? 1 : 2 + Math.round(2 * s); i < n; i++) {
        const a = Math.atan2(dz, dx) + (this.rng.next() - .5) * 1.4, sp = 5 + this.rng.next() * 3;
        this._emit(IMPACT_KIND.shard, x, y, z, .16 * g, C.color, .24, { vx: Math.cos(a) * sp, vy: 1 + this.rng.next() * 2, vz: Math.sin(a) * sp, angle: this.rng.next() * 6.28, stretch: 1.8, grow: .8, gravity: 12 });
      }
      if (finisher) {
        this.mark(pos, C.color, { radius: 1.5 * g, life: .5, style: MARK_STYLE.thorn, angle: this.rng.next() * 6.28, delay: .03 });
        this._emit(IMPACT_KIND.ring, x, y, z, 2.1 * g, C.color, .26, { grow: 1, delay: .03 });
      }
    } else if (C.shape === 'orb') {
      // 대마도사: 비전 청 구체 — 짙은 청 코어와 안쪽 고리가 단계마다 커진다. 마무리는 겹고리 + 청 십자 별빛.
      this._emit(IMPACT_KIND.core, x, y, z, C.base * g, C.color, .14 + .04 * s, { grow: .5 });
      this._emit(IMPACT_KIND.ring, x, y, z, 1.25 * g, C.color, .2 + .05 * s, { grow: 1 });
      if (s > .45 && !lite) this._emit(IMPACT_KIND.ring, x, y, z, .8 * g, C.hot, .18, { grow: 1, delay: .04 });
      if (finisher) {
        this._emit(IMPACT_KIND.star, x, y, z, 2.2 * g, C.color, .16, { angle: .785, grow: .5 });
        this._emit(IMPACT_KIND.ring, x, y, z, 2.6 * g, C.color, .3, { grow: 1, delay: .05 });
        if (!lite) this.mark(pos, C.color, { radius: 2 * g, life: .45, style: MARK_STYLE.compass, angle: this.rng.next() * 6.28 });
      }
    } else if (C.shape === 'cross') {
      // 암살자: 보라 교차 베기 — 두 자국이 한 박자 차로 X 를 긋고, 단계가 오르면 세 번째 가로 자국. 마무리는 네 갈래 자국 + 보라 파편.
      const w = .72 + .18 * s;
      this._emit(IMPACT_KIND.cut, x, y, z, C.base * g, C.color, .17, { angle: angle + w, stretch: 1.25, grow: .92 });
      this._emit(IMPACT_KIND.cut, x, y + .03, z, C.base * g * .92, C.deep, .17, { angle: angle - w, stretch: 1.25, grow: .92, delay: .03 });
      if (s > .6 && !lite) this._emit(IMPACT_KIND.cut, x, y + .06, z, C.base * g * .8, C.color, .15, { angle, stretch: 1.4, grow: .92, delay: .06 });
      if (finisher) {
        // 마무리 X 두 자국은 중심을 비켜 위·아래로 벌려 긋는다(네 자국이 한 점에 겹쳐 하얗게 타던 것을 막는다).
        for (let i = 0; i < 2; i++) this._emit(IMPACT_KIND.cut, x, y + (i ? -.35 : .35), z, C.base * g * .95, C.deep, .2, { angle: angle + 1.5708 * i + .785, stretch: 1.5, grow: .92, delay: .07 + i * .025 });
        for (let i = 0, n = lite ? 3 : 6; i < n; i++) {
          const a = (i / n) * 6.2831853 + .3, sp = 6 + this.rng.next() * 3;
          this._emit(IMPACT_KIND.shard, x, y, z, .2, C.color, .3, { vx: Math.cos(a) * sp, vy: 1.5, vz: Math.sin(a) * sp, angle: a, stretch: 1.8, grow: .8, gravity: 10, delay: .07 });
        }
      }
    } else if (C.shape === 'smash') {
      // 광전사: 불씨 주황 내려찍기 — 위에서 아래로 그어지는 자국 + 땅에 퍼지는 불씨 고리. 단계마다 커지고 마무리는 큰 땅 표식 + 솟는 불씨 기둥.
      this._emit(IMPACT_KIND.cut, x, y + .3, z, C.base * g, C.color, .2, { angle: -1.5708 + flip * .35, stretch: 1.3, grow: .9 });
      this.mark(pos, C.color, { radius: C.base * .9 * g, life: .32 + .06 * s, style: MARK_STYLE.compass, angle: this.rng.next() * 6.28 });
      for (let i = 0, n = lite ? 2 : 3 + Math.round(2 * s); i < n; i++) {
        const a = this.rng.next() * 6.2831853, sp = 1.5 + this.rng.next() * 2;
        this._emit(IMPACT_KIND.streak, pos.x, .4, pos.z, .17, i % 2 ? C.hot : C.color, .4 + this.rng.next() * .2,
          { vx: Math.cos(a) * sp, vy: 4 + this.rng.next() * 3, vz: Math.sin(a) * sp, stretch: .5, grow: 1, gravity: -1.5 });
      }
      if (finisher) {
        this.mark(pos, C.color, { radius: 2.8 * g, life: .55, style: MARK_STYLE.thorn, angle: this.rng.next() * 6.28, delay: .03 });
        this._emit(IMPACT_KIND.ring, pos.x, .5, pos.z, 3 * g, C.color, .3, { grow: 1, delay: .03 });
        for (let i = 0, n = lite ? 2 : 5; i < n; i++) {
          const a = (i / n) * 6.2831853, r = .6 + this.rng.next() * .5;
          this._emit(IMPACT_KIND.flame, pos.x + Math.cos(a) * r, .5, pos.z + Math.sin(a) * r, .36, i % 2 ? C.hot : C.color, .5 + this.rng.next() * .15, { vy: 2, grow: .5, gravity: -5, delay: .05 });
        }
      }
    }
    return this.spawned - before;
  }
  /** 공격 예비 동작의 짧은 광채(무기 끝 별빛). delay 초 뒤(타격 직전)에 켜진다. */
  glint(pos, color, { size = .8, delay = 0, life = .12 } = {}) {
    if (!this.enabled || this.lite || !pos) return false;
    return this._emit(IMPACT_KIND.star, pos.x, pos.y, pos.z, size, color, life, { angle: .3, grow: .3, delay });
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
  /**
   * 화살·관통 광선 한 줄. from 에서 dir 방향 length(m)까지 speed(m/s)로 머리가 나아가고 tail(m) 뒤에서 꼬리가 따라온다.
   * 화살과 같은 속도·궤적이라 '어디로 꿰뚫었는지'가 남는다. 돌려준 표(handle)로 명중 시 stopBeam 해 과녁에서 멈춘다.
   * @param {any} from @param {any} dir @param {number} length @param {number} color
   * @param {{speed?: number, tail?: number, width?: number, style?: number, delay?: number, fade?: number}} [opts]
   * @returns {{slot: number, start: number}|null}
   */
  beam(from, dir, length, color, { speed = 0, tail = 0, width = .09, style = BEAM_STYLE.line, delay = 0, fade = .12 } = {}) {
    if (!this.enabled || !from || !dir || !(length > 0)) return null;
    const dl = Math.hypot(dir.x, dir.y, dir.z); if (!(dl > 1e-6)) return null;
    const L = Math.min(60, length), k = L / dl;
    // 수명: 머리가 끝에 닿고 꼬리가 따라올 때까지. 꼬리가 없으면 도달 뒤 fade 초 동안 사라진다.
    const life = speed > 0 ? (L + (tail > 0 ? tail : speed * fade)) / speed : fade;
    if (!this._emit(IMPACT_KIND.beam, from.x, from.y, from.z, width, color, life, { vx: dir.x * k, vy: dir.y * k, vz: dir.z * k, angle: style, stretch: tail, grow: speed, delay })) return null;
    const slot = this.lastSlot;
    return { slot, start: this.ring.a.aLife[slot * 2] };
  }
  /** 화살 한 발의 궤적(+ 옅은 번짐, 활 끝 작은 고리). 화살과 같은 속도로 그어진다. 명중 정지용 표를 돌려준다. */
  arrowStreak(pos, dir, speed, life, style = 'basic') {
    if (!this.enabled || !pos || !dir) return null;
    const S = ARROW_STREAKS[style] || ARROW_STREAKS.basic, len = speed * life;
    if (this.lite && !S.glow) return this.beam(pos, dir, len, S.color, { speed, tail: S.tail * .7, width: S.width, style: S.style });
    const glow = S.glow > 0 && !this.lite ? this.beam(pos, dir, len, S.color, { speed, tail: S.tail * .55, width: S.glow, style: 0 }) : null;
    const h = this.beam(pos, dir, len, S.color, { speed, tail: S.tail, width: S.width, style: S.style });
    if (S.muzzle > 0) this._emit(IMPACT_KIND.ring, pos.x, pos.y, pos.z, S.muzzle, S.color, .16, { grow: 1 });
    if (h && glow) h.glow = glow;
    return h || glow;
  }
  /** 명중해 사라진 화살의 광선을 과녁(이동 거리 traveled)에서 멈추고 꼬리가 따라와 닫히게 한다. 칸이 재활용됐으면 무시한다. */
  stopBeam(handle, traveled) {
    if (!handle || !(traveled >= 0)) return false;
    if (handle.glow) this.stopBeam(handle.glow, traveled);
    const A = this.ring.a, i2 = handle.slot * 2, i3 = handle.slot * 3, i4 = handle.slot * 4;
    if (A.aLife[i2] !== handle.start || A.aShape[i4] !== IMPACT_KIND.beam) return false;
    const L = Math.hypot(A.aVel[i3], A.aVel[i3 + 1], A.aVel[i3 + 2]); if (!(L > 1e-6) || traveled >= L) return false;
    const speed = A.aMotion[i2], tail = A.aShape[i4 + 3], k = Math.max(.01, traveled) / L;
    A.aVel[i3] *= k; A.aVel[i3 + 1] *= k; A.aVel[i3 + 2] *= k;
    if (speed > 0) {
      A.aLife[i2 + 1] = Math.min(A.aLife[i2 + 1], (traveled + (tail > 0 ? tail : speed * .12)) / speed);
      this.ring.expiry[handle.slot] = A.aLife[i2] + A.aLife[i2 + 1];
    }
    const r = this.ring; if (handle.slot < r.lo) r.lo = handle.slot; if (handle.slot > r.hi) r.hi = handle.slot;
    return true;
  }
  /** 지면에 눕는 표식 한 장(조준 원·부채꼴·가시 고리·나침 고리). radius m, angle 은 월드 XZ 회전(라디안).
   * @param {any} pos @param {number} color
   * @param {{radius?: number, life?: number, style?: number, angle?: number, delay?: number, y?: number}} [opts] */
  mark(pos, color, { radius = 1.5, life = .6, style = MARK_STYLE.reticle, angle = 0, delay = 0, y = .06 } = {}) {
    if (!pos) return false;
    return this._emit(IMPACT_KIND.mark, pos.x, (pos.y || 0) + y, pos.z, radius, color, life, { angle, stretch: style, delay });
  }
  /** 살아 있는 칸 수(점검·테스트용). */
  live() { return this.ring.live(this.clock); }
  clear() { this.recent.fill(-1e9); this.recentAt = 0; this.ring.clear(); this.clock = 0; this.uTime.value = 0; this.rng = new VfxRng(this.seed); this.budget = IMPACT_FRAME_BUDGET; }
  dispose() { this.ring.dispose(); }
}
