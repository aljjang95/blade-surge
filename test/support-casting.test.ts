import { afterEach, expect, spyOn, test } from 'bun:test';
import { Color, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Scene, Vector3 } from 'three';
import { audio } from '../src/engine/audio.js';
import { ENEMIES } from '../src/data/stages.js';
import { HEROES } from '../src/data/heroes.js';
import { RIGS } from '../src/data/rigs.js';
import { Enemy } from '../src/game/enemies.js';
import { Battle } from '../src/game/battle-base.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster, supportCastingForStage } from '../src/game/expedition-combat.js';
import { postureHit } from '../src/game/masterworks-combat.js';
import { Player } from '../src/game/player.js';
import { SKILLS } from '../src/game/skills.js';
import { UI } from '../src/ui/ui.js';

const noop = () => {};
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

function cueFixture() {
  const classes = new Set<string>();
  const el = { textContent: '', dataset: {} as Record<string, string>, offsetWidth: 1,
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
  const ui: any = Object.assign(Object.create(UI.prototype), { combatCueEl: el, combatCueTimer: null, combatCueOwner: null });
  return { ui, el, classes };
}

function fixture() {
  const stage = buildExpeditionStage('dungeon', 'bellfall_crypt', null), world = buildExpeditionWorld(stage);
  const room = world.rooms[1]; room.spawned = true; room.discovered = true;
  const camera = new PerspectiveCamera(50, 844 / 390, .1, 100);
  camera.position.set(room.x, 20, room.z + 20); camera.lookAt(room.x, 1, room.z); camera.updateMatrixWorld(true);
  const cues: string[] = [], effects: string[] = [], spawns: string[] = [], summons: number[] = [];
  const { ui, el, classes } = cueFixture();
  // 모델·음향·DOM만 대역이다. Actor 이동/기절, Enemy 시전/피격, Battle 소환은 실제 메서드를 쓴다.
  ui.combatCue = (label: string, _tone: string, _duration: number, owner: any) => {
    cues.push(label); el.textContent = label; ui.combatCueOwner = owner; classes.add('on');
  };
  ui.showHud = noop; ui.toast = noop;
  const oldAudio = audio.enabled; audio.enabled = false; cleanup.push(() => { audio.enabled = oldAudio; });
  const game: any = Object.assign(Object.create(Battle.prototype), {
    stage, world, curRoom: room, _startGeneration: 1, active: true, paused: false, bossDefeated: false,
    scene: new Scene(), enemies: [], maxAlive: 16, timers: [], pending: [], projectiles: [],
    elapsed: 0, ui, app: {}, renderer: { camera }, input: { clear: noop },
    fx: { embers: () => effects.push('embers'), groundTex: () => effects.push('ground'),
      damage: (_pos: any, _damage: number, options: any) => effects.push(options.text), clearAll: noop },
    drops: { clear: noop }, onEnemyDeath: noop,
    player: { alive: true, pos: new Vector3(room.x + 5, 0, room.z), dispose: noop },
    spawnEnemy: (id: string) => { spawns.push(id); game.enemies.push({ alive: true, dispose: noop }); },
  });
  game.summonMinions = (caster: any, count: number) => {
    summons.push(count); Battle.prototype.summonMinions.call(game, caster, count);
  };
  const caster: any = Object.create(Enemy.prototype), root = new Group(), model = new Group(), motionRoot = new Group();
  root.add(motionRoot); motionRoot.add(model); root.position.set(room.x, 0, room.z); game.scene.add(root);
  const ring = new Mesh(new RingGeometry(.68, .9, 32), new MeshBasicMaterial()); root.add(ring); ring.visible = false;
  const marker = new Mesh(new RingGeometry(.95, 1.25, 28), new MeshBasicMaterial()); root.add(marker);
  const played: string[] = [];
  Object.assign(caster, { game, root, model, motionRoot, pos: root.position, rig: RIGS.kaykit,
    clips: Object.fromEntries(['Spellcast_Shoot', 'Idle_Combat', 'Idle', 'Hit_A', 'Hit_B', 'Walking_Backwards', 'Walking_D_Skeletons'].map(name => [name, { duration: .6 }])),
    mixer: { update: noop, stopAllAction: noop, uncacheRoot: noop, getRoot: () => model },
    play: (name: string) => { played.push(name); caster.actionName = name; },
    playTimed: (name: string) => { played.push(name); caster.actionName = name; },
    def: ENEMIES.glass_tollmage, behavior: 'shaman', runtimeSpeciesId: 'glass_tollmage', homeRoom: room,
    alive: true, dead: false, disposed: false, spawning: false, isBoss: false, isElite: false,
    state: 'chase', stateT: 0, special: null, telegraph: 0, telegraphRing: ring, marker,
    supportOwner: null, supportCastKind: null, supportCueLabel: null,
    hp: 720, maxHp: 720, atk: 23, atkCd: 99, attackDur: 2.1, hitAt: .5, attackDone: false,
    radius: .75, yaw: 0, vel: new Vector3(), kb: new Vector3(), stun: 0, slow: 0, slowT: 0,
    invuln: 0, flashT: 0, flashColor: new Color(), mats: [], deathT: -1, stagger: 0,
    guardBroken: 0, healT: 0, summonT: 99, poison: 0, phase: 0, posture: 0, breakT: 0,
  });
  const ally: any = { alive: true, spawning: false, pos: new Vector3(room.x + 2, 0, room.z),
    hp: 500, maxHp: 1000, radius: .7, dispose: noop,
    distTo: (other: any) => Math.hypot(ally.pos.x - other.pos.x, ally.pos.z - other.pos.z) };
  game.enemies.push(caster, ally); cleanup.push(() => caster.dispose());
  return { game, caster, ally, stage, world, room, cues, effects, spawns, summons, played, ui, el, classes };
}
type Fixture = ReturnType<typeof fixture>;
function step(f: Fixture, dt: number) { f.game.elapsed += f.game.paused ? 0 : dt; f.caster.update(dt); }
function start(f: Fixture, kind = 'heal') {
  if (kind === 'summon') { f.ally.hp = f.ally.maxHp; f.caster.healT = 99; f.caster.summonT = 0; }
  step(f, .01); expect(f.caster.supportCastKind).toBe(kind);
}

test('종락 기본 개인 원정의 실제 편성만 지원 시전 규칙을 얻는다', () => {
  const f = fixture(), rule: any = supportCastingForStage(f.stage);
  expect(rule).toMatchObject({ enemyId: 'glass_tollmage', windupSeconds: .9 }); expect(Object.isFrozen(rule)).toBe(true);
  expect(expeditionRoster(f.stage, f.room).filter(id => id === rule.enemyId)).toHaveLength(1);
  expect(expeditionRoster(f.stage, f.world.bossRoom)).toEqual([f.stage.encounter.enemyId]);
  for (const stage of [{ ...f.stage, party: {} }, { ...f.stage, riftId: 'fury' },
    ...[{ riftId: 'iron' }, { conquestId: 'x' }, { depth: 'deep' }, { depth: undefined },
      { kind: 'arena' }, { id: 'glass_garden' }].map(extra => ({ ...f.stage, expedition: { ...f.stage.expedition, ...extra } }))]) {
    expect(supportCastingForStage(stage)).toBeNull();
  }
  f.caster.runtimeSpeciesId = 'skel_priest'; step(f, .01);
  expect(f.caster.supportOwner).toBeNull(); expect(f.ally.hp).toBe(650);
});

test('소환 뒤 붙은 실제 종 ID를 읽고 준비 중에는 치유나 일반 공격을 실행하지 않는다', () => {
  const f = fixture(), random = spyOn(Math, 'random').mockReturnValue(.5), attack = spyOn(f.caster, 'doAttack');
  cleanup.push(() => random.mockRestore()); cleanup.push(() => attack.mockRestore());
  delete f.caster.runtimeSpeciesId; f.caster.healT = 10; step(f, .01);
  expect(f.caster.supportOwner).toBeNull(); f.caster.runtimeSpeciesId = 'glass_tollmage'; f.caster.healT = 0;
  start(f); expect(f.ally.hp).toBe(500); expect(f.effects).toHaveLength(0); expect(f.caster.healT).toBe(6);
  f.caster.finishSupportCast(); expect(f.ally.hp).toBe(500); expect(f.caster.supportCastKind).toBe('heal');
  step(f, .899); expect(f.ally.hp).toBe(500); expect(f.caster.telegraph).toBeGreaterThan(0);
  step(f, .001); expect(f.ally.hp).toBe(650); expect(f.effects.filter(x => x === '치유 ×1')).toHaveLength(1);
  expect(f.caster.supportCastKind).toBeNull(); expect(f.caster.state).toBe('chase');
  expect(attack).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
});

test('완료 때의 살아 있는 범위 내 부상 대상만 기존 상한으로 회복한다', () => {
  const f = fixture(); start(f);
  const arrived: any = { ...f.ally, hp: 990, pos: f.ally.pos.clone(), distTo: () => 6 };
  const dead: any = { ...arrived, alive: false, hp: 100 }, tooFar: any = { ...arrived, hp: 100, distTo: () => 6.001 };
  f.game.enemies.push(arrived, dead, tooFar); f.ally.pos.x = f.caster.pos.x + 7;
  step(f, .9);
  expect(f.ally.hp).toBe(500); expect(arrived.hp).toBe(1000); expect(dead.hp).toBe(100); expect(tooFar.hp).toBe(100);
});

test('근접 반응 없는 약타는 유지하고 기존 근접 반응·강타·기절은 즉시 취소한다', () => {
  const weak = fixture(); start(weak); weak.caster.hurt(10, { kb: 1, hitReact: false });
  expect(weak.caster.supportCastKind).toBe('heal'); step(weak, .9); expect(weak.ally.hp).toBe(650);
  for (const hit of [{ kb: 1, hitReact: true }, { kb: 4 }, { kb: 1, stun: .001 }]) {
    const f = fixture(); start(f); f.caster.hurt(10, hit);
    expect(f.caster.supportCastKind).toBeNull(); expect(f.caster.telegraphRing.visible).toBe(false);
    expect(f.classes.has('on')).toBe(false); expect(f.caster.healT).toBe(6);
    step(f, .9); expect(f.ally.hp).toBe(500); expect(f.effects).toHaveLength(0);
  }
});

test('프레임보다 짧은 직접 기절과 실제 BREAK가 완료 직전 시전을 중단한다', () => {
  for (const control of ['stun', 'break']) {
    const f = fixture(); start(f); step(f, .89);
    if (control === 'stun') f.caster.stun = .001;
    else { f.caster.posture = 79; expect(postureHit(f.caster, 10)).toBe(true); }
    step(f, .02); expect(f.caster.supportCastKind).toBeNull(); expect(f.ally.hp).toBe(500);
    expect(f.caster.telegraphRing.visible).toBe(false); expect(f.effects).toHaveLength(0);
  }
});

test('시전 중 예약한 행동 타이머는 멈추고 취소 직후 재시도하지 않는다', () => {
  const f = fixture(); start(f); const summonT = f.caster.summonT;
  step(f, .4); expect(f.caster.healT).toBe(6); expect(f.caster.summonT).toBe(summonT);
  f.caster.hurt(10, { hitReact: true, kb: 1 }); step(f, .9); step(f, .01);
  expect(f.caster.supportCastKind).toBeNull(); expect(f.caster.healT).toBeGreaterThan(5); expect(f.ally.hp).toBe(500);
});

test('두 만기 행동은 부상 아군 치유를 먼저 예약하고 없는 치유는 소환을 막지 않는다', () => {
  const f = fixture(); f.caster.summonT = 0; start(f);
  expect(f.caster.summonT).toBeLessThan(0); expect(f.summons).toHaveLength(0); step(f, .9); step(f, .01);
  expect(f.caster.supportCastKind).toBe('summon'); expect(f.caster.summonT).toBe(9);
  const empty = fixture(); empty.ally.hp = 1000; empty.caster.summonT = 0; step(empty, .01);
  expect(empty.caster.supportCastKind).toBe('summon'); expect(empty.caster.healT).toBe(6);
});

test('지원 소환은 준비 완료 후 정식 서비스에 한 번만 두 병력을 요청한다', () => {
  const f = fixture(); start(f, 'summon'); expect(f.summons).toHaveLength(0); expect(f.game.timers).toHaveLength(0);
  step(f, .899); expect(f.summons).toHaveLength(0); step(f, .001);
  expect(f.summons).toEqual([2]); expect(f.game.timers.map((t: any) => t.t)).toEqual([0, .12]);
  for (const timer of f.game.timers.splice(0)) timer.fn();
  expect(f.spawns).toEqual(['glass_shardling', 'glass_shardling']);
  f.caster.finishSupportCast(); expect(f.summons).toEqual([2]);
});

test('소환 준비 중 취소는 예약 0회이며 기존 정원 조건 실패도 쿨다운을 소비한다', () => {
  const f = fixture(); start(f, 'summon'); f.caster.hurt(10, { kb: 4 }); step(f, .9);
  expect(f.summons).toHaveLength(0); expect(f.game.timers).toHaveLength(0); expect(f.caster.summonT).toBe(9);
  const full = fixture(); full.ally.hp = 1000; full.caster.healT = 99; full.caster.summonT = 0; full.game.maxAlive = 5;
  step(full, .01); expect(full.caster.supportCastKind).toBeNull(); expect(full.caster.summonT).toBe(9);
  expect(full.summons).toHaveLength(0);
  const changed = fixture(); start(changed, 'summon'); changed.game.maxAlive = 5; step(changed, .9);
  expect(changed.summons).toHaveLength(0); expect(changed.game.timers).toHaveLength(0); expect(changed.caster.summonT).toBe(9);
});

test('완료 후 예약된 기존 소환도 정원·사망·방 정화를 다시 확인한다', () => {
  for (const change of ['capacity', 'dead', 'clear']) {
    const f = fixture(); start(f, 'summon'); step(f, .9);
    if (change === 'capacity') f.game.maxAlive = 3;
    if (change === 'dead') f.caster.alive = false;
    if (change === 'clear') f.room.cleared = true;
    for (const timer of f.game.timers.splice(0)) timer.fn();
    expect(f.spawns).toHaveLength(change === 'capacity' ? 1 : 0);
  }
});

test('일시정지와 0 dt는 실제 시전·행동·액터 시간을 진행하지 않는다', () => {
  const f = fixture(); start(f); step(f, .4);
  const before = [f.caster.stateT, f.caster.healT, f.caster.summonT, f.caster.stun, f.caster.pos.x];
  f.game.paused = true; Battle.prototype.update.call(f.game, 10); step(f, 10);
  expect([f.caster.stateT, f.caster.healT, f.caster.summonT, f.caster.stun, f.caster.pos.x]).toEqual(before);
  f.game.paused = false; step(f, 0); expect(f.caster.stateT).toBe(before[0]); expect(f.ally.hp).toBe(500);
  step(f, .5); expect(f.ally.hp).toBe(650);
});

const invalidOwners: Array<[string, (f: Fixture) => void]> = [
  ['세대', f => { f.game._startGeneration++; }], ['스테이지', f => { f.game.stage = { ...f.stage }; }],
  ['월드', f => { f.game.world = buildExpeditionWorld(f.stage); }],
  ['방', f => { f.caster.homeRoom = f.world.rooms[3]; }], ['방 정화', f => { f.room.cleared = true; }],
  ['목록 소유권', f => { f.game.enemies = [f.ally]; }], ['종 ID', f => { f.caster.runtimeSpeciesId = 'skel_priest'; }],
  ['비활성 전투', f => { f.game.active = false; }], ['플레이어 사망', f => { f.game.player.alive = false; }],
  ['보스 종료', f => { f.game.bossDefeated = true; }], ['미발견 방', f => { f.room.discovered = false; }],
];
for (const [name, invalidate] of invalidOwners) test(`${name} 뒤 이전 시전이 완료되지 않는다`, () => {
  const f = fixture(); start(f); step(f, .89); invalidate(f); step(f, .02); step(f, 10);
  expect(f.caster.supportCastKind).toBeNull(); expect(f.ally.hp).toBe(500); expect(f.effects).toHaveLength(0);
  expect(f.caster.telegraphRing.visible).toBe(false); expect(f.classes.has('on')).toBe(false);
});

test('실제 사망은 역할 고리를 숨기고 기존 시체 수명·폐기를 끝낸다', () => {
  const f = fixture(); start(f); f.caster.hurt(10000, { hitReact: true, kb: 1 });
  expect(f.caster.alive).toBe(false); expect(f.caster.supportCastKind).toBeNull(); step(f, 2.5);
  expect(f.caster.marker.visible).toBe(false); expect(f.caster.dead).toBe(true); expect(f.ally.hp).toBe(500);
  f.caster.dispose(); expect(f.caster.disposed).toBe(true); expect(f.caster.supportOwner).toBeNull();
});

test('실제 stop은 상태·알림·소환 예약·전용 고리를 회수하고 옛 액터를 재실행하지 않는다', () => {
  const f = fixture(); start(f, 'summon'); Battle.prototype.stop.call(f.game);
  expect(f.game.active).toBe(false); expect(f.game.enemies).toHaveLength(0); expect(f.game.timers).toHaveLength(0);
  expect(f.caster.supportOwner).toBeNull(); expect(f.caster.telegraphRing).toBeNull(); expect(f.classes.has('on')).toBe(false);
  f.game.active = true; f.caster.update(10); expect(f.summons).toHaveLength(0); expect(f.spawns).toHaveLength(0);
  const committed = fixture(); start(committed, 'summon'); step(committed, .9);
  expect(committed.game.timers).toHaveLength(2); Battle.prototype.stop.call(committed.game);
  expect(committed.game.timers).toHaveLength(0); expect(committed.spawns).toHaveLength(0);
});

test('첫 갱신 전에 폐기된 대상도 새 전투에서 옛 즉시 지원 경로로 돌아가지 않는다', () => {
  const f = fixture(); expect(f.caster.supportOwner).toBeNull(); f.caster.dispose();
  expect(f.caster.supportStopped).toBe(true);
  const next = fixture();
  Object.assign(f.game, { stage: next.stage, world: next.world, curRoom: next.room,
    _startGeneration: 2, active: true, player: next.game.player, enemies: [next.ally] });
  f.caster.healT = 0; f.caster.summonT = 0; f.caster.update(10);
  expect(next.ally.hp).toBe(500); expect(f.effects).toHaveLength(0); expect(f.summons).toHaveLength(0);
  expect(f.caster.supportOwner).toBeNull(); expect(f.caster.telegraphRing).toBeNull();
});

test('큰 dt와 중복 완료는 효과를 한 번만 내며 지원 종료는 일반 공격 난수를 소비하지 않는다', () => {
  const f = fixture(); start(f);
  const random = spyOn(Math, 'random').mockReturnValue(.5), attack = spyOn(f.caster, 'doAttack');
  cleanup.push(() => random.mockRestore()); cleanup.push(() => attack.mockRestore());
  const atkCd = f.caster.atkCd; step(f, 20); f.caster.finishSupportCast(); step(f, 0);
  expect(f.ally.hp).toBe(650); expect(f.effects.filter(x => x === '치유 ×1')).toHaveLength(1);
  expect(f.caster.atkCd).toBe(atkCd); expect(attack).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
  f.caster.healT = 99; f.caster.summonT = 99; f.caster.state = 'attack'; f.caster.stateT = 0;
  f.caster.doAttack = noop; step(f, f.caster.attackDur);
  expect(random).toHaveBeenCalledTimes(1); expect(f.caster.atkCd).toBeCloseTo(f.caster.def.atkTime * .6 + .4);
});

test('다른 방·화면 밖·숨긴 시전자는 지원 문구와 고리로 위치를 새로 공개하지 않는다', () => {
  for (const hidden of ['room', 'offscreen', 'model']) {
    const f = fixture();
    if (hidden === 'room') f.game.curRoom = f.world.startRoom;
    if (hidden === 'offscreen') { f.game.renderer.camera.position.x += 1000; f.game.renderer.camera.updateMatrixWorld(true); }
    if (hidden === 'model') f.caster.model.visible = false;
    start(f); expect(f.cues).toHaveLength(0); expect(f.caster.telegraphRing.visible).toBe(false);
    step(f, .9); expect(f.ally.hp).toBe(650);
  }
  const f = fixture(); start(f); expect(f.cues).toHaveLength(1); expect(f.caster.telegraphRing.visible).toBe(true);
  f.game.curRoom = f.world.startRoom; step(f, .1); expect(f.classes.has('on')).toBe(false);
  expect(f.caster.telegraphRing.visible).toBe(false);
});

test('같은 문구의 외부 알림 교체도 이전 시전 소유자가 지우지 못한다', () => {
  const { ui, el, classes } = cueFixture(), owner = {}, foreign = {}, scheduled: (() => void)[] = [];
  const setter = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => { scheduled.push(callback); return scheduled.length; }) as any);
  const clearer = spyOn(globalThis, 'clearTimeout').mockImplementation(noop);
  try {
    const show: any = UI.prototype.combatCue;
    show.call(ui, '같은 시전 문구', 'red', 900, owner); show.call(ui, '같은 시전 문구', 'red', 900, foreign);
    expect(ui.clearCombatCue(owner, el.textContent)).toBe(false); expect(classes.has('on')).toBe(true);
    expect(ui.clearCombatCue(foreign, '다른 문구')).toBe(false);
    expect(ui.clearCombatCue(foreign, el.textContent)).toBe(true); expect(classes.has('on')).toBe(false);
    show.call(ui, '같은 시전 문구', 'red', 720, owner); show.call(ui, '같은 시전 문구');
    expect(ui.clearCombatCue(owner, el.textContent)).toBe(false); expect(classes.has('on')).toBe(true);
    scheduled.at(-1)!(); expect(ui.combatCueOwner).toBeNull(); expect(ui.combatCueTimer).toBeNull();
  } finally { setter.mockRestore(); clearer.mockRestore(); }
});

