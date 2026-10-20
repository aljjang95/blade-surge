// 시작 단계 호환성: WebGL2 컨텍스트 확보와 시작 실패 분류.
// 화면·복사 정보에는 허용 목록의 단계·코드·빌드 이름만 싣는다. 원문 오류·저장 내용·기기 식별값은 넣지 않는다.

/** Three r170 이 직접 만들던 컨텍스트와 같은 속성. powerPreference 만 시도마다 바뀐다. */
export const RENDER_CONTEXT_ATTRIBUTES = Object.freeze({
  alpha: true, depth: true, stencil: false, antialias: false,
  premultipliedAlpha: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
});
/** 고성능 요청이 거절된 기기만 기본 GPU 선택으로 한 번 더 시도한다(최대 2회). */
export const POWER_PREFERENCES = Object.freeze(['high-performance', 'default']);
/** 문의용 정보에 싣는 컨텍스트 요청 결과. 이 목록 밖의 값은 쓰지 않는다. */
const ATTEMPT_RESULTS = Object.freeze({ null: '없음', threw: '예외', lost: '손실됨', ok: '성공' });

export const STARTUP_STAGES = Object.freeze(['renderer', 'effects', 'input', 'save', 'interface', 'platform', 'settings', 'assets', 'world', 'shaders', 'start', 'lobby']);

