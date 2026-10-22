import { expect, test } from 'bun:test';
import { FEEL, attackBlend, deathStyle, enemyHitReact } from '../src/game/feel.js';
import { attackPhase } from '../src/game/combat-motion.js';
import { HEROES } from '../src/data/heroes.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

test('공격 크로스페이드: 연타는 무기별 짧은 값(다음 타 선딜 안), 회피·대기에서 시작하면 더 길게(접촉 전)', () => {
  const B = FEEL.blend;
  expect(attackBlend('attack', '1h')).toBe(B.chain['1h']);
  expect(attackBlend('attack', 'dual')).toBe(B.chain.dual);
  for (const s of ['idle', 'move', 'dodge', 'hurt', 'skill']) expect(attackBlend(s, '1h')).toBe(B.recover);
  expect(attackBlend('attack', 'unknown')).toBe(B.recover);
  // 섞는 시간이 모든 영웅·모든 타의 선딜(접촉 진행도 × 0.64 × 길이)보다 짧아 접촉 자세가 섞임에 묻히지 않는다.
  for (const hero of Object.values(HEROES) as any[]) for (const c of hero.combo) {
    const windup = c.hitAt * .64 * c.dur;
    expect(attackBlend('attack', hero.weapon)).toBeLessThan(windup + 1e-9);
    // 회복 섞기도 접촉 프레임 전에 끝난다(섞는 동안 클립 진행도가 접촉에 닿지 않는다).
    expect(B.recover).toBeLessThan(c.hitAt * c.dur);
    expect(attackPhase(Math.min(1, B.recover / c.dur), c.hitAt)).toBeLessThan(c.hitAt);
  }
  // 회피 진입은 첫 프레임에 무적·이동이 시작되므로 섞는 시간은 화면 연출이다(0.1초 미만).
  expect(B.dodge).toBeLessThan(.1); expect(B.hurt).toBeLessThan(.1);
});

test('실제 Player: 연타는 연타 페이드, 회피 끝에서 시작한 공격은 회복 페이드로 재생한다', () => {
  const f = createCombatFlowFixture(runtime, 'rogue'), p: any = f.player;
  const fades: number[] = []; const playTimed = p.playTimed;
  p.playTimed = function(name: string, dur: number, opts: any) { fades.push(opts?.fade); return playTimed.call(this, name, dur, opts); };
  p.startCombo(0); p.state = 'attack'; p.startCombo(1);
  p.state = 'dodge'; p.startCombo(0);
  expect(fades).toEqual([FEEL.blend.recover, FEEL.blend.chain.dual, FEEL.blend.recover]);
});

test('적 피격 반응: 경타는 빠른 움찔, 강타·치명타·마무리는 강타 클립을 느리게 + 경직 가산, 재사용 객체', () => {
  const R = FEEL.react;
  const light = enemyHitReact(2, false, false);
  expect(light.key).toBe('hit'); expect(light.speed).toBe(R.lightSpeed); expect(light.stagger).toBeCloseTo(.22 + .06, 9);
  expect(enemyHitReact(5, false, false).key).toBe('hitHeavy');
  const a = enemyHitReact(7, false, false);
  expect(a.key).toBe('hitKnockback');   // kb ≥ knockKb 는 넉백 클립(없으면 hitHeavy → hit 폴백) expect(a.speed).toBe(R.heavySpeed); expect(a.stagger).toBeCloseTo(.22 + .21 + R.heavyHold, 9);
  expect(enemyHitReact(1, true, false).key).toBe('hitHeavy');
  expect(enemyHitReact(1, false, true).key).toBe('hitHeavy');
  expect(enemyHitReact(100).stagger).toBeCloseTo(R.base + R.kbCap + R.heavyHold, 9);
  expect(enemyHitReact(NaN).stagger).toBeCloseTo(R.base, 9);
  expect(enemyHitReact(2)).toBe(enemyHitReact(7));   // 군중 타격에서 매번 새 객체를 만들지 않는다
  // 실제 Enemy.hurt: 강타는 강타 키(리그 폴백) 재생 + 늘어난 경직
  const f = createCombatFlowFixture(runtime, 'knight');
  const e: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 2, { hp: 1e6, maxHp: 1e6 });
  e.state = 'chase'; e.hurt(10, { kb: 7, dirz: 1 });
  expect(e.state).toBe('hurt'); expect(e.stagger).toBeCloseTo(.22 + .21 + R.heavyHold, 9);
  e.state = 'chase'; e.hurt(10, { kb: 2, dirz: 1 });
  expect(e.stagger).toBeCloseTo(.28, 9);
});