test('Lv2 마법사·레인저는 기존 기본 스킬의 강타로 지원을 끊고 약한 기본탄은 그대로 유지한다', () => {
  for (const [hero, id] of [[HEROES.mage, 'fireball'], [HEROES.ranger, 'ranger_pierce']] as const) {
    const f = fixture(); start(f); const shots: any[] = [];
    const p: any = { def: hero, heroLevel: 2, jobResource: 0, pos: f.game.player.pos,
      forward: (v: Vector3) => v.set(-1, 0, 0) };
    const skillIndex = hero.skills.findIndex(skill => skill.id === id); expect(Player.prototype.unlocked.call(p, skillIndex)).toBe(true);
    (SKILLS as any)[id].cast({ spawnProjectile: (shot: any) => shots.push(shot), fx: { flash: noop } }, p, { dmg: 10 });
    expect(shots).toHaveLength(1); expect(shots[0].kb).toBeGreaterThanOrEqual(4);
    f.caster.hurt(shots[0].dmg, { kb: shots[0].kb, kind: shots[0].kind });
    expect(f.caster.supportCastKind).toBeNull(); step(f, .9); expect(f.ally.hp).toBe(500);
    const weak = fixture(); start(weak); weak.caster.hurt(10, { kb: hero.combo[0].kb, kind: 'magic' });
    expect(weak.caster.supportCastKind).toBe('heal');
  }
});

