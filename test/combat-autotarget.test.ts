import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { HEROES } from '../src/data/heroes.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { normalizeSkillLoadout } from '../src/game/progression.js';
import { Floor } from '../src/game/world.js';
import { createCombatFlowFixture, loadCombatFlowRuntime, spawnCombatFlowEnemy, stepCombatFlow } from '../tools/combat-flow-sim.mjs';

const runtime = await loadCombatFlowRuntime();
const DT = 1 / 120;

function advance(f: any, ready: () => boolean, limit = 1200) {
  for (let i = 0; i < limit && !ready(); i++) stepCombatFlow(f, DT);
  return ready();
}
function setAutoTarget(f: any, on: boolean) { f.game.app.eco = { s: { settings: { autoTarget: on } } }; }
// 움직이지 않는 표적. 피해만 실제 판정으로 받는다.
function dummy(f: any, dx: number, dz: number) {
  const p = f.player;
  return spawnCombatFlowEnemy(f, p.pos.x + dx, p.pos.z + dz, { hp: 1e6, maxHp: 1e6, stun: 60 });
}

test('자동 타겟팅은 뒤쪽 적에게 몸을 돌려 첫 타를 맞히고, 끄면 바라보는 방향으로 휘둘러 빗나간다', () => {
  for (const on of [true, false]) {
    const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player; setAutoTarget(f, on);
    p.yaw = 0; const e: any = dummy(f, 0, -3);
    f.game.input.press('attack');
    expect(advance(f, () => p.hitDone)).toBe(true);
    if (on) { expect(e.hp).toBeLessThan(1e6); expect(p.lockTarget).toBe(e); expect(Math.abs(Math.cos(p.yaw) + 1)).toBeLessThan(.05); }
    else { expect(e.hp).toBe(1e6); expect(p.yaw).toBe(0); }
  }
});

test('근접 자동 타겟팅은 사거리 밖 적에게 짧게 붙어 타격 범위 안에서 맞힌다', () => {
  for (const hero of ['knight', 'barbarian', 'rogue']) {
    const f = createCombatFlowFixture(runtime, hero), p: any = f.player; setAutoTarget(f, true);
    p.yaw = 0; const e: any = dummy(f, 1.5, 5.5);
    const start = p.pos.clone();
    f.game.input.press('attack');
    expect(advance(f, () => p.hitDone)).toBe(true);
    expect(e.hp).toBeLessThan(1e6);
    expect(p.pos.distanceTo(start)).toBeGreaterThan(1.5);
  }
});

test('수동 평타는 적 몸 절반이 부채꼴에 걸리면 명중하고, 몸이 거의 벗어난 적은 맞히지 않는다', () => {
  for (const [share, expectHit] of [[.8, true], [2.2, false]] as const) {
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player; setAutoTarget(f, false);
  const c = p.def.combo[0], d = c.range - .3;
  p.yaw = 0;
  const probe: any = dummy(f, 0, 0); const r = probe.radius; probe.alive = false; f.game.enemies.length = 0;
  const angle = c.arc * Math.PI / 360 + Math.asin(r * .5 / d) * share;
  const e: any = dummy(f, Math.sin(angle) * d, Math.cos(angle) * d);
  f.game.input.press('attack');
  expect(advance(f, () => p.hitDone)).toBe(true);
  expect(e.hp < 1e6).toBe(expectHit);
  }
});

test('회피·스킬·피격 경직·기절 중 누른 공격은 그 행동이 끝나면 실제 공격으로 이어진다', () => {
  const cases: Array<[string, (p: any) => void]> = [
    ['dodge', p => p.dodge(new Vector3(1, 0, 0))],
    ['skill', p => { expect(p.tryCastSkill(0)).toBe(true); }],
    ['hurt', p => { expect(p.hurt(20, { kb: 6 })).toBe(true); }],
    ['stun', p => { p.stun = .5; }],
  ];
  for (const [name, begin] of cases) {
    const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player; setAutoTarget(f, false);
    begin(p);
    stepCombatFlow(f, DT);
    f.game.input.press('attack'); stepCombatFlow(f, DT);
    const ok = advance(f, () => p.state === 'attack', 600);
    expect({ name, ok }).toEqual({ name, ok: true });
  }
});

test('콤보 예약 창에서 한 번 누른 공격은 정확히 한 타만 더 이어진다', () => {
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player; setAutoTarget(f, false);
  const starts: number[] = [], start = p.startCombo;
  p.startCombo = function(idx: number, yaw: any) { starts.push(idx); return start.call(this, idx, yaw); };
  f.game.input.press('attack'); stepCombatFlow(f, DT);
  expect(advance(f, () => p.canQueueCombo())).toBe(true);
  f.game.input.press('attack');
  advance(f, () => p.state === 'idle' && starts.length >= 2, 1200);
  for (let i = 0; i < 240; i++) stepCombatFlow(f, DT);
  expect(starts).toEqual([0, 1]);
});

