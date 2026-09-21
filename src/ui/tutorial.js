import { audio } from '../engine/audio.js';

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
    this.beforeAuto = false;
    this.onNext = () => this.resumeCurrent();
    this.next?.addEventListener('click', this.onNext);
    this.skip?.addEventListener('click', () => this.finish(true));
  }

  begin(stage) {
    const save = this.app.eco.s;
    if (stage?.code !== '1-1' || stage.difficultyId !== 'story' || save.tutorial?.completed || !this.root) return false;
    const battle = this.app.battle;
    this.battle = battle; this.phase = 'attack'; this.beforeAuto = !!battle.player.auto; battle.player.auto = false;
    this.show('attack', true);
    return true;
  }

  show(phase, paused) {
    const data = {
      attack: { n: '01 / 04', title: '첫 칼을 뽑아라', copy: '오른쪽의 공격 버튼을 눌러 기본 콤보를 시작하세요. 키보드는 J 또는 Space입니다.', target: '#btn-attack', button: '전투 시작' },
      dodge: { n: '02 / 04', title: '붉은 예고를 피하라', copy: '적의 공격이 닿기 직전에 회피를 눌러 퍼펙트 회피를 노리세요.', target: '#btn-dodge', button: '회피 연습' },
      skill: { n: '03 / 04', title: '스킬로 무리를 무너뜨려라', copy: '화면 오른쪽의 스킬 중 하나를 눌러 MP를 사용하세요. 궁극기는 게이지가 차면 R로 발동합니다.', target: '#hud .skill-btn[data-skill="0"]', button: '스킬 연습' },
      clear: { n: '04 / 04', title: '방을 정화하면 길이 열린다', copy: '이제 직접 이동하고 공격해 첫 방을 모두 정리하세요. 미니맵의 다음 방을 따라가면 됩니다.', target: null, button: '전투 계속' },
    }[phase];
    if (!data) return;
    this.phase = phase;
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
    if (!this.battle?.active || !this.phase) return;
    const p = this.battle.player;
    if (this.phase === 'attack' && p?.state === 'attack') this.show('dodge', true);
    else if (this.phase === 'dodge' && p?.state === 'dodge') this.show('skill', true);
    else if (this.phase === 'skill' && (p?.state === 'skill' || p?.state === 'ult')) this.show('clear', false);
    else if (this.phase === 'clear' && this.battle.roomsCleared > 0) this.finish(false);
  }

  finish(skipped) {
    if (!this.phase) return;
    const battle = this.battle;
    battle?.setPaused('tutorial', false);
    if (battle?.player) battle.player.auto = this.beforeAuto;
    this.app.eco.s.tutorial = { completed: true };
    this.app.eco.emit();
    document.querySelectorAll('.tutorial-focus').forEach((el) => el.classList.remove('tutorial-focus'));
    this.root.hidden = true; this.phase = null; this.battle = null;
    this.app.ui.toast(skipped ? '튜토리얼을 건너뛰었습니다. 안내서에서 다시 확인할 수 있어요.' : '전투 튜토리얼 완료 · 이제 던전을 정복하세요!', 'gold');
  }

  end() {
    if (this.phase) this.finish(true);
    else if (this.root) this.root.hidden = true;
  }
}
