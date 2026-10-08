import { afterEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Input } from '../src/engine/input.js';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle-base.js';
import { HEROES } from '../src/data/heroes.js';
import { DODGE_COOLDOWN_SEC } from '../src/game/progression.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();
const players: Player[] = [];
afterEach(() => { for (const player of players.splice(0)) player.dispose(); });

function advanceUntil(f: any, ready: () => boolean, dt: number) {
  for (let frame = 0; frame < 600 && !ready(); frame++) stepCombatFlow(f, dt);
  expect(ready()).toBe(true);
}

// 실제 생성자·입력 초기화·Actor/Floor 이동·전투 시계를 사용한다. GLB 표현만 빈 클립으로 대신한다.
function fixture(heroId = 'knight') {
  const f = createCombatFlowFixture(runtime, heroId);
  f.game.fx.aura = () => {};
  const input: any = Object.assign(Object.create(Input.prototype), {
    enabled: true, move: { x: 0, y: 0 }, screenMove: { x: 0, y: 0 }, queue: [],
    attackHeld: false, attackSources: new Set(), clearListeners: new Set(), keys: {},
    gamepadMove: { x: 0, y: 0 }, gamepadButtons: new Uint8Array(8), gamepadConnected: false,
    joy: { active: false, id: null }, el: { knob: { style: {} }, base: { style: {} } },
  });
  f.game.input = input;
  f.game.pauseReasons = new Set();
  f.game.scene.remove(f.player.root);
  const def = f.player.def, position = f.player.pos.clone();
  const names = new Set(['Idle', 'Running_A', 'Dodge_Forward', 'Dodge_Backward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B',
    ...def.combo.map((c: any) => c.anim), ...def.skills.map((s: any) => s.anim).filter(Boolean)]);
  const gltf = { scene: new THREE.Group(), animations: [...names].map(name => new THREE.AnimationClip(name, 1, [])) };
  f.player = f.game.player = new Player(f.game, gltf, def, f.player.stats);
  f.player.pos.copy(position);
  players.push(f.player);
  return f;
}

function finalAttackFrame(f: any, index: number, dt: number) {
  f.player.startCombo(index);
  const duration = f.player.current.dur / (f.player.buffs.atkSpd * (f.player.stormT > 0 ? 1.4 : 1));
  advanceUntil(f, () => f.player.stateT + dt >= duration - 1e-8, dt);
  expect(f.player.state).toBe('attack');
  expect(f.player.canDodgeCancel()).toBe(false);
}

test('5영웅의 모든 평타 종료 직전 회피는 30·60·120fps에서 재입력 없이 자연 종료 다음 프레임에 실행된다', () => {
  for (const heroId of Object.keys(HEROES)) for (const fps of [30, 60, 120]) {
    const f = fixture(heroId), p: any = f.player, dt = 1 / fps;
    for (let index = 0; index < p.def.combo.length; index++) {
      p.dodgeCd = 0; p.comboResume = null;
      finalAttackFrame(f, index, dt);
      f.game.input.move.x = 1; f.game.input.press('dodge');
      stepCombatFlow(f, dt);
      // 소수 누적 오차로 남는 마지막 경계 프레임도 실제 시계로 통과한다.
      if (p.state === 'attack') stepCombatFlow(f, dt);
      expect(p.state).toBe('idle'); expect(p.dodgeBufferT).toBeGreaterThan(0);
      const hp = p.hp, mp = p.mp, position = p.pos.clone();
      stepCombatFlow(f, dt);
      expect(p.state).toBe('dodge'); expect(p.dodgeBufferT).toBe(0);
      expect(p.dodgeCd).toBeCloseTo(DODGE_COOLDOWN_SEC - dt);
      expect(p.pos.x).toBeGreaterThan(position.x); expect(p.hp).toBe(hp);
      expect(p.mp).toBeGreaterThanOrEqual(mp);
      expect(p.comboResume).toBeNull();
      f.game.input.clear();
    }
  }
});

