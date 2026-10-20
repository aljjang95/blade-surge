// 인벤토리 창: 장비 / 소비 / 기타 / 캐시 탭의 고정 칸 격자. 새 아이템 · 새 세이브 필드 없이 이미 저장된 값만 보여 준다.
import { HEROES } from '../data/heroes.js';
import { AVATAR_BY_ID } from '../data/avatars.js';
import { CONSUMABLES, MATERIALS } from '../data/expansion.js';
import { ITEM_BY_ID, RARITY_COLOR, RARITY_INFO, SLOTS, SLOT_NAME, rarityRank } from '../data/items.js';
import { resourceArt, uiArt } from './illustrated.js';
import { itemVisual } from './item-presentation.js';

export const INVENTORY_TABS = Object.freeze([
  { id: 'gear', label: '장비' }, { id: 'use', label: '소비' }, { id: 'etc', label: '기타' }, { id: 'cash', label: '캐시' },
]);
export const GRID_COLUMNS = 6;
export const MIN_SLOTS = 24;

// 소비 · 기타 탭에 보이는 저장 값. key 는 eco.s 또는 eco.s.expedition 의 기존 필드다.
const USE_STACKS = Object.freeze([
  { key: 'stones', art: 'stones', name: '강화석', desc: '장비를 +3 이상 강화할 때 씁니다.' },
  { key: 'stones2', art: 'stones2', name: '상급 강화석', desc: '+10 이상 강화에 쓰는 재료입니다.' },
  { key: 'stones3', art: 'stones3', name: '전설 강화석', desc: '+15 이상 강화에 쓰는 재료입니다.' },
  { key: 'bless', art: 'bless', name: '축복 주문서', desc: '강화 성공률을 20% 올립니다.' },
  { key: 'protect', art: 'protect', name: '보호 주문서', desc: '강화에 실패해도 장비가 파괴되지 않습니다.' },
  { key: 'tickets', art: 'tickets', name: '소환권', desc: '영웅 소환 1회에 쓸 수 있습니다.' },
  { key: 'ssrTickets', art: 'ticket', name: 'SSR 확정권', desc: '소환 화면에서 SSR을 확정으로 뽑습니다.' },
  { key: 'sweep', art: 'sweep', name: '소탕권', desc: '3성 클리어한 스테이지를 바로 소탕합니다.' },
]);
const EXPEDITION_USE = Object.freeze(CONSUMABLES.map((c) => ({ source: 'expedition.consumables', key: c.id, art: c.id, name: c.name, desc: c.description })));
const EXPEDITION_ETC = Object.freeze(MATERIALS.map((m) => ({ source: 'expedition.materials', key: m.id, art: m.id, name: m.name, desc: m.description })));
const ETC_STACKS = Object.freeze([{ key: 'fragments', art: 'fragments', name: '세트 조각', desc: '세트 장비를 제작할 때 모으는 조각입니다.' }]);

