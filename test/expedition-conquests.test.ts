import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { EXPEDITION_CONQUESTS } from '../src/data/expedition-conquests.js';
import { expeditionDepth } from '../src/data/expedition-depths.js';
import { ConquestRun, readConquestOutcome } from '../src/game/expedition-conquests.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';
import { Battle } from '../src/game/battle-base.js';
import { Battle as MasterworksBattle } from '../src/game/masterworks-battle.js';
import { Vector3 } from 'three';
import { Player } from '../src/game/player.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
});
afterEach(()=>{ if(original)Object.defineProperty(globalThis,'localStorage',original);else Reflect.deleteProperty(globalThis,'localStorage'); });
function account(){const eco=new Economy();return {eco,x:new ExpeditionEconomy(eco)};}
function unlock(f:ReturnType<typeof account>,c:any){
  const d=expeditionDepth(c.dungeonId)!; f.x.s.level=4; f.eco.s.progress.stars[d.unlockCode]=1;
  f.x.s.stats[c.dungeonId]=1; f.x.s.depthWins[c.dungeonId]=1;
  if(c.previous)f.x.s.conquests.push(c.previous);
}
function runFor(c:any,ticket:any){
  const stage=buildExpeditionStage('dungeon',c.dungeonId,null,{depth:'deep',conquestId:c.id});
  const world=buildExpeditionWorld(stage);return {stage,world,run:new ConquestRun(stage,world,ticket)};
}
function initialRoom(run:any,stage:any,room:any){
  const roster=expeditionRoster(stage,room);run.prepareRoom(room,roster);
  return roster.map((type:string)=>{const e:any={alive:true,homeRoom:room};run.spawn(e,type,room);return e;});
}
function kill(run:any,e:any){e.alive=false;run.death(e);}
function complete(c:any,r:ReturnType<typeof runFor>){
  if(c.kind==='altars')for(const id of c.order)r.run.attune(r.world.rooms[id]);
  else if(c.kind==='priority')for(const room of r.world.rooms.filter(r=>r.type==='elite')){
    const enemies=initialRoom(r.run,r.stage,room);for(const e of c.priority==='first'?enemies:[...enemies.slice(1),enemies[0]])kill(r.run,e);
  }else for(let i=0;i<c.target;i++)r.run.bossHit({isBoss:true},{broke:true,opening:true,direct:true});
  return r.run.finish(true);
}
for(const c of EXPEDITION_CONQUESTS)test(`${c.id}: all catalog gates, real outcome, first mark and repeat payout survive reload`,()=>{
  const f=account();expect(f.x.conquestAccess(c.id).ok).toBe(false);unlock(f,c);
  f.x.s.depthWins[c.dungeonId]=0;expect(f.x.conquestAccess(c.id).ok).toBe(false);f.x.s.depthWins[c.dungeonId]=1;
  if(c.previous){f.x.s.conquests=[];expect(f.x.conquestAccess(c.id).ok).toBe(false);f.x.s.conquests.push(c.previous);}
  expect(f.x.conquestAccess(c.id).ok).toBe(true);
  for(let i=0;i<2;i++){
    const started=f.x.begin('dungeon',c.dungeonId,{depth:'deep',conquestId:c.id});expect(started.ok).toBe(true);
    const proof=complete(c,runFor(c,started.ticket));expect(proof.complete).toBe(true);
    const result=f.x.settle(started.ticket,{win:true,conquest:proof});expect(result.ok).toBe(true);
    expect(result.rewards?.conquest.firstClear).toBe(i===0);
    expect(result.rewards?.gold).toBe(expeditionDepth(c.dungeonId)!.rewards.gold+(i===0?c.firstRewards.gold:0));
    const paid=JSON.stringify(f.eco.s);expect(f.x.settle(started.ticket,{win:true,conquest:proof}).ok).toBe(false);expect(JSON.stringify(f.eco.s)).toBe(paid);
  }
  expect(account().x.s.conquests.filter((id:string)=>id===c.id)).toHaveLength(1);
});
test('wrong combinations and copied tickets/proofs cannot grant marks or consume a valid pending run',()=>{
  const c=EXPEDITION_CONQUESTS[0],f=account();unlock(f,c);
  for(const [kind,id,options] of [['dungeon',c.dungeonId,{depth:'standard',conquestId:c.id}],['arena','rookie',{depth:'deep',conquestId:c.id}],['dungeon','ember_vault',{depth:'deep',conquestId:c.id}],['dungeon',c.dungeonId,{depth:'deep',conquestId:c.id,rift:true}],['dungeon',c.dungeonId,{depth:'deep',conquestId:'missing'}]] as any[]){
    const before=JSON.stringify(f.eco.s);expect(f.x.begin(kind,id,options).ok).toBe(false);expect(JSON.stringify(f.eco.s)).toBe(before);
  }
  const t=f.x.begin('dungeon',c.dungeonId,{depth:'deep',conquestId:c.id}).ticket,proof=complete(c,runFor(c,t));
  const before=JSON.stringify(f.eco.s);
  for(const [ticket,p] of [[{...t},proof],[t,{...proof}],[t,JSON.parse(JSON.stringify(proof))],[t,undefined],[{...t,conquestId:'garden_dusk'},proof]]){
    expect(f.x.settle(ticket,{win:true,conquest:p}).ok).toBe(false);expect(JSON.stringify(f.eco.s)).toBe(before);
  }
  expect(f.x.abandon(t).ok).toBe(true);
  const next=f.x.begin('dungeon',c.dungeonId,{depth:'deep',conquestId:c.id}).ticket;
  expect(f.x.settle(next,{win:true,conquest:proof}).ok).toBe(false);
  expect(readConquestOutcome(proof,t,false)).toBeNull();
});
test('save failure retries the same proof once; unfinished reload refunds six once without a mark',()=>{
  const c=EXPEDITION_CONQUESTS[0],f=account();unlock(f,c);
  const t=f.x.begin('dungeon',c.dungeonId,{depth:'deep',conquestId:c.id}).ticket,proof=complete(c,runFor(c,t));
  const before=structuredClone(f.eco.s),save=f.eco.save;f.eco.save=()=>false;
  expect(f.x.settle(t,{win:true,conquest:proof}).ok).toBe(false);expect(f.eco.s).toEqual(before);f.eco.save=save;
  expect(f.x.settle(t,{win:true,conquest:proof}).ok).toBe(true);
  const energy=f.eco.s.energy,again=f.x.begin('dungeon',c.dungeonId,{depth:'deep',conquestId:c.id}).ticket;
  const loaded=account();expect(loaded.eco.s.energy).toBe(energy);expect(loaded.x.s.pending).toBeNull();
  expect(loaded.x.settle(again,{win:true,conquest:proof}).ok).toBe(false);expect(account().eco.s.energy).toBe(energy);
});
test('wrong altar order is a paid ordinary win, not a conquest; loss grants neither payout nor mark',()=>{
  const c=EXPEDITION_CONQUESTS[0],f=account();unlock(f,c);
  for(const win of [true,false]){
    const t=f.x.begin('dungeon',c.dungeonId,{depth:'deep',conquestId:c.id}).ticket,r=runFor(c,t);
    r.run.attune(r.world.rooms[3]);r.run.attune(r.world.rooms[2]);const proof=r.run.finish(win);
    expect(proof.complete).toBe(false);expect(r.run.finish(!win)).toBe(proof);
    const result=f.x.settle(t,{win,conquest:proof});expect(result.ok).toBe(true);
    expect(f.x.s.conquests).not.toContain(c.id);expect(result.rewards?.gold||0).toBe(win?expeditionDepth(c.dungeonId)!.rewards.gold:0);
  }
});
test('production attunement hook clears both orders and selects distinct boss patterns',()=>{
  const patterns:any[]=[];
  for(const order of [[2,3],[3,2]]){
    const c=EXPEDITION_CONQUESTS[0],r=runFor(c,{conquestId:c.id});const cleared:number[]=[];
    const game:any={stage:r.stage,world:r.world,conquest:r.run,player:{alive:true,pos:{}},fx:{castCircle(){}},markCleared(room:any){room.cleared=true;cleared.push(room.id);}};
    for(const id of order){const room:any=r.world.rooms[id];room.attunementPending=true;room.attunementT=0;game.player.pos={x:room.x,z:room.z};Battle.prototype.updateExpedition.call(game,1);expect(room.attuned).not.toBe(true);Battle.prototype.updateExpedition.call(game,1);}
    expect(cleared).toEqual(order);expect(r.run.altars).toEqual(order);expect(r.run.attune(r.world.rooms[2])).toBe(false);
    patterns.push(r.run.bossPattern());expect(r.run.finish(true).complete).toBe(order[0]===2);
  }
  expect(patterns[0]).not.toEqual(patterns[1]);
});
for(const id of ['vault_signal','vault_manifest'])test(`${id}: initial identities and kill order control the existing single wave`,()=>{
  const c=EXPEDITION_CONQUESTS.find(c=>c.id===id)!;
  for(const success of [true,false]){
    const r=runFor(c,{conquestId:id}),room:any=r.world.rooms.find(r=>r.type==='elite'),enemies=initialRoom(r.run,r.stage,room);
    const stray:any={alive:false,homeRoom:room};r.run.death(stray);r.run.death(enemies[0]);expect(r.run.progress).toBe(0);
    const first=(c.priority==='first')===success;for(const e of first?enemies:[...enemies.slice(1),enemies[0]])kill(r.run,e);
    r.run.death(enemies[0]);expect(r.run.progress).toBe(success?1:0);expect(r.run.reinforcementWaves(room,1)).toBe(success?0:1);
    if(!success){const alive=Array.from({length:15},()=>({alive:true}));const game:any={stage:r.stage,conquest:r.run,enemies:alive,maxAlive:16,pending:[],ui:{waveBanner(){}},spawnEnemy(){alive.push({alive:true});}};
      Battle.prototype.markCleared.call(game,room);expect(alive).toHaveLength(16);expect(game.pending).toHaveLength(3);expect(room.forgeWave).toBe(1);expect(room.cleared).toBe(false);
    }
  }
});
for(const id of ['archive_break','archive_opening'])test(`${id}: boss/direct eligibility and completed receipt are immutable`,()=>{
  const c=EXPEDITION_CONQUESTS.find(c=>c.id===id)!,r=runFor(c,{conquestId:id});
  expect(r.run.bossHit({isBoss:false},{broke:true,opening:true,direct:true})).toBe(false);
  expect(r.run.bossHit({isBoss:true},{broke:true,opening:true,direct:false})).toBe(false);
  expect(r.run.bossHit({isBoss:true},{broke:false,opening:false,direct:true})).toBe(false);
  for(let i=0;i<c.target;i++)expect(r.run.bossHit({isBoss:true},{broke:true,opening:true,direct:true})).toBe(true);
  const report=r.run.finish(true);expect(report.complete).toBe(true);expect(Object.isFrozen(report)).toBe(true);
  expect(r.run.bossHit({isBoss:true},{broke:true,opening:true,direct:true})).toBe(false);
});
test('actual damage hook excludes quiet/companion hits and counts direct posture transitions and openings',()=>{
  for(const id of ['archive_break','archive_opening']){
    const c=EXPEDITION_CONQUESTS.find(c=>c.id===id)!,r=runFor(c,{conquestId:id});
    const player={stats:{crit:0,critDmg:1.5},addUlt(){}},companion={stats:{crit:0,critDmg:1.5},addUlt(){}};
    const e:any={isBoss:true,alive:true,hp:100000,posture:140,breakT:id==='archive_opening'?1:0,pos:new Vector3(),def:{scale:1},receiveImpact(){},hurt(n:number){this.hp-=n;return n;}};
    const g:any={active:true,player,conquest:r.run,run:{enabled:true,breaks:0},effects:{},elapsed:10,counterUntil:0,feedbackCount:99,feedbackSound:99,dmgDealt:0,combo:0,maxCombo:0,
      fx:{dmgLayer:{children:Array(30)},damage(){},shockTex(){}},ui:{setCombo(){},setObjective(){}},app:{},timeCtl:{hitstop(){}}};
    MasterworksBattle.prototype.damageEnemy.call(g,e,1,{source:player,quiet:true});expect(r.run.progress).toBe(0);
    MasterworksBattle.prototype.damageEnemy.call(g,e,1,{source:companion});expect(r.run.progress).toBe(0);
    e.posture=140;e.breakT=id==='archive_opening'?1:0;
    MasterworksBattle.prototype.damageEnemy.call(g,e,1,{source:player});expect(r.run.progress).toBe(1);
    const hp=e.hp;MasterworksBattle.prototype.damageEnemy.call(g,e,0,{source:player});expect(e.hp).toBe(hp);expect(r.run.progress).toBe(1);
  }
});
test('production pause and stop prevent objective timers or queued spawn work from leaking',()=>{
  const c=EXPEDITION_CONQUESTS[0],r=runFor(c,{conquestId:c.id});let ticks=0,cleared=0;
  const g:any={player:{dispose(){}},paused:true,conquest:r.run,timeCtl:{step(){ticks++;return 10;}},timers:[{t:1,fn(){throw Error('paused timer ran');}}],
    pending:[{}],enemies:[],projectiles:[],app:{},input:{clear(){}},ui:{showHud(){}},fx:{clearAll(){cleared++;}},drops:{clear(){}},renderer:{},clearPortal(){},world:r.world};
  Battle.prototype.update.call(g,10);expect(ticks).toBe(0);expect(g.timers).toHaveLength(1);expect(r.run.altars).toHaveLength(0);
  Battle.prototype.stop.call(g);expect(g.conquest).toBeNull();expect(g.world).toBeNull();expect(g.timers).toHaveLength(0);expect(g.pending).toHaveLength(0);expect(cleared).toBe(1);
  Battle.prototype.update.call(g,10);expect(ticks).toBe(0);
});

