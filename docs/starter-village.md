# 초보자 마을 (첫 마을 리메이크, 2026-10-24)

## 대표님 요청

"초보자 마을에 들어왔구나, 초보자는 어떻게 플레이하면 좋을까" 하는 영역이 오손도손 모여 있는 첫 마을. 안내자 → 훈련장 → 의뢰 게시판 → 대장간·상점 → 출격 포탈 순서로 자연스럽게 걸으며 첫 목표를 익히게 한다. 설계도 노드 `starter-interactions`·`starter-training-yard`·`starter-forge-market`·`starter-portal`, 수용 기준 A52·A53.

## 배치 (`src/data/starter-village.js`, 광장 ±12m)

| 구역 | 좌표 (x, z) | 내용 |
|---|---|---|
| 입구 | (0, 7.6) | 남쪽 입장·출현 (0, 3.6). 안내자 브람 (-2.9, 6.2) |
| 훈련장 | (-7.4, 1.2) 반경 3.1 | 서쪽 울타리, 허수아비 3기, 연습 지점 (-4.7, 1.6) |
| 의뢰 게시판 | (-4.2, -3.2) | 분수 왼쪽 위(북서) |
| 분수·영웅 비석 | (0, -1.4) / (0, -5.6) | 중앙선. 걸어서 돌아가는 길이 열려 있다 |
| 대장간 | (7.6, -1.4) | 대장장이 도르 (5.6, -0.6), 모루·화덕·무기대 |
| 상점가 | (7.2, 5.2) | 상인·교관·결투 안내관·이동석 자리는 `STARTER_SERVICE_PLACES` |
| 출격 포탈 | (0, -9.4) | 북쪽 끝, 양옆에 지역 1 던전 관문 줄 |

## 상호작용 → 연결 시스템

연결 코드는 `src/ui/citadel-hub.js`(`interact` 분기 + `verbs`)와 `src/ui/starter-village-ui.js`(창 · 순수 모델). 창은 citadel-hub 의 기존 `dialog` 를 빌려 쓰므로 닫기 X·돌아가기·ESC·바깥 누르기·초점 복귀는 `CitadelHubUI.close` 한 곳이 맡는다. 열고 닫기는 게임 저장(`eco.s`)과 에너지를 바꾸지 않는다.

| 지점 (kind) | 누르면 | 연결 대상 · 읽는 상태 |
|---|---|---|
| 안내자 브람 (`guide`) | 첫 목표 체크리스트 창(① 훈련장 허수아비 3번 ② 의뢰 게시판 ③ 대장간 ④ 관문 1-1 출격). 다음 단계 강조 + 위치 문구 | 연습 수·게시판·대장간 방문은 진행 기록, ④는 `eco.s.progress.unlocked > 1` 또는 `stars['1-1']`. 마지막 단계에서 '관문 선택' 버튼 |
| 훈련장 (`training`) | 창 없이 즉시: 영웅이 가장 가까운 허수아비를 보고 첫 콤보 공격 클립 1회 → Idle 복귀, 허수아비 흔들림, 타격음. 3번째에 "연습 완료!" 토스트 | `app.showcase`(mixer/clips, `def.combo[0].anim`) · `lobbyHall.userData.starter.strike(position)` · `audio.hit('slash')` · 진행 기록 `practiced` |
| 의뢰 게시판 (`board`) | 의뢰 카드 3장 | ① 관문 1-1 정화 → 관문 선택 화면 (`commandUI.openPreparation`) ② 지금 마을 첫 관문 던전(`regionDungeonState(save).gateIds[0]`) → 기존 원정 준비창 `hubUI.openDestination` ③ 허수아비 3번 치기(진행 표시). 완료 표시는 `progress.stars`·`expedition.stats`·연습 수에서 읽음 |
| 대장장이 도르 (`smith`) | 대화창 + 한 줄 팁, 버튼 '장비 강화' · '룬 소켓' | '장비 강화' → `meta.openTab('heroes')`(영웅·장비 화면의 강화) · '룬 소켓' → `openRuneOverview(meta, eco.s.selected)` |
| 시작 영웅의 비석 (`story`) | 지금 영웅(`eco.s.selected`)의 이름·칭호·역할·소개 | `HEROES[id].name/title` + `HERO_TRAITS[id]`(기존 문구만 사용), 초상 `bindHeroPortrait` |
| 출격 포탈 (`campaign`, id `gate:campaign`) | 관문 선택 화면 | `app.commandUI.openPreparation(trigger)` (docs/stage-select.md). 초보자 마을이 아니면 기존대로 `meta.openTab('stage')` |

