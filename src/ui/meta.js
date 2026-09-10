import { $, fmt } from './ui.js';
import { audio } from '../engine/audio.js';
import { heroVoiceName } from '../engine/hero-voice.js';
import { HEROES, HERO_ORDER, RARITY, heroStats, levelExp, levelGold, starShards, skillUpGold } from '../data/heroes.js';
import { ITEM_BY_ID, ITEM_ICON, SLOTS, SLOT_NAME, SETS, THEMED_SETS, CRAFT_COST, craftable, itemStats, enhanceCost, enhanceStones, enhanceStoneTier, STONE_KEY, STONE_NAME, STONE_ICON, enhanceChance, destroyChance, enhanceMult, ENH_MAX, RARITY_COLOR , RARITY_INFO, rarityRank, enhanceDown} from '../data/items.js';
import { SKUS, SHOP_TABS, GACHA, BATTLE_PASS, PASS_TRACK, DAILY_REWARDS } from '../data/shop.js';
import { CHAPTERS, STAGES_PER_CHAPTER, stageDef } from '../data/stages.js';
import { REWARD_LABEL } from '../game/economy.js';
import { storyText, encounterLabel, journalHtml } from './campaign.js';
const CAM_DESC = { auto: '상황에 맞춰 자동 — 탐험은 액션, 난전은 탑다운, 보스는 시네마틱', top: '높이서 내려다보는 클래식 시점 — 몹몰이 파악이 쉽다', action: '낮고 가까운 시점 — 타격감과 속도감이 크다', wide: '멀고 넓은 시점 — 전장 전체와 보스 패턴이 보인다' };

const RC = { N: 'var(--r-n)', R: 'var(--r-r)', SR: 'var(--r-sr)', SSR: 'var(--r-ssr)' };
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (d ? d + '일 ' : '') + `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`; };

