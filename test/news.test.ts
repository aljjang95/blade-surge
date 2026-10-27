import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  advanceLastRead, dateLabel, escapeHtml, filterNews, normalizeDate, normalizeNewsItem, normalizeNewsList, parseFrontMatter, renderInline, renderMarkdown,
  safeHref, sortByDate, sortNews, summarize, unreadCount, validateMeta,
} from '../src/shared/news-core.js';
import { buildNewsBundle, buildNewsJson, readNews, renderArticlePage, renderIndexPage, writeNews } from '../tools/build-news.mjs';

const item = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, type: 'notice', title: id, date: `${date}T00:00:00+09:00`, pinned: false, summary: id, body: id, ...extra });

describe('머리말 파서', () => {
  test('머리말과 본문을 나누고 따옴표·불리언을 읽는다', () => {
    const { meta, body } = parseFrontMatter('---\ntype: patch\ntitle: "1.0.3 패치"\ndate: 2026-10-27\nversion: 1.0.3\npinned: true\n---\n\n본문 첫 줄\n둘째 줄\n', '시험');
    expect(meta).toEqual({ type: 'patch', title: '1.0.3 패치', date: '2026-10-27', version: '1.0.3', pinned: true });
    expect(body).toBe('본문 첫 줄\n둘째 줄');
  });
  test('CRLF 와 BOM 을 받아들인다', () => {
    expect(parseFrontMatter('﻿---\r\ntype: notice\r\ntitle: 가\r\ndate: 2026-10-27\r\n---\r\n내용\r\n').body).toBe('내용');
  });
  test('머리말이 없거나 알 수 없는 키·중복 키는 오류', () => {
    expect(() => parseFrontMatter('본문만')).toThrow('머리말');
    expect(() => parseFrontMatter('---\ntype: notice\ntitel: 오탈자\n---\n본문')).toThrow('알 수 없는 머리말 키');
    expect(() => parseFrontMatter('---\ntype: notice\ntype: patch\n---\n본문')).toThrow('중복');
  });
  test('검증: 분류·날짜·패치 버전 규칙', () => {
    expect(validateMeta({ type: 'notice', title: '가', date: '2026-10-27' }).date).toBe('2026-10-27T00:00:00+09:00');
    expect(() => validateMeta({ type: 'news', title: '가', date: '2026-10-27' })).toThrow('type');
    expect(() => validateMeta({ type: 'patch', title: '가', date: '2026-10-27' })).toThrow('version');
    expect(() => validateMeta({ type: 'notice', title: '가', date: '2026-10-27', version: '1.0.0' })).toThrow('패치노트에만');
    expect(() => validateMeta({ type: 'notice', title: '가', date: '2026-02-30' })).toThrow('date');
    expect(() => validateMeta({ type: 'notice', title: '가', date: '2026-10-27T10:00:00Z' })).toThrow('date');
    expect(() => validateMeta({ type: 'notice', title: '가', date: '2026-10-27', pinned: 'yes' as any })).toThrow('pinned');
  });
  test('날짜 정규화와 한글 표기', () => {
    expect(normalizeDate('2026-10-26T05:00+09:00')).toBe('2026-10-26T05:00:00+09:00');
    expect(normalizeDate('26-10-26')).toBeNull();
    expect(dateLabel('2026-10-26T05:00:00+09:00')).toBe('2026년 10월 26일');
  });
});

