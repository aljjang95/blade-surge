import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { RegionHazards } from '../src/game/region-hazards.js';
import { enemyPartyWarnings } from '../src/game/enemies.js';
import { capturePartyWarnings, PartyCombatEffects, validPartyWarning, PARTY_WARNING_LIMIT } from '../src/party/combat-effects.js';
const room = () => ({x:0,z:0,w:24,h:24,type:'boss',spawned:true,cleared:false});
function hazardGame() {
  const area=room(),hits=[0,0,0];
  const players=hits.map((_,i)=>({alive:true,pos:{x:i===2?10:0,z:0},maxHp:100,slowT:0,hurt:():boolean=>{hits[i]++;return true;}}));
  const game={stage:{party:{},chapter:{theme:'frost'},encounter:{rank:'finalboss'}},app:{party:{livingPlayers:()=>players.filter(p=>p.alive)}},scene:new THREE.Scene(),ui:{toast:()=>{}},player:players[0],world:{roomAt:()=>area},active:true,paused:false,bossDefeated:false};
  return {game,players,hits,area};
}
test('one host region strike hits every exposed living party actor once, excludes outside players and keeps dodge policy',()=>{
  const {game,players,hits,area}=hazardGame();
  const h=new RegionHazards(game);h.room=area;h.cooldown=99;h.spawn(area);
  h.update(1.6);expect(hits).toEqual([0,0,0]);
  h.update(.11);expect(hits).toEqual([1,1,0]);
  h.update(.05);expect(hits).toEqual([1,1,0]);
  expect(players[1].slowT).toBe(1.2);
  players[1].slowT=0;players[1].hurt=()=>false;h.spawn(area);h.update(1.71);
  expect(players[1].slowT).toBe(0);h.dispose();
});
test('host death does not erase the living guest region encounter; snapshot timing uses actual hazard slots',()=>{
  const {game,players,area}=hazardGame();players[0].alive=false;
  const h=new RegionHazards(game);h.room=area;h.cooldown=0;h.update(.01);
  const a=h.getPartyWarnings();expect(a.length).toBeGreaterThan(0);expect(a.every(validPartyWarning)).toBe(true);
  h.update(.2);const b=h.getPartyWarnings();expect(b[0].id).toBe(a[0].id);expect(b[0].remaining).toBeLessThan(a[0].remaining);
  expect(b[0].x).toBe((h.slots[0].hazard as any).x);
  area.cleared=true;h.update(.01);expect(h.getPartyWarnings()).toEqual([]);h.dispose();
});
const enemy = (special:string):any => ({alive:true,spawning:false,partyId:'e4',attackSequence:3,state:'attack',attackDone:false,attackDur:2,hitAt:.6,stateT:.2,pos:{x:1,z:2},yaw:0,special,def:{range:3,ranged:false},rainPts:[{x:9,z:-3},{x:2,z:8}]});
test('boss rain replicates authoritative random targets without RNG, stable IDs, or locally advancing attack',()=>{
  const e=enemy('soulrain'),a=enemyPartyWarnings(e);expect(a.map((w:any)=>[w.x,w.z])).toEqual([[9,-3],[2,8]]);
  expect(a.every(validPartyWarning)).toBe(true);expect(a.every((w:any)=>w.radius===2.2)).toBe(true);
  e.pos.x=99;e.stateT=.4;const b=enemyPartyWarnings(e);expect(b.map((w:any)=>w.id)).toEqual(a.map((w:any)=>w.id));expect(b[0].x).toBe(9);expect(b[0].remaining).toBeLessThan(a[0].remaining);
  e.attackDone=true;expect(enemyPartyWarnings(e)).toEqual([]);
  e.attackDone=false;e.state='hurt';expect(enemyPartyWarnings(e)).toEqual([]);
});
test('slam/spin/dash/fan expose bounded attack footprints and capture prioritizes region warnings',()=>{
  for(const special of ['slam','spin','dash','fan','basic']) {const e=enemy(special);e.partyDashWarning={x:4,z:8,length:14,width:6.4,angle:1};expect(enemyPartyWarnings(e).every(validPartyWarning)).toBe(true);}
  const e=enemy('spin'),region={...enemyPartyWarnings(e)[0],id:'region:1:0'};
  const warnings=capturePartyWarnings({hazards:{getPartyWarnings:()=>[region]},enemies:Array.from({length:100},()=>({getPartyWarnings:()=>enemyPartyWarnings(e)}))});
  expect(warnings.length).toBe(PARTY_WARNING_LIMIT);expect(warnings[0].id).toBe('region:1:0');
});
test('repeated snapshots reuse fixed GPU pool and clear vanished warnings with idempotent disposal',()=>{
  const scene=new THREE.Scene(),fx=new PartyCombatEffects(scene),warnings=enemyPartyWarnings(enemy('soulrain'));
  const geometry=fx.geometry,materials=fx.slots.map(s=>s.mesh.material),meshes=fx.slots.map(s=>s.mesh);
  for(let i=0;i<100;i++)fx.update(warnings);
  expect(fx.slots.filter(s=>s.mesh.visible).length).toBe(2);expect(fx.group.children.length).toBe(PARTY_WARNING_LIMIT);
  expect(fx.slots.map(s=>s.mesh)).toEqual(meshes);expect(fx.slots.map(s=>s.mesh.material)).toEqual(materials);
  fx.update([warnings[0],warnings[0],{...warnings[1],x:NaN}]);expect(fx.slots.filter(s=>s.mesh.visible).length).toBe(1);
  fx.update([]);expect(fx.slots.every(s=>!s.mesh.visible)).toBe(true);
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);for(const m of materials)m.addEventListener('dispose',()=>disposed++);
  fx.dispose();fx.dispose();expect(disposed).toBe(PARTY_WARNING_LIMIT+1);expect(scene.children).toHaveLength(0);
});