test('기존 준비·접촉 commit·후딜 경계는 회피 버퍼가 있어도 앞당겨지지 않는다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 120;
  p.startCombo(0); f.game.input.press('dodge');
  stepCombatFlow(f, dt);
  expect(p.state).toBe('attack');
  advanceUntil(f, () => p.state !== 'attack' || p.attackProgress() >= .16, dt);
  expect(p.state).toBe('attack');
  stepCombatFlow(f, dt); expect(p.state).toBe('dodge');

  p.dodgeCd = 0; p.comboResume = null; p.startCombo(0);
  advanceUntil(f, () => p.attackProgress() >= p.current.hitAt - .035, dt);
  expect(p.hitDone).toBe(false); expect(p.canDodgeCancel()).toBe(false);
  f.game.input.press('dodge'); stepCombatFlow(f, dt);
  advanceUntil(f, () => p.attackProgress() >= p.current.hitAt + .12, dt);
  expect(p.hitDone).toBe(true); expect(p.state).toBe('attack');
  stepCombatFlow(f, dt); expect(p.state).toBe('dodge');
});

test('공속 강화·폭풍·중첩 상태도 5영웅 마무리의 실제 종료 시계에서 회피를 한 번만 실행한다', () => {
  for (const heroId of Object.keys(HEROES)) for (const fps of [30, 60, 120]) {
    for (const speed of ['buff', 'storm', 'both']) {
      const f = fixture(heroId), p: any = f.player, dt = 1 / fps;
      if (speed !== 'storm') Object.assign(p.buffs, { atkSpd: 1.25, t: 10 });
      if (speed !== 'buff') p.stormT = 10;
      finalAttackFrame(f, p.def.combo.length - 1, dt);
      f.game.input.press('dodge'); stepCombatFlow(f, dt);
      if (p.state === 'attack') stepCombatFlow(f, dt);
      expect(p.state).toBe('idle'); expect(p.dodgeBufferT).toBeGreaterThan(0);
      stepCombatFlow(f, dt);
      expect(p.state).toBe('dodge'); expect(p.dodgeBufferT).toBe(0);
      const cooldown = p.dodgeCd;
      stepCombatFlow(f, dt);
      expect(p.dodgeCd).toBeCloseTo(cooldown - dt);
    }
  }
});

test('폭풍이 예약 프레임에 만료되면 늘어난 후딜을 생략하지 않고 0.12초 지난 회피는 폐기한다', () => {
  for (const fps of [30, 60, 120]) {
    const f = fixture(), p: any = f.player, dt = 1 / fps;
    p.stormT = 10;
    finalAttackFrame(f, 0, dt);
    p.stormT = dt / 2;
    f.game.input.press('dodge'); stepCombatFlow(f, dt);
    expect(p.stormT).toBeLessThanOrEqual(0); expect(p.state).toBe('attack');
    advanceUntil(f, () => p.state !== 'attack', dt);
    stepCombatFlow(f, dt);
    expect(p.state).toBe('idle'); expect(p.dodgeBufferT).toBe(0); expect(p.dodgeCd).toBe(0);
  }
});

test('0.12초보다 이른 후딜 입력은 만료되어 나중의 idle에서 자동으로 회피하지 않는다', () => {
  const f = fixture('barbarian'), p: any = f.player, dt = 1 / 120;
  p.startCombo(2);
  advanceUntil(f, () => p.attackProgress() >= p.current.hitAt + .26, dt);
  expect(p.canDodgeCancel()).toBe(false);
  expect(p.current.dur - p.stateT).toBeGreaterThan(.12);
  f.game.input.press('dodge'); stepCombatFlow(f, dt);
  advanceUntil(f, () => p.state !== 'attack', dt);
  stepCombatFlow(f, dt);
  expect(p.state).toBe('idle'); expect(p.dodgeBufferT).toBe(0); expect(p.dodgeCd).toBe(0);
});

test('이미 수락된 다음 타격은 같은 프레임 회피 예약으로 취소되지 않고 다음 타격의 commit 경계도 유지한다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 120;
  finalAttackFrame(f, 0, dt);
  f.game.input.press('dodge'); f.game.input.press('attack'); stepCombatFlow(f, dt);
  expect(p.state).toBe('attack'); expect(p.comboIdx).toBe(1); expect(p.stateT).toBe(0);
  expect(p.dodgeBufferT).toBeGreaterThan(0);
  stepCombatFlow(f, dt);
  expect(p.state).toBe('attack'); expect(p.comboIdx).toBe(1);
  expect(p.attackProgress()).toBeLessThan(.16);
});

