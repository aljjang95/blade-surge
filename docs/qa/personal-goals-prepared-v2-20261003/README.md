# 개인 최고 기록과 다음 목표 — v2 통합 소스 준비

기준은 Astral 후보 `7f7fc33875864c254dc15b0f70bc4be10e3be707`이다. 공유 원본·worktree·배포에 적용하지 않은 별도 일반 clone `/tmp/blade-surge-personal-goals-v2-20261003`에서 준비했다. 원격은 제거했고 clone HEAD는 기준 그대로다. 원본 `/workspace/.blade-surge-tools/personal-goals-prepared-20261003`의 v1 패치·manifest·독립 source review, 이전 `docs/qa/aaa-replayability-20261003/README.md`와 모든 원본 실패·실행 증거는 그대로 보존한다. 이 문서의 검증 상태는 전부 소스 준비 단계이며 기존 회전의 통과를 새 기능의 통과로 사용하지 않는다. root 적용은 Astral release가 완료되고 올바른 main이 확인된 이후에만 진행한다.

기존 기록 창에 하나의 개인 목표 영역을 추가한다. 사용자 선택은 시간 단축·정확 회피·균형 붕괴 중 하나이며, 최근 표시 기록의 ‘이 기록 조건으로 목표 보기’에서 비교 조건을 선택할 수 있다. 새로운 dialog나 보상 수령 흐름을 만들지 않는다. 같은 경로의 기존 출격 authority를 통해 다시 출격하고, 실제 출격 시의 목표를 결과에 비교한다.

## 비교 계약

- **최근 보존된 terminal 기록 20개**만 대상이다. 오래된 기록을 제거한 뒤 잘못된 상세 기록도 원래 한 슬롯으로 남는다. lifetime/역대 최고·1년 재미를 주장하지 않는다. 기존 최근 6개 카드 표시와 20개 저장 한도는 유지한다.
- 실제 카탈로그 경로 kind/id, 캠페인 difficultyId 또는 dungeon depth/conquestId/riftId, 영웅, **출발 heroLevel**, 실제 활성 프레임의 manual/auto/mixed가 모두 같은 승리만 최고 기록을 만든다. 레거시 unknown이나 누락·비유한·범위 밖 시간/회피/BREAK는 제외한다. 실제 관측한 0회는 보존한다.
- 양의 safe integer runId가 terminal 20개 안에서 중복되면 모든 해당 기록을 제외한다. 패배는 조건을 선택할 수 있지만 최고 기록·달성에 포함하지 않는다. 유효한 시간이 포함된 승리가 없으면 수치 목표를 만들지 않는다.
- 저장에는 `{context, metric}` 선택만 넣는다. 최고값·목표값은 저장하지 않고 현재 보존된 기록에서 계산한다. 출격 시 frozen context/baseline/target을 캡처하므로 이번 결과가 최근 최고를 바꿔도 이번 목표는 이동하지 않는다. receipt 정규화는 형식·카탈로그·목표 계산의 일관성 검사이며 서명/인증 수단이 아니다.
- 시간은 원래 최고시간에서 1초를 단축한 값을 0.01초 단위로 내림하고 최소 0으로 제한한다. 시간 0의 최고 기록은 새 시간 목표가 없으며, 회피/BREAK는 1회 증가하되 기존 관측 상한 1,000,000회에서는 새 목표가 없다. 음수·무한 목표를 생성하지 않는다. 요약 시간은 ‘약’으로 두 자리 반올림을 표시하지만 판정은 원본 finite time을 사용한다. 결과 시간은 정확한 원본 Number 문자열로 표시해 10.004초 미달 판정이 10.00초 달성처럼 보이지 않는다.
- 선택한 조건이 최근 20개 밖으로 사라지면 선택 context는 남지만 계산 가능한 최고값·target을 만들지 않는다. 새 실제 기록으로 조건을 선택하라고 안내한다.

## 저장·출격 계약

목표 선택은 기존 `MasterworksService.transact` → `ExpeditionEconomy.transact` 저장·백업·실패 rollback을 사용한다. 실패한 결과 저장, dirty RPG, active/starting battle, 미완료 티켓·환불이 남아 있으면 선택을 거부한다. 목표 저장 실패만 발생했다면 저장이 회복된 뒤 같은 선택을 다시 시도할 수 있다. 별도 정산·통화 차감·각인·숙련·해금·route·목표 보상을 추가하지 않는다.

기본·심층·전술 공략·균열의 버튼 비용은 기존 카탈로그의 `retryEnergyForResult`에서 읽으며 실제 `startExpedition`의 접근·기간·에너지·티켓·취소·환불 검사를 그대로 거친다. 영웅·레벨·장비·AUTO를 목표의 과거 값으로 바꾸지 않는다. 현재 영웅·출발 레벨·시작 조작을 별도로 보여 주고 조건이 달라지면 비교하지 않는다고 알린다. 균열은 오늘의 실제 효과로 출격하며 과거 riftId와 다르면 비교에서 제외한다.

캠페인은 기존 선택 화면을 열고 경로의 번호·난이도·에너지 확인 후 사용자가 출격한다. 새 캠페인 출격 authority를 추가하지 않는다. 기준 소스의 `startStage`는 `stageDef`로 stage를 재구성하는 과정에서 입력 difficultyId를 유지하지 않으므로 과거 난이도를 그대로 재도전한다고 주장하지 않는다. 기존 캠페인 선택에서 표시한 난이도를 사용한다.

