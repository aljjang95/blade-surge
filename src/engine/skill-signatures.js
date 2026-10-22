import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE, BEAM_STYLE } from './impact-vfx.js';
import { SIGNATURES as KNIGHT } from './sig-knight.js';
import { SIGNATURES as MAGE } from './sig-mage.js';
import { SIGNATURES as ROGUE } from './sig-rogue.js';
import { SIGNATURES as BARBARIAN } from './sig-barbarian.js';

/**
 * 스킬별 '모양 언어' 서명. castSkillVfx 가 레시피(바닥 룬·텍스처) 뒤에 한 번 부른다.
 * 모두 인스턴스 임팩트 층(드로우콜 1, 이미 존재)의 광선·지면 표식·고리·별빛·불똥만 쓰므로 드로우콜이 늘지 않는다.
 * 타이밍은 skills.js 의 실제 판정 시각(game.after 지연)에 맞춘 지연 칸(delay)으로 미리 예약한다. 판정·난수와 무관하다.
 * 궁수: 관통 일직선 / 세 갈래 부채 / 회피 폭발 / 폭풍 나침 / 연사 조준 / 덩굴 부채 / 바람 소용돌이 / 하늘 화살비 표식.
 */
const JADE = 0x3fe0a0, JADE_HOT = 0x9fffd8, VINE = 0x63e08a;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const yawOf = (f) => Math.atan2(f.z, f.x);

/** @typedef {{ fx: any, impact: any, player: any, at: THREE.Vector3, f: THREE.Vector3, lite: boolean, scale: number }} SigCtx */

/** 활 끝(대략) 위치. 실제 화살 원점은 활 뼈대지만 서명 장식은 발사 높이·앞 0.9m 로 충분하다. */
function bow(ctx, out) { return out.copy(ctx.player.pos).addScaledVector(ctx.f, .9).setY(1.25); }

/** 수평 방향 f 를 y 축으로 a 라디안 돌린 단위 벡터(skills.js applyAxisAngle 과 같은 회전). */
function rotY(f, a, out) { const c = Math.cos(a), s = Math.sin(a); return out.set(f.x * c + f.z * s, 0, -f.x * s + f.z * c).normalize(); }
/** 바닥 번짐용 어두운 비취·이끼빛. 가산 혼합에서 흰 심이 땅색과 더해져 백화되지 않게 밝기를 낮춘 색이다. */
const DEEP = 0x1c9a6c, MOSS = 0x2fae5a;
const _e = new THREE.Vector3();

