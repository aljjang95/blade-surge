// 장비 영웅 귀속 · 금고 계약(docs/GEAR_OWNERSHIP_VAULT.md): 이관·귀속·이전 규칙·서버 정합.
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { normalizeSave } from '../src/game/save.js';
import { VAULT, withdrawGold, expandGold, normalizeVault } from '../src/game/gear-vault.js';
import { periodAt } from '../src/game/journey-core.js';
import { ITEMS_OF } from '../src/data/items.js';
import { stageDef } from '../src/data/stages.js';
import { applyDifficulty, DIFFICULTIES } from '../src/game/difficulty.js';
import { applySettlement, grantLootItem, plausibilityFor } from '../src/shared/settlement.js';
import { validateOp, OPS } from '../src/shared/v1-ops.js';
import { growthOptions } from '../src/game/growth-options.js';
import { buildInventoryModel } from '../src/ui/maple-inventory.js';
import { vaultModel } from '../src/ui/vault-panel.js';
import { parityHash } from '../src/shared/state-hash.js';
import { createSeededRng } from '../src/shared/rng.js';
import { v1Harness } from './helpers/v1-harness';
import { grandfather } from './helpers/legacy-roster';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const T = Date.UTC(2026, 9, 28, 3);
const DAY = 86400000;
const id = (r: string, slot = 'weapon') => (ITEMS_OF as any)(r, slot)[0].id;
let clock = T;
const newEco = (storage = memory()) => { clock = T; return grandfather(new Economy({ now: () => clock, storage, rng: () => .5 })); };
const strip = (list: any[]) => list.map(({ owner, from, legacy, ...rest }) => rest);

/** 귀속 이전(공유 인벤토리) 저장: 기사·마법사가 하나씩 끼고, 미장착 셋, 룬 소켓·고통 단계 장비 포함. */
function legacySave() {
  const eco = newEco();
  const raw: any = JSON.parse(JSON.stringify(eco.s));
  delete raw.vault;
  raw.selected = 'mage';
  raw.inventory = [
    { uid: 3, id: id('L'), enh: 15, tp: 12 },
    { uid: 5, id: id('E', 'armor'), enh: 7 },
    { uid: 8, id: id('U', 'ring'), enh: 0 },
    { uid: 9, id: id('N', 'boots'), enh: 2 },
    { uid: 11, id: id('S'), enh: 20 },
  ];
  raw.invSeq = 12;
  raw.heroes.knight.equip.weapon = 3; raw.heroes.mage.equip.armor = 5;
  return raw;
}

