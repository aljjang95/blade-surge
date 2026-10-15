// 아이템 상세의 선택형 3D 미리보기. 썸네일과 같은 원본(item-forge · 방어구 리그 · 병기고 GLB)을 같은 조명으로 그린다.
// 시트 하나에 렌더러 하나만 만들고 시트가 닫히거나 바뀌면 즉시 해제한다. 격자 칸마다 WebGL 을 만들지 않는다.
// 무기는 선택 영웅이 실제로 드는 형태(LOOKS 의 무기 노드 → ITEM_WEAPON_FORMS)로 만든다. 같은 함수가 전투 장착에도 쓰인다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildGearModel, ITEM_WEAPON_FORMS } from '../engine/item-forge.js';
import { assembleHeroIdentity } from '../engine/hero-identity.js';
import { applyArmorAppearance, removeArmorAppearance } from '../game/armor-appearance.js';
import { LOOKS } from '../game/look.js';
import { itemRenderSource } from './item-presentation.js';

export const FORM_LABEL = Object.freeze({ sword: '한손검', greatsword: '양손검', axe: '도끼', greataxe: '양손 도끼', wand: '완드', staff: '지팡이', dagger: '단검', bow: '활' });

// 이름 끝 글자의 받침에 맞춰 조사를 고른다(아르카가 / 카인이, 리아는 / 드라칸은).
const hasFinal = (word) => { const code = String(word || '').trim().slice(-1).charCodeAt(0) - 0xac00; return code >= 0 && code <= 11171 && code % 28 !== 0; };
export const josa = (word, withFinal, withoutFinal) => String(word) + (hasFinal(word) ? withFinal : withoutFinal);

/** 선택 영웅이 이 무기를 들 때의 실제 형태. 무기가 아니면 부위 이름을 돌려준다. */
export function previewForm(item, heroId) {
  if (item?.slot !== 'weapon') return item?.slot || 'weapon';
  const node = LOOKS[heroId]?.weapon?.[item.rarity]?.[0];
  return ITEM_WEAPON_FORMS[node] || 'sword';
}

/** 미리보기 아래 한 줄 안내. 실제로 지원하는 외형 범위만 말한다. */
export function previewCaption(item, heroId, heroName = '') {
  const source = itemRenderSource(item);
  if (source === 'armory-glb') return item.slot === 'weapon' && !['knight', 'barbarian'].includes(heroId)
    ? `병기고 원본 모델 · ${josa(heroName || '이 영웅', '은', '는')} 기본 무기를 들고 이 장식을 함께 착용합니다`
    : '병기고 원본 모델 · 착용하면 같은 모델이 영웅에 붙습니다';
  if (item.slot === 'weapon') {
    const form = previewForm(item, heroId);
    return `${heroName ? josa(heroName, '이', '가') + ' 들면 ' : ''}${FORM_LABEL[form] || '무기'} 형태 · 목록 그림은 한손검 기준 같은 장비입니다`;
  }
  if (item.slot === 'armor') return '방어구 원본 형상(기사 리그 기준) · 영웅 모델에 따라 색·재질 또는 등급 단계 외형으로 보입니다';
  return '목록 그림과 같은 원본 형상입니다';
}

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
let armorRigPromise = null;
async function armorModel(item) {
  armorRigPromise ||= Promise.all([loader.loadAsync('/models/Knight.glb'), loader.loadAsync('/models/tll/knight-casual-v2.glb')])
    .then(([base, casual]) => assembleHeroIdentity(base, casual, 'Knight', 'casual-v2').scene)
    .catch((error) => { armorRigPromise = null; throw error; });
  const rig = await armorRigPromise;
  applyArmorAppearance(rig, { id: 'knight' }, item);
  rig.updateMatrixWorld(true);
  const group = new THREE.Group(), materials = new Set(), point = new THREE.Vector3();
  rig.traverse((node) => {
    if (!node.isMesh || !node.userData.equippedArmor) return;
    const material = node.material.clone(); materials.add(material);
    const geometry = node.geometry.clone(), position = geometry.attributes.position;
    if (node.isSkinnedMesh) for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i); node.applyBoneTransform(i, point); position.setXYZ(i, point.x, point.y, point.z); }
    geometry.applyMatrix4(node.matrixWorld); geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, material));
  });
  removeArmorAppearance(rig);
  group.userData.dispose = () => { group.removeFromParent(); group.traverse((node) => node.geometry?.dispose()); for (const material of materials) material.dispose(); };
  return group;
}
async function armoryModel(item) {
  const gltf = await loader.loadAsync(`/models/armory-v1/${item.modelNode}.glb`);
  const group = gltf.scene;
  group.userData.dispose = () => { group.removeFromParent(); group.traverse((node) => { node.geometry?.dispose(); for (const material of [node.material].flat()) material?.dispose?.(); }); };
  return group;
}
async function buildModel(item, heroId) {
  const source = itemRenderSource(item);
  if (source === 'armory-glb') return armoryModel(item);
  if (source === 'armor-rig') return armorModel(item);
  return buildGearModel(item, item.slot === 'weapon' ? previewForm(item, heroId) : item.slot);
}

