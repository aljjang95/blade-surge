import { expect, test } from 'bun:test';
import { simulate, run90d, assertBands, stageNeed, towerNeed, PERSONAS } from '../tools/sim-90d.mjs';
import { TORMENT } from '../src/data/content-90d.js';
import { CHAPTERS, STAGES_PER_CHAPTER } from '../src/data/stages.js';

test('90일 시뮬레이터는 같은 시드에서 같은 결과를 낸다(결정적)', () => {
  const a = simulate('mid', 3, { days: 21 }), b = simulate('mid', 3, { days: 21 });
  expect(a).toEqual(b);
  expect(simulate('mid', 4, { days: 21 }).days.at(-1)).not.toEqual(undefined);
});

test('요구 전투력 모델은 관문·난이도·탑 층이 오를수록 커진다', () => {
  for (let i = 2; i <= CHAPTERS.length * STAGES_PER_CHAPTER; i++) expect(stageNeed(i)).toBeGreaterThan(stageNeed(i - 1));
  expect(stageNeed(30, 'hell')).toBeGreaterThan(stageNeed(30, 'nightmare'));
  expect(stageNeed(30, 'nightmare')).toBeGreaterThan(stageNeed(30, 'adept'));
  expect(stageNeed(30, 'torment-1')).toBeGreaterThan(stageNeed(30, 'hell'));
  expect(stageNeed(30, 'torment-20')).toBeGreaterThan(stageNeed(30, 'torment-19'));
  expect(towerNeed(100)).toBeGreaterThan(towerNeed(50));
  expect(Object.keys(PERSONAS)).toEqual(['light', 'mid', 'hardcore', 'marathon']);
});

test('marathon 페르소나(S1): 120분×4세션 하루 8시간, 손기술 0.85, 강화 상한 20, 고통 단계 사용', () => {
  expect(PERSONAS.marathon).toMatchObject({ minutes: 480, sessions: 4, skill: 0.85, enhCap: 20, torment: true });
  expect(PERSONAS.marathon.minutes / PERSONAS.marathon.sessions).toBe(120);
  // 다른 세 페르소나의 기준선은 고통 단계를 쓰지 않는다
  for (const id of ['light', 'mid', 'hardcore']) expect((PERSONAS as any)[id].torment).toBeUndefined();
});

test('marathon 30일: 고통 단계가 열리고 Lv.80 이후 EXP가 전설 수련이 되며, 8일 차부터 할 일 없는 분이 없다', () => {
  const run = simulate('marathon', 1, { days: 30 });
  expect(run.days).toHaveLength(30);
  const at = (d: number) => run.days[d - 1];
  // 지옥 한 지역(10관문)을 끝내기 전에는 고통 단계가 없다. 마라톤은 T1 을 가장 빨리 여는 지역 우선 순서(regionFirst)라 며칠 안에 열린다.
  for (const d of run.days) if (d.hard.hell < 10) expect(d.torment).toBe(0);
  expect(at(1).torment).toBe(0);
  expect(run.days.find((d: any) => d.torment >= 1)?.day ?? 99).toBeLessThanOrEqual(5);
  expect(at(30).torment).toBeGreaterThanOrEqual(8);
  expect(at(30).level).toBe(80);
  expect(at(30).legendRank).toBeGreaterThan(0);
  expect(at(30).legendPowerPct).toBeGreaterThan(0);
  expect(at(30).legendPowerPct).toBeLessThanOrEqual(30);
  // 레벨 80 전에는 전설 수련이 없다
  for (const d of run.days.filter((x: any) => x.level < 80)) expect(d.legendRank).toBe(0);
  // S3: W2 이후 매일 남는 시간을 보상 있는 콘텐츠로 쓴다
  for (const d of run.days.filter((x: any) => x.day >= 8)) expect(d.starvedMin).toBe(0);
  // 하루 판 수는 에너지와 무관하게 시간만큼 돈다
  expect(Math.max(...run.days.map((d: any) => d.tormentRuns))).toBeGreaterThan(TORMENT.fullRuns);
  // 새 고통 단계는 마일스톤으로 남는다
  expect(run.milestones.filter((m: any) => m.kind === 'torment').length).toBe(at(30).torment);
});

