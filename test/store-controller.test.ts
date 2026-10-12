import { test, expect } from 'bun:test';
import { StoreController } from '../src/platform/store-controller.js';

function fixture(channel = 'apps-in-toss') {
  const calls: string[] = [], app: any = { mode: 'lobby', stageStarting: false, input: { clear() { calls.push('clear'); } },
    eco: { s: { gems: 17, purchases: [], vip: 0 } } };
  const controller: any = new StoreController(app, { channel, fetcher: (async () => new Response('{}')) as any, load: async () => ({} as any) });
  return { controller, app, calls };
}

test('미연결 구매와 복원은 게임·현금 상태를 변경하거나 SDK를 실행하지 않는다', async () => {
  const { controller, app } = fixture(), before = JSON.stringify(app.eco.s);
  let purchases = 0;
  controller.adapter = { purchase: async () => { purchases++; } };
  expect((await controller.purchase()).ok).toBe(false);
  expect((await controller.restore()).ok).toBe(false);
  expect(purchases).toBe(0); expect(JSON.stringify(app.eco.s)).toBe(before);
});

test('전투·입장 준비·동시 광고 중에는 새 SDK 실행과 저장을 시작하지 않는다', async () => {
  const { controller, app } = fixture();
  let ads = 0, complete: any;
  controller.capabilities = { ads: true, billing: false };
  controller.adapter = { showAd: () => { ads++; return new Promise(resolve => { complete = resolve; }); } };
  app.mode = 'battle'; expect((await controller.showAd()).ok).toBe(false);
  app.mode = 'lobby'; app.stageStarting = true; expect((await controller.showAd()).ok).toBe(false);
  app.stageStarting = false;
  const first = controller.showAd();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect((await controller.showAd()).ok).toBe(false);
  complete(); expect((await first).ok).toBe(true); expect(ads).toBe(1); expect(controller.busy).toBe(false);
});

test('API 실패와 위조 지급 응답은 구매 성공으로 전달되지 않는다', async () => {
  const { controller } = fixture();
  controller.session = { token: 'test', subject: 'test', expiresAt: Date.now() + 120000 };
  controller.capabilities = { billing: true, ads: false };
  controller.adapter = { purchase: async (verify: any) => { await verify({ orderId: 'order' }); } };
  controller.fetcher = async (url: string) => Response.json(url.endsWith('/orders') ? { intentId: 'one' } : { adFree: false });
  expect((await controller.purchase()).ok).toBe(false);
  controller.fetcher = async () => new Response('', { status: 503 });
  expect((await controller.purchase()).ok).toBe(false);
  expect(controller.busy).toBe(false);
});

test('만료 전 계정 재인증과 서버 검증이 SDK 지급보다 먼저 일어난다', async () => {
  const { controller } = fixture(), order: string[] = [];
  controller.capabilities = { billing: true, ads: false };
  controller.adapter = { authenticate: async () => { order.push('auth'); return { code: 'one-use' }; },
    purchase: async (verify: any, account: string) => { expect(account).toBe('server-issued-account'); order.push('purchase'); await verify({ orderId: 'receipt' }); order.push('grant-confirmed'); } };
  controller.fetcher = async (url: string) => {
    if (url.endsWith('/auth')) { order.push('auth-server'); return Response.json({ token: 'session', subject: 'one', expiresAt: Date.now() + 120000 }); }
    if (url.endsWith('/orders')) { order.push('prepared'); return Response.json({ intentId: 'intent', obfuscatedAccountId: 'server-issued-account' }); }
    order.push('verified-server'); return Response.json({ adFree: true });
  };
  expect((await controller.purchase()).ok).toBe(true);
  expect(order).toEqual(['auth', 'auth-server', 'prepared', 'purchase', 'verified-server', 'grant-confirmed']);
});

test('지연 초기화는 퇴장 뒤 adapter와 방향을 되살리지 않으며 캐시 복귀는 새 lifetime을 쓴다', async () => {
  const { controller } = fixture();
  let resolve: any, disposed = 0, oriented = 0;
  const adapter = { dispose: async () => { disposed++; }, orient: async () => { oriented++; } };
  controller.load = () => new Promise(done => { resolve = done; });
  const pending = controller.activate();
  await controller.suspend(); resolve(adapter); await pending;
  expect(controller.adapter).toBeNull(); expect(controller.capabilities).toBeNull(); expect(disposed).toBe(1); expect(oriented).toBe(0);
  controller.load = async () => adapter; controller.fetcher = async () => Response.json({ billing: false, ads: true });
  await controller.resume(); expect(controller.active()).toBe(true); expect(oriented).toBe(1);
  await controller.dispose(); await controller.init(); expect(controller.active()).toBe(false); expect(controller.adapter).toBeNull();
});
