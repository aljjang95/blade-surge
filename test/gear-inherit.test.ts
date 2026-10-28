// 장비 계승 코어(docs/GEAR_VAULT_INHERIT.md 덩어리 1): bound 거부·계승 의식·정규화 멱등.
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { VAULT_INHERIT, isBound, ritualQuote, normalizeVault, withdrawGold } from '../src/game/gear-vault.js';
import { periodAt } from '../src/game/journey-core.js';
import { ITEMS_OF } from '../src/data/items.js';
import { grandfather } from './helpers/legacy-roster';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const T = Date.UTC(2026, 9, 28, 3);
const DAY = 86400000;
let clock = T;
const newEco = () => { clock = T; const e: any = grandfather(new Economy({ now: () => clock, storage: memory(), rng: () => .5 })); e.s.gold = 10_000_000; e.s.lineageSigil = 20; return e; };
/** 영웅이 얻은 장비를 금고에 맡긴다. */
const stash = (eco: any, rarity: string, hero: string, enh = 0, slot = 'weapon') => { const it = eco.addItem(rarity, slot, undefined, 0, hero); it.enh = enh; expect(eco.vaultDeposit(it.uid).ok).toBe(true); return it; };

describe('이관 · 정규화', () => {
  test('이전 저장은 정규화 뒤에도 같고(없는 필드를 쓰지 않음) 두 번 적용해도 같다', () => {
    const eco = newEco(); delete eco.s.lineageSigil;
    stash(eco, 'E', 'knight', 3);
    const raw = JSON.parse(JSON.stringify(eco.s));
    const once = normalizeSave(JSON.parse(JSON.stringify(raw)), eco.fresh());
    expect(JSON.stringify(once.inventory)).toBe(JSON.stringify(raw.inventory));
    expect(once.invSeq).toBe(raw.invSeq); expect(JSON.stringify(once.vault)).toBe(JSON.stringify(raw.vault));
    expect(once.vault).toEqual({ v: 1, expansions: 0, day: 0, used: 0 });
    expect('lineageSigil' in once).toBe(false);
    expect(once.inventory.some((x: any) => 'hops' in x || 'lin' in x)).toBe(false);
    expect(JSON.stringify(normalizeSave(JSON.parse(JSON.stringify(once)), eco.fresh()))).toBe(JSON.stringify(once));
  });

  test('hops/lin/rday/rused/lineageSigil 정화: 범위 밖·모르는 영웅·음수·비정수', () => {
    const eco = newEco();
    const it = stash(eco, 'E', 'knight');
    const raw: any = JSON.parse(JSON.stringify(eco.s));
    const inst = raw.inventory.find((x: any) => x.uid === it.uid);
    inst.hops = 500; inst.lin = ['mage', 'nobody', 'ranger', 'mage', 'knight', 'mage', 'ranger'];
    raw.vault.rday = 7; raw.vault.rused = 99999; raw.lineageSigil = 4;
    const out = normalizeSave(raw, eco.fresh());
    const o = out.inventory.find((x: any) => x.uid === it.uid);
    expect(o.hops).toBe(VAULT_INHERIT.hopsMax);
    expect(o.lin).toEqual(['ranger', 'mage', 'knight', 'mage', 'ranger']);   // 모르는 id 제거 뒤 마지막 5개
    expect(o.lin).not.toContain('nobody');
    expect(out.vault).toMatchObject({ rday: 7, rused: 1000 });
    expect(out.lineageSigil).toBe(4);
    for (const bad of [-3, 2.5, '5', null, NaN]) { const r2: any = JSON.parse(JSON.stringify(eco.s)); r2.lineageSigil = bad; expect('lineageSigil' in normalizeSave(r2, eco.fresh())).toBe(false); }
    const r3: any = JSON.parse(JSON.stringify(eco.s)); r3.inventory.find((x: any) => x.uid === it.uid).hops = -2; r3.inventory.find((x: any) => x.uid === it.uid).lin = ['mage'];
    const o3 = normalizeSave(r3, eco.fresh()).inventory.find((x: any) => x.uid === it.uid);
    expect('hops' in o3).toBe(false); expect('lin' in o3).toBe(false);
    expect(normalizeVault({ rday: 3 })).toEqual({ v: 1, expansions: 0, day: 0, used: 0, rday: 3, rused: 0 });
  });
});

