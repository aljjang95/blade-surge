import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import manifest from '../asset-library/manifest.json';
import { ALL_DUNGEONS, CONCEPT_DUNGEONS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS, expeditionDepth } from '../src/data/expedition-depths.js';
import { BOSS_ENCOUNTERS, BOSS_SIGNATURES } from '../src/data/boss-encounters.js';
import { ENEMIES } from '../src/data/stages.js';
import { MONSTER_ROSTER } from '../src/data/monster-roster.js';
import { RIGS } from '../src/data/rigs.js';
import { dungeonVisualFor } from '../src/data/dungeon-visuals.js';
import { flowMusicBriefForRoute, musicForScene } from '../src/data/music.js';
import { BossSignatures, planBossSignature, BOSS_SIGNATURE_CAPACITY } from '../src/game/boss-signatures.js';
import { hazardContains } from '../src/game/region-hazards.js';
import { Enemy, nextBossPattern } from '../src/game/enemies.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy, normalizeExpedition } from '../src/game/expedition-economy.js';
import { conceptBossCard, conceptLoopStatus, conceptNextChallenge, CONCEPT_LOOP_IDS } from '../src/ui/concept-challenge.js';
import { ExpeditionResult } from '../src/expansion/hub.jsx';

const enemies = ENEMIES as Record<string, any>;
const signatures = BOSS_SIGNATURES as Record<string, { name: string; cue: string; anim: string; color: number }>;
const BOSSES = { glacier_tide_basin: 'tidegate_titan', sunbrass_quarry: 'pulley_colossus' } as const;
const REPLACED = { tidegate_titan: 'obsidian_hydra', pulley_colossus: 'ash_colossus' } as const;
const KEYS = { tidegate_titan: ['tidegate_flood', 'tidegate_ring_gap'], pulley_colossus: ['pulley_ore_fall', 'pulley_chain_line'] } as const;
const ALL_KEYS = Object.values(KEYS).flat();
const ids = Object.keys(BOSSES) as (keyof typeof BOSSES)[];

// HEAD 3262dd92 원본에서 계산한 지문(sha256 앞 16자, JSON.stringify 기준). 기존 18경로·12심층 정의와
// 교체 전 두 보스, 컨셉 2곳의 보스 문구 외 모든 필드(에너지·보상·레이아웃·명단·기믹·스테이지)가 그대로인지 확인한다.
const UNCHANGED: Record<string, string> = {"route:glass_garden":"1ff91b57f1fd7b5d","route:ember_vault":"e60e47e0ea8d3302","route:star_archive":"989b6e87dadf2ae4","route:bellfall_crypt":"2fcd5a3c8e7cb5c4","route:cinder_tide_lock":"e184821e7540f03e","route:nightglass_observatory":"89205901b0e68091","route:eclipse_hydra_vault":"38f37bb88763d8fc","route:ashforge_catacomb":"8e1633d018e8fbc7","route:astral_leviathan_spire":"be18e8ce15824451","route:verdigris_sanctum":"168147b6d3e1415f","route:sable_mirage_basin":"62657b0a6e0f79e6","route:comet_bastion":"bc39f038f3b89791","route:rootbound_grotto":"44f3854bca0a71da","route:hollowbell_arboretum":"15a75f7572310e54","route:slagwater_foundry":"cab2f1a1e4632de1","route:emberwake_drydock":"a2a225f9cf91668e","route:aurora_icewell":"8fd1b84ad171897a","route:crownfall_glacier":"881db429ae65e95b","depth:glass_garden":"f7994cd62c2091a5","depth:ember_vault":"cb7ac7c8d8efb501","depth:star_archive":"d6fb208b8e8fd487","depth:bellfall_crypt":"2acfce3aed4f3bba","depth:cinder_tide_lock":"11ac82ad03a57d6d","depth:nightglass_observatory":"5c235050d5873632","depth:eclipse_hydra_vault":"2759a144f7586338","depth:ashforge_catacomb":"5e0b2c6d6b153425","depth:astral_leviathan_spire":"0d6cf1e31bcc59f0","depth:verdigris_sanctum":"050eca9326e8de44","depth:sable_mirage_basin":"9c96c7ee88ed7a13","depth:comet_bastion":"15f001a4f31d0f11","concept:glacier_tide_basin":"324ec58710aae409","concept:sunbrass_quarry":"0ce3636f7d5bd46b","enemy:obsidian_hydra":"80aa9cb69bdd8d64","enemy:ash_colossus":"2dd7bd559d31bf9a"};
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

function withStorage(run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  try { run(); } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}
const bossRoom = (id: string, depth = 'standard') => {
  const world: any = buildExpeditionWorld(buildExpeditionStage('dungeon', id, null, { depth }));
  return { world, room: world.rooms.find((r: any) => r.type === 'boss') };
};

