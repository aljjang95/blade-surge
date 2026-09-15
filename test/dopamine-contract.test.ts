import { expect, test } from 'bun:test';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { SKILLS } from '../src/game/skills.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { DEFAULT_SKILL_LOADOUT, normalizeSkillLoadout, skillIndexForCombatSlot } from '../src/game/progression.js';
const CAT:any=HEROES, IMPL:any=SKILLS;

test('all five heroes expose exactly eight skills', () => {
  expect(HERO_ORDER).toHaveLength(5);
  expect(HERO_ORDER.map(id=>CAT[id].skills.length)).toEqual([8,8,8,8,8]);
});

test('advanced active unlocks are fixed at level 35 and 50', () => {
  for(const id of HERO_ORDER) expect(CAT[id].skills.slice(6).map((s:any)=>s.unlock)).toEqual([35,50]);
});

test('awakening and advanced MP costs follow the progression contract', () => {
  for(const id of HERO_ORDER) expect(CAT[id].skills.slice(4).map((s:any)=>s.mp)).toEqual([26,34,38,52]);
});

test('all ten level 35 and 50 skill implementations resolve', () => {
  const ids=HERO_ORDER.flatMap(id=>CAT[id].skills.slice(6).map((s:any)=>s.id));
  expect(ids).toHaveLength(10);
  for(const id of ids) expect(IMPL[id]).toBeDefined();
});

test('legacy and malformed loadouts fall back to Q=4 E=5', () => {
  expect(DEFAULT_SKILL_LOADOUT).toEqual([4,5]);
  expect(normalizeSkillLoadout(HEROES.knight, undefined)).toEqual([4,5]);
  expect(normalizeSkillLoadout(HEROES.knight, [99,99])).toEqual([4,5]);
});

test('valid advanced underlying indexes survive normalization', () => {
  expect(normalizeSkillLoadout(HEROES.mage,[6,7])).toEqual([6,7]);
  expect(normalizeSkillLoadout(HEROES.rogue,[7,6])).toEqual([7,6]);
});

test('combat slots 0-3 stay fixed while Q and E use loadout indexes', () => {
  const loadout=[7,6];
  expect([0,1,2,3,4,5].map(slot=>skillIndexForCombatSlot(loadout,slot))).toEqual([0,1,2,3,7,6]);
});

test('fresh hero state contains eight skill levels and the legacy-compatible loadout', () => {
  const eco=new Economy();
  for(const id of HERO_ORDER) {
    expect(eco.hero(id).skills).toHaveLength(8);
    expect(eco.hero(id).skillLoadout).toEqual([4,5]);
  }
});

test('legacy six-skill saves migrate forward without losing trained levels', () => {
  const eco=new Economy(), fresh=eco.fresh(), raw=structuredClone(fresh);
  raw.heroes.knight.skills=[4,3,2,1,2,1]; delete (raw.heroes.knight as any).skillLoadout;
  const migrated=normalizeSave(raw,fresh);
  expect(migrated.heroes.knight.skills).toEqual([4,3,2,1,2,1,1,1]);
  expect(migrated.heroes.knight.skillLoadout).toEqual([4,5]);
});

test('unlocked Q and E selections persist as underlying indexes', () => {
  const eco=new Economy(); eco.hero('knight').level=50;
  expect(eco.setSkillLoadout('knight',0,6)).toBe(true);
  expect(eco.setSkillLoadout('knight',1,7)).toBe(true);
  expect(eco.hero('knight').skillLoadout).toEqual([6,7]);
});

test('loadout setter rejects locked skills and atomically swaps Q/E', () => {
  const eco=new Economy(); eco.hero('knight').level=34;
  expect(eco.setSkillLoadout('knight',0,6)).toBe(false);
  eco.hero('knight').level=50;
  expect(eco.setSkillLoadout('knight',0,5)).toBe(true);
  expect(eco.hero('knight').skillLoadout).toEqual([5,4]);
});

test('full clear bonuses are additive and normal clears keep base rewards', () => {
  const fullEco=new Economy(), normalEco=new Economy();
  const fullStage=fullEco.nextStage(), normalStage=normalEco.nextStage();
  const full=fullEco.completeStage(fullStage,3,{fullClear:true});
  const normal=normalEco.completeStage(normalStage,3);
  const amount=(r:any,k:string)=>r.got.find((g:any)=>g.k===k)?.n||0;
  expect(full.exp-normal.exp).toBe(Math.floor(fullStage.rewards.exp*.5));
  expect(amount(full,'gold')-amount(normal,'gold')).toBe(Math.floor(fullStage.rewards.gold*.4));
  expect(amount(full,'fragments')-amount(normal,'fragments')).toBe(10);
  expect(full.loot.length-normal.loot.length).toBe(1);
  expect(full.fullClearBonus).toMatchObject({fragments:10,eliteGear:1});
  expect(normal.fullClearBonus).toBeNull();
});