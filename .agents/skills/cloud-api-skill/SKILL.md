---
name: cloud-api-skill
description: "클라우드API스킬. ChatGPT Work 클라우드에서 저장소별 ENV·API 시크릿·설치 스크립트·시작 지침·플러그인·MCP를 설정하거나 다른 레포로 재사용할 때 적용한다. 인증 누락 때문에 배포나 오디오 작업이 막힌 클라우드 환경의 셋업도 포함한다. 일반 API 코드 작성만 하는 요청에는 적용하지 않는다."
---

# 클라우드API스킬

저장소의 작업 환경을 실제 Work 설정에 연결하고, 다른 레포에서도 같은 절차를 재사용한다. 키 값은 환경의 보안 저장소에 두고 이 스킬에는 키 이름·목적·연결 방법만 둔다.

## 시작과 완료 기준

1. 현재 실행 표면이 로컬인지 Work 클라우드인지 확인한다. 요청한 repo의 원격 URL, branch, HEAD, 미커밋 변경, 적용 지침과 `work/APEX_SESSION_STATE.md`를 좁게 회수한다. 다른 작업을 전수 조사하거나 새 사이드바 작업을 만들지 않는다.
2. 기존 환경과 설치 스크립트를 먼저 찾는다. 이미 검증된 런타임·잠금 파일·시작 지침·모델/provider를 보존한다. 같은 repo의 환경을 중복 생성하지 않는다.
3. [설정 위치](references/work-settings.md)를 읽고 필요한 칸만 수정한다. [프로필](assets/project-profile.example.json)은 계획 양식이며 Work에 가져오는 설정 파일이 아니다. repo별 공개 정보로 채우고 키 값은 넣지 않는다.
4. 완료를 `PREPARED`, `SAVED`, `PUBLISHED`, `RUNTIME_VERIFIED`, `DEPLOY_VERIFIED`로 구분한다. 저장·게시·새 클라우드 작업의 응답을 각각 확인한다. 확인하지 못한 단계는 근거와 정확한 다음 행동을 남긴다.

## 환경 구성

- 배포 대상은 Cloudflare Workers/Pages와 프로젝트가 쓰는 D1/R2/KV 등으로 맞춘다. GitHub는 소스·PR 기록으로 사용한다. Actions나 다른 호스팅을 새로 활성화하지 않는다. 기존 Modal GPU 작업은 해당 repo 계약을 유지한다.
- ENV에는 `NODE_USE_ENV_PROXY=1`, `WRANGLER_SEND_METRICS=false`처럼 필요한 동작 옵션과 현재 repo의 계정 ID 등 비밀이 아닌 값을 둔다. 오디오 모델 등은 해당 프로젝트의 현재 설정을 따른다.
- API 키가 고정 HTTPS 서비스로 전달되면 해당 서비스의 Network secret을 사용한다. 예: `CLOUDFLARE_API_TOKEN` → `api.cloudflare.com`, 오디오 사용 repo의 `FISH_API_KEY` → `api.fish.audio`. 불필요한 서비스는 추가하지 않는다.
- 로컬 서명/HMAC/S3 서명 등 원문이 필요한 SDK에는 네트워크 프록시의 대체값이 맞지 않는다. 승인된 직접 런타임 시크릿 경로를 별도로 검증한다. 서명용 비밀 값을 파일이나 셸 인자에 쓰지 않는다.
- 여러 repo가 쓰는 개인 키는 사용 가능한 Personal vault에서 선택한 환경에 연결한다. repo별 계정·권한·도메인을 검토하고 전체 환경으로 무조건 확대하지 않는다. 환경 공유는 개인 키 공유의 증거가 아니다.
- 접근은 설치된 커넥터 → 현재 표면의 기본 기능 → 승인된 런타임 보관소 → 기존 CLI/OAuth 순서로 가능한 경로만 사용한다. 로컬에서는 승인된 DPAPI 경로도 쓸 수 있다. 경로가 없으면 `credential-route-unavailable`을 기록하고 비밀 값 대신 필요한 연결/로그인 단계만 안내한다.
- 키 등록은 사용자가 요청한 셋업 범위에서 현재 공식 보안 입력 칸에만 수행한다. 지원 도구가 안전한 비출력 전달을 못하면 그 입력 단계만 남긴다. 일반 작업 중 raw API 값을 채팅으로 다시 요구하지 않는다.
- Runway는 제외한다. 비밀번호 CSV·브라우저 쿠키·사용자 전체 ENV를 클라우드나 저장소로 일괄 이동하지 않는다.

