import { afterEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Input } from '../src/engine/input.js';
import { Player } from '../src/game/player.js';
import { Battle } from '../src/game/battle-base.js';
import { HEROES, kitOf } from '../src/data/heroes.js';
import { DODGE_COOLDOWN_SEC, DODGE_INVULN_SEC } from '../src/game/progression.js';
import { ENEMY_BOLT, HOSTILE_PROJECTILE_REACH, enemyImpactIn } from '../src/game/enemies.js';
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
  // 2026-10-19: 기본 공격 자동 타겟팅이 기본값이 되었다. 이 파일의 방향 계약은 수동(자동 타겟팅 끔) 기준이다.
  f.game.app.eco = { s: { settings: { autoTarget: false } } };
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
      expect(p.dodgeCd).toBe(Math.max(0, DODGE_COOLDOWN_SEC - dt));
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
      expect(p.dodgeCd).toBe(Math.max(0, cooldown - dt));
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
    // 수동 궁수는 회피 0.16초 뒤 입력을 바로 사격으로 잇는다(회피 중 사격). 방향은 누른 순간의 입력이다.
    // 검은 고양이 사냥꾼(kit ranger)도 같은 수동 궁수 규칙이다.
    if (kitOf(hero) === 'ranger') { expect(p.state).toBe('attack'); expect(p.yaw).toBeCloseTo(-Math.PI / 2); expect(p.attackBufferYaw).toBeNull(); continue; }
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
    f.game.input.move.x = 0; f.game.input.move.y = 1;
    advanceUntil(f, () => p.state === 'attack', dt);
    expect(p.yaw).toBeCloseTo(-Math.PI / 2); expect(p.attackBufferYaw).toBeNull();
  }
});

