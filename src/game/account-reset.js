// 계정 초기화(처음부터). 대표님 요청(2026-10-27): 전투력이 너무 커져 측정이 안 되므로 기기 계정을 비우고 셋업부터 다시 한다.
// 서버 삭제 API는 없다. 대신 로컬 신원(기기 키·설치 id)을 지워 다음 부팅에서 새 게스트 계정을 발급받게 한다.
// 옛 신원의 서버 문서는 그대로 남지만 새 신원과 연결되지 않아 다시 내려받아 덮어쓰지 않는다.
import { SECURE_DB_NAME } from '../net/secure-storage.js';
import { setAccountResetting } from './reset-lock.js';
import { PENDING_KEY } from '../platform/hero-purchase.js';
import { SUB_CHECK_KEY } from '../platform/billing-service.js';

export const ACCOUNT_RESET_PHRASE = '초기화';
/** 구분자까지 포함한 접두어. 이 게임의 기기 저장 키만 걸리고 이름이 비슷한 다른 키는 걸리지 않는다. */
export const ACCOUNT_KEY_PREFIXES = Object.freeze(['bladesurge_', 'bladesurge.', 'blade-surge.', 'blade-surge:', 'tll-social:blade-surge:']);
/** 기기 신원 키(기기 키·이전 키·실행 대기열·설치 id). 세이브보다 먼저 지운다. */
export const IDENTITY_KEY_PREFIXES = Object.freeze(['tll-social:blade-surge:', 'bladesurge_install_id']);
/** 결제·구독 확인 기록은 계정 초기화가 건드리지 않는다. */
export const ACCOUNT_RESET_KEEP_KEYS = Object.freeze([PENDING_KEY, SUB_CHECK_KEY]);
export const PAYMENT_PENDING_MESSAGE = '결제 처리 중입니다. 완료된 뒤 다시 시도해 주세요';

export const isAccountResetPhrase = (value) => String(value ?? '').trim() === ACCOUNT_RESET_PHRASE;

const keysOf = (storage) => { const keys = []; for (let i = 0; i < storage.length; i += 1) { const k = storage.key(i); if (typeof k === 'string') keys.push(k); } return keys; };
const matching = (storage, prefixes) => keysOf(storage).filter((k) => !ACCOUNT_RESET_KEEP_KEYS.includes(k) && prefixes.some((p) => k.startsWith(p)));

/** localStorage에서 접두어에 맞는 키를 지운다(보존 키 제외). 지운 키 목록, 접근이 막히면 null. */
export function clearAccountStorage(storage, prefixes = ACCOUNT_KEY_PREFIXES) {
  try {
    const removed = matching(storage, prefixes);
    for (const k of removed) storage.removeItem(k);
    return removed;
  } catch { return null; }
}

/** 결제 대기 기록이 있는가. 읽지 못하면 안전하게 있는 것으로 본다. */
export function hasPendingPayment(storage) {
  try { return storage.getItem(PENDING_KEY) !== null && storage.getItem(PENDING_KEY) !== undefined; } catch { return true; }
}

/** IndexedDB 신원 사본(기기 키·설치 id)을 지운다. localStorage만 지우면 사본으로 같은 신원이 복구되기 때문이다. */
export function clearSecureIdentityDb(idb, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!idb?.deleteDatabase) { resolve(true); return; }
    let done = false; const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const req = idb.deleteDatabase(SECURE_DB_NAME);
      req.onsuccess = () => finish(true);
      req.onerror = () => finish(false);
      req.onblocked = () => setTimeout(() => finish(false), timeoutMs);
    } catch { finish(false); }
    setTimeout(() => finish(false), timeoutMs * 2);
  });
}

/**
 * 순서: 결제 대기 확인 → 신원 삭제(IndexedDB, 신원 키) → 신원 검증 → 세이브·UI 키 삭제 → 전체 검증.
 * 신원 삭제가 실패하면 세이브 키는 건드리지 않는다(옛 기기 키와 빈 세이브가 짝지어져 옛 서버 문서를 덮어쓰는 일 방지).
 * 진행 중에는 reset-lock이 켜져 저장·동기화 큐가 쓰지 않는다. 성공하면 잠금을 유지한 채 돌려준다(호출부가 새로고침).
 * @returns {Promise<{ ok: boolean, reason?: 'payment'|'identity'|'storage', removed: string[], identityCleared: boolean }>}
 */
export async function resetAccountFromScratch({ storage = globalThis.localStorage, indexedDB = globalThis.indexedDB } = {}) {
  if (hasPendingPayment(storage)) return { ok: false, reason: 'payment', removed: [], identityCleared: false };
  setAccountResetting(true);
  const fail = (reason, extra = {}) => { setAccountResetting(false); return { ok: false, reason, removed: [], identityCleared: false, ...extra }; };
  const idbCleared = await clearSecureIdentityDb(indexedDB);
  if (!idbCleared) return fail('identity');
  const identityRemoved = clearAccountStorage(storage, IDENTITY_KEY_PREFIXES);
  let left; try { left = identityRemoved === null ? [null] : matching(storage, IDENTITY_KEY_PREFIXES); } catch { left = [null]; }
  if (left.length) return fail('identity');
  const removed = clearAccountStorage(storage, ACCOUNT_KEY_PREFIXES);
  let rest; try { rest = removed === null ? [null] : matching(storage, ACCOUNT_KEY_PREFIXES); } catch { rest = [null]; }
  if (rest.length) return fail('storage', { identityCleared: true });
  return { ok: true, removed: [...identityRemoved, ...removed], identityCleared: true };
}
