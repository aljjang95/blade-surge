import { ENEMIES, stageDef } from './stages.js';
import { ROUTE_OBJECTIVES } from './route-objectives.js';

// 종락 심층 보스 합창 장막 문구의 숫자는 규칙 정의(ROUTE_OBJECTIVES.bellfall_deep.counter)에서 계산한다.
const BELLFALL_COUNTER = ROUTE_OBJECTIVES.bellfall_deep.counter;
const BELLFALL_VEIL_PERCENT = Math.round((1 - BELLFALL_COUNTER.veil) * 100);
const BELLFALL_OPEN_TIMES = Math.round(BELLFALL_COUNTER.open * 10) / 10;

// 혜성 기사단장 보스방 푸른 궤도선 문구의 숫자는 규칙 정의(ROUTE_OBJECTIVES.comet_deep.boss)에서 계산한다.
const COMET_BOSS_ORBIT = ROUTE_OBJECTIVES.comet_deep.boss;
const COMET_BOSS_COPY = `보스방에는 푸른 궤도선이 그려집니다. 기사단장이 공격하지 않는 틈에 ${COMET_BOSS_ORBIT.warning}초 유성 예고가 뜨고, 평소 유성은 푸른 선 바깥에 떨어지니 선 안쪽이 안전합니다. ${['첫', '두', '세', '네', '다섯'][COMET_BOSS_ORBIT.centerEvery - 1]} 번째마다 중심 유성이 선 안쪽을 덮으면 중앙을 버리고 푸른 선 바깥으로 피하세요(맞으면 최대 체력 ${Math.round(COMET_BOSS_ORBIT.damage * 100)}%). 유성 예고 동안 기사단장은 새 공격을 시작하지 않습니다.`;

// 일식 수문 심층 역류 밸브 문구의 숫자·번호 순서는 규칙 정의(ROUTE_OBJECTIVES.eclipse_deep)에서 계산한다(BUNDLE-07).
// 정예방 수·증원 횟수는 아래 eclipse_hydra_vault 의 레이아웃·mechanics 와 같은 값이며 계약 테스트가 일치를 검사한다.
const ECLIPSE_VALVES = ROUTE_OBJECTIVES.eclipse_deep;
const ECLIPSE_ELITES = 2;
const ECLIPSE_REINFORCEMENTS = 2;
const ECLIPSE_LAST = ECLIPSE_VALVES.gates.length;
const ECLIPSE_STEPS = ECLIPSE_VALVES.gates.map((_, i) => `${i + 1}번`).join(' → ');
const ECLIPSE_OBJECTIVE = `${ECLIPSE_VALVES.noun} ${ECLIPSE_LAST}곳을 순서대로 ${ECLIPSE_VALVES.verb}하고 정예방 ${ECLIPSE_ELITES}곳의 증원 각 ${ECLIPSE_REINFORCEMENTS}회 격파 → 모든 구역 정화 → 흑요의 삼두룡 처치`;
// 길은 한 줄이라 마지막 번호의 밸브(방 5)는 바로 앞 번호의 밸브(방 7)로 가는 길에 먼저 지나친다.
const ECLIPSE_TACTIC = `각 밸브 구역의 적을 처치한 뒤(정예방은 증원 ${ECLIPSE_REINFORCEMENTS}회까지) ${ECLIPSE_STEPS} 순서로 청록 빛 안에서 각각 연속 ${ECLIPSE_VALVES.holdSeconds}초간 밸브를 ${ECLIPSE_VALVES.verb}하세요. ${ECLIPSE_LAST}번 밸브는 ${ECLIPSE_LAST - 1}번으로 가는 길에 먼저 지나치니 차례를 기다렸다가, ${ECLIPSE_LAST - 1}번을 ${ECLIPSE_VALVES.verb}한 뒤 지나온 물길로 되돌아가 ${ECLIPSE_VALVES.verb}하세요. 밸브 ${ECLIPSE_LAST}곳과 모든 구역을 정화하면 보스 봉인이 풀립니다. ${ENEMIES.obsidian_hydra.tactic}`;

