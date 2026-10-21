import { $, fmt } from './ui.js';
import { bindHeroPortrait } from './hero-portraits.js';
import { SkillTreeView } from './skill-tree.js';
import { TranscendView } from './transcend.js';
import { uiArt, resourceArt, RESOURCE_ART } from './illustrated.js';
import { audio } from '../engine/audio.js';
import { musicForScene, MUSIC_MIX } from '../data/music.js';
import { heroVoiceName } from '../engine/hero-voice.js';
import { HEROES, HERO_ORDER, RARITY, heroStats, levelExp, starShards } from '../data/heroes.js';
import { heroProgressionHtml, trainingButtonLabel } from './hero-progression.js';
import { ITEM_BY_ID, SLOTS, SLOT_NAME, SETS, THEMED_SETS, CRAFT_COST, craftable, itemStats, enhanceCost, enhanceStones, enhanceStoneTier, STONE_KEY, STONE_NAME, enhanceChance, destroyChance, enhanceMult, ENH_MAX, RARITY_COLOR , RARITY_INFO, rarityRank, enhanceDown} from '../data/items.js';
import { SKUS, SHOP_TABS, GACHA, BATTLE_PASS, PASS_TRACK, DAILY_REWARDS } from '../data/shop.js';
import { CHAPTERS, STAGES_PER_CHAPTER, ENEMIES, stageDef } from '../data/stages.js';
import { resolveEnemyPortrait } from '../data/encounter-art.js';
import { REWARD_LABEL, gachaRates, gachaChances } from '../game/economy.js';
import { showGachaContents, showWeaponPreview } from './gacha-contents.js';
import { revealPlan, tenPullStatus } from './reveal-plan.js';
import { renderOwnedHero, renderBag, showItemSheet } from './gear-panel.js';
import { weaponLook, weaponLookText } from '../data/weapon-looks.js';
import { LOOKS } from '../game/look.js';
import { createFunnelLog } from '../game/funnel-events.js';
import { campaignFinished } from '../data/expedition-depths.js';
import { storyText, encounterLabel, journalHtml, dungeonBriefHtml } from './campaign.js';
import { guideHtml } from './guide.js';
import { isFirstSortie } from './first-sortie.js';
import { availableDifficulties } from '../game/difficulty.js';
import { AVATARS } from '../data/avatars.js';
import { libraryAssetForAvatar } from '../engine/library-assets.js';
import { itemVisual, itemIconHtml } from './item-presentation.js';
import { GROWTH_FLOW, skuFlowRole, shardProgress } from '../data/growth-flow.js';
import { heroGrade } from '../data/hero-grades.js';
import { levelStatusLabel, lootGuide } from '../data/region-guide.js';
import { paceShort } from './pace-short.js';
// 공개 확률은 실제 소환 코드와 같은 식(gachaRates/gachaChances)에서만 계산한다. 화면에 숫자를 따로 적지 않는다.
const pct = (p, d = 1) => (p * 100).toFixed(d) + '%';
const clampPity = (n) => Math.max(0, Math.min(GACHA.pity, Math.floor(Number(n) || 0)));
// 확률이 처음 오르는 소환 순번을 실제 확률표에서 찾는다 (softPity 경계 해석이 바뀌어도 문구가 따라간다).
const softStart = (rates) => { const i = rates.ssrByPull.findIndex((p, k) => k < rates.hardPity - 1 && p > rates.base.SSR + 1e-9); return i < 0 ? rates.hardPity : i + 1; };
// 로컬 전용 퍼널 로그. 앱이 공용 인스턴스(app.funnel)를 주면 그것을 쓰고, 없으면 한 번만 만든다.
let sharedFunnel = null;
const funnelFor = (app) => (app?.funnel && typeof app.funnel.track === 'function' ? app.funnel : (sharedFunnel ||= createFunnelLog()));
const CAM_DESC = { auto: '상황에 맞춰 자동 — 탐험은 액션, 난전은 탑다운, 보스는 시네마틱', top: '높이서 내려다보는 클래식 시점 — 몹몰이 파악이 쉽다', action: '낮고 가까운 시점 — 타격감과 속도감이 크다', wide: '멀고 넓은 시점 — 전장 전체와 보스 패턴이 보인다' };
const DUNGEON_ICON = '/img/ui-crafted/nav-dungeon.webp';
const DUNGEON_GATE = '/img/ui-crafted/dungeon-gate.svg';
const REGION_DUNGEON_ART = {
  garden: '/img/ui-crafted/keyart/dungeon-garden-keyart.webp',
  forge: '/img/ui-crafted/keyart/dungeon-forge-keyart.webp',
  frost: '/img/ui-crafted/keyart/dungeon-frost-keyart.webp',
  tide: '/img/ui-crafted/keyart/dungeon-tide-keyart.webp',
  crown: '/img/ui-crafted/keyart/dungeon-crown-keyart.webp',
  homecoming: '/img/ui-crafted/keyart/dungeon-homecoming-keyart.webp',
};
const dungeonMapSvg = (stage, { compact = false } = {}) => {
  const dungeon = stage?.dungeon;
  const layout = dungeon?.layout;
  if (!layout?.cells?.length) return '';
  const xs = layout.cells.map(([x]) => x), ys = layout.cells.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const base = layout.cells.map(([x, y]) => [10 + ((x - minX) / spanX) * 80, 10 + ((y - minY) / spanY) * 80]);
  const variant = ((stage.ch - 1) * 10 + stage.st - 1) % 8;
  const transform = ([x, y]) => ([
    [x, y], [100 - x, y], [x, 100 - y], [100 - x, 100 - y],
    [y, x], [100 - y, x], [y, 100 - x], [100 - y, 100 - x],
  ][variant]);
  const points = base.map(transform);
  const lineHtml = (layout.edges || []).map(([from, to]) => {
    const a = points[from], b = points[to];
    return a && b ? `<line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" />` : '';
  }).join('');
  const nodeHtml = points.map(([x, y], i) => {
    const type = layout.types?.[i] || 'normal';
    const label = layout.labels?.[i] || `${dungeon.name} · ${i + 1}구역`;
    return `<g class="dungeon-map-node ${type}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)})"><title>${storyText(label)}</title><circle r="${type === 'boss' ? 5 : type === 'treasure' ? 4.5 : 3.7}" /><circle class="dungeon-map-node-core" r="${type === 'boss' ? 2 : 1.7}" /></g>`;
  }).join('');
  const svg = `<svg class="dungeon-map-svg" viewBox="0 0 100 100" aria-hidden="${compact ? 'true' : 'false'}" focusable="false"><g class="dungeon-map-lines">${lineHtml}</g><g class="dungeon-map-nodes">${nodeHtml}</g></svg>`;
  if (compact) return svg;
  return `<section class="dungeon-map" style="--dungeon-accent:${stage.chapter?.color || '#d9c5a0'}" aria-label="${storyText(dungeon.name)} ${layout.cells.length}개 구역 지도">${svg}<div class="dungeon-map-caption"><b>${storyText(dungeon.name)}</b><span>${layout.cells.length}개 구역 · ${variant + 1}번 원정 동선</span></div><div class="dungeon-map-legend"><span><i class="start"></i>출발</span><span><i class="elite"></i>정예</span><span><i class="treasure"></i>보상</span><span><i class="boss"></i>봉인</span></div></section>`;
};
export const stageKeyArt = (stage) => {
  const id = stage.dungeonBossId || stage.encounter?.dungeonBossId || stage.encounter?.enemyId;
  return resolveEnemyPortrait(id, ENEMIES[id]);
};

const RC = { N: 'var(--r-n)', R: 'var(--r-r)', SR: 'var(--r-sr)', SSR: 'var(--r-ssr)', SSSR: 'var(--r-sssr)' };
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (d ? d + '일 ' : '') + `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`; };