## 저장 키

`localStorage['blade-surge.starter-village.v1'] = { practiced: number, boardSeen: boolean, smithVisited: boolean }`

- `normalizeStarterProgress`: 모르는 필드 버림, 음수·NaN·문자열은 기본값, `practiced` 는 0~9999 정수로 자름. 멱등.
- 손상 JSON·저장 공간 차단(getter/setter 예외)은 기본값, 쓰기가 실패하면 이번 세션 사본을 계속 쓴다(`refreshStarterProgress`). docs/stage-select.md 의 기억 키와 같은 방식.
- 게임 저장(`eco.s`) 형식은 바꾸지 않았다. 기기 편의 정보라서 기기 간 동기화는 되지 않는다.

## 2지역 이후 마을과의 관계

`townHub('oathhold')` 는 `activeCampaignTownChapter() === 1` 일 때만 초보자 배치(`hub.starter === true`)를 준다. 2지역 이상은 기존 성채 광장·지역 마을 배치로 돌아가며, 이 레인의 새 kind(`guide`·`training`·`board`·`smith`·`story`)는 그 마을에 존재하지 않는다. 출격 포탈의 관문 선택 연결도 초보자 마을에서만 바뀐다(`activeTownHub().starter`).

## 테스트

- `test/starter-village.test.ts`: 진행 기록 정규화·저장 예외, 체크리스트·의뢰 카드 상태, 비석 문구, 초보자 hub 의 kind 목록과 모든 hotspot 의 도보 도달성(격자 BFS, 실제 `HubMovement._walkable`·경계·반경 0.34, 도달 조건 = 거리 < interactionRadius), 2지역에서 기존 배치 복귀, 연습 1회의 동작·흔들림·카운트·토스트·Idle 복귀.
- `test/town-scenes.test.ts`: 기존 마을 기준(마을마다 arena 관문, 중앙 통로 비움)은 2지역 상태에서 그대로 검증하고, 초보자 마을은 별도 기준(안내관 steward 존재·arena 없음·모든 지점 도보 도달)으로 검증한다. 초보자 마을은 분수·비석이 x=0 에 서 있어 '중앙 통로 비움'이 성립하지 않기 때문이며 기준을 약하게 만든 것이 아니라 대상 배치를 나눈 것이다.
- 공통 도구 `test/helpers/hub-walk.ts`(도보 도달 BFS).

## 운영 반영 (2026-10-25)

- #278 squash `51a4aab` 머지, 운영 blade.tllhouse.com 은 `5e2d037`(#282, #278 포함)로 반영. version.json readback 확인.
- 운영 촬영: `tools/starter-village-shot.mjs https://blade.tllhouse.com/ --vp=1280x720|844x390` 로 안내자·훈련장·대장간·영웅상 시점 촬영, 1지역 새 저장에서 `starter: true`. 프레임당 draw call 약 90~165, 삼각형 약 18만~28만(그림자·후처리 포함, SwiftShader).
- 실제 입력 QA(개발 서버, 같은 코드): 1280x720 키보드·844x390·390x844 터치 모두 여섯 구역 6/6 도달·상호작용, 출격 포탈 → 관문 선택 열림. 터치 QA에서 찾은 막힘(영웅상 옆 길 등불 틈 0.07m, 분수 대각 꽃밭)과 창 글자 대비는 고쳐서 머지했다.
- 리뷰: PC OpenCodex(gpt-6.1-sol) P0/P1 없음, P2 3건(연습 공격 취소·대장간 벽 충돌·포탈 초점 복귀) 반영.

## 남은 것

- **Tripo 소품 장면 연결(2026-10-25, 코드 완료)**: GLB 8종(`public/models/starter-village-v1/`, 정규화 기록은 `docs/starter-village-props.md`)이 `starter-village-scene.js` 의 절차 모델을 바꾼다. 남은 것은 실제 화면 확인(촬영·실제 입력 QA)과 오두막 문(앞면에 문이 없음), 상점 앞 장식 깃발 구멍.
- NPC(안내자·대장장이) 전용 모델·리그: 지금은 KayKit Mage·Barbarian.
- 실기기(Android) 터치 확인.
- 안내자 '그곳으로 안내'(경로 표시)는 넣지 않았다.

## Tripo 소품 교체 결정 (2026-10-25)

