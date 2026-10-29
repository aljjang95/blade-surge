import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createBodyWipe, BODY_WIPE_SECONDS, BODY_WIPE_HOLD_MAX } from '../src/engine/body-wipe.js';
import { createAvatarPreloader, AVATAR_PRELOAD_LIMIT } from '../src/engine/avatar-preload.js';
import { tryOnShown, wardrobePreloadOrder } from '../src/expansion/wardrobe.jsx';
import { AVATARS } from '../src/data/avatars.js';
import { Economy } from '../src/game/economy.js';
import { Meta } from '../src/ui/meta.js';
import { grandfather } from './helpers/legacy-roster';

const STEP = 1 / 60;
const run = (wipe: any, seconds: number) => {
  const swaps: any[] = []; let peak = 0, frame: any;
  for (let t = 0; t < seconds - 1e-9; t += STEP) { frame = wipe.update(STEP); if (frame.swap) swaps.push(frame.target); peak = Math.max(peak, frame.intensity); }
  return { swaps, peak, frame };
};

// ---------- 전환 상태기계 ----------
test('와이프는 0.3~0.5초 안에 덮기→교체 1회→드러내기를 끝낸다(동기 교체)', () => {
  expect(BODY_WIPE_SECONDS).toBeGreaterThanOrEqual(.3); expect(BODY_WIPE_SECONDS).toBeLessThanOrEqual(.5);
  const wipe = createBodyWipe(); wipe.reset(null);
  expect(wipe.request('avatar_knight_sakura')).toBe(true);
  const swaps: any[] = []; let swapAt = -1, t = 0, frame: any;
  while (wipe.phase !== 'idle' || t === 0) {
    frame = wipe.update(STEP); t += STEP;
    if (frame.swap) { swaps.push(frame.target); swapAt = t; wipe.markReady(); }   // 받아 둔 몸: 같은 프레임에 교체 끝
    expect(frame.intensity).toBeGreaterThanOrEqual(0); expect(frame.intensity).toBeLessThanOrEqual(1);
    if (t > 2) break;
  }
  expect(swaps).toEqual(['avatar_knight_sakura']);
  // 교체는 가장 밝은 순간(전체의 절반)에 일어난다.
  expect(swapAt).toBeGreaterThan(BODY_WIPE_SECONDS * .4); expect(swapAt).toBeLessThan(BODY_WIPE_SECONDS * .6 + STEP * 2);
  expect(t).toBeLessThanOrEqual(BODY_WIPE_SECONDS + STEP * 3);
  expect(frame.intensity).toBe(0);
});

test('같은 모습 요청은 무시하고, 매 프레임 같은 결과 객체를 돌려준다(프레임 할당 없음)', () => {
  const wipe = createBodyWipe(); wipe.reset('a');
  expect(wipe.request('a')).toBe(false);
  const first = wipe.update(STEP), second = wipe.update(STEP);
  expect(first).toBe(second); expect(second.phase).toBe('idle'); expect(second.intensity).toBe(0);
});

test('몸이 아직 받아지지 않으면 가장 밝은 상태로 기다리고, 상한을 넘으면 걷는다', () => {
  const wipe = createBodyWipe(); wipe.reset(null); wipe.request('b');
  const { swaps } = run(wipe, BODY_WIPE_SECONDS / 2 + .3);
  expect(swaps).toEqual(['b']); expect(wipe.phase).toBe('hold');
  expect(wipe.update(STEP).intensity).toBe(1);
  // 몸이 도착하면 드러낸다.
  wipe.markReady(); wipe.update(STEP); expect(wipe.phase).toBe('reveal');
  // 도착하지 않는 경우: 상한 뒤 스스로 걷는다.
  const late = createBodyWipe(); late.reset(null); late.request('c');
  run(late, BODY_WIPE_SECONDS / 2 + BODY_WIPE_HOLD_MAX + .1);
  expect(['reveal', 'idle']).toContain(late.phase);
});

