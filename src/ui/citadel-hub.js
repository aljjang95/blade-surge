import './citadel-hub.css';
import { DUNGEONS } from '../data/expansion.js';
import { CITADEL_HUB_HOTSPOTS } from '../data/citadel-hub.js';

const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const verbs = { dungeon: '입장 확인', campaign: '캠페인 보기', arena: '상대 고르기', merchant: '물약 구매', trainer: '전투 준비', steward: '결투 안내' };

/** Native controls and destination dialogs for the walking lobby. */
export class CitadelHubUI {
  constructor(app, { onInteract, onDestination } = {}) {
    this.app = app; this.onInteract = onInteract; this.onDestination = onDestination;
    this.nearest = null; this.opened = false; this.visible = false; this.busy = false;
    this.root = document.createElement('section'); this.root.className = 'citadel-hub-ui'; this.root.hidden = true;
    this.root.setAttribute('aria-label', '성채 출격 광장');
    this.root.innerHTML = `<div class="citadel-hub-place"><small>CITADEL</small><strong>출격 광장</strong><span>길을 따라 입구로 이동하세요</span></div>
      <div class="citadel-hub-hint"><span><kbd>WASD</kbd> <kbd>방향키</kbd> 이동</span><span><kbd>E</kbd> 대화 · 입장</span></div>
      <div class="citadel-hub-near"><div class="citadel-hub-near-copy"><small>가까운 입구</small><strong class="citadel-hub-near-name">성채의 길</strong><span class="citadel-hub-near-detail">던전과 안내관에게 다가가세요</span></div><button type="button" class="citadel-hub-interact" disabled><kbd>E</kbd><span>대화 · 입장</span></button></div>
      <div class="citadel-hub-stick" role="group" aria-label="성채 이동 조이스틱"><span class="citadel-hub-stick-cross" aria-hidden="true"></span><span class="citadel-hub-knob" aria-hidden="true"></span><span class="citadel-hub-stick-label" aria-hidden="true">이동</span></div>`;
    document.body.append(this.root);
    this.name = this.root.querySelector('.citadel-hub-near-name');
    this.detail = this.root.querySelector('.citadel-hub-near-detail');
    this.interactButton = this.root.querySelector('.citadel-hub-interact');
    this.interactLabel = this.interactButton.querySelector('span');
    this.touchStick = this.root.querySelector('.citadel-hub-stick');
    this.touchKnob = this.root.querySelector('.citadel-hub-knob');
    this.clickHandler = () => {
      if (!this.nearest || this.busy || this.opened) return;
      if (this.onInteract) this.onInteract(this.nearest);
      else this.interact(this.nearest, this.interactButton);
    };
    this.interactButton.addEventListener('click', this.clickHandler);
    this.dialog = document.createElement('dialog'); this.dialog.className = 'citadel-hub-dialog';
    this.dialog.setAttribute('aria-labelledby', 'citadel-destination-title');
    this.dialog.setAttribute('aria-describedby', 'citadel-destination-description');
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => {
      this.opened = false; this.dialogSpot = null;
      this.app.hubControls?.clear(); this.app.citadelControls?.clear();
      if (this.visible && this.app.mode === 'lobby' && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    });
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) this.close();
    });
    this.ecoListener = () => { if (this.opened && this.dialogSpot) this.refreshDestination(); };
    this.unsub = this.app.eco?.onChange?.(this.ecoListener);
  }
  setVisible(visible) {
    this.visible = !!visible; this.root.hidden = !this.visible;
    if (!this.visible) this.clear();
  }
  update(nearest, state = {}) {
    const spot = typeof nearest === 'string' ? CITADEL_HUB_HOTSPOTS.find(s => s.id === nearest) : nearest;
    this.nearest = spot || null;
    this.root.dataset.nearby = spot ? 'true' : 'false';
    this.name.textContent = spot?.label || '성채의 길';
    this.detail.textContent = spot ? spot.kind === 'dungeon'
      ? `탐험 Lv.${spot.minLevel} · 에너지 ${spot.energy}` : spot.description : '던전과 안내관에게 다가가세요';
    this.interactLabel.textContent = spot ? verbs[spot.kind] || '확인' : '대화 · 입장';
    this.interactButton.disabled = !spot || !!state.blocked || this.opened || this.busy;
    this.root.style.setProperty('--citadel-near-accent', spot?.accent || '#d3c29c');
  }
  interact(spot = this.nearest, trigger = this.interactButton) {
    if (!spot || this.busy || this.opened || this.app.stageStarting || this.app.mode !== 'lobby') return false;
    const canonical = CITADEL_HUB_HOTSPOTS.find(s => s.id === spot.id); if (!canonical) return false;
    this.app.hubControls?.clear(); this.app.citadelControls?.clear();
    if (this.onDestination) {
      const handled = this.onDestination(canonical, trigger);
      if (handled !== undefined) return handled;
    }
    if (canonical.kind === 'dungeon') return this.openDestination(canonical, trigger);
    if (canonical.kind === 'merchant') { this.app.citadelShop?.open(trigger); return true; }
    if (canonical.kind === 'trainer') { this.app.battle?.chronicle?.open('build'); return true; }
    if (canonical.kind === 'arena' || canonical.kind === 'steward') { this.app.expeditionUI.open('arena'); return true; }
    if (canonical.kind === 'campaign') { this.app.meta.openTab('stage'); return true; }
    return false;
  }
  openDestination(spot, trigger = this.interactButton) {
    const def = DUNGEONS.find(d => d.id === spot.route); if (!def || this.opened || this.busy) return false;
    this.trigger = trigger; this.returnFocus = document.activeElement; this.dialogSpot = spot; this.opened = true;
    this.renderDestination(def, spot);
    this.dialog.showModal(); this.dialog.querySelector('.citadel-hub-go')?.focus({ preventScroll: true });
    if (this.dialog.querySelector('.citadel-hub-go')?.disabled) this.dialog.querySelector('.citadel-hub-cancel')?.focus({ preventScroll: true });
    return true;
  }
  access(def) {
    const access = this.app.expedition.dungeonAccess(def.id, { depth: 'standard' });
    const energy = this.app.eco.s.energy;
    const error = !access.ok ? access.error : energy < def.energy ? `에너지가 부족합니다. 보유 ${energy} / 필요 ${def.energy}` : '';
    return { ok: access.ok && energy >= def.energy && !this.app.stageStarting, error, energy };
  }
  renderDestination(def, spot) {
    const access = this.access(def);
    this.dialog.style.setProperty('--citadel-near-accent', def.accent || '#a6d7cc');
    this.dialog.innerHTML = `<div class="citadel-hub-destination-art" ${def.art ? `style="background-image:url('${safe(def.art)}')"` : ''}><span>${safe(def.subtitle || def.theme.toUpperCase())}</span></div>
      <div class="citadel-hub-destination-body"><small class="citadel-hub-eyebrow">원정 입구</small><h2 id="citadel-destination-title">${safe(def.name)}</h2><p id="citadel-destination-description">${safe(def.description)}</p>
      <div class="citadel-hub-destination-stats"><span>해금 <b>탐험 Lv.${def.minLevel}</b></span><span>입장 비용 <b>에너지 ${def.energy}</b></span><span>현재 보유 <b>에너지 ${access.energy}</b></span></div>
      <p class="citadel-hub-objective">${safe(def.objective || def.description)}</p><p class="citadel-hub-access" role="status">${safe(access.error || '입장을 확정하면 에너지가 소모됩니다.')}</p>
      <div class="citadel-hub-destination-actions"><button type="button" class="citadel-hub-cancel">돌아가기</button><button type="button" class="citadel-hub-go" ${access.ok ? '' : 'disabled'}>입장 · 에너지 ${def.energy}</button></div></div>`;
    this.dialog.querySelector('.citadel-hub-cancel').addEventListener('click', () => this.close());
    this.dialog.querySelector('.citadel-hub-go').addEventListener('click', async () => {
      if (this.busy || this.app.stageStarting || !this.opened || this.dialogSpot !== spot) return;
      const live = this.access(def);
      if (!live.ok) { this.refreshDestination(); return; }
      this.busy = true; this.close();
      try { await this.app.startExpedition('dungeon', def.id, { depth: 'standard' }); }
      finally { this.busy = false; }
    });
  }
  refreshDestination() {
    const def = DUNGEONS.find(d => d.id === this.dialogSpot?.route); if (!def || !this.opened) return;
    const access = this.access(def), go = this.dialog.querySelector('.citadel-hub-go');
    go.disabled = !access.ok || this.busy;
    this.dialog.querySelector('.citadel-hub-access').textContent = access.error || '입장을 확정하면 에너지가 소모됩니다.';
    this.dialog.querySelector('.citadel-hub-destination-stats span:last-child b').textContent = `에너지 ${access.energy}`;
  }
  close() { if (this.dialog.open) this.dialog.close(); else { this.opened = false; this.dialogSpot = null; } }
  clear() { this.nearest = null; this.close(); this.touchKnob.style.transform = 'translate(-50%, -50%)'; }
  destroy() {
    this.clear(); this.unsub?.();
    const listeners = this.app.eco?.listeners, listenerIndex = listeners?.indexOf(this.ecoListener);
    if (listenerIndex >= 0) listeners.splice(listenerIndex, 1);
    this.interactButton.removeEventListener('click', this.clickHandler);
    this.root.remove(); this.dialog.remove();
  }
}
