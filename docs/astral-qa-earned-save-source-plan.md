# Astral QA: 자연 획득 저장과 production 전용 helper 인계

이 문서는 기존 `astral-standard-validation-plan.md`의 **브라우저 실행 명령과 저장 fixture 설명을 대체**한다. 기존 게임 계약·검증 기준은 유지한다. 이전 계획/원본 `NOT_RUN.md`와 제한 검증 기록은 수정하지 않는다. 본 helper 버전의 syntax/type/test/build/browser/formal metrics와 자연 획득 저장은 모두 **NOT_RUN**이다. 읽기 검토는 실제 실행이나 성공의 증거가 아니다.

## 적용 순서와 불변 조건

1. 소유 루프가 replay 검증을 끝낸 뒤 helper 전용 patch를 검토·적용·커밋한다. 최신 `tools/conquest-media-observer.mjs`와 `tools/qa-media-checkpoints.mjs`는 소유 루프의 동일한 관측기·분류기를 사용한다. classifier의 250ms, latest snapshot >= failedAt, 같은 문서의 중복 URL 모호성 기준은 그대로 둔다. 인계의 checkpoints는 root 당시 파일 그대로이며 root에 이미 동일 파일이 있으면 중복 추가 hunk는 제외한다. root가 이후 개선했다면 개선된 원본을 유지하고 실제 해시를 기록한다. 관측기 원본은 본 작업이 수정하지 않았다.
2. **깨끗한 커밋의 정확한 production 빌드**를 소유 루프가 만들고 필요한 빌드 검사를 한다. helper는 빌드하지 않는다. 현재 준비 clone은 의도적으로 dirty이고 helper 실행 조건을 충족하지 않는다.
3. 새 빈 브라우저 context에서 아래 자연 획득 helper를 순차 실행한다. 실제 `pass`가 나와 원문 저장이 내보내졌을 때만 그 fixture를 사용한다. 유효 fixture가 없으면 Astral browser QA는 계속 NOT_RUN이다.
4. 소유 루프가 Astral 게임 patch를 통합·커밋·빌드·검증한다. 충돌이 있을 때 replay의 hub/result 변경도 보존한다. 아래 Astral helper를 정확한 새 SHA에서 실행한다. 임의 레벨/에너지 생성, 실패 저장을 재해석하는 방법은 사용하지 않는다.

출력 인자는 **존재하지 않는 절대 경로**이고 부모 디렉터리는 이미 있어야 한다. 기존 출력은 거부한다. 아래 `COMMITTED_*_SHA`는 실제 40자리 커밋 SHA로 바꾼다. 명령은 준비 설명이며 이 회전에서 실행하지 않았다.

```sh
source /workspace/.blade-surge-tools/env.sh
node tools/earn-expedition-qa.mjs --expected-sha=COMMITTED_HELPER_SHA --out=/ABSOLUTE/NEW_EARN_OUTPUT
node tools/astral-constellation-qa.mjs --expected-sha=COMMITTED_ASTRAL_SHA --save=/ABSOLUTE/NEW_EARN_OUTPUT/earned-save.json --acquisition=/ABSOLUTE/NEW_EARN_OUTPUT/report.json --out=/ABSOLUTE/NEW_ASTRAL_OUTPUT
```

기본 실행은 Vite **preview**가 기존 `dist/`를 제공한다. dev/createServer는 사용하지 않는다. 필요하면 고정된 기존 release origin `--origin=https://blade.tllhouse.com` 또는 기존 local production preview `--origin=http://127.0.0.1:PORT`를 지정한다. 이 경우에도 local dist와 제공된 `/version.json`, compiled index bytes, SHA/dirty=false/pwaRelease/builtAt가 일치해야 한다. 다른 origin/미커밋 소스/다른 빌드/변경된 driver dependency는 실패한다. 실제 acquisition SHA는 Astral SHA와 다를 수 있고 양쪽 보고서에 정확히 기록된다.

## 자연 획득 helper의 실제 통과 조건

