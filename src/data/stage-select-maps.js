// 스테이지 선택 화면의 지역별 지도 배경과 관문 노드 좌표.
// 배경은 1200×900(4:3) 그림이며 화면에는 cover 로 깔린다. 좌표는 그림 기준 정규화 값(0~1)이고
// CSS 가 같은 cover 규칙(컨테이너 쿼리 단위)으로 화면 위치를 계산하므로 그림 속 길과 노드가 어긋나지 않는다.
// 가장 납작한 가로 화면(약 2.8:1)에서도 보이도록 y 는 0.28~0.72, 세로 시트(약 1.1:1)에서도 보이도록 x 는 0.1~0.9 안에 둔다.
export const STAGE_MAP_WIDTH = 1200;
export const STAGE_MAP_HEIGHT = 900;

// 그림이 없을 때의 기본 뱀길(위 줄 왼→오, 아래 줄 오→왼). 길은 화면이 점선으로 그린다.
export const DEFAULT_STAGE_NODES = Object.freeze([
  [0.14, 0.38], [0.32, 0.34], [0.5, 0.38], [0.68, 0.34], [0.86, 0.4],
  [0.84, 0.64], [0.66, 0.68], [0.5, 0.63], [0.33, 0.68], [0.15, 0.62],
].map((point) => Object.freeze(point)));

const nodes = (points) => Object.freeze(points.map((point) => Object.freeze(point)));
// 좌표는 각 그림의 밝은 돌길 위에 맞췄다(지역 2·3·5 는 S자 길을 그대로 따라간다).
// 길이 띠 밖으로 크게 휘는 지역(1 위·가운데 줄을 잇는 오른쪽, 4 대각선, 6 S자 아래쪽)은 보이는 띠 안의 길·빈터에 두고, 점선 길이 순서를 잇는다.
/** @type {Record<number, { art: string | null, nodes: ReadonlyArray<ReadonlyArray<number>> }>} */
export const STAGE_MAPS = Object.freeze({
  1: Object.freeze({ art: '/img/stage-select/map-r1.webp', nodes: nodes([[0.3, 0.3], [0.44, 0.25], [0.58, 0.24], [0.72, 0.27], [0.77, 0.49], [0.63, 0.47], [0.5, 0.45], [0.36, 0.45], [0.22, 0.47], [0.25, 0.63]]) }),
  2: Object.freeze({ art: '/img/stage-select/map-r2.webp', nodes: nodes([[0.64, 0.31], [0.5, 0.33], [0.36, 0.33], [0.24, 0.36], [0.17, 0.5], [0.31, 0.51], [0.45, 0.5], [0.59, 0.52], [0.71, 0.59], [0.6, 0.69]]) }),
  3: Object.freeze({ art: '/img/stage-select/map-r3.webp', nodes: nodes([[0.28, 0.27], [0.43, 0.27], [0.57, 0.32], [0.47, 0.42], [0.32, 0.48], [0.38, 0.62], [0.5, 0.63], [0.63, 0.64], [0.75, 0.66], [0.86, 0.7]]) }),
  4: Object.freeze({ art: '/img/stage-select/map-r4.webp', nodes: nodes([[0.16, 0.36], [0.3, 0.3], [0.44, 0.28], [0.48, 0.43], [0.6, 0.46], [0.73, 0.55], [0.6, 0.62], [0.46, 0.66], [0.32, 0.6], [0.18, 0.62]]) }),
  5: Object.freeze({ art: '/img/stage-select/map-r5.webp', nodes: nodes([[0.3, 0.26], [0.46, 0.25], [0.62, 0.27], [0.74, 0.35], [0.6, 0.42], [0.44, 0.42], [0.29, 0.46], [0.36, 0.58], [0.54, 0.61], [0.72, 0.64]]) }),
  6: Object.freeze({ art: '/img/stage-select/map-r6.webp', nodes: nodes([[0.62, 0.3], [0.47, 0.36], [0.3, 0.41], [0.42, 0.51], [0.58, 0.53], [0.72, 0.55], [0.85, 0.64], [0.7, 0.7], [0.57, 0.7], [0.42, 0.7]]) }),
});

export function stageMapFor(chapter) {
  return STAGE_MAPS[chapter] || { art: null, nodes: DEFAULT_STAGE_NODES };
}

/**
 * 지도 그림과 노드의 화면 배치(px). 그림은 컨테이너를 덮는 크기(cover)이고, 노드 묶음의 중심이 지도 가운데 오도록 그림도 같이 옮긴다.
 * 컨테이너가 납작해(휴대폰 가로) 노드 묶음이 여백 안에 다 들어가지 않으면 그 축만 간격을 줄인다(그때는 그림 길과 조금 어긋난다).
 * @param {ReadonlyArray<ReadonlyArray<number>>} nodes  @param {number} width  @param {number} height
 * @param {{ top?: number, bottom?: number, side?: number }} [margins] 노드 중심에서 위(왕관·점)·아래(꼬리표)·옆 여백
 */
export function layoutStageMap(nodes, width, height, { top = 38, bottom = 44, side = 34 } = {}) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const scale = Math.max(w / STAGE_MAP_WIDTH, h / STAGE_MAP_HEIGHT);
  const imgW = STAGE_MAP_WIDTH * scale, imgH = STAGE_MAP_HEIGHT * scale;
  const xs = nodes.map(([x]) => x), ys = nodes.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const sx = Math.min(imgW, Math.max(0, w - side * 2) / Math.max(maxX - minX, 0.01));
  const sy = Math.min(imgH, Math.max(0, h - top - bottom) / Math.max(maxY - minY, 0.01));
  const centerX = w / 2, centerY = top + Math.max(0, h - top - bottom) / 2;
  // 그림 위치: 노드 묶음 중심이 화면 중심에 오게. 그림이 컨테이너를 덮도록 범위를 제한한다.
  const offsetX = Math.min(0, Math.max(w - imgW, centerX - cx * imgW));
  const offsetY = Math.min(0, Math.max(h - imgH, centerY - cy * imgH));
  let points = nodes.map(([x, y]) => [offsetX + cx * imgW + (x - cx) * sx, offsetY + cy * imgH + (y - cy) * sy]);
  // 그림 범위 제한으로 밀린 만큼 노드가 여백을 넘으면 노드만 안으로 되돌린다.
  const px = points.map(([x]) => x), py = points.map(([, y]) => y);
  const shiftX = Math.max(0, side - Math.min(...px)) - Math.max(0, Math.max(...px) - (w - side));
  const shiftY = Math.max(0, top - Math.min(...py)) - Math.max(0, Math.max(...py) - (h - bottom));
  if (shiftX || shiftY) points = points.map(([x, y]) => [x + shiftX, y + shiftY]);
  return { points, size: [imgW, imgH], offset: [offsetX, offsetY], compressed: sx < imgW - 0.5 || sy < imgH - 0.5 };
}
