import { HEROES } from '../data/heroes.js';
import { citadelHotspot } from '../data/citadel-hub.js';
import { dungeonLanding } from './dungeon-landing.js';
import './dungeon-lobby.css';
import './lobby-carousel.css';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className || '';
  if (text) node.textContent = text;
  return node;
};
const action = (label, callback, className = '') => {
  const button = element('button', className, label);
  button.type = 'button';
  button.addEventListener('click', () => callback(button));
  return button;
};
const fmt = (value) => Number(value || 0).toLocaleString('ko-KR');
// 정적 마크업만 쓰는 장식 아이콘. 읽기 이름은 버튼의 aria-label 이 맡는다.
const icon = (markup) => { const holder = document.createElement('template'); holder.innerHTML = markup; return holder.content.firstElementChild; };
const BOLT = '<svg class="dl-ico dl-ico-bolt" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.6 1.8 4.8 13.6h5.9l-1.4 8.6 9.9-12.5h-6z"/></svg>';
const LOCK = '<svg class="dl-ico dl-ico-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V8a5 5 0 0 1 10 0v2h1.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10zm2 0h6V8a3 3 0 0 0-6 0z"/></svg>';
const NEXT = '<svg class="dl-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 4 8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SWORDS = '<svg class="dl-swords" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g fill="#fbe39a" stroke="#6a4210" stroke-width="2" stroke-linejoin="round"><g transform="rotate(42 32 34)"><path d="M32 3l5.5 8.5V37h-11V11.5z"/><path d="M20 37h24v5.5H20z"/><path d="M29.2 42.5h5.6V56h-5.6z"/><circle cx="32" cy="58.5" r="3.2"/></g><g transform="rotate(-42 32 34)"><path d="M32 3l5.5 8.5V37h-11V11.5z"/><path d="M20 37h24v5.5H20z"/><path d="M29.2 42.5h5.6V56h-5.6z"/><circle cx="32" cy="58.5" r="3.2"/></g></g></svg>';
// 잠금 사유('탐험 레벨 2 필요')에서 카드에 넣을 짧은 조건만 뽑는다. 전체 문장은 상세와 읽기 이름에 남는다.
const shortLock = (reason) => { const level = /레벨\s*(\d+)/.exec(reason || ''); return level ? `Lv.${level[1]}` : '잠김'; };
/** 로비 카드(약 90px)는 원화(1672px) 대신 320px 썸네일을 쓴다. 상세 패널은 원화를 그대로 쓴다. */
export const cardThumb = (art) => typeof art === 'string' && /^\/img\/expansion\/[^/]+\.webp$/.test(art) ? art.replace('/img/expansion/', '/img/expansion/thumb/') : art;
export const CITADEL_COMMAND_COLLAPSED_KEY = 'blade-surge.citadel-command.collapsed';
// 예전 접힘 저장값은 읽기만 호환한다. 새 착지 화면은 접지 않으며 이 값을 지우지 않는다.
// 저장 공간 접근 자체가 거부되는 브라우저(사이트 데이터 차단)는 localStorage getter 가 예외를 던진다.
export function readCitadelCommandCollapsed(storage) {
  try { return (storage === undefined ? globalThis.localStorage : storage)?.getItem(CITADEL_COMMAND_COLLAPSED_KEY) === 'true'; } catch { return false; }
}
export function writeCitadelCommandCollapsed(collapsed, storage) {
  try { (storage === undefined ? globalThis.localStorage : storage)?.setItem(CITADEL_COMMAND_COLLAPSED_KEY, String(!!collapsed)); } catch {}
}

/**
 * 던전 우선 로비. 기본 화면에는 추천/최근 던전 하나와 단일 '출격 준비'만 둔다.
 * 출격 준비는 해당 던전·단계의 기존 준비창(CitadelHubUI)을 열고, 에너지는 준비창의 최종 버튼만 쓴다.
 * 캠페인·필드·보급·공방·의뢰·동행은 menuEntries 로 넘겨 메뉴 안의 보조 입구가 된다.
 */
export class CitadelCommand {
  constructor(app) {
    this.app = app;
    this.visible = false;
    this.model = null;
    // 카드로 고른 던전. 추천 던전이 바뀌면 readModel 이 비운다.
    this.selectedId = null;
    this.lastRecommendedId = null;
    this.cardViews = new Map();
    this.shownCardId = null;
    this.root = element('section', 'dl-landing');
    this.root.id = 'citadel-command';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'citadel-command-title');

    const head = element('header', 'dl-head');
    this.reason = element('span', 'dl-reason');
    this.progress = element('span', 'dl-progress');
    head.append(this.reason, this.progress);

