import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE } from './impact-vfx.js';

/**
 * knight 스킬 '모양 언어' 서명(h1b). skill-signatures.js 가 합친다. 규칙은 그 파일 머리 주석과 같다:
 * 인스턴스 임팩트 층(드로우콜 1)만 쓰고, 판정 시각은 delay 칸으로 맞추며, 프레임당 할당·Math.random 을 쓰지 않는다.
 * 검성 색 언어: 진한 금(GOLD)·주황 금(AMBER) 실루엣 + 아주 얇은 밝은 금(HOT) 심. 크림·흰 덩어리 대신 선·고리·표식으로 읽힌다.
 * 큰 화면 고리(IMPACT_KIND.ring, 카메라를 보는 빌보드)는 지름 3m 이하로만 쓴다: 7~10m 고리는 화면을 가로지르는 뿌연 크림 띠가 됐다.
 * 넓은 범위는 바닥에 눕는 얇은 선 표식(mark)으로 그린다.
 * 일섬=쓸고 가는 칼 궤적+날아가는 두 겹 초승달+잔광 파편 / 강타=전방 부채 충격 파동+균열 / 심판=하늘로 오르는 광선+표적 박자(knightJudgmentStrike) /
 * 용살검=예비(검에 모이는 빛)→거대 수직 참격→달려 나가는 균열 / 예비 표식은 PRELUDES /
 * 결박=사슬 가시 고리 / 성역=돔 경계 문양 / 태양파쇄=전진하는 태양 원반 / 신벌=하늘 낙하 성광 기둥.
 * @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>}
 */
export const SIGNATURES = {};

// wide = 반경 4m 넘는 바닥 표식 전용 어두운 금. 가산 혼합이라 색 밝기가 곧 세기다: 넓은 선을 밝은 금으로 그으면 블룸과 겹쳐 복숭아빛 띠가 됐다.
export const KNIGHT_SIG_COLOR = Object.freeze({ gold: 0xffb21e, amber: 0xff8a10, hot: 0xffd86a, wide: 0xb86a06, wideGold: 0xa87a12 });
const GOLD = KNIGHT_SIG_COLOR.gold, AMBER = KNIGHT_SIG_COLOR.amber, HOT = KNIGHT_SIG_COLOR.hot, WIDE_GOLD = KNIGHT_SIG_COLOR.wideGold;
/** 판정 시각(skills.js game.after 지연)과 맞춘 서명 박자. 테스트가 이 값으로 delay 칸을 검사한다. */
export const KNIGHT_SIG_TIMING = Object.freeze({ sunbreakerSecond: .18, heavenfallHit: .28, chainBurst: 1.75 });
/** 서명 한 번이 쓰는 칸 상한(IMPACT_FRAME_BUDGET 72 안에서 레시피 몫을 남긴다). */
export const KNIGHT_SIG_MAX_SLOTS = 60;
/** 지면 표식(mark) 반경 상한. 표식 선 굵기는 반경에 비례해, 2m 를 넘으면 굵은 복숭아빛 바퀴가 됐다. 더 넓은 경계는 groundPoly. */
export const KNIGHT_MARK_MAX_RADIUS = 2;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const yawOf = (f) => Math.atan2(f.z, f.x);
/** f 를 y 축으로 ang 만큼 돌린 수평 방향을 out 에 담는다. */
const turn = (f, ang, out) => out.copy(f).setY(0).normalize().applyAxisAngle(UP, ang);

/** 지면 균열: o 에서 바깥으로 n 갈래, 머리가 speed 로 뻗어 나가는 얇은 광선(바닥 높이). */
function cracks(impact, o, f, n, spread, len, color, { delay = 0, width = .06, speed = 38, phase = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - .5 : 0;
    // 길이를 갈래마다 조금씩 다르게(결정적) 해서 깨진 땅처럼 보이게 한다.
    const L = len * (.72 + .28 * Math.abs(Math.sin(i * 2.3 + phase)));
    turn(f, t * spread + Math.sin(i * 1.7 + phase) * .06, _d);
    _b.copy(o).setY(.07);
    impact.beam(_b, _d, L, color, { speed, width, delay: delay + i * .012, fade: .42 });
  }
}

