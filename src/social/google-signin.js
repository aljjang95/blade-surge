// 구글 계정 연동(선택): Google Identity Services로 ID 토큰 한 장을 받아 커뮤니티 서버에 넘긴다.
// 토큰은 서버가 서명·대상(aud)·발급자·만료를 검사한다. 이 파일은 클라이언트 ID(공개 값)만 가진다.
export const GOOGLE_WEB_CLIENT_ID = '898058209232-qr2isup4rafe3fhhgt5e1vvntu267sf3.apps.googleusercontent.com';

let loading = null;

/** Google 스크립트를 필요할 때 한 번만 불러온다. */
function loadGsi() {
  if (globalThis.google && globalThis.google.accounts && globalThis.google.accounts.id) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loading = null; reject(new Error('gsi-load')); };
    document.head.append(script);
  });
  return loading;
}

/** 구글 ID 토큰을 받는다. 취소·차단·시간 초과·스크립트 실패는 null을 돌려준다(던지지 않는다). */
export async function googleSignIn() {
  try {
    await loadGsi();
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 60000);
      const done = value => { clearTimeout(timer); resolve(value); };
      globalThis.google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: response => done(response && typeof response.credential === 'string' ? response.credential : null),
      });
      globalThis.google.accounts.id.prompt(notice => {
        if (notice.isNotDisplayed() || notice.isSkippedMoment() || notice.isDismissedMoment()) done(null);
      });
    });
  } catch {
    return null;
  }
}
