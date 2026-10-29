import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { applyKnightSlashVariant, knightSlashVariantForBattle } from './knight-builds.js';
import { AWAKENING_III } from './awakening-iii.js';
import { gatherEnemies } from './crowd-gather.js';
import { hasTownSkillVariant } from './town-combat.js';
import { WEREWOLF_HOWL, WEREWOLF_HUNT } from './werewolf-kit.js';
import { BLACKCAT_OMEN, BLACKCAT_NIGHT } from './blackcat-kit.js';
import { SKILL_VFX, castSkillVfx, impactReady } from '../engine/skill-vfx.js';
import { SKILL_PRELUDES } from '../engine/skill-signatures.js';
import { knightJudgmentStrike, knightRetiredDraws, KNIGHT_RETIRED_DRAWS } from '../engine/sig-knight.js';
import { barbWhirlTick, barbRushEnd } from '../engine/sig-barbarian.js';
import { mageBolt, mageCharge, mageMeteorFall, mageFrostTick, magePrismBounce, magePrismTrail, mageChronoRelease } from '../engine/sig-mage.js';
import { MARK_STYLE, BEAM_STYLE, IMPACT_KIND } from '../engine/impact-vfx.js';
import { rogueXCut } from '../engine/sig-rogue.js';
import { decorativeBurstGain } from '../engine/combat-feedback.js';

// 시각 강화로 뺀·줄인 fx 호출이 쓰던 Math.random 소비량(실측: 재질·메시 UUID 8회, burst 입자당 5회, embers 입자당 8회, 저화질은 입자 수 절반 올림).
// 시드 전투의 이후 난수(치명·드랍)를 원래 순서로 두려고 같은 자리에서 같은 횟수를 소비한다.
const RETIRED_UUID = 8;
const burstDraws = (fx, n) => 5 * (fx.lite ? Math.ceil(n / 2) : n);
const embersDraws = (fx, n) => 8 * (fx.lite ? Math.ceil(n / 2) : n);

const _v = new THREE.Vector3();
// 눈보라 눈송이: 옅은 하늘색(0x5cbcff) 큰 입자는 화면 위쪽에 흰 거품으로 보였다(h1b). 진한 청으로, 매 프레임 새 색을 만들지 않는다.
const _blizzardFlake = new THREE.Color(0x2a8cff);
const _judgeSky = new THREE.Vector3(), _judgeDir = new THREE.Vector3(), _chainFrom = new THREE.Vector3(), _chainDir = new THREE.Vector3();
/** 검성 준비 진: castCircle(밝기 1 금빛 룬)은 모든 검성 스킬 발밑을 같은 큰 금 원으로 만들었다. 밝기 .45 진한 주황 금으로 작게. */
const knightRune = (game, pos, r, life) => game.fx.groundTex?.(pos, 'circle_gold', 0xffa018, { r0: r * .4, r1: r, life, spin: 1.6, y: .07, fadeIn: .2, hold: .35, gain: .45 });
/** 검성 사슬: 텍스처 번개(푸르게 보이는 흰 결) 대신 금 사슬 선(물결 광선) + 가는 심. 인스턴스 층이라 드로우콜이 늘지 않는다. */
function knightChain(game, from, to, { life = .55, width = .09 } = {}) {
  const impact = game.fx.impact; if (!impact?.beam) return;
  _chainDir.copy(to).sub(from); const L = _chainDir.length(); if (!(L > .1)) return;
  impact.beam(from, _chainDir, L, 0xff8a10, { width, fade: life, style: BEAM_STYLE.vine });
  impact.beam(from, _chainDir, L, 0xffb21e, { width: width * .5, fade: life * .85 });
  impact.beam(from, _chainDir, L, 0xffd86a, { width: width * .18, fade: life * .7 });
}
const fwd = (p, d = 1) => p.forward(new THREE.Vector3()).multiplyScalar(d).add(p.pos);
/** game.hitRadius와 같되 영웅에서 limit m 안의 적만 친다(표시 범위 밖 폭발 피해를 막는 스킬용). */
function hitWithin(game, p, center, radius, limit, dmg, opts = {}) {
  let n = 0;
  for (const e of game.enemies) {
    if (!e.alive || e.spawning || p.distTo(e) >= limit) continue;
    const dx = e.pos.x - center.x, dz = e.pos.z - center.z;
    if (Math.hypot(dx, dz) - e.radius * 0.5 > radius) continue;
    const from = opts.dirFrom || center;
    game.damageEnemy(e, dmg, { ...opts, dirx: e.pos.x - from.x, dirz: e.pos.z - from.z }); n++;
    if (n >= 30) break;
  }
  game.routeObjectives?.strike?.(game, center.x, center.z, radius);
  return n;
}
/** void_step 표시 범위(자기 중심 18m). 점멸 표적과 피해를 시전 지점에서 이 안으로 제한한다. */
const VOID_STEP_REACH = 18;
/** 월광 사냥 다음 표적: 시전 지점 reach 안에서 직전 표적이 아닌 가장 가까운 적(하나뿐이면 같은 적). */
function werewolfHuntTarget(game, origin, last) {
  let best = null, bestD = Infinity, fallback = null;
  for (const e of game.enemies) {
    if (!e.alive || e.spawning) continue;
    const d = Math.hypot(e.pos.x - origin.x, e.pos.z - origin.z);
    if (d >= WEREWOLF_HUNT.reach) continue;
    if (e === last) { fallback = e; continue; }
    const w = d - (e.isBoss ? 3 : e.isElite ? 1.5 : 0);
    if (w < bestD) { bestD = w; best = e; }
  }
  return best || fallback;
}
/** 검은 고양이 표적 n명: origin 에서 reach 안, 가까운 순에 정예·보스·(marked면)표식 적을 앞세운다. 적이 n보다 적으면 돌려 채운다. */
function blackcatTargets(game, p, origin, reach, n, marked = false) {
  const list = [];
  for (const e of game.enemies) {
    if (!e.alive || e.spawning) continue;
    const d = Math.hypot(e.pos.x - origin.x, e.pos.z - origin.z);
    if (d >= reach) continue;
    const omen = marked && e.omenBy === p && e.omenUntil > (game.elapsed || 0);
    list.push({ e, w: d - (e.isBoss ? 4 : e.isElite ? 2 : 0) - (omen ? 3 : 0) });
  }
  list.sort((a, b) => a.w - b.w);
  if (!list.length) return [];
  return Array.from({ length: n }, (_, i) => list[i % list.length].e);
}
/** 표적 하나를 겨눈 화살(관통 없음). 표적이 움직여도 거의 맞도록 빠르고 판정이 조금 넓다. */
function blackcatArrow(game, p, e, dmg, options = {}) {
  const from = rangerOrigin(p, p.forward(new THREE.Vector3()));
  const dir = new THREE.Vector3(e.pos.x - from.x, 0, e.pos.z - from.z);
  if (dir.lengthSq() < 1e-6) dir.copy(p.forward(new THREE.Vector3()));
  dir.normalize();
  const dist = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
  game.spawnProjectile({ pos: from, dir, speed: BLACKCAT_OMEN.speed, radius: BLACKCAT_OMEN.radius, dmg, color: 0xb070ff, size: .45, owner: p, kb: 2, kind: 'slash',
    pierce: false, life: Math.min(1.2, Math.max(BLACKCAT_OMEN.life, (dist + 2) / BLACKCAT_OMEN.speed)), visual: 'arrow', streak: 'omen', ...options });
}
/** fn 실행 동안 center에서 limit m 밖 적을 판정 대상에서 뺀다(hitArea·hitRadius가 spawning 적을 건너뛰는 규칙을 이용, 끝나면 원복). */
function onlyWithin(game, center, limit, fn) {
  const hidden = [];
  for (const e of game.enemies || []) if (!e.spawning && Math.hypot(e.pos.x - center.x, e.pos.z - center.z) >= limit) { e.spawning = true; hidden.push(e); }
  try { return fn(); } finally { for (const e of hidden) e.spawning = false; }
}
const targets = (game, p, max = 6, range = 10) => game.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < range).sort((a, b) => p.distTo(a) - p.distTo(b)).slice(0, max);
const rangerOrigin = (p, dir) => p.def?.weapon === 'bow' && p.arrowOrigin ? p.arrowOrigin(dir) : p.pos.clone().addScaledVector(dir, .9).setY(1.2);
/** 시위를 놓는 순간의 바람 섬광(궁수 VFX 2026-10-29): 활 끝 짧은 빛(조명 풀) + 바람 고리(인스턴스 임팩트 층). 메시를 새로 만들지 않고 판정·난수와 무관하다. */
function rangerRelease(game, pos, color = 0x7feac0, power = 1) {
  game.fx?.light?.(pos, color, 2.5 + power * 2, 5 + power * 2, .16);
  game.fx?.impact?._emit?.(IMPACT_KIND.ring, pos.x, pos.y, pos.z, .9 + power * .5, color, .2, { grow: 1 });
}
function rangerArrows(game, p, dmg, count = 1, options = {}) {
  const f = p.forward(new THREE.Vector3());
  for (let i = 0; i < count; i++) {
    const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - (count - 1) / 2) * .18);
    game.spawnProjectile({ pos: rangerOrigin(p, dir), dir, speed: SKILL_PROJECTILES.ranger.speed, radius: SKILL_PROJECTILES.ranger.radius, dmg, color: 0x7feac0,
      size: .45, owner: p, kb: 3, kind: 'slash', pierce: true, life: SKILL_PROJECTILES.ranger.life, visual: 'arrow', ...options });
  }
  rangerRelease(game, rangerOrigin(p, f), options.color || 0x7feac0, count > 3 ? 1.6 : 1);
  audio.whoosh({ vol: .4, pitch: 1.5, dur: .2 });
}
/** 궁극기 예비 표식: 시전 연출 동안 판정이 늦게 오므로 start 에서 바로 인스턴스 층 표식을 깐다(판정·난수 무관, 동작 줄이기 생략). */
function skillPrelude(game, p, id) {
  const impact = game.fx?.impact, fn = SKILL_PRELUDES[id];
  if (!impactReady(impact) || !fn || game.app?.reducedMotion?.matches || typeof p.forward !== 'function') return;
  try { fn({ fx: game.fx, impact, player: p, at: p.pos, f: p.forward(new THREE.Vector3()), lite: !!game.fx.lite, scale: 1 }); } catch (error) { console.warn('skill prelude', id, error); }
}
/** 암살자 그림자 파동: 노란 shockwave 원화에 보라를 곱하면 갈색이 돼서, 보라 소용돌이 원화(singularity)를 지면에 눕힌다.
 *  shockTex 와 같은 드로우콜 1·같은 밝기 감쇠(decorativeBurstGain)·Math.random 미사용. */
function shadowWave(game, pos, r1, life) {
  const fx = game.fx;
  if (typeof fx.groundTex === 'function') fx.groundTex(pos, 'singularity', 0x9a5cff, { r0: .5, r1, life, spin: .4, y: .1, fadeIn: .05, gain: decorativeBurstGain(r1) * .85 });
  else fx.shockTex?.(pos, 0xb26bff, { r1, life });
}
/** 적이 가장 밀집한 지점 (몹몰이 조준 보정) */
function densest(game, p, range = 11, radius = 3.5) {
  const list = game.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < range);
  if (!list.length) return null;
  let best = null, bestN = -1;
  for (const c of list) { let n = 0; for (const e of list) { const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z; if (dx * dx + dz * dz < radius * radius) n += e.isBoss ? 4 : e.isElite ? 2 : 1; } if (n > bestN) { bestN = n; best = c; } }
  return best ? best.pos.clone() : null;
}

export const SKILL_PROJECTILES = Object.freeze({
  ranger: Object.freeze({ speed: 28, life: .75, radius: .7 }),
  pierce: Object.freeze({ speed: 27, life: .85, radius: .65 }),
  volley: Object.freeze({ speed: 23, life: .8, radius: .8 }),
  holy: Object.freeze({ speed: 22, life: .7, radius: 2 }),
  fire: Object.freeze({ speed: 15, life: 1, radius: 1 }),
});

