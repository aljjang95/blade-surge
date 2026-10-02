<!-- cloud-api-skill:v1:start -->
현재 저장소의 `.agents/skills/cloud-api-skill/SKILL.md`를 읽고 해당 repo의 지침·상태·정확한 HEAD를 확인한다. 기존 설치 및 모델/provider를 보존한다.

Cloudflare 배포에 필요한 계정·bindings·정식 명령·guard를 저장소에서 확인한다. 오디오를 쓰는 repo만 Fish 등의 기존 경로를 연결한다. Runway는 추가하지 않는다.

ENV/API 키는 현재 환경의 승인된 보안 저장소/연결된 도구를 사용한다. Network secret은 HTTPS 목적지에서만 대입되는 대체값일 수 있으므로 원문을 출력하거나 파일로 만들지 않는다. 원문 서명에 필요한 SDK는 별도 승인된 직접 런타임 경로를 검증한다. 키가 없으면 필요한 로그인/연결 단계와 정확한 gate만 기록한다.

읽기 인증 점검은 스킬의 `cloud-api.mjs check --providers 필요한목록`을 사용한다. 실제 GET은 `--live`와 Node 24 이상, 프록시 설정을 확인한 뒤 실행한다. 키·응답 본문·전체 ENV·비밀번호 CSV는 로그에 남기지 않는다. 설정 성공과 해당 클라우드 작업의 실제 인증·배포 성공을 구분한다.

필요한 플러그인/MCP가 실제 작업에 노출됐는지 확인한다. 로컬 PC가 필요하면 승인된 Remote Desktop Commander 장치와 repo HEAD를 확인하고 정식 bridge를 사용한다. 다른 채팅에 메시지를 보내거나 새 작업을 만들었다고 가정하지 않는다.

셋업과 검증 결과는 비밀 없는 상태 기록에 남기고 요청된 제품 작업을 이어간다. GitHub Actions 활성화, 배포 guard 우회, 다른 담당자의 변경 덮어쓰기를 하지 않는다.
<!-- cloud-api-skill:v1:end -->
