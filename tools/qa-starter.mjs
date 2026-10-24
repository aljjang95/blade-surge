// QA 공용: 빈 저장(정책 2)으로 부팅하면 시작 버튼 뒤에 '시작 영웅 선택' 화면이 먼저 떠서 로비 대기가 멈춘다.
// 이 도우미를 페이지 로드 전에 설치하면 선택 화면이 나타나는 즉시 첫 영웅을 고르고 '이 영웅으로 시작'을 눌러 준다.
// 이미 영웅을 고른 저장·정책 1 저장에서는 화면이 뜨지 않으므로 아무 일도 하지 않는다.
// 사용: await installAutoStarter(context)  // 또는 page. goto 전에 한 번.
export const AUTO_STARTER_SCRIPT = `(() => {
  const tick = () => {
    const root = document.getElementById('starter-select');
    if (!root) return;
    const go = root.querySelector('.ss-go');
    if (go && !go.disabled && !root.classList.contains('leaving')) go.click();
  };
  const start = () => { new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class'] }); tick(); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();`;

/** Playwright context 또는 page. 페이지 이동(goto) 전에 부른다. */
export async function installAutoStarter(target) {
  await target.addInitScript(AUTO_STARTER_SCRIPT);
}
