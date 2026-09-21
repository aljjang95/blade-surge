import { cameraRelativeMove } from './camera-control.js';
// 가상 조이스틱 + 액션 버튼 + 키보드
const GAMEPAD_DEADZONE = 0.16;
const GAMEPAD_ACTIONS = ['attack', 'dodge', 'skill0', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5'];

function stick(value) {
  const n = Number.isFinite(value) ? value : 0;
  const sign = n < 0 ? -1 : 1;
  const magnitude = Math.abs(n);
  if (magnitude <= GAMEPAD_DEADZONE) return 0;
  return sign * Math.min(1, (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE));
}

export class Input {
  constructor() {
    this.move = { x: 0, y: 0 }; // -1..1 (x: 좌우, y: 앞뒤 — 화면 기준)
    this.screenMove = { x: 0, y: 0 };
    this.attackHeld = false; this.queue = [];
    this.attackSources = new Set(); this.clearListeners = new Set();
    this.enabled = false;
    this.keys = {};
    this.gamepadMove = { x: 0, y: 0 };
    this.gamepadButtons = new Uint8Array(GAMEPAD_ACTIONS.length);
    this.gamepadConnected = false;
    this.joy = { active: false, id: null, cx: 0, cy: 0, radius: 52 };
    this.el = { area: document.getElementById('joy'), base: document.querySelector('.joy-base'), knob: document.getElementById('joy-knob') };
    this._bind();
  }
  press(a) { if (this.enabled && !this.queue.includes(a)) this.queue.push(a); }
  consume(a) { const i = this.queue.indexOf(a); if (i >= 0) { this.queue.splice(i, 1); return true; } return false; }
  onClear(listener) { this.clearListeners.add(listener); return () => this.clearListeners.delete(listener); }
  _attack(source, held) { if (held) this.attackSources.add(source); else this.attackSources.delete(source); this.attackHeld = this.attackSources.size > 0; }
  clear() { this.queue.length = 0; this.attackSources.clear(); this.attackHeld = false; this.keys = {}; this.gamepadButtons.fill(0); this.gamepadConnected = false; this.gamepadMove.x = this.gamepadMove.y = 0; this.move.x = this.move.y = 0; this._resetJoy(); for (const listener of this.clearListeners) listener(); }
  _resetJoy() { this.joy.active = false; this.joy.id = null; this.move.x = this.move.y = this.screenMove.x = this.screenMove.y = 0; this.el.knob.style.transform = 'translate(-50%,-50%)'; this.el.base.style.left = ''; this.el.base.style.bottom = ''; this.el.base.style.top = ''; this.el.base.style.transform = ''; }
  _updateGamepad() {
    if (!this.enabled) return;
    const getGamepads = globalThis.navigator?.getGamepads;
    if (typeof getGamepads !== 'function') return;
    let pads;
    try { pads = getGamepads.call(globalThis.navigator); } catch { return; }
    let pad = null;
    for (let i = 0; i < (pads?.length || 0); i++) if (pads[i]?.connected !== false) { pad = pads[i]; break; }
    if (!pad) {
      this.gamepadConnected = false; this.gamepadMove.x = this.gamepadMove.y = 0;
      this._attack('gamepad', false); this.gamepadButtons.fill(0); return;
    }
    this.gamepadConnected = true;
    this.gamepadMove.x = stick(pad.axes?.[0]); this.gamepadMove.y = stick(pad.axes?.[1]);
    for (let i = 0; i < GAMEPAD_ACTIONS.length; i++) {
      const button = pad.buttons?.[i];
      const down = !!button && (button.pressed || button.value > 0.5);
      if (down && !this.gamepadButtons[i]) this.press(GAMEPAD_ACTIONS[i]);
      this.gamepadButtons[i] = down ? 1 : 0;
    }
    this._attack('gamepad', !!this.gamepadButtons[0]);
  }
  _bind() {
    const area = this.el.area;
    const start = (e) => {
      if (!this.enabled || (!e.changedTouches && e.button !== 0)) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      if (this.joy.active) return;
      this.joy.active = true; this.joy.id = e.changedTouches ? t.identifier : 'mouse';
      this.screenMove.x = this.screenMove.y = 0;
      this.joy.cx = t.clientX; this.joy.cy = t.clientY;
      const bounds = area.getBoundingClientRect();
      const b = this.el.base; b.style.left = (t.clientX - bounds.left) + 'px'; b.style.top = (t.clientY - bounds.top) + 'px'; b.style.bottom = 'auto'; b.style.transform = 'translate(-50%,-50%)';
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.joy.active || !this.enabled || (!e.changedTouches && this.joy.id !== 'mouse')) return;
      let t = null;
      if (e.changedTouches) { for (const c of e.changedTouches) if (c.identifier === this.joy.id) t = c; if (!t) return; } else t = e;
      let dx = t.clientX - this.joy.cx, dy = t.clientY - this.joy.cy;
      const d = Math.hypot(dx, dy), r = this.joy.radius;
      if (d > r) { dx = dx / d * r; dy = dy / d * r; }
      this.el.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const dead = 0.12; const nx = dx / r, ny = dy / r; const m = Math.hypot(nx, ny);
      if (m < dead) { this.move.x = this.move.y = 0; } else { const k = Math.min(1, (m - dead) / (1 - dead)) / m; this.move.x = nx * k; this.move.y = ny * k; }
      this.screenMove.x = this.move.x; this.screenMove.y = this.move.y;
      e.preventDefault();
    };
    const end = (e) => {
      if (!this.joy.active || (!e.changedTouches && this.joy.id !== 'mouse')) return;
      if (!e.changedTouches && e.button !== undefined && e.button !== 0) return;
      if (e.changedTouches) { let hit = false; for (const c of e.changedTouches) if (c.identifier === this.joy.id) hit = true; if (!hit) return; }
      this._resetJoy();
    };
    area.addEventListener('touchstart', start, { passive: false });
    area.addEventListener('touchmove', move, { passive: false });
    area.addEventListener('touchend', end); area.addEventListener('touchcancel', end);
    area.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);

    const btn = (id, down, up) => {
      const el = typeof id === 'string' ? document.getElementById(id) : id;
      if (!el) return;
      let owner = null;
      const d = (e) => {
        if (!this.enabled || owner !== null || (!e.changedTouches && e.button !== 0)) return;
        owner = e.changedTouches ? e.changedTouches[0].identifier : 'mouse';
        e.preventDefault(); e.stopPropagation(); down();
      };
      const u = (e) => {
        if (owner === null || (e.changedTouches ? !Array.from(e.changedTouches).some(t => t.identifier === owner) : owner !== 'mouse')) return;
        if (e.type === 'mouseup' && e.button !== undefined && e.button !== 0) return;
        owner = null; e.preventDefault(); up && up();
      };
      this.onClear(() => { owner = null; });
      el.addEventListener('touchstart', d, { passive: false }); el.addEventListener('touchend', u); el.addEventListener('touchcancel', u);
      el.addEventListener('mousedown', d); window.addEventListener('mouseup', u); el.addEventListener('mouseleave', u);
    };
    btn('btn-attack', () => { this._attack('button', true); this.press('attack'); }, () => { this._attack('button', false); });
    btn('btn-dodge', () => this.press('dodge'));
    document.querySelectorAll('.skill-btn').forEach((b) => btn(b, () => this.press('skill' + b.dataset.skill)));

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('button, input, textarea, select, [contenteditable], [role="dialog"], dialog, #battle-camera-controls')) return;
      if (!/^(Key[WASDJKRQE]|Arrow(Left|Right|Up|Down)|Space|ShiftLeft|Digit[1-6])$/.test(e.code)) return;
      e.preventDefault();
      if (e.repeat) return; this.keys[e.code] = true;
      if (e.code === 'KeyJ' || e.code === 'Space') { this._attack(e.code, true); this.press('attack'); }
      if (e.code === 'KeyK' || e.code === 'ShiftLeft') this.press('dodge');
      if (e.code === 'Digit1') this.press('skill0'); if (e.code === 'Digit2') this.press('skill1'); if (e.code === 'Digit3') this.press('skill2'); if (e.code === 'KeyR' || e.code === 'Digit4') this.press('skill3');
      if (e.code === 'KeyQ' || e.code === 'Digit5') this.press('skill4'); if (e.code === 'KeyE' || e.code === 'Digit6') this.press('skill5');
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyJ' || e.code === 'Space') this._attack(e.code, false); });
    document.addEventListener('focusin', e => {
      if (!e.target?.closest?.('button, input, textarea, select, [contenteditable], [role="dialog"], dialog, #battle-camera-controls')) return;
      this.keys = {}; this._attack('KeyJ', false); this._attack('Space', false);
    });
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('pagehide', () => this.clear());
    window.addEventListener('orientationchange', () => this.clear());
    window.addEventListener('resize', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }
  update() {
    this._updateGamepad();
    if (!this.enabled) { this.move.x = this.move.y = 0; return; }
    if (this.joy.active) {
      this.move.x = this.screenMove.x; this.move.y = this.screenMove.y;
    } else if (this.gamepadConnected) {
      this.move.x = this.gamepadMove.x; this.move.y = this.gamepadMove.y;
    } else {
      let x = 0, y = 0; const k = this.keys;
      if (k.KeyA || k.ArrowLeft) x -= 1; if (k.KeyD || k.ArrowRight) x += 1; if (k.KeyW || k.ArrowUp) y -= 1; if (k.KeyS || k.ArrowDown) y += 1;
      const m = Math.hypot(x, y); if (m > 0) { x /= m; y /= m; }
      this.move.x = x; this.move.y = y;
    }
    const world = cameraRelativeMove(this.move.x, this.move.y, this.getCameraYaw?.() ?? 0);
    this.move.x = world.x; this.move.y = world.y;
  }
}