test('방향 없는 새 공격은 오래된 방향을 적용하지 않고, 회피 시작 직후 누른 공격은 회피 뒤 누른 방향으로 한 번 실행된다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 120;
  p.startCombo(0); advanceUntil(f, () => p.canQueueCombo(), dt);
  f.game.input.move.x = 1; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
  f.game.input.move.x = 0; f.game.input.press('attack'); p.handleInput(f.game.input, dt);
  advanceUntil(f, () => p.comboIdx === 1, dt); expect(p.yaw).toBe(0);

  p.dodge(new THREE.Vector3(1, 0, 0));
  f.game.input.move.x = -1; f.game.input.press('attack'); p.handleInput(f.game.input, dt); f.game.input.move.x = 0;
  // 2026-10-19 의도 변경: 예전에는 0.14초 버퍼가 회피(0.32초) 중에 만료돼 이 입력이 사라졌다("어디서 눌러도 공격" 요구 위반).
  // 이제 회피가 끝나는 프레임에 누른 순간의 방향으로 실행되고, 버퍼·방향은 남지 않는다.
  advanceUntil(f, () => p.state !== 'dodge', dt);
  expect(p.state).toBe('attack'); expect(p.yaw).toBeCloseTo(-Math.PI / 2);
  expect(p.attackBufferT).toBe(0); expect(p.attackBufferYaw).toBeNull();
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
    expect(p.invuln).toBe(DODGE_INVULN_SEC); expect(p.perfectWindow).toBe(.28); expect(p.ult).toBe(ult); expect(p.mp).toBe(mp);
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
    // 2026-10-19: 버퍼는 남은 회피 시간 + 0.14초다(회피가 끝나기 전에 만료되지 않는다).
    expect(p.attackBufferT).toBeCloseTo(.32 - p.stateT + .14, 6); expect(p.attackBufferYaw).toBeCloseTo(-Math.PI / 2);
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

test('쿨타임 없는 회피: 구르기가 끝나면 바로 다시 구르고, 진행 중 회피·기절·사망·일시정지는 그대로 막는다', () => {
  expect(DODGE_COOLDOWN_SEC).toBe(0);
  for (const fps of [30, 60, 120]) {
    const f = fixture(), p: any = f.player, dt = 1 / fps, input = f.game.input;
    input.move.x = 1; input.press('dodge'); p.handleInput(input, dt);
    expect(p.state).toBe('dodge'); expect(p.dodgeCd).toBe(0); expect(p.invuln).toBe(DODGE_INVULN_SEC);
    // 구르는 중 다시 눌러도 새 회피로 덮어쓰지 않는다(시간·무적을 다시 채우지 않는다).
    stepCombatFlow(f, dt); const stateT = p.stateT, invuln = p.invuln;
    input.press('dodge'); p.handleInput(input, dt);
    expect(p.stateT).toBe(stateT); expect(p.invuln).toBe(invuln);
    advanceUntil(f, () => p.state !== 'dodge', dt);
    // 무적은 구르기 안쪽에서 이미 끝났고, 다음 프레임 입력으로 곧바로 다시 구른다.
    expect(p.invuln).toBeLessThanOrEqual(0);
    input.press('dodge'); stepCombatFlow(f, dt);
    expect(p.state).toBe('dodge'); expect(p.dodgeCd).toBe(0);
    advanceUntil(f, () => p.state !== 'dodge', dt);
    input.move.x = 0; stepCombatFlow(f, dt);
    for (const blocked of ['stun', 'dead', 'pause']) {
      if (blocked === 'stun') p.stun = .3;
      if (blocked === 'dead') p.alive = false;
      if (blocked === 'pause') Battle.prototype.setPaused.call(f.game, 'menu', true);
      const before = p.state;
      input.press('dodge');
      if (blocked === 'pause') stepCombatFlow(f, dt); else p.handleInput(input, dt);
      expect(p.state).toBe(before);
      if (blocked === 'stun') p.stun = 0;
      if (blocked === 'dead') p.alive = true;
      if (blocked === 'pause') {
        // 일시정지 중 입력은 재개 뒤 재생되지 않는다.
        Battle.prototype.setPaused.call(f.game, 'menu', false); stepCombatFlow(f, dt); expect(p.state).not.toBe('dodge');
      }
      input.clear();
    }
  }
});

test('회피 연타는 3초 동안 매 구르기 사이에 맞을 수 있는 프레임을 남기고, 구르기를 사격으로 끊으면 회피 무적도 끝난다', () => {
  for (const fps of [30, 60, 120]) {
    const f = fixture(), p: any = f.player, dt = 1 / fps, input = f.game.input;
    let starts = 0, gaps = 0, exposedSinceStart = true, covered = 0, frames = 0;
    for (let t = 0; t < 3; t += dt) {
      input.press('dodge'); const was = p.state === 'dodge' ? p.stateT : -1;
      stepCombatFlow(f, dt); frames++;
      if (p.state === 'dodge' && (was < 0 || p.stateT < was)) { starts++; if (exposedSinceStart) gaps++; exposedSinceStart = false; }
      if (p.invuln > 0) covered++; else exposedSinceStart = true;
    }
    // 1프레임마다 눌러도 구르기는 약 0.32초마다 한 번이며, 매번 그 앞에 맞을 수 있는 프레임이 있었다.
    expect(starts).toBeGreaterThanOrEqual(8); expect(gaps).toBe(starts);
    expect(covered / frames).toBeLessThan(.9);
  }
  const f = fixture('ranger'), p: any = f.player, dt = 1 / 60, input = f.game.input;
  p.yaw = 0; input.move.x = 1; input.press('dodge'); stepCombatFlow(f, dt);
  input.move.x = 0; input.press('attack');
  advanceUntil(f, () => p.state === 'attack', dt);
  expect(p.stateT).toBeLessThan(DODGE_INVULN_SEC);
  expect(p.invuln).toBe(0);
  // 부활처럼 다른 출처의 무적은 회피를 끊어도 남은 만큼 유지한다.
  const g = fixture('ranger'), q: any = g.player;
  q.invuln = 1; g.game.input.press('dodge'); stepCombatFlow(g, dt); g.game.input.press('attack');
  advanceUntil(g, () => q.state === 'attack', dt);
  expect(q.invuln).toBeGreaterThan(.6); expect(q.invuln).toBeLessThan(1);
});

test('AUTO는 쿨타임 없이도 같은 예고 하나에 한 번만 구르고 무적 중에는 다시 구르지 않는다', () => {
  const f = fixture(), p: any = f.player, dt = 1 / 60, random = Math.random;
  // 실제 타격까지 0.2초 남은 정예 공격(회피 무적 0.26초 안). 예고가 이보다 이르면 아래 타이밍 테스트가 본다.
  const threat = spawnCombatFlowEnemy(f, p.pos.x + 2, p.pos.z, { telegraph: .2, state: 'attack', isElite: true, attackDur: 1, hitAt: .5, stateT: .3 });
  Math.random = () => 0;
  try {
    // 스킬 우선 분기가 먼저 반환하지 않게 스킬 자원을 비운다(회피 판단만 본다).
    p.auto = true; f.game.elapsed = 10; p.mp = 0; p.ult = 0; p.cds = p.cds.map(() => 99);
    expect(enemyImpactIn(threat, p)).toBeCloseTo(.2, 9);
    p.autoMove(dt); expect(f.game.input.queue.filter((n: string) => n === 'dodge')).toHaveLength(1);
    f.game.input.clear(); p.dodge(null);
    p.state = 'idle'; p.autoMove(dt); expect(f.game.input.queue).not.toContain('dodge');
    // 같은 타격은 그 시각(+0.15초)까지 다시 피하지 않는다.
    p.invuln = 0; f.game.elapsed = 10.3; p.autoMove(dt); expect(f.game.input.queue).not.toContain('dodge');
    // 그 예고가 끝난 뒤의 새 예고에는 다시 반응한다.
    f.game.elapsed = 10.4; p.autoMove(dt); expect(f.game.input.queue).toContain('dodge');
  } finally { Math.random = random; threat.mobRole?.dispose?.(); }
});

// 실제 정예 공격 한 번을 Enemy.update로 진행시키며 AUTO가 언제 구르는지 본다. 확률 문은 0으로 고정해 '언제'만 남긴다.
function eliteStrike(heroId: string, fps: number, auto: boolean) {
  const f = fixture(heroId), p: any = f.player, dt = 1 / fps, random = Math.random;
  const enemy: any = spawnCombatFlowEnemy(f, p.pos.x + 1.6, p.pos.z, { id: 'elite_yeti', isElite: true, hp: 1e7, maxHp: 1e7, atkCd: 99 });
  enemy.yaw = Math.atan2(p.pos.x - enemy.pos.x, p.pos.z - enemy.pos.z);
  p.auto = auto; p.mp = 0; p.ult = 0; p.cds = p.cds.map(() => 99);
  try {
    Math.random = () => .5; enemy.startAttack(1.6);   // 0.3 미만이면 정예 회전기가 된다. 기본 정예 타격을 고른다.
    expect(enemy.state).toBe('attack'); expect(enemy.special).toBe(null);
    expect(enemy.hitAt * enemy.attackDur).toBeGreaterThan(.6);
    Math.random = () => 0;
    const starts: number[] = []; let early = 0, strike: any = null;
    for (let i = 0; i < fps * 2 && !strike; i++) {
      const lead = enemyImpactIn(enemy, p), wasDodge = p.state === 'dodge', hp = p.hp, done = enemy.attackDone;
      const ready = p.state === 'idle' || p.state === 'move' || (p.state === 'attack' && p.canDodgeCancel());
      stepCombatFlow(f, dt);
      if (p.state === 'dodge' && !wasDodge) starts.push(lead);
      else if (ready && lead > .4) early++;
      if (!done && enemy.attackDone) strike = { lost: hp - p.hp, invuln: p.invuln };
    }
    return { starts, early, strike, dt };
  } finally { Math.random = random; }
}

test('AUTO는 실제 타격까지 0.4초 넘게 남은 정예 예고에는 구르지 않고, 남은 시간이 회피 무적 안에 들어온 뒤 한 번 굴러 그 타격을 막는다', () => {
  // 대조: 같은 정예 타격을 가만히 맞으면 실제로 피해가 들어오는 위치·방향이다.
  const still = eliteStrike('knight', 60, false);
  expect(still.starts).toHaveLength(0); expect(still.strike.lost).toBeGreaterThan(0);
  for (const heroId of ['knight', 'mage']) for (const fps of [30, 60, 120]) {
    const { starts, early, strike, dt } = eliteStrike(heroId, fps, true);
    // 구를 수 있는 프레임(대기·이동·공격 캔슬 창)에 남은 시간이 0.4초 넘는 예고가 보였지만 구르지 않았다.
    expect(early).toBeGreaterThan(0);
    expect(starts).toHaveLength(1);
    expect(starts[0] + dt).toBeLessThan(DODGE_INVULN_SEC);
    // 그 타격 순간 회피 무적이 남아 있었고 HP는 줄지 않았다.
    expect(strike).not.toBeNull(); expect(strike.invuln).toBeGreaterThan(0); expect(strike.lost).toBe(0);
  }
});

test('예고 링과 실제 타격 시각이 다른 공격은 실제 타격까지의 시간으로 판단한다(돌진·탄환·자폭·지원 시전)', () => {
  const f = fixture('mage'), p: any = f.player;
  // 돌진: 예고는 0.45 지점에서 끝나지만 타격은 0.85 지점이다.
  const dash: any = spawnCombatFlowEnemy(f, p.pos.x + 3, p.pos.z, { state: 'attack', special: 'dash', attackDur: 1, hitAt: .85, stateT: .3, telegraph: .15 });
  expect(enemyImpactIn(dash, p)).toBeCloseTo(.55, 9);
  // 원거리 탄환: 발사까지 남은 시간에 실제 비행 거리(총구 0.8, 탄 반경, 접촉 0.6)/속도를 더한다.
  const mage: any = spawnCombatFlowEnemy(f, p.pos.x + 3.5, p.pos.z, { id: 'skel_mage', state: 'attack', attackDur: 2, hitAt: .5, stateT: .9, telegraph: .1 });
  expect(enemyImpactIn(mage, p)).toBeCloseTo(.1 + (3.5 - .8 - ENEMY_BOLT.radius - HOSTILE_PROJECTILE_REACH) / ENEMY_BOLT.speed, 9);
  // 자폭: 도화선 0.7초 중 남은 시간.
  const bomb: any = spawnCombatFlowEnemy(f, p.pos.x - 2, p.pos.z, { id: 'bomb_slime', fuse: .5, telegraph: .7 });
  expect(enemyImpactIn(bomb, p)).toBeCloseTo(.2, 9);
  // 지원 치유 시전: 예고 링은 있지만 영웅을 치지 않으므로 AUTO가 구를 대상이 아니다(이전 공격의 hitAt이 남아 있어도).
  const healer: any = spawnCombatFlowEnemy(f, p.pos.x, p.pos.z + 2, { id: 'skel_priest', state: 'attack', supportCastKind: 'heal', special: 'support_heal', telegraph: .2, attackDur: 1, hitAt: .5, stateT: .4 });
  expect(enemyImpactIn(healer, p)).toBe(Infinity);
  p.auto = true; p.mp = 0; p.ult = 0; p.cds = p.cds.map(() => 99);
  f.game.enemies = [healer]; const random = Math.random; Math.random = () => 0;
  try { p.autoMove(1 / 60); expect(f.game.input.queue).not.toContain('dodge'); } finally { Math.random = random; }
});

// 원거리 영웅 AUTO 주위에 깨어 있는 근접 3마리를 붙여 두고 실제 Player/Enemy/Floor로 진행한다.
function rangedPressed(heroId: string, place: (f: any) => { x: number, z: number, away: number }, slowed = false) {
  const f = fixture(heroId), p: any = f.player, dt = 1 / 60, W = f.game.world, random = Math.random;
  const at = place(f); p.pos.set(at.x, 0, at.z);
  p.auto = true; p.mp = 0; p.ult = 0; p.cds = p.cds.map(() => 99); p.hp = p.maxHp = 1e7;
  // 따라붙는 무리: 영웅은 실제 감속 상태(이동 0.5배)이고, 적은 공격 차례를 기다리며(큰 atkCd) 사거리 끝까지 계속 쫓는다.
  if (slowed) { p.slow = .5; p.slowT = 99; }
  const toward = -at.away;   // 적은 영웅이 물러설 방향의 반대편에 선다
  const foes = [[2.2, 0], [1.8, 1.3], [1.8, -1.3]].map(([dx, dz]) =>
    spawnCombatFlowEnemy(f, at.x + toward * dx, at.z + dz, { id: 'bell_wisp', hp: 1e7, maxHp: 1e7, atkCd: slowed ? 99 : .3 }));
  let firstFight = -1, backFrames = 0, offFloor = 0, fightFrames = 0;
  Math.random = () => .99;   // AUTO 확률 회피를 끄고 후퇴/공격 판단만 본다
  try {
    for (let i = 0; i < 360; i++) {
      const near = foes.some((e: any) => e.alive && e.distTo(p) < 4), x0 = p.pos.x;
      stepCombatFlow(f, dt);
      if (!W.walkable(p.pos.x, p.pos.z)) offFloor++;
      if (p.state === 'attack' || p.state === 'skill') { fightFrames++; if (firstFight < 0) firstFight = i * dt; }
      if (near && p.state === 'move' && (p.pos.x - x0) * at.away > 0) backFrames++;
    }
  } finally { Math.random = random; }
  return { firstFight, backSec: backFrames * dt, offFloor, fightSec: fightFrames * dt };
}

test('원거리 AUTO는 따라붙는 근접 무리에게서 끝없이 물러서지 않는다: 1.5초 안에 공격하고 후퇴는 상한을 넘지 않는다', () => {
  for (const heroId of ['mage', 'ranger']) for (const slowed of [false, true]) {
    const r = rangedPressed(heroId, f => ({ x: f.room.x, z: f.room.z, away: 1 }), slowed);
    expect(r.firstFight).toBeGreaterThanOrEqual(0); expect(r.firstFight).toBeLessThan(1.5);
    expect(r.backSec).toBeLessThanOrEqual(1.2 + 2 / 60);
    expect(r.offFloor).toBe(0);
    expect(r.fightSec).toBeGreaterThan(3);
  }
});

test('원거리 AUTO는 등 뒤가 실제 Floor 벽이면 벽으로 밀지 않고 바로 그 자리에서 공격한다', () => {
  for (const heroId of ['mage', 'ranger']) {
    const r = rangedPressed(heroId, f => {
      const W = f.game.world, room = f.room;
      // 방 중심에서 동쪽으로 실제 마스크가 끝나는 x. 문이 없는 벽 구간(위아래 1.5까지 같은 벽)을 고른다.
      const wallX = (z: number) => { let x = room.x; while (W.walkable(x, z) && x < room.x + room.w) x += .25; return x; };
      let z = NaN;
      for (let dz = 0; dz < room.h / 2 - 2 && Number.isNaN(z); dz += .5)
        for (const c of [room.z + dz, room.z - dz]) if ([-1.5, 0, 1.5].every(o => wallX(c + o) < room.x + room.w / 2 + 2)) { z = c; break; }
      expect(Number.isNaN(z)).toBe(false);
      const x = wallX(z) - 1;
      expect(W.walkable(x + 1, z)).toBe(false);
      return { x, z, away: 1 };
    });
    expect(r.firstFight).toBeGreaterThanOrEqual(0); expect(r.firstFight).toBeLessThan(.2);
    expect(r.backSec).toBeLessThan(.1);
    expect(r.offFloor).toBe(0);
  }
});
