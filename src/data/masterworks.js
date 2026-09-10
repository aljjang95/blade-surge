/** Original, bounded build choices. Fractional effects add to base statistics. */
export const BOONS = [
  ['ember_edge','잿불 칼날','ember','공격력 +5%',{atk:.05}],
  ['ember_hunt','불씨 사냥','ember','콤보 마무리 피해 +8%',{finisher:.08}],
  ['ember_feast','잔열 회수','ember','처치 시 최대 체력 0.5% 회복',{healOnKill:.005}],
  ['tide_guard','물결 갑주','tide','정확한 회피 시 최대 체력 1% 회복',{perfectHeal:.01}],
  ['tide_breath','깊은 호흡','tide','최대 체력 +6%',{hp:.06}],
  ['tide_return','돌아오는 물결','tide','처치 시 최대 체력 0.7% 회복',{healOnKill:.007}],
  ['storm_step','번개 걸음','storm','이동 속도 +4%',{speed:.04}],
  ['storm_eye','폭풍의 눈','storm','콤보 마무리가 주변 1명에게 공격력 55% 연쇄 (최대 2명)',{chain:1}],
  ['storm_edge','바람 칼끝','storm','공격력 +4%',{atk:.04}],
  ['stone_root','바위 뿌리','stone','최대 체력 +7%',{hp:.07}],
  ['stone_plate','산맥의 결','stone','균형 파괴력 +12%',{breakPower:.12}],
  ['stone_reserve','광맥 비축','stone','완료 명성 +4%',{rewardMul:.04}],
].map(([id,name,family,description,effects])=>({id,name,family,description,effects,maxRank:3}));

export const SYNERGIES = [
  ['steam',['ember','tide'],'온천 맥동','잿불·물결 각 1종: 처치 회복 +0.5%',{healOnKill:.005}],
  ['wildfire',['ember','storm'],'질주하는 불씨','잿불·폭풍 각 1종: 공격력 +7%',{atk:.07}],
  ['forge',['ember','stone'],'대지의 화로','잿불·바위 각 1종: 방어력 +10%',{def:.1}],
  ['rain',['tide','storm'],'비의 행군','물결·폭풍 각 1종: 재사용 대기시간 -8%',{cooldown:.08}],
  ['spring',['tide','stone'],'바위샘','물결·바위 각 1종: 최대 체력 +10%',{hp:.1}],
  ['thunder',['storm','stone'],'산울림','폭풍·바위 각 1종: 치명타 확률 +4%',{crit:.04}],
].map(([id,families,name,description,effects])=>({id,families,name,description,effects}));

export const MASTERY_NODES = [
  ['assault_1','assault',1,6,'단련한 칼끝',{atk:.02},'공격력 +2%'],
  ['assault_2','assault',2,10,'빈틈 읽기',{crit:.02},'치명타 확률 +2%'],
  ['assault_3','assault',3,16,'끝까지 전진',{atk:.04},'공격력 +4%'],
  ['survival_1','survival',1,6,'기초 체력',{hp:.03},'최대 체력 +3%'],
  ['survival_2','survival',2,10,'견고한 자세',{def:.05},'방어력 +5%'],
  ['survival_3','survival',3,16,'두 번째 호흡',{healOnKill:.003},'처치 시 최대 체력 0.3% 회복'],
  ['insight_1','insight',1,6,'빠른 판단',{speed:.02},'이동 속도 +2%'],
  ['insight_2','insight',2,10,'전리품 감별',{rewardMul:.03},'완료 명성 +3%'],
  ['insight_3','insight',3,16,'전장 통찰',{crit:.02,rewardMul:.03},'치명타 확률 +2%, 완료 명성 +3%'],
].map(([id,path,tier,cost,name,effects,description])=>({id,path,tier,cost,name,effects,description}));

