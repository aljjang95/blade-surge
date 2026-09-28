import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createFunnelLog, validateFunnelEvent, sessionOpenEvents, FUNNEL_EVENTS, FUNNEL_STORAGE_KEY, FUNNEL_MAX_CAP } from '../src/game/funnel-events.js';
import { SKUS, SHOP_TABS } from '../src/data/shop.js';

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}
const fixedClock = (start = 1_800_000_000_000) => { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

test('exposes exactly the funnel events and no purchase/pass/ad success events', () => {
  expect([...FUNNEL_EVENTS].sort()).toEqual(['first_run', 'gacha_pull', 'gacha_view', 'hero_level_up', 'paysheet_open', 'return_session', 'reward_claim', 'session_start', 'shop_view', 'tutorial_complete', 'tutorial_step', 'upgrade'].sort());
  for (const name of ['purchase_success', 'purchase_complete', 'pass_purchase', 'ad_reward', 'ad_complete', 'grant']) {
    expect(validateFunnelEvent(name, {})).toEqual({ ok: false, reason: 'unknown_event' });
  }
});

test('valid events are recorded in order with deterministic clock and sequence', () => {
  const storage = memStorage(), clock = fixedClock();
  const log = createFunnelLog({ storage, now: clock.now });
  expect(log.track('first_run').ok).toBe(true);
  clock.advance(1500);
  expect(log.track('tutorial_step', { step: 1 }).ok).toBe(true);
  expect(log.track('gacha_pull', { count: 10, currency: 'gems', pityBefore: 59, ssr: 1, sr: 2, dupes: 1 }).ok).toBe(true);
  expect(log.track('shop_view', { tab: SHOP_TABS[0].id }).ok).toBe(true);
  expect(log.track('paysheet_open', { sku: SKUS[0].id }).ok).toBe(true);
  const events = log.read();
  expect(events.map((e) => e.n)).toEqual(['first_run', 'tutorial_step', 'gacha_pull', 'shop_view', 'paysheet_open']);
  expect(events.map((e) => e.s)).toEqual([1, 2, 3, 4, 5]);
  expect(events[0].t).toBe(1_800_000_000_000);
  expect(events[1].t).toBe(1_800_000_001_000); // second granularity
  expect(JSON.parse(storage.getItem(FUNNEL_STORAGE_KEY)!)).toHaveLength(5);
});

test('rejects unknown keys, freeform strings, PII-like fields, wrong types and missing required keys', () => {
  const log = createFunnelLog({ storage: memStorage(), now: () => 1 });
  const bad: [string, unknown][] = [
    ['first_run', { email: 'a@b.c' }],
    ['tutorial_step', { step: 1, note: 'hello' }],
    ['tutorial_step', { step: '1' }],
    ['tutorial_step', { step: 1.5 }],
    ['tutorial_step', {}],
    ['gacha_pull', { count: 5, currency: 'gems' }],
    ['gacha_pull', { count: 1, currency: 'cash' }],
    ['gacha_pull', { count: 1, currency: 'gems', pityBefore: 81 }],
    ['shop_view', { tab: 'free text' }],
    ['paysheet_open', { sku: 'not_a_real_sku' }],
    ['paysheet_open', { sku: SKUS[0].id, receipt: 'x' }],
    ['upgrade', { kind: 'hero_level', save: { gems: 999 } }],
    ['return_session', { gapDays: -1 }],
    ['reward_claim', { source: 'purchase' }],
    ['first_run', ['array']],
    ['first_run', 'string'],
    ['first_run', new Date()],
  ];
  for (const [name, payload] of bad) expect(log.track(name, payload).ok).toBe(false);
  expect(log.read()).toEqual([]);
});

test('retention is capped by count and age', () => {
  const clock = fixedClock();
  const log = createFunnelLog({ storage: memStorage(), now: clock.now, cap: 5, maxAgeMs: 10_000 });
  for (let i = 0; i < 8; i++) log.track('tutorial_step', { step: i });
  expect(log.read().map((e) => e.p.step)).toEqual([3, 4, 5, 6, 7]);
  clock.advance(11_000);
  expect(log.read()).toEqual([]);
  log.track('first_run');
  expect(log.read().map((e) => e.n)).toEqual(['first_run']);
  expect(createFunnelLog({ storage: null, cap: 10_000 }).cap).toBe(FUNNEL_MAX_CAP);
  expect(createFunnelLog({ storage: null, cap: 0 }).cap).toBe(1);
});

test('malformed or tampered storage is tolerated and sanitized', () => {
  const t = 1_800_000_000_000;
  const cases = ['not json', '{"a":1}', 'null', '42', 'x'.repeat(200_000)];
  for (const raw of cases) {
    const log = createFunnelLog({ storage: memStorage({ [FUNNEL_STORAGE_KEY]: raw }), now: () => t });
    expect(log.read()).toEqual([]);
    expect(log.track('first_run').ok).toBe(true);
  }
  const tampered = JSON.stringify([
    { n: 'tutorial_step', t, s: 2, p: { step: 2 } },
    { n: 'tutorial_step', t, s: 1, p: { step: 1, email: 'x@y.z' } },
    { n: 'purchase_success', t, s: 3, p: {} },
    { n: 'first_run', t: 'yesterday', s: 4, p: {} },
    null, 'junk',
    { n: 'first_run', t, s: 5 },
  ]);
  const log = createFunnelLog({ storage: memStorage({ [FUNNEL_STORAGE_KEY]: tampered }), now: () => t });
  expect(log.read().map((e) => [e.n, e.s])).toEqual([['tutorial_step', 2], ['first_run', 5]]);
  expect(log.track('gacha_view').ok && log.read().at(-1)!.s).toBe(6);
});

test('storage failures never throw and fall back to memory', () => {
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
  const log = createFunnelLog({ storage: throwing, now: () => 5_000 });
  const res = log.track('first_run');
  expect(res.ok && res.persisted).toBe(false);
  expect(res.ok).toBe(true);
  expect(log.read()).toHaveLength(1);
  expect(() => log.clear()).not.toThrow();
  expect(log.read()).toEqual([]);
  // No localStorage in Bun: default storage resolves to memory-only without throwing.
  const fallback = createFunnelLog();
  expect(fallback.track('first_run').ok).toBe(true);
});

test('read returns copies so callers cannot mutate the ring', () => {
  const log = createFunnelLog({ storage: memStorage(), now: () => 1_000 });
  log.track('tutorial_step', { step: 3 });
  const [first] = log.read();
  first.p.step = 99; first.n = 'hacked';
  expect(log.read()[0]).toMatchObject({ n: 'tutorial_step', p: { step: 3 } });
});

test('module performs no network or DOM access', () => {
  const source = readFileSync(new URL('../src/game/funnel-events.js', import.meta.url), 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'document.', 'window.', 'import(']) {
    expect(source.includes(forbidden)).toBe(false);
  }
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('network'); }) as unknown as typeof fetch;
  try {
    const log = createFunnelLog({ storage: memStorage(), now: () => 1 });
    for (const name of FUNNEL_EVENTS) log.track(name, {});
    log.read();
  } finally { globalThis.fetch = original; }
  expect(calls).toBe(0);
});

