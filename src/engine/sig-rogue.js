import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE } from './impact-vfx.js';

/**
 * rogue 스킬 '모양 언어' 서명(h1b). skill-signatures.js 가 합친다. 규칙은 그 파일 머리 주석과 같다:
 * 인스턴스 임팩트 층(드로우콜 1)만 쓰고, 판정 시각은 delay 칸으로 맞추며, 프레임당 할당·Math.random 을 쓰지 않는다.
 * 암살자: 질주 = 바닥 그림자 칼날 궤적 / 독무 = 조준 원 → 착탄 독 가시 고리 / 난무 = 앞 반원 잔상 칼날 박자 /
 * 천 개의 칼날 = 하늘에서 꽂히는 칼날 비 + 가시 대원 / 표식 = 둘레 표식 원 + 분신 X 자국 / 공허 보법 = 순간이동 별꼴 연쇄 /
 * 야행 = 둘레를 도는 칼날 행렬 / 일식 = 수렴하는 가시 원 → 일식 고리(짙은 보라 테 + 자홍 코로나).
 * 색은 짙은 보라·자홍 위주로 쓴다(가산 혼합에서 밝은 연보라는 흰 덩어리가 된다). 흰 심을 가진 별빛은 작게, 100ms 이하.
 */
const VIOLET = 0xb466ff, DEEP = 0x6a2cff, NIGHT = 0x4a1aa8, MAGENTA = 0xd25cff, POISON = 0x4fc23a;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const yawOf = (f) => Math.atan2(f.z, f.x);
/** 화면 기준 날 각도(카메라가 없으면 월드 방위). */
const cutAngle = (impact, dir) => (typeof impact._screenAngle === 'function' ? impact._screenAngle(dir) : yawOf(dir));

