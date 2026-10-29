import { expect, test } from 'bun:test';
import { SEASON } from '../src/data/content-90d.js';
import { endgameGoals, endgameUnlock, ENDGAME_INTRO_LEVEL, MAX_GOALS } from '../src/game/endgame-hub.js';

const DAY = 86400000;
/** 최소 저장: 영웅 레벨·진행도·엔드게임 기록만 채운다. */
const save = (over: any = {}) => ({ heroes: { knight: { level: 1 } }, progress: { unlocked: 1, stars: {} }, endgame: { peak: {}, torment: { best: 0 }, tower: {} }, legend: {}, expedition: {}, ...over });
const peakOf = (ch: number, rank: number, upTo = 10) => Object.fromEntries(Array.from({ length: upTo }, (_, i) => [`${ch}-${i + 1}`, rank]));
const ids = (s: any, opts?: any) => endgameGoals(s, opts).goals.map((g) => g.id);

test('Lv.60 미만이고 엔드게임 기록이 없으면 허브가 숨겨지고 목표가 없다', () => {
  for (const level of [1, 30, ENDGAME_INTRO_LEVEL - 1]) {
    const r = endgameGoals(save({ heroes: { knight: { level } } }), { nowMs: SEASON.startMs });
    expect(r.unlocked).toBe(false);
    expect(r.goals).toEqual([]);
  }
  expect(endgameGoals(null as any).unlocked).toBe(false);
  // 무한의 성(2-10 클리어)은 엔드게임 신호가 아니다.
  expect(endgameUnlock(save({ progress: { unlocked: 30, stars: { '2-10': 3 } } })).unlocked).toBe(false);
});

test('Lv.60이 되면 열리고, 지옥 기록·전설 수련·고통 기록도 레벨과 무관하게 연다', () => {
  expect(endgameUnlock(save({ heroes: { knight: { level: ENDGAME_INTRO_LEVEL } } }))).toMatchObject({ unlocked: true, reason: 'level' });
  expect(endgameUnlock(save({ endgame: { peak: { '1-1': 3 } } }))).toMatchObject({ unlocked: true, reason: 'hell' });
  expect(endgameUnlock(save({ endgame: { peak: { '1-1': 2 } } })).unlocked).toBe(false);
  expect(endgameUnlock(save({ legend: { rank: 1 } }))).toMatchObject({ unlocked: true, reason: 'record' });
  expect(endgameUnlock(save({ endgame: { torment: { best: 1 } } }))).toMatchObject({ unlocked: true, reason: 'record' });
});

test('목표는 최대 3개이고 우선순위 순서가 고정이다: Lv.60대는 만렙 → 악몽', () => {
  const s = save({ heroes: { knight: { level: 62 } }, progress: { unlocked: 30, stars: { '2-10': 3 } }, endgame: { peak: peakOf(1, 2, 4) } });
  const r = endgameGoals(s, { nowMs: SEASON.startMs });
  expect(r.goals.length).toBeLessThanOrEqual(MAX_GOALS);
  expect(r.goals.map((g) => g.id)).toEqual(['level', 'nightmare', 'tower']);
  expect(r.goals[0].progress).toMatchObject({ cur: 62, max: 80 });
  expect(r.goals[1].progress).toMatchObject({ cur: 4, max: 10 });
  for (const g of r.goals) { expect(typeof g.title).toBe('string'); expect(g.why.length).toBeGreaterThan(5); expect(g.target.screen).toBeTruthy(); }
});

test('악몽 한 지역을 끝내면 지옥, 지옥 한 지역을 끝내면 고통 단계로 사다리가 넘어간다', () => {
  const nm = save({ heroes: { knight: { level: 80 } }, endgame: { peak: peakOf(1, 2) } });
  const hell = endgameGoals(nm).goals.find((g) => g.id === 'hell');
  expect(hell?.progress).toMatchObject({ cur: 0, max: 10 });
  expect(ids(nm)).not.toContain('nightmare');
  const cleared = save({ heroes: { knight: { level: 80 } }, endgame: { peak: peakOf(1, 3) } });
  const list = ids(cleared);
  expect(list).toContain('torment');
  expect(list).not.toContain('hell');
  expect(list).not.toContain('nightmare');
});

