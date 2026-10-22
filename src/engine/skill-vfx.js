import * as THREE from 'three';
import { VFX_TEX } from './assets.js';
import { HERO_SKILLS } from './combat-sound-library.js';
import { normalizeGrade } from '../data/hero-grades.js';
import { SKILL_SIGNATURES } from './skill-signatures.js';

/**
 * 스킬별 '전장 장악' 레이어. 기존 스킬 연출(skills.js)은 그대로 두고,
 * public/img/vfx/skills-v2 텍스처를 기존 FX API(groundTex/texFlash/flash/burst)에 얹는다.
 * 새 렌더 자원은 FX가 수명 끝에 정리하는 기존 경로만 쓰므로 별도 풀·dispose가 없다.
 * 순서: 바닥 룬 → 스킬 텍스처 → 100ms 이하 노출 섬광 → 잔상·먼지.
 */
export const SKILL_VFX_TEXTURES = Object.freeze([
  'aura-sssr', 'skill-chain-lightning', 'skill-holy-wave', 'skill-ice-burst', 'skill-lava-crack', 'skill-meteor',
  'skill-rune-circle-gold', 'skill-rune-circle-violet', 'skill-shadow-slash', 'skill-wind-arrow-trail',
]);
export const skillVfxKey = (name) => 'sv2-' + name;

const R = (rune, tex, place, mode, color, size, extra = {}) => Object.freeze({ rune, tex: 'skill-' + tex, place, mode, color, size, ...extra });
const GOLD = 'skill-rune-circle-gold', VIOLET = 'skill-rune-circle-violet';
/** 원화별 지면 밝기. 얼음·성광 원화는 중심이 거의 흰색이라 10m 넘게 깔면 블룸과 함께 화면을 하얗게 덮었다(대마도사 눈보라·별감옥). */
export const SKILL_GROUND_GAIN = Object.freeze({ 'skill-ice-burst': .42, 'skill-holy-wave': .6, 'skill-chain-lightning': .8, [GOLD]: .78, [VIOLET]: .85 });
const groundGain = (name) => SKILL_GROUND_GAIN[name] ?? 1;

/** 40개 스킬 ID → 레시피. place: self(시전자) / front(전방 dist) / aim(조준점). mode: flash(빌보드) / ground(지면).
 * aim 은 실제 스킬 판정과 같은 자리에 그린다: 조준점 → seek[사거리, 반경]의 최다 밀집 적(skills.js densest) → 전방 dist(0 이면 시전자).
 * 예전에는 조준점이 없을 때 전방 8~9m 에 그려 판정 위치와 연출이 어긋났다. */
