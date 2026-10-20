# 20261018-starlight-library-art — 별빛 서고 던전 맵 아트(시안 C9)와 빠진 확장 던전 그림

- 저장소/기준: aljjang95/blade-surge @ origin/main 647a182 · 2026-10-18T20:40+09:00 · 점유 01a14dc1-2350-7bb2-a023-aaaa355d5947
- 왜 지금: 대표님 2026-10-18 "여러 가지에 대한 맵 그래픽 UI" — 시안을 세우고 그대로 개발. 3차 사이클에서 확장 던전 그림 5장 누락 발견
- 이번에 하지 않는 것: 다른 지역 맵 아트(C10·C11은 후보로 보관), 로비 팔 자세, 상단 재화 바
- 설계도: work/blueprint · 노드 star-archive-room(C9, images/star-s1.jpg), dungeon-map-art

## 사용자 관찰 결과
- 전: 별빛 서고는 파란 돌바닥과 단순한 상자형 책장. 확장 던전 5곳은 카드·상세에 그림 없이 색만.
- 후: 별빛 서고 전투 방이 흰 대리석 바닥·금 별 나침반·빛나는 크리스털 책장·크리스털 무리·금 혼천의로 보이고, 적·영웅이 또렷하다. 확장 던전 5곳 카드에 그림이 보인다.

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | 별빛 서고 전투 방 바닥이 흰·옅은 파랑 대리석 타일과 금 줄눈이고 전투 공간 중앙 아래 금 별 나침반이 보인다 | 실제 로비→출격→전투 캡처 1280x590·844x390 | art | blueprint A11 |
| A2 | 양쪽 벽에 빛나는 청색 크리스털 책장, 모서리에 크리스털 무리, 뒤쪽 위에 금 혼천의가 보이고 전투 중앙은 비어 있다 | 같은 캡처와 blueprint shot 비교 | art | blueprint A11 |
| A3 | 적과 영웅이 새 바닥과 대비되어 또렷하다(밝은 바닥에서도 실루엣·발밑 원이 보임) | 같은 캡처 | art | blueprint A11 |
| A4 | 프레임이 기존(1280x590 p95 27.1ms, 844x390 21.4ms)보다 25% 넘게 나빠지지 않는다 | tools/region-capture-qa.mjs 프레임 측정 | art | AGENTS 프레임 할당 계약 |
| A5 | 다른 지역(frost 테마를 쓰는 다른 던전 포함)의 모습은 의도치 않게 바뀌지 않는다 | 다른 frost 던전 캡처 비교 | art | 회귀 방지 |
| A6 | 확장 던전 5곳(뿌리잠식 동굴·슬래그워터 제련소·불씨항 건선거·오로라 빙정호·왕관붕괴 빙하) 카드와 상세에 그림이 보인다 | 로비 카드 캡처 | integration | 3차 사이클 frictions |
| A7 | 새 텍스처·그림이 TLL-Asset-Foundry에 출처와 함께 보관된다 | G: 보관 폴더와 catalog find | integration | 3D 에셋 정책 |
| A8 | 정식 호스트에 배포된 버전에서 같은 화면이 보인다 | blade.tllhouse.com version.json과 캡처 | integration | 배포 정책 |

## 계약
- 테마 분기: 별빛 서고(dungeon id star_archive)만 새 외형. 같은 frost 테마의 다른 던전은 그대로(던전 id 또는 새 테마 키로 분기).
- 자산: public/textures/star-archive/{floor-marble,rosette,crystal-books,crystal-cluster}.webp (이미 커밋됨). 새 렌더 오브젝트는 병합·인스턴싱, 프레임 루프 할당 없음.
- 원화: public/img/expansion/*.webp 5장(이미 커밋됨).

## 레인
| lane | 모델·effort | 도구·스킬 | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| art | gpt-6-astra high | game-vfx-forge, live-look-dev, blueprint-first | integration | src/game/region-architecture.js, src/game/arena.js, src/game/world.js, src/engine/*(텍스처 로더만), test | A1~A5, bun run check |
| integration | claude-opus-5-5 | 캡처·보관·배포 | integration | tools/*, 병합·배포 | A6~A8 |

## 배포 계획
- PR → main squash → tools/deploy.mjs --auth=wrangler, 롤백 38010510
