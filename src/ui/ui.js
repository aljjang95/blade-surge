import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { ITEM_BY_ID, ITEM_ICON, RARITY_COLOR } from '../data/items.js';
import { REWARD_LABEL } from '../game/economy.js';
import { Minimap } from './minimap.js';
import { ROOM_TYPE } from '../game/world.js';
import { resultStoryHtml } from './campaign.js';
import './campaign.css';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('ko-KR');
export { $, fmt };

export class UI {
  constructor(app) {
    this.app = app; this.eco = app.eco;
    this.el = { hud: $('hud'), meta: $('meta'), result: $('result'), modal: $('modal'), modalBox: $('modal-box'), toast: $('toast-layer'), boot: $('boot'), reveal: $('reveal'), pause: $('pause-overlay') };
    this.skillBtns = [...document.querySelectorAll('.skill-btn')];
    this.hurtT = 0; this.comboEl = $('combo'); this.comboN = $('combo-n');
    this.lootLayer = $('loot-layer'); this.lootQueue = [];
    this.minimap = new Minimap($('minimap'));
    this.miniT = 0;
    const cameraControls = document.createElement('div');
    cameraControls.id = 'battle-camera-controls';
    cameraControls.setAttribute('aria-label', '전투 시점 조작');
    cameraControls.innerHTML = '<div id="battle-camera-pad" tabindex="0" role="group" aria-label="드래그 또는 방향키로 시점 회전, 더하기 빼기로 확대 축소, Home으로 복원"><span>시점 회전</span><small>드래그 ↔ ↕</small></div><div class="battle-camera-buttons"><button type="button" id="battle-camera-zoom-in" aria-label="시점 확대">+</button><button type="button" id="battle-camera-reset">복원</button><button type="button" id="battle-camera-zoom-out" aria-label="시점 축소">−</button></div>';
    this.el.hud.append(cameraControls);
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
    $('btn-auto').addEventListener('click', () => { const p = this.app.battle.player; if (!p) return; const next = !p.auto; const saved = this.app.journey?.setAuto(next); if (saved?.ok === false) { this.toast(saved.error, 'red'); return; } p.auto = next; this.app._auto = next; $('btn-auto').classList.toggle('on', p.auto); this.toast(p.auto ? '자동 전투 ON · 다음 출격에도 적용' : '자동 전투 OFF · 다음 출격에도 적용'); });
    $('btn-result-lobby').addEventListener('click', () => this.app.toLobby());
    $('btn-result-retry').addEventListener('click', () => this.app.startStage(this.app.battle.stage));
    $('btn-result-next').addEventListener('click', () => { if (this.resultData?.win && !this.app.battle.stage?.finale) this.app.startStage(this.eco.nextStage()); });
    $('btn-result-double').addEventListener('click', () => this.watchAd());
  }
  show(el, on) { el.classList.toggle('show', on); }
  setupMinimap(floor) { this.minimap.setFloor(floor); $('minimap-wrap').classList.remove('hidden'); }
  setObjective(floor) {
    const left = floor.rooms.filter((r) => !r.cleared && r.type !== ROOM_TYPE.START).length;
    const boss = floor.bossRoom;
    const el = $('objective');
    if (boss && boss.cleared) el.innerHTML = '<b style="color:var(--green)">층 클리어!</b>';
    else if (floor.sealed) el.innerHTML = `☠ 보스 봉인 해제까지 남은 구역 <b>${left - 1}</b>`;   // HUD 우측 폭이 좁다 — 긴 문장은 스킬 버튼에 가려진다
    else if (boss && boss.discovered) el.innerHTML = '☠ <b>보스방 발견</b> — 처치하면 층 클리어';
    else el.innerHTML = `☠ 보스를 찾아라 · 남은 구역 <b>${left}</b>`;
  }
  showHud(on) { this.show(this.el.hud, on); if (!on) { $('hud-setgauge')?.classList.add('hidden'); this.comboEl.classList.add('hidden'); $('bossbar').classList.add('hidden'); $('ult-cinema').classList.remove('on'); $('minimap-wrap').classList.add('hidden'); } }
  pause(on) { const b = this.app.battle; if (!b.player || !b.active) return; b.setPaused('manual', on); this.show(this.el.pause, on); audio.play(on ? 'ui_open' : 'ui_close', { vol: 0.5 }); }

