import { expect, test } from 'bun:test';
import { EconomyCore } from '../src/game/economy-core.js';
import { enhanceCost, enhanceStones, ENH_SAFE_MAX } from '../src/data/items.js';
import { enhanceSureCost, ENH_SURE_MIN, ENH_SURE_MAX } from '../src/data/enhance.js';
import { OPS, validateOp } from '../src/shared/v1-ops.js';
import { growthOptions } from '../src/game/growth-options.js';

// 확정 강화(골드 웃돈, 대표님 2026-10-29 "+11 전에 골드를 쓸 곳"): +3 → +11 구간만, 단계마다 비싸진다.
const core = (enh: number, gold = 5_000_000, rng = () => 0.999) => {
  const eco = EconomyCore.fromState(null, { rng, now: () => 1_800_000_000_000 });
  const inst = eco.pushItem('w_knight', { owner: 'knight' });
  inst.enh = enh; eco.s.gold = gold; eco.s.stones = 500; eco.s.stones2 = 500; eco.s.stones3 = 500;
  eco.equip('knight', inst.uid);
  return { eco, inst };
};

test('웃돈 표: +3 → +10 에만 있고 단계마다 오른다, 범위 밖은 null', () => {
  expect(ENH_SURE_MIN).toBe(ENH_SAFE_MAX); expect(ENH_SURE_MAX).toBe(10);
  for (const lv of [-1, 0, 1, 2, 11, 12, 19, 1.5]) expect(enhanceSureCost(lv)).toBeNull();
  for (let lv = ENH_SURE_MIN + 1; lv <= ENH_SURE_MAX; lv++) expect(enhanceSureCost(lv)!).toBeGreaterThan(enhanceSureCost(lv - 1)!);
  expect(enhanceSureCost(3)).toBe(8000); expect(enhanceSureCost(10)).toBe(172000);
  // 네 부위 +3 → +11 을 모두 확정으로 올리면 약 188만 골드(캠페인 4-5 보유 골드 약 175만과 같은 규모)
  let sum = 0; for (let lv = 3; lv <= 10; lv++) sum += enhanceSureCost(lv)!;
  expect(sum * 4).toBeGreaterThan(1_800_000); expect(sum * 4).toBeLessThan(2_000_000);
});

test('확정 강화는 난수가 실패여도 성공하고 일반 비용 + 웃돈과 강화석을 쓴다', () => {
  for (let lv = 3; lv <= 10; lv++) {
    const { eco, inst } = core(lv);
    const gold0 = eco.s.gold, stones0 = eco.s.stones + eco.s.stones2 + eco.s.stones3;
    const r: any = eco.enhance(inst.uid, { sure: true });
    expect(r.ok).toBe(true); expect(r.success).toBe(true); expect(r.enh).toBe(lv + 1); expect(r.sureGold).toBe(enhanceSureCost(lv));
    expect(gold0 - eco.s.gold).toBe(enhanceCost(lv) + enhanceSureCost(lv)!);
    expect(stones0 - (eco.s.stones + eco.s.stones2 + eco.s.stones3)).toBe(enhanceStones(lv));
  }
});

test('범위 밖·골드 부족·축복과 함께는 거절하고 아무것도 쓰지 않는다', () => {
  for (const [enh, gold, opts, reason] of [[11, 5e6, { sure: true }, 'sure'], [2, 5e6, { sure: true }, 'sure'], [5, enhanceCost(5) + 100, { sure: true }, 'gold'], [5, 5e6, { sure: true, bless: true }, 'stack'], [5, 5e6, { sure: true, protect: true }, 'stack']] as const) {
    const { eco, inst } = core(enh, gold);
    const before = JSON.stringify(eco.s);
    const r: any = eco.enhance(inst.uid, opts as any);
    expect([enh, r.ok, r.reason]).toEqual([enh, false, reason]);
    expect(JSON.stringify(eco.s)).toBe(before);
  }
  // 일반 강화는 그대로(웃돈 0, 같은 난수에서 실패)
  const { eco, inst } = core(5);
  const r: any = eco.enhance(inst.uid);
  expect(r.ok).toBe(true); expect(r.success).toBe(false); expect(r.sureGold).toBe(0);
});

test('서버 명령: 이전 3인자 enhance 와 새 4인자(sure) 모두 받고, 같은 결과를 낸다', () => {
  expect(validateOp('enhance', [1, false, false])).toBe(OPS.enhance);
  expect(validateOp('enhance', [1, false, false, true])).toBe(OPS.enhance);
  expect(validateOp('enhance', [1, false])).toBeNull();
  expect(validateOp('enhance', [1, false, false, true, true])).toBeNull();
  expect(validateOp('enhance', [1, false, false, 'yes'])).toBeNull();
  const a = core(7), b = core(7);
  const local: any = a.eco.enhance(a.inst.uid, { sure: true });
  const server: any = OPS.enhance.run(b.eco, b.inst.uid, false, false, true);
  expect(server).toEqual(local); expect(b.eco.stateHash()).toBe(a.eco.stateHash());
  // 3인자는 확정 강화를 쓰지 않는다
  const c = core(7); const plain: any = OPS.enhance.run(c.eco, c.inst.uid, false, false);
  expect(plain.success).toBe(false); expect(plain.sureGold).toBe(0);
});

test('성장 안내: 확률 강화 제안에 지금 낼 수 있을 때만 확정 웃돈을 싣는다', () => {
  const rich = core(5);
  const risk: any = growthOptions(rich.eco.s).find((o: any) => o.mode === 'risk');
  expect(risk?.sureGold).toBe(enhanceSureCost(5));
  const poor = core(5, enhanceCost(5) + 10);
  const risk2: any = growthOptions(poor.eco.s).find((o: any) => o.mode === 'risk');
  expect(risk2).toBeTruthy(); expect(risk2.sureGold).toBeUndefined();
});
