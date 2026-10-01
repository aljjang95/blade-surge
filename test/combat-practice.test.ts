import { expect, test } from 'bun:test';
import { PracticeBattle, practiceStage, practiceSpawnPoints } from '../src/game/combat-practice.js';
import { Floor } from '../src/game/world.js';
import { fieldDropsAllowed } from '../src/game/drops.js';
import { Battle } from '../src/game/battle-base.js';

test('연습장의 닫힌 이동 마스크 안에 영웅과 분리된 10체가 배치된다', () => {
  const stage = practiceStage(), floor = new (Floor as any)(stage.idx, stage.chapter.theme, undefined, stage.dungeon.layout);
  const room = floor.startRoom, points = practiceSpawnPoints(room);
  expect(floor.rooms).toHaveLength(1);
  expect(floor.corridors).toHaveLength(0);
  expect(points).toHaveLength(10);
  for (const point of points) {
    const [x, z] = floor.resolve(room.x, room.z, point.x, point.z, .7);
    expect(Math.hypot(x - point.x, z - point.z)).toBeLessThan(.01);
    expect(Math.hypot(x - room.x, z - room.z - 2.5)).toBeGreaterThan(4);
  }
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++)
    expect(Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z)).toBeGreaterThan(1.6);
  expect(floor.walkable(room.x + room.w, room.z)).toBeFalse();
});

test('연습에는 드랍과 물약 소비가 없고 캠페인 드랍은 유지된다', () => {
  expect(fieldDropsAllowed(practiceStage())).toBeFalse();
  expect(fieldDropsAllowed({})).toBeTrue();
  expect(PracticeBattle.prototype.rollDrop.call({})).toBeNull();
  expect(PracticeBattle.prototype.canApplyConsumable.call({})).toBeFalse();
});

test('연습 처치는 저장/성장/보상 경로를 호출하지 않고 프레임 종료까지 승리를 확정하지 않는다', () => {
  let wins = 0;
  const battle: any = { active: true, kills: 0, waveKilled: 0, killStreak: 0,
    ui: { setKillStreak() {} }, player: { alive:true,hp:100,addUlt() {}, addMp() {} }, sp: null,
    hasProc:()=>false, applyKillCombatEffects:Battle.prototype.applyKillCombatEffects,
    fx: { dustPuff() {} }, finish() { wins++; this.active = false; },
    get app() { throw Error('연습 처치가 저장 경로에 접근했습니다'); },
    get drops() { throw Error('연습 처치가 보상 경로에 접근했습니다'); } };
  for (let i = 0; i < 10; i++) PracticeBattle.prototype.onEnemyDeath.call(battle, {pos:{}});
  expect(battle.kills).toBe(10); expect(wins).toBe(0);
  PracticeBattle.prototype.victory.call(battle);
  expect(wins).toBe(1);
  PracticeBattle.prototype.onEnemyDeath.call(battle, {pos:{}});
  expect(battle.kills).toBe(10); expect(wins).toBe(1);
});

test('흡혈 처치 회복은 연습에서도 저장/보상 없이 기존 3%를 적용한다', () => {
  const battle:any={player:{alive:true,hp:50,maxHp:100,pos:{},addUlt(){},addMp(){}},sp:null,hasProc:(id:string)=>id==='blood_leech',
    fx:{embers(){},damage(){},dmgLayer:{children:[]}},get app(){throw Error('회복이 저장 경로에 접근했습니다');}};
  Battle.prototype.applyKillCombatEffects.call(battle,{});
  expect(battle.player.hp).toBe(53);
});

test('치명타의 마지막 처치가 발생해도 HP 0/사망 상태에 승리를 주지 않는다', () => {
  let wins=0;
  const battle:any={player:{alive:true,hp:0},finish:()=>wins++};
  PracticeBattle.prototype.victory.call(battle);
  battle.player.alive=false;PracticeBattle.prototype.victory.call(battle);
  expect(wins).toBe(0);
});

test('무료 불사조 부활은 첫 사망에 유지되고 재사용 사망은 패배한다', () => {
  let rebirths=0,defeats=0;
  const battle:any={rebirthUsed:false,preparePlayerDeath(){},hasProc:(id:string)=>id==='phoenix_rebirth',
    phoenixRebirth(){this.rebirthUsed=true;rebirths++;},defeat(){defeats++;},get app(){throw Error('무료 부활이 저장 경로에 접근했습니다');}};
  PracticeBattle.prototype.onPlayerDeath.call(battle);
  expect(rebirths).toBe(1);expect(defeats).toBe(0);
  PracticeBattle.prototype.onPlayerDeath.call(battle);
  expect(rebirths).toBe(1);expect(defeats).toBe(1);
});

test('연습 승리와 패배는 일반 정산을 호출하지 않고 하나의 연습 결과만 만든다', () => {
  const results: any[] = [];
  const battle: any = { active: true, input: {enabled:true,clear(){}}, pauseReasons:new Set(['manual']), paused:true,
    kills:3,elapsed:5,maxCombo:7,player:{play(){}},onFinish:(r:any)=>results.push(r),
    get ui() { throw Error('일반 정산 UI를 호출했습니다'); } };
  PracticeBattle.prototype.finish.call(battle, false);
  PracticeBattle.prototype.finish.call(battle, true);
  expect(results).toEqual([{practice:true,win:false,kills:3,time:5,maxCombo:7}]);
  expect(battle.input.enabled).toBeFalse(); expect(battle.paused).toBeFalse();
});
