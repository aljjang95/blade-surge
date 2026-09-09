import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster, applyBattleConsumable } from '../src/game/expedition-combat.js';
import { resolveJobHero } from '../src/data/jobs.js';
import { HEROES } from '../src/data/heroes.js';
import { SKILLS } from '../src/game/skills.js';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle.js';

const cell = (w: any,r: any) => Math.floor(r.z-w.minZ)*w.cols+Math.floor(r.x-w.minX);
for (const id of ['glass_garden','ember_vault','star_archive']) test(`${id}: short rooms reachable before seal and boss reachable afterward`, () => {
  const stage = buildExpeditionStage('dungeon',id,{}), w = buildExpeditionWorld(stage);
  expect(w.rooms.length).toBeGreaterThanOrEqual(3); expect(w.rooms.length).toBeLessThanOrEqual(5);
  expect(w.rooms.map((r: any) => [r.x,r.z,r.type])).toEqual(buildExpeditionWorld(stage).rooms.map((r: any) => [r.x,r.z,r.type]));
  const flow = w.buildFlow(w.startRoom.x,w.startRoom.z)!;
  for (const r of w.rooms) expect(flow[cell(w,r)] >= 0).toBe(r !== w.bossRoom);
  expect(expeditionRoster(stage,w.bossRoom)).toEqual([stage.encounter.enemyId]);
  w.unseal(); const open = w.buildFlow(w.bossRoom.x,w.bossRoom.z)!;
  for (const r of w.rooms) expect(open[cell(w,r)]).toBeGreaterThanOrEqual(0);
});

test('AI duels have one reachable enemy, distinct defensive policies and no summon pattern', () => {
  const defs = ['rookie','duelist','champion'].map(id => buildExpeditionStage('arena',id,{}));
  for (const stage of defs) {
    const w = buildExpeditionWorld(stage); expect(w.rooms.length).toBe(2); expect(w.sealed).toBe(false);
    expect(w.buildFlow(w.startRoom.x,w.startRoom.z)![cell(w,w.bossRoom)]).toBeGreaterThanOrEqual(0);
    expect(expeditionRoster(stage,w.bossRoom).length).toBe(1); expect(stage.expeditionEnemy.pattern).not.toContain('summon');
  }
  expect(defs[0].expeditionEnemy.behavior).toBe('shield'); expect(defs[1].expeditionEnemy.dodge).toBeGreaterThan(0);
  expect(new Set(defs.map(s => JSON.stringify(s.expeditionEnemy.pattern))).size).toBe(3);
  expect(() => buildExpeditionStage('dungeon','__proto__',{})).toThrow();
});

test('jobs retain hero/model identity and every skill resolves without mutating originals', () => {
  const before = JSON.stringify(HEROES);
  for (const [hero,id] of [['knight','guardian'],['rogue','ranger']]) {
    const base = (HEROES as any)[hero], job = resolveJobHero(base,id);
    expect(job.id).toBe(base.id); expect(job.model).toBe(base.model); expect(job.portrait).toBe(base.portrait);
    expect(job.skills.length).toBe(6); expect(job.combo.length).toBe(3);
    for (const skill of job.skills) expect((SKILLS as any)[skill.id]).toBeDefined();
  }
  expect(resolveJobHero(HEROES.mage,'guardian')).toBe(HEROES.mage); expect(JSON.stringify(HEROES)).toBe(before);
  expect(resolveJobHero(HEROES.rogue,'ranger').ranged).toBe(true);
});

test('consumables affect HP and independent buff timers, with failure leaving state intact', () => {
  const game: any = { active:true, paused:false, player:{alive:true,hp:20,maxHp:100} };
  expect(applyBattleConsumable(game,'hp_tonic')).toBe(true); expect(game.player.hp).toBe(55);
  expect(applyBattleConsumable(game,'overdrive')).toBe(true); expect(game.player.tonicAtkT).toBe(12);
  expect(applyBattleConsumable(game,'overdrive')).toBe(false); expect(applyBattleConsumable(game,'aegis')).toBe(true);
  game.paused = true; expect(applyBattleConsumable(game,'hp_tonic')).toBe(false); expect(game.player.hp).toBe(55);
  game.paused = false; game.player.hp=100; expect(applyBattleConsumable(game,'hp_tonic')).toBe(false);
  game.active=false; expect(applyBattleConsumable(game,'aegis')).toBe(false);
});