test('회피 예약은 기절·쿨다운·스킬·궁극기·기존 회피·사망 경계를 우회하지 않는다', () => {
  for (const boundary of ['stun', 'cooldown', 'skill', 'ult', 'dodge', 'dead']) {
    const f = fixture(), p: any = f.player;
    p.startCombo(0); p.stateT = p.current.dur * .24;
    p.dodgeBufferT = .1;
    if (boundary === 'stun') p.stun = .2;
    if (boundary === 'cooldown') p.dodgeCd = .2;
    if (boundary === 'dead') p.alive = false;
    if (['skill', 'ult', 'dodge'].includes(boundary)) p.state = boundary;
    const beforeState = p.state;
    p.handleInput(f.game.input, 1 / 60);
    expect(p.state).toBe(beforeState); expect(p.dodgeBufferT).toBe(.1);
  }
});

test('실제 pause와 Input.clear는 미실행 회피만 버리고 수락된 콤보와 공격 시계는 보존한다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 60;
  finalAttackFrame(f, 0, dt);
  f.game.input.press('dodge'); p.handleInput(f.game.input, dt);
  expect(p.dodgeBufferT).toBe(.12);
  p.comboQueued = true;
  const stateT = p.stateT;
  Battle.prototype.setPaused.call(f.game, 'menu', true);
  expect(p.dodgeBufferT).toBe(0); expect(p.comboQueued).toBe(true);
  for (let i = 0; i < 20; i++) stepCombatFlow(f, dt);
  expect(p.stateT).toBe(stateT);
  Battle.prototype.setPaused.call(f.game, 'menu', false);
  stepCombatFlow(f, dt);
  expect(p.state).toBe('attack'); expect(p.comboIdx).toBe(1); expect(p.dodgeCd).toBe(0);
});

test('회피 버퍼는 AUTO에서도 같은 자연 종료 경계를 따르고 clear 뒤 이전 입력을 재생하지 않는다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 60;
  finalAttackFrame(f, 0, dt);
  p.auto = true; f.game.input.press('dodge'); stepCombatFlow(f, dt);
  if (p.state === 'attack') stepCombatFlow(f, dt);
  stepCombatFlow(f, dt); expect(p.state).toBe('dodge');
  p.dodgeCd = 0; p.comboResume = null; p.auto = false;
  finalAttackFrame(f, 0, dt);
  f.game.input.press('dodge'); p.handleInput(f.game.input, dt);
  expect(p.dodgeBufferT).toBe(.12);
  f.game.input.clear(); p.auto = true;
  stepCombatFlow(f, dt); stepCombatFlow(f, dt);
  expect(p.state).not.toBe('dodge'); expect(p.dodgeCd).toBe(0);
});

test('Player 폐기는 clear 구독을 해제하며 죽음·부활의 입력 초기화 후 예약을 남기지 않는다', () => {
  const f = fixture(), p: any = f.player;
  expect(f.game.input.clearListeners.size).toBe(1);
  p.dodgeBufferT = .12; p.die(); f.game.input.clear(); p.revive();
  expect(p.dodgeBufferT).toBe(0);
  p.handleInput(f.game.input, 1 / 60);
  expect(p.state).toBe('idle'); expect(p.dodgeCd).toBe(0);
  p.dispose(); p.dispose(); expect(f.game.input.clearListeners.size).toBe(0);
});

