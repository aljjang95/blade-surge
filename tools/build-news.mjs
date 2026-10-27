// 소식 빌드: content/news/*.md → public/news.json · public/news/**(정적 읽기 페이지) · src/data/news-bundle.json(오프라인 묶음).
// `bun run build` 가 vite build 보다 먼저 돌려서 산출물이 dist 로 복사된다. public/news* 는 생성물이라 Git 에 넣지 않는다.
// src/data/news-bundle.json 은 게임 안 소식 패널의 오프라인·fetch 실패 대비 묶음이라 커밋한다(test/news.test.ts 가 최신인지 검사).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  NEWS_ID_PATTERN, NEWS_LIMITS, NEWS_TYPE_LABELS, dateLabel, escapeHtml, parseFrontMatter, renderMarkdown, sortByDate, sortNews, summarize, validateMeta,
} from '../src/shared/news-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const SITE_ORIGIN = 'https://blade.tllhouse.com';
export const BUNDLE_SIZE = 20;
const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$/;

/** content/news 의 마크다운을 읽어 검증한 글 목록(초안 제외, 최신순)을 돌려준다. 문제가 있으면 한국어 오류. */
export function readNews(dir = path.join(ROOT, 'content/news')) {
  if (!fs.existsSync(dir)) return [];
  const items = [];
  const seen = new Set();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    const label = `content/news/${name}`;
    const match = FILE_PATTERN.exec(name);
    if (!match) throw new Error(`${label}: 파일 이름은 <YYYY-MM-DD>-<slug>.md (slug 는 영문 소문자·숫자·-) 여야 합니다.`);
    const id = name.slice(0, -3);
    if (!NEWS_ID_PATTERN.test(id)) throw new Error(`${label}: 파일 이름이 너무 깁니다(80자 이하).`);
    const { meta: rawMeta, body } = parseFrontMatter(fs.readFileSync(path.join(dir, name), 'utf8'), label);
    const meta = validateMeta(rawMeta, label);
    if (meta.date.slice(0, 10) !== match[1]) throw new Error(`${label}: 파일 이름의 날짜(${match[1]})와 date(${meta.date.slice(0, 10)})가 다릅니다.`);
    if (meta.draft) continue;
    if (!body.trim()) throw new Error(`${label}: 본문이 비어 있습니다.`);
    if (body.length > NEWS_LIMITS.body) throw new Error(`${label}: 본문이 ${NEWS_LIMITS.body}자를 넘습니다.`);
    if (seen.has(id)) throw new Error(`${label}: id 가 중복됩니다.`);
    seen.add(id);
    items.push({
      id, type: meta.type, title: meta.title, date: meta.date, ...(meta.version ? { version: meta.version } : {}),
      pinned: meta.pinned, summary: meta.summary || summarize(body), body, html: renderMarkdown(body), url: `/news/${id}/`,
    });
  }
  return sortByDate(items);
}

const versionOf = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 12);

/** public/news.json 내용. 순수 최신순이고 고정 여부는 pinned 로 알린다(고정 글을 위로 올리는 건 화면 몫). */
export function buildNewsJson(items) {
  const rows = sortByDate(items).map(({ id, type, title, date, version, pinned, summary, body, html, url }) => ({ id, type, title, date, ...(version ? { version } : {}), pinned, summary, body, html, url }));
  return { schema: 'blade-surge.news.v1', version: versionOf(rows), items: rows };
}

/** 게임에 함께 묶이는 오프라인 대비 묶음(최신 BUNDLE_SIZE 개, html 없음 — 화면이 본문을 다시 안전하게 그린다). */
export function buildNewsBundle(items) {
  const rows = sortByDate(items).slice(0, BUNDLE_SIZE).map(({ id, type, title, date, version, pinned, summary, body }) => ({ id, type, title, date, ...(version ? { version } : {}), pinned, summary, body }));
  return { schema: 'blade-surge.news-bundle.v1', version: versionOf(rows), items: rows };
}

const FONT_FACE = `@font-face{font-family:'Blade Sans KR';src:url('/fonts/blade-sans-kr-400.woff2') format('woff2');font-weight:100 599;font-display:swap}
@font-face{font-family:'Blade Sans KR';src:url('/fonts/blade-sans-kr-700.woff2') format('woff2');font-weight:600 1000;font-display:swap}`;