export const SKILL_VFX = Object.freeze({
  // 검성: 홀리웨이브 원화(크림 덩어리)·큰 금빛 지면 텍스처 대신 발밑 작은 룬만 두고, 모양은 sig-knight.js 의 광선·고리·표식이 맡는다.
  holy_slash: R(GOLD, 'holy-wave', 'self', 'none', 0xffb21e, 2.5, { noRune: true, sig: true, gain: .7 }),
  shield_bash: R(GOLD, 'holy-wave', 'aim', 'none', 0xffb21e, 3, { noRune: true, dist: 1.2, sig: true, gain: .7 }),
  judgment: R(GOLD, 'holy-wave', 'self', 'none', 0xffb21e, 3, { sig: true, gain: .7 }),
  dragon_slash: R(GOLD, 'holy-wave', 'self', 'none', 0xff9a18, 5, { noRune: true, sig: true, gain: .15 }),
  chain_bind: R(GOLD, 'chain-lightning', 'self', 'none', 0xffb21e, 3, { noRune: true, sig: true, gain: .7 }),
  sanctuary: R(GOLD, 'holy-wave', 'self', 'none', 0xffb21e, 2.5, { sig: true, gain: .5 }),
  sunbreaker: R(GOLD, 'holy-wave', 'self', 'none', 0xff9a18, 4, { noRune: true, sig: true, gain: .15 }),
  heavenfall: R(GOLD, 'holy-wave', 'aim', 'none', 0xffb21e, 5, { dist: 0, seek: [15, 5], sig: true, gain: .15 }),
  // 광전사
  whirlwind: R(VIOLET, 'lava-crack', 'self', 'ground', 0xff4a1a, 5),
  quake: R(GOLD, 'lava-crack', 'aim', 'ground', 0xff9a4a, 8, { dist: 1.5 }),
  berserk: R(VIOLET, 'lava-crack', 'self', 'ground', 0xff3030, 6, { noRune: true, sig: true }),
  hell_axe: R(GOLD, 'meteor', 'aim', 'flash', 0xff7a30, 10, { dist: 4, seek: [13, 4], noRune: true, sig: true }),
  bull_rush: R(GOLD, 'lava-crack', 'front', 'ground', 0xff6a30, 6, { dist: 5, noRune: true, sig: true }),
  magma_zone: R(GOLD, 'lava-crack', 'self', 'ground', 0xff5a20, 8),
  bloodquake: R(VIOLET, 'lava-crack', 'self', 'ground', 0xd02020, 9, { noRune: true, sig: true }),
  cataclysm: R(GOLD, 'meteor', 'aim', 'flash', 0xff5a3c, 12, { dist: 2 }),
  // 대마도사
  fireball: R(GOLD, 'meteor', 'front', 'flash', 0xff7228, 4, { dist: 3, noRune: true, sig: true }),
  chain: R(VIOLET, 'chain-lightning', 'self', 'flash', 0x5aa8ff, 4.5, { noRune: true, sig: true, gain: .7 }),
  blizzard: R(VIOLET, 'ice-burst', 'self', 'none', 0x2a9cff, 7, { noRune: true, sig: true }),
  meteor: R(GOLD, 'meteor', 'aim', 'flash', 0xff8a40, 11, { dist: 4, seek: [15, 5] }),
  arc_reflect: R(VIOLET, 'chain-lightning', 'front', 'none', 0x5fc8ff, 4, { dist: 4, noRune: true, sig: true }),
  chrono_seal: R(VIOLET, 'rune-circle-violet', 'self', 'none', 0x8a7cff, 9, { noRune: true, sig: true }),
  star_prison: R(VIOLET, 'ice-burst', 'aim', 'none', 0x5a6cff, 9, { dist: 5, seek: [16, 5], noRune: true, sig: true }),
  absolute_zero: R(VIOLET, 'ice-burst', 'aim', 'ground', 0x2a8cff, 12, { dist: 6, seek: [17, 6] }),
  // 암살자: 질주·야행·궁극기만 그림자 참격 원화를 쓰고, 나머지는 모양을 나눈다(독무 = 원화 없이 조준 룬, 표식 = 보라 룬 지면,
  // 공허 보법 = 보라 번개 균열, 일식 = 보라 룬 큰 지면). 칼날·고리·표식 모양은 sig-rogue.js 서명이 맡는다.
  shadow_dash: R(VIOLET, 'shadow-slash', 'front', 'flash', 0x9a4cff, 5, { dist: 3, ghost: true }),
  poison_bomb: R(VIOLET, 'shadow-slash', 'aim', 'none', 0x70e060, 6, { dist: 5, seek: [13, 3.5] }),
  flurry: R(VIOLET, 'shadow-slash', 'front', 'flash', 0xb070ff, 4, { dist: 2, ghost: true }),
  thousand: R(VIOLET, 'shadow-slash', 'self', 'ground', 0xa060ff, 11, { ghost: true }),
  shadow_mark: R(VIOLET, 'rune-circle-violet', 'self', 'ground', 0x8a4aff, 7, { gain: .8 }),
  void_step: R(VIOLET, 'chain-lightning', 'self', 'flash', 0x7a3cff, 6, { ghost: true }),
  night_parade: R(VIOLET, 'shadow-slash', 'aim', 'ground', 0x9a4cff, 8, { dist: 3, seek: [13, 4], ghost: true }),
  eclipse_edge: R(VIOLET, 'rune-circle-violet', 'aim', 'ground', 0x7a3cff, 10, { dist: 5, seek: [16, 5], ghost: true, gain: .8 }),
  // 레인저: 큰 바람 텍스처 섬광(전방 4m 흰 덩어리) 대신 발밑 비취 룬만 두고, 모양은 skill-signatures.js 의 광선·표식이 맡는다.
  ranger_pierce: R(GOLD, 'wind-arrow-trail', 'self', 'none', 0x3fe0a0, 3, { sig: true }),
  ranger_volley: R(GOLD, 'wind-arrow-trail', 'self', 'none', 0x3fe0a0, 3.5, { sig: true }),
  ranger_retreat: R(GOLD, 'wind-arrow-trail', 'self', 'none', 0x3fe0a0, 3, { sig: true, ghost: true }),
  ranger_tempest: R(GOLD, 'wind-arrow-trail', 'self', 'none', 0x3fe0a0, 5, { sig: true, gain: .6 }),
  ranger_quickshot: R(GOLD, 'wind-arrow-trail', 'self', 'none', 0x9fffd8, 3, { sig: true }),
  ranger_binding: R(GOLD, 'wind-arrow-trail', 'self', 'none', 0x63e08a, 3.5, { sig: true }),
  gale_hunt: R(GOLD, 'wind-arrow-trail', 'self', 'none', 0x3fe0a0, 4, { sig: true, gain: .6 }),
  skyfall_arrows: R(GOLD, 'wind-arrow-trail', 'aim', 'ground', 0x3fe0a0, 12, { dist: 7, seek: [18, 6], sig: true, gain: .5 }),
});

