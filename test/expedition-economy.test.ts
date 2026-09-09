import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy, normalizeExpedition } from '../src/game/expedition-economy.js';
import { DUNGEONS, RECIPES, ARENA_RIVALS } from '../src/data/expansion.js';
import { EXPEDITION_ITEMS } from '../src/data/expedition-items.js';
import { ITEM_BY_ID, SETS } from '../src/data/items.js';
const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => { values = new Map(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k:string) => values.get(k) ?? null, setItem: (k:string,v:string) => values.set(k,v), removeItem: (k:string) => values.delete(k) } }); });
afterEach(() => { if (old) Object.defineProperty(globalThis,'localStorage',old); else Reflect.deleteProperty(globalThis,'localStorage'); });
const make = () => { const eco = new Economy(); return { eco, x: new ExpeditionEconomy(eco) }; };
test('exactly once payout and claim survive actual save/reload', () => {
  const {eco,x}=make(); const gold=eco.s.gold; const b=x.begin('dungeon','glass_garden');
  expect(b.ok).toBe(true); expect(x.settle(b.ticket,{win:true}).ok).toBe(true);
  const paid=eco.s.gold; expect(paid).toBeGreaterThan(gold); expect(x.settle(b.ticket,{win:true}).ok).toBe(false);
  expect(x.claimQuest('garden_scout').ok).toBe(true);
  const y=make(); expect(y.x.s.stats.glass_garden).toBe(1); expect(y.x.s.materials.glass_leaf).toBe(6);
  expect(y.x.settle(b.ticket,{win:true}).ok).toBe(false); expect(y.x.claimQuest('garden_scout').ok).toBe(false);
  expect([...values.keys()].every(k=>k.startsWith('bladesurge_save_v1'))).toBe(true);
});
test('failed start refund, insufficient energy, locked and malformed modes', () => {
  const {eco,x}=make(); const before=eco.s.energy; const b=x.begin('dungeon','glass_garden');
  expect(eco.s.energy).toBe(before-4); expect(x.abandon(b.ticket).ok).toBe(true); expect(eco.s.energy).toBe(before);
  expect(x.abandon(b.ticket).ok).toBe(false); expect(x.begin('dungeon','ember_vault').ok).toBe(false);
  expect(x.begin('hacked','glass_garden').ok).toBe(false);
  eco.s.energy=0; eco.s.energyT=Date.now(); expect(x.begin('dungeon','glass_garden').ok).toBe(false);
  expect(x.begin('arena','rookie').ok).toBe(true);
});
test('reload cancels unfinished start and refunds only once', () => {
  const {eco,x}=make(); const energy=eco.s.energy; const b=x.begin('dungeon','glass_garden');
  const y=make(); expect(y.eco.s.energy).toBe(energy); expect(y.x.settle(b.ticket,{win:true}).ok).toBe(false);
  const z=make(); expect(z.eco.s.energy).toBe(energy); const next=z.x.begin('dungeon','glass_garden'); expect(next.ticket?.id).not.toBe(b.ticket?.id);
});
test('tutorial and dungeon quests unlock real base heroes and persisted jobs', () => {
  const {eco,x}=make(); expect(x.unlockJob('guardian').ok).toBe(false); x.claimQuest('first_oath');
  expect(x.unlockJob('guardian').ok).toBe(true); expect(x.selectJob('guardian').ok).toBe(true);
  x.settle(x.begin('dungeon','glass_garden').ticket,{win:true}); x.claimQuest('garden_scout');
  expect(x.unlockJob('ranger').ok).toBe(true); expect(x.selectJob('ranger').ok).toBe(true); expect(eco.s.selected).toBe('rogue');
  expect(make().x.s.selectedJob).toBe('ranger');
});
test('progression reaches every dungeon without paid resources, crafts actual unique item', () => {
  const {eco,x}=make(); x.claimQuest('first_oath');
  for(let i=0;i<6;i++) x.settle(x.begin('dungeon','glass_garden').ticket,{win:true});
  expect(x.s.level).toBeGreaterThanOrEqual(3); expect(DUNGEONS.every(d=>x.dungeonAccess(d.id).ok)).toBe(true);
  const recipe=RECIPES.find(r=>r.itemId==='exp_glasswarden_weapon')!;
  eco.s.gold=recipe.gold; const c=x.craft(recipe.id); expect(c.ok).toBe(true); expect(c.item?.id).toBe(recipe.itemId);
  expect(make().eco.s.inventory.some((i: {id:string})=>i.id===recipe.itemId)).toBe(true);
  expect(x.craft(recipe.id).ok).toBe(false);
});
test('campaign idempotency excludes base rewards and failed result', () => {
  const {eco,x}=make(); const gold=eco.s.gold; const r={win:true,receiptId:'battle-unique-1'};
  expect(x.recordCampaign(r,{code:'1-1'}).ok).toBe(true); expect(x.recordCampaign(r,{code:'1-1'}).ok).toBe(false);
  expect(make().x.recordCampaign({...r},{code:'1-1'}).ok).toBe(false); expect(eco.s.gold).toBe(gold);
  expect(x.recordCampaign({win:false},{code:'1-2'}).ok).toBe(false);
});
test('normalization rejects malformed counts, IDs and selection; save failure rolls back', () => {
  const s=normalizeExpedition({ materials:{glass_leaf:-5},consumables:{hp_tonic:Infinity},selectedJob:'evil',level:-10,claimed:['evil'],pending:{id:2,kind:'bad'} });
  expect(s.materials.glass_leaf).toBe(0); expect(s.consumables.hp_tonic).toBe(0); expect(s.selectedJob).toBe(null); expect(s.level).toBe(1); expect(s.pending).toBe(null);
  const {eco,x}=make(); const before=structuredClone(eco.s); eco.save=()=>false;
  expect(x.begin('dungeon','glass_garden').ok).toBe(false); expect(eco.s).toEqual(before);
});
test('content has distinct playable themes, actual new gear and bounded rewards', () => {
  expect(new Set(DUNGEONS.map(d=>d.theme)).size).toBe(3); expect(ARENA_RIVALS.length).toBeGreaterThanOrEqual(3);
  expect(EXPEDITION_ITEMS.length).toBe(12);
  for(const item of EXPEDITION_ITEMS) { expect((ITEM_BY_ID as Record<string, unknown>)[item.id]).toBeTruthy(); expect((SETS as Record<string, any>)[item.set].four.procs.length).toBe(2); }
  for(const d of DUNGEONS) { expect(d.energy).toBe(4); expect(d.rewards.materials).toBeTruthy(); expect(d.stage.scale).toBeLessThan(2); }
});