// 결과 UI가 열린 뒤에는 Enemy.update를 호출하지 않는 실제 종료 경계를 검증한다.
const resultEndings = ['defeat', 'victory'] as const;
function resultFixture() {
  const f = fixture(), presented: any[] = [];
  Object.assign(f.game, { result: null, heroId: 'knight', revived: 0, kills: 7, maxCombo: 4,
    dmgDealt: 44, roomsCleared: 2, treasureRooms: 1 });
  Object.assign(f.game.player, { hp: 700, maxHp: 1000, play: noop, magnetMul: 1 });
  f.game.input.enabled = true; f.game.fx.burst = noop; f.ui.showBoss = noop;
  f.ui.showResult = (battle: any, win: boolean) => presented.push({ battle, win, active: battle.active,
    result: battle.result, kind: f.caster.supportCastKind, telegraph: f.caster.telegraph,
    ring: f.caster.telegraphRing.visible, cue: f.ui.combatCueOwner, cueVisible: f.classes.has('on') });
  return { ...f, presented };
}
function presentResult(f: ReturnType<typeof resultFixture>, ending: typeof resultEndings[number]) {
  if (ending === 'victory') {
    const timer = f.game.timers.find((value: any) => value.t === 1.6);
    expect(timer).toBeDefined(); timer.fn();
  }
  expect(f.presented).toHaveLength(1);
}

