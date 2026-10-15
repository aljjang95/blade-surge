import { $, fmt } from './ui.js';
import { resourceArt, uiArt } from './illustrated.js';
import { audio } from '../engine/audio.js';
import { HEROES, heroStats, starShards } from '../data/heroes.js';
import { heroProgressionHtml, trainingButtonLabel } from './hero-progression.js';
import { ITEM_BY_ID, SLOTS, SLOT_NAME, SETS, itemStats, enhanceCost, enhanceStones, enhanceStoneTier, STONE_KEY, STONE_NAME, enhanceChance, destroyChance, ENH_MAX, RARITY_COLOR, RARITY_INFO, RARITIES, rarityRank, enhanceDown } from '../data/items.js';
import { weaponLook } from '../data/weapon-looks.js';
import { LOOKS } from '../game/look.js';
import { GACHA } from '../data/shop.js';
import { AVATARS } from '../data/avatars.js';
import { libraryAssetForAvatar } from '../engine/library-assets.js';
import { dungeonLanding } from './dungeon-landing.js';
import { itemIconHtml, itemVisual } from './item-presentation.js';

/**
 * 영웅 · 장비 화면의 구성 요소.
 * 첫 화면은 3D 미리보기 + 장착 슬롯 4개 + 가방이며, 성장 · 스킬 · 세트는 탭으로 나눈다.
 * 모든 함수는 Meta 인스턴스를 첫 인자로 받아 기존 economy · app 서비스를 그대로 쓴다.
 */
const RC = { N: 'var(--r-n)', R: 'var(--r-r)', SR: 'var(--r-sr)', SSR: 'var(--r-ssr)' };
export const HERO_PANES = Object.freeze([
  { id: 'gear', label: '장비' },
  { id: 'growth', label: '성장' },
  { id: 'skills', label: '스킬' },
  { id: 'sets', label: '세트' },
]);
const BAG_SORTS = Object.freeze([
  { id: 'rarity', label: '등급순' },
  { id: 'enh', label: '강화순' },
  { id: 'recent', label: '최근순' },
]);
const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const signed = (value) => (value > 0 ? '▲ ' : value < 0 ? '▼ ' : '') + fmt(Math.abs(value));
const trendClass = (value) => (value > 0 ? 'stat-up' : value < 0 ? 'stat-down' : '');
/** 아이템 표현 단일 규칙(item-presentation). 그림을 못 읽으면 다른 장비 그림이 아니라 중립 부위 실루엣으로 바꾼다. */
// 영웅이 정해진 화면은 그 영웅이 실제로 드는 형태의 그림을 쓴다(썸네일·시트 머리·비교 카드·3D·캡션이 같은 heroId).
const iconImg = (it, attrs = '', heroId = null) => itemIconHtml(it, attrs, { heroId });

/** uid → 장착 중인 영웅 id. 가방 타일과 비교 시트가 같이 쓴다. */
function equippedOwners(eco) {
  const owners = new Map();
  for (const [heroId, hero] of Object.entries(eco.s.heroes)) for (const uid of Object.values(hero.equip)) if (uid !== null && uid !== undefined) owners.set(uid, heroId);
  return owners;
}

