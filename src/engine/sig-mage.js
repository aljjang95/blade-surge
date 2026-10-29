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
  fire: 0xff5a1a, fireHot: 0xffa030, fireDeep: 0xd8261a, bolt: 0x5aa8ff, boltHot: 0xa8dcff, frost: 0x2a9cff, frostHot: 0x6ccaff,
  arcane: 0x7a5cff, arcaneHot: 0xb09cff, star: 0x4a5cff, starLine: 0x6a7cff, starGold: 0xffc85a, prism: 0x7fe0ff,
  // 지면 서리 고리는 가산이라 원색이면 바닥이 하얗게 바랜다. 같은 색상을 낮춘 진한 하늘색으로 그린다.
  frostMid: 0x1f7fd0, frostDeep: 0x1650c8,
  // 번개 광선은 심이 흰색 쪽으로 섞이고 가산이라, 원색 청을 쓰면 굵게 했을 때 흰 선이 된다. 진한 청으로 그려 청백을 유지한다.
  boltDeep: 0x2a6cff, boltCore: 0x4a90ff, prismDeep: 0x2a90d0,
});
const C = MAGE_COLORS;
const TAU = Math.PI * 2;
const _f = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _q = new THREE.Vector3();
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

/** 바닥에서 솟는 얼음 가시: 비스듬히 선 짧은 얼음 광선(BEAM_STYLE.ice). 흰 심 광선은 바닥 위에서 흰 방사선으로 읽혔다(h1c):
 *  심은 옅은 하늘색, 가장자리는 진한 청, 끝으로 갈수록 가늘어지는 결정 실루엣. */
