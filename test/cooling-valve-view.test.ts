import { afterAll, beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { CoolingValveView } from '../src/game/cooling-valve-view.js';

// 냉각 장치 뷰의 조작판 닫힘 표시(BUNDLE-08 PLAN 3.2)만 본다. 규칙 쪽 padOpen 은 이 브랜치에 없으므로 가짜 route 를 쓴다.
// 뷰는 라벨을 canvas 2d 로 그리므로, document 가 없는 환경에서는 그린 글자를 기록하는 최소 대체를 테스트 동안만 둔다.
const DEEP = ROUTE_OBJECTIVES.ashforge_deep, STANDARD = ROUTE_OBJECTIVES.ashforge_standard;
const CYAN = 0x56e6d5, GRAY = 0x6d7a86;

const drawn: string[][] = [];
// 다른 테스트 파일이 같은 프로세스에 document 를 남겨 둘 수 있어 항상 우리 대체를 설치하고 끝나면 원래 값을 되돌린다.
const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document');
const realDocument = (globalThis as any).document;
beforeAll(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: {
    createElement: () => {
      const texts: string[] = []; drawn.push(texts);
      const context = { clearRect() {}, fillRect() {}, fillText: (t: string) => { texts.push(t); }, fillStyle: '', font: '', textAlign: '' };
      return { width: 0, height: 0, getContext: () => context };
    },
  } });
});
afterAll(() => {
  if (hadDocument) Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: realDocument });
  else delete (globalThis as any).document;
});

function makeGltf() {
  const scene = new THREE.Group();
  const body = new THREE.Group();
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); wheel.name = 'Wheel';
  const lens = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); lens.name = 'StatusLens';
  body.add(wheel, lens); scene.add(body);
  return { scene };
}
function makeRoute(def: any, over: any = {}) {
  const gates = def.gates.map((g: any, i: number) => ({
    room: { id: g.roomId, x: 20 + i * 30, z: 0, discovered: true }, pos: new THREE.Vector3(20 + i * 30, 0, 0),
    pad: new THREE.Vector3(20 + i * 30 - 3.5, 0, 0), side: 1, phase: 'heat', ready: false, attuned: false, prepared: false,
  }));
  return { def, gates, progress: 0, hold: 0, ...over };
}
// 마지막으로 그려진 라벨 글자(캔버스는 게이트마다 하나)
const lastLabel = (gate: number, perView: number) => drawn[drawn.length - perView + gate].at(-1);

test('shockWindow 정의: 준비됐지만 닫힌 조작판은 회색·옅게, 라벨은 충격파 대기', () => {
  drawn.length = 0;
  const route: any = makeRoute(DEEP, { padOpen: () => false });
  route.gates[0].ready = true;
  const view = new CoolingValveView(new THREE.Scene(), makeGltf(), route), pad = (view as any).entries[0].pad;
  expect(pad.visible).toBe(true);
  expect(pad.material.color.getHex()).toBe(GRAY);
  expect(pad.material.opacity).toBeCloseTo(.45, 6);
  expect(lastLabel(0, DEEP.gates.length)).toBe('01 · 충격파 대기');
  // 닫혀 있는 동안은 유지 비율이 있어도 옅은 채로 있다.
  route.hold = 1; view.update(route);
  expect(pad.material.opacity).toBeCloseTo(.45, 6);
  view.dispose();
});

test('shockWindow 정의: 열리면 청록과 .55 + .45 × 유지 비율, 라벨은 조작 2초', () => {
  drawn.length = 0;
  let open = false;
  const route: any = makeRoute(DEEP, { padOpen: () => open });
  route.gates[0].ready = true;
  const view = new CoolingValveView(new THREE.Scene(), makeGltf(), route), pad = (view as any).entries[0].pad;
  expect(pad.material.color.getHex()).toBe(GRAY);
  open = true; view.update(route);
  expect(pad.material.color.getHex()).toBe(CYAN);
  expect(pad.material.opacity).toBeCloseTo(.55, 6);
  expect(lastLabel(0, DEEP.gates.length)).toBe('01 · 조작 2초');
  route.hold = 1; view.update(route);                       // holdSeconds 2 의 절반
  expect(pad.material.opacity).toBeCloseTo(.55 + .45 * .5, 6);
  // 다음 망치 예고가 시작되어 다시 닫히면 회색으로 돌아가고 라벨도 바뀐다.
  open = false; route.hold = 0; view.update(route);
  expect(pad.material.color.getHex()).toBe(GRAY);
  expect(lastLabel(0, DEEP.gates.length)).toBe('01 · 충격파 대기');
  view.dispose();
});

