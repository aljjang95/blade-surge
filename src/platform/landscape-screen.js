/** 첫 터치 안에서 전체화면을 요청하고, 승인된 화면에서 가로 잠금을 시도한다. */
export function requestLandscapeScreen(view = window, doc = document) {
  const orientation = view.screen?.orientation;
  const result = { fullscreen: doc.fullscreenElement ? 'active' : 'unsupported', orientation: 'unsupported' };
  const lock = async () => {
    if (typeof orientation?.lock === 'function') {
      try { await orientation.lock('landscape'); result.orientation = 'locked'; }
      catch { result.orientation = 'unavailable'; }
    }
    return result;
  };
  if (doc.fullscreenElement) return lock();
  if (!doc.fullscreenEnabled || typeof doc.documentElement.requestFullscreen !== 'function') return lock();
  try {
    // 이 호출 앞에 await를 넣으면 사용자 터치 권한이 사라질 수 있다.
    const request = doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return Promise.resolve(request).then(() => { result.fullscreen = 'active'; return lock(); }, () => {
      result.fullscreen = 'unavailable'; return result;
    });
  } catch { result.fullscreen = 'unavailable'; return Promise.resolve(result); }
}

export function mobileScreen(view = window, nav = navigator) {
  return nav.maxTouchPoints > 0 || view.matchMedia('(any-pointer: coarse)').matches;
}