describe('마크다운 변환과 XSS', () => {
  test('제목은 h2·h3, 목록·굵게·링크를 변환한다', () => {
    const html = renderMarkdown('# 큰\n## 중간\n### 작은\n- 하나 **굵게**\n- 둘 [링크](https://example.com/a?b=1&c=2)\n\n1. 첫째\n2. 둘째\n\n문단 한 줄\n이어지는 줄');
    expect(html).toContain('<h2>큰</h2>');
    expect(html).toContain('<h2>중간</h2>');
    expect(html).toContain('<h3>작은</h3>');
    expect(html).toContain('<ul><li>하나 <strong>굵게</strong></li><li>둘 <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">링크</a></li></ul>');
    expect(html).toContain('<ol><li>첫째</li><li>둘째</li></ol>');
    expect(html).toContain('<p>문단 한 줄 이어지는 줄</p>');
  });
  test('HTML 태그·속성·이벤트 핸들러는 전부 이스케이프된다', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n- <b>목록</b> "따옴표" \'작은\'\n\n## <i>제목</i>');
    expect(html).not.toMatch(/<script|<img|<b>|<i>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;따옴표&quot; &#39;작은&#39;');
  });
  test('javascript:·data:·상대·프로토콜 상대 링크는 글자만 남기고 막는다', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x', '//evil.example/x', '/news/x', 'ftp://example.com/a']) {
      const html = renderInline(`[누르세요](${url})`);
      expect(html).not.toMatch(/<a|href/);
      expect(html).toContain('누르세요');
    }
    expect(renderInline('[누르세요](https://exa mple.com)')).not.toContain('<a');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    expect(safeHref('https://example.com/a b')).toBeNull();
  });
  test('링크 글자 안의 HTML 과 따옴표 주소는 속성을 깨지 못한다', () => {
    const html = renderInline('[<b>x</b>](https://example.com/" onmouseover="alert(1))');
    expect(html).not.toContain('onmouseover="');
    expect(html).not.toContain('<b>');
    const ok = renderInline('[a](https://example.com/%22onmouseover=1)');
    expect(ok).toContain('href="https://example.com/%22onmouseover=1"');
  });
  test('escapeHtml 은 기본 위험 문자를 모두 바꾼다', () => {
    expect(escapeHtml('<>&"\'`')).toBe('&lt;&gt;&amp;&quot;&#39;&#96;');
  });
  test('요약: 첫 문단 또는 목록 항목, 길면 말줄임', () => {
    expect(summarize('## 제목\n\n첫 문단 **굵게** [링크](https://a.com)\n\n둘째')).toBe('첫 문단 굵게 링크');
    expect(summarize('## 새 콘텐츠\n- 가\n- 나')).toBe('가 · 나');
    expect(summarize('가'.repeat(100), 10)).toBe('가'.repeat(9) + '…');
  });
});

describe('정렬·고정·분류', () => {
  const list = [item('a', '2026-10-20'), item('b', '2026-10-25', { pinned: true }), item('c', '2026-10-27'), item('d', '2026-10-01', { pinned: true })];
  test('고정 글이 먼저이고 각 묶음은 최신순', () => {
    expect(sortNews(list).map((row) => row.id)).toEqual(['b', 'd', 'c', 'a']);
  });
  test('순수 최신순은 고정과 무관', () => {
    expect(sortByDate(list).map((row) => row.id)).toEqual(['c', 'b', 'a', 'd']);
  });
  test('같은 날짜는 id 역순이고 입력 배열은 바뀌지 않는다', () => {
    const same = [item('a', '2026-10-27'), item('b', '2026-10-27')];
    expect(sortByDate(same).map((row) => row.id)).toEqual(['b', 'a']);
    expect(same.map((row) => row.id)).toEqual(['a', 'b']);
  });
  test('분류 탭 필터', () => {
    const rows = [item('a', '2026-10-20', { type: 'patch' }), item('b', '2026-10-21'), item('c', '2026-10-22', { type: 'devnote' })];
    expect(filterNews(rows, 'patch').map((row: any) => row.id)).toEqual(['a']);
    expect(filterNews(rows, 'all')).toHaveLength(3);
    expect(filterNews(rows, '')).toHaveLength(3);
  });
});

