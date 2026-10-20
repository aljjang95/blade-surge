// 모든 효과음은 Mirelo SFX 1.5(Runware mirelo:1@1)로 만든 public/sfx/mirelo-v1/ 라이브러리다.
// 작업 목록은 tools/audio/mirelo-sfx-jobs.mjs, 후처리는 tools/audio/mirelo-postprocess.py, 출처·SHA 는 manifest.json.
// 원본 기합·음성(TTS)은 별도 버스를 유지한다. 이벤트 → 파일 매핑은 여기 한 곳에서만 정한다.
export const SFX_LIBRARY = 'mirelo-v1/';
const PREFIX = SFX_LIBRARY + 'hero/';
export const HERO_IDS = Object.freeze(['knight', 'barbarian', 'mage', 'rogue', 'ranger']);
// 무기 → 영웅. 다섯 영웅의 무기가 서로 달라 호출부가 영웅 id를 넘기지 않아도 영웅별 소리를 고른다.
export const HERO_BY_WEAPON = Object.freeze({ '1h': 'knight', '2h': 'barbarian', staff: 'mage', dual: 'rogue', bow: 'ranger' });
export const SWING_VARIANTS = 3;
export const HERO_HIT_VARIANTS = 2;
export const HERO_SKILLS = Object.freeze({
  knight: Object.freeze(['holy_slash', 'shield_bash', 'judgment', 'dragon_slash', 'chain_bind', 'sanctuary', 'sunbreaker', 'heavenfall']),
  barbarian: Object.freeze(['whirlwind', 'quake', 'berserk', 'hell_axe', 'bull_rush', 'magma_zone', 'bloodquake', 'cataclysm']),
  mage: Object.freeze(['fireball', 'chain', 'blizzard', 'meteor', 'arc_reflect', 'chrono_seal', 'star_prison', 'absolute_zero']),
  rogue: Object.freeze(['shadow_dash', 'poison_bomb', 'flurry', 'thousand', 'shadow_mark', 'void_step', 'night_parade', 'eclipse_edge']),
  ranger: Object.freeze(['ranger_pierce', 'ranger_volley', 'ranger_retreat', 'ranger_tempest', 'ranger_quickshot', 'ranger_binding', 'gale_hunt', 'skyfall_arrows']),
});
const SKILL_OWNER = Object.freeze(Object.fromEntries(Object.entries(HERO_SKILLS).flatMap(([hero, ids]) => ids.map(id => [id, hero]))));
export const heroForWeapon = (weapon) => Object.hasOwn(HERO_BY_WEAPON, weapon) ? HERO_BY_WEAPON[weapon] : 'knight';
const heroOr = (heroId, weapon) => HERO_IDS.includes(heroId) ? heroId : heroForWeapon(weapon);
/** 영웅 한 명이 쓰는 파일 전체(휘두름·마무리·타격·궁극기 충격·스킬 8). 영웅을 고를 때 지연 로드한다. */
export function heroSoundFiles(heroId) {
  const h = heroOr(heroId, '');
  return [
    ...Array.from({ length: SWING_VARIANTS }, (_, i) => `${PREFIX}${h}/swing_${i}`),
    `${PREFIX}${h}/finisher`,
    ...Array.from({ length: HERO_HIT_VARIANTS }, (_, i) => `${PREFIX}${h}/hit_${i}`),
    `${PREFIX}${h}/ult_impact`,
    ...HERO_SKILLS[h].map(id => `${PREFIX}${h}/skill_${id}`),
  ];
}
export const COMBAT_SOUND_FILES = Object.freeze(HERO_IDS.flatMap(heroSoundFiles));

/** 일반 공격 휘두름: 영웅별 3변형, 마무리 타는 영웅별 전용음. variant 는 호출 쪽(오디오 전용 RNG)이 고른다. */
export function attackSound(weapon, ranged = false, { finisher = false, variant = 0, hero = '' } = {}) {
  const h = heroOr(hero, weapon);
  return finisher ? `${PREFIX}${h}/finisher` : `${PREFIX}${h}/swing_${Math.abs(variant | 0) % SWING_VARIANTS}`;
}
/** 스킬 시전음: 40개 스킬마다 고유. 모르는 스킬은 그 영웅의 마무리음으로 내려간다. */
export function skillSound(skillId, heroId = '') {
  if (Object.hasOwn(SKILL_OWNER, skillId)) return `${PREFIX}${SKILL_OWNER[skillId]}/skill_${skillId}`;
  return `${PREFIX}${heroOr(heroId, '')}/finisher`;
}
/** 궁극기 충격음: 영웅별 전용. */
export const ultimateSound = (heroId) => `${PREFIX}${heroOr(heroId, '')}/ult_impact`;
export const ULTIMATE_SOUND = ultimateSound('knight');
/** 영웅 전용 타격음(무기가 적에 닿는 소리). */
export const heroHitSound = (heroId, variant = 0) => `${PREFIX}${heroOr(heroId, '')}/hit_${Math.abs(variant | 0) % HERO_HIT_VARIANTS}`;

