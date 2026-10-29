import { describe, expect, test } from 'bun:test';
import { EconomyCore } from '../src/game/economy-core.js';
import { ITEM_POOL } from '../src/data/items.js';
import { transferGold, transferStones, TRANSFER_MIN_ENH } from '../src/data/enhance-transfer.js';
import { OPS, validateOp } from '../src/shared/v1-ops.js';
import { SKUS } from '../src/data/shop.js';
import { parityHash, PARITY_KEYS } from '../src/shared/state-hash.js';
import { v1Harness } from './helpers/v1-harness';

// 강화 전승(대표님 2026-10-29): 같은 부위·같은 주인 장비로 강화 단계를 옮긴다. 대상 = 원본 − 1(주문서면 손실 없음), 원본은 +0.
const pick = (slot: string, rarity: string) => (ITEM_POOL as any)[slot].find((x: any) => x.rarity === rarity).id;
const setup = ({ gold = 5_000_000, srcEnh = 11, srcR = 'E', dstR = 'U', dstSlot = 'weapon', dstOwner = 'knight', il = 45 } = {}) => {
  const eco = EconomyCore.fromState(null, { rng: () => 0.5, now: () => 1_800_000_000_000 }) as any;
  eco.s.gold = gold; eco.s.stones = 9000; eco.s.stones2 = 2000; eco.s.stones3 = 100;
  const src = eco.pushItem(pick('weapon', srcR), { owner: 'knight', il: 30 }); src.enh = srcEnh;
  const dst = eco.pushItem(pick(dstSlot, dstR), { owner: dstOwner, il });
  eco.equip('knight', src.uid);
  return { eco, src, dst };
};

