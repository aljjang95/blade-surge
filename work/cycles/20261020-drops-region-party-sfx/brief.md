# 20261020-drops-region-party-sfx — 드랍·지역 진행·파티 원격 타격음·과금 압박 강화

- 저장소/기준: aljjang95/blade-surge @ origin/main b17f0c0 · 2026-10-20T08:20Z · 점유 01a15864-6633-7ec2-9b84-89607196feaf (루프 영웅별-mirelo-효과음등급-과금자동-타겟-평타auto-클리어스킬-vf 3번 덩어리, 지휘 01a15674-a908-7b63-8bfd-ac335363916a)
- 왜 지금: 대표님 원문 "몬스터들을 잡으면 떨어지는 템들 … 유용과 레벨링 … 맵에 따라 대한 이게 플로우들 … 전부 개선", "각자 캐릭터들마다 쓰여지는 효과음들 전부 달리". 지휘 채팅 추가(대표님 결정): 과금 압박 "강하게: SSR 초월까지 약 3~4주, 확정권·패키지 가치를 키움".
- 이번에 하지 않는 것: 실제 결제 SDK, S26 실기기(D10), 커뮤니티(/api/social/*, tll-social)·로비 추천 던전 패널(citadel-command/dungeon-landing).
- 환경 개선: 지난 사이클 마찰 "visible 검사만으로 겹침을 못 잡음" → QA 스크립트에 사각형 겹침 검사(rectOverlap) 공용 함수를 넣어 결과·가방·캠페인 화면에 적용.
- 설계도: 기존 work/blueprint slice 재사용, 레이아웃 방향 변경 없음(작은 수정: 결과 화면 전리품 행 동작 버튼, 캠페인 다음 지역 안내 줄, 상점·소환 단축 일수 문구).

## 사용자 관찰 결과
- 전: 드랍 등급은 장 번호로만 조금 오르고 난이도와 무관하며, 4~6장은 1~3장 재료를 그대로 다시 떨군다. 결과 화면에서 받은 장비를 바로 쓰는 길이 약하다. 지역 권장 레벨과 실제 경험치 곡선이 맞는지 근거가 없다. 파티 게스트는 남의 타격을 모두 같은 slash 소리로 듣는다. 무과금 SR→SSR 초월이 5~6일이라 확정권·패키지 가치가 낮다.
- 후: 지역·난이도·몬스터 종류(일반·정예·보스)에 따라 장비 등급과 재료가 눈에 띄게 다르고, 결과 화면·가방에서 받은 장비를 장착·판매·강화한다. 지역 권장 레벨이 실제 곡선과 맞고 결과·캠페인 화면이 다음 지역·권장 Lv·대표 보상을 보여 준다. 파티 게스트도 공격자 영웅별 타격음을 듣는다. 무과금 하루 30분 SR→SSR이 21~28일이고, 상점·소환 화면이 확정권·패키지로 며칠이 줄어드는지 보여 준다(무료 경로 유지).

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | 드랍 테이블이 지역(장)·난이도·적 계급별로 다르다: 같은 계급에서 장이 오르거나 난이도가 오르면 E 이상 장비 확률과 재료 수량이 단조 증가하고, 4~6장 재료는 1~3장과 수량·종류 조합이 다르며, 실제 데이터 표(장×계급×난이도 기대 가치)에 쓸모없는 드랍(가치 0·중복 행)이 없다 | tools/loot-report.mjs 출력 + 단위 테스트 | econ | D7 |
| A2 | 실제 전투(원정 시작 → 처치 → 결과)에서 받은 장비가 결과 화면에 보이고, 결과·가방 화면에서 그 장비를 실제 탭으로 장착·판매·강화하면 능력치·골드·강화 단계가 바뀌고 새로고침 뒤 유지된다 | 브라우저 844x390·1280x590 실제 전투·탭·새로고침, 겹침 검사 | ui | D7 |
| A3 | 지역별 권장 레벨과 실제 경험치 곡선(첫 클리어+처치 경험치, 하루 30분)을 실제 데이터로 계산해 표로 적고, 다음 장 시작 권장 레벨과 도달 레벨 차가 -3~+1 안이다(벽·너무 쉬운 구간 없음) | tools/progression-estimate.mjs 출력 + 단위 테스트 | econ | D8 |
| A4 | 스테이지를 깨면 결과 화면과 캠페인 화면에 다음 스테이지/지역·권장 Lv·내 레벨 대비 상태·대표 보상이 보이고 실제 탭으로 다음 스테이지로 간다. 장 10스테이지를 깨면 다음 지역이 열리고 그 지역 안내가 보인다 | 브라우저 844x390·1280x590 캠페인 실제 진행(진행도 주입은 구분 표기) | ui | D8 |
| A5 | 파티 게스트가 받는 원격 타격 이벤트에 공격자 영웅이 실리고 게스트가 그 영웅의 타격음(무기별 레이어)을 재생한다. 공격자 정보가 없는 구버전 이벤트는 기존 소리로 안전하게 재생되고 Worker 검증을 통과한다 | 2클라이언트 브라우저 파티 재생 로그 + protocol/worker 단위 테스트 | party | D1c |
| A6 | 무과금 하루 30분(ch1·top 두 전략)에서 SR→SSR 초월이 21~28일이고 SSR→SSSR 누적 일수를 적으며, SSR 확정권 1장·보석/현금 패키지가 각각 며칠을 줄이는지 계산하고 상점·소환 화면 문구에 보인다. 현금 전용 관문 없음, 기존 저장의 보유 영웅·조각·재화는 줄지 않는다 | tools/economy-estimate.mjs 전후 출력 + 단위 테스트 + 브라우저 상점·소환 캡처 | econ+ui | D2c |
| A7 | typecheck·전체 테스트·빌드 통과 후 같은 SHA가 정식 호스트 blade.tllhouse.com에 배포돼 다시 읽히고 파티 Worker 경로가 새 형식을 받는다 | tools/deploy.mjs 영수증·version.json·라이브 스모크 | 통합 | D9 |

## 계약
- 드랍: src/data/loot-tables.js lootTable(chapter, rank, difficulty='story')로 확장(기존 2인자 호출은 story와 같은 결과). drops.js onKill은 현재 스테이지 난이도 id(src/game/difficulty.js DIFFICULTY_ORDER: story·adept·nightmare)를 넘긴다.
- 경제 속도 상수: src/data/economy-pace.js(새 파일, tools/economy-estimate.mjs --emit-pace 로 생성, 테스트가 도구 출력과 일치 검사) export ECONOMY_PACE = { minutesPerDay:30, freeDays:{SSR:n,SSSR:n}, savings:{ ssrTicket:{target,days}, <skuId>:{target,days} } }. UI 문구는 growth-flow.js의 paceLabel(skuOrKey) → string|null 만 읽는다.
- 진행 안내: src/data/region-guide.js(새 파일, ui 레인) nextGuide(progress, heroLevel) → { stage:{ch,st,code,title}, newRegion:boolean, recommendedLevel, levelGap, status:'ready'|'under'|'over', representativeDrops }. 권장 레벨 수치는 loot-tables.js recommendedLevel만 사용(econ 레인 소유).
- 파티: 원격 hit 이벤트에 선택 필드 hero(PARTY_HEROES 중 하나)를 추가. validPartySnapshot events 허용 키에 hero 추가, 없으면 기존과 동일. 게스트는 hero → 무기 매핑(combat-sound-library HERO_BY_WEAPON의 역)으로 audio.hit(kind,{weapon}) 재생.
- 저장 스키마는 바꾸지 않는다. 보유 재화·조각·등급을 깎는 이관 없음. 결제: Economy.paymentAvailable() false 유지.

## 레인
| lane | 모델·effort | 도구·스킬 | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| integration | Opus(지휘) | 통합·QA·배포 | integration | work/cycles, 충돌 해결 | 전 기준 증거 |
| econ | gpt-6.1-sol xhigh | 데이터 모듈 계산(economy-estimate 재사용) | econ | src/data/loot-tables.js, src/game/drops.js, src/data/hero-grades.js, src/data/shop.js, src/data/economy-pace.js, src/data/growth-flow.js, src/data/stages.js(보상·경험치 수치만), tools/economy-estimate.mjs, tools/loot-report.mjs, tools/progression-estimate.mjs, 해당 test | A1·A3·A6 표·테스트 |
| party | anthropic/claude-sonnet-5-5 high | 프로토콜·오디오 | party | src/party/*, worker/party*.ts, src/engine/combat-sound-library.js(매핑 export만), 해당 test, tools/gogo-qa-20261020-party.mjs | A5 로그·테스트 |
| ui | anthropic/claude-sonnet-5-5 high | playwright 실제 터치(gogo-qa-20261020 재사용) | ui | src/data/region-guide.js, src/ui/*, src/main.js(결과 화면 부분), index.html, src/style.css, tools/gogo-qa-20261020-drops.mjs | A2·A4·A6 화면 |
| review | anthropic/claude-sonnet-5-5 high(Sol 작성 경제 코드의 교차 리뷰) + gpt-6.1-sol xhigh(Sonnet 작성 파티 형식) | 교차 리뷰 1회 | 읽기 전용 | 없음 | P0·P1 0 |

## 검증 계획
- 정적: bun run typecheck, bun test --timeout 30000, bun run build
- 런타임: bun run dev(전용 포트) + playwright 844x390·1280x590 hasTouch 실제 탭. 상태 준비(레벨·진행도·재화) 주입은 보고서에 구분. 파티는 2 브라우저 컨텍스트 + 로컬 wrangler dev(DO).
- 실기기: 제외(D10, 마지막 덩어리).

## 배포 계획
- 경로: origin/main fetch·merge → 재검사 → PR squash(main) → deploy worktree → tools/deploy.mjs --auth=wrangler(DEPLOY-blade-surge 잠금) → 정식 호스트 읽기
- 정식 표면 확인: https://blade.tllhouse.com/version.json SHA 일치, 라이브 스모크(상점 단축 문구·파티 Worker 새 형식 수락)
- 롤백: 직전 배포 cf670d84-dc5a-4b5c-b13c-226700aa42e4(버전 b511ebbc-c777-4394-8dc1-6f0b827cdef1, main b17f0c0)

## 위험
- 경제 수치 강화는 진행 중 플레이어의 체감 속도를 낮춤(보유량은 불변). 교차 리뷰 대상.
- 파티 형식: Worker와 정적 자산이 같은 Worker로 동시 배포. 캐시된 구 클라이언트는 hero 없는 이벤트를 보내므로 선택 필드 유지.
- meta.js·index.html은 다른 채팅(로비 추천 던전 패널)과 같은 로비 화면 → 배포 전 origin/main fetch·merge.

## 한도
capacity CONTINUE(gogo-context 2026-10-20T08:19Z, anthropic 주간 61% 사용)

