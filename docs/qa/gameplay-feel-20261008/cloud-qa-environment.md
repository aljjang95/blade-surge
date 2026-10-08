클라우드 소프트웨어 QA 실행 근거 — 2026-10-08

Work Linux에서 저장소의 기존 `tools/metrics.mjs`를 실행했다. 새 UI 자동 조작 스크립트를 만들지 않았으며 이 결과는 결정적 AUTO·SwiftShader 검증이다. 관리형 UI 브라우저의 WebGL 비활성 실패와 별도 실행 경로다. 사람의 수동 플레이·물리 휴대전화·청감 검증으로 표시하지 않는다.

브라우저 설치:

- 프로젝트 Playwright 공식 `install chromium`은 CDN 다운로드가 비정상 ZIP으로 실패했다. `cloud-playwright-install.log` 보존.
- 승인된 격리 도구 경로 `/tmp/blade-toolchain`에 `@sparticuz/chromium@153.0.0`을 설치했다. 프로젝트 package/lock은 변경하지 않았다.
- 기존 `/tmp/chromium`은 0바이트였다. 패키지 기본 추출도 tar-fs의 chown 제한으로 중단했으며 각 원본을 보존했다.
- 새 `/tmp/blade-chromium-153-current-owner`에서 동일 package의 Brotli binary를 해제하고 SwiftShader/font archive는 tar-fs 지원 옵션 `chown:false`로 현재 소유권을 유지했다. binary와 package 압축 해제 bytes SHA256은 모두 `53a15d6c3a3d27dfb54c4ba60278b1683136f70cf1e67e989da7dfbd3d451ef0`이다. 실제 버전 명령은 Chromium 153.0.8010.0을 반환했다.
- `cloud-browser-integrity.json`은 최초 0바이트 mismatch, `cloud-browser-integrity-current-owner.json`은 성공 결과다. 최초 실패를 성공으로 덮어쓰지 않았다.

한글 font 환경:

- 초기 system fontconfig에는 lang=ko 폰트가 없고 metrics의 기존 외부 font CSS 격리 때문에 PNG 한글이 □로 렌더됐다.
- 격리 apt update는 setgroups/seteuid 제한으로 실패했다. sandbox 사용자 설정을 끄지 않았다. `cloud-fonts-apt-update.log` 보존.
- 승인된 다음 경로로 notofonts/noto-cjk 공식 GitHub의 NotoSansCJKkr-Regular.otf와 Sans/LICENSE를 HTTPS로 받았다. OTF SHA256은 `6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a`다.
- `/tmp/blade-qa-fonts/qa-review-noto-cjk/fontconfig.conf`는 이 폰트 하나의 추가 디렉터리와 기존 시스템 fonts를 사용한다. `fc-match`와 `fc-list :lang=ko`로 등록을 확인했다. 제품 CSS·폰트로딩·게임 코드·지표밴드는 변경하지 않았다. 웹 폰트의 정확한 외형을 재현했다는 주장이 아닌 한글 fallback 환경 복구다.
- `cloud-font-environment.json`에 URL·해시·환경 경로 기록. 새 PNG3장에서는 한글이 실제로 읽힌다. 잠금 emoji missing glyph는 남아 있으며 baseline 비교 시 환경 제한으로 기록한다.

측정 환경은 후보에도 그대로 전달한다:

```sh
FONTCONFIG_FILE=/tmp/blade-qa-fonts/qa-review-noto-cjk/fontconfig.conf \
CHROME_PATH=/tmp/blade-chromium-153-current-owner/chromium \
timeout --signal=TERM --kill-after=15s 900s node tools/metrics.mjs \
  --out <새 절대 JSON 경로> --shots <새 절대 PNG 디렉터리> --port 4193 --timeout 600
```

기준선은 별도 clean worktree `/workspace/scratch/fc6f71e2bf7f/blade-surge-metrics-base`, SHA `fab00213725df80be2670eb9d78625aa09d17773`이다. 원본 source의 node_modules와 lock SHA가 같음을 확인해 node_modules symlink만 연결했고 공식 build를 실행했다. version.json은 dirty:false, builtAt 2026-10-08T14:39:29.075Z다.

| 지표 | 최초 환경 `cloud-base.json` | 한글 환경 복구 후 1회 `cloud-base-fonts.json` |
| --- | --- | --- |
| 판정 | FAIL, 부팅 밴드 초과 | PASS, 모든 절대 밴드 통과 |
| bootMs | 15,644 | 6,702 |
| floorClearSec | 178.3 | 178.3 |
| kills/maxAlive/drops | 194 / 23 / 41 | 194 / 23 / 41 |
| longestDryStreakSec/hitTakenRatio | 10.1 / 0.158 | 10.1 / 0.158 |
| avgFrameMs/p95FrameMs | 3.15 / 9.2 | 2.18 / 4.4 |
| drawCalls/rhythm/errors | 399 / 7 / 0 | 399 / 7 / 0 |
| 실제 AUTO 승리·구역 | true / 12/12 | true / 12/12 |

두 결과의 seed20260905, 선택 기록, 레벨1→4, 보상집계방법은 같다. 폰트 환경을 바꾼 뒤 새 기준선을 1회 측정했으며 합격 표본을 찾기 위한 반복을 하지 않았다. 부팅/성능 차이를 폰트 변경만의 인과 효과로 단정하지 않는다. 원래 실패 JSON·로그·PNG3장을 그대로 유지한다.

새 baseline PNG3장도 직접 검수했다. 한글 정상, 게임/적/영웅/보스/실제 전투와 완료 장면이 보인다. dense에서는 적과 황금 원형 이펙트가 영웅 몸통을 많이 가리고, 보스 장면의 큰 공중 텍스트가 HP 영역과 겹친다. 이는 기준선 관찰이며 후보의 시각 PASS가 아니다.

후보가 동결되면 같은 브라우저·폰트 환경에서 공식 metrics를 실행하고, 새 baseline JSON과 공식 --compare 결과 및 실제 PNG를 함께 판단해야 한다. clean 정확한 SHA가 필요한 series/mobile/live release 도구의 guard는 별도이며 dirty 후보를 clean으로 위장하지 않는다. GitHub Actions는 저장소 계약상 활성화하지 않는다. 배포는 기존 deploy.mjs와 승인된 cloud vault/PC OAuth 경로 및 소유 lease·live ancestry·rollback·영수증 검사가 필요하다.