test('corrupt-primary recovery cannot resurrect a paid ticket or claimed quest', () => {
  const {eco,x}=make(); const b=x.begin('dungeon','glass_garden'); x.settle(b.ticket,{win:true}); x.claimQuest('garden_scout');
  const gold=eco.s.gold; values.set('bladesurge_save_v1','{broken');
  const y=make(); expect(y.eco.s.gold).toBe(gold); expect(y.x.s.pending).toBe(null);
  expect(y.x.settle(b.ticket,{win:true}).ok).toBe(false); expect(y.x.claimQuest('garden_scout').ok).toBe(false);
});
test('defeat pays nothing; all starter consumables deplete and cannot go negative', () => {
  const {eco,x}=make(); const gold=eco.s.gold; const b=x.begin('arena','rookie');
  expect(x.settle(b.ticket,{win:false}).ok).toBe(true); expect(eco.s.gold).toBe(gold); expect(x.s.stats.arenaWins).toBe(0);
  for(let i=0;i<3;i++) expect(x.consume('hp_tonic').ok).toBe(true);
  expect(x.consume('hp_tonic').ok).toBe(false); expect(x.s.consumables.hp_tonic).toBe(0);
  expect(x.consume('overdrive').ok).toBe(true); expect(x.consume('aegis').ok).toBe(true);
  expect(make().x.s.stats.consumed).toBe(5);
});

test('field rewards and hero XP settle once without duplicating allocated loot or campaign progress', () => {
  const {eco,x}=make(); const before=structuredClone(eco.s.progress); const gold=eco.s.gold;
  const ticket=x.begin('dungeon','glass_garden').ticket;
  const item=eco.fieldDrop('U'); const count=eco.s.inventory.length;
  const result={win:true,fieldRewards:{fieldGold:42,fieldStones:3,fieldStones2:2,fieldStones3:1,fieldFragments:4},fieldLoot:[item,item,{uid:-1,id:'fake'}]};
  const out=x.settle(ticket,result); expect(out.ok).toBe(true);
  expect(out.rewards?.gold).toBe(402); expect(out.rewards?.got).toContainEqual({k:'gold',n:402});
  expect(out.rewards?.heroExp).toBe(100); expect(out.rewards?.loot).toHaveLength(1);
  expect(eco.s.inventory.length).toBe(count); expect(eco.s.gold-gold).toBe(402); expect(eco.s.stones2).toBe(2); expect(eco.s.fragments).toBe(4);
  expect(eco.s.progress).toEqual(before); const paid=structuredClone(eco.s);
  expect(x.settle(ticket,result).ok).toBe(false); expect(eco.s).toEqual(paid);
  const y=make(); expect(y.eco.s.heroes.knight.exp).toBe(paid.heroes.knight.exp); expect(y.x.settle(ticket,result).ok).toBe(false);
});
test('field input bounds, silent hero XP rollback and backup failure preserve commit semantics', () => {
  const {eco,x}=make(); const ticket=x.begin('dungeon','glass_garden').ticket; const before=structuredClone(eco.s);
  const save=eco.save.bind(eco); eco.save=()=>false;
  expect(x.settle(ticket,{win:true}).ok).toBe(false); expect(eco.s).toEqual(before);
  eco.save=save;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{ if(k.endsWith('_backup')) throw new Error('quota'); values.set(k,v); },removeItem:(k:string)=>values.delete(k)}});
  const out=x.settle(ticket,{win:true,fieldRewards:{fieldGold:Infinity,fieldStones:-5,fieldStones2:10000}});
  expect(out.ok).toBe(true); expect(out.storageWarning).toBeTruthy(); expect(out.rewards?.gold).toBe(360); expect(out.rewards?.stones).toBe(0); expect(out.rewards?.stones2).toBe(100);
  expect(values.has('bladesurge_save_v1_backup')).toBe(false);
  const y=make(); expect(y.x.s.pending).toBe(null); expect(y.x.settle(ticket,{win:true}).ok).toBe(false);
});