test('5영웅 전체 콤보는 새 입력의 방향을 다음 타격에만 적용하고 현재 타격·멀티틱 방향을 보존한다', () => {
  for (const hero of Object.keys(HEROES)) for (const fps of [30, 60, 120]) {
    const f = fixture(hero), p: any = f.player, dt = 1 / fps;
    for (let index = 0; index < p.def.combo.length; index++) {
      p.yaw = 0; p.startCombo(index);
      const current = p.current, hits: number[] = [], hit = p.doComboHit;
      p.doComboHit = function(tick: number) { if (this.current === current) hits.push(this.yaw); return hit.call(this, tick); };
      advanceUntil(f, () => p.canQueueCombo(), dt);
      f.game.input.move.x = 1; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
      expect(p.comboQueued).toBe(true); expect(p.current).toBe(current); expect(p.yaw).toBe(0);
      // 손을 놓아도 이미 수락한 다음 공격 방향은 보존한다.
      f.game.input.move.x = 0;
      advanceUntil(f, () => p.current !== current, dt);
      expect(hits.length).toBeGreaterThan(0); expect(hits.every(yaw => yaw === 0)).toBe(true);
      expect(p.comboIdx).toBe((index + 1) % p.def.combo.length); expect(p.yaw).toBeCloseTo(Math.PI / 2);
      expect(p.attackBufferYaw).toBeNull(); expect(p.comboQueuedYaw).toBeNull();
      if (p.current.move === 'lunge') { expect(p.vel.x).toBeGreaterThan(0); expect(Math.abs(p.vel.z)).toBeLessThan(1e-8); }
      p.doComboHit = hit;
    }
  }
});

test('현재 앞 타격의 실제 명중은 유지하며 방향을 바꾼 다음 타격은 옆 적에게 명중한다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 120;
  const front = spawnCombatFlowEnemy(f, p.pos.x, p.pos.z + 1.8, { hp: 100000, maxHp: 100000, stun: 10 });
  const side = spawnCombatFlowEnemy(f, p.pos.x + 1.8, p.pos.z, { hp: 100000, maxHp: 100000, stun: 10 });
  f.game.input.press('attack'); stepCombatFlow(f, dt);
  advanceUntil(f, () => p.canQueueCombo(), dt);
  f.game.input.move.x = 1; f.game.input.press('attack'); p.handleInput(f.game.input, dt); f.game.input.move.x = 0;
  advanceUntil(f, () => p.comboIdx === 1 && p.hitDone, dt);
  expect(f.events.hits.map((hit: any) => hit.enemy === front ? 'front' : hit.enemy === side ? 'side' : 'other')).toEqual(['front', 'side']);
  expect(front.hp).toBeLessThan(100000); expect(side.hp).toBeLessThan(100000);
});

test('회피 중 예약한 반격은 방향 입력을 놓거나 바꾸어도 누른 순간의 방향을 사용한다', () => {
  for (const hero of Object.keys(HEROES)) for (const fps of [30, 60, 120]) {
    const f = fixture(hero), p: any = f.player, dt = 1 / fps;
    p.dodge(new THREE.Vector3(1, 0, 0)); advanceUntil(f, () => p.stateT >= .24, dt);
    f.game.input.move.x = -1; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
    f.game.input.move.x = 0; f.game.input.move.y = 1;
    advanceUntil(f, () => p.state === 'attack', dt);
    expect(p.yaw).toBeCloseTo(-Math.PI / 2); expect(p.attackBufferYaw).toBeNull();
  }
});

test('방향 없는 새 공격과 만료된 회피 중 공격 예약은 오래된 방향을 적용하지 않는다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 120;
  p.startCombo(0); advanceUntil(f, () => p.canQueueCombo(), dt);
  f.game.input.move.x = 1; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
  f.game.input.move.x = 0; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
  advanceUntil(f, () => p.comboIdx === 1, dt); expect(p.yaw).toBe(0);

  p.dodge(new THREE.Vector3(1, 0, 0));
  f.game.input.move.x = -1; f.game.input.press('attack'); p.handleInput(f.game.input, dt); f.game.input.move.x = 0;
  advanceUntil(f, () => p.state === 'idle', dt);
  expect(p.attackBufferT).toBe(0); expect(p.attackBufferYaw).toBeNull();
  f.game.input.press('attack'); stepCombatFlow(f, dt);
  expect(p.state).toBe('attack'); expect(p.yaw).toBeCloseTo(Math.PI / 2);
});