// 게임 톤: 어두운 보랏빛 바탕 + 금빛 포인트(src/style.css 의 --bg/--gold/--txt). 외부 폰트·스크립트·이미지 없음.
const PAGE_CSS = `${FONT_FACE}
:root{color-scheme:dark;--bg:#0b0a12;--panel:#171427;--panel2:#1f1b36;--line:rgba(255,215,120,.28);--gold:#ffcf5a;--txt:#f4efe6;--muted:#a49ec0;--blue:#4cc3ff;--red:#ff3b5c}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;min-height:100dvh;background:radial-gradient(120% 60% at 50% -10%,#2a2150 0,#0b0a12 62%) no-repeat,var(--bg);color:var(--txt);font:16px/1.7 'Blade Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,-apple-system,sans-serif;word-break:keep-all;overflow-wrap:anywhere;-webkit-text-size-adjust:100%}
a{color:var(--blue)}
.wrap{max-width:720px;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 18px}
.brand{font-weight:900;letter-spacing:.12em;font-size:14px;color:var(--gold);text-decoration:none}
.brand span{color:var(--txt)}
.play{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:10px;background:linear-gradient(#ffcf5a,#ff9a1f);color:#2a1700;font-weight:900;font-size:14px;text-decoration:none;box-shadow:0 3px 0 rgba(0,0,0,.35)}
h1{margin:6px 0 8px;font-size:clamp(22px,6vw,30px);line-height:1.3;font-weight:900}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--muted);font-size:13px;margin-bottom:6px}
.tag{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--gold);font-size:12px;font-weight:800}
.tag.pin{color:var(--red);border-color:rgba(255,59,92,.45)}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:18px 18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.body h2{margin:26px 0 8px;font-size:18px;color:var(--gold);padding-bottom:6px;border-bottom:1px solid var(--line)}
.body h3{margin:20px 0 6px;font-size:16px}
.body p{margin:10px 0}
.body ul,.body ol{margin:8px 0;padding-left:22px}
.body li{margin:5px 0}
.body strong{color:#fff3cf}
.list{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.item a.row{display:block;text-decoration:none;color:inherit;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.item a.row:hover,.item a.row:focus-visible{border-color:var(--gold);outline:none}
.item h2{margin:6px 0 4px;font-size:17px;line-height:1.35}
.item p{margin:0;color:#d6d0e8;font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.chips label{min-height:44px;display:inline-flex;align-items:center;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);font-weight:800;font-size:14px;cursor:pointer}
.f{position:absolute;opacity:0;pointer-events:none}
#f-all:checked~.chips [for=f-all],#f-notice:checked~.chips [for=f-notice],#f-patch:checked~.chips [for=f-patch],#f-devnote:checked~.chips [for=f-devnote]{background:var(--gold);color:#2a1700;border-color:var(--gold)}
#f-notice:checked~.list .item:not([data-type=notice]),#f-patch:checked~.list .item:not([data-type=patch]),#f-devnote:checked~.list .item:not([data-type=devnote]){display:none}
.f:focus-visible~.chips label{outline:2px solid var(--blue)}
.nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);text-decoration:none;font-weight:800;font-size:14px;color:var(--txt)}
.foot{margin-top:28px;color:var(--muted);font-size:12px;text-align:center}
@media(max-width:380px){.card{padding:14px}.top{flex-wrap:wrap}}`;

const head = ({ title, description, url, type = 'website' }) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0a12">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<link rel="icon" href="/img/icon.png">
<meta property="og:site_name" content="Blade Surge">
<meta property="og:type" content="${type}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${SITE_ORIGIN}/img/icon.png">
<meta name="twitter:card" content="summary">
<style>${PAGE_CSS}</style>`;

const topBar = '<header class="top"><a class="brand" href="/news/">BLADE <span>SURGE · 소식</span></a><a class="play" href="/">게임 하러 가기</a></header>';
const foot = '<p class="foot">BLADE SURGE · blade.tllhouse.com</p>';

function tags(item) {
  return `<span class="tag">${escapeHtml(NEWS_TYPE_LABELS[item.type])}</span>${item.version ? `<span class="tag">v${escapeHtml(item.version)}</span>` : ''}${item.pinned ? '<span class="tag pin">고정</span>' : ''}`;
}

/** 글 한 편의 정적 읽기 페이지. */
export function renderArticlePage(item, { newer = null, older = null } = {}) {
  const url = `${SITE_ORIGIN}${item.url}`;
  const link = (other, label) => other ? `<a href="${escapeHtml(other.url)}">${label} ${escapeHtml(other.title)}</a>` : '';
  const nav = [link(newer, '다음 글 ▸'), link(older, '◂ 이전 글')].filter(Boolean).join('');
  return `<!doctype html>
