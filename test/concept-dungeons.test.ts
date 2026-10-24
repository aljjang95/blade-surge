import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ALL_DUNGEONS, CONCEPT_DUNGEONS, NEW_DUNGEONS } from '../src/data/expansion.js';
import { buildExpeditionStage, buildExpeditionWorld, EXPEDITION_LAYOUTS } from '../src/game/expedition-combat.js';
import { buildConceptTerrain, conceptBoundaryRuns, conceptOpen, conceptRingSegments, isDiskRoom, roomRadius } from '../src/game/concept-terrain.js';
import { hazardContains, townHazardPattern } from '../src/game/region-hazards.js';
import { dungeonVisualFor } from '../src/data/dungeon-visuals.js';
import { BattleOcclusion } from '../src/engine/battle-occlusion.js';
import { Arena } from '../src/game/arena.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { TOWNS } from '../src/data/towns.js';

const ids = ['glacier_tide_basin', 'sunbrass_quarry'];
const worldOf = (id: string) => buildExpeditionWorld(buildExpeditionStage('dungeon', id, null));

/** 마스크 1m 셀 BFS로 시작방에서 닿는 셀 집합. */
function reach(world: any) {
  const seen = new Uint8Array(world.cols * world.rows), q: number[] = [];
  const sx = Math.floor(world.startRoom.x - world.minX), sz = Math.floor(world.startRoom.z - world.minZ);
  const s = sz * world.cols + sx; seen[s] = 1; q.push(s);
  while (q.length) { const c = q.pop()!, cz = Math.floor(c / world.cols), cx = c - cz * world.cols;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, nz = cz + dz, n = nz * world.cols + nx;
      if (nx < 0 || nz < 0 || nx >= world.cols || nz >= world.rows || seen[n] || !world.mask[n]) continue; seen[n] = 1; q.push(n); } }
  return (x: number, z: number) => !!seen[Math.floor(z - world.minZ) * world.cols + Math.floor(x - world.minX)];
}

test('컨셉 던전 2곳은 기존 18곳을 보존한 채 Lv.1 진입 가능한 목록 끝에 붙는다', () => {
  expect(ALL_DUNGEONS).toHaveLength(20);
  expect(NEW_DUNGEONS).toHaveLength(6);
  expect(ALL_DUNGEONS.slice(-2).map((d: any) => d.id)).toEqual(ids);
  expect(CONCEPT_DUNGEONS.map((d: any) => d.id)).toEqual(ids);
  // 마을 광장 6관문 계약은 그대로, 신규 2곳은 마을 관문이 아니라 던전 목록으로만 노출한다.
  for (const town of TOWNS) expect(town.dungeonIds.some((id: string) => ids.includes(id))).toBe(false);
  const eco = new Economy(); const service = new ExpeditionEconomy(eco);
  expect(service.s.level).toBe(1);
  // 지역 마을 해금(docs/region-dungeon-unlock.md): 새 저장의 첫 마을에서는 지역 2·4 던전인 두 곳이 아직 보이지 않는다.
  expect(service.dungeonAccess('sunbrass_quarry')).toEqual({ ok: false, error: '1-10 클리어 시 새 마을 「불씨 용광로 마을」에서 열림' });
  expect(service.dungeonAccess('glacier_tide_basin')).toEqual({ ok: false, error: '3-10 클리어 시 새 마을 「별잠 등대 마을」에서 열림' });
  // 지역이 열리면 레벨 조건 없이(Lv.1) 바로 입장할 수 있다.
  eco.s.progress.unlocked = 60;
  for (const id of ids) {
    const d: any = ALL_DUNGEONS.find((x: any) => x.id === id);
    expect(d.minLevel).toBe(1); expect(d.energy).toBe(4);
    expect(service.dungeonAccess(id)).toEqual({ ok: true, error: null });
    expect(EXPEDITION_LAYOUTS[id]).toBe(d.layout);
    expect(d.art).toMatch(/^\/img\/expansion\/.+\.webp$/);
    expect(d.mechanic?.id).toBeTruthy(); expect(d.roster.trash.length).toBeGreaterThanOrEqual(4);
    expect(dungeonVisualFor({ expedition: { id } }).key).toBe(d.layout.concept);
  }
  // 기존 목록의 레이아웃을 이름만 바꿔 복제하지 않았다.
  const signature = (l: any) => JSON.stringify([l.cells, l.edges]);
  const prior = new Set(Object.entries(EXPEDITION_LAYOUTS).filter(([id]) => !ids.includes(id)).map(([, l]) => signature(l)));
  for (const id of ids) expect(prior.has(signature(EXPEDITION_LAYOUTS[id]))).toBe(false);
});