describe('기존 저장 이관', () => {
  test('장착 = 그 영웅 소유, 미장착 = 지금 고른 영웅 + 첫 이동 무료, 장비 수·uid·강화·tp 보존', () => {
    const eco = newEco(), raw = legacySave();
    const out = normalizeSave(structuredClone(raw), eco.fresh());
    expect(strip(out.inventory)).toEqual(raw.inventory);
    expect(out.invSeq).toBe(12);
    const by = Object.fromEntries(out.inventory.map((x: any) => [x.uid, x]));
    expect(by[3]).toMatchObject({ owner: 'knight' }); expect(by[3].legacy).toBeUndefined();
    expect(by[5]).toMatchObject({ owner: 'mage' }); expect(by[5].legacy).toBeUndefined();
    for (const uid of [8, 9, 11]) expect(by[uid]).toMatchObject({ owner: 'mage', legacy: 1 });
    expect(out.heroes.knight.equip.weapon).toBe(3); expect(out.heroes.mage.equip.armor).toBe(5);
    expect(out.vault).toEqual({ v: 1, expansions: 0, day: 0, used: 0 });
  });

  test('멱등: 이관한 결과를 다시 이관해도 같다(저장 → 로드 → 저장 2회)', () => {
    const eco = newEco(), once = normalizeSave(legacySave(), eco.fresh());
    const twice = normalizeSave(JSON.parse(JSON.stringify(once)), eco.fresh());
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const storage = memory(); storage.setItem('bladesurge_save_v1', JSON.stringify(legacySave()));
    const a = new Economy({ now: () => T, storage }); a.save();
    const b = new Economy({ now: () => T, storage });
    expect(JSON.stringify(b.s.inventory)).toBe(JSON.stringify(a.s.inventory));
    expect(b.s.inventory.length).toBe(5);
  });

  test('룬 소켓은 이관 뒤에도 그대로 붙어 있다', () => {
    const eco = newEco(), raw = legacySave();
    raw.inventory[0].sockets = [{ id: null }, { id: null }, { id: null }];
    const out = normalizeSave(raw, eco.fresh());
    const plain = normalizeSave({ ...legacySave(), inventory: [{ ...legacySave().inventory[0], sockets: raw.inventory[0].sockets }], vault: undefined }, eco.fresh());
    expect(out.inventory[0].sockets).toEqual(plain.inventory[0].sockets);
  });

  test('롤백: 귀속 필드를 모르는 이전 버전 형태로 돌아가도 장비를 잃지 않고, 다시 이관된다', () => {
    const eco = newEco(), once = normalizeSave(legacySave(), eco.fresh());
    const old = JSON.parse(JSON.stringify(once)); delete old.vault; old.inventory = strip(old.inventory);
    const again = normalizeSave(old, eco.fresh());
    expect(strip(again.inventory)).toEqual(strip(once.inventory));
    expect(again.inventory.filter((x: any) => x.legacy === 1).map((x: any) => x.uid)).toEqual([8, 9, 11]);
  });

  test('새 저장(vault 있음)에서 주인 없는 장비는 지금 고른 영웅 소유가 되고 legacy 를 받지 않는다', () => {
    const eco = newEco(), s: any = JSON.parse(JSON.stringify(eco.s));
    s.inventory = [{ uid: 1, id: id('N'), enh: 0 }, { uid: 2, id: id('N'), enh: 0, owner: 'nobody' }, { uid: 3, id: id('N'), enh: 0, owner: 'vault', from: 'ghost' }]; s.invSeq = 4;
    const out = normalizeSave(s, eco.fresh());
    expect(out.inventory.map((x: any) => [x.owner, x.legacy, x.from])).toEqual([['knight', undefined, undefined], ['knight', undefined, undefined], ['vault', undefined, undefined]]);
  });
});

describe('드랍 귀속', () => {
  test('전투 장부의 영웅이 필드 드랍·완료 상자의 주인이다(고른 영웅이 달라도)', () => {
    const eco = newEco(); eco.s.selected = 'knight';
    const stage = applyDifficulty(stageDef(1, 1), DIFFICULTIES.story) as any;
    eco.beginFieldRewards(stage, 'ranger');
    expect(eco.fieldDrop('N').owner).toBe('ranger');
    const r = eco.completeStage(stage, 3, { fullClear: true });
    expect(r.loot.length).toBeGreaterThan(0);
    for (const item of r.loot) expect(item.owner).toBe('ranger');
    // 정산이 끝난 뒤(전투 밖) 얻는 장비는 지금 고른 영웅 것
    expect(eco.addItem('N').owner).toBe('knight');
  });

  test('서버 정산은 티켓 영웅에게 준다(grantLootItem·applySettlement)', () => {
    const eco = EconomyCore.fromState(null, { now: () => T, rng: createSeededRng(3) }) as any;
    eco.s.roster.owned.push('mage');
    expect(grantLootItem(eco, { id: id('N') } as any, 0, 'mage').owner).toBe('mage');
    expect(grantLootItem(eco, { id: id('N') } as any, 0, 'nobody').owner).toBe(eco.s.selected);
    const stage = applyDifficulty(stageDef(1, 1), DIFFICULTIES.story) as any, lim = plausibilityFor(stage);
    const seq = eco.s.invSeq;
    const out = applySettlement(eco, stage, { heroId: 'mage', lootSeed: 77 }, { win: true, elapsedMs: lim.minClearMs + 30000, kills: { normal: 40, elite: 2, boss: 1 }, roomsCleared: 5, hpLost: 0, revives: 0, damageDealt: 1000, stars: 3 }, 'ok');
    const fresh = eco.s.inventory.filter((x: any) => x.uid >= seq);
    expect(out.win).toBe(true);
    expect(fresh.length).toBeGreaterThan(0);
    for (const x of fresh) expect(x.owner).toBe('mage');
  });

  test('소환·제작 장비는 지금 고른 영웅 소유다', () => {
    const eco = newEco(); eco.s.selected = 'rogue'; eco.s.gold = 1e9; eco.s.fragments = 1e6;
    expect(eco.rollResult('SSR', { featured: null } as any)).toBeTruthy();
    eco.craftSetItem('storm', 'weapon'); eco.addRewards({ ssrGear: 1 });
    expect(eco.s.inventory.length).toBeGreaterThan(0);
    for (const x of eco.s.inventory) expect(x.owner).toBe('rogue');
  });
});

