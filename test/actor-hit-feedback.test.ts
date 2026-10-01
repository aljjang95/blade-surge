import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Actor } from '../src/game/actor.js';
import { PartySession } from '../src/party/session.js';

function fixture(reduced = false) {
  const source = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color: 0x845e39 });
  const geometry = new THREE.BoxGeometry(); source.add(new THREE.Mesh(geometry, material));
  const actor = new Actor({ scene: new THREE.Scene(), app: { reducedMotion: { matches: reduced } } }, { scene: source, animations: [] }, {});
  return { actor, material, geometry, dispose() { actor.dispose(); geometry.dispose(); material.dispose(); } };
}

test('긴 치명타가 재질을 더 밝게 태우지 않고 색·원본 재질을 보존한다', () => {
  const f = fixture(), m = f.actor.mats[0], originalColor = m.color.clone();
  for (const duration of [.12, .18, .5]) {
    f.actor.flash(0xffffff, duration); f.actor.update(0);
    expect(m.emissive.r).toBeLessThanOrEqual(.4);
    expect(m.color.equals(originalColor)).toBe(true);
    f.actor.update(duration / 2);
    expect(m.emissive.r).toBeLessThan(.1);
    f.actor.update(duration); f.actor.update(0);
    expect(m.emissive.toArray()).toEqual([0, 0, 0]);
  }
  expect(f.material.emissive.toArray()).toEqual([0, 0, 0]); f.dispose();
});

test('발광 감쇠는 dt 분할과 무관하고 장비·유령 발광을 정확히 복원한다', () => {
  const a = fixture(), b = fixture();
  for (const f of [a, b]) {
    Object.assign(f.actor, { tintEmissive: new THREE.Color(.05, .1, .15) });
    f.actor.mats[0].userData.baseEmissive = new THREE.Color(.1, .02, .03);
    f.actor.flash(0xffd040, .18);
  }
  a.actor.update(.06); for (let i = 0; i < 6; i++) b.actor.update(.01);
  for (const key of ['r', 'g', 'b'] as const) expect(a.actor.mats[0].emissive[key]).toBeCloseTo(b.actor.mats[0].emissive[key], 12);
  for (const f of [a, b]) {
    f.actor.update(.2); f.actor.update(0);
    for (const [i, value] of f.actor.mats[0].emissive.toArray().entries()) expect(value).toBeCloseTo([.15, .12, .18][i], 12);
    f.dispose();
  }
});

test('reduced motion은 피격 신호를 줄이고 새 플래시·재출격 액터에 상태를 남기지 않는다', () => {
  const f = fixture(true); f.actor.flash(); f.actor.update(0);
  expect(f.actor.mats[0].emissive.r).toBeLessThanOrEqual(.16);
  f.actor.update(.07); f.actor.flash(0xff0000, .15); f.actor.update(0);
  expect(f.actor.flashT).toBe(.15); expect(f.actor.mats[0].emissive.g).toBe(0);
  f.actor.update(.2); expect(f.actor.flashT).toBe(0); f.dispose();
  const fresh = fixture(); fresh.actor.update(0);
  expect(fresh.actor.mats[0].emissive.toArray()).toEqual([0, 0, 0]); fresh.dispose();
});

test('파티 복제 액터와 로컬 액터는 같은 피격 신호를 사용하고 체력 복제를 보존한다', () => {
  const local = fixture(), remote = fixture();
  local.actor.flash(0xffd040, .18); remote.actor.flash(0xffd040, .18);
  for (let i = 0; i < 15; i++) {
    local.actor.update(1 / 60);
    PartySession.prototype.applyPose.call({}, remote.actor, { x: 0, z: 0, yaw: 0, hp: 73, maxHp: 100, state: 'idle' }, 1 / 60);
    expect(remote.actor.mats[0].emissive.toArray()).toEqual(local.actor.mats[0].emissive.toArray());
    expect(remote.actor.hp).toBe(73);
  }
  local.dispose(); remote.dispose();
});
