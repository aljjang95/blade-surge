import { describe, expect, test } from 'bun:test';
import { Floor, REGION_LAYOUTS, ROOM_TYPE } from '../src/game/world.js';
import { ROUTE_MODE, bossApproachOpen, bossRoutePath, directRouteNext, loadRoutePrefs, routePolyline, routeSummary, saveRoutePrefs } from '../src/game/dungeon-route.js';

const floors = () => [...[1, 2, 4, 8, 12, 16, 24].map(n => new Floor(n, 'crypt')), ...Object.keys(REGION_LAYOUTS).map(t => new Floor(3, t))];

describe('던전 동선 — 보스 직행 / 전부 사냥', () => {
  test('시작 방 기준 최단 경로는 BFS 거리(pathLen)와 같고 보스 방에서 끝난다', () => {
    for (const f of floors()) {
      const path = bossRoutePath(f, f.startRoom.id);
      expect(path[0]).toBe(f.startRoom.id);
      expect(path.at(-1)).toBe(f.bossRoom.id);
      expect(path.length - 1).toBe(f.bossRoom.pathLen);
      for (let i = 1; i < path.length; i++) expect(f.rooms[path[i - 1]].links).toContain(path[i]);
    }
  });

  test('경로 위 방만 정화하면 보스 문이 열리고, 남은 방은 선택으로 남는다', () => {
    for (const f of floors()) {
      expect(f.sealed).toBe(true);
      expect(bossApproachOpen(f)).toBe(false);
      let guard = 0, next;
      while ((next = directRouteNext(f, f.startRoom.id)) && next !== f.bossRoom && guard++ < 40) next.cleared = true;
      expect(bossApproachOpen(f)).toBe(true);
      const s = routeSummary(f);
      expect(s.pathLeft).toBe(0);
      // 직행은 전체 방보다 훨씬 적게 정화한다(선형 지도 frost 는 예외적으로 길다).
      expect(s.optionalCleared).toBe(f.bossRoom.pathLen - 1);
      if (f.theme !== 'frost') expect(s.optionalLeft).toBeGreaterThan(0);
      f.unseal();
      expect(directRouteNext(f, f.startRoom.id)).toBe(f.bossRoom);
    }
  });

  test('정화하지 않은 방을 건너뛰어서는 열리지 않는다(시작 방에서 이어진 정화 방만 인정)', () => {
    const f = new Floor(4, 'crypt');
    const path = bossRoutePath(f, f.startRoom.id);
    // 보스 바로 앞 방만 정화: 시작 방에서 이어지지 않으므로 닫힌 채
    const beforeBoss = f.rooms[path.at(-2)];
    if (beforeBoss.type !== ROOM_TYPE.START) { beforeBoss.cleared = true; expect(bossApproachOpen(f)).toBe(false); }
  });

  test('경로는 이미 정화한 방을 우선한다(남은 정화 수 최소)', () => {
    const f = new Floor(8, 'crypt');
    for (const room of f.rooms) if (room.type !== ROOM_TYPE.BOSS) room.cleared = true;
    const s = routeSummary(f, f.startRoom.id);
    expect(s.pathLeft).toBe(0);
    expect(s.optionalLeft).toBe(0);
  });

  test('경로 선은 생성기의 L자 복도 꺾임점을 지난다', () => {
    const f = new Floor(2, 'crypt');
    const path = bossRoutePath(f, f.startRoom.id), line = routePolyline(f, path);
    expect(line.length).toBe(1 + (path.length - 1) * 2);
    expect(line[0]).toEqual([f.startRoom.x, f.startRoom.z]);
    expect(line.at(-1)).toEqual([f.bossRoom.x, f.bossRoom.z]);
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1], [bx, bz] = line[i];
      expect(ax === bx || az === bz).toBe(true);   // 축 정렬 선분만
    }
  });

  test('동선 선호는 기기 저장소에 남고, 손상·없음이면 전부 사냥 + 경로 표시', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } } as unknown as Storage;
    expect(loadRoutePrefs(storage)).toEqual({ mode: ROUTE_MODE.FULL, guide: true });
    saveRoutePrefs({ mode: ROUTE_MODE.DIRECT, guide: false }, storage);
    expect(loadRoutePrefs(storage)).toEqual({ mode: ROUTE_MODE.DIRECT, guide: false });
    mem.set('bs.dungeonRoute.v1', '{bad');
    expect(loadRoutePrefs(storage)).toEqual({ mode: ROUTE_MODE.FULL, guide: true });
    expect(loadRoutePrefs({ getItem: () => { throw new Error('blocked'); } } as unknown as Storage)).toEqual({ mode: ROUTE_MODE.FULL, guide: true });
    expect(loadRoutePrefs(undefined)).toEqual({ mode: ROUTE_MODE.FULL, guide: true });
    // 저장소 접근 자체가 막힌 브라우저(localStorage getter 가 SecurityError)
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      expect(loadRoutePrefs()).toEqual({ mode: ROUTE_MODE.FULL, guide: true });
      expect(() => saveRoutePrefs({ mode: ROUTE_MODE.DIRECT })).not.toThrow();
    } finally { if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete (globalThis as any).localStorage; }
  });
});
