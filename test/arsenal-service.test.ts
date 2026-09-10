import { beforeEach,afterEach,test,expect } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { MasterworksService } from '../src/game/masterworks-service.js';
import { ArsenalService } from '../src/game/arsenal-service.js';
import { normalizeArsenal } from '../src/game/arsenal-core.js';
import { heroStats,HEROES } from '../src/data/heroes.js';
import { resolveJobHero } from '../src/data/jobs.js';
import { applyBuildStats } from '../src/game/masterworks-combat.js';
import { masteryEffects } from '../src/game/masterworks-core.js';
const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let values:Map<string,string>,fail=false;
beforeEach(()=>{values=new Map();fail=false;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{if(fail)throw new Error('quota');values.set(k,v);},removeItem:(k:string)=>values.delete(k)}});});
afterEach(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage');});
function make(){const eco=new Economy();const app:any={eco,battle:{active:false},expeditionUI:{result:null}};app.expedition=new ExpeditionEconomy(eco);app.masterworks=new MasterworksService(app);app.arsenal=new ArsenalService(app);return app;}
function gear(a:any){a.eco.s.inventory.push({uid:31,id:'exp_glasswarden_armor',enh:2},{uid:32,id:'exp_glasswarden_weapon',enh:1});a.eco.s.invSeq=33;a.eco.s.heroes.knight.equip.armor=31;a.eco.s.heroes.knight.equip.weapon=32;}
test('arsenal additive migration validates IDs, slots and floating mix without altering legacy equipment',()=>{
 const s=normalizeArsenal({mix:{music:.32,sfx:5,voice:NaN},heroes:{knight:{artId:'unknown',presets:[{name:'<strong>my build</strong>',jobId:'ranger',pathId:'unknown',challengeIds:['iron','fake','iron'],equipment:{armor:{uid:31,id:'exp_glasswarden_weapon'},weapon:{uid:-1,id:'exp_glasswarden_weapon'}}}]}}});
 expect(s.mix).toEqual({music:.32,sfx:1,voice:1});expect(Object.keys(s.heroes)).toHaveLength(5);expect(s.heroes.knight.artId).toBe('rupture');
 expect(s.heroes.knight.presets[0]).toMatchObject({jobId:null,pathId:'balanced',challengeIds:['iron'],equipment:{armor:null,weapon:null}});
 const a=make();gear(a);a.eco.save();const b=make();expect(b.eco.s.inventory).toEqual(a.eco.s.inventory);expect(b.eco.s.heroes).toEqual(a.eco.s.heroes);
});
test('saved build restores real enhanced equipment, job, path, vows and art atomically across reload',()=>{
 const a=make();gear(a);a.eco.s.expedition.unlockedJobs=['guardian'];a.eco.s.expedition.selectedJob='guardian';a.masterworks.s.path='vanguard';a.masterworks.s.challengeIds=['iron'];a.arsenal.setArt('aegis');
 expect(a.arsenal.savePreset(0,'보호 선봉').ok).toBe(true);const inventory=structuredClone(a.eco.s.inventory),gold=a.eco.s.gold;
 a.eco.s.heroes.knight.equip={weapon:null,armor:null,ring:null,boots:null};a.eco.s.heroes.ranger.equip.armor=31;a.eco.s.expedition.selectedJob=null;a.masterworks.s.path='balanced';a.masterworks.s.challengeIds=[];a.arsenal.setArt('flow');
 const preview=a.arsenal.preview(0);expect(preview.valid).toBe(true);expect(preview.transfers).toEqual([{uid:31,item:'유리 파수꾼의 갑옷',owner:'ranger'}]);
 const expected=applyBuildStats(heroStats(resolveJobHero(HEROES.knight,'guardian'),a.eco.hero(),a.eco.heroEquipBonus('knight',{weapon:32,armor:31,ring:null,boots:null})),masteryEffects({...a.masterworks.s,path:'vanguard'}));expect(preview.after.stats).toEqual(expected);
 expect(a.arsenal.applyPreset(0).ok).toBe(true);expect(a.eco.hero().equip.armor).toBe(31);expect(a.eco.s.heroes.ranger.equip.armor).toBe(null);expect(a.eco.s.expedition.selectedJob).toBe('guardian');expect(a.masterworks.s.path).toBe('vanguard');expect(a.masterworks.s.challengeIds).toEqual(['iron']);expect(a.arsenal.artForHero()).toBe('aegis');expect(a.eco.s.inventory).toEqual(inventory);expect(a.eco.s.gold).toBe(gold);
 const b=make();expect(b.arsenal.s).toEqual(a.arsenal.s);expect(b.eco.hero().equip).toEqual(a.eco.hero().equip);expect(b.arsenal.preview(0).after.stats).toEqual(expected);
});
test('missing, recycled or wrong-slot equipment blocks the entire saved build without silently substituting gear',()=>{
 const a=make();gear(a);a.arsenal.savePreset(0);a.eco.s.inventory=a.eco.s.inventory.filter((i:any)=>i.uid!==31);a.eco.s.heroes.knight.equip.armor=null;const before=structuredClone(a.eco.s);
 expect(a.arsenal.preview(0).valid).toBe(false);expect(a.arsenal.applyPreset(0).ok).toBe(false);expect(a.eco.s).toEqual(before);
 a.eco.s.inventory.push({uid:31,id:'w_storm',enh:9});expect(a.arsenal.applyPreset(0).ok).toBe(false);
});
test('save failure rolls back build swaps, mix and art and retry succeeds',()=>{
 const a=make();gear(a);a.arsenal.savePreset(0);a.eco.s.heroes.knight.equip.armor=null;a.eco.s.heroes.ranger.equip.armor=31;a.arsenal.setArt('flow');const before=structuredClone(a.eco.s);fail=true;
 expect(a.arsenal.applyPreset(0).ok).toBe(false);expect(a.eco.s).toEqual(before);expect(a.arsenal.setArt('aegis').ok).toBe(false);expect(a.arsenal.s).toEqual(before.arsenal);expect(a.arsenal.setMix({music:.13}).ok).toBe(false);expect(a.arsenal.s.mix).toEqual(before.arsenal.mix);
 fail=false;expect(a.arsenal.applyPreset(0).ok).toBe(true);expect(a.eco.s.heroes.ranger.equip.armor).toBe(null);expect(make().eco.hero().equip.armor).toBe(31);
});
test('locked job, invalid slots and battle or unsaved settlement cannot change loadouts',()=>{
 const a=make();gear(a);expect(a.arsenal.savePreset(9).ok).toBe(false);expect(a.arsenal.setArt('hack').ok).toBe(false);a.arsenal.savePreset(0);a.arsenal.s.heroes.knight.presets[0].jobId='guardian';expect(a.arsenal.applyPreset(0).ok).toBe(false);a.arsenal.s.heroes.knight.presets[0].jobId=null;
 a.battle.active=true;expect(a.arsenal.setArt('aegis').ok).toBe(false);expect(a.arsenal.savePreset(1).ok).toBe(false);expect(a.arsenal.applyPreset(0).ok).toBe(false);expect(a.arsenal.setMix({music:.3}).ok).toBe(true);
 a.battle.active=false;a.expeditionUI.result={saveError:true};expect(a.arsenal.applyPreset(0).ok).toBe(false);
});
test('three per-hero configurations are isolated and empty equipment slots intentionally unequip',()=>{
 const a=make();gear(a);a.arsenal.savePreset(0,'전투');a.eco.s.heroes.knight.equip={weapon:null,armor:null,ring:null,boots:null};a.arsenal.setArt('flow');a.arsenal.savePreset(1,'기동');a.arsenal.savePreset(0,'실바 구성','ranger');
 expect(a.arsenal.s.heroes.ranger.presets[0].name).toBe('실바 구성');expect(a.arsenal.s.heroes.knight.presets[0].name).toBe('전투');expect(a.arsenal.applyPreset(0).ok).toBe(true);expect(a.eco.hero().equip.armor).toBe(31);expect(a.arsenal.applyPreset(1).ok).toBe(true);expect(Object.values(a.eco.hero().equip)).toEqual([null,null,null,null]);expect(a.arsenal.artForHero()).toBe('flow');
});
test('mix controls persist fractional values and return detached snapshots',()=>{
 const a=make();expect(a.arsenal.setMix({music:.24,sfx:.73,voice:.6}).ok).toBe(true);expect(make().arsenal.s.mix).toEqual({music:.24,sfx:.73,voice:.6});expect(a.arsenal.setMix({sfx:-1}).mix.sfx).toBe(0);
});
