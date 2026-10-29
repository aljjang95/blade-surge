// 엔드게임 허브 창: 만렙 뒤 해야 할 일을 목표 3개로 보여 주고 기존 화면으로 이동시킨다.
// 로비 메뉴(OathShell '모험' 묶음)의 입구에서만 열리는 모달이라 전투 화면을 가리지 않는다. 규칙은 game/endgame-hub.js.
import { endgameGoals } from '../game/endgame-hub.js';
import './endgame-hub.css';

const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
const SEEN_KEY = 'bs.endgame-hub.seen';
const store = { get() { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } }, set() { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* 저장소가 막혀도 허브는 동작한다 */ } } };
const SCREEN_LABEL = { stage: '캠페인으로', legend: '전설 수련으로', tower: '무한의 성으로', expedition: '원정으로' };

export class EndgameHubView {
  constructor(app) {
    this.app = app;
    this.dialog = el('dialog', 'endgame-dialog'); this.dialog.id = 'endgame-hub'; this.dialog.setAttribute('aria-labelledby', 'endgame-title');
    const header = el('header', 'endgame-header'), title = el('div'), h = el('h2', '', '엔드게임'); h.id = 'endgame-title';
    title.append(el('small', '', '만렙 그다음, 지금 할 일'), h);
    const close = el('button', 'endgame-close', '닫기'); close.type = 'button'; close.onclick = () => this.close();
    header.append(title, close);
    this.season = el('p', 'endgame-season'); this.list = el('ol', 'endgame-goals'); this.notice = el('p', 'endgame-notice'); this.notice.setAttribute('role', 'status');
    this.dialog.append(header, this.season, this.list, this.notice); document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { if (this.trigger?.isConnected) this.trigger.focus({ preventScroll: true }); });
    this.lobby = el('button', 'sq-btn endgame-open', '엔드게임'); this.lobby.type = 'button'; this.lobby.dataset.menuKey = 'endgame-open'; this.lobby.hidden = true;
    this.lobby.onclick = () => this.open();
    document.querySelector('.lobby-left')?.append(this.lobby);
    app.eco.onChange(() => this.refresh()); this.refresh();
  }
  model() { const eco = this.app.eco; return endgameGoals(eco.s, { nowMs: typeof eco.trustedClock === 'function' ? eco.trustedClock() : Date.now() }); }
  /** 입구 표시. 처음 열린 순간 한 번만 안내 문구를 띄운다. */
  refresh() {
    const m = this.model();
    this.lobby.hidden = !m.unlocked; this.lobby.setAttribute('aria-hidden', String(!m.unlocked));
    if (m.unlocked && !store.get()) { store.set(); setTimeout(() => this.app.ui?.toast?.('엔드게임 허브가 열렸어요 · 메뉴 → 엔드게임'), 800); }
    if (this.dialog.open) this.render(m);
  }
  open() {
    if (this.app.mode !== 'lobby' || this.app.stageStarting) return;
    this.trigger = document.activeElement; this.notice.textContent = ''; this.render(); if (!this.dialog.open) this.dialog.showModal();
  }
  close() { if (this.dialog.open) this.dialog.close(); }
  render(model = this.model()) {
    this.season.textContent = model.season ? `이번 주 이벤트 · ${model.season.name} — ${model.season.tagline}` : ''; this.season.hidden = !model.season;
    this.list.replaceChildren();
    if (!model.goals.length) { this.list.append(el('li', 'endgame-empty', '지금은 추천할 목표가 없어요. 캠페인을 이어가 보세요.')); return; }
    model.goals.forEach((g, i) => {
      const card = el('li', 'endgame-goal'), head = el('div', 'endgame-goal-head');
      head.append(el('span', 'endgame-rank', String(i + 1)), el('h3', '', g.title));
      const bar = document.createElement('progress'); bar.max = Math.max(1, g.progress.max); bar.value = g.progress.cur; bar.setAttribute('aria-label', g.progress.text);
      const go = el('button', 'endgame-go', SCREEN_LABEL[g.target.screen] || '이동'); go.type = 'button'; go.onclick = () => this.go(g.target);
      card.append(head, el('p', 'endgame-why', g.why), bar, el('p', 'endgame-progress', g.progress.text), go); this.list.append(card);
    });
  }
  go(target) {
    const app = this.app, meta = app.meta;
    if (app.mode !== 'lobby' || app.stageStarting) { this.notice.textContent = '전투와 저장을 마친 뒤 이동할 수 있습니다.'; return; }
    this.close();
    if (target.screen === 'tower') app.journeyView?.open('tower');
    else if (target.screen === 'legend') { meta.openTab('heroes'); meta.openLegend?.(document.activeElement); }
    else if (target.screen === 'expedition') app.expeditionUI?.open('dungeons', { depth: target.depth === 'standard' ? 'standard' : 'deep' });
    else meta.openTab('stage');
  }
}
