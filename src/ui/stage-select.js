// 스테이지 선택 화면. 로비의 '출격'을 누르면 열리고, 캠페인 관문 또는 던전·단계를 고른 뒤 '입장' 하나로 들어간다.
// 열기·닫기·ESC·탭 전환·고르기는 저장·에너지를 건드리지 않는다. 입장만 기존 서비스(startStage / 준비창)를 부르고,
// 에너지는 그 서비스 한 곳에서 1회만 쓴다(캠페인 = startStage, 던전 = 준비창의 '원정 시작').
import { stageDef } from '../data/stages.js';
import { HEROES } from '../data/heroes.js';
import { citadelHotspot } from '../data/citadel-hub.js';
import { DEFAULT_STAGE_NODES, stageMapFor, layoutStageMap, fitStageMapBox } from '../data/stage-select-maps.js';
import { cardThumb } from './citadel-command.js';
import {
  stageSelectModel, selectedEntry, entryAction, isRecommendedSelection, readStageSelectMemory, writeStageSelectMemory, refreshStageSelectMemory,
} from '../game/stage-select-model.js';
import './stage-select.css';

const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};
const button = (label, callback, className = '') => {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', () => callback(element));
  return element;
};
const fmt = (value) => Number(value || 0).toLocaleString('ko-KR');
const sameSelection = (a, b) => !!a && !!b && a.tab === b.tab && (a.tab === 'campaign' ? a.ch === b.ch && a.st === b.st : a.id === b.id && a.depth === b.depth);
const LOCK = '<svg class="ss-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V8a5 5 0 0 1 10 0v2h1.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10zm2 0h6V8a3 3 0 0 0-6 0z"/></svg>';
const BOLT = '<svg class="ss-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.6 1.8 4.8 13.6h5.9l-1.4 8.6 9.9-12.5h-6z"/></svg>';
const SKULL = '<svg class="ss-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2C6.9 2 3 5.6 3 10.4c0 2.7 1.3 4.9 3.3 6.3V20a1 1 0 0 0 1 1h1.4v-2h1.6v2h3.4v-2h1.6v2h1.4a1 1 0 0 0 1-1v-3.3c2-1.4 3.3-3.6 3.3-6.3C21 5.6 17.1 2 12 2zm-3.5 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>';
const CROWN = '<svg class="ss-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>';
const SWORDS = '<svg class="ss-ico ss-swords" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 2l7.5 7.5-1.4 1.4L4 5.8V8H2V2h1zm18 0h1v6h-2V5.8l-5.1 5.1-1.4-1.4L21 2zM9.6 12.4l2 2-5.2 5.2 1.4 1.4-1.4 1.4-2.1-2.1L2.2 22.4.8 21l2.1-2.1L.8 16.8l1.4-1.4 1.4 1.4zm4.8 0l5.2 5.2 1.4-1.4 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 1.4-1.4-5.2-5.2z"/></svg>';
const svg = (markup) => { const holder = document.createElement('template'); holder.innerHTML = markup; return holder.content.firstElementChild; };
const TONE_TEXT = { ok: '충분', close: '조금 부족', low: '부족' };