// 재벼림 제련소 심층 심장로 문구의 숫자·번호 순서는 규칙 정의(ROUTE_OBJECTIVES.ashforge_deep)에서 계산한다(BUNDLE-08).
// 정예방 수·증원 횟수는 아래 ashforge_catacomb 의 레이아웃·mechanics 와 같은 값이며 계약 테스트가 일치를 검사한다.
const ASHFORGE_FURNACES = ROUTE_OBJECTIVES.ashforge_deep;
const ASHFORGE_ELITES = 2;
const ASHFORGE_REINFORCEMENTS = 2;
const ASHFORGE_COPY = ASHFORGE_FURNACES.copy;
const ASHFORGE_COUNT = ASHFORGE_FURNACES.gates.length;
const ASHFORGE_STEPS = ASHFORGE_FURNACES.gates.map((_, i) => `${i + 1}번`).join(' → ');
const ASHFORGE_OBJECTIVE = `${ASHFORGE_COPY.unit} ${ASHFORGE_COUNT}곳을 ${ASHFORGE_COPY.vent} 뒤 순서대로 ${ASHFORGE_COPY.doneVerb}하고 정예방 ${ASHFORGE_ELITES}곳의 증원 각 ${ASHFORGE_REINFORCEMENTS}회 격파 → 모든 구역 정화 → 잿빛 재벼림 거수 처치`;
const ASHFORGE_TACTIC = `각 ${ASHFORGE_COPY.unit} 구역의 적을 처치한 뒤(정예방은 증원 ${ASHFORGE_REINFORCEMENTS}회까지) ${ASHFORGE_STEPS} 순서로 ${ASHFORGE_COPY.doneVerb}하세요. ${ASHFORGE_COPY.vent}가 한 번 지나가면 조작판이 반대편으로 옮겨 가 열립니다. 다음 ${ASHFORGE_COPY.warning} 전까지 그 청록 조작판에서 행동 없이 ${ASHFORGE_FURNACES.holdSeconds}초 유지하면 ${ASHFORGE_COPY.unit}가 식고 사슬에 묶인 불씨가 풀려납니다. 예고·충격파 중이거나 이탈·공격·회피·피격·일시정지하면 유지 시간이 초기화됩니다. ${ASHFORGE_COPY.unit} ${ASHFORGE_COUNT}곳과 모든 구역을 정화하면 보스 봉인이 풀립니다. `;
// 거수 사슬 끊기(BUNDLE-15) 안내. 수치는 정의(ROUTE_OBJECTIVES.ashforge_deep.chains)에서 읽는다. 보스 전술 뒤에 붙인다.
const ASHFORGE_CHAINS = ASHFORGE_FURNACES.chains;
const ASHFORGE_CHAIN_TACTIC = `용재 망치가 내려칠 때 사슬이 망치 쪽으로 끌리고 반대편에 사슬 기둥이 섭니다. 마지막 고리 뒤 ${ASHFORGE_CHAINS.window}초 동안 거수는 쫓아오지 못합니다. 그 안에 열린 기둥에서 행동 없이 ${ASHFORGE_CHAINS.hold}초 버티면 사슬이 끊겨 거수가 ${ASHFORGE_CHAINS.exposed}초 동안 휘청이며 받는 피해가 ${ASHFORGE_CHAINS.exposedMult}배가 되고, 끊을 때마다 남은 전투 동안 받는 피해가 ${Math.round(ASHFORGE_CHAINS.weaken * 100)}%씩 늘어납니다(사슬 ${ASHFORGE_CHAINS.count}개).`;

// 흑사막 분지 심층 가짜 왕좌 4곳·거울 미궁 문구의 숫자는 규칙 정의(ROUTE_OBJECTIVES.sable_deep)에서 계산한다(BUNDLE-09).
// 정예방 수·증원 횟수는 아래 sable_mirage_basin 의 레이아웃·mechanics 와 같은 값이며 계약 테스트가 일치를 검사한다.
const SABLE_THRONES = ROUTE_OBJECTIVES.sable_deep;
const SABLE_ELITES = 2;
const SABLE_REINFORCEMENTS = 2;
const SABLE_COUNT = SABLE_THRONES.gates.length;
const SABLE_OBJECTIVE = `가짜 왕좌 ${SABLE_COUNT}곳 파괴와 정예방 ${SABLE_ELITES}곳의 증원 각 ${SABLE_REINFORCEMENTS}회 격파 → 모든 구역 정화 → 거울 미궁 탈출 → 환영 여왕 처치`;
const SABLE_TACTIC = `각 왕좌 구역의 적을 처치한 뒤(정예방은 증원 ${SABLE_REINFORCEMENTS}회까지) 보라 모래시계가 멈춘 동안 왕좌를 ${SABLE_THRONES.hits}번 공격해 ${SABLE_COUNT}곳을 모두 부수세요. 모래시계가 도는 동안 때리면 모래가 반사됩니다. 왕좌 ${SABLE_COUNT}곳과 모든 구역을 정화하면 거울 전당에 거울 두 개가 섭니다. 사라지는 모래 발자국과 멈춘 모래시계를 따라 제한 시간 안에 진짜 거울에 닿으면 보스 봉인이 풀립니다. 환영 거울은 모래를 반사하고, 시간이 다 되면 거울이 무너져 피해를 입은 뒤 다시 시작합니다. `;

