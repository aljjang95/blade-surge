import { DUNGEONS, MATERIALS } from '../data/expansion.js';
import { HEROES } from '../data/heroes.js';
import { citadelHotspot } from '../data/citadel-hub.js';
import { dungeonJourney } from './dungeon-journey.js';
import './citadel-command.css';

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

/** 출격·정비는 기존 서비스에 연결하고, 마을 이동은 명시적으로 선택한다. */
export class CitadelCommand {
  constructor(app) {
    this.app = app;
    this.visible = false;
    this.root = element('section', 'citadel-command');
    this.root.id = 'citadel-command';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'citadel-command-title');
    const header = element('header', 'citadel-command-heading');
    const heading = element('div');
    heading.append(element('small', 'citadel-command-kicker', 'BLADE SURGE · ADVENTURE'));
    this.title = element('h1', '', '어디로 떠날까요?');
    this.title.id = 'citadel-command-title';
    heading.append(this.title, element('p', '', '던전을 고르고, 준비를 마친 뒤 출격하세요.'));
    this.explore = action('마을 둘러보기', () => app.setHubWalkMode(true), 'citadel-command-explore');
    this.explore.id = 'citadel-explore';
    header.append(heading, this.explore);
    this.hero = element('div', 'citadel-command-hero');
    this.portrait = element('img');
    this.portrait.alt = '';
    this.heroInfo = element('div');
    this.hero.append(this.portrait, this.heroInfo, action('영웅 · 장비', () => app.meta.openTab('heroes')));
    const destinations = element('nav', 'citadel-command-destinations');
    destinations.setAttribute('aria-label', '모험 선택');
    this.campaign = action('', () => app.meta.openTab('stage', 'campaign'), 'citadel-command-campaign');
    this.campaign.append(element('small', '', 'STORY CAMPAIGN'), element('strong', '', '캠페인'), element('span', '', '다음 이야기를 이어가기'));
    this.nextStory = element('small', 'citadel-command-next');
    this.campaign.append(this.nextStory);
    const arena = action('', () => app.expeditionUI.open('arena'), 'citadel-command-arena');
    arena.append(element('small', '', 'SOLO ARENA'), element('strong', '', '결투장'), element('span', '', 'AI 상대와 무료 연습'));
    this.journey = action('', () => app.expeditionUI.open('dungeons', { depth: 'standard' }), 'citadel-command-journey');
    this.journey.id = 'citadel-dungeon-journey';
    this.journeyArt = element('img'); this.journeyArt.alt = '';
    this.journeyName = element('strong'); this.journeyStatus = element('span');
    const journeyCopy = element('div'); journeyCopy.append(element('small', '', 'Lv.1부터 이어지는 던전 여정'), this.journeyName, this.journeyStatus);
    this.journey.append(this.journeyArt, journeyCopy);
    const fields = action('', () => app.expeditionUI.open('dungeons', { depth: 'fields' }), 'citadel-command-arena');
    fields.id = 'citadel-command-fields';
    fields.append(element('small', '', 'OPEN FIELD'), element('strong', '', '야외 필드'), element('span', '', '초원 · 해안 · 산길 · 도시'));
    destinations.append(this.journey, this.campaign, fields, arena);
    const tools = element('nav', 'citadel-command-tools');
    tools.setAttribute('aria-label', '출격 전 정비');
    this.supply = action('보급 상점', button => app.citadelShop.open(button));
    this.supply.id = 'citadel-command-supply';
    tools.append(this.supply,
      action('제작 공방', () => app.expeditionUI.open('forge')),
      action('성장 · 전투 방식', button => app.battle?.chronicle?.open('build', button)),
      action('상점 · 교환', () => app.meta.openTab('shop')),
      action('동행', button => this.openCompanion(button)));
    const routes = element('section', 'citadel-command-routes');
    routes.setAttribute('aria-labelledby', 'citadel-command-routes-title');
    const routeHeader = element('div', 'citadel-command-route-heading');
    const routeTitle = element('h2', '', '던전 게이트');
    routeTitle.id = 'citadel-command-routes-title';
    this.routeSummary = element('span');
    routeHeader.append(routeTitle, this.routeSummary);
    const grid = element('div', 'citadel-command-grid');
    this.cards = new Map();
    for (const dungeon of DUNGEONS) {
      const spot = citadelHotspot(`dungeon:${dungeon.id}`);
      const card = action('', button => {
        if (app.mode !== 'lobby' || app.stageStarting || app.expeditionUI.opened) return;
        app.citadel.clearInput();
        app.hubUI.openDestination(spot, button);
      }, 'citadel-command-route');
      card.dataset.commandRoute = dungeon.id;
      card.style.setProperty('--route-accent', dungeon.accent);
      const image = element('img', 'citadel-command-art');
      image.src = dungeon.art;
      image.alt = '';
      image.loading = 'lazy';
      const content = element('div', 'citadel-command-route-copy');
      const reward = Object.keys(dungeon.rewards.materials).map(id => MATERIALS.find(material => material.id === id)?.name).filter(Boolean).join(' · ');
      const status = element('span', 'citadel-command-route-status');
      content.append(element('small', '', dungeon.subtitle), element('h3', '', dungeon.name), element('span', 'citadel-command-reward', `${reward} · 에너지 ${dungeon.energy}`), status);
      card.append(image, content);
      grid.append(card);
      this.cards.set(dungeon.id, { card, status });
    }
    routes.append(routeHeader, element('p', 'citadel-command-route-help', '게이트를 선택하면 기본·심층 원정의 조건, 보상과 전투 준비를 확인합니다.'), grid);
    this.root.append(header, this.hero, destinations, tools, routes);
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
}
