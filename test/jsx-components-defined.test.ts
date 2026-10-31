import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';

// 쓰는 JSX 컴포넌트는 그 파일에서 정의하거나 가져와야 한다. #226에서 RewardChips 정의만 빠져
// 결투장·원정 임무 화면이 ReferenceError로 빈 화면이 된 회귀를 막는다(docs/TOWN_AUDIT.md).
test('src/expansion JSX 파일은 쓰는 컴포넌트를 모두 정의하거나 가져온다', () => {
  const dir = new URL('../src/expansion/', import.meta.url);
  const missing: string[] = [];
  for (const name of readdirSync(dir).filter(file => file.endsWith('.jsx'))) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    const used = new Set([...source.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map(match => match[1]));
    for (const component of used) {
      const declared = new RegExp(`(function|const|let|class)\\s+${component}\\b`).test(source)
        || new RegExp(`import[^;]*\\b${component}\\b[^;]*from`).test(source);
      if (!declared) missing.push(`${name}: ${component}`);
    }
  }
  expect(missing).toEqual([]);
});
