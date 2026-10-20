// 전투 핵심 버튼의 실제 터치 탭 활성화.
// 조이스틱·빈 화면 시점 손가락을 누른 채 탭하면 그 터치는 보조(non-primary) 포인터라 Blink(Chrome·Samsung Internet)는 호환 click을 만들지 않는다.
// 멀티터치 직후 첫 주 터치 탭도 click 없이 pointerdown/up만 오는 경우가 있다(root PC 이벤트 추적: 재개 버튼).
// 그래서 click만 듣는 버튼은 터치 탭(같은 버튼 안에서 떼고, 문턱을 한 번도 넘지 않음)을 pointerup에서 그 버튼의 click으로 활성화한다.
// 브라우저가 같은 포인터의 click을 뒤이어 보내면 한 번만 처리한다. 마우스·키보드·다른 포인터 click은 원래 경로 그대로다.

export const TOUCH_TAP_SLOP = 12;
const NATIVE_CLICK_WINDOW_MS = 600;

/**
 * @param {HTMLElement | null | undefined} el
 * @param {{ now?: () => number }} [options]
 * @returns {() => void} 해제 함수
 */
export function bindTouchActivation(el, { now = () => performance.now() } = {}) {
  if (!el) return () => {};
  // pointers: 진행 중인 터치(버튼 하나에 손가락 여러 개가 닿을 수 있다). activated: 이미 활성화한 포인터와 유효 시각.
  const pointers = new Map(), activated = new Map();
  const down = event => {
    if (event.pointerType !== 'touch') return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false });
  };
  // 한 번이라도 문턱 밖으로 끌면 되돌아와도 탭이 아니다.
  const move = event => {
    const p = pointers.get(event.pointerId);
    if (p && !p.moved && Math.hypot(event.clientX - p.x, event.clientY - p.y) > TOUCH_TAP_SLOP) p.moved = true;
  };
  const up = event => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    pointers.delete(event.pointerId);
    if (p.moved || Math.hypot(event.clientX - p.x, event.clientY - p.y) > TOUCH_TAP_SLOP) return;
    const rect = el.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    if (el.disabled || el.hidden) return;
    const t = now();
    for (const [id, until] of activated) if (until <= t) activated.delete(id);
    activated.set(event.pointerId, t + NATIVE_CLICK_WINDOW_MS);
    el.click();
  };
  const cancel = event => { pointers.delete(event.pointerId); };
  // 활성화한 터치와 같은 포인터의 브라우저 click은 한 번만 막는다. pointerId가 없는 옛 엔진의 터치 click도 같은 창 안이면 중복으로 본다.
  const click = event => {
    if (!event.isTrusted || !activated.size) return;
    const t = now(), legacy = event.pointerId === undefined && event.pointerType === undefined;
    const id = legacy ? [...activated.keys()].at(-1) : event.pointerId;
    if (!legacy && event.pointerType !== 'touch') return;
    const until = activated.get(id);
    if (until === undefined) return;
    activated.delete(id);
    if (t >= until) return;
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
    pointers.clear(); activated.clear();
  };
}

