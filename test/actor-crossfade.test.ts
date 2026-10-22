import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Actor, fadeOutFromCurrent } from '../src/game/actor.js';

// 실제 three AnimationMixer 로 Actor.play 의 크로스페이드 무게를 확인한다(모델·DOM 없이 숫자 트랙만).
function rig() {
  const root = new THREE.Object3D(); root.name = 'r';
  const mixer = new THREE.AnimationMixer(root);
  const clip = (name: string, v: number) => new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [v, v])]);
  const clips: Record<string, THREE.AnimationClip> = { A: clip('A', 0), B: clip('B', 10), C: clip('C', 20) };
  const actor: any = Object.create(Actor.prototype);
  Object.assign(actor, { mixer, clips, action: null, actionName: null, state: 'idle', _attackMotion: null });
  return { root, mixer, actor, clips };
}
const w = (mixer: THREE.AnimationMixer, clip: THREE.AnimationClip) => mixer.existingAction(clip)?.getEffectiveWeight() ?? 0;

test('막 페이드인을 시작한 동작을 다음 프레임에 끊어도 무게가 1 로 튀지 않는다(회피 끝 Idle → 공격)', () => {
  const { mixer, actor, clips, root } = rig(), dt = 1 / 60;
  actor.play('A', { fade: 0 }); mixer.update(dt);
  actor.play('B', { fade: .15 }); mixer.update(dt);          // B: 1 프레임 페이드인(≈.11)
  const bBefore = w(mixer, clips.B);
  expect(bBefore).toBeGreaterThan(0); expect(bBefore).toBeLessThan(.2);
  actor.play('C', { fade: .1 }); mixer.update(dt);           // B 를 끊고 C 로
  // 예전(three fadeOut)은 B 가 1 로 뛰어 C 앞에 B 자세가 한 프레임 전신으로 보였다.
  expect(w(mixer, clips.B)).toBeLessThanOrEqual(bBefore + 1e-6);
  let prevB = w(mixer, clips.B);
  for (let i = 0; i < 12; i++) { mixer.update(dt); const b = w(mixer, clips.B); expect(b).toBeLessThanOrEqual(prevB + 1e-6); prevB = b; }
  expect(prevB).toBe(0);
  // 섞인 위치도 B(10)쪽으로 튀지 않고 A(0)→C(20) 사이를 단조롭게 지난다.
  expect(root.position.x).toBeCloseTo(20, 3);
});

test('같은 프레임에 두 번 바뀌면(Idle 후 즉시 공격) 첫 동작은 0 무게에서 내려간다', () => {
  const { mixer, actor, clips } = rig(), dt = 1 / 60;
  actor.play('A', { fade: 0 }); mixer.update(dt);
  actor.play('B', { fade: .15 }); actor.play('C', { fade: .1 }); mixer.update(dt);
  expect(w(mixer, clips.B)).toBeCloseTo(0, 6);
});

test('완전히 켜진 동작은 예전처럼 1 에서 정해진 시간에 0 으로 내려간다', () => {
  const { mixer, actor, clips } = rig(), dt = 1 / 60;
  actor.play('A', { fade: 0 }); mixer.update(dt);
  actor.play('B', { fade: .1 }); mixer.update(dt);
  expect(w(mixer, clips.A)).toBeCloseTo(1 - dt / .1, 3);
  for (let i = 0; i < 6; i++) mixer.update(dt);
  expect(w(mixer, clips.A)).toBe(0);
  // 비활성 동작에 써도 무게가 생기지 않는다
  const idle: any = mixer.clipAction(clips.C); idle.enabled = false; fadeOutFromCurrent(idle, .1);
  expect(idle._weightInterpolant.sampleValues[0]).toBe(0);
});
