import { expect, test } from 'bun:test';
import { createFunnelUpload, FUNNEL_SENT_KEY } from '../src/net/funnel-upload.js';
import { createFunnelLog } from '../src/game/funnel-events.js';

const memory = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, raw: m }; };
function setup(o: any = {}) {
  const sent: string[][] = [], storage = o.storage || memory();
  const client = { funnel: async (events: string[]) => { if (o.fail) throw o.fail; sent.push(events); return { accepted: events.length }; } };
  const timers: Array<() => void> = [];
  const log = createFunnelLog({ storage: memory() });
  const up = createFunnelUpload({ client, funnel: log, storage, isReady: o.isReady, setTimer: (fn) => { timers.push(fn); return timers.length; } });
  return { up, log, sent, storage, timers, run: async () => { for (const fn of timers.splice(0)) await fn(); await new Promise((r) => setTimeout(r, 0)); } };
}

test('묶어서 한 번만 보내고 같은 단계는 다시 보내지 않는다', async () => {
  const { up, log, sent, storage, timers, run } = setup();
  up.attach(log);
  log.track('first_run'); log.track('shop_view', { tab: 'hot' }); log.track('gacha_view', {}); log.track('shop_view', { tab: 'gem' });
  expect(timers.length).toBe(1); await run();
  expect(sent).toEqual([['first_run', 'shop_view']]);
  expect(JSON.parse(storage.getItem(FUNNEL_SENT_KEY)!).sort()).toEqual(['first_run', 'shop_view']);
  log.track('shop_view', { tab: 'hot' }); log.track('paysheet_open', { sku: 'starter' });
  await run();
  expect(sent).toEqual([['first_run', 'shop_view'], ['paysheet_open']]);
});

test('attach는 이미 기록된 first_run을 훑고 보낸 플래그는 다음 실행에도 유지된다', async () => {
  const storage = memory({ [FUNNEL_SENT_KEY]: JSON.stringify(['first_run']) });
  const a = setup({ storage });
  a.log.track('first_run'); a.log.track('tutorial_complete', { steps: 3 });
  a.up.attach(a.log); await a.run();
  expect(a.sent).toEqual([['tutorial_complete']]);
});

test('실패하면 다음 기회까지 남기고 503이면 이번 실행에서 멈춘다', async () => {
  const a = setup({ fail: new Error('offline') });
  a.up.attach(a.log); a.log.track('first_run'); await a.run();
  expect(a.up.pendingSteps()).toEqual(['first_run']); expect(a.storage.getItem(FUNNEL_SENT_KEY)).toBeNull();
  const b = setup({ fail: Object.assign(new Error('x'), { status: 503 }) });
  b.up.attach(b.log); b.log.track('first_run'); await b.run();
  b.log.track('shop_view', { tab: 'hot' }); expect(b.timers.length).toBe(0);
});

test('계정이 준비되기 전에는 보내지 않고 준비되면 보낸다', async () => {
  let ready = false;
  const a = setup({ isReady: () => ready });
  a.up.attach(a.log); a.log.track('first_run');
  await a.run(); expect(a.sent.length).toBe(0);
  ready = true; await a.run(); expect(a.sent).toEqual([['first_run']]);
});

test('가입 단계 밖 이벤트는 보내지 않고 잘못된 이벤트 기록 실패도 무시한다', async () => {
  const a = setup(); a.up.attach(a.log);
  a.log.track('gacha_pull', { count: 1, currency: 'gems' }); expect(a.log.track('nope' as any).ok).toBe(false);
  expect(a.timers.length).toBe(0); expect(a.sent.length).toBe(0);
});
