import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { MasterworksService } from '../src/game/masterworks-service.js';
import { ArsenalService } from '../src/game/arsenal-service.js';
import { normalizeArsenal } from '../src/game/arsenal-core.js';

const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
let values:Map<string,string>;
beforeEach(()=>{values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});});
afterEach(()=>{if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage');});

function make(){
  const eco=new Economy(),app:any={eco,battle:{active:false},expeditionUI:{result:null},stageStarting:false};
  app.expedition=new ExpeditionEconomy(eco);app.masterworks=new MasterworksService(app);app.arsenal=new ArsenalService(app);return app;
}
function equipEcho(app:any){
  const ids=['arm_echo_weapon','arm_echo_armor','arm_echo_ring','arm_echo_boots'];
  const slots=['weapon','armor','ring','boots'];
  ids.forEach((id,index)=>app.eco.s.inventory.push({uid:900+index,id,enh:0}));
  slots.forEach((slot,index)=>app.eco.s.heroes.knight.equip[slot]=900+index);app.eco.s.invSeq=904;
}

test('legacy arsenal preset gains safe Q/E fallback without inventing equipment',()=>{
  const state=normalizeArsenal({heroes:{knight:{presets:[{name:'legacy',equipment:{}}]}}});
  const preset=state.heroes.knight.presets[0]; expect(preset).not.toBeNull();
  expect(preset!.skillLoadout).toEqual([4,5]);
  expect(Object.values(preset!.equipment)).toEqual([null,null,null,null]);
});

test('four-piece echo set exposes returning slash identity while two-piece stays classic',()=>{
  const app=make();equipEcho(app);
  expect(app.arsenal.variantForHero('knight')).toBe('return');
  app.eco.s.heroes.knight.equip.ring=null;app.eco.s.heroes.knight.equip.boots=null;
  expect(app.arsenal.variantForHero('knight')).toBe('classic');
});

test('preset restore is atomic for equipment-driven slash identity and Q/E underlying indexes',()=>{
  const app=make();equipEcho(app);app.eco.s.heroes.knight.level=50;app.eco.s.heroes.knight.skillLoadout=[6,7];
  expect(app.arsenal.savePreset(0,'잔향 귀환').ok).toBe(true);
  expect(app.arsenal.s.heroes.knight.presets[0].skillLoadout).toEqual([6,7]);
  app.eco.s.heroes.knight.equip={weapon:null,armor:null,ring:null,boots:null};app.eco.s.heroes.knight.skillLoadout=[4,5];
  expect(app.arsenal.variantForHero('knight')).toBe('classic');
  expect(app.arsenal.applyPreset(0).ok).toBe(true);
  expect(app.eco.s.heroes.knight.skillLoadout).toEqual([6,7]);
  expect(app.arsenal.variantForHero('knight')).toBe('return');
  expect(Object.values(app.eco.s.heroes.knight.equip)).toEqual([900,901,902,903]);
});
