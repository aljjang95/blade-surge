import './camera-gestures.css';
import { WorldTouchGesture } from './world-gesture.js';

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
const LOBBY_ROTATE_YAW = .45, LOBBY_ROTATE_PITCH = .14;

/** 로비 빈 화면 터치 회전·핀치와 마우스 드래그. 전투 카메라와 전투 입력에 영향을 주지 않는다. */
export class LobbyCameraControls {
  constructor(app) {
    this.app = app;
    this.pad = document.getElementById('lobby-camera-pad');
    this.panel = document.getElementById('lobby-camera-panel');
    this.toggle = document.getElementById('lobby-camera-toggle');
    this.touch = new WorldTouchGesture();
    this.touchBase = this.value;
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
      // 성채 조이스틱·상호작용·메뉴는 자기 터치를 소유한다. 숨긴 시점 패드는 빈 화면과 같다.
      if (!this.active || event.defaultPrevented || (!onPad && (!world || event.target.closest?.(CAMERA_UI)))) return;
      if (event.pointerType === 'touch') {
        if (this.drag) return;
        const role = this.touch.down(event.pointerId, event.clientX, event.clientY, onPad ? this.pad : event.target);
        if (role === 'pending') this.gestureChanged = false;
        if (role !== 'pinch') return;
        if (!this.capture(this.touch.first) || !this.capture(this.touch.second)) { this.finish(); return; }
        this.touchBase = this.value;
        event.preventDefault();
        return;
      }
      if ((event.button !== 0 && event.button !== 2) || this.drag || this.touch.size) return;
      const surface = onPad ? this.pad : this.app.canvas;
      const pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, surface, ...this.value };
      try { surface.setPointerCapture?.(pointer.id); } catch { return; }
      this.drag = pointer; this.gestureChanged = false;
      event.preventDefault();
    });
    document.addEventListener('pointermove', event => {
      if (this.drag?.id === event.pointerId && event.pointerType !== 'touch') {
        if (!this.active) { this.finish(); return; }
        this.orbit(this.drag, event.clientX - this.drag.startX, event.clientY - this.drag.startY);
        event.preventDefault();
        return;
      }
      if (!this.touch.has(event.pointerId)) return;
      if (!this.active) { this.finish(); return; }
      const step = this.touch.move(event.pointerId, event.clientX, event.clientY);
      if (step === 'rotate-start') {
        if (!this.capture(this.touch.first)) { this.finish(); return; }
        this.touchBase = this.value;
      }
      if (step === 'rotate-start' || step === 'rotate') {
        this.orbit(this.touchBase, this.touch.dx, this.touch.dy);
        event.preventDefault();
      } else if (step === 'pinch') {
        this.set({ ...this.value, zoom: this.touchBase.zoom * this.touch.ratio }, false);
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
        if (step === 'resume') this.touchBase = this.value; else this.finish();
        if (engaged && event.cancelable) event.preventDefault();
        return;
      }
      if (this.drag?.id === event.pointerId) this.finish();
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
    // 시점 조작은 마을 걷기 모드 전용이 아니다. 기본 선택 로비도 같은 모달·동행·전환 경계에서 받는다.
    if (this.app.canOrbitLobby) return this.app.canOrbitLobby();
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
  orbit(base, dx, dy) {
    const yaw = base.yaw - dx * LOBBY_ROTATE_YAW;
    this.set({ ...this.value, yaw: ((yaw + 540) % 360) - 180, pitch: base.pitch + dy * LOBBY_ROTATE_PITCH }, false);
  }
  capture(pointer) {
    try { pointer?.surface?.setPointerCapture?.(pointer.id); return !!pointer; } catch { return false; }
  }
  release(pointer) { if (pointer?.surface?.hasPointerCapture?.(pointer.id)) pointer.surface.releasePointerCapture(pointer.id); }
  finish() {
    const drag = this.drag, first = this.touch?.first, second = this.touch?.second, changed = this.gestureChanged;
    this.drag = null; this.touch?.clear(); this.gestureChanged = false;
    this.release(drag); this.release(first); this.release(second);
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

/**
 * 매 프레임 로비 입력 소유 정리. 걷기가 막히면 이동 입력만 놓고, 시점 조작까지 막혔을 때만 시점 제스처를 끝낸다.
 * 기본 선택 로비(걷기 꺼짐·시점 허용)에서 대기 중인 손가락을 매 프레임 지우던 결함을 막는다.
 */
export function releaseBlockedLobbyInput(app) {
  if (!app.canWalkHub()) app.hubControls?.clear();
  const orbit = app.canOrbitLobby ? app.canOrbitLobby() : app.canWalkHub();
  if (!orbit) app.lobbyCameraControls?.finish();
}

/** Keep the hero left of centre in camera-local space even when the owner orbits. */
export function lobbyCompositionShift(position, landscape) {
 const length=Math.hypot(position?.x,position?.z);
 if(!landscape||!Number.isFinite(length)||length<=0)return {x:0,z:0};
 return {x:.9*position.z/length,z:-.9*position.x/length};
}
