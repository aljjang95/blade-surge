import { describe, expect, test } from 'bun:test';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { heroCompare, HERO_DIFFICULTY, HERO_TRAITS } from '../src/data/hero-traits.js';

describe('영웅 비교 막대', () => {
  test('다섯 영웅 모두 특성·난이도가 정의돼 있다', () => {
    for (const id of HERO_ORDER) { expect((HERO_TRAITS as any)[id]).toBeDefined(); expect([1, 2, 3]).toContain((HERO_DIFFICULTY as any)[id]); }
  });
  test('공격·생존은 0~1 로 정규화되고 각각 최댓값 영웅이 1 이다', () => {
    const all = HERO_ORDER.map((id) => heroCompare(id)!);
    for (const c of all) { expect(c.attack).toBeGreaterThan(0); expect(c.attack).toBeLessThanOrEqual(1); expect(c.survival).toBeGreaterThan(0); expect(c.survival).toBeLessThanOrEqual(1); }
    expect(Math.max(...all.map((c) => c.attack))).toBe(1); expect(Math.max(...all.map((c) => c.survival))).toBe(1);
  });
  test('공격은 base.atk 순서, 생존은 체력·방어 순서를 따른다', () => {
    const atk = (id: string) => heroCompare(id)!.attack;
    expect(atk('mage')).toBe(1); expect(atk('knight')).toBeLessThan(atk('barbarian'));
    expect(heroCompare('barbarian')!.survival).toBe(1);
    expect(heroCompare('mage')!.survival).toBeLessThan(heroCompare('knight')!.survival);
  });
  test('난이도 막대는 별 개수에 비례하고 모르는 영웅은 null', () => {
    expect(heroCompare('rogue')!.difficultyBar).toBe(1); expect(heroCompare('knight')!.difficultyBar).toBeCloseTo(1 / 3);
    expect(heroCompare('nobody')).toBeNull();
    expect(Object.keys(HEROES).length).toBe(7);   // 원래 다섯 + 소환 전용 SSR 늑대인간 족장·검은 고양이 사냥꾼
  });
});
