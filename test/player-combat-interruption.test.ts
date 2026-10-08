import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { HEROES } from '../src/data/heroes.js';
import { skillMpCost } from '../src/game/progression.js';
import { contactProfile } from '../src/game/combat-contact.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

function advanceUntil(f: any, ready: () => boolean, dt: number) {
  for (let frame = 0; frame < 600 && !ready(); frame++) stepCombatFlow(f, dt);
  expect(ready()).toBe(true);
}

test('MP가 부족한 스킬 입력은 이미 진행 중인 근접 평타·무기 궤적·자원을 바꾸지 않는다', () => {
  for (const hero of ['knight', 'barbarian', 'rogue']) {
    const f = createCombatFlowFixture(runtime, hero), p: any = f.player, dt = 1 / 120;
    let stops = 0;
    f.game.fx.trail = () => ({ stop: () => { stops++; } });
    p.startCombo(0);
    advanceUntil(f, () => p.canSkillCancel(), dt);
    const trail = p.trail, current = p.current, stateT = p.stateT, cds = [...p.cds];
    p.mp = skillMpCost(p.def.skills[0]) - 1;
    expect(p.mp).toBeGreaterThanOrEqual(0);
    const mp = p.mp;
    f.game.input.press('skill0'); p.handleInput(f.game.input, dt);
    expect(p.state).toBe('attack'); expect(p.current).toBe(current); expect(p.stateT).toBe(stateT);
    expect(p.trail).toBe(trail); expect(stops).toBe(0); expect(p.mp).toBe(mp); expect(p.cds).toEqual(cds);
    // 같은 타격 구간에서 실제 비용을 충족하면 기존 경계대로 한 번만 전환한다.
    p.mp = skillMpCost(p.def.skills[0]);
    f.game.input.press('skill0'); p.handleInput(f.game.input, dt);
    expect(p.state).toBe('skill'); expect(p.trail).not.toBe(trail); expect(stops).toBe(1);
    expect(p.mp).toBe(0); expect(p.cds[0]).toBeGreaterThan(0);
  }
});

test('모든 영웅의 강타 중단은 타격 전 단계를 반복하고 타격을 실행한 단계만 다음 타수로 이어간다', () => {
  for (const hero of Object.keys(HEROES)) for (const committed of [false, true]) {
    for (let index = 0; index < (HEROES as any)[hero].combo.length; index++) {
      const f = createCombatFlowFixture(runtime, hero), p: any = f.player, dt = 1 / 120;
      p.startCombo(index);
      if (committed) {
        advanceUntil(f, () => p.hitDone && p.invuln <= 0, dt);
      } else {
        advanceUntil(f, () => p.stateT + dt >= p.current.dur * p.current.hitAt, dt);
      }
      const hp = p.hp, current = p.current;
      if (p.invuln > 0) {
        // 관통 타격의 기존 무적을 지우고 강타를 강제로 적용하지 않는다.
        expect(p.hurt(20, { dirz: 1, kb: 6 })).toBe(false);
        expect(p.hp).toBe(hp); expect(p.state).toBe('attack'); expect(p.current).toBe(current);
        continue;
      }
      expect(p.hitDone).toBe(committed);
      expect(p.hurt(20, { dirz: 1, kb: 6 })).toBe(true);
      expect(p.state).toBe('hurt'); expect(p.hp).toBeLessThan(hp); expect(p.kb.z).toBe(6);
      const expected = committed ? (index + 1) % p.def.combo.length : index;
      expect(p.comboResume).toEqual({ idx: expected, t: 1.2 });
      advanceUntil(f, () => p.state !== 'hurt', dt);
      f.game.input.press('attack'); stepCombatFlow(f, dt);
      expect(p.state).toBe('attack'); expect(p.comboIdx).toBe(expected); expect(p.comboResume).toBeNull();
    }
  }
});

test('이미 실행한 마무리 뒤 강타는 마무리를 재지급하지 않고 다음 실제 입력에서 첫 타로 돌아간다', () => {
  const f = createCombatFlowFixture(runtime), p: any = f.player, dt = 1 / 60;
  const last = p.def.combo.length - 1;
  p.startCombo(last);
  advanceUntil(f, () => p.hitDone, dt);
  p.hurt(20, { kb: 6 });
  advanceUntil(f, () => p.state !== 'hurt', dt);
  f.game.input.press('attack'); stepCombatFlow(f, dt);
  expect(p.comboIdx).toBe(0); expect(p.current.finisher).not.toBe(true);
});

