// 메이플스토리식 공통 창 관리자: 제목 표시줄 · 드래그 · 앞으로 가져오기 · Esc · 위치 기억.
// 창 위치는 세이브와 분리된 UI 전용 localStorage 키에만 저장한다.
export const MAPLE_STORAGE_KEY = 'bladesurge.ui.windows.v1';
const MARGIN = 6;

/** 세로가 낮거나 폭이 좁은 가로 화면은 저장 위치를 쓰지 않고 화면 중앙에 맞춘다. */
export function isCompactViewport(width, height) { return height <= 520 || width <= 700; }

/** 창 왼쪽 위 좌표를 화면 안으로 되돌린다. 창이 화면보다 크면 여백 위치에 붙인다. */
export function clampWindowPosition({ x, y, width, height, viewportWidth, viewportHeight, margin = MARGIN }) {
  const maxX = viewportWidth - width - margin, maxY = viewportHeight - height - margin;
  return { x: Math.round(Math.max(margin, Math.min(x, maxX < margin ? margin : maxX))), y: Math.round(Math.max(margin, Math.min(y, maxY < margin ? margin : maxY))) };
}

/** 저장된 위치가 없을 때의 기본 자리: 가운데를 기준으로 왼쪽 · 오른쪽에 나란히 놓는다. */
export function defaultWindowPosition(anchor, { width, height, viewportWidth, viewportHeight }) {
  const gap = 12, centerY = Math.max(MARGIN, Math.round((viewportHeight - height) / 2) - 24);
  const x = anchor === 'left' ? viewportWidth / 2 - width - gap : anchor === 'right' ? viewportWidth / 2 + gap : (viewportWidth - width) / 2;
  return clampWindowPosition({ x, y: centerY, width, height, viewportWidth, viewportHeight });
}

/** 단축키를 무시해야 하는 이유를 돌려준다. 이유가 없으면 null(= 처리해도 됨). */
export function hotkeyBlockedReason(ctx) {
  if (ctx.ctrl || ctx.meta || ctx.alt || ctx.shift || ctx.repeat) return 'modifier';
  if (ctx.targetEditable) return 'typing';
  if (ctx.mode !== 'lobby') return 'not-lobby';
  if (ctx.stageStarting) return 'stage-starting';
  if (ctx.modalOpen || ctx.dialogOpen) return 'other-modal';
  if (ctx.expeditionOpen || ctx.companionOpen) return 'other-panel';
  if (ctx.bootVisible) return 'boot';
  // 거점 걷기 중 E 는 상호작용 키라 창 단축키로 가로채지 않는다.
  if (ctx.hubWalk && ctx.code === 'KeyE') return 'hub-interact';
  return null;
}

const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };

export class MapleWindowManager {
  constructor({ storage, root = document.body } = {}) {
    // 사이트 데이터가 차단되면 localStorage getter 가 예외를 던진다. 창 위치는 이번 접속에서만 유지한다.
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
    this.storage = storage; this.windows = new Map(); this.zCounter = 10; this.disposed = false;
    this.positions = this.readPositions();
    this.layer = el('div', 'mpl-layer'); this.layer.id = 'maple-windows';
    root.append(this.layer);
    this.onResize = () => { this.syncLayer(); for (const win of this.windows.values()) if (win.isOpen) this.layout(win, false); };
    window.addEventListener('resize', this.onResize);
    this.onKey = (event) => this.handleEscape(event);
    document.addEventListener('keydown', this.onKey, true);
  }
  readPositions() {
    try { const raw = JSON.parse(this.storage?.getItem(MAPLE_STORAGE_KEY) || '{}'); return raw && typeof raw === 'object' ? raw : {}; } catch { return {}; }
  }
  writePositions() { try { this.storage?.setItem(MAPLE_STORAGE_KEY, JSON.stringify(this.positions)); } catch { /* 저장 불가 환경에서는 이번 접속에서만 유지한다. */ } }

