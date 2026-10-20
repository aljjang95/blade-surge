// 궁수 같은 자세 전후 캡처용 로컬 페이지. 게임과 같은 loadHeroModel → spawnCharacter → 공격 위상(attackPhase/attackBody)
// → 시위 갱신(poseRangerBowString) 경로를 쓴다. ?mode=before 는 교정본 요청을 원본 GLB 로 바꿔 기준선을 재현한다.
import * as THREE from 'three';
const params = new URLSearchParams(location.search), mode = params.get('mode') || 'after';
if (mode === 'before') {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return original(url.includes('/models/heroes-next/ranger-library-t1-') ? '/asset-library/normalized/hero_ranger_t1.glb' : input, init);
  };
}
const { loadHeroModel, spawnCharacter, poseRangerBowString } = await import('/src/engine/assets.js');
const { attackPhase, attackBody } = await import('/src/game/combat-motion.js');
const { HEROES } = await import('/src/data/heroes.js');

const COLS = [
  ['idle', 'Idle', 0, null], ['run', 'Running_A', .25, null], ['dodge 중간', 'Dodge_Forward', .45, null], ['백스텝 중간', 'Dodge_Backward', .45, null],
  ['노크(t=.20)', 'Bow_Shoot', null, .20], ['만작(t=.40)', 'Bow_Shoot', null, .40], ['발사 직후(t=.45)', 'Bow_Shoot', null, .45], ['회수(t=.75)', 'Bow_Shoot', null, .75],
];
const VIEWS = [['게임 3/4', new THREE.Vector3(2.6, 3.3, 3.4), 30, .95], ['측면', new THREE.Vector3(4.2, 1.3, 0.001), 30, .95], ['손 근접', new THREE.Vector3(-1.35, 1.3, 1.0), 26, 1.12]];
const W = 240, H = 300;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W * COLS.length, H * VIEWS.length); renderer.setScissorTest(true);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2b3138);
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3226, 1.25));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(3, 6, 4); scene.add(sun);
const rim = new THREE.DirectionalLight(0xb4d6ff, 1.1); rim.position.set(-4, 3, -3); scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), new THREE.MeshStandardMaterial({ color: 0x4a5148, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

const gltf = await loadHeroModel('ranger', 1);
const { root: model, mixer, clips } = spawnCharacter(gltf);
const actorRoot = new THREE.Group(), pivot = new THREE.Group(); actorRoot.add(pivot); pivot.add(model); scene.add(actorRoot);
const camera = new THREE.PerspectiveCamera(30, W / H, .1, 50);
const report = { mode, revision: gltf.parser?.json?.asset?.extras?.rangerLibraryRevision || null, cells: [] };
const lab = document.getElementById('lab'); lab.style.gridTemplateColumns = 'repeat(' + COLS.length + ',' + W + 'px)';
const combo = HEROES.ranger.combo[0];
COLS.forEach(([label, clipName, k, t], col) => {
  mixer.stopAllAction();
  // 게임과 같은 폴백: 교정 전 몸체에는 Dodge_Backward 가 없어 백스텝도 Dodge_Forward 를 재생한다.
  const clip = clips[clipName] || clips.Dodge_Forward;
  const action = mixer.clipAction(clip); action.reset(); action.play();
  action.time = t === null ? clip.duration * k : attackPhase(t, combo.hitAt) * clip.duration;
  mixer.update(0);
  pivot.rotation.set(0, 0, 0); pivot.position.set(0, 0, 0);
  if (t !== null) { const pose = attackBody(t, combo.hitAt, 'bow', true); pivot.rotation.set(pose.pitch, pose.yaw, pose.roll || 0); pivot.position.z = pose.forward; }
  actorRoot.updateMatrixWorld(true);
  const held = mode === 'after' ? poseRangerBowString(model, t !== null && t < combo.hitAt) : poseRangerBowString(model, false);
  actorRoot.updateMatrixWorld(true);
  VIEWS.forEach(([, eye, fov, lookY], row) => {
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.position.copy(eye); camera.lookAt(0, lookY, .2); camera.updateMatrixWorld();
    renderer.setViewport(col * W, (VIEWS.length - 1 - row) * H, W, H); renderer.setScissor(col * W, (VIEWS.length - 1 - row) * H, W, H);
    renderer.render(scene, camera);
  });
  const bow = model.getObjectByName('Bow'), hand = model.getObjectByName('mixamorigLeftHand');
  report.cells.push({ label, clip: clipName, time: +action.time.toFixed(3), held, bowY: +bow.getWorldPosition(new THREE.Vector3()).y.toFixed(3),
    handToBow: +hand.getWorldPosition(new THREE.Vector3()).distanceTo(bow.getWorldPosition(new THREE.Vector3())).toFixed(3) });
  const div = document.createElement('div'); div.textContent = (mode === 'before' ? '전 · ' : '후 · ') + label; div.style.padding = '4px'; lab.appendChild(div);
});
window.__rangerStudio = report;




