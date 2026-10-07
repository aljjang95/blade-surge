import { audio } from '../engine/audio.js';
import './tutorial.css';

const STEPS = ['attack', 'dodge', 'skill', 'clear'];
const TIPS = {
  attack: { n: '1 / 4', title: '공격과 콤보', copy: '공격 버튼 · J/Space로 공격. “다시 누르기”가 보이면 한 번 더 눌러 다음 타를 잇습니다.', target: '#btn-attack' },
  dodge: { n: '2 / 4', title: '붉은 예고에서 벗어나기', copy: '회피 버튼 · K/Shift로 피하세요. 적의 공격 직전 회피하면 퍼펙트 회피가 됩니다.', target: '#btn-dodge' },
  skill: { n: '3 / 4', title: '스킬로 무리 상대하기', copy: '오른쪽 스킬 버튼 · 1~3/R. MP·쿨타임·궁극기 게이지가 준비된 스킬을 쓰세요.', target: '#hud .skill-btn[data-skill="0"]' },
  clear: { n: '4 / 4', title: '미니맵을 따라 정화하기', copy: '방을 정화하면 다음 길이 열립니다. 체력은 빨간 물약, 어려우면 상단 AUTO로 보조하세요.', target: null },
};

export function nextHealHintTier(hp, maxHp, shownTier = 0) {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
  const ratio = hp / maxHp;
  const tier = ratio <= .3 ? 2 : ratio <= .55 ? 1 : 0;
  return tier > shownTier ? tier : 0;
}

