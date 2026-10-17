import { HEROES } from '../data/heroes.js';
import { citadelHotspot } from '../data/citadel-hub.js';
import { dungeonLanding } from './dungeon-landing.js';
import './dungeon-lobby.css';

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

    this.prepare = action('', (button) => this.openPreparation(button), 'dl-cta citadel-command-quick-launch');
    this.prepare.id = 'citadel-dungeon-prepare';
    this.prepareLabel = element('span', 'dl-cta-label', '출격 준비');
    this.prepareCost = element('small', 'dl-cta-cost');
    this.prepare.append(this.prepareLabel, this.prepareCost);
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
    this.root.append(head, body, this.prepare, links, this.hero);
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
    return dungeonLanding({ expedition, history: eco.s.masterworks?.history, energy: eco.s.energy });
  }

  refresh() {
    const { eco } = this.app;
    const model = this.model = this.readModel();
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
