// 계정 로그인 흐름(화면 없는 로직). 시트·계정 메뉴가 부르고, 테스트는 fetch 목으로 이 계약을 직접 검증한다.
// - 구글: id_token 경로(recover → 연동 없음이면 게스트 세션 후 link). 카카오/ChatGPT: 서버 OAuth 로 이동(location.assign).
// - 콜백 복귀 쿼리: /?login=<provider>&result=<ok|linked-elsewhere|cancel|error|unavailable|no-link|rate>&mode=<link|recover>
import { clearRegisteredMark } from './account.js';

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
    return { ok: true, action: 'linked' };
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
 * 부팅 시 콜백 복귀 쿼리를 처리한다. 쿼리는 항상 history.replaceState 로 지운다.
 * 반환: { handled, message, nextOAuth?: {provider, mode} }
 */
/** @param {any} app @param {any} [opts] */
export async function consumeLoginReturn(app, { location = globalThis.location, history = globalThis.history, toast = (/** @type {string} */ _m) => {}, confirm, assign } = {}) {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return { handled: false }; }
  const provider = params.get('login');
  if (!provider) return { handled: false };
  const result = params.get('result') || 'error', mode = params.get('mode') || 'link';
  try {
    for (const key of ['login', 'result', 'mode']) params.delete(key);
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + (location.hash || ''));
  } catch { /* 주소 정리 실패는 무시 */ }
  const label = PROVIDER_LABEL[provider] || provider;
  if (result === 'ok') {
    if (mode === 'recover') {
      await app.account?.refreshFromServer?.().catch(() => {});
      toast(`${label} 계정의 진행을 불러왔어요.`);
    } else toast(`${label} 계정을 연동했어요. 다른 기기에서도 이어서 할 수 있어요.`);
    return { handled: true, result, mode };
  }
  if (result === 'no-link') {
    // 연동 없음: 게스트 세션을 만들고 같은 제공자 link 를 자동 시작한다.
    toast(`${label}에 연결된 진행이 없어 새로 연동할게요.`);
    const out = await startOAuth(app, provider, 'link', { assign });
    if (!out.ok) toast(RESULT_TEXT[out.reason] || RESULT_TEXT.error);
    return { handled: true, result, mode, autoLink: out.ok };
  }
  if (result === 'linked-elsewhere') {
    const yes = confirm ? await confirm('이미 다른 진행에 연결된 계정입니다. 그 진행으로 바꿀까요?') : false;
    if (yes) {
      const out = await startOAuth(app, provider, 'recover', { assign });
      if (!out.ok) toast(RESULT_TEXT[out.reason] || RESULT_TEXT.error);
    }
    return { handled: true, result, mode };
  }
  toast(RESULT_TEXT[result] || RESULT_TEXT.error);
  return { handled: true, result, mode };
}

/** 첫 로그인 시트에서 카카오/ChatGPT 선택: recover 로 시작(서버가 연동 없음이면 result=no-link 로 돌려준다). */
export const startProviderLogin = (app, provider, opts) => startOAuth(app, provider, 'recover', opts);

/** 회원 탈퇴. 성공하면 로컬 등록 표시를 지운다(로컬 저장은 그대로). */
export async function deleteAccount(app) {
  const state = app.account;
  if (!state?.client) return { ok: false, reason: 'unavailable' };
  try {
    await state.client.deleteAccount();
    clearRegisteredMark();
    state.status = 'deleted'; state.authority = 'off'; state.accountId = null;
    state.client.token = null; state.client.account = null;
    return { ok: true };
  } catch (error) { return { ok: false, reason: error?.status === 429 ? 'rate' : 'error' }; }
}

export const failText = (reason) => RESULT_TEXT[reason] || RESULT_TEXT.error;
