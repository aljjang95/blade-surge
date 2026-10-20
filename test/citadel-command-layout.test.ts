import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// UX가 지운 citadel-command.css의 숨김·복귀 버튼 규칙이 빠져 걷기 모드에서 착지 패널이 남고 복귀 버튼이 상단 바 밑(0,0)에 깔렸다(root PC f729044).
test('landing panel and walk return button keep hidden and positioned rules', () => {
  const css = readFileSync('src/ui/dungeon-lobby.css', 'utf8');
  expect(css).toMatch(/#citadel-command\[hidden\][^{]*\{\s*display:\s*none\s*!important/);
  expect(css).toMatch(/\.citadel-command-return\[hidden\]/);
  expect(css).toMatch(/\.citadel-command-return \{[^}]*position:\s*absolute[^}]*min-height:\s*44px/);
});

