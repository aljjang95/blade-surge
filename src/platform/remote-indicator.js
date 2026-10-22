// 스트리밍 자산을 내려받는 동안 화면 가장자리에 띄우는 작은 비차단 표시. 입력을 받지 않고(pointer-events: none) 플레이 영역을 가리지 않는다.
// 아주 짧은 내려받기는 깜빡임을 피하려고 SHOW_DELAY_MS 이후에만 보이고, 끝난 뒤 HIDE_DELAY_MS 동안 남았다가 사라진다.
import './remote-indicator.css';

export const SHOW_DELAY_MS = 450;
export const HIDE_DELAY_MS = 900;

const mb = (bytes) => (bytes / 1e6).toFixed(1);

/** @param {{subscribe(listener: (state: any) => void): () => void}} assets */
export function mountRemoteIndicator(assets, doc = globalThis.document, inBattle = () => !!doc?.defaultView?.app?.battle?.active) {
  if (!doc?.body) return () => {};
  const root = doc.createElement('div');
  root.className = 'remote-dl'; root.hidden = true; root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite');
  root.innerHTML = '<span class="remote-dl-bar"><i></i></span><span class="remote-dl-text"></span>';
  doc.body.append(root);
  const fill = root.querySelector('i'), text = root.querySelector('.remote-dl-text');
  let showTimer = 0, hideTimer = 0, pollTimer = 0, visible = false, last = null;
  // 전투 중에는 위쪽 중앙의 WAVE 표시와 겹칠 수 있으므로 띠를 숨긴다(내려받기는 계속되고 전투가 끝나면 다시 보인다).
  const syncBattle = () => { let hide = false; try { hide = !!inBattle(); } catch { hide = false; } root.classList.toggle('remote-dl-battle', hide); };
  const render = () => {
    if (!last) return;
    const total = last.doneBytes + last.pendingBytes, ratio = total ? last.doneBytes / total : 1;
    fill.style.transform = `scaleX(${Math.max(0.04, Math.min(1, ratio)).toFixed(3)})`;
    text.textContent = last.active ? `추가 자료 받는 중 · ${mb(last.pendingBytes)}MB` : '추가 자료 준비됨';
  };
  const unsubscribe = assets.subscribe((state) => {
    last = state; render(); syncBattle();
    if (state.active) {
      if (!pollTimer) pollTimer = setInterval(syncBattle, 600);
      clearTimeout(hideTimer); hideTimer = 0;
      if (!visible && !showTimer) showTimer = setTimeout(() => { showTimer = 0; visible = true; root.hidden = false; root.classList.add('on'); }, SHOW_DELAY_MS);
    } else {
      clearTimeout(showTimer); showTimer = 0; clearInterval(pollTimer); pollTimer = 0;
      if (visible && !hideTimer) hideTimer = setTimeout(() => { hideTimer = 0; visible = false; root.classList.remove('on'); root.hidden = true; }, HIDE_DELAY_MS);
    }
  });
  return () => { unsubscribe(); clearTimeout(showTimer); clearTimeout(hideTimer); clearInterval(pollTimer); root.remove(); };
}
