# 인계: 블레이드 서지 계정·로그인 레인 (2026-10-30 01:40 KST)

## 끝난 것
- #392 머지(8132150) → 운영 배포. 운영 D1 `blade-surge-commerce-production` 0001~0005 적용, Worker 시크릿 SESSION_HMAC.
- #402 머지(구글 대화상자가 첫 시트 뒤에 가려지던 문제 등 #392 Codex 지적).
- **#410 squash 머지(3811240)**: 탈퇴 시 소셜 허브 정리(키·연동·친구·차단·모집·쪽지 삭제, 열린 소켓 4003 종료, 이름 `탈퇴한 모험가`·태그 `x<가입 순번>`, 가입 IP 해시·대표 영웅·명예 기록 주체 해시 비움), 미접속 게스트 보관 크론·복원, 0006 `account_flags`(SCHEMA_VERSION 6), privacy/support 문구.
  - 리뷰: Codex P2×4(보관 경합 재확인, 탈퇴 소켓 종료, 파기 문구, 밀려난 기기 키로 돌아온 보관 계정 초기화) + 교차 리뷰(Sonnet high, P0/P1 없음) P2×4(복원 재시도 공백, 복구 시 last_seen, 탈퇴 시 소셜 식별 정보, 익명 태그 충돌) 반영, 회귀 테스트 포함. 최종 head 09813c3 Codex 코드·보안 리뷰 지적 없음. `bun run check` 6224 pass / 0 fail, build·출격 스모크 통과.
- 운영 D1 0006 적용(2026-10-29 21:53 KST, PC worktree `C:\Work\tasks\blade-deploy-3811240`). 적용 전 Time Travel 북마크 `000000f6-00000000-00005113-394bcdef2907875e0aa99d496b3ab822`. 적용 뒤 `v1_schema.version = 6`.
- 배포: 이 레인의 deploy.mjs는 가드가 "HEAD가 라이브의 후속이 아님"으로 막음(다른 레인이 더 새 main을 먼저 배포). 라이브 `version.json` sha `2dbc711`(dirty=false)이 3811240을 포함한다.
- 테스트 계정 3행 `account_flags.flag='test'` 확인(p_379df1e8…·p_4f795d4a…·p_60a168b7…, 다른 세션이 먼저 표시, 이 레인의 INSERT OR IGNORE는 0행 기록). 삭제 없음.
- 보관본·탈퇴 문서 파기 크론은 #426(0007, 다른 레인)으로 들어감.

## 남은 일
- **복구한 기기의 옛 게스트 허브 신원 잔존**(교차 리뷰 P2, 구조적 한계): 게스트 A로 시작한 기기가 연동 계정 B로 recover한 뒤 B를 탈퇴하면 허브의 그 기기 키→A 매핑과 A의 이름·친구가 남는다. 수정안: 탈퇴 직전 계정의 `account_keys.key_hash`로 허브 `player_keys`를 찾아 함께 삭제·익명화(`/internal/delete` 본문에 `keyHashes`), 테스트 `test/account-followups.test.ts`. 로그인·삭제 변경이라 교차 리뷰 1회. 기록: `docs/ACCOUNT_POLICY.md` 5장.
- 연동 보상 #413(성장·경제 레인 소유, 서버 선행 조건 `not-linked`가 PR 안에 포함됨) — 계정 레인이 따로 붙일 것 없음.
- 탈퇴 제공자 재인증(선택), 카카오/OpenAI 문구는 켤 때 privacy에 추가.
- `bun run check` 로그에 `skill vfx judgment/meteor: impact.mark is not a function` TypeError가 찍힘(테스트는 통과, 전투 VFX 경로) → 전투 VFX 레인에 알림.

## 대표님 대기
- 카카오 Developers 앱 등록(로그인·OIDC, Redirect URI https://blade.tllhouse.com/api/v1/auth/oauth/callback/kakao, REST 키) → wrangler `KAKAO_REST_KEY`만 넣고 배포.
- ChatGPT 로그인: OpenAI 상업 파트너 대기자(interest form) 신청 여부.

## 참고
- PC 배포 스크립트: `C:\Work\tasks\aj-account-deploy-run.ps1`(마이그레이션 apply → 성공 시 deploy.mjs). PowerShell에서 `$ErrorActionPreference='Stop'`이면 git의 stderr 진행 출력에 스크립트가 죽으니 Continue로 둔다.
- PC MCP는 실행 중 프로세스 16개 한도가 있다("16 active sessions maximum"). 막히면 다른 세션 프로세스를 끄지 말고 잠시 뒤 재시도.
- 로컬 E2E 스크립트 방식: `bunx wrangler dev -c <로컬 config> --local` + 로컬 D1 `migrations apply --local` + Playwright(/opt/pw-browsers/chromium). 1-1 클리어는 `app.eco.completeStage(window.__stageDef(1,1),3)`.
