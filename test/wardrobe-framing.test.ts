import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { measureWardrobeFrame, wardrobeCameraFrame } from '../src/expansion/wardrobe.jsx';

test('착용 미리보기는 숨긴 무기를 제외하고 실제 대기 동작 범위를 재며 리그 원점을 보존한다', () => {
  const root = new THREE.Group(); root.position.set(.2, .3, -.4);
  const material = new THREE.MeshBasicMaterial();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .5), material); body.position.y = 1;
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(.15, 3.2, .15), material);
  weapon.name = 'VisibleStaff'; weapon.position.set(1.2, 1.6, .2);
  const hidden = new THREE.Group(); hidden.visible = false;
  const spare = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), material); spare.position.x = 1000; hidden.add(spare);
  root.add(body, weapon, hidden);
  const clip = new THREE.AnimationClip('Idle', 1, [new THREE.NumberKeyframeTrack('VisibleStaff.position[x]', [0, .5, 1], [1.2, 2.4, 1.2])]);
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
  const originalPosition = root.position.clone();
  const frame = measureWardrobeFrame({ root, mixer, clips: { Idle: clip } });
  expect(root.position.equals(originalPosition)).toBe(true); expect(mixer.time).toBe(0);
  expect(frame.height).toBeCloseTo(2.7); expect(frame.radius).toBeGreaterThan(1.2); expect(frame.radius).toBeLessThan(1.4);

  const turntable = new THREE.Group(), offset = new THREE.Group();
  turntable.scale.setScalar(frame.scale); offset.position.fromArray(frame.offset); offset.add(root); turntable.add(offset);
  const point = new THREE.Vector3();
  for (const [width, height] of [[424, 532], [292, 210], [170, 140], [750, 300]]) {
    const fit = wardrobeCameraFrame(frame, width, height);
    const camera = new THREE.PerspectiveCamera(36, width / height, fit.near, fit.far);
    camera.position.set(0, fit.lookY, fit.distance); camera.lookAt(0, fit.lookY, 0); camera.updateMatrixWorld(true);
    for (let step = 0; step <= 8; step++) {
      mixer.setTime(step / 8);
      for (let yaw = 0; yaw < 16; yaw++) {
        turntable.rotation.y = yaw * Math.PI / 8; turntable.updateMatrixWorld(true);
        for (const mesh of [body, weapon]) for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
          mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld).project(camera);
          expect(Math.abs(point.x)).toBeLessThan(.89);
          expect(Math.abs(point.y)).toBeLessThan(height <= 260 ? 1 - 72 / height : 1 - 32 / height);
          expect(Math.abs(point.z)).toBeLessThan(1);
        }
      }
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  body.geometry.dispose(); weapon.geometry.dispose(); spare.geometry.dispose(); material.dispose();
});

test('스킨의 초기 boundingBox가 현재 포즈보다 작아도 이동한 정점을 포함한다', () => {
  const geometry = new THREE.BoxGeometry(1, 2, .5), count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4); for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone(); bone.name = 'PreviewBone'; mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
  mesh.computeBoundingBox();
  const root = new THREE.Group(); root.add(mesh);
  const clip = new THREE.AnimationClip('Idle', 1, [new THREE.NumberKeyframeTrack('PreviewBone.position[x]', [0, .5, 1], [0, 4, 0])]);
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
  const frame = measureWardrobeFrame({ root, mixer, clips: { Idle: clip } });
  expect(frame.radius).toBeGreaterThan(3.3); expect(frame.offset[0]).toBeCloseTo(-2);
  expect(bone.position.x).toBe(0); expect(mesh.boundingBox!.max.x).toBeCloseTo(.5);
  mixer.stopAllAction(); mixer.uncacheRoot(root); mesh.skeleton.dispose(); geometry.dispose(); mesh.material.dispose();
});
