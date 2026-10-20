import { afterEach, expect, test } from 'bun:test';
import {
  POWER_PREFERENCES, RENDER_CONTEXT_ATTRIBUTES, GraphicsStartupError, acquireWebGL2Context, buildIdentity,
  classifyStartupFailure, graphicsUnavailableReason, onMediaQueryChange, startupFailureDetails, storageAvailability,
} from '../src/platform/startup-compat.js';
import { readCitadelCommandCollapsed, writeCitadelCommandCollapsed } from '../src/ui/citadel-command.js';

type Call = { type: string, attributes?: Record<string, unknown> };
const canvasWith = (answer: (call: Call) => unknown) => {
  const calls: Call[] = [];
  return { calls, getContext(type: string, attributes?: Record<string, unknown>) { const call = { type, attributes }; calls.push(call); return answer(call); } };
};
const winWith = ({ api = true, webgl1 = true } = {}) => {
  const released: number[] = [];
  const doc = { createElement: () => ({ getContext: (type: string) => type === 'webgl' && webgl1
    ? { getExtension: (name: string) => name === 'WEBGL_lose_context' ? { loseContext: () => released.push(1) } : null } : null }) };
  return { released, win: { document: doc, ...(api ? { WebGL2RenderingContext: function WebGL2RenderingContext() {} } : {}) } };
};

test('normal devices keep one high-performance WebGL2 request with the renderer attributes', () => {
  const gl = { id: 'gl', isContextLost: () => false };
  const canvas = canvasWith(() => gl);
  const result = acquireWebGL2Context(canvas, winWith());
  expect(result).toMatchObject({ context: gl, powerPreference: 'high-performance' });
  expect(canvas.calls).toEqual([{ type: 'webgl2', attributes: { ...RENDER_CONTEXT_ATTRIBUTES, powerPreference: 'high-performance' } }]);
  expect(RENDER_CONTEXT_ATTRIBUTES).toMatchObject({ antialias: false, stencil: false, depth: true, alpha: true });
});

test('a refused high-performance request falls back once to the default GPU with identical attributes', () => {
  const gl = { id: 'fallback' };
  const canvas = canvasWith(call => call.attributes?.powerPreference === 'high-performance' ? null : gl);
  const result = acquireWebGL2Context(canvas, winWith());
  expect(result).toMatchObject({ context: gl, powerPreference: 'default' });
  expect(canvas.calls.map(call => call.attributes?.powerPreference)).toEqual(['high-performance', 'default']);
  // 진단용 무속성 호출로 기본 속성 컨텍스트가 게임 캔버스에 묶이지 않는다.
  expect(canvas.calls.every(call => call.type === 'webgl2' && call.attributes?.antialias === false)).toBe(true);
});

test('a high-performance request that throws still falls back once to the default GPU', () => {
  const gl = { id: 'fallback', isContextLost: () => false };
  const canvas = canvasWith(call => {
    if (call.attributes?.powerPreference === 'high-performance') throw new DOMException('Could not create a WebGL2 context.', 'NotSupportedError');
    return gl;
  });
  const result = acquireWebGL2Context(canvas, winWith());
  expect(result.context).toBe(gl);
  expect(result.powerPreference).toBe('default');
  expect(result.attempts).toEqual([{ powerPreference: 'high-performance', result: 'threw' }, { powerPreference: 'default', result: 'ok' }]);
  expect(canvas.calls.map(call => call.attributes)).toEqual(POWER_PREFERENCES.map(powerPreference => ({ ...RENDER_CONTEXT_ATTRIBUTES, powerPreference })));
});

