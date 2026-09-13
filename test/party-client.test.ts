import {expect,test} from 'bun:test';
import {RemoteInput,canonicalPartyCode,normalizedPartyStats} from '../src/party/replication.js';
import {Battle as PartyBattle} from '../src/party/battle.js';
import {fieldDropsAllowed} from '../src/game/drops.js';

test('remote input normalizes identifiers and expires held and queued input after 350ms',()=>{
  expect(canonicalPartyCode(' abcd-1234 efgh-5678 ')).toBe('ABCD1234EFGH5678');
  const input=new RemoteInput();
  input.receive({x:.5,y:-1,attack:true,actions:['skill0','skill0','dodge','invalid']},1000);
  expect(input.move).toEqual({x:.5,y:-1});expect(input.attackHeld).toBe(true);
  expect(input.consume('skill0')).toBe(true);expect(input.consume('skill0')).toBe(false);
  expect(input.queue).toEqual(['dodge']);
  input.expire(1350);expect(input.attackHeld).toBe(true);expect(input.queue).toEqual(['dodge']);
  input.expire(1351);expect(input.move).toEqual({x:0,y:0});expect(input.attackHeld).toBe(false);expect(input.queue).toEqual([]);
});

test('party stat normalization is immutable and applies the documented attack and durability curves',()=>{
  const base={hp:1000,atk:200,def:80,crit:.1},copy={...base};
  expect(normalizedPartyStats(base,4)).toEqual({...base,hp:2639,atk:800,def:211});
  expect(base).toEqual(copy);
});

test('guest party battle delegates only to snapshot rendering and never advances the local simulation',()=>{
  let guestUpdates=0;
  const game:any={stage:{party:{runId:'run'}},app:{party:{isHost:false,updateGuest:(dt:number)=>{guestUpdates++;return `snapshot:${dt}`;}}}};
  expect(PartyBattle.prototype.update.call(game,.25)).toBe('snapshot:0.25');expect(guestUpdates).toBe(1);
});

test('party death path excludes personal campaign, codex, masterworks and field rewards',()=>{
  let baseDeaths=0,guestUlt=0;
  const host={addUlt(){}},guest={addUlt:(value:number)=>{guestUlt+=value;}};
  const game:any={stage:{party:{runId:'run'}},player:host,app:{party:{livingPlayers:()=>[host,guest]}},
    kills:0,waveKilled:0,pending:[],active:true,after(){},drops:{onKill(){baseDeaths++;}},fx:{burst(){},dustPuff(){}},ui:{showBoss(){}},hasProc:()=>false};
  const enemy:any={alive:false,partyCounted:false,isBoss:false,isElite:false,pos:{clone:()=>({setY(){return this;}})}};
  PartyBattle.prototype.onEnemyDeath.call(game,enemy);
  expect(game.kills).toBe(1);expect(baseDeaths).toBe(1);expect(guestUlt).toBe(5);expect(enemy.partyCounted).toBe(true);
  PartyBattle.prototype.onEnemyDeath.call(game,enemy);expect(game.kills).toBe(1);expect(baseDeaths).toBe(1);expect(guestUlt).toBe(5);
  expect(fieldDropsAllowed(game.stage)).toBe(false);
});
