// 게임 안 '소식' 패널: 로비 메뉴의 '소식' 버튼 + 안 읽은 점, 분류 탭(전체·공지·패치노트·개발 노트), 목록, 본문.
// 정본은 content/news/*.md(tools/build-news.mjs). 글 본문은 마크다운을 이 화면이 다시 안전하게 그린다(src/shared/news-core.js).
// 플레이 영역을 가리지 않도록 로비에서만 열리는 모달(dialog)이고, 게임 세이브·전투 상태는 건드리지 않는다.
import { NEWS_TYPE_LABELS, advanceLastRead, dateLabel, renderMarkdown, unreadCount } from '../shared/news-core.js';
import { apiBase } from '../platform/api-base.js';
import { NEWS_STALE_MS, NEWS_TABS, articleHref, loadNews, panelRows, readLastRead, writeLastRead } from './news-state.js';
import './news.css';

const START_DELAY_MS = 2500;
const n = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const button = (text, fn, cls = '') => { const e = n('button', cls, text); e.type = 'button'; e.addEventListener('click', fn); return e; };

export class NewsView {
  /** @param {any} app */
  constructor(app) {
    this.app = app;
    this.items = [];
    this.source = 'none';
    this.loaded = false;
    this.loading = false;
    this.loadedAt = 0;
    this.tab = 'all';
    this.openId = null;
    this.lastRead = readLastRead();
    this.dialog = n('dialog', 'news-dialog');
    this.dialog.id = 'news-dialog';
    this.dialog.setAttribute('aria-labelledby', 'news-title');
    const header = n('header', 'news-header');
    this.title = n('h2', '', '소식');
    this.title.id = 'news-title';
    this.back = button('← 목록', () => this.showList(), 'news-back');
    this.back.hidden = true;
    header.append(this.back, this.title, button('닫기', () => this.close(), 'news-close'));
    this.tabs = n('nav', 'news-tabs');
    this.tabs.setAttribute('aria-label', '소식 분류');
    this.tabs.setAttribute('role', 'tablist');
    this.notice = n('p', 'news-notice');
    this.notice.setAttribute('role', 'status');
    this.content = n('div', 'news-content');
    this.dialog.append(header, this.tabs, this.notice, this.content);
    document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => this.trigger?.isConnected && this.trigger.focus?.({ preventScroll: true }));

    // 로비 입구: 다른 보조 입구처럼 .lobby-left 에 붙이면 OathShell 이 메뉴 묶음으로 옮긴다(menuKey 로 위치 지정).
    this.lobby = button('', (event) => this.open(event.currentTarget), 'sq-btn news-open');
    this.lobby.dataset.menuKey = 'news-open';
    this.lobby.append(n('span', '', '소식'));
    this.dot = n('em', 'dot');
    this.dot.setAttribute('aria-hidden', 'true');
    this.lobby.append(this.dot);
    document.querySelector('.lobby-left')?.append(this.lobby);

