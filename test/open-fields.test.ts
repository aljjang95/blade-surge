import { expect, test } from 'bun:test';
import { FIELD_DUNGEONS } from '../src/data/open-fields.js';
import { ENEMIES } from '../src/data/stages.js';
import { buildExpeditionStage, buildExpeditionWorld, expeditionRoster } from '../src/game/expedition-combat.js';
import { Floor } from '../src/game/world.js';
import { buildOpenFieldScene } from '../src/game/open-field-scene.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { runRouteForStage, runRouteLabel, retryEnergyForResult } from '../src/game/run-history.js';
import { stageExpeditionEncounter, encounterLocationLabel } from '../src/game/rpg-encounters.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';

const cell = (w: any, r: any) => Math.floor(r.z - w.minZ) * w.cols + Math.floor(r.x - w.minX);
for (const field of FIELD_DUNGEONS) test(`${field.name}: 모든 전투 구역·이동 지면·봉인과 자원 수명을 보존한다`, () => {
  const stage = buildExpeditionStage('dungeon', field.id, null);
  expect(stage.field).toBe(field.field);
  const route=runRouteForStage(stage);
  expect(route).toMatchObject({kind:'dungeon',id:field.id,depth:'standard'});
  expect(runRouteLabel(route)).toContain(field.name);
  expect(retryEnergyForResult(stage.expedition)).toBe(4);
  expect(encounterLocationLabel(stageExpeditionEncounter(stage))).toContain(field.name);
  const discovery=`expedition:${field.id}:1`;
  expect(normalizeMasterworks({discoveries:[discovery]}).discoveries).toEqual([discovery]);
  expect(() => buildExpeditionStage('dungeon', field.id, null, { depth:'deep' })).toThrow();
  for (let seed = 1; seed <= 12; seed++) {
    const world = new Floor(stage.idx, field.theme, seed * 701, field.layout as any);
    const closed = world.buildFlow(world.startRoom.x, world.startRoom.z)!;
    for (const room of world.rooms) {
      expect(closed[cell(world,room)] >= 0).toBe(room !== world.bossRoom);
      const roster = expeditionRoster(stage, room);
      for (const id of roster) expect((ENEMIES as any)[id]).toBeDefined();
      if (!['start','boss'].includes(room.type)) expect(roster.length).toBeGreaterThanOrEqual(4);
    }
    world.unseal(); const open = world.buildFlow(world.bossRoom.x,world.bossRoom.z)!;
    for (const room of world.rooms) expect(open[cell(world,room)]).toBeGreaterThanOrEqual(0);
  }
  const world = buildExpeditionWorld(stage), before = world.mask!.slice();
  const scene = buildOpenFieldScene(world), owned = new Set<any>();
  let disposals = 0, meshes = 0;
  scene.traverse((o:any) => {
    if (!o.isMesh) return;
    meshes++; for (const resource of [o.geometry,o.material]) {
      owned.add(resource); resource.addEventListener('dispose', () => disposals++);
    }
    const positions = o.geometry.attributes.position.array;
    expect(Array.from(positions).every(Number.isFinite)).toBe(true);
  });
  expect(meshes).toBeLessThanOrEqual(5); // 모바일에서 소품 개수와 드로우콜을 분리한다.
  expect(world.mask).toEqual(before); // 렌더 지면이 닫힌 보스 봉인을 열면 안 된다.
  const ground = scene.getObjectByName('field-walkable-ground') as any;
  const p = ground.geometry.attributes.position;
  for (let i = 0; i < p.count; i += 4) {
    if(ground.geometry.attributes.normal.getY(i)!==1)continue;
    const x = p.getX(i) + .5, z = p.getZ(i) + .5;
    if (!world.gates!.some((g:any) => Math.abs(x-g.x) <= g.w/2+1 && Math.abs(z-g.z) <= g.h/2+1)) {
      expect(world.walkable(x,z)).toBe(true);
    }
  }
  scene.userData.update(1/60);
  scene.userData.dispose(); scene.userData.dispose();
  expect(disposals).toBe(owned.size);
});

test('야외 출격의 환불·승리 보상·저장 재시도는 입장권별로 한 번만 정산한다', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis,'localStorage'), values = new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
  try {
    for (const d of FIELD_DUNGEONS) {
      values.clear();
      const eco = new Economy(), x = new ExpeditionEconomy(eco), before = eco.s.energy;
      expect(x.dungeonAccess(d.id).ok).toBe(true);
      expect(x.begin('dungeon',d.id,{depth:'deep'}).ok).toBe(false);
      const cancelled = x.begin('dungeon',d.id).ticket;
      expect(eco.s.energy).toBe(before-4); expect(x.abandon(cancelled).ok).toBe(true);
      expect(eco.s.energy).toBe(before); expect(x.abandon(cancelled).ok).toBe(false);
      const ticket = x.begin('dungeon',d.id).ticket, pending = structuredClone(eco.s), save = eco.save.bind(eco);
      eco.save = () => false;
      expect(x.settle(ticket,{win:true}).ok).toBe(false); expect(eco.s).toEqual(pending);
      eco.save = save;
      expect(x.settle(ticket,{win:true}).ok).toBe(true);
      expect(eco.s.journey.daily.targets[d.id]).toBe(1);
      expect(eco.s.journey.weekly.targets[d.id]).toBe(1);
      expect(eco.s.gold).toBe(pending.gold+d.rewards.gold);
      const paid = structuredClone(eco.s);
      expect(x.settle(ticket,{win:true}).ok).toBe(false); expect(eco.s).toEqual(paid);
      const loaded = new ExpeditionEconomy(new Economy());
      expect(loaded.s.stats[d.id]).toBe(1); expect(loaded.settle(ticket,{win:true}).ok).toBe(false);
    }
  } finally { if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage'); }
});
