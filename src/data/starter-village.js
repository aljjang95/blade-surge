// 첫 마을(1지역 종지기 정원 마을)의 초보자 구역 배치. 대표님 요청(2026-10-24): "초보자 마을에 들어왔구나, 초보자는 어떻게 플레이하면
// 좋을까" 하는 영역이 오손도손 모여 있게. 동선은 입장(남쪽) → 안내자 → 훈련장(서) → 의뢰 게시판 → 대장간·상점(동) → 출격 포탈(북).
// 광장 경계(±12)·출현 위치·던전 관문 판정(region-dungeon-gate.js)은 기존 계약 그대로이며, 자리와 새 상호작용 지점만 이 파일이 정한다.
// 1지역이 아닌 지역 마을(스킨)과 townId 없는 원본 12관문 광장은 citadel-hub.js 의 기존 배치를 그대로 쓴다.
// citadel-hub.js 가 이 파일을 읽으므로 순환 참조를 피해 같은 경로 상수를 둔다.
const CITADEL_HUB_ASSET_ROOT = '/models/citadel-hub-v1/';

export const STARTER_VILLAGE_VERSION = 'starter-village-v1';

/** 늦은 오후 황금빛 햇살(잠근 시안 c1). arena.buildLobby 가 첫 마을이면 성채 광장 대신 이 값을 쓴다. */
export const STARTER_ATMOSPHERE = Object.freeze({ bg: 0x8fc4e6, fog: 0xc9dfe0, density: .011, hemi: Object.freeze([0xfff0d4, 0x56703c]), hemiI: 1.05,
  sun: 0xffd29a, sunI: 3.1, sunPos: Object.freeze([-13, 15, 11]), rim: 0xffc890, rimI: 1.1 });

/** 구역 중심(장면 소품 배치·QA 촬영이 같은 값을 쓴다). */
export const STARTER_ZONES = Object.freeze({
  entry: Object.freeze({ x: 0, z: 7.6 }),
  training: Object.freeze({ x: -7.4, z: 1.2, radius: 3.1 }),
  board: Object.freeze({ x: -4.2, z: -3.2 }),
  fountain: Object.freeze({ x: 0, z: -1.4, radius: 1.55 }),
  statue: Object.freeze({ x: 0, z: -5.6 }),
  forge: Object.freeze({ x: 7.6, z: -1.4 }),
  market: Object.freeze({ x: 7.2, z: 5.2 }),
  portal: Object.freeze({ x: 0, z: -9.4 }),
});

/** 훈련장 허수아비 자리(장면·연습 판정 공용). */
export const STARTER_DUMMIES = Object.freeze([
  Object.freeze({ id: 'dummy:1', x: -8.9, z: 0.1, yaw: .5 }),
  Object.freeze({ id: 'dummy:2', x: -7.2, z: -.9, yaw: 0 }),
  Object.freeze({ id: 'dummy:3', x: -8.6, z: 2.5, yaw: .9 }),
]);

// 지역 1 던전 관문 자리. 앞 네 자리는 북쪽 줄(포탈 양옆), 뒤 두 자리는 소급 보존 던전용 옆 벽이다.
export const STARTER_GATE_SLOTS = Object.freeze([
  [-9.6, -10.7, 0], [-5.2, -10.7, 0], [5.2, -10.7, 0], [9.6, -10.7, 0],
  [-10.7, -5.6, Math.PI / 2], [10.7, -5.6, -Math.PI / 2],
].map(Object.freeze));

/**
 * 초보자 구역 상호작용 지점. kind 는 citadel-hub.js 의 interact 분기가 읽는다.
 * - guide: 첫 목표 안내 / training: 허수아비 연습 / board: 첫 의뢰 / smith: 장비 강화·룬 소켓 / story: 시작 영웅 이야기
 * - campaign(출격 포탈): 관문 선택 화면(#263)
 */
