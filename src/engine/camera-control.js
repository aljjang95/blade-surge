const clamp = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function normalizeBattleCamera(value = {}) {
  return { yaw: Number.isFinite(value.yaw) ? ((value.yaw + 180) % 360 + 360) % 360 - 180 : 0,
    pitch: clamp(value.pitch, 0, -18, 20), zoom: clamp(value.zoom, 100, 70, 140) };
}
export function battleCameraOffset(offset, value) {
  const v = normalizeBattleCamera(value), yaw = v.yaw * Math.PI / 180;
  const distance = Math.hypot(offset.x, offset.y, offset.z) * 100 / v.zoom;
  const elevation = Math.max(.35, Math.min(1.3, Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) + v.pitch * Math.PI / 180));
  const bearing = Math.atan2(offset.x, offset.z) + yaw, radius = distance * Math.cos(elevation);
  return { x: radius * Math.sin(bearing), y: distance * Math.sin(elevation), z: radius * Math.cos(bearing) };
}
export function cameraRelativeMove(x, y, yaw = 0) {
  const angle = Number.isFinite(yaw) ? yaw : 0, c = Math.cos(angle), s = Math.sin(angle);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/** Empty-world right drag and a dedicated touch pad never claim movement/action touches. */
export class CameraControls {
  constructor(app) {
    this.app = app;
    this.pad = document.getElementById('battle-camera-pad');
    this.value = normalizeBattleCamera();
    app.renderer.battleCamera = this.value;
    app.input.getCameraYaw = () => {
      const e = app.renderer.camera.matrixWorld.elements;
      return Math.atan2(-e[2], e[0]);
    };
    const ui = '#joy, #actions, button, input, select, textarea, a, [role="dialog"], #battle-camera-controls';
    document.addEventListener('pointerdown', event => {
      const onPad = !!this.pad && this.pad.contains(event.target);
      if (!this.active || this.drag || (!onPad && (event.pointerType === 'touch' || event.button !== 2 || event.target.closest?.(ui)))) return;
      if (onPad && event.button !== 0 && event.button !== 2) return;
      const surface = onPad ? this.pad : event.target;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...this.value, surface };
      surface.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    document.addEventListener('pointermove', event => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      if (!this.active) { this.finish(); return; }
      this.set({ ...this.value, yaw: this.drag.yaw - (event.clientX - this.drag.x) * .35,
        pitch: this.drag.pitch + (event.clientY - this.drag.y) * .15 });
      event.preventDefault();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, event => {
      if (this.drag?.id === event.pointerId) this.finish();
    });
    window.addEventListener('blur', () => this.finish());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finish(); });
    document.addEventListener('contextmenu', event => {
      if (this.active && (!event.target.closest?.(ui) || this.pad?.contains(event.target))) event.preventDefault();
    });
    document.addEventListener('wheel', event => {
      if (!this.active || (event.target.closest?.(ui) && !this.pad?.contains(event.target))) return;
      event.preventDefault(); this.set({ ...this.value, zoom: this.value.zoom - Math.sign(event.deltaY) * 5 });
    }, { passive: false });
    for (const [id, action] of Object.entries({ 'battle-camera-reset': () => this.reset(),
      'battle-camera-zoom-in': () => this.set({ ...this.value, zoom: this.value.zoom + 10 }),
      'battle-camera-zoom-out': () => this.set({ ...this.value, zoom: this.value.zoom - 10 }) })) {
      document.getElementById(id)?.addEventListener('click', () => { if (this.active) action(); });
    }
    this.pad?.addEventListener('keydown', event => {
      if (!this.active) return;
      const v = { ...this.value };
      if (event.key === 'ArrowLeft') v.yaw -= 8;
      else if (event.key === 'ArrowRight') v.yaw += 8;
      else if (event.key === 'ArrowUp') v.pitch += 3;
      else if (event.key === 'ArrowDown') v.pitch -= 3;
      else if (event.key === '+' || event.key === '=') v.zoom += 5;
      else if (event.key === '-') v.zoom -= 5;
      else if (event.key === 'Home') { event.preventDefault(); this.reset(); return; }
      else return;
      event.preventDefault(); this.set(v);
    });
  }
  get active() { return this.app.mode === 'battle' && !!this.app.battle?.active && !this.app.battle.paused && !document.getElementById('modal')?.classList.contains('show'); }
  set(value) { this.value = normalizeBattleCamera(value); this.app.renderer.battleCamera = this.value; }
  reset() { this.finish(); this.set({}); }
  finish() {
    const drag = this.drag; this.drag = null;
    if (drag?.surface.hasPointerCapture?.(drag.id)) drag.surface.releasePointerCapture(drag.id);
  }
}