## 준비된 검사와 실행 제한

추가 회귀 소스는 순수 모델의 terminal 20개/중복/legacy/실제0/모든 비교 조건/목표 경계/frozen capture/위조 형식 거부, 기존 저장 transaction rollback·회복·정산 guard, 카탈로그 출격 가격, inline UI 표시, 시간 표시 경계를 다룬다. 테스트가 작성된 사실은 통과 근거가 아니다.

v2 통합 fixture는 실제 Masterworks `Battle.start`와 상속된 `RpgBattle.start`, 기존 Economy/ExpeditionEconomy/MasterworksService transaction 및 실제 terminal superclass→`settleChronicle`→history/result 평가 hook을 호출하도록 작성했다. constructor의 DOM과 Base.start의 graphics/assets 로딩 경계만 fixture로 격리한다. async fixture의 localStorage는 callback을 await한 뒤 복원한다. 구성한 actor·시간·회피/BREAK 입력은 component 테스트 payload이며 자연 획득·실제 browser 증거가 아니다. 목표 함수만 직접 호출해서 구현을 반복한 검사로 이 연결을 대신하지 않는다.

통합 검사 소스는 새 history가 최고를 바꾼 뒤에도 출발 목표가 유지되는지, 실제 Base.victory가 만든 `result.time`이 presentation의 live elapsed 증가보다 우선하는지, 시간10.004의 미달 표시, 실제 `observeRunControl`의 mixed 비교 제외, 출발 후 heroLevel 변경, 목표 유무의 기존 지급·기록·정산 save delta 동일성, 실제 duplicate terminal/receipt 거부를 다룬다. 전체 result 객체를 동결하지 않고 출발 goal receipt와 실제 terminal time scalar를 구분한다.

기준의 Masterworks.start에는 Rpg.start와 달리 await 이후 generation guard가 없어 늦은 취소 완료가 새 run을 덮을 수 있는 상속 경계가 있었다. v2는 super.start가 실제 부여한 generation을 잡고, await 이후 동일 generation·동일 stage 객체·active·살아 있는 player인 경우에만 기존 runSeq transaction과 frozen 목표를 만든다. unrelated startup/정산 권한을 재설계하지 않는다. source regression에는 stale 두 시작의 역순 완료, 실제 stop 후 늦은 완료, generation이 같아도 stage가 달라진 경계가 포함된다. 기존 party fixture는 실제 start의 generation/입력 stage 계약을 갖추도록 보완했다. 이 회귀들은 모두 실행 전 상태다.

`tools/personal-goals-qa.mjs`는 향후 승인된 실행을 위한 보조 도구 소스다. 원본 자연 획득 보고의 독립 검토된 SHA256, exact native save bytes/hash, 당시 clean head/build, 보존된 driver/runtime/observer/checkpoint hash를 요구하며 원본 raw 네트워크 실패를 현재의 엄격한 classifier로 다시 판정한다. 현재 후보는 별도의 exact clean head/production build·served index/source freeze를 요구한다. 입력 JSON과 CLI hash 자체는 인증되지 않으며 실제 원본의 신뢰는 소유자의 독립 증거 검토가 전제다.

새 격리 context에서 원본 저장을 한 번 복원하고 실제 성장→기록·세 목표 선택·저장·가로/세로 resize·native reload·에너지4 출격·AUTO 자연 전투·원래 boon/story 선택·결과·다시 reload를 관측하도록 준비했다. 실제 현지 시간과 공개 ENERGY 정책으로 regeneration을 설명하며 시간을 보정하지 않는다. 실제 출발 레벨이 이전 승리와 같아지는 자연 시도만 비교 가능하다. 기본 최대 6회(허용 1–12회) 안에 같은 조건 비교가 나오지 않으면 실패를 보존하고 heroLevel을 되돌리지 않는다. 실제 달성은 보장하지 않으며 미달도 정당한 결과다. 한 문서에 유료 출격 한 번만 하고 매 승리 뒤 native reload를 수행한다. 최종 media/runtime/HTTP/capture diagnostic/unresolved 게이트는 browser close 및 pending drain 뒤 평가한다.

모든 실행은 **NOT_RUN**: node 구문 검사, 타입, Bun 회귀, build, 실제 UI, 실제 화면 직접 검토, 수동/혼합 완주, 실기기, 성능, 저장 실패 실제 UI, 20개 초과 eviction 실제 UI, 캠페인/심층/균열/공략 실제 UI, 머지·배포. 테스트·구문·타입·빌드·브라우저 명령은 실행하지 않았다. 가상의 PASS 보고서나 실제 browser screenshot을 생성하지 않았다. 준비된 helper 자체 실행도 금지 상태다.

향후 소유자가 실행을 승인하고 정확한 후보를 freeze/build한 뒤에만 다음 형식으로 실행한다(여기서는 실행하지 않음):

```sh
node tools/personal-goals-qa.mjs --out=/NEW/absolute/output --expected-sha=<CLEAN_CANDIDATE_40CHAR_SHA> --save=/absolute/original/earned-save.json --acquisition=/absolute/original/report.json --acquisition-sha256=<INDEPENDENTLY_REVIEWED_ORIGINAL_REPORT_SHA256>
```

이는 기존 출격을 돌아보고 다음 수치 목표를 선택하는 작은 반복 플레이 개선이다. AAA 완성·장기 잔존·밸런스·수동 플레이 완주·물리 휴대전화 성능의 근거가 아니다.