    this.card = element('div', 'dl-card');
    this.art = element('img', 'dl-art');
    this.art.alt = '';
    this.art.decoding = 'async';
    const copy = element('div', 'dl-copy');
    this.title = element('h1', 'dl-name');
    this.title.id = 'citadel-command-title';
    this.depth = element('p', 'dl-depth');
    this.description = element('p', 'dl-desc');
    copy.append(this.title, this.depth, this.description);
    this.card.append(this.art, copy);

    const facts = element('dl', 'dl-facts');
    const fact = (label) => { const wrap = element('div', 'dl-fact'); const value = element('dd'); wrap.append(element('dt', '', label), value); facts.append(wrap); return { wrap, value }; };
    this.costFact = fact('입장 에너지');
    this.rewardFact = fact('주요 보상');
    this.status = element('p', 'dl-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    // 오른쪽 아래 모서리의 큰 원형 출격 버튼. 누르면 선택한 던전의 기존 준비창을 연다.
    this.prepare = action('', (button) => this.openPreparation(button), 'dl-cta citadel-command-quick-launch');
    this.prepare.id = 'citadel-dungeon-prepare';
    this.prepareLabel = element('span', 'dl-cta-label', '출격');
    this.prepareCost = element('small', 'dl-cta-cost');
    this.prepare.append(icon(SWORDS), this.prepareLabel, this.prepareCost);
    // main.js 의 기존 참조 이름. 이제 같은 단일 CTA 를 가리킨다.
    this.quickLaunch = this.prepare;

    const links = element('div', 'dl-links');
    this.otherDungeons = action('', () => this.openDungeonList(), 'dl-link');
    this.otherDungeons.id = 'citadel-other-dungeons';
    this.explore = action('마을 둘러보기', () => app.setHubWalkMode(true), 'dl-link');
    this.explore.id = 'citadel-explore';
    links.append(this.otherDungeons, this.explore);

    this.hero = element('p', 'dl-hero');

    // 설명 영역만 내부 스크롤한다. 출격 준비 버튼과 비용은 짧은 가로 화면에서도 항상 보인다.
    const body = element('div', 'dl-body');
    body.append(this.card, facts, this.status);
    // 오른쪽 위: 선택한 던전 상세. 오른쪽 아래: 가로 카드 줄과 원형 출격 버튼. 영웅이 서는 왼쪽 가운데는 비워 둔다.
    this.panel = element('div', 'dl-panel');
    this.panel.append(head, body, this.hero);
    this.cards = element('div', 'dl-cards');
    this.cards.setAttribute('role', 'group');
    this.cards.setAttribute('aria-label', '던전 선택');
    this.cards.addEventListener('scroll', () => this.syncNext(), { passive: true });
    this.next = action('', () => this.scrollCards(), 'dl-next');
    this.next.setAttribute('aria-label', '던전 카드 더 보기');
    this.next.append(icon(NEXT));
    const bar = element('div', 'dl-cards-bar');
    bar.append(this.cards, this.next);
    this.dock = element('div', 'dl-dock');
    this.dock.append(bar, this.prepare);
    this.root.append(this.panel, links, this.dock);
    document.getElementById('tab-home').append(this.root);

    this.returnButton = action('← 출격 메뉴로', () => app.setHubWalkMode(false), 'citadel-command-return');
    this.returnButton.id = 'citadel-command-return';
    this.returnButton.hidden = true;
    document.getElementById('tab-home').append(this.returnButton);

    this.menuEntries = this.buildMenuEntries();
    app.eco.onChange(() => { if (this.visible) this.refresh(); });
  }

  /** 기본 화면에서 뺀 보조 입구. 메뉴(OathShell)가 묶음에 배치한다. 결투장은 기본 솔로 로비에서 노출하지 않는다. */
  buildMenuEntries() {
    const app = this.app;
    const entry = (id, label, callback) => { const button = action(label, callback, 'menu-entry'); button.id = id; button.dataset.menuKey = id; return button; };
    const supply = entry('citadel-command-supply', '보급 상점', (button) => app.citadelShop.open(button));
    return [
      entry('menu-fields', '야외 필드', () => app.expeditionUI.open('dungeons', { depth: 'fields' })),
      supply,
      entry('menu-forge', '제작 공방', () => app.expeditionUI.open('forge')),
      entry('menu-town-quests', '마을 의뢰', (button) => app.townUI?.openContent('quests', button)),
      entry('menu-companion', '동행', (button) => this.openCompanion(button)),
    ];
  }