// 궁극기(인덱스 3)와 고위 각성(6·7)만 전장 장악 링 + 카메라 펀치 1회를 쓴다.
export const MAJOR_SKILL_INDEXES = Object.freeze([3, 6, 7]);
export const MAJOR_SKILL_IDS = Object.freeze(new Set(Object.values(HERO_SKILLS).flatMap((ids) => MAJOR_SKILL_INDEXES.map((i) => ids[i]))));

/** 등급 없는 레거시 영웅은 def.rarity, 그것도 없으면 SR 로 내려간다. */
export function resolveHeroGrade(player) {
  return normalizeGrade(player?.def, player?.stats?.grade);
}

let loading = null;
/** skills-v2 텍스처를 VFX_TEX 에 등록한다. 로딩 전에는 FX 가 기존 링/플래시로 내려간다. */
export function loadSkillVfxTextures() {
  if (loading || typeof document === 'undefined' || typeof document.createElement !== 'function') return loading;
  const loader = new THREE.TextureLoader();
  loading = Promise.all(SKILL_VFX_TEXTURES.map((name) => new Promise((resolve) => loader.load(
    '/img/vfx/skills-v2/' + name + '.webp',
    (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; VFX_TEX[skillVfxKey(name)] = t; resolve(); },
    undefined, () => { console.warn('skill vfx tex fail', name); resolve(); },
  ))));
  return loading;
}
loadSkillVfxTextures();

const _at = new THREE.Vector3(), _p = new THREE.Vector3(), _f = new THREE.Vector3();
let _seek = null;
const LAYER_CAP = 60, LAYER_CAP_LITE = 28;
// 표시 전용 난수. 전투·드랍의 Math.random 진행을 바꾸지 않는다.
let seed = 0x2f6e2b1;
const vfxRandom = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/**
 * 스킬 시전 순간의 장악 레이어. 판정·피해·타이밍은 건드리지 않는다.
 * @param {any} game @param {string} skillId @param {any} player
 * @param {{data?: {aimPoint?: THREE.Vector3}}|null} [ctx]
 * @param {((game: any, player: any, range: number, radius: number) => THREE.Vector3|null)|null} [seek] 조준점이 없을 때 판정과 같은 밀집 적 탐색
 * @returns {boolean} 레시피를 실행했는지
 */
