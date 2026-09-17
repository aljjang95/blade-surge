import { expect, test } from 'bun:test';
import { HEROES } from '../src/data/heroes.js';
import { Player } from '../src/game/player.js';
import { CONTROL_MP_GAIN, CONTROL_ULT_GAIN, ultHitGain, ultKillGain, ultimateLockDuration } from '../src/game/control-rewards.js';

test('ultimate gauge is earned by basic control contact, not skill or ultimate multihits',()=>{
  expect(ultHitGain({basic:false,crit:false})).toBe(0);
  expect(ultHitGain({basic:false,crit:true})).toBe(0);
  expect(ultHitGain({basic:true,crit:false})).toBe(CONTROL_ULT_GAIN.basicHit);
  expect(ultHitGain({basic:true,crit:true})).toBe(CONTROL_ULT_GAIN.basicCrit);
});

test('kill gauge is supplemental and cannot replace the control loop',()=>{
  expect(ultKillGain({})).toBe(1);
  expect(ultKillGain({isElite:true})).toBe(4);
  expect(ultKillGain({isBoss:true})).toBe(10);
  expect(CONTROL_ULT_GAIN.comboFinisher).toBeGreaterThan(CONTROL_ULT_GAIN.eliteKill);
  expect(CONTROL_ULT_GAIN.perfectDodge).toBeGreaterThan(CONTROL_ULT_GAIN.bossKill);
});

test('fixed skills consume MP while control actions restore meaningful chunks',()=>{
  for(const hero of Object.values(HEROES) as any[]) expect(hero.skills.slice(0,3).map((s:any)=>s.mp)).toEqual([16,20,24]);
  expect(CONTROL_MP_GAIN.comboFinisher).toBe(6);
  expect(CONTROL_MP_GAIN.perfectDodge).toBe(12);
});

test('an ultimate cannot refill itself during its active presentation window',()=>{
  const p:any={ult:0,ultMax:100,ultGainLock:ultimateLockDuration({total:3})};
  expect(Player.prototype.addUlt.call(p,30)).toBe(0);
  p.ultGainLock=0; expect(Player.prototype.addUlt.call(p,7)).toBe(7);
});

test('room-clear ultimate data is bounded below the old one-button values',()=>{
  const values=Object.values(HEROES).map((hero:any)=>hero.skills.find((s:any)=>s.ult)?.dmg ?? 0);
  expect(values).toEqual([8,9,2.8,.95,1.9]);
  expect(Math.max(...values)).toBeLessThanOrEqual(9);
});