test('session_start takes no props and latestSession returns the most recent one', () => {
  const clock = fixedClock();
  const log = createFunnelLog({ storage: memStorage(), now: clock.now });
  expect(log.latestSession()).toBeNull();
  expect(log.track('session_start', { userId: 'x' }).ok).toBe(false);
  expect(log.track('session_start').ok).toBe(true);
  clock.advance(60_000);
  log.track('session_start');
  const latest = log.latestSession()!;
  expect(latest).toMatchObject({ n: 'session_start', s: 2, t: 1_800_000_060_000, p: {} });
  latest.t = 0;
  expect(log.latestSession()!.t).toBe(1_800_000_060_000);
});

test('paysheet accepts the premium pass and reward claims accept Journey contracts', () => {
  expect(validateFunnelEvent('paysheet_open', { sku: 'pass' }).ok).toBe(true);
  expect(validateFunnelEvent('reward_claim', { source: 'journey' }).ok).toBe(true);
});

test('latest session_start survives count cap and age pruning so return gaps stay measurable', () => {
  const clock = fixedClock();
  const storage = memStorage();
  const log = createFunnelLog({ storage, now: clock.now, cap: 3, maxAgeMs: 10_000 });
  log.track('session_start');
  for (let i = 0; i < 5; i++) log.track('tutorial_step', { step: i });
  expect(log.read().map((e) => e.n)).toEqual(['session_start', 'tutorial_step', 'tutorial_step']);
  expect(log.read()).toHaveLength(3);
  clock.advance(45 * 86400000);
  expect(log.read().map((e) => e.n)).toEqual(['session_start']);
  // Reload from storage keeps the same answer.
  const reloaded = createFunnelLog({ storage, now: clock.now, cap: 3, maxAgeMs: 10_000 });
  expect(reloaded.latestSession()!.t).toBe(1_800_000_000_000);
});

