import { CITADEL_POTIONS } from '../data/citadel-shop.js';
import { CONSUMABLES } from '../data/expansion.js';
import { resourceArt } from './illustrated.js';
import { audio } from '../engine/audio.js';
import './citadel-shop.css';

const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
const button = (label, action, className = '') => {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
};
const fmt = amount => amount.toLocaleString('ko-KR');
const art = (id, className = '') => {
  const image = node('img', className);
  image.src = resourceArt(id);
  image.alt = '';
  return image;
};

export class CitadelShop {
  constructor(app) {
    this.app = app;
    this.rows = new Map();
    this.dialog = node('dialog', 'citadel-shop');
    this.dialog.id = 'citadel-shop';
    this.dialog.setAttribute('aria-labelledby', 'citadel-shop-title');
    this.dialog.setAttribute('aria-describedby', 'citadel-shop-intro');

    const header = node('header', 'citadel-shop-header');
    const heading = node('div');
    heading.append(node('small', 'citadel-shop-eyebrow', '성채 보급소 · 물약상 세라'));
    const title = node('h2', '', '모험 전에, 한 병.');
    title.id = 'citadel-shop-title';
    heading.append(title);
    this.closeButton = button('닫기', () => this.close(), 'citadel-shop-close');
    header.append(heading, this.closeButton);

    const body = node('div', 'citadel-shop-body');
    const intro = node('p', 'citadel-shop-intro', '“골드는 아껴도 좋아요. 위험할 때 쓸 물약은 챙겨 두세요.”');
    intro.id = 'citadel-shop-intro';
    const wallet = node('div', 'citadel-shop-wallet');
    const walletLabel = node('span');
    walletLabel.append(art('gold'), node('span', '', '보유 골드'));
    this.balance = node('strong');
    wallet.append(walletLabel, this.balance);
    const shelf = node('div', 'citadel-shop-shelf');
    shelf.setAttribute('aria-label', '구매할 수 있는 물약');
    for (const stock of CITADEL_POTIONS) {
      const potion = CONSUMABLES.find(item => item.id === stock.id);
      const row = node('article', `citadel-shop-potion citadel-shop-potion-${stock.id}`);
      row.dataset.potion = stock.id;
      const detail = node('div', 'citadel-shop-detail');
      detail.append(node('h3', '', potion.name), node('p', 'citadel-shop-effect', potion.description));
      const owned = node('span', 'citadel-shop-owned');
      detail.append(owned);
      const purchase = button('', () => this.buy(stock.id), 'citadel-shop-buy');
      purchase.dataset.buyPotion = stock.id;
      purchase.append(node('strong', '', `${fmt(stock.gold)} 골드`), node('span', '', '1개 구매'));
      purchase.setAttribute('aria-label', `${potion.name} 1개 구매 · ${fmt(stock.gold)} 골드`);
      const shortage = node('p', 'citadel-shop-shortage');
      shortage.id = `citadel-shop-shortage-${stock.id}`;
      purchase.setAttribute('aria-describedby', shortage.id);
      row.append(art(stock.id, 'citadel-shop-bottle'), detail, purchase, shortage);
      shelf.append(row);
      this.rows.set(stock.id, { owned, purchase, shortage, potion, stock });
    }

    this.notice = node('p', 'citadel-shop-notice');
    this.notice.setAttribute('role', 'status');
    this.notice.setAttribute('aria-live', 'polite');
    this.notice.setAttribute('aria-atomic', 'true');
    const guide = node('div', 'citadel-shop-guide');
    guide.append(node('strong', '', '물약 챙기기 → 던전 탐험 → 전리품으로 다시 보급'),
      node('p', '', '물약은 전투 화면에서 눌러 사용합니다. 키보드는 U · I · O. 사용한 물약은 보유 수량에서 줄어듭니다.'));
    body.append(intro, wallet, shelf, this.notice, guide);
    const footer = node('footer', 'citadel-shop-footer');
    footer.append(node('span', '', '게임 골드로만 구매 · 현금 결제 없음'), button('준비 완료 · 성채로', () => this.close(), 'citadel-shop-done'));
    this.dialog.append(header, body, footer);
    document.body.append(this.dialog);

    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => {
      this.clearInput();
      if (this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
    });
    for (const event of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart', 'click']) {
      this.dialog.addEventListener(event, input => input.stopPropagation());
    }
    this.onChange = () => { if (this.dialog.open) this.refresh(); };
    app.eco.onChange(this.onChange);
  }

  clearInput() {
    this.app.input?.clear?.();
    this.app.citadel?.clearInput?.();
  }

  open(trigger = document.activeElement) {
    if (this.app.mode !== 'lobby' || this.app.stageStarting || this.app.expedition?.s.pending || this.app.expeditionUI?.result?.saveError) return false;
    if (this.dialog.open) return true;
    this.trigger = trigger;
    this.notice.textContent = '';
    delete this.notice.dataset.tone;
    this.refresh();
    this.clearInput();
    this.dialog.showModal();
    this.closeButton.focus({ preventScroll: true });
    return true;
  }

  close() {
    if (this.dialog.open) {
      this.clearInput();
      this.dialog.close();
    }
  }

  refresh() {
    const gold = this.app.eco.s.gold;
    const counts = this.app.expedition.s.consumables;
    const blocked = this.app.mode !== 'lobby' || this.app.stageStarting || !!this.app.expedition.s.pending || !!this.app.expeditionUI?.result?.saveError;
    this.balance.textContent = fmt(gold);
    for (const [id, { owned, purchase, shortage, stock }] of this.rows) {
      owned.textContent = `보유 ${fmt(counts[id])}개`;
      const missing = Math.max(0, stock.gold - gold);
      const full = counts[id] >= 100000000;
      purchase.disabled = blocked || missing > 0 || full;
      shortage.textContent = blocked ? '전투와 저장을 마친 뒤 구매할 수 있습니다.' : full ? '물약 보관함이 가득 찼습니다.' : missing ? `골드 ${fmt(missing)} 부족 · 던전에서 골드를 모아 주세요.` : '';
      shortage.hidden = !shortage.textContent;
    }
  }

  buy(id) {
    if (!this.dialog.open) return { ok: false, error: '상점을 먼저 열어 주세요.' };
    if (this.app.mode !== 'lobby' || this.app.stageStarting || this.app.expeditionUI?.result?.saveError) {
      this.notice.textContent = '전투와 저장을 마친 뒤 물약을 구매해 주세요.';
      this.notice.dataset.tone = 'error';
      this.refresh();
      return { ok: false, error: this.notice.textContent };
    }
    const result = this.app.expedition.buyPotion(id);
    const potion = this.rows.get(id)?.potion;
    this.notice.dataset.tone = result.ok ? result.storageWarning ? 'warning' : 'success' : 'error';
    this.notice.textContent = result.ok
      ? `${potion.name} 1개를 챙겼습니다. 골드 ${fmt(result.goldSpent)} 사용.${result.storageWarning ? ` ${result.storageWarning}` : ''}`
      : result.error;
    audio.play(result.ok ? 'ui_glass' : 'ui_error', { vol: .35 });
    this.refresh();
    if (this.dialog.contains(document.activeElement) && document.activeElement.disabled) this.closeButton.focus({ preventScroll: true });
    return result;
  }

  destroy() {
    this.close();
    const listeners = this.app.eco.listeners;
    const index = listeners.indexOf(this.onChange);
    if (index >= 0) listeners.splice(index, 1);
    this.dialog.remove();
  }
}