describe('장착 제한 · 가방 보기', () => {
  test('다른 영웅·금고 장비는 장착할 수 없고, 가방·인벤토리 창·성장 추천에 보이지 않는다', () => {
    const eco = newEco();
    const mine = eco.addItem('E', 'weapon', undefined, 0, 'knight'), theirs = eco.addItem('L', 'weapon', undefined, 0, 'mage');
    expect(eco.equip('knight', theirs.uid)).toBe(false);
    expect(eco.hero('knight').equip.weapon).toBeNull();
    eco.equip('knight', mine.uid); expect(eco.hero('knight').equip.weapon).toBe(mine.uid);
    expect(eco.heroBag('knight').map((x: any) => x.uid)).toEqual([mine.uid]);
    expect(eco.heroBag('mage').map((x: any) => x.uid)).toEqual([theirs.uid]);
    eco.s.selected = 'knight';
    const cells = buildInventoryModel(eco, { tab: 'gear' }).cells.filter((c: any) => c.type === 'gear').map((c: any) => c.uid);
    expect(cells).toEqual([mine.uid]);
    eco.unequip('knight', 'weapon');
    const opts = growthOptions(eco.s).filter((o: any) => o.kind === 'equipment' && o.mode === 'equip');
    expect(opts.map((o: any) => o.uid)).toEqual([mine.uid]);
    expect(eco.isUpgrade('knight', theirs)).toBe(false);
  });

  test('서버 명령 equip 도 다른 영웅 장비를 거부한다(v1-ops)', () => {
    const eco = newEco(); const theirs = eco.addItem('N', 'weapon', undefined, 0, 'mage');
    const def = validateOp('equip', ['knight', theirs.uid])!;
    expect(def.ok(def.run(eco, 'knight', theirs.uid))).toBe(false);
    expect(def.ok(def.run(eco, 'mage', theirs.uid))).toBe(true);
  });
});

