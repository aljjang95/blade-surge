import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE, BEAM_STYLE } from './impact-vfx.js';

/**
 * mage 스킬 '모양 언어' 서명(h1b). skill-signatures.js 가 합친다. 규칙은 그 파일 머리 주석과 같다:
 * 인스턴스 임팩트 층(드로우콜 1)만 쓰고, 판정 시각은 delay 칸으로 맞추며, 프레임당 할당·Math.random 을 쓰지 않는다.
 * 대마도사는 원소 학파마다 모양이 다르다:
 *  화염 = 주황-빨강 폭발 고리·나침 폭발 표식·떨어지는 불똥 / 번개 = 청백 지그재그 사슬(짧은 광선 마디)
 *  냉기 = 진한 하늘색 서리 가시 고리·바닥에서 솟는 얼음 가시(흰 덩어리 금지) / 비전·시간 = 보라 시계판·시각 눈금 별빛
 *  별 = 남색 별자리 선 + 금빛 별 점.
 * 대상이 실행 중에 정해지는 번개 사슬·운석·반사·눈보라 틱은 skills.js 가 그 순간 아래 도우미(mage*)를 부른다.
 */
export const MAGE_COLORS = Object.freeze({
  fire: 0xff5a1a, fireHot: 0xffa030, bolt: 0x5aa8ff, boltHot: 0xa8dcff, frost: 0x2a9cff, frostHot: 0x6ccaff,
  arcane: 0x7a5cff, arcaneHot: 0xb09cff, star: 0x4a5cff, starLine: 0x6a7cff, starGold: 0xffc85a, prism: 0x7fe0ff,
  // 지면 서리 고리는 가산이라 원색이면 바닥이 하얗게 바랜다. 같은 색상을 낮춘 진한 하늘색으로 그린다.
  frostMid: 0x1f7fd0,
});
const C = MAGE_COLORS;
const TAU = Math.PI * 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _q = new THREE.Vector3();
const _stars = Array.from({ length: 8 }, () => new THREE.Vector3());
/** 실제 임팩트 층인지(테스트 대역·미초기화 FX 에서 도우미가 전투 루프를 깨지 않게). */
const live = (impact) => !!impact && impact.enabled !== false && typeof impact.beam === 'function' && typeof impact.mark === 'function' && !!impact.rng;
const reducedOf = (game) => !!game?.app?.reducedMotion?.matches;

/** 번개 지그재그: from→to 를 segs 마디의 짧은 광선으로 잇고 마디마다 옆·위로 꺾는다. 쓴 칸 수. */
export function zigzag(impact, from, to, segs, jitter, color, { width = .08, delay = 0, fade = .2 } = {}) {
  _p0.copy(from); _d.copy(to).sub(from); const len = _d.length(); if (!(len > .05)) return 0;
  _q.set(-_d.z, 0, _d.x); const ql = _q.length(); if (ql > 1e-5) _q.multiplyScalar(1 / ql); else _q.set(1, 0, 0);
  let used = 0;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    _p1.copy(from).addScaledVector(_d, t);
    if (k < segs) { _p1.addScaledVector(_q, (impact.rng.next() - .5) * 2 * jitter * len * .18); _p1.y += (impact.rng.next() - .5) * jitter * len * .14; }
    _b.copy(_p1).sub(_p0); const l = _b.length();
    if (l > 1e-4 && impact.beam(_p0, _b, l, color, { width, delay, fade })) used++;
    _p0.copy(_p1);
  }
  return used;
}

/** 바닥에서 솟는 얼음 가시: 비스듬히 선 짧은 광선. 흰 섬광 대신 진한 하늘색 결정 실루엣. */
function iceSpikes(impact, c, n, r0, r1, color, { delay = 0, h = 1.4, width = .1, fade = .45, phase = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU + (impact.rng.next() - .5) * .5, r = r0 + (r1 - r0) * impact.rng.next();
    _a.set(c.x + Math.cos(a) * r, .02, c.z + Math.sin(a) * r);
    _b.set(Math.cos(a) * .45, 1, Math.sin(a) * .45);
    impact.beam(_a, _b, h * (.7 + impact.rng.next() * .6), color, { speed: 14, width, delay, fade });
  }
}