// ------------------------------------------------------------------ 영웅 화면
/** 보유한 영웅의 상세 영역(장착 슬롯 · 머리글 · 탭)을 그린다. */
export function renderOwnedHero(meta, id, det) {
  const { eco } = meta;
  const def = HEROES[id], h = eco.hero(id), st = heroStats(def, h, eco.heroEquipBonus(id));
  const selected = eco.s.selected === id;
  const pane = HERO_PANES.some((entry) => entry.id === meta.heroPane) ? meta.heroPane : 'gear';
  meta.heroPane = pane;
  // 정비를 마친 뒤 같은 추천 던전의 준비창으로 바로 돌아간다. 캠페인 스테이지를 바로 시작하지 않는다.
  const landing = meta.app.expedition ? dungeonLanding({ expedition: meta.app.expedition, history: eco.s.masterworks?.history, energy: eco.s.energy }) : null;
  const sortie = landing?.dungeon
    ? '<button type="button" class="btn btn-gold btn-sm hs-sortie" id="h-next" aria-label="' + esc(landing.name + ' ' + landing.depthLabel + ' 출격 준비 열기, 입장 에너지 ' + landing.cost) + '" title="' + esc(landing.name + ' · 에너지 ' + landing.cost) + '">출격 준비<small>에너지 ' + landing.cost + '</small></button>'
    : '';
  const slots = SLOTS.map((slot) => {
    const inst = eco.s.inventory.find((x) => x.uid === h.equip[slot]);
    if (!inst) return '<button type="button" class="equip-slot hs-slot is-empty" data-slot="' + slot + '" aria-label="' + SLOT_NAME[slot] + ' 비어 있음, 가방에서 고르기"><img class="empty-equip-art" src="' + uiArt('slot-' + slot) + '" alt=""><span class="hs-slot-name">' + SLOT_NAME[slot] + '</span></button>';
    const it = ITEM_BY_ID[inst.id];
    return '<button type="button" class="equip-slot has hs-slot rar-' + it.rarity + '" data-slot="' + slot + '" data-uid="' + inst.uid + '" aria-label="' + SLOT_NAME[slot] + ': ' + esc(it.name) + ' +' + inst.enh + ', 비교와 강화 열기" title="' + esc(it.name) + '">' + iconImg(it, '', id) + '<span class="plus">+' + inst.enh + '</span><span class="hs-slot-name">' + SLOT_NAME[slot] + '</span></button>';
  }).join('');
  const avatar = AVATARS.find((entry) => entry.heroId === id), avatarReady = !!avatar && !!libraryAssetForAvatar(avatar.id), avatarOwned = !!avatar && eco.s.avatars.owned.includes(avatar.id), avatarEquipped = !!avatar && eco.equippedAvatar(id) === avatar.id;
  const avatarRow = avatar ? '<section class="hero-avatar-row" aria-label="' + esc(def.name) + ' 아바타"><div><b>캐시 아바타</b><small>' + esc(avatar.name) + ' · 순수 외형 · 성능 영향 없음</small></div><button type="button" class="btn btn-ghost btn-sm hero-avatar-action" data-avatar-action="' + avatar.id + '" ' + (avatarReady ? '' : 'disabled') + '>' + (avatarReady ? (avatarOwned ? (avatarEquipped ? '착용 중 · 해제' : '보유 중 · 착용') : '<i class="ic ic-gem"></i> ' + fmt(avatar.price) + ' 보석') : '준비 중') + '</button></section>' : '';
  det.innerHTML = '<div class="hs-slots" role="group" aria-label="' + esc(def.name) + ' 장착 장비">' + slots + '</div>' +
    '<header class="hs-head"><div class="hs-id"><h2>' + esc(def.name) + ' <small style="color:' + RC[def.rarity] + '">' + def.rarity + '</small></h2><div class="sub">' + esc(def.title) + ' · Lv.' + h.level + ' · ' + '★'.repeat(h.star) + '☆'.repeat(5 - h.star) + ' · 전투력 <b>' + fmt(st.power) + '</b></div></div>' +
    '<div class="hs-go">' + (selected ? '<span class="hs-on">출전 중</span>' + sortie : '<button type="button" class="btn btn-ghost btn-sm" id="h-sel">출전시키기</button>') + '</div></header>' +
    // 가로 화면의 hero-detail 은 display:contents 격자라 새 형제 요소가 엉뚱한 칸에 앉는다. 아바타 줄은 본문 안에 둔다.
    '<div class="hs-main">' + avatarRow + '<div class="hs-tabs" role="tablist" aria-label="영웅 정보">' + HERO_PANES.map((entry) => '<button type="button" role="tab" id="hs-tab-' + entry.id + '" data-pane="' + entry.id + '" aria-controls="hs-panel" aria-selected="' + (entry.id === pane) + '" tabindex="' + (entry.id === pane ? 0 : -1) + '">' + entry.label + (entry.id === 'gear' ? '<small>가방 ' + eco.s.inventory.length + '</small>' : '') + '</button>').join('') + '</div>' +
    '<div class="hs-panel" id="hs-panel" role="tabpanel" tabindex="-1"></div></div>';
  renderPane(meta, id);
  const avatarButton = det.querySelector('[data-avatar-action]');
  if (avatarButton && avatar) avatarButton.onclick = async () => {
    if (!avatarReady) return;
    const ownedNow = eco.s.avatars.owned.includes(avatar.id), equippedNow = eco.equippedAvatar(id) === avatar.id;
    if (!ownedNow) {
      if (eco.s.gems < avatar.price) { meta.ui.toast('보석이 부족합니다.', 'red'); return; }
      if (!await meta.ui.confirm('아바타 구매', avatar.name + '을(를) ' + fmt(avatar.price) + ' 보석으로 구매할까요?')) return;
      const bought = eco.buyAvatar(avatar.id); if (!bought.ok) { meta.ui.toast('아바타를 구매하지 못했습니다.', 'red'); return; }
    }
    if (!eco.equipAvatar(id, equippedNow ? null : avatar.id).ok) return;
    if (eco.s.selected === id) meta.app.showcaseHero(id);
    meta.renderHeroes();
  };
  const sortieButton = $('h-next'); if (sortieButton) sortieButton.onclick = () => meta.app.commandUI?.openPreparation();
  const pick = $('h-sel'); if (pick) pick.onclick = () => meta.selectHero(id);
  const tabs = [...det.querySelectorAll('.hs-tabs [role=tab]')];
  tabs.forEach((tab, index) => {
    tab.onclick = () => { meta.heroPane = tab.dataset.pane; syncTabs(det, meta.heroPane); renderPane(meta, id); };
    tab.onkeydown = (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const target = tabs[(index + step + tabs.length) % tabs.length]; target.click(); target.focus();
    };
  });
  det.querySelectorAll('.hs-slot').forEach((el) => el.onclick = () => {
    if (el.dataset.uid) { meta.showItem(+el.dataset.uid, id); return; }
    // 빈 슬롯: 가방을 그 부위로 걸러 바로 고를 수 있게 한다.
    meta.bagSlot = el.dataset.slot; meta.heroPane = 'gear'; syncTabs(det, 'gear'); renderPane(meta, id);
    $('hero-bag')?.querySelector('[data-inv]')?.focus({ preventScroll: true });
    meta.ui.toast(SLOT_NAME[el.dataset.slot] + ' 슬롯이 비어 있습니다. 가방에서 장비를 골라 보세요');
  });
}