describe('금고 이전 규칙', () => {
  test('맡기기는 무료·장착 해제, 맡긴 영웅에게 되돌리기는 무료·횟수 미차감', () => {
    const eco = newEco(); eco.s.gold = 0;
    const item = eco.addItem('L', 'weapon', undefined, 0, 'knight'); item.enh = 12; eco.equip('knight', item.uid);
    expect(eco.vaultDeposit(item.uid)).toEqual({ ok: true, from: 'knight' });
    expect(eco.hero('knight').equip.weapon).toBeNull();
    expect(item).toMatchObject({ owner: 'vault', from: 'knight', enh: 12 });
    expect(eco.vaultDeposit(item.uid).ok).toBe(false); // 이미 금고
    expect(eco.vaultWithdrawQuote(item.uid, 'knight')).toMatchObject({ ok: true, gold: 0, free: 'return' });
    expect(eco.vaultWithdraw(item.uid, 'knight')).toMatchObject({ ok: true, gold: 0, free: 'return' });
    expect(item.owner).toBe('knight'); expect((item as any).from).toBeUndefined(); expect(eco.s.vault.used).toBe(0);
  });

  test('다른 영웅은 등급·강화 비례 골드, 강화·tp·룬 그대로, 하루 5회', () => {
    const eco = newEco(); eco.s.gold = 1e9;
    expect(withdrawGold({ id: id('L'), enh: 20 })).toBe(240000);
    expect(withdrawGold({ id: id('N'), enh: 0 })).toBe(500);
    expect(withdrawGold({ id: id('E'), enh: 5 })).toBe(12000);
    const items = Array.from({ length: 6 }, () => { const x = eco.addItem('U', 'ring', undefined, 0, 'knight'); x.enh = 9; (x as any).tp = 4; return x; });
    for (const x of items) eco.vaultDeposit(x.uid);
    const cost = withdrawGold(items[0]);
    for (let i = 0; i < 5; i++) {
      const before = eco.s.gold, r = eco.vaultWithdraw(items[i].uid, 'mage');
      expect(r).toMatchObject({ ok: true, gold: cost, free: null }); expect(eco.s.gold).toBe(before - cost);
      expect(items[i]).toMatchObject({ owner: 'mage', enh: 9, tp: 4 });
    }
    expect(eco.vaultWithdraw(items[5].uid, 'mage')).toMatchObject({ ok: false, reason: 'daily' });
    // 무료 꺼내기는 하루 횟수와 상관없다
    expect(eco.vaultWithdraw(items[5].uid, 'knight')).toMatchObject({ ok: true, free: 'return' });
    // 다음 날(05:00 KST 초기화) 다시 열린다
    eco.vaultDeposit(items[5].uid); eco.vaultDeposit(items[0].uid);
    expect(eco.vaultWithdraw(items[0].uid, 'rogue')).toMatchObject({ ok: false, reason: 'daily' });
    clock = T + DAY;
    expect(eco.vaultState().dailyLeft).toBe(5);
    expect(eco.vaultWithdraw(items[0].uid, 'rogue')).toMatchObject({ ok: true, gold: cost });
    expect(eco.s.vault.day).toBe(periodAt(T + DAY).day); expect(eco.s.vault.used).toBe(1);
  });

  test('같은 무기 계열(레인저↔검은고양이)과 공유 시절 장비는 무료', () => {
    const eco = newEco(); eco.s.gold = 0; eco.s.roster.owned.push('blackcat');
    const bow = eco.addItem('L', 'weapon', undefined, 0, 'ranger'); eco.vaultDeposit(bow.uid);
    expect(eco.vaultWithdrawQuote(bow.uid, 'blackcat')).toMatchObject({ ok: true, free: 'kin', gold: 0 });
    expect(eco.vaultWithdrawQuote(bow.uid, 'knight')).toMatchObject({ ok: false, reason: 'bound' });   // L 은 다른 계열에게 골드로 못 간다(계승 의식)
    const ring = eco.addItem('E', 'weapon', undefined, 0, 'ranger'); eco.vaultDeposit(ring.uid);
    expect(eco.vaultWithdrawQuote(ring.uid, 'knight')).toMatchObject({ ok: false, reason: 'gold' });
    const storage = memory(); storage.setItem('bladesurge_save_v1', JSON.stringify(legacySave()));
    const old = grandfather(new Economy({ now: () => T, storage })); old.s.gold = 0;
    const leg = old.s.inventory.find((x: any) => x.uid === 11);
    expect(old.vaultDeposit(11).ok).toBe(true);
    expect(old.vaultWithdraw(11, 'rogue')).toMatchObject({ ok: true, free: 'legacy', gold: 0 });
    expect(leg.legacy).toBeUndefined();
    old.vaultDeposit(11);
    expect(old.vaultWithdrawQuote(11, 'knight')).toMatchObject({ ok: false, reason: 'gold' }); // 두 번째부터는 일반 규칙(맡긴 영웅 rogue 아님)
  });

  test('칸 수 20, 가득 차면 맡기기 거부, 확장 +10칸·비용 두 배·최대 8회', () => {
    const eco = newEco(); eco.s.gold = 0;
    const list = Array.from({ length: 21 }, () => eco.addItem('N', 'boots', undefined, 0, 'knight'));
    for (let i = 0; i < 20; i++) expect(eco.vaultDeposit(list[i].uid).ok).toBe(true);
    expect(eco.vaultDeposit(list[20].uid)).toEqual({ ok: false, reason: 'full' });
    expect(eco.vaultExpand()).toMatchObject({ ok: false, reason: 'gold', gold: 50000 });
    eco.s.gold = 1e10;
    let total = 0;
    for (let n = 0; n < VAULT.maxExpansions; n++) { const r = eco.vaultExpand(); expect(r).toMatchObject({ ok: true, gold: 50000 * 2 ** n, slots: 30 + 10 * n }); total += r.gold!; }
    expect(total).toBe(12750000);
    expect(eco.vaultExpand()).toEqual({ ok: false, reason: 'max' });
    expect(eco.vaultState()).toMatchObject({ slots: 100, expandGold: null });
    expect(eco.vaultDeposit(list[20].uid).ok).toBe(true);
    expect(expandGold(normalizeVault({ expansions: 2 }))).toBe(200000);
  });

  test('미소유 영웅에게는 꺼낼 수 없다', () => {
    const eco = newEco(); eco.s.roster = { policy: 2, owned: ['knight'], starter: 'knight', starterChosen: true, paid: [] };
    const x = eco.addItem('N', 'weapon', undefined, 0, 'knight'); eco.vaultDeposit(x.uid);
    expect(eco.vaultWithdraw(x.uid, 'mage')).toMatchObject({ ok: false, reason: 'hero' });
  });

  test('금고 화면 모델: 칸·견적·맡길 가방 장비', () => {
    const eco = newEco(); eco.s.gold = 1e9;
    const a = eco.addItem('L', 'weapon', undefined, 0, 'knight'), b = eco.addItem('N', 'boots', undefined, 0, 'mage');
    eco.equip('knight', a.uid); eco.vaultDeposit(b.uid);
    const m = vaultModel(eco, 'knight');
    expect(m).toMatchObject({ used: 1, slots: 20, full: false, dailyLeft: 5 });
    expect(m.stored.map((r: any) => [r.inst.uid, r.quote.gold, r.quote.free])).toEqual([[b.uid, 500, null]]);
    expect(m.bag.map((r: any) => [r.inst.uid, r.worn])).toEqual([[a.uid, true]]);
  });

  test('명령표: 금고 명령의 인자 형식', () => {
    expect(validateOp('vaultDeposit', [1])).toBe((OPS as any).vaultDeposit);
    expect(validateOp('vaultWithdraw', [1, 'mage'])).toBe((OPS as any).vaultWithdraw);
    expect(validateOp('vaultExpand', [])).toBe((OPS as any).vaultExpand);
    for (const [op, args] of [['vaultDeposit', [0]], ['vaultDeposit', ['1']], ['vaultWithdraw', [1]], ['vaultWithdraw', [1, 'a b']], ['vaultExpand', [1]]] as const)
      expect(validateOp(op, args as unknown as unknown[])).toBeNull();
  });
});

