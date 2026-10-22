import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Actor } from '../src/game/actor.js';
import { RIGS } from '../src/data/rigs.js';

// 강타·치명타·마무리 피격(Enemy.hurt 의 A('hitHeavy'))이 대기 클립으로 떨어지지 않는지 확인한다.
const clip = (name: string) => new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 1], [0, 1])]);
function actor(rig: string, names: string[], library = false) {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  if (library) scene.userData.libraryAsset = { id: 'fixture_monster' };
  return new Actor({ scene: new THREE.Scene() }, { scene, animations: names.map(clip) }, { rig });
}
function withoutRandom<T>(fn: () => T) {
  const original = Math.random; let calls = 0;
  Math.random = () => { calls++; return 0; };
  try { return { value: fn(), calls }; } finally { Math.random = original; }
}

test('모든 리그가 강타 피격 논리 키를 가진다', () => {
  for (const [name, rig] of Object.entries(RIGS)) expect((rig as Record<string, unknown>).hitHeavy, name).toBeTruthy();
});

test('라이브러리 몬스터: 강타 피격 클립이 있으면 그것, 없으면 일반 피격(대기 클립 아님)', () => {
  const plain = actor('library', ['idle', 'run', 'attack', 'hit', 'death'], true);
  const r = withoutRandom(() => plain.A('hitHeavy'));
  expect(r.value).toBe('hit'); expect(r.calls).toBe(0);   // 전투 난수 흐름을 바꾸지 않는다
  const rich = actor('library', ['idle', 'run', 'attack', 'hit', 'hitHeavy', 'death'], true);
  expect(withoutRandom(() => rich.A('hitHeavy')).value).toBe('hitHeavy');
});

test('KayKit 스켈레톤: 강타 피격은 Hit_B, 일반 피격 후보는 그대로', () => {
  const a = actor('kaykit', ['Idle', 'Idle_Combat', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B']);
  const r = withoutRandom(() => a.A('hitHeavy'));
  expect(r.value).toBe('Hit_B'); expect(r.calls).toBe(0);
  expect(['Hit_A', 'Hit_B']).toContain(a.A('hit'));
});

test('폴백 체인은 배열 후보도 첫 실제 클립으로 푼다(난수 없음)', () => {
  // KayKit 리그에 Hit_B 가 없는 자산: hitHeavy → hit 후보 중 첫 실제 클립
  const a = actor('kaykit', ['Idle', 'Idle_Combat', 'Hit_A']);
  const r = withoutRandom(() => a.A('hitHeavy'));
  expect(r.value).toBe('Hit_A'); expect(r.calls).toBe(0);
  // 기존 라이브러리 체인(강공격 → 공격)은 그대로
  const lib = actor('library', ['idle', 'attack', 'hit'], true);
  expect(withoutRandom(() => lib.A('attackHeavy')).value).toBe('attack');
  expect(withoutRandom(() => lib.A('summon')).value).toBe('attack');
});
