import { afterEach, expect, test } from 'bun:test';
import { filmFrame, playExpeditionIntro } from '../src/expansion/cinematic.js';

test('세로 화면은 90도 돌려 가로 프레임으로 채우고, 가로 화면은 그대로 둔다', () => {
  expect(filmFrame(390, 844)).toMatchObject({ rotated: true, frameWidth: 844, frameHeight: 390 });
  expect(filmFrame(844, 390)).toMatchObject({ rotated: false, frameWidth: 844, frameHeight: 390 });
  expect(filmFrame(1280, 720).rotated).toBe(false);
});

test('프레임 비율이 영상(16:9)에 가까울 때만 cover, 길쭉한 폰 화면은 contain', () => {
  expect(filmFrame(1280, 720).cover).toBe(true);
  expect(filmFrame(1024, 600).cover).toBe(true); // 1.71
  expect(filmFrame(844, 390).cover).toBe(false); // 2.16
  expect(filmFrame(720, 1560).cover).toBe(false); // 세로 20:9도 회전 뒤 같은 프레임
  expect(filmFrame(0, 0)).toMatchObject({ rotated: false, cover: true });
});

// 최소 가짜 DOM: 영상 오버레이의 클래스·크기·잠금·이벤트 정리만 본다.
const keys = ['document', 'window'] as const;
const saved = keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
afterEach(() => {
  for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else Reflect.deleteProperty(globalThis, k); }
});

function setup(width: number, height: number, lock?: (mode: string) => unknown) {
  const listeners = new Map<string, Set<() => void>>();
  const node = (tag: string): any => {
    const classes = new Set<string>(); const el: any = { tag, style: {}, children: [], attrs: {}, listeners: new Map<string, () => void>() };
    el.classList = { toggle: (c: string, on: boolean) => { on ? classes.add(c) : classes.delete(c); }, has: (c: string) => classes.has(c) };
    Object.defineProperty(el, 'className', { set: (v: string) => { for (const c of v.split(' ')) classes.add(c); }, get: () => [...classes].join(' ') });
    el.setAttribute = (k: string, v: string) => { el.attrs[k] = v; };
    el.append = (...kids: any[]) => { el.children.push(...kids); };
    el.addEventListener = (type: string, fn: () => void) => { el.listeners.set(type, fn); };
    el.focus = () => {}; el.pause = () => {}; el.load = () => {}; el.removeAttribute = () => {};
    el.play = () => new Promise(() => {}); el.remove = () => { overlays.length = 0; };
    return el;
  };
  const overlays: any[] = [];
  const events = { add: 0, remove: 0 };
  const doc: any = {
    activeElement: null, getElementById: () => null, addEventListener() {}, removeEventListener() {},
    querySelector: (sel: string) => (sel === '.exp-cinematic' ? overlays[0] ?? null : null),
    createElement: (tag: string) => { const el = node(tag); if (tag === 'section') overlays.push(el); return el; },
    body: { append() {} },
  };
  const win: any = { innerWidth: width, innerHeight: height, screen: { orientation: lock ? { lock } : undefined } };
  win.addEventListener = (type: string, fn: () => void) => { events.add++; (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn); };
  win.removeEventListener = (type: string, fn: () => void) => { events.remove++; listeners.get(type)?.delete(fn); };
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: win });
  return { overlays, win, listeners, events };
}

test('세로 화면에서 영상은 회전 프레임으로 뜨고 가로 잠금을 시도하며 건너뛰기로 끝난다', async () => {
  const modes: string[] = [];
  const { overlays, win, listeners, events } = setup(390, 844, mode => { modes.push(mode); });
  const app: any = { reducedMotion: { matches: false } };
  const played = playExpeditionIntro(app, 'glass_garden', { force: true });
  const overlay = overlays[0];
  expect(overlay.classList.has('is-rotated')).toBe(true);
  expect(overlay.style).toMatchObject({ width: '844px', height: '390px' });
  expect(modes).toEqual(['landscape']);
  // 재생 중 가로로 돌리면 회전을 풀고 크기 지정도 지운다.
  win.innerWidth = 844; win.innerHeight = 390; for (const fn of listeners.get('resize')!) fn();
  expect(overlay.classList.has('is-rotated')).toBe(false);
  expect(overlay.style.width).toBe('');
  const skip = overlay.children.find((c: any) => c.tag === 'button');
  skip.listeners.get('click')!();
  expect(await played).toBe(true);
  expect(listeners.get('resize')!.size).toBe(0);
  expect(events.add).toBe(events.remove);
});

test('방향 잠금이 거절·예외여도 영상은 막히지 않고, 줄이기 모션 설정이면 건너뛴다', async () => {
  for (const lock of [() => Promise.reject(Error('denied')), () => { throw Error('unsupported'); }, undefined]) {
    const { overlays } = setup(390, 844, lock as any);
    const played = playExpeditionIntro({ reducedMotion: { matches: false } } as any, 'glass_garden', { force: true });
    await Promise.resolve();
    overlays[0].children.find((c: any) => c.tag === 'button').listeners.get('click')!();
    expect(await played).toBe(true);
  }
  setup(390, 844);
  expect(await playExpeditionIntro({ reducedMotion: { matches: true } } as any, 'glass_garden')).toBe(false);
});