/** 바닥에 눕는 얇은 다각형 선(정지 광선 n 개). 큰 반경도 선 굵기가 일정해, 반경에 비례해 굵어지는 표식(mark) 대신 넓은 경계에 쓴다.
 *  step = 꼭짓점 건너뛰기(1 = 원, 3 = 팔각 별). */
function groundPoly(impact, c, R, n, color, { life = .6, delay = 0, width = .05, step = 1, phase = 0, y = .07 } = {}) {
  for (let i = 0; i < n; i++) {
    const a0 = phase + (i / n) * Math.PI * 2, a1 = phase + ((i + step) / n) * Math.PI * 2;
    _p.set(c.x + Math.cos(a0) * R, y, c.z + Math.sin(a0) * R);
    _d.set(c.x + Math.cos(a1) * R - _p.x, 0, c.z + Math.sin(a1) * R - _p.z);
    impact.beam(_p, _d, _d.length(), color, { width, fade: life, delay });
  }
}

/** 화면에서 수평(f 에 수직)으로 누운 초승달 칼날. */
function bladeAngle(impact, f) { return impact._screenAngle(_d.set(-f.z, 0, f.x)); }

/** 칼 쥔 손(오른쪽 앞, 가슴 높이) 근사 위치. 실제 뼈대 대신 결정적 오프셋이라 서명·예비 표식이 같은 자리에 모인다. */
function swordHand(player, f, out, y = 1.25) { return out.set(player.pos.x + f.x * .45 - f.z * .45, y, player.pos.z + f.z * .45 + f.x * .45); }

/** 빛 모으기: 반경 r 둘레 n 점에서 c 로 빨려 드는 짧은 줄기(줄기는 감속하므로 속도 = 거리 × 6.5 면 거의 c 에 닿는다). */
function gather(impact, c, n, r, color, { delay = 0, life = .32, size = .22, spin = .35, phase = 0, y0 = .4 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, y = y0 + (i % 3) * .5;
    const dx = c.x - x, dy = c.y - y, dz = c.z - z;
    impact._emit(IMPACT_KIND.streak, x, y, z, size, color, life,
      { vx: (dx - dz * spin) * 6.5, vy: dy * 6.5, vz: (dz + dx * spin) * 6.5, stretch: 1, grow: 1, delay: delay + (i % 4) * .04 });
  }
}

/** 부채 파동 한 겹: 중심 c 에서 f 를 기준으로 ±half 라디안 호(반경 R)를 n 개의 짧은 바닥 선으로 긋는다. */
function arcFront(impact, c, f, R, half, n, color, { delay = 0, life = .26, width = .07 } = {}) {
  const base = yawOf(f);
  for (let i = 0; i < n; i++) {
    const a0 = base - half + (i / n) * half * 2, a1 = base - half + ((i + 1) / n) * half * 2;
    _p.set(c.x + Math.cos(a0) * R, .08, c.z + Math.sin(a0) * R);
    _d.set(c.x + Math.cos(a1) * R - _p.x, 0, c.z + Math.sin(a1) * R - _p.z);
    impact.beam(_p, _d, _d.length(), color, { width, fade: life, delay });
  }
}

/**
 * skills.js 에서 뺀 텍스처 연출(원형 룬·시전진·기둥·성광·충격 원화)이 쓰던 Math.random 횟수(재질·메시 UUID, 캐시 뒤 기준)를
 * 그대로 소비해 이후 전투·드랍 난수 진행을 바꾸지 않는다(fx.js contact 의 retiredRandomDraws 와 같은 방식).
 * 실제 FX(flipbook 보유)일 때만 소비한다: 모의 전투의 가짜 fx 에서는 원래도 난수를 쓰지 않았다.
 */
export const KNIGHT_RETIRED_DRAWS = Object.freeze({ rune: 8, castCircle: 8, firePillar: 12, holyBurst: 9, shockTex: 8 });
export function knightRetiredDraws(fx, n) {
  if (typeof fx?.flipbook !== 'function') return 0;
  for (let i = 0; i < n; i++) Math.random();
  return n;
}

