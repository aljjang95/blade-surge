# 현재 Windows 셋업 — 2026-10-08 KST

정본은 `aljjang95/blade-surge`, 이번 시작 HEAD는
`1d4522d1890b1f8c399e8e58608e5de737823dff`다. 기존 게임 구현과 Bun lockfile을 유지했다.
이 문서는 로컬 셋업 증거이며 전체 APEX 활성화·운영 배포·실기기 승인 영수증이 아니다.

## 바로 실행

현재 프로젝트 루트에서 실행한다. launcher는 정본 origin과 packageManager의 Bun 버전을 검사한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-setup.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-setup.ps1 install
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-setup.ps1 browser
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-setup.ps1 check
powershell -NoProfile -ExecutionPolicy Bypass -File tools/local-setup.ps1 dev
```

`dev`와 `preview`는 현재 터미널에서 실행하며 Ctrl+C로 종료한다. 고정 포트 충돌 시 다른 서버를 종료하거나
포트를 자동 변경하지 않고 실패한다. `build`는 게임 정본의 build script,
`doctor`는 정확한 HEAD에 결박한 기존 PC bridge의 read-only Wrangler 진단이다.
doctor 실패 후 자동 인증 전환이나 배포는 하지 않는다.

## 설치·실행 확인

- Bun 1.4.2, Node 24.19.0, Git 2.55.0.windows.5. committed `bun.lock` 그대로 175개 패키지 설치.
- Playwright의 Chromium 1234와 보조 실행 파일을 `C:/Work/cache/playwright`에 설치.
  launcher가 이 경로를 지정한다. Bun의 재생성 가능한 캐시는 `C:/Work/cache/bun`이다.
- TypeScript 검사와 Vite production build 통과. 큰 JS chunk 및 static/dynamic import 경고는 남아 있다.
- 격리 Chromium/SwiftShader에서 desktop 1280×720과 가로 viewport 844×390의 부트 화면,
  100% 로딩, WebGL renderer 생성, HTTP 200, pageerror 0을 확인했다.
  전투·물리 모바일·실제 RTX 성능·청취·네이티브 Android 검증은 수행하지 않았다.
- PC bridge의 로컬 profile을 현재 checkout으로 바인딩했다. Cloudflare OAuth 인증은 통과했으나
  D1 `apex-rsi` 확인은 실패하여 배포 잠금 읽기를 실행하지 않았다. 서버 자원/잠금을 생성·변경하지 않았다.

## Windows 호환성 수정

아트 생성기의 CRLF 변환이 provenance SHA-256과 불일치했다. `*.py text eol=lf`로 원본 바이트를 유지한다.
생성 데이터나 기대 해시는 바꾸지 않았다.

PowerShell DPAPI 자식의 UTF-8 stdin을 명시해 한글 경로를 보존하며, 해당 자식에만
`-ExecutionPolicy Bypass`를 전달한다. OS 실행 정책과 기존 인증 저장소는 수정하지 않는다.
기존 synthetic CurrentUser DPAPI 테스트를 실제 Windows 자식으로 실행해 통과했다.
PC bridge와 아트 provenance 관련 27개 테스트가 통과했다.

## 남은 차단

- 전체 suite에는 기존 region-architecture의 역사 지오메트리 byte-hash와 불일치하는 16개 사례가 남는다.
  최종 전체 실행은 1,732 pass / 3 skip / 16 fail (총 1,751개)다.
  Windows/런타임 차이 여부를 아직 증명하지 않았으며 baseline hash를 재작성하거나 검사를 생략하지 않았다.
  전체 `check`는 아직 실패다.
- 공통 진단은 pinned `~/.agents/skills/ai-development-routing/references/constitution.md` 부재로
  `BLOCKED_RUNTIME`이다. 별도로 승인된 native Codex 셋업만 수행했으며 전체 APEX 활성화는 하지 않았다.
- 독립 리뷰는 `review-required`, remote Cloud plugin 활성화·D1 readiness·실기기는 미검증이다.
- raw API 값을 요청·조회·복사하지 않았다. media provider route는 현재 PC profile에 등록되지 않았다.

## 기록과 복구

이번 출력은 ignored `work/local-setup/`에 보존한다. 초기 빈 폴더용 초안은
ignored `.local/bootstrap-draft/`로 격리해 기존 프로젝트 파일과 섞이지 않게 했다.
로컬 프로젝트 registry는 현재 root를 이 저장소에 연결하는 메타데이터이며 원격 등록 증거가 아니다.
셋업 변경은 `codex/high-end-setup` 브랜치에 보존한다. 복구는 셋업 커밋만 `git revert`한다.
새 PC bridge profile에는 비밀 값이 없으며 제거가 필요한 경우 현재 바인딩 소유권을 먼저 확인한다.
기존 게임 소스·계정·다른 체크아웃·공통 운영 정책은 복구 대상으로 덮어쓰지 않는다.
