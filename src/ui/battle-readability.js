import { Minimap } from './minimap.js';
import { battleObjectiveView, discoveredMapView } from './battle-objective-view.js';
import './battle-readability.css';
import { gardenMasteryForStage } from '../data/garden-mastery.js';

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
    // 전투 중 목표 카드는 한 줄로 줄여 반투명하게 둔다(위쪽 적을 가리지 않게). 탭하면 잠시 펼친다.
    this.objective.setAttribute('role', 'button'); this.objective.tabIndex = 0; this.objective.setAttribute('aria-expanded', 'false');
    this.objective.addEventListener('click', () => this.toggleObjective());
    this.objective.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.toggleObjective(); } });
    // 방 진입 안내는 하단 장치 줄이 아니라 위쪽 가운데 가장자리에 잠깐 떴다 사라지는 토스트로 보인다.
    this.intro = node('div', 'room-intro'); this.intro.id = 'room-intro'; this.intro.hidden = true; this.intro.setAttribute('role', 'status');
    this.introTitle = node('strong', ''); this.introDetail = node('span', ''); this.intro.append(this.introTitle, this.introDetail);
    this.intro.addEventListener('animationend', () => { this.intro.hidden = true; this.intro.classList.remove('on'); });
    this.hud.append(this.intro);
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
  /** 목표 카드 펼침/접기. 펼친 카드는 5초 뒤 스스로 접힌다(타이머는 입력 때만 만든다). */
  toggleObjective(open = !this.objective.classList.contains('is-expanded')) {
    this.objective.classList.toggle('is-expanded', open); this.objective.setAttribute('aria-expanded', String(open));
    clearTimeout(this.objectiveTimer);
    if (open) this.objectiveTimer = setTimeout(() => this.toggleObjective(false), 5000);
  }
  /** 같은 key 는 한 번만 띄운다. 애니메이션을 다시 시작하려면 클래스를 뗐다 붙인다. */
  showIntro(key, title, detail) {
    if (!this.intro || this.introKey === key) return;
    this.introKey = key; this.introTitle.textContent = title; this.introDetail.textContent = detail;
    this.intro.hidden = false; this.intro.classList.remove('on'); void this.intro.offsetWidth; this.intro.classList.add('on');
  }
  layoutControls(battle) {
    const tray = document.getElementById('battle-info-actions');
    const codex = battle?.rpgView?.hudButton, engraving = battle?.chronicle?.hud;
    if (codex && codex.parentElement !== tray) tray.append(codex);
    // 각인 현황 버튼은 출격 전 전운으로 가져온 각인이 있을 때만 보인다(masterworks.refresh 가 hidden 을 정한다).
    // 일시정지 창의 정보 묶음(#pause-overlay)은 전투 중 display:none 이라 거기 두면 크기가 0이 된다.
    // 그래서 보이는 HUD 우상단 묶음(.hud-right-top)에 둔다. 예전에 정보 묶음으로 옮겼던 자리에 남은 버튼도 되돌린다.
    const top = this.hud.querySelector('.hud-right-top');
    if (engraving && top && engraving.parentElement !== top) top.prepend(engraving);
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
        : nearby ? `${nearby.label} 발동${document.documentElement.dataset.input === 'touch' ? '' : ' · F'}` : '조작판으로 이동';
      this.actionDetail.textContent = snapshot.used ? `제어 대상 ${snapshot.affectedCount}명${snapshot.remainingSeconds > 0 ? ` · ${snapshot.remainingSeconds.toFixed(1)}초` : ''}`
        : snapshot.actionable ? `${effect} · 대상 ${snapshot.targetCount}명` : blockedCopy[snapshot.blockedReason] || '장치의 조작판으로 이동';
      const mastery = gardenMasteryForStage(battle.stage);
      this.contextTitle.textContent = snapshot.used ? this.actionName.textContent : mastery?.label || '정원의 장치';
      this.contextDetail.textContent = snapshot.used ? this.actionDetail.textContent
        : mastery ? `이 방에서 1회 · ${nearby ? mastery.hints[nearby.id] : mastery.priorityHint}`
          : '이 방에서 1회 · 적 모으기 / 밀어내기';
      this.action.setAttribute('aria-label', `${this.actionName.textContent} · ${this.actionDetail.textContent} · 이 방에서 1회`);
      // 방에 들어올 때 한 번, 장치를 쓰거나 중단할 때 한 번만 안내한다(남은 초처럼 매 프레임 바뀌는 글은 넣지 않는다).
      const roomKey = `${battle.stage?.idx ?? 0}:${snapshot.roomId}`;
      if (!snapshot.used) this.showIntro(roomKey, mastery?.label || '정원의 장치', mastery ? `이 방에서 1회 · ${mastery.priorityHint}` : '이 방에서 1회 · 적 모으기 / 밀어내기');
      else this.showIntro(`${roomKey}:${snapshot.phase}`, selected?.label || '장치', snapshot.phase === 'canceled' ? '중단됨' : snapshot.phase === 'windup' ? '발동 준비' : snapshot.phase === 'active' ? `발동 중 · 제어 대상 ${snapshot.affectedCount}명` : '이 방의 장치 사용 완료');
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
      const mastery = gardenMasteryForStage(battle.stage);
      if (mastery && room.id === mastery.roomId) {
        // 실제로 양끝을 발견한 연결만 안내한다. 미발견 입구의 위치는 만들지 않는다.
        const approaches = mastery.approachRoomIds.filter(id => known.corridors.some(edge =>
          edge.fromId === room.id && edge.toId === id || edge.toId === room.id && edge.fromId === id));
        li.append(node('small', '', approaches.length === 2 ? '발견한 입구 · 전투방 / 보물방'
          : approaches.length === 1 ? `발견한 입구 · ${approaches[0] === 1 ? '전투방' : '보물방'}` : '연결 입구 미발견'));
      }
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
  clear() {
    this.closeMap(false); this.context.hidden = true; this.action.disabled = true; this.goalKey = null; this.roomsKey = null;
    if (this.intro) { this.intro.hidden = true; this.intro.classList.remove('on'); this.introKey = null; }
    if (this.objective?.classList) this.toggleObjective(false);
  }
}