test('pause·clear·기절·AUTO 경계는 수락된 콤보를 지우지 않고 이전 수동 방향만 폐기한다', () => {
  for (const boundary of ['pause', 'clear', 'stun', 'auto']) {
    const f = fixture(), p: any = f.player, dt = 1 / 120;
    p.startCombo(0); advanceUntil(f, () => p.canQueueCombo(), dt);
    f.game.input.move.x = 1; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
    expect(p.comboQueuedYaw).toBeCloseTo(Math.PI / 2); expect(p.comboQueued).toBe(true);
    f.game.input.move.x = 0;
    if (boundary === 'pause') { Battle.prototype.setPaused.call(f.game, 'menu', true); Battle.prototype.setPaused.call(f.game, 'menu', false); }
    if (boundary === 'clear') f.game.input.clear();
    if (boundary === 'stun') { p.stun = .001; stepCombatFlow(f, dt); }
    if (boundary === 'auto') { p.auto = true; stepCombatFlow(f, dt); p.auto = false; f.game.input.move.x = 0; f.game.input.move.y = 0; }
    expect(p.comboQueuedYaw).toBeNull(); expect(p.comboQueued).toBe(true);
    advanceUntil(f, () => p.comboIdx === 1, dt);
    expect(p.yaw).toBe(0);
  }
});

test('강타·사망·스킬 전환 뒤 새 입력은 이전에 예약한 공격 방향을 재생하지 않는다', () => {
  for (const boundary of ['heavy', 'death', 'skill']) {
    const f = fixture(), p: any = f.player, dt = 1 / 120;
    p.startCombo(0); advanceUntil(f, () => p.canQueueCombo(), dt);
    f.game.input.move.x = 1; f.game.input.press('attack'); p.handleInput(f.game.input, dt); f.game.input.move.x = 0;
    if (boundary === 'heavy') { p.hurt(10, { kb: 6 }); advanceUntil(f, () => p.state === 'idle', dt); }
    if (boundary === 'death') { p.die(); p.revive(); }
    if (boundary === 'skill') {
      advanceUntil(f, () => p.canSkillCancel(), dt); expect(p.tryCastCombatSkill(0)).toBe(true);
      advanceUntil(f, () => p.state === 'idle', dt);
    }
    expect(p.attackBufferYaw).toBeNull(); expect(p.comboQueuedYaw).toBeNull();
    f.game.input.press('attack'); stepCombatFlow(f, dt);
    expect(p.state).toBe('attack'); expect(p.yaw).toBe(0);
  }
});

test('5영웅의 4방향 무입력 회피는 바라보는 방향을 유지한 백스텝이며 자동 공격·추가 보상이 없다', () => {
  for (const hero of Object.keys(HEROES)) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const f = fixture(hero), p: any = f.player, from = p.pos.clone(), forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    p.yaw = yaw; const ult = p.ult, mp = p.mp;
    f.game.input.press('dodge'); p.handleInput(f.game.input, 1 / 60);
    expect(p.state).toBe('dodge'); expect(p.actionName).toBe('Dodge_Backward'); expect(p.yaw).toBe(yaw);
    expect(p.vel.dot(forward)).toBeCloseTo(-19); expect(p.dodgeCd).toBe(DODGE_COOLDOWN_SEC);
    expect(p.invuln).toBe(.4); expect(p.perfectWindow).toBe(.28); expect(p.ult).toBe(ult); expect(p.mp).toBe(mp);
    advanceUntil(f, () => p.state === 'idle', 1 / 60);
    expect(p.pos.clone().sub(from).dot(forward)).toBeLessThan(0); expect(p.yaw).toBe(yaw);
    expect(f.events.hits).toHaveLength(0); expect(p.comboIdx).toBe(0); expect(p.ult).toBe(ult);
  }
});

test('백스텝 후 실제 공격 예약만 기존 방향으로 반격하고 방향을 누른 회피와 AUTO는 그대로 전방 회피한다', () => {
  for (const hero of Object.keys(HEROES)) for (const fps of [30, 60, 120]) {
    const f = fixture(hero), p: any = f.player, dt = 1 / fps;
    p.yaw = Math.PI / 2;
    f.game.input.press('dodge'); stepCombatFlow(f, dt);
    advanceUntil(f, () => p.stateT >= .24, dt);
    f.game.input.press('attack'); stepCombatFlow(f, dt);
    advanceUntil(f, () => p.state === 'attack', dt);
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
    p.dodgeCd = 0; p.state = 'idle'; f.game.input.move.x = -1;
    f.game.input.press('dodge'); p.handleInput(f.game.input, dt);
    expect(p.actionName).toBe('Dodge_Forward'); expect(p.yaw).toBeCloseTo(-Math.PI / 2); expect(p.vel.x).toBeCloseTo(-19);
    p.auto = true; p.yaw = 0; p.dodge(null);
    expect(p.actionName).toBe('Dodge_Forward'); expect(p.yaw).toBe(0); expect(p.vel.z).toBe(19);
  }
});

