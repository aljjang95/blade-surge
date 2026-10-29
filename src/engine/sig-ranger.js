import * as THREE from 'three';
import { IMPACT_KIND, MARK_STYLE, BEAM_STYLE } from './impact-vfx.js';

/**
 * 스킬별 '모양 언어' 서명. castSkillVfx 가 레시피(바닥 룬·텍스처) 뒤에 한 번 부른다.
 * 모두 인스턴스 임팩트 층(드로우콜 1, 이미 존재)의 광선·지면 표식·고리·별빛·불똥만 쓰므로 드로우콜이 늘지 않는다.
 * 타이밍은 skills.js 의 실제 판정 시각(game.after 지연)에 맞춘 지연 칸(delay)으로 미리 예약한다. 판정·난수와 무관하다.
 * 궁수: 관통 일직선 / 세 갈래 부채 / 회피 폭발 / 폭풍 나침 / 연사 조준 / 덩굴 부채 / 바람 소용돌이 / 하늘 화살비 표식.
 */
const JADE = 0x3fe0a0, JADE_HOT = 0x9fffd8, VINE = 0x63e08a;
/** 검은 고양이 사냥꾼(고유 스킬 2종) 보라 팔레트. 명사수 비취와 한눈에 갈린다. */
const CAT = 0xb070ff, CAT_HOT = 0xe6ccff, CAT_DEEP = 0x5a2a9a;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const yawOf = (f) => Math.atan2(f.z, f.x);

/** @typedef {{ fx: any, impact: any, player: any, at: THREE.Vector3, f: THREE.Vector3, lite: boolean, scale: number }} SigCtx */

/** 활 끝(대략) 위치. 실제 화살 원점은 활 뼈대지만 서명 장식은 발사 높이·앞 0.9m 로 충분하다. */
function bow(ctx, out) { return out.copy(ctx.player.pos).addScaledVector(ctx.f, .9).setY(1.25); }

/** 수평 방향 f 를 y 축으로 a 라디안 돌린 단위 벡터(skills.js applyAxisAngle 과 같은 회전). */
function rotY(f, a, out) { const c = Math.cos(a), s = Math.sin(a); return out.set(f.x * c + f.z * s, 0, -f.x * s + f.z * c).normalize(); }
/** 바닥 번짐용 어두운 비취·이끼빛. 가산 혼합에서 흰 심이 땅색과 더해져 백화되지 않게 밝기를 낮춘 색이다. */
const DEEP = 0x1c9a6c, MOSS = 0x2fae5a;
/** 금·금연두 하이라이트: 청록 돌바닥과 같은 색인 비취 대신 화면에서 바닥과 갈리는 대비색(작은 면적·가는 선으로만). */
const GOLD = 0xffc840, GOLD_HOT = 0xffe7a0, LIME = 0xc8f25a;
const _e = new THREE.Vector3(), _a2 = new THREE.Vector3();

/**
 * 바닥 '레일': 광선 한 줄은 머리(앞)만 밝고 시작점 쪽이 흐려 영웅 앞 화면에서는 거의 안 보였다.
 * 그래서 seg m 짜리 짧은 광선(앞이 밝은 화살촉 모양 대시)을 d0~d1 사이에 이어 깔고, 화살(speed m/s)이 그 지점을 지나는 순간 켠다.
 * side 는 진행 방향 오른쪽으로의 옆 간격(m). 반환값은 쓴 대시 수.
 */
function rail(impact, from, dir, d0, d1, seg, color, { width = .2, speed = 28, life = .6, style = BEAM_STYLE.line, side = 0 } = {}) {
  let n = 0;
  for (let d = d0; d < d1 - .01; d += seg, n++) {
    _e.copy(from).addScaledVector(dir, d);
    if (side) { _e.x += -dir.z * side; _e.z += dir.x * side; }
    impact.beam(_e, dir, seg * .82, color, { width, style, fade: life, delay: d / speed });
  }
  return n;
}

