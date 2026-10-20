// 아주 작은 DOM 도우미. 사용자 문자열은 항상 textContent로만 넣는다(innerHTML 금지).

/**
 * @param {string} tag
 * @param {string} [cls]
 * @param {string | number | null} [text]
 * @param {Record<string, string | number | boolean>} [attrs]
 */
export function el(tag, cls, text, attrs) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v === false || v === null || v === undefined) continue; node.setAttribute(k, v === true ? '' : String(v)); }
  return node;
}
export function clear(node) { node.replaceChildren(); return node; }
export function show(node, visible) { node.hidden = !visible; return node; }

/** 버튼: 눌렀을 때 중복 실행을 막고 싶으면 handler가 Promise를 돌려주면 끝날 때까지 잠근다. */
export function button(cls, label, handler, attrs) {
  const node = el('button', cls, label, { type: 'button', ...attrs });
  if (handler) {
    node.addEventListener('click', event => {
      event.stopPropagation();
      if (node.disabled) return;
      let result;
      try { result = handler(event, node); } catch (error) { reportError(error); return; }
      if (result && typeof result.then === 'function') {
        node.disabled = true;
        node.classList.add('tls-busy');
        result.catch(reportError).finally(() => { node.disabled = false; node.classList.remove('tls-busy'); });
      }
    });
  }
  return node;
}
export function reportError(error) {
  // 화면 갱신 오류가 게임을 멈추지 않게 한 줄만 남긴다.
  if (typeof console !== 'undefined' && console.warn) console.warn('[tll-social/ui]', error && error.message ? error.message : error);
}

/** 여러 해제 함수를 한 번에 정리하는 묶음. */
export function disposer() {
  const list = [];
  return {
    add(fn) { list.push(fn); return fn; },
    listen(target, type, fn, options) { target.addEventListener(type, fn, options); list.push(() => target.removeEventListener(type, fn, options)); },
    run() { while (list.length) { const fn = list.pop(); try { fn(); } catch (error) { reportError(error); } } },
  };
}

/** 한 프레임에 한 번만 실행(상태 이벤트가 몰릴 때 화면을 한 번만 다시 그린다). */
export function rafOnce(fn) {
  let pending = false;
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(cb, 16);
  return function scheduled() {
    if (pending) return;
    pending = true;
    raf(() => { pending = false; try { fn(); } catch (error) { reportError(error); } });
  };
}

export async function copyText(text, root) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 아래 대체 경로 */ }
  try {
    const area = el('textarea', 'tls-offscreen', '', { 'aria-hidden': true });
    area.value = text;
    (root || document.body).append(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    return !!ok;
  } catch { return false; }
}
