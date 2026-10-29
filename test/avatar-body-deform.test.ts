import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import manifest from '../asset-library/manifest.json';
import { AVATARS } from '../src/data/avatars.js';
import { resolveAssetSource } from '../src/engine/library-assets.js';
import { filePathFor } from '../tools/art/ranger-runtime-loader.mjs';
import { legBleed } from '../tools/art/split-leg-weights.mjs';
import { measureBodyDeform } from '../tools/art/measure-body-deform.mjs';

// 2026-10-29 대표님 "궁수(실바) 아바타가 토끼 옷 같고 일그러져 있다". 여우 몸 v1 은 무릎 아래 다리 정점 97.9%가 반대쪽 다리 뼈 가중치를
// 가져(Tripo 자동 리그 번짐) 달리기·피격에서 두 다리가 서로 끌려 찢겼다. 게임이 싣는 모든 아바타 몸에 같은 결함이 다시 들어오지 않게 막는다.
// 수치는 실제 런타임 스킨 계산이지 미술 승인·GPU·실기기 증거가 아니다.
const asset = (id: string) => manifest.assets.find(entry => entry.id === id)!;
const bytesOf = (id: string) => readFileSync(filePathFor(resolveAssetSource(asset(id))));

// 무릎 아래(사타구니에서 0.32m 아래)·밑창(0.12m) 위에서 반대쪽 다리 가중치 5% 넘는 정점 비율. 치마·외투가 다리 사이를 잇는 사타구니 근처는 뺀다.
const KNEE_DOWN = { below: .32, floor: .12 };
const MAX_KNEE_DOWN_BLEED_PCT = 5;

test.each(AVATARS.map(avatar => avatar.id))('%s: 무릎 아래 다리가 반대쪽 다리 뼈를 따르지 않는다', (id) => {
  const bleed = legBleed(bytesOf(id), KNEE_DOWN);
  expect(bleed.legVertices).toBeGreaterThan(300);
  expect(bleed.pct).toBeLessThanOrEqual(MAX_KNEE_DOWN_BLEED_PCT);
});

test('여우 몸 v1(교정 전)은 이 검사에서 걸린다(검사가 결함을 실제로 잡는지 확인)', () => {
  const v1 = legBleed(readFileSync(new URL('../public/models/heroes-next/ranger-fox-body-fit-v1.glb', import.meta.url)), KNEE_DOWN);
  expect(v1.pct).toBeGreaterThan(90);
  expect(legBleed(bytesOf('avatar_ranger_fox'), KNEE_DOWN).pct).toBe(0);
});

// 실제 클립 변형: 한 변이 1.6배 넘게 늘어난 삼각형 중 다리 사슬 몫(tools/art/measure-body-deform.mjs).
// 2026-10-29 측정: 교정 전 여우 6.8%(--body 로 v1 을 실어 잼, 로더가 자산별로 캐시해 한 프로세스에서는 다시 재지 못한다), 교정 후 3.07%,
// 기본 궁수 0.77%, 검은 고양이 0.30%, 다른 아바타 최대 2.63%(용암 오니).
const MAX_LEG_TORN_PCT = 4;
test('궁수 아바타 두 벌은 모든 클립에서 다리 찢김이 상한 안이고 여우는 기본 몸의 1.6배 상한 안에서 전체 찢김이 같은 수준이다', async () => {
  const base: any = await measureBodyDeform('hero_ranger_t1');
  for (const id of ['avatar_ranger_fox', 'avatar_ranger_blackcat']) {
    const body: any = await measureBodyDeform(id);
    expect(body.clips.run, id).toBeDefined();
    expect(body.maxLegTornPct, id).toBeLessThanOrEqual(MAX_LEG_TORN_PCT);
    expect(body.maxTornPct, id).toBeLessThanOrEqual(base.maxTornPct * 1.6);
  }
}, 120000);
