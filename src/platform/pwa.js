/** Install/update state only; a worker update never silently reloads an active game. */
export function setupPwa() {
  let registration = null, installPrompt = null, requestedUpdate = false;
  const state = { supported: 'serviceWorker' in navigator, canInstall: false, updateAvailable: false,
    installed: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true, status: 'idle' };
  const publish = () => window.dispatchEvent(new CustomEvent('bladesurge:pwa-state', { detail: { ...state } }));
  const api = {
    getState: () => ({ ...state }),
    async install() {
      if (!installPrompt) return { outcome: 'unavailable' };
      const prompt = installPrompt; installPrompt = null; state.canInstall = false; publish();
      try { await prompt.prompt(); return await prompt.userChoice; }
      catch { return { outcome: 'unavailable' }; }
    },
    applyUpdate() {
      if (!registration?.waiting) return false;
      requestedUpdate = true; registration.waiting.postMessage({ type: 'APPLY_UPDATE' }); return true;
    },
    async checkUpdate() {
      try { await registration?.update(); } catch { state.status = 'offline'; publish(); }
    },
  };
  if (!import.meta.env.PROD || !state.supported || !window.isSecureContext) { state.status = 'unavailable'; return api; }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; state.canInstall = true; publish();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; state.canInstall = false; state.installed = true; publish(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (requestedUpdate) { requestedUpdate = false; location.reload(); }
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
    registration = reg; state.status = 'ready'; state.updateAvailable = !!reg.waiting; publish();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') { state.updateAvailable = !!reg.waiting && !!navigator.serviceWorker.controller; publish(); }
      });
    });
  }).catch(() => { state.status = 'unavailable'; publish(); });
  return api;
}