/**
 * 심판 표적 한 점의 박자 장식(skills.js judgment 가 표적마다 부른다): 낙하 직전 하늘 높이의 금빛 별(어디서 떨어지나),
 * 판정 순간 바닥 균열 세 갈래. 판정 시각 delay 는 skills.js 가 넘긴다. 쓴 칸 수를 돌려준다.
 */
export function knightJudgmentStrike(impact, pt, delay, i, lite = false) {
  // 시각 장식이 판정 콜백을 끊지 않게: 모의 전투의 가짜 fx(인스턴스 층 없음)에서는 아무것도 하지 않는다.
  if (!pt || typeof impact?._emit !== 'function' || typeof impact.beam !== 'function') return 0;
  let n = 0;
  if (impact._emit(IMPACT_KIND.star, pt.x, 7.5, pt.z, 1.1, HOT, .14, { angle: .3 + i * .5, grow: .4, delay: Math.max(0, delay - .1) })) n++;
  if (impact._emit(IMPACT_KIND.star, pt.x, .5, pt.z, 1.5, GOLD, .16, { angle: .2 + i * .4, grow: .4, delay })) n++;
  if (lite) return n;
  for (let k = 0; k < 3; k++) {
    const a = i * 1.3 + k * 2.09; _d.set(Math.cos(a), 0, Math.sin(a));
    _b.set(pt.x, .07, pt.z);
    if (impact.beam(_b, _d, 1.8 + (k % 2) * .7, AMBER, { speed: 30, width: .1, fade: .36, delay })) n++;
  }
  return n;
}

/**
 * 시전 예비 표식(start 에서 바로, 판정 전). skill-signatures.js 의 SKILL_PRELUDES 가 합친다.
 * 원형 바닥 문양 대신 '빛이 검으로 모인다'·'어디로 벨지' 를 선·줄기로 먼저 보여 준다.
 * @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>}
 */
export const PRELUDES = {
  // 일섬 예비: 칼 쥔 손으로 금빛 줄기가 빨려 들고 칼끝 별빛이 켜진다(.24초 뒤 판정).
  holy_slash(ctx) {
    const { impact, player, f, lite } = ctx; const h = swordHand(player, f, _a);
    gather(impact, h, lite ? 5 : 12, 2.4, GOLD, { life: .26, size: .3 });
    impact._emit(IMPACT_KIND.star, h.x, h.y, h.z, .9, HOT, .2, { angle: .2, grow: .3, delay: .1 });
  },
  // 강타 예비: 바깥에서 방패 앞으로 끌려 오는 줄기(몰이) + 방패 별빛. 원형 시전진(5m) 대신.
  shield_bash(ctx) {
    const { impact, player, f, lite } = ctx;
    _a.copy(player.pos).addScaledVector(f, 1.2).setY(.6);
    gather(impact, _a, lite ? 5 : 10, 4.5, AMBER, { life: .26, size: .26, spin: .15, y0: .3 });
    _b.copy(player.pos).addScaledVector(f, .7).setY(1);
    impact._emit(IMPACT_KIND.star, _b.x, _b.y, _b.z, 1, HOT, .16, { angle: .5, grow: .3, delay: .12 });
  },
  // 심판 예비: 검을 치켜들면 금빛 입자가 몸을 타고 하늘로 솟고, 판정 직전 하늘로 쏘아 올리는 신호 광선.
  judgment(ctx) {
    const { impact, player, f, lite } = ctx; const h = swordHand(player, f, _a, 1.9);
    for (let i = 0, n = lite ? 5 : 14; i < n; i++) {
      const a = yawOf(f) + i * 2.4, r = .8 + (i % 3) * .4;
      impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .3, player.pos.z + Math.sin(a) * r, .34, i % 2 ? GOLD : HOT, .55,
        { vx: -Math.cos(a) * 2, vy: 26, vz: -Math.sin(a) * 2, stretch: 1, grow: 1, delay: (i % 5) * .07 });
    }
    impact.beam(h, UP, 12, HOT, { speed: 60, tail: 5, width: .08, delay: .3 });
    impact._emit(IMPACT_KIND.star, h.x, h.y + .4, h.z, 1, GOLD, .2, { angle: .3, grow: .3, delay: .28 });
  },
  // 용살검 예비(시전 연출 내내): 사방의 빛이 검으로 두 물결 모이고, 검을 따라 가는 금빛 기둥이 서며, 벨 부채꼴(130°) 가장자리가 먼저 깔린다.
  dragon_slash(ctx) {
    const { impact, player, f, lite } = ctx; const h = swordHand(player, f, _a, 1.6);
    gather(impact, h, lite ? 4 : 9, 3.2, GOLD, { life: .36, size: .32 });
    gather(impact, h, lite ? 3 : 7, 2.6, AMBER, { life: .34, size: .3, delay: .22, phase: .4 });
    if (!lite) gather(impact, h, 6, 2, HOT, { life: .3, size: .26, delay: .44, phase: .8 });
    _b.copy(h).setY(.9);
    impact.beam(_b, UP, 5, AMBER, { speed: 9, width: .2, fade: .4 });
    impact.beam(_b, UP, 6, HOT, { speed: 12, width: .07, fade: .35, delay: .12 });
    for (const sgn of [-1, 1]) { turn(f, sgn * 1.13, _d); _b.copy(player.pos).setY(.07); impact.beam(_b, _d, 7.2, AMBER, { speed: 18, width: .07, fade: 1.1 }); }
    impact.mark(_b.copy(player.pos).addScaledVector(f, 1.6), GOLD, { radius: 1.6, life: 1.1, style: MARK_STYLE.fan, angle: yawOf(f) });
  },
};

