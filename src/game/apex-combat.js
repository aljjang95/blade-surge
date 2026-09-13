import { impactStrength } from './combat-motion.js';

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

/** One contact policy shared by solo and party attackers. Reduced motion keeps the cue without a freeze. */
export function contactFeedback({finisher=false,crit=false,boss=false,elite=false,reduced=false}={}) {
  const heavy=!!finisher||!!crit;
  return {heavy,recoil:impactStrength({finisher,crit,boss,elite}),
    hitstop:reduced?0:finisher?.09:crit?.055:.035,
    flashSize:reduced?(heavy?1.7:1.25):(heavy?2.5:1.6),
    particles:reduced?0:(heavy?10:5),light:!reduced&&heavy};
}
