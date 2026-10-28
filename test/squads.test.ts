import { expect, test } from 'bun:test';
import { ENEMIES, stageDef, CHAPTERS, recommendedPowerFor } from '../src/data/stages.js';
import { campaignCombat, speciesRole, stageCurve, composeRoom, SQUADS, campaignAtkMul, campaignHpMul, CH1_RAMP, LATE_CHAPTER_ATK } from '../src/game/squads.js';
import { Battle } from '../src/game/battle.js';
import { towerStage } from '../src/game/endgame-core.js';

const STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('단계 곡선: 단계가 오를수록 일반 종 수가 줄지 않는다', () => {
  for (const chapter of CHAPTERS) {
    for (const s of STAGES) {
      const R = (stageDef(chapter.id, s) as any).combatRosterFor();
      let prev = 0;
      for (const st of STAGES) {
        const n = stageCurve(R, st).trash.length;
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
    }
  }
});

test('단계 곡선: 1단계는 일반 3종과 원거리 1종', () => {
  for (const chapter of CHAPTERS) {
    for (const s of STAGES) {
      const R = (stageDef(chapter.id, s) as any).combatRosterFor();
      const c = stageCurve(R, 1);
      expect(c.trash.length).toBe(3);
      expect(c.ranged.length).toBe(1);
    }
  }
});

test('단계 곡선: 새로 소개되는 종은 직전 단계 곡선에 없고 이번 단계에 있다', () => {
  for (const chapter of CHAPTERS) {
    for (const s of STAGES) {
      const R = (stageDef(chapter.id, s) as any).combatRosterFor();
      for (let st = 2; st <= 10; st++) {
        const cur = stageCurve(R, st), prev = stageCurve(R, st - 1);
        if (!cur.featured) continue;
        expect([...prev.trash, ...prev.ranged]).not.toContain(cur.featured);
        expect([...cur.trash, ...cur.ranged]).toContain(cur.featured);
      }
    }
  }
});

const regionSetsEqual = (chapters: number[]) => {
  for (const chapter of CHAPTERS.filter((c: any) => chapters.includes(c.id))) {
    const base = new Set((stageDef(chapter.id, 1) as any).combatRosterFor().trash);
    for (const st of STAGES) {
      const got = new Set((stageDef(chapter.id, st) as any).combatRosterFor().trash);
      expect(got).toEqual(base);
    }
  }
};

test('지역 정체성: 5장은 단계가 달라도 그 장의 일반 무리가 같다', () => {
  regionSetsEqual([5]);
});

// 같은 지역 안의 던전별 편성 차이(온실에는 잠복형 없음 등)는 던전 정체성이라 허용한다. 다른 지역 무리는 섞이지 않는다.
test('지역 정체성: 용광로·서리·왕관 장에는 정원 전용 해골 병사·잠행꾼이 나오지 않는다', () => {
  for (const ch of [2, 3, 5]) for (const st of STAGES) {
    const trash = (stageDef(ch, st) as any).combatRosterFor().trash;
    expect(trash).not.toContain('skel_minion'); expect(trash).not.toContain('grave_burrower');
  }
  expect((stageDef(2, 3) as any).rosterFor().trash).toContain('skel_minion');   // 보상 기준 명단은 기존 그대로
});

test('보상 명단: rosterFor 는 던전 편성을 유지해 combatRosterFor 와 다른 단계가 있다', () => {
  let differing = 0;
  for (const chapter of CHAPTERS.filter((c: any) => c.id <= 5)) {
    for (const st of STAGES) {
      const stage: any = stageDef(chapter.id, st);
      if (JSON.stringify(stage.rosterFor().trash) !== JSON.stringify(stage.combatRosterFor().trash)) differing++;
    }
  }
  expect(differing).toBeGreaterThan(0);
  const s23: any = stageDef(2, 3);
  expect(s23.rosterFor()).toBeDefined();
  expect(s23.combatRosterFor()).toBeDefined();
});

test('composeRoom: 크기·분대 수·곡선 안의 종·결정성', () => {
  for (const chapter of CHAPTERS) {
    const R = (stageDef(chapter.id, 4) as any).combatRosterFor();
    for (const st of [1, 3, 6, 10]) {
      const curve = stageCurve(R, st), allowed = [...curve.trash, ...curve.ranged];
      for (const n of [1, 4, 8, 16, 18, 28]) {
        const r = composeRoom(R, st, 7, 4, n);
        expect(r.list.length).toBe(n);
        expect(r.squadOf.length).toBe(n);
        expect(new Set(r.squadOf).size).toBe(Math.max(1, Math.min(5, Math.round(n / 4))));
        for (const id of r.list) expect(allowed).toContain(id);
        expect(composeRoom(R, st, 7, 4, n)).toEqual(r);
      }
    }
  }
});

const featuredRoomCheck = (onlyNonLine: boolean) => {
  let checked = 0;
  for (const chapter of CHAPTERS) {
    const R = (stageDef(chapter.id, 4) as any).combatRosterFor();
    for (let st = 2; st <= 10; st++) {
      const { featured } = stageCurve(R, st);
      if (!featured) continue;
      if (onlyNonLine && ['line', 'striker'].includes(speciesRole((ENEMIES as any)[featured]))) continue;
      const r = composeRoom(R, st, 3, 4, 16, { featuredRoom: true });
      expect(r.list).toContain(featured);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
};

test('composeRoom: featuredRoom 이면 새 역할 종(line·striker 제외)이 방에 포함된다', () => {
  featuredRoomCheck(true);
});

test('composeRoom: featuredRoom 이면 새로 소개되는 종이 항상 방에 포함된다', () => {
  featuredRoomCheck(false);
});

test('speciesRole: 몬스터 행동 코드에서 역할을 읽는다', () => {
  const expected: Record<string, string> = {
    skel_shield: 'tank', skel_priest: 'support', bomb_slime: 'bomber', grave_burrower: 'ambush',
    bell_ringer: 'special', skel_rogue: 'flanker', bone_orc: 'bruiser', skel_mage: 'ranged', skel_minion: 'line',
  };
  for (const [id, role] of Object.entries(expected)) expect(speciesRole((ENEMIES as any)[id])).toBe(role);
  expect(speciesRole(undefined)).toBe('line');
  expect(Object.keys(SQUADS).length).toBeGreaterThan(0);
});

test('roomRoster: 1-1 대형 방도 서로 다른 종이 6종 이하', () => {
  const stage = stageDef(1, 1);
  const room: any = { id: 3, type: 'normal', reinforced: 0 };
  const rnd = Math.random;
  Math.random = () => 0.99; // 일반 방의 35% 무작위 정예 추가를 끈다
  let list: string[];
  try { list = (Battle.prototype as any).roomRoster.call({ stage, rosterSize: () => 16 }, room); } finally { Math.random = rnd; }
  expect(list.length).toBe(16);
  expect(new Set(list).size).toBeLessThanOrEqual(6);
  expect(room.squadPlan.squadOf.length).toBe(16);
});

test('campaignCombat: 캠페인 혼자 플레이만(원정·파티 제외) — 파티 방은 분대 편성을 쓰지 않는다', () => {
  const stage: any = stageDef(1, 4);
  expect(campaignCombat(stage)).toBe(true);
  expect(campaignCombat({ ...stage, party: { runId: 'x' } })).toBe(false);
  expect(campaignCombat({ ...stage, expedition: { kind: 'dungeon' } })).toBe(false);
  const room: any = { id: 3, type: 'normal', reinforced: 0 };
  Battle.prototype.roomRoster.call({ stage: { ...stage, party: { runId: 'x' } }, rosterSize: () => 16 }, room);
  expect(room.squadPlan).toBeNull();
});

test('후반 곡선: 권장 전투력은 배율^0.7, 5장부터 캠페인 적 공격 ×1.3(원정·파티 제외)', () => {
  expect(stageDef(1, 1).recPower).toBe(2600);
  let prev = 0;
  for (let ch = 1; ch <= 7; ch++) for (let st = 1; st <= 10; st++) { const r = stageDef(ch, st).recPower; expect(r).toBeGreaterThan(prev); prev = r; }
  expect(stageDef(7, 10).recPower).toBe(recommendedPowerFor(stageDef(7, 10).scale));
  expect(stageDef(7, 10).recPower).toBeLessThan(30000);
  expect(campaignAtkMul(stageDef(4, 10))).toBe(1);
  expect(campaignAtkMul(stageDef(5, 1))).toBe(LATE_CHAPTER_ATK);
  expect(campaignAtkMul(stageDef(7, 10))).toBe(1.3);
  expect(campaignAtkMul({ ...stageDef(7, 10), party: true })).toBe(1);
  expect(campaignAtkMul({ ...stageDef(7, 10), expedition: true })).toBe(1);
  expect(campaignAtkMul(null)).toBe(1);
  const tower = towerStage(41);   // 원본 5-1
  expect(tower.ch).toBe(5); expect(tower.tower).toBeTruthy(); expect(campaignAtkMul(tower)).toBe(1);
  expect(tower.recPower).toBe(recommendedPowerFor(tower.scale));
});

test('1장 램프: 1-1은 그대로, 1-2부터 공격 ×1.8→1-10 ×1.3·체력 ×1.15, 2장·원정·파티는 1', () => {
  expect(campaignAtkMul(stageDef(1, 1))).toBe(1); expect(campaignHpMul(stageDef(1, 1))).toBe(1);
  expect(campaignAtkMul(stageDef(1, 2))).toBe(1.8); expect(campaignAtkMul(stageDef(1, 10))).toBe(1.3);
  for (let st = 2; st <= 10; st++) { expect(campaignHpMul(stageDef(1, st))).toBe(1.15); if (st > 2) expect(CH1_RAMP[st - 1].atk).toBeLessThan(CH1_RAMP[st - 2].atk); }
  expect(campaignAtkMul(stageDef(2, 1))).toBe(1); expect(campaignHpMul(stageDef(2, 1))).toBe(1);
  expect(campaignHpMul(stageDef(5, 1))).toBe(1);
  expect(campaignAtkMul({ ...stageDef(1, 5), party: true })).toBe(1); expect(campaignHpMul({ ...stageDef(1, 5), expedition: true })).toBe(1);
});
