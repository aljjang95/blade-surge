import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createGoogleSignIn } from '../src/social/google-signin.js';

// 의미 있는 최소 가짜 DOM: 대화상자 생성·제거, 클릭, Esc, 스크립트 로드 성공/실패를 흉내 낸다.
class FakeNode {
  tag: string; className = ''; textContent = ''; children: FakeNode[] = []; parent: FakeNode | null = null;
  attrs: Record<string, string> = {}; listeners: Record<string, Function[]> = {}; src = ''; async = false; hidden = false;
  onload: (() => void) | null = null; onerror: (() => void) | null = null; disabled = false;
  classList = { add: (c: string) => { this.className += ' ' + c; }, remove: (c: string) => { this.className = this.className.split(' ').filter(x => x !== c).join(' '); } };
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...nodes: FakeNode[]) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
  replaceChildren() { this.children = []; }
  addEventListener(type: string, fn: Function) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type: string, fn: Function) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  focus() {}
  fire(type: string, event: any = {}) { for (const fn of [...(this.listeners[type] || [])]) fn({ stopPropagation() {}, preventDefault() {}, target: this, ...event }); }
  find(pred: (n: FakeNode) => boolean): FakeNode[] { return [...(pred(this) ? [this] : []), ...this.children.flatMap(c => c.find(pred))]; }
  contains(n: FakeNode | null): boolean { return !!n && (n === this || this.children.some(c => c.contains(n))); }
}

const saved: Record<string, any> = {};
let body: FakeNode, head: FakeNode, doc: any, scripts: FakeNode[];
let initCalls: any[], renderCalls: any[];

function installDocument() {
  body = new FakeNode('body'); head = new FakeNode('head'); scripts = [];
  const docListeners: Record<string, Function[]> = {};
  doc = {
    body, head, activeElement: null,
    createElement: (tag: string) => { const n = new FakeNode(tag); if (tag === 'script') scripts.push(n); return n; },
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    querySelector: () => null,
    contains: (n: FakeNode) => body.contains(n),
    addEventListener: (t: string, fn: Function) => { (docListeners[t] ||= []).push(fn); },
    removeEventListener: (t: string, fn: Function) => { docListeners[t] = (docListeners[t] || []).filter(f => f !== fn); },
    key: (key: string) => { for (const fn of [...(docListeners.keydown || [])]) fn({ key, preventDefault() {}, stopPropagation() {} }); },
    listenerCount: () => (docListeners.keydown || []).length,
  };
  (globalThis as any).document = doc;
}
function installGsi() {
  initCalls = []; renderCalls = [];
  (globalThis as any).google = { accounts: { id: { initialize: (o: any) => initCalls.push(o), renderButton: (el: FakeNode, o: any) => renderCalls.push({ el, o }) } } };
}
const dialogs = () => body.find(n => n.className === 'tls-modal');
const flush = () => new Promise(r => setTimeout(r, 0));
const sign = (o: any = {}) => createGoogleSignIn({ loadTimeoutMs: 30, maxWaitMs: 200, ...o });

beforeEach(() => { saved.document = (globalThis as any).document; saved.google = (globalThis as any).google; installDocument(); delete (globalThis as any).google; });
afterEach(() => { (globalThis as any).document = saved.document; (globalThis as any).google = saved.google; });

test('성공: 공식 renderButton(ko, popup)을 대화상자에 그리고 credential을 돌려주며 정리한다', async () => {
  installGsi();
  const googleSignIn = sign();
  const pending = googleSignIn();
  await flush();
  expect(dialogs().length).toBe(1);
  expect(initCalls[0]).toMatchObject({ ux_mode: 'popup', auto_select: false });
  expect(renderCalls[0].o.locale).toBe('ko');
  expect(renderCalls[0].el.className).toBe('tls-google-slot');
  expect(dialogs()[0].find(n => n.className === 'tls-modal-box')[0].attrs.role).toBe('dialog');
  initCalls[0].callback({ credential: 'token-1' });
  expect(await pending).toBe('token-1');
  expect(dialogs().length).toBe(0);
  expect(doc.listenerCount()).toBe(0);
});

test('취소·Esc·바깥 누르기는 null이고 다시 시도하면 새 대화상자가 열린다', async () => {
  installGsi();
  const googleSignIn = sign();
  let p = googleSignIn(); await flush();
  body.find(n => n.className === 'tls-btn tls-btn-navy')[0].fire('click');
  expect(await p).toBeNull(); expect(dialogs().length).toBe(0);
  p = googleSignIn(); await flush();
  doc.key('Escape');
  expect(await p).toBeNull(); expect(dialogs().length).toBe(0);
  p = googleSignIn(); await flush();
  const overlay = dialogs()[0]; overlay.fire('pointerdown', { target: overlay });
  expect(await p).toBeNull();
  p = googleSignIn(); await flush();
  expect(dialogs().length).toBe(1);
  initCalls[initCalls.length - 1].callback({ credential: 'retry' });
  expect(await p).toBe('retry');
  expect(doc.listenerCount()).toBe(0);
});

test('동시 호출은 같은 대화상자를 공유하고 오래된 콜백은 다음 요청을 끝내지 못한다', async () => {
  installGsi();
  const googleSignIn = sign();
  const a = googleSignIn(); const b = googleSignIn(); await flush();
  expect(a).toBe(b); expect(dialogs().length).toBe(1);
  const staleCallback = initCalls[0].callback;
  doc.key('Escape'); expect(await a).toBeNull();
  const next = googleSignIn(); await flush();
  staleCallback({ credential: 'stale' });
  expect(dialogs().length).toBe(1);
  initCalls[initCalls.length - 1].callback({ credential: 'fresh' });
  expect(await next).toBe('fresh');
});

test('credential이 없는 응답은 null, 최대 대기 시간이 지나면 정리하고 null', async () => {
  installGsi();
  const googleSignIn = sign({ maxWaitMs: 40 });
  let p = googleSignIn(); await flush();
  initCalls[0].callback({});
  expect(await p).toBeNull(); expect(dialogs().length).toBe(0);
  p = googleSignIn();
  expect(await p).toBeNull(); expect(dialogs().length).toBe(0); expect(doc.listenerCount()).toBe(0);
});

test('스크립트 로드 실패·시간 초과는 null이며 태그를 지우고 다음 시도가 새로 받는다', async () => {
  const googleSignIn = sign();
  let p = googleSignIn(); await flush();
  expect(scripts.length).toBe(1); expect(dialogs().length).toBe(1);
  scripts[0].onerror!();
  expect(await p).toBeNull(); expect(dialogs().length).toBe(0); expect(head.children.length).toBe(0);
  p = googleSignIn(); await flush();
  expect(scripts.length).toBe(2);
  expect(await p).toBeNull(); // 로드 시간 초과(30ms)
  expect(head.children.length).toBe(0); expect(dialogs().length).toBe(0);
  p = googleSignIn(); await flush();
  expect(scripts.length).toBe(3);
  installGsi(); scripts[2].onload!(); await flush();
  expect(renderCalls.length).toBe(1);
  initCalls[0].callback({ credential: 'after-load' });
  expect(await p).toBe('after-load');
});
