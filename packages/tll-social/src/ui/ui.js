// createCommunityUI: 게임 비종속 커뮤니티 화면(사이드 시트 + 넓은 화면 프레임 + 전투 중 띠). 순수 DOM + CSS.
import { button, clear, copyText, disposer, el, rafOnce, reportError } from './dom.js';
import { icon } from './icons.js';
import { badgeText, checkNickname, errorMessage, fullName, hueOf, initialOf, TABS, WIDE_TABS } from './format.js';
import { badgeRect, layoutFor, tickerRect } from './layout.js';
import { nameMenuItems, tickerText, unreadTotal } from './models.js';
import { applyTheme, injectStyles } from './styles.js';
import { createChatView } from './views/chat.js';
import { createPartyView } from './views/party.js';
import { createFriendsView } from './views/friends.js';
import { createFameView } from './views/fame.js';
import { createBoardView } from './views/board.js';
import { openNicknameModal, openProfileModal, openReportModal, openSettingsModal } from './views/modals.js';

const TICKER_VISIBLE_MS = 4000;
const TICKER_GONE_MS = 5600;
const NEEDS_PROFILE = new Set(['chat', 'party', 'friends']);

/**
 * @param {{
 *   client: any, config: any, mount?: HTMLElement, theme?: Record<string,string>,
 *   hooks?: {
 *     portraitFor?: (mini: any) => string | Node | null,
 *     contentArt?: (contentId: string) => string | null,
 *     joinParty?: (code: string) => any,
 *     currentPartyCode?: () => string | null,
 *     currentPartyInfo?: () => ({ members?: number, slots?: number } | null),
 *     openParty?: () => void,
 *     canOpenPanel?: () => boolean,
 *     diagnostics?: () => Record<string, string | number>,
 *     googleSignIn?: () => Promise<string | null>,
 *     discordInvite?: string | null,
 *     hudBottom?: () => number,
 *     controlsTop?: () => number,
 *     hudObstacles?: () => ({ left: number, top: number, right: number, bottom: number }[]),
 *   }
 * }} options
 */