function iceSpikes(impact, c, n, r0, r1, color, { delay = 0, h = 1.4, width = .1, fade = .45, phase = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU + (impact.rng.next() - .5) * .5, r = r0 + (r1 - r0) * impact.rng.next();
    _a.set(c.x + Math.cos(a) * r, .02, c.z + Math.sin(a) * r);
    _b.set(Math.cos(a) * .45, 1, Math.sin(a) * .45);
    impact.beam(_a, _b, h * (.7 + impact.rng.next() * .6), color, { speed: 14, width, delay, fade, style: BEAM_STYLE.ice });
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

/** 번개 사슬 한 마디(skills.js chain 이 연쇄 순간 부른다): 적과 적 사이를 실제로 잇는 굵은 청색 지그재그 + 청백 심 + 갈래,
 *  맞은 적마다 몸을 덮지 않게 바깥으로 튀는 전기 별빛(짧은 방사 번개 넷 + 작은 별). 옅은 고리(원) 대신 선으로 맞은 자리를 찍는다. */
export function mageBolt(game, from, to, step = 0) {
  const impact = game?.fx?.impact; if (!live(impact) || !from || !to || reducedOf(game)) return 0;
  const before = impact.spawned, lite = !!game.fx.lite;
  const F = _stars[6].copy(from), T = _stars[7].copy(to);
  // 광선 폭(width)은 가장자리까지의 반폭이고 보이는 심은 그 1/5 정도라, 번개는 두껍게 준다(.55 → .8: 연쇄 경로가 화면에서 굵게 읽히게).
  zigzag(impact, F, T, lite ? 4 : 6, 1, C.boltDeep, { width: .8, fade: .42 });
  if (!lite) {
    zigzag(impact, F, T, 5, 1.4, C.boltCore, { width: .2, fade: .26 });
    _stars[5].copy(F).lerp(T, .45); _a.copy(T).sub(F); _stars[4].set(-_a.z, 0, _a.x).normalize();
    _stars[3].copy(_stars[5]).addScaledVector(_stars[4], (step % 2 ? 1 : -1) * 1.6); _stars[3].y = Math.max(.2, _stars[5].y - 1.1);
    zigzag(impact, _stars[5], _stars[3], 3, 1.2, C.boltDeep, { width: .3, fade: .3 });
  }
  // 전기 별빛: 적 몸 바깥(.55m)에서 시작해 1.1m 뻗는 방사 번개 넷(화면 대각선), 머리 위 작은 청색 별.
  const n = lite ? 2 : 4;
  for (let k = 0; k < n; k++) {
    const a = step * .9 + (k / n) * TAU + .4; _d.set(Math.cos(a), (k % 2 ? .5 : -.35), Math.sin(a));
    _a.copy(T).addScaledVector(_d, .55);
    impact.beam(_a, _d, 1.1, k % 2 ? C.bolt : C.boltDeep, { speed: 24, width: .16, fade: .22 });
  }
  impact._emit(IMPACT_KIND.star, T.x, T.y + .9, T.z, step < 2 ? 1 : .8, C.bolt, .22, { angle: .4 + step, grow: .5 });
  if (!lite) impact._emit(IMPACT_KIND.star, T.x, T.y, T.z, .7, C.boltDeep, .16, { angle: 1.1 + step, grow: .4, delay: .04 });
  return impact.spawned - before;
}

/** 손끝에 모이는 예비 빛(skills.js 시전 start 가 부른다): 손 둘레에서 손끝으로 빨려 드는 불꽃·전하 줄기와 손끝 작은 별.
 *  판정 전 0.1~0.4초 동안 '무엇이 모이고 있는지'를 읽게 한다. 쓴 칸 수. */
export function mageCharge(game, p, school = 'fire', castAt = .2) {
  const impact = game?.fx?.impact; if (!live(impact) || !p?.pos || typeof p.forward !== 'function' || reducedOf(game)) return 0;
  const before = impact.spawned, lite = !!game.fx.lite;
  const bolt = school === 'bolt', a0 = bolt ? C.boltDeep : C.fireDeep, a1 = bolt ? C.bolt : C.fire;
  const H = _stars[0]; p.forward(_f); H.copy(p.pos).addScaledVector(_f, bolt ? .4 : .9); H.y = bolt ? 2.3 : 1.4;
  const n = lite ? 4 : 12, life = Math.max(.12, castAt * .8);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + .3, r = 1.5 + (k % 3) * .35, up = (k % 2 ? .6 : -.4);
    _d.set(Math.cos(a), up, Math.sin(a)).normalize();
    const delay = (k % 4) * life * .12;
    impact._emit(IMPACT_KIND.streak, H.x + _d.x * r, H.y + _d.y * r, H.z + _d.z * r, .3, k % 2 ? a1 : a0, life - delay,
      { vx: -_d.x * r / (life - delay), vy: -_d.y * r / (life - delay), vz: -_d.z * r / (life - delay), stretch: 1.4, grow: 1, delay });
  }
  impact._emit(IMPACT_KIND.star, H.x, H.y, H.z, bolt ? .9 : .8, a1, .18, { angle: .3, grow: .6, delay: life * .7 });
  if (bolt && !lite) zigzag(impact, H, _stars[1].copy(H).setY(H.y + 1.6), 3, 1.4, C.boltDeep, { width: .2, fade: .2, delay: life * .4 });
  return impact.spawned - before;
}

/** 운석 한 발(skills.js meteor 가 낙하 시작 순간 부른다). 3박자: ① 낙하 궤적(굵은 진홍 꼬리 + 주황 심 + 함께 떨어지는 불 머리
 *  + 궤적에 남는 불꽃) → ② .4초(판정 순간) 착탄 화염 폭발·퍼지는 충격 고리 → ③ 바깥으로 갈라지는 용암 균열이 1초 남는다. */
export function mageMeteorFall(game, start, pt, fall = .4) {
  const impact = game?.fx?.impact; if (!live(impact) || !start || !pt || reducedOf(game)) return 0;
  const before = impact.spawned, lite = !!game.fx.lite;
  _d.copy(pt).sub(start); const len = _d.length(), v = len / fall;
  impact.beam(start, _d, len, C.fireDeep, { speed: v, tail: 8, width: 1.6 });
  if (!lite) impact.beam(start, _d, len, C.fire, { speed: v, tail: 5, width: .6, delay: .01 });
  // 불 머리: 궤적 머리와 같은 속도로 떨어지는 작은 진홍 코어(흰 덩어리 금지 — 작게, 본색).
  impact._emit(IMPACT_KIND.flame, start.x, start.y, start.z, 1.1, C.fire, fall, { vx: _d.x / fall, vy: _d.y / fall, vz: _d.z / fall, grow: 0 });
  // 궤적에 남는 불꽃(머리가 지나는 순간 켜져 위로 흩어진다).
  for (let k = 1, n = lite ? 1 : 3; k <= n; k++) {
    const t = k / (n + 1); _b.copy(start).addScaledVector(_d, t);
    impact._emit(IMPACT_KIND.flame, _b.x, _b.y, _b.z, .7, k % 2 ? C.fire : C.fireDeep, .35, { vy: 1.5, grow: .6, gravity: -2, delay: t * fall });
  }
  impact.mark(pt, C.fireHot, { radius: 3.4, life: fall + .15, style: MARK_STYLE.reticle });
  fireBlast(impact, pt, 3.4, { delay: fall, lite });
  // 충격파: 착탄 직후 퍼지는 큰 진홍 고리(빌보드 6m 상한 안).
  impact._emit(IMPACT_KIND.ring, pt.x, .4, pt.z, 5.6, C.fireDeep, .36, { grow: 1, delay: fall + .05 });
  // 용암 균열: 바닥에 붙은 진홍 선이 바깥으로 갈라지고 1초 남는다.
  const cracks = lite ? 3 : 5;
  for (let k = 0; k < cracks; k++) {
    const a = (k / cracks) * TAU + impact.rng.next() * .6; _a.set(pt.x + Math.cos(a) * .6, .07, pt.z + Math.sin(a) * .6); _b.set(Math.cos(a), 0, Math.sin(a));
    impact.beam(_a, _b, 2.6 + impact.rng.next() * 1.4, k % 2 ? C.fireDeep : C.fire, { speed: 26, width: .22, fade: 1, delay: fall });
  }
  return impact.spawned - before;
}

/** 하늘에 열리는 룬: 높이 y 의 수평 나침 고리 + 오각 별(광선 다섯). 운석이 이 룬에서 떨어지는 것처럼 읽힌다. */
function skyRune(impact, c, r, life, { delay = 0, lite = false } = {}) {
  impact.mark(c, C.fire, { radius: r, life, style: MARK_STYLE.compass, angle: .3, delay, y: 0 });
  const n = lite ? 0 : 5;
  for (let k = 0; k < n; k++) {
    const a0 = (k / 5) * TAU + .3, a1 = (((k + 2) % 5) / 5) * TAU + .3;
    _p0.set(c.x + Math.cos(a0) * r * .9, c.y, c.z + Math.sin(a0) * r * .9);
    _d.set(Math.cos(a1) * r * .9 - Math.cos(a0) * r * .9, 0, Math.sin(a1) * r * .9 - Math.sin(a0) * r * .9);
    impact.beam(_p0, _d, _d.length(), k % 2 ? C.fire : C.fireDeep, { speed: 40, width: .16, fade: life - .1, delay: delay + k * .04 });
  }
}

/** 바닥 서리 소용돌이 팔: arms 갈래가 r0 → r1 로 감기며 뻗는 짧은 지면 광선. 눈보라의 '회오리' 실루엣(흰 원판 대신 진한 청 선). */
function frostSpiral(impact, c, arms, segs, r0, r1, phase, { width = .4, fade = .45, delay = 0 } = {}) {
  for (let j = 0; j < arms; j++) {
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs, base = phase + (j / arms) * TAU;
      const a0 = base + t0 * 1.7, a1 = base + t1 * 1.7, q0 = r0 + (r1 - r0) * t0, q1 = r0 + (r1 - r0) * t1;
      _p0.set(c.x + Math.cos(a0) * q0, .08, c.z + Math.sin(a0) * q0);
      _d.set(c.x + Math.cos(a1) * q1 - _p0.x, 0, c.z + Math.sin(a1) * q1 - _p0.z);
      impact.beam(_p0, _d, _d.length(), k % 2 ? C.frostMid : C.frostDeep, { width: width * (1.25 - t0 * .5), fade, delay: delay + k * .03, style: BEAM_STYLE.ice });
    }
  }
}

