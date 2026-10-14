// 로비의 메이플식 창 모음: 빠른 메뉴 바(장비 · 인벤 · 임무 · 메뉴)와 E / I / Q 단축키를 묶는다.
import { MapleWindowManager, hotkeyBlockedReason } from './maple-window.js';
import { MapleInventory } from './maple-inventory.js';
import { MapleEquipment } from './maple-equipment.js';
import { uiArt } from './illustrated.js';

const QUICK_ACTIONS = Object.freeze([
  { id: 'equipment', label: '장비', key: 'E', art: 'nav-heroes' },
  { id: 'inventory', label: '인벤', key: 'I', art: 'treasure-chest' },
  { id: 'quests', label: '임무', key: 'Q', art: 'nav-quests' },
  { id: 'menu', label: '메뉴', key: '', art: 'nav-journal' },
]);
const HOTKEYS = Object.freeze({ KeyE: 'equipment', KeyI: 'inventory', KeyQ: 'quests' });

export class MapleUI {
  constructor(app) {
    this.app = app; this.meta = app.meta; this.eco = app.eco; this.disposed = false;
    this.manager = new MapleWindowManager({ storage: globalThis.localStorage });
    this.inventory = new MapleInventory({ app, meta: this.meta, eco: this.eco, manager: this.manager });
    this.equipment = new MapleEquipment({ app, meta: this.meta, eco: this.eco, manager: this.manager, inventory: this.inventory });
    this.buildQuickBar();
    this.onKey = (event) => this.handleKey(event);
    document.addEventListener('keydown', this.onKey);
    // 전투 · 원정 등으로 로비 화면이 사라지면 떠 있는 창도 함께 닫는다.
    const meta = document.getElementById('meta');
    if (meta && typeof MutationObserver !== 'undefined') {
      this.metaObserver = new MutationObserver(() => { if (!meta.classList.contains('show')) this.manager.closeAll(); });
      this.metaObserver.observe(meta, { attributes: true, attributeFilter: ['class'] });
    }
  }
  buildQuickBar() {
    const home = document.getElementById('tab-home') || document.getElementById('meta');
    const bar = document.createElement('nav'); bar.className = 'mpl-quickbar'; bar.setAttribute('aria-label', '빠른 메뉴');
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) bar.classList.add('has-hotkeys');
    for (const action of QUICK_ACTIONS) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mpl-quick'; button.dataset.mplAction = action.id;
      if (action.id === 'equipment' || action.id === 'inventory') { button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); }
      const img = document.createElement('img'); img.alt = ''; img.src = uiArt(action.art); img.onerror = () => { img.style.visibility = 'hidden'; };
      const label = document.createElement('span'); label.textContent = action.label;
      button.append(img, label);
      if (action.key) { const hint = document.createElement('kbd'); hint.textContent = action.key; hint.setAttribute('aria-hidden', 'true'); button.append(hint); button.setAttribute('aria-keyshortcuts', action.key); }
      button.addEventListener('click', () => this.run(action.id, button));
      bar.append(button);
    }
    home.append(bar); this.bar = bar;
    // 창이 열려 있는 동안 해당 버튼을 눌린 상태로 보여 준다.
    for (const id of ['equipment', 'inventory']) {
      const win = this.manager.windows.get(id), button = bar.querySelector('[data-mpl-action="' + id + '"]'), sync = () => { button.classList.toggle('is-on', win.isOpen); button.setAttribute('aria-expanded', String(win.isOpen)); };
      const open = win.def.render, close = win.def.onClose;
      win.def.render = (w, o) => { open?.(w, o); sync(); }; win.def.onClose = (w) => { close?.(w); sync(); };
    }
  }
  blockReason(event) {
    const target = event.target, tag = target?.tagName;
    const app = this.app;
    return hotkeyBlockedReason({
      code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey, repeat: event.repeat,
      targetEditable: !!target && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true),
      mode: app.mode, stageStarting: !!app.stageStarting,
      modalOpen: !!document.querySelector('#modal.show'), dialogOpen: !!document.querySelector('dialog[open]'),
      expeditionOpen: !!app.expeditionUI?.opened, companionOpen: !!app.companionAgent?.getSnapshot?.().open,
      bootVisible: !!document.querySelector('#boot.show'), hubWalk: !!app.hubWalkMode,
    });
  }
  handleKey(event) {
    const action = HOTKEYS[event.code]; if (!action || this.disposed || this.blockReason(event)) return;
    event.preventDefault(); this.run(action, this.bar.querySelector('[data-mpl-action="' + action + '"]'));
  }
  run(action, opener) {
    if (this.app.mode !== 'lobby' || this.app.stageStarting) return;
    // 같은 키가 전투 입력으로 새지 않도록 입력 상태를 비운다.
    this.app.input?.clear?.();
    if (action === 'quests') { this.meta.showQuests(); return; }
    if (action === 'menu') { this.app.oathShell?.open(); return; }
    this.manager.toggle(action, { opener });
  }
  dispose() { if (this.disposed) return; this.disposed = true; document.removeEventListener('keydown', this.onKey); this.metaObserver?.disconnect(); this.inventory.dispose(); this.manager.dispose(); this.bar?.remove(); }
}
