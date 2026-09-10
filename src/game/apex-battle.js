import { Battle as MasterworksBattle } from './masterworks-battle.js';
import { postureHit } from './masterworks-combat.js';
import { COMBAT_ARTS } from '../data/combat-arts.js';
import { RECOVERY_POSTURE, isRecoveryOpportunity, longestRegularCooldown } from './apex-combat.js';
import { audio } from '../engine/audio.js';

export class Battle extends MasterworksBattle {
  async start(...args) { await super.start(...args); this.bindCombatArt(); }
  bindCombatArt() {
    const selected=this.app.arsenal?.artForHero(this.heroId);
    const art=COMBAT_ARTS.find(a=>a.id===(typeof selected==='string'?selected:selected?.id));
    this.apex={art:this.run?.enabled&&this.stage?.expedition?.kind!=='arena'?art:null,
      recovery:new WeakMap(),breaks:new WeakMap(),procCount:0,procUntil:0,shield:0,shieldUntil:0};
  }
  apexEnabled() { return !!(this.apex?.art && this.run?.enabled && !this.run.settled && this.active && this.player?.alive && this.stage?.expedition?.kind!=='arena'); }
  stop() { this.apex=null; super.stop(); }
  settleChronicle(outcome) { if(this.apex) {this.apex.shield=0;this.apex.shieldUntil=0;} super.settleChronicle(outcome); }
  damageEnemy(enemy,dmg,opts={}) {
    if(!this.apex || !this.apexEnabled?.() || this.paused || opts.apexProc) return super.damageEnemy(enemy,dmg,opts);
    const direct=!!opts.finisher&&!opts.quiet&&!opts.masterworksProc;
    const before=enemy?.hp||0, broken=enemy?.breakT>0;
    const sequence=enemy?.attackSequence;
    const opportunity=direct&&isRecoveryOpportunity(enemy)&&this.apex.recovery.get(enemy)!==sequence;
    const token=enemy&&(this.apex.breaks.get(enemy)||{generation:0,consumed:false});
    super.damageEnemy(enemy,dmg,opts);
    if(!this.apexEnabled() || !(before-(enemy?.hp||0)>0)) return;
    if(opportunity && enemy.alive && !(enemy.breakT>0)) {
      this.apex.recovery.set(enemy,sequence);
      // Magic contact contributes exactly 15 posture, using the existing break contract.
      if(postureHit(enemy,1,{kind:'magic'})) {this.run.breaks++;this.fx.damage(enemy.pos,0,{text:'BREAK'});}
      this.fx.damage(enemy.pos,0,{text:'후딜 공략'});
      audio.play('hit_plate',{vol:.35});
      this.ui.toast(`후딜 공략 · 균형 피해 +${RECOVERY_POSTURE}`,'gold');
    }
    if(!broken && enemy.breakT>0) {token.generation++;token.consumed=false;}
    this.apex.breaks.set(enemy,token);
    if(direct && broken && !token.consumed) {
      token.consumed=true; // Reserve before damage callbacks to prevent recursive activation.
      this.activateCombatArt(enemy);
    }
  }
  activateCombatArt(enemy) {
    if(!this.apexEnabled()) return;
    const a=this.apex,art=a.art,p=this.player;
    a.procCount++;a.procUntil=this.elapsed+1.4;
    this.fx.shockTex(enemy.pos,art.id==='rupture'?0xffac70:art.id==='aegis'?0x80d8ff:0x9fffc8,{r1:art.id==='rupture'?art.radius:2.5,life:.35});
    this.fx.damage(enemy.pos,0,{text:art.name});
    audio.play('ui_glass',{vol:.4});
    if(art.id==='rupture') {
      const targets=this.enemies.filter(e=>e!==enemy&&e.alive&&!e.spawning&&e.pos.distanceToSquared(enemy.pos)<=art.radius**2)
        .sort((x,y)=>x.pos.distanceToSquared(enemy.pos)-y.pos.distanceToSquared(enemy.pos)).slice(0,art.targets);
      for(const e of targets) this.damageEnemy(e,p.atk*art.damage,{kind:'magic',kb:art.push,dirx:e.pos.x-enemy.pos.x,dirz:e.pos.z-enemy.pos.z,noProc:true,quiet:true,masterworksProc:true,apexProc:true});
    } else if(art.id==='aegis') { a.shield=p.maxHp*art.shield;a.shieldUntil=this.elapsed+art.duration; }
    else if(art.id==='flow') {const i=longestRegularCooldown(p);if(i>=0)p.cds[i]=Math.max(0,p.cds[i]-art.seconds);}
    this.ui.toast(`${art.name} · 전투 기예 발동`,'gold');
  }
  absorbDamage(amount) {
    // Player.hurt already routes every mitigated hit here. Keep this timed shield
    // separate from room shields so expiration cannot erase someone else's shield.
    if(this.apexEnabled() && this.elapsed<this.apex.shieldUntil) {
      const absorbed=Math.min(this.apex.shield,amount);this.apex.shield-=absorbed;amount-=absorbed;
    }
    return super.absorbDamage(amount);
  }
  update(dt) {super.update(dt);if(this.apex && this.elapsed>=this.apex.shieldUntil)this.apex.shield=0;}
  getApexSnapshot() {
    const a=this.apex,enabled=this.apexEnabled();
    const recovery=enabled?this.enemies.find(e=>isRecoveryOpportunity(e)&&a.recovery.get(e)!==e.attackSequence):null;
    const ready=enabled&&this.enemies.some(e=>e.alive&&e.breakT>0&&!a.breaks.get(e)?.consumed);
    const procRemaining=enabled?Math.max(0,a.procUntil-this.elapsed):0;
    return {enabled,artId:a?.art?.id||null,artName:a?.art?.name||'',description:a?.art?.description||'',
      state:!enabled?'disabled':procRemaining>0?'proc':ready?'ready':'waiting',ready,procCount:a?.procCount||0,procRemaining,
      shield:enabled&&this.elapsed<a.shieldUntil?a.shield:0,recoveryTarget:recovery?{name:recovery.def?.name||recovery.type,sequence:recovery.attackSequence,remaining:Math.max(0,recovery.attackDur-recovery.stateT)}:null};
  }
}