/** 화염 폭발 한 점: 주황 코어 + 나침 폭발 표식 + 두 겹 고리 + 떨어지는 불똥. */
function fireBlast(impact, c, size, { delay = 0, lite = false } = {}) {
  impact._emit(IMPACT_KIND.core, c.x, .8, c.z, size * .55, C.fire, .14, { grow: .5, delay });
  impact.mark(c, C.fire, { radius: size, life: .5, style: MARK_STYLE.compass, angle: impact.rng.next() * TAU, delay });
  impact._emit(IMPACT_KIND.ring, c.x, .6, c.z, size * 1.3, C.fire, .3, { grow: 1, delay });
  impact._emit(IMPACT_KIND.ring, c.x, .6, c.z, size * .8, C.fireHot, .22, { grow: 1, delay: delay + .05 });
  const n = lite ? 4 : 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + impact.rng.next() * .5, s = 8 + impact.rng.next() * 6;
    impact._emit(IMPACT_KIND.streak, c.x, .7, c.z, .24, i % 2 ? C.fire : C.fireHot, .45, { vx: Math.cos(a) * s, vy: 5 + impact.rng.next() * 4, vz: Math.sin(a) * s, stretch: .9, grow: 1, gravity: 18, delay });
  }
}

/** 번개 사슬 한 마디(skills.js chain 이 연쇄 순간 부른다): 청백 지그재그 두 가닥 + 맞은 자리 작은 청색 별빛·고리. */
export function mageBolt(game, from, to, step = 0) {
  const impact = game?.fx?.impact; if (!live(impact) || !from || !to || reducedOf(game)) return 0;
  const before = impact.spawned, lite = !!game.fx.lite;
  // 굵은 청색 번개 + 가는 청백 심 + 가운데서 아래로 갈라지는 가지 + 끝점 별빛·고리·튀는 전하.
  const F = _stars[6].copy(from), T = _stars[7].copy(to);
  // 광선 폭(width)은 가장자리까지의 반폭이고 보이는 심은 그 1/5 정도라, 번개는 두껍게 준다.
  zigzag(impact, F, T, lite ? 4 : 6, 1, C.bolt, { width: .55, fade: .36 });
  if (!lite) {
    zigzag(impact, F, T, 5, 1.4, C.boltHot, { width: .12, fade: .2 });
    _stars[5].copy(F).lerp(T, .45); _a.copy(T).sub(F); _stars[4].set(-_a.z, 0, _a.x).normalize();
    _stars[3].copy(_stars[5]).addScaledVector(_stars[4], (step % 2 ? 1 : -1) * 1.6); _stars[3].y = Math.max(.2, _stars[5].y - 1.1);
    zigzag(impact, _stars[5], _stars[3], 3, 1.2, C.bolt, { width: .26, fade: .26 });
  }
  impact._emit(IMPACT_KIND.star, T.x, T.y, T.z, step < 2 ? 1.3 : 1.05, C.bolt, .18, { angle: .4 + step, grow: .5 });
  impact._emit(IMPACT_KIND.ring, T.x, T.y, T.z, 1.6, C.boltHot, .24, { grow: 1 });
  if (!lite) impact._streaks(T, null, 4, 9, .22, C.boltHot, { up: 2, spread: 3, size: .16 });
  return impact.spawned - before;
}

/** 운석 한 발(skills.js meteor 가 낙하 시작 순간 부른다): 하늘에서 내리꽂는 불의 궤적이 .4초(판정 순간)에 닿고 화염 폭발. */
export function mageMeteorFall(game, start, pt, fall = .4) {
  const impact = game?.fx?.impact; if (!live(impact) || !start || !pt || reducedOf(game)) return 0;
  const before = impact.spawned;
  _d.copy(pt).sub(start); const len = _d.length();
  impact.beam(start, _d, len, C.fire, { speed: len / fall, tail: 6, width: .3 });
  impact.mark(pt, C.fireHot, { radius: 3.4, life: fall + .15, style: MARK_STYLE.reticle });
  fireBlast(impact, pt, 3.4, { delay: fall, lite: !!game.fx.lite });
  return impact.spawned - before;
}

