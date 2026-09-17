/** A run-local, action-earned bridge to existing combat arts. No save or rewards. */
export const COMBO_LINK_WINDOW=3;
export const COMBO_LINK_COOLDOWN=8;
export class ComboLink {
 constructor(){this.seen=new WeakSet();this.ready=null;this.cooldownUntil=0;this.activations=0;}
 arm({token,source,player,enemy,now}){
  if(!token||typeof token!=='object'||this.seen.has(token)||!Number.isFinite(now)||!player?.alive||source!==player||token.owner!==player||token.epoch!==(player.knightLifeEpoch||0))return false;
  this.seen.add(token);if(now<this.cooldownUntil||!enemy?.pos)return false;
  // All targets of a single finishing blow share one token and one deadline.
  this.ready={token,player,epoch:token.epoch,until:now+COMBO_LINK_WINDOW,anchor:enemy.pos.clone(),target:enemy};return true;
 }
 snapshot(now,player){
  const r=this.ready,valid=!!r&&r.player===player&&player?.alive&&r.epoch===(player.knightLifeEpoch||0)&&Number.isFinite(now)&&now<r.until;
  return {ready:valid,remaining:valid?Math.max(0,r.until-now):0,cooldown:Math.max(0,this.cooldownUntil-(Number.isFinite(now)?now:0)),activations:this.activations};
 }
 consume({player,context,now}){
  if(!this.snapshot(now,player).ready||now<this.cooldownUntil||!context?.cast||!context.sk||context.sk.ult||context.sk.awaken)return null;
  const r=this.ready;this.ready=null;
  if(!player.pos||r.anchor.distanceToSquared(player.pos)>144)return null;
  this.cooldownUntil=now+COMBO_LINK_COOLDOWN;this.activations++;return {pos:r.anchor,alive:false,excludeTarget:r.target};
 }
 cancel(){this.ready=null;}
}