export const PATHS = [
  {id:'balanced',name:'균형',description:'능력 보정 없이 기본 전투에 집중',effects:{}},
  {id:'vanguard',name:'선봉',description:'공격력 +8%, 최대 체력 -5%',effects:{atk:.08,hp:-.05}},
  {id:'hunter',name:'추적자',description:'이동 속도 +8%, 마무리 피해 +8%, 방어력 -5%',effects:{speed:.08,finisher:.08,def:-.05}},
];
export const CHALLENGES = [
  {id:'iron',name:'철의 적',description:'적 체력 +15%, 완료 명성 +10%',effects:{enemyHp:.15,rewardMul:.1}},
  {id:'fury',name:'분노의 적',description:'적 공격력 +12%, 완료 명성 +10%',effects:{enemyAtk:.12,rewardMul:.1}},
  {id:'siege',name:'포위망',description:'적 체력 +10%, 공격력 +8%, 완료 명성 +12%',effects:{enemyHp:.1,enemyAtk:.08,rewardMul:.12}},
];
export const STORY_EVENTS = [
  {id:'lantern',name:'꺼지지 않는 등불',description:'폐허의 길목에서 파수꾼이 마지막 기름병을 들고 있다. 등불은 피난민에게 길을 알려주지만, 당신의 상처를 씻을 약재도 같은 병에 담겨 있다.',choices:[
    {id:'guide',name:'길을 밝힌다',description:'명성 +6. 파수꾼은 당신을 길을 지킨 사람으로 기억한다.',effects:{renown:6},consequence:'파수꾼의 등불이 오늘도 피난길을 밝힌다. 당신의 이름은 그 길과 함께 전해진다.'},
    {id:'mend',name:'약재를 나눈다',description:'체력 30% 회복. 파수꾼과 생존의 약속을 맺는다.',effects:{heal:.3},consequence:'기름병은 비었지만 파수꾼은 살아 돌아오라는 약속을 기억한다.'},
  ]},
  {id:'bridge',name:'다리 아래의 대장장이',description:'부서진 다리 아래에서 대장장이가 남은 못을 센다. 다리를 고치면 마을이 연결되고, 당신의 갑옷을 손보면 다음 싸움을 버티기 쉬워진다.',choices:[
    {id:'rebuild',name:'다리 복구를 돕는다',description:'명성 +8. 끊긴 두 마을에 왕래가 돌아온다.',effects:{renown:8},consequence:'새로 놓인 다리를 건너는 사람들은 당신이 운반한 돌을 밟는다.'},
    {id:'repair',name:'장비를 손본다',description:'체력 40% 회복. 대장장이는 당신의 귀환을 기다린다.',effects:{heal:.4},consequence:'대장장이는 당신이 돌아올 자리만큼 작업대 한쪽을 비워 두었다.'},
  ]},
  {id:'archive',name:'비에 젖은 기록',description:'무너진 기록실에 두 묶음이 남았다. 마을 사람들의 이름과 오래된 응급처치법이다. 무너지는 지붕 아래에서 한 묶음만 먼저 꺼낼 수 있다.',choices:[
    {id:'names',name:'이름을 보존한다',description:'명성 +10. 잊힌 사람들의 기록이 광장에 돌아온다.',effects:{renown:10},consequence:'광장의 기록판에는 잊힐 뻔한 이름들이 다시 새겨져 있다.'},
    {id:'medicine',name:'치료법을 구한다',description:'체력 50% 회복. 다음 세대에 전할 치료법을 남긴다.',effects:{heal:.5},consequence:'구해낸 치료법을 배우는 이들이 기록실 곁에 작은 진료소를 열었다.'},
  ]},
];
export const BOUNTIES = [
  {id:'first_hunt',name:'길목 정리',stat:'kills',target:30,reward:8,description:'적 30마리 처치'},
  {id:'returning',name:'돌아오는 모험가',stat:'clears',target:3,reward:12,description:'전투 3회 승리'},
  {id:'elite_watch',name:'위협을 끊다',stat:'eliteKills',target:5,reward:10,description:'정예 또는 우두머리 5마리 처치'},
];
