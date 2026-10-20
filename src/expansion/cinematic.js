const seen = new WeakMap();
const ENTRANCES = { glass_garden: { src: '/video/expansion/glass-garden-intro.mp4', poster: '/img/expansion/glass_garden.webp', name: '유리 정원' } };

/**
 * 세로 화면이면 영상을 90도 돌려 가로 프레임으로 채운다. 프레임 비율이 영상(16:9)에 가까우면 cover, 아니면 contain.
 * 순수 함수라 테스트에서 화면 크기만 넘겨 확인한다.
 */
export function filmFrame(width, height) {
  const rotated = height > width;
  const [long, short] = rotated ? [height, width] : [width, height];
  const aspect = short > 0 ? long / short : 16 / 9;
  const gap = Math.max(aspect, 16 / 9) / Math.min(aspect, 16 / 9);
  return { rotated, cover: gap <= 1.15, frameWidth: long, frameHeight: short };
}

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
    // 화면 방향이 바뀌어도 가로 프레임이 유지되도록 크기·회전·맞춤 방식을 다시 계산한다.
    const layout = () => {
      const frame = filmFrame(window.innerWidth, window.innerHeight);
      overlay.classList.toggle('is-rotated', frame.rotated); overlay.classList.toggle('is-cover', frame.cover);
      overlay.style.width = frame.rotated ? `${frame.frameWidth}px` : '';
      overlay.style.height = frame.rotated ? `${frame.frameHeight}px` : '';
    };
    layout();
    const orientation = window.screen?.orientation;
    window.addEventListener('resize', layout); orientation?.addEventListener?.('change', layout);
    // 잠금은 전체화면 등 브라우저가 허용할 때만 되므로 기다리지도, 실패에 막히지도 않는다.
    try { Promise.resolve(orientation?.lock?.('landscape')).catch(() => {}); } catch { /* 미지원 */ }
    let finished = false;
    const finish = played => {
      if (finished) return;
      finished = true; clearTimeout(deadline); document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', layout); orientation?.removeEventListener?.('change', layout);
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
