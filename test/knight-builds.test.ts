import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { SKILLS } from '../src/game/skills.js';
import { KNIGHT_SLASH_BUILD_IDS, KNIGHT_SLASH_VARIANTS, applyKnightSlashVariant, knightSlashVariantFromBonus, normalizeKnightSlashVariant } from '../src/game/knight-builds.js';

const player = () => ({ alive:true, def:{id:'knight'}, pos:new THREE.Vector3(), forward:(v:THREE.Vector3)=>v.set(0,0,1) });
const ctx = { sk:{id:'holy_slash'}, dmg:100 };
const game = (procs:string[] = []) => {
  const timers:any[] = [], shots:any[] = [], hits:any[] = [], vacuums:any[] = [];
  return { active:true, stage:{}, procs:new Set(procs), timers, shots, hits, vacuums, app:{eco:{heroEquipBonus:()=>({procs})}},
    after:(delay:number,fn:()=>void)=>timers.push({delay,fn}), spawnProjectile:(shot:any)=>shots.push(shot),
    hitRadius:(...args:any[])=>hits.push(args), vacuum:(...args:any[])=>vacuums.push(args), renderer:{shake(){}},
    fx:{ castCircle(){}, slashSprite(){}, holyBurst(){}, light(){}, shockTex(){}, groundTex(){} } };
};

test('knight exposes exactly three complete-set build identities while legacy stays classic',()=>{
  expect(KNIGHT_SLASH_BUILD_IDS).toEqual(['return','fissure','pierce']);
  expect(KNIGHT_SLASH_BUILD_IDS.map(id=>KNIGHT_SLASH_VARIANTS[id as keyof typeof KNIGHT_SLASH_VARIANTS].setId)).toEqual(['arm_echo','arm_anchor','arm_aegis']);
  expect(normalizeKnightSlashVariant(undefined)).toBe('classic');
  expect(normalizeKnightSlashVariant('classic')).toBe('classic');
  expect(normalizeKnightSlashVariant('return')).toBe('return');
  expect(knightSlashVariantFromBonus({procs:['arm_echo']})).toBe('classic');
  expect(knightSlashVariantFromBonus({procs:['arm_echo','arm_echo_master']})).toBe('return');
  expect(knightSlashVariantFromBonus({procs:['arm_anchor_master']})).toBe('fissure');
  expect(knightSlashVariantFromBonus({procs:['arm_aegis_master']})).toBe('pierce');
});

test('classic and unrelated casts preserve the current skill without additive effects',()=>{
  const g:any=game(),p:any=player();
  expect(applyKnightSlashVariant(g,p,ctx,'classic')).toBe(false);
  expect(applyKnightSlashVariant(g,p,{...ctx,sk:{id:'shield_bash'}},'return')).toBe(false);
  expect(g.timers).toHaveLength(0); expect(g.shots).toHaveLength(0); expect(g.hits).toHaveLength(0);
});

test('return build schedules one reverse piercing wave after the baseline slash',()=>{
  const g:any=game(),p:any=player(); expect(applyKnightSlashVariant(g,p,ctx,'return')).toBe(true);
  expect(g.timers).toHaveLength(1); g.timers[0].fn(); expect(g.shots).toHaveLength(1);
  expect(g.shots[0]).toMatchObject({radius:1.45,dmg:48,pierce:true}); expect(g.shots[0].dir.z).toBeLessThan(0);
});

test('fissure build creates one persistent kill zone with three bounded pulses',()=>{
  const g:any=game(),p:any=player(); expect(applyKnightSlashVariant(g,p,ctx,'fissure')).toBe(true);
  expect(g.timers).toHaveLength(3); for(const t of g.timers)t.fn(); expect(g.hits).toHaveLength(3); expect(g.shots).toHaveLength(0); expect(g.vacuums).toHaveLength(3);
  for(const hit of g.hits){expect(hit[1]).toBe(3.2);expect(hit[2]).toBeCloseTo(28,8);expect(hit[3]).toMatchObject({noProc:true,quietStop:true});}
  expect(g.vacuums.every((v:any[])=>v[1]===4.5&&v[2]===8)).toBe(true);
});

test('pierce build is a replacement shot, not baseline plus free extra damage',()=>{
  const g:any=game(),p:any=player(); expect(applyKnightSlashVariant(g,p,ctx,'pierce')).toBe(true);
  expect(g.timers).toHaveLength(0); expect(g.shots).toHaveLength(1); expect(g.shots[0]).toMatchObject({speed:32,radius:.72,dmg:135,pierce:true,kb:9});
});

test('installed pierce variant replaces the wide baseline holy slash in actual skill dispatch',()=>{
  const g:any=game(['arm_aegis_master']),p:any=player();
  SKILLS.holy_slash.cast(g,p,ctx as any);
  expect(g.shots).toHaveLength(1); expect(g.shots[0]).toMatchObject({radius:.72,dmg:135});
});
