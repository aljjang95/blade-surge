import { expect, test } from 'bun:test';
import {
  LEGEND, LEGEND_BRANCHES, LEGEND_NODES, LEGEND_KEYSTONES, LEGEND_MAX_RANK, legendExpFor, grantLegendExp, legendStats, legendKeystones,
  allocate, respec, respecCost, normalizeLegend, nodeValue, branchPoints,
} from '../src/game/legend-rank.js';
import { Economy } from '../src/game/economy.js';
import { grantCombatXp, HERO_LEVEL_CAP } from '../src/game/rpg-core.js';
import { levelExp } from '../src/data/heroes.js';
import { normalizeSave } from '../src/game/save.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const newEco = () => new Economy({ now: () => 1_800_000_000_000, storage: memory(), rng: () => .5 });
const fresh = () => normalizeLegend(null);

test('필요 EXP는 단계마다 선형으로 늘고 상한이 없다', () => {
  expect(legendExpFor(0)).toBe(LEGEND.baseExp);
  expect(legendExpFor(10)).toBe(Math.floor(LEGEND.baseExp * (1 + 10 * LEGEND.growth)));
  for (let r = 1; r < 300; r++) expect(legendExpFor(r)).toBeGreaterThan(legendExpFor(r - 1));
  expect(Math.abs((legendExpFor(100) - legendExpFor(99)) - (legendExpFor(2) - legendExpFor(1)))).toBeLessThanOrEqual(1); // 선형(소수점 버림 오차 1)
  expect(legendExpFor(-5)).toBe(LEGEND.baseExp);
  expect(legendExpFor(NaN)).toBe(LEGEND.baseExp);
});

test('EXP를 받으면 단계가 오르고 단계마다 점수 1이 쌓이며 남는 EXP는 다음 단계로 이어진다', () => {
  const s = fresh();
  expect(grantLegendExp(s, LEGEND.baseExp - 1)).toMatchObject({ ranks: 0, rank: 0, points: 0 });
  expect(s.exp).toBe(LEGEND.baseExp - 1);
  const up = grantLegendExp(s, 1 + legendExpFor(1) + 7);
  expect(up).toMatchObject({ ranks: 2, rank: 2, points: 2, exp: 7 });
  expect(s).toMatchObject({ rank: 2, exp: 7, points: 2 });
  // 한 번에 크게 받아도 단계 단위로 정확히 오른다
  const big = fresh(); let need = 0; for (let r = 0; r < 50; r++) need += legendExpFor(r);
  expect(grantLegendExp(big, need + 3)).toMatchObject({ rank: 50, exp: 3, points: 50 });
});

test('잘못된 EXP 입력은 상태를 바꾸지 않는다', () => {
  const s = fresh(); const before = structuredClone(s);
  for (const bad of [-1, 0, NaN, Infinity, -Infinity, undefined, null, '12' as any]) grantLegendExp(s, bad as number);
  expect(s).toEqual(before);
  expect(grantLegendExp(null as any, 100).gained).toBe(0);
});

test('키스톤은 5단계마다 한 갈래씩 열리고 단계 100에서 20개가 모두 열린다', () => {
  expect(LEGEND_KEYSTONES).toHaveLength(LEGEND_BRANCHES.length * 5);
  expect(legendKeystones(4)).toHaveLength(0);
  expect(legendKeystones(5).map((k: any) => k.branch)).toEqual(['blade']);
  expect(legendKeystones(20).map((k: any) => k.branch)).toEqual(['blade', 'wall', 'storm', 'plunder']);
  expect(legendKeystones(100)).toHaveLength(20);
  expect(new Set(LEGEND_KEYSTONES.map((k: any) => k.unlockRank)).size).toBe(20);
  for (const k of LEGEND_KEYSTONES) expect(k.unlockRank % LEGEND.keystoneEvery).toBe(0);
  const s = fresh();
  expect(grantLegendExp(s, legendExpFor(0) + legendExpFor(1) + legendExpFor(2) + legendExpFor(3) + legendExpFor(4)).keystones).toEqual(['blade_afterimage']);
});

test('키스톤은 스탯이 아니라 전투 동사를 바꾸는 효과다', () => {
  for (const k of LEGEND_KEYSTONES) {
    expect(k.effect.length).toBeGreaterThan(8);
    expect(k.effect).not.toMatch(/\+ ?\d|증가|늘어난다|상승/);
  }
  const stormFirst = LEGEND_KEYSTONES.find((k: any) => k.id === 'storm_afterswirl');
  expect(stormFirst?.effect).toBe('진공 끝에 작은 회오리가 1초 남는다');
});

