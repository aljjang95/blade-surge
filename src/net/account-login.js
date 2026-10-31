// 계정 로그인 흐름(화면 없는 로직). 시트·계정 메뉴가 부르고, 테스트는 fetch 목으로 이 계약을 직접 검증한다.
// - 구글: id_token 경로(recover → 연동 없음이면 게스트 세션 후 link). 카카오/ChatGPT: 서버 OAuth 로 이동(location.assign).
// - 콜백 복귀 쿼리: /?login=<provider>&result=<ok|cancel|expired|error|unavailable|rate>&mode=<link|recover>[&ticket=<43자>]
//   콜백은 연동·복구를 하지 않는다(CSRF 방지). result=ok 의 ticket 을 POST /auth/oauth/finish 로 확정한다.
import { clearRegisteredMark } from './account.js';
import { resetAccountFromScratch, hasPendingPayment, PAYMENT_PENDING_MESSAGE } from '../game/account-reset.js';

export const PROVIDER_LABEL = { google: 'Google', kakao: '카카오', chatgpt: 'ChatGPT' };
const RESULT_TEXT = {
  cancel: '로그인을 취소했어요.',
  error: '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.',
  unavailable: '지금은 이 로그인을 쓸 수 없어요.',
  rate: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
};

/** 로그인 가능한 제공자 목록. V1 꺼짐(503)·네트워크 실패는 모두 null(= 시트 없이 기존대로 게스트). */
export async function loadProviders(client, { native = false } = {}) {
  let found;
  try { found = await client.providers(); } catch { return null; }
  const out = {
    google: !!found?.google && !native, // 네이티브 WebView 에서는 구글 웹 로그인을 끈다
    kakao: !!found?.kakao && !native,
    chatgpt: !!found?.chatgpt,
  };
  return out;
}

/** OAuth 시작: 서버가 준 url 로 이동한다. link 는 게스트 서버 행이 먼저 있어야 한다. */
export async function startOAuth(app, provider, mode, { assign = (url) => globalThis.location.assign(url) } = {}) {
  const state = app.account;
  if (!state?.client) return { ok: false, reason: 'unavailable' };
  try {
    if (mode === 'link' && !(await state.ensure())) return { ok: false, reason: 'unavailable' };
    const { url } = await state.client.oauthStart(provider, mode);
    if (typeof url !== 'string' || !url) return { ok: false, reason: 'error' };
    assign(url);
    return { ok: true, url };
  } catch (error) {
    return { ok: false, reason: error?.status === 429 ? 'rate' : error?.status === 503 ? 'unavailable' : 'error' };
  }
}

/**
 * 로그인 연동 보상(계정당 1회, 무료 보석 300). 연동 직후(link 성공)에만 부른다. 복구·기존 계정 로그인 흐름에서는 부르지 않는다.
 * 일반 명령 경로(Economy 메서드 → 명령 큐 → 서버 /cmd)로 보내고, 서버가 받아들였을 때만 보석 수를 돌려준다(아니면 0).
 * 서버가 거절하면(422 claimed·403 not-linked) 명령 큐가 서버 문서로 되돌린다.
 */
export async function claimLinkBonus(app) {
  const eco = app?.eco, queue = app?.account?.queue;
  if (!eco?.claimLinkBonus || !queue) return 0;
  try {
    const r = eco.claimLinkBonus();
    if (!r?.ok) return 0;
    const res = await queue.settled(queue.lastCid);
    return res?.ok === true ? r.gems : 0;
  } catch { return 0; }
}
export const linkBonusText = (gems) => `로그인 연동 보상: 보석 ${gems}`;

/** 구글: 기존 진행 복원을 먼저 시도한다. 연동이 없으면(404 no-link) 게스트 세션을 만들고 바로 연동한다. */
export async function googleLogin(app, { signIn, confirm } = {}) {
  const state = app.account;
  if (!state?.client) return { ok: false, reason: 'unavailable' };
  const idToken = await signIn();
  if (!idToken) return { ok: false, reason: 'cancel' };
  try {
    await state.client.recover('google', idToken);
    await state.refreshFromServer();
    return { ok: true, action: 'recovered' };
  } catch (error) {
    if (error?.status !== 404) return { ok: false, reason: error?.status === 429 ? 'rate' : 'error' };
  }
  return googleLinkWith(app, idToken, { confirm });
}

