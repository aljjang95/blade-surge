// 파티 모집 탭: 모집 목록 + 내 파티 모집 올리기
import { button, clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { errorMessage } from '../format.js';
import { listingModel } from '../models.js';

const REFRESH_MS = 20000;

export function createPartyView(ctx) {
  const { client, config } = ctx;
  const root = el('div', 'tls-view tls-partyview');
  const mine = el('div', 'tls-section');
  mine.style.cssText = 'margin:.5em .6em 0;flex:none';
  const status = el('div', 'tls-hint');
  const list = el('div', 'tls-list tls-scroll');
  root.append(mine, status, list);

  let items = [];
  let loadedAt = 0;
  let timer = 0;
  let loading = false;
  let failed = '';
  let mineKey = '';
  const form = { contentId: '', slots: 4, note: '' };

  async function load(force = false) {
    if (loading) return;
    if (!force && Date.now() - loadedAt < 2500) return;
    loading = true;
    const result = await client.listings();
    loading = false;
    if (result.ok) {
      items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
      loadedAt = Date.now();
      failed = '';
    } else failed = result.error;
    render();
  }

  function mineListing() {
    const meId = ctx.meId();
    return meId ? items.find(i => i && i.host && i.host.id === meId) : null;
  }

  function renderMine() {
    clear(mine);
    const code = ctx.partyCode();
    const canRecruit = ctx.hooks.canRecruit ? !!ctx.hooks.canRecruit() : !!code;
    const head = el('div', 'tls-section-head');
    head.append(icon('flag', 18), el('span', '', '내 파티 모집'));
    mine.append(head);
    const body = el('div');
    body.style.cssText = 'padding:.6em .7em;display:flex;flex-direction:column;gap:.5em';
    if (!code || !canRecruit) {
      body.append(el('p', 'tls-note', code ? '방장이 파티 대기실에 있을 때만 모집을 올릴 수 있어요.' : '파티를 만들면 여기서 모집을 올릴 수 있어요. 올린 모집은 광장 채팅에도 보여요.'));
      if (!code && ctx.hooks.openParty) body.append(button('tls-btn tls-btn-navy tls-btn-sm', '파티 만들러 가기', () => { ctx.hooks.openParty(); }));
      mine.append(body);
      return;
    }
    const row = el('div');
    row.style.cssText = 'display:flex;gap:.5em;flex-wrap:wrap';
    const content = el('select', 'tls-input', null, { 'aria-label': '던전' });
    content.append(el('option', '', '자유 사냥', { value: '' }));
    for (const c of config.contents) content.append(el('option', '', c.name, { value: c.id }));
    content.value = form.contentId;
    content.addEventListener('change', () => { form.contentId = content.value; });
    const slots = el('select', 'tls-input', null, { 'aria-label': '정원' });
    slots.style.maxWidth = '6em';
    for (const n of [2, 3, 4]) slots.append(el('option', '', n + '명', { value: n }));
    slots.value = String(form.slots);
    slots.addEventListener('change', () => { form.slots = Number(slots.value); });
    row.append(content, slots);
    const note = el('input', 'tls-input', null, { type: 'text', maxlength: 40, placeholder: '한마디 (예: 딜러 구해요)', 'aria-label': '한마디' });
    note.value = form.note;
    note.addEventListener('input', () => { form.note = note.value; });
    const existing = mineListing();
    const actions = el('div');
    actions.style.cssText = 'display:flex;gap:.5em';
    actions.append(button('tls-btn tls-btn-orange', existing ? '모집 갱신' : '모집 올리기', async () => {
      const info = ctx.hooks.currentPartyInfo ? ctx.hooks.currentPartyInfo() : null;
      const slotCount = Math.min(4, Math.max(2, (info && info.slots) || form.slots));
      const members = Math.min(slotCount, Math.max(1, (info && info.members) || 1));
      const r = await client.postListing({ partyCode: code, contentId: form.contentId || null, note: form.note.trim(), slots: slotCount, members });
      if (r.ok) { ctx.toast(existing ? '모집을 갱신했어요.' : '모집을 올렸어요.', 'good'); load(true); }
      else ctx.toast(errorMessage(r.error, r.retryAfterMs), 'warn');
    }));
    if (existing) actions.append(button('tls-btn tls-btn-navy', '모집 내리기', async () => {
      const r = await client.deleteListing();
      if (r.ok) { ctx.toast('모집을 내렸어요.'); load(true); } else ctx.toast(errorMessage(r.error), 'warn');
    }));
    body.append(row, note, actions);
    if (existing) body.append(el('p', 'tls-note', '모집은 10분 동안 보여요. 다시 올리면 시간이 늘어나요.'));
    mine.append(body);
  }

  function render() {
    renderMine();
    clear(list);
    status.textContent = '';
    if (failed && !items.length) {
      list.append(el('div', 'tls-empty', errorMessage(failed)), button('tls-btn tls-btn-navy', '다시 불러오기', () => load(true)));
      return;
    }
    const now = Date.now();
    const meId = ctx.meId();
    const rows = items.map(raw => listingModel(raw, { meId, config, now })).filter(Boolean);
    if (!rows.length) { list.append(el('div', 'tls-empty', '지금 올라온 모집이 없어요. 첫 모집을 올려 보세요!')); return; }
    for (const l of rows) {
      const node = el('div', 'tls-listing big');
      const art = ctx.contentArt(l.contentId);
      const thumb = el('div', 'tls-thumb');
      if (art) thumb.style.backgroundImage = 'url(' + JSON.stringify(art) + ')';
      const main = el('div', 'tls-lmain');
      main.append(el('div', 'tls-ltitle', l.title), el('div', 'tls-lsub', l.note || '함께 던전을 돌아요!'));
      const host = el('div', 'tls-lhost');
      host.append(el('span', '', '방장 '), ctx.nameButton(l.host));
      main.append(host);
      node.append(thumb, main);
      if (l.joinable) node.append(button('tls-btn tls-btn-orange', '참가', () => ctx.joinParty(l.partyCode)));
      else node.append(el('span', 'tls-tag', l.stateText));
      list.append(node);
    }
  }

  function start() { stop(); timer = ctx.win.setInterval(() => { if (!ctx.doc.hidden) load(); }, REFRESH_MS); }
  function stop() { if (timer) { ctx.win.clearInterval(timer); timer = 0; } }

  return {
    el: root,
    show() { render(); load(true); start(); },
    hide() { stop(); },
    refresh() {
      // 입력 중 포커스를 잃지 않도록 파티 상태가 바뀔 때만 위쪽 폼을 다시 그린다.
      const key = (ctx.partyCode() || '') + '|' + (mineListing() ? 1 : 0) + '|' + (ctx.hooks.canRecruit && ctx.hooks.canRecruit() ? 1 : 0);
      if (key !== mineKey) { mineKey = key; renderMine(); }
    },
    destroy() { stop(); },
  };
}
