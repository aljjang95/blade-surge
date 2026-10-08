const MOVE_KEYS = /^(Key[WASD]|Arrow(Left|Right|Up|Down))$/;
const INTERACT_KEYS = /^(KeyE|Space)$/;
const FOCUS_UI = 'button, input, textarea, select, a, [contenteditable], [role="dialog"], dialog, #lobby-camera-panel, #lobby-camera-pad';

/** @typedef {EventTarget & {getBoundingClientRect: () => {left: number, top: number, width: number, height: number}, setPointerCapture?: (id: number) => void, hasPointerCapture?: (id: number) => boolean, releasePointerCapture?: (id: number) => void}} HubJoystick */

/** Independent lobby channel: these keys and pointers never enter the combat queue. */
export class HubControls {
  /** @param {{isActive: () => boolean, joystick?: HubJoystick | null, knob?: {style: {transform: string}} | null, host?: EventTarget, document?: EventTarget & {hidden?: boolean}}} options */
  constructor({ isActive, joystick = null, knob = null, host = globalThis.window, document = globalThis.document }) {
    this.isActive = isActive; this.joystick = joystick; this.knob = knob;
    this.host = host; this.document = document;
    this.keys = {}; this.move = { x: 0, y: 0 }; this.stickMove = { x: 0, y: 0 };
    this.pointer = null; this.interactQueued = false; this.listeners = [];
    this._bind();
  }

  get active() { return !!this.isActive() && !this.document?.hidden; }

  _listen(target, type, listener, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, options);
    this.listeners.push(() => target.removeEventListener(type, listener, options));
  }

  _bind() {
    this._listen(this.host, 'keydown', event => {
      if (!this.active) { this.clear(); return; }
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const focusedUI = event.target?.closest?.(FOCUS_UI);
      if (focusedUI) {
        // Native dialogs return focus here. Walking and E must resume without taking focus away.
        const nearbyButton = event.target.closest('.citadel-hub-interact');
        if (focusedUI !== nearbyButton || event.code === 'Space' || event.target.closest('dialog, [role="dialog"]')) return;
      }
      if (!MOVE_KEYS.test(event.code) && !INTERACT_KEYS.test(event.code)) return;
      event.preventDefault();
      if (event.repeat) return;
      this.keys[event.code] = true;
      if (INTERACT_KEYS.test(event.code)) this.interactQueued = true;
    });
    this._listen(this.host, 'keyup', event => { delete this.keys[event.code]; });
    this._listen(this.document, 'focusin', event => { if (event.target?.closest?.(FOCUS_UI)) this.clear(); });
    for (const type of ['blur', 'pagehide', 'resize', 'orientationchange']) this._listen(this.host, type, () => this.clear());
    this._listen(this.document, 'visibilitychange', () => { if (this.document.hidden) this.clear(); });

    this._listen(this.joystick, 'pointerdown', event => {
      if (!this.active || this.pointer || event.button !== 0) return;
      const rect = this.joystick.getBoundingClientRect();
      this.pointer = { id: event.pointerId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        radius: Math.max(1, Math.min(rect.width, rect.height) * .34) };
      try { this.joystick.setPointerCapture?.(event.pointerId); } catch { this.clear(); return; }
      this._movePointer(event); event.preventDefault();
    });
    this._listen(this.joystick, 'pointermove', event => {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      if (!this.active) { this.clear(); return; }
      this._movePointer(event); event.preventDefault();
    });
    // 조이스틱의 짧은 터치를 브라우저 탭 제스처로 보내지 않는다.
    // 다음 UI 버튼의 네이티브 click은 그대로 유지한다.
    this._listen(this.joystick, 'touchstart', event => {
      if (this.active && this.pointer !== null && event.cancelable) event.preventDefault();
    }, { passive: false });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this._listen(this.joystick, type, event => {
      if (this.pointer?.id === event.pointerId) this._releasePointer();
    });
  }

  _movePointer(event) {
    const pointer = this.pointer;
    let x = event.clientX - pointer.x, y = event.clientY - pointer.y;
    const distance = Math.hypot(x, y);
    if (distance > pointer.radius) { x *= pointer.radius / distance; y *= pointer.radius / distance; }
    if (this.knob) this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    const nx = x / pointer.radius, ny = y / pointer.radius, magnitude = Math.hypot(nx, ny), dead = .14;
    const scale = magnitude > dead ? Math.min(1, (magnitude - dead) / (1 - dead)) / magnitude : 0;
    this.stickMove.x = nx * scale; this.stickMove.y = ny * scale;
  }

  _releasePointer() {
    const pointer = this.pointer; this.pointer = null;
    this.stickMove.x = this.stickMove.y = 0;
    if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
    if (pointer && this.joystick.hasPointerCapture?.(pointer.id)) this.joystick.releasePointerCapture(pointer.id);
  }

  update() {
    if (!this.active) { this.clear(); return this.move; }
    if (this.pointer) { this.move.x = this.stickMove.x; this.move.y = this.stickMove.y; return this.move; }
    const keys = this.keys;
    let x = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let y = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    this.move.x = x; this.move.y = y;
    return this.move;
  }

  consumeInteract() {
    if (!this.active) { this.clear(); return false; }
    const queued = this.interactQueued; this.interactQueued = false; return queued;
  }

  clear() {
    this.keys = {}; this.move.x = this.move.y = 0; this.interactQueued = false; this._releasePointer();
  }

  destroy() { this.clear(); for (const remove of this.listeners) remove(); this.listeners.length = 0; }
}
