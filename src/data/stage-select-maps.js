// 스테이지 선택 화면의 지역별 지도 배경과 관문 노드 좌표.
// 지도 상자는 모든 화면 크기에서 가로:세로 2.5:1 고정이고 배경 그림(1600×640)도 같은 비율이라 잘리지 않는다.
// 좌표는 상자 기준 정규화 값(0~1). 배치는 U자 2줄: 윗줄 1→5(왼→오, y≈0.30), 오른쪽에서 꺾어 아랫줄 6→10(오→왼, y≈0.72).
export const STAGE_MAP_WIDTH = 1600;
export const STAGE_MAP_HEIGHT = 640;
export const STAGE_MAP_ASPECT = STAGE_MAP_WIDTH / STAGE_MAP_HEIGHT;

const freezeNodes = (points) => Object.freeze(points.map((point) => Object.freeze(point)));
// 기본 U자(지휘 결정 2026-10-24): x = 12·31·50·69·88 %, 윗줄 y 30 %, 아랫줄 y 72 %.
export const DEFAULT_STAGE_NODES = freezeNodes([
  [0.12, 0.3], [0.31, 0.3], [0.5, 0.3], [0.69, 0.3], [0.88, 0.3],
  [0.88, 0.72], [0.69, 0.72], [0.5, 0.72], [0.31, 0.72], [0.12, 0.72],
]);

// 지역 그림(wide_r1~6)마다 윗길·아랫길 높이가 조금씩 달라 y 만 그림 길 중심에 맞춘다(x 는 기본 U자 그대로).
const uShape = (top, bottom) => freezeNodes(DEFAULT_STAGE_NODES.map(([x], index) => [x, index < 5 ? top : bottom]));
/** @type {Record<number, { art: string | null, nodes: ReadonlyArray<ReadonlyArray<number>> }>} */
export const STAGE_MAPS = Object.freeze({
  1: Object.freeze({ art: '/img/stage-select/map-r1.webp', nodes: uShape(0.24, 0.66) }),
  2: Object.freeze({ art: '/img/stage-select/map-r2.webp', nodes: uShape(0.22, 0.73) }),
  3: Object.freeze({ art: '/img/stage-select/map-r3.webp', nodes: uShape(0.28, 0.72) }),
  4: Object.freeze({ art: '/img/stage-select/map-r4.webp', nodes: uShape(0.23, 0.64) }),
  5: Object.freeze({ art: '/img/stage-select/map-r5.webp', nodes: uShape(0.27, 0.71) }),
  6: Object.freeze({ art: '/img/stage-select/map-r6.webp', nodes: uShape(0.25, 0.71) }),
});

export function stageMapFor(chapter) {
  return STAGE_MAPS[chapter] || { art: null, nodes: DEFAULT_STAGE_NODES };
}

/**
 * 목록 영역(px)에 들어가는 2.5:1 지도 상자 크기. 폭을 다 쓰고, 높이가 모자라면 높이에 맞춰 폭을 줄인다(가운데 정렬).
 * @param {number} width @param {number} height
 */
export function fitStageMapBox(width, height) {
  const w = Math.max(0, width), h = Math.max(0, height);
  const boxW = Math.min(w, h * STAGE_MAP_ASPECT);
  return [boxW, boxW / STAGE_MAP_ASPECT];
}

/**
 * 상자 안 노드 위치(px)와 노드 지름. 노드는 상자 높이에 맞춰 줄이되 탭 영역 40px 아래로는 줄이지 않는다.
 * @param {ReadonlyArray<ReadonlyArray<number>>} nodes @param {number} width @param {number} height
 */
export function layoutStageMap(nodes, width, height) {
  const points = nodes.map(([x, y]) => [x * width, y * height]);
  const node = Math.round(Math.max(40, Math.min(56, height * 0.25)));
  return { points, node, boss: node + 6 };
}