/** @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>} */
export const SIGNATURES = {
  // 그림자 질주: 초속 28m 질주와 같은 속도로 바닥에 그림자 길(짙은 번짐 + 보라 심)이 그어지고,
  // 2m 마다 좌우로 엇갈린 칼날 자국이 질주가 지나는 순간 새겨진다. 끝에서 짙은 고리.
  shadow_dash(ctx) {
    const { impact, f, player, lite } = ctx; const SPEED = 28, LEN = 12;
    _a.copy(player.pos).setY(.08);
    impact.beam(_a, f, LEN, NIGHT, { speed: SPEED, tail: 7, width: .55 });
    impact.beam(_a, f, LEN, VIOLET, { speed: SPEED, tail: 4, width: .12 });
    const ang = cutAngle(impact, f);
    for (let i = 1, n = lite ? 3 : 6; i <= n; i++) {
      const d = i * (LEN / (n + 1)); _b.copy(player.pos).addScaledVector(f, d).setY(.9);
      impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 2.3, i % 2 ? VIOLET : MAGENTA, .34, { angle: ang + (i % 2 ? .9 : -.9), stretch: 1.1, grow: .9, delay: d / SPEED });
    }
    _b.copy(player.pos).addScaledVector(f, LEN * .95);
    impact._emit(IMPACT_KIND.ring, _b.x, .6, _b.z, 3, DEEP, .34, { grow: 1, delay: LEN / SPEED });
    impact.mark(_b, VIOLET, { radius: 1.8, life: .5, style: MARK_STYLE.thorn, delay: LEN / SPEED, angle: .4 });
  },
  // 독무 폭탄: 착탄 지점에 조준 원이 먼저 잡히고, 0.5초 뒤 착탄 순간 독 가시 고리 + 짙은 보라 고리 + 솟는 독 거품.
  poison_bomb(ctx) {
    const { impact, at, lite } = ctx; const LAND = .5;
    impact.mark(at, MAGENTA, { radius: 2.2, life: LAND + .15, style: MARK_STYLE.reticle });
    impact.mark(at, POISON, { radius: 4.4, life: .9, style: MARK_STYLE.thorn, delay: LAND, angle: .3 });
    impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 2.4, DEEP, .38, { grow: 1, delay: LAND });
    impact._emit(IMPACT_KIND.star, at.x, .6, at.z, 1.4, POISON, .1, { angle: .3, grow: .5, delay: LAND });
    for (let i = 0, n = lite ? 4 : 9; i < n; i++) {
      const a = i * 2.4, r = .8 + (i % 3) * 1.1;
      impact._emit(IMPACT_KIND.streak, at.x + Math.cos(a) * r, .3, at.z + Math.sin(a) * r, .24, i % 3 ? POISON : MAGENTA, .7,
        { vx: Math.cos(a) * .6, vy: 2.6 + (i % 4) * .6, vz: Math.sin(a) * .6, stretch: .5, grow: 1, gravity: -1, delay: LAND + (i % 3) * .08 });
    }
  },
  // 환영 난무: 앞 반원에 잔상 칼날 자국이 실제 베기 박자(0.115초)로 좌우를 번갈아 그어지고, 마지막에 X 자 마무리.
  flurry(ctx) {
    const { impact, f, player, lite } = ctx; const ang = cutAngle(impact, f);
    impact.mark(player.pos, DEEP, { radius: 3.6, life: 1.1, style: MARK_STYLE.fan, angle: yawOf(f) });
    for (let i = 0, n = lite ? 4 : 8; i < n; i++) {
      const side = (i % 2 ? 1 : -1), off = (i % 4) * .3;
      _b.copy(player.pos).addScaledVector(f, 1.6 + off).setY(.7 + (i % 3) * .3);
      impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 2.8, i % 2 ? MAGENTA : VIOLET, .22, { angle: ang + side * 1.1, stretch: 1.15, grow: .9, delay: Math.max(0, (i * (8 / n) + 2) * .115 - .28) });
    }
    _b.copy(player.pos).addScaledVector(f, 1.8).setY(1);
    for (const s of [-1, 1]) impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 3.2, s > 0 ? MAGENTA : VIOLET, .3, { angle: ang + s * .8, stretch: 1.2, grow: .9, delay: .75 + (s > 0 ? .035 : 0) });
    impact._emit(IMPACT_KIND.ring, _b.x, _b.y, _b.z, 3.4, DEEP, .3, { grow: 1, delay: .75 });
  },
  // 천 개의 칼날(궁극기): 둘레 가시 대원(지름 16m) + 하늘에서 비스듬히 꽂히는 칼날 광선이 여덟 박자(0.15초) 동안 쏟아지고,
  // 꽂힌 자리마다 엇갈린 칼날 자국이 남는다. 마지막 박자에 큰 짙은 고리.
  thousand(ctx) {
    const { impact, player, lite } = ctx; const rng = impact.rng, R = 7, SPEED = 72;
    impact.mark(player.pos, VIOLET, { radius: 8, life: 1.5, style: MARK_STYLE.thorn, angle: .2 });
    impact.mark(player.pos, MAGENTA, { radius: 5, life: 1.2, style: MARK_STYLE.thorn, angle: 1.1, delay: .3 });
    const n = lite ? 6 : 14;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * 6.2831853, r = 1.8 + rng.next() * (R - 1.8), wave = (i * 8 / n) | 0;
      _b.set(player.pos.x + Math.cos(a) * r, .05, player.pos.z + Math.sin(a) * r);
      _a.set(_b.x - 1.2, 8, _b.z - .8); _d.copy(_b).sub(_a); const len = _d.length(), hitT = wave * .15 + .13;
      impact.beam(_a, _d, len, i % 2 ? VIOLET : MAGENTA, { speed: SPEED, tail: 3.5, width: .13, delay: Math.max(0, hitT - len / SPEED) });
      impact._emit(IMPACT_KIND.cut, _b.x, .5, _b.z, 1.4, i % 2 ? DEEP : VIOLET, .3, { angle: a, stretch: 1, grow: .9, delay: hitT });
    }
    impact.mark(player.pos, MAGENTA, { radius: 7, life: .5, style: MARK_STYLE.reticle, delay: 1.2 });
    impact._emit(IMPACT_KIND.ring, player.pos.x, .8, player.pos.z, 3, DEEP, .45, { grow: 1, delay: 1.2 });
  },
  // 그림자 표식: 표시 범위(13m)를 두른 표식 원 + 둘레 여섯 점에 표식 가시가 차례로 돋고 분신의 X 자국이 그어진다.
  // 모인 표식이 터지는 순간(표식 6개 기준 .18+6×.09+.43초) 가운데 짙은 고리.
  shadow_mark(ctx) {
    const { impact, f, player, lite } = ctx; const ang = cutAngle(impact, f), HUB = .18 + 6 * .09 + .43;
    impact.mark(player.pos, DEEP, { radius: 5.6, life: 1.2, style: MARK_STYLE.reticle, angle: .4 });
    for (let i = 0, n = lite ? 3 : 6; i < n; i++) {
      const a = yawOf(f) + (i - (n - 1) / 2) * .55, r = 3.2 + (i % 2) * 1.3, t = .18 + i * .09;
      _b.set(player.pos.x + Math.cos(a) * r, 0, player.pos.z + Math.sin(a) * r);
      impact.mark(_b, VIOLET, { radius: .9, life: .9, style: MARK_STYLE.reticle, angle: i * .7 });
      impact._emit(IMPACT_KIND.cut, _b.x, 1, _b.z, 1.8, MAGENTA, .24, { angle: ang + .8, stretch: 1.1, grow: .9, delay: t });
      impact._emit(IMPACT_KIND.cut, _b.x, 1, _b.z, 1.8, VIOLET, .24, { angle: ang - .8, stretch: 1.1, grow: .9, delay: t + .04 });
    }
    _b.copy(player.pos).addScaledVector(f, 3.6);
    impact._emit(IMPACT_KIND.ring, _b.x, .7, _b.z, 3, DEEP, .4, { grow: 1, delay: HUB });
    impact.mark(_b, MAGENTA, { radius: 3, life: .5, style: MARK_STYLE.thorn, delay: HUB });
  },
  // 공허 보법: 둘레 여덟 점을 잇는 순간이동 별꼴 연쇄(점멸 박자 0.13초마다 한 획)와 획 끝 칼날 자국,
  // 바닥엔 짙은 공허 원. 끝(total 2초 - 시전 .045초)에 바닥 시계판 + 작은 고리.
  void_step(ctx) {
    const { impact, player, lite } = ctx; const P = 8, R = 4.2;
    impact.mark(player.pos, NIGHT, { radius: 6.5, life: 2, style: MARK_STYLE.thorn, angle: .3 });
    for (let i = 0, n = lite ? 6 : 12; i < n; i++) {
      const j = (i * 3) % P, k = ((i + 1) * 3) % P;
      _a.set(player.pos.x + Math.cos(j / P * 6.2831853) * R, .5, player.pos.z + Math.sin(j / P * 6.2831853) * R);
      _b.set(player.pos.x + Math.cos(k / P * 6.2831853) * R, .5, player.pos.z + Math.sin(k / P * 6.2831853) * R);
      _d.copy(_b).sub(_a); const len = _d.length(), t = i * .13 * (12 / n);
      impact.beam(_a, _d, len, i % 2 ? DEEP : VIOLET, { speed: 120, tail: 0, width: .14, fade: .3, delay: t });
      impact._emit(IMPACT_KIND.cut, _b.x, 1, _b.z, 1.9, i % 2 ? MAGENTA : VIOLET, .2, { angle: cutAngle(impact, _d) + (i % 2 ? .8 : -.8), stretch: 1.1, grow: .9, delay: t + len / 120 });
    }
    impact.mark(player.pos, VIOLET, { radius: 7, life: .55, style: MARK_STYLE.clock, delay: 1.9 });
    impact._emit(IMPACT_KIND.ring, player.pos.x, 1, player.pos.z, 3.2, MAGENTA, .4, { grow: 1, delay: 1.95 });
  },
  // 야행 · 그림자연무: 착탄점 둘레(반경 5m)를 칼날 행렬이 세 박자(0, .1, .2초)로 돌며 접선 방향으로 베고, 바닥엔 짙은 가시 원.
  night_parade(ctx) {
    const { impact, at, lite } = ctx; const R = 4.6, n = lite ? 3 : 6;
    impact.mark(at, NIGHT, { radius: 5.4, life: .8, style: MARK_STYLE.thorn, angle: .2 });
    for (let w = 0; w < 3; w++) for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2831853 + w * .55;
      _b.set(at.x + Math.cos(a) * R, .9, at.z + Math.sin(a) * R); _d.set(-Math.sin(a), 0, Math.cos(a));
      impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 2, w === 1 ? MAGENTA : VIOLET, .24, { angle: cutAngle(impact, _d), stretch: 1.1, grow: .9, delay: w * .1 });
    }
    impact._emit(IMPACT_KIND.ring, at.x, .6, at.z, 3, DEEP, .36, { grow: 1, delay: .2 });
  },
  // 일식 · 무영절명(최상위 각성): 착탄점에 가시 원이 조여들고(예비), 판정 순간(.3초) 일식 고리 —
  // 짙은 보라 시계판 큰 테 + 자홍 가시 안쪽 테(바닥) + 바깥으로 뻗는 코로나 줄기 + 가운데 X 자 칼날. 화면을 가로지르는 큰 빌보드 고리는 쓰지 않는다.
  eclipse_edge(ctx) {
    const { impact, at, lite } = ctx; const HIT = .3;
    impact.mark(at, DEEP, { radius: 7.5, life: HIT + .1, style: MARK_STYLE.thorn, angle: .3 });
    impact.mark(at, NIGHT, { radius: 8.2, life: .9, style: MARK_STYLE.clock, delay: HIT });
    impact.mark(at, MAGENTA, { radius: 5.6, life: .7, style: MARK_STYLE.thorn, angle: 1.2, delay: HIT + .05 });
    impact._emit(IMPACT_KIND.ring, at.x, 1, at.z, 3.4, MAGENTA, .4, { grow: 1, delay: HIT });
    for (const s of [-1, 1]) impact._emit(IMPACT_KIND.cut, at.x, 1.2, at.z, 4.2, s > 0 ? MAGENTA : VIOLET, .32, { angle: s * .8, stretch: 1.2, grow: .9, delay: HIT + (s > 0 ? .04 : 0) });
    for (let i = 0, n = lite ? 6 : 14; i < n; i++) {
      const a = (i / n) * 6.2831853;
      impact._emit(IMPACT_KIND.streak, at.x + Math.cos(a) * 2.4, .8, at.z + Math.sin(a) * 2.4, .34, i % 2 ? MAGENTA : DEEP, .4,
        { vx: Math.cos(a) * 16, vy: 1.5, vz: Math.sin(a) * 16, stretch: 1, grow: 1, delay: HIT });
    }
  },
};