/** 화면 안 표시 한계(NDC): 끝점 표식 바깥 가장자리가 위 HUD 띠·좌우 가장자리 안쪽에 남게 한다. */
export const SCREEN_REACH = Object.freeze({ x: .86, y: .78, step: .5, min: 5 });
const _ndc = new THREE.Vector3();
/** 지면 한 점이 카메라 시야(SCREEN_REACH 안쪽)에 들어오는지. */
function onScreen(camera, x, y, z) {
  _ndc.set(x, y, z).project(camera);
  return _ndc.z < 1 && Math.abs(_ndc.x) <= SCREEN_REACH.x && _ndc.y <= SCREEN_REACH.y && _ndc.y >= -1;
}
/**
 * 표시 전용 사거리: from 에서 dir 로 max(m)까지 가되, 끝점 표식 바깥 가장자리(+edge m)가 화면 밖으로 나가면
 * 화면 안쪽 최장 거리로 줄인다(.5m 단위, 최소 SCREEN_REACH.min). 카메라가 없으면(테스트·미초기화) max 그대로.
 * 판정·피해·투사체 사거리는 바꾸지 않는다(관통 화살은 27m/s × .85초 그대로 날아간다). 프레임당이 아니라 시전 한 번에 한 번, 할당 없음.
 */
export function screenReach(camera, from, dir, max, edge = 0) {
  if (!camera?.projectionMatrix || !camera.matrixWorldInverse) return max;
  for (let d = max; d > SCREEN_REACH.min; d -= SCREEN_REACH.step) {
    const e = d + edge;
    if (onScreen(camera, from.x + dir.x * e, 0, from.z + dir.z * e) && onScreen(camera, from.x + dir.x * d, 1.6, from.z + dir.z * d)) return d;
  }
  return SCREEN_REACH.min;
}

