import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import './native-app.css';

const sessions = new WeakMap();
export const isNativeApp = () => Capacitor.isNativePlatform();

/**
 * 설치된 Capacitor 8.5.1 SystemBars로 밝은 아이콘 스타일과 상태·탐색 막대 숨김을 요청한다.
 * 'requested'는 플러그인이 호출을 받았다는 뜻일 뿐 OS가 실제로 숨겼다는 증거가 아니다.
 * @param {Pick<import('@capacitor/core').SystemBarsPlugin, 'hide' | 'setStyle'> | null | undefined} bars
 * @returns {Promise<'requested' | 'unavailable'>}
 */
export async function requestImmersiveSystemBars(bars = SystemBars) {
  if (typeof bars?.hide !== 'function') return 'unavailable';
  // 막대가 스와이프로 잠시 드러날 때 어두운 게임 배경 위에서 아이콘이 보이도록 먼저 맞춘다.
  try { await bars.setStyle?.({ style: SystemBarsStyle.Dark }); } catch { /* 스타일 실패는 숨김 요청을 막지 않는다. */ }
  try { await bars.hide(); return 'requested'; } catch { return 'unavailable'; }
}

/** Back never grants, abandons a run, resumes manual pause, or exits the app. */
export function handleNativeBack(app, doc = document) {
  const dialogs = [...doc.querySelectorAll('dialog[open]')];
  const dialog = dialogs.find(d => d.contains(doc.activeElement)) || dialogs.at(-1);
  if (dialog) {
    const cancel = new Event('cancel', { cancelable: true });
    if (dialog.dispatchEvent(cancel)) dialog.close();
    return;
  }
  if (app.ui?.el?.modal?.classList.contains('show')) {
    // Run the existing cancel callback so pending confirm promises also settle.
    const cancel = app.ui.el.modalBox?.querySelector('#m-cancel, #p-cancel, #ad-cancel');
    if (cancel) cancel.click();
    // Mandatory reward/revive choices stay open; do not infer a destructive answer.
    return;
  }
  if (app.companionAgent?.getSnapshot?.().open) { app.companionAgent.setOpen(false); return; }
  if (app.battle?.active) { app.ui?.pause(true); return; }
  if (app.expeditionUI?.opened) { app.expeditionUI.close(); return; }
  if (app.mode === 'lobby' && app.meta?.tab !== 'home') { app.meta.openTab('home'); return; }
  app.ui?.toast('진행은 기기에 저장됩니다. 홈 버튼으로 앱을 나갈 수 있습니다.');
}

/** Own only native-background; never remove someone else's pause reason/listener.
 * @param {any} app
 * @param {{native?: boolean, loadPlugin?: () => Promise<{App: Pick<import('@capacitor/app').AppPlugin, 'addListener' | 'getState'>}>, doc?: Document,
 *   systemBars?: Pick<import('@capacitor/core').SystemBarsPlugin, 'hide' | 'setStyle'> | null}} [options]
 */
export function setupNativeApp(app, { native = isNativeApp(), loadPlugin = () => import('@capacitor/app'), doc = globalThis.document, systemBars = SystemBars } = {}) {
  if (sessions.has(app)) return sessions.get(app);
  let disposed = false, background = false, ownedBattle = null, stateRevision = 0;
  let nativeActive = true, pageActive = doc?.hidden !== true;
  const handles = [];
  /** @type {Promise<'requested' | 'unavailable' | 'disposed'>} */
  let barsRequest = Promise.resolve('unavailable');
  // 시작과 복귀마다 다시 요청한다. Android는 백그라운드를 다녀오면 막대를 다시 보일 수 있다.
  const hideSystemBars = () => {
    if (disposed || !native) return barsRequest;
    barsRequest = requestImmersiveSystemBars(systemBars).then(result => {
      if (!disposed) api.systemBars = result;
      return disposed ? 'disposed' : result;
    });
    return barsRequest;
  };
  const sync = () => {
    if (disposed || !native) return;
    const battle = app.battle;
    if (ownedBattle && (!background || ownedBattle !== battle)) { ownedBattle.setPaused('native-background', false); ownedBattle = null; }
    if (background && battle?.active) {
      if (!battle.pauseReasons?.has('native-background')) battle.setPaused('native-background', true);
      ownedBattle = battle;
    }
  };
  // 문서 표시와 Activity 활성 상태가 모두 복구된 경우에만 재개한다.
  const setSourceActive = (isActive, fromNative) => {
    if (disposed || !native || typeof isActive !== 'boolean') return;
    if (fromNative) stateRevision++;
    const wasBackground = background;
    if (fromNative) nativeActive = isActive; else pageActive = isActive;
    background = !nativeActive || !pageActive;
    // 저장/입력 오류가 전투 정지를 건너뛰지 않도록 정지를 먼저 적용한다.
    sync();
    if (background && !wasBackground) {
      try { app.input?.clear(); } catch {}
      try { app.eco?.save(); } catch {}
    }
    if (!background && wasBackground) hideSystemBars();
  };
  const setActive = isActive => setSourceActive(isActive, true);
  const setVisible = isVisible => setSourceActive(isVisible, false);
  const api = { ready: Promise.resolve(), sync, setActive, setVisible, hideSystemBars,
    /** @type {'idle' | 'requested' | 'unavailable'} */
    systemBars: 'idle',
    get systemBarsRequest() { return barsRequest; },
    async dispose() {
    disposed = true;
    if (ownedBattle) { ownedBattle.setPaused('native-background', false); ownedBattle = null; }
    await Promise.allSettled(handles.splice(0).map(h => h.remove()));
    sessions.delete(app);
  } };
  sessions.set(app, api);
  if (!native) return api;
  setVisible(pageActive);
  hideSystemBars();
  api.ready = (async () => {
    try {
      const { App } = await loadPlugin();
      if (disposed) return;
      const bind = async (name, listener) => {
        try {
          const handle = await App.addListener(name, (...args) => { if (!disposed) { try { listener(...args); } catch {} } });
          if (disposed) await handle.remove(); else handles.push(handle);
        } catch { /* A missing native capability must not abort boot. */ }
      };
      const state = ({ isActive }) => {
        if (typeof isActive !== 'boolean') return;
        setActive(isActive);
      };
      await Promise.all([
        bind('appStateChange', state), bind('pause', () => setActive(false)),
        bind('resume', () => setActive(true)), bind('backButton', () => handleNativeBack(app, doc)),
      ]);
      // 초기 조회는 네이티브 이벤트를 한 번도 받지 않은 동안에만 사용한다.
      // 등록 도중의 onPause와 독립적인 문서 표시 상태를 덮어쓰지 않는다.
      if (stateRevision === 0) {
        try { const current = await App.getState(); if (!disposed && stateRevision === 0) state(current); } catch {}
      }
    } catch { /* Web and unsupported native hosts continue playing. */ }
  })();
  return api;
}