export const STARTER_HOTSPOTS = Object.freeze([
  { id: 'npc:guide', kind: 'guide', route: 'guide', label: '안내자 브람', subtitle: '처음 오셨나요?',
    description: '초보자 마을 둘러보기와 첫 목표를 알려 드려요.', accent: '#ffd27a', x: -2.9, z: 6.2, yaw: 2.4,
    interactionRadius: 2, blockerRadius: .42, model: 'Mage' },
  { id: 'sign:story', kind: 'story', route: 'story', label: '시작 영웅의 비석', subtitle: '영웅 이야기',
    description: '이 마을에서 처음 검을 든 영웅의 이야기.', accent: '#e8d3a2', x: 0, z: -5.6, yaw: 0,
    interactionRadius: 2, blockerRadius: .95 },
  { id: 'yard:training', kind: 'training', route: 'training', label: '훈련장', subtitle: '허수아비 연습',
    description: '허수아비를 상대로 공격·회피·스킬을 연습하세요.', accent: '#9fdac2', x: -4.7, z: 1.6, yaw: -Math.PI / 2,
    interactionRadius: 2, blockerRadius: 0 },
  { id: 'board:quests', kind: 'board', route: 'quests', label: '첫 의뢰 게시판', subtitle: '오늘의 의뢰',
    description: '마을 사람들이 남긴 첫 의뢰를 확인하세요.', accent: '#f0c46a', x: -4.2, z: -3.2, yaw: .35,
    interactionRadius: 1.9, blockerRadius: .7 },
  { id: 'npc:smith', kind: 'smith', route: 'smith', label: '대장장이 도르', subtitle: '장비 강화 · 룬 소켓',
    description: '장비를 강화하고 룬을 박아 보세요.', accent: '#ff9f5a', x: 5.6, z: -.6, yaw: -1.9,
    interactionRadius: 2, blockerRadius: .42, model: 'Barbarian' },
  { id: 'gate:campaign', kind: 'campaign', route: 'campaign', label: '출격 포탈', subtitle: '관문 선택',
    description: '캠페인 관문과 지역 던전 중 출격할 곳을 고르세요.', accent: '#8fe3ff', x: 0, z: -9.4, yaw: 0,
    interactionRadius: 2.2, blockerRadius: 0, emblem: 'oath' },
].map(Object.freeze));

// 기존 서비스 마을 NPC(상인·교관·결투 안내관)와 이동석의 초보자 마을 자리.
export const STARTER_SERVICE_PLACES = Object.freeze({
  'npc:potion-merchant': Object.freeze({ x: 6.4, z: 4.4, yaw: -2.2 }),
  'npc:trainer': Object.freeze({ x: 9.3, z: 3.2, yaw: -1.6 }),
  'npc:arena-steward': Object.freeze({ x: 9.4, z: 8.6, yaw: -2.5 }),
  'waystone:main': Object.freeze({ x: -9.2, z: 8.4, yaw: 0 }),
});

/** 초보자 마을 소품(충돌 판정과 장면이 같이 읽는다). 걷는 길(중앙 남북 통로·동서 가지)은 비운다. */
export const STARTER_PROPS = Object.freeze([
  // 좌판 x 8.05: Tripo 좌판(깊이 2.09)의 앞면(x≈7.0)이 상인(6.4, 반경 .42) 뒤에 오도록 기존 7.6 에서 .45 물렸다.
  { id: 'stall:market', kind: 'stall', x: 8.05, z: 5.9, yaw: -Math.PI / 2, asset: `${CITADEL_HUB_ASSET_ROOT}stall.glb` },
  { id: 'anvil:forge', kind: 'anvil', x: 7.1, z: -.4, yaw: -.3 },
  { id: 'forge:hearth', kind: 'hearth', x: 9.3, z: -2.6, yaw: -Math.PI / 2 },
  { id: 'rack:weapons', kind: 'rack', x: 5.2, z: -2.9, yaw: 0 },
  ...[-1, 1].flatMap(xSide => [-1, 1].map(zSide => ({ id: `lamp:${xSide}:${zSide}`, kind: 'lamp',
    x: xSide * 11.4, z: zSide * 11.2, yaw: 0, asset: `${CITADEL_HUB_ASSET_ROOT}lamp.glb` }))),
  { id: 'bench:fountain', kind: 'bench', x: 3.9, z: -4.4, yaw: -.5, asset: `${CITADEL_HUB_ASSET_ROOT}bench.glb` },
  { id: 'planter:entry:w', kind: 'planter', x: -4.6, z: 8.8, yaw: 0, asset: `${CITADEL_HUB_ASSET_ROOT}planter.glb` },
  { id: 'planter:entry:e', kind: 'planter', x: 4.6, z: 8.8, yaw: 0, asset: `${CITADEL_HUB_ASSET_ROOT}planter.glb` },
].map(Object.freeze));

