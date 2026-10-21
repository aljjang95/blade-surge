// 광전사 드라칸 배너·초상 렌더 페이지. 게임과 같은 loadHeroModel → spawnCharacter → applyLook(양손 도끼 착용) 경로로
// 현행 3D 영웅 모델을 그린다. 외부 이미지·생성 AI를 쓰지 않는 자체 렌더(저작권 안전 대체본).
// ?w=900&h=1200 &pose=<클립 이름>&t=<0~1 클립 진행도>&shot=banner|portrait
import * as THREE from 'three';
const { loadHeroModel, spawnCharacter } = await import('/src/engine/assets.js');
const { applyLook } = await import('/src/game/look.js');
const { HEROES } = await import('/src/data/heroes.js');
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 900), H = +(q.get('h') || 1200), shotKind = q.get('shot') || 'banner';
const poseName = q.get('pose') || 'cheer', poseT = +(q.get('t') || 0.5);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
// 배경: 잿불 정원의 어두운 불빛 그라데이션(코드로 그린 캔버스 텍스처)
const bg = document.createElement('canvas'); bg.width = 512; bg.height = 512;
const g = bg.getContext('2d'), grad = g.createRadialGradient(256, 330, 20, 256, 300, 420);
grad.addColorStop(0, '#d8561c'); grad.addColorStop(.35, '#7b2810'); grad.addColorStop(.75, '#24100a'); grad.addColorStop(1, '#0b0605');
g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
// 떠오르는 불씨(고정 시드)
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 90; i++) { const x = rnd() * 512, y = rnd() * 512, r = .6 + rnd() * 1.8; g.fillStyle = `rgba(255,${150 + rnd() * 90 | 0},60,${.25 + rnd() * .6})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
const tex = new THREE.CanvasTexture(bg); tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;
scene.add(new THREE.HemisphereLight(0xfff0e0, 0x2a1810, 1.0));
const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(-2.4, 3.8, 3.4); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5; key.shadow.camera.top = 3; key.shadow.camera.bottom = -1.2; scene.add(key);
const rim = new THREE.DirectionalLight(0xff8a40, 2.2); rim.position.set(3, 2.2, -3); scene.add(rim);
const ember = new THREE.PointLight(0xff5a14, 5, 6, 1.8); ember.position.set(0, .2, 1.2); scene.add(ember);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.ShadowMaterial({ opacity: .55 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const def = HEROES.barbarian;
const gltf = await loadHeroModel('barbarian', 1);
const { root: model, mixer, clips } = spawnCharacter(gltf);
applyLook(model, def, {}, {});
model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
model.rotation.y = +(q.get('rot') || (shotKind === 'banner' ? .35 : .2));
scene.add(model);
// 로드가 비동기로 몸체를 바꿀 수 있어 잠시 기다린 뒤 자세를 적용한다
await new Promise((r) => setTimeout(r, 2500));
const clip = clips[poseName] || clips.Idle;
const action = mixer.clipAction(clip); action.play(); action.time = clip.duration * poseT; mixer.update(0);
model.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(shotKind === 'banner' ? 30 : 22, W / H, .1, 50);
if (shotKind === 'banner') {
  // 가로로 잘리는 배너 칸(위쪽 기준 cover)에서도 보이도록, 영웅을 오른쪽 위(가로 62%·세로 26%)에 영상 높이의 36%로 둔다.
  // 왼쪽 아래는 제목 글자 자리다.
  const dist = size.y / (0.36 * 2 * Math.tan(THREE.MathUtils.degToRad(15))) + size.z * .5;
  camera.position.set(center.x - dist * .1, center.y, center.z + dist); camera.lookAt(center);
  camera.setViewOffset(W, H, -0.12 * W, 0.24 * H, W, H);
} else {
  // 상반신 근접(정사각 초상)
  const top = box.max.y, d = size.y * 1.0 / (2 * Math.tan(THREE.MathUtils.degToRad(11)));
  camera.position.set(center.x - d * .1, top - size.y * .3, center.z + d); camera.lookAt(center.x, top - size.y * .3, center.z);
}
renderer.render(scene, camera);
window.__banner = { clip: clip.name, clips: Object.keys(clips), size: [W, H], shot: shotKind, bodyAsset: model.userData.libraryBodyAssetId || null, bbox: [size.x, size.y, size.z], url: canvas.toDataURL('image/png') };
