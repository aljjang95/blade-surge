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
const TAU = Math.PI * 2;
/** 큰 지면 표식(6m 이상)은 가산이라 원색 그대로면 바닥이 분홍·크림으로 바랜다. 같은 색상을 어둡게 낮춰 채도를 지킨다. */
const DEEP_EMBER = 0xb8380e, DEEP_CRIMSON = 0xa0140e;
/** 가시 고리 표식은 반경이 커지면 옅은 바퀴(크림·분홍 원판)로 읽힌다. 넓은 판정은 용암 균열 길이로 보이고 표식은 이 반경까지만. */
const THORN_MAX = 4.5;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
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
function earthSpikes(impact, c, n, r0, r1, color, { delay = 0, h = 2, width = .16, fade = .4, phase = 0, out = .5 } = {}) {
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

/** 도는 도끼 호 + 바닥 부채꼴 쓸기 + 접선으로 튀는 불똥. 회오리 매 판정 틱(i)마다 skills.js 가 부른다. */
export function barbWhirlTick(game, pos, i) {
  const impact = game?.fx?.impact; if (!live(impact) || !pos || game.app?.reducedMotion?.matches) return 0;
  const lite = !!game.fx.lite, before = impact.spawned, R = 2.2, base = i * 1.5;
  // 도끼 호 하나: skills.js 참격 스프라이트와 같은 방향(sin, cos)(i×1.5)의 날 끝 자리에 작게. 크게 여러 장 겹치면 영웅을 덮는 옅은 기둥이 됐다.
  const a = Math.PI / 2 - base;
  _d.set(-Math.sin(a), 0, Math.cos(a));
  impact._emit(IMPACT_KIND.cut, pos.x + Math.cos(a) * R, .9, pos.z + Math.sin(a) * R, 1.6, EMBER, .2, { angle: impact._screenAngle(_d), stretch: 1.3, grow: .8 });
  // 바닥 부채꼴 쓸기: 판정 반경(3.8m)을 따라 도는 붉은 날 궤적.
  impact.mark(pos, CRIMSON, { radius: 3.8, life: .22, style: MARK_STYLE.fan, angle: a });
  const n = lite ? 3 : 7;
  for (let k = 0; k < n; k++) {
    const a = base + (k / n) * TAU, r = 1.6 + impact.rng.next() * 1.4;
    impact._emit(IMPACT_KIND.streak, pos.x + Math.cos(a) * r, .7 + impact.rng.next() * .8, pos.z + Math.sin(a) * r, .22, k % 2 ? EMBER : MOLTEN, .3,
      { vx: -Math.sin(a) * 11, vy: 2.2, vz: Math.cos(a) * 11, stretch: 1, grow: 1, gravity: 10 });
  }
  return impact.spawned - before;
}

/** 돌진 끝 폭발(판정 순간 skills.js end 가 부른다): 앞으로 터지는 용암 균열 부채 + 분노 고리 + 불씨 기둥. */
export function barbRushEnd(game, center, f) {
  const impact = game?.fx?.impact; if (!live(impact) || !center || game.app?.reducedMotion?.matches) return 0;
  const lite = !!game.fx.lite, before = impact.spawned;
  impact.mark(center, DEEP_CRIMSON, { radius: THORN_MAX, life: .5, style: MARK_STYLE.thorn, angle: yawOf(f) });
  impact._emit(IMPACT_KIND.ring, center.x, .6, center.z, 4.5, EMBER, .3, { grow: 1 });
  lavaFissures(impact, center, lite ? 4 : 8, .8, 7, EMBER, { phase: yawOf(f) });
  risingEmbers(impact, center, lite ? 5 : 12, 3, FLAME);
  // 밀어붙인 방향으로 펼쳐지는 불씨 부채 + 앞쪽 불꽃 혀(벽처럼 뭉친 적이 터진 자리).
  _a.copy(center).addScaledVector(f, -2.4);
  impact.mark(_a, DEEP_EMBER, { radius: 6.2, life: .45, style: MARK_STYLE.fan, angle: yawOf(f) });
  earthSpikes(impact, center, lite ? 4 : 9, 1, 4, EMBER, { h: 2.6, width: .18, out: .6, phase: yawOf(f) });
  impact._emit(IMPACT_KIND.cut, center.x, 1.3, center.z, 3.6, FLAME, .26, { angle: impact._screenAngle(_d.set(-f.z, 0, f.x)), stretch: 1.3, grow: .8 });
  return impact.spawned - before;
}

/** @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>} */
export const SIGNATURES = {
  // 회오리 참격: 시전 순간 판정 반경(3.8m)에 붉은 가시 고리가 몸을 둘러 '도는 칼날 영역'을 표시한다. 틱마다의 호는 barbWhirlTick.
  whirlwind(ctx) {
    const { impact, player, lite } = ctx;
    impact.mark(player.pos, EMBER, { radius: 3.8, life: 1.1, style: MARK_STYLE.thorn });
    risingEmbers(impact, player.pos, lite ? 4 : 9, 3.2, FLAME, { rise: 5 });
  },
  // 대지 분쇄: 내리친 자리에서 용암 균열 열 갈래가 판정 반경(8m)까지 갈라지고, 세 박자(0/.08/.16) 고리와 불씨가 솟는다.
  quake(ctx) {
    const { impact, at, lite } = ctx;
    impact.mark(at, DEEP_CRIMSON, { radius: THORN_MAX, life: .6, style: MARK_STYLE.thorn });
    lavaFissures(impact, at, lite ? 5 : 10, .6, 8.5, EMBER, { speed: 55 });
    for (const [i, d] of [0, .08, .16].entries()) impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 2.4 + i * 1, i === 1 ? MOLTEN : EMBER, .3, { grow: 1, delay: d });
    risingEmbers(impact, at, lite ? 6 : 14, 4, FLAME, { delay: .04 });
  },
  // 광폭화: 붉은 분노 오라 — 발밑 진홍 가시 고리 두 겹(반대 회전) + 몸을 따라 솟구치는 핏빛 불꽃 줄기 두 물결.
  berserk(ctx) {
    const { impact, player, lite } = ctx;
    impact.mark(player.pos, CRIMSON, { radius: 2.6, life: .9, style: MARK_STYLE.thorn });
    impact.mark(player.pos, BLOOD, { radius: 4.2, life: .7, style: MARK_STYLE.thorn, angle: .31, delay: .1 });
    impact._emit(IMPACT_KIND.ring, player.pos.x, 1, player.pos.z, 3.4, CRIMSON, .32, { grow: 1 });
    for (let w = 0; w < 2; w++) risingEmbers(impact, player.pos, lite ? 5 : 11, 1.1, w ? CRIMSON : EMBER, { delay: w * .18, rise: 9, life: .6, size: .26 });
    // 분노 불꽃 혀: 몸 둘레에서 위로 핥아 오르는 붉은 불길 두 물결(오라의 실루엣).
    for (let w = 0; w < 2; w++) earthSpikes(impact, player.pos, lite ? 4 : 8, .9, 1.4, w ? EMBER : CRIMSON, { delay: w * .2, h: 3.2, width: .17, out: .15, phase: w * .4, fade: .3 });
  },
  // 지옥의 도끼(궁극기): 착탄점에 진홍 가시 고리가 먼저 잡히고, 하늘에서 불의 궤적이 .5초 뒤(판정 순간)에 꽂힌다.
  // 착탄: 세로 도끼 호 + 용암 균열 열두 갈래 + 큰 고리 두 겹 + 불씨 기둥.
  hell_axe(ctx) {
    const { impact, at: t, lite } = ctx; const FALL = .5;
    impact.mark(t, DEEP_CRIMSON, { radius: 4, life: FALL + .5, style: MARK_STYLE.thorn });
    _a.set(t.x, 16, t.z); _d.set(0, -1, 0);
    impact.beam(_a, _d, 16, EMBER, { speed: 32, tail: 7, width: .32 });
    impact._emit(IMPACT_KIND.cut, t.x, 2.2, t.z, 5.5, FLAME, .32, { angle: -Math.PI / 2 + .25, grow: .7, delay: FALL - .04 });
    impact._emit(IMPACT_KIND.ring, t.x, .5, t.z, 4.8, EMBER, .34, { grow: 1, delay: FALL });
    impact._emit(IMPACT_KIND.ring, t.x, .5, t.z, 3.2, CRIMSON, .3, { grow: 1, delay: FALL + .08 });
    lavaFissures(impact, t, lite ? 6 : 12, .8, 10, EMBER, { delay: FALL, speed: 60, width: .13 });
    risingEmbers(impact, t, lite ? 7 : 16, 4.5, FLAME, { delay: FALL, rise: 9 });
    sparks(impact, t, lite ? 4 : 8, 13, MOLTEN, { delay: FALL });
    // 착탄 화염 분수: 솟는 불기둥 광선 다섯.
    _d.set(0, 1, 0);
    for (let i = 0; i < (lite ? 3 : 5); i++) {
      const a = (i / 5) * TAU + .6, r = i === 0 ? 0 : 2.6;
      _a.set(t.x + Math.cos(a) * r, 0, t.z + Math.sin(a) * r);
      impact.beam(_a, _d, i === 0 ? 11 : 7, i === 0 ? FLAME : EMBER, { speed: 50, tail: 5, width: i === 0 ? .4 : .22, delay: FALL + i * .03 });
    }
  },
  // 광란의 돌진: 돌진 길을 따라 용암 균열이 영웅과 같은 속도(21m/s)로 그어지고, 길가에 불씨가 차례로 솟는다. 끝 폭발은 barbRushEnd.
  bull_rush(ctx) {
    const { impact, player, f, lite } = ctx;
    _a.copy(player.pos).setY(.07);
    impact.beam(_a, f, 12, EMBER, { speed: 21, width: .16, fade: .45 });
    _d.set(-f.z, 0, f.x);
    for (const s of [-1, 1]) { _b.copy(_a).addScaledVector(_d, s * 1.1); impact.beam(_b, f, 10, CRIMSON, { speed: 21, width: .08, fade: .3, delay: .05 }); }
    for (let i = 0; i < (lite ? 3 : 6); i++) {
      _b.copy(player.pos).addScaledVector(f, 1.5 + i * 1.9);
      risingEmbers(impact, _b, 2, .8, i % 2 ? FLAME : EMBER, { delay: (1.5 + i * 1.9) / 21, rise: 6 });
    }
    // 돌진 앞머리: 몸 앞 부채꼴 분노 표식이 길을 연다.
    impact.mark(player.pos, DEEP_CRIMSON, { radius: 4, life: .35, style: MARK_STYLE.fan, angle: yawOf(f) });
  },
  // 용암 분출·진: 여섯 기둥이 솟는 박자(i×.11초)마다 중심→기둥 자리로 용암 균열이 뻗고 고리·불씨가 솟는다. .75초에 균열 장판 가시 고리.
  magma_zone(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + .4, d = i * .11;
      _d.set(Math.cos(a), 0, Math.sin(a)); _a.set(c.x + _d.x * .8, .07, c.z + _d.z * .8);
      impact.beam(_a, _d, 3.8, EMBER, { speed: 40, width: .14, delay: Math.max(0, d - .08), fade: .5 });
      _b.set(c.x + _d.x * 4.6, 0, c.z + _d.z * 4.6);
      impact._emit(IMPACT_KIND.ring, _b.x, .4, _b.z, 3, i % 2 ? CRIMSON : EMBER, .28, { grow: 1, delay: d });
      if (!lite) risingEmbers(impact, _b, 3, 1, MOLTEN, { delay: d, rise: 10 });
    }
    impact.mark(c, DEEP_EMBER, { radius: 3.6, life: 1.4, style: MARK_STYLE.thorn, delay: .75 });
    lavaFissures(impact, c, lite ? 4 : 8, 1, 6.4, CRIMSON, { delay: .75, speed: 30, width: .09, fade: 1 });
  },
  // 혈왕·대지붕괴: 두 번 무너진다 — 0초 진홍 가시 고리(6m) + 핏빛 균열, .2초 불씨 가시 고리(8m) + 더 긴 균열·큰 고리·불기둥 불씨.
  bloodquake(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos;
    impact.mark(c, DEEP_CRIMSON, { radius: 3.4, life: .5, style: MARK_STYLE.thorn });
    impact._emit(IMPACT_KIND.ring, c.x, .5, c.z, 3.4, CRIMSON, .3, { grow: 1 });
    lavaFissures(impact, c, lite ? 4 : 8, .6, 6, CRIMSON, { speed: 50 });
    impact.mark(c, DEEP_EMBER, { radius: THORN_MAX, life: .6, style: MARK_STYLE.thorn, angle: .31, delay: .2 });
    impact._emit(IMPACT_KIND.ring, c.x, .5, c.z, 4.6, EMBER, .34, { grow: 1, delay: .2 });
    lavaFissures(impact, c, lite ? 6 : 12, 1, 9, EMBER, { speed: 60, delay: .2, phase: .26, width: .13 });
    risingEmbers(impact, c, lite ? 5 : 10, 5, FLAME, { delay: .2, rise: 8 });
    risingEmbers(impact, c, lite ? 3 : 6, 2.5, CRIMSON, { rise: 6 });
    // 무너지는 대지: 핏빛 바위 가시(0초, 6m 안) → 불씨 바위 가시(.2초, 8m 안)가 바깥으로 비스듬히 솟는다.
    earthSpikes(impact, c, lite ? 4 : 8, 3, 6, CRIMSON, { h: 2.2, width: .18 });
    earthSpikes(impact, c, lite ? 5 : 10, 5, 8.5, EMBER, { delay: .2, h: 2.8, width: .2, phase: .3 });
  },
  // 종말·화산심장(최상위 각성): 화산 심장이 맥동(진홍 가시 고리)하다 .3초에 분화 — 하늘로 솟는 불의 기둥 광선 다섯,
  // 용암 균열 열네 갈래, 거대 고리 두 겹, 불씨 분수.
  cataclysm(ctx) {
    const { impact, at, lite } = ctx; const T = .3;
    impact.mark(at, DEEP_CRIMSON, { radius: THORN_MAX, life: T + .55, style: MARK_STYLE.thorn });
    impact.mark(at, EMBER, { radius: 2.6, life: T + .2, style: MARK_STYLE.thorn, angle: .31 });
    risingEmbers(impact, at, lite ? 3 : 7, 2, CRIMSON, { rise: 4 });
    _d.set(0, 1, 0);
    for (let i = 0; i < (lite ? 3 : 5); i++) {
      const a = (i / 5) * TAU, r = i === 0 ? 0 : 3.2;
      _a.set(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r);
      impact.beam(_a, _d, 9 + (i === 0 ? 4 : 0), i === 0 ? FLAME : EMBER, { speed: 55, tail: 6, width: i === 0 ? .42 : .24, delay: T + i * .03 });
    }
    impact._emit(IMPACT_KIND.ring, at.x, .6, at.z, 5.5, EMBER, .38, { grow: 1, delay: T });
    impact._emit(IMPACT_KIND.ring, at.x, .6, at.z, 3.6, CRIMSON, .3, { grow: 1, delay: T + .1 });
    lavaFissures(impact, at, lite ? 7 : 14, 1, 11, EMBER, { speed: 65, delay: T, width: .14 });
    risingEmbers(impact, at, lite ? 8 : 16, 5, FLAME, { delay: T, rise: 11 });
    sparks(impact, at, lite ? 4 : 8, 15, MOLTEN, { delay: T });
  },
};
