// 가상 조이스틱 + 액션 버튼 + 키보드
export class Input {
  constructor() {
    this.move = { x: 0, y: 0 }; // -1..1 (x: 좌우, y: 앞뒤 — 화면 기준)
    this.attackHeld = false; this.queue = [];
    this.enabled = false;
    this.keys = {};
    this.joy = { active: false, id: null, cx: 0, cy: 0, radius: 52 };
    this.el = { area: document.getElementById('joy'), base: document.querySelector('.joy-base'), knob: document.getElementById('joy-knob') };
    this._bind();
  }
  press(a) { if (this.enabled) this.queue.push(a); }
  consume(a) { const i = this.queue.indexOf(a); if (i >= 0) { this.queue.splice(i, 1); return true; } return false; }
  clear() { this.queue.length = 0; this.attackHeld = false; this.move.x = this.move.y = 0; this._resetJoy(); }
  _resetJoy() { this.joy.active = false; this.joy.id = null; this.move.x = this.move.y = 0; this.el.knob.style.transform = 'translate(-50%,-50%)'; this.el.base.style.left = ''; this.el.base.style.bottom = ''; this.el.base.style.top = ''; this.el.base.style.transform = ''; }
  _bind() {
    const area = this.el.area;
    const start = (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      if (this.joy.active) return;
      this.joy.active = true; this.joy.id = e.changedTouches ? t.identifier : 'mouse';
      this.joy.cx = t.clientX; this.joy.cy = t.clientY;
      const b = this.el.base; b.style.left = t.clientX + 'px'; b.style.top = t.clientY + 'px'; b.style.bottom = 'auto'; b.style.transform = 'translate(-50%,-50%)';
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.joy.active) return;
      let t = null;
      if (e.changedTouches) { for (const c of e.changedTouches) if (c.identifier === this.joy.id) t = c; if (!t) return; } else t = e;
      let dx = t.clientX - this.joy.cx, dy = t.clientY - this.joy.cy;
      const d = Math.hypot(dx, dy), r = this.joy.radius;
      if (d > r) { dx = dx / d * r; dy = dy / d * r; }
      this.el.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const dead = 0.12; const nx = dx / r, ny = dy / r; const m = Math.hypot(nx, ny);
      if (m < dead) { this.move.x = this.move.y = 0; } else { const k = Math.min(1, (m - dead) / (1 - dead)) / m; this.move.x = nx * k; this.move.y = ny * k; }
      e.preventDefault();
    };
    const end = (e) => {
      if (!this.joy.active) return;
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
      const d = (e) => { e.preventDefault(); e.stopPropagation(); down(); }; const u = (e) => { e.preventDefault(); up && up(); };
      el.addEventListener('touchstart', d, { passive: false }); el.addEventListener('touchend', u); el.addEventListener('touchcancel', u);
      el.addEventListener('mousedown', d); el.addEventListener('mouseup', u); el.addEventListener('mouseleave', () => up && up());
    };
    btn('btn-attack', () => { this.attackHeld = true; this.press('attack'); }, () => { this.attackHeld = false; });
    btn('btn-dodge', () => this.press('dodge'));
    document.querySelectorAll('.skill-btn').forEach((b) => btn(b, () => this.press('skill' + b.dataset.skill)));

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return; this.keys[e.code] = true;
      if (!this.enabled) return;
      if (e.code === 'KeyJ' || e.code === 'Space') { this.attackHeld = true; this.press('attack'); }
      if (e.code === 'KeyK' || e.code === 'ShiftLeft') this.press('dodge');
      if (e.code === 'Digit1') this.press('skill0'); if (e.code === 'Digit2') this.press('skill1'); if (e.code === 'Digit3') this.press('skill2'); if (e.code === 'KeyR' || e.code === 'Digit4') this.press('skill3');
      if (e.code === 'KeyQ' || e.code === 'Digit5') this.press('skill4'); if (e.code === 'KeyE' || e.code === 'Digit6') this.press('skill5');
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyJ' || e.code === 'Space') this.attackHeld = false; });
  }
  update() {
    if (!this.joy.active) {
      let x = 0, y = 0; const k = this.keys;
      if (k.KeyA || k.ArrowLeft) x -= 1; if (k.KeyD || k.ArrowRight) x += 1; if (k.KeyW || k.ArrowUp) y -= 1; if (k.KeyS || k.ArrowDown) y += 1;
      const m = Math.hypot(x, y); if (m > 0) { x /= m; y /= m; }
      this.move.x = x; this.move.y = y;
    }
  }
}
