import './town-ui.css';
import { MATERIALS, ALL_DUNGEONS as DUNGEONS } from '../data/expansion.js';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID, ITEM_ICON, RARITY_COLOR, RARITY_INFO } from '../data/items.js';
import { CITADEL_TOWN_IDS, TOWN_THEMES, townHub, setActiveTownId, setTownDungeonIds, defaultTownDungeonIds } from '../data/citadel-hub.js';
import { audio } from '../engine/audio.js';
import { uiArt, resourceArt } from './illustrated.js';
import { townServiceFor } from './town-service-adapter.js';
import { TOWN_SHOP_BY_ID } from '../data/towns.js';
import { TownContent, CONTENT_TABS, CONTENT_VIEW_IDS, CONTENT_REASONS, safe as contentSafe } from './town-content.js';

const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const fmt = value => Math.floor(Number(value) || 0).toLocaleString('ko-KR');
const attempt = (fn, fallback) => { try { return fn() ?? fallback; } catch (error) { console.warn('town service call failed', error); return fallback; } };
const TOWN_ART = Object.freeze({ oathhold: ['#3d9cb4', '#e9d49c'], emberport: ['#ff9a4d', '#5a2c3c'], starcrest: ['#9ed4ff', '#1a2a5e'] });
const HERO_IDS = Object.keys(HEROES);

/** 가격 값(숫자 또는 {gold, materials})을 같은 모양으로 맞춘다. */
export const normalizePrice = price => typeof price === 'number' ? { gold: price, materials: {} }
  : { gold: Number(price?.gold) || 0, materials: price?.materials || {} };
/** 교관 조건: 문자열·배열·{text}·{level} 어느 모양이든 한 줄 문구로. */
const requiresText = requires => {
  if (!requires) return '';
  if (typeof requires === 'string') return requires;
  if (Array.isArray(requires)) return requires.map(requiresText).filter(Boolean).join(' · ');
  return requires.text || (requires.level ? '영웅 Lv.' + requires.level : '');
};
/** 서비스가 주는 사유 코드를 한국어 안내로 바꾼다. 이미 문장이면 그대로 쓴다. */
const REASONS = Object.freeze({
  locked: '아직 열리지 않은 마을입니다. 이전 마을의 던전을 더 클리어하세요.', gold: '골드가 부족합니다.', materials: '재료가 부족합니다.',
  'sold-out': '이미 구매했습니다.', level: '영웅 레벨이 부족합니다.', learned: '이미 익힌 기술입니다.', hero: '영웅을 확인할 수 없습니다.',
  storage: '저장하지 못했습니다. 다시 시도해 주세요.', 'unknown-offer': '이 마을에서 팔지 않는 상품입니다.', 'unknown-town': '알 수 없는 마을입니다.',
  'invalid-item': '상품 정보를 읽을 수 없습니다.',
});
const reason = (result, fallback) => { const raw = result?.reason || result?.error; return REASONS[raw] || CONTENT_REASONS[raw] || raw || fallback; };
const tier = offer => offer.appearanceTier || TOWN_SHOP_BY_ID[offer.id]?.appearanceTier || 0;

/**
 * 마을 이동·상인·스킬 교관 패널과 마을 전환(걷기 데이터·장면 교체)을 맡는다.
 * 로직은 TownService(계약 §1)에 맡기고 이 클래스는 화면과 장면 동기화만 한다.
 */
