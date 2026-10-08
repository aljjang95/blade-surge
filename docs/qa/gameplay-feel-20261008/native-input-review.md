# 클라우드 자연 입력 기능 검수

2026-10-08, 기존 저장소의 자연 RAF·native 입력 검수 driver를 **바이트 변경 없이 1회 실행해 13개 검사 모두 PASS, exit 0**을 확인했다. 런타임 오류, 실패 요청, HTTP 오류는 각각 0이었다. 이는 scripted browser 기능 QA다. 인간 수동 플레이·실기기·손맛·청감·실시간 성능 PASS가 아니다.

## 실행과 보존

- 원본: `docs/qa/dungeon-forge-20261008/natural-v4-run2/driver.mjs`.
- 실행 복사본: `work/qa/gameplay-natural-driver.mjs`. 원본/복사본 SHA256 모두 `9ee7ca0d7815fec7a7fb6c3f3907ef08c72d1895661496b47777557f89e75693`.
- 실행 시각: `2026-10-08T15:01:18.429Z` → `2026-10-08T15:06:20.319Z`.
- build: `fab00213725df80be2670eb9d78625aa09d17773`, **dirty:true**, builtAt `2026-10-08T14:52:57.067Z`, pwaRelease `65fd524ae06edc3ec6e3`.
- Chromium `153.0.8010.0`, SwiftShader, viewport `880×400`, hasTouch:false, fresh browser save, service workers blocked.
- 기존 격리 Noto Sans KR 400/700·Black Han Sans 400 WOFF2와 `/tmp/blade-qa-fontconfig/fonts.conf`를 재사용했다. 기존 파일을 덮어쓰거나 제품 폰트를 바꾸지 않았다. 이 driver의 폰트 주입 방식은 deterministic metrics와 달라 성능 비교에 사용하지 않는다.

```sh
CHROME_PATH=/tmp/blade-chromium-153-current-owner/chromium \
timeout --signal=TERM --kill-after=15s 900s \
node work/qa/gameplay-natural-driver.mjs \
  --expected-sha=fab00213725df80be2670eb9d78625aa09d17773 \
  --out=work/qa/gameplay-20261008/cloud-native-v1
```

원본 report/preflight/log, 동일 driver와 대표 PNG는 [natural-input/](natural-input/)에 바이트 그대로 복사했다. [preserved-files.json](natural-input/preserved-files.json)에 원래 경로·크기·해시를 남겼다. JSON 안의 스크린샷 경로는 원본 작업 경로를 보존한다. 보관한 driver의 상대 import는 실행 위치 `work/qa/`를 기준으로 하므로 재현 때 그 위치에 복사해야 한다. 재실행이나 실패 제외는 하지 않았다.

## 확인한 기능

| 검사 | 결과와 관측 범위 |
| --- | --- |
| 요청한 build SHA | PASS; dirty 플래그는 그대로 기록 |
| 새 저장의 1-1 진입 | PASS; native 메뉴 클릭, 자연 RAF, testPause:false |
| AUTO 실제 군집 도착 | PASS; 살아 있는 적 12명, 근처 적 거리 약 4.45 |
| AUTO→수동 전환 | PASS; native 버튼 클릭 후 auto:false |
| Space 공격 애니메이션 | PASS; 실제 수평/대각 공격 클립과 comboIdx 0/1 관측 |
| 스킬 입력 | PASS; 실제 skill 상태, MP 84.1, 쿨다운 4.95초 관측 |
| WASD+Shift 이동·회피 | PASS; 위치 변화 및 Dodge_Forward 상태 관측 |
| 수동 구간 생존 | PASS; HP 2800→2615, 전체 전투 처치 0→5 |
| 일시정지 | PASS; 벽시계 대기 전후 elapsed 동일, held:false, inputEnabled:false |
| 수동 재개 | PASS; paused:false, elapsed 증가, auto:false 유지 |
| controlled stepping 없음 | PASS; 기록 전체 testPause:false, driver는 app.step을 호출하지 않음 |
| 실행·애플리케이션 네트워크 | PASS; 오류/실패 요청/HTTP 오류 0, 외부 차단 요청도 0 |
| 포기→결과→로비 | PASS; native 클릭 후 battle inactive, player 없음, held:false |

동행 전투가 정상적으로 계속됐으므로 5처치를 플레이어 공격만의 성과로 귀속하지 않는다. 수동 구간은 **벽시계 166.891초 동안 게임 시간 8.2745초** 진행됐다. 이 환경의 느린 자연 렌더링 때문에 실시간 응답성·프레임 성능·장기 플레이의 근거로 사용할 수 없다. 결과는 한 영웅·첫 전투 구역의 기능 확인이며, 새 무방향 백스텝·모든 27타·방향 큐·모바일 touch 전체를 검증한 결과도 아니다.

경고 2개는 원문 report에 남아 있다: 검수 설정에 의한 service worker 차단과 SwiftShader의 KHR_parallel_shader_compile 미지원. 오류를 무시하도록 driver를 바꾸거나 미디어 실패를 제외하지 않았다.

## 직접 본 화면

원본 PNG 9장을 모두 직접 봤다. 보관한 대표 6장은 fresh lobby, 수동 군집 진입, 스킬 후 전투, 회피 중 마무리 강화 HUD, 일시정지, 결과 전환 프레임이다. 한국어와 영웅·적·환경 텍스처가 보이고 스킬 쿨다운 4.9초/회피 1.3초, 회피 중 마무리 강화 0.1초 표시를 확인했다. 군집 상황에서는 큰 적·이펙트가 영웅 몸통을 가리는 장면이 있다. 일부 emoji glyph 누락도 남아 있어 전체 시각 품질 PASS로 확대하지 않는다.

`06-native-result.png`는 배경 blur만 보이는 전환 프레임으로 결과 패널 글자가 아직 보이지 않는다. driver의 결과 버튼 visible 확인과 native 클릭·로비 복귀 기능 검사는 통과했지만 **이 PNG는 결과 화면 시각 검수를 통과한 증거가 아니다**. 다시 촬영해 원본을 교체하지 않았다. 로비 PNG는 최초 진입 장면이며 마지막 로비 복귀는 JSON 상태 검사로 입증한다.

출시 판정에는 clean 정확한 SHA 및 변경 범위별 나머지 저장소 게이트가 별도로 필요하다. 이 문서는 위 13개 자동 기능 검사와 직접 관찰한 화면의 범위만 증명한다.
