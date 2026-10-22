import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE } from './impact-vfx.js';

/**
 * knight 스킬 '모양 언어' 서명(h1b). skill-signatures.js 가 합친다. 규칙은 그 파일 머리 주석과 같다:
 * 인스턴스 임팩트 층(드로우콜 1)만 쓰고, 판정 시각은 delay 칸으로 맞추며, 프레임당 할당·Math.random 을 쓰지 않는다.
 * 검성 색 언어: 진한 금(GOLD)·주황 금(AMBER) 실루엣 + 아주 얇은 밝은 금(HOT) 심. 크림·흰 덩어리 대신 선·고리·표식으로 읽힌다.
 * 일섬=긴 수평 빛 칼날 / 강타=방패 충격 고리+지면 균열 / 심판=(skills.js 의 하늘 광선) 시전자 나침 / 용살검=거대 수직 참격+전방 부채 균열 /
 * 결박=사슬 가시 고리 / 성역=돔 경계 문양 / 태양파쇄=전진하는 태양 원반 / 신벌=하늘 낙하 성광 기둥.
 * @type {Record<string, (ctx: import('./skill-signatures.js').SigCtx) => void>}
 */
export const SIGNATURES = {};

export const KNIGHT_SIG_COLOR = Object.freeze({ gold: 0xffb21e, amber: 0xff8a10, hot: 0xffd86a });
const GOLD = KNIGHT_SIG_COLOR.gold, AMBER = KNIGHT_SIG_COLOR.amber, HOT = KNIGHT_SIG_COLOR.hot;
/** 판정 시각(skills.js game.after 지연)과 맞춘 서명 박자. 테스트가 이 값으로 delay 칸을 검사한다. */
export const KNIGHT_SIG_TIMING = Object.freeze({ sunbreakerSecond: .18, heavenfallHit: .28, chainBurst: 1.75 });
/** 서명 한 번이 쓰는 칸 상한(IMPACT_FRAME_BUDGET 72 안에서 레시피 몫을 남긴다). */
export const KNIGHT_SIG_MAX_SLOTS = 44;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
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

