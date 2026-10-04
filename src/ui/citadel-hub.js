import './citadel-hub.css';
import { DUNGEONS, MATERIALS, CONSUMABLES } from '../data/expansion.js';
import { CITADEL_HUB_HOTSPOTS } from '../data/citadel-hub.js';
import { citadelPreparation } from '../game/citadel-preparation.js';
import { personalMetricLabel, personalMetricValue } from './personal-goal-labels.js';

const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const verbs = { dungeon: '입장 확인', campaign: '캠페인 보기', arena: '상대 고르기', merchant: '물약 구매', trainer: '전투 준비', steward: '결투 안내' };
const count = value => Number(value).toLocaleString('ko-KR');
const rewardLabel = rewards => {
  const entries = [];
  if (rewards?.gold) entries.push(`골드 ${count(rewards.gold)}`);
  if (rewards?.xp) entries.push(`탐험 경험치 ${count(rewards.xp)}`);
  for (const [id, amount] of Object.entries(rewards?.materials || {})) entries.push(`${MATERIALS.find(item => item.id === id)?.name || id} ${count(amount)}`);
  for (const [id, amount] of Object.entries(rewards?.consumables || {})) entries.push(`${CONSUMABLES.find(item => item.id === id)?.name || id} ${count(amount)}`);
  return entries.join(' · ') || '추가 보상 없음';
};
const goalCopy = goal => {
  if (!goal?.selected) return { status: 'none', title: '선택한 개인 목표 없음', description: '최근 기록에서 개인 목표를 선택할 수 있습니다.' };
  const condition = [goal.routeLabel, goal.contextLabel].filter(Boolean).join(' · ');
  const metric = personalMetricLabel(goal.metric);
  const target = Number.isFinite(goal.target) ? `${metric} ${personalMetricValue(goal.metric, goal.target)} ${goal.metric === 'time' ? '이하' : '이상'}` : '';
  const baseline = Number.isFinite(goal.baseline) ? `최고 기록 ${personalMetricValue(goal.metric, goal.baseline)}` : '';
  const labels = { route: '경로·원정 단계', hero: '영웅', level: '출격 레벨', control: '조작' };
  const mismatch = goal.mismatches?.length ? `다른 조건: ${goal.mismatches.map(key => labels[key] || key).join(' · ')}.` : '';
  if (goal.status === 'mismatch') {
    return { status: goal.status, title: '개인 목표 · 비교 조건 다름', description: `${mismatch} 현재 선택으로는 저장한 목표와 비교하지 않습니다.`, condition, target, baseline };
  }
  if (goal.status === 'no-baseline') return { status: goal.status, title: '개인 목표 · 비교 기록 없음', description: `${metric} 목표를 선택했지만 저장한 조건의 유효한 클리어 기록이 없어 목표 수치를 안내할 수 없습니다. ${mismatch}`, condition };
  if (goal.status === 'no-target') return { status: goal.status, title: '개인 목표 · 목표 수치 없음', description: `${metric} 비교 기록은 있지만 다음 목표 수치를 계산할 수 없습니다. ${mismatch}`, condition, baseline };
  return { status: 'matching', title: '개인 목표 · 비교 준비', description: '경로·원정 단계·영웅·출격 레벨·조작이 저장한 목표와 일치합니다. 전투 중 AUTO를 전환하면 실제 조작 조건으로 비교합니다.', condition, target, baseline };
};

