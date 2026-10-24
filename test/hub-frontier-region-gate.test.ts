import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { JourneyService } from '../src/game/journey-service.js';
import { frontierForSave, visibleDungeonIds } from '../src/game/region-dungeon-gate.js';
import { frontierSnapshot, weeklyFrontier } from '../src/data/seasonal-content.js';
import { DungeonRoutes } from '../src/expansion/hub.jsx';

// Codex 리뷰 P2: 허브의 기본 원정 배너가 잠긴 지정 던전을 안내하면서 실제 효과는 다른 던전에 붙던 문제.
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  setSystemTime();
  if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('2026-04-10 신규 저장: 허브 배너 대상 = 출격 표식 대상 = 실제 효과가 붙는 던전, 카드도 목록에 있다', () => {
  const date = new Date('2026-04-10T12:00:00Z'); setSystemTime(date);
  const eco = new Economy(), expedition = new ExpeditionEconomy(eco); expedition.s.level = 10;
  const app: any = { eco, expedition, stageStarting: false, battle: { active: false }, expeditionUI: { result: null } };
  app.journey = new JourneyService(app);
  const authored = weeklyFrontier(date).routeId, open = visibleDungeonIds(eco.s);
  expect(open.has(authored)).toBe(false); // 지정 던전은 잠겨 있다
  const target = frontierForSave(eco.s, date).routeId;
  expect(open.has(target)).toBe(true);

  const html = renderToStaticMarkup(React.createElement(DungeonRoutes, { app, service: expedition, launch: () => {}, controller: { dungeonDepth: 'standard' } } as any));
  const banner = html.match(/data-frontier-route="([^"]+)"/)?.[1];
  expect(banner).toBe(target);
  expect(html).not.toContain(`data-dungeon="${authored}"`);

  // 같은 던전으로 출격하면 프론티어 효과가 붙는다.
  const started = expedition.begin('dungeon', banner!, { depth: 'standard', expectedFrontier: frontierSnapshot(frontierForSave(eco.s, date)) });
  expect(started.ok).toBe(true);
  expect((started as any).ticket.frontier.routeId).toBe(banner);
});