for (const ending of resultEndings) for (const kind of ['heal', 'summon'])
test(`${ending}은 ${kind} 준비를 결과 UI 전에 동기 취소하고 효과 없이 기존 결과를 기록한다`, () => {
  const f = resultFixture(); start(f, kind); step(f, .4);
  expect(f.caster.supportCastKind).toBe(kind); expect(f.caster.telegraphRing.visible).toBe(true);
  expect(f.ui.combatCueOwner).toBe(f.caster); expect(f.classes.has('on')).toBe(true);
  const hp = f.ally.hp, cooldowns = [f.caster.healT, f.caster.summonT, f.caster.atkCd];
  const owner = f.caster.supportOwner, ring = f.caster.telegraphRing, time = f.game.elapsed;
  f.game[ending]();
  // 종료 뒤 수동 AI 갱신 없이 즉시 확인해야 원래 누락을 잡는다.
  expect(f.game.active).toBe(false); expect(f.game.input.enabled).toBe(false);
  expect(f.caster.supportCastKind).toBeNull(); expect(f.caster.special).toBeNull();
  expect(f.caster.telegraph).toBe(0); expect(ring.visible).toBe(false);
  expect(f.caster.supportCueLabel).toBeNull(); expect(f.ui.combatCueOwner).toBeNull();
  expect(f.classes.has('on')).toBe(false); expect(f.caster.state).toBe('chase');
  expect(f.caster.supportOwner).toBe(owner); expect(f.caster.telegraphRing).toBe(ring);
  expect(f.caster.disposed).toBe(false); expect(f.caster.supportStopped).not.toBe(true);
  expect([f.caster.healT, f.caster.summonT, f.caster.atkCd]).toEqual(cooldowns);
  expect(f.ally.hp).toBe(hp); expect(f.summons).toHaveLength(0); expect(f.spawns).toHaveLength(0);
  expect(f.effects.filter(value => value === '치유 ×1')).toHaveLength(0);
  expect(f.game.result).toMatchObject({ win: ending === 'victory', kills: 7, maxCombo: 4,
    dmg: 44, time, treasureRooms: 1, expedition: f.stage.expedition,
    conquest: null, routeObjective: null, mapTactics: null });
  if (ending === 'victory') expect(f.game.result).toMatchObject({ stars: 2, rooms: 2,
    totalRooms: f.world.rooms.length, fullClear: false });
  presentResult(f, ending);
  expect(f.presented[0]).toMatchObject({ win: ending === 'victory', active: false,
    kind: null, telegraph: 0, ring: false, cue: null, cueVisible: false });
  expect(f.presented[0].battle).toBe(f.game); expect(f.presented[0].result).toBe(f.game.result);
});

