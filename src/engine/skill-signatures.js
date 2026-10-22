import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE } from './impact-vfx.js';
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

/** @type {Record<string, (ctx: SigCtx) => void>} */
const RANGER = {
  // 관통: 화살 궤적(광선)에 더해 바닥에 곧은 레일 한 줄이 즉시 깔렸다 사라진다 → '일직선으로 꿰뚫는다'.
  ranger_pierce(ctx) {
    const { impact, f } = ctx; const o = bow(ctx, _a);
    _b.copy(ctx.player.pos).setY(.06);
    impact.beam(_b, f, 16, 0x1f9a70, { width: .06, fade: .38 });
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 1.1, JADE_HOT, .14, { angle: Math.atan2(f.z, f.x) * .2, grow: .5 });
  },
  // 일제 사격: 활 앞 바닥에 세 갈래 부채꼴이 펼쳐진다.
  ranger_volley(ctx) {
    const { impact, f, player } = ctx;
    impact.mark(player.pos, JADE, { radius: 5.5, life: .45, style: MARK_STYLE.fan, angle: yawOf(f) });
  },
  // 후퇴 사격: 제자리 회피 폭발(고리 + 뒤·옆으로 흩어지는 잎사귀 불똥) + 바닥 짧은 고리.
  ranger_retreat(ctx) {
    const { impact, f, player, lite } = ctx; const o = _a.copy(player.pos).setY(.6);
    impact._emit(IMPACT_KIND.ring, o.x, o.y, o.z, 2.1, JADE, .26, { grow: 1 });
    impact.mark(player.pos, JADE, { radius: 1.8, life: .4, style: MARK_STYLE.thorn });
    _d.set(-f.x, 0, -f.z);
    impact._streaks(o, _d, lite ? 4 : 9, 9, .3, JADE_HOT, { up: 1.6, spread: 1.5, size: .24 });
  },
  // 폭풍의 일곱 화살(궁극기): 발밑 나침 고리(일곱 눈금) + 활 끝 큰 별빛 + 일곱 방향 바람 불똥.
  ranger_tempest(ctx) {
    const { impact, f, player, lite } = ctx; const o = bow(ctx, _a);
    impact.mark(player.pos, JADE, { radius: 3.8, life: .95, style: MARK_STYLE.compass, angle: yawOf(f) });
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 2.6, JADE_HOT, .22, { angle: .3, grow: .4 });
    impact._emit(IMPACT_KIND.ring, o.x, o.y, o.z, 3.2, JADE, .3, { grow: 1 });
    impact._streaks(o, f, lite ? 4 : 10, 14, .32, JADE_HOT, { up: .8, spread: .95, size: .26 });
  },
  // 연사: 앞쪽 과녁에 조준 원이 잡히고, 세 번의 사격 박자(0, .12, .24초)마다 활 끝 고리가 터진다.
  ranger_quickshot(ctx) {
    const { impact, f, player } = ctx;
    _b.copy(player.pos).addScaledVector(f, 9);
    impact.mark(_b, JADE_HOT, { radius: 1.3, life: .55, style: MARK_STYLE.reticle });
    const o = bow(ctx, _a);
    for (const d of [.12, .24]) impact._emit(IMPACT_KIND.ring, o.x, o.y, o.z, .55, JADE_HOT, .16, { grow: 1, delay: d });
  },
  // 속박의 화살: 덩굴빛 부채꼴(가시 고리는 명중한 적 발밑에 battle 이 찍는다).
  ranger_binding(ctx) {
    const { impact, f, player } = ctx;
    impact.mark(player.pos, VINE, { radius: 7, life: .55, style: MARK_STYLE.fan, angle: yawOf(f) });
    // 부채 안을 따라 차례로 돋는 가시 매듭 셋(덩굴이 뻗어 나가는 박자).
    for (let i = 0; i < 3; i++) {
      _b.copy(player.pos).addScaledVector(f, 2.4 + i * 1.9);
      impact.mark(_b, VINE, { radius: .7 + i * .15, life: .45, style: MARK_STYLE.thorn, delay: .05 + i * .06, angle: i * .9 });
    }
  },
  // 질풍 사냥: 발밑 작은 나침 고리 + 몸을 감고 도는 바람 불똥(접선 속도) 세 박자.
  gale_hunt(ctx) {
    const { impact, player, lite } = ctx; const n = lite ? 5 : 10;
    impact.mark(player.pos, JADE, { radius: 2.4, life: .7, style: MARK_STYLE.compass });
    for (let w = 0; w < 3; w++) for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + w * .5, r = 1.1;
      impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .5 + w * .35, player.pos.z + Math.sin(a) * r, .2, JADE_HOT, .28,
        { vx: -Math.sin(a) * 9, vy: 2.5, vz: Math.cos(a) * 9, stretch: .9, grow: 1, delay: w * .12 });
    }
  },
  // 하늘 화살비: 다섯 착탄점에 조준 원이 먼저 잡히고, 하늘에서 떨어지는 광선이 판정 순간(.16+i×.09초)에 정확히 꽂힌다.
  skyfall_arrows(ctx) {
    const { impact, at, lite } = ctx;
    const FALL = 14, SPEED = 90;
    for (let i = 0; i < 5; i++) {
      const hitT = .16 + i * .09;
      _b.set(at.x + Math.cos(i * 2.4) * 2.2, 0, at.z + Math.sin(i * 2.4) * 2.2);
      impact.mark(_b, JADE, { radius: 1.9, life: hitT + .3, style: MARK_STYLE.reticle });
      _a.set(_b.x - 2, FALL, _b.z - 1.2); _d.copy(_b).sub(_a); const len = _d.length();
      const travel = len / SPEED;
      impact.beam(_a, _d, len, JADE_HOT, { speed: SPEED, tail: 6, width: .09, delay: Math.max(0, hitT - travel) });
      impact._emit(IMPACT_KIND.ring, _b.x, .4, _b.z, 2.4, JADE, .26, { grow: 1, delay: hitT });
      impact._emit(IMPACT_KIND.star, _b.x, .5, _b.z, 1.6, JADE_HOT, .16, { angle: .3, grow: .5, delay: hitT });
      if (!lite) impact._emit(IMPACT_KIND.mark, _b.x, .06, _b.z, 2.6, JADE, .35, { stretch: MARK_STYLE.thorn, delay: hitT });
    }
  },
};

/** 영웅별 서명 합본. 궁수는 이 파일, 나머지 영웅은 sig-<영웅>.js 가 맡는다. */
export const SKILL_SIGNATURES = { ...RANGER, ...KNIGHT, ...MAGE, ...ROGUE, ...BARBARIAN };