test('기존 18경로·12심층·교체 전 보스와 컨셉 2곳의 보스 외 필드는 HEAD 원본과 같다', () => {
  const concept = new Set<string>(CONCEPT_LOOP_IDS), actual: Record<string, string> = {};
  for (const d of ALL_DUNGEONS as any[]) if (!concept.has(d.id)) actual['route:' + d.id] = fingerprint(d);
  for (const d of EXPEDITION_DEPTHS as any[]) if (!concept.has(d.id)) actual['depth:' + d.id] = fingerprint(d);
  for (const d of CONCEPT_DUNGEONS as any[]) {
    const { objective, tactic, bossEnemy, bossName, bossPattern, stage, ...rest } = d;
    const { objective: stageObjective, encounter, ...stageRest } = stage; const { pattern, ...encounterRest } = encounter;
    actual['concept:' + d.id] = fingerprint({ rest, stageRest, encounterRest });
  }
  for (const id of Object.values(REPLACED)) actual['enemy:' + id] = fingerprint(enemies[id]);
  expect(actual).toEqual(UNCHANGED);
  // 기본 컨셉 던전의 공개 계약 수치(에너지 4·보상·보스 체력)를 숫자로도 고정한다.
  for (const [id, material, hp] of [['glacier_tide_basin', 'star_dust', 11800], ['sunbrass_quarry', 'ember_core', 12600]] as const) {
    const d: any = ALL_DUNGEONS.find((x: any) => x.id === id);
    expect([d.energy, d.stage.energy, d.minLevel, d.bossHp]).toEqual([4, 4, 1, hp]);
    expect(d.rewards).toEqual({ gold: 360, xp: 100, materials: { [material]: 3 }, consumables: { hp_tonic: 1 } });
    const stage: any = buildExpeditionStage('dungeon', id, null);
    expect(stage.encounter.enemyId).toBe(BOSSES[id]); expect(stage.expeditionEnemy.hp).toBe(hp);
    expect(stage.expeditionEnemy.name).toBe(d.bossName); expect(stage.objective).toContain(d.bossName);
  }
});

test('전용 보스 2종은 교체 전 전투 수치를 그대로 쓰고 기술·외형만 다르다', () => {
  for (const [id, replaced] of Object.entries(REPLACED)) {
    const def = enemies[id], old = enemies[replaced];
    for (const key of ['hp', 'atk', 'spd', 'range', 'atkTime', 'exp', 'scale', 'armor', 'gold', 'kit', 'boss', 'signatureBoss', 'voiceKey', 'summon']) expect([key, def[key]]).toEqual([key, old[key]]);
    expect(def.model).not.toBe(old.model); expect(def.portrait).toBeUndefined();
    expect(def.phasePatterns).toHaveLength(3);
    const techniques = [...new Set<string>(def.phasePatterns.flat())].filter(key => key in signatures);
    expect(techniques).toEqual([...KEYS[id as keyof typeof KEYS]]);
    // 안내 문구는 실제 기술 이름·cue로만 만든다.
    for (const key of techniques) { expect(def.tactic).toContain(signatures[key].name); expect(def.tactic).toContain(signatures[key].cue); }
    expect(def.phaseHints).toHaveLength(3);
  }
});

test('전용 기술 4종은 두 보스만 쓰고 기존 보스·캠페인 기술과 겹치지 않으며 실제 클립으로 재생된다', () => {
  for (const key of ALL_KEYS) expect(signatures[key]).toBeDefined();
  const owners = (key: string) => Object.entries(enemies).filter(([, def]) => [def.pattern, ...(def.phasePatterns || [])].flat().includes(key)).map(([id]) => id).sort();
  for (const [boss, keys] of Object.entries(KEYS)) for (const key of keys) expect(owners(key)).toEqual([boss]);
  for (const config of Object.values(BOSS_ENCOUNTERS)) for (const key of ALL_KEYS) expect(config.phases.flat()).not.toContain(key);
  // 기존 보스의 기술 집합과 전용 보스의 기술 집합은 서로소다.
  const old = new Set(Object.entries(enemies).filter(([id]) => !(id in REPLACED)).flatMap(([, def]) => [def.pattern, ...(def.phasePatterns || [])].flat()).filter(Boolean));
  for (const key of ALL_KEYS) expect(old.has(key)).toBe(false);
  const assets = new Map((manifest as any).assets.map((a: any) => [a.id, a]));
  for (const [boss, keys] of Object.entries(KEYS)) {
    const asset: any = assets.get(MONSTER_ROSTER[enemies[boss].model as keyof typeof MONSTER_ROSTER].asset);
    for (const key of keys) {
      const logical = signatures[key].anim, choices = (RIGS.library as any)[logical];
      expect([key, (Array.isArray(choices) ? choices : [choices])[0] in asset.clips]).toEqual([key, true]);
    }
  }
});