test('미습득 각성 스킬은 레벨이 충분해도 장착·시전되지 않고, 전부 1로 채운 경로는 그대로 쓴다', () => {
  const knight: any = HEROES.knight, levels = knight.skills.map(() => 1);
  levels[4] = 0;
  expect(normalizeSkillLoadout(knight, [4, 5], levels, 99)).toEqual([6, 5]);
  expect(normalizeSkillLoadout(knight, [4, 5], knight.skills.map((s: any) => s.unlock ? 0 : 1), 99)).toEqual([-1, -1]);
  expect(normalizeSkillLoadout(knight, [4, 5], knight.skills.map(() => 1), 99)).toEqual([4, 5]);
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player;
  p.heroLevel = 99; p.skillLevels = levels;
  expect(p.unlocked(4)).toBe(false); expect(p.tryCastSkill(4)).toBe(false); expect(p.state).toBe('idle');
  p.skillLevels = knight.skills.map(() => 1);
  expect(p.unlocked(4)).toBe(true); expect(p.tryCastSkill(4)).toBe(true);
});

test('스킬 초기화가 비운 칸(-1)은 저장·전투에서 빈 칸으로 남고 Q/E 입력이 아무것도 시전하지 않는다', () => {
  const knight: any = HEROES.knight;
  expect(normalizeSkillLoadout(knight, [-1, -1])).toEqual([-1, -1]);
  expect(normalizeSkillLoadout(knight, [-1, 5])).toEqual([-1, 5]);
  expect(normalizeSkillLoadout(knight, [99, 99])).toEqual([4, 5]);
  const eco = new Economy(), fresh = eco.fresh(), raw: any = structuredClone(fresh);
  raw.heroes.knight.skillLoadout = [-1, -1];
  expect(normalizeSave(raw, fresh).heroes.knight.skillLoadout).toEqual([-1, -1]);
  const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player;
  p.heroLevel = 99; p.skillLoadout = [-1, -1];
  expect(p.combatSkillIndex(4)).toBe(-1); expect(p.combatSkill(5).skill).toBeUndefined();
  f.game.input.press('skill4'); f.game.input.press('skill5'); stepCombatFlow(f, DT);
  expect(p.state).toBe('idle'); expect(p.skillCtx).toBeFalsy();
});

test('등급 스킬 배율은 스킬 피해에, 재사용 대기 배율은 쿨타임에 곱해진다', () => {
  const cast = (skillMul: number, cdMul: number) => {
    const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player;
    Object.assign(p.stats, { skillMul, cdMul, crit: 0 });
    expect(p.tryCastSkill(0)).toBe(true);
    return { dmg: p.skillCtx.dmg, cd: p.cds[0] };
  };
  const base = cast(1, 1), graded = cast(1.5, .8);
  expect(graded.dmg / base.dmg).toBeCloseTo(1.5, 6);
  expect(graded.cd / base.cd).toBeCloseTo(.8, 6);
});

test('자동 타겟팅 설정은 boolean만 저장하고 없으면 켜짐이다', () => {
  const eco = new Economy(), fresh = eco.fresh();
  for (const [value, expected] of [[false, false], [true, true], ['no', true], [undefined, true]] as const) {
    const raw: any = structuredClone(fresh); raw.settings.autoTarget = value;
    expect(normalizeSave(raw, fresh).settings.autoTarget).toBe(expected);
  }
});

// 실제 방 배치와 이동 충돌로 AUTO 탐색이 봉인 밖 모든 방 중심까지 도착하는지 확인한다(벽·모서리 끼임 회귀).
test('AUTO 탐색은 실제 던전·스테이지 배치의 모든 열린 방에 벽에 끼지 않고 도착한다', () => {
  const worlds: Array<[string, any]> = [];
  for (const id of ['glass_garden', 'ember_vault', 'star_archive', 'bellfall_crypt', 'cinder_tide_lock', 'nightglass_observatory', 'comet_bastion', 'sable_mirage_basin']) {
    const stage = runtime.buildExpeditionStage('dungeon', id, null); worlds.push([id, runtime.buildExpeditionWorld(stage)]);
  }
  for (const [i, theme] of ['garden', 'forge', 'frost', 'tide', 'crown'].entries()) worlds.push(['floor-' + theme, new Floor(i * 10 + 1, theme)]);
  const failures: string[] = [];
  for (const [name, world] of worlds) {
    const f = createCombatFlowFixture(runtime, 'knight'), p: any = f.player, g: any = f.game;
    g.world = world; p.auto = true; p.pos.set(world.startRoom.x, 0, world.startRoom.z);
    for (const room of world.rooms) {
      if (room === world.startRoom || (world.sealed && room === world.bossRoom)) continue;
      g.autoTarget = room; room.cleared = false;
      const inside = () => Math.hypot(p.pos.x - room.x, p.pos.z - room.z) < 2;
      if (!advance(f, inside, 120 * 60)) failures.push(name + ':' + room.id + '@' + p.pos.x.toFixed(1) + ',' + p.pos.z.toFixed(1));
    }
  }
  expect(failures).toEqual([]);
}, 60000);