test('free arena ignores supplied boss field currency and loot, including after retry', () => {
  const {eco,x}=make(); const item=eco.addItem('U'); eco.save();
  const before=structuredClone(eco.s); const ticket=x.begin('arena','rookie').ticket;
  const outcome={win:true,fieldRewards:{fieldGold:50000,fieldStones:30,fieldStones2:20,fieldStones3:10,fieldFragments:100},fieldLoot:[item]};
  const save=eco.save.bind(eco); eco.save=()=>false;
  expect(x.settle(ticket,outcome).ok).toBe(false); expect(eco.s.gold).toBe(before.gold);
  eco.save=save; const out=x.settle(ticket,outcome);
  expect(out.ok).toBe(true); expect(out.rewards?.got).toEqual([{k:'gold',n:60}]);
  expect(out.rewards?.xp).toBe(25); expect(out.rewards?.heroExp).toBe(25); expect(out.rewards?.rating).toBe(15); expect(out.rewards?.loot).toEqual([]);
  for(const key of ['stones','stones2','stones3','fragments']) expect(eco.s[key]).toBe(before[key]);
  expect(eco.s.inventory).toEqual(before.inventory); expect(eco.s.energy).toBe(before.energy);
  const y=make(); expect(y.x.settle(ticket,outcome).ok).toBe(false); expect(y.eco.s.gold).toBe(before.gold+60);
});

test('refining all three materials pays actual enhancement keys and persists without craft quest credit', () => {
  const {eco,x}=make(); x.s.materials={glass_leaf:1,ember_core:1,star_dust:1};
  const before=structuredClone(eco.s); let events=0; eco.onChange(()=>events++);
  expect(x.refineMaterial('glass_leaf').got).toEqual([{k:'stones',n:5}]);
  expect(x.refineMaterial('ember_core').got).toEqual([{k:'stones2',n:2}]);
  expect(x.refineMaterial('star_dust').got).toEqual([{k:'stones3',n:1}]);
  expect(eco.s.stones).toBe(before.stones+5); expect(eco.s.stones2).toBe(before.stones2+2); expect(eco.s.stones3).toBe(before.stones3+1);
  expect(eco.s.gold).toBe(before.gold-720); expect(x.s.stats.crafts).toBe(before.expedition.stats.crafts); expect(events).toBe(3);
  const y=make(); expect(y.eco.s.stones3).toBe(before.stones3+1); expect(y.x.s.materials).toEqual({glass_leaf:0,ember_core:0,star_dust:0});
});
test('refining rejects arbitrary payloads, insufficient funds, pending battles and rolls back save failure', () => {
  const {eco,x}=make(); x.s.materials.glass_leaf=1; const before=structuredClone(eco.s);
  expect(x.refineMaterial({id:'glass_leaf',stones:99999} as any).ok).toBe(false); expect(x.refineMaterial('unknown').ok).toBe(false);
  expect(x.refineMaterial('star_dust').ok).toBe(false); expect(eco.s).toEqual(before);
  eco.s.gold=119; expect(x.refineMaterial('glass_leaf').ok).toBe(false); expect(x.s.materials.glass_leaf).toBe(1); eco.s.gold=before.gold;
  const ticket=x.begin('arena','rookie').ticket; expect(x.refineMaterial('glass_leaf').ok).toBe(false); x.abandon(ticket);
  const ready=structuredClone(eco.s); eco.save=()=>false; expect(x.refineMaterial('glass_leaf').ok).toBe(false); expect(eco.s).toEqual(ready);
});