/** Native controls and destination dialogs for the walking lobby. */
export class CitadelHubUI {
  constructor(app, { onInteract, onDestination } = {}) {
    this.app = app; this.onInteract = onInteract; this.onDestination = onDestination;
    this.nearest = null; this.opened = false; this.visible = false; this.busy = false; this.selectedDepth = 'standard';
    this.root = document.createElement('section'); this.root.className = 'citadel-hub-ui'; this.root.hidden = true;
    this.root.setAttribute('aria-label', '성채 출격 광장');
    this.root.innerHTML = `<div class="citadel-hub-place"><small>CITADEL</small><strong>출격 광장</strong><span>길을 따라 입구로 이동하세요</span></div>
      <div class="citadel-hub-hint"><span><kbd>WASD</kbd> <kbd>방향키</kbd> 이동</span><span><kbd>E</kbd> 대화 · 입장</span></div>
      <div class="citadel-hub-near"><div class="citadel-hub-near-copy"><small>가까운 입구</small><strong class="citadel-hub-near-name">성채의 길</strong><span class="citadel-hub-near-detail">던전과 안내관에게 다가가세요</span></div><button type="button" class="citadel-hub-interact" disabled><kbd>E</kbd><span>대화 · 입장</span></button></div>
      <div class="citadel-hub-stick" role="group" aria-label="성채 이동 조이스틱"><span class="citadel-hub-stick-cross" aria-hidden="true"></span><span class="citadel-hub-knob" aria-hidden="true"></span><span class="citadel-hub-stick-label" aria-hidden="true">이동</span></div>`;
    document.body.append(this.root);
    this.name = this.root.querySelector('.citadel-hub-near-name');
    this.detail = this.root.querySelector('.citadel-hub-near-detail');
    this.interactButton = this.root.querySelector('.citadel-hub-interact');
    this.interactLabel = this.interactButton.querySelector('span');
    this.touchStick = this.root.querySelector('.citadel-hub-stick');
    this.touchKnob = this.root.querySelector('.citadel-hub-knob');
    this.clickHandler = () => {
      if (!this.nearest || this.busy || this.opened) return;
      if (this.onInteract) this.onInteract(this.nearest);
      else this.interact(this.nearest, this.interactButton);
    };
    this.interactButton.addEventListener('click', this.clickHandler);
    this.dialog = document.createElement('dialog'); this.dialog.className = 'citadel-hub-dialog';
    this.dialog.setAttribute('aria-labelledby', 'citadel-destination-title');
    this.dialog.setAttribute('aria-describedby', 'citadel-destination-description');
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => {
      // Native close events are deferred. A settled close must never clear a
      // fresh E press, a newly reopened gate, or the journal opened after it.
      if (!this.opened || this.dialog.open) return;
      this.close();
    });
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault(); this.close();
    });
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const box = this.dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) this.close();
    });
    this.ecoListener = () => { if (this.opened && this.dialogSpot) this.refreshDestination(); };
    this.unsub = this.app.eco?.onChange?.(this.ecoListener);
  }
  setVisible(visible) {
    this.visible = !!visible; this.root.hidden = !this.visible;
    if (!this.visible) this.clear();
  }
  update(nearest, state = {}) {
    const spot = typeof nearest === 'string' ? CITADEL_HUB_HOTSPOTS.find(s => s.id === nearest) : nearest;
    this.nearest = spot || null;
    this.root.dataset.nearby = spot ? 'true' : 'false';
    this.name.textContent = spot?.label || '성채의 길';
    this.detail.textContent = spot ? spot.kind === 'dungeon'
      ? `탐험 Lv.${spot.minLevel} · 에너지 ${spot.energy}` : spot.description : '던전과 안내관에게 다가가세요';
    this.interactLabel.textContent = spot ? verbs[spot.kind] || '확인' : '대화 · 입장';
    this.interactButton.disabled = !spot || !!state.blocked || this.opened || this.busy;
    this.root.style.setProperty('--citadel-near-accent', spot?.accent || '#d3c29c');
  }
  interact(spot = this.nearest, trigger = this.interactButton) {
    if (!spot || this.busy || this.opened || this.app.stageStarting || this.app.mode !== 'lobby') return false;
    const canonical = CITADEL_HUB_HOTSPOTS.find(s => s.id === spot.id); if (!canonical) return false;
    this.app.hubControls?.clear(); this.app.citadelControls?.clear();
    if (this.onDestination) {
      const handled = this.onDestination(canonical, trigger);
      if (handled !== undefined) return handled;
    }
    if (canonical.kind === 'dungeon') return this.openDestination(canonical, trigger);
    if (canonical.kind === 'merchant') { this.app.citadelShop?.open(trigger); return true; }
    if (canonical.kind === 'trainer') { this.app.battle?.chronicle?.open('build'); return true; }
    if (canonical.kind === 'arena' || canonical.kind === 'steward') { this.app.expeditionUI.open('arena'); return true; }
    if (canonical.kind === 'campaign') { this.app.meta.openTab('stage'); return true; }
    return false;
  }
  openDestination(spot, trigger = this.interactButton) {
    const def = DUNGEONS.find(d => d.id === spot.route); if (!def || this.opened || this.busy) return false;
    this.trigger = trigger; this.returnFocus = trigger?.isConnected ? trigger : document.activeElement;
    this.dialogSpot = spot; this.selectedDepth = 'standard'; this.opened = true;
    this.renderDestination(def, spot);
    this.dialog.showModal(); this.dialog.querySelector('[data-citadel-depth]:checked')?.focus({ preventScroll: true });
    return true;
  }
  access(def, depth = this.selectedDepth) { return citadelPreparation(this.app, def.id, depth).access; }
  renderDestination(def, spot) {
    const preparation = citadelPreparation(this.app, def.id, this.selectedDepth);
    if (!preparation.ok) { this.close(); return; }
    this.dialog.innerHTML = `<div class="citadel-hub-destination-shell"><div class="citadel-hub-destination-scroll">
      <div class="citadel-hub-destination-art"><span></span></div>
      <div class="citadel-hub-destination-body"><small class="citadel-hub-eyebrow">원정 출격 준비</small><h2 id="citadel-destination-title"></h2><p id="citadel-destination-description"></p>
      <fieldset class="citadel-hub-depths"><legend>원정 단계</legend>${preparation.depthOptions.map(option => `<label class="citadel-hub-depth"><input type="radio" name="citadel-depth" value="${safe(option.depth)}" data-citadel-depth="${safe(option.depth)}" aria-describedby="citadel-depth-${safe(option.depth)}-state" ${option.depth === this.selectedDepth ? 'checked' : ''}><span class="citadel-hub-depth-copy"><strong>${safe(option.label)}</strong><small id="citadel-depth-${safe(option.depth)}-state"></small></span></label>`).join('')}</fieldset>
      <div class="citadel-hub-destination-stats"><span>해금 <b data-citadel-unlock></b></span><span>입장 비용 <b data-citadel-cost></b></span><span>현재 보유 <b data-citadel-energy></b></span></div><p class="citadel-hub-unlock-note" hidden></p>
      <section class="citadel-hub-preparation-section" aria-label="원정 목표"><h3>이번 원정의 목표</h3><p class="citadel-hub-objective"></p><p class="citadel-hub-tactics" hidden></p></section>
      <section class="citadel-hub-preparation-section" aria-label="클리어 보상"><h3>기본 클리어 보상</h3><p class="citadel-hub-rewards"></p><div class="citadel-hub-first-reward"></div></section>
      <section class="citadel-hub-frontier" aria-label="프론티어 효과"></section>
      <section class="citadel-hub-preparation-section citadel-hub-hero" aria-label="출격 영웅"><h3>출격 영웅</h3><p></p></section>
      <section class="citadel-hub-preparation-section" aria-label="보유 물약"><h3>보유 물약 <small>전투에서 사용</small></h3><ul class="citadel-hub-potions"></ul><p class="citadel-hub-preparation-note">이 화면에서는 물약을 소모하지 않습니다.</p></section>
      <section class="citadel-hub-personal-goal" aria-label="개인 목표"><div class="citadel-hub-goal-copy"></div><button type="button" class="citadel-hub-goal-open">기록에서 목표 보기</button></section>
      </div></div><section class="citadel-hub-action-cue" aria-label="출격 전 행동 안내" hidden><strong data-citadel-cue-depth></strong><p data-citadel-cue-objective></p><p data-citadel-cue-action></p></section><div class="citadel-hub-destination-footer"><p class="citadel-hub-access" role="status" aria-live="polite"></p><div class="citadel-hub-destination-actions"><button type="button" class="citadel-hub-cancel">돌아가기</button><button type="button" class="citadel-hub-go"></button></div></div></div>`;
    this.dialog.querySelectorAll('[data-citadel-depth]').forEach(input => input.addEventListener('change', () => {
      if (!input.checked || this.busy || !this.opened) return;
      this.selectedDepth = input.value; this.refreshDestination();
    }));
    this.dialog.querySelector('.citadel-hub-cancel').addEventListener('click', () => this.close());
    const goalOpen = this.dialog.querySelector('.citadel-hub-goal-open');
    goalOpen.disabled = typeof this.app.battle?.chronicle?.open !== 'function';
    goalOpen.addEventListener('click', () => {
      if (this.busy || this.app.stageStarting || !this.opened || this.dialogSpot !== spot) return;
      const chronicle = this.app.battle.chronicle, trigger = this.interactButton;
      this.close(); this.journalFocusCleanup?.();
      const restoreHubFocus = () => {
        // A deferred prior close can arrive after another journal visit opens.
        if (chronicle.dialog.open) return;
        this.journalFocusCleanup?.(); this.journalFocusCleanup = null;
        if (!this.visible || this.app.mode !== 'lobby' || this.busy || this.app.stageStarting || this.opened || this.dialog.open) return;
        const canWalk = this.app.canWalkHub?.() ?? !document.querySelector('dialog[open], #modal.show');
        if (!canWalk) return;
        this.update(this.app.hubMovement?.nearest ?? this.nearest, { blocked: false });
        if (trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
      };
      chronicle.dialog.addEventListener('close', restoreHubFocus);
      this.journalFocusCleanup = () => chronicle.dialog.removeEventListener('close', restoreHubFocus);
      chronicle.open('journal', trigger);
    });
    this.dialog.querySelector('.citadel-hub-go').addEventListener('click', async () => {
      if (this.busy || this.app.stageStarting || !this.opened || this.dialogSpot !== spot) return;
      const depth = this.selectedDepth, live = citadelPreparation(this.app, def.id, depth);
      if (!live.ok || !live.access.ok) { this.refreshDestination(); return; }
      this.busy = true; this.close();
      try { await this.app.startExpedition('dungeon', def.id, { depth }); }
      finally { this.busy = false; }
    });
    this.refreshDestination();
  }
  refreshDestination() {
    const def = DUNGEONS.find(d => d.id === this.dialogSpot?.route); if (!def || !this.opened) return;
    const preparation = citadelPreparation(this.app, def.id, this.selectedDepth);
    if (!preparation.ok) { this.close(); return; }
    const selected = preparation.definition, access = preparation.access, go = this.dialog.querySelector('.citadel-hub-go');
    this.dialog.dataset.depth = preparation.depth;
    this.dialog.style.setProperty('--citadel-near-accent', selected.accent || def.accent || '#a6d7cc');
    const art = this.dialog.querySelector('.citadel-hub-destination-art');
    art.style.backgroundImage = selected.art ? `url("${selected.art}")` : '';
    art.querySelector('span').textContent = selected.subtitle || def.subtitle || def.theme.toUpperCase();
    this.dialog.querySelector('#citadel-destination-title').textContent = selected.name;
    this.dialog.querySelector('#citadel-destination-description').textContent = selected.description;
    for (const option of preparation.depthOptions) {
      const input = this.dialog.querySelector(`[data-citadel-depth="${option.depth}"]`);
      input.checked = option.depth === preparation.depth;
      input.closest('label').classList.toggle('is-locked', !option.access.ok);
      this.dialog.querySelector(`#citadel-depth-${option.depth}-state`).textContent = option.access.ok ? `에너지 ${option.access.cost}` : `해금·입장 조건 확인 · 에너지 ${option.access.cost}`;
    }
    this.dialog.querySelector('[data-citadel-unlock]').textContent = `탐험 Lv.${selected.minLevel}`;
    this.dialog.querySelector('[data-citadel-cost]').textContent = `에너지 ${access.cost}`;
    this.dialog.querySelector('[data-citadel-energy]').textContent = `에너지 ${access.energy}`;
    const unlockNote = this.dialog.querySelector('.citadel-hub-unlock-note');
    unlockNote.hidden = preparation.depth !== 'deep';
    unlockNote.textContent = preparation.depth === 'deep' ? `심층 해금: 기본 원정 클리어 · 캠페인 ${selected.unlockCode} 클리어 · 탐험 Lv.${selected.minLevel}` : '';
    this.dialog.querySelector('.citadel-hub-objective').textContent = selected.objective || selected.description;
    const tactics = this.dialog.querySelector('.citadel-hub-tactics');
    tactics.hidden = !preparation.mapTactics;
    tactics.textContent = preparation.mapTactics ? `선택 전술 · ${preparation.mapTactics.options.map(option => option.label).join(' / ')} 중 이 방에서 1회. 적을 표시 범위로 유인한 뒤 장치 가까이에서 F 또는 전술 버튼으로 발동하세요. AUTO는 사용하지 않으며 추가 보상은 없습니다.` : '';
    const cue = this.dialog.querySelector('.citadel-hub-action-cue');
    cue.hidden = !preparation.actionCue;
    cue.querySelector('[data-citadel-cue-depth]').textContent = `${preparation.depth === 'deep' ? '심층' : '기본'} 원정 · 행동 안내`;
    cue.querySelector('[data-citadel-cue-objective]').textContent = preparation.actionCue?.objective || '';
    cue.querySelector('[data-citadel-cue-action]').textContent = preparation.actionCue?.action || '';
    this.dialog.querySelector('.citadel-hub-rewards').textContent = rewardLabel(preparation.rewards.base);
    const first = preparation.rewards.firstClear;
    this.dialog.querySelector('.citadel-hub-first-reward').innerHTML = first ? `<strong>첫 심층 클리어 추가 ${first.eligible ? '· 미수령' : '· 수령 완료'}</strong><p>${safe(rewardLabel(first.rewards))}</p>${first.eligible ? '' : '<small>이번 클리어에는 첫 클리어 보상이 추가되지 않습니다.</small>'}` : '';
    const frontier = preparation.frontier;
    this.dialog.querySelector('.citadel-hub-frontier').innerHTML = frontier ? `<h3>이번 주 프론티어 · ${safe(frontier.name)}</h3><p>${safe(frontier.modifier)}</p>` : `<p>${preparation.depth === 'deep' ? '프론티어 효과는 기본 원정에만 적용됩니다.' : '이번 원정에 적용되는 프론티어 효과가 없습니다.'}</p>`;
    this.dialog.querySelector('.citadel-hub-hero p').textContent = `${preparation.hero.name} · 출격 Lv.${preparation.hero.level} · ${preparation.hero.controlLabel}`;
    this.dialog.querySelector('.citadel-hub-potions').innerHTML = preparation.potions.map(potion => `<li data-citadel-potion="${safe(potion.id)}"><div><strong>${safe(potion.name)}</strong><span><kbd>${safe(potion.key)}</kbd><b data-citadel-potion-count>${count(potion.count)}개</b></span></div><p>${safe(potion.description)}</p></li>`).join('');
    const goal = goalCopy(preparation.personalGoal), goalSection = this.dialog.querySelector('.citadel-hub-personal-goal');
    goalSection.dataset.status = goal.status;
    goalSection.querySelector('.citadel-hub-goal-copy').innerHTML = `<h3>${safe(goal.title)}</h3>${goal.condition ? `<p class="citadel-hub-goal-context">${safe(goal.condition)}</p>` : ''}${goal.target ? `<strong class="citadel-hub-goal-target">${safe(goal.target)}</strong>` : ''}${goal.baseline ? `<span class="citadel-hub-goal-baseline">${safe(goal.baseline)}</span>` : ''}<p>${safe(goal.description)}</p><small>개인 목표는 추가 보상을 지급하지 않습니다.</small>`;
    go.disabled = !access.ok || this.busy;
    go.textContent = `${preparation.depth === 'deep' ? '심층' : '기본'} 입장 · 에너지 ${access.cost}`;
    this.dialog.querySelector('.citadel-hub-access').textContent = access.error || '입장을 확정하면 에너지가 소모됩니다.';
  }
  close() {
    if (!this.opened && !this.dialog.open) return;
    // Finish state/input cleanup before the native dialog becomes walkable.
    this.opened = false; this.dialogSpot = null;
    this.app.hubControls?.clear(); this.app.citadelControls?.clear();
    if (this.dialog.open) this.dialog.close();
    const canWalk = this.visible && this.app.mode === 'lobby' && !this.app.stageStarting &&
      (this.app.canWalkHub?.() ?? !document.querySelector('dialog[open], #modal.show'));
    this.update(this.nearest, { blocked: !canWalk });
    if (canWalk && !this.busy && this.returnFocus?.isConnected && !this.returnFocus.disabled) this.returnFocus.focus({ preventScroll: true });
  }
  clear() { this.nearest = null; this.close(); this.touchKnob.style.transform = 'translate(-50%, -50%)'; }
  destroy() {
    this.clear(); this.unsub?.(); this.journalFocusCleanup?.();
    const listeners = this.app.eco?.listeners, listenerIndex = listeners?.indexOf(this.ecoListener);
    if (listenerIndex >= 0) listeners.splice(listenerIndex, 1);
    this.interactButton.removeEventListener('click', this.clickHandler);
    this.root.remove(); this.dialog.remove();
  }
}
