# 인계: 블레이드 서지 계정·로그인 레인 (2026-10-29 14:50 KST)

## 끝난 것
- #392 머지(8132150) → 운영 배포(deploy.mjs version-verified, versionId 29e8106e…, rollback 405fbe41…), version.json 8132150 dirty=false.
- 운영 D1 `blade-surge-commerce-production` 0001~0005 적용(v5). 직전 Time Travel 북마크 `000000d3-00000000-00005113-bc740526d7d0748cef9862d5e017163e`. Worker 시크릿 SESSION_HMAC 생성.
- 운영 실제 호출: /iap/intent·verify 503 billing-disabled, /iap/web/* 503 web-billing-disabled, /me 플래그 iap·webBilling false. 탈퇴 → token-revoked.
- 운영 실브라우저(390·1280): 첫 시트(Google·게스트) → 게스트 지연 생성 → 1-1 뒤 그림자 계정 → 새로고침 복원.

## 진행 중(최우선)
- **PR #402** `claude/account-login-fixes`(head 54caf79): #392 Codex 지적 P1×3·P2×1 + 2차 P2×2 수정. **운영 영향: 첫 화면 구글 대화상자가 시트 뒤에 가려짐 → #402 배포로 해결.** Codex 2차 리뷰 결과 확인 → 지적 없으면 머지 → PC 깨끗한 worktree(origin/main 최신)에서 `node tools/deploy.mjs --auth=wrangler` → version.json readback → 브라우저 확인(390, Google 버튼 누르면 대화상자가 위에 보이는지; GSI는 스텁 가능).
- **PR #410** `claude/account-followups`: 탈퇴 시 소셜 허브 정리, 미접속 게스트 보관 크론·복원, 0006 account_flags(SCHEMA_VERSION 6), privacy/support 문구. Codex 리뷰 대기. **배포 전 운영 D1에 0006 먼저 적용**(북마크 기록 → `wrangler d1 migrations apply blade-surge-commerce-production --remote`), 그다음 배포. 배포 뒤 테스트 계정 3행 표시:
  `INSERT OR IGNORE INTO account_flags(account_id, flag, at, note) VALUES ('p_379df1e8ce848fe75f0e44e0','test',<now>,'운영 결제꺼짐 확인'),('p_4f795d4a844b43af7a4d8f79','test',<now>,'운영 E2E 390'),('p_60a168b70a77bef40be4cef1','test',<now>,'운영 E2E 1280')` (삭제 금지, 탈퇴 시험 계정 1개는 이미 deleting).
- 머지 순서: #402 → #410(main 합친 뒤 bun run check).

## 남은 일
- 연동 보상: 성장·경제 레인 합의 = 무료 보석 300, 계정당 1회. 구현 명세를 그 레인(session_01H8mx3TeJYskLe6WcYcWaAt)에 전달함(저장 필드+공용 명령+서버 "연동 있음" 선행 조건). 서버 선행 조건(cmd.ts)이 필요하면 계정 레인이 붙인다.
- 보관본(idle 1년)·탈퇴 문서(30일) 파기 작업: 영구 삭제라 대표님 결정 필요(privacy 문구는 기간을 이미 적음).
- 탈퇴 제공자 재인증(선택), 카카오/OpenAI 문구는 켤 때 privacy에 추가.

## 대표님 대기
- 카카오 Developers 앱 등록(로그인·OIDC, Redirect URI https://blade.tllhouse.com/api/v1/auth/oauth/callback/kakao, REST 키) → wrangler `KAKAO_REST_KEY`만 넣고 배포.
- ChatGPT 로그인: OpenAI 상업 파트너 대기자(interest form) 신청 여부.

## 참고
- 셰이더 회귀("Shader program did not link")는 최신 main에서 생김 → 첫인상 레인이 bisect.
- 로컬 E2E 스크립트 방식: `bunx wrangler dev -c <로컬 config> --local` + 로컬 D1 `migrations apply --local` + Playwright(/opt/pw-browsers/chromium). 1-1 클리어는 `app.eco.completeStage(window.__stageDef(1,1),3)`.