test('고통 목표는 다음 장비 접두 단계(고대 T10, 태고 T25, 최대 T50)를 겨냥한다', () => {
  const at = (best: number) => endgameGoals(save({ heroes: { knight: { level: 80 } }, endgame: { peak: peakOf(1, 3), torment: { best } } })).goals.find((g) => g.id === 'torment')!;
  expect(at(0).progress.max).toBe(10);
  expect(at(0).title).toContain('고대');
  expect(at(9).progress).toMatchObject({ cur: 9, max: 10 });
  expect(at(10).progress.max).toBe(25);
  expect(at(10).title).toContain('태고');
  expect(at(25).progress.max).toBe(50);
  // T50(최고 단계)을 깼으면 더 오를 고통 목표를 내지 않는다(리뷰 P2).
  expect(endgameGoals(save({ heroes: { knight: { level: 80 } }, endgame: { peak: peakOf(1, 3), torment: { best: 50 } } })).goals.some((g) => g.id === 'torment')).toBe(false);
});

test('심층 원정은 실제 입장 조건을 따른다: 기본 원정 미클리어면 기본 원정을 안내한다(리뷰 P2)', () => {
  const base = { heroes: { knight: { level: 80 } }, progress: { unlocked: 40, stars: { '2-10': 3 } } };
  const pick = (expedition: any) => endgameGoals(save({ ...base, expedition }), { limit: 99 }).goals.find((g) => g.id.startsWith('expedition'));
  expect(pick({})).toMatchObject({ id: 'expedition-basic', target: { screen: 'expedition', arg: 'glass_garden', depth: 'standard' } });
  expect(pick({ stats: { glass_garden: 1 } })).toMatchObject({ id: 'expedition', target: { arg: 'glass_garden', depth: 'deep' } });
  expect(pick({ stats: { glass_garden: 1 }, depthWins: { glass_garden: 1 } })).toBeUndefined();
});

test('전설 점수가 남았으면 항상 맨 앞, 만렙 이후에는 전설 수련이 목표가 된다', () => {
  const s = save({ heroes: { knight: { level: 80 } }, endgame: { peak: peakOf(1, 3) }, legend: { rank: 3, exp: 100, points: 3, nodes: {} } });
  const list = ids(s);
  expect(list[0]).toBe('legend-points');
  expect(list.length).toBe(3);
  const noPoints = ids(save({ heroes: { knight: { level: 80 } }, endgame: { peak: peakOf(1, 3) } }));
  expect(noPoints).toContain('legend');
  expect(ids(save({ heroes: { knight: { level: 65 } } }))).not.toContain('legend');
});

test('무한의 성: 주간 보급 수령 가능이면 앞에, 성문 개방 주간이면 무한의 성이 앞당겨진다', () => {
  const base = { heroes: { knight: { level: 70 } }, progress: { unlocked: 30, stars: {} } };
  const ready = save({ ...base, endgame: { peak: {}, tower: { best: 5, week: 2, weekCleared: 2, chestWeek: 0 } } });
  expect(endgameGoals(ready, { nowMs: SEASON.startMs }).goals[0].id).toBe('tower-chest');
  const noEvent = ids(save(base), { nowMs: SEASON.startMs }); // 0주차 출정식(골드 이벤트)
  const towerWeek = endgameGoals(save(base), { nowMs: SEASON.startMs + 7 * DAY }); // 1주차 성문 개방
  expect(towerWeek.season?.id).toBe('tower-open');
  expect(towerWeek.goals.map((g) => g.id).indexOf('tower')).toBeLessThan(noEvent.indexOf('tower') === -1 ? 99 : noEvent.indexOf('tower') + 1);
  expect(towerWeek.goals.find((g) => g.id === 'tower')?.why).toContain('성문 개방');
});

test('입력 저장을 바꾸지 않고 같은 입력에 같은 결과를 낸다', () => {
  const s = save({ heroes: { knight: { level: 80 } }, endgame: { peak: peakOf(1, 3), torment: { best: 12 } }, legend: { rank: 2, points: 1 }, progress: { unlocked: 40, stars: { '2-10': 3 } } });
  const before = JSON.stringify(s);
  const a = endgameGoals(s, { nowMs: SEASON.startMs + 3 * DAY }), b = endgameGoals(s, { nowMs: SEASON.startMs + 3 * DAY });
  expect(JSON.stringify(s)).toBe(before);
  expect(a).toEqual(b);
});
