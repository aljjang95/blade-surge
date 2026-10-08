import { expect, test } from 'bun:test';
import { HEROES } from '../src/data/heroes.js';
import { Battle } from '../src/game/battle-base.js';
import { comboFeedback } from '../src/ui/combo-feedback.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();
function advanceUntil(f: any, ready: () => boolean) {
  for (let frame = 0; frame < 600 && !ready(); frame++) stepCombatFlow(f, 1 / 120);
  expect(ready()).toBe(true);
}

test('5영웅의 실제 회피가 보존한 타수만 표시하고 다음 입력이 그 타수로 시작한다', () => {
  for (const hero of Object.keys(HEROES)) for (const hit of [false, true]) {
    const f = createCombatFlowFixture(runtime, hero), p: any = f.player;
    for (let index = 0; index < p.def.combo.length; index++) {
      p.dodgeCd = 0; p.comboResume = null; p.startCombo(index);
      advanceUntil(f, () => p.canDodgeCancel() && p.hitDone === hit);
      f.game.input.press('dodge'); stepCombatFlow(f, 1 / 120);
      expect(p.state).toBe('dodge');
      const next = hit ? (index + 1) % p.def.combo.length : index;
      const before = JSON.stringify({ resume: p.comboResume, buffer: p.attackBufferT, stage: p.comboIdx });
      const view = comboFeedback(f.game);
      expect(view).toMatchObject({ status: 'dodge-resume', label: '회피 중', stage: next + 1,
        total: p.def.combo.length, nextStage: null, counterActive: false });
      expect(view.stageLabel).toBe(`다음 ${next + 1}/${p.def.combo.length}타`);
      expect(view.detail).toContain('회피 후'); expect(view.detail).not.toContain('지금');
      expect(JSON.stringify({ resume: p.comboResume, buffer: p.attackBufferT, stage: p.comboIdx })).toBe(before);
      advanceUntil(f, () => p.state === 'idle');
      expect(comboFeedback(f.game)).toMatchObject({ status: 'resume', label: '이어치기', stage: next + 1 });
      f.game.input.press('attack'); stepCombatFlow(f, 1 / 120);
      expect(p.state).toBe('attack'); expect(p.comboIdx).toBe(next);
      expect(comboFeedback(f.game).status).not.toBe('resume');
    }
  }
});

test('실제 퍼펙트 회피의 마무리 강화 창은 연계 보존과 별개로 줄고 마무리 실행 때 사라진다', () => {
  for (const hero of Object.keys(HEROES)) {
    const f = createCombatFlowFixture(runtime, hero), p: any = f.player;
    f.game.fx.aura = () => {}; f.game.ui.perfectDodge = () => {};
    const last = p.def.combo.length - 1;
    p.startCombo(last); advanceUntil(f, () => p.canDodgeCancel() && !p.hitDone);
    f.game.input.press('dodge'); stepCombatFlow(f, 1 / 120);
    Battle.prototype.onPerfectDodge.call(f.game, p);
    expect(p.counterWindow).toBe(2.4);
    expect(comboFeedback(f.game)).toMatchObject({ status: 'dodge-resume', stage: last + 1,
      counterActive: true, counterSeconds: 2.4, stageLabel: `${last + 1}/${p.def.combo.length}타 · 강화` });
    advanceUntil(f, () => p.state === 'idle');
    expect(comboFeedback(f.game).cue).toContain('연계');
    expect(comboFeedback(f.game).detail).toContain('마무리 강화');
    f.game.input.press('attack'); stepCombatFlow(f, 1 / 120);
    expect(p.comboIdx).toBe(last); expect(comboFeedback(f.game).counterActive).toBe(true);
    advanceUntil(f, () => p.hitDone);
    expect(p.counterWindow).toBe(0); expect(comboFeedback(f.game).counterActive).toBe(false);
  }
});

test('연계가 만료돼도 별도 마무리 강화는 남고 다른 반격 타이머로 강화를 만들지 않는다', () => {
  const f = createCombatFlowFixture(runtime), p: any = f.player;
  p.comboResume = { idx: 3, t: .001 }; p.counterWindow = 2.4;
  expect(comboFeedback(f.game)).toMatchObject({ status: 'resume', stage: 4, cue: '연계 0.1초', stageLabel: '다음 4/6타', counterActive: true });
  stepCombatFlow(f, 1 / 120);
  expect(p.comboResume).toBeNull();
  expect(comboFeedback(f.game)).toMatchObject({ status: 'counter', stage: 0, stageLabel: '마무리 강화', counterActive: true });
  advanceUntil(f, () => p.counterWindow <= 0);
  expect(comboFeedback(f.game).status).toBe('neutral');
  f.game.counterUntil = f.game.elapsed + 3;
  expect(comboFeedback(f.game).counterActive).toBe(false);
});

test('반격 창의 일반 타수는 강화되었다고 표시하지 않고 실제 마무리 타수에만 강화 문구를 붙인다', () => {
  for (const hero of Object.keys(HEROES)) {
    const f = createCombatFlowFixture(runtime, hero), p: any = f.player;
    p.counterWindow = 2.4;
    for (let index = 0; index < p.def.combo.length; index++) {
      p.startCombo(index);
      const view = comboFeedback(f.game);
      expect(view.counterActive).toBe(true);
      expect(view.stageLabel.includes('강화')).toBe(p.current.finisher === true);
      expect(view.detail).toContain('마무리 강화');
    }
  }
});

test('정지·AUTO·기절·사망·입력 차단과 잘못된 연계 인덱스는 이어치기를 약속하지 않는다', () => {
  const f = createCombatFlowFixture(runtime), p: any = f.player;
  for (const state of ['skill', 'ult', 'hurt', 'dead']) {
    p.state = state; p.comboResume = { idx: 3, t: 1 }; p.counterWindow = 2;
    expect(comboFeedback(f.game).status).toBe('neutral');
  }
  p.state = 'idle';
  for (const [target, key, value] of [[f.game, 'paused', true], [f.game, 'active', false], [f.game.input, 'enabled', false],
    [p, 'auto', true], [p, 'alive', false], [p, 'stun', .1]] as const) {
    const previous = target[key]; target[key] = value;
    expect(comboFeedback(f.game).status).toBe('neutral'); target[key] = previous;
  }
  p.counterWindow = 0;
  for (const resume of [{ idx: -1, t: 1 }, { idx: p.def.combo.length, t: 1 }, { idx: 1, t: 0 },
    { idx: 1, t: NaN }, { idx: 1, t: Infinity }, { idx: .5, t: 1 }]) {
    p.comboResume = resume; expect(comboFeedback(f.game).status).toBe('neutral');
  }
});
