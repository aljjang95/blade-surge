// 광장 채팅(시안 C12): 채널 알약·메시지 줄·빠른 문구·입력칸
import { button, clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { channelLabel, clockText, EMOJIS, errorMessage, fullName, QUICK_PHRASES, titleTone } from '../format.js';
import { rowsFor } from '../models.js';

export function createChatView(ctx) {
  const { client } = ctx;
  const root = el('div', 'tls-view tls-chat');
  const bar = el('div', 'tls-chat-bar');
  const list = el('div', 'tls-list tls-scroll');
  list.setAttribute('role', 'log');
  list.setAttribute('aria-label', '채팅 메시지');
  const jump = button('tls-newmsg', '새 메시지 ▼', () => { stick = true; scrollToEnd(); jump.hidden = true; });
  jump.hidden = true;
  const quick = el('div', 'tls-quick');
  const compose = el('form', 'tls-compose');
  const toLabel = el('span', 'tls-to');
  toLabel.hidden = true;
  const input = el('input', 'tls-input', null, { type: 'text', placeholder: '메시지를 입력하세요.', maxlength: 120, autocomplete: 'off', enterkeyhint: 'send', 'aria-label': '메시지' });
  const emojiInput = button('tls-chip tls-round', null, () => toggleEmoji(), { 'aria-label': '이모지' });
  emojiInput.append(icon('smile', 18));
  const send = button('tls-btn tls-btn-orange', '전송', null, { type: 'submit' });
  compose.append(toLabel, input, emojiInput, send);
  const wrap = el('div', 'tls-view', null);
  wrap.style.cssText = 'flex:1;min-height:0;position:relative;display:flex;flex-direction:column';
  wrap.append(list, jump);
  root.append(bar, wrap, quick, compose);

  let stick = true;
  let emojiBox = null;
  let chanMenu = null;
  let quickLockUntil = 0;
  let nameCache = new Map();
  let lastCount = 0;

  const key = () => {
    const s = client.state;
    if (ctx.chatState.mode === 'dm') return 'dm';
    if (ctx.chatState.mode === 'party' && s.partyChannel) return s.partyChannel;
    return s.currentWorld || 'world-1';
  };
  const modeNow = () => {
    const s = client.state;
    if (ctx.chatState.mode === 'party' && !s.partyChannel) ctx.chatState.mode = 'world';
    return ctx.chatState.mode;
  };

  function scrollToEnd() { list.scrollTop = list.scrollHeight; }
  list.addEventListener('scroll', () => {
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
    if (stick) jump.hidden = true;
  }, { passive: true });

  function closePopups() {
    if (emojiBox) { emojiBox.remove(); emojiBox = null; }
    if (chanMenu) { chanMenu.remove(); chanMenu = null; }
  }
  function toggleEmoji() {
    if (emojiBox) { closePopups(); return; }
    closePopups();
    emojiBox = el('div', 'tls-emoji');
    for (const e of EMOJIS) {
      emojiBox.append(button('', e, () => { input.value = (input.value + e).slice(0, 120); input.focus({ preventScroll: true }); closePopups(); }, { 'aria-label': e }));
    }
    wrap.append(emojiBox);
  }
  function toggleChannels(anchor) {
    if (chanMenu) { closePopups(); return; }
    closePopups();
    chanMenu = el('div', 'tls-chanmenu');
    const s = client.state;
    const channels = s.channels.length ? s.channels : [{ id: s.currentWorld || 'world-1', count: 0 }];
    for (const c of channels) {
      const n = Number((/^world-(\d+)$/.exec(c.id) || [])[1]);
      if (!n) continue;
      const b = button(c.id === s.currentWorld ? 'on' : '', null, () => {
        closePopups();
        ctx.chatState.mode = 'world';
        const r = client.joinWorld(n);
        if (!r.ok) ctx.toast(errorMessage(r.error), 'warn');
        refresh();
      });
      b.append(el('span', '', '광장 ' + n), el('span', 'tls-tag', c.count + '명'));
      chanMenu.append(b);
    }
    root.append(chanMenu);
    void anchor;
  }

  function renderBar() {
    const s = client.state;
    const mode = modeNow();
    clear(bar);
    const world = el('button', 'tls-pill' + (mode === 'world' ? ' on' : ''), null, { type: 'button', 'aria-haspopup': 'listbox' });
    world.append(el('span', '', channelLabel(s.currentWorld, s.channels)), icon('chevronDown', 16));
    world.addEventListener('click', () => { if (mode !== 'world') { ctx.chatState.mode = 'world'; refresh(); } else toggleChannels(world); });
    bar.append(world);
    if (s.partyChannel) {
      const party = el('button', 'tls-pill' + (mode === 'party' ? ' on' : ''), null, { type: 'button' });
      party.append(icon('flag', 14), el('span', '', '파티'));
      const n = s.unread.get(s.partyChannel) || 0;
      if (n > 0 && mode !== 'party') party.append(el('span', 'tls-count', String(n)));
      party.addEventListener('click', () => { ctx.chatState.mode = 'party'; refresh(); });
      bar.append(party);
    }
    const dm = el('button', 'tls-pill' + (mode === 'dm' ? ' on' : ''), null, { type: 'button' });
    dm.append(icon('chat', 14), el('span', '', '귓속말'));
    const dn = s.unread.get('dm') || 0;
    if (dn > 0 && mode !== 'dm') dm.append(el('span', 'tls-count', String(dn)));
    dm.addEventListener('click', () => { ctx.chatState.mode = 'dm'; refresh(); });
    bar.append(dm);
  }

  function titleBadge(title, id) {
    const t = el('span', 'tls-title tone-' + titleTone(id));
    t.append(icon('crown', 13), el('span', '', title));
    return t;
  }

  function rowEl(row) {
    const s = client.state;
    if (row.type === 'fame') {
      const node = el('div', 'tls-fame');
      node.append(icon('crown', 26));
      const text = el('div', 'tls-fame-text');
      if (row.first) { text.append(el('span', '', row.text), el('em', '', row.name), el('span', '', '님이 ' + row.tail)); }
      else text.append(el('span', '', row.text));
      node.append(text, el('span', 'tls-time', clockText(row.at)));
      return node;
    }
    if (row.type === 'system') return el('div', 'tls-sys', row.text);
    if (row.type === 'listing') return listingEl(row.listing, row.at);
    if (row.type === 'invite') {
      const node = el('div', 'tls-listing');
      const main = el('div', 'tls-lmain');
      main.append(el('div', 'tls-ltitle', '파티 초대'), el('div', 'tls-lsub', row.text || ''), el('div', 'tls-lhost', clockText(row.at)));
      node.append(ctx.portrait(row.from, 'md'), main);
      if (row.partyCode && !row.own) node.append(button('tls-btn tls-btn-orange', '참가', () => ctx.joinParty(row.partyCode)));
      return node;
    }
    const node = el('div', 'tls-msg' + (row.own ? ' own' : '') + (row.type === 'whisper' ? ' whisper' : ''));
    node.append(ctx.portrait(row.from, 'md'));
    const main = el('div', 'tls-msg-main');
    const top = el('div', 'tls-msg-top');
    if (row.type === 'chat' && row.title) top.append(titleBadge(row.title, row.titleId));
    if (row.type === 'whisper') {
      const peer = row.peer || (row.peerId ? nameCache.get(row.peerId) : null);
      top.append(el('span', 'tls-wlabel', row.own ? '귓속말 → ' + (peer ? fullName(peer) : '상대') : '귓속말'));
    }
    top.append(ctx.nameButton(row.from, { msgId: row.type === 'chat' ? row.id : undefined }), el('span', 'tls-time', clockText(row.at)));
    main.append(top, el('div', 'tls-msg-text', row.text));
    node.append(main);
    if (row.type === 'whisper' && !row.own && row.from) {
      node.addEventListener('click', event => { if (event.target.closest('button')) return; ctx.chatState.dmTarget = row.from; renderCompose(); });
    }
    return node;
  }

  function listingEl(l, at) {
    const node = el('div', 'tls-listing');
    const art = ctx.contentArt(l.contentId);
    const thumb = el('div', 'tls-thumb');
    if (art) thumb.style.backgroundImage = 'url(' + JSON.stringify(art) + ')';
    const main = el('div', 'tls-lmain');
    const sub = [l.members + '/' + l.slots, l.note].filter(Boolean).join(' · ');
    main.append(el('div', 'tls-ltitle', l.title), el('div', 'tls-lsub', sub), el('div', 'tls-lhost', (l.host ? fullName(l.host) : '') + (at ? ' · ' + clockText(at) : '')));
    node.append(thumb, main);
    if (l.joinable) node.append(button('tls-btn tls-btn-orange', '참가', () => ctx.joinParty(l.partyCode)));
    else node.append(el('span', 'tls-tag', l.stateText));
    return node;
  }

  function renderList() {
    const s = client.state;
    const k = key();
    const rows = rowsFor(s.messages.get(k), {
      meId: s.me && s.me.id, blocks: s.blocks, config: ctx.config,
      nameOf: id => (s.friends.get(id) && s.friends.get(id).mini) || (ctx.chatState.dmTarget && ctx.chatState.dmTarget.id === id ? ctx.chatState.dmTarget : null),
    });
    nameCache = new Map();
    const previous = list.scrollTop;
    clear(list);
    if (!rows.length) {
      const hint = modeNow() === 'dm' ? '친구에게 귓속말이 오면 여기에 보여요.' : '첫 인사를 남겨 보세요!';
      list.append(el('div', 'tls-empty', hint));
    } else for (const row of rows) list.append(rowEl(row));
    if (stick) scrollToEnd();
    else { list.scrollTop = previous; if (rows.length > lastCount) jump.hidden = false; }
    lastCount = rows.length;
  }

  function renderQuick() {
    clear(quick);
    const emoji = button('tls-chip tls-round', null, () => toggleEmoji(), { 'aria-label': '이모지' });
    emoji.append(icon('smile', 18));
    quick.append(emoji);
    for (const phrase of QUICK_PHRASES) {
      quick.append(button('tls-chip', phrase, () => {
        if (Date.now() < quickLockUntil) return;
        quickLockUntil = Date.now() + 1300;
        sendText(phrase);
      }));
    }
  }

  function renderCompose() {
    const mode = modeNow();
    const target = ctx.chatState.dmTarget;
    toLabel.hidden = mode !== 'dm';
    clear(toLabel);
    if (mode === 'dm') {
      toLabel.append(el('span', '', target ? '→ ' + target.name : '받는 사람 없음'));
      if (target) toLabel.append(button('tls-link', '✕', () => { ctx.chatState.dmTarget = null; renderCompose(); }, { 'aria-label': '받는 사람 지우기' }));
    }
    input.placeholder = mode === 'dm' ? (target ? '귓속말을 입력하세요.' : '친구 이름을 눌러 귓속말을 시작하세요.') : '메시지를 입력하세요.';
  }

  function sendText(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (ctx.phase !== 'ready') { ctx.toast('커뮤니티에 연결되면 보낼 수 있어요.', 'warn'); return false; }
    const mode = modeNow();
    let result;
    if (mode === 'dm') {
      const target = ctx.chatState.dmTarget;
      if (!target) { ctx.toast('귓속말을 받을 친구를 먼저 골라 주세요.', 'warn'); return false; }
      result = client.whisper(target.id, value);
    } else result = client.say(key(), value);
    if (!result.ok) { ctx.toast(errorMessage(result.error, result.retryAfterMs), 'warn'); return false; }
    stick = true;
    if (result.data && result.data.queued) ctx.toast('연결되면 전송돼요.', '');
    return true;
  }

  compose.addEventListener('submit', event => {
    event.preventDefault();
    if (sendText(input.value)) input.value = '';
  });
  input.addEventListener('focus', () => { setTimeout(() => { if (stick) scrollToEnd(); }, 250); });
  // 입력 중 다른 곳을 누르면 팝업을 닫는다.
  root.addEventListener('pointerdown', event => {
    if (emojiBox && !emojiBox.contains(event.target) && !event.target.closest('.tls-round')) closePopups();
    if (chanMenu && !chanMenu.contains(event.target) && !event.target.closest('.tls-pill')) closePopups();
  });

  function markVisibleRead() {
    client.markRead(key());
    if (key() !== 'dm' && modeNow() === 'world') { /* 광장 미확인은 열 때 읽음 처리 */ }
  }

  function refresh() {
    renderBar();
    renderList();
    renderQuick();
    renderCompose();
    markVisibleRead();
  }

  return {
    el: root,
    show() { stick = true; refresh(); },
    hide() { closePopups(); },
    refresh,
    markVisibleRead,
    focusInput() { setTimeout(() => input.focus({ preventScroll: true }), 50); },
  };
}
