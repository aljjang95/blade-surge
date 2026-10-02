import { audio } from '../engine/audio.js';

export function nextHealHintTier(hp, maxHp, shownTier = 0) {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
  const ratio = hp / maxHp;
  const tier = ratio <= .3 ? 2 : ratio <= .55 ? 1 : 0;
  return tier > shownTier ? tier : 0;
}

/** 첫 전투에서 실제 버튼을 눌러 배우는 짧은 온보딩. 안내서와 별개로 전투 입력을 요구한다. */
export class BattleTutorial {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('battle-tutorial');
    this.title = document.getElementById('tutorial-title');
    this.copy = document.getElementById('tutorial-copy');
    this.stepLabel = document.getElementById('tutorial-step');
    this.next = document.getElementById('tutorial-next');
    this.skip = document.getElementById('tutorial-skip');
    this.phase = null;
    this.completedSteps = new Set();
    this.beforeAuto = false;
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
    this.onNext = () => this.resumeCurrent();
    this.next?.addEventListener('click', this.onNext);
    this.skip?.addEventListener('click', () => this.finish(true));
  }

  begin(stage) {
    const save = this.app.eco.s;
    if (stage?.code === '1-1' && stage.difficultyId === 'story') { this.healTipLevel = 0; this.clearHealTip(); }
    if (this.skipOnceForAutoRetry) {
      this.skipOnceForAutoRetry = false;
      this.phase = null; this.battle = null; if (this.root) this.root.hidden = true;
      document.querySelectorAll('.tutorial-focus').forEach((el) => el.classList.remove('tutorial-focus'));
      return false;
    }
    if (stage?.code !== '1-1' || stage.difficultyId !== 'story' || save.tutorial?.completed || !this.root) return false;
    const battle = this.app.battle;
    this.battle = battle; this.phase = 'attack'; this.beforeAuto = !!battle.player.auto; battle.player.auto = false;
    document.getElementById('btn-auto')?.classList.toggle('on', false);
    this.show('attack', true);
    return true;
  }

  show(phase, paused) {
    const data = {
      attack: { n: '01 / 04', title: '첫 칼을 뽑아라', copy: '공격을 누르고, 타격이 닿은 직후 다시 눌러 콤보를 이어가세요. 길게 누르기만 해서는 이어지지 않아요. 키보드는 J 또는 Space입니다.', target: '#btn-attack', button: '전투 시작' },
      dodge: { n: '02 / 04', title: '붉은 예고를 피하라', copy: '적의 공격이 닿기 직전에 회피를 눌러 퍼펙트 회피를 노리세요.', target: '#btn-dodge', button: '회피 연습' },
      skill: { n: '03 / 04', title: '스킬로 무리를 무너뜨려라', copy: '화면 오른쪽의 스킬 중 하나를 눌러 MP를 사용하세요. 궁극기는 게이지가 차면 R로 발동합니다.', target: '#hud .skill-btn[data-skill="0"]', button: '스킬 연습' },
      clear: { n: '04 / 04', title: '방을 정화하면 길이 열린다', copy: '미니맵을 따라 방을 정리하세요. 체력이 줄면 빨간 물약을 누르세요. 수동 조작이 어렵다면 상단 AUTO를 켤 수 있습니다. 각인 창에서는 하나를 고르세요.', target: null, button: '전투 계속' },
    }[phase];
    if (!data) return;
    this.phase = phase;
    if (!this.completedSteps.has(phase)) {
      this.completedSteps.add(phase);
      this.app.funnel?.track('tutorial_step', { step: this.completedSteps.size });
    }
    this.app.battle?.setPaused('tutorial', paused);
    this.root.hidden = false; this.root.classList.toggle('waiting', paused);
    this.stepLabel.textContent = data.n; this.title.textContent = data.title; this.copy.textContent = data.copy; this.next.textContent = data.button;
    document.querySelectorAll('.tutorial-focus').forEach((el) => el.classList.remove('tutorial-focus'));
    if (data.target) document.querySelector(data.target)?.classList.add('tutorial-focus');
    this.next.hidden = !paused;
  }

  resumeCurrent() {
    if (!this.battle?.active) return;
    audio.play('ui_click', { vol: 0.4 });
    this.battle.setPaused('tutorial', false);
    this.root.classList.remove('waiting'); this.next.hidden = true;
  }

  update() {
    this.updateHealTip();
    if (!this.battle?.active || !this.phase) return;
    const p = this.battle.player;
    if (this.phase === 'attack' && p?.state === 'attack') this.show('dodge', true);
    else if (this.phase === 'dodge' && p?.state === 'dodge') this.show('skill', true);
    else if (this.phase === 'skill' && (p?.state === 'skill' || p?.state === 'ult')) this.show('clear', false);
    else if (this.phase === 'clear' && this.battle.roomsCleared > 0) this.finish(false);
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
    if (this.phase || !battle?.active || battle.paused || !player?.alive || battle.stage?.code !== '1-1' || battle.stage?.difficultyId !== 'story') return;
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
    battle?.setPaused('tutorial', false);
    const preference = this.app.journey?.s.autoBattle;
    const auto = typeof preference === 'boolean' ? preference : this.beforeAuto;
    if (battle?.player) battle.player.auto = auto;
    this.app._auto = auto;
    document.getElementById('btn-auto')?.classList.toggle('on', auto);
    this.app.eco.s.tutorial = { completed: true };
    this.app.eco.emit();
    this.app.funnel?.track('tutorial_complete', { steps: this.completedSteps?.size || 0, skipped: !!skipped });
    document.querySelectorAll('.tutorial-focus').forEach((el) => el.classList.remove('tutorial-focus'));
    this.clearHealTip();
    this.root.hidden = true; this.phase = null; this.battle = null; this.completedSteps?.clear();
    this.app.ui.toast(skipped ? '튜토리얼을 건너뛰었습니다. 안내서에서 다시 확인할 수 있어요.' : '전투 튜토리얼 완료 · 이제 던전을 정복하세요!', 'gold');
  }

  end() {
    this.clearHealTip();
    if (this.phase) this.finish(true);
    else if (this.root) this.root.hidden = true;
  }
}
