import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { HEROES } from '../src/data/heroes.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { libraryAssets } from '../src/engine/library-assets.js';
import { HeroPortraits, heroPortraitSnapshot, createHeroPortraitRenderer } from '../src/ui/hero-portraits.js';
import { createAdventureNavigation, ExpeditionUI } from '../src/expansion/hub.jsx';

const deferred = () => { let resolve: any; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setTimeout(done, 5));
function fixture() {
  const gear: any = { weapon: null, armor: null, ring: null, boots: null };
  let avatar: any = null;
  const app: any = { models: Object.fromEntries(Object.values(HEROES).map((def: any) => [def.model, {}])),
    eco: { heroEquipInsts: () => gear, equippedAvatar: () => avatar } };
  return { app, gear, avatar: (id: any) => { avatar = id; } };
}
function image() {
  const listeners = new Map(), assignments: string[] = [];
  let src = '';
  return { get src() { return src; }, set src(value: string) { src = value; assignments.push(value); },
    assignments, dataset: {} as any, isConnected: true,
    addEventListener: (key: string, fn: any) => listeners.set(key, fn),
    removeEventListener: (key: string, fn: any) => { if (listeners.get(key) === fn) listeners.delete(key); },
    fail: () => listeners.get('error')?.() };
}
const result = (snapshot: any) => ({ url: 'data:image/webp;base64,' + snapshot.id, body: snapshot.body.id });

test('초상 키는 실제 영웅·장비·아바타·정본 모델을 구분하고 진행 상태를 쓰지 않는다', () => {
  const { app, gear, avatar } = fixture();
  const keys = Object.keys(HEROES).map(id => heroPortraitSnapshot(app, id)!.key);
  expect(new Set(keys).size).toBe(Object.keys(HEROES).length);   // 영웅 수(다섯 + 소환 전용 SSR)만큼 서로 다르다
  const first = heroPortraitSnapshot(app, 'ranger')!;
  expect(first.body.id).toContain('ranger');
  expect(first.key).toContain('/models/heroes-next/ranger-library-t1-v6.glb');
  const armor: any = Object.values(ITEM_BY_ID).find((item: any) => item.slot === 'armor' && item.rarity === 'L');
  gear.armor = { id: armor.id, enh: 3 };
  const equipped = heroPortraitSnapshot(app, 'ranger')!;
  expect(equipped.key).not.toBe(first.key);
  // 방어구는 몸 외형을 바꾸지 않는다(2026-10-27): 몸체 단계·모델은 맨몸과 같고, 키만 장비 입력을 반영한다.
  expect(equipped.tier).toBe(1);
  expect(equipped.body.id).toBe(first.body.id);
  expect(equipped.equipment.armor).not.toBe(gear.armor);
  gear.armor.enh = 4;
  expect(equipped.equipment.armor!.enh).toBe(3);
  expect(heroPortraitSnapshot(app, 'ranger')!.key).not.toBe(equipped.key);
  const skin = libraryAssets().find((asset: any) => asset.avatar && asset.heroId === 'ranger')!;
  expect(skin).toBeTruthy(); avatar(skin.id);
  expect(heroPortraitSnapshot(app, 'ranger')!.body.id).toBe(skin.id);
  const unchanged = JSON.stringify(gear); heroPortraitSnapshot(app, 'ranger');
  expect(JSON.stringify(gear)).toBe(unchanged);
});

test('동일 외형 동시 요청은 한 렌더를 공유하고 순차 큐/캐시는 상한을 지킨다', async () => {
  const { app } = fixture(); const gate = deferred(); let calls = 0, active = 0, maxActive = 0, released = 0;
  const service = new HeroPortraits(app, { limit: 2, renderer: {
    async capture(snapshot: any) { calls++; active++; maxActive = Math.max(active, maxActive); if (calls === 1) await gate.promise; active--; return result(snapshot); },
    release() { released++; },
  } });
  const knight = heroPortraitSnapshot(app, 'knight')!;
  const a = service.request(knight), b = service.request(knight);
  expect(a).toBe(b); expect(calls).toBe(1);
  gate.resolve(true); expect((await a)!.body).toBe(knight.body.id); await tick();
  await service.request(knight); expect(calls).toBe(1);
  await service.request(heroPortraitSnapshot(app, 'mage')!);
  await service.request(heroPortraitSnapshot(app, 'ranger')!); await tick();
  expect(service.cache.size).toBe(2); expect(service.cache.has(knight.key)).toBe(false);
  expect(maxActive).toBe(1); expect(released).toBeGreaterThan(0);
  service.dispose(); expect(service.cache.size).toBe(0); expect(service.pending.size).toBe(0);
});

