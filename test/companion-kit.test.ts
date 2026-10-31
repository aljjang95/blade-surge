import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { EconomyCore, createMemoryStorage } from '../src/game/economy-core.js';
import { ITEM_BY_ID, SLOTS } from '../src/data/items.js';
import { stageDef } from '../src/data/stages.js';
import { dropItemLevel } from '../src/data/loot-tables.js';
import { createSeededRng } from '../src/shared/rng.js';

const T0 = 1_700_000_000_000;
const lead = () => { const eco: any = new Economy({ storage: createMemoryStorage(), now: () => T0 }); expect(eco.chooseStarter('knight').ok).toBe(true); eco.s.progress.unlocked = 20; eco.s.heroes.knight.level = 33; return eco; };

describe('캠페인 합류 동료 시작 장비', () => {
  test('2-10 합류 마법사는 부위마다 E·강화0·il=3-1 드랍 레벨·본인 소유로 낀 채 오고 첫 출전 전투력이 3-1 권장의 0.95~1.1배다', () => {
    const eco = lead();
    expect(eco.grantCampaignHeroes(20)).toEqual(['mage']);
    const il = dropItemLevel({ ch: 3, st: 1 }), mage = eco.s.heroes.mage;
    expect(il).toBeGreaterThan(1);
    for (const slot of SLOTS) {
      const inst = eco.s.inventory.find((x: any) => x.uid === mage.equip[slot]);
      expect(inst).toBeTruthy();
      expect((ITEM_BY_ID as any)[inst.id]).toMatchObject({ rarity: 'E', slot });
      expect(inst).toMatchObject({ enh: 0, il, owner: 'mage' });
    }
    expect(eco.heroBag('mage')).toHaveLength(4);
    expect(eco.heroBag('knight')).toHaveLength(eco.s.inventory.filter((x: any) => x.owner === 'knight').length);
    const ratio = eco.heroPower('mage') / stageDef(3, 1).recPower;
    expect(ratio).toBeGreaterThanOrEqual(0.95); expect(ratio).toBeLessThanOrEqual(1.1);
  });
  test('결정적: 난수 없이 두 번 만들면 같은 장비·상태, 다시 불러도 중복 지급 없음', () => {
    const random = Math.random; Math.random = () => { throw new Error('Math.random 사용'); };
    try {
      const a = lead(), b = lead(); a.grantCampaignHeroes(20); b.grantCampaignHeroes(20);
      expect(a.s.inventory).toEqual(b.s.inventory); expect(a.s.heroes.mage.equip).toEqual(b.s.heroes.mage.equip);
      const n = a.s.inventory.length; expect(a.grantCampaignHeroes(20)).toEqual([]); expect(a.s.inventory).toHaveLength(n);
    } finally { Math.random = random; }
  });
  test('나중 합류(3-10 로그)도 다음 관문 il 로 받고, 소환·무료 해금 영웅은 키트가 없다', () => {
    const eco = lead(); eco.grantCampaignHeroes(20);
    expect(eco.grantCampaignHeroes(30)).toEqual(['rogue']);
    for (const slot of SLOTS) expect(eco.s.inventory.find((x: any) => x.uid === eco.s.heroes.rogue.equip[slot])).toMatchObject({ owner: 'rogue', il: dropItemLevel({ ch: 4, st: 1 }) });
    const free = lead(); free.s.heroes.ranger.level = 1;
    free.s.roster.owned = [...free.s.roster.owned, 'ranger'];   // 소환·상품 경로: 합류 호출 없음
    expect(free.heroBag('ranger')).toHaveLength(0); expect(Object.values(free.s.heroes.ranger.equip as Record<string, unknown>).every((v) => !v)).toBe(true);
  });
  test('서버 정산 경로(EconomyCore.completeStage)도 같은 장비를 같은 상태 해시로 지급한다', () => {
    const run = () => {
      const base = lead(); const snap = base.snapshot?.() ?? JSON.parse(JSON.stringify(base.s));
      const core: any = EconomyCore.fromState(snap, { now: () => T0, rng: createSeededRng(5), gachaRng: createSeededRng(6) });
      core.completeStage(stageDef(2, 10), 3, {});
      return core;
    };
    const a = run(), b = run();
    expect(a.stateHash()).toBe(b.stateHash());
    const mage = a.snapshot().heroes.mage;
    expect(SLOTS.every((s) => mage.equip[s])).toBe(true);
    expect(a.snapshot().inventory.filter((x: any) => x.owner === 'mage')).toHaveLength(4);
    expect(a.snapshot().roster.owned).toContain('mage');
  });
});
