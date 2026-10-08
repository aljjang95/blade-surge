import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { ITEM_BY_ID, ITEM_ICON, RARITY_COLOR } from '../data/items.js';
import { REWARD_LABEL } from '../game/economy.js';
import { Minimap } from './minimap.js';
import { CombatNoticeQueue } from './combat-notices.js';
import { ROOM_TYPE } from '../game/world.js';
import { resultStoryHtml } from './campaign.js';
import { levelExp } from '../data/heroes.js';
import { renderGrowthPreparation, canPrepareGrowth } from './growth.js';
import { comboFeedback } from './combo-feedback.js';
import { BattleReadability } from './battle-readability.js';
import { writeHudStyle } from './hud-style-write.js';
import { combatHudAnimationRegion } from '../engine/combat-feedback.js';
import './campaign.css';
import './combo-feedback.css';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('ko-KR');
export { $, fmt };

export class UI {
  constructor(app) {
    this.app = app; this.eco = app.eco;
    this._astralChoiceHud = false;
    this.el = { hud: $('hud'), meta: $('meta'), result: $('result'), modal: $('modal'), modalBox: $('modal-box'), toast: $('toast-layer'), boot: $('boot'), reveal: $('reveal'), pause: $('pause-overlay') };
    this.combatNoticeHeaderEls = [];
    this.combatNoticeObservedHeaders = new Set();
    this.combatNotices = new CombatNoticeQueue({ show: ({ message, tone }) => {
      const notice = document.createElement('div'); notice.className = 'toast combat-notice ' + tone;
      notice.innerHTML = message; this.el.toast.appendChild(notice);
      this.refreshCombatNoticeLayout();
      return () => { notice.remove(); this.refreshCombatNoticeLayout(); };
    } });
    // The announcement must clear the actual notice height, including wrapped copy and rotation.
    this.combatNoticeResize = new ResizeObserver(() => {
      this.refreshCombatNoticeLayout();
    });
    this.combatNoticeResize.observe(this.el.toast);
    this.combatNoticeResize.observe(this.el.hud);
    const lobby = $('tab-home'), lobbyBottom = lobby.querySelector('.lobby-bottom');
    this.lobbyCaptionResize = new ResizeObserver(() => {
      if (!lobby.offsetHeight || !lobbyBottom.offsetHeight) return;
      const bottom = lobby.getBoundingClientRect().bottom - lobbyBottom.getBoundingClientRect().top + 12;
      lobby.style.setProperty('--lobby-caption-bottom', `${bottom}px`);
    });
    this.lobbyCaptionResize.observe(lobby); this.lobbyCaptionResize.observe(lobbyBottom);
    this.skillBtns = [...document.querySelectorAll('.skill-btn')];
    this.hurtT = 0; this.combatCueEl = $('combat-cue'); this.combatCueTimer = null; this.combatCueOwner = null; this.comboEl = $('combo'); this.comboN = $('combo-n'); this.killStreakEl = $('kill-streak'); this.killStreakN = $('kill-streak-n'); this.killStreakTier = $('kill-streak-tier');
    this.lootLayer = $('loot-layer'); this.lootQueue = [];
    this.minimap = new Minimap($('minimap'));
    this.readability = new BattleReadability(app);
    this.miniT = 0;
    const cameraControls = document.createElement('div');
    cameraControls.id = 'battle-camera-controls';
    cameraControls.setAttribute('aria-label', '전투 시점 조작');
    cameraControls.innerHTML = '<div id="battle-camera-pad" tabindex="0" role="group" aria-label="드래그 또는 방향키로 시점 회전, 더하기 빼기로 확대 축소, Home으로 복원"><span>시점 회전</span><small>드래그 ↔ ↕</small></div><div class="battle-camera-buttons"><button type="button" id="battle-camera-zoom-in" aria-label="시점 확대">+</button><button type="button" id="battle-camera-reset">복원</button><button type="button" id="battle-camera-zoom-out" aria-label="시점 축소">−</button></div>';
    this.el.hud.append(cameraControls);
    // 타격마다 읽지 않고 레이아웃 변경 때 실제 HUD·조작 영역을 저장한다.
    this.combatTextRegionEls = [
      this.el.hud.querySelector('.hud-top'), $('objective'), $('btn-map'), $('bossbar'),
      this.el.hud.querySelector('.actions'), $('joy'), $('map-tactics-context'),
      $('combo'), $('kill-streak'), $('combat-cue'), this.el.toast, cameraControls,
    ].filter(Boolean);
    for (const el of this.combatTextRegionEls) this.combatNoticeResize.observe(el);
    this.combatTextLayerEl = $('dmg-layer');
    this.combatNoticeResize.observe(this.combatTextLayerEl);
    document.body.classList.add('force-landscape');
    $('btn-ignore-rotate').addEventListener('click', () => document.body.classList.remove('force-landscape'));
    this._bindGlobal();
    this.modalStack = [];
    this.resultTimers = []; this.resultData = null; this.adTimer = null; this.adResult = null;
  }
  _bindGlobal() {
    // 모든 버튼 클릭음
    document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.classList.contains('skill-btn') && !b.classList.contains('attack-btn') && !b.classList.contains('dodge-btn')) audio.play('ui_click', { vol: 0.35, min: 0.05 }); }, true);
    $('btn-pause').addEventListener('click', () => this.pause(true));
    $('btn-resume').addEventListener('click', () => this.pause(false));
    $('btn-giveup').addEventListener('click', () => { this.pause(false); this.app.battle.defeat(); });
    $('btn-boss-shortcut').addEventListener('click', () => { const b = this.app.battle; if (b?.shortcutBoss()) { $('btn-boss-shortcut').hidden = true; this.setObjective(b.world); } });
    $('btn-auto').addEventListener('click', (event) => {
      const p = this.app.battle.player; if (!p) return;
      const next = !p.auto, saved = this.app.journey?.setAuto(next);
      if (saved?.ok === false) { this.toast(saved.error, 'red'); return; }
      p.auto = next; this.app._auto = next;
      $('btn-auto').classList.toggle('on', p.auto);
      // 포인터 전환 후 WASD를 복구하되 키보드 UI 조작과 다른 컨트롤의 포커스는 유지한다.
      if (event?.detail > 0 && document.activeElement === event.currentTarget) event.currentTarget.blur();
      this.toast(p.auto ? '자동 전투 ON · 다음 출격에도 적용' : '자동 전투 OFF · 다음 출격에도 적용');
    });
    $('btn-result-lobby').addEventListener('click', () => { if (canPrepareGrowth(this.app, this.resultData)) this.app.toLobby(); });
    $('btn-result-retry').addEventListener('click', () => { if (canPrepareGrowth(this.app, this.resultData)) this.app.startStage(this.app.battle.stage); });
    $('btn-result-auto-retry').addEventListener('click', async () => {
      const stage = this.app.battle.stage;
      if (!canPrepareGrowth(this.app, this.resultData) || this.resultData.win || stage?.code !== '1-1' || stage.difficultyId !== 'story') return;
      const previousAuto = !!this.app.journey?.s.autoBattle;
      const saved = this.app.journey?.setAuto(true);
      if (saved?.ok !== true) { this.toast(saved?.error || 'AUTO 설정을 저장하지 못했습니다.', 'red'); return; }
      const button = $('btn-result-auto-retry'); button.disabled = true;
      if (!this.eco.s.tutorial?.completed) this.app.tutorial.skipOnceForAutoRetry = true;
      let started = false;
      try { started = await this.app.startStage(stage) === true; }
      catch { this.toast('재도전을 시작하지 못했습니다. 다시 시도해 주세요.', 'red'); }
      finally { this.app.tutorial.skipOnceForAutoRetry = false; button.disabled = false; }
      if (started) this.app.funnel?.track('auto_retry_selected');
      else {
        const restored = this.app.journey.setAuto(previousAuto);
        if (restored?.ok !== true) this.toast('출격이 취소됐습니다. AUTO 설정을 확인해 주세요.', 'red');
      }
    });
    $('btn-result-next').addEventListener('click', () => { if (canPrepareGrowth(this.app, this.resultData) && this.resultData.win && !this.app.battle.stage?.finale) this.app.startStage(this.eco.nextStage()); });
    $('btn-result-double').addEventListener('click', () => this.watchAd());
  }
  show(el, on) { el.classList.toggle('show', on); }
  observeCombatNoticeHeaders() {
    // Target and posture leaves are authored by the Battle views after UI construction.
    const leaves = [...this.el.hud.querySelectorAll('.hud-center .wave, .hud-center .stage-name, .rpg-target, .mw-posture')];
    for (const el of this.combatNoticeObservedHeaders) if (!leaves.includes(el)) {
      this.combatNoticeResize.unobserve(el); this.combatNoticeObservedHeaders.delete(el);
    }
    for (const el of leaves) if (!this.combatNoticeObservedHeaders.has(el)) {
      this.combatNoticeResize.observe(el); this.combatNoticeObservedHeaders.add(el);
    }
    this.combatNoticeHeaderEls = [this.el.hud.querySelector('.hud-top'), $('bossbar'), ...leaves].filter(Boolean);
  }
  refreshCombatNoticeLayout() {
    const hud = this.el?.hud, toast = this.el?.toast;
    if (!hud || !toast) return;
    const shown = hud.classList.contains('show');
    if (shown) {
      let bottom = 0;
      // Absolute landscape columns and display:contents portrait columns need their real leaves.
      for (const el of this.combatNoticeHeaderEls || []) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && Number.isFinite(rect.bottom)) bottom = Math.max(bottom, rect.bottom);
      }
      const cue = this.combatCueEl;
      if (cue?.classList.contains('on') && cue.offsetParent === hud) {
        const width = cue.offsetWidth, height = cue.offsetHeight;
        if (width > 0 && height > 0) {
          const box = hud.getBoundingClientRect(), left = box.left + cue.offsetLeft, top = box.top + cue.offsetTop;
          const area = combatHudAnimationRegion('combat-cue', { left, top, right: left + width, bottom: top + height }, document.documentElement.classList.contains('oath-visual'));
          if (area) bottom = Math.max(bottom, area.bottom);
        }
      }
      // The fixed global toast is a HUD sibling, so its layout property must live on the toast itself.
      writeHudStyle(toast.style, '--battle-notice-top', `${Math.ceil(bottom + 6)}px`);
    } else {
      toast.style.removeProperty('--battle-notice-top');
      this.combatNoticeHeaderEls = [];
    }
    const noticeBottom = shown && toast.childElementCount ? toast.getBoundingClientRect().bottom : 0;
    writeHudStyle(hud.style, '--combat-notice-bottom', `${noticeBottom}px`);
    this.refreshCombatTextRegions();
  }
  refreshCombatTextRegions() {
    if (typeof this.app.fx?.setCombatTextRegions !== 'function') return;
    const shown = this.el.hud.classList.contains('show');
    const layer = shown ? this.combatTextLayerEl?.getBoundingClientRect() : null;
    const hud = shown ? this.el.hud.getBoundingClientRect() : null;
    const oathVisual = document.documentElement.classList.contains('oath-visual');
    const regions = shown ? (this.combatTextRegionEls || []).map(el => {
      if (!['combo', 'kill-streak', 'combat-cue'].includes(el.id)) return el.getBoundingClientRect();
      // 이 세 요소는 #hud 직접 자식이다. 숨긴 요소의 0 크기는 예약하지 않는다.
      const width = el.offsetWidth, height = el.offsetHeight;
      if (el.offsetParent !== this.el.hud || !(width > 0 && height > 0)) return null;
      const left = hud.left + el.offsetLeft, top = hud.top + el.offsetTop;
      return combatHudAnimationRegion(el.id, { left, top, right: left + width, bottom: top + height }, oathVisual);
    }).filter(Boolean) : [];
    const previous = this.combatTextRegions || [];
    const oldLayer = this.combatTextLayerBounds;
    const sameLayer = !layer && !oldLayer || layer && oldLayer
      && layer.left === oldLayer.left && layer.right === oldLayer.right
      && layer.top === oldLayer.top && layer.bottom === oldLayer.bottom;
    if (sameLayer && previous.length === regions.length && regions.every((rect, i) =>
      rect.left === previous[i].left && rect.right === previous[i].right
      && rect.top === previous[i].top && rect.bottom === previous[i].bottom)) return;
    this.combatTextRegions = regions.map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
    this.combatTextLayerBounds = layer ? { left: layer.left, top: layer.top, right: layer.right, bottom: layer.bottom } : null;
    this.app.fx?.setCombatTextRegions?.(regions, this.combatTextLayerBounds);
  }
  setupMinimap(floor) { this.minimap.setFloor(floor); $('minimap-wrap').classList.remove('hidden'); }
  setObjective(floor) {
    if (this.app.battle?.world !== floor) return;
    this.readability.renderObjective(this.app.battle);
  }
  showHud(on) { this.combatNotices.clear(); if (on) this.el.toast.replaceChildren(); this.show(this.el.hud, on); if (!on) { if (this.combatCueOwner) this.clearCombatCue(this.combatCueOwner, this.combatCueEl?.textContent); this.readability?.clear(); this.refreshComboFeedback(); this.el.hud.classList.remove('astral-choice-hud'); this._astralChoiceHud = false; this.combatCueEl?.classList.remove('on'); this.lootLayer?.replaceChildren(); document.querySelectorAll('.reward-fly').forEach(el=>el.remove()); $('hud-setgauge')?.classList.add('hidden'); this.comboEl.classList.add('hidden'); this.setKillStreak(0); $('bossbar').classList.add('hidden'); $('ult-cinema').classList.remove('on'); $('minimap-wrap').classList.add('hidden'); } else this.observeCombatNoticeHeaders(); this.refreshCombatNoticeLayout(); }
  pause(on) { const b = this.app.battle; if (!b.player || !b.active) return; b.setPaused('manual', on); this.show(this.el.pause, on); if (!on && this.el.pause.contains(document.activeElement)) document.activeElement?.blur?.(); audio.play(on ? 'ui_open' : 'ui_close', { vol: 0.5 }); }

  // ---------------- 토스트 / 보상 플라이 ----------------
  toast(msg, cls = '', options = {}) { if (this.el.hud.classList.contains('show')) { this.combatNotices.push(msg, cls, options); return; } const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = msg; this.el.toast.appendChild(d); setTimeout(() => d.remove(), 2200); while (this.el.toast.children.length > 4) this.el.toast.firstChild.remove(); }
  flyReward(worldPos, text, camera, kind = 'gold') { if (this.app.battle?.result || this.el.result.classList.contains('show') || document.querySelectorAll('.reward-fly').length > 8) return; const v = new THREE.Vector3().copy(worldPos).setY(1.5).project(camera); if (v.z > 1) return; const d = document.createElement('div'); d.className = 'reward-fly'; d.textContent = text; d.style.color = kind === 'stone' ? '#4cc3ff' : 'var(--gold)'; d.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px'; d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 1000); }
  /** 필드 득템 팝업 */
  lootPopup(def, rarity) {
    if (this.app.battle?.result || this.el.result.classList.contains('show')) return;
    while (this.lootLayer.children.length >= 2) this.lootLayer.firstChild.remove();
    const d = document.createElement('div'); d.className = 'loot-pop'; d.style.setProperty('--rc', RARITY_COLOR[rarity] || '#9aa3b2');
    d.innerHTML = `<span class="lp-rar">${rarity}</span><img src="${ITEM_ICON(def)}" onerror="this.remove()"><span>${def.name}</span>`;
    this.lootLayer.appendChild(d); setTimeout(() => d.remove(), 1250);
  }
  rewardHtml(got) { return got.map((g) => { if (g.k === 'item') { const it = ITEM_BY_ID[g.item.id]; return `<span class="reward-chip rar-${it.rarity}" style="border:1px solid"><img src="${ITEM_ICON(it)}" style="width:18px;height:18px" onerror="this.remove()"> ${it.name}</span>`; } const [nm, ic] = REWARD_LABEL[g.k] || [g.k, '']; return `<span class="reward-chip"><img src="${ic}" style="width:18px;height:18px" onerror="this.remove()"> ${nm} +${fmt(g.n)}</span>`; }).join(''); }
  rewardToast(got, cls = 'gold') { if (got && got.length) this.toast(this.rewardHtml(got), cls); }

  // ---------------- 모달 ----------------
  modal(html, { onOpen } = {}) { this.el.modalBox.innerHTML = html; this.show(this.el.modal, true); audio.play('ui_open', { vol: 0.5 }); onOpen?.(this.el.modalBox); }
  closeModal() { this.show(this.el.modal, false); audio.play('ui_close', { vol: 0.4 }); }
  confirm(title, body, { ok = '확인', cancel = '취소', okCls = 'btn-gold' } = {}) {
    return new Promise((res) => { this.modal(`<h2>${title}</h2><p>${body}</p><div class="modal-btns">${cancel ? `<button class="btn btn-ghost" id="m-cancel">${cancel}</button>` : ''}<button class="btn ${okCls}" id="m-ok">${ok}</button></div>`, { onOpen: (b) => { b.querySelector('#m-ok').onclick = () => { this.closeModal(); res(true); }; const c = b.querySelector('#m-cancel'); if (c) c.onclick = () => { this.closeModal(); res(false); }; } }); });
  }
  /** No store billing provider is connected. Never resolve a simulated purchase success. */
  paySheet(sku) {
    this.modal('<div class="pay-sheet"><h2>유료 구매 준비 중</h2><p>현재 버전은 스토어 결제가 연결되지 않아 유료 상품과 프리미엄 패스를 구매할 수 없습니다.</p><p>기본 플레이와 획득한 재화 사용은 계속 이용할 수 있습니다.</p><div class="modal-btns"><button class="btn btn-gold" id="p-cancel">돌아가기</button></div></div>', {
      onOpen: (box) => { box.querySelector('#p-cancel').onclick = () => this.closeModal(); },
    });
    return Promise.resolve(false);
  }
  /** 구매 완료 축하 팝업 */
  purchaseDone(sku, got, extra = '') {
    audio.play('jingle_legend', { vol: 0.8 }); audio.pick('coin', 2, { vol: 0.7 }); audio.vibe([30, 30, 80]);
    this.modal(`<div class="levelup-pop"><div class="big">구매 완료!</div><p>${sku.name}</p><div class="loot" style="margin:10px 0">${this.rewardHtml(got)}</div>${extra}<div class="modal-btns"><button class="btn btn-gold" id="m-ok">받기</button></div></div>`, { onOpen: (b) => { b.querySelector('#m-ok').onclick = () => this.closeModal(); } });
  }
  hurtVignette() { this.hurtT = 0.5; }
  /** 기존 알림을 소유자와 함께 교체한다. @param {*} owner */
  combatCue(label, tone = 'red', duration = 720, owner = null) {
    const el = this.combatCueEl; if (!el || !label) return;
    this.combatCueOwner = owner;
    clearTimeout(this.combatCueTimer); el.textContent = label; el.dataset.tone = tone; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    this.refreshCombatNoticeLayout();
    this.combatCueTimer = setTimeout(() => { this.combatCueOwner = null; this.combatCueTimer = null; el.classList.remove('on'); this.refreshCombatNoticeLayout(); }, duration);
  }
  /** 같은 문구라도 다른 알림으로 교체됐으면 이전 시전이 지우지 않는다. */
  clearCombatCue(owner, label) {
    const el = this.combatCueEl;
    if (!owner || this.combatCueOwner !== owner || el?.textContent !== label) return false;
    clearTimeout(this.combatCueTimer); this.combatCueTimer = null; this.combatCueOwner = null;
    el.classList.remove('on');
    this.refreshCombatNoticeLayout();
    return true;
  }
  perfectDodge() {
    const f = $('perfect-flash'), l = $('perfect-label');
    f.classList.remove('on'); l.classList.remove('on'); void f.offsetWidth; void l.offsetWidth;
    f.classList.add('on'); l.classList.add('on');
  }

  // ---------------- HUD ----------------
  setupHud(def, player) {
    // Controls keep their children during combat; rebind on each hero/party setup.
    this.cacheComboFeedback(); this.refreshComboFeedback();
    this._skillCooldowns = this.skillBtns.map(btn => btn.querySelector('.cd'));
    this._dodgeBtn = $('btn-dodge'); this._dodgeCd = this._dodgeBtn.querySelector('.dodge-cd');
    $('hud-portrait').src = def.portrait; $('hud-stage').textContent = '';
    this.skillBtns.forEach((b, slot) => {
      const { index, skill: sk } = player.combatSkill(slot);
      if (!sk) { b.style.display = 'none'; return; }
      b.dataset.skillIndex = String(index); b.title = `${sk.name} · ${sk.desc}${sk.ult ? ' · 궁극기 게이지 100' : sk.mp ? ` · MP ${sk.mp}` : ''}`; b.setAttribute('aria-label', b.title);
      const img = b.querySelector('img'); img.src = sk.icon; img.style.display = '';
      img.onerror = () => { img.style.display = 'none'; b.style.background = `linear-gradient(135deg, ${def.color}, #222)`; };
      b.style.display = ''; b.classList.toggle('locked', !player.unlocked(index));
      this._skillCooldowns[slot].style.setProperty('--p', '0%'); b.dataset.ready = '0'; b.classList.remove('ready', 'ready-flash');
      const lk = b.querySelector('.lock b'); if (lk) lk.textContent = sk.unlock || '';
    });
    $('btn-boss-shortcut').hidden = !this.app.battle?.canBossShortcut?.();
    $('btn-auto').classList.toggle('on', !!player.auto);
    this.setCombo(0); $('hud-ult').parentElement.classList.remove('full');
  }
  cacheComboFeedback() {
    if (this._attackComboButton) return;
    const button = $('btn-attack'); if (!button) return;
    this._attackComboButton = button;
    this._attackComboLabel = button.querySelector('span');
    this._attackComboLabel.classList.add('attack-combo-label');
    this._attackComboLabel.setAttribute('aria-hidden', 'true');
    const stage = document.createElement('span'), cue = document.createElement('span');
    stage.className = 'attack-combo-stage'; cue.className = 'attack-combo-cue';
    stage.setAttribute('aria-hidden', 'true'); cue.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('attack-combo-ring'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    for (const name of ['track', 'progress']) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.classList.add(`attack-combo-ring-${name}`);
      for (const [key, value] of Object.entries({ cx: '50', cy: '50', r: '46', pathLength: '100' })) circle.setAttribute(key, value);
      svg.append(circle);
      if (name === 'progress') this._attackComboArc = circle;
    }
    button.classList.add('combo-feedback'); button.setAttribute('aria-keyshortcuts', 'J Space');
    button.append(svg, stage, cue);
    this._attackComboStage = stage; this._attackComboCue = cue;
    this._comboFeedbackKey = null; this._comboFeedbackProgress = null;
  }
  /** Read-only feedback; the existing button and Player retain all input authority. */
  refreshComboFeedback(battle) {
    const button = this._attackComboButton; if (!button) return;
    const view = comboFeedback(battle);
    const key = `${view.status}|${view.stage}|${view.total}|${view.finisher}|${view.nextStage}`;
    if (this._comboFeedbackKey !== key) {
      this._comboFeedbackKey = key;
      button.dataset.comboStatus = view.status; button.dataset.comboStage = String(view.stage); button.dataset.comboTotal = String(view.total);
      button.dataset.comboFinisher = String(view.finisher); button.dataset.comboNextStage = view.nextStage === null ? '' : String(view.nextStage);
      this._attackComboLabel.textContent = view.label;
      this._attackComboStage.hidden = this._attackComboCue.hidden = view.status === 'neutral';
      this._attackComboStage.textContent = view.stage ? `${view.stage}/${view.total}타${view.finisher ? ' · 마무리' : ''}` : '';
      this._attackComboCue.textContent = view.detail.split(' · ').at(-1);
      button.setAttribute('aria-label', `${view.label}${view.detail ? ` · ${view.detail}` : ''} · J 또는 Space`);
    }
    const progress = Math.round(view.progress * 1000) / 10;
    if (this._comboFeedbackProgress !== progress) {
      this._comboFeedbackProgress = progress;
      this._attackComboArc.style.strokeDashoffset = String(100 - progress);
    }
  }
  setWave() {}
  /** 각성 해금 연출 — 레벨 구간을 넘겨 새 스킬이 열렸을 때 */
  awakenBanner(list) {
    if (!list || !list.length) return;
    const sk = list[0];
    this.waveBanner(`각성 — ${sk.name}`);
    this.toast(`Lv.${sk.unlock} 각성! <b style="color:#ff9ad8">${sk.name}</b> 해금`, 'gold');
    audio.play('jingle_win1', { vol: 0.7 });
    if (list.length > 1) setTimeout(() => this.toast(`Lv.${list[1].unlock} 각성! <b style="color:#ff9ad8">${list[1].name}</b> 해금`, 'gold'), 900);
  }
  setFloorLabel(floorNum, floor, stage = this.app.battle?.stage) {
    const clr = floor.rooms.filter((r) => r.cleared).length, tot = floor.rooms.length;
    $('hud-wave').textContent = stage?.code || `${floorNum}층`;
    $('hud-stage').textContent = `구역 ${clr}/${tot}${stage?.difficultyName ? ` · ${stage.difficultyName}` : ''}`;
  }
  waveBanner(text) { const b = $('wave-banner'); b.textContent = text; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
  showBoss(name, on, portrait) { $('bossbar').classList.toggle('hidden', !on); $('boss-name').textContent = name; const im = $('boss-portrait'); if (portrait) { im.src = portrait; im.style.display = ''; } else im.style.display = 'none'; }
  setCombo(n) { if (n <= 1) { this.comboEl.classList.add('hidden'); return; } this.comboEl.classList.remove('hidden'); this.comboN.textContent = n; this.comboEl.classList.toggle('hot', n >= 30); this.comboEl.classList.remove('pop'); void this.comboEl.offsetWidth; this.comboEl.classList.add('pop'); }
  setKillStreak(n, tier = '') {
    if (!this.killStreakEl) return;
    if (n <= 1) { this.killStreakEl.classList.remove('show', 'hot'); return; }
    this.killStreakN.textContent = n;
    this.killStreakTier.textContent = tier || (n >= 20 ? '전장의 지배자' : n >= 10 ? '광란' : '사냥 본능');
    this.killStreakEl.classList.toggle('hot', n >= 20);
    this.killStreakEl.classList.remove('show'); void this.killStreakEl.offsetWidth; this.killStreakEl.classList.add('show');
  }
  ultCinema(name, def) { const c = $('ult-cinema'); $('ult-name').textContent = name; $('ult-name').style.textShadow = `0 0 20px ${def.color}, 0 4px 0 #000`; c.classList.remove('on'); void c.offsetWidth; c.classList.add('on'); setTimeout(() => c.classList.remove('on'), 1700); }
  updateHud(b, dt) {
    this.refreshComboFeedback(b);
    this.readability?.update(b, dt);
    const astralChoice = !!b.active && b.routeObjectives?.def?.id === 'astral_constellations_standard';
    if (this._astralChoiceHud !== astralChoice) {
      this.el.hud.classList.toggle('astral-choice-hud', astralChoice);
      this._astralChoiceHud = astralChoice;
    }
    const p = b.player; if (!p) return;
    this.app.expeditionUI?.updateCombatStatus(b);
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 1 / 20; this.minimap.draw(b); }
    const hp = Math.max(0, p.hp / p.maxHp); writeHudStyle($('hud-hp').style, 'width', hp * 100 + '%');
    const hpValue = Math.floor(p.hp), maxHpValue = Math.floor(p.maxHp);
    if (this._hpValue !== hpValue || this._maxHpValue !== maxHpValue || this._hpText === undefined) {
      this._hpValue = hpValue; this._maxHpValue = maxHpValue; this._hpText = `${fmt(hpValue)} / ${fmt(maxHpValue)}`;
    }
    const hpLabel = $('hud-hp-txt'); if (hpLabel.textContent !== this._hpText) hpLabel.textContent = this._hpText;
    writeHudStyle($('hud-hp').style, 'background', hp < 0.3 ? 'linear-gradient(90deg,#ff2d55,#ff8aa0)' : 'linear-gradient(90deg,#2bd46a,#a6ff5a)');
    const mp = Math.max(0, p.mp / p.maxMp); writeHudStyle($('hud-mp').style, 'width', mp * 100 + '%');
    const mpText = `MP ${Math.floor(p.mp)} / ${p.maxMp}`, mpLabel = $('hud-mp-txt'); if (mpLabel.textContent !== mpText) mpLabel.textContent = mpText;
    const hero = this.eco.hero(b.heroId), need = levelExp(hero.level); writeHudStyle($('hud-exp').style, 'width', Math.min(100, hero.exp / Math.max(1, need) * 100) + '%');
    const expText = `EXP ${hero.exp} / ${need}`, expLabel = $('hud-exp-txt'); if (expLabel.textContent !== expText) expLabel.textContent = expText;
    const dodge = this._dodgeBtn, dodgeCd = this._dodgeCd, dodgeHidden = p.dodgeCd <= .01;
    dodge.classList.toggle('cooling', p.dodgeCd > .01); if (dodgeCd.hidden !== dodgeHidden) dodgeCd.hidden = dodgeHidden;
    if (!dodgeCd.hidden) { const text = p.dodgeCd.toFixed(1); if (dodgeCd.textContent !== text) dodgeCd.textContent = text; }
    const shortcut = $('btn-boss-shortcut'), shortcutHidden = !b.canBossShortcut?.(); if (shortcut.hidden !== shortcutHidden) shortcut.hidden = shortcutHidden;
    const ult = p.ult / p.ultMax; writeHudStyle($('hud-ult').style, 'width', ult * 100 + '%'); $('hud-ult').parentElement.classList.toggle('full', ult >= 1);
    this.skillBtns.forEach((btn, slot) => { const i = p.combatSkillIndex(slot), sk = p.def.skills[i]; if (!sk) return; const locked = !p.unlocked(i); btn.classList.toggle('locked', locked); if (locked) return; let pct; if (sk.ult) { pct = 1 - ult; btn.classList.toggle('ready', ult >= 1); } else { pct = p.cds[i] / sk.cd; btn.classList.toggle('ready', false); } writeHudStyle(this._skillCooldowns[slot].style, '--p', (Math.max(0,pct) * 100) + '%'); const wasReady = btn.dataset.ready === '1'; const ready = pct <= 0 && (!sk.mp || p.mp >= sk.mp); if (ready && !wasReady && b.elapsed > 1) { btn.classList.remove('ready-flash'); void btn.offsetWidth; btn.classList.add('ready-flash'); audio.play('ui_pluck', { vol: 0.25 }); } const readyValue = ready ? '1' : '0'; if (btn.dataset.ready !== readyValue) btn.dataset.ready = readyValue; });
    this.setGauge(b);
    if (b.boss && b.boss.alive) writeHudStyle($('boss-hp').style, 'width', (b.boss.hp / b.boss.maxHp * 100) + '%');
    if (this.hurtT > 0) { this.hurtT -= dt; } writeHudStyle($('hud-vignette').style, 'opacity', Math.max(hp < 0.3 ? 0.42 : 0, this.hurtT > 0 ? this.hurtT * 1.2 : 0));
  }

  /** 테마 세트 게이지 — 켜진 세트가 자원을 쓰면 그 상태를 HUD 에 띄운다 (룬 장전 / 포자 반경 / 얼음 기둥 / 사슬) */
  setGauge(b) {
    const el = $('hud-setgauge'); if (!el) return;
    const g = b.sp && b.sp.gauge();
    if (!g) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('full', !!g.full);
    el.style.color = g.color;
    const lab = $('sg-label'); if (lab.textContent !== g.label) lab.textContent = g.label;
    const pips = $('sg-pips');
    if (pips.childElementCount !== g.max) { pips.innerHTML = ''; for (let i = 0; i < g.max; i++) pips.appendChild(document.createElement('i')); }
    const n = Math.max(0, Math.min(g.max, g.n));
    if (this._sgN !== n || this._sgL !== g.label) { this._sgN = n; this._sgL = g.label; for (let i = 0; i < g.max; i++) pips.children[i].classList.toggle('on', i < n); }
  }

  // ---------------- 부활 또는 전투 후 정비 ----------------
  showRevive(b) {
    const cost = 50 * (b.revived + 1); const gems = this.eco.s.gems;
    this.modal(`<h2 style="color:#ff5a7a">쓰러졌다…</h2><p>보석 <b style="color:var(--gold)">${cost}</b>개로 그 자리에서 부활합니다.<br>부활 시 주변 적 넉백 + 2초 무적</p><p style="font-size:11px">보유 보석 ${fmt(gems)}</p>
      <div class="modal-btns"><button class="btn btn-ghost" id="r-no"><span>${b.stage?.expedition ? '전투 마치기' : '정비하기'}</span><small>부활 없이 전투 종료</small></button><button class="btn btn-gold" id="r-yes"><span>부활</span><small><i class="ic ic-gem"></i> ${cost}</small></button></div>
      ${gems < cost ? '<button class="btn btn-blue" id="r-shop" style="width:100%;margin-top:8px">보석 충전하기</button>' : ''}`, {
      onOpen: (box) => {
        box.querySelector('#r-no').onclick = () => { if (!b.active || b.player.alive) return; this.closeModal(); b.defeat(); };
        box.querySelector('#r-yes').onclick = () => { if (!b.active || b.player.alive) return; if (this.eco.s.gems < cost) { this.toast('보석이 부족합니다', 'red'); audio.play('ui_error'); return; } this.eco.s.gems -= cost; this.eco.emit(); this.closeModal(); b.revivePlayer(); };
        const sh = box.querySelector('#r-shop'); if (sh) sh.onclick = () => { this.closeModal(); b.defeat(); setTimeout(() => this.app.meta.openTab('shop', 'gem'), 300); };
      },
    });
  }

  // ---------------- 결과 ----------------
  refreshResultGrowth(result) {
    if (this.resultData !== result || this.app.battle.result !== result) return;
    const ready = canPrepareGrowth(this.app, result);
    for (const id of ['btn-result-lobby', 'btn-result-retry', 'btn-result-next', 'btn-result-double']) {
      $(id).disabled = !ready || (id === 'btn-result-double' && !!result.bonusClaimed);
    }
    for (const item of $('result-loot').querySelectorAll('button')) item.disabled = !ready;
    renderGrowthPreparation($('result-growth'), this.app, result);
  }
  retryResultSave(result) {
    const b = this.app.battle;
    if (this.resultData !== result || b.result !== result || b.active || this.app.stageStarting
      || !this.el.result.classList.contains('show') || b.stage?.expedition) return false;
    // Rewards are already in memory. Retry persistence only, never completeStage.
    let saved = this.eco.save();
    if (saved && b.rpgDirty) saved = b.flushRpg();
    if (saved && result.win && this.app.expedition && !result.expeditionRecorded) {
      const recorded = this.app.expedition.recordCampaign(result, b.stage);
      result.expeditionRecorded = recorded.ok;
      if (recorded.ok) result.campaignReward = recorded.rewards;
      saved = recorded.ok;
    }
    if (result.reward) { result.reward.ok = !!saved; result.reward.saveError = !saved; }
    result.saveError = !saved;
    this.refreshResultGrowth(result);
    this.toast(saved ? '성장 기록과 보상을 저장했습니다.' : '저장하지 못했습니다. 저장 공간과 권한을 확인한 뒤 다시 시도해 주세요.', saved ? 'gold' : 'red');
    ($('result-growth').querySelector('button') || $('btn-result-lobby'))?.focus();
    return !!saved;
  }
  prepareResultLayout() {
    const box = this.el.result.querySelector('.result-box');
    if (box.querySelector('.result-scroll')) return;
    const scroll = document.createElement('div'); scroll.className = 'result-scroll';
    scroll.tabIndex = 0; scroll.setAttribute('aria-label', '사냥 결과와 성장 준비');
    const buttons = box.querySelector('.result-btns');
    const fold = (id, title) => {
      const details = document.createElement('details'); details.id = id; details.className = 'result-details';
      const summary = document.createElement('summary'); summary.textContent = title;
      details.append(summary); return details;
    };
    for (const child of [...box.children]) {
      if (child === buttons) continue;
      if (child.id === 'result-story') {
        const details = fold('result-story-details', '되찾은 이야기'); details.append(child); scroll.append(details);
      } else if (child.id === 'result-loot') {
        const details = fold('result-loot-details', '획득 보상'); details.append(child); scroll.append(details);
      } else scroll.append(child);
    }
    // Growth stays ahead of optional story and loot, with one independently scrolling body.
    scroll.insertBefore(scroll.querySelector('#result-growth'), scroll.querySelector('#result-stats'));
    box.replaceChildren(scroll, buttons);
  }
  showResult(b, win) {
    if (b.stage?.expedition) { this.app.expeditionUI.showResult(b, win); return; }
    const r = b.result;
    if (!r || b !== this.app.battle || b.active || this.app.stageStarting || r.win !== win
      || (this.resultData === r && this.el.result.classList.contains('show'))) return;
    this.hideResult(); this.resultData = r;
    this.prepareResultLayout();
    const later = (fn, ms) => { this.resultTimers.push(setTimeout(() => { if (this.resultData === r && this.app.battle.result === r) fn(); }, ms)); };
    const eco = this.eco; this.showHud(false); this.show(this.el.pause, false); this.show(this.el.result, true);
    this.el.result.classList.toggle('is-defeat', !win);
    const growth = $('result-growth'); growth.hidden = true; growth.replaceChildren();
    while (this.lootLayer.firstChild) this.lootLayer.firstChild.remove();
    const t = $('result-title'); t.textContent = win ? b.stage.finale ? '새벽의 귀환' : 'VICTORY' : 'DEFEAT'; t.classList.toggle('lose', !win);
    const story = $('result-story'); story.hidden = !win; story.innerHTML = win ? resultStoryHtml(b.stage) : '';
    const storyDetails = $('result-story-details'); storyDetails.hidden = !win; storyDetails.open = !!b.stage.finale;
    const lootDetails = $('result-loot-details'); lootDetails.hidden = !win; lootDetails.open = false;
    this.el.result.querySelector('.result-scroll').scrollTop = 0;
    const stars = [...$('result-stars').children]; stars.forEach((s) => { s.className = ''; });
    $('result-stats').innerHTML = `<span>처치 <b>${b.kills}</b></span><span>최대 콤보 <b>${b.maxCombo}</b></span><span>피해량 <b>${fmt(b.dmgDealt)}</b></span><span>시간 <b>${Math.floor(b.elapsed)}s</b></span><span>득템 <b>${b.drops.loot.length}</b></span>`;
    $('btn-result-retry').textContent = `다시 · 에너지 ${b.stage.energy}`;
    const loot = $('result-loot'); loot.innerHTML = '';
    $('btn-result-next').style.display = win && !b.stage.finale ? '' : 'none'; $('btn-result-double').style.display = win ? '' : 'none';
    const autoRetry = $('btn-result-auto-retry'), showAutoRetry = !win && b.stage.code === '1-1' && b.stage.difficultyId === 'story';
    autoRetry.hidden = !showAutoRetry; autoRetry.style.display = showAutoRetry ? '' : 'none'; autoRetry.disabled = false;
    if (showAutoRetry) autoRetry.querySelector('small').textContent = `에너지 -${b.stage.energy} · 이후 출격에도 AUTO`;
    $('result-exp').style.width = '0%'; $('result-bp').style.width = '0%';
    $('result-exp-txt').textContent = ''; $('result-bp-txt').textContent = '';
    if (win) {
      r.reward ||= eco.completeStage(b.stage, r.stars, { fieldGold: b.drops.gold, fieldStones: b.drops.stones, fieldStones2: b.drops.stones2, fieldStones3: b.drops.stones3, fieldFragments: b.drops.fragments, fieldLoot: b.drops.loot, fullClear: !!r.fullClear });
      r.receiptId ||= globalThis.crypto?.randomUUID?.() || `campaign-${Date.now()}-${Math.random()}`;
      if (r.reward.ok !== false && !r.reward.saveError && this.app.expedition && !r.expeditionRecorded) {
        const recorded = this.app.expedition.recordCampaign(r, b.stage);
        r.expeditionRecorded = recorded.ok;
        if (recorded.ok) r.campaignReward = recorded.rewards;
      }
      this.lastReward = r.reward; const rw = r.reward;
      if (!rw.saveError && rw.ok !== false && !r.funnelRewardRecorded) {
        this.app.funnel?.track('reward_claim', { source: 'stage' }); r.funnelRewardRecorded = true;
        if (rw.ups) this.app.funnel?.track('hero_level_up', { source: 'stage', level: Math.min(200, Math.max(1, this.eco.hero(b.heroId)?.level || 1)) });
      }
      // completeStage and recordCampaign must settle before affordability is calculated.
      this.refreshResultGrowth(r);
      stars.forEach((s, i) => { if (i < r.stars) later(() => { s.className = 'on pop'; audio.play('ui_glass', { vol: 0.6, rate: 1 + i * 0.2 }); audio.vibe(20); }, 400 + i * 300); });
      const items = [...rw.got.map((g) => ({ g })), ...rw.loot.map((it) => ({ it }))];
      lootDetails.querySelector('summary').textContent = `획득 보상 · 장비 ${rw.loot.length}개 · 펼쳐서 비교`;
      if (r.campaignReward?.levelGold) items.push({ g: { k: 'gold', n: r.campaignReward.levelGold, label: '탐험 레벨업' } });
      items.forEach((x, i) => later(() => {
        const d = document.createElement(x.it ? 'button' : 'div');
        if (x.it) {
          d.type = 'button'; d.setAttribute('aria-label', `${ITEM_BY_ID[x.it.id].name} 장비 비교`);
          d.disabled = !canPrepareGrowth(this.app, r);
          d.title = '이 장비 비교하기';
          d.onclick = () => {
            if (!canPrepareGrowth(this.app, r)) return;
            const heroId = eco.s.selected;
            this.app.toLobby(); if (this.app.mode !== 'lobby') return; this.app.meta.heroSel = heroId;
            this.app.meta.bagSlot = ITEM_BY_ID[x.it.id].slot;
            this.app.meta.openTab('heroes'); this.app.meta.showItem(x.it.uid, heroId);
          };
        }
        if (x.it) { const def = ITEM_BY_ID[x.it.id]; d.className = `loot-item rar-${def.rarity}`; d.innerHTML = `<img src="${ITEM_ICON(def)}" onerror="this.remove()"><div class="nm">${def.name}</div>`; if (def.rarity === 'L' || def.rarity === 'U') { audio.play('jingle_legend', { vol: 0.6 }); } else audio.play('ui_drop', { vol: 0.5 }); }
        else { const [nm, ic] = REWARD_LABEL[x.g.k] || [x.g.k, '']; d.className = 'loot-item'; d.innerHTML = `<img src="${ic}" onerror="this.remove()"><span>${fmt(x.g.n)}</span><div class="nm">${x.g.label || nm}</div>`; audio.pick('coin', 2, { vol: 0.5 }); }
        loot.appendChild(d);
      }, 300 + Math.min(i * 60, 600)));
      later(() => {
        if (!canPrepareGrowth(this.app, r)) return;
        const h = eco.hero(b.heroId), need = levelExp(h.level);
        $('result-exp').style.width = Math.min(100, h.exp / Math.max(1, need) * 100) + '%';
        $('result-exp-txt').textContent = `Lv.${h.level} +${rw.exp}`;
        const pl = eco.passLevel; $('result-bp').style.width = (eco.s.pass.xp % 100) + '%';
        $('result-bp-txt').textContent = `Lv.${pl} +${b.stage.rewards.bp}`;
        if (rw.ups) { this.toast(`영웅 레벨업! Lv.${h.level}`, 'gold'); audio.play('jingle_win1', { vol: 0.6 }); }
        if (rw.awakened?.length) later(() => { if (canPrepareGrowth(this.app, r)) this.awakenBanner(rw.awakened); }, 700);
        if (rw.passUps) this.toast(`시즌 패스 Lv.${pl} 달성!`, 'gold');
      }, 1500);
      if (rw.first) later(() => { if (canPrepareGrowth(this.app, r)) this.toast(`첫 클리어 보상! 보석 +${b.stage.rewards.firstGems}`, 'gold'); }, 1800);
      const nx = eco.nextStage(); $('btn-result-next').querySelector('small').innerHTML = `<i class="ic ic-energy"></i> -${nx.energy}`;
    } else {
      this.refreshResultGrowth(r);
      audio.play('ui_error', { vol: 0.6, rate: 0.7 });
      later(() => (growth.querySelector('button') || $('btn-result-lobby')).focus(), 520);
    }
  }
  watchAd() {
    const result = this.resultData;
    if (!result?.win || !result.reward || result.saveError || result.reward.saveError || result.reward.ok === false
      || this.eco.storageStatus === 'unavailable' || this.app.battle.active || this.app.stageStarting
      || this.app.battle.rpgDirty || result.expeditionRecorded === false || result.bonusPending || result.bonusClaimed
      || this.app.battle.result !== result || !this.el.result.classList.contains('show')) return;
    this.modal('<h2>광고 보너스 준비 중</h2><p>현재 버전은 광고 시청을 지원하지 않아 추가 보상을 받을 수 없습니다.</p><p>이번 전투의 기본 보상은 그대로 유지됩니다. 다음 전투를 계속 진행해 주세요.</p><div class="modal-btns"><button class="btn btn-gold" id="ad-cancel">돌아가기</button></div>', {
      onOpen: (box) => { box.querySelector('#ad-cancel').onclick = () => this.closeModal(); },
    });
    return false;
  }
  cancelAd() { if (this.adTimer) clearInterval(this.adTimer); this.adTimer = null; if (this.adResult) this.adResult.bonusPending = false; this.adResult = null; $('btn-result-double').disabled = !!this.resultData?.bonusClaimed; }
  hideResult() { if (this.adResult) { this.cancelAd(); this.closeModal(); } for (const timer of this.resultTimers) clearTimeout(timer); this.resultTimers.length = 0; this.resultData = null; this.show(this.el.result, false); }
}