test('백스텝은 실제 Floor 벽을 관통하지 않고 후방 클립이 없는 리그에는 기존 전방 클립을 사용한다', () => {
  for (const hero of Object.keys(HEROES)) {
    const f = fixture(hero), p: any = f.player, world = f.game.world;
    // 현재 방 뒤쪽에 실제 충돌 마스크 한 줄을 배치해 이동 끝점이 아닌 전체 경로를 검사한다.
    const row = Math.floor(p.pos.z - world.minZ) - 1;
    for (let column = 0; column < world.cols; column++) world.mask[row * world.cols + column] = 0;
    const wallTop = world.minZ + row + 1;
    delete p.clips.Dodge_Backward;
    p.yaw = 0; p.dodge(null);
    expect(p.actionName).toBe('Dodge_Forward'); expect(p.vel.z).toBe(-19); expect(p.yaw).toBe(0);
    for (let frame = 0; frame < 30; frame++) {
      stepCombatFlow(f, 1 / 60);
      expect(world.walkable(p.pos.x, p.pos.z)).toBe(true); expect(p.pos.z).toBeGreaterThanOrEqual(wallTop);
    }
  }
});

test('백스텝 자체에는 완벽 회피 보상이 없고 기존 피격 판정이 회피 창에 닿아야 한 번 지급한다', () => {
  const f = fixture(), p: any = f.player;
  f.game.onPerfectDodge = Battle.prototype.onPerfectDodge;
  f.game.ui.perfectDodge = () => {};
  p.mp = 50; p.dodge(null);
  expect(p.mp).toBe(50); expect(p.ult).toBe(0); expect(p.counterWindow).toBe(0);
  const hp = p.hp;
  expect(p.hurt(100, { kb: 6 })).toBe(false);
  expect(p.hp).toBe(hp); expect(p.mp).toBe(62); expect(p.ult).toBe(18);
  expect(p.counterWindow).toBe(2.4); expect(p.perfectWindow).toBe(0); expect(p.perfectCd).toBe(1.2);
  expect(p.hurt(100, { kb: 6 })).toBe(false);
  expect(p.mp).toBe(62); expect(p.ult).toBe(18);
});

test('회피 중 누른 공격의 짧은 버퍼는 pause·Input.clear에서 취소되고 복귀 뒤 새 입력만 실행된다', () => {
  for (const boundary of ['clear', 'pause']) {
    const f = fixture(), p: any = f.player, dt = 1 / 60;
    p.dodge(new THREE.Vector3(1, 0, 0)); advanceUntil(f, () => p.stateT >= .24, dt);
    f.game.input.move.x = -1; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
    expect(p.attackBufferT).toBe(.14); expect(p.attackBufferYaw).toBeCloseTo(-Math.PI / 2);
    if (boundary === 'pause') {
      Battle.prototype.setPaused.call(f.game, 'menu', true);
      const stateT = p.stateT;
      for (let frame = 0; frame < 12; frame++) stepCombatFlow(f, dt);
      expect(p.stateT).toBe(stateT);
      Battle.prototype.setPaused.call(f.game, 'menu', false);
    } else f.game.input.clear();
    expect(p.attackBufferT).toBe(0); expect(p.attackBufferYaw).toBeNull();
    advanceUntil(f, () => p.state !== 'dodge', dt);
    expect(p.state).toBe('idle'); expect(p.yaw).toBeCloseTo(Math.PI / 2);
    stepCombatFlow(f, dt); expect(p.state).toBe('idle');
    f.game.input.press('attack'); stepCombatFlow(f, dt);
    expect(p.state).toBe('attack'); expect(p.yaw).toBeCloseTo(Math.PI / 2);
  }
});
