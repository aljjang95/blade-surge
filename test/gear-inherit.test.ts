// 장비 계승 코어(docs/GEAR_VAULT_INHERIT.md 덩어리 1): bound 거부·계승 의식·정규화 멱등.
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { VAULT_INHERIT, isBound, ritualQuote, normalizeVault, withdrawGold } from '../src/game/gear-vault.js';
import { periodAt } from '../src/game/journey-core.js';
import { ITEMS_OF } from '../src/data/items.js';
import { GEAR_DEX_MILESTONES, normalizeGearDex } from '../src/game/gear-dex.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { grantLootItem } from '../src/shared/settlement.js';
import { sanitizeLegacySave } from '../src/shared/legacy-sanitize.js';
import { EconomyCore } from '../src/game/economy-core.js';
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

describe('장비 도감 (덩어리 2)', () => {
  const fresh = (e: any) => normalizeSave(JSON.parse(JSON.stringify(e.s)), e.fresh());

  test('드랍은 직접 얻은 영웅의 도감에 한 번만 등재(같은 종류 반복·pushItem·서버 grantLootItem 공통)', () => {
    const eco = newEco(); delete eco.s.gearDex;
    const a = eco.addItem('E', 'weapon', undefined, 0, 'knight'); eco.addItem('E', 'weapon', undefined, 0, 'knight');
    expect(eco.s.gearDex.drop.knight).toEqual([a.id]);
    const loot = grantLootItem(eco, { id: Object.keys(ITEM_BY_ID).find((k) => k !== a.id)! }, 0, 'mage');
    grantLootItem(eco, { id: loot.id }, 0, 'mage');
    expect(eco.s.gearDex.drop.mage).toEqual([loot.id]);
    expect(eco.s.gearDex.kin).toEqual({});
  });

  test('일반 꺼내기·맡기기·장착은 도감을 바꾸지 않는다', () => {
    const eco = newEco(); eco.s.roster.owned.push('blackcat');
    const bow = stash(eco, 'L', 'ranger'), ring = stash(eco, 'U', 'knight', 0, 'ring');
    const before = JSON.stringify(eco.s.gearDex);
    expect(eco.vaultWithdraw(bow.uid, 'blackcat').ok).toBe(true);
    expect(eco.vaultWithdraw(ring.uid, 'mage').ok).toBe(true);
    eco.equip('mage', ring.uid);
    expect(JSON.stringify(eco.s.gearDex)).toBe(before);
    expect(eco.s.gearDex.drop.blackcat).toBeUndefined();
  });

  test('의식은 받은 영웅의 계승 도감에만 등재(드랍 도감 불변), 실패하면 불변', () => {
    const eco = newEco(); const it = stash(eco, 'L', 'knight');
    const drop = JSON.stringify(eco.s.gearDex.drop);
    eco.s.gold = 0; expect(eco.vaultRitual(it.uid, 'mage').ok).toBe(false);
    expect(eco.s.gearDex.kin).toEqual({});
    eco.s.gold = 10_000_000;
    expect(eco.vaultRitual(it.uid, 'mage').ok).toBe(true);
    expect(eco.s.gearDex.kin).toEqual({ mage: [it.id] }); expect(JSON.stringify(eco.s.gearDex.drop)).toBe(drop);
  });

  test('소급 이관: 이전 저장(도감 없음)은 영웅 소유 장비로 한 번 채우고(금고 제외) 멱등, 빈 저장도 빈 도감 표지', () => {
    const eco = newEco(); eco.addItem('N', 'weapon', undefined, 0, 'knight'); const v = stash(eco, 'E', 'mage');
    const raw: any = JSON.parse(JSON.stringify(eco.s)); delete raw.gearDex;
    const once = normalizeSave(JSON.parse(JSON.stringify(raw)), eco.fresh());
    expect(Object.keys(once.gearDex.drop)).toEqual(['knight']); expect(once.gearDex.drop.knight).not.toContain(v.id);
    expect(JSON.stringify(normalizeSave(JSON.parse(JSON.stringify(once)), eco.fresh()))).toBe(JSON.stringify(once));
    const empty: any = JSON.parse(JSON.stringify(raw)); empty.inventory = []; for (const h of Object.values(empty.heroes) as any[]) for (const k of Object.keys(h.equip)) h.equip[k] = null;
    expect(normalizeSave(empty, eco.fresh()).gearDex).toEqual({ v: 1, drop: {}, kin: {}, claimed: {} });   // 빈 소급도 이관 완료 표지(P2-6)
    expect(normalizeGearDex({ drop: { knight: ['nope'], zzz: [Object.keys(ITEM_BY_ID)[0]] }, claimed: { knight: ['bad'] } })).toBeNull();
  });

  test('마일스톤 수령: 달성 전 거부, 1회만(중복·재요청 거부), 모르는 마일스톤·미보유 영웅 거부', () => {
    const eco = newEco(); const ids = Object.keys(ITEM_BY_ID);
    expect(eco.gearDexClaim('knight', 'drop25')).toMatchObject({ ok: false, reason: 'locked' });
    eco.s.gearDex = { v: 1, drop: { knight: ids.slice(0, Math.ceil(ids.length / 4)) }, kin: {}, claimed: {} };
    expect(eco.gearDexClaim('knight', 'drop25').ok).toBe(true);
    expect(eco.gearDexClaim('knight', 'drop25')).toMatchObject({ ok: false, reason: 'claimed' });
    expect(eco.gearDexClaim('knight', 'drop50')).toMatchObject({ ok: false, reason: 'locked' });
    expect(eco.gearDexClaim('knight', 'nope')).toMatchObject({ ok: false, reason: 'milestone' });
    expect(eco.gearDexClaim('nobody', 'drop25')).toMatchObject({ ok: false, reason: 'hero' });
    expect(eco.s.gearDex.claimed.knight).toEqual(['drop25']);
    for (const m of GEAR_DEX_MILESTONES) for (const k of Object.keys(m.rewards)) expect(['stones', 'stones2', 'stones3', 'lineageSigil', 'fragments', 'protect', 'bless']).toContain(k);   // 재료만, 현금 상품 키 없음
    const a: any = eco.addRewards({ lineageSigil: 2 }); expect(eco.s.lineageSigil).toBe(20 + (GEAR_DEX_MILESTONES[0].rewards as any).lineageSigil + 2); expect(a[0].k).toBe('lineageSigil');
  });

  test('가져오기 정화: 문장 0, 가져온 kin·claimed 버림, 드랍은 가져온 장비로 재구성, 서버 문서의 수령 기록은 유지', () => {
    const eco = newEco(); const ids = Object.keys(ITEM_BY_ID);
    const raw: any = JSON.parse(JSON.stringify(eco.s));
    raw.lineageSigil = 999; raw.gearDex = { v: 1, drop: { knight: ids }, kin: { mage: ids }, claimed: { knight: ['drop100'] } };
    const inv = raw.inventory.find((x: any) => x.owner === 'knight') ?? eco.addItem('N', 'boots', undefined, 0, 'knight');
    raw.inventory = JSON.parse(JSON.stringify(eco.s.inventory)); if (raw.inventory.length) raw.inventory[0].hops = 500;
    const r = sanitizeLegacySave(raw, { now: T, createdAt: T - 400 * DAY, serverGearDex: { v: 1, drop: {}, kin: {}, claimed: { knight: ['drop25'] } } }) as any;
    expect(r.ok).toBe(true);
    expect('lineageSigil' in r.state).toBe(false);
    expect(r.state.gearDex.kin).toEqual({});
    expect(r.state.gearDex.claimed).toEqual({ knight: ['drop25'] });
    expect((r.state.gearDex.drop.knight || []).length).toBeLessThan(ids.length);
    expect(Math.max(0, ...r.state.inventory.map((x: any) => x.hops || 0))).toBeLessThanOrEqual(99);
    void inv; void EconomyCore;
  });
});
