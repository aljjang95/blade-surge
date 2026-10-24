import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { mergeServerOwned, parityHash, paritySubset, PARITY_KEYS, SERVER_OWNED_KEYS } from '../src/shared/state-hash.js';

const fresh = () => new Economy({ storage: createMemoryStorage() });

describe('roster 서버 소유·패리티', () => {
  test('roster는 패리티·서버 소유 키에 들어 있다', () => {
    expect(PARITY_KEYS).toContain('roster');
    expect(SERVER_OWNED_KEYS).toContain('roster');
    expect((paritySubset(fresh().s) as any).roster).toBeDefined();
  });

  test('서버 문서가 knight+mage 소유일 때 로컬 knight만 저장에 병합하면 mage가 열린다', () => {
    const server = fresh(); server.s.roster.paid = ['mage'];
    const local = fresh();
    expect(local.ownHero('mage')).toBe(false);
    local.s = local.migrate(mergeServerOwned(local.s, structuredClone(server.s)));
    expect(local.ownHero('mage')).toBe(true);
    expect(local.ownHero('knight')).toBe(true);
    expect(parityHash(local.s)).toBe(parityHash(server.s));
  });

  test('거부된 unlock 뒤 재동기화하면 로컬 소유가 서버 값으로 되돌아간다', () => {
    const server = fresh();
    const local = fresh();
    local.s.roster.owned.push('mage'); // 로컬 위조·낙관 반영
    expect(parityHash(local.s)).not.toBe(parityHash(server.s));
    local.s = local.migrate(mergeServerOwned(local.s, structuredClone(server.s)));
    expect(local.ownHero('mage')).toBe(false);
    expect(parityHash(local.s)).toBe(parityHash(server.s));
  });

  test('roster가 없는 옛 서버 문서는 로컬 roster를 지우지 않는다', () => {
    const local = fresh(); const doc: any = structuredClone(local.s); delete doc.roster;
    expect(mergeServerOwned(local.s, doc).roster).toEqual(local.s.roster);
  });
});
