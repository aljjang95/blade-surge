import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE } from './impact-vfx.js';

/**
 * barbarian 스킬 '모양 언어' 서명(h1b). skill-signatures.js 가 합친다. 규칙은 그 파일 머리 주석과 같다:
 * 인스턴스 임팩트 층(드로우콜 1)만 쓰고, 판정 시각은 delay 칸으로 맞추며, 프레임당 할당·Math.random 을 쓰지 않는다.
 * 광전사 언어 = 불씨·분노: 주황·진홍 불똥(위로 솟는 불꽃 줄기), 바닥을 가르는 용암 균열(지면 광선), 붉은 분노 고리(가시 표식),
 * 도끼 호(베기 자국). 흰 코어 섬광은 쓰지 않는다(크림 덩어리 방지). 시전 뒤 판정이 매 틱 나는 회오리·돌진 끝은
 * skills.js 가 판정 순간에 아래 도우미(barbWhirlTick·barbRushEnd)를 부른다.
 */
export const BARB_COLORS = Object.freeze({ ember: 0xff5a1e, flame: 0xff8a26, crimson: 0xe0221a, blood: 0xb81410, molten: 0xffa83a });
const { ember: EMBER, flame: FLAME, crimson: CRIMSON, blood: BLOOD, molten: MOLTEN } = BARB_COLORS;
/** 금빛 하이라이트(강화 레인 2026-10-29): 적 표식 붉은색(#ff3b30)과 겹치지 않게 날 끝·궤적 머리는 주황·금으로 밝힌다. 빨강 우세(r>g>b)는 유지. */
const GOLD = 0xffc23a, HOT = 0xffb030;
/** 늑대인간 족장(고유 스킬 2종) 팔레트: 핏빛 진홍·분홍, 월광 은백. 광전사 주황과 한눈에 갈린다. */
const WOLF_RED = 0xc81830, WOLF_PINK = 0xff5a6a, MOON = 0xd8e4ff, DEEP_WOLF = 0x8a1020, DEEP_MOON = 0x6a78a8;
const TAU = Math.PI * 2;
/** 큰 지면 표식(6m 이상)은 가산이라 원색 그대로면 바닥이 분홍·크림으로 바랜다. 같은 색상을 어둡게 낮춰 채도를 지킨다. */
const DEEP_EMBER = 0xb8380e, DEEP_CRIMSON = 0xa0140e;
/** 가시 고리 표식은 반경이 커지면 옅은 바퀴(크림·분홍 원판)로 읽힌다. 넓은 판정은 용암 균열 길이로 보이고 표식은 이 반경까지만. */
const THORN_MAX = 4.5;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _g = new THREE.Vector3(), _p = new THREE.Vector3();
/** 실제 임팩트 층인지(테스트 대역·미초기화 FX 에서 도우미가 전투 루프를 깨지 않게). */
const live = (impact) => !!impact && impact.enabled !== false && typeof impact.beam === 'function' && typeof impact.mark === 'function' && !!impact.rng;
const yawOf = (f) => Math.atan2(f.z, f.x);

/** 바닥을 가르는 용암 균열: 중심에서 바깥으로 n 갈래 지면 광선이 speed(m/s)로 뻗는다. 쓴 칸 수를 돌려준다. */
export function lavaFissures(impact, c, n, r0, r1, color, { delay = 0, width = .11, speed = 45, phase = 0, fade = .45 } = {}) {
  let used = 0;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU + (impact.rng.next() - .5) * (TAU / n) * .5;
    _d.set(Math.cos(a), 0, Math.sin(a));
    _a.set(c.x + _d.x * r0, .07, c.z + _d.z * r0);
    const len = (r1 - r0) * (.7 + impact.rng.next() * .3);
    if (impact.beam(_a, _d, len, color, { speed, width: width * (.8 + impact.rng.next() * .4), delay, fade })) used++;
  }
  return used;
}

/** 위로 솟는 불씨 줄기(음의 중력). 반경 r 안 n 점에서 솟는다. */
export function risingEmbers(impact, c, n, r, color, { delay = 0, rise = 7, life = .55, size = .22, y = .3 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = impact.rng.next() * TAU, rr = r * Math.sqrt(impact.rng.next());
    impact._emit(IMPACT_KIND.streak, c.x + Math.cos(a) * rr, y + impact.rng.next() * .6, c.z + Math.sin(a) * rr, size * (.75 + impact.rng.next() * .5), color,
      life * (.75 + impact.rng.next() * .5), { vx: Math.cos(a) * 1.2, vy: rise * (.6 + impact.rng.next() * .6), vz: Math.sin(a) * 1.2, stretch: 1.1, grow: 1, gravity: -3, delay });
  }
}

/** 땅에서 비스듬히 솟는 불꽃 혀·바위 가시(지면에서 위·바깥으로 그어지는 짧은 광선). */
function earthSpikes(impact, c, n, r0, r1, color, { delay = 0, h = 2, width = .3, fade = .4, phase = 0, out = .5 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU + (impact.rng.next() - .5) * .4, r = r0 + (r1 - r0) * impact.rng.next();
    _a.set(c.x + Math.cos(a) * r, .02, c.z + Math.sin(a) * r);
    _b.set(Math.cos(a) * out, 1, Math.sin(a) * out);
    impact.beam(_a, _b, h * (.7 + impact.rng.next() * .6), color, { speed: 16, tail: h * .6, width, delay, fade });
  }
}