export class Meta {
  constructor(app) {
    this.app = app; this.eco = app.eco; this.ui = app.ui;
    this.tab = 'home'; this.chapter = 1; this.stage = null; this.shopTab = 'hot'; this.heroSel = this.eco.s.selected;
    document.querySelectorAll('.bottomnav button').forEach((b) => b.addEventListener('click', () => this.openTab(b.dataset.tab)));
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const k = b.dataset.open; if (k === 'energy') this.openTab('shop', 'energy'); else if (k === 'shop-gold') this.openTab('shop', 'gold'); else this.openTab('shop', 'gem'); }));
    $('btn-battle').addEventListener('click', () => this.launchNextChallenge());
    $('stage-pill').addEventListener('click', () => this.openTab('stage'));
    $('btn-campaign-journal').addEventListener('click', () => this.ui.modal(journalHtml(this.eco.s.progress), { onOpen: (box) => { box.querySelector('#journal-close').onclick = () => this.ui.closeModal(); } }));
    $('btn-daily').addEventListener('click', () => this.showDaily());
    $('btn-mail').addEventListener('click', () => this.showMail());
    $('btn-quest').addEventListener('click', () => this.showQuests());
    $('btn-settings').addEventListener('click', () => this.showSettings());
    $('btn-guide').addEventListener('click', (event) => { event.stopPropagation(); setTimeout(() => this.showGuide(), 0); });
    $('btn-profile').addEventListener('click', () => this.showProfile());
    // 실제 결제가 연결되기 전에는 현금 상품 입구를 DOM에서 치운다(메뉴 묶음이 만들어지기 전이라 빈 안내 묶음도 생기지 않는다).
    if (this.payOn()) {
      $('promo-starter').addEventListener('click', () => this.buy('starter'));
      $('promo-monthly').addEventListener('click', () => this.buy('monthly'));
    } else { $('promo-starter').remove(); $('promo-monthly').remove(); }
    $('btn-pull1').addEventListener('click', () => this.pull(1));
    $('btn-pull10').addEventListener('click', () => this.pull(10));
    $('btn-pull-ssr').addEventListener('click', () => this.pullSSR());
    $('btn-rates').addEventListener('click', () => this.showRates());
    $('btn-pass-buy').addEventListener('click', () => this.buyPass());
    $('btn-reveal-skip').addEventListener('click', () => this.revealSkip());
    $('btn-reveal-close').addEventListener('click', () => this.revealClose());
    $('btn-reveal-again').addEventListener('click', () => { this.revealClose(); this.pull(10); });
    this.eco.onChange(() => this.refreshTop());
    setInterval(() => this.tick(), 1000);
  }
  /** 실제 스토어 결제·영수증 검증이 연결됐는지. Economy.paymentAvailable()가 true가 되면 현금 상품 화면이 자동으로 다시 나타난다. */
  payOn() { return this.eco.paymentAvailable?.() === true; }
  /** 지금 상점 탭 id에 보여 줄 상품. 결제가 없으면 현금 상품(₩)과 VIP·첫 결제 보너스 상품은 제외한다. */
  shopSkus(tab = this.shopTab) {
    const pay = this.payOn();
    return SKUS.filter((x) => (pay || x.kind !== 'cash') && (x.tab === tab || (tab === 'hot' && x.badge && x.tab !== 'gem' && x.tab !== 'energy' && x.tab !== 'gold')));
  }
  /** 상품이 하나도 없는 탭(결제 없는 보석·패키지)은 감춘다. */
  shopTabs() { return SHOP_TABS.filter((t) => this.shopSkus(t.id).length); }
  openTab(tab, sub) {
    if (this.app.expeditionUI?.result?.saveError && (tab !== 'stage' || sub !== 'dungeons')) { this.ui.toast('전리품 정산을 먼저 저장해 주세요.', 'red'); return; }
    if (this.app.expeditionUI?.result && (tab !== 'stage' || !sub || sub === 'campaign')) { this.app.expeditionUI.result = null; this.app.toLobby(); }
    this.tab = tab; audio.play('ui_select', { vol: 0.4 });
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('show', t.id === 'tab-' + tab));
    document.querySelectorAll('.bottomnav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.app.setLobbyVisible(tab === 'home');
    this.app.expeditionUI?.syncTab(tab, sub);
    if (tab !== 'heroes') this.app.wardrobe?.hide();
    if (tab === 'stage') this.renderStages(); if (tab === 'heroes') this.renderHeroes(); if (tab === 'shop') { if (sub) this.shopTab = sub; this.renderShop(); this.trackFunnel('shop_view', { tab: this.shopTab }); } if (tab === 'pass') this.renderPass(); if (tab === 'gacha') this.refreshGacha();
    if (tab === 'home') this.refreshHome();
  }
  /** 메뉴 안(소환·상점·패스·우편 등)에 받을 것이 있으면 하단 메뉴 버튼에도 점을 띄워 첫 소환·보상 수령을 놓치지 않게 한다. */
  refreshMenuBadge() {
    const trigger = document.querySelector('#meta .oath-nav-menu'); if (!trigger) return;
    // 상점 점(스타터 미구매)은 결제 연결 전에는 해소할 수 없으므로 세지 않는다. 무료로 받을 수 있는 것만 알린다.
    const pending = ['dot-gacha', 'dot-pass', 'dot-daily', 'dot-mail', 'dot-quest'].filter((id) => document.getElementById(id)?.classList.contains('on')).length;
    let dot = trigger.querySelector('.dot');
    if (!dot) { dot = document.createElement('em'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true'); trigger.append(dot); }
    dot.classList.toggle('on', pending > 0);
    trigger.setAttribute('aria-label', pending > 0 ? `메뉴, 확인할 항목 ${pending}개` : '메뉴');
  }
  refreshTop() {
    const s = this.eco.s;
    const status = this.eco.storageStatus;
    if (status !== 'ready' && this._storageNotice !== status) {
      this._storageNotice = status;
      this.ui.toast(status === 'unavailable' ? '저장 공간을 사용할 수 없어 현재 진행은 이 창에서만 유지됩니다.' : status === 'recovered' ? '마지막 정상 저장에서 진행을 복구했습니다.' : '저장된 진행을 읽지 못했습니다. 복구용 원본은 보관했습니다.', 'red');
    }
    $('v-gold').textContent = fmt(s.gold); $('v-gem').textContent = fmt(s.gems); $('v-energy').textContent = s.energy; $('v-energy-max').textContent = this.eco.energyMax; $('v-energy-timer').textContent = this.eco.energyTimer();
    $('top-vip-wrap').hidden = !this.payOn(); $('plus-gem').hidden = !this.payOn();
    $('top-vip').textContent = s.vip; $('top-lv').textContent = this.eco.hero().level; bindHeroPortrait($('top-avatar'), this.app, s.selected); $('top-name').textContent = s.name;
    $('dot-daily').classList.toggle('on', this.eco.dailyAvailable()); $('dot-mail').classList.toggle('on', this.eco.unreadMail() > 0); $('dot-quest').classList.toggle('on', this.eco.questClaimable() > 0);
    $('dot-pass').classList.toggle('on', this.eco.passClaimable() > 0); $('dot-gacha').classList.toggle('on', s.tickets > 0 || s.ssrTickets > 0); $('dot-shop').classList.toggle('on', this.payOn() && !s.purchases.includes('starter'));
    this.refreshMenuBadge();
    $('v-ticket').textContent = s.tickets + (s.ssrTickets ? ` (SSR확정 ${s.ssrTickets})` : ''); $('v-pity').textContent = s.pity; $('pity-left').textContent = GACHA.pity - s.pity;
    // SSR 확정권은 확률 정보 창 안이 아니라 소환 버튼 줄에서 바로 쓴다(보유할 때만 보인다).
    $('btn-pull-ssr').classList.toggle('hidden', !(s.ssrTickets > 0)); $('v-ssr-ticket').textContent = s.ssrTickets || 0;
    this.refreshGachaOdds(); this.refreshGachaPace();
    if (this.payOn()) {
      $('promo-starter').style.display = s.purchases.includes('starter') ? 'none' : '';
      $('promo-monthly').style.display = s.monthlyUntil > Date.now() ? 'none' : '';
    }
    if (this.tab === 'home') this.refreshHome();
  }
  refreshHome() {
    const s = this.eco.s; const def = HEROES[s.selected]; const nx = this.eco.nextStage();
    // 초월로 오른 현재 등급을 보인다(시작 등급 def.rarity 가 아니라).
    const grade = heroGrade(def, this.eco.hero(s.selected));
    $('lobby-hero-name').textContent = def.name; $('lobby-rarity').textContent = grade; $('lobby-rarity').style.background = RC[grade]; $('lobby-power').textContent = fmt(this.eco.heroPower(s.selected));
    const complete = campaignFinished(s.progress);
    $('stage-pill-txt').textContent = complete ? '캠페인 완주 · 새로운 원정' : nx.name; $('battle-cost').textContent = nx.energy;
    $('btn-battle').firstElementChild.textContent = complete ? '심층 원정' : '출 격';
    $('btn-battle').querySelector('small').hidden = complete;
  }
  launchNextChallenge() {
    if (campaignFinished(this.eco.s.progress)) return this.app.expeditionUI.open('dungeons', { depth: 'deep' });
    return this.app.startStage(this.eco.nextStage());
  }
  tick() {
    const s = this.eco.s; this.eco.tickEnergy(); $('v-energy').textContent = s.energy; $('v-energy-timer').textContent = this.eco.energyTimer();
    if (this.payOn()) $('promo-timer').textContent = '한정 상품';
    $('banner-timer').textContent = hms(this.eco.s.limitedStart + 7 * 86400000 - Date.now());
    if (this.tab === 'shop') document.querySelectorAll('[data-timer]').forEach((el) => { el.textContent = '남은 시간 ' + hms(this.eco.limitedLeft(this.eco.sku(el.dataset.timer))); });
    // 월정액 자동 지급
    if (this.eco.claimMonthly()) this.ui.toast('월정액 일일 보석 +100', 'gold');
  }

  // ================= 스테이지 =================
  renderStages() {
    const tabs = $('chapter-tabs'); tabs.innerHTML = CHAPTERS.map((c) => `<button type="button" data-ch="${c.id}" aria-pressed="${c.id === this.chapter}" class="${c.id === this.chapter ? 'on' : ''} ${this.eco.isUnlocked(c.id, 1) ? '' : 'lock'}"><small>REGION 0${c.id}${this.eco.isUnlocked(c.id, 1) ? '' : ' · 미개방'}</small>${storyText(c.name)}</button>`).join('');
    tabs.querySelectorAll('button').forEach((b) => b.onclick = () => { this.chapter = +b.dataset.ch; this.renderStages(); tabs.querySelector(`[data-ch="${this.chapter}"]`)?.focus({ preventScroll: true }); });
    const grid = $('stage-grid'); grid.innerHTML = '';
    const next = this.eco.nextStage(); if (!this.stage || this.stage.ch !== this.chapter) this.stage = (next.ch === this.chapter) ? next : stageDef(this.chapter, 1);
    const chapter = CHAPTERS[this.chapter - 1];
    const chapterCast = [HEROES.knight, HEROES.barbarian, HEROES.mage, HEROES.rogue, { name: '기억의 동행 네브', portrait: '/img/tll/neve-original-v1.webp' }, HEROES.ranger][this.chapter - 1] || HEROES.knight;
    const cleared = Array.from({ length: STAGES_PER_CHAPTER }, (_, i) => this.eco.s.progress.stars[`${this.chapter}-${i + 1}`] || 0).filter(Boolean).length;
    const total = CHAPTERS.reduce((n, c) => n + Array.from({ length: STAGES_PER_CHAPTER }, (_, i) => this.eco.s.progress.stars[`${c.id}-${i + 1}`] || 0).filter(Boolean).length, 0);
    $('tab-stage').dataset.region = chapter.encounterPrefix || chapter.theme;
    const mapStops = [1, 3, 5, 7, 10].map((stop) => {
      const stopStage = stageDef(this.chapter, stop), stopStars = this.eco.s.progress.stars[stopStage.code] || 0;
      return `<span class="chapter-route-node${stopStars ? ' done' : ''}${stopStage.boss ? ' boss' : ''}" title="${storyText(stopStage.title)}"><i>${String(stop).padStart(2, '0')}</i><small>${stopStage.boss ? '보스' : '관문'}</small></span>`;
    }).join('');
    const regionArt = REGION_DUNGEON_ART[chapter.encounterPrefix || chapter.theme] || chapterCast.portrait;
    $('chapter-brief').innerHTML = `<div class="chapter-copy"><span class="campaign-eyebrow">${storyText(chapter.tagline)}</span><h3>${storyText(chapter.name)}</h3><p>${storyText(chapter.summary)}</p><div class="chapter-facts"><span><b>${cleared}</b><small>정화된 관문</small></span><span><b>${total}/${CHAPTERS.length * STAGES_PER_CHAPTER}</b><small>전체 기록</small></span><span><b>${storyText(chapter.mechanic.name)}</b><small>지역 기믹</small></span></div></div><div class="chapter-map-scene" aria-label="${storyText(chapter.name)} 원정 지도"><div class="chapter-map-glow"></div><img class="chapter-map-gate" src="${DUNGEON_GATE}" alt="" width="96" height="96"><img class="chapter-map-icon" src="${DUNGEON_ICON}" alt="" width="32" height="32"><div class="chapter-route">${mapStops}</div><span class="chapter-map-caption">정화 루트 · 10개 관문</span></div><figure class="chapter-cast chapter-dungeon-art"><img src="${regionArt}" width="1680" height="944" alt="${storyText(chapter.name)} 전용 던전 키아트" decoding="async"><figcaption>${storyText(chapter.name)}<small>지역 전용 던전 키아트</small></figcaption></figure><div class="campaign-progress"><b>${cleared}<small> / ${STAGES_PER_CHAPTER}</small></b><span>지역 정복 · 전체 ${total}/${CHAPTERS.length * STAGES_PER_CHAPTER}</span><progress value="${cleared}" max="${STAGES_PER_CHAPTER}" aria-label="${storyText(chapter.name)} 클리어 진행도"></progress></div>`;
    for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
      const d = stageDef(this.chapter, st); const unlocked = this.eco.isUnlocked(this.chapter, st); const stars = this.eco.s.progress.stars[`${this.chapter}-${st}`] || 0;
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'stage-cell' + (d.boss ? ' boss' : '') + (unlocked ? '' : ' lock') + (this.stage.st === st ? ' on' : '');
      cell.dataset.stage = d.code; cell.dataset.rank = d.encounter?.rank || 'captain'; cell.setAttribute('aria-pressed', String(this.stage.st === st));
      cell.setAttribute('aria-label', `${d.code} ${d.title} · ${encounterLabel(d)} · ${unlocked ? stars ? `별 ${stars}개` : '도전 가능' : '미개방, 소개 보기'}`);
      const cardArt = stageKeyArt(d);
      const nodeArt = cardArt ? `<img src="${cardArt}" alt="${storyText(d.encounter.name)} 아트" width="48" height="48" loading="lazy" onerror="this.hidden=true">` : `<span class="stage-node-map">${dungeonMapSvg(d, { compact: true })}</span>`;
      cell.innerHTML = `<span class="stage-connector" aria-hidden="true"></span><span class="stage-node${d.boss ? ' boss' : ''}">${nodeArt}${unlocked ? '<i class="stage-node-mark">입장</i>' : '<i class="stage-node-lock">봉인</i>'}</span><span class="stage-code">${d.code}</span><span class="stage-title">${storyText(d.title)}</span><span class="stage-rank">${storyText(encounterLabel(d))}</span><span aria-hidden="true" class="st ${stars ? '' : 'none'}">${unlocked ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '미개방'}</span>`;
      cell.onclick = () => { this.stage = d; this.renderStages(); grid.querySelector(`[data-stage="${d.code}"]`)?.focus({ preventScroll: true }); };
      grid.appendChild(cell);
    }
    const d = this.stage; const stars = this.eco.s.progress.stars[`${d.ch}-${d.st}`] || 0; const power = this.eco.heroPower(this.eco.s.selected);
    const unlocked = this.eco.isUnlocked(d.ch, d.st);
    const difficulties = availableDifficulties(this.eco.s, d.ch, d.st);
    const selectedDifficulty = this.eco.difficultyFor(d.ch, d.st, this.eco.s.progress.difficulty || 'story');
    this.selectedDifficulty = selectedDifficulty.id;
    const lootInfo = lootGuide(d.ch, selectedDifficulty.id), levelInfo = levelStatusLabel(this.eco.hero(this.eco.s.selected).level, d.recommendedLevel);
    const difficultyRequirement = (item) => item.id === 'adept' ? '1개 스테이지 클리어' : item.id === 'nightmare' ? '이 스테이지 ★3' : '기본 난이도';
    const difficultyHtml = difficulties.map((item) => `<button type="button" class="difficulty-card tone-${item.tone}${item.id === selectedDifficulty.id ? ' on' : ''}${item.unlocked ? '' : ' locked'}" data-difficulty="${item.id}" aria-pressed="${item.id === selectedDifficulty.id}" ${item.unlocked ? '' : 'disabled'}><img src="/img/ui/difficulty-${item.id}.svg" alt=""><span class="difficulty-copy"><b>${item.name}</b><small>${item.description}</small></span><span class="difficulty-reward">보상 ×${item.rewardMul.toFixed(2)}</span>${item.unlocked ? '' : `<em>🔒 ${difficultyRequirement(item)}</em>`}</button>`).join('');
    const detailArt = stageKeyArt(d);
    $('stage-detail').innerHTML = `<div class="stage-narrative"><div class="stage-hero-card">${detailArt ? `<img src="${detailArt}" alt="${storyText(d.encounter.name)} 아트" width="1680" height="944" loading="lazy" onerror="this.hidden=true">` : ''}<div class="stage-hero-shade"><span class="campaign-eyebrow">${d.code} · ${storyText(encounterLabel(d))}</span><h3>${storyText(d.title)}</h3><p>${storyText(d.story?.opening)}</p><span class="stage-hero-gate"><img src="${DUNGEON_ICON}" alt="" width="18" height="18">${storyText(d.dungeon?.name || '미지의 던전')}</span></div></div><p class="stage-objective"><b>이번 원정의 목표</b> ${storyText(d.objective)}</p>${dungeonBriefHtml(d)}${dungeonMapSvg(d)}<div class="stage-tactics"><p><b>${storyText(chapter.mechanic?.name)}</b> ${storyText(chapter.mechanic?.description)}</p><p><b>${storyText(d.encounter?.name)}</b> ${storyText(d.encounter?.tactic)}</p></div></div><div class="stage-launch"><div class="launch-kicker"><span>출격 준비</span><b>${unlocked ? '입장 가능한 던전' : '봉인된 던전'}</b></div>
      <div class="meta"><span>권장 전투력 <b style="color:${power >= d.recPower ? 'var(--green)' : 'var(--red)'}">${fmt(d.recPower)}</b></span><span>내 전투력 ${fmt(power)}</span></div>
      <div class="meta stage-level" data-tone="${levelInfo.tone}" title="${levelInfo.detail}"><span>권장 Lv.<b>${d.recommendedLevel}</b> · 내 Lv.<b>${this.eco.hero(this.eco.s.selected).level}</b></span><span class="stage-level-state">${levelInfo.text}</span></div>
      <div class="difficulty-picker" role="group" aria-label="전투 난이도"><div class="difficulty-heading"><b>전투 난이도</b><span>${selectedDifficulty.name} · 보상과 적 압박이 함께 증가합니다</span></div>${difficultyHtml}</div>
      <div class="rewards"><span class="reward-chip"><i class="ic ic-gold"></i> ${fmt(Math.floor(d.rewards.gold * selectedDifficulty.rewardMul))}</span><span class="reward-chip">완료 EXP ${Math.floor(d.rewards.exp * selectedDifficulty.expMul)}</span><span class="reward-chip">정예 처치 · 장비 ${lootInfo.elite.gearRolls}개</span>${!stars ? `<span class="reward-chip"><i class="ic ic-gem"></i> ${d.rewards.firstGems} 첫클리어</span>` : ''}</div>
      <p class="stage-loot-guide" data-loot-difficulty="${selectedDifficulty.id}"><b>사냥 전리품 · ${selectedDifficulty.name}</b>${lootInfo.lines.map((line) => '<span>' + line + '</span>').join('')}<span class="stage-loot-note">${levelInfo.detail} · 처치 경험치는 전투 중 즉시 쌓입니다.</span></p>
      ${unlocked ? '' : `<p class="stage-lock-note">${d.st === 1 ? `${d.ch - 1}-10` : `${d.ch}-${d.st - 1}`} 클리어 후 출격할 수 있습니다.</p>`}</div>`;
    // 출격 버튼은 스크롤 밖 하단 고정 바에 둔다(낮은 가로 화면에서도 항상 보인다). id 와 동작은 그대로다.
    $('campaign-sortie').innerHTML = `<div class="sortie-info"><b>${d.code} ${storyText(d.title)}</b><small>권장 전투력 <span style="color:${power >= d.recPower ? 'var(--green)' : 'var(--red)'}">${fmt(d.recPower)}</span> · 내 ${fmt(power)}</small></div><div class="row"><button class="btn btn-ghost" id="st-sweep" ${stars < 3 || !unlocked ? 'disabled' : ''}><span>소탕</span><small>티켓 ${this.eco.s.sweep}</small></button><button class="btn btn-gold" id="st-go" ${unlocked ? '' : 'disabled'}><span>${unlocked ? '던전 입장' : '봉인 해제 필요'}</span><small>${unlocked ? '<i class="ic ic-energy"></i> 출격 에너지 -' + d.energy : '이전 관문을 먼저 정화하세요'}</small></button></div>`;
    $('stage-detail').querySelectorAll('[data-difficulty]').forEach((button) => button.onclick = () => {
      const next = this.eco.setDifficulty(button.dataset.difficulty, d.ch, d.st);
      this.selectedDifficulty = next.id;
      audio.play('ui_select', { vol: 0.35 });
      this.renderStages();
      $('stage-detail')?.querySelector(`[data-difficulty="${next.id}"]`)?.focus({ preventScroll: true });
    });
    $('st-go').onclick = () => { if (this.eco.isUnlocked(d.ch, d.st)) this.app.startStage({ ...d, difficultyId: this.selectedDifficulty }); };
    $('st-sweep').onclick = () => { const r = this.eco.sweep(d); if (!r) { this.ui.toast('소탕권/에너지 부족', 'red'); return; } audio.play('jingle_win0', { vol: 0.5 }); this.ui.rewardToast([...r.got, ...r.loot.map((it) => ({ k: 'item', item: it }))]); if (r.awakened && r.awakened.length) this.ui.awakenBanner(r.awakened); this.renderStages(); };
  }

  // ================= 영웅 =================
  focusInventory(uid, slot) {
    const bag = $('hero-bag');
    // 가방 → 부위 필터 → 장착 슬롯 → 출격 순으로 포커스를 돌려준다(다른 탭을 보고 있어도 키보드 경로가 끊기지 않는다).
    (bag?.querySelector('[data-inv="' + uid + '"]') || bag?.querySelector('[data-bag-slot="' + slot + '"]') || $('hero-detail')?.querySelector('.hs-slot[data-slot="' + slot + '"]') || $('h-next'))?.focus();
  }
  renderInventory(heroId) { return renderBag(this, heroId); }
  selectHero(id, restoreKeyboardFocus = false) {
    if (!HEROES[id] || !this.eco.ownHero(id)) return false;
    this.heroSel = id;
    if (this.eco.s.selected !== id) {
      this.eco.s.selected = id;
      this.eco.emit();
      this.app.showcaseHero(id);
      this.ui.toast(`${HEROES[id].name} 출전!`, 'gold');
      audio.voice(heroVoiceName(id, 'select'), { min: 1 });
    }
    this.renderHeroes();
    if (restoreKeyboardFocus) $('hero-list').querySelector(`[data-hero-id="${id}"]`)?.focus({ preventScroll: true });
    return true;
  }
  renderHeroes() {
    const list = $('hero-list'); list.innerHTML = '';
    if (!HEROES[this.heroSel]) this.heroSel = this.eco.s.selected;
    for (const id of HERO_ORDER) {
      const def = HEROES[id]; const own = this.eco.ownHero(id); const h = this.eco.hero(id);
      const grade = own ? heroGrade(def, h) : def.rarity;
      const c = document.createElement('button'); c.type = 'button'; c.className = `hero-card rar-${grade}` + (own ? '' : ' lock') + (this.heroSel === id ? ' on' : '');
      c.dataset.heroId = id;
      c.setAttribute('aria-label', `${def.name}${own ? ' 출전 선택' : ' 미보유 정보'}`);
      c.setAttribute('aria-pressed', String(this.eco.s.selected === id));
      c.innerHTML = `<img onerror="this.style.background='${def.color}'"><span class="rar bg-${grade}">${grade}</span>${own ? `<span class="lv">Lv.${h.level} ${'★'.repeat(h.star)}</span>` : '<span class="lockt">미보유</span>'}`;
      c.onclick = (event) => { if (own) this.selectHero(id, event.detail === 0 && document.activeElement === c); else { this.heroSel = id; this.renderHeroes(); } };
      list.appendChild(c);
      bindHeroPortrait(c.querySelector('img'), this.app, id);
    }
    const id = this.heroSel; const def = HEROES[id]; const own = this.eco.ownHero(id); const det = $('hero-detail');
    this.app.wardrobe?.show(id);
    if (!own) { det.innerHTML = `<div class="hs-locked"><h2>${def.name}</h2><div class="sub">${def.title} · ${def.rarity}</div><p style="color:var(--muted);font-size:13px">${def.skills.map((s) => s.name).join(' · ')}</p><button class="btn btn-gold" id="h-summon">소환으로 획득</button></div>`; $('h-summon').onclick = () => this.openTab('gacha'); return; }
    renderOwnedHero(this, id, det);
    // 성장 진입: 스킬 트리(SP)와 초월(SR→SSR→SSSR). 이름 줄 아래에 작게 둔다.
    const growthLinks = document.createElement('div'); growthLinks.className = 'hs-growth-links';
    for (const [label, open] of [['스킬 트리', () => this.openSkillTree(id)], ['초월', () => this.openTranscend(id)]]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = label;
      b.setAttribute('aria-label', HEROES[id].name + ' ' + label + ' 열기'); b.onclick = open; growthLinks.append(b);
    }
    det.querySelector('.hs-id')?.append(growthLinks);
  }
  setListHtml(heroId) {
    const b = this.eco.heroEquipBonus(heroId); const counts = b.sets || {};
    const pct = (o) => o.text ? o.text : Object.entries(o).filter(([k]) => k !== 'procs' && k !== 'text').map(([k, v]) => ({ atk: '공격력', hp: 'HP', crit: '치명', critDmg: '치명피해', ultGain: '궁극기 수급' }[k] + ' +' + Math.round(v * 100) + '%')).join(', ');
    const order = ['dragon', 'knight', 'merc', 'recruit', ...THEMED_SETS];
    const rows = order.map((sid) => {
      const n = counts[sid] || 0; if (!n) return '';
      const S = SETS[sid]; const on2 = n >= 2, on4 = n >= 4; const col = S.themed ? '#' + S.color.toString(16).padStart(6, '0') : RARITY_COLOR[{ recruit: 'N', merc: 'S', knight: 'E', dragon: 'L' }[sid]];
      return `<div class="set-row ${on2 ? '' : 'off'}"><img src="${S.icon}" onerror="this.remove()"><div style="flex:1"><div class="sr-name" style="color:${col}">${S.name} (${n}/4)${S.themed ? ' <small style="color:var(--muted);font-weight:400">테마</small>' : ''}</div><div class="${on2 ? 'sr-eff' : ''}" style="font-size:10px">2세트: ${pct(S.two)}</div><div class="${on4 ? 'sr-eff' : ''}" style="font-size:10px;${on4 ? '' : 'color:var(--muted)'}">4세트: ${pct(S.four)}</div></div></div>`;
    }).filter(Boolean).join('');
    return `<div class="set-list">${rows || '<div style="font-size:11px;color:var(--muted)">같은 등급 장비 2/4개 = 스탯 세트 · 테마 세트와 원정 전용 세트는 2/4개 장착 시 전투 효과가 발동합니다</div>'}<button class="btn btn-ghost btn-sm" id="h-craft" style="align-self:flex-start">세트 제작 <small><img src="${resourceArt('fragments')}" style="width:12px;height:12px;vertical-align:-2px"> ${this.eco.s.fragments || 0}</small></button></div>`;
  }
  /** 세트 조각으로 테마 세트 장비 제작 — 엘리트/보스가 떨군다 */
  showCraft(heroId) {
    const s = this.eco.s;
    const html = `<h2>세트 제작</h2><p style="font-size:12px;color:var(--muted)">세트 조각 <b style="color:#b26bff">${s.fragments || 0}</b> 보유 · 부위당 ${CRAFT_COST}개 · 테마 세트 ${THEMED_SETS.length}종(아래로 스크롤). 조각은 엘리트·보스가 떨굽니다.</p>
      <div class="craft-grid">${THEMED_SETS.map((sid) => { const S = SETS[sid]; const col = '#' + S.color.toString(16).padStart(6, '0'); return `<div class="craft-set"><div class="cs-head"><img src="${S.icon}" onerror="this.remove()"><div><div style="font-weight:900;color:${col}">${S.name}</div><div style="font-size:10px;color:var(--muted)">2: ${S.two.text}</div><div style="font-size:10px;color:var(--muted)">4: ${S.four.text}</div></div></div><div class="cs-slots">${SLOTS.map((sl) => { const it = craftable(sid, sl); const own = s.inventory.filter((x) => x.id === it.id).length; return `<div class="equip-slot has rar-SR" data-craft="${sid}:${sl}" title="${it.name}">${itemIconHtml(ITEM_BY_ID[it.id] || it, '', { heroId: heroId || this.eco.s.selected })}<span class="plus">${own ? '×' + own : ''}</span></div>`; }).join('')}</div></div>`; }).join('')}</div>
      <div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`;
    this.ui.modal(html, { onOpen: (b) => {
      b.querySelector('#m-cancel').onclick = () => { this.ui.closeModal(); this.renderHeroes(); };
      b.querySelectorAll('[data-craft]').forEach((el) => el.onclick = async () => {
        const [sid, sl] = el.dataset.craft.split(':'); const it = craftable(sid, sl);
        if ((s.fragments || 0) < CRAFT_COST) { this.ui.toast(`세트 조각 부족 (${s.fragments || 0}/${CRAFT_COST})`, 'red'); audio.play('ui_error'); return; }
        if (!await this.ui.confirm('제작', `${it.name}을(를) 세트 조각 ${CRAFT_COST}개로 제작할까요?`)) return;
        const r = this.eco.craftSetItem(sid, sl);
        if (r.ok) { audio.play('jingle_legend', { vol: 0.6 }); audio.vibe([20, 20, 60]); this.ui.toast(`${it.name} 제작!`, 'gold'); this.ui.closeModal(); this.showCraft(heroId); }
      });
    } });
  }
  /** 스킬 상세는 SP 스킬 트리 화면으로 연다(골드 강화 모달 대체). */
  showSkill(id, i) { return this.openSkillTree(id, i); }
  openSkillTree(id = this.heroSel || this.eco.s.selected, i = 0) {
    if (!this.eco.ownHero(id)) return false;
    this.skillTree ||= new SkillTreeView(this, { portrait: (img, heroId) => bindHeroPortrait(img, this.app, heroId) });
    this.transcendView?.close({ rerender: false, restoreFocus: false });
    return this.skillTree.open(id, i);
  }
  openTranscend(id = this.heroSel || this.eco.s.selected) {
    if (!this.eco.ownHero(id)) return false;
    this.transcendView ||= new TranscendView(this, { portrait: (img, heroId) => bindHeroPortrait(img, this.app, heroId) });
    this.skillTree?.close({ rerender: false, restoreFocus: false });
    return this.transcendView.open(id);
  }
  /** 가방 장비 시트 — 현재 장비와 나란히 비교하고 장착·강화를 한 곳에서 한다. */
  showItem(uid, heroId, options) { return showItemSheet(this, uid, heroId, options); }
  /** 강화는 비교 시트의 강화 영역으로 연다. */
  showEnhance(uid, heroId) { return showItemSheet(this, uid, heroId, { focus: 'enhance' }); }
  offerStones() { setTimeout(() => this.ui.modal(`<h2>강화석이 부족합니다</h2><p>강화석은 전투 필드 드랍 또는 상점에서 얻을 수 있어요</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">나중에</button><button class="btn btn-gold" id="m-ok">강화 상점</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { this.ui.closeModal(); this.openTab('shop', 'enh'); }; } }), 500); }
  offerScroll(k) { setTimeout(() => this.ui.modal(`<h2>${k === 'bless' ? '축복' : '보호'} 주문서가 없습니다</h2><p>${k === 'bless' ? '성공률을 20% 올려줍니다.' : '실패해도 장비가 파괴되지 않습니다.'}<br>상점에서 구매할 수 있어요.</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">나중에</button><button class="btn btn-gold" id="m-ok">강화 상점</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { this.ui.closeModal(); this.openTab('shop', 'enh'); }; } }), 500); }
  offerGold() { setTimeout(() => this.ui.modal(`<h2>골드가 부족합니다</h2><p>보석으로 골드를 즉시 충전할 수 있어요</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">나중에</button><button class="btn btn-gold" id="m-ok">골드 상점</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { this.ui.closeModal(); this.openTab('shop', 'gold'); }; } }), 600); }

  // ================= 가챠 =================
  refreshGacha() { const f = HEROES[GACHA.featured]; $('banner-title').textContent = f.name; $('banner-art').src = '/img/banner_featured.webp'; $('banner-art').onerror = () => { $('banner-art').src = f.portrait; }; this.refreshTop(); this.trackFunnel('gacha_view', { pity: clampPity(this.eco.s.pity) }); }
  /** 로컬 퍼널 기록. 계측 실패가 화면 흐름을 막지 않는다. */
  trackFunnel(name, payload) { try { return funnelFor(this.app).track(name, payload); } catch { return { ok: false, reason: 'unavailable' }; } }
  /** 배너·하단 카운터를 실제 확률식으로 채운다. s.pity는 마지막 SSR 이후 누적 횟수라 다음 소환 순번은 s.pity + 1이다. */
  /** SSR 확정권 1장이 초월 일수를 며칠 줄이는지(economy-pace). 없으면 줄을 숨긴다. */
  refreshGachaPace() {
    const pace = paceShort('ssrTicket'), line = $('gacha-pace'), tag = $('pace-ssr');
    if (line) { line.hidden = !pace; line.textContent = pace ? 'SSR 확정권 1장 · ' + pace.text + ' (' + pace.saved + ') · ' + pace.basis : ''; if (pace) line.title = pace.full; }
    if (tag) { tag.hidden = !pace; tag.textContent = pace ? pace.saved + ' 단축' : ''; }
  }
  refreshGachaOdds() {
    const rates = gachaRates(), pity = clampPity(this.eco.s.pity), next = gachaChances(pity + 1).SSR, left = Math.max(1, GACHA.pity - pity);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const soft = softStart(rates);
    set('banner-ssr', pct(rates.base.SSR)); set('banner-pickup', pct(rates.ssrSplit.featuredHero, 0)); set('banner-soft', String(soft));
    set('gacha-odds', pity + 1 >= soft
      ? ` 확률 상승 중 · 다음 소환 SSR ${pct(next, 1)} · ${left}회 안에 SSR 확정`
      : ` 다음 소환 SSR ${pct(next, 1)} · ${soft}번째부터 확률 상승 · ${left}회 안에 SSR 확정`);
  }
  async pull(n) {
    // 결과 화면이 열려 있는 동안에는 어떤 소환도 다시 시작하지 않는다(리뷰 P1: 초점이 남은 버튼 Enter 반복으로 재화가 추가 소모되고 앞 결과가 사라짐).
    if (this._revealOpen) return;
    const s = this.eco.s; const cost = n === 10 ? GACHA.ten : GACHA.single; const useTicket = n === 1 ? s.tickets > 0 : s.tickets >= 10;
    if (!useTicket && s.gems < cost) { audio.play('ui_error'); const ok = await this.ui.confirm('보석 부족', `보석 ${fmt(cost)}개가 필요합니다 (보유 ${fmt(s.gems)})<br>보석은 출석·임무·스테이지 첫 클리어·패스 무료 보상으로 모을 수 있어요.`, { ok: '보석 상점 보기', cancel: '취소' }); if (ok) this.openTab('shop', 'gem'); return; }
    const pityBefore = clampPity(s.pity);
    const results = this.eco.pull(n); if (!results) { if (this.eco.lastGachaError === 'storage') this.ui.toast('저장 실패로 소환을 취소했습니다. 재화와 천장은 그대로입니다.', 'red'); else if (this.eco.lastGachaError === 'insufficient-funds') this.ui.toast('소환 재화가 부족합니다.', 'red'); return; }
    this.trackPull(n, useTicket ? 'tickets' : 'gems', pityBefore, results);
    this.showReveal(results);
  }
  pullSSR() { if (this._revealOpen) return; const pityBefore = clampPity(this.eco.s.pity); const r = this.eco.pullSSR(); if (!r) { this.ui.toast(this.eco.lastGachaError === 'storage' ? '저장 실패로 SSR 확정권 사용을 취소했습니다.' : '사용할 SSR 확정권이 없습니다.', 'red'); return; } this.trackPull(1, 'ssr_ticket', pityBefore, r); this.showReveal(r); }
  trackPull(count, currency, pityBefore, results) {
    const n = (rar) => results.filter((r) => r.rar === rar).length;
    this.trackFunnel('gacha_pull', { count, currency, pityBefore, ssr: n('SSR'), sr: n('SR'), dupes: results.filter((r) => r.type === 'hero' && r.dup).length });
  }
  showReveal(results) {
    this._revealOpen = true; (this._revealTimers || []).forEach(clearTimeout);
    const R = $('reveal'); this.ui.show(R, true); this.app.setLobbyVisible(false);
    const stage = $('reveal-stage'), cards = $('reveal-cards'); stage.innerHTML = ''; cards.innerHTML = ''; $('reveal-foot').classList.add('hidden'); $('btn-reveal-skip').classList.remove('hidden');
    $('btn-reveal-skip').focus({ preventScroll: true });
    // 연출 계획은 이미 정해진 결과를 어떻게 보여 줄지만 정한다(결과·확률은 그대로).
    const plan = revealPlan(results), best = plan.best, beamColor = plan.tone.color;
    stage.style.setProperty('--c', beamColor); R.dataset.best = best;
    audio.playMusic(musicForScene({ scene: 'gacha' }), MUSIC_MIX); audio.play('pack_open', { vol: 0.8 }); audio.gachaCharge();
    this._revealTimers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); this._revealTimers.push(t); };
    // 충전: 최고 등급 색의 빛무리가 커지며 기대감을 만든다
    const charge = document.createElement('div'); charge.className = 'charge'; stage.appendChild(charge);
    // 광선 연출: 최고 등급이 높을수록 빔이 많고 길게 이어진다 (SSR이면 금색 빔 + 진동)
    later(() => { for (let i = 0; i < plan.tone.beams; i++) { const b = document.createElement('div'); b.className = 'beam'; b.style.setProperty('--c', beamColor); b.style.left = (50 + (i - (plan.tone.beams - 1) / 2) * 8) + '%'; b.style.animationDelay = i * 0.08 + 's'; stage.appendChild(b); } audio.play('ui_max', { vol: 0.7, rate: best === 'SSR' ? 0.6 : 1 }); if (best === 'SSR') { audio.vibe([50, 50, 50, 50, 200]); } }, 400);
    later(() => { charge.remove(); const f = document.createElement('div'); f.className = 'flash'; f.style.setProperty('--c', beamColor); stage.appendChild(f); audio.gachaReveal(best); }, plan.tone.charge);
    results.forEach((r, i) => {
      const c = document.createElement('div'); c.className = 'rcard' + (results.length === 1 ? ' single' : '') + ' ' + r.rar; c.style.setProperty('--rc', RC[r.rar]);
      const img = r.type === 'hero' ? r.img : r.type === 'material' ? resourceArt(r.k) : itemVisual(ITEM_BY_ID[r.item.id], { heroId: this.eco.s.selected }).iconUrl; const name = r.type === 'hero' ? r.name : r.type === 'material' ? (REWARD_LABEL[r.k]?.[0] || r.k) + ' ×' + r.n : ITEM_BY_ID[r.item.id].name;
      const sub = r.type === 'hero' ? (r.dup ? this.dupShardText(r) : '') : r.type === 'material' ? (r.k === 'transcendStones' ? '초월 재료' : '강화 재료') : ITEM_BY_ID[r.item.id].slot === 'weapon' ? (weaponLook(this.eco.s.selected, r.item, LOOKS)?.form || '') : SLOT_NAME[ITEM_BY_ID[r.item.id].slot];
      // 영웅 일러스트는 카드를 가득 채우고, 장비·재료 아이콘은 잘리지 않게 안쪽에 맞춘다
      c.innerHTML = `<div class="inner"><div class="face back">?</div><div class="face front ${r.type === 'hero' ? 'is-portrait' : 'is-icon'}"><img src="${img}" onerror="this.remove()"><span class="rr">${r.rar}</span>${r.type === 'hero' && !r.dup ? '<span class="new">NEW</span>' : ''}<div class="nm">${name}${sub ? `<br><small style="color:var(--muted)">${sub}</small>` : ''}</div></div></div>`;
      cards.appendChild(c);
      const step = plan.cards[i];
      if (step.hintAt !== null) later(() => c.classList.add('hint'), step.hintAt);
      later(() => { c.classList.remove('hint'); c.classList.add('flip'); if (r.rar === 'SSR') { audio.gachaCard('SSR'); audio.vibe([30, 30, 100]); const f = document.createElement('div'); f.className = 'flash'; f.style.setProperty('--c', '#ffcf5a'); stage.appendChild(f); setTimeout(() => f.remove(), 800); } else audio.gachaCard(r.rar); }, step.at);
    });
    later(() => this.revealDone(), plan.doneAt + 300);
    this._revealResults = results;
  }
  revealSkip() { this._revealTimers.forEach(clearTimeout); document.querySelectorAll('.rcard').forEach((c) => { c.classList.remove('hint'); c.classList.add('flip'); }); $('reveal-stage').querySelectorAll('.charge,.beam').forEach((e) => e.remove()); audio.play('card_fan', { vol: 0.6 }); this.revealDone(); }
  /** 중복 영웅 결과: 받은 조각과 다음 초월까지의 진행(조각은 이미 지급된 뒤의 보유량). */
  dupShardText(r) {
    const p = shardProgress(HEROES[r.id], this.eco.hero(r.id));
    return '조각 +' + r.shards + (p.need ? ' · 초월 ' + p.have + '/' + p.need : ' · 최고 등급');
  }
  revealDone() {
    $('reveal-foot').classList.remove('hidden'); $('btn-reveal-skip').classList.add('hidden');
    // 재화가 모자라도 버튼을 끄지 않는다. 얼마가 부족한지 보여 주고, 누르면 기존 보석 부족 안내(상점 연결)가 뜬다.
    const st = tenPullStatus(this.eco.s, GACHA), again = $('btn-reveal-again'), cost = again.querySelector('small');
    again.disabled = false; again.classList.toggle('is-short', !st.ok); again.setAttribute('aria-disabled', st.ok ? 'false' : 'true');
    if (cost) cost.innerHTML = st.ok ? `<i class="ic ic-gem"></i> ${st.label}` : `<i class="ic ic-gem"></i> ${fmt(st.need)} 부족 · 필요 ${fmt(GACHA.ten)}`;
    again.title = st.ok ? '' : `보석 ${fmt(st.need)}개가 더 필요합니다 (보유 ${fmt(this.eco.s.gems)})`;
    $('btn-reveal-close').focus({ preventScroll: true });
  }
  revealClose() { this._revealOpen = false; this.ui.show($('reveal'), false); this.app.setLobbyVisible(this.tab === 'home'); audio.playMusic(musicForScene({ scene: 'lobby' }), MUSIC_MIX); this.refreshTop(); if (this._revealResults?.some((r) => r.type === 'hero' && !r.dup)) this.ui.toast('새 영웅 획득! 영웅 탭에서 출전 설정', 'gold'); }
  showGachaContents(filter) { return showGachaContents.call(this, filter); }
  showWeaponPreview(itemId, heroId, enh) { return showWeaponPreview.call(this, itemId, heroId, enh); }
  showRates() {
    const rates = gachaRates(), b0 = rates.base, sp = rates.ssrSplit, pity = clampPity(this.eco.s.pity);
    const featured = HEROES[GACHA.featured]?.name || '픽업 영웅', others = sp.otherHeroes.map((id) => HEROES[id]?.name).filter(Boolean).join(', ');
    const row = (label, p, color = '') => `<tr><th scope="row">${label}</th><td${color ? ` style="color:var(${color})"` : ''}>${pct(p, 2)}</td></tr>`;
    const at = (k) => pct(rates.ssrByPull[k - 1], 1);
    const soft = softStart(rates), hard = rates.hardPity;
    const matRows = (grade, color) => (rates.materials[grade] || []).map((m) => row(`${grade} 강화 재료 · ${REWARD_LABEL[m.k]?.[0] || m.k} ×${m.n}`, b0[grade] * m.w, color)).join('');
    this.ui.modal(`<h2>소환 확률</h2><p class="setting-help">1회 소환 기준 확률입니다. 10회 소환의 SR 이상 보장은 제외했습니다.</p><button class="btn btn-blue btn-sm" id="m-contents" style="width:100%;margin:4px 0">구성품 전체 보기 · 무기 외형 미리보기</button><table class="rates-table" aria-label="소환 등급별 확률">${row(`SSR 픽업 영웅 · ${featured}`, b0.SSR * sp.featuredHero, '--r-ssr')}${sp.otherSsrHero ? row(`SSR 다른 영웅${others ? ` · ${others}` : ''}`, b0.SSR * sp.otherSsrHero, '--r-ssr') : ''}${row('SSR 장비', b0.SSR * sp.ssrGear, '--r-ssr')}${matRows('SSR', '--r-ssr')}${row('SR 영웅', b0.SR * rates.srSplit.hero, '--r-sr')}${row('SR 장비', b0.SR * rates.srSplit.gear, '--r-sr')}${matRows('SR', '--r-sr')}${row('R 장비', b0.R * rates.rSplit.gear)}${matRows('R', '')}</table>
      <p>SSR이 나오면 ${pct(sp.featuredHero, 0)} 확률로 픽업 영웅 ${featured}입니다.<br>${soft}번째 소환부터 SSR 확률이 오릅니다 (${soft}번째 ${at(soft)} · ${Math.min(hard - 1, soft + 9)}번째 ${at(Math.min(hard - 1, soft + 9))} · ${hard - 1}번째 ${at(hard - 1)}). ${hard}번째 소환은 SSR 확정입니다.<br>천장을 포함한 평균은 SSR 1회당 약 ${rates.expectedPullsPerSsr.toFixed(1)}회 (통합 SSR ${pct(rates.consolidatedSsr, 2)})입니다.<br>10회 소환은 SR 이상 1장을 보장합니다. 이미 가진 영웅이 나오면 조각 ${rates.dupShards}개로 바뀝니다.</p>
      <p><b>현재 누적 ${pity}회</b> · 다음 소환 SSR ${pct(gachaChances(pity + 1).SSR, 1)} · ${Math.max(1, hard - pity)}회 안에 SSR 확정</p>${this.eco.s.ssrTickets ? `<button class="btn btn-gold" style="width:100%" id="m-ssr">SSR 확정권 사용 (${this.eco.s.ssrTickets})</button>` : ''}<div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-contents').onclick = () => this.showGachaContents(); const s = b.querySelector('#m-ssr'); if (s) s.onclick = () => { this.ui.closeModal(); this.pullSSR(); }; } });
  }

  // ================= 상점 =================
  renderAvatarShop(grid) {
    const owned = this.eco.s.avatars.owned, equipped = this.eco.s.avatars.equipped;
    for (const avatar of AVATARS) {
      const hero = HEROES[avatar.heroId], ready = !!libraryAssetForAvatar(avatar.id), isOwned = owned.includes(avatar.id), isEquipped = equipped[avatar.heroId] === avatar.id;
      const d = document.createElement('div'); d.className = 'shop-item avatar-shop-item' + (ready ? '' : ' avatar-pending');
      d.innerHTML = `<img src="${avatar.portrait || hero.portrait}" alt="${hero.name}" onerror="this.remove()"><div class="si-body"><div class="si-name">${avatar.name}</div><div class="si-desc">${hero.name}</div><div class="si-desc">${avatar.desc}</div><button class="btn ${isOwned ? 'btn-ghost' : 'btn-gold'}" data-avatar="${avatar.id}" ${ready ? '' : 'disabled'}>${ready ? (isOwned ? (isEquipped ? '착용 중 · 해제' : '보유 중 · 착용') : `<i class="ic ic-gem"></i> ${fmt(avatar.price)} 보석`) : '준비 중'}</button></div>`;
      d.querySelector('[data-avatar]').onclick = () => this.buyOrEquipAvatar(avatar.id);
      grid.appendChild(d);
    }
  }
  async buyOrEquipAvatar(id) {
    const avatar = AVATARS.find((entry) => entry.id === id), s = this.eco.s;
    if (!avatar || !libraryAssetForAvatar(id)) { this.ui.toast('아바타가 아직 준비되지 않았습니다.', 'red'); return; }
    const owned = s.avatars.owned.includes(id), equipped = s.avatars.equipped[avatar.heroId] === id;
    if (!owned) {
      if (s.gems < avatar.price) { this.ui.toast(`보석 부족 · ${fmt(avatar.price)}개 필요`, 'red'); return; }
      if (!await this.ui.confirm('아바타 구매', `${avatar.name}을(를) ${fmt(avatar.price)} 보석으로 구매할까요?\n${avatar.desc}`)) return;
      const bought = this.eco.buyAvatar(id); if (!bought.ok) { this.ui.toast('아바타를 구매하지 못했습니다.', 'red'); return; }
    }
    const result = this.eco.equipAvatar(avatar.heroId, equipped ? null : id);
    if (!result.ok) { this.ui.toast('아바타 착용 상태를 바꾸지 못했습니다.', 'red'); return; }
    this.ui.toast(equipped ? `${avatar.name} 해제` : `${avatar.name} 착용`, 'gold');
    if (this.eco.s.selected === avatar.heroId) this.app.showcaseHero(avatar.heroId);
    this.renderShop(); this.refreshTop();
  }
  renderShop() {
    const visibleTabs = this.shopTabs();
    if (this.shopTab !== 'avatar' && !visibleTabs.some((t) => t.id === this.shopTab)) this.shopTab = visibleTabs[0]?.id ?? 'hot';
    const pay = this.payOn();
    const tabs = $('shop-tabs'); tabs.innerHTML = visibleTabs.map((t) => `<button data-t="${t.id}" class="${t.id === this.shopTab ? 'on' : ''}">${t.name}</button>`).join('');
    tabs.querySelectorAll('button').forEach((b) => b.onclick = () => { if (this.shopTab === b.dataset.t) return; this.shopTab = b.dataset.t; this.renderShop(); this.trackFunnel('shop_view', { tab: this.shopTab }); });
    this.renderShopFlow();
    const notice = $('shop-notice');
    if (notice) notice.innerHTML = this.shopTab === 'avatar' ? '<b>아바타는 보석으로 구매하는 순수 외형 상품입니다.</b> 전투 수치에는 영향이 없습니다.'
      : (pay && (this.shopTab === 'gem' || this.shopTab === 'hot') ? '첫 결제 보너스는 확인된 구매에 상품별 1회 적용됩니다.<br>' : '')
      + `무료 보석: 출석·임무·첫 클리어·패스 무료 보상 / 사용: 소환 ${fmt(GACHA.single)} (10회 ${fmt(GACHA.ten)})·강화 재료·골드·에너지`;
    const grid = $('shop-grid'); grid.innerHTML = ''; const s = this.eco.s;
    if (this.shopTab === 'avatar') { this.renderAvatarShop(grid); return; }
    for (const sku of this.shopSkus()) {
      const d = document.createElement('div'); const big = sku.tab === 'hot' || sku.tab === 'pack'; d.className = 'shop-item' + (sku.badge ? ' hot' : '') + (big ? ' big' : '');
      const first = sku.gems && !s.firstPurchaseUsed[sku.id]; const sold = sku.once && s.purchases.includes(sku.id);
      const cash = sku.kind === 'cash';
      const price = sku.kind === 'gem' ? `<i class="ic ic-gem"></i> ${sku.price}` : sku.priceLabel;
      // 현금 상품은 결제가 연결됐을 때만 이 목록에 온다. 보석 상품은 1개당 가격으로 비교할 수 있게 한다.
      const value = cash && sku.gems ? `<div class="si-desc">기본 ${fmt(sku.gems)}개 · 1개당 ₩${(sku.price / sku.gems).toFixed(1)}</div>` : '';
      d.innerHTML = `${sku.badge ? `<span class="badge">${sku.badge}</span>` : ''}${first ? '<span class="badge first" style="left:auto;right:-4px;transform:rotate(5deg)">첫 결제 보너스</span>' : ''}<img src="${sku.icon}" alt="" onerror="this.remove()"><div class="si-body"><div class="si-name">${sku.name}</div><div class="si-desc">${sku.desc || ''}</div>${value}${sku.gems ? `<div class="si-bonus">${first ? `첫 결제 시 +${fmt(sku.bonus)}` : `+${fmt(Math.floor(sku.gems * 0.1))} 보너스`}</div>` : ''}${sku.limited ? `<div class="timer" data-timer="${sku.id}">남은 시간 ${hms(this.eco.limitedLeft(sku))}</div>` : ''}<button class="btn ${sku.kind === 'gem' ? 'btn-blue' : 'btn-gold'}"${cash ? ` aria-label="${sku.name} ${sku.priceLabel}"` : ''}>${price}</button></div>${sold ? '<div class="sold">구매 완료</div>' : ''}`;
      const role = skuFlowRole(sku);
      if (role) { const tag = document.createElement('div'); tag.className = 'si-flow'; tag.dataset.role = role.role; tag.textContent = role.label; d.querySelector('.si-name').after(tag); }
      const pace = paceShort(sku.id);
      if (pace) { const line = document.createElement('div'); line.className = 'si-pace'; line.title = pace.full; line.setAttribute('aria-label', pace.full); line.innerHTML = '<b>' + pace.text + '</b> <em>' + pace.saved + '</em><small>' + pace.basis + '</small>'; (d.querySelector('.si-flow') || d.querySelector('.si-name')).after(line); }
      d.querySelector('button').onclick = () => this.buy(sku.id);
      grid.appendChild(d);
    }
  }
  /** 상점 위 성장 흐름 줄: 보석 → 소환 → 중복 조각 → 초월 → 더 강한 전투. 각 단계는 실제 화면으로 이어진다. */
  renderShopFlow() {
    let row = $('shop-flow');
    if (!row) { row = document.createElement('nav'); row.id = 'shop-flow'; row.className = 'shop-flow'; row.setAttribute('aria-label', '성장 흐름'); $('shop-notice')?.before(row); }
    if (!row) return;
    const s = this.eco.s, h = this.eco.hero(), p = shardProgress(HEROES[s.selected], h);
    const value = { gems: fmt(s.gems), summon: '소환권 ' + s.tickets + (s.ssrTickets ? ' · 확정권 ' + s.ssrTickets : ''), shards: p.need ? p.have + '/' + p.need : '최고', transcend: p.next ? p.grade + '→' + p.next : p.grade, battle: '' };
    const go = { gems: () => { if (this.payOn()) { this.shopTab = 'gem'; this.renderShop(); } else this.ui.toast('보석은 출석·임무·첫 클리어·패스 무료 보상으로 모을 수 있어요'); }, summon: () => this.openTab('gacha'), shards: () => this.openTab('gacha'), transcend: () => { this.heroSel = s.selected; this.openTab('heroes'); this.openTranscend(s.selected); }, battle: () => this.openTab('home') };
    row.replaceChildren();
    GROWTH_FLOW.forEach((step, i) => {
      if (i) { const a = document.createElement('span'); a.className = 'sf-arrow'; a.setAttribute('aria-hidden', 'true'); a.textContent = '›'; row.append(a); }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sf-step'; b.dataset.step = step.id; b.title = step.hint;
      b.innerHTML = `<b></b>${value[step.id] ? '<small></small>' : ''}`; b.querySelector('b').textContent = step.label; if (value[step.id]) b.querySelector('small').textContent = value[step.id];
      b.setAttribute('aria-label', step.label + (value[step.id] ? ' ' + value[step.id] : '') + ', ' + step.hint);
      b.onclick = go[step.id]; row.append(b);
    });
  }
  /** 구매 실패를 조용히 넘기지 않고 이유별 문구로 알린다. */
  purchaseFailText(result) {
    const reason = result?.reason;
    if (reason === 'storage') return '저장하지 못해 구매를 취소했습니다';
    if (reason === 'payment-unavailable') return '스토어 결제가 아직 연결되지 않아 구매할 수 없습니다';
    if (reason === 'once') return '이미 구매한 상품입니다';
    if (reason === 'gems') return '보석이 부족합니다';
    return '구매하지 못했습니다';
  }
  async buy(id) {
    const sku = this.eco.sku(id); if (!sku) return; const s = this.eco.s;
    if (sku.once && s.purchases.includes(id)) { this.ui.toast('이미 구매한 상품입니다', 'red'); return; }
    if (sku.kind === 'gem') { if (s.gems < sku.price) { audio.play('ui_error'); const ok = await this.ui.confirm('보석 부족', `보석 ${fmt(sku.price)}개가 필요합니다 (보유 ${fmt(s.gems)})<br>보석은 출석·임무·스테이지 첫 클리어·패스 무료 보상으로 모을 수 있어요.`, this.payOn() ? { ok: '보석 탭 보기' } : { ok: '확인', cancel: null }); if (ok && this.payOn()) this.openTab('shop', 'gem'); return; } const r = this.eco.purchase(id); if (!r?.ok) { this.ui.toast(this.purchaseFailText(r), 'red'); return; } audio.pick('coin', 2, { vol: 0.7 }); this.ui.rewardToast(r.got); this.renderShop(); this.refreshTop(); return; }
    // 현금 구매는 항상 paySheet만 거친다. 열림만 기록하고 성공·지급은 기록하지 않는다.
    this.trackFunnel('paysheet_open', { sku: id });
    const ok = await this.ui.paySheet(sku); if (!ok) return;
    const r = this.eco.purchase(id); if (!r?.ok) { this.ui.toast(this.purchaseFailText(r), 'red'); return; }
    this.ui.purchaseDone(sku, r.got, r.vipUp ? `<p style="color:var(--gold);font-weight:900">VIP ${r.vipUp} 달성!</p>` : (r.got.first ? '<p style="color:var(--green);font-weight:900">첫 결제 보너스 적용!</p>' : ''));
    if (this.tab === 'shop') this.renderShop(); this.refreshTop();
  }

  // ================= 배틀패스 =================
  renderPass() {
    const eco = this.eco; const p = eco.s.pass; const lv = eco.passLevel; $('pass-lv').textContent = lv; $('pass-fill').style.width = (p.xp % BATTLE_PASS.xpPerLevel) + '%'; $('pass-xp').textContent = `${p.xp % BATTLE_PASS.xpPerLevel}/${BATTLE_PASS.xpPerLevel}`;
    const pay = this.payOn(), showPrem = pay || p.premium; // 결제 없이 살 수 없는 프리미엄 줄은 숨긴다(이미 해금한 저장은 그대로 보인다).
    $('btn-pass-buy').style.display = showPrem ? (p.premium ? 'none' : '') : 'none';
    const tr = $('pass-track'); tr.innerHTML = '';
    const cell = (r, prem, l) => { const claimed = (prem ? p.claimedPrem : p.claimedFree).includes(l); const can = l <= lv && !claimed && (!prem || p.premium); const k = Object.keys(r)[0]; const [nm, ic] = REWARD_LABEL[k]; return `<div class="pass-cell ${prem ? 'prem' : ''} ${l > lv || (prem && !p.premium) ? 'lock' : ''} ${can ? 'claim' : ''} ${claimed ? 'done' : ''}" data-lv="${l}" data-prem="${prem ? 1 : 0}"><img src="${RESOURCE_ART[k]?resourceArt(k):ic}" onerror="this.remove()"><span>${nm} ${fmt(r[k])}</span></div>`; };
    PASS_TRACK.forEach((t) => { const d = document.createElement('div'); d.className = 'pass-col' + (t.lv <= lv ? ' reached' : ''); d.innerHTML = `<div class="plv">Lv.${t.lv}</div>${cell(t.free, false, t.lv)}${showPrem ? cell(t.prem, true, t.lv) : ''}`; tr.appendChild(d); });
    tr.querySelectorAll('.pass-cell').forEach((c) => c.onclick = () => { const l = +c.dataset.lv, prem = c.dataset.prem === '1'; if (prem && !p.premium) { this.buyPass(); return; } const got = eco.claimPass(l, prem); if (got) { if (!prem) this.trackFunnel('reward_claim', { source: 'pass_free' }); audio.pick('coin', 2, { vol: 0.6 }); this.ui.rewardToast(got); this.renderPass(); } });
    // 현재 레벨로 스크롤
    const col = tr.children[Math.max(0, lv - 2)]; if (col) tr.scrollLeft = col.offsetLeft - 20;
  }
  async buyPass() {
    if (this.eco.s.pass.premium) return;
    const sku = { id: 'pass', name: '시즌 패스 프리미엄', priceLabel: '₩9,900', icon: '/img/icon_pass.webp', desc: '프리미엄 보상 30단계 해금 · SSR 확정권 3장 포함' };
    this.trackFunnel('paysheet_open', { sku: sku.id });
    const ok = await this.ui.paySheet(sku); if (!ok) return; const result = this.eco.buyPass(); if (!result?.ok) { this.ui.toast(this.purchaseFailText(result), 'red'); return; } this.ui.purchaseDone(sku, [{ k: 'gems', n: 0 }].filter((x) => x.n)); this.renderPass();
  }

  // ================= 출석 / 우편 / 임무 / 설정 =================
  showDaily() {
    const d = this.eco.s.daily; const avail = this.eco.dailyAvailable(); const idx = d.day % DAILY_REWARDS.length;
    this.ui.modal(`<h2 class="ui-resource"><img src="${uiArt('calendar')}" alt="">출석 보상</h2><p>매일 접속하고 보상을 받으세요! 7일차 SSR 확정권</p><div class="daily-grid">${DAILY_REWARDS.map((r, i) => { const k = Object.keys(r)[0]; const [nm, ic] = REWARD_LABEL[k]; const got = i < idx || (!avail && i === idx - 1 && false); return `<div class="daily-cell ${i < idx ? 'got' : ''} ${avail && i === idx ? 'today' : ''} ${i === 6 ? 'big' : ''}"><img src="${RESOURCE_ART[k]?resourceArt(k):ic}" onerror="this.remove()"><span>${i + 1}일차</span><b>${nm} ${r[k]}</b></div>`; }).join('')}</div><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button><button class="btn btn-gold" id="m-ok" ${avail ? '' : 'disabled'}>${avail ? '보상 받기' : '내일 다시'}</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { const r = this.eco.claimDaily(); if (r) { this.trackFunnel('reward_claim', { source: 'daily', day: idx + 1 }); audio.play('jingle_win0', { vol: 0.6 }); this.ui.rewardToast(r.got); } this.ui.closeModal(); }; } });
  }
  showMail() {
    const mails = this.eco.s.mail;
    this.ui.modal(`<h2 class="ui-resource"><img src="${uiArt('mail')}" alt="">우편함</h2>${mails.map((m) => `<div class="mail-item"><div class="mi-body"><div class="mi-t">${m.title}</div><div class="mi-d">${m.body}</div></div><button class="btn btn-gold btn-sm" data-mail="${m.id}" ${m.read ? 'disabled' : ''}>${m.read ? '수령' : '받기'}</button></div>`).join('') || '<p>우편이 없습니다</p>'}<div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelectorAll('[data-mail]').forEach((x) => x.onclick = () => { const got = this.eco.claimMail(+x.dataset.mail); if (got) { this.trackFunnel('reward_claim', { source: 'mail' }); audio.pick('coin', 2); this.ui.rewardToast(got); x.disabled = true; x.textContent = '수령'; } }); } });
  }
  showQuests() {
    const qs = this.eco.quests();
    this.ui.modal(`<h2 class="ui-resource"><img src="${uiArt('nav-quests')}" alt="">임무</h2>${qs.map((q) => `<div class="quest-item"><img class="quest-art" src="${uiArt('nav-quests')}" alt=""><div class="qi-body"><div>${q.name}</div><div class="bar"><div style="width:${Math.min(100, q.cur / q.max * 100)}%"></div></div><div style="font-size:10px;color:var(--muted)">${Math.min(q.cur, q.max)}/${q.max} · ${Object.entries(q.r).map(([k, v]) => `${REWARD_LABEL[k][0]} ${v}`).join(', ')}</div></div><button class="btn btn-gold btn-sm" data-q="${q.id}" ${q.done && !q.claimed ? '' : 'disabled'}>${q.claimed ? '완료' : '받기'}</button></div>`).join('')}<div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelectorAll('[data-q]').forEach((x) => x.onclick = () => { const got = this.eco.claimQuest(x.dataset.q); if (got) { this.trackFunnel('reward_claim', { source: 'quest' }); audio.pick('coin', 2); this.ui.rewardToast(got); x.disabled = true; x.textContent = '완료'; } }); } });
  }
  showSettings() {
    const st = this.eco.s.settings;
    if (st.voice === undefined) st.voice = true;
    const row = (k, label) => `<div class="setting-row"><span>${label}</span><button type="button" class="toggle ${st[k] ? 'on' : ''}" data-k="${k}" role="switch" aria-label="${label}" aria-checked="${!!st[k]}"></button></div>`;
    // 화면 흔들림은 저장값이 null 이면 동작 줄이기 선호에 따른 실제 상태를 보여 준다.
    const shakeOn = this.app.screenShakeOn();
    const shakeRow = `<div class="setting-row"><span>화면 흔들림</span><button type="button" class="toggle ${shakeOn ? 'on' : ''}" data-k="screenShake" role="switch" aria-label="화면 흔들림" aria-checked="${shakeOn}"></button></div>`;
    const mix=this.app.arsenal.s.mix;
    const touchControls = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const controlHelp = touchControls ? '왼쪽 조이스틱으로 이동 · 오른쪽 공격·회피 버튼 · 스킬 버튼 6개로 전투 · 빈 화면 드래그로 시점 회전, 두 손가락으로 확대'
      : '이동 WASD · 공격 J/Space · 회피 K/Shift · 스킬 1~6 (4~6은 R/Q/E도 가능)';
    const mixRows=[['sfx','효과음 음량'],['music','배경음악 음량'],['voice','목소리 음량']].map(([key,label])=>`<div class="setting-row"><label for="mix-${key}">${label}</label><div class="setting-mix"><input id="mix-${key}" data-mix="${key}" type="range" min="0" max="100" step="1" value="${Math.round(mix[key]*100)}"><output for="mix-${key}">${Math.round(mix[key]*100)}%</output></div></div>`).join('');
    this.ui.modal(`<h2 class="ui-resource"><img src="${uiArt('settings')}" alt="">설정</h2>${row('sfx', '효과음')}${row('music', '배경음악')}${row('voice', '나레이션')}${row('haptics', '진동')}${row('autoTarget', '공격 자동 타겟팅')}${shakeRow}<div class="setting-row setting-description"><span id="haptic-help" class="setting-help">${typeof navigator.vibrate === 'function' ? '일반 명중은 짧게, 마무리는 강하게 진동합니다. 기기·브라우저·시스템 설정에 따라 작동하지 않을 수 있습니다.' : '이 브라우저는 기기 진동을 지원하지 않습니다. 명중 반동과 타격음은 유지됩니다.'}</span></div><div class="setting-row"><span>그래픽</span><div class="seg">${['auto','low', 'mid', 'high'].map((q) => `<button data-q="${q}" class="${(st.quality||'auto') === q ? 'on' : ''}">${{auto:'자동',low: '낮음', mid: '보통', high: '높음' }[q]}</button>`).join('')}</div></div><div class="setting-row"><span>카메라</span><div class="seg">${['auto', 'top', 'action', 'wide'].map((c) => `<button data-cam="${c}" class="${(st.camera || 'auto') === c ? 'on' : ''}">${{ auto: 'AUTO', top: '탑다운', action: '액션', wide: '시네마틱' }[c]}</button>`).join('')}</div></div>
      <div class="setting-row setting-description"><span id="cam-desc" class="setting-help">${CAM_DESC[st.camera || 'auto']}</span></div>
      ${row('cameraInvertX', '카메라 좌우 반전')}${row('cameraInvertY', '카메라 상하 반전')}<div class="setting-row setting-description"><span class="setting-help">시점을 끌어 돌릴 때 기본은 손가락을 끄는 쪽으로 화면이 따라옵니다. 반대가 편하면 켜세요. 로비·마을·전투에 바로 적용됩니다.</span></div>
      <div class="setting-row"><span>조작</span><span id="input-help" class="setting-help">${controlHelp}</span></div>
      <div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>
      <details class="danger-zone"><summary>위험 구역 · 데이터 초기화</summary><div class="danger-body"><p>모든 진행 데이터(영웅·장비·재화·진행도)가 삭제되고 되돌릴 수 없습니다.</p><button type="button" class="btn btn-red btn-sm" id="m-reset">데이터 초기화</button><div class="danger-confirm" id="m-reset-confirm" hidden role="alert"><p><b>정말 초기화할까요?</b> 이 작업은 되돌릴 수 없습니다.</p><div class="danger-confirm-btns"><button type="button" class="btn btn-ghost btn-sm" id="m-reset-no">취소</button><button type="button" class="btn btn-red btn-sm" id="m-reset-yes">네, 모두 삭제합니다</button></div></div></div></details>`, { onOpen: (b) => {
      b.querySelector('#m-cancel').onclick = () => this.ui.closeModal();
      b.querySelector('.modal-btns').insertAdjacentHTML('beforebegin',mixRows+'<p id="mix-notice" role="status"></p>');
      const pwa = this.app.pwa, pwaState = pwa?.getState();
      if (pwaState) {
        b.querySelector('.modal-btns').insertAdjacentHTML('beforebegin', '<div class="setting-row"><span>게임 앱</span><button class="btn btn-ghost btn-sm" id="pwa-install">홈 화면에 설치</button></div><p id="pwa-notice" role="status" style="font-size:12px;color:var(--muted)"></p>');
        const install = b.querySelector('#pwa-install'), notice = b.querySelector('#pwa-notice');
        const renderPwa = state => {
          if(!install.isConnected)return window.removeEventListener('bladesurge:pwa-state',onPwaState);
          install.textContent = state.updateAvailable ? '업데이트 적용' : state.installed ? '설치됨' : state.canInstall ? '앱 설치' : '설치 방법';
          install.disabled = state.installed&&!state.updateAvailable;
          if(!state.online)notice.textContent='오프라인 상태입니다. 설치된 앱도 플레이와 동기화에는 인터넷 연결이 필요합니다.';
          else if(state.status==='update-deferred')notice.textContent='전투를 마친 뒤 업데이트를 적용할 수 있습니다.';
          else if(state.status==='update-check-failed')notice.textContent='온라인 상태지만 업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
          else if(state.updateAvailable)notice.textContent='새 버전이 준비됐습니다. 로비에서 적용하면 페이지가 다시 열립니다.';
          else if(state.installed)notice.textContent='홈 화면의 BladeSurge 앱 아이콘으로 실행하면 주소창 없이 즐길 수 있습니다.';
          else if(state.canInstall)notice.textContent='브라우저의 실제 설치 창을 열 수 있습니다.';
          else if(state.platform==='ios')notice.textContent='Safari 공유 버튼을 누른 뒤 “홈 화면에 추가”를 선택하세요.';
          else if(state.platform==='android')notice.textContent='브라우저 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택하세요.';
          else notice.textContent='지원 브라우저 메뉴에서 “앱 설치”를 선택하세요. 플레이에는 인터넷 연결이 필요합니다.';
        };
        if(this._pwaStateListener)window.removeEventListener('bladesurge:pwa-state',this._pwaStateListener);
        const onPwaState=e=>{if(!install.isConnected){window.removeEventListener('bladesurge:pwa-state',onPwaState);if(this._pwaStateListener===onPwaState)this._pwaStateListener=null;return;}renderPwa(e.detail);};
        this._pwaStateListener=onPwaState;window.addEventListener('bladesurge:pwa-state',onPwaState);renderPwa(pwaState);
        b.querySelector('#m-cancel').onclick=()=>{window.removeEventListener('bladesurge:pwa-state',onPwaState);if(this._pwaStateListener===onPwaState)this._pwaStateListener=null;this.ui.closeModal();};
        install.onclick = async () => {
          if (pwa.getState().updateAvailable) { if(!pwa.applyUpdate())renderPwa(pwa.getState());return; }
          const result = await pwa.install();
          if(result.outcome==='accepted')notice.textContent='브라우저가 설치를 진행합니다.';
          else if(result.outcome==='dismissed')notice.textContent='설치를 취소했습니다. 언제든 다시 선택할 수 있습니다.';
          else renderPwa(pwa.getState());
        };
      }
      b.querySelectorAll('[data-mix]').forEach(input=>{input.oninput=()=>{input.nextElementSibling.textContent=input.value+'%';audio.setMix({...this.app.arsenal.s.mix,[input.dataset.mix]:Number(input.value)/100});};input.onchange=()=>{const r=this.app.arsenal.setMix({[input.dataset.mix]:Number(input.value)/100});audio.setMix(this.app.arsenal.s.mix);b.querySelector('#mix-notice').textContent=r.ok?'음량이 저장되었습니다.':r.error;input.value=String(Math.round(this.app.arsenal.s.mix[input.dataset.mix]*100));input.nextElementSibling.textContent=input.value+'%';};});
      b.querySelectorAll('.toggle').forEach((t) => t.onclick = () => { const k = t.dataset.k; st[k] = k === 'screenShake' ? !this.app.screenShakeOn() : !st[k]; const on = k === 'screenShake' ? st[k] : !!st[k]; t.classList.toggle('on', on); t.setAttribute('aria-checked',String(on)); this.app.applySettings(); this.eco.save(); });
      b.querySelectorAll('[data-cam]').forEach((c) => c.onclick = () => { st.camera = c.dataset.cam; b.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x === c)); b.querySelector('#cam-desc').textContent = CAM_DESC[st.camera]; this.app.applySettings(); this.eco.save(); audio.play('ui_open', { vol: 0.3 }); });
      b.querySelectorAll('[data-q]').forEach((q) => q.onclick = () => { st.quality = q.dataset.q; b.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === q)); this.app.applySettings(); this.eco.save(); });
      // 데이터 초기화는 위험 구역 안으로 옮기고, 확인은 창 안의 단계로 둔다(window.confirm 없음).
      const resetBtn = b.querySelector('#m-reset'), resetConfirm = b.querySelector('#m-reset-confirm');
      resetBtn.onclick = () => { resetBtn.hidden = true; resetConfirm.hidden = false; b.querySelector('#m-reset-no').focus({ preventScroll: true }); };
      b.querySelector('#m-reset-no').onclick = () => { resetConfirm.hidden = true; resetBtn.hidden = false; resetBtn.focus({ preventScroll: true }); };
      b.querySelector('#m-reset-yes').onclick = () => { if (this.app.resetProgress()) location.reload(); else this.ui.toast('저장 공간을 초기화하지 못했습니다. 브라우저의 저장 권한을 확인해 주세요.', 'red'); };
    } });
  }
  showProfile() {
    const s = this.eco.s, pay = this.payOn(), vipNext = [0, 1, 20000, 50000, 100000, 300000];
    // VIP·누적 결제 줄은 실제 결제가 연결됐을 때만 보인다. 결제가 없으면 기록만 보여 준다.
    const vip = pay ? `<p>VIP ${s.vip} · 누적 결제 ₩${fmt(s.spentKRW)}<br>${s.vip < 5 ? `다음 VIP까지 ₩${fmt(vipNext[s.vip + 1] - s.spentKRW)}` : '최고 등급'}</p><p>VIP 혜택: 에너지 최대 +50 · 골드 +30%${this.eco.isVip ? ' <b style="color:var(--green)">(활성)</b>' : ' <b style="color:var(--red)">(VIP 멤버십 필요)</b>'}</p>` : '';
    this.ui.modal(`<h2 id="profile-name"></h2>${vip}<p>총 소환 ${s.totalPulls}회 · 처치 ${s.quests.kills} · 클리어 ${s.quests.stages}</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button>${pay ? '<button class="btn btn-gold" id="m-vip">VIP 멤버십</button>' : ''}</div>`, { onOpen: (b) => { b.querySelector('#profile-name').textContent = s.name; b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); const vipButton = b.querySelector('#m-vip'); if (vipButton) vipButton.onclick = () => { this.ui.closeModal(); this.buy('vip_pass'); }; } });
  }
  showGuide({ first = false } = {}) {
    const s = this.eco.s, heroId = s.selected, def = HEROES[heroId], hero = this.eco.hero(heroId);
    const next = this.eco.nextStage(), power = this.eco.heroPower(heroId), completed = campaignFinished(s.progress);
    const nextAwaken = def.skills.find((skill) => skill.unlock && hero.level < skill.unlock)?.unlock;
    const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (!s.guide) s.guide = { seen: false };
    if (!s.guide.seen) { s.guide.seen = true; this.eco.emit(); }
    this.ui.modal(guideHtml({ touch, first, heroName: def.name, heroLevel: hero.level, nextName: next?.name || '다음 원정', nextEnergy: next?.energy || 0, nextPower: next?.recPower || power, power, completed, inventoryCount: s.inventory.length, setCount: this.eco.setCount(), nextAwakening: nextAwaken ? `Lv.${nextAwaken}` : '모든 각성 해금' }), {
      onOpen: (box) => {
        const tabs = [...box.querySelectorAll('[data-guide-tab]')], panels = [...box.querySelectorAll('[data-guide-panel]')];
        const activate = (id) => { tabs.forEach((tab) => { const active = tab.dataset.guideTab === id; tab.classList.toggle('on', active); tab.setAttribute('aria-selected', String(active)); }); panels.forEach((panel) => { panel.hidden = panel.dataset.guidePanel !== id; }); };
        tabs.forEach((tab) => { tab.onclick = () => activate(tab.dataset.guideTab); });
        box.querySelector('#m-guide-close').onclick = () => this.ui.closeModal();
        box.querySelector('#m-guide-next').onclick = () => { this.ui.closeModal(); if (completed) this.app.expeditionUI.open('dungeons', { depth: 'deep' }); else this.openTab('stage'); };
        box.querySelector('#m-guide-close').focus();
      },
    });
  }
  /** 로비 진입 시 첫 모험과 받을 수 있는 무료 출석 보상을 안내한다. */
  autoPopups() {
    if (this.app.mode !== 'lobby' || this.app.companionAgent?.getSnapshot().open || document.querySelector('dialog[open]') || document.getElementById('modal').classList.contains('show')) return;
    if (!this.eco.dailyAvailable()) return;
    // 신규 계정은 첫 전투 결과를 보기 전에는 출석 보상 팝업으로 흐름을 끊지 않는다. 보상은 그대로 남아 있고 첫 전투 뒤 로비·메뉴에서 받는다.
    if (this.dailyDeferrable()) { this.dailyDeferred = true; return; }
    this.dailyDeferred = false;
    this.showDaily();
  }
  /** 아직 한 번도 전투를 끝내지 않은 신규 계정인가. 별 기록·던전 정복이 있는 기존 계정은 해당하지 않는다. */
  dailyDeferrable() {
    if (this.combatResultSeen) return false;
    const stats = this.app.expedition?.s?.stats || {};
    return isFirstSortie(this.eco.s, { history: this.eco.s.masterworks?.history, dungeonsCleared: (Number(stats.dungeonWins) || 0) + (Number(stats.campaignWins) || 0) + (Number(stats.arenaWins) || 0) });
  }
}
