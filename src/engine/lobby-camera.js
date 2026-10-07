export const LOBBY_VIEWS = {
  oath: { label: '기본', yaw: 19, pitch: 11, zoom: 100 },
  front: { label: '정면', yaw: 27, pitch: 11, zoom: 90 },
  city: { label: '성채', yaw: 180, pitch: 12, zoom: 78 },
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

const walkingLandscape = Object.freeze({ x: 0, y: 1.1 + 15 * Math.sin(35 * Math.PI / 180), z: 15 * Math.cos(35 * Math.PI / 180) });
const walkingPortrait = Object.freeze({ x: 0, y: 1.1 + 16.5 * Math.sin(48 * Math.PI / 180), z: 16.5 * Math.cos(48 * Math.PI / 180) });
const walkingCache = [false, true].map(() => ({ yaw: NaN, pitch: NaN, zoom: NaN, position: { x: 0, y: 0, z: 0 } }));
/** 기존 저장 다이얼을 광장 기본 구도의 상대 조작으로 적용하고 같은 프레임에서는 버퍼를 재사용한다. */
export function walkingLobbyCameraPosition(portrait = false, value) {
  const yaw = bounded(value?.yaw, 19, -180, 180), pitch = bounded(value?.pitch, 11, 8, 42), zoom = bounded(value?.zoom, 100, 75, 135);
  if (yaw === 19 && pitch === 11 && zoom === 100) return portrait ? walkingPortrait : walkingLandscape;
  const cached = walkingCache[portrait ? 1 : 0];
  if (cached.yaw !== yaw || cached.pitch !== pitch || cached.zoom !== zoom) {
    const elevation = Math.max(28, Math.min(portrait ? 63 : 58, (portrait ? 48 : 35) + (pitch - 11) * .7)) * Math.PI / 180;
    const bearing = (yaw - 19) * Math.PI / 180, radius = (portrait ? 16.5 : 15) * 100 / zoom;
    cached.position.x = radius * Math.sin(bearing) * Math.cos(elevation);
    cached.position.y = 1.1 + radius * Math.sin(elevation);
    cached.position.z = radius * Math.cos(bearing) * Math.cos(elevation);
    cached.yaw = yaw; cached.pitch = pitch; cached.zoom = zoom;
  }
  return cached.position;
}

const WALKING_LOBBY_VIEWS = {
  oath: LOBBY_VIEWS.oath, front: { yaw: 19, pitch: 11, zoom: 120 },
  city: { yaw: -161, pitch: 16, zoom: 78 }, side: { yaw: 109, pitch: 16, zoom: 100 },
  back: { yaw: -161, pitch: 16, zoom: 100 },
};
const CAMERA_UI = 'button, input, select, textarea, a, [contenteditable], [role="dialog"], dialog, .citadel-hub-stick, .citadel-hub-near, .lobby-camera-tools, .bottomnav, .topbar, .lobby-left, .companion-launcher';

/** 로비 조작은 전투 카메라와 전투 입력에 영향을 주지 않는다. */
export class LobbyCameraControls {
  constructor(app) {
    this.app = app;
    this.pad = document.getElementById('lobby-camera-pad');
    this.panel = document.getElementById('lobby-camera-panel');
    this.toggle = document.getElementById('lobby-camera-toggle');
    this.toggle.onclick = () => {
      if (!this.active) return;
      this.finish();
      this.panel.hidden = !this.panel.hidden;
      this.toggle.setAttribute('aria-expanded', String(!this.panel.hidden));
      if (this.panel.hidden) this.restoreWalkingFocus(this.toggle);
    };
    this.panel.querySelectorAll('[data-lobby-view]').forEach(button => {
      button.onclick = () => { if (this.active) { this.finish(); this.set(this.views[button.dataset.lobbyView]); this.restoreWalkingFocus(button); } };
    });
    this.panel.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
      if (this.active) this.set({ ...this.value, [input.name]: Number(input.value) });
    }));
    document.addEventListener('pointerdown', event => {
      const onPad = this.pad.contains(event.target);
      const world = event.target === this.app.canvas || event.target?.id === 'tab-home';
      if (!this.active || event.defaultPrevented || (event.button !== 0 && event.button !== 2) ||
        (!onPad && (!world || event.pointerType === 'touch' || event.target.closest?.(CAMERA_UI)))) return;
      if (this.drag && (!onPad || event.pointerType !== 'touch' || this.drag.type !== 'touch' || this.second)) return;
      const surface = onPad ? this.pad : this.app.canvas;
      const pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        type: event.pointerType, surface, ...this.value };
      try { surface.setPointerCapture?.(pointer.id); } catch { return; }
      if (this.drag) {
        this.second = pointer;
        this.pinch = { distance: Math.max(1, Math.hypot(this.drag.x - pointer.x, this.drag.y - pointer.y)), zoom: this.value.zoom };
      } else { this.drag = pointer; this.gestureChanged = false; }
      event.preventDefault();
    });
    document.addEventListener('pointermove', event => {
      const pointer = this.drag?.id === event.pointerId ? this.drag : this.second?.id === event.pointerId ? this.second : null;
      if (!pointer) return;
      if (!this.active) { this.finish(); return; }
      pointer.x = event.clientX; pointer.y = event.clientY;
      if (this.second) {
        const distance = Math.hypot(this.drag.x - this.second.x, this.drag.y - this.second.y);
        this.set({ ...this.value, zoom: this.pinch.zoom * distance / this.pinch.distance }, false);
      } else {
        const yaw = this.drag.yaw - (pointer.x - this.drag.startX) * .45;
        this.set({ ...this.value, yaw: ((yaw + 540) % 360) - 180, pitch: this.drag.pitch + (pointer.y - this.drag.startY) * .14 }, false);
      }
      event.preventDefault();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, event => {
      if (this.drag?.id !== event.pointerId && this.second?.id !== event.pointerId) return;
      if (name !== 'pointerup') { this.finish(); return; }
      if (this.second) {
        const finished = this.drag.id === event.pointerId ? this.drag : this.second;
        const remaining = this.drag.id === event.pointerId ? this.second : this.drag;
        this.drag = remaining; this.second = this.pinch = null;
        Object.assign(remaining, this.value, { startX: remaining.x, startY: remaining.y });
        this.release(finished);
      } else this.finish();
    });
    document.addEventListener('contextmenu', event => {
      if (this.active && (event.target === this.app.canvas || event.target?.id === 'tab-home' || this.pad.contains(event.target))) event.preventDefault();
    });
    for (const name of ['blur', 'pagehide', 'resize', 'orientationchange']) window.addEventListener(name, () => this.finish());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finish(); });
    this.app.input?.onClear?.(() => this.finish());
    document.addEventListener('wheel', event => {
      const onPad = this.pad.contains(event.target), world = event.target === this.app.canvas || event.target?.id === 'tab-home';
      if (!this.active || event.ctrlKey || event.metaKey || !Number.isFinite(event.deltaY) || !event.deltaY ||
        (!onPad && (!world || event.target.closest?.(CAMERA_UI)))) return;
      event.preventDefault(); this.set({ ...this.value, zoom: this.value.zoom - Math.sign(event.deltaY) * 5 });
    }, { passive: false });
    this.pad.addEventListener('keydown', event => {
      if (!this.active || event.ctrlKey || event.metaKey || event.altKey) return;
      const v = this.value;
      if (event.key === 'ArrowLeft') v.yaw -= 8;
      else if (event.key === 'ArrowRight') v.yaw += 8;
      else if (event.key === 'ArrowUp') v.pitch += 3;
      else if (event.key === 'ArrowDown') v.pitch -= 3;
      else if (event.key === '+' || event.key === '=') v.zoom += 5;
      else if (event.key === '-') v.zoom -= 5;
      else if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); this.reset(); return; }
      else return;
      event.preventDefault(); event.stopPropagation(); this.set(v);
    });
    for (const [id, action] of Object.entries({
      'lobby-camera-reset': () => this.reset(), 'lobby-camera-zoom-in': () => this.set({ ...this.value, zoom: this.value.zoom + 10 }),
      'lobby-camera-zoom-out': () => this.set({ ...this.value, zoom: this.value.zoom - 10 }),
    })) {
      const button = document.getElementById(id);
      button?.addEventListener('click', () => { if (this.active) { action(); this.restoreWalkingFocus(button); } });
    }
    this.sync();
  }
  get active() {
    if (document.hidden) return false;
    if (this.app.canWalkHub) return this.app.canWalkHub();
    return this.app.mode === 'lobby' && this.app.meta.tab === 'home' && this.app.lobbyVisible !== false &&
      !this.app.stageStarting && !this.app.contextLost && !this.app.companionAgent?.getSnapshot().open &&
      !document.querySelector?.('dialog[open], #modal.show');
  }
  get views() { return this.app.renderer.lobbyNavigation ? WALKING_LOBBY_VIEWS : LOBBY_VIEWS; }
  get value() { return normalizeLobbyCamera(this.app.eco.s.settings.lobbyCamera); }
  restoreWalkingFocus(button) {
    if (this.active && this.app.renderer.lobbyNavigation && document.activeElement === button) this.app.canvas?.focus({ preventScroll: true });
  }
  set(value, save = true) {
    const previous = this.value, next = normalizeLobbyCamera(value);
    const changed = ['yaw', 'pitch', 'zoom'].some(key => previous[key] !== next[key]);
    this.app.eco.s.settings.lobbyCamera = next;
    this.sync();
    if (!save && changed) this.gestureChanged = true;
    if (save && changed) this.app.eco.save();
  }
  reset() { this.finish(); this.set(LOBBY_VIEWS.oath); }
  release(pointer) { if (pointer?.surface.hasPointerCapture?.(pointer.id)) pointer.surface.releasePointerCapture(pointer.id); }
  finish() {
    const first = this.drag, second = this.second, changed = this.gestureChanged;
    this.drag = this.second = this.pinch = null; this.gestureChanged = false;
    this.release(first); this.release(second);
    if (changed) this.app.eco.save();
  }
  updateActivity() {
    const active = !!this.active;
    if (this.enabled !== active) {
      this.enabled = active;
      if (!active) { this.finish(); this.panel.hidden = true; this.toggle.setAttribute('aria-expanded', 'false'); }
    }
    if (this.walking !== !!this.app.renderer.lobbyNavigation) { this.walking = !!this.app.renderer.lobbyNavigation; this.sync(); }
  }
  sync() {
    const v = this.value;
    this.app.renderer.lobbyCamera = v;
    for (const input of this.panel.querySelectorAll('input')) input.value = v[input.name];
    for (const button of this.panel.querySelectorAll('[data-lobby-view]')) {
      const preset = this.views[button.dataset.lobbyView];
      button.setAttribute('aria-pressed', String(['yaw', 'pitch', 'zoom'].every(k => v[k] === preset[k])));
    }
  }
}

/** Keep the hero left of centre in camera-local space even when the owner orbits. */
export function lobbyCompositionShift(position, landscape) {
 const length=Math.hypot(position?.x,position?.z);
 if(!landscape||!Number.isFinite(length)||length<=0)return {x:0,z:0};
 return {x:.9*position.z/length,z:-.9*position.x/length};
}
