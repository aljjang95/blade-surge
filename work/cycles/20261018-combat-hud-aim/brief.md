# 20261018-combat-hud-aim — 연속 처치 재배치와 와일드 리프트식 드래그 스킬 조준

- 저장소/기준: aljjang95/blade-surge @ origin/main 6d37e20 · 2026-10-18T16:35+09:00 · 점유 01a14dc1-2350-7bb2-a023-aaaa355d5947 (랄프루프 지휘 채팅이 직접 진행: 새 덩어리 채팅이 workspace-write·on-request 권한으로 만들어짐)
- 왜 지금: 대표님 2026-10-18 실제 플레이 스크린샷으로 지적한 가장 큰 불편(연속 처치 카드가 화면 중앙을 가림)과 반복 요청(와일드 리프트식 조준)
- 이번에 하지 않는 것: 로비 팔 균형, 에셋 라이브러리, 맵 그래픽 개편, 새 스킬
- 환경 개선: 덩어리 채팅이 제한 권한으로 만들어지는 마찰을 첫 메시지 직후 rollout 확인으로 잡았다(절차 확인됨). 이번에는 kill-streak 위치 규칙 4중복을 한 파일로 정리해 다음 HUD 작업의 겹침 조사 비용을 없앤다
- 설계도: work/blueprint/blueprint.json lockedDigest 967ba628fca4 · 노드 battle-hud, kill-streak-pill, skill-aim, aim-input, skill-shape-data, skill-cast

## 사용자 관찰 결과
- 전: 적을 연달아 잡으면 보라색 큰 "연속 처치" 카드가 영웅 바로 위 화면 중앙에 떠 적과 영웅을 가린다. 스킬은 탭하면 바라보는 방향이나 자동 조준으로만 나가 방향을 직접 정할 수 없다.
- 후: 연속 처치는 35 COMBO 배지 옆 작은 알약에 숫자와 단계로 보이고 중앙은 비어 있다. 스킬 버튼을 누른 채 끌면 영웅 발밑 사거리 원과 방향 레인이 보이고, 놓은 방향으로 스킬이 나간다. 짧은 탭은 지금처럼 바로 시전되고, 취소 구역에 놓으면 취소된다.

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | 전투 중 연속 처치가 올라가도 화면 중앙(가로 30~70%, 세로 25~75%)에 카드가 없고 콤보 배지 옆 알약에 숫자와 단계가 보인다 | 개발 서버 실제 전투 1280x590·844x390·800x360 가로 캡처와 요소 위치 측정 | integration | blueprint A1, 대표님 2026-10-18 |
| A2 | 5·10·20 연속 처치 알림이 화면 중앙 전투 영역을 가리지 않는다 | 같은 전투 20연속 이상 캡처와 토스트 위치 측정 | integration | blueprint A2 |
| A3 | 스킬 버튼을 누른 채 끄는 동안 사거리 원과 방향 레인이 보이고 손을 떼면 그 방향으로 스킬이 나간다 | 모바일 터치 에뮬레이션 드래그 캡처와 시전 후 영웅 방향·투사체 방향 측정 | core | blueprint A3, 대표님 2026-10-18 |
| A4 | 스킬 버튼을 짧게 탭하면 지금처럼 바로 시전되고 키보드 1·2·3·R·Q·E와 AUTO도 그대로 동작한다 | 브라우저 터치 탭과 키보드 입력 메트릭 | core | blueprint A4 |
| A5 | 취소 구역에서 손을 떼면 스킬이 나가지 않고 쿨다운과 MP가 그대로다 | 브라우저 터치와 cds·mp 메트릭 전후 | core | blueprint A5 |
| A6 | 직선·부채꼴·지점 스킬의 지면 표시가 실제로 맞는 범위와 같다 | 판정 범위 디버그 오버레이와 표시 비교 캡처, 모양 데이터 단위 테스트 | core | blueprint A6 |
| A7 | 이동 조이스틱을 움직이면서 다른 손가락으로 스킬을 조준할 수 있다 | 두 손가락 터치 에뮬레이션 캡처 | core | blueprint aim-input |
| A8 | 정식 호스트에서 위 변경이 배포된 버전으로 보인다 | 정식 tllhouse.com 호스트 버전 다시 읽기와 전투 화면 | integration | 배포 정책 2026-10-09 |

