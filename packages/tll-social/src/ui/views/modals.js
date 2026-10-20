// 대화상자 모음: 닉네임·프로필·설정(기기 이전·구글·차단 목록)·칭호·신고
import { button, clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { checkNickname, clockText, dateText, errorMessage, fullName, presenceText, titleTone } from '../format.js';
import { REPORT_REASONS } from '../models.js';

function labeled(text, control) {
  const label = el('label', '', text);
  label.append(control);
  return label;
}

export function titleChip(title, { rep = false, onClick } = {}) {
  const node = el(onClick ? 'button' : 'span', 'tls-title tone-' + titleTone(title.id) + (rep ? ' rep' : ''), null, onClick ? { type: 'button' } : undefined);
  node.append(icon(rep ? 'star' : 'crown', 13), el('span', '', title.label));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** 닉네임 정하기/바꾸기. done(true|false)로 결과를 알린다. */
export function openNicknameModal(ctx, done, { rename = false } = {}) {
  const input = el('input', 'tls-input', null, { type: 'text', maxlength: 12, placeholder: '닉네임 (2~12자)', autocomplete: 'off', spellcheck: 'false', 'aria-label': '닉네임' });
  if (rename && ctx.client.state.me) input.value = ctx.client.state.me.name;
  const err = el('p', 'tls-err');
  let finished = false;
  const finish = ok => { if (finished) return; finished = true; if (done) done(ok); };
  const submit = button('tls-btn tls-btn-orange', rename ? '바꾸기' : '시작하기', async () => {
    err.textContent = '';
    const check = checkNickname(input.value);
    if (!check.ok) { input.classList.add('tls-bad'); err.textContent = errorMessage('name'); return; }
    input.classList.remove('tls-bad');
    const result = rename ? await ctx.client.profile(check.name) : await ctx.createProfile(check.name);
    if (!result.ok) { input.classList.add('tls-bad'); err.textContent = errorMessage(result.error, result.retryAfterMs); return; }
    ctx.toast(rename ? '닉네임을 바꿨어요.' : '환영해요, ' + check.name + '님!', 'good');
    finish(true);
    handle.close();
  });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit.click(); } });
  const handle = ctx.modal({
    title: rename ? '닉네임 바꾸기' : '닉네임 정하기',
    body: [
      el('p', 'tls-note', rename ? '닉네임은 24시간에 한 번만 바꿀 수 있고, 바꾸면 #숫자 태그도 새로 받아요.' : '로그인 없이 바로 시작해요. 한글·영문·숫자·_ 2~12자로 정해 주세요.'),
      input, err,
    ],
    actions: [button('tls-btn tls-btn-navy', '취소', () => handle.close()), submit],
    onClose: () => finish(false),
  });
  return handle;
}

/** 구글 연동: ID 토큰은 게임이 hooks.googleSignIn으로 받아 온다. */
export async function startGoogleLink(ctx) {
  if (!ctx.hooks.googleSignIn) { ctx.toast('구글 연동은 준비 중이에요.'); return false; }
  let token = null;
  try { token = await ctx.hooks.googleSignIn(); } catch { token = null; }
  if (!token) { ctx.toast('구글 로그인을 완료하지 못했어요.', 'warn'); return false; }
  const result = await ctx.client.linkGoogle(token);
  ctx.toast(result.ok ? '구글 계정과 연동했어요. 기록이 보호돼요!' : errorMessage(result.error), result.ok ? 'good' : 'warn');
  return result.ok;
}
export async function startGoogleRecover(ctx) {
  if (!ctx.hooks.googleSignIn) { ctx.toast('구글 연동은 준비 중이에요.'); return false; }
  let token = null;
  try { token = await ctx.hooks.googleSignIn(); } catch { token = null; }
  if (!token) { ctx.toast('구글 로그인을 완료하지 못했어요.', 'warn'); return false; }
  const result = await ctx.client.recoverWithGoogle(token);
  if (result.ok) { ctx.toast('기록을 되찾았어요!', 'good'); ctx.loadMe(); } else ctx.toast(errorMessage(result.error), 'warn');
  return result.ok;
}
export function isLinked(me) {
  return !!(me && (me.linked || (Array.isArray(me.links) && me.links.includes('google'))));
}