test('shockWindow 정의: 정리 중(ready 아님)이나 차례가 아닌 장치에는 닫힘 표시를 쓰지 않는다', () => {
  drawn.length = 0;
  const route: any = makeRoute(DEEP, { padOpen: () => false });
  route.gates[1].ready = true;                               // 차례가 아닌 장치는 ready 여도 판이 보이지 않는다
  const view = new CoolingValveView(new THREE.Scene(), makeGltf(), route), entries = (view as any).entries;
  expect(entries[0].pad.visible).toBe(false);
  expect(lastLabel(0, DEEP.gates.length)).toBe('01 · 방어');
  expect(entries[1].pad.visible).toBe(false);
  expect(entries[1].pad.material.color.getHex()).toBe(CYAN);
  expect(lastLabel(1, DEEP.gates.length)).toBe('02 · 대기');
  view.dispose();
});

test('shockWindow 가 아닌 정의는 padOpen 이 있어도 기존 표시 그대로(청록 · .55 + .45 × 비율 · 조작 2초)', () => {
  drawn.length = 0;
  const route: any = makeRoute(STANDARD, { padOpen: () => false });
  route.gates[0].ready = true; route.hold = 1;
  const view = new CoolingValveView(new THREE.Scene(), makeGltf(), route), pad = (view as any).entries[0].pad;
  expect(pad.material.color.getHex()).toBe(CYAN);
  expect(pad.material.opacity).toBeCloseTo(.55 + .45 * (1 / STANDARD.holdSeconds), 6);
  expect(lastLabel(0, STANDARD.gates.length)).toBe('01 · 조작 2초');
  view.dispose();
});

test('shockWindow 정의라도 padOpen 이 없으면 기존 표시 그대로', () => {
  drawn.length = 0;
  const route: any = makeRoute(DEEP);
  route.gates[0].ready = true;
  const view = new CoolingValveView(new THREE.Scene(), makeGltf(), route), pad = (view as any).entries[0].pad;
  expect(pad.material.color.getHex()).toBe(CYAN);
  expect(pad.material.opacity).toBeCloseTo(.55, 6);
  expect(lastLabel(0, DEEP.gates.length)).toBe('01 · 조작 2초');
  view.dispose();
});

// 밀물 띠 색과 닫힘 라벨은 정의(ventColor·copy.waitShort)에서 온다.
test('ventColor 정의: 밀물 띠 uniform 과 뜨거운 동안의 상태등이 파란 물빛, 라벨은 정의의 닫힘 문구', () => {
  const EMBER = ROUTE_OBJECTIVES.ember_deep;
  drawn.length = 0;
  const route: any = makeRoute(EMBER, { padOpen: () => false, copy: EMBER.copy });
  route.gates[0].ready = route.gates[0].prepared = true; route.gates[0].phase = 'warning';
  const view = new CoolingValveView(new THREE.Scene(), makeGltf(), route), entry = (view as any).entries[0];
  const uniforms = entry.vent.material.uniforms;
  expect(uniforms.color.value.getHex()).toBe(0x3d8cff);
  expect(uniforms.tint.value).toBe(1);
  const lens = [...entry.statusMaterials][0] as any;
  expect(lens.color.getHex()).toBe(0x3d8cff);
  // 물이 빠지면(heat) 상태등은 뜨거운 색이 아니라 차례 색으로 돌아간다.
  route.gates[0].phase = 'heat'; view.update(route);
  expect(lens.color.getHex()).toBe(0xffd181);
  route.gates[0].phase = 'vent'; view.update(route);
  expect(lens.color.getHex()).toBe(0x3d8cff);
  route.gates[0].phase = 'heat'; route.gates[0].prepared = true; view.update(route);
  expect(lastLabel(0, EMBER.gates.length)).toBe('01 · 밀물 대기');
  view.dispose();
});

test('ventColor 가 없는 정의는 기존 주황 띠와 충격파 대기 문구 그대로', () => {
  drawn.length = 0;
  const route: any = makeRoute(DEEP, { padOpen: () => false });
  route.gates[0].ready = route.gates[0].prepared = true; route.gates[0].phase = 'vent';
  const view = new CoolingValveView(new THREE.Scene(), makeGltf(), route), entry = (view as any).entries[0];
  expect(entry.vent.material.uniforms.color.value.getHex()).toBe(0xff863e);
  expect(entry.vent.material.uniforms.tint.value).toBe(0);
  expect([...entry.statusMaterials][0].color.getHex()).toBe(0xff863e);
  route.gates[0].phase = 'heat'; view.update(route);
  expect(lastLabel(0, DEEP.gates.length)).toBe('01 · 충격파 대기');
  view.dispose();
});