// 잿불금고 심층 냉각 밸브 문구의 숫자·번호 순서는 규칙 정의(ROUTE_OBJECTIVES.ember_deep)에서 계산한다(BUNDLE-10).
// 정예방 수·증원 횟수는 아래 ember_vault 의 레이아웃·mechanics 와 같은 값이며 계약 테스트가 일치를 검사한다.
const EMBER_TIDE = ROUTE_OBJECTIVES.ember_deep;
const EMBER_ELITES = 2;
const EMBER_REINFORCEMENTS = 1;
const EMBER_COPY = EMBER_TIDE.copy;
const EMBER_COUNT = EMBER_TIDE.gates.length;
const EMBER_STEPS = EMBER_TIDE.gates.map((_, i) => `${i + 1}번`).join(' → ');
const EMBER_OBJECTIVE = `${EMBER_COPY.unit} ${EMBER_COUNT}곳을 ${EMBER_COPY.vent} 뒤 순서대로 ${EMBER_COPY.doneVerb}하고 정예방 ${EMBER_ELITES}곳의 증원 각 ${EMBER_REINFORCEMENTS}회 격파 → 모든 구역 정화 → 선단 압류관 처치`;
const EMBER_TACTIC = `각 ${EMBER_COPY.unit} 구역의 적을 처치한 뒤(정예방은 증원 ${EMBER_REINFORCEMENTS}회까지) ${EMBER_STEPS} 순서로 ${EMBER_COPY.doneVerb}하세요. ${EMBER_COPY.vent}이 한 번 지나가면 조작판이 반대편으로 옮겨 가 열립니다. 다음 ${EMBER_COPY.warning} 전까지 그 청록 조작판에서 행동 없이 ${EMBER_TIDE.holdSeconds}초 유지하면 ${EMBER_COPY.unit}가 열립니다. 파란 ${EMBER_COPY.vent} 띠 안에 있으면 피해를 입습니다. `;
// 사슬 집행자 후방 노출(BUNDLE-14) 안내. 수치는 정의(ROUTE_OBJECTIVES.ember_deep.rear)에서 읽는다. 보스 전술 뒤에 붙인다(전술 공략 문구에는 없다).
const EMBER_REAR = EMBER_TIDE.rear;
const EMBER_REAR_TACTIC = `용재 망치의 마지막 고리가 터지면 ${EMBER_REAR.window}초 동안 집행자가 제자리에 묶입니다. 그동안 등 뒤에서 치면 피해 ${EMBER_REAR.rear}배, 정면은 사슬 갑주에 막혀 ${Math.round(EMBER_REAR.front * 100)}%입니다.`;

// 녹청 성역 심층 생명 제단·포자 수로 문구의 숫자는 규칙 정의(ROUTE_OBJECTIVES.verdigris_deep)에서 계산한다(BUNDLE-11).
// 정예방 수·증원 횟수는 아래 verdigris_sanctum 의 레이아웃·mechanics 와 같은 값이며 계약 테스트가 일치를 검사한다.
// 이 원정에는 전술 공략(conquest)이 없고 전술 공략 실행은 경로 목표를 쓰지 않으므로(routeObjectiveForStage null) conquestTactic 은 두지 않는다.
const VERDIGRIS_ALTARS = ROUTE_OBJECTIVES.verdigris_deep;
const VERDIGRIS_ELITES = 2;
const VERDIGRIS_REINFORCEMENTS = 2;
const VERDIGRIS_COUNT = VERDIGRIS_ALTARS.gates.length;
const VERDIGRIS_OBJECTIVE = `${VERDIGRIS_ALTARS.noun} ${VERDIGRIS_COUNT}곳을 뿌리 빛이 옮겨 가는 순서대로 ${VERDIGRIS_ALTARS.verb}하고 정예방 ${VERDIGRIS_ELITES}곳의 증원 각 ${VERDIGRIS_REINFORCEMENTS}회 격파 → 모든 구역 정화 → 포자 수로 돌파 → 녹청 수호자 처치`;
const VERDIGRIS_TACTIC = `각 제단 구역의 적을 처치한 뒤(정예방은 증원 ${VERDIGRIS_REINFORCEMENTS}회까지) 지금 뿌리 빛이 켜진 제단 중심에서 연속 ${VERDIGRIS_ALTARS.holdSeconds}초간 ${VERDIGRIS_ALTARS.verb}하세요. 제단 번호는 보이지 않고, ${VERDIGRIS_ALTARS.verb}할 때마다 뿌리 빛이 길 순서와 다른 다음 제단으로 옮겨 갑니다. 적을 처치했지만 빛이 꺼진 제단 중심에 ${VERDIGRIS_ALTARS.wrongStep.seconds}초 머물면 포자가 터져 피해를 받습니다. ${VERDIGRIS_ALTARS.noun} ${VERDIGRIS_COUNT}곳과 모든 구역을 ${VERDIGRIS_ALTARS.verb}하면 보스방 앞 정예방에 포자 수로가 열립니다. 서쪽 입구에서 제한 시간 안에 포자 물결이 지나간 틈을 타 동쪽 출구로 건너면 보스 봉인이 풀립니다. 물결에 맞으면 피해를 입고, 시간이 다 되면 수로가 범람해 피해를 입은 뒤 시간을 다시 잽니다. `;

