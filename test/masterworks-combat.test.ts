import {test,expect} from 'bun:test';
import {postureHit,tickPosture,applyBuildStats} from '../src/game/masterworks-combat.js';
import {boonEffects,normalizeMasterworks,grantRenown} from '../src/game/masterworks-core.js';
import {MasterworksService} from '../src/game/masterworks-service.js';
import {HEROES,heroStats} from '../src/data/heroes.js';
const enemy=()=>({alive:true,spawning:false,isBoss:false,isElite:false,posture:0,breakT:0,stun:0,telegraph:1,attackDone:false,state:'attack',stateT:.1,guardBroken:0,postureMax:80,postureDelay:0});
test('only landed direct contact charges posture; break interrupts an announced hit once',()=>{
  const e=enemy();expect(postureHit(e,0)).toBe(false);expect(postureHit(e,100,{quiet:true})).toBe(false);expect(e.posture).toBe(0);
  for(let i=0;i<2;i++)expect(postureHit(e,10,{finisher:true})).toBe(false);
  expect(postureHit(e,10,{finisher:true})).toBe(true);expect(e.telegraph).toBe(0);expect(e.attackDone).toBe(true);expect(e.stun).toBe(2.2);
  expect(postureHit(e,100)).toBe(false);tickPosture(e,1);expect(e.breakT).toBeCloseTo(1.2);tickPosture(e,NaN);expect(e.breakT).toBeCloseTo(1.2);
});
test('bosses need more deliberate finishers and recover sooner; posture decays after pressure stops',()=>{
  const e={...enemy(),isBoss:true};for(let i=0;i<5;i++)expect(postureHit(e,10,{finisher:true})).toBe(false);
  expect(postureHit(e,10,{finisher:true})).toBe(true);expect(e.breakT).toBe(1.3);
  tickPosture(e,4);postureHit(e,10);tickPosture(e,2);expect(e.posture).toBe(10);tickPosture(e,1);expect(e.posture).toBe(3);
});
test('build stats are derived from base and remain bounded without mutating it',()=>{
  const base={hp:1000,atk:100,def:50,spd:6,crit:.2};const original={...base};
  const b=applyBuildStats(base,{hp:.2,atk:.1,speed:99,crit:99});expect(base).toEqual(original);expect(b.hp).toBe(1200);expect(b.atk).toBeCloseTo(110);expect(b.spd).toBeCloseTo(7.8);expect(b.crit).toBe(.45);
  const next=applyBuildStats({...base,hp:1100},{hp:.2});expect(next.hp-(b.hp-1000)).toBe(1120);
  expect(boonEffects(['storm_eye','storm_eye','storm_eye']).chain).toBe(2);
});
test('service disallows mid-battle preparation and failed persistence rolls back a purchase',()=>{
  const saved=normalizeMasterworks(undefined);grantRenown(saved,10);
  const app:any={eco:{s:{masterworks:saved}},battle:{active:true},expedition:{transact:(fn:any)=>fn()}};
  const svc=new MasterworksService(app);expect(svc.unlock('assault_1').ok).toBe(false);expect(svc.s.renown).toBe(10);
  app.battle.active=false;app.expedition.transact=(fn:any)=>{const before=structuredClone(app.eco.s);fn();app.eco.s=before;return {ok:false,error:'storage'};};
  expect(svc.unlock('assault_1').ok).toBe(false);expect(svc.s.unlocked).toEqual([]);expect(svc.s.renown).toBe(10);
});

test('build power follows final combat stats rather than the stale base rating',()=>{
  const base=heroStats(HEROES.knight,{level:5,star:1});
  expect(applyBuildStats(base).power).toBe(base.power);
  const upgraded=applyBuildStats(base,{hp:.2,atk:.1,def:.3,crit:.05});
  expect(upgraded.power).toBeGreaterThan(base.power);
  const expected=Math.floor(upgraded.atk*6+upgraded.hp*.5+upgraded.def*4+upgraded.crit*1000+(upgraded.critDmg-1.5)*500);
  expect(upgraded.power).toBe(expected);expect(base.power).toBe(heroStats(HEROES.knight,{level:5,star:1}).power);
  const lower=applyBuildStats(base,{hp:-.2,atk:-.2,def:-.2});expect(lower.power).toBeLessThan(base.power);
  expect(applyBuildStats({...base,power:-999},{speed:.3}).power).toBe(base.power);
});
test('preparation presets round-trip independent copies and reject out-of-range slots',()=>{
  const app:any={eco:{s:{}},battle:{active:false},expedition:{transact:(fn:any)=>fn()}};const svc=new MasterworksService(app);
  svc.path('hunter');svc.challenge('iron');svc.savePreset(1);svc.challenge('iron');svc.path('balanced');
  expect(svc.s.presets[1].challengeIds).toEqual(['iron']);svc.usePreset(1);expect(svc.s.path).toBe('hunter');expect(svc.s.challengeIds).toEqual(['iron']);
  expect(svc.usePreset(99).ok).toBe(false);expect(svc.savePreset(-1).ok).toBe(false);
});
