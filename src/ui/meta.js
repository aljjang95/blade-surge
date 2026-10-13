import { $, fmt } from './ui.js';
import { uiArt, resourceArt, RESOURCE_ART } from './illustrated.js';
import { audio } from '../engine/audio.js';
import { musicForScene, MUSIC_MIX } from '../data/music.js';
import { heroVoiceName } from '../engine/hero-voice.js';
import { HEROES, HERO_ORDER, RARITY, heroStats, levelExp, starShards, skillUpGold } from '../data/heroes.js';
import { heroProgressionHtml, trainingButtonLabel } from './hero-progression.js';
import { ITEM_BY_ID, ITEM_ICON, SLOTS, SLOT_NAME, SETS, THEMED_SETS, CRAFT_COST, craftable, itemStats, enhanceCost, enhanceStones, enhanceStoneTier, STONE_KEY, STONE_NAME, enhanceChance, destroyChance, enhanceMult, ENH_MAX, RARITY_COLOR , RARITY_INFO, rarityRank, enhanceDown} from '../data/items.js';
import { SKUS, SHOP_TABS, GACHA, BATTLE_PASS, PASS_TRACK, DAILY_REWARDS } from '../data/shop.js';
import { CHAPTERS, STAGES_PER_CHAPTER, ENEMIES, stageDef } from '../data/stages.js';
import { resolveEnemyPortrait } from '../data/encounter-art.js';
import { REWARD_LABEL, gachaRates, gachaChances } from '../game/economy.js';
import { showGachaContents, showWeaponPreview } from './gacha-contents.js';
import { renderOwnedHero, renderBag, showItemSheet } from './gear-panel.js';
import { weaponLook, weaponLookText } from '../data/weapon-looks.js';
import { LOOKS } from '../game/look.js';
import { createFunnelLog } from '../game/funnel-events.js';
import { campaignFinished } from '../data/expedition-depths.js';
import { storyText, encounterLabel, journalHtml, dungeonBriefHtml } from './campaign.js';
import { guideHtml } from './guide.js';
import { availableDifficulties } from '../game/difficulty.js';
import { AVATARS } from '../data/avatars.js';
import { libraryAssetForAvatar } from '../engine/library-assets.js';
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
  garden: '/img/ui-crafted/dungeon-garden-keyart.png',
  forge: '/img/ui-crafted/dungeon-forge-keyart.png',
  frost: '/img/ui-crafted/dungeon-frost-keyart.png',
  tide: '/img/ui-crafted/dungeon-tide-keyart.png',
  crown: '/img/ui-crafted/dungeon-crown-keyart.png',
  homecoming: '/img/ui-crafted/dungeon-homecoming-keyart.png',
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