describe('L 귀속 (bound)', () => {
  test('bound 4경우: 되돌리기·같은 계열·legacy 허용, 다른 계열은 bound(상태 불변)', () => {
    const eco = newEco(); eco.s.roster.owned.push('blackcat');
    const bow = stash(eco, 'L', 'ranger');
    expect(isBound(bow, 'ranger')).toBe(false);   // 되돌리기
    expect(isBound(bow, 'blackcat')).toBe(false); // 같은 계열
    expect(isBound(bow, 'knight')).toBe(true);
    const gold = eco.s.gold, vault = JSON.stringify(eco.s.vault);
    expect(eco.vaultWithdraw(bow.uid, 'knight')).toMatchObject({ ok: false, reason: 'bound' });
    expect(eco.s.gold).toBe(gold); expect(JSON.stringify(eco.s.vault)).toBe(vault); expect(bow.owner).toBe('vault');
    expect(eco.vaultWithdraw(bow.uid, 'blackcat')).toMatchObject({ ok: true, free: 'kin' });
    const back = stash(eco, 'L', 'knight');
    expect(eco.vaultWithdraw(back.uid, 'knight')).toMatchObject({ ok: true, free: 'return' });
    const leg = stash(eco, 'L', 'knight'); leg.legacy = 1;
    expect(eco.vaultWithdraw(leg.uid, 'mage')).toMatchObject({ ok: true, free: 'legacy' });
    expect(leg.legacy).toBeUndefined();
  });

  test('L 이외 등급은 다른 계열에게 골드로 꺼낼 수 있다', () => {
    const eco = newEco(); const u = stash(eco, 'U', 'knight');
    expect(eco.vaultWithdraw(u.uid, 'mage')).toMatchObject({ ok: true });
  });
});

