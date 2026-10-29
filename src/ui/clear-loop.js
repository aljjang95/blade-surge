// 클리어 결과 화면: 보상 카드 3장 중 1장 고르기 · 즉석 정비소(판매·분해·강화) · 무기 수리.
// 정산·보상은 항상 eco 메서드(pickClearCard · sellItem · salvage · enhance · repairItem)만 부른다. 이 파일은 화면과 연출만 맡는다.
// 연출은 transform/opacity 만 움직인다. prefers-reduced-motion 이면 뒤집기·폭발을 생략한다.
import { audio } from '../engine/audio.js';
import { ITEM_BY_ID, STONE_NAME, RARITY_COLOR } from '../data/items.js';
import { REWARD_LABEL } from '../game/economy.js';
import { itemIconHtml } from './item-presentation.js';
import { tierName, tierTag } from '../game/item-tier-label.js';
import { clearFresh, markFresh } from './loot-compare.js';
import { canPrepareGrowth } from './growth.js';
import {
  FLIP_STEP, fmt, cardView, cardGearCompare, pickToast, summaryChips, autoCardText, durabilityView, wearDeltaOf,
  shopRows, bulkSellPlan, enhanceSheetView, ownerTag,
} from './clear-loop-view.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const TIER_RATE = { common: 0.95, rare: 1.05, epic: 1.15, legend: 1 };

export class ClearLoop {
  constructor(ui) { this.ui = ui; this.timers = []; this.state = null; }
  get eco() { return this.ui.eco; }