/** 주변으로 터지는 불똥(중력 낙하). */
function sparks(impact, c, n, speed, color, { delay = 0, up = 4, life = .4, size = .24, y = .6 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + impact.rng.next() * .6, s = speed * (.6 + impact.rng.next() * .6);
    impact._emit(IMPACT_KIND.streak, c.x, y, c.z, size * (.8 + impact.rng.next() * .4), color, life * (.8 + impact.rng.next() * .4),
      { vx: Math.cos(a) * s, vy: up * (.5 + impact.rng.next()), vz: Math.sin(a) * s, stretch: .9, grow: 1, gravity: 16, delay });
  }
}

/**
 * 회전 궤적 고리: 반경 r, 높이 y 의 원을 segs 개 현(광선)으로 나눠 a0 에서 span 만큼 차례로 긋는다. 각 현은 앞 현이 끝나는
 * 순간 시작해(지연 = 누적 길이/속도) 머리가 원을 따라 실제로 '돌아가는' 궤적이 되고, 꼬리(tail m)가 뒤따라 닫힌다.
 * dir = +1 반시계, -1 시계. 쓴 칸 수를 돌려준다.
 */
export function sweepArc(impact, c, r, y, a0, span, segs, speed, color, { delay = 0, tail = 2.5, width = .12, dir = 1 } = {}) {
  let used = 0; const step = (span / segs) * dir, chord = 2 * r * Math.sin(Math.abs(step) / 2);
  for (let k = 0; k < segs; k++) {
    const a = a0 + k * step, b = a + step;
    _a.set(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
    _b.set(Math.cos(b) * r - Math.cos(a) * r, 0, Math.sin(b) * r - Math.sin(a) * r);
    if (impact.beam(_a, _b, chord, color, { speed, tail, width, delay: delay + (k * chord) / speed })) used++;
  }
  return used;
}

/** 솟는 파편(바위 조각): 점 p 에서 위·바깥으로 튀어 중력으로 떨어지는 마름모. */
function debris(impact, x, z, n, color, { delay = 0, up = 7, out = 2.5, size = .3, life = .55, phase = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU + impact.rng.next() * .8, s = out * (.5 + impact.rng.next());
    impact._emit(IMPACT_KIND.shard, x, .25, z, size * (.7 + impact.rng.next() * .6), color, life * (.8 + impact.rng.next() * .4),
      { vx: Math.cos(a) * s, vy: up * (.6 + impact.rng.next() * .6), vz: Math.sin(a) * s, angle: a, stretch: 1.6, grow: .9, gravity: 18, delay });
  }
}

/**
 * 전방으로 달려 나가는 용암 균열: 시작점 o 에서 방향 f 기준 ±cone 부채 안 n 갈래가 speed(m/s)로 뻗고,
 * 각 갈래 중간에서 가지가 꺾여 나가며, 균열 머리가 지나가는 자리마다 파편이 솟는다(지연 = 거리/속도).
 */
function runningFissures(impact, o, f, n, len, cone, color, { delay = 0, speed = 26, width = .14, lite = false, shards = true } = {}) {
  const yaw = yawOf(f);
  for (let i = 0; i < n; i++) {
    const a = yaw + (n > 1 ? (i / (n - 1) - .5) * 2 * cone : 0) + (impact.rng.next() - .5) * .12;
    const L = len * (.75 + impact.rng.next() * .25);
    _d.set(Math.cos(a), 0, Math.sin(a)); _a.set(o.x, .07, o.z);
    impact.beam(_a, _d, L, color, { speed, width, delay, fade: .5 });
    // 가지: 길이 45~60% 지점에서 바깥쪽으로 꺾인다(균열이 갈라지는 실루엣).
    const m = L * (.45 + impact.rng.next() * .15), side = i < n / 2 ? -1 : 1, b = a + side * (.5 + impact.rng.next() * .25);
    _b.set(o.x + _d.x * m, .07, o.z + _d.z * m); _d.set(Math.cos(b), 0, Math.sin(b));
    impact.beam(_b, _d, L * .4, i % 2 ? GOLD : FLAME, { speed, width: width * .7, delay: delay + m / speed, fade: .45 });
    // 균열 머리가 지나간 자리에서 솟는 바위 파편.
    if (shards && !lite) for (const t of [.4, .85]) debris(impact, o.x + Math.cos(a) * L * t, o.z + Math.sin(a) * L * t, 2, t > .5 ? GOLD : MOLTEN, { delay: delay + (L * t) / speed, phase: a });
  }
}

/**
 * 회오리 매 판정 틱(i)마다 skills.js 가 부른다: 도끼 날 높이(0.9m)·반경 2.3m 를 실제로 돌아가는 궤적 반 바퀴(현 광선이 차례로 그어짐)
 * + 날 끝 금빛 베기 자국 + 접선 방향으로 바깥으로 튀는 불똥. 바닥 원형 표식은 쓰지 않는다(정적인 붉은 원 대신 움직이는 고리).
 * 틱마다 시작각이 돌아가(i×1.5) 연속 틱이 겹치지 않고 회전하는 고리 여러 겹으로 읽힌다.
 */
export function barbWhirlTick(game, pos, i) {
  const impact = game?.fx?.impact; if (!live(impact) || !pos || game.app?.reducedMotion?.matches) return 0;
  const lite = !!game.fx.lite, before = impact.spawned, R = 2.3, a0 = Math.PI / 2 - i * 1.5;
  // 회전 궤적 반 바퀴(시계 방향, 0.2초에 3.4라디안). 홀수 틱은 살짝 낮게 그어 두 겹 고리처럼 엇갈린다.
  sweepArc(impact, pos, R + (i % 2) * .5, i % 2 ? .6 : .95, a0, 3.4, lite ? 3 : 5, 42, i % 2 ? FLAME : MOLTEN, { tail: 4.5, width: .17, dir: -1 });
  // 날 끝 베기 자국(금빛, 작게): 크게 여러 장 겹치면 영웅을 덮는 옅은 기둥이 됐다.
  _d.set(-Math.sin(a0), 0, Math.cos(a0));
  impact._emit(IMPACT_KIND.cut, pos.x + Math.cos(a0) * R, .9, pos.z + Math.sin(a0) * R, 1.5, GOLD, .18, { angle: impact._screenAngle(_d), stretch: 1.3, grow: .8 });
  // 접선(회전 방향) + 바깥으로 튀는 불똥: 원심력으로 날아가는 쇳불.
  const n = lite ? 2 : 5;
  for (let k = 0; k < n; k++) {
    const a = a0 - (k / n) * 3.4, r = R * (.9 + impact.rng.next() * .3);
    impact._emit(IMPACT_KIND.streak, pos.x + Math.cos(a) * r, .8 + impact.rng.next() * .5, pos.z + Math.sin(a) * r, .2, k % 2 ? GOLD : EMBER, .32,
      { vx: Math.sin(a) * 9 + Math.cos(a) * 6, vy: 2.5, vz: -Math.cos(a) * 9 + Math.sin(a) * 6, stretch: 1.1, grow: 1, gravity: 12, delay: (k / n) * .08 });
  }
  return impact.spawned - before;
}

/** 돌진 끝 폭발(판정 순간 skills.js end 가 부른다): 앞으로 터지는 용암 균열 부채 + 분노 고리 + 불씨 기둥. */
export function barbRushEnd(game, center, f) {
  const impact = game?.fx?.impact; if (!live(impact) || !center || game.app?.reducedMotion?.matches) return 0;
  const lite = !!game.fx.lite, before = impact.spawned;
  impact.mark(center, DEEP_CRIMSON, { radius: THORN_MAX, life: .5, style: MARK_STYLE.thorn, angle: yawOf(f) });
  // 사방 균열 대신 밀어붙인 방향(±40°)으로만 달려 나가는 균열 부채: 돌진의 화살촉 실루엣이 끝에서 앞으로 터진다.
  _p.copy(center).setY(0);
  runningFissures(impact, _p, f, lite ? 3 : 5, 7.5, .7, EMBER, { speed: 40, width: .16, shards: false });
  risingEmbers(impact, center, lite ? 5 : 10, 3, FLAME);
  // 밀어붙인 방향으로 펼쳐지는 불씨 부채 + 앞쪽 불꽃 혀(벽처럼 뭉친 적이 터진 자리).
  _a.copy(center).addScaledVector(f, -2.4);
  impact.mark(_a, DEEP_EMBER, { radius: 6.2, life: .45, style: MARK_STYLE.fan, angle: yawOf(f) });
  earthSpikes(impact, center, lite ? 4 : 9, 1, 4, EMBER, { h: 2.6, width: .32, out: .6, phase: yawOf(f) });
  impact._emit(IMPACT_KIND.cut, center.x, 1.3, center.z, 3.6, FLAME, .26, { angle: impact._screenAngle(_d.set(-f.z, 0, f.x)), stretch: 1.3, grow: .8 });
  return impact.spawned - before;
}

/**
 * 궁극기 예비 표식(시전 연출 중 바로 보인다). skill-signatures.js 의 SKILL_PRELUDES 가 합친다.
 * @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>}
 */
export const PRELUDES = {
  // 지옥의 도끼 1박(예비, 도약 전 .5초): 원형 문양 대신 '모으기' — 사방에서 불씨가 몸으로 빨려 들고(압축),
  // 도끼 끝 금빛 별빛이 번쩍인 뒤(.34초) 발밑에서 하늘로 도약 궤적 두 줄이 솟는다(.4초).
  hell_axe(ctx) {
    const { impact, player, lite } = ctx; const p = player.pos;
    impact.mark(p, GOLD, { radius: 1.5, life: .55, style: MARK_STYLE.compass });
    const n = lite ? 6 : 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + impact.rng.next() * .3, r = 3 + impact.rng.next() * 1.2, y = .3 + impact.rng.next() * 1.6;
      impact._emit(IMPACT_KIND.streak, p.x + Math.cos(a) * r, y, p.z + Math.sin(a) * r, .22, i % 2 ? FLAME : GOLD, .36,
        { vx: -Math.cos(a) * r / .36, vy: (1.2 - y) / .36, vz: -Math.sin(a) * r / .36, stretch: 1.2, grow: 1, delay: (i % 4) * .03 });
    }
    impact._emit(IMPACT_KIND.star, p.x, 2.4, p.z, 1.5, GOLD, .16, { angle: .3, grow: .4, delay: .34 });
    _d.set(0, 1, 0);
    for (const [k, c] of (lite ? [[0, FLAME]] : [[0, FLAME], [1, GOLD]])) {
      _a.set(p.x + (k ? .5 : -.4), .3, p.z); impact.beam(_a, _d, 10, c, { speed: 34, tail: 4, width: k ? .1 : .16, delay: .4 + k * .03 });
    }
  },
  // 월광 사냥: 도약 전 발밑에 은빛 고리 두 겹이 잡히고, 은백 입자가 위로 솟는다(달빛을 받는다).
  moonlit_hunt(ctx) {
    const { impact, player, lite } = ctx;
    impact.mark(player.pos, DEEP_MOON, { radius: 3.2, life: .9, style: MARK_STYLE.thorn });
    impact._emit(IMPACT_KIND.ring, player.pos.x, .4, player.pos.z, 3.6, MOON, .5, { grow: 1 });
    risingEmbers(impact, player.pos, lite ? 6 : 14, 2.2, MOON, { rise: 11, life: .8 });
    risingEmbers(impact, player.pos, lite ? 3 : 6, 1.6, WOLF_PINK, { rise: 8, life: .6, delay: .1 });
  },
  // 용암 분출·진 예비(시전 .43초 전): 여섯 기둥이 솟을 자리(반경 4.6m, 각 .4+i×60°)에 짙은 조준 원이 잡히고, 발밑에서 그 자리로
  // 가는 가는 균열이 .38초에 걸쳐 기어간다. 각 조준 원은 제 기둥이 솟는 순간(.43+i×.11초) 사라진다 — '어디서 솟는지'를 미리 읽힌다.
  magma_zone(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos, LEAD = .43;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + .4;
      _p.set(c.x + Math.cos(a) * 4.6, 0, c.z + Math.sin(a) * 4.6);
      impact.mark(_p, DEEP_EMBER, { radius: 1.3, life: LEAD + i * .11 + .04, style: MARK_STYLE.reticle, angle: a });
      if (!lite) { _d.set(Math.cos(a), 0, Math.sin(a)); _a.set(c.x + _d.x * .6, .07, c.z + _d.z * .6); impact.beam(_a, _d, 3.4, DEEP_EMBER, { speed: 9, width: .06, fade: .2 }); }
    }
  },
  // 종말·화산심장 예비(도약 전): 발밑이 짓눌려 짧은 진홍 균열 다섯 갈래가 퍼지고, 도약 순간(.35초) 바위 파편이 튀며
  // 발밑에서 하늘로 도약 궤적(불꽃 + 금빛 심)이 솟는다. 지옥의 도끼(사방에서 빨려 드는 불씨 + 나침 표식)와 다른 '눌렀다 튀는' 박자.
  cataclysm(ctx) {
    const { impact, player, lite } = ctx; const p = player.pos, UP = .35;
    impact.mark(p, DEEP_EMBER, { radius: 1.4, life: UP + .1, style: MARK_STYLE.reticle });
    lavaFissures(impact, p, lite ? 3 : 5, .4, 2.4, CRIMSON, { speed: 12, width: .12, fade: .25 });
    debris(impact, p.x, p.z, lite ? 3 : 6, MOLTEN, { delay: UP, up: 8, out: 2.6, size: .26 });
    _d.set(0, 1, 0);
    for (const [k, c] of (lite ? [[0, FLAME]] : [[0, FLAME], [1, GOLD]])) {
      _a.set(p.x + (k ? .4 : -.3), .3, p.z); impact.beam(_a, _d, 8, c, { speed: 30, tail: 3.5, width: k ? .1 : .18, delay: UP + k * .03 });
    }
  },
};