test('사망 변주: 결정적, 공격자를 향해 돌아서고 등급별 박자, 방향이 없으면 그대로', () => {
  const D = FEEL.death;
  // 남쪽(+z)으로 밀려나는 타격 → 공격자는 북쪽(-z) → 시체가 바라볼 방향 yaw = atan2(0,-1) = π
  const s = deathStyle({ dirx: 0, dirz: 1, kb: 2 });
  expect(Math.abs(s.faceYaw!)).toBeCloseTo(Math.PI, 9); expect(s.speed).toBe(D.normal);
  expect(deathStyle({ dirx: 1, dirz: 0 }).faceYaw).toBeCloseTo(-Math.PI / 2, 9);
  expect(deathStyle({ dirx: 0, dirz: 0 }).faceYaw).toBeNull();
  expect(deathStyle({ dirx: 1, finisher: true }).speed).toBe(D.snap);
  expect(deathStyle({ dirx: 1, crit: true }).speed).toBe(D.snap);
  expect(deathStyle({ dirx: 1, kb: 6 }).speed).toBe(D.snap);
  expect(deathStyle({ dirx: 1, elite: true, finisher: true }).speed).toBe(D.heavy);
  expect(deathStyle({ dirx: 1, boss: true }).speed).toBe(D.heavy);
  expect(deathStyle({ dirx: .3, dirz: -.7, kb: 3 })).toEqual(deathStyle({ dirx: .3, dirz: -.7, kb: 3 }));
});

test('실제 Enemy.kill: 판정 방향은 즉시 공격자 쪽, 보이는 몸은 렌더 피벗에서 짧게 따라 돈다(난수 소비는 기존 사망 클립 선택과 같다)', () => {
  const f = createCombatFlowFixture(runtime, 'knight');
  const e: any = spawnCombatFlowEnemy(f, f.room.x, f.room.z + 2, { hp: 5, maxHp: 5 });
  e.yaw = 0;   // 공격자에게 등을 보인 채(+z 를 봄) 북쪽에서 온 타격으로 쓰러진다
  const count = (fn: () => void) => { const rnd = Math.random; let calls = 0; Math.random = () => { calls++; return .5; }; try { fn(); } finally { Math.random = rnd; } return calls; };
  const twin: any = spawnCombatFlowEnemy(f, f.room.x + 3, f.room.z + 2, { hp: 5, maxHp: 5 });
  // 방향이 없는 처치(변주 없음)와 방향이 있는 처치의 난수 소비가 같다.
  expect(count(() => e.kill(0, 1, 2, null))).toBe(count(() => twin.kill(0, 0, 2, null)));
  expect(Math.abs(e.yaw)).toBeCloseTo(Math.PI, 9);
  expect(Math.abs(e._deathTurn)).toBeCloseTo(Math.PI, 6);
  let prev = Math.abs(e._deathTurn);
  for (let i = 0; i < 30; i++) { e.updateCombatPose(1 / 60); expect(Math.abs(e._deathTurn)).toBeLessThanOrEqual(prev); prev = Math.abs(e._deathTurn); }
  expect(e._deathTurn).toBe(0);
  // 동작 줄이기: 렌더 회전 없이 바로 판정 방향
  const g = createCombatFlowFixture(runtime, 'knight'); g.game.app.reducedMotion.matches = true;
  const r: any = spawnCombatFlowEnemy(g, g.room.x, g.room.z + 2, { hp: 5, maxHp: 5 });
  r.kill(1, 0, 2, null); r.updateCombatPose(1 / 60); expect(r._deathTurn).toBe(0);
});