test('모든 방은 시작방에서 이어지고 원형 마당은 원형 충돌·스폰을 쓰며 넓은 회랑으로 두 갈래 순환을 이룬다', () => {
  for (const id of ids) {
    const world: any = worldOf(id);
    world.unseal();
    const ok = reach(world);
    for (const room of world.rooms) expect(ok(room.x, room.z)).toBe(true);
    const disks = world.rooms.filter(isDiskRoom);
    expect(disks.length).toBeGreaterThanOrEqual(2);
    for (const d of disks) {
      const r = roomRadius(d);
      expect(r).toBeGreaterThanOrEqual(15);
      // 원 안은 걸을 수 있고 외접 사각형 모서리(원 밖 0.13r 이상, 1m 셀 반올림 여유 포함)는 막혀 있다.
      expect(world.walkable(d.x + r * .8, d.z + r * .8)).toBe(false);
      expect(world.walkable(d.x + r * .6, d.z)).toBe(true);
      expect(world.roomAt(d.x + r * .8, d.z + r * .8)).not.toBe(d);
      expect(world.roomAt(d.x + r * .5, d.z - r * .5)).toBe(d);
      for (let i = 0; i < 40; i++) { const [x, z] = world.randomIn(d, 2.2); expect(Math.hypot(x - d.x, z - d.z)).toBeLessThanOrEqual(r - 2.2 + 1e-6); expect(world.walkable(x, z)).toBe(true); }
    }
    expect(world.layout.width).toBeGreaterThanOrEqual(10);
    // 방 그래프에 독립 순환이 2개 이상(간선 - 정점 + 1).
    const edges = world.layout.edges.length, cycles = edges - world.rooms.length + 1;
    expect(cycles).toBeGreaterThanOrEqual(2);
    expect(world.rooms.at(-1).type).toBe('boss');
    expect(world.sealed).toBe(false);
  }
});

test('봉인 중에는 보스 마당만 막히고 다른 방은 모두 닿는다', () => {
  for (const id of ids) {
    const world: any = worldOf(id), ok = reach(world);
    expect(world.sealed).toBe(true);
    for (const room of world.rooms) expect(ok(room.x, room.z)).toBe(room.type !== 'boss');
    // 봉인을 풀어도 결계 띠 중 방·회랑 밖(물·절벽) 셀은 열리지 않는다: 열린 셀 = 난간 안쪽 형상 그대로.
    world.unseal();
    for (let cz = 0; cz < world.rows; cz++) for (let cx = 0; cx < world.cols; cx++) {
      if (!world.mask[cz * world.cols + cx]) continue;
      expect(conceptOpen(world, world.minX + cx + .5, world.minZ + cz + .5)).toBe(true);
    }
  }
});