- **로딩**: 8종(약 4.1MB)은 `asset-split.json` 에서 remote 묶음 `starter-village`(AAB 60MB 여유 0.49MB라 core 금지). 읽기는 `assets.js` 의 `loadLibraryGltf`(assetUrl 해석기 경유, 바이트 → `parseAsync`, meshopt 디코더) 그대로이고, `src/game/starter-village-props.js` 가 템플릿을 한 번만 받아 나눠 쓴다(실패는 캐시하지 않아 다음 로비에서 재시도). `remote-prefetch` 의 `EARLY_GROUPS`(`early-music` + `starter-village`)가 로비 진입 때 바로 받는다(데이터 절약 모드 제외). 웹 채널은 상대 URL 그대로다.
- **폴백**: 장면은 절차 모델로 먼저 열리고 `arena.adoptStarterProps` 가 GLB 를 받으면 `applyProps` 가 소품별로 GLB 를 세운 뒤에만 그 절차 묶음(`Starter_Fallback_<이름>`)을 숨긴다. 못 받거나 메시가 없는 소품은 절차 모델 그대로다. 허브 장면의 기존 상점 좌판은 `adoptFallback('stall')` 로 같이 숨는다. GLB 지오메트리·텍스처는 템플릿 소유(장면이 해제하지 않음), 재질만 장면이 복제해 소유하고 envMap(.3)을 연결한다. 로비를 다시 지으면 `retire()` 로 늦게 온 결과를 버린다.
- **오두막**: 균등 1.3배(높이 약 5.5m)로 7채를 InstancedMesh 하나로 세운다(지오메트리·재질 공유, draw call 1). 앞면이 광장 쪽 ±13.2에 오도록 `STARTER_COTTAGES`(x/z ±15.9)로 옮겼다(광장 걷기 경계 ±12.2·담 12.55 안쪽은 침범하지 않음). low 품질은 그림자를 끈다.
- **대장간**: 닫힌 건물(4.08×4.8×4.0m) 한 채를 작업장 뒤 (13.1, -2.2), yaw -π/2(앞면이 작업장 쪽)에 세우고 절차 지붕·기둥·뒷벽·굴뚝은 폴백으로 뺐다. 화덕·모루·무기대는 앞에 그대로. 충돌은 기둥 4개 + 뒷벽에서 건물 바닥 사각형(x 11.05~15.15, z -4.3~-0.1) 하나로 바꿨다. 화덕 충돌(x≤10.6)과 .45m 틈이라 걸어서 못 들어간다. 폴백(GLB 없음)일 때는 기둥 충돌이 없다.
- **분수**: 높이 1.74m. 물줄기 y 1.8 → 1.55, 폭 .85배(윗 수반 반경 .66에 맞춤). 폴백일 때는 기존 값.
- **상점 좌판**: 깊이 2.09 → 충돌 x ±1.05(기존 ±.5). 앞면이 상인(6.4, 반경 .42) 뒤에 오도록 좌판 x 7.6 → 8.05. 동쪽(트레이너·결투 안내관 사이)과 걷는 길은 막히지 않는다(도보 도달 BFS 통과).
- **포탈**: 아치 열린 폭 실측 약 2.0m(기둥 안쪽 면 ±1.0, 안쪽 꼭대기 y≈3.4; 브리프의 2.9m는 옛 소용돌이 폭). 소용돌이를 y 1.95, z -0.25, x 폭 .66배로 줄였고 기둥 충돌 원 중심을 ±1.75 → ±1.55 로 모았다. 양옆 화로는 GLB(폭 4.8) 바깥이라 그대로.
- **허수아비·게시판·영웅상**: 기존 자리·yaw 그대로. 허수아비 GLB 는 흔들리는 pivot 안에 들어가 `strike`·`dummyAngles` 동작이 같다.
- draw call(메시 수, 장면 모듈 기준 실측): 이전 14 → GLB 8종 성공 때 보이는 메시 20(폴백 숨김 23개 대신 GLB 10개: 오두막 인스턴싱 1, 대장간·게시판·분수·영웅상·포탈·상점 각 1, 허수아비 3), 순증 +6. 모두 못 받은 폴백 상태는 소품별로 병합을 나눈 탓에 33(+19)까지 늘고, 그림자 패스도 같은 만큼 는다. 숨은 묶음은 렌더하지 않는다.
- 테스트: `test/starter-village-props.test.ts`(GLB 8종 존재·remote 분류·EARLY 묶음·로더 재시도·applyProps 폴백/공유/흔들림/retire).
