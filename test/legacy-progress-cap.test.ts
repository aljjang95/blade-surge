import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sanitizeLegacySave, PROGRESS_PACE, LEGACY_EPOCH } from '../src/shared/legacy-sanitize.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { CHAPTER_OPEN } from '../src/data/chapter-open.js';
import { v1Harness } from './helpers/v1-harness';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 20);
const base = () => EconomyCore.fromState(null, { now: () => NOW, rng: () => 0.5 }).snapshot() as any;
/** 장 범위(from..to)의 모든 관문(1..10)에 별점 value 를 준다. */
const stars = (from: number, to: number, value = 3) => {
  const out: Record<string, number> = {};
  for (let ch = from; ch <= to; ch++) for (let st = 1; st <= 10; st++) out[`${ch}-${st}`] = value;
  return out;
};
const withProgress = (progress: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const s = base();
  s.progress = { ...s.progress, ...progress };
  return Object.assign(s, extra);
};
// createdAt 기본값은 아주 오래전(경과일 충분 → 속도 상한이 걸리지 않음).
const run = (raw: any, opts: Record<string, unknown> = {}) => {
  const r = sanitizeLegacySave(raw, { now: NOW, createdAt: LEGACY_EPOCH, ...opts }) as any;
  expect(r.ok).toBe(true);
  return r;
};
const floorsOf = (keys: string[]) => keys.sort((a, b) => { const [c1, s1] = a.split('-').map(Number), [c2, s2] = b.split('-').map(Number); return c1 - c2 || s1 - s2; });

describe('진행도 정화: 조작·정상·개방 시각', () => {
  test('1. unlocked=70, 별점 없음 → unlocked 1, 절삭 보고', () => {
    const r = run(withProgress({ unlocked: 70, stars: {} }));
    expect(r.state.progress.unlocked).toBe(1);
    expect(r.state.progress.stars).toEqual({});
    expect(r.report.clamped['progress.unlocked']).toEqual({ from: 70, to: 1 });
  });

  test('2. 정상 1-1~1-10 별점 → unlocked 11 유지, progress 절삭 항목 없음', () => {
    const r = run(withProgress({ unlocked: 11, stars: stars(1, 1) }));
    expect(r.state.progress.unlocked).toBe(11);
    expect(Object.keys(r.state.progress.stars).length).toBe(10);
    expect(Object.keys(r.report.clamped).filter((k) => k.startsWith('progress'))).toEqual([]);
  });

  test('3. 7장 별점은 개방 시각 이전 now에서 사라지고(조작 표시) 이후에는 남는다', () => {
    const open = CHAPTER_OPEN[7];
    const raw = () => withProgress({ unlocked: 63, stars: { ...stars(1, 6), '7-1': 3, '7-2': 2 } });
    const early = run(raw(), { now: open - 1 });
    expect(Object.keys(early.state.progress.stars).some((k) => k.startsWith('7-'))).toBe(false);
    expect(Object.keys(early.state.progress.stars).length).toBe(60);
    expect(early.state.progress.unlocked).toBe(61);
    expect(early.report.severe).toBe(true);
    const late = run(raw(), { now: open });
    expect(Object.keys(late.state.progress.stars)).toContain('7-1');
    expect(Object.keys(late.state.progress.stars)).toContain('7-2');
    expect(late.state.progress.unlocked).toBe(63);
    expect(late.report.severe).toBe(false);
  });
});

