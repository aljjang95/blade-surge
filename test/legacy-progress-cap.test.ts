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

  test('3. 7장 별점은 개방 시각 이전 now에서 사라지고 이후에는 남는다', () => {
    const open = CHAPTER_OPEN[7];
    const raw = () => withProgress({ unlocked: 71, stars: { ...stars(1, 1), '7-1': 3, '7-2': 2 } });
    const early = run(raw(), { now: open - 1 });
    expect(Object.keys(early.state.progress.stars).some((k) => k.startsWith('7-'))).toBe(false);
    expect(Object.keys(early.state.progress.stars).length).toBe(10);
    expect(early.state.progress.unlocked).toBe(11);
    const late = run(raw(), { now: open });
    expect(Object.keys(late.state.progress.stars)).toContain('7-1');
    expect(Object.keys(late.state.progress.stars)).toContain('7-2');
    expect(late.state.progress.unlocked).toBe(6 * 10 + 2 + 1);
  });
});

describe('진행도 정화: 속도 상한·서버 바닥값', () => {
  test('4. 경과 1일에 1~6장 60관문 → oneTime+daily 개만, 앞쪽 관문부터, unlocked=마지막+1', () => {
    const cap = PROGRESS_PACE.oneTime + PROGRESS_PACE.daily * 1;
    const r = run(withProgress({ unlocked: 61, stars: stars(1, 6) }), { createdAt: NOW });
    expect(r.report.days).toBe(1);
    const keys = floorsOf(Object.keys(r.state.progress.stars));
    expect(keys.length).toBe(cap);
    expect(keys[0]).toBe('1-1');
    expect(keys[keys.length - 1]).toBe('4-10'); // cap 40 = 4장 끝
    expect(keys).toEqual(floorsOf(Object.keys(stars(1, 4))));
    expect(r.state.progress.unlocked).toBe(cap + 1);
    expect(r.report.clamped['progress.stars']).toEqual({ from: 60, to: cap });
    expect(r.report.clamped['progress.unlocked']).toEqual({ from: 61, to: cap + 1 });
  });

  test('5. 서버 바닥값: 원본에 없거나 상한을 넘어도 서버 진행은 유지', () => {
    // 원본은 진행 없음, 서버 문서는 3-4까지 클리어(unlocked 35)
    const floor = run(withProgress({ unlocked: 1, stars: {} }), { serverProgress: { unlocked: 35, stars: { '3-4': 2, '1-1': 3 } } });
    expect(floor.state.progress.stars['3-4']).toBe(2);
    expect(floor.state.progress.stars['1-1']).toBe(3);
    expect(floor.state.progress.unlocked).toBe(35);
    // 서버 진행이 속도 상한(40)을 넘어도 깎지 않는다
    const big = stars(1, 5);
    const over = run(withProgress({ unlocked: 1, stars: {} }), { createdAt: NOW, serverProgress: { unlocked: 51, stars: big } });
    expect(Object.keys(over.state.progress.stars).length).toBe(50);
    expect(over.state.progress.unlocked).toBe(51);
    expect(over.report.clamped['progress.unlocked']).toBeUndefined();
    // 원본이 상한을 채워도 서버 항목이 먼저 남는다
    const mixed = run(withProgress({ unlocked: 61, stars: stars(1, 6) }), { createdAt: NOW, serverProgress: { unlocked: 61, stars: { '6-10': 1 } } });
    expect(mixed.state.progress.stars['6-10']).toBe(1);
    expect(mixed.state.progress.unlocked).toBe(61);
  });
});

describe('진행도 정화: endgame·마을', () => {
  test('6a. 별점이 잘린 관문의 endgame.peak 항목은 사라지고 서버 peak는 남는다', () => {
    const raw = withProgress({ unlocked: 61, stars: stars(1, 6) }, { endgame: { peak: { '1-1': 2, '6-5': 3 }, torment: { best: 0 } } });
    const r = run(raw, { createdAt: NOW });
    expect(r.state.endgame.peak['1-1']).toBe(2);
    expect('6-5' in r.state.endgame.peak).toBe(false);
    expect(r.report.clamped['endgame.peak']).toEqual({ from: 2, to: 1 });
    const withServer = run(raw, { createdAt: NOW, serverEndgame: { peak: { '2-2': 1 } } });
    expect(withServer.state.endgame.peak['2-2']).toBe(1);
  });

  test('6b. 지옥(랭크 3)으로 한 장 10관문 기록이 없으면 torment.best는 서버값 이하로 절삭', () => {
    const peak = Object.fromEntries(Object.keys(stars(1, 1)).map((k) => [k, 3]));
    const noHell = (extra: Record<string, unknown> = {}) => withProgress({ unlocked: 11, stars: stars(1, 1) }, { endgame: { peak: { ...peak, '1-10': 2 }, torment: { best: 6 }, ...extra } });
    const cut = run(noHell(), { serverEndgame: { torment: { best: 2 } } });
    expect(cut.state.endgame.torment.best).toBe(2);
    expect(cut.report.clamped['endgame.torment.best']).toEqual({ from: 6, to: 2 });
    expect(run(noHell()).state.endgame.torment.best).toBe(0); // 서버 기록도 없으면 0
    // 서버 best가 더 커도 원본 값(6)을 넘지 않는다
    expect(run(noHell(), { serverEndgame: { torment: { best: 9 } } }).state.endgame.torment.best).toBe(6);
    // 지옥으로 1장 10관문을 끝낸 기록이 남으면 저장값 유지
    const full = withProgress({ unlocked: 11, stars: stars(1, 1) }, { endgame: { peak, torment: { best: 6 } } });
    const kept = run(full);
    expect(kept.state.endgame.torment.best).toBe(6);
    expect(kept.report.clamped['endgame.torment.best']).toBeUndefined();
  });

  test('6c. 속도 상한으로 지옥 기록 관문이 잘리면 torment.best도 서버값으로 내려간다', () => {
    const peak = Object.fromEntries(Object.keys(stars(5, 5)).map((k) => [k, 3]));
    const raw = withProgress({ unlocked: 61, stars: stars(1, 6) }, { endgame: { peak, torment: { best: 8 } } });
    const r = run(raw, { createdAt: NOW, serverEndgame: { torment: { best: 1 } } });
    expect(r.state.endgame.peak).toEqual({});
    expect(r.state.endgame.torment.best).toBe(1);
  });

  test('7. campaignTown.current가 잘린 지역을 가리키면 남은 진행의 최신 마을로 내려간다', () => {
    const forgedTown = run(withProgress({ unlocked: 70, stars: {} }, { campaignTown: { current: 7, celebrated: 7 } }));
    expect(forgedTown.state.campaignTown).toEqual({ current: 1, celebrated: 1 });
    const capped = run(withProgress({ unlocked: 61, stars: stars(1, 6) }, { campaignTown: { current: 6, celebrated: 6 } }), { createdAt: NOW });
    expect(capped.state.progress.unlocked).toBe(41);
    expect(capped.state.campaignTown).toEqual({ current: 5, celebrated: 5 });
    // 남은 진행 안의 마을은 그대로
    const ok = run(withProgress({ unlocked: 61, stars: stars(1, 6) }, { campaignTown: { current: 3, celebrated: 4 } }), { createdAt: NOW });
    expect(ok.state.campaignTown).toEqual({ current: 3, celebrated: 4 });
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