test('real AUTO requests use precision approach without skills/chains, then restore ordinary and boss combat',()=>{
  for(const id of ['vault_signal','vault_manifest']){
    const c=EXPEDITION_CONQUESTS.find(c=>c.id===id)!,r=runFor(c,{conquestId:id});
    const room=r.world.rooms.find(r=>r.type==='elite')!;
    const enemies=initialRoom(r.run,r.stage,room);
    for(const e of enemies){e.pos=new Vector3(5,0,0);e.distTo=(other:any)=>e.pos.distanceTo(other.pos);}
    const requests:string[]=[];
    const g:any={conquest:r.run,enemies,stage:r.stage,input:{press(key:string){requests.push(key);}},world:{roomAt(){return room;}}};
    const p:any={game:g,pos:new Vector3(),state:'idle',def:{ranged:true,skills:[{id:'mage_test'}]},cds:[0],
      unlocked(){return true;},distTo(e:any){return this.pos.distanceTo(e.pos);}};
    const step=()=>{requests.length=0;return Player.prototype.autoMove.call(p,1/60);};
    const priority=r.run.autoEnemy(enemies);
    expect(r.run.precisionNeeded(priority)).toBe(true);
    // Five metres is inside normal ranged firing distance, but outside the
    // precision approach. A ready, unlocked skill must not prevent movement.
    expect(step()).toEqual({x:1,y:0});expect(requests).toEqual([]);expect(p.lockTarget).toBe(priority);
    p.pos.x=2;expect(step()).toEqual({x:0,y:0});expect(requests).toEqual(['attack']);
    p.state='attack';step();expect(requests).toEqual([]);
    // Advance the actual initial-instance decision, without stubbing the
    // conquest predicate: first target dead / last target's four guards dead.
    for(const e of c.priority==='first'?[enemies[0]]:enemies.slice(1))kill(r.run,e);
    expect(r.run.precisionNeeded(r.run.autoEnemy(enemies.filter(e=>e.alive)))).toBe(false);
    // Ordinary combat now keeps basic attacks as the default instead of firing a skill on cooldown.
    p.pos.x=0;p.state='idle';step();expect(requests).toEqual(['attack']);
    g.getComboLinkSnapshot=()=>({ready:true});step();expect(requests).toEqual(['skill0']);
    g.getComboLinkSnapshot=()=>({ready:false});p.cds[0]=1;expect(step()).toEqual({x:0,y:0});expect(requests).toEqual(['attack']);
    p.state='attack';step();expect(requests).toEqual(['attack']);
    const boss:any={alive:true,isBoss:true,hp:100,maxHp:100,pos:new Vector3(5,0,0),homeRoom:r.world.bossRoom,distTo(other:any){return this.pos.distanceTo(other.pos);}};
    g.enemies=[boss];p.state='idle';p.cds[0]=0;step();expect(requests).toEqual(['attack']);
    p.state='attack';step();expect(requests).toEqual(['attack']);
    g.conquest=null;g.enemies=enemies.filter(e=>e.alive);p.state='idle';step();expect(requests).toEqual(['attack']);
  }
});
