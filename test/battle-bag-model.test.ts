import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { bagCompareLine, bagCounts, bagModel } from '../src/ui/battle-bag-model.js';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

const make = () => {
  const eco: any = new Economy(); eco.s = eco.fresh();
  const sel = eco.s.selected;
  // 다른 영웅 한 명을 만든다(장비 칸은 비어 있다).
  eco.s.heroes.mage = { ...JSON.parse(JSON.stringify(eco.s.heroes[sel])), equip: { weapon: null, armor: null, ring: null, boots: null } };
  return eco;
};

test('이번 판: 전투 시작 이후 들어온 장비만 최신 순, 다른 영웅 장비는 꼬리표와 개수로 구분', () => {
  const eco = make(), hero = eco.s.selected;
  const old = eco.pushItem('w_iron', { owner: hero });
  const start = eco.s.invSeq;
  const a = eco.pushItem('w_flame', { owner: hero }), b = eco.pushItem('w_hunter', { owner: 'mage' });
  expect(bagCounts(eco, start, hero)).toEqual({ fresh: 2, foreign: 1 });
  const m = bagModel(eco, { invSeqAtStart: start, heroId: hero });
  expect(m.run.map((r: any) => r.uid)).toEqual([b.uid, a.uid]);
  expect(m.run.every((r: any) => r.isNew)).toBe(true);
  const other = m.run[0], mine = m.run[1];
  expect(other.foreign).toBe(true); expect(other.ownerName.length).toBeGreaterThan(0); expect(other.line).toBe('');
  expect(mine.foreign).toBe(false); expect(mine.line).toContain('전투력');
  expect(m.run.some((r: any) => r.uid === old.uid)).toBe(false);
});

test('전체 가방: 출전 영웅 소유만, 등급 높은 순. 착용 중은 비교 대신 착용 중', () => {
  const eco = make(), hero = eco.s.selected;
  const low = eco.pushItem('w_iron', { owner: hero }), high = eco.pushItem('w_flame', { owner: hero });
  eco.pushItem('w_hunter', { owner: 'mage' });
  eco.equip(hero, low.uid);
  const m = bagModel(eco, { invSeqAtStart: undefined, heroId: hero });
  expect(m.all.map((r: any) => r.uid)).toEqual([high.uid, low.uid]);
  expect(m.all[1].equipped).toBe(true); expect(m.all[1].line).toBe('착용 중');
  expect(m.all[0].line.startsWith('▲')).toBe(true);
  expect(m.run).toEqual([]); expect(m.fresh).toBe(0);
});

test('금고 보관 장비와 알 수 없는 장비는 세지 않고, 시작 기준이 없으면 배지는 0', () => {
  const eco = make(), hero = eco.s.selected, start = eco.s.invSeq;
  const v = eco.pushItem('w_flame', { owner: hero }); v.owner = 'vault';
  eco.s.inventory.push({ uid: eco.s.invSeq++, id: 'no_such_item', enh: 0 });
  expect(bagCounts(eco, start, hero)).toEqual({ fresh: 0, foreign: 0 });
  expect(bagCounts(eco, undefined, hero)).toEqual({ fresh: 0, foreign: 0 });
  expect(bagCounts({ s: {} }, 1, hero)).toEqual({ fresh: 0, foreign: 0 });
});

test('비교 문구: 판매가는 쓰지 않는다', () => {
  expect(bagCompareLine({ verdict: 'better', powerDelta: 1200, sell: 5 } as any)).toBe('▲ 전투력 +1,200');
  expect(bagCompareLine({ verdict: 'worse', powerDelta: -30, sell: 5 } as any)).toBe('▼ 전투력 -30');
  expect(bagCompareLine({ verdict: 'same', powerDelta: 0, sell: 5 } as any)).toBe('= 전투력 같음');
  expect(bagCompareLine({ verdict: 'none', powerDelta: 0, sell: 5 } as any)).toBe('');
  expect(bagCompareLine(null)).toBe('');
});
