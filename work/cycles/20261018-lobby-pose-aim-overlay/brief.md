# 20261018-lobby-pose-aim-overlay — 조준 범위 검증, 로비 팔 균형, 재사용 3D 에셋 라이브러리

- 저장소/기준: aljjang95/blade-surge @ origin/main 6e0ba28 · 2026-10-18T19:00+09:00 · 점유 01a14dc1-2350-7bb2-a023-aaaa355d5947 (지휘 채팅 직접 진행: 새 덩어리 채팅 권한 제한)
- 왜 지금: 1차 사이클에서 남은 A6(조준 표시=판정 범위)와 대표님 요청 로비 팔 균형·에셋 라이브러리
- 이번에 하지 않는 것: 맵 그래픽 개편, 새 스킬
- 환경 개선: 긴 검사·QA를 로그 파일+sleep으로 돌리는 방식을 도구 기본으로(1차 마찰)
- 설계도: work/blueprint lockedDigest 967ba628fca4 · 노드 skill-aim, skill-shape-data, lobby-hero-pose, asset-foundry

## 사용자 관찰 결과
- 전: 조준 표시가 실제 맞는 범위와 같은지 확인되지 않음. 로비 영웅 팔이 어색하다는 지적. 에셋 라이브러리는 이름·상태만 있어 다른 게임에서 찾기 어려움.
- 후: 직업별 모든 스킬에서 실제 판정이 조준 표시 안에 들어옴이 측정됨. 로비 영웅 팔 자세가 대표님이 지적한 문제 없이 보임. 라이브러리에서 역할·리그·폴리 수로 찾고 엔진별 가져오기 안내를 받음.

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | 5직업 30개 스킬을 고정 방향으로 조준 시전했을 때 모든 실제 판정 원(hitRadius·hitArea)의 바깥 끝이 조준 표시 경계를 0.6m 넘지 않는다 | 개발 서버 실제 게임 루프 실측(tools/aim-overlay-qa.mjs) | integration | blueprint A6 |
| A2 | 로비에서 대표님이 지적한 영웅의 팔 자세가 좌우 균형 있게 보인다 | 로비 1280x590 직업별 캡처와 뼈 위치 수치(tools/lobby-pose-qa.mjs) | integration | 대표님 2026-10-18, blueprint A7 |
| A3 | 라이브러리에서 역할·리그·폴리 수·태그로 에셋을 찾을 수 있다 | catalog.mjs find 실제 출력과 catalog.json | asset-library | 대표님 2026-10-18, blueprint A8 |
| A4 | 웹·Roblox·Unity 가져오기 안내가 라이브러리에 있다 | G: TLL-Asset-Foundry/USAGE.md 다시 읽기 | asset-library | blueprint A8 |
| A5 | 블레이드 서지 최신 3D 에셋(상위 몸체 교정 GLB 등)이 원본·출처와 함께 보관돼 있다 | G: 보관 폴더와 asset.json 해시 다시 읽기 | asset-library | 3D 에셋 정책 2026-10-13 |
| A6 | Android 실기기에서 드래그 조준과 연속 처치 위치가 터치로 동작한다 | 실기기 터치 캡처 | integration | dod D6 |

## 계약
- 조준 모양: src/game/skill-aim/shapes.js(1차). 판정 측정은 tools/aim-overlay-qa.mjs.
- 로비: src/main.js showcaseHero가 모델 Idle 클립을 재생. 몸체·동작 교정은 src/engine/hero-body-motion.js(클라우드 자가개선루프 소유 영역, 고치기 전 그 채팅과 겹침 확인).
- 라이브러리: ~/.codex/skills/tripo-mixamo-pipeline/scripts/catalog.mjs, G: TLL-Asset-Foundry 루트의 catalog.json·CATALOG.md·USAGE.md.

## 레인
| lane | 모델·effort | 도구·스킬 | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| asset-library | gpt-6-astra high | tripo-mixamo-pipeline | 없음(전역 도구·G:) | catalog.mjs, 카탈로그 파일, 블레이드 서지 보관분 | A3~A5 |
| integration | claude-opus-5-5 | blueprint-first, live-look-dev | integration | tools/*, 로비 자세 | A1, A2, A6 |

## 검증 계획
- 정적: bun run check
- 런타임: aim-overlay-qa, lobby-pose-qa
- 실기기: Galaxy Tab 또는 S26(대표님이 무선 디버깅을 켜면). 안 되면 external_gate

## 배포 계획
- 경로: PR → main squash → tools/deploy.mjs --auth=wrangler (로비 자세 코드가 바뀌면)
- 정식 표면 확인: blade.tllhouse.com version.json, 로비 캡처
- 롤백: 직전 버전 22bce794

## 위험
- 로비 자세 수정이 클라우드 루프의 몸체 교정과 충돌
- 대표님이 지적한 캐릭터가 확인되기 전 잘못된 대상 수정

## 한도
capacity CONTINUE(주간 53%)