function syncTabs(det, pane) {
  det.querySelectorAll('.hs-tabs [role=tab]').forEach((tab) => { const on = tab.dataset.pane === pane; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; });
  det.querySelector('#hs-panel')?.setAttribute('aria-labelledby', 'hs-tab-' + pane);
}

/** 선택한 탭의 본문만 다시 그린다(3D 미리보기는 그대로 둔다). */
export function renderPane(meta, id) {
  const { eco } = meta, panel = $('hs-panel'); if (!panel) return;
  const def = HEROES[id], h = eco.hero(id), pane = meta.heroPane;
  syncTabs($('hero-detail'), pane);
  panel.dataset.pane = pane;
  if (pane === 'gear') {
    panel.innerHTML = '<div id="hero-bag"></div><div class="hs-craft-link"><span>원정 재료로 새 장비를 만들려면</span><button type="button" class="btn btn-ghost btn-sm" id="h-forge">제작 공방</button></div>';
    renderBag(meta, id);
    $('h-forge').onclick = () => { meta.app.expeditionUI?.open('forge'); };
    return;
  }
  if (pane === 'growth') {
    const st = heroStats(def, h, eco.heroEquipBonus(id)), training = eco.trainingQuote(id);
    panel.innerHTML = '<div class="hero-actions hero-actions-top"><button class="btn btn-blue btn-sm" id="h-lv" aria-describedby="hero-training-hint" ' + (training.ok ? '' : 'disabled') + '>' + trainingButtonLabel(training) + '<small>' + (training.reason === 'hunt' ? '현재 레벨 EXP 50%부터' : training.reason === 'cap' ? 'Lv.80' : '<i class="ic ic-gold"></i> ' + fmt(training.cost) + (training.reason === 'gold' ? ' · 골드 부족' : '')) + '</small></button><button class="btn btn-gold btn-sm" id="h-star" ' + (h.star >= 5 ? 'disabled' : '') + '>승급 <small>조각 ' + h.shards + '/' + starShards(h.star) + '</small></button></div>' +
      heroProgressionHtml(h, def, eco.s.gold) +
      '<div class="stat-grid"><div class="stat">HP <b>' + fmt(st.hp) + '</b></div><div class="stat">공격력 <b>' + fmt(st.atk) + '</b></div><div class="stat">방어력 <b>' + st.def + '</b></div><div class="stat">치명타 <b>' + Math.round(st.crit * 100) + '%</b></div></div>';
    $('h-lv').onclick = () => {
      if (meta.app.mode !== 'lobby' || meta.app.stageStarting || meta.app.battle?.active) return;
      if (eco.levelUpHero(id)) { meta.trackFunnel('upgrade', { kind: 'hero_level', level: eco.hero(id).level }); audio.levelUp({ vol: 0.42 }); audio.vibe(20); meta.ui.toast('사냥과 훈련으로 Lv.' + eco.hero(id).level + ' 달성!', 'gold'); }
      else { meta.ui.toast(eco.lastTrainingError === 'storage' ? '훈련을 저장하지 못해 경험치와 골드를 그대로 돌려두었습니다.' : eco.lastTrainingError === 'hunt' ? '사냥으로 현재 레벨 경험치를 절반 이상 쌓아 주세요.' : '경험치와 보유 골드를 확인해 주세요.', 'red'); audio.play('ui_error'); }
      meta.renderHeroes();
    };
    $('h-star').onclick = () => { if (eco.promoteHero(id)) { meta.trackFunnel('upgrade', { kind: 'hero_star', level: eco.hero(id).star }); audio.play('jingle_legend', { vol: 0.7 }); meta.ui.toast('승급 성공! ★' + eco.hero(id).star, 'gold'); meta.renderHeroes(); } else { meta.ui.toast('영웅 조각 부족 — 중복 영웅은 조각 ' + GACHA.dupShards + '개로 바뀝니다', 'red'); } };
    return;
  }
  if (pane === 'skills') {
    panel.innerHTML = '<h3 class="hs-sub">스킬북 <small>Q / E 빌드</small></h3><div class="skill-book">' + def.skills.map((sk, i) => {
      const ok = !sk.unlock || h.level >= sk.unlock, loadout = h.skillLoadout || [4, 5], equipped = loadout.includes(i);
      const info = i < 4 ? (sk.ult ? '고정 · 궁극기' : '기본 스킬 · 쿨타임 ' + sk.cd + '초 · MP ' + (sk.mp || 0)) : ok ? '각성 Lv.' + (h.skills[i] || 1) + ' · MP ' + (sk.mp || 0) : '해금 Lv.' + sk.unlock;
      return '<div class="skill-book-card' + (ok ? '' : ' locked') + (equipped ? ' equipped' : '') + '" data-skill-card="' + i + '"><button type="button" class="skill-book-icon" data-sk="' + i + '" aria-label="' + esc(sk.name) + ' 설명 보기" style="border-color:' + (ok ? def.color : 'rgba(255,255,255,.18)') + '"><img src="' + sk.icon + '" alt="" onerror="this.style.display=\'none\';this.parentNode.style.background=\'' + def.color + '\'"></button><div class="skill-book-main"><b>' + esc(sk.name) + '</b><small>' + info + '</small></div>' +
        (i >= 4 ? '<div class="skill-equip"><button type="button" data-equip="0:' + i + '" aria-label="' + esc(sk.name) + ' Q 슬롯에 장착" class="' + (loadout[0] === i ? 'on' : '') + '" ' + (ok ? '' : 'disabled') + '>Q</button><button type="button" data-equip="1:' + i + '" aria-label="' + esc(sk.name) + ' E 슬롯에 장착" class="' + (loadout[1] === i ? 'on' : '') + '" ' + (ok ? '' : 'disabled') + '>E</button></div>' : '') + '</div>';
    }).join('') + '</div><div class="awk-note">' + (() => { const nx = def.skills.find((sk) => sk.unlock && h.level < sk.unlock); return nx ? '다음 해금 Lv.' + nx.unlock + ' · <b style="color:#ff9ad8">' + esc(nx.name) + '</b>' : '모든 고위 스킬 해금 완료'; })() + '</div>';
    panel.querySelectorAll('[data-sk]').forEach((el) => el.onclick = () => meta.showSkill(id, +el.dataset.sk));
    panel.querySelectorAll('[data-equip]').forEach((el) => el.onclick = (event) => {
      event.stopPropagation();
      const [slot, skillIndex] = el.dataset.equip.split(':').map(Number);
      if (eco.setSkillLoadout(id, slot, skillIndex)) { audio.play('ui_confirm', { vol: 0.5 }); meta.ui.toast((slot === 0 ? 'Q' : 'E') + ' · ' + def.skills[skillIndex].name + ' 장착', 'gold'); renderPane(meta, id); }
      else meta.ui.toast('해금 상태와 다른 슬롯 장착을 확인해 주세요', 'red');
    });
    return;
  }
  panel.innerHTML = '<h3 class="hs-sub">세트 효과</h3>' + meta.setListHtml(id);
  const craft = $('h-craft'); if (craft) craft.onclick = () => meta.showCraft(id);
}

