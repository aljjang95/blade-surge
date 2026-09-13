import { DUNGEONS } from '../data/expansion.js';

export const RIFT_RULES = [
  { id: 'iron', name: '철갑의 균열', description: '철갑이 피해 45%를 막습니다. 연속타·마무리로 BREAK를 만들고 열린 틈을 공격하세요.', hp: 1, atk: 1 },
  { id: 'fury', name: '맹공의 균열', description: '고정된 붉은 원을 피하면 시전자가 2.5초 BREAK에 빠집니다. 피한 뒤 반격하세요.', hp: 1, atk: 1 },
  { id: 'siege', name: '포위의 균열', description: '금빛 고리의 전령을 5초 안에 처치하세요. 살아남으면 방마다 한 번, 보상 없는 증원 2명이 합류합니다.', hp: 1, atk: 1 },
];
// Dungeon rotates each day; rule rotates every three days: all nine pairs repeat.
export const riftForDay = day => RIFT_RULES[((Math.floor(day / 3) % 3) + 3) % 3];
export function riftBonus(dungeonId) {
  const d = DUNGEONS.find(x => x.id === dungeonId);
  return d ? { gold: 200, materials: Object.fromEntries(Object.keys(d.rewards.materials).map(k => [k, 2])) } : {};
}
export function applyRiftStage(stage, ticket) {
  const rule = RIFT_RULES.find(x => x.id === ticket?.riftId);
  if (!rule || stage.party || stage.expedition?.kind !== 'dungeon' || stage.expedition.id !== ticket.target) return stage;
  return { ...stage, riftId: rule.id, title: `${stage.title} · ${rule.name}`, objective: `${rule.description} ${stage.objective}` };
}
export function applyRiftEnemy(enemy, stage) {
  const rule = RIFT_RULES.find(x => x.id === stage?.riftId);
  if (!enemy || !rule || stage.party || stage.expedition?.kind !== 'dungeon') return enemy;
  if (rule.id === 'iron' && !enemy.riftArmor && typeof enemy.hurt === 'function') {
    enemy.riftArmor = true;
    const hurt = enemy.hurt;
    enemy.hurt = function(damage, options) {
      return hurt.call(this, damage * (this.breakT > 0 ? 1 : .55), options);
    };
  }
  return enemy;
}
