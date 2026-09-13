// Authored room graphs: the renderer, collision mask, gates and AUTO share these exact rectangles.
const make = (id, name, route, landmark, spacing, size, cells, edges, labels) => ({
  id, name, route, landmark,
  layout: {
    id, landmark, spacing, size, width: 8, cells, edges,
    types: cells.map((_, i) => i === 0 ? 'start' : i === cells.length - 1 ? 'boss' : i === 3 ? 'treasure' : i === 2 || i === cells.length - 3 ? 'elite' : 'normal'),
    labels: cells.map((_, i) => i === 0 ? labels[0] : i === cells.length - 1 ? labels[2] : i === 3 ? labels[1] : `${name} · ${i}구역`),
    // Room proportions are deliberate, with a broad boss court and smaller reward alcove.
    sizes: cells.map((_, i) => i === cells.length - 1 ? [28,28] : i === 3 ? [16,16] : i % 3 === 1 ? [size[0]+4,size[1]-4] : size),
  },
});
export const STORY_DUNGEONS = {
  procession: make('procession', '이름의 장례길', '긴 행렬길과 두 옆 예배실을 정화한 뒤 종의 제단으로 향한다.', 'memorial', [36,36], [20,24],
    [[0,0],[0,1],[1,1],[2,1],[1,2],[0,2],[0,3],[1,3],[2,3],[0,4],[1,4],[2,4]],
    [[0,1],[1,2],[2,3],[2,4],[4,5],[5,6],[6,7],[7,8],[6,9],[9,10],[10,11]], ['장례 입구','이름표 보관실','기억의 종 제단']),
  kiln: make('kiln', '쌍화구 냉각로', '상부 연료선과 하부 냉각선을 오가며 화구 봉인을 해제한다.', 'kiln', [38,34], [24,20],
    [[0,0],[1,0],[2,0],[3,0],[4,0],[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[5,2]],
    [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[8,9],[1,6],[3,8],[4,9],[9,10],[10,11]], ['석탄 승강장','냉각수 저장실','꺼지지 않는 화구']),
  archive: make('archive', '접힌 기록 서고', '긴 주서가에서 갈라지는 기록실을 확인하고 맨 끝 금서고를 연다.', 'archive', [36,38], [20,28],
    [[1,0],[1,1],[1,2],[0,1],[2,2],[1,3],[0,3],[1,4],[2,4],[1,5],[1,6]],
    [[0,1],[1,2],[1,3],[2,4],[2,5],[5,6],[5,7],[7,8],[7,9],[9,10]], ['반납 회랑','미발송 일기실','금지된 내일의 서고']),
  beacon: make('beacon', '침몰 선단 환초', '외곽 고리 양쪽의 선박을 구한 뒤 남쪽 등대 둑길로 모인다.', 'beacon', [36,36], [24,24],
    [[0,0],[1,0],[2,0],[3,0],[3,1],[3,2],[3,3],[2,3],[1,3],[0,3],[0,2],[0,1],[1,4],[1,5]],
    [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,0],[8,12],[12,13]], ['좌초한 선수','선원 유품실','귀항의 등대']),
  tribunal: make('tribunal', '네 맹세의 심판정', '중앙 광장에서 네 방향 증언실을 정화하고 왕좌의 계단을 오른다.', 'tribunal', [38,38], [24,24],
    [[2,0],[2,1],[2,2],[1,1],[3,1],[1,2],[0,2],[3,2],[4,2],[2,3],[1,3],[3,3],[2,4],[2,5]],
    [[0,1],[1,2],[1,3],[1,4],[2,5],[5,6],[2,7],[7,8],[2,9],[9,10],[9,11],[9,12],[12,13]], ['증인의 문','돌려받은 서약실','빈 왕좌의 법정']),
  confluence: make('confluence', '새벽의 합류 수로', '세 갈래 수로를 잇는 교차로에서 잔향을 지우고 공동 귀환문을 연다.', 'confluence', [38,36], [24,20],
    [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2],[1,3],[1,4]],
    [[0,1],[1,2],[0,3],[1,4],[2,5],[3,4],[4,5],[3,6],[4,7],[5,8],[6,7],[7,8],[7,9],[9,10]], ['재회 나루','공동 물자실','다 함께 여는 귀환문']),
};
const CHAPTER_ROUTES = [
  ['procession','procession','tribunal','confluence','tribunal','confluence','procession','archive','tribunal','procession'],
  ['kiln','kiln','tribunal','confluence','kiln','archive','kiln','confluence','tribunal','kiln'],
  ['archive','archive','tribunal','confluence','archive','procession','archive','beacon','tribunal','archive'],
  ['beacon','confluence','beacon','archive','beacon','confluence','tribunal','beacon','confluence','beacon'],
  ['tribunal','procession','tribunal','archive','tribunal','beacon','confluence','tribunal','confluence','tribunal'],
  ['procession','kiln','archive','beacon','tribunal','confluence','kiln','archive','beacon','confluence'],
];
export function dungeonForStage(ch, st) {
  return STORY_DUNGEONS[CHAPTER_ROUTES[ch - 1]?.[st - 1]];
}
