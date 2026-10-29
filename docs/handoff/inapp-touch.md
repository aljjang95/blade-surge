# 인앱 브라우저 조작 품질 인계 (2026-10-30)

레인 `[gogo-chunk:blade-input#inapp]`, 브랜치 `claude/inapp-touch`. 지휘 세션: "팀협업 진행 방안"(session_01WdQ7BZ8wnZNiuZbp6S4HPr).

## 왜
대표님 2026-10-30: Threads 인앱 브라우저에서 웹 게임 조이스틱이 제대로 안 먹는다 → 항시 신경 쓸 것. 블레이드 서지 링크도 SNS 인앱으로 열린다.

## 찾은 원인
1. 전투(`src/engine/input.js`)·로비(`src/engine/hub-controls.js`) 조이스틱이 `window resize`마다 입력을 지웠다. 인앱 브라우저는 드래그 중 앱 바를 접었다 펴며 높이만 바뀌는 resize를 보내므로, 드래그하던 조이스틱·공격 홀드가 끊겼다. 끊긴 뒤에는 손가락을 떼기 전까지 다시 안 잡혔다.
2. `#hud button, #joy`가 `touch-action: manipulation`이라 브라우저가 패닝을 가져갈 수 있었다(pointercancel 발생).
3. 조이스틱이 비활성일 때 영역 안 touchmove를 취소하지 않아 브라우저·앱 제스처로 새었다.
4. WebView는 앱 전환 뒤 제스처 없는 `AudioContext.resume()`을 막을 수 있는데, 다시 켜는 경로가 visibilitychange·pageshow뿐이었다.
5. 게스트(프로필 없음)는 부팅 때마다 `GET /api/social/me`가 401 `no-profile`로 콘솔 오류를 남겼다.

## 고친 것
- resize는 폭이 바뀔 때(회전·창 크기)만 입력을 지운다. 높이만 바뀌면 유지.
- 조이스틱 영역 touchmove는 항상 취소(비패시브). 로비 스틱은 잡고 있을 때만 취소.
- `#hud button, #joy, #joy .joy-base { touch-action: none }`.
- 다음 pointerdown·touchend·keydown에서 `audio.resume()`(켜져 있으면 아무 일도 안 함). QA용 `window.__audioState()`(상태 문자열만).
- tll-social 클라이언트: 새 기기 키 또는 401 no-profile을 받은 키는 표지(`tll-social:<game>:noprofile`)를 남기고 `/me`를 다시 보내지 않는다. 프로필 생성·복구·연동·키 교체 때 표지를 지운다. `me({ force: true })`는 항상 요청한다.

## 하네스 — `bun run qa:inapp`
`tools/qa/inapp-touch.mjs`. dist를 vite preview로 띄우거나 `--origin=https://blade.tllhouse.com`. 인앱 UA(Threads `Barcelona`, Instagram, `KAKAOTALK`, `NAVER(inapp`), 뷰포트 390x700·360x640·844x390, `isMobile`·`hasTouch`, CDP `Input.dispatchTouchEvent`로 실제 입력. `--full`이면 UA 4종 × 뷰포트 3종. 결과는 `work/qa/inapp-<시각>/report.json`과 스크린샷.
판정 항목: 방향·거리, 앱 바 resize 중 유지(전투·로비), 영역 밖 드래그 유지, 조이스틱+공격 홀드+스킬 동시 입력, 떼면 정지, touchcancel 뒤 정지·복구, 페이지 스크롤과 새는 touchmove 0, touch-action none, HUD 겹침 0·visualViewport 안쪽·주인공 투영점 둘레(짧은 변의 22%)에 버튼 없음, 키보드(창 42% 축소) 위에 채팅 입력창, 첫 터치 뒤 소리 running, 401 응답 목록.

## 전후 수치 (로컬 dist, 기본 4조합)
| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| 앱 바 resize 중 전투 조이스틱 유지 | 0/4 | 4/4 |
| 앱 바 resize 중 로비 조이스틱 유지 | 0/4 | 4/4 |
| 영역 밖 드래그·조이스틱+공격 동시 | 0/4 (resize로 끊긴 뒤) | 4/4 |
| 조이스틱 영역에서 새는 touchmove | 4건/조합 | 0 |
| touch-action | manipulation | none |
| HUD 겹침·화면 밖·주인공 가림(버튼) | 0 | 0 |
| 키보드 위 채팅 입력창 | 통과 | 통과(390x700: 입력창 bottom 401 ≤ 보이는 높이 406) |
| 소리 첫 터치 뒤 | 측정 불가(노출 없음) | running 4/4 |

## 남은 것
- **실기기 확인은 대표님 체험 항목**: 갤럭시 Threads 앱에서 blade.tllhouse.com 링크를 열고 전투 1-1에서 조이스틱을 끌면서 공격을 누른 채 위아래로 크게 움직여 보기(앱 바가 접혀도 끊기지 않아야 함). 헤드리스 Chromium은 실제 Threads/Instagram WebView의 네이티브 제스처(스와이프로 닫기 등)를 재현하지 못한다.
- 관찰한 결함(이 레인 범위 밖, 클리어 루프·첫인상 레인 소유): 세로 390x700 전투 시작 때 "네브 · 여섯 번째 증인" 소개 카드가 주인공 위를 덮는다(`work/qa/inapp-after/threads-390x700.png`). 가장자리 띠로 옮겨야 한다.
- 세로 인앱에서는 전체화면·회전 잠금이 안 될 수 있어 '세로로 계속하기'가 주 경로다. 하네스도 그 경로로 진행한다.
