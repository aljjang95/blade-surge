import { expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import { Battle } from '../src/game/masterworks-battle.js';
import { Battle as BaseBattle } from '../src/game/battle-base.js';
import { buildExpeditionStage } from '../src/game/expedition-combat.js';
import { HEROES, heroStats } from '../src/data/heroes.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { MasterworksService } from '../src/game/masterworks-service.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';
import { capturePersonalGoal, evaluatePersonalGoal } from '../src/game/run-personal-goals.js';
import { personalDeparture, personalResultLabel } from '../src/ui/personal-goal-labels.js';

const details = { route:{ kind:'dungeon',id:'glass_garden',depth:'standard',conquestId:null,riftId:null },
  heroId:'knight',heroLevel:4,control:'auto',timeSec:60.125,perfects:0,breaks:2 };
const history = () => [{ runId:7,floor:1,outcome:'victory',boonIds:[],details:structuredClone(details) }];
function withStorage(fn:(storage:{values:Map<string,string>,fail:boolean})=>void) {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const storage={values:new Map<string,string>(),fail:false};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>storage.values.get(key)??null,
    setItem:(key:string,value:string)=>{if(storage.fail&&key==='bladesurge_save_v1')throw Error('disk full');storage.values.set(key,value);},
    removeItem:(key:string)=>storage.values.delete(key),
  }});
  try {fn(storage);} finally {if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');}
}
function fixture() {
  const eco=new Economy(),expedition=new ExpeditionEconomy(eco);
  const app:any={eco,expedition,battle:{active:false,rpgDirty:false},stageStarting:false,expeditionUI:{result:null}};
  const service=new MasterworksService(app);service.s.history=history();eco.save();
  return {eco,expedition,app,service};
}

test('personal goal uses the existing durable transaction and survives native save normalization without changing economy or history',()=>withStorage(()=>{
  const {eco,service}=fixture(),before=structuredClone(eco.s);
  expect(service.goal(7,'breaks').ok).toBe(true);
  const after=structuredClone(eco.s);after.masterworks.personalGoal=before.masterworks.personalGoal;
  expect(after).toEqual(before);
  const loaded=new Economy();new ExpeditionEconomy(loaded);
  expect(loaded.s.masterworks.personalGoal).toEqual(service.s.personalGoal);
  expect(loaded.s.masterworks.history).toEqual(before.masterworks.history);
  expect(loaded.s.energy).toBe(before.energy);expect(loaded.s.gold).toBe(before.gold);
}));

test('goal save failure rolls back the choice and preserves native save; selecting again can recover through the same transaction',()=>withStorage(storage=>{
  const {eco,service}=fixture(),raw=storage.values.get('bladesurge_save_v1'),before=structuredClone(eco.s);
  storage.fail=true;expect(service.goal(7,'time').ok).toBe(false);
  expect(eco.s).toEqual(before);expect(storage.values.get('bladesurge_save_v1')).toBe(raw);
  storage.fail=false;expect(service.goal(7,'perfects').ok).toBe(true);
  expect(service.s.personalGoal.metric).toBe('perfects');
}));

for(const reason of ['active','starting','receipt','dirty','pending','refund','campaign-save'])test(`${reason} cannot change a personal goal before the existing result authority completes`,()=>withStorage(()=>{
  const {app,service,eco}=fixture(),before=structuredClone(eco.s);
  if(reason==='active')app.battle.active=true;
  if(reason==='starting')app.stageStarting=true;
  if(reason==='receipt')app.expeditionUI.result={saveError:'disk'};
  if(reason==='dirty')app.battle.rpgDirty=true;
  if(reason==='pending')app.expedition.s.pending={id:99};
  if(reason==='refund')app.expeditionRefundPending=true;
  if(reason==='campaign-save')app.ui={resultData:{reward:{saveError:'disk'}}};
  const guarded=structuredClone(eco.s);expect(service.goal(7,'time').ok).toBe(false);expect(eco.s).toEqual(guarded);
  expect(service.s.personalGoal).toBe(before.masterworks.personalGoal);
}));

