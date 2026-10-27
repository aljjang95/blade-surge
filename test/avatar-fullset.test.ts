import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AVATARS, AVATAR_PARTS, AVATAR_FULLSET_EFFECT, avatarFullsetSku, avatarFullsetEffect } from '../src/data/avatars.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';

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

const fresh = () => { const eco: any = new Economy(); eco.s = eco.fresh(); return eco; };
const target = AVATARS.find((a) => a.heroId === 'barbarian')!;

test('부위 넷을 모으면 풀셋으로 소유되고 중간 저장 실패는 되돌린다', () => {
  const eco = fresh();
  expect(eco.grantAvatarPart(target.id, 'wings').ok).toBe(false);
  for (const part of AVATAR_PARTS.slice(0, 3)) expect(eco.grantAvatarPart(target.id, part)).toMatchObject({ ok: true, complete: false });
  expect(eco.avatarParts(target.id)).toEqual(AVATAR_PARTS.slice(0, 3));
  failWrites = true;
  expect(eco.grantAvatarPart(target.id, 'cloak')).toMatchObject({ ok: false, reason: 'storage' });
  expect(eco.s.avatars.owned).not.toContain(target.id);
  expect(eco.avatarParts(target.id)).toEqual(AVATAR_PARTS.slice(0, 3));
  failWrites = false;
  expect(eco.grantAvatarPart(target.id, 'cloak')).toMatchObject({ ok: true, complete: true });
  expect(eco.s.avatars.owned).toContain(target.id);
  expect(eco.s.avatars.parts[target.id]).toBeUndefined();
  expect(eco.grantAvatarPart(target.id, 'head')).toMatchObject({ ok: true, already: true });
});

test('유료 풀셋 지급 계약: 상품 id 규칙, 준비 안 된 영웅 거절, 중복 지급 없음', () => {
  expect(avatarFullsetSku('barbarian')).toBe('avatar_fullset_barbarian_v1');
  const eco = fresh();
  expect(eco.grantAvatarFullset('mage', { avatarId: target.id })).toMatchObject({ ok: false, reason: 'not-ready' });
  expect(eco.grantAvatarFullset('barbarian', { avatarId: target.id })).toMatchObject({ ok: true, already: false, avatarId: target.id });
  expect(eco.grantAvatarFullset('barbarian', { avatarId: target.id })).toMatchObject({ ok: true, already: true });
  expect(eco.s.avatars.owned.filter((id: string) => id === target.id).length).toBe(1);
});

test('풀셋 효과는 착용한 영웅에게만, 장비 외형 표시를 켜도 유지된다', () => {
  const eco = fresh();
  eco.s.roster = { ...eco.s.roster, owned: [...new Set([...(eco.s.roster?.owned || []), 'barbarian', 'knight'])] };
  eco.grantAvatarFullset('barbarian', { avatarId: target.id });
  expect(eco.heroEquipBonus('barbarian').avatar).toBeNull();
  expect(eco.equipAvatar('barbarian', target.id).ok).toBe(true);
  expect(eco.heroEquipBonus('barbarian').avatar).toEqual(AVATAR_FULLSET_EFFECT);
  expect(eco.heroEquipBonus('knight').avatar).toBeNull();
  eco.setShowGear('barbarian', true);
  expect(eco.heroEquipBonus('barbarian').avatar).toEqual(AVATAR_FULLSET_EFFECT);
  expect(avatarFullsetEffect(null)).toBeNull();
  // 전투력 수치에는 들어가지 않는다.
  expect(AVATAR_FULLSET_EFFECT).toEqual({ speedPct: 0.05, pickupPct: 0.3 });
});

test('저장 정규화: 알 수 없는 부위·소유한 풀셋·네 부위가 찬 값은 버린다', () => {
  const eco = fresh();
  const raw = { ...eco.fresh(), avatars: { owned: [AVATARS[0]!.id], equipped: {}, showGear: {}, parts: {
    [AVATARS[0]!.id]: ['head'],
    [target.id]: ['head', 'wings', 'top'],
    [AVATARS[2]!.id]: [...AVATAR_PARTS],
    avatar_unknown: ['head'],
  } } };
  const s = normalizeSave(raw, eco.fresh());
  expect(s.avatars.parts).toEqual({ [target.id]: ['head', 'top'] });
  expect(s.avatars.owned).toEqual([AVATARS[0]!.id]);
});