test('main can derive first_run and return_session from previous session_start', () => {
  const clock = fixedClock();
  const storage = memStorage();
  const DAY = 86400000;
  const boot = (fresh: boolean) => {
    const log = createFunnelLog({ storage, now: clock.now });
    const prev = log.read().filter((r) => r.n === 'session_start').at(-1);
    expect(prev?.s).toBe(log.latestSession()?.s);
    if (!prev && fresh) log.track('first_run');
    const gapDays = prev ? Math.floor((clock.now() - prev.t) / DAY) : 0;
    if (prev && gapDays >= 1) log.track('return_session', { gapDays });
    log.track('session_start');
    return log;
  };
  boot(true);
  clock.advance(2 * 3600000);
  boot(false);
  clock.advance(3 * DAY);
  const log = boot(false);
  expect(log.read().map((e): unknown[] => [e.n, e.p.gapDays ?? null])).toEqual([
    ['first_run', null], ['session_start', null], ['session_start', null], ['return_session', 3], ['session_start', null],
  ]);
});

test('session open events count a new player once even when they reload before the first save exists', () => {
  const DAY = 86400000, now = 1_800_000_000_000;
  const names = (input: Parameters<typeof sessionOpenEvents>[0]) => sessionOpenEvents(input).map(([n]) => n);
  // 완전한 첫 실행
  expect(names({ hasStoredSave: false, previousSession: null, now })).toEqual(['first_run', 'session_start']);
  // 아무 행동 없이 새로고침: 세이브는 아직 없지만 같은 사용자
  expect(names({ hasStoredSave: false, previousSession: { t: now - 60000 }, now })).toEqual(['session_start']);
  // 기존 세이브 + 비어 있는 퍼널 로그: 거짓 first_run 없음
  expect(names({ hasStoredSave: true, previousSession: null, now })).toEqual(['session_start']);
  // 2일 뒤 재방문
  expect(sessionOpenEvents({ hasStoredSave: true, previousSession: { t: now - 2 * DAY }, now })).toEqual([['return_session', { gapDays: 2 }], ['session_start', {}]]);
  // 같은 날 재접속은 재방문으로 세지 않는다
  expect(names({ hasStoredSave: true, previousSession: { t: now - 3600000 }, now })).toEqual(['session_start']);
});

test('automatic hunt level-ups are a separate event from player-chosen upgrades', () => {
  expect(validateFunnelEvent('hero_level_up', { source: 'combat', level: 4 }).ok).toBe(true);
  expect(validateFunnelEvent('hero_level_up', { source: 'stage', level: 5 }).ok).toBe(true);
  expect(validateFunnelEvent('hero_level_up', { source: 'shop', level: 5 }).ok).toBe(false);
  expect(validateFunnelEvent('hero_level_up', { source: 'combat' }).ok).toBe(false);
  // 전투 코드는 upgrade가 아닌 hero_level_up만 기록해야 첫 강화 전환율이 오염되지 않는다.
  const battleSource = readFileSync(new URL('../src/game/rpg-battle.js', import.meta.url), 'utf8');
  expect(battleSource).not.toMatch(/track\('upgrade'/);
  expect(battleSource).toMatch(/track\('hero_level_up', \{ source: 'combat'/);
});
