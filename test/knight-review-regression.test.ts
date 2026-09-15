import { beforeEach, afterEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { MasterworksService } from '../src/game/masterworks-service.js';
import { ArsenalService } from '../src/game/arsenal-service.js';
import { applyKnightSlashVariant } from '../src/game/knight-builds.js';
const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let values:Map<string,string>;
beforeEach(()=>{values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});});
afterEach(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage');});
function setup(){const eco=new Economy(),app:any={eco,battle:{active:false},expeditionUI:{result:null}};
 app.expedition=new ExpeditionEconomy(eco);app.masterworks=new MasterworksService(app);app.arsenal=new ArsenalService(app);return app;}
test('legacy preset missing Q/E keeps the current hero loadout across upgrade and reload',()=>{
 const a=setup();a.eco.hero().level=50;a.eco.hero().skillLoadout=[6,7];
 a.eco.s.arsenal={heroes:{knight:{presets:[{name:'old',equipment:{}}]}}};a.eco.save();
 const b=setup();expect(b.arsenal.applyPreset(0).ok).toBe(true);expect(b.eco.hero().skillLoadout).toEqual([6,7]);
 expect(setup().eco.hero().skillLoadout).toEqual([6,7]);
});
test('legacy hero switch keeps the target hero Q/E, not the previously selected hero',()=>{
 const a=setup();a.eco.hero('knight').skillLoadout=[6,7];a.eco.hero('ranger').skillLoadout=[7,6];
 a.eco.s.arsenal={heroes:{ranger:{presets:[{name:'ranger-old',equipment:{}}]}}};a.eco.save();
 const b=setup();expect(b.arsenal.applyPreset(0,'ranger').ok).toBe(true);expect(b.eco.hero('ranger').skillLoadout).toEqual([7,6]);expect(b.eco.hero('knight').skillLoadout).toEqual([6,7]);
});
test('new preset that explicitly saved the default slots still restores them',()=>{
 const a=setup();a.eco.hero().level=50;a.eco.hero().skillLoadout=[4,5];expect(a.arsenal.savePreset(0,'explicit').ok).toBe(true);
 a.eco.hero().skillLoadout=[6,7];expect(a.arsenal.applyPreset(0).ok).toBe(true);expect(a.eco.hero().skillLoadout).toEqual([4,5]);
});
for(const variant of ['return','pierce'])test(`${variant} visible wave and actual projectile share trajectory and lifetime`,()=>{
 const shots:any[]=[],visuals:any[]=[],timers:(()=>void)[]=[],p:any={alive:true,def:{id:'knight'},pos:new THREE.Vector3(),forward:(v:THREE.Vector3)=>v.set(0,0,1)};
 const g:any={active:true,after:(_d:number,f:()=>void)=>timers.push(f),spawnProjectile:(s:any)=>shots.push(s),fx:{slashSprite:(pos:any,dir:any,_c:any,o:any)=>visuals.push({pos:pos.clone(),dir:dir.clone(),...o}),light(){}}};
 applyKnightSlashVariant(g,p,{sk:{id:'holy_slash'},dmg:100},variant);for(const t of timers)t();
 expect(shots).toHaveLength(1);expect(visuals).toHaveLength(1);
 expect(visuals[0].speed).toBe(shots[0].speed);expect(visuals[0].life).toBe(shots[0].life);
 expect(visuals[0].pos.equals(shots[0].pos)).toBe(true);expect(visuals[0].dir.equals(shots[0].dir)).toBe(true);
});
