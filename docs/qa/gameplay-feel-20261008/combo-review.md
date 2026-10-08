# 콤보·회피 연계 HUD 시각 fixture 검토

2026-10-08 실행. 최종 `cloud-combo-ready-v3`는 exit 0 / PASS다. 실제 `Input.press`를 전달하고 `Player.canQueueCombo` 시점에 다음 공격을 예약해 5영웅 27타의 `doComboHit(0)` 및 `hitDone` 상승 경계를 순서대로 확인했다. 기사 회피 연계 4장면도 통과했다. 제품 소스 변경 없이 기존 목적별 CLI `tools/shot_combo.mjs`를 유지보수했다.

## 범위와 재현 조건

- 빌드: HEAD `fab00213725df80be2670eb9d78625aa09d17773`, dirty `true`, builtAt `2026-10-08T14:52:57.067Z`, pwaRelease `65fd524ae06edc3ec6e3`.
- 최종 실행: `2026-10-08T15:09:59.852Z` ~ `2026-10-08T15:12:51.439Z`. 소스 파일·빌드 진입점 해시는 압축 원본 report에 있고 실행 전후 불변을 검사했다.
- Chromium `/tmp/blade-chromium-153-current-owner/chromium`; `FONTCONFIG_FILE=/tmp/blade-qa-fonts/qa-review-noto-cjk/fontconfig.conf`; 880×400 전체 프레임. HUD를 자르던 과거 crop을 제거했다.
- 격리 저장을 초기화해 영웅 Lv.5, 튜토리얼 완료, 수동 조작으로 준비했다. 각 영웅 준비 전후 저장값과 필요한 영웅 지급 여부를 기록했다. `app.testPause` 상태에서 실제 `app.step(1/120)`을 호출하는 고정 시계 fixture다.
- 실제 스테이지 roster의 적 10개를 생성하고 HP 1,000,000 / ATK 0 / atkCd 1,000,000으로 설정했다. 추가 행동 메서드 변경은 없다. 자폭으로 1개가 사망해 첫 공격 시 생존 적은 모든 영웅에서 9개다. 최초값·변경값·생존 종목록은 원본에 기록했다.
- 기사의 퍼펙트 회피 장면은 실제 회피 무적 중 `Player.hurt(1, {kb:2, dirx:1})`을 한 번 호출한다. HP 보존, 반환값 false, 실제 `onPerfectDodge` 경로의 `counterWindow` 증가와 후속 마무리 소비를 검사한다. 버프 값을 직접 설정하지 않는다.
- 자연 플레이, 실제 터치 입력, 물리 기기 성능, 오디오 품질의 증거가 아니다. Google 폰트 CDN은 기존 하네스의 빈 CSS 응답을 유지하므로 설치된 fallback font 화면이다.

## 실패 원인과 최소 수리

`cloud-combo-v1`은 첫 공격 없이 600프레임이 지나 exit 1로 종료됐다. 통과 기준을 유지한 진단 실행 `cloud-combo-diagnostic-v2`에서도 동일 실패가 재현됐으며, 피격·입력 소비·상태·시간 관찰 기록으로 원인을 확정했다.

| 시점 | 실제 관찰 |
| --- | --- |
| warmup frame 145, elapsed 1.2083초 | `bomb_slime` fuse 0.7에서 `hurt(0, kb:9)` 호출. 최소 피해 1, HP 3696→3695, `idle`→`hurt`. 자폭 행동은 일반 atkCd와 별도로 진행된다. |
| frame 150, elapsed 1.25초 | `hurt` stateT 0.0417초에 첫 공격을 전송. 큐에 `attack`이 들어갔다. |
| 다음 update | `Input.consume('attack')` true. 입력 전달은 정상이며 버퍼가 설정됐다. |
| frame 167, elapsed 1.3917초 | 경직 중 attackBufferT가 0으로 만료됐다. |
| frame 184, elapsed 1.5333초 | 실제 `idle` 복귀. 공격 버퍼가 이미 없어 콤보를 시작하지 않았다. |
| frame 750, elapsed 6.25초 | 전투 시간 정상 진행, active/manual/input enabled, pending 0. expeditionOpened/contextLost/stageStarting 모두 false. |

게임 입력 결함 또는 `hitDone` 판정 문제가 아니라, 시각 fixture가 경직 초기에 첫 입력을 보낸 문제다. 최소 수리는 첫 입력 전에 실제 `idle`, stun≤0, attackBuffer 만료, 빈 입력 큐, comboResume 없음 상태를 기다리는 것이다. 모든 영웅에서 34프레임 뒤 준비됐다. 상태/큐를 강제로 지우거나 적 행동을 억제하지 않았고, 첫 입력은 한 번만 보냈다. 600프레임 제한, 타격 인덱스, 실제 `hitDone` 경계, 27타 수량, 런타임 오류 실패 기준을 유지했다.

