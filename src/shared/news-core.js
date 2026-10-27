// 소식(공지·패치노트·개발 노트) 순수 규칙. 빌드 도구(tools/build-news.mjs)와 게임 안 패널(src/ui/news.js)이 같은 코드를 쓴다.
// DOM·네트워크·저장소를 만지지 않는다. 마크다운은 아주 작은 부분집합(제목·목록·굵게·링크)만 지원하고
// 모든 문자열은 HTML 이스케이프를 거치며 링크는 http(s)만 허용한다(docs/SPEC_720H.md 4A.2).

export const NEWS_TYPES = Object.freeze(['notice', 'patch', 'devnote']);
export const NEWS_TYPE_LABELS = Object.freeze({ notice: '공지', patch: '패치노트', devnote: '개발 노트' });
/** 패치노트 본문 소제목 분류(순서 고정). */
export const PATCH_SECTIONS = Object.freeze(['새 콘텐츠', '개선', '버그 수정', '밸런스']);
export const NEWS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const NEWS_LIMITS = Object.freeze({ title: 120, body: 20000, summary: 200, version: 24, items: 60 });

const FRONT_KEYS = new Set(['type', 'title', 'date', 'version', 'pinned', 'summary', 'draft']);
// 날짜는 KST 기준이다. 날짜만 쓰면 그날 00:00 KST, 시간까지 쓰면 +09:00 오프셋이 필수다.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\+09:00$/;

/** 텍스트·속성값 공용 HTML 이스케이프. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[ch]);
}

/** 날짜 문자열을 `YYYY-MM-DDTHH:MM:SS+09:00` 로 맞춘다. 형식이 틀리면 null. */
export function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let full;
  if (DATE_ONLY.test(text)) full = `${text}T00:00:00+09:00`;
  else if (DATE_TIME.test(text)) full = text.length === 22 ? `${text.slice(0, 16)}:00+09:00` : text;
  else return null;
  const ms = Date.parse(full);
  if (!Number.isFinite(ms)) return null;
  // 2월 30일처럼 Date 가 말아 올리는 날짜를 거른다.
  const back = new Date(ms + 9 * 3600000).toISOString();
  if (back.slice(0, 10) !== full.slice(0, 10)) return null;
  return full;
}

/** `2026-10-26T05:00:00+09:00` → `2026년 10월 26일`. 형식이 틀리면 빈 문자열. */
export function dateLabel(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return match ? `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일` : '';
}

