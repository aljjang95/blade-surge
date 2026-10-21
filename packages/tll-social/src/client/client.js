// tll-social 브라우저 SDK: 신원·REST·실시간·상태 저장소 (게임 비종속)
import { NONCE, PARTY_CODE, PLAYER_ID, SOCIAL_LIMITS, SOCIAL_PREFIX } from '../shared/protocol';
import { createDeviceKey, createNonce, isDeviceKey, safeStorage } from './identity.js';
import { createRequester, fail, isRetryable } from './http.js';

/**
 * @typedef {import('./http.js').SocialResult} SocialResult
 * @typedef {import('./http.js').SocialFail} SocialFail
 * @typedef {{ id: string, label: string }} Title
 * @typedef {{ id: string, name: string, tag: string, no: number, hero: string | null, title: Title | null, linked?: boolean }} PublicMini
 * @typedef {{ state: 'lobby' | 'battle' | 'party', where?: string }} Presence
 * @typedef {{ id: string, channel: string | null, kind: 'chat' | 'whisper' | 'system' | 'invite' | 'fame' | 'listing', from?: PublicMini, to?: string, text: string, at: number, data?: unknown }} Msg
 * @typedef {{ mini: PublicMini | null, online: boolean, presence: Presence | null }} FriendEntry
 * @typedef {'offline' | 'connecting' | 'online'} ConnectionState
 * @typedef {{
 *   me: (PublicMini & Record<string, any>) | null,
 *   isAdmin: boolean,
 *   titles: any[],
 *   friends: Map<string, FriendEntry>,
 *   requests: { incoming: PublicMini[], outgoing: PublicMini[] },
 *   blocks: Set<string>,
 *   channels: { id: string, count: number }[],
 *   currentWorld: string | null,
 *   partyChannel: string | null,
 *   messages: Map<string, Msg[]>,
 *   unread: Map<string, number>,
 *   connection: ConnectionState,
 * }} SocialState
 * @typedef {'state' | 'msg' | 'fame' | 'invite' | 'friend' | 'presence' | 'error' | 'connection' | 'clear'} SocialEvent
 */

export const MESSAGE_LIMIT = 100;
export const OUTBOX_LIMIT = 10;
export const OUTBOX_TTL_MS = 30000;
export const RUN_QUEUE_LIMIT = 20;
export const RUN_QUEUE_TTL_MS = SOCIAL_LIMITS.runMs;
export const PING_MS = 20000;
export const HIDDEN_CLOSE_MS = 25000;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;
export const PRESENCE_GAP_MS = 2000;
/** 서버가 없거나(404) 닿지 않을 때 자동 요청을 줄이는 지수 백오프. 사용자가 직접 연 경우에만 한 번씩 다시 시도한다. */
export const UNREACHABLE_BACKOFF_MIN_MS = 60000;
export const UNREACHABLE_BACKOFF_MAX_MS = 900000;
/** 재시도해도 소용없는 티켓 실패: 프로필 생성·키 교체 전까지 재연결하지 않는다. */
const FATAL_TICKET_ERRORS = new Set(['bad-key', 'no-profile', 'banned']);
const ID_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PROVIDER = /^[a-z]{2,16}$/;
const WS_OPEN = 1;

/** @param {any} value */
function isMini(value) {
  return !!value && typeof value === 'object' && typeof value.id === 'string';
}

/** /me 응답의 친구·요청 항목은 {player}, {from}, {to}, {mini} 포장 또는 PublicMini 자체를 모두 받는다. */
function unwrapMini(item) {
  if (!item || typeof item !== 'object') return null;
  for (const key of ['player', 'mini', 'from', 'to']) {
    if (isMini(item[key])) return item[key];
  }
  return isMini(item) ? item : null;
}

/** @param {any} value */
function cleanPresence(value) {
  if (!value || typeof value !== 'object' || !['lobby', 'battle', 'party'].includes(value.state)) return null;
  /** @type {Presence} */
  const result = { state: value.state };
  if (typeof value.where === 'string') result.where = [...value.where.normalize('NFKC').trim()].slice(0, 24).join('');
  return result;
}

/** 서버가 아예 없는 것으로 볼 실패: 네트워크 오류, 또는 JSON 오류 코드 없이 돌아온 404(정적 호스팅 폴백). */
function isUnreachable(result) {
  return !result.ok && (result.error === 'network' || result.error === 'http-404');
}

/**
 * @param {{
 *   gameId: string,
 *   baseUrl?: string,
 *   storage?: import('./identity.js').KeyValueStorage | null,
 *   fetch?: (input: string, init?: any) => Promise<any>,
 *   WebSocket?: any,
 *   crypto?: { getRandomValues<T extends ArrayBufferView>(array: T): T },
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (id: any) => void,
 *   now?: () => number,
 *   random?: () => number,
 *   document?: any,
 *   window?: any,
 *   navigator?: any,
 *   location?: { protocol: string, host: string },
 *   presence?: Presence,
 * }} options
 */
