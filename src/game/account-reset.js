// 계정 초기화(처음부터). 대표님 요청(2026-10-27): 전투력이 너무 커져 측정이 안 되므로 기기 계정을 비우고 셋업부터 다시 한다.
// 서버 삭제 API는 없다. 대신 로컬 신원(기기 키·설치 id)을 지워 다음 부팅에서 새 게스트 계정을 발급받게 한다.
// 옛 신원의 서버 문서는 그대로 남지만 새 신원과 연결되지 않아 다시 내려받아 덮어쓰지 않는다.
import { SECURE_DB_NAME } from '../net/secure-storage.js';
import { PENDING_KEY } from '../platform/hero-purchase.js';
import { SUB_CHECK_KEY } from '../platform/billing-service.js';

export const ACCOUNT_RESET_PHRASE = '초기화';
/** 이 접두어로 시작하는 키는 이 게임의 기기 저장소다(세이브·백업·UI 설정·튜토리얼·동행·소셜 신원·퍼널 등). */
export const ACCOUNT_KEY_PREFIXES = Object.freeze(['bladesurge', 'blade-surge', 'tll-social:blade-surge']);
/** 결제·구독 확인 기록은 계정 초기화가 건드리지 않는다. */
export const ACCOUNT_RESET_KEEP_KEYS = Object.freeze([PENDING_KEY, SUB_CHECK_KEY]);

export const isAccountResetPhrase = (value) => String(value ?? '').trim() === ACCOUNT_RESET_PHRASE;

/** localStorage에서 이 게임 키를 지운다(보존 키 제외). 지운 키 목록을 돌려준다. 접근이 막히면 null. */
export function clearAccountStorage(storage) {
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) { const k = storage.key(i); if (typeof k === 'string') keys.push(k); }
    const removed = [];
    for (const k of keys) {
      if (ACCOUNT_RESET_KEEP_KEYS.includes(k) || !ACCOUNT_KEY_PREFIXES.some((p) => k.startsWith(p))) continue;
      storage.removeItem(k); removed.push(k);
    }
    return removed;
  } catch { return null; }
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

/** 저장 → 신원 순으로 비운다. 둘 다 성공해야 true(그때만 새로고침해 첫 실행 셋업으로 간다). */
export async function resetAccountFromScratch({ storage = globalThis.localStorage, indexedDB = globalThis.indexedDB } = {}) {
  const removed = clearAccountStorage(storage);
  const identityCleared = await clearSecureIdentityDb(indexedDB);
  return { ok: removed !== null && identityCleared, removed: removed || [], identityCleared };
}
