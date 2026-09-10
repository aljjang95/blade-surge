import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRpg, recordMonster, monsterLevel, monsterStats, monsterXp, grantCombatXp, KillLedger, masteryLabel } from '../../src/game/rpg-core.js';
import { attackPhase, attackBody, impactStrength, ImpactClock } from '../../src/game/combat-motion.js';

// Copied from the shipped hero curve (heroes.js). Runtime still imports that source directly.
const curve = lv => Math.floor(100 * Math.pow(1.18, lv - 1));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('legacy saves receive an empty codex without invented discoveries', () => {
  const r = normalizeRpg(undefined, ['skeleton']);
  assert.equal(r.version, 1); assert.equal(r.combatXp, 0); assert.deepEqual(Object.keys(r.bestiary), []);
});
test('save normalization only keeps known safe monster IDs', () => {
  const raw = JSON.parse('{"bestiary":{"skeleton":{"seen":2,"kills":1},"unknown":{"seen":8},"__proto__":{"polluted":true}}}');
  const r = normalizeRpg(raw, ['skeleton', '__proto__']);
  assert.deepEqual(Object.keys(r.bestiary), ['skeleton']); assert.equal({}.polluted, undefined);
});
test('corrupt records, fractional counters and out-of-range values normalize safely', () => {
  const r = normalizeRpg({ combatXp: Infinity, bestiary: { a: { seen: -4, kills: 3, highestLevel: 999, lastFloor: -1 }, b: [], c: { seen: 1.5 } } }, ['a','b','c']);
  assert.equal(r.combatXp, 0); assert.equal(r.bestiary.a.seen, 1); assert.equal(r.bestiary.a.highestLevel, 80); assert.equal(r.bestiary.a.lastFloor, 1);
  assert.deepEqual(Object.keys(r.bestiary), ['a']);
});
test('codex survives JSON save and reload', () => {
  const r = normalizeRpg(null, ['a']); recordMonster(r,'a',7,4); recordMonster(r,'a',7,4,true);
  const reloaded = normalizeRpg(JSON.parse(JSON.stringify(r)), ['a']);
  assert.deepEqual(reloaded.bestiary.a, { seen: 1, kills: 1, highestLevel: 7, lastFloor: 4 });
});
test('high-water level is monotonic; last floor is an actual encounter', () => {
  const r = normalizeRpg(null, ['a']); recordMonster(r,'a',20,20); recordMonster(r,'a',3,3);
  assert.equal(r.bestiary.a.highestLevel, 20); assert.equal(r.bestiary.a.lastFloor, 3);
});
test('dangerous record keys are rejected', () => {
  const r = normalizeRpg(null, []);
  for (const id of ['__proto__','constructor','prototype']) assert.equal(recordMonster(r,id,1,1), null);
});
test('monster levels expose stage and rank without multiplying stats twice', () => {
  assert.equal(monsterLevel(1,{}),1); assert.equal(monsterLevel(1,{elite:true}),3); assert.equal(monsterLevel(1,{boss:true}),5);
  assert.equal(monsterLevel(50,{boss:true}),54);
});
test('displayed monster HP and attack use the exact baseline scaling formula', () => {
  const def = { hp:490, atk:20, spd:4.6, range:1.9, armor:0.15 };
  for (const scale of [1,1.12,2.8,12]) {
    const s = monsterStats(def,scale); assert.equal(s.hp,Math.floor(def.hp*scale)); close(s.atk,def.atk*Math.pow(scale,0.7));
    assert.equal(s.armor,0.15); assert.equal(s.speed,4.6);
  }
});
test('summons grant no XP; normal monsters reuse authored experience', () => {
  assert.equal(monsterXp({exp:8},1),8); assert.equal(monsterXp({exp:8},1.12),8); assert.equal(monsterXp({exp:60},2),120);
  assert.equal(monsterXp({exp:999},2,true),0);
});
test('invalid experience rewards fail closed', () => {
  for (const exp of [undefined,NaN,Infinity,-1,0]) assert.equal(monsterXp({exp},1),0);
  assert.equal(monsterXp({exp:8},NaN),0);
});
test('hero XP below threshold updates the existing hero only', () => {
  const h = {level:1,exp:0,star:3,equip:{weapon:99}}; const a=grantCombatXp(h,99,curve);
  assert.equal(h.level,1); assert.equal(h.exp,99); assert.equal(a.levels,0); assert.equal(h.star,3); assert.equal(h.equip.weapon,99);
});
test('exact XP boundary levels once and retains zero remainder', () => {
  const h={level:1,exp:95};const a=grantCombatXp(h,5,curve);assert.equal(a.levels,1);assert.equal(h.level,2);assert.equal(h.exp,0);
});
test('multiple levels preserve the remainder', () => {
  const h={level:1,exp:0};const a=grantCombatXp(h,curve(1)+curve(2)+7,curve);
  assert.equal(a.levels,2);assert.equal(h.level,3);assert.equal(h.exp,7);
});
test('reaching cap clears excess XP; already capped heroes gain nothing', () => {
  const h={level:79,exp:0};grantCombatXp(h,curve(79)+999,curve);assert.equal(h.level,80);assert.equal(h.exp,0);
  assert.equal(grantCombatXp(h,999,curve).gained,0); assert.equal(h.exp,0);
});
test('invalid rewards never modify hero, currencies or items', () => {
  for(const amount of [-1,NaN,Infinity,1.5,'12']) { const h={level:1,exp:4}; grantCombatXp(h,amount,curve);assert.deepEqual(h,{level:1,exp:4}); }
});
test('invalid curve rolls back before mutating hero', () => {
  const h={level:1,exp:8};assert.throws(()=>grantCombatXp(h,300,()=>0),RangeError);assert.deepEqual(h,{level:1,exp:8});
});
test('kill receipt is once per dead instance, never while alive', () => {
  const ledger=new KillLedger(), enemy={alive:true}; assert.equal(ledger.claim(enemy),false);enemy.alive=false;
  assert.equal(ledger.claim(enemy),true);assert.equal(ledger.claim(enemy),false);assert.equal(ledger.claim({alive:false}),true);
});
test('retries have isolated receipts; mastery has explicit thresholds', () => {
  const enemy={alive:false};assert.equal(new KillLedger().claim(enemy),true);assert.equal(new KillLedger().claim(enemy),true);
  assert.equal(masteryLabel(null),'미발견');assert.equal(masteryLabel({seen:1,kills:0}),'발견');assert.equal(masteryLabel({seen:1,kills:10}),'연구 완료');assert.equal(masteryLabel({seen:1,kills:50}),'정복');
});
for(const contact of [0.12,0.25,0.4,0.65,0.8]) test(`attack retime is monotonic and pins contact ${contact}`, () => {
  close(attackPhase(0,contact),0);close(attackPhase(contact,contact),contact);close(attackPhase(1,contact),1);
  let previous=0;for(let i=0;i<=1000;i++){const value=attackPhase(i/1000,contact);assert.ok(value>=previous-1e-12);assert.ok(value<=1);previous=value;}
});
test('body motion returns to neutral and uses distinct weapon weights', () => {
  for(const weapon of ['1h','2h','dual']) { const pose=attackBody(1,.4,weapon);close(pose.pitch,0);close(pose.yaw,0);close(pose.forward,0); }
  assert.ok(attackBody(.4,.4,'2h').pitch>attackBody(.4,.4,'dual').pitch);
});
test('boss and elite recoil stay smaller than normal enemies', () => {
  assert.ok(impactStrength({boss:true})<impactStrength({elite:true}));assert.ok(impactStrength({elite:true})<impactStrength());
  assert.ok(impactStrength({finisher:true})>impactStrength());
});
test('thirty simultaneous hits use a max stop, not thirty summed stops', () => {
  const clock=new ImpactClock();for(let i=0;i<30;i++)clock.hitstop(.035);close(clock.stop,.035);close(clock.step(.02),0);close(clock.step(.02),.005);
});
test('partial hitstop frame is preserved for gameplay and FX scale', () => {
  const clock=new ImpactClock();clock.hitstop(.01);const dt=clock.step(.016);close(dt,.006);close(clock.scale*.016,dt);
});
test('slow motion expiration splits its final frame correctly', () => {
  const clock=new ImpactClock();clock.slowmo(.5,.01);close(clock.step(.02),.015);close(clock.slow,1);close(clock.slowT,0);
});
test('repeated hitstop pressure cannot permanently freeze gameplay', () => {
  const clock=new ImpactClock();let advanced=0;
  for(let i=0;i<300;i++){clock.hitstop(.1);advanced+=clock.step(1/60);assert.ok(clock.stop<=.12+1e-9);}
  assert.ok(advanced>1,`Only ${advanced} seconds advanced in five wall-clock seconds`);
});
test('paused or invalid deltas cannot run timers backward', () => {
  const clock=new ImpactClock();clock.hitstop(.04);for(const dt of [0,-1,NaN,Infinity])assert.equal(clock.step(dt),0);close(clock.stop,.04);
});