// ------------------------------------------------------------------ 가방
/** 부위 · 등급 필터와 정렬이 있는 가방. 타일은 고유 아이콘을 크게 보여 준다. */
export function renderBag(meta, heroId) {
  const bag = $('hero-bag'); if (!bag) return;
  const { eco } = meta;
  const slot = SLOTS.includes(meta.bagSlot) ? meta.bagSlot : 'all';
  const rarity = RARITIES.includes(meta.bagRarity) ? meta.bagRarity : 'all';
  const sort = BAG_SORTS.some((entry) => entry.id === meta.bagSort) ? meta.bagSort : 'rarity';
  const owners = equippedOwners(eco);
  const all = eco.s.inventory.filter((x) => ITEM_BY_ID[x.id]);
  const items = all.filter((x) => (slot === 'all' || ITEM_BY_ID[x.id].slot === slot) && (rarity === 'all' || ITEM_BY_ID[x.id].rarity === rarity)).slice().sort((a, b) => {
    if (sort === 'recent') return b.uid - a.uid;
    if (sort === 'enh') return (b.enh || 0) - (a.enh || 0) || rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity);
    return rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity) || (b.enh || 0) - (a.enh || 0);
  });
  bag.innerHTML = '<div class="bag-bar"><div class="bag-filters" role="group" aria-label="장비 부위 필터">' + ['all', ...SLOTS].map((s) => '<button type="button" data-bag-slot="' + s + '" aria-pressed="' + (s === slot) + '">' + (s === 'all' ? '전체' : SLOT_NAME[s]) + '</button>').join('') + '</div>' +
    '<select class="bag-select" data-bag-rarity aria-label="등급 필터"><option value="all">등급</option>' + RARITIES.map((r) => '<option value="' + r + '"' + (r === rarity ? ' selected' : '') + '>' + RARITY_INFO[r].name + '</option>').join('') + '</select>' +
    '<select class="bag-select" data-bag-sort aria-label="정렬 기준">' + BAG_SORTS.map((entry) => '<option value="' + entry.id + '"' + (entry.id === sort ? ' selected' : '') + '>' + entry.label + '</option>').join('') + '</select>' +
    '<span class="bag-count" aria-live="polite">' + items.length + '/' + all.length + '개</span></div>' +
    '<div class="inv-list" role="list">' + (items.map((inst) => {
      const it = ITEM_BY_ID[inst.id], owner = owners.get(inst.uid);
      const mark = owner === heroId ? '<em class="bag-eq">착용 중</em>' : owner ? '<em class="bag-eq other">' + esc(HEROES[owner].name.split(' ').pop()) + '</em>' : '';
      return '<div class="bag-cell" role="listitem"><button type="button" class="bag-item rar-' + it.rarity + '" data-inv="' + inst.uid + '" aria-label="' + esc(it.name) + ' +' + inst.enh + ', ' + RARITY_INFO[it.rarity].name + (owner === heroId ? ', 착용 중' : owner ? ', 다른 영웅이 착용 중' : '') + '" title="' + esc(it.name) + '"><span class="bag-art">' + iconImg(it, ' decoding="async"', heroId) + '</span><span class="inventory-name">' + esc(it.name) + '</span><span class="inventory-level"><b>+' + inst.enh + '</b>' + (it.summon ? ' ✦' : '') + '</span>' + mark + '</button></div>';
    }).join('') || '<p class="bag-empty">' + (all.length ? '조건에 맞는 장비가 없습니다. 필터를 바꿔 보세요.' : '가방이 비어 있습니다. 던전에서 전리품을 모으거나 제작 공방에서 만들어 보세요.') + '</p>') + '</div>';
  const rerender = (focus) => { renderBag(meta, heroId); if (focus) $('hero-bag')?.querySelector(focus)?.focus({ preventScroll: true }); };
  bag.querySelectorAll('[data-bag-slot]').forEach((button) => button.onclick = () => { meta.bagSlot = button.dataset.bagSlot; rerender('[data-bag-slot="' + meta.bagSlot + '"]'); });
  bag.querySelector('[data-bag-rarity]').onchange = (event) => { meta.bagRarity = event.target.value; rerender('[data-bag-rarity]'); };
  bag.querySelector('[data-bag-sort]').onchange = (event) => { meta.bagSort = event.target.value; rerender('[data-bag-sort]'); };
  bag.querySelectorAll('[data-inv]').forEach((button) => button.onclick = () => meta.showItem(+button.dataset.inv, heroId));
}

