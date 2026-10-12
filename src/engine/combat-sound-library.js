// 원본 기합·음성은 별도 버스를 유지한다. 아래 자산은 로컬에서 직접 합성한 효과음이다.
const PREFIX = 'crafted/combat-v1/';
export const COMBAT_SOUND_NAMES = Object.freeze([
  'blade', 'heavy', 'dual', 'bow', 'arcane', 'holy', 'earth', 'shadow', 'fire', 'frost', 'storm', 'ultimate',
]);
export const COMBAT_SOUND_FILES = Object.freeze(COMBAT_SOUND_NAMES.map(name => PREFIX + name));

const SKILL_FAMILIES = Object.freeze({
  holy_slash: 'holy', shield_bash: 'earth', judgment: 'holy', dragon_slash: 'holy',
  chain_bind: 'holy', sanctuary: 'holy', sunbreaker: 'holy', heavenfall: 'holy',
  whirlwind: 'heavy', quake: 'earth', berserk: 'earth', hell_axe: 'fire',
  bull_rush: 'heavy', magma_zone: 'fire', bloodquake: 'earth', cataclysm: 'fire',
  fireball: 'fire', chain: 'storm', blizzard: 'frost', meteor: 'fire',
  arc_reflect: 'arcane', chrono_seal: 'arcane', star_prison: 'arcane', absolute_zero: 'frost',
  shadow_dash: 'shadow', poison_bomb: 'shadow', flurry: 'dual', thousand: 'dual',
  shadow_mark: 'shadow', void_step: 'shadow', night_parade: 'shadow', eclipse_edge: 'shadow',
  ranger_pierce: 'bow', ranger_volley: 'bow', ranger_retreat: 'bow', ranger_tempest: 'storm',
  ranger_quickshot: 'bow', ranger_binding: 'bow', gale_hunt: 'bow', skyfall_arrows: 'storm',
});
const HERO_FAMILIES = Object.freeze({ knight: 'holy', barbarian: 'earth', mage: 'arcane', rogue: 'shadow', ranger: 'bow' });

export function attackSound(weapon, ranged = false) {
  const family = weapon === 'bow' ? 'bow' : weapon === 'staff' ? 'arcane'
    : weapon === '2h' ? 'heavy' : weapon === 'dual' ? 'dual' : ranged ? 'arcane' : 'blade';
  return PREFIX + family;
}
export function skillSound(skillId, heroId = '') {
  const family = Object.hasOwn(SKILL_FAMILIES, skillId) ? SKILL_FAMILIES[skillId]
    : Object.hasOwn(HERO_FAMILIES, heroId) ? HERO_FAMILIES[heroId] : 'arcane';
  return PREFIX + family;
}
export const ULTIMATE_SOUND = PREFIX + 'ultimate';

// ---------- 타격 2레이어(트랜지언트 + 바디) · 처치 · 콤보 (hit-v2) ----------
// Kenney Impact/RPG Audio(CC0)를 tools/audio/build-hit-library.py 로 가공한 파일이다. 출처·SHA 는 manifest.json 과
// docs/THIRD_PARTY_CC0_ASSETS.md 에 있다. 이벤트 → 파일 매핑과 이득은 여기 한 곳에서만 정한다.
const HIT_PREFIX = 'hit-v2/';
// 파일 id → 변형 수. 변형 파일 이름은 `<id>_<n>` 이다.
export const HIT_VARIANTS = Object.freeze({
  t_slash: 3, t_blunt: 2, t_magic: 2, t_pierce: 1, t_heavy: 2, t_counter: 1, t_finisher: 2, t_boss: 1, t_crit: 1,
  b_light: 2, b_basic: 2, b_heavy: 2, b_magic: 2, b_counter: 1, b_finisher: 2, b_boss: 1,
  k_pop: 3, k_elite: 1, k_boss: 1,
});
export const COMBO_STINGERS = Object.freeze([
  Object.freeze({ at: 10, id: 'c_10', vol: 0.78, duck: 0 }),
  Object.freeze({ at: 25, id: 'c_25', vol: 0.88, duck: 0.62 }),
  Object.freeze({ at: 50, id: 'c_50', vol: 0.98, duck: 0.4 }),
]);
export const comboSoundName = stinger => HIT_PREFIX + stinger.id;
export const HIT_SOUND_FILES = Object.freeze([
  ...Object.entries(HIT_VARIANTS).flatMap(([id, count]) => Array.from({ length: count }, (_, i) => `${HIT_PREFIX}${id}_${i}`)),
  ...COMBO_STINGERS.map(comboSoundName),
]);
export const HIT_TIERS = Object.freeze(['light', 'basic', 'heavy', 'counter', 'finisher', 'boss']);
// 레이어 우선순위: 보이스 상한(16)에서 가벼운 타격이 먼저 밀려난다. UI 4, Flow 강타 5 와 같은 눈금이다.
export const HIT_PRIORITY = Object.freeze({ light: 1, basic: 2, heavy: 3, counter: 4, finisher: 4, boss: 4 });
// hit 버스 이득. 오프라인 측정(OfflineAudioContext)으로 예전 타격(Kenney 샘플+합성 펀치)보다 같거나 크게 맞췄다.
export const HIT_BUS_GAIN = 1.8;
export const HIT_WINDOW = 0.05; // 이 구간 안의 동시 타격음 상한을 센다.
export const HIT_VOICES = 2;
export const HIT_VOICES_PREMIUM = 3;