test('덮는 중 목표가 바뀌면 마지막 목표로 한 번만 교체하고, 드러내는 중 바뀌면 다시 덮어 교체한다', () => {
  const wipe = createBodyWipe(); wipe.reset(null); wipe.request('x');
  wipe.update(STEP); wipe.request('y');
  const a = run(wipe, BODY_WIPE_SECONDS / 2); expect(a.swaps).toEqual(['y']);
  wipe.markReady(); wipe.update(STEP); expect(wipe.phase).toBe('reveal');
  // 드러내는 중 벗기(null) — 다시 올라가며 한 번 더 교체.
  expect(wipe.request(null)).toBe(true); expect(wipe.phase).toBe('cover');
  const b = run(wipe, BODY_WIPE_SECONDS); expect(b.swaps).toEqual([null]);
});

test('동작 줄이기(instant)는 밝기 없이 다음 프레임에 교체한다', () => {
  const wipe = createBodyWipe(); wipe.reset(null); wipe.request('z', { instant: true });
  const frame = wipe.update(STEP); expect(frame.swap).toBe(true); expect(frame.intensity).toBe(0);
  wipe.markReady(); wipe.update(STEP); wipe.update(STEP); expect(wipe.phase).toBe('idle');
});

// ---------- 프리로드 캐시 ----------
function fakeBodies(refuse = new Set<string>()) {
  const loaded: string[] = [], released: string[] = [];
  let resolveNext: (() => void) | null = null; const gate = { auto: true };
  const preloader = createAvatarPreloader({
    preload: (id) => { loaded.push(id); return gate.auto ? Promise.resolve(true) : new Promise<void>((r) => { resolveNext = r; }); },
    release: (id) => { if (refuse.has(id)) return false; released.push(id); return true; },
  });
  return { preloader, loaded, released, gate, flush: () => { const r = resolveNext; resolveNext = null; r?.(); } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('영웅 화면 진입 시 그 영웅 아바타 몸을 하나씩 차례로 받는다', async () => {
  const { preloader, loaded, gate, flush } = fakeBodies(); gate.auto = false;
  preloader.focus(['k1', 'k2', 'k3']);
  await tick(); expect(loaded).toEqual(['k1']);   // 동시에 몰아 받지 않는다
  flush(); await tick(); expect(loaded).toEqual(['k1', 'k2']);
  flush(); await tick(); flush(); await tick();
  expect(loaded).toEqual(['k1', 'k2', 'k3']);
  // 이미 받은 몸은 다시 받지 않는다.
  gate.auto = true; preloader.focus(['k1', 'k2']); await tick(); expect(loaded.length).toBe(3);
});

test('상한을 넘으면 오래된 영웅 몸부터 해제하고, 입은 몸(해제 거절)은 남겨 다음에 다시 본다', async () => {
  expect(AVATAR_PRELOAD_LIMIT).toBe(4);
  const refuse = new Set(['worn']);
  const { preloader, released } = fakeBodies(refuse);
  preloader.focus(['worn', 'a2']); await tick();
  preloader.focus(['b1', 'b2']); await tick();
  expect(released).toEqual([]);
  preloader.focus(['c1', 'c2']); await tick();
  // worn 은 입고 있어 거절 → a2·b1 이 대신 해제된다. 지금 영웅 것(c1,c2)은 지킨다.
  expect(released).toEqual(['a2', 'b1']);
  expect(preloader.held()).toEqual(['worn', 'b2', 'c1', 'c2']);
  // 벗은 뒤 정리하면 해제된다.
  refuse.delete('worn'); expect(preloader.clear()).toBe(4); expect(preloader.held()).toEqual([]);
});

test('clear 는 받아 둔 몸을 모두 해제하고, pause 는 대기열만 멈춘다', async () => {
  const { preloader, loaded, released, gate, flush } = fakeBodies(); gate.auto = false;
  preloader.focus(['p1', 'p2', 'p3']); await tick();
  preloader.pause(); flush(); await tick();
  expect(loaded).toEqual(['p1']); expect(preloader.pending()).toEqual([]);
  expect(preloader.clear()).toBe(3); expect(released.sort()).toEqual(['p1', 'p2', 'p3']); expect(preloader.held()).toEqual([]);
});

test('미리 받을 순서는 보이는 것·고른 것 먼저, 그 영웅 것만, 몸 자산이 있는 것만', () => {
  const knight = AVATARS.filter((avatar) => avatar.heroId === 'knight').map((avatar) => avatar.id);
  const order = wardrobePreloadOrder('knight', { shown: knight[1], picked: 'avatar_mage_astral' }, () => true);
  expect(order[0]).toBe(knight[1]); expect(order).not.toContain('avatar_mage_astral');
  expect(new Set(order)).toEqual(new Set(knight));
  expect(wardrobePreloadOrder('knight', {}, (id) => id === knight[0])).toEqual([knight[0]]);
});

// ---------- 상점 입어 보기 원복 ----------
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
});
afterEach(() => { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

test('입어 보기 상태는 원래 모습과 입어 볼 아바타 사이만 오간다', () => {
  expect(tryOnShown(null, 'avatar_knight_sakura', true)).toBe('avatar_knight_sakura');
  expect(tryOnShown(null, 'avatar_knight_sakura', false)).toBe(null);
  expect(tryOnShown('avatar_knight_pumpkin', 'avatar_knight_sakura', false)).toBe('avatar_knight_pumpkin');
});

test('상점 입어 보기는 저장·보석·착용을 바꾸지 않고, 닫으면 미리보기를 정리한다', () => {
  const eco: any = grandfather(new Economy());
  const avatar = AVATARS.find((entry) => entry.heroId === eco.s.selected) || AVATARS[0];
  const before = JSON.stringify({ gems: eco.s.gems, avatars: eco.s.avatars });
  const calls: any[] = []; let onClose: any = null; const buttons: Record<string, any> = {};
  const box = { querySelector: (sel: string) => (sel === '#tryon-stage' ? { id: 'stage' } : (buttons[sel] ||= { onclick: null })) };
  const fake: any = {
    eco, app: { models: new Proxy({}, { get: () => ({}) }), wardrobe: { tryOn: (...args: any[]) => { calls.push(['tryOn', ...args]); return true; }, previewStop: () => calls.push(['stop']) } },
    ui: { modal: (_html: string, opts: any) => { onClose = opts.onClose; opts.onOpen(box); }, closeModal: () => { calls.push(['close']); onClose?.(); } },
    buyOrEquipAvatar: () => calls.push(['buy']),
  };
  Meta.prototype.showAvatarTryOn.call(fake, avatar.id);
  expect(calls[0]).toEqual(['tryOn', { id: 'stage' }, avatar.heroId, avatar.id]);
  buttons['#m-cancel'].onclick();
  expect(calls.some((c) => c[0] === 'stop')).toBe(true);
  expect(calls.some((c) => c[0] === 'buy')).toBe(false);
  expect(JSON.stringify({ gems: eco.s.gems, avatars: eco.s.avatars })).toBe(before);
});

test('받지 않은 아바타 몸·없는 아바타·영웅 기본 몸은 해제하지 않는다', async () => {
  const { releaseAvatarBody, avatarBodyReady, heroBodyUserCount } = await import('../src/engine/assets.js');
  const { HEROES } = await import('../src/data/heroes.js');
  expect(releaseAvatarBody('avatar_knight_sakura')).toBe(false);
  expect(releaseAvatarBody('nope')).toBe(false);
  expect(avatarBodyReady('avatar_knight_sakura')).toBe(false);
  expect(heroBodyUserCount('avatar_knight_sakura')).toBe(0);
  const bodyAvatar = Object.values(HEROES).map((hero: any) => hero.bodyAvatar).find(Boolean);
  if (bodyAvatar) expect(releaseAvatarBody(bodyAvatar)).toBe(false);
});
