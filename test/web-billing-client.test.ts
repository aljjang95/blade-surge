import { describe, expect, test } from 'bun:test';
import { validateCustomer } from '../src/ui/customer-info.js';
import { createHeroPurchase, PENDING_KEY } from '../src/platform/hero-purchase.js';

const PID = 'bsw_' + 'a'.repeat(32);
const intentOf = (productId = 'hero_knight_v1') => ({ paymentId: PID, productId, storeId: 'store-x', channelKey: 'channel-key-x', orderName: '영웅 해금', totalAmount: 5900, currency: 'KRW', payMethod: 'CARD', customData: '{"productId":"' + productId + '"}' });

class MemStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

function rig(opts: { flags?: Record<string, boolean>; webBilling?: boolean; complete?: any; intent?: any; sdk?: any; search?: string; channel?: string; billing?: any; authority?: string | null; askCustomer?: () => Promise<any> } = {}) {
  const calls: any[] = [], applied: any[] = [], storage = new MemStorage();
  const api = {
    async me() { return { flags: { webBilling: opts.webBilling ?? true, ...(opts.flags ?? {}) } }; },
    async request(method: string, path: string, body: any) {
      calls.push([method, path, body]);
      if (path === '/iap/web/intent') { if (opts.intent instanceof Error) throw opts.intent; return opts.intent ?? intentOf(body.productId); }
      if (path === '/iap/web/complete') { const r = typeof opts.complete === 'function' ? opts.complete(body) : opts.complete; if (r instanceof Error) throw r; return r ?? { state: 'granted', grants: [], entitlements: { heroes: ['knight'] } }; }
      throw new Error('path');
    },
  };
  const eco = { applyIapState(state: any) { applied.push(state); return []; } };
  const payCalls: any[] = [];
  const sdk = opts.sdk === undefined ? { requestPayment: async (req: any) => { payCalls.push(req); return { paymentId: req.paymentId }; } } : opts.sdk;
  const hp = createHeroPurchase({ api, eco, channel: opts.channel ?? 'web', billing: opts.billing ?? null, authority: () => opts.authority === undefined ? 'server' : opts.authority, loadSdk: async () => sdk, askCustomer: opts.askCustomer, storage, now: () => 1000,
    location: { origin: 'https://blade.example', search: opts.search ?? '', pathname: '/' }, history: { replaceState() {} } });
  return { hp, calls, applied, payCalls, storage };
}
const apiErr = (status: number, error: string) => Object.assign(new Error(error), { status, body: { error } });

describe('구매자 정보(KG이니시스 필수)', () => {
  const who = { fullName: '홍길동', phoneNumber: '01012345678', email: 'a@b.co' };
  test('결제창 호출에 customer가 전달되고, 입력은 intent 요청 본문에 섞이지 않는다', async () => {
    const { hp, payCalls, calls } = rig({ askCustomer: async () => who });
    await hp.init();
    await hp.buy('hero_knight_v1');
    expect(payCalls[0].customer).toEqual(who);
    expect(JSON.stringify(calls)).not.toContain('01012345678');
  });
  test('입력 검증: 이름·휴대폰·이메일 형식', () => {
    expect(validateCustomer({ fullName: '홍길동', phoneNumber: '010-1234-5678', email: 'a@b.co' })).toEqual({ ok: true, customer: who });
    expect(validateCustomer({ fullName: '', phoneNumber: '01012345678', email: 'a@b.co' }).ok).toBe(false);
    expect(validateCustomer({ fullName: '홍길동', phoneNumber: '12345', email: 'a@b.co' })).toMatchObject({ ok: false, field: 'phoneNumber' });
    expect(validateCustomer({ fullName: '홍길동', phoneNumber: '01012345678', email: 'nope' })).toMatchObject({ ok: false, field: 'email' });
  });
  test('취소하면 customer-cancelled이고 서버를 부르지 않는다', async () => {
    const { hp, calls, payCalls } = rig({ askCustomer: async () => null });
    await hp.init();
    expect(await hp.buy('hero_knight_v1')).toEqual({ ok: false, reason: 'customer-cancelled' });
    expect(calls).toEqual([]);
    expect(payCalls).toEqual([]);
  });
});

