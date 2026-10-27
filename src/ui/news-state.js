// 게임 안 '소식' 패널의 상태 규칙(DOM 없음): 읽은 글 기억, 불러오기(네트워크 → 오프라인 묶음), 탭별 행 만들기.
// 게임 세이브 스키마는 건드리지 않고 UI 전용 localStorage 키 하나만 쓴다(저장소가 막혀도 이번 접속에서만 기억한다).
import { NEWS_ID_PATTERN, filterNews, normalizeNewsList, sortNews, unreadIds } from '../shared/news-core.js';

export const NEWS_LAST_READ_KEY = 'blade-surge:news:last-read:v1';
export const NEWS_FETCH_TIMEOUT_MS = 6000;
export const NEWS_STALE_MS = 5 * 60 * 1000;
export const NEWS_TABS = Object.freeze([
  Object.freeze({ id: 'all', label: '전체' }),
  Object.freeze({ id: 'notice', label: '공지' }),
  Object.freeze({ id: 'patch', label: '패치노트' }),
  Object.freeze({ id: 'devnote', label: '개발 노트' }),
]);

const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** 마지막으로 읽은 글 id. 저장소가 막혔거나 값이 이상하면 null. */
export function readLastRead(storage = defaultStorage()) {
  try {
    const value = storage?.getItem(NEWS_LAST_READ_KEY);
    return typeof value === 'string' && NEWS_ID_PATTERN.test(value) ? value : null;
  } catch { return null; }
}

/** 읽은 글 id 를 저장한다. 저장하지 못하면 false(이번 접속 동안만 메모리에 있다). */
export function writeLastRead(id, storage = defaultStorage()) {
  if (typeof id !== 'string' || !NEWS_ID_PATTERN.test(id)) return false;
  try { storage?.setItem(NEWS_LAST_READ_KEY, id); return !!storage; } catch { return false; }
}

/**
 * 소식을 불러온다. 정식 news.json 을 먼저 받고, 못 받으면(오프라인·시간 초과·잘못된 응답) 빌드에 포함된 묶음을 쓴다.
 * @param {{ fetchImpl?: typeof fetch, url?: string, timeoutMs?: number, loadBundle?: () => Promise<unknown> }} [options]
 * @returns {Promise<{ items: any[], source: 'network' | 'bundle' | 'none', version: string | null }>}
 */
export async function loadNews({ fetchImpl = globalThis.fetch?.bind(globalThis), url = '/news.json', timeoutMs = NEWS_FETCH_TIMEOUT_MS, loadBundle = async () => (await import('../data/news-bundle.json')).default } = {}) {
  let timer = 0;
  try {
    if (typeof fetchImpl !== 'function') throw new Error('fetch 없음');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchImpl(url, { cache: 'no-cache', credentials: 'omit', ...(controller ? { signal: controller.signal } : {}) });
    if (!response || !response.ok) throw new Error('응답 오류');
    const json = await response.json();
    const items = normalizeNewsList(json);
    if (!items.length) throw new Error('빈 목록');
    return { items, source: 'network', version: typeof json.version === 'string' ? json.version : null };
  } catch { /* 아래 오프라인 묶음으로 */ } finally { if (timer) clearTimeout(timer); }
  try {
    const bundle = await loadBundle();
    const items = normalizeNewsList(bundle);
    if (items.length) return { items, source: 'bundle', version: typeof bundle?.version === 'string' ? bundle.version : null };
  } catch { /* 묶음도 없으면 빈 상태 */ }
  return { items: [], source: 'none', version: null };
}

/** 탭에 맞춰 거르고(고정 글 먼저, 최신순) 안 읽은 표시를 붙인 행. */
export function panelRows(items, tab, lastReadId) {
  const fresh = unreadIds(items, lastReadId);
  return sortNews(filterNews(items, tab)).map((item) => ({ ...item, unread: fresh.has(item.id) }));
}

/** 글 id 의 정식 주소(앱은 정식 호스트 절대 주소). */
export function articleHref(id, base = '') {
  return `${base}/news/${encodeURIComponent(id)}/`;
}