/** 구글 연동(세션 필요). 409 linked-elsewhere 면 확인 뒤 같은 토큰으로 recover. */
export async function googleLinkWith(app, idToken, { confirm } = {}) {
  const state = app.account;
  if (!(await state.ensure())) return { ok: false, reason: 'unavailable' };
  try {
    await state.client.link('google', idToken);
    return { ok: true, action: 'linked', bonus: await claimLinkBonus(app) };
  } catch (error) {
    if (error?.status === 409) {
      const yes = confirm ? await confirm('이미 다른 진행에 연결된 계정입니다. 그 진행으로 바꿀까요?') : false;
      if (!yes) return { ok: false, reason: 'linked-elsewhere-declined' };
      try {
        await state.client.recover('google', idToken);
        await state.refreshFromServer();
        return { ok: true, action: 'recovered' };
      } catch { return { ok: false, reason: 'error' }; }
    }
    return { ok: false, reason: error?.status === 429 ? 'rate' : 'error' };
  }
}

/** 설정 메뉴의 "연동" 버튼: 구글은 토큰 경로, 나머지는 OAuth link. */
export async function linkProvider(app, provider, { signIn, confirm, assign } = {}) {
  if (provider === 'google') {
    const idToken = await signIn();
    if (!idToken) return { ok: false, reason: 'cancel' };
    return googleLinkWith(app, idToken, { confirm });
  }
  return startOAuth(app, provider, 'link', { assign });
}

/**
 * 부팅 직후 가장 먼저: 콜백 복귀 쿼리를 읽어 두고 곧바로 history.replaceState 로 지운다(ticket 이 주소창·기록에 남지 않게).
 * 반환: null(복귀 아님) 또는 { provider, result, mode, ticket }.
 */
export function takeLoginReturn({ location = globalThis.location, history = globalThis.history } = {}) {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return null; }
  const provider = params.get('login'), hasTicket = params.has('ticket');
  if (!provider && !hasTicket) return null;
  const out = { provider: provider || '', result: params.get('result') || 'error', mode: params.get('mode') || 'link', ticket: params.get('ticket') || '' };
  try {
    for (const key of ['login', 'result', 'mode', 'ticket']) params.delete(key);
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + (location.hash || ''));
  } catch { /* 주소 정리 실패는 무시 */ }
  return provider ? out : null;
}

const FINISH_ERROR = {
  'ticket-expired': '로그인 시간이 지났어요. 다시 시도해 주세요.',
  'already-linked': '이미 연동된 계정이에요.',
  'ticket-mismatch': '로그인 정보가 맞지 않아요. 처음부터 다시 시도해 주세요.',
  banned: '이 계정은 사용할 수 없어요.',
  deleted: '탈퇴한 계정이에요.',
  'key-in-use': '이 기기는 지금 다른 진행에서 쓰고 있어 복구할 수 없어요.',
};
const errCode = (error) => String(error?.body?.error || '');

/**
 * 콜백 복귀 처리(takeLoginReturn 결과). result=ok 이면 ticket 을 oauth/finish 로 확정한다.
 * 반환: { handled, result, mode, ... }
 */
