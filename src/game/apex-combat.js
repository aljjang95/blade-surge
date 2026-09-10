const HEAVY = new Set(['spin','slam','dash','fan','soulrain']);
export const RECOVERY_POSTURE = 15;
export function isRecoveryOpportunity(enemy) {
  return !!(enemy?.alive && !enemy.spawning && (enemy.isBoss || enemy.isElite) &&
    enemy.state==='attack' && enemy.attackDone && HEAVY.has(enemy.special) &&
    enemy.attackSequence>0 && enemy.completedAttackSequence===enemy.attackSequence &&
    !(enemy.telegraph>0) && !(enemy.stun>0) && !(enemy.breakT>0) &&
    enemy.stateT>=enemy.attackDur*enemy.hitAt && enemy.stateT<enemy.attackDur);
}
export function longestRegularCooldown(player) {
  let chosen=-1, longest=0;
  for(const [i,skill] of (player?.def?.skills||[]).entries()) {
    const remaining=player.cds?.[i];
    if(!skill.ult && !skill.awaken && !skill.unlock && Number.isFinite(remaining) && remaining>longest) {chosen=i;longest=remaining;}
  }
  return chosen;
}
