import { describe, expect, test } from 'bun:test';
import { CompanionDirector } from '../src/companion/director';
import { Battle } from '../src/game/battle.js';

test('로비 첫 대화와 설정 변경에도 동행이 저전력 설정을 따른다', () => {
  const settings: { quality: 'low' | 'high' } = { quality: 'low' };
  const director = new CompanionDirector({ mode: 'lobby', models: {}, eco: { s: { settings } } });
  expect(director.getSnapshot().quality).toBe('low');
  director.setOpen(true);
  expect(director.getSnapshot().quality).toBe('low');
  settings.quality = 'high'; director.syncQuality();
  expect(director.getSnapshot().quality).toBe('high');
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly length = 0;

  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(): string | null { return null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('CompanionDirector', () => {
  test('대화 중 게임 입력을 비우고 닫을 때 원래 상태로 복구한다', () => {
    let clearCount = 0;
    const input = { enabled: true, clear: () => { clearCount += 1; } };
    const battle = {
      active: true,
      paused: false,
      pauseReasons: new Set<string>(),
      setPaused: Battle.prototype.setPaused,
      input,
      stage: { idx: 3 },
      player: {
        alive: true,
        hp: 100,
        maxHp: 100,
        def: { name: '검성 아르카' },
        stats: { power: 1234 },
        pos: { x: 0, z: 0 },
      },
      enemies: [],
      boss: null,
      combo: 0,
      roomsCleared: 0,
      world: { rooms: [] },
    };
    const app = { mode: 'battle' as const, models: {}, eco: { s: { settings: { quality: 'high' as const } } } };
    const director = new CompanionDirector(app, new MemoryStorage());
    director.startBattle(battle);

    director.setOpen(true);
    expect(battle.paused).toBe(true);
    expect(input.enabled).toBe(false);
    expect(clearCount).toBe(1);

    director.setOpen(true);
    expect(clearCount).toBe(1);

    director.reply('보스를 파쇄해');
    expect(director.getSnapshot().tactic).toBe('break');

    director.setOpen(false);
    expect(battle.paused).toBe(false);
    expect(input.enabled).toBe(true);
    expect(clearCount).toBe(2);
  });

  test('로비 대화를 연 채 출격해도 입력 잠금과 복구 순서가 유지된다', () => {
    let clearCount = 0;
    const input = { enabled: true, clear: () => { clearCount += 1; } };
    const battle = {
      active: true,
      paused: false,
      pauseReasons: new Set<string>(),
      setPaused: Battle.prototype.setPaused,
      input,
      stage: { idx: 1 },
      player: {
        alive: true,
        hp: 100,
        maxHp: 100,
        def: { name: '검성 아르카' },
        stats: { power: 900 },
        pos: { x: 0, z: 0 },
      },
      enemies: [],
      boss: null,
      combo: 0,
      roomsCleared: 0,
      world: { rooms: [] },
    };
    const app = { mode: 'lobby' as const, models: {}, eco: { s: { settings: { quality: 'high' as const } } } };
    const director = new CompanionDirector(app, new MemoryStorage());

    director.setOpen(true);
    director.startBattle(battle);

    expect(battle.paused).toBe(true);
    expect(input.enabled).toBe(false);
    expect(clearCount).toBe(1);

    director.setOpen(false);
    expect(battle.paused).toBe(false);
    expect(input.enabled).toBe(true);
    expect(clearCount).toBe(2);
  });
});

for (const manualFirst of [true, false]) {
  test(`정지/대화 중 하나만 닫으면 전투를 재개하지 않는다 (수동 먼저=${manualFirst})`, () => {
    const input = { enabled: true, clear() {} };
    const battle = {
      active: true, paused: false, pauseReasons: new Set<string>(), input,
      setPaused: Battle.prototype.setPaused,
      player: { alive: true, hp: 100, maxHp: 100, pos: { x: 0, z: 0 } },
      enemies: [], combo: 0, roomsCleared: 0,
    };
    const director = new CompanionDirector({ mode: 'battle', models: {} }, new MemoryStorage());
    director.startBattle(battle);
    if (manualFirst) battle.setPaused('manual', true);
    director.setOpen(true);
    if (!manualFirst) battle.setPaused('manual', true);
    director.setOpen(false);
    expect(battle.paused).toBe(true);
    expect(input.enabled).toBe(false);
    battle.setPaused('manual', false);
    expect(battle.paused).toBe(false);
    expect(input.enabled).toBe(true);
    director.setOpen(true);
    battle.active = false;
    director.setOpen(false);
    expect(input.enabled).toBe(false);
  });
}
