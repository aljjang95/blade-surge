// 서버 API 주소 기준점. 웹은 같은 출처(상대 경로)를 쓰고, 스토어 앱(WebView 출처가 https://localhost 등)은
// 정식 호스트의 절대 주소를 써야 한다. 상대 경로 fetch는 앱 안에서 localhost로 가서 404가 된다.
import { STORE_CHANNEL } from './store-channel.js';

export const API_ORIGIN = 'https://blade.tllhouse.com';

/**
 * 스토어 채널 빌드이거나 Capacitor 네이티브 런타임이면 true.
 * @param {{ channel?: string, runtime?: any }} [options]
 */
export function isNativeBuild({ channel = STORE_CHANNEL, runtime = globalThis.Capacitor } = {}) {
  if (channel !== 'web') return true;
  try { return runtime?.isNativePlatform?.() === true; } catch { return false; }
}

/** 웹은 '', 앱은 정식 호스트 origin. 끝 슬래시 없음. */
export function apiBase(options) { return isNativeBuild(options) ? API_ORIGIN : ''; }

/** '/api/...' 경로를 환경에 맞는 주소로 바꾼다. */
export function apiUrl(path, options) { return apiBase(options) + path; }

/** 초대 링크처럼 다른 기기에서 열릴 주소의 기준. 앱 안의 https://localhost는 공유할 수 없다. */
export function publicHref(options) {
  return isNativeBuild(options) ? API_ORIGIN + '/' : globalThis.location.href;
}
