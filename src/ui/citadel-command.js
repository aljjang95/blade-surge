import { ALL_DUNGEONS as DUNGEONS, MATERIALS } from '../data/expansion.js';
import { HEROES } from '../data/heroes.js';
import { citadelHotspot } from '../data/citadel-hub.js';
import { dungeonJourney } from './dungeon-journey.js';
import './citadel-command.css';
import './maple-command.css';

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
export const CITADEL_COMMAND_COLLAPSED_KEY = 'blade-surge.citadel-command.collapsed';
export function readCitadelCommandCollapsed(storage = globalThis.localStorage) {
  try { return storage?.getItem(CITADEL_COMMAND_COLLAPSED_KEY) === 'true'; } catch { return false; }
}
export function writeCitadelCommandCollapsed(collapsed, storage = globalThis.localStorage) {
  try { storage?.setItem(CITADEL_COMMAND_COLLAPSED_KEY, String(!!collapsed)); } catch {}
}

/** 출격·정비는 기존 서비스에 연결하고, 마을 이동은 명시적으로 선택한다. */
export class CitadelCommand {
  constructor(app) {
    this.app = app;
    this.visible = false;
    this.collapsed = readCitadelCommandCollapsed();
    // 메이플식 작은 창: 제목줄 + 다음 모험 한 줄 + 모드 버튼 + 탭(던전 게이트 / 마을 정비).
    // 예전 크림색 대형 패널의 컨테이너 클래스는 쓰지 않는다(그 스타일이 남지 않도록). 버튼 객체·id·동작은 그대로다.
    this.root = element('section', 'mpl-command');
    this.root.id = 'citadel-command';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'citadel-command-title');
    const header = element('header', 'mpl-cmd-title');
    const icon = element('img', 'mpl-cmd-icon'); icon.src = '/img/ui-crafted/nav-dungeon.webp'; icon.alt = '';
    this.title = element('h1', 'mpl-cmd-title-text', '모험 안내');
    this.title.id = 'citadel-command-title';
    this.explore = action('마을 둘러보기', () => app.setHubWalkMode(true), 'mpl-cmd-explore');
    this.explore.id = 'citadel-explore';
    this.quickLaunch = action('출격', () => app.expeditionUI.open('dungeons', { depth: 'standard' }), 'citadel-command-quick-launch mpl-cmd-quick');
    this.collapseToggle = action('', () => this.setCollapsed(!this.collapsed), 'citadel-command-collapse mpl-cmd-min');
    this.collapseToggle.setAttribute('aria-controls', 'citadel-command');
    this.collapseToggle.setAttribute('aria-expanded', String(!this.collapsed));
    header.append(icon, this.title, this.quickLaunch, this.explore, this.collapseToggle);
    const body = element('div', 'mpl-cmd-body');
    // 다음 모험: 지금 이어갈 던전 여정과 가장 눈에 띄는 출격 버튼.
    const next = element('div', 'mpl-cmd-next');
    this.journey = action('', () => app.expeditionUI.open('dungeons', { depth: 'standard' }), 'mpl-cmd-journey');
    this.journey.id = 'citadel-dungeon-journey';
    this.journeyArt = element('img'); this.journeyArt.alt = '';
    this.journeyName = element('strong'); this.journeyStatus = element('span');
    const journeyCopy = element('div'); journeyCopy.append(element('small', '', '다음 던전 여정'), this.journeyName, this.journeyStatus);
    this.journey.append(this.journeyArt, journeyCopy);
    this.go = action('출격', () => app.expeditionUI.open('dungeons', { depth: 'standard' }), 'mpl-cmd-go');
    next.append(this.journey, this.go);
    this.hero = element('div', 'mpl-cmd-hero');
    this.portrait = element('img');
    this.portrait.alt = '';
    this.heroInfo = element('div');
    this.hero.append(this.portrait, this.heroInfo, action('영웅 · 장비', () => app.meta.openTab('heroes'), 'mpl-cmd-link'));
    const modes = element('nav', 'mpl-cmd-modes');
    modes.setAttribute('aria-label', '모험 선택');
    this.campaign = action('', () => app.meta.openTab('stage', 'campaign'), 'citadel-command-campaign mpl-cmd-mode');
    this.nextStory = element('small', 'mpl-cmd-mode-sub');
    this.campaign.append(element('strong', '', '캠페인'), this.nextStory);
    const fields = action('', () => app.expeditionUI.open('dungeons', { depth: 'fields' }), 'mpl-cmd-mode');
    fields.id = 'citadel-command-fields';
    fields.append(element('strong', '', '야외 필드'), element('small', 'mpl-cmd-mode-sub', '초원 · 해안 · 산길'));
    const arena = action('', () => app.expeditionUI.open('arena'), 'mpl-cmd-mode');
    arena.append(element('strong', '', '결투장'), element('small', 'mpl-cmd-mode-sub', 'AI 무료 연습'));
    modes.append(this.campaign, fields, arena);
    // 탭: 던전 게이트(기본) / 마을 정비.
    const tabs = element('div', 'mpl-cmd-tabs');
    tabs.setAttribute('role', 'tablist');
    this.panes = {};
    this.tabButtons = {};
    const tab = (id, label) => {
      const button = action(label, () => this.showPane(id), 'mpl-cmd-tab');
      button.setAttribute('role', 'tab'); button.id = `citadel-command-tab-${id}`;
      button.setAttribute('aria-controls', `citadel-command-pane-${id}`);
      this.tabButtons[id] = button; tabs.append(button);
      return button;
    };
    const pane = (id) => {
      const node = element('section', 'mpl-cmd-pane');
      node.id = `citadel-command-pane-${id}`; node.setAttribute('role', 'tabpanel');
      node.setAttribute('aria-labelledby', `citadel-command-tab-${id}`);
      this.panes[id] = node; return node;
    };
    this.routeTab = tab('routes', '던전 게이트');
    tab('tools', '마을 정비');
    const routes = pane('routes');
    this.routeSummary = element('p', 'mpl-cmd-route-summary');
    const list = element('div', 'mpl-cmd-routes');
    this.cards = new Map();
    for (const dungeon of DUNGEONS) {
      const spot = citadelHotspot(`dungeon:${dungeon.id}`);
      const card = action('', button => {
        if (app.mode !== 'lobby' || app.stageStarting || app.expeditionUI.opened) return;
        app.citadel.clearInput();
        if (spot) app.hubUI.openDestination(spot, button); else app.townUI?.openContent('dungeons', button);
      }, 'mpl-cmd-route');
      card.dataset.commandRoute = dungeon.id;
      card.style.setProperty('--route-accent', dungeon.accent);
      const image = element('img', 'mpl-cmd-route-art');
      image.src = dungeon.art;
      image.alt = '';
      image.loading = 'lazy';
      const content = element('div', 'mpl-cmd-route-copy');
      const reward = Object.keys(dungeon.rewards.materials).map(id => MATERIALS.find(material => material.id === id)?.name).filter(Boolean).join(' · ');
      const status = element('span', 'mpl-cmd-route-status');
      content.append(element('strong', '', dungeon.name), element('small', '', `${reward} · 에너지 ${dungeon.energy}`));
      card.append(image, content, status);
      list.append(card);
      this.cards.set(dungeon.id, { card, status });
    }
    routes.append(this.routeSummary, list);
    const tools = pane('tools');
    this.supply = action('보급 상점', button => app.citadelShop.open(button), 'mpl-cmd-row');
    this.supply.id = 'citadel-command-supply';
    tools.append(this.supply,
      action('제작 공방', () => app.expeditionUI.open('forge'), 'mpl-cmd-row'),
      action('마을 일 · 의뢰', button => app.townUI?.openContent('quests', button), 'mpl-cmd-row'),
      action('성장 · 전투 방식', button => app.battle?.chronicle?.open('build', button), 'mpl-cmd-row'),
      action('상점 · 교환', () => app.meta.openTab('shop'), 'mpl-cmd-row'),
      action('동행', button => this.openCompanion(button), 'mpl-cmd-row'));
    body.append(next, this.hero, modes, tabs, routes, tools);
    this.root.append(header, body);
    this.showPane('routes');
    this.root.dataset.collapsed = String(this.collapsed);
    this.setCollapsed(this.collapsed);
    document.getElementById('tab-home').append(this.root);
    this.returnButton = action('← 출격 메뉴로', () => app.setHubWalkMode(false), 'citadel-command-return');
    this.returnButton.id = 'citadel-command-return';
    this.returnButton.hidden = true;
    document.getElementById('tab-home').append(this.returnButton);
    app.eco.onChange(() => { if (this.visible) this.refresh(); });
  }

  refresh() {
    const { eco, expedition } = this.app;
    const hero = HEROES[eco.s.selected];
    this.portrait.src = hero.portrait;
    this.heroInfo.replaceChildren(element('strong', '', hero.name), element('span', '', `영웅 Lv.${eco.hero().level} · 전투력 ${eco.heroPower(eco.s.selected).toLocaleString()}`));
    const next = eco.nextStage();
    this.nextStory.textContent = next.name;
    const journey = dungeonJourney(expedition);
    if (journey.current) {
      this.journeyArt.src = journey.current.dungeon.art;
      this.journeyName.textContent = journey.current.dungeon.name;
      this.journeyStatus.textContent = `원정 Lv.${expedition.s.level} · ${journey.cleared}/${journey.nodes.length} 정복 · 여정 지도 보기 →`;
    }
    let ready = 0;
    for (const dungeon of DUNGEONS) {
      const access = expedition.dungeonAccess(dungeon.id, { depth: 'standard' });
      const { card, status } = this.cards.get(dungeon.id);
      card.dataset.locked = String(!access.ok);
      status.textContent = access.ok ? '출격 준비 →' : access.error;
      card.setAttribute('aria-label', `${dungeon.name}, 기본 원정 에너지 ${dungeon.energy}, ${access.ok ? '출격 준비 열기' : `${access.error}, 조건 확인 열기`}`);
      if (access.ok) ready++;
    }
    this.routeSummary.textContent = `탐험 Lv.${expedition.s.level} · 개방 ${ready}/${DUNGEONS.length}`;
    this.routeTab.textContent = `던전 게이트 ${ready}/${DUNGEONS.length}`;
  }

  /** 탭 전환. 다른 패널은 hidden 으로 숨긴다(던전 게이트가 기본). @param {'routes'|'tools'} id */
  showPane(id) {
    for (const [key, node] of Object.entries(this.panes)) {
      const on = key === id;
      node.hidden = !on;
      this.tabButtons[key].setAttribute('aria-selected', String(on));
      this.tabButtons[key].tabIndex = on ? 0 : -1;
    }
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
          if (this.visible && !document.querySelector('dialog[open], #modal.show')) this.companionTrigger?.focus({ preventScroll: true });
        });
        wasOpen = open;
      });
    }
    launcher.click();
  }

  setVisible(visible, exploring = false) {
    if (this.visible !== visible) {
      this.visible = visible;
      this.root.hidden = !visible;
      if (visible) this.refresh();
    }
    this.returnButton.hidden = !exploring;
  }

  setCollapsed(collapsed) {
    this.collapsed = !!collapsed;
    this.root.dataset.collapsed = String(this.collapsed);
    this.collapseToggle.textContent = this.collapsed ? '+' : '–';
    this.collapseToggle.setAttribute('aria-label', this.collapsed ? '패널 펼치기' : '패널 접기');
    this.collapseToggle.setAttribute('aria-expanded', String(!this.collapsed));
    writeCitadelCommandCollapsed(this.collapsed);
  }
}