describe('진행도 정화: 속도 상한·서버 바닥값', () => {
  test('4. 경과 1일에 1~7장 70관문 → 관문 번호 ≤ oneTime+daily 까지만, 앞쪽부터, 속도 초과만으로는 severe 아님', () => {
    const cap = PROGRESS_PACE.oneTime + PROGRESS_PACE.daily * 1;
    const r = run(withProgress({ unlocked: 70, stars: stars(1, 7) }), { createdAt: NOW });
    expect(r.report.days).toBe(1);
    const keys = floorsOf(Object.keys(r.state.progress.stars));
    expect(keys.length).toBe(cap);
    expect(keys).toEqual(floorsOf(Object.keys(stars(1, 6))));
    expect(r.state.progress.unlocked).toBe(cap + 1);
    expect(r.report.clamped['progress.stars']).toEqual({ from: 70, to: cap });
    expect(r.report.clamped['progress.unlocked']).toEqual({ from: 70, to: cap + 1 });
    expect(r.report.severe).toBe(false);
  });

  test('5. 서버 바닥값: 원본에 없거나 상한을 넘어도 서버 진행은 유지', () => {
    const floor = run(withProgress({ unlocked: 1, stars: {} }), { serverProgress: { unlocked: 35, stars: { '3-4': 2, '1-1': 3 } } });
    expect(floor.state.progress.stars['3-4']).toBe(2);
    expect(floor.state.progress.stars['1-1']).toBe(3);
    expect(floor.state.progress.unlocked).toBe(35);
    // 서버 진행이 속도 상한을 넘어도 깎지 않는다(경과 1일 상한 60, 서버 진행 70)
    const over = run(withProgress({ unlocked: 1, stars: {} }), { createdAt: NOW, serverProgress: { unlocked: 70, stars: stars(1, 7) } });
    expect(Object.keys(over.state.progress.stars).length).toBe(70);
    expect(over.state.progress.unlocked).toBe(70);
    expect(over.report.clamped['progress.unlocked']).toBeUndefined();
    // 서버가 아는 구간은 이어진 것으로 본다: 원본에 앞 관문이 없어도 서버 구간 뒤의 이어진 기록을 인정
    const joined = run(withProgress({ unlocked: 12, stars: { '2-1': 3 } }), { createdAt: NOW, serverProgress: { unlocked: 11, stars: stars(1, 1) } });
    expect(joined.state.progress.stars['2-1']).toBe(3);
    expect(joined.state.progress.unlocked).toBe(12);
    expect(joined.report.severe).toBe(false);
  });
});

describe('진행도 정화: endgame·마을·리뷰 회귀', () => {
  test('6a. 잘린 관문의 peak 항목은 사라지고 서버 peak는 남는다, 3별이 아닌 관문의 악몽 이상 기록은 ≤1로', () => {
    const s = { ...stars(1, 1), '1-2': 1, '3-1': 3 };
    const raw = () => withProgress({ unlocked: 31, stars: s }, { endgame: { peak: { '1-1': 2, '1-2': 3, '3-1': 3 }, torment: { best: 0 } } });
    const r = run(raw(), { createdAt: NOW });
    expect(r.state.endgame.peak['1-1']).toBe(2);
    expect(r.state.endgame.peak['1-2']).toBe(1);
    expect('3-1' in r.state.endgame.peak).toBe(false);
    expect(r.report.clamped['endgame.peak']).toEqual({ from: 3, to: 2 });
    expect(run(raw(), { createdAt: NOW, serverEndgame: { peak: { '2-2': 1 } } }).state.endgame.peak['2-2']).toBe(1);
  });

  test('6b. torment.best는 항상 min(저장값, 서버 best)', () => {
    const peak = Object.fromEntries(Object.keys(stars(1, 1)).map((k) => [k, 3]));
    const raw = () => withProgress({ unlocked: 11, stars: stars(1, 1) }, { endgame: { peak, torment: { best: 6 } } });
    const cut = run(raw(), { serverEndgame: { torment: { best: 2 } } });
    expect(cut.state.endgame.torment.best).toBe(2);
    expect(cut.report.clamped['endgame.torment.best']).toEqual({ from: 6, to: 2 });
    expect(run(raw()).state.endgame.torment.best).toBe(0);
    expect(run(raw(), { serverEndgame: { torment: { best: 9 } } }).state.endgame.torment.best).toBe(6);
  });

  test('6c. (리뷰 b) 1-1~1-10 별 1개 + peak 전부 3 + torment.best 49, 서버 best 0 → best 0, peak ≤1', () => {
    const peak = Object.fromEntries(Object.keys(stars(1, 1)).map((k) => [k, 3]));
    const r = run(withProgress({ unlocked: 11, stars: stars(1, 1, 1) }, { endgame: { peak, torment: { best: 49 } } }), { serverEndgame: { torment: { best: 0 } } });
    expect(r.state.endgame.torment.best).toBe(0);
    expect(Object.keys(r.state.endgame.peak).length).toBe(10);
    for (const rank of Object.values(r.state.endgame.peak) as number[]) expect(rank).toBeLessThanOrEqual(1);
  });

  test('7. campaignTown.current가 잘린 지역을 가리키면 남은 진행의 최신 마을로 내려간다', () => {
    const forgedTown = run(withProgress({ unlocked: 70, stars: {} }, { campaignTown: { current: 7, celebrated: 7 } }));
    expect(forgedTown.state.campaignTown).toEqual({ current: 1, celebrated: 1 });
    // 1장만 이어지고 나머지는 끊긴 기록 → 2지역(unlocked 11)까지만
    const gap = run(withProgress({ unlocked: 61, stars: { ...stars(1, 1), ...stars(5, 6) } }, { campaignTown: { current: 6, celebrated: 6 } }), { createdAt: NOW });
    expect(gap.state.progress.unlocked).toBe(11);
    expect(gap.state.campaignTown).toEqual({ current: 2, celebrated: 2 });
    const ok = run(withProgress({ unlocked: 61, stars: stars(1, 6) }, { campaignTown: { current: 3, celebrated: 4 } }), { createdAt: NOW });
    expect(ok.state.campaignTown).toEqual({ current: 3, celebrated: 4 });
  });

  test('(리뷰 a) 신규 계정(경과 1일)에 4-1~7-10만 별 3개 → unlocked 1, 마을 1, severe', () => {
    const r = run(withProgress({ unlocked: 71, stars: stars(4, 7) }, { campaignTown: { current: 7, celebrated: 7 } }), { createdAt: NOW });
    expect(r.state.progress.unlocked).toBe(1);
    expect(r.state.progress.stars).toEqual({});
    expect(r.state.campaignTown).toEqual({ current: 1, celebrated: 1 });
    expect(r.report.severe).toBe(true);
  });
});

