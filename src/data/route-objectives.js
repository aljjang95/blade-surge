// Authored solo objectives are separate from Conquest/party/rift rules.
// 냉각 장치 문구. 재의 수문(밸브·냉각선)이 기본이고, 재벼림 제련소는 용광로 문구를 쓴다.
const CINDER_COPY = Object.freeze({ title: '냉각선 복구', unit: '밸브', done: '냉각선', doneVerb: '복구', cooled: '개방' });
const ASHFORGE_COPY = Object.freeze({ title: '용광로 냉각', unit: '용광로', done: '용광로', doneVerb: '냉각', cooled: '냉각' });
/** @param {string} id @param {Array<[number, string]>} gates @param {typeof CINDER_COPY} copy */
const coolingDef = (id, gates, copy = CINDER_COPY) => Object.freeze({
  id, kind: 'cooling', holdSeconds: 2, radius: 1.6, copy,
  padOffset: 3.5, heatSeconds: 4, warningSeconds: 1.4, ventSeconds: .8,
  gates: Object.freeze(gates.map(([roomId, label]) => Object.freeze({ roomId, label }))),
});
/** @param {string} depth @param {Array<[number, string]>} gates */
const cooling = (depth, gates) => coolingDef(`cinder_cooling_${depth}`, gates);
const RECORD_PAGES = Object.freeze([
  Object.freeze({ id: 'departure_coordinates', pageId: 1, label: '1쪽 · 출발 좌표' }),
  Object.freeze({ id: 'lost_transit', pageId: 2, label: '2쪽 · 잃어버린 항로' }),
  Object.freeze({ id: 'return_route', pageId: 3, label: '3쪽 · 귀환 좌표' }),
]);
/** @param {string} depth @param {Array<[number, number]>} gates */
const records = (depth, gates) => Object.freeze({
  id: `nightglass_records_${depth}`, kind: 'records', radius: 2, holdSeconds: 2,
  coexistAttunement: depth === 'deep',
  gates: Object.freeze(gates.map(([roomId, pageId]) => Object.freeze({ roomId, ...RECORD_PAGES[pageId - 1] }))),
});
// A station identity and its three choices are independent of their color.
export const ASTRAL_CHOICES = Object.freeze([
  Object.freeze({ id: 'triangle', code: 'A', glyph: '△', name: '삼각', dx: -3.5, dz: 0 }),
  Object.freeze({ id: 'circle', code: 'B', glyph: '○', name: '원', dx: 0, dz: 3.5 }),
  Object.freeze({ id: 'diamond', code: 'C', glyph: '◇', name: '마름모', dx: 3.5, dz: 0 }),
]);
const constellations = Object.freeze({
  id: 'astral_constellations_standard', kind: 'constellations', radius: 1.2,
  readRadius: 8, readSeconds: 1, holdSeconds: 1, combatRadius: 22,
  choices: ASTRAL_CHOICES,
  gates: Object.freeze([
    Object.freeze({ roomId: 1, stationId: 1, label: '1번 조율판 · 첫 항로', answer: 'triangle' }),
    Object.freeze({ roomId: 3, stationId: 2, label: '2번 조율판 · 먼 좌표', answer: 'diamond' }),
    Object.freeze({ roomId: 4, stationId: 3, label: '3번 조율판 · 귀환 별', answer: 'circle' }),
    Object.freeze({ roomId: 6, stationId: 4, label: '4번 조율판 · 마지막 항로', answer: 'triangle' }),
  ]),
});
export const ROUTE_OBJECTIVES = Object.freeze({
  bellfall_crypt: Object.freeze({
    id: 'bellfall_bell_gates', holdSeconds: 2, radius: 3, noun: '종문', verb: '조율', cueColor: 0xffd060,
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 종문 · 북쪽 예배실' }),
      Object.freeze({ roomId: 3, label: '2번 종문 · 남쪽 회랑' }),
      Object.freeze({ roomId: 5, label: '3번 종문 · 남동쪽 납골실' }),
    ]),
  }),
  // 일식 수문 일반의 원안: 역류 밸브 3개를 순서대로 잠가야 삼두룡의 봉인이 풀린다.
  eclipse_standard: Object.freeze({
    id: 'eclipse_backflow_valves', holdSeconds: 2, radius: 3, noun: '역류 밸브', verb: '잠금', cueColor: 0x63e7dd,
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 역류 밸브 · 북쪽 저수조' }),
      Object.freeze({ roomId: 5, label: '2번 역류 밸브 · 남쪽 배수로' }),
      Object.freeze({ roomId: 7, label: '3번 역류 밸브 · 수문 앞 갑문' }),
    ]),
  }),
  // 녹청의 성역 일반의 원안: 뿌리 문양이 켜진 생명 제단만 정화된다. 순서는 길 순서와 다르며,
  // 정화가 끝났지만 차례가 아닌 제단 중심에 1초 머물면 포자가 터진다.
  verdigris_standard: Object.freeze({
    id: 'verdigris_life_altars', holdSeconds: 2, radius: 3, noun: '생명 제단', verb: '정화', cueColor: 0x72e6ae,
    wrongStep: Object.freeze({ seconds: 1, damage: .08, cooldown: 2, color: 0xb06cff }),
    gates: Object.freeze([
      Object.freeze({ roomId: 3, label: '1번 생명 제단 · 이끼 회랑' }),
      Object.freeze({ roomId: 2, label: '2번 생명 제단 · 뿌리 샘' }),
      Object.freeze({ roomId: 6, label: '3번 생명 제단 · 포자 정원' }),
    ]),
  }),
  cinder_standard: cooling('standard', [[2, '1번 밸브 · 서쪽 수문'], [5, '2번 밸브 · 동쪽 수문']]),
  cinder_deep: cooling('deep', [[2, '1번 밸브 · 상류 냉각선'], [5, '2번 밸브 · 하류 냉각선'], [6, '3번 밸브 · 귀환 냉각선']]),
  // 재벼림 제련소 일반의 원안: 과열 용광로 4곳을 식혀야 거수의 봉인이 풀린다. 두 갈래 길을 모두 지난다.
  ashforge_standard: coolingDef('ashforge_furnaces_standard', [[1, '1번 용광로 · 입구 송풍로'], [2, '2번 용광로 · 사슬 단조장'],
    [3, '3번 용광로 · 북쪽 주조실'], [5, '4번 용광로 · 남쪽 슬래그 통로']], ASHFORGE_COPY),
  nightglass_standard: records('standard', [[2, 1], [5, 2], [6, 3]]),
  nightglass_deep: records('deep', [[6, 3], [4, 2], [1, 1]]),
  astral_standard: constellations,
  // 흑사막 환영 분지 일반의 원안: 가짜 왕좌 3개를 실제 공격으로 부숴야 여왕의 본체가 드러난다.
  // 보라 모래시계가 멈춘 동안에만 균열이 쌓이고, 도는 동안 때리면 모래가 반사된다. 부수는 순서는 자유다.
  sable_standard: Object.freeze({
    id: 'sable_false_thrones', kind: 'thrones', radius: 1.4, standOff: 2.3, hits: 5, hitGap: .2, autoMargin: .8,
    spinSeconds: 2.4, stillSeconds: 2, spinColor: 0x6b45a8, stillColor: 0xe0b0ff,
    reflect: Object.freeze({ damage: .05, cooldown: 1.2 }),
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 가짜 왕좌 · 거울 회랑' }),
      Object.freeze({ roomId: 5, label: '2번 가짜 왕좌 · 모래 신전' }),
      Object.freeze({ roomId: 6, label: '3번 가짜 왕좌 · 환영 정원' }),
    ]),
  }),
});

/** @param {any} stage */
export function routeObjectiveForStage(stage) {
  const expedition = stage?.expedition;
  if (stage?.party || stage?.riftId || expedition?.riftId || expedition?.conquestId ||
      expedition?.kind !== 'dungeon') return null;
  if (expedition.id === 'astral_leviathan_spire') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.astral_standard : null;
  if (expedition.id === 'cinder_tide_lock') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.cinder_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.cinder_deep : null;
  if (expedition.id === 'nightglass_observatory') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.nightglass_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.nightglass_deep : null;
  if (expedition.id === 'eclipse_hydra_vault') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.eclipse_standard : null;
  if (expedition.id === 'verdigris_sanctum') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.verdigris_standard : null;
  if (expedition.id === 'ashforge_catacomb') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.ashforge_standard : null;
  if (expedition.id === 'sable_mirage_basin') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.sable_standard : null;
  return expedition.id === 'bellfall_crypt' && expedition.depth === 'standard' ? ROUTE_OBJECTIVES.bellfall_crypt : null;
}