// 성운 첨탑 심층 성좌 4곳·외곽 고리 문구의 숫자는 규칙 정의(ROUTE_OBJECTIVES.astral_deep)에서 계산한다(BUNDLE-12).
// 정예방 수·증원 횟수는 아래 astral_leviathan_spire 의 레이아웃·mechanics 와 같은 값이며 계약 테스트가 일치를 검사한다.
// 이 원정에는 전술 공략(conquest)이 없고 전술 공략 실행은 경로 목표를 쓰지 않으므로(routeObjectiveForStage null) conquestTactic 은 두지 않는다.
const ASTRAL_DEEP = ROUTE_OBJECTIVES.astral_deep;
const ASTRAL_ELITES = 2;
const ASTRAL_REINFORCEMENTS = 1;
const ASTRAL_COUNT = ASTRAL_DEEP.gates.length;
const ASTRAL_RING = ASTRAL_DEEP.ring;
const ASTRAL_MARKS = ASTRAL_RING.marks.length;
// 복원 문구는 목표·전술에서 한 문장으로만 쓴다(계약 테스트가 이 정확한 문구만 면제한다).
const ASTRAL_RESTORE = `성좌 ${ASTRAL_COUNT}곳을 순서대로 복원`;
const ASTRAL_OBJECTIVE = `${ASTRAL_RESTORE}하고 정예방 ${ASTRAL_ELITES}곳의 증원 각 ${ASTRAL_REINFORCEMENTS}회 격파 → 모든 구역 정화 → 성좌 외곽 고리 정화 → 레비아탄 처치`;
const ASTRAL_TACTIC = `각 구역의 적을 처치한 뒤(정예방은 증원 ${ASTRAL_REINFORCEMENTS}회까지) ${ASTRAL_RESTORE}하세요. 모래시계 단서를 ${ASTRAL_DEEP.readSeconds}초 읽고 같은 문자·도형 판에서 ${ASTRAL_DEEP.holdSeconds}초 유지하면 복원됩니다. 오답은 피해 없이 판 밖으로 나와 다시 읽으며, 공격·회피·피격·전투 재개·일시정지하면 현재 선택이 초기화됩니다. 1번은 막다른 길 끝이라 가는 길에 2번을 먼저 지나치니, 2번은 적만 정리해 두고 1번을 복원한 뒤 돌아오는 길에 복원하세요. ${ASTRAL_COUNT}곳과 모든 구역을 정화하면 보스방 앞 정예방에 성좌 외곽 고리가 열립니다. 제한 시간 ${ASTRAL_RING.limit}초 안에 고리 위 성표 ${ASTRAL_MARKS}개에서 각각 ${ASTRAL_RING.holdSeconds}초 머물러 정화하세요(순서 자유). 파편이 중심으로 모이면 터지기 전에 중심 밖 고리 위로 비키세요(맞으면 최대 체력 ${Math.round(ASTRAL_RING.damage * 100)}%). 시간이 다 되면 고리가 붕괴해 피해를 입고 성표가 흐려진 뒤 시간을 다시 잽니다. 성표 ${ASTRAL_MARKS}개를 모두 정화하면 보스 봉인이 풀립니다. `;
import { CONCEPT_DUNGEONS } from './expansion.js';

// 컨셉 던전 심층은 같은 컨셉 지형(셀·간선·원형 방·이름표)을 그대로 쓰고 방 종류(정예 배치)만 바꾼다.
const conceptLayout = (id, types) => {
  const layout = CONCEPT_DUNGEONS.find(d => d.id === id).layout;
  if (types.length !== layout.types.length) throw new RangeError('컨셉 심층 방 수가 기본 지형과 다릅니다.');
  return { ...layout, types };
};

