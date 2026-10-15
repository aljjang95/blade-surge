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
  // 혜성 요새 일반의 원안: 궤도 고리 4개 정렬. 궤도 위 룬석을 몸으로 밀어 별 표식에 맞춘다.
  // 정렬 중 유성은 평소 푸른 궤도선 바깥 고리에 떨어지고, 세 번째마다 안쪽 전체를 덮는 중심 유성이 온다.
  comet_standard: Object.freeze({
    id: 'comet_orbit_rings', kind: 'orbits', track: 4, band: 1.5, contact: 1.3, tolerance: .14, lockSeconds: .4,
    safe: 5.2, outerMin: 5.8, outerMax: 9, escape: 6.4,
    meteor: Object.freeze({ every: 3.2, warning: 1.4, centerEvery: 3, damage: .07 }),
    gates: Object.freeze([
      Object.freeze({ roomId: 1, label: '1번 궤도 고리 · 북문 관측대', target: 0, start: 2.2 }),
      Object.freeze({ roomId: 3, label: '2번 궤도 고리 · 중앙 성벽', target: Math.PI / 2, start: Math.PI / 2 - 2.2 }),
      Object.freeze({ roomId: 5, label: '3번 궤도 고리 · 유성 포대', target: Math.PI, start: Math.PI - 2.2 }),
      Object.freeze({ roomId: 7, label: '4번 궤도 고리 · 혜성 보고', target: -Math.PI / 2, start: -Math.PI / 2 + 2.2 }),
    ]),
  }),
  // 혜성 요새 심층의 원안: 궤도 고리 5개. 룬석을 별에 맞추는 밀기 물리는 일반판과 같고,
  // 첫 밀기에서 붕괴 시계(9초)가 시작된다. 정렬 뒤 중심 쉼터에 머물면 연결되고, 연결 직후 유성 폭풍 3회가 온다.
  // 폭풍 예고 중에는 청록 빈 원(쉼터, center → star → side 순)만 안전하다. 공명 제단은 이 목표로 교체된다(공존 키 없음).
  comet_deep: Object.freeze({
    id: 'comet_deep_orbits', kind: 'deep-orbits',
    track: 4, band: 1.5, contact: 1.3, tolerance: .14, lockSeconds: .4,
    collapseSeconds: 9, shelterRadius: 2.2, connectSeconds: .5,
    storm: Object.freeze({ warning: 1.4, gap: .6, tail: .4, damage: .08, radius: 12,
      shelters: Object.freeze(['center', 'star', 'side']) }),
    gates: Object.freeze([
      Object.freeze({ roomId: 1, label: '1번 궤도 고리 · 붕괴한 관측대', target: Math.PI / 2, start: Math.PI / 2 - 2.2 }),
      Object.freeze({ roomId: 2, label: '2번 궤도 고리 · 혜성 보고', target: 0, start: 2.2 }),
      Object.freeze({ roomId: 3, label: '3번 궤도 고리 · 중앙 성벽', target: Math.PI / 2, start: Math.PI / 2 + 2.2 }),
      Object.freeze({ roomId: 5, label: '4번 궤도 고리 · 유성 포대', target: Math.PI / 2, start: Math.PI / 2 - 2.2 }),
      Object.freeze({ roomId: 7, label: '5번 궤도 고리 · 기사단 보고', target: Math.PI, start: Math.PI + 2.2 }),
    ]),
  }),
  // 종락 회랑 심층의 원안: 종문 3개 역순 공명. 방의 적을 처치하면 그 종이 켜진다(점등).
  // 세 종이 모두 켜지면 tollOrder 순서로 하나씩 꺼진다(소등, lead 뒤 gap 간격, 마지막 소등 뒤 tail).
  // 그다음 마지막에 꺼진 종부터 역순으로 종 중심(radius)에 holdSeconds 머물러 공명한다.
  // 틀린 종에서 holdSeconds 를 채우면 불협: 최대 체력 discord.damage 피해, 공명한 종이 모두 다시 켜지고 소등을 다시 들려준다.
  // 불협이 guideAfter 회 이상이면 목표창이 다음 종을 알려준다. 공명 제단 2곳(보물방 2·5)은 이 목표로 교체된다.
  // "마지막 울림 직후에만 반격"(보스 피격 조건)은 이 정의의 범위가 아니다.
  bellfall_deep: Object.freeze({
    id: 'bellfall_deep_bells', kind: 'reverse-bells', holdSeconds: 2, radius: 3, noun: '종문', verb: '역순 공명',
    toll: Object.freeze({ lead: 1, gap: 1.4, tail: 1 }),
    discord: Object.freeze({ damage: .06 }),
    guideAfter: 2,
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 종문 · 북쪽 예배실' }),
      Object.freeze({ roomId: 3, label: '2번 종문 · 북동쪽 종탑' }),
      Object.freeze({ roomId: 5, label: '3번 종문 · 남쪽 납골실' }),
    ]),
    // 소등 순서(방 id): 2번 → 3번 → 1번 종문. 정답은 그 역순인 방 2 → 5 → 3(1번 → 3번 → 2번 종문)이다.
    tollOrder: Object.freeze([3, 5, 2]),
    // 보스 합창 장막(BUNDLE-05): 보스는 장막 동안 받는 피해가 veil 배로 줄고, signature 시그니처의 마지막 울림 직후
    // window초 동안만 장막이 걷혀 open 배 피해를 받으며 새 공격을 시작하지 않는다. 같은 심층 개인 원정에서만 쓴다.
    // 수치는 BUNDLE-05 PLAN 4.5 밸런스 시뮬로 정했다(장막 .3·창 1.3은 처치 시간 비 2.0을 넘었다).
    counter: Object.freeze({ id: 'bellfall_deep_counter', signature: 'bell_toll', window: 3.5, veil: .5, open: 1.5 }),
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
  if (expedition.id === 'comet_bastion') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.comet_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.comet_deep : null;
  if (expedition.id === 'bellfall_crypt') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.bellfall_crypt
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.bellfall_deep : null;
  return null;
}