/** @type {Record<string, (ctx: SigCtx) => void>} */
const RANGER = {
  // 관통: 바닥에 굵은 '레일'(어두운 비취 번짐 + 양옆 두 가닥 + 가운데 심)이 화살보다 빠르게 깔리고,
  // 화살이 4·8·12m 를 지나는 순간 관통점마다 십자 별빛과 작은 고리가 꿰인다.
  ranger_pierce(ctx) {
    const { impact, f, player, lite } = ctx; const o = bow(ctx, _a), SPEED = 27, LEN = 20;
    _b.copy(player.pos).addScaledVector(f, .6).setY(.07);
    impact.beam(_b, f, LEN, DEEP, { speed: SPEED * 1.6, width: .5, fade: .75 });
    if (!lite) for (const side of [-1, 1]) {
      _e.set(-f.z, 0, f.x).multiplyScalar(side * .42).add(_b);
      impact.beam(_e, f, LEN, JADE, { speed: SPEED * 1.6, width: .05, fade: .7 });
    }
    impact.beam(_b, f, LEN, JADE, { speed: SPEED * 1.6, width: .13, fade: .6 });
    impact.beam(o, f, LEN, JADE, { speed: SPEED, tail: 9, width: .2 });
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 1.3, JADE_HOT, .1, { angle: yawOf(f) * .2, grow: .5 });
    for (const d of [4, 8, 12]) {
      _e.copy(o).addScaledVector(f, d); const t = d / SPEED;
      impact._emit(IMPACT_KIND.star, _e.x, _e.y, _e.z, 1.6, JADE, .3, { angle: .785, grow: .4, delay: t });
      impact._emit(IMPACT_KIND.ring, _e.x, _e.y, _e.z, 1.4, JADE, .32, { grow: 1, delay: t });
    }
  },
  // 일제 사격: 실제 세 발(±0.24rad)과 같은 방향으로 바닥에 세 갈래 궤적이 또렷이 뻗고(어두운 번짐 + 밝은 심),
  // 부채꼴 테가 감싸며, 7.5m 지점에서 갈래마다 화살촉 자국이 그어진다.
  ranger_volley(ctx) {
    const { impact, f, player, lite } = ctx; const SPEED = 23;
    impact.mark(player.pos, JADE, { radius: 7, life: .7, style: MARK_STYLE.fan, angle: yawOf(f) });
    _b.copy(player.pos).addScaledVector(f, .5).setY(.08);
    for (let i = -1; i <= 1; i++) {
      rotY(f, i * .24, _d);
      if (!lite) impact.beam(_b, _d, 17, DEEP, { speed: SPEED * 1.4, width: .34, fade: .6 });
      impact.beam(_b, _d, 17, JADE, { speed: SPEED * 1.4, width: .11, fade: .55 });
      _e.copy(_b).addScaledVector(_d, 7.5).setY(1);
      impact._emit(IMPACT_KIND.cut, _e.x, _e.y, _e.z, 1.3, JADE, .3, { angle: impact._screenAngle?.(_d) ?? 0, stretch: 1, grow: .9, delay: 7.5 / SPEED });
    }
  },
  // 후퇴 사격: 뒤로 미끄러지는 길(초속 8m)을 따라 바람 고리 넷이 차례로 터지고, 발밑엔 쌍나선 바람 길이 뒤로 감긴다.
  ranger_retreat(ctx) {
    const { impact, f, player, lite } = ctx; const o = _a.copy(player.pos).setY(.6);
    _d.set(-f.x, 0, -f.z);
    _b.copy(player.pos).setY(.08);
    impact.beam(_b, _d, 5.6, JADE, { speed: 9, tail: 3.5, width: .38, style: BEAM_STYLE.gale });
    for (let i = 0; i < 4; i++) {
      const t = i * .14; _e.copy(player.pos).addScaledVector(_d, 8 * t * .85);
      impact.mark(_e, i % 2 ? JADE_HOT : JADE, { radius: 1.1 + i * .25, life: .42, style: MARK_STYLE.compass, angle: i * .7, delay: t });
      impact._emit(IMPACT_KIND.ring, _e.x, .7, _e.z, 1.7 + i * .3, JADE, .3, { grow: 1, delay: t });
    }
    impact._streaks(o, _d, lite ? 3 : 7, 9, .34, JADE_HOT, { up: 1.6, spread: 1.4, size: .26 });
    impact._emit(IMPACT_KIND.star, o.x, 1.2, o.z, 1.2, JADE_HOT, .1, { angle: .3, grow: .5 });
  },
  // 폭풍의 일곱 화살(궁극기): 실제 일곱 발(±3×0.18rad) 방향으로 바닥에 거대한 일곱 갈래 부채가 펼쳐지고,
  // 영웅 둘레엔 두 겹 폭풍 소용돌이(접선 불똥)와 큰 나침 고리가 돈다. 활 끝 별빛은 100ms.
  ranger_tempest(ctx) {
    const { impact, f, player, lite } = ctx; const o = bow(ctx, _a);
    impact.mark(player.pos, JADE, { radius: 5.2, life: 1.1, style: MARK_STYLE.compass, angle: yawOf(f) });
    _b.copy(player.pos).addScaledVector(f, .6).setY(.08);
    for (let i = -3; i <= 3; i++) {
      rotY(f, i * .18, _d);
      impact.beam(_b, _d, 21, i % 2 ? JADE : DEEP, { speed: 40, width: i % 2 ? .22 : .4, style: i % 2 ? BEAM_STYLE.line : BEAM_STYLE.gale, fade: .85 });
      if (!lite) impact.beam(_b, _d, 21, JADE_HOT, { speed: 40, width: .045, fade: .7 });
    }
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 2.4, JADE_HOT, .1, { angle: .3, grow: .4 });
    impact._emit(IMPACT_KIND.ring, o.x, o.y, o.z, 3.6, JADE, .34, { grow: 1 });
    const n = lite ? 4 : 7;
    for (let w = 0; w < 2; w++) for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + w * .45, r = 1.6 + w * .9;
      impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .4 + w * .5, player.pos.z + Math.sin(a) * r, .3, w ? JADE : JADE_HOT, .55,
        { vx: -Math.sin(a) * 11, vy: 2.2, vz: Math.cos(a) * 11, stretch: 1, grow: 1, delay: w * .1 });
    }
  },
  // 연사: 9m 앞 과녁에 조준 원 두 겹이 조여들고, 세 박자(0, .12, .24초)마다 굵은 화살 줄과 활 끝 별빛·과녁 고리가 찍힌다.
  ranger_quickshot(ctx) {
    const { impact, f, player } = ctx; const SPEED = 28;
    _b.copy(player.pos).addScaledVector(f, 9);
    impact.mark(_b, JADE_HOT, { radius: 1.7, life: .75, style: MARK_STYLE.reticle });
    impact.mark(_b, JADE, { radius: 2.6, life: .6, style: MARK_STYLE.reticle, angle: .785, delay: .06 });
    const o = bow(ctx, _a);
    for (let i = 0; i < 3; i++) {
      const d = i * .12;
      impact.beam(o, f, 12, i === 2 ? JADE_HOT : JADE, { speed: SPEED, tail: 5, width: .16, delay: d });
      impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, .9 + i * .25, JADE_HOT, .09, { angle: .3, grow: .5, delay: d });
      impact._emit(IMPACT_KIND.ring, _b.x, .5, _b.z, 1.5 + i * .4, JADE, .26, { grow: 1, delay: d + 8 / SPEED });
    }
  },
  // 속박의 화살: 다섯 발 방향으로 바닥을 기는 덩굴 물결(이끼빛) + 부채 + 앞으로 차례로 돋는 가시 매듭.
  ranger_binding(ctx) {
    const { impact, f, player, lite } = ctx;
    impact.mark(player.pos, VINE, { radius: 8, life: .7, style: MARK_STYLE.fan, angle: yawOf(f) });
    _b.copy(player.pos).addScaledVector(f, .6).setY(.08);
    for (let i = -2; i <= 2; i++) {
      if (lite && i % 2) continue;
      rotY(f, i * .18, _d);
      impact.beam(_b, _d, 15, MOSS, { speed: 30, width: .3, style: BEAM_STYLE.vine, fade: .75 });
    }
    for (let i = 0; i < 4; i++) {
      _e.copy(player.pos).addScaledVector(f, 2.6 + i * 2.2);
      impact.mark(_e, VINE, { radius: .9 + i * .25, life: .6, style: MARK_STYLE.thorn, delay: .04 + i * .08, angle: i * .9 });
    }
  },
  // 질풍 사냥: 영웅 둘레를 감는 회오리 세 겹(접선 불똥, 박자마다 반경이 커진다) + 박자마다 회전하는 나침 고리 + 쌍나선 바람 화살 줄.
  gale_hunt(ctx) {
    const { impact, f, player, lite } = ctx; const n = lite ? 4 : 8, o = bow(ctx, _a);
    for (let w = 0; w < 3; w++) {
      impact.mark(player.pos, w === 1 ? JADE_HOT : JADE, { radius: 1.8 + w * .7, life: .45, style: MARK_STYLE.compass, angle: w * .9, delay: w * .12 });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + w * .5, r = 1.1 + w * .35;
        impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .4 + w * .45, player.pos.z + Math.sin(a) * r, .26, w === 1 ? JADE_HOT : JADE, .36,
          { vx: -Math.sin(a) * 10, vy: 2.8, vz: Math.cos(a) * 10, stretch: 1, grow: 1, delay: w * .12 });
      }
      rotY(f, (w - 1) * .12, _d);
      impact.beam(o, _d, 14, JADE, { speed: 28, tail: 7, width: .26, style: BEAM_STYLE.gale, delay: w * .12 });
    }
  },
  // 하늘 화살비: 착탄 중심에 큰 나침 고리, 다섯 착탄점에 조준 원이 먼저 잡히고,
  // 하늘에서 떨어지는 굵은 광선(번짐 + 심)이 판정 순간(.16+i×.09초)에 정확히 꽂혀 고리·별빛·가시 자국을 남긴다.
  skyfall_arrows(ctx) {
    const { impact, at, lite } = ctx;
    const FALL = 16, SPEED = 90;
    impact.mark(at, JADE, { radius: 6.4, life: 1, style: MARK_STYLE.compass, angle: .4 });
    for (let i = 0; i < 5; i++) {
      const hitT = .16 + i * .09;
      _b.set(at.x + Math.cos(i * 2.4) * 2.2, 0, at.z + Math.sin(i * 2.4) * 2.2);
      impact.mark(_b, JADE, { radius: 1.9, life: hitT + .3, style: MARK_STYLE.reticle });
      _a.set(_b.x - 1.4, FALL, _b.z - .8); _d.copy(_b).sub(_a); const len = _d.length();
      const start = Math.max(0, hitT - len / SPEED);
      if (!lite) impact.beam(_a, _d, len, DEEP, { speed: SPEED, tail: 9, width: .36, delay: start });
      impact.beam(_a, _d, len, JADE_HOT, { speed: SPEED, tail: 7, width: .12, delay: start });
      impact._emit(IMPACT_KIND.ring, _b.x, .4, _b.z, 2.6, JADE, .3, { grow: 1, delay: hitT });
      impact._emit(IMPACT_KIND.star, _b.x, .5, _b.z, 1.5, JADE_HOT, .1, { angle: .3, grow: .5, delay: hitT });
      if (!lite) impact._emit(IMPACT_KIND.mark, _b.x, .06, _b.z, 2.6, JADE, .45, { stretch: MARK_STYLE.thorn, delay: hitT });
    }
  },
};

/** 영웅별 서명 합본. 궁수는 이 파일, 나머지 영웅은 sig-<영웅>.js 가 맡는다. */
export const SKILL_SIGNATURES = { ...RANGER, ...KNIGHT, ...MAGE, ...ROGUE, ...BARBARIAN };
