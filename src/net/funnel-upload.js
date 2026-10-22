// BM: 로컬 퍼널 중 가입 단계(first_run·tutorial_complete·shop_view·paysheet_open)를 서버 /api/v1/funnel로 단계당 1회만 보낸다.
// - 보낸 단계는 localStorage 플래그로 기억해 다시 보내지 않는다. 묶어서(디바운스) 보내고, 실패하면 다음 기회에 다시 시도한다.
// - v1이 닫혀 있으면(503) 이번 실행에서는 멈춘다. 이벤트 payload·구매 토큰은 보내지 않는다(이름만).
export const FUNNEL_SENT_KEY = 'bladesurge_funnel_sent_v1';
export const UPLOAD_STEPS = Object.freeze(['first_run', 'tutorial_complete', 'shop_view', 'paysheet_open']);

function defaultStorage() {
  try { const s = globalThis.localStorage; return s && typeof s.getItem === 'function' ? s : null; } catch { return null; }
}

/**
 * @param {{ client: any, funnel: { read(): Array<{ n: string }> }, isReady?: () => boolean, storage?: any, delayMs?: number, setTimer?: (fn: () => void, ms: number) => any, maxWaits?: number }} options
 */
export function createFunnelUpload({ client, funnel, isReady = () => true, storage = defaultStorage(), delayMs = 3000, setTimer = (fn, ms) => setTimeout(fn, ms), maxWaits = 20 }) {
  const pending = new Set();
  let sent = null, timer = null, disabled = false, flying = false, waits = 0;

  function loadSent() {
    if (sent) return sent;
    sent = new Set();
    try {
      const v = JSON.parse(storage?.getItem(FUNNEL_SENT_KEY) || '[]');
      if (Array.isArray(v)) for (const n of v) if (UPLOAD_STEPS.includes(n)) sent.add(n);
    } catch { /* 손상된 플래그는 비운 것으로 본다 */ }
    return sent;
  }
  function saveSent() { try { storage?.setItem(FUNNEL_SENT_KEY, JSON.stringify([...loadSent()])); } catch { /* 저장 불가면 다음 실행에 다시 시도 */ } }

  function schedule() {
    if (timer !== null || disabled || !pending.size) return;
    timer = setTimer(() => { timer = null; void flush(); }, delayMs);
  }
  /** 대기 중인 단계를 한 번에 보낸다. 실패하면 대기열에 남기고 다음 기회(새 단계 기록·다음 실행)를 기다린다. */
  async function flush() {
    if (disabled || flying || !pending.size) return false;
    if (!client || !isReady()) { if (waits++ < maxWaits) schedule(); return false; }
    const events = [...pending].slice(0, 20);
    flying = true;
    try {
      await client.funnel(events);
      const done = loadSent();
      for (const n of events) { pending.delete(n); done.add(n); }
      saveSent();
      return true;
    } catch (error) {
      if (error?.status === 503) disabled = true; // v1 미사용: 아무 것도 하지 않는다
      return false;
    } finally { flying = false; }
  }
  /** 단계 이벤트가 로컬에 기록됐음을 알린다. */
  function note(name) {
    if (!UPLOAD_STEPS.includes(name) || loadSent().has(name)) return;
    pending.add(name); schedule();
  }
  /** 이미 기록된 로컬 퍼널(부트 때 먼저 남은 first_run 등)을 훑고, 이후 track 호출을 가로채 note로 알린다. */
  function attach(log) {
    try { for (const r of log.read()) note(r.n); } catch { /* 계측 실패는 무시 */ }
    const track = log.track.bind(log);
    log.track = (name, payload) => { const out = track(name, payload); if (out?.ok) note(name); return out; };
    return log;
  }
  return { note, attach, flush, pendingSteps: () => [...pending] };
}

/** 부트 연결. 계정 클라이언트가 없으면 아무 것도 하지 않는다. */
export function setupFunnelUpload(app) {
  const client = app?.account?.client;
  if (!client || !app.funnel) return null;
  const upload = createFunnelUpload({ client, funnel: app.funnel, isReady: () => app.account?.status === 'ready' });
  upload.attach(app.funnel); app.funnelUpload = upload;
  return upload;
}
