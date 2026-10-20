// 명예의 전당(시안 C14): 던전 목록 · 시상대 · 서버 정복 순위 · 내 순위
import { button, clear, el } from '../dom.js';
import { icon, laurel } from '../icons.js';
import { clockText, dateText, durationText, errorMessage, fullName, hueOf } from '../format.js';
import { fameModel } from '../models.js';

const STALE_MS = 30000;

export function createFameView(ctx) {
  const { client, config } = ctx;
  const root = el('div', 'tls-view');
  const wrap = el('div', 'tls-famewrap');
  const banner = el('div', 'tls-banner');
  const lLaurel = laurel(120, 9, 'left'), rLaurel = laurel(120, 9, 'right');
  lLaurel.classList.add('l');
  rLaurel.classList.add('r');
  banner.append(lLaurel, el('h2', '', '명예의 전당'), rLaurel);
  const cols = el('div', 'tls-fame-cols');
  const strip = el('div', 'tls-chatstrip');
  strip.setAttribute('role', 'button');
  strip.tabIndex = 0;
  wrap.append(banner, cols, strip);
  root.append(wrap);

  let fame = null;
  let loadedAt = 0;
  let loading = false;
  let failed = '';
  let selectedId = '';
  const detail = new Map();
  let myClears = null;

  async function load(force) {
    if (loading) return;
    if (!force && fame && Date.now() - loadedAt < STALE_MS) { render(); return; }
    loading = true;
    render();
    const result = await client.fame();
    loading = false;
    if (result.ok && result.data) { fame = result.data; loadedAt = Date.now(); failed = ''; }
    else failed = result.error;
    render();
    if (fame) { loadDetail(); loadMine(); }
  }
  async function loadDetail() {
    const id = currentId();
    if (!id || detail.has(id)) return;
    const result = await client.fameContent(id);
    if (result.ok && result.data) { detail.set(id, { first: result.data.first, fastest: result.data.fastest }); render(); }
  }
  async function loadMine() {
    const me = client.state.me;
    if (!me || myClears !== null) return;
    const result = await client.player(me.id);
    if (result.ok && result.data && Number.isFinite(result.data.clears)) { myClears = result.data.clears; render(); }
  }
  function currentId() {
    if (!fame) return '';
    const contents = fame.contents || [];
    if (contents.some(c => c.id === selectedId)) return selectedId;
    const firstWith = contents.find(c => Array.isArray(c.first) && c.first.length) || contents[0];
    return firstWith ? firstWith.id : '';
  }
  function select(id) {
    selectedId = id;
    render();
    loadDetail();
  }

  function art(id) {
    const url = ctx.contentArt(id);
    return url ? 'url(' + JSON.stringify(url) + ')' : 'linear-gradient(135deg,hsl(' + hueOf(id) + ' 55% 32%),hsl(' + ((hueOf(id) + 50) % 360) + ' 60% 14%))';
  }

  function dungeonCard(card, on, inStrip) {
    const b = button('tls-dcard' + (on ? ' on' : ''), null, () => select(card.id), { 'aria-pressed': on });
    b.style.backgroundImage = art(card.id);
    const label = el('div');
    label.append(el('b', '', card.name), el('small', '', card.firstBy ? '최초 정복 · ' + fullName(card.firstBy) : '아직 정복자 없음'));
    b.append(label);
    if (!inStrip) b.append(icon('chevronRight', 22));
    return b;
  }

  function podiumSlot(slot) {
    const { rank, entry } = slot;
    const node = el('div', 'tls-pod r' + rank + (entry ? '' : ' vacant'));
    const rk = el('div', 'tls-rk');
    if (rank === 1) rk.append(icon('crown', 20));
    rk.append(el('span', '', String(rank)));
    node.append(rk);
    if (!entry) {
      node.append(ctx.portrait({ id: 'vacant' + rank, name: '?' }, 'lg'), el('div', 'tls-pname', '비어 있음'), el('div', 'tls-pdate', '—'), el('div', 'tls-ptime', '--:--'));
      return node;
    }
    node.append(ctx.portrait(entry.player, 'lg'));
    const name = el('div', 'tls-pname');
    name.append(ctx.nameButton(entry.player));
    node.append(name, el('div', 'tls-pdate', dateText(entry.at)));
    const time = el('div', 'tls-ptime');
    time.append(icon('clock', 14), el('span', '', durationText(entry.bestMs)));
    node.append(time);
    return node;
  }

  function rankRow(rank, entry) {
    const row = el('div', 'tls-rank-row');
    row.append(el('span', 'tls-rn', String(rank)), ctx.portrait(entry.player, 'sm'));
    const name = el('span', 'tls-rname');
    name.append(ctx.nameButton(entry.player));
    row.append(name);
    if (entry.at) row.append(el('span', 'tls-rdate', dateText(entry.at)));
    const time = el('span', 'tls-rtime');
    time.append(document.createTextNode(durationText(entry.bestMs)));
    row.append(time);
    return row;
  }

  function renderCenter(model, selected) {
    const section = el('div', 'tls-section');
    section.style.minHeight = '0';
    const head = el('div', 'tls-fhead');
    const thumb = el('div', 'tls-thumb');
    thumb.style.backgroundImage = art(selected ? selected.id : '');
    const info = el('div');
    info.style.cssText = 'flex:1;min-width:0';
    const first = model.podium.find(p => p.rank === 1);
    info.append(el('h3', '', selected ? selected.name : '던전'), el('p', '', first && first.entry ? '최초 정복 · ' + fullName(first.entry.player) : '아직 정복자가 없어요'));
    head.append(thumb, info);
    if (ctx.hooks.openContentInfo && selected) {
      const infoBtn = button('tls-btn tls-btn-navy tls-btn-sm', null, () => ctx.hooks.openContentInfo(selected.id));
      infoBtn.append(icon('search', 14), el('span', '', '던전 정보'));
      head.append(infoBtn);
    }
    const body = el('div', 'tls-scroll');
    body.style.cssText = 'flex:1;min-height:0';
    if (selected && selected.empty) body.append(el('div', 'tls-nobody', '아직 정복자가 없습니다 — 첫 번째가 되어 보세요'));
    const pod = el('div', 'tls-podium');
    for (const slot of model.podium) pod.append(podiumSlot(slot));
    body.append(pod);

    const lower = el('div', 'tls-fame-lower');
    const runners = el('div', 'tls-mini');
    runners.append(el('h4', '', '선구자 4 ~ 10위'));
    if (!model.runnersUp.length) runners.append(el('div', 'tls-hint', '아직 4위 이후 기록이 없어요.'));
    for (const e of model.runnersUp) runners.append(rankRow(e.rank, e));
    const fastest = el('div', 'tls-mini');
    fastest.append(el('h4', '', '최단 기록 TOP 3'));
    if (!model.fastest.length) fastest.append(el('div', 'tls-hint', '아직 기록이 없어요.'));
    model.fastest.forEach((e, i) => {
      const row = el('div', 'tls-rank-row');
      row.append(el('span', 'tls-medalnum s' + (i + 1), String(i + 1)), ctx.portrait(e.player, 'sm'));
      const name = el('span', 'tls-rname');
      name.append(ctx.nameButton(e.player));
      row.append(name, el('span', 'tls-rtime', durationText(e.bestMs)));
      fastest.append(row);
    });
    lower.append(runners, fastest);
    body.append(lower);
    section.append(head, body);
    return section;
  }

  function renderRight(model) {
    const section = el('div', 'tls-section');
    const head = el('div', 'tls-section-head');
    head.append(icon('swords', 20), el('span', '', '서버 정복 순위'));
    const body = el('div', 'tls-scroll');
    body.style.cssText = 'flex:1;min-height:0';
    const hd = el('div', 'tls-conq-head');
    hd.append(el('span', '', '순위'), el('span', '', '캐릭터명'), el('span', '', '정복 현황'));
    body.append(hd);
    if (!model.conquest.length) body.append(el('div', 'tls-hint', '아직 순위가 없어요. 첫 정복자가 되어 보세요!'));
    for (const e of model.conquest) {
      const row = el('div', 'tls-rank-row');
      row.append(e.rank <= 3 ? el('span', 'tls-medalnum s' + e.rank, String(e.rank)) : el('span', 'tls-rn', String(e.rank)), ctx.portrait(e.mini, 'sm'));
      const name = el('span', 'tls-rname');
      name.append(ctx.nameButton(e.mini));
      row.append(name, el('span', 'tls-rtime', e.cleared + '/' + model.total + ' 정복'));
      body.append(row);
    }
    section.append(head, body);
    if (model.me && client.state.me) {
      const me = client.state.me;
      const mine = el('div', 'tls-me-rank');
      const rk = el('div', 'tls-rk');
      rk.append(el('span', '', '내 순위'), el('b', '', model.me.listed ? model.me.rank + '위' : '—'));
      mine.append(rk, ctx.portrait(me, 'sm'), el('span', 'tls-rname', fullName(me)), el('span', 'tls-rtime', model.me.cleared + '/' + model.total + ' 정복'));
      section.append(mine);
    }
    return section;
  }

  function renderStrip() {
    const s = client.state;
    clear(strip);
    const msgs = s.messages.get(s.currentWorld || 'world-1') || [];
    let last = null;
    for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].kind === 'chat' && msgs[i].from && !s.blocks.has(msgs[i].from.id)) { last = msgs[i]; break; } }
    strip.append(icon('chat', 20), el('span', 'tls-cslabel', '광장'),
      el('span', 'tls-cstext', last ? last.from.name + ' : ' + last.text : (ctx.phase === 'ready' ? '광장 채팅을 열어 인사해 보세요.' : '채팅을 열어 보세요.')));
    const n = (s.unread.get('dm') || 0) + (s.partyChannel ? s.unread.get(s.partyChannel) || 0 : 0) + (s.unread.get(s.currentWorld || 'world-1') || 0);
    if (n > 0) strip.append(el('span', 'tls-count', n > 99 ? '99+' : String(n)));
    strip.append(icon('chevronUp', 20));
  }
  strip.addEventListener('click', () => ctx.go('chat'));
  strip.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ctx.go('chat'); } });

  function render() {
    clear(cols);
    cols.classList.toggle('compact', ctx.compact);
    renderStrip();
    if (!fame) {
      cols.style.display = 'block';
      if (loading) {
        const box = el('div', 'tls-empty');
        box.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:.6em';
        box.append(el('div', 'tls-spin'), el('p', '', '명예의 전당을 불러오는 중…'));
        cols.append(box);
      }
      else {
        const box = el('div', 'tls-empty');
        box.append(el('b', '', failed ? errorMessage(failed) : '기록을 불러오지 못했어요.'), button('tls-btn tls-btn-orange', '다시 불러오기', () => load(true)));
        cols.append(box);
      }
      return;
    }
    cols.style.display = '';
    const id = currentId();
    const contents = (fame.contents || []).map(c => (c.id === id && detail.has(id) ? { ...c, ...detail.get(id) } : c));
    const model = fameModel({ ...fame, contents }, id, { meId: client.state.me ? client.state.me.id : null, config, myClears });

    const list = el('div', 'tls-section');
    const lhead = el('div', 'tls-section-head');
    lhead.append(icon('flag', 20), el('span', '', '던전 목록'));
    if (ctx.compact) {
      const s = el('div', 'tls-strip tls-scroll-x');
      for (const c of model.cards) s.append(dungeonCard(c, c.id === id, true));
      cols.append(s);
    } else {
      const lbody = el('div', 'tls-scroll');
      lbody.style.cssText = 'flex:1;min-height:0';
      for (const c of model.cards) lbody.append(dungeonCard(c, c.id === id, false));
      list.append(lhead, lbody);
      cols.append(list);
    }
    cols.append(renderCenter(model, model.selected), renderRight(model));
  }

  return {
    el: root,
    show() { load(false); },
    hide() {},
    refresh() { renderStrip(); },
    relayout() { render(); },
    reload() { loadedAt = 0; return load(true); },
  };
}