## 결과와 직접 화면 검토

| 영웅 | 검증된 0-based 인덱스 | 대표 전체 프레임 |
| --- | --- | --- |
| 기사 | 0,1,2,3,4,5 | [6타 마무리](combo/combo_knight_06.png) |
| 광전사 | 0,1,2,3,4 | [5타 마무리](combo/combo_barbarian_05.png) |
| 마법사 | 0,1,2,3,4 | [5타 마무리](combo/combo_mage_05.png) |
| 도적 | 0,1,2,3,4,5 | [6타 마무리](combo/combo_rogue_06.png) |
| 궁수 | 0,1,2,3,4 | [5타 마무리](combo/combo_ranger_05.png) |

27타 모두 현재 HUD stage/total이 Player 인덱스와 일치했다. 공격 버튼 세 줄 각각 `scrollWidth <= clientWidth + 1px`이며 공격/회피 버튼 경계가 880×400 안에 있음을 검사했다. 위 대표 5장을 직접 열어 타수와 마무리 표기가 버튼 안에 들어오는 것을 확인했다. 이 검사는 실제 적에게 모든 공격이 명중했다는 주장이 아니라, 각 작성된 타격을 실제 실행했다는 검사다.

| 기사 후속 장면 | 실제 상태와 화면 관찰 |
| --- | --- |
| [회피 중](combo/followup_dodge-resume.png) | comboResume idx 3, 버튼 `다음 4/6타 / 회피 중 / 연계 1.3초`. 회피 쿨다운 숫자 표시. |
| [퍼펙트 회피](combo/followup_perfect-counter.png) | HP 유지, counterWindow 증가. 현재/다음 타수 문구는 유지하고 황금 테두리가 추가된다. ARIA에 `마무리 강화 2.4초`가 붙는다. |
| [이어치기 준비](combo/followup_resume-ready.png) | 실제 idle 복귀, comboResume idx 3. `다음 4/6타 / 이어치기 / 연계 1.0초`, ARIA `마무리 강화 2.1초`. |
| [강화 소비](combo/followup_counter-consumed.png) | 실제 입력으로 4→5→6타 실행, finisher 접촉 후 counterWindow 0과 counterActive false. 일반 마무리 표시로 복귀. |

후속 4장도 직접 열어 세 줄과 회피 숫자의 잘림이 없는 것을 확인했다. 후속 4장의 문구 fit은 시각 검토이며, 위 27타와 같은 scrollWidth 수치 검사를 별도로 수행했다는 뜻은 아니다. 비마무리 타수 옆에 `강화`를 붙이지 않아 현재 타격 자체가 강화된다는 잘못된 설명을 피한다.

콘솔/page/HTTP 런타임 오류는 0건이다. `failedRequests`에는 기사·광전사 준비 중 로비 BGM `net::ERR_ABORTED` 2건이 별도로 남아 있다. 요청 실패 수집은 원래 통과 기준과 별개이며, 이 결과를 오디오 품질 PASS로 사용하지 않는다.

마법사·궁수의 밀집 마무리 장면에는 큰 `FINISH`/피해 숫자 여러 개가 전투 중심 일부를 덮는다. HUD fit 검사에는 통과했지만 전체 전투 화면의 가독성 문제가 모두 해결됐다는 결론은 내리지 않는다.

## 원본과 무결성

- [최종 원본 report gzip](combo/report.json.gz): 전체 27타 기록, 모든 HUD 수치, 상태 추적, 저장/적 fixture 변경, 소스/빌드 해시 포함. 압축 해제한 원본 SHA-256: `d123571fa51e6e572b09ad91f4dd07ce34f4887b2ec54f4e2c6ffaff00d5b226`.
- [해시 manifest](combo/manifest.json): 복사된 원본 report·대표 PNG·실행 로그·실패 증거의 SHA-256과 크기.
- [최초 실패 report](combo-failures/cloud-combo-v1/report.json), [진단 실패 report](combo-failures/cloud-combo-diagnostic-v2/report.json), [진단 실패 전체 프레임](combo-failures/cloud-combo-diagnostic-v2/failure_knight.png). 실패 화면은 추가 시뮬레이션 호출 없이 직전 렌더를 저장한 것으로, 공격 성공 증거가 아니다.
- 전체 31개 PNG와 미압축 최종 report는 `work/qa/gameplay-20261008/cloud-combo-ready-v3/`에 보존한다. 문서에는 대표 9개 원본 PNG를 복사했다.
