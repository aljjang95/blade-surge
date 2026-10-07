import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('ko-KR').format(value || 0);
const bytesLabel = value => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${Math.round(value / 1024)} KB`;
const stateLabels = { in_progress: '작업 중', queued: '대기', needs_review: '검토 필요', blocked: '차단', verified: '기록된 검증 있음' };
let assets = [], selected = null, currentModel = null, mixer = null, animations = [], loadGeneration = 0;
let renderer, scene, camera, controls, previewReady = false, needsRender = true, activePanel = 'library';
let lastFrame = performance.now(), lastState = '';
let lastAudio = '';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function json(route) {
  const response = await fetch(route, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}

function disposeModel(model) {
  if (!model) return;
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  model.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.isSkinnedMesh && object.skeleton) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture && value !== scene?.environment) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => value.dispose());
  skeletons.forEach(value => value.dispose());
}

function setupPreview() {
  try {
    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    $('viewport').append(renderer.domElement);
    camera = new THREE.PerspectiveCamera(38, 1, .01, 3000);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.addEventListener('change', () => { needsRender = true; });
    scene.add(new THREE.HemisphereLight(0xd6e9ff, 0x303835, 2.0));
    const light = new THREE.DirectionalLight(0xffdfb4, 2.5);
    light.position.set(4, 6, 5); scene.add(light);
    const rim = new THREE.DirectionalLight(0x93d3d3, 1.4);
    rim.position.set(-4, 2, -3); scene.add(rim);
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(room, .04);
    scene.environment = environment.texture;
    room.dispose(); pmrem.dispose();
    const grid = new THREE.GridHelper(20, 20, 0x425f65, 0x25363f);
    grid.material.transparent = true; grid.material.opacity = .36; scene.add(grid);
    new ResizeObserver(() => {
      const { width, height } = $('viewport').getBoundingClientRect();
      if (width && height) { renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); needsRender = true; }
    }).observe($('viewport'));
    previewReady = true;
    requestAnimationFrame(frame);
  } catch (error) { $('preview-message').textContent = `WebGL 미리보기를 시작할 수 없습니다: ${error.message}`; }
}

function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, .05); lastFrame = now;
  if (!document.hidden && activePanel === 'library' && (needsRender || mixer)) {
    mixer?.update(delta); controls.update(); renderer.render(scene, camera); needsRender = false;
  }
  requestAnimationFrame(frame);
}

function showMessage(text) {
  $('preview-message').textContent = text;
  $('preview-message').classList.toggle('hidden', !text);
}

function view(angle) {
  if (!currentModel) return;
  currentModel.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(currentModel, true);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const distance = Math.max(size.y, size.x / Math.max(camera.aspect, .4), size.z, .3) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.55;
  controls.target.copy(center);
  camera.position.set(center.x + Math.sin(angle) * distance, center.y + distance * .12, center.z + Math.cos(angle) * distance);
  camera.near = Math.max(distance / 1000, .001); camera.far = Math.max(distance * 20, 100);
  controls.maxDistance = distance * 8; controls.minDistance = distance * .15;
  camera.updateProjectionMatrix(); controls.update(); needsRender = true;
}

async function selectAsset(asset) {
  selected = asset;
  renderAssets(); renderDetails(asset);
  $('asset-title').textContent = asset.label || asset.name;
  $('asset-group').textContent = asset.group;
  $('asset-kind').textContent = asset.bones ? '리그 모델' : '환경 / 소품';
  $('animation').replaceChildren(node('option', '대기 포즈'));
  if (!previewReady) return;
  const generation = ++loadGeneration;
  showMessage('실제 GLB를 불러오는 중…');
  $('capture').disabled = true;
  mixer?.stopAllAction(); mixer = null; animations = [];
  if (currentModel) { scene.remove(currentModel); disposeModel(currentModel); currentModel = null; needsRender = true; }
  if (asset.structuralError || asset.missingDependencies?.length) { showMessage(asset.structuralError || `참조 파일 누락: ${asset.missingDependencies.join(', ')}`); return; }
  try {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(asset.path);
    if (generation !== loadGeneration) { disposeModel(gltf.scene); return; }
    currentModel = gltf.scene; scene.add(currentModel); animations = gltf.animations;
    for (let index = 0; index < animations.length; index++) {
      const option = node('option', animations[index].name || `동작 ${index + 1}`); option.value = String(index); $('animation').append(option);
    }
    $('animation').options[0].value = '';
    view(-Math.PI / 6); showMessage(''); $('capture').disabled = false;
  } catch (error) { if (generation === loadGeneration) showMessage(`모델 로드 실패: ${error.message}`); }
}

function renderAssets() {
  const search = $('search').value.toLowerCase(), group = $('group').value;
  const filtered = assets.filter(asset => (!group || asset.group === group) && `${asset.label || ''} ${asset.name} ${asset.group}`.toLowerCase().includes(search));
  $('asset-list').replaceChildren();
  for (const asset of filtered) {
    const button = node('button', null, `asset-card${selected?.id === asset.id ? ' active' : ''}`);
    button.setAttribute('role', 'listitem'); button.setAttribute('aria-pressed', String(selected?.id === asset.id));
    const title = node('strong', asset.label || asset.name);
    const info = node('small'), dot = node('span', null, `dot${asset.structuralError || asset.manifestHash === 'mismatch' || asset.missingDependencies?.length ? ' warn' : ''}`);
    info.append(dot, document.createTextNode(`${bytesLabel(asset.bytes)} · ${asset.bones ? `${asset.bones}뼈` : '정적'} · ${asset.clips?.length || 0}동작`));
    button.append(title, info); button.addEventListener('click', () => selectAsset(asset)); $('asset-list').append(button);
  }
  if (!filtered.length) $('asset-list').append(node('p', '검색 조건에 맞는 에셋이 없습니다.', 'empty'));
  $('asset-count').textContent = `${filtered.length} / ${assets.length}`;
}

function renderDetails(asset) {
  $('asset-metrics').replaceChildren();
  for (const [label, value] of [['삼각형(저장 메시)', number(asset.triangles)], ['메시 정의', number(asset.meshes)], ['재질 정의', number(asset.materials)], ['뼈', number(asset.bones)], ['파일 크기', bytesLabel(asset.bytes)]]) {
    const item = node('div', null, 'metric'); item.append(node('small', label), node('strong', value)); $('asset-metrics').append(item);
  }
  const hashStatus = asset.manifestHash === 'match' ? 'manifest의 SHA-256과 일치' : asset.manifestHash === 'mismatch' ? 'manifest SHA-256 불일치 · 확인 필요' : '비교할 manifest 해시 없음';
  const fields = [['실제 파일', `public${asset.path}`], ['구조 관측', asset.structuralError || 'GLB 2 헤더·청크·glTF JSON 읽음'], ['해시 대조', hashStatus], ['SHA-256', asset.sha256 || '읽기 실패'], ['출처 계약', asset.rights], ['제작 원본', asset.generator || '원본 자산 계약 참고'], ['manifest', asset.manifest || '없음'], ['좌표 계약', asset.coordinateContract ? JSON.stringify(asset.coordinateContract) : 'manifest 좌표 기록 없음'], ['확장', asset.extensions?.join(', ') || '필수 확장 없음'], ['참조 파일', asset.missingDependencies?.length ? `누락/외부 경로: ${asset.missingDependencies.join(', ')}` : `${asset.dependencies?.length || 0}개 · 로컬 범위`]];
  $('asset-details').replaceChildren();
  for (const [label, value] of fields) $('asset-details').append(node('dt', label), node('dd', value));
}

function renderAudio(catalog) {
  const labels = { blade: '검 · 참격', heavy: '중타 · 마무리', dual: '쌍검', bow: '활', arcane: '비전', holy: '성광', earth: '대지', shadow: '그림자', fire: '화염', frost: '서리', storm: '폭풍', ultimate: '궁극기' };
  $('sound-list').replaceChildren();
  for (const sound of catalog.assets) {
    const button = node('button', labels[sound.id] || sound.id, 'sound-button'); button.disabled = Boolean(sound.error);
    button.addEventListener('click', async () => {
      document.querySelectorAll('.sound-button').forEach(value => value.classList.toggle('active', value === button));
      const player = $('sound-player'); player.pause(); player.src = sound.path;
      $('sound-title').textContent = `${labels[sound.id] || sound.id} · ${sound.declaredDuration ?? '?'}초(제작 기록)`;
      $('sound-details').textContent = `${sound.path} · ${bytesLabel(sound.bytes)} · ${sound.license} · 해시 ${sound.manifestHash === 'match' ? '일치' : sound.manifestHash === 'mismatch' ? '불일치' : '미기록'} · peak ${sound.declaredPeak ?? '?'} / RMS ${sound.declaredRms ?? '?'} · ${sound.source || '출처 미기록'}`;
      try { await player.play(); } catch (error) { $('sound-details').textContent += ` · 재생 실패: ${error.message}`; }
    });
    $('sound-list').append(button);
  }
  if (!catalog.assets.length) $('sound-list').append(node('p', '제작 사운드 manifest가 없습니다.', 'small-note'));
}

function renderBoard(board) {
  $('departments').replaceChildren();
  for (let index = 0; index < board.departments.length; index++) {
    const department = board.departments[index], card = node('article', null, 'department'), top = node('div', null, 'dept-top');
    top.append(node('span', String(index + 1).padStart(2, '0'), 'dept-number'), node('span', stateLabels[department.status] || department.status, `task-status ${department.status}`));
    const tasks = node('ul'); department.tasks.forEach(task => tasks.append(node('li', task)));
    card.append(top, node('h3', department.name), node('p', `소유: ${department.owner}`, 'owner'), tasks, node('p', `다음 확인 · ${department.nextCheck}`, 'next'));
    if (department.blockers?.length) card.append(node('p', `차단/미확인 · ${department.blockers.join(' / ')}`, 'blocker'));
    card.append(node('code', department.owns.join(' · ')));
    if (department.evidence?.length) card.append(node('p', `근거 · ${department.evidence.join(' · ')}`, 'small-note'));
    $('departments').append(card);
  }
  $('milestones').replaceChildren();
  for (const milestone of board.priorities) {
    const card = node('article', null, 'milestone'); card.append(node('strong', milestone.title), node('p', milestone.outcome), node('small', `수락 조건 · ${milestone.acceptance}`)); $('milestones').append(card);
  }
  $('board-update').textContent = `팀 기록 갱신: ${board.updatedAt} · ${board.note}`;
}

function renderStory(storyboard) {
  $('story-intent').textContent = storyboard.intent; $('story-shots').replaceChildren();
  for (const shot of storyboard.shots) {
    const card = node('article', null, 'shot'), art = node('div', null, 'shot-art'), body = node('div', null, 'shot-body');
    art.append(node('span', shot.number), node('small', `${shot.time} · ${shot.status}`));
    body.append(node('h3', shot.title), node('p', shot.composition), node('p', `플레이 · ${shot.action}`, 'action'), node('p', `확인 · ${shot.acceptance}`, 'acceptance'), node('code', shot.assetRefs.join(' · ')));
    card.append(art, body); $('story-shots').append(card);
  }
}

async function refresh() {
  $('refresh').disabled = true;
  try {
    const [catalog, board, storyboard, status, audio] = await Promise.all(['/api/catalog', '/api/board', '/api/storyboard', '/api/status', '/api/audio'].map(json));
    const audioSignature = JSON.stringify(audio.assets);
    if (lastAudio !== audioSignature) { renderAudio(audio); lastAudio = audioSignature; }
    const nextState = JSON.stringify([catalog.observedAt, board, storyboard]);
    if (nextState !== lastState) {
      assets = catalog.assets;
      const groupValue = $('group').value;
      $('group').replaceChildren(node('option', '전체 폴더')); $('group').options[0].value = '';
      for (const group of [...new Set(assets.map(asset => asset.group))].sort()) { const option = node('option', group); option.value = group; $('group').append(option); }
      $('group').value = groupValue; renderAssets(); renderBoard(board); renderStory(storyboard); lastState = nextState;
      if (!selected && assets.length) selectAsset(assets.find(asset => asset.group === 'environment/studio-kit' && asset.name === 'evergreen-tree') || assets.find(asset => asset.name === 'gate-glass_garden') || assets[0]);
      else if (selected) {
        const current = assets.find(asset => asset.id === selected.id);
        if (!current) { selected = null; if (assets.length) selectAsset(assets[0]); }
        else if (current.sha256 !== selected.sha256) selectAsset(current);
        else { selected = current; renderDetails(current); }
      }
    }
    $('connection').textContent = `로컬 파일 ${catalog.count}개 · ${new Date(catalog.observedAt).toLocaleTimeString('ko-KR')} 관측`;
    $('repository').textContent = `${status.branch || 'branch 미확인'} / ${status.sha?.slice(0, 12) || 'HEAD 미확인'} · tracked 변경 ${status.trackedChanges.length}개`;
  } catch (error) { $('connection').textContent = `갱신 실패 · ${error.message}`; }
  finally { $('refresh').disabled = false; }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  activePanel = button.dataset.panel;
  if (activePanel !== 'library') $('sound-player').pause();
  document.querySelectorAll('.tab').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-selected', String(tab === button)); });
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === activePanel)); needsRender = true;
}));
$('search').addEventListener('input', renderAssets); $('group').addEventListener('change', renderAssets);
$('front').addEventListener('click', () => view(0)); $('quarter').addEventListener('click', () => view(-Math.PI / 6));
$('rotate').addEventListener('click', () => { if (currentModel) { currentModel.rotation.y += Math.PI; needsRender = true; } });
$('animation').addEventListener('change', () => {
  mixer?.stopAllAction(); mixer = null;
  if (!currentModel) return;
  if ($('animation').value !== '') { mixer = new THREE.AnimationMixer(currentModel); mixer.clipAction(animations[Number($('animation').value)]).reset().play(); mixer.update(0); }
  else currentModel.traverse(object => { if (object.isSkinnedMesh) object.skeleton.pose(); });
  needsRender = true;
});
$('capture').addEventListener('click', () => {
  if (!renderer || !currentModel) return;
  renderer.render(scene, camera);
  const link = node('a'); link.download = `${selected.name}-studio-preview.png`; link.href = renderer.domElement.toDataURL('image/png'); link.click();
});
$('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { needsRender = true; refresh(); } else $('sound-player').pause(); });
setupPreview(); refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
