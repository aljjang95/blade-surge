import { describe, expect, test } from 'bun:test';
import { GROWTH_FLOW, skuFlowRole, shortageRoutes, shardProgress, paceLabel } from '../src/data/growth-flow.js';
import { ECONOMY_PACE } from '../src/data/economy-pace.js';
import { SKUS, GACHA } from '../src/data/shop.js';
import { HEROES } from '../src/data/heroes.js';
import { GRADE_UP_COST } from '../src/data/hero-grades.js';

const sku = (id: string) => SKUS.find((s) => s.id === id);

describe('성장 흐름 계약', () => {
  test('보석 → 소환 → 중복 조각 → 초월 → 더 강한 전투 순서', () => {
    expect(GROWTH_FLOW.map((s) => s.id)).toEqual(['gems', 'summon', 'shards', 'transcend', 'battle']);
  });
  test('상품 용도: 초월석·초기화서·보석·골드', () => {
    expect(skuFlowRole(sku('tstone10'))?.role).toBe('transcend');
    expect(skuFlowRole(sku('skill_reset1'))?.role).toBe('reset');
    expect(skuFlowRole(sku('skill_reset5'))?.role).toBe('reset');
    expect(skuFlowRole(sku('gem2'))).toEqual({ role: 'summon', label: `소환 ${Math.floor(980 / GACHA.single)}회분 · 중복 영웅은 초월 조각` });
    expect(skuFlowRole(sku('starter'))?.role).toBe('summon');
    expect(skuFlowRole(sku('growth'))?.role).toBe('transcend');
    expect(skuFlowRole(sku('gold2'))?.role).toBe('gold');
    expect(skuFlowRole(sku('stone1'))?.role).toBe('gear');
    expect(skuFlowRole(sku('en1'))?.role).toBe('energy');
    for (const s of SKUS) expect(skuFlowRole(s)).not.toBeNull();
  });
  test('부족 재료마다 구할 곳', () => {
    const cost = { ...GRADE_UP_COST.SSR };
    const q = { grade: 'SR', next: 'SSR', cost, have: { shards: 10, transcendStones: 10, gold: 0 } };
    expect(shortageRoutes(q).map((r) => [r.key, r.route])).toEqual([['shards', 'gacha'], ['gold', 'shop-gold']]);
    expect(shortageRoutes({ ...q, have: { shards: cost.shards, transcendStones: 0, gold: cost.gold } }).map((r) => r.route)).toEqual(['shop-enh']);
    expect(shortageRoutes({ grade: 'SSSR', next: null, cost: null, have: {} })).toEqual([]);
  });
  test('조각 진행: 시작 등급 기준 다음 초월 필요량', () => {
    expect(shardProgress(HEROES.mage, { shards: 30 })).toMatchObject({ have: 30, need: GRADE_UP_COST.SSR.shards, grade: 'SR', next: 'SSR' });
    expect(shardProgress(HEROES.knight, { shards: 5 })).toMatchObject({ need: GRADE_UP_COST.SSSR.shards, grade: 'SSR', next: 'SSSR' });
    expect(shardProgress(HEROES.mage, { shards: 0, grade: 'SSSR' })).toMatchObject({ need: null, next: null });
  });
  test('단축 문구는 실제 상품 대상·무료 기준과 일치하며 영향 없는 상품은 표시하지 않는다', () => {
    for (const [key, row] of Object.entries(ECONOMY_PACE.savings)) {
      const label = paceLabel(key);
      if (row.days <= 0) { expect(label).toBeNull(); continue; }
      expect(label).toContain(row.target);
      expect(label).toContain(`약 ${row.freeDays}일`);
      expect(label).toContain(`약 ${row.withDays}일`);
      expect(label).toContain('스토리 30분/일·별 승급 제외 예상');
    }
    expect(paceLabel('ssrTicket')).toContain('픽업 SSR→SSSR');
    expect(paceLabel('알수없는상품')).toBeNull();
    expect(paceLabel('constructor')).toBeNull();
    expect(paceLabel('toString')).toBeNull();
  });
});