test('난간은 실제 충돌 경계 바로 바깥에만 서고 회랑 입구와 봉인 해제 길에는 틈이 남는다', () => {
  for (const id of ids) {
    const world: any = worldOf(id);
    const runs = conceptBoundaryRuns(world);
    expect(runs.length).toBeGreaterThan(20);
    for (const run of runs) {
      const mid = (run.a + run.b) / 2, out = run.side === 1 || run.side === 3 ? .35 : -.35;
      const [x, z] = run.axis === 'x' ? [mid, run.at + out] : [run.at + out, mid];
      const [ix, iz] = run.axis === 'x' ? [mid, run.at - out] : [run.at - out, mid];
      expect(conceptOpen(world, x, z)).toBe(false);
      expect(conceptOpen(world, ix, iz)).toBe(true);
      // 봉인 결계 자리에는 난간이 없다(열리면 길).
      for (const g of world.gates) expect(Math.abs(x - g.x) < g.w / 2 - .2 && Math.abs(z - g.z) < 3).toBe(false);
    }
    for (const room of world.rooms.filter(isDiskRoom)) {
      const segs = conceptRingSegments(world, room), r = roomRadius(room);
      const gaps = segs.filter((s: any) => s.gap);
      expect(gaps.length).toBeGreaterThan(0);
      // 모든 틈 바깥 3m에는 실제 회랑 바닥이 있고, 원 둘레에 닿는 회랑마다 틈이 있다.
      for (const s of gaps) {
        let open = false; for (const t of [-.6, 0, .6]) for (const k of [1, 2, 3]) { const a = s.angle + t * Math.PI * 2 / segs.length; if (conceptOpen(world, room.x + Math.cos(a) * (r + k), room.z + Math.sin(a) * (r + k))) open = true; }
        expect(open).toBe(true);
      }
      for (const c of world.corridors) {
        const touching = segs.filter((s: any) => Math.abs(s.x + Math.cos(s.angle) * 1.5 - c.x) < c.w / 2 && Math.abs(s.z + Math.sin(s.angle) * 1.5 - c.z) < c.h / 2);
        if (touching.length) expect(touching.some((s: any) => s.gap)).toBe(true);
      }
      for (const s of segs.filter((s: any) => !s.gap)) expect(conceptOpen(world, s.x + Math.cos(s.angle) * 1.4, s.z + Math.sin(s.angle) * 1.4)).toBe(false);
    }
  }
});

test('지형은 원자재 없이 지어지고 카메라 쪽 볼륨은 낮으며 draw call 예산 안에서 시선 셰이더를 공유한다', () => {
  for (const id of ids) {
    const world: any = worldOf(id), key = world.layout.concept, sight = new BattleOcclusion();
    const group = buildConceptTerrain(world, key, { bindSightline: (m: THREE.Material) => sight.bind(m) });
    let meshes = 0, bound = 0;
    group.traverse((n: any) => { if (n.isMesh) { meshes++; if (sight.isBound(n.material)) bound++; } });
    expect(meshes).toBeLessThanOrEqual(30);
    expect(bound).toBeGreaterThan(4);
    const deck = group.getObjectByName('concept-deck') as THREE.Mesh;
    expect(sight.isBound(deck.material as THREE.Material)).toBe(false);
    const stats = group.userData.stats;
    expect(stats.columns).toBeGreaterThan(60); expect(stats.crystals).toBeGreaterThan(10); expect(stats.ringGaps).toBeGreaterThan(0);
    // 높은 볼륨은 보행 경계에서 떨어져 있고, 보행 영역의 남쪽(카메라 쪽)에서는 낮다.
    const cliffs = group.getObjectByName('concept-cliffs') as THREE.InstancedMesh, m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < cliffs.count; i++) {
      cliffs.getMatrixAt(i, m); m.decompose(p, q, s);
      const top = p.y + s.y / 2;
      let northOpen = 99; for (let k = 1; k < 30; k++) if (conceptOpen(world, p.x, p.z - k)) { northOpen = k; break; }
      let near = false; for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (conceptOpen(world, p.x + dx, p.z + dz)) near = true;
      if (top > 3) expect(near).toBe(false);
      // 카메라(남쪽) 쪽 볼륨: 북쪽 보행 경계까지 거리 s에 대해 높이 ≤ s/2 정도(2m 격자 반올림 포함).
      if (northOpen < 20) expect(top).toBeLessThanOrEqual(Math.max(1.5, northOpen * .5) + .3);
    }
    group.userData.update(1 / 60); group.userData.dispose(); group.userData.dispose();
  }
});

