/** Contact-derived posture: misses and ambient quiet damage cannot charge a break. */
export function postureHit(enemy, dealt, {finisher=false,kind='slash',quiet=false,breakPower=0} = {}) {
  if (!(dealt > 0) || !enemy.alive || enemy.spawning || quiet) return false;
  if (enemy.breakT > 0) return false;
  const gain = (finisher ? 28 : kind === 'magic' ? 15 : 10) * (1 + Math.max(0,Math.min(.6,breakPower)));
  const limit = enemy.isBoss ? 150 : enemy.isElite ? 110 : 80;
  enemy.postureMax = limit;
  enemy.posture = Math.min(limit, (enemy.posture || 0) + gain);
  enemy.postureDelay = 3;
  if (enemy.posture < limit) return false;
  enemy.posture = 0; enemy.breakT = enemy.isBoss ? 1.3 : 2.2;
  enemy.stun = Math.max(enemy.stun || 0, enemy.breakT);
  enemy.telegraph = 0; enemy.attackDone = true; enemy.state = 'hurt'; enemy.stateT = 0;
  enemy.guardBroken = Math.max(enemy.guardBroken || 0, enemy.breakT);
  return true;
}
export function tickPosture(enemy, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  enemy.breakT = Math.max(0,(enemy.breakT || 0)-dt);
  enemy.postureDelay = Math.max(0,(enemy.postureDelay || 0)-dt);
  if (!enemy.postureDelay && !(enemy.breakT > 0)) enemy.posture = Math.max(0,(enemy.posture || 0)-dt*7);
}
export function applyBuildStats(base, effects = {}) {
  const clamp = (n,min,max) => Math.min(max,Math.max(min,Number.isFinite(n)?n:0));
  const stats = {...base, hp:Math.round(base.hp*(1+clamp(effects.hp,-.2,.8))),
    atk:base.atk*(1+clamp(effects.atk,-.2,.8)), def:base.def*(1+clamp(effects.def,-.2,1)),
    spd:base.spd*(1+clamp(effects.speed,-.1,.3)),crit:Math.min(.75,base.crit+clamp(effects.crit,0,.25))};
  stats.power = Math.floor(stats.atk*6 + stats.hp*.5 + stats.def*4 + stats.crit*1000 + ((stats.critDmg ?? 1.5)-1.5)*500);
  return stats;
}
