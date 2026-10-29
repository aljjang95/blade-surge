// 계정 로그인 UI: 첫 실행 로그인 시트 + 설정의 계정 메뉴(연동 상태·연동·회원 탈퇴).
// 로직은 net/account-login.js 에 있고 여기서는 보여 주기만 한다. 플레이 화면을 오래 막지 않도록 시트는 한 번만 띄운다.
import './login-sheet.css';
import { isNativeBuild } from '../platform/api-base.js';
import { googleSignIn } from '../social/google-signin.js';
import { PROVIDER_LABEL, loadProviders, startProviderLogin, googleLogin, linkProvider, linkBonusText, consumeLoginReturn, takeLoginReturn, deleteAccount, failText } from '../net/account-login.js';

// 모듈이 불러와지는 즉시(부팅 코드보다 먼저) 콜백 쿼리를 읽고 주소에서 지운다. ticket 이 주소창에 남지 않게 한다.
const loginReturn = takeLoginReturn();

const SEEN_KEY = 'blade.login.sheetSeen';
const seen = () => { try { return globalThis.localStorage?.getItem(SEEN_KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { globalThis.localStorage?.setItem(SEEN_KEY, '1'); } catch {} };

function node(tag, className, text, attrs) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
const button = (label, className, onClick) => { const b = node('button', 'ls-btn ' + className, label, { type: 'button' }); b.addEventListener('click', onClick); return b; };

/** 공용 대화상자 틀. close() 로 닫는다. */
function dialog(title, label) {
  const overlay = node('div', 'ls-overlay');
  const box = node('div', 'ls-box', null, { role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title });
  box.append(node('h2', 'ls-title', title));
  const body = node('div', 'ls-body');
  box.append(body);
  overlay.append(box);
  document.body.append(overlay);
  let done;
  const closed = new Promise((resolve) => { done = resolve; });
  return { overlay, box, body, closed, close: () => { overlay.remove(); done(); } };
}

/** 예/아니오 확인. */
export function askConfirm(message, yes = '네', no = '아니요') {
  return new Promise((resolve) => {
    const d = dialog('확인');
    const done = (v) => { d.close(); resolve(v); };
    d.body.append(node('p', 'ls-note', message), button(yes, 'ls-primary', () => done(true)), button(no, 'ls-ghost', () => done(false)));
  });
}

const toastOf = (app) => (message) => { try { app.ui.toast(message); } catch {} };

/** 첫 실행(로컬 저장 없음·등록 표시 없음)이면 로그인 시트를 한 번 띄운다. 띄울 제공자가 없으면 아무 것도 하지 않는다(= 게스트). */
export async function maybeShowLoginSheet(app, { native = isNativeBuild() } = {}) {
  const state = app.account;
  if (!state?.client || seen() || app.eco?.hasStoredSave || state.status === 'ready' || state.status === 'connecting') return null;
  if (state.status !== 'deferred') return null;
  const found = await loadProviders(state.client, { native });
  if (!found || !(found.google || found.kakao || found.chatgpt)) return null;
  markSeen();
  const toast = toastOf(app);
  const d = dialog('블레이드 서지', '로그인');
  d.body.append(node('p', 'ls-note', '계정으로 시작하면 다른 기기에서도 진행을 이어갈 수 있어요.'));
  const busy = (on) => d.box.classList.toggle('busy', on);
  const run = async (task) => {
    busy(true);
    const out = await task().catch(() => ({ ok: false, reason: 'error' }));
    busy(false);
    if (out.ok) { if (out.action) toast(out.action === 'recovered' ? '진행을 불러왔어요.' : '계정을 연동했어요.'); if (out.bonus) toast(linkBonusText(out.bonus)); d.close(); }
    else if (out.reason !== 'cancel' && out.reason !== 'linked-elsewhere-declined') toast(failText(out.reason));
  };
  if (found.google) d.body.append(button('Google로 계속', 'ls-google', () => run(() => googleLogin(app, { signIn: googleSignIn, confirm: askConfirm }))));
  if (found.kakao) d.body.append(button('카카오로 계속', 'ls-kakao', () => run(() => startProviderLogin(app, 'kakao'))));
  if (found.chatgpt) d.body.append(button('ChatGPT로 계속', 'ls-chatgpt', () => run(() => startProviderLogin(app, 'chatgpt'))));
  d.body.append(button('게스트로 시작', 'ls-ghost', () => d.close()));
  return d;
}

/** 계정 메뉴. 연동 상태, 연동 시작, 회원 탈퇴(2단계 확인). */
export async function openAccountMenu(app, { native = isNativeBuild() } = {}) {
  const state = app.account;
  const toast = toastOf(app);
  const d = dialog('계정', '계정 메뉴');
  const render = async () => {
    d.body.replaceChildren();
    if (!state?.client || state.status === 'unavailable' || state.status === 'disabled') { d.body.append(node('p', 'ls-note', '지금은 계정 기능을 쓸 수 없어요.')); d.body.append(button('닫기', 'ls-ghost', d.close)); return; }
    let linked = [];
    if (state.status === 'ready') { try { linked = (await state.client.me()).linked || []; } catch { /* 상태 조회 실패는 빈 목록 */ } }
    const found = await loadProviders(state.client, { native });
    const guest = linked.length === 0;
    d.body.append(node('p', 'ls-status', state.status === 'ready' ? (guest ? '게스트 계정' : '연동된 계정: ' + linked.map((p) => PROVIDER_LABEL[p] || p).join(', ')) : '아직 서버에 연결되지 않은 게스트예요.'));
    if (guest) d.body.append(node('p', 'ls-note', '계정을 연동하면 다른 기기에서도 진행을 이어갈 수 있어요.'));
    for (const p of ['google', 'kakao', 'chatgpt']) {
      if (!found?.[p] || linked.includes(p)) continue;
      d.body.append(button(`${PROVIDER_LABEL[p]} 계정 연동`, 'ls-primary', async () => {
        const out = await linkProvider(app, p, { signIn: googleSignIn, confirm: askConfirm });
        if (out.ok && out.action) { toast('계정을 연동했어요.'); if (out.bonus) toast(linkBonusText(out.bonus)); render(); }
        else if (!out.ok && out.reason !== 'cancel' && out.reason !== 'linked-elsewhere-declined') toast(failText(out.reason));
        else if (out.action === 'recovered') render();
      }));
    }
    if (state.status === 'ready') {
      const danger = node('div', 'ls-danger');
      const ask = button('회원 탈퇴', 'ls-danger-btn', () => {
        danger.replaceChildren(
          node('p', 'ls-note', '서버에 저장된 계정과 진행이 삭제돼요. 되돌릴 수 없어요. 정말 탈퇴할까요?'),
          button('네, 탈퇴합니다', 'ls-danger-btn', async () => {
            const out = await deleteAccount(app);
            if (out.ok) { toast('탈퇴했어요. 새로 시작합니다.'); d.close(); }
            else toast(out.deleted ? '탈퇴는 됐지만 이 기기 초기화에 실패했어요. 설정에서 완전 초기화를 해 주세요.' : failText(out.reason));
          }),
          button('취소', 'ls-ghost', () => render()),
        );
      });
      danger.append(ask);
      d.body.append(danger);
    }
    d.body.append(button('닫기', 'ls-ghost', d.close));
  };
  await render();
  return d;
}

/** 설정의 '계정 · 데이터' 탭에 계정 메뉴 진입점을 붙인다(설정 DOM 은 열릴 때마다 새로 만들어진다). */
export function installAccountEntry(app) {
  const attach = () => {
    const panel = document.getElementById('setting-panel-account');
    if (!panel || panel.querySelector('#ls-account-entry')) return;
    const row = node('div', 'setting-row', null, { id: 'ls-account-entry' });
    row.append(button('계정 · 로그인 연동', 'ls-entry', () => { void openAccountMenu(app); }));
    panel.prepend(row);
  };
  try { new MutationObserver(attach).observe(document.body, { childList: true, subtree: true }); } catch { /* 관찰 불가면 진입점만 없다 */ }
}

/** main.js 부트에서 한 번: 콜백 복귀 처리 → 첫 로그인 시트 → 설정 진입점. 어떤 실패도 게임을 막지 않는다. */
export async function setupLogin(app) {
  installAccountEntry(app);
  const back = await consumeLoginReturn(app, loginReturn, { toast: toastOf(app), confirm: askConfirm }).catch(() => ({ handled: false }));
  // 시트가 뜨면 닫힐 때까지 기다린다(시작 영웅 선택보다 먼저: 다른 기기의 진행을 불러올 사람이 새 영웅부터 고르지 않게).
  if (!back.handled) await (await maybeShowLoginSheet(app).catch(() => null))?.closed;
}