describe('안 읽은 표시', () => {
  const rows = [item('old', '2026-10-20'), item('mid', '2026-10-24', { pinned: true }), item('new', '2026-10-27')];
  test('마지막으로 읽은 글보다 새로운 글만 센다', () => {
    expect(unreadCount(rows, 'new')).toBe(0);
    expect(unreadCount(rows, 'mid')).toBe(1);
    expect(unreadCount(rows, 'old')).toBe(2);
  });
  test('읽은 기록이 없거나 목록에서 사라졌으면 전부 새 글, 빈 목록은 0', () => {
    expect(unreadCount(rows, null)).toBe(3);
    expect(unreadCount(rows, 'gone')).toBe(3);
    expect(unreadCount([], null)).toBe(0);
  });
  test('읽으면 더 새로운 쪽으로만 전진한다', () => {
    expect(advanceLastRead(rows, null, 'mid')).toBe('mid');
    expect(advanceLastRead(rows, 'mid', 'old')).toBe('mid');
    expect(advanceLastRead(rows, 'mid', 'new')).toBe('new');
    expect(advanceLastRead(rows, 'mid', 'unknown')).toBe('mid');
  });
});

describe('외부 데이터 검증', () => {
  test('올바른 글은 통과하고 요약이 없으면 본문에서 만든다', () => {
    const ok = normalizeNewsItem({ id: 'x-1', type: 'patch', title: '제목', date: '2026-10-27', version: '1.0.3', body: '본문이에요.' });
    expect(ok).toMatchObject({ id: 'x-1', type: 'patch', date: '2026-10-27T00:00:00+09:00', version: '1.0.3', pinned: false, summary: '본문이에요.' });
  });
  test('나쁜 id·분류·날짜·긴 본문·이상한 버전은 버린다', () => {
    const base = { id: 'x', type: 'notice', title: '제목', date: '2026-10-27', body: '본문' };
    expect(normalizeNewsItem({ ...base, id: '../etc' })).toBeNull();
    expect(normalizeNewsItem({ ...base, id: 'A' })).toBeNull();
    expect(normalizeNewsItem({ ...base, type: 'ad' })).toBeNull();
    expect(normalizeNewsItem({ ...base, date: 'tomorrow' })).toBeNull();
    expect(normalizeNewsItem({ ...base, body: 'x'.repeat(20001) })).toBeNull();
    expect(normalizeNewsItem({ ...base, version: '<b>' })).toBeNull();
    expect(normalizeNewsItem(null)).toBeNull();
  });
  test('목록: 모양이 틀리면 빈 배열, 중복 id 는 하나만', () => {
    expect(normalizeNewsList(null)).toEqual([]);
    expect(normalizeNewsList({ items: 'x' })).toEqual([]);
    const good = { id: 'a', type: 'notice', title: '가', date: '2026-10-27', body: '나' };
    expect(normalizeNewsList({ items: [good, good, { id: 'bad id' }] })).toHaveLength(1);
  });
});