for (const ending of resultEndings)
test(`${ending}은 현재 방 밖의 실제 지원 액터도 닫고 일반 공격 고리와 액터를 보존한다`, () => {
  const f = resultFixture(); start(f);
  const remote = fixture(), room = f.world.rooms[2]; room.spawned = true; room.discovered = true;
  remote.caster.game = f.game; remote.caster.homeRoom = room;
  remote.caster.pos.set(room.x, 0, room.z); f.game.scene.add(remote.caster.root);
  remote.caster.healT = 99; remote.caster.summonT = 0; f.game.enemies.push(remote.caster);
  step({ ...f, caster: remote.caster }, .01);
  expect(remote.caster.supportCastKind).toBe('summon'); expect(remote.caster.homeRoom).not.toBe(f.game.curRoom);
  expect(remote.caster.supportOwnerValid()).toBe(true); expect(f.ui.combatCueOwner).toBe(f.caster);
  const ordinary = fixture(); ordinary.caster.game = f.game; ordinary.caster.runtimeSpeciesId = 'skel_priest';
  ordinary.caster.state = 'attack'; ordinary.caster.special = 'magic'; ordinary.caster.telegraph = .4;
  ordinary.caster.telegraphRing.visible = true; f.game.enemies.push(ordinary.caster);
  const actors = [...f.game.enemies], remoteOwner = remote.caster.supportOwner;
  f.game[ending]();
  for (const caster of [f.caster, remote.caster]) {
    expect(caster.supportCastKind).toBeNull(); expect(caster.telegraph).toBe(0);
    expect(caster.telegraphRing.visible).toBe(false); expect(caster.disposed).toBe(false);
    expect(caster.supportStopped).not.toBe(true);
  }
  expect(remote.caster.supportOwner).toBe(remoteOwner); expect(f.game.enemies).toEqual(actors);
  expect([ordinary.caster.state, ordinary.caster.special, ordinary.caster.telegraph,
    ordinary.caster.telegraphRing.visible]).toEqual(['attack', 'magic', .4, true]);
  expect(f.ui.combatCueOwner).toBeNull(); expect(f.summons).toHaveLength(0); expect(f.spawns).toHaveLength(0);
});

