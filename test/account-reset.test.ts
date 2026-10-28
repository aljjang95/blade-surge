import { afterEach, expect, test } from 'bun:test';
import { ACCOUNT_KEY_PREFIXES, clearAccountStorage, clearSecureIdentityDb, hasPendingPayment, isAccountResetPhrase, resetAccountFromScratch } from '../src/game/account-reset.js';
import { isAccountResetting, setAccountResetting } from '../src/game/reset-lock.js';
import { PENDING_KEY } from '../src/platform/hero-purchase.js';
import { SUB_CHECK_KEY } from '../src/platform/billing-service.js';
import { DEVICE_KEY_NAME, INSTALL_ID_NAME, SECURE_DB_NAME } from '../src/net/secure-storage.js';

afterEach(() => setAccountResetting(false));
const memStorage = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] };
};
const idbOk = (log: string[] = []) => ({ deleteDatabase: (n: string) => { log.push(n); const r: any = {}; setTimeout(() => r.onsuccess(), 0); return r; } });
const idbFail = { deleteDatabase: () => { const r: any = {}; setTimeout(() => r.onerror(), 0); return r; } };
const full = () => memStorage({ bladesurge_save_v1: '{}', bladesurge_save_v1_backup: '{}', [DEVICE_KEY_NAME]: 'k', [DEVICE_KEY_NAME + ':prev']: 'p', 'tll-social:blade-surge:runq': '[]', [INSTALL_ID_NAME]: 'id', 'blade-surge.companion.v1': '{}', 'blade-surge:news:last-read:v1': '1', 'bladesurge.ui.windows.v1': '{}', [SUB_CHECK_KEY]: '1', 'other-app': 'x' });

test('확인 문구는 "초기화"만 통과한다', () => {
  expect(isAccountResetPhrase(' 초기화 ')).toBe(true);
  for (const v of ['', '초기', 'reset', '초기화합니다', null, undefined]) expect(isAccountResetPhrase(v as any)).toBe(false);
});

test('접두어 경계: 구분자가 있는 키만 지우고 이름이 비슷한 키는 남긴다', () => {
  const st = memStorage({ bladesurge_x: '1', 'bladesurge.x': '1', 'blade-surge.x': '1', 'blade-surge:x': '1', 'tll-social:blade-surge:key': '1',
    bladesurgeX: '1', 'blade-surgeX': '1', 'tll-social:blade-surge2:key': '1', 'tll-social:other:key': '1', 'my-bladesurge_x': '1' });
  clearAccountStorage(st);
  expect(st.keys().sort()).toEqual(['bladesurgeX', 'blade-surgeX', 'tll-social:blade-surge2:key', 'tll-social:other:key', 'my-bladesurge_x'].sort());
  expect(ACCOUNT_KEY_PREFIXES).toContain('blade-surge:');
});

test('성공: 신원·세이브·UI 키가 모두 사라지고 결제 구독 기록과 다른 앱 키는 남는다', async () => {
  const st = full(), log: string[] = [];
  const r = await resetAccountFromScratch({ storage: st as any, indexedDB: idbOk(log) as any });
  expect(r.ok).toBe(true); expect(log).toEqual([SECURE_DB_NAME]);
  expect(st.keys().sort()).toEqual([SUB_CHECK_KEY, 'other-app'].sort());
  expect(isAccountResetting()).toBe(true); // 새로고침 전까지 저장 잠금 유지
});

test('IDB 삭제가 실패하면 세이브 키를 포함해 아무것도 지우지 않고 잠금을 푼다', async () => {
  const st = full(); const before = st.keys().sort();
  const r = await resetAccountFromScratch({ storage: st as any, indexedDB: idbFail as any });
  expect(r.ok).toBe(false); expect(r.reason).toBe('identity');
  expect(st.keys().sort()).toEqual(before); expect(st.getItem('bladesurge_save_v1')).toBe('{}');
  expect(isAccountResetting()).toBe(false);
});

test('신원 키가 지워지지 않으면(삭제가 무시되는 저장소) 세이브를 남기고 identity로 실패한다', async () => {
  const st: any = full(); const real = st.removeItem; st.removeItem = (k: string) => { if (k === DEVICE_KEY_NAME) return; real(k); };
  const r = await resetAccountFromScratch({ storage: st, indexedDB: idbOk() as any });
  expect(r.ok).toBe(false); expect(r.reason).toBe('identity'); expect(st.getItem('bladesurge_save_v1')).toBe('{}');
});

test('세이브 쪽 삭제가 일부 실패하면 storage로 실패한다', async () => {
  const st: any = full(); const real = st.removeItem; st.removeItem = (k: string) => { if (k === 'bladesurge_save_v1') return; real(k); };
  const r = await resetAccountFromScratch({ storage: st, indexedDB: idbOk() as any });
  expect(r.ok).toBe(false); expect(r.reason).toBe('storage'); expect(isAccountResetting()).toBe(false);
});

test('결제 대기가 있으면 거부하고 아무것도 지우지 않는다', async () => {
  const st = full(); st.setItem(PENDING_KEY, '{"paymentId":"p"}'); const before = st.keys().sort();
  expect(hasPendingPayment(st)).toBe(true);
  const log: string[] = [];
  const r = await resetAccountFromScratch({ storage: st as any, indexedDB: idbOk(log) as any });
  expect(r.ok).toBe(false); expect(r.reason).toBe('payment'); expect(log).toEqual([]);
  expect(st.keys().sort()).toEqual(before); expect(isAccountResetting()).toBe(false);
});

test('초기화 중에는 Economy.save가 저장하지 않는다', async () => {
  const { Economy } = await import('../src/game/economy.js');
  const st = memStorage({}); const eco: any = new Economy({ storage: st as any });
  setAccountResetting(true);
  expect(eco.save()).toBe(false); expect(st.getItem('bladesurge_save_v1')).toBeNull();
  setAccountResetting(false); expect(eco.save()).toBe(true); expect(st.getItem('bladesurge_save_v1')).not.toBeNull();
});

test('IndexedDB 삭제 헬퍼: 성공·실패·미지원', async () => {
  expect(await clearSecureIdentityDb(idbOk() as any)).toBe(true);
  expect(await clearSecureIdentityDb(idbFail as any)).toBe(false);
  expect(await clearSecureIdentityDb(undefined)).toBe(true);
});
