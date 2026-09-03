import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { ITEM_BY_ID, ITEM_ICON, RARITY_COLOR } from '../data/items.js';
import { REWARD_LABEL } from '../game/economy.js';
import { Minimap } from './minimap.js';
import { ROOM_TYPE } from '../game/world.js';

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
    document.body.classList.add('force-landscape');
    $('btn-ignore-rotate').addEventListener('click', () => document.body.classList.remove('force-landscape'));
    this._bindGlobal();
    this.modalStack = [];
  }
  _bindGlobal() {
    // 모든 버튼 클릭음
    document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.classList.contains('skill-btn') && !b.classList.contains('attack-btn') && !b.classList.contains('dodge-btn')) audio.play('ui_click', { vol: 0.35, min: 0.05 }); }, true);
    $('btn-pause').addEventListener('click', () => this.pause(true));
    $('btn-resume').addEventListener('click', () => this.pause(false));
    $('btn-giveup').addEventListener('click', () => { this.pause(false); this.app.battle.defeat(); });
    $('btn-auto').addEventListener('click', () => { const p = this.app.battle.player; if (!p) return; p.auto = !p.auto; $('btn-auto').classList.toggle('on', p.auto); this.toast(p.auto ? '자동 전투 ON' : '자동 전투 OFF'); });
    $('btn-result-lobby').addEventListener('click', () => this.app.toLobby());
    $('btn-result-retry').addEventListener('click', () => this.app.startStage(this.app.battle.stage));
    $('btn-result-next').addEventListener('click', () => this.app.startStage(this.eco.nextStage()));
    $('btn-result-double').addEventListener('click', () => this.watchAd());
  }
  show(el, on) { el.classList.toggle('show', on); }
  setupMinimap(floor) { this.minimap.setFloor(floor); $('minimap-wrap').classList.remove('hidden'); }
  setObjective(floor) {
    const left = floor.rooms.filter((r) => !r.cleared && r.type !== ROOM_TYPE.START).length;
    const boss = floor.bossRoom;
    const el = $('objective');
    if (boss && boss.cleared) el.innerHTML = '<b style="color:var(--green)">층 클리어!</b>';
    else if (boss && boss.discovered) el.innerHTML = '☠ <b>보스방 발견</b> — 처치하면 층 클리어';
    else el.innerHTML = `☠ 보스를 찾아라 · 남은 구역 <b>${left}</b>`;
  }
  showHud(on) { this.show(this.el.hud, on); if (!on) { this.comboEl.classList.add('hidden'); $('bossbar').classList.add('hidden'); $('ult-cinema').classList.remove('on'); $('minimap-wrap').classList.add('hidden'); } }
  pause(on) { const b = this.app.battle; if (!b.player) return; b.paused = on; this.show(this.el.pause, on); audio.play(on ? 'ui_open' : 'ui_close', { vol: 0.5 }); }

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
  /** 목업 결제 시트 */
  paySheet(sku) {
    return new Promise((res) => {
      this.modal(`<div class="pay-sheet"><div class="pay-store"><i></i> Google Play · 결제 확인 (목업)</div>
        <div class="pay-item"><img src="${sku.icon}" onerror="this.remove()"><div><div style="font-weight:900">${sku.name}</div><div style="font-size:11px;color:var(--muted)">${sku.desc || (sku.gems ? `보석 ${fmt(sku.gems)}` + (sku.bonus ? ` (+${fmt(sku.bonus)} 보너스)` : '') : '')}</div></div></div>
        <div class="pay-price">${sku.priceLabel}</div>
        <div class="pay-fine">BLADE SURGE 목업 결제 — 실제 청구되지 않습니다. 실제 서비스 시 결제 SDK(Google Play Billing / App Store / PG)를 이 지점에 연결합니다.</div>
        <div class="modal-btns"><button class="btn btn-ghost" id="p-cancel">취소</button><button class="btn btn-gold" id="p-ok">결제하기</button></div></div>`, {
        onOpen: (b) => {
          b.querySelector('#p-cancel').onclick = () => { this.closeModal(); res(false); };
          b.querySelector('#p-ok').onclick = () => { b.innerHTML = '<div class="pay-processing">결제 처리 중…</div>'; audio.play('ui_confirm', { vol: 0.6 }); setTimeout(() => { this.closeModal(); res(true); }, 900); };
        },
      });
    });
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
    this.skillBtns.forEach((b, i) => { const sk = def.skills[i]; const img = b.querySelector('img'); img.src = sk.icon; img.onerror = () => { img.style.display = 'none'; b.style.background = `linear-gradient(135deg, ${def.color}, #222)`; }; b.style.display = ''; });
    $('btn-auto').classList.toggle('on', !!player.auto);
    this.setCombo(0); $('hud-ult').parentElement.classList.remove('full');
  }
  setWave() {}
  setFloorLabel(floorNum, floor) {
    const clr = floor.rooms.filter((r) => r.cleared).length, tot = floor.rooms.length;
    $('hud-wave').textContent = `${floorNum}층`;
    $('hud-stage').textContent = `구역 ${clr}/${tot}`;
  }
  waveBanner(text) { const b = $('wave-banner'); b.textContent = text; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
  showBoss(name, on, portrait) { $('bossbar').classList.toggle('hidden', !on); $('boss-name').textContent = name; const im = $('boss-portrait'); if (portrait) { im.src = portrait; im.style.display = ''; } else im.style.display = 'none'; }
  setCombo(n) { if (n <= 1) { this.comboEl.classList.add('hidden'); return; } this.comboEl.classList.remove('hidden'); this.comboN.textContent = n; this.comboEl.classList.toggle('hot', n >= 30); this.comboEl.classList.remove('pop'); void this.comboEl.offsetWidth; this.comboEl.classList.add('pop'); }
  ultCinema(name, def) { const c = $('ult-cinema'); $('ult-name').textContent = name; $('ult-name').style.textShadow = `0 0 20px ${def.color}, 0 4px 0 #000`; c.classList.remove('on'); void c.offsetWidth; c.classList.add('on'); setTimeout(() => c.classList.remove('on'), 1700); }
  updateHud(b, dt) {
    const p = b.player; if (!p) return;
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 1 / 20; this.minimap.draw(b); }
    const hp = Math.max(0, p.hp / p.maxHp); $('hud-hp').style.width = hp * 100 + '%'; $('hud-hp-txt').textContent = `${fmt(p.hp)} / ${fmt(p.maxHp)}`;
    $('hud-hp').style.background = hp < 0.3 ? 'linear-gradient(90deg,#ff2d55,#ff8aa0)' : 'linear-gradient(90deg,#2bd46a,#a6ff5a)';
    const ult = p.ult / p.ultMax; $('hud-ult').style.width = ult * 100 + '%'; $('hud-ult').parentElement.classList.toggle('full', ult >= 1);
    this.skillBtns.forEach((btn, i) => { const sk = p.def.skills[i]; let pct; if (sk.ult) { pct = 1 - ult; btn.classList.toggle('ready', ult >= 1); } else pct = p.cds[i] / sk.cd; btn.querySelector('.cd').style.setProperty('--p', (pct * 100) + '%'); const wasReady = btn.dataset.ready === '1'; const ready = pct <= 0; if (ready && !wasReady && b.elapsed > 1) { btn.classList.remove('ready-flash'); void btn.offsetWidth; btn.classList.add('ready-flash'); audio.play('ui_pluck', { vol: 0.25 }); } btn.dataset.ready = ready ? '1' : '0'; });
    if (b.boss && b.boss.alive) $('boss-hp').style.width = (b.boss.hp / b.boss.maxHp * 100) + '%';
    if (this.hurtT > 0) { this.hurtT -= dt; } $('hud-vignette').style.opacity = Math.max(hp < 0.3 ? 0.5 + Math.sin(performance.now() / 150) * 0.2 : 0, this.hurtT > 0 ? this.hurtT * 1.6 : 0);
  }

  // ---------------- 부활 (과금 유도) ----------------
  showRevive(b) {
    const cost = 50 * (b.revived + 1); const gems = this.eco.s.gems;
    this.modal(`<h2 style="color:#ff5a7a">쓰러졌다…</h2><p>보석 <b style="color:var(--gold)">${cost}</b>개로 그 자리에서 부활합니다.<br>부활 시 주변 적 넉백 + 2초 무적</p><p style="font-size:11px">보유 보석 ${fmt(gems)}</p>
      <div class="modal-btns"><button class="btn btn-ghost" id="r-no">포기</button><button class="btn btn-gold" id="r-yes"><span>부활</span><small><i class="ic ic-gem"></i> ${cost}</small></button></div>
      ${gems < cost ? '<button class="btn btn-blue" id="r-shop" style="width:100%;margin-top:8px">보석 충전하기</button>' : ''}`, {
      onOpen: (box) => {
        box.querySelector('#r-no').onclick = () => { this.closeModal(); b.defeat(); };
        box.querySelector('#r-yes').onclick = () => { if (gems < cost) { this.toast('보석이 부족합니다', 'red'); audio.play('ui_error'); return; } this.eco.s.gems -= cost; this.eco.emit(); this.closeModal(); b.revivePlayer(); };
        const sh = box.querySelector('#r-shop'); if (sh) sh.onclick = () => { this.closeModal(); b.defeat(); setTimeout(() => this.app.meta.openTab('shop', 'gem'), 300); };
      },
    });
  }

  // ---------------- 결과 ----------------
  showResult(b, win) {
    const r = b.result; const eco = this.eco; this.showHud(false); this.show(this.el.result, true);
    while (this.lootLayer.firstChild) this.lootLayer.firstChild.remove();
    const t = $('result-title'); t.textContent = win ? 'VICTORY' : 'DEFEAT'; t.classList.toggle('lose', !win);
    const stars = [...$('result-stars').children]; stars.forEach((s) => { s.className = ''; });
    $('result-stats').innerHTML = `<span>처치 <b>${b.kills}</b></span><span>최대 콤보 <b>${b.maxCombo}</b></span><span>피해량 <b>${fmt(b.dmgDealt)}</b></span><span>시간 <b>${Math.floor(b.elapsed)}s</b></span><span>득템 <b>${b.drops.loot.length}</b></span>`;
    const loot = $('result-loot'); loot.innerHTML = '';
    $('btn-result-next').style.display = win ? '' : 'none'; $('btn-result-double').style.display = win ? '' : 'none';
    $('result-exp').style.width = '0%'; $('result-bp').style.width = '0%';
    if (win) {
      this.lastReward = eco.completeStage(b.stage, r.stars, { fieldGold: b.drops.gold, fieldStones: b.drops.stones, fieldStones2: b.drops.stones2, fieldStones3: b.drops.stones3, fieldFragments: b.drops.fragments, fieldLoot: b.drops.loot }); const rw = this.lastReward;
      stars.forEach((s, i) => { if (i < r.stars) setTimeout(() => { s.className = 'on pop'; audio.play('ui_glass', { vol: 0.6, rate: 1 + i * 0.2 }); audio.vibe(20); }, 400 + i * 300); });
      const items = [...rw.got.map((g) => ({ g })), ...rw.loot.map((it) => ({ it }))];
      items.forEach((x, i) => setTimeout(() => {
        const d = document.createElement('div');
        if (x.it) { const def = ITEM_BY_ID[x.it.id]; d.className = `loot-item rar-${def.rarity}`; d.innerHTML = `<img src="${ITEM_ICON(def)}" onerror="this.remove()"><div class="nm">${def.name}</div>`; if (def.rarity === 'L' || def.rarity === 'U') { audio.play('jingle_legend', { vol: 0.6 }); } else audio.play('ui_drop', { vol: 0.5 }); }
        else { const [nm, ic] = REWARD_LABEL[x.g.k] || [x.g.k, '']; d.className = 'loot-item'; d.innerHTML = `<img src="${ic}" onerror="this.remove()"><span>${fmt(x.g.n)}</span><div class="nm">${nm}</div>`; audio.pick('coin', 2, { vol: 0.5 }); }
        loot.appendChild(d);
      }, 1200 + i * 220));
      setTimeout(() => { const h = eco.hero(); const need = Math.max(1, (h.level ? require_(h.level) : 100)); $('result-exp').style.width = Math.min(100, h.exp / need * 100) + '%'; $('result-exp-txt').textContent = `Lv.${h.level} +${rw.exp}`; const pl = eco.passLevel; $('result-bp').style.width = ((eco.s.pass.xp % 100)) + '%'; $('result-bp-txt').textContent = `Lv.${pl} +${b.stage.rewards.bp}`; if (rw.ups) { this.toast(`영웅 레벨업! Lv.${h.level}`, 'gold'); audio.play('jingle_win1', { vol: 0.6 }); } if (rw.passUps) this.toast(`시즌 패스 Lv.${pl} 달성!`, 'gold'); }, 1500);
      if (rw.first) setTimeout(() => this.toast(`첫 클리어 보상! 보석 +${b.stage.rewards.firstGems}`, 'gold'), 1800);
      const nx = eco.nextStage(); $('btn-result-next').querySelector('small').innerHTML = `<i class="ic ic-energy"></i> -${nx.energy}`;
      $('btn-result-double').disabled = false;
    } else {
      audio.play('ui_error', { vol: 0.6, rate: 0.7 });
    }
    function require_(lv) { return Math.floor(100 * Math.pow(1.18, lv - 1)); }
  }
  watchAd() {
    // 광고 시청 목업: 3초 대기 후 보상 2배
    const btn = $('btn-result-double'); btn.disabled = true;
    this.modal(`<h2>광고 시청 중</h2><p>리워드 광고 SDK(AdMob 등) 연결 지점 — 목업 3초</p><div class="pay-processing" id="ad-cnt">3</div>`);
    let n = 3; const iv = setInterval(() => { n--; const c = $('ad-cnt'); if (c) c.textContent = n; if (n <= 0) { clearInterval(iv); this.closeModal(); const st = this.app.battle.stage; const got = this.eco.addRewards({ gold: st.rewards.gold, gems: 10 }); this.rewardToast(got); audio.play('jingle_win1', { vol: 0.7 }); } }, 1000);
  }
  hideResult() { this.show(this.el.result, false); }
}
