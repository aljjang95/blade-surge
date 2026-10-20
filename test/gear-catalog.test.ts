import { expect, setDefaultTimeout, test } from 'bun:test';
// 실제 자식 프로세스·렌더를 쓰므로 PC가 바쁠 때 기본 5초 제한에 걸리지 않게 한다.
setDefaultTimeout(30_000);
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { GEAR_ITEMS, gearLook, LEGACY_LOOKS, SHAPE_AXES, shapeKey } from '../src/data/gear-catalog.js';
import { ITEM_BY_ID, ITEM_POOL, SLOTS, SLOT_BASE, RARITY_INFO } from '../src/data/items.js';
import { Economy, gachaContents } from '../src/game/economy.js';
import { armorStyle } from '../src/game/armor-appearance.js';
import { weaponLook, weaponLookText, WEAPON_ELEMENT } from '../src/data/weapon-looks.js';
import { LOOKS } from '../src/game/look.js';

const items = ITEM_BY_ID as Record<string, any>;
test('신규 48종은 부위·등급마다 3개이며 기존 수치 공식과 등급 세트를 따른다', () => {
  expect(GEAR_ITEMS).toHaveLength(48);
  expect(new Set(GEAR_ITEMS.map(item => item.id)).size).toBe(48);
  for (const slot of SLOTS) for (const rarity of ['N', 'S', 'E', 'L']) {
    expect(GEAR_ITEMS.filter(item => item.slot === slot && item.rarity === rarity)).toHaveLength(3);
  }
  for (const item of GEAR_ITEMS) {
    const base = (SLOT_BASE as any)[item.slot], mult = (RARITY_INFO as any)[item.rarity].mult;
    for (const stat of Object.keys(base).filter(stat => stat !== 'crit')) expect(items[item.id][stat]).toBe(Math.round(base[stat] * mult));
    expect(items[item.id].set).toBe(({ N: 'recruit', S: 'merc', E: 'knight', L: 'dragon' } as any)[item.rarity]);
  }
});

test('무기·반지·신발은 해시 폴백 장비까지 형상 축만으로 같은 부위 안에서 고유하다', () => {
  for (const slot of Object.keys(SHAPE_AXES) as ('weapon' | 'ring' | 'boots')[]) {
    const entries = Object.values(items).filter(item => item.slot === slot);
    // 길이·반지름 같은 연속값과 팔레트는 제외한다. 색만 다른 같은 실루엣은 실패해야 한다.
    const owners = new Map<string, string>();
    for (const item of entries) {
      const look = (gearLook(item) as any)[slot];
      for (const [key, values] of (SHAPE_AXES as any)[slot]) expect(values).toContain(look[key]);
      const key = shapeKey(slot, look);
      expect(owners.has(key) ? `${owners.get(key)} = ${item.id} (${key})` : '').toBe('');
      owners.set(key, item.id);
    }
    expect(entries.some(item => /^(arm|sg|exp)_/.test(item.id))).toBe(true);
  }
});

test('발광·궤적색은 명시 속성 무기만 속성색이고, 신규 무기 속성명은 아이템 이름이 아니다', () => {
  for (const id of ['w_iron', 'w_rusty', 'w_cleaver', 'arm_anchor_weapon']) {
    const look = weaponLook('knight', { id, enh: 0 }, LOOKS)!;
    expect(look.color).toBe((RARITY_INFO as any)[items[id].rarity].color);
  }
  for (const item of GEAR_ITEMS.filter(item => item.slot === 'weapon')) {
    const [color, element] = (WEAPON_ELEMENT as any)[item.id];
    expect(color).toBe((item.look as any).weapon.palette.accent);
    expect(element).not.toBe(item.name); expect(element.length).toBeGreaterThan(0);
  }
  expect(weaponLookText(weaponLook('knight', { id: 'gear_weapon_s_2', enh: 0 }, LOOKS))).toBe('한손검 · 숲 발광');
});

