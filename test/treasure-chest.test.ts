import { expect, test } from 'bun:test';
import { ChestState, CHEST_HOLD_SEC, CHEST_AUTO_SEC, TreasureChests } from '../src/game/treasure-chest.js';
import { targetTagState } from '../src/ui/target-tag.js';

const tick = (s: ChestState, sec: number, opts: any) => { let opened = 0; for (let t = 0; t < sec - 1e-9; t += 1 / 60) if (s.step(1 / 60, opts)) opened++; return opened; };

test('상자는 범위 안에서 누르고 있을 때만 1.2초에 걸쳐 열리고, 떼면 진행이 줄어든다', () => {
  const s = new ChestState([{ kind: 'stone', payload: 8 }]);
  expect(tick(s, 1, { holding: true, inRange: false })).toBe(0);
  expect(s.progress).toBe(0);
  expect(tick(s, 0.6, { holding: true, inRange: true })).toBe(0);
  expect(s.progress).toBeCloseTo(0.6 / CHEST_HOLD_SEC, 1);
  const mid = s.progress;
  tick(s, 0.2, { holding: false, inRange: true });
  expect(s.progress).toBeLessThan(mid);
  expect(s.phase).toBe('locked');
  expect(tick(s, 2, { holding: true, inRange: true })).toBe(1);
  expect(s.phase).toBe('open');
  expect(tick(s, 1, { holding: true, inRange: true })).toBe(0);
});

test('AUTO는 거리와 관계없이 짧게 자동으로 열고, 보상은 한 번만 지급한다', () => {
  const rewards = [{ kind: 'item', payload: { id: 'x' } }];
  const s = new ChestState(rewards);
  expect(tick(s, CHEST_AUTO_SEC + 0.05, { auto: true })).toBe(1);
  expect(s.claimRewards()).toBe(rewards);
  expect(s.claimRewards()).toBeNull();
  expect(s.forceOpen()).toBe(false);
});

test('정산 직전 강제 개봉은 열지 않은 상자만 한 번 연다', () => {
  const s = new ChestState([]);
  expect(s.claimRewards()).toBeNull();
  expect(s.forceOpen()).toBe(true);
  expect(s.claimRewards()).toEqual([]);
  expect(s.forceOpen()).toBe(false);
});

test('묶음 관리자는 미리 굴린 보상을 상자에 담고, 정산 강제 개봉과 개별 개봉이 겹쳐도 중복 지급하지 않는다', () => {
  const spawned: any[] = [];
  const battle: any = { player: { alive: true, auto: false, pos: { x: 0, z: 0 } }, drops: { spawn: (_at: any, kind: string, payload: any) => spawned.push({ kind, payload }) }, renderer: null, scene: null, paused: false, app: {} };
  const chests = new TreasureChests(battle);
  chests.add({ x: 0, z: 0 }, [{ kind: 'item', payload: 'a' }, { kind: 'stone', payload: 8 }], { x: 0.5, z: 0, ry: 0, s: 1.2 });
  chests.add({ x: 30, z: 0 }, [{ kind: 'item', payload: 'b' }]);
  chests.keyHeld = true;
  for (let i = 0; i < 90; i++) chests.update(1 / 60);
  expect(spawned.map(s => s.payload)).toEqual(['a', 8]);
  chests.openAll();
  expect(spawned.map(s => s.payload)).toEqual(['a', 8, 'b']);
  chests.openAll();
  expect(spawned).toHaveLength(3);
  chests.dispose();
});

test('머리 위 표식은 전투 중 14m 안의 살아 있는 대상만 보이고, 보스·균형 정보를 구분한다', () => {
  const enemy: any = { alive: true, spawning: false, hp: 50, maxHp: 200, def: { name: '오크' }, posture: 40, postureMax: 80, breakT: 0, isBoss: false };
  const battle: any = { active: true, run: { enabled: true }, lastTarget: enemy, player: { distTo: () => 5, lockTarget: null } };
  const s = targetTagState(battle)!;
  expect(s.hpRatio).toBeCloseTo(0.25);
  expect(s.posture!.ratio).toBeCloseTo(0.5);
  expect(targetTagState(battle, { mode: 'lobby' })).toBeNull();
  battle.player.distTo = () => 20; expect(targetTagState(battle)).toBeNull();
  battle.player.distTo = () => 5; enemy.alive = false; expect(targetTagState(battle)).toBeNull();
  enemy.alive = true; battle.run.enabled = false; expect(targetTagState(battle)!.posture).toBeNull();
});

