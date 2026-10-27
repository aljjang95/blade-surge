import { describe, expect, test } from 'bun:test';
import { createSceneRun, loadLoreSeen, markLoreSeen, hasSeenLore, shouldAutoPlayScene, sceneLinesFor, bossLoreHtml, LORE_SEEN_KEY, LINE_MS } from '../src/ui/lore-scene.js';
import { codexCardHtml, codexListHtml, codexHtml, CODEX_TABS } from '../src/ui/lore-codex.js';
import { validateFunnelEvent, FUNNEL_EVENTS } from '../src/game/funnel-events.js';
import { stageDef } from '../src/data/stages.js';

const fakeStorage = (initial?: string) => {
  const map = new Map<string, string>(); if (initial !== undefined) map.set(LORE_SEEN_KEY, initial);
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, map };
};
const lines = [{ who: 'narrator', line: '하나' }, { who: 'neb', line: '둘' }, { who: 'neb', line: '셋' }];

describe('챕터 장면 진행', () => {
  test('탭으로 끝까지 가면 done 이고 본 기록이 남는다', () => {
    const storage = fakeStorage(), events: any[] = [], shown: number[] = []; let end = '';
    const run = createSceneRun(1, lines, { storage, track: (n: string, p: any) => events.push([n, p]), onLine: (_r: any, i: number) => shown.push(i), onEnd: (a: string) => { end = a; } }).start();
    expect(hasSeenLore(1, storage)).toBe(true);
    run.next(); run.next(); run.next();
    expect(shown).toEqual([0, 1, 2]); expect(end).toBe('done'); expect(run.ended).toBe(true);
    expect(events.map((e) => e[1].act)).toEqual(['view', 'done']);
    run.next(); expect(events.length).toBe(2); // 끝난 뒤에는 무반응
  });
  test('자동 진행은 약 3초마다 한 줄', () => {
    const shown: number[] = [];
    const run = createSceneRun(1, lines, { storage: fakeStorage(), onLine: (_r: any, i: number) => shown.push(i) }).start();
    run.tick(LINE_MS - 1); expect(shown).toEqual([0]); run.tick(1); expect(shown).toEqual([0, 1]);
  });
  test('건너뛰기는 skip 과 말풍선 번호를 남기고 닫는다', () => {
    const storage = fakeStorage(), events: any[] = []; let end = '';
    const run = createSceneRun(2, lines, { storage, track: (n: string, p: any) => events.push(p), onEnd: (a: string) => { end = a; } }).start();
    run.next(); run.skip();
    expect(end).toBe('skip'); expect(events[1]).toEqual({ ch: 2, act: 'skip', line: 1 }); expect(hasSeenLore(2, storage)).toBe(true);
  });
  test('다시 보기는 replay 로 기록하고 본 기록을 바꾸지 않는다', () => {
    const storage = fakeStorage(), events: any[] = [];
    createSceneRun(3, lines, { storage, replay: true, track: (_n: string, p: any) => events.push(p) }).start().skip();
    expect(events[0]).toEqual({ ch: 3, act: 'replay' }); expect(hasSeenLore(3, storage)).toBe(false);
  });
  test('저장소가 없거나 깨져도 동작한다', () => {
    expect(loadLoreSeen(null).size).toBe(0);
    expect(loadLoreSeen(fakeStorage('{깨짐')).size).toBe(0);
    expect(loadLoreSeen(fakeStorage('[1,99,"a",2]')).has(2)).toBe(true);
    const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    expect(markLoreSeen(1, bad)).toBe(false);
    expect(() => createSceneRun(1, lines, { storage: bad }).start().skip()).not.toThrow();
  });
  test('자동 재생 조건: 열려 있고 안 본 장만', () => {
    const storage = fakeStorage();
    expect(shouldAutoPlayScene(1, { unlocked: false, storage })).toBe(false);
    expect(shouldAutoPlayScene(1, { unlocked: true, storage })).toBe(sceneLinesFor(1).length > 0);
    markLoreSeen(1, storage); expect(shouldAutoPlayScene(1, { unlocked: true, storage })).toBe(false);
  });
});

describe('퍼널 스키마', () => {
  test('lore_scene / codex_open 검증', () => {
    expect(FUNNEL_EVENTS).toContain('lore_scene'); expect(FUNNEL_EVENTS).toContain('codex_open');
    expect(validateFunnelEvent('lore_scene', { ch: 1, act: 'view' }).ok).toBe(true);
    expect(validateFunnelEvent('lore_scene', { ch: 1, act: 'skip', line: 3 }).ok).toBe(true);
    expect(validateFunnelEvent('lore_scene', { ch: 21, act: 'view' }).ok).toBe(false);
    expect(validateFunnelEvent('lore_scene', { ch: 1, act: 'nope' }).ok).toBe(false);
    expect(validateFunnelEvent('lore_scene', { ch: 1, act: 'done', line: 11 }).ok).toBe(false);
    expect(validateFunnelEvent('lore_scene', { ch: 1, act: 'done', text: '자유' }).ok).toBe(false);
    for (const tab of ['region', 'boss', 'monster', 'hero']) expect(validateFunnelEvent('codex_open', { tab }).ok).toBe(true);
    expect(validateFunnelEvent('codex_open', { tab: 'x' }).ok).toBe(false);
  });
});

describe('보스 등장 띠 문구', () => {
  test('X-5·X-10 보스에는 칭호·이름·외침이 들어가고 일반 관문에는 없다', () => {
    const mid = bossLoreHtml(stageDef(1, 5)), fin = bossLoreHtml(stageDef(1, 10));
    expect(mid).toContain('애도의 기사 · 세렌'); expect(mid).toContain('다시는 보내지 않는다!');
    expect(fin).toContain('기억을 가둔 종왕 · 에일른');
    expect(bossLoreHtml(stageDef(1, 3))).toBe('');
    expect(bossLoreHtml(null)).toBe('');
  });
});

describe('도감 렌더', () => {
  const entries = [
    { id: 'r1', tab: 'region', name: '잊힌 종의 정원', text: '종이 잠든 곳', ch: 1, unlocked: true, hint: '' },
    { id: 'b1', tab: 'boss', name: '세렌', title: '애도의 기사', text: '보내지 못한 기사', ch: 1, unlocked: false, hint: '1-5 클리어' },
  ];
  test('해금은 이름·칭호·글, 잠김은 이름을 숨기고 hint 만', () => {
    const open = codexCardHtml(entries[0]), locked = codexCardHtml(entries[1]);
    expect(open).toContain('잊힌 종의 정원'); expect(open).toContain('data-replay="1"');
    expect(locked).toContain('locked'); expect(locked).toContain('1-5 클리어'); expect(locked).not.toContain('세렌'); expect(locked).not.toContain('보내지 못한');
    expect(codexListHtml(entries, 'monster')).toContain('기록이 없습니다');
  });
  test('탭 4개와 HTML 이스케이프', () => {
    expect(CODEX_TABS.map((t) => t.id)).toEqual(['region', 'boss', 'monster', 'hero']);
    const html = codexHtml([{ ...entries[0], name: '<b>x</b>' }], 'region');
    expect((html.match(/data-codex-tab=/g) || []).length).toBe(4); expect(html).not.toContain('<b>x</b>');
  });
});
