import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE } from './impact-vfx.js';

/**
 * rogue 스킬 '모양 언어' 서명(h1b). skill-signatures.js 가 합친다. 규칙은 그 파일 머리 주석과 같다:
 * 인스턴스 임팩트 층(드로우콜 1)만 쓰고, 판정 시각은 delay 칸으로 맞추며, 프레임당 할당·Math.random 을 쓰지 않는다.
 * 암살자: 질주 = 바닥 그림자 칼날 궤적 / 독무 = 조준 원 → 착탄 두 겹 독 웅덩이 테 + 독 기둥 / 난무 = 앞 반원 잔상 칼날 박자 /
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
  // 그림자 질주(강화 레인 2026-10-29): 초속 28m 질주와 같은 속도로 바닥에 그림자 길이 그어지고, 지나간 자리마다
  // 보라 잔상 기둥(몸 높이의 짙은 세로 빛 + 가는 심)이 네 번 남았다 사라진다(순간이동처럼 끊긴 잔상). 잔상 사이엔 엇갈린 칼날 자국,
  // 출발점엔 작은 소멸 별빛, 끝에서 짙은 고리 + 가시 표식. 통과한 적마다의 X 자 베기는 skills.js 가 rogueXCut 으로 찍는다.
  shadow_dash(ctx) {
    const { impact, f, player, lite } = ctx; const SPEED = 28, LEN = 12;
    _a.copy(player.pos).setY(.08);
    impact.beam(_a, f, LEN, NIGHT, { speed: SPEED, tail: 7, width: .5 });
    impact.beam(_a, f, LEN, VIOLET, { speed: SPEED, tail: 4, width: .1 });
    impact._emit(IMPACT_KIND.star, player.pos.x, 1, player.pos.z, .9, MAGENTA, .08, { angle: .4, grow: .4 });
    const ang = cutAngle(impact, f);
    _d.set(0, 1, 0);
    for (let i = 1, n = lite ? 2 : 4; i <= n; i++) {
      const d = i * (LEN / (n + 1)), t = d / SPEED; _a.copy(player.pos).addScaledVector(f, d).setY(.05);
      impact.beam(_a, _d, 1.9, i % 2 ? DEEP : NIGHT, { width: .34, fade: .42 - i * .04, delay: t });
      impact.beam(_a, _d, 1.6, i % 2 ? MAGENTA : VIOLET, { width: .07, fade: .3, delay: t });
    }
    for (let i = 1, n = lite ? 3 : 6; i <= n; i++) {
      const d = i * (LEN / (n + 1)); _b.copy(player.pos).addScaledVector(f, d).setY(.9);
      impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 2.3, i % 2 ? VIOLET : MAGENTA, .34, { angle: ang + (i % 2 ? .9 : -.9), stretch: 1.1, grow: .9, delay: d / SPEED });
    }
    _b.copy(player.pos).addScaledVector(f, LEN * .95);
    impact._emit(IMPACT_KIND.ring, _b.x, .6, _b.z, 3, DEEP, .34, { grow: 1, delay: LEN / SPEED });
    impact.mark(_b, VIOLET, { radius: 1.8, life: .5, style: MARK_STYLE.thorn, delay: LEN / SPEED, angle: .4 });
  },
  // 독무 폭탄: 착탄 지점에 조준 원이 먼저 잡히고, 독 병이 포물선(skills.js 독 구슬과 같은 높이 1.5 + sin(kπ)×4, 0.5초)을 따라
  // 혜성처럼 날아간다(토막마다 굵은 머리 광선이 그 토막을 지나는 시간에 정확히 통과 + 옅은 궤적). 착탄 순간 병 파편이 튀고,
  // 바닥 독 웅덩이 경계를 적 바깥까지 두 겹(짙은 보라 5.8m, 독 초록 4.4m)으로 1.5초 남기며 테 위에서 독 기둥·거품이 솟는다.
  // 가운데 흰 면적은 쓰지 않는다(레시피 noBurst, skills.js 착탄 원화 축소).
  poison_bomb(ctx) {
    const { impact, at, player, lite } = ctx; const LAND = .5, ARC = 4;
    impact.mark(at, MAGENTA, { radius: 2.8, life: LAND + .15, style: MARK_STYLE.reticle });
    for (let i = 0, n = lite ? 3 : 6; i < n; i++) {
      const k0 = i / n, k1 = (i + 1) / n;
      _a.set(player.pos.x + (at.x - player.pos.x) * k0, 1.5 + Math.sin(k0 * Math.PI) * ARC, player.pos.z + (at.z - player.pos.z) * k0);
      _b.set(player.pos.x + (at.x - player.pos.x) * k1, 1.5 + Math.sin(k1 * Math.PI) * ARC, player.pos.z + (at.z - player.pos.z) * k1);
      _d.copy(_b).sub(_a); const len = _d.length();
      impact.beam(_a, _d, len, i % 2 ? POISON : MAGENTA, { speed: len / (LAND / n), tail: .9, width: .24, delay: k0 * LAND });
      if (!lite) impact.beam(_a, _d, len, DEEP, { width: .06, fade: .45, delay: k1 * LAND });
    }
    impact.mark(at, DEEP, { radius: 5.8, life: 1.5, style: MARK_STYLE.thorn, delay: LAND, angle: .9 });
    impact.mark(at, POISON, { radius: 4.4, life: 1.5, style: MARK_STYLE.thorn, delay: LAND, angle: .3 });
    impact._emit(IMPACT_KIND.ring, at.x, .5, at.z, 2.4, DEEP, .38, { grow: 1, delay: LAND });
    impact._emit(IMPACT_KIND.star, at.x, .6, at.z, 1, POISON, .08, { angle: .3, grow: .5, delay: LAND });
    // 병 파편: 착탄점에서 방사형으로 튀고 떨어지는 유리 조각(자홍·독 초록).
    for (let i = 0, n = lite ? 3 : 6; i < n; i++) {
      const a = (i / n) * 6.2831853 + .5;
      impact._emit(IMPACT_KIND.shard, at.x, .7, at.z, .22, i % 2 ? MAGENTA : POISON, .45,
        { vx: Math.cos(a) * 9, vy: 4, vz: Math.sin(a) * 9, angle: a, stretch: 1.6, grow: .8, gravity: 14, delay: LAND });
    }
    _d.set(0, 1, 0);
    for (let i = 0, n = lite ? 4 : 8; i < n; i++) {
      const a = (i / n) * 6.2831853 + .4, r = 3.6 + (i % 2) * 1.6;
      _a.set(at.x + Math.cos(a) * r, .1, at.z + Math.sin(a) * r);
      impact.beam(_a, _d, 2.6 + (i % 3) * .6, i % 2 ? MAGENTA : POISON, { speed: 5, tail: 1.8, width: .3, delay: LAND + (i % 4) * .14 });
    }
    for (let i = 0, n = lite ? 4 : 10; i < n; i++) {
      const a = i * 2.4, r = 1.2 + (i % 3) * 1.5;
      impact._emit(IMPACT_KIND.streak, at.x + Math.cos(a) * r, .3, at.z + Math.sin(a) * r, .34, i % 3 ? POISON : MAGENTA, .9,
        { vx: Math.cos(a) * .6, vy: 2.4 + (i % 4) * .6, vz: Math.sin(a) * .6, stretch: .5, grow: 1, gravity: -1, delay: LAND + (i % 4) * .15 });
    }
  },
  // 환영 난무: 앞 1.8m 대상 자리를 단검 궤적이 실제 베기 박자(0.115초 × 10타)로 빙글빙글 돈다 — 매 박자 둘레 다른 각도에서
  // 접선 방향 단검 광선(위아래로 기울어 공처럼 감싸는 궤적) + 같은 자리 칼날 자국. 바닥엔 앞 부채꼴 + 대상 둘레 가시 원.
  // 10타(1.035초) 마무리에 큰 X 자 + 짙은 고리 + 사방으로 튀는 칼날 파편.
  flurry(ctx) {
    // 서명은 시전 시각(dur 1.4 × castAt .2 = .28초)에 불리고 베기 틱은 시전 시작부터 돈다 → 박자를 LAG 만큼 당긴다(이미 지난 박자는 생략).
    const { impact, f, player, lite } = ctx; const BEAT = .115, HITS = 10, LAG = .28, FIN = (HITS - 1) * BEAT - LAG, ang = cutAngle(impact, f);
    impact.mark(player.pos, DEEP, { radius: 3.6, life: 1.2, style: MARK_STYLE.fan, angle: yawOf(f) });
    const cx = player.pos.x + f.x * 1.8, cz = player.pos.z + f.z * 1.8;
    _b.set(cx, 0, cz); impact.mark(_b, NIGHT, { radius: 2.2, life: 1.2, style: MARK_STYLE.thorn, angle: .5 });
    for (let i = 0, step = lite ? 2 : 1; i < HITS; i += step) {
      const a = i * 2.1 + .3, y = .5 + (i % 3) * .45, R = 1.7, t = i * BEAT - LAG;
      if (t < 0) continue;
      _a.set(cx + Math.cos(a) * R, y, cz + Math.sin(a) * R);
      _d.set(-Math.sin(a), i % 2 ? .35 : -.35, Math.cos(a));
      impact.beam(_a, _d, 3.2, i % 2 ? MAGENTA : VIOLET, { speed: 30, tail: 1.4, width: .17, delay: t });
      _b.copy(_a).addScaledVector(_d, .9);
      impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 2.2, i % 2 ? VIOLET : MAGENTA, .2, { angle: cutAngle(impact, _d), stretch: 1.15, grow: .9, delay: t + .05 });
    }
    _b.set(cx, 1, cz);
    for (const s of [-1, 1]) impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 3.4, s > 0 ? MAGENTA : VIOLET, .3, { angle: ang + s * .8, stretch: 1.25, grow: .9, delay: FIN + (s > 0 ? .035 : 0) });
    impact._emit(IMPACT_KIND.ring, _b.x, _b.y, _b.z, 3.4, DEEP, .32, { grow: 1, delay: FIN });
    impact._emit(IMPACT_KIND.star, _b.x, _b.y, _b.z, 1.3, MAGENTA, .08, { angle: .785, grow: .5, delay: FIN });
    for (let i = 0, n = lite ? 3 : 6; i < n; i++) {
      const a = (i / n) * 6.2831853 + .2;
      impact._emit(IMPACT_KIND.shard, _b.x, _b.y, _b.z, .2, i % 2 ? MAGENTA : VIOLET, .36,
        { vx: Math.cos(a) * 11, vy: 2, vz: Math.sin(a) * 11, angle: a, stretch: 1.8, grow: .8, gravity: 10, delay: FIN });
    }
  },
  // 천 개의 칼날(궁극기) 3박자: ① 예비(PRELUDES: 가시 원 + 솟는 칼날 + 안으로 빨려드는 선, skills.js 가 가장자리를 짙은 보라로 물들임)
  // ② 여덟 박자(0.15초) 동안 사방에서 그어지는 칼날 선 — 박자마다 하늘에서 꽂히는 칼날 1 + 둘레(반경 7.5m)를 가로지르는 현(弦) 칼날 3,
  //    모두 판정 순간(.15×n + .13초)에 끝에 닿는다 ③ 마무리(1.18초) 전장을 가로지르는 십자 일섬 두 줄 + 큰 X 자 + 짙은 고리.
  thousand(ctx) {
    const { impact, player, lite } = ctx; const rng = impact.rng, R = 7, SKY = 72, CHORD = 120, RIM = 7.5;
    impact.mark(player.pos, VIOLET, { radius: 8, life: 1.5, style: MARK_STYLE.thorn, angle: .2 });
    impact.mark(player.pos, MAGENTA, { radius: 5, life: 1.2, style: MARK_STYLE.thorn, angle: 1.1, delay: .3 });
    const px = player.pos.x, pz = player.pos.z;
    for (let w = 0; w < 8; w++) {
      const hitT = w * .15 + .13;
      if (!lite || w % 2 === 0) {
        const a = rng.next() * 6.2831853, r = 1.8 + rng.next() * (R - 1.8);
        _b.set(px + Math.cos(a) * r, .05, pz + Math.sin(a) * r);
        _a.set(_b.x - 1.2, 8, _b.z - .8); _d.copy(_b).sub(_a); const len = _d.length();
        impact.beam(_a, _d, len, w % 2 ? VIOLET : MAGENTA, { speed: SKY, tail: 3.5, width: .13, delay: Math.max(0, hitT - len / SKY) });
        impact._emit(IMPACT_KIND.cut, _b.x, .5, _b.z, 1.6, w % 2 ? DEEP : VIOLET, .3, { angle: a, stretch: 1, grow: .9, delay: hitT });
      }
      for (let j = 0, m = lite ? 1 : 3; j < m; j++) {
        const a = rng.next() * 6.2831853, b = a + 3.1415927 + (rng.next() - .5) * 1.6, y = .6 + ((w + j) % 3) * .35;
        _a.set(px + Math.cos(a) * RIM, y, pz + Math.sin(a) * RIM);
        _d.set(px + Math.cos(b) * RIM - _a.x, (j % 2 ? .4 : -.2), pz + Math.sin(b) * RIM - _a.z); const len = _d.length();
        impact.beam(_a, _d, len, j === 0 ? MAGENTA : j === 1 ? VIOLET : DEEP, { speed: CHORD, tail: 4, width: .08, delay: hitT - len / CHORD });
      }
    }
    // ③ 십자 일섬: 7박째 판정(1.18초)에 끝에 닿는 두 줄(14m) + 1.2초 큰 X 자·고리·조준 원.
    const FIN = 7 * .15 + .13;
    for (const s of [-1, 1]) {
      const c = Math.cos(.785 * s), sn = Math.sin(.785 * s);
      _a.set(px - c * 7, .9, pz - sn * 7); _d.set(c * 14, 0, sn * 14);
      impact.beam(_a, _d, 14, s > 0 ? MAGENTA : VIOLET, { speed: CHORD, tail: 6, width: .2, delay: FIN - 14 / CHORD });
      impact._emit(IMPACT_KIND.cut, px, 1.1, pz, 5, s > 0 ? MAGENTA : VIOLET, .34, { angle: s * .8, stretch: 1.5, grow: .9, delay: 1.2 + (s > 0 ? .04 : 0) });
    }
    impact.mark(player.pos, MAGENTA, { radius: 7, life: .5, style: MARK_STYLE.reticle, delay: 1.2 });
    impact._emit(IMPACT_KIND.ring, px, .8, pz, 3.2, DEEP, .45, { grow: 1, delay: 1.2 });
  },
  // 그림자 표식: 표시 범위(13m)를 두른 표식 원 + 둘레 여섯 점에 표식 가시가 차례로 돋고 분신의 X 자국이 그어진다.
  // 모인 표식이 터지는 순간(표식 6개 기준 .18+6×.09+.43초) 가운데 짙은 고리.
  shadow_mark(ctx) {
    const { impact, f, player, lite } = ctx; const ang = cutAngle(impact, f), HUB = .18 + 6 * .09 + .43;
    impact.mark(player.pos, DEEP, { radius: 5.6, life: 1.2, style: MARK_STYLE.reticle, angle: .4 });
    for (let i = 0, n = lite ? 3 : 6; i < n; i++) {
      const a = yawOf(f) + (i - (n - 1) / 2) * .55, r = 3.2 + (i % 2) * 1.3, t = .18 + i * .09;
      _b.set(player.pos.x + Math.cos(a) * r, 0, player.pos.z + Math.sin(a) * r);
      impact.mark(_b, VIOLET, { radius: 1.1, life: 1, style: MARK_STYLE.reticle, angle: i * .7 });
      // 표식 기둥: 표식이 찍힌 자리에서 짙은 보라 빛줄기가 솟는다(어디가 표식인지 한눈에).
      if (!lite) { _a.set(_b.x, .1, _b.z); _d.set(0, 1, 0); impact.beam(_a, _d, 2.4, i % 2 ? DEEP : VIOLET, { speed: 14, width: .13, fade: .6 }); }
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
      impact._emit(IMPACT_KIND.cut, _b.x, _b.y, _b.z, 2.3, w === 1 ? MAGENTA : DEEP, .26, { angle: cutAngle(impact, _d), stretch: 1.1, grow: .9, delay: w * .1 });
    }
    // 행렬 궤도: 둘레를 도는 바닥 호 12토막이 세 박자에 나눠 켜진다(돌아가는 칼날 행진).
    for (let j = 0, m = lite ? 6 : 12; j < m; j++) {
      const a = (j / m) * 6.2831853;
      _b.set(at.x + Math.cos(a) * (R - .4), .08, at.z + Math.sin(a) * (R - .4)); _d.set(-Math.sin(a), 0, Math.cos(a));
      impact.beam(_b, _d, 6.2831853 * (R - .4) / m * .85, j % 2 ? NIGHT : DEEP, { width: .26, fade: .45, delay: (j % 3) * .1 });
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

/**
 * 궁극기 예비 표식(시전 연출 중 바로 보인다). skill-signatures.js 의 SKILL_PRELUDES 가 합친다.
 * @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>}
 */