export function castSkillVfx(game, skillId, player, ctx = null, seek = null) {
  const r = SKILL_VFX[skillId], fx = game?.fx;
  if (!r || !fx || typeof fx.groundTex !== 'function' || typeof fx.texFlash !== 'function' || !player?.pos) return false;
  const nativeRandom = Math.random;
  Math.random = vfxRandom;
  try {
    const lite = !!fx.lite, reduced = !!game.app?.reducedMotion?.matches;
    const crowded = (fx.items?.length || 0) > (lite ? LAYER_CAP_LITE : LAYER_CAP);
    const scale = resolveHeroGrade(player) === 'SSSR' ? 1.15 : 1;
    const major = MAJOR_SKILL_IDS.has(skillId);
    const hasForward = typeof player.forward === 'function';
    if (hasForward) player.forward(_f); else _f.set(0, 0, 1);
    const aim = ctx?.data?.aimPoint;
    if (r.place === 'self') _at.copy(player.pos);
    else if (r.place === 'aim' && aim) _at.copy(aim);
    else if (r.place === 'aim' && r.seek && typeof seek === 'function' && Array.isArray(game.enemies) && typeof player.distTo === 'function' && (_seek = seek(game, player, r.seek[0], r.seek[1]))) _at.copy(_seek);
    else _at.copy(player.pos).addScaledVector(_f, r.dist ?? 3);
    _at.y = player.pos.y;
    const size = r.size * scale, color = r.color, g = r.gain ?? 1;
    // 1) 바닥 룬 서클(noRune: 서명이 자기 발밑 문양을 그리는 물리 스킬은 공용 금빛 룬을 깔지 않아 실루엣이 겹치지 않는다)
    const runeR = (1.8 + size * 0.28) * (r.place === 'self' ? 1 : 0.9);
    if (!r.noRune) fx.groundTex(_at, skillVfxKey(r.rune), color, { r0: runeR * 0.35, r1: runeR, life: 0.55, spin: reduced ? 0 : 1.4, y: 0.07, fadeIn: 0.15, hold: 0.3, gain: groundGain(r.rune) * g });
    // 2) 스킬 텍스처
    if (r.mode === 'ground') fx.groundTex(_at, skillVfxKey(r.tex), color, { r0: size * 0.3, r1: size, life: 0.6, spin: reduced ? 0 : 0.5, y: 0.09, fadeIn: 0.1, gain: groundGain(r.tex) * g });
    else if (r.mode === 'flash') fx.texFlash(_at, skillVfxKey(r.tex), color, { size, life: 0.45, spin: reduced ? 0 : 0.6, grow: 1.1, y: 1, gain: g });
    if (!reduced && !crowded) {
      // 3) 노출 곱 섬광: 100ms 이하, 화면 전체가 아니라 월드 한 점
      // 자기 중심 스킬은 섬광·임팩트 중심이 영웅 몸통을 하얗게 덮지 않게 발목 높이에 작게 찍는다.
      const self = r.place === 'self';
      _p.copy(_at); _p.y += self ? .35 : 1;
      fx.flash?.(_p, color, { size: (self ? .9 : 1.4) * scale, life: 0.08 });
      // 착탄 중심의 또렷한 임팩트 프레임(코어·별빛·고리, 인스턴스 층 1드로우). 넓은 텍스처 연출 위에 '어디서 터졌는지'를 찍는다.
      fx.impact?.burst?.(_p, color, { size: Math.min(self ? 1.6 : 3.2, (1 + size * 0.14) * scale * (self ? .6 : 1)) });
      // 4) 먼지와 잔상
      if (!lite) {
        _p.copy(_at); _p.y += 0.3;
        fx.burst?.(_p, color, { n: 5, speed: 4, size: 0.3, life: 0.35, up: 0.3, grav: 6 });
        if (r.ghost && player.model) fx.ghost?.(player.model, color, { life: 0.3, opacity: 0.4 });
      }
    }
    // 스킬 고유 모양 언어(광선·지면 표식·고리, 인스턴스 층). 동작 줄이기에서는 생략한다.
    if (!reduced && fx.impact && SKILL_SIGNATURES[skillId]) SKILL_SIGNATURES[skillId]({ fx, impact: fx.impact, player, at: _at, f: _f, lite, scale });
    // 궁극기·50레벨 각성: 지면 링이 전장 반경으로 퍼지고 카메라 펀치 1회
    // 지면 텍스처가 이미 전장 반경(10m 이상)을 덮는 궁극기는 같은 크기의 링을 한 겹 더 쌓지 않는다(바닥 전체가 한 색으로 덮이는 것을 막는다).
    if (major && !crowded && !r.noRune && !(r.mode === 'ground' && size >= 10)) {
      const wide = 10;
      fx.groundTex(_at, skillVfxKey(r.rune), color, { r0: 1, r1: wide, life: 0.9, spin: reduced ? 0 : 0.6, y: 0.06, fadeIn: 0.08, hold: 0.3, gain: groundGain(r.rune) * .8 * g });
    }
    if (major && !crowded && !reduced) game.renderer?.shake?.(0.9);
    return true;
  } finally {
    Math.random = nativeRandom;
  }
}