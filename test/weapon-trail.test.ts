import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import { WeaponTrail, createWeaponTrailMaterial, weaponTrailGain } from '../src/engine/weapon-trail.js';
import { Actor } from '../src/game/actor.js';

afterEach(() => mock.restore());

function fixture(options: any = {}) {
  let frame = 0;
  const texture = new THREE.Texture();
  const material = createWeaponTrailMaterial(texture, 0x55aaff);
  const trail = new WeaponTrail((points: THREE.Vector3[]) => {
    points[0]!.set(frame, 1, 0); points[1]!.set(frame++, 3, 0); return points;
  }, material, { segs: 6, life: .2, width: .75, ...options });
  return { trail, texture };
}

test('리본은 포화·새 프레임에서도 고정 버퍼·출력 벡터를 재사용하고 한 mesh를 유지한다', () => {
  const { trail, texture } = fixture();
  const retained = { samples: trail.samples, pos: trail.pos, uv: trail.uv, alpha: trail.alpha, points: trail.points };
  const clones = spyOn(THREE.Vector3.prototype, 'clone').mockImplementation(() => { throw new Error('프레임 벡터 복제'); });
  for (let i = 0; i < 120; i++) trail.update(1 / 60);
  expect(trail.n).toBe(6); expect(trail.pos[0]).toBe(119); expect(trail.pos[30]).toBe(114);
  expect(trail.pos[1]).toBe(1.5); expect(trail.pos[4]).toBe(3);
  expect(trail.geo.drawRange.count).toBe(30);
  expect(trail.mesh.children).toHaveLength(0); expect(trail.mat.forceSinglePass).toBe(true);
  for (const key of ['samples', 'pos', 'uv', 'alpha', 'points'] as const) expect(trail[key]).toBe(retained[key]);
  expect(clones).not.toHaveBeenCalled(); trail.dispose(); texture.dispose();
});

test('준비·pause는 잔광을 만들지 않고 접촉 뒤 stop된 리본은 시간에 따라 감쇠·단일 해제된다', () => {
  let gain = 0;
  const { trail, texture } = fixture({ getGain: () => gain });
  let geometryDisposed = 0, materialDisposed = 0;
  trail.geo.addEventListener('dispose', () => geometryDisposed++);
  trail.mat.addEventListener('dispose', () => materialDisposed++);
  trail.update(.016); expect(trail.n).toBe(0); expect(trail.geo.drawRange.count).toBe(0);
  gain = 1; trail.update(.016); trail.update(.016);
  const time = trail.t, alpha = trail.alpha[0];
  trail.update(0); expect(trail.t).toBe(time); expect(trail.alpha[0]).toBe(alpha);
  trail.stop(); trail.update(.06); expect(trail.alpha[0]).toBeLessThan(alpha);
  trail.update(.3); expect(trail.dead).toBe(true); expect(trail.geo.drawRange.count).toBe(0);
  trail.dispose(); trail.update(.1); expect(geometryDisposed).toBe(1); expect(materialDisposed).toBe(1);
  texture.dispose();
});

test('공격 구간 밝기는 접촉 전·후와 회전 지속을 읽으며 판정 데이터와 난수를 변경하지 않는다', () => {
  const rng = spyOn(Math, 'random').mockImplementation(() => { throw new Error('전투 난수 사용'); });
  expect(weaponTrailGain(.05, .4)).toBe(0); expect(weaponTrailGain(.4, .4)).toBe(1);
  expect(weaponTrailGain(.55, .4)).toBeGreaterThan(0); expect(weaponTrailGain(.7, .4)).toBe(0);
  expect(weaponTrailGain(.8, .4, true)).toBe(1); expect(weaponTrailGain(1, .4, true)).toBe(0);
  expect(weaponTrailGain(NaN, .4)).toBe(0); expect(rng).not.toHaveBeenCalled();
});

test('무기 끝은 기존 단위·소켓 계약을 유지하며 호출자가 준 점을 재사용한다', () => {
  const actor: any = Object.create(Actor.prototype), hand = new THREE.Bone();
  hand.name = 'RightHand'; hand.position.set(2, 1, 3); hand.rotation.z = .3;
  actor.model = new THREE.Group(); actor.model.add(hand);
  actor.model.userData.authoredContract = { sockets: { 'handslot.r': 'RightHand' } };
  actor.scale = 1; actor.model.updateMatrixWorld(true);
  const points = [new THREE.Vector3(), new THREE.Vector3()];
  expect(actor.weaponPoints('handslot.r', 1.2, points)).toBe(points);
  expect(points[0]!.distanceTo(points[1]!)).toBeCloseTo(1.2, 7);
  const first = points[0]; hand.position.x = 4; actor.model.updateMatrixWorld(true);
  expect(actor.weaponPoints('handslot.r', 1.2, points)[0]).toBe(first); expect(first!.x).toBe(4);
});

test('셰이더는 공유 텍스처·안개·출력 변환을 유지하고 날과 시간 감쇠를 한 패스로 합친다', () => {
  const texture = new THREE.Texture(), material = createWeaponTrailMaterial(texture, 0xffcc55);
  expect(material.uniforms.map!.value).toBe(texture);
  expect(material.vertexShader).toContain('vTrailAlpha = trailAlpha');
  expect(material.fragmentShader).toContain('bladeCore'); expect(material.fragmentShader).toContain('diffuseColor.a *= vTrailAlpha');
  expect(material.fragmentShader).toContain('#include <fog_fragment>');
  expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
  material.dispose(); texture.dispose();
});