test('전용 보스 외형 자산은 다른 던전·심층·캠페인 최종 보스와 겹치지 않는다', () => {
  const asset = (enemyId: string) => MONSTER_ROSTER[enemies[enemyId].model as keyof typeof MONSTER_ROSTER].asset;
  const others = new Set<string>();
  for (const d of ALL_DUNGEONS as any[]) { const s: any = buildExpeditionStage('dungeon', d.id, null); if (!(s.encounter.enemyId in REPLACED) && !Object.values(BOSSES).includes(s.encounter.enemyId)) others.add(asset(s.encounter.enemyId)); }
  for (const d of EXPEDITION_DEPTHS as any[]) if (!Object.values(BOSSES).includes(d.bossEnemy)) others.add(asset(d.bossEnemy));
  for (const id of Object.keys(enemies)) if (id.endsWith('_finalboss')) others.add(asset(id));
  const mine = Object.values(BOSSES).map(asset);
  expect(new Set(mine).size).toBe(2);
  for (const a of mine) expect(others.has(a)).toBe(false);
  // 정직한 경계: 얼음 골렘 자산은 캠페인 4장 1관문 대장·3장 중간 보스(최종 보스 아님)도 쓴다.
  const sharing = Object.entries(enemies).filter(([id, def]) => def.boss && !Object.values(BOSSES).includes(id as any) && mine.includes(MONSTER_ROSTER[def.model as keyof typeof MONSTER_ROSTER]?.asset)).map(([id]) => id).sort();
  expect(sharing).toEqual(['frost_midboss', 'tide_captain']);
});

test('페이즈 순서는 저작 순서대로 결정적이고 같은 입력의 기술 계획은 항상 같다', () => {
  for (const [boss, keys] of Object.entries(KEYS)) {
    const def = enemies[boss];
    for (let phase = 0; phase < 3; phase++) {
      const order = def.phasePatterns[phase];
      expect(Array.from({ length: order.length * 2 }, (_, turn) => nextBossPattern(def, turn, phase))).toEqual([...order, ...order]);
    }
    // 1페이즈는 첫 기술, 2페이즈는 둘째 기술로 시작해 페이즈 전환이 보인다.
    expect([nextBossPattern(def, 0, 0), nextBossPattern(def, 0, 1)]).toEqual([...keys]);
    const { room } = bossRoom(Object.keys(BOSSES).find(id => (BOSSES as any)[id] === boss)!);
    for (const key of keys) for (let phase = 0; phase < 3; phase++) for (const turn of [0, 1]) {
      const input = { room, origin: { x: room.x + 2, z: room.z - 1 }, target: { x: room.x - 4, z: room.z + 5 }, phase, turn };
      expect(planBossSignature(key, input)).toEqual(planBossSignature(key, structuredClone(input)));
    }
  }
});

test('실제 원형 보스 마당에서 예고 시간·회복·풀 크기와 5m/s 이동 경로가 모든 페이즈에 성립한다', () => {
  for (const id of ids) for (const depth of ['standard', 'deep']) {
    const { world, room } = bossRoom(id, depth);
    expect(room.shape).toBe('disk');
    const inside: { x: number; z: number }[] = [];
    for (let x = Math.ceil(room.x - room.w / 2); x <= room.x + room.w / 2; x++) for (let z = Math.ceil(room.z - room.h / 2); z <= room.z + room.h / 2; z++) if (world.roomAt(x, z) === room) inside.push({ x, z });
    const radius = room.w / 2 - 3;
    const targets = [{ x: room.x, z: room.z }, { x: room.x + radius, z: room.z }, { x: room.x - radius, z: room.z }, { x: room.x, z: room.z + radius }, { x: room.x, z: room.z - radius }];
    for (const key of KEYS[BOSSES[id]]) for (let phase = 0; phase < 3; phase++) for (const turn of [0, 1, 2]) for (const target of targets) {
      const plan = planBossSignature(key, { room, origin: { x: room.x + 3, z: room.z - 4 }, target, phase, turn })!;
      expect(plan.events.length).toBeGreaterThan(0); expect(plan.events.length).toBeLessThanOrEqual(BOSS_SIGNATURE_CAPACITY);
      expect(plan.duration - plan.lastStrike).toBeGreaterThanOrEqual(1);
      for (const h of plan.events) {
        expect(h.at - h.warnAt).toBeGreaterThanOrEqual(1.2);
        // 모든 예고 중심은 보스 마당 사각 범위 안에 있다(물·절벽 위에만 그리지 않는다).
        expect(Math.abs(h.x - room.x)).toBeLessThanOrEqual(room.w / 2); expect(Math.abs(h.z - room.z)).toBeLessThanOrEqual(room.h / 2);
      }
      // 실제 보행 칸만으로, 매 타격 시각에 5m/s로 닿는 안전 칸이 남는지 확인한다.
      let reachable = [target], at = 0;
      for (const time of [...new Set(plan.events.map(h => h.at))].sort((a, b) => a - b)) {
        const hazards = plan.events.filter(h => h.at === time);
        reachable = inside.filter(c => !hazards.some(h => hazardContains(h, c.x, c.z)) && reachable.some(p => Math.hypot(p.x - c.x, p.z - c.z) <= 5 * (time - at)));
        expect(reachable.length, `${id}/${depth} ${key} phase ${phase} turn ${turn} at ${time}`).toBeGreaterThan(0);
        at = time;
      }
    }
  }
});

