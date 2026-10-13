import { expect, test } from 'bun:test';
import * as THREE from 'three';
import {
  HERO_HAND_GRIP, LIBRARY_SOCKET_NAMES, heroAppearanceTier, heroGripRotation, heroHandBones, heroModelContract, heroTierCandidates,
  librarySocketScale, logicalClipForAnimation, requiredHeroLogicalClips, resolveSharedHeroClips,
} from '../src/data/hero-library.js';
import { libraryAssetForHero, selectHeroLibraryAsset } from '../src/engine/library-assets.js';
import { validateManifest } from '../tools/asset-library/manifest.mjs';
import { HEROES } from '../src/data/heroes.js';
import { Actor } from '../src/game/actor.js';
import { Player } from '../src/game/player.js';

const SCHEMA = 'tll.game-asset-library.v1';
const hero = (id: string, armorTier?: number, clips: Record<string, string> = { idle: 'idle', run: 'run', hit: 'hit', death: 'death' }) => ({
  id, kind: 'character', role: 'hero', heroId: 'knight', body: 'biped', replaces: null,
  file: '/models/library/' + id + '.glb', heightM: 1.6, triangles: 1, bytes: 1, sha256: 'a'.repeat(64), clips,
  provenance: { tool: 'Blender 5.2', account: 'owner subscription', taskId: '', prompt: '', createdAt: '2026-10-12T00:00:00.000Z', rawSha256: 'b'.repeat(64) },
  license: 'owner-generated', shared: true, ...(armorTier ? { armorTier } : {}),
});
const manifestOf = (...assets: object[]) => ({ schema: SCHEMA, assets });

function handScene(right: string, left: string, extra: string[] = []) {
  const scene = new THREE.Group();
  for (const name of [...extra, right, left]) { const bone = new THREE.Bone(); bone.name = name; scene.add(bone); }
  return scene;
}

