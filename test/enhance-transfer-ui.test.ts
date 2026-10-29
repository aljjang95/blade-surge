// 강화 전승 화면 모델·추천(enhance-transfer-panel transferModel, gear-advice transferUpgrades). 화면 없는 모델 + 모달 HTML 문자열로 확인한다.
import { describe, expect, test } from 'bun:test';
import { EconomyCore } from '../src/game/economy-core.js';
import { ITEM_POOL } from '../src/data/items.js';
import { transferModel, canTransfer, openTransferSheet, TRANSFER_FAIL_TEXT } from '../src/ui/enhance-transfer-panel.js';
import { transferUpgrades } from '../src/game/gear-advice.js';

const pick = (slot: string, rarity: string) => (ITEM_POOL as any)[slot].find((x: any) => x.rarity === rarity).id;
const setup = () => {
  const eco = EconomyCore.fromState(null, { rng: () => 0.5, now: () => 1_800_000_000_000 }) as any;
  eco.s.gold = 5_000_000; eco.s.stones = 9000; eco.s.stones2 = 2000;
  const src = eco.pushItem(pick('weapon', 'E'), { owner: 'knight', il: 30 }); src.enh = 11;
  const u = eco.pushItem(pick('weapon', 'U'), { owner: 'knight', il: 45 });
  const l = eco.pushItem(pick('weapon', 'L'), { owner: 'knight', il: 45 });
  const low = eco.pushItem(pick('weapon', 'S'), { owner: 'knight', il: 45 });      // 낮은 등급: 대상 불가
  const armor = eco.pushItem(pick('armor', 'L'), { owner: 'knight', il: 45 });     // 다른 부위
  const other = eco.pushItem(pick('weapon', 'L'), { owner: 'mage', il: 45 });      // 다른 주인
  const vaulted = eco.pushItem(pick('weapon', 'L'), { owner: 'knight', il: 45 }); eco.vaultDeposit(vaulted.uid);
  eco.equip('knight', src.uid);
  return { eco, src, u, l, low, armor, other, vaulted };
};

describe('강화 전승 모델', () => {
  test('강화가 있는 장비는 원본으로, 대상 목록은 같은 부위·같은 주인·같거나 높은 등급만', () => {
    const x = setup();
    const m: any = transferModel(x.eco, x.src.uid);
    expect(m.role).toBe('source'); expect(m.srcUid).toBe(x.src.uid);
    const ids = m.targets.map((t: any) => t.uid).sort();
    expect(ids).toEqual([x.u.uid, x.l.uid].sort());
    expect(m.preview).toMatchObject({ from: 11, to: 10, loss: 1, targetEnh: 0, swapEquip: true });
    const q = x.eco.enhanceTransferQuote(m.srcUid, m.dstUid);
    expect([m.preview.gold, m.preview.stones, m.preview.stoneKey]).toEqual([q.gold, q.stones, q.stoneKey]);
    expect(m.ok).toBe(true);
  });

  test('강화 없는 장비는 대상으로 미리 고르고 원본 후보를 보여 준다, 짝이 없으면 role null', () => {
    const x = setup();
    const m: any = transferModel(x.eco, x.l.uid);
    expect(m.role).toBe('target'); expect(m.dstUid).toBe(x.l.uid); expect(m.sources.map((s: any) => s.uid)).toEqual([x.src.uid]);
    expect(canTransfer(x.eco, x.armor.uid)).toBe(false); expect(transferModel(x.eco, x.armor.uid)!.role).toBeNull();
    expect(canTransfer(x.eco, x.low.uid)).toBe(false);
  });

  test('주문서 토글: 결과 +11·손실 0, 보유 없으면 사유 문구', () => {
    const x = setup();
    let m: any = transferModel(x.eco, x.src.uid, { scroll: true });
    expect(m.preview.to).toBe(11); expect(m.preview.loss).toBe(0); expect(m.ok).toBe(false); expect(m.reasonText).toBe(TRANSFER_FAIL_TEXT.scroll);
    x.eco.s.transferScroll = 1;
    m = transferModel(x.eco, x.src.uid, { scroll: true }); expect(m.ok).toBe(true); expect(m.scrolls).toBe(1);
  });

  test('추천: 강화를 옮기면 전투력이 오르는 대상을 부위마다 하나, 모델이 그 대상을 먼저 고른다', () => {
    const x = setup();
    const tips = transferUpgrades(x.eco, 'knight');
    expect(tips.length).toBe(1);
    expect(tips[0]).toMatchObject({ slot: 'weapon', srcUid: x.src.uid, to: 10 });
    expect([x.u.uid, x.l.uid]).toContain(tips[0].dstUid); expect(tips[0].delta).toBeGreaterThan(0);
    expect(transferModel(x.eco, x.src.uid)!.dstUid).toBe(tips[0].dstUid);
    const before = JSON.stringify(x.eco.s); transferUpgrades(x.eco, 'knight'); expect(JSON.stringify(x.eco.s)).toBe(before);
  });

  test('시트 HTML: 원본·대상·미리보기·주문서·전승 버튼', () => {
    const x = setup(); let html = '';
    const meta: any = { eco: x.eco, ui: { modal: (h: string) => { html = h; }, toast: () => {}, closeModal: () => {} } };
    openTransferSheet(meta, x.src.uid, 'knight');
    for (const s of ['강화 전승', 'data-src="' + x.src.uid + '"', 'data-dst="' + x.l.uid + '"', '+11 → <b>+0</b>', '전승 보호 주문서 사용', 'id="et-go"']) expect(html).toContain(s);
  });
});

