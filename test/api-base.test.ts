import { expect, test } from 'bun:test';
import { API_ORIGIN, apiBase, apiUrl, isNativeBuild, publicHref } from '../src/platform/api-base.js';

const webRuntime = undefined;
const nativeRuntime = { isNativePlatform: () => true };

test('웹 빌드는 같은 출처 상대 경로를 그대로 쓴다', () => {
  expect(isNativeBuild({ channel: 'web', runtime: webRuntime })).toBe(false);
  expect(apiBase({ channel: 'web', runtime: webRuntime })).toBe('');
  expect(apiUrl('/api/party', { channel: 'web', runtime: webRuntime })).toBe('/api/party');
});

test('스토어 채널 빌드와 Capacitor 네이티브는 정식 호스트 절대 주소를 쓴다', () => {
  for (const channel of ['googleplay', 'onestore', 'apps-in-toss']) {
    expect(apiUrl('/api/social', { channel, runtime: webRuntime })).toBe(`${API_ORIGIN}/api/social`);
  }
  expect(apiBase({ channel: 'web', runtime: nativeRuntime })).toBe(API_ORIGIN);
  expect(API_ORIGIN).toBe('https://blade.tllhouse.com');
});

test('네이티브 판별이 던져도 웹으로 안전하게 떨어진다', () => {
  expect(isNativeBuild({ channel: 'web', runtime: { isNativePlatform: () => { throw Error('x'); } } })).toBe(false);
  expect(isNativeBuild({ channel: 'web', runtime: { isNativePlatform: () => false } })).toBe(false);
});

test('앱의 초대 링크 기준은 공유 가능한 정식 호스트다', () => {
  expect(publicHref({ channel: 'googleplay', runtime: webRuntime })).toBe('https://blade.tllhouse.com/');
});