test('몸체 로드 전에는 spawn·캡처하지 않고 실제 body 불일치는 완료로 반환하지 않는다', async () => {
  const { app } = fixture(), snapshot = heroPortraitSnapshot(app, 'ranger')!;
  const gate = deferred(); let spawns = 0, draws = 0, disposed = 0, releases = 0, contextLost = false;
  const root = new THREE.Group(); root.userData.libraryBodyAssetId = snapshot.body.id;
  const gpu: any = { getContext: () => ({ isContextLost: () => contextLost }), setSize() {}, setPixelRatio() {}, render() { draws++; }, dispose() { releases++; },
    forceContextLoss() {}, domElement: { toDataURL: () => 'data:image/webp;base64,real', width: 256, height: 256 } };
  const renderer = createHeroPortraitRenderer({
    preload: () => gate.promise,
    spawn: () => { spawns++; return { root, mixer: { update() {} }, clips: {} }; },
    look() {}, dispose() { disposed++; }, createRenderer: () => gpu,
  } as any);
  const capture = renderer.capture(snapshot, () => true);
  await Promise.resolve(); expect(spawns).toBe(0); expect(draws).toBe(0);
  gate.resolve(true); expect((await capture)!.body).toBe(snapshot.body.id);
  expect(spawns).toBe(1); expect(draws).toBe(1); expect(disposed).toBe(1);
  root.userData.libraryBodyAssetId = 'wrong-base-body';
  expect(await renderer.capture(snapshot, () => true)).toBeNull();
  expect(draws).toBe(1); expect(disposed).toBe(2);
  root.userData.libraryBodyAssetId = snapshot.body.id; contextLost = true;
  expect(await renderer.capture(snapshot, () => true)).toBeNull(); expect(disposed).toBe(3);
  renderer.release(); renderer.release(); expect(releases).toBe(1);
});

test('로드 실패·취소는 기본 초상을 유지하며 잘못된 body를 ready/cache로 인증하지 않는다', async () => {
  const { app } = fixture(), img = image();
  let spawns = 0;
  const renderer = createHeroPortraitRenderer({ preload: async () => false, spawn: () => { spawns++; } } as any);
  expect(await renderer.capture(heroPortraitSnapshot(app, 'knight')!, () => true)).toBeNull();
  expect(spawns).toBe(0); renderer.release();
  const service = new HeroPortraits(app, { renderer: { capture: async () => ({ url: 'data:image/png;base64,x', body: 'wrong' }), release() {} } });
  service.bind(img, 'knight'); await tick();
  expect(img.src).toBe(HEROES.knight.portrait); expect(img.dataset.portraitState).toBe('fallback');
  expect(img.dataset.portraitBody).toBeUndefined(); expect(service.cache.size).toBe(0); service.dispose();
});

test('같은 DOM의 새 영웅 요청·분리된 DOM·장비 변경 뒤 늦은 완료는 이전 그림을 덮어쓰지 않는다', async () => {
  const { app, gear } = fixture(), gate = deferred(), img = image(); let calls = 0;
  const service = new HeroPortraits(app, { renderer: {
    async capture(snapshot: any) { if (++calls === 1) await gate.promise; return result(snapshot); }, release() {},
  } });
  service.bind(img, 'knight'); service.bind(img, 'ranger');
  gate.resolve(true); await tick(); await tick();
  expect(img.dataset.heroPortrait).toBe('ranger'); expect(img.dataset.portraitState).toBe('ready');
  expect(img.dataset.portraitBody).toContain('ranger');
  const detached = image(); detached.isConnected = false; service.bind(detached, 'mage'); await tick();
  expect(detached.dataset.portraitState).not.toBe('ready');
  const late = deferred(), stale = image();
  const service2 = new HeroPortraits(app, { renderer: { async capture(snapshot: any) { await late.promise; return result(snapshot); }, release() {} } });
  service2.bind(stale, 'knight');
  const weapon: any = Object.values(ITEM_BY_ID).find((item: any) => item.slot === 'weapon');
  gear.weapon = { id: weapon.id, enh: 1 }; late.resolve(true); await tick();
  expect(stale.dataset.portraitState).not.toBe('ready');
  service.dispose(); service2.dispose();
});

