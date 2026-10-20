// 기기 키·저장소 도우미 (브라우저 전용 순수 JS, 프레임워크 없음)
import { DEVICE_KEY } from '../shared/protocol';

/**
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void }} KeyValueStorage
 */

/** @returns {KeyValueStorage} */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
}

/**
 * localStorage 접근이 막히거나(사파리 비공개 모드·iframe 정책) 쓰기가 실패해도 메모리로 이어 간다.
 * @param {KeyValueStorage | null | undefined} storage undefined면 globalThis.localStorage를 시도한다.
 * @returns {KeyValueStorage}
 */
export function safeStorage(storage) {
  const fallback = memoryStorage();
  /** @type {KeyValueStorage | null} */
  let primary = null;
  try {
    const candidate = storage === undefined ? globalThis.localStorage : storage;
    if (candidate) {
      const probe = 'tll-social:probe';
      candidate.setItem(probe, '1');
      candidate.removeItem(probe);
      primary = candidate;
    }
  } catch {
    primary = null;
  }
  return {
    getItem(key) {
      if (primary) {
        try {
          const value = primary.getItem(key);
          if (value !== null && value !== undefined) return value;
        } catch { /* 메모리로 대체 */ }
      }
      return fallback.getItem(key);
    },
    setItem(key, value) {
      fallback.setItem(key, value);
      if (primary) {
        try { primary.setItem(key, value); } catch { /* 용량 초과 등은 메모리 값으로 유지 */ }
      }
    },
    removeItem(key) {
      fallback.removeItem(key);
      if (primary) {
        try { primary.removeItem(key); } catch { /* 무시 */ }
      }
    },
  };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 패딩 없는 base64url 인코딩.
 * @param {Uint8Array} bytes
 */
export function base64url(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/**
 * @param {{ getRandomValues<T extends ArrayBufferView>(array: T): T } | undefined} cryptoImpl
 * @param {number} size
 */
export function randomBytes(cryptoImpl, size) {
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') throw new Error('crypto-unavailable');
  return cryptoImpl.getRandomValues(new Uint8Array(size));
}

/** 32바이트 난수 → base64url 43자. 이 값이 곧 기기 이전 코드다. */
export function createDeviceKey(cryptoImpl) {
  return base64url(randomBytes(cryptoImpl, 32));
}

/** 12바이트 난수 → 16자 nonce (서버 NONCE 규칙 8~32자 충족). */
export function createNonce(cryptoImpl) {
  return base64url(randomBytes(cryptoImpl, 12));
}

/** @param {unknown} value */
export function isDeviceKey(value) {
  return typeof value === 'string' && DEVICE_KEY.test(value);
}