## 설치 및 시작 지침

- 저장소용 스킬은 `.agents/skills/cloud-api-skill/`에 둔다. 개인 로컬 설치만으로 Work 클라우드에 동기화됐다고 주장하지 않는다.
- [시작 지침](assets/start-skill-overlay.md)을 실제 Start skill의 기존 내용을 보존하며 한 번만 넣는다. 관리 시작/끝 표식으로 중복을 확인한다.
- [설치 스크립트 예시](assets/install-script.template.sh)는 Linux의 Node 프로젝트용이다. 기존 설치가 없고 잠금 파일·엔진·도구가 맞을 때만 적용한다. Python/Unity 등 다른 스택은 repo 지침으로 작성한다. 검증된 설치를 이 예시로 교체하거나 최신 버전을 강제하지 않는다.
- 편집 후 실제 Save/Publish 결과를 확인한다. 기존 실행 중 작업의 설치/시작 지침이 재실행된다고 가정하지 않는다. 새 클라우드 작업에서 현재 HEAD와 런타임을 확인한다. 다른 채팅에 메시지를 보내려면 사용자의 명시적 전송 지시가 필요하다.

## 함께 제공하는 도구

### 다른 repo에 설치

Node.js가 있는 로컬 또는 클라우드에서 이 스킬 폴더의 스크립트를 호출한다. 경로 인자는 대상 Git 저장소의 절대 루트로 지정한다.

```sh
node scripts/cloud-api.mjs install --repo /absolute/path/to/repo
node scripts/cloud-api.mjs install --repo /absolute/path/to/repo --apply
```

첫 명령은 미리보기다. 두 번째가 repo 스킬만 복사한다. 동일 설치는 그대로 두고 내용이 다른 기존 설치는 중단한다. 이 명령은 Work ENV·시크릿·플러그인을 자동 등록하지 않는다. 업데이트가 필요하면 기존 스킬을 보존하고 차이를 검토해 별도 패치한다.

### 인증 점검

repo 루트에서 필요한 provider만 선택한다. 기본은 네트워크 호출 없는 변수 존재 점검이다. Node 24 이상에서 프록시 설정을 확인하고 `--live`를 명시해야 실제 GET을 보낸다.

```sh
node .agents/skills/cloud-api-skill/scripts/cloud-api.mjs check --providers cloudflare
node .agents/skills/cloud-api-skill/scripts/cloud-api.mjs check --providers cloudflare,fish --live
```

프로그램은 키 값·길이·해시·응답 본문을 출력하지 않는다. 상세한 범위와 오류 분류는 [인증 및 배포 점검](references/auth-and-deploy.md)에 있다. 읽기 API 성공은 해당 endpoint의 접근 근거이며 전체 배포·오디오 생성 성공은 아니다.

### 배포 및 PC 연결

- [인증 및 배포 점검](references/auth-and-deploy.md): repo 검사, 배포 계정·리소스·인증 방식, 기존 lease/guard, 정확한 SHA, 실제 서비스 확인과 복구.
- [플러그인·MCP·PC 연결](references/connectors-and-pc.md): 현재 표면의 설치와 노출 확인, Remote Desktop Commander의 승인된 PC 호출, 브라우저 로그인과 VPN 범위.
- [결과 기록](assets/setup-receipt.template.md): 비밀 없이 단계별 결과·제한·다음 행동을 남긴다. 상태 파일도 같은 체크포인트로 갱신한다.

## 검증과 결과 전달

구조 검증과 설치/인증 도구 테스트를 수행한 뒤 중요한 변경은 독립 검토한다. live probe는 실제 대상 표면에서 필요한 provider만 실행한다. 배포를 요청받은 경우 준비 검사를 끝내고 프로젝트의 정식 배포 경로로 실행한다. 셋업 자체는 제품을 무조건 배포하라는 요청이 아니다.

최종 응답은 실제 설정·게시·검증된 범위와 남은 제한, 다음 repo에서 호출할 문장으로 짧게 전달한다. `클라우드API스킬로 이 레포의 Work 클라우드 셋업을 해줘`가 기본 호출이다.
