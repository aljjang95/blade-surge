// RPG 필수 리뷰 P1-1: 가져오기·스냅샷이 방치 보급·7일 여정·업적 수령 기록을 클라이언트 값으로 받지 않는다.
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { sanitizeLegacySave } from '../src/shared/legacy-sanitize.js';
import { newbieView } from '../src/game/newbie-event.js';
import { grandfather } from './helpers/legacy-roster';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const DAY = 86400000, T = Date.UTC(2026, 9, 29, 3);
const forged = () => {
  const eco: any = grandfather(new Economy({ now: () => T, storage: memory(), rng: () => .5 }));
  const raw = JSON.parse(JSON.stringify(eco.s));
  raw.quests.kills = 100; raw.idle = { since: T - 30 * DAY, seen: T - 30 * DAY, comebackAt: 0 };
  raw.newbie = { start: Math.floor(T / DAY), claimed: [], final: false }; raw.achievements = { claimed: {} };
  return raw;
};

describe('정화', () => {
  test('외부 가져오기: 지금부터 쌓고 7일 여정은 닫고 닿은 업적은 받은 것으로', () => {
    const r: any = sanitizeLegacySave(forged(), { now: T, createdAt: T - 400 * DAY });
    expect(r.ok).toBe(true);
    expect(r.state.idle).toEqual({ since: T, seen: T, comebackAt: T });
    expect(newbieView(r.state.newbie, r.state, T).open).toBe(false);
    expect(r.state.achievements.claimed.slayer || 0).toBe(0); // 처치 100은 첫 단계(500) 미달
  });
  test('스냅샷: 서버 문서 값을 그대로', () => {
    const server = { idle: { since: T - 3600000, seen: T - 60000, comebackAt: T - DAY }, newbie: { start: 1, claimed: ['d1a'], final: false }, achievements: { claimed: { slayer: 1 } } };
    const r: any = sanitizeLegacySave(forged(), { now: T, createdAt: T - 400 * DAY, snapshot: true, serverIdle: server.idle, serverNewbie: server.newbie, serverAchievements: server.achievements });
    expect(r.ok).toBe(true);
    expect(r.state.idle).toEqual(server.idle);
    expect(r.state.newbie).toEqual(server.newbie);
    expect(r.state.achievements).toEqual(server.achievements);
  });
});
