import { SIGNATURES as RANGER, PRELUDES as RANGER_PRELUDES, screenReach, SCREEN_REACH } from './sig-ranger.js';
import { SIGNATURES as KNIGHT, PRELUDES as KNIGHT_PRELUDES } from './sig-knight.js';
import { SIGNATURES as MAGE, PRELUDES as MAGE_PRELUDES } from './sig-mage.js';
import { SIGNATURES as ROGUE, PRELUDES as ROGUE_PRELUDES } from './sig-rogue.js';
import { SIGNATURES as BARBARIAN, PRELUDES as BARBARIAN_PRELUDES } from './sig-barbarian.js';

/** @typedef {{ fx: any, impact: any, player: any, at: any, f: any, lite: boolean, scale: number, targets?: (max?: number, range?: number, sorted?: boolean) => any[] }} SigCtx */
export { screenReach, SCREEN_REACH };

/**
 * 궁극기 예비 표식 합본(skills.js start 에서 바로 부른다). 영웅별 구현은 sig-<영웅>.js.
 * @type {Record<string, (ctx: SigCtx) => void>}
 */
export const SKILL_PRELUDES = {
  ...RANGER_PRELUDES,
  ...KNIGHT_PRELUDES,
  ...ROGUE_PRELUDES,
  ...MAGE_PRELUDES,
  ...BARBARIAN_PRELUDES,
};

/** 영웅별 서명 합본. 영웅마다 sig-<영웅>.js 가 맡는다(궁수 = sig-ranger.js). */
export const SKILL_SIGNATURES = { ...RANGER, ...KNIGHT, ...MAGE, ...ROGUE, ...BARBARIAN };