export function createCommunityUI(options) {
  const { client, config } = options || {};
  if (!client || !config) throw new TypeError('tll-social/ui: client와 config가 필요합니다');
  const hooks = options.hooks || {};
  const host = options.mount || document.body;
  const doc = host.ownerDocument || document;
  const win = doc.defaultView || window;
  injectStyles(doc);

  const bag = disposer();
  const root = el('div', 'tls-root');
  applyTheme(root, options.theme);
  host.append(root);

  // ── 상태 ─────────────────────────────────────────
  let phase = 'idle'; // idle | loading | ready | noprofile | offline
  let phaseError = '';
  let loading = null;
  let isOpen = false;
  let battle = false;
  let held = false; // 컷신 같은 전체 화면 연출 동안 띠·배지를 보류한다
  let tab = 'chat';
  let layout = layoutFor(win.innerWidth, win.innerHeight);
  let destroyed = false;
  const chatState = { mode: 'world', dmTarget: null };
  const listeners = new Map();
  const views = {};
  const modals = [];
  let menuEl = null;
  let lastBadge = -1;

  function emit(event, payload) {
    for (const fn of [...(listeners.get(event) || [])]) { try { fn(payload); } catch (error) { reportError(error); } }
  }

  // ── DOM 뼈대 ─────────────────────────────────────
  const sheet = el('section', 'tls-sheet', null, { role: 'dialog', 'aria-label': '커뮤니티' });
  sheet.hidden = true;
  const sheetBody = el('div', 'tls-sheet-body');
  const wide = el('section', 'tls-wide', null, { role: 'dialog', 'aria-label': '커뮤니티' });
  wide.hidden = true;
  const wideBody = el('div', 'tls-wide-body');
  const ticker = el('div', 'tls-ticker');
  ticker.hidden = true;
  const corner = el('div', 'tls-badge-corner');
  corner.hidden = true;
  const toasts = el('div', 'tls-toasts', null, { role: 'status', 'aria-live': 'polite' });
  root.append(sheet, wide, ticker, corner, toasts);

  // 시트 머리글 + 탭
  const head = el('header', 'tls-head');
  const title = el('h2', '', null);
  title.append(icon('chat', 22), el('span', '', '커뮤니티'));
  const conn = el('span', 'tls-conn');
  title.append(conn);
  const gear = button('tls-iconbtn', null, () => openSettingsModal(ctx), { 'aria-label': '설정' });
  gear.append(icon('gear', 18));
  const closeBtn = button('tls-iconbtn', null, () => api.close(), { 'aria-label': '닫기' });
  closeBtn.append(icon('close', 20));
  head.append(title, el('span', 'tls-grow'), gear, closeBtn);
  const sheetTabs = el('nav', 'tls-tabs', null, { 'aria-label': '커뮤니티 메뉴' });
  sheet.append(head, sheetTabs, sheetBody);

  // 넓은 프레임: 왼쪽 레일 + 본문 + 닫기
  const frame = el('div', 'tls-frame');
  const rail = el('nav', 'tls-rail', null, { 'aria-label': '커뮤니티 메뉴' });
  const wideMain = el('div', 'tls-wide-main');
  wideMain.append(wideBody);
  frame.append(rail, wideMain);
  wide.append(frame);

  const tabButtons = [];
  function buildTabs(container, { railMode }) {
    for (const def of TABS) {
      const b = button('tls-tab', null, () => setTab(def.id), { 'data-tab': def.id, 'aria-label': def.label });
      b.append(icon(def.icon, railMode ? 22 : 22), el('span', '', railMode ? def.short : def.short));
      const badge = el('span', 'tls-count');
      badge.hidden = true;
      b.append(badge);
      container.append(b);
      tabButtons.push({ id: def.id, b, badge });
    }
  }
  buildTabs(sheetTabs, { railMode: false });
  buildTabs(rail, { railMode: true });
  // 넓은 프레임의 닫기 버튼은 레일 맨 아래에 둔다(오른쪽 열 머리글을 가리지 않게).
  {
    const x = button('tls-tab tls-railx', null, () => api.close(), { 'aria-label': '닫기' });
    x.append(icon('close', 20), el('span', '', '닫기'));
    rail.append(x);
  }

  // 상태 덮개(불러오는 중·오프라인·닉네임 정하기)
  const sheetCover = el('div', 'tls-state');
  const wideCover = el('div', 'tls-state');
  sheetCover.hidden = wideCover.hidden = true;
  sheetBody.append(sheetCover);
  wideBody.append(wideCover);

  // ── 공용 도구(ctx) ────────────────────────────────
  function toast(text, tone, action) {
    const node = el('div', 'tls-toast' + (tone ? ' ' + tone : ''));
    node.append(el('span', '', text));
    if (action) node.append(button('tls-btn tls-btn-orange tls-btn-sm', action.label, () => { node.remove(); return action.onClick(); }));
    toasts.append(node);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    win.setTimeout(() => node.remove(), action ? 7000 : 3200);
  }

  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  /** 눌린 요소 옆에 작은 메뉴를 연다. */
  function menu(anchor, items) {
    closeMenu();
    const box = el('div', 'tls-menu', null, { role: 'menu' });
    for (const item of items) {
      const b = button('' + (item.danger ? 'danger' : ''), item.label, () => { closeMenu(); return item.onClick && item.onClick(); }, { role: 'menuitem' });
      if (item.disabled) b.disabled = true;
      box.append(b);
    }
    root.append(box);
    const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    const vw = win.innerWidth, vh = win.innerHeight;
    let left = Math.min(Math.max(6, r.left), vw - bw - 6);
    let top = r.bottom + 4;
    if (top + bh > vh - 6) top = Math.max(6, r.top - bh - 4);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    menuEl = box;
    return box;
  }

  function modal({ title: heading, wide: isWide = false, body, actions = [], onClose } = {}) {
    const overlay = el('div', 'tls-modal');
    const box = el('div', 'tls-modal-box' + (isWide ? ' wide' : ''), null, { role: 'dialog', 'aria-modal': 'true', 'aria-label': heading || '대화상자' });
    const bar = el('div', 'tls-modal-head');
    bar.append(el('span', 'tls-grow', heading || ''));
    const x = button('tls-iconbtn', null, () => handle.close(), { 'aria-label': '닫기' });
    x.append(icon('close', 18));
    bar.append(x);
    const content = el('div', 'tls-modal-body tls-scroll');
    const foot = el('div', 'tls-modal-foot');
    if (body) content.append(...(Array.isArray(body) ? body : [body]));
    for (const a of actions) foot.append(a);
    box.append(bar, content);
    if (actions.length) box.append(foot);
    overlay.append(box);
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) handle.close(); });
    root.append(overlay);
    const handle = {
      body: content, foot, overlay,
      close() {
        const i = modals.indexOf(handle);
        if (i < 0) return;
        modals.splice(i, 1);
        overlay.remove();
        if (onClose) { try { onClose(); } catch (error) { reportError(error); } }
      },
    };
    modals.push(handle);
    const focusable = content.querySelector('input,textarea,select');
    if (focusable) win.setTimeout(() => { try { focusable.focus({ preventScroll: true }); } catch { /* 무시 */ } }, 30);
    return handle;
  }

  function portrait(mini, size = 'md') {
    const wrap = el('span', 'tls-avatar tls-avatar-' + size);
    const src = hooks.portraitFor ? safeCall(() => hooks.portraitFor(mini)) : null;
    const fallback = () => {
      wrap.replaceChildren();
      wrap.style.background = 'hsl(' + hueOf(mini && mini.id) + ' 45% 34%)';
      wrap.append(el('span', '', initialOf(mini && mini.name)));
    };
    if (typeof src === 'string' && src) {
      const img = el('img', '', null, { alt: '', draggable: 'false', decoding: 'async' });
      img.addEventListener('error', fallback, { once: true });
      img.src = src;
      wrap.append(img);
    } else if (src && typeof src === 'object' && 'nodeType' in src) wrap.append(src);
    else fallback();
    return wrap;
  }

  function nameButton(mini, opts = {}) {
    const holder = el('span', 'tls-nameline');
    if (!mini) { holder.append(el('span', 'tls-name', '알 수 없음')); return holder; }
    const b = button('tls-name', null, event => openNameMenu(event.currentTarget, mini, opts), { 'aria-haspopup': 'menu' });
    b.append(el('span', '', mini.name));
    if (opts.tag !== false && mini.tag) b.append(el('span', 'tls-tag', '#' + mini.tag));
    holder.append(b);
    if (mini.linked) {
      const v = el('span', 'tls-verified', null, { title: '구글 계정 인증' });
      v.append(icon('shield', 14));
      holder.append(v);
    }
    return holder;
  }

  function openNameMenu(anchor, mini, opts = {}) {
    const meId = client.state.me && client.state.me.id;
    const items = nameMenuItems({
      meId, target: mini, friendIds: new Set(client.state.friends.keys()), blockedIds: client.state.blocks,
      canWhisper: !!meId,
    });
    if (!items.length) return;
    const act = {
      profile: () => openProfileModal(ctx, mini),
      friend: async () => { const r = await client.friendRequest(mini.id); toast(r.ok ? (r.data && r.data.status === 'friends' ? '친구가 됐어요!' : '친구 요청을 보냈어요.') : errorMessage(r.error, r.retryAfterMs), r.ok ? 'good' : 'warn'); },
      whisper: () => whisperTo(mini),
      unfriend: async () => { if (await confirm(fullName(mini) + '님을 친구에서 삭제할까요?', '삭제')) { const r = await client.friendRemove(mini.id); toast(r.ok ? '친구에서 삭제했어요.' : errorMessage(r.error), r.ok ? '' : 'warn'); } },
      block: async () => { if (await confirm(fullName(mini) + '님을 차단할까요? 채팅과 요청이 보이지 않아요.', '차단')) { const r = await client.block(mini.id, true); toast(r.ok ? '차단했어요.' : errorMessage(r.error), r.ok ? '' : 'warn'); } },
      unblock: async () => { const r = await client.block(mini.id, false); toast(r.ok ? '차단을 풀었어요.' : errorMessage(r.error), r.ok ? '' : 'warn'); },
      report: () => openReportModal(ctx, { kind: opts.msgId ? 'chat' : 'player', target: mini.id, ref: opts.msgId, label: fullName(mini) }),
    };
    menu(anchor, items.map(item => ({ label: item.label, disabled: item.disabled, danger: item.id === 'report' || item.id === 'block', onClick: act[item.id] })));
  }

  function confirm(text, okLabel = '확인') {
    return new Promise(resolve => {
      let done = false;
      const finish = value => { if (done) return; done = true; resolve(value); h.close(); };
      const ok = button('tls-btn tls-btn-orange', okLabel, () => finish(true));
      const cancel = button('tls-btn tls-btn-navy', '취소', () => finish(false));
      const h = modal({ title: '확인', body: el('p', '', text), actions: [cancel, ok], onClose: () => { if (!done) { done = true; resolve(false); } } });
    });
  }

  async function copy(text, okMessage = '복사했어요.') {
    const ok = await copyText(text, root);
    toast(ok ? okMessage : '복사하지 못했어요. 직접 선택해서 복사해 주세요.', ok ? 'good' : 'warn');
    return ok;
  }

  function whisperTo(mini) {
    chatState.mode = 'dm';
    chatState.dmTarget = mini;
    setTab('chat');
    if (views.chat) views.chat.focusInput();
  }

  async function inviteFriend(id) {
    const code = hooks.currentPartyCode ? safeCall(() => hooks.currentPartyCode()) : null;
    if (!code) { toast('먼저 파티를 만들어야 초대할 수 있어요.', 'warn'); if (hooks.openParty) hooks.openParty(); return false; }
    const r = client.invite(id, code);
    toast(r.ok ? '파티에 초대했어요.' : errorMessage(r.error), r.ok ? 'good' : 'warn');
    return r.ok;
  }

  function joinParty(code) {
    if (!hooks.joinParty) { toast('파티 참가를 지금은 쓸 수 없어요.', 'warn'); return; }
    try {
      const result = hooks.joinParty(code);
      api.close();
      return result;
    } catch (error) { reportError(error); toast('파티에 참가하지 못했어요.', 'warn'); }
  }

  async function requireProfile() {
    if (phase === 'ready') return true;
    if (phase === 'offline' || phase === 'idle') await loadMe();
    if (phase === 'ready') return true;
    if (phase === 'noprofile') return new Promise(resolve => openNicknameModal(ctx, ok => resolve(ok)));
    toast(errorMessage(phaseError || 'network'), 'warn');
    return false;
  }

  async function createProfile(name) {
    const check = checkNickname(name);
    if (!check.ok) return { ok: false, error: 'name' };
    const result = await client.profile(check.name);
    if (result.ok) {
      setPhase('ready');
      await client.me();
      client.connect();
    }
    return result;
  }

  function safeCall(fn) { try { return fn(); } catch (error) { reportError(error); return null; } }

  const ctx = {
    client, config, hooks, root, win, doc,
    get phase() { return phase; },
    get tab() { return tab; },
    get layout() { return layout; },
    get compact() { return layout.compact; },
    chatState,
    toast, menu, closeMenu, modal, confirm, copy, portrait, nameButton, openNameMenu,
    openProfile: mini => openProfileModal(ctx, mini),
    openSettings: section => openSettingsModal(ctx, section),
    whisperTo, inviteFriend, joinParty, requireProfile, createProfile, loadMe,
    go: (next, params) => setTab(next, params),
    partyCode: () => (hooks.currentPartyCode ? safeCall(() => hooks.currentPartyCode()) : null),
    contentArt: id => (hooks.contentArt ? safeCall(() => hooks.contentArt(id)) : null),
    discordInvite: () => (typeof hooks.discordInvite === 'string' && /^https:\/\//.test(hooks.discordInvite) ? hooks.discordInvite : null),
    meId: () => (client.state.me ? client.state.me.id : null),
    unread: () => unreadTotal(client.state.unread),
  };

  // ── 신원·연결 단계 ───────────────────────────────
  function setPhase(next, error = '') {
    phase = next;
    phaseError = error;
    renderCover();
    renderConn();
    scheduleRefresh();
    emit('phase', { phase, error });
  }
  /** @param {boolean} [manual] false면 자동 호출: 서버가 없는 것으로 확인된 동안은 요청을 보내지 않는다. 사용자가 연 경우만 한 번 다시 시도한다. */
  function loadMe(manual = true) {
    if (loading) return loading;
    setPhase('loading');
    loading = (async () => {
      const result = await client.me({ manual: manual !== false });
      if (result.ok) { setPhase('ready'); client.connect(); }
      else if (result.error === 'no-profile') setPhase('noprofile');
      else setPhase('offline', result.error);
      return result;
    })().catch(error => { setPhase('offline', 'network'); reportError(error); }).finally(() => { loading = null; });
    return loading;
  }

  function renderConn() {
    const c = client.state.connection;
    clear(conn);
    if (phase === 'offline') { conn.append(el('i', 'tls-dot'), el('span', '', '오프라인')); return; }
    if (phase !== 'ready') return;
    conn.append(el('i', 'tls-dot' + (c === 'online' ? ' on' : '')), el('span', '', c === 'online' ? '연결됨' : c === 'connecting' ? '연결 중…' : '재연결 대기'));
  }

  function renderCover() {
    const needs = NEEDS_PROFILE.has(tab);
    const cover = WIDE_TABS.has(tab) ? wideCover : sheetCover;
    const other = cover === wideCover ? sheetCover : wideCover;
    other.hidden = true;
    clear(cover);
    if (!needs || phase === 'ready') { cover.hidden = true; return; }
    cover.hidden = false;
    if (phase === 'loading' || phase === 'idle') {
      cover.append(el('div', 'tls-spin'), el('p', '', '커뮤니티에 연결하는 중…'));
    } else if (phase === 'offline') {
      cover.append(
        el('h3', '', '오프라인'),
        el('p', '', errorMessage(phaseError || 'network')),
        button('tls-btn tls-btn-orange', '다시 연결', () => loadMe()),
        el('p', 'tls-note', '게임은 그대로 즐길 수 있어요. 연결되면 자동으로 이어져요.'),
      );
    } else {
      cover.append(...nicknameForm());
    }
  }

  /** 닉네임 정하기(처음 한 번). 서버 오류는 한국어로 보여 준다. */
  function nicknameForm() {
    const input = el('input', 'tls-input', null, { type: 'text', maxlength: 12, placeholder: '닉네임 (2~12자)', autocomplete: 'off', spellcheck: 'false', 'aria-label': '닉네임' });
    const err = el('p', 'tls-err');
    const go = button('tls-btn tls-btn-orange tls-btn-block', '시작하기', async () => {
      err.textContent = '';
      const check = checkNickname(input.value);
      if (!check.ok) { input.classList.add('tls-bad'); err.textContent = errorMessage('name'); return; }
      input.classList.remove('tls-bad');
      const result = await createProfile(check.name);
      if (!result.ok) { err.textContent = errorMessage(result.error, result.retryAfterMs); input.classList.add('tls-bad'); }
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); go.click(); } });
    const field = el('div', 'tls-field');
    field.append(input, err, go);
    return [
      icon('friends', 40),
      el('h3', '', '닉네임을 정해 주세요'),
      el('p', '', '로그인 없이 바로 시작해요. 한글·영문·숫자·_ 2~12자로 정하면 이름 뒤에 #숫자 태그가 붙어요.'),
      field,
      button('tls-link', '다른 기기에서 쓰던 기록 불러오기', () => openSettingsModal(ctx, 'transfer')),
    ];
  }

  // ── 탭 전환 ──────────────────────────────────────
  const VIEW_FACTORIES = { chat: createChatView, party: createPartyView, friends: createFriendsView, fame: createFameView, board: createBoardView };
  function ensureView(id) {
    if (views[id]) return views[id];
    const view = VIEW_FACTORIES[id](ctx);
    views[id] = view;
    (WIDE_TABS.has(id) ? wideBody : sheetBody).append(view.el);
    view.el.hidden = true;
    return view;
  }

  function setTab(next, params) {
    if (!TABS.some(t => t.id === next)) next = 'chat';
    if (battle) return;
    tab = next;
    const isWide = WIDE_TABS.has(next);
    sheet.hidden = !(isOpen && !isWide);
    wide.hidden = !(isOpen && isWide);
    for (const id of Object.keys(VIEW_FACTORIES)) {
      const view = id === next ? ensureView(id) : views[id];
      if (!view) continue;
      view.el.hidden = id !== next;
      if (id !== next && view.hide) view.hide();
    }
    for (const t of tabButtons) t.b.classList.toggle('on', t.id === next);
    renderCover();
    if (isOpen) {
      const view = views[next];
      if (view && view.show) view.show(params);
    }
    updateBadges();
  }

  function scheduleRefresh() { refreshNow(); }
  const refreshNow = rafOnce(() => {
    if (destroyed) return;
    renderConn();
    updateBadges();
    if (isOpen) {
      const view = views[tab];
      if (view && view.refresh) view.refresh();
    }
    renderTicker();
  });

  function badgeCount() {
    const s = client.state;
    return (s.unread.get('dm') || 0) + (s.partyChannel ? s.unread.get(s.partyChannel) || 0 : 0) + s.requests.incoming.length;
  }
  function updateBadges() {
    const s = client.state;
    const chatUnread = (s.unread.get('dm') || 0) + (s.partyChannel ? s.unread.get(s.partyChannel) || 0 : 0);
    for (const t of tabButtons) {
      const n = t.id === 'chat' ? chatUnread : t.id === 'friends' ? s.requests.incoming.length : 0;
      t.badge.hidden = n <= 0;
      t.badge.textContent = badgeText(n);
    }
    const total = badgeCount();
    if (total !== lastBadge) { lastBadge = total; emit('badge', total); }
    updateCorner();
  }

  // ── 열기·닫기 ────────────────────────────────────
  const api = {
    open(next = 'chat') {
      if (destroyed || battle) return false;
      if (hooks.canOpenPanel && safeCall(() => hooks.canOpenPanel()) === false) return false;
      isOpen = true;
      applyViewport();
      if (phase === 'idle' || phase === 'offline') loadMe();
      setTab(next);
      emit('open', true);
      return true;
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      closeMenu();
      while (modals.length) modals[modals.length - 1].close();
      sheet.hidden = true;
      wide.hidden = true;
      for (const view of Object.values(views)) if (view.hide) view.hide();
      emit('open', false);
    },
    toggle(next) { return isOpen ? api.close() : api.open(next); },
    get isOpen() { return isOpen; },
    get tab() { return tab; },
    get phase() { return phase; },
    /** 앱 시작 때 한 번 호출: 프로필이 있으면 조용히 연결하고, 서버가 없으면 오프라인으로 둔다. */
    start() { return loadMe(false); },
    badgeCount,
    /** 전투 중에는 패널을 닫고 상단 가장자리 띠만 쓴다. */
    setBattle(active) {
      active = !!active;
      if (battle === active) return;
      if (active) api.close();
      battle = active;
      if (!active) { lines = []; clearTimeout(tickerTimer); }
      renderTicker();
      updateCorner();
    },
    get battle() { return battle; },
    /** 컷신 등 전체 화면 연출 동안 전투 띠·배지를 숨긴다. 끝나면 남은 줄과 배지를 다시 보인다. */
    setHold(active) {
      active = !!active;
      if (held === active) return;
      held = active;
      renderTicker();
      updateCorner();
    },
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(fn);
      return () => set.delete(fn);
    },
    /** 레이아웃을 다시 계산한다(화면 회전·크기 변경). */
    relayout() { applyViewport(); },
    /** 현재 보이는 요소들의 영역(측정·테스트용) */
    get elements() { return { root, sheet, wide, ticker, corner }; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      api.close();
      clearTimeout(tickerTimer);
      for (const off of offs) { try { off(); } catch { /* 무시 */ } }
      bag.run();
      for (const view of Object.values(views)) if (view.destroy) view.destroy();
      root.remove();
      listeners.clear();
    },
  };

  // ── 전투 중 띠 ───────────────────────────────────
  let lines = [];
  let tickerTimer = 0;
  function pushLine(text, fame) {
    lines.push({ text, at: Date.now(), fame: !!fame });
    if (lines.length > 2) lines.shift();
    renderTicker();
  }
  function renderTicker() {
    if (destroyed) return;
    const t = Date.now();
    lines = lines.filter(l => t - l.at < TICKER_GONE_MS);
    clear(ticker);
    if (!battle || held || !lines.length) { ticker.hidden = true; updateCorner(); return; }
    for (const l of lines) ticker.append(el('div', 'tls-tline' + (l.fame ? ' fame' : '') + (t - l.at >= TICKER_VISIBLE_MS ? ' fade' : ''), l.text));
    ticker.hidden = false;
    positionTicker();
    clearTimeout(tickerTimer);
    const next = Math.min(...lines.map(l => (t - l.at < TICKER_VISIBLE_MS ? TICKER_VISIBLE_MS : TICKER_GONE_MS) - (t - l.at)));
    tickerTimer = win.setTimeout(renderTicker, Math.max(120, next + 20));
  }
  function currentTickerRect() {
    const w = win.innerWidth, h = win.innerHeight;
    const hudBottom = hooks.hudBottom ? safeCall(() => hooks.hudBottom()) : null;
    const controlsTop = hooks.controlsTop ? safeCall(() => hooks.controlsTop()) : null;
    return tickerRect({
      width: w, height: h,
      hudBottom: Number.isFinite(hudBottom) ? hudBottom : Math.round(h * 0.2),
      controlsTop: Number.isFinite(controlsTop) ? controlsTop : Math.round(h * 0.62),
      lines: Math.max(1, lines.length),
    });
  }
  function positionTicker() {
    const r = currentTickerRect();
    ticker.style.left = r.left + 'px';
    ticker.style.top = r.top + 'px';
    ticker.style.width = Math.max(0, r.right - r.left) + 'px';
    ticker.style.maxHeight = (r.bottom - r.top) + 'px';
    updateCorner(r);
  }
  function updateCorner(rect) {
    const n = badgeCount();
    if (!battle || held || n <= 0) { corner.hidden = true; return; }
    clear(corner);
    corner.append(icon('chat', 12), el('span', '', badgeText(n)));
    corner.hidden = false;
    const r = rect || currentTickerRect();
    // 기존 HUD 버튼(시점·일시정지 등)과 겹치지 않는 자리를 고른다.
    const box = corner.getBoundingClientRect();
    const spot = badgeRect({
      ticker: r, tickerVisible: !ticker.hidden,
      size: { width: box.width || 56, height: box.height || 20 },
      screen: { width: win.innerWidth, height: win.innerHeight },
      zone: r.zone,
      obstacles: hooks.hudObstacles ? safeCall(() => hooks.hudObstacles()) || [] : [],
    });
    corner.style.left = spot.left + 'px';
    corner.style.top = spot.top + 'px';
  }

  // ── 화면 크기·키보드 ─────────────────────────────
  function applyViewport() {
    const vv = win.visualViewport;
    const h = vv ? vv.height : win.innerHeight;
    const next = layoutFor(win.innerWidth, win.innerHeight);
    const splitChanged = next.boardSplit !== layout.boardSplit;
    layout = next;
    root.classList.toggle('tls-compact', next.compact);
    root.style.setProperty('--tls-vh', Math.round(h) + 'px');
    root.style.setProperty('--tls-sheet-w', next.sideWidth + 'px');
    root.style.setProperty('--tls-margin', next.margin + 'px');
    if (splitChanged && views.board && views.board.relayout) views.board.relayout();
    if (battle && !ticker.hidden) positionTicker();
  }
  bag.listen(win, 'resize', applyViewport);
  bag.listen(win, 'orientationchange', applyViewport);
  if (win.visualViewport) bag.listen(win.visualViewport, 'resize', applyViewport);
  applyViewport();

  bag.listen(doc, 'keydown', event => {
    if (event.key !== 'Escape' || (!isOpen && !modals.length)) return;
    if (menuEl) { closeMenu(); event.stopPropagation(); return; }
    if (modals.length) { modals[modals.length - 1].close(); event.stopPropagation(); return; }
    api.close();
    event.stopPropagation();
  }, true);
  bag.listen(doc, 'pointerdown', event => { if (menuEl && !menuEl.contains(event.target)) closeMenu(); }, true);

  // ── SDK 이벤트 ───────────────────────────────────
  const offs = [];
  offs.push(client.on('state', () => {
    // 열려 있는 채팅 화면의 미확인은 바로 읽음 처리한다.
    if (isOpen && tab === 'chat' && views.chat && views.chat.markVisibleRead) views.chat.markVisibleRead();
    scheduleRefresh();
  }));
  offs.push(client.on('connection', () => { renderConn(); }));
  offs.push(client.on('msg', m => {
    if (!m) return;
    const s = client.state;
    if (battle) {
      const text = tickerText(m, { meId: s.me && s.me.id, blocks: s.blocks });
      if (text) pushLine(text, m.kind === 'fame');
    }
  }));
  offs.push(client.on('invite', m => {
    if (battle || isOpen) return;
    const code = m && m.data && m.data.partyCode;
    if (!code || !hooks.joinParty) return;
    toast((m.from ? m.from.name : '친구') + '님이 파티에 초대했어요.', '', { label: '참가', onClick: () => joinParty(code) });
  }));
  offs.push(client.on('friend', ({ event, player }) => {
    if (battle || !player) return;
    if (event === 'request') toast(player.name + '님이 친구 요청을 보냈어요.', 'good');
    else if (event === 'accepted') toast(player.name + '님과 친구가 됐어요!', 'good');
  }));
  offs.push(client.on('error', info => {
    if (!info) return;
    if (info.source === 'ticket' && info.code === 'no-profile') { setPhase('noprofile'); return; }
    if (info.source === 'ticket') return;
    // 채팅 중 생기는 오류만 알린다(전투 중에는 띄우지 않는다).
    if (!battle && isOpen && ['rate', 'muted', 'repeat', 'length', 'blocked', 'not-friend', 'full', 'banned', 'duplicate'].includes(info.code)) toast(errorMessage(info.code, info.retryAfterMs), 'warn');
  }));

  return api;
}