// ------------------------------------------------------------------ 비교 · 장착 · 강화 시트
/** 비교의 기준은 세트 효과까지 반영한 영웅 최종 능력치다(previewItem.before / after). */
const HERO_ROWS = Object.freeze([['atk', '공격력'], ['hp', 'HP'], ['def', '방어'], ['crit', '치명타'], ['critDmg', '치명 피해'], ['ultGain', '궁극기 수급']]);
const PCT_KEYS = new Set(['crit', 'critDmg', 'ultGain']);
const statText = (key, value) => PCT_KEYS.has(key) ? (value * 100).toFixed(1).replace(/\.0$/, '') + '%' : fmt(value);
/** 아이템 단독 수치(보조 정보). */
const itemStatLine = (inst) => { const s = itemStats(inst); return [s.atk ? '공격력 ' + fmt(s.atk) : '', s.hp ? 'HP ' + fmt(s.hp) : '', s.def ? '방어 ' + fmt(s.def) : '', s.crit ? '치명 ' + Math.round(s.crit * 100) + '%' : ''].filter(Boolean).join(' · '); };

function itemCardHtml(inst, label, equippedHere, heroId = null) {
  if (!inst) return '<div class="is-card is-card-empty"><small>' + label + '</small><span class="is-card-art"></span><b>비어 있음</b></div>';
  const it = ITEM_BY_ID[inst.id];
  return '<div class="is-card rar-' + it.rarity + '"><small>' + label + (equippedHere ? ' · 착용 중' : '') + '</small><span class="is-card-art">' + iconImg(it, '', heroId) + '</span><b style="color:' + RARITY_COLOR[it.rarity] + '">' + esc(it.name) + '</b><span class="is-card-meta">+' + inst.enh + ' · ' + RARITY_INFO[it.rarity].name + '</span>' + (itemStatLine(inst) ? '<span class="is-card-stat">' + itemStatLine(inst) + '</span>' : '') + '</div>';
}

function setChangesHtml(p) {
  const rows = [...new Set([...Object.keys(p.beforeBonus.sets), ...Object.keys(p.afterBonus.sets)])].map((sid) => {
    const before = p.beforeBonus.sets[sid] || 0, after = p.afterBonus.sets[sid] || 0;
    if (before === after) return '';
    const set = SETS[sid]; if (!set) return '';
    const tier = (n) => n >= 4 ? 4 : n >= 2 ? 2 : 0;
    const effect = after >= 4 ? set.four : after >= 2 ? set.two : null;
    const effectText = effect?.text || (effect ? Object.entries(effect).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ atk: '공격력', hp: 'HP', crit: '치명타', critDmg: '치명 피해', ultGain: '궁극기 수급' }[k] || k) + ' +' + Math.round(v * 100) + '%').join(' · ') : '활성 효과 없음');
    return '<li><b>' + esc(set.name) + '</b> ' + before + '/4 → ' + after + '/4' + (tier(before) !== tier(after) ? ' <strong class="' + (tier(after) > tier(before) ? 'stat-up' : 'stat-down') + '">' + tier(before) + '세트 → ' + tier(after) + '세트</strong>' : '') + '<small>' + esc(effectText) + '</small></li>';
  }).filter(Boolean).join('');
  return rows ? '<ul class="is-sets">' + rows + '</ul>' : '';
}