test('3 페르소나 기준선 + marathon 90일 진행이 DoD 밴드 안에 든다(시드 3)', () => {
  const report = run90d({ days: 90, seeds: 3 });
  expect(assertBands(report)).toEqual([]);
  const mid = (report.summary as any).mid, marathon = (report.summary as any).marathon;
  // 미드: 스토리 1주 안, 90일에도 지옥·탑에 남은 진행이 있다
  expect(mid.milestones.story_6_10.p50).toBeLessThanOrEqual(10);
  expect(mid.checkpoints.D90.tower.p50).toBeLessThan(210);
  // 마라톤(S2·S3·S5·S5b): 90일 내내 주요 진행, 할 일 없음 0, 전투력과 고통 단계가 D30 이후에도 계속 자란다
  const cp = marathon.checkpoints;
  expect(marathon.newContentDays.p50).toBeGreaterThanOrEqual(CHAPTERS.length >= 12 ? 80 : 70);
  expect(marathon.stalls.longest.p90).toBeLessThanOrEqual(3);
  expect(marathon.idleMinW2toW13.p90).toBe(0);
  expect(cp.D30.torment.p50).toBeGreaterThanOrEqual(8); expect(cp.D30.torment.p50).toBeLessThanOrEqual(14);
  expect(cp.D60.torment.p50).toBeGreaterThanOrEqual(15); expect(cp.D60.torment.p50).toBeLessThanOrEqual(22);
  expect(cp.D90.torment.p50).toBeGreaterThanOrEqual(22); expect(cp.D90.torment.p50).toBeLessThanOrEqual(32);
  expect(cp.D60.power.p50 / cp.D30.power.p50).toBeGreaterThanOrEqual(1.15);
  expect(cp.D90.power.p50 / cp.D30.power.p50).toBeGreaterThanOrEqual(1.35);
  expect(cp.D90.legendPowerPct.p50).toBeLessThanOrEqual(30);
  expect(mid.checkpoints.D90.legendPowerPct.p50).toBeLessThanOrEqual(15);
  // 전설만으로 채운 날은 주 3일까지만 센다 — 전설을 빼도 무진행 연속은 6일 안(나머지는 탑·고통 단계·장비 성장)
  expect(marathon.stallsExLegend.p90).toBeLessThanOrEqual(7);
}, 240000);

test('밴드 검사는 마라톤의 정체·고갈을 실제로 잡아낸다(기준을 약하게 두지 않았다는 확인)', () => {
  const report: any = run90d({ days: 90, seeds: 1 });
  const broken = structuredClone(report);
  broken.summary.marathon.newContentDays.p50 = 60;
  broken.summary.marathon.stalls.longest.p90 = 7;
  broken.summary.marathon.idleMinW2toW13.p90 = 12;
  broken.summary.marathon.checkpoints.D90.torment.p50 = 50;
  broken.summary.marathon.checkpoints.D30.torment.p50 = 30;
  broken.summary.marathon.checkpoints.D60.torment.p50 = 5;
  broken.summary.marathon.checkpoints.D60.power.p50 = broken.summary.marathon.checkpoints.D30.power.p50 * 1.01;
  broken.summary.marathon.checkpoints.D90.power.p50 = broken.summary.marathon.checkpoints.D30.power.p50 * 1.02;
  broken.summary.marathon.checkpoints.D90.legendPowerPct.p50 = 55;
  broken.summary.marathon.milestones.torment_30.p10 = 40;
  const failures = assertBands(broken);
  for (const needle of ['S2 마라톤 주요 진행일', 'S2 마라톤 주요 진행 없는 최장', 'S3 마라톤', 'S5b 마라톤 D30 고통 단계', 'S5b 마라톤 D60 고통 단계', 'S5b 마라톤 D90 고통 단계', 'S5b 마라톤 전투력 D60/D30', 'S5b 마라톤 전투력 D90/D30', 'S5 마라톤 T30', 'S5 마라톤 D90 전설']) {
    expect(failures.some((f: string) => f.includes(needle))).toBe(true);
  }
  broken.summary.mid.checkpoints.D90.legendPowerPct.p50 = 40;
  expect(assertBands(broken).some((f: string) => f.includes('S5 미드'))).toBe(true);
}, 240000);