test('모든 부위 외형 시그니처는 고유하며 정본 밖 ID도 결정적이다', () => {
  for (const slot of SLOTS) {
    const entries = Object.values(items).filter(item => item.slot === slot && (slot !== 'armor' || item.icon?.startsWith('/img/gear/')));
    const signature = (item: any) => JSON.stringify(slot === 'armor' && !item.look?.armor ? armorStyle(item, 'knight') : gearLook(item));
    expect(new Set(entries.map(signature)).size).toBe(entries.length);
  }
  expect((LEGACY_LOOKS as any).w_iron).toBeDefined();
  expect((LEGACY_LOOKS as any).a_knight).toBeUndefined(); expect(gearLook(items.a_knight)).toEqual({});
  const unknown = { id: 'unknown_gear', slot: 'weapon' };
  const random = Math.random;
  try {
    Math.random = () => { throw Error('외형은 난수를 소비하면 안 된다'); };
    expect(gearLook(unknown)).toEqual(gearLook({ ...unknown }));
  } finally { Math.random = random; }
});

test('실제 보상·장착·강화·저장 재로딩이 신규 48종의 UID와 강화 단계를 보존한다', () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
  try {
    const eco = new Economy(); eco.s.gold = 1_000_000;
    const contents = gachaContents();
    for (const item of GEAR_ITEMS) {
      const pool = (ITEM_POOL as any)[item.slot].filter((entry: any) => entry.rarity === item.rarity);
      const inst = eco.addItem(item.rarity, item.slot, () => (pool.findIndex((entry: any) => entry.id === item.id) + .5) / pool.length);
      expect(inst.id).toBe(item.id); eco.equip('knight', inst.uid);
      expect(eco.enhance(inst.uid).ok).toBe(true); expect(inst.enh).toBe(1);
      const equipped = eco.heroEquipInsts('knight') as any;
      expect(equipped[item.slot]).toEqual(inst);
      const loaded = new Economy();
      expect(loaded.s.inventory.find((entry: any) => entry.uid === inst.uid)).toEqual(inst);
      expect((loaded.heroEquipInsts('knight') as any)[item.slot]).toEqual(inst);
      if (item.rarity !== 'N') expect(contents.some((entry: any) => entry.id === item.id)).toBe(true);
    }
    expect(new Economy().s.inventory).toHaveLength(48);
  } finally { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('모든 일반 장비 아이콘은 현재 소스로 렌더한 256px 투명 WebP이며 프레임을 채운다', async () => {
  // 개발 산출물은 public 밖(work/gear-review)에 둔다. 추적 매니페스트로 아이콘과 렌더 소스의 일치만 확인한다.
  const receipt = JSON.parse(readFileSync('tools/art/gear-icon-studio.manifest.json', 'utf8'));
  const targets = Object.values(items).filter(item => item.icon?.startsWith('/img/gear/'));
  expect(receipt.items).toHaveLength(targets.length);
  // 렌더 소스 해시는 줄바꿈을 LF 로 정규화한 내용 기준이다(autocrlf 체크아웃 차이를 무시).
  for (const [path, hash] of Object.entries(receipt.sourceHashes)) expect(createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex')).toBe(hash as string);
  const hashes = new Set<string>();
  for (const item of targets) {
    const bytes = readFileSync(`public${item.icon}`), metadata = await sharp(bytes).metadata(), stats = await sharp(bytes).stats();
    expect(metadata.format).toBe('webp'); expect(metadata.width).toBe(256); expect(metadata.height).toBe(256); expect(metadata.hasAlpha).toBe(true);
    expect(stats.channels[3].min).toBe(0); expect(stats.channels[3].max).toBeGreaterThan(0);
    const hash = createHash('sha256').update(bytes).digest('hex'); hashes.add(hash);
    expect(receipt.items.find((entry: any) => entry.id === item.id)?.sha256).toBe(hash);
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = 256, top = 256, right = 0, bottom = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (data[(y * 256 + x) * 4 + 3] > 16) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    const occupancy = Math.max(right - left + 1, bottom - top + 1) / 256;
    expect(occupancy).toBeGreaterThan(.78); expect(occupancy).toBeLessThan(.9);
  }
  expect(hashes.size).toBe(targets.length);
  for (const name of ['_review.webp', 'render-receipt.json', 'runtime-receipt.json']) expect(existsSync(`public/img/gear/${name}`)).toBe(false);
});
