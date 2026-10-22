// MMO P1-F: 기기 키·설치 id 보관. localStorage가 1차이고 IndexedDB에 사본을 둬 localStorage만 지워져도
// 같은 게스트 계정으로 돌아온다. 앱 데이터 삭제(둘 다 사라짐)의 복구 수단은 계정 연동뿐이다.
// 네이티브 Keystore 저장은 Capacitor 보안 저장소 플러그인을 붙이는 레인에서 이 인터페이스 뒤에 넣는다.
import { createDeviceKey, isDeviceKey } from '../../packages/tll-social/src/client/identity.js';

export const DEVICE_KEY_NAME = 'tll-social:blade-surge:key';
export const INSTALL_ID_NAME = 'bladesurge_install_id';
const DB = 'bladesurge-secure', STORE = 'kv';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB?.open(DB, 1);
      if (!req) { resolve(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(STORE, mode), store = tx.objectStore(STORE), out = fn(store);
          tx.oncomplete = () => { req.result.close(); resolve(out?.result ?? null); };
          tx.onerror = tx.onabort = () => { req.result.close(); resolve(null); };
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
const idbGet = (key) => idb('readonly', (s) => s.get(key));
const idbSet = (key, value) => idb('readwrite', (s) => s.put(value, key));

function local(op, key, value) {
  try { return op === 'get' ? globalThis.localStorage?.getItem(key) ?? null : (globalThis.localStorage?.setItem(key, value), value); } catch { return null; }
}

/** 값 하나를 두 저장소에서 읽고 한쪽만 있으면 다른 쪽을 채운다. 둘 다 없으면 create()로 만든다. */
async function durable(key, valid, create) {
  let value = local('get', key);
  if (!valid(value)) {
    const stored = await idbGet(key);
    value = valid(stored) ? stored : create();
    local('set', key, value);
  }
  if ((await idbGet(key)) !== value) await idbSet(key, value);
  return value;
}

export function deviceKey() { return durable(DEVICE_KEY_NAME, isDeviceKey, () => createDeviceKey(globalThis.crypto)); }
export function installId() { return durable(INSTALL_ID_NAME, (v) => typeof v === 'string' && UUID.test(v), () => globalThis.crypto.randomUUID()); }
