// 다른 손가락(조이스틱·빈 화면 시점)을 누른 채 버튼을 탭하면 그 터치는 보조(non-primary) 포인터다.
// 브라우저(Chrome·Samsung Internet 등 Blink)는 보조 터치에서 호환 click을 만들지 않으므로 click만 듣는 버튼이 반응하지 않는다.
// 이 helper는 보조 터치의 실제 탭(같은 버튼 안에서 떼고 거의 움직이지 않음)을 그 버튼의 click으로 활성화한다.
// 주 터치·마우스·키보드는 원래 click 경로를 그대로 쓰고, 브라우저가 보조 터치에도 click을 보내면 한 번만 처리한다.

export const SECONDARY_TAP_SLOP = 12;
const NATIVE_CLICK_WINDOW_MS = 600;

/**
 * @param {HTMLElement | null | undefined} el
 * @param {{ now?: () => number }} [options]
 * @returns {() => void} 해제 함수
 */
export function bindSecondaryTouchActivation(el, { now = () => performance.now() } = {}) {
  if (!el) return () => {};
  // suppressed: 이미 활성화한 보조 터치의 pointerId. 같은 포인터가 만든 브라우저 click만 한 번 막는다.
  let pointer = null, suppressed = null;
  const down = event => {
    if (event.pointerType !== 'touch' || event.isPrimary || pointer) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  // 한 번이라도 문턱 밖으로 끌면 되돌아와도 탭이 아니다.
  const move = event => {
    if (!pointer || event.pointerId !== pointer.id || pointer.moved) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > SECONDARY_TAP_SLOP) pointer.moved = true;
  };
  const up = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const start = pointer; pointer = null;
    if (start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) > SECONDARY_TAP_SLOP) return;
    const rect = el.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    if (el.disabled || el.hidden) return;
    suppressed = { id: start.id, until: now() + NATIVE_CLICK_WINDOW_MS };
    el.click();
  };
  const cancel = event => { if (pointer && event.pointerId === pointer.id) pointer = null; };
  // 이미 활성화한 보조 탭과 같은 포인터의 브라우저 click이 뒤따르면 두 번 토글하지 않게 그 한 번만 막는다.
  // 키보드(Enter/Space)·새 주 터치·마우스 click은 pointerId가 달라 그대로 처리한다.
  const click = event => {
    if (!event.isTrusted || !suppressed) return;
    if (now() >= suppressed.until) { suppressed = null; return; }
    if (event.pointerType !== 'touch' || event.pointerId !== suppressed.id) return;
    suppressed = null;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', click, true);
  return () => {
    el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel); el.removeEventListener('click', click, true);
  };
}
