import { Capacitor } from '@capacitor/core';

const sessions = new WeakMap();
export const isNativeApp = () => Capacitor.isNativePlatform();

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
 * @param {{native?: boolean, loadPlugin?: () => Promise<{App: Pick<import('@capacitor/app').AppPlugin, 'addListener' | 'getState'>}>, doc?: Document}} [options]
 */
export function setupNativeApp(app, { native = isNativeApp(), loadPlugin = () => import('@capacitor/app'), doc = globalThis.document } = {}) {
  if (sessions.has(app)) return sessions.get(app);
  let disposed = false, background = false, ownedBattle = null, stateRevision = 0;
  let nativeActive = true, pageActive = doc?.hidden !== true;
  const handles = [];
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
  };
  const setActive = isActive => setSourceActive(isActive, true);
  const setVisible = isVisible => setSourceActive(isVisible, false);
  const api = { ready: Promise.resolve(), sync, setActive, setVisible, async dispose() {
    disposed = true;
    if (ownedBattle) { ownedBattle.setPaused('native-background', false); ownedBattle = null; }
    await Promise.allSettled(handles.splice(0).map(h => h.remove()));
    sessions.delete(app);
  } };
  sessions.set(app, api);
  if (!native) return api;
  setVisible(pageActive);
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
