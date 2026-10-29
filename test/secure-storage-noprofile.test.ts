import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { deviceKey, DEVICE_KEY_NAME, NO_PROFILE_NAME } from '../src/net/secure-storage.js';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, String(v)); }, removeItem: (k: string) => { map.delete(k); }, map };
}

describe('기기 키 생성과 소셜 noprofile 표지', () => {
  let storage: ReturnType<typeof memoryStorage>;
  const saved = { localStorage: (globalThis as any).localStorage, indexedDB: (globalThis as any).indexedDB };
  afterEach(() => { (globalThis as any).localStorage = saved.localStorage; (globalThis as any).indexedDB = saved.indexedDB; });
  beforeEach(() => { storage = memoryStorage(); (globalThis as any).localStorage = storage; (globalThis as any).indexedDB = undefined; });

  test('새로 만든 기기 키는 같은 값으로 noprofile 표지를 남긴다', async () => {
    const key = await deviceKey();
    expect(storage.getItem(DEVICE_KEY_NAME)).toBe(key);
    expect(storage.getItem(NO_PROFILE_NAME)).toBe(key);
  });

  test('이미 있던 키는 표지를 만들지 않는다(서버 프로필이 있을 수 있음)', async () => {
    const first = await deviceKey();
    storage.removeItem(NO_PROFILE_NAME);
    expect(await deviceKey()).toBe(first);
    expect(storage.getItem(NO_PROFILE_NAME)).toBeNull();
  });
});