test('start-time goal stays fixed when a new terminal record changes the rolling best',()=>{
  const state:any=normalizeMasterworks({history:history(),personalGoal:{context:details,metric:'time'}});
  const receipt=capturePersonalGoal(state);expect(receipt?.target).toBe(59.12);
  state.history.push({runId:8,floor:1,outcome:'victory',boonIds:[],details:{...details,timeSec:58}});
  const result=evaluatePersonalGoal(receipt,{...details,timeSec:59},'victory');
  expect(result).toMatchObject({eligible:true,achieved:true,baseline:60.125,target:59.12,value:59});
  expect(personalResultLabel(result)).toContain('개인 목표 달성');
  expect(evaluatePersonalGoal(receipt,{...details,heroLevel:5,timeSec:40},'victory')).toMatchObject({eligible:false,achieved:false,reason:'conditions'});
});

test('goal departure hints preserve the existing depth/rift/conquest route and catalog price without any authority call',()=>{
  const before=structuredClone(details);
  expect(personalDeparture(details)).toEqual({kind:'dungeon',label:expect.any(String),energy:4,id:'glass_garden',options:{rift:false,depth:'standard',conquestId:undefined}});
  expect(personalDeparture({...details,route:{...details.route,depth:'deep'}})?.energy).toBe(6);
  expect(personalDeparture({...details,route:{...details.route,riftId:'iron'}})?.options?.rift).toBe(true);
  expect(details).toEqual(before);
});

test('result time display preserves the observed value at a two-decimal target boundary',()=>{
  const result=evaluatePersonalGoal({context:details,metric:'time',baseline:11,target:10},{...details,timeSec:10.004},'victory');
  expect(result).toMatchObject({eligible:true,achieved:false,value:10.004,target:10});
  expect(personalResultLabel(result)).toContain('시간 10.004초 · 목표 10.00초 이하');
  expect(personalResultLabel(result)).toContain('다음에도 도전');
});

