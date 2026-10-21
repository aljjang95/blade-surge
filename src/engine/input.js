import { cameraRelativeMove } from './camera-control.js';
// 가상 조이스틱 + 액션 버튼 + 키보드
const GAMEPAD_DEADZONE = 0.16;
// 물리적으로 눌린 이동 키만 추적한다. 정지·창 때문에 keys 가 비워져도 키를 다시 누르지 않고 이동을 이어 가기 위함이다.
const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const GAMEPAD_ACTIONS = ['attack', 'dodge', 'skill0', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5'];

export function skillAimThreshold(radius = 56) { return Math.min(14, radius * 0.25); }

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
    this.skillAim = null; this.aimedCasts = new Map(); this.skillGestures = new Map();
    this.attackSources = new Set(); this.clearListeners = new Set();
    this.enabled = false;
    this.keys = {};
    this.held = new Uint8Array(MOVE_CODES.length); // MOVE_CODES 순서, 실제로 눌려 있는 이동 키
    this._restoreKeys = false; this._wasEnabled = false;
    this.gamepadMove = { x: 0, y: 0 };
    this.gamepadButtons = new Uint8Array(GAMEPAD_ACTIONS.length);
    this.gamepadConnected = false;
    this.joy = { active: false, id: null, cx: 0, cy: 0, radius: 52 };
    this.el = { area: document.getElementById('joy'), base: document.querySelector('.joy-base'), knob: document.getElementById('joy-knob') };
    this._bind();
  }
  press(a) { if (this.enabled && !this.queue.includes(a)) this.queue.push(a); }
  consume(a) { const i = this.queue.indexOf(a); if (i >= 0) { this.queue.splice(i, 1); return true; } return false; }
  takeAim(slot) { const aim = this.aimedCasts.get(slot); this.aimedCasts.delete(slot); return aim; }
  onClear(listener) { this.clearListeners.add(listener); return () => this.clearListeners.delete(listener); }
  _attack(source, held) { if (held) this.attackSources.add(source); else this.attackSources.delete(source); this.attackHeld = this.attackSources.size > 0; }
  clear() { this.queue.length = 0; this.aimedCasts?.clear(); this._clearSkillAim(); this.attackSources.clear(); this.attackHeld = false; this.keys = {}; this._restoreKeys = true; this.gamepadButtons.fill(0); this.gamepadConnected = false; this.gamepadMove.x = this.gamepadMove.y = 0; this.move.x = this.move.y = 0; this._resetJoy(); for (const listener of this.clearListeners) listener(); }
  _clearSkillAim() {
    if (this.skillGestures) for (const g of this.skillGestures.values()) this._resetSkillKnob(g);
    this.skillGestures?.clear(); this.skillAim = null; this._showSkillCancel();
  }
  _resetSkillKnob(g) {
    g.button.style.removeProperty('--aim-x'); g.button.style.removeProperty('--aim-y');
    g.button.classList?.remove('aiming');
  }
  _showSkillCancel() {
    const el = globalThis.document?.getElementById?.('skill-aim-cancel');
    el?.classList?.toggle('on', !!this.skillAim?.active);
    el?.classList?.toggle('hot', !!this.skillAim?.cancel);
  }
  _aimWorld(aim) {
    // 바닥 평면 투영이 가능하면 화면에서 끈 방향과 지면 레인이 정확히 겹치게 한다.
    if (this.screenAimDir?.(aim.sx, aim.sy, aim)) return;
    const yaw = this.getCameraYaw?.() ?? 0, angle = Number.isFinite(yaw) ? yaw : 0;
    const length = Math.hypot(aim.sx, aim.sy), c = Math.cos(angle), s = Math.sin(angle);
    if (length < 1e-6) return;
    // cameraRelativeMove와 같은 회전식이며 표시 프레임에는 객체를 만들지 않는다.
    aim.x = (aim.sx * c + aim.sy * s) / length;
    aim.z = (-aim.sx * s + aim.sy * c) / length;
  }
  _moveSkill(g, t) {
    const dx = t.clientX - g.cx, dy = t.clientY - g.cy, distance = Math.hypot(dx, dy);
    g.aim.active ||= distance >= skillAimThreshold(g.radius);
    const scale = 1 / Math.max(g.radius, distance);
    g.aim.sx = dx * scale; g.aim.sy = dy * scale;
    g.aim.dist01 = Math.min(1, distance / g.radius);
    this._aimWorld(g.aim);
    const cancel = document.getElementById('skill-aim-cancel');
    const rect = cancel?.getBoundingClientRect();
    g.aim.cancel = !!rect && g.aim.active && t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom;
    this.skillAim = g.aim;
    const knobX = t.clientX - g.bx, knobY = t.clientY - g.by;
    const knobScale = Math.min(1, g.radius / (Math.hypot(knobX, knobY) || 1));
    g.button.style.setProperty('--aim-x', `${knobX * knobScale}px`);
    g.button.style.setProperty('--aim-y', `${knobY * knobScale}px`);
    g.button.classList?.toggle('aiming', g.aim.active);
    this._showSkillCancel();
  }
  _bindSkill(button) {
    const slot = Number(button.dataset.skill);
    if (!Number.isInteger(slot) || slot < 0 || slot > 5) return;
    const start = e => {
      if (!this.enabled || this.skillGestures.has(slot) || (!e.changedTouches && e.button !== 0)) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      if (!t) return;
      const rect = button.getBoundingClientRect();
      const g = { button, owner: e.changedTouches ? t.identifier : 'mouse', cx: t.clientX, cy: t.clientY,
        bx: rect.left + rect.width / 2, by: rect.top + rect.height / 2,
        radius: Math.max(14, Math.min(rect.width, rect.height) / 2),
        aim: { slot, active: false, sx: 0, sy: 0, x: 0, z: 0, dist01: 0, cancel: false } };
      this.skillGestures.set(slot, g);
      e.preventDefault(); e.stopPropagation();
    };
    const contact = (e, g) => {
      if (!e.changedTouches) return g.owner === 'mouse' ? e : null;
      for (const t of e.changedTouches) if (t.identifier === g.owner) return t;
      return null;
    };
    const move = e => {
      const g = this.skillGestures.get(slot); if (!g || !this.enabled) return;
      const t = contact(e, g); if (!t) return;
      this._moveSkill(g, t); if (e.cancelable) e.preventDefault();
    };
    const end = e => {
      const g = this.skillGestures.get(slot); if (!g || (e.type === 'mouseup' && e.button !== 0)) return;
      const t = contact(e, g); if (!t) return;
      this._moveSkill(g, t);
      const action = 'skill' + slot;
      if (this.enabled && e.type !== 'touchcancel' && !g.aim.cancel && !this.queue.includes(action)) {
        if (g.aim.active) this.aimedCasts.set(slot, { slot, x: g.aim.x, z: g.aim.z, dist01: g.aim.dist01 });
        else this.aimedCasts.delete(slot);
        this.press(action);
      }
      this._resetSkillKnob(g); this.skillGestures.delete(slot);
      this.skillAim = null;
      for (const other of this.skillGestures.values()) if (other.aim.active) this.skillAim = other.aim;
      this._showSkillCancel(); if (e.cancelable) e.preventDefault();
    };
    button.addEventListener('touchstart', start, { passive: false });
    button.addEventListener('mousedown', start);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end, { passive: false });
    window.addEventListener('touchcancel', end, { passive: false });
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  }
  _resetJoy() { this.joy.active = false; this.joy.id = null; this.move.x = this.move.y = this.screenMove.x = this.screenMove.y = 0; this.el.knob.style.transform = 'translate(-50%,-50%)'; this.el.base.style.left = ''; this.el.base.style.bottom = ''; this.el.base.style.top = ''; this.el.base.style.transform = ''; }
  _updateGamepad() {
    if (!this.enabled) return;
    const getGamepads = globalThis.navigator?.getGamepads;
    if (typeof getGamepads !== 'function') return;
    let pads;
    try { pads = getGamepads.call(globalThis.navigator); } catch { return; }
    let pad = null;
    // 연결 해제된 슬롯은 null로 남을 수 있으므로 실제 패드를 찾을 때까지 건너뛴다.
    for (let i = 0; i < (pads?.length || 0); i++) if (pads[i] && pads[i].connected !== false) { pad = pads[i]; break; }
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
        // 브라우저가 취소한 터치는 기본 동작을 취소할 수 없어도 소유권을 해제한다.
        owner = null; if (e.cancelable) e.preventDefault(); up && up();
      };
      this.onClear(() => { owner = null; });
      // 안드로이드 길게 누르기(컨텍스트 메뉴)가 열리면 브라우저가 터치를 취소해 공격 홀드가 끊긴다. 버튼 위에서는 메뉴를 열지 않는다.
      el.addEventListener('contextmenu', (e) => { if (e.cancelable) e.preventDefault(); });
      el.addEventListener('touchstart', d, { passive: false }); el.addEventListener('touchend', u); el.addEventListener('touchcancel', u);
      el.addEventListener('mousedown', d); window.addEventListener('mouseup', u); el.addEventListener('mouseleave', u);
    };
    btn('btn-attack', () => { this._attack('button', true); this.press('attack'); }, () => { this._attack('button', false); });
    btn('btn-dodge', () => this.press('dodge'));
    btn('btn-map-interact', () => this.press('interact'));
    document.querySelectorAll('.skill-btn').forEach(b => this._bindSkill(b));

    // 이동 키 held 추적: 입력이 켜져 있을 때 새로 눌린 키만 넣는다. 꺼진 동안 눌렀거나 로비에서 누른 채 전투에 들어온 키는
    // 자동 반복(repeat)만 들어오므로 넣지 않는다(다시 눌러야 이동). button·dialog 대상도 넣고, 글자 입력 요소와 수식 키 조합은 넣지 않는다.
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
      const i = MOVE_CODES.indexOf(e.code); if (i >= 0) this.held[i] = 1;
    });
    // keyup 은 대상·활성 여부와 상관없이 held 에서 뺀다. 마을·상점 대화상자가 keyup 전파를 막아도 받도록 캡처 단계에서 듣는다.
    // macOS 는 Cmd 를 누른 동안 다른 키의 keyup 을 보내지 않으므로 Meta keyup 에서 held 를 비운다(BUNDLE-10 리뷰 P3-1).
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') { this.held.fill(0); return; }
      const i = MOVE_CODES.indexOf(e.code); if (i >= 0) this.held[i] = 0;
    }, true);
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('button, input, textarea, select, [contenteditable], [role="dialog"], dialog, #battle-camera-controls')) return;
      if (!/^(Key[WASDJKRQEF]|Arrow(Left|Right|Up|Down)|Space|Shift(Left|Right)|Digit[1-6])$/.test(e.code)) return;
      e.preventDefault();
      if (e.repeat) return; this.keys[e.code] = true;
      if (e.code === 'KeyJ' || e.code === 'Space') { this._attack(e.code, true); this.press('attack'); }
      if (e.code === 'KeyK' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.press('dodge');
      if (e.code === 'KeyF') this.press('interact');
      if (e.code === 'Digit1') this.press('skill0'); if (e.code === 'Digit2') this.press('skill1'); if (e.code === 'Digit3') this.press('skill2'); if (e.code === 'KeyR' || e.code === 'Digit4') this.press('skill3');
      if (e.code === 'KeyQ' || e.code === 'Digit5') this.press('skill4'); if (e.code === 'KeyE' || e.code === 'Digit6') this.press('skill5');
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyJ' || e.code === 'Space') this._attack(e.code, false); });
    document.addEventListener('focusin', e => {
      if (!e.target?.closest?.('button, input, textarea, select, [contenteditable], [role="dialog"], dialog, #battle-camera-controls')) return;
      this.keys = {}; this._attack('KeyJ', false); this._attack('Space', false);
    });
    // keyup 을 놓칠 수 있는 경우(포커스 이탈·페이지 숨김)에만 held 를 비운다.
    window.addEventListener('blur', () => { this.held.fill(0); this.clear(); });
    window.addEventListener('pagehide', () => { this.held.fill(0); this.clear(); });
    window.addEventListener('orientationchange', () => this.clear());
    window.addEventListener('resize', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.held.fill(0); this.clear(); } });
  }
  update() {
    this._updateGamepad();
    if (this.skillAim?.active) this._aimWorld(this.skillAim);
    if (!this.enabled) { this.move.x = this.move.y = 0; this._wasEnabled = false; return; }
    // 입력이 다시 켜졌거나 clear() 뒤 첫 갱신이면, 계속 눌려 있던 이동 키를 keys 에 되살린다(공격·회피·스킬은 제외).
    if ((!this._wasEnabled || this._restoreKeys) && this.held) {
      for (let i = 0; i < MOVE_CODES.length; i++) if (this.held[i]) this.keys[MOVE_CODES[i]] = true;
    }
    this._wasEnabled = true; this._restoreKeys = false;
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
