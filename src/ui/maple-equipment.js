// 장비 창: 선택 영웅의 초상을 가운데 두고 무기 · 방어구 · 반지 · 신발 칸을 둘레에 놓는다.
import { HEROES, heroStats } from '../data/heroes.js';
import { ITEM_BY_ID, RARITY_COLOR, RARITY_INFO, SLOTS, SLOT_NAME } from '../data/items.js';
import { resourceArt, uiArt } from './illustrated.js';
import { itemVisual } from './item-presentation.js';
import { tierName, tierTag, tierTone, tierNote } from '../game/item-tier-label.js';

// 왼쪽 열 · 오른쪽 열에 놓을 부위 순서(위 → 아래).
export const EQUIPMENT_LAYOUT = Object.freeze({ left: ['weapon', 'ring'], right: ['armor', 'boots'] });

/** 순수 데이터 모델: 영웅 요약과 4개 부위 칸. */
export function buildEquipmentModel(eco, heroId = eco.s.selected) {
  const def = HEROES[heroId], hero = eco.hero(heroId), stats = heroStats(def, hero, eco.heroEquipBonus(heroId));
  const slots = SLOTS.map((slot) => {
    const inst = eco.s.inventory.find((x) => x.uid === hero.equip[slot]), it = inst && ITEM_BY_ID[inst.id];
    if (!it) return { slot, slotName: SLOT_NAME[slot], empty: true, art: uiArt('slot-' + slot) };
    return { slot, slotName: SLOT_NAME[slot], empty: false, uid: inst.uid, itemId: it.id, name: tierName(it.name, inst), tierTag: tierTag(inst), tierTone: tierTone(inst), tierNote: tierNote(inst), icon: itemVisual(it, { heroId }).iconUrl, fallbackIcon: itemVisual(it, { heroId }).fallbackUrl, visual: itemVisual(it, { heroId }).renderSet, rarity: it.rarity, rarityName: RARITY_INFO[it.rarity]?.name || '', color: RARITY_COLOR[it.rarity] || '#9aa3b2', enh: inst.enh || 0 };
  });
  return { heroId, name: def.name, title: def.title, portrait: def.portrait, level: hero.level, star: hero.star, power: stats.power, slots, gold: eco.s.gold, gems: eco.s.gems };
}

const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined && text !== null && text !== '') node.textContent = text; return node; };
const fmt = (value) => Number(value).toLocaleString('ko-KR');

