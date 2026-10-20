import * as THREE from 'three';
import { VFX_TEX } from './assets.js';
import { HERO_SKILLS } from './combat-sound-library.js';
import { normalizeGrade } from '../data/hero-grades.js';

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

/** 40개 스킬 ID → 레시피. place: self(시전자) / front(전방 dist) / aim(조준점, 없으면 전방). mode: flash(빌보드) / ground(지면). */
export const SKILL_VFX = Object.freeze({
  // 검성
  holy_slash: R(GOLD, 'holy-wave', 'front', 'flash', 0xffd060, 5, { dist: 3 }),
  shield_bash: R(GOLD, 'lava-crack', 'aim', 'ground', 0xffe0a0, 6, { dist: 1.5 }),
  judgment: R(GOLD, 'holy-wave', 'self', 'flash', 0xfff3b0, 6),
  dragon_slash: R(GOLD, 'holy-wave', 'front', 'flash', 0xffd060, 10, { dist: 4 }),
  chain_bind: R(GOLD, 'chain-lightning', 'self', 'flash', 0xfff0b0, 6),
  sanctuary: R(GOLD, 'holy-wave', 'self', 'ground', 0xffe9a0, 8),
  sunbreaker: R(GOLD, 'holy-wave', 'front', 'flash', 0xffc040, 9, { dist: 4 }),
  heavenfall: R(GOLD, 'holy-wave', 'aim', 'flash', 0xfff0a0, 11, { dist: 8 }),
  // 광전사
  whirlwind: R(GOLD, 'lava-crack', 'self', 'ground', 0xff7a4a, 5),
  quake: R(GOLD, 'lava-crack', 'aim', 'ground', 0xff9a4a, 8, { dist: 1.5 }),
  berserk: R(VIOLET, 'lava-crack', 'self', 'ground', 0xff3030, 6),
  hell_axe: R(GOLD, 'meteor', 'aim', 'flash', 0xff7a30, 10, { dist: 8 }),
  bull_rush: R(GOLD, 'lava-crack', 'front', 'ground', 0xff6a30, 6, { dist: 5 }),
  magma_zone: R(GOLD, 'lava-crack', 'self', 'ground', 0xff5a20, 8),
  bloodquake: R(VIOLET, 'lava-crack', 'self', 'ground', 0xd02020, 9),
  cataclysm: R(GOLD, 'meteor', 'aim', 'flash', 0xff5a3c, 12, { dist: 6 }),
  // 대마도사
  fireball: R(GOLD, 'meteor', 'front', 'flash', 0xff7228, 4, { dist: 3 }),
  chain: R(VIOLET, 'chain-lightning', 'self', 'flash', 0x70b8ff, 6),
  blizzard: R(VIOLET, 'ice-burst', 'self', 'ground', 0x72dfff, 7),
  meteor: R(GOLD, 'meteor', 'aim', 'flash', 0xff8a40, 11, { dist: 9 }),
  arc_reflect: R(VIOLET, 'chain-lightning', 'front', 'flash', 0x9fd8ff, 5, { dist: 4 }),
  chrono_seal: R(VIOLET, 'ice-burst', 'self', 'ground', 0xc0d8ff, 9),
  star_prison: R(VIOLET, 'ice-burst', 'aim', 'ground', 0x74c8ff, 9, { dist: 8 }),
  absolute_zero: R(VIOLET, 'ice-burst', 'aim', 'ground', 0xccecff, 12, { dist: 9 }),
  // 암살자
  shadow_dash: R(VIOLET, 'shadow-slash', 'front', 'flash', 0xb26bff, 5, { dist: 3, ghost: true }),
  poison_bomb: R(VIOLET, 'shadow-slash', 'aim', 'ground', 0x70e060, 6, { dist: 6 }),
  flurry: R(VIOLET, 'shadow-slash', 'front', 'flash', 0xd0a0ff, 4, { dist: 2, ghost: true }),
  thousand: R(VIOLET, 'shadow-slash', 'self', 'ground', 0xd0a0ff, 11, { ghost: true }),
  shadow_mark: R(VIOLET, 'shadow-slash', 'self', 'ground', 0xb26bff, 7),
  void_step: R(VIOLET, 'shadow-slash', 'self', 'flash', 0x8a4aff, 7, { ghost: true }),
  night_parade: R(VIOLET, 'shadow-slash', 'aim', 'ground', 0xb26bff, 8, { dist: 6, ghost: true }),
  eclipse_edge: R(VIOLET, 'shadow-slash', 'aim', 'flash', 0xb26bff, 11, { dist: 8, ghost: true }),
  // 레인저
  ranger_pierce: R(GOLD, 'wind-arrow-trail', 'front', 'flash', 0x7feac0, 5, { dist: 4 }),
  ranger_volley: R(GOLD, 'wind-arrow-trail', 'front', 'flash', 0x7feac0, 6, { dist: 4 }),
  ranger_retreat: R(GOLD, 'wind-arrow-trail', 'self', 'flash', 0x7feac0, 4),
  ranger_tempest: R(GOLD, 'wind-arrow-trail', 'front', 'flash', 0x7feac0, 10, { dist: 5 }),
  ranger_quickshot: R(GOLD, 'wind-arrow-trail', 'front', 'flash', 0x9fffd8, 5, { dist: 4 }),
  ranger_binding: R(GOLD, 'wind-arrow-trail', 'front', 'ground', 0x63e08a, 6, { dist: 4 }),
  gale_hunt: R(GOLD, 'wind-arrow-trail', 'front', 'flash', 0x7feac0, 8, { dist: 5 }),
  skyfall_arrows: R(GOLD, 'wind-arrow-trail', 'aim', 'ground', 0x7feac0, 12, { dist: 9 }),
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
const LAYER_CAP = 60, LAYER_CAP_LITE = 28;
// 표시 전용 난수. 전투·드랍의 Math.random 진행을 바꾸지 않는다.
let seed = 0x2f6e2b1;
const vfxRandom = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/**
 * 스킬 시전 순간의 장악 레이어. 판정·피해·타이밍은 건드리지 않는다.
 * @returns {boolean} 레시피를 실행했는지
 */
export function castSkillVfx(game, skillId, player, ctx = null) {
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
    else _at.copy(player.pos).addScaledVector(_f, r.dist || 3);
    _at.y = player.pos.y;
    const size = r.size * scale, color = r.color;
    // 1) 바닥 룬 서클
    const runeR = (1.8 + size * 0.28) * (r.place === 'self' ? 1 : 0.9);
    fx.groundTex(_at, skillVfxKey(r.rune), color, { r0: runeR * 0.35, r1: runeR, life: 0.55, spin: reduced ? 0 : 1.4, y: 0.07, fadeIn: 0.15, hold: 0.3 });
    // 2) 스킬 텍스처
    if (r.mode === 'ground') fx.groundTex(_at, skillVfxKey(r.tex), color, { r0: size * 0.3, r1: size, life: 0.6, spin: reduced ? 0 : 0.5, y: 0.09, fadeIn: 0.1 });
    else fx.texFlash(_at, skillVfxKey(r.tex), color, { size, life: 0.45, spin: reduced ? 0 : 0.6, grow: 1.1, y: 1 });
    if (!reduced && !crowded) {
      // 3) 노출 곱 섬광: 100ms 이하, 화면 전체가 아니라 월드 한 점
      _p.copy(_at); _p.y += 1;
      fx.flash?.(_p, color, { size: 1.4 * scale, life: 0.08 });
      // 4) 먼지와 잔상
      if (!lite) {
        _p.copy(_at); _p.y += 0.3;
        fx.burst?.(_p, color, { n: 5, speed: 4, size: 0.3, life: 0.35, up: 0.3, grav: 6 });
        if (r.ghost && player.model) fx.ghost?.(player.model, color, { life: 0.3, opacity: 0.4 });
      }
    }
    // 궁극기·50레벨 각성: 지면 링이 전장 반경으로 퍼지고 카메라 펀치 1회
    if (major && !crowded) {
      const wide = 10;
      fx.groundTex(_at, skillVfxKey(r.rune), color, { r0: 1, r1: wide, life: 0.9, spin: reduced ? 0 : 0.6, y: 0.06, fadeIn: 0.08, hold: 0.3 });
      if (!reduced) game.renderer?.shake?.(0.9);
    }
    return true;
  } finally {
    Math.random = nativeRandom;
  }
}