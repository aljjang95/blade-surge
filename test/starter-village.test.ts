import { afterEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { setActiveCampaignTownChapter } from '../src/data/campaign-towns.js';
import { CITADEL_HUB_HOTSPOTS, CITADEL_HUB_SPAWN, isStarterVillage, townHub } from '../src/data/citadel-hub.js';
import { STARTER_DUMMIES, STARTER_HOTSPOTS } from '../src/data/starter-village.js';
import { PRACTICE_GOAL, STARTER_PROGRESS_KEY, normalizeStarterProgress, readStarterProgress, refreshStarterProgress, starterBoardCards, starterChecklist, StarterVillageUI, starterStoneCopy, writeStarterProgress } from '../src/ui/starter-village-ui.js';
import { hubReach } from './helpers/hub-walk';

afterEach(() => { setActiveCampaignTownChapter(1); });

const memoryStorage = (initial: string | null = null) => {
  let value = initial;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, peek: () => value };
};

test('progress record normalizes, drops unknown fields and is idempotent', () => {
  expect(normalizeStarterProgress(null)).toEqual({ practiced: 0, boardSeen: false, smithVisited: false });
  expect(normalizeStarterProgress('x')).toEqual({ practiced: 0, boardSeen: false, smithVisited: false });
  expect(normalizeStarterProgress([1, 2])).toEqual({ practiced: 0, boardSeen: false, smithVisited: false });
  const messy = { practiced: 7.9, boardSeen: true, smithVisited: 'yes', hacked: 1 };
  const once = normalizeStarterProgress(messy);
  expect(once).toEqual({ practiced: 7, boardSeen: true, smithVisited: false });
  expect(normalizeStarterProgress(once)).toEqual(once);
  for (const bad of [-1, NaN, Infinity, '3', null]) expect(normalizeStarterProgress({ practiced: bad }).practiced).toBe(0);
  expect(normalizeStarterProgress({ practiced: 1e9 }).practiced).toBe(9999);
});

test('progress storage survives corrupt JSON, throwing storage and failed writes', () => {
  expect(readStarterProgress(memoryStorage('{broken'))).toEqual({ practiced: 0, boardSeen: false, smithVisited: false });
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  expect(readStarterProgress(blocked).practiced).toBe(0);
  expect(writeStarterProgress({ practiced: 2 }, blocked)).toBe(false);
  // 마지막 쓰기가 실패했으면 이번 세션 사본을 계속 쓴다.
  expect(refreshStarterProgress({ practiced: 2, boardSeen: true, smithVisited: false }, false, memoryStorage(null)).practiced).toBe(2);
  expect(refreshStarterProgress({ practiced: 2 }, undefined, blocked).practiced).toBe(2);
  const storage = memoryStorage();
  expect(writeStarterProgress({ practiced: 3, boardSeen: true, smithVisited: true, extra: 1 }, storage)).toBe(true);
  expect(JSON.parse(storage.peek()!)).toEqual({ practiced: 3, boardSeen: true, smithVisited: true });
  expect(readStarterProgress(storage).practiced).toBe(3);
  expect(STARTER_PROGRESS_KEY).toBe('blade-surge.starter-village.v1');
});

test('checklist marks exactly one next step from real state and the 1-1 clear', () => {
  const fresh = { progress: { unlocked: 1, stars: {} } };
  let steps = starterChecklist(normalizeStarterProgress(null), fresh);
  expect(steps.map(step => step.id)).toEqual(['training', 'board', 'smith', 'sortie']);
  expect(steps.filter(step => step.next).map(step => step.id)).toEqual(['training']);
  steps = starterChecklist({ practiced: PRACTICE_GOAL, boardSeen: true, smithVisited: false }, fresh);
  expect(steps.filter(step => step.next).map(step => step.id)).toEqual(['smith']);
  steps = starterChecklist({ practiced: PRACTICE_GOAL, boardSeen: true, smithVisited: true }, fresh);
  expect(steps.filter(step => step.next).map(step => step.id)).toEqual(['sortie']);
  // 관문 1-1 완료는 저장(progress.unlocked > 1)에서 읽는다.
  steps = starterChecklist({ practiced: PRACTICE_GOAL, boardSeen: true, smithVisited: true }, { progress: { unlocked: 2, stars: { '1-1': 3 } } });
  expect(steps.every(step => step.done)).toBe(true);
  expect(steps.some(step => step.next)).toBe(false);
});

test('board cards read stage, dungeon and practice completion from state', () => {
  const save = { progress: { unlocked: 1, stars: {} }, expedition: { stats: {} } };
  let cards = starterBoardCards(normalizeStarterProgress({ practiced: 1 }), save);
  expect(cards[0]).toMatchObject({ id: 'stage-1-1', done: false, action: 'stage' });
  expect(cards.at(-1)).toMatchObject({ id: 'practice', done: false, progress: `1 / ${PRACTICE_GOAL}` });
  const dungeon = cards.find(card => card.action === 'dungeon');
  expect(dungeon?.done).toBe(false);
  expect(CITADEL_HUB_HOTSPOTS.some(spot => spot.id === `dungeon:${dungeon?.dungeonId}`)).toBe(true);
  cards = starterBoardCards({ practiced: PRACTICE_GOAL, boardSeen: true, smithVisited: false },
    { progress: { unlocked: 2, stars: { '1-1': 1 } }, expedition: { stats: { [dungeon!.dungeonId!]: 2 } } });
  expect(cards.map(card => card.done)).toEqual([true, true, true]);
});

