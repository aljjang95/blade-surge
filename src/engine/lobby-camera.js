export const LOBBY_VIEWS = {
  oath: { label: '기본', yaw: 19, pitch: 11, zoom: 100 },
  front: { label: '정면', yaw: 27, pitch: 8, zoom: 112 },
  side: { label: '측면', yaw: 85, pitch: 16, zoom: 100 },
  back: { label: '뒷모습', yaw: -153, pitch: 16, zoom: 100 },
};
const bounded = (v, fallback, min, max) => Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
export function normalizeLobbyCamera(value) {
  const v = value && typeof value === 'object' ? value : {};
  return { yaw: bounded(v.yaw, 19, -180, 180), pitch: bounded(v.pitch, 11, 8, 42), zoom: bounded(v.zoom, 100, 75, 135) };
}
export function lobbyCameraPosition(value) {
  const v = normalizeLobbyCamera(value), yaw = v.yaw * Math.PI / 180, pitch = v.pitch * Math.PI / 180;
  const radius = 5.5 * 100 / v.zoom;
  return { x: radius * Math.sin(yaw) * Math.cos(pitch), y: 1.1 + radius * Math.sin(pitch), z: radius * Math.cos(yaw) * Math.cos(pitch) };
}

/** 로비 조작은 전투 카메라와 전투 입력에 영향을 주지 않는다. */
export class LobbyCameraControls {
  constructor(app) {
    this.app = app;
    this.pad = document.getElementById('lobby-camera-pad');
    this.panel = document.getElementById('lobby-camera-panel');
    this.toggle = document.getElementById('lobby-camera-toggle');
    this.toggle.onclick = () => {
      this.panel.hidden = !this.panel.hidden;
      this.toggle.setAttribute('aria-expanded', String(!this.panel.hidden));
    };
    this.panel.querySelectorAll('[data-lobby-view]').forEach(button => {
      button.onclick = () => this.set(LOBBY_VIEWS[button.dataset.lobbyView]);
    });
    this.panel.querySelectorAll('input').forEach(input => input.addEventListener('input', () => this.set({ ...this.value, [input.name]: Number(input.value) })));
    this.pad.addEventListener('pointerdown', event => {
      if (!this.active || this.drag || (event.button !== 0 && event.button !== 2)) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...this.value };
      this.pad.setPointerCapture(event.pointerId); event.preventDefault();
    });
    this.pad.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      if (!this.active) { finish(); return; }
      const yaw = this.drag.yaw - (event.clientX - this.drag.x) * .45;
      this.set({ ...this.value, yaw: ((yaw + 540) % 360) - 180, pitch: this.drag.pitch + (event.clientY - this.drag.y) * .14 }, false);
    });
    const finish = () => {
      const drag = this.drag; this.drag = null;
      if (drag) { this.app.eco.save(); if (this.pad.hasPointerCapture(drag.id)) this.pad.releasePointerCapture(drag.id); }
    };
    this.pad.addEventListener('contextmenu', event => { if (this.active) event.preventDefault(); });
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.pad.addEventListener(name, event => {
      if (this.drag?.id === event.pointerId) finish();
    });
    this.pad.addEventListener('wheel', event => {
      if (!this.active) return;
      event.preventDefault(); this.set({ ...this.value, zoom: this.value.zoom - Math.sign(event.deltaY) * 5 });
    }, { passive: false });
    this.pad.addEventListener('keydown', event => {
      if (!this.active) return;
      const v = this.value;
      if (event.key === 'ArrowLeft') v.yaw -= 8;
      else if (event.key === 'ArrowRight') v.yaw += 8;
      else if (event.key === 'ArrowUp') v.pitch += 3;
      else if (event.key === 'ArrowDown') v.pitch -= 3;
      else if (event.key === '+' || event.key === '=') v.zoom += 5;
      else if (event.key === '-') v.zoom -= 5;
      else if (event.key === 'Home') Object.assign(v, LOBBY_VIEWS.oath);
      else return;
      event.preventDefault(); this.set(v);
    });
    this.sync();
  }
  get active() { return this.app.mode === 'lobby' && this.app.meta.tab === 'home' && !this.app.companionAgent?.getSnapshot().open && !document.getElementById('modal').classList.contains('show'); }
  get value() { return normalizeLobbyCamera(this.app.eco.s.settings.lobbyCamera); }
  set(value, save = true) {
    this.app.eco.s.settings.lobbyCamera = normalizeLobbyCamera(value);
    this.app.renderer.lobbyCamera = this.value;
    this.sync(); if (save) this.app.eco.save();
  }
  sync() {
    const v = this.value;
    this.app.renderer.lobbyCamera = v;
    for (const input of this.panel.querySelectorAll('input')) input.value = v[input.name];
    for (const button of this.panel.querySelectorAll('[data-lobby-view]')) {
      const preset = LOBBY_VIEWS[button.dataset.lobbyView];
      button.setAttribute('aria-pressed', String(['yaw', 'pitch', 'zoom'].every(k => v[k] === preset[k])));
    }
  }
}
