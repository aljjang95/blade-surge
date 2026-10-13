import { expect, test } from 'bun:test';
import { ENEMIES } from '../src/data/stages.js';
import { MONSTER_ROSTER } from '../src/data/monster-roster.js';
import manifest from '../asset-library/manifest.json';
import { monsterAttackPhase } from '../src/game/combat-motion.js';
import { RIGS } from '../src/data/rigs.js';
import * as THREE from 'three';
import { Actor } from '../src/game/actor.js';

const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));

test('모든 스테이지 적 모델은 로스터에 있고 fallback은 manifest 자산이다', () => {
  for (const def of Object.values(ENEMIES)) {
    const entry = MONSTER_ROSTER[def.model];
    expect(entry, def.model).toBeDefined();
    expect(assets.has(entry.asset) || assets.has(entry.fallback), def.model).toBe(true);
  }
});

test('monsterAttackPhase는 접촉 프레임을 정확히 맞추고 단조 증가한다', () => {
  for (const [hitAt, impactAt] of [[.2, .35], [.52, .52], [.8, .62]]) {
    let previous = 0;
    for (let i = 0; i <= 1000; i++) {
      const value = monsterAttackPhase(i / 1000, hitAt, impactAt);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
    expect(monsterAttackPhase(hitAt, hitAt, impactAt)).toBeCloseTo(impactAt, 8);
  }
});

test('impact가 없는 자산은 기존 attackPhase와 같은 접촉을 사용한다', () => {
  expect(monsterAttackPhase(.52, .52)).toBeCloseTo(.52, 8);
});

test('라이브러리 리그는 선택 클립과 논리 폴백 체인을 가진다', () => {
  expect(RIGS.library.attack).toEqual(['attack', 'attack2']);
  expect(RIGS.library.attackSpin).toContain('attackHeavy');
  expect(RIGS.library.summon).toContain('roar');
  expect(RIGS.library.raise).toContain('cast');
});

test('같은 Tripo glTF 를 공유해도 배율·비행 높이는 호출자 로스터를 따른다', () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  // 로더 캐시에 먼저 로드된 다른 모델 이름의 로스터가 남아 있는 상황
  scene.userData.libraryAsset = { id: 'ember_drake', hover: .5 };
  scene.userData.libraryRoster = { asset: 'ember_drake', fallback: 'demon_lord', scale: 1.04 };
  const gltf = { scene, animations: [] };
  const game = { scene: new THREE.Scene() };
  const small = new Actor(game, gltf, { scale: 1.5, rig: 'library', roster: { asset: 'ember_drake', fallback: 'demon_lord', scale: .61 } });
  const large = new Actor(game, gltf, { scale: 2.6, rig: 'library', roster: MONSTER_ROSTER.Flying_AbyssRegent });
  expect(small.model.scale.x).toBeCloseTo(1.5 * .61, 6);
  expect(small.rig.hover).toBeCloseTo(.5 * 1.5 * .61, 6);
  expect(large.model.scale.x).toBeCloseTo(2.6 * (MONSTER_ROSTER.Flying_AbyssRegent.scale ?? 1), 6);
});