- 저장 주입 없는 빈 context의 기본 무료 Knight: Lv1/star1/장비 없음, 원정 Lv1/XP0/무구매/원정·run history 없음.
- 실제 원정 UI의 Glass Garden standard 카드로 입장하고 카탈로그 4 energy 단일 차감을 확인한다. 다음 검증에 쓸 12 energy를 예약하므로 입장 전 energy>=16이다. 입장 차감은 pending receipt의4와 seq 단일 증가 및 native energyT/실제 관찰시각의 회복분으로 확인한다. Date를 고정하거나 경제 함수를 직접 호출하지 않는다.
- 실제 AUTO 버튼/저장된 AUTO 설정, 실제 제공된 boon/story 버튼 선택만 사용한다. 퀘스트 보상·장비·직접 정산 함수는 이 helper에서 사용하지 않는다.
- 고정 1/60초 `app.step`은 페이싱만 바꾼다. Date/PRNG/profile/currency/level/HP/위치/적/kills/outcome은 수정하지 않는다. 패배·시간 초과·접근 차단은 실제 실패로 남긴다.
- 실제 승리와 정상 정산, 승리 수·native history 각 1개 증가, 중복되지 않은 runId, pending=null과 저장 완료를 확인한다. 공개 카탈로그와 해당 실제 입장 ticket의 frontier 정책으로 검산한 정상 XP/레벨, 변경 없는 quest claims와 타지역 stats도 확인한다. pure catalog 검산은 게임 정산/보상 함수를 호출하지 않는다. 구형 history에 replay 상세가 없으면 원문 기록만 남긴다.
- 매 paid 승리마다 실제 결과 닫기→lobby→**native reload**를 수행한다. 레벨/XP/gold/seq/장비/인벤토리 수/stats/history의 정확한 보존과 energyT·실제 관찰시각·공개 180초 ENERGY 정책으로 설명되는 자연 에너지 회복만 검사하고 새 실제 문서에서 다음 카드 입장을 한다. 같은 URL의 여러 media instance를 억지로 분리하지 않는다.
- 소스 카탈로그의 100 XP/승리와 150·225 threshold라면 Lv3까지 네 승리다. 이를 성공으로 미리 간주하지 않으며 실제 Lv>=3 + energy>=12에서 중단한다. 최대 횟수 기본8, `--max-runs=1..12`이고 실패해도 강제 승리/레벨 생성은 없다.
- native reload 뒤 실제 localStorage `bladesurge_save_v1`의 **UTF8 원문 그대로** 읽고 게임 상태와 일치하는지 검사한다. raw bytes 해시·길이·현재 SHA/build와 실제 run history를 보고한다.
- 실제 performance.timeOrigin으로 문서 수명을 바인딩한다. requestfailed 순간 native 0ms snapshot, navigation 전 pending drain/final snapshot, browser cleanup 중 늦은 이벤트를 유지한다. cleanup 후 전체 실패를 같은 strict classifier로 재분류한다. dropped/error/ambiguous/unbound/missing native observation도 실패한다.
- final production guard와 cleanup 이후의 미디어/runtime/network 모든 gate가 통과한 뒤에만 `earned-save.json`을 exclusive 생성하고 report.status=pass를 기록한다. 비동기 helper acceptance는 아직 보장되지 않는다.

## Astral helper에서 바뀐 조건

정확한 위 원문 저장과 성공 acquisition report(해시·clean build·natural runs·reload·미디어 gates 포함)만 fixture로 복원한다. 이 복원은 명시적인 테스트 fixture이며 새 계정이 Astral을 자연 해금했다는 증거는 acquisition 보고서에 한정된다. 영웅/전투 상태는 수정하지 않는다.

키 입력 전에 `document.activeElement.blur()`/body focus 호출 대신 실제 가려지지 않은 canvas pixel을 mouse click한다. 문서 focus/input enabled/실제 keyboard queue·keyup·Player action 및 이동 수락을 검사한다. 단서는 화면 HUD/표시된 glyph에서 읽고 station의 숨겨진 정답은 읽지 않는다. 재도전은 실제 result footer의 `다시 도전` 또는 `다시 도전 · 에너지 4` 버튼을 사용한다.

기존 actual 입력·오답/정답·attack/skill/dodge/pause 초기화·4/4+allnonboss seal·실제 boss victory·정산 중복/패배/재입장/view cleanup 기준은 유지된다. 실제 selection 중 damage, 인접 혼전, 시각 독립 승인, physical phone, formal metrics, AAA·장기 잔존·PC 로컬맵 일치는 이 helper 준비만으로 입증되지 않는다.

## 기존 증거와 새 검증의 구분

원본 14파일 후보 중 game/test/docs 13파일은 최초 immutable handoff의 SHA256과 동일하다. 해당 원본에 한해 별도 허용된 typecheck exit0과 좁은 9개 파일 117pass/0fail/5301expect의 기존 기록이 있다. 이번 바뀐 Astral helper와 새 natural earner/runtime/checkpoints/문서는 source-only이므로 그 결과를 새 helper 검증으로 옮겨 쓰지 않는다. 전체 check/build/browser/metrics/merge/deploy는 소유 루프가 별도 새 증거로 판정한다.

소유 루프는 helper와게임후보를 한 cleanSHA에 통합하고 그SHA에서 자연획득→Astral을 순차 검증한다. 최신 통합 기준은라이브0cf61344eccfa08a05bc77303d7f1c1c87114cda다. 1349pass/2skip/0fail 타입·전체회귀·빌드를 실행했고 새3helper node--check도 통과했다. 독립 시각 검토가 발견한 성공 조건 후 GPU frame 지연은추가 simulation tick없이현재 renderer.render로맞추고 elapsed/phase/progress/read/hold/HP 불변을관측하도록 보강했다. 이검사는새helper의 실제브라우저통과를뜻하지 않는다. 작은화면 글자·도형·가림과실제피격/혼전·AUTO완주를이후캡처로확인한다.