/** 초보자 마을 충돌. 관문 기둥·NPC 원 + 소품 사각형 + 훈련장 울타리(입구 동쪽은 비움). */
export function starterBlockers(hotspots, props = STARTER_PROPS) {
  const blockers = [];
  for (const spot of hotspots) {
    if (spot.blockerRadius) blockers.push({ type: 'circle', x: spot.x, z: spot.z, radius: spot.blockerRadius });
    if (!['dungeon', 'arena'].includes(spot.kind)) continue;
    for (const side of [-1, 1]) blockers.push({ type: 'circle',
      x: spot.x + side * 1.5 * Math.cos(spot.yaw), z: spot.z - side * 1.5 * Math.sin(spot.yaw), radius: .5 });
  }
  const fountain = STARTER_ZONES.fountain;
  blockers.push({ type: 'circle', x: fountain.x, z: fountain.z, radius: fountain.radius + .1 });
  // 포탈 아치 기둥. Tripo 아치의 기둥 안쪽 면이 중심에서 약 1.0m(열린 폭 약 2.0m)라 원 중심 ±1.55 + 반경 .55 로 바깥 면 2.1m 까지 막는다.
  const portal = STARTER_ZONES.portal;
  for (const side of [-1, 1]) blockers.push({ type: 'circle', x: portal.x + side * STARTER_PORTAL_PILLAR_X, z: portal.z, radius: .55 });
  for (const prop of props) {
    if (prop.kind === 'bench' || prop.kind === 'planter') blockers.push({ type: 'rect', minX: prop.x - 1, maxX: prop.x + 1, minZ: prop.z - .4, maxZ: prop.z + .4 });
    // 좌판: yaw -π/2 라 폭 2.6 은 z 방향, 깊이는 x 방향이다. Tripo 좌판 깊이 2.09 에 맞춰 x ±1.05(기존 ±.5).
    else if (prop.kind === 'stall') blockers.push({ type: 'rect', minX: prop.x - STARTER_STALL_HALF_DEPTH, maxX: prop.x + STARTER_STALL_HALF_DEPTH, minZ: prop.z - 1.3, maxZ: prop.z + 1.3 });
    else if (prop.kind === 'hearth') blockers.push({ type: 'rect', minX: prop.x - 1.3, maxX: prop.x + 1.3, minZ: prop.z - 1.2, maxZ: prop.z + 1.2 });
    else if (prop.kind === 'anvil' || prop.kind === 'rack') blockers.push({ type: 'circle', x: prop.x, z: prop.z, radius: .5 });
    else if (prop.kind === 'lamp') blockers.push({ type: 'circle', x: prop.x, z: prop.z, radius: .19 });
  }
  // 대장간: 작업장 뒤(+x)에 선 Tripo 건물 한 채의 바닥 사각형. 작업장 지붕·기둥(FORGE_POSTS)은 GLB 가 없을 때의 폴백 그림일 뿐이라 막지 않는다.
  const forge = STARTER_FORGE_BUILDING;
  blockers.push({ type: 'rect', minX: forge.x - forge.halfX, maxX: forge.x + forge.halfX, minZ: forge.z - forge.halfZ, maxZ: forge.z + forge.halfZ });
  for (const dummy of STARTER_DUMMIES) blockers.push({ type: 'circle', x: dummy.x, z: dummy.z, radius: .38 });
  for (const [x, z, w, d] of STARTER_BEDS) blockers.push({ type: 'circle', x, z, radius: Math.hypot(w, d) / 2 * .85 });
  for (const [, x, z, radius] of STARTER_CLUTTER) blockers.push({ type: 'circle', x, z, radius });
  for (const [x, z] of STARTER_LANTERNS) blockers.push({ type: 'circle', x, z, radius: .14 });
  // 훈련장 울타리: 말뚝 원호를 작은 원 여러 개로 막는다(동쪽 입구는 비움).
  const yard = STARTER_ZONES.training;
  for (let a = STARTER_FENCE_ARC.from; a <= STARTER_FENCE_ARC.to + 1e-6; a += .2) blockers.push({ type: 'circle', x: yard.x + Math.cos(a) * (yard.radius + .1), z: yard.z + Math.sin(a) * (yard.radius + .1), radius: .16 });
  return blockers.map(Object.freeze);
}

