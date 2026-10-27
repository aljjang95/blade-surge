import { expect, test } from 'bun:test';
import { ENEMIES } from '../src/data/stages.js';
import { SIZE_BANDS, rawHeightRatio, sizeBandMul } from '../src/data/size-bands.js';

// 2026-10-28 대표님: 보스는 영웅보다 확실히 크고 잡몹과 다르게. 모든 적(캠페인·원정·고통·전용 모델 보스)이 띠 안에 든다.
test('모든 적의 보이는 키가 계급 크기 띠 안이다(보스 ≥ 영웅×1.8, 정예 1.3~1.75, 잡몹 ≤ 1.25)', () => {
  let counted = 0;
  for (const [id, def] of Object.entries(ENEMIES) as [string, any][]) {
    const raw = rawHeightRatio(def);
    expect(raw, id).not.toBeNull();
    const ratio = raw! * sizeBandMul(def), band: any = SIZE_BANDS[def.boss ? 'boss' : def.elite ? 'elite' : 'trash'];
    if (band.min) expect(ratio, id).toBeGreaterThanOrEqual(band.min - 1e-9);
    if (band.max) expect(ratio, id).toBeLessThanOrEqual(band.max + 1e-9);
    counted++;
  }
  expect(counted).toBeGreaterThan(150);
});