test('manifest accepts hero role and optional armorTier 1|2|3 only', () => {
  expect(validateManifest(manifestOf(hero('hero_knight_t1'))).assets[0].heroId).toBe('knight');
  expect(validateManifest(manifestOf(hero('hero_knight_t3', 3, {}))).assets[0].armorTier).toBe(3);
  expect(() => validateManifest(manifestOf({ ...hero('hero_knight_t1'), heroId: '' }))).toThrow('invalid hero role');
  expect(() => validateManifest(manifestOf(hero('hero_knight_t4', 4)))).toThrow('invalid armor tier');
  expect(() => validateManifest(manifestOf({ ...hero('hero_knight_t1'), armorTier: 1.5 }))).toThrow('invalid armor tier');
  expect(() => validateManifest(manifestOf(hero('hero_knight_t1', 1, { idle: 'idle', unknown: 'x' })))).toThrow('invalid logical clip mapping');
  const monster = { ...hero('monster_t2', 2), role: undefined, clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack', attackHeavy: 'attackHeavy', hit: 'hit', death: 'death' } };
  expect(() => validateManifest(manifestOf(monster))).toThrow('invalid armor tier');
});

test('armor appearance tier: instance tier, then item tier, then rarity; no armor is tier 1', () => {
  const defs = { a_n: { slot: 'armor', rarity: 'N' }, a_s: { slot: 'armor', rarity: 'S' }, a_e: { slot: 'armor', rarity: 'E' }, a_u: { slot: 'armor', rarity: 'U' },
    a_l: { slot: 'armor', rarity: 'L' }, a_town: { slot: 'armor', rarity: 'L', appearanceTier: 2 }, w_l: { slot: 'weapon', rarity: 'L' } };
  const armor = (id: string, appearanceTier?: number) => heroAppearanceTier({ armor: { id, enh: 0, ...(appearanceTier ? { appearanceTier } : {}) } }, defs);
  expect([armor('a_n'), armor('a_s'), armor('a_e'), armor('a_u'), armor('a_l')]).toEqual([1, 1, 2, 2, 3]);
  expect(armor('a_town')).toBe(2);
  expect(armor('a_n', 3)).toBe(3);
  expect(heroAppearanceTier({}, defs)).toBe(1);
  expect(heroAppearanceTier({ armor: null, weapon: { id: 'w_l', enh: 0 } }, defs)).toBe(1);
  expect(heroAppearanceTier({ armor: { id: 'w_l', enh: 0 } }, defs)).toBe(1);
});

test('tier fallback picks the closest lower tier, then the legacy KayKit model', () => {
  expect(heroTierCandidates(3)).toEqual([3, 2, 1, 'legacy']);
  expect(heroTierCandidates(1)).toEqual([1, 'legacy']);
  const sparse = manifestOf(hero('hero_knight_t1', 1), hero('hero_knight_t3', 3, {}));
  expect(selectHeroLibraryAsset(sparse, 'knight', 3)?.id).toBe('hero_knight_t3');
  expect(selectHeroLibraryAsset(sparse, 'knight', 2)?.id).toBe('hero_knight_t1');
  expect(selectHeroLibraryAsset(manifestOf(hero('hero_knight_t1')), 'knight', 3)?.id).toBe('hero_knight_t1');
  expect(selectHeroLibraryAsset(manifestOf(hero('hero_knight_t2', 2, {})), 'knight', 1)).toBeNull();
  expect(selectHeroLibraryAsset(sparse, 'mage', 3)).toBeNull();
  // 정본 manifest 는 다섯 영웅의 1단계 몸체를 등록한다.
  for (const id of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) expect(libraryAssetForHero(id)?.id).toBe('hero_' + id + '_t1');
});

test('mesh-only tiers reuse the same AnimationClip objects cached per hero', () => {
  const cache = new Map();
  const t1 = hero('hero_knight_t1', 1, { idle: 'idle', run: 'run', slash_h: 'attack' }), t2 = hero('hero_knight_t2', 2, {}), t3 = hero('hero_knight_t3', 3, { idle: 'idle3' });
  expect(() => resolveSharedHeroClips(cache, 'knight', t2, [])).toThrow('hero clips unavailable');
  const clips = [new THREE.AnimationClip('idle', 1, []), new THREE.AnimationClip('attack', 1, [])];
  expect(resolveSharedHeroClips(cache, 'knight', t1, clips).clipAsset).toBe(t1);
  const shared = resolveSharedHeroClips(cache, 'knight', t2, []);
  expect(shared.animations).toBe(clips);
  expect(shared.clipAsset).toBe(t1);
  const own = [new THREE.AnimationClip('idle3', 1, [])];
  expect(resolveSharedHeroClips(cache, 'knight', t3, own).animations).toBe(own);
  expect(resolveSharedHeroClips(cache, 'knight', t2, []).animations).toBe(clips);
  // 공유 클립의 원본 단계 매핑으로 계약 별칭을 만든다.
  const contract = heroModelContract(t2, handScene('mixamorigRightHand', 'mixamorigLeftHand'), shared.clipAsset);
  const aliases = contract.aliases as Record<string, string>;
  expect(aliases['1H_Melee_Attack_Slice_Horizontal']).toBe('attack');
  expect(aliases.Idle).toBe('idle');
  expect(contract.sockets).toEqual({ ...LIBRARY_SOCKET_NAMES });
  expect(contract.handBones).toEqual({ r: 'mixamorigRightHand', l: 'mixamorigLeftHand' });
});

test('hand bone search accepts mixamorig prefix variants and never picks finger bones', () => {
  for (const [right, left] of [['mixamorig:RightHand', 'mixamorig:LeftHand'], ['mixamorigRightHand', 'mixamorigLeftHand'],
    ['mixamorig1:RightHand', 'mixamorig1:LeftHand'], ['mixamorig_RightHand', 'mixamorig_LeftHand'], ['RightHandBone', 'left_hand']]) {
    const scene = handScene(right, left, ['mixamorigRightHandIndex1', 'mixamorigLeftHandThumb1', 'mixamorigRightForeArm']);
    expect(heroHandBones(scene)).toEqual({ r: right, l: left });
  }
  expect(() => heroHandBones(handScene('mixamorigRightHandIndex1', 'mixamorigLeftArm'))).toThrow('hero hand bones not found');
});

test('Mixamo hand grip offsets are fixed per hero and orient sockets like KayKit handslots', () => {
  for (const id of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
    expect(heroGripRotation(id, 'r')).toEqual([0, 0, Math.PI / 2]);
    expect(heroGripRotation(id, 'l')).toEqual([0, 0, -Math.PI / 2]);
  }
  expect(Object.isFrozen(HERO_HAND_GRIP)).toBe(true);
  // bone_knight.glb rest 포즈 실측 손 본 회전. 소켓 Y(무기 날)는 전방, Z 는 위를 향해야 한다.
  const measured = { r: [-0.446, 0.631, 0.531, 0.346], l: [0.367, 0.609, 0.58, -0.396] } as const;
  for (const side of ['r', 'l'] as const) {
    const hand = new THREE.Quaternion(...measured[side]).normalize();
    const [x, y, z] = heroGripRotation('knight', side);
    const socket = hand.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(socket).z).toBeGreaterThan(0.9);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(socket).y).toBeGreaterThan(0.95);
  }
  expect(librarySocketScale(2.5003, 1.222)).toBeCloseTo(1.222 / 1.049 / 2.5003, 9);
  expect(() => librarySocketScale(0, 1)).toThrow('invalid hero hand transform');
});

