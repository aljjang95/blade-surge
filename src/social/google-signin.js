// 구글 계정 연동(선택): Google Identity Services의 공식 로그인 버튼(renderButton, popup)으로 ID 토큰 한 장을 받아 커뮤니티 서버에 넘긴다.
// 공식 안내: https://developers.google.com/identity/gsi/web/guides/display-button
// One Tap(prompt)은 쓰지 않는다. 쿨다운·로그아웃 상태에서 막히기 때문이다.
// 토큰은 서버가 서명·대상(aud)·발급자·만료를 검사한다. 이 파일은 클라이언트 ID(공개 값)만 가지며 토큰을 저장·기록하지 않는다.
// 앱(Capacitor) 안의 WebView에서 이 웹 로그인이 되는지는 확인된 바 없다. 되지 않으면 null로 끝난다.
import { button, el } from '../../packages/tll-social/src/ui/dom.js';
import { icon } from '../../packages/tll-social/src/ui/icons.js';

export const GOOGLE_WEB_CLIENT_ID = '898058209232-qr2isup4rafe3fhhgt5e1vvntu267sf3.apps.googleusercontent.com';
const GSI_SRC = 'https://accounts.google.com/gsi/client';
const DEFAULT_LOAD_TIMEOUT_MS = 12000;
const DEFAULT_MAX_WAIT_MS = 120000;

/**
 * 구글 로그인 함수를 만든다. 기본 export(googleSignIn)가 실제 게임이 쓰는 인스턴스다.
 * @param {{ clientId?: string, loadTimeoutMs?: number, maxWaitMs?: number }} [options]
 */
export function createGoogleSignIn(options = {}) {
  const clientId = options.clientId || GOOGLE_WEB_CLIENT_ID;
  const loadTimeoutMs = options.loadTimeoutMs || DEFAULT_LOAD_TIMEOUT_MS;
  const maxWaitMs = options.maxWaitMs || DEFAULT_MAX_WAIT_MS;
  let loading = null;
  let active = null;

  const gsiReady = () => !!(globalThis.google && globalThis.google.accounts && globalThis.google.accounts.id);

  /** Google 스크립트를 필요할 때 한 번만 불러온다. 실패·시간 초과 때는 태그를 치워 다음 시도가 새로 받게 한다. */
  function loadGsi() {
    if (gsiReady()) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let timer = 0;
      const fail = reason => {
        clearTimeout(timer);
        loading = null;
        try { script.remove(); } catch { /* 이미 없음 */ }
        reject(new Error(reason));
      };
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => { clearTimeout(timer); if (gsiReady()) resolve(); else fail('gsi-missing'); };
      script.onerror = () => fail('gsi-load');
      timer = setTimeout(() => fail('gsi-timeout'), loadTimeoutMs);
      document.head.append(script);
    });
    return loading;
  }

  /** 기존 커뮤니티 모달과 같은 모양의 로그인 대화상자. 닫기·바깥 누르기·취소·Esc는 모두 onCancel로 모인다. */
  function buildDialog(onCancel) {
    const overlay = el('div', 'tls-modal');
    const box = el('div', 'tls-modal-box', null, { role: 'dialog', 'aria-modal': 'true', 'aria-label': '구글 로그인', tabindex: -1 });
    const bar = el('div', 'tls-modal-head');
    bar.append(el('span', 'tls-grow', '구글 로그인'));
    const x = button('tls-iconbtn', null, onCancel, { 'aria-label': '닫기' });
    x.append(icon('close', 18));
    bar.append(x);
    const body = el('div', 'tls-modal-body');
    const note = el('p', 'tls-note', '구글 로그인 창을 준비하고 있어요…');
    const slot = el('div', 'tls-google-slot');
    body.append(note, slot);
    const foot = el('div', 'tls-modal-foot');
    foot.append(button('tls-btn tls-btn-navy', '취소', onCancel));
    box.append(bar, body, foot);
    overlay.append(box);
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) onCancel(); });
    return { overlay, box, note, slot };
  }

  function start() {
    const request = { done: false, promise: null, finish: null };
    const cleanups = [];
    request.promise = new Promise(resolve => {
      request.finish = value => {
        if (request.done) return;
        request.done = true;
        if (active === request) active = null;
        while (cleanups.length) { try { cleanups.pop()(); } catch { /* 정리 중 오류는 무시 */ } }
        resolve(value);
      };
    });
    active = request;
    const cancel = () => request.finish(null);

    try {
      const previousFocus = document.activeElement;
      const dialog = buildDialog(cancel);
      const parent = document.querySelector('.tls-root') || document.body;
      parent.append(dialog.overlay);
      cleanups.push(() => dialog.overlay.remove());
      try { dialog.box.focus({ preventScroll: true }); } catch { /* 포커스 불가여도 진행 */ }
      cleanups.push(() => { try { if (previousFocus && previousFocus.focus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true }); } catch { /* 무시 */ } });

      const onKey = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      };
      document.addEventListener('keydown', onKey, true);
      cleanups.push(() => document.removeEventListener('keydown', onKey, true));

      const maxTimer = setTimeout(cancel, maxWaitMs);
      cleanups.push(() => clearTimeout(maxTimer));

      loadGsi().then(() => {
        if (request.done) return;
        const gsi = globalThis.google.accounts.id;
        gsi.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          auto_select: false,
          // 오래된 요청의 늦은 콜백은 지금 요청을 끝내지 못한다.
          callback: response => {
            if (request.done || active !== request) return;
            const credential = response && typeof response.credential === 'string' ? response.credential : '';
            request.finish(credential || null);
          },
        });
        dialog.note.textContent = '아래 버튼으로 구글 계정을 선택해 주세요.';
        gsi.renderButton(dialog.slot, { type: 'standard', theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width: 240, locale: 'ko' });
      }).catch(() => request.finish(null));
    } catch {
      request.finish(null);
    }
    return request.promise;
  }

  /** 구글 ID 토큰을 받는다. 취소·차단·시간 초과·스크립트 실패는 null을 돌려준다(던지지 않는다). 동시에 여러 번 불러도 같은 대화상자 하나를 함께 기다린다. */
  return function googleSignIn() {
    if (active) return active.promise;
    return start();
  };
}

export const googleSignIn = createGoogleSignIn();