    this.startTimer = setTimeout(() => { void this.refresh(); }, START_DELAY_MS);
  }

  get unread() { return unreadCount(this.items, this.lastRead); }

  /** 소식을 다시 받아 오고 안 읽은 점을 갱신한다. 실패해도 게임에는 영향이 없다. */
  async refresh(force = false) {
    if (this.loading || (!force && this.loaded && Date.now() - this.loadedAt < NEWS_STALE_MS)) return;
    this.loading = true;
    try {
      const result = await loadNews({ url: `${apiBase()}/news.json` });
      this.items = result.items;
      this.source = result.source;
    } catch { this.items = []; this.source = 'none'; }
    this.loading = false;
    this.loaded = true;
    this.loadedAt = Date.now();
    this.syncDot();
    if (this.dialog.open) this.render();
  }

  syncDot() {
    const count = this.unread;
    this.dot.classList.toggle('on', count > 0);
    this.lobby.setAttribute('aria-label', count > 0 ? `소식, 새 글 ${count}개` : '소식');
    // 메뉴 버튼의 빨간 점은 meta 가 센다(다른 알림과 같은 자리).
    this.app?.meta?.refreshMenuBadge?.();
  }

  canOpen() {
    const app = this.app;
    return !app || (app.mode === 'lobby' && !app.stageStarting && !app.contextLost);
  }

  open(trigger = null) {
    if (!this.canOpen()) return;
    this.trigger = trigger;
    this.openId = null;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    void this.refresh();
  }

  close() { if (this.dialog.open) this.dialog.close(); }

  showList() {
    this.openId = null;
    this.render();
    this.content.scrollTop = 0;
  }

  openArticle(id) {
    const item = this.items.find((row) => row.id === id);
    if (!item) return;
    this.openId = id;
    // 글을 열면 그 글(과 그보다 오래된 글)을 읽은 것으로 본다.
    this.lastRead = advanceLastRead(this.items, this.lastRead, id);
    writeLastRead(this.lastRead);
    this.syncDot();
    this.render();
    this.content.scrollTop = 0;
  }

  render() {
    const reading = this.openId ? this.items.find((row) => row.id === this.openId) : null;
    this.back.hidden = !reading;
    this.tabs.hidden = !!reading;
    this.title.textContent = reading ? NEWS_TYPE_LABELS[reading.type] : '소식';
    this.notice.textContent = this.source === 'bundle' ? '인터넷에 연결되지 않아 저장된 소식을 보여 드려요.' : '';
    this.content.replaceChildren();
    if (reading) { this.renderArticle(reading); return; }
    this.renderTabs();
    this.renderList();
  }

  renderTabs() {
    this.tabs.replaceChildren();
    for (const tab of NEWS_TABS) {
      const b = button(tab.label, () => { this.tab = tab.id; this.render(); }, 'news-tab');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.tab === tab.id));
      this.tabs.append(b);
    }
  }

  renderList() {
    if (!this.loaded) { this.content.append(n('p', 'news-empty', '소식을 불러오는 중이에요…')); return; }
    const rows = panelRows(this.items, this.tab, this.lastRead);
    if (!rows.length) {
      const empty = n('div', 'news-empty');
      if (!this.items.length) {
        empty.append(n('p', '', '소식을 불러오지 못했어요.'), n('p', 'news-sub', '잠시 뒤에 다시 열어 주세요.'), button('다시 불러오기', () => { void this.refresh(true).then(() => this.render()); }, 'news-retry'));
      } else empty.append(n('p', '', '이 분류에는 아직 소식이 없어요.'));
      this.content.append(empty);
      return;
    }
    const list = n('ul', 'news-list');
    for (const row of rows) {
      const li = n('li', 'news-item');
      const open = button('', () => this.openArticle(row.id), 'news-row' + (row.unread ? ' unread' : '') + (row.pinned ? ' pinned' : ''));
      const meta = n('span', 'news-meta');
      meta.append(n('b', `news-tag type-${row.type}`, NEWS_TYPE_LABELS[row.type]));
      if (row.version) meta.append(n('b', 'news-tag', `v${row.version}`));
      if (row.pinned) meta.append(n('b', 'news-tag pin', '고정'));
      if (row.unread) meta.append(n('b', 'news-tag new', 'N'));
      meta.append(n('time', 'news-date', dateLabel(row.date)));
      open.append(meta, n('strong', 'news-row-title', row.title), n('span', 'news-row-sum', row.summary));
      li.append(open);
      list.append(li);
    }
    this.content.append(list);
  }

  renderArticle(item) {
    const meta = n('div', 'news-meta');
    meta.append(n('b', `news-tag type-${item.type}`, NEWS_TYPE_LABELS[item.type]));
    if (item.version) meta.append(n('b', 'news-tag', `v${item.version}`));
    meta.append(n('time', 'news-date', dateLabel(item.date)));
    const body = n('div', 'news-body');
    // 마크다운 변환기는 모든 글자를 이스케이프하고 http(s) 링크만 내므로 innerHTML 에 넣어도 안전하다(test/news.test.ts).
    body.innerHTML = renderMarkdown(item.body);
    const web = n('a', 'news-web', '웹에서 보기');
    web.href = articleHref(item.id, apiBase() || globalThis.location?.origin || '');
    web.target = '_blank';
    web.rel = 'noopener noreferrer';
    this.content.append(meta, n('h3', 'news-article-title', item.title), body, web);
  }

  dispose() {
    clearTimeout(this.startTimer);
    this.close();
    this.dialog.remove();
    this.lobby.remove();
  }
}
