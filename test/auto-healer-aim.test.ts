import { expect, test } from 'bun:test';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

for (const [name, bossZ, healerX, healerZ] of [
  ['보스 무리에서 치유사 우선 전환', 4, 4, 4],
  ['가까운 치유사 자체가 무리 중심인 경우', 5, 2, 3],
] as const) test(`AUTO는 이동 목표와 실제 콤보 조준을 맞춘다: ${name}`, () => {
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player;
  const boss: any = spawnCombatFlowEnemy(f, p.pos.x, p.pos.z + bossZ, { isBoss: true, hp: 1e6, maxHp: 1e6, stun: 60 });
  const healer: any = spawnCombatFlowEnemy(f, p.pos.x + healerX, p.pos.z + healerZ, { behavior: 'shaman', hp: 1e6, maxHp: 1e6, stun: 60 });
  p.auto = true; p.lockTarget = boss;
  for (let i = 0; i < 600 && p.state !== 'attack'; i++) stepCombatFlow(f, 1 / 60);
  expect(p.state).toBe('attack');
  expect(p.lockTarget === healer).toBe(true);
  for (let i = 0; i < 120 && !p.hitDone; i++) stepCombatFlow(f, 1 / 60);
  expect(f.events.hits.some((hit: any) => hit.enemy === healer && hit.basic)).toBe(true);
});
