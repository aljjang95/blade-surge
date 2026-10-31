import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';
import { ALL_DUNGEONS } from '../src/data/expansion.js';
import { FIELD_DUNGEONS } from '../src/data/open-fields.js';
import { expeditionDepth } from '../src/data/expedition-depths.js';
import { ENEMIES } from '../src/data/stages.js';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { createMapTactics } from '../src/game/map-tactics.js';
import { dungeonVisualFor } from '../src/data/dungeon-visuals.js';
import { exitCueTarget } from '../src/game/exit-cue.js';
import { RegionHazards } from '../src/game/region-hazards.js';

// 던전 탭의 모든 원정(기본·심층·야외 필드)이 출격 직전 단계(정의·맵·명단·목표·전술·위험 장판)까지 예외 없이 만들어지는지 고정한다.
// 마지막 영역(혜성 요새·도르래 채석장 등)에서 "생성되다가 로비로 튕김" 제보의 회귀 방지선이다.
const routes = [...ALL_DUNGEONS, ...FIELD_DUNGEONS] as any[];
for (const route of routes) for (const depth of ['standard', 'deep']) {
  if (depth === 'deep' && !expeditionDepth(route.id)) continue;
  test(`${route.id} ${depth}: 출격 준비 단계가 예외 없이 끝나고 보스·명단이 모두 정의돼 있다`, () => {
    const stage = buildExpeditionStage('dungeon', route.id, {} as any, { depth });
    const world = buildExpeditionWorld(stage);
    const bossRooms = world.rooms.filter((room: any) => room.type === 'boss');
    expect(bossRooms).toHaveLength(1);
    expect(world.rooms[world.rooms.length - 1]).toBe(world.bossRoom);
    const ids = new Set<string>([stage.encounter.enemyId]);
    for (const room of world.rooms) for (const id of expeditionRoster(stage, room)) ids.add(id);
    for (const id of ids) expect((ENEMIES as any)[id]?.model, `${id} 정의`).toBeTruthy();
    expect(() => createRouteObjectives(stage, world)).not.toThrow();
    expect(() => createMapTactics(stage, world)).not.toThrow();
    expect(() => dungeonVisualFor(stage)).not.toThrow();
    expect(() => exitCueTarget(stage, world)).not.toThrow();
    for (const room of world.rooms) {
      const game: any = { stage, scene: new THREE.Scene(), player: { pos: new THREE.Vector3(room.x, 0, room.z) }, world, ui: { toast() {}, waveBanner() {} }, fx: new Proxy({}, { get: () => () => {} }) };
      const hazards = new RegionHazards(game);
      expect(() => { hazards.spawn(room); hazards.update?.(0.5); }).not.toThrow();
      hazards.dispose();
    }
  });
}