describe('계승 의식', () => {
  test('비용: L+0 = 골드(withdrawGold)+문장 1, L+15 = 문장 2. 강화·소켓·uid 불변, hops/lin 기록', () => {
    const eco = newEco();
    const a = stash(eco, 'L', 'knight', 0), b = stash(eco, 'L', 'knight', 15); b.sockets = [{ id: null }];
    const g0 = eco.s.gold;
    const ra = eco.vaultRitual(a.uid, 'mage');
    expect(ra).toMatchObject({ ok: true, gold: withdrawGold({ id: a.id, enh: 0 }), sigil: 1, hops: 1 });
    expect(eco.s.gold).toBe(g0 - ra.gold); expect(eco.s.lineageSigil).toBe(19);
    expect(a).toMatchObject({ owner: 'mage', hops: 1, lin: ['knight'], enh: 0 }); expect(a.from).toBeUndefined();
    const rb = eco.vaultRitual(b.uid, 'mage');
    expect(rb).toMatchObject({ ok: true, sigil: 2 }); expect(eco.s.lineageSigil).toBe(17);
    expect(b).toMatchObject({ owner: 'mage', enh: 15, sockets: [{ id: null }] });
    expect(eco.s.vault).toMatchObject({ rused: 2, used: 0 });
  });

  test('일일 상한 2회는 일반 꺼내기 카운터와 분리, 다음 날 초기화', () => {
    const eco = newEco();
    const items = [1, 2, 3].map(() => stash(eco, 'L', 'knight'));
    expect(eco.vaultRitual(items[0].uid, 'mage').ok).toBe(true);
    expect(eco.vaultRitual(items[1].uid, 'rogue').ok).toBe(true);
    expect(eco.vaultRitual(items[2].uid, 'mage')).toMatchObject({ ok: false, reason: 'daily' });
    expect(eco.s.vault.used).toBe(0);   // 일반 카운터는 그대로
    for (let i = 0; i < 5; i++) { const x = stash(eco, 'U', 'knight'); expect(eco.vaultWithdraw(x.uid, 'mage').ok).toBe(true); }
    const x = stash(eco, 'U', 'knight');
    expect(eco.vaultWithdraw(x.uid, 'mage')).toMatchObject({ ok: false, reason: 'daily' });
    clock = T + DAY;
    expect(eco.vaultRitual(items[2].uid, 'mage').ok).toBe(true);
    expect(eco.s.vault.rday).toBe(periodAt(T + DAY).day); expect(eco.s.vault.rused).toBe(1);
    expect(eco.vaultWithdraw(x.uid, 'mage').ok).toBe(true);   // 일반도 초기화
  });

  test('거부: 미보유 영웅·같은 영웅·재료/골드 부족·금고 밖 장비, 실패 시 상태 불변', () => {
    const eco = newEco(); eco.s.roster = { policy: 2, owned: ['knight', 'mage'], starter: 'knight', starterChosen: true, paid: [] };
    const it = stash(eco, 'L', 'knight');
    const snap = () => JSON.stringify([eco.s.gold, eco.s.lineageSigil, eco.s.vault, eco.s.inventory]);
    const s0 = snap();
    expect(eco.vaultRitual(it.uid, 'rogue')).toMatchObject({ ok: false, reason: 'hero' });
    expect(eco.vaultRitual(it.uid, 'nobody')).toMatchObject({ ok: false, reason: 'hero' });
    expect(eco.vaultRitual(it.uid, 'knight')).toMatchObject({ ok: false, reason: 'same' });
    eco.s.lineageSigil = 0;
    expect(eco.vaultRitual(it.uid, 'mage')).toMatchObject({ ok: false, reason: 'sigil' });
    eco.s.lineageSigil = 20; eco.s.gold = 0;
    expect(eco.vaultRitual(it.uid, 'mage')).toMatchObject({ ok: false, reason: 'gold' });
    eco.s.gold = 10_000_000;
    expect(snap().replace('"lineageSigil"', '')).toBe(s0);
    const worn = eco.addItem('L', 'armor', undefined, 0, 'knight'); eco.equip('knight', worn.uid);
    expect(eco.vaultRitual(worn.uid, 'mage')).toMatchObject({ ok: false, reason: 'item' });
    expect(eco.vaultRitual(99999, 'mage')).toMatchObject({ ok: false, reason: 'item' });
    expect(ritualQuote(eco.s, it.uid, 'mage', clock).ok).toBe(true);
  });

  test('복제 불변식: uid 집합·invSeq·장비 수 불변, 왕복해도 hops 가 같은 장비에 누적(최대 lin 5)', () => {
    const eco = newEco();
    const it = stash(eco, 'L', 'knight');
    const uids = () => eco.s.inventory.map((x: any) => x.uid).sort().join(','), seq = eco.s.invSeq, n = eco.s.inventory.length, u0 = uids();
    const heroes = ['mage', 'rogue'];
    for (let i = 0; i < 7; i++) {
      clock = T + i * DAY;
      const to = heroes[i % 2];
      expect(eco.vaultRitual(it.uid, to).ok).toBe(true);
      expect(eco.vaultDeposit(it.uid).ok).toBe(true);
    }
    expect(uids()).toBe(u0); expect(eco.s.invSeq).toBe(seq); expect(eco.s.inventory.length).toBe(n);
    expect(it.hops).toBe(7); expect(it.lin.length).toBe(VAULT_INHERIT.linMax);
    const out = normalizeSave(JSON.parse(JSON.stringify(eco.s)), eco.fresh());
    expect(out.inventory.find((x: any) => x.uid === it.uid)).toMatchObject({ hops: 7, lin: it.lin });
  });
});
