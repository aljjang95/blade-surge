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

## 남은 것

- Tripo 소품 교체(대장간·게시판·허수아비·비석 등 절차적 대체물), NPC 리그·대기 애니메이션.
- 실기기(Android) 터치 확인, 844x390·390x844 에서 창 겹침 실측(이 레인은 단위 테스트와 CSS 기준만 했고 브라우저 촬영은 하지 않았다).
- 안내자 '그곳으로 안내'(경로 표시)는 넣지 않았다. 위치는 문구(서쪽 울타리 훈련장 등)로만 안내한다.
