import { HEROES } from './heroes.js';

export const HERO_LOGICAL_CLIPS = Object.freeze([
  'idle', 'run', 'dodge', 'hit', 'death', 'cheer', 'interact', 'slash_h', 'slash_d', 'stab', 'spin', 'chop',
  'jump_attack', 'block', 'cast_shoot', 'cast_long', 'cast_raise', 'throw', 'bow_shoot',
]);

// 손 소켓 그룹 이름. GLTFLoader 가 노드 이름의 '.'·':' 를 지우므로 기호 없는 이름을 쓴다.
export const LIBRARY_SOCKET_NAMES = Object.freeze({ 'handslot.r': 'LibrarySocket_r', 'handslot.l': 'LibrarySocket_l' });

// Mixamo 손 본(Y=손가락 방향, Z=손등 위)을 KayKit handslot 프레임(X=손가락 방향, Y=전방, Z=위)으로 맞추는 회전(라디안, XYZ).
// 2026-10-12 bone_knight.glb rest 포즈 측정: 오른손 Z+90°, 왼손 Z-90° 에서 소켓 Y·전방 0.91, 소켓 Z·위 0.98.
const MIXAMO_GRIP = Object.freeze({ r: Object.freeze([0, 0, Math.PI / 2]), l: Object.freeze([0, 0, -Math.PI / 2]) });
export const HERO_HAND_GRIP = Object.freeze({
  knight: MIXAMO_GRIP, barbarian: MIXAMO_GRIP, mage: MIXAMO_GRIP, rogue: MIXAMO_GRIP, ranger: MIXAMO_GRIP,
});
// KayKit 영웅 handslot 의 T포즈 높이(Knight/Rogue/Ranger 공통 측정값). 라이브러리 영웅 손 높이와의 비로 무기 크기를 맞춘다.
export const KAYKIT_HANDSLOT_REST_HEIGHT = 1.049;

export function heroGripRotation(heroId, side) {
  const grip = HERO_HAND_GRIP[heroId] || MIXAMO_GRIP;
  return [...grip[side]];
}

/** 손 본의 월드 스케일을 상쇄하고 KayKit 대비 손 높이 비율만 남긴다. */
export function librarySocketScale(handWorldScale, handRestHeight) {
  if (!(handWorldScale > 0) || !(handRestHeight > 0)) throw new Error('invalid hero hand transform');
  return handRestHeight / KAYKIT_HANDSLOT_REST_HEIGHT / handWorldScale;
}

export function armorAppearanceTier(item) {
  if ([1, 2, 3].includes(item?.appearanceTier)) return item.appearanceTier;
  if (item?.rarity === 'L') return 3;
  if (item?.rarity === 'E' || item?.rarity === 'U') return 2;
  return 1;
}

/** 장착 인스턴스의 appearanceTier → 아이템 정의 → 등급 순. 갑옷이 없으면 1단계. */
export function heroAppearanceTier(equip = {}, definitions = {}) {
  const instance = equip?.armor, armor = instance?.id ? definitions[instance.id] : null;
  if (!armor || (armor.slot && armor.slot !== 'armor')) return 1;
  return [1, 2, 3].includes(instance.appearanceTier) ? instance.appearanceTier : armorAppearanceTier(armor);
}

/** 요청 단계부터 낮은 단계 순으로 찾고, 모두 없으면 기존 KayKit 모델을 쓴다. */
export function heroTierCandidates(tier) {
  const top = Math.min(3, Math.max(1, Math.trunc(tier) || 1));
  return [...Array.from({ length: top }, (_, index) => top - index), 'legacy'];
}

/** tier 간 같은 스켈레톤을 쓰므로 클립이 있는 단계의 AnimationClip 을 영웅 단위로 캐시해 나눠 쓴다. */
export function resolveSharedHeroClips(cache, heroId, asset, animations) {
  if (animations.length) {
    if (!cache.has(heroId) || (asset.armorTier || 1) < (cache.get(heroId).asset.armorTier || 1)) cache.set(heroId, { asset, clips: animations });
    return { animations, clipAsset: asset };
  }
  const shared = cache.get(heroId);
  if (!shared) throw new Error(`hero clips unavailable: ${heroId}`);
  return { animations: shared.clips, clipAsset: shared.asset };
}