test('노드는 4갈래 × 6개이고 효과는 체감 감소한다', () => {
  expect(LEGEND_NODES).toHaveLength(24);
  for (const b of LEGEND_BRANCHES) expect(LEGEND_NODES.filter((n: any) => n.branch === b.id)).toHaveLength(6);
  expect(new Set(LEGEND_NODES.map((n: any) => n.id)).size).toBe(24);
  const node = LEGEND_NODES[0];
  const step = (l: number) => nodeValue(node, l) - nodeValue(node, l - 1);
  for (let l = 2; l <= LEGEND.maxNodeLevel; l++) expect(step(l)).toBeLessThan(step(l - 1));
  expect(nodeValue(node, LEGEND.maxNodeLevel)).toBeCloseTo(node.eff * LEGEND.maxNodeLevel / (LEGEND.maxNodeLevel + LEGEND.k), 8);
  expect(nodeValue(node, LEGEND.maxNodeLevel)).toBeLessThan(node.eff);
});

test('점수 배분: 점수·상한·노드 이름을 검사하고 실패하면 상태를 바꾸지 않는다', () => {
  const s = fresh(); grantLegendExp(s, 2 * legendExpFor(0) + 2 * LEGEND.baseExp * 3); // 몇 단계
  const points = s.points; expect(points).toBeGreaterThan(2);
  expect(allocate(s, 'nope')).toMatchObject({ ok: false, error: 'node' });
  expect(allocate(s, '__proto__')).toMatchObject({ ok: false, error: 'node' });
  expect(allocate(s, 'blade_edge', 0)).toMatchObject({ ok: false, error: 'amount' });
  expect(allocate(s, 'blade_edge', 1.5)).toMatchObject({ ok: false, error: 'amount' });
  expect(allocate(s, 'blade_edge', 999)).toMatchObject({ ok: false, error: 'max' });
  expect(s.points).toBe(points);
  expect(allocate(s, 'blade_edge', 2)).toMatchObject({ ok: true, level: 2, points: points - 2 });
  expect(allocate(s, 'wall_bulk')).toMatchObject({ ok: true, level: 1 });
  const rich = fresh(); rich.rank = 60; rich.points = 60;
  expect(allocate(rich, 'blade_edge', LEGEND.maxNodeLevel)).toMatchObject({ ok: true, level: LEGEND.maxNodeLevel });
  expect(allocate(rich, 'blade_edge')).toMatchObject({ ok: false, error: 'max' });
  const poor = fresh();
  expect(allocate(poor, 'blade_edge')).toMatchObject({ ok: false, error: 'points' });
});

test('legendStats: 전투 스탯은 노드 합산, 약탈 골드·드랍은 상한, 키스톤 플래그는 단계로 정해진다', () => {
  const empty = legendStats(fresh());
  expect(empty).toMatchObject({ rank: 0, points: 0, flags: [], atkPct: 0, hpPct: 0, def: 0, goldPct: 0 });
  const s = fresh(); s.rank = 40; s.points = 40;
  for (const id of ['blade_edge', 'blade_cleave', 'wall_bulk', 'wall_plate', 'plunder_gold', 'plunder_drop']) allocate(s, id, 6);
  const st = legendStats(s);
  expect(st.atkPct).toBeCloseTo(nodeValue(LEGEND_NODES.find((n: any) => n.id === 'blade_edge'), 6) + nodeValue(LEGEND_NODES.find((n: any) => n.id === 'blade_cleave'), 6), 8);
  expect(st.hpPct).toBeGreaterThan(0); expect(st.def).toBeGreaterThan(0);
  expect(st.flags).toHaveLength(8);
  const capped = fresh(); capped.rank = 100; capped.points = 100;
  allocate(capped, 'plunder_gold', LEGEND.maxNodeLevel); allocate(capped, 'plunder_drop', LEGEND.maxNodeLevel);
  expect(legendStats(capped).goldPct).toBeLessThanOrEqual(LEGEND.caps.goldPct);
  expect(legendStats(capped).dropPct).toBeLessThanOrEqual(LEGEND.caps.dropPct);
  expect(branchPoints(capped)).toMatchObject({ blade: 0, plunder: 2 * LEGEND.maxNodeLevel });
});

