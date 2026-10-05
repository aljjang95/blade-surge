# Blade Surge — 현재 작업 계약

정본은 Vite + Three.js/WebGL2 게임과 Cloudflare Workers Static Assets·`/api/companion` Worker다. 현재 코드에는 React/R3F 연출도 포함된다. 서버 없는 정적 게임으로 축소하지 않는다.

`PRD.md`, `RSI.md`, `LESSONS.md`, `_autopipe/release-goal.md`와 변경 영역의 최신 제품·아트·전투 계약을 이어받는다. 기존 직업·성장·저장·미디어와 사용자 외형 교정을 유지하며, 과거 아트 버전을 현행 렌더러로 되돌리지 않는다.

## 개발과 검증

- `bun install --frozen-lockfile`, `bun run dev`, `bun run check`가 정본이다. 게임의 `app.step(dt, render)` 결정성과 프레임 루프의 할당 제한을 보존한다. 새 렌더 오브젝트는 인스턴싱/병합하며 자산의 논리 애니메이션 키를 쓴다.
- TypeScript·단위 테스트·빌드와 실제 browser/metrics·모바일 입력을 변경 범위에 맞게 검증한다. viewport QA를 실제 Android/GPU/터치/발열 검증으로 보고하지 않는다.
- 주석·커밋 메시지는 한국어, 식별자는 영어, 기존 세미콜론·2스페이스·작은따옴표를 따른다.
- CC0 또는 자체 생성 자산만 사용한다. KayKit·Quaternius·Kenney 출처와 음성 정체성·원본 파일을 보존한다. 모델 계약 테스트는 독점 자산 승인이나 실기기 품질 증거가 아니다.

## 배포와 자격증명

`tools/deploy.mjs`가 유일한 공개 배포 컨트롤러다. `tools/release-config.json`, D1 `apex-rsi`의 `DEPLOY-blade-surge` 소유 잠금, 정확한 HEAD·artifact·rollback·영수증 검사를 보존한다. 설치된 vault 자식 주입의 `apex-vault run cloudflare -- bun run deploy` 또는 기존 PC Wrangler OAuth의 명시 `--auth=wrangler` 경로만 따른다. [인증 계약](docs/deployment-auth.md)과 [PC bridge](docs/pc-bridge.md)를 읽는다.

원격 결과가 불명확하면 잠금을 유지하고 같은 HEAD·선택 인증 경로의 `--reconcile`로 버전·배포·소유 태그를 확인한다. 잠금 탈취, raw Wrangler 우회, 자동 인증 fallback은 지원하지 않는다. PC profile·DPAPI·키를 cloud로 추출하지 않는다. 현행 Git 인증과 create-only branch/PR 전송을 사용한다.

생성형 동행 대화는 기본 비활성이며 기간·총량·비용 승인과 서버 한도를 유지한다. 실제 결제·광고 SDK/영수증 검증 전에는 성공 표시나 보상 지급을 만들지 않는다.

## 세션 시작과 작업 보존

현재 체크아웃의 `git status --short`, HEAD, branch를 확인하고 기존 변경과 다른 작업 소유권을 보존한다. 준비된 체크아웃을 다시 clone하거나 reset/pull/rebase/worktree로 덮어쓰지 않는다. 시작 순서는 이 파일 → `docs/CURRENT_STACK.md` → 변경 영역의 최신 제품 계약이다. 배포면과 명령은 현재 소스·설정·package scripts를 기준으로 판단한다. 다른 제품의 과거 인프라 기록을 이 저장소의 실행 조건으로 끌어오지 않는다.

시크릿·환경변수 등록은 기존 로컬 담당 작업을 유지한다. 키·토큰·쿠키·계정 값은 읽거나 출력·복사·Git 저장하지 않는다. 생성물과 환경 파일을 지침 확인 대상으로 읽지 않는다. 클라우드 셋업·문서 정리는 운영 배포, 결제/광고 활성화, 유료 생성, SNS 게시 승인으로 확대하지 않는다. 기존 제품별 승인과 비용·사용자 저장·기기 검증 계약은 유지한다.
