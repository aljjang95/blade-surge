// 던전 동선 — 보스 직행과 전부 사냥 (대표님 2026-10-30 "보스 던전이 어디 있는지 미리 보여 주고, 직구로 가고 싶은 사람은
// 직구로, 사냥을 더 하고 싶으면 풀로 도는 시스템. 12개 방을 무조건 다 돌아야 하는 건 불편").
//
// 규칙(로그라이트·던전 RPG의 '필수 경로 최소화' 패턴 — Hades의 방 연결, 디아블로 던전의 보스 문):
// - 보스 방은 입장할 때부터 지도에 보인다(형태·아이콘·최단 경로). 방 자체의 discovered 는 바꾸지 않는다.
// - 봉인은 '시작 방에서 정화한 방만 밟고 보스 방 문 앞까지 닿을 수 있을 때' 풀린다. 최소는 최단 경로 위 방들이다.
// - 나머지 방은 선택이다. 전부 정화하면 기존 전체 정화 보너스(경험치 +50%·골드 +40%·조각·정예 장비, 서버도 같은 계산)와
//   별 3(탐색 80% 초과 → 소탕 자격)이 따라온다. 직행은 시간이 짧은 대신 판당 보상이 적다.
// 순수 함수만 둔다(난수·할당 많은 상태 없음). 같은 층에서 클라이언트·테스트가 같은 결과를 낸다.
import { ROOM_TYPE } from './world.js';

export const ROUTE_MODE = Object.freeze({ FULL: 'full', DIRECT: 'direct' });
const PREF_KEY = 'bs.dungeonRoute.v1';

/** 기기별 동선 선호(지도에서 고른 값). 저장이 막힌 브라우저에서도 기본값으로 동작한다. */
export function loadRoutePrefs(storage = globalThis.localStorage) {
  const prefs = { mode: ROUTE_MODE.FULL, guide: true };
  try {
    const raw = JSON.parse(storage?.getItem?.(PREF_KEY) || 'null');
    if (raw?.mode === ROUTE_MODE.DIRECT) prefs.mode = ROUTE_MODE.DIRECT;
    if (raw?.guide === false) prefs.guide = false;
  } catch { /* 저장소 없음·손상 — 기본값 */ }
  return prefs;
}
export function saveRoutePrefs(prefs, storage = globalThis.localStorage) {
  try { storage?.setItem?.(PREF_KEY, JSON.stringify({ mode: prefs.mode === ROUTE_MODE.DIRECT ? ROUTE_MODE.DIRECT : ROUTE_MODE.FULL, guide: prefs.guide !== false })); }
  catch { /* 저장 실패는 이번 판 값만 유지 */ }
}

const optionalRoom = (room) => room.type !== ROOM_TYPE.START && room.type !== ROOM_TYPE.BOSS;

/** 정화한 방만 밟아 시작 방에서 보스 방 이웃까지 닿는가. */
export function bossApproachOpen(world) {
  const boss = world?.bossRoom, start = world?.startRoom || world?.rooms?.[0];
  if (!boss || !start) return false;
  const seen = new Set([start.id]), queue = [start];
  while (queue.length) {
    const room = queue.shift();
    for (const id of room.links || []) {
      if (id === boss.id) return true;
      const next = world.rooms[id];
      if (!next || seen.has(id) || !next.cleared) continue;
      seen.add(id); queue.push(next);
    }
  }
  return false;
}

/**
 * from 방에서 보스 방까지 '새로 정화해야 하는 방 수'가 가장 적은 경로(0-1 BFS: 정화한 방 0, 남은 방 1, 같으면 방 수가 적은 쪽).
 * 반환: 방 id 배열(from·보스 포함). 길이 없으면 [].
 */
export function bossRoutePath(world, fromId) {
  const boss = world?.bossRoom, rooms = world?.rooms;
  if (!boss || !rooms?.[fromId]) return [];
  const cost = new Map([[fromId, 0]]), hops = new Map([[fromId, 0]]), prev = new Map(), deque = [fromId];
  while (deque.length) {
    const id = deque.shift(), room = rooms[id];
    if (id === boss.id) continue;
    for (const nid of room.links || []) {
      const next = rooms[nid]; if (!next) continue;
      const step = nid === boss.id || next.cleared ? 0 : 1, c = cost.get(id) + step, h = hops.get(id) + 1;
      const known = cost.get(nid);
      if (known !== undefined && (known < c || (known === c && hops.get(nid) <= h))) continue;
      cost.set(nid, c); hops.set(nid, h); prev.set(nid, id);
      if (step === 0) deque.unshift(nid); else deque.push(nid);
    }
  }
  if (!cost.has(boss.id)) return [];
  const path = [boss.id];
  for (let id = boss.id; id !== fromId;) { id = prev.get(id); path.push(id); }
  return path.reverse();
}

/** 지도·목표 카드용 요약. pathLeft = 보스 문까지 새로 정화해야 하는 방 수(봉인이 풀렸으면 0). */
export function routeSummary(world, fromId = world?.startRoom?.id ?? 0) {
  const optional = (world?.rooms || []).filter(optionalRoom);
  const cleared = optional.filter((room) => room.cleared).length;
  const path = bossRoutePath(world, fromId);
  const pathLeft = world?.sealed ? path.filter((id) => id !== world.bossRoom.id && !world.rooms[id].cleared).length : 0;
  return { optionalTotal: optional.length, optionalCleared: cleared, optionalLeft: optional.length - cleared, pathLeft, path };
}

/** 직행 동선의 다음 목표 방: 경로 위 첫 미정화 방, 봉인이 풀렸으면 보스 방. */
export function directRouteNext(world, fromId) {
  const boss = world?.bossRoom; if (!boss || boss.cleared) return null;
  if (!world.sealed) return boss;
  const path = bossRoutePath(world, fromId);
  for (const id of path) { const room = world.rooms[id]; if (room && room !== boss && !room.cleared) return room; }
  return null;
}

/** 지도에 그릴 경로 선(방 중심 → 실제 L자 복도 꺾임점). 생성기의 복도 방향(가로 먼저)을 그대로 따른다. */
export function routePolyline(world, path) {
  const points = [];
  if (!path?.length) return points;
  const byCell = new Map(world.rooms.map((room) => [`${room.gx},${room.gy}`, room]));
  const first = world.rooms[path[0]]; points.push([first.x, first.z]);
  for (let i = 1; i < path.length; i++) {
    const a = world.rooms[path[i - 1]], b = world.rooms[path[i]];
    const link = (world.linkPending || []).find(([p, q]) => {
      const A = byCell.get(p.join(',')), B = byCell.get(q.join(','));
      return (A === a && B === b) || (A === b && B === a);
    });
    const A = link ? byCell.get(link[0].join(',')) : a;
    // 생성기 lShape(A, B): A.z 높이로 가로 → B.x 에서 세로. 방향이 반대면 같은 꺾임점을 거꾸로 지난다.
    const corner = A === a ? [b.x, a.z] : [a.x, b.z];
    points.push(corner, [b.x, b.z]);
  }
  return points;
}
