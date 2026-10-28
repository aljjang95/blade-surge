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

describe('P2-3 mergeServerOwned: 선택적 서버 소유 필드의 생략은 삭제', () => {
  test('서버 문서에 lineageSigil·gearDex 가 없으면 로컬 값을 지운다(다른 필드는 그대로)', () => {
    const local: any = { gold: 5, lineageSigil: 9, gearDex: dexOf({ knight: [Object.keys(ITEM_BY_ID)[0]] }), name: 'x' };
    const out: any = mergeServerOwned(local, { gold: 7 });
    expect(out.gold).toBe(7); expect(out.name).toBe('x');
    expect('lineageSigil' in out).toBe(false); expect('gearDex' in out).toBe(false);
    const keep: any = mergeServerOwned(local, { gold: 7, lineageSigil: 2, gearDex: dexOf({}) });
    expect(keep.lineageSigil).toBe(2); expect(keep.gearDex).toEqual(dexOf({}));
  });
  test('서버가 null 문서를 보내도(문서 없음) 일반 필드는 로컬 유지', () => {
    expect((mergeServerOwned({ gold: 1, lineageSigil: 3 }, null) as any).gold).toBe(1);
  });
});

describe('P2-6 소급 결과가 비어도 이관 완료 표지를 남긴다', () => {
  test('이전 저장(도감 없음)에서 소급이 비어도 gearDex 표지가 생기고, 그 뒤 장비를 얻어도 다시 소급하지 않는다', () => {
    const eco = newEco();
    const raw: any = JSON.parse(JSON.stringify(eco.s)); delete raw.gearDex; raw.inventory = [];
    for (const h of Object.values(raw.heroes) as any[]) for (const k of Object.keys(h.equip)) h.equip[k] = null;
    const once: any = normalizeSave(JSON.parse(JSON.stringify(raw)), eco.fresh());
    expect(once.gearDex).toEqual({ v: 1, drop: {}, kin: {}, claimed: {} });
    // 다음 로드 전에 금고 밖 장비가 생겨도(드랍 도감은 add 때 기록되지 않은 상태로 가정) 소급하지 않는다.
    once.inventory = [{ uid: 1, id: Object.keys(ITEM_BY_ID)[0], enh: 0, owner: 'knight' }]; once.invSeq = 2;
    const twice: any = normalizeSave(JSON.parse(JSON.stringify(once)), eco.fresh());
    expect(twice.gearDex.drop).toEqual({});
    expect(JSON.stringify(normalizeSave(JSON.parse(JSON.stringify(twice)), eco.fresh()))).toBe(JSON.stringify(twice));
  });
  test('스냅샷이 서버의 빈 도감을 돌려줘도 서버 로드(normalizeSave)가 다시 소급하지 않는다', () => {
    const eco = newEco(); eco.addItem('N', 'weapon', undefined, 0, 'knight');
    const raw: any = JSON.parse(JSON.stringify(eco.s));
    const snap = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, snapshot: true } as any) as any;
    const loaded: any = normalizeSave(JSON.parse(JSON.stringify(snap.state)), eco.fresh());
    expect(loaded.gearDex.drop).toEqual({});
  });
});
