import { PracticeBattle, PRACTICE_ENEMIES } from '../game/combat-practice.js';
import { disposeCharacter } from '../engine/assets.js';
import './combat-practice.css';

export class CombatPractice {
  constructor(app) {
    this.app = app;
    const entry = document.createElement('button'); entry.id = 'btn-combat-practice'; entry.className = 'btn btn-ghost';
    entry.type = 'button'; entry.textContent = '전투 연습';
    entry.addEventListener('click', () => this.start());
    app.oathShell.grid.append(entry);
    this.status = document.createElement('section'); this.status.id = 'practice-status'; this.status.hidden = true;
    this.status.setAttribute('aria-label', '전투 연습');
    this.status.innerHTML = '<b>전투 연습 · <span id="practice-remaining">10</span>체 남음</b><small>이동 WASD · 공격 J · 회피 K · 스킬 1–3</small><div><button type="button" id="practice-restart">다시 연습</button><button type="button" id="practice-exit">로비</button></div>';
    document.getElementById('hud').append(this.status);
    this.result = document.createElement('dialog'); this.result.id = 'practice-result';
    this.result.innerHTML = '<p class="practice-kicker">전투 연습</p><h2 id="practice-result-title"></h2><p id="practice-result-stats"></p><p>에너지 소모 없이 다시 연습할 수 있어요.</p><div><button type="button" id="practice-again">다시 도전</button><button type="button" id="practice-result-exit">로비로</button></div>';
    document.body.append(this.result);
    for (const id of ['practice-restart', 'practice-again']) document.getElementById(id).addEventListener('click', () => this.restart());
    for (const id of ['practice-exit', 'practice-result-exit']) document.getElementById(id).addEventListener('click', () => app.toLobby());
    this.result.addEventListener('cancel', event => { event.preventDefault(); app.toLobby(); });
    this.status.addEventListener('click', event => { if (event.detail > 0) event.target.closest('button')?.blur(); });
  }
  async start() {
    const app = this.app;
    if (app.mode !== 'lobby' || app.stageStarting || app.party?.party) return false;
    this.campaign = app.battle;
    this.battle ??= new PracticeBattle(app, result => this.showResult(result));
    app.battle = this.battle;
    return this.restart();
  }
  async restart() {
    const app = this.app;
    if (!this.campaign || app.stageStarting) return false;
    app.stageStarting = true;
    try {
      this.result.close(); app.oathShell.close(); app.ui.hideResult(); app.ui.closeModal(); app.tutorial.end();
      app.ui.show(document.getElementById('pause-overlay'), false); app.ui.show(document.getElementById('meta'), false);
      document.getElementById('stage-loading').hidden = false;
      if (app.showcase) { disposeCharacter(app.showcase.root, app.showcase.mixer); app.showcase = null; }
      app.mode = 'battle'; document.body.classList.add('combat-practice');
      if (!await this.battle.start() || app.battle !== this.battle) return false;
      this.campaign.rpgView?.refresh();
      document.getElementById('btn-auto').classList.remove('on');
      this.status.hidden = false; this.remaining = -1; this.update();
      document.activeElement?.blur();
      return true;
    } catch (error) {
      app.toLobby(); app.ui.toast('연습장을 준비하지 못했습니다. 다시 시도해 주세요.', 'red');
      console.warn('practice preparation failed', error?.message); return false;
    } finally { document.getElementById('stage-loading').hidden = true; app.stageStarting = false; }
  }
  update() {
    if (!this.campaign) return;
    const remaining = Math.max(0, PRACTICE_ENEMIES - this.battle.kills);
    if (this.remaining === remaining) return;
    this.remaining = remaining; document.getElementById('practice-remaining').textContent = String(remaining);
  }
  showResult(result) {
    this.update(); this.app.ui.show(document.getElementById('pause-overlay'), false);
    document.getElementById('practice-result-title').textContent = result.win ? '연습 완료' : '다시 도전해 보세요';
    document.getElementById('practice-result-stats').textContent = `${result.kills} / ${PRACTICE_ENEMIES}체 처치 · ${result.time.toFixed(1)}초 · 최대 ${result.maxCombo}콤보`;
    this.result.showModal();
  }
  release() {
    if (!this.campaign) return;
    this.battle.stop(); this.result.close(); this.status.hidden = true;
    this.app.battle = this.campaign; this.campaign = null;
    document.body.classList.remove('combat-practice');
  }
}