// ---------- 공용 효과(예전 실시간 합성음 대체) ----------
export const FX_VARIANTS = Object.freeze({
  whoosh: 3, boom: 2, zap: 2, magic: 2, fire: 1, ice: 1, holy: 1, dark: 1, suck: 1, buff: 1, charge: 1, clang: 2, thump: 1, ting: 1,
  shatter: 1, levelup: 1, fail: 1, hurt: 2, dodge: 2, dodge_perfect: 1, tele_melee: 1, tele_magic: 1, tele_slam: 1, rel_melee: 1, rel_magic: 1, rel_slam: 1,
});
export const FX_SOUND_FILES = Object.freeze(Object.entries(FX_VARIANTS).flatMap(([id, n]) => Array.from({ length: n }, (_, i) => `${SFX_LIBRARY}fx/${id}_${i}`)));
// UI·보상: 예전 파일 이름(ui_click 등)을 그대로 쓰고 실제 파일만 mirelo-v1/ui/ 로 옮긴다.
export const UI_SOUND_NAMES = Object.freeze(['hit_punch0', 'hit_punch1', 'hit_punch2', 'hit_metal0', 'hit_metal1', 'hit_metal2', 'hit_soft0', 'hit_soft1', 'hit_bell', 'hit_mining', 'hit_wood', 'hit_plate', 'hit_glass',
  'ui_click', 'ui_confirm', 'ui_select', 'ui_back', 'ui_error', 'ui_open', 'ui_close', 'ui_max', 'ui_drop', 'ui_bong', 'ui_glass', 'ui_pluck',
  'coin0', 'coin1', 'coin_stack', 'pack_open', 'card_fan', 'card_place', 'jingle_win0', 'jingle_win1', 'jingle_legend']);
/** 버퍼 이름 → 실제 파일 경로(/sfx/... .mp3). */
export function sfxUrl(name) {
  return UI_SOUND_NAMES.includes(name) ? `/sfx/${SFX_LIBRARY}ui/${name}.mp3` : `/sfx/${name}.mp3`;
}

// ---------- 타격 2레이어(트랜지언트 + 바디) · 처치 · 콤보 ----------
// 파일 id 는 예전 hit-v2 와 같고 소리만 Mirelo 로 새로 만들었다.
const HIT_PREFIX = SFX_LIBRARY + 'hit/';
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
/** 한 타격의 레이어 이득 합 상한. 배송 타격 파일의 디코드 피크가 0.94 이하라 모든 레이어 피크가 겹쳐도 약 1.70 아래다. */
export const HIT_VOL_BUDGET = 1.8;

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
  // 영웅 전용 무기 접촉음을 얹어 다섯 영웅의 타격이 서로 다르게 들리게 한다. 공용 접촉음은 절반으로, 등급 악센트는 0.6배로
  // 줄이고 영웅 접촉음을 가장 큰 접촉 성분으로 둔다(강타·마무리에서도 영웅 소리가 묻히지 않는다).
  const armed = Object.hasOwn(HERO_BY_WEAPON, weapon), accentGain = mix.accent ? mix.accent[1] : 0;
  if (armed) {
    layers[0].vol = kindGain * 0.5;
    layers.push({ id: 'hero', hero: HERO_BY_WEAPON[weapon], vol: Math.max(0.3, kindGain, accentGain * 0.75) * 0.95, rate: kindRate, role: 'hero', priority });
  }
  if (mix.accent) layers.push({ id: mix.accent[0], vol: accentGain * (armed ? 0.6 : 1), rate: 1, role: 'transient', priority });
  let [bodyId, bodyGain] = mix.body;
  if (kind === 'magic' && (bodyId === 'b_basic' || bodyId === 'b_heavy')) bodyId = 'b_magic';
  else if (key === 'basic' && weapon === '2h') { bodyId = 'b_heavy'; bodyGain *= 0.72; }
  else if (key === 'basic' && weapon === 'dual') { bodyId = 'b_light'; bodyGain *= 1.25; }
  layers.push({ id: bodyId, vol: bodyGain, rate: key === 'light' ? 1.05 : 1, role: 'body', priority });
  if (crit) layers.push({ id: HIT_CRIT_LAYER.id, vol: key === 'finisher' || key === 'boss' ? HIT_CRIT_LAYER.finisherVol : HIT_CRIT_LAYER.vol, rate: 1, role: 'transient', priority });
  // 이득 합이 상한을 넘으면 비율을 지킨 채 함께 줄인다(치명타 마무리·보스처럼 레이어가 많은 타격의 클리핑 방지).
  const total = layers.reduce((sum, layer) => sum + layer.vol, 0);
  if (total > HIT_VOL_BUDGET) for (const layer of layers) layer.vol *= HIT_VOL_BUDGET / total;
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