/** 그림자 질주가 통과한 적 몸에 찍는 X 자 베기(skills.js 질주 판정에서 호출, 인스턴스 층 2칸·난수 없음). */
export function rogueXCut(impact, pos, dir) {
  if (!impact || !pos || !dir) return;
  const ang = cutAngle(impact, dir);
  impact._emit(IMPACT_KIND.cut, pos.x, 1.1, pos.z, 2.6, MAGENTA, .26, { angle: ang + .8, stretch: 1.2, grow: .9 });
  impact._emit(IMPACT_KIND.cut, pos.x, 1.1, pos.z, 2.6, VIOLET, .26, { angle: ang - .8, stretch: 1.2, grow: .9, delay: .05 });
}

export const PRELUDES = {
  // 천 개의 칼날: 둘레 가시 대원이 깔리고, 여덟 자루 칼날 빛이 땅에서 하늘로 솟아오르며 바깥에서 짙은 선이 발밑으로 빨려든다.
  thousand(ctx) {
    const { impact, player, lite } = ctx;
    impact.mark(player.pos, DEEP, { radius: 6.5, life: 1.3, style: MARK_STYLE.thorn, angle: .6 });
    for (let i = 0, n = lite ? 4 : 8; i < n; i++) {
      const a = (i / n) * 6.2831853 + .3, r = 3.2 + (i % 2) * 1.6;
      _a.set(player.pos.x + Math.cos(a) * r, .1, player.pos.z + Math.sin(a) * r); _d.set(0, 1, 0);
      impact.beam(_a, _d, 5, i % 2 ? MAGENTA : VIOLET, { speed: 16, tail: 2.5, width: .14, delay: i * .07 });
      // 빨려드는 선: 바깥(9m)에서 발밑으로 모여드는 짙은 칼날 선(곧 사방에서 그어질 칼날의 예고).
      _a.set(player.pos.x + Math.cos(a + .4) * 9, .3, player.pos.z + Math.sin(a + .4) * 9);
      _d.set(player.pos.x - _a.x, 0, player.pos.z - _a.z);
      impact.beam(_a, _d, 8, i % 2 ? DEEP : NIGHT, { speed: 14, tail: 3, width: .09, delay: .2 + i * .06 });
    }
  },
};
