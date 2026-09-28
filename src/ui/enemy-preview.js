import * as THREE from 'three';
import { loadModel, materialsOf } from '../engine/assets.js';
import { audio } from '../engine/audio.js';
import { Enemy } from '../game/enemies.js';

const noop = () => {};
let renderer = null;
let activePreview = null;

/** Use the battle constructor so fittings, sockets, scale, tint and eyes stay identical. */
export function createPreviewEnemy(scene, gltf, weapons, def) {
  const game = { scene, fx: { dust: noop, castCircle: noop, firePillar: noop, groundTex: noop, ring: noop } };
  // Enemy's spawn audio is synchronous. Restore the setting before yielding to gameplay.
  const enabled = audio.enabled;
  let enemy;
  try {
    audio.enabled = false;
    enemy = new Enemy(game, gltf, weapons, def, 1, new THREE.Vector3());
  } finally { audio.enabled = enabled; }
  // getPart shares cached weapon materials; disposal must only release our own copies.
  const shared = new Set();
  weapons.scene.traverse(o => { if (o.isMesh) for (const material of materialsOf(o)) shared.add(material); });
  enemy.model.traverse(o => {
    if (!o.isMesh) return;
    const own = material => shared.has(material) ? material.clone() : material;
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
  });
  // A still idle pose uses no combat update, rewards, AI, timers or continuous render loop.
  enemy.spawning = false;
  enemy.model.scale.setScalar(enemy.scale);
  enemy.pos.y = enemy.rig.hover || 0;
  enemy.root.rotation.y = enemy.rig.faceFlip ? Math.PI : 0;
  enemy.mixer.stopAllAction();
  enemy.play(enemy.A('idleCombat'), { fade: 0 });
  enemy.mixer.update(0);
  for (const material of enemy.mats) if (enemy.tintEmissive) {
    material.emissive.copy(enemy.tintEmissive);
    if (material.userData.baseEmissive) material.emissive.add(material.userData.baseEmissive);
  }
  enemy.root.updateMatrixWorld(true);
  return enemy;
}

/** One lazily allocated WebGL context for the entire codex, reused across selections. */
export function mountEnemyPreview(host, def) {
  activePreview?.();
  let disposed = false, enemy = null, resize = null, canvas = null;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe7f1ff, 0x66614d, 2.4));
  const key = new THREE.DirectionalLight(0xffe6c4, 3.2); key.position.set(4, 6, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9acbff, 2); rim.position.set(-4, 3, -3); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
  const status = document.createElement('p');
  status.className = 'rpg-preview-status'; status.setAttribute('role', 'status');
  status.textContent = '전투 모델 불러오는 중…'; host.replaceChildren(status);
  host.dataset.previewState = 'loading';

  const contextLost = event => {
    event.preventDefault();
    if (disposed) return;
    const lost = renderer;
    dispose();
    lost?.dispose(); renderer = null;
    host.dataset.previewState = 'error';
    status.textContent = '전투 모델을 표시할 수 없습니다. 항목을 다시 선택해 주세요.';
    host.replaceChildren(status);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; resize?.disconnect();
    canvas?.removeEventListener('webglcontextlost', contextLost);
    enemy?.dispose(); enemy = null;
    canvas?.remove(); renderer?.renderLists.dispose();
    scene.clear();
    if (activePreview === dispose) activePreview = null;
  };
  activePreview = dispose;

  const ready = (async () => {
    try {
      if (!def?.model) throw new Error('Missing enemy model');
      const [gltf, weapons] = await Promise.all([loadModel(def.model), loadModel('skel_weapons')]);
      if (disposed || !host.isConnected) return;
      if (renderer?.getContext().isContextLost()) { renderer.dispose(); renderer = null; }
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
      }
      canvas = renderer.domElement;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${def.name} 실제 전투 모델`);
      canvas.addEventListener('webglcontextlost', contextLost);
      enemy = createPreviewEnemy(scene, gltf, weapons, def);
      const bounds = new THREE.Box3().setFromObject(enemy.model);
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(.25, sphere.radius);
      const render = () => {
        if (disposed || !host.isConnected) return;
        const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
        // Keep the drawing buffer bounded even on unusually large displays.
        const scale = Math.min(1, 640 / width, 480 / height);
        renderer.setSize(Math.round(width * scale), Math.round(height * scale), false);
        camera.aspect = width / height;
        const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
        const halfFov = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
        const distance = radius / Math.sin(halfFov) * 1.12;
        camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(.2, .12, 1).normalize(), distance);
        camera.near = Math.max(.01, distance - radius * 2); camera.far = distance + radius * 3;
        camera.lookAt(sphere.center); camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };
      host.replaceChildren(canvas); host.dataset.previewState = 'ready';
      resize = new ResizeObserver(render); resize.observe(host); render();
    } catch (error) {
      if (disposed) return;
      dispose();
      host.dataset.previewState = 'error';
      status.textContent = '전투 모델을 불러오지 못했습니다. 항목을 다시 선택해 주세요.';
      host.replaceChildren(status);
      console.warn('Enemy preview unavailable', def?.model, error);
    }
  })();
  return { dispose, ready };
}
