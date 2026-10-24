import { expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { rewardNextAction } from '../src/game/reward-next-action.js';
import { recordTowerClear } from '../src/game/endgame-core.js';
import { grandfather } from './helpers/legacy-roster';

/** 재화·진행을 모두 비운 진짜 Economy. 각 테스트가 필요한 것만 채운다. */
function fresh() {
  const eco: any = grandfather(new Economy());
  Object.assign(eco.s, { gems: 0, tickets: 0, gold: 0, stones: 0, stones2: 0, stones3: 0 });
  eco.s.pass.xp = 0; eco.s.pass.claimedFree = [1]; // 1레벨 무료 보상은 처음부터 받을 수 있어 미리 받은 것으로 둔다
  return eco;
}
const wear = (eco: any, enh = 0) => {
  const heroId = eco.s.selected, inst = eco.addItem('R', 'weapon');
  inst.enh = enh; eco.s.heroes[heroId].equip.weapon = inst.uid; return { heroId, inst };
};
const run = (mode: string, got: any[], eco: any) => rewardNextAction({ mode: mode as any, got, eco });

test('캠페인: 보석을 벌고 소환 1회가 가능하면 영웅 배너 소환', () => {
  const eco = fresh(); eco.s.gems = 300;
  const a = run('campaign', [{ k: 'gems', n: 300 }], eco)!;
  expect(a.id).toBe('summon');
  expect(a.target).toEqual({ tab: 'gacha', banner: 'hero' });
  expect(a.hint).toBe('보석 300 → 영웅 소환 1회');
});

test('탑: 소환권을 벌면 소환권 1장으로 소환', () => {
  const eco = fresh(); eco.s.tickets = 2;
  const a = run('tower', [{ k: 'tickets', n: 2 }], eco)!;
  expect(a.id).toBe('summon');
  expect(a.hint).toBe('소환권 1 → 영웅 소환 1회');
});

test('보석이 모자라면 소환을 고르지 않고 비어 있으면 null', () => {
  const eco = fresh(); eco.s.gems = 299;
  expect(run('campaign', [{ k: 'gems', n: 299 }], eco)).toBeNull();
});

test('보석을 벌지 않았으면 소환이 가능해도 캠페인 1순위가 아니다', () => {
  const eco = fresh(); eco.s.gems = 900;
  expect(run('campaign', [{ k: 'gold', n: 500 }], eco)).toBeNull();
});

test('던전: 강화석을 벌고 착용 장비를 강화할 수 있으면 강화', () => {
  const eco = fresh(); eco.s.gold = 100000; eco.s.stones = 5;
  const { heroId, inst } = wear(eco, 3);
  const a = run('dungeon', [{ k: 'stones', n: 5 }], eco)!;
  expect(a.id).toBe('enhance');
  expect(a.target).toEqual({ tab: 'heroes', heroId, uid: inst.uid });
});

test('던전: 강화석이 부족하면 강화 대신 다른 갈래, 없으면 null', () => {
  const eco = fresh(); eco.s.gold = 100000; wear(eco, 3);
  expect(run('dungeon', [{ k: 'stones', n: 5 }], eco)).toBeNull();
});

test('던전: 강화석 없이도 보석이 있으면 폴백으로 소환', () => {
  const eco = fresh(); eco.s.gems = 300;
  expect(run('arena', [{ k: 'gold', n: 10 }], eco)?.id).toBe('summon');
});

test('패스 보상이 있으면 폴백으로 패스', () => {
  const eco = fresh(); eco.s.pass.xp = 250;
  const a = run('campaign', [{ k: 'gold', n: 10 }], eco)!;
  expect(a).toMatchObject({ id: 'pass', label: '패스 보상 받기', target: { tab: 'pass' } });
});

test('주간 보급 상자를 받을 수 있으면 패스보다 먼저 무한의 성으로', () => {
  const eco = fresh(); eco.s.pass.xp = 250;
  recordTowerClear(eco.s.endgame, { floor: 1, receiptId: 'r1', nowMs: Date.now() });
  const a = run('tower', [{ k: 'gold', n: 10 }], eco)!;
  expect(a.id).toBe('chest');
  expect(a.target).toEqual({ tab: 'journey', journeyTab: 'tower' });
});

test('캠페인 폴백: 패스가 없고 강화석이 있으면 강화', () => {
  const eco = fresh(); eco.s.gold = 100000; eco.s.stones = 5;
  const { heroId } = wear(eco, 3);
  const a = run('campaign', [{ k: 'gold', n: 10 }], eco)!;
  expect(a.id).toBe('enhance');
  expect(a.target.heroId).toBe(heroId);
});

test('어떤 모드·재화 조합에서도 목적지는 상점이 아니다', () => {
  const eco = fresh(); Object.assign(eco.s, { gems: 5000, tickets: 5, gold: 100000, stones: 9 }); eco.s.pass.xp = 500; wear(eco, 3);
  recordTowerClear(eco.s.endgame, { floor: 1, receiptId: 'r2', nowMs: Date.now() });
  for (const mode of ['campaign', 'tower', 'dungeon', 'arena']) {
    for (const got of [[], [{ k: 'gems', n: 1 }], [{ k: 'stones', n: 1 }], [{ k: 'tickets', n: 1 }]]) {
      const a = run(mode, got, eco);
      if (a) { expect(a.target.tab).not.toBe('shop'); expect(JSON.stringify(a)).not.toMatch(/shop|purchase|pay/i); }
    }
  }
});
