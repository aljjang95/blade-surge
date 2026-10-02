# Work 설정 위치

| 영역 | 넣는 내용 | 재사용 시 확인 |
| --- | --- | --- |
| Repository | canonical repo와 원하는 ref | 다른 repo의 계정·D1·도메인을 이어받지 않기 |
| Environment variables | 프로그램이 직접 읽는 설정 | 키 값이 필요한 경우 보안 전달 경로 별도 확인 |
| Network secrets | 키 이름, 보안 값, 정확한 HTTPS 목적지 | CF는 api.cloudflare.com, Fish는 api.fish.audio |
| Personal vault | 선택 환경의 개인 변수/시크릿 연결 | 해당 repo가 실제로 필요로 하는 키만 연결 |
| Install script | repo에 맞는 고정 도구·잠금 설치 | 기존에 검증된 설정 보존 |
| Start skill | 작업 시작 시 읽는 프로젝트/인증 지침 | assets의 관리 표식 구간은 한 번만 추가 |
| Plugins / MCP | 현재 계정/작업에 실제 연결된 도구 | 환경 파일 작성과 클라우드 도구 노출을 별도 검증 |
| Network / private access | 필요한 목적지, 선택적 VPN | VPN 필요와 프로토콜 범위 확인 |

Network secret은 환경 내부에 대체값을 제공하고 허용한 HTTPS 요청에서 프록시가 원문을 대입한다. 코드가 원문 자체를 읽어야 한다면 직접 런타임 저장 경로가 필요하다. 개인 시크릿 연결과 환경의 네트워크 도메인 허용도 각각 확인한다.

환경 편집을 저장하고 Publish 결과를 확인한 다음 새 작업에서 검사한다. 로컬 개인 스킬은 클라우드로 자동 이행되지 않으므로 저장소 스킬을 버전 관리한다. 기존 작업이 새 설치 스크립트를 다시 실행했다고 가정하지 않는다.

설정 UI/커넥터의 실제 항목을 먼저 확인한다. 이 번들의 JSON은 작업자가 채우는 계획 양식이며 공식 import API 형식이 아니다. 현재 도구에 없는 자동 등록 기능을 주장하지 않는다.

공식 자료 확인: [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments), [Build skills](https://learn.chatgpt.com/docs/build-skills). 확인일 2026-10-02; UI나 지원 경로가 달라졌으면 최신 공식 자료와 실제 표면을 다시 확인한다.