export class TownUI {
  constructor(app, service = townServiceFor(app)) {
    this.app = app; this.service = service; this.view = 'map'; this.heroId = null; this.message = ''; this.tone = '';
    this.opened = false; this.activeId = null; this.trigger = null;
    this.notices = []; this.content = new TownContent(this);
    this.dialog = document.createElement('dialog'); this.dialog.className = 'town-dialog';
    this.dialog.setAttribute('aria-labelledby', 'town-dialog-title');
    document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { if (this.opened && !this.dialog.open) this.finishClose(); });
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart']) this.dialog.addEventListener(type, event => event.stopPropagation());
    this.dialog.addEventListener('click', event => {
      event.stopPropagation();
      if (event.target === this.dialog) { this.close(); return; }
      const control = event.target.closest?.('[data-town-act]');
      if (control && !control.disabled) this.act(control.dataset.townAct, control.dataset);
    });
    this.changeHandler = () => this.onChange();
    this.unsubscribeEco = app.eco?.onChange?.(this.changeHandler);
    this.unsubscribeService = service.onChange?.(this.changeHandler);
    this.sync();
    // 처음 보는 저장은 지금 열린 것을 기준선으로 삼아 조용히 넘어가고, 이후에 새로 열린 것만 알린다.
    this.content.checkUnlocks();
    this.updateBadge();
  }

  // ------------------------------------------------------------ 데이터
  towns() { return attempt(() => this.service.towns(), []); }
  currentTown() { return this.towns().find(town => town.id === this.activeId) || null; }
  wins(dungeonId) { return attempt(() => this.app.expedition?.snapshot().stats?.[dungeonId], 0) || 0; }
  dungeonIds(town) { return town.dungeonIds?.length ? town.dungeonIds : defaultTownDungeonIds(town.id); }

  // ------------------------------------------------------------ 장면 동기화
  /** 서비스가 말하는 현재 마을을 장면·걷기 데이터·HUD에 반영한다. */
  sync() {
    for (const town of this.towns()) setTownDungeonIds(town.id, this.dungeonIds(town));
    let id = attempt(() => this.service.currentTownId(), CITADEL_TOWN_IDS[0]);
    if (!TOWN_THEMES[id]) id = CITADEL_TOWN_IDS[0];
    return this.apply(id);
  }
  apply(id) {
    const changed = id !== this.activeId; this.activeId = id; setActiveTownId(id);
    const hub = townHub(id), movement = this.app.hubMovement;
    if (movement) { movement.hotspots = hub.hotspots; movement.blockers = hub.blockers; }
    const hall = this.app.arena?.lobbyHall;
    if (hall && (hall.userData.townId || 'oathhold') !== id) this.app.arena.buildLobby();
    this.renderPlace();
    return changed;
  }
  onChange() {
    const current = attempt(() => this.service.currentTownId(), this.activeId);
    if (current !== this.activeId) { this.sync(); this.app.hubMovement?.reset(); this.app.syncHub?.(); }
    // 전투 중에 열린 것은 알림을 미뤄 두었다가 로비로 돌아온 첫 변경에서 알린다.
    if (this.app.mode === 'lobby') this.announce(this.content.checkUnlocks());
    this.updateBadge();
    if (this.dialog.open) this.render();
  }
  /** 서비스 사유 코드 → 한국어 안내(마을 상인·교관·콘텐츠 공용). */
  reason(result, fallback) { return reason(result, fallback); }
  sound(ok) { audio.play(ok ? 'ui_glass' : 'ui_error', { vol: ok ? .4 : .35 }); }
  isContent(view = this.view) { return CONTENT_VIEW_IDS.includes(view); }
  /**
   * 새로 열린 곳을 알린다. 패널이 열려 있으면 본문 위 안내 카드로, 닫혀 있으면 인장 연출과 토스트로 보여 준다.
   * 이 함수는 다시 그리지 않는다 — 호출한 쪽이 이어서 render()한다.
   */
  announce(events) {
    if (!events?.length) return;
    this.sound(true);
    if (this.dialog.open) { this.notices = [...this.notices, ...events.map(({ title, text, tab }) => ({ title, text, tab }))].slice(-4); return; }
    this.app.ui?.toast?.(contentSafe(events[0].title) + (events.length > 1 ? ' 외 ' + (events.length - 1) + '건' : ''), 'gold');
    this.seal(events[0]);
  }
  /** 해금 인장 연출. 모션 감소 설정에서는 움직임 없이 같은 시간만 보인다. */
  seal(event) {
    const theme = TOWN_THEMES[event.town] || TOWN_THEMES[this.activeId] || TOWN_THEMES.oathhold, node = document.createElement('div');
    node.className = 'town-unlock-seal'; node.setAttribute('role', 'status'); node.style.setProperty('--town-accent', theme.accent);
    node.innerHTML = '<span aria-hidden="true">★</span><strong>' + safe(event.title) + '</strong><small>' + safe(event.text) + '</small>';
    document.body.append(node); setTimeout(() => node.remove(), 3400);
  }
  /** 걷기 HUD의 '마을 일' 칩에 받을 보상 수를 표시한다(버튼을 새로 만들지 않아 초점을 잃지 않는다). */
  updateBadge(root = this.placeRoot || this.app.hubUI?.root) {
    const chip = root?.querySelector('.town-work-chip'); if (!chip) return;
    const ready = this.content.claimable(), badge = chip.querySelector('.town-work-badge');
    chip.dataset.ready = String(ready);
    chip.setAttribute('aria-label', ready ? '마을 일 열기, 받을 보상 ' + ready + '건' : '마을 일 열기');
    if (badge) { badge.textContent = ready ? String(ready) : ''; badge.hidden = !ready; }
  }
  /** 걷기 HUD의 장소 표시와 마을 지도 버튼. */
  renderPlace(root = this.app.hubUI?.root) {
    const place = root?.querySelector('.citadel-hub-place'); if (!place) return;
    this.placeRoot = root;
    const theme = TOWN_THEMES[this.activeId] || TOWN_THEMES.oathhold;
    place.innerHTML = '<small>' + safe(theme.subtitle) + '</small><div class="town-place-row"><strong>' + safe(theme.name) + '</strong>' +
      '<button type="button" class="town-map-chip" aria-haspopup="dialog" aria-label="마을 이동 지도 열기">이동</button></div><span>' + safe(theme.mood) + '</span>';
    place.style.setProperty('--town-accent', theme.accent);
    place.querySelector('.town-map-chip').addEventListener('click', event => { event.stopPropagation(); this.openMap(event.currentTarget); });
    // 의뢰 게시판 · 필드 · 대장장이 · 마을 이야기는 '마을 일' 칩에서 연다.
    const row = place.querySelector('.town-place-row');
    row.insertAdjacentHTML('beforeend', '<button type="button" class="town-map-chip town-work-chip" aria-haspopup="dialog" aria-label="마을 일 열기">마을 일<b class="town-work-badge" hidden></b></button>');
    place.querySelector('.town-work-chip').addEventListener('click', event => { event.stopPropagation(); this.openContent('dungeons', event.currentTarget); });
    this.updateBadge(root);
  }
  /** 이동석 앞에서 보이는 한 줄 안내. */
  placeName() { return (TOWN_THEMES[this.activeId] || TOWN_THEMES.oathhold).name + ' 광장'; }
  waystoneSummary() {
    const towns = this.towns(), next = towns.find(town => !town.unlocked);
    if (!next) return '세 마을이 모두 열렸습니다. 이동석으로 오가세요.';
    // 던전 수가 다 차도 레벨 조건이 남을 수 있으므로 서비스가 계산한 남은 조건 문구를 우선한다.
    if (next.requirement?.text) return next.name + ' · ' + next.requirement.text;
    return next.name + ' · 던전 ' + (next.progress?.cleared ?? 0) + '/' + (next.progress?.required ?? 0) + ' 클리어';
  }

  // ------------------------------------------------------------ 열고 닫기
  canOpen() {
    const app = this.app;
    return app.mode === 'lobby' && !app.stageStarting && !app.expedition?.s?.pending && !app.expeditionUI?.result?.saveError;
  }
  openMap(trigger) { return this.open('map', trigger); }
  openMerchant(trigger) { return this.open('merchant', trigger); }
  openTrainer(trigger) { return this.open('trainer', trigger); }
  /** 마을 콘텐츠(던전 · 필드 · 의뢰 · 대장장이 · 이야기) 패널. */
  openContent(tab = 'dungeons', trigger) { return this.open(CONTENT_VIEW_IDS.includes(tab) ? tab : 'dungeons', trigger); }
  /** 현재 마을에 팔 물건이 있는지 — 없으면 호출한 쪽이 기존 상점으로 돌아간다. */
  hasMerchant() { return attempt(() => this.service.shop(this.activeId), []).length > 0; }
  hasTrainer() { return attempt(() => this.service.trainer(this.activeId, this.heroId || this.app.eco.s.selected), []).length > 0; }
  open(view, trigger = document.activeElement) {
    if (!this.canOpen()) return false;
    if (view === 'trainer' && !this.heroId) this.heroId = this.app.eco?.s?.selected || HERO_IDS[0];
    this.view = view; this.message = ''; this.tone = '';
    if (this.isContent(view)) this.announce(this.content.checkUnlocks());
    if (this.dialog.open) { this.render(); return true; }
    this.trigger = trigger;
    this.app.hubControls?.clear(); this.app.citadel?.clearInput?.(); this.app.input?.clear?.();
    this.render(); this.dialog.showModal(); this.opened = true;
    (this.dialog.querySelector('.town-close') || this.dialog).focus({ preventScroll: true });
    return true;
  }
  close() { if (this.dialog.open) { this.dialog.close(); this.finishClose(); } }
  finishClose() {
    this.opened = false; this.app.hubControls?.clear(); this.app.citadel?.clearInput?.();
    this.app.syncHub?.();
    const trigger = this.trigger;
    if (this.app.mode !== 'lobby' || this.app.stageStarting || document.querySelector('dialog[open], #modal.show')) return;
    // 걷기 HUD의 마을 이동 칩은 버튼이라 초점이 남으면 E·방향키가 막힌다. 칩에서 연 경우는 월드 캔버스로 되돌린다.
    if (trigger?.classList?.contains('town-map-chip') || !trigger?.isConnected) { if (this.app.hubWalkMode) this.app.canvas?.focus({ preventScroll: true }); return; }
    if (!trigger.disabled && !trigger.closest('[hidden], [inert]') && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ 동작
  act(name, data) {
    if (name === 'close') return this.close();
    if (name === 'travel') return this.travel(data.town);
    if (name === 'buy') return this.buy(data.offer);
    if (name === 'learn') return this.learn(data.offer);
    if (name === 'hero') { this.heroId = data.hero; this.message = ''; return this.render(); }
    if (name === 'view') {
      this.view = data.view; this.message = ''; this.notices = this.notices.filter(notice => notice.tab !== data.view);
      if (this.isContent(data.view)) this.announce(this.content.checkUnlocks());
      return this.render();
    }
    if (name === 'dismiss-notice') { this.notices.splice(Number(data.index), 1); return this.render(); }
    if (this.content.handles(name)) return this.content.act(name, data);
    if (name === 'potions') { const trigger = this.trigger; this.close(); return this.app.citadelShop?.open(trigger); }
    if (name === 'build') { const trigger = this.trigger; this.close(); return this.app.battle?.chronicle?.open('build', trigger); }
  }
  say(text, tone = '') { this.message = text; this.tone = tone; }
  travel(id) {
    const result = attempt(() => this.service.travel(id), { ok: false, reason: '이동할 수 없습니다.' });
    if (!result.ok) { this.say(reason(result, '아직 이동할 수 없는 마을입니다.'), 'error'); audio.play('ui_error', { vol: .35 }); return this.render(); }
    const name = (TOWN_THEMES[id] || {}).name || id;
    this.apply(id); this.app.hubMovement?.reset(); this.app.citadel?.clearInput?.();
    this.say(name + '에 도착했습니다.', 'success'); audio.play('ui_glass', { vol: .4 });
    this.veil();
    this.close();
    this.app.syncHub?.();
  }
  /** 마을을 바꾸는 순간 화면을 잠깐 덮어 장면 교체가 튀지 않게 한다. */
  veil() {
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const theme = TOWN_THEMES[this.activeId] || TOWN_THEMES.oathhold, node = document.createElement('div');
    node.className = 'town-travel-veil'; node.style.setProperty('--town-accent', theme.accent);
    node.innerHTML = '<strong>' + safe(theme.name) + '</strong><small>' + safe(theme.subtitle) + '</small>';
    document.body.append(node); node.addEventListener('animationend', () => node.remove()); setTimeout(() => node.remove(), 1800);
  }
  buy(offerId) {
    const result = attempt(() => this.service.buy(this.activeId, offerId), { ok: false, reason: '구매할 수 없습니다.' });
    // 서비스는 저장만 하므로 상단 재화·물약 HUD 같은 economy 구독자에게 변경을 알린다.
    if (result.ok) this.app.eco?.emit?.();
    this.say(result.ok ? '구매했습니다.' : reason(result, '구매할 수 없습니다.'), result.ok ? 'success' : 'error');
    audio.play(result.ok ? 'ui_glass' : 'ui_error', { vol: .35 }); this.render(offerId, 'buy');
  }
  learn(offerId) {
    const result = attempt(() => this.service.learn(this.activeId, offerId, this.heroId), { ok: false, reason: '배울 수 없습니다.' });
    if (result.ok) this.app.eco?.emit?.();
    this.say(result.ok ? '새 기술을 익혔습니다.' : reason(result, '아직 배울 수 없습니다.'), result.ok ? 'success' : 'error');
    audio.play(result.ok ? 'ui_glass' : 'ui_error', { vol: .35 }); this.render(offerId, 'learn');
  }

  // ------------------------------------------------------------ 화면
  wallet() {
    const materials = attempt(() => this.app.expedition?.snapshot().materials, {});
    return { gold: this.app.eco?.s?.gold || 0, materials };
  }
  priceChips(price, wallet) {
    const p = normalizePrice(price), chips = [];
    if (p.gold || !Object.keys(p.materials).length) chips.push('<span class="town-price' + (wallet.gold < p.gold ? ' is-short' : '') + '"><img src="' + uiArt('gold') + '" alt="">' + fmt(p.gold) + ' 골드</span>');
    for (const [id, amount] of Object.entries(p.materials)) {
      const name = MATERIALS.find(material => material.id === id)?.name || id;
      chips.push('<span class="town-price' + ((wallet.materials?.[id] || 0) < amount ? ' is-short' : '') + '"><img src="' + resourceArt(id) + '" alt="">' + safe(name) + ' ' + fmt(amount) + '</span>');
    }
    return chips.join('');
  }
  affordable(price, wallet) {
    const p = normalizePrice(price);
    return wallet.gold >= p.gold && Object.entries(p.materials).every(([id, amount]) => (wallet.materials?.[id] || 0) >= amount);
  }
  /** 같은 버튼으로 초점을 되돌리며 다시 그린다(구매 직후 키보드 사용자가 길을 잃지 않게). */
  render(focusId, focusKind) {
    const body = this.dialog.querySelector('.town-body'), scroll = body?.scrollTop || 0;
    const town = TOWN_THEMES[this.activeId] || TOWN_THEMES.oathhold;
    const titles = { map: ['마을 이동', 'WAYSTONE'], merchant: [town.name + ' 상인', 'MERCHANT'], trainer: [town.name + ' 스킬 교관', 'TRAINER'],
      ...Object.fromEntries(CONTENT_TABS.map(tab => [tab.id, [tab.title(town.name), tab.eyebrow]])) };
    const [title, eyebrow] = titles[this.view] || titles.map;
    this.dialog.dataset.view = this.view; this.dialog.dataset.town = this.activeId;
    const art = TOWN_ART[this.activeId] || TOWN_ART.oathhold;
    this.dialog.style.setProperty('--town-a', art[0]); this.dialog.style.setProperty('--town-b', art[1]); this.dialog.style.setProperty('--town-accent', town.accent);
    const content = this.isContent() ? this.content.html(this.view) : this.view === 'merchant' ? this.merchantHtml() : this.view === 'trainer' ? this.trainerHtml() : this.mapHtml();
    const footer = this.isContent() ? '<button type="button" data-town-act="view" data-view="map">마을 이동 지도</button>'
      : this.view === 'merchant' ? '<button type="button" data-town-act="potions">전투 물약 보급소</button>'
        : this.view === 'trainer' ? '<button type="button" data-town-act="build">전투 방식 · 스킬 강화</button>'
          : '<span class="town-foot-hint">던전을 클리어하면 다음 마을이 열립니다</span><button type="button" data-town-act="view" data-view="dungeons">마을 일 보기</button>';
    this.dialog.innerHTML = '<div class="town-shell"><header class="town-head"><div><small class="town-eyebrow">' + safe(town.subtitle) + ' · ' + eyebrow + '</small><h2 id="town-dialog-title">' + safe(title) + '</h2></div>' +
      '<button type="button" class="town-close" data-town-act="close">닫기</button></header>' +
      '<div class="town-body" tabindex="-1">' + content + '</div>' +
      '<footer class="town-foot"><p class="town-status" role="status" aria-live="polite" data-tone="' + safe(this.tone) + '">' + safe(this.message) + '</p>' + footer + '</footer></div>';
    const nextBody = this.dialog.querySelector('.town-body'); nextBody.scrollTop = scroll;
    if (focusId) {
      const target = [...this.dialog.querySelectorAll('[data-town-act="' + focusKind + '"]')].find(control => control.dataset.offer === focusId)
        || (this.isContent() ? this.dialog.querySelector('.town-c-tabs [aria-pressed="true"]') : null) || this.dialog.querySelector('.town-close');
      target?.focus({ preventScroll: true });
    }
  }
  dungeonChips(town) {
    return '<ul class="town-gates">' + this.dungeonIds(town).map(id => {
      const dungeon = DUNGEONS.find(entry => entry.id === id), wins = this.wins(id);
      return dungeon ? '<li data-cleared="' + (wins > 0) + '"><span class="town-gate-mark" aria-hidden="true">' + (wins > 0 ? '✓' : '·') + '</span>' + safe(dungeon.name) + '<span class="sr-only">' + (wins > 0 ? ' 클리어' : ' 미클리어') + '</span></li>' : '';
    }).join('') + '</ul>';
  }
  mapHtml() {
    const towns = this.towns();
    return '<p class="town-intro">이동석은 열린 마을끼리 이어 줍니다. 마을마다 상인·교관과 던전 게이트가 다릅니다.</p><ol class="town-map">' + towns.map((town, index) => {
      const theme = TOWN_THEMES[town.id] || TOWN_THEMES.oathhold, art = TOWN_ART[town.id] || TOWN_ART.oathhold, here = town.id === this.activeId;
      const state = here ? 'here' : town.unlocked ? 'open' : 'locked', progress = town.progress || { cleared: 0, required: 0 };
      const percent = progress.required ? Math.min(100, Math.round(progress.cleared / progress.required * 100)) : 100;
      const lock = town.unlocked ? '' : '<div class="town-lock"><div class="town-progress" role="progressbar" aria-label="' + safe(town.name) + ' 해금 진행도" aria-valuemin="0" aria-valuemax="' + progress.required + '" aria-valuenow="' + Math.min(progress.cleared, progress.required) + '"><i style="width:' + percent + '%"></i></div>' +
        '<span class="town-progress-text">' + Math.min(progress.cleared, progress.required) + '/' + progress.required + '</span><p>' + safe(town.requirement?.text || '조건을 확인하세요.') + '</p></div>';
      const label = here ? '현재 위치' : town.unlocked ? '이동하기' : '잠김';
      return '<li class="town-card" data-town="' + safe(town.id) + '" data-state="' + state + '" style="--town-a:' + art[0] + ';--town-b:' + art[1] + '">' +
        '<div class="town-card-art" aria-hidden="true"><i></i><i></i><i></i></div><div class="town-card-copy"><small>제' + (town.tier || index + 1) + '마을 · ' + safe(theme.subtitle) + '</small>' +
        '<h3>' + safe(town.name) + '</h3><p class="town-mood">' + safe(theme.mood) + '</p>' + this.dungeonChips(town) + lock +
        '<button type="button" class="town-go" data-town-act="travel" data-town="' + safe(town.id) + '"' + (state === 'open' ? '' : ' disabled') + '>' + label + '</button></div></li>';
    }).join('') + '</ol>';
  }
  merchantHtml() {
    const offers = attempt(() => this.service.shop(this.activeId), []), wallet = this.wallet();
    const head = '<div class="town-wallet"><span><img src="' + uiArt('gold') + '" alt="">보유 골드</span><strong>' + fmt(wallet.gold) + '</strong></div>';
    if (!offers.length) return head + '<p class="town-empty">이 마을 상인은 아직 물건을 들여오지 않았습니다.</p>';
    const gear = offers.filter(offer => offer.itemId), supply = offers.filter(offer => !offer.itemId);
    const card = offer => {
      const item = offer.itemId ? ITEM_BY_ID[offer.itemId] : null, rarity = offer.rarity || item?.rarity, color = RARITY_COLOR[rarity] || '#f6e7b7';
      const icon = item ? ITEM_ICON(item) : resourceArt(offer.consumableId || offer.id);
      const stats = item ? [item.atk && '공격 +' + fmt(item.atk), item.hp && '체력 +' + fmt(item.hp), item.def && '방어 +' + fmt(item.def)].filter(Boolean).join(' · ') : '';
      const owned = !!offer.owned, soldOut = offer.stockLeft !== undefined && offer.stockLeft <= 0, ok = this.affordable(offer.price, wallet);
      const state = soldOut ? '품절' : owned ? '보유 중' : null;
      return '<article class="town-offer" data-rarity="' + safe(rarity || '') + '" style="--rarity:' + color + '"><img class="town-offer-icon" src="' + safe(icon) + '" alt="" decoding="async">' +
        '<div class="town-offer-copy"><small>' + safe(RARITY_INFO[rarity]?.name || (item ? '장비' : '소모품')) + (offer.stockLeft !== undefined ? ' · 남은 ' + fmt(offer.stockLeft) : '') +
        // 무기·갑옷은 마을 단계에 맞는 외형(1~3단계)을 입는다. 서비스 응답에 없으면 상점 데이터에서 읽는다.
        (tier(offer) ? ' · 외형 ' + tier(offer) + '단계' : '') + '</small>' +
        '<h3>' + safe(offer.name || item?.name || offer.id) + '</h3>' + (stats ? '<p>' + safe(stats) + '</p>' : '') + '<div class="town-prices">' + this.priceChips(offer.price, wallet) + '</div></div>' +
        '<button type="button" class="town-buy" data-town-act="buy" data-offer="' + safe(offer.id) + '"' + (soldOut || !ok ? ' disabled' : '') + '>' + (state || (ok ? '구매' : '부족')) + '</button></article>';
    };
    return head + (gear.length ? '<h3 class="town-section">이 마을의 장비</h3><div class="town-offers">' + gear.map(card).join('') + '</div>' : '') +
      (supply.length ? '<h3 class="town-section">소모품</h3><div class="town-offers">' + supply.map(card).join('') + '</div>' : '');
  }
  trainerHtml() {
    const heroId = HEROES[this.heroId] ? this.heroId : HERO_IDS[0], wallet = this.wallet();
    const offers = attempt(() => this.service.trainer(this.activeId, heroId), []);
    const tabs = '<div class="town-tabs" role="group" aria-label="영웅 선택">' + HERO_IDS.map(id => '<button type="button" data-town-act="hero" data-hero="' + safe(id) + '" aria-pressed="' + (id === heroId) + '"><img src="' + safe(HEROES[id].portrait) + '" alt="">' + safe(HEROES[id].name) + '</button>').join('') + '</div>';
    const head = '<div class="town-wallet"><span><img src="' + uiArt('gold') + '" alt="">보유 골드</span><strong>' + fmt(wallet.gold) + '</strong></div>';
    if (!offers.length) return tabs + head + '<p class="town-empty">' + safe(HEROES[heroId].name) + '에게 가르칠 기술이 아직 준비되지 않았습니다.</p>';
    return tabs + head + '<div class="town-offers town-skills">' + offers.map(offer => {
      const ok = this.affordable(offer.price, wallet), need = requiresText(offer.requires);
      return '<article class="town-offer town-skill" data-learned="' + !!offer.learned + '"><div class="town-skill-sigil" aria-hidden="true">✦</div><div class="town-offer-copy"><small>' + safe(HEROES[heroId].name) + ' 전용 기술</small>' +
        '<h3>' + safe(offer.name) + '</h3><p>' + safe(offer.description || '') + '</p>' + (need ? '<p class="town-need">필요: ' + safe(need) + '</p>' : '') +
        (offer.learned ? '' : '<div class="town-prices">' + this.priceChips(offer.price, wallet) + '</div>') + '</div>' +
        '<button type="button" class="town-buy" data-town-act="learn" data-offer="' + safe(offer.id) + '"' + (offer.learned || !ok ? ' disabled' : '') + '>' + (offer.learned ? '습득 완료' : ok ? '배우기' : '부족') + '</button></article>';
    }).join('') + '</div>';
  }

  destroy() {
    this.close(); this.unsubscribeEco?.(); this.unsubscribeService?.();
    const listeners = this.app.eco?.listeners, index = listeners?.indexOf(this.changeHandler);
    if (index >= 0) listeners.splice(index, 1);
    this.dialog.remove();
  }
}
