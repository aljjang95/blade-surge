const seen = new WeakMap();
const ENTRANCES = { glass_garden: { src: '/video/expansion/glass-garden-intro.mp4', poster: '/img/expansion/glass_garden.webp', name: '유리 정원' } };

/** A bounded, silent entrance film; media failure never blocks the expedition. */
export function playExpeditionIntro(app, id, { force = false } = {}) {
  const film = ENTRANCES[id];
  if (!film || (!force && (app.reducedMotion.matches || seen.get(app)?.has(id)))) return Promise.resolve(false);
  if (document.querySelector('.exp-cinematic')) return Promise.resolve(false);
  const watched = seen.get(app) || new Set();
  watched.add(id); seen.set(app, watched);
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const backgrounds = ['meta', 'hud', 'expedition-root'].map(id => document.getElementById(id)).filter(Boolean).map(el => [el, el.inert]);
    for (const [el] of backgrounds) el.inert = true;
    const overlay = document.createElement('section');
    overlay.className = 'exp-cinematic'; overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', `${film.name} 입장 영상`);
    const video = document.createElement('video');
    video.src = film.src; video.poster = film.poster; video.muted = true;
    video.playsInline = true; video.preload = 'auto'; video.setAttribute('aria-hidden', 'true');
    const title = document.createElement('div');
    title.className = 'exp-cinematic-title'; title.textContent = film.name;
    const skip = document.createElement('button');
    skip.type = 'button'; skip.textContent = '건너뛰기  ↗';
    overlay.append(video, title, skip); document.body.append(overlay);
    let finished = false;
    const finish = played => {
      if (finished) return;
      finished = true; clearTimeout(deadline); document.removeEventListener('keydown', onKey, true);
      video.pause(); video.removeAttribute('src'); video.load(); overlay.remove();
      for (const [el, inert] of backgrounds) el.inert = inert;
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(played);
    };
    const onKey = e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(true); }
      if (e.key === 'Tab') { e.preventDefault(); skip.focus(); }
    };
    const deadline = setTimeout(() => finish(false), 12000);
    skip.addEventListener('click', () => finish(true));
    video.addEventListener('ended', () => finish(true), { once: true });
    video.addEventListener('error', () => finish(false), { once: true });
    document.addEventListener('keydown', onKey, true); skip.focus();
    video.play().catch(() => finish(false));
  });
}