export function createSocialClient(options) {
  const gameId = options && options.gameId;
  if (typeof gameId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(gameId)) throw new TypeError('tll-social: gameId');
  const baseUrl = String(options.baseUrl ?? SOCIAL_PREFIX).replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const cryptoImpl = options.crypto ?? globalThis.crypto;
  const timers = {
    setTimeout: options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms)),
    clearTimeout: options.clearTimeout ?? (id => globalThis.clearTimeout(id)),
  };
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const doc = options.document === undefined ? globalThis.document : options.document;
  const win = options.window === undefined ? (typeof globalThis.addEventListener === 'function' ? globalThis : null) : options.window;
  const nav = options.navigator === undefined ? globalThis.navigator : options.navigator;
  const loc = options.location ?? globalThis.location;
  const storage = safeStorage(options.storage);
  const keyName = 'tll-social:' + gameId + ':key';
  const prevKeyName = 'tll-social:' + gameId + ':key:prev';
  const runQueueName = 'tll-social:' + gameId + ':runq';

  let deviceKey = storage.getItem(keyName);
  if (!isDeviceKey(deviceKey)) {
    deviceKey = createDeviceKey(cryptoImpl);
    storage.setItem(keyName, deviceKey);
  }

  const rawRequest = createRequester({ baseUrl, fetchImpl, timers, now, getKey: () => /** @type {string} */ (deviceKey) });
  let unreachableFails = 0;
  let unreachableUntil = 0;
  /** 서버 도달 여부를 기록한다. 실패가 이어지면 다음 자동 요청까지 간격이 60초부터 두 배씩 늘어난다. */
  function noteReach(result) {
    if (result.ok) { unreachableFails = 0; unreachableUntil = 0; return; }
    if (!isUnreachable(result)) return;
    unreachableFails = Math.min(unreachableFails + 1, 16);
    unreachableUntil = now() + Math.min(UNREACHABLE_BACKOFF_MAX_MS, UNREACHABLE_BACKOFF_MIN_MS * 2 ** (unreachableFails - 1));
  }
  function backedOff() { return unreachableUntil > now(); }
  /** @type {typeof rawRequest} */
  const request = async (method, path, options) => {
    const result = await rawRequest(method, path, options);
    noteReach(result);
    return result;
  };

  /** @type {SocialState} */
  const state = {
    me: null, isAdmin: false, titles: [],
    friends: new Map(), requests: { incoming: [], outgoing: [] }, blocks: new Set(), blockMinis: new Map(),
    channels: [], currentWorld: null, partyChannel: null,
    messages: new Map(), unread: new Map(), connection: 'offline',
  };
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const listeners = new Map();

  /** @param {SocialEvent} event @param {any} [payload] */
  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (error) {
        // 게임 쪽 리스너 오류가 SDK 상태 갱신을 멈추지 않게 한다.
        if (typeof console !== 'undefined') console.error('[tll-social] listener', error);
      }
    }
  }
  function changed() { emit('state', state); }

  // ── 실시간 연결 상태 ─────────────────────────────
  /** @type {any} */
  let socket = null;
  let welcomed = false;
  let wanted = false;
  let connecting = false;
  let connectSeq = 0;
  let attempt = 0;
  /** @type {string | null} */
  let stopReason = null;
  let hiddenClosed = false;
  let reconnectTimer = null;
  let pingTimer = null;
  let hideTimer = null;
  let presenceTimer = null;
  let lastPresenceAt = -Infinity;
  let meLoaded = false;
  let destroyed = false;
  /** 수락 이벤트에 접속 정보가 없을 때 /me 응답으로 다시 맞출 친구 id */
  const staleOnline = new Set();
  /** @type {Presence} */
  let presence = cleanPresence(options.presence) ?? { state: 'lobby' };
  /** @type {string | null} */
  let desiredWorld = null;
  /** @type {{ payload: any, at: number }[]} */
  let outbox = [];
  /** @type {Map<string, number>} runId → 시작 시각(서버 2시간 제한 계산용) */
  const runStarts = new Map();
  let flushingRuns = false;

  /** @param {ConnectionState} next @param {number} [retryInMs] */
  function setConnection(next, retryInMs) {
    if (state.connection === next && retryInMs === undefined) return;
    state.connection = next;
    emit('connection', retryInMs === undefined ? { state: next } : { state: next, retryInMs });
    changed();
  }

  function clearTimer(id) { if (id !== null) timers.clearTimeout(id); return null; }

  function socketUrl(ticket) {
    let base = baseUrl;
    if (/^https?:\/\//i.test(base)) base = base.replace(/^http/i, 'ws');
    else {
      const secure = !loc || loc.protocol === 'https:';
      const host = loc && loc.host ? loc.host : 'localhost';
      base = (secure ? 'wss://' : 'ws://') + host + (base.startsWith('/') ? base : '/' + base);
    }
    return base + '/ws?ticket=' + encodeURIComponent(ticket);
  }

  function canSend() {
    return !!socket && welcomed && socket.readyState === WS_OPEN;
  }

  /** @param {any} payload */
  function sendRaw(payload) {
    if (!canSend()) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  function stopPing() { pingTimer = clearTimer(pingTimer); }
  function schedulePing() {
    stopPing();
    pingTimer = timers.setTimeout(() => {
      pingTimer = null;
      if (!canSend()) return;
      sendRaw({ t: 'ping' });
      schedulePing();
    }, PING_MS);
  }

  function closeSocket() {
    const ws = socket;
    socket = null;
    welcomed = false;
    connecting = false;
    connectSeq += 1;
    stopPing();
    if (ws) {
      try { ws.close(1000, 'client'); } catch { /* 무시 */ }
    }
  }

  function scheduleReconnect() {
    reconnectTimer = clearTimer(reconnectTimer);
    if (!wanted || stopReason || hiddenClosed || destroyed) {
      setConnection('offline');
      return;
    }
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
    const jittered = Math.round(Math.min(BACKOFF_MAX_MS, base * (0.8 + 0.4 * random())));
    // 서버가 없는 것으로 확인된 동안에는 백오프가 끝나기 전에 티켓을 다시 요청하지 않는다.
    const delay = Math.max(jittered, unreachableUntil - now());
    attempt = Math.min(attempt + 1, 16);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
    setConnection('offline', delay);
  }

  async function open() {
    reconnectTimer = clearTimer(reconnectTimer);
    if (!wanted || destroyed || socket || connecting) return;
    if (backedOff()) { scheduleReconnect(); return; }
    if (typeof WebSocketImpl !== 'function') {
      stopReason = 'websocket-unavailable';
      setConnection('offline');
      return;
    }
    const seq = ++connectSeq;
    connecting = true;
    setConnection('connecting');
    const ticket = await request('POST', '/ws-ticket', { body: {} });
    if (seq !== connectSeq) return;
    connecting = false;
    if (!wanted || destroyed) { setConnection('offline'); return; }
    if (!ticket.ok || !ticket.data || typeof ticket.data.ticket !== 'string') {
      const code = ticket.ok ? 'bad-response' : ticket.error;
      if (FATAL_TICKET_ERRORS.has(code)) {
        stopReason = code;
        setConnection('offline');
        emit('error', { code, source: 'ticket' });
        return;
      }
      scheduleReconnect();
      return;
    }
    let ws;
    try {
      ws = new WebSocketImpl(socketUrl(ticket.data.ticket));
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    welcomed = false;
    ws.onopen = () => {
      if (socket !== ws) return;
      try { ws.send(JSON.stringify({ t: 'hello', presence })); } catch { /* close가 뒤따른다 */ }
      lastPresenceAt = now();
    };
    ws.onmessage = event => {
      if (socket !== ws) return;
      const raw = event && typeof event.data === 'string' ? event.data : '';
      if (!raw || raw.length > 65536) return;
      let message;
      try { message = JSON.parse(raw); } catch { return; }
      if (message && typeof message === 'object') handleServer(message);
    };
    ws.onerror = () => { /* onclose에서 정리한다 */ };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      welcomed = false;
      stopPing();
      scheduleReconnect();
    };
  }

  /** 다시 연결해야 할 상황(키 교체·프로필 생성)에서 쓰는 즉시 재시작. */
  function restart() {
    closeSocket();
    reconnectTimer = clearTimer(reconnectTimer);
    stopReason = null;
    attempt = 0;
    if (wanted && !hiddenClosed) open();
    else setConnection('offline');
  }

  // ── 상태 반영 ──────────────────────────────────
  function messageKey(m) {
    if (typeof m.channel === 'string' && m.channel) return m.channel;
    if (m.kind === 'whisper' || m.kind === 'invite') return 'dm';
    return state.currentWorld ?? 'system';
  }

  /** @param {any} m */
  function validMsg(m) {
    return !!m && typeof m === 'object' && typeof m.id === 'string' && typeof m.text === 'string';
  }

  function blockedMsg(m) {
    return !!(m.from && typeof m.from.id === 'string' && state.blocks.has(m.from.id));
  }

  /** @param {any} m @param {boolean} countUnread */
  function addMessage(m, countUnread = true) {
    if (!validMsg(m) || blockedMsg(m)) return false;
    const key = messageKey(m);
    const list = state.messages.get(key) ?? [];
    if (list.some(item => item.id === m.id)) return false;
    list.push(m);
    if (list.length > MESSAGE_LIMIT) list.splice(0, list.length - MESSAGE_LIMIT);
    state.messages.set(key, list);
    const own = !!(state.me && m.from && m.from.id === state.me.id);
    if (countUnread && !own) state.unread.set(key, (state.unread.get(key) ?? 0) + 1);
    emit('msg', m);
    if (m.kind === 'invite') emit('invite', m);
    if (m.kind === 'fame') emit('fame', m);
    return true;
  }

  /** @param {string} channel @param {any[]} items */
  function setHistory(channel, items) {
    if (typeof channel !== 'string' || !Array.isArray(items)) return;
    const seen = new Set();
    /** @type {Msg[]} */
    const list = [];
    for (const m of items) {
      if (!validMsg(m) || blockedMsg(m) || seen.has(m.id)) continue;
      seen.add(m.id);
      list.push(m);
    }
    state.messages.set(channel, list.slice(-MESSAGE_LIMIT));
  }

  function setChannels(list) {
    if (!Array.isArray(list)) return;
    state.channels = list
      .filter(item => item && typeof item.id === 'string')
      .map(item => ({ id: item.id, count: Number.isFinite(item.count) ? item.count : 0 }));
  }

  /** @param {any} data */
  function applyProfile(data) {
    const profile = data && isMini(data.profile) ? data.profile : data && isMini(data.me) ? data.me : isMini(data) ? data : null;
    if (!profile) return false;
    state.me = { ...profile };
    if (typeof data.isAdmin === 'boolean') state.isAdmin = data.isAdmin;
    return true;
  }

  /** GET /me 응답을 상태에 반영한다. 응답 형태 차이는 관대하게 받는다. */
  function applyMe(data) {
    if (!data || typeof data !== 'object') return;
    applyProfile(data);
    if (typeof data.isAdmin === 'boolean') state.isAdmin = data.isAdmin;
    if (Array.isArray(data.titles)) state.titles = data.titles;
    const blocks = Array.isArray(data.blocks) ? data.blocks : Array.isArray(data.blocked) ? data.blocked : null;
    if (blocks) {
      state.blocks = new Set(blocks.map(item => (typeof item === 'string' ? item : unwrapMini(item)?.id)).filter(id => typeof id === 'string'));
      // 설정 화면의 차단 목록에 이름을 보여 주기 위해 서버가 준 PublicMini를 함께 둔다.
      state.blockMinis = new Map(blocks.map(item => unwrapMini(item)).filter(Boolean).map(mini => [mini.id, mini]));
    }
    if (Array.isArray(data.friends)) {
      const next = new Map();
      for (const item of data.friends) {
        const mini = unwrapMini(item);
        const id = mini ? mini.id : item && typeof item.id === 'string' ? item.id : null;
        if (!id || state.blocks.has(id)) continue;
        const prev = state.friends.get(id);
        // 소켓이 붙어 있으면 실시간 presence가 REST 응답보다 최신이다.
        if (prev && state.connection === 'online' && !staleOnline.has(id)) next.set(id, { mini: mini ?? prev.mini, online: prev.online, presence: prev.presence });
        else next.set(id, { mini, online: item.online === true, presence: cleanPresence(item.presence) });
      }
      state.friends = next;
      staleOnline.clear();
    }
    const req = data.requests && typeof data.requests === 'object' ? data.requests : data;
    const incoming = req.incoming ?? req.received;
    const outgoing = req.outgoing ?? req.sent;
    if (Array.isArray(incoming)) state.requests.incoming = incoming.map(unwrapMini).filter(m => m && !state.blocks.has(m.id));
    if (Array.isArray(outgoing)) state.requests.outgoing = outgoing.map(unwrapMini).filter(Boolean);
    meLoaded = true;
  }

  function dropRequests(id) {
    state.requests.incoming = state.requests.incoming.filter(m => m.id !== id);
    state.requests.outgoing = state.requests.outgoing.filter(m => m.id !== id);
  }

  /** @param {any} message */
  function handleServer(message) {
    switch (message.t) {
      case 'welcome': {
        welcomed = true;
        attempt = 0;
        if (isMini(message.me)) state.me = { ...(state.me ?? {}), ...message.me };
        if (typeof message.world === 'string') state.currentWorld = message.world;
        setChannels(message.channels);
        if (message.history && typeof message.history === 'object') {
          for (const [channel, items] of Object.entries(message.history)) setHistory(channel, /** @type {any[]} */ (items));
        }
        if (Array.isArray(message.inbox)) for (const m of message.inbox) addMessage(m, true);
        if (Array.isArray(message.friends)) {
          for (const item of message.friends) {
            if (!item || typeof item.id !== 'string' || state.blocks.has(item.id)) continue;
            const prev = state.friends.get(item.id);
            state.friends.set(item.id, { mini: prev ? prev.mini : null, online: item.online === true, presence: cleanPresence(item.presence) });
          }
        }
        setConnection('online');
        schedulePing();
        // 끊기기 전에 고른 광장·파티 채널을 다시 붙인다.
        if (desiredWorld && desiredWorld !== state.currentWorld) sendRaw({ t: 'join', channel: desiredWorld });
        if (state.partyChannel) sendRaw({ t: 'join', channel: state.partyChannel });
        flushOutbox();
        changed();
        if (!meLoaded) refreshMe();
        flushRunQueue();
        break;
      }
      case 'msg':
        if (addMessage(message.m, true)) changed();
        break;
      case 'history':
        setHistory(message.channel, message.items);
        if (typeof message.channel === 'string' && message.channel.startsWith('world-')) state.currentWorld = message.channel;
        changed();
        break;
      case 'presence': {
        if (typeof message.id !== 'string') break;
        const prev = state.friends.get(message.id);
        if (!prev) break;
        const next = { mini: prev.mini, online: message.online === true, presence: cleanPresence(message.presence) };
        state.friends.set(message.id, next);
        emit('presence', { id: message.id, online: next.online, presence: next.presence });
        changed();
        break;
      }
      case 'friend': {
        const player = unwrapMini(message.player);
        if (!player || state.blocks.has(player.id)) break;
        if (message.event === 'request') {
          if (!state.requests.incoming.some(m => m.id === player.id)) state.requests.incoming.push(player);
        } else if (message.event === 'accepted') {
          dropRequests(player.id);
          const prev = state.friends.get(player.id);
          if (typeof message.online === 'boolean') {
            // 서버가 수락한 사람의 접속·상태를 같이 보낸다.
            state.friends.set(player.id, { mini: player, online: message.online, presence: message.online ? cleanPresence(message.presence) : null });
          } else {
            // 접속 정보가 없으면 /me로 맞춘다. 그 전까지는 알던 값을 유지한다.
            state.friends.set(player.id, { mini: player, online: prev ? prev.online : false, presence: prev ? prev.presence : null });
            staleOnline.add(player.id);
            refreshMe();
          }
        } else if (message.event === 'removed') {
          dropRequests(player.id);
          state.friends.delete(player.id);
        } else break;
        emit('friend', { event: message.event, player });
        changed();
        break;
      }
      case 'channels':
        setChannels(message.channels);
        changed();
        break;
      case 'error': {
        const code = typeof message.code === 'string' ? message.code : 'unknown';
        emit('error', Number.isFinite(message.retryAfterMs)
          ? { code, retryAfterMs: message.retryAfterMs, source: 'socket' }
          : { code, source: 'socket' });
        if (code === 'banned') {
          stopReason = 'banned';
          closeSocket();
          setConnection('offline');
        }
        break;
      }
      default:
        break;
    }
  }

  // ── 끊긴 동안 보낸 말 큐 ──────────────────────────
  function flushOutbox() {
    const fresh = outbox.filter(item => now() - item.at <= OUTBOX_TTL_MS);
    outbox = [];
    for (const item of fresh) {
      if (!sendRaw(item.payload)) outbox.push(item);
    }
  }

  /** @param {any} payload */
  function sendOrQueue(payload) {
    if (sendRaw(payload)) return { ok: true, status: 0, data: { nonce: payload.nonce, queued: false } };
    outbox = outbox.filter(item => now() - item.at <= OUTBOX_TTL_MS);
    outbox.push({ payload, at: now() });
    if (outbox.length > OUTBOX_LIMIT) outbox.splice(0, outbox.length - OUTBOX_LIMIT);
    return { ok: true, status: 0, data: { nonce: payload.nonce, queued: true } };
  }

  /** @param {unknown} value */
  function chatText(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.normalize('NFKC').trim();
    if (!normalized || new TextEncoder().encode(normalized).length > SOCIAL_LIMITS.socketBytes - 256) return null;
    return normalized;
  }

  // ── 런 기록 오프라인 큐 ───────────────────────────
  function isOffline() { return !!nav && nav.onLine === false; }

  /** @returns {{ runId: string, queuedAt: number, startedAt?: number }[]} */
  function readRunQueue() {
    let list = [];
    try {
      const raw = storage.getItem(runQueueName);
      list = raw ? JSON.parse(raw) : [];
    } catch {
      list = [];
    }
    if (!Array.isArray(list)) return [];
    const t = now();
    return list.filter(item => item && typeof item.runId === 'string' && item.runId.length <= 64
      && Number.isFinite(item.queuedAt)
      && t - (Number.isFinite(item.startedAt) ? item.startedAt : item.queuedAt) <= RUN_QUEUE_TTL_MS)
      .slice(-RUN_QUEUE_LIMIT);
  }

  function writeRunQueue(list) {
    if (list.length) storage.setItem(runQueueName, JSON.stringify(list.slice(-RUN_QUEUE_LIMIT)));
    else storage.removeItem(runQueueName);
  }

  function enqueueRun(runId) {
    const list = readRunQueue().filter(item => item.runId !== runId);
    const entry = { runId, queuedAt: now() };
    const startedAt = runStarts.get(runId);
    if (startedAt !== undefined) entry.startedAt = startedAt;
    list.push(entry);
    writeRunQueue(list);
  }

  async function flushRunQueue() {
    // 대기 중인 클리어는 플레이어의 기록이라 백오프와 상관없이 호출 시점마다 시도한다(호출 빈도가 낮다).
    if (flushingRuns || isOffline() || destroyed) return;
    flushingRuns = true;
    try {
      let list = readRunQueue();
      writeRunQueue(list);
      while (list.length) {
        const entry = list[0];
        const result = await request('POST', '/runs/clear', { body: { runId: entry.runId } });
        if (!result.ok && isRetryable(result)) break;
        list = readRunQueue().filter(item => item.runId !== entry.runId);
        writeRunQueue(list);
        runStarts.delete(entry.runId);
        emit('clear', { runId: entry.runId, result, replayed: true });
      }
    } catch {
      // 큐 재시도 실패는 다음 기회에 다시 한다.
    } finally {
      flushingRuns = false;
    }
  }

  // ── 신원 교체 ────────────────────────────────────
  function resetState() {
    state.me = null;
    state.isAdmin = false;
    state.titles = [];
    state.friends = new Map();
    state.requests = { incoming: [], outgoing: [] };
    state.blocks = new Set();
    state.blockMinis = new Map();
    state.channels = [];
    state.currentWorld = null;
    state.partyChannel = null;
    state.messages = new Map();
    state.unread = new Map();
    outbox = [];
    desiredWorld = null;
    meLoaded = false;
    runStarts.clear();
    // 이전 신원의 대기 중 클리어는 새 키로 보내면 거부되므로 버린다.
    storage.removeItem(runQueueName);
  }

  /** @param {string} nextKey */
  function switchKey(nextKey) {
    if (deviceKey && deviceKey !== nextKey) storage.setItem(prevKeyName, deviceKey);
    deviceKey = nextKey;
    storage.setItem(keyName, nextKey);
    resetState();
    changed();
  }

  /**
   * @param {{ manual?: boolean }} [options] manual이 아니면 서버가 없는 것으로 확인된 동안 요청을 보내지 않는다.
   */
  async function refreshMe(options) {
    if (!(options && options.manual === true) && backedOff()) return fail('offline');
    const result = await request('GET', '/me');
    if (result.ok) {
      applyMe(result.data);
      changed();
    }
    return result;
  }

  /** 친구·차단 변경 뒤 전체 상태를 다시 받아 응답 형태 추측을 피한다. */
  async function mutateThenRefresh(promise) {
    const result = await promise;
    if (result.ok) await refreshMe({ manual: true });
    return result;
  }

  // ── 브라우저 이벤트 ───────────────────────────────
  function onVisibility() {
    if (!doc) return;
    if (doc.visibilityState === 'hidden') {
      if (hideTimer !== null) return;
      hideTimer = timers.setTimeout(() => {
        hideTimer = null;
        if (!wanted) return;
        hiddenClosed = true;
        reconnectTimer = clearTimer(reconnectTimer);
        closeSocket();
        setConnection('offline');
      }, HIDDEN_CLOSE_MS);
      return;
    }
    hideTimer = clearTimer(hideTimer);
    if (hiddenClosed) {
      hiddenClosed = false;
      attempt = 0;
      if (wanted && !stopReason) open();
    } else if (wanted && !stopReason && !socket && !connecting) {
      attempt = 0;
      open();
    }
  }
  function onOnline() {
    flushRunQueue();
    if (wanted && !stopReason && !hiddenClosed && !socket && !connecting) {
      attempt = 0;
      open();
    }
  }
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
  if (win && typeof win.addEventListener === 'function') win.addEventListener('online', onOnline);
  if (readRunQueue().length) Promise.resolve().then(flushRunQueue);

  // ── 공개 API ────────────────────────────────────
  const client = {
    gameId,
    /** 라이브 상태 객체. 읽기 전용으로 쓴다. */
    get state() { return state; },
    get connection() { return state.connection; },

    /**
     * @param {SocialEvent} event
     * @param {(payload: any) => void} fn
     * @returns {() => void} 해제 함수
     */
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(fn);
      return () => { set.delete(fn); };
    },

    // 신원
    exportKey() { return /** @type {string} */ (deviceKey); },
    /** @param {string} code */
    async importKey(code) {
      const next = typeof code === 'string' ? code.trim() : '';
      if (!isDeviceKey(next)) return fail('bad-key');
      if (next !== deviceKey) {
        switchKey(next);
        restart();
      }
      return { ok: true, status: 0, data: null };
    },

    // 계정 연동(구글 버튼·스크립트 로드는 UI 책임)
    /** @param {string} idToken */
    async linkGoogle(idToken) {
      if (typeof idToken !== 'string' || idToken.length > 4096 || !ID_TOKEN.test(idToken)) return fail('token');
      const result = await request('POST', '/auth/link', { body: { provider: 'google', idToken } });
      if (result.ok) {
        if (!applyProfile(result.data) && state.me) state.me = { ...state.me, linked: true };
        changed();
      }
      return result;
    },
    /** 새 deviceKey를 만들어 연결된 플레이어를 이 기기로 되찾는다. 실패하면 기존 키를 그대로 둔다. */
    async recoverWithGoogle(idToken) {
      if (typeof idToken !== 'string' || idToken.length > 4096 || !ID_TOKEN.test(idToken)) return fail('token');
      const nextKey = createDeviceKey(cryptoImpl);
      const result = await request('POST', '/auth/recover', { auth: false, body: { provider: 'google', idToken, deviceKey: nextKey } });
      if (!result.ok) return result;
      switchKey(nextKey);
      applyProfile(result.data);
      if (state.me) meLoaded = false;
      changed();
      restart();
      return result;
    },
    /** @param {string} [provider] */
    async unlink(provider = 'google') {
      if (typeof provider !== 'string' || !PROVIDER.test(provider)) return fail('provider');
      const result = await request('POST', '/auth/unlink', { body: { provider } });
      if (result.ok) {
        if (!applyProfile(result.data) && state.me) {
          const linked = result.data && typeof result.data.linked === 'boolean' ? result.data.linked : false;
          state.me = { ...state.me, linked };
        }
        changed();
      }
      return result;
    },

    // 프로필
    /** @param {string} name @param {string} [hero] */
    async profile(name, hero) {
      const result = await request('POST', '/profile', { body: { name, hero } });
      if (result.ok) {
        applyProfile(result.data);
        changed();
        if (stopReason === 'no-profile') restart();
      }
      return result;
    },
    me: refreshMe,
    /** @param {string} hero */
    async setHero(hero) {
      const result = await request('POST', '/me/hero', { body: { hero } });
      if (result.ok) {
        if (!applyProfile(result.data)) await refreshMe();
        changed();
      }
      return result;
    },
    /** @param {string | null} titleId */
    async setTitle(titleId) {
      const result = await request('POST', '/me/title', { body: { titleId } });
      if (result.ok) {
        if (!applyProfile(result.data)) await refreshMe();
        changed();
      }
      return result;
    },
    /** @param {string} code 이름#1234 */
    lookup(code) { return request('GET', '/players/lookup', { query: { code } }); },
    /** @param {string} id */
    player(id) {
      if (typeof id !== 'string' || !PLAYER_ID.test(id)) return Promise.resolve(fail('player'));
      return request('GET', '/players/' + id);
    },

    // 친구·차단
    /** @param {string} codeOrId playerId 또는 이름#1234 */
    friendRequest(codeOrId) {
      const body = typeof codeOrId === 'string' && PLAYER_ID.test(codeOrId) ? { playerId: codeOrId } : { code: codeOrId };
      return mutateThenRefresh(request('POST', '/friends/request', { body }));
    },
    /** @param {string} playerId @param {boolean} accept */
    friendRespond(playerId, accept) {
      return mutateThenRefresh(request('POST', '/friends/respond', { body: { playerId, accept: accept === true } }));
    },
    /** @param {string} playerId */
    friendRemove(playerId) { return mutateThenRefresh(request('POST', '/friends/remove', { body: { playerId } })); },
    /** @param {string} playerId @param {boolean} [blocked] */
    async block(playerId, blocked = true) {
      const result = await request('POST', '/blocks', { body: { playerId, blocked: blocked === true } });
      if (result.ok) {
        // 서버 반영 전에 화면에서 먼저 숨긴다.
        if (blocked === true) {
          state.blocks.add(playerId);
          state.friends.delete(playerId);
          dropRequests(playerId);
          for (const [key, list] of state.messages) state.messages.set(key, list.filter(m => !(m.from && m.from.id === playerId)));
        } else state.blocks.delete(playerId);
        changed();
        await refreshMe({ manual: true });
      }
      return result;
    },

    // 파티 모집
    listings() { return request('GET', '/listings'); },
    /** @param {{ partyCode: string, contentId?: string | null, note?: string, slots: number, members: number }} listing */
    postListing(listing) {
      const { partyCode, contentId = null, note = '', slots, members } = listing ?? /** @type {any} */ ({});
      return request('POST', '/listings', { body: { partyCode, contentId, note, slots, members } });
    },
    deleteListing() { return request('DELETE', '/listings'); },

    // 런 기록: 게임 진행을 막지 않도록 항상 resolve한다.
    /** @param {string} contentId @param {'solo' | 'party'} [mode] */
    async runStart(contentId, mode = 'solo') {
      try {
        if (isOffline()) return fail('offline');
        const result = await request('POST', '/runs/start', { body: { contentId, mode } });
        if (result.ok && result.data && typeof result.data.runId === 'string') {
          runStarts.set(result.data.runId, now());
          for (const oldest of runStarts.keys()) {
            if (runStarts.size <= RUN_QUEUE_LIMIT) break;
            runStarts.delete(oldest);
          }
          flushRunQueue();
        }
        return result;
      } catch {
        return fail('internal');
      }
    },
    /** @param {string} runId */
    async runClear(runId) {
      try {
        if (typeof runId !== 'string' || !runId || runId.length > 64) return fail('run');
        if (isOffline()) {
          enqueueRun(runId);
          return { ...fail('offline'), queued: true };
        }
        const result = await request('POST', '/runs/clear', { body: { runId } });
        if (!result.ok && isRetryable(result)) {
          enqueueRun(runId);
          return { ...result, queued: true };
        }
        runStarts.delete(runId);
        flushRunQueue();
        return result;
      } catch {
        return fail('internal');
      }
    },
    /** 테스트·디버그용: 대기 중인 클리어 기록 목록 */
    pendingRunClears() { return readRunQueue(); },
    flushRunClears: flushRunQueue,

    // 명예의 전당(인증 없이 조회)
    fame() { return request('GET', '/fame', { auth: false }); },
    /** @param {string} contentId */
    fameContent(contentId) { return request('GET', '/fame/' + encodeURIComponent(contentId), { auth: false }); },

    // 게시판: 프로필이 있으면 키를 보내 내 공감 여부를 받는다.
    /** @param {{ category?: string, sort?: 'new' | 'top', cursor?: string | number }} [query] */
    board(query = {}) {
      return request('GET', '/board', { auth: !!state.me, query: { category: query.category, sort: query.sort, cursor: query.cursor } });
    },
    /** @param {number | string} id */
    post(id) { return request('GET', '/board/' + encodeURIComponent(String(id)), { auth: !!state.me }); },
    /** @param {{ category: string, title: string, body: string, diag?: Record<string, string | number> }} input */
    createPost(input) {
      const { category, title, body, diag } = input ?? /** @type {any} */ ({});
      return request('POST', '/board', { body: diag === undefined ? { category, title, body } : { category, title, body, diag } });
    },
    /** @param {number | string} id */
    vote(id) { return request('POST', '/board/' + encodeURIComponent(String(id)) + '/vote', { body: {} }); },
    /** @param {number | string} id @param {string} body */
    comment(id, body) { return request('POST', '/board/' + encodeURIComponent(String(id)) + '/comment', { body: { body } }); },
    /** @param {number | string} id @param {{ status?: string, devReply?: string, hidden?: boolean }} changes */
    moderate(id, changes) {
      /** @type {Record<string, any>} */
      const body = {};
      for (const key of ['status', 'devReply', 'hidden']) if (changes && changes[key] !== undefined) body[key] = changes[key];
      return request('POST', '/board/' + encodeURIComponent(String(id)) + '/moderate', { body });
    },
    /** @param {{ kind: 'chat' | 'post' | 'player', target: string, ref?: string, reason?: string }} input */
    report(input) {
      const { kind, target, ref, reason = '' } = input ?? /** @type {any} */ ({});
      return request('POST', '/report', { body: ref === undefined ? { kind, target, reason } : { kind, target, ref, reason } });
    },
    /** @param {string} playerId @param {number} minutes */
    adminMute(playerId, minutes) { return request('POST', '/admin/mute', { body: { playerId, minutes } }); },
    /** @param {string} playerId @param {boolean} banned */
    adminBan(playerId, banned) { return request('POST', '/admin/ban', { body: { playerId, banned } }); },
    /** @param {string} playerId @param {string} contentId */
    adminRevokeClear(playerId, contentId) { return request('POST', '/admin/revoke-clear', { body: { playerId, contentId } }); },

    // 실시간
    connect() {
      if (destroyed) return;
      wanted = true;
      if (stopReason) { stopReason = null; attempt = 0; }
      if (!socket && !connecting && !hiddenClosed) open();
    },
    disconnect() {
      wanted = false;
      reconnectTimer = clearTimer(reconnectTimer);
      closeSocket();
      setConnection('offline');
    },
    /** @param {string} channel @param {string} text */
    say(channel, text) {
      const clean = chatText(text);
      if (!clean) return fail('length');
      if (typeof channel !== 'string' || !(/^world-[1-9]\d*$/.test(channel) || (channel.startsWith('party:') && PARTY_CODE.test(channel.slice(6))))) return fail('channel');
      return sendOrQueue({ t: 'say', channel, text: clean, nonce: createNonce(cryptoImpl) });
    },
    /** @param {string} id @param {string} text */
    whisper(id, text) {
      if (typeof id !== 'string' || !PLAYER_ID.test(id)) return fail('player');
      if (state.blocks.has(id)) return fail('blocked');
      const clean = chatText(text);
      if (!clean) return fail('length');
      return sendOrQueue({ t: 'whisper', to: id, text: clean, nonce: createNonce(cryptoImpl) });
    },
    /** @param {string} id @param {string} partyCode */
    invite(id, partyCode) {
      if (typeof id !== 'string' || !PLAYER_ID.test(id)) return fail('player');
      if (typeof partyCode !== 'string' || !PARTY_CODE.test(partyCode)) return fail('party-code');
      if (state.blocks.has(id)) return fail('blocked');
      return sendRaw({ t: 'invite', to: id, partyCode }) ? { ok: true, status: 0, data: null } : fail('offline');
    },
    /** @param {number} n 1부터 */
    joinWorld(n) {
      if (!Number.isSafeInteger(n) || n < 1 || n > 999) return fail('channel');
      desiredWorld = 'world-' + n;
      sendRaw({ t: 'join', channel: desiredWorld });
      return { ok: true, status: 0, data: { channel: desiredWorld } };
    },
    /** @param {string} code */
    joinParty(code) {
      if (typeof code !== 'string' || !PARTY_CODE.test(code)) return fail('party-code');
      const channel = 'party:' + code;
      if (state.partyChannel && state.partyChannel !== channel) sendRaw({ t: 'leave', channel: state.partyChannel });
      state.partyChannel = channel;
      sendRaw({ t: 'join', channel });
      changed();
      return { ok: true, status: 0, data: { channel } };
    },
    leaveParty() {
      if (!state.partyChannel) return { ok: true, status: 0, data: null };
      sendRaw({ t: 'leave', channel: state.partyChannel });
      state.partyChannel = null;
      changed();
      return { ok: true, status: 0, data: null };
    },
    /** @param {Presence} next */
    setPresence(next) {
      const clean = cleanPresence(next);
      if (!clean) return fail('presence');
      presence = clean;
      // 서버 제한(2초 1회)에 맞춰 마지막 값만 늦춰 보낸다.
      if (presenceTimer !== null || !canSend()) return { ok: true, status: 0, data: null };
      const wait = lastPresenceAt + PRESENCE_GAP_MS - now();
      const sendNow = () => {
        presenceTimer = null;
        if (sendRaw({ t: 'presence', presence })) lastPresenceAt = now();
      };
      if (wait <= 0) sendNow();
      else presenceTimer = timers.setTimeout(sendNow, wait);
      return { ok: true, status: 0, data: null };
    },
    /** @param {string} channel 'dm' 포함 */
    markRead(channel) {
      if (!state.unread.get(channel)) return;
      state.unread.set(channel, 0);
      changed();
    },
    unreadTotal() {
      let total = 0;
      for (const count of state.unread.values()) total += count;
      return total;
    },

    /** 리스너·타이머·소켓을 모두 정리한다. */
    destroy() {
      destroyed = true;
      wanted = false;
      reconnectTimer = clearTimer(reconnectTimer);
      hideTimer = clearTimer(hideTimer);
      presenceTimer = clearTimer(presenceTimer);
      closeSocket();
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('online', onOnline);
      state.connection = 'offline';
      listeners.clear();
    },
  };
  return client;
}