test('폐기 중인 렌더 완료와 이미지 decode 실패는 ready 외형 metadata를 남기지 않는다', async () => {
  const { app } = fixture(), gate = deferred(), img = image();
  const service = new HeroPortraits(app, { renderer: { async capture(snapshot: any) { await gate.promise; return result(snapshot); }, release() {} } });
  service.bind(img, 'ranger'); service.dispose(); gate.resolve(true); await tick();
  expect(img.dataset.portraitState).not.toBe('ready'); expect(service.cache.size).toBe(0);
  const live = new HeroPortraits(app, { renderer: { capture: async (snapshot: any) => result(snapshot), release() {} } });
  live.bind(img, 'mage'); await tick(); expect(img.dataset.portraitState).toBe('ready');
  img.fail(); expect(img.dataset.portraitState).toBe('fallback'); expect(img.dataset.portraitBody).toBeUndefined();
  expect(img.src).toBe(HEROES.mage.portrait); live.dispose();
});

class Element {
  children: Element[] = []; dataset: any = {}; attributes: any = {}; hidden = false; open = false;
  className = ''; textContent = ''; type = ''; onclick: any; disabled = false;
  classList = { toggle() {} };
  constructor(public tagName: string) {}
  append(...nodes: Element[]) { this.children.push(...nodes); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap(child => [...(selector === 'button' && child.tagName === 'button' ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
test('실제 모험 nav는 상시2개·정비 details·숨긴 결투장이고 원래 클릭 가드를 보존한다', () => {
  const calls: any[] = [], controller: any = { result: null, app: { toLobby: () => calls.push('lobby'), meta: { openTab: (...args: any[]) => calls.push(args) } } };
  const nav: any = createAdventureNavigation(controller, { createElement: (tag: string) => new Element(tag) } as any);
  expect(nav.children.filter((node: any) => node.tagName === 'button' && !node.hidden).map((node: any) => node.dataset.section)).toEqual(['campaign', 'dungeons']);
  expect(controller.toolsDetails.children[0].textContent).toBe('정비·임무');
  const tools = controller.toolsDetails.querySelectorAll('button');
  expect(tools.map((button: any) => button.dataset.section)).toEqual(['forge', 'jobs', 'quests']);
  expect(nav.querySelectorAll('button').find((button: any) => button.dataset.section === 'arena').hidden).toBe(true);
  for (const button of tools) button.onclick();
  expect(calls).toEqual([['stage', 'forge'], ['stage', 'jobs'], ['stage', 'quests']]);
  controller.result = { saveError: 'cannot save' }; tools[0].onclick(); expect(calls).toHaveLength(3);
  controller.result = { saveError: null }; tools[0].onclick();
  expect(calls.slice(-2)).toEqual(['lobby', ['stage', 'forge']]); expect(controller.result).toBeNull();
});

test('direct open 동기화는 정비 details를 열고 기본2탭으로 돌아가면 접으며 저장 실패 버튼은 막는다', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: { classList: { toggle() {} } } } });
  try {
    const controller: any = { result: null, host: {}, campaign: {}, root: { render() {} }, render() {} };
    createAdventureNavigation(controller, { createElement: (tag: string) => new Element(tag) } as any);
    for (const section of ['forge', 'jobs', 'quests']) {
      ExpeditionUI.prototype.syncTab.call(controller, 'stage', section);
      expect(controller.toolsDetails.open).toBe(true); expect(controller.initialTab).toBe(section);
      expect(controller.nav.querySelectorAll('button').find((b: any) => b.dataset.section === section).attributes['aria-pressed']).toBe('true');
    }
    ExpeditionUI.prototype.syncTab.call(controller, 'stage', 'dungeons'); expect(controller.toolsDetails.open).toBe(false);
    controller.result = { saveError: 'cannot save' };
    ExpeditionUI.prototype.syncTab.call(controller, 'stage', 'dungeons');
    expect(controller.nav.querySelectorAll('button').every((b: any) => b.disabled)).toBe(true);
  } finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
});

test('HUD가 전달한 초상은 id 없음·모델 미준비·렌더 실패 모두에서 즉시 유지된다', async () => {
  const { app } = fixture(), img = image();
  const gate = deferred();
  const service = new HeroPortraits(app, { renderer: { async capture() { await gate.promise; return null; }, release() {} } });
  service.bind(img, undefined, { fallbackUrl: 'provided-unknown.png' });
  expect(img.src).toBe('provided-unknown.png'); expect(img.dataset.portraitState).toBe('fallback');
  expect(img.dataset.heroPortrait).toBeUndefined();
  service.bind(img, 'knight', { fallbackUrl: 'provided-knight.png' });
  expect(img.src).toBe('provided-knight.png'); expect(img.dataset.portraitState).toBe('pending');
  gate.resolve(true); await tick();
  expect(img.src).toBe('provided-knight.png'); expect(img.dataset.portraitState).toBe('fallback');
  delete app.models.Ranger;
  service.bind(img, 'ranger', { fallbackUrl: 'provided-unloaded.png' }); await tick();
  expect(img.src).toBe('provided-unloaded.png'); expect(img.dataset.portraitBody).toBeUndefined();
  service.dispose();
});

test('HUD 제공 초상은 실제 ready만 교체하고 미등록 영웅으로 바뀌면 이전 완료도 무시한다', async () => {
  const { app } = fixture(), img = image(), gate = deferred();
  const service = new HeroPortraits(app, { renderer: {
    async capture(snapshot: any) { await gate.promise; return result(snapshot); }, release() {},
  } });
  service.bind(img, 'knight', { fallbackUrl: 'first.png' });
  service.bind(img, 'knight', { fallbackUrl: 'next.png' });
  expect(img.src).toBe('next.png');
  gate.resolve(true); await tick();
  expect(img.dataset.portraitState).toBe('ready'); expect(img.src).toStartWith('data:image/');
  img.fail(); expect(img.src).toBe('next.png'); expect(img.dataset.portraitBody).toBeUndefined();
  const late = deferred(), other = new HeroPortraits(app, { renderer: {
    async capture(snapshot: any) { await late.promise; return result(snapshot); }, release() {},
  } });
  other.bind(img, 'mage', { fallbackUrl: 'mage-custom.png' });
  other.bind(img, 'unregistered', { fallbackUrl: 'outside-roster.png' });
  late.resolve(true); await tick();
  expect(img.src).toBe('outside-roster.png'); expect(img.dataset.portraitState).toBe('fallback');
  expect(img.dataset.portraitBody).toBeUndefined(); service.dispose(); other.dispose();
});

test('재개방의 warm cache는 정적 URL 할당 없이 동기로 ready 이미지만 표시하고 LRU를 갱신한다', async () => {
  const { app } = fixture(); let captures = 0;
  const service = new HeroPortraits(app, { limit: 2, renderer: {
    async capture(snapshot: any) { captures++; return result(snapshot); }, release() {},
  } });
  const knight = heroPortraitSnapshot(app, 'knight')!, mage = heroPortraitSnapshot(app, 'mage')!;
  await service.request(knight); await service.request(mage);
  const img = image();
  service.bind(img, 'knight', { fallbackUrl: '/custom-fallback.png' });
  // No microtask or browser tick is needed; no throwaway network URL was assigned.
  expect(img.dataset.portraitState).toBe('ready');
  expect(img.dataset.portraitBody).toBe(knight.body.id);
  expect(img.assignments).toEqual([result(knight).url]); expect(captures).toBe(2);
  await service.request(heroPortraitSnapshot(app, 'ranger')!);
  expect(service.cache.has(knight.key)).toBe(true); expect(service.cache.has(mage.key)).toBe(false);
  img.fail();
  expect(img.assignments).toEqual([result(knight).url, '/custom-fallback.png']);
  expect(img.dataset.portraitState).toBe('fallback'); expect(img.dataset.portraitBody).toBeUndefined();
  service.dispose();
});

test('동기 캐시 적용도 body·data URL 검증을 통과해야 하며 miss는 제공 fallback을 유지한다', async () => {
  const { app } = fixture(), snapshot = heroPortraitSnapshot(app, 'ranger')!;
  for (const bad of [{ body: 'different-body', url: 'data:image/webp;base64,x' },
    { body: snapshot.body.id, url: '/not-a-rendered-snapshot.webp' }]) {
    const service = new HeroPortraits(app, { renderer: { capture: async () => null, release() {} } });
    service.cache.set(snapshot.key, bad);
    const img = image(); service.bind(img, 'ranger', { fallbackUrl: '/provided.png' });
    expect(img.src).toBe('/provided.png'); expect(img.dataset.portraitState).toBe('pending');
    expect(img.dataset.portraitBody).toBeUndefined(); await tick();
    expect(img.dataset.portraitState).toBe('fallback'); expect(img.assignments.every(src => src === '/provided.png')).toBe(true);
    expect(service.cache.size).toBe(0); service.dispose();
  }
});