/** 꽃밭 [x, z, 폭, 깊이, yaw] — 장면이 그리고 충돌은 회전을 무시한 외접 원으로 막는다. */
export const STARTER_BEDS = Object.freeze([
  [-4.3, 9.9, 2.6, .9, 0], [4.3, 9.9, 2.6, .9, 0], [-4.1, 4.4, 1.8, .8, .3],
  // 분수 둘레에는 꽃밭을 두지 않는다(분수를 돌아 걷는 둥근 길과 동서 가지 길을 막지 않게, 실제 터치 QA 2026-10-24).
  [-4.4, -7.9, 1.6, .8, 0], [4.4, -7.9, 1.6, .8, 0], [-6.2, -5.6, 1.8, .8, .4],
].map(Object.freeze));
/** 길가 등불 기둥 [x, z, 등이 걸린 쪽(+1 동, -1 서)]. 영웅상 옆 길이 좁아지지 않게 길 바깥(|x| ≥ 2.25)에 둔다. */
export const STARTER_LANTERNS = Object.freeze([[-2.25, 10.8, 1], [2.25, 10.8, -1], [-2.25, 6.6, 1], [2.25, 6.6, -1], [-2.3, -7.4, 1], [2.3, -7.4, -1]].map(Object.freeze));
/** 작은 소품 [종류, x, z, 반경] — 통·상자·깃발 기둥. */
export const STARTER_CLUTTER = Object.freeze([
  ['barrel', 9.9, .9, .32], ['barrel', 10.4, .2, .32], ['crate', 10.6, 1.5, .4], ['crate', 9.2, -4.3, .45], ['barrel', 4.9, 7.9, .32], ['crate', 5.6, 8.3, .38],
  ['barrel', -10.4, 3.8, .32], ['crate', -10.6, 4.7, .4], ['crate', -4.6, -1.2, .35],
  ['banner', -3.1, -9.3, .12], ['banner', 3.1, -9.3, .12], ['banner', -4.2, -.2, .12], ['banner', 4.6, 3, .12], ['banner', -2.7, 8.6, .12], ['banner', 2.7, 8.6, .12],
].map(Object.freeze));

/**
 * 대장간 Tripo 건물(닫힌 건물 4.08×4.0m, 높이 4.8m). 작업장(화덕·모루·무기대) 뒤 광장 바깥쪽에 물려 세운다.
 * yaw -π/2 라 앞면(화덕 개구부, 로컬 +z)이 -x(작업장 쪽)를 본다. 건물 앞면은 x≈11.1 로 화덕 충돌(x≤10.6)과 .5m 떨어져 틈이 막힌다.
 * halfX 는 월드 x 방향(GLB 깊이/2 = 2.0), halfZ 는 월드 z 방향(GLB 폭/2 = 2.04)이며 0.0x 여유를 둔다.
 */
export const STARTER_FORGE_BUILDING = Object.freeze({ x: 13.1, z: -2.2, yaw: -Math.PI / 2, halfX: 2.05, halfZ: 2.1 });

/** 오두막(Tripo 3.54×4.2×4.2m)을 균등 1.3배(높이 약 5.5m, 영웅 1.8m 기준 인형집 비율 보정)로 세운 자리 [x, z, yaw]. 앞면(+z)이 광장을 본다. */
export const STARTER_COTTAGE_SCALE = 1.3;
export const STARTER_COTTAGES = Object.freeze([
  [-15.9, -7.2, Math.PI / 2], [-15.9, 1.4, Math.PI / 2], [-15.9, 8.8, Math.PI / 2],
  [15.9, -8.6, -Math.PI / 2], [15.9, 6.6, -Math.PI / 2],
  [-8.6, -15.9, 0], [8.8, -15.9, 0],
].map(Object.freeze));

/** 상점 좌판 깊이의 절반(Tripo 좌판 깊이 2.09 + 여유). 충돌 사각형이 쓴다. */
export const STARTER_STALL_HALF_DEPTH = 1.05;
/** 포탈 아치 기둥 충돌 원의 중심 x(±). */
export const STARTER_PORTAL_PILLAR_X = 1.55;

/** 대장간 작업장 기둥 자리(대장간 중심 기준). 장면과 충돌이 같이 쓴다. */
export const FORGE_POSTS = Object.freeze([[-2.6, -2.2], [2.6, -2.2], [-2.6, 1.6], [2.6, 1.6]].map(Object.freeze));

/** 훈련장 울타리 말뚝 각도(라디안). 동쪽 입구(0 근처)는 비운다. 장면이 같은 값으로 울타리를 세운다. */
export const STARTER_FENCE_ARC = Object.freeze({ from: .62, to: Math.PI * 2 - .62 });