/** @type {Record<string, (ctx: SigCtx) => void>} */
export const SIGNATURES = {
  // 관통(바람 터널): 바닥 비취 돌과 같은 색이라 묻히던 비취 단색을 버리고 '진한 심 + 금연두·금 하이라이트' 대비로 바꾼다.
  // 1박 활 끝 금 별빛 → 2박 화살과 같은 속도로 나아가는 금연두 쌍나선 머리 + 그 뒤에 남는 진한 비취 쌍나선 터널(바람 터널)
  // → 관통점(3.5·6.5·9.5m)마다 화면 가로로 그어지는 금 충격 자국 + 양옆으로 튀는 금연두 파편 + 가시 매듭(약 1초 잔광)
  // → 끝점(11m)에 금 관통 나침 고리. 세로 요소는 영웅 위 좁은 띠에 몰리므로 '어디까지 꿰뚫었나'는 가로 요소가 맡는다.
  // 화면 클램프(h1c): 표시 거리만 screenReach 로 화면 안쪽까지 비례 축소(지연은 화살이 그 거리를 지나는 시각 d/27 그대로).
  ranger_pierce(ctx) {
    const { impact, f, player, lite } = ctx; const o = bow(ctx, _a), SPEED = 27;
    const END = screenReach(ctx.fx?.camera, player.pos, f, 11, 2.2), k = END / 11;
    _b.copy(player.pos).setY(.1);
    // 바람 터널: 화살이 지난 자리부터 차례로 깔리는 진한 쌍나선(어두운 심이 금 하이라이트를 받쳐 바닥과 갈린다).
    rail(impact, _b, f, .8, 12.2 * k, 2.3, DEEP, { width: 1.25, speed: SPEED, life: .85, style: BEAM_STYLE.gale });
    // 터널 머리: 금연두 쌍나선이 화살과 같은 속도로 나아가고, 가는 금 심이 그 안을 꿰뚫는다.
    impact.beam(_b, f, 13 * k, LIME, { speed: SPEED, tail: 5, width: 1, style: BEAM_STYLE.gale });
    impact.beam(o, f, 16, GOLD, { speed: SPEED, tail: 9, width: .2 });
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 1.2, GOLD, .1, { angle: yawOf(f) * .2, grow: .5 });
    // 바람 갈래: 화살이 지나는 순간 길 양옆으로 뒤로 젖혀 갈라지는 바람(화살 뒤로 벌어지는 물결). 2개 중 1개는 금연두.
    if (!lite) for (let d = 2.5; d <= 10 * k + .01; d += 2.5 * k) {
      _e.copy(_b).addScaledVector(f, d);
      for (const s of [-1, 1]) impact.beam(_e, rotY(f, s * 2.5, _d), 2, Math.round(d / k) % 5 ? LIME : JADE, { width: .34, style: BEAM_STYLE.gale, fade: .8, delay: d / SPEED });
    }
    const ang = (impact._screenAngle?.(f) ?? 0) + 1.5708;
    _d.set(-f.z, 0, f.x);
    for (const d0 of [3.5, 6.5, 9.5]) {
      const d = d0 * k, t = d / SPEED;
      // 관통점 가로 충격 자국(금): 바닥에 진행 수직으로 양쪽 2.6m 씩 그어지고(끝이 밝다) 1초 가까이 남는다.
      _e.copy(_b).addScaledVector(f, d);
      impact.beam(_e, _d, 2.6, GOLD, { width: .18, fade: 1, delay: t });
      _d.negate(); impact.beam(_e, _d, 2.6, GOLD, { width: .18, fade: 1, delay: t }); _d.negate();
      if (!lite) impact.mark(_e, DEEP, { radius: 1.5, life: .95, style: MARK_STYLE.thorn, angle: d0 * .4, delay: t });
      // 서 있는 빛(참격·별빛·고리)은 적 몸통(약 1m) 아래 발목 높이에 작게: 활 높이에서는 관통점에 선 적 몸을 흰 덩어리로 덮었다.
      _e.copy(_b).addScaledVector(f, d).setY(.45);
      impact._emit(IMPACT_KIND.cut, _e.x, _e.y, _e.z, 1.5, LIME, .3, { angle: ang, stretch: 1.6, grow: .9, delay: t });
      impact._emit(IMPACT_KIND.star, _e.x, _e.y, _e.z, 1, GOLD, .2, { angle: .785, grow: .4, delay: t });
      impact._emit(IMPACT_KIND.ring, _e.x, _e.y, _e.z, 1.4, DEEP, .32, { grow: 1, delay: t });
      // 금연두 폭발 파편: 관통점에서 길 양옆(화면 가로)으로 튄다. 결정적 수식(관통점·순번)만 쓴다.
      if (!lite) for (let j = 0; j < 4; j++) {
        const s = j % 2 ? 1 : -1, sp = 6 + (j >> 1) * 3;
        impact._emit(IMPACT_KIND.shard, _e.x, _e.y, _e.z, .3, j < 2 ? GOLD : LIME, .5,
          { vx: _d.x * s * sp + f.x * 2.5, vy: 3 + (j >> 1) * 1.5, vz: _d.z * s * sp + f.z * 2.5, angle: d0 + j, stretch: 1.8, grow: .8, gravity: 12, delay: t });
      }
    }
    // 끝점: 금 관통 나침 고리 + 별빛 + 고리(어디까지 꿰뚫었나).
    const te = END / SPEED;
    _e.copy(_b).addScaledVector(f, END);
    impact.mark(_e, GOLD, { radius: 2.2, life: .9, style: MARK_STYLE.compass, angle: yawOf(f), delay: te });
    // 끝점 별빛·고리는 바닥 가까이(.45m) — 활 높이의 화면 정렬 고리는 화면에서 더 위로 떠 위 가장자리에 잘렸다.
    _e.copy(_b).addScaledVector(f, END).setY(.45);
    impact._emit(IMPACT_KIND.star, _e.x, _e.y, _e.z, 1.8, GOLD_HOT, .24, { angle: .3, grow: .4, delay: te });
    impact._emit(IMPACT_KIND.ring, _e.x, _e.y, _e.z, 2.6, LIME, .4, { grow: 1, delay: te });
  },
  // 삼중 추적: 실제 세 발(±0.24rad)을 따라 바닥에 '휘어 들어가는' 세 갈래 궤적이 화살 속도로 그어진다.
  // 양옆 갈래는 바깥으로 크게 벌어졌다가 실제 화살 방향으로 감겨 들고(추적), 가운데는 금 심 직선. 갈래마다 진한 번짐 + 밝은 심 두 겹.
  // 7.5m 지점(약 .33초)에 갈래마다 금 화살촉 자국과 금연두 파편, 발밑엔 금 부채 테.
  ranger_volley(ctx) {
    const { impact, f, player, lite } = ctx; const SPEED = 23, SEG = 2, N = 5;
    impact.mark(player.pos, GOLD, { radius: 6, life: .6, style: MARK_STYLE.fan, angle: yawOf(f) });
    const o = bow(ctx, _a);
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 1.3, GOLD, .1, { angle: .3, grow: .5 });
    for (let i = -1; i <= 1; i++) {
      _e.copy(player.pos).setY(.1);
      for (let s = 0; s < N; s++) {
        // 머리 방향: 바깥 .3rad 더 벌어진 데서 시작해 끝에서 실제 화살 방향(i × .24)으로 감긴다.
        rotY(f, i * (.24 + .3 * (1 - s / (N - 1)) ** 1.5), _d);
        const t = (.6 + s * SEG) / SPEED;
        if (!lite || !i) impact.beam(_e, _d, SEG * .96, DEEP, { width: .62, style: BEAM_STYLE.gale, fade: .7, delay: t });
        impact.beam(_e, _d, SEG * .96, i ? LIME : GOLD, { width: i ? .2 : .24, fade: .55, delay: t });
        _e.addScaledVector(_d, SEG);
      }
      // 끝 자국: 궤적 끝 바로 앞(화살이 7.5m 를 지나는 무렵).
      _a2.copy(_e).setY(1);
      impact._emit(IMPACT_KIND.cut, _a2.x, _a2.y, _a2.z, 1.6, GOLD, .32, { angle: impact._screenAngle?.(_d) ?? 0, stretch: 1, grow: .9, delay: 7.5 / SPEED });
      if (!lite) for (let j = 0; j < 3; j++) {
        const a = yawOf(_d) + (j - 1) * .9;
        impact._emit(IMPACT_KIND.shard, _a2.x, _a2.y, _a2.z, .26, j === 1 ? GOLD : LIME, .42,
          { vx: Math.cos(a) * 6, vy: 3, vz: Math.sin(a) * 6, angle: a, stretch: 1.8, grow: .8, gravity: 12, delay: 7.5 / SPEED });
      }
    }
  },
  // 이탈 사격: 뒤로 미끄러지는 길(초속 8m)을 따라 뒤로 튀는 금연두 바람 잔상(뒤를 가리키는 V 자 넷이 차례로) +
  // 시작점 발밑에서 바깥으로 터지는 돌풍(여덟 갈래 쌍나선 바람, 진한 비취) + 앞으로 쏘는 금 화살 한 줄.
  ranger_retreat(ctx) {
    const { impact, f, player, lite } = ctx; const o = bow(ctx, _a);
    _d.set(-f.x, 0, -f.z);
    _b.copy(player.pos).setY(.1);
    // 발밑 돌풍: 시작 자리에서 사방으로 뻗는 바람 갈래.
    for (let i = 0, n = lite ? 4 : 8; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + .2; _e.set(_b.x + Math.cos(a) * .6, .1, _b.z + Math.sin(a) * .6); _a2.set(Math.cos(a), 0, Math.sin(a));
      impact.beam(_e, _a2, 2.4, i % 2 ? DEEP : JADE, { width: .5, style: BEAM_STYLE.gale, fade: .5, speed: 12, tail: 1.6 });
    }
    impact.mark(_b, GOLD, { radius: 1.6, life: .4, style: MARK_STYLE.compass, angle: yawOf(f) });
    // 앞으로 쏘는 금 화살(실제 한 발과 같은 방향·속도).
    impact.beam(o, f, 13, GOLD, { speed: 28, tail: 6, width: .2 });
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 1.2, GOLD, .1, { angle: .3, grow: .5 });
    // 뒤로 튀는 바람 잔상: 영웅이 지나는 자리마다 뒤를 가리키는 V(금연두 겉 + 금 안쪽)가 남는다.
    for (let i = 0; i < 4; i++) {
      const t = .04 + i * .12; _e.copy(player.pos).addScaledVector(_d, 8 * t * .85).setY(.1);
      for (const s of [-1, 1]) {
        rotY(_d, s * .6, _a2); _e.addScaledVector(_a2, -1.3 - i * .15);
        impact.beam(_e, _a2, 1.3 + i * .15, i % 2 ? GOLD : LIME, { width: .26, fade: .45, delay: t });
        _e.addScaledVector(_a2, 1.3 + i * .15);
      }
      if (i % 2 === 0) impact._emit(IMPACT_KIND.ring, _e.x, .7, _e.z, 1.6 + i * .4, i ? DEEP : LIME, .3, { grow: 1, delay: t });
    }
    impact._streaks(_b.setY(.6), _d, lite ? 3 : 6, 9, .34, LIME, { up: 1.6, spread: 1.4, size: .26 });
  },
  // 폭풍의 일곱 화살(궁극기) 3박자: ① 활 끝으로 감겨드는 바람 소용돌이(접선 불똥 두 겹) + 금 별빛
  // ② 실제 일곱 발(±3×0.18rad) 방향으로 화살 속도의 금·비취 빛줄기(진한 쌍나선 번짐 위 밝은 심)
  // ③ 빛줄기가 부채 끝(화면 안 최장 거리)에 닿는 순간 갈래마다 금연두 폭풍 고리·가시 매듭. 영웅 발밑 큰 흰 고리는 쓰지 않는다(백화).
  ranger_tempest(ctx) {
    const { impact, f, player, lite } = ctx; const o = bow(ctx, _a), SPEED = 28;
    const END = screenReach(ctx.fx?.camera, player.pos, f, 12, 2);
    // 발밑은 진한 비취 작은 나침만: 금 3.4m 나침은 시전 마법진과 겹쳐 영웅 둘레를 노란 큰 원판으로 덮었다(iter2).
    impact.mark(player.pos, DEEP, { radius: 2.4, life: .6, style: MARK_STYLE.compass, angle: yawOf(f) });
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 2.2, GOLD, .1, { angle: .3, grow: .4 });
    impact._emit(IMPACT_KIND.ring, o.x, o.y, o.z, 2.6, LIME, .3, { grow: 1 });
    // ① 소용돌이: 활 둘레에서 접선으로 감겨 들며 솟는 불똥(안쪽 금연두, 바깥 비취).
    const n = lite ? 3 : 6;
    for (let w = 0; w < 2; w++) for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + w * .5, r = 1.3 + w * .9;
      impact._emit(IMPACT_KIND.streak, o.x + Math.cos(a) * r, .5 + w * .4, o.z + Math.sin(a) * r, .32, w ? JADE : LIME, .5,
        { vx: -Math.sin(a) * 10 - Math.cos(a) * 3, vy: 2.4, vz: Math.cos(a) * 10 - Math.sin(a) * 3, stretch: 1, grow: 1, delay: w * .08 });
    }
    _b.copy(player.pos).setY(.1);
    for (let i = -3; i <= 3; i++) {
      rotY(f, i * .18, _d);
      // ② 빛줄기: 진한 쌍나선 번짐(바닥) + 화살 높이 밝은 심(홀수 갈래 금, 짝수 갈래 금연두).
      if (!lite || !(i % 2)) impact.beam(_b, _d, END, DEEP, { speed: SPEED, tail: 7, width: .7, style: BEAM_STYLE.gale });
      _e.copy(_b).setY(.9);
      impact.beam(_e, _d, END + 1, i % 2 ? GOLD : LIME, { speed: SPEED, tail: 9, width: .2 });
      // ③ 부채 끝 폭풍 고리.
      const te = END / SPEED; _e.copy(_b).addScaledVector(_d, END);
      impact._emit(IMPACT_KIND.ring, _e.x, .5, _e.z, 2.2, i % 2 ? GOLD : LIME, .42, { grow: 1, delay: te });
      if (!lite && !(i % 2)) impact.mark(_e, DEEP, { radius: 1.6, life: .7, style: MARK_STYLE.thorn, angle: i, delay: te });
    }
    _e.copy(_b).addScaledVector(f, END);
    impact._emit(IMPACT_KIND.star, _e.x, .6, _e.z, 2, GOLD_HOT, .2, { angle: .3, grow: .4, delay: END / SPEED + .04 });
  },
  // 연사: 6.5m 앞 과녁에 조준 원이 잡히고, 세 박자(0, .12, .24초)마다 굵은 화살 줄·활 끝 별빛·과녁 X 자가 찍힌다.
  // 리듬은 과녁 위 세 겹 가시 고리가 박자마다 한 겹씩 바깥으로 늘며(짙은 비취 → 비취 → 밝은 비취, 박자마다 진해짐) 함께 남고,
  // 과녁 옆엔 박자 수만큼 가로 막대(≡)가 쌓인다. 영웅 앞 세로 띠의 바닥 대시는 쓰지 않는다.
  ranger_quickshot(ctx) {
    const { impact, f, player } = ctx; const SPEED = 28, AIM = 6.5, FLY = AIM / SPEED;
    _b.copy(player.pos).addScaledVector(f, AIM);
    impact.mark(_b, JADE, { radius: 2.2, life: .6, style: MARK_STYLE.reticle });
    const o = bow(ctx, _a), BEAT = [DEEP, 0x2cc488, JADE];
    _d.set(-f.z, 0, f.x);
    for (let i = 0; i < 3; i++) {
      const d = i * .12, hit = d + FLY, c = BEAT[i];
      impact.beam(o, f, 12, i === 2 ? JADE_HOT : JADE, { speed: SPEED, tail: 5, width: .18, delay: d });
      impact.beam(o, f, AIM + 1, DEEP, { width: .42, fade: .4, delay: d });
      impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, .8 + i * .2, JADE_HOT, .09, { angle: .3, grow: .5, delay: d });
      // 과녁 세 겹 고리(1.5·2.6·3.7m): 모두 같은 때(마지막 박자 + .8초) 사라지므로 1 → 2 → 3 겹으로 쌓인다. 가운데 빌보드 고리는 쓰지 않는다(백화).
      impact.mark(_b, c, { radius: 1.5 + i * 1.1, life: 1.05 - d, style: MARK_STYLE.thorn, angle: i * .6, delay: hit });
      impact._emit(IMPACT_KIND.cut, _b.x, 1, _b.z, 1.9 + i * .3, i ? JADE : DEEP, .26, { angle: (i - 1) * .9, stretch: 1.1, grow: .9, delay: hit });
      // 박자 막대: 고리 바깥 양옆에서 가로로 뻗는다(과녁 가운데는 비워 흰 덩어리를 만들지 않는다). 세 박자 = 앞뒤로 세 줄.
      for (const s of [-1, 1]) {
        _e.copy(_b).setY(.08).addScaledVector(f, (i - 1) * .7).addScaledVector(_d, s * 3.9);
        _a2.copy(_d).multiplyScalar(s);
        impact.beam(_e, _a2, 1 + i * .45, c, { width: .16, fade: .95 - d, delay: hit });
      }
    }
  },
  // 속박의 화살: 다섯 발 방향으로 바닥을 기는 덩굴 물결 대시(이끼빛) + 부채 + 앞으로 차례로 돋는 가시 매듭.
  ranger_binding(ctx) {
    const { impact, f, player, lite } = ctx;
    impact.mark(player.pos, VINE, { radius: 8, life: .7, style: MARK_STYLE.fan, angle: yawOf(f) });
    _b.copy(player.pos).setY(.08);
    for (let i = -2; i <= 2; i++) {
      if (lite && i % 2) continue;
      rotY(f, i * .18, _d);
      rail(impact, _b, _d, 1, 10, 3, i ? MOSS : VINE, { width: .5, speed: 28, life: .75, style: BEAM_STYLE.vine });
    }
    for (let i = 0; i < 4; i++) {
      _e.copy(player.pos).addScaledVector(f, 2.6 + i * 2.2);
      impact.mark(_e, VINE, { radius: 1.3 + i * .35, life: .75, style: MARK_STYLE.thorn, delay: .04 + i * .08, angle: i * .9 });
    }
  },
  // 질풍 사냥: 영웅 발밑에서 바깥으로 감겨 나가는 세 갈래 회오리 나선(쌍나선 바람 짧은 줄 15개, 안쪽부터 차례로) +
  // 박자마다 몸을 감고 도는 접선 불똥 + 작은 나침 고리 + 쌍나선 바람 화살 줄. 판정 박자는 0, .12, .24초.
  gale_hunt(ctx) {
    const { impact, f, player, lite } = ctx; const n = lite ? 3 : 6, arms = lite ? 2 : 3, o = bow(ctx, _a);
    _b.copy(player.pos).setY(.08);
    for (let a = 0; a < arms; a++) for (let j = 0; j < 5; j++) {
      const ang = a * (Math.PI * 2 / arms) + j * .55, r = .9 + j * .62;
      _e.set(_b.x + Math.cos(ang) * r, .08, _b.z + Math.sin(ang) * r); _d.set(-Math.sin(ang), 0, Math.cos(ang));
      impact.beam(_e, _d, .9 + j * .3, j % 2 ? JADE : JADE_HOT, { width: .3, style: BEAM_STYLE.gale, fade: .6, delay: j * .05 });
    }
    for (let w = 0; w < 3; w++) {
      impact.mark(player.pos, JADE, { radius: 1.5 + w * .35, life: .4, style: MARK_STYLE.compass, angle: w * .9, delay: w * .12 });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + w * .5, r = 1.2 + w * .4;
        impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .4 + w * .45, player.pos.z + Math.sin(a) * r, .32, w === 1 ? JADE_HOT : JADE, .4,
          { vx: -Math.sin(a) * 10, vy: 2.8, vz: Math.cos(a) * 10, stretch: 1, grow: 1, delay: w * .12 });
      }
      rotY(f, (w - 1) * .12, _d);
      impact.beam(o, _d, 14, JADE, { speed: 28, tail: 7, width: .28, style: BEAM_STYLE.gale, delay: w * .12 });
    }
  },
  // 하늘 화살비: 착탄 중심에 큰 나침 고리, 다섯 착탄점에 조준 원이 먼저 잡히고,
  // 하늘에서 떨어지는 굵은 광선(번짐 + 심)이 판정 순간(.16+i×.09초)에 정확히 꽂혀 고리·별빛·가시 자국을 남긴다.
  skyfall_arrows(ctx) {
    const { impact, at, lite } = ctx;
    const FALL = 16, SPEED = 110;
    impact.mark(at, JADE, { radius: 6.4, life: 1, style: MARK_STYLE.compass, angle: .4 });
    for (let i = 0; i < 5; i++) {
      const hitT = .16 + i * .09;
      _b.set(at.x + Math.cos(i * 2.4) * 2.2, 0, at.z + Math.sin(i * 2.4) * 2.2);
      impact.mark(_b, JADE, { radius: 1.9, life: hitT + .3, style: MARK_STYLE.reticle });
      _a.set(_b.x - 1.4, FALL, _b.z - .8); _d.copy(_b).sub(_a); const len = _d.length();
      const start = Math.max(0, hitT - len / SPEED);
      if (!lite) impact.beam(_a, _d, len, DEEP, { speed: SPEED, tail: 9, width: .36, delay: start });
      impact.beam(_a, _d, len, JADE, { speed: SPEED, tail: 7, width: .12, delay: start });
      impact._emit(IMPACT_KIND.ring, _b.x, .4, _b.z, 2.6, JADE, .3, { grow: 1, delay: hitT });
      impact._emit(IMPACT_KIND.star, _b.x, .5, _b.z, 1.5, JADE_HOT, .1, { angle: .3, grow: .5, delay: hitT });
      if (!lite) impact._emit(IMPACT_KIND.mark, _b.x, .06, _b.z, 2.6, JADE, .45, { stretch: MARK_STYLE.thorn, delay: hitT });
    }
  },
  // 불길한 징조: 발밑 보라 부채 표식 + 세 갈래 보라 대시(표적 셋의 저주 화살) + 끝점 별빛. 맞은 적의 표식은 skills.js 가 따로 찍는다.
  cat_omen(ctx) {
    const { impact, f, player } = ctx; const SPEED = 34;
    impact.mark(player.pos, CAT, { radius: 5.5, life: .7, style: MARK_STYLE.fan, angle: yawOf(f) });
    _b.copy(player.pos).setY(.08);
    for (let i = -1; i <= 1; i++) {
      rotY(f, i * .2, _d);
      rail(impact, _b, _d, .8, 12, 2.4, i ? CAT : CAT_HOT, { width: .2, speed: SPEED, life: .55 });
      _e.copy(_b).addScaledVector(_d, 9).setY(1);
      impact._emit(IMPACT_KIND.star, _e.x, _e.y, _e.z, 1.4, CAT_HOT, .22, { angle: .3, grow: .5, delay: 9 / SPEED });
    }
  },
  // 아홉 목숨의 밤: 무적 물러남 길(7m)을 따라 보라 고리가 차례로 터지고, 둘레에 아홉 갈래 그믐 나침이 돌며 접선 불똥이 감긴다.
  nine_lives(ctx) {
    const { impact, f, player, lite } = ctx; const o = bow(ctx, _a);
    impact.mark(player.pos, CAT_HOT, { radius: 4.6, life: 1.2, style: MARK_STYLE.compass, angle: yawOf(f) });
    _d.set(-f.x, 0, -f.z);
    for (let i = 0; i < 4; i++) {
      const t = i * .1; _e.copy(player.pos).addScaledVector(_d, 7 * t * 1.4);
      impact._emit(IMPACT_KIND.ring, _e.x, .6, _e.z, 2 + i * .4, i % 2 ? CAT : CAT_HOT, .34, { grow: 1, delay: t });
    }
    impact._emit(IMPACT_KIND.star, o.x, o.y, o.z, 2.2, CAT_HOT, .1, { angle: .3, grow: .4 });
    const n = lite ? 4 : 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 1.8;
      impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .5, player.pos.z + Math.sin(a) * r, .34, i % 2 ? CAT : CAT_HOT, .6,
        { vx: -Math.sin(a) * 11, vy: 2.2, vz: Math.cos(a) * 11, stretch: 1, grow: 1, delay: i * .09 });
    }
  },
};

