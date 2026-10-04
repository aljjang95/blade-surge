import { Minimap } from './minimap.js';
import { battleObjectiveView, discoveredMapView } from './battle-objective-view.js';
import './battle-readability.css';

const node = (tag, className, text = '') => {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
};
const blockedCopy = { auto: '수동 조작에서 사용', paused: '전투 정지 중', 'no-targets': '범위 안에 적이 없습니다',
  'out-of-range': '장치의 조작판으로 이동', 'room-not-active': '전투 중에 선택 가능',
  'outside-room': '장치 구역으로 이동', dead: '영웅이 쓰러졌습니다', 'boss-defeated': '전투 종료',
  inactive: '전투 종료', spent: '이 방의 장치 사용 완료', closed: '장치 사용 종료' };
const roomType = { start: '출발', normal: '전투', elite: '정예', treasure: '보물', boss: '보스' };

/** 네이티브 표시 셸. 입력 수락과 전투 결과는 기존 Battle이 결정한다. */
export class BattleReadability {
  constructor(app) {
    this.app = app; this.hud = document.getElementById('hud'); this.hud.classList.add('battle-readability');
    this.objective = document.getElementById('objective');
    this.context = document.getElementById('map-tactics-context');
    this.action = document.getElementById('btn-map-interact');
    this.actionName = this.action.querySelector('.map-tactics-action-name');
    this.actionDetail = this.action.querySelector('.map-tactics-action-detail');
    this.contextTitle = this.context.querySelector('.map-tactics-context-copy strong');
    this.contextDetail = this.context.querySelector('.map-tactics-context-copy span');
    this.mapButton = document.getElementById('btn-map');
    this.mapButton.setAttribute('aria-label', '발견한 구역 지도 열기 · ?는 보스 기척의 방향');
    this.dialog = node('dialog', 'battle-atlas'); this.dialog.id = 'battle-atlas';
    this.dialog.setAttribute('aria-labelledby', 'battle-atlas-title');
    const header = node('header', 'battle-atlas-header'), title = node('div', '');
    title.append(node('small', '', 'EXPLORED TERRITORY'));
    const heading = node('h2', '', '탐험 지도'); heading.id = 'battle-atlas-title'; title.append(heading);
    this.closeButton = node('button', 'battle-atlas-close', '전투로 돌아가기'); this.closeButton.type = 'button';
    this.closeButton.id = 'btn-map-close'; header.append(title, this.closeButton);
    const body = node('div', 'battle-atlas-body'); this.canvas = node('canvas', 'battle-atlas-canvas');
    this.canvas.setAttribute('aria-hidden', 'true'); this.map = new Minimap(this.canvas);
    const aside = node('aside', 'battle-atlas-aside'); this.goal = node('p', 'battle-atlas-goal');
    this.legend = node('p', 'battle-atlas-legend', '△ 나 · ◇ 보물 · ! 정예 · ♜ 보스 · ? 보스 기척(방향)');
    this.rooms = node('ul', 'battle-atlas-rooms'); this.rooms.setAttribute('aria-label', '발견한 구역');
    aside.append(this.goal, this.legend, this.rooms); body.append(this.canvas, aside);
    this.dialog.append(header, body, node('p', 'battle-atlas-footnote', '지형은 발견한 구역만 표시합니다. ?는 미발견 보스의 방향 단서입니다. 지도에서는 이동·장치 발동을 하지 않습니다.'));
    document.body.append(this.dialog);
    this.mapButton.addEventListener('click', () => this.openMap());
    this.closeButton.addEventListener('click', () => this.closeMap());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.closeMap(); });
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.releaseMap(); });
    this.resize = new ResizeObserver(() => { if (this.dialog.open && this.mapBattle) this.refreshMap(this.mapBattle); });
    this.resize.observe(this.canvas);
    // 정지 진입 시 기존 Input 초기화 직후 장치 표시도 실제 정지 상태로 바꾼다.
    this.clearListener = app.input.onClear(() => this.update(app.battle));
  }
  layoutControls(battle) {
    const tray = document.getElementById('battle-info-actions'), top = this.hud.querySelector('.hud-right-top');
    const codex = battle?.rpgView?.hudButton, engraving = battle?.chronicle?.hud;
    if (codex && codex.parentElement !== tray) tray.append(codex);
    if (engraving) {
      // currentOffer()는 이연 선택을 변경할 수 있으므로 실제 대기열만 읽는다.
      const hasOffer = !!battle.active && !!battle.run?.queue?.length;
      engraving.classList.toggle('battle-earned-offer', hasOffer);
      const parent = hasOffer ? top : tray;
      if (engraving.parentElement !== parent) parent.prepend(engraving);
    }
    const growth = this.hud.querySelector('.oath-run-details');
    if (growth) tray.append(growth);
  }
  renderObjective(battle) {
    const view = battleObjectiveView(battle), key = JSON.stringify(view);
    if (key === this.goalKey) return view;
    this.goalKey = key; this.objective.replaceChildren();
    const title = node('strong', 'battle-objective-title', view.title);
    if (view.total) title.append(node('span', '', ` ${view.progress}/${view.total}`));
    this.objective.append(title, node('span', 'battle-objective-action', view.action));
    if (view.challenge) this.objective.append(node('small', 'battle-objective-challenge', view.challenge));
    if (view.holdTotal > 0) {
      const progress = node('progress', 'battle-objective-hold'); progress.max = view.holdTotal;
      progress.value = Math.min(view.hold, view.holdTotal);
      progress.setAttribute('aria-label', `${view.title} 유지 ${view.hold.toFixed(1)} / ${view.holdTotal}초`);
      this.objective.append(progress);
    }
    return view;
  }
  update(battle, dt = 0) {
    // 일반 프레임의 DOM 갱신은 10Hz로 제한하고 Input 초기화는 즉시 반영한다.
    if (dt > 0) { this.refreshIn = (this.refreshIn || 0) - dt; if (this.refreshIn > 0) return; this.refreshIn = .1; }
    this.layoutControls(battle);
    if (!battle?.world || !battle.player || !battle.active) {
      this.context.hidden = true; this.action.disabled = true;
      if (this.mapBattle) this.closeMap(false);
      return;
    }
    const goal = this.renderObjective(battle);
    const snapshot = battle.mapTactics?.snapshot(battle);
    const visible = !!snapshot?.roomDiscovered && battle.curRoom?.id === snapshot.roomId
      && snapshot.phase !== 'closed' && snapshot.blockedReason !== 'wrong-world';
    this.context.hidden = !visible;
    this.context.dataset.phase = snapshot?.phase || 'closed';
    this.context.dataset.nearby = snapshot?.nearbyId || '';
    this.action.disabled = !visible || !snapshot.actionable;
    this.action.hidden = !snapshot?.nearbyId;
    if (visible) {
      const nearby = snapshot.nodes.find(entry => entry.id === snapshot.nearbyId);
      const selected = snapshot.nodes.find(entry => entry.id === snapshot.selectedId);
      const effect = nearby?.id === 'gather' ? '적 모으기' : '적 밀어내기';
      this.actionName.textContent = snapshot.used ? `${selected?.label || '장치'} · ${snapshot.phase === 'canceled' ? '중단' : snapshot.phase === 'windup' ? '발동 준비' : snapshot.phase === 'active' ? '발동 중' : '사용 완료'}`
        : nearby ? `${nearby.label} 발동 · F` : '조작판으로 이동';
      this.actionDetail.textContent = snapshot.used ? `제어 대상 ${snapshot.affectedCount}명${snapshot.remainingSeconds > 0 ? ` · ${snapshot.remainingSeconds.toFixed(1)}초` : ''}`
        : snapshot.actionable ? `${effect} · 대상 ${snapshot.targetCount}명` : blockedCopy[snapshot.blockedReason] || '장치의 조작판으로 이동';
      this.contextTitle.textContent = snapshot.used ? this.actionName.textContent : '정원의 장치';
      this.contextDetail.textContent = snapshot.used ? this.actionDetail.textContent : '이 방에서 1회 · 적 모으기 / 밀어내기';
      this.action.setAttribute('aria-label', `${this.actionName.textContent} · ${this.actionDetail.textContent} · 이 방에서 1회`);
    }
    if (this.dialog.open) this.refreshMap(battle, goal);
  }
  openMap() {
    const battle = this.app.battle;
    if (this.dialog.open || !battle?.active || !battle.world || !battle.player?.alive || this.app.mode !== 'battle'
      || document.querySelector('dialog[open], #modal.show, #pause-overlay.show')) return;
    this.mapBattle = battle; this.mapWorld = battle.world;
    battle.setPaused('tactical-map', true);
    try { this.dialog.showModal(); this.refreshMap(battle); this.closeButton.focus({ preventScroll: true }); }
    catch (error) { this.releaseMap(); throw error; }
  }
  refreshMap(battle, view = battleObjectiveView(battle)) {
    if (battle !== this.mapBattle || battle.world !== this.mapWorld) { this.closeMap(false); return; }
    if (this.map.floor !== battle.world) this.map.setFloor(battle.world);
    this.map.draw(battle);
    this.goal.textContent = `${view.title}${view.total ? ` ${view.progress}/${view.total}` : ''} · ${view.action}${view.challenge ? ` · ${view.challenge}` : ''}`;
    const known = discoveredMapView(battle.world), key = JSON.stringify([known.rooms, battle.curRoom?.id, view.roomId, known.sealed]);
    if (key === this.roomsKey) return;
    this.roomsKey = key; this.rooms.replaceChildren();
    for (const room of known.rooms) {
      const current = battle.curRoom?.id === room.id, objective = view.roomId === room.id;
      const li = node('li', current ? 'is-current' : objective ? 'is-objective' : ''); li.dataset.room = String(room.id);
      li.textContent = `${current ? '현재 · ' : objective ? '목표 · ' : ''}${room.label || `${roomType[room.type] || '구역'} ${room.id + 1}`}`;
      li.append(node('small', '', room.type === 'boss' && known.sealed ? '봉인됨' : room.cleared ? '정화 완료' : '미정화'));
      this.rooms.append(li);
    }
  }
  releaseMap() {
    const battle = this.mapBattle; this.mapBattle = null; this.mapWorld = null;
    if (battle) battle.setPaused('tactical-map', false);
  }
  closeMap(restoreFocus = true) {
    const battle = this.mapBattle;
    if (this.dialog.open) this.dialog.close();
    this.releaseMap();
    // 버튼에 초점을 남기면 기존 키보드 입력 보호 규칙이 WASD/F를 차단한다.
    if (restoreFocus && battle?.active && !battle.paused && this.app.mode === 'battle') this.app.canvas?.focus({ preventScroll: true });
  }
  clear() { this.closeMap(false); this.context.hidden = true; this.action.disabled = true; this.goalKey = null; this.roomsKey = null; }
}