const APP_MESSAGE = '게임을 시작하는 중 오류가 발생했습니다. 그래픽(WebGL 2) 지원 문제로 확인된 오류는 아닙니다. 다시 시도해도 같으면 아래 오류 코드를 알려 주세요.';
const FAILURES = Object.freeze({
  'gfx-no-webgl2': { code: 'BS-GFX-01', kind: 'graphics', title: '이 브라우저는 WebGL 2를 지원하지 않습니다',
    message: '블레이드 서지는 WebGL 2 그래픽이 필요합니다. 최신 Chrome·Edge·Safari·삼성 인터넷으로 열어 주세요.' },
  'gfx-webgl2-denied': { code: 'BS-GFX-02', kind: 'graphics', title: '이 기기에서 WebGL 2 화면을 만들 수 없습니다',
    message: '브라우저가 이 기기의 그래픽으로 WebGL 2 화면을 허용하지 않았습니다. 브라우저를 최신 버전으로 업데이트하거나 다른 브라우저에서 열어 주세요.' },
  'gfx-webgl-off': { code: 'BS-GFX-03', kind: 'graphics', title: '그래픽 가속(WebGL)을 사용할 수 없습니다',
    message: '브라우저 설정에서 하드웨어 가속(그래픽 가속)을 켜고 브라우저를 다시 연 뒤 시도해 주세요. 그래도 같으면 다른 브라우저에서 열어 주세요.' },
  'gfx-init': { code: 'BS-GFX-04', kind: 'graphics', title: '그래픽 화면을 초기화하지 못했습니다',
    message: 'WebGL 2 화면은 만들었지만 초기화에 실패했습니다. 다른 탭을 닫고 다시 시도하거나 다른 브라우저에서 열어 주세요.' },
  'gfx-shader': { code: 'BS-GFX-05', kind: 'graphics', title: '그래픽 효과를 준비하지 못했습니다',
    message: '그래픽 장치가 게임 효과를 준비하지 못했습니다. 다시 시도해도 같으면 다른 브라우저에서 열어 주세요.' },
  'gfx-context-lost': { code: 'BS-GFX-06', kind: 'graphics', title: '그래픽 장치가 화면을 바로 반납했습니다',
    message: '브라우저가 WebGL 2 화면을 만들자마자 그래픽 장치를 회수했습니다. 다른 탭이나 앱을 닫고 다시 시도해 주세요. 계속되면 브라우저를 다시 열어 주세요.' },
  load: { code: 'BS-LOAD-01', kind: 'load', title: '게임 데이터를 불러오지 못했습니다',
    message: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.' },
});

export class GraphicsStartupError extends Error {
  /** @param {string} reason @param {unknown} [cause] @param {{ powerPreference: string, result: string }[]} [attempts] */
  constructor(reason, cause, attempts = []) {
    super('graphics startup failed: ' + reason);
    this.name = 'GraphicsStartupError'; this.reason = reason; this.attempts = attempts;
    if (cause !== undefined) this.cause = cause;
  }
}

/** WebGL1 진단 컨텍스트를 만들어 보고 즉시 반납한다. 게임 캔버스는 건드리지 않는다. */
function webgl1Available(doc) {
  try {
    const gl = doc?.createElement('canvas').getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

/** @typedef {{ WebGL2RenderingContext?: unknown, document?: { createElement(tag: string): any } }} GraphicsWindow */

/** WebGL2 를 만들지 못한 이유를 API 부재 / WebGL2 만 거절 / WebGL 전체 불가로 나눈다. @param {GraphicsWindow} [win] */
export function graphicsUnavailableReason(win = globalThis) {
  if (typeof win.WebGL2RenderingContext !== 'function') return 'gfx-no-webgl2';
  return webgl1Available(win.document) ? 'gfx-webgl2-denied' : 'gfx-webgl-off';
}

/**
 * 게임 캔버스에 WebGL2 컨텍스트를 하나만 만든다. 실패한 getContext 는 캔버스에 컨텍스트를 남기지 않으므로
 * 다음 시도가 같은 캔버스에서 새 속성으로 진행된다. Three 의 무속성 진단 호출(기본 속성 컨텍스트가 캔버스에 묶임)을 피한다.
 * getContext 가 null 을 주거나 예외를 던지면 그 시도만 실패로 보고 다음 선택으로 넘어간다(최대 2회).
 * 이미 손실된 컨텍스트는 캔버스에 묶여 다시 요청해도 같은 객체가 오므로 재시도하지 않는다.
 * 캔버스가 없거나 getContext 가 없는 것은 그래픽 지원 문제가 아니므로 원래 예외 그대로 던진다.
 * @param {{ getContext(type: string, attributes?: object): any }} canvas
 * @param {{ win?: GraphicsWindow, attributes?: object }} [options]
 */
export function acquireWebGL2Context(canvas, { win = globalThis, attributes = RENDER_CONTEXT_ATTRIBUTES } = {}) {
  if (typeof canvas?.getContext !== 'function') throw new TypeError('game canvas cannot create a rendering context');
  const attempts = [];
  let lastError;
  for (const powerPreference of POWER_PREFERENCES) {
    let context = null;
    try { context = canvas.getContext('webgl2', { ...attributes, powerPreference }); }
    catch (error) { lastError = error; attempts.push({ powerPreference, result: 'threw' }); continue; }
    if (!context) { attempts.push({ powerPreference, result: 'null' }); continue; }
    if (typeof context.isContextLost === 'function' && context.isContextLost()) {
      attempts.push({ powerPreference, result: 'lost' });
      throw new GraphicsStartupError('gfx-context-lost', lastError, attempts);
    }
    attempts.push({ powerPreference, result: 'ok' });
    return { context, powerPreference, attempts };
  }
  throw new GraphicsStartupError(graphicsUnavailableReason(win), lastError, attempts);
}

/** @param {unknown} error @param {string} stage */
export function classifyStartupFailure(error, stage) {
  const safeStage = STARTUP_STAGES.includes(stage) ? stage : 'unknown';
  const graphics = error instanceof GraphicsStartupError || /** @type {any} */ (error)?.name === 'GraphicsStartupError'
    ? FAILURES[/** @type {any} */ (error).reason] : null;
  if (graphics) return { ...graphics, stage: safeStage, attempts: contextAttempts(/** @type {any} */ (error).attempts) };
  if (safeStage === 'shaders' && /^Shader program did not link/.test(String(/** @type {any} */ (error)?.message || ''))) return { ...FAILURES['gfx-shader'], stage: safeStage };
  if (safeStage === 'assets') return { ...FAILURES.load, stage: safeStage };
  return { code: 'BS-APP-' + safeStage.toUpperCase(), kind: 'app', title: '게임을 시작하지 못했습니다', message: APP_MESSAGE, stage: safeStage };
}

/** 컨텍스트 요청 기록을 허용 목록 문구로만 바꾼다. */
function contextAttempts(attempts) {
  if (!Array.isArray(attempts)) return '';
  return attempts.filter(a => POWER_PREFERENCES.includes(a?.powerPreference) && Object.hasOwn(ATTEMPT_RESULTS, a?.result))
    .map(a => a.powerPreference + ' ' + ATTEMPT_RESULTS[a.result]).join(', ');
}

/** 저장 공간 접근 가능 여부만 읽는다. 값을 읽거나 쓰지 않는다. */
export function storageAvailability(win = globalThis) {
  try { const storage = win.localStorage; return storage && typeof storage.getItem === 'function' ? '사용 가능' : '사용 불가'; }
  catch { return '차단됨'; }
}

/** 해시가 붙은 번들 파일 이름만 빌드 식별값으로 쓴다. */
export function buildIdentity(moduleUrl) {
  try { const name = new URL(moduleUrl).pathname.split('/').pop() || ''; return /^[\w.-]{1,80}$/.test(name) ? name : 'unknown'; }
  catch { return 'unknown'; }
}

/** 문의용 복사 정보. 허용 목록 필드만 쓴다. */
export function startupFailureDetails(failure, { build, webgl2Api, storage, at }) {
  return [
    '오류 코드: ' + failure.code,
    '단계: ' + failure.stage,
    '빌드: ' + build,
    'WebGL 2 API: ' + (webgl2Api ? '있음' : '없음'),
    ...(failure.attempts ? ['WebGL 2 요청: ' + failure.attempts] : []),
    '저장 공간: ' + storage,
    '시각: ' + at,
  ].join('\n');
}

/**
 * MediaQueryList 변경 구독. addEventListener 가 있으면 그것만 쓰고, 없는 구형 브라우저는 addListener 로 한 번만 구독한다.
 * 둘 다 없으면 구독하지 않는다(현재 값 읽기는 그대로 동작). 해제 함수를 돌려준다.
 * @param {any} query @param {() => void} listener
 */
export function onMediaQueryChange(query, listener) {
  if (typeof query?.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener?.('change', listener);
  }
  if (typeof query?.addListener === 'function') {
    query.addListener(listener);
    return () => query.removeListener?.(listener);
  }
  return () => {};
}
