import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { dungeonJourney, dungeonContinuation } from '../src/ui/dungeon-journey.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
const make = () => { const economy = new Economy(); return { economy, service: new ExpeditionEconomy(economy) }; };
const result = { kind: 'dungeon', id: 'glass_garden', depth: 'standard', win: true, saveError: null };

test('Lv.1 지도는 실제 첫 던전을 추천하고 탐색만으로 자원·진행을 바꾸지 않는다', () => {
  const { economy, service } = make(), before = JSON.stringify(economy.s);
  const journey = dungeonJourney(service);
  expect(journey.nodes).toHaveLength(12);
  expect(journey.current?.dungeon.id).toBe('glass_garden');
  expect(journey.nodes.find(node => node.dungeon.id === 'ember_vault')?.unlocked).toBe(false);
  expect(journey.cleared).toBe(0);
  expect(JSON.stringify(economy.s)).toBe(before);
  expect(dungeonContinuation(service, result)).toBeNull();
});

test('실제 정산·저장·재로딩 뒤 다음 해금 던전은 이어지고 중복 정산은 거절된다', () => {
  const { economy, service } = make();
  const ticket = service.begin('dungeon', 'glass_garden').ticket;
  expect(service.settle(ticket, { win: true }).ok).toBe(true);
  const saved = JSON.stringify(economy.s);
  expect(dungeonContinuation(service, result)?.id).toBe('ember_vault');
  expect(dungeonContinuation(service, result)?.claimQuestIds).toEqual(['garden_scout']);
  expect(JSON.stringify(economy.s)).toBe(saved);
  const restored = make().service;
  expect(dungeonJourney(restored).cleared).toBe(1);
  expect(dungeonContinuation(restored, result)?.id).toBe('ember_vault');
  expect(restored.dungeonAccess('ember_vault').ok).toBe(false);
  expect(restored.claimQuest('garden_scout').ok).toBe(true);
  expect(restored.claimQuest('garden_scout').ok).toBe(false);
  expect(restored.dungeonAccess('ember_vault').ok).toBe(true);
  expect(dungeonContinuation(restored, result)?.claimQuestIds).toEqual([]);
  expect(restored.settle(ticket, { win: true }).ok).toBe(false);
  expect(restored.begin('dungeon', 'star_archive').ok).toBe(false);
});

test('패배·정산 실패·심층·균열·전술 공략에서 기본 여정의 다음 출격을 제안하지 않는다', () => {
  const { service } = make();
  service.settle(service.begin('dungeon', 'glass_garden').ticket, { win: true });
  for (const override of [{ win: false }, { saveError: '저장 실패' }, { depth: 'deep' }, { riftId: 'rift' }, { conquestId: 'test' }, { kind: 'arena' }]) {
    expect(dungeonContinuation(service, { ...result, ...override })).toBeNull();
  }
});
