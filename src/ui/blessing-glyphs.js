/**
 * 전운·룬 가문 문양(불꽃·물결·번개·산). 가문 색은 src/data/runes.js RUNE_FAMILIES 와 같다.
 * 이미지 파일 없이 인라인 SVG 로 그려 릴 띠를 여러 칸 만들어도 내려받기가 없다.
 */
import { BOONS } from '../data/masterworks.js';
import { RUNE_FAMILIES } from '../data/runes.js';

/** @type {Record<string, typeof RUNE_FAMILIES[number]>} */
export const FAMILY_BY_ID = Object.fromEntries(RUNE_FAMILIES.map(f => [f.id, f]));
/** @type {Record<string, typeof BOONS[number]>} */
export const BOON_BY_ID = Object.fromEntries(BOONS.map(b => [b.id, b]));
export const GRADE_LABEL = /** @type {Record<number, string>} */ ({ 1: 'I', 2: 'II', 3: 'III' });

const PATHS = {
  ember: '<path d="M33 5c3 10 13 15 15 27 2 12-6 25-17 25S12 49 13 37c1-8 6-12 7-19 4 5 4 9 7 11 2-9 0-16 6-24z" fill="url(#g)"/><path d="M32 30c3 6 8 9 8 16 0 6-4 10-9 10s-8-4-8-9c0-6 5-8 5-13 2 3 2 5 4 6 1-4-1-6 0-10z" fill="#fff3c4" opacity=".92"/>',
  tide: '<path d="M34 9c13 0 23 10 23 23S47 57 33 57C19 57 8 47 8 34c0-11 8-19 18-19 9 0 15 6 15 14 0 7-5 12-11 12-5 0-9-4-9-8 0-4 3-7 7-7 3 0 5 2 5 5h-5c0-1-1-1-1-1-1 0-2 1-2 3 0 2 2 3 4 3 4 0 6-3 6-7 0-5-4-9-9-9-7 0-12 6-12 13 0 9 8 16 18 16 11 0 19-8 19-19S44 15 33 15c-6 0-11 2-15 5l-3-4c5-5 12-7 19-7z" fill="url(#g)"/>',
  storm: '<path d="M38 4 14 36h14l-6 24 28-34H35l9-22z" fill="url(#g)"/><path d="M36 10 20 33h11l-4 16 16-19H33l6-20z" fill="#f3ecff" opacity=".85"/>',
  stone: '<path d="M4 54 22 22l8 12 9-18 21 38z" fill="url(#g)"/><path d="m22 22 4 15 4-3 9-18-1 14 6 7-11-6-7 7-4-16z" fill="#fff0c9" opacity=".55"/><path d="m39 16 4 8-4-1-3 3z" fill="#fff6dc"/>',
};
const STOPS = {
  ember: ['#fff0a0', '#ffb43d', '#e2441e'],
  tide: ['#d9f6ff', '#5fc2ff', '#1d5fa8'],
  storm: ['#f1e8ff', '#a585ff', '#5a2fd1'],
  stone: ['#ffe9b0', '#d9a24a', '#7c4f24'],
};

/** 가문 문양 SVG 문자열. uid 는 같은 문서 안 그라데이션 id 충돌을 막는다. */
export function glyphSvg(family, uid) {
  const f = STOPS[/** @type {keyof typeof STOPS} */ (family)] ? family : 'ember';
  const [a, b, c] = STOPS[/** @type {keyof typeof STOPS} */ (f)], id = `bg${uid}`;
  return `<svg class="blessing-glyph" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>${PATHS[/** @type {keyof typeof PATHS} */ (f)].replaceAll('url(#g)', `url(#${id})`)}</svg>`;
}

const pct = (/** @type {number} */ v) => `${Math.round(v * 1000) / 10}`.replace(/\.0$/, '');
/** 등급 n 효과 한 줄(각인 효과 × 등급). 연쇄는 전투 상한(2명)을 따른다. */
export function boonEffectText(id, grade) {
  const boon = BOON_BY_ID[id]; if (!boon) return '';
  const n = Math.max(1, Math.min(3, grade | 0));
  return Object.entries(boon.effects).map(([k, v]) => {
    const x = v * n;
    switch (k) {
      case 'atk': return `공격력 +${pct(x)}%`;
      case 'finisher': return `마무리 피해 +${pct(x)}%`;
      case 'healOnKill': return `처치 회복 ${pct(x)}%`;
      case 'perfectHeal': return `회피 회복 ${pct(x)}%`;
      case 'hp': return `최대 체력 +${pct(x)}%`;
      case 'speed': return `이동 속도 +${pct(x)}%`;
      case 'chain': return `연쇄 ${Math.min(2, x)}명`;
      case 'breakPower': return `균형 파괴 +${pct(x)}%`;
      case 'rewardMul': return `완료 명성 +${pct(x)}%`;
      default: return '';
    }
  }).filter(Boolean).join(' · ');
}

/** 등급 점(◆) n 개. */
export const gradeDots = (/** @type {number} */ grade) => '<i></i>'.repeat(Math.max(1, Math.min(3, grade | 0)));
