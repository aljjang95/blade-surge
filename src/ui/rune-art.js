/**
 * 육각 룬석 아이콘. 가문 원판(색·문양) 4종 + 금색 등급 점 오버레이로 12종×3등급을 만든다(개별 그림 36장 없음).
 * 문자열만 만든다(DOM 없음). 모양·광택은 rune.css 의 .rune-hex 가 맡는다.
 */
import { RUNE_FAMILIES } from '../data/runes.js';

const FAMILY = Object.fromEntries(RUNE_FAMILIES.map((f) => [f.id, f]));
/** 가문 문양(24 뷰박스). 불꽃·물결(소용돌이)·번개·산. */
const GLYPH = {
  flame: '<path fill="#fff3c4" d="M12 1.8c.9 3.4 4.9 5.6 4.9 10.6a4.9 4.9 0 0 1-9.8 0c0-2.6 1.4-3.9 1.9-6.4.9 1 1.6 2.2 1.7 3.8 1-1.8 1.6-4.5 1.3-8z"/><path fill="#ff9a2e" d="M12 10.6c.6 1.6 2.4 2.5 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-1.2.8-1.8 1.1-2.8.4.4.7 1 .8 1.6.4-.9.6-2 .5-3.2z"/>',
  wave: '<path fill="none" stroke="#e8f6ff" stroke-width="2.3" stroke-linecap="round" d="M13 12.3a1.3 1.3 0 1 1-1.6-1.3 3 3 0 1 1-2.2 4.6 5 5 0 1 1 8.8-3.4 7 7 0 0 1-7.3 7"/>',
  bolt: '<path fill="#f3ecff" stroke="#3fd6c8" stroke-width=".8" d="M13.6 1.6 5.4 13.4h5.4l-1.4 9 8.8-12.4h-5.6z"/>',
  mountain: '<path fill="#ffe9b8" d="M1.8 20.4 9 7.6l3.1 5 3-4.2 7.1 12z"/><path fill="#fff" d="M9 7.6l2 3.3-1.2-.7-.8 1.3-.9-1.3-1 .5z"/>',
};

/** 등급 점(금색) 1~3. */
export const gradeDots = (/** @type {number} */ grade) => '<span class="rune-dots" aria-hidden="true">' + '<i></i>'.repeat(Math.max(0, Math.min(3, grade | 0))) + '</span>';

/**
 * 룬석 아이콘 HTML.
 * @param {string} family 가문 id
 * @param {number} grade 0 이면 점 없음
 * @param {{ size?: 'sm'|'md'|'lg', cls?: string }} [opts]
 */
export function runeHex(family, grade = 0, { size = 'md', cls = '' } = {}) {
  const f = FAMILY[family] || RUNE_FAMILIES[0];
  return '<span class="rune-hex rune-hex-' + size + (cls ? ' ' + cls : '') + '" data-family="' + f.id + '" style="--fam:' + f.color + ';--fam2:' + f.accent + '" aria-hidden="true">' +
    '<span class="rune-hex-core"><svg viewBox="0 0 24 24">' + GLYPH[/** @type {keyof typeof GLYPH} */ (f.glyph)] + '</svg></span>' + (grade ? gradeDots(grade) : '') + '</span>';
}
/** 빈 칸·잠긴 칸 육각. */
export const emptyHex = (/** @type {'empty'|'locked'|'target'} */ kind, size = 'md') =>
  '<span class="rune-hex rune-hex-' + size + ' rune-hex-' + kind + '" aria-hidden="true"><span class="rune-hex-core">' +
  (kind === 'locked' ? '<svg viewBox="0 0 24 24"><path fill="#c9d3dc" d="M7 10V8a5 5 0 0 1 10 0v2h1.2v10H5.8V10zm2.4 0h5.2V8a2.6 2.6 0 0 0-5.2 0z"/></svg>' : '<b>+</b>') + '</span></span>';
/** 가문 작은 문양(칩·막대용). */
export const familyGlyph = (/** @type {string} */ family) => {
  const f = FAMILY[family] || RUNE_FAMILIES[0];
  return '<svg class="rune-glyph" viewBox="0 0 24 24" style="--fam:' + f.color + '" aria-hidden="true">' + GLYPH[/** @type {keyof typeof GLYPH} */ (f.glyph)].replace(/#fff3c4|#e8f6ff|#f3ecff|#ffe9b8/g, f.color) + '</svg>';
};
