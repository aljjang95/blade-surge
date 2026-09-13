import {beforeEach,afterEach,expect,test} from 'bun:test';
import {Economy} from '../src/game/economy.js';
import {ExpeditionEconomy,normalizeExpedition} from '../src/game/expedition-economy.js';
import {EXPEDITION_DEPTHS} from '../src/data/expedition-depths.js';
import {DUNGEONS} from '../src/data/expansion.js';
const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
let values:Map<string,string>;
beforeEach(()=>{values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});});
afterEach(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage');});
const make=()=>{const eco=new Economy();return {eco,x:new ExpeditionEconomy(eco)};};
function unlock(f:ReturnType<typeof make>,def:(typeof EXPEDITION_DEPTHS)[number]){f.x.s.level=def.minLevel;f.x.s.stats[def.id]=1;f.eco.s.progress.stars[def.unlockCode]=1;}

test('deep gates require actual campaign stars, base victory and account level independently',()=>{
 for(const def of EXPEDITION_DEPTHS){const f=make();f.x.s.level=50;const before=f.eco.s.energy;
  expect(f.x.begin('dungeon',def.id,{depth:'deep'}).ok).toBe(false);
  f.eco.s.progress.unlocked=60;expect(f.x.dungeonAccess(def.id,{depth:'deep'}).ok).toBe(false);
  f.eco.s.progress.stars[def.unlockCode]=1;expect(f.x.begin('dungeon',def.id,{depth:'deep'}).ok).toBe(false);
  f.x.s.stats[def.id]=1;f.x.s.level=def.minLevel-1;expect(f.x.dungeonAccess(def.id,{depth:'deep'}).ok).toBe(false);
  f.x.s.level=def.minLevel;expect(f.x.dungeonAccess(def.id,{depth:'deep'}).ok).toBe(true);expect(f.eco.s.energy).toBe(before);
 }
});
test('unknown modes, arena deep, deep rift and insufficient six-energy starts change nothing',()=>{
 const f=make();unlock(f,EXPEDITION_DEPTHS[0]);
 for(const options of [{depth:'unknown'},{depth:null},{depth:'deep',rift:true}]){const before=structuredClone(f.eco.s);expect(f.x.begin('dungeon','glass_garden',options as any).ok).toBe(false);expect(f.eco.s).toEqual(before);}
 expect(f.x.begin('arena','rookie',{depth:'deep'}).ok).toBe(false);
 f.eco.s.energy=5;f.eco.s.energyT=Date.now();expect(f.x.begin('dungeon','glass_garden',{depth:'deep'}).ok).toBe(false);expect(f.eco.s.energy).toBe(5);
});
for(const def of EXPEDITION_DEPTHS)test(`${def.id}: first/repeat rewards, hero XP, contracts and depth wins survive reload`,()=>{
 const f=make();unlock(f,def);const energy=f.eco.s.energy;
 const ticket=f.x.begin('dungeon',def.id,{depth:'deep'}).ticket;expect(f.eco.s.energy).toBe(energy-def.energy);
 const first=f.x.settle(ticket,{win:true,rewards:{gold:999999},depth:'standard'} as any);expect(first.ok).toBe(true);expect(first.rewards?.firstClear).toBe(true);
 expect(first.rewards?.gold).toBe(def.rewards.gold+def.firstRewards.gold);expect(first.rewards?.heroExp).toBe(def.rewards.xp);
 const material=Object.keys(def.rewards.materials)[0];expect(first.rewards?.materials[material]).toBe((def.rewards.materials as any)[material]+(def.firstRewards.materials as any)[material]);
 expect(f.x.s.depthWins[def.id]).toBe(1);expect(f.eco.s.journey.daily.wins).toBe(1);expect(f.eco.s.journey.weekly.wins).toBe(1);expect(f.x.s.stats[def.id]).toBe(2);
 const g=make();expect(g.x.s.depthWins[def.id]).toBe(1);expect(g.x.settle(ticket,{win:true}).ok).toBe(false);
 const repeat=g.x.settle(g.x.begin('dungeon',def.id,{depth:'deep'}).ticket,{win:true});expect(repeat.rewards?.firstClear).toBe(false);expect(repeat.rewards?.gold).toBe(def.rewards.gold);expect(repeat.rewards?.materials[material]).toBe((def.rewards.materials as any)[material]);expect(make().x.s.depthWins[def.id]).toBe(2);
});
test('settlement rejects mode tampering both ways and ignores ticket reward/cost data',()=>{
 const f=make();unlock(f,EXPEDITION_DEPTHS[0]);let ticket=f.x.begin('dungeon','glass_garden',{depth:'deep'}).ticket;
 for(const depth of ['standard',undefined,'bad',null]){const before=structuredClone(f.eco.s);expect(f.x.settle({...ticket,depth},{win:true}).ok).toBe(false);expect(f.x.abandon({...ticket,depth}).ok).toBe(false);expect(f.eco.s).toEqual(before);}
 expect(f.x.abandon({...ticket,energy:999999}).ok).toBe(true);
 ticket=f.x.begin('dungeon','glass_garden').ticket;expect(f.x.settle({...ticket,depth:'deep'},{win:true}).ok).toBe(false);expect(f.x.settle({...ticket,energy:0,rewards:{gold:999999}},{win:true}).rewards?.gold).toBe(DUNGEONS[0].rewards.gold);expect(f.x.s.depthWins.glass_garden).toBe(0);
});
test('loss pays nothing; failed durable settlement preserves first clear for a single retry',()=>{
 const f=make();unlock(f,EXPEDITION_DEPTHS[0]);const loss=f.x.begin('dungeon','glass_garden',{depth:'deep'}).ticket;const gold=f.eco.s.gold;expect(f.x.settle(loss,{win:false}).rewards).toEqual({});expect(f.eco.s.gold).toBe(gold);expect(f.x.s.depthWins.glass_garden).toBe(0);
 const ticket=f.x.begin('dungeon','glass_garden',{depth:'deep'}).ticket,before=structuredClone(f.eco.s),save=f.eco.save;f.eco.save=()=>false;
 expect(f.x.settle(ticket,{win:true}).ok).toBe(false);expect(f.eco.s).toEqual(before);f.eco.save=save;
 const first=f.x.settle(ticket,{win:true});expect(first.rewards?.firstClear).toBe(true);const paid=structuredClone(f.eco.s);expect(f.x.settle(ticket,{win:true}).ok).toBe(false);expect(f.eco.s).toEqual(paid);expect(make().x.s.depthWins.glass_garden).toBe(1);
});
test('pending deep reload refunds catalog six energy exactly once and never resumes',()=>{
 const f=make();unlock(f,EXPEDITION_DEPTHS[0]);const energy=f.eco.s.energy,ticket=f.x.begin('dungeon','glass_garden',{depth:'deep'}).ticket;
 const g=make();expect(g.eco.s.energy).toBe(energy);expect(g.x.s.pending).toBeNull();expect(g.x.settle(ticket,{win:true}).ok).toBe(false);expect(make().eco.s.energy).toBe(energy);
 const raw=normalizeExpedition({pending:{...ticket,energy:999999},depthWins:{glass_garden:2,ember_vault:-1,star_archive:NaN,unknown:99}});
 expect(raw.pending?.energy).toBe(EXPEDITION_DEPTHS[0].energy);expect(raw.depthWins).toEqual({glass_garden:2,ember_vault:0,star_archive:0});
});
test('standard supply retains base price/reward and never grants deep or combat progress',()=>{
 const f=make();unlock(f,EXPEDITION_DEPTHS[0]);f.eco.s.sweep=1;const p=f.x.sweepPreview('glass_garden');expect(p.energy).toBe(4);expect(p.rewards?.gold).toBe(DUNGEONS[0].rewards.gold);
 expect(f.x.sweepDungeon('glass_garden').ok).toBe(true);expect(f.x.s.depthWins.glass_garden).toBe(0);expect(f.eco.s.journey.daily.wins).toBe(0);
 const save=f.eco.save,before=structuredClone(f.eco.s);f.eco.save=()=>false;expect(f.x.begin('dungeon','glass_garden',{depth:'deep'}).ok).toBe(false);expect(f.eco.s).toEqual(before);f.eco.save=save;
});
