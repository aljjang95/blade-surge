// Authored solo objectives are separate from Conquest/party/rift rules.
// 냉각 장치 문구. 재의 수문(밸브·냉각선)이 기본이고, 재벼림 제련소는 용광로 문구를 쓴다.
const CINDER_COPY = Object.freeze({ title: '냉각선 복구', unit: '밸브', done: '냉각선', doneVerb: '복구', cooled: '개방' });
const ASHFORGE_COPY = Object.freeze({ title: '용광로 냉각', unit: '용광로', done: '용광로', doneVerb: '냉각', cooled: '냉각' });
// 재벼림 심층 심장로(BUNDLE-08): 분출을 '망치 충격파'로 부르고, 냉각하면 사슬에 묶인 불씨가 풀려난다.
const ASHFORGE_DEEP_COPY = Object.freeze({ title: '심장로 냉각', unit: '심장로', done: '심장로', doneVerb: '냉각', cooled: '냉각 · 불씨 해방',
  warning: '망치 예고', vent: '망치 충격파' });
// 잿불금고 심층 냉각 밸브(BUNDLE-10): 분출을 '밀물'로 부르고, 밀물이 빠진 뒤에만 밸브를 연다.
// calm·afterShort·afterLong·avoidLong·waitShort 가 없는 정의는 엔진·화면이 지금의 문구(가열 중·충격파 뒤·망치 충격파 뒤·
// 망치 충격파를 피한 뒤·충격파 대기)를 그대로 쓴다.
const EMBER_DEEP_COPY = Object.freeze({ title: '냉각 밸브 개방', unit: '냉각 밸브', done: '냉각 밸브', doneVerb: '개방', cooled: '개방',
  warning: '밀물 경고', vent: '밀물', calm: '물 빠짐', afterShort: '밀물 뒤', afterLong: '밀물이 빠진 뒤', avoidLong: '밀물을 피한 뒤',
  waitShort: '밀물 대기' });
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
// 성운 첨탑 일반의 원안 "별자리 4개 복원, 모래시계가 가리킨 별자리만 밟기, 기록 파편이 모이면 외곽 고리로 이탈"(BUNDLE-13).
// 네 조율판은 기존 계약(docs/astral-standard-constellation-contract.md) 그대로다. ring 은 심층 성좌 외곽 고리(BUNDLE-12)와 같은 엔진을
// 일반 난이도에 맞게 줄인 '기록 외곽 고리 이탈'이다: 4/4 와 시작·보스방을 뺀 모든 구역 정화 뒤 보스 앞 정예방(방 7)에 열리고,
// 고리 위 항로 표지 4개(서·북·동·남, 순서 자유, 각 1초)를 제한 24초 안에 밝히면 보스 봉인이 풀린다.
// 기록 파편은 1.5초부터 5초 주기로 2초 동안 중심에 모였다가(예고) .5초 터지며 중심 반경 3.2 안이면 4% 피해, 시간이 다 되면 고리 붕괴(4%·표지 0/4·24초 다시).
// 표지 배치는 심층과 같은 정사각이다. 이웃한 두 표지를 잇는 직선은 중심에서 약 4.24 떨어져 core 밖이다(반원 위 3개는 가장 가까운 표지부터 가는 AUTO 가
// 양 끝 사이로 중심을 가로질러 모의 1126회 중 108회 피격했다, BUNDLE-13 PLAN 3.0). 일반은 시간·예고·위험 반경·피해를 너그럽게 줄였다. 어느 실패도 진행을 막지 않는다.
// copy 필드(title·mark·shard·verb)는 토스트·목표창·결과 줄 문구를 만든다. 심층 값은 BUNDLE-12 문구를 글자 그대로 재현한다.
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
  ring: Object.freeze({
    roomId: 7, label: '기록 외곽 고리', title: '외곽 고리 이탈', mark: '항로 표지', shard: '기록 파편', verb: '밝히', markVerb: '점등',
    // 서(-x) · 북(-z) · 동(+x) · 남(+z). 영웅은 서쪽 문(방 6)으로 들어온다.
    marks: Object.freeze([Object.freeze([-6, 0]), Object.freeze([0, -6]), Object.freeze([6, 0]), Object.freeze([0, 6])]),
    markRadius: 1.4, holdSeconds: 1, limit: 24,
    first: 1.5, period: 5, warning: 2, burst: .5, core: 3.2, damage: .04,
    collapseDamage: .04, shards: 6, color: 0x9ccaff,
  }),
});
// 성운 첨탑 심층(무너진 성좌)의 원안(BUNDLE-12): "성좌 4곳 복원 → 외곽 고리 정화, 모래시계 별자리 선택과 파편 집결 후 이탈".
// 성좌 4곳은 일반판 조율판 엔진(AstralConstellations)과 같은 규칙·수치다: 방의 적과 증원을 처치하면 준비되고,
// 모래시계 readRadius 안에서 행동·피격 없이 단서를 readSeconds 읽은 뒤 같은 도형 판(radius)에 holdSeconds 머물면 복원된다.
// 오답은 피해 없이 판 밖으로 나와 다시 읽는다. combatRadius 안에 살아 있는 적이 있으면 단서·판을 숨긴다.
// 복원 순서는 길 순서와 다르다: 1번 성좌(방 3)는 막다른 갈래 끝이라 2번 성좌(방 2)를 지나야 닿는다.
// 그래서 2번은 먼저 정리돼 차례를 기다리고, 1번을 복원하고 돌아오는 길에 복원한다. 그 뒤 3번(방 5) → 4번(방 6).
// 외곽 고리(ring): 4/4 와 시작·보스방을 뺀 모든 구역 정화 뒤, 보스 앞 정예방(방 7)에 성좌 외곽 고리가 열린다(열리는 스텝에는 시간이 흐르지 않음).
//   좌표는 모두 방 중심 기준 (x, z) 오프셋이다. 열린 뒤 영웅이 방 사각형 안에 들어서면 정화가 시작되고 제한 시간 limit 초가 흐른다.
//   고리 위 성표 4개(marks) 중 하나의 중심 markRadius 안에 holdSeconds 연속으로 머물면 그 성표가 정화된다(순서 자유, 벗어나면 유지 초기화).
//   4개를 모두 정화하면 외곽 고리 정화 완료이고 그때 보스 봉인이 풀린다.
//   파편 집결: 열린 뒤 first 초부터 period 주기로 고리의 별 파편(shards 개)이 warning 초 동안 중심으로 모이고(예고) burst 초 동안 터진다.
//   터지는 동안 방 중심 core 반경 안(경계 포함)에 있으면 그 집결마다 한 번 최대 체력 damage 피해. 중심을 벗어나면(외곽 고리 위) 안전하다.
//   제한 시간이 다 되면 고리 붕괴: 최대 체력 collapseDamage 피해, 정화한 성표가 모두 흐려지고(0/4) 시간을 limit 부터 다시 잰다.
//   어느 실패도 진행을 막지 않는다. 보물방 공명 2곳은 이 목표로 교체되고, 정예방 2곳 × 증원 1회와 보스(레비아탄) 규칙은 바뀌지 않는다.
const astralDeep = Object.freeze({
  id: 'astral_fallen_constellations_deep', kind: 'deep-constellations', radius: 1.2,
  readRadius: 8, readSeconds: 1, holdSeconds: 1, combatRadius: 22,
  choices: ASTRAL_CHOICES,
  gates: Object.freeze([
    Object.freeze({ roomId: 3, stationId: 1, label: '1번 성좌 · 끊어진 별길', answer: 'circle' }),
    Object.freeze({ roomId: 2, stationId: 2, label: '2번 성좌 · 되돌아온 빛', answer: 'diamond' }),
    Object.freeze({ roomId: 5, stationId: 3, label: '3번 성좌 · 가라앉은 닻별', answer: 'triangle' }),
    Object.freeze({ roomId: 6, stationId: 4, label: '4번 성좌 · 귀환 좌표', answer: 'circle' }),
  ]),
  ring: Object.freeze({
    roomId: 7, label: '성좌 외곽 고리', title: '외곽 고리 정화', mark: '성표', shard: '파편', verb: '정화하', markVerb: '정화',
    // 서(-x) · 북(-z) · 동(+x) · 남(+z). 이웃한 두 성표를 잇는 직선은 중심에서 6 × cos 45° ≈ 4.24 떨어져 core 밖이다.
    marks: Object.freeze([Object.freeze([-6, 0]), Object.freeze([0, -6]), Object.freeze([6, 0]), Object.freeze([0, 6])]),
    markRadius: 1.4, holdSeconds: 1, limit: 20,
    first: 1, period: 4.5, warning: 1.5, burst: .5, core: 3.4, damage: .06,
    collapseDamage: .06, shards: 8, color: 0x8fb8ff,
  }),
});
// 혜성 기사단장 보스전의 푸른 궤도선(BUNDLE-06). 개인 기본 원정 혜성 요새 일반·심층의 보스방에서만 쓴다.
// 보스방 중심의 푸른 선(safe) 안쪽은 평소 유성(바깥 고리 outerMin~outerMax)에서 안전하고, centerEvery 번째마다 중심 유성이 선 안쪽을 덮는다.
// 예고(warning)는 보스가 공격하지 않을 때만 시작하고, 예고 동안 보스는 새 공격을 시작하지 않는다.
// safe·outerMin·outerMax·escape·warning·centerEvery·damage 는 일반판 고리 유성과 같다. first·every 는 BUNDLE-06 PLAN 4.4 시뮬로 확인한다.
const COMET_BOSS_ORBIT = Object.freeze({ id: 'comet_boss_orbit', enemy: 'comet_bastion',
  safe: 5.2, outerMin: 5.8, outerMax: 9, escape: 6.4, first: 2, every: 3.2, warning: 1.4, centerEvery: 3, damage: .07 });
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
  // view 'backflow-valves'(BUNDLE-07): 밸브마다 물줄기가 솟고, 유지하는 동안 줄어들며, 잠그거나 봉인하면 멈춘다(연출만, 규칙은 같다).
  eclipse_standard: Object.freeze({
    id: 'eclipse_backflow_valves', holdSeconds: 2, radius: 3, noun: '역류 밸브', verb: '잠금', cueColor: 0x63e7dd, view: 'backflow-valves',
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 역류 밸브 · 북쪽 저수조' }),
      Object.freeze({ roomId: 5, label: '2번 역류 밸브 · 남쪽 배수로' }),
      Object.freeze({ roomId: 7, label: '3번 역류 밸브 · 수문 앞 갑문' }),
    ]),
  }),
  // 일식 수문 심층의 원안(BUNDLE-07): 역류 밸브 4곳 봉인. 일반과 같은 순차 유지 엔진(RouteObjectives)을 쓴다.
  // 심층 동선은 한 줄(0→…→8)이다. 순서 2 → 4 → 7 → 5 라서 4번 밸브(방 5)는 3번(방 7)을 봉인하러 가는 길에 먼저 정리되고
  // 차례를 기다린다. 3번을 봉인한 뒤 지나온 물길로 두 구역 되돌아가 4번을 봉인한다. 정예방(4·7)의 밸브는 증원 2회가 끝나야 조작된다.
  // 세 머리 동시 예고·물결 뒤 안전 통로는 보스 리그·애니메이션 동기화가 필요해 이 정의의 범위가 아니다.
  eclipse_deep: Object.freeze({
    id: 'eclipse_deep_backflow_seals', holdSeconds: 2, radius: 3, noun: '역류 밸브', verb: '봉인', cueColor: 0x63e7dd, view: 'backflow-valves',
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 역류 밸브 · 잠긴 저수조' }),
      Object.freeze({ roomId: 4, label: '2번 역류 밸브 · 맹세의 갑문' }),
      Object.freeze({ roomId: 7, label: '3번 역류 밸브 · 심연 수문' }),
      Object.freeze({ roomId: 5, label: '4번 역류 밸브 · 되돌아온 물길' }),
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
  // 녹청의 성역 심층(뿌리 심장)의 원안(BUNDLE-11): "생명 제단 4곳 정화 → 포자 수로 돌파, 제단 점등 순서 이동".
  // 제단 규칙은 일반판과 같은 순차 유지 엔진(RouteObjectives)이다: 방의 적을 처치하면(정예방이 아니라 증원 없음) 정화 준비,
  // 점등된 제단 중심(radius)에서 holdSeconds 유지하면 정화. 정화됐지만 점등되지 않은 제단 중심에 wrongStep.seconds 머물면 포자 폭발.
  // 점등 이동(hiddenOrder): 뿌리 빛은 한 번에 한 제단에만 켜지고, 정화할 때마다 길 순서와 다른 다음 제단으로 옮겨 간다
  // (방 2 → 5 → 3 → 6). 일반판처럼 번호를 미리 보여 주지 않고 지금 켜진 제단만 밝힌다(표지·목표창·빛 기둥).
  // 포자 수로(channel): 4/4 와 모든 구역 정화 뒤 방 7(정예, 보스 앞)의 수로가 열린다. 좌표는 모두 방 중심 기준 x 오프셋이다.
  //   startLine 서쪽(방 안)에 들어서면 돌파가 시작되고 제한 시간 = ceil(도착 지점까지 거리장 칸 수 / pace + grace) 초다.
  //   finishLine 을 동쪽으로 넘으면(방 안) 돌파이고 그때 보스 봉인이 풀린다.
  //   수로를 가로지르는 포자 띠(bands, 띠 중심 x 오프셋, 폭 2 × bandHalf, 방 높이 전체)가 열린 뒤 first 초부터
  //   서쪽 띠부터 lag 초 간격으로 경고(warning) → 분출(burst)을 period 주기로 되풀이한다(포자 물결).
  //   분출 중인 띠 안에 있으면 그 분출마다 한 번 최대 체력 damage 피해. 제한 시간이 다 되면 수로 범람(floodDamage 피해 뒤 지금 위치에서 다시 계산).
  //   어느 실패도 진행을 막지 않는다. 보스(녹청 거수) 규칙은 바뀌지 않는다.
  verdigris_deep: Object.freeze({
    id: 'verdigris_root_heart_deep', kind: 'spore-altars', holdSeconds: 2, radius: 3, noun: '생명 제단', verb: '정화', cueColor: 0x72e6ae,
    hiddenOrder: true,
    wrongStep: Object.freeze({ seconds: 1, damage: .08, cooldown: 2, color: 0xb06cff }),
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '뿌리 샘 제단' }),
      Object.freeze({ roomId: 5, label: '이끼 못 제단' }),
      Object.freeze({ roomId: 3, label: '덩굴 회랑 제단' }),
      Object.freeze({ roomId: 6, label: '포자 정원 제단' }),
    ]),
    channel: Object.freeze({
      roomId: 7, label: '포자 수로',
      startLine: -7.5, finishLine: 7.5, entry: Object.freeze([-9, 0]), exit: Object.freeze([9, 0]),
      bands: Object.freeze([-5.4, -1.8, 1.8, 5.4]), bandHalf: 1.1,
      first: 1, period: 4, lag: .8, warning: 1, burst: .7, damage: .06,
      pace: 3, grace: 6, floodDamage: .06, color: 0x9be86a,
    }),
  }),
  cinder_standard: cooling('standard', [[2, '1번 밸브 · 서쪽 수문'], [5, '2번 밸브 · 동쪽 수문']]),
  cinder_deep: cooling('deep', [[2, '1번 밸브 · 상류 냉각선'], [5, '2번 밸브 · 하류 냉각선'], [6, '3번 밸브 · 귀환 냉각선']]),
  // 재벼림 제련소 일반의 원안: 과열 용광로 4곳을 식혀야 거수의 봉인이 풀린다. 두 갈래 길을 모두 지난다.
  ashforge_standard: coolingDef('ashforge_furnaces_standard', [[1, '1번 용광로 · 입구 송풍로'], [2, '2번 용광로 · 사슬 단조장'],
    [3, '3번 용광로 · 북쪽 주조실'], [5, '4번 용광로 · 남쪽 슬래그 통로']], ASHFORGE_COPY),
  // 재벼림 제련소 심층의 원안(BUNDLE-08): 심장로 4곳 냉각과 사슬에 묶인 불씨 해방. 일반과 같은 냉각 장치 엔진(CoolingValves)을 쓴다.
  // shockWindow: 조작판은 그 심장로에서 망치 충격파(증기 분출)가 한 번 지나간 뒤, 가열 구간(다음 망치 예고 전)에만 열린다.
  // 충격파가 끝나면 조작판이 반대편으로 옮겨 가므로 '사슬이 끌리는 반대편'으로 이동해 유지한다. 예고·분출 중에는 유지가 0이 된다.
  // release 'ember-chains': 냉각한 심장로의 사슬이 끊기고 불씨가 풀려나는 연출(규칙 아님). 정예방(2·5)은 증원 2회 뒤에만 조작된다.
  // 보스방의 거수 망치·사슬 끌기와는 별개다(보스 규칙은 바뀌지 않는다).
  ashforge_deep: Object.freeze({
    ...coolingDef('ashforge_heart_furnaces_deep', [[2, '1번 심장로 · 사슬 단조장'], [4, '2번 심장로 · 북쪽 불씨 저장고'],
      [5, '3번 심장로 · 남쪽 주조로'], [7, '4번 심장로 · 거수의 관문']], ASHFORGE_DEEP_COPY),
    shockWindow: true, release: 'ember-chains', releaseSeconds: 1.6,
  }),
  // 잿불금고 심층(침몰한 운반선)의 원안(BUNDLE-10): "밀물 경고가 끝난 뒤 냉각 밸브를 열고".
  // 재벼림 심층과 같은 냉각 장치 엔진(CoolingValves)과 shockWindow 규칙을 쓴다: 준비된 뒤 시작된 밀물이 한 번 지나가면
  // 조작판이 반대편으로 옮겨 가 다음 밀물 경고 전까지만 열린다. 밸브는 좌현 화물칸(2, 정예) → 우현 화물칸(3, 정예) → 기관실 격벽(4) 순서다.
  // 화물칸 두 곳은 1에서 갈라져 4에서 만나므로 2번 밸브로 가는 길이 두 갈래이고, 3번(방 4)은 그 길에 먼저 정리돼 차례를 기다릴 수 있다.
  // ventColor: 밀물 띠는 파란 물빛이라 보스(사슬 집행자)의 주황 용광로 경고와 구분된다. 보스 규칙(후방 공격 등)은 바뀌지 않는다.
  ember_deep: Object.freeze({
    ...coolingDef('ember_tide_valves_deep', [[2, '1번 냉각 밸브 · 좌현 화물칸'], [3, '2번 냉각 밸브 · 우현 화물칸'],
      [4, '3번 냉각 밸브 · 기관실 격벽']], EMBER_DEEP_COPY),
    shockWindow: true, ventColor: 0x3d8cff,
    // 사슬 집행자 후방 노출(BUNDLE-14): 원안의 남은 문장 "사슬 집행자의 후방을 공격". 보스 규칙이며 이 심층 개인 원정에서만 쓴다.
    // 용재 망치(signature)의 마지막 고리가 터진 직후 window초 동안 집행자가 제자리에 묶여 방향을 바꾸지 않고 새 공격을 시작하지 않는다.
    // 그동안 맞은 방향과 정면의 내적이 rearDot 이상이면 등 뒤(rear 배), -frontDot 이하면 정면 사슬 갑주(front 배), 옆은 1배다. 창 밖은 늘 1배다.
    // AUTO 는 내적 autoDot 이상·사거리(meleeReach/rangedReach) 안의 등 뒤로 돌아가 친다. 정면이면 옆으로 sidePad 만큼 돌아 들어간다.
    // 수치는 BUNDLE-14 PLAN 의 보스전 모의(tools/ember-deep-boss-sim.mjs)로 정했다.
    rear: Object.freeze({ id: 'ember_deep_rear', boss: 'cinder_chain_executor', signature: 'kiln_hammer', window: 4,
      rearDot: .35, frontDot: .35, rear: 2, front: .5, autoDot: .6, meleeReach: 2.4, rangedReach: 6, sidePad: .9 }),
  }),
  nightglass_standard: records('standard', [[2, 1], [5, 2], [6, 3]]),
  nightglass_deep: records('deep', [[6, 3], [4, 2], [1, 1]]),
  astral_standard: constellations,
  astral_deep: astralDeep,
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
  // 흑사막 분지 심층(왕좌의 거울)의 원안: 가짜 왕좌 4곳 파괴 → 거울 미궁 탈출 → 본체 처치.
  // 왕좌 규칙(모래시계 멈춤 때만 균열 5회, 회전 중 공격은 모래 반사, 부수는 순서 자유)은 일반과 같고 수만 4곳이다.
  // 4/4 파괴와 모든 구역 정화가 끝나면 거울 미궁이 열린다. 방 4(거울 전당)에 거울 두 개가 서고,
  // 사라지는 모래 발자국과 멈춘 모래시계가 진짜 거울을 가리킨다. 시작 위치에서 진짜 거울까지의 길 길이로 정한
  // 제한 시간(칸 수 / pace + grace, 올림) 안에 진짜 거울에 닿으면 탈출이고 그때 보스 봉인이 풀린다.
  // 환영 거울에 닿으면 모래 반사(피해·밀침·재사용 대기), 시간이 다 되면 거울 붕괴(피해 뒤 지금 위치에서 다시 계산)다.
  // 어느 실패도 진행을 막지 않는다. 보스(환영 여왕) 규칙은 바뀌지 않는다.
  sable_deep: Object.freeze({
    id: 'sable_mirror_thrones_deep', kind: 'thrones', radius: 1.4, standOff: 2.3, hits: 5, hitGap: .2, autoMargin: .8,
    spinSeconds: 2.4, stillSeconds: 2, spinColor: 0x6b45a8, stillColor: 0xe0b0ff,
    reflect: Object.freeze({ damage: .05, cooldown: 1.2 }),
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 가짜 왕좌 · 거울 회랑' }),
      Object.freeze({ roomId: 3, label: '2번 가짜 왕좌 · 모래 신전' }),
      Object.freeze({ roomId: 5, label: '3번 가짜 왕좌 · 환영 정원' }),
      Object.freeze({ roomId: 6, label: '4번 가짜 왕좌 · 거울 교차로' }),
    ]),
    escape: Object.freeze({
      roomId: 4, label: '거울 전당',
      // 방 중심 기준 (x, z) 오프셋. 0 = 진짜 거울, 1 = 환영 거울.
      real: Object.freeze([5, 3.5]), illusion: Object.freeze([-5, 3.5]),
      radius: 1.4, pace: 4, grace: 6,
      collapseDamage: .06, illusionDamage: .06, illusionCooldown: 1.5,
      trailCount: 10, trailSpacing: 1.6, trailEvery: .5,
    }),
  }),
  // 혜성 요새 일반의 원안: 궤도 고리 4개 정렬. 궤도 위 룬석을 몸으로 밀어 별 표식에 맞춘다.
  // 정렬 중 유성은 평소 푸른 궤도선 바깥 고리에 떨어지고, 세 번째마다 안쪽 전체를 덮는 중심 유성이 온다.
  comet_standard: Object.freeze({
    id: 'comet_orbit_rings', kind: 'orbits', track: 4, band: 1.5, contact: 1.3, tolerance: .14, lockSeconds: .4,
    safe: 5.2, outerMin: 5.8, outerMax: 9, escape: 6.4,
    meteor: Object.freeze({ every: 3.2, warning: 1.4, centerEvery: 3, damage: .07 }),
    boss: COMET_BOSS_ORBIT,
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
    boss: COMET_BOSS_ORBIT,
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
  if (expedition.id === 'astral_leviathan_spire') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.astral_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.astral_deep : null;
  if (expedition.id === 'cinder_tide_lock') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.cinder_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.cinder_deep : null;
  if (expedition.id === 'nightglass_observatory') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.nightglass_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.nightglass_deep : null;
  if (expedition.id === 'eclipse_hydra_vault') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.eclipse_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.eclipse_deep : null;
  if (expedition.id === 'verdigris_sanctum') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.verdigris_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.verdigris_deep : null;
  if (expedition.id === 'ashforge_catacomb') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.ashforge_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.ashforge_deep : null;
  if (expedition.id === 'sable_mirage_basin') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.sable_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.sable_deep : null;
  if (expedition.id === 'comet_bastion') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.comet_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.comet_deep : null;
  if (expedition.id === 'ember_vault') return expedition.depth === 'deep' ? ROUTE_OBJECTIVES.ember_deep : null;
  if (expedition.id === 'bellfall_crypt') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.bellfall_crypt
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.bellfall_deep : null;
  return null;
}