  readModel() {
    const { eco, expedition } = this.app;
    const read = () => dungeonLanding({ expedition, history: eco.s.masterworks?.history, energy: eco.s.energy, selectedId: this.selectedId });
    let model = read();
    // 추천 던전이 바뀌면(클리어·최근 원정 갱신) 이전 선택을 버리고 새 추천을 보여 준다.
    if (model.recommendedId !== this.lastRecommendedId) {
      const changed = this.lastRecommendedId !== null;
      this.lastRecommendedId = model.recommendedId;
      if (changed && this.selectedId) { this.selectedId = null; model = read(); }
    }
    return model;
  }

  /** 카드를 눌러 던전을 고른다. 상세만 바뀌고 저장·에너지는 건드리지 않는다. */
  select(id) {
    this.selectedId = id;
    this.refresh();
  }

  ensureCards(cards) {
    if (this.cardViews.size) return;
    for (const card of cards) {
      const button = element('button', 'dl-pick');
      button.type = 'button';
      button.dataset.dungeonId = card.id;
      const art = element('img', 'dl-pick-art');
      art.alt = ''; art.decoding = 'async'; art.loading = 'lazy'; art.draggable = false;
      const name = element('span', 'dl-pick-name');
      const meta = element('span', 'dl-pick-meta');
      const text = element('span', 'dl-pick-cost');
      meta.append(icon(BOLT), icon(LOCK), text);
      button.append(art, name, meta);
      button.addEventListener('click', () => this.select(card.id));
      this.cards.append(button);
      this.cardViews.set(card.id, { button, art, name, text });
    }
  }

  updateCards(model) {
    this.ensureCards(model.cards);
    for (const card of model.cards) {
      const view = this.cardViews.get(card.id);
      if (!view) continue;
      const { button } = view;
      const thumb = cardThumb(card.art);
      if (view.art.getAttribute('src') !== thumb) view.art.src = thumb;
      if (view.name.textContent !== card.name) view.name.textContent = card.name;
      const cost = card.unlocked ? String(card.cost) : shortLock(card.lockReason);
      if (view.text.textContent !== cost) view.text.textContent = cost;
      const selected = String(card.id === model.selectedId), locked = String(!card.unlocked);
      if (button.getAttribute('aria-pressed') !== selected) button.setAttribute('aria-pressed', selected);
      if (button.dataset.locked !== locked) button.dataset.locked = locked;
      button.style.setProperty('--pick-accent', card.accent);
      const label = `${card.name}, 입장 에너지 ${card.cost}${card.unlocked ? '' : `, 잠김: ${card.lockReason}`}`;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    }
    // 선택이 바뀐 직후에만 가려진 카드를 줄 안으로 가져온다. 사용자가 넘겨 둔 위치는 그대로 둔다.
    if (this.shownCardId !== model.selectedId) {
      this.shownCardId = model.selectedId;
      const view = this.cardViews.get(model.selectedId), list = this.cards;
      if (view && list.clientWidth) {
        const { offsetLeft: left, offsetWidth: width } = view.button;
        if (left < list.scrollLeft || left + width > list.scrollLeft + list.clientWidth) list.scrollTo({ left: Math.max(0, left - (list.clientWidth - width) / 2), behavior: 'auto' });
      }
    }
    this.syncNext();
  }