/** @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>} */
export const SIGNATURES = {
  // 회오리 참격: 시전 순간 판정 반경(3.8m) 바닥 높이와 도끼 날 높이(1.1m)에 회전 궤적 고리 두 겹이 실제로 한 바퀴 돌며 그어지고
  // (바깥 금빛 .4초, 안쪽 불꽃 .3초), 원심력으로 불똥이 바깥으로 튄다. 틱마다의 반 바퀴 궤적은 barbWhirlTick.
  whirlwind(ctx) {
    const { impact, player, lite } = ctx; const p = player.pos;
    sweepArc(impact, p, 3.8, .3, 0, TAU, lite ? 6 : 12, 60, GOLD, { tail: 9, width: .17, dir: -1 });
    sweepArc(impact, p, 2.6, 1.1, Math.PI, TAU, lite ? 4 : 8, 50, FLAME, { tail: 6, width: .2, dir: -1, delay: .04 });
    sparks(impact, p, lite ? 5 : 10, 11, MOLTEN, { up: 3, life: .45, size: .22, y: .9 });
  },
  // 대지 분쇄: 내리찍은 자리(at)에 금빛 세로 도끼 자국 + 작은 충격 고리, 거기서 전방 부채(±26°)로 용암 균열 다섯 갈래가
  // 28m/s 로 달려 나가며 중간에 갈라지고, 균열 머리가 지나는 자리마다 바위 파편이 솟는다. 넓은 원형 문양은 쓰지 않는다.
  quake(ctx) {
    const { impact, at, f, lite } = ctx;
    impact._emit(IMPACT_KIND.cut, at.x, 1.4, at.z, 3, GOLD, .2, { angle: -Math.PI / 2 + .2, grow: .7 });
    impact._emit(IMPACT_KIND.ring, at.x, .4, at.z, 2.6, MOLTEN, .26, { grow: 1 });
    runningFissures(impact, at, f, lite ? 3 : 5, 9.5, .45, EMBER, { speed: 28, width: .2, lite });
    // 뒤쪽 짧은 잔균열 세 갈래(내리찍은 반동).
    _b.copy(f).multiplyScalar(-1);
    runningFissures(impact, at, _b, lite ? 1 : 3, 2.6, .7, DEEP_EMBER, { speed: 28, width: .1, shards: false });
    debris(impact, at.x, at.z, lite ? 3 : 6, MOLTEN, { up: 8, out: 3 });
  },
  // 광폭화: 몸에서 피어오르는 분노 기둥 — 발밑에서 머리 위 5m 까지 감아 오르는 불꽃 나선 두 가닥(.25초에 그어짐),
  // 몸을 따라 핥아 오르는 불꽃 혀 두 물결, 위로 떠오르는 영혼 불꽃. 바닥 원형 문양은 금빛 작은 고리 하나뿐.
  berserk(ctx) {
    const { impact, player, lite } = ctx; const p = player.pos;
    const segs = lite ? 4 : 7, turns = 1.25, H = 5.4, R0 = 1.55;
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 1) / segs, a0 = s * Math.PI + t0 * turns * TAU, a1 = s * Math.PI + t1 * turns * TAU;
        const r0 = R0 * (1 - t0 * .35), r1 = R0 * (1 - t1 * .35);
        _a.set(p.x + Math.cos(a0) * r0, .3 + t0 * H, p.z + Math.sin(a0) * r0);
        _b.set(p.x + Math.cos(a1) * r1 - _a.x, (t1 - t0) * H, p.z + Math.sin(a1) * r1 - _a.z);
        impact.beam(_a, _b, _b.length(), s ? GOLD : FLAME, { speed: 26, tail: 3.6, width: s ? .14 : .2, delay: s * .06 + k * .045 });
      }
    }
    for (let w = 0; w < 2; w++) earthSpikes(impact, p, lite ? 3 : 6, .7, 1, w ? EMBER : CRIMSON, { delay: w * .2, h: 4.2, width: .3, out: .12, phase: w * .5, fade: .3 });
    const n = lite ? 5 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r = .5 + impact.rng.next() * .4;
      impact._emit(IMPACT_KIND.flame, p.x + Math.cos(a) * r, .4 + impact.rng.next() * .8, p.z + Math.sin(a) * r, .45, i % 3 ? EMBER : MOLTEN, .6,
        { vy: 5 + impact.rng.next() * 3, grow: .6, gravity: -2, delay: (i % 3) * .1 });
    }
    impact._emit(IMPACT_KIND.ring, p.x, .3, p.z, 1.8, GOLD, .24, { grow: 1 });
  },
  // 지옥의 도끼(궁극기) 2·3박: 착탄점에 금빛 나침 표식(조준)이 잡히고 하늘에서 불의 궤적 두 줄이 .5초 뒤(판정 순간)에 꽂힌다.
  // 착탄: 세로 도끼 자국 + 충격 고리 + 파편 분출 + 화염 분수 → .08초 뒤 사방 용암 균열, .14초 뒤 금빛 2차 균열(3박).
  hell_axe(ctx) {
    const { impact, at: t, lite } = ctx; const FALL = .5;
    impact.mark(t, GOLD, { radius: 1.9, life: FALL + .2, style: MARK_STYLE.compass });
    _d.set(0, -1, 0);
    _a.set(t.x, 16, t.z); impact.beam(_a, _d, 16, FLAME, { speed: 32, tail: 7, width: .32 });
    _a.set(t.x + .4, 16, t.z); impact.beam(_a, _d, 16, GOLD, { speed: 32, tail: 4, width: .12, delay: .02 });
    impact._emit(IMPACT_KIND.cut, t.x, 2.2, t.z, 5.5, FLAME, .3, { angle: -Math.PI / 2 + .25, grow: .7, delay: FALL - .04 });
    impact._emit(IMPACT_KIND.ring, t.x, .5, t.z, 5.5, EMBER, .34, { grow: 1, delay: FALL });
    debris(impact, t.x, t.z, lite ? 4 : 8, MOLTEN, { delay: FALL, up: 10, out: 5, size: .38 });
    _d.set(0, 1, 0);
    for (let i = 0; i < (lite ? 1 : 3); i++) {
      const a = (i / 3) * TAU + .6, r = i === 0 ? 0 : 1.8;
      _a.set(t.x + Math.cos(a) * r, 0, t.z + Math.sin(a) * r);
      impact.beam(_a, _d, i === 0 ? 11 : 6, i === 0 ? FLAME : GOLD, { speed: 50, tail: 5, width: i === 0 ? .4 : .18, delay: FALL + i * .03 });
    }
    lavaFissures(impact, t, lite ? 5 : 8, .8, 12, EMBER, { delay: FALL + .08, speed: 55, width: .15 });
    lavaFissures(impact, t, lite ? 3 : 8, 2, 8, GOLD, { delay: FALL + .14, speed: 45, width: .09, phase: TAU / 16 });
    risingEmbers(impact, t, lite ? 4 : 10, 4, FLAME, { delay: FALL, rise: 9 });
  },
  // 핏빛 포효: 진홍 가시 고리 두 겹(반대 회전) + 분홍·진홍 공포 충격파 세 겹이 판정 반경(7m)까지 퍼지고, 핏빛 불씨가 솟는다.
  blood_howl(ctx) {
    const { impact, player, lite } = ctx;
    impact.mark(player.pos, WOLF_RED, { radius: 2.8, life: .9, style: MARK_STYLE.thorn });
    impact.mark(player.pos, DEEP_WOLF, { radius: THORN_MAX, life: .7, style: MARK_STYLE.thorn, angle: .31, delay: .1 });
    for (const [i, d] of [0, .1, .2].entries()) impact._emit(IMPACT_KIND.ring, player.pos.x, .6, player.pos.z, 3 + i * 1.6, i === 1 ? WOLF_PINK : WOLF_RED, .34, { grow: 1, delay: d });
    for (let w = 0; w < 2; w++) risingEmbers(impact, player.pos, lite ? 5 : 11, 1.2, w ? WOLF_PINK : WOLF_RED, { delay: w * .16, rise: 9, life: .6, size: .26 });
  },
  // 월광 사냥 착지(도약 6번 뒤 1.4초): 착지점 은백 큰 고리 두 겹 + 진홍 고리 + 은빛 균열 + 불똥.
  moonlit_hunt(ctx) {
    const { impact, at: t, lite } = ctx; const LAND = 1.4;
    impact.mark(t, DEEP_MOON, { radius: THORN_MAX, life: .6, style: MARK_STYLE.thorn, delay: LAND });
    impact._emit(IMPACT_KIND.ring, t.x, .5, t.z, 6.4, MOON, .4, { grow: 1, delay: LAND });
    impact._emit(IMPACT_KIND.ring, t.x, .5, t.z, 4.2, WOLF_RED, .34, { grow: 1, delay: LAND + .08 });
    lavaFissures(impact, t, lite ? 6 : 12, .8, 7.5, MOON, { delay: LAND, speed: 60, width: .12 });
    risingEmbers(impact, t, lite ? 7 : 16, 4, MOON, { delay: LAND, rise: 9 });
    sparks(impact, t, lite ? 4 : 8, 13, WOLF_PINK, { delay: LAND });
  },
  // 광란의 돌진(각성 1) — '불도저 화살촉': 길 한가운데 용암 균열(주황 + 금빛 심)이 영웅과 같은 속도(21m/s)로 그어지고,
  // 몸이 지나간 자리마다 뒤로 벌어지는 V자 선수파(지면 광선 두 줄)가 남아 화살촉 실루엣이 된다. 몸 앞에는 밀어붙이는 초승달
  // 베기 자국이 3m마다 찍히고 길가로 바위 파편이 튄다. 끝 폭발 자리(남은 돌진 약 12.4m + 2.4m)에 금빛 나침 표식이 미리 잡힌다.
  bull_rush(ctx) {
    const { impact, player, f, lite } = ctx; const V = 21, yaw = yawOf(f);
    _a.copy(player.pos).setY(.07);
    impact.beam(_a, f, 12.4, EMBER, { speed: V, width: .2, fade: .5 });
    impact.beam(_a, f, 12.4, GOLD, { speed: V, width: .07, fade: .3 });
    _b.copy(player.pos).addScaledVector(f, 14.8);
    impact.mark(_b, GOLD, { radius: 2.2, life: .72, style: MARK_STYLE.compass, angle: yaw });
    _e.set(-f.z, 0, f.x); // 옆 방향
    const n = lite ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const d = 1.2 + i * (11 / n), t = d / V;
      // 선수파: 지나간 점에서 뒤·바깥(진행 반대 방향 ±38°)으로 벌어지는 두 줄. 뒤로 갈수록 길어져 V가 넓어진다.
      for (const s of [-1, 1]) {
        _p.copy(player.pos).addScaledVector(f, d).addScaledVector(_e, s * .5).setY(.07);
        _g.copy(f).multiplyScalar(-.79).addScaledVector(_e, s * .62);
        impact.beam(_p, _g, 2 + i * .3, i % 2 ? CRIMSON : FLAME, { speed: 16, width: .1, delay: t, fade: .3 });
      }
      if (!lite) { _p.copy(player.pos).addScaledVector(f, d); risingEmbers(impact, _p, 2, .8, i % 2 ? FLAME : EMBER, { delay: t, rise: 6 }); }
    }
    // 앞머리 초승달(몸 1.4m 앞, 어깨 높이): 3m마다 한 장, 금빛·불꽃 번갈아.
    for (let i = 0; i < (lite ? 2 : 4); i++) {
      const d = 1.4 + i * 3;
      _p.copy(player.pos).addScaledVector(f, d);
      impact._emit(IMPACT_KIND.cut, _p.x, 1.1, _p.z, 2, i % 2 ? HOT : FLAME, .16, { angle: impact._screenAngle(_e), stretch: 1.2, grow: .7, delay: Math.max(0, d - 1.4) / V });
      if (!lite && i % 2 === 0) debris(impact, _p.x, _p.z, 3, MOLTEN, { delay: Math.max(0, d - 1.4) / V, up: 5, out: 3, phase: yaw });
    }
  },
  // 용암 분출·진(각성 2) — '용암 육망성': 기둥이 솟는 박자(i×.11초)마다 중심→기둥 균열이 닿고, 앞 기둥에서 이 기둥으로 육각 테두리가
  // 이어 그어지며(42m/s), 기둥 자리에서 불기둥 심 광선·바깥으로 기운 바위 가시·파편이 솟는다. .75초 장판 순간 기둥 i→i+2 를 잇는
  // 두 삼각형(육망성)이 그어져 1초 남는다 — 원이 아니라 직선 별 실루엣. 기둥 자리 예고는 PRELUDES.magma_zone.
  magma_zone(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos, R = 4.6, A0 = .4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + A0, d = i * .11;
      _d.set(Math.cos(a), 0, Math.sin(a)); _a.set(c.x + _d.x * .8, .07, c.z + _d.z * .8);
      impact.beam(_a, _d, R - .8, EMBER, { speed: 40, width: .14, delay: Math.max(0, d - .08), fade: .5 });
      _p.set(c.x + _d.x * R, .07, c.z + _d.z * R);
      if (i > 0) {
        const ap = ((i - 1) / 6) * TAU + A0;
        _b.set(c.x + Math.cos(ap) * R, .07, c.z + Math.sin(ap) * R); _g.set(_p.x - _b.x, 0, _p.z - _b.z);
        impact.beam(_b, _g, R, i % 2 ? GOLD : FLAME, { speed: 42, width: .1, delay: d - .11, fade: .45 });
      }
      _g.set(_d.x * .12, 1, _d.z * .12);
      impact.beam(_p, _g, 7.5, i % 2 ? CRIMSON : FLAME, { speed: 46, tail: 4, width: .26, delay: d });
      if (!lite) earthSpikes(impact, _p, 3, .9, 1.5, EMBER, { delay: d, h: 1.8, width: .24, out: .8, phase: a });
      debris(impact, _p.x, _p.z, lite ? 1 : 2, MOLTEN, { delay: d, up: 9, out: 2.4, phase: a });
    }
    // .75초 육망성: 각 기둥에서 두 칸 건너 기둥으로(길이 R√3 ≈ 8m). 가는 선이라 원색 그대로 둬도 바닥이 바래지 않는다(iter1: 짙은 색은 장판 원화에 묻힘).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + A0, b = ((i + 2) / 6) * TAU + A0;
      _a.set(c.x + Math.cos(a) * R, .07, c.z + Math.sin(a) * R); _g.set(Math.cos(b) * R - Math.cos(a) * R, 0, Math.sin(b) * R - Math.sin(a) * R);
      impact.beam(_a, _g, R * Math.sqrt(3), i % 2 ? CRIMSON : EMBER, { speed: 32, width: .13, delay: .75, fade: 1 });
    }
    lavaFissures(impact, c, lite ? 3 : 5, 1, 6.4, CRIMSON, { delay: .75, speed: 30, width: .08, fade: 1 });
    impact.mark(c, GOLD, { radius: 1.6, life: .5, style: MARK_STYLE.compass, delay: .75 });
  },
  // 혈왕·대지붕괴(각성 3) — '피의 소용돌이 → 왕관': 0~.15초 여섯 갈래 핏빛 나선 팔이 8.5m 밖에서 몸 쪽으로 감겨 들어오고(흡인이 보인다),
  // 0초 1차 붕괴(진홍 세로 도끼 자국 + 고리 + 짧은 핏빛 균열), .2초 2차 붕괴(불씨 도끼 자국 + 가시 고리 + 긴 균열 + 바깥으로 기운
  // 바위 가시 왕관 + 핏빛 기둥). 원형 문양은 고리 하나·가시 고리 하나만.
  bloodquake(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos;
    const arms = lite ? 3 : 6, SP = 40;
    for (let k = 0; k < arms; k++) {
      const a0 = (k / arms) * TAU; let t = 0;
      for (const [r0, da0, r1, da1] of [[8.5, 0, 5, .55], [5, .55, 1.4, 1.25]]) {
        _a.set(c.x + Math.cos(a0 + da0) * r0, .25, c.z + Math.sin(a0 + da0) * r0); // 바닥 장판 원화에 묻히지 않게 발목 높이
        _g.set(c.x + Math.cos(a0 + da1) * r1 - _a.x, 0, c.z + Math.sin(a0 + da1) * r1 - _a.z);
        const L = _g.length();
        impact.beam(_a, _g, L, k % 2 ? HOT : CRIMSON, { speed: SP, tail: 4, width: .24, delay: t });
        t += L / SP;
      }
    }
    // 1차 판정 테(가시 상한 4.5m): skills.js 의 영웅 둘레 충격 원화(shockTex, 크림 고리)를 뺀 자리의 위치 신호(2차 2026-10-30, 가는 진홍 가시 테).
    impact.mark(c, CRIMSON, { radius: THORN_MAX, life: .3, style: MARK_STYLE.thorn, angle: .9 });
    impact._emit(IMPACT_KIND.cut, c.x, 1.6, c.z, 4, CRIMSON, .24, { angle: -Math.PI / 2 + .3, grow: .7 });
    lavaFissures(impact, c, lite ? 3 : 6, .6, 5, BLOOD, { speed: 50, width: .16 });
    impact._emit(IMPACT_KIND.cut, c.x, 1.6, c.z, 5, EMBER, .26, { angle: -Math.PI / 2 - .3, grow: .7, delay: .2 });
    impact.mark(c, DEEP_EMBER, { radius: THORN_MAX, life: .6, style: MARK_STYLE.thorn, angle: .31, delay: .2 });
    lavaFissures(impact, c, lite ? 4 : 8, 1, 9, EMBER, { speed: 60, delay: .2, phase: .26, width: .13 });
    earthSpikes(impact, c, lite ? 5 : 10, 5, 7, CRIMSON, { delay: .2, h: 3.2, width: .34, out: .9, phase: .3 });
    _d.set(0, 1, 0);
    for (let i = 0; i < (lite ? 2 : 4); i++) {
      const a = (i / 4) * TAU + .7; _a.set(c.x + Math.cos(a) * 3.6, 0, c.z + Math.sin(a) * 3.6);
      impact.beam(_a, _d, 6, i % 2 ? CRIMSON : BLOOD, { speed: 40, tail: 4, width: .34, delay: .2 + i * .02 });
    }
    risingEmbers(impact, c, lite ? 3 : 6, 4, FLAME, { delay: .2, rise: 8 });
  },
  // 종말·화산심장(각성 4) — '혜성 낙하 → 화산탄 분수': 착탄점에 금빛 나침 + 진홍 가시 표식(조준), 도약 정점(영웅 뒤 3m·위 7.5m)에서
  // 착탄점으로 비스듬히 내리꽂는 불의 궤적 두 줄이 .3초(판정 순간)에 닿는다. 분화: 중심 불기둥 + 금빛 심, 포물선으로 솟아 바깥에
  // 떨어지는 화산탄 마름모 분수, 용암 균열(빌보드 고리 없음: 크림 원판), .16초 뒤 바깥 6~8.5m 여진 바위 가시.
  cataclysm(ctx) {
    const { impact, player, at, f, lite } = ctx; const T = .3;
    impact.mark(at, GOLD, { radius: 2, life: T + .15, style: MARK_STYLE.compass });
    impact.mark(at, DEEP_CRIMSON, { radius: THORN_MAX, life: T + .5, style: MARK_STYLE.thorn, angle: .31 });
    risingEmbers(impact, at, lite ? 2 : 4, 1.6, CRIMSON, { rise: 4 });
    // 영웅 뒤 3m·높이 7.5m(도약 정점)에서 출발해 착탄점까지 비스듬히 — 조준점이 발밑 가까이여도 사선으로 읽힌다.
    _a.copy(player.pos).addScaledVector(f, -3).setY(7.5); _g.set(at.x - _a.x, .3 - _a.y, at.z - _a.z);
    const L = _g.length();
    impact.beam(_a, _g, L, FLAME, { speed: L / T, tail: 6, width: .36 });
    if (!lite) { _a.y += .4; impact.beam(_a, _g, L, GOLD, { speed: L / T, tail: 3.5, width: .12 }); }
    _d.set(0, 1, 0); _a.set(at.x, 0, at.z);
    impact.beam(_a, _d, 13, FLAME, { speed: 55, tail: 6, width: .44, delay: T });
    _a.x += .35; impact.beam(_a, _d, 10, GOLD, { speed: 60, tail: 4, width: .14, delay: T });
    const n = lite ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + impact.rng.next() * .4, s = 5 + impact.rng.next() * 3;
      impact._emit(IMPACT_KIND.shard, at.x, .6, at.z, .42, i % 3 ? MOLTEN : GOLD, .9,
        { vx: Math.cos(a) * s, vy: 11 + impact.rng.next() * 4, vz: Math.sin(a) * s, angle: a, stretch: 1.6, grow: .9, gravity: 22, delay: T });
    }
    lavaFissures(impact, at, lite ? 6 : 10, 1, 11, EMBER, { speed: 65, delay: T, width: .14 });
    earthSpikes(impact, at, lite ? 3 : 7, 6, 8.5, CRIMSON, { delay: T + .16, h: 2.6, width: .32, out: .9, phase: .2 });
    risingEmbers(impact, at, lite ? 4 : 8, 4, FLAME, { delay: T, rise: 10 });
  },
};