test('수문 범람은 거신이 선 수로를 남기고 먼 쪽부터, 물결 고리 틈은 빈 고리를 먼저 남긴다', () => {
  const { room } = bossRoom('glacier_tide_basin');
  const origin = { x: room.x + 2, z: room.z - 3 }, target = { x: room.x - 3, z: room.z + 8 };
  for (let phase = 0; phase < 3; phase++) for (const turn of [0, 1]) {
    const flood = planBossSignature('tidegate_flood', { room, origin, target, phase, turn })!;
    // 거신이 선 자리(수로)는 어떤 물결에도 잠기지 않는다.
    for (const h of flood.events) expect(hazardContains(h, origin.x, origin.z)).toBe(false);
    // 플레이어 쪽 수문은 먼저 잠기지 않는다(먼 쪽 → 내 쪽).
    expect(hazardContains(flood.events[0], target.x, target.z)).toBe(false);
    expect(hazardContains(flood.events[1], target.x, target.z)).toBe(true);
    expect(flood.events[1].at - flood.events[0].at).toBeGreaterThanOrEqual(1);
    expect(flood.events).toHaveLength(phase === 2 ? 3 : 2);
  }
  // 차례(turn)가 바뀌면 수로 방향이 90도 돈다.
  const a = planBossSignature('tidegate_flood', { room, origin, target, turn: 0 })!, b = planBossSignature('tidegate_flood', { room, origin, target, turn: 1 })!;
  expect(a.events[0].angle).not.toBe(b.events[0].angle);
  const gap = planBossSignature('tidegate_ring_gap', { room, origin, target, phase: 1 })!;
  const outer = Math.max(...gap.events.filter(h => h.type === 'ring').map(h => h.radius)), core = gap.events.find(h => h.type === 'disk')!.radius;
  const first = gap.events.filter(h => h.at === gap.events[0].at), second = gap.events.filter(h => h.at > gap.events[0].at);
  const gapPoint = { x: room.x + (core + outer * .78) / 2, z: room.z };
  expect(first.some(h => hazardContains(h, gapPoint.x, gapPoint.z))).toBe(false);
  expect(first.some(h => hazardContains(h, room.x, room.z))).toBe(true);
  // 다음 물결은 빈 고리를 덮고, 처음 맞은 가운데는 다시 안전하다.
  expect(second.some(h => hazardContains(h, room.x + outer * .72 * .9, room.z))).toBe(true);
  expect(second.some(h => hazardContains(h, room.x, room.z))).toBe(false);
});

test('도르래 낙석은 마당 둘레를 돈 뒤 내 자리에, 사슬 당김은 북쪽 도르래에서 내 자리를 지난다', () => {
  const { room } = bossRoom('sunbrass_quarry');
  const origin = { x: room.x + 1, z: room.z - 2 }, target = { x: room.x + 6, z: room.z + 5 };
  for (let phase = 0; phase < 3; phase++) for (const turn of [0, 1]) {
    const ore = planBossSignature('pulley_ore_fall', { room, origin, target, phase, turn })!;
    const last = ore.events.at(-1)!, ring = ore.events.slice(0, -1);
    expect([last.x, last.z]).toEqual([target.x, target.z]); expect(last.at).toBe(ore.lastStrike);
    const radii = ring.map(h => Math.hypot(h.x - room.x, h.z - room.z));
    for (const r of radii) expect(r).toBeCloseTo(radii[0], 6);
    for (let i = 1; i < ring.length; i++) expect(ring[i].at).toBeGreaterThan(ring[i - 1].at);
    expect(ring).toHaveLength(phase === 0 ? 3 : 4);
    const chain = planBossSignature('pulley_chain_line', { room, origin, target, phase, turn })!;
    for (const h of chain.events.slice(0, 2)) {
      expect(hazardContains(h, target.x, target.z)).toBe(true);
      const start = { x: h.x - Math.cos(h.angle) * h.length / 2, z: h.z - Math.sin(h.angle) * h.length / 2 };
      expect(start.z).toBeCloseTo(room.z - room.h / 2 + 1, 6);
      expect(Math.abs(Math.abs(start.x - room.x) - room.w * .3)).toBeLessThan(1e-6);
    }
    expect(chain.events).toHaveLength(phase === 0 ? 2 : 3);
  }
});