/** 눈보라 판정 틱(.4초마다): 몸 둘레 서리 가시 고리 + 판정 반경까지 감겨 나가는 서리 소용돌이 팔 + 바닥에서 솟는 얼음 가시. */
export function mageFrostTick(game, pos, i, radius = 6.8) {
  const impact = game?.fx?.impact; if (!live(impact) || !pos || reducedOf(game)) return 0;
  const before = impact.spawned, lite = !!game.fx.lite;
  // 큰 가시 고리는 옅은 흰 바퀴로 읽혀(3m 도 발밑 옅은 하늘색 띠였다) 몸 둘레 2.4m 진한 청 서리 고리만 두고, 판정 반경은 소용돌이 팔·얼음 가시가 채운다.
  impact.mark(pos, C.frostDeep, { radius: 2.4, life: .42, style: MARK_STYLE.thorn, angle: i * .37 });
  // 틱마다 .55rad 씩 돌아가는 세 갈래 소용돌이(폭풍이 도는 방향이 판정 박자마다 읽힌다).
  frostSpiral(impact, pos, lite ? 2 : 3, 3, 1.6, radius - .4, i * .55);
  // 얼음 가시: 옅은 frostHot(흰 심 광선) 대신 진한 하늘색 두 톤.
  iceSpikes(impact, pos, lite ? 3 : 6, 1.5, radius - .3, i % 2 ? C.frostMid : C.frostDeep, { phase: i * .9, width: .2, h: 1.7 });
  // 얼음 결정 반짝임: 판정 반경 안 두 점에 진한 하늘색 작은 별(결정면).
  // 판정 반경은 옅은 원판(castCircle·shockTex) 대신 틱마다 영웅을 따라가는 얇은 진한 청 조준 원으로 표시한다.
  impact.mark(pos, C.frostDeep, { radius, life: .44, style: MARK_STYLE.reticle, angle: i * .2 });
  for (let k = 0; k < 1; k++) {
    const a = i * 1.3 + k * 3.14, r = 2.6 + ((i + k) % 3) * 1.2;
    impact._emit(IMPACT_KIND.star, pos.x + Math.cos(a) * r, .9 + (k % 2) * .6, pos.z + Math.sin(a) * r, .6, C.frostMid, .3, { angle: a, grow: .6, delay: k * .05 });
  }
  // 폭풍의 회전: 몸을 감아 도는 얼음 결정(마름모 파편, 접선 속도 + 살짝 상승). 흰 눈송이 대신 진한 하늘색·남색 결정.
  const n = lite ? 3 : 6;
  for (let k = 0; k < n; k++) {
    const a = i * .7 + (k / n) * TAU, r = 2.4 + (k % 3) * 1.5;
    impact._emit(IMPACT_KIND.shard, pos.x + Math.cos(a) * r, .8 + (k % 4) * .55, pos.z + Math.sin(a) * r, .55, k % 2 ? C.frost : C.frostDeep, .42,
      { vx: -Math.sin(a) * 10, vy: 1.2, vz: Math.cos(a) * 10, angle: a, stretch: 1.6, grow: .5 });
  }
  return impact.spawned - before;
}

/** 프리즘 스펙트럼 다섯 빛깔(보라 → 남 → 청 → 청록 → 비취). 가산이라 진한 색만 쓴다(옅은 색은 흰 심이 된다). */
const PRISM_SPECTRUM = Object.freeze([0x7a3cff, 0x3a4cff, 0x1f7cff, 0x2a90d0, 0x16b49a]);

/** 프리즘 난반사 한 번(skills.js arc_reflect 가 튕길 때 부른다): 굴절 지점 두 겹 고리 + 바닥 굴절 표식 + 스펙트럼 다섯 갈래 광선.
 *  창이 작고 빨라 앞 시점에서 짧게만 보이던 것을, 튕긴 자리마다 .5초 남는 표식·빛 부채로 읽히게 한다(h1b). */
export function magePrismBounce(game, pos, dir, n = 0) {
  const impact = game?.fx?.impact; if (!live(impact) || !pos || reducedOf(game)) return 0;
  const before = impact.spawned;
  // 맞은 자리 별빛(흰 심)은 적 몸을 하얗게 덮어 빼고, 청록·보라 두 겹 고리로 굴절 지점을 찍는다.
  impact._emit(IMPACT_KIND.ring, pos.x, pos.y, pos.z, 1.2 + Math.min(n, 12) * .08, C.prismDeep, .22, { grow: 1 });
  impact._emit(IMPACT_KIND.ring, pos.x, pos.y, pos.z, 1.8, C.arcane, .26, { grow: 1, delay: .04 });
  _q.set(pos.x, 0, pos.z);
  impact.mark(_q, C.arcane, { radius: 1.4 + Math.min(n, 12) * .05, life: .55, style: MARK_STYLE.compass, angle: n * .6 });
  if (!game.fx.lite && dir) {
    const base = Math.atan2(dir.z, dir.x);
    for (let j = 0; j < PRISM_SPECTRUM.length; j++) {
      const a = base + (j - 2) * .22; _d.set(Math.cos(a), 0, Math.sin(a));
      impact.beam(pos, _d, 4.6, PRISM_SPECTRUM[j], { speed: 32, tail: 2.6, width: .2, style: BEAM_STYLE.prism });
    }
  }
  return impact.spawned - before;
}