describe('빌드 산출', () => {
  const write = (dir: string, name: string, text: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), text); };
  const post = (type: string, title: string, date: string, extra = '', body = '본문이에요.') => `---\ntype: ${type}\ntitle: ${title}\ndate: ${date}\n${extra}---\n${body}\n`;

  test('저장소의 content/news 는 모두 올바르고 첫 글 3개가 있다', () => {
    const items = readNews();
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(new Set(items.map((row: any) => row.type))).toEqual(new Set(['notice', 'patch', 'devnote']));
    const patch = items.find((row: any) => row.type === 'patch');
    expect(patch.version).toMatch(/^\d+\.\d+\.\d+$/);
    // 약속·결제 문구를 쓰지 않는다.
    for (const row of items) expect(row.body).not.toMatch(/결제|가격|원\b|무료로 드|보장/);
  });

  test('news.json 은 최신순이고 고정·버전·본문 HTML 을 담는다', () => {
    const json = buildNewsJson(readNews());
    expect(json.schema).toBe('blade-surge.news.v1');
    expect(json.version).toMatch(/^[0-9a-f]{12}$/);
    const dates = json.items.map((row: any) => Date.parse(row.date));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    const season: any = json.items.find((row: any) => row.id.endsWith('season-1-start'));
    expect(season.pinned).toBe(true);
    expect(season.html).toContain('<h2>');
    expect(season.url).toBe('/news/' + season.id + '/');
  });

  test('오프라인 묶음은 html 없이 최신 20개 이하', () => {
    const bundle = buildNewsBundle(readNews());
    expect(bundle.items.length).toBeLessThanOrEqual(20);
    for (const row of bundle.items) expect(Object.keys(row)).not.toContain('html');
    expect(normalizeNewsList(bundle)).toHaveLength(bundle.items.length);
  });

  test('커밋된 오프라인 묶음이 content/news 와 같다(다르면 node tools/build-news.mjs 를 다시 돌린다)', () => {
    const committed = JSON.parse(readFileSync(new URL('../src/data/news-bundle.json', import.meta.url), 'utf8'));
    expect(committed).toEqual(buildNewsBundle(readNews()));
  });

  test('글 페이지: 이스케이프·OG 메타·모바일 viewport, 외부 스크립트·폰트 없음', () => {
    const [first] = readNews();
    const page = renderArticlePage({ ...first, title: '<script>x</script> "제목"', summary: '요약 "따옴표"' });
    expect(page).not.toContain('<script');
    expect(page).toContain('&lt;script&gt;x&lt;/script&gt; &quot;제목&quot;');
    expect(page).toContain('<meta property="og:title"');
    expect(page).toContain('<meta property="og:description" content="요약 &quot;따옴표&quot;">');
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
    expect(page).not.toMatch(/https?:\/\/(?!blade\.tllhouse\.com)[^"' )]*\.(js|css|woff2?)/);
    expect(page).not.toContain('fonts.googleapis.com');
  });

  test('목록 페이지는 고정 글을 위에 둔다', () => {
    const page = renderIndexPage(readNews());
    expect(page.indexOf('season-1-start')).toBeLessThan(page.indexOf('patch-1-0-3'));
    expect(page).toContain('data-type="patch"');
  });

  test('writeNews 가 정적 페이지·news.json·묶음을 쓰고 초안은 뺀다', () => {
    const root = mkdtempSync(join(tmpdir(), 'news-'));
    try {
      const dir = join(root, 'content/news');
      write(dir, '2026-10-20-first.md', post('notice', '첫 글', '2026-10-20'));
      write(dir, '2026-10-21-second.md', post('patch', '둘째', '2026-10-21T09:00:00+09:00', 'version: 1.2.3\n'));
      write(dir, '2026-10-22-draft.md', post('notice', '초안', '2026-10-22', 'draft: true\n'));
      const result = writeNews({ root });
      expect(result.items).toBe(2);
      expect(existsSync(join(root, 'public/news/index.html'))).toBe(true);
      expect(existsSync(join(root, 'public/news/2026-10-21-second/index.html'))).toBe(true);
      expect(existsSync(join(root, 'public/news/2026-10-22-draft'))).toBe(false);
      const json = JSON.parse(readFileSync(join(root, 'public/news.json'), 'utf8'));
      expect(json.items.map((row: any) => row.id)).toEqual(['2026-10-21-second', '2026-10-20-first']);
      expect(existsSync(join(root, 'src/data/news-bundle.json'))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('나쁜 파일 이름·날짜 불일치·빈 본문은 빌드 오류', () => {
    const root = mkdtempSync(join(tmpdir(), 'news-bad-'));
    try {
      const dir = join(root, 'content/news');
      write(dir, 'no-date.md', post('notice', '가', '2026-10-20'));
      expect(() => readNews(dir)).toThrow('파일 이름');
      rmSync(dir, { recursive: true });
      write(dir, '2026-10-20-x.md', post('notice', '가', '2026-10-21'));
      expect(() => readNews(dir)).toThrow('날짜');
      rmSync(dir, { recursive: true });
      write(dir, '2026-10-20-x.md', post('notice', '가', '2026-10-20', '', ''));
      expect(() => readNews(dir)).toThrow('본문이 비어');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('게임 안 소식 상태(news-state)', () => {
  const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, map }; };
  const json = { schema: 'x', version: 'v1', items: [{ id: 'a', type: 'notice', title: '가', date: '2026-10-26', body: '나', pinned: true }, { id: 'b', type: 'patch', title: '다', date: '2026-10-27', version: '1.0.3', body: '라' }] };
  const bundle = { version: 'bundle-1', items: [{ id: 'old', type: 'devnote', title: '저장본', date: '2026-10-20', body: '본문' }] };
  const ok = (body: unknown) => async () => ({ ok: true, json: async () => body }) as any;

  test('읽은 글 id 는 UI 전용 키에 저장되고 이상한 값·막힌 저장소는 무시한다', async () => {
    const { readLastRead, writeLastRead, NEWS_LAST_READ_KEY } = await import('../src/ui/news-state.js');
    const store: any = memory();
    expect(readLastRead(store)).toBeNull();
    expect(writeLastRead('2026-10-27-patch-1-0-3', store)).toBe(true);
    expect(store.map.get(NEWS_LAST_READ_KEY)).toBe('2026-10-27-patch-1-0-3');
    expect(readLastRead(store)).toBe('2026-10-27-patch-1-0-3');
    store.map.set(NEWS_LAST_READ_KEY, '<img onerror=1>');
    expect(readLastRead(store)).toBeNull();
    expect(writeLastRead('../x', store)).toBe(false);
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(readLastRead(blocked as any)).toBeNull();
    expect(writeLastRead('ok-id', blocked as any)).toBe(false);
  });

  test('정상 응답이면 network, 실패·빈 목록·잘못된 모양이면 오프라인 묶음으로 내려간다', async () => {
    const { loadNews } = await import('../src/ui/news-state.js');
    const loadBundle = async () => bundle;
    expect(await loadNews({ fetchImpl: ok(json) as any, loadBundle })).toMatchObject({ source: 'network', version: 'v1' });
    expect((await loadNews({ fetchImpl: (async () => { throw new Error('offline'); }) as any, loadBundle })).source).toBe('bundle');
    expect((await loadNews({ fetchImpl: (async () => ({ ok: false })) as any, loadBundle })).source).toBe('bundle');
    expect((await loadNews({ fetchImpl: ok({ items: [] }) as any, loadBundle })).source).toBe('bundle');
    // SPA 폴백이 index.html 을 돌려주면 json() 이 실패한다.
    expect((await loadNews({ fetchImpl: (async () => ({ ok: true, json: async () => { throw new SyntaxError('html'); } })) as any, loadBundle })).source).toBe('bundle');
    const none = await loadNews({ fetchImpl: (async () => { throw new Error('offline'); }) as any, loadBundle: async () => { throw new Error('no bundle'); } });
    expect(none).toEqual({ items: [], source: 'none', version: null });
  });

  test('응답이 멈추면 시간 초과로 오프라인 묶음을 쓴다', async () => {
    const { loadNews } = await import('../src/ui/news-state.js');
    const hang = ((_url: string, init: any) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as any;
    const result = await loadNews({ fetchImpl: hang, timeoutMs: 20, loadBundle: async () => bundle });
    expect(result.source).toBe('bundle');
  });

  test('패널 행: 탭 필터, 고정 먼저, 안 읽은 글 표시', async () => {
    const { panelRows } = await import('../src/ui/news-state.js');
    const items = normalizeNewsList(json);
    const all = panelRows(items, 'all', 'a');
    expect(all.map((row: any) => [row.id, row.unread])).toEqual([['a', false], ['b', true]]);
    expect(panelRows(items, 'patch', null).map((row: any) => row.id)).toEqual(['b']);
    expect(panelRows(items, 'devnote', null)).toEqual([]);
    expect(panelRows(items, 'all', null).every((row: any) => row.unread)).toBe(true);
  });

  test('앱은 정식 호스트 절대 주소로 글을 연다', async () => {
    const { articleHref } = await import('../src/ui/news-state.js');
    expect(articleHref('a-1', '')).toBe('/news/a-1/');
    expect(articleHref('a-1', 'https://blade.tllhouse.com')).toBe('https://blade.tllhouse.com/news/a-1/');
  });
});