describe('강화 전승 규칙', () => {
  test('기본: 대상 +10, 원본 +0, 골드·상급 강화석만 차감, 착용 승계', () => {
    const { eco, src, dst } = setup();
    const gold0 = eco.s.gold, st0 = eco.s.stones2, s1 = eco.s.stones, s3 = eco.s.stones3, gems0 = eco.s.gems;
    const q = eco.enhanceTransferQuote(src.uid, dst.uid);
    expect(q.ok).toBe(true); expect(q.to).toBe(10); expect(q.gold).toBe(transferGold(11, dst));
    const r = eco.enhanceTransfer(src.uid, dst.uid);
    expect(r).toMatchObject({ ok: true, from: 11, to: 10, loss: 1, prevTarget: 0, equipped: true });
    expect(dst.enh).toBe(10); expect(src.enh).toBe(0);
    expect(eco.s.inventory).toContain(src);   // 원본은 파괴되지 않는다
    expect(gold0 - eco.s.gold).toBe(q.gold); expect(st0 - eco.s.stones2).toBe(transferStones(11).n);
    expect([eco.s.stones, eco.s.stones3, eco.s.gems]).toEqual([s1, s3, gems0]);
    expect(eco.s.heroes.knight.equip.weapon).toBe(dst.uid);
  });

  test('전승 보호 주문서: 손실 없음, 주문서 1장 차감, 없으면 거절', () => {
    const a = setup();
    expect(a.eco.enhanceTransfer(a.src.uid, a.dst.uid, { scroll: true })).toMatchObject({ ok: false, reason: 'scroll' });
    a.eco.s.transferScroll = 2;
    const r = a.eco.enhanceTransfer(a.src.uid, a.dst.uid, { scroll: true });
    expect(r).toMatchObject({ ok: true, to: 11, loss: 0 }); expect(a.dst.enh).toBe(11); expect(a.eco.s.transferScroll).toBe(1);
  });

  test('거절 사유: 같은 장비·다른 부위·다른 주인·금고·낮은 등급·최소 단계·이득 없음·골드·다른 영웅 착용 — 상태 불변', () => {
    const cases: [any, (x: any) => void, string][] = [
      [{}, (x) => { x.dst = x.src; }, 'same'],
      [{ dstSlot: 'armor' }, () => {}, 'slot'],
      [{ dstOwner: 'mage' }, () => {}, 'owner'],
      [{}, (x) => { x.eco.vaultDeposit(x.dst.uid); }, 'owner'],
      [{ dstR: 'S' }, () => {}, 'rarity'],
      [{ srcEnh: TRANSFER_MIN_ENH - 1 }, () => {}, 'min'],
      [{}, (x) => { x.dst.enh = 10; }, 'gain'],
      [{ gold: 1000 }, () => {}, 'gold'],
      [{}, (x) => { x.eco.s.stones2 = 3; }, 'stones'],
      [{}, (x) => { x.eco.s.heroes.mage.equip.weapon = x.dst.uid; }, 'worn'],
    ];
    for (const [opt, mut, reason] of cases) {
      const x: any = setup(opt); mut(x);
      const before = JSON.stringify(x.eco.s);
      const r = x.eco.enhanceTransfer(x.src.uid, x.dst.uid);
      expect([reason, r.ok, r.reason]).toEqual([reason, false, reason]);
      expect(JSON.stringify(x.eco.s)).toBe(before);
    }
  });

  test('같은 등급(E→E)은 허용, 착용하지 않은 원본이면 장착은 그대로', () => {
    const { eco, src, dst } = setup({ dstR: 'E' });
    eco.unequip('knight', 'weapon');
    const r = eco.enhanceTransfer(src.uid, dst.uid);
    expect(r).toMatchObject({ ok: true, equipped: false }); expect(eco.s.heroes.knight.equip.weapon).toBeNull();
  });

  test('룬 소켓·내구도(dur)·il 은 각 장비에 그대로 남는다(내구도 필드가 없어도 동작)', () => {
    const { eco, src, dst } = setup();
    src.dur = 37; dst.dur = 100; src.sockets = [{ id: 'x', grade: 1 }]; dst.sockets = [null];
    const keep = { s: structuredClone({ dur: src.dur, sockets: src.sockets, il: src.il, id: src.id }), d: structuredClone({ dur: dst.dur, sockets: dst.sockets, il: dst.il, id: dst.id }) };
    expect(eco.enhanceTransfer(src.uid, dst.uid).ok).toBe(true);
    expect({ dur: src.dur, sockets: src.sockets, il: src.il, id: src.id }).toEqual(keep.s);
    expect({ dur: dst.dur, sockets: dst.sockets, il: dst.il, id: dst.id }).toEqual(keep.d);
    const b = setup(); expect(b.eco.enhanceTransfer(b.src.uid, b.dst.uid).ok).toBe(true);
    expect('dur' in b.src).toBe(false); expect('dur' in b.dst).toBe(false);
  });

  test('비용표: 단계·대상 등급·il 이 오르면 비싸지고, 실측 구간(+11 → U/L il 45)이 보유 210만의 의미 있는 몫이다', () => {
    const w = (r: string, il = 45) => ({ id: pick('weapon', r), il });
    for (let e = TRANSFER_MIN_ENH + 1; e <= 20; e++) expect(transferGold(e, w('U'))!).toBeGreaterThan(transferGold(e - 1, w('U'))!);
    expect(transferGold(11, w('L'))!).toBeGreaterThan(transferGold(11, w('U'))!);
    expect(transferGold(11, w('U', 80))!).toBeGreaterThan(transferGold(11, w('U', 45))!);
    expect(transferGold(11, w('U'))).toBe(259700); expect(transferGold(11, w('L'))).toBe(311600);
    const fourSlots = 2 * transferGold(11, w('U'))! + 2 * transferGold(11, w('L'))!;
    expect(fourSlots).toBeGreaterThan(1_000_000); expect(fourSlots).toBeLessThan(1_500_000);
    expect(transferStones(11)).toEqual({ tier: 2, key: 'stones2', n: 35 });
    expect(transferStones(10)).toEqual({ tier: 1, key: 'stones', n: 60 });
    expect(transferStones(16)).toEqual({ tier: 3, key: 'stones3', n: 8 });
  });

  test('저장: 전승 보호 주문서 필드는 이전 저장에 0으로 생기고 음수·문자는 정화된다, 상점 sku 는 보석 강화 탭', () => {
    const old = EconomyCore.fromState(null, { rng: () => 0.5, now: () => 1 }) as any;
    const raw = old.snapshot(); delete raw.transferScroll;
    expect((EconomyCore.fromState(structuredClone(raw), { rng: () => 0.5, now: () => 1 }) as any).s.transferScroll).toBe(0);
    for (const bad of [-3, 'x', 1.5]) expect((EconomyCore.fromState({ ...structuredClone(raw), transferScroll: bad }, { rng: () => 0.5, now: () => 1 }) as any).s.transferScroll).toBeGreaterThanOrEqual(0);
    const sku: any = SKUS.find((x) => x.id === 'transfer1');
    expect(sku).toMatchObject({ tab: 'enh', kind: 'gem', rewards: { transferScroll: 1 } });
    expect(sku.price).toBeGreaterThan(300); expect(sku.price).toBeLessThan(1000);
    expect(PARITY_KEYS).toContain('transferScroll');
  });
});