test('stone shows the selected hero existing copy only', () => {
  const copy = starterStoneCopy('knight')!;
  expect(copy.name).toBe('검성 아르카');
  expect(copy.intro).toContain('성검');
  expect(starterStoneCopy('nobody')).toBeNull();
});

test('starter hub exposes the new interaction kinds and every hotspot is reachable on foot', () => {
  expect(isStarterVillage('oathhold')).toBe(true);
  const hub = townHub('oathhold') as any;
  expect(hub.starter).toBe(true);
  const kinds = new Set(hub.hotspots.map((spot: any) => spot.kind));
  for (const kind of ['guide', 'training', 'board', 'smith', 'story', 'campaign', 'merchant', 'trainer', 'steward', 'waystone']) expect(kinds.has(kind)).toBe(true);
  expect((STARTER_HOTSPOTS as any[]).map(spot => spot.kind).sort()).toEqual(['board', 'campaign', 'guide', 'smith', 'story', 'training']);
  expect(hub.hotspots.find((spot: any) => spot.id === 'gate:campaign')?.kind).toBe('campaign');
  expect(hub.spawn).toEqual(CITADEL_HUB_SPAWN);
  const reach = hubReach(hub);
  const unreachable = hub.hotspots.filter((spot: any) => !reach.reaches(spot)).map((spot: any) => spot.id);
  expect(unreachable).toEqual([]);
  // 허수아비 앞에서 연습 버튼이 닿는 자리(훈련장 반경)가 걸을 수 있는 칸이어야 한다.
  const training = hub.hotspots.find((spot: any) => spot.kind === 'training');
  expect(reach.reaches(training)).toBe(true);
  for (const dummy of STARTER_DUMMIES) expect(Math.abs(dummy.x)).toBeLessThan(12);
});

test('chapter 2 and later bring back the original plaza layout', () => {
  const starter = townHub('oathhold') as any;
  setActiveCampaignTownChapter(2);
  expect(isStarterVillage('oathhold')).toBe(false);
  const plaza = townHub('oathhold') as any;
  expect(plaza.starter).toBeFalsy();
  expect(plaza).not.toBe(starter);
  const kinds = new Set(plaza.hotspots.map((spot: any) => spot.kind));
  for (const kind of ['guide', 'training', 'board', 'smith', 'story']) expect(kinds.has(kind)).toBe(false);
  for (const kind of ['campaign', 'arena', 'merchant', 'trainer', 'waystone']) expect(kinds.has(kind)).toBe(true);
  // 2지역 마을에서도 모든 지점에 걸어서 닿아야 한다(기존 계약).
  const reach = hubReach(plaza);
  expect(plaza.hotspots.filter((spot: any) => !reach.reaches(spot)).map((spot: any) => spot.id)).toEqual([]);
  setActiveCampaignTownChapter(1);
  expect(isStarterVillage('oathhold')).toBe(true);
  expect(townHub('oathhold')).toBe(starter);
});

test('practice swings once, shakes the nearest dummy, counts and toasts on the third hit', () => {
  const root = new THREE.Object3D(), mixer = new THREE.AnimationMixer(root);
  const clips = { Idle: new THREE.AnimationClip('Idle', 1, []), '1H_Melee_Attack_Slice_Horizontal': new THREE.AnimationClip('1H_Melee_Attack_Slice_Horizontal', .5, []) };
  mixer.clipAction(clips.Idle).play();
  const showcase: any = { root, mixer, clips, def: { combo: [{ anim: '1H_Melee_Attack_Slice_Horizontal' }] }, gesture: null, t: 0 };
  const strikes: any[] = [], toasts: string[] = [];
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = { getItem: (key: string) => store[key] ?? null, setItem: (key: string, value: string) => { store[key] = value; } };
  const app: any = { showcase, reducedMotion: { matches: false }, hubMovement: { position: { x: -4.7, z: 1.6 }, moving: false, animation: null },
    arena: { lobbyHall: { userData: { starter: { strike: (position: any) => { strikes.push(position); return 'dummy:1'; } } } } }, ui: { toast: (message: string) => toasts.push(message) } };
  const view: any = new StarterVillageUI(app, {});
  for (let i = 0; i < 4; i++) { view.lastPractice = 0; expect(view.practice()).toBe(true); }
  expect(strikes).toHaveLength(4);
  expect(view.progress.practiced).toBe(4);
  expect(JSON.parse(store[STARTER_PROGRESS_KEY]).practiced).toBe(4);
  expect(toasts.filter(message => message.includes('연습 완료'))).toHaveLength(1);
  expect(showcase.gesture?.getClip().name).toBe('1H_Melee_Attack_Slice_Horizontal');
  // 가장 가까운 허수아비를 향해 몸을 돌린다.
  expect(Math.abs(showcase.root.rotation.y)).toBeGreaterThan(0);
  // 연타 쉬는 시간 안에 누른 것은 세지 않는다.
  view.practice(); expect(view.progress.practiced).toBe(4);
  // 공격 동작이 끝나면 Idle 로 돌아온다.
  mixer.update(.6); mixer.update(.01);
  expect(showcase.gesture).toBeNull();
  expect(app.hubMovement.animation.getClip().name).toBe('Idle');
  Reflect.deleteProperty(globalThis, 'localStorage');
});