test('KayKit action names map to the contract logical keys', () => {
  expect(logicalClipForAnimation('1H_Melee_Attack_Slice_Horizontal')).toBe('slash_h');
  expect(logicalClipForAnimation('2H_Melee_Attack_Spinning')).toBe('spin');
  expect(logicalClipForAnimation('Bow_Shoot')).toBe('bow_shoot');
  expect(requiredHeroLogicalClips('knight')).toEqual(expect.arrayContaining(['slash_h', 'slash_d', 'stab', 'spin', 'chop', 'block', 'cast_raise']));
});

test('광전사 회오리는 KayKit 짧은 회전 이름을 유지하고 라이브러리에서는 같은 spin 클립으로 반복 재생한다', () => {
  const asset = { ...hero('hero_barbarian_t1', 1), heroId: 'barbarian', clips: { idle: 'idle', spin: 'spin' } };
  const scene = handScene('mixamorigRightHand', 'mixamorigLeftHand');
  scene.userData.authoredContract = heroModelContract(asset, scene);
  const spin = new THREE.AnimationClip('spin', 1, []);
  const game = { scene: new THREE.Scene(), hasProc: () => false, fx: { castCircle() {} } };
  const player: any = new Actor(game, { scene, animations: [new THREE.AnimationClip('idle', 1, []), spin] });
  Object.setPrototypeOf(player, Player.prototype);
  Object.assign(player, { def: HEROES.barbarian, stats: { atk: 100 }, buffs: { atk: 1 }, heroLevel: 3,
    skillLevels: [1, 1, 1, 1], cds: [0, 0, 0, 0], mp: 100, state: 'idle', stateT: 0,
    auto: false, stopTrail() {}, startTrail() {} });
  // 같은 물리 클립을 가리키는 두 별칭이 실제 인스턴스에 모두 있어야 한다.
  expect(player.clips['2H_Melee_Attack_Spin']).toBe(spin);
  expect(player.clips['2H_Melee_Attack_Spinning']).toBe(spin);
  player.playTimed('2H_Melee_Attack_Spinning', .85);
  expect(player.tryCastSkill(0)).toBe(true);
  player.mixer.update(1 / 60);
  // 회오리 시전은 KayKit 0.667초 반복 클립 이름을 그대로 쓴다(2.4초 Spin 으로 바꾸면 KayKit 폴백에서 회전 수가 줄어든다).
  expect(player.actionName).toBe('2H_Melee_Attack_Spinning');
  expect(player.action.getClip()).toBe(player.clips[HEROES.barbarian.skills[0].anim]);
  expect(player.action.getClip()).toBe(spin);
  expect(player.action.isRunning()).toBe(true);
  expect(player.action.loop).toBe(THREE.LoopRepeat);
  expect(player.action.timeScale).toBe(2.2);
});

