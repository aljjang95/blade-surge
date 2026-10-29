import { expect, test } from 'bun:test';
import { HEROES } from '../src/data/heroes.js';
import { BASIC_SKILL_GATES, ULT_GATE_LEVEL, skillGateLevel } from '../src/data/skill-tree.js';
import { Player } from '../src/game/player.js';

// 2026-10-27 대표님 피드백 '처음부터 먼치킨': 기본 스킬은 단계 해금, 궁극기는 Lv8, 각성은 기존 unlock 레벨에 열린다.
// 2026-10-29 입문 레벨 곡선(1-1 첫 클리어 Lv3)에 맞춰 둘째 기본 스킬을 Lv2 로 옮겼다: 첫 판에 쓰는 스킬은 둘까지.
test('모든 영웅: 기본 스킬 1·2·5, 궁극기 8, 각성은 unlock', () => {
  expect(BASIC_SKILL_GATES).toEqual([1, 2, 5]); expect(ULT_GATE_LEVEL).toBe(8);
  for (const def of Object.values(HEROES) as any[]) {
    const basics: number[] = [];
    def.skills.forEach((sk: any, i: number) => {
      const gate = skillGateLevel(def, i);
      if (sk.unlock) expect(gate).toBe(sk.unlock);
      else if (sk.ult) expect(gate).toBe(8);
      else basics.push(gate);
    });
    expect(basics).toEqual([1, 2, 5]);
  }
});

test('Player.unlocked: 영웅 레벨이 문턱에 닿을 때 열린다', () => {
  const def: any = HEROES.knight, ult = def.skills.findIndex((s: any) => s.ult), awaken = def.skills.findIndex((s: any) => s.unlock);
  const at = (heroLevel: number) => ({ def, heroLevel, skillLevels: def.skills.map(() => 1) });
  const open = (lv: number, i: number) => Player.prototype.unlocked.call(at(lv), i);
  expect(open(1, 0)).toBe(true); expect(open(1, 1)).toBe(false); expect(open(1, 2)).toBe(false); expect(open(1, ult)).toBe(false);
  expect(open(2, 1)).toBe(true); expect(open(2, 2)).toBe(false); expect(open(4, 2)).toBe(false); expect(open(5, 2)).toBe(true);
  expect(open(7, ult)).toBe(false); expect(open(8, ult)).toBe(true);
  expect(open(9, awaken)).toBe(false); expect(open(def.skills[awaken].unlock, awaken)).toBe(true);
  // 각성은 레벨을 넘겨도 SP 로 배우기 전(스킬 레벨 0)이면 닫혀 있다.
  expect(Player.prototype.unlocked.call({ ...at(30), skillLevels: def.skills.map(() => 0) }, awaken)).toBe(false);
});