test('멀티틱 일부·전체 실행 뒤 강타 재개는 회피와 같고 hitDone은 명중 여부가 아닌 실행 여부를 뜻한다', () => {
  for (const hero of Object.keys(HEROES)) {
    const combo = (HEROES as any)[hero].combo;
    for (let index = 0; index < combo.length; index++) {
      if (!combo[index].ticks) continue;
      for (const allTicks of [false, true]) {
        const next: number[] = [];
        for (const interrupt of ['heavy', 'dodge']) {
          const f = createCombatFlowFixture(runtime, hero), p: any = f.player;
          p.startCombo(index);
          advanceUntil(f, () => p.hitDone && (!allTicks || p.ticksLeft === 0), 1 / 120);
          expect(p.hitDone).toBe(true); expect(f.events.hits).toHaveLength(0);
          if (allTicks) expect(p.ticksLeft).toBe(0);
          else expect(p.ticksLeft).toBeGreaterThan(0);
          if (interrupt === 'heavy') expect(p.hurt(20, { kb: 6 })).toBe(true);
          else p.dodge(new Vector3(1, 0, 0));
          next.push(p.comboResume.idx);
        }
        expect(next).toEqual([(index + 1) % combo.length, (index + 1) % combo.length]);
      }
    }
  }
});

test('강타 뒤 1.2초 안의 재개만 보존하며 새 입력·기존 스킬 슈퍼아머·경타 정책은 유지한다', () => {
  const f = createCombatFlowFixture(runtime), p: any = f.player, dt = 1 / 60;
  p.startCombo(2);
  advanceUntil(f, () => p.hitDone, dt);
  p.hurt(20, { kb: 6 });
  for (let i = 0; i < 90; i++) stepCombatFlow(f, dt);
  expect(p.state).toBe('idle'); expect(p.comboResume).toBeNull();
  f.game.input.press('attack'); stepCombatFlow(f, dt);
  expect(p.comboIdx).toBe(0);
  const current = p.current, stateT = p.stateT;
  p.hurt(20, { kb: 3 });
  expect(p.state).toBe('attack'); expect(p.current).toBe(current); expect(p.stateT).toBe(stateT);
  p.state = 'skill'; p.comboResume = null; p.kb.set(0, 0, 0);
  p.hurt(20, { dirx: 1, kb: 6 });
  expect(p.state).toBe('skill'); expect(p.comboResume).toBeNull(); expect(p.kb.x).toBe(6);
});

test('광전사·마법사 반경 마무리의 반격은 실제 피해와 기존 강화량을 유지하며 공통 반격 접촉 신호를 전달한다', () => {
  for (const hero of ['barbarian', 'mage']) for (const counter of [false, true]) {
    const f = createCombatFlowFixture(runtime, hero), p: any = f.player;
    const target = spawnCombatFlowEnemy(f, p.pos.x, p.pos.z + 2, { hp: 100000, maxHp: 100000, stun: 10 });
    const contacts: any[] = [], hitRadius = f.game.hitRadius;
    f.game.hitRadius = function(...args: any[]) { contacts.push(args[3]); return hitRadius.apply(this, args); };
    p.counterWindow = counter ? 2.4 : 0; p.startCombo(p.def.combo.length - 1);
    advanceUntil(f, () => p.hitDone, 1 / 120);
    expect(target.hp).toBeLessThan(100000); expect(contacts).toHaveLength(1);
    const opts = contacts[0];
    expect(opts.source).toBe(p);
    expect(opts).toMatchObject({ counter, finisher: true, basic: true,
      kb: p.current.kb + (counter ? 2 : 0), stun: counter ? .4 : 0 });
    expect(contactProfile(opts, false, false, false)?.tier).toBe(counter ? 'counter' : 'finisher');
    expect(contactProfile(opts, false, false, true)?.stop).toBe(0);
    expect(p.counterWindow).toBe(0);
  }
});
