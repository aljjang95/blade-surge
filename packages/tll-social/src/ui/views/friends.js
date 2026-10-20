// 친구·내 프로필(시안 C18)
import { button, clear, el } from '../dom.js';
import { icon, laurel } from '../icons.js';
import { errorMessage, fullName, parseFriendCode } from '../format.js';
import { friendWhere, sortFriends } from '../models.js';
import { isLinked, openNicknameModal, openSettingsModal, openTitlesModal, startGoogleLink, titleChip } from './modals.js';

const FRIEND_LIMIT = 100;

export function createFriendsView(ctx) {
  const { client, config } = ctx;
  const root = el('div', 'tls-view');
  const grid = el('div', 'tls-friends');
  root.append(grid);

  // ── 왼쪽: 친구 목록 / 추가 / 받은 요청 ───────────
  const left = el('div', 'tls-fcol');
  const listSection = el('div', 'tls-section');
  listSection.style.flex = '1';
  const listHead = el('div', 'tls-section-head');
  const listTitle = el('span', '', '친구');
  const listCount = el('span', 'tls-right');
  listHead.append(icon('friends', 20), listTitle, listCount);
  const list = el('div', 'tls-scroll');
  list.style.cssText = 'flex:1;min-height:3em';
  listSection.append(listHead, list);

  const lower = el('div', 'tls-section tls-scroll');
  lower.style.cssText = 'flex:none;max-height:48%';
  const addHead = el('div', 'tls-section-head');
  addHead.append(icon('friendAdd', 20), el('span', '', '친구 추가'));
  const addRow = el('form', 'tls-addrow');
  const addInput = el('input', 'tls-input', null, { type: 'text', placeholder: '닉네임#1234', autocomplete: 'off', spellcheck: 'false', maxlength: 20, 'aria-label': '친구 닉네임#태그' });
  const addClear = button('tls-iconbtn', null, () => { addInput.value = ''; addInput.focus(); }, { 'aria-label': '지우기' });
  addClear.append(icon('close', 14));
  const addSubmit = button('tls-btn tls-btn-orange', '요청', null, { type: 'submit' });
  const addBox = el('div');
  addBox.style.cssText = 'flex:1;min-width:0;display:flex;gap:.3em;align-items:center';
  addBox.append(addInput, addClear);
  addRow.append(addBox, addSubmit);
  const reqHead = el('div', 'tls-section-head');
  const reqTitle = el('span', '', '받은 요청');
  const reqCount = el('span', 'tls-count');
  reqHead.append(icon('friendCheck', 20), reqTitle, reqCount);
  const reqList = el('div');
  lower.append(addHead, addRow, reqHead, reqList);
  left.append(listSection, lower);

  // ── 오른쪽: 내 프로필 ───────────────────────────
  const right = el('div', 'tls-fcol');
  const profileSection = el('div', 'tls-section tls-profile');
  profileSection.style.flex = '1';
  const profileHead = el('div', 'tls-section-head');
  const settings = button('tls-iconbtn', null, () => openSettingsModal(ctx), { 'aria-label': '설정' });
  settings.append(icon('gear', 18));
  settings.style.marginLeft = 'auto';
  profileHead.append(icon('person', 20), el('span', '', '내 프로필'), settings);
  const profileBody = el('div', 'tls-scroll tls-pscroll');
  profileSection.append(profileHead, profileBody);
  right.append(profileSection);
  grid.append(left, right);

  addRow.addEventListener('submit', async event => {
    event.preventDefault();
    const value = addInput.value.trim();
    if (!parseFriendCode(value)) { ctx.toast(errorMessage('code'), 'warn'); addInput.classList.add('tls-bad'); return; }
    addInput.classList.remove('tls-bad');
    addSubmit.disabled = true;
    const r = await client.friendRequest(value.normalize('NFKC'));
    addSubmit.disabled = false;
    if (r.ok) {
      addInput.value = '';
      ctx.toast(r.data && r.data.status === 'friends' ? '친구가 됐어요!' : '친구 요청을 보냈어요.', 'good');
    } else ctx.toast(errorMessage(r.error, r.retryAfterMs), 'warn');
  });

  function friendRow(entry) {
    const mini = entry.mini;
    const row = el('div', 'tls-frow');
    row.append(ctx.portrait(mini, 'md'));
    const main = el('div', 'tls-fmain');
    const nameLine = el('div', 'tls-fname');
    nameLine.append(ctx.nameButton(mini));
    const sub = el('div', 'tls-fsub');
    if (mini && mini.title) sub.append(el('span', '', mini.title.label));
    const where = friendWhere(entry);
    if (ctx.compact) {
      sub.append(el('i', 'tls-dot' + (entry.online ? ' on' : '')), el('span', '', where));
    }
    main.append(nameLine, sub);
    row.append(main);
    if (!ctx.compact) {
      const w = el('div', 'tls-fwhere' + (entry.online ? '' : ' off'));
      w.append(el('i', 'tls-dot' + (entry.online ? ' on' : '')), el('span', '', where));
      row.append(w);
    }
    const acts = el('div', 'tls-facts');
    const whisper = button('tls-btn tls-btn-blue tls-btn-sm', null, () => ctx.whisperTo(mini));
    whisper.append(icon('chat', 14), el('span', '', '귓속말'));
    const invite = button('tls-btn tls-btn-orange tls-btn-sm', null, () => ctx.inviteFriend(mini.id));
    invite.append(icon('friendAdd', 14), el('span', '', '초대'));
    acts.append(whisper, invite);
    row.append(acts);
    return row;
  }

  function renderFriends() {
    const s = client.state;
    const friends = sortFriends(s.friends).filter(f => f.mini);
    listCount.replaceChildren(document.createTextNode('친구 수 '), el('b', '', String(friends.length)), document.createTextNode(' / ' + FRIEND_LIMIT));
    clear(list);
    if (!friends.length) {
      const empty = el('div', 'tls-empty');
      empty.append(el('b', '', '아직 친구가 없어요'), el('span', '', '광장 채팅에서 이름을 눌러 친구 요청을 보내거나, 아래에 닉네임#태그를 입력해 보세요.'));
      list.append(empty);
    } else for (const f of friends) list.append(friendRow(f));
  }

  function renderRequests() {
    const s = client.state;
    const incoming = s.requests.incoming, outgoing = s.requests.outgoing;
    reqCount.hidden = incoming.length === 0;
    reqCount.textContent = String(incoming.length);
    clear(reqList);
    if (!incoming.length && !outgoing.length) { reqList.append(el('div', 'tls-hint', '받은 요청이 없어요.')); return; }
    for (const mini of incoming) {
      const row = el('div', 'tls-reqrow');
      const label = el('div', 'tls-fmain');
      label.append(ctx.nameButton(mini));
      row.append(ctx.portrait(mini, 'sm'), label,
        button('tls-btn tls-btn-blue tls-btn-sm', '수락', async () => { const r = await client.friendRespond(mini.id, true); ctx.toast(r.ok ? mini.name + '님과 친구가 됐어요!' : errorMessage(r.error), r.ok ? 'good' : 'warn'); }),
        button('tls-btn tls-btn-navy tls-btn-sm', '거절', async () => { const r = await client.friendRespond(mini.id, false); if (!r.ok) ctx.toast(errorMessage(r.error), 'warn'); }));
      reqList.append(row);
    }
    if (outgoing.length) {
      reqList.append(el('div', 'tls-hint', '보낸 요청 ' + outgoing.length + '건 · 상대가 수락하면 친구가 돼요.'));
      for (const mini of outgoing) {
        const row = el('div', 'tls-reqrow');
        row.append(ctx.portrait(mini, 'sm'), el('span', 'tls-fmain', fullName(mini)), el('span', 'tls-tag', '대기 중'));
        reqList.append(row);
      }
    }
  }

  function renderProfile() {
    const s = client.state;
    const me = s.me;
    clear(profileBody);
    if (!me) return;
    const box = el('div', 'tls-pbox');
    const top = el('div');
    top.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:.4em';
    top.append(ctx.portrait(me, 'xl'));
    const name = el('div', 'tls-pname');
    name.append(el('b', '', me.name), el('span', 'tls-tag', '#' + me.tag));
    const pencil = button('tls-iconbtn', null, () => openNicknameModal(ctx, null, { rename: true }), { 'aria-label': '닉네임 바꾸기' });
    pencil.append(icon('pencil', 14));
    pencil.style.cssText = 'width:1.8em;height:1.8em';
    name.append(pencil);
    top.append(name);
    box.append(top);
    const founder = s.titles.some(t => t.id === config.founders.titleId) || (Number.isFinite(me.no) && me.no <= config.founders.maxNo);
    const medal = el('div', 'tls-medal' + (founder ? '' : ' silver'));
    medal.append(laurel(176));
    const core = el('div', 'tls-medal-core');
    core.append(icon('swords', 26), el('small', '', founder ? config.founders.label : '모험가'), el('b', '', 'No.' + me.no));
    medal.append(core);
    box.append(medal);
    profileBody.append(box);

    const titles = el('div', 'tls-ptitles');
    const th = el('div', 'tls-ph');
    th.append(icon('crown', 18), el('span', '', '획득한 칭호'), button('tls-btn tls-btn-ghost tls-btn-sm', '모두 보기 ›', () => openTitlesModal(ctx)));
    titles.append(th);
    const chips = el('div', 'tls-chips');
    const rep = me.title ? me.title.id : null;
    if (!s.titles.length) chips.append(el('span', 'tls-tag', '아직 받은 칭호가 없어요. 던전을 가장 먼저 정복해 보세요!'));
    for (const t of s.titles.slice(0, 6)) chips.append(titleChip(t, { rep: t.id === rep }));
    titles.append(chips);
    profileBody.append(titles);

    const linked = isLinked(me);
    const actions = el('div');
    actions.style.cssText = 'padding:.4em .7em;display:flex;flex-direction:column;gap:.4em';
    if (linked) {
      const done = button('tls-btn tls-btn-ghost tls-btn-block', null, () => openSettingsModal(ctx, 'google'));
      done.append(icon('shield', 16), el('span', '', '구글 연동됨 · 기록 보호 중'));
      actions.append(done);
    } else if (ctx.hooks.googleSignIn) {
      const link = button('tls-btn tls-btn-blue tls-btn-block', null, () => startGoogleLink(ctx));
      link.append(icon('shield', 16), el('span', '', '기록 보호하기 · 구글 연동'));
      actions.append(link);
    } else {
      const soon = button('tls-btn tls-btn-blue tls-btn-block', null, null, { disabled: true });
      soon.append(icon('shield', 16), el('span', '', '기록 보호하기 · 구글 연동 (준비 중)'));
      actions.append(soon);
    }
    profileBody.append(actions);

    const code = el('div', 'tls-codebox');
    const label = el('div', 'tls-fmain');
    label.append(el('small', '', '내 친구 코드'), el('b', '', fullName(me)));
    code.append(icon('copy', 22), label, button('tls-btn tls-btn-blue tls-btn-sm', '복사', () => ctx.copy(fullName(me), '친구 코드를 복사했어요.')));
    profileBody.append(code);
  }

  function refresh() {
    renderFriends();
    renderRequests();
    renderProfile();
  }

  return {
    el: root,
    show() { client.me().then(() => refresh()); refresh(); },
    hide() {},
    refresh,
  };
}
