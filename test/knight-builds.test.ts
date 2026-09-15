import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { KNIGHT_SLASH_BUILD_IDS, KNIGHT_SLASH_VARIANTS, applyKnightSlashVariant, normalizeKnightSlashVariant } from '../src/game/knight-builds.js';

const player = () => ({ alive:true, def:{id:'knight'}, pos:new THREE.Vector3(), forward:(v:THREE.Vector3)=>v.set(0,0,1) });
const ctx = { sk:{id:'holy_slash'}, dmg:100 };
const game = () => {
  const timers:any[] = [], shots:any[] = [], hits:any[] = [];
  return { active:true, timers, shots, hits,
    after:(delay:number,fn:()=>void)=>timers.push({delay,fn}), spawnProjectile:(shot:any)=>shots.push(shot),
    hitRadius:(...args:any[])=>hits.push(args), fx:{ slashSprite(){}, shockTex(){} } };
};

test('knight exposes exactly three selectable build identities while legacy stays classic',()=>{
  expect(KNIGHT_SLASH_BUILD_IDS).toEqual(['return','fissure','pierce']);
  expect(KNIGHT_SLASH_BUILD_IDS.map(id=>KNIGHT_SLASH_VARIANTS[id].setId)).toEqual(['echo','anchor','aegis']);
  expect(normalizeKnightSlashVariant(undefined)).toBe('classic');
  expect(normalizeKnightSlashVariant('classic')).toBe('classic');
  expect(normalizeKnightSlashVariant('return')).toBe('return');
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
  expect(g.shots[0]).toMatchObject({radius:1.55,dmg:48,pierce:true,noProc:true}); expect(g.shots[0].dir.z).toBeLessThan(0);
});

test('fissure build creates three bounded delayed zones and no extra projectile',()=>{
  const g:any=game(),p:any=player(); expect(applyKnightSlashVariant(g,p,ctx,'fissure')).toBe(true);
  expect(g.timers).toHaveLength(3); for(const t of g.timers)t.fn(); expect(g.hits).toHaveLength(3); expect(g.shots).toHaveLength(0);
  for(const hit of g.hits){expect(hit[1]).toBe(2.35);expect(hit[2]).toBe(28);expect(hit[3]).toMatchObject({noProc:true,quietStop:true});}
});

test('pierce build emits one immediate narrow high-speed piercing wave',()=>{
  const g:any=game(),p:any=player(); expect(applyKnightSlashVariant(g,p,ctx,'pierce')).toBe(true);
  expect(g.timers).toHaveLength(0); expect(g.shots).toHaveLength(1); expect(g.shots[0]).toMatchObject({speed:30,radius:.85,dmg:72,pierce:true,noProc:true});
});