function signatureFixture(boss: string, room: any) {
  const damage: number[] = [];
  const player: any = { alive: true, pos: new THREE.Vector3(room.x, 0, room.z + 4), hurt: (d: number) => { damage.push(d); return d; } };
  const game: any = { scene: new THREE.Scene(), player, active: true, paused: false, stage: { party: false, chapter: { theme: 'tide' } }, fx: {}, ui: { toast: () => {} }, world: { roomAt: () => room } };
  game.app = { party: { livingPlayers: () => [player] } };
  const enemy: any = Object.create(Enemy.prototype);
  Object.assign(enemy, { game, def: enemies[boss], pos: new THREE.Vector3(room.x + 2, 0, room.z - 3), vel: new THREE.Vector3(), homeRoom: room, alive: true, spawning: false,
    state: 'attack', stateT: 0, phase: 0, patternTurn: 0, attackSequence: 1, atk: 100, yaw: 0, isBoss: true, stun: 0, A: (s: string) => s, playTimed: () => {} });
  const caster = new BossSignatures(enemy); enemy.signatures = caster;
  return { game, enemy, caster, player, damage };
}

test('실제 BossSignatures: 예고 전·예고 밖은 피해가 없고 예고 안은 타격 시각 뒤에만 한 번 맞는다', () => {
  for (const id of ids) {
    const boss = BOSSES[id], { room } = bossRoom(id);
    for (const key of KEYS[boss]) {
      // 안쪽: 첫 타격 도형의 실제 판정 안에 서 있으면 타격 직전까지 0, 직후 1회.
      const hit = signatureFixture(boss, room), plan = hit.caster.start(key), h = plan.events[0];
      const point = h.type === 'ring' ? { x: h.x + h.radius * .9, z: h.z } : { x: h.x, z: h.z };
      expect(hazardContains(h, point.x, point.z)).toBe(true);
      hit.player.pos.set(point.x, 0, point.z);
      hit.caster.update(h.at - .02); expect(hit.damage).toHaveLength(0);
      hit.enemy.special = key; expect(hit.enemy.getPartyWarnings().length).toBeGreaterThan(0);
      hit.caster.update(h.at + .02); expect(hit.damage).toHaveLength(1); expect(hit.caster.hits).toBe(1);
      hit.caster.update(h.at + .1); expect(hit.damage).toHaveLength(1);
      hit.caster.dispose();
      // 바깥: 계획의 모든 도형 밖 보행 칸에 서 있으면 끝까지 피해가 없다.
      const miss = signatureFixture(boss, room), missPlan = miss.caster.start(key);
      let safe: { x: number; z: number } | null = null;
      for (let x = room.x - room.w / 2 + 2; x < room.x + room.w / 2 && !safe; x++) for (let z = room.z - room.h / 2 + 2; z < room.z + room.h / 2 && !safe; z++) {
        if (Math.hypot(x - room.x, z - room.z) > room.w / 2 - 2) continue;
        if (!missPlan.events.some(e => hazardContains(e, x, z))) safe = { x, z };
      }
      expect(safe, key).not.toBeNull();
      miss.player.pos.set(safe!.x, 0, safe!.z);
      for (let t = 0; t <= missPlan.duration; t += .05) miss.caster.update(t);
      expect(miss.damage).toHaveLength(0); expect(miss.caster.fired).toBe(missPlan.events.length);
      // 마지막 타격 뒤에만 반격 기회가 열린다.
      expect(miss.enemy.attackDone).toBe(true);
      miss.caster.dispose();
    }
  }
});

test('신규 심층 2곳은 같은 장 에너지 6 심층의 해금·보상 대역과 같은 컨셉 지형을 쓴다', () => {
  const peers = { glacier_tide_basin: ['ember_vault', 'star_dust'], sunbrass_quarry: ['cinder_tide_lock', 'ember_core'] } as const;
  for (const id of ids) {
    const deep: any = expeditionDepth(id), [peerId, material] = peers[id], peer: any = expeditionDepth(peerId), standard: any = ALL_DUNGEONS.find((d: any) => d.id === id);
    for (const key of ['unlockCode', 'energy', 'chapter', 'stage', 'scale', 'minLevel']) expect([key, deep[key]]).toEqual([key, peer[key]]);
    expect(deep.energy).toBe(6);
    expect(deep.rewards).toEqual({ ...peer.rewards, materials: { [material]: Object.values(peer.rewards.materials)[0] } });
    expect(deep.firstRewards).toEqual({ ...peer.firstRewards, materials: { [material]: 3 } });
    expect(Object.keys(standard.rewards.materials)).toEqual([material]);
    expect(deep.bossEnemy).toBe(BOSSES[id]);
    // 같은 지형(셀·간선·크기·원형·이름표·컨셉 키), 방 종류만 다르다.
    for (const key of ['concept', 'landmark', 'spacing', 'size', 'width', 'cells', 'edges', 'sizes', 'shapes', 'labels']) expect([key, deep.layout[key]]).toEqual([key, standard.layout[key]]);
    expect(deep.layout.types).not.toEqual(standard.layout.types);
    expect(deep.layout.types.at(-1)).toBe('boss'); expect(deep.layout.types[0]).toBe('start');
    expect(deep.layout.types.filter((t: string) => t === 'elite')).toHaveLength(3);
    const stage: any = buildExpeditionStage('dungeon', id, null, { depth: 'deep' }), world: any = buildExpeditionWorld(stage);
    expect(world.layout).toBe(deep.layout); expect(world.expeditionDepth).toBe('deep');
    expect(dungeonVisualFor(stage).key).toBe(standard.layout.concept);
    expect(stage.encounter.enemyId).toBe(BOSSES[id]); expect(stage.expeditionEnemy.hp).toBe(deep.bossHp); expect(stage.expedition.rosterMode).toBe(standard.rosterMode);
    expect(world.rooms.filter((r: any) => r.type === 'elite')).toHaveLength(3);
    // 심층 칸은 기본 원정이 쓰는 지역 곡과 같은 대체 곡을 쓴다.
    expect(musicForScene({ stage })).toBe(flowMusicBriefForRoute(id)!.fallback);
    expect(musicForScene({ stage })).toBe(musicForScene({ stage: buildExpeditionStage('dungeon', id, null) }));
  }
});

