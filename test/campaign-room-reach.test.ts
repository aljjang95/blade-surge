import { expect, test } from 'bun:test';
import { Floor } from '../src/game/world.js';
import { stageDef, CHAPTERS } from '../src/data/stages.js';

// 캠페인 전 스테이지(실제 stageDef 의 던전 레이아웃·시드)에서 시작 방 → 모든 전투 방이 걷기 가능한 거리장으로 이어진다.
for (let ch = 1; ch <= CHAPTERS.length; ch++) for (let st = 1; st <= 10; st++) {
  test(`${ch}-${st}: 시작 방에서 모든 전투 방 도달, 해제 후 보스 도달`, () => {
    const s: any = stageDef(ch, st);
    const f: any = new Floor(s.idx, s.chapter.theme, s.party?.seed, s.dungeon?.layout);
    const at = (r: any) => Math.floor(r.z - f.minZ) * f.cols + Math.floor(r.x - f.minX);
    const from = f.buildFlow(f.startRoom.x, f.startRoom.z);
    expect(from).not.toBeNull();
    for (const r of f.rooms) if (r !== f.bossRoom) expect(from![at(r)]).toBeGreaterThanOrEqual(0);
    f.unseal();
    const after = f.buildFlow(f.bossRoom.x, f.bossRoom.z);
    for (const r of f.rooms) expect(after![at(r)]).toBeGreaterThanOrEqual(0);
  });
}
