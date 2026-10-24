/**
 * 룬 소켓 화면(DOM): 장비 상세의 '룬 소켓' 탭(C20), 룬 고르기(rune-picker), 룬 각인판(rune-overview).
 * 계산은 rune-view 의 뷰 모델, 저장은 economy 의 runeInsert/runeRemove/runeReplace 만 쓴다.
 * 확인은 앱 안 확인창(ui.confirm)으로 하고 브라우저 confirm() 은 쓰지 않는다.
 */
import './rune.css';
import { fmt } from './ui.js';
import { ITEM_BY_ID, RARITY_COLOR, RARITY_INFO, SLOT_NAME } from '../data/items.js';
import { HEROES } from '../data/heroes.js';
import { RUNE_BY_ID } from '../data/runes.js';
import { audio } from '../engine/audio.js';
import { itemIconHtml } from './item-presentation.js';
import { bindHeroPortrait } from './hero-portraits.js';
import { runeHex, emptyHex, familyGlyph } from './rune-art.js';
import { playRuneSound, warmRuneSounds } from './rune-sound.js';
import { socketBoard, pickerView, overviewView, defaultSocket, runeLabel, familyOf, FAMILY_BY_ID } from './rune-view.js';

const esc = (/** @type {unknown} */ value) => String(value).replace(/[&<>"]/g, (ch) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
/** @type {Record<string, string>} */
const REASON = { gold: '골드가 부족합니다', bag: '가방에 그 룬이 없습니다', locked: '+15 강화 시 개방되는 칸입니다', occupied: '이미 룬이 박힌 칸입니다', empty: '빈 칸입니다', same: '같은 룬입니다', index: '칸을 찾지 못했습니다', item: '장비를 찾지 못했습니다', unknown: '알 수 없는 룬입니다', storage: '저장하지 못해 그대로 두었습니다', materials: '재료 룬이 부족합니다', dust: '룬 가루가 부족합니다', grade: '합성할 수 없는 등급입니다' };
export const runeReasonText = (/** @type {string} */ reason) => REASON[reason] || '처리하지 못했습니다';

/** 소켓판 칸 위치(판 중심 기준 px, --u 로 배율). 칸 수 1~3. 시안처럼 위 두 칸은 좌우, 세 번째(잠긴) 칸은 아래 가운데. */
const POS = { 1: [[0, -38]], 2: [[-72, -14], [72, -14]], 3: [[-72, -14], [72, -14], [0, 40]] };

/** 소켓 하나(판 위 육각 + 이름표). */
function socketHtml(/** @type {any} */ s, /** @type {number} */ total, /** @type {number|null} */ selected, size = 'lg', extra = '') {
  const [x, y] = (/** @type {any} */ (POS)[Math.min(3, Math.max(1, total))] || POS[3])[s.index] || [0, 0];
  const art = s.state === 'locked' ? (s.rune ? runeHex(RUNE_BY_ID[s.rune.id].family, s.rune.grade, { size, cls: 'rune-hex-dim' }) + emptyHex('locked', 'sm').replace('rune-hex-sm', 'rune-hex-sm rs-lock-badge') : emptyHex('locked', size))
    : s.rune ? runeHex(RUNE_BY_ID[s.rune.id].family, s.rune.grade, { size }) : emptyHex(selected === s.index ? 'target' : 'empty', size);
  const caption = s.state === 'locked' ? s.lockText : s.rune ? s.label : selected === s.index ? '장착할 소켓' : '빈 소켓';
  const bottom = total >= 3 && s.index === 2;
  return '<button type="button" class="rs-socket" data-socket="' + s.index + '" data-state="' + s.state + '"' + (s.duplicate ? ' data-dup="1"' : '') + ' aria-pressed="' + (selected === s.index) + '"' + (bottom ? ' data-pos="bottom"' : '') + ' style="--x:' + x + ';--y:' + y + '" aria-label="' + (s.index + 1) + '번 소켓 · ' + esc(caption) + '"' + extra + '>' + art +
    '<small>' + esc(caption) + (s.duplicate ? '<em>중복 상한</em>' : '') + '</small></button>';
}
/** 원형 소켓판. */
export function boardHtml(/** @type {any} */ board, /** @type {number|null} */ selected, /** @type {string} */ heroId, { caption = false } = {}) {
  const it = ITEM_BY_ID[board.itemId];
  return '<div class="rs-board" data-total="' + board.total + '"><span class="rs-ring" aria-hidden="true"></span><span class="rs-center rar-' + it.rarity + '">' + itemIconHtml(it, '', { heroId }) + (caption ? '<b>' + esc(it.name) + '</b>' : '') + '</span>' +
    board.sockets.map((/** @type {any} */ s) => socketHtml(s, board.total, selected)).join('') + '</div>';
}
/**
 * 장비 상세용 큰 미리보기 판: 위에 3D 장비 무대(실패 시 큰 아이콘 대체), 아래에 소켓 줄.
 * 소켓은 미리보기를 가리지 않도록 무대 바깥 줄에 놓는다. 무대 DOM 은 다시 그려도 유지된다(bindRunePane).
 */
export function stageBoardHtml(/** @type {any} */ board, /** @type {number|null} */ selected, /** @type {string} */ heroId) {
  const it = ITEM_BY_ID[board.itemId], color = RARITY_COLOR[it.rarity] || '#d6aa48';
  return '<div class="rs-board rs-stage-board" data-total="' + board.total + '"><div class="rs-stage rar-' + it.rarity + '" data-item="' + board.itemId + '" style="--rar:' + color + '">' +
    '<span class="rs-stage-floor" aria-hidden="true"></span><span class="rs-stage-fallback">' + itemIconHtml(it, '', { heroId }) + '</span><div class="rs-stage-gl" aria-hidden="false"></div><b class="rs-stage-name">' + esc(it.name) + '</b></div>' +
    '<div class="rs-sockrow">' + board.sockets.map((/** @type {any} */ s) => socketHtml(s, board.total, selected)).join('') + '</div></div>';
}
/** 가문 4칸. */
export const familiesHtml = (/** @type {any[]} */ families, /** @type {Record<string, number>|null} */ after = null) => '<div class="rs-families">' + families.map((f) => {
  const to = after ? after[f.id] : f.count, changed = after && to !== f.count;
  return '<span class="rs-family" data-family="' + f.id + '" style="--fam:' + f.color + '"' + (changed ? ' data-changed="1"' : '') + '>' + familyGlyph(f.id) + '<b>' + f.name + '</b><em>' + (changed ? f.count + '→' + to : f.count) + '</em></span>';
}).join('') + '</div>';
/** 공명 칩(금테 리본 + 두 가문 문양 + 이름). */
export const synergyChip = (/** @type {any} */ s, { suffix = '', glow = false } = {}) => '<span class="rs-syn' + (s.active ? ' on' : '') + (glow ? ' glow' : '') + '" data-syn="' + s.id + '">' + s.families.map((/** @type {string} */ f) => familyGlyph(f)).join('') + '<b>' + esc(s.name) + suffix + '</b></span>';

// ------------------------------------------------------------------ 장비 상세: 룬 소켓 탭
/**
 * 장비 상세 오른쪽 패널의 룬 소켓 탭 내용.
 * @param {any} meta @param {number} uid @param {string} heroId @param {number|null} selected
 */
export function runePaneHtml(meta, uid, heroId, selected) {
  const board = socketBoard(meta.eco, heroId, uid); if (!board) return '';
  const sel = selected ?? defaultSocket(board), on = board.synergies.filter((/** @type {any} */ s) => s.active);
  const cur = board.sockets[sel];
  return '<section class="rs-pane" aria-label="룬 소켓">' + stageBoardHtml(board, sel, heroId) + familiesHtml(board.families) +
    '<div class="rs-syns">' + (on.length ? on.map((/** @type {any} */ s) => synergyChip(s, { suffix: ' 발동' })).join('') : '<span class="rs-syn-none">공명 없음 · 두 가문 각 2개</span>') + '<button type="button" class="rs-overview-link" id="rs-overview" aria-label="룬 각인판 · 전체 보기">각인판 ›</button></div>' +
    '<div class="rs-actions"><button type="button" class="btn rs-btn-cream" id="rs-swap"' + (cur?.rune ? '' : ' disabled') + '>' + (cur?.state === 'locked' && cur.rune ? '룬 빼기' : '룬 교체') + '</button>' +
    '<button type="button" class="btn btn-gold" id="rs-insert"' + (board.sockets.some((/** @type {any} */ s) => s.state === 'empty') ? '' : ' disabled') + '>룬 장착</button></div></section>';
}


// ------------------------------------------------------------------ 3D 장비 무대(룬 소켓 탭)
/** @type {{ el: HTMLElement|null, handle: { dispose: () => void }|null, seq: number }} */
const stage = { el: null, handle: null, seq: 0 };
/** 무대의 렌더러·지오메트리·렌더 루프를 정리한다(탭 전환·시트 닫기·다른 장비). */
export function disposeRuneStage() {
  stage.seq++; stage.handle?.dispose(); stage.handle = null;
  if (stage.el) delete stage.el.dataset.stageState;
  stage.el = null;
}
async function mountStage(/** @type {HTMLElement|null} */ el, /** @type {string} */ heroId) {
  if (!el) return;
  if (stage.el === el) return;   // 같은 무대(다시 그린 뒤 옮겨 온 것)
  disposeRuneStage();
  stage.el = el; el.dataset.stageState = 'pending';
  const token = ++stage.seq, it = ITEM_BY_ID[el.dataset.item || ''], gl = /** @type {HTMLElement} */ (el.querySelector('.rs-stage-gl'));
  const fail = () => { if (token !== stage.seq) return; gl.textContent = ''; el.dataset.stageState = 'fallback'; };
  try {
    const { mountItemPreview } = await import('./item-preview-3d.js');
    if (token !== stage.seq) return;
    const rim = Number.parseInt((RARITY_COLOR[it.rarity] || '#ffffff').replace('#', ''), 16) || 0xffffff;
    const handle = await mountItemPreview(gl, it, { heroId, rimColor: rim, reducedMotion: !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches });
    if (token !== stage.seq) { handle.dispose(); return; }
    stage.handle = handle;
    if (gl.querySelector('canvas[data-preview-state="ready"]')) el.dataset.stageState = 'ready'; else fail();
  } catch (error) { fail(); console.warn('rune stage', error); }
}

/**
 * 룬 소켓 탭 연결. state.socket 에 고른 칸을 기억한다(시트를 다시 그려도 유지).
 * @param {HTMLElement} root 시트 루트
 * @param {{ meta: any, uid: number, heroId: string, state: { socket: number|null }, back: () => void }} ctx
 */
export function bindRunePane(root, ctx) {
  const pane = root.querySelector('.rs-pane'); if (!pane) return;
  warmRuneSounds();
  const { meta, uid, heroId, state } = ctx, { ui } = meta;
  const redraw = () => {
    const host = /** @type {HTMLElement} */ (pane.parentElement), oldStage = host.querySelector('.rs-stage');
    host.innerHTML = runePaneHtml(meta, uid, heroId, state.socket);
    if (oldStage) host.querySelector('.rs-stage')?.replaceWith(oldStage);   // WebGL 무대는 다시 만들지 않고 그대로 옮긴다
    bindRunePane(root, ctx);
  };
  mountStage(/** @type {HTMLElement|null} */ (pane.querySelector('.rs-stage')), heroId);
  pane.querySelectorAll('.rs-socket').forEach((el) => /** @type {HTMLElement} */ (el).onclick = () => {
    const board = socketBoard(meta.eco, heroId, uid), s = board?.sockets[+(/** @type {HTMLElement} */ (el).dataset.socket || 0)];
    if (!s) return;
    state.socket = s.index; audio.play('ui_click', { vol: 0.4 });
    if (s.state === 'locked' && !s.rune) ui.toast('+15 강화 시 개방되는 칸입니다', 'red');
    redraw();
  });
  const swap = /** @type {HTMLButtonElement|null} */ (pane.querySelector('#rs-swap'));
  if (swap) swap.onclick = () => {
    const board = socketBoard(meta.eco, heroId, uid), s = board?.sockets[state.socket ?? defaultSocket(board)];
    if (!s?.rune) { ui.toast('룬이 박힌 칸을 먼저 고르세요', 'red'); return; }
    if (s.locked) { confirmRemove(meta, uid, heroId, s.index, ctx.back); return; }
    openRunePicker(meta, { uid, heroId, index: s.index, back: ctx.back });
  };
  const insert = /** @type {HTMLButtonElement|null} */ (pane.querySelector('#rs-insert'));
  if (insert) insert.onclick = () => {
    const board = socketBoard(meta.eco, heroId, uid); if (!board) return;
    const picked = board.sockets[state.socket ?? -1];
    const target = picked?.state === 'empty' ? picked : board.sockets.find((/** @type {any} */ s) => s.state === 'empty');
    if (!target) { ui.toast('빈 칸이 없습니다 · 룬 교체를 쓰세요', 'red'); return; }
    state.socket = target.index;
    openRunePicker(meta, { uid, heroId, index: target.index, back: ctx.back });
  };
  const overview = /** @type {HTMLElement|null} */ (pane.querySelector('#rs-overview'));
  if (overview) overview.onclick = () => openRuneOverview(meta, heroId, { back: ctx.back });
}

/** 빼기 확인(앱 안 확인창). */
export async function confirmRemove(/** @type {any} */ meta, /** @type {number} */ uid, /** @type {string} */ heroId, /** @type {number} */ index, /** @type {() => void} */ back) {
  const board = socketBoard(meta.eco, heroId, uid), s = board?.sockets[index]; if (!s?.rune) { back(); return; }
  const ok = await meta.ui.confirm('룬 빼기', '<b>' + esc(s.label) + '</b>을(를) 빼서 룬 가방으로 돌려보냅니다.<br>비용 <b>골드 ' + fmt(s.removeCost) + '</b> (보유 ' + fmt(meta.eco.s.gold) + ')', { ok: '빼기 · 골드 ' + fmt(s.removeCost), cancel: '취소' });
  if (ok) {
    const r = meta.eco.runeRemove(uid, index);
    if (r.ok) { audio.play('ui_confirm', { vol: 0.5 }); meta.ui.toast(esc(s.label) + ' 회수 · 골드 -' + fmt(r.cost), 'gold'); meta._sheetDirty = true; meta.refreshTop?.(); }
    else { meta.ui.toast(runeReasonText(r.reason), 'red'); audio.play('ui_error'); }
  }
  back();
}

// ------------------------------------------------------------------ 룬 고르기
/**
 * 룬 고르기 창. 왼쪽 소켓판(대상 칸 금빛 고리), 오른쪽 가문 필터·보유 룬 격자·상세·공명 미리보기, 아래 가문 공명 막대.
 * @param {any} meta
 * @param {{ uid: number, heroId: string, index: number, back: () => void }} opts
 */
export function openRunePicker(meta, { uid, heroId, index, back }) {
  const { ui, eco } = meta;
  const st = { filter: 'all', selected: '' };
  warmRuneSounds();
  const html = () => {
    const v = pickerView(eco, heroId, uid, index, st); if (!v) return '';
    const it = ITEM_BY_ID[v.board.itemId], inst = eco.s.inventory.find((/** @type {any} */ x) => x.uid === uid);
    const grid = v.entries.length ? v.entries.map((/** @type {any} */ e) => '<button type="button" class="rp-cell" data-key="' + e.key + '" style="--fam:' + e.color + '" aria-pressed="' + (v.selected?.key === e.key) + '"' + (e.capped ? ' data-capped="1"' : '') + '>' +
      runeHex(e.family, e.grade, { size: 'md' }) + '<em class="rp-count">x' + e.count + '</em><b>' + esc(e.label) + '</b>' + (e.capped ? '<i class="rp-cap">중복 상한 2</i>' : '') + '</button>').join('')
      : '<p class="rp-empty">' + (v.total ? '이 가문의 룬이 없습니다.' : '룬 가방이 비어 있습니다. 정예·보스 처치와 원정 상자에서 얻습니다.') + '</p>';
    const d = v.detail, p = v.preview;
    const detail = d ? '<div class="rp-detail" style="--fam:' + familyOf(v.selected.id).color + '">' + runeHex(v.selected.family, d.grade, { size: 'lg' }) +
      '<div class="rp-detail-copy"><b>' + esc(d.label) + '</b><span>' + esc(d.effect) + '</span></div>' +
      '<div class="rp-ladder">' + d.ladder.map((/** @type {any} */ s) => '<span' + (s.grade === d.grade ? ' class="on"' : '') + '>' + s.label + ' ' + esc(s.value) + '</span>').join('') + '</div>' +
      '<div class="rp-preview">' + (p.changes.length ? p.changes.map((/** @type {any} */ c) => '<span class="rp-change" style="--fam:' + FAMILY_BY_ID[c.id].color + '">' + familyGlyph(c.id) + esc(c.name) + ' ' + c.from + ' → ' + c.to + '</span>').join('') : '<span class="rp-change">가문 수 변화 없음</span>') +
      p.gained.map((/** @type {string} */ n) => '<span class="rp-gain">' + esc(n) + ' 발동 예정</span>').join('') + p.lost.map((/** @type {string} */ n) => '<span class="rp-lost">' + esc(n) + ' 꺼짐</span>').join('') +
      (d.capped ? '<span class="rp-lost">중복 상한 2 · 효과 0</span>' : '') + '</div></div>' : '<div class="rp-detail rp-detail-empty">박을 룬을 고르세요.</div>';
    const fams = (p ? p.families : v.board.families);
    const synList = (p ? p.synergies : v.board.synergies).filter((/** @type {any} */ s) => s.active || (p && p.gained.includes(s.name)));
    return '<div class="rune-picker">' +
      '<header class="is-head"><span class="is-head-art rar-' + it.rarity + '">' + itemIconHtml(it, '', { heroId }) + '</span><div class="is-head-copy"><h2 style="color:' + RARITY_COLOR[it.rarity] + '">' + esc(it.name) + ' <span class="is-plus">+' + inst.enh + '</span></h2><div class="is-tags"><b style="color:' + RARITY_COLOR[it.rarity] + '">' + RARITY_INFO[it.rarity].name + '</b> · ' + SLOT_NAME[it.slot] + ' · ' + (v.mode === 'replace' ? esc(runeLabel(v.current)) + ' 교체' : (index + 1) + '번 칸에 박기') + '</div></div><button type="button" class="btn btn-ghost btn-sm" id="rp-close" aria-label="닫기">닫기</button></header>' +
      '<div class="rp-main"><div class="rp-left">' + boardHtml(v.board, index, heroId) + '</div>' +
      '<section class="rp-right" aria-label="룬 선택"><div class="rp-top"><h3>룬 선택</h3><div class="rp-filters" role="tablist">' + v.filters.map((/** @type {any} */ f) => '<button type="button" role="tab" data-filter="' + f.id + '" aria-selected="' + (v.filter === f.id) + '">' + (f.id === 'all' ? '' : familyGlyph(f.id)) + f.name + '</button>').join('') + '</div></div>' +
      '<div class="rp-grid">' + grid + '</div>' + detail + '</section></div>' +
      '<div class="rp-resonance"><span class="rp-res-title">가문 공명</span>' + fams.map((/** @type {any} */ f) => {
        const before = v.board.counts[f.id], changed = p && before !== f.count;
        return '<span class="rp-bar" style="--fam:' + f.color + '"' + (changed ? ' data-changed="1"' : '') + '>' + familyGlyph(f.id) + '<b>' + f.name + '</b><i>' + [0, 1, 2].map((k) => '<u' + (k < Math.min(3, f.count) ? ' class="on"' : '') + '></u>').join('') + '</i><em>' + (changed ? before + '→' + f.count : f.count) + '</em></span>';
      }).join('') + '<span class="rp-syns">' + (synList.length ? synList.map((/** @type {any} */ s) => synergyChip(s, { glow: !!p?.gained.includes(s.name) })).join('') : '<span class="rs-syn-none">켜진 공명 없음</span>') + '</span></div>' +
      '<footer class="rp-foot"><small>' + esc(v.costNote) + '</small>' + (v.mode === 'replace' ? '<button type="button" class="btn btn-ghost btn-sm" id="rp-remove">' + esc(v.removeText) + '</button>' : '') +
      '<button type="button" class="btn rs-btn-cream" id="rp-cancel">취소</button><button type="button" class="btn btn-gold" id="rp-go"' + (v.selected && v.affordable ? '' : ' disabled') + '>' + esc(v.action) + '</button></footer></div>';
  };
  const bind = (/** @type {HTMLElement} */ b) => {
    const redraw = () => { b.innerHTML = html(); bind(b); };
    /** @type {HTMLElement} */ (b.querySelector('#rp-close')).onclick = back;
    /** @type {HTMLElement} */ (b.querySelector('#rp-cancel')).onclick = back;
    b.querySelectorAll('[data-filter]').forEach((el) => /** @type {HTMLElement} */ (el).onclick = () => { st.filter = /** @type {HTMLElement} */ (el).dataset.filter || 'all'; st.selected = ''; audio.play('ui_click', { vol: 0.35 }); redraw(); });
    b.querySelectorAll('.rp-cell').forEach((el) => /** @type {HTMLElement} */ (el).onclick = () => { st.selected = /** @type {HTMLElement} */ (el).dataset.key || ''; audio.play('ui_click', { vol: 0.35 }); redraw(); });
    const remove = /** @type {HTMLElement|null} */ (b.querySelector('#rp-remove'));
    if (remove) remove.onclick = () => confirmRemove(meta, uid, heroId, index, back);
    /** @type {HTMLElement} */ (b.querySelector('#rp-go')).onclick = async () => {
      const v = pickerView(eco, heroId, uid, index, st); if (!v?.selected) return;
      const rune = { id: v.selected.id, grade: v.selected.grade };
      if (v.mode === 'replace') {
        const ok = await ui.confirm('룬 교체', '<b>' + esc(runeLabel(v.current)) + '</b>을(를) 빼서 가방으로 돌리고 <b>' + esc(v.selected.label) + '</b>을(를) 박습니다.<br>빼기 비용 <b>골드 ' + fmt(v.cost) + '</b> (보유 ' + fmt(eco.s.gold) + ')', { ok: '교체 · 골드 ' + fmt(v.cost), cancel: '취소' });
        if (!ok) { openRunePicker(meta, { uid, heroId, index, back }); return; }
      }
      const r = v.mode === 'replace' ? eco.runeReplace(uid, index, rune) : eco.runeInsert(uid, index, rune);
      if (!r.ok) { ui.toast(runeReasonText(r.reason), 'red'); audio.play('ui_error'); if (v.mode === 'replace') openRunePicker(meta, { uid, heroId, index, back }); return; }
      playRuneSound('insert'); audio.vibe?.(20);
      ui.toast(esc(v.selected.label) + (v.mode === 'replace' ? ' 교체 완료' : ' 박기 완료') + (v.preview?.gained.length ? ' · ' + esc(v.preview.gained.join(', ')) + ' 발동' : ''), 'gold');
      meta._sheetDirty = true; meta.refreshTop?.();
      back();
    };
    b.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); back(); } };
    const picked = /** @type {HTMLElement|null} */ (b.querySelector('.rp-cell[aria-pressed="true"]'));
    const grid = /** @type {HTMLElement|null} */ (b.querySelector('.rp-grid'));
    // 고른 룬이 가로 스크롤 밖이면 보이게 맞춘다(세로 공간이 없어 격자는 가로로 흐른다).
    if (picked && grid) { const gl = grid.getBoundingClientRect(), pl = picked.getBoundingClientRect(); if (pl.right > gl.right) grid.scrollLeft += pl.right - gl.right + 4; else if (pl.left < gl.left) grid.scrollLeft -= gl.left - pl.left + 4; }
    /** @type {HTMLElement|null} */ (picked || b.querySelector('#rp-cancel'))?.focus({ preventScroll: true });
  };
  ui.modal(html(), { onOpen: bind });
}

