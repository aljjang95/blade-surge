// 스트리밍 채널 시작 절차: 매니페스트를 읽고 보관본을 복원한 뒤, DOM 해석기·실패 보정·내려받기 표시를 설치한다. 다른 채널은 아무것도 하지 않는다.
import { remoteAssets } from './remote-assets.js';
import { installDomResolver } from './remote-dom.js';
import { mountRemoteIndicator } from './remote-indicator.js';
import { createPrefetcher } from './remote-prefetch.js';

export const prefetcher = createPrefetcher(remoteAssets);

/** @returns {Promise<boolean>} 스트리밍이 켜졌는지 */
export async function setupRemoteAssets() {
  const on = await remoteAssets.init();
  if (!on) return false;
  installDomResolver(remoteAssets);
  remoteAssets.installFallback();
  mountRemoteIndicator(remoteAssets);
  // 점검·QA 가 읽는 표시용 핸들(통계·진행). 해석기 자체를 바꾸는 입구는 아니다.
  globalThis.__remoteAssets = remoteAssets;
  return true;
}