describe('Codex 리뷰 재현', () => {
  test('추천: 단독 점수가 같아도 좋은 룬이 박힌 대상은 실제 빌드 비교까지 간다(w_dragon +11 → 룬 III 두 개 w_dragon)', () => {
    const eco = EconomyCore.fromState(null, { rng: () => 0.5, now: () => 1_800_000_000_000 }) as any;
    const src = eco.pushItem('w_dragon', { owner: 'knight' }); src.enh = 11; eco.equip('knight', src.uid);
    const dst = eco.pushItem('w_dragon', { owner: 'knight' });
    eco.runeState().bag.ember_edge = [0, 0, 2];
    expect(eco.runeInsert(dst.uid, 0, { id: 'ember_edge', grade: 3 }).ok).toBe(true);
    expect(eco.runeInsert(dst.uid, 1, { id: 'ember_edge', grade: 3 }).ok).toBe(true);
    const tips = transferUpgrades(eco, 'knight');
    expect(tips).toEqual([{ slot: 'weapon', srcUid: src.uid, dstUid: dst.uid, to: 10, delta: expect.any(Number) }]);
    expect(eco.heroBuildStats('knight').power + tips[0].delta).toBeGreaterThan(eco.heroBuildStats('knight').power);
  });

  test('서버 대기 시간 초과 뒤 다시 그리기: 원본이 이미 +0 이면 남은 역할을 다시 판정하고 빈 목록을 색인하지 않는다', () => {
    const x = setup();
    const m0: any = transferModel(x.eco, x.src.uid);
    expect(x.eco.enhanceTransfer(m0.srcUid, m0.dstUid).ok).toBe(true);   // 낙관 반영(서버 결과는 아직)
    let m: any;
    expect(() => { m = transferModel(x.eco, x.src.uid, { srcUid: m0.srcUid, dstUid: m0.dstUid }); }).not.toThrow();
    // 원본(E)은 +0 이 됐고 +10 을 받은 장비는 더 높은 등급이라 원본 쪽으로 되돌릴 수 없다: 짝 없음으로 다시 판정한다.
    expect(m.role).toBeNull(); expect(m.sources).toEqual([]); expect(m.targets).toEqual([]);
    // 짝이 전혀 없게 되면 role null, 목록 비어 있음
    for (const it of x.eco.s.inventory) it.enh = 0;
    expect(() => { m = transferModel(x.eco, x.src.uid, { srcUid: x.src.uid }); }).not.toThrow();
    expect(m.role).toBeNull(); expect(m.sources).toEqual([]); expect(m.targets).toEqual([]);
  });

  test('시트: 서버 응답 대기 중이면 깨지지 않고 대기 문구를 보여 준다', async () => {
    const x = setup(); let html = '', open: any = null;
    const yes = { disabled: false, onclick: null as any, focus: () => {} };
    const queue: any = { lastCid: 'a', settled: async () => ({ ok: false, timeout: true }) };
    const origin = x.eco.enhanceTransfer.bind(x.eco);
    x.eco.enhanceTransfer = (...a: any[]) => { const r = origin(...a); queue.lastCid = 'b'; return r; };
    const meta: any = { eco: x.eco, app: { account: { authority: 'server', queue } }, ui: { modal: (h: string, o: any) => { html = h; open = o; }, toast: () => {}, closeModal: () => {} } };
    openTransferSheet(meta, x.src.uid, 'knight');
    const fakeBox = (map: Record<string, any>) => ({ querySelector: (s: string) => map[s] || null, querySelectorAll: () => [], set onkeydown(_v: any) {} });
    const go = { onclick: null as any, focus: () => {} };
    open.onOpen(fakeBox({ '#et-close': { focus: () => {} }, '#et-go': go })); go.onclick();
    open.onOpen(fakeBox({ '#et-close': { focus: () => {} }, '#et-yes': yes }));
    await yes.onclick();
    expect(html).toContain('id="et-notice"'); expect(html).toContain(TRANSFER_FAIL_TEXT.pending);
  });
});
