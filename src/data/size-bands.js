// 크기 띠 — 보스·정예·잡몹이 화면에서 한눈에 구분되게 영웅 키 대비 보이는 키를 묶는다(2026-10-28 대표님 실기기 피드백
// "보스 크기를 주인공보다 크게, 잡몹과 다르다는 느낌을 명확히"). 판정 반경·피격 높이는 def.scale 그대로 두고 모델 크기만 맞춘다.
// 보이는 키 = 라이브러리 heightM × 로스터 배율 × def.scale × def.visualScale (enemies.js 생성자와 같은 곱).
import manifest from '../../asset-library/manifest.json';
import { MONSTER_ROSTER } from './monster-roster.js';

export const SIZE_BANDS = Object.freeze({ boss: { min: 1.8 }, elite: { min: 1.3, max: 1.75 }, trash: { max: 1.25 } });
const HEIGHTS = new Map((manifest.assets || manifest).map((a) => [a.id, a.heightM]));
export const HERO_HEIGHT_M = HEIGHTS.get('hero_knight_t1') || 1.8;

/** 크기 띠 보정 전, 영웅 키 대비 보이는 키 비율. 모델을 모르면 null. */
export function rawHeightRatio(def) {
  const r = def && MONSTER_ROSTER[def.model];
  // 기준은 로스터 1순위 자산이다. 대체 자산으로 그려질 때는 enemies.js 가 보정을 건너뛴다.
  const h = r && HEIGHTS.get(r.asset);
  return h ? h * (r.scale ?? 1) * def.scale * (def.visualScale ?? 1) / HERO_HEIGHT_M : null;
}
/** 모델 크기에 곱할 보정 배율(띠 안이면 1). */
export function sizeBandMul(def) {
  const ratio = rawHeightRatio(def);
  if (!ratio) return 1;
  const band = SIZE_BANDS[def.boss ? 'boss' : def.elite ? 'elite' : 'trash'];
  if (band.min && ratio < band.min) return band.min / ratio;
  if (band.max && ratio > band.max) return band.max / ratio;
  return 1;
}