Object.assign(SIGNATURES, {
  // 성검 일섬: 가슴 높이로 길게 그어지는 수평 빛 칼날 두 줄(위·아래 결) + 칼끝 별빛.
  holy_slash(ctx) {
    const { impact, f, player, lite } = ctx;
    _a.copy(player.pos).addScaledVector(f, .6).setY(1.15);
    impact.beam(_a, f, 13, GOLD, { speed: 60, tail: 9, width: .2 });
    _b.copy(_a).setY(1.4); impact.beam(_b, f, 11, HOT, { speed: 64, tail: 6, width: .06, delay: .02 });
    if (!lite) { _b.setY(.9); impact.beam(_b, f, 10, AMBER, { speed: 56, tail: 5, width: .07, delay: .03 }); }
    impact._emit(IMPACT_KIND.star, _a.x, _a.y, _a.z, 1.1, HOT, .12, { angle: yawOf(f) * .2, grow: .5 });
  },
  // 철벽 강타: 방패 충격 고리 두 겹(접촉·여진) + 사방 지면 균열 + 발밑 가시 고리(금속 테).
  shield_bash(ctx) {
    const { impact, at, f, lite } = ctx;
    impact._emit(IMPACT_KIND.ring, at.x, .35, at.z, 4.6, GOLD, .26, { grow: 1 });
    impact._emit(IMPACT_KIND.ring, at.x, .3, at.z, 3.2, AMBER, .24, { grow: 1, delay: .08 });
    impact.mark(at, GOLD, { radius: 2.2, life: .5, style: MARK_STYLE.thorn, angle: yawOf(f) });
    _a.copy(at);
    cracks(impact, _a, f, lite ? 5 : 8, Math.PI * 2 * (7 / 8), 4.2, AMBER, { width: .055, speed: 34, phase: .4 });
  },
  // 심판: 하늘 광선과 기둥은 skills.js 가 표적마다 낸다. 여기서는 시전자 발밑 나침(심판의 눈) + 짧은 상승 광선.
  judgment(ctx) {
    const { impact, player, f } = ctx;
    impact.mark(player.pos, GOLD, { radius: 2.6, life: .9, style: MARK_STYLE.compass, angle: yawOf(f) });
    _a.copy(player.pos).setY(.2);
    impact.beam(_a, UP, 6, HOT, { speed: 40, tail: 4, width: .07 });
  },
  // 용살검(궁극기): 전방 하늘에서 바닥까지 내리긋는 거대 수직 참격 + 전방 130° 부채 균열 + 넓은 충격 고리.
  dragon_slash(ctx) {
    const { impact, player, f, lite, scale } = ctx;
    const hit = _a.copy(player.pos).addScaledVector(f, 3.5);
    // 수직 참격: 굵은 진한 금 광선 + 얇은 뜨거운 심 + 좌우 잔결. 위에서 아래로 그어진다(판정 순간 바닥 도달).
    _b.set(hit.x, 10 * scale, hit.z); _d.set(0, -1, 0);
    impact.beam(_b, _d, 10 * scale, AMBER, { speed: 140, width: .42, fade: .32 });
    impact.beam(_b, _d, 10 * scale, HOT, { speed: 150, width: .1, fade: .26 });
    for (const s of [-1, 1]) {
      _b.set(hit.x + f.z * s * .9, 8 * scale, hit.z - f.x * s * .9);
      impact.beam(_b, _d, 8 * scale, GOLD, { speed: 120, width: .12, fade: .26, delay: .03 });
    }
    // 착지 별빛·고리(진한 금, 흰 코어 대신)
    impact._emit(IMPACT_KIND.star, hit.x, .6, hit.z, 3.2 * scale, GOLD, .16, { angle: .3, grow: .4, delay: .06 });
    impact._emit(IMPACT_KIND.ring, hit.x, .4, hit.z, 7 * scale, AMBER, .34, { grow: 1, delay: .06 });
    impact._emit(IMPACT_KIND.ring, hit.x, .3, hit.z, 10 * scale, GOLD, .42, { grow: 1, delay: .14 });
    // 전방 부채 균열: 시전자 앞에서 130° 로 갈라져 나가는 갈래 + 부채꼴 표식.
    _b.copy(player.pos).addScaledVector(f, 1.2);
    cracks(impact, _b, f, lite ? 7 : 13, 2.27, 8.5 * scale, AMBER, { delay: .05, width: .075, speed: 46 });
    impact.mark(player.pos, GOLD, { radius: 8 * scale, life: .7, style: MARK_STYLE.fan, angle: yawOf(f), delay: .04 });
    if (!lite) impact._streaks(hit.setY(.8), f, 10, 15, .32, HOT, { up: 2, spread: 1.1, size: .26 });
  },
  // 결박: 시전자 둘레 사슬 가시 고리(묶는 경계) + 사슬 파열 순간(1.75초) 바깥으로 퍼지는 고리.
  chain_bind(ctx) {
    const { impact, player, f } = ctx; const T = KNIGHT_SIG_TIMING.chainBurst;
    impact.mark(player.pos, GOLD, { radius: 7.5, life: T, style: MARK_STYLE.thorn, angle: yawOf(f) });
    impact.mark(player.pos, AMBER, { radius: 3.4, life: .8, style: MARK_STYLE.thorn, angle: yawOf(f) + .3 });
    impact._emit(IMPACT_KIND.ring, player.pos.x, .4, player.pos.z, 9.5, GOLD, .4, { grow: 1, delay: T });
    impact._emit(IMPACT_KIND.star, player.pos.x, 1.2, player.pos.z, 2.4, HOT, .14, { angle: .3, grow: .4, delay: T });
  },
  // 성역: 돔 경계 문양(가시 고리 = 벽, 나침 = 안쪽 문양) + 네 방위에서 솟는 가는 빛 광선. 경계·기둥 본체는 sanctum-vfx.
  sanctuary(ctx) {
    const { impact, player, f, lite } = ctx; const R = 8;
    impact.mark(player.pos, GOLD, { radius: R * .62, life: 1.4, style: MARK_STYLE.compass, angle: yawOf(f) });
    impact.mark(player.pos, AMBER, { radius: R * 1.02, life: 1.1, style: MARK_STYLE.thorn, angle: yawOf(f) + .2, delay: .08 });
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
      impact._emit(IMPACT_KIND.ring, _a.x, _a.y, _a.z, 2.4 + i * .3, AMBER, .2, { grow: .7, delay: dl });
      impact._emit(IMPACT_KIND.star, _a.x, _a.y, _a.z, 1.4 + i * .15, GOLD, .12, { angle: .4 + i * .3, grow: .5, delay: dl });
    }
    const at = _b.copy(player.pos).addScaledVector(f, 4);
    impact._emit(IMPACT_KIND.ring, at.x, 1.2, at.z, 7.5 * scale, GOLD, .36, { grow: 1, delay: T2 });
    impact._emit(IMPACT_KIND.star, at.x, 1.3, at.z, 3 * scale, HOT, .14, { angle: .2, grow: .4, delay: T2 });
    impact.mark(at, AMBER, { radius: 6.5 * scale, life: .55, style: MARK_STYLE.compass, angle: yawOf(f), delay: T2 });
    if (!lite) impact._streaks(at.setY(1), f, 8, 13, .3, HOT, { up: 1.6, spread: 2.4, size: .24 });
  },
  // 신벌: 조준 원(예고) → 하늘에서 성광 기둥 일곱 줄이 판정 순간(.28초)에 정확히 꽂힌다 + 큰 충격 고리.
  heavenfall(ctx) {
    const { impact, at, lite, scale } = ctx; const T = KNIGHT_SIG_TIMING.heavenfallHit;
    const SPEED = 110, H = 14;
    impact.mark(at, GOLD, { radius: 8 * scale, life: T + .35, style: MARK_STYLE.reticle });
    const n = lite ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const r = i === 0 ? 0 : 4.2, ang = i * (Math.PI * 2 / (n - 1));
      _b.set(at.x + Math.cos(ang) * r, 0, at.z + Math.sin(ang) * r);
      _a.set(_b.x, H, _b.z); _d.set(0, -1, 0);
      const travel = H / SPEED;
      impact.beam(_a, _d, H, i === 0 ? AMBER : GOLD, { speed: SPEED, width: i === 0 ? .36 : .14, fade: .3, delay: Math.max(0, T - travel) });
    }
    impact._emit(IMPACT_KIND.ring, at.x, .4, at.z, 9 * scale, GOLD, .4, { grow: 1, delay: T });
    impact._emit(IMPACT_KIND.ring, at.x, .3, at.z, 5 * scale, AMBER, .3, { grow: 1, delay: T + .06 });
    impact._emit(IMPACT_KIND.star, at.x, .8, at.z, 3.4 * scale, GOLD, .16, { angle: .3, grow: .4, delay: T });
    if (!lite) impact.mark(at, AMBER, { radius: 5 * scale, life: .6, style: MARK_STYLE.thorn, delay: T });
  },
});