test('throwing or mixed failed requests stop after two attempts with a graphics classification and the original cause', () => {
  const last = new Error('driver refused default');
  const cases = [
    { answer: (call: Call) => { throw call.attributes?.powerPreference === 'default' ? last : new Error('hp refused'); }, detail: 'high-performance 예외, default 예외' },
    { answer: (call: Call) => { if (call.attributes?.powerPreference === 'default') throw last; return null; }, detail: 'high-performance 없음, default 예외' },
  ];
  for (const { answer, detail } of cases) {
    const canvas = canvasWith(answer);
    let error: unknown;
    try { acquireWebGL2Context(canvas, winWith({ api: true, webgl1: true })); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(GraphicsStartupError);
    expect((error as GraphicsStartupError).reason).toBe('gfx-webgl2-denied');
    expect((error as GraphicsStartupError).cause).toBe(last);
    expect(canvas.calls.length).toBe(2);
    const failure = classifyStartupFailure(error, 'renderer');
    expect(failure).toMatchObject({ code: 'BS-GFX-02', kind: 'graphics', attempts: detail });
    expect(startupFailureDetails(failure, { build: 'b', webgl2Api: true, storage: '사용 가능', at: 't' })).toContain('WebGL 2 요청: ' + detail);
  }
});

test('an already lost context is reported once without a second request on the bound canvas', () => {
  const lost = { isContextLost: () => true };
  const canvas = canvasWith(() => lost);
  let error: unknown;
  try { acquireWebGL2Context(canvas, winWith()); } catch (caught) { error = caught; }
  expect((error as GraphicsStartupError).reason).toBe('gfx-context-lost');
  expect(canvas.calls.length).toBe(1);
  expect(classifyStartupFailure(error, 'renderer')).toMatchObject({ code: 'BS-GFX-06', kind: 'graphics', attempts: 'high-performance 손실됨' });
  // 고성능 거절 뒤 기본 요청이 손실 컨텍스트를 주면 그 결과를 그대로 알린다.
  const fallbackLost = canvasWith(call => call.attributes?.powerPreference === 'default' ? lost : null);
  try { acquireWebGL2Context(fallbackLost, winWith()); } catch (caught) { error = caught; }
  expect(classifyStartupFailure(error, 'renderer')).toMatchObject({ code: 'BS-GFX-06', attempts: 'high-performance 없음, default 손실됨' });
});

test('a missing game canvas is an app failure, not a WebGL2 capability failure', () => {
  for (const canvas of [null, {}]) {
    let error: unknown;
    try { acquireWebGL2Context(canvas as never, winWith()); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(TypeError);
    expect(classifyStartupFailure(error, 'renderer')).toMatchObject({ code: 'BS-APP-RENDERER', kind: 'app' });
  }
});

test('WebGL2 unavailability is bounded and classified by what the browser actually offers', () => {
  const cases = [
    { env: winWith({ api: false }), reason: 'gfx-no-webgl2', code: 'BS-GFX-01' },
    { env: winWith({ api: true, webgl1: true }), reason: 'gfx-webgl2-denied', code: 'BS-GFX-02' },
    { env: winWith({ api: true, webgl1: false }), reason: 'gfx-webgl-off', code: 'BS-GFX-03' },
  ];
  for (const { env, reason, code } of cases) {
    const canvas = canvasWith(() => null);
    let error: unknown;
    try { acquireWebGL2Context(canvas, env); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(GraphicsStartupError);
    expect((error as GraphicsStartupError).reason).toBe(reason);
    expect(canvas.calls.length).toBe(POWER_PREFERENCES.length);
    const failure = classifyStartupFailure(error, 'renderer');
    expect(failure).toMatchObject({ code, kind: 'graphics', stage: 'renderer' });
    expect(failure.message).not.toContain('인터넷 연결');
  }
  // WebGL1 진단 컨텍스트는 만들자마자 반납한다.
  const env = winWith({ api: true, webgl1: true });
  expect(graphicsUnavailableReason(env.win)).toBe('gfx-webgl2-denied');
  expect(env.released.length).toBe(1);
});

test('non-graphics constructor failures are not blamed on WebGL2 or the network', () => {
  for (const stage of ['save', 'interface', 'platform', 'settings', 'renderer']) {
    const failure = classifyStartupFailure(new TypeError('window.matchMedia(...).addEventListener is not a function'), stage);
    expect(failure.kind).toBe('app');
    expect(failure.code).toBe('BS-APP-' + stage.toUpperCase());
    expect(failure.message).toContain('확인된 오류는 아닙니다');
    expect(failure.message).not.toContain('인터넷 연결');
  }
  expect(classifyStartupFailure(new Error('x'), '<img src=x>').code).toBe('BS-APP-UNKNOWN');
  expect(classifyStartupFailure(new Error('fetch failed'), 'assets')).toMatchObject({ code: 'BS-LOAD-01', kind: 'load' });
  expect(classifyStartupFailure(new Error('Shader program did not link: bad'), 'shaders')).toMatchObject({ code: 'BS-GFX-05' });
  expect(classifyStartupFailure(new Error('undefined is not a function'), 'shaders').kind).toBe('app');
  expect(classifyStartupFailure(new GraphicsStartupError('gfx-init', new Error('driver')), 'renderer').code).toBe('BS-GFX-04');
});

test('support details contain only allowlisted fields', () => {
  const failure = classifyStartupFailure(new Error('secret-token=abc save={"gems":9}'), 'interface');
  const text = startupFailureDetails(failure, { build: buildIdentity('https://blade.tllhouse.com/assets/index-CPr1moYU.js'), webgl2Api: true, storage: '차단됨', at: '2026-10-15T00:00:00.000Z' });
  expect(text).toBe(['오류 코드: BS-APP-INTERFACE', '단계: interface', '빌드: index-CPr1moYU.js', 'WebGL 2 API: 있음', '저장 공간: 차단됨', '시각: 2026-10-15T00:00:00.000Z'].join('\n'));
  expect(buildIdentity('https://x/assets/a%20b<script>.js')).toBe('unknown');
  expect(buildIdentity('not a url')).toBe('unknown');
  // 컨텍스트 요청 기록도 정해진 선택·결과 문구만 남는다.
  const forged = new GraphicsStartupError('gfx-webgl2-denied', undefined, [{ powerPreference: '<img src=x>', result: 'ok' }, { powerPreference: 'default', result: 'token=abc' }, { powerPreference: 'default', result: 'null' }]);
  expect(classifyStartupFailure(forged, 'renderer').attempts).toBe('default 없음');
});

const mediaQuery = (api: { modern?: boolean, legacy?: boolean }) => {
  const log: string[] = [];
  return { log, query: {
    ...(api.modern ? { addEventListener: (type: string) => log.push('add:' + type), removeEventListener: (type: string) => log.push('remove:' + type) } : {}),
    ...(api.legacy ? { addListener: () => log.push('addListener'), removeListener: () => log.push('removeListener') } : {}),
  } };
};

test('media query changes use addEventListener once on modern browsers and addListener on legacy ones', () => {
  const both = mediaQuery({ modern: true, legacy: true });
  onMediaQueryChange(both.query, () => {})();
  expect(both.log).toEqual(['add:change', 'remove:change']);
  const legacy = mediaQuery({ legacy: true });
  const listener = () => {};
  let removed: unknown;
  (legacy.query as { removeListener?: (fn: unknown) => void }).removeListener = fn => { removed = fn; legacy.log.push('removeListener'); };
  onMediaQueryChange(legacy.query, listener)();
  expect(legacy.log).toEqual(['addListener', 'removeListener']);
  expect(removed).toBe(listener);
  const none = mediaQuery({});
  expect(() => onMediaQueryChange(none.query, () => {})()).not.toThrow();
  expect(() => onMediaQueryChange(null, () => {})()).not.toThrow();
});

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});
const denyStorage = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });

test('a denied localStorage getter does not throw from citadel command defaults', () => {
  denyStorage();
  expect(readCitadelCommandCollapsed()).toBe(false);
  expect(() => writeCitadelCommandCollapsed(true)).not.toThrow();
  expect(storageAvailability(globalThis)).toBe('차단됨');
});

test('citadel command defaults still use the real localStorage when it is available', () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) } });
  writeCitadelCommandCollapsed(true);
  expect(readCitadelCommandCollapsed()).toBe(true);
  expect(storageAvailability(globalThis)).toBe('사용 가능');
});