test('거절된 승리의 기존 비활성·사망·정지·보스·목표 가드는 진행 중 시전을 취소하지 않는다', () => {
  for (const blocked of ['inactive', 'dead', 'paused', 'boss', 'objective']) {
    const f = resultFixture(); start(f);
    if (blocked === 'inactive') f.game.active = false;
    if (blocked === 'dead') f.game.player.alive = false;
    if (['paused', 'boss', 'objective'].includes(blocked)) {
      f.game.bossDefeated = blocked !== 'boss'; f.game.paused = blocked === 'paused';
      f.game.routeObjectives = { canWin: () => blocked !== 'objective' };
    }
    const before = [f.game.active, f.game.input.enabled, f.caster.stateT, f.caster.telegraph,
      f.caster.healT, f.caster.summonT, f.caster.supportOwner];
    f.game.victory();
    expect([f.game.active, f.game.input.enabled, f.caster.stateT, f.caster.telegraph,
      f.caster.healT, f.caster.summonT, f.caster.supportOwner]).toEqual(before);
    expect(f.caster.supportCastKind).toBe('heal'); expect(f.caster.telegraphRing.visible).toBe(true);
    expect(f.ui.combatCueOwner).toBe(f.caster); expect(f.classes.has('on')).toBe(true);
    expect(f.game.result).toBeNull(); expect(f.game.timers).toHaveLength(0);
    expect(f.presented).toHaveLength(0); expect(f.ally.hp).toBe(500);
  }
});