export class Meta {
  constructor(app) {
    this.app = app; this.eco = app.eco; this.ui = app.ui;
    this.tab = 'home'; this.chapter = 1; this.stage = null; this.shopTab = 'hot'; this.heroSel = this.eco.s.selected;
    document.querySelectorAll('.bottomnav button').forEach((b) => b.addEventListener('click', () => this.openTab(b.dataset.tab)));
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const k = b.dataset.open; if (k === 'energy') this.openTab('shop', 'energy'); else if (k === 'shop-gold') this.openTab('shop', 'gold'); else this.openTab('shop', 'gem'); }));
    $('btn-battle').addEventListener('click', () => this.app.startStage(this.eco.nextStage()));
    $('stage-pill').addEventListener('click', () => this.openTab('stage'));
    $('btn-campaign-journal').addEventListener('click', () => this.ui.modal(journalHtml(this.eco.s.progress), { onOpen: (box) => { box.querySelector('#journal-close').onclick = () => this.ui.closeModal(); } }));
    $('btn-daily').addEventListener('click', () => this.showDaily());
    $('btn-mail').addEventListener('click', () => this.showMail());
    $('btn-quest').addEventListener('click', () => this.showQuests());
    $('btn-settings').addEventListener('click', () => this.showSettings());
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
    if (tab === 'stage') this.renderStages(); if (tab === 'heroes') this.renderHeroes(); if (tab === 'shop') { if (sub) this.shopTab = sub; this.renderShop(); } if (tab === 'pass') this.renderPass(); if (tab === 'gacha') this.refreshGacha();
    if (tab === 'home') this.refreshHome();
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
    $('v-ticket').textContent = s.tickets + (s.ssrTickets ? ` (SSR확정 ${s.ssrTickets})` : ''); $('v-pity').textContent = s.pity; $('pity-left').textContent = GACHA.pity - s.pity;
    $('promo-starter').style.display = s.purchases.includes('starter') ? 'none' : '';
    $('promo-monthly').style.display = s.monthlyUntil > Date.now() ? 'none' : '';
    if (this.tab === 'home') this.refreshHome();
  }
  refreshHome() {
    const s = this.eco.s; const def = HEROES[s.selected]; const nx = this.eco.nextStage();
    $('lobby-hero-name').textContent = def.name; $('lobby-rarity').textContent = def.rarity; $('lobby-rarity').style.background = RC[def.rarity]; $('lobby-power').textContent = fmt(this.eco.heroPower(s.selected));
    $('stage-pill-txt').textContent = nx.name; $('battle-cost').textContent = nx.energy;
  }
  tick() {
    const s = this.eco.s; this.eco.tickEnergy(); $('v-energy').textContent = s.energy; $('v-energy-timer').textContent = this.eco.energyTimer();
    const st = this.eco.sku('starter'); $('promo-timer').textContent = hms(this.eco.limitedLeft(st));
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
    const chapterCast = [HEROES.knight, HEROES.barbarian, HEROES.mage, HEROES.rogue, { name: '기억의 동행 네브', portrait: '/img/tll/neve-original-v1.webp' }][this.chapter - 1];
    const cleared = Array.from({ length: STAGES_PER_CHAPTER }, (_, i) => this.eco.s.progress.stars[`${this.chapter}-${i + 1}`] || 0).filter(Boolean).length;
    const total = CHAPTERS.reduce((n, c) => n + Array.from({ length: STAGES_PER_CHAPTER }, (_, i) => this.eco.s.progress.stars[`${c.id}-${i + 1}`] || 0).filter(Boolean).length, 0);
    $('tab-stage').dataset.region = chapter.theme;
    $('chapter-brief').innerHTML = `<div class="chapter-copy"><span class="campaign-eyebrow">${storyText(chapter.tagline)}</span><h3>${storyText(chapter.name)}</h3><p>${storyText(chapter.summary)}</p></div><div class="campaign-progress"><b>${cleared}<small> / ${STAGES_PER_CHAPTER}</small></b><span>지역 정복 · 전체 ${total}/50</span><progress value="${cleared}" max="${STAGES_PER_CHAPTER}" aria-label="${storyText(chapter.name)} 클리어 진행도"></progress></div><figure class="chapter-cast"><img src="${chapterCast.portrait}" width="1122" height="1402" alt="${storyText(chapterCast.name)}" decoding="async"><figcaption>${storyText(chapterCast.name)}</figcaption></figure>`;
    for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
      const d = stageDef(this.chapter, st); const unlocked = this.eco.isUnlocked(this.chapter, st); const stars = this.eco.s.progress.stars[`${this.chapter}-${st}`] || 0;
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'stage-cell' + (d.boss ? ' boss' : '') + (unlocked ? '' : ' lock') + (this.stage.st === st ? ' on' : '');
      cell.dataset.stage = d.code; cell.dataset.rank = d.encounter?.rank || 'captain'; cell.setAttribute('aria-pressed', String(this.stage.st === st));
      cell.setAttribute('aria-label', `${d.code} ${d.title} · ${encounterLabel(d)} · ${unlocked ? stars ? `별 ${stars}개` : '도전 가능' : '미개방, 소개 보기'}`);
      cell.innerHTML = `<span class="stage-code">${d.code}</span><span class="stage-rank">${storyText(encounterLabel(d))}</span><span aria-hidden="true" class="st ${stars ? '' : 'none'}">${unlocked ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '미개방'}</span>`;
      cell.onclick = () => { this.stage = d; this.renderStages(); grid.querySelector(`[data-stage="${d.code}"]`)?.focus({ preventScroll: true }); };
      grid.appendChild(cell);
    }
    const d = this.stage; const stars = this.eco.s.progress.stars[`${d.ch}-${d.st}`] || 0; const power = this.eco.heroPower(this.eco.s.selected);
    const unlocked = this.eco.isUnlocked(d.ch, d.st);
    $('stage-detail').innerHTML = `<div class="stage-narrative"><span class="campaign-eyebrow">${d.code} · ${storyText(encounterLabel(d))}</span><h3>${storyText(d.title)}</h3><p class="stage-opening">${storyText(d.story?.opening)}</p><p class="stage-objective"><b>목표</b> ${storyText(d.objective)}</p><div class="stage-tactics"><p><b>${storyText(chapter.mechanic?.name)}</b> ${storyText(chapter.mechanic?.description)}</p><p><b>${storyText(d.encounter?.name)}</b> ${storyText(d.encounter?.tactic)}</p></div></div><div class="stage-launch">
      <div class="meta"><span>권장 전투력 <b style="color:${power >= d.recPower ? 'var(--green)' : 'var(--red)'}">${fmt(d.recPower)}</b></span><span>내 전투력 ${fmt(power)}</span></div>
      <div class="rewards"><span class="reward-chip"><i class="ic ic-gold"></i> ${fmt(d.rewards.gold)}</span><span class="reward-chip">EXP ${d.rewards.exp}</span><span class="reward-chip">장비 ${Math.round(d.rewards.dropChance * 100)}%</span>${!stars ? `<span class="reward-chip"><i class="ic ic-gem"></i> ${d.rewards.firstGems} 첫클리어</span>` : ''}</div>
      ${unlocked ? '' : `<p class="stage-lock-note">${d.st === 1 ? `${d.ch - 1}-10` : `${d.ch}-${d.st - 1}`} 클리어 후 출격할 수 있습니다.</p>`}
      <div class="row"><button class="btn btn-ghost" id="st-sweep" ${stars < 3 || !unlocked ? 'disabled' : ''}>소탕 <small>티켓 ${this.eco.s.sweep}</small></button><button class="btn btn-gold" id="st-go" ${unlocked ? '' : 'disabled'}>${unlocked ? '출격' : '미개방'} <small><i class="ic ic-energy"></i> -${d.energy}</small></button></div></div>`;
    $('st-go').onclick = () => { if (this.eco.isUnlocked(d.ch, d.st)) this.app.startStage(d); };
    $('st-sweep').onclick = () => { const r = this.eco.sweep(d); if (!r) { this.ui.toast('소탕권/에너지 부족', 'red'); return; } audio.play('jingle_win0', { vol: 0.5 }); this.ui.rewardToast([...r.got, ...r.loot.map((it) => ({ k: 'item', item: it }))]); if (r.awakened && r.awakened.length) this.ui.awakenBanner(r.awakened); this.renderStages(); };
  }

  // ================= 영웅 =================
  focusInventory(uid, slot) {
    const bag = $('hero-bag');
    (bag?.querySelector(`[data-inv="${uid}"]`) || bag?.querySelector(`[data-bag-slot="${slot}"]`) || $('h-next'))?.focus();
  }
  renderInventory(heroId) {
    const bag = $('hero-bag'); if (!bag) return;
    const slot = SLOTS.includes(this.bagSlot) ? this.bagSlot : 'all';
    const items = this.eco.s.inventory.filter((x) => slot === 'all' || ITEM_BY_ID[x.id].slot === slot)
      .slice().sort((a, b) => rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity) || (b.enh || 0) - (a.enh || 0));
    const equipped = new Set(Object.values(this.eco.s.heroes).flatMap((h) => Object.values(h.equip)));
    bag.innerHTML = `<div class="bag-filters" role="group" aria-label="장비 부위 필터">${['all', ...SLOTS].map((s) => `<button type="button" data-bag-slot="${s}" aria-pressed="${s === slot}">${s === 'all' ? '전체' : SLOT_NAME[s]}</button>`).join('')}</div>
      <div class="inv-list">${items.map((inst) => {
        const it = ITEM_BY_ID[inst.id], eq = equipped.has(inst.uid);
        return `<button type="button" class="equip-slot has inventory-item rar-${it.rarity}" data-inv="${inst.uid}" aria-label="${it.name} +${inst.enh}${eq ? ' 장착 중' : ''}" title="${it.name}"><img src="${ITEM_ICON(it)}" alt=""><span class="inventory-name">${it.name}</span><span class="inventory-level">+${inst.enh}${eq ? ' · 장착 중' : ''}</span></button>`;
      }).join('') || '<p class="bag-empty">이 부위의 장비가 없습니다. 던전에서 전리품을 모아 보세요.</p>'}</div>`;
    bag.querySelectorAll('[data-bag-slot]').forEach((button) => button.onclick = () => {
      this.bagSlot = button.dataset.bagSlot; this.renderInventory(heroId);
      bag.querySelector(`[data-bag-slot="${this.bagSlot}"]`)?.focus();
    });
    bag.querySelectorAll('[data-inv]').forEach((button) => button.onclick = () => this.showItem(+button.dataset.inv, heroId));
  }
  nextChallengeHtml() {
    const next = this.eco.nextStage(), power = this.eco.heroPower(this.eco.s.selected);
    return `<section class="next-challenge" aria-label="다음 층 도전"><div><b>${next.name}</b><p>구역을 정화해 봉인을 풀고, 보스를 처치하세요.</p><small>권장 전투력 ${fmt(next.recPower)} · 출전 ${HEROES[this.eco.s.selected].name} ${fmt(power)}</small></div><button type="button" class="btn btn-gold" id="h-next">정비 마치고 출격 <small>에너지 -${next.energy}</small></button></section>`;
  }
  itemComparisonHtml(heroId, uid) {
    const p = this.eco.previewItem(heroId, uid); if (!p) return '';
    const label = p.remove ? '해제 후' : '장착 후';
    const rows = [['power', '전투력'], ['atk', '공격력'], ['hp', 'HP'], ['def', '방어'], ['crit', '치명타'], ['critDmg', '치명 피해'], ['ultGain', '궁극기 수급']];
    const number = (key, value) => ['crit', 'critDmg', 'ultGain'].includes(key) ? (value * 100).toFixed(1) + '%' : fmt(value);
    const sets = [...new Set([...Object.keys(p.beforeBonus.sets), ...Object.keys(p.afterBonus.sets)])].map((sid) => {
      const before = p.beforeBonus.sets[sid] || 0, after = p.afterBonus.sets[sid] || 0;
      if (before === after) return '';
      const set = SETS[sid]; if (!set) return '';
      const tier = (n) => n >= 4 ? 4 : n >= 2 ? 2 : 0;
      const changed = tier(before) !== tier(after), effect = after >= 4 ? set.four : after >= 2 ? set.two : null;
      const effectText = effect?.text || (effect ? Object.entries(effect).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${({ atk: '공격력', hp: 'HP', crit: '치명타', critDmg: '치명 피해', ultGain: '궁극기 수급' })[k] || k} +${Math.round(v * 100)}%`).join(' · ') : '활성 효과 없음');
      return `<li><b>${set.name}</b> ${before}/4 → ${after}/4${changed ? `<strong class="${tier(after) > tier(before) ? 'stat-up' : 'stat-down'}"> ${tier(before)}세트 → ${tier(after)}세트</strong>` : ''}<small>${effectText}</small></li>`;
    }).filter(Boolean).join('');
    const current = p.current ? `${ITEM_BY_ID[p.current.id].name} +${p.current.enh}` : '없음';
    return `<section class="item-comparison"><h3>${HEROES[heroId].name} · ${label} 비교</h3><p>현재 ${SLOT_NAME[p.slot]}: ${current}</p>
      ${p.owner && p.owner !== heroId ? `<p class="stat-down">${HEROES[p.owner].name}에게 장착 중입니다. 장착하면 해당 영웅에게서 옮겨옵니다.</p>` : ''}
      <table><thead><tr><th>능력치</th><th>현재</th><th>${label}</th><th>변화</th></tr></thead><tbody>${rows.map(([key, name]) => {
        const delta = p.after[key] - p.before[key];
        return `<tr><th>${name}</th><td>${number(key, p.before[key])}</td><td>${number(key, p.after[key])}</td><td class="${delta > 0 ? 'stat-up' : delta < 0 ? 'stat-down' : ''}">${delta > 0 ? '+' : delta < 0 ? '−' : ''}${number(key, Math.abs(delta))}</td></tr>`;
      }).join('')}</tbody></table><ul>${sets || '<li>세트 구성 변화 없음</li>'}</ul><small>전투력과 세트 효과를 함께 비교해 선택하세요.</small></section>`;
  }
  renderHeroes() {
    const list = $('hero-list'); list.innerHTML = '';
    if (!HEROES[this.heroSel]) this.heroSel = this.eco.s.selected;
    for (const id of HERO_ORDER) {
      const def = HEROES[id]; const own = this.eco.ownHero(id); const h = this.eco.hero(id);
      const c = document.createElement('div'); c.className = `hero-card rar-${def.rarity}` + (own ? '' : ' lock') + (this.heroSel === id ? ' on' : '');
      c.innerHTML = `<img src="${def.portrait}" onerror="this.style.background='${def.color}'"><span class="rar bg-${def.rarity}">${def.rarity}</span>${own ? `<span class="lv">Lv.${h.level} ${'★'.repeat(h.star)}</span>` : '<span class="lockt">미보유</span>'}`;
      c.onclick = () => { this.heroSel = id; this.renderHeroes(); };
      list.appendChild(c);
    }
    const id = this.heroSel; const def = HEROES[id]; const own = this.eco.ownHero(id); const det = $('hero-detail');
    this.app.wardrobe?.show(id);
    if (!own) { det.innerHTML = `<h2>${def.name}</h2><div class="sub">${def.title} · ${def.rarity}</div><p style="color:var(--muted);font-size:13px">${def.skills.map((s) => s.name).join(' · ')}</p><button class="btn btn-gold" id="h-summon">소환으로 획득</button>`; $('h-summon').onclick = () => this.openTab('gacha'); return; }
    const h = this.eco.hero(id); const st = heroStats(def, h, this.eco.heroEquipBonus(id)); const sel = this.eco.s.selected === id;
    det.innerHTML = `<h2>${def.name} <small style="font-size:12px;color:${RC[def.rarity]}">${def.rarity}</small></h2><div class="sub">${def.title} · Lv.${h.level} · ${'★'.repeat(h.star)}${'☆'.repeat(5 - h.star)} · 전투력 <b style="color:var(--gold)">${fmt(st.power)}</b></div>
      <div class="bar" style="margin-bottom:8px;height:8px"><div style="width:${Math.min(100, h.exp / levelExp(h.level) * 100)}%"></div></div>
      <div class="stat-grid"><div class="stat">HP <b>${fmt(st.hp)}</b></div><div class="stat">공격력 <b>${fmt(st.atk)}</b></div><div class="stat">방어력 <b>${st.def}</b></div><div class="stat">치명타 <b>${Math.round(st.crit * 100)}%</b></div></div>
      <div class="hero-actions"><button class="btn btn-blue btn-sm" id="h-lv">레벨업 <small><i class="ic ic-gold"></i> ${fmt(levelGold(h.level))}</small></button><button class="btn btn-gold btn-sm" id="h-star" ${h.star >= 5 ? 'disabled' : ''}>승급 <small>조각 ${h.shards}/${starShards(h.star)}</small></button>${sel ? '<button class="btn btn-ghost btn-sm" disabled>출전 중</button>' : '<button class="btn btn-ghost btn-sm" id="h-sel">출전 영웅으로</button>'}</div>
      <h3 style="margin:12px 0 6px;font-size:14px">스킬</h3><div class="skill-row">${def.skills.filter((s) => !s.unlock).map((s, i) => `<div class="skill-ic" data-sk="${i}" style="border-color:${def.color}"><img src="${s.icon}" onerror="this.style.display='none';this.parentNode.style.background='${def.color}'"><span>Lv.${h.skills[i] || 1}</span></div>`).join('')}</div>
      <h3 style="margin:12px 0 6px;font-size:14px">각성 <small style="color:#ff9ad8">레벨 구간 해금</small></h3><div class="skill-row">${def.skills.map((s, i) => ({ s, i })).filter((o) => o.s.unlock).map(({ s, i }) => { const ok = h.level >= s.unlock; return `<div class="skill-ic awk${ok ? '' : ' locked'}" data-sk="${i}" style="border-color:${ok ? '#ff9ad8' : 'rgba(255,255,255,.18)'}"><img src="${s.icon}" onerror="this.style.display='none';this.parentNode.style.background='${def.color}'"><span>${ok ? 'Lv.' + (h.skills[i] || 1) : '🔒 Lv.' + s.unlock}</span></div>`; }).join('')}<div class="awk-note">${(() => { const nx = def.skills.find((s) => s.unlock && h.level < s.unlock); return nx ? `Lv.${nx.unlock} 까지 <b style="color:var(--gold)">${nx.unlock - h.level}</b> 레벨 — <b style="color:#ff9ad8">${nx.name}</b> 해금` : '모든 각성 해금 완료'; })()}</div></div>
      <h3 style="margin:12px 0 6px;font-size:14px">세트 효과</h3>${this.setListHtml(id)}
      <h3 style="margin:12px 0 6px;font-size:14px">장비</h3><div class="equip-grid">${SLOTS.map((sl) => { const uid = h.equip[sl]; const inst = this.eco.s.inventory.find((x) => x.uid === uid); if (!inst) return `<div class="equip-slot" data-slot="${sl}">${SLOT_NAME[sl]}<br>+</div>`; const it = ITEM_BY_ID[inst.id]; return `<div class="equip-slot has rar-${it.rarity}" data-slot="${sl}" data-uid="${uid}"><img src="${ITEM_ICON(it)}" onerror="this.remove()"><span class="plus">+${inst.enh}</span></div>`; }).join('')}</div>
      <h3 style="margin:12px 0 6px;font-size:14px">가방 <small style="color:var(--muted)">${this.eco.s.inventory.length}개</small></h3><div id="hero-bag"></div>${this.nextChallengeHtml()}`;
    this.renderInventory(id);
    $('h-next').onclick = () => this.app.startStage(this.eco.nextStage());
    $('h-lv').onclick = () => { if (this.eco.levelUpHero(id)) { audio.levelUp({ vol: 0.42 }); audio.vibe(20); this.ui.toast(`Lv.${this.eco.hero(id).level} 달성!`, 'gold'); this.renderHeroes(); } else { this.ui.toast('골드 부족', 'red'); audio.play('ui_error'); this.offerGold(); } };
    $('h-star').onclick = () => { if (this.eco.promoteHero(id)) { audio.play('jingle_legend', { vol: 0.7 }); this.ui.toast('승급 성공! ★' + this.eco.hero(id).star, 'gold'); this.renderHeroes(); } else { this.ui.toast('영웅 조각 부족 — 소환에서 중복 획득 시 조각 +10', 'red'); } };
    const hs = $('h-sel'); if (hs) hs.onclick = () => { this.eco.s.selected = id; this.eco.emit(); this.app.showcaseHero(id); this.renderHeroes(); this.ui.toast(`${def.name} 출전!`, 'gold'); audio.voice(heroVoiceName(id, 'select'), { min: 1 }); };
    det.querySelectorAll('[data-sk]').forEach((el) => el.onclick = () => this.showSkill(id, +el.dataset.sk));
    const hc = $('h-craft'); if (hc) hc.onclick = () => this.showCraft(id);
    det.querySelectorAll('.equip-slot[data-slot]').forEach((el) => el.onclick = () => { const uid = el.dataset.uid; if (uid) this.showItem(+uid, id); else this.ui.toast('가방에서 장비를 선택해 장착하세요'); });
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
    return `<div class="set-list">${rows || '<div style="font-size:11px;color:var(--muted)">같은 등급 장비 2/4개 = 스탯 세트 · 테마 세트와 원정 전용 세트는 2/4개 장착 시 전투 효과가 발동합니다</div>'}<button class="btn btn-ghost btn-sm" id="h-craft" style="align-self:flex-start">세트 제작 <small><img src="/img/icon_fragment.webp" style="width:12px;height:12px;vertical-align:-2px"> ${this.eco.s.fragments || 0}</small></button></div>`;
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
    const lockNote = sk.unlock && h.level < sk.unlock ? `<p style="color:#ff9ad8;font-weight:900">🔒 영웅 Lv.${sk.unlock} 달성 시 해금 (현재 Lv.${h.level})</p>` : '';
    this.ui.modal(`<h2>${sk.name} ${sk.unlock ? '<small style="font-size:11px;color:#ff9ad8">각성</small>' : ''} <small style="font-size:12px">Lv.${lv}</small></h2><p>${sk.desc}</p>${lockNote}<p>피해 배율 <b style="color:var(--gold)">${(sk.dmg * (1 + (lv - 1) * 0.12)).toFixed(1)}x${sk.ticks ? ` × ${sk.ticks}회` : ''}</b> ${sk.ult ? '· 궁극기 (게이지 100)' : `· 쿨타임 ${sk.cd}초`}</p>
      <div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button><button class="btn btn-gold" id="m-up" ${lv >= 10 ? 'disabled' : ''}>강화 <small><i class="ic ic-gold"></i> ${fmt(cost)}</small></button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-up').onclick = () => { if (this.eco.upgradeSkill(id, i)) { audio.play('jingle_win1', { vol: 0.5 }); this.ui.closeModal(); this.renderHeroes(); this.ui.toast(`${sk.name} Lv.${lv + 1}!`, 'gold'); } else { this.ui.toast('골드 부족', 'red'); this.offerGold(); } }; } });
  }
  showItem(uid, heroId) {
    const inst = this.eco.s.inventory.find((x) => x.uid === uid); if (!inst) return;
    const it = ITEM_BY_ID[inst.id]; const h = this.eco.hero(heroId); const equipped = h.equip[it.slot] === uid;
    const st = itemStats(inst);
    const statTxt = [st.atk ? `공격력 +${st.atk}` : '', st.hp ? `HP +${st.hp}` : '', st.def ? `방어 +${st.def}` : '', st.crit ? `치명 +${Math.round(st.crit * 100)}%` : ''].filter(Boolean).join(' · ');
    const set = it.set ? SETS[it.set] : null;
    this.ui.modal(`<div class="item-detail"><img src="${ITEM_ICON(it)}" onerror="this.remove()"><div><div style="font-weight:900;font-size:16px;color:${RARITY_COLOR[it.rarity]}">${it.name} <span style="color:var(--gold)">+${inst.enh}</span></div><div style="font-size:12px;color:var(--muted)"><b style="color:${RARITY_COLOR[it.rarity]}">${RARITY_INFO[it.rarity].name}</b> · ${SLOT_NAME[it.slot]}${set ? ' · ' + set.name : ''}</div><div style="font-size:13px;margin-top:4px">${statTxt}</div></div></div>
      ${this.itemComparisonHtml(heroId, uid)}
      <div class="modal-btns item-actions"><button class="btn btn-ghost btn-sm" id="i-close">닫기</button><button class="btn btn-ghost btn-sm" id="i-sell">판매</button><button class="btn btn-blue btn-sm" id="i-enh">강화</button><button class="btn btn-gold btn-sm" id="i-eq">${equipped ? '해제' : '장착'}</button></div>`, { onOpen: (b) => {
      b.querySelector('#i-close').onclick = () => { this.ui.closeModal(); this.focusInventory(uid, it.slot); };
      b.querySelector('#i-eq').onclick = () => { if (equipped) this.eco.unequip(heroId, it.slot); else this.eco.equip(heroId, uid); audio.play('ui_confirm', { vol: 0.5 }); this.ui.closeModal(); this.renderHeroes(); if (heroId === this.eco.s.selected) this.app.showcaseHero(heroId); this.focusInventory(uid, it.slot); };   // 장착 즉시 외형 반영
      b.querySelector('#i-sell').onclick = async () => { if (await this.ui.confirm('판매', `${it.name} +${inst.enh} 을(를) 판매할까요?`)) { const g = this.eco.sellItem(uid); this.ui.toast(`골드 +${fmt(g)}`, 'gold'); audio.pick('coin', 2); this.renderHeroes(); this.focusInventory(uid, it.slot); } else this.showItem(uid, heroId); };
      b.querySelector('#i-enh').onclick = () => { this.ui.closeModal(); this.showEnhance(uid, heroId); };
      const actions = [...b.querySelectorAll('.item-actions button')];
      for (const button of actions) button.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); b.querySelector('#i-close').click(); }
        else if (event.key === 'Tab' && ((event.shiftKey && button === actions[0]) || (!event.shiftKey && button === actions.at(-1)))) {
          event.preventDefault(); (event.shiftKey ? actions.at(-1) : actions[0]).focus();
        }
      };
      b.querySelector('#i-close').focus();
    } });
  }
  /** 강화 패널 — 과금 유도 핵심 화면 */
  showEnhance(uid, heroId) {
    const render = () => {
      const inst = this.eco.s.inventory.find((x) => x.uid === uid);
      if (!inst) { this.ui.modal(`<h2 style="color:var(--red)">장비 파괴</h2><p>강화에 실패해 장비가 파괴되었습니다.</p><div class="modal-btns"><button class="btn btn-gold" id="m-ok">확인</button></div>`, { onOpen: (b) => b.querySelector('#m-ok').onclick = () => { this.ui.closeModal(); this.renderHeroes(); } }); return; }
      const it = ITEM_BY_ID[inst.id]; const lv = inst.enh; const s = this.eco.s;
      const cur = itemStats(inst); const nextInst = { ...inst, enh: Math.min(ENH_MAX, lv + 1) }; const nxt = itemStats(nextInst);
      const cost = enhanceCost(lv), stones = enhanceStones(lv); const tier = enhanceStoneTier(lv), skey = STONE_KEY[tier];
      const chance = enhanceChance(lv), destroy = destroyChance(lv);
      const maxed = lv >= ENH_MAX;
      const rows = [['공격력', cur.atk, nxt.atk], ['HP', cur.hp, nxt.hp], ['방어', cur.def, nxt.def]].filter((r) => r[1] || r[2]);
      const html = `<div class="enh-wrap">
        <h2>장비 강화</h2>
        <div class="enh-item">
          <div class="enh-icon" style="--rc:${RARITY_COLOR[it.rarity]}"><img src="${ITEM_ICON(it)}" onerror="this.remove()"><span class="lv">+${lv}</span></div>
          ${maxed ? '' : `<div class="enh-arrow">▶</div><div class="enh-icon" style="--rc:${RARITY_COLOR[it.rarity]}"><img src="${ITEM_ICON(it)}" onerror="this.remove()"><span class="lv">+${lv + 1}</span></div>`}
        </div>
        <div style="font-weight:900;color:${RARITY_COLOR[it.rarity]}">${it.name}</div>
        ${maxed ? '<p style="color:var(--gold);font-weight:900">최대 강화 달성!</p>' : `
        <div class="enh-stats">${rows.map((r) => `<div><span>${r[0]}</span><span>${fmt(r[1])} → <b>${fmt(r[2])}</b></span></div>`).join('')}</div>
        <div class="enh-rate">성공 확률 <b id="e-rate">${Math.round(chance * 100)}%</b>${destroy > 0 ? ` · <span class="warn" id="e-destroy">파괴 ${Math.round(destroy * 100)}%</span>` : ''}${enhanceDown(lv) ? ' · 실패 시 <b>-1</b> 하락' : ''}</div>
        <div class="enh-opts">
          <div class="enh-opt" data-opt="bless"><img src="/img/icon_bless.webp" onerror="this.remove()"><span>축복 +20%</span><span class="cnt">×${s.bless}</span></div>
          ${destroy > 0 ? `<div class="enh-opt" data-opt="protect"><img src="/img/icon_protect.webp" onerror="this.remove()"><span>보호 (파괴 방지)</span><span class="cnt">×${s.protect}</span></div>` : ''}
        </div>
        <div class="enh-cost"><span class="${s.gold < cost ? 'lack' : ''}"><i class="ic ic-gold"></i> ${fmt(cost)}</span>${stones ? `<span class="${(s[skey] || 0) < stones ? 'lack' : ''}"><img src="${STONE_ICON[tier]}" style="width:14px;height:14px;vertical-align:-2px" onerror="this.remove()"> ${STONE_NAME[tier]} ${stones} <span style="color:var(--muted)">(보유 ${s[skey] || 0})</span></span>` : ''}</div>`}
        <div class="modal-btns"><button class="btn btn-ghost" id="e-close">닫기</button>${maxed ? '' : '<button class="btn btn-gold" id="e-go">강화하기</button>'}</div>
        <p style="font-size:10px">+7까지 100% · +10부터 실패 시 하락 · +12부터 파괴 위험 · 강화는 등급과 무관하게 붙는다(흰 무기 +10 &gt; 레전드리 +0) · 비석 3종: 강화석(+9까지) · 상급(엘리트 드랍, +14까지) · 전설(보스 드랍, +15↑)</p>
      </div>`;
      this.ui.modal(html, { onOpen: (b) => {
        const opts = { bless: false, protect: false };
        b.querySelectorAll('.enh-opt').forEach((el) => el.onclick = () => {
          const k = el.dataset.opt; if (s[k] <= 0) { this.ui.toast(`${k === 'bless' ? '축복' : '보호'} 주문서가 없습니다`, 'red'); this.offerScroll(k); return; }
          opts[k] = !opts[k]; el.classList.toggle('on', opts[k]);
          const rt = b.querySelector('#e-rate'); if (rt) rt.textContent = Math.round(Math.min(1, chance + (opts.bless ? 0.2 : 0)) * 100) + '%';
          const dt = b.querySelector('#e-destroy'); if (dt) dt.textContent = opts.protect ? '파괴 0% (보호)' : `파괴 ${Math.round(destroy * 100)}%`;
          audio.play('ui_click', { vol: 0.4 });
        });
        b.querySelector('#e-close').onclick = () => { this.ui.closeModal(); this.renderHeroes(); };
        const go = b.querySelector('#e-go'); if (go) go.onclick = () => {
          const r = this.eco.enhance(uid, opts);
          if (!r.ok) {
            if (r.reason === 'gold') { this.ui.toast('골드 부족', 'red'); this.offerGold(); }
            else if (r.reason === 'stones') { this.ui.toast(`${STONE_NAME[r.tier || 1]} 부족${r.tier > 1 ? ' — ' + (r.tier === 3 ? '보스' : '엘리트') + '가 떨굽니다' : ''}`, 'red'); if (!r.tier || r.tier === 1) this.offerStones(); }
            else this.ui.toast('강화할 수 없습니다', 'red');
            audio.play('ui_error'); return;
          }
          const icon = b.querySelector('.enh-icon');
          if (r.destroyed) { audio.shatter({ vol: 0.75 }); audio.voice('enh_destroy'); audio.vibe([120, 60, 120]); this.ui.toast('장비가 파괴되었습니다…', 'red'); setTimeout(render, 350); }
          else if (r.success) { audio.levelUp({ vol: 0.4, base: 440 + r.enh * 18 }); if (r.enh >= 8) audio.voice('enh_success', { min: 3 }); if (r.enh >= 12) audio.play('jingle_legend', { vol: 0.55 }); audio.vibe([20, 20, 50]); icon?.classList.add('enh-flash'); this.ui.toast(`강화 성공! +${r.enh}`, 'gold'); setTimeout(render, 380); }
          else { audio.fail({ vol: 0.55 }); audio.vibe(60); if (lv >= 8) audio.voice('enh_fail', { min: 3 }); icon?.classList.add('enh-fail'); this.ui.toast(r.down ? `강화 실패… +${r.enh}로 하락` : '강화 실패…', 'red'); setTimeout(render, 380); }
          this.refreshTop();
        };
      } });
    };
    render();
  }
  offerStones() { setTimeout(() => this.ui.modal(`<h2>강화석이 부족합니다</h2><p>강화석은 전투 필드 드랍 또는 상점에서 얻을 수 있어요</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">나중에</button><button class="btn btn-gold" id="m-ok">강화 상점</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { this.ui.closeModal(); this.openTab('shop', 'enh'); }; } }), 500); }
  offerScroll(k) { setTimeout(() => this.ui.modal(`<h2>${k === 'bless' ? '축복' : '보호'} 주문서가 없습니다</h2><p>${k === 'bless' ? '성공률을 20% 올려줍니다.' : '실패해도 장비가 파괴되지 않습니다.'}<br>상점에서 구매할 수 있어요.</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">나중에</button><button class="btn btn-gold" id="m-ok">강화 상점</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { this.ui.closeModal(); this.openTab('shop', 'enh'); }; } }), 500); }
  offerGold() { setTimeout(() => this.ui.modal(`<h2>골드가 부족합니다</h2><p>보석으로 골드를 즉시 충전할 수 있어요</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">나중에</button><button class="btn btn-gold" id="m-ok">골드 상점</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { this.ui.closeModal(); this.openTab('shop', 'gold'); }; } }), 600); }

  // ================= 가챠 =================
  refreshGacha() { const f = HEROES[GACHA.featured]; $('banner-title').textContent = f.name; $('banner-art').src = '/img/banner_featured.webp'; $('banner-art').onerror = () => { $('banner-art').src = f.portrait; }; this.refreshTop(); }
  async pull(n) {
    const s = this.eco.s; const cost = n === 10 ? GACHA.ten : GACHA.single; const useTicket = n === 1 ? s.tickets > 0 : s.tickets >= 10;
    if (!useTicket && s.gems < cost) { audio.play('ui_error'); const ok = await this.ui.confirm('보석 부족', `보석 ${fmt(cost)}개가 필요합니다 (보유 ${fmt(s.gems)})<br>지금 충전하면 첫 결제 <b style="color:var(--green)">2배 보너스</b>!`, { ok: '보석 충전', cancel: '취소' }); if (ok) this.openTab('shop', 'gem'); return; }
    const results = this.eco.pull(n); if (!results) return;
    this.showReveal(results);
  }
  pullSSR() { const r = this.eco.pullSSR(); if (r) this.showReveal(r); }
  showReveal(results) {
    const R = $('reveal'); this.ui.show(R, true); this.app.setLobbyVisible(false);
    const stage = $('reveal-stage'), cards = $('reveal-cards'); stage.innerHTML = ''; cards.innerHTML = ''; $('reveal-foot').classList.add('hidden'); $('btn-reveal-skip').classList.remove('hidden');
    const best = results.some((r) => r.rar === 'SSR') ? 'SSR' : results.some((r) => r.rar === 'SR') ? 'SR' : 'R';
    audio.playMusic('bgm_gacha', { fade: 0.5, volume: 0.5 }); audio.play('pack_open', { vol: 0.8 }); audio.magic({ vol: 0.4, base: 392, notes: [0, 4, 7, 12, 16, 19], step: 0.09 });
    const beamColor = { R: '#4cc3ff', SR: '#b26bff', SSR: '#ffcf5a' }[best];
    // 광선 연출: 등급 예고 (SSR이면 금색 빔 + 화면 흔들림)
    setTimeout(() => { for (let i = 0; i < (best === 'SSR' ? 7 : best === 'SR' ? 4 : 2); i++) { const b = document.createElement('div'); b.className = 'beam'; b.style.setProperty('--c', beamColor); b.style.left = (50 + (i - 3) * 8) + '%'; b.style.animationDelay = i * 0.08 + 's'; stage.appendChild(b); } audio.play('ui_max', { vol: 0.7, rate: best === 'SSR' ? 0.6 : 1 }); if (best === 'SSR') { audio.vibe([50, 50, 50, 50, 200]); } }, 500);
    setTimeout(() => { const f = document.createElement('div'); f.className = 'flash'; f.style.setProperty('--c', beamColor); stage.appendChild(f); audio.play(best === 'SSR' ? 'jingle_legend' : 'ui_bong', { vol: 0.9 }); }, 1300);
    this._revealTimers = [];
    results.forEach((r, i) => {
      const c = document.createElement('div'); c.className = 'rcard' + (results.length === 1 ? ' single' : '') + ' ' + r.rar; c.style.setProperty('--rc', RC[r.rar]);
      const img = r.type === 'hero' ? r.img : ITEM_ICON(ITEM_BY_ID[r.item.id]); const name = r.type === 'hero' ? r.name : ITEM_BY_ID[r.item.id].name;
      c.innerHTML = `<div class="inner"><div class="face back">?</div><div class="face front"><img src="${img}" onerror="this.remove()"><span class="rr">${r.rar}</span>${r.type === 'hero' && !r.dup ? '<span class="new">NEW</span>' : ''}<div class="nm">${name}${r.type === 'hero' && r.dup ? '<br><small style="color:var(--muted)">조각 +10</small>' : ''}</div></div></div>`;
      cards.appendChild(c);
      const t = setTimeout(() => { c.classList.add('flip'); if (r.rar === 'SSR') { audio.play('jingle_legend', { vol: 0.9 }); audio.vibe([30, 30, 100]); stage.innerHTML = ''; const f = document.createElement('div'); f.className = 'flash'; f.style.setProperty('--c', '#ffcf5a'); stage.appendChild(f); } else if (r.rar === 'SR') { audio.play('ui_glass', { vol: 0.7, rate: 1.2 }); } else audio.play('card_place', { vol: 0.5 }); if (i === results.length - 1) this.revealDone(); }, 1800 + i * 260);
      this._revealTimers.push(t);
    });
    this._revealResults = results;
  }
  revealSkip() { this._revealTimers.forEach(clearTimeout); document.querySelectorAll('.rcard').forEach((c) => c.classList.add('flip')); audio.play('card_fan', { vol: 0.6 }); this.revealDone(); }
  revealDone() { $('reveal-foot').classList.remove('hidden'); $('btn-reveal-skip').classList.add('hidden'); const s = this.eco.s; $('btn-reveal-again').disabled = s.gems < GACHA.ten && s.tickets < 10; }
  revealClose() { this.ui.show($('reveal'), false); this.app.setLobbyVisible(this.tab === 'home'); audio.playMusic('bgm_lobby'); this.refreshTop(); if (this._revealResults?.some((r) => r.type === 'hero' && !r.dup)) this.ui.toast('새 영웅 획득! 영웅 탭에서 출전 설정', 'gold'); }
  showRates() { this.ui.modal(`<h2>소환 확률</h2><table class="rates-table"><tr><td>SSR 영웅 (픽업 50%)</td><td style="color:var(--r-ssr)">1.5%</td></tr><tr><td>SSR 장비</td><td style="color:var(--r-ssr)">0.5%</td></tr><tr><td>SR 영웅</td><td style="color:var(--r-sr)">6.0%</td></tr><tr><td>SR 장비</td><td style="color:var(--r-sr)">6.0%</td></tr><tr><td>R 장비</td><td>86.0%</td></tr></table><p>${GACHA.pity}회 내 SSR 확정 · ${GACHA.softPity}회부터 확률 상승 · 10연차 SR 이상 1장 보장 · 중복 영웅은 조각 +10</p>${this.eco.s.ssrTickets ? `<button class="btn btn-gold" style="width:100%" id="m-ssr">SSR 확정권 사용 (${this.eco.s.ssrTickets})</button>` : ''}<div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); const s = b.querySelector('#m-ssr'); if (s) s.onclick = () => { this.ui.closeModal(); this.pullSSR(); }; } }); }

  // ================= 상점 =================
  renderShop() {
    const tabs = $('shop-tabs'); tabs.innerHTML = SHOP_TABS.map((t) => `<button data-t="${t.id}" class="${t.id === this.shopTab ? 'on' : ''}">${t.name}</button>`).join('');
    tabs.querySelectorAll('button').forEach((b) => b.onclick = () => { this.shopTab = b.dataset.t; this.renderShop(); });
    const grid = $('shop-grid'); grid.innerHTML = ''; const s = this.eco.s;
    for (const sku of SKUS.filter((x) => x.tab === this.shopTab || (this.shopTab === 'hot' && x.badge && x.tab !== 'gem' && x.tab !== 'energy' && x.tab !== 'gold'))) {
      const d = document.createElement('div'); const big = sku.tab === 'hot' || sku.tab === 'pack'; d.className = 'shop-item' + (sku.badge ? ' hot' : '') + (big ? ' big' : '');
      const first = sku.gems && !s.firstPurchaseUsed[sku.id]; const sold = sku.once && s.purchases.includes(sku.id);
      const price = sku.kind === 'gem' ? `<i class="ic ic-gem"></i> ${sku.price}` : sku.priceLabel;
      d.innerHTML = `${sku.badge ? `<span class="badge">${sku.badge}</span>` : ''}${first ? '<span class="badge first" style="left:auto;right:-4px;transform:rotate(5deg)">첫결제 2배</span>' : ''}<img src="${sku.icon}" onerror="this.remove()"><div class="si-body"><div class="si-name">${sku.name}</div><div class="si-desc">${sku.desc || ''}</div>${sku.gems ? `<div class="si-bonus">${first ? `+${fmt(sku.bonus)} 보너스 (2배!)` : `+${fmt(Math.floor(sku.gems * 0.1))} 보너스`}</div>` : ''}${sku.limited ? `<div class="timer" data-timer="${sku.id}">남은 시간 ${hms(this.eco.limitedLeft(sku))}</div>` : ''}<button class="btn ${sku.kind === 'gem' ? 'btn-blue' : 'btn-gold'}">${price}</button></div>${sold ? '<div class="sold">구매 완료</div>' : ''}`;
      d.querySelector('button').onclick = () => this.buy(sku.id);
      grid.appendChild(d);
    }
  }
  async buy(id) {
    const sku = this.eco.sku(id); if (!sku) return; const s = this.eco.s;
    if (sku.once && s.purchases.includes(id)) { this.ui.toast('이미 구매한 상품입니다', 'red'); return; }
    if (sku.kind === 'gem') { if (s.gems < sku.price) { audio.play('ui_error'); const ok = await this.ui.confirm('보석 부족', `보석 ${sku.price}개가 필요합니다`, { ok: '보석 충전' }); if (ok) this.openTab('shop', 'gem'); return; } const r = this.eco.purchase(id); audio.pick('coin', 2, { vol: 0.7 }); this.ui.rewardToast(r.got); this.renderShop(); return; }
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
    const cell = (r, prem, l) => { const claimed = (prem ? p.claimedPrem : p.claimedFree).includes(l); const can = l <= lv && !claimed && (!prem || p.premium); const k = Object.keys(r)[0]; const [nm, ic] = REWARD_LABEL[k]; return `<div class="pass-cell ${prem ? 'prem' : ''} ${l > lv || (prem && !p.premium) ? 'lock' : ''} ${can ? 'claim' : ''} ${claimed ? 'done' : ''}" data-lv="${l}" data-prem="${prem ? 1 : 0}"><img src="${ic}" onerror="this.remove()"><span>${nm} ${fmt(r[k])}</span></div>`; };
    PASS_TRACK.forEach((t) => { const d = document.createElement('div'); d.className = 'pass-col' + (t.lv <= lv ? ' reached' : ''); d.innerHTML = `<div class="plv">Lv.${t.lv}</div>${cell(t.free, false, t.lv)}${cell(t.prem, true, t.lv)}`; tr.appendChild(d); });
    tr.querySelectorAll('.pass-cell').forEach((c) => c.onclick = () => { const l = +c.dataset.lv, prem = c.dataset.prem === '1'; if (prem && !p.premium) { this.buyPass(); return; } const got = eco.claimPass(l, prem); if (got) { audio.pick('coin', 2, { vol: 0.6 }); this.ui.rewardToast(got); this.renderPass(); } });
    // 현재 레벨로 스크롤
    const col = tr.children[Math.max(0, lv - 2)]; if (col) tr.scrollLeft = col.offsetLeft - 20;
  }
  async buyPass() {
    if (this.eco.s.pass.premium) return;
    const sku = { id: 'pass', name: '시즌 패스 프리미엄', priceLabel: '₩9,900', icon: '/img/icon_pass.webp', desc: '프리미엄 보상 30단계 해금 · SSR 확정권 3장 포함' };
    const ok = await this.ui.paySheet(sku); if (!ok) return; this.eco.buyPass(); this.ui.purchaseDone(sku, [{ k: 'gems', n: 0 }].filter((x) => x.n)); this.renderPass();
  }

  // ================= 출석 / 우편 / 임무 / 설정 =================
  showDaily() {
    const d = this.eco.s.daily; const avail = this.eco.dailyAvailable(); const idx = d.day % DAILY_REWARDS.length;
    this.ui.modal(`<h2>출석 보상</h2><p>매일 접속하고 보상을 받으세요! 7일차 SSR 확정권</p><div class="daily-grid">${DAILY_REWARDS.map((r, i) => { const k = Object.keys(r)[0]; const [nm, ic] = REWARD_LABEL[k]; const got = i < idx || (!avail && i === idx - 1 && false); return `<div class="daily-cell ${i < idx ? 'got' : ''} ${avail && i === idx ? 'today' : ''} ${i === 6 ? 'big' : ''}"><img src="${ic}" onerror="this.remove()"><span>${i + 1}일차</span><b>${nm} ${r[k]}</b></div>`; }).join('')}</div><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button><button class="btn btn-gold" id="m-ok" ${avail ? '' : 'disabled'}>${avail ? '보상 받기' : '내일 다시'}</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-ok').onclick = () => { const r = this.eco.claimDaily(); if (r) { audio.play('jingle_win0', { vol: 0.6 }); this.ui.rewardToast(r.got); } this.ui.closeModal(); }; } });
  }
  showMail() {
    const mails = this.eco.s.mail;
    this.ui.modal(`<h2>우편함</h2>${mails.map((m) => `<div class="mail-item"><div class="mi-body"><div class="mi-t">${m.title}</div><div class="mi-d">${m.body}</div></div><button class="btn btn-gold btn-sm" data-mail="${m.id}" ${m.read ? 'disabled' : ''}>${m.read ? '수령' : '받기'}</button></div>`).join('') || '<p>우편이 없습니다</p>'}<div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelectorAll('[data-mail]').forEach((x) => x.onclick = () => { const got = this.eco.claimMail(+x.dataset.mail); if (got) { audio.pick('coin', 2); this.ui.rewardToast(got); x.disabled = true; x.textContent = '수령'; } }); } });
  }
  showQuests() {
    const qs = this.eco.quests();
    this.ui.modal(`<h2>임무</h2>${qs.map((q) => `<div class="quest-item"><div class="qi-body"><div>${q.name}</div><div class="bar"><div style="width:${Math.min(100, q.cur / q.max * 100)}%"></div></div><div style="font-size:10px;color:var(--muted)">${Math.min(q.cur, q.max)}/${q.max} · ${Object.entries(q.r).map(([k, v]) => `${REWARD_LABEL[k][0]} ${v}`).join(', ')}</div></div><button class="btn btn-gold btn-sm" data-q="${q.id}" ${q.done && !q.claimed ? '' : 'disabled'}>${q.claimed ? '완료' : '받기'}</button></div>`).join('')}<div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => { b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelectorAll('[data-q]').forEach((x) => x.onclick = () => { const got = this.eco.claimQuest(x.dataset.q); if (got) { audio.pick('coin', 2); this.ui.rewardToast(got); x.disabled = true; x.textContent = '완료'; } }); } });
  }
  showSettings() {
    const st = this.eco.s.settings;
    if (st.voice === undefined) st.voice = true;
    const row = (k, label) => `<div class="setting-row"><span>${label}</span><div class="toggle ${st[k] ? 'on' : ''}" data-k="${k}"></div></div>`;
    const mix=this.app.arsenal.s.mix;
    const mixRows=[['sfx','효과음 음량'],['music','배경음악 음량'],['voice','목소리 음량']].map(([key,label])=>`<div class="setting-row"><label for="mix-${key}">${label}</label><div class="setting-mix"><input id="mix-${key}" data-mix="${key}" type="range" min="0" max="100" step="1" value="${Math.round(mix[key]*100)}"><output for="mix-${key}">${Math.round(mix[key]*100)}%</output></div></div>`).join('');
    this.ui.modal(`<h2>설정</h2>${row('sfx', '효과음')}${row('music', '배경음악')}${row('voice', '나레이션')}${row('haptics', '진동')}<div class="setting-row"><span>그래픽</span><div class="seg">${['low', 'mid', 'high'].map((q) => `<button data-q="${q}" class="${st.quality === q ? 'on' : ''}">${{ low: '낮음', mid: '보통', high: '높음' }[q]}</button>`).join('')}</div></div><div class="setting-row"><span>카메라</span><div class="seg">${['auto', 'top', 'action', 'wide'].map((c) => `<button data-cam="${c}" class="${(st.camera || 'auto') === c ? 'on' : ''}">${{ auto: 'AUTO', top: '탑다운', action: '액션', wide: '시네마틱' }[c]}</button>`).join('')}</div></div><div class="setting-row" style="border-bottom:0;padding-top:0"><span id="cam-desc" style="font-size:11px;color:var(--muted)">${CAM_DESC[st.camera || 'auto']}</span></div><div class="setting-row"><span>조작</span><span style="font-size:11px;color:var(--muted)">이동 WASD · 공격 J/Space · 회피 K · 스킬 1~3 · 궁극기 R</span></div>
      <div class="modal-btns"><button class="btn btn-red btn-sm" id="m-reset">데이터 초기화</button><button class="btn btn-ghost" id="m-cancel">닫기</button></div>`, { onOpen: (b) => {
      b.querySelector('#m-cancel').onclick = () => this.ui.closeModal();
      b.querySelector('.modal-btns').insertAdjacentHTML('beforebegin',mixRows+'<p id="mix-notice" role="status"></p>');
      b.querySelectorAll('[data-mix]').forEach(input=>{input.oninput=()=>{input.nextElementSibling.textContent=input.value+'%';audio.setMix({...this.app.arsenal.s.mix,[input.dataset.mix]:Number(input.value)/100});};input.onchange=()=>{const r=this.app.arsenal.setMix({[input.dataset.mix]:Number(input.value)/100});audio.setMix(this.app.arsenal.s.mix);b.querySelector('#mix-notice').textContent=r.ok?'음량이 저장되었습니다.':r.error;input.value=String(Math.round(this.app.arsenal.s.mix[input.dataset.mix]*100));input.nextElementSibling.textContent=input.value+'%';};});
      b.querySelectorAll('.toggle').forEach((t) => t.onclick = () => { const k = t.dataset.k; st[k] = !st[k]; t.classList.toggle('on', st[k]); this.app.applySettings(); this.eco.save(); });
      b.querySelectorAll('[data-cam]').forEach((c) => c.onclick = () => { st.camera = c.dataset.cam; b.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x === c)); b.querySelector('#cam-desc').textContent = CAM_DESC[st.camera]; this.app.applySettings(); this.eco.save(); audio.play('ui_open', { vol: 0.3 }); });
      b.querySelectorAll('[data-q]').forEach((q) => q.onclick = () => { st.quality = q.dataset.q; b.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === q)); this.app.applySettings(); this.eco.save(); });
      b.querySelector('#m-reset').onclick = async () => { if (await this.ui.confirm('초기화', '모든 진행 데이터가 삭제됩니다. 계속할까요?', { okCls: 'btn-red' })) { if (this.app.resetProgress()) location.reload(); else this.ui.toast('저장 공간을 초기화하지 못했습니다. 브라우저의 저장 권한을 확인해 주세요.', 'red'); } };
    } });
  }
  showProfile() {
    const s = this.eco.s; const vipNext = [0, 1, 20000, 50000, 100000, 300000];
    this.ui.modal(`<h2 id="profile-name"></h2><p>VIP ${s.vip} · 누적 결제 ₩${fmt(s.spentKRW)} (목업)<br>${s.vip < 5 ? `다음 VIP까지 ₩${fmt(vipNext[s.vip + 1] - s.spentKRW)}` : '최고 등급'}</p><p>VIP 혜택: 에너지 최대 +50 · 골드 +30% · 소탕권 매일 5장${this.eco.isVip ? ' <b style="color:var(--green)">(활성)</b>' : ' <b style="color:var(--red)">(VIP 멤버십 필요)</b>'}</p><p>총 소환 ${s.totalPulls}회 · 처치 ${s.quests.kills} · 클리어 ${s.quests.stages}</p><div class="modal-btns"><button class="btn btn-ghost" id="m-cancel">닫기</button><button class="btn btn-gold" id="m-vip">VIP 멤버십</button></div>`, { onOpen: (b) => { b.querySelector('#profile-name').textContent = s.name; b.querySelector('#m-cancel').onclick = () => this.ui.closeModal(); b.querySelector('#m-vip').onclick = () => { this.ui.closeModal(); this.buy('vip_pass'); }; } });
  }
  /** 로비 진입 시 받을 수 있는 무료 출석 보상만 안내한다. */
  autoPopups() {
    if (this.app.mode !== 'lobby' || this.app.companionAgent?.getSnapshot().open || document.querySelector('dialog[open]') || document.getElementById('modal').classList.contains('show')) return;
    if (this.eco.dailyAvailable()) { this.showDaily(); return; }
  }
}