describe('영웅 해금 구매 클라이언트 (hero-purchase)', () => {
  test('그림자·로컬 모드 계정은 서버가 웹 결제를 알려도 available=false이고 buy는 서버를 부르지 않는다', async () => {
    for (const authority of ['shadow', 'off', null]) {
      const { hp, calls } = rig({ authority });
      await hp.init();
      expect(hp.available()).toBe(false);
      expect(await hp.buy('hero_knight_v1')).toEqual({ ok: false, reason: 'unavailable' });
      expect(calls).toEqual([]);
    }
    const server = rig({ authority: 'server' });
    expect(await server.hp.init()).toBe(true);
  });

  test('기본은 사용 불가: init 전·서버가 웹 결제를 알리지 않으면 available=false이고 buy는 서버를 부르지 않는다', async () => {
    const off = rig({ webBilling: false });
    expect(off.hp.available()).toBe(false);
    await off.hp.init();
    expect(off.hp.available()).toBe(false);
    expect(await off.hp.buy('hero_knight_v1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(off.calls).toHaveLength(0);
    const on = rig();
    expect(on.hp.available()).toBe(false);
    await on.hp.init();
    expect(on.hp.available()).toBe(true);
  });

  test('정상: intent → 결제창 → complete(granted) → applyIapState(서버 응답) 뒤에만 ok:true', async () => {
    const t = rig();
    await t.hp.init();
    const r = await t.hp.buy('hero_knight_v1');
    expect(r).toMatchObject({ ok: true, state: 'granted' });
    expect(t.calls.map((c) => c[1])).toEqual(['/iap/web/intent', '/iap/web/complete']);
    expect(t.calls[0][2]).toEqual({ productId: 'hero_knight_v1' }); // 금액은 보내지 않는다
    expect(t.calls[1][2]).toEqual({ paymentId: PID });
    expect(t.payCalls[0]).toMatchObject({ paymentId: PID, totalAmount: 5900, currency: 'KRW', storeId: 'store-x', channelKey: 'channel-key-x' });
    expect(t.payCalls[0].redirectUrl).toBe('https://blade.example/?bs_pay=' + PID);
    expect(t.applied).toHaveLength(1);
    expect(t.storage.getItem(PENDING_KEY)).toBeNull();
  });

  test('서버가 granted를 주기 전에는 성공을 내지 않는다: pending·cancelled·failed·verify 오류·저장 실패', async () => {
    for (const [complete, reason] of [[{ state: 'pending' }, 'pending'], [{ state: 'cancelled' }, 'cancelled'], [{ state: 'failed' }, 'failed'], [{}, 'verify-failed'], [apiErr(502, 'portone-unavailable'), 'verify-failed'], [apiErr(503, 'web-billing-disabled'), 'billing-disabled']] as const) {
      const t = rig({ complete });
      await t.hp.init();
      const r = await t.hp.buy('hero_mage_v1');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe(reason);
      expect(t.applied).toHaveLength(0);
    }
    // 지급은 됐지만 로컬 저장이 실패하면 ok가 아니다
    const t = rig();
    const failing = createHeroPurchase({ authority: () => 'server', api: { me: async () => ({ flags: { webBilling: true } }), request: async (_m: string, p: string) => (p.endsWith('intent') ? intentOf() : { state: 'granted' }) },
      eco: { applyIapState: () => null }, channel: 'web', loadSdk: async () => ({ requestPayment: async () => ({}) }), storage: new MemStorage() });
    await failing.init();
    expect(await failing.buy('hero_knight_v1')).toEqual({ ok: false, reason: 'storage' });
  });

  test('결제창 취소·실패·SDK 없음은 ok:false이고 complete를 부르지 않는다', async () => {
    const cancelled = rig({ sdk: { requestPayment: async () => ({ code: 'PAY_PROCESS_CANCELED', message: 'x' }) } });
    await cancelled.hp.init();
    expect(await cancelled.hp.buy('hero_knight_v1')).toEqual({ ok: false, reason: 'cancelled' });
    expect(cancelled.calls.map((c) => c[1])).toEqual(['/iap/web/intent']);
    expect(cancelled.storage.getItem(PENDING_KEY)).toBeNull();
    const failed = rig({ sdk: { requestPayment: async () => ({ code: 'FAILURE_TYPE_PG' }) } });
    await failed.hp.init();
    expect((await failed.hp.buy('hero_knight_v1')).reason).toBe('payment-failed');
    const thrown = rig({ sdk: { requestPayment: async () => { throw new Error('boom'); } } });
    await thrown.hp.init();
    expect((await thrown.hp.buy('hero_knight_v1')).reason).toBe('payment-failed');
    const noSdk = rig({ sdk: null });
    await noSdk.hp.init();
    expect((await noSdk.hp.buy('hero_knight_v1')).reason).toBe('sdk-unavailable');
  });

  test('intent 거부 사유를 그대로 전달하고 잘못된 상품 id는 서버를 부르지 않는다', async () => {
    const t = rig({ intent: apiErr(409, 'not-eligible') });
    await t.hp.init();
    expect((await t.hp.buy('hero_knight_v1')).reason).toBe('not-eligible');
    expect((await t.hp.buy('gems_300_v1')).reason).toBe('unknown-product'); // 보석 팩은 웹에서 팔지 않는다(Play 단독)
    expect((await t.hp.buy('starter_pack_v1')).reason).toBe('not-eligible'); // 즉시 지급형은 웹 상품이라 서버까지 간다
    expect((await t.hp.buy(42 as any)).reason).toBe('unknown-product');
    expect(t.calls).toHaveLength(2);
    const off = rig({ intent: apiErr(503, 'web-billing-disabled') });
    await off.hp.init();
    expect((await off.hp.buy('hero_knight_v1')).reason).toBe('billing-disabled');
    // 서버 응답의 상품이 요청과 다르면 결제창을 열지 않는다
    const wrong = rig({ intent: intentOf('hero_all_v1') });
    await wrong.hp.init();
    expect((await wrong.hp.buy('hero_knight_v1')).reason).toBe('intent-failed');
    expect(wrong.payCalls).toHaveLength(0);
  });

  test('결제창이 열린 채 끊겨도 보류 paymentId가 남고 resume()이 서버 complete로 확정한다', async () => {
    const t = rig({ complete: apiErr(502, 'portone-unavailable') });
    await t.hp.init();
    expect((await t.hp.buy('hero_knight_v1')).reason).toBe('verify-failed');
    expect(JSON.parse(t.storage.getItem(PENDING_KEY)!)).toMatchObject({ paymentId: PID, productId: 'hero_knight_v1' });
    const again = rig({});
    again.storage.setItem(PENDING_KEY, t.storage.getItem(PENDING_KEY)!);
    const hp = createHeroPurchase({ authority: () => 'server', api: { me: async () => ({ flags: { webBilling: true } }), request: async (_m: string, p: string, b: any) => { again.calls.push([_m, p, b]); return { state: 'granted' }; } },
      eco: { applyIapState: (s: any) => { again.applied.push(s); return []; } }, channel: 'web', storage: again.storage, now: () => 2000, location: { origin: 'x', search: '', pathname: '/' } });
    await hp.init();
    expect(await hp.resume()).toMatchObject({ ok: true });
    expect(again.calls[0][2]).toEqual({ paymentId: PID });
    expect(again.storage.getItem(PENDING_KEY)).toBeNull();
  });

  test('모바일 리다이렉트 복귀: 주소의 paymentId로 complete, code가 있으면 실패 처리(서버 호출 없음), 사용 불가면 아무것도 안 함', async () => {
    const back = rig({ search: `?paymentId=${PID}&transactionType=PAYMENT&txId=t1` });
    await back.hp.init();
    expect(await back.hp.resume()).toMatchObject({ ok: true });
    expect(back.calls[0]).toEqual(['POST', '/iap/web/complete', { paymentId: PID }]);
    const cancelled = rig({ search: `?paymentId=${PID}&code=PAY_PROCESS_CANCELED&message=x` });
    await cancelled.hp.init();
    expect(await cancelled.hp.resume()).toEqual({ ok: false, reason: 'cancelled' });
    expect(cancelled.calls).toHaveLength(0);
    const off = rig({ webBilling: false, search: `?paymentId=${PID}` });
    await off.hp.init();
    expect(await off.hp.resume()).toBeNull();
    expect(off.calls).toHaveLength(0);
    // 형식이 틀린 주소 값은 서버로 보내지 않는다
    const bad = rig({ search: '?paymentId=../x' });
    await bad.hp.init();
    expect(await bad.hp.resume()).toBeNull();
  });

  test('Play 채널: 사용 가능 여부와 구매를 기존 billing-service에 위임한다', async () => {
    const billing = { available: () => true, buy: async (id: string) => ({ ok: true, state: 'granted', got: [], id }) };
    const t = rig({ channel: 'googleplay', billing });
    expect(t.hp.available()).toBe(true);
    expect(await t.hp.buy('hero_all_v1')).toMatchObject({ ok: true, id: 'hero_all_v1' });
    expect(t.calls).toHaveLength(0);
    expect(rig({ channel: 'googleplay', billing: { available: () => false, buy: async () => ({ ok: true }) } }).hp.available()).toBe(false);
    expect(rig({ channel: 'googleplay' }).hp.available()).toBe(false);
    expect(rig({ channel: 'onestore' }).hp.available()).toBe(false);
  });

  test('가격 문구: 웹은 카탈로그 금액, Play는 스토어가 확인한 판매 가능 가격만, 없으면 null', async () => {
    const web = rig(); expect(web.hp.price('hero_knight_v1')).toBeNull(); await web.hp.init();
    expect(web.hp.price('hero_knight_v1')).toBe('₩5,900'); expect(web.hp.price('nope')).toBeNull();
    const store = new Map<string, any>([['hero_knight_v1', { formattedPrice: '₩6,100', sellable: true }], ['hero_mage_v1', { formattedPrice: '₩6,100', sellable: false }]]);
    const play = rig({ channel: 'googleplay', billing: { available: () => true, product: (id: string) => store.get(id) ?? null } });
    expect(play.hp.price('hero_knight_v1')).toBe('₩6,100');
    expect(play.hp.price('hero_mage_v1')).toBeNull(); expect(play.hp.price('hero_rogue_v1')).toBeNull();
    const off = rig({ channel: 'googleplay', billing: { available: () => false, product: () => ({ formattedPrice: '₩1', sellable: true }) } });
    expect(off.hp.price('hero_knight_v1')).toBeNull();
  });
});

describe('영웅 권한 시작·복귀 동기화 (syncState)', () => {
  const { Economy } = require('../src/game/economy.js');
  const { createMemoryStorage } = require('../src/game/economy-core.js');
  const stateRig = (heroes: string[], opts: { fail?: boolean; webBilling?: boolean } = {}) => {
    const eco = new Economy({ storage: createMemoryStorage() });
    let t = 1000, calls = 0, current = heroes;
    const api = {
      async me() { return { flags: { webBilling: opts.webBilling ?? false } }; },
      async request(method: string, path: string) {
        if (method === 'GET' && path === '/iap/state') { calls++; if (opts.fail) throw new Error('offline'); return { grants: [], reversals: [], entitlements: { heroes: current } }; }
        throw new Error('path ' + path);
      },
    };
    const hp = createHeroPurchase({ authority: () => 'server', api, eco, channel: 'web', billing: null, loadSdk: async () => null, storage: new MemStorage(), now: () => t,
      location: { origin: 'https://blade.example', search: '', pathname: '/' }, history: { replaceState() {} } });
    return { eco, hp, calls: () => calls, setServer: (h: string[]) => { current = h; }, advance: (ms: number) => { t += ms; } };
  };

  test('pending 없이 cron이 지급한 결제도 시작 때 열린다(웹 판매 스위치가 꺼져 있어도)', async () => {
    const r = stateRig(['mage'], { webBilling: false });
    await r.hp.init();
    expect(r.hp.available()).toBe(false);
    expect(r.eco.ownHero('mage')).toBe(false);
    expect(await r.hp.syncState()).toBe(true);
    expect(r.eco.ownHero('mage')).toBe(true);
  });

  test('환불 뒤 시작하면 회수가 반영된다(데이터는 보존, 잠금만)', async () => {
    const r = stateRig(['mage']);
    await r.hp.syncState();
    r.eco.s.heroes.mage.level = 12;
    r.setServer([]); r.advance(60000);
    expect(await r.hp.syncState()).toBe(true);
    expect(r.eco.ownHero('mage')).toBe(false);
    expect(r.eco.s.heroes.mage.level).toBe(12);
  });

  test('실패는 조용히 false이고 연속 복귀는 간격으로 묶인다', async () => {
    const bad = stateRig(['mage'], { fail: true });
    expect(await bad.hp.syncState()).toBe(false);
    const ok = stateRig(['mage']);
    expect(await ok.hp.syncState()).toBe(true);
    expect(await ok.hp.syncState()).toBe(false);
    expect(ok.calls()).toBe(1);
    ok.advance(20000);
    await ok.hp.syncState();
    expect(ok.calls()).toBe(2);
  });
});

describe('상태 응답 순서 (오래된 권한 목록이 방금 산 영웅을 다시 잠그지 않는다)', () => {
  const { Economy } = require('../src/game/economy.js');
  const { createMemoryStorage } = require('../src/game/economy-core.js');
  function lateRig() {
    const eco = new Economy({ storage: createMemoryStorage() });
    let release: (v: any) => void = () => {};
    const held = new Promise<any>((res) => { release = res; });
    let stateCalls = 0;
    const api = {
      async me() { return { flags: { webBilling: true } }; },
      async request(method: string, path: string, body: any) {
        if (method === 'GET' && path === '/iap/state') { stateCalls++; return held; }
        if (path === '/iap/web/intent') return intentOf(body.productId);
        if (path === '/iap/web/complete') return { state: 'granted', grants: [], entitlements: { heroes: ['mage'] }, serverTime: 2000 };
        throw new Error('path ' + path);
      },
    };
    const hp = createHeroPurchase({ authority: () => 'server', api, eco, channel: 'web', billing: null, storage: new MemStorage(), now: () => 1000,
      loadSdk: async () => ({ requestPayment: async (req: any) => ({ paymentId: req.paymentId }) }),
      location: { origin: 'https://blade.example', search: '', pathname: '/' }, history: { replaceState() {} } });
    return { eco, hp, release, stateCalls: () => stateCalls };
  }

  test('지연된 빈 권한 응답을 보류 → mage 구매 완료 → 보류 응답 반환 → mage 계속 열림', async () => {
    const r = lateRig();
    await r.hp.init();
    const sync = r.hp.syncState();
    await new Promise((res) => setTimeout(res, 0));
    expect(r.stateCalls()).toBe(1);
    const bought = await r.hp.buy('hero_mage_v1');
    expect(bought.ok).toBe(true);
    expect(r.eco.ownHero('mage')).toBe(true);
    r.release({ grants: [], reversals: [], entitlements: { heroes: [] }, serverTime: 1000 });
    expect(await sync).toBe(false); // 더 최근에 시작한 요청이 이미 적용돼 오래된 응답은 버린다
    expect(r.eco.ownHero('mage')).toBe(true);
  });

  test('구매보다 먼저 끝난 상태 응답은 그대로 적용된다', async () => {
    const r = lateRig();
    await r.hp.init();
    const sync = r.hp.syncState();
    await new Promise((res) => setTimeout(res, 0));
    r.release({ grants: [], reversals: [], entitlements: { heroes: ['rogue'] }, serverTime: 1000 });
    expect(await sync).toBe(true);
    expect(r.eco.ownHero('rogue')).toBe(true);
  });
});

describe('웹 간편결제 선택', () => {
  const who = { fullName: '홍길동', phoneNumber: '01012345678', email: 'a@b.co' };
  test('서버가 켠 수단만 묻고, 고른 간편결제는 intent 본문(method)과 결제창(easyPay)에 실린다', async () => {
    let asked: any = null;
    const intent = { paymentId: 'bsw_' + 'c'.repeat(32), productId: 'hero_knight_v1', storeId: 's', channelKey: 'k', orderName: 'o', totalAmount: 5900, currency: 'KRW',
      payMethod: 'EASY_PAY', easyPay: { easyPayProvider: 'KAKAOPAY' }, customData: '{}' };
    const { hp, calls, payCalls } = rig({ flags: { webKakaoPay: true }, intent, askCustomer: async (m?: any) => { asked = m; return { ...who, method: 'KAKAOPAY' }; } });
    await hp.init();
    expect(hp.methods()).toEqual(['CARD', 'KAKAOPAY']);
    await hp.buy('hero_knight_v1');
    expect(asked).toEqual(['CARD', 'KAKAOPAY']);
    expect(calls[0][2]).toEqual({ productId: 'hero_knight_v1', method: 'KAKAOPAY' });
    expect(payCalls[0]).toMatchObject({ payMethod: 'EASY_PAY', easyPay: { easyPayProvider: 'KAKAOPAY' } });
  });
  test('꺼진 수단을 골라도 카드로 요청한다(본문에 method 없음)', async () => {
    const { hp, calls } = rig({ askCustomer: async () => ({ ...who, method: 'NAVERPAY' }) });
    await hp.init();
    await hp.buy('hero_knight_v1');
    expect(calls[0][2]).toEqual({ productId: 'hero_knight_v1' });
  });
});
