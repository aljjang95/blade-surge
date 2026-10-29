# 서버 권위 컷오버 게이트 — 처치 원장·여정 단계·몬스터 도감 보상

2026-10-30 `[gogo-chunk:blade-server#authority]`. `docs/RPG_ESSENTIALS.md` "서버 권위 컷오버 전 필수" 1·2번과 도감 보상 보류(감사 #9)를 닫는 계약. 서버 권위 비율 `V1_SERVER_AUTHORITY_PERCENT`는 0 그대로다(켜는 것은 별도 결정).

## 1. 결정 요약

| 게이트 | 결정 | 다른 선택지(버림) |
|---|---|---|
| 처치 원장 저장 위치 | 계정 문서(`account_docs.core`)의 서버 소유 필드 `slain` + 기존 `quests.kills`. 감사 기록은 기존 `ledger` 행(`run:<runId>`)의 delta | 새 D1 표 `kill_ledger` — 정산이 이미 티켓당 1회·원장 op_id로 멱등이라 같은 사실을 두 곳에 쓰게 된다. 운영 D1 마이그레이션·배포 순서 위험만 늘어 버림 |
| 처치 수 근거 | 서버 개연성 검사(T1)를 통과한 정산 사실의 계급별 처치 수(`kills` + `summonedKills`) | 클라이언트 `quests.kills` 값 수신 — 상한 검사가 불가능해 버림 |
| 종(도감) 근거 | 정산 사실의 새 선택 필드 `species`. 서버가 그 관문의 등장 가능 종 풀과 처치 합으로 자른다 | 관문 명단으로 종 계산 — 전투 명단(`combatRosterFor`)과 실제 처치가 달라 버림(RPG_ESSENTIALS) |
| 여정 단계 | 서버 명령 `claimJourneyStep(id)`. 서버가 아는 조건(갑옷 장착·강화)은 서버 문서로 판정, 기기 전용 조건(서약·정원·제작·숙련)은 순서 + 서버 진행 바닥값으로 상한 검사한 "기기 증언" | 원정·숙련 전체 서버 이전 — 범위가 커서 별도 덩어리(남은 게이트) |
| 도감 보상 | 업적 계열 `hunter`(stat `species` = 서버 원장에서 1마리 이상 처치한 종 수) | 별도 도감 보상 표 — 업적이 이미 순서 수령·서버 명령·멱등을 가진다 |
| 마이그레이션 | **D1 스키마 변경 없음**(A5의 단독 마이그레이션 PR은 해당 없음). 문서 필드 추가만 | — |

## 2. 정산 계약 (`POST /api/v1/runs/:id/settle`)

- 규칙 버전 `RULES_VERSION = 'p1-2'`.
- 사실 필드에 선택 `species: { [enemyId]: int }` 추가(최대 64종, 종당 0~100000, `ENEMIES`에 있는 id만). 없거나 빈 값이면 종 원장은 그대로이고 처치 수만 센다(구 클라이언트 호환).
- 서버 처리(`settlement.js` `recordKillLedger`):
  1. 판정 `rejected`, 닫힌 지역, 또는 서버 권위가 아닌 계정(`authority !== 'server'`, 그림자 계정의 정산은 직접 API 호출뿐이라 원장이 컷오버까지 남는 것을 막음)이면 아무것도 세지 않는다.
  - 신뢰 수준: 처치·종은 클라이언트 보고이고 서버는 상한(관문 개연성 표·시간 비율·계급·종 풀)만 건다. 기존 정산이 같은 보고 처치 수로 시드 드랍(골드·장비)을 굴리는 것과 같은 신뢰 수준이다. 처치 이벤트 자체의 서버 검증(입력 재생)은 별도 과제.
  2. `counted = Σ kills[rank] + Σ summonedKills[rank]` (개연성 표 상한 안). 승리·패배 모두 세되, 개연성 검사의 최소 시간은 승리에만 걸리므로 서버 시계 경과(`wallMs`)가 최소 클리어 시간보다 짧으면 `floor(관문 처치 상한 합 × wallMs / minClearMs)`까지만 인정한다(티켓 직후 패배 정산으로 상한 처치를 찍는 위조 차단).
  3. `quests.kills += counted`.
  4. 종: 관문 종 풀(`stageSpeciesPool` = 전투 명단·보상 명단·웨이브·관문 보스·던전 보스를 실제 생성 id(`chapterSpeciesId`)로 바꾼 것 + 그 종들의 `summon`을 더 늘지 않을 때까지) 밖의 id는 버리고 `dropped`로 보고한다(판정에는 영향 없음). 종 합이 `counted`를 넘으면 id 정렬 순서로 잘라 맞춘다. 보스 정의 종은 보스 처치 수까지, 정예 정의 종은 정예 처치 수까지(정예 접사로 일반 종이 정예가 되는 것은 허용).
  5. `slain.kills[id] += n` (종당 상한 1e9).
- 영수증에 `killLedger: { kills: counted, species: <이번에 센 종 수>, dropped: <버린 수> }`, 원장 delta에도 같은 값.
- 멱등: 기존 그대로 — 티켓 상태(`open`→`settled|rejected`) + 원장 op_id `run:<runId>` + rev 가드. 같은 티켓 재전송은 같은 영수증만 돌려준다(추가 집계 없음).

## 3. 서버 소유 필드 `slain`

- 형태 `{ seeded: boolean, kills: { [enemyId]: int } }`. `normalizeSave`가 정규화(알 수 없는 id 제거).
- `SERVER_OWNED_KEYS`에 추가(서버 권위 계정은 서버 값으로 덮어씀). 그림자 패리티(`PARITY_KEYS`)에는 넣지 않는다(시각·기기 기록과 같은 이유 — 그림자 모드는 정산 티켓이 없다).
- 새 저장은 `seeded: true`(옮길 기록 없음). 도입 전 저장은 `seeded: false`.
- **병합 규칙(기기 기록 → 원장, 1회)**
  - 로컬 전용(서버 미연결): 클라이언트 전투 코드가 처음 한 번 `rpg.bestiary[id].kills`를 그대로 옮기고 `seeded: true`. 로컬은 신뢰 경계 밖이라 상한 없음(기존 규칙과 같다).
  - 서버 가져오기(계정당 1회, 새 계정 문서가 `seeded: true`여도 항상) / 그림자 스냅샷은 서버 문서가 `seeded: false`일 때만: `trustedSlain`이 기기 값(`slain.kills`와 `rpg.bestiary` 중 큰 값)을 ① 정화된 진행도까지의 관문 종 풀 안의 id만 ② 정화된 `quests.kills` 합 이하로(id 순 절삭) ③ 서버가 이미 가진 값은 바닥값으로 합친 뒤 `seeded: true`.
  - 그 뒤 스냅샷은 서버 값만 쓴다(편집 저장으로 재주입 불가).
- `quests.kills` 가져오기 상한: `ONE_TIME.kills(3000) + DAILY_MAX.kills(20000) × 경과일`, 서버 값이 바닥.

## 4. 여정 단계 서버 명령 `claimJourneyStep(id)`

- `src/shared/v1-ops.js` 명령표: `claimJourneyStep: { args: [str], run: (e, id) => e.claimJourneyStep(id, { attest: true }), ok: okResult }`. 서버만 `attest: true`로 실행한다(클라이언트는 같은 메서드를 전체 조건으로 실행).
- 보상: 기존과 같다(골드 500~2000 + 강화석 10, VIP 배율 없음). 서버 문서의 `journey.claimedSteps`에 기록 → 7일 여정 d3c·업적 `wayfarer`·7일 최종 상자가 서버 권위에서 열린다.
- 서버 판정(`attest`): 순서(앞 단계를 받아야 다음) + 갑옷 장착·장착 장비 +1 이상은 서버 문서로 실제 판정 + 기기 전용 단계는 서버 진행 바닥값(`JOURNEY_ATTEST_MIN_CLEARED`: 서약 0, 정원·제작·숙련 관문 1개 이상 클리어).
- 멱등: `/cmd` cid 원장 + `claimedSteps` 중복 거부(`claimed`). 7일 최종 상자는 `newbie.final`로 1회.
- `claimedSteps`의 정본은 서버: 그림자 스냅샷은 서버 값만 쓰고, 외부 가져오기는 서버 판정(attest)으로도 완료인 단계만 순서대로 이어받는다. 서버 문서 적용(`mergeServerOwned`)은 `journey.claimedSteps`만 서버 값으로 덮고 일일·주간 의뢰는 기기 값을 둔다.

## 5. 도감 보상(업적 `hunter` '몬스터 사냥꾼')

- stat `species` = `slain.kills`에서 1 이상인 `ENEMIES` id 수. 단계 10/25/50/80/120종, 보상 골드 15,000 · 보석 50 · 상급 강화석 10 · 보석 120 · 최상급 강화석 3. 순서 수령, `claimAchievement` 명령 그대로(서버 판정·멱등).
- 1회성 소량이라 sim:90d 밖(업적과 같은 취급).

## 6. 클라이언트

- 시드 정산 판의 처치마다 종을 센다(`drops.onSeededKill`, 무리 졸개 제외) → 정산 사실 `species`.
- 서버 영수증 적용 때 로컬 `quests.kills`가 서버 값보다 크면 서버 값을 쓰고 차이를 `state.killDrift`와 콘솔 정보로 남긴다(A2).
- 로컬 전투는 처치마다 `slain`에도 기록(서버 권위면 다음 문서 적용에서 서버 값으로 덮인다).

## 7. 되돌리기

- 스키마 변경이 없어 운영 D1 작업이 없다. 되돌리기 = 이 PR revert 후 배포.
- revert 뒤에도 계정 문서의 `slain`은 이전 코드의 `normalizeSave`가 버리고(알 수 없는 키) `quests.kills`는 그대로 남는다. 서버 권위 0%라 이용자 영향 없음.

## 8. 남은 게이트(이 PR 범위 밖)

- 여정 일일·주간 의뢰(`claimContract`)의 진척(원정 승리·던전 목표·행동 수)과 보상은 아직 기기 전용. 원정·던전을 서버 런으로 옮길 때 같이.
- 기기 증언 단계(서약·정원·제작·숙련)의 실제 판정 — 원정·숙련 서버 이전 때.
- 무한의 성(`endgame.tower`) 서버 런 — 7일 여정 d6b·업적 `climber` 서버 판정.
- 그림자 기간에 기기에서 새로 잡은 종은 서버 `slain`에 들어가지 않는다(정산 티켓이 없음). 컷오버 뒤 다시 잡으면 쌓인다.
- 종 보고는 클라이언트 주장이다: 관문 풀·계급·시간 비율 상한 안에서는 실제로 잡지 않은 종도 기록될 수 있다. 50·80·120종 단계는 서버가 검증한 진행(관문 개방)이 있어야 풀이 넓어진다.
