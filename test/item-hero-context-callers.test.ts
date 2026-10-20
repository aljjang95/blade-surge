import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { Meta } from '../src/ui/meta.js';
import { buildInventoryModel } from '../src/ui/maple-inventory.js';

// 최종 리뷰 P2-1·P3-c: 세트 제작 창과 I 창 그림이 '그 화면이 다루는 영웅'의 실제 무기 형태를 쓰는지 실제 표현 경로로 확인한다.
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

function craftMarkup(displayed: string, selected: string) {
  let html = '';
  const meta: any = Object.create(Meta.prototype);
  meta.eco = { s: { fragments: 0, inventory: [], selected } };
  meta.ui = { modal: (markup: string) => { html = markup; } };
  meta.showCraft(displayed);
  const cell = html.match(/data-craft="storm:weapon"[^>]*>(<img[^>]*>)/);
  return { cell: cell?.[1] || '', html };
}

test('set crafting draws the weapon in the displayed hero form, not the deployed hero form', () => {
  const knightView = craftMarkup('knight', 'ranger');
  expect(knightView.cell).toContain('/img/item-renders/forms/w_storm--greatsword.webp');
  expect(knightView.cell).toContain('data-item-hero="knight"');
  const rangerView = craftMarkup('ranger', 'knight');
  expect(rangerView.cell).toContain('/img/item-renders/forms/w_storm--bow.webp');
  expect(rangerView.cell).toContain('data-item-form="bow"');
  // 무기가 아닌 부위는 영웅 형태와 무관한 기본 그림이다.
  expect(knightView.html.match(/data-craft="storm:armor"[^>]*>(<img[^>]*>)/)?.[1]).not.toContain('/forms/');
});

test('inventory cells use the same hero context as the sheet they open (owner, else deployed hero)', () => {
  const eco: any = new Economy(); eco.s = eco.fresh(); eco.s.selected = 'ranger';
  const worn = { uid: eco.s.invSeq++, id: 'w_storm', enh: 0 }, loose = { uid: eco.s.invSeq++, id: 'w_storm', enh: 0 };
  eco.s.inventory.push(worn, loose);
  eco.s.heroes.knight.equip.weapon = worn.uid;
  const cells = buildInventoryModel(eco, { tab: 'gear' }).cells;
  const byUid = Object.fromEntries(cells.map((c: any) => [c.uid, c]));
  expect(byUid[worn.uid].owner).toBe('knight');
  expect(byUid[worn.uid].icon).toBe('/img/item-renders/forms/w_storm--greatsword.webp');
  expect(byUid[loose.uid].icon).toBe('/img/item-renders/forms/w_storm--bow.webp');
});

