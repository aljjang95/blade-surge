import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { JourneyService } from '../src/game/journey-service.js';
import { DUNGEONS, RECIPES } from '../src/data/expansion.js';
import { periodAt } from '../src/game/journey-core.js';
import { buildExpeditionStage } from '../src/game/expedition-combat.js';
import { RIFT_RULES, applyRiftStage, applyRiftEnemy } from '../src/game/journey-rifts.js';
const old = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
let values: Map<string,string>, fail=false;
beforeEach(()=>{values=new Map();fail=false;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{if(fail)throw new Error('quota');values.set(k,v);},removeItem:(k:string)=>values.delete(k)}});});
afterEach(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage');});
function make(){const eco=new Economy();const app:any={eco,battle:{active:false},expeditionUI:{result:null}};app.expedition=new ExpeditionEconomy(eco);app.journey=new JourneyService(app);return app;}
function win(app:any,id='glass_garden',options={}){const start=app.expedition.begin('dungeon',id,options);expect(start.ok).toBe(true);return app.expedition.settle(start.ticket,{win:true});}
test('manual dungeon settlement records exactly one durable contract victory',()=>{
  const a=make(),b=a.expedition.begin('dungeon','glass_garden');
  expect(a.expedition.settle(b.ticket,{win:true}).ok).toBe(true);
  expect(a.journey.s.daily.wins).toBe(1);
  expect(a.expedition.settle(b.ticket,{win:true}).ok).toBe(false);
  const next=make();expect(next.journey.s.daily.wins).toBe(1);
  const gold=next.eco.s.gold;expect(next.journey.claim('daily','first_dungeon').ok).toBe(true);
  expect(next.eco.s.gold).toBe(gold+600);expect(make().journey.claim('daily','first_dungeon').ok).toBe(false);
});
test('failed settlement and claim roll back currency, counters and pending receipt',()=>{
  const a=make(),b=a.expedition.begin('dungeon','glass_garden'),before=structuredClone(a.eco.s);fail=true;
  expect(a.expedition.settle(b.ticket,{win:true}).ok).toBe(false);expect(a.eco.s).toEqual(before);
  fail=false;expect(a.expedition.settle(b.ticket,{win:true}).ok).toBe(true);
  const paid=structuredClone(a.eco.s);fail=true;expect(a.journey.claim('daily','first_dungeon').ok).toBe(false);expect(a.eco.s).toEqual(paid);
  fail=false;expect(a.journey.claim('daily','first_dungeon').ok).toBe(true);
});
test('defeat, AI arena and supply sweeps do not count as real dungeon contracts',()=>{
  const a=make();a.expedition.settle(a.expedition.begin('dungeon','glass_garden').ticket,{win:false});
  a.expedition.settle(a.expedition.begin('arena','rookie').ticket,{win:true});expect(a.journey.s.daily.wins).toBe(0);
  win(a);const before=structuredClone(a.eco.s.journey),stats=structuredClone(a.expedition.s.stats),hero=structuredClone(a.eco.hero());
  expect(a.expedition.sweepDungeon('glass_garden',1).ok).toBe(true);expect(a.eco.s.journey).toEqual(before);expect(a.expedition.s.stats).toEqual(stats);expect(a.eco.hero()).toEqual(hero);
});
test('batch sweep charges exact resources and matches fixed preview with no random gear',()=>{
  const a=make();win(a);const p=a.expedition.sweepPreview('glass_garden',3),before=structuredClone(a.eco.s);
  const out=a.expedition.sweepDungeon('glass_garden',3);expect(out.ok).toBe(true);
  expect(a.eco.s.energy).toBe(before.energy-p.energy);expect(a.eco.s.sweep).toBe(before.sweep-3);
  expect(a.expedition.s.materials.glass_leaf).toBe(before.expedition.materials.glass_leaf+p.rewards.materials.glass_leaf);
  expect(a.eco.s.inventory).toEqual(before.inventory);expect(out.rewards.gold).toBe(p.rewards.gold);
  expect(out.rewards.xp).toBe(p.rewards.xp);expect(a.eco.s.gold).toBe(before.gold+p.rewards.gold+out.rewards.levelGold);
});
test('sweep rejects locked, fractional and unpaid batches; storage failures spend nothing',()=>{
  const a=make();expect(a.expedition.sweepDungeon('glass_garden',1).ok).toBe(false);win(a);
  for(const n of [0,-1,4,1.5,NaN,Infinity])expect(a.expedition.sweepDungeon('glass_garden',n).ok).toBe(false);
  const before=structuredClone(a.eco.s);fail=true;expect(a.expedition.sweepDungeon('glass_garden',3).ok).toBe(false);expect(a.eco.s).toEqual(before);fail=false;
  a.eco.s.sweep=0;expect(a.expedition.sweepDungeon('glass_garden',1).ok).toBe(false);
});
test('target equipment tracks real recipe, same item uid, owner and reload',()=>{
  const a=make(),recipe=RECIPES.find(r=>r.itemId?.startsWith('a_glass'))||RECIPES.find(r=>r.itemId)!;
  expect(a.journey.track(recipe.id).ok).toBe(true);let t=a.journey.target();expect(t.owned).toBeNull();expect(t.materials.some((m:any)=>m.missing>0)).toBe(true);
  a.eco.s.gold=recipe.gold;for(const[k,n]of Object.entries(recipe.materials))a.expedition.s.materials[k]=n;
  expect(a.journey.target().ready).toBe(true);const crafted=a.expedition.craft(recipe.id);expect(crafted.ok).toBe(true);
  expect(a.journey.target().owned.uid).toBe(crafted.item.uid);expect(a.journey.equipTarget().ok).toBe(true);expect(a.journey.target().equipped).toBe(true);
  const next=make();expect(next.journey.target().owned.uid).toBe(crafted.item.uid);expect(next.journey.target().equipped).toBe(true);
});
test('milestone reward and target/autoplay changes use save boundary and battle guards',()=>{
  const a=make();expect(a.journey.claimStep('oath').ok).toBe(false);a.expedition.claimQuest('first_oath');const gold=a.eco.s.gold;
  expect(a.journey.claimStep('oath').ok).toBe(true);expect(a.eco.s.gold).toBe(gold+500);
  expect(a.journey.claimStep('oath').ok).toBe(false);expect(a.journey.setAuto(true).ok).toBe(true);expect(make().journey.s.autoBattle).toBe(true);
  a.battle.active=true;expect(a.journey.track(RECIPES[0].id).ok).toBe(false);expect(a.journey.claim('daily','first_dungeon').ok).toBe(false);
  fail=true;expect(a.journey.setAuto(false).ok).toBe(false);expect(a.journey.s.autoBattle).toBe(true);
});
test('rift ticket is bound to the current rotation; payout includes visible fixed bonus',()=>{
  const a=make();a.expedition.s.level=10;const rotation=DUNGEONS[periodAt(Date.now()).day%3];
  const wrong=DUNGEONS.find(d=>d.id!==rotation.id)!;expect(a.expedition.begin('dungeon',wrong.id,{rift:true}).ok).toBe(false);
  const b=a.expedition.begin('dungeon',rotation.id,{rift:true});expect(b.ok).toBe(true);
  const stage=applyRiftStage(buildExpeditionStage('dungeon',rotation.id,a.eco),b.ticket);expect(stage.riftId).toBe(b.ticket.riftId);
  const out=a.expedition.settle(b.ticket,{win:true});expect(out.rewards.gold).toBe(rotation.rewards.gold+200);
  expect(Object.values(out.rewards.materials)).toEqual([5]);expect(a.journey.s.daily.wins).toBe(1);
});
test('every rift modifies real enemy stats and never leaks into the AI arena',()=>{
  for(const rule of RIFT_RULES){const e={maxHp:100,hp:100,atk:10};applyRiftEnemy(e,{riftId:rule.id,expedition:{kind:'dungeon'}});expect(e.maxHp).toBe(Math.round(100*rule.hp));expect(e.atk).toBe(10*rule.atk);
    const ai={maxHp:100,hp:100,atk:10};applyRiftEnemy(ai,{riftId:rule.id,expedition:{kind:'arena'}});expect(ai).toEqual({maxHp:100,hp:100,atk:10});}
});