const amount = (state, def) => {
  const bag = def.source === 'expedition.consumables' ? state.expedition?.consumables : def.source === 'expedition.materials' ? state.expedition?.materials : state;
  const value = bag?.[def.key];
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

/** uid → 장착 중인 영웅 id */
export function equippedOwners(state) {
  const owners = new Map();
  for (const [heroId, hero] of Object.entries(state.heroes || {})) for (const uid of Object.values(hero.equip || {})) if (uid !== null && uid !== undefined) owners.set(uid, heroId);
  return owners;
}

/** 칸 수는 24칸 이상, 한 줄(6칸)의 배수로 맞춘다. 남는 칸은 빈 칸으로 둔다. */
export function slotCapacity(count) { return Math.max(MIN_SLOTS, Math.ceil(count / GRID_COLUMNS) * GRID_COLUMNS); }

/** 순수 데이터 모델: 화면을 그리지 않고 칸 목록만 만든다(테스트 대상). */
export function buildInventoryModel(eco, { tab = 'gear', slot = 'all' } = {}) {
  const state = eco.s;
  const safeTab = INVENTORY_TABS.some((entry) => entry.id === tab) ? tab : 'gear';
  const safeSlot = SLOTS.includes(slot) ? slot : 'all';
  let cells = [];
  if (safeTab === 'gear') {
    const owners = equippedOwners(state);
    cells = (state.inventory || []).filter((inst) => ITEM_BY_ID[inst.id] && (safeSlot === 'all' || ITEM_BY_ID[inst.id].slot === safeSlot)).slice()
      .sort((a, b) => rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity) || (b.enh || 0) - (a.enh || 0) || b.uid - a.uid)
      .map((inst) => {
        const it = ITEM_BY_ID[inst.id], owner = owners.get(inst.uid) || null;
        // 칸을 누르면 착용자(없으면 출전 영웅) 문맥 시트가 열린다. 칸 그림도 같은 영웅의 형태로 그린다.
        const visual = itemVisual(it, { heroId: owner || eco.s?.selected });
        return { type: 'gear', key: 'g' + inst.uid, uid: inst.uid, itemId: it.id, name: it.name, icon: visual.iconUrl, fallbackIcon: visual.fallbackUrl, visual: visual.renderSet, rarity: it.rarity, rarityName: RARITY_INFO[it.rarity]?.name || '', color: RARITY_COLOR[it.rarity] || '#9aa3b2', slot: it.slot, slotName: SLOT_NAME[it.slot], enh: inst.enh || 0, owner, ownerName: owner ? HEROES[owner]?.name || '' : '' };
      });
  } else if (safeTab === 'use') {
    cells = [...USE_STACKS, ...EXPEDITION_USE].map((def) => ({ def, qty: amount(state, def) })).filter((row) => row.qty > 0)
      .map(({ def, qty }) => ({ type: 'stack', key: 's:' + def.key, id: def.key, name: def.name, icon: resourceArt(def.art), qty, desc: def.desc, rarity: null }));
  } else if (safeTab === 'etc') {
    cells = [...EXPEDITION_ETC, ...ETC_STACKS].map((def) => ({ def, qty: amount(state, def) })).filter((row) => row.qty > 0)
      .map(({ def, qty }) => ({ type: 'stack', key: 's:' + def.key, id: def.key, name: def.name, icon: resourceArt(def.art), qty, desc: def.desc, rarity: null }));
  } else {
    cells = (state.avatars?.owned || []).map((id) => AVATAR_BY_ID[id]).filter(Boolean).map((avatar) => {
      const worn = eco.equippedAvatar?.(avatar.heroId) === avatar.id;
      return { type: 'avatar', key: 'a:' + avatar.id, id: avatar.id, name: avatar.name, icon: HEROES[avatar.heroId]?.portrait || uiArt('treasure-chest'), qty: null, desc: avatar.desc + (worn ? ' 착용 중입니다.' : ''), worn, rarity: null };
    });
  }
  const capacity = slotCapacity(cells.length);
  return { tab: safeTab, slot: safeSlot, cells, used: cells.length, capacity, gold: state.gold || 0, gems: state.gems || 0, empty: cells.length === 0 };
}

const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined && text !== null && text !== '') node.textContent = text; return node; };
const fmt = (value) => Number(value).toLocaleString('ko-KR');
const EMPTY_TEXT = { gear: '장비가 없습니다. 던전 전리품이나 제작 공방에서 얻을 수 있어요.', use: '소비 아이템이 없습니다.', etc: '기타 아이템이 없습니다.', cash: '보유한 캐시 아바타가 없습니다.' };