test('재분배는 골드를 내야 하고 부족하면 아무것도 바꾸지 않으며 점수를 모두 돌려준다', () => {
  const s = fresh(); s.rank = 12; s.points = 12;
  expect(respec(s, 1e9)).toMatchObject({ ok: false, error: 'empty', cost: 0 });
  allocate(s, 'blade_edge', 5); allocate(s, 'storm_radius', 4);
  const cost = LEGEND.respecBase + LEGEND.respecPerPoint * 9;
  expect(respecCost(s)).toBe(cost);
  const before = structuredClone(s);
  expect(respec(s, cost - 1)).toMatchObject({ ok: false, error: 'gold', cost }); expect(s).toEqual(before);
  expect(respec(s, NaN)).toMatchObject({ ok: false, error: 'gold' }); expect(s).toEqual(before);
  expect(respec(s, cost)).toMatchObject({ ok: true, cost, refunded: 9 });
  expect(s).toMatchObject({ rank: 12, points: 12, nodes: {} });
});

test('저장 정화: 손상 값·모르는 노드·점수 초과는 안전하게 버리고 points는 항상 rank - 사용 점수다', () => {
  expect(normalizeLegend(undefined)).toEqual({ version: 1, rank: 0, exp: 0, points: 0, nodes: {} });
  expect(normalizeLegend('x')).toEqual(normalizeLegend(null));
  expect(normalizeLegend({ rank: -4, exp: -9, points: 77 })).toMatchObject({ rank: 0, exp: 0, points: 0 });
  expect(normalizeLegend({ rank: 1.5, exp: NaN })).toMatchObject({ rank: 0, exp: 0 });
  expect(normalizeLegend({ rank: 60, points: 999, nodes: { blade_edge: 3, ghost: 5, wall_bulk: 99, ['__proto__']: 2 } }).nodes).toEqual({ blade_edge: 3, wall_bulk: LEGEND.maxNodeLevel });
  // 점수보다 많이 쓴 저장은 노드를 되돌려 준다
  expect(normalizeLegend({ rank: 4, nodes: { blade_edge: 3, wall_bulk: 3 } })).toMatchObject({ rank: 4, points: 4, nodes: {} });
  // 한 단계의 EXP가 필요량 이상이면 필요량 직전으로 맞춘다
  expect(normalizeLegend({ rank: 2, exp: 1e9 }).exp).toBe(legendExpFor(2) - 1);
  expect(normalizeLegend({ rank: 1e12 }).rank).toBe(LEGEND_MAX_RANK);
  const once = normalizeLegend({ rank: 9, exp: 5, nodes: { blade_edge: 4 } });
  expect(normalizeLegend(once)).toEqual(once);
});

test('save.js 마이그레이션: 전설 수련이 없는 옛 저장은 기본값에서 시작하고 두 번 이관해도 같다', () => {
  const eco = newEco();
  const legacy = { progress: { unlocked: 12, stars: {} }, gold: 4321 };
  const once = normalizeSave(legacy, eco.fresh()), twice = normalizeSave(once, eco.fresh());
  expect(once.legend).toEqual({ version: 1, rank: 0, exp: 0, points: 0, nodes: {} });
  expect(twice).toEqual(once);
  const hurt = normalizeSave({ ...legacy, legend: { rank: 'a', nodes: 3, exp: -1 } }, eco.fresh());
  expect(hurt.legend).toEqual(once.legend);
});

test('Lv.80 이후 EXP만 전설 수련으로 흘러간다(addHeroExp)', () => {
  const eco = newEco();
  const hero = eco.hero('knight');
  hero.level = 60;
  expect(eco.addHeroExp('knight', 5000, { silent: true })).toBeGreaterThanOrEqual(0);
  expect(eco.s.legend.rank).toBe(0); expect(eco.s.legend.exp).toBe(0);
  // 79 → 80 으로 넘기는 판: 남는 EXP가 전설 수련으로
  hero.level = 79; hero.exp = 0;
  const over = 4321;
  expect(eco.addHeroExp('knight', levelExp(79) + over, { silent: true })).toBe(1);
  expect(hero.level).toBe(HERO_LEVEL_CAP); expect(hero.exp).toBe(0);
  expect(eco.s.legend.exp).toBe(over);
  // 이미 80: 받은 EXP 전부가 전설 수련으로, 영웅 EXP는 0 으로 유지
  hero.exp = 999_999; // 옛 저장의 낡은 80레벨 잔여 EXP는 받지 않는다
  eco.addHeroExp('knight', LEGEND.baseExp, { silent: true });
  expect(hero.exp).toBe(0);
  expect(eco.s.legend).toMatchObject({ rank: 1, exp: over });
  expect(eco.s.legend.points).toBe(1);
  // 영웅이 달라도 계정 공통
  eco.hero('barbarian').level = 80;
  eco.addHeroExp('barbarian', 10, { silent: true });
  expect(eco.s.legend.exp).toBe(over + 10);
});

