// 궁수 초상(썸네일) 렌더 페이지. 게임과 같은 loadHeroModel → spawnCharacter → 활·시위 경로로 현행 3D 실바를 그린다.
// 다른 영웅 초상(1122×1402, 밝은 배경 전신)과 같은 크기·구도. ?pose=draw|ready
import * as THREE from 'three';
const { loadHeroModel, spawnCharacter, poseRangerBowString } = await import('/src/engine/assets.js');
const params = new URLSearchParams(location.search), poseName = params.get('pose') || 'draw';
const W = 1122, H = 1402;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const bg = document.createElement('canvas'); bg.width = 4; bg.height = 256;
const g = bg.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
grad.addColorStop(0, '#eef0ea'); grad.addColorStop(.62, '#dfe3da'); grad.addColorStop(1, '#c9cec3');
g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
const tex = new THREE.CanvasTexture(bg); tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;
scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x6a6150, 1.55));
const key = new THREE.DirectionalLight(0xfff3e2, 2.6); key.position.set(-2.2, 4.2, 3.6); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -2; key.shadow.camera.right = 2; key.shadow.camera.top = 3; key.shadow.camera.bottom = -1; scene.add(key);
const rim = new THREE.DirectionalLight(0xc8e8ff, 1.5); rim.position.set(3, 2.5, -3); scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: .22 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const gltf = await loadHeroModel('ranger', 1);
const { root: model, mixer, clips } = spawnCharacter(gltf);
model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
scene.add(model);
const clip = poseName === 'ready' ? clips.Idle : clips.Bow_Shoot;
const action = mixer.clipAction(clip); action.play(); action.time = poseName === 'ready' ? 0 : clip.duration * 8 / 24; mixer.update(0);
model.updateMatrixWorld(true);
poseRangerBowString(model, poseName !== 'ready'); model.updateMatrixWorld(true);
const camera = new THREE.PerspectiveCamera(24, W / H, .1, 50);
camera.position.set(-1.55, 1.45, 4.6); camera.lookAt(.12, .98, .05);
renderer.render(scene, camera);
window.__portrait = { pose: poseName, revision: gltf.parser?.json?.asset?.extras?.rangerLibraryRevision || null, url: canvas.toDataURL('image/png') };