export class StageSelectUI {
  constructor(app) {
    this.app = app;
    this.trigger = null;
    this.opened = false;
    this.model = null;
    this.selection = null;
    this.viewChapter = null;
    this.prefer = null;
    this.dungeonRecommended = null;
    this.memory = readStageSelectMemory();

    this.dialog = node('dialog', 'ss-dialog');
    this.dialog.id = 'stage-select';
    this.dialog.setAttribute('aria-labelledby', 'stage-select-title');

    // 첫 진입 안내: 왼쪽 아래 가장자리의 동행 초상 + 말풍선(시트 밖, 영웅을 가리지 않는 위치). 한 번만.
    this.guide = node('aside', 'ss-guide');
    this.guide.id = 'stage-select-intro';
    this.guide.setAttribute('role', 'note');
    this.guide.hidden = true;
    const guideArt = node('img', 'ss-guide-art');
    guideArt.src = '/img/stage-select/guide-fox.webp'; guideArt.alt = ''; guideArt.decoding = 'async'; guideArt.width = 64; guideArt.height = 64;
    this.guideLead = node('strong', 'ss-guide-lead');
    this.guideText = node('span', 'ss-guide-text');
    const bubble = node('p', 'ss-guide-bubble');
    bubble.append(this.guideLead, this.guideText);
    this.guide.append(guideArt, bubble);

    const header = node('header', 'ss-head');
    const title = node('h2', 'ss-title', '관문 선택');
    title.id = 'stage-select-title';
    this.tabs = node('div', 'ss-tabs');
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-label', '출격 종류');
    this.tabButtons = {};
    for (const [tab, label] of [['campaign', '캠페인'], ['dungeon', '던전']]) {
      const tabButton = button(label, () => this.switchTab(tab), 'ss-tab');
      tabButton.setAttribute('role', 'tab');
      tabButton.dataset.tab = tab;
      tabButton.id = `stage-select-tab-${tab}`;
      tabButton.setAttribute('aria-controls', 'stage-select-list');
      this.tabButtons[tab] = tabButton;
      this.tabs.append(tabButton);
    }
    this.tabs.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const tab = this.model?.tab === 'campaign' ? 'dungeon' : 'campaign';
      this.switchTab(tab);
      this.tabButtons[tab].focus({ preventScroll: true });
    });
    this.closeButton = button('', () => this.close(), 'ss-close');
    this.closeButton.id = 'stage-select-close';
    this.closeButton.setAttribute('aria-label', '관문 선택 닫기');
    header.append(title, this.tabs, this.closeButton);

    // 지역 줄: 이름 · 이전/다음 지역 · 정화 진행(0 / 10). 던전 탭에서는 열린 던전 수.
    this.region = node('div', 'ss-region');
    this.regionName = node('h3', 'ss-region-name');
    this.regionPrev = button('', () => this.showChapter((this.model?.campaign.chapter || 1) - 1), 'ss-region-step');
    this.regionPrev.dataset.dir = 'prev';
    this.regionNext = button('', () => this.showChapter((this.model?.campaign.chapter || 1) + 1), 'ss-region-step');
    this.regionNext.dataset.dir = 'next';
    this.regionProgress = node('span', 'ss-region-progress');
    this.region.append(this.regionName, this.regionPrev, this.regionNext, this.regionProgress);
    this.list = node('div', 'ss-list');
    this.list.id = 'stage-select-list';
    this.list.setAttribute('role', 'tabpanel');
    this.listNote = node('p', 'ss-list-note');

    // 상세 줄: 이름 · 계급 · 추천 레벨 / 내 전투력 vs 권장 / 입장 에너지 · 주요 보상 + 주황 '입장'.
    const detail = node('section', 'ss-detail');
    detail.setAttribute('aria-live', 'polite');
    const copy = node('div', 'ss-detail-copy');
    const headRow = node('div', 'ss-detail-head');
    this.detailName = node('h3', 'ss-detail-name');
    this.detailTag = node('span', 'ss-detail-tag');
    this.detailLevel = node('span', 'ss-detail-level');
    headRow.append(this.detailName, this.detailTag, this.detailLevel);
    this.powerRow = node('p', 'ss-power');
    this.powerMine = node('b', 'ss-power-mine');
    this.powerNeed = node('span', 'ss-power-need');
    this.powerRow.append(svg(SWORDS), this.powerMine, this.powerNeed);
    this.detailFacts = node('dl', 'ss-facts');
    const fact = (label) => { const wrap = node('div', 'ss-fact'); const value = node('dd'); wrap.append(node('dt', '', label), value); this.detailFacts.append(wrap); return { wrap, value }; };
    this.costFact = fact('입장 에너지');
    this.rewardFact = fact('주요 보상');
    copy.append(headRow, this.powerRow, this.detailFacts);
    this.blocked = node('p', 'ss-blocked');
    this.blocked.id = 'stage-select-blocked';
    this.enterButton = button('', () => this.enter(), 'ss-enter');
    this.enterButton.id = 'stage-select-enter';
    this.enterButton.setAttribute('aria-describedby', 'stage-select-blocked');
    this.enterLabel = node('span', 'ss-enter-label', '입장');
    this.enterCost = node('small', 'ss-enter-cost');
    this.enterButton.append(svg(SWORDS), this.enterLabel, this.enterCost);
    const action = node('div', 'ss-action');
    action.append(this.blocked, this.enterButton);
    detail.append(copy, action);

    const body = node('div', 'ss-body');
    body.append(this.region, this.list, this.listNote);
    this.dialog.append(this.guide, header, body, detail);
    document.body.append(this.dialog);

    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { if (this.opened && !this.dialog.open) this.finishClose(); });
    // 로비 이동·카메라 입력이 뒤의 장면으로 새지 않게 막는다(기존 보급 상점과 같은 규칙).
    for (const event of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart', 'click']) this.dialog.addEventListener(event, (input) => input.stopPropagation());
    // 바깥(어두운 배경)을 누르면 닫는다. 비용 없음.
    this.dialog.addEventListener('pointerdown', (event) => { if (event.target === this.dialog) this.backdropPress = true; });
    this.dialog.addEventListener('click', (event) => { if (event.target === this.dialog && this.backdropPress) this.close(); this.backdropPress = false; });
    this.onChange = () => { if (this.dialog.open) this.render(); };
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (this.dialog.open) this.layoutMap(); }) : null;
    this.resizeObserver?.observe(this.list);
    app.eco.onChange(this.onChange);
  }

  get isOpen() { return this.dialog.open; }

  /** 출격 가능한 로비 상태인가(기존 준비창 열기 조건과 같다). */
  canOpen() {
    const app = this.app;
    return app.mode === 'lobby' && !app.stageStarting && !app.expeditionUI?.result?.saveError && !app.store?.busy;
  }

  /**
   * @param {{ trigger?: HTMLElement|null, prefer?: any, dungeonRecommended?: { id: string, depth?: string } | null }} [options]
   */
  open({ trigger = document.activeElement, prefer = null, dungeonRecommended = null } = {}) {
    if (!this.canOpen()) return false;
    if (this.dialog.open) return true;
    this.trigger = trigger;
    this.prefer = prefer;
    this.dungeonRecommended = dungeonRecommended;
    this.memory = refreshStageSelectMemory(this.memory, this.memoryWriteOk);
    this.selection = null;
    this.viewChapter = null;
    this.render();
    // 첫 안내는 한 번만. 본 기록은 이 기기에 남긴다(게임 저장 형식은 바꾸지 않는다).
    const [lead, ...rest] = this.model.introText.split('! ');
    this.guideLead.textContent = rest.length ? `${lead}!` : lead;
    this.guideText.textContent = rest.join('! ');
    this.guide.hidden = !this.model.intro;
    if (this.model.intro) { this.memory = { ...this.memory, introSeen: true }; this.memoryWriteOk = writeStageSelectMemory(this.memory); }
    this.app.input?.clear?.();
    this.app.citadel?.clearInput?.();
    this.dialog.showModal();
    this.opened = true;
    this.layoutMap();
    this.focusSelected();
    return true;
  }

  close() {
    if (!this.dialog.open) return;
    this.app.input?.clear?.();
    this.dialog.close();
    this.finishClose();
  }

  finishClose() {
    this.opened = false;
    this.app.input?.clear?.();
    this.app.citadel?.clearInput?.();
    this.app.syncHub?.();
    const trigger = this.trigger;
    this.trigger = null;
    if (this.app.mode === 'lobby' && !this.app.stageStarting && !document.querySelector('dialog[open], #modal.show') &&
      trigger?.isConnected && !trigger.disabled && !trigger.closest('[hidden], [inert]') && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
  }

  readModel() {
    const { eco, expedition } = this.app;
    return stageSelectModel({
      progress: eco.s.progress, expedition, power: eco.heroPower(eco.s.selected), heroLevel: eco.hero().level, energy: eco.s.energy,
      memory: this.memory, prefer: this.selection || this.prefer, dungeonRecommended: this.dungeonRecommended, chapter: this.viewChapter,
      difficulty: (ch, st) => eco.difficultyFor(ch, st),
    });
  }

  switchTab(tab) {
    if (!this.model || this.model.tab === tab) return;
    // 탭을 바꾸면 그 탭의 기억 → 추천으로 고른다. 비용 없음.
    const model = this.model;
    if (tab === 'campaign') {
      const last = this.memory.last?.tab === 'campaign' && !this.memory.last.followed ? this.memory.last : null;
      const pick = last && model.campaign.stages ? { tab: 'campaign', ch: last.ch, st: last.st } : { tab: 'campaign', ...model.campaign.next };
      this.selection = pick;
      this.viewChapter = pick.ch;
    } else {
      const last = this.memory.last?.tab === 'dungeon' && !this.memory.last.followed ? this.memory.last : null;
      const rec = this.dungeonRecommended || model.dungeons.dungeons.find((entry) => entry.unlocked);
      this.selection = last ? { tab: 'dungeon', id: last.id, depth: last.depth } : rec ? { tab: 'dungeon', id: rec.id, depth: rec.depth === 'deep' ? 'deep' : 'standard' } : { tab: 'dungeon', id: '', depth: 'standard' };
    }
    this.render();
    // 기억·추천이 잠겼으면 모델이 열린 곳으로 고친다. 그래도 탭이 다르면(열린 던전 없음) 빈 목록 안내만 보인다.
    if (this.model.tab !== tab) this.renderTabOverride(tab);
  }

  /** 열린 항목이 하나도 없는 탭을 고른 경우: 목록은 보여 주되 선택은 없다. */
  renderTabOverride(tab) {
    this.model = { ...this.model, tab, selection: null };
    this.selection = null;
    this.paint();
  }

  /** 목록에서 고른다. 잠긴 곳도 고를 수 있고, 입장 버튼이 막힌 이유를 보여 준다. */
  select(selection) {
    this.selection = selection;
    if (selection.tab === 'campaign') this.viewChapter = selection.ch;
    this.model = { ...this.readModel(), tab: selection.tab, selection };
    this.paint();
  }

  showChapter(ch) {
    if (!Number.isInteger(ch) || ch < 1 || ch > (this.model?.campaign.chapters.length || 1)) return;
    this.viewChapter = ch;
    const model = this.readModel();
    // 다른 지역을 넘겨 보는 동안 선택은 유지한다. 그 지역에 다음 관문이 있으면 그것을 고른다.
    const stage = model.campaign.stages.find((entry) => entry.recommended) || model.campaign.stages.find((entry) => entry.unlocked && !entry.cleared) || [...model.campaign.stages].reverse().find((entry) => entry.unlocked);
    // 잠긴 지역은 첫 관문을 골라 해금 조건을 상세 줄에 보여 준다(입장 버튼은 잠김).
    return this.select({ tab: 'campaign', ch, st: stage ? stage.st : 1 });
  }

  render() {
    const model = this.readModel();
    // 직접 고른 잠긴 항목은 선택으로 유지한다(사유를 보여 주기 위해). 모델의 기본 선택은 열린 항목만이다.
    const keep = this.selection && !sameSelection(model.selection, this.selection) && selectedEntry(model, this.selection);
    this.model = keep ? { ...model, tab: this.selection.tab, selection: this.selection } : model;
    this.selection = this.model.selection;
    if (this.selection?.tab === 'campaign' && this.viewChapter === null) this.viewChapter = this.selection.ch;
    this.paint();
  }

  paint() {
    const model = this.model;
    for (const [tab, tabButton] of Object.entries(this.tabButtons)) {
      const on = model.tab === tab;
      tabButton.setAttribute('aria-selected', String(on));
      tabButton.tabIndex = on ? 0 : -1;
    }
    this.list.setAttribute('aria-labelledby', `stage-select-tab-${model.tab}`);
    this.dialog.dataset.tab = model.tab;
    if (model.tab === 'campaign') this.paintCampaign(); else this.paintDungeons();
    this.paintDetail();
  }

  paintCampaign() {
    const { campaign } = this.model;
    const chapter = campaign.chapters[campaign.chapter - 1];
    const map = stageMapFor(campaign.chapter);
    this.region.hidden = false;
    this.regionPrev.hidden = false; this.regionNext.hidden = false;
    this.regionName.textContent = chapter.name;
    this.regionProgress.textContent = chapter.unlocked ? `${chapter.cleared} / 10` : '잠김';
    this.regionPrev.disabled = campaign.chapter <= 1;
    this.regionNext.disabled = campaign.chapter >= campaign.chapters.length;
    this.regionPrev.setAttribute('aria-label', campaign.chapter > 1 ? `이전 지역 ${campaign.chapters[campaign.chapter - 2].name}` : '이전 지역 없음');
    this.regionNext.setAttribute('aria-label', campaign.chapter < campaign.chapters.length ? `다음 지역 ${campaign.chapters[campaign.chapter].name}${campaign.chapters[campaign.chapter].unlocked ? '' : ', 잠김'}` : '다음 지역 없음');
    // 지도: 지역 그림(cover) 위에 그림 기준 좌표로 노드를 놓는다. 그림이 없으면 점선 길을 그린다.
    const path = node('ol', 'ss-path');
    path.setAttribute('aria-label', `${campaign.chapterName} 관문`);
    path.dataset.region = String(campaign.chapter);
    path.dataset.art = String(!!map.art);
    path.style.setProperty('--region-accent', chapter.color);
    if (map.art) path.style.setProperty('--map-art', `url("${map.art}")`);
    const road = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    road.setAttribute('class', 'ss-road');
    road.setAttribute('aria-hidden', 'true');
    road.append(document.createElementNS('http://www.w3.org/2000/svg', 'polyline'));
    path.append(road);
    for (const stage of campaign.stages) {
      const item = node('li', 'ss-step');
      item.dataset.rank = stage.regionBoss ? 'region' : stage.midboss ? 'mid' : stage.boss ? 'warden' : 'captain';
      const pick = button('', () => this.select({ tab: 'campaign', ch: stage.ch, st: stage.st }), 'ss-node');
      pick.dataset.stage = stage.code;
      pick.dataset.locked = String(!stage.unlocked);
      pick.dataset.cleared = String(stage.cleared);
      pick.dataset.recommended = String(stage.recommended);
      const on = sameSelection(this.model.selection, { tab: 'campaign', ch: stage.ch, st: stage.st });
      pick.setAttribute('aria-pressed', String(on));
      const disc = node('span', 'ss-node-disc');
      if (stage.regionBoss || stage.midboss) { const badge = svg(SKULL); badge.classList.add('ss-skull'); disc.append(badge); }
      if (stage.regionBoss) { const crown = svg(CROWN); crown.classList.add('ss-crown'); disc.append(crown); }
      if (!stage.unlocked) { const lock = svg(LOCK); lock.classList.add('ss-lock'); disc.append(lock); }
      if (stage.recommended && stage.unlocked) disc.append(node('i', 'ss-node-pips'));
      disc.append(node('b', 'ss-node-code', stage.code));
      pick.append(disc);
      if (stage.regionBoss || stage.midboss) pick.append(node('em', 'ss-node-tag ss-node-rank', stage.rankLabel));
      else if (stage.recommended && stage.unlocked) pick.append(node('em', 'ss-node-tag ss-node-rec', '추천'));
      if (stage.cleared) pick.append(node('span', 'ss-node-stars', '★'.repeat(stage.stars) + '☆'.repeat(3 - stage.stars)));
      pick.setAttribute('aria-label', `${stage.code} ${stage.title}${stage.midboss || stage.regionBoss ? ` · ${stage.rankLabel}` : ''}${stage.recommended ? ' · 추천' : ''} · ${stage.unlocked ? stage.cleared ? `별 ${stage.stars}개` : '도전 가능' : `잠김: ${stage.lockReason}`}`);
      item.append(pick);
      path.append(item);
    }
    this.mapNodes = map.nodes.length === 10 ? map.nodes : DEFAULT_STAGE_NODES;
    this.list.replaceChildren(path);
    this.listNote.textContent = '';
    this.listNote.hidden = true;
    this.layoutMap();
  }

  /** 지도 크기가 정해진 뒤(열 때·창 크기 변경) 그림과 노드를 px 로 배치한다. */
  layoutMap() {
    const path = this.list.querySelector('.ss-path');
    if (!path || !this.mapNodes) return;
    // 지도 상자는 2.5:1 고정. 목록 영역 폭을 다 쓰고, 높이가 모자라면 높이에 맞춘다(배경 그림과 같은 비율이라 잘리지 않는다).
    const [width, height] = fitStageMapBox(this.list.clientWidth, this.list.clientHeight);
    if (!width || !height) return;
    path.style.width = `${width.toFixed(1)}px`;
    path.style.height = `${height.toFixed(1)}px`;
    const layout = layoutStageMap(this.mapNodes, width, height);
    path.style.setProperty('--ss-node', `${layout.node}px`);
    path.style.setProperty('--ss-node-boss', `${layout.boss}px`);
    const steps = path.querySelectorAll('.ss-step');
    layout.points.forEach(([x, y], index) => { const step = steps[index]; if (step) { step.style.left = `${x.toFixed(1)}px`; step.style.top = `${y.toFixed(1)}px`; } });
    const road = path.querySelector('.ss-road');
    road?.setAttribute('viewBox', `0 0 ${width.toFixed(1)} ${height.toFixed(1)}`);
    road?.firstElementChild?.setAttribute('points', layout.points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  }

  paintDungeons() {
    const { dungeons } = this.model;
    this.region.hidden = false;
    this.regionName.textContent = '열린 던전';
    this.regionProgress.textContent = `${dungeons.open} / ${dungeons.total}`;
    this.regionPrev.hidden = true; this.regionNext.hidden = true;
    this.listNote.hidden = false;
    const grid = node('ul', 'ss-dungeons');
    grid.setAttribute('aria-label', '던전');
    for (const dungeon of dungeons.dungeons) {
      const item = node('li', 'ss-dungeon');
      item.dataset.locked = String(!dungeon.unlocked);
      const standard = dungeon.depths[0];
      item.style.setProperty('--ss-accent', standard.accent);
      const art = node('img', 'ss-dungeon-art');
      art.alt = ''; art.decoding = 'async'; art.loading = 'lazy'; art.draggable = false;
      art.src = cardThumb(standard.art);
      const name = node('span', 'ss-dungeon-name', dungeon.name);
      const depths = node('span', 'ss-depths');
      for (const entry of dungeon.depths) {
        const pick = button('', () => this.select({ tab: 'dungeon', id: dungeon.id, depth: entry.depth }), 'ss-depth');
        pick.dataset.dungeonId = dungeon.id;
        pick.dataset.depth = entry.depth;
        pick.dataset.locked = String(!entry.unlocked);
        pick.setAttribute('aria-pressed', String(sameSelection(this.model.selection, { tab: 'dungeon', id: dungeon.id, depth: entry.depth })));
        pick.append(node('span', '', entry.depthLabel));
        if (!entry.unlocked) pick.append(svg(LOCK)); else if (entry.cleared) pick.append(node('small', 'ss-depth-wins', `${entry.wins}회`));
        pick.setAttribute('aria-label', `${entry.name} ${entry.depthLabel}${entry.unlocked ? entry.cleared ? `, 클리어 ${entry.wins}회` : ', 도전 가능' : `, 잠김: ${entry.lockReason}`}`);
        depths.append(pick);
      }
      item.append(art, name, depths);
      grid.append(item);
    }
    if (!dungeons.dungeons.length) grid.append(node('li', 'ss-empty', '아직 열린 던전이 없습니다. 캠페인 관문을 깨고 탐험 레벨을 올려 보세요.'));
    this.list.replaceChildren(grid);
    this.listNote.textContent = `열린 던전 ${dungeons.open}/${dungeons.total}${dungeons.hiddenLocked ? ` · 잠긴 던전 ${dungeons.hiddenLocked}곳은 탐험 레벨을 올리면 열립니다` : ''}`;
  }

  paintDetail() {
    const model = this.model;
    const entry = model.selection ? selectedEntry(model, model.selection) : null;
    const action = entryAction(entry);
    this.dialog.dataset.entry = entry ? entry.key : '';
    if (!entry) {
      this.detailName.textContent = model.tab === 'campaign' ? '관문을 골라 주세요' : '던전을 골라 주세요';
      this.detailTag.textContent = ''; this.detailLevel.textContent = '';
      this.powerMine.textContent = ''; this.powerNeed.textContent = '';
      this.costFact.value.textContent = '-'; this.rewardFact.value.textContent = '-';
    } else {
      if (entry.kind === 'campaign') {
        this.detailName.textContent = `${entry.code}  ${entry.title}`;
        this.detailTag.textContent = entry.midboss || entry.regionBoss ? entry.rankLabel : entry.recommended ? '추천' : entry.cleared ? `★${entry.stars}` : '';
        this.detailLevel.textContent = `추천 레벨 Lv.${entry.recommendedLevel}`;
        this.detailLevel.dataset.tone = entry.levelTone;
      } else {
        this.detailName.textContent = entry.name;
        this.detailTag.textContent = `${entry.depthLabel}${entry.cleared ? ` · ${entry.wins}회` : ''}`;
        this.detailLevel.textContent = `탐험 Lv.${entry.minLevel}`;
        this.detailLevel.dataset.tone = (this.app.expedition?.s?.level || 1) >= entry.minLevel ? 'ok' : 'low';
      }
      this.detailTag.hidden = !this.detailTag.textContent;
      this.powerRow.dataset.tone = entry.powerTone;
      this.powerMine.textContent = `내 전투력 ${fmt(entry.power)}`;
      this.powerNeed.textContent = ` / 권장 ${fmt(entry.recPower)}`;
      this.powerRow.title = `권장 전투력 대비 ${TONE_TEXT[entry.powerTone]}`;
      this.costFact.value.textContent = `${entry.cost}`;
      this.costFact.wrap.dataset.tone = entry.enoughEnergy ? 'ok' : 'low';
      const rewards = entry.rewards.filter((reward) => reward.id !== 'exp').slice(0, 2).map((reward) => `${reward.name} ×${fmt(reward.amount)}`).join(' · ');
      this.rewardFact.value.textContent = (entry.kind === 'campaign' && entry.unlocksChapter && !entry.cleared ? `지역 ${entry.unlocksChapter} 해금 · ` : '') + (rewards || '-');
    }
    const hero = HEROES[this.app.eco.s.selected];
    this.blocked.textContent = action.reason;
    this.blocked.hidden = !action.reason;
    this.blocked.dataset.tone = action.enabled ? 'warn' : 'locked';
    this.enterButton.disabled = !action.enabled;
    this.enterLabel.textContent = action.label;
    this.enterCost.textContent = entry && action.enabled ? `에너지 ${entry.cost}` : '';
    this.enterButton.setAttribute('aria-label', entry ? `${entry.kind === 'campaign' ? `${entry.code} ${entry.title}` : `${entry.name} ${entry.depthLabel}`} ${action.enabled ? `입장, 에너지 ${entry.cost}${hero ? `, 출전 ${hero.name}` : ''}` : `입장 불가, ${action.reason}`}` : '입장, 고른 곳 없음');
  }

  focusSelected() {
    const selected = this.list.querySelector('[aria-pressed="true"]');
    const target = selected && !this.enterButton.disabled ? this.enterButton : selected || this.tabButtons[this.model?.tab || 'campaign'];
    target?.focus({ preventScroll: true });
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /** 입장: 마지막 선택을 기억하고, 화면을 닫은 뒤 기존 서비스 하나만 부른다. */
  enter() {
    const model = this.model;
    const selection = model?.selection;
    const entry = selection ? selectedEntry(model, selection) : null;
    if (!entry || !entryAction(entry).enabled || !this.canOpen()) return false;
    this.memory = { ...this.memory, last: { ...selection, followed: isRecommendedSelection(model, selection) } };
    this.memoryWriteOk = writeStageSelectMemory(this.memory);
    const returnTo = this.trigger;
    // 닫을 때 초점 복귀는 하지 않는다. 다음 화면(전투 또는 준비창)이 초점을 맡는다.
    this.trigger = null;
    this.close();
    const app = this.app;
    if (entry.kind === 'campaign') {
      // 에너지 차감·부족 안내·실패 환급은 startStage 한 곳이 맡는다.
      app.startStage(stageDef(entry.ch, entry.st));
      return true;
    }
    return openDungeonPreparation(app, entry.id, entry.depth, returnTo);
  }

  destroy() {
    this.close();
    this.resizeObserver?.disconnect();
    const listeners = this.app.eco.listeners;
    const index = listeners.indexOf(this.onChange);
    if (index >= 0) listeners.splice(index, 1);
    this.dialog.remove();
  }
}

/**
 * 던전 입장 = 기존 준비창 열기(영웅·물약·서약·목표 확인). 에너지는 준비창의 '원정 시작'만 쓴다.
 * 물리 관문이 없는 컨셉 던전은 기존 원정 목록의 그 카드로 연다. 둘 다 CitadelCommand 의 이전 동선과 같다.
 */
export function openDungeonPreparation(app, id, depth, trigger) {
  const spot = citadelHotspot(`dungeon:${id}`);
  if (app.meta?.tab !== 'home') app.meta?.openTab?.('home');
  if (!spot) {
    app.expeditionUI.focusDungeon = { id, depth };
    app.expeditionUI.open('dungeons', { depth });
    return true;
  }
  app.citadel?.clearInput?.();
  const fallback = app.commandUI?.prepare || null;
  return app.hubUI.openDestination(spot, trigger?.isConnected && trigger.closest?.('#tab-home') ? trigger : fallback, { depth });
}