/** 프리즘 창이 지나간 자리(매 프레임 한 마디, skills.js arc_reflect 가 부른다): 진한 청록 굵은 궤적 + 가는 보라 심이 .7초 남아
 *  굴절 경로 전체가 꺾인 빛줄기로 읽힌다. */
export function magePrismTrail(game, from, to) {
  const impact = game?.fx?.impact; if (!live(impact) || !from || !to || reducedOf(game)) return 0;
  _d.copy(to).sub(from); const l = _d.length(); if (!(l > .01)) return 0;
  // 분광 선(흰 심 없음): 흰 심 굵은 궤적은 창 둘레에 옅은 하늘색 띠를 남겼다(h1c).
  let used = impact.beam(from, _d, l, C.prismDeep, { width: .3, fade: .7, style: BEAM_STYLE.prism }) ? 1 : 0;
  if (!game.fx.lite && impact.beam(from, _d, l, C.arcane, { width: .1, fade: .5, style: BEAM_STYLE.prism })) used++;
  return used;
}

/**
 * 궁극기 예비 표식(시전 연출 중 바로 보인다). skill-signatures.js 의 SKILL_PRELUDES 가 합친다.
 * @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>}
 */
export const PRELUDES = {
  // 메테오 스톰: 발밑 주황 나침 진이 조여들고, 하늘로 불길 광선 셋이 솟아 운석을 부른다. 몸 둘레 불씨가 위로 빨려 오른다.
  meteor(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos;
    impact.mark(c, C.fire, { radius: 3.6, life: 1.1, style: MARK_STYLE.compass, angle: .3 });
    // 하늘에 열리는 룬(1박자): 영웅 위 하늘에 불의 나침 고리·오각 별이 그려진다.
    // 화면 안에 들도록 영웅 위(운석이 내려올 오른쪽) 5m.
    _q.set(c.x + 2.5, 5, c.z + .8);
    skyRune(impact, _q, 2.6, 1.1, { delay: .08, lite });
    _d.set(0, 1, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + .5; _a.set(c.x + Math.cos(a) * 1.4, .2, c.z + Math.sin(a) * 1.4);
      impact.beam(_a, _d, 12, i === 1 ? C.fireHot : C.fire, { speed: 30, tail: 5, width: .3, delay: i * .12 });
    }
    for (let k = 0, n = lite ? 5 : 12; k < n; k++) {
      const a = (k / n) * TAU, r = 2.6;
      impact._emit(IMPACT_KIND.streak, c.x + Math.cos(a) * r, .3, c.z + Math.sin(a) * r, .24, k % 2 ? C.fire : C.fireHot, .55,
        { vx: -Math.cos(a) * 3, vy: 6, vz: -Math.sin(a) * 3, stretch: 1.2, grow: 1, gravity: -2, delay: (k % 4) * .1 });
    }
  },
  // 성좌·별감옥 예비(시전 .4초 동안): 치켜든 손끝으로 별가루가 나선으로 모이고, 손끝 위로 금빛 별 셋이 차례로 떠올라
  // 하늘에 별자리를 거는 동작이 읽힌다. 발밑에는 작은 남색 나침 고리만(큰 원 금지).
  star_prison(ctx) {
    const { impact, player, f, lite } = ctx; const c = player.pos;
    const H = _stars[0].set(c.x + f.x * .4, 2.4, c.z + f.z * .4);
    impact.mark(c, C.star, { radius: 1.6, life: .5, style: MARK_STYLE.compass, angle: .2 });
    const n = lite ? 4 : 10, life = .32;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU, r = 1.8, d = (k % 3) * .04;
      impact._emit(IMPACT_KIND.streak, H.x + Math.cos(a) * r, H.y - .9 + (k % 2) * .5, H.z + Math.sin(a) * r, .2, k % 2 ? C.starGold : C.starLine, life - d,
        { vx: (-Math.cos(a) - Math.sin(a) * .8) * r / (life - d), vy: .9 / (life - d), vz: (-Math.sin(a) + Math.cos(a) * .8) * r / (life - d), stretch: 1.2, grow: 1, delay: d });
    }
    for (let k = 0; k < (lite ? 1 : 3); k++) {
      impact._emit(IMPACT_KIND.star, H.x + (k - 1) * .7, H.y + .3 + k * .35, H.z, .7, C.starGold, .4, { vy: 2.2, angle: .3 + k, grow: .6, delay: .1 + k * .07 });
    }
  },
  // 절대영도 예비(시전 .5초 동안): 몸 둘레 냉기가 손끝으로 빨려 들고(진한 하늘색 줄기), 발밑에서 작은 얼음 가시 고리가
  // 순서대로 솟는다. 판정 구역 쪽은 서명이 맡는다.
  absolute_zero(ctx) {
    const { impact, player, f, lite } = ctx; const c = player.pos;
    const H = _stars[0].set(c.x + f.x * .5, 2.3, c.z + f.z * .5);
    const n = lite ? 4 : 10, life = .42;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + .3, r = 1.6 + (k % 3) * .3, up = k % 2 ? .5 : -.5, d = (k % 4) * .05;
      _d.set(Math.cos(a), up, Math.sin(a)).normalize();
      impact._emit(IMPACT_KIND.streak, H.x + _d.x * r, H.y + _d.y * r, H.z + _d.z * r, .26, k % 2 ? C.frost : C.frostDeep, life - d,
        { vx: -_d.x * r / (life - d), vy: -_d.y * r / (life - d), vz: -_d.z * r / (life - d), stretch: 1.4, grow: 1, delay: d });
    }
    impact._emit(IMPACT_KIND.star, H.x, H.y, H.z, .8, C.frost, .2, { angle: .3, grow: .6, delay: life - .08 });
    impact.mark(c, C.frostDeep, { radius: 1.8, life: .6, style: MARK_STYLE.thorn, angle: .3 });
    if (!lite) for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + .52; _a.set(c.x + Math.cos(a) * 1.3, .02, c.z + Math.sin(a) * 1.3); _b.set(Math.cos(a) * .35, 1, Math.sin(a) * .35);
      impact.beam(_a, _b, 1.1, k % 2 ? C.frostMid : C.frostDeep, { speed: 10, width: .16, delay: k * .06, fade: .4, style: BEAM_STYLE.ice });
    }
  },
};

