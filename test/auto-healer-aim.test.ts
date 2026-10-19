import { expect, test } from 'bun:test';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

test('AUTO는 보스 잠금을 치유사로 전환한 뒤 실제 콤보도 치유사에게 명중한다', () => {
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player;
  const boss: any = spawnCombatFlowEnemy(f, p.pos.x, p.pos.z + 4, { isBoss: true, hp: 1e6, maxHp: 1e6, stun: 60 });
  const healer: any = spawnCombatFlowEnemy(f, p.pos.x + 4, p.pos.z + 4, { behavior: 'shaman', hp: 1e6, maxHp: 1e6, stun: 60 });
  p.auto = true; p.lockTarget = boss;
  for (let i = 0; i < 600 && p.state !== 'attack'; i++) stepCombatFlow(f, 1 / 60);
  expect(p.state).toBe('attack');
  expect(p.lockTarget === healer).toBe(true);
  for (let i = 0; i < 120 && !p.hitDone; i++) stepCombatFlow(f, 1 / 60);
  expect(f.events.hits.some((hit: any) => hit.enemy === healer && hit.basic)).toBe(true);
});
