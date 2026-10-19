import { expect, test } from 'bun:test';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();

for (const [name, bossZ, healerX, healerZ, escorts] of [
  ['보스 무리에서 치유사 우선 전환', 4, 4, 4, false],
  ['가까운 치유사 자체가 무리 중심인 경우', 5, 2, 3, false],
  ['가까운 방패병 무리가 더 밀집해도 보스 치유부터 차단', 6, 4, 6, true],
] as const) test(`AUTO는 이동 목표와 실제 콤보 조준을 맞춘다: ${name}`, () => {
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player;
  const boss: any = spawnCombatFlowEnemy(f, p.pos.x, p.pos.z + bossZ, { isBoss: true, hp: 1e6, maxHp: 1e6, stun: 60 });
  const healer: any = spawnCombatFlowEnemy(f, p.pos.x + healerX, p.pos.z + healerZ, { behavior: 'shaman', hp: 1e6, maxHp: 1e6, stun: 60 });
  if (escorts) for (let i = 0; i < 7; i++) spawnCombatFlowEnemy(f, p.pos.x - 3 + (i % 2) * .25, p.pos.z + 1 + Math.floor(i / 2) * .4,
    { behavior: 'shield', hp: 1e6, maxHp: 1e6, stun: 60 });
  p.cds.fill(Infinity);
  p.auto = true; p.lockTarget = boss;
  for (let i = 0; i < 600 && p.state !== 'attack'; i++) stepCombatFlow(f, 1 / 60);
  expect(p.state).toBe('attack');
  expect(p.lockTarget === healer).toBe(true);
  for (let i = 0; i < 120 && !p.hitDone; i++) stepCombatFlow(f, 1 / 60);
  expect(f.events.hits.some((hit: any) => hit.enemy === healer && hit.basic)).toBe(true);
});
