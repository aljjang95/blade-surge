// 도감(지역·보스·몬스터·영웅). 모험 기록 화면의 '도감' 버튼에서 열린다. 데이터는 lore.codexEntries(progress).
import './lore.css';
import * as lore from '../data/lore.js';
import { playChapterScene } from './lore-scene.js';

export const CODEX_TABS = Object.freeze([
  { id: 'region', label: '지역' }, { id: 'boss', label: '보스' }, { id: 'monster', label: '몬스터' }, { id: 'hero', label: '영웅' },
]);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 도감 항목. lore.codexEntries 가 아직 없으면 빈 목록(화면은 '준비 중' 안내). */
export function codexEntriesFor(progress) {
  try { const rows = typeof lore.codexEntries === 'function' ? lore.codexEntries(progress || {}) : []; return Array.isArray(rows) ? rows : []; } catch { return []; }
}

export function codexCardHtml(entry, { canReplay = true } = {}) {
  if (!entry.unlocked) {
    return `<article class="lore-card locked" data-codex-id="${esc(entry.id)}"><h3>？？？</h3><p>${esc(entry.hint || '아직 알려지지 않았다.')}</p></article>`;
  }
  const replay = entry.tab === 'region' && canReplay && Number.isInteger(entry.ch) ? `<button type="button" class="lore-replay" data-replay="${entry.ch}">장면 다시 보기</button>` : '';
  return `<article class="lore-card" data-codex-id="${esc(entry.id)}"><h3>${esc(entry.name)}${entry.title ? `<small>${esc(entry.title)}</small>` : ''}</h3><p>${esc(entry.text)}</p>${replay}</article>`;
}

export function codexListHtml(entries, tab, opts) {
  const rows = entries.filter((e) => e.tab === tab);
  if (!rows.length) return '<div class="lore-codex-empty">아직 기록이 없습니다.</div>';
  return rows.map((e) => codexCardHtml(e, opts)).join('');
}

export function codexHtml(entries, tab = 'region') {
  const open = entries.filter((e) => e.unlocked).length;
  return `<div class="lore-codex"><div class="lore-codex-head"><h2>도감 <small>${open}/${entries.length}</small></h2><button type="button" class="btn btn-ghost btn-sm lore-codex-back" id="codex-back">기록으로</button></div>
    <div class="lore-codex-tabs" role="group" aria-label="도감 분류">${CODEX_TABS.map((t) => `<button type="button" data-codex-tab="${t.id}" aria-pressed="${t.id === tab}">${t.label}</button>`).join('')}</div>
    <div class="lore-codex-list" id="codex-list" tabindex="-1">${codexListHtml(entries, tab)}</div></div>`;
}

/**
 * 모달 상자 안을 도감으로 바꾼다.
 * @param {HTMLElement} box 모달 상자
 * @param {{ progress: any, track?: Function, onBack?: Function }} ctx
 */
export function mountCodex(box, { progress, track, onBack } = {}) {
  const entries = codexEntriesFor(progress);
  const show = (tab) => {
    box.innerHTML = codexHtml(entries, tab);
    try { track?.('codex_open', { tab }); } catch { /* 계측 실패는 무시 */ }
    box.querySelectorAll('[data-codex-tab]').forEach((b) => { b.onclick = () => show(b.dataset.codexTab); });
    box.querySelectorAll('[data-replay]').forEach((b) => { b.onclick = () => playChapterScene(Number(b.dataset.replay), { replay: true, track }); });
    box.querySelector('#codex-back').onclick = () => onBack?.();
    box.querySelector(`[data-codex-tab="${tab}"]`)?.focus({ preventScroll: true });
  };
  show('region');
}