// ------------------------------------------------------------------ 룬 각인판(전체 보기)
/**
 * 영웅 4부위 소켓과 가문 공명을 한 번에 본다. 장비 칸을 누르면 그 장비의 룬 소켓 탭으로 간다.
 * @param {any} meta @param {string} heroId @param {{ back?: (() => void)|null }} [opts]
 */
export function openRuneOverview(meta, heroId, { back = null } = {}) {
  const { ui, eco } = meta;
  let showFx = false, release = /** @type {null|(() => void)} */ (null);
  const html = () => {
    const v = overviewView(eco, heroId);
    const rows = v.rows.map((r) => '<div class="ro-row" data-slot="' + r.slot + '"><span class="ro-slot">' + r.slotName + '</span>' +
      (r.inst ? '<button type="button" class="ro-item rar-' + r.rarity + '" data-uid="' + r.uid + '" aria-label="' + esc(r.name) + ' 룬 소켓 열기">' + itemIconHtml(ITEM_BY_ID[r.inst.id], '', { heroId }) + '<em>+' + r.enh + '</em></button>' +
        '<span class="ro-sockets">' + (r.sockets.length ? r.sockets.map((s) => '<button type="button" class="ro-socket" data-uid="' + r.uid + '" data-socket="' + s.index + '" data-state="' + s.state + '"' + (s.duplicate ? ' data-dup="1"' : '') + ' aria-label="' + esc(r.slotName + ' ' + (s.index + 1) + '번 · ' + (s.state === 'locked' ? '+15 강화 시 개방' : s.rune ? s.label : '빈 소켓')) + '">' +
          (s.state === 'locked' ? emptyHex('locked', 'md') : s.rune ? runeHex(RUNE_BY_ID[s.rune.id].family, s.rune.grade, { size: 'md' }) : emptyHex('empty', 'md')) + (s.rune && s.state !== 'locked' ? '<small>' + esc(s.label) + '</small>' : '') + '</button>').join('') : '<span class="ro-none">소켓 없음 · 스페셜 이상</span>') + '</span>'
        : '<span class="ro-item ro-item-empty">없음</span><span class="ro-sockets"></span>') + '</div>').join('');
    return '<div class="rune-overview"><div class="ro-hero"><span class="ro-hero-name">' + esc(HEROES[heroId]?.name || '') + '</span><img class="ro-portrait" alt="' + esc(HEROES[heroId]?.name || '') + '"><span class="ro-pedestal" aria-hidden="true"></span></div>' +
      '<section class="ro-board" aria-label="룬 각인판"><header class="ro-head"><b class="ro-title" role="heading" aria-level="2">룬 각인판</b><button type="button" class="ro-fx" id="ro-fx" aria-expanded="' + showFx + '">총 룬 효과 보기 ›</button><button type="button" class="btn btn-ghost btn-sm" id="ro-close">닫기</button></header>' +
      (showFx ? '<div class="ro-fx-list">' + (v.effects.length ? v.effects.map((t) => '<span>' + esc(t) + '</span>').join('') : '<span>박힌 룬 효과가 없습니다.</span>') + '</div>' : '<div class="ro-rows">' + rows + '</div>') +
      '<div class="ro-res"><span class="rp-res-title">가문 공명</span>' + v.families.map((f) => '<span class="rp-bar" style="--fam:' + f.color + '">' + familyGlyph(f.id) + '<b>' + f.name + '</b><i>' + [0, 1, 2].map((k) => '<u' + (k < Math.min(3, f.count) ? ' class="on"' : '') + '></u>').join('') + '</i><em>' + f.count + '</em></span>').join('') + '</div>' +
      '<footer class="ro-foot"><span class="ro-chips">' + v.chips.map((s) => synergyChip(s, { suffix: s.active ? ' · ' + s.effect : '' })).join('') + '</span><button type="button" class="btn btn-gold" id="ro-auto"' + (v.plan.length ? '' : ' disabled') + '>자동 장착' + (v.plan.length ? ' <small>빈 칸 ' + v.plan.length + '</small>' : '') + '</button></footer></section></div>';
  };
  const close = () => { release?.(); release = null; if (back) back(); else ui.closeModal(); };
  const bind = (/** @type {HTMLElement} */ b) => {
    const redraw = () => { release?.(); release = null; b.innerHTML = html(); bind(b); };
    const img = /** @type {HTMLImageElement|null} */ (b.querySelector('.ro-portrait'));
    if (img && meta.app) { try { const r = bindHeroPortrait(img, meta.app, heroId); release = typeof r === 'function' ? r : null; } catch (error) { console.warn('rune overview portrait', error); } }
    /** @type {HTMLElement} */ (b.querySelector('#ro-close')).onclick = close;
    /** @type {HTMLElement} */ (b.querySelector('#ro-fx')).onclick = () => { showFx = !showFx; audio.play('ui_click', { vol: 0.35 }); redraw(); };
    const openItem = (/** @type {HTMLElement} */ el) => { release?.(); release = null; meta.showItem(+(el.dataset.uid || 0), heroId, { focus: 'rune', socket: el.dataset.socket === undefined ? null : +el.dataset.socket }); };
    b.querySelectorAll('.ro-item[data-uid], .ro-socket').forEach((el) => /** @type {HTMLElement} */ (el).onclick = () => openItem(/** @type {HTMLElement} */ (el)));
    const auto = /** @type {HTMLButtonElement|null} */ (b.querySelector('#ro-auto'));
    if (auto) auto.onclick = () => {
      const plan = overviewView(eco, heroId).plan; let done = 0;
      for (const step of plan) { const r = eco.runeInsert(step.uid, step.index, step.rune); if (r.ok) done++; else { ui.toast(runeReasonText(r.reason), 'red'); break; } }
      if (done) { playRuneSound('insert'); ui.toast('빈 칸 ' + done + '개에 룬을 박았습니다', 'gold'); meta._sheetDirty = true; meta.refreshTop?.(); }
      redraw();
    };
    b.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    /** @type {HTMLElement|null} */ (b.querySelector('#ro-auto:not([disabled])') || b.querySelector('#ro-close'))?.focus({ preventScroll: true });
  };
  warmRuneSounds();
  ui.modal(html(), { onOpen: bind, onClose: () => { release?.(); release = null; if (meta._sheetDirty && !back) { meta._sheetDirty = false; meta.renderHeroes?.(); } } });
}