  /** 오른쪽 화살표: 줄 끝에서는 처음으로 돌아가는 방향으로 바뀐다. */
  scrollCards() {
    const list = this.cards, max = list.scrollWidth - list.clientWidth;
    const atEnd = list.scrollLeft >= max - 4;
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ left: atEnd ? 0 : Math.min(max, list.scrollLeft + list.clientWidth * 0.8), behavior: reduce ? 'auto' : 'smooth' });
  }

  syncNext() {
    const list = this.cards, max = list.scrollWidth - list.clientWidth;
    this.next.dataset.end = String(list.scrollLeft >= max - 4);
    this.next.hidden = max <= 4 && list.clientWidth > 0;
  }

  refresh() {
    const { eco } = this.app;
    const model = this.model = this.readModel();
    this.updateCards(model);
    this.root.dataset.reason = model.reason;
    this.reason.textContent = model.outcome ? `${model.label} · ${model.outcome === 'victory' ? '승리' : '패배'}` : model.label;
    this.progress.textContent = `정복 ${model.cleared}/${model.total}`;
    this.otherDungeons.textContent = `다른 던전 ${model.open}/${model.total}`;
    this.otherDungeons.setAttribute('aria-label', `다른 던전 보기, 개방 ${model.open}개 / 전체 ${model.total}개`);
    const hero = HEROES[eco.s.selected];
    this.hero.textContent = hero ? `출전 ${hero.name} · Lv.${eco.hero().level} · 전투력 ${fmt(eco.heroPower(eco.s.selected))}` : '';
    if (!model.dungeon) {
      this.title.textContent = '열린 던전이 없습니다';
      this.depth.textContent = ''; this.description.textContent = '';
      this.art.hidden = true;
      this.costFact.value.textContent = '-'; this.rewardFact.value.textContent = '-';
      this.status.textContent = model.notice || '탐험 레벨을 올리면 던전이 열립니다.';
      this.prepare.disabled = true; this.prepareCost.textContent = '';
      this.prepare.setAttribute('aria-label', '출격 준비, 열린 던전 없음');
      return;
    }
    this.root.style.setProperty('--route-accent', model.accent);
    this.art.hidden = false;
    if (this.art.getAttribute('src') !== model.art) this.art.src = model.art;
    this.title.textContent = model.name;
    this.depth.textContent = model.depthLabel + (model.wins ? ` · 클리어 ${model.wins}회` : model.outcome ? ' · 아직 클리어 전' : ' · 첫 도전');
    this.description.textContent = model.description;
    this.costFact.value.textContent = model.energy === null ? `${model.cost}` : `${model.cost} / 보유 ${model.energy}`;
    this.costFact.wrap.dataset.short = String(!model.enoughEnergy);
    this.rewardFact.value.textContent = model.rewards.map((reward) => `${reward.name} ×${reward.amount}`).join(' · ') || '-';
    // 조건이 부족해도 준비창은 열어 내용을 읽을 수 있다. 최종 입장만 기존 판정이 막는다.
    const blocked = !model.unlocked ? model.lockReason : !model.enoughEnergy ? `에너지가 부족합니다. 준비 내용은 볼 수 있습니다.` : '';
    // aria-live는 값이 바뀔 때만 다시 읽히도록 같은 문장은 다시 쓰지 않는다.
    const statusText = [model.notice, blocked].filter(Boolean).join(' ');
    if (this.status.textContent !== statusText) this.status.textContent = statusText;
    this.status.dataset.blocked = String(!!blocked);
    this.prepare.disabled = false;
    this.prepare.dataset.locked = String(!model.unlocked);
    this.prepareCost.textContent = `에너지 ${model.cost}`;
    this.prepare.setAttribute('aria-label', `${model.name} ${model.depthLabel} 출격 준비 열기, 입장 에너지 ${model.cost}${blocked ? `, ${blocked}` : ''}`);
  }

  /** 추천 던전의 기존 준비창을 연다. 다른 탭에서 불러도 던전 화면으로 돌아와 같은 준비창을 연다. */
  openPreparation(trigger = this.prepare) {
    const app = this.app;
    if (app.mode !== 'lobby' || app.stageStarting || app.expeditionUI?.result?.saveError) return false;
    if (app.meta.tab !== 'home') app.meta.openTab('home');
    app.syncHub?.();
    const model = this.readModel();
    if (!model.dungeon) return false;
    const spot = citadelHotspot(`dungeon:${model.dungeon.id}`);
    if (!spot) {
      // 관문 없는 컨셉 원정도 홈의 최근 도전에서 바로 그 카드로 이어진다. 준비 화면 이동은 에너지를 쓰지 않는다.
      app.expeditionUI.focusDungeon = { id: model.dungeon.id, depth: model.depth };
      app.expeditionUI.open('dungeons', { depth: model.depth }); return true;
    }
    app.citadel?.clearInput?.();
    // 준비창을 닫으면 이 화면의 출격 준비 버튼으로 초점이 돌아온다.
    return app.hubUI.openDestination(spot, trigger?.isConnected && trigger.closest?.('#tab-home') ? trigger : this.prepare, { depth: model.depth });
  }

  openDungeonList() {
    const depth = this.model?.depth === 'deep' ? 'deep' : 'standard';
    this.app.expeditionUI.open('dungeons', { depth });
  }

  openCompanion(button) {
    const director = this.app.companionAgent;
    const launcher = document.querySelector('.companion-launcher');
    if (!director || !launcher || this.app.mode !== 'lobby' || this.app.stageStarting) return;
    this.companionTrigger = button;
    if (!this.companionUnsubscribe) {
      let wasOpen = director.getSnapshot().open;
      this.companionUnsubscribe = director.subscribe(() => {
        const open = director.getSnapshot().open;
        if (wasOpen && !open) requestAnimationFrame(() => {
          this.app.syncHub();
          if (this.visible && !document.querySelector('dialog[open], #modal.show')) this.prepare.focus({ preventScroll: true });
        });
        wasOpen = open;
      });
    }
    launcher.click();
  }

  setVisible(visible, exploring = false) {
    // syncHub 는 매 프레임 불린다. 표시가 바뀔 때만 다시 그리고, 그 밖의 갱신은 저장 변경(onChange)이 맡는다.
    if (this.visible !== visible) {
      this.visible = visible;
      this.root.hidden = !visible;
      if (visible) this.refresh();
    }
    this.returnButton.hidden = !exploring;
  }
}
