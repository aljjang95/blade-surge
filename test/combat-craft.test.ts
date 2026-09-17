import { expect, test } from 'bun:test';
import { MELEE_ATTACK_SLOTS, canCommitMelee, packSeparation, packSteer } from '../src/game/combat-craft.js';

const mob=(x:number,z:number,extra:any={})=>({alive:true,spawning:false,state:'chase',isBoss:false,isElite:false,radius:.7,def:{ranged:false},pos:{x,z},packSide:1,...extra});

test('pack separation produces bounded opposing motion instead of exact overlap',()=>{
  const a=mob(0,0),b=mob(.35,0); const list=[a,b];
  const sa=packSeparation(a,list),sb=packSeparation(b,list);
  expect(sa.count).toBe(1);expect(sb.count).toBe(1);expect(sa.x).toBeLessThan(0);expect(sb.x).toBeGreaterThan(0);
  expect(sa.overlap).toBeGreaterThan(0);expect(Math.abs(sa.x)).toBeLessThan(10);
});

test('only three ordinary nearby melee attacks commit at once while bosses and ranged keep authority',()=>{
  const p={pos:{x:0,z:0}},self=mob(2,0); const active=Array.from({length:MELEE_ATTACK_SLOTS},(_,i)=>mob(2+i*.2,.5,{state:'attack'}));
  expect(canCommitMelee(self,[self,...active],p)).toBe(false);
  expect(canCommitMelee({...self,isBoss:true},active,p)).toBe(true);
  expect(canCommitMelee({...self,def:{ranged:true}},active,p)).toBe(true);
  active.forEach((e:any)=>e.pos.x=20);expect(canCommitMelee(self,[self,...active],p)).toBe(true);
});

test('waiting melee orbits and retreats instead of stacking on the player',()=>{
  const p={pos:{x:0,z:0}},e=mob(1,0,{packSide:1});
  const s=packSteer(e,p,{x:0,z:0},false);expect(s.x).toBeGreaterThan(0);expect(Math.abs(s.z)).toBeGreaterThan(.5);
  const allowed=packSteer(e,p,{x:.2,z:.1},true);expect(allowed).toEqual({x:.2,z:.1});
});
