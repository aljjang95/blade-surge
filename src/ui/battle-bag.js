// 전투 중 가방 시트(대표님 2026-10-29): 일시정지 없이 이번 판에 얻은 장비와 출전 영웅 가방을 훑어본다.
// 보기 전용이다(장착·판매·강화는 결과 화면 정비소). 시트가 열려 있을 때만 DOM 을 갱신하고, 프레임 루프에서는 아무것도 만들지 않는다.
import './battle-bag.css';
import { bagModel, bagCounts } from './battle-bag-model.js';
import { itemIconHtml } from './item-presentation.js';
import { tierName } from '../game/item-tier-label.js';

const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const REFRESH_MS = 140;
const MIN_WIDTH = 140;
const TOP_BLOCKERS = '#objective, #bossbar, #battle-tutorial > :not([hidden]), #map-tactics-context';

export class BattleBag {
  /** @param {{ app: any, eco: any, el: { hud: HTMLElement } }} ui */
  constructor(ui) {
    this.ui = ui; this.eco = ui.eco; this.hud = ui.el.hud;
    this.tab = 'run'; this.isOpen = false; this.visible = false; this.timer = null; this.invSeqAtStart = undefined; this.heroId = null;
    const btn = this.btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'btn-bag'; btn.className = 'hud-btn bag-btn'; btn.hidden = true;
    btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="bag-btn-label">가방</span><b class="bag-badge" hidden></b><i class="bag-foreign" hidden aria-hidden="true">◆</i>';
    this.badge = btn.querySelector('.bag-badge'); this.foreign = btn.querySelector('.bag-foreign');
    const sheet = this.sheet = document.createElement('div');
    sheet.id = 'battle-bag'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', '전투 중 가방');
    sheet.innerHTML = '<div class="bag-tabs" role="tablist"><button type="button" role="tab" data-tab="run">이번 판</button><button type="button" role="tab" data-tab="all">전체 가방</button><button type="button" class="bag-close" aria-label="가방 닫기">✕</button></div>'
      + '<div class="bag-list" role="list"></div><p class="bag-note">장착·판매·강화는 결과 화면 정비소에서</p>';
    this.list = sheet.querySelector('.bag-list'); this.tabEls = [...sheet.querySelectorAll('[data-tab]')];
    this.hud.append(btn, sheet);
    // 포인터로 누른 버튼은 포커스를 놓는다(포커스가 버튼에 남으면 input.js 가 전투 키 입력을 막는다). 키보드 탐색(detail 0)은 유지.
    const release = (e) => { if (e?.detail > 0 && e.currentTarget instanceof HTMLElement && document.activeElement === e.currentTarget) e.currentTarget.blur(); };
    btn.addEventListener('click', (e) => { this.toggle(); release(e); });
    sheet.querySelector('.bag-close').addEventListener('click', (e) => { this.close(); release(e); });
    for (const tab of this.tabEls) tab.addEventListener('click', (e) => { this.tab = tab.dataset.tab; this.render(); release(e); });
    // Esc 는 일시정지보다 먼저 가방을 닫는다(캡처 단계에서 기본 동작 표시를 남기면 일시정지 핸들러가 물러난다).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.isOpen) return;
      e.preventDefault(); this.close();
    }, true);
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (this.visible) this.place(); }) : null;
    this.resizeObserver?.observe(this.hud);
    this.eco.onChange(() => this.schedule());
  }

  /** 전투 HUD 가 켜질 때(전투 시작) 기준 invSeq 와 출전 영웅을 잡는다. 꺼질 때는 숨긴다. */
  setBattle(on, invSeqAtStart) {
    this.invSeqAtStart = invSeqAtStart;
    if (!on) { this.visible = false; this.btn.hidden = true; this.close(); return; }
    this.heroId = this.currentHero();
    this.sync();
  }
  currentHero() { return this.eco.gearOwnerDefault?.() || this.eco.s.selected; }
  /** 데이터가 없거나 파티 전투면 버튼을 숨긴다. */
  usable() {
    const b = this.ui.app?.battle;
    return Array.isArray(this.eco?.s?.inventory) && !!b?.player && !b.stage?.party;
  }
  sync() {
    this.visible = this.usable();
    this.btn.hidden = !this.visible;
    if (!this.visible) { this.close(); return; }
    this.heroId = this.currentHero();
    const { fresh, foreign } = bagCounts(this.eco, this.invSeqAtStart, this.heroId);
    this.badge.hidden = fresh === 0; this.badge.textContent = fresh > 99 ? '99+' : String(fresh);
    this.foreign.hidden = foreign === 0;
    this.btn.setAttribute('aria-label', '가방' + (fresh ? ', 이번 판 새 장비 ' + fresh + '개' : '') + (foreign ? ', 다른 영웅 장비 ' + foreign + '개 포함' : ''));
    this.place();
    if (this.isOpen) this.render();
  }
  /** 인벤토리 변경 이벤트를 디바운스해 배지(와 열려 있으면 목록)를 갱신한다. */
  schedule() {
    if (!this.hud.classList.contains('show') || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; if (this.hud.classList.contains('show')) this.sync(); }, REFRESH_MS);
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }
  open() {
    if (!this.visible) return;
    this.isOpen = true; this.sheet.hidden = false; this.btn.classList.add('on'); this.btn.setAttribute('aria-expanded', 'true');
    this.place(); this.render();
  }
  close() {
    if (!this.isOpen && this.sheet.hidden) return;
    this.isOpen = false; this.sheet.hidden = true; this.btn.classList.remove('on'); this.btn.setAttribute('aria-expanded', 'false');
  }

  /**
   * 레이아웃은 열 때와 크기가 바뀔 때만 읽는다. 시트는 조작 버튼(스킬·회피·공격) 왼쪽 열에 두어 어떤 버튼도 가리지 않고,
   * 주인공이 서는 화면 가운데는 비운다. 가방 버튼은 지도 아래 오른쪽 가장자리의 빈 칸에 둔다.
   */
  place() {
    const hud = this.hud, box = hud.getBoundingClientRect(); if (!box.width) return;
    const top = hud.querySelector('.hud-right-top')?.getBoundingClientRect();
    const mapWrap = document.getElementById('minimap-wrap'), map = mapWrap && !mapWrap.classList.contains('hidden') ? document.getElementById('btn-map')?.getBoundingClientRect() : null;
    const pause = document.getElementById('btn-pause')?.getBoundingClientRect();
    const rightLimit = pause?.width ? pause.right : box.right - 14;
    const btnTop = Math.max(top?.bottom ?? 0, map?.bottom ?? 0, 56) + 6 - box.top;
    this.btn.style.setProperty('--bag-btn-top', Math.round(btnTop) + 'px');
    this.btn.style.setProperty('--bag-btn-right', Math.round(box.right - rightLimit) + 'px');
    let controlLeft = box.right;
    for (const el of hud.querySelectorAll('.skill-btn, #btn-dodge, #btn-attack')) {
      const r = el.getBoundingClientRect(); if (r.width && r.left < controlLeft) controlLeft = r.left;
    }
    const rightEdge = controlLeft - 6, width = Math.round(Math.min(box.width * 0.38, Math.max(MIN_WIDTH, rightEdge - box.left - box.width * 0.56)));
    // 위쪽은 같은 열에 걸친 HUD 카드(목표·안내·보스 바 등) 아래에서 시작한다.
    let sheetTop = Math.max(top?.bottom ?? 0, 56) + 4;
    for (const el of document.querySelectorAll(TOP_BLOCKERS)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top < box.top + box.height * 0.45 && r.right > rightEdge - width && r.left < rightEdge && r.bottom + 4 > sheetTop) sheetTop = r.bottom + 4;
    }
    sheetTop = Math.round(sheetTop - box.top);
    this.sheet.style.setProperty('--bag-right', Math.round(box.right - rightEdge) + 'px');
    this.sheet.style.setProperty('--bag-w', width + 'px');
    this.sheet.style.setProperty('--bag-top', sheetTop + 'px');
    this.sheet.style.setProperty('--bag-h', Math.max(120, Math.round(box.height - sheetTop - 8)) + 'px');
  }

  render() {
    if (!this.isOpen) return;
    const model = bagModel(this.eco, { invSeqAtStart: this.invSeqAtStart, heroId: this.heroId });
    for (const tab of this.tabEls) {
      const on = tab.dataset.tab === this.tab;
      tab.classList.toggle('on', on); tab.setAttribute('aria-selected', on ? 'true' : 'false');
      if (tab.dataset.tab === 'run') tab.textContent = '이번 판' + (model.runTotal ? ' ' + model.runTotal : '');
    }
    const rows = this.tab === 'run' ? model.run : model.all, total = this.tab === 'run' ? model.runTotal : model.allTotal;
    if (!rows.length) {
      this.list.innerHTML = '<p class="bag-empty">' + (this.tab === 'run' ? '아직 이번 판에 얻은 장비가 없어요' : '가방이 비어 있어요') + '</p>';
      return;
    }
    let html = '';
    for (const r of rows) {
      const name = tierName(r.def.name, r.inst);
      html += '<div class="bag-row rar-' + esc(r.rarity) + (r.foreign ? ' foreign' : '') + (r.isNew ? ' is-new' : '') + '" role="listitem" style="--rar:' + esc(r.color) + '">'
        + '<span class="bag-art">' + itemIconHtml(r.def, ' decoding="async"', { heroId: r.ownerId }) + (r.isNew ? '<i class="bag-new">NEW</i>' : '') + '</span>'
        + '<span class="bag-text"><span class="bag-name"><b>' + esc(name) + '</b>' + (r.enh > 0 ? '<em>+' + r.enh + '</em>' : '') + '</span>'
        + (r.foreign ? '<span class="bag-owner">◆ ' + esc(r.ownerName) + ' 장비</span>' : r.line ? '<span class="bag-cmp ' + (r.cmp?.verdict || '') + '">' + esc(r.line) + '</span>' : '')
        + '</span></div>';
    }
    if (total > rows.length) html += '<p class="bag-more">외 ' + (total - rows.length) + '개</p>';
    this.list.innerHTML = html;
  }
}
