import './citadel-hub.css';
import { DUNGEONS, MATERIALS, CONSUMABLES } from '../data/expansion.js';
import { CITADEL_HUB_HOTSPOTS } from '../data/citadel-hub.js';
import { citadelPreparation } from '../game/citadel-preparation.js';
import { HEROES } from '../data/heroes.js';
import { personalMetricLabel, personalMetricValue } from './personal-goal-labels.js';

const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const verbs = { dungeon: '입장 확인', campaign: '캠페인 보기', arena: '상대 고르기', merchant: '물약 구매', trainer: '전투 준비', steward: '결투 안내' };
const count = value => Number(value).toLocaleString('ko-KR');
const potionArt = id => `/img/departure-journal/icons/potion-${id === 'hp_tonic' ? 'health' : id === 'overdrive' ? 'power' : 'guard'}.webp`;
const rewardCards = rewards => {
  const entries = [];
  if (rewards?.gold) entries.push({ name: '골드', amount: rewards.gold, art: 'gold' });
  if (rewards?.xp) entries.push({ name: '탐험 경험치', amount: rewards.xp, art: 'hero-xp' });
  for (const [id, amount] of Object.entries(rewards?.materials || {})) entries.push({ name: MATERIALS.find(item => item.id === id)?.name || id, amount, art: id === 'ember_core' ? 'material-ember' : id === 'star_dust' ? 'material-stardust' : 'material-leaf' });
  for (const [id, amount] of Object.entries(rewards?.consumables || {})) entries.push({ name: CONSUMABLES.find(item => item.id === id)?.name || id, amount, art: `potion-${id === 'hp_tonic' ? 'health' : id === 'overdrive' ? 'power' : 'guard'}` });
  return entries.map(item => `<li><img src="/img/departure-journal/icons/${item.art}.webp" alt="" width="48" height="48"><span>${safe(item.name)}</span><b>${count(item.amount)}</b></li>`).join('') || '<li>추가 보상 없음</li>';
};
const rewardLabel = rewards => {
  const entries = [];
  if (rewards?.gold) entries.push(`골드 ${count(rewards.gold)}`);
  if (rewards?.xp) entries.push(`탐험 경험치 ${count(rewards.xp)}`);
  for (const [id, amount] of Object.entries(rewards?.materials || {})) entries.push(`${MATERIALS.find(item => item.id === id)?.name || id} ${count(amount)}`);
  for (const [id, amount] of Object.entries(rewards?.consumables || {})) entries.push(`${CONSUMABLES.find(item => item.id === id)?.name || id} ${count(amount)}`);
  return entries.join(' · ') || '추가 보상 없음';
};
const challengeEffectsLabel = effects => `적 체력 ×${effects.enemyHp.toFixed(2)} · 공격력 ×${effects.enemyAtk.toFixed(2)} · 완료 명성 ×${effects.rewardMul.toFixed(2)}`;
const preparationSignature = preparation => JSON.stringify({ routeId: preparation.routeId, depth: preparation.depth,
  cost: preparation.access.cost, challenges: preparation.challenges.ids, effects: preparation.challenges.effects });
const goalCopy = goal => {
  if (!goal?.selected) return { status: 'none', title: '선택한 개인 목표 없음', description: '최근 기록에서 개인 목표를 선택할 수 있습니다.' };
  const condition = [goal.routeLabel, goal.contextLabel].filter(Boolean).join(' · ');
  const metric = personalMetricLabel(goal.metric);
  const target = Number.isFinite(goal.target) ? `${metric} ${personalMetricValue(goal.metric, goal.target)} ${goal.metric === 'time' ? '이하' : '이상'}` : '';
  const baseline = Number.isFinite(goal.baseline) ? `최고 기록 ${personalMetricValue(goal.metric, goal.baseline)}` : '';
  const labels = { route: '경로·원정 단계·전투 구성', hero: '영웅', level: '출격 레벨', control: '조작' };
  const mismatch = goal.mismatches?.length ? `다른 조건: ${goal.mismatches.map(key => labels[key] || key).join(' · ')}.` : '';
  if (goal.status === 'mismatch') {
    return { status: goal.status, title: '개인 목표 · 비교 조건 다름', description: `${mismatch} 현재 선택으로는 저장한 목표와 비교하지 않습니다.`, condition, target, baseline };
  }
  if (goal.status === 'no-baseline') return { status: goal.status, title: '개인 목표 · 비교 기록 없음', description: `${metric} 목표를 선택했지만 저장한 조건의 유효한 클리어 기록이 없어 목표 수치를 안내할 수 없습니다. ${mismatch}`, condition };
  if (goal.status === 'no-target') return { status: goal.status, title: '개인 목표 · 목표 수치 없음', description: `${metric} 비교 기록은 있지만 다음 목표 수치를 계산할 수 없습니다. ${mismatch}`, condition, baseline };
  return { status: 'matching', title: '개인 목표 · 비교 준비', description: '경로·원정 단계·전투 구성·영웅·출격 레벨·조작이 저장한 목표와 일치합니다. 전투 중 AUTO를 전환하면 실제 조작 조건으로 비교합니다.', condition, target, baseline };
};