/** 이벤트 → 등급. 몹몰이 혼잡도(crowd)가 높으면 일반 타격은 가벼운 등급으로 내려가 소음 덩어리를 막는다. */
export function hitTier({ crit = false, heavy = false, finisher = false, boss = false, counter = false, light = false, crowd = false } = {}) {
  if (counter) return 'counter';
  if (finisher) return boss ? 'boss' : 'finisher';
  if (heavy || crit) return 'heavy';
  return light || crowd ? 'light' : 'basic';
}
/** 반드시 들려야 하는 타격(마무리·보스·카운터)은 창이 차도 3번째 음을 받는다. */
export function isPremiumHit(tier) { return tier === 'counter' || tier === 'finisher' || tier === 'boss'; }

const KIND_TRANSIENT = Object.freeze({ slash: 't_slash', blunt: 't_blunt', magic: 't_magic' });
// 등급별 이득. kind: 무기 종류 트랜지언트, accent: 등급 전용 트랜지언트, body: 저역 바디.
const TIER_MIX = Object.freeze({
  light: { kind: 0.5, accent: null, body: ['b_light', 0.45], rate: 1.1 },
  basic: { kind: 0.62, accent: null, body: ['b_basic', 0.58], rate: 1 },
  heavy: { kind: 0.24, accent: ['t_heavy', 0.66], body: ['b_heavy', 0.7], rate: 1 },
  counter: { kind: 0.16, accent: ['t_counter', 0.74], body: ['b_counter', 0.78], rate: 1 },
  finisher: { kind: 0.2, accent: ['t_finisher', 0.74], body: ['b_finisher', 0.82], rate: 1 },
  boss: { kind: 0.14, accent: ['t_boss', 0.74], body: ['b_boss', 0.84], rate: 1 },
});
export const HIT_CRIT_LAYER = Object.freeze({ id: 't_crit', vol: 0.34, finisherVol: 0.4 });

const layerCache = new Map();
/** 한 번의 타격이 재생할 레이어 목록. 난수 없이 결정적이며 변형 선택은 호출 쪽(오디오 전용 RNG)이 한다.
 *  프레임 루프에서 불리므로 조합별로 한 번만 만들고 얼린 배열을 돌려준다(할당 없음). */
export function hitLayers(kind, tier, { weapon = '', crit = false } = {}) {
  const cacheKey = `${kind}|${tier}|${weapon}|${crit ? 1 : 0}`;
  let layers = layerCache.get(cacheKey);
  if (!layers) {
    layers = Object.freeze(buildHitLayers(kind, tier, weapon, crit).map(layer => Object.freeze(layer)));
    if (layerCache.size < 256) layerCache.set(cacheKey, layers);
  }
  return layers;
}
function buildHitLayers(kind, tier, weapon, crit) {
  const key = Object.hasOwn(TIER_MIX, tier) ? tier : 'basic';
  const mix = TIER_MIX[key], priority = HIT_PRIORITY[key];
  let kindId = Object.hasOwn(KIND_TRANSIENT, kind) ? KIND_TRANSIENT[kind] : KIND_TRANSIENT.slash;
  let kindGain = mix.kind, kindRate = mix.rate;
  if (kindId === 't_slash') {
    if (weapon === 'bow') kindId = 't_pierce';
    else if (weapon === 'dual') { kindRate *= 1.1; kindGain *= 0.9; }
    else if (weapon === '2h') kindRate *= 0.9;
  }
  const layers = [{ id: kindId, vol: kindGain, rate: kindRate, role: 'transient', priority }];
  if (mix.accent) layers.push({ id: mix.accent[0], vol: mix.accent[1], rate: 1, role: 'transient', priority });
  let [bodyId, bodyGain] = mix.body;
  if (kind === 'magic' && (bodyId === 'b_basic' || bodyId === 'b_heavy')) bodyId = 'b_magic';
  else if (key === 'basic' && weapon === '2h') { bodyId = 'b_heavy'; bodyGain *= 0.72; }
  else if (key === 'basic' && weapon === 'dual') { bodyId = 'b_light'; bodyGain *= 1.25; }
  layers.push({ id: bodyId, vol: bodyGain, rate: key === 'light' ? 1.05 : 1, role: 'body', priority });
  if (crit) layers.push({ id: HIT_CRIT_LAYER.id, vol: key === 'finisher' || key === 'boss' ? HIT_CRIT_LAYER.finisherVol : HIT_CRIT_LAYER.vol, rate: 1, role: 'transient', priority });
  return layers;
}

/** 처치 확정음. 보스 > 정예 > 일반. 한꺼번에 많이 쓰러지면 mass 한 번이 대신한다. */
export const KILL_SOUND = Object.freeze({
  normal: Object.freeze({ id: 'k_pop', vol: 0.8, priority: 3 }),
  elite: Object.freeze({ id: 'k_elite', vol: 0.95, priority: 4 }),
  boss: Object.freeze({ id: 'k_boss', vol: 1, priority: 5 }),
  mass: Object.freeze({ id: 'k_elite', vol: 0.75, priority: 4 }),
});
const NAME_CACHE = new Map();
/** `hit-v2/<id>_<variant>` — 프레임 루프에서 문자열을 새로 만들지 않게 한 번만 만든다. */
export function hitSoundName(id, variant = 0) {
  const key = id + '#' + variant;
  let name = NAME_CACHE.get(key);
  if (!name) { name = `${HIT_PREFIX}${id}_${variant}`; NAME_CACHE.set(key, name); }
  return name;
}