function parseScalar(raw) {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  const quoted = /^(["'])(.*)\1$/.exec(text);
  return quoted ? quoted[2] : text;
}

/**
 * `---` 로 둘러싼 머리말과 본문을 나눈다. 알 수 없는 키·잘못된 값은 오탈자를 놓치지 않도록 오류로 알린다.
 * @param {string} source
 * @param {string} [label] 오류 메시지에 붙일 파일 이름
 * @returns {{ meta: Record<string, any>, body: string }}
 */
export function parseFrontMatter(source, label = '소식') {
  const text = String(source).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${label}: 머리말(--- … ---)이 없습니다.`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep <= 0) throw new Error(`${label}: 머리말 줄을 읽을 수 없습니다: ${line}`);
    const key = line.slice(0, sep).trim();
    if (!FRONT_KEYS.has(key)) throw new Error(`${label}: 알 수 없는 머리말 키 '${key}'`);
    if (Object.hasOwn(meta, key)) throw new Error(`${label}: 머리말 키 '${key}' 가 중복됩니다.`);
    meta[key] = parseScalar(line.slice(sep + 1));
  }
  return { meta, body: match[2].replace(/^\n+/, '').replace(/\s+$/, '') };
}

/** 머리말을 검증해 정규화한 소식 메타를 돌려준다. 문제가 있으면 한국어 오류. */
export function validateMeta(meta, label = '소식') {
  if (!NEWS_TYPES.includes(meta.type)) throw new Error(`${label}: type 은 ${NEWS_TYPES.join('|')} 중 하나여야 합니다.`);
  if (typeof meta.title !== 'string' || !meta.title.trim() || [...meta.title].length > NEWS_LIMITS.title) throw new Error(`${label}: title 은 1~${NEWS_LIMITS.title}자여야 합니다.`);
  const date = normalizeDate(meta.date);
  if (!date) throw new Error(`${label}: date 는 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM:SS+09:00 형식이어야 합니다.`);
  if (meta.type === 'patch') {
    if (typeof meta.version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(meta.version)) throw new Error(`${label}: 패치노트는 version(예: 1.0.3)이 필요합니다.`);
  } else if (meta.version !== undefined) {
    throw new Error(`${label}: version 은 패치노트에만 쓸 수 있습니다.`);
  }
  if (meta.pinned !== undefined && typeof meta.pinned !== 'boolean') throw new Error(`${label}: pinned 는 true 또는 false 여야 합니다.`);
  if (meta.draft !== undefined && typeof meta.draft !== 'boolean') throw new Error(`${label}: draft 는 true 또는 false 여야 합니다.`);
  if (meta.summary !== undefined && (typeof meta.summary !== 'string' || [...meta.summary].length > NEWS_LIMITS.summary)) throw new Error(`${label}: summary 는 ${NEWS_LIMITS.summary}자 이하여야 합니다.`);
  return {
    type: meta.type, title: meta.title.trim(), date,
    ...(meta.version ? { version: meta.version } : {}),
    pinned: meta.pinned === true, draft: meta.draft === true,
    ...(meta.summary ? { summary: meta.summary.trim() } : {}),
  };
}

/** http(s) 주소만 통과시킨다. 통과하면 정규화된 href, 아니면 null. */
export function safeHref(raw) {
  const text = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(text) || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(text)) return null;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
  } catch { return null; }
}

const INLINE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|\*\*([^*\n]{1,300})\*\*/g;

/** 한 줄 안의 굵게·링크를 HTML 로 바꾼다. 나머지 모든 글자는 이스케이프한다. */
export function renderInline(raw) {
  const text = String(raw ?? '');
  let out = '', last = 0;
  for (const match of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(last, match.index));
    if (match[3] !== undefined) out += `<strong>${escapeHtml(match[3])}</strong>`;
    else {
      const href = safeHref(match[2]);
      out += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>` : escapeHtml(match[1]);
    }
    last = match.index + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

/**
 * 마크다운 부분집합 → 안전한 HTML. 페이지 제목이 h1 이라서 `#`/`##` 는 h2, `###` 는 h3 으로 그린다.
 * 지원: 제목, `-`/`*` 목록, `1.` 번호 목록, 문단(줄바꿈은 공백), 굵게, 링크. 그 밖의 문법은 글자 그대로 이스케이프된다.
 */
export function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [], list = null;
  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${renderInline(paragraph.join(' '))}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); const level = Math.max(2, heading[1].length); out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`); continue; }
    if (bullet || ordered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ||= { tag, items: [] };
      list.items.push((bullet || ordered)[1].trim());
      continue;
    }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  return out.join('\n');
}

/** 마크다운 기호를 걷어낸 한 줄 글. */
export function plainText(markdown) {
  return String(markdown ?? '')
    .replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, '$1').replace(/\*\*([^*\n]*)\*\*/g, '$1')
    .replace(/^\s*#{1,3}\s+/gm, '').replace(/^\s*(?:[-*]|\d{1,3}[.)])\s+/gm, '')
    .replace(/\s+/g, ' ').trim();
}

/** 목록 카드에 보일 요약. 첫 문단(없으면 목록 항목들)을 잘라 쓴다. */
export function summarize(markdown, max = 80) {
  const blocks = String(markdown ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  // 제목 줄을 뺀 뒤 내용이 남는 첫 덩어리를 쓴다. 목록이면 항목을 ' · ' 로 잇는다.
  const bodyLines = (block) => block.split('\n').filter((line) => !/^\s*#{1,3}\s/.test(line));
  const first = blocks.map(bodyLines).find((lines) => lines.length) || [];
  const isList = first.length > 0 && first.every((line) => /^\s*(?:[-*]|\d{1,3}[.)])\s/.test(line));
  const text = first.map(plainText).filter(Boolean).join(isList ? ' · ' : ' ');
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

/** 고정 글 먼저, 그다음 최신순(같은 시각이면 id 역순). 원본 배열은 바꾸지 않는다. */
export function sortNews(items) {
  return [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || Date.parse(b.date) - Date.parse(a.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** 고정과 상관없이 순수 최신순. 안 읽은 표시와 news.json 순서가 쓴다. */
export function sortByDate(items) {
  return [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** 분류 탭 필터. type 이 'all' 이거나 비어 있으면 전부. */
export function filterNews(items, type) {
  return !type || type === 'all' ? [...items] : items.filter((item) => item.type === type);
}

/**
 * 마지막으로 읽은 글보다 새로운 글의 id 집합. 읽은 글 id 가 없거나 목록에서 사라졌으면 전부 새 글이다.
 * @param {{id: string, date: string}[]} items
 * @param {string|null|undefined} lastReadId
 */
export function unreadIds(items, lastReadId) {
  const ordered = sortByDate(items);
  const index = lastReadId ? ordered.findIndex((item) => item.id === lastReadId) : -1;
  return new Set((index < 0 ? ordered : ordered.slice(0, index)).map((item) => item.id));
}

/** 안 읽은 글 수(로비 버튼의 빨간 점). */
export function unreadCount(items, lastReadId) {
  return unreadIds(items, lastReadId).size;
}

/** 글을 읽었을 때 저장할 id: 이미 읽은 글과 방금 읽은 글 중 더 새로운 쪽. */
export function advanceLastRead(items, lastReadId, readId) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const read = byId.get(readId);
  if (!read) return lastReadId || null;
  const last = lastReadId ? byId.get(lastReadId) : null;
  if (!last) return read.id;
  return sortByDate([last, read])[0].id;
}

/** 서버·번들에서 온 글 하나를 검증해 게임이 쓰는 모양으로 만든다. 믿을 수 없으면 null. */
export function normalizeNewsItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, type, title, body, version, summary } = raw;
  if (typeof id !== 'string' || !NEWS_ID_PATTERN.test(id)) return null;
  if (!NEWS_TYPES.includes(type)) return null;
  if (typeof title !== 'string' || !title.trim() || [...title].length > NEWS_LIMITS.title) return null;
  const date = normalizeDate(raw.date);
  if (!date) return null;
  if (typeof body !== 'string' || body.length > NEWS_LIMITS.body) return null;
  if (version !== undefined && (typeof version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(version))) return null;
  const clean = typeof summary === 'string' && summary.trim() ? [...summary.trim()].slice(0, NEWS_LIMITS.summary).join('') : summarize(body);
  return { id, type, title: title.trim(), date, ...(version ? { version } : {}), pinned: raw.pinned === true, summary: clean, body };
}

/** news.json 전체를 검증한다. 모양이 틀리면 빈 목록. */
export function normalizeNewsList(json) {
  const rows = json && typeof json === 'object' && Array.isArray(json.items) ? json.items : [];
  const seen = new Set();
  const items = [];
  for (const row of rows.slice(0, NEWS_LIMITS.items)) {
    const item = normalizeNewsItem(row);
    if (item && !seen.has(item.id)) { seen.add(item.id); items.push(item); }
  }
  return items;
}