const RC = { N: 'var(--r-n)', R: 'var(--r-r)', SR: 'var(--r-sr)', SSR: 'var(--r-ssr)' };
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
    $('promo-starter').addEventListener('click', () => this.buy('starter'));
    $('promo-monthly').addEventListener('click', () => this.buy('monthly'));
    $('btn-pull1').addEventListener('click', () => this.pull(1));
    $('btn-pull10').addEventListener('click', () => this.pull(10));
    $('btn-rates').addEventListener('click', () => this.showRates());
    $('btn-pass-buy').addEventListener('click', () => this.buyPass());
    $('btn-reveal-skip').addEventListener('click', () => this.revealSkip());
    $('btn-reveal-close').addEventListener('click', () => this.revealClose());
    $('btn-reveal-again').addEventListener('click', () => { this.revealClose(); this.pull(10); });
    this.eco.onChange(() => this.refreshTop());
    setInterval(() => this.tick(), 1000);
  }
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
    $('top-vip').textContent = s.vip; $('top-lv').textContent = this.eco.hero().level; $('top-avatar').src = HEROES[s.selected].portrait; $('top-name').textContent = s.name;
    $('dot-daily').classList.toggle('on', this.eco.dailyAvailable()); $('dot-mail').classList.toggle('on', this.eco.unreadMail() > 0); $('dot-quest').classList.toggle('on', this.eco.questClaimable() > 0);
    $('dot-pass').classList.toggle('on', this.eco.passClaimable() > 0); $('dot-gacha').classList.toggle('on', s.tickets > 0 || s.ssrTickets > 0); $('dot-shop').classList.toggle('on', !s.purchases.includes('starter'));
    this.refreshMenuBadge();
    $('v-ticket').textContent = s.tickets + (s.ssrTickets ? ` (SSR확정 ${s.ssrTickets})` : ''); $('v-pity').textContent = s.pity; $('pity-left').textContent = GACHA.pity - s.pity;
    this.refreshGachaOdds();
    $('promo-starter').style.display = s.purchases.includes('starter') ? 'none' : '';
    $('promo-monthly').style.display = s.monthlyUntil > Date.now() ? 'none' : '';
    if (this.tab === 'home') this.refreshHome();
  }
  refreshHome() {
    const s = this.eco.s; const def = HEROES[s.selected]; const nx = this.eco.nextStage();
    $('lobby-hero-name').textContent = def.name; $('lobby-rarity').textContent = def.rarity; $('lobby-rarity').style.background = RC[def.rarity]; $('lobby-power').textContent = fmt(this.eco.heroPower(s.selected));
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
    $('promo-timer').textContent = '결제 연결 준비 중';
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
    const difficultyRequirement = (item) => item.id === 'adept' ? '1개 스테이지 클리어' : item.id === 'nightmare' ? '이 스테이지 ★3' : '기본 난이도';
    const difficultyHtml = difficulties.map((item) => `<button type="button" class="difficulty-card tone-${item.tone}${item.id === selectedDifficulty.id ? ' on' : ''}${item.unlocked ? '' : ' locked'}" data-difficulty="${item.id}" aria-pressed="${item.id === selectedDifficulty.id}" ${item.unlocked ? '' : 'disabled'}><img src="/img/ui/difficulty-${item.id}.svg" alt=""><span class="difficulty-copy"><b>${item.name}</b><small>${item.description}</small></span><span class="difficulty-reward">보상 ×${item.rewardMul.toFixed(2)}</span>${item.unlocked ? '' : `<em>🔒 ${difficultyRequirement(item)}</em>`}</button>`).join('');
    const detailArt = stageKeyArt(d);
    $('stage-detail').innerHTML = `<div class="stage-narrative"><div class="stage-hero-card">${detailArt ? `<img src="${detailArt}" alt="${storyText(d.encounter.name)} 아트" width="1680" height="944" loading="lazy" onerror="this.hidden=true">` : ''}<div class="stage-hero-shade"><span class="campaign-eyebrow">${d.code} · ${storyText(encounterLabel(d))}</span><h3>${storyText(d.title)}</h3><p>${storyText(d.story?.opening)}</p><span class="stage-hero-gate"><img src="${DUNGEON_ICON}" alt="" width="18" height="18">${storyText(d.dungeon?.name || '미지의 던전')}</span></div></div><p class="stage-objective"><b>이번 원정의 목표</b> ${storyText(d.objective)}</p>${dungeonBriefHtml(d)}${dungeonMapSvg(d)}<div class="stage-tactics"><p><b>${storyText(chapter.mechanic?.name)}</b> ${storyText(chapter.mechanic?.description)}</p><p><b>${storyText(d.encounter?.name)}</b> ${storyText(d.encounter?.tactic)}</p></div></div><div class="stage-launch"><div class="launch-kicker"><span>출격 준비</span><b>${unlocked ? '입장 가능한 던전' : '봉인된 던전'}</b></div>
      <div class="meta"><span>권장 전투력 <b style="color:${power >= d.recPower ? 'var(--green)' : 'var(--red)'}">${fmt(d.recPower)}</b></span><span>내 전투력 ${fmt(power)}</span></div>
      <div class="difficulty-picker" role="group" aria-label="전투 난이도"><div class="difficulty-heading"><b>전투 난이도</b><span>${selectedDifficulty.name} · 보상과 적 압박이 함께 증가합니다</span></div>${difficultyHtml}</div>
      <div class="rewards"><span class="reward-chip"><i class="ic ic-gold"></i> ${fmt(Math.floor(d.rewards.gold * selectedDifficulty.rewardMul))}</span><span class="reward-chip">완료 EXP ${Math.floor(d.rewards.exp * selectedDifficulty.expMul)}</span><span class="reward-chip">정예 처치 · 장비 2개</span>${!stars ? `<span class="reward-chip"><i class="ic ic-gem"></i> ${d.rewards.firstGems} 첫클리어</span>` : ''}</div>
      <p class="stage-loot-guide">사냥 전리품 · 보스 장비 3개, 정예 장비 2개 확정 · 일반 적은 8% 확률. 처치 경험치는 전투 중 즉시 쌓입니다.</p>
      ${unlocked ? '' : `<p class="stage-lock-note">${d.st === 1 ? `${d.ch - 1}-10` : `${d.ch}-${d.st - 1}`} 클리어 후 출격할 수 있습니다.</p>`}
      <div class="row"><button class="btn btn-ghost" id="st-sweep" ${stars < 3 || !unlocked ? 'disabled' : ''}><span>소탕</span><small>티켓 ${this.eco.s.sweep}</small></button><button class="btn btn-gold" id="st-go" ${unlocked ? '' : 'disabled'}><span>${unlocked ? '던전 입장' : '봉인 해제 필요'}</span><small>${unlocked ? '<i class="ic ic-energy"></i> 출격 에너지 -' + d.energy : '이전 관문을 먼저 정화하세요'}</small></button></div></div>`;
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
      const c = document.createElement('button'); c.type = 'button'; c.className = `hero-card rar-${def.rarity}` + (own ? '' : ' lock') + (this.heroSel === id ? ' on' : '');
      c.dataset.heroId = id;
      c.setAttribute('aria-label', `${def.name}${own ? ' 출전 선택' : ' 미보유 정보'}`);
      c.setAttribute('aria-pressed', String(this.eco.s.selected === id));
      c.innerHTML = `<img src="${def.portrait}" onerror="this.style.background='${def.color}'"><span class="rar bg-${def.rarity}">${def.rarity}</span>${own ? `<span class="lv">Lv.${h.level} ${'★'.repeat(h.star)}</span>` : '<span class="lockt">미보유</span>'}`;
      c.onclick = (event) => { if (own) this.selectHero(id, event.detail === 0 && document.activeElement === c); else { this.heroSel = id; this.renderHeroes(); } };
      list.appendChild(c);
    }
    const id = this.heroSel; const def = HEROES[id]; const own = this.eco.ownHero(id); const det = $('hero-detail');
    this.app.wardrobe?.show(id);
    if (!own) { det.innerHTML = `<div class="hs-locked"><h2>${def.name}</h2><div class="sub">${def.title} · ${def.rarity}</div><p style="color:var(--muted);font-size:13px">${def.skills.map((s) => s.name).join(' · ')}</p><button class="btn btn-gold" id="h-summon">소환으로 획득</button></div>`; $('h-summon').onclick = () => this.openTab('gacha'); return; }
    renderOwnedHero(this, id, det);
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
      <div class="craft-grid">${THEMED_SETS.map((sid) => { const S = SETS[sid]; const col = '#' + S.color.toString(16).padStart(6, '0'); return `<div class="craft-set"><div class="cs-head"><img src="${S.icon}" onerror="this.remove()"><div><div style="font-weight:900;color:${col}">${S.name}</div><div style="font-size:10px;color:var(--muted)">2: ${S.two.text}</div><div style="font-size:10px;color:var(--muted)">4: ${S.four.text}</div></div></div><div class="cs-slots">${SLOTS.map((sl) => { const it = craftable(sid, sl); const own = s.inventory.filter((x) => x.id === it.id).length; return `<div class="equip-slot has rar-SR" data-craft="${sid}:${sl}" title="${it.name}"><img src="${ITEM_ICON(it)}" onerror="this.remove()"><span class="plus">${own ? '×' + own : ''}</span></div>`; }).join('')}</div></div>`; }).join('')}</div>
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
  showSkill(id, i) {
    const def = HEROES[id]; const sk = def.skills[i]; const h = this.eco.hero(id); const lv = h.skills[i]; const cost = skillUpGold(lv);
    const locked = !!(sk.unlock && h.level < sk.unlock);
    const lockNote = locked ? `<p style="color:#ff9ad8;font-weight:900">영웅 Lv.${sk.unlock} 달성 시 해금 (현재 Lv.${h.level})</p>` : '';
    this.ui.modal(`<h2>${sk.name} ${sk.unlock ? '<small style="font-size:11px;color:#ff9ad8">각성</small>' : ''} <small style="font-size:12px">Lv.${lv}</small></h2><p>${sk.desc}</p>${lockNote}<p>피해 배율 <b style="color:var(--gold)">${(sk.dmg * (1 + (lv - 1) * 0.12)).toFixed(1)}x${sk.ticks ? ` × ${sk.ticks}회` : ''}</b> ${sk.ult ? '· 궁극기 (게이지 100)' : `· 쿨타임 ${sk.cd}초 · MP ${sk.mp || 0}`}</p>
      <div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button><button class="btn btn-gold" id="m-up" ${lv >= 10 || locked ? 'disabled' : ''}>${locked ? `Lv.${sk.unlock}에 해금` : '강화'} <small>${locked ? '' : `<i class="ic ic-gold"></i> ${fmt(cost)}`}</small></button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-up').onclick = () => { if (locked) return; if (this.eco.upgradeSkill(id, i)) { this.trackFunnel('upgrade', { kind: 'skill', level: lv + 1 }); audio.play('jingle_win1', { vol: 0.5 }); this.ui.closeModal(); this.renderHeroes(); this.ui.toast(`${sk.name} Lv.${lv + 1}!`, 'gold'); } else { this.ui.toast('골드 부족', 'red'); this.offerGold(); } }; } });
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
    const s = this.eco.s; const cost = n === 10 ? GACHA.ten : GACHA.single; const useTicket = n === 1 ? s.tickets > 0 : s.tickets >= 10;
    if (!useTicket && s.gems < cost) { audio.play('ui_error'); const ok = await this.ui.confirm('보석 부족', `보석 ${fmt(cost)}개가 필요합니다 (보유 ${fmt(s.gems)})<br>보석은 출석·임무·스테이지 첫 클리어·패스 무료 보상으로 모을 수 있어요.`, { ok: '보석 상점 보기', cancel: '취소' }); if (ok) this.openTab('shop', 'gem'); return; }
    const pityBefore = clampPity(s.pity);
    const results = this.eco.pull(n); if (!results) { if (this.eco.lastGachaError === 'storage') this.ui.toast('저장 실패로 소환을 취소했습니다. 재화와 천장은 그대로입니다.', 'red'); else if (this.eco.lastGachaError === 'insufficient-funds') this.ui.toast('소환 재화가 부족합니다.', 'red'); return; }
    this.trackPull(n, useTicket ? 'tickets' : 'gems', pityBefore, results);
    this.showReveal(results);
  }
  pullSSR() { const pityBefore = clampPity(this.eco.s.pity); const r = this.eco.pullSSR(); if (!r) { this.ui.toast(this.eco.lastGachaError === 'storage' ? '저장 실패로 SSR 확정권 사용을 취소했습니다.' : '사용할 SSR 확정권이 없습니다.', 'red'); return; } this.trackPull(1, 'ssr_ticket', pityBefore, r); this.showReveal(r); }
  trackPull(count, currency, pityBefore, results) {
    const n = (rar) => results.filter((r) => r.rar === rar).length;
    this.trackFunnel('gacha_pull', { count, currency, pityBefore, ssr: n('SSR'), sr: n('SR'), dupes: results.filter((r) => r.type === 'hero' && r.dup).length });
  }
  showReveal(results) {
    const R = $('reveal'); this.ui.show(R, true); this.app.setLobbyVisible(false);
    const stage = $('reveal-stage'), cards = $('reveal-cards'); stage.innerHTML = ''; cards.innerHTML = ''; $('reveal-foot').classList.add('hidden'); $('btn-reveal-skip').classList.remove('hidden');
    const best = results.some((r) => r.rar === 'SSR') ? 'SSR' : results.some((r) => r.rar === 'SR') ? 'SR' : 'R';
    audio.playMusic(musicForScene({ scene: 'gacha' }), MUSIC_MIX); audio.play('pack_open', { vol: 0.8 }); audio.magic({ vol: 0.4, base: 392, notes: [0, 4, 7, 12, 16, 19], step: 0.09 });
    const beamColor = { R: '#4cc3ff', SR: '#b26bff', SSR: '#ffcf5a' }[best];
    // 광선 연출: 등급 예고 (SSR이면 금색 빔 + 화면 흔들림)
    setTimeout(() => { for (let i = 0; i < (best === 'SSR' ? 7 : best === 'SR' ? 4 : 2); i++) { const b = document.createElement('div'); b.className = 'beam'; b.style.setProperty('--c', beamColor); b.style.left = (50 + (i - 3) * 8) + '%'; b.style.animationDelay = i * 0.08 + 's'; stage.appendChild(b); } audio.play('ui_max', { vol: 0.7, rate: best === 'SSR' ? 0.6 : 1 }); if (best === 'SSR') { audio.vibe([50, 50, 50, 50, 200]); } }, 500);
    setTimeout(() => { const f = document.createElement('div'); f.className = 'flash'; f.style.setProperty('--c', beamColor); stage.appendChild(f); audio.play(best === 'SSR' ? 'jingle_legend' : 'ui_bong', { vol: 0.9 }); }, 1300);
    this._revealTimers = [];
    results.forEach((r, i) => {
      const c = document.createElement('div'); c.className = 'rcard' + (results.length === 1 ? ' single' : '') + ' ' + r.rar; c.style.setProperty('--rc', RC[r.rar]);
      const img = r.type === 'hero' ? r.img : r.type === 'material' ? resourceArt(r.k) : ITEM_ICON(ITEM_BY_ID[r.item.id]); const name = r.type === 'hero' ? r.name : r.type === 'material' ? (REWARD_LABEL[r.k]?.[0] || r.k) + ' ×' + r.n : ITEM_BY_ID[r.item.id].name;
      const sub = r.type === 'hero' ? (r.dup ? '조각 +' + r.shards : '') : r.type === 'material' ? '강화 재료' : ITEM_BY_ID[r.item.id].slot === 'weapon' ? (weaponLook(this.eco.s.selected, r.item, LOOKS)?.form || '') : SLOT_NAME[ITEM_BY_ID[r.item.id].slot];
      c.innerHTML = `<div class="inner"><div class="face back">?</div><div class="face front"><img src="${img}" onerror="this.remove()"><span class="rr">${r.rar}</span>${r.type === 'hero' && !r.dup ? '<span class="new">NEW</span>' : ''}<div class="nm">${name}${sub ? `<br><small style="color:var(--muted)">${sub}</small>` : ''}</div></div></div>`;
      cards.appendChild(c);
      const t = setTimeout(() => { c.classList.add('flip'); if (r.rar === 'SSR') { audio.play('jingle_legend', { vol: 0.9 }); audio.vibe([30, 30, 100]); stage.innerHTML = ''; const f = document.createElement('div'); f.className = 'flash'; f.style.setProperty('--c', '#ffcf5a'); stage.appendChild(f); } else if (r.rar === 'SR') { audio.play('ui_glass', { vol: 0.7, rate: 1.2 }); } else audio.play('card_place', { vol: 0.5 }); if (i === results.length - 1) this.revealDone(); }, 1800 + i * 260);
      this._revealTimers.push(t);
    });
    this._revealResults = results;
  }
  revealSkip() { this._revealTimers.forEach(clearTimeout); document.querySelectorAll('.rcard').forEach((c) => c.classList.add('flip')); audio.play('card_fan', { vol: 0.6 }); this.revealDone(); }
  revealDone() { $('reveal-foot').classList.remove('hidden'); $('btn-reveal-skip').classList.add('hidden'); const s = this.eco.s; $('btn-reveal-again').disabled = s.gems < GACHA.ten && s.tickets < 10; }
  revealClose() { this.ui.show($('reveal'), false); this.app.setLobbyVisible(this.tab === 'home'); audio.playMusic(musicForScene({ scene: 'lobby' }), MUSIC_MIX); this.refreshTop(); if (this._revealResults?.some((r) => r.type === 'hero' && !r.dup)) this.ui.toast('새 영웅 획득! 영웅 탭에서 출전 설정', 'gold'); }
  showGachaContents(filter) { return showGachaContents.call(this, filter); }
  showWeaponPreview(itemId, heroId, enh) { return showWeaponPreview.call(this, itemId, heroId, enh); }
  showRates() {
    const rates = gachaRates(), b0 = rates.base, sp = rates.ssrSplit, pity = clampPity(this.eco.s.pity);
    const featured = HEROES[GACHA.featured]?.name || '픽업 영웅', others = sp.otherHeroes.map((id) => HEROES[id]?.name).filter(Boolean).join(', ');
    const row = (label, p, color = '') => `<tr><th scope="row">${label}</th><td${color ? ` style="color:var(${color})"` : ''}>${pct(p, 2)}</td></tr>`;
    const at = (k) => pct(rates.ssrByPull[k - 1], 1);
    const soft = softStart(rates), hard = rates.hardPity;
    const matRows = (grade, color) => (rates.materials[grade] || []).map((m) => row(`${grade} 강화 재료 · ${REWARD_LABEL[m.k]?.[0] || m.k} ×${m.n}`, b0[grade] * m.w, color)).join('');
    this.ui.modal(`<h2>소환 확률</h2><p class="setting-help">1회 소환 기준 확률입니다. 10회 소환의 SR 이상 보장은 제외했습니다.</p><button class="btn btn-blue btn-sm" id="m-contents" style="width:100%;margin:4px 0">구성품 전체 보기 · 무기 외형 미리보기</button><table class="rates-table" aria-label="소환 등급별 확률">${row(`SSR 픽업 영웅 · ${featured}`, b0.SSR * sp.featuredHero, '--r-ssr')}${sp.otherSsrHero ? row(`SSR 다른 영웅${others ? ` · ${others}` : ''}`, b0.SSR * sp.otherSsrHero, '--r-ssr') : ''}${row('SSR 장비', b0.SSR * sp.ssrGear, '--r-ssr')}${row('SR 영웅', b0.SR * rates.srSplit.hero, '--r-sr')}${row('SR 장비', b0.SR * rates.srSplit.gear, '--r-sr')}${matRows('SR', '--r-sr')}${row('R 장비', b0.R * rates.rSplit.gear)}${matRows('R', '')}</table>
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
    const tabs = $('shop-tabs'); tabs.innerHTML = SHOP_TABS.map((t) => `<button data-t="${t.id}" class="${t.id === this.shopTab ? 'on' : ''}">${t.name}</button>`).join('');
    tabs.querySelectorAll('button').forEach((b) => b.onclick = () => { if (this.shopTab === b.dataset.t) return; this.shopTab = b.dataset.t; this.renderShop(); this.trackFunnel('shop_view', { tab: this.shopTab }); });
    const notice = $('shop-notice');
    if (notice) notice.innerHTML = this.shopTab === 'avatar' ? '<b>아바타는 보석으로 구매하는 순수 외형 상품입니다.</b> 전투 수치에는 영향이 없습니다.' : `<b>가격·상품은 미리보기입니다.</b> 결제 연결 전에는 유료 구매와 지급이 없습니다.`
      + (this.shopTab === 'gem' || this.shopTab === 'hot' ? ` 첫 결제 2배는 결제 연결 후 확인된 구매에 상품별 1회 적용됩니다.` : '')
      + `<br>무료 보석: 출석·임무·첫 클리어·패스 무료 보상 / 사용: 소환 ${fmt(GACHA.single)} (10회 ${fmt(GACHA.ten)})·강화 재료·골드·에너지`;
    const grid = $('shop-grid'); grid.innerHTML = ''; const s = this.eco.s;
    if (this.shopTab === 'avatar') { this.renderAvatarShop(grid); return; }
    for (const sku of SKUS.filter((x) => x.tab === this.shopTab || (this.shopTab === 'hot' && x.badge && x.tab !== 'gem' && x.tab !== 'energy' && x.tab !== 'gold'))) {
      const d = document.createElement('div'); const big = sku.tab === 'hot' || sku.tab === 'pack'; d.className = 'shop-item' + (sku.badge ? ' hot' : '') + (big ? ' big' : '');
      const first = sku.gems && !s.firstPurchaseUsed[sku.id]; const sold = sku.once && s.purchases.includes(sku.id);
      const cash = sku.kind === 'cash';
      const price = sku.kind === 'gem' ? `<i class="ic ic-gem"></i> ${sku.price}` : sku.priceLabel;
      // 현금 상품은 가격 미리보기와 준비 중 상태를 함께 보여 준다. 보석 상품은 1개당 가격으로 비교할 수 있게 한다.
      const value = cash && sku.gems ? `<div class="si-desc">기본 ${fmt(sku.gems)}개 · 1개당 ₩${(sku.price / sku.gems).toFixed(1)}</div>` : '';
      d.innerHTML = `${sku.badge ? `<span class="badge">${sku.badge}</span>` : ''}${first ? '<span class="badge first" style="left:auto;right:-4px;transform:rotate(5deg)">첫 결제 2배</span>' : ''}<img src="${sku.icon}" alt="" onerror="this.remove()"><div class="si-body"><div class="si-name">${sku.name}</div><div class="si-desc">${sku.desc || ''}</div>${value}${sku.gems ? `<div class="si-bonus">${first ? `첫 결제 시 +${fmt(sku.bonus)} (결제 연결 후)` : `+${fmt(Math.floor(sku.gems * 0.1))} 보너스`}</div>` : ''}${sku.limited ? `<div class="timer" data-timer="${sku.id}">남은 시간 ${hms(this.eco.limitedLeft(sku))}</div>` : ''}${cash ? '<div class="si-desc">가격 미리보기 · 결제 준비 중</div>' : ''}<button class="btn ${sku.kind === 'gem' ? 'btn-blue' : 'btn-gold'}"${cash ? ` aria-label="${sku.name} ${sku.priceLabel}, 결제 준비 중"` : ''}>${price}</button></div>${sold ? '<div class="sold">구매 완료</div>' : ''}`;
      d.querySelector('button').onclick = () => this.buy(sku.id);
      grid.appendChild(d);
    }
  }
  async buy(id) {
    const sku = this.eco.sku(id); if (!sku) return; const s = this.eco.s;
    if (sku.once && s.purchases.includes(id)) { this.ui.toast('이미 구매한 상품입니다', 'red'); return; }
    if (sku.kind === 'gem') { if (s.gems < sku.price) { audio.play('ui_error'); const ok = await this.ui.confirm('보석 부족', `보석 ${sku.price}개가 필요합니다`, { ok: '보석 충전' }); if (ok) this.openTab('shop', 'gem'); return; } const r = this.eco.purchase(id); audio.pick('coin', 2, { vol: 0.7 }); this.ui.rewardToast(r.got); this.renderShop(); return; }
    // 현금 구매는 항상 paySheet만 거친다. 열림만 기록하고 성공·지급은 기록하지 않는다.
    this.trackFunnel('paysheet_open', { sku: id });
    const ok = await this.ui.paySheet(sku); if (!ok) return;
    const r = this.eco.purchase(id); if (!r?.ok) return;
    this.ui.purchaseDone(sku, r.got, r.vipUp ? `<p style="color:var(--gold);font-weight:900">VIP ${r.vipUp} 달성!</p>` : (r.got.first ? '<p style="color:var(--green);font-weight:900">첫 결제 2배 보너스 적용!</p>' : ''));
    if (this.tab === 'shop') this.renderShop(); this.refreshTop();
  }

  // ================= 배틀패스 =================
  renderPass() {
    const eco = this.eco; const p = eco.s.pass; const lv = eco.passLevel; $('pass-lv').textContent = lv; $('pass-fill').style.width = (p.xp % BATTLE_PASS.xpPerLevel) + '%'; $('pass-xp').textContent = `${p.xp % BATTLE_PASS.xpPerLevel}/${BATTLE_PASS.xpPerLevel}`;
    $('btn-pass-buy').style.display = p.premium ? 'none' : '';
    const tr = $('pass-track'); tr.innerHTML = '';
    const cell = (r, prem, l) => { const claimed = (prem ? p.claimedPrem : p.claimedFree).includes(l); const can = l <= lv && !claimed && (!prem || p.premium); const k = Object.keys(r)[0]; const [nm, ic] = REWARD_LABEL[k]; return `<div class="pass-cell ${prem ? 'prem' : ''} ${l > lv || (prem && !p.premium) ? 'lock' : ''} ${can ? 'claim' : ''} ${claimed ? 'done' : ''}" data-lv="${l}" data-prem="${prem ? 1 : 0}"><img src="${RESOURCE_ART[k]?resourceArt(k):ic}" onerror="this.remove()"><span>${nm} ${fmt(r[k])}</span></div>`; };
    PASS_TRACK.forEach((t) => { const d = document.createElement('div'); d.className = 'pass-col' + (t.lv <= lv ? ' reached' : ''); d.innerHTML = `<div class="plv">Lv.${t.lv}</div>${cell(t.free, false, t.lv)}${cell(t.prem, true, t.lv)}`; tr.appendChild(d); });
    tr.querySelectorAll('.pass-cell').forEach((c) => c.onclick = () => { const l = +c.dataset.lv, prem = c.dataset.prem === '1'; if (prem && !p.premium) { this.buyPass(); return; } const got = eco.claimPass(l, prem); if (got) { if (!prem) this.trackFunnel('reward_claim', { source: 'pass_free' }); audio.pick('coin', 2, { vol: 0.6 }); this.ui.rewardToast(got); this.renderPass(); } });
    // 현재 레벨로 스크롤
    const col = tr.children[Math.max(0, lv - 2)]; if (col) tr.scrollLeft = col.offsetLeft - 20;
  }
  async buyPass() {
    if (this.eco.s.pass.premium) return;
    const sku = { id: 'pass', name: '시즌 패스 프리미엄', priceLabel: '₩9,900', icon: '/img/icon_pass.webp', desc: '프리미엄 보상 30단계 해금 · SSR 확정권 3장 포함' };
    this.trackFunnel('paysheet_open', { sku: sku.id });
    const ok = await this.ui.paySheet(sku); if (!ok) return; const result = this.eco.buyPass(); if (!result?.ok) return; this.ui.purchaseDone(sku, [{ k: 'gems', n: 0 }].filter((x) => x.n)); this.renderPass();
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
    const controlHelp = touchControls ? '왼쪽 조이스틱으로 이동 · 오른쪽 공격·회피 버튼 · 스킬 버튼 6개로 전투'
      : '이동 WASD · 공격 J/Space · 회피 K/Shift · 스킬 1~6 (4~6은 R/Q/E도 가능)';
    const mixRows=[['sfx','효과음 음량'],['music','배경음악 음량'],['voice','목소리 음량']].map(([key,label])=>`<div class="setting-row"><label for="mix-${key}">${label}</label><div class="setting-mix"><input id="mix-${key}" data-mix="${key}" type="range" min="0" max="100" step="1" value="${Math.round(mix[key]*100)}"><output for="mix-${key}">${Math.round(mix[key]*100)}%</output></div></div>`).join('');
    this.ui.modal(`<h2 class="ui-resource"><img src="${uiArt('settings')}" alt="">설정</h2>${row('sfx', '효과음')}${row('music', '배경음악')}${row('voice', '나레이션')}${row('haptics', '진동')}${shakeRow}<div class="setting-row setting-description"><span id="haptic-help" class="setting-help">${typeof navigator.vibrate === 'function' ? '일반 명중은 짧게, 마무리는 강하게 진동합니다. 기기·브라우저·시스템 설정에 따라 작동하지 않을 수 있습니다.' : '이 브라우저는 기기 진동을 지원하지 않습니다. 명중 반동과 타격음은 유지됩니다.'}</span></div><div class="setting-row"><span>그래픽</span><div class="seg">${['auto','low', 'mid', 'high'].map((q) => `<button data-q="${q}" class="${(st.quality||'auto') === q ? 'on' : ''}">${{auto:'자동',low: '낮음', mid: '보통', high: '높음' }[q]}</button>`).join('')}</div></div><div class="setting-row"><span>카메라</span><div class="seg">${['auto', 'top', 'action', 'wide'].map((c) => `<button data-cam="${c}" class="${(st.camera || 'auto') === c ? 'on' : ''}">${{ auto: 'AUTO', top: '탑다운', action: '액션', wide: '시네마틱' }[c]}</button>`).join('')}</div></div>
      <div class="setting-row setting-description"><span id="cam-desc" class="setting-help">${CAM_DESC[st.camera || 'auto']}</span></div>
      <div class="setting-row"><span>조작</span><span id="input-help" class="setting-help">${controlHelp}</span></div>
      <div class="modal-btns"><button class="btn btn-red btn-sm" id="m-reset">데이터 초기화</button><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => {
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
      b.querySelector('#m-reset').onclick = async () => { if (await this.ui.confirm('초기화', '모든 진행 데이터가 삭제됩니다. 계속할까요?', { okCls: 'btn-red' })) { if (this.app.resetProgress()) location.reload(); else this.ui.toast('저장 공간을 초기화하지 못했습니다. 브라우저의 저장 권한을 확인해 주세요.', 'red'); } };
    } });
  }
  showProfile() {
    const s = this.eco.s; const vipNext = [0, 1, 20000, 50000, 100000, 300000];
    this.ui.modal(`<h2 id="profile-name"></h2><p>VIP ${s.vip} · 누적 결제 ₩${fmt(s.spentKRW)} (목업)<br>${s.vip < 5 ? `다음 VIP까지 ₩${fmt(vipNext[s.vip + 1] - s.spentKRW)}` : '최고 등급'}</p><p>VIP 혜택: 에너지 최대 +50 · 골드 +30% · 소탕권 매일 5장${this.eco.isVip ? ' <b style="color:var(--green)">(활성)</b>' : ' <b style="color:var(--red)">(VIP 멤버십 필요)</b>'}</p><p>총 소환 ${s.totalPulls}회 · 처치 ${s.quests.kills} · 클리어 ${s.quests.stages}</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button><button class="btn btn-gold" id="m-vip">VIP 멤버십</button></div>`, { onOpen: (b) => { b.querySelector('#profile-name').textContent = s.name; b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-vip').onclick = () => { this.ui.closeModal(); this.buy('vip_pass'); }; } });
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
    if (this.eco.dailyAvailable()) { this.showDaily(); return; }
  }
}