const BASE_ALIASES = Object.freeze({
  Idle: 'idle', Running_A: 'run', Dodge_Forward: 'dodge', Hit_A: 'hit', Hit_B: 'hit', Hit_L: 'hit', Hit_R: 'hit', Death_A: 'death', Death_B: 'death',
  Cheer: 'cheer', Interact: 'interact', Spellcasting: 'cast_raise',
});

const ANIMATION_TO_LOGICAL = Object.freeze({
  '1H_Melee_Attack_Slice_Horizontal': 'slash_h',
  '1H_Melee_Attack_Slice_Diagonal': 'slash_d',
  '1H_Melee_Attack_Stab': 'stab',
  '1H_Melee_Attack_Chop': 'chop',
  '2H_Melee_Attack_Slice': 'slash_h',
  '2H_Melee_Attack_Stab': 'stab',
  '2H_Melee_Attack_Spin': 'spin',
  '2H_Melee_Attack_Spinning': 'spin',
  '2H_Melee_Attack_Chop': 'chop',
  'Dualwield_Melee_Attack_Slice': 'slash_h',
  'Dualwield_Melee_Attack_Chop': 'chop',
  'Dualwield_Melee_Attack_Stab': 'stab',
  Jump_Full_Short: 'jump_attack',
  Block_Hit: 'block',
  Spellcast_Shoot: 'cast_shoot',
  Spellcast_Long: 'cast_long',
  Spellcast_Raise: 'cast_raise',
  Throw: 'throw',
  Bow_Shoot: 'bow_shoot',
});

const FALLBACKS = Object.freeze({
  idle: ['idle', 'interact', 'run'], run: ['run', 'walk', 'idle'], dodge: ['dodge', 'run', 'walk', 'idle'],
  hit: ['hit', 'idle'], death: ['death', 'hit', 'idle'], cheer: ['cheer', 'interact', 'idle'], interact: ['interact', 'idle'],
  slash_h: ['slash_h', 'slash_d', 'stab', 'chop', 'spin', 'idle'], slash_d: ['slash_d', 'slash_h', 'stab', 'chop', 'idle'],
  stab: ['stab', 'slash_h', 'slash_d', 'chop', 'idle'], spin: ['spin', 'slash_h', 'chop', 'stab', 'idle'],
  chop: ['chop', 'slash_h', 'stab', 'spin', 'idle'], jump_attack: ['jump_attack', 'chop', 'spin', 'slash_h', 'idle'],
  block: ['block', 'chop', 'slash_h', 'hit', 'idle'], cast_shoot: ['cast_shoot', 'cast_long', 'cast_raise', 'idle'],
  cast_long: ['cast_long', 'cast_shoot', 'cast_raise', 'idle'], cast_raise: ['cast_raise', 'cast_long', 'cast_shoot', 'idle'],
  throw: ['throw', 'cast_shoot', 'slash_h', 'idle'], bow_shoot: ['bow_shoot', 'cast_shoot', 'slash_h', 'idle'],
});

// 애니메이션 팩(h4-anim, src/data/anim-packs-v1.json) 클립으로 바꿔 끼우는 원본 별칭. 팩 클립이 실제로 로드됐을 때만 쓴다.
// Hit_A=가벼운 움츠림(원본), Hit_B=강타 넉백, Hit_L/Hit_R=왼쪽/오른쪽에서 맞음, Death_A=앞으로 무너짐(제자리), Death_B=뒤로 쓰러짐.
// 도적·궁수의 사망·회피·찌르기는 몸체별 저작 보정(hero-body-motion)과 활 접지 계약이 원본 클립에 묶여 있어 바꾸지 않는다.
const PACK_HITS = Object.freeze({ Hit_B: 'hit_heavy', Hit_L: 'hit_left', Hit_R: 'hit_right' });
export const HERO_PACK_ALIASES = Object.freeze({
  knight: Object.freeze({ ...PACK_HITS, Death_A: 'death_fwd', Death_B: 'death_back',
    '1H_Melee_Attack_Slice_Diagonal': 'slash_d_ip', '1H_Melee_Attack_Stab': 'stab_ip', '2H_Melee_Attack_Chop': 'chop_heavy' }),
  barbarian: Object.freeze({ ...PACK_HITS, Death_A: 'death_fwd', Death_B: 'death_back',
    '2H_Melee_Attack_Stab': 'stab_ip', '2H_Melee_Attack_Spinning': 'spin_ip', '2H_Melee_Attack_Spin': 'spin_whirl', Jump_Full_Short: 'jump_attack_ip' }),
  mage: Object.freeze({ ...PACK_HITS, Death_A: 'death_fwd', Death_B: 'death_back' }),
  rogue: Object.freeze({ ...PACK_HITS }),
  ranger: Object.freeze({ ...PACK_HITS }),
});

