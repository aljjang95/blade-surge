function platform() {
  const ua=navigator.userAgent||'',ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  return ios?'ios':/Android/i.test(ua)?'android':'other';
}

/** Install/update state only; a worker update never silently reloads an active game. */
export function setupPwa({ native = false, canApplyUpdate = () => true } = {}) {
  let registration = null, installPrompt = null, requestedUpdate = false, reloadDeferred = false;
  const device=platform();
  const state = { supported: 'serviceWorker' in navigator, canInstall: false, updateAvailable: false,
    installed: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
      || (window.matchMedia('(display-mode: fullscreen)').matches && !globalThis.document?.fullscreenElement),
    platform:device,manualInstall:device==='ios'||device==='android',online:navigator.onLine!==false,status:navigator.onLine===false?'offline':'idle' };
  const publish = () => window.dispatchEvent(new CustomEvent('bladesurge:pwa-state', { detail: { ...state } }));
  const syncWaiting = () => {
    state.updateAvailable = reloadDeferred || !!(registration?.waiting && navigator.serviceWorker.controller);
    publish();
  };
  const api = {
    getState: () => ({ ...state }),
    async install() {
      if (!installPrompt) return { outcome: 'unavailable' };
      const prompt = installPrompt; installPrompt = null; state.canInstall = false; publish();
      try { await prompt.prompt(); return await prompt.userChoice; }
      catch { return { outcome: 'unavailable' }; }
    },
    applyUpdate() {
      if (!canApplyUpdate()) { state.status = 'update-deferred'; publish(); return false; }
      if (reloadDeferred) { reloadDeferred=false;location.reload();return true; }
      if (!registration?.waiting) return false;
      requestedUpdate = true; registration.waiting.postMessage({ type: 'APPLY_UPDATE' }); return true;
    },
    async checkUpdate() {
      try { await registration?.update(); }
      catch { state.status = state.online?'update-check-failed':'offline'; publish(); }
    },
  };
  if (native || !import.meta.env.PROD || !state.supported || !window.isSecureContext) { state.supported = !native && state.supported; state.status = 'unavailable'; return api; }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; state.canInstall = true; publish();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; state.canInstall = false; state.installed = true; publish(); });
  window.addEventListener('online',()=>{state.online=true;state.status=registration?'ready':'idle';publish();});
  window.addEventListener('offline',()=>{state.online=false;state.status='offline';publish();});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!requestedUpdate) { syncWaiting(); return; }
    requestedUpdate = false;
    if (canApplyUpdate()) location.reload();
    else { reloadDeferred=true;state.updateAvailable=true;state.status='update-deferred';publish(); }
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
    registration = reg; state.status = state.online?'ready':'offline'; syncWaiting();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') syncWaiting();
      });
    });
  }).catch(() => { state.status = 'unavailable'; publish(); });
  return api;
}