/** 눈보라 판정 틱(.4초마다): 판정 반경 서리 가시 고리 + 바닥에서 솟는 얼음 가시. */
export function mageFrostTick(game, pos, i, radius = 6.8) {
  const impact = game?.fx?.impact; if (!live(impact) || !pos || reducedOf(game)) return 0;
  const before = impact.spawned;
  // 큰 가시 고리는 옅은 흰 바퀴로 읽혀 몸 둘레 3m 서리 고리만 두고, 판정 반경은 얼음 가시가 채운다.
  impact.mark(pos, C.frostMid, { radius: 3, life: .42, style: MARK_STYLE.thorn, angle: i * .37 });
  iceSpikes(impact, pos, game.fx.lite ? 4 : 8, 1.5, radius - .3, i % 2 ? C.frost : C.frostHot, { phase: i * .9, width: .3, h: 1.7 });
  // 폭풍의 회전: 몸을 감아 도는 서리 줄기(접선 속도). 흰 눈송이 대신 하늘색 선.
  const n = game.fx.lite ? 4 : 9;
  for (let k = 0; k < n; k++) {
    const a = i * .7 + (k / n) * TAU, r = 2.5 + (k % 3) * 1.4;
    impact._emit(IMPACT_KIND.streak, pos.x + Math.cos(a) * r, 1 + (k % 4) * .6, pos.z + Math.sin(a) * r, .2, k % 2 ? C.frost : C.frostHot, .38,
      { vx: -Math.sin(a) * 12, vy: -1.5, vz: Math.cos(a) * 12, stretch: 1.2, grow: 1 });
  }
  return impact.spawned - before;
}

/** 프리즘 난반사 한 번(skills.js arc_reflect 가 튕길 때 부른다): 청록 별빛 + 세 빛깔로 갈라지는 짧은 광선. */
export function magePrismBounce(game, pos, dir, n = 0) {
  const impact = game?.fx?.impact; if (!live(impact) || !pos || reducedOf(game)) return 0;
  const before = impact.spawned;
  impact._emit(IMPACT_KIND.star, pos.x, pos.y, pos.z, 1.3 + Math.min(n, 12) * .06, C.prism, .18, { angle: .2 + n * .5, grow: .5 });
  impact._emit(IMPACT_KIND.ring, pos.x, pos.y, pos.z, 1.5, C.arcaneHot, .22, { grow: 1 });
  if (!game.fx.lite && dir) {
    const base = Math.atan2(dir.z, dir.x);
    for (const [j, col] of [C.prism, C.arcaneHot, C.bolt].entries()) {
      const a = base + (j - 1) * .4; _d.set(Math.cos(a), 0, Math.sin(a));
      impact.beam(pos, _d, 3.6, col, { speed: 30, tail: 2, width: .2 });
    }
  }
  return impact.spawned - before;
}