/** 강화 영역: 같은 시트 안에서 확률 · 비용을 보고 바로 강화한다. */
function enhanceHtml(meta, inst) {
  const s = meta.eco.s, it = ITEM_BY_ID[inst.id], lv = inst.enh, maxed = lv >= ENH_MAX;
  if (maxed) return '<section class="is-enh" aria-label="장비 강화"><h3>강화</h3><p class="is-maxed">최대 강화 달성!</p></section>';
  const cur = itemStats(inst), nxt = itemStats({ ...inst, enh: Math.min(ENH_MAX, lv + 1) });
  const cost = enhanceCost(lv), stones = enhanceStones(lv), tier = enhanceStoneTier(lv), skey = STONE_KEY[tier];
  const chance = enhanceChance(lv), destroy = destroyChance(lv);
  const rows = [['공격력', cur.atk, nxt.atk], ['HP', cur.hp, nxt.hp], ['방어', cur.def, nxt.def]].filter((row) => row[1] || row[2]);
  return '<section class="is-enh" aria-label="장비 강화"><h3>강화 <small class="is-lv">+' + lv + ' → <b>+' + (lv + 1) + '</b></small></h3>' +
    '<div class="enh-stats">' + rows.map((row) => '<div><span>' + row[0] + '</span><span>' + fmt(row[1]) + ' → <b>' + fmt(row[2]) + '</b></span></div>').join('') + '</div>' +
    '<div class="enh-rate">성공 <b id="e-rate">' + Math.round(chance * 100) + '%</b>' + (destroy > 0 ? ' · <span class="warn" id="e-destroy">파괴 ' + Math.round(destroy * 100) + '%</span>' : '') + (enhanceDown(lv) ? ' · 실패 시 <b>-1</b>' : '') + '</div>' +
    '<div class="enh-opts"><button type="button" class="enh-opt" data-opt="bless" aria-pressed="false"><img src="' + resourceArt('bless') + '" alt="" onerror="this.remove()"><span>축복 +20%</span><span class="cnt">×' + s.bless + '</span></button>' +
    (destroy > 0 ? '<button type="button" class="enh-opt" data-opt="protect" aria-pressed="false"><img src="' + resourceArt('protect') + '" alt="" onerror="this.remove()"><span>파괴 방지</span><span class="cnt">×' + s.protect + '</span></button>' : '') + '</div>' +
    '<div class="enh-cost"><span class="' + (s.gold < cost ? 'lack' : '') + '"><i class="ic ic-gold"></i> ' + fmt(cost) + '</span>' + (stones ? '<span class="' + ((s[skey] || 0) < stones ? 'lack' : '') + '"><img src="' + resourceArt(skey) + '" alt="" onerror="this.remove()"> ' + STONE_NAME[tier] + ' ' + stones + ' <small>(보유 ' + (s[skey] || 0) + ')</small></span>' : '') + '</div>' +
    '<button type="button" class="btn btn-blue" id="e-go">강화하기</button>' +
    '<p class="is-enh-note">+8까지 성공 100% · +10부터 실패 시 하락 · +12부터 파괴 위험</p></section>';
}