test('결과 전환의 지원 정리는 다른 소유자가 교체한 문구를 지우지 않는다', () => {
  for (const ending of resultEndings) {
    const f = resultFixture(); start(f); const foreign = {};
    f.ui.combatCue('외부 전투 알림', 'red', 900, foreign); f.game[ending]();
    expect(f.caster.supportCastKind).toBeNull(); expect(f.caster.supportCueLabel).toBeNull();
    expect(f.caster.telegraphRing.visible).toBe(false); expect(f.ui.combatCueOwner).toBe(foreign);
    expect(f.el.textContent).toBe('외부 전투 알림'); expect(f.classes.has('on')).toBe(true);
  }
});

test('이미 완료해 예약한 소환은 종료 시 예약을 바꾸지 않고 기존 비활성 가드로 병력을 막는다', () => {
  for (const ending of resultEndings) {
    const f = resultFixture(); start(f, 'summon'); step(f, .9);
    expect(f.summons).toEqual([2]); expect(f.caster.supportCastKind).toBeNull();
    const committed = [...f.game.timers]; expect(committed.map(timer => timer.t)).toEqual([0, .12]);
    f.game[ending]();
    for (const timer of committed) { expect(f.game.timers).toContain(timer); timer.fn(); }
    f.caster.finishSupportCast();
    expect(f.spawns).toHaveLength(0); expect(f.summons).toEqual([2]);
  }
});