export class MapleEquipment {
  constructor({ app, meta, eco, manager, inventory }) {
    this.app = app; this.meta = meta; this.eco = eco; this.manager = manager; this.inventory = inventory; this.sheetSlot = null;
    this.win = manager.register('equipment', { title: '장비', key: 'E', anchor: 'left', icon: uiArt('nav-heroes'), render: (win) => this.render(win) });
    eco.onChange(() => this.win.isOpen && this.scheduleRefresh());
    // 아이템 시트가 닫히면 눌렀던 장비 칸으로 포커스를 돌려준다.
    const modal = document.getElementById('modal');
    if (modal && typeof MutationObserver !== 'undefined') {
      this.modalObserver = new MutationObserver(() => {
        if (modal.classList.contains('show') || !this.sheetSlot) return;
        const slot = this.sheetSlot; this.sheetSlot = null;
        queueMicrotask(() => { if (this.win.isOpen) (this.win.body.querySelector('[data-slot="' + slot + '"]') || this.win.body.querySelector('.mpl-slot'))?.focus({ preventScroll: true }); });
      });
      this.modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
  }
  scheduleRefresh() { if (this.queued) return; this.queued = true; queueMicrotask(() => { this.queued = false; if (this.win.isOpen) this.render(this.win); }); }
  render(win) {
    const model = buildEquipmentModel(this.eco), body = win.body;
    const focusSlot = body.contains(document.activeElement) ? document.activeElement.dataset?.slot : null;
    body.replaceChildren();
    const stage = el('div', 'mpl-equip');
    const column = (side) => { const col = el('div', 'mpl-equip-col is-' + side); for (const slot of EQUIPMENT_LAYOUT[side]) col.append(this.slotButton(model.slots.find((entry) => entry.slot === slot), model)); return col; };
    const center = el('div', 'mpl-equip-hero');
    const portrait = document.createElement('img'); portrait.className = 'mpl-portrait'; portrait.alt = model.name; portrait.src = model.portrait; portrait.onerror = () => { portrait.style.visibility = 'hidden'; };
    const name = el('b', 'mpl-hero-name', model.name), sub = el('span', 'mpl-hero-sub', 'Lv.' + model.level + ' · ' + '★'.repeat(model.star) + '☆'.repeat(Math.max(0, 5 - model.star))), power = el('span', 'mpl-hero-power', '전투력 ');
    power.append(el('b', '', fmt(model.power)));
    center.append(portrait, name, sub, power);
    stage.append(column('left'), center, column('right'));
    body.append(stage);
    const detail = el('div', 'mpl-detail'); detail.setAttribute('aria-live', 'polite'); detail.append(el('span', 'mpl-detail-hint', '칸을 눌러 비교 · 강화하거나, 빈 칸에서 가방을 열 수 있어요'));
    body.append(detail);
    const foot = el('footer', 'mpl-foot');
    const money = el('div', 'mpl-money');
    for (const [art, value, label] of [['gold', model.gold, '골드'], ['gems', model.gems, '보석']]) { const row = el('span', 'mpl-money-row'); row.title = label; const img = document.createElement('img'); img.alt = ''; img.src = resourceArt(art); row.append(img, el('i', 'mpl-sr', label), el('b', '', fmt(value))); money.append(row); }
    const heroes = el('button', 'mpl-link', '영웅 상세'); heroes.type = 'button';
    heroes.addEventListener('click', () => { this.manager.close('equipment'); this.meta.openTab('heroes'); });
    foot.append(money, heroes);
    body.append(foot);
    if (focusSlot) body.querySelector('[data-slot="' + focusSlot + '"]')?.focus({ preventScroll: true });
  }
  slotButton(slotModel, model) {
    const button = el('button', 'mpl-slot' + (slotModel.empty ? ' is-empty' : ' has-gear rar-' + slotModel.rarity)); button.type = 'button'; button.dataset.slot = slotModel.slot;
    if (slotModel.color) button.style.setProperty('--mpl-rar', slotModel.color);
    const img = document.createElement('img'); img.alt = ''; img.src = slotModel.empty ? slotModel.art : slotModel.icon;
    img.onerror = () => { if (slotModel.fallbackIcon && img.dataset.fallback !== '1') { img.dataset.fallback = '1'; img.src = slotModel.fallbackIcon; } else img.style.visibility = 'hidden'; };
    button.append(img, el('span', 'mpl-slot-name', slotModel.slotName));
    if (slotModel.empty) {
      button.setAttribute('aria-label', slotModel.slotName + ' 비어 있음, 가방에서 고르기');
      button.addEventListener('click', () => { this.inventory.openFiltered(slotModel.slot, { keepFocus: false }); });
    } else {
      if (slotModel.enh > 0) button.append(el('span', 'mpl-badge mpl-enh', '+' + slotModel.enh));
      if (slotModel.tierTag) { button.classList.add('tier-' + slotModel.tierTone); button.append(el('span', 'mpl-badge mpl-tier tier-tag', slotModel.tierTag)); }
      button.title = slotModel.name; button.setAttribute('aria-label', slotModel.slotName + ': ' + slotModel.name + ' +' + slotModel.enh + (slotModel.tierNote ? ', ' + slotModel.tierNote : '') + ', 비교와 강화 열기');
      button.addEventListener('click', () => { this.sheetSlot = slotModel.slot; this.meta.showItem(slotModel.uid, model.heroId); });
    }
    return button;
  }
}
