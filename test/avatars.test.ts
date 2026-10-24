import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AVATARS, AVATAR_BY_ID } from '../src/data/avatars.js';
import { HEROES, heroStats } from '../src/data/heroes.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { createLibraryLoader, selectHeroLibraryAsset, validateManifest } from '../src/engine/library-assets.js';

const provenance = { tool: 'fixture', account: 'test', taskId: 'avatar-test', prompt: 'fixture', createdAt: '2026-10-13T00:00:00.000Z', rawSha256: 'b'.repeat(64) };
const base = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: 'character', body: 'biped', role: 'hero', heroId: 'knight', replaces: null,
  file: `/models/library/${id}.glb`, heightM: 1.8, triangles: 1, bytes: 1, sha256: 'a'.repeat(64), clips: { idle: 'idle', run: 'run' },
  provenance, license: 'test', shared: true, ...extra,
});
const avatarAsset = base('avatar_knight_sakura', { avatar: true, clips: {} });
const manifest: any = { schema: 'tll.game-asset-library.v1', assets: [base('hero_knight_t1'), base('hero_knight_t2', { armorTier: 2, clips: {} }), avatarAsset] };

// 구매는 저장이 성공해야 확정되므로 메모리 저장소를 둔다.
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let failWrites = false;
beforeEach(() => {
  const values = new Map<string, string>(); failWrites = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { if (failWrites) throw new Error('quota'); values.set(k, v); },
    removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

test('아바타 manifest는 hero 플래그를 검증하고 갑옷 단계 후보에서 제외한다', () => {
  expect(validateManifest(manifest).assets.find((asset: any) => asset.avatar)?.id).toBe('avatar_knight_sakura');
  expect(selectHeroLibraryAsset(manifest, 'knight', 3)?.id).toBe('hero_knight_t2');
  expect(() => validateManifest({ ...manifest, assets: [{ ...avatarAsset, role: undefined }] })).toThrow();
  expect(() => validateManifest({ ...manifest, assets: [{ ...avatarAsset, armorTier: 1 }] })).toThrow('invalid avatar role/tier');
  const loader = createLibraryLoader(manifest, () => Promise.resolve({ scene: { userData: {} }, animations: [] }), undefined, () => {});
  expect(loader.assetForAvatar('avatar_knight_sakura')?.id).toBe('avatar_knight_sakura');
  expect(loader.assetForHero('knight')?.id).toBe('hero_knight_t1');
});

test('아바타 저장 데이터는 존재·소유·영웅 일치 조건으로 정규화된다', () => {
  const eco = new Economy();
  const raw: any = eco.fresh();
  raw.avatars = { owned: ['avatar_knight_sakura', 'avatar_knight_sakura', 'missing'], equipped: {
    knight: 'avatar_knight_sakura', barbarian: 'avatar_knight_sakura', mage: 'missing', rogue: 'avatar_rogue_crow',
  }, showGear: { knight: true, mage: 1, nobody: true } };
  const migrated = normalizeSave(raw, eco.fresh());
  expect(migrated.avatars).toEqual({ owned: ['avatar_knight_sakura'], equipped: { knight: 'avatar_knight_sakura' }, showGear: { knight: true } });
});

test('아바타 구매·착용은 보석과 소유 상태를 검사하고 저장한다', () => {
  const eco: any = new Economy(); eco.s = eco.fresh(); eco.s.gems = 4000;
  expect(eco.buyAvatar('avatar_knight_sakura')).toEqual({ ok: true });
  expect(eco.buyAvatar('avatar_knight_sakura')).toEqual({ ok: false, reason: 'owned' });
  expect(eco.equipAvatar('knight', 'avatar_knight_sakura')).toEqual({ ok: true });
  expect(eco.equippedAvatar('knight')).toBe('avatar_knight_sakura');
  expect(eco.equipAvatar('knight', 'avatar_barbarian_oni')).toEqual({ ok: false, reason: 'avatar' });
  expect(eco.displayAvatar('knight')).toBe('avatar_knight_sakura');
  // 장비 외형 표시를 켜면 아바타는 착용한 채로 화면에는 장비 외형이 보인다.
  expect(eco.setShowGear('knight', true)).toEqual({ ok: true });
  expect(eco.displayAvatar('knight')).toBeNull();
  expect(eco.equippedAvatar('knight')).toBe('avatar_knight_sakura');
  eco.setShowGear('knight', false);
  expect(eco.displayAvatar('knight')).toBe('avatar_knight_sakura');
  eco.setShowGear('knight', true);
  eco.equipAvatar('knight', 'avatar_knight_sakura');
  expect(eco.displayAvatar('knight')).toBe('avatar_knight_sakura');
  expect(eco.equipAvatar('knight', null)).toEqual({ ok: true });
  expect(eco.equippedAvatar('knight')).toBeNull();
  eco.s.gems = 0;
  expect(eco.buyAvatar('avatar_barbarian_oni')).toEqual({ ok: false, reason: 'gems' });
});

test('저장에 실패한 아바타 구매는 보석과 소유를 되돌린다', () => {
  const eco: any = new Economy(); eco.s = eco.fresh(); eco.s.gems = 4000;
  failWrites = true;
  expect(eco.buyAvatar('avatar_mage_astral')).toEqual({ ok: false, reason: 'storage' });
  expect(eco.s.gems).toBe(4000);
  expect(eco.s.avatars.owned).toEqual([]);
});

test('손상된 아바타 저장 값은 예외 없이 빈 상태로 정규화된다', () => {
  const eco = new Economy();
  const raw: any = eco.fresh(); raw.avatars = { owned: 'avatar_knight_sakura', equipped: [] };
  expect(normalizeSave(raw, eco.fresh()).avatars).toEqual({ owned: [], equipped: {}, showGear: {} });
});

test('아바타 착용 전후 전투력과 스탯은 동일하다', () => {
  const eco: any = new Economy(); eco.s = eco.fresh(); eco.s.gems = 4000;
  const before = heroStats(HEROES.knight, eco.hero('knight'), eco.heroEquipBonus('knight'));
  eco.buyAvatar('avatar_knight_sakura'); eco.equipAvatar('knight', 'avatar_knight_sakura');
  const after = heroStats(HEROES.knight, eco.hero('knight'), eco.heroEquipBonus('knight'));
  expect(after).toEqual(before);
  expect(eco.heroPower('knight')).toBe(before.power);
  expect(AVATAR_BY_ID.avatar_knight_sakura.heroId).toBe('knight');
  expect(AVATARS).toHaveLength(5);
});

test('아바타 상점 초상은 정해진 경로 형식이고 실제 512² webp 파일이 있다', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { PORTRAIT_BACKGROUNDS, portraitPath } = await import('../tools/art/avatar-portrait/render-config.mjs');
  for (const avatar of AVATARS as readonly any[]) {
    // 모든 아바타는 배경 매핑이 있어야 render.mjs 로 바로 구울 수 있다.
    expect(existsSync(`art-src/t5-pc/portrait-bg/${(PORTRAIT_BACKGROUNDS as Record<string, string>)[avatar.id]}`)).toBe(true);
    if (avatar.portrait === undefined) continue;
    expect(avatar.portrait).toBe(portraitPath(avatar.id));
    expect(avatar.portrait).toMatch(/^\/img\/tll\/avatars\/avatar_[a-z]+_[a-z]+-v\d+\.webp$/);
    const file = readFileSync('public' + avatar.portrait);
    expect(file.subarray(0, 4).toString()).toBe('RIFF');
    expect(file.subarray(8, 12).toString()).toBe('WEBP');
    // VP8 손실 webp: 프레임 헤더의 14비트 폭·높이
    expect(file.subarray(12, 16).toString()).toBe('VP8 ');
    expect([file.readUInt16LE(26) & 0x3fff, file.readUInt16LE(28) & 0x3fff]).toEqual([512, 512]);
  }
  // 1차 아바타 5종은 초상이 구워져 있어야 한다(영웅 초상 재사용 금지).
  for (const id of ['avatar_knight_sakura', 'avatar_barbarian_oni', 'avatar_mage_astral', 'avatar_rogue_crow', 'avatar_ranger_fox']) {
    expect((AVATAR_BY_ID as any)[id].portrait).toBe(portraitPath(id));
  }
});
