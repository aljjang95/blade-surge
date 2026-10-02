# 플러그인·MCP·로컬 PC

스킬은 작업 절차를 제공한다. 플러그인/MCP는 별도의 설치·인증·실행 경로가 필요하다. 로컬 설정 파일, 환경 게시, PC의 sshd 실행 여부만으로 클라우드 도구 노출을 완료라고 하지 않는다.

## 연결 점검 순서

1. 현재 표면에 설치된 공식 커넥터와 실제 callable tools를 확인한다. 다른 작업의 전체 대화나 파일을 수집하지 않는다.
2. Work가 지원하는 설치/연결 화면에서 필요한 플러그인만 연결한다. 로컬 stdio 경로나 localhost 주소를 클라우드가 접근 가능한 MCP URL로 간주하지 않는다. 토큰을 URL query나 `.mcp.json`에 직접 넣지 않는다.
3. OAuth·보안 저장소 또는 실행 ENV 연결을 해당 도구의 공식 방식으로 구성한다. remote MCP를 새로 공개할 필요가 있으면 인증·TLS·권한·현재 소유권을 먼저 검증한다. 일반 PC 전체 명령 endpoint를 무인증으로 공개하지 않는다.
4. 같은 실제 클라우드 작업에서 최소 읽기 호출로 도구 노출과 권한을 확인한다. 설치, 노출, 인증, 실제 capability 결과를 나눠 기록한다.

## Remote Desktop Commander

이미 승인된 PC와 연결된 플러그인이 있다면 장치 identity/online 상태를 확인한다. PC의 기존 repo·CLI·암호화 보관소를 사용하고 출력은 비밀 없는 요약으로 제한한다. 다른 PC의 ID를 템플릿에 고정하지 않는다.

repo가 제공하는 bridge가 있으면 canonical repo와 정확한 HEAD를 bind한 뒤 doctor 같은 읽기 명령을 실행한다. repo의 정식 배포 wrapper와 인증 방식을 유지한다. OAuth 자격증명 자체를 읽어서 클라우드로 복제하지 않는다.

Fish 등 오디오가 필요하면 현재 `로컬오디오` 스킬 및 실제 설치 경로를 확인한다. PC의 오디오 파일/라이브러리가 Linux 클라우드에도 있다고 가정하지 않는다. 오디오 키 연결 성공은 실제 음성·음악·효과음 산출물 검증을 대신하지 않는다.

## 비밀번호와 브라우저

Chrome 비밀번호 CSV와 로그인 쿠키는 원래 승인된 PC/브라우저 표면에 둔다. 필요 시 실제 사이트와 현재 로그인 상태를 확인하고 공식 로그인/기존 승인 자동로그인 경로를 사용한다. 전체 CSV를 repo·시크릿·Drive 평문으로 업로드하지 않는다. 외부 인증/MFA에 사용자 동작이 필요하면 정확한 단계만 남긴다.

## VPN / SSH

Work의 private network 기능이 실제로 필요할 때만 Tailscale을 검토한다. 현재 공식 지원은 [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments)에서 확인한다. 이 설정을 SSH나 모든 TCP 포트에 대한 연결로 확대 해석하지 않는다. 직접 SSH는 해당 실행 표면의 별도 지원·호스트 인증·네트워크 도달을 확인한 뒤 사용한다. 로컬 VPN/sshd 실행 중은 클라우드 SSH 성공의 증거가 아니다.
