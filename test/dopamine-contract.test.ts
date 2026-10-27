import { expect, test } from 'bun:test';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { SKILLS } from '../src/game/skills.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save.js';
import { DEFAULT_SKILL_LOADOUT, normalizeSkillLoadout, skillIndexForCombatSlot } from '../src/game/progression.js';
const CAT:any=HEROES, IMPL:any=SKILLS;

test('all seven heroes (five + summon-only werewolf and blackcat) expose exactly eight skills', () => {
  expect(HERO_ORDER).toHaveLength(7);
  expect(HERO_ORDER.map(id=>CAT[id].skills.length)).toEqual([8,8,8,8,8,8,8]);
});

test('knight awakening III opens at PRD level 30; other advanced unlocks retain their progression', () => {
  for(const id of HERO_ORDER) expect(CAT[id].skills.slice(6).map((s:any)=>s.unlock)).toEqual(id === 'knight' ? [30,50] : [35,50]);
});

test('awakening and advanced MP costs follow the progression contract', () => {
  for(const id of HERO_ORDER) expect(CAT[id].skills.slice(4).map((s:any)=>s.mp)).toEqual([26,34,38,52]);
});

test('all fourteen advanced skill implementations resolve', () => {
  const ids=HERO_ORDER.flatMap(id=>CAT[id].skills.slice(6).map((s:any)=>s.id));
  expect(ids).toHaveLength(14);
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
  // 저장소가 없는 테스트 환경이라 저장 성공으로 둔다(습득 규칙만 검사).
  const eco=new Economy(); eco.save=()=>true; eco.hero('knight').level=50;
  // 각성 스킬은 레벨 해금 뒤 SP로 배워야 Q/E에 넣을 수 있다.
  for (const i of [6,7]) expect(eco.learnSkill('knight',i)).toMatchObject({ok:true});
  // 저장된 [4,5]는 아직 배우지 않은 칸이라, 첫 장착 때 배운 스킬로 채워 [6,7]로 정리된다.
  expect(eco.setSkillLoadout('knight',0,6)).toBe(true);
  expect(eco.hero('knight').skillLoadout).toEqual([6,7]);
  // 이미 그 칸에 있는 스킬을 다시 고르면 바뀐 것이 없어 false(화면은 아무것도 하지 않는다).
  expect(eco.setSkillLoadout('knight',1,7)).toBe(false);
  // 다른 칸의 스킬을 고르면 서로 바뀌고 그 인덱스로 저장된다.
  expect(eco.setSkillLoadout('knight',0,7)).toBe(true);
  expect(eco.hero('knight').skillLoadout).toEqual([7,6]);
});

test('loadout setter rejects locked skills and atomically swaps Q/E', () => {
  const eco=new Economy(); eco.save=()=>true; eco.hero('knight').level=29;
  expect(eco.setSkillLoadout('knight',0,6)).toBe(false);
  eco.hero('knight').level=50;
  expect(eco.setSkillLoadout('knight',0,6)).toBe(false);
  for (const i of [4,5]) expect(eco.learnSkill('knight',i)).toMatchObject({ok:true});
  expect(eco.setSkillLoadout('knight',0,5)).toBe(true);
  expect(eco.hero('knight').skillLoadout).toEqual([5,4]);
});

// 규칙 시계 고정: 시즌 1 시작(2026-10-26 05:00 KST) 전에는 이벤트가 없고, 첫 주(W1 출정식)에는 캠페인 완료 골드가 ×1.5다.
const PRE_SEASON = Date.UTC(2026, 9, 20, 3);
const MUSTER_WEEK = Date.UTC(2026, 9, 27, 3);
test.each([['시즌 전(이벤트 없음)', PRE_SEASON, 1], ['시즌 1 출정식 주(캠페인 완료 골드 ×1.5)', MUSTER_WEEK, 1.5]] as const)('full clear bonuses are additive and normal clears keep base rewards: %s', (_name, at, goldMul) => {
  const fullEco=new Economy({now:()=>at}), normalEco=new Economy({now:()=>at});
  const fullStage=fullEco.nextStage(), normalStage=normalEco.nextStage();
  const full=fullEco.completeStage(fullStage,3,{fullClear:true});
  const normal=normalEco.completeStage(normalStage,3);
  const amount=(r:any,k:string)=>r.got.find((g:any)=>g.k===k)?.n||0;
  const eventGold=Math.floor(fullStage.rewards.gold*goldMul); // 이벤트 배율은 완료 골드에 먼저 붙고, 전체 클리어 보너스는 그 40%
  expect(full.exp-normal.exp).toBe(Math.floor(fullStage.rewards.exp*.5));
  expect(amount(full,'gold')-amount(normal,'gold')).toBe(Math.floor(eventGold*.4));
  expect(amount(full,'fragments')-amount(normal,'fragments')).toBe(10);
  expect(full.loot.length-normal.loot.length).toBe(1);
  expect(full.fullClearBonus).toMatchObject({fragments:10,eliteGear:1});
  expect(normal.fullClearBonus).toBeNull();
});

test('각성 습득은 해금 레벨과 SP를 요구하고 골드를 쓰지 않는다', () => {
  const eco = new Economy();
  eco.save = () => true;
  const hero = eco.hero('knight');
  const before = { gold: eco.s.gold, level: hero.level, skill: hero.skills[4] };
  expect(eco.upgradeSkill('knight', 4)).toMatchObject({ ok: false, reason: 'level' });
  expect(eco.s.gold).toBe(before.gold);
  expect(hero.level).toBe(before.level);
  expect(hero.skills[4]).toBe(before.skill);
  hero.level = 10;
  expect(eco.upgradeSkill('knight', 4)).toMatchObject({ ok: true, level: before.skill + 1 });
  expect(hero.skills[4]).toBe(before.skill + 1);
  expect(eco.s.gold).toBe(before.gold);
});
