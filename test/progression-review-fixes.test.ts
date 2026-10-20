import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { HEROES } from '../src/data/heroes.js';
import { stageDef } from '../src/data/stages.js';

// 결제·보상 교차 리뷰(2026-10-19) P1·P2·P3 회귀 방지.
const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
  } });
});
afterEach(() => { if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else Reflect.deleteProperty(globalThis, 'localStorage'); });

// 기본 Q/E(4·5번)에 이미 들어 있지 않은 각성 스킬로 장착 검사를 한다.
const awakening = HEROES.knight.skills.findIndex(sk => (sk as any).awaken === 3);

test('레벨은 넘었지만 SP로 배우지 않은 각성 스킬은 Q/E에 넣을 수 없고, 배운 뒤에는 넣을 수 있다', () => {
  const eco = new Economy(), h = eco.hero('knight');
  h.level = 40;
  expect(h.skills[awakening]).toBe(0);
  expect(eco.setSkillLoadout('knight', 0, awakening)).toBe(false);
  expect(eco.learnSkill('knight', awakening)).toMatchObject({ ok: true, level: 1 });
  expect(eco.setSkillLoadout('knight', 0, awakening)).toBe(true);
  expect(eco.hero('knight').skillLoadout[0]).toBe(awakening);
});

test('초기화 뒤 비운 칸은 다시 장착하기 전까지 미습득 스킬로 채워지지 않는다', () => {
  const eco = new Economy(), h = eco.hero('knight');
  h.level = 19;
  h.level = 40;
  eco.learnSkill('knight', awakening);
  eco.setSkillLoadout('knight', 0, awakening);
  eco.s.skillResets = 1;
  expect(eco.resetSkills('knight')).toMatchObject({ ok: true, used: 'scroll' });
  expect(eco.hero('knight').skillLoadout[0]).toBe(-1);
  expect(new Economy().hero('knight').skillLoadout[0]).toBe(-1);
  expect(eco.setSkillLoadout('knight', 0, awakening)).toBe(false);
});

test('되돌릴 SP가 없으면 Lv.20 이상이어도 초기화서·보석을 쓰지 않는다', () => {
  const eco = new Economy(), h = eco.hero('knight');
  h.level = 25; eco.s.skillResets = 1; const gems = eco.s.gems;
  expect(eco.resetSkills('knight', { useGems: true })).toEqual({ ok: false, reason: 'nothing' });
  expect(eco.s.skillResets).toBe(1); expect(eco.s.gems).toBe(gems);
});

test('정산 장부 없이 넘어온 초월석·영웅 조각·지역 재료 숫자는 지급하지 않는다', () => {
  const eco = new Economy(), stage = stageDef(1, 1);
  const shards = eco.hero('knight').shards, stones = eco.s.transcendStones || 0;
  eco.completeStage(stage, 3, { fieldTranscendStones: 100, fieldHeroShards: 100, fieldMaterials: { glass_leaf: 1000 } });
  expect(eco.s.transcendStones || 0).toBe(stones);
  expect(eco.hero('knight').shards).toBe(shards);
  expect((eco.s.expedition.materials as any).glass_leaf || 0).toBe(0);
});

