import { DUNGEONS } from '../data/expansion.js';

export const RIFT_RULES = [
  { id: 'iron', name: '철갑의 균열', description: '적 체력 +25% · 균형 붕괴로 방어를 돌파하세요.', hp: 1.25, atk: 1 },
  { id: 'fury', name: '맹공의 균열', description: '적 공격력 +20% · 공격 경고 뒤 회피와 반격을 노리세요.', hp: 1, atk: 1.2 },
  { id: 'siege', name: '포위의 균열', description: '적 체력 +15% · 공격력 +10% · 좁은 길에서 무리를 나누세요.', hp: 1.15, atk: 1.1 },
];
export const riftForDay = day => RIFT_RULES[((Math.floor(day) % 3) + 3) % 3];
export function riftBonus(dungeonId) {
  const d = DUNGEONS.find(x => x.id === dungeonId);
  return d ? { gold: 200, materials: Object.fromEntries(Object.keys(d.rewards.materials).map(k => [k, 2])) } : {};
}
export function applyRiftStage(stage, ticket) {
  const rule = RIFT_RULES.find(x => x.id === ticket?.riftId);
  if (!rule || stage.expedition?.kind !== 'dungeon' || stage.expedition.id !== ticket.target) return stage;
  return { ...stage, riftId: rule.id, title: `${stage.title} · ${rule.name}`, objective: `${rule.description} ${stage.objective}` };
}
export function applyRiftEnemy(enemy, stage) {
  const rule = RIFT_RULES.find(x => x.id === stage?.riftId);
  if (!enemy || !rule || stage.expedition?.kind !== 'dungeon') return enemy;
  enemy.maxHp = Math.round(enemy.maxHp * rule.hp); enemy.hp = enemy.maxHp; enemy.atk *= rule.atk;
  return enemy;
}