Object.assign(SIGNATURES, {
  // 성검 일섬: ① 칼 궤적 — 오른쪽에서 왼쪽으로 가슴 높이를 실제로 쓸고 지나가는 부채 광선(.06초 동안 차례로 켜짐)
  // ② 두 겹 금빛 칼날 — 화면 가로로 누운 초승달 셋(진금 바깥 날·밝은 금 안쪽 날·주황 잔결)이 앞으로 날아가며 감속
  // ③ 칼끝 잔광 파편 — 투사체(22m/s)가 지나는 자리마다 금 파편이 튀어 떨어진다.
  holy_slash(ctx) {
    const { impact, f, player, lite } = ctx;
    const base = yawOf(f), n = lite ? 5 : 9;
    _a.copy(player.pos).setY(1.15);
    for (let i = 0; i < n; i++) {
      const a = base - 1.35 + (i / (n - 1)) * 2.7; _d.set(Math.cos(a), 0, Math.sin(a));
      _b.copy(_a).addScaledVector(_d, .5);
      impact.beam(_b, _d, 2.6, i % 2 ? HOT : GOLD, { speed: 70, width: i % 2 ? .06 : .12, fade: .14, delay: i * (.06 / n) });
    }
    const ang = bladeAngle(impact, f);
    const blades = [[3.8, GOLD, 0, 1.15], [3.0, HOT, .04, 1.3], [2.6, AMBER, .08, .95]];
    for (const [size, color, dl, y] of blades) {
      _b.copy(player.pos).addScaledVector(f, 1.3);
      impact._emit(IMPACT_KIND.cut, _b.x, y, _b.z, size, color, .34, { vx: f.x * 42, vz: f.z * 42, angle: ang, stretch: 1.7, grow: .85, delay: dl });
    }
    impact._emit(IMPACT_KIND.star, _a.x, _a.y, _a.z, 1.1, HOT, .12, { angle: yawOf(f) * .2, grow: .5 });
    _b.copy(_a).addScaledVector(f, .6); impact.beam(_b, f, 12, GOLD, { speed: 22, tail: 4, width: .09 });
    if (!lite) for (let i = 0; i < 6; i++) {
      const d = 1.6 + i * 1.5, s = i % 2 ? 1 : -1;
      _b.copy(player.pos).addScaledVector(f, d).setY(1.1);
      impact._emit(IMPACT_KIND.shard, _b.x - f.z * s * .8, _b.y, _b.z + f.x * s * .8, .18, i % 2 ? HOT : GOLD, .45,
        { vx: -f.z * s * 3, vy: 3, vz: f.x * s * 3, angle: i * .9, stretch: 1.8, grow: .8, gravity: 12, delay: d / 22 });
    }
  },
  // 철벽 강타: 방패 접점 가시 표식 → 전방 부채(±60°)로 밀려 나가는 충격 파동 네 겹(반경 1.4→5m, .045초 간격)
  // + 파동과 같이 낮게 밀려 가는 가로 충격 칼날 둘 + 전방 지면 균열. 영웅 둘레 큰 고리 대신 '앞으로 민다'.
  shield_bash(ctx) {
    const { impact, at, f, lite } = ctx;
    impact.mark(at, GOLD, { radius: 1.6, life: .45, style: MARK_STYLE.thorn, angle: yawOf(f) });
    impact._emit(IMPACT_KIND.star, at.x, .7, at.z, 1.3, HOT, .12, { angle: .4, grow: .4 });
    const waves = lite ? 3 : 4;
    for (let k = 0; k < waves; k++) arcFront(impact, at, f, 1.4 + k * 1.4, 1.05 - k * .08, lite ? 4 : 6, k % 2 ? GOLD : AMBER, { delay: k * .05, width: .17 - k * .025, life: .3 });
    const ang = bladeAngle(impact, f);
    for (let k = 0; k < 2; k++) impact._emit(IMPACT_KIND.cut, at.x, .45 + k * .25, at.z, 3 - k * .5, k ? GOLD : AMBER, .28, { vx: f.x * 30, vz: f.z * 30, angle: ang, stretch: 1.8, grow: .9, delay: k * .04 });
    cracks(impact, at, f, lite ? 4 : 7, 2.1, 4.6, AMBER, { width: .06, speed: 34, phase: .4 });
  },
  // 심판: 하늘 광선·빛기둥·표적 박자(knightJudgmentStrike)는 skills.js 가 표적마다 낸다. 여기서는 치켜든 검에서 하늘로 오르는 광선 두 줄과 칼끝 별빛.
  judgment(ctx) {
    const { impact, player, f } = ctx; const h = swordHand(player, f, _a, 1.9);
    impact.beam(h, UP, 9, HOT, { speed: 50, tail: 4, width: .07 });
    _b.copy(h).setY(.4); impact.beam(_b, UP, 7, GOLD, { speed: 36, tail: 3, width: .14, delay: .03 });
    impact._emit(IMPACT_KIND.star, h.x, h.y + .3, h.z, 1.3, GOLD, .16, { angle: .3, grow: .4 });
  },
  // 용살검(궁극기): 예비(PRELUDES: 검에 모이는 빛) → ① 하늘에서 바닥까지 내리긋는 거대 수직 참격 → ② 착탄에서 전방으로 달려 나가는
  // 지그재그 균열(30m/s, 파편이 차례로 튐) + 130° 부채 균열. 착탄 둘레 원·고리 대신 앞으로 뻗는 선이 '베어 낸 방향'을 남긴다.
  dragon_slash(ctx) {
    const { impact, player, f, lite, scale } = ctx;
    const hit = _a.copy(player.pos).addScaledVector(f, 3.5);
    _b.set(hit.x, 10 * scale, hit.z); _d.set(0, -1, 0);
    impact.beam(_b, _d, 10 * scale, AMBER, { speed: 140, width: .3, fade: .3 });
    impact.beam(_b, _d, 10 * scale, HOT, { speed: 150, width: .09, fade: .24 });
    for (const s of [-1, 1]) {
      _b.set(hit.x + f.z * s * .9, 8 * scale, hit.z - f.x * s * .9);
      impact.beam(_b, _d, 8 * scale, GOLD, { speed: 120, width: .12, fade: .26, delay: .03 });
    }
    impact._emit(IMPACT_KIND.cut, hit.x, 2.2, hit.z, 7 * scale, AMBER, .3, { angle: Math.PI / 2 + .18, stretch: 1.25, grow: .9 });
    impact._emit(IMPACT_KIND.cut, hit.x, 2.2, hit.z, 5.4 * scale, GOLD, .26, { angle: Math.PI / 2 - .12, stretch: 1.2, grow: .9, delay: .05 });
    impact._emit(IMPACT_KIND.star, hit.x, .6, hit.z, 1.8 * scale, AMBER, .14, { angle: .3, grow: .4, delay: .06 });
    // 달려 나가는 균열: 영웅 앞 1.8m 에서 7m 를 지그재그 마디로 18m/s 로 차례로 켜고(가로 화면 위 끝 안쪽), 짝수 마디마다 금 파편이 튄다.
    const SPEED = 18, segs = lite ? 5 : 12, L = 7 * scale / segs, sx = -f.z, sz = f.x;
    _p.copy(player.pos).addScaledVector(f, 1.8).setY(.07);
    for (let i = 0; i < segs; i++) {
      const jag = (i % 2 ? 1 : -1) * .3 * (1 - i / segs * .5);
      _e.set(f.x * L + sx * jag, 0, f.z * L + sz * jag);
      const dl = .04 + (i * L) / SPEED;
      impact.beam(_p, _e, _e.length(), i % 3 ? AMBER : HOT, { width: .24 - i * .01, fade: .6, delay: dl });
      if (!lite && i % 2 === 0) impact._emit(IMPACT_KIND.shard, _p.x, .3, _p.z, .26, i % 4 ? GOLD : HOT, .5,
        { vx: sx * (i % 4 ? 2 : -2), vy: 6, vz: sz * (i % 4 ? 2 : -2), angle: i, stretch: 1.8, grow: .8, gravity: 16, delay: dl });
      _p.add(_e);
    }
    _e.set(1, 0, 0);
    _b.copy(player.pos).addScaledVector(f, 1.2);
    cracks(impact, _b, f, lite ? 7 : 13, 2.27, 8.5 * scale, AMBER, { delay: .05, width: .075, speed: 46 });
    for (const sgn of [-1, 1]) { turn(f, sgn * 1.13, _d); _b.copy(player.pos).setY(.07); impact.beam(_b, _d, 8.5 * scale, GOLD, { speed: 60, width: .06, fade: .5, delay: .04 }); }
    if (!lite) impact._streaks(hit.setY(.8), f, 10, 15, .32, HOT, { up: 2, spread: 1.1, size: .26 });
  },
  // 결박: 시전자 둘레 사슬 가시 고리(묶는 경계) + 사슬 파열 순간(1.75초) 바깥으로 퍼지는 고리.
  chain_bind(ctx) {
    const { impact, player, f, lite } = ctx; const T = KNIGHT_SIG_TIMING.chainBurst;
    groundPoly(impact, player.pos, 7.5, lite ? 10 : 18, GOLD, { life: T, width: .045, phase: yawOf(f) });
    if (!lite) groundPoly(impact, player.pos, 5.2, 9, AMBER, { life: .45, delay: T, width: .06, step: 4 });
    impact._emit(IMPACT_KIND.ring, player.pos.x, .5, player.pos.z, 3, GOLD, .3, { grow: 1, delay: T });
    impact._emit(IMPACT_KIND.star, player.pos.x, 1.2, player.pos.z, 1.6, AMBER, .12, { angle: .3, grow: .4, delay: T });
  },
  // 성역: 돔 경계 문양(가시 고리 = 벽, 나침 = 안쪽 문양) + 네 방위에서 솟는 가는 빛 광선. 경계·기둥 본체는 sanctum-vfx.
  sanctuary(ctx) {
    const { impact, player, f, lite } = ctx; const R = 8;
    impact.mark(player.pos, AMBER, { radius: 1.8, life: 1.4, style: MARK_STYLE.compass, angle: yawOf(f) });
    // 성역 문양: 경계 안쪽 반경 4.4m 의 얇은 팔각 별(홀리웨이브 원화가 빠진 자리를 선 문양으로 채운다).
    groundPoly(impact, player.pos, 4.4, 8, WIDE_GOLD, { life: 1.6, width: .05, step: 3, phase: yawOf(f), delay: .05 });
    const n = lite ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const ang = yawOf(f) + (i / n) * Math.PI * 2;
      _a.set(player.pos.x + Math.cos(ang) * R, .1, player.pos.z + Math.sin(ang) * R);
      impact.beam(_a, UP, 7, HOT, { speed: 30, tail: 5, width: .06, delay: .1 + i * .07 });
    }
  },
  // 태양파쇄: 앞으로 굴러가는 태양 원반(고리 + 짧은 광채가 계단식으로 전진) → 0.18초 두 번째 판정에 큰 태양 고리와 햇살 나침.
  sunbreaker(ctx) {
    const { impact, player, f, lite, scale } = ctx; const T2 = KNIGHT_SIG_TIMING.sunbreakerSecond;
    const steps = lite ? 3 : 5;
    for (let i = 0; i < steps; i++) {
      const d = 1 + i * (3 / (steps - 1)), dl = i * (T2 / steps);
      _a.copy(player.pos).addScaledVector(f, d).setY(1.3);
      impact._emit(IMPACT_KIND.ring, _a.x, _a.y, _a.z, 1.5 + i * .2, AMBER, .18, { grow: .7, delay: dl });
      impact._emit(IMPACT_KIND.star, _a.x, _a.y, _a.z, 1.1 + i * .12, GOLD, .12, { angle: .4 + i * .3, grow: .5, delay: dl });
      // 원반이 지나간 바닥에 돌아가는 작은 태양 얼굴(나침 표식).
      _a.setY(0); impact.mark(_a, AMBER, { radius: 1 + i * .1, life: .3, style: MARK_STYLE.compass, angle: i * .7, delay: dl });
    }
    // 굴러간 자취: 바닥을 따라 앞으로 나아가는 넓은 주황 금 띠.
    _a.copy(player.pos).addScaledVector(f, .6).setY(.08);
    impact.beam(_a, f, 5, AMBER, { speed: 4 / T2, tail: 2.6, width: .3 });
    const at = _b.copy(player.pos).addScaledVector(f, 4);
    impact._emit(IMPACT_KIND.ring, at.x, 1.2, at.z, 3 * scale, AMBER, .3, { grow: 1, delay: T2 });
    impact._emit(IMPACT_KIND.star, at.x, 1.3, at.z, 2 * scale, GOLD, .14, { angle: .2, grow: .4, delay: T2 });
    // 2타 태양: 얇은 원 + 사방으로 뻗는 햇살 열 줄(바닥).
    groundPoly(impact, at, 5 * scale, lite ? 8 : 12, AMBER, { life: .45, delay: T2, width: .06 });
    cracks(impact, at, f, lite ? 6 : 10, Math.PI * 2 * .9, 3.2 * scale, GOLD, { delay: T2, width: .07, speed: 40, phase: 1.1 });
    if (!lite) impact._streaks(at.setY(1), f, 8, 13, .3, HOT, { up: 1.6, spread: 2.4, size: .24 });
  },
  // 신벌: 조준 원(예고) → 하늘에서 성광 기둥 일곱 줄이 판정 순간(.28초)에 정확히 꽂힌다 + 큰 충격 고리.
  heavenfall(ctx) {
    const { impact, at, lite, scale } = ctx; const T = KNIGHT_SIG_TIMING.heavenfallHit;
    const SPEED = 110, H = 14;
    groundPoly(impact, at, 5 * scale, lite ? 8 : 14, AMBER, { life: T + .35, width: .05 });
    impact.mark(at, GOLD, { radius: 1.6, life: T + .3, style: MARK_STYLE.reticle });
    const n = lite ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const r = i === 0 ? 0 : 4.2, ang = i * (Math.PI * 2 / (n - 1));
      _b.set(at.x + Math.cos(ang) * r, 0, at.z + Math.sin(ang) * r);
      _a.set(_b.x, H, _b.z); _d.set(0, -1, 0);
      const travel = H / SPEED;
      impact.beam(_a, _d, H, i === 0 ? AMBER : GOLD, { speed: SPEED, width: i === 0 ? .36 : .14, fade: .3, delay: Math.max(0, T - travel) });
    }
    impact._emit(IMPACT_KIND.ring, at.x, .4, at.z, 3 * scale, AMBER, .3, { grow: 1, delay: T });
    impact._emit(IMPACT_KIND.star, at.x, .8, at.z, 2 * scale, GOLD, .14, { angle: .3, grow: .4, delay: T });
    if (!lite) { _p.copy(at); cracks(impact, _p, _e, 8, Math.PI * 2 * (7 / 8), 4 * scale, AMBER, { delay: T, width: .06, speed: 36, phase: .7 }); }
  },
});
