// 스트리밍 자산을 DOM 경계에서 한 번에 해석한다. 이미지·영상·곡의 src, poster, CSS 배경, HTML 문자열 안의 src="…"/url(…) 가 remote 자산을 가리키면
// remote-assets 의 assetUrl(보관본 blob 또는 정식 호스트 주소)로 바꾼다. 수십 개 화면 코드를 하나씩 고치지 않아도 같은 해석기를 지나게 하는 장치이며,
// 스트리밍 채널(googleplay·onestore)에서만 설치된다. remote 가 아닌 주소는 입력을 그대로 돌려준다.

const MEDIA_TAGS = /^(IMG|VIDEO|AUDIO|SOURCE)$/;
// HTML 문자열에서 remote 후보만 건드린다. 빠른 사전 검사 후 src="…"·url(…) 두 모양만 바꾼다.
const QUICK = /\/(?:img|video|bgm|models|assets)\//;
const SRC_ATTR = /(\b(?:src|poster)\s*=\s*)(["'])([^"']+)\2/gi;
const CSS_URL = /url\(\s*(["']?)([^"')\s]+)\1\s*\)/gi;

/** CSS 값 안의 url(…) 만 바꾼다. */
export function rewriteCss(text, resolve) {
  if (typeof text !== 'string' || !QUICK.test(text)) return text;
  return text.replace(CSS_URL, (all, quote, value) => { const next = resolve(value); return next === value ? all : `url(${quote}${next}${quote})`; });
}
export function rewriteMarkup(text, resolve) {
  if (typeof text !== 'string' || !QUICK.test(text)) return text;
  return rewriteCss(text.replace(SRC_ATTR, (all, head, quote, value) => { const next = resolve(value); return next === value ? all : `${head}${quote}${next}${quote}`; }), resolve);
}

/** @param {{assetUrl(input: string): string, enabled: boolean}} assets @returns {() => void} 되돌리기 */
export function installDomResolver(assets, win = globalThis.window) {
  if (!win?.document || !assets.enabled) return () => {};
  const resolve = (value) => (typeof value === 'string' ? assets.assetUrl(value) : value);
  const undo = [];
  const wrapSetter = (proto, prop, transform = resolve) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!descriptor?.set) return;
    Object.defineProperty(proto, prop, { ...descriptor, set(value) { descriptor.set.call(this, transform(value)); } });
    undo.push(() => Object.defineProperty(proto, prop, descriptor));
  };
  wrapSetter(win.HTMLImageElement?.prototype, 'src');
  wrapSetter(win.HTMLMediaElement?.prototype, 'src');
  wrapSetter(win.HTMLSourceElement?.prototype, 'src');
  wrapSetter(win.HTMLVideoElement?.prototype, 'poster');

  const elementProto = win.Element?.prototype;
  if (elementProto) {
    const setAttribute = elementProto.setAttribute;
    elementProto.setAttribute = function (name, value) {
      if ((name === 'src' || name === 'poster') && MEDIA_TAGS.test(this.tagName)) value = resolve(value);
      return setAttribute.call(this, name, value);
    };
    undo.push(() => { elementProto.setAttribute = setAttribute; });
    const html = Object.getOwnPropertyDescriptor(elementProto, 'innerHTML');
    if (html?.set) {
      Object.defineProperty(elementProto, 'innerHTML', { ...html, set(value) { html.set.call(this, rewriteMarkup(value, resolve)); } });
      undo.push(() => Object.defineProperty(elementProto, 'innerHTML', html));
    }
    const adjacent = elementProto.insertAdjacentHTML;
    elementProto.insertAdjacentHTML = function (position, text) { return adjacent.call(this, position, rewriteMarkup(text, resolve)); };
    undo.push(() => { elementProto.insertAdjacentHTML = adjacent; });
  }
  const style = win.CSSStyleDeclaration?.prototype;
  if (style) {
    const css = (value) => rewriteCss(value, resolve);
    for (const prop of ['backgroundImage', 'background']) wrapSetter(style, prop, css);
    const setProperty = style.setProperty;
    style.setProperty = function (name, value, priority) {
      return setProperty.call(this, name, /^(?:background|background-image)$/.test(name) ? css(value) : value, priority);
    };
    undo.push(() => { style.setProperty = setProperty; });
  }
  return () => { for (const fn of undo.reverse()) fn(); };
}