test('신규 심층: 해금 순서·에너지 6·첫 정복 보상 1회·패배 미소비·재로딩·구 저장 정규화', () => {
  for (const id of ids) withStorage(() => {
    const eco = new Economy(), service = new ExpeditionEconomy(eco), deep: any = expeditionDepth(id);
    // QA 픽스처(명시): 에너지 50과 캠페인 별은 테스트가 직접 넣는다. 기본 원정 클리어는 실제 begin/settle로 만든다.
    eco.s.energy = 50;
    expect(service.dungeonAccess(id, { depth: 'deep' }).error).toBe('탐험 레벨 2 필요');
    service.s.level = 2;
    expect(service.dungeonAccess(id, { depth: 'deep' }).error).toBe(`캠페인 ${deep.unlockCode} 클리어 필요`);
    eco.s.progress.stars[deep.unlockCode] = 1;
    expect(service.dungeonAccess(id, { depth: 'deep' }).error).toBe('기본 원정을 먼저 클리어해 주세요.');
    expect(service.begin('dungeon', id, { depth: 'deep' }).ok).toBe(false);
    const standard = service.begin('dungeon', id); expect(standard.ok).toBe(true);
    expect(service.settle(standard.ticket, { win: true }).ok).toBe(true);
    expect(service.dungeonAccess(id, { depth: 'deep' })).toEqual({ ok: true, error: null });
    // 패배는 첫 정복을 소비하지 않는다.
    let energy = eco.s.energy;
    const lose = service.begin('dungeon', id, { depth: 'deep' }); expect(lose.ok).toBe(true); expect(eco.s.energy).toBe(energy - 6);
    expect(service.settle(lose.ticket, { win: false })).toEqual({ ok: true, win: false, rewards: {} });
    expect(service.s.depthWins[id]).toBe(0);
    const material = Object.keys(deep.rewards.materials)[0];
    const first = service.begin('dungeon', id, { depth: 'deep' }); const before = { gold: eco.s.gold, material: service.s.materials[material] };
    const firstOut: any = service.settle(first.ticket, { win: true });
    expect(firstOut.ok).toBe(true); expect(firstOut.rewards.firstClear).toBe(true);
    expect(service.s.materials[material] - before.material).toBe(deep.rewards.materials[material] + deep.firstRewards.materials[material]);
    expect(firstOut.rewards.gold).toBe(deep.rewards.gold + deep.firstRewards.gold);
    expect(service.s.depthWins[id]).toBe(1);
    const second = service.begin('dungeon', id, { depth: 'deep' }); const secondBefore = service.s.materials[material];
    const secondOut: any = service.settle(second.ticket, { win: true });
    expect(secondOut.rewards.firstClear).toBe(false); expect(secondOut.rewards.gold).toBe(deep.rewards.gold);
    expect(service.s.materials[material] - secondBefore).toBe(deep.rewards.materials[material]);
    // 재로딩: 같은 저장소에서 새 객체를 만들어도 기록이 남고 같은 영수증은 다시 정산되지 않는다.
    const restored = new ExpeditionEconomy(new Economy());
    expect(restored.s.depthWins[id]).toBe(2); expect(restored.s.stats[id]).toBe(1 + 2);
    const restoredCard = conceptBossCard(restored, id)!;
    expect(restoredCard.clears).toBe(1);
    expect(conceptLoopStatus(restoredCard)).toBe('기본 클리어 1회 · 심층 2회 정복 · 첫 정복 보상 받음');
    expect(restored.settle(second.ticket, { win: true }).ok).toBe(false);
    // 출격 중 새로고침은 심층 에너지 6을 한 번만 돌려준다.
    energy = restored.eco.s.energy;
    expect(restored.begin('dungeon', id, { depth: 'deep' }).ok).toBe(true);
    const reloaded = new ExpeditionEconomy(new Economy());
    expect(reloaded.s.pending).toBeNull(); expect(reloaded.eco.s.energy).toBe(energy);
  });
  // 구 저장(새 심층 키 없음)은 0으로 정규화되고 기존 심층 기록은 그대로다.
  const legacy = normalizeExpedition({ depthWins: { glass_garden: 3, ember_vault: 1 }, stats: { glass_garden: 5 } });
  expect(legacy.depthWins).toMatchObject({ glass_garden: 3, ember_vault: 1, glacier_tide_basin: 0, sunbrass_quarry: 0 });
  expect(legacy.stats.glacier_tide_basin).toBe(0); expect(legacy.stats.glass_garden).toBe(5);
  expect(Object.keys(legacy.depthWins)).toHaveLength(14);
  // 손상된 새 키 값은 거절되고 0이 된다.
  expect(normalizeExpedition({ depthWins: { glacier_tide_basin: -2, sunbrass_quarry: 'x' } }).depthWins).toMatchObject({ glacier_tide_basin: 0, sunbrass_quarry: 0 });
});