/** @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>} */
export const SIGNATURES = {
  // 화염구: 손끝 진홍 고리(손끝 모임 빛은 start 의 mageCharge) → 꼬리가 긴 불덩이 궤적(진홍 굵은 꼬리 + 주황 나선 + 가는 심,
  // 화염구와 같은 15m/s, 첫 적(직선 위)까지 — 대상이 없으면 6.5m) → 착탄 폭발 고리는 투사체 폭발(fx._fireImpact)이 맡는다.
  // 손끝 밝은 주황(fireHot) 큰 고리·불똥은 화염구 후광과 겹쳐 크림 번짐이 됐다(h1b): 진홍 본색 위주.
  fireball(ctx) {
    const { impact, player, f, lite } = ctx;
    _a.copy(player.pos).addScaledVector(f, 1).setY(1.4);
    impact._emit(IMPACT_KIND.ring, _a.x, _a.y, _a.z, 1.7, C.fire, .24, { grow: 1 });
    impact._emit(IMPACT_KIND.ring, _a.x, _a.y, _a.z, 1, C.fireDeep, .2, { grow: 1, delay: .05 });
    impact._streaks(_a, f, lite ? 4 : 8, 12, .36, C.fire, { up: 1.2, spread: .5, size: .24 });
    // 착탄 거리 예측(표시 전용): 화염구 직선(반폭 1.6m) 위 가장 가까운 살아 있는 적. 판정은 투사체가 따로 한다.
    let hit = 0; const foes = player.game?.enemies;
    if (Array.isArray(foes)) {
      let best = 15;
      for (const e of foes) {
        if (!e?.alive || !e.pos) continue;
        const dx = e.pos.x - _a.x, dz = e.pos.z - _a.z, along = dx * f.x + dz * f.z;
        if (along <= .3 || along >= best || Math.abs(dx * f.z - dz * f.x) > 1.6) continue;
        best = along; hit = along;
      }
    }
    const L = hit > 0 ? hit : 6.5;
    impact.beam(_a, f, L, C.fireDeep, { speed: 15, tail: 5, width: 1.1, fade: .3 });
    impact.beam(_a, f, L, C.fire, { speed: 15, tail: 3.5, width: .5, style: BEAM_STYLE.gale, delay: .01 });
    if (!lite) impact.beam(_a, f, L, C.fireHot, { speed: 15, tail: 1.6, width: .12, delay: .02 });
    // 화염구가 지나는 길에 떨어지는 불똥(화염구 속도 15m/s 와 같은 박자).
    for (let k = 0, n = Math.min(lite ? 3 : 6, Math.max(2, Math.floor(L / 1.1))); k < n; k++) {
      const d = .8 + k * 1.1; if (d > L) break; _b.copy(_a).addScaledVector(f, d);
      impact._emit(IMPACT_KIND.streak, _b.x, _b.y, _b.z, .22, k % 2 ? C.fire : C.fireDeep, .4, { vx: f.z * 3 * (k % 2 ? 1 : -1), vy: 1, vz: -f.x * 3 * (k % 2 ? 1 : -1), stretch: 1, grow: 1, gravity: 14, delay: d / 15 });
    }
    // 착탄 폭발 고리·나침 표식은 투사체 폭발(fx._fireImpact)이 같은 자리에 이미 그린다: 겹쳐 쌓지 않는다(블룸 번짐 방지).
  },
  // 번개 사슬: 하늘에서 들어 올린 손으로 청백 번개가 내리꽂히고 발밑 짧은 고리. 연쇄 마디는 mageBolt.
  chain(ctx) {
    const { impact, player } = ctx;
    _p0.set(player.pos.x + .6, 9, player.pos.z - .4); _p1.copy(player.pos).setY(1.8);
    _stars[0].copy(_p0); _stars[1].copy(_p1);
    zigzag(impact, _stars[0], _stars[1], 7, 1.1, C.boltDeep, { width: .55, fade: .34 });
    zigzag(impact, _stars[0], _stars[1], 5, 1.5, C.boltCore, { width: .18, fade: .22 });
    impact._emit(IMPACT_KIND.star, _stars[1].x, _stars[1].y, _stars[1].z, 1.8, C.bolt, .18, { angle: .4, grow: .5 });
    // 발밑 정전기: 바닥을 기는 짧은 번개 가지 여섯.
    for (let k = 0; k < (ctx.lite ? 3 : 6); k++) {
      const a = (k / 6) * TAU + .3; _stars[2].copy(player.pos).setY(.1);
      _stars[3].set(player.pos.x + Math.cos(a) * 2.6, .1, player.pos.z + Math.sin(a) * 2.6);
      zigzag(impact, _stars[2], _stars[3], 3, 1.3, C.boltDeep, { width: .2, fade: .26, delay: .03 });
    }
  },
  // 빙결 폭풍: 판정 반경(6.8m) 서리 가시 고리가 폭풍 내내 남고 바깥 둘레에 얼음 가시 벽이 솟는다. 틱마다는 mageFrostTick.
  blizzard(ctx) {
    const { impact, player, lite } = ctx;
    impact.mark(player.pos, C.frostDeep, { radius: 2.6, life: 1.2, style: MARK_STYLE.thorn, angle: .3 });
    iceSpikes(impact, player.pos, lite ? 7 : 16, 6.2, 7, C.frostDeep, { h: 2, width: .18, fade: 1.6 });
    // 시전 순간 바깥에서 몸 쪽으로 감기는 네 갈래 소용돌이(폭풍이 모이는 예비 동작). 틱 소용돌이는 mageFrostTick.
    if (!lite) frostSpiral(impact, player.pos, 4, 3, 1.2, 6.4, .2, { width: .6, fade: .6 });
  },
  // 메테오 스톰(궁극기): 낙하 구역(7.8m)에 주황 나침 표식과 열기 고리가 먼저 깔린다. 한 발마다의 궤적·폭발은 mageMeteorFall.
  meteor(ctx) {
    const { impact, at, lite } = ctx;
    impact.mark(at, C.fire, { radius: 4.5, life: 1.8, style: MARK_STYLE.compass });
    impact._emit(IMPACT_KIND.ring, at.x, .4, at.z, 4.5, C.fire, .36, { grow: 1 });
    // 낙하 원점 쪽(skills.js 운석 출발점 +4.5,+6.5,+1.2 의 .85배) 하늘에 큰 룬이 열리고, 운석 궤적이 그 룬에서 대각선으로 내리꽂힌다.
    _q.set(at.x + 3.8, 5.5, at.z + 1);
    skyRune(impact, _q, 3.4, 1.6, { lite });
  },
  // 프리즘 난반사: 손끝 두 겹 고리에서 빛이 스펙트럼 다섯 갈래(보라 → 비취)로 부채처럼 갈라져 앞으로 뻗고, 바닥에 굴절 각을 재는
  // 조준 원과 앞으로 펼쳐지는 빛 부채 표식이 남는다. 튕길 때는 magePrismBounce, 궤적은 magePrismTrail.
  arc_reflect(ctx) {
    const { impact, player, f, lite } = ctx;
    _a.copy(player.pos).addScaledVector(f, 1.2).setY(1.3);
    // 손끝 프리즘 결정(h1c): 시전 순간 손끝 두 겹 고리·임팩트 코어가 옅은 청색 큰 원으로 보였다. 대신 꼭짓점이 앞을 향한
    // 날카로운 삼각 프리즘 윤곽(분광 선 세 변)을 세우고, 앞 꼭짓점에서 스펙트럼 다섯 갈래가 갈라져 나간다.
    const base = Math.atan2(f.z, f.x), R = .8;
    for (let k = 0; k < 3; k++) {
      const a0 = base + (k / 3) * TAU, a1 = base + ((k + 1) / 3) * TAU;
      _p0.set(_a.x + Math.cos(a0) * R, _a.y, _a.z + Math.sin(a0) * R);
      _d.set(Math.cos(a1) * R - Math.cos(a0) * R, 0, Math.sin(a1) * R - Math.sin(a0) * R);
      impact.beam(_p0, _d, _d.length(), k ? C.prismDeep : C.arcane, { speed: 24, width: .07, fade: .45, delay: k * .03, style: BEAM_STYLE.prism });
    }
    _p1.set(_a.x + Math.cos(base) * R, _a.y, _a.z + Math.sin(base) * R);
    for (let j = 0; j < (lite ? 3 : PRISM_SPECTRUM.length); j++) {
      const jj = lite ? j * 2 : j, a = base + (jj - 2) * .09; _d.set(Math.cos(a), 0, Math.sin(a));
      impact.beam(_p1, _d, 10, PRISM_SPECTRUM[jj], { speed: 30, tail: 5, width: .16, delay: .06, style: BEAM_STYLE.prism });
    }
    // 바닥: 발밑 청록 조준 원 + 앞으로 펼쳐지는 보라 빛 부채(굴절이 시작되는 방향).
    impact.mark(player.pos, C.prismDeep, { radius: 1.8, life: .5, style: MARK_STYLE.reticle, angle: base });
    if (!lite) impact.mark(player.pos, C.arcane, { radius: 5, life: .45, style: MARK_STYLE.fan, angle: base, delay: .03 });
    // 각성 강화(2026-10-30): ① 분광 쓸기 — 스펙트럼 일곱 줄이 왼쪽에서 오른쪽으로 .15초 동안 차례로 그어져 '빛이 갈라지며 훑는' 부채
    // (원형 문양이 아닌 전방 부채 실루엣). ② 손끝 프리즘 결정 둘레를 도는 분광 파편 여섯. ③ 창이 튀어 나가는 반동으로 뒤로 튀는 불똥.
    const sweep = lite ? 3 : 7;
    for (let k = 0; k < sweep; k++) {
      const t = sweep > 1 ? k / (sweep - 1) : .5, a = base - .5 + t; _d.set(Math.cos(a), 0, Math.sin(a));
      impact.beam(_p1, _d, 7 - Math.abs(t - .5) * 3, PRISM_SPECTRUM[k % PRISM_SPECTRUM.length], { speed: 42, tail: 2.4, width: .12, delay: .1 + k * .022, style: BEAM_STYLE.prism });
    }
    if (!lite) {
      for (let k = 0; k < 6; k++) {
        const a = base + (k / 6) * TAU, r = 1.1;
        impact._emit(IMPACT_KIND.shard, _a.x + Math.cos(a) * r, _a.y + (k % 2 ? .25 : -.2), _a.z + Math.sin(a) * r, .36, PRISM_SPECTRUM[k % 5], .4,
          { vx: -Math.sin(a) * 7, vy: 0, vz: Math.cos(a) * 7, angle: a, stretch: 1.8, grow: .4, delay: k * .015 });
      }
      for (let k = 0; k < 4; k++) {
        const a = base + Math.PI + (k - 1.5) * .35;
        impact._emit(IMPACT_KIND.streak, _a.x, _a.y, _a.z, .2, k % 2 ? C.prismDeep : C.arcane, .3, { vx: Math.cos(a) * 9, vy: 1.5, vz: Math.sin(a) * 9, stretch: 1.2, grow: 1, gravity: 10 });
      }
    }
    // ④ 첫 굴절 예고: 창 직선(반폭 1.7m) 위 가장 가까운 적 발밑에 창이 닿는 순간(거리/30m/s) 보라 나침 표식. 표시 전용(판정은 skills.js).
    const foes = player.game?.enemies;
    if (Array.isArray(foes)) {
      let best = 15, hit = null;
      for (const e of foes) {
        if (!e?.alive || !e.pos) continue;
        const dx = e.pos.x - _a.x, dz = e.pos.z - _a.z, along = dx * f.x + dz * f.z;
        if (along <= .2 || along >= best || Math.abs(dx * f.z - dz * f.x) > 1.7) continue;
        best = along; hit = e;
      }
      if (hit) { _q.set(hit.pos.x, 0, hit.pos.z); impact.mark(_q, C.arcane, { radius: 1.3, life: .4, style: MARK_STYLE.compass, angle: base, delay: Math.max(0, best - 1.7) / 30 }); }
    }
  },
  // 시간 봉인: 바닥 시계판(skills.js)에 더해 열두 시각 눈금 자리에 보라 별빛이 한 바퀴 차례로 켜지고 큰 보라 고리가 퍼진다.
  chrono_seal(ctx) {
    const { impact, player, lite } = ctx; const c = player.pos;
    impact._emit(IMPACT_KIND.ring, c.x, .5, c.z, 4.5, C.arcane, .4, { grow: 1 });
    // 발밑 작은 시계판(봉인 시간 동안 바늘이 한 바퀴) + 위로 떠오르는 보라 시간 입자.
    impact.mark(c, C.arcaneHot, { radius: 2.2, life: 3, style: MARK_STYLE.clock });
    // 각성 강화(2026-10-30): 원형 문양 대신 '시계 바늘' 실루엣. 긴 분침이 .4초 동안 시계 방향으로 여덟 칸 쓸고(마디마다 짧게 남아 회전이 읽힌다),
    // 굵은 시침은 봉인 시간 동안 멈춰 선다. 판정 반경(9.5m)을 넘지 않게 6m.
    const sweeps = lite ? 4 : 8;
    for (let k = 0; k < sweeps; k++) {
      const a = Math.PI / 2 - (k / sweeps) * Math.PI * 1.5; _d.set(Math.cos(a), 0, -Math.sin(a));
      _a.set(c.x, .12, c.z);
      impact.beam(_a, _d, 6, k % 2 ? C.arcane : C.star, { width: .24, fade: .16, delay: k * (.4 / sweeps) });
    }
    _d.set(Math.cos(.6), 0, -Math.sin(.6)); _a.set(c.x, .14, c.z);
    impact.beam(_a, _d, 3.4, C.arcane, { width: .42, fade: 1.6, delay: .05 });
    // 봉인된 적 옆구리의 모래시계(X 자 두 획): skills.js 와 같은 9.5m 안 살아 있는 적, 앞 다섯까지. 표시 전용.
    // 머리 위는 조준 표식·체력 막대 자리라 비켜서 몸 오른쪽 .8m 에 세운다(적 몸을 덮지 않는다).
    const foes = player.game?.enemies;
    if (Array.isArray(foes) && !lite) {
      let shown = 0;
      for (const e of foes) {
        if (shown >= 5) break;
        if (!e?.alive || e.spawning || !e.pos) continue;
        const dx = e.pos.x - c.x, dz = e.pos.z - c.z; if (dx * dx + dz * dz >= 9.5 * 9.5) continue;
        const mid = 1.75 * (e.def?.scale || 1) * .55;
        for (let s = -1; s <= 1; s += 2) {
          _a.set(e.pos.x + .8 - .28 * s, mid + .42, e.pos.z); _d.set(.56 * s, -.84, 0);
          impact.beam(_a, _d, _d.length(), C.arcane, { width: .14, fade: 1.2, delay: .06 + shown * .04 });
        }
        shown++;
      }
    }
    for (let k = 0; k < (lite ? 4 : 8); k++) {
      const a = (k / 8) * TAU, r = 1.5 + (k % 3) * 1.6;
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
    // 각성 강화(2026-10-30): 감옥이 조여 드는 두 번째 칠각성(반지름 3m, 반 칸 돌림)이 판정 직전 그어지고,
    // 별가루가 나선으로 감겨 들어(접선 + 안쪽 속도, 판정 순간 중심 도착) '중력에 끌려온다'가 읽힌다.
    if (!lite) {
      const r2 = 3;
      for (let k = 0; k < N; k++) {
        const a0 = ((k + .5) / N) * TAU + .2, a1 = ((k + 3.5) / N) * TAU + .2;
        _p0.set(at.x + Math.cos(a0) * r2, .3, at.z + Math.sin(a0) * r2);
        _d.set(Math.cos(a1) * r2 - Math.cos(a0) * r2, 0, Math.sin(a1) * r2 - Math.sin(a0) * r2);
        impact.beam(_p0, _d, _d.length(), C.star, { speed: 60, width: .2, delay: T - .1 + k * .012, fade: .3 });
      }
    }
    const n = lite ? 5 : 10, life = T + .02;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r = 6.4, sw = 1.1;
      // 시작점에서 중심까지 life 초: 안쪽 속도 r/life + 접선 속도(시계 반대) → 나선으로 감겨 든다.
      impact._emit(IMPACT_KIND.streak, at.x + Math.cos(a) * r, .6 + (i % 3) * .3, at.z + Math.sin(a) * r, .22, i % 2 ? C.starGold : C.star, life,
        { vx: (-Math.cos(a) - Math.sin(a) * sw) * r / life, vy: 0, vz: (-Math.sin(a) + Math.cos(a) * sw) * r / life, stretch: 1.3, grow: 1, delay: 0 });
    }
    // 판정(T): 감옥이 닫히는 순간 중심에서 하늘로 솟는 별빛 기둥(남색 굵은 + 금 가는 심) — 원형이 아닌 수직 실루엣.
    _a.set(at.x, .2, at.z); _d.set(0, 1, 0);
    impact.beam(_a, _d, 9, C.star, { speed: 60, tail: 7, width: .9, delay: T });
    impact.beam(_a, _d, 9, C.starGold, { speed: 60, tail: 5, width: .22, delay: T });
    impact._emit(IMPACT_KIND.star, at.x, 1, at.z, 1.8, C.star, .2, { angle: .3, grow: .4, delay: T });
    impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 4.5, C.star, .34, { grow: 1, delay: T });
    // 별 파편: 일곱 꼭짓점 쪽으로 땅을 긋는 짧은 금빛 선(폭발이 별 모양으로 갈라진다).
    for (let k = 0, m = lite ? 0 : N; k < m; k++) {
      const a = (k / N) * TAU + .2; _d.set(Math.cos(a), 0, Math.sin(a)); _a.set(at.x + _d.x * .9, .1, at.z + _d.z * .9);
      impact.beam(_a, _d, 3.2, k % 2 ? C.starGold : C.starLine, { speed: 30, width: .18, fade: .3, delay: T + .03 });
    }
  },
  // 절대영도·종언(최상위 각성): 서리 가시 고리(9m)가 조여 들고 .35초(판정)에 바닥 전체에서 얼음 가시 숲이 솟으며
  // 진한 하늘색 결정 균열이 바깥으로 뻗는다. 흰 텍스처 덩어리 대신 가시·선의 실루엣.
  // 각성 강화(2026-10-30): 3박자 + 눈결정 실루엣. ① 얼어붙기(0~T) — 구역 가장자리(9m)에 얼음 가시가 서고 여섯 갈래 서리가
  // 가장자리에서 중심으로 기어 들어 판정 순간 중심에 닿는다. ② 판정(T) — 중심에서 여섯 팔 + 곁가지의 거대한 눈결정이 바닥에 뻗고,
  // 그 뒤를 따라 얼음 가시 물결이 안에서 밖으로 솟는다. ③ 파쇄(T+.12) — 결정 파편이 바깥으로 튄다. 흰 원판·옅은 frostHot 은 쓰지 않는다.
  absolute_zero(ctx) {
    const { impact, at, lite } = ctx; const T = .35, R = 8;
    iceSpikes(impact, at, lite ? 5 : 8, 8, 9.2, C.frostMid, { h: 1.6, width: .14, fade: .5 });
    impact.mark(at, C.frostMid, { radius: 4, life: T + .1, style: MARK_STYLE.thorn, angle: .3 });
    const arms = 6;
    for (let k = 0; k < arms; k++) {
      const a = (k / arms) * TAU + .52 + Math.PI / arms; _d.set(-Math.cos(a), 0, -Math.sin(a));
      _a.set(at.x + Math.cos(a) * 8.6, .07, at.z + Math.sin(a) * 8.6);
      if (!lite || k % 2 === 0) impact.beam(_a, _d, 8.2, k % 2 ? C.frostDeep : C.frostMid, { speed: 8.2 / T, tail: 3, width: .3, style: BEAM_STYLE.ice });
    }
    // ② 눈결정: 여섯 팔(판정 순간 동시에 바깥으로 45m/s) + 팔마다 4.2m 지점 곁가지 두 획(±60°).
    for (let k = 0; k < arms; k++) {
      const a = (k / arms) * TAU + .52; _d.set(Math.cos(a), 0, Math.sin(a)); _a.set(at.x + _d.x * .6, .08, at.z + _d.z * .6);
      impact.beam(_a, _d, R, k % 2 ? C.frost : C.frostMid, { speed: 45, width: .36, delay: T, fade: .6, style: BEAM_STYLE.ice });
      if (lite) continue;
      _p0.set(at.x + _d.x * 4.2, .08, at.z + _d.z * 4.2);
      for (let s = -1; s <= 1; s += 2) {
        const b = a + s * 1.05; _b.set(Math.cos(b), 0, Math.sin(b));
        impact.beam(_p0, _b, 1.9, C.frostDeep, { speed: 30, width: .22, delay: T + 4.2 / 45, fade: .5, style: BEAM_STYLE.ice });
      }
      impact._emit(IMPACT_KIND.star, at.x + _d.x * R, .5, at.z + _d.z * R, .8, C.frost, .3, { angle: a, grow: .5, delay: T + R / 45 });
    }
    // 얼음 가시 물결: 반지름이 클수록 늦게(안 → 밖) 솟는다. 판정 뒤 .2초 안에 모두 시작.
    const spikes = lite ? 6 : 12;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * TAU * 2.6 + .3, r = 1.2 + (i / spikes) * 6.6;
      _a.set(at.x + Math.cos(a) * r, .02, at.z + Math.sin(a) * r); _b.set(Math.cos(a) * .4, 1, Math.sin(a) * .4);
      impact.beam(_a, _b, 1.7 + (i % 3) * .4, i % 2 ? C.frostMid : C.frostDeep, { speed: 14, width: .26, delay: T + r * .02, fade: .7, style: BEAM_STYLE.ice });
    }
    impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 5, C.frost, .4, { grow: 1, delay: T });
    // ③ 파쇄: 결정 파편이 바깥·위로 튀고 떨어진다.
    for (let i = 0, n = lite ? 3 : 6; i < n; i++) {
      const a = (i / n) * TAU + .2, sp = 9 + (i % 3) * 2;
      impact._emit(IMPACT_KIND.shard, at.x + Math.cos(a) * 1.5, 1, at.z + Math.sin(a) * 1.5, .5, i % 2 ? C.frost : C.frostDeep, .5,
        { vx: Math.cos(a) * sp, vy: 6, vz: Math.sin(a) * sp, angle: a, stretch: 1.6, grow: .6, gravity: 18, delay: T + .12 });
    }
  },
};
