export const LIBRARY_SCHEMA = 'tll.game-asset-library.v1';
export const LOGICAL_CLIPS = ['idle', 'walk', 'run', 'attack', 'attackHeavy', 'hit', 'death'];
export const HERO_LOGICAL_CLIPS = ['idle', 'run', 'dodge', 'hit', 'death', 'cheer', 'interact', 'slash_h', 'slash_d', 'stab', 'spin', 'chop', 'jump_attack', 'block', 'cast_shoot', 'cast_long', 'cast_raise', 'throw', 'bow_shoot'];
// 몬스터 선택 클립: 공격 변주·시전·포효·강피격. 런타임 리그(library)가 논리 키로 고른다.
export const OPTIONAL_CLIPS = ['spawn', 'cast', 'attack2', 'attackSpin', 'attackJump', 'roar', 'raise', 'summon', 'hitHeavy'];
// 공격류 클립만 타격 프레임(클립 길이 대비 접촉 비율)을 가진다.
export const IMPACT_CLIPS = ['attack', 'attack2', 'attackHeavy', 'attackSpin', 'attackJump', 'cast', 'raise', 'summon'];
export const MONSTER_PROFILES = ['brute', 'soldier', 'caster', 'blob', 'flyer', 'drake'];
const digest = /^[a-f0-9]{64}$/;

export function triangleLimit(asset) {
  return asset.kind === 'prop' ? 4000 : asset.boss === true ? 20000 : 12000;
}

export function validateManifest(value) {
  if (!value || value.schema !== LIBRARY_SCHEMA || !Array.isArray(value.assets)) throw new Error('invalid asset library schema');
  const ids = new Set(), replacements = new Set();
  for (const asset of value.assets) {
    if (!asset || typeof asset.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(asset.id) || ids.has(asset.id)) throw new Error('invalid or duplicate asset id');
    ids.add(asset.id);
    if (!['character', 'prop'].includes(asset.kind) || !['biped', 'quadruped', 'none'].includes(asset.body) ||
        (asset.kind === 'prop' && asset.body !== 'none') || (asset.kind === 'character' && asset.body === 'none')) throw new Error('invalid asset kind/body');
    if (asset.role !== undefined && (asset.role !== 'hero' || asset.kind !== 'character' || typeof asset.heroId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(asset.heroId))) throw new Error('invalid hero role');
    if (asset.avatar !== undefined && typeof asset.avatar !== 'boolean') throw new Error('invalid avatar flag');
    if (asset.avatar === true && (asset.role !== 'hero' || asset.armorTier !== undefined)) throw new Error('invalid avatar role/tier');
    if (asset.armorTier !== undefined && (!Number.isInteger(asset.armorTier) || asset.armorTier < 1 || asset.armorTier > 3 || asset.role !== 'hero' || asset.avatar === true)) throw new Error('invalid armor tier');
    if (asset.replaces !== null && (typeof asset.replaces !== 'string' || !asset.replaces || replacements.has(asset.replaces))) throw new Error('invalid or duplicate replaces');
    if (asset.replaces !== null) replacements.add(asset.replaces);
    if (asset.file !== `/models/library/${asset.id}.glb`) throw new Error('invalid asset file');
    if (!Number.isFinite(asset.heightM) || asset.heightM <= 0) throw new Error('invalid asset height');
    if (!Number.isInteger(asset.triangles) || asset.triangles <= 0 || asset.triangles > triangleLimit(asset)) throw new Error('triangle budget exceeded');
    if (!Number.isInteger(asset.bytes) || asset.bytes <= 0 || typeof asset.sha256 !== 'string' || !digest.test(asset.sha256)) throw new Error('invalid artifact digest');
    if (!asset.clips || typeof asset.clips !== 'object' || Array.isArray(asset.clips)) throw new Error('invalid clips');
    if (asset.kind === 'character' && asset.role !== 'hero') for (const key of LOGICAL_CLIPS) {
      if (asset.clips[key] !== key) throw new Error(`missing required clip key: ${key}`);
    }
    for (const [key, name] of Object.entries(asset.clips)) {
      const allowed = asset.role === 'hero' ? HERO_LOGICAL_CLIPS : [...LOGICAL_CLIPS, ...OPTIONAL_CLIPS];
      if (!allowed.includes(key) || typeof name !== 'string' || !name || (asset.role !== 'hero' && name !== key) || asset.kind === 'prop') throw new Error('invalid logical clip mapping');
    }
    const provenance = asset.provenance;
    if (!provenance || typeof provenance.rawSha256 !== 'string' || !digest.test(provenance.rawSha256) ||
        !['tool', 'account', 'taskId', 'prompt', 'createdAt'].every((key) => typeof provenance[key] === 'string') ||
        !provenance.tool || !Number.isFinite(Date.parse(provenance.createdAt))) throw new Error('invalid provenance');
    if (typeof asset.shared !== 'boolean' || typeof asset.license !== 'string' || !asset.license) throw new Error('invalid sharing/license');
    if (asset.boss !== undefined && typeof asset.boss !== 'boolean') throw new Error('invalid boss flag');
    if (asset.impacts !== undefined) {
      if (!asset.impacts || typeof asset.impacts !== 'object' || Array.isArray(asset.impacts) || asset.role === 'hero') throw new Error('invalid impacts');
      for (const [key, value] of Object.entries(asset.impacts)) {
        if (!IMPACT_CLIPS.includes(key) || asset.clips[key] !== key || !Number.isFinite(value) || value <= 0.05 || value >= 0.95) throw new Error(`invalid impact: ${key}`);
      }
    }
    if (asset.profile !== undefined && (asset.role === 'hero' || !MONSTER_PROFILES.includes(asset.profile))) throw new Error('invalid monster profile');
    if (asset.hover !== undefined && (!Number.isFinite(asset.hover) || asset.hover < 0 || asset.hover > 3)) throw new Error('invalid hover');
  }
  return value;
}