  // ---------------- 토스트 / 보상 플라이 ----------------
  toast(msg, cls = '') { const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = msg; this.el.toast.appendChild(d); setTimeout(() => d.remove(), 2200); while (this.el.toast.children.length > 4) this.el.toast.firstChild.remove(); }
  flyReward(worldPos, text, camera, kind = 'gold') { if (this.el.result.classList.contains('show') || document.querySelectorAll('.reward-fly').length > 8) return; const v = new THREE.Vector3().copy(worldPos).setY(1.5).project(camera); if (v.z > 1) return; const d = document.createElement('div'); d.className = 'reward-fly'; d.textContent = text; d.style.color = kind === 'stone' ? '#4cc3ff' : 'var(--gold)'; d.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px'; d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 1000); }
  /** 필드 득템 팝업 */
  lootPopup(def, rarity) {
    if (this.el.result.classList.contains('show')) return;
    if (this.lootLayer.children.length > 4) this.lootLayer.firstChild.remove();
    const d = document.createElement('div'); d.className = 'loot-pop'; d.style.setProperty('--rc', RARITY_COLOR[rarity] || '#9aa3b2');
    d.innerHTML = `<span class="lp-rar">${rarity}</span><img src="${ITEM_ICON(def)}" onerror="this.remove()"><span>${def.name}</span>`;
    this.lootLayer.appendChild(d); setTimeout(() => d.remove(), 1800);
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
  perfectDodge() {
    const f = $('perfect-flash'), l = $('perfect-label');
    f.classList.remove('on'); l.classList.remove('on'); void f.offsetWidth; void l.offsetWidth;
    f.classList.add('on'); l.classList.add('on');
  }

  // ---------------- HUD ----------------
  setupHud(def, player) {
    $('hud-portrait').src = def.portrait; $('hud-stage').textContent = '';
    this.skillBtns.forEach((b, i) => {
      const sk = def.skills[i];
      if (!sk) { b.style.display = 'none'; return; }
      b.title = sk.name; b.setAttribute('aria-label', sk.name);
      const img = b.querySelector('img'); img.src = sk.icon; img.style.display = '';
      img.onerror = () => { img.style.display = 'none'; b.style.background = `linear-gradient(135deg, ${def.color}, #222)`; };
      b.style.display = '';
      // 각성 슬롯: 잠겨 있으면 흑백 + 해금 레벨 배지 (해금 동기 = 과금 동기)
      const locked = !player.unlocked(i);
      b.classList.toggle('locked', locked);
      // 버튼 DOM 은 전투마다 재사용된다 — 이전 영웅의 쿨타임 채움과 ready 플래그를 지우지 않으면 그대로 남는다
      b.querySelector('.cd').style.setProperty('--p', '0%'); b.dataset.ready = '0'; b.classList.remove('ready', 'ready-flash');
      const lk = b.querySelector('.lock b'); if (lk && sk.unlock) lk.textContent = sk.unlock;
    });
    $('btn-auto').classList.toggle('on', !!player.auto);
    this.setCombo(0); $('hud-ult').parentElement.classList.remove('full');
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
    $('hud-stage').textContent = `구역 ${clr}/${tot}`;
  }
  waveBanner(text) { const b = $('wave-banner'); b.textContent = text; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
  showBoss(name, on, portrait) { $('bossbar').classList.toggle('hidden', !on); $('boss-name').textContent = name; const im = $('boss-portrait'); if (portrait) { im.src = portrait; im.style.display = ''; } else im.style.display = 'none'; }
  setCombo(n) { if (n <= 1) { this.comboEl.classList.add('hidden'); return; } this.comboEl.classList.remove('hidden'); this.comboN.textContent = n; this.comboEl.classList.toggle('hot', n >= 30); this.comboEl.classList.remove('pop'); void this.comboEl.offsetWidth; this.comboEl.classList.add('pop'); }
  ultCinema(name, def) { const c = $('ult-cinema'); $('ult-name').textContent = name; $('ult-name').style.textShadow = `0 0 20px ${def.color}, 0 4px 0 #000`; c.classList.remove('on'); void c.offsetWidth; c.classList.add('on'); setTimeout(() => c.classList.remove('on'), 1700); }
  updateHud(b, dt) {
    const p = b.player; if (!p) return;
    this.app.expeditionUI?.updateCombatStatus(b);
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 1 / 20; this.minimap.draw(b); }
    const hp = Math.max(0, p.hp / p.maxHp); $('hud-hp').style.width = hp * 100 + '%';
    const hpValue = Math.floor(p.hp), maxHpValue = Math.floor(p.maxHp);
    if (this._hpValue !== hpValue || this._maxHpValue !== maxHpValue) {
      this._hpValue = hpValue; this._maxHpValue = maxHpValue;
      $('hud-hp-txt').textContent = `${fmt(hpValue)} / ${fmt(maxHpValue)}`;
    }
    $('hud-hp').style.background = hp < 0.3 ? 'linear-gradient(90deg,#ff2d55,#ff8aa0)' : 'linear-gradient(90deg,#2bd46a,#a6ff5a)';
    const ult = p.ult / p.ultMax; $('hud-ult').style.width = ult * 100 + '%'; $('hud-ult').parentElement.classList.toggle('full', ult >= 1);
    this.skillBtns.forEach((btn, i) => { const sk = p.def.skills[i]; if (!sk || btn.classList.contains('locked')) return; let pct; if (sk.ult) { pct = 1 - ult; btn.classList.toggle('ready', ult >= 1); } else pct = p.cds[i] / sk.cd; btn.querySelector('.cd').style.setProperty('--p', (pct * 100) + '%'); const wasReady = btn.dataset.ready === '1'; const ready = pct <= 0; if (ready && !wasReady && b.elapsed > 1) { btn.classList.remove('ready-flash'); void btn.offsetWidth; btn.classList.add('ready-flash'); audio.play('ui_pluck', { vol: 0.25 }); } btn.dataset.ready = ready ? '1' : '0'; });
    this.setGauge(b);
    if (b.boss && b.boss.alive) $('boss-hp').style.width = (b.boss.hp / b.boss.maxHp * 100) + '%';
    if (this.hurtT > 0) { this.hurtT -= dt; } $('hud-vignette').style.opacity = Math.max(hp < 0.3 ? 0.42 : 0, this.hurtT > 0 ? this.hurtT * 1.2 : 0);
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

  // ---------------- 부활 (과금 유도) ----------------
  showRevive(b) {
    const cost = 50 * (b.revived + 1); const gems = this.eco.s.gems;
    this.modal(`<h2 style="color:#ff5a7a">쓰러졌다…</h2><p>보석 <b style="color:var(--gold)">${cost}</b>개로 그 자리에서 부활합니다.<br>부활 시 주변 적 넉백 + 2초 무적</p><p style="font-size:11px">보유 보석 ${fmt(gems)}</p>
      <div class="modal-btns"><button class="btn btn-ghost" id="r-no">포기</button><button class="btn btn-gold" id="r-yes"><span>부활</span><small><i class="ic ic-gem"></i> ${cost}</small></button></div>
      ${gems < cost ? '<button class="btn btn-blue" id="r-shop" style="width:100%;margin-top:8px">보석 충전하기</button>' : ''}`, {
      onOpen: (box) => {
        box.querySelector('#r-no').onclick = () => { this.closeModal(); b.defeat(); };
        box.querySelector('#r-yes').onclick = () => { if (!b.active || b.player.alive) return; if (this.eco.s.gems < cost) { this.toast('보석이 부족합니다', 'red'); audio.play('ui_error'); return; } this.eco.s.gems -= cost; this.eco.emit(); this.closeModal(); b.revivePlayer(); };
        const sh = box.querySelector('#r-shop'); if (sh) sh.onclick = () => { this.closeModal(); b.defeat(); setTimeout(() => this.app.meta.openTab('shop', 'gem'), 300); };
      },
    });
  }

  // ---------------- 결과 ----------------
  showResult(b, win) {
    if (b.stage?.expedition) { this.app.expeditionUI.showResult(b, win); return; }
    const r = b.result;
    if (!r || r.win !== win || (this.resultData === r && this.el.result.classList.contains('show'))) return;
    this.hideResult(); this.resultData = r;
    const later = (fn, ms) => { this.resultTimers.push(setTimeout(() => { if (this.resultData === r && this.app.battle.result === r) fn(); }, ms)); };
    const eco = this.eco; this.showHud(false); this.show(this.el.pause, false); this.show(this.el.result, true);
    while (this.lootLayer.firstChild) this.lootLayer.firstChild.remove();
    const t = $('result-title'); t.textContent = win ? b.stage.finale ? '새벽의 귀환' : 'VICTORY' : 'DEFEAT'; t.classList.toggle('lose', !win);
    const story = $('result-story'); story.hidden = !win; story.innerHTML = win ? resultStoryHtml(b.stage) : '';
    const stars = [...$('result-stars').children]; stars.forEach((s) => { s.className = ''; });
    $('result-stats').innerHTML = `<span>처치 <b>${b.kills}</b></span><span>최대 콤보 <b>${b.maxCombo}</b></span><span>피해량 <b>${fmt(b.dmgDealt)}</b></span><span>시간 <b>${Math.floor(b.elapsed)}s</b></span><span>득템 <b>${b.drops.loot.length}</b></span>`;
    const loot = $('result-loot'); loot.innerHTML = '';
    $('btn-result-next').style.display = win && !b.stage.finale ? '' : 'none'; $('btn-result-double').style.display = win ? '' : 'none';
    $('result-exp').style.width = '0%'; $('result-bp').style.width = '0%';
    if (win) {
      r.reward ||= eco.completeStage(b.stage, r.stars, { fieldGold: b.drops.gold, fieldStones: b.drops.stones, fieldStones2: b.drops.stones2, fieldStones3: b.drops.stones3, fieldFragments: b.drops.fragments, fieldLoot: b.drops.loot });
      if (this.app.expedition && !r.expeditionRecorded) {
        r.receiptId ||= globalThis.crypto?.randomUUID?.() || `campaign-${Date.now()}-${Math.random()}`;
        const recorded = this.app.expedition.recordCampaign(r, b.stage);
        r.expeditionRecorded = recorded.ok;
      }
      this.lastReward = r.reward; const rw = r.reward;
      stars.forEach((s, i) => { if (i < r.stars) later(() => { s.className = 'on pop'; audio.play('ui_glass', { vol: 0.6, rate: 1 + i * 0.2 }); audio.vibe(20); }, 400 + i * 300); });
      const items = [...rw.got.map((g) => ({ g })), ...rw.loot.map((it) => ({ it }))];
      items.forEach((x, i) => later(() => {
        const d = document.createElement(x.it ? 'button' : 'div');
        if (x.it) {
          d.type = 'button'; d.setAttribute('aria-label', `${ITEM_BY_ID[x.it.id].name} 장비 비교`);
          d.title = '이 장비 비교하기';
          d.onclick = () => {
            if (this.resultData !== r || this.app.battle.result !== r) return;
            const heroId = eco.s.selected;
            this.app.toLobby(); this.app.meta.heroSel = heroId;
            this.app.meta.bagSlot = ITEM_BY_ID[x.it.id].slot;
            this.app.meta.openTab('heroes'); this.app.meta.showItem(x.it.uid, heroId);
          };
        }
        if (x.it) { const def = ITEM_BY_ID[x.it.id]; d.className = `loot-item rar-${def.rarity}`; d.innerHTML = `<img src="${ITEM_ICON(def)}" onerror="this.remove()"><div class="nm">${def.name}</div>`; if (def.rarity === 'L' || def.rarity === 'U') { audio.play('jingle_legend', { vol: 0.6 }); } else audio.play('ui_drop', { vol: 0.5 }); }
        else { const [nm, ic] = REWARD_LABEL[x.g.k] || [x.g.k, '']; d.className = 'loot-item'; d.innerHTML = `<img src="${ic}" onerror="this.remove()"><span>${fmt(x.g.n)}</span><div class="nm">${nm}</div>`; audio.pick('coin', 2, { vol: 0.5 }); }
        loot.appendChild(d);
      }, 1200 + i * 220));
      later(() => { const h = eco.hero(); const need = Math.max(1, (h.level ? require_(h.level) : 100)); $('result-exp').style.width = Math.min(100, h.exp / need * 100) + '%'; $('result-exp-txt').textContent = `Lv.${h.level} +${rw.exp}`; const pl = eco.passLevel; $('result-bp').style.width = ((eco.s.pass.xp % 100)) + '%'; $('result-bp-txt').textContent = `Lv.${pl} +${b.stage.rewards.bp}`; if (rw.ups) { this.toast(`영웅 레벨업! Lv.${h.level}`, 'gold'); audio.play('jingle_win1', { vol: 0.6 }); } if (rw.awakened && rw.awakened.length) later(() => this.awakenBanner(rw.awakened), 700); if (rw.passUps) this.toast(`시즌 패스 Lv.${pl} 달성!`, 'gold'); }, 1500);
      if (rw.first) later(() => this.toast(`첫 클리어 보상! 보석 +${b.stage.rewards.firstGems}`, 'gold'), 1800);
      const nx = eco.nextStage(); $('btn-result-next').querySelector('small').innerHTML = `<i class="ic ic-energy"></i> -${nx.energy}`;
      $('btn-result-double').disabled = !!r.bonusClaimed;
    } else {
      audio.play('ui_error', { vol: 0.6, rate: 0.7 });
    }
    function require_(lv) { return Math.floor(100 * Math.pow(1.18, lv - 1)); }
  }
  watchAd() {
    const result = this.resultData;
    if (!result?.win || !result.reward || result.bonusPending || result.bonusClaimed || this.app.battle.result !== result || !this.el.result.classList.contains('show')) return;
    this.modal('<h2>광고 보너스 준비 중</h2><p>현재 버전은 광고 시청을 지원하지 않아 추가 보상을 받을 수 없습니다.</p><p>이번 전투의 기본 보상은 그대로 유지됩니다. 다음 전투를 계속 진행해 주세요.</p><div class="modal-btns"><button class="btn btn-gold" id="ad-cancel">돌아가기</button></div>', {
      onOpen: (box) => { box.querySelector('#ad-cancel').onclick = () => this.closeModal(); },
    });
    return false;
  }
  cancelAd() { if (this.adTimer) clearInterval(this.adTimer); this.adTimer = null; if (this.adResult) this.adResult.bonusPending = false; this.adResult = null; $('btn-result-double').disabled = !!this.resultData?.bonusClaimed; }
  hideResult() { if (this.adResult) { this.cancelAd(); this.closeModal(); } for (const timer of this.resultTimers) clearTimeout(timer); this.resultTimers.length = 0; this.resultData = null; this.show(this.el.result, false); }
}