test('다음 도전은 실제 경로·단계·해금 판정만 읽고 아무것도 지급·해금하지 않는다', () => {
  for (const id of ids) {
    const eco = new Economy(), service = new ExpeditionEconomy(eco), deep: any = expeditionDepth(id);
    service.s.stats[id] = 1; service.s.level = 2;
    const snapshot = () => JSON.stringify(eco.s);
    const before = snapshot();
    const locked = conceptNextChallenge(service, { win: true, kind: 'dungeon', id, depth: 'standard', saveError: null })!;
    expect(locked).toMatchObject({ action: 'retry', id, depth: 'standard', energy: 4, lockReason: `캠페인 ${deep.unlockCode} 클리어 필요` });
    expect(locked.detail).toBe(`심층 잠김 · 캠페인 ${deep.unlockCode} 클리어 필요`);
    eco.s.progress.stars[deep.unlockCode] = 1;
    const open = conceptNextChallenge(service, { win: true, kind: 'dungeon', id, depth: 'standard' })!;
    expect(open).toMatchObject({ action: 'deep-prep', id, depth: 'deep', energy: 6, lockReason: '' });
    expect(open.detail).toContain('첫 정복 보상 대기');
    const deepWin = conceptNextChallenge(service, { win: true, kind: 'dungeon', id, depth: 'deep' })!;
    expect(deepWin).toMatchObject({ action: 'retry', id, depth: 'deep', energy: 6, label: '다음 도전 · 심층 재도전' });
    service.s.depthWins[id] = 1; service.s.stats[id] = 2;
    expect(conceptNextChallenge(service, { win: true, kind: 'dungeon', id, depth: 'deep' })!.detail).toContain('첫 정복 보상 받음');
    for (const result of [{ win: false }, { saveError: 'x' }, { riftId: 'r' }, { conquestId: 'c' }, { kind: 'arena' }, { id: 'glass_garden' }]) {
      expect(conceptNextChallenge(service, { win: true, kind: 'dungeon', id, depth: 'standard', ...result })).toBeNull();
    }
    const card = conceptBossCard(service, id)!;
    expect(card.bossName).toBe((ALL_DUNGEONS as any[]).find(d => d.id === id).bossName);
    expect(card.signatures.map(s => s.key)).toEqual([...KEYS[BOSSES[id]]]);
    expect(conceptLoopStatus(card)).toBe('기본 클리어 1회 · 심층 1회 정복 · 첫 정복 보상 받음');
    expect(conceptBossCard(service, id, 'deep')!.bossName).toBe(deep.bossName);
    // 읽기만 했다: 해금·보상·기록·에너지가 바뀌지 않았다(별·승리 수는 테스트가 직접 넣은 값뿐).
    service.s.depthWins[id] = 0; service.s.stats[id] = 1; delete eco.s.progress.stars[deep.unlockCode];
    expect(snapshot()).toBe(before);
  }
  expect(conceptLoopStatus(conceptBossCard(new ExpeditionEconomy(new Economy()), 'glacier_tide_basin')!)).toBe('기본 클리어 0회 · 심층 잠김 · 탐험 레벨 2 필요');
});

// expedition-result.test.ts와 같은 방식으로 실제 결과 컴포넌트를 펼친다(브라우저 없이 버튼·콜백만 확인).
function expand(node: any): any[] {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return expand(node.type(node.props));
  if (typeof node.type === 'symbol') return expand(node.props.children);
  return [{ type: node.type, props: node.props, children: expand(node.props.children) }];
}
const all = (node: any): any[] => typeof node !== 'object' ? [] : [node, ...node.children.flatMap(all)];
const text = (node: any): string => typeof node !== 'object' ? String(node) : node.children.map(text).join('');
function resultView(service: ExpeditionEconomy, result: any) {
  const calls: any[] = [];
  const app: any = { expedition: service, eco: service.eco, stageStarting: false, battle: { result: {} }, toLobby: () => calls.push(['lobby']), meta: { openTab: () => {} } };
  const controller: any = { app, result: { saveError: null, rewards: {}, kills: 1, combo: 1, time: 60, name: 'x', ...result }, close: () => calls.push(['close']),
    open: (tab: string, options: any) => calls.push(['open', tab, options]), render: () => calls.push(['render']) };
  const launch = (...args: any[]) => calls.push(['launch', ...args]);
  const view = expand(ExpeditionResult({ controller, launch, message: '', focusRef: { current: null } }))[0];
  const footer = all(view).find(n => n.type === 'footer'), buttons = footer.children.filter((n: any) => n.type === 'button');
  return { calls, controller, buttons, footer };
}

