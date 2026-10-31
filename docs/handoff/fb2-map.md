# 인계 — 지도·던전 동선 (fb2-map, 2026-10-30)

## 끝난 것
- PR #451 머지(e0a8367) → 운영 배포 readback `blade.tllhouse.com/version.json` sha=e0a8367·dirty=false(배포 f102e41a, 버전 985be3c3, 06:02Z). 운영 번들에 동선 코드(`bs.dungeonRoute.v1`) 포함 확인.
- 설계·측정·검증: `docs/DUNGEON_ROUTE.md`. Codex 리뷰 3회(지적 4건 모두 수정, 마지막 무지적), 보안 리뷰 무지적.

## 확인 못 한 것
- 운영 호스트 화면 캡처: `node tools/route-compare.mjs --only screens --origin https://blade.tllhouse.com/`가 로비 대기(`window.app` 미노출)에서 시간 초과. 같은 SHA 로컬 빌드 캡처(4개 화면 크기, 겹침 0)로 대신했다. 운영 화면 캡처는 운영 빌드에 QA 훅이 있는 다른 하네스(qa:inapp)로 확장하거나 대표님 체험으로 본다.
- 실측 1-1 전부 사냥 2회 중 1회 시간·처치가 달랐다(192.9/201.3초) — 원인 미확인.
- 390x844 측정에서 지도 버튼 첫 탭이 한 번 안 열림(마우스는 열림). 인앱 QA 4종은 통과. 실기기 확인 필요.

## 다음 후보
- 운영 직행 비율 측정(이벤트 `funnel-events`에 동선 기록) → 30% 넘으면 직행 판 관문 기본 골드 재검토(문서 기준).
- 무한의 성·원정에 같은 동선을 넓힐지(지금은 전부 정화 유지).
