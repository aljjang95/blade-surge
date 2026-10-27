import { expect, test } from 'bun:test';
import { ACCOUNT_RESET_KEEP_KEYS, clearAccountStorage, clearSecureIdentityDb, isAccountResetPhrase, resetAccountFromScratch } from '../src/game/account-reset.js';
import { PENDING_KEY } from '../src/platform/hero-purchase.js';
import { SUB_CHECK_KEY } from '../src/platform/billing-service.js';
import { DEVICE_KEY_NAME, INSTALL_ID_NAME, SECURE_DB_NAME } from '../src/net/secure-storage.js';

const memStorage = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] };
};

test('확인 문구는 "초기화"만 통과한다', () => {
  expect(isAccountResetPhrase('초기화')).toBe(true);
  expect(isAccountResetPhrase(' 초기화 ')).toBe(true);
  for (const v of ['', '초기', 'reset', '초기화합니다', null, undefined]) expect(isAccountResetPhrase(v as any)).toBe(false);
});

test('세이브·백업·신원·UI 키는 지우고 결제 기록과 다른 앱 키는 남긴다', () => {
  const st = memStorage({
    bladesurge_save_v1: '{}', bladesurge_save_v1_backup: '{}', bladesurge_save_v1_recovery: '{}',
    [DEVICE_KEY_NAME]: 'k', [DEVICE_KEY_NAME + ':prev']: 'p', 'tll-social:blade-surge:runq': '[]', [INSTALL_ID_NAME]: 'id',
    'blade-surge.companion.v1': '{}', 'blade-surge.tutorial-toggle-opened': '1', 'bladesurge.ui.windows.v1': '{}', bladesurge_funnel_v1: '[]',
    [PENDING_KEY]: 'pay', [SUB_CHECK_KEY]: '1', 'other-app': 'x', 'tll-social:other-game:key': 'o',
  });
  const removed = clearAccountStorage(st)!;
  expect(removed.length).toBe(11);
  expect(st.keys().sort()).toEqual([PENDING_KEY, SUB_CHECK_KEY, 'other-app', 'tll-social:other-game:key'].sort());
  expect(ACCOUNT_RESET_KEEP_KEYS).toContain(PENDING_KEY);
});

test('저장소 접근이 막히면 null, 신원 DB는 삭제 요청 성공/실패를 구분한다', async () => {
  expect(clearAccountStorage({ get length() { throw new Error('blocked'); } } as any)).toBeNull();
  const ok = { deleteDatabase: (name: string) => { expect(name).toBe(SECURE_DB_NAME); const r: any = {}; setTimeout(() => r.onsuccess(), 0); return r; } };
  expect(await clearSecureIdentityDb(ok)).toBe(true);
  const fail = { deleteDatabase: () => { const r: any = {}; setTimeout(() => r.onerror(), 0); return r; } };
  expect(await clearSecureIdentityDb(fail)).toBe(false);
  expect(await clearSecureIdentityDb(undefined)).toBe(true);
});

test('전체 초기화는 localStorage와 IndexedDB 신원을 모두 비워야 ok', async () => {
  const st = memStorage({ bladesurge_save_v1: '{}', [DEVICE_KEY_NAME]: 'k' });
  const deleted: string[] = [];
  const idb = { deleteDatabase: (n: string) => { deleted.push(n); const r: any = {}; setTimeout(() => r.onsuccess(), 0); return r; } };
  const r = await resetAccountFromScratch({ storage: st as any, indexedDB: idb as any });
  expect(r.ok).toBe(true); expect(deleted).toEqual([SECURE_DB_NAME]); expect(st.keys()).toEqual([]);
  const bad = await resetAccountFromScratch({ storage: st as any, indexedDB: { deleteDatabase: () => { const r: any = {}; setTimeout(() => r.onerror(), 0); return r; } } as any });
  expect(bad.ok).toBe(false);
});
