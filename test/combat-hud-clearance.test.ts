import { expect, test } from 'bun:test';
import { collectHudBlockers, overlapArea, placeOutside, rectsOverlap } from '../src/ui/hud-clearance.js';
import { estimateTagWidth } from '../src/ui/target-tag.js';
import { initialInputModality, inputModalityOf } from '../src/ui/input-modality.js';
import { ENEMIES } from '../src/data/stages.js';
import { readFileSync } from 'node:fs';

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const out = () => ({ dx: 0, dy: 0, hidden: false });
const bounds = rect(0, 0, 844, 390);
// 844x390 에서 실측한 영웅 HP 카드(14,12 / 220x91)와 우상단 버튼 줄.
const HP_CARD = { ...rect(14, 12, 234, 103), id: 'hud-player' };
const BUTTONS = { ...rect(728, 12, 830, 56), id: 'hud-right-top' };

test('이름표가 HUD 카드 밖이면 그대로 둔다', () => {
  const r = placeOutside(out(), 300, 150, 380, 178, [HP_CARD, BUTTONS], bounds, 44);
  expect(r).toEqual({ dx: 0, dy: 0, hidden: false });
});
test('영웅 HP 카드에 걸친 이름표는 가장 가까운 빈 곳으로 밀려 겹침이 0이 된다', () => {
  // 카드 오른쪽 가장자리에 8px 걸친 이름표: 오른쪽으로 8px 이동하면 비킨다.
  const r = placeOutside(out(), 226, 40, 306, 68, [HP_CARD], bounds, 44);
  expect(r.hidden).toBe(false);
  const moved = rect(226 + r.dx, 40 + r.dy, 306 + r.dx, 68 + r.dy);
  expect(rectsOverlap(moved, HP_CARD)).toBe(false);
  expect(Math.hypot(r.dx, r.dy)).toBeLessThanOrEqual(10);
});
test('카드 한가운데에 놓인 이름표는 멀리 밀어야 하므로 숨긴다', () => {
  const r = placeOutside(out(), 60, 40, 140, 68, [HP_CARD], bounds, 44);
  expect(r.hidden).toBe(true);
});
test('화면 밖으로 나간 이름표는 화면 안으로 당긴 뒤 겹침을 판정한다', () => {
  const r = placeOutside(out(), -30, 200, 50, 228, [HP_CARD], bounds, 44);
  expect(r).toEqual({ dx: 30, dy: 0, hidden: false });
});
test('유한하지 않은 좌표는 숨긴다', () => {
  expect(placeOutside(out(), NaN, 0, 10, 10, [], bounds).hidden).toBe(true);
});
test('겹친 면적 계산과 사각형 판정이 일치한다', () => {
  expect(overlapArea(rect(0, 0, 10, 10), rect(5, 5, 20, 20))).toBe(25);
  expect(overlapArea(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(0);
  expect(rectsOverlap(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(false);
});
test('HUD 요소 사각형 수집은 크기가 0인 숨은 요소를 뺀다', () => {
  const el = (r: { left: number; top: number; width: number; height: number }) => ({ id: 'x', getBoundingClientRect: () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }) });
  const hud = { querySelectorAll: (selector: string) => selector === '.hud-player' ? [el({ left: 14, top: 12, width: 220, height: 91 })] : selector === '#combo' ? [el({ left: 0, top: 0, width: 0, height: 0 })] : [] };
  const found = collectHudBlockers(hud as any);
  expect(found.length).toBe(1);
  expect(found[0]).toMatchObject({ left: 14, top: 12, right: 234, bottom: 103 });
});
test('이름표 폭 추정은 한글 이름이 길수록 커지고 상한 132px 를 넘지 않는다', () => {
  expect(estimateTagWidth('뼈 오크 · 947')).toBeGreaterThan(estimateTagWidth('오크 · 9'));
  expect(estimateTagWidth('아주아주아주아주아주아주아주 긴 이름의 적 · 1,234,567')).toBe(132);
  expect(estimateTagWidth('')).toBe(64);
});

test('입력 방식: 터치·펜은 touch, 키·마우스는 keyboard 계열, 수식키 단독은 무시', () => {
  expect(inputModalityOf({ type: 'pointerdown', pointerType: 'touch' })).toBe('touch');
  expect(inputModalityOf({ type: 'pointerdown', pointerType: 'mouse' })).toBe('mouse');
  expect(inputModalityOf({ type: 'touchstart' })).toBe('touch');
  expect(inputModalityOf({ type: 'keydown', key: 'j' })).toBe('keyboard');
  expect(inputModalityOf({ type: 'keydown', key: 'Shift' })).toBeNull();
  expect(inputModalityOf({ type: 'click' })).toBeNull();
  expect(inputModalityOf(null)).toBeNull();
});
test('처음 입력 방식은 거친 포인터면 touch, 아니면 keyboard', () => {
  expect(initialInputModality({ matchMedia: () => ({ matches: true }) } as any)).toBe('touch');
  expect(initialInputModality({ matchMedia: () => ({ matches: false }) } as any)).toBe('keyboard');
  expect(initialInputModality({} as any)).toBe('keyboard');
});

test('큰 슬라임은 모델만 작게 그리고 반경·자폭 범위의 기준 scale 은 그대로다', () => {
  // 폭탄 슬라임 계열은 모델 배율이 영웅보다 커서 뒤의 적을 가렸다. 화면 크기만 줄이고 판정 기준(def.scale)은 바꾸지 않는다.
  for (const [id, scale] of [['bomb_slime', 0.5], ['glass_shardling', 0.55], ['blob_spiky', 0.55]] as const) {
    const def = (ENEMIES as any)[id];
    expect(def.scale).toBe(scale);
    expect(def.visualScale).toBeGreaterThanOrEqual(0.6);
    expect(def.visualScale).toBeLessThanOrEqual(0.7);
  }
  // 다른 적에게는 시각 배율을 붙이지 않는다.
  expect((ENEMIES as any).bone_orc.visualScale).toBeUndefined();
});

const css = readFileSync(new URL('../src/ui/combat-hud-clear.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
test('콤보 칩은 HP 카드 아래 띠(--combo-top)에 두고 오른쪽 위치를 쓰지 않는다', () => {
  expect(css).toMatch(/#hud \.combo\s*\{[^}]*top:\s*var\(--combo-top/);
});
test('목표 카드는 접힌 상태에서 행동 줄을 숨기고 반투명이며 펼치면 불투명하다', () => {
  expect(css).toMatch(/#objective:not\(\.is-expanded\) \.battle-objective-action[^{]*\{\s*display:\s*none/);
  expect(css).toMatch(/#hud #objective\s*\{[^}]*opacity:\s*\.[4-7]/);
  expect(css).toMatch(/#objective\.is-expanded\s*\{[^}]*opacity:\s*1/);
});
test('방 안내 토스트는 위쪽 가운데이고 읽을 수 있는 글자 크기와 어두운 바탕을 쓴다', () => {
  const rule = css.match(/#hud #room-intro\s*\{([^}]*)\}/)![1];
  expect(rule).toMatch(/left:\s*50%/);
  expect(rule).toMatch(/top:\s*calc\(\s*\d+px/);
  expect(css).toMatch(/#room-intro span\s*\{[^}]*font-size:\s*clamp\(\s*1[2-9]px/);
  expect(rule).toMatch(/background:\s*#06[0-9a-f]{4}f[0-9a-f]/);
});
test('키보드 단축키 표시는 터치 입력에서만 숨긴다', () => {
  expect(css).toMatch(/html\[data-input="touch"\] #hud \.skill-btn \.key/);
  expect(css).toMatch(/html\[data-input="touch"\] #hud \.exp-potions small/);
  expect(css).not.toMatch(/data-input="keyboard"/);
});