// 판정의 기준 크기. range는 지점형의 중심 선택 거리, 투사체는 발사점부터의 이동 거리다.
// 연쇄·무작위 다중 타격은 탐색/외곽 범위이며 모든 내부 지점의 적중을 보장하지 않는다.
export const SKILL_AIM_SHAPES = Object.freeze({
  guardian_guard: { kind: 'self', range: 0 },
  guardian_rebuke: { kind: 'self', range: 4, radius: 4 },
  ranger_pierce: { kind: 'line', range: SKILL_PROJECTILES.pierce.speed * SKILL_PROJECTILES.pierce.life, width: .65 * 2, origin: 1 },
  ranger_volley: { kind: 'cone', range: SKILL_PROJECTILES.volley.speed * SKILL_PROJECTILES.volley.life, angle: .48 * 180 / Math.PI, width: 1.6, origin: 1 },
  ranger_retreat: { kind: 'line', range: SKILL_PROJECTILES.ranger.speed * SKILL_PROJECTILES.ranger.life, width: 1.4, origin: 1 },
  ranger_tempest: { kind: 'cone', range: SKILL_PROJECTILES.ranger.speed * SKILL_PROJECTILES.ranger.life, angle: 1.08 * 180 / Math.PI, width: 1.9, origin: 1 },
  ranger_quickshot: { kind: 'line', range: SKILL_PROJECTILES.ranger.speed * SKILL_PROJECTILES.ranger.life, width: 1.4, origin: 1 },
  ranger_binding: { kind: 'cone', range: SKILL_PROJECTILES.ranger.speed * SKILL_PROJECTILES.ranger.life, angle: .72 * 180 / Math.PI, width: 1.4, origin: 1 },
  holy_slash: { kind: 'line', range: SKILL_PROJECTILES.holy.speed * SKILL_PROJECTILES.holy.life, width: 4, origin: 1 },
  shield_bash: { kind: 'circle', range: 1.2, radius: 5 },
  judgment: { kind: 'self', range: 12, radius: 2.2 },
  dragon_slash: { kind: 'cone', range: 7.2, angle: 130, projectileRange: 20 * .8, projectileAngle: .64 * 180 / Math.PI, width: 3, origin: 1.5 },
  whirlwind: { kind: 'self', range: 3.8, radius: 3.8 },
  quake: { kind: 'circle', range: 1.5, radius: 8 },
  berserk: { kind: 'self', range: 0 },
  blood_howl: { kind: 'self', range: 0, radius: WEREWOLF_HOWL.radius },
  moonlit_hunt: { kind: 'self', range: WEREWOLF_HUNT.reach, radius: WEREWOLF_HUNT.moonRadius },
  cat_omen: { kind: 'self', range: BLACKCAT_OMEN.reach, radius: BLACKCAT_OMEN.reach },
  nine_lives: { kind: 'self', range: BLACKCAT_NIGHT.reach, radius: BLACKCAT_NIGHT.reach },
  hell_axe: { kind: 'circle', range: 13, radius: 6 },
  fireball: { kind: 'line', range: SKILL_PROJECTILES.fire.speed * SKILL_PROJECTILES.fire.life, width: 2, radius: 4.2, origin: 1 },
  chain: { kind: 'self', range: 12 },
  blizzard: { kind: 'self', range: 6.8, radius: 6.8 },
  meteor: { kind: 'circle', range: 15, radius: 3.4 + 4.4 },
  shadow_dash: { kind: 'line', range: 28 * (.42 + (1 - Math.pow(.001, .18)) / -Math.log(.001)), width: 5.2 },
  poison_bomb: { kind: 'circle', range: 13, radius: 4.2 },
  flurry: { kind: 'cone', range: 4, angle: 180 },
  thousand: { kind: 'self', range: 8, radius: 1.8 },
  chain_bind: { kind: 'self', range: 12, radius: 7.5 },
  sanctuary: { kind: 'self', range: 8, radius: 8 },
  bull_rush: { kind: 'line', range: 21 * (.55 + (1 - Math.pow(.002, .2)) / -Math.log(.002)), width: 7.2, radius: 6.2, endOffset: 2.4 },
  magma_zone: { kind: 'self', range: 4.6 + 2.9, radius: 6.4 },
  arc_reflect: { kind: 'line', range: 30 * 2.6, width: 3.4, origin: 1.2, radius: 4.5 },
  chrono_seal: { kind: 'self', range: 9.5, radius: 3.8 },
  shadow_mark: { kind: 'self', range: 13, radius: 5.5 },
  void_step: { kind: 'self', range: 18, radius: 7.5 },
  // 파일 끝의 AWAKENING_III 덮어쓰기가 실제 구현이다(2.5 간격 네 지점, 반경 3.2).
  sunbreaker: { kind: 'line', range: 10, width: 6.4, radius: 3.2 },
  heavenfall: { kind: 'circle', range: 15, radius: 8 },
  bloodquake: { kind: 'self', range: 8, radius: 8 },
  cataclysm: { kind: 'circle', range: 2, radius: 9 },
  star_prison: { kind: 'circle', range: 16, radius: 7 },
  absolute_zero: { kind: 'circle', range: 17, radius: 9 },
  night_parade: { kind: 'circle', range: 13, radius: 5 },
  eclipse_edge: { kind: 'circle', range: 16, radius: 8 },
  gale_hunt: { kind: 'cone', range: SKILL_PROJECTILES.ranger.speed * SKILL_PROJECTILES.ranger.life, angle: .36 * 180 / Math.PI, width: 1.8, origin: 1 },
  skyfall_arrows: { kind: 'circle', range: 18, radius: 2.2 + 4.2 },
});
for (const shape of Object.values(SKILL_AIM_SHAPES)) Object.freeze(shape);
export const SKILLS = {
  guardian_guard: {
    dur: .3, total: .4,
    start(game, p) { p.guardT = .75; game.fx.castCircle(p.pos, 0x9fd0ff, { radius: 2.5, life: .75 }); },
    cast() {},
  },
  guardian_rebuke: {
    dur: .6,
    cast(game, p, c) {
      const empowered = (p.jobResource || 0) >= 3;
      if (empowered) p.jobResource = 0;
      game.hitRadius(p.pos, empowered ? 6 : 4, c.dmg * (empowered ? 2 : 1), { kb: 8, stun: 1.2, kind: 'blunt', source: p, dirFrom: p.pos });
      game.fx.shockTex(p.pos, 0x9fd0ff, { r1: empowered ? 7 : 4, life: .5 });
      audio.boom({ vol: .45, dur: .3, low: 90 });
    },
  },
  ranger_pierce: {
    dur: .45,
    cast(game, p, c) {
      const empowered = (p.jobResource || 0) >= 3;
      if (empowered) p.jobResource = 0;
      const dir = p.forward(new THREE.Vector3()), pos = rangerOrigin(p, dir);
      // 별빛 관통(교관): 판정 반경 1.4배, 밀치기 4 → 7.
      const star = hasTownSkillVariant(p, 'ranger_pierce', 'star');
      game.spawnProjectile({ pos, dir, speed: SKILL_PROJECTILES.pierce.speed, radius: (empowered ? 1.3 : SKILL_PROJECTILES.pierce.radius) * (star ? 1.4 : 1), dmg: c.dmg * (empowered ? 2 : 1), color: 0x7feac0, size: .45, owner: p, kb: star ? 7 : 4, kind: 'slash', pierce: true, life: SKILL_PROJECTILES.pierce.life, visual: p.def?.weapon === 'bow' ? 'arrow' : undefined, streak: 'pierce' });
      rangerRelease(game, pos, 0x22e6c4, empowered ? 2.2 : 1.4);
      if (empowered) game.fx?.impact?.mark?.(p.pos, 0x22e6c4, { radius: 1.9, life: .5, style: MARK_STYLE.compass });
      audio.whoosh({ vol: .4, pitch: 1.5, dur: .2 });
    },
  },
  ranger_volley: {
    dur: .65,
    cast(game, p, c) {
      const f = p.forward(new THREE.Vector3());
      const count = hasTownSkillVariant(p, 'ranger_volley', 'extra') ? 4 : 3;
      for (let i = 0; i < count; i++) {
        const offset = i - (count - 1) / 2;
        const dir = f.clone().applyAxisAngle(new THREE.Vector3(0,1,0), offset * .24);
        game.spawnProjectile({ pos: rangerOrigin(p, dir), dir, speed: SKILL_PROJECTILES.volley.speed, radius: SKILL_PROJECTILES.volley.radius, dmg: c.dmg, color: 0x7feac0, size: .35, owner: p, kb: 2, kind: 'slash', pierce: true, slow: 2, life: SKILL_PROJECTILES.volley.life, visual: p.def?.weapon === 'bow' ? 'arrow' : undefined });
      }
      rangerRelease(game, rangerOrigin(p, f), 0x3fe0a0, 1.2);
      audio.whoosh({ vol: .4, pitch: 1.7, dur: .3 });
    },
  },
  ranger_retreat: {
    dur: .7,
    cast(game, p, c) {
      rangerArrows(game, p, c.dmg, 1, { streak: 'retreat' });
      p.vel.copy(p.forward(new THREE.Vector3())).multiplyScalar(-8);
      p.invuln = Math.max(p.invuln || 0, .6); p.gainJobResource(1);
    },
    end(_game, p) { p.vel.set(0, 0, 0); },
  },
  ranger_tempest: {
    dur: 1,
    start(game, p) { skillPrelude(game, p, 'ranger_tempest'); },
    cast(game, p, c) {
      const empowered = (p.jobResource || 0) >= 3;
      if (empowered) p.jobResource = 0;
      game.fx?.impact?.mark?.(p.pos, 0x3fe0a0, { radius: 4.2, life: .7, style: MARK_STYLE.compass });
      rangerArrows(game, p, c.dmg * (empowered ? 1.5 : 1), 7, { radius: .95, kb: 5, size: .58, streak: 'storm' });
    },
  },
  ranger_quickshot: {
    dur: .8,
    cast(game, p, c) {
      rangerArrows(game, p, c.dmg, 1, { streak: 'quick' }); p.gainJobResource(1);
      for (const delay of [.12, .24]) game.after(delay, () => {
        if (game.active && game.player === p && p.alive) rangerArrows(game, p, c.dmg, 1, { streak: 'quick' });
      });
    },
  },
  ranger_binding: {
    dur: .8,
    cast(game, p, c) {
      const empowered = (p.jobResource || 0) >= 3;
      if (empowered) p.jobResource = 0;
      // 뿌리 속박(교관): 둔화 4 → 6초에 0.6초 기절을 더한다.
      const root = hasTownSkillVariant(p, 'ranger_binding', 'root');
      rangerArrows(game, p, c.dmg * (empowered ? 2 : 1), 5, root ? { slow: 6, stun: .6, kb: 1, streak: 'bind' } : { slow: 4, kb: 1, streak: 'bind' });
    },
  },
  // ================= 검성 (성스러운 빛 · 몹몰이 심판) =================
  holy_slash: {
    dur: 0.6,
    // 예비: 발밑 원형 룬 대신 칼 쥔 손으로 빛이 모이는 줄기(sig-knight PRELUDES).
    start(game, p) { knightRetiredDraws(game.fx, KNIGHT_RETIRED_DRAWS.rune); skillPrelude(game, p, 'holy_slash'); },
    cast(game, p, c) {
      const variant = knightSlashVariantForBattle(game, p);
      if (variant === 'pierce') return applyKnightSlashVariant(game, p, c, variant);
      const f = p.forward(new THREE.Vector3()); const spawn = fwd(p, 1); spawn.y = 1.2;
      // 성검 참격: 금빛 바깥 날 + 밝은 금 안쪽 날(흰 날은 블룸과 겹쳐 크림 덩어리가 됐다) + 작은 금빛 성광.
      game.fx.slashSprite(spawn, f, 0xffc23a, { size: 4.2, life: 0.7, speed: 22, tilt: -0.5 });
      game.fx.slashSprite(spawn, f, 0xffcf4a, { size: 3.0, life: 0.55, speed: 24, tilt: -0.5 });
      // 성광 원화(holyBurst)는 칼날 앞에 크림 덩어리를 남겼다. 수평 빛 칼날은 sig-knight 의 긴 광선이 맡는다.
      game.fx.light(spawn, 0xffd060, 9, 12, 0.5);
      audio.bladeWave({ vol: 0.7 }); audio.holy({ vol: 0.3, base: 880, dur: 0.6 });
      game.renderer.shake(0.25); audio.vibe(30);
      game.spawnProjectile({ pos: spawn.clone(), dir: f, speed: SKILL_PROJECTILES.holy.speed, radius: SKILL_PROJECTILES.holy.radius, dmg: c.dmg, color: 0xfff0a0, size: 0, owner: p, kb: 5, kind: 'slash', pierce: true, life: SKILL_PROJECTILES.holy.life, visual: null });
      applyKnightSlashVariant(game, p, c, variant);
      if (hasTownSkillVariant(p, 'holy_slash', 'nova')) game.after(.16, () => game.hitRadius(p.pos, 3.2, c.dmg * .35, { kb: 3, kind: 'slash', source: p, quietStop: true }));
    },
  },
  shield_bash: {
    dur: 0.7,
    start(game, p, c) {
      c.data.gatherCenter = c.data.aimPoint?.clone() || fwd(p, SKILL_AIM_SHAPES.shield_bash.range);
      gatherEnemies(game, c.data.gatherCenter, 7, 22, .25);
      // 예비: 5m 원형 시전진 대신 방패 앞으로 끌려 오는 줄기(몰이)와 방패 별빛(sig-knight PRELUDES).
      // 몰이 지점 표시는 옅은 가는 고리(groundTex)로 남긴다: 파티 손님 화면에 복제되는 위치 신호이고, castCircle 과 같은 호출이라 난수 소비도 같다.
      game.fx.groundTex?.(c.data.gatherCenter, 'circle_gold', 0xff9a18, { r0: 4.3, r1: 5, life: .25, spin: 0, y: .07, fadeIn: .05, hold: 0, gain: .35 });
      skillPrelude(game, p, 'shield_bash');
    },
    update(game, _p, c) { if (!c.cast) gatherEnemies(game, c.data.gatherCenter, 7, 22); },
    cast(game, p, c) {
      const center = c.data.gatherCenter || fwd(p, 1.2);
      // 준비 시간에 실제로 모인 적을 원래 접촉 시점에 강타한다.
      game.hitRadius(center, SKILL_AIM_SHAPES.shield_bash.radius, c.dmg, { kb: 7, kind: 'blunt', stun: 1.4, source: p });
      if (hasTownSkillVariant(p, 'shield_bash', 'aftershock')) game.after(.22, () => game.hitRadius(center, 3.4, c.dmg * .45, { kb: 3, kind: 'blunt', stun: .45, source: p, quietStop: true }));
      // 방패 강타: 크림 폭발 원화(4.5m, 적 키 높이) 대신 바닥을 두 번 때리는 금빛 충격 고리 + 낮은 금빛 임팩트 + 사방 불똥.
      // 바닥 전체를 덮던 금빛 충격 원화 두 겹(6.5m) → 진한 주황 금 한 겹(3.6m). 방패 충격 고리·지면 균열은 sig-knight 서명.
      // 둥근 주황 충격 원화(3.6m)는 영웅 둘레 원으로 읽혀 부채 파동을 가렸다 → 생략. 흰 먼지도 작게(3.5 → 2m).
      knightRetiredDraws(game.fx, KNIGHT_RETIRED_DRAWS.shockTex); game.fx.dustPuff(center, { size: 2 }); game.fx.burst(center.clone().setY(0.5), 0xffa830, { n: 14, speed: 9, size: 0.34, up: .3 });
      game.fx.light(center, 0xffd080, 10, 14, 0.4);
      game.renderer.shake(0.8); game.renderer.punch(1);
      audio.boom({ vol: 0.8, dur: 0.5, low: 70 }); audio.play('hit_plate', { vol: 0.9, rate: 0.8 }); audio.vibe([40, 30, 60]);
    },
  },
  judgment: {
    dur: 1.0, total: 1.5,
    // 예비: 원형 룬 대신 검을 타고 하늘로 솟는 금빛 입자 + 신호 광선(sig-knight PRELUDES).
    start(game, p) { knightRetiredDraws(game.fx, KNIGHT_RETIRED_DRAWS.rune); skillPrelude(game, p, 'judgment'); },
    cast(game, p, c) {
      // 인력의 심판(교관): 표적을 고르기 전에 주변 적을 시전자 쪽으로 끌어온다.
      if (hasTownSkillVariant(p, 'judgment', 'pull')) game.vacuum(p.pos, 12, 18);
      const ts = targets(game, p, 8, 12);
      audio.magic({ vol: 0.4, base: 523, notes: [0, 4, 7, 12, 16], step: 0.06 });
      const pts = ts.length ? ts.map((e) => e.pos.clone()) : [fwd(p, 3)];
      pts.forEach((pt, i) => {
        const delay = i * 0.07;
        // 표적마다 조준 원(예고)이 먼저 잡히고, 하늘 광선은 판정 시각(delay)에 바닥에 닿도록 미리 출발한다.
        game.fx.impact?.mark?.(pt, 0xffb21e, { radius: 1.5, life: delay + .35, style: MARK_STYLE.reticle });
        game.fx.impact?.beam?.(_judgeSky.set(pt.x - .6, 12, pt.z - .4), _judgeDir.set(.6, -12, .4), 12, 0xffc23a, { speed: 160, width: .14, fade: .25, delay: Math.max(0, delay - .075) });
        // 박자 장식: 낙하 직전 하늘의 금 별빛 + 판정 순간 바닥 균열(표적 6개까지, 칸 예산).
        if (i < 6) knightJudgmentStrike(game.fx.impact, pt, delay, i, !!game.fx.lite);
        game.after(delay, () => {
          // Keep all eight hits/particle cues; only the first four get the
          // two-plane pillar so a dense Judgment stays within the render budget.
          // 심판의 빛기둥: 크림(0xfff0c0) 대신 금빛 결, 폭 1.4m. 착지점에는 하늘에서 내리꽂는 얇은 광선과 금빛 고리.
          if (i < 4) game.fx.firePillar(pt, { height: 11, width: 1.4, life: 0.5, color: 0xffc040 });
          game.hitRadius(pt, 2.2, c.dmg, { kb: 2, kind: 'magic', up: true, source: p, quietStop: i > 1 });
          // 성광 원화(holyBurst)는 표적마다 크림 고리를 남겼다 → 생략(난수 소비만 유지). 착지 섬광·균열은 knightJudgmentStrike(인스턴스 층).
          if (i < 5) knightRetiredDraws(game.fx, KNIGHT_RETIRED_DRAWS.holyBurst);
          game.fx.impact?.mark?.(pt, 0xff9a18, { radius: 1.3, life: .4, style: MARK_STYLE.thorn });
          game.fx.burst(pt.clone().setY(0.6), 0xffb040, { n: 12, speed: 7, size: 0.32, up: 1.2 });
          if (i < 3) game.fx.light(pt, 0xffb040, 8, 8, 0.4); // 크림(0xfff0c0) 조명은 바닥을 하얗게 띄웠다 → 금빛
          game.renderer.shake(0.22); audio.holy({ vol: 0.22, base: 659 + i * 40, dur: 0.5 }); audio.thump({ vol: 0.4, freq: 80 });
        });
      });
      game.renderer.flashScreen(0.1, 0xffb040);
    },
  },
  dragon_slash: {
    dur: 1.2, total: 2.1,
    start(game, p, c) {
      // 기 모으기: 큰 금빛 마법진(6m) 대신 작은 진 + 진한 주황 금 기둥(폭 1.6m).
      // 영웅을 덮던 주황 기둥(폭 1.6m)·원형 룬 대신 검에 모이는 빛 두 물결 + 검을 따라 서는 가는 금 기둥 + 벨 부채꼴 예고선(sig-knight PRELUDES).
      knightRetiredDraws(game.fx, KNIGHT_RETIRED_DRAWS.rune + KNIGHT_RETIRED_DRAWS.firePillar); skillPrelude(game, p, 'dragon_slash');
      game.fx.embers(p.pos, 0xffcf5a, { n: 30, radius: 1.5, life: 1.2, rise: 5 });
      audio.magic({ vol: 0.5, base: 330, notes: [0, 7, 12, 19, 24], step: 0.09, type: 'sawtooth' });
      c.data.vac = 0;
    },
    update(game, p, c, dt) {
      c.data.vac -= dt;
      if (c.data.vac <= 0 && c.t < 1.1) {
        c.data.vac = 0.1;
        // 이미 부채꼴 안(130°, 사거리 7.2m)에 든 적은 끌지 않는다: 끌어도 맞는 위치인데 연속 힘으로 정면 표본이 영웅을 지나치거나 겹쳐 빠지는 것을 막는다(몰이 포함 판정 검사).
        const half = THREE.MathUtils.degToRad(SKILL_AIM_SHAPES.dragon_slash.angle) / 2, R = SKILL_AIM_SHAPES.dragon_slash.range;
        for (const e of game.enemies) {
          if (!e.alive || e.spawning) continue;
          const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d2 = dx * dx + dz * dz;
          if (d2 > 144) continue;
          if (d2 < R * R) { let diff = Math.abs(Math.atan2(dx, dz) - p.yaw); diff = Math.min(diff, Math.PI * 2 - diff); if (diff <= half) continue; }
          e.pull(p.pos.x, p.pos.z, 9);
        }
      }
    },
    cast(game, p, c) {
      const f = p.forward(new THREE.Vector3());
      game.hitArea(p, p.pos, p.yaw, SKILL_AIM_SHAPES.dragon_slash.range, SKILL_AIM_SHAPES.dragon_slash.angle, c.dmg, { kb: 10, kind: 'slash', finisher: true, skillCast:c, up: true, source: p });
      // 3중 참격 + 관통 파동
      for (let i = -1; i <= 1; i++) {
        const d = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.32);
        const sp = p.pos.clone().addScaledVector(d, 1.5).setY(1.3);
        game.fx.slashSprite(sp, d, i === 0 ? 0xffc23a : 0xff9a18, { size: 5.5, life: 0.8, speed: 20, tilt: -0.5 + i * 0.25 });
        game.spawnProjectile({ pos: sp.clone(), dir: d, speed: 20, radius: 1.5, dmg: c.dmg * 0.35, color: 0xffe080, size: 0, owner: p, kb: 6, kind: 'slash', pierce: true, life: 0.8, visual: null });
      }
      const hitC = fwd(p, 3.5);
      // 용참 착탄: 크림 폭발(11m)·성광(12m)·화면 섬광 .45 는 화면을 하얗게 덮었다. 진한 금 폭발(6m) + 바닥 충격 2겹 + 금빛 임팩트 + 부채꼴 불똥으로 '앞으로 베어 낸' 방향을 남긴다.
      // 14m 금빛 충격 원화·성광 원화는 바닥을 한 색으로 덮었다. 진한 폭발(5m) + 주황 충격 한 겹(8m). 수직 참격·부채 균열은 sig-knight 서명.
      // 둥근 폭발·충격 원화가 달려 나가는 균열을 덮었다: 폭발 5 → 3.4m, 6m 충격 원화 생략(부채 균열은 서명).
      game.fx.explosion(hitC, { size: 3.4, color: 0xff8a10, life: 0.5 }); knightRetiredDraws(game.fx, KNIGHT_RETIRED_DRAWS.shockTex);
      game.fx.directional(hitC.clone().setY(1), f, 0xffc860, { n: 24, speed: 16, size: 0.45, spread: 1.1 });
      game.fx.dustPuff(hitC, { size: 4 }); game.fx.burst(hitC.setY(1), 0xffa830, { n: 24, speed: 14, size: 0.42, up: 0.8 });
      game.fx.light(fwd(p, 3), 0xffa030, 16, 18, 0.6); // 크림빛 조명 → 진한 금(수직 참격이 크림 기둥으로 번지지 않게)
      game.renderer.shake(1); game.renderer.punch(1.5); game.renderer.flashScreen(0.14, 0xffa030); game.renderer.aberr = 1.2; game.timeCtl.slowmo(0.35, 0.5);
      audio.boom({ vol: 1, dur: 0.9, low: 50 }); audio.bladeWave({ vol: 1 }); audio.holy({ vol: 0.45, base: 523, dur: 1.1 }); audio.vibe([80, 40, 120]);
    },
  },

  // ================= 광전사 (불 · 회전 몹몰이) =================
  whirlwind: {
    dur: 1.6, total: 1.6,
    start(game, p, c) { p.play('2H_Melee_Attack_Spinning', { fade: 0.05, speed: 2.2 }); c.data.tick = .16; p.startTrail(); audio.whoosh({ vol: 0.5, pitch: 0.7, dur: 0.5 }); knightRetiredDraws(game.fx, RETIRED_UUID); }, // 붉은 바닥 마법진 대신 회전 궤적 고리(sig-barbarian whirlwind·barbWhirlTick)
    update(game, p, c, dt) {
      const m = game.input.move; const spd = p.stats.spd * 0.6; p.vel.set(m.x * spd, 0, m.y * spd);
      gatherEnemies(game, p.pos, 5.5, 12); // 첫 접촉 전에 모으고 연타 중 군집을 유지한다.
      c.data.tick -= dt;
      if (c.data.tick <= 0) {
        c.data.tick = .22; const i = c.data.n = (c.data.n || 0) + 1;
        game.hitRadius(p.pos, hasTownSkillVariant(p, 'whirlwind', 'wide') ? 4.8 : 3.8, c.dmg, { kb: 2.5, kind: 'slash', source: p, dirFrom: p.pos, quietStop: i % 2 === 0 });
        game.fx.slashSprite(p.pos.clone().setY(1.1), new THREE.Vector3(Math.sin(i * 1.5), 0, Math.cos(i * 1.5)), 0xe0461a, { size: 3.4, life: 0.2, tilt: -1.45 }); // 4.4m 는 몸을 크림 고리로 덮었다(강화 레인)
        game.fx.burst(p.pos.clone().setY(1), 0xff6a20, { n: 5, speed: 6, size: 0.3 });
        barbWhirlTick(game, p.pos, i); // 광전사: 몸을 감는 불씨 도끼 호(판정 틱과 같은 순간)
        if (i % 3 === 0) game.fx.dustPuff(p.pos, { size: 3, life: 0.5 });
        audio.whoosh({ vol: 0.45, pitch: 0.9 + (i % 4) * 0.06, dur: 0.25 }); game.renderer.shake(0.12);
      }
    },
    end(game, p) { p.stopTrail(); },
  },
  quake: {
    dur: 0.9,
    start(game, p, c) { c.data.gatherCenter = c.data.aimPoint?.clone() || fwd(p, SKILL_AIM_SHAPES.quake.range); gatherEnemies(game, c.data.gatherCenter, 9, 12, .36); },
    update(game, _p, c) { if (!c.cast) gatherEnemies(game, c.data.gatherCenter, 9, 12); },
    cast(game, p, c) {
      const center = c.data.gatherCenter || fwd(p, 1.5);
      game.hitRadius(center, SKILL_AIM_SHAPES.quake.radius, c.dmg, { kb: 9, kind: 'blunt', up: true, stun: 0.8, source: p, dirFrom: center });
      if (hasTownSkillVariant(p, 'quake', 'aftershock')) game.after(.28, () => game.hitRadius(center, 6, c.dmg * .55, { kb: 5, kind: 'blunt', up: true, source: p, dirFrom: center, quietStop: true }));
      // 시각: 13m 까지 퍼지던 충격파 세 겹·크기 8 폭발은 0.5초 뒤 화면 전체를 주황 덩어리로 덮었다(강화 레인). 충격 한 겹·작은 폭발로 줄이고 모양은 전방 균열 서명이 맡는다.
      [0, 0.08, 0.16].forEach((d, i) => game.after(d, () => { if (i === 0) game.fx.shockTex(center, 0xff7a2a, { r1: 4.5, life: 0.4 }); else knightRetiredDraws(game.fx, RETIRED_UUID); game.renderer.shake(0.5); audio.thump({ vol: 0.8, freq: 55 - i * 8, dur: 0.3 }); }));
      game.fx.explosion(center, { size: 2.4, color: 0xff7a30, life: 0.4 });
      game.fx.scorch(center, { radius: 4.5, life: 5 }); game.fx.dustPuff(center, { size: 4, life: 0.9 });
      game.fx.burst(center.clone().setY(0.4), 0xff8040, { n: 20, speed: 12, size: 0.4, up: 1.5, grav: 20 }); knightRetiredDraws(game.fx, burstDraws(game.fx, 40) - burstDraws(game.fx, 20));
      game.fx.light(center, 0xff8040, 8, 10, 0.4);
      game.renderer.shake(1); game.renderer.punch(1.2); game.renderer.flashScreen(0.12, 0xffa060);
      audio.boom({ vol: 1, dur: 0.8, low: 45 }); audio.play('hit_mining', { vol: 1, rate: 0.7 }); audio.vibe([60, 30, 90]);
    },
  },
  berserk: {
    dur: 0.8,
    cast(game, p, c) {
      p.buffs.atk = 1.6; p.buffs.atkSpd = 1.3; p.buffs.spd = 1.2; p.buffs.t = 8; p.tintEmissive = new THREE.Color(0.35, 0.02, 0.02);
      // 시각: 바닥 붉은 마법진·7m 충격파 대신 몸에서 솟는 기둥(불기둥 + 서명의 나선·불꽃 혀)으로 읽힌다(강화 레인).
      knightRetiredDraws(game.fx, RETIRED_UUID); // 뺀 castCircle
      game.fx.firePillar(p.pos, { height: 7, width: 1.8, life: 0.9, color: 0xff4a20 });
      knightRetiredDraws(game.fx, RETIRED_UUID); // 뺀 7m shockTex
      game.fx.embers(p.pos, 0xff4040, { n: 40, radius: 1.5, life: 1.5, rise: 4 });
      game.fx.light(p.pos, 0xff2020, 12, 12, 0.8);
      game.renderer.flashScreen(0.2, 0xff2020); game.renderer.shake(0.5); game.renderer.aberr = 0.8;
      audio.boom({ vol: 0.6, dur: 0.6, low: 80 }); audio.dark({ vol: 0.55, base: 160, dur: 0.9 }); audio.vibe([50, 50, 50, 50, 100]);
      game.ui.toast('광폭화! 공격력 +60%', 'red');
    },
  },
  hell_axe: {
    dur: 1.0, total: 2.4,
    start(game, p, c) { skillPrelude(game, p, 'hell_axe'); audio.fire({ vol: 0.5, dur: 1.2 }); audio.magic({ vol: 0.5, base: 196, notes: [0, 5, 7, 12], step: 0.12, type: 'sawtooth' }); knightRetiredDraws(game.fx, RETIRED_UUID); game.fx.embers(p.pos, 0xff5020, { n: 20, radius: 2, life: 1.2, rise: 6 }); knightRetiredDraws(game.fx, embersDraws(game.fx, 30) - embersDraws(game.fx, 20)); }, // 예비 모으기는 서명 서곡(PRELUDES.hell_axe)
    cast(game, p, c) {
      const target = c.data.aimPoint?.clone() || densest(game, p, SKILL_AIM_SHAPES.hell_axe.range, 4) || fwd(p, 4);
      c.data.target = target;
      const orb = game.fx.orb(0xff5a20, 1.4); orb.position.copy(target).setY(16); game.scene.add(orb);
      knightRetiredDraws(game.fx, RETIRED_UUID); // 뺀 8m castCircle
      const fall = 0.5; // 착탄 조준은 서명의 금빛 나침 표식(8m 붉은 마법진 대신)
      game.fx.add(orb, fall, (k) => { orb.position.y = 16 * (1 - k * k); orb.children[1].scale.setScalar(Math.min(4.5, 2.6 * (1 + k))); /* 시각: 14m 후광은 카메라 가까이서 화면을 주황으로 덮었다 */ game.fx.embers(orb.position, 0xff7a30, { n: 3, radius: 0.5, life: 0.5, rise: -2 }); });
      // 낙하 중 진공
      let vt = 0; game.fx.add(new THREE.Object3D(), fall, (k, t, dt) => { vt -= dt; if (vt <= 0) { vt = 0.08; game.vacuum(target, 7.5, 12); } });
      game.after(fall, () => {
        game.hitRadius(target, SKILL_AIM_SHAPES.hell_axe.radius, c.dmg, { kb: 10, kind: 'blunt', up: true, stun: .7, source: p, dirFrom: target });
        game.fx.explosion(target, { size: 6, color: 0xff7a30, life: 0.6 }); // 시각: 크기 14 폭발은 화면을 크림 덩어리로 덮었다
        game.fx.firePillar(target, { height: 12, width: 3.4, life: 0.7, color: 0xff4a1a }); // 광전사: 착탄 불기둥
        game.fx.scorch(target, { radius: 6, life: 8 });
        // 충격파는 첫 박 하나만(3박 사방 균열은 서명이 그린다). 원래 세 박의 예약 시각·난수 소비는 유지한다.
        [0, 0.1, 0.2].forEach((d, i) => game.after(d, () => { if (i === 0) game.fx.shockTex(target, 0xff6a20, { r1: 7, life: 0.5 }); else knightRetiredDraws(game.fx, RETIRED_UUID); }));
        game.fx.burst(target.clone().setY(0.5), 0xff7a20, { n: 30, speed: 16, size: 0.5, up: 1.4, grav: 18 }); knightRetiredDraws(game.fx, burstDraws(game.fx, 70) - burstDraws(game.fx, 30));
        game.fx.dustPuff(target, { size: 6, life: 1.2 }); game.fx.embers(target, 0xff6020, { n: 30, radius: 5, life: 1.8, rise: 4 }); knightRetiredDraws(game.fx, embersDraws(game.fx, 60) - embersDraws(game.fx, 30));
        game.fx.light(target, 0xff6020, 9, 12, 0.6); // 시각: 20/22m 조명은 바닥 전체를 주황으로 물들였다
        game.renderer.shake(1); game.renderer.punch(1.6); game.renderer.flashScreen(0.22, 0xffa060); game.renderer.aberr = 1.2; game.timeCtl.slowmo(0.3, 0.6);
        audio.boom({ vol: 1, dur: 1.2, low: 40 }); audio.play('hit_mining', { vol: 1, rate: 0.5 }); audio.fire({ vol: 0.5, dur: 1.5 }); audio.vibe([100, 50, 150]);
      });
    },
  },

  // ================= 대마도사 (원소 · 광역 몹몰이) =================
  fireball: {
    dur: 0.6,
    // 시전 원·발사 섬광·탄 후광의 밝은 주황(0xff7a20·0xff9a40)이 블룸에서 크림 번짐이 됐다(h1b): 진홍 쪽 주황으로 낮추고 발사 섬광은 작게.
    // 발밑 옅은 원판(abilitySignature·2.4m 시전 원)이 '영웅 둘레 원'으로만 읽혀, 작게 줄이고 손끝으로 모이는 불꽃(mageCharge)을 더한다.
    // 공용 fx 호출 자체는 남긴다(재질 생성의 Math.random 소비 순서 = 시드 전투 결정성 보존).
    start(game, p, c) { game.fx.castCircle(p.pos, 0xe8401a, { radius: 1.4, life: 0.4 }); game.fx.abilitySignature?.(p.pos, 'fire', { scale: 0.35, life: 0.3 }); mageCharge(game, p, 'fire', 0.6 * (c?.sk?.castAt ?? 0.35)); },
    cast(game, p, c) {
      const f = p.forward(new THREE.Vector3()); const sp = fwd(p, 1); sp.y = 1.4;
      const split = hasTownSkillVariant(p, 'fireball', 'split');
      game.spawnProjectile({ pos: sp, dir: f, speed: SKILL_PROJECTILES.fire.speed, radius: SKILL_PROJECTILES.fire.radius, dmg: c.dmg, color: 0xff4a12, size: 0.9, owner: p, kb: 5, kind: 'magic', life: SKILL_PROJECTILES.fire.life, trail: 0xff4a12, explode: { radius: split ? 5.2 : 4.2, color: 0xff7a20, profile: 'fire' } });
      if (split) for (const angle of [-.22, .22]) game.spawnProjectile({ pos: sp.clone(), dir: f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle), speed: 15, radius: .55, dmg: c.dmg * .35, color: 0xffb040, size: .45, owner: p, kb: 3, kind: 'magic', life: .8, trail: 0xffa040 });
      game.fx.flash(sp, 0xff4a12, { size: 1.3, life: 0.1 }); audio.fire({ vol: 0.5, dur: 0.5 }); audio.whoosh({ vol: 0.4, pitch: 0.6, dur: 0.4 });
    },
  },
  chain: {
    dur: 0.9,
    // 발밑 청색 원판은 작게(호출은 유지: 난수 소비 순서 보존) + 들어 올린 손끝으로 모이는 전하(mageCharge).
    start(game, p, c) { game.fx.castCircle(p.pos, 0x3a8cff, { radius: 1.6, life: 0.6, demon: true }); game.fx.abilitySignature?.(p.pos, 'arcane', { scale: 0.35, life: 0.3 }); mageCharge(game, p, 'bolt', 0.9 * (c?.sk?.castAt ?? 0.45)); },
    cast(game, p, c) {
      let from = p.pos.clone().setY(1.6); let cur = p; const hit = new Set(); const chainN = 10;
      let step = 0;
      const next = () => {
        let best = null, bd = step === 0 ? 12 : 7;
        for (const e of game.enemies) { if (!e.alive || e.spawning || hit.has(e)) continue; const d = Math.hypot(e.pos.x - cur.pos.x, e.pos.z - cur.pos.z); if (d < bd) { bd = d; best = e; } }
        if (!best) return;
        hit.add(best); const to = best.pos.clone().setY(1.2);
        game.fx.boltTex(from, to, 0x4a90ff, { width: 1.8, life: 0.28 }); mageBolt(game, from, to, step); // 번개 학파: 굵은 청색 지그재그 + 전기 별빛
        // 맞은 적 몸을 덮던 2.4m 섬광·바닥 원판은 작게(적 몸·피해 숫자 가독성). 호출 수는 유지(난수 소비 순서 보존).
        game.fx.flash(to, 0x4a90ff, { size: 1.3 }); game.fx.burst(to, 0x6fbcff, { n: 10, speed: 7, size: 0.3 }); game.fx.abilitySignature?.(to, 'arcane', { scale: 0.35, life: 0.2 });
        if (step < 4) game.fx.light(to, 0x80c0ff, 8, 8, 0.3);
        game.damageEnemy(best, c.dmg * (1 - step * 0.05), { kind: 'magic', kb: 1, stun: hasTownSkillVariant(p, 'chain', 'bind') ? .8 : .4, source: p, dirx: to.x - from.x, dirz: to.z - from.z, quietStop: step > 2 });
        audio.zap({ vol: 0.4, dur: 0.22 }); game.renderer.shake(0.15); if (step < 2) audio.vibe(20);
        from = to; cur = best; step++;
        if (step < chainN) game.after(0.055, next);
      };
      next(); game.renderer.flashScreen(0.3, 0xa0e0ff);
    },
  },
  blizzard: {
    dur: 1.0, total: 3.4,
    start(game, p, c) { c.data.tick = 0.3; audio.magic({ vol: 0.4, base: 587, notes: [0, 3, 7, 10, 14], step: 0.07 }); /* 6.8m 시전 원(3.2초)·서리 원판은 옅은 청색 큰 원으로만 읽혀 짧고 어둡게: 판정 반경은 mageFrostTick 의 얇은 조준 원, 폭풍은 소용돌이·결정이 맡는다. 호출은 유지(난수 순서). */ game.fx.castCircle(p.pos, 0x1650c8, { radius: 6.8, life: 0.5 }); game.fx.abilitySignature?.(p.pos, 'frost', { scale: .35, life: 0.4, heavy: true }); },
    update(game, p, c, dt) {
      const m = game.input.move; const spd = p.stats.spd * 0.5; p.vel.set(m.x * spd, 0, m.y * spd);
      if (c.t > 0.6 && p.actionName !== 'Spellcasting') p.play('Spellcasting', { fade: 0.2 });
      const wide = hasTownSkillVariant(p, 'blizzard', 'wide');
      gatherEnemies(game, p.pos, wide ? 10.5 : 8.5, 9);
      for (let i = 0; i < (game.fx.lite ? 2 : 5); i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 6.5; game.fx.glow.emit(p.pos.x + Math.cos(a) * r, 5 + Math.random() * 3, p.pos.z + Math.sin(a) * r, 0, -14, 0, _blizzardFlake, 0.24, 0.5, { grav: 20, shrink: 0.5 }); }
      c.data.tick -= dt;
      if (c.data.tick <= 0) {
        c.data.tick = 0.4; const i = c.data.n = (c.data.n || 0) + 1;
        game.hitRadius(p.pos, wide ? 8.6 : 6.8, c.dmg, { kb: 0.5, kind: 'magic', slow: 1.2, source: p, dirFrom: p.pos, quietStop: true });
        // 틱마다의 7.5m 충격 원판·서리 원판은 옅은 큰 원이라 작고 어둡게(호출은 유지: 난수 순서).
        game.fx.shockTex(p.pos, 0x1650c8, { r1: 3.2, life: 0.3 }); game.fx.abilitySignature?.(p.pos, 'frost', { scale: 0.35, life: 0.24 });
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 4;
        game.fx.iceBurst(p.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), { size: 2.2, life: 0.45, color: 0x1f6fe8 });
        game.fx.burst(p.pos.clone().setY(0.3), 0x2a84ff, { n: 20, speed: 8, size: 0.3, up: 0.6, spread: 0.6 });
        mageFrostTick(game, p.pos, i, wide ? 8.6 : 6.8); // 냉기 학파: 서리 가시 고리·얼음 가시
        audio.ice({ vol: 0.45, dur: 0.5 }); audio.whoosh({ vol: 0.28, pitch: 1.5, dur: 0.4 }); game.renderer.shake(0.15);
      }
    },
  },
  meteor: {
    dur: 1.0, total: 3.0,
    start(game, p, c) { audio.magic({ vol: 0.5, base: 261, notes: [0, 7, 12, 19, 24, 31], step: 0.1, type: 'sawtooth' }); game.fx.castCircle(p.pos, 0xff9a40, { radius: 3.6, life: 1.0, demon: true }); game.fx.firePillar(p.pos, { height: 8, width: 2, life: 0.9, color: 0xff9a40 }); game.fx.abilitySignature?.(p.pos, 'fire', { scale: 1.0, life: 0.78, heavy: true }); skillPrelude(game, p, 'meteor'); },
    cast(game, p, c) {
      const focus = c.data.aimPoint?.clone() || densest(game, p, SKILL_AIM_SHAPES.meteor.range, 5) || fwd(p, 4);
      const pts = [];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + Math.random(); const r = i === 0 ? 0 : 1.2 + Math.random() * 3.2; pts.push(focus.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r))); }
      pts.forEach((pt, i) => game.after(i * 0.19, () => {
        const orb = game.fx.orb(0xff6a20, 1.3); const start = pt.clone().add(new THREE.Vector3(4.5, 6.5, 1.2));
        // 표시 전용 출발점: 18m 위는 화면 밖이라 궤적이 안 보였다 — 화면 안 대각선 낙하
        orb.position.copy(start); game.scene.add(orb);
        mageMeteorFall(game, start, pt, 0.4); // 화염 학파: 불의 궤적 → 판정 순간 폭발
        // 착탄 예고 원: 다섯 발의 4m 주황 원이 겹쳐 바닥 전체가 크림 번짐이 됐다 — 작고 진한 진홍(호출은 유지: 난수 순서).
        game.fx.castCircle(pt, 0xd8261a, { radius: 2.4, life: 0.45, demon: true });
        game.fx.add(orb, 0.4, (k) => { orb.position.lerpVectors(start, pt, k * k); game.fx.embers(orb.position, 0xff8a30, { n: 3, radius: 0.4, life: 0.5, rise: 1 }); });
        game.after(0.4, () => {
          game.vacuum(pt, 6, 8);
          game.hitRadius(pt, 3.4, c.dmg, { kb: 6, kind: 'magic', up: true, source: p, dirFrom: pt, quietStop: i > 1 });
          game.fx.abilitySignature?.(pt, 'fire', { scale: 1.05, life: 0.56, heavy: i === 0 });
          game.fx.dustPuff(pt, { size: 5 }); game.fx.scorch(pt, { radius: 3.2, life: 6 });
          game.renderer.shake(0.7); game.renderer.punch(0.6); if (i === 0) game.renderer.flashScreen(0.3, 0xffa060);
          audio.boom({ vol: 0.85, dur: 0.7, low: 50 }); audio.vibe([50, 20, 50]);
        });
      }));
      game.after(1.7, () => game.timeCtl.slowmo(0.4, 0.4));
    },
  },

  // ================= 암살자 (그림자 · 관통 몹몰이) =================
  shadow_dash: {
    dur: 0.6, total: 0.6,
    start(game, p, c) {
      const t = c.data.aimPoint || densest(game, p, 13, 3.5); if (t) p.face(t.x, t.z);
      const f = p.forward(new THREE.Vector3()); p.vel.copy(f).multiplyScalar(28); p.invuln = 0.6; c.data.hit = new Set(); c.data.g = 0;
      audio.whoosh({ vol: 0.7, pitch: 0.5, dur: 0.5 }); game.fx.dustPuff(p.pos, { size: 2.5, life: 0.5 }); game.fx.flash(p.pos.clone().setY(1), 0xb26bff, { size: 2.2 });
      game.fx.abilitySignature?.(p.pos, 'void', { scale: 0.55, life: 0.38 });
      game.renderer.aberr = 0.9; game.renderer.radial = 0.4; audio.vibe(30);
    },
    update(game, p, c, dt) {
      c.data.g += dt; if (c.data.g > 0.035) { c.data.g = 0; game.fx.ghost(p.model, 0x6a2cff, { life: 0.35, opacity: 0.7 }); game.fx.embers(p.pos, 0xb26bff, { n: 3, radius: 0.5, life: 0.5 }); }
      for (const e of game.enemies) { if (!e.alive || c.data.hit.has(e)) continue; if (p.distTo(e) < 2.6) { c.data.hit.add(e); game.damageEnemy(e, c.dmg, { kind: 'slash', kb: 2, stun: 0.5, source: p, dirx: p.vel.x, dirz: p.vel.z, quietStop: c.data.hit.size > 2 }); game.fx.slashSprite(e.pos.clone().setY(1.1), p.forward(new THREE.Vector3()), 0x7030ff, { size: 3, life: 0.22, tilt: -1.2 }); rogueXCut(game.fx.impact, e.pos, p.vel); } }
      if (c.t > 0.42) p.vel.multiplyScalar(Math.pow(0.001, dt));
    },
    end(game, p, c) { p.vel.set(0, 0, 0); game.fx.slashSprite(p.pos.clone().setY(1.1), p.forward(new THREE.Vector3()), 0x7030ff, { size: 4.5, life: 0.3, tilt: -1.4 }); shadowWave(game, p.pos, 4, 0.3); game.fx.abilitySignature?.(p.pos, 'void', { scale: 0.85, life: 0.42, heavy: true }); audio.whoosh({ vol: 0.5, pitch: 1.4, dur: 0.2 }); },
  },
  poison_bomb: {
    dur: 0.8, total: 0.8,
    cast(game, p, c) {
      const target = c.data.aimPoint?.clone() || densest(game, p, SKILL_AIM_SHAPES.poison_bomb.range, 3.5) || fwd(p, 5);
      const orb = game.fx.orb(0x60ff80, 0.6); const start = p.pos.clone().setY(1.5); game.scene.add(orb);
      const fl = 0.5;
      game.fx.add(orb, fl, (k) => { orb.position.lerpVectors(start, target, k); orb.position.y = 1.5 + Math.sin(k * Math.PI) * 4; });
      audio.whoosh({ vol: 0.3, pitch: 1.5, dur: 0.3 });
      game.after(fl, () => {
        audio.play('hit_glass', { vol: 0.7, rate: 0.8 }); audio.fire({ vol: 0.3, dur: 0.8 });
        game.fx.abilitySignature?.(target, 'nature', { scale: 0.55, life: 0.58, heavy: true });
        game.fx.castCircle(target, 0x2a9a3c, { radius: 4.5, life: 4.2, demon: true });
        let ticks = 9; const tick = () => {
          if (ticks-- <= 0) return;
          const radius = hasTownSkillVariant(p, 'poison_bomb', 'wide') ? 5.4 : 4.2;
          game.vacuum(target, radius, 3);
          game.hitRadius(target, radius, c.dmg, { kb: 0, kind: 'magic', poison: true, source: p, dirFrom: target, quiet: true });
          for (let i = 0; i < (game.fx.lite ? 4 : 9); i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 4; game.fx.smoke.emit(target.x + Math.cos(a) * r, 0.3, target.z + Math.sin(a) * r, 0, 0.8, 0, new THREE.Color(0x3aa050), 2.4, 1.2, { grav: -0.4, drag: 0.95, shrink: 1.6 }); }
          game.fx.embers(target, 0x4fc23a, { n: 6, radius: 3, life: 0.9, rise: 1.5 });
          game.after(0.45, tick);
        }; tick();
      });
    },
  },
  flurry: {
    dur: 1.4, total: 1.4,
    start(game, p, c) { c.data.tick = 0; c.data.n = 0; p.startTrail(); game.fx.castCircle(p.pos, 0x6a2cff, { radius: 3, life: 1.3, demon: true }); const e = c.data.aimPoint ? null : p.nearestEnemy(9); if (e) { p.face(e.pos.x, e.pos.z); if (p.distTo(e) > 2.2) p.vel.copy(p.forward(new THREE.Vector3())).multiplyScalar((p.distTo(e) - 1.8) / 0.3); } },
    update(game, p, c, dt) {
      if (c.t > 0.3) p.vel.set(0, 0, 0);
      game.vacuum(p.pos, 4.5, 6);
      c.data.tick -= dt;
      if (c.data.tick <= 0 && c.data.n < 10) {
        c.data.tick = 0.115; const i = c.data.n++;
        const anims = ['Dualwield_Melee_Attack_Stab', 'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Chop']; p.playTimed(anims[i % 3], 0.24, { fade: 0.03 });
        game.hitArea(p, p.pos, p.yaw, 3.4, 150, c.dmg, { kb: 0.6, kind: 'slash', source: p, quietStop: true });
        game.fx.slashSprite(p.pos.clone().setY(0.9 + (i % 3) * 0.35), p.forward(new THREE.Vector3()), 0x5a20d0, { size: 2.5, life: 0.18, tilt: (i % 2 ? 0.6 : -1.6), flip: i % 2 === 1 });
        if (i % 2 === 0) game.fx.ghost(p.model, i % 4 ? 0x6a2cff : 0xb26bff, { life: 0.25, opacity: 0.5 });
        audio.whoosh({ vol: 0.32, pitch: 1.3 + i * 0.07, dur: 0.12 });
        if (i === 9) { game.hitArea(p, p.pos, p.yaw, 4, 180, c.dmg * 2.5, { kb: 6, kind: 'slash', finisher: true, skillCast:c, source: p }); game.fx.explosion(fwd(p, 1.5), { size: 5, color: 0x8a3cff, life: 0.4, opacity: .55 }); shadowWave(game, p.pos, 5, 0.4); game.renderer.shake(0.5); }
      }
    },
    end(game, p, c) {
      p.stopTrail();
      // 그림자 잔향(교관): 난무가 끝나는 순간 잔상이 한 번 더 찌른다. 프레임 간격과 무관하게 항상 1회.
      if (game.active && p.alive && hasTownSkillVariant(p, 'flurry', 'echo')) game.hitArea(p, p.pos, p.yaw, 3.8, 120, c.dmg * 1.5, { kb: 3, kind: 'slash', source: p });
    },
  },
  thousand: {
    dur: 1.0, total: 3.0,
    start(game, p, c) { skillPrelude(game, p, 'thousand'); audio.magic({ vol: 0.5, base: 293, notes: [0, 3, 7, 10, 12, 15, 19], step: 0.08, type: 'triangle' }); game.fx.castCircle(p.pos, 0xb26bff, { radius: 7, life: 1.0, demon: true }); game.fx.firePillar(p.pos, { height: 9, width: 2.2, life: 1.0, color: 0xb26bff }); game.fx.embers(p.pos, 0x9a4cff, { n: 40, radius: 1.5, life: 1.4, rise: 6 }); game.renderer.flashScreen?.(0.18, 0x2a0a60); },
    cast(game, p, c) {
      let wave = 0;
      const tick = () => {
        if (wave++ >= 8) { shadowWave(game, p.pos, 15, 0.8); game.fx.explosion(p.pos, { size: 10, color: 0x7a2cff, life: 0.6, opacity: .5 }); game.renderer.shake(0.8); game.timeCtl.slowmo(0.35, 0.5); audio.boom({ vol: 0.7, dur: 0.7 }); return; }
        game.vacuum(p.pos, 8, 5);
        const ts = targets(game, p, 3, 8); const pts = ts.length ? ts.map((e) => e.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5))) : [fwd(p, 3 + Math.random() * 3)];
        for (const pt of pts) {
          const dir = new THREE.Vector3(0.15, -1, 0.1).normalize(); const sp = pt.clone().add(new THREE.Vector3(-1.2, 8, -0.8));
          game.fx.slashSprite(sp, dir, 0x7030ff, { size: 2.2, life: 0.16, speed: 52, tilt: 0 });
          game.after(0.13, () => { game.hitRadius(pt, 1.8, c.dmg, { kb: 1.2, kind: 'slash', source: p, dirFrom: pt, quietStop: true }); game.fx.burst(pt.clone().setY(0.4), 0xa060ff, { n: 8, speed: 7, size: 0.3 }); game.fx.impact?.burst?.(pt.clone().setY(0.6), 0xb466ff, { size: 1.1 }); shadowWave(game, pt, 2.4, 0.28); audio.clang({ vol: 0.32, freq: 2600, dur: 0.25 }); game.renderer.shake(0.12); });
        }
        audio.whoosh({ vol: 0.28, pitch: 1.6, dur: 0.15 });
        game.after(0.15, tick);
      }; tick();
      game.renderer.flashScreen(0.22, 0x5a20c0); game.renderer.aberr = 1;
    },
  },
  // ================================================================
  // 각성 스킬 — 레벨 구간 해금 (Lv.10 / Lv.20)
  // 규칙: 각성기는 기존 스킬에 없는 '새 동사' 를 하나씩 가진다.
  //   결박 / 경계장판 / 밀어모으기 / 순차분출+균열 / 반사투사체 / 시간정지 / 분신표식 / 순간이동연쇄
  // ================================================================

  // ── 검성 Lv.10 : 결박 (끌어와 묶고, 사슬이 끊기며 터진다) ──
  chain_bind: {
    dur: 0.85,
    start(game, p, c) {
      knightRune(game, p.pos, 2, 0.85);
      audio.magic({ vol: 0.4, base: 440, notes: [0, 5, 9, 12], step: 0.05 });
      c.data.bound = [];
    },
    cast(game, p, c) {
      const ts = targets(game, p, 8, 12);
      c.data.bound = ts;
      game.vacuum(p.pos, 12, 30);
      ts.forEach((e, i) => game.after(i * 0.045, () => {
        if (!e.alive) return;
        knightChain(game, _chainFrom.copy(p.pos).setY(1.5), e.pos.clone().setY(1.0), { life: 0.75, width: .26 });
        // 묶인 적 발밑: 금빛 마법진 대신 사슬 가시 고리(인스턴스 층).
        game.fx.impact?.mark?.(e.pos, 0xff8a10, { radius: 1, life: 1.9, style: MARK_STYLE.thorn, angle: i });
        e.stun = Math.max(e.stun, 2.0 * (e.isBoss ? 0.35 : 1));
        game.damageEnemy(e, c.dmg * 0.45, { kind: 'magic', kb: 0, source: p, quietStop: i > 1 });
        audio.clang({ vol: 0.28, freq: 1700 + i * 130, dur: 0.22 });
      }));
      game.renderer.shake(0.35); audio.vibe([20, 20, 40]);
      // 결박 유지 — 사슬이 1.4초간 계속 조인다
      let n = 12;
      const hold = () => {
        if (n-- <= 0 || !game.active) return;
        game.vacuum(p.pos, 12, 11);
        for (const e of c.data.bound) if (e.alive) { e.stun = Math.max(e.stun, 0.45); if (n % 3 === 0) knightChain(game, _chainFrom.copy(p.pos).setY(1.5), e.pos.clone().setY(1.0), { life: 0.36, width: .12 }); }
        game.after(0.12, hold);
      }; game.after(0.25, hold);
      // 사슬 파열
      game.after(1.75, () => {
        if (!game.active) return;
        const center = p.pos.clone();
        for (const e of c.data.bound) if (e.alive) knightChain(game, _chainFrom.copy(center).setY(1.4), e.pos.clone().setY(1), { life: 0.22, width: .13 });
        game.hitRadius(center, 7.5, c.dmg, { kb: 10, kind: 'magic', up: true, source: p, dirFrom: center });
        // 사슬 파열: 크림 성광(9m) 대신 주황 금 충격 한 겹 + 서명의 퍼지는 고리.
        game.fx.shockTex(center, 0xff9a20, { r1: 7.5, life: 0.5 });
        game.fx.burst(center.clone().setY(0.8), 0xffa830, { n: 30, speed: 13, size: 0.4, up: 1.1 });
        game.fx.light(center, 0xffd060, 15, 16, 0.5);
        game.renderer.shake(0.8); game.renderer.punch(1); game.renderer.flashScreen(0.1, 0xffa030);
        audio.boom({ vol: 0.9, dur: 0.7, low: 60 }); audio.holy({ vol: 0.4, base: 660, dur: 0.8 }); audio.vibe([60, 30, 90]);
      });
    },
  },

  // ── 검성 Lv.20 : 성역 (경계 밖으로 못 나간다 + 내 피해 감소) ──
  sanctuary: {
    dur: 1.0,
    // 준비 마법진은 낮은 밝기(.55)로: 성역 경계가 나타나기 전부터 금빛이 바닥을 다 덮지 않게 한다.
    start(game, p) { game.fx.groundTex(p.pos, 'circle_gold', 0xffb21e, { r0: 1.2, r1: 3, life: 1.0, spin: 1.6, y: 0.07, fadeIn: 0.2, hold: 0.35, gain: .5 }); audio.magic({ vol: 0.45, base: 523, notes: [0, 4, 7, 12], step: 0.08 }); },
    cast(game, p, c) {
      const center = p.pos.clone().setY(0); const R = 8.0, LIFE = 7.0;
      p.dr = 0.35; p.drT = LIFE; p.sanctum = { pos: center, r: R };
      // 지면 성역: 옅은 회전 룬(밝기 .38) + 얇은 경계 원과 가는 빛기둥 8개(차례로 솟음, 드로우콜 2). 예전 마법진 2장 + 불기둥 16장 + 화면 섬광은 시전 순간 화면을 금빛으로 덮었다.
      // 7초 내내 바닥 전체(7.5m)를 덮던 금빛 룬 원화와 화면 섬광을 뺐다. 경계 원·빛기둥(sanctum) + 서명 문양만 남는다.
      game.fx.sanctum?.(center, { radius: R, life: LIFE, color: 0xff9a10 });
      game.fx.light(center, 0xffb040, 5, 12, 0.5);
      game.renderer.shake(0.4);
      audio.holy({ vol: 0.5, base: 523, dur: 1.4 }); audio.boom({ vol: 0.5, dur: 0.5, low: 80 }); audio.vibe([40, 30, 60]);
      let t = 0, ticks = Math.round(LIFE / 0.5);
      const tick = () => {
        if (ticks-- <= 0 || !game.active) { p.sanctum = null; p.dr = 0; p.drT = 0; return; }
        t += 0.5;
        // 경계: 밖으로 나가려는 적을 안으로 밀어 넣는다 (진공이 아니라 '벽')
        for (const e of game.enemies) {
          if (!e.alive || e.spawning) continue;
          const dx = e.pos.x - center.x, dz = e.pos.z - center.z, d = Math.hypot(dx, dz);
          // 경계에 막힌 적: 크림 스프라이트 대신 작은 금빛 고리(인스턴스 층). 난수 소비 횟수는 그대로다.
          if (d > R - 1.2 && d < R + 3.5) { e.pull(center.x, center.z, 16); if (Math.random() < 0.4) game.fx.impact?.burst?.(e.pos.clone().setY(1.1), 0xffc23a, { size: .7 }); }
        }
        game.hitRadius(center, R, c.dmg, { kb: 0, kind: 'magic', source: p, dirFrom: center, quiet: true });
        const a = Math.random() * Math.PI * 2, r = Math.random() * R;
        // 성역 안 맥동: 큰 성광 섬광(3m) 대신 바닥의 작은 금빛 별빛 한 점.
        game.fx.impact?.burst?.(center.clone().add(new THREE.Vector3(Math.cos(a) * r, .4, Math.sin(a) * r)), 0xffc23a, { size: 1 });
        game.fx.embers(center, 0xffb040, { n: 6, radius: R * 0.8, life: 1.2, rise: 3 });
        audio.holy({ vol: 0.14, base: 784, dur: 0.4 });
        game.after(0.5, tick);
      }; tick();
      game.ui.toast('성역 전개 — 받는 피해 35% 감소', 'gold');
    },
  },

  // ================= 늑대인간 족장 (광전사 몸 · 핏빛 달 사냥) =================
  // 핏빛 포효: 주변 적을 공포(기절)에 빠뜨리고 짧은 충격 피해, 7초간 사냥 본능(공격력·공격속도·이동속도 + 처치마다 체력 2% 회복).
  // 광폭화(+60%/8초, 회복 없음)보다 공격력은 낮고(+40%) 대신 군중 제어·생존을 얻는다. 처치 회복은 battle-base onKill 이 howlT 를 읽는다.
  blood_howl: {
    dur: 0.85,
    start(game, p) { game.fx.castCircle(p.pos, 0xd0203a, { radius: WEREWOLF_HOWL.radius, life: 0.9, demon: true }); audio.dark({ vol: 0.5, base: 110, dur: 0.8 }); },
    cast(game, p, c) {
      const at = p.pos.clone();
      game.hitRadius(at, WEREWOLF_HOWL.radius, c.dmg, { kb: 4, kind: 'blunt', stun: WEREWOLF_HOWL.fear, source: p, dirFrom: at });
      p.buffs.atk = WEREWOLF_HOWL.atk; p.buffs.atkSpd = WEREWOLF_HOWL.atkSpd; p.buffs.spd = WEREWOLF_HOWL.spd; p.buffs.t = WEREWOLF_HOWL.time;
      p.howlT = WEREWOLF_HOWL.time; p.tintEmissive = new THREE.Color(0.3, 0.02, 0.06);
      [0, 0.12, 0.24].forEach((d, i) => game.after(d, () => game.fx.shockTex(at, i === 1 ? 0xff5a6a : 0xc81830, { r1: 4 + i * 2.2, life: 0.45 })));
      game.fx.embers(at, 0xff3a5a, { n: 36, radius: 1.4, life: 1.4, rise: 5 });
      game.fx.light(at, 0xd0203a, 12, 12, 0.7);
      game.renderer.flashScreen(0.3, 0xb01830); game.renderer.shake(0.6); game.renderer.aberr = 0.7;
      audio.boom({ vol: 0.6, dur: 0.7, low: 70 }); audio.dark({ vol: 0.6, base: 140, dur: 1.1 }); audio.vibe([40, 30, 40, 30, 120]);
      game.ui.toast('핏빛 포효! 공포 · 사냥 본능', 'red');
    },
  },
  // 궁극기 월광 사냥: 무적 상태로 적 사이를 6번 도약하며 발톱으로 베고(타격마다 c.dmg×.21), 마지막에 하늘로 뛰어 보름달 낙하로
  // 착지점을 분쇄한다(c.dmg). 표적이 하나뿐이어도 총 피해는 지옥의 도끼와 같은 9배 근처(6×0.84+4.0).
  // 도약 표적·착지 피해는 시전 지점 REACH m 안으로 묶는다(void_step 과 같은 규칙: 이어 뛰며 표시 밖까지 닿지 않게).
  moonlit_hunt: {
    dur: 0.4, total: WEREWOLF_HUNT.total,
    start(game, p, c) {
      skillPrelude(game, p, 'moonlit_hunt');
      c.data.n = 0; c.data.tick = 0.12; c.data.last = null; c.data.origin = p.pos.clone();
      p.invuln = WEREWOLF_HUNT.total + 0.1; p.startTrail();
      game.fx.castCircle(p.pos, 0xd8e4ff, { radius: 4.5, life: 0.8, demon: true });
      game.renderer.aberr = 0.5; game.renderer.desat = 0.18;
      audio.dark({ vol: 0.55, base: 90, dur: 1.6 }); audio.whoosh({ vol: 0.5, pitch: 0.6, dur: 0.5 }); audio.vibe([50, 30, 50]);
    },
    update(game, p, c, dt) {
      p.vel.set(0, 0, 0);
      c.data.tick -= dt;
      if (c.data.tick > 0 || c.data.n >= WEREWOLF_HUNT.leaps) return;
      c.data.tick = WEREWOLF_HUNT.step;
      const e = werewolfHuntTarget(game, c.data.origin, c.data.last);
      const i = c.data.n++;
      if (!e) return;
      // 결정적 측면 각(난수 없음): 표적 둘레를 시계 방향으로 돌며 덮친다.
      const a = i * 2.4 + 0.6, at = _v.set(e.pos.x + Math.cos(a) * 1.3, 0, e.pos.z + Math.sin(a) * 1.3);
      const W = game.world;
      if (W && !W.walkable(at.x, at.z)) { at.set(e.pos.x, 0, e.pos.z); if (!W.walkable(at.x, at.z)) return; }
      const from = p.pos.clone();
      game.fx.boltTex(from.clone().setY(.6), at.clone().setY(.6), 0xc8d8ff, { width: .7, life: .14 });
      p.pos.set(at.x, 0, at.z); p.face(e.pos.x, e.pos.z);
      p.playTimed(i % 2 ? '2H_Melee_Attack_Slice' : '2H_Melee_Attack_Stab', WEREWOLF_HUNT.step, { fade: 0.03 });
      game.fx.slashSprite(e.pos.clone().setY(1.1), p.forward(new THREE.Vector3()), 0xe8f0ff, { size: 3.4, life: 0.18, tilt: i % 2 ? 0.9 : -1.4, flip: i % 2 === 1 });
      game.fx.slashSprite(e.pos.clone().setY(1.3), p.forward(new THREE.Vector3()), 0xc81830, { size: 2.6, life: 0.16, tilt: i % 2 ? 0.5 : -1.0, flip: i % 2 === 0 });
      onlyWithin(game, c.data.origin, WEREWOLF_HUNT.reach, () => game.hitRadius(e.pos, WEREWOLF_HUNT.clawRadius, c.dmg * WEREWOLF_HUNT.clawMul, { kb: 1.2, kind: 'slash', source: p, dirFrom: p.pos, quietStop: i % 3 !== 0 }));
      audio.whoosh({ vol: 0.38, pitch: 1.1 + i * 0.07, dur: 0.14 }); game.renderer.shake(0.18);
      c.data.last = e;
    },
    end(game, p, c) {
      p.stopTrail(); game.renderer.desat = 0;
      const at = p.pos.clone();
      onlyWithin(game, c.data.origin || at, WEREWOLF_HUNT.reach, () => game.hitRadius(at, WEREWOLF_HUNT.moonRadius, c.dmg, { kb: 12, kind: 'blunt', up: true, stun: .6, finisher: true, skillCast: c, source: p, dirFrom: at }));
      const orb = game.fx.orb(0xe8eeff, 1.4); orb.position.copy(at).setY(12); game.scene.add(orb);
      game.fx.add(orb, 0.22, (k) => { orb.position.y = 12 * (1 - k); });
      game.fx.explosion(at, { size: 11, color: 0xd8e4ff, life: 0.7 });
      [0, 0.1, 0.2].forEach((d, i) => game.after(d, () => game.fx.shockTex(at, i === 1 ? 0xff4a5a : 0xd8e4ff, { r1: 5 + i * 3, life: 0.55 })));
      game.fx.scorch(at, { radius: 5, life: 6 }); game.fx.dustPuff(at, { size: 9, life: 1.2 });
      game.fx.burst(at.clone().setY(0.6), 0xe8f0ff, { n: 60, speed: 15, size: 0.5, up: 1.2, grav: 18 });
      game.fx.light(at, 0xc8d8ff, 18, 20, 0.9);
      game.renderer.shake(1); game.renderer.punch(1.5); game.renderer.flashScreen(0.45, 0xd8e4ff); game.renderer.aberr = 1.1; game.timeCtl.slowmo(0.3, 0.55);
      audio.boom({ vol: 1, dur: 0.9, low: 48 }); audio.play('hit_mining', { vol: 1, rate: 0.6 }); audio.vibe([90, 40, 140]);
    },
  },

  // 검은 고양이 불길한 징조(삼중 추적화살 자리): 위협이 큰 적 셋(정예·보스 우선, 적이 하나면 셋 다 그 적)에게 저주 화살을 겨눠 쏜다.
  // 맞은 적은 BLACKCAT_OMEN.time초 동안 시전자에게 받는 피해 ×taken(battle-base damageEnemy). 집중 +1.
  cat_omen: {
    dur: .6,
    cast(game, p, c) {
      const list = blackcatTargets(game, p, p.pos, BLACKCAT_OMEN.reach, BLACKCAT_OMEN.arrows);
      if (!list.length) { rangerArrows(game, p, c.dmg, 1, { omen: true, color: 0xb070ff, streak: 'omen' }); p.gainJobResource(1); return; }
      list.forEach((e, i) => game.after(i * .07, () => { if (game.active !== false && p.alive && e.alive) blackcatArrow(game, p, e, c.dmg, { omen: true }); }));
      for (const e of new Set(list)) game.fx.impact?.mark(e.pos, 0xb070ff, { radius: 1.2, life: 1, style: 2 });
      p.gainJobResource(1);
      audio.whoosh({ vol: .45, pitch: 1.3, dur: .25 }); audio.dark({ vol: .3, base: 220, dur: .4 });
    },
  },
  // 궁극기 아홉 목숨의 밤(폭풍의 일곱 화살 자리): 무적으로 뒤로 물러나 그림자 화살 shots발을 표적마다 돌려 쏘고(표식 적 우선, 맞으면 표식),
  // 끝에 시전 지점 reach 안의 표식 적마다 그믐 폭발(그 적에게 c.dmg×burstMul, 고리 반경 burstRadius는 표시만). 집중 3이면 소비해 폭발 50% 증가.
  nine_lives: {
    dur: .4, total: BLACKCAT_NIGHT.total,
    start(game, p, c) {
      skillPrelude(game, p, 'nine_lives');
      c.data.n = 0; c.data.tick = .1; c.data.origin = p.pos.clone();
      c.data.empowered = (p.jobResource || 0) >= 3; if (c.data.empowered) p.jobResource = 0;
      p.invuln = Math.max(p.invuln || 0, BLACKCAT_NIGHT.total + .1);
      const first = blackcatTargets(game, p, p.pos, BLACKCAT_NIGHT.reach, 1)[0];
      if (first) p.face(first.pos.x, first.pos.z);
      p.vel.copy(p.forward(new THREE.Vector3())).multiplyScalar(-BLACKCAT_NIGHT.backstep);
      game.fx.castCircle(p.pos, 0x8a50e0, { radius: 4, life: .9, demon: true });
      game.renderer.desat = .35; game.renderer.aberr = .4;
      audio.dark({ vol: .55, base: 160, dur: 1.4 }); audio.whoosh({ vol: .45, pitch: .8, dur: .4 }); audio.vibe([30, 20, 30]);
    },
    update(game, p, c, dt) {
      if (c.data.tick < .05) p.vel.multiplyScalar(Math.max(0, 1 - dt * 10));
      c.data.tick -= dt;
      if (c.data.tick > 0 || c.data.n >= BLACKCAT_NIGHT.shots) return;
      c.data.tick = BLACKCAT_NIGHT.step;
      const i = c.data.n++;
      // 순서는 첫 발에 한 번 정한다(표식이 붙을 때마다 다시 정렬하면 같은 적을 건너뛰거나 겹친다). 죽은 표적 자리만 새로 고른다.
      if (!c.data.order) c.data.order = blackcatTargets(game, p, c.data.origin, BLACKCAT_NIGHT.reach, BLACKCAT_NIGHT.shots, true);
      let e = c.data.order[i];
      if (!e?.alive || e.spawning) e = c.data.order[i] = blackcatTargets(game, p, c.data.origin, BLACKCAT_NIGHT.reach, 1, true)[0];
      if (!e) return;
      p.face(e.pos.x, e.pos.z);
      p.playTimed?.('Bow_Shoot', BLACKCAT_NIGHT.step * 1.6, { fade: .03 });
      onlyWithin(game, c.data.origin, BLACKCAT_NIGHT.reach, () => blackcatArrow(game, p, e, c.dmg * BLACKCAT_NIGHT.shotMul, { omen: true, quietStop: i % 3 !== 0 }));
      audio.whoosh({ vol: .32, pitch: 1.2 + i * .06, dur: .12 });
    },
    end(game, p, c) {
      p.vel.set(0, 0, 0); game.renderer.desat = 0; game.renderer.aberr = 0;
      const origin = c.data.origin || p.pos, now = game.elapsed || 0, mul = BLACKCAT_NIGHT.burstMul * (c.data.empowered ? 1.5 : 1);
      // 마지막 화살이 닿을 시간(사거리 18m ÷ 속도 34 ≈ 0.53초)을 두고 터뜨린다(표식이 붙은 뒤).
      game.after(.55, () => {
        if (game.active === false) return;
        const marked = game.enemies.filter((e) => e.alive && !e.spawning && e.omenBy === p && e.omenUntil > (game.elapsed || now) && Math.hypot(e.pos.x - origin.x, e.pos.z - origin.z) < BLACKCAT_NIGHT.reach);
        for (const e of marked) {
          const at = e.pos.clone();
          game.damageEnemy(e, c.dmg * mul, { kb: 6, kind: 'magic', up: true, stun: .4, finisher: true, skillCast: c, source: p, dirx: e.pos.x - origin.x, dirz: e.pos.z - origin.z });
          game.fx.shockTex(at, 0xb070ff, { r1: BLACKCAT_NIGHT.burstRadius + 1, life: .45 });
          game.fx.burst(at.clone().setY(.8), 0xd8b0ff, { n: 18, speed: 9, size: .35, up: .8 });
        }
        if (marked.length) { game.renderer.flashScreen(.3, 0x6a30c0); game.renderer.shake(.5); game.renderer.punch(1); game.timeCtl?.slowmo?.(.25, .5); audio.boom({ vol: .8, dur: .7, low: 60 }); audio.vibe([60, 30, 90]); }
      });
    },
  },

  // ── 광전사 Lv.10 : 밀어 모으기 (당기지 않고 앞으로 민다) ──
  bull_rush: {
    dur: 0.75, total: 0.75,
    start(game, p, c) {
      const t = c.data.aimPoint || densest(game, p, 14, 4); if (t) p.face(t.x, t.z);
      const f = p.forward(new THREE.Vector3());
      // 무적은 스킬 길이(0.75)만큼. 짧으면 끝자락에 무방비로 무리 한가운데 선다
      p.vel.copy(f).multiplyScalar(21); p.invuln = 0.8; c.data.hit = new Map(); c.data.g = 0;
      p.startTrail();
      game.fx.dustPuff(p.pos, { size: 3.2, life: 0.6 }); game.fx.firePillar(p.pos, { height: 4, width: 1.6, life: 0.4, color: 0xff7a30 });
      game.renderer.aberr = 0.8; game.renderer.radial = 0.45;
      audio.whoosh({ vol: 0.7, pitch: 0.45, dur: 0.6 }); audio.fire({ vol: 0.4, dur: 0.6 }); audio.vibe(35);
    },
    update(game, p, c, dt) {
      c.data.g += dt;
      if (c.data.g > 0.04) { c.data.g = 0; game.fx.ghost(p.model, 0xff7a30, { life: 0.3, opacity: 0.5 }); game.fx.embers(p.pos, 0xff8a40, { n: 4, radius: 0.7, life: 0.5, rise: 2 }); game.fx.dust(p.pos, { n: 3, size: 1.4 }); }
      const f = p.forward(_v);   // 프레임 루프에서 할당하지 않는다
      for (const e of game.enemies) {
        if (!e.alive || e.spawning) continue;
        const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z; const d = Math.hypot(dx, dz);
        if (d > 3.6) continue;
        const ahead = (dx * f.x + dz * f.z) > -0.8;
        if (!ahead) continue;
        // 불도저 — 앞으로 밀어서 끌고 간다 (진공의 반대)
        e.pull(p.pos.x + f.x * 6, p.pos.z + f.z * 6, 15 * dt * 60);   // 프레임당 힘 — dt 보정만 하고 크기는 회오리(7/프레임) 기준
        e.stun = Math.max(e.stun, 0.25);
        const n = (c.data.hit.get(e) || 0);
        if (n < 3 && c.t > n * 0.2) {
          c.data.hit.set(e, n + 1);
          game.damageEnemy(e, c.dmg * 0.32, { kind: 'blunt', kb: 0, source: p, dirx: f.x, dirz: f.z, quietStop: true });
          game.fx.flash(e.pos.clone().setY(1.1), 0xffb070, { size: 2, life: 0.14 });
        }
      }
      if (c.t > 0.55) p.vel.multiplyScalar(Math.pow(0.002, dt));
    },
    end(game, p, c) {
      p.vel.set(0, 0, 0); p.stopTrail();
      const center = fwd(p, 2.4);
      game.hitRadius(center, 6.2, c.dmg, { kb: 13, kind: 'blunt', up: true, stun: 0.7, source: p, dirFrom: p.pos });
      game.fx.explosion(center, { size: 9, color: 0xff7a30, life: 0.6 });
      game.fx.shockTex(center, 0xff5a1e, { r1: 8, life: 0.5 });
      barbRushEnd(game, center, p.forward(_v)); // 광전사: 앞으로 터지는 용암 균열·분노 고리
      game.fx.scorch(center, { radius: 4, life: 5 }); game.fx.dustPuff(center, { size: 7, life: 1.1 });
      game.fx.burst(center.clone().setY(0.6), 0xff8040, { n: 44, speed: 14, size: 0.5, up: 1.4, grav: 18 });
      game.fx.light(center, 0xff8040, 14, 15, 0.5);
      game.renderer.shake(0.9); game.renderer.punch(1.1); game.renderer.flashScreen(0.28, 0xffa060);
      audio.boom({ vol: 0.95, dur: 0.7, low: 50 }); audio.play('hit_mining', { vol: 0.9, rate: 0.75 }); audio.vibe([70, 30, 100]);
    },
  },

  // ── 광전사 Lv.20 : 순차 분출 + 남는 균열 장판 ──
  magma_zone: {
    dur: 0.95,
    start(game, p) { game.fx.castCircle(p.pos, 0xff6a20, { radius: 6, life: 0.95, demon: true }); audio.charge({ vol: 0.4, dur: 0.8 }); audio.fire({ vol: 0.4, dur: 0.9 }); },
    cast(game, p, c) {
      const center = p.pos.clone().setY(0);
      // 1) 주변에 기둥이 차례로 솟는다 — 맞은 적은 뜬다
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        const at = center.clone().add(new THREE.Vector3(Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6));
        game.after(i * 0.11, () => {
          game.fx.firePillar(at, { height: 9, width: 2.2, life: 0.55, color: 0xff7a30 });
          game.fx.castCircle(at, 0xff5020, { radius: 2.6, life: 0.4, demon: true });
          game.hitRadius(at, 2.9, c.dmg, { kb: 3, kind: 'magic', up: true, source: p, dirFrom: at, quietStop: i > 1 });
          game.fx.burst(at.clone().setY(0.4), 0xff8a40, { n: 20, speed: 11, size: 0.45, up: 1.6, grav: 16 });
          game.fx.embers(at, 0xff6020, { n: 14, radius: 1.4, life: 1.4, rise: 5 });
          if (i < 3) game.fx.light(at, 0xff7020, 12, 12, 0.4);
          game.renderer.shake(0.45); audio.fire({ vol: 0.45, dur: 0.4 }); audio.thump({ vol: 0.5, freq: 70 - i * 4, dur: 0.3 });
        });
      }
      // 2) 갈라진 균열이 9초 남는다 — 밟고 있으면 계속 지진다
      game.after(0.75, () => {
        if (!game.active) return;
        const LIFE = 9;
        game.fx.scorch(center, { radius: 6.4, life: LIFE + 1 });
        game.fx.groundTex(center, 'circle_demon', 0xff5a20, { r0: 1, r1: 6.4, life: LIFE, spin: -0.35, y: 0.06, fadeIn: 0.2, hold: LIFE - 1.5 });
        game.fx.shockTex(center, 0xff6a20, { r1: 7.5, life: 0.6 });
        game.renderer.shake(0.7); game.renderer.punch(0.8); audio.boom({ vol: 0.8, dur: 0.8, low: 45 }); audio.vibe([60, 40, 80]);
        let n = Math.round(LIFE / 0.55);
        const tick = () => {
          if (n-- <= 0 || !game.active) return;
          game.hitRadius(center, 6.4, c.dmg * 0.28, { kb: 0.4, kind: 'magic', slow: 0.8, source: p, dirFrom: center, quiet: true });
          const a = Math.random() * Math.PI * 2, r = Math.random() * 6;
          const at = center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
          game.fx.embers(at, 0xff7a30, { n: 5, radius: 1, life: 1.1, rise: 3.5 });
          if (n % 3 === 0) { game.fx.firePillar(at, { height: 3.4, width: 1.0, life: 0.35, color: 0xff8a40 }); audio.fire({ vol: 0.18, dur: 0.3 }); }
          game.after(0.55, tick);
        }; tick();
      });
    },
  },

  // ── 대마도사 Lv.10 : 반사 투사체 (적과 벽을 튕기며 커진다) ──
  arc_reflect: {
    dur: 0.6,
    start(game, p) { game.fx.castCircle(p.pos, 0x3aa8ff, { radius: 2.8, life: 0.55, demon: true }); audio.magic({ vol: 0.35, base: 880, notes: [0, 7, 12], step: 0.04 }); },
    cast(game, p, c) {
      const state = { pos: fwd(p, 1.2).setY(1.3), dir: p.forward(new THREE.Vector3()), bounces: 0, hit: new Set(), acc: 0 };
      const MAXB = 12, SPEED = 30;
      const prev = new THREE.Vector3();
      // 프리즘 창: 옅은 하늘색(0x9fd8ff) 구·후광은 흰 덩어리로만 보였다(h1b). 진한 청 구 + 굵은 궤적(magePrismTrail)으로 읽힌다
      const lance = game.fx.orb(0x2f8cff, 0.5); lance.position.copy(state.pos);
      lance.userData.core.userData.ownGeo = true;   // fx 가 정리할 수 있게 표시 (안 하면 캐스트마다 지오메트리가 샌다)
      lance.userData.halo?.scale?.setScalar(1.1);   // 표시만: 2m 가산 후광이 시전 직후 옅은 청색 원으로 보였다(h1c). 판정 반경(1.7m)과 무관
      const disposeLance = () => { lance.userData.core.material.dispose(); lance.userData.halo.material.dispose(); };

      audio.zap({ vol: 0.5, dur: 0.3 });
      game.fx.add(lance, 2.6, (k, t, dt) => {
        if (state.done) return;
        prev.copy(state.pos);
        state.pos.addScaledVector(state.dir, SPEED * dt);
        lance.position.copy(state.pos);
        game.fx.boltTex(prev, state.pos, 0x2f8cff, { width: 0.9, life: 0.14 });
        magePrismTrail(game, prev, state.pos); // 프리즘 창 궤적(인스턴스 층)
        // 적 반사
        let bounced = false;
        for (const e of game.enemies) {
          if (!e.alive || e.spawning || state.hit.has(e)) continue;
          if (Math.hypot(e.pos.x - state.pos.x, e.pos.z - state.pos.z) > 1.7) continue;
          state.hit.add(e); state.bounces++;
          const mul = 1 + state.bounces * 0.22;
          game.damageEnemy(e, c.dmg * mul, { kind: 'magic', kb: 2.2, source: p, dirx: state.dir.x, dirz: state.dir.z, quietStop: state.bounces > 2 });
          // 표시만(h1c): 1.8m 섬광·2.4m 충격파 원판이 첫 반사(시전 직후)마다 옅은 청색 큰 원으로 보였다. 굴절 지점은 magePrismBounce 의 선이 맡는다.
          game.fx.flash(e.pos.clone().setY(1.2), 0x2a7cff, { size: 1, life: 0.08 });
          game.fx.burst(e.pos.clone().setY(1.1), 0x4a9cff, { n: 12, speed: 8, size: 0.3 });
          game.fx.shockTex(e.pos, 0x2a5cd8, { r1: 1.5, life: 0.22 });
          audio.clang({ vol: 0.3, freq: 1400 + state.bounces * 180, dur: 0.2 });
          // 다음 적을 향해 굴절
          let best = null, bd = 15;
          for (const o of game.enemies) { if (!o.alive || o.spawning || state.hit.has(o)) continue; const d = Math.hypot(o.pos.x - state.pos.x, o.pos.z - state.pos.z); if (d < bd) { bd = d; best = o; } }
          if (best) state.dir.set(best.pos.x - state.pos.x, 0, best.pos.z - state.pos.z).normalize();
          else state.dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), 2.1 + Math.random());
          magePrismBounce(game, state.pos, state.dir, state.bounces); // 프리즘: 굴절 별빛·세 갈래 빛
          bounced = true; break;
        }
        // 벽 반사 — 탐침은 실제 스텝 크기로, 반사 뒤엔 벽에서 떼어 놓는다.
        // 제자리에서 튕기면 12회를 0.2초에 다 태우고 아무것도 못 맞힌 채 끝난다
        if (!bounced && game.world && !game.world.walkable(state.pos.x, state.pos.z)) {
          const step = Math.max(0.35, SPEED * dt);
          state.pos.copy(prev); state.bounces++;
          const bx = !game.world.walkable(prev.x + state.dir.x * step, prev.z);
          const bz = !game.world.walkable(prev.x, prev.z + state.dir.z * step);
          if (bx) state.dir.x = -state.dir.x;
          if (bz) state.dir.z = -state.dir.z;
          if (!bx && !bz) state.dir.negate();                       // 오목한 구석: 되돌아 나온다
          state.pos.addScaledVector(state.dir, step * 1.2);          // 벽에서 떼어 놓기
          if (!game.world.walkable(state.pos.x, state.pos.z)) state.pos.copy(p.pos).setY(1.3);   // 그래도 벽 안이면 시전자에게 회수
          game.fx.flash(state.pos, 0x3a9cff, { size: 1.6, life: 0.1 });
          game.fx.shockTex(_v.copy(state.pos).setY(0), 0x2f7cff, { r1: 2, life: 0.22 });
          audio.play('ui_pluck', { vol: 0.3, rate: 1.6 });
        }
        if (state.bounces >= MAXB) {
          game.hitRadius(state.pos, 4.5, c.dmg * 2.4, { kb: 8, kind: 'magic', up: true, source: p, dirFrom: state.pos });
          game.fx.explosion(state.pos, { size: 7, color: 0x4a8cff, life: 0.5 });
          game.fx.shockTex(state.pos.clone().setY(0), 0x2f7cff, { r1: 6, life: 0.5 });
          game.fx.burst(state.pos.clone(), 0x5a8cff, { n: 36, speed: 13, size: 0.4 });
          game.renderer.shake(0.6); audio.boom({ vol: 0.7, dur: 0.5, low: 90 }); audio.vibe([40, 20, 60]);
          state.done = true; lance.visible = false;
        }
      }, disposeLance);
      game.renderer.flashScreen(0.2, 0x6aa8ff);
    },
  },

  // ── 대마도사 Lv.20 : 시간 정지 + 각인 (멈춘 동안 준 피해가 해제 순간 터진다) ──
  chrono_seal: {
    dur: 1.0,
    start(game, p) { game.fx.castCircle(p.pos, 0x6a4cff, { radius: 6, life: 1.0, demon: true }); game.fx.abilitySignature?.(p.pos, 'arcane', { scale: 1.1, life: 0.7 }); audio.magic({ vol: 0.5, base: 392, notes: [0, 5, 10, 14, 19], step: 0.09, type: 'triangle' }); audio.charge({ vol: 0.4, dur: 0.9 }); },
    cast(game, p, c) {
      const center = p.pos.clone(); const R = 9.5, FREEZE = 3.0;
      const sealed = game.enemies.filter((e) => e.alive && !e.spawning && p.distTo(e) < R).slice(0, 24).map((e) => ({ e, hp: e.hp }));
      // 시간 봉인 = 남보라 '시계' 언어: 바닥 시계판(12 눈금 + 봉인 시간 동안 한 바퀴 도는 바늘) + 옅은 룬. 얼음 흰빛과 구분한다.
      game.fx.groundTex(center, 'circle_demon', 0x5a3ce0, { r0: 1, r1: R * .7, life: FREEZE + 0.5, spin: -1.2, y: 0.07, fadeIn: 0.1, hold: FREEZE, gain: .4 }); // 연보라 돔 대신 진한 보라 작은 진
      game.fx.impact?.mark?.(center, 0xa898ff, { radius: R * .62, life: FREEZE + .3, style: 4 });
      game.fx.shockTex(center, 0x9a8cff, { r1: R + 1.5, life: 0.6 });
      game.renderer.flashScreen(0.2, 0xb8b0ff); game.renderer.aberr = 1.3; game.renderer.shake(0.5);
      game.timeCtl.slowmo(0.25, 0.5);
      audio.ice({ vol: 0.6, dur: 0.9 }); audio.dark({ vol: 0.35, base: 90, dur: 1.2 }); audio.vibe([80, 40, 40]);
      for (const s of sealed) {
        s.e.stun = Math.max(s.e.stun, FREEZE * (s.e.isBoss ? 0.4 : 1));
        game.fx.iceBurst(s.e.pos, { size: 2.2, life: 0.4, color: 0x9a8cff });
        game.fx.impact?.mark?.(s.e.pos, 0xa898ff, { radius: 1.1, life: FREEZE, style: 4 });
      }
      game.ui.toast(`시간 봉인 — ${sealed.length}명 정지`, 'gold');
      // 정지 유지 (넉백까지 얼린다)
      let n = Math.round(FREEZE / 0.1);
      const hold = () => {
        if (n-- <= 0 || !game.active) return;
        for (const s of sealed) { if (!s.e.alive) continue; s.e.kb.set(0, 0, 0); s.e.vel.set(0, 0, 0); s.e.stun = Math.max(s.e.stun, 0.3); }
        if (n % 6 === 0) for (const s of sealed) if (s.e.alive) game.fx.embers(s.e.pos, 0xa898ff, { n: 2, radius: 0.6, life: 0.6, rise: 1.2 });
        game.after(0.1, hold);
      }; hold();
      // 해제 — 각인된 피해가 터진다
      game.after(FREEZE, () => {
        if (!game.active) return;
        game.renderer.flashScreen(0.22, 0xb8b0ff); game.fx.abilitySignature?.(center, 'arcane', { scale: 1.4, life: 0.6, heavy: true }); game.timeCtl.slowmo(0.35, 0.5); game.renderer.shake(0.9); game.renderer.punch(1.2);
        audio.boom({ vol: 1, dur: 0.9, low: 55 }); audio.shatter({ vol: 0.7 }); audio.vibe([90, 40, 120]);
        sealed.forEach((s, i) => game.after(i * 0.05, () => {
          const taken = Math.max(0, s.hp - (s.e.alive ? s.e.hp : 0));
          const at = s.e.pos.clone();
          game.fx.explosion(at, { size: 4.2, color: 0x8a7cff, life: 0.5 });
          game.fx.impact?.burst?.(at.clone().setY(1), 0xa898ff, { size: 1.6 });
          mageChronoRelease(game, at, i); // 시계 파편(인스턴스 층, Math.random 미사용)
          game.fx.burst(at.clone().setY(0.8), 0xa898ff, { n: 22, speed: 11, size: 0.4 });
          game.hitRadius(at, 3.8, c.dmg + taken * 0.75, { kb: 7, kind: 'magic', up: true, source: p, dirFrom: at, quietStop: i > 1 });
          if (i < 3) game.fx.light(at, 0x9a8cff, 12, 12, 0.4);
          audio.ice({ vol: 0.35, dur: 0.4 }); game.renderer.shake(0.25);
        }));
      });
    },
  },

  // ── 암살자 Lv.10 : 표식 + 분신 순간이동 참격 ──
  shadow_mark: {
    dur: 0.7,
    start(game, p) { game.fx.castCircle(p.pos, 0xb26bff, { radius: 4, life: 0.7, demon: true }); audio.dark({ vol: 0.4, base: 180, dur: 0.6 }); },
    cast(game, p, c) {
      const ts = targets(game, p, 8, 13);
      if (!ts.length) { shadowWave(game, p.pos, 5, 0.4); return; }
      for (const e of ts) { game.fx.castCircle(e.pos, 0xb26bff, { radius: 1.5, life: 1.5, demon: true }); game.fx.embers(e.pos, 0xd0a0ff, { n: 8, radius: 0.8, life: 0.9, rise: 2 }); }
      audio.whoosh({ vol: 0.5, pitch: 0.8, dur: 0.4 });
      // 분신 3체가 표식을 차례로 친다
      ts.forEach((e, i) => game.after(0.18 + i * 0.09, () => {
        if (!e.alive) return;
        const side = (i % 3) - 1;
        const at = e.pos.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 1.6, 0, Math.sin(i * 2.1) * 1.6));
        game.fx.ghost(p.model, 0xb26bff, { life: 0.32, opacity: 0.55, at });
        game.fx.slashSprite(e.pos.clone().setY(1.1), new THREE.Vector3(e.pos.x - at.x, 0, e.pos.z - at.z).normalize(), 0x7030ff, { size: 3.4, life: 0.2, tilt: side * 1.2 });
        game.damageEnemy(e, c.dmg, { kind: 'slash', kb: 1.2, source: p, dirx: e.pos.x - at.x, dirz: e.pos.z - at.z, quietStop: i > 1 });
        game.fx.flash(e.pos.clone().setY(1.2), 0xb27aff, { size: 1.6, life: 0.16 });
        audio.hit('slash', { heavy: i % 3 === 0 }); if (i < 3) audio.vibe(15);
        game.renderer.shake(0.18);
      }));
      // 표식 폭발 — 서로를 끌어당기며 터진다 (표식끼리 뭉친다)
      game.after(0.18 + ts.length * 0.09 + 0.25, () => {
        if (!game.active) return;
        const alive = ts.filter((e) => e.alive);
        if (!alive.length) return;
        const hub = alive.reduce((a, e) => a.add(e.pos), new THREE.Vector3()).multiplyScalar(1 / alive.length);
        for (const e of alive) game.fx.boltTex(e.pos.clone().setY(1), hub.clone().setY(1), 0xb26bff, { width: 1.4, life: 0.28 });
        // 표시(자기 중심 13m) 밖 적은 끌지도 치지도 않는다: 표식 대상이 먼 곳에 있으면 표시 밖 적이 몰려와 맞던 것을 막는다(3차 재감사 shadow_mark 다중 표적).
        const reach = SKILL_AIM_SHAPES.shadow_mark.range;
        audio.suck({ vol: 0.22, dur: 0.4 });
        for (const e of game.enemies) {
          if (!e.alive || e.spawning || p.distTo(e) >= reach) continue;
          const dx = e.pos.x - hub.x, dz = e.pos.z - hub.z;
          if (dx * dx + dz * dz <= 196) e.pull(hub.x, hub.z, 26);
        }
        game.after(0.18, () => {
          hitWithin(game, p, hub, 5.5, reach, c.dmg * 1.6, { kb: 6, kind: 'slash', up: true, source: p, dirFrom: hub });
          game.fx.texFlash(hub, 'singularity', 0xb26bff, { size: 9, life: 0.5, spin: 0.6, grow: 1.5, y: 0.6 });
          game.fx.explosion(hub, { size: 7, color: 0xd0a0ff, life: 0.5 });
          shadowWave(game, hub, 6.5, 0.5);
          game.fx.burst(hub.clone().setY(0.8), 0xd0a0ff, { n: 40, speed: 12, size: 0.42 });
          game.renderer.shake(0.7); game.renderer.punch(0.9); game.renderer.flashScreen(0.3, 0xd0a0ff);
          audio.boom({ vol: 0.8, dur: 0.6, low: 70 }); audio.dark({ vol: 0.4, base: 120, dur: 0.6 }); audio.vibe([60, 30, 80]);
        });
      });
    },
  },

  // ── 암살자 Lv.20 : 무적 잠수 + 순간이동 연쇄 ──
  void_step: {
    dur: 0.45, total: 2.0,
    start(game, p, c) {
      c.data.n = 0; c.data.tick = 0; c.data.last = null; c.data.origin = p.pos.clone();
      p.invuln = 2.1; p.startTrail(); p.beacon?.setFocus(true, 0xd0a0ff);
      game.fx.texFlash(p.pos, 'singularity', 0x8a4aff, { size: 8, life: 0.5, spin: 0.8, grow: 1.4, y: 0.5 });
      shadowWave(game, p.pos, 5, 0.4);
      game.renderer.aberr = 0.55; game.renderer.radial = 0.22; game.renderer.desat = 0.12;
      audio.dark({ vol: 0.6, base: 70, dur: 1.4 }); audio.suck({ vol: 0.4, dur: 1.2 }); audio.vibe([60, 30, 30]);
    },
    update(game, p, c, dt) {
      p.vel.set(0, 0, 0);
      c.data.tick -= dt;
      if (c.data.tick > 0 || c.data.n >= 12) return;
      c.data.tick = 0.13;
      // 점멸 표적과 피해는 시전 지점 18m(표시 범위) 안으로 묶는다: 점멸이 이어질수록 표시 밖까지 닿던 문제(3차 재감사 이후 대표님 결정).
      const o = c.data.origin, list = game.enemies.filter((e) => e.alive && !e.spawning && Math.hypot(e.pos.x - o.x, e.pos.z - o.z) < VOID_STEP_REACH);
      if (!list.length) { c.data.n++; return; }
      const e = list[(c.data.n * 3 + 1) % list.length];
      const from = p.pos.clone();
      const a = Math.random() * Math.PI * 2;
      const at = _v.set(e.pos.x + Math.cos(a) * 1.5, 0, e.pos.z + Math.sin(a) * 1.5);
      // 순간이동 — 반드시 걸을 수 있는 칸으로. 벽 안으로 뛰면 resolve 가 못 빼내서 층이 끝날 때까지 갇힌다
      const W = game.world;
      if (W && !W.walkable(at.x, at.z)) { at.set(e.pos.x, 0, e.pos.z); if (!W.walkable(at.x, at.z)) { c.data.n++; return; } }
      // Keep the real rogue visually solid; motion is sold by a directional streak, not a translucent body clone.
      game.fx.boltTex(from.clone().setY(.45), at.clone().setY(.45), 0x8a4aff, { width: .62, life: .12 });
      p.pos.set(at.x, 0, at.z); p.face(e.pos.x, e.pos.z);
      p.playTimed(c.data.n % 2 ? 'Dualwield_Melee_Attack_Slice' : 'Dualwield_Melee_Attack_Stab', 0.2, { fade: 0.03 });   // dur(0.5) 로 한 번 재생하면 나머지 1.5초는 마지막 프레임에서 멈춰 있다
      game.fx.boltTex(from.clone().setY(1), p.pos.clone().setY(1), 0xb26bff, { width: 1.6, life: 0.18 });
      game.fx.slashSprite(e.pos.clone().setY(1.1), p.forward(new THREE.Vector3()), 0x7030ff, { size: 3.6, life: 0.18, tilt: (c.data.n % 2 ? 0.8 : -1.5), flip: c.data.n % 2 === 1 });
      game.fx.flash(p.pos.clone().setY(1), 0x8a4aff, { size: 2.4, life: 0.15 });
      onlyWithin(game, o, VOID_STEP_REACH, () => game.hitArea(p, p.pos, p.yaw, 3.6, 200, c.dmg, { kb: 1.4, kind: 'slash', source: p, quietStop: c.data.n % 3 !== 0 }));
      audio.whoosh({ vol: 0.35, pitch: 1.2 + c.data.n * 0.06, dur: 0.14 });
      game.renderer.shake(0.16);
      c.data.n++; c.data.last = e;
    },
    end(game, p, c) {
      p.stopTrail(); p.beacon?.setFocus(false);
      game.renderer.desat = 0;
      const at = p.pos.clone();
      onlyWithin(game, c.data.origin || at, VOID_STEP_REACH, () => game.hitRadius(at, 7.5, c.dmg * 3.2, { kb: 12, kind: 'slash', up: true, finisher: true, skillCast:c, source: p, dirFrom: at }));
      game.fx.texFlash(at, 'singularity', 0xb26bff, { size: 12, life: 0.6, spin: 1.2, grow: 1.6, y: 1 });
      game.fx.explosion(at, { size: 10, color: 0xd0a0ff, life: 0.6 });
      shadowWave(game, at, 9, 0.6);
      game.fx.burst(at.clone().setY(1), 0xd0a0ff, { n: 60, speed: 15, size: 0.5, up: 0.9 });
      game.fx.light(at, 0xb26bff, 16, 18, 0.6);
      game.renderer.shake(1); game.renderer.punch(1.4); game.renderer.flashScreen(0.4, 0xd0a0ff); game.timeCtl.slowmo(0.35, 0.5);
      audio.boom({ vol: 1, dur: 0.9, low: 50 }); audio.bladeWave({ vol: 0.8 }); audio.vibe([90, 40, 130]);
    },
  },
  // ================= 고위 액티브 Lv.35 / Lv.50 =================
  sunbreaker: { dur:.85, cast(game,p,c){ const at=fwd(p,4); game.vacuum(at,8,18); game.hitRadius(at,5.5,c.dmg,{kb:8,kind:'slash',source:p,dirFrom:at}); game.fx.shockTex(at,0xff9a20,{r1:4.5,life:.4}); game.after(.18,()=>{if(game.active)game.hitRadius(at,6.5,c.dmg*.65,{kb:10,kind:'slash',source:p,dirFrom:at});}); } },
  heavenfall: { dur:1, cast(game,p,c){ const at=c.data.aimPoint?.clone()||densest(game,p,15,5)||p.pos.clone(); game.vacuum(at,12,24); knightRune(game,at,3,.7); game.after(.28,()=>{if(!game.active)return;game.hitRadius(at,8,c.dmg*1.25,{kb:14,kind:'magic',up:true,finisher:true,skillCast:c,source:p,dirFrom:at});game.fx.explosion(at,{size:6.5,color:0xff9a18,life:.5});}); } },
  // 설원의 혈진(교관): 두 번째 붕괴가 반경 8 → 9.5, 피해 0.8 → 1.1배가 된다.
  bloodquake: { dur:.9, cast(game,p,c){ const echo=hasTownSkillVariant(p,'bloodquake','echo'); const at=p.pos.clone(); game.vacuum(at,9,22); game.hitRadius(at,6,c.dmg,{kb:7,kind:'blunt',source:p,dirFrom:at}); game.fx.shockTex(at,0xc81810,{r1:6.5,life:.4}); game.after(.2,()=>{if(!game.active)return;game.hitRadius(at,echo?9.5:8,c.dmg*(echo?1.1:.8),{kb:12,kind:'blunt',up:true,source:p,dirFrom:at});game.fx.shockTex(at,0xff4a1a,{r1:echo?10:8.5,life:.5});game.fx.scorch(at,{radius:5,life:5});}); } },
  cataclysm: { dur:1.1, cast(game,p,c){ const at=c.data.aimPoint?.clone()||fwd(p,2); game.fx.castCircle(at,0xff5a3c,{radius:8,life:.8}); game.after(.3,()=>{if(!game.active)return;game.hitRadius(at,9,c.dmg*1.3,{kb:16,kind:'blunt',up:true,finisher:true,skillCast:c,source:p,dirFrom:at});game.fx.explosion(at,{size:12,color:0xff5a3c,life:.65});game.fx.firePillar(at,{height:12,width:3.2,life:.7,color:0xff4a1a});game.fx.shockTex(at,0xff3a1a,{r1:11,life:.55});game.fx.scorch(at,{radius:6,life:6});}); } },
  star_prison: { dur:.9, start(game,p){skillPrelude(game,p,'star_prison');}, cast(game,p,c){ const at=c.data.aimPoint?.clone()||densest(game,p,16,5)||fwd(p,5); game.vacuum(at,13,28); game.fx.castCircle(at,0x4a4cff,{radius:7,life:.8,demon:true}); game.after(.24,()=>{if(game.active)game.hitRadius(at,7,c.dmg*1.2,{kb:5,stun:1.2,kind:'magic',source:p,dirFrom:at});}); } },

  absolute_zero: { dur:1.05, start(game,p){skillPrelude(game,p,'absolute_zero');}, cast(game,p,c){ const at=c.data.aimPoint?.clone()||densest(game,p,17,6)||fwd(p,6); game.vacuum(at,12,18); game.fx.castCircle(at,0x2a8cff,{radius:8,life:.9,demon:true}); game.after(.35,()=>{if(!game.active)return;game.hitRadius(at,9,c.dmg*1.25,{kb:11,stun:1.8,kind:'magic',up:true,finisher:true,skillCast:c,source:p,dirFrom:at});game.fx.iceBurst(at,{size:7,life:.55,color:0x2a8cff});}); } },
  // 별그림자 행렬(교관): 흡인 반경 9 → 13, 베기 반경 5 → 6.5.
  night_parade: { dur:.85, cast(game,p,c){ const wide=hasTownSkillVariant(p,'night_parade','wide'); const at=c.data.aimPoint?.clone()||densest(game,p,13,4)||fwd(p,3); game.vacuum(at,wide?13:9,25); for(let i=0;i<3;i++)game.after(i*.1,()=>{if(game.active)game.hitRadius(at,wide?6.5:5,c.dmg*.55,{kb:2,kind:'slash',source:p,dirFrom:at,quietStop:i>0});}); } },
  eclipse_edge: { dur:1, cast(game,p,c){ const at=c.data.aimPoint?.clone()||densest(game,p,16,5)||fwd(p,5); p.invuln=Math.max(p.invuln||0,1); game.vacuum(at,10,24); game.fx.castCircle(at,0xb26bff,{radius:7,life:.7,demon:true}); game.after(.3,()=>{if(!game.active)return;game.hitRadius(at,8,c.dmg*1.3,{kb:14,kind:'slash',up:true,finisher:true,skillCast:c,source:p,dirFrom:at});game.fx.explosion(at,{size:10,color:0xb26bff,life:.55});}); } },
  gale_hunt: { dur:.9, cast(game,p,c){ rangerArrows(game,p,c.dmg*.75,3,{radius:.9,kb:4,streak:'gale'}); for(const delay of [.12,.24])game.after(delay,()=>{if(game.active&&p.alive)rangerArrows(game,p,c.dmg*.75,3,{radius:.9,kb:4,streak:'gale'});}); } },
  skyfall_arrows: { dur:1.05, cast(game,p,c){ const at=c.data.aimPoint?.clone()||densest(game,p,18,6)||fwd(p,7); game.fx.groundTex(at,'circle_gold',0x3fe0a0,{r0:3.2,r1:8,life:.8,spin:1.6,y:.07,fadeIn:.2,hold:.35,gain:.5}); for(let i=0;i<5;i++)game.after(.16+i*.09,()=>{if(!game.active)return;const hit=at.clone().add(new THREE.Vector3(Math.cos(i*2.4)*2.2,0,Math.sin(i*2.4)*2.2));game.hitRadius(hit,4.2,c.dmg*.42,{kb:4,kind:'slash',source:p,dirFrom:hit,quietStop:i>1});game.fx.shockTex(hit,0x7feac0,{r1:3.8,life:.3});game.fx.light?.(hit,0x9fffd8,5,7,.22);game.fx.impact?._streaks?.(hit,null,4,9,.3,i%2?0xeaff9a:0x52f0b4,{up:4,spread:3.1,size:.26});}); } },

  // Mechanics live outside the visual session's FX/SFX edits in this file.
  ...AWAKENING_III,

};

// 스킬별 전장 장악 VFX: 기존 cast 지점에서 레시피를 한 번 호출한다(판정·피해·타이밍은 원래 cast 그대로).
for (const id of Object.keys(SKILL_VFX)) {
  const impl = SKILLS[id];
  if (!impl || impl.vfxWrapped) continue;
  const cast = impl.cast;
  impl.cast = function (game, p, c) {
    try { castSkillVfx(game, id, p, c, densest); } catch (error) { console.warn('skill vfx', id, error); }
    return cast?.call(this, game, p, c);
  };
  impl.vfxWrapped = true;
}