  // ---------- 수명 ----------
  after(fn, ms) { const s = this.state; this.timers.push(setTimeout(() => { if (this.state === s && s) fn(); }, ms)); }
  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0; this.state = null;
    const root = $('result'); root?.classList.remove('has-clear');
    for (const id of ['result-cards', 'result-chips', 'result-shop']) { const el = $(id); if (el) { el.hidden = true; el.replaceChildren(); } }
    $('result-cards')?.classList.remove('picked', 'burst');   // 지난 판 선택 상태가 남으면 새 카드가 눌리지 않는다(교차 리뷰 P1)
  }
  /** 결과 화면이 아직 이 판의 것인가. */
  live() { const s = this.state; return !!s && this.ui.resultData === s.result; }
  ready() { return this.live() && canPrepareGrowth(this.ui.app, this.state.result); }

  /**
   * 캠페인 승리 결과에 카드·정비소를 올린다. 카드가 없는 정산이면 false(기존 화면 그대로).
   * @returns {boolean}
   */
  mount(result, battle) {
    this.reset();
    const rw = result.reward;
    if (!rw || rw.ok === false || rw.rejected || !rw.clearCard) return false;
    // 서버 권위 계정은 서버 정산이 아직 카드를 만들지 않는다(settlement.js SERVER_CLEAR_CARDS, #404). 고를 수 없는 카드를 보여 주지 않는다.
    if (this.ui.app?.account?.authority === 'server') return false;
    const cc = this.eco.s.clearCard?.id === rw.clearCard.id ? this.eco.s.clearCard : rw.clearCard;
    this.state = { result, rw, cc, heroId: rw.heroId || battle.heroId, uids: (rw.loot || []).map((it) => it.uid), picking: false, flipped: false, revealed: false };
    $('result').classList.add('has-clear');
    this.renderCards();
    this.renderChips();
    this.renderShop();
    return true;
  }
  /** 저장 상태가 바뀌어 누를 수 있는지 달라졌을 때 ui.refreshResultGrowth 가 부른다. */
  refresh(result) {
    if (this.state) { this.renderShop(); return; }
    // 첫 정산 저장이 실패했다가 다시 저장에 성공하면(retryResultSave) 그때 카드·정비소를 올린다(리뷰 P2).
    const app = this.ui.app;
    if (result?.win && result.reward?.ok !== false && result.reward?.clearCard && this.ui.resultData === result && app?.battle?.result === result
      && this.mount(result, app.battle)) { const details = $('result-loot-details'); if (details) details.hidden = true; }
  }

  // ---------- 카드 ----------
  renderCards() {
    const s = this.state, root = $('result-cards'), cc = s.cc;
    const done = cc.picked !== null && cc.picked !== undefined;
    root.hidden = false;
    const cards = cc.cards.map((card, i) => {
      const v = cardView(card, { heroId: '' });
      const icon = v.gearId ? itemIconHtml(ITEM_BY_ID[v.gearId], '', { heroId: s.heroId })
        : v.kind === 'repair' ? '<span class="cl-hammer" aria-hidden="true"><i></i><b></b></span>'
          : `<img src="${esc(v.iconSrc)}" alt="" onerror="this.remove()">`;
      const extra = v.gearId ? (cardGearCompare(this.eco, s.heroId, card) || '') : '';
      const tag = card.kind === 'gear' ? ownerTag(cc.heroId, s.heroId) : '';
      const label = `${v.tierName} 카드 · ${v.name} ${v.value}`;
      return `<button type="button" class="cl-card cl-${esc(v.tier)}" data-i="${i}" style="--d:${(0.5 + i * FLIP_STEP).toFixed(2)}s" aria-label="${esc(label)} — 눌러서 고르기">`
        + '<span class="cl-inner">'
        + '<span class="cl-face cl-back" aria-hidden="true"><i class="cl-back-mark"></i><i class="cl-back-ring"></i></span>'
        + `<span class="cl-face cl-front"><span class="cl-tier">${esc(v.tierName)}</span><span class="cl-ico">${icon}</span>`
        + `<span class="cl-name">${esc(v.name)}</span><span class="cl-val">${esc(v.value)}</span>`
        + (tag ? `<span class="cl-extra cl-owner">${esc(tag)}</span>` : extra ? `<span class="cl-extra">${esc(extra)}</span>` : '')
        + '<i class="cl-shine" aria-hidden="true"></i></span></span><i class="cl-burst" aria-hidden="true"></i></button>';
    }).join('');
    root.innerHTML = `<div class="cl-row" role="group" aria-label="보상 카드 3장 중 1장 고르기">${cards}</div>`
      + `<p class="cl-note" id="cl-note">${done ? '' : '카드 한 장을 골라 보세요 · 고르지 않으면 다음 승리 때 첫 장으로 자동 정산돼요'}</p>`;
    const buttons = [...root.querySelectorAll('.cl-card')];
    buttons.forEach((b) => { b.onclick = () => this.onCard(Number(b.dataset.i)); });
    if (done) { this.markPicked(cc.picked, false); s.revealed = true; return; }
    if (reducedMotion()) { buttons.forEach((b) => b.classList.add('flipped')); s.revealed = true; this.after(() => this.revealSounds(true), 0); return; }
    buttons.forEach((b, i) => this.after(() => { b.classList.add('flipped'); this.flipSound(cc.cards[i].tier); }, 500 + i * FLIP_STEP * 1000));
    this.after(() => { s.revealed = true; }, 500 + 3 * FLIP_STEP * 1000 + 250);
  }
  flipSound(tier) {
    if (tier === 'legend') audio.play('jingle_legend', { vol: 0.6 });
    else audio.play('ui_glass', { vol: 0.5, rate: TIER_RATE[tier] || 1 });
  }
  revealSounds() { const best = this.state.cc.cards.some((c) => c.tier === 'legend') ? 'legend' : 'rare'; this.flipSound(best); }
  /** 연출 중에 누르면 남은 뒤집기를 모두 건너뛰고 앞면을 보여 준다. */
  revealNow() {
    const s = this.state; s.revealed = true;
    for (const t of this.timers) clearTimeout(t); this.timers.length = 0;
    for (const b of $('result-cards').querySelectorAll('.cl-card')) b.classList.add('flipped');
  }
  onCard(i) {
    const s = this.state; if (!this.live() || s.picking) return;
    if (s.cc.picked !== null && s.cc.picked !== undefined) return;
    if (!this.ready()) { this.ui.toast('저장을 마친 뒤 고를 수 있어요.', 'red'); return; }
    if (!s.revealed) { this.revealNow(); return; }
    s.picking = true;
    let r;
    try { r = this.eco.pickClearCard(i); } catch (error) { console.error(error); r = { ok: false }; }
    if (!r || (!r.ok && !r.card)) {
      s.picking = false;
      this.ui.toast('카드를 받지 못했어요. 다시 눌러 주세요.', 'red'); audio.play('ui_error', { vol: 0.5 });
      return;
    }
    s.pick = r;
    for (const g of r.got || []) if (g?.k === 'item' && g.item) { s.uids.push(g.item.uid); markFresh([g.item.uid]); }
    this.markPicked(i, true);
    this.ui.toast(r.saveError ? '카드를 받았지만 저장하지 못했어요. 저장 공간을 확인해 주세요.' : pickToast(r.card), r.saveError ? 'red' : 'gold');
    audio.pick('coin', 2, { vol: 0.6 });
    if (r.card.kind === 'gear') audio.play(r.card.tier === 'legend' || r.card.rarity === 'U' ? 'jingle_legend' : 'ui_drop', { vol: 0.55 });
    audio.vibe?.(25);
    this.renderChips();
    this.afterChange();
  }
  markPicked(i, animate) {
    const root = $('result-cards'), buttons = [...root.querySelectorAll('.cl-card')];
    root.classList.add('picked'); if (animate && !reducedMotion()) root.classList.add('burst');
    buttons.forEach((b, k) => { b.classList.add('flipped'); b.classList.toggle('chosen', k === i); b.classList.toggle('dim', k !== i); b.tabIndex = k === i ? 0 : -1; b.setAttribute('aria-pressed', String(k === i)); });
    const note = $('cl-note'); if (note) note.textContent = '';
  }

  // ---------- 요약 칩 ----------
  renderChips() {
    const s = this.state, root = $('result-chips'), rw = s.rw;
    const chips = summaryChips(rw).map((t) => `<span class="cl-chip">${esc(t)}</span>`);
    const picked = s.cc.picked !== null && s.cc.picked !== undefined ? s.cc.cards[s.cc.picked] : null;
    if (picked) { const v = cardView(picked); chips.push(`<span class="cl-chip cl-chip-card cl-${esc(v.tier)}">카드 · ${esc(v.name)}</span>`); }
    const auto = autoCardText(rw.autoCard);
    if (auto) chips.push(`<span class="cl-chip cl-chip-auto">${esc(auto)}</span>`);
    root.innerHTML = chips.join('');
    root.hidden = !chips.length;
  }

  // ---------- 정비소 ----------
  weaponInfo() {
    const s = this.state, h = this.eco.hero(s.heroId), uid = h?.equip?.weapon;
    const inst = uid != null ? this.eco.s.inventory.find((x) => x.uid === uid) : null;
    return inst ? { inst, def: ITEM_BY_ID[inst.id] } : null;
  }
  /** 카드·정비소 변경 뒤: 저장이 실패했으면 결과 화면의 저장 재시도·이동 버튼까지 다시 그린다(refreshResultGrowth → refresh → renderShop). */
  afterChange() {
    if (this.live()) this.ui.refreshResultGrowth(this.state.result); else this.renderShop();
  }
  renderShop() {
    const s = this.state, root = $('result-shop'), eco = this.eco;
    if (!s) return;
    const rows = shopRows(eco, s.uids, { heroId: s.heroId });
    s.rows = rows;
    const w = this.weaponInfo(), dv = w ? durabilityView(w.inst, w.def, { gold: eco.s.gold, quote: eco.repairQuote(w.inst.uid), wearDelta: wearDeltaOf(s.rw.wear) }) : null;
    const bulk = bulkSellPlan(rows), ok = this.ready();
    const repair = dv
      ? `<div class="cl-repair" data-tone="${dv.tone}"><span class="cl-wico">${itemIconHtml(w.def, '', { heroId: s.heroId })}<i class="cl-sheen" aria-hidden="true"></i></span>`
        + `<div class="cl-dur"><div class="cl-dur-text"><b>${esc(dv.text)}</b>${dv.wearText ? `<em>${esc(dv.wearText)}</em>` : ''}</div>`
        + `<div class="cl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${dv.max}" aria-valuenow="${dv.dur}" aria-label="무기 내구도"><i style="width:${dv.pct}%"></i></div></div>`
        + `<button type="button" class="btn btn-gold cl-btn" data-act="repair"${dv.disabled || !ok ? ' disabled' : ''}>${esc(dv.buttonText)}</button>`
        + (dv.lack ? `<small class="cl-lack">${fmt(dv.lack)}골드 부족</small>` : '') + '</div>'
      : '<div class="cl-repair cl-repair-none"><b>착용한 무기가 없어요</b></div>';
    const list = rows.length
      ? rows.map((r) => this.rowHtml(r, ok)).join('')
      : '<li class="cl-empty">정비할 장비가 없어요</li>';
    root.hidden = false;
    root.innerHTML = '<header class="cl-shop-head"><h3>정비소</h3><span>방금 얻은 장비를 바로 팔거나 키울 수 있어요</span>'
      + `<button type="button" class="btn btn-ghost cl-btn" data-act="bulk"${bulk.count && ok ? '' : ' disabled'}>${bulk.count ? `노말·스페셜 ${bulk.count}개 모두 판매 +${fmt(bulk.gold)}` : '노말·스페셜 모두 판매'}</button></header>`
      + repair + `<ul class="cl-rows">${list}</ul>`;
    root.onclick = (e) => {
      const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
      const act = b.dataset.act, uid = Number(b.closest('[data-uid]')?.dataset.uid);
      if (act === 'repair') this.repair();
      else if (act === 'bulk') this.bulkSell();
      else if (act === 'sell') this.sell(uid);
      else if (act === 'salvage') this.salvage(uid);
      else if (act === 'enhance') this.enhance(uid);
      else if (act === 'detail') this.detail(uid);
      else if (act === 'transfer') this.transfer(uid);
    };
  }
  rowHtml(r, ok) {
    const def = ITEM_BY_ID[r.id], inst = { id: r.id, enh: r.enh };
    const color = RARITY_COLOR[r.rarity] || '#fff';
    const cmp = r.ownerTag || r.compare;
    const cmpCls = r.ownerTag ? 'cl-owner' : r.verdict ? `v-${r.verdict}` : '';
    const dis = (cond) => (cond || !ok ? ' disabled' : '');
    const live = this.eco.s.inventory.find((x) => x.uid === r.uid) || inst;
    return `<li class="cl-row-item rar-${esc(r.rarity)}" data-uid="${r.uid}">`
      + `<span class="cl-gico">${itemIconHtml(def, '', { heroId: r.owner })}</span>`
      + `<div class="cl-info"><b class="cl-gname" style="color:${color}">${esc(tierName(def.name, live))}${tierTag(live) ? ` <em>${esc(tierTag(live))}</em>` : ''}${r.enh ? ` +${r.enh}` : ''}</b>`
      + `<span class="cl-meta">${esc(r.rarityName)} · ${esc(r.slotName)}${r.equipped ? ' · 착용 중' : ''}</span>`
      + (cmp ? `<span class="cl-cmp ${cmpCls}">${esc(cmp)}</span>` : '') + '</div>'
      + '<div class="cl-acts">'
      + `<button type="button" class="btn btn-ghost cl-btn" data-act="detail" title="영웅 장비 화면에서 자세히 보기">상세</button>`
      // 강화 전승(성장·경제 레인 #398 소유, 진입점 meta.openTransfer 만 호출). 그 기능이 없는 빌드에서는 버튼을 숨긴다.
      + (typeof this.ui.app?.meta?.openTransfer === 'function' ? `<button type="button" class="btn btn-ghost cl-btn" data-act="transfer"${dis(false)} title="낡은 장비의 강화 단계를 이 장비로 옮기기">전승</button>` : '')
      + `<button type="button" class="btn btn-ghost cl-btn" data-act="sell"${dis(r.sellDisabled)} title="판매">판매 +${fmt(r.sell)}</button>`
      + `<button type="button" class="btn btn-ghost cl-btn" data-act="salvage"${dis(!r.canSalvage)} title="${esc(r.salvageText)}">${r.canSalvage ? '분해' : r.equipped ? '착용 중' : '분해 불가'}</button>`
      + `<button type="button" class="btn btn-blue cl-btn${r.enhanceLack ? ' lack' : ''}" data-act="enhance"${dis(!r.canEnhance)}>${esc(r.enhanceText)}</button>`
      + '</div></li>';
  }
  /** 행 하나를 지운다(판매·분해·파괴). */
  dropRow(uid) {
    const s = this.state; s.uids = s.uids.filter((u) => u !== uid);
    const li = $('result-shop').querySelector(`[data-uid="${uid}"]`);
    if (li && !reducedMotion()) { li.classList.add('gone'); this.after(() => this.afterChange(), 220); } else this.afterChange();
  }

  async sell(uid) {
    const s = this.state, row = s.rows.find((r) => r.uid === uid); if (!row || !this.ready()) return;
    const def = ITEM_BY_ID[row.id];
    if (row.sellConfirm && !(await this.ui.confirm('판매', `${esc(def.name)}${row.enh ? ` +${row.enh}` : ''}을(를) 판매할까요? <b>골드 +${fmt(row.sell)}</b>`))) return;
    if (!this.live()) return;
    const g = this.eco.sellItem(uid);
    if (g === undefined || g === null) { this.ui.toast('판매하지 못했어요.', 'red'); audio.play('ui_error', { vol: 0.5 }); return; }
    this.ui.toast(`골드 +${fmt(g)}`, 'gold'); audio.pick('coin', 2, { vol: 0.6 });
    this.dropRow(uid);
  }
  salvage(uid) {
    if (!this.ready()) return;
    const r = this.eco.salvage([uid]);
    if (!r?.ok) { this.ui.toast(r?.reason === 'equipped' ? '착용 중인 장비는 분해할 수 없어요.' : '분해하지 못했어요.', 'red'); audio.play('ui_error', { vol: 0.5 }); return; }
    const text = (r.got || []).filter((g) => g.k !== 'item').map((g) => `${(REWARD_LABEL[g.k] || [g.k])[0]} +${fmt(g.n)}`).join(' · ');
    this.ui.toast(`분해 완료 · ${text}`, 'gold'); audio.pick('coin', 2, { vol: 0.5 });
    this.dropRow(uid);
  }
  async bulkSell() {
    const plan = bulkSellPlan(this.state.rows); if (!plan.count || !this.ready()) return;
    if (!(await this.ui.confirm('노말·스페셜 모두 판매', `이번에 얻은 노말·스페셜 장비 <b>${plan.count}개</b>를 판매할까요? <b>골드 +${fmt(plan.gold)}</b><br>착용 중이거나 강화한 장비, 에픽 이상은 그대로 남겨요.`))) return;
    if (!this.live()) return;
    let gold = 0, n = 0;
    for (const uid of plan.uids) { const g = this.eco.sellItem(uid); if (typeof g === 'number') { gold += g; n++; } }
    this.state.uids = this.state.uids.filter((u) => !plan.uids.includes(u));
    this.ui.toast(`장비 ${n}개 판매 · 골드 +${fmt(gold)}`, 'gold'); audio.pick('coin', 2, { vol: 0.7 });
    this.afterChange();
  }
  detail(uid) {
    const s = this.state, app = this.ui.app, eco = this.eco; if (!this.ready()) return;
    const row = s.rows.find((r) => r.uid === uid), def = row && ITEM_BY_ID[row.id]; if (!def) return;
    clearFresh(uid);
    const heroId = eco.s.heroes[row.owner] ? row.owner : eco.s.selected;
    app.toLobby(); if (app.mode !== 'lobby') return;
    app.meta.heroSel = heroId; app.meta.bagSlot = def.slot; app.meta.openTab('heroes'); app.meta.showItem(uid, heroId);
  }

  /** 강화 전승 시트로(로직은 성장·경제 레인의 meta.openTransfer). */
  transfer(uid) {
    const s = this.state, app = this.ui.app, eco = this.eco; if (!this.ready() || typeof app.meta?.openTransfer !== 'function') return;
    const row = s.rows.find((r) => r.uid === uid); if (!row) return;
    clearFresh(uid);
    const heroId = eco.s.heroes[row.owner] ? row.owner : eco.s.selected;
    app.toLobby(); if (app.mode !== 'lobby') return;
    app.meta.heroSel = heroId; app.meta.openTab('heroes'); app.meta.openTransfer(uid, heroId);
  }

  // ---------- 수리 ----------
  repair() {
    if (!this.ready()) return;
    const w = this.weaponInfo(); if (!w) return;
    const r = this.eco.repairItem(w.inst.uid);
    if (!r?.ok && !r?.saveError) {
      if (r?.reason === 'gold') this.ui.toast(`골드가 ${fmt(Math.max(0, (r.cost || 0) - this.eco.s.gold))} 부족해요.`, 'red');
      else this.ui.toast(r?.reason === 'full' ? '이미 새 무기처럼 단단해요.' : '수리하지 못했어요.', 'red');
      audio.play('ui_error', { vol: 0.5 }); return;
    }
    this.ui.toast(r.saveError ? '수리했지만 저장하지 못했어요.' : `무기 정비 완료 · 골드 −${fmt(r.cost)}`, r.saveError ? 'red' : 'gold');
    audio.pick('hit_metal', 3, { vol: 0.6, rate: 0.9 }); audio.play('ui_glass', { vol: 0.5, rate: 1.2, delay: 0.12 }); audio.vibe?.(20);
    this.afterChange();
    const ico = $('result-shop').querySelector('.cl-wico');
    if (ico && !reducedMotion()) { ico.classList.remove('sheen'); void ico.offsetWidth; ico.classList.add('sheen'); }
  }

  // ---------- 강화 ----------
  enhance(uid) {
    if (!this.ready()) return;
    const v = enhanceSheetView(this.eco, uid), inst = this.eco.s.inventory.find((x) => x.uid === uid); if (!v || !inst) return;
    const def = ITEM_BY_ID[inst.id], opts = { sure: false, bless: false, protect: false };
    const eco = this.eco, ui = this.ui;
    const stoneName = STONE_NAME[v.stoneKey === 'stones3' ? 3 : v.stoneKey === 'stones2' ? 2 : 1] || '강화석';
    const sureOpt = v.sureGold !== null && v.sureGold !== undefined;
    const html = `<div class="cl-enh"><h2>${esc(tierName(def.name, inst))} +${v.lv} → +${v.lv + 1}</h2>`
      + `<p class="cl-enh-rate">성공 <b id="cl-e-rate">${v.chance}%</b> · 비용 <b id="cl-e-gold">${fmt(v.gold)}</b> 골드 · ${esc(stoneName)} ${v.stones}개 <small>(보유 ${fmt(v.have)})</small></p>`
      + '<div class="cl-enh-opts">'
      + (sureOpt ? `<button type="button" class="cl-opt" data-opt="sure" aria-pressed="false">확정 강화 <small>+${fmt(v.sureGold)}골드 · 100%</small></button>` : '')
      + `<button type="button" class="cl-opt" data-opt="bless" aria-pressed="false">축복 <small>${fmt(eco.s.bless || 0)}장 · +20%</small></button>`
      + `<button type="button" class="cl-opt" data-opt="protect" aria-pressed="false">보호 <small>${fmt(eco.s.protect || 0)}장 · 파괴 방지</small></button></div>`
      + '<div class="modal-btns"><button class="btn btn-ghost" id="cl-e-cancel">취소</button><button class="btn btn-gold" id="cl-e-go">강화하기</button></div></div>';
    ui.modal(html, { onOpen: (b) => {
      const recalc = () => {
        const chance = opts.sure ? 100 : Math.round(Math.min(1, v.chance / 100 + (opts.bless ? 0.2 : 0)) * 100);
        const gold = v.gold + (opts.sure ? v.sureGold : 0);
        b.querySelector('#cl-e-rate').textContent = chance + '%'; b.querySelector('#cl-e-gold').textContent = fmt(gold);
        b.querySelector('#cl-e-gold').classList.toggle('lack', eco.s.gold < gold);
      };
      b.querySelectorAll('.cl-opt').forEach((el) => { el.onclick = () => {
        const key = el.dataset.opt;
        if (key !== 'sure' && (eco.s[key] || 0) <= 0) { ui.toast(`${key === 'bless' ? '축복' : '보호'} 주문서가 없어요`, 'red'); audio.play('ui_error', { vol: 0.5 }); return; }
        opts[key] = !opts[key];
        if (key === 'sure' && opts.sure) { opts.bless = false; opts.protect = false; }
        if (key !== 'sure' && opts[key]) opts.sure = false;
        b.querySelectorAll('.cl-opt').forEach((o) => { o.setAttribute('aria-pressed', String(!!opts[o.dataset.opt])); o.classList.toggle('on', !!opts[o.dataset.opt]); });
        audio.play('ui_click', { vol: 0.4 }); recalc();
      }; });
      b.querySelector('#cl-e-cancel').onclick = () => ui.closeModal();
      b.querySelector('#cl-e-go').onclick = () => {
        if (!this.live()) { ui.closeModal(); return; }
        const r = eco.enhance(uid, opts);
        if (!r.ok) {
          const msg = r.reason === 'gold' ? '골드가 부족해요.' : r.reason === 'stones' ? `${STONE_NAME[r.tier || 1] || '강화석'}이 부족해요.` : '강화할 수 없어요.';
          ui.toast(msg, 'red'); audio.play('ui_error', { vol: 0.5 }); return;
        }
        ui.closeModal();
        if (r.destroyed) { ui.toast('장비가 파괴되었습니다…', 'red'); audio.play('ui_error', { vol: 0.6, rate: 0.7 }); this.dropRow(uid); return; }
        if (r.success) { ui.toast(`강화 성공! +${r.enh}`, 'gold'); audio.play('jingle_win1', { vol: 0.5 }); audio.vibe?.(30); }
        else ui.toast(r.down ? `강화 실패… +${r.enh}로 하락` : '강화 실패…', 'red');
        this.afterChange();
        const li = $('result-shop').querySelector(`[data-uid="${uid}"]`); if (li && r.success && !reducedMotion()) li.classList.add('flash');
      };
      b.querySelector('#cl-e-go').focus({ preventScroll: true });
    } });
  }
}

/** 무기 상세(영웅·장비 화면의 아이템 시트)에 붙는 내구도 줄. 무기가 아니면 ''. */
export function durabilityLineHtml(eco, inst, def) {
  if (!inst || def?.slot !== 'weapon') return '';
  const q = eco.repairQuote(inst.uid), v = durabilityView(inst, def, { gold: eco.s.gold, quote: q });
  if (!v) return '';
  return `<div class="is-dur cl-dur-line" data-tone="${v.tone}"><span class="cl-dur-label">${esc(v.text)}</span>`
    + `<span class="cl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${v.max}" aria-valuenow="${v.dur}" aria-label="무기 내구도"><i style="width:${v.pct}%"></i></span>`
    + (v.full ? '' : `<button type="button" class="btn btn-ghost btn-sm" id="i-repair"${v.disabled ? ' disabled' : ''}>${esc(v.buttonText)}${v.lack ? ` (${fmt(v.lack)} 부족)` : ''}</button>`)
    + '</div>';
}
