import './camera-gestures.css';
import { WorldTouchGesture } from './world-gesture.js';
const clamp = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function pinchZoom(startZoom, startDistance, distance, min = 70, max = 140) {
  if (!Number.isFinite(startZoom) || !Number.isFinite(startDistance) || startDistance <= 0 || !Number.isFinite(distance)) return startZoom;
  return Math.max(min, Math.min(max, startZoom * distance / startDistance));
}
export function pointerDistance(first, second) {
  return Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
}
export function normalizeBattleCamera(value = {}) {
  value = value || {};
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

const BATTLE_ROTATE_YAW = .35, BATTLE_ROTATE_PITCH = .15;
// 조이스틱·스킬·공격 버튼·모달·접이식 메뉴·창은 각자 터치를 소유한다.
const BATTLE_UI = '#joy, .actions, #actions, button, input, select, textarea, a, [contenteditable], [role="dialog"], dialog, details, summary, .mpl-win, .mpl-quickbar, #battle-camera-controls';

/** 빈 world 한 손가락 회전·두 손가락 핀치와 마우스 오른쪽 드래그. 이동/행동 터치는 가져가지 않는다. */
export class CameraControls {
  constructor(app) {
    this.app = app;
    this.pad = document.getElementById('battle-camera-pad');
    this.value = normalizeBattleCamera();
    this.touch = new WorldTouchGesture();
    this.touchBase = this.value;
    app.renderer.battleCamera = this.value;
    // Battle pause, death, modal and stage transitions already clear gameplay input.
    // End capture at that same boundary, even if no pointer event arrives while paused.
    app.input.onClear?.(() => this.finish());
    app.input.getCameraYaw = () => {
      const e = app.renderer.camera.matrixWorld.elements;
      return Math.atan2(-e[2], e[0]);
    };
    const ui = BATTLE_UI;
    document.addEventListener('pointerdown', event => {
      const onPad = !!this.pad && this.pad.contains(event.target);
      if (event.pointerType === 'touch') {
        // 숨긴 시점 패드는 빈 화면과 같은 제스처로 취급한다. 조이스틱 손가락과 동시에 쓸 수 있다.
        if (!this.active || event.defaultPrevented || (!onPad && event.target?.closest?.(ui))) return;
        const role = this.touch.down(event.pointerId, event.clientX, event.clientY, onPad ? this.pad : event.target);
        if (role !== 'pinch') return;
        if (!this.capture(this.touch.first) || !this.capture(this.touch.second)) { this.finish(); return; }
        this.touchBase = this.currentValue();
        event.preventDefault();
        return;
      }
      if (!this.active || this.drag || (!onPad && (event.button !== 2 || event.target.closest?.(ui)))) return;
      if (onPad && event.button !== 0 && event.button !== 2) return;
      const surface = onPad ? this.pad : event.target;
      const value = this.currentValue();
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...value, surface };
      try { surface.setPointerCapture?.(event.pointerId); } catch { this.drag = null; return; }
      this.value = value;
      event.preventDefault();
    });
    document.addEventListener('pointermove', event => {
      if (this.drag?.id === event.pointerId && event.pointerType !== 'touch') {
        if (!this.active) { this.finish(); return; }
        this.set({ ...this.value, yaw: this.drag.yaw - (event.clientX - this.drag.x) * BATTLE_ROTATE_YAW,
          pitch: this.drag.pitch + (event.clientY - this.drag.y) * BATTLE_ROTATE_PITCH });
        event.preventDefault();
        return;
      }
      if (!this.touch.has(event.pointerId)) return;
      if (!this.active) { this.finish(); return; }
      const step = this.touch.move(event.pointerId, event.clientX, event.clientY);
      if (step === 'rotate-start') {
        if (!this.capture(this.touch.first)) { this.finish(); return; }
        this.touchBase = this.currentValue();
      }
      if (step === 'rotate-start' || step === 'rotate') {
        const base = this.touchBase;
        this.set({ yaw: base.yaw - this.touch.dx * BATTLE_ROTATE_YAW, pitch: base.pitch + this.touch.dy * BATTLE_ROTATE_PITCH,
          zoom: this.currentValue().zoom });
        event.preventDefault();
      } else if (step === 'pinch') {
        this.set({ ...this.currentValue(), zoom: pinchZoom(this.touchBase.zoom, 1, this.touch.ratio) });
        event.preventDefault();
      }
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, event => {
      const pointer = this.touch.get(event.pointerId);
      if (pointer) {
        // 다른 요소가 잃은 캡처 알림은 이 제스처의 종료가 아니다.
        if (name === 'lostpointercapture' && event.target && event.target !== pointer.surface) return;
        if (name !== 'pointerup') { this.finish(); return; }
        const engaged = this.touch.mode === 'rotate' || this.touch.mode === 'pinch';
        const step = this.touch.up(event.pointerId);
        this.release(pointer);
        // 핀치 뒤 남은 손가락은 지금 시점과 위치를 새 기준으로 삼아 튀지 않는다.
        if (step === 'resume') this.touchBase = this.currentValue();
        if (engaged && event.cancelable) event.preventDefault();
        return;
      }
      if (this.drag?.id === event.pointerId) this.finish();
    });
    window.addEventListener('blur', () => this.finish());
    for (const name of ['pagehide', 'resize', 'orientationchange']) window.addEventListener(name, () => this.finish());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finish(); });
    document.addEventListener('contextmenu', event => {
      if (this.active && (!event.target.closest?.(ui) || this.pad?.contains(event.target))) event.preventDefault();
    });
    document.addEventListener('wheel', event => {
      if (!this.active || event.ctrlKey || event.metaKey || !Number.isFinite(event.deltaY) || event.deltaY === 0 || (event.target.closest?.(ui) && !this.pad?.contains(event.target))) return;
      const value = this.currentValue();
      event.preventDefault(); this.set({ ...value, zoom: value.zoom - Math.sign(event.deltaY) * 5 });
    }, { passive: false });
    const zoomBy = delta => { const value = this.currentValue(); this.set({ ...value, zoom: value.zoom + delta }); };
    for (const [id, action] of Object.entries({ 'battle-camera-reset': () => this.reset(),
      'battle-camera-zoom-in': () => zoomBy(10),
      'battle-camera-zoom-out': () => zoomBy(-10) })) {
      document.getElementById(id)?.addEventListener('click', () => { if (this.active) action(); });
    }
    this.pad?.addEventListener('keydown', event => {
      if (!this.active || event.ctrlKey || event.metaKey || event.altKey) return;
      const v = this.currentValue();
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
  }
  get active() {
    const battle = this.app.battle;
    return this.app.mode === 'battle' && !!battle?.active && !battle.paused && battle.player?.alive !== false
      && !document.getElementById('modal')?.classList.contains('show');
  }
  // 지역 시점이 바뀐 뒤에도 새 조작은 현재 화면의 값을 기준으로 시작한다.
  currentValue() { return normalizeBattleCamera(this.app.renderer.battleCamera || this.value); }
  set(value) { this.value = normalizeBattleCamera(value); this.app.renderer.battleCamera = this.value; }
  reset() { this.finish(); this.set({}); }
  capture(pointer) {
    try { pointer?.surface?.setPointerCapture?.(pointer.id); return !!pointer; } catch { return false; }
  }
  release(pointer) {
    if (pointer?.surface?.hasPointerCapture?.(pointer.id)) pointer.surface.releasePointerCapture(pointer.id);
  }
  finish() {
    const drag = this.drag, first = this.touch.first, second = this.touch.second;
    this.drag = null; this.touch.clear();
    this.release(drag); this.release(first); this.release(second);
  }
}