test('guardian perfect guard actually cancels incoming damage and earns counter resource', () => {
  let counter = 0;
  const p: any = { alive:true,def:{jobId:'guardian'},guardT:.6,hp:100,atk:20,pos:new THREE.Vector3(),
    gainJobResource(n: number){this.jobResource=(this.jobResource||0)+n;},addUlt(){},
    game:{ui:{toast(){}},hitRadius(_p:any,_r:any,dmg:number){counter=dmg;},fx:{shockTex(){}}} };
  expect(Player.prototype.hurt.call(p,70)).toBe(false); expect(p.hp).toBe(100); expect(p.jobResource).toBe(2); expect(counter).toBeCloseTo(56);
});

test('ranger focus is spent by an actual empowered piercing projectile', () => {
  const shots: any[] = [];
  const p: any = {jobResource:3,pos:new THREE.Vector3(),forward(v:THREE.Vector3){return v.set(0,0,1);}};
  SKILLS.ranger_pierce.cast({spawnProjectile(s:any){shots.push(s);}} as any,p,{dmg:100} as any);
  expect(p.jobResource).toBe(0); expect(shots[0].dmg).toBe(200); expect(shots[0].pierce).toBe(true);
});

test('altar requires uninterrupted center presence and AI timeout uses supplied battle dt', () => {
  const room:any={x:0,z:0,attunementPending:true,attunementT:0}; let cleared=0;
  const g:any={stage:{expedition:{kind:'dungeon'}},player:{alive:true,pos:new THREE.Vector3()},world:{rooms:[room]},fx:{castCircle(){}},markCleared(){cleared++;}};
  Battle.prototype.updateExpedition.call(g,1); expect(cleared).toBe(0);
  g.player.pos.x=5; Battle.prototype.updateExpedition.call(g,.5); expect(room.attunementT).toBe(0);
  g.player.pos.x=0; Battle.prototype.updateExpedition.call(g,2); expect(cleared).toBe(1);
  let defeats=0; g.stage.expedition.kind='arena'; g.bossFound=true; g.duelElapsed=149; g.ui={toast(){}}; g.defeat=()=>defeats++;
  Battle.prototype.updateExpedition.call(g,.5); expect(defeats).toBe(0);
  Battle.prototype.updateExpedition.call(g,.5); expect(defeats).toBe(1);
});

test('forge keeps its room uncleared through two real reinforcement waves', () => {
  const room:any={type:'elite',cleared:false}, spawns:string[]=[];
  const g:any={stage:buildExpeditionStage('dungeon','ember_vault',{}),ui:{waveBanner(){}},spawnEnemy(id:string,_near:any,r:any){expect(r).toBe(room);spawns.push(id);}};
  Battle.prototype.markCleared.call(g,room); expect(room.forgeWave).toBe(1); expect(room.cleared).toBe(false);
  Battle.prototype.markCleared.call(g,room); expect(room.forgeWave).toBe(2); expect(room.cleared).toBe(false); expect(spawns.length).toBe(8);
});

test('paused battles never step consumable, arena or objective clocks; portals dispose once', () => {
  let steps=0;
  Battle.prototype.update.call({player:{},paused:true,timeCtl:{step(){steps++;}}} as any,5);
  expect(steps).toBe(0);
  let disposed=0;
  const g:any={scene:{remove(){}},portal:{mesh:{geometry:{dispose(){disposed++;}},material:{dispose(){disposed++;}}}}};
  Battle.prototype.clearPortal.call(g); Battle.prototype.clearPortal.call(g); expect(disposed).toBe(2);
});
