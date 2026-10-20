import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { LOBBY_DESTINATIONS, MENU_GROUPS, menuKey } from '../src/ui/oath-shell.js';
import { MAPLE_HOTKEYS } from '../src/ui/maple-ui.js';

const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : []; });

describe('던전 우선 로비 정보 구조', () => {
  test('최상위 목적지는 던전 · 영웅·장비 · 메뉴 3개', () => {
    expect(LOBBY_DESTINATIONS).toEqual(['home', 'heroes', 'menu']);
  });
  test('보조 입구는 메뉴 묶음에 있고 파티 · 결투장은 기본 솔로 로비에 넣지 않는다', () => {
    const keys = MENU_GROUPS.flatMap((group: any) => group.order);
    for (const key of ['tab:stage', 'menu-fields', 'citadel-command-supply', 'menu-forge', 'menu-town-quests', 'menu-companion', 'mw-open']) expect(keys).toContain(key);
    expect(keys).not.toContain('party-open');
    expect(keys.some((key: string) => /arena/.test(key))).toBe(false);
    expect(new Set(keys).size).toBe(keys.length);
  });
  test('메뉴 배치 키는 명시 키 → 탭 → id → 기존 클래스 순서로 정한다', () => {
    const button = (props: any) => ({ dataset: {}, id: '', classList: { contains: () => false }, ...props });
    expect(menuKey(button({ dataset: { menuKey: 'menu-forge' } }))).toBe('menu-forge');
    expect(menuKey(button({ dataset: { tab: 'stage' } }))).toBe('tab:stage');
    expect(menuKey(button({ id: 'btn-daily' }))).toBe('btn-daily');
    expect(menuKey(button({ classList: { contains: (c: string) => c === 'mw-open' } }))).toBe('mw-open');
    expect(menuKey(button({ id: 'party-open' }))).toBe('party-open');
  });
  test('빠른 메뉴 바 없이 E / I / Q 단축키만 보조 진입으로 남긴다', () => {
    expect(MAPLE_HOTKEYS).toEqual({ KeyE: 'equipment', KeyI: 'inventory', KeyQ: 'quests' });
    expect(readFileSync('src/ui/maple-ui.js', 'utf8')).not.toContain('mpl-quickbar');
  });
});

describe('타이포그래피 정본', () => {
  test('UI 서체는 자체 호스트 한 벌이고 외부 폰트 CDN · 장식 서체를 쓰지 않는다', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    for (const file of [...cssFiles('src'), 'index.html']) {
      const text = readFileSync(file, 'utf8');
      expect(/'Jua'|Black Han Sans|Georgia/.test(text)).toBe(false);
      // 서체 토큰(--font-ui) 정의 밖에서 'Noto Sans KR'을 직접 고정하면 화면마다 기기 기본 서체로 갈라진다(rpg · masterworks · 동행 패널).
      if (file !== 'src/platform/typography.css') expect(/font(-family)?\s*:[^;{}]*'Noto Sans KR'/.test(text)).toBe(false);
    }
    const typography = readFileSync('src/platform/typography.css', 'utf8');
    const urls = [...typography.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]);
    expect(new Set(urls)).toEqual(new Set(['/fonts/blade-sans-kr-400.woff2', '/fonts/blade-sans-kr-700.woff2']));
    for (const url of urls) expect(existsSync('public' + url)).toBe(true);
    expect(existsSync('public/fonts/OFL-blade-sans-kr.txt')).toBe(true);
    expect(readFileSync('public/fonts/OFL-blade-sans-kr.txt', 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
  test('폰트 파일은 문서에 기록한 SHA 와 같다', () => {
    const doc = readFileSync('docs/dungeon-first-lobby.md', 'utf8');
    for (const name of ['blade-sans-kr-400.woff2', 'blade-sans-kr-700.woff2']) {
      const hash = createHash('sha256').update(readFileSync('public/fonts/' + name)).digest('hex');
      expect(doc).toContain(hash);
    }
  });
});