// Authored follow-up expeditions. The base material runs keep their original
// price and rewards; these routes unlock at explicit campaign milestones.
export const EXPEDITION_DEPTHS = [
  {
    id: 'glass_garden', depth: 'deep', name: '유리정원 · 종의 뿌리', unlockCode: '2-10', minLevel: 1,
    energy: 6, chapter: 1, stage: 5, scale: 7.5, bossEnemy: 'glass_hour_sovereign', bossHp: 18000,
    description: '용광로를 멈춘 뒤에도 정원 아래 남은 명령이 종을 울립니다. 두 갈래 봉인 제단을 정화하고 뿌리의 감시자를 해방하세요.',
    objective: '보물방 2곳에서 적 처치 후 중심 2초 공명 → 모든 구역 정화 → 뿌리의 감시자 처치',
    bossName: '종의 뿌리를 지키는 자', art: '/img/expansion/glass_garden.webp',
    tactic: `두 갈래 보물방의 적을 처치하고 각 제단 중심의 빛 안에서 2초간 공명하세요. 제단의 공명 순서는 자유입니다. ${ENEMIES.glass_hour_sovereign.tactic}`,
    layout: { spacing: [36,36], size: [20,20], width: 6,
      cells: [[0,0],[1,0],[1,-1],[1,1],[2,-1],[2,1],[2,0],[3,0]],
      edges: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6],[6,7]],
      types: ['start','normal','treasure','treasure','normal','elite','normal','boss'] },
    mechanics: { attunement: true, reinforcements: 0 },
    rewards: { gold: 1400, xp: 300, materials: { glass_leaf: 6 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1000, materials: { glass_leaf: 3 } },
  },
  {
    id: 'ember_vault', depth: 'deep', name: '잿불금고 · 침몰한 운반선', unlockCode: '4-10', minLevel: 2,
    energy: 6, chapter: 4, stage: 5, scale: 14, bossEnemy: 'cinder_chain_executor', bossHp: 22000,
    description: '해왕의 사슬 아래 가라앉은 운반선에 빼앗긴 불씨가 남아 있습니다. 잠긴 화물칸을 돌파하고 압류관의 명령을 끊으세요.',
    objective: EMBER_OBJECTIVE,
    bossName: '가라앉은 선단의 압류관', art: '/img/expansion/ember_vault.webp',
    tactic: `${EMBER_TACTIC}${ENEMIES.cinder_chain_executor.tactic} ${EMBER_REAR_TACTIC}`,
    // 전술 공략(vault_signal·vault_manifest)은 냉각 밸브가 없는 심층 동선을 쓴다(routeObjectiveForStage null). 밸브 안내 없이 BUNDLE-10 이전 문구를 쓴다.
    conquestTactic: `화물칸의 정예방마다 적과 1회 증원을 격파하세요. ${ENEMIES.cinder_chain_executor.tactic}`,
    layout: { spacing: [36,36], size: [22,20], width: 7,
      cells: [[0,0],[1,0],[1,1],[2,0],[2,1],[3,1]],
      edges: [[0,1],[1,2],[1,3],[2,4],[3,4],[4,5]],
      types: ['start','normal','elite','elite','normal','boss'] },
    mechanics: { attunement: false, reinforcements: 1 },
    rewards: { gold: 2200, xp: 450, materials: { ember_core: 8 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1800, materials: { ember_core: 3 } },
  },
  {
    id: 'star_archive', depth: 'deep', name: '별빛서고 · 귀환의 관측소', unlockCode: '6-10', minLevel: 3,
    energy: 6, chapter: 6, stage: 10, scale: 22, bossEnemy: 'nightglass_archivist', bossHp: 25000,
    description: '귀환로가 이어진 밤, 관측소에서 아직 돌아오지 못한 이들의 이름이 발견됩니다. 기록의 좌표를 복원해 마지막 길잡이를 깨우세요.',
    objective: '보물방 2곳에서 적 처치 후 중심 2초 공명 → 모든 구역 정화 → 귀환의 길잡이 처치',
    bossName: '남겨진 이름의 길잡이', art: '/img/expansion/star_archive.webp',
    tactic: `보물방의 적을 처치하고 각 기록 제단 중심의 빛 안에서 2초간 공명하세요. 제단의 공명 순서는 자유입니다. ${ENEMIES.nightglass_archivist.tactic}`,
    layout: { spacing: [36,36], size: [20,20], width: 6,
      cells: [[0,0],[0,1],[-1,1],[1,1],[-1,2],[1,2],[0,2],[0,3]],
      edges: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6],[6,7]],
      types: ['start','normal','treasure','treasure','elite','normal','normal','boss'] },
    mechanics: { attunement: true, reinforcements: 0 },
    rewards: { gold: 3200, xp: 600, materials: { star_dust: 10 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 2600, materials: { star_dust: 3 } },
  },
  {
    id: 'bellfall_crypt', depth: 'deep', name: '종락 회랑 · 멈춘 합창', unlockCode: '1-10', minLevel: 2,
    energy: 6, chapter: 1, stage: 5, scale: 9, bossEnemy: 'glass_hour_sovereign', bossHp: 20500,
    description: '멈춘 종 아래 남겨진 합창단의 이름을 되찾고, 봉인된 시계유리의 심장을 깨우세요.',
    objective: '종문 3개 점등 → 소등 순서의 역순으로 공명 → 정예방 2곳의 증원 각 1회 격파 → 모든 구역 정화 → 마지막 울림 직후 반격으로 멈춘 합창의 주권자 처치', bossName: '멈춘 합창의 주권자', art: '/img/encounters/chronicle_glass_hour_sovereign.webp',
    tactic: `종문 3곳(1번 북쪽 예배실 · 2번 북동쪽 종탑 · 3번 남쪽 납골실)의 적을 처치하면 그 종이 켜집니다. 세 종이 모두 켜지면 1초 뒤부터 1.4초 간격으로 하나씩 꺼지니 꺼지는 순서를 기억하세요. 마지막에 꺼진 종부터 거꾸로 각 종 중심 반경 3 안에서 2초 머물러 공명합니다. 틀린 종에서 2초를 채우면 불협이 울려 최대 체력 6% 기준의 피해(방어력으로 줄어듭니다)를 입고, 공명한 종이 모두 다시 켜져 소등을 처음부터 다시 듣습니다. 불협 2회부터는 목표창이 다음 종을 알려줍니다. 3/3 공명이면 세 방이 정화되며, 정예방마다 1회 증원이 이어집니다. 보스는 합창 장막에 싸여 받는 피해가 ${BELLFALL_VEIL_PERCENT}% 줄어듭니다. 삼중 조종의 마지막 울림 직후 ${BELLFALL_COUNTER.window}초 동안만 장막이 걷혀 ${BELLFALL_OPEN_TIMES}배 피해가 들어가고, 그 동안 보스는 새 공격을 시작하지 않습니다. 장막에 싸인 보스의 삼중 조종은 기절·경직으로 끊기지 않으니 고리 사이로 피한 뒤 반격하세요. ${ENEMIES.glass_hour_sovereign.tactic}`,
    layout: { spacing: [34, 30], size: [20, 20], width: 7,
      cells: [[0,0],[1,0],[1,-1],[2,-1],[2,0],[2,1],[3,1],[4,1],[5,1]],
      edges: [[0,1],[1,2],[1,4],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]],
      types: ['start','normal','treasure','normal','elite','treasure','normal','elite','boss'] },
    mechanics: { attunement: true, reinforcements: 1 },
    rewards: { gold: 1800, xp: 360, materials: { glass_leaf: 7 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1400, materials: { glass_leaf: 3 } },
  },
  {
    id: 'cinder_tide_lock', depth: 'deep', name: '재의 밀물 · 냉각선 붕괴', unlockCode: '2-10', minLevel: 2,
    energy: 6, chapter: 2, stage: 5, scale: 10.5, bossEnemy: 'cinder_chain_executor', bossHp: 22400,
    description: '밀물에 잠긴 제련 수문에는 끊어진 냉각선과 사슬 집행자의 과열 명령이 남아 있습니다.',
    objective: '정예방 2곳의 증원 각 2회 격파 → 냉각 밸브 3개 순서대로 개방 → 모든 구역 정화 → 쇠사슬의 집행자 처치', bossName: '붕괴한 냉각선의 집행자', art: '/img/encounters/boss_cinder_chain_executor.webp',
    tactic: `1번 상류 → 2번 하류 → 3번 귀환 냉각선의 적을 처치하세요. 정예방마다 2회 증원이 이어집니다. 붉은 과열 띠는 1.4초 예고 뒤 피해를 주며 매 분출 뒤 좌우가 바뀝니다. 반대편 청록 조작판에서 공격하지 않고 2초 유지하면 냉각선이 복구됩니다. 이탈·피격·일시정지는 조작을 중단하며 다시 시도할 수 있습니다. ${ENEMIES.cinder_chain_executor.tactic}`,
    layout: { spacing: [34, 25], size: [24, 17], width: 8,
      cells: [[0,0],[1,0],[2,0],[2,1],[3,1],[4,1],[4,0],[5,0],[6,0]],
      edges: [[0,1],[1,2],[2,3],[2,6],[3,4],[4,5],[5,6],[6,7],[7,8]],
      types: ['start','normal','elite','treasure','normal','elite','treasure','normal','boss'] },
    mechanics: { attunement: false, reinforcements: 2 },
    rewards: { gold: 2050, xp: 410, materials: { ember_core: 7 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1600, materials: { ember_core: 3 } },
  },
  {
    id: 'nightglass_observatory', depth: 'deep', name: '밤유리 관측소 · 역행의 눈', unlockCode: '3-10', minLevel: 3,
    energy: 6, chapter: 3, stage: 5, scale: 12, bossEnemy: 'nightglass_archivist', bossHp: 23600,
    description: '역행하는 관측소에 사라진 좌표의 흔적이 남아 있습니다. 되감긴 기록관의 눈을 닫으세요.',
    objective: '기록 3장 역순 복원 + 보물방 2곳 중심 2초 공명 → 모든 구역 정화 → 기록관 처치', bossName: '역행하는 밤유리 기록관', art: '/img/encounters/boss_nightglass_archivist.webp',
    tactic: `적을 처치한 뒤 기록대 앞 빛 안에서 행동 없이 2초 유지하세요. 귀환 좌표 3번 → 잃어버린 항로 2번 → 출발 좌표 1번 역순입니다. 이탈·공격·회피·피격·일시정지하면 유지 시간이 초기화됩니다. 별도로 보물방 2곳의 적을 처치하고 제단 중심에서 2초 공명하세요. 제단의 공명 순서는 자유입니다. ${ENEMIES.nightglass_archivist.tactic}`,
    layout: { spacing: [27, 32], size: [18, 22], width: 7,
      cells: [[0,0],[0,1],[1,1],[1,2],[0,2],[-1,2],[-1,3],[0,3],[1,3]],
      edges: [[0,1],[1,2],[2,3],[1,4],[4,5],[5,6],[6,7],[7,8]],
      types: ['start','normal','treasure','elite','normal','treasure','normal','elite','boss'] },
    mechanics: { attunement: true, reinforcements: 0 },
    rewards: { gold: 2350, xp: 470, materials: { star_dust: 8 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1900, materials: { star_dust: 3 } },
  },
  {
    id: 'eclipse_hydra_vault', depth: 'deep', name: '일식 수문 · 세 머리의 맹세', unlockCode: '4-10', minLevel: 4,
    energy: 7, chapter: 4, stage: 5, scale: 14, bossEnemy: 'obsidian_hydra', bossHp: 25800,
    description: '일식에 잠긴 검은 수문에서 세 머리의 맹세와 역류의 메아리가 울려 퍼집니다.',
    objective: ECLIPSE_OBJECTIVE, bossName: '일식에 잠긴 흑요 삼두룡', art: '/img/encounters/boss_obsidian_hydra.webp',
    tactic: ECLIPSE_TACTIC,
    layout: { spacing: [31, 29], size: [22, 20], width: 8,
      cells: [[0,0],[1,0],[1,-1],[2,-1],[2,0],[3,0],[3,1],[4,1],[5,1]],
      edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]],
      types: ['start','normal','treasure','normal','elite','treasure','normal','elite','boss'] },
    mechanics: { attunement: false, reinforcements: 2 },
    rewards: { gold: 2700, xp: 540, materials: { glass_leaf: 9 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 2200, materials: { glass_leaf: 3 } },
  },
  {
    id: 'ashforge_catacomb', depth: 'deep', name: '재벼림 제련소 · 심장로', unlockCode: '5-10', minLevel: 3,
    energy: 7, chapter: 2, stage: 7, scale: 16, bossEnemy: 'ash_colossus', bossHp: 27600,
    description: '재벼림 제련소의 심장로에 잿빛 거수의 사슬에 묶인 불씨가 남아 있습니다.',
    objective: ASHFORGE_OBJECTIVE, bossName: '심장로를 삼킨 잿빛 거수', art: '/img/encounters/boss_ash_colossus.webp',
    tactic: `${ASHFORGE_TACTIC}${ENEMIES.ash_colossus.tactic} ${ASHFORGE_CHAIN_TACTIC}`,
    layout: { spacing: [34, 25], size: [24, 17], width: 8,
      cells: [[0,0],[1,0],[2,0],[2,1],[3,1],[3,0],[4,0],[5,0],[6,0]],
      edges: [[0,1],[1,2],[2,3],[2,5],[3,4],[4,6],[5,6],[6,7],[7,8]],
      types: ['start','normal','elite','normal','treasure','elite','treasure','normal','boss'] },
    mechanics: { attunement: false, reinforcements: 2 },
    rewards: { gold: 3000, xp: 600, materials: { ember_core: 10 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 2400, materials: { ember_core: 3 } },
  },
  {
    id: 'astral_leviathan_spire', depth: 'deep', name: '성운 첨탑 · 무너진 성좌', unlockCode: '6-10', minLevel: 4,
    energy: 7, chapter: 3, stage: 7, scale: 18, bossEnemy: 'astral_leviathan', bossHp: 29800,
    description: '무너진 성좌 사이로 귀환 좌표를 삼킨 성운 레비아탄이 떠돕니다.',
    objective: ASTRAL_OBJECTIVE, bossName: '무너진 성좌의 레비아탄', art: '/img/encounters/boss_astral_leviathan.webp',
    tactic: `${ASTRAL_TACTIC}${ENEMIES.astral_leviathan.tactic}`,
    layout: { spacing: [28, 34], size: [18, 24], width: 7,
      cells: [[0,0],[0,1],[1,1],[1,2],[0,2],[-1,2],[-1,3],[0,3],[1,3]],
      edges: [[0,1],[1,2],[2,3],[1,4],[4,5],[5,6],[6,7],[7,8]],
      types: ['start','normal','treasure','normal','elite','treasure','normal','elite','boss'] },
    mechanics: { attunement: true, reinforcements: 1 },
    rewards: { gold: 3350, xp: 670, materials: { star_dust: 11 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 2700, materials: { star_dust: 3 } },
  },
  {
    id: 'verdigris_sanctum', depth: 'deep', name: '녹청 성역 · 뿌리 심장', unlockCode: '6-10', minLevel: 5,
    energy: 7, chapter: 4, stage: 7, scale: 20, bossEnemy: 'verdigris_sentinel', bossHp: 31600,
    description: '뿌리 심장 깊은 곳에서 살아 있는 성역을 깨우고, 녹청 수호자의 오래된 명령을 정화하세요.',
    objective: VERDIGRIS_OBJECTIVE, bossName: '뿌리 심장을 지키는 녹청 거수', art: '/img/encounters/boss_verdigris_sentinel.webp',
    tactic: `${VERDIGRIS_TACTIC}${ENEMIES.verdigris_sentinel.tactic}`,
    layout: { spacing: [30, 28], size: [20, 20], width: 7,
      cells: [[0,0],[1,0],[1,-1],[2,-1],[2,0],[3,0],[3,1],[4,1],[5,1]],
      edges: [[0,1],[1,2],[1,4],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]],
      types: ['start','normal','treasure','normal','elite','treasure','normal','elite','boss'] },
    mechanics: { attunement: true, reinforcements: 2 },
    rewards: { gold: 3700, xp: 740, materials: { glass_leaf: 12 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 3000, materials: { glass_leaf: 3 } },
  },
  {
    id: 'sable_mirage_basin', depth: 'deep', name: '흑사막 분지 · 왕좌의 거울', unlockCode: '5-10', minLevel: 5,
    energy: 7, chapter: 5, stage: 7, scale: 22, bossEnemy: 'sable_mirage_empress', bossHp: 33800,
    description: '흑사막의 가짜 왕좌가 만든 거울 미궁에 환영 여왕이 숨어 있습니다.',
    objective: SABLE_OBJECTIVE, bossName: '왕좌의 거울을 두른 환영 여왕', art: '/img/encounters/boss_sable_mirage_empress.webp',
    tactic: `${SABLE_TACTIC}${ENEMIES.sable_mirage_empress.tactic}`,
    layout: { spacing: [31, 27], size: [22, 18], width: 7,
      cells: [[0,0],[0,1],[1,1],[1,0],[2,0],[2,-1],[3,-1],[4,-1],[4,0]],
      edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[2,6]],
      types: ['start','normal','elite','normal','treasure','elite','normal','treasure','boss'] },
    mechanics: { attunement: false, reinforcements: 2 },
    rewards: { gold: 4000, xp: 800, materials: { star_dust: 13 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 3200, materials: { star_dust: 3 } },
  },
  {
    id: 'comet_bastion', depth: 'deep', name: '혜성 요새 · 궤도 붕괴', unlockCode: '6-10', minLevel: 6,
    energy: 8, chapter: 6, stage: 7, scale: 24, bossEnemy: 'comet_bastion', bossHp: 36400,
    description: '혜성 요새의 무너진 궤도 고리 사이로 기사단장의 맹세가 울려 퍼집니다.',
    objective: '궤도 고리 5곳 정렬·쉼터 연결 → 정예방 2곳의 증원 각 2회 격파 → 모든 구역 정화 → 혜성 기사단장 처치', bossName: '궤도 붕괴를 부르는 혜성 기사단장', art: '/img/encounters/boss_comet_bastion.webp',
    tactic: `각 고리 구역의 적을 처치한 뒤 궤도 위 룬석을 몸으로 밀면 궤도 붕괴 9초가 시작됩니다. 붕괴 전에 룬석을 별 표식에 맞추고 중심 쉼터에 0.5초 머물러 연결하세요. 연결하면 유성 폭풍이 세 번 떨어집니다. 붉은 원 안에서는 청록 빈 원만 안전하니 빈 원을 따라 이동하세요. 시간 안에 연결하지 못하면 그 고리만 처음 위치로 돌아갑니다. 1번·2번·3번·4번·5번 고리는 어느 순서로 연결해도 되며, 정예방마다 2회 증원이 이어집니다. ${COMET_BOSS_COPY} ${ENEMIES.comet_bastion.tactic}`,
    layout: { spacing: [29, 32], size: [20, 24], width: 7,
      cells: [[0,0],[1,0],[1,1],[2,1],[2,0],[3,0],[4,0],[4,-1],[5,-1]],
      edges: [[0,1],[1,2],[1,3],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]],
      types: ['start','normal','treasure','normal','elite','normal','elite','treasure','boss'] },
    mechanics: { attunement: true, reinforcements: 2 },
    rewards: { gold: 4400, xp: 880, materials: { ember_core: 14 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 3500, materials: { ember_core: 3 } },
  },
  // 2026-10-17 컨셉 던전 심층. 해금·에너지·보상은 같은 장의 에너지 6 심층과 같은 대역이다
  // (빙하 = 4장·4-10 잿불금고 심층, 채석장 = 2장·2-10 재의 밀물 심층). 재료는 각 기본 컨셉 던전의 재료를 그대로 쓴다.
  {
    id: 'glacier_tide_basin', depth: 'deep', name: '빙하 조수 분지 · 잠긴 수문', unlockCode: '4-10', minLevel: 2,
    energy: 6, chapter: 4, stage: 5, scale: 14, bossEnemy: 'tidegate_titan', bossHp: 22000,
    description: '썰물이 끝난 밤, 얼어붙은 수문 아래로 다시 조수가 차오릅니다. 다리 어귀와 수문 테라스의 파수대를 넘어 거신을 다시 잠재우세요.',
    objective: '정예방 3곳의 증원 각 1회 격파 → 모든 구역 정화 → 빙하 수문의 거신 처치',
    bossName: '잠긴 수문의 빙하 거신', art: '/img/expansion/glacier_tide_basin.webp',
    tactic: `두 갈래 다리 어귀와 동쪽 수문 테라스의 정예방마다 적과 1회 증원을 격파하세요. 다리 위 조수 예고가 한쪽 절반에 뜨면 반대편 난간 쪽이나 다른 갈래 다리로 비켜서세요. ${ENEMIES.tidegate_titan.tactic}`,
    layout: conceptLayout('glacier_tide_basin', ['start','elite','elite','normal','treasure','normal','elite','boss']),
    mechanics: { attunement: false, reinforcements: 1 },
    rewards: { gold: 2200, xp: 450, materials: { star_dust: 8 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1800, materials: { star_dust: 3 } },
  },
  {
    id: 'sunbrass_quarry', depth: 'deep', name: '석양 황동 채석장 · 끊어진 도르래', unlockCode: '2-10', minLevel: 2,
    energy: 6, chapter: 2, stage: 5, scale: 10.5, bossEnemy: 'pulley_colossus', bossHp: 22400,
    description: '해가 진 뒤에도 끊어진 도르래가 광석 상자를 실어 나릅니다. 하역장과 선반을 지키는 정예를 넘어 거수의 사슬을 끊으세요.',
    objective: '정예방 3곳의 증원 각 1회 격파 → 모든 구역 정화 → 도르래 거수 처치',
    bossName: '끊어진 도르래의 거수', art: '/img/expansion/sunbrass_quarry.webp',
    tactic: `서쪽 하역장·북쪽 우회 선반·동쪽 승강장의 정예방마다 적과 1회 증원을 격파하세요. 도르래 낙석은 원형 예고 자리에 차례로 떨어지니 원 밖으로 비켜서세요. ${ENEMIES.pulley_colossus.tactic}`,
    layout: conceptLayout('sunbrass_quarry', ['start','elite','elite','normal','treasure','elite','boss']),
    mechanics: { attunement: false, reinforcements: 1 },
    rewards: { gold: 2050, xp: 410, materials: { ember_core: 7 }, consumables: { hp_tonic: 1 } },
    firstRewards: { gold: 1600, materials: { ember_core: 3 } },
  },
];

export const expeditionDepth = id => EXPEDITION_DEPTHS.find(d => d.id === id);
export const campaignFinished = progress => Number(progress?.stars?.['6-10']) > 0;
export function depthStage(id) {
  const def = expeditionDepth(id);
  if (!def) throw new RangeError('알 수 없는 심층 원정입니다.');
  return { ...stageDef(def.chapter, def.stage), scale: def.scale, energy: def.energy,
    recPower: Math.floor(2600 * def.scale), dungeon: null, epilogueFinale: false };
}