/** Native controls and destination dialogs for the walking lobby. */
export class CitadelHubUI {
  constructor(app, { onInteract, onDestination } = {}) {
    this.app = app; this.onInteract = onInteract; this.onDestination = onDestination;
    this.nearest = null; this.opened = false; this.visible = false; this.busy = false; this.selectedDepth = 'standard';
    this.challengeNotice = ''; this.reviewedPreparation = null;
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
    this.dialog.addEventListener('keydown', event => this.containDestinationTab(event));
    this.ecoListener = () => { if (this.opened && this.dialogSpot) this.refreshDestination(); };
    this.unsub = this.app.eco?.onChange?.(this.ecoListener);
  }
  containDestinationTab(event) {
    if (!this.opened || !this.dialog.open || event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const owner = this.dialog.ownerDocument, active = owner.activeElement;
    if (!this.dialog.contains(active)) return;
    // 저장·입장 상태가 바뀔 수 있어 매번 실제로 탭 가능한 요소를 다시 읽는다.
    // 스크롤 밖 요소도 렌더되어 있으면 포함하고 중간 탭 이동·스크롤은 브라우저에 맡긴다.
    const controls = [...this.dialog.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')].filter(control => {
      const visibility = owner.defaultView.getComputedStyle(control).visibility;
      return control.tabIndex >= 0 && !control.matches(':disabled') && !control.closest('[hidden], [inert]') &&
        control.getClientRects().length > 0 && visibility !== 'hidden' && visibility !== 'collapse';
    });
    const stops = controls.filter(control => {
      if (control.type !== 'radio' || !control.name) return true;
      const group = controls.filter(candidate => candidate.type === 'radio' && candidate.name === control.name && candidate.form === control.form);
      return control === (group.find(candidate => candidate.checked) || group[0]);
    });
    const first = stops[0], last = stops.at(-1);
    // 처음·마지막 경계에서만 순환하며 라디오 선택과 방향키의 기본 동작은 바꾸지 않는다.
    const target = event.shiftKey && active === first ? last : !event.shiftKey && active === last ? first : null;
    if (!target) return;
    event.preventDefault(); target.focus();
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
    const canonical = CITADEL_HUB_HOTSPOTS.find(item => item.id === spot?.id && item.kind === 'dungeon');
    const def = canonical && DUNGEONS.find(d => d.id === canonical.route);
    if (!def || this.opened || this.busy || this.app.mode !== 'lobby' || this.app.stageStarting) return false;
    spot = canonical;
    this.app.citadel?.clearInput?.();
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
    this.challengeNotice = ''; this.reviewedPreparation = null;
    this.dialog.innerHTML = `<div class="citadel-hub-destination-shell"><div class="citadel-hub-destination-scroll">
      <header class="citadel-hub-destination-heading"><div class="citadel-hub-destination-art"><span></span></div><div class="citadel-hub-destination-identity"><small class="citadel-hub-eyebrow">원정 준비</small><h2 id="citadel-destination-title"></h2><b data-citadel-unlock></b></div><button type="button" class="citadel-hub-dismiss" aria-label="출격 준비 닫기">닫기</button></header>
      <div class="citadel-hub-destination-body"><fieldset class="citadel-hub-depths"><legend>원정 단계</legend>${preparation.depthOptions.map(option => `<label class="citadel-hub-depth"><input type="radio" name="citadel-depth" value="${safe(option.depth)}" data-citadel-depth="${safe(option.depth)}" aria-describedby="citadel-depth-${safe(option.depth)}-state" ${option.depth === this.selectedDepth ? 'checked' : ''}><span class="citadel-hub-depth-copy"><strong>${safe(option.label)}</strong><small id="citadel-depth-${safe(option.depth)}-state"></small></span></label>`).join('')}</fieldset>
      <div class="citadel-hub-destination-stats"><span>입장 비용 <b data-citadel-cost></b></span><span>현재 보유 <b data-citadel-energy></b></span></div><p class="citadel-hub-unlock-note" hidden></p>
      <section class="citadel-hub-preparation-section" aria-label="클리어 보상"><h3>원정 보상 <small>REWARDS</small></h3><ul class="citadel-hub-rewards"></ul><div class="citadel-hub-first-reward"></div></section>
      <section class="citadel-hub-preparation-section" aria-label="보유 물약"><h3>출격 준비 <small>PREPARATION</small></h3><div class="citadel-hub-loadout"><div class="citadel-hub-hero" aria-label="출격 영웅"><img alt="" width="76" height="76"><p></p></div><ul class="citadel-hub-potions"></ul></div><p class="citadel-hub-preparation-note">물약은 전투에서 사용 · 이 화면에서는 소모되지 않습니다.</p></section>
      <details class="citadel-hub-journal-rules"><summary>목표 · 규칙 보기</summary><p id="citadel-destination-description"></p><section class="citadel-hub-action-cue" aria-label="출격 전 행동 안내" hidden><strong data-citadel-cue-depth></strong><p data-citadel-cue-objective></p><p data-citadel-cue-action></p></section><p class="citadel-hub-tactics" hidden></p><section class="citadel-hub-preparation-section" aria-label="원정 목표"><h3>이번 원정의 목표</h3><p class="citadel-hub-objective"></p></section><section class="citadel-hub-frontier" aria-label="프론티어 효과"></section><section class="citadel-hub-personal-goal" aria-label="개인 목표"><div class="citadel-hub-goal-copy"></div><button type="button" class="citadel-hub-goal-open">기록에서 목표 보기</button></section></details>
      <details class="citadel-hub-journal-oaths"><summary><span id="citadel-challenge-active"></span><span>변경</span></summary><section class="citadel-hub-risk-choice" aria-label="서약 선택"><div class="citadel-hub-risk-row"><button type="button" class="citadel-hub-fury" aria-pressed="false" aria-describedby="citadel-fury-rule citadel-fury-persistence citadel-challenge-active"><span>분노의 적</span><strong data-citadel-fury-state></strong></button><div><p id="citadel-fury-rule"></p><p class="citadel-hub-risk-persistence">선택 즉시 저장 · 해제할 때까지 유지</p></div></div></section><section class="citadel-hub-challenge-details" aria-label="서약 효과 상세"><h3>현재 출격에 적용할 서약</h3><ul data-citadel-challenge-list></ul><p data-citadel-challenge-effects></p><p data-citadel-fury-preview></p><p id="citadel-fury-persistence">선택은 즉시 저장되며 해제할 때까지 개인 캠페인·원정에 유지됩니다. 파티·아레나에는 적용되지 않습니다.</p><p>완료 명성은 클리어 정산에서 계산합니다. 필드 골드·장비와 기본 클리어 보상은 기존 규칙을 따릅니다.</p></section></details>
      </div></div><div class="citadel-hub-destination-footer"><p class="citadel-hub-challenge-notice" role="status" aria-live="polite" hidden></p><p class="citadel-hub-access" role="status" aria-live="polite"></p><div class="citadel-hub-destination-actions"><button type="button" class="citadel-hub-cancel">돌아가기</button><button type="button" class="citadel-hub-go"></button></div></div></div>`;
    this.dialog.querySelectorAll('[data-citadel-depth]').forEach(input => input.addEventListener('change', () => {
      if (!input.checked || this.busy || !this.opened) return;
      this.selectedDepth = input.value; this.challengeNotice = ''; this.refreshDestination();
    }));
    this.dialog.querySelector('.citadel-hub-fury').addEventListener('click', () => this.toggleFury(spot));
    this.dialog.querySelector('.citadel-hub-cancel').addEventListener('click', () => this.close());
    this.dialog.querySelector('.citadel-hub-dismiss').addEventListener('click', () => this.close());
    const goalOpen = this.dialog.querySelector('.citadel-hub-goal-open');
    goalOpen.disabled = typeof this.app.battle?.chronicle?.open !== 'function';
    goalOpen.addEventListener('click', () => {
      if (this.busy || this.app.stageStarting || !this.opened || this.dialogSpot !== spot) return;
      const chronicle = this.app.battle.chronicle, trigger = this.returnFocus;
      this.close(); this.journalFocusCleanup?.();
      const restoreHubFocus = () => {
        // A deferred prior close can arrive after another journal visit opens.
        if (chronicle.dialog.open) return;
        this.journalFocusCleanup?.(); this.journalFocusCleanup = null;
        this.app.syncHub?.();
        if (!this.canReturnFocus(trigger)) return;
        this.update(this.app.hubMovement?.nearest ?? this.nearest, { blocked: !this.app.canWalkHub?.() });
        trigger.focus({ preventScroll: true });
      };
      chronicle.dialog.addEventListener('close', restoreHubFocus);
      this.journalFocusCleanup = () => chronicle.dialog.removeEventListener('close', restoreHubFocus);
      chronicle.open('journal', trigger);
    });
    this.dialog.querySelector('.citadel-hub-go').addEventListener('click', () => this.startDestination(def, spot));
    this.refreshDestination();
  }
  toggleFury(spot = this.dialogSpot) {
    if (this.busy || this.app.stageStarting || !this.opened || !this.dialog.open || this.dialogSpot !== spot) return { ok: false };
    const def = DUNGEONS.find(d => d.id === spot?.route), live = def && citadelPreparation(this.app, def.id, this.selectedDepth);
    if (!live?.ok || !live.challenges.changeAccess.ok) {
      this.challengeNotice = live?.challenges?.changeAccess.error || '출격 준비 상태를 확인해 주세요.';
      this.refreshDestination(); return { ok: false, error: this.challengeNotice };
    }
    // 다른 정비 화면·저장 변경 뒤에는 새 상태를 먼저 보여 주고 다음 선택을 받는다.
    if (this.reviewedPreparation !== preparationSignature(live)) {
      this.challengeNotice = '입장 비용이나 서약이 바뀌었습니다. 새 준비 내용을 확인한 뒤 다시 선택해 주세요.';
      this.refreshDestination(); return { ok: false, error: this.challengeNotice };
    }
    const result = this.app.masterworks.challenge('fury');
    this.challengeNotice = result.ok ? `분노의 적 ${this.app.eco.s.masterworks.challengeIds.includes('fury') ? '활성' : '해제'}를 저장했습니다.${result.storageWarning ? ` ${result.storageWarning}` : ''}`
      : result.error || '서약을 저장하지 못했습니다. 다시 선택해 주세요.';
    this.refreshDestination(); return result;
  }
  async startDestination(def, spot) {
    if (this.busy || this.app.stageStarting || !this.opened || !this.dialog.open || this.dialogSpot !== spot
      || def?.id !== spot?.route || !DUNGEONS.includes(def)) return false;
    const depth = this.selectedDepth, live = citadelPreparation(this.app, def.id, depth);
    if (!live.ok || !live.access.ok) { this.refreshDestination(); return false; }
    if (this.reviewedPreparation !== preparationSignature(live)) {
      this.challengeNotice = '입장 비용이나 서약이 바뀌었습니다. 새 준비 내용을 확인한 뒤 입장해 주세요.';
      this.refreshDestination(); return false;
    }
    this.busy = true; this.close();
    try { return await this.app.startExpedition('dungeon', def.id, { depth }); }
    finally { this.busy = false; }
  }
  refreshDestination() {
    const def = DUNGEONS.find(d => d.id === this.dialogSpot?.route); if (!def || !this.opened) return;
    const preparation = citadelPreparation(this.app, def.id, this.selectedDepth);
    if (!preparation.ok) { this.close(); return; }
    const selected = preparation.definition, access = preparation.access, go = this.dialog.querySelector('.citadel-hub-go');
    this.dialog.dataset.depth = preparation.depth;
    this.dialog.style.setProperty('--citadel-near-accent', selected.accent || def.accent || '#a6d7cc');
    const art = this.dialog.querySelector('.citadel-hub-destination-art');
    art.style.backgroundImage = `url("${def.id === 'glass_garden' && preparation.depth === 'standard' ? '/img/departure-journal/glass-conservatory.webp' : selected.art || def.art}")`;
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
    const objective = this.dialog.querySelector('.citadel-hub-objective');
    objective.textContent = selected.objective || selected.description;
    // 고정 행동 안내가 있는 지역은 같은 목표를 본문에 다시 표시하지 않는다.
    objective.closest('section').hidden = !!preparation.actionCue;
    const tactics = this.dialog.querySelector('.citadel-hub-tactics');
    tactics.hidden = !preparation.mapTactics;
    const mastery = preparation.gardenMastery;
    tactics.textContent = mastery ? `${mastery.label} · ${mastery.approachHint}. 집결: ${mastery.hints.gather}. 방출: ${mastery.hints.release}. 이 방에서 1회 · 장치 곁 F / 전술 버튼(수동) · AUTO는 장치를 사용하지 않음 · 추가 보상 없음.`
      : preparation.mapTactics ? '적을 표시 범위로 유인하세요. AUTO에서는 장치를 사용하지 않으며 추가 보상은 없습니다.' : '';
    const cue = this.dialog.querySelector('.citadel-hub-action-cue');
    cue.hidden = !preparation.actionCue;
    cue.querySelector('[data-citadel-cue-depth]').textContent = `${preparation.depth === 'deep' ? '심층' : '기본'} 원정 · 행동 안내`;
    cue.querySelector('[data-citadel-cue-objective]').textContent = preparation.actionCue?.objective || '';
    cue.querySelector('[data-citadel-cue-action]').textContent = preparation.actionCue?.action || '';
    this.dialog.querySelector('.citadel-hub-rewards').innerHTML = rewardCards(preparation.rewards.base);
    const first = preparation.rewards.firstClear;
    this.dialog.querySelector('.citadel-hub-first-reward').innerHTML = first ? `<strong>첫 심층 클리어 추가 ${first.eligible ? '· 미수령' : '· 수령 완료'}</strong><p>${safe(rewardLabel(first.rewards))}</p>${first.eligible ? '' : '<small>이번 클리어에는 첫 클리어 보상이 추가되지 않습니다.</small>'}` : '';
    const frontier = preparation.frontier;
    this.dialog.querySelector('.citadel-hub-frontier').innerHTML = frontier ? `<h3>이번 주 프론티어 · ${safe(frontier.name)}</h3><p>${safe(frontier.modifier)}</p>` : `<p>${preparation.depth === 'deep' ? '프론티어 효과는 기본 원정에만 적용됩니다.' : '이번 원정에 적용되는 프론티어 효과가 없습니다.'}</p>`;
    this.dialog.querySelector('.citadel-hub-hero p').textContent = `${preparation.hero.name} · 출격 Lv.${preparation.hero.level} · ${preparation.hero.controlLabel}`;
    this.dialog.querySelector('.citadel-hub-hero img').src = HEROES[this.app.eco.s.selected].portrait;
    this.dialog.querySelector('.citadel-hub-potions').innerHTML = preparation.potions.map(potion => `<li data-citadel-potion="${safe(potion.id)}"><img src="${potionArt(potion.id)}" alt="" width="44" height="44"><div><strong>${safe(potion.name)}</strong><span><kbd>${safe(potion.key)}</kbd><b data-citadel-potion-count>${count(potion.count)}개</b></span></div><details><summary>효과</summary><p>${safe(potion.description)}</p></details></li>`).join('');
    const challenges = preparation.challenges, fury = challenges.choices.find(challenge => challenge.id === 'fury');
    const toggle = this.dialog.querySelector('.citadel-hub-fury');
    toggle.disabled = !challenges.changeAccess.ok || this.busy;
    toggle.setAttribute('aria-pressed', String(challenges.furyActive));
    this.dialog.querySelector('[data-citadel-fury-state]').textContent = challenges.furyActive ? '활성 · 해제하기' : '꺼짐 · 켜기';
    this.dialog.querySelector('#citadel-fury-rule').textContent = fury.description;
    const activeNames = challenges.choices.filter(challenge => challenge.active).map(challenge => challenge.name);
    this.dialog.querySelector('#citadel-challenge-active').textContent = `현재 서약 · ${activeNames.join(' · ') || '없음'}`;
    this.dialog.querySelector('[data-citadel-challenge-list]').innerHTML = challenges.choices.map(challenge => `<li data-citadel-challenge="${safe(challenge.id)}" data-active="${challenge.active}"><strong>${safe(challenge.name)} · ${challenge.active ? '활성' : '꺼짐'}</strong><span>${safe(challenge.description)}</span></li>`).join('');
    this.dialog.querySelector('[data-citadel-challenge-effects]').textContent = `현재 합산 · ${challengeEffectsLabel(challenges.effects)}`;
    this.dialog.querySelector('[data-citadel-fury-preview]').textContent = `분노의 적 ${challenges.furyActive ? '해제' : '활성'} 시 · ${challengeEffectsLabel(challenges.afterFuryToggle)}`;
    const notice = this.dialog.querySelector('.citadel-hub-challenge-notice');
    notice.textContent = this.challengeNotice || challenges.changeAccess.error;
    notice.hidden = !notice.textContent;
    const goal = goalCopy(preparation.personalGoal), goalSection = this.dialog.querySelector('.citadel-hub-personal-goal');
    goalSection.dataset.status = goal.status;
    goalSection.querySelector('.citadel-hub-goal-copy').innerHTML = `<h3>${safe(goal.title)}</h3>${goal.condition ? `<p class="citadel-hub-goal-context">${safe(goal.condition)}</p>` : ''}${goal.target ? `<strong class="citadel-hub-goal-target">${safe(goal.target)}</strong>` : ''}${goal.baseline ? `<span class="citadel-hub-goal-baseline">${safe(goal.baseline)}</span>` : ''}<p>${safe(goal.description)}</p><small>개인 목표는 추가 보상을 지급하지 않습니다.</small>`;
    go.disabled = !access.ok || this.busy;
    go.textContent = `${preparation.depth === 'deep' ? '심층 원정 시작' : '원정 시작'} · 에너지 ${access.cost}`;
    this.dialog.querySelector('.citadel-hub-access').textContent = access.error || '입장을 확정하면 에너지가 소모됩니다.';
    this.reviewedPreparation = preparationSignature(preparation);
  }
  close() {
    if (!this.opened && !this.dialog.open) return;
    // Finish state/input cleanup before the native dialog becomes walkable.
    this.opened = false; this.dialogSpot = null; this.reviewedPreparation = null;
    this.app.hubControls?.clear(); this.app.citadelControls?.clear();
    if (this.dialog.open) this.dialog.close();
    this.app.syncHub?.();
    const canWalk = this.visible && this.app.mode === 'lobby' && !this.app.stageStarting &&
      (this.app.canWalkHub?.() ?? !document.querySelector('dialog[open], #modal.show'));
    this.update(this.nearest, { blocked: !canWalk });
    if (this.canReturnFocus(this.returnFocus)) this.returnFocus.focus({ preventScroll: true });
  }
  canReturnFocus(trigger) {
    if (this.app.mode !== 'lobby' || this.app.meta?.tab !== 'home' || !this.app.lobbyVisible || this.busy ||
      this.app.stageStarting || this.opened || this.dialog.open || document.querySelector('dialog[open], #modal.show')) return false;
    if (!trigger?.isConnected || trigger.disabled || trigger.closest('[hidden], [inert]')) return false;
    return trigger.getClientRects().length > 0;
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