/** @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>} */
export const SIGNATURES = {
  // 화염구: 손끝 주황 고리 + 앞으로 뿜는 불똥 + 화염구를 감고 따라가는 쌍나선 불길(앞 5m).
  fireball(ctx) {
    const { impact, player, f, lite } = ctx;
    _a.copy(player.pos).addScaledVector(f, 1).setY(1.4);
    impact._emit(IMPACT_KIND.ring, _a.x, _a.y, _a.z, 2, C.fire, .26, { grow: 1 });
    impact._emit(IMPACT_KIND.ring, _a.x, _a.y, _a.z, 1.2, C.fireHot, .2, { grow: 1, delay: .05 });
    impact._streaks(_a, f, lite ? 5 : 12, 12, .36, C.fireHot, { up: 1.2, spread: .5, size: .24 });
    impact.beam(_a, f, 6.5, C.fire, { speed: 15, tail: 3.5, width: .5, style: BEAM_STYLE.gale });
    // 발밑 화염 학파 문양: 작은 주황 나침 폭발 표식(공용 룬 대신).
    impact.mark(ctx.player.pos, C.fire, { radius: 2.2, life: .5, style: MARK_STYLE.compass, angle: Math.atan2(f.z, f.x) });
  },
  // 번개 사슬: 하늘에서 들어 올린 손으로 청백 번개가 내리꽂히고 발밑 짧은 고리. 연쇄 마디는 mageBolt.
  chain(ctx) {
    const { impact, player } = ctx;
    _p0.set(player.pos.x + .6, 9, player.pos.z - .4); _p1.copy(player.pos).setY(1.8);
    _stars[0].copy(_p0); _stars[1].copy(_p1);
    zigzag(impact, _stars[0], _stars[1], 7, 1.1, C.bolt, { width: .55, fade: .34 });
    zigzag(impact, _stars[0], _stars[1], 5, 1.5, C.boltHot, { width: .18, fade: .22 });
    impact._emit(IMPACT_KIND.star, _stars[1].x, _stars[1].y, _stars[1].z, 1.8, C.bolt, .18, { angle: .4, grow: .5 });
    impact._emit(IMPACT_KIND.ring, player.pos.x, .4, player.pos.z, 2.8, C.bolt, .28, { grow: 1 });
    // 발밑 정전기: 바닥을 기는 짧은 번개 가지 여섯.
    for (let k = 0; k < (ctx.lite ? 3 : 6); k++) {
      const a = (k / 6) * TAU + .3; _stars[2].copy(player.pos).setY(.1);
      _stars[3].set(player.pos.x + Math.cos(a) * 2.6, .1, player.pos.z + Math.sin(a) * 2.6);
      zigzag(impact, _stars[2], _stars[3], 3, 1.3, C.bolt, { width: .2, fade: .26, delay: .03 });
    }
  },
  // 빙결 폭풍: 판정 반경(6.8m) 서리 가시 고리가 폭풍 내내 남고 바깥 둘레에 얼음 가시 벽이 솟는다. 틱마다는 mageFrostTick.
  blizzard(ctx) {
    const { impact, player, lite } = ctx;
    impact.mark(player.pos, C.frostMid, { radius: 3.4, life: 1.2, style: MARK_STYLE.thorn, angle: .3 });
    iceSpikes(impact, player.pos, lite ? 7 : 16, 6.2, 7, C.frost, { h: 2, width: .3, fade: 1.6 });
  },
  // 메테오 스톰(궁극기): 낙하 구역(7.8m)에 주황 나침 표식과 열기 고리가 먼저 깔린다. 한 발마다의 궤적·폭발은 mageMeteorFall.
  meteor(ctx) {
    const { impact, at } = ctx;
    impact.mark(at, C.fire, { radius: 4.5, life: 1.8, style: MARK_STYLE.compass });
    impact._emit(IMPACT_KIND.ring, at.x, .4, at.z, 4.5, C.fire, .36, { grow: 1 });
  },
  // 프리즘 난반사: 손끝 청록 별빛에서 빛이 세 갈래(청록·보라·청)로 갈라져 앞으로 뻗는다. 튕길 때는 magePrismBounce.
  arc_reflect(ctx) {
    const { impact, player, f } = ctx;
    _a.copy(player.pos).addScaledVector(f, 1.2).setY(1.3);
    impact._emit(IMPACT_KIND.star, _a.x, _a.y, _a.z, 1.5, C.prism, .18, { angle: .2, grow: .5 });
    impact._emit(IMPACT_KIND.ring, _a.x, _a.y, _a.z, 2, C.arcaneHot, .26, { grow: 1 });
    const base = Math.atan2(f.z, f.x);
    for (const [j, col] of [C.prism, C.arcaneHot, C.bolt].entries()) {
      const a = base + (j - 1) * .12; _d.set(Math.cos(a), 0, Math.sin(a));
      impact.beam(_a, _d, 10, col, { speed: 30, tail: 5, width: .22 });
    }
    // 발밑 프리즘 문양: 청록 조준 원(굴절 각을 재는 원).
    impact.mark(ctx.player.pos, C.prism, { radius: 1.8, life: .5, style: MARK_STYLE.reticle, angle: base });
  },
  // 시간 봉인: 바닥 시계판(skills.js)에 더해 열두 시각 눈금 자리에 보라 별빛이 한 바퀴 차례로 켜지고 큰 보라 고리가 퍼진다.
  chrono_seal(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos;
    impact._emit(IMPACT_KIND.ring, c.x, .5, c.z, 4.5, C.arcane, .4, { grow: 1 });
    // 발밑 작은 시계판(봉인 시간 동안 바늘이 한 바퀴) + 위로 떠오르는 보라 시간 입자.
    impact.mark(c, C.arcaneHot, { radius: 2.2, life: 3, style: MARK_STYLE.clock });
    for (let k = 0; k < (lite ? 4 : 10); k++) {
      const a = (k / 10) * TAU, r = 1.5 + (k % 3) * 1.6;
      impact._emit(IMPACT_KIND.streak, c.x + Math.cos(a) * r, .3, c.z + Math.sin(a) * r, .2, k % 2 ? C.arcane : C.arcaneHot, .7,
        { vx: 0, vy: 3.5, vz: 0, stretch: 1.4, grow: 1, gravity: -1, delay: k * .04 });
    }
    const n = lite ? 6 : 12;
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 - (k / n) * TAU;
      impact._emit(IMPACT_KIND.star, c.x + Math.cos(a) * 6.4, .25, c.z - Math.sin(a) * 6.4, .75, C.arcaneHot, .5, { angle: a, grow: .6, delay: k * .035 });
    }
  },
  // 성좌·별감옥: 일곱 별(금빛 점)이 차례로 켜지며 남색 별자리 선(칠각성)으로 이어지고, .24초(판정)에 중심 별빛·고리와
  // 별가루가 안쪽으로 빨려든다.
  star_prison(ctx) {
    const { impact, at, lite } = ctx; const N = 7, R = 6.5, T = .24;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + .2 + (impact.rng.next() - .5) * .3, r = R * (.82 + impact.rng.next() * .22);
      _stars[k].set(at.x + Math.cos(a) * r, .35, at.z + Math.sin(a) * r);
      impact._emit(IMPACT_KIND.star, _stars[k].x, .5, _stars[k].z, 1.3, C.starGold, .62 - k * .02, { angle: .3 + k, grow: .7, delay: k * .025 });
    }
    for (let k = 0; k < N; k++) {
      const j = (k + 3) % N; _d.copy(_stars[j]).sub(_stars[k]);
      impact.beam(_stars[k], _d, _d.length(), C.starLine, { speed: 70, width: .24, delay: k * .025, fade: .45 });
    }
    impact._emit(IMPACT_KIND.star, at.x, 1, at.z, 2.6, C.star, .2, { angle: .3, grow: .4, delay: T });
    impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 4.5, C.star, .34, { grow: 1, delay: T });
    const n = lite ? 5 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r = 6;
      impact._emit(IMPACT_KIND.streak, at.x + Math.cos(a) * r, .6 + (i % 3) * .3, at.z + Math.sin(a) * r, .2, i % 2 ? C.starGold : C.star, .3,
        { vx: -Math.cos(a) * 18, vy: 0, vz: -Math.sin(a) * 18, stretch: 1, grow: 1, delay: T - .08 });
    }
  },
  // 절대영도·종언(최상위 각성): 서리 가시 고리(9m)가 조여 들고 .35초(판정)에 바닥 전체에서 얼음 가시 숲이 솟으며
  // 진한 하늘색 결정 균열이 바깥으로 뻗는다. 흰 텍스처 덩어리 대신 가시·선의 실루엣.
  absolute_zero(ctx) {
    const { impact, at, lite } = ctx; const T = .35;
    iceSpikes(impact, at, lite ? 6 : 12, 8, 9.2, C.frostMid, { h: 1.6, width: .14, fade: .5 });
    impact.mark(at, C.frostMid, { radius: 4, life: T + .1, style: MARK_STYLE.thorn, angle: .3 });
    const n = lite ? 7 : 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (impact.rng.next() - .5) * .3; _d.set(Math.cos(a), 0, Math.sin(a));
      _a.set(at.x + _d.x * .8, .08, at.z + _d.z * .8);
      impact.beam(_a, _d, 7 + impact.rng.next() * 3, i % 2 ? C.frost : C.frostHot, { speed: 55, width: .12, delay: T, fade: .55 });
    }
    iceSpikes(impact, at, lite ? 8 : 18, 1, 8, C.frost, { delay: T, h: 2.4, width: .32, fade: .8 });
    impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 5, C.frost, .4, { grow: 1, delay: T });
    impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 3.2, C.frostHot, .3, { grow: 1, delay: T + .06 });
  },
};