export class MapleInventory {
  constructor({ app, meta, eco, manager }) {
    this.app = app; this.meta = meta; this.eco = eco; this.manager = manager;
    this.tab = 'gear'; this.slot = 'all'; this.selected = null; this.pendingFocus = null; this.sheetKey = null;
    this.win = manager.register('inventory', { title: '인벤토리', key: 'I', anchor: 'right', icon: uiArt('treasure-chest'), render: (win) => this.render(win) });
    this.unsubscribe = eco.onChange(() => this.win.isOpen && this.scheduleRefresh());
    this.watchModal();
  }
  scheduleRefresh() { if (this.queued) return; this.queued = true; queueMicrotask(() => { this.queued = false; if (this.win.isOpen) this.render(this.win); }); }
  /** 아이템 시트(#modal)가 닫히면 눌렀던 칸으로 키보드 포커스를 돌려준다. */
  watchModal() {
    const modal = document.getElementById('modal'); if (!modal || typeof MutationObserver === 'undefined') return;
    this.modalObserver = new MutationObserver(() => {
      if (modal.classList.contains('show') || !this.sheetKey) return;
      const key = this.sheetKey; this.sheetKey = null;
      queueMicrotask(() => { if (this.win.isOpen) (this.win.body.querySelector('[data-key="' + key + '"]') || this.win.body.querySelector('.mpl-cell:not(.is-empty)'))?.focus({ preventScroll: true }); });
    });
    this.modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
  /** 장비 창의 빈 칸에서 부위 필터를 걸어 장비 탭으로 연다. */
  openFiltered(slot, options) { this.tab = 'gear'; this.slot = SLOTS.includes(slot) ? slot : 'all'; this.selected = null; return this.manager.open('inventory', options); }
  render(win) {
    const model = buildInventoryModel(this.eco, { tab: this.tab, slot: this.slot });
    const body = win.body, keep = body.querySelector('.mpl-grid')?.scrollTop || 0, focusKey = body.contains(document.activeElement) ? document.activeElement.dataset?.key || document.activeElement.dataset?.tab : null;
    body.replaceChildren();
    const tabs = el('div', 'mpl-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '인벤토리 분류');
    for (const entry of INVENTORY_TABS) {
      const button = el('button', 'mpl-tab', entry.label); button.type = 'button'; button.setAttribute('role', 'tab'); button.dataset.tab = entry.id;
      button.setAttribute('aria-selected', String(entry.id === model.tab)); button.tabIndex = entry.id === model.tab ? 0 : -1;
      button.addEventListener('click', () => { this.tab = entry.id; this.selected = null; this.render(win); body.querySelector('[data-tab="' + entry.id + '"]')?.focus({ preventScroll: true }); });
      button.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!step) return;
        event.preventDefault(); const index = (INVENTORY_TABS.findIndex((t) => t.id === model.tab) + step + INVENTORY_TABS.length) % INVENTORY_TABS.length; this.tab = INVENTORY_TABS[index].id; this.selected = null; this.render(win); body.querySelector('[data-tab="' + this.tab + '"]')?.focus({ preventScroll: true });
      });
      tabs.append(button);
    }
    const main = el('div', 'mpl-main');
    body.append(tabs, main);
    if (model.tab === 'gear') {
      const chips = el('div', 'mpl-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', '장비 부위');
      for (const id of ['all', ...SLOTS]) {
        const chip = el('button', 'mpl-chip', id === 'all' ? '전체' : SLOT_NAME[id]); chip.type = 'button'; chip.setAttribute('aria-pressed', String(id === model.slot));
        chip.addEventListener('click', () => { this.slot = id; this.selected = null; this.render(win); });
        chips.append(chip);
      }
      main.append(chips);
    }
    const grid = el('div', 'mpl-grid'); grid.setAttribute('role', 'list'); grid.setAttribute('aria-label', INVENTORY_TABS.find((t) => t.id === model.tab).label + ' 칸');
    for (let index = 0; index < model.capacity; index++) {
      const cell = model.cells[index];
      if (!cell) { const empty = el('div', 'mpl-cell is-empty'); empty.setAttribute('aria-hidden', 'true'); grid.append(empty); continue; }
      grid.append(this.cellButton(cell, win));
    }
    main.append(grid);
    if (model.empty) main.append(el('p', 'mpl-empty-note', EMPTY_TEXT[model.tab]));
    const detail = el('div', 'mpl-detail'); detail.setAttribute('aria-live', 'polite'); main.append(detail);
    this.fillDetail(detail, model.cells.find((cell) => cell.key === this.selected));
    const foot = el('footer', 'mpl-foot');
    const money = el('div', 'mpl-money');
    for (const [art, value, label] of [['gold', model.gold, '골드'], ['gems', model.gems, '보석']]) {
      const row = el('span', 'mpl-money-row'); row.title = label; const img = document.createElement('img'); img.alt = ''; img.src = resourceArt(art); const num = el('b', '', fmt(value)); const sr = el('i', 'mpl-sr', label); row.append(img, sr, num); money.append(row);
    }
    foot.append(money, el('span', 'mpl-count', model.used + ' / ' + model.capacity + '칸'));
    main.append(foot);
    grid.scrollTop = keep;
    if (focusKey) (body.querySelector('[data-key="' + focusKey + '"]') || body.querySelector('[data-tab="' + focusKey + '"]'))?.focus({ preventScroll: true });
  }
  cellButton(cell, win) {
    const button = el('button', 'mpl-cell' + (cell.type === 'gear' ? ' has-gear rar-' + cell.rarity : ' is-stack') + (cell.key === this.selected ? ' is-selected' : '')); button.type = 'button'; button.dataset.key = cell.key; button.setAttribute('role', 'listitem');
    if (cell.color) button.style.setProperty('--mpl-rar', cell.color);
    const img = document.createElement('img'); img.alt = ''; img.src = cell.icon;
    img.onerror = () => { if (cell.fallbackIcon && img.dataset.fallback !== '1') { img.dataset.fallback = '1'; img.src = cell.fallbackIcon; } else img.style.visibility = 'hidden'; };
    button.append(img);
    if (cell.type === 'gear') {
      if (cell.enh > 0) button.append(el('span', 'mpl-badge mpl-enh', '+' + cell.enh));
      if (cell.owner) { const mark = el('span', 'mpl-badge mpl-worn', '착'); mark.title = cell.ownerName + ' 착용 중'; button.append(mark); }
      button.setAttribute('aria-label', cell.name + ' +' + cell.enh + ', ' + cell.rarityName + ', ' + cell.slotName + (cell.owner ? ', ' + cell.ownerName + ' 착용 중' : ''));
    } else if (cell.type === 'stack') {
      button.append(el('span', 'mpl-badge mpl-qty', fmt(cell.qty)));
      button.setAttribute('aria-label', cell.name + ' ' + fmt(cell.qty) + '개');
    } else {
      if (cell.worn) button.append(el('span', 'mpl-badge mpl-worn', '착'));
      button.setAttribute('aria-label', cell.name + (cell.worn ? ', 착용 중' : ''));
    }
    button.title = cell.name;
    button.addEventListener('click', () => {
      this.selected = cell.key;
      if (cell.type === 'gear') {
        // 기존 아이템 시트(착용 · 강화 · 판매)를 그대로 연다. 장착 중이면 그 영웅 기준으로 비교한다.
        this.sheetKey = cell.key;
        this.meta.showItem(cell.uid, cell.owner || this.eco.s.selected);
      } else {
        win.body.querySelectorAll('.mpl-cell.is-selected').forEach((node) => node.classList.remove('is-selected'));
        button.classList.add('is-selected');
        this.fillDetail(win.body.querySelector('.mpl-detail'), cell);
      }
    });
    return button;
  }
  fillDetail(box, cell) {
    box.replaceChildren();
    if (!cell) { box.append(el('span', 'mpl-detail-hint', '칸을 눌러 자세히 보기')); return; }
    const title = el('b', 'mpl-detail-title', cell.name); if (cell.color) title.style.color = cell.color;
    box.append(title);
    if (cell.type === 'gear') box.append(el('span', '', '+' + cell.enh + ' · ' + cell.rarityName + ' · ' + cell.slotName + (cell.owner ? ' · ' + cell.ownerName + ' 착용 중' : '')));
    else box.append(el('span', '', (cell.qty ? '×' + fmt(cell.qty) + ' · ' : '') + cell.desc));
  }
  dispose() { this.modalObserver?.disconnect(); }
}
