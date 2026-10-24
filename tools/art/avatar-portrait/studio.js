// 아바타 상점 초상 렌더 페이지(vite dev 서버에서 연다). 게임과 같은 경로로 몸을 고른다:
// loadModel(영웅 모델) → spawnCharacter → preloadHeroBody(영웅, 1, 아바타) → applyLook(…, { avatarId }) — 교정 몸이 있으면 교정 몸(resolveAssetSource).
// 배경 없이(투명) 얼굴 3/4 상반신을 그리고 window.__portrait 로 PNG data URL 과 실제 몸 id·원본 경로를 돌려준다. 합성은 render.mjs 가 한다.
//   ?id=<avatar id>&size=<px>&yaw=<rad>
import * as THREE from 'three';
const { loadModel, spawnCharacter, preloadHeroBody } = await import('/src/engine/assets.js');
const { applyLook } = await import('/src/game/look.js');
const { HEROES } = await import('/src/data/heroes.js');
const { libraryAssetForAvatar, resolveAssetSource } = await import('/src/engine/library-assets.js');
const params = new URLSearchParams(location.search), id = params.get('id') || '';
const S = Number(params.get('size')) || 1024, yaw = Number(params.get('yaw') ?? .55);
try {
  const asset = libraryAssetForAvatar(id), def = asset && HEROES[asset.heroId];
  if (!asset || !def) throw new Error('unknown avatar: ' + id);
  const model = await loadModel(def.model);
  if (!await preloadHeroBody(def.id, 1, id)) throw new Error('avatar body preload failed: ' + id);
  const inst = spawnCharacter(model);
  applyLook(inst.root, def, {}, { avatarId: id });
  const body = inst.root.userData.libraryBodyAssetId;
  if (body !== id) throw new Error(`body mismatch: ${body} != ${id}`);
  if (inst.clips.Idle) inst.mixer.clipAction(inst.clips.Idle).play();
  inst.mixer.update(.25);
  // 무기는 상점 초상(얼굴 3/4 상반신)에서 얼굴을 가릴 수 있으므로 숨긴다. 몸(아바타 메시)만 그린다.
  if (params.get('weapons') !== '1') inst.root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) o.visible = false; });
  inst.root.rotation.y = yaw;
  const scene = new THREE.Scene();
  scene.add(inst.root);
  // 조명: 게임 실시간 초상(src/ui/hero-portraits.js)과 같은 구성 + 테마 배경에서 윤곽이 뜨도록 림을 조금 올린다.
  scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x514b40, 2));
  const key = new THREE.DirectionalLight(0xffedcf, 2.6); key.position.set(-2, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd8ecff, 2.4); rim.position.set(3, 2.5, -3); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffe2c4, 1.2); rim2.position.set(-3, 2, -2.5); scene.add(rim2);
  // 프레임: 몸(libraryBody 스킨 메시) 정점 상자. 머리 위 여백 7%, 가슴~허리까지(상반신).
  const box = new THREE.Box3(), p = new THREE.Vector3();
  inst.root.updateMatrixWorld(true);
  inst.root.traverseVisible((m) => {
    if (!m.isSkinnedMesh || !m.userData.libraryBody || !m.geometry?.attributes.position) return;
    for (let i = 0; i < m.geometry.attributes.position.count; i++) { m.getVertexPosition(i, p).applyMatrix4(m.matrixWorld); box.expandByPoint(p); }
  });
  if (box.isEmpty()) throw new Error('empty body box');
  const h = box.max.y - box.min.y, c = box.getCenter(new THREE.Vector3());
  const frameH = h * Number(params.get('frame') || .62), top = box.max.y + h * .05;
  const target = new THREE.Vector3(c.x, top - frameH / 2, c.z);
  const fov = 26, dist = frameH / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2)) + (box.max.z - box.min.z) / 2;
  const camera = new THREE.PerspectiveCamera(fov, 1, .01, 100);
  camera.position.copy(target).add(new THREE.Vector3(0, h * .04, dist)); camera.lookAt(target); camera.updateMatrixWorld();
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  renderer.setPixelRatio(1); renderer.setSize(S, S); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.render(scene, camera);
  window.__portrait = { id, heroId: def.id, body, source: resolveAssetSource(asset), sha256: asset.sha256, heightM: +h.toFixed(3), url: canvas.toDataURL('image/png') };
} catch (error) { window.__portrait = { id, error: String(error?.stack || error) }; }
