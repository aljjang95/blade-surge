// 장비 등급 순서 불변식(2026-10-29 신고: 유니크 반지가 하위 등급 반지보다 전투력이 낮게 나옴).
// 같은 부위·같은 단계(스테이지 장비 레벨 il)·같은 강화면 등급이 높은 장비가 언제나 더 높은 장비 점수를 낸다.
import { expect, test } from 'bun:test';
import { ITEM_BY_ID, SLOTS, RARITIES } from '../src/data/items.js';
import { gearScore } from '../src/game/gear-advice.js';

const LEVELS = [0, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80];
const ENH = [0, 1, 5, 10, 15, 20];

test('같은 부위·단계·강화면 등급이 높을수록 장비 점수가 높다', () => {
  const broken: string[] = [];
  for (const slot of SLOTS) {
    const defs = Object.values(ITEM_BY_ID).filter((d: any) => d.slot === slot) as any[];
    for (const il of LEVELS) for (const enh of ENH) {
      const score = (d: any) => gearScore({ id: d.id, enh, ...(il ? { il } : {}) });
      for (let r = 0; r + 1 < RARITIES.length; r++) {
        const low = defs.filter((d) => d.rarity === RARITIES[r]), high = defs.filter((d) => d.rarity === RARITIES[r + 1]);
        if (!low.length || !high.length) continue;
        const best = low.reduce((a, d) => (score(d) > score(a) ? d : a)), worst = high.reduce((a, d) => (score(d) < score(a) ? d : a));
        if (score(worst) <= score(best)) broken.push(`${slot} il${il} +${enh}: ${worst.id}(${RARITIES[r + 1]}) ${score(worst)} <= ${best.id}(${RARITIES[r]}) ${score(best)}`);
      }
    }
  }
  expect(broken).toEqual([]);
});

import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { progressItemLevel } from '../src/data/loot-tables.js';
import { betterItems } from '../src/game/gear-advice.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const newEco = () => new Economy({ now: () => 1_800_000_000_000, storage: memory(), rng: () => .5 });

test('스테이지 없는 획득(가챠·보상)은 지금까지 깬 관문의 장비 레벨을 받는다', () => {
  const eco = newEco();
  expect((eco.addItem('U', 'ring', () => .1) as any).il).toBeUndefined();   // 아직 깬 관문이 없다
  eco.s.progress.unlocked = 16;   // 2-5 까지 깸
  const il = progressItemLevel(eco.s.progress);
  expect(il).toBeGreaterThan(1);
  expect((eco.addItem('U', 'ring', () => .1) as any).il).toBe(il);
  expect((eco.pushItem('r_phoenix') as any).il).toBe(il);
  expect((eco.addItem('S', 'ring', () => .1, 0, eco.s.selected, 0) as any).il).toBeUndefined();   // 필드 드랍이 명시한 0 은 그대로
});

test('il 도입 전 장비는 한 번 이월되고, 이월 뒤 하위 등급 필드 드랍이 유니크를 앞서지 않는다(신고 재현)', () => {
  const eco = newEco(), hero = eco.s.selected;
  const raw: any = JSON.parse(JSON.stringify(eco.s));
  raw.progress.unlocked = 16; delete raw.gearIl;
  raw.inventory = [{ uid: 900, id: 'r_phoenix', enh: 1, owner: hero }, { uid: 901, id: 'gear_ring_e_1', enh: 0, il: progressItemLevel(raw.progress), owner: hero },
    { uid: 902, id: 'gear_ring_s_1', enh: 0, il: progressItemLevel(raw.progress), owner: hero }, { uid: 903, id: 'r_wood', enh: 0, owner: hero }];
  raw.heroes[hero].equip = { ...raw.heroes[hero].equip, ring: 900 };
  raw.invSeq = 1000;
  const s: any = normalizeSave(raw, eco.fresh());
  expect(s.gearIl).toBe(1);
  expect(s.inventory.find((x: any) => x.uid === 900).il).toBe(progressItemLevel(raw.progress));
  // 이월은 한 번뿐: 다시 정화해도 그대로
  expect(normalizeSave(JSON.parse(JSON.stringify(s)), eco.fresh()).inventory).toEqual(s.inventory);
  eco.s = s;
  const better = betterItems(eco, hero);
  for (const uid of [901, 902, 903]) expect(better.has(uid)).toBe(false);
});