const unique = (values) => [...new Set(values)];

export function heroIdForModel(modelName) {
  return Object.values(HEROES).find((hero) => hero.model === modelName)?.id || null;
}

export function logicalClipForAnimation(animationName) {
  if (ANIMATION_TO_LOGICAL[animationName]) return ANIMATION_TO_LOGICAL[animationName];
  if (/^Idle/.test(animationName)) return 'idle';
  if (/Run|Walk/.test(animationName)) return 'run';
  if (/Dodge/.test(animationName)) return 'dodge';
  if (/Hit/.test(animationName)) return 'hit';
  if (/Death/.test(animationName)) return 'death';
  if (/Cheer/.test(animationName)) return 'cheer';
  if (/Interact/.test(animationName)) return 'interact';
  if (/Bow/.test(animationName)) return 'bow_shoot';
  if (/Spellcast|Spellcasting/.test(animationName)) return 'cast_shoot';
  if (/Throw/.test(animationName)) return 'throw';
  if (/Block/.test(animationName)) return 'block';
  if (/Spin/.test(animationName)) return 'spin';
  if (/Chop|Jump/.test(animationName)) return 'chop';
  if (/Stab/.test(animationName)) return 'stab';
  if (/Slice/.test(animationName)) return 'slash_h';
  return 'idle';
}

function requiredSourceAliases(heroId) {
  const hero = HEROES[heroId];
  if (!hero) throw new Error(`invalid hero id: ${heroId}`);
  return unique([
    ...Object.keys(BASE_ALIASES),
    ...hero.combo.map((step) => step.anim),
    ...hero.skills.map((skill) => skill.anim),
    ...(heroId === 'mage' ? ['Spellcasting'] : []),
  ]);
}

function actualClip(asset, logical) {
  const clips = asset.clips || {};
  for (const key of FALLBACKS[logical] || ['idle']) if (typeof clips[key] === 'string') return clips[key];
  throw new Error(`hero asset has no usable clip for ${logical}`);
}

export function requiredHeroLogicalClips(heroId) {
  return unique(requiredSourceAliases(heroId).map((name) => logicalClipForAnimation(name)));
}

// 'mixamorig:RightHand', 'mixamorigRightHand'(GLTFLoader 정리 후), 'mixamorig1:RightHand', 'right_hand', 'RightHandBone' 을 받는다.
const handPattern = (side) => new RegExp(`^(?:mixamorig\\d*[:_]?)?${side}_?hand(?:bone)?$`, 'i');

function findHand(scene, side) {
  const pattern = handPattern(side);
  let result = null;
  scene.traverse((node) => { if (!result && pattern.test(node.name || '')) result = node; });
  return result;
}

/** 무기 없는 라이브러리 영웅 GLB 의 실제 손 본 이름. */
export function heroHandBones(scene) {
  const right = findHand(scene, 'right'), left = findHand(scene, 'left');
  if (!right || !left) throw new Error('hero hand bones not found');
  return { r: right.name, l: left.name };
}

/** clipAsset: 클립을 실제로 가진 단계(공유 클립의 원본). 손 소켓 그룹은 호출 전에 만들어져 있어야 한다.
 * animations: 실제 로드된 클립(팩 클립 포함). 주면 팩 클립이 있는 별칭을 팩 클립으로 잇는다. */
export function heroModelContract(asset, scene, clipAsset = asset, animations = null) {
  if (asset?.role !== 'hero' || !asset.heroId || !HEROES[asset.heroId]) throw new Error('invalid hero asset contract');
  const aliases = {}, pack = HERO_PACK_ALIASES[asset.heroId] || {};
  const loaded = animations ? new Set(animations.map((clip) => clip.name)) : null;
  for (const source of requiredSourceAliases(asset.heroId)) {
    const packed = pack[source];
    aliases[source] = packed && loaded?.has(packed) ? packed : actualClip(clipAsset, logicalClipForAnimation(source));
  }
  return { materials: 'authored', role: 'hero', heroId: asset.heroId, scale: 1, aliases, sockets: { ...LIBRARY_SOCKET_NAMES }, handBones: heroHandBones(scene) };
}

export const heroAnimationMap = Object.freeze({ ...ANIMATION_TO_LOGICAL });
