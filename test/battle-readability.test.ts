import { afterEach, expect, test } from 'bun:test';
import { BattleReadability } from '../src/ui/battle-readability.js';
import { Battle } from '../src/game/battle-base.js';
import { Input } from '../src/engine/input.js';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});
function fixture() {
  const world = { rooms: [] }, input: any = Object.assign(Object.create(Input.prototype), {
    queue: ['attack', 'interact'], attackSources: new Set(['button']), attackHeld: true, keys: { KeyW: true },
    gamepadButtons: new Uint8Array(8), gamepadMove: { x: 1, y: 1 }, move: { x: 1, y: 1 },
    screenMove: { x: 1, y: 1 }, joy: { active: true, id: 1 }, clearListeners: new Set(),
    el: { knob: { style: {} }, base: { style: {} } }, enabled: true,
  });
  const battle: any = Object.assign(Object.create(Battle.prototype), { world, active: true, paused: false,
    player: { alive: true }, pauseReasons: new Set(), input, routeObjectives: { interrupt() {} }, ui: { refreshComboFeedback() {} } });
  let canvasFocus = 0, mapFocus = 0;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const canvas = { focus() { expect(dialog.open).toBe(false); canvasFocus++; } };
  const view: any = Object.assign(Object.create(BattleReadability.prototype), { app: { battle, mode: 'battle', canvas },
    dialog, closeButton: { focus() {} }, mapButton: { focus() { mapFocus++; } }, refreshMap() {} });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  return { world, input, battle, dialog, view, canvasFocus: () => canvasFocus, mapFocus: () => mapFocus };
}
test('지도 열기와 종료는 실제 Input을 초기화하고 자기 정지만 해제한다', () => {
  const f = fixture(); f.battle.setPaused('companion', true);
  f.view.openMap();
  expect(f.dialog.open).toBe(true); expect([...f.battle.pauseReasons]).toEqual(['companion', 'tactical-map']);
  expect(f.input.queue).toEqual([]); expect(f.input.attackHeld).toBe(false); expect(f.input.joy.active).toBe(false);
  f.view.closeMap();
  expect(f.dialog.open).toBe(false); expect([...f.battle.pauseReasons]).toEqual(['companion']);
  expect(f.input.enabled).toBe(false); expect(f.canvasFocus()).toBe(0);
});
test('일반 지도 종료는 대화상자가 닫힌 뒤 게임 캔버스로 키보드 초점을 복귀한다', () => {
  const f = fixture(); f.view.openMap(); f.view.closeMap();
  expect(f.input.enabled).toBe(true); expect(f.input.keys).toEqual({});
  expect(f.canvasFocus()).toBe(1); expect(f.mapFocus()).toBe(0);
  expect(f.battle.pauseReasons.size).toBe(0);
});
test('지도 열기 실패는 기존 정지를 보존하고 자기 정지와 임시 월드만 되돌린다', () => {
  const f = fixture(); f.battle.setPaused('manual', true);
  f.dialog.showModal = () => { throw Error('dialog unavailable'); };
  expect(() => f.view.openMap()).toThrow('dialog unavailable');
  expect([...f.battle.pauseReasons]).toEqual(['manual']); expect(f.input.enabled).toBe(false);
  expect(f.view.mapBattle).toBeNull(); expect(f.view.mapWorld).toBeNull();
});
/** layoutControls 용 가짜 컨테이너: append/prepend 로 자식의 parentElement 를 바꾼다. */
function fakeBox(name: string) {
  const box: any = { name, append(el: any) { el.parentElement = box; }, prepend(el: any) { el.parentElement = box; } };
  return box;
}
test('각인 버튼은 일시정지 창 정보 묶음이 아니라 보이는 HUD 우상단 묶음에 남는다(전투 중 크기 0 방지)', () => {
  const f = fixture();
  const tray = fakeBox('tray'), top = fakeBox('top');
  const engraving: any = { parentElement: top }, codex: any = { parentElement: top };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null, getElementById: () => tray } });
  f.view.hud = { querySelector: (sel: string) => (sel === '.hud-right-top' ? top : null) };
  const battle: any = { rpgView: { hudButton: codex }, chronicle: { hud: engraving } };
  f.view.layoutControls(battle);
  expect(engraving.parentElement).toBe(top);
  expect(codex.parentElement).toBe(tray);
  // 예전 구조로 정보 묶음에 옮겨져 있던 버튼도 HUD 로 되돌린다.
  engraving.parentElement = tray;
  f.view.layoutControls(battle);
  expect(engraving.parentElement).toBe(top);
});
test('세로 화면: 각인 버튼이 보이면 제목 예약 폭이 늘고, 좁은 화면(374px 이하)은 버튼을 별도 행으로 내린다', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/ui/battle-readability.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../src/ui/masterworks.js', import.meta.url), 'utf8');
  // 버튼에는 CSS 가 잡을 수 있는 표식 클래스가 있다
  expect(js).toContain("'hud-btn hud-engrave'");
  // 기본 예약 폭(116px, AUTO·정지 2개 기준)보다 큰 값이 각인 버튼이 보일 때 걸린다(버튼 51.8px + 간격 6px 이상)
  const base = Number(/--portrait-action-space:(\d+)px;position:relative/.exec(css)![1]);
  const engrave = Number(/\.hud-top:has\(\.hud-engrave:not\(\[hidden\]\)\)\{--portrait-action-space:(\d+)px\}/.exec(css)![1]);
  expect(engrave).toBeGreaterThanOrEqual(base + 58);
  // 예약 폭 규칙이 4가지 조합(각인 단독·+획득 제안·+보스 직행·셋 다) 모두 있다
  expect((css.match(/hud-engrave:not\(\[hidden\]\)\)\{--portrait-action-space/g) || []).length).toBe(4);
  // 좁은 화면에서는 각인 버튼이 보이면 .hud-right-top 이 3행으로 내려가고 제목은 전체 폭을 쓴다
  const narrow = css.slice(css.indexOf('@media(orientation:portrait) and (max-width:374px)'));
  expect(narrow).toMatch(/:has\(\.hud-engrave:not\(\[hidden\]\)\)\)\s+\.hud-right-top\{grid-row:3/);
  expect(narrow).toMatch(/\.stage-name\{max-width:100%\}/);
});
