// 터치 UI 에는 키보드 단축키 표시(U/I/O · R · 1/2/3 · F)를 그리지 않는다. 키보드를 쓰는 동안만 보인다.
// html[data-input="touch" | "keyboard"] 하나로 표시를 정하고, 마지막으로 쓴 입력 방식을 따라 바뀐다(터치 노트북·태블릿 키보드 겸용).

/** 입력 이벤트가 말하는 입력 방식. 관계없는 이벤트는 null. */
export function inputModalityOf(event) {
  if (!event) return null;
  if (event.type === 'keydown') return event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta' ? null : 'keyboard';
  if (event.type === 'touchstart') return 'touch';
  if (event.type === 'pointerdown') return event.pointerType === 'touch' || event.pointerType === 'pen' ? 'touch' : 'mouse';
  return null;
}

/** 처음 입력 방식: 거친 포인터(손가락)가 주 입력이면 touch, 아니면 keyboard. */
export function initialInputModality(win = globalThis) {
  try { return win.matchMedia?.('(pointer: coarse)')?.matches ? 'touch' : 'keyboard'; } catch { return 'keyboard'; }
}

let installed = false;
export function installInputModality(root = document.documentElement, win = window) {
  if (installed || !root) return;
  installed = true;
  const set = value => { if (root.dataset.input !== value) root.dataset.input = value; };
  set(initialInputModality(win));
  const onEvent = event => {
    const modality = inputModalityOf(event);
    // 마우스는 키보드 기기(PC)의 신호로 본다. 터치·펜만 touch.
    if (modality === 'mouse') set('keyboard'); else if (modality) set(modality);
  };
  for (const type of ['keydown', 'touchstart', 'pointerdown']) win.addEventListener(type, onEvent, { capture: true, passive: true });
}
