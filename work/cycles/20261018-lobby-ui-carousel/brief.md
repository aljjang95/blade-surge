# 20261018-lobby-ui-carousel — 로비 던전 카드 캐러셀·왼쪽 탭·큰 출격 버튼(설계도 C8)

- 저장소/기준: aljjang95/blade-surge @ origin/main 05d2259 · 2026-10-18T20:10+09:00 · 점유 01a14dc1-2350-7bb2-a023-aaaa355d5947
- 왜 지금: 대표님 2026-10-18 "여러 가지에 대한 맵 그래픽 UI" 시안을 세우고 그대로 개발. 잠긴 설계도 lobby-screen(A10)
- 이번에 하지 않는 것: 로비 팔 자세(대표님 확인 대기), 던전 맵 아트(다음 덩어리), 출격 준비창 내부 흐름 변경
- 설계도: work/blueprint/blueprint.json · 노드 lobby-screen, lobby-hero-idle · 이미지 images/lobby-u2.jpg(목표), images/lobby-before-20261018.jpg(현재)

## 사용자 관찰 결과
- 전: 오른쪽에 추천 던전 카드 하나와 '다른 던전 4/20', '마을 둘러보기' 버튼, 아래 가운데 3탭 바.
- 후: 왼쪽 가장자리 세로 탭(던전·영웅·장비·메뉴), 오른쪽 위 추천 던전 상세(그림·이름·설명·입장 에너지·주요 보상), 오른쪽 아래 넘겨 고르는 던전 카드 줄(그림·이름·에너지), 오른쪽 아래 모서리 큰 원형 금색 '출격' 버튼. 카드를 누르면 상세가 그 던전으로 바뀌고, 출격은 기존 출격 준비창을 그 던전으로 연다. 영웅은 가려지지 않는다.

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | 로비에 왼쪽 세로 탭, 오른쪽 위 추천 던전 상세, 오른쪽 아래 던전 카드 줄과 큰 원형 출격 버튼이 시안 C8처럼 보인다 | 로비 1280x590·844x390·800x360 캡처와 blueprint shot | ui | blueprint A10 |
| A2 | 카드를 탭하면 상세가 그 던전으로 바뀌고 잠긴 던전은 잠금 표시와 해금 조건이 보인다 | 실제 터치 캡처 | ui | blueprint A10 |
| A3 | 큰 출격 버튼을 누르면 선택한 던전으로 기존 출격 준비창이 열리고 그대로 전투에 들어간다 | 실제 터치로 전투 진입 | ui | blueprint A10 |
| A4 | 세 화면 크기에서 영웅 모델이 어떤 로비 UI에도 가려지지 않는다 | 영웅 화면 투영 상자와 UI 상자 겹침 측정 | integration | 대표님 규칙 2026-10-18 UI는 플레이를 가리지 않는다 |
| A5 | 탭 이동(영웅·장비, 메뉴)과 마을 둘러보기 등 기존 기능이 그대로 동작한다 | 실제 터치와 기존 테스트 | ui | docs/selection-first-lobby.md |
| A6 | 정식 호스트에 배포된 버전에서 같은 로비가 보인다 | blade.tllhouse.com version.json과 로비 캡처 | integration | 배포 정책 |

## 계약
- 데이터: src/ui/citadel-command.js가 이미 쓰는 던전 목록·개방 수·추천 던전 모델을 그대로 쓴다. 새 진행 규칙을 만들지 않는다.
- 출격: citadel-command.js의 기존 준비창 열기 함수에 선택 던전을 넘긴다.
- 스타일: 금색 장식 테두리, 남색·양피지 톤. 카드 그림은 기존 던전 썸네일(public/img 등)을 재사용.

## 레인
| lane | 모델·effort | 도구·스킬 | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| ui | anthropic/claude-sonnet-5-5 high | product-design:image-to-code, blueprint-first | integration | index.html, src/ui/*, src/style.css, test | A1·A2·A3·A5, bun run check |
| integration | claude-opus-5-5 | 실측·배포 | integration | tools/*, 병합·배포 | A4·A6 |

## 검증 계획
- 정적: bun run check
- 런타임: 개발 서버 Playwright 모바일 터치 세 화면 크기, 영웅 투영 겹침 측정
- 실기기: 대표님 기기 연결 시

## 배포 계획
- PR → main squash → tools/deploy.mjs --auth=wrangler, 롤백 22bce794