/** 다른 사람 프로필. 친구면 접속 상태도 보인다. */
export async function openProfileModal(ctx, mini) {
  if (!mini || !mini.id) return;
  if (!(await ctx.requireProfile())) return;
  const body = el('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:.6em;align-items:center;text-align:center';
  body.append(el('div', 'tls-spin'));
  const handle = ctx.modal({ title: '프로필', body });
  const result = await ctx.client.player(mini.id);
  if (!handle.overlay.isConnected) return;
  clear(body);
  if (!result.ok) { body.append(el('p', 'tls-err', errorMessage(result.error))); return; }
  const p = result.data || {};
  const info = { ...mini, ...p };
  const me = ctx.client.state;
  const meId = me.me && me.me.id;
  const isFriend = me.friends.has(info.id);
  const blocked = me.blocks.has(info.id);
  body.append(ctx.portrait(info, 'xl'));
  const name = el('div', 'tls-pname');
  name.append(el('b', '', info.name), el('span', 'tls-tag', '#' + info.tag));
  body.append(name);
  if (info.title) body.append(titleChip(info.title, {}));
  const facts = [];
  if (Number.isFinite(info.no)) facts.push('가입 순번 No.' + info.no);
  if (Number.isFinite(p.clears)) facts.push('정복한 던전 ' + p.clears + '곳');
  if (p.createdAt) facts.push(dateText(p.createdAt) + ' 가입');
  if (facts.length) body.append(el('p', 'tls-note', facts.join(' · ')));
  if (Array.isArray(p.titles) && p.titles.length) {
    const chips = el('div', 'tls-chips');
    chips.style.justifyContent = 'center';
    for (const t of p.titles) chips.append(titleChip(t));
    body.append(chips);
  }
  if (isFriend) {
    const entry = me.friends.get(info.id);
    body.append(el('p', 'tls-note', entry && entry.online ? '🟢 ' + (presenceText(entry.presence) || '접속 중') : '오프라인'));
  }
  if (info.id !== meId) {
    const row = el('div');
    row.style.cssText = 'display:flex;gap:.5em;flex-wrap:wrap;justify-content:center;margin-top:.3em';
    if (!isFriend) row.append(button('tls-btn tls-btn-orange tls-btn-sm', '친구 요청', async () => {
      const r = await ctx.client.friendRequest(info.id);
      ctx.toast(r.ok ? (r.data && r.data.status === 'friends' ? '친구가 됐어요!' : '친구 요청을 보냈어요.') : errorMessage(r.error, r.retryAfterMs), r.ok ? 'good' : 'warn');
    }));
    else row.append(button('tls-btn tls-btn-navy tls-btn-sm', '친구 삭제', async () => {
      if (!(await ctx.confirm(fullName(info) + '님을 친구에서 삭제할까요?', '삭제'))) return;
      const r = await ctx.client.friendRemove(info.id);
      ctx.toast(r.ok ? '친구에서 삭제했어요.' : errorMessage(r.error), r.ok ? '' : 'warn');
      if (r.ok) handle.close();
    }));
    row.append(button('tls-btn tls-btn-blue tls-btn-sm', '귓속말', () => { handle.close(); ctx.whisperTo(info); }));
    if (isFriend) row.append(button('tls-btn tls-btn-orange tls-btn-sm', '초대', () => ctx.inviteFriend(info.id)));
    row.append(button('tls-btn tls-btn-ghost tls-btn-sm', blocked ? '차단 해제' : '차단', async () => {
      if (!blocked && !(await ctx.confirm(fullName(info) + '님을 차단할까요? 채팅과 요청이 보이지 않아요.', '차단'))) return;
      const r = await ctx.client.block(info.id, !blocked);
      ctx.toast(r.ok ? (blocked ? '차단을 풀었어요.' : '차단했어요.') : errorMessage(r.error), r.ok ? '' : 'warn');
      if (r.ok) handle.close();
    }));
    row.append(button('tls-btn tls-btn-ghost tls-btn-sm', '신고', () => { handle.close(); openReportModal(ctx, { kind: 'player', target: info.id, label: fullName(info) }); }));
    body.append(row);
  }
}

/** 신고: 사유 칩 + 선택 메모(100자). */
export function openReportModal(ctx, { kind, target, ref, label }) {
  let reason = REPORT_REASONS[0];
  const memo = el('input', 'tls-input', null, { type: 'text', maxlength: 60, placeholder: '추가로 알려 줄 내용 (선택)', 'aria-label': '추가 내용' });
  const chips = el('div', 'tls-chips');
  const renderChips = () => {
    clear(chips);
    for (const r of REPORT_REASONS) chips.append(button('tls-chip' + (r === reason ? ' on' : ''), r, () => { reason = r; renderChips(); }));
  };
  renderChips();
  const submit = button('tls-btn tls-btn-red', '신고하기', async () => {
    const text = (reason + (memo.value.trim() ? ' · ' + memo.value.trim() : '')).slice(0, 100);
    const r = await ctx.client.report({ kind, target, ref, reason: text });
    if (r.ok) { ctx.toast('신고가 접수됐어요. 확인 후 조치할게요.', 'good'); handle.close(); }
    else ctx.toast(errorMessage(r.error, r.retryAfterMs), 'warn');
  });
  const handle = ctx.modal({
    title: '신고하기',
    body: [el('p', 'tls-note', (label ? label + '님' : '') + (kind === 'post' ? ' 글을' : '을(를)') + ' 신고하는 이유를 골라 주세요.'), chips, memo],
    actions: [button('tls-btn tls-btn-navy', '취소', () => handle.close()), submit],
  });
  return handle;
}

/** 칭호 모두 보기 + 대표 칭호 고르기 */
export function openTitlesModal(ctx) {
  const body = el('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:.5em';
  const handle = ctx.modal({ title: '획득한 칭호', body, actions: [button('tls-btn tls-btn-navy', '닫기', () => handle.close())] });
  const render = () => {
    clear(body);
    const s = ctx.client.state;
    const rep = s.me && s.me.title ? s.me.title.id : null;
    body.append(el('p', 'tls-note', '칭호를 누르면 이름 옆에 보이는 대표 칭호로 정해요.'));
    if (!s.titles.length) { body.append(el('div', 'tls-empty', '아직 받은 칭호가 없어요. 던전을 가장 먼저 정복해 보세요!')); return; }
    const chips = el('div', 'tls-chips');
    for (const t of s.titles) {
      chips.append(titleChip(t, {
        rep: t.id === rep,
        onClick: async () => {
          const r = await ctx.client.setTitle(t.id === rep ? null : t.id);
          ctx.toast(r.ok ? (t.id === rep ? '대표 칭호를 내렸어요.' : '대표 칭호를 바꿨어요.') : errorMessage(r.error), r.ok ? 'good' : 'warn');
          render();
        },
      }));
    }
    body.append(chips);
    if (rep) body.append(button('tls-btn tls-btn-ghost tls-btn-sm', '대표 칭호 내리기', async () => { const r = await ctx.client.setTitle(null); if (!r.ok) ctx.toast(errorMessage(r.error), 'warn'); render(); }));
  };
  render();
  return handle;
}

/** 설정(톱니): 닉네임·내 ID·기기 이전 코드·구글 연동·차단 목록 */
export function openSettingsModal(ctx, section) {
  const body = el('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:.9em';
  const handle = ctx.modal({ title: '설정', wide: true, body, actions: [button('tls-btn tls-btn-navy', '닫기', () => handle.close())] });
  const blocks = [];

  const me = ctx.client.state.me;
  const group = (title, ...children) => {
    const box = el('div', 'tls-mini');
    box.append(el('h4', '', title));
    const inner = el('div');
    inner.style.cssText = 'padding:.6em .7em;display:flex;flex-direction:column;gap:.5em';
    inner.append(...children);
    box.append(inner);
    return box;
  };

  // 기기 이전 코드
  const secret = el('div', 'tls-secret tls-blur', ctx.client.exportKey());
  let shown = false;
  const reveal = button('tls-btn tls-btn-navy tls-btn-sm', '코드 보기', () => {
    shown = !shown;
    secret.classList.toggle('show', shown);
    reveal.textContent = shown ? '가리기' : '코드 보기';
  });
  const transferIn = el('input', 'tls-input', null, { type: 'text', placeholder: '다른 기기의 이전 코드를 붙여 넣으세요', autocomplete: 'off', spellcheck: 'false', 'aria-label': '이전 코드 입력' });
  const transferErr = el('p', 'tls-err');
  const transfer = group('기기 이전',
    el('p', 'tls-note', '이전 코드는 이 기기의 비밀번호와 같아요. 다른 사람에게 알려 주지 마세요. 새 기기에서 코드를 입력하면 친구·칭호·기록을 그대로 이어요.'),
    secret,
    (() => { const row = el('div'); row.style.cssText = 'display:flex;gap:.5em'; row.append(reveal, button('tls-btn tls-btn-navy tls-btn-sm', '복사', () => ctx.copy(ctx.client.exportKey(), '이전 코드를 복사했어요.'))); return row; })(),
    transferIn, transferErr,
    button('tls-btn tls-btn-orange tls-btn-sm', '이 코드로 불러오기', async () => {
      transferErr.textContent = '';
      const code = transferIn.value.trim();
      if (!code) { transferErr.textContent = '이전 코드를 입력해 주세요.'; return; }
      if (code !== ctx.client.exportKey() && !(await ctx.confirm('이 기기의 신원이 입력한 코드의 기록으로 바뀌어요. 이 기기의 현재 기록은 이전 코드를 따로 저장해 두지 않으면 되돌릴 수 없어요. 계속할까요?', '불러오기'))) return;
      const r = await ctx.client.importKey(code);
      if (!r.ok) { transferErr.textContent = errorMessage(r.error); return; }
      ctx.toast('코드를 적용했어요. 기록을 불러오는 중…', 'good');
      handle.close();
      ctx.loadMe();
    }),
  );
  blocks.push(['transfer', transfer]);

  if (me) {
    const idBox = el('div', 'tls-secret', me.id);
    blocks.push(['account', group('내 정보',
      el('p', 'tls-note', '닉네임: ' + fullName(me) + ' · 가입 순번 No.' + me.no),
      button('tls-btn tls-btn-navy tls-btn-sm', '닉네임 바꾸기', () => { handle.close(); openNicknameModal(ctx, null, { rename: true }); }),
      idBox,
      button('tls-btn tls-btn-navy tls-btn-sm', '내 ID 복사 (관리자 지정용)', () => ctx.copy(me.id, '내 ID를 복사했어요.')),
    )]);
  }

  // 구글 연동·되찾기
  const linked = isLinked(me);
  const googleRow = [];
  if (me) {
    googleRow.push(el('p', 'tls-note', linked ? '구글 계정과 연동돼 있어요. 기기를 바꿔도 구글로 기록을 되찾을 수 있어요.' : '구글 계정을 연동하면 폰을 바꾸거나 앱을 다시 설치해도 친구·칭호·기록을 되찾을 수 있어요.'));
    if (!linked) googleRow.push(button('tls-btn tls-btn-blue tls-btn-sm', ctx.hooks.googleSignIn ? '기록 보호하기 · 구글 연동' : '구글 연동 (준비 중)', () => startGoogleLink(ctx).then(() => handle.close()), ctx.hooks.googleSignIn ? undefined : { disabled: true }));
    else googleRow.push(button('tls-btn tls-btn-ghost tls-btn-sm', '연동 해제', async () => {
      if (!(await ctx.confirm('구글 연동을 해제하면 기기를 잃어버렸을 때 기록을 되찾을 수 없어요. 해제할까요?', '해제'))) return;
      const r = await ctx.client.unlink('google');
      ctx.toast(r.ok ? '연동을 해제했어요.' : errorMessage(r.error), r.ok ? '' : 'warn');
      handle.close();
    }));
  }
  googleRow.push(button('tls-btn tls-btn-ghost tls-btn-sm', ctx.hooks.googleSignIn ? '구글로 기록 되찾기' : '구글로 기록 되찾기 (준비 중)', () => startGoogleRecover(ctx).then(ok => { if (ok) handle.close(); }), ctx.hooks.googleSignIn ? undefined : { disabled: true }));
  blocks.push(['google', group('구글 계정', ...googleRow)]);

  // 차단 목록
  const blockedList = el('div');
  blockedList.style.cssText = 'display:flex;flex-direction:column;gap:.3em';
  const renderBlocked = async () => {
    clear(blockedList);
    const ids = [...ctx.client.state.blocks];
    if (!ids.length) { blockedList.append(el('p', 'tls-note', '차단한 사람이 없어요.')); return; }
    for (const id of ids) {
      const row = el('div', 'tls-reqrow');
      row.style.padding = '0';
      const entry = ctx.client.state.blockMinis && ctx.client.state.blockMinis.get(id);
      row.append(el('span', 'tls-fmain', entry ? fullName(entry) : id), button('tls-btn tls-btn-navy tls-btn-sm', '해제', async () => {
        const r = await ctx.client.block(id, false);
        ctx.toast(r.ok ? '차단을 풀었어요.' : errorMessage(r.error), r.ok ? '' : 'warn');
        renderBlocked();
      }));
      blockedList.append(row);
    }
  };
  renderBlocked();
  blocks.push(['blocks', group('차단 목록', blockedList)]);

  const discord = ctx.discordInvite();
  if (discord) {
    const a = el('a', 'tls-btn tls-btn-discord tls-btn-sm', '디스코드 열기', { href: discord, target: '_blank', rel: 'noopener noreferrer' });
    blocks.push(['discord', group('디스코드', el('p', 'tls-note', '개발팀·다른 모험가와 실시간으로 이야기해요.'), a)]);
  }

  blocks.sort((a, b) => (a[0] === section ? -1 : b[0] === section ? 1 : 0));
  for (const [, node] of blocks) body.append(node);
  void clockText;
  return handle;
}