describe('서버 경로(/cmd)', () => {
  test('맡기기·꺼내기·확장이 서버 규칙으로 실행되고 클라이언트 해시와 일치, 다른 영웅 장착은 422', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const seed = EconomyCore.fromState(null, { now: () => h.now(), rng: createSeededRng(9) }) as any;
    seed.s.gold = 5_000_000; seed.s.roster.owned.push('mage'); seed.s.roster.starterChosen = true;
    const w = seed.addItem('E', 'weapon', undefined, 0, 'knight'); w.enh = 10;
    const start = seed.snapshot();
    const text = JSON.stringify(start);
    h.db.sqlite.query('UPDATE account_docs SET doc = ?, bytes = ? WHERE account_id = ?').run(text, text.length, a.accountId);
    const client = EconomyCore.fromState(structuredClone(start), { now: () => h.now(), rng: () => .5 }) as any;
    const run = async (op: string, args: unknown[]) => {
      const def = validateOp(op, args)!; const localOk = def.ok(def.run(client, ...args));
      const r = await h.cmd(a.token, op, args, { clientHash: parityHash(client.s) });
      return { localOk, r };
    };
    let x = await run('equip', ['mage', w.uid]);
    expect([x.localOk, x.r.status]).toEqual([false, 422]);
    x = await run('vaultDeposit', [w.uid]); expect([x.localOk, x.r.status, x.r.body.match]).toEqual([true, 200, true]);
    x = await run('vaultWithdraw', [w.uid, 'mage']); expect([x.localOk, x.r.status, x.r.body.match]).toEqual([true, 200, true]);
    expect(x.r.body.doc.gold).toBe(5_000_000 - withdrawGold(w));
    expect(x.r.body.doc.inventory.find((i: any) => i.uid === w.uid)).toMatchObject({ owner: 'mage', enh: 10 });
    x = await run('equip', ['mage', w.uid]); expect([x.localOk, x.r.status, x.r.body.match]).toEqual([true, 200, true]);
    x = await run('vaultExpand', []); expect([x.localOk, x.r.status, x.r.body.match]).toEqual([true, 200, true]);
    expect(x.r.body.doc.vault.expansions).toBe(1);
    const me = await h.send('GET', '/me', undefined, a.token);
    expect(me.body.stateHash).toBe(parityHash(client.s));
  });

  test('서버 런 정산 장비는 티켓 영웅 소유다', async () => {
    const h = await v1Harness();
    const a = await h.session();
    const seed = EconomyCore.fromState(null, { now: () => h.now() }) as any;
    seed.s.roster.owned.push('mage'); seed.s.roster.starterChosen = true;
    const text = JSON.stringify(seed.snapshot());
    h.db.sqlite.query('UPDATE account_docs SET doc = ?, bytes = ? WHERE account_id = ?').run(text, text.length, a.accountId);
    const stage = applyDifficulty(stageDef(1, 1), DIFFICULTIES.story) as any, lim = plausibilityFor(stage);
    const t = await h.send('POST', '/runs/start', { kind: 'campaign', contentId: '1-1', heroId: 'mage', cid: 'vault-run-0001' }, a.token);
    expect(t.status).toBe(200);
    h.advance(lim.minClearMs + 40000);
    const r = await h.send('POST', `/runs/${t.body.runId}/settle`, { win: true, elapsedMs: lim.minClearMs + 30000, kills: { normal: 40, elite: 2, boss: 1 }, roomsCleared: 5, hpLost: 0, revives: 0, damageDealt: 1000, stars: 3 }, a.token);
    expect(r.status).toBe(200);
    expect(r.body.doc.inventory.length).toBeGreaterThan(0);
    for (const item of r.body.doc.inventory) expect(item.owner).toBe('mage');
    expect(r.body.doc.selected).toBe('knight');
  });
});

// PR #353 교차 리뷰: 착용 참조를 직접 바꾸는 우회 경로(여정 목표 장착 → 정규화 소유 확정) 차단.
describe('귀속 우회 차단', () => {
  test('저장된 소유자가 있으면 다른 영웅의 착용 참조로 소유가 바뀌지 않고 착용이 풀린다', () => {
    const eco = newEco();
    const raw: any = JSON.parse(JSON.stringify(eco.s));
    raw.vault = { day: 0, used: 0, expansions: 0 };
    raw.inventory = [{ uid: 40, id: id('L'), enh: 9, owner: 'mage' }, { uid: 41, id: id('E'), enh: 3, owner: 'vault', from: 'mage' }];
    raw.invSeq = 42;
    raw.heroes.knight.equip.weapon = 40;
    raw.heroes.rogue.equip.weapon = 41;
    const s = normalizeSave(raw, eco.fresh());
    expect(s.inventory.find((x: any) => x.uid === 40).owner).toBe('mage');
    expect(s.inventory.find((x: any) => x.uid === 41).owner).toBe('vault');
    expect(s.heroes.knight.equip.weapon).toBeNull();
    expect(s.heroes.rogue.equip.weapon).toBeNull();
    expect(s.inventory.length).toBe(2);
  });
});
