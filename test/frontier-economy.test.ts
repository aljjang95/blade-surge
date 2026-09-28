import {afterEach, beforeEach, expect, setSystemTime, test} from 'bun:test';
import {FRONTIER_EFFECTS, SEASONAL_SEASONS, weeklyFrontier, frontierSnapshot, frontierFromSnapshot, frontierEffect, frontierEffectForStage, applyFrontierRewards} from '../src/data/seasonal-content.js';
import {DUNGEONS} from '../src/data/expansion.js';
import {Economy} from '../src/game/economy.js';
import {ExpeditionEconomy} from '../src/game/expedition-economy.js';
import {buildExpeditionStage, buildExpeditionWorld, applyBattleConsumable} from '../src/game/expedition-combat.js';
import {JourneyView} from '../src/ui/journey.js';
import {ExpeditionUI} from '../src/expansion/hub.jsx';

const dates = new Map<string, Date>();
for(let day=1; day<=365; day++){const date=new Date(Date.UTC(2026,0,day,12)),f=weeklyFrontier(date);if(!dates.has(f.effectId))dates.set(f.effectId,date);}
const at=(id:string)=>{const date=dates.get(id)!;setSystemTime(date);return weeklyFrontier(date);};
const storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
beforeEach(()=>{const values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});});
afterEach(()=>{setSystemTime();if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');});
function make(){const eco=new Economy(),x=new ExpeditionEconomy(eco);x.s.level=20;eco.s.energy=200;eco.s.sweep=20;return {eco,x};}

test('every published weekly effect resolves from valid date snapshots; wrong period/route/effect and prototype keys fail closed',()=>{
 expect([...dates.keys()].sort()).toEqual(Object.keys(FRONTIER_EFFECTS).sort());
 for(const date of dates.values()){
  const f=weeklyFrontier(date),snapshot=frontierSnapshot(f)!;
  expect(frontierFromSnapshot(snapshot)?.effects).toEqual(f.effects);
  expect(frontierFromSnapshot({...snapshot,routeId:'glass_garden-invalid'})).toBeNull();
  expect(frontierFromSnapshot({...snapshot,week:99})).toBeNull();
  expect(frontierFromSnapshot({...snapshot,year:NaN})).toBeNull();
  expect(frontierFromSnapshot({...snapshot,effectId:'__proto__'})).toBeNull();
  const other=SEASONAL_SEASONS.find(s=>!s.months.includes(date.getUTCMonth())&&s.routes.includes(snapshot.routeId));
  if(other)expect(frontierFromSnapshot({...snapshot,seasonId:other.id})).toBeNull();
 }
 for(const id of ['__proto__','constructor','toString','missing'])expect(frontierEffect(id)).toBeNull();
});

test('only the matching solo standard expedition receives a frontier, with catalog HP and no attack buff',()=>{
 const f=at('boss_hunt'),snap=frontierSnapshot(f),base=buildExpeditionStage('dungeon',f.routeId,{});
 const stage=buildExpeditionStage('dungeon',f.routeId,{}, {frontier:snap});
 expect(stage.expeditionEnemy.hp).toBe(Math.floor(base.expeditionEnemy.hp*.92));
 expect(stage.expeditionEnemy.atk).toBe(base.expeditionEnemy.atk);
 expect(stage.expeditionEnemy.atkTime).toBe(base.expeditionEnemy.atkTime);
 expect(frontierEffectForStage(stage)?.id).toBe('boss_hunt');
 for(const extra of [{party:{}},{riftId:'rift'},{expedition:{...stage.expedition,depth:'deep'}},{expedition:{...stage.expedition,kind:'arena'}},{expedition:{...stage.expedition,id:'glass_garden'}}])expect(frontierEffectForStage({...stage,...extra})).toBeNull();
 expect(buildExpeditionStage('arena','rookie',{}, {frontier:snap}).frontier).toBeUndefined();
 expect(buildExpeditionStage('dungeon','glass_garden',{}, {frontier:snap}).frontier).toBeUndefined();
});

test('healing bonus reaches actual potion consumption and respects max HP and pause',()=>{
 const f=at('potion_heal'),stage=buildExpeditionStage('dungeon',f.routeId,{}, {frontier:frontierSnapshot(f)});
 const g:any={stage,active:true,paused:false,player:{alive:true,hp:10,maxHp:100}};
 expect(applyBattleConsumable(g,'hp_tonic')).toBe(true);expect(g.player.hp).toBe(52);
 g.player.hp=90;expect(applyBattleConsumable(g,'hp_tonic')).toBe(true);expect(g.player.hp).toBe(100);
 g.player.hp=10;g.paused=true;expect(applyBattleConsumable(g,'hp_tonic')).toBe(false);expect(g.player.hp).toBe(10);
});

test('settlement owns its start snapshot across calendar rollover and caller mutation, retries storage only once',()=>{
 const f=at('final_reward'),{eco,x}=make(),def=DUNGEONS.find(d=>d.id===f.routeId)!,begin=x.begin('dungeon',f.routeId);
 expect(begin.ok).toBe(true);
 (begin.ticket as any).frontier.effectId='ash_drop';
 (begin.ticket as any).journeyPeriod.week=999999;
 expect(x.s.pending!.frontier.effectId).toBe('final_reward');
 expect(x.s.pending!.journeyPeriod.week).not.toBe(999999);
 setSystemTime(new Date('2027-01-02T00:00:00Z'));
 const save=eco.save;eco.save=()=>false;
 const heroBefore=structuredClone(eco.hero()),gold=eco.s.gold;
 expect(x.settle(begin.ticket,{win:true}).ok).toBe(false);
 expect(eco.s.gold).toBe(gold);expect(eco.hero()).toEqual(heroBefore);
 eco.save=save;
 const receipt=x.settle(begin.ticket,{win:true}) as any;
 expect(receipt.ok).toBe(true);expect(receipt.rewards.gold).toBe(def.rewards.gold*2);
 expect(receipt.rewards.xp).toBe(def.rewards.xp*2);expect(receipt.rewards.heroExp).toBe(def.rewards.xp*2);
 expect(receipt.rewards.materials).toEqual(Object.fromEntries(Object.entries(def.rewards.materials).map(([k,v])=>[k,v*2])));
 expect(x.settle(begin.ticket,{win:true}).ok).toBe(false);
});

test('treasure bonus is bounded by actual shipped room count, rejects non-numeric reports and is not granted by supply runs',()=>{
 const f=at('treasure_material'),{x}=make(),def=DUNGEONS.find(d=>d.id===f.routeId)!,key=Object.keys(def.rewards.materials)[0];
 const stage=buildExpeditionStage('dungeon',f.routeId,{}),limit=buildExpeditionWorld(stage).rooms.filter(r=>r.type==='treasure').length;
 for(const value of [NaN,Infinity,-1,1.1,'2',null])expect(applyFrontierRewards(def.rewards,f,{treasureRooms:value as any}).materials[key]).toBe(3);
 expect(applyFrontierRewards(def.rewards,f,{treasureRooms:999}).materials[key]).toBe(3+limit);
 expect(applyFrontierRewards(def.rewards,f,{treasureRooms:1}).materials[key]).toBe(4);
 x.s.stats[f.routeId]=1;expect(x.sweepPreview(f.routeId,3).rewards?.materials[key]).toBe(9);
 const begin=x.begin('dungeon',f.routeId),r=x.settle(begin.ticket,{win:true,treasureRooms:999}) as any;
 expect(r.rewards.materials[key]).toBe(3+limit);
});

test('three sweeps apply additive bonuses three times and never grant hero XP or combat progress',()=>{
 const f=at('route_material'),{eco,x}=make();x.s.stats[f.routeId]=1;
 const key=Object.keys(DUNGEONS.find(d=>d.id===f.routeId)!.rewards.materials)[0],hero=structuredClone(eco.hero());
 expect(x.sweepPreview(f.routeId,1).rewards?.materials[key]).toBe(5);
 expect(x.sweepPreview(f.routeId,3).rewards?.materials[key]).toBe(15);
 expect(x.sweepDungeon(f.routeId,3).ok).toBe(true);expect(eco.hero()).toEqual(hero);
 expect(x.s.stats[f.routeId]).toBe(1);
});

test('actual expedition result UI forwards cleared treasure rooms and caches the successful settlement',()=>{
 const f=at('treasure_material'),{x}=make(),begin=x.begin('dungeon',f.routeId);
 const view:any=Object.create(ExpeditionUI.prototype);
 const app:any={expedition:x,expeditionTicket:begin.ticket,ui:{showHud(){},show(){},closeModal(){},el:{pause:{}}}};
 view.app=app;view.open=()=>{};
 const battle:any={result:{treasureRooms:1},stage:{expedition:{kind:'dungeon',id:f.routeId,depth:'standard'}},kills:4,maxCombo:7,elapsed:20,
 drops:{gold:0,stones:0,stones2:0,stones3:0,fragments:0,loot:[]}};
 view.showResult(battle,true);
 const key=Object.keys(DUNGEONS.find(d=>d.id===f.routeId)!.rewards.materials)[0];
 expect(view.result.rewards.materials[key]).toBe(4);expect(app.expeditionTicket).toBeNull();
 const stored=structuredClone(x.s);view.showResult(battle,true);expect(x.s).toEqual(stored);
});

test('loss, arena and deep starts do not acquire or pay a frontier',()=>{
 const f=at('final_reward'),{eco,x}=make(),gold=eco.s.gold,b=x.begin('dungeon',f.routeId);
 expect(x.settle(b.ticket,{win:false}).ok).toBe(true);expect(eco.s.gold).toBe(gold);
 const arena=x.begin('arena','rookie');expect(arena.ticket?.frontier).toBeUndefined();x.abandon(arena.ticket);
 x.s.stats[f.routeId]=1;for(let ch=1;ch<=6;ch++)for(let st=1;st<=10;st++)eco.s.progress.stars[ch+'-'+st]=3;
 const deep=x.begin('dungeon',f.routeId,{depth:'deep'});expect(deep.ok).toBe(true);expect(deep.ticket?.frontier).toBeUndefined();
});

test('weekly launch has a real standard expedition action and respects unfinished results/active battles',async()=>{
 const frontier=at('potion_heal');
 for(const blocked of [false,'save','active','starting']){
  const calls:any[]=[],view:any=Object.create(JourneyView.prototype);
  view.notice={textContent:''};view.close=()=>calls.push('close');
  view.app={mode:'lobby',stageStarting:blocked==='starting',battle:{active:blocked==='active'},expeditionUI:{result:blocked==='save'?{saveError:true}:null},
   startExpedition:async(...args:any[])=>{calls.push(args);return true;}};
  expect(await view.launchFrontier(frontier.routeId,frontierSnapshot(frontier))).toBe(!blocked);
  expect(calls).toEqual(blocked?[]:['close',['dungeon',frontier.routeId,{depth:'standard',expectedFrontier:frontierSnapshot(frontier)}]]);
 }
});

test('weekly rollover refreshes an open card and blocks stale launch before any energy charge',async()=>{
 setSystemTime(new Date('2026-01-07T23:59:59Z'));
 const shown=frontierSnapshot(weeklyFrontier())!,{eco,x}=make(),before=structuredClone(eco.s);
 const view:any=Object.create(JourneyView.prototype);let renders=0,starts=0,closed=0;
 Object.assign(view,{notice:{textContent:''},strip:{textContent:''},dialog:{open:true},render:()=>renders++,close:()=>closed++,
  app:{mode:'lobby',battle:{active:false},expeditionUI:{result:null},eco,expedition:x,journey:{snapshot:()=>({steps:[]})},
   startExpedition:async()=>{starts++;return true;}}});
 view.refresh();expect(renders).toBe(1);view.refresh();expect(renders).toBe(1);
 setSystemTime(new Date('2026-01-08T00:00:01Z'));
 view.refresh();expect(renders).toBe(2);
 expect(await view.launchFrontier(shown.routeId,shown)).toBe(false);
 expect(starts).toBe(0);expect(closed).toBe(0);expect(view.notice.textContent).toContain('갱신');
 expect(x.begin('dungeon',shown.routeId,{expectedFrontier:shown}).ok).toBe(false);
 expect(eco.s).toEqual(before);
 const current=frontierSnapshot(weeklyFrontier())!;
 const started=x.begin('dungeon',current.routeId,{expectedFrontier:current});
 expect(started.ok).toBe(true);expect(started.ticket?.frontier).toEqual(current);
 expect(eco.s.energy).toBe(before.energy-4);
});