describe('서버 경로: 가져오기·그림자 스냅샷', () => {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/saves/${name}`, import.meta.url), 'utf8'));
  const forged = (name = 'new.json') => { const s = fixture(name); s.progress = { ...s.progress, unlocked: 70, stars: {} }; return s; };
  const NOW_S = Date.UTC(2026, 9, 20);
  async function account(ageDays = 0) {
    const h = await v1Harness();
    h.setNow(NOW_S - ageDays * DAY);
    const first = await h.session();
    h.setNow(NOW_S);
    return { h, a: ageDays ? { ...first, ...await h.session(first.deviceKey) } : first };
  }

  test('8a. /import: 조작 세이브(unlocked 70, 별점 없음)는 서버 문서 progress.unlocked 1, 보고서 절삭', async () => {
    const { h, a } = await account(60);
    const r = await h.send('POST', '/import', { installId: crypto.randomUUID(), save: forged() }, a.token);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('shadow');
    expect(r.body.doc.progress.unlocked).toBe(1);
    expect(r.body.report.clamped['progress.unlocked']).toEqual({ from: 70, to: 1 });
    expect((await h.send('GET', '/me', undefined, a.token)).body.doc.progress.unlocked).toBe(1);
  });

  test('8b. /shadow/snapshot: 같은 조작 스냅샷도 unlocked 1, 서버 문서도 1', async () => {
    const { h, a } = await account(60);
    expect((await h.send('POST', '/import', { installId: crypto.randomUUID(), save: fixture('new.json') }, a.token)).body.status).toBe('shadow');
    const snap = await h.send('POST', '/shadow/snapshot', { cid: 'snap-progress-forge', save: forged() }, a.token);
    expect(snap.status).toBe(200);
    expect(snap.body.clamped['progress.unlocked']).toEqual({ from: 70, to: 1 });
    expect((await h.send('GET', '/me', undefined, a.token)).body.doc.progress.unlocked).toBe(1);
  });

  test('8c. /shadow/snapshot: 서버가 이미 가진 진행(중반 세이브 25)은 조작 스냅샷으로 깎이지 않는다', async () => {
    const { h, a } = await account(10);
    const imp = await h.send('POST', '/import', { installId: crypto.randomUUID(), save: fixture('mid.json') }, a.token);
    expect(imp.body.doc.progress.unlocked).toBe(25);
    const before = Object.keys(imp.body.doc.progress.stars).length;
    const snap = await h.send('POST', '/shadow/snapshot', { cid: 'snap-progress-floor', save: forged('mid.json') }, a.token);
    expect(snap.status).toBe(200);
    const doc = (await h.send('GET', '/me', undefined, a.token)).body.doc;
    expect(doc.progress.unlocked).toBe(25);
    expect(Object.keys(doc.progress.stars).length).toBe(before);
  });
});