<html lang="ko">
<head>
${head({ title: `${item.title} · 블레이드 서지 소식`, description: item.summary, url, type: 'article' })}
</head>
<body>
<div class="wrap">
${topBar}
<main>
<div class="meta">${tags(item)}<time datetime="${escapeHtml(item.date)}">${escapeHtml(dateLabel(item.date))}</time></div>
<h1>${escapeHtml(item.title)}</h1>
<article class="card body">
${item.html}
</article>
<nav class="nav" aria-label="소식 이동"><a href="/news/">소식 목록</a>${nav}</nav>
</main>
${foot}
</div>
</body>
</html>
`;
}

/** 목록 페이지. 분류 칩은 스크립트 없이 라디오 + CSS 로 거른다. */
export function renderIndexPage(items) {
  const ordered = sortNews(items);
  const rows = ordered.map((item) => `<li class="item" data-type="${escapeHtml(item.type)}"><a class="row" href="${escapeHtml(item.url)}"><div class="meta">${tags(item)}<time datetime="${escapeHtml(item.date)}">${escapeHtml(dateLabel(item.date))}</time></div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p></a></li>`).join('\n');
  const radios = [['all', '전체'], ['notice', '공지'], ['patch', '패치노트'], ['devnote', '개발 노트']];
  return `<!doctype html>
<html lang="ko">
<head>
${head({ title: '소식 · 블레이드 서지', description: '블레이드 서지의 공지, 패치노트, 개발 노트를 모아 두었어요.', url: `${SITE_ORIGIN}/news/` })}
</head>
<body>
<div class="wrap">
${topBar}
<main>
<h1>소식</h1>
<p class="meta">공지, 패치노트, 개발 노트를 모아 두었어요.</p>
${radios.map(([id], index) => `<input class="f" type="radio" name="f" id="f-${id}"${index === 0 ? ' checked' : ''}>`).join('')}
<div class="chips" role="group" aria-label="분류">${radios.map(([id, label]) => `<label for="f-${id}">${label}</label>`).join('')}</div>
<ul class="list">
${rows || '<li class="item"><p>아직 올라온 소식이 없어요.</p></li>'}
</ul>
</main>
${foot}
</div>
</body>
</html>
`;
}

/** 생성물을 디스크에 쓴다. public/news(폴더 전체가 생성물)는 매번 새로 만든다. */
export function writeNews({ root = ROOT, items = readNews(path.join(root, 'content/news')) } = {}) {
  const publicDir = path.join(root, 'public');
  const newsDir = path.join(publicDir, 'news');
  fs.rmSync(newsDir, { recursive: true, force: true });
  fs.mkdirSync(newsDir, { recursive: true });
  const ordered = sortByDate(items);
  ordered.forEach((item, index) => {
    const dir = path.join(newsDir, item.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderArticlePage(item, { newer: ordered[index - 1] || null, older: ordered[index + 1] || null }));
  });
  fs.writeFileSync(path.join(newsDir, 'index.html'), renderIndexPage(ordered));
  const json = buildNewsJson(ordered);
  fs.writeFileSync(path.join(publicDir, 'news.json'), `${JSON.stringify(json)}\n`);
  const bundle = buildNewsBundle(ordered);
  const bundlePath = path.join(root, 'src/data/news-bundle.json');
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 1)}\n`);
  return { items: ordered.length, version: json.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = writeNews();
    console.log(`news: ${result.items}편, 버전 ${result.version}`);
  } catch (error) {
    console.error(`news 빌드 실패: ${error.message}`);
    process.exit(1);
  }
}
