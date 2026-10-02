# 인증 점검과 배포 준비

## 읽기 점검

`cloud-api.mjs check`는 자동 `.env` 탐색/로딩, DPAPI 복호화, 브라우저 비밀번호 읽기, 키 검색을 수행하지 않는다. 호출한 프로세스에 승인된 방식으로 전달된 변수만 사용한다. 기본은 존재 여부 점검이고 `--live`가 고정 HTTPS GET을 허용한다.

| Provider | 변수 | 고정 읽기 호출 | 증명하는 범위 |
| --- | --- | --- | --- |
| Cloudflare | CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN | /client/v4/accounts/{account_id}/workers/scripts | 그 계정의 Worker 목록 접근 |
| Fish Audio | FISH_API_KEY | /model?page_size=1&self=true | 인증된 현재 workspace의 모델 목록 접근 |

Cloudflare account ID는 비밀이 아니지만 다른 repo의 값을 그대로 사용하지 않는다. 스크립트는 32자리 hex ID만 받는다. 필요한 변수 누락은 기본 점검에서 MISSING으로 표시하고 live에서는 API 요청 없이 INCONCLUSIVE로 남긴다. 키가 존재하는 대체값도 유효한 토큰이라는 증거는 아니다.

상태를 HTTP 코드와 PASS/FAIL/INCONCLUSIVE로만 출력한다. 원문 응답·키·요청 헤더·예외 문자열을 로그에 남기지 않는다. 요청은 timeout과 redirect 거부를 적용한다. 인증 점검은 음성 생성, 업로드, 배포, 과금 발생 여부를 시험하는 요청을 하지 않는다.

200은 고정 읽기 endpoint의 결과다. 401/403은 해당 인증/권한/네트워크 설정을 확인한다. 429/5xx와 연결 실패는 인증 유효성을 확정하지 못한다. 필요하면 현재 클라우드 네트워크와 프록시 설정을 먼저 고친다. 같은 실패를 근거 변화 없이 반복하거나 provider를 바꾸지 않는다.

Node live probe는 24 이상을 사용하며 동적 프록시 적용에는 24.14 이상이 필요하다. Work에서 NODE_USE_ENV_PROXY=1을 지정하고 현재 프록시 ENV가 실제로 전달되는지 확인한다. 이 값이나 로컬 GET 성공만으로 새 Work 환경의 시크릿 대입을 완료라고 판단하지 않는다. Node 이외 도구도 해당 도구가 플랫폼 프록시를 지원하는지 확인한다. 현재 지원 근거는 [Node HTTP 문서](https://nodejs.org/docs/latest-v24.x/api/http.html#httpsetglobalproxyfromenvproxyenv)에서 확인한다.

공식 endpoint: [Cloudflare List Worker Scripts](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/), [Fish List Models](https://docs.fish.audio/api-reference/endpoint/model/list-models). Worker 읽기 권한과 쓰기 권한은 다르므로 필요 권한은 현재 배포 명령의 실제 호출로 정한다.

## 배포 점검

1. canonical remote, 원하는 ref, 정확한 SHA, dirty 상태와 작성자 소유권을 확인한다. repo의 공식 check/build를 실행한다. 해당 변경과 무관한 전체 검사 반복은 피한다.
2. wrangler 설정의 프로젝트명·계정·bindings·운영 환경·라우트를 확인한다. 필요한 권한만 현재 리소스에 적용한다. 모든 계정/zone의 포괄 토큰을 기본값으로 쓰지 않는다.
3. 직접 API 토큰과 기존 Wrangler OAuth 중 프로젝트가 지원하는 한 경로를 선택한다. `--auth=wrangler` 같은 repo 고유 옵션은 소스를 확인한다. 토큰 ENV가 OAuth를 덮어쓰는 충돌을 확인한다. 이 스킬은 repo마다 있다고 가정한 deploy wrapper를 생성하지 않는다.
4. 기존 배포 lease/lock/정확한 HEAD guard/영수증을 유지한다. 인증이 준비돼도 lease 강탈, guard 우회, 자동 PR 병합을 하지 않는다.
5. 배포 요청 범위일 때만 정식 명령을 실행하고 deployment ID·SHA·실제 URL을 기록한다. 실제 서비스의 핵심 흐름을 확인한다. CLI exit 0만으로 고객 기능 완료라고 하지 않는다.
6. 이전 deployment 또는 repo의 정식 rollback 경로를 비밀 없이 기록한다. 인증 미비는 외부 gate로 남기고 독립적으로 가능한 빌드·수정·문서화는 계속한다.

## 다음 repo에 유용한 선택 항목

- **GitHub 연결**: 소스/ref와 PR 기록용. 기존 GitHub 커넥터/설치된 gh 인증을 먼저 사용하고 PAT를 기본 필수 키로 추가하지 않는다. Actions 활성화는 하지 않는다.
- **D1/R2/KV**: 해당 repo bindings가 실제 있을 때만 권한·리소스 ID를 프로필에 추가한다. R2 S3 방식은 로컬 서명에 실제 시크릿 바이트가 필요하므로 네트워크 시크릿 대체값으로 해결한다고 가정하지 않는다.
- **Modal**: 이미 GPU/render를 쓰는 repo만 기존 경로를 유지한다. 현재 CLI/OAuth 또는 승인된 런타임 시크릿을 확인하고 Cloudflare 서비스와 SHA를 맞춘다.
- **Sentry 등 관측 도구**: 이미 사용 중이거나 오류 관측이 필요한 repo에서 실제 커넥터·권한·비용을 확인한 뒤 추가한다. 기본 번들 설치나 계정 생성은 하지 않는다.

위 항목은 선택 기준과 셋업 절차이며 연결 완료 목록이 아니다.