test('rpg-core grantCombatXp: Lv.80 처치 EXP는 overflow 로 돌려주고 영웅 레벨은 그대로다', () => {
  const curve = levelExp;
  const h = { level: 80, exp: 0 };
  expect(grantCombatXp(h, 321, curve)).toMatchObject({ gained: 0, levels: 0, overflow: 321 });
  expect(h).toEqual({ level: 80, exp: 0 });
  const g = { level: 79, exp: 0 };
  const r = grantCombatXp(g, curve(79) + 55, curve);
  expect(r).toMatchObject({ levels: 1, level: 80, overflow: 55 });
  const low = { level: 5, exp: 0 };
  expect(grantCombatXp(low, 10, curve).overflow).toBe(0);
});

test('전설 수련 판은 모든 영웅의 전투 스탯에 더해지고 키스톤 플래그를 전투가 읽을 수 있다', () => {
  const eco = newEco();
  const baseline = eco.heroBuildStats('knight');
  const baseBonus: any = eco.heroEquipBonus('knight');
  expect(baseBonus.legend).toBeUndefined();
  eco.s.legend = normalizeLegend({ rank: 30, nodes: {} });
  expect(eco.legendAllocate('blade_edge', 10)).toMatchObject({ ok: true, level: 10 });
  expect(eco.legendAllocate('wall_bulk', 10)).toMatchObject({ ok: true });
  expect(eco.legendAllocate('storm_radius', 4)).toMatchObject({ ok: true });
  const bonus: any = eco.heroEquipBonus('knight');
  expect(bonus.atkPct).toBeGreaterThan(baseBonus.atkPct); expect(bonus.hpPct).toBeGreaterThan(baseBonus.hpPct);
  expect(bonus.legend.flags).toContain('storm_afterswirl');
  expect(bonus.legend.radiusPct).toBeGreaterThan(0);
  const boosted = eco.heroBuildStats('knight');
  expect(boosted.atk).toBeGreaterThan(baseline.atk); expect(boosted.hp).toBeGreaterThan(baseline.hp); expect(boosted.power).toBeGreaterThan(baseline.power);
  expect(eco.heroBuildStats('barbarian').power).toBeGreaterThan(newEco().heroBuildStats('barbarian').power);
});

test('Economy 재분배: 골드를 차감하고 점수를 돌려주며 골드가 모자라면 거절한다', () => {
  const eco = newEco();
  eco.s.legend = normalizeLegend({ rank: 20 });
  eco.legendAllocate('blade_edge', 8);
  const cost = eco.legendRespecCost();
  expect(cost).toBe(LEGEND.respecBase + 8 * LEGEND.respecPerPoint);
  eco.s.gold = cost - 1;
  expect(eco.legendRespec()).toMatchObject({ ok: false, error: 'gold' });
  expect(eco.s.legend.nodes).toEqual({ blade_edge: 8 }); expect(eco.s.gold).toBe(cost - 1);
  eco.s.gold = cost + 77;
  expect(eco.legendRespec()).toMatchObject({ ok: true, cost, refunded: 8 });
  expect(eco.s.gold).toBe(77); expect(eco.s.legend).toMatchObject({ points: 20, nodes: {} });
});

test('정산 영수증에 전설 수련 EXP와 단계가 담긴다(completeStage)', () => {
  const eco = newEco();
  const hero = eco.hero('knight'); hero.level = 80; hero.exp = 0;
  const stage = eco.nextStage();
  const receipt = eco.completeStage(stage, 3);
  expect(receipt.legend).not.toBeNull();
  expect(receipt.legend.gained).toBe(receipt.totalExp);
  expect(eco.s.legend.exp + (eco.s.legend.rank > 0 ? 0 : 0)).toBeGreaterThanOrEqual(0);
  // Lv.80 미만이면 영수증에 legend 가 없다
  const lowEco = newEco();
  expect(lowEco.completeStage(lowEco.nextStage(), 3).legend).toBeNull();
});

test('저장하고 다시 불러와도 전설 수련 단계·EXP·노드가 그대로다', () => {
  const store = memory();
  const a = new Economy({ now: () => 1_800_000_000_000, storage: store, rng: () => .5 });
  a.s.legend = normalizeLegend({ rank: 20, exp: 12345 });
  expect(a.legendAllocate('blade_edge', 5)).toMatchObject({ ok: true });
  expect(a.legendAllocate('storm_vacuum', 2)).toMatchObject({ ok: true });
  const b = new Economy({ now: () => 1_800_000_000_000, storage: store, rng: () => .5 });
  expect(b.s.legend).toEqual({ version: 1, rank: 20, exp: 12345, points: 13, nodes: { blade_edge: 5, storm_vacuum: 2 } });
  expect(b.legendEffects().vacuumPct).toBeGreaterThan(0);
});
