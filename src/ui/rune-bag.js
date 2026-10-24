/**
 * 제작 공방 '룬 가방 · 합성' 칸(rune-bag-merge). 왼쪽 가문 4줄 × 룬 3종 가방, 오른쪽 대장간 합성 패널.
 * 합성은 같은 룬 3개 → 다음 등급 1개, 100% 확정(D19). 저장은 economy.runeMerge 만 쓴다.
 */
import './rune.css';
import { fmt } from './ui.js';
import { uiArt } from './illustrated.js';
import { audio } from '../engine/audio.js';
import { RUNE_GRADE_LABEL } from '../data/runes.js';
import { runeHex } from './rune-art.js';
import { playRuneSound, warmRuneSounds } from './rune-sound.js';
import { bagView, mergeView, mergeTarget, craftInfo, SOURCE_TEXT } from './rune-view.js';
import { runeReasonText, openRuneOverview } from './rune-socket.js';

const esc = (/** @type {unknown} */ value) => String(value).replace(/[&<>"]/g, (ch) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const dots = (/** @type {number[]} */ counts) => '<span class="rb-dots">' + counts.map((n) => '<i' + (n ? ' class="on"' : '') + '></i>').join('') + '</span>';

/** 화면 상태(고른 룬·목표 등급)를 기억하는 칸 하나. */
export function runeBagHtml(/** @type {any} */ eco, /** @type {{ id: string, toGrade: number|null, flash?: boolean }} */ st) {
  const rs = eco.runeState(), view = bagView(rs.bag);
  const id = st.id, toGrade = st.toGrade || mergeTarget(rs.bag, id);
  const m = mergeView({ bag: rs.bag, gold: eco.s.gold, dust: rs.dust }, id, toGrade);
  const cells = view.map((f) => f.runes.map((r) => '<button type="button" class="rb-cell" data-rune="' + r.id + '" style="--fam:' + f.color + '" aria-pressed="' + (r.id === id) + '"' + (r.total ? '' : ' data-none="1"') + '>' +
    runeHex(f.id, r.best || 1, { size: 'md', cls: r.total ? '' : 'rune-hex-dim' }) + '<span class="rb-copy"><b>' + esc(r.name) + '</b>' + dots(r.counts) + '<small>' + r.counts.map((n, i) => RUNE_GRADE_LABEL[i + 1] + ' x' + n).join(' · ') + '</small></span></button>').join('')).join('');
  const mats = m ? m.slots.map((have) => '<span class="rb-mat' + (have ? '' : ' short') + '">' + runeHex(m.family, m.fromGrade, { size: 'md', cls: have ? '' : 'rune-hex-dim' }) + '<small>' + esc(m.from) + '</small></span>').join('') : '';
  return '<div class="rune-bag">' +
    '<section class="rb-bag" aria-label="룬 가방"><header class="rb-head"><h3>룬 가방</h3><button type="button" class="rb-link" id="rb-overview">룬 각인판 ›</button></header><div class="rb-grid">' + cells + '</div><p class="rb-src">' + esc(SOURCE_TEXT) + '</p></section>' +
    '<section class="rb-merge" aria-label="합성" style="--forge:url(' + uiArt('nav-forge') + ')"><header class="rb-head"><h3>합성</h3><span class="rb-grades" role="tablist">' + [2, 3].map((g) => '<button type="button" role="tab" data-grade="' + g + '" aria-selected="' + (toGrade === g) + '">' + RUNE_GRADE_LABEL[g] + ' 만들기</button>').join('') + '</span></header>' +
    (m ? '<div class="rb-forge' + (st.flash ? ' rb-flash' : '') + '"><div class="rb-mats">' + mats + '</div><span class="rb-arrow" aria-hidden="true"></span>' +
      '<div class="rb-result">' + runeHex(m.family, m.toGrade, { size: 'lg' }) + '<b>' + esc(m.to) + '</b></div>' +
      '<span class="rb-cost' + (eco.s.gold < m.gold ? ' short' : '') + '"><i class="ic ic-gold"></i> 골드 ' + fmt(m.gold) + (m.dust ? ' · 룬 가루 ' + m.dust : '') + '</span></div>' +
      '<button type="button" class="btn btn-gold rb-go" id="rb-go"' + (m.ok ? '' : ' disabled') + '>' + m.button + '</button><p class="rb-reason">' + esc(m.reasonText || '재료 ' + m.need + '개 · 실패 없음 · 확정 ' + m.chance + '%') + '</p>' : '') +
    '<div class="rb-dust"><span class="rb-dust-have"><img src="/img/icon_fragment.webp" alt="" onerror="this.remove()"><b>룬 가루</b><em>' + fmt(rs.dust) + '</em></span><span class="rb-crafts">' +
      craftInfo().map((c) => '<button type="button" class="rb-craft" data-craft="' + c.id + '" disabled title="곧 열립니다">' + esc(c.text) + '<small>곧 열림</small></button>').join('') + '</span></div></section></div>';
}

/**
 * 요소 하나에 룬 가방 칸을 그리고 연결한다. 다시 부르면 다시 그린다.
 * @param {HTMLElement} el @param {any} app @param {{ onChange?: () => void }} [opts]
 */
export function mountRuneBag(el, app, opts = {}) {
  const eco = app.eco;
  /** @type {{ id: string, toGrade: number|null, flash?: boolean }} */
  const st = /** @type {any} */ (el).__runeBag ||= { id: firstRune(eco), toGrade: null };
  warmRuneSounds();
  const draw = () => {
    el.innerHTML = runeBagHtml(eco, st); st.flash = false;
    el.querySelectorAll('.rb-cell').forEach((b) => /** @type {HTMLElement} */ (b).onclick = () => { st.id = /** @type {HTMLElement} */ (b).dataset.rune || st.id; st.toGrade = null; audio.play('ui_click', { vol: 0.35 }); draw(); });
    el.querySelectorAll('[data-grade]').forEach((b) => /** @type {HTMLElement} */ (b).onclick = () => { st.toGrade = +(/** @type {HTMLElement} */ (b).dataset.grade || 2); audio.play('ui_click', { vol: 0.35 }); draw(); });
    const ov = /** @type {HTMLElement|null} */ (el.querySelector('#rb-overview'));
    if (ov && app.meta) ov.onclick = () => openRuneOverview(app.meta, eco.s.selected);
    const go = /** @type {HTMLButtonElement|null} */ (el.querySelector('#rb-go'));
    if (go) go.onclick = () => {
      const toGrade = st.toGrade || mergeTarget(eco.runeState().bag, st.id);
      const r = eco.runeMerge(st.id, toGrade);
      if (!r.ok) { app.ui?.toast?.(runeReasonText(r.reason), 'red'); audio.play('ui_error'); return; }
      playRuneSound('merge'); audio.vibe?.([20, 30, 40]);
      app.ui?.toast?.(esc(mergeView({ bag: eco.runeState().bag, gold: eco.s.gold, dust: eco.runeState().dust }, st.id, toGrade)?.to || '') + ' 합성 완료', 'gold');
      st.flash = true; st.toGrade = toGrade; app.meta?.refreshTop?.(); draw(); opts.onChange?.();
    };
  };
  draw();
  return draw;
}

/** 처음 고를 룬: 합성할 수 있는 룬 → 가장 많이 가진 룬 → 첫 룬. */
function firstRune(/** @type {any} */ eco) {
  const view = bagView(eco.runeState().bag).flatMap((f) => f.runes);
  return (view.find((r) => r.counts[0] >= 3 || r.counts[1] >= 3) || [...view].sort((a, b) => b.total - a.total)[0] || view[0]).id;
}
