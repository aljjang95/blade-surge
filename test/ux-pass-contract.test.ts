import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('UX 정비 스타일시트는 마지막 CSS(mobile-menu)가 불러오고 가로 모바일 규칙을 가진다', () => {
  expect(read('src/ui/mobile-menu.css')).toContain("@import './ux-pass.css'");
  const css = read('src/ui/ux-pass.css');
  expect(css).toContain('(orientation: landscape) and (max-height: 520px)');
  expect(css).toMatch(/\.bottomnav \{[^}]*width: 64px/);          // 좌측 레일
  expect(css).toMatch(/\.topbar \{[^}]*height: 40px/);            // 재화 바 40px
  expect(css).toContain('body.citadel-hub-active #meta .bottomnav { display: none');   // 걷기 모드에서는 탭 숨김
});

test('재화 + 버튼은 스크린리더가 구분할 이름을 가진다', () => {
  const html = read('index.html');
  for (const label of ['에너지 충전', '골드 충전', '보석 충전']) expect(html).toContain('aria-label="' + label + '"');
});

test('영웅 화면은 장비 · 성장 · 스킬 · 세트 탭과 가방 필터를 제공한다', () => {
  const panel = read('src/ui/gear-panel.js');
  for (const id of ["'gear'", "'growth'", "'skills'", "'sets'"]) expect(panel).toContain('id: ' + id);
  for (const hook of ['data-bag-slot', 'data-bag-rarity', 'data-bag-sort', 'id="i-eq"', 'id="e-go"']) expect(panel).toContain(hook);
});