test('결과 화면: 기본 승리는 심층 준비 또는 잠김 사유가 붙은 재도전, 심층 승리는 같은 심층 재도전이 기본 행동이다', () => {
  for (const id of ids) {
    const eco = new Economy(), service = new ExpeditionEconomy(eco), deep: any = expeditionDepth(id);
    service.s.stats[id] = 1; service.s.level = 2; eco.s.energy = 50;
    // 잠김: '다음 도전 · 다시 도전'이 첫 버튼이고 같은 재도전 버튼은 중복하지 않는다.
    let view = resultView(service, { win: true, kind: 'dungeon', id, depth: 'standard' });
    expect(view.buttons[0].props['data-next-challenge']).toBe('retry');
    expect(text(view.buttons[0])).toBe(`다음 도전 · 다시 도전 · 에너지 4심층 잠김 · 캠페인 ${deep.unlockCode} 클리어 필요`);
    expect(view.buttons.filter((b: any) => text(b).startsWith('다시 도전'))).toHaveLength(0);
    expect(view.buttons.some((b: any) => b.props['data-next-dungeon'])).toBe(false);
    view.buttons[0].props.onClick();
    expect(view.calls).toEqual([['launch', 'dungeon', id, { depth: 'standard' }]]);
    // 열림: 심층 카드로 이동만 하고(에너지·보상 없음) 기본 재도전은 보조 버튼으로 남는다.
    eco.s.progress.stars[deep.unlockCode] = 1;
    const energy = eco.s.energy, wins = service.s.depthWins[id];
    view = resultView(service, { win: true, kind: 'dungeon', id, depth: 'standard' });
    expect(view.buttons[0].props['data-next-challenge']).toBe('deep-prep');
    expect(text(view.buttons[0])).toContain('다음 도전 · 심층 원정 준비');
    const retry = view.buttons.find((b: any) => text(b).startsWith('다시 도전'));
    expect(retry.props.className).toBe('exp-result-retry');
    view.buttons[0].props.onClick();
    expect(view.calls).toEqual([['lobby'], ['open', 'dungeons', { depth: 'deep' }]]);
    expect(view.controller.focusDungeon).toEqual({ id, depth: 'deep' }); expect(view.controller.result).toBeNull();
    expect([eco.s.energy, service.s.depthWins[id]]).toEqual([energy, wins]);
    // 심층 승리: 같은 심층 재도전.
    view = resultView(service, { win: true, kind: 'dungeon', id, depth: 'deep' });
    expect(text(view.buttons[0])).toContain('다음 도전 · 심층 재도전 · 에너지 6');
    view.buttons[0].props.onClick();
    expect(view.calls).toEqual([['launch', 'dungeon', id, { depth: 'deep' }]]);
    // 패배는 기존 재도전만, 저장 실패는 모든 이동을 막는다.
    view = resultView(service, { win: false, kind: 'dungeon', id, depth: 'deep' });
    expect(view.buttons.some((b: any) => b.props['data-next-challenge'])).toBe(false);
    expect(text(view.buttons[0])).toBe('다시 도전 · 에너지 6');
    view = resultView(service, { win: true, kind: 'dungeon', id, depth: 'standard', saveError: 'storage' });
    expect(view.buttons.some((b: any) => b.props['data-next-challenge'])).toBe(false);
  }
  // 다른 던전 결과 화면은 그대로다.
  const view = resultView(new ExpeditionEconomy(new Economy()), { win: true, kind: 'dungeon', id: 'glass_garden', depth: 'standard' });
  expect(view.buttons.some((b: any) => b.props['data-next-challenge'])).toBe(false);
  expect(view.buttons.find((b: any) => text(b).startsWith('다시 도전')).props.className).toBe('exp-primary');
});

test('누르는 순간 해금 상태가 달라졌으면 출격하지 않고 다시 그린다', () => {
  const eco = new Economy(), service = new ExpeditionEconomy(eco);
  service.s.stats.glacier_tide_basin = 1; service.s.level = 2; eco.s.progress.stars['4-10'] = 1;
  const view = resultView(service, { win: true, kind: 'dungeon', id: 'glacier_tide_basin', depth: 'standard' });
  expect(view.buttons[0].props['data-next-challenge']).toBe('deep-prep');
  delete eco.s.progress.stars['4-10'];
  view.buttons[0].props.onClick();
  expect(view.calls).toEqual([['render']]);
});
