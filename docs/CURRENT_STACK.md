# blade-surge — 현재 실행·배포 정본

2026-10-05 소스 점검. 스택 정리 기준은 `11d7a9a58be6480ae480fc185c9297cafc15f33a`이며, 원격 main의 최신 게임 소스 `ccd41255f58c17b105882260a66dfcf3d97beadc`를 no-ff 병합으로 보존했다. 이 추가 변경은 전투·성채 게임 기능이며 아래 인프라/배포 정본은 유지한다.

## 현재 스택

Vite 6 / Three.js WebGL2 / React + R3F 일부 연출 / TypeScript / Cloudflare Workers Static Assets + Workers AI + Durable Objects; 공개 배포 D1 소유 잠금

Worker는 ASSETS·AI·DIALOGUE_BUDGET·PARTIES 바인딩을 사용한다. 동행 생성·협동 상태를 포함하므로 서버 없는 정적 앱이라는 과거 설명은 폐기했다. 배포 컨트롤러는 D1 `apex-rsi`의 DEPLOY 소유 잠금을 공유하고 정확한 HEAD·live version·artifact·rollback·receipt를 검사한다. 토큰 경로는 vault 자식 주입 `apex-vault run cloudflare -- bun run deploy`, 기존 PC OAuth 경로는 명시 `node tools/deploy.mjs --auth=wrangler`다. 불명확한 원격 결과는 같은 HEAD·같은 인증 경로의 `--reconcile`로 확인한다. raw Wrangler upload나 lock steal은 배포 진입점이 아니다. 실제 유료 대화·광고·결제·Android 검증의 기존 범위는 유지한다.

## 최신 제품 계약

`docs/selection-first-lobby.md`에 따라 기본 로비는 콘텐츠 선택 UI이며, 마을 이동은 ‘마을 둘러보기’에서 선택적으로 사용한다. 던전 카드와 물리 포털은 같은 기존 출격 준비·입장·저장·환급·정산 서비스를 사용한다. Studio의 UX 개선 템플릿은 실제 근거를 입력해 다음 작업 지시를 작성하는 로컬 도구다.

`docs/citadel-departure-preparation.md`의 물리 입구 standard/deep 선택·에너지/보상·goal·journal 복귀 계약과 `docs/manual-combo-feedback.md`의 실제 Player 기반 콤보 표시·pause/AUTO/lifecycle·미디어 오류 분류 경계를 이어받는다. 기존 기록의 browser·실기기·공개 배포 한계를 유지하며 과거 검증을 이번 병합 소스의 새 검증으로 재사용하지 않는다.

## 실행과 검증

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun test
bun run build
bun run check
```

## 소스 근거

- `package.json`
- `bun.lock`
- `vite.config.js`
- `worker/index.ts`
- `wrangler.jsonc`
- `tools/deploy.mjs`
- `tools/deploy-guard.mjs`
- `tools/deploy-control.mjs`
- `tools/deploy-wrangler-oauth.mjs`
- `tools/release-config.json`
- `docs/deployment-auth.md`
- `docs/pc-bridge.md`

## 시작 원칙과 검증 범위

현재 checkout의 HEAD/branch/dirty 상태를 먼저 확인한다. 설치는 committed lock을 사용하며 기존 diff·제품 데이터·다른 작업을 보존한다. 현재 package scripts·진입점·Cloudflare 설정이 실행 근거다. 아래 공개 배포 명령은 셋업 smoke가 아니며 현재 제품별 승인·검증·정확한 source/HEAD gate를 모두 유지한다.

시크릿/ENV 연결은 기존 로컬 담당을 유지한다. 키 값·생성된 환경 설정·PC vault/DPAPI 원문은 읽거나 출력·복사하지 않는다. 로컬 빌드·dry-run·fixture는 실제 API 인증·운영 배포·결제/광고/스토어 승인·고객 품질 증거와 구분한다. 미확인 provider/상품·다른 기기의 고정 경로를 새로운 시작 의존성으로 만들지 않는다.