  /** 창을 등록한다. render(handle) 는 열릴 때와 refresh() 때만 호출되며 프레임 루프와 무관하다. */
  register(id, def) {
    const root = el('section', 'mpl-win'); root.dataset.win = id; root.tabIndex = -1; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', def.title);
    const head = el('header', 'mpl-title');
    if (def.icon) { const icon = el('span', 'mpl-title-icon'); const img = document.createElement('img'); img.alt = ''; img.src = def.icon; img.onerror = () => img.remove(); icon.append(img); head.append(icon); }
    const title = el('h2', 'mpl-title-text', def.title);
    head.append(title);
    if (def.key) { const hint = el('kbd', 'mpl-key', def.key); hint.setAttribute('aria-hidden', 'true'); head.append(hint); }
    const close = el('button', 'mpl-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', def.title + ' 닫기');
    head.append(close);
    const body = el('div', 'mpl-body');
    root.append(head, body);
    this.layer.append(root);
    const win = { id, def, root, head, body, isOpen: false, opener: null, manager: this,
      open: (options) => this.open(id, options), close: () => this.close(id), toggle: (options) => this.toggle(id, options), refresh: () => this.refresh(id) };
    close.addEventListener('click', () => this.close(id));
    root.addEventListener('pointerdown', () => this.front(win), true);
    this.bindDrag(win);
    this.windows.set(id, win);
    return win;
  }
  bindDrag(win) {
    let drag = null;
    win.head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button') || event.pointerType === 'touch' || this.compact()) return;
      const rect = win.root.getBoundingClientRect();
      drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      win.head.setPointerCapture?.(event.pointerId); win.root.classList.add('is-dragging'); event.preventDefault();
    });
    win.head.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      this.place(win, event.clientX - drag.dx, event.clientY - drag.dy);
    });
    const end = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null; win.root.classList.remove('is-dragging'); win.head.releasePointerCapture?.(event.pointerId);
      this.positions[win.id] = { x: Math.round(parseFloat(win.root.style.left) || 0), y: Math.round(parseFloat(win.root.style.top) || 0) };
      this.writePositions();
    };
    win.head.addEventListener('pointerup', end); win.head.addEventListener('pointercancel', end);
  }
  compact() { return isCompactViewport(window.innerWidth, window.innerHeight); }
  place(win, x, y) {
    const rect = win.root.getBoundingClientRect();
    const pos = clampWindowPosition({ x, y, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
    win.root.style.left = pos.x + 'px'; win.root.style.top = pos.y + 'px';
    return pos;
  }
  /** 열린 창을 화면 안에 놓는다. 좁은 화면은 가운데 정렬, 그 외에는 저장 위치 → 기본 위치 순서다. */
  layout(win, initial) {
    const rect = win.root.getBoundingClientRect(), size = { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    win.root.classList.toggle('is-compact', this.compact());
    if (this.compact()) { const pos = defaultWindowPosition('center', size); win.root.style.left = pos.x + 'px'; win.root.style.top = pos.y + 'px'; return; }
    const saved = this.positions[win.id];
    if (initial) {
      const pos = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? clampWindowPosition({ ...size, x: saved.x, y: saved.y }) : defaultWindowPosition(win.def.anchor || 'center', size);
      win.root.style.left = pos.x + 'px'; win.root.style.top = pos.y + 'px';
    } else this.place(win, parseFloat(win.root.style.left) || 0, parseFloat(win.root.style.top) || 0);
  }
  front(win) { win.root.style.zIndex = String(++this.zCounter); this.order = this.order || []; this.order = this.order.filter((id) => id !== win.id); this.order.push(win.id); }
  openWindows() { return [...this.windows.values()].filter((win) => win.isOpen); }
  topmost() { const open = this.openWindows(); return open.sort((a, b) => (+a.root.style.zIndex || 0) - (+b.root.style.zIndex || 0)).at(-1) || null; }
  isOpen(id) { return !!this.windows.get(id)?.isOpen; }
  open(id, options = {}) {
    const win = this.windows.get(id); if (!win || this.disposed) return null;
    if (!win.isOpen) {
      // 좁은 화면은 창을 한 번에 하나만 둔다(겹치면 빠른 메뉴와 뒤 창을 가린다).
      if (this.compact()) for (const other of this.openWindows()) if (other.id !== id) this.close(other.id);
      win.opener = options.opener || (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
      win.root.hidden = false; win.isOpen = true; win.def.render?.(win, options);
      this.layout(win, true);
    } else win.def.render?.(win, options);
    this.front(win);
    if (!options.keepFocus) win.root.focus({ preventScroll: true });
    this.syncLayer();
    return win;
  }
  syncLayer() { this.layer.classList.toggle('has-open', this.openWindows().length > 0); this.layer.classList.toggle('is-compact', this.compact()); }
  refresh(id) { const win = this.windows.get(id); if (win?.isOpen) win.def.render?.(win, { refresh: true }); }
  close(id) {
    const win = this.windows.get(id); if (!win?.isOpen) return;
    win.isOpen = false; win.root.hidden = true; win.def.onClose?.(win);
    this.syncLayer();
    const opener = win.opener; win.opener = null;
    if (opener?.isConnected && !document.querySelector('dialog[open], #modal.show')) opener.focus({ preventScroll: true });
  }
  toggle(id, options) { return this.isOpen(id) ? (this.close(id), null) : this.open(id, options); }
  closeAll() { for (const id of this.windows.keys()) this.close(id); }
  handleEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || this.disposed) return;
    if (document.querySelector('dialog[open], #modal.show')) return;
    const top = this.topmost(); if (!top) return;
    event.preventDefault(); event.stopPropagation(); this.close(top.id);
  }
  dispose() { this.disposed = true; this.closeAll(); window.removeEventListener('resize', this.onResize); document.removeEventListener('keydown', this.onKey, true); this.layer.remove(); }
}