/** @param {any} app @param {any} ret @param {any} [opts] */
export async function consumeLoginReturn(app, ret, { toast = (/** @type {string} */ _m) => {}, confirm = undefined, assign = undefined } = {}) {
  if (!ret?.provider) return { handled: false };
  const { provider, result, mode, ticket } = ret;
  const label = PROVIDER_LABEL[provider] || provider;
  if (result !== 'ok') { toast(RESULT_TEXT[result] || (result === 'expired' ? FINISH_ERROR['ticket-expired'] : RESULT_TEXT.error)); return { handled: true, result, mode }; }
  const state = app.account;
  if (!ticket || !state?.client) { toast(RESULT_TEXT.error); return { handled: true, result: 'error', mode }; }
  try {
    if (mode === 'recover') {
      await state.client.oauthFinish(ticket, 'recover');
      await state.refreshFromServer?.();
      toast(`${label} 계정의 진행을 불러왔어요.`);
      return { handled: true, result, mode, action: 'recovered' };
    }
    if (!(await state.ensure())) { toast(RESULT_TEXT.unavailable); return { handled: true, result: 'unavailable', mode }; }
    await state.client.oauthFinish(ticket, 'link');
    toast(`${label} 계정을 연동했어요. 다른 기기에서도 이어서 할 수 있어요.`);
    const bonus = await claimLinkBonus(app);
    if (bonus) toast(linkBonusText(bonus));
    return { handled: true, result, mode, action: 'linked', bonus };
  } catch (error) {
    const code = errCode(error);
    if (code === 'no-link' && mode === 'recover') {
      // 연동 없음: 게스트 세션을 만들고 같은 제공자 link 를 자동 시작한다.
      toast(`${label}에 연결된 진행이 없어 새로 연동할게요.`);
      const out = await startOAuth(app, provider, 'link', { assign });
      if (!out.ok) toast(failText(out.reason));
      return { handled: true, result: 'no-link', mode, autoLink: out.ok };
    }
    if (code === 'linked-elsewhere') {
      const yes = confirm ? await confirm('이미 다른 진행에 연결된 계정입니다. 그 진행으로 바꿀까요?') : false;
      if (yes) {
        const out = await startOAuth(app, provider, 'recover', { assign });
        if (!out.ok) toast(failText(out.reason));
      }
      return { handled: true, result: 'linked-elsewhere', mode };
    }
    toast(error?.status === 429 ? RESULT_TEXT.rate : FINISH_ERROR[code] || RESULT_TEXT.error);
    return { handled: true, result: 'error', mode, code };
  }
}

/** 첫 로그인 시트에서 카카오/ChatGPT 선택: recover 로 시작(서버가 연동 없음이면 result=no-link 로 돌려준다). */
export const startProviderLogin = (app, provider, opts) => startOAuth(app, provider, 'recover', opts);

export const BILLING_PENDING_TEXT = '결제 처리 중이거나 환불 정산이 남아 있어 지금은 탈퇴할 수 없어요. 고객센터로 문의해 주세요';

/**
 * 회원 탈퇴. 결제 대기가 있으면 서버에 보내기 전에 막고, 서버가 409 billing-pending 을 주면 안내한다.
 * 성공하면 같은 기기 키가 서버에서 영구히 막히므로 로컬 진행·기기 키를 모두 지우고(resetAccountFromScratch keepIdentity:false) 새 키로 시작하게 한다.
 * @returns {Promise<{ ok: boolean, reason?: string, reloaded?: boolean }>}
 */
/** @param {any} app @param {{ reset?: any, pending?: any, storage?: any, reload?: any }} [deps] */
export async function deleteAccount(app, { reset = resetAccountFromScratch, pending = hasPendingPayment, storage = globalThis.localStorage, reload = () => globalThis.location?.reload() } = {}) {
  const state = app.account;
  if (!state?.client) return { ok: false, reason: 'unavailable' };
  if (pending(storage)) return { ok: false, reason: 'payment' };
  try { await state.client.deleteAccount(); }
  catch (error) {
    if (errCode(error) === 'billing-pending') return { ok: false, reason: 'billing-pending' };
    return { ok: false, reason: error?.status === 429 ? 'rate' : 'error' };
  }
  clearRegisteredMark();
  try { storage?.removeItem?.('blade.login.sheetSeen'); } catch { /* 무시 */ }
  state.status = 'deleted'; state.authority = 'off'; state.accountId = null;
  state.client.token = null; state.client.account = null;
  const out = await reset({ keepIdentity: false }).catch(() => ({ ok: false, reason: 'storage' }));
  if (!out.ok) return { ok: false, reason: 'reset-' + out.reason, deleted: true };
  try { reload(); } catch { /* 새로고침 불가 환경 */ }
  return { ok: true, reloaded: true };
}

export const failText = (reason) => (reason === 'billing-pending' ? BILLING_PENDING_TEXT : reason === 'payment' ? PAYMENT_PENDING_MESSAGE : RESULT_TEXT[reason] || RESULT_TEXT.error);
