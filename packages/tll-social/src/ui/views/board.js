// 소식·제보 게시판(시안 board): 분류 칩 · 글 카드 · 상세 · 글쓰기 · 디스코드
import { button, clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { boardCategory, CATEGORIES, CATEGORY_ORDER, dateTimeText, errorMessage, STATUSES, statusChip } from '../format.js';
import { boardOrder, cleanDiag, diagLines, excerpt } from '../models.js';
import { openReportModal } from './modals.js';

const STATUS_CHOICES = ['open', 'reviewing', 'planned', 'done', 'wontfix'];
const STATUS_LABELS = { open: '접수', reviewing: '검토 중', planned: '반영 예정', done: '반영 완료', wontfix: '답변 완료' };

export function createBoardView(ctx) {
  const { client } = ctx;
  const root = el('div', 'tls-view');
  const board = el('div', 'tls-board');
  root.append(board);

  let category = '';
  let sort = 'new';
  let items = [];
  let nextCursor = null;
  let loaded = false;
  let loading = false;
  let failed = '';
  let selectedId = null;
  let detail = null; // { post, comments }
  let detailLoading = false;
  let detailError = '';

  const listSection = el('div', 'tls-section');
  const listHead = el('div', 'tls-section-head');
  const seg = el('div', 'tls-seg');
  const catBar = el('div', 'tls-cats');
  const listBody = el('div', 'tls-scroll');
  listBody.style.cssText = 'flex:1;min-height:0';
  const listFoot = el('div', 'tls-dfoot');
  listSection.append(listHead, catBar, listBody, listFoot);

  const detailSection = el('div', 'tls-section tls-detail');
  const detailHead = el('div', 'tls-section-head');
  const detailBody = el('div', 'tls-scroll tls-dscroll');
  const detailFoot = el('div', 'tls-dfoot');
  detailSection.append(detailHead, detailBody, detailFoot);

  const split = () => ctx.layout.boardSplit;

  // ── 데이터 ────────────────────────────────────────
  async function loadList(reset) {
    if (loading) return;
    loading = true;
    if (reset) { nextCursor = null; failed = ''; }
    renderList();
    const result = await client.board({ category: category || undefined, sort, cursor: reset ? undefined : nextCursor || undefined });
    loading = false;
    if (result.ok && result.data) {
      const incoming = Array.isArray(result.data.items) ? result.data.items : [];
      items = reset ? incoming : items.concat(incoming.filter(p => !items.some(q => q.id === p.id)));
      nextCursor = result.data.nextCursor || null;
      loaded = true;
      failed = '';
    } else failed = result.error;
    renderList();
    renderDetailColumn();
  }

  async function openPost(id) {
    selectedId = id;
    detail = null;
    detailError = '';
    detailLoading = true;
    renderAll();
    const result = await client.post(id);
    if (selectedId !== id) return;
    detailLoading = false;
    if (result.ok && result.data) detail = { post: result.data.post, comments: result.data.comments || [] };
    else detailError = result.error;
    renderAll();
  }

  function patchItem(id, patch) {
    const hit = items.find(p => p.id === id);
    if (hit) Object.assign(hit, patch);
    if (detail && detail.post.id === id) Object.assign(detail.post, patch);
  }

  // ── 목록 ─────────────────────────────────────────
  function renderHead() {
    clear(listHead);
    listHead.append(icon('megaphone', 20), el('span', '', '소식·제보'));
    clear(seg);
    for (const [id, label] of [['new', '최신순'], ['top', '공감순']]) {
      const b = button(sort === id ? 'on' : '', null, () => { if (sort !== id) { sort = id; loadList(true); renderHead(); } });
      if (id === 'new') b.append(icon('sort', 14), document.createTextNode(' '));
      b.append(document.createTextNode(label));
      seg.append(b);
    }
    seg.style.marginLeft = 'auto';
    listHead.append(seg);
  }

  function renderCats() {
    clear(catBar);
    const defs = [['', '전체', 'list', 'gold'], ...CATEGORY_ORDER.map(id => [id, CATEGORIES[id].chip, CATEGORIES[id].icon, CATEGORIES[id].tone])];
    for (const [id, label, ic] of defs) {
      const b = button('tls-chip' + (category === id ? ' on' : ''), null, () => { if (category !== id) { category = id; renderCats(); loadList(true); } }, { 'aria-pressed': category === id });
      b.append(icon(ic, 14), el('span', '', label));
      catBar.append(b);
    }
  }

  function postCard(post, pinned) {
    const cat = boardCategory(post.category);
    const status = statusChip(post);
    const card = button('tls-post' + (pinned ? ' pinned' : '') + (selectedId === post.id ? ' on' : ''), null, () => openPost(post.id));
    if (pinned) { const pin = icon('pin', 22); pin.classList.add('tls-pin'); card.append(pin); }
    card.append(ctx.portrait(post.author || { id: String(post.id), name: '?' }, 'lg'));
    const main = el('div', 'tls-pmain');
    const top = el('div', 'tls-ptop');
    const badge = el('span', 'tls-cat tone-' + cat.tone);
    badge.append(icon(cat.icon, 12), el('span', '', cat.label));
    top.append(badge, el('span', 'tls-ptitle', post.title));
    if (pinned) { const pl = el('span', 'tls-pinlabel'); pl.append(icon('megaphone', 14), el('span', '', '고정 게시글')); top.append(pl); }
    else if (status.label) { const st = el('span', 'tls-status tone-' + status.tone); st.append(icon(status.icon, 12), el('span', '', status.label)); top.append(st); }
    main.append(top, el('div', 'tls-pexcerpt', excerpt(post.body, 90)));
    const meta = el('div', 'tls-pmeta');
    meta.append(el('span', '', post.author ? post.author.name : '알 수 없음'), el('span', '', dateTimeText(post.createdAt)));
    const stats = el('div', 'tls-pstats');
    const v = el('span', 'tls-stat' + (post.voted ? ' voted' : ''));
    v.append(icon('thumb', 13), el('span', '', String(post.votes)));
    const c = el('span', 'tls-stat');
    c.append(icon('comment', 13), el('span', '', String(post.comments)));
    stats.append(v, c);
    meta.append(stats);
    main.append(meta);
    card.append(main);
    return card;
  }

  function renderList() {
    clear(listBody);
    if (loading && !items.length) { const box = el('div', 'tls-empty'); box.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:.6em'; box.append(el('div', 'tls-spin'), el('p', '', '불러오는 중…')); listBody.append(box); }
    else if (failed && !items.length) {
      const box = el('div', 'tls-empty');
      box.append(el('b', '', errorMessage(failed)), button('tls-btn tls-btn-orange', '다시 불러오기', () => loadList(true)));
      listBody.append(box);
    } else if (!items.length) listBody.append(el('div', 'tls-empty', category ? '이 분류에는 아직 글이 없어요.' : '아직 글이 없어요. 첫 글을 남겨 보세요!'));
    else {
      const { pinned, rest } = boardOrder(items, { sort, category });
      if (pinned) listBody.append(postCard(pinned, true));
      for (const p of rest) listBody.append(postCard(p, false));
      if (nextCursor) listBody.append(button('tls-btn tls-btn-navy tls-btn-block', loading ? '불러오는 중…' : '더 보기', () => loadList(false)));
    }
    clear(listFoot);
    if (!split()) listFoot.append(...footContent());
    else listFoot.hidden = true;
    listFoot.hidden = split();
  }

  function footContent() {
    const write = button('tls-btn tls-btn-orange tls-btn-block', null, () => openComposer());
    write.append(icon('pencil', 16), el('span', '', '글쓰기'));
    const out = [write];
    const discord = ctx.discordInvite();
    if (discord) {
      const row = el('div', 'tls-discord');
      const text = el('div', 'tls-dtext');
      text.append(document.createTextNode('디스코드에서도 함께해요'), el('small', '', '개발팀과 실시간으로 소통해 보세요!'));
      const a = el('a', 'tls-btn tls-btn-discord', null, { href: discord, target: '_blank', rel: 'noopener noreferrer' });
      a.append(icon('discord', 18), el('span', '', '디스코드 참여'));
      row.append(text, a);
      out.push(row);
    }
    return out;
  }

  // ── 상세 ─────────────────────────────────────────
  function renderDetailColumn() {
    clear(detailHead);
    const back = button('tls-iconbtn', null, () => { selectedId = null; detail = null; renderAll(); }, { 'aria-label': '목록으로' });
    back.append(icon('back', 18));
    back.style.marginLeft = 'auto';
    detailHead.append(icon('megaphone', 20), el('span', '', '게시글 상세'));
    if (selectedId !== null) detailHead.append(back);
    clear(detailBody);
    clear(detailFoot);
    if (selectedId === null) {
      const hint = el('div', 'tls-empty');
      hint.append(el('b', '', '글을 골라 보세요'), el('span', '', '왼쪽 목록에서 글을 누르면 내용과 개발자 답변을 볼 수 있어요.'));
      detailBody.append(hint);
    } else if (detailLoading) {
      const box = el('div', 'tls-empty');
      box.append(el('div', 'tls-spin'));
      detailBody.append(box);
    } else if (detailError || !detail) {
      detailBody.append(el('div', 'tls-empty', errorMessage(detailError || 'post-not-found')));
    } else renderDetail(detail);
    detailFoot.append(...(split() ? footContent() : footContent().slice(0, 1)));
  }

  function renderDetail({ post, comments }) {
    const cat = boardCategory(post.category);
    const status = statusChip(post);
    const t = el('div', 'tls-dtitle');
    const badge = el('span', 'tls-cat tone-' + cat.tone);
    badge.append(icon(cat.icon, 12), el('span', '', cat.label));
    t.append(badge, el('h3', '', post.title));
    if (status.label) { const st = el('span', 'tls-status tone-' + status.tone); st.append(icon(status.icon, 12), el('span', '', status.label)); t.append(st); }
    detailBody.append(t);
    const author = el('div', 'tls-dauthor');
    author.append(ctx.portrait(post.author || { id: String(post.id), name: '?' }, 'md'));
    const who = el('div');
    who.append(post.author ? ctx.nameButton(post.author) : el('span', '', '알 수 없음'), el('div', '', dateTimeText(post.createdAt)));
    author.append(who);
    detailBody.append(author, el('div', 'tls-dbody', post.body));
    const lines = diagLines(post.diag);
    if (lines.length) {
      const box = el('div', 'tls-diagbox');
      box.append(el('b', '', '진단 정보'), ...lines.map(line => el('div', '', line)));
      detailBody.append(box);
    }
    if (post.devReply) {
      const reply = el('div', 'tls-devreply');
      reply.append(icon('shield', 34));
      const text = el('div');
      text.append(el('b', '', '개발자 답변'), el('p', '', post.devReply));
      reply.append(text);
      detailBody.append(reply);
    }
    const actions = el('div', 'tls-dactions');
    const vote = button('tls-btn tls-btn-navy tls-btn-sm' + (post.voted ? ' voted' : ''), null, async () => {
      if (!(await ctx.requireProfile())) return;
      const r = await client.vote(post.id);
      if (r.ok && r.data) { patchItem(post.id, { voted: r.data.voted, votes: r.data.votes }); renderAll(); }
      else ctx.toast(errorMessage(r.error, r.retryAfterMs), 'warn');
    });
    vote.append(icon('thumb', 14), el('span', '', (post.voted ? '공감함 ' : '공감 ') + post.votes));
    if (post.voted) vote.style.borderColor = 'var(--tls-gold)';
    actions.append(vote, button('tls-btn tls-btn-ghost tls-btn-sm', '신고', async () => {
      if (!(await ctx.requireProfile())) return;
      openReportModal(ctx, { kind: 'post', target: String(post.id), label: '이 글' });
    }));
    detailBody.append(actions);
    if (client.state.isAdmin) detailBody.append(adminBox(post));

    detailBody.append(el('div', 'tls-hint', '댓글 ' + comments.length));
    for (const c of comments) {
      const row = el('div', 'tls-comment');
      const top = el('div', 'tls-ctop');
      if (c.dev) top.append(el('span', 'tls-devtag', '개발자'));
      top.append(c.author ? ctx.nameButton(c.author) : el('span', '', '알 수 없음'), el('span', 'tls-time', dateTimeText(c.createdAt)));
      row.append(top, el('p', '', c.body));
      detailBody.append(row);
    }
    const form = el('form');
    form.style.cssText = 'display:flex;gap:.5em;margin-top:.5em';
    const input = el('input', 'tls-input', null, { type: 'text', maxlength: 300, placeholder: '댓글을 입력하세요.', 'aria-label': '댓글' });
    const send = button('tls-btn tls-btn-orange tls-btn-sm', '등록', null, { type: 'submit' });
    form.append(input, send);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      if (!(await ctx.requireProfile())) return;
      send.disabled = true;
      const r = await client.comment(post.id, body);
      send.disabled = false;
      if (r.ok && r.data) {
        input.value = '';
        detail.comments.push(r.data);
        patchItem(post.id, { comments: post.comments + 1 });
        renderAll();
      } else ctx.toast(errorMessage(r.error, r.retryAfterMs), 'warn');
    });
    detailBody.append(form);
  }

  function adminBox(post) {
    const box = el('div', 'tls-admin');
    box.append(el('b', '', '관리자'));
    const chips = el('div', 'tls-chips');
    let status = post.status;
    const renderStatus = () => {
      clear(chips);
      for (const id of STATUS_CHOICES) chips.append(button('tls-chip' + (status === id ? ' on' : ''), STATUS_LABELS[id], () => { status = id; renderStatus(); }));
    };
    renderStatus();
    const reply = el('textarea', 'tls-input', null, { maxlength: 1000, placeholder: '개발자 답변 (비우면 답변 삭제)', 'aria-label': '개발자 답변' });
    reply.value = post.devReply || '';
    const hide = el('label', '');
    hide.style.cssText = 'flex-direction:row;align-items:center;gap:.4em;margin:.4em 0';
    const check = el('input', '', null, { type: 'checkbox' });
    check.checked = !!post.hidden;
    hide.append(check, document.createTextNode('글 숨기기'));
    const save = button('tls-btn tls-btn-orange tls-btn-sm', '저장', async () => {
      const r = await client.moderate(post.id, { status, devReply: reply.value.trim() ? reply.value.trim() : null, hidden: check.checked });
      if (r.ok && r.data) {
        patchItem(post.id, { status: r.data.status, devReply: r.data.devReply, hidden: r.data.hidden });
        ctx.toast('저장했어요.', 'good');
        if (r.data.hidden) { items = items.filter(p => p.id !== post.id); selectedId = null; detail = null; }
        renderAll();
      } else ctx.toast(errorMessage(r.error), 'warn');
    });
    box.append(chips, reply, hide, save);
    return box;
  }

  // ── 글쓰기 ───────────────────────────────────────
  async function openComposer() {
    if (!(await ctx.requireProfile())) return;
    const isAdmin = client.state.isAdmin;
    const cats = CATEGORY_ORDER.filter(id => id !== 'notice' || isAdmin);
    let chosen = category && cats.includes(category) ? category : 'bug';
    const chips = el('div', 'tls-chips');
    const title = el('input', 'tls-input', null, { type: 'text', maxlength: 40, placeholder: '제목 (2~40자)', 'aria-label': '제목' });
    const body = el('textarea', 'tls-input', null, { maxlength: 1000, placeholder: '내용을 자세히 적어 주세요. (최대 1000자)', 'aria-label': '내용' });
    const diagBox = el('div', 'tls-diagbox');
    const attach = el('input', '', null, { type: 'checkbox' });
    attach.checked = true;
    const err = el('p', 'tls-err');
    const diag = () => cleanDiag(ctx.hooks.diagnostics ? ctx.hooks.diagnostics() : null);
    const renderDiag = () => {
      clear(diagBox);
      const data = diag();
      diagBox.hidden = chosen !== 'bug' || !data;
      if (diagBox.hidden) return;
      const label = el('label', '');
      label.style.cssText = 'flex-direction:row;align-items:center;gap:.4em;margin-bottom:.3em';
      label.append(attach, document.createTextNode('진단 정보를 함께 보낼게요'));
      diagBox.append(label, ...diagLines(data).map(line => el('div', '', line)));
    };
    const renderChips = () => {
      clear(chips);
      for (const id of cats) chips.append(button('tls-chip' + (chosen === id ? ' on' : ''), CATEGORIES[id].label, () => { chosen = id; renderChips(); renderDiag(); }));
    };
    renderChips();
    renderDiag();
    const submit = button('tls-btn tls-btn-orange', '올리기', async () => {
      err.textContent = '';
      const t = title.value.trim(), b = body.value.trim();
      if ([...t].length < 2 || [...t].length > 40) { err.textContent = errorMessage('title'); return; }
      if (!b) { err.textContent = '내용을 적어 주세요.'; return; }
      const payload = { category: chosen, title: t, body: b };
      const data = diag();
      if (chosen === 'bug' && attach.checked && data) payload.diag = data;
      const r = await client.createPost(payload);
      if (!r.ok) { err.textContent = errorMessage(r.error, r.retryAfterMs); return; }
      ctx.toast('글을 올렸어요. 고마워요!', 'good');
      handle.close();
      category = '';
      sort = 'new';
      renderHead();
      renderCats();
      await loadList(true);
      if (r.data && typeof r.data.id === 'number') openPost(r.data.id);
    });
    const handle = ctx.modal({
      title: '글쓰기', wide: true,
      body: [el('p', 'tls-note', '버그·아이디어·질문을 남겨 주세요. 개발자가 직접 읽고 답해요.'), chips, title, body, diagBox, err],
      actions: [button('tls-btn tls-btn-navy', '취소', () => handle.close()), submit],
    });
  }

  // ── 조립 ────────────────────────────────────────
  function renderAll() {
    renderList();
    renderDetailColumn();
    layoutColumns();
  }
  function layoutColumns() {
    clear(board);
    const isSplit = split();
    board.classList.toggle('single', !isSplit);
    if (isSplit) { board.append(listSection, detailSection); listFoot.hidden = true; }
    else if (selectedId !== null) board.append(detailSection);
    else board.append(listSection);
  }

  return {
    el: root,
    show() {
      renderHead();
      renderCats();
      layoutColumns();
      if (!loaded) loadList(true);
      else { renderList(); renderDetailColumn(); }
      renderDetailColumn();
    },
    hide() {},
    refresh() {},
    relayout() { layoutColumns(); renderList(); renderDetailColumn(); },
  };
}
