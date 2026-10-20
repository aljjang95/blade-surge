// 로비 창 묶음(인벤토리 · 장비)과 E / I / Q 단축키.
// 화면의 빠른 메뉴 바는 두지 않는다. 같은 목적지는 하단 '영웅·장비'와 '메뉴'가 맡고, 단축키는 보조 진입이다.
import { MapleWindowManager, hotkeyBlockedReason } from './maple-window.js';
import { MapleInventory } from './maple-inventory.js';
import { MapleEquipment } from './maple-equipment.js';

const HOTKEYS = Object.freeze({ KeyE: 'equipment', KeyI: 'inventory', KeyQ: 'quests' });
export const MAPLE_HOTKEYS = HOTKEYS;

export class MapleUI {
  constructor(app) {
    this.app = app; this.meta = app.meta; this.eco = app.eco; this.disposed = false;
    this.manager = new MapleWindowManager();
    this.inventory = new MapleInventory({ app, meta: this.meta, eco: this.eco, manager: this.manager });
    this.equipment = new MapleEquipment({ app, meta: this.meta, eco: this.eco, manager: this.manager, inventory: this.inventory });
    this.onKey = (event) => this.handleKey(event);
    document.addEventListener('keydown', this.onKey);
    // 전투 · 원정 등으로 로비 화면이 사라지면 떠 있는 창도 함께 닫는다.
    const meta = document.getElementById('meta');
    if (meta && typeof MutationObserver !== 'undefined') {
      this.metaObserver = new MutationObserver(() => { if (!meta.classList.contains('show')) this.manager.closeAll(); });
      this.metaObserver.observe(meta, { attributes: true, attributeFilter: ['class'] });
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
    event.preventDefault();
    // 창을 닫으면 단축키를 누를 때 초점이 있던 곳으로 돌아간다.
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    this.run(action, opener);
  }
  run(action, opener) {
    if (this.app.mode !== 'lobby' || this.app.stageStarting) return;
    // 같은 키가 전투 입력으로 새지 않도록 입력 상태를 비운다.
    this.app.input?.clear?.();
    if (action === 'quests') { this.meta.showQuests(); return; }
    if (action === 'menu') { this.app.oathShell?.open(); return; }
    this.manager.toggle(action, { opener });
  }
  dispose() { if (this.disposed) return; this.disposed = true; document.removeEventListener('keydown', this.onKey); this.metaObserver?.disconnect(); this.inventory.dispose(); this.manager.dispose(); }
}