describe('강화 전승 서버 명령', () => {
  test('형식 검증과 로컬·서버 같은 결과', () => {
    expect(validateOp('enhanceTransfer', [1, 2, false])).toBe(OPS.enhanceTransfer);
    expect(validateOp('enhanceTransfer', [1, 2])).toBeNull();
    expect(validateOp('enhanceTransfer', [1, 'x', false])).toBeNull();
    expect(validateOp('enhanceTransfer', [1, 2, 'yes'])).toBeNull();
    expect(validateOp('enhanceTransfer', [0, 2, false])).toBeNull();
    const a = setup(), b = setup();
    const local = a.eco.enhanceTransfer(a.src.uid, a.dst.uid, { scroll: false });
    const server = OPS.enhanceTransfer.run(b.eco, b.src.uid, b.dst.uid, false);
    expect(server).toEqual(local); expect(b.eco.stateHash()).toBe(a.eco.stateHash());
  });

  test('/cmd enhanceTransfer: 서버 결과와 클라이언트 stateHash 일치, 거절은 422', async () => {
    const h = await v1Harness();
    const acct = await h.session();
    const seed = EconomyCore.fromState(null, { now: () => h.now(), rng: () => 0.5 }) as any;
    seed.s.gold = 5_000_000; seed.s.stones2 = 500; seed.s.transferScroll = 1;
    const src = seed.pushItem(pick('weapon', 'E'), { owner: 'knight' }); src.enh = 12;
    const dst = seed.pushItem(pick('weapon', 'L'), { owner: 'knight' });
    seed.equip('knight', src.uid);
    const start = seed.snapshot(), text = JSON.stringify(start);
    h.db.sqlite.query('UPDATE account_docs SET doc = ?, bytes = ? WHERE account_id = ?').run(text, Math.min(text.length, 262144), acct.accountId);
    const client = EconomyCore.fromState(structuredClone(start), { now: () => h.now(), rng: () => 0.5 }) as any;
    const run = async (args: unknown[]) => {
      const def = validateOp('enhanceTransfer', args)!; const localOk = def.ok(def.run(client, ...args));
      const r = await h.cmd(acct.token, 'enhanceTransfer', args, { clientHash: parityHash(client.s) });
      return { localOk, r };
    };
    let x = await run([dst.uid, src.uid, false]); expect([x.localOk, x.r.status]).toEqual([false, 422]);   // 이득 없음(L+0 → E)
    x = await run([src.uid, dst.uid, true]); expect([x.localOk, x.r.status, x.r.body.match]).toEqual([true, 200, true]);
    const me = await h.send('GET', '/me', undefined, acct.token);
    expect(me.body.stateHash).toBe(parityHash(client.s));
    expect(client.s.transferScroll).toBe(0);
    expect(client.s.inventory.find((i: any) => i.uid === dst.uid).enh).toBe(12);
  });
});