/** 전투를 멈추지 않는 조작 안내. 입력·AUTO·일시정지의 소유권은 기존 전투에 둔다. */
export class BattleTutorial {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('battle-tutorial');
    this.title = document.getElementById('tutorial-title');
    this.copy = document.getElementById('tutorial-copy');
    this.stepLabel = document.getElementById('tutorial-step');
    this.next = document.getElementById('tutorial-next');
    this.skip = document.getElementById('tutorial-skip');
    this.card = this.root?.querySelector('.tutorial-card');
    this.toggle = document.createElement('button');
    this.toggle.id = 'tutorial-toggle'; this.toggle.className = 'tutorial-toggle'; this.toggle.type = 'button';
    this.toggle.setAttribute('aria-controls', 'tutorial-panel');
    if (this.card) { this.card.id = 'tutorial-panel'; this.root.prepend(this.toggle); }
    this.phase = null;
    this.completedSteps = new Set();
    this.expanded = false;
    this.reviewing = false;
    this.expandUntil = 0;
    this.highlightTarget = null;
    this.healTipLevel = 0;
    this.healTipUntil = 0;
    this.healTipButton = null;
    this.healTipPotionCount = null;
    this.healHintStatus = document.createElement('span');
    this.healHintStatus.className = 'heal-hint-live';
    this.healHintStatus.setAttribute('role', 'status');
    this.healHintStatus.setAttribute('aria-live', 'polite');
    this.healHintAlert = document.createElement('span');
    this.healHintAlert.className = 'heal-hint-live';
    this.healHintAlert.setAttribute('role', 'alert');
    document.getElementById('hud')?.append(this.healHintStatus, this.healHintAlert);
    this.onHealPotionClick = () => this.clearHealTip();
    this.onNext = () => this.nextTip();
    this.next?.addEventListener('click', this.onNext);
    this.skip?.addEventListener('click', () => this.finish(true));
    this.toggle.addEventListener('click', () => { this.setExpanded(!this.expanded); this.restorePlayFocus(); });
    this.renderExpansion();
  }

  begin(stage) {
    this.end();
    const save = this.app.eco.s;
    if (stage?.code === '1-1' && stage.difficultyId === 'story') { this.healTipLevel = 0; this.clearHealTip(); }
    if (this.skipOnceForAutoRetry) {
      this.skipOnceForAutoRetry = false;
      this.phase = null; this.battle = null; if (this.root) this.root.hidden = true;
      document.querySelectorAll('.tutorial-focus').forEach((el) => el.classList.remove('tutorial-focus'));
      return false;
    }
    if (stage?.code !== '1-1' || stage.difficultyId !== 'story' || !this.root) return false;
    const battle = this.app.battle;
    if (!battle?.active || !battle.player?.alive) return false;
    this.battle = battle; this.reviewing = !!save.tutorial?.completed;
    if (!this.reviewing) this.show('attack');
    this.syncVisibility();
    return !this.reviewing;
  }

  show(phase) {
    const data = TIPS[phase];
    if (!data) return;
    this.phase = phase;
    if (this.expanded && !this.reviewing && !this.completedSteps.has(phase)) {
      this.completedSteps.add(phase);
      this.app.funnel?.track('tutorial_step', { step: this.completedSteps.size });
    }
    this.stepLabel.textContent = data.n; this.title.textContent = data.title; this.copy.textContent = data.copy;
    this.next.textContent = phase === 'clear' ? '안내 닫기' : '다음 안내'; this.next.hidden = false;
    this.skip.textContent = '그만 보기';
    this.syncVisibility(); this.renderHighlight();
  }

  // 이전 호출 경계도 입력을 초기화하거나 다른 화면의 정지를 해제하지 않는다.
  resumeCurrent() {
    if (!this.battle?.active || this.battle.paused) return;
    audio.play('ui_click', { vol: 0.4 });
    this.setExpanded(false); this.restorePlayFocus();
  }

  nextTip() {
    if (!this.battle?.active || this.battle.paused) return;
    if (this.phase === 'clear') { this.finish(true); return; }
    this.show(STEPS[STEPS.indexOf(this.phase) + 1] || 'attack');
    this.restorePlayFocus();
  }

  setExpanded(on) {
    if (on && (!this.battle?.active || this.battle.paused)) return;
    if (!on) this.restorePlayFocus();
    this.expanded = !!on;
    if (on) this.show(this.phase || 'attack');
    this.expandUntil = on ? this.battle.elapsed + 8 : 0;
    this.renderExpansion(); this.renderHighlight();
  }

  renderExpansion() {
    if (this.card) this.card.hidden = !this.expanded;
    if (this.toggle) {
      this.toggle.textContent = this.expanded ? '안내 접기' : '조작 안내 보기';
      this.toggle.setAttribute('aria-expanded', String(!!this.expanded));
    }
    this.root?.classList?.remove('waiting');
  }

  renderHighlight() {
    this.highlightTarget?.classList.remove('tutorial-focus'); this.highlightTarget = null;
    if (this.expanded && !this.root.hidden && TIPS[this.phase]?.target) {
      this.highlightTarget = document.querySelector(TIPS[this.phase].target);
      this.highlightTarget?.classList.add('tutorial-focus');
    }
  }

  syncVisibility() {
    if (!this.root) return;
    const hidden = !this.battle?.active || this.battle !== this.app.battle || this.battle.paused;
    if (this.root.hidden !== hidden) { this.root.hidden = hidden; this.renderHighlight(); }
  }

  restorePlayFocus() {
    // 안내 버튼에만 걸린 초점을 돌린다. 다른 모달·정지 화면의 초점은 건드리지 않는다.
    if (this.battle?.active && !this.battle.paused && this.battle === this.app.battle && this.app.mode === 'battle'
      && !document.hidden && this.root?.contains?.(document.activeElement)) this.app.canvas?.focus({ preventScroll: true });
  }

  update() {
    this.updateHealTip();
    this.syncVisibility();
    if (!this.battle?.active || this.battle.paused) return;
    if (this.expanded && this.battle.elapsed >= this.expandUntil) { this.setExpanded(false); this.restorePlayFocus(); }
    if (!this.phase) return;
    if (this.battle.roomsCleared > 0 && !this.reviewing) { this.finish(false); return; }
    const p = this.battle.player;
    if (this.phase === 'attack' && p?.state === 'attack') this.show('dodge');
    else if (this.phase === 'dodge' && p?.state === 'dodge') this.show('skill');
    else if (this.phase === 'skill' && (p?.state === 'skill' || p?.state === 'ult')) this.show('clear');
  }

  clearHealTip() {
    const potion = this.healTipButton || document.querySelector?.('.exp-potions [data-potion="hp_tonic"]');
    potion?.classList.remove('tutorial-focus');
    potion?.removeEventListener?.('click', this.onHealPotionClick);
    potion?.removeAttribute?.('aria-description');
    if (potion?.parentElement?.dataset) { delete potion.parentElement.dataset.healHint; delete potion.parentElement.dataset.healTier; }
    if (this.healHintStatus) this.healHintStatus.textContent = '';
    if (this.healHintAlert) this.healHintAlert.textContent = '';
    this.healTipButton = null;
    this.healTipPotionCount = null;
    this.healTipUntil = 0;
  }

  updateHealTip() {
    const battle = this.app.battle, player = battle?.player;
    const currentCount = Number(this.healTipButton?.querySelector?.('b')?.textContent);
    const potionUsed = this.healTipPotionCount !== null && Number.isFinite(currentCount) && currentCount < this.healTipPotionCount;
    if (this.healTipUntil && (performance.now() >= this.healTipUntil || !battle?.active || battle.paused || !player?.alive || player.hp / player.maxHp > .55 || potionUsed || document.querySelector?.('#modal.show, #masterworks[open]') || this.healTipButton?.disabled)) this.clearHealTip();
    if (this.phase && this.expanded || !battle?.active || battle.paused || !player?.alive || battle.stage?.code !== '1-1' || battle.stage?.difficultyId !== 'story') return;
    const tier = nextHealHintTier(player.hp, player.maxHp, this.healTipLevel);
    if (!tier || document.querySelector?.('#modal.show, #masterworks[open]')) return;
    const potion = document.querySelector?.('.exp-potions [data-potion="hp_tonic"]');
    if (!potion || potion.disabled || !potion.parentElement?.dataset) return;
    this.clearHealTip();
    this.healTipLevel = tier;
    this.healTipUntil = performance.now() + 8000;
    this.healTipButton = potion;
    const available = Number(potion.querySelector?.('b')?.textContent);
    this.healTipPotionCount = Number.isFinite(available) ? available : null;
    potion.classList.add('tutorial-focus');
    potion.addEventListener('click', this.onHealPotionClick, { once: true });
    potion.setAttribute('aria-description', tier === 2 ? '체력이 매우 낮습니다. 빨간 물약을 눌러 즉시 회복하세요.' : '체력이 낮을 때 누르면 체력이 회복됩니다.');
    potion.parentElement.dataset.healHint = tier === 2 ? '위험! 지금 빨간 물약으로 회복' : '체력 낮음! 빨간 물약 누르기';
    potion.parentElement.dataset.healTier = tier === 2 ? 'critical' : 'early';
    if (tier === 2 && this.healHintAlert) this.healHintAlert.textContent = potion.parentElement.dataset.healHint;
    if (tier === 1 && this.healHintStatus) this.healHintStatus.textContent = potion.parentElement.dataset.healHint;
    this.app.funnel?.track('heal_hint_shown', { tier: potion.parentElement.dataset.healTier });
  }

  finish(skipped) {
    if (!this.phase) return;
    const battle = this.battle;
    // 남아 있는 옛 안내 소유 정지만 해제하며 실제 AUTO와 다른 정지 소유자는 보존한다.
    if (battle?.pauseReasons?.has('tutorial')) battle.setPaused('tutorial', false);
    const firstCompletion = !this.app.eco.s.tutorial?.completed;
    if (firstCompletion) {
      this.app.eco.s.tutorial = { ...this.app.eco.s.tutorial, completed: true };
      this.app.eco.emit();
      this.app.funnel?.track('tutorial_complete', { steps: this.completedSteps?.size || 0, skipped: !!skipped });
    }
    document.querySelectorAll('.tutorial-focus').forEach((el) => el.classList.remove('tutorial-focus'));
    this.clearHealTip();
    this.restorePlayFocus();
    this.phase = null; this.reviewing = true; this.expanded = false; this.expandUntil = 0; this.completedSteps?.clear();
    this.renderExpansion(); this.syncVisibility(); this.restorePlayFocus();
  }

  end() {
    this.clearHealTip();
    if (this.battle?.pauseReasons?.has('tutorial')) this.battle.setPaused('tutorial', false);
    this.restorePlayFocus();
    document.querySelectorAll('.tutorial-focus').forEach(el => el.classList.remove('tutorial-focus'));
    this.phase = null; this.battle = null; this.expanded = false; this.expandUntil = 0; this.completedSteps?.clear();
    if (this.root) this.root.hidden = true;
    this.renderExpansion();
  }
}
