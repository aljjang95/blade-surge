import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { planCapeHem } from '../tools/art/fit-cape-hem.mjs';
import { measureHem } from '../tools/art/measure-hem.mjs';

// 아트 t7: 별빛 천문 예복 발 묻힘(다리 rest 맞춤)과 기사 2·3단계 망토 밑단(fit-cape-hem)을 실제 게임 경로 측정으로 고정한다.
test('별빛 천문 예복: bind·대기에서 발이 바닥 아래로 1cm 넘게 묻히지 않는다(수정 전 -7.0cm)', async () => {
  const r = await measureHem('avatar_mage_astral', { frames: 8 });
  expect(r.bind.leg).toBeGreaterThan(-0.01);
  expect(r.clips.idle.leg).toBeGreaterThan(-0.01);
}, 60000);

test('기사 2·3단계: bind 자세 망토 밑단이 바닥 위(수정 전 -5.6·-8.8cm), 다리는 그대로 바닥', async () => {
  for (const id of ['hero_knight_t2', 'hero_knight_t3']) {
    const r = await measureHem(id, { frames: 4 });
    expect(r.bind.hem).toBeGreaterThan(0);
    expect(Math.abs(r.bind.leg)).toBeLessThan(0.01);
    expect(() => planCapeHem(readFileSync(`asset-library/normalized/${id}.glb`))).toThrow(/already above floor/);
  }
}, 120000);
