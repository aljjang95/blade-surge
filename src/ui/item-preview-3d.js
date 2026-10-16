// 아이템 상세의 선택형 3D 미리보기. 목록 썸네일과 같은 모델 빌더(item-visual-model.js) · 같은 조명 · 같은 첫 시점을 쓴다.
// 시트 하나에 렌더러 하나만 만들고 시트가 닫히거나 바뀌면 즉시 해제한다. 격자 칸마다 WebGL 을 만들지 않는다.
// 영웅 문맥(heroId)이 있으면 그 영웅이 실제로 드는 형태(LOOKS → ITEM_WEAPON_FORMS, 병기고 장식 규칙)로 만든다.
// 같은 문맥의 itemVisual(item, { heroId }) 썸네일도 같은 해석(resolveItemForm)으로 구운 그림이다.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ITEM_FORM_LABEL, itemFormCaption, resolveItemForm } from './item-visual-forms.js';
import { buildItemVisualModel, itemViewDirection } from './item-visual-model.js';

/** 형태 이름표(호환용). 새 코드는 itemVisual(item, { heroId }).formLabel 을 쓴다. */
export const FORM_LABEL = ITEM_FORM_LABEL;

// 이름 끝 글자의 받침에 맞춰 조사를 고른다(아르카가 / 카인이, 리아는 / 드라칸은).
const hasFinal = (word) => { const code = String(word || '').trim().slice(-1).charCodeAt(0) - 0xac00; return code >= 0 && code <= 11171 && code % 28 !== 0; };
export const josa = (word, withFinal, withoutFinal) => String(word) + (hasFinal(word) ? withFinal : withoutFinal);

/** 선택 영웅이 이 장비를 착용할 때 보이는 형태 id. 무기가 아니면 부위 이름을 돌려준다. */
export function previewForm(item, heroId) {
  return resolveItemForm(item, heroId).form;
}

/**
 * 미리보기 아래 한 줄 캡션. 같은 문맥의 목록 그림과 같은 사실만 짧게 말한다(예: '실바 착용 · 장궁').
 * heroName 인자는 호환용이며 이름은 영웅 정의에서 읽는다.
 */
export function previewCaption(item, heroId, heroName = '') {
  void heroName;
  return itemFormCaption(resolveItemForm(item, heroId), item);
}

const KEY_STEP = Math.PI / 8;

/**
 * host 안에 캔버스를 만들고 회전 가능한 미리보기를 띄운다. 반환한 dispose 를 반드시 부른다.
 * 끌기 또는 캔버스에 초점을 둔 뒤 ← → 로 돌리고 Home 으로 처음 시점(목록 그림과 같은 각도)으로 돌아간다.
 * @param {HTMLElement} host
 * @param {any} item
 * @param {{ heroId?: string|null, reducedMotion?: boolean }} options
 */
export async function mountItemPreview(host, item, { heroId = null, reducedMotion = false } = {}) {
  const form = resolveItemForm(item, heroId);
  const direction = itemViewDirection(item.slot);
  const homeYaw = -Math.atan2(direction.x, direction.z), tilt = Math.asin(direction.y);
  let disposed = false, frame = 0, model = null, last = 0, yaw = homeYaw, dragging = null, autoSpin = !reducedMotion;
  const width = Math.max(160, Math.round(host.clientWidth || 280)), height = Math.max(160, Math.round(host.clientHeight || 220));
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1)); renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0, 0);
  const canvas = renderer.domElement; canvas.className = 'is-preview-canvas'; canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', item.name + ' 3D 미리보기 · ' + itemFormCaption(form, item) + '. 끌거나 좌우 화살표로 돌려 볼 수 있습니다.');
  host.replaceChildren(canvas);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const env = pmrem.fromScene(room); scene.environment = env.texture; room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe9f2ff, 0x324151, 1.25));
  for (const [x, y, z, power] of [[-3, 5, 6, 2.8], [4, 2, -2, 4.5]]) { const light = new THREE.DirectionalLight(0xffffff, power); light.position.set(x, y, z); scene.add(light); }
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
  const pivot = new THREE.Group(); scene.add(pivot);
  const render = () => { if (!disposed) { pivot.rotation.y = yaw; renderer.render(scene, camera); } };
  const tick = (time) => {
    frame = 0; if (disposed) return;
    const dt = last ? Math.min(.05, (time - last) / 1000) : 0; last = time;
    if (!dragging && autoSpin) yaw += dt * .6;
    render(); if (autoSpin || dragging) frame = requestAnimationFrame(tick);
  };
  const onDown = (event) => { dragging = { id: event.pointerId, x: event.clientX, yaw }; canvas.setPointerCapture?.(event.pointerId); if (!frame) frame = requestAnimationFrame(tick); };
  const onMove = (event) => { if (!dragging || dragging.id !== event.pointerId) return; yaw = dragging.yaw + (event.clientX - dragging.x) * .012; if (!autoSpin) render(); };
  const onUp = (event) => { if (dragging?.id === event.pointerId) dragging = null; };
  // 키보드로 돌리면 자동 회전을 멈추고 사용자가 고른 각도를 유지한다.
  const onKey = (event) => {
    const step = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0;
    if (!step && event.key !== 'Home') return;
    event.preventDefault(); event.stopPropagation();
    autoSpin = false; yaw = step ? yaw + step : homeYaw; render();
  };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('keydown', onKey);
  canvas.style.touchAction = 'none';
  const lost = (event) => { event.preventDefault(); dispose(); host.textContent = '3D 미리보기를 표시할 수 없습니다.'; };
  canvas.addEventListener('webglcontextlost', lost);
  function dispose() {
    if (disposed) return; disposed = true;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('keydown', onKey);
    model?.userData.dispose?.(); model = null;
    env.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
  }
  try {
    model = await buildItemVisualModel(item, form);
    if (disposed) { model.userData.dispose?.(); model = null; return { dispose, form }; }
    const stage = new THREE.Group(); stage.add(model); pivot.add(stage);
    const box = new THREE.Box3().setFromObject(stage), center = box.getCenter(new THREE.Vector3()), sphere = box.getBoundingSphere(new THREE.Sphere());
    stage.position.sub(center);
    const radius = Math.max(.01, sphere.radius) * 1.05, aspect = width / height;
    camera.left = -radius * aspect; camera.right = radius * aspect; camera.top = radius; camera.bottom = -radius;
    camera.position.set(0, Math.sin(tilt) * 5, Math.cos(tilt) * 5); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    render(); if (autoSpin) frame = requestAnimationFrame(tick);
  } catch (error) {
    dispose(); host.textContent = '3D 미리보기를 불러오지 못했습니다.';
    console.warn('item preview', error);
  }
  return { dispose, form };
}