test('종료를 다시 요청해도 원래 결과와 타이머·정산 표시를 재작성하지 않는다', () => {
  for (const ending of resultEndings) {
    const f = resultFixture(); start(f); f.game[ending](); presentResult(f, ending);
    const result = f.game.result, timers = [...f.game.timers], effects = [...f.effects];
    f.game.defeat(); f.game.victory();
    expect(f.game.result).toBe(result); expect(f.game.timers).toEqual(timers);
    expect(f.effects).toEqual(effects); expect(f.presented).toHaveLength(1);
    expect(f.caster.supportStopped).not.toBe(true); expect(f.caster.disposed).toBe(false);
  }
});

test('결과 종료 전 기존 부활은 액터를 폐기하거나 지원 시전을 영구 정지하지 않는다', () => {
  const f = resultFixture(); start(f); const owner = f.caster.supportOwner;
  f.game.player.alive = false; f.game.player.revive = () => { f.game.player.alive = true; };
  f.game.fx.holyBurst = noop; f.game.fx.shockTex = noop; f.game.hitRadius = noop;
  f.game.revivePlayer();
  expect(f.game.active).toBe(true); expect(f.game.player.alive).toBe(true); expect(f.game.revived).toBe(1);
  expect(f.game.input.enabled).toBe(true); expect(f.game.result).toBeNull();
  expect(f.caster.supportOwner).toBe(owner); expect(f.caster.supportCastKind).toBe('heal');
  expect(f.caster.disposed).toBe(false); expect(f.caster.supportStopped).not.toBe(true);
  step(f, .9); expect(f.ally.hp).toBe(650); expect(f.caster.supportCastKind).toBeNull();
});

test('적 목록이 없는 기존 부분 결과 객체도 accepted defeat·victory의 결과 처리 순서를 유지한다', () => {
  for (const ending of resultEndings) {
    const f = resultFixture(); delete f.game.enemies;
    f.game[ending]();
    expect(f.game.active).toBe(false); expect(f.game.input.enabled).toBe(false);
    expect(f.game.result).toMatchObject({ win: ending === 'victory', kills: 7, maxCombo: 4, dmg: 44 });
    presentResult(f, ending); expect(f.presented[0].result).toBe(f.game.result);
  }
});
