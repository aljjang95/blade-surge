// 계승 PR #377 GPT 교차 리뷰 P2 6건의 재현 테스트(docs/GEAR_VAULT_INHERIT.md).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { sanitizeLegacySave } from '../src/shared/legacy-sanitize.js';
import { mergeServerOwned } from '../src/shared/state-hash.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { grandfather } from './helpers/legacy-roster';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const T = Date.UTC(2026, 9, 28, 3);
const DAY = 86400000;
const newEco = () => { const e: any = grandfather(new Economy({ now: () => T, storage: memory(), rng: () => .5 })); e.s.gold = 10_000_000; return e; };
const dexOf = (drop: Record<string, string[]>, extra: any = {}) => ({ v: 1, drop, kin: {}, claimed: {}, ...extra });

describe('P2-2·5 shadowSnapshot: 서버 문장·도감 보존', () => {
  test('스냅샷은 서버 문장 잔액을 남기고(가져온 값 무시), 외부 가져오기는 여전히 0', () => {
    const eco = newEco(); const raw: any = JSON.parse(JSON.stringify(eco.s)); raw.lineageSigil = 999;
    const snap = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true, serverLineageSigil: 7 } as any) as any;
    expect(snap.ok).toBe(true); expect(snap.state.lineageSigil).toBe(7);
    const none = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true } as any) as any;
    expect('lineageSigil' in none.state).toBe(false);
    const imp = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, serverLineageSigil: 7 } as any) as any;
    expect('lineageSigil' in imp.state).toBe(false);
  });

  test('스냅샷은 서버 도감을 그대로 유지하고 현재 소유 장비로 드랍 도감을 소급하지 않는다(가져오기는 소급)', () => {
    const eco = newEco(); eco.addItem('N', 'weapon', undefined, 0, 'knight'); eco.addItem('E', 'armor', undefined, 0, 'knight');
    const raw: any = JSON.parse(JSON.stringify(eco.s));
    const server = dexOf({}, { kin: { mage: [Object.keys(ITEM_BY_ID)[0]] }, claimed: { knight: ['drop25'] } });
    const snap = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true, serverGearDex: server } as any) as any;
    expect(snap.state.gearDex.drop).toEqual({}); expect(snap.state.gearDex.kin).toEqual(server.kin); expect(snap.state.gearDex.claimed).toEqual(server.claimed);
    const imp = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, serverGearDex: server } as any) as any;
    expect((imp.state.gearDex.drop.knight || []).length).toBeGreaterThan(0);
  });
});