// Component fixtures below exercise actual inherited start/terminal/settlement
// hooks. Their prepared actor/time payloads are not natural browser evidence.
async function withAsyncStorage<T>(fn:(storage:{values:Map<string,string>,writes:number})=>Promise<T>) {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const storage={values:new Map<string,string>(),writes:0};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>storage.values.get(key)??null,
    setItem:(key:string,value:string)=>{if(key==='bladesurge_save_v1')storage.writes++;storage.values.set(key,value);},
    removeItem:(key:string)=>storage.values.delete(key),
  }});
  try{return await fn(storage);}finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');}
}
const noop=()=>{};
function inheritedGoalFixture(metric:'time'|'perfects'|'breaks'|null='time') {
  const eco=new Economy(),expedition=new ExpeditionEconomy(eco),hero=eco.hero();
  const app:any={eco,expedition,stageStarting:false,expeditionUI:{result:null,render:noop}};
  const battle:any=Object.create(Battle.prototype);app.battle=battle;
  Object.assign(battle,{app,active:false,paused:false,rpgDirty:false,player:null,stage:null,result:null,run:null,
    enemies:[],projectiles:[],timers:[],pending:[],effects:{},renderer:{battleMinimumAspect:0,desat:0},
    input:{enabled:false,clear:noop},fx:{clearAll:noop,burst:noop,embers:noop},drops:{clear:noop},
    chronicle:{refresh:noop,close:noop},
    // Presentation advances live elapsed after Base.victory freezes result.time,
    // and before Masterworks.victory invokes its actual settleChronicle hook.
    rpgView:{close:noop,refresh(){if(battle.result)battle.elapsed=battle.result.time+40;}},
    ui:{toast:noop,showHud:noop,showBoss:noop,showResult(game:any){
      const receipt=expedition.settle(app.expeditionTicket,game.result);
      game.result.expeditionReceipt=receipt;app.expeditionUI.result={win:game.result.win,receipt};
      game.elapsed=game.result.time+80;
    }},
  });
  battle.ensureRpg(); // The real Rpg constructor normalizes this before start.
  battle.masterworks=new MasterworksService(app);
  const earlier={...structuredClone(details),heroLevel:hero.level,timeSec:11,perfects:2};
  battle.masterworks.s.history=[{runId:7,floor:1,outcome:'victory',boonIds:[],details:earlier}];
  battle.masterworks.s.runSeq=7;
  if(metric)expect(battle.masterworks.goal(7,metric).ok).toBe(true);else expect(eco.save()).toBe(true);
  const admissionBefore=structuredClone(eco.s),admitted=expedition.begin('dungeon','glass_garden');
  expect(admitted.ok).toBe(true);app.expeditionTicket=admitted.ticket;
  expect(eco.s.energy).toBe(admissionBefore.energy-4);expect(expedition.s.seq).toBe(admissionBefore.expedition.seq+1);
  const starts:Array<{stage:any,generation:number,complete:()=>void}>=[];
  // Only graphics/assets loading is stubbed. Real Rpg.start, Masterworks.start,
  // MasterworksService, transactions, flushRpg, victory and settle remain live.
  const assetStart=spyOn(BaseBattle.prototype,'start').mockImplementation(function(this:any,stage:any,heroId:string,heroState:any){
    const generation=this._startGeneration=(this._startGeneration||0)+1;
    this.stage=stage;this.active=false;this.result=null;
    return new Promise<void>(resolve=>starts.push({stage,generation,complete:()=>{
      if(this._startGeneration===generation&&this.stage===stage){
        const stats=heroStats(HEROES[heroId as keyof typeof HEROES],heroState);
        this.heroId=heroId;this.player={stats,maxHp:stats.hp,hp:stats.hp,alive:true,auto:true,pos:new THREE.Vector3(),play:noop,dispose:noop};
        this.world={rooms:[{id:0,type:'start',cleared:true},{id:1,type:'boss',cleared:true}]};
        Object.assign(this,{active:true,paused:false,elapsed:0,roomsCleared:1,kills:0,maxCombo:0,dmgDealt:0,revived:0,treasureRooms:0});
      }
      resolve();
    }}));
  });
  return {eco,expedition,hero,app,battle,starts,assetStart,admissionEnergy:eco.s.energy,stage:buildExpeditionStage('dungeon','glass_garden',{}, {depth:'standard'})};
}
async function completeInheritedGoal(metric:'time'|'perfects'|'breaks'|null,seconds=9.5,mixed=false,win=true,readWrites=()=>0) {
  const f=inheritedGoalFixture(metric),{battle,hero}=f;
  try{
    const writesBeforeStart=readWrites();
    const started=battle.start(f.stage,'knight',hero,{});f.starts[0].complete();await started;
    expect(battle.run.id).toBe(8);expect(battle.masterworks.s.runSeq).toBe(8);
    expect(battle.growthStart.level).toBe(hero.level);
    const departureLevel=battle.growthStart.level;expect(battle.run.historyContext.heroLevel).toBe(departureLevel);
    const captured=battle.run.personalGoal;
    if(metric){expect(Object.isFrozen(captured)).toBe(true);expect(Object.isFrozen(captured.context)).toBe(true);expect(Object.isFrozen(captured.context.route)).toBe(true);}
    battle.observeRunControl(1/60);if(mixed){battle.player.auto=false;battle.observeRunControl(1/60);}
    battle.run.perfects=3;battle.run.breaks=3;battle.elapsed=seconds;
    // Current hero growth must not replace the actual departure-level context.
    hero.level++;expect(battle.run.historyContext.heroLevel).toBe(departureLevel);
    if(win)battle.victory();else battle.defeat();
    expect(battle.result.time).toBe(seconds);expect(battle.elapsed).toBeGreaterThan(seconds);
    expect(battle.masterworks.s.history.at(-1).details).toEqual({route:details.route,heroId:'knight',heroLevel:departureLevel,
      control:mixed?'mixed':'auto',timeSec:seconds,perfects:3,breaks:3});
    const frozenResult=structuredClone(battle.result.masterworks.personalGoal);
    if(win){const presentation=battle.timers.find((timer:any)=>timer.t===1.6);expect(presentation).toBeDefined();presentation.fn();}
    expect(battle.result.expeditionReceipt.ok).toBe(true);expect(f.expedition.s.pending).toBeNull();
    expect(f.eco.s.energy).toBe(f.admissionEnergy);
    const beforeDuplicate=structuredClone(f.eco.s),historyBefore=structuredClone(battle.masterworks.s.history);
    battle.victory();battle.defeat();battle.settleChronicle(win?'victory':'defeat');
    expect(f.eco.s).toEqual(beforeDuplicate);expect(battle.masterworks.s.history).toEqual(historyBefore);
    expect(battle.result.masterworks.personalGoal).toEqual(frozenResult);
    expect(f.expedition.settle(f.app.expeditionTicket,battle.result).ok).toBe(false);expect(f.eco.s).toEqual(beforeDuplicate);
    const persisted=JSON.parse(localStorage.getItem('bladesurge_save_v1')!);
    expect(persisted.masterworks.history).toEqual(battle.masterworks.s.history);
    expect(persisted.expedition.pending).toBeNull();
    const projection=structuredClone(f.eco.s);delete projection.created;delete projection.energyT;delete projection.limitedStart;delete projection.masterworks.personalGoal;
    return {result:frozenResult,history:historyBefore,projection,captured,next:capturePersonalGoal(battle.masterworks.s),settlementWrites:readWrites()-writesBeforeStart};
  }finally{f.assetStart.mockRestore();}
}

