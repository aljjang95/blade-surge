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

/** @type {Record<number, { art: string | null, nodes: ReadonlyArray<ReadonlyArray<number>> }>} */
export const STAGE_MAPS = Object.freeze({
  1: Object.freeze({ art: null, nodes: DEFAULT_STAGE_NODES }),
  2: Object.freeze({ art: null, nodes: DEFAULT_STAGE_NODES }),
  3: Object.freeze({ art: null, nodes: DEFAULT_STAGE_NODES }),
  4: Object.freeze({ art: null, nodes: DEFAULT_STAGE_NODES }),
  5: Object.freeze({ art: null, nodes: DEFAULT_STAGE_NODES }),
  6: Object.freeze({ art: null, nodes: DEFAULT_STAGE_NODES }),
});

export function stageMapFor(chapter) {
  return STAGE_MAPS[chapter] || { art: null, nodes: DEFAULT_STAGE_NODES };
}