/**
 * host 안에 캔버스를 만들고 회전 가능한 미리보기를 띄운다. 반환한 dispose 를 반드시 부른다.
 * @param {HTMLElement} host
 * @param {any} item
 * @param {{ heroId: string, reducedMotion?: boolean }} options
 */
export async function mountItemPreview(host, item, { heroId, reducedMotion = false }) {
  let disposed = false, frame = 0, model = null, last = 0, yaw = -0.5, dragging = null;
  const width = Math.max(160, Math.round(host.clientWidth || 280)), height = Math.max(160, Math.round(host.clientHeight || 220));
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1)); renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0, 0);
  const canvas = renderer.domElement; canvas.className = 'is-preview-canvas'; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${item.name} 3D 미리보기. 끌어서 돌려 볼 수 있습니다.`);
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
    if (!dragging && !reducedMotion) yaw += dt * .6;
    render(); if (!reducedMotion || dragging) frame = requestAnimationFrame(tick);
  };
  const onDown = (event) => { dragging = { id: event.pointerId, x: event.clientX, yaw }; canvas.setPointerCapture?.(event.pointerId); if (!frame) frame = requestAnimationFrame(tick); };
  const onMove = (event) => { if (!dragging || dragging.id !== event.pointerId) return; yaw = dragging.yaw + (event.clientX - dragging.x) * .012; if (reducedMotion) render(); };
  const onUp = (event) => { if (dragging?.id === event.pointerId) dragging = null; };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('lostpointercapture', onUp);
  canvas.style.touchAction = 'none';
  const lost = (event) => { event.preventDefault(); dispose(); host.textContent = '3D 미리보기를 표시할 수 없습니다. 목록 그림은 같은 장비입니다.'; };
  canvas.addEventListener('webglcontextlost', lost);
  function dispose() {
    if (disposed) return; disposed = true;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    canvas.removeEventListener('webglcontextlost', lost);
    model?.userData.dispose?.(); model = null;
    env.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
  }
  try {
    model = await buildModel(item, heroId);
    if (disposed) { model.userData.dispose?.(); return { dispose }; }
    if (item.slot === 'weapon') model.rotation.z = -Math.PI / 4;
    const stage = new THREE.Group(); stage.add(model); pivot.add(stage);
    const box = new THREE.Box3().setFromObject(stage), center = box.getCenter(new THREE.Vector3()), sphere = box.getBoundingSphere(new THREE.Sphere());
    stage.position.sub(center);
    const radius = Math.max(.01, sphere.radius) * 1.05, aspect = width / height;
    camera.left = -radius * aspect; camera.right = radius * aspect; camera.top = radius; camera.bottom = -radius;
    const tilt = item.slot === 'ring' ? .45 : item.slot === 'weapon' ? .08 : .35;
    camera.position.set(0, Math.sin(tilt) * 5, Math.cos(tilt) * 5); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    render(); if (!reducedMotion) frame = requestAnimationFrame(tick);
  } catch (error) {
    dispose(); host.textContent = '3D 미리보기를 불러오지 못했습니다. 목록 그림은 같은 장비입니다.';
    console.warn('item preview', error);
  }
  return { dispose };
}