/** 가방 장비를 눌렀을 때 열리는 시트. 현재 장비와 나란히 비교하고 주 버튼 하나로 장착한다. */
export function showItemSheet(meta, uid, heroId, { focus } = {}) {
  const { eco, ui } = meta;
  let rerenderTimer = 0;
  // 선택형 3D 미리보기: 시트 하나에 렌더러 하나. 시트가 닫히거나 다른 모달로 바뀌면 해제하고, 강화 뒤 다시 그릴 때는 열림 상태를 이어 간다.
  let preview = null, previewOpen = false, previewSeq = 0;
  const disposePreview = () => { previewSeq++; preview?.dispose(); preview = null; };
  const render = () => {
    disposePreview();
    const inst = eco.s.inventory.find((x) => x.uid === uid);
    if (!inst) {
      ui.modal('<h2 style="color:var(--red)">장비 파괴</h2><p>강화에 실패해 장비가 파괴되었습니다.</p><div class="modal-btns"><button class="btn btn-gold" id="m-ok">확인</button></div>', { onOpen: (b) => b.querySelector('#m-ok').onclick = () => { ui.closeModal(); meta.renderHeroes(); } });
      return;
    }
    const it = ITEM_BY_ID[inst.id], h = eco.hero(heroId), equipped = h.equip[it.slot] === uid;
    const p = eco.previewItem(heroId, uid); if (!p) return;
    const set = it.set ? SETS[it.set] : null;
    const statRows = HERO_ROWS.filter(([key]) => ['atk', 'hp', 'def'].includes(key) || Math.abs((p.after[key] || 0) - (p.before[key] || 0)) > 1e-9).map(([key, name]) => {
      const before = p.before[key] || 0, after = p.after[key] || 0, delta = after - before, same = Math.abs(delta) < 1e-9;
      return '<div class="is-row"><span>' + name + '</span><b>' + statText(key, before) + '</b><i aria-hidden="true">→</i><b>' + statText(key, after) + '</b><em class="' + (same ? '' : trendClass(delta)) + '">' + (same ? '±0' : (delta > 0 ? '▲ ' : '▼ ') + statText(key, Math.abs(delta))) + '</em></div>';
    }).join('');
    const powerDelta = p.after.power - p.before.power;
    const label = p.remove ? '해제 후' : '장착 후';
    const owner = p.owner && p.owner !== heroId ? p.owner : null;
    const primary = equipped ? '해제하기' : owner ? HEROES[owner].name.split(' ').pop() + '에게서 옮겨 장착' : '장착하기';
    const look = it.slot === 'weapon' ? weaponLook(heroId, inst, LOOKS) : null;
    const visual = itemVisual(it, { heroId });
    ui.modal('<div class="item-sheet rar-line-' + it.rarity + '" data-slot="' + it.slot + '">' +
      '<header class="is-head"><span class="is-head-art rar-' + it.rarity + '">' + iconImg(it, '', heroId) + '</span><div class="is-head-copy"><h2 style="color:' + RARITY_COLOR[it.rarity] + '">' + esc(it.name) + ' <span class="is-plus">+' + inst.enh + '</span></h2><div class="is-tags"><b style="color:' + RARITY_COLOR[it.rarity] + '">' + RARITY_INFO[it.rarity].name + '</b> · ' + SLOT_NAME[it.slot] + (set ? ' · ' + esc(set.name) : '') + (it.slot === 'weapon' ? ' · <span class="is-form" data-variant="' + visual.variant + '">' + esc(visual.formLabel) + '</span>' : '') + '</div></div><button type="button" class="btn btn-ghost btn-sm is-3d-toggle" id="i-3d" aria-controls="is-preview" aria-pressed="' + previewOpen + '">3D로 보기</button><button type="button" class="btn btn-ghost btn-sm" id="i-close" aria-label="닫기">닫기</button></header>' +
      '<section class="is-preview" id="is-preview" aria-label="' + esc(it.name) + ' 3D 미리보기"' + (previewOpen ? '' : ' hidden') + '><div class="is-preview-stage" aria-busy="true">3D 모델을 불러오는 중…</div><p class="is-preview-caption"></p></section>' +
      '<div class="is-body"><div class="is-compare" aria-label="현재 장비와 비교">' +
      '<div class="is-power ' + trendClass(powerDelta) + '"><span>' + HEROES[heroId].name + ' · ' + label + ' 전투력</span><b>' + fmt(p.before.power) + ' → ' + fmt(p.after.power) + '</b><em>' + (powerDelta === 0 ? '변화 없음' : signed(powerDelta)) + '</em></div>' +
      (equipped ? '<div class="is-cards single">' + itemCardHtml(inst, '현재 장비', true, heroId) + '</div>' : '<div class="is-cards">' + itemCardHtml(p.current, '현재 ' + SLOT_NAME[it.slot], p.current && p.current.uid === uid, heroId) + '<span class="is-vs" aria-hidden="true">→</span>' + itemCardHtml(inst, '선택한 장비', false, heroId) + '</div>') +
      '<div class="is-rows" role="group" aria-label="' + HEROES[heroId].name + ' 능력치 ' + label + ' 변화"><small class="is-rows-title">' + label + ' 영웅 능력치 · 세트 효과 포함</small>' + statRows + '</div>' +
      (owner ? '<p class="is-note stat-down">' + esc(HEROES[owner].name) + '에게 장착 중입니다. 장착하면 그 영웅에게서 옮겨옵니다.</p>' : '') +
      (look ? '<div class="item-look" style="--wl:' + look.color + '">착용 모습 · ' + esc([visual.formLabel, look.glow > 0 ? look.element + ' 발광' : '발광 없음', look.tier ? '+' + look.enh + ' ' + look.tier : ''].filter(Boolean).join(' · ')) + '</div>' : '') +
      (it.summon ? '<p class="is-note" style="color:' + RARITY_COLOR[it.rarity] + '">✦ ' + esc(it.summon.name) + ' 소환 · ' + it.summon.interval + '초마다 ' + Math.round(it.summon.ratio * 100) + '% 공격</p>' : '') +
      setChangesHtml(p) + '</div>' + enhanceHtml(meta, inst) + '</div>' +
      '<footer class="is-actions item-actions"><button type="button" class="btn btn-ghost btn-sm" id="i-sell">판매</button><button type="button" class="btn btn-gold" id="i-eq">' + primary + '</button></footer></div>',
    { onClose: () => { clearTimeout(rerenderTimer); rerenderTimer = 0; disposePreview(); },
      onOpen: (b) => {
      // 강화 연출 뒤 다시 그리기는 이 시트가 아직 열린 현재 모달일 때만 한다(판매 확인 등으로 바뀌면 취소).
      const seq = ui.modalSeq;
      const previewSection = b.querySelector('#is-preview'), previewToggle = b.querySelector('#i-3d');
      const openPreview = async () => {
        const token = ++previewSeq;
        const stage = previewSection.querySelector('.is-preview-stage');
        try {
          const { mountItemPreview, previewCaption } = await import('./item-preview-3d.js');
          if (token !== previewSeq || ui.modalSeq !== seq) return;
          previewSection.querySelector('.is-preview-caption').textContent = previewCaption(it, heroId, HEROES[heroId]?.name || '');
          const handle = await mountItemPreview(stage, it, { heroId, reducedMotion: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches });
          if (token !== previewSeq || ui.modalSeq !== seq) { handle.dispose(); return; }
          preview = handle; stage.removeAttribute('aria-busy');
        } catch (error) {
          if (token === previewSeq) { stage.removeAttribute('aria-busy'); stage.textContent = '3D 미리보기를 불러오지 못했습니다.'; }
          console.warn('item preview', error);
        }
      };
      previewToggle.onclick = () => {
        previewOpen = !previewOpen; previewToggle.setAttribute('aria-pressed', String(previewOpen)); previewSection.hidden = !previewOpen;
        if (previewOpen) openPreview(); else disposePreview();
      };
      if (previewOpen) openPreview();
      const later = (ms) => { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(() => { rerenderTimer = 0; if (ui.modalSeq === seq && ui.el.modal.classList.contains('show')) render(); }, ms); };
      const close = () => { ui.closeModal(); if (meta._sheetDirty) { meta._sheetDirty = false; meta.renderHeroes(); } meta.focusInventory(uid, it.slot); };
      b.querySelector('#i-close').onclick = close;
      b.querySelector('#i-eq').onclick = () => {
        if (equipped) eco.unequip(heroId, it.slot); else eco.equip(heroId, uid);
        audio.play('ui_confirm', { vol: 0.5 }); ui.closeModal(); meta._sheetDirty = false; meta.renderHeroes();
        if (heroId === eco.s.selected) meta.app.showcaseHero(heroId);   // 장착 즉시 외형 반영
        meta.focusInventory(uid, it.slot);
      };
      b.querySelector('#i-sell').onclick = async () => {
        if (await ui.confirm('판매', esc(it.name) + ' +' + inst.enh + ' 을(를) 판매할까요?')) { const g = eco.sellItem(uid); ui.toast('골드 +' + fmt(g), 'gold'); audio.pick('coin', 2); meta._sheetDirty = false; meta.renderHeroes(); meta.focusInventory(uid, it.slot); }
        else showItemSheet(meta, uid, heroId);
      };
      // 강화
      const opts = { bless: false, protect: false };
      b.querySelectorAll('.enh-opt').forEach((el) => el.onclick = () => {
        const key = el.dataset.opt; if (eco.s[key] <= 0) { ui.toast((key === 'bless' ? '축복' : '보호') + ' 주문서가 없습니다', 'red'); meta.offerScroll(key); return; }
        opts[key] = !opts[key]; el.classList.toggle('on', opts[key]); el.setAttribute('aria-pressed', String(opts[key]));
        const rate = b.querySelector('#e-rate'); if (rate) rate.textContent = Math.round(Math.min(1, enhanceChance(inst.enh) + (opts.bless ? 0.2 : 0)) * 100) + '%';
        const dt = b.querySelector('#e-destroy'); if (dt) dt.textContent = opts.protect ? '파괴 0% (보호)' : '파괴 ' + Math.round(destroyChance(inst.enh) * 100) + '%';
        audio.play('ui_click', { vol: 0.4 });
      });
      const go = b.querySelector('#e-go');
      if (go) go.onclick = () => {
        const lv = inst.enh, r = eco.enhance(uid, opts);
        if (!r.ok) {
          if (r.reason === 'gold') { ui.toast('골드 부족', 'red'); meta.offerGold(); }
          else if (r.reason === 'stones') { ui.toast(STONE_NAME[r.tier || 1] + ' 부족' + (r.tier > 1 ? ' — ' + (r.tier === 3 ? '보스' : '엘리트') + '가 떨굽니다' : ''), 'red'); if (!r.tier || r.tier === 1) meta.offerStones(); }
          else ui.toast('강화할 수 없습니다', 'red');
          audio.play('ui_error'); return;
        }
        meta.trackFunnel('upgrade', { kind: 'item_enhance', level: r.enh, success: r.success });
        meta._sheetDirty = true;
        const art = b.querySelector('.is-head-art');
        if (r.destroyed) { audio.shatter({ vol: 0.75 }); audio.voice('enh_destroy'); audio.vibe([120, 60, 120]); ui.toast('장비가 파괴되었습니다…', 'red'); later(350); }
        else if (r.success) { audio.levelUp({ vol: 0.4, base: 440 + r.enh * 18 }); if (r.enh >= 8) audio.voice('enh_success', { min: 3 }); if (r.enh >= 12) audio.play('jingle_legend', { vol: 0.55 }); audio.vibe([20, 20, 50]); art?.classList.add('enh-flash'); ui.toast('강화 성공! +' + r.enh, 'gold'); later(380); }
        else { audio.fail({ vol: 0.55 }); audio.vibe(60); if (lv >= 8) audio.voice('enh_fail', { min: 3 }); art?.classList.add('enh-fail'); ui.toast(r.down ? '강화 실패… +' + r.enh + '로 하락' : '강화 실패…', 'red'); later(380); }
        meta.refreshTop();
      };
      // 키보드: 시트 안에서 Tab이 순환하고 Esc로 닫힌다. 처리기는 ui.endModal() 이 모달 교체 · 닫힘 때 해제한다.
      b.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key !== 'Tab') return;
        const focusable = [...b.querySelectorAll('button:not([disabled])')];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      ((focus === 'enhance' && b.querySelector('#e-go')) || b.querySelector('#i-eq'))?.focus({ preventScroll: true });
    } });
  };
  render();
}
