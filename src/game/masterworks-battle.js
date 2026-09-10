import { Battle as RpgBattle } from './rpg-battle.js';
import { MasterworksService } from './masterworks-service.js';
import { MasterworksView } from '../ui/masterworks.js';
import { BOONS, STORY_EVENTS } from '../data/masterworks.js';
import { boonChoices, boonEffects, masteryEffects, difficultyEffects, recordProgress, recordDiscovery, grantRenown, resolveStory } from './masterworks-core.js';
import { applyBuildStats, postureHit, tickPosture } from './masterworks-combat.js';
import { audio } from '../engine/audio.js';
import { applyRiftEnemy } from './journey-rifts.js';

export class Battle extends RpgBattle {
  constructor(app) {
    super(app);
    this.masterworks = new MasterworksService(app); app.masterworks = this.masterworks;
    this.chronicle = new MasterworksView(app, this);
    app.eco.onChange(() => this.chronicle.refresh());
  }
  async start(...args) {
    await super.start(...args);
    const ticket = this.masterworks.transact(s => { s.runSeq++; return {ok:true,id:s.runSeq}; }, {duringBattle:true});
    if (!ticket.ok) throw new Error(ticket.error);
    const s = this.masterworks.s;
    this.run = {id:ticket.id,picked:[],round:0,queue:[],storySeen:false,settled:false,renown:0,perfects:0,breaks:0,
      enabled:this.stage.expedition?.kind !== 'arena', challenges:[...s.challengeIds], permanent:masteryEffects(s)};
    this.run.difficulty = difficultyEffects(this.run.enabled ? this.run.challenges : []);
    this.buildBase = {...this.player.stats}; this.effects = {}; this.applyBuild();
    this.runKills = new WeakSet(); this.counterUntil = 0; this.chainUntil = 0;
    this.after(1.4, () => { if (this.run?.enabled && this.active) { this.queueBoon(); this.chronicle.offer(); } });
    this.chronicle.refresh();
  }
  stop() { this.chronicle?.close(); super.stop(); this.run = null; this.effects = {}; this.chronicle?.refresh(); }
  applyBuild() {
    const p = this.player; if (!p || !this.run) return;
    const temporary = boonEffects(this.run.picked), permanent = this.run.permanent;
    this.effects = this.run.enabled ? Object.fromEntries([...new Set([...Object.keys(temporary),...Object.keys(permanent)])].map(k=>[k,(temporary[k]||0)+(permanent[k]||0)])) : {};
    const oldMax = p.maxHp;
    p.stats = applyBuildStats(this.buildBase,this.effects); this.appliedStats = p.stats; p.maxHp = p.stats.hp;
    if (p.alive) p.hp = Math.max(1,Math.min(p.maxHp,p.hp+p.maxHp-oldMax));
    this.chronicle?.refresh();
  }
  upgradeHeroStats(base) {
    this.buildBase={...base}; this.appliedStats=applyBuildStats(base,this.effects);
    return this.appliedStats;
  }
  currentOffer() {
    const offer=this.run?.queue[0];
    if(offer?.kind==='boon') {
      // Deferred offers are evaluated against the current build, never an old rank snapshot.
      if(offer.ids.some(id=>this.run.picked.filter(x=>x===id).length>=3))
        offer.ids=boonChoices(`${this.stage.code}:${this.run.id}`,this.run.picked,offer.round).map(b=>b.id);
    }
    return offer;
  }
  queueBoon() {
    if (!this.run?.enabled || this.run.round >= 6) return;
    const choices = boonChoices(`${this.stage.code}:${this.run.id}`,this.run.picked,this.run.round++);
    if (choices.length) this.run.queue.push({kind:'boon',ids:choices.map(b=>b.id),round:this.run.round-1});
  }
  selectBoon(id) {
    const offer = this.currentOffer();
    if (!this.active || !this.player?.alive || offer?.kind !== 'boon' || !offer.ids.includes(id) || this.run.picked.filter(x=>x===id).length>=3) return {ok:false,error:'선택할 수 없는 각인입니다.'};
    this.run.picked.push(id); this.run.queue.shift(); this.applyBuild();
    audio.play('ui_glass',{vol:.5}); this.chronicle.selectionDone(); return {ok:true};
  }
  selectStory(choiceId) {
    const offer = this.run?.queue[0];
    if (!this.active || !this.player?.alive || offer?.kind !== 'story') return {ok:false,error:'만남이 종료됐습니다.'};
    const event = STORY_EVENTS.find(e=>e.id===offer.id);
    const remembered = this.masterworks.s.story[event.id];
    let result;
    if (remembered) {
      const choice = event.choices.find(c=>c.id===remembered);
      result = {ok:true,effects:{heal:choice.effects.heal ? .12 : .06},consequence:choice.consequence};
    } else result = this.masterworks.transact(s=>resolveStory(s,event.id,choiceId),{duringBattle:true});
    if (!result.ok) return result;
    this.run.renown+=result.renown||0;
    const heal = Math.round(this.player.maxHp*(result.effects?.heal||0));
    this.player.hp = Math.min(this.player.maxHp,this.player.hp+heal);
    this.run.queue.shift(); this.chronicle.selectionDone();
    this.ui.toast(result.consequence || '당신의 선택이 기록되었습니다.','gold'); return result;
  }
  spawnEnemy(...args) {
    const e = super.spawnEnemy(...args); if (!e) return e;
    const d = this.run?.difficulty;
    if (d && this.run.enabled) { e.maxHp = Math.round(e.maxHp*d.enemyHp); e.hp=e.maxHp; e.atk*=d.enemyAtk; }
    applyRiftEnemy(e, this.stage);
    e.posture=0; e.postureMax=e.isBoss?150:e.isElite?110:80; e.breakT=0;
    return e;
  }
  onEnemyDeath(e) {
    if (this.runKills?.has(e)) return;
    if (e?.alive !== false) return;
    this.runKills?.add(e);
    const earn=this.active && this.run && !this.run.settled;
    super.onEnemyDeath(e);
    if (!this.run) return;
    if (this.player.stats !== this.appliedStats) { this.buildBase={...this.player.stats}; this.applyBuild(); }
    if (earn && !e.summoned && this.run.enabled) {
      const previousKills=this.masterworks.s.bounties.counts.kills;
      const validKills=recordProgress(this.masterworks.s,'kills');
      if (e.isBoss || e.isElite) recordProgress(this.masterworks.s,'eliteKills');
      if (validKills>previousKills && validKills%5===0) { const gained=grantRenown(this.masterworks.s,1); this.run.renown+=gained; }
      this.rpgDirty=true;
      if (this.player.alive && this.effects.healOnKill) this.player.hp=Math.min(this.player.maxHp,this.player.hp+this.player.maxHp*Math.min(.05,this.effects.healOnKill));
    }
  }
  markCleared(room) {
    const was = room.cleared; super.markCleared(room);
    if (was || !room.cleared || !this.active || this.run?.settled || !this.run?.enabled || room.type==='start') return;
    const index=this.world.rooms.indexOf(room);
    const key=this.stage.expedition ? `expedition:${this.stage.expedition.id}:${index}` : `room:${this.stage.idx}:${index}`;
    const discovery=recordDiscovery(this.masterworks.s,key);
    if (discovery.ok) { this.run.renown+=discovery.renown||0; this.ui.toast('새 길의 기록 · 명성 +3','gold'); }
    this.rpgDirty=true; this.flushRpg();
    if (room.type==='boss' || this.bossDefeated) return;
    this.queueBoon();
    const lastApproach=this.stage.expedition?.kind==='dungeon' && this.world.rooms.every(r=>r.cleared || r.type==='start' || r.type==='boss');
    if (!this.run.storySeen && (room.type==='treasure' || this.roomsCleared>=2 || lastApproach)) {
      const idx=this.stage.expedition ? ['glass_garden','ember_vault','star_archive'].indexOf(this.stage.expedition.id) : (this.stage.ch-1)%3;
      this.run.queue.push({kind:'story',id:STORY_EVENTS[Math.max(0,idx)].id}); this.run.storySeen=true;
    }
    this.player.chronicleShield=Math.round(this.player.maxHp*Math.min(.25,this.effects.shield||0));
    // Wait for the clearing blow to finish; the native pause owner freezes the same simulation.
    this.after(.45,()=>{ if(this.active&&this.player.alive)this.chronicle.offer(); });
  }
  onPerfectDodge(p) {
    super.onPerfectDodge(p);
    if (!this.run?.enabled) return;
    this.counterUntil=this.elapsed+3; this.run.perfects++;
    recordProgress(this.masterworks.s,'perfects'); this.rpgDirty=true;
    if (this.effects.perfectHeal) p.hp=Math.min(p.maxHp,p.hp+p.maxHp*Math.min(.06,this.effects.perfectHeal));
    this.chronicle.refresh();
  }
  damageEnemy(e,dmg,opts={}) {
    if (!this.run?.enabled || opts.masterworksProc) return super.damageEnemy(e,dmg,opts);
    const before=e?.hp||0, counter=this.elapsed<this.counterUntil && !opts.quiet;
    let mult=1+(opts.finisher?Math.min(.7,this.effects.finisher||0):0)+(e?.breakT>0?.3:0)+(counter?.35:0);
    super.damageEnemy(e,dmg*mult,opts);
    const dealt=before-(e?.hp||0);
    if (!(dealt>0)) return;
    if (counter) { this.counterUntil=0; this.ui.toast('빈틈 반격 · 피해 +35%','gold'); }
    if (postureHit(e,dealt,{...opts,breakPower:this.effects.breakPower||0})) {
      this.run.breaks++; this.fx.damage(e.pos,0,{text:'BREAK'});
      this.fx.shockTex(e.pos,0xffd180,{r1:3.5,life:.3}); audio.play('hit_metal0',{vol:.4});
    }
    if (opts.finisher && !opts.quiet && this.effects.chain && this.elapsed>=this.chainUntil) {
      this.chainUntil=this.elapsed+.65;
      let count=0;
      for (const other of this.enemies) {
        if (other===e||!other.alive||other.spawning||other.pos.distanceToSquared(e.pos)>42)continue;
        this.fx.boltTex(e.pos.clone().setY(1),other.pos.clone().setY(1),0x9edaff,{life:.22});
        super.damageEnemy(other,this.player.atk*.55,{kind:'magic',noProc:true,quiet:true,masterworksProc:true});
        if(++count>=Math.min(2,this.effects.chain))break;
      }
    }
  }
  skillCooldown(seconds) { return seconds*(1-Math.min(.35,this.effects?.cooldown||0)); }
  absorbDamage(amount) {
    const p=this.player, shield=p.chronicleShield||0;
    const absorbed=Math.min(shield,amount); p.chronicleShield=shield-absorbed;
    return amount-absorbed;
  }
  settleChronicle(outcome) {
    if (!this.run || this.run.settled) return;
    this.run.settled=true; this.run.queue.length=0; this.chronicle.close();
    const s=this.masterworks.s;
    if (this.run.enabled) {
      if(outcome==='victory') {
        recordProgress(s,'clears');
        const bonus=Math.floor((6+this.roomsCleared*2)*Math.min(1.8,this.run.difficulty.rewardMul+(this.effects.rewardMul||0)));
        this.run.renown+=grantRenown(s,bonus);
        if(!this.stage.expedition) { const d=recordDiscovery(s,`campaign:${this.stage.idx}`);this.run.renown+=d.renown||0; }
      }
      s.history.push({runId:this.run.id,floor:this.stage.idx,outcome,boonIds:[...new Set(this.run.picked)]});
      s.history=s.history.slice(-20); this.rpgDirty=true; this.flushRpg();
    }
    if(this.result) this.result.masterworks={renown:this.run.renown,breaks:this.run.breaks,perfects:this.run.perfects,boons:[...this.run.picked]};
    if(this.app.expeditionUI?.result)this.app.expeditionUI.render();
    this.chronicle.refresh();
  }
  victory() { const active=this.active;super.victory();if(active&&this.result?.win)this.settleChronicle('victory'); }
  defeat() { const active=this.active;super.defeat();if(active&&this.result&&!this.result.win)this.settleChronicle('defeat'); }
  update(realDt) {
    const before=this.elapsed; super.update(realDt);
    const dt=Math.max(0,this.elapsed-before);
    if(dt>0&&this.active&&this.run?.enabled) for(const e of this.enemies)if(e.alive)tickPosture(e,dt);
    this.chronicle?.tick(realDt);
  }
}