/**
 * 궁극기 예비 표식: 궁극기는 시전 연출(ultCinematic) 동안 판정이 늦게 오므로, skills.js start 에서 바로 부르는 예비 표식이다.
 * 시전 전부터 '어디로 무엇이 올지'가 보인다. 서명과 같은 인스턴스 층만 쓰고 Math.random 을 쓰지 않는다.
 * @type {Record<string, (ctx: SigCtx) => void>}
 */
export const PRELUDES = {
  // 아홉 목숨의 밤: 발밑에 어두운 보라 고리가 조여들고 그믐 불똥이 둘레에서 모여든다(보라).
  nine_lives(ctx) {
    const { impact, f, player, lite } = ctx;
    impact.mark(player.pos, CAT_DEEP, { radius: 4.2, life: 1.3, style: MARK_STYLE.compass, angle: yawOf(f) + .2 });
    for (let i = 0, n = lite ? 4 : 8; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 3.4;
      impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .5, player.pos.z + Math.sin(a) * r, .28, i % 2 ? CAT : CAT_HOT, .5,
        { vx: -Math.cos(a) * 6 - Math.sin(a) * 5, vy: 2, vz: -Math.sin(a) * 6 + Math.cos(a) * 5, stretch: 1, grow: 1, delay: (i % 4) * .15 });
    }
  },
  // 폭풍의 일곱 화살(예비 = 3박자의 0박): 발밑 진한 나침 고리가 조여들고, 일곱 갈래 방향으로 가는 금·진한 비취 바람 예고선이 깔리며,
  // 둘레 금연두 바람이 활 쪽으로 감겨 모인다. 비취 단색 큰 고리는 청록 바닥과 섞여 흐린 원판으로 보였다.
  ranger_tempest(ctx) {
    const { impact, f, player, lite } = ctx;
    impact.mark(player.pos, DEEP, { radius: 3.6, life: 1.3, style: MARK_STYLE.compass, angle: yawOf(f) + .2 });
    _b.copy(player.pos).setY(.08);
    for (let i = -3; i <= 3; i++) {
      rotY(f, i * .18, _d); _e.copy(_b).addScaledVector(_d, 1.2);
      impact.beam(_e, _d, 6, i % 2 ? DEEP : GOLD, { width: i % 2 ? .3 : .12, style: i % 2 ? BEAM_STYLE.gale : BEAM_STYLE.line, fade: 1.2 });
    }
    for (let i = 0, n = lite ? 4 : 8; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 3.4;
      impact._emit(IMPACT_KIND.streak, player.pos.x + Math.cos(a) * r, .5, player.pos.z + Math.sin(a) * r, .28, i % 2 ? LIME : GOLD, .5,
        { vx: -Math.cos(a) * 6 - Math.sin(a) * 5, vy: 2, vz: -Math.sin(a) * 6 + Math.cos(a) * 5, stretch: 1, grow: 1, delay: (i % 4) * .15 });
    }
  },
};