test('조수 범람·도르래 낙석은 실제 방 안에 예고되고 매 주기 안전한 자리를 남긴다', () => {
  for (const id of ids) {
    const world: any = worldOf(id), d: any = ALL_DUNGEONS.find((x: any) => x.id === id);
    for (const room of world.rooms.filter((r: any) => r.type !== 'start' && r.type !== 'treasure')) for (const cycle of [0, 1, 2, 3]) {
      const list = townHazardPattern(id, d.theme, room, { x: room.x + 1, z: room.z + 1 }, cycle, room.type === 'boss');
      expect(list.length).toBeGreaterThan(0);
      for (const h of list) expect(h.delay).toBeGreaterThanOrEqual(1.1);
      let safe = 0, inside = 0;
      for (let x = room.x - room.w / 2 + 1; x < room.x + room.w / 2; x += 1) for (let z = room.z - room.h / 2 + 1; z < room.z + room.h / 2; z += 1) {
        if (world.roomAt(x, z) !== room) continue; inside++;
        if (!list.some((h: any) => hazardContains(h, x, z))) safe++;
      }
      expect(safe / inside).toBeGreaterThan(.3);
      // 패턴이 방 밖(물·절벽)에만 그려지지 않는다.
      expect(list.some((h: any) => world.roomAt(h.x, h.z) === room)).toBe(true);
    }
  }
  // 다리 위 조수는 주기마다 반대편 절반으로 옮겨 다른 갈래/반대편으로 비켜설 길을 준다.
  const world: any = worldOf('glacier_tide_basin'), deckRoom = world.rooms.find((r: any) => !isDiskRoom(r) && r.w / r.h > 1.6 && r.type !== 'treasure');
  const a = townHazardPattern('glacier_tide_basin', 'tide', deckRoom, deckRoom, 0, false)[0], b = townHazardPattern('glacier_tide_basin', 'tide', deckRoom, deckRoom, 1, false)[0];
  expect(Math.sign(a.z - deckRoom.z)).toBe(-Math.sign(b.z - deckRoom.z));
});

test('새 계정에서 컨셉 던전 출격·패배·재도전·승리 정산이 저장되고 재로딩 뒤 유지되며 중복 정산은 거절된다', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  try {
    for (const id of ids) {
      values.clear();
      const eco = new Economy(), service = new ExpeditionEconomy(eco), d: any = ALL_DUNGEONS.find((x: any) => x.id === id);
      eco.s.progress.unlocked = 60; // 두 곳의 지역 마을(2·4)을 연 저장
      const energy0 = eco.s.energy, gold0 = eco.s.gold;
      // 패배: 보상·승리 기록 없이 정산, 같은 던전 재도전 가능.
      const lose = service.begin('dungeon', id); expect(lose.ok).toBe(true);
      expect(eco.s.energy).toBe(energy0 - d.energy);
      expect(service.settle(lose.ticket, { win: false })).toEqual({ ok: true, win: false, rewards: {} });
      expect(service.s.stats[id]).toBe(0);
      // 재도전 → 승리: 승리 기록·골드·재료가 저장된다.
      const win = service.begin('dungeon', id); expect(win.ok).toBe(true);
      expect(eco.s.energy).toBe(energy0 - d.energy * 2);
      const material = Object.keys(d.rewards.materials)[0], before = service.s.materials[material];
      const settled: any = service.settle(win.ticket, { win: true });
      expect(settled.ok).toBe(true);
      expect(service.s.stats[id]).toBe(1);
      expect(service.s.materials[material]).toBeGreaterThanOrEqual(before + d.rewards.materials[material]);
      expect(eco.s.gold).toBeGreaterThanOrEqual(gold0 + d.rewards.gold);
      // 재로딩(같은 저장소에서 새 경제 객체): 기록 유지, 같은 영수증 중복 정산 거절.
      const restored = new ExpeditionEconomy(new Economy());
      expect(restored.s.stats[id]).toBe(1);
      expect(restored.s.materials[material]).toBe(service.s.materials[material]);
      expect(restored.settle(win.ticket, { win: true }).ok).toBe(false);
      expect(restored.dungeonAccess(id).ok).toBe(true);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('아레나는 컨셉 지형으로 층을 짓고 기본 벽 인스턴스를 만들지 않으며 정리 때 모두 회수한다', () => {
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x111111);
  for (const id of ids) {
    const arena = new Arena(scene, { scene: new THREE.Group() }, { quality: 'high' });
    const world: any = worldOf(id), mask = Array.from(world.mask);
    arena.buildFloor(world, world.theme, dungeonVisualFor({ expedition: { id } }));
    expect(arena.conceptTerrain?.userData.conceptKey).toBe(world.layout.concept);
    expect(arena.regionArchitecture).toBeFalsy();
    expect(Array.from(world.mask)).toEqual(mask);
    arena.update(1 / 60, null, new THREE.Vector3(world.startRoom.x, 0, world.startRoom.z));
    expect(arena.seals.length).toBeGreaterThan(0);
    arena.clear(); expect(arena.conceptTerrain).toBeFalsy();
  }
});
