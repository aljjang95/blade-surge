import { Battle as RpgBattle } from './rpg-battle.js';
import { MasterworksService } from './masterworks-service.js';
import { MasterworksView } from '../ui/masterworks.js';
import { TargetTag } from '../ui/target-tag.js';
import { LootLabels } from '../ui/loot-labels.js';
import { STORY_EVENTS } from '../data/masterworks.js';
import { boonEffects, masteryEffects, difficultyEffects, recordProgress, recordDiscovery, grantRenown, resolveStory, seedRunBoons, sumEffects } from './masterworks-core.js';
import { applyBuildStats, postureHit, tickPosture } from './masterworks-combat.js';
import { audio } from '../engine/audio.js';
import { applyRiftEnemy } from './journey-rifts.js';
import { RiftEncounters, RIFT_REINFORCEMENT, isRiftDungeon } from './rift-encounters.js';
import { runHistoryContext, runDetailsForBattle } from './run-history.js';
import { capturePersonalGoal, evaluatePersonalGoal } from './run-personal-goals.js';

export class Battle extends RpgBattle {
  constructor(app) {
    super(app);
    this.masterworks = new MasterworksService(app); app.masterworks = this.masterworks;
    this.chronicle = new MasterworksView(app, this);
    // 대상 적 이름·HP·균형은 화면 위쪽 줄 대신 적 머리 위 표식으로 보인다.
    this.targetTag = typeof document !== 'undefined' ? new TargetTag() : null;
    // 땅에 떨어진 장비 위 등급 색 이름표(대표님 2026-10-30).
    this.lootLabels = typeof document !== 'undefined' ? new LootLabels() : null;
    app.eco.onChange(() => this.chronicle.refresh());
  }
  async start(...args) {
    this.riftEncounter?.dispose();this.riftEncounter=null;
    const pendingStart=super.start(...args),generation=this._startGeneration,stage=args[0];
    await pendingStart;
    // Asset preparation can complete after stop or a newer start. Only the
    // current living stage may issue a personal run id and freeze its goal.
    if(!Number.isSafeInteger(generation)||generation!==this._startGeneration||this.stage!==stage||!this.active||!this.player?.alive)return;
    // Party runs are server-scoped and must not write or depend on a personal save.
    const ticket = this.stage?.party
      ? {ok:true,id:this.stage.party.runId || `party:${this.stage.code}`}
      : this.masterworks.transact(s => { s.runSeq++; return {ok:true,id:s.runSeq}; }, {duringBattle:true});
    if (!ticket.ok) throw new Error(ticket.error);
    const s = this.masterworks.s;
    const runesOn=!this.stage.party && this.stage.expedition?.kind !== 'arena';
    // 현상금 의뢰 판(docs/BOUNTY_BOARD.md)은 의뢰 보상만: rewards=false 로 명성·룬 처치·개인 목표·연대기 기록을 막는다.
    // enabled(숙련·룬 전투 효과, 난이도 배율)는 그대로 켠다.
    const enabled=runesOn, rewards=runesOn && !this.stage.bounty;
    // 출격 중 각인 보상은 없다(2026-10-24 대표님). 각인은 출격 전에 setPreRunBoons 로 정해진 것만 한 번 소비해 적용한다.
    const preRunBoons=enabled ? seedRunBoons(this.preRunBoons) : [];this.preRunBoons=null;
    this.run = {id:ticket.id,picked:[...preRunBoons],preRunBoons,storySeen:false,settled:false,renown:0,perfects:0,breaks:0,
      // 영구 효과 = 숙련 + 장착 장비 룬(전운 각인 1개는 가문 공명 수에만 +1). 출격 시작 때 한 번 계산해 캐시한다.
      enabled, rewards, challenges:[...s.challengeIds], permanent:sumEffects([masteryEffects(s),enabled?this.app?.eco?.heroRuneEffects?.(args[1],{blessingBoonId:preRunBoons[0]||null})||{}:{}]),
      historyContext:runHistoryContext(this.stage,args[1],args[2]?.level),controlSeen:0,
      personalGoal:rewards ? capturePersonalGoal(s) : null};
    this.run.difficulty = difficultyEffects(this.run.enabled ? this.run.challenges : []);
    this.buildBase = {...this.player.stats}; this.effects = {}; this.applyBuild();
    this.runKills = new WeakSet(); this.counterUntil = 0; this.chainUntil = 0;
    if(isRiftDungeon(this.stage))this.riftEncounter=new RiftEncounters(this);
    this.chronicle.refresh();
  }
  stop() { this.riftEncounter?.dispose();this.riftEncounter=null;this.chronicle?.close(); super.stop(); this.run = null; this.effects = {}; this.chronicle?.refresh(); }
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
  /** 출격 전 외부(룬·출격 전 1회용 뽑기)가 정한 각인 id 목록. 다음 개인 출격 시작 때 한 번 소비된다.
   *  파티·AI 결투처럼 개인 각인이 꺼진 출격에서는 적용하지 않고 버린다. 지금은 호출자가 없어 각인 없음이 기본이다. */
  setPreRunBoons(ids) { this.preRunBoons=seedRunBoons(ids); return [...this.preRunBoons]; }
  /** 길 위의 만남은 전투를 멈추지 않는다. 예전 선택이 있으면 재방문 회복, 없으면 첫 선택지로 기록하고 가장자리 알림만 띄운다. */
  resolveStoryEvent(eventId) {
    const event = STORY_EVENTS.find(e=>e.id===eventId);
    if (!event || !this.active || !this.player?.alive || !this.run?.enabled || this.run.rewards === false || this.run.settled) return {ok:false,error:'만남이 종료됐습니다.'};
    const remembered = event.choices.find(c=>c.id===this.masterworks.s.story[event.id]);
    let result;
    if (remembered) result = {ok:true,effects:{heal:remembered.effects.heal ? .12 : .06},renown:0,revisit:true,choiceId:remembered.id};
    else {
      const choice=event.choices[0];
      result = this.masterworks.transact(s=>resolveStory(s,event.id,choice.id),{duringBattle:true});
      if (result.ok) result.choiceId=choice.id;
    }
    if (!result.ok) { this.ui.toast('길 위의 만남 · 기록하지 못했습니다','red'); return result; }
    this.run.renown+=result.renown||0;
    const heal = Math.round(this.player.maxHp*(result.effects?.heal||0));
    this.player.hp = Math.min(this.player.maxHp,this.player.hp+heal);
    const reward = result.renown ? `명성 +${result.renown}` : heal ? `체력 +${Math.round((result.effects.heal||0)*100)}%` : '';
    const choiceName = remembered ? '다시 만남' : event.choices.find(c=>c.id===result.choiceId)?.name;
    this.ui.toast([event.name,choiceName,reward].filter(Boolean).join(' · '),'gold');
    return {...result,eventId:event.id};
  }
  spawnEnemy(...args) {
    const reinforcement=typeof args[0]==='string'&&args[0].startsWith(RIFT_REINFORCEMENT);
    if(reinforcement){
      if(!isRiftDungeon(this.stage)||this.stage.riftId!=='siege'||!this.active||this.bossDefeated||args[2]?.cleared)return;
      if(this.enemies.filter(e=>e.alive).length>=this.maxAlive){this.pending.push({t:args[0],room:args[2]});return;}
      args[0]=args[0].slice(RIFT_REINFORCEMENT.length);
    }
    const e = super.spawnEnemy(...args); if (!e) return e;
    if(reinforcement){e.riftReinforcement=true;e.summoned=true;e.xpReward=0;}
    const d = this.run?.difficulty;
    const campaign = this.stage?.campaignDifficulty;
    if (d && this.run.enabled) { e.maxHp = Math.round(e.maxHp*d.enemyHp); e.hp=e.maxHp; e.atk*=d.enemyAtk; }
    if (campaign && this.run?.enabled) { e.maxHp = Math.round(e.maxHp * campaign.enemyHp); e.hp=e.maxHp; e.atk*=campaign.enemyAtk; }
    applyRiftEnemy(e, this.stage);
    e.posture=0; e.postureMax=e.isBoss?150:e.isElite?110:80; e.breakT=0;
    return e;
  }
  onEnemyDeath(e) {
    if (this.runKills?.has(e)) return;
    if (e?.alive !== false) return;
    this.runKills?.add(e);
    if(e.riftReinforcement){
      if(!this.enemies.includes(e))return;
      // Reinforcements participate in room completion, never kill/drop/XP ledgers.
      if(this.active&&!this.run?.settled){
        if(this.pending.length)this.after(.5,()=>{if(this.active&&this.pending.length){const n=this.pending.shift();this.spawnEnemy(n.t,null,n.room);}});
        const room=e.homeRoom;if(room&&!room.cleared&&!this.enemies.some(x=>x.alive&&x.homeRoom===room)&&!this.pending.some(n=>n.room===room))this.markCleared(room);
      }
      return;
    }
    const earn=this.active && this.run && !this.run.settled;
    super.onEnemyDeath(e);
    if (!this.run) return;
    if (this.player.stats !== this.appliedStats) { this.buildBase={...this.player.stats}; this.applyBuild(); }
    if (earn && !e.summoned && this.run.enabled) {
      // 처치 회복은 전투 효과라 의뢰 판에서도 적용, 명성·진척·룬 처치만 보상 자격(rewards)에 묶는다.
      if (this.player.alive && this.effects.healOnKill) this.player.hp=Math.min(this.player.maxHp,this.player.hp+this.player.maxHp*Math.min(.05,this.effects.healOnKill));
    }
    if (earn && !e.summoned && this.run.enabled && this.run.rewards !== false) {
      const previousKills=this.masterworks.s.bounties.counts.kills;
      const validKills=recordProgress(this.masterworks.s,'kills');
      if (e.isBoss || e.isElite) { recordProgress(this.masterworks.s,'eliteKills'); this.app?.eco?.recordRuneKill?.(this.stage,e.isBoss?'boss':'elite',this.heroId); }
      if (validKills>previousKills && validKills%5===0) { const gained=grantRenown(this.masterworks.s,1); this.run.renown+=gained; }
      this.rpgDirty=true;
    }
  }
  markCleared(room) {
    const was = room.cleared; super.markCleared(room);
    if (was || !room.cleared || !this.active || this.run?.settled || !this.run?.enabled || this.run.rewards === false || room.type==='start') return;
    const index=this.world.rooms.indexOf(room);
    const deep=this.stage.expedition?.depth==='deep';
    const key=this.stage.expedition ? `expedition:${this.stage.expedition.id}:${deep?'deep:':''}${index}` : `room:${this.stage.idx}:${index}`;
    const discovery=recordDiscovery(this.masterworks.s,key);
    if (discovery.ok) { this.run.renown+=discovery.renown||0; this.ui.toast('새 길의 기록 · 명성 +3','gold'); }
    this.rpgDirty=true; this.flushRpg();
    if (room.type==='boss' || this.bossDefeated) return;
    const lastApproach=this.stage.expedition?.kind==='dungeon' && this.world.rooms.every(r=>r.cleared || r.type==='start' || r.type==='boss');
    // 방 클리어·체크포인트·마지막 접근 어디에서도 각인 보상이나 선택 창은 없다(2026-10-24 대표님).
    // Deep missions carry their own route objective; replaying an unrelated base
    // encounter here would interrupt the same short run twice.
    if (!deep && !this.run.storySeen && (room.type==='treasure' || this.roomsCleared>=2 || lastApproach)) {
      const idx=this.stage.expedition ? ['glass_garden','ember_vault','star_archive'].indexOf(this.stage.expedition.id) : (this.stage.ch-1)%3;
      this.run.storySeen=true;this.resolveStoryEvent(STORY_EVENTS[Math.max(0,idx)].id);
    }
    this.player.chronicleShield=Math.round(this.player.maxHp*Math.min(.25,this.effects.shield||0));
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
    const source=opts.source?.stats?opts.source:this.player;
    const before=e?.hp||0, counter=this.elapsed<this.counterUntil && !opts.quiet, opening=e?.breakT>0;
    let mult=1+(opts.finisher?Math.min(.7,this.effects.finisher||0):0)+(e?.breakT>0?.3:0)+(counter?.35:0);
    super.damageEnemy(e,dmg*mult,opts);
    const dealt=before-(e?.hp||0);
    if (!(dealt>0)) return;
    if (counter) { this.counterUntil=0; this.ui.toast('빈틈 반격 · 피해 +35%','gold'); }
    const broke=postureHit(e,dealt,{...opts,breakPower:this.effects.breakPower||0});
    if (broke) {
      this.run.breaks++; this.fx.damage(e.pos,0,{text:'BREAK'});
      this.fx.shockTex(e.pos,0xffd180,{r1:3.5,life:.3}); audio.play('hit_metal0',{vol:.4});
    }
    if (this.conquest?.bossHit(e,{broke,opening,direct:source===this.player&&!opts.quiet})) this.ui.setObjective(this.world);
    if (opts.finisher && !opts.quiet && this.effects.chain && this.elapsed>=this.chainUntil) {
      this.chainUntil=this.elapsed+.65;
      let count=0;
      for (const other of this.enemies) {
        if (other===e||!other.alive||other.spawning||other.pos.distanceToSquared(e.pos)>42)continue;
        this.fx.boltTex(e.pos.clone().setY(1),other.pos.clone().setY(1),0x9edaff,{life:.22});
        super.damageEnemy(other,source.atk*.55,{kind:'magic',noProc:true,quiet:true,masterworksProc:true,source});
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
    this.run.settled=true; this.chronicle.close();
    this.riftEncounter?.dispose();this.riftEncounter=null;
    const s=this.masterworks.s;
    if (this.run.enabled && this.run.rewards !== false) {
      if(outcome==='victory') {
        recordProgress(s,'clears');
        const bonus=Math.floor((6+this.roomsCleared*2)*Math.min(1.8,this.run.difficulty.rewardMul+(this.effects.rewardMul||0)));
        this.run.renown+=grantRenown(s,bonus);
        if(!this.stage.expedition) { const d=recordDiscovery(s,`campaign:${this.stage.idx}`);this.run.renown+=d.renown||0; }
      }
      s.history.push({runId:this.run.id,floor:this.stage.idx,outcome,boonIds:[...new Set(this.run.picked)],details:runDetailsForBattle(this)});
      s.history=s.history.slice(-20); this.rpgDirty=true; this.flushRpg();
    }
    if(this.result) this.result.masterworks={renown:this.run.renown,breaks:this.run.breaks,perfects:this.run.perfects,boons:[...this.run.picked],
      personalGoal:evaluatePersonalGoal(this.run.personalGoal,runDetailsForBattle(this),outcome)};
    // Defeat presents its result synchronously, before this final history save.
    if(!this.stage.expedition&&this.result)this.ui.refreshResultGrowth?.(this.result);
    if(this.app.expeditionUI?.result)this.app.expeditionUI.render();
    this.chronicle.refresh();
  }
  victory() { const active=this.active;super.victory();if(active&&this.result?.win)this.settleChronicle('victory'); }
  defeat() { const active=this.active;super.defeat();if(active&&this.result&&!this.result.win)this.settleChronicle('defeat'); }
  observeRunControl(realDt) {
    // Record modes used during active simulation, not a last-minute result toggle.
    if(this.active&&!this.paused&&this.run?.enabled&&!this.run.settled&&this.player?.alive&&Number.isFinite(realDt)&&realDt>0)
      this.run.controlSeen=(this.run.controlSeen||0)|(this.player.auto===true?2:1);
  }
  update(realDt) {
    this.observeRunControl(realDt);
    const before=this.elapsed; super.update(realDt);
    const dt=Math.max(0,this.elapsed-before);
    if(dt>0&&this.active&&this.run?.enabled) {
      for(const e of this.enemies)if(e.alive)tickPosture(e,dt);
      this.riftEncounter?.update(dt);
    }
    this.chronicle?.tick(realDt);
    this.targetTag?.update(this, this.renderer, realDt, this.app?.mode);
    this.lootLabels?.update(this, this.renderer, realDt, this.app?.mode);
  }
}