## 계약
- 입력: Input은 스킬 버튼마다 드래그 상태를 가진다. 탭(이동 < 버튼 반지름 25%, 기본 14px)은 기존 press('skillN'). 드래그 시작 시 this.skillAim = { slot, active:true, sx, sy(화면 오프셋 -1..1), cancel:false }를 갱신하고, 놓을 때 cancel이면 아무것도 queue에 넣지 않고, 아니면 this.aimedCasts에 { slot, x, z (월드 단위벡터, 카메라 yaw 반영, cameraRelativeMove와 같은 규칙), dist01 }를 넣고 press('skillN'). clear()는 조준 상태도 지운다.
- 게임: 스킬 소비 지점에서 Input.takeAim(slot)으로 조준을 꺼내 Player.tryCastSkill(i, aim)에 넘긴다. aim이 있으면 auto여도 autoAim 대신 그 방향으로 yaw를 맞추고(시전 성공 경로에서만) 지점형은 dist01로 목표점을 정한다. aim이 없으면 기존 동작 그대로.
- 모양 데이터: src/game/skill-aim/shapes.js export skillAimShape(skillId) → { kind:'line'|'cone'|'circle'|'self', range, width?, angle?, radius? }. skills.js의 실제 hitRadius/hitArea/투사체 수치에서 가져오고, 같은 상수를 쓰도록 필요하면 skills.js 상수를 export한다. 모든 SKILLS id가 모양을 가진다(테스트).
- 표시: src/game/skill-aim/aim-view.js class SkillAimView(scene) — 재사용 메시 1세트(사거리 링, 직선 레인+화살촉, 부채꼴, 지점 원). update(player, aim, shape)는 위치·회전·scale·visible만 바꾸고 할당하지 않는다. dispose() 제공.
- HUD: index.html에 #skill-aim-cancel(조준 중에만 .on). 드래그 원은 해당 skill-btn 안 .aim-knob. kill-streak 위치 규칙은 src/ui/kill-streak.css 한 곳(다른 css의 kill-streak 위치 규칙 제거).
- 공유 파일 소유: index.html·src/ui/*.css·src/ui/ui.js·battle-base.js 토스트 = integration(지휘), src/engine/input.js·src/game/player.js·src/game/skill-aim/*·스킬 소비 지점·test/skill-aim*.test.ts = core.

## 레인
| lane | 모델·effort | 도구·스킬(tool-routing.md 행) | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| core | gpt-6-astra high | 10x-Team:sde, action-feel-director(조준 표시 느낌) | lanes/aljjang95-blade-surge/20261018-combat-hud-aim/core | 위 core 소유 파일 | A3~A7 단위 테스트와 개발 서버 터치 시험, bun run check 통과, 커밋 |
| integration | claude-opus-5-5 (지휘 직접) | live-look-dev, blueprint-first shot | integration | 위 integration 소유 파일 | A1·A2, 병합·실표면 검증·배포 |

## 검증 계획
- 정적: bun run check (typecheck·test·build)
- 런타임: bun run dev + Playwright 모바일 가로(1280x590, 844x390, 800x360, hasTouch) 실제 전투. 연속 처치는 실제 처치로 20 이상 올린다. 드래그 조준은 CDP 터치 이벤트로 버튼 드래그, 두 손가락 동시.
- 실기기: Galaxy Tab S7+ 터치는 시간이 되면 이번에, 아니면 dod D6 출시 묶음으로.

## 배포 계획
- 경로: PR → main squash → tools/deploy.mjs(기존 wrangler OAuth 또는 vault 경로) 
- 정식 표면 확인: release-config의 정식 호스트 버전·화면
- 롤백: deploy 영수증의 직전 버전으로 wrangler rollback(tools/deploy.mjs 절차)

## 위험
- 입력 경로 회귀(탭 시전, 키보드, 게임패드, AUTO): 기존 테스트와 새 테스트로 묶는다
- 카메라 yaw 반영 오류로 조준 방향이 화면과 다름: 화면 드래그 방향과 시전 후 영웅 방향 각도 차 < 10° 측정
- 다른 HUD 요소(combat-cue, 카메라 세부)와 알약 겹침

## 한도
capacity 미측정(UNKNOWN은 정지 사유 아님), 로컬 레인 1개