test('actual inherited start freezes a time target before victory rewrites the rolling best and before presentation advances elapsed',()=>withAsyncStorage(async()=>{
  const observed=await completeInheritedGoal('time');
  expect(observed.result).toMatchObject({eligible:true,achieved:true,metric:'time',baseline:11,target:10,value:9.5});
  expect(observed.next).toMatchObject({baseline:9.5,target:8.5});expect(observed.result.target).toBe(10);
}));
test('actual terminal hook keeps an exact 10.004 time miss even after elapsed presentation drift',()=>withAsyncStorage(async()=>{
  const observed=await completeInheritedGoal('time',10.004);
  expect(observed.result).toMatchObject({eligible:true,achieved:false,value:10.004,target:10});
  expect(personalResultLabel(observed.result)).toContain('시간 10.004초 · 목표 10.00초 이하');
}));
test('actual perfect target stays fixed after history gains a better record and goal presence adds no payout or extra settlement save',()=>withAsyncStorage(async storage=>{
  const withGoal=await completeInheritedGoal('perfects',9.5,false,true,()=>storage.writes);
  expect(withGoal.result).toMatchObject({eligible:true,achieved:true,baseline:2,target:3,value:3});
  expect(withGoal.next).toMatchObject({baseline:3,target:4});
  storage.values.clear();const withoutGoal=await completeInheritedGoal(null,9.5,false,true,()=>storage.writes);
  expect(withoutGoal.result).toBeNull();expect(withGoal.projection).toEqual(withoutGoal.projection);expect(withGoal.history).toEqual(withoutGoal.history);
  expect(withGoal.settlementWrites).toBe(withoutGoal.settlementWrites);
}));
test('actual observed mixed controls cannot satisfy an AUTO goal and actual defeat cannot achieve a goal',()=>withAsyncStorage(async storage=>{
  expect((await completeInheritedGoal('time',9.5,true)).result).toMatchObject({eligible:false,achieved:false,reason:'conditions'});
  storage.values.clear();expect((await completeInheritedGoal('time',9.5,false,false)).result).toMatchObject({eligible:false,achieved:false,reason:'defeat'});
}));
test('a stale completed asset start cannot replace the newer frozen goal, context or durable run sequence',()=>withAsyncStorage(async()=>{
  const f=inheritedGoalFixture();try{
    const stale=f.battle.start(f.stage,'knight',f.hero,{}),replacement=buildExpeditionStage('dungeon','glass_garden',{}, {depth:'standard'});
    const current=f.battle.start(replacement,'knight',f.hero,{});f.starts[1].complete();await current;
    const run=f.battle.run,before=structuredClone(f.eco.s),raw=localStorage.getItem('bladesurge_save_v1');
    expect(run.id).toBe(8);expect(Object.isFrozen(run.personalGoal)).toBe(true);
    f.starts[0].complete();await stale;
    expect(f.battle.run).toBe(run);expect(f.battle.stage).toBe(replacement);expect(f.eco.s).toEqual(before);
    expect(localStorage.getItem('bladesurge_save_v1')).toBe(raw);
  }finally{f.assetStart.mockRestore();}
}));
test('actual stop before asset completion and same-generation wrong stage both reject personal capture and profile writes',()=>withAsyncStorage(async storage=>{
  for(const boundary of ['stop','stage']){
    storage.values.clear();const f=inheritedGoalFixture();try{
      const pending=f.battle.start(f.stage,'knight',f.hero,{}),before=structuredClone(f.eco.s),raw=localStorage.getItem('bladesurge_save_v1');
      if(boundary==='stop'){f.battle.stop();f.starts[0].complete();}
      else{f.starts[0].complete();f.battle.stage=buildExpeditionStage('dungeon','glass_garden',{}, {depth:'standard'});}
      await pending;
      expect(f.battle.run).toBeNull();expect(f.eco.s).toEqual(before);expect(localStorage.getItem('bladesurge_save_v1')).toBe(raw);
    }finally{f.assetStart.mockRestore();}
  }
}));
