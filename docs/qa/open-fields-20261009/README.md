# 야외 필드·전사 패치 검증

새 초원·해안·산길·도시 필드와 기사·광전사의 준비 몰이, 공격 동작, 실제 명중 진동을 검증했다. 아래 결과는 로컬 소프트웨어 WebGL과 전투 성분 시뮬레이션이며 공개 배포·실기기 진동·사람의 타격감 평가를 증명하지 않는다.

## 소스와 기준선

기준선은 clean `731c39e2c44341f3f3c1555b547d7577024774fb`의 정확한 archive/build다. 작업 중 main에 들어온 출격 준비창 디자인을 `17ac254b625d5bbfeb1d7e7b3b7cc0f73c6ab2f3`까지 fast-forward로 보존했다. 그 사이의 여섯 커밋은 출격 준비 UI·스타일·문서·관련 QA 변경이며 전투 런타임을 바꾸지 않았다.

후보는 그 HEAD 위의 **미커밋 소스**를 컴파일한 빌드다. 원본 영수증의 `dirty:true`를 유지한다. `fields/integrated-fields-v3/report.json`은 실제 검사한 소스 해시와 시작/종료 빌드 고정을 검증한다. `sources.json`은 최종 변경 소스·배송 이미지의 해시를 제공한다. 이 후보 결과를 clean 커밋 또는 라이브 배포 결과로 재표기하지 않는다.

## 결과

| 검사 | 결과 | 근거 |
|---|---|---|
| 정본 `bun run check` | 타입 검사·1865 pass / 4 skip / 0 fail·빌드 성공 | `logs/blade-fields-check-v9.log.gz` |
| 캠페인 strict 밴드와 기존 상대 회귀 비교 | PASS, 동일 시드·선택·Lv.1→4·12/12 승리 | `metrics/base.json`, `metrics/head-integrated-v2.json`, `logs/blade-fields-compare-v2.log.gz` |
| 새 필드 브라우저 검사 | 76 checks PASS | `fields/integrated-fields-v3/report.json`, 같은 폴더의 실행 당시 driver |
| 모바일 출격 UI | 360×800, 390×844, 1440×900에서 네 카드·44px 버튼·hit target·이미지 로드·가로 넘침 검사 PASS | `fields-*.png`, report의 `ui` |
| 자연 RAF 수동 조작 | 초기 Lv.1 기사, AUTO 접근 후 새 Space 입력 10회·연계, 스킬 1회, 방향 회피, pause/resume·give up·복귀 PASS | report의 `native`, `warrior-meadow-native.png` |
| 네 필드 전체 정화 | 초원 6, 해안 6, 산길 7, 도시 6 구역, 실제 보스 처치·봉인 해제·보상 1회·기록·복귀·자원 1회 폐기 PASS | report의 `runs`, 지역별 combat/boss/result 이미지 |
| 전투 시뮬 | 기준선 2000회, 최종 후보 2000회, 30/60/120Hz, 실패 0 | `sim/combat-base.json.gz`, `sim/combat-head-v2.json.gz`, `sim/summary.json` |
| 독립 전투 리뷰 | 기록 카탈로그 P2 수정 확인, 추가 확정 결함 없음 | `review.md` |

필드 전체 정화는 **Lv.10·1성 기사·기존 기본 장비·스킬 1레벨·입장 에너지 충전·AUTO·동행을 포함한 기존 게임 구성**의 명시된 fixture다. `app.step(1/60)`와 실제 획득한 첫 boon 선택을 사용했다. 전투 중 HP·피해·적 좌표·무적·승리·보상을 주입하지 않았다. 자연 입력 구간에는 fixture 시계나 `app.step`을 사용하지 않았다. 보상 중복 호출의 실패와 경제 저장의 불변성을 실제 원정 서비스에서 확인했다.

| 캠페인 지표 | 기준선 | 최종 후보 |
|---|---:|---:|
| 오류 | 0 | 0 |
| 층 클리어 | 183.4초 | 174.3초 |
| 최대 동시 생존 | 24 | 24 |
| 무보상 최장 공백 | 20.1초 | 19.0초 |
| 피격 비율 | 0.269 | 0.255 |
| 평균 JS 프레임 시간 | 1.36ms | 1.16ms |
| p95 JS 프레임 시간 | 4.3ms | 3.1ms |
| 최대 드로우콜 | 419 | 415 |

기준선 평균이 1ms 이상이므로 RSI의 5쌍 중앙값 예외를 사용하지 않고 기본 strict 비교로 통과했다. 브라우저 검사와 성능 측정, 최종 시뮬레이션은 CPU 작업을 겹치지 않고 수행했다. 전투 시뮬의 기사 피해/초 중앙값은 1468.92→1468.72이고 광전사·마법사는 각각 1625.01·1755.32로 동일하다. 이는 8초 단일 방 성분 fixture의 값이다. 경제·성장·전체 층 플레이 또는 사람의 게임 경험을 측정하는 값이 아니다. 회전베기 7회 접촉과 기존 피해 상한도 세 주기 모두 통과했다.

## 직접 화면 검토

네 지역의 실제 렌더 카드, 360px 출격 UI, 자연 수동 전투, 해안·산길·도시 전투, 캠페인 dense/boss/종료 장면을 직접 열어 확인했다. 초원 GPT 지면, 해안 바다·나무다리, 산길 암석·침엽수, 도시 건물·광장과 기존 액터·무기·예고·VFX가 렌더된다. 새 필드 UI 검사에서는 로컬 한국어 글꼴 fixture를 사용했다. 캠페인 metrics 원본 이미지는 해당 하네스의 글꼴 환경으로 일부 HUD 문자가 빠진 상태를 보존하며, 글자 가독성은 별도의 실제 입력·UI 캡처로 확인했다. 원본 이미지에 글자를 합성하지 않았다.

카드는 `cards/driver.mjs`의 넓은 카메라·초기 위치 fixture로 캡처한 **실제 Three.js 장면**이다. 자연 플레이·배포 캡처로 표시하지 않는다. 이미지와 배송 해시는 `art/open-fields-v1/cards-provenance.json`을 따른다. 마지막 postprocess pass의 calls=1은 전체 프레임 드로우콜이 아니며, 전체 드로우콜 근거는 metrics다.

## 실패와 수정 이력

- 최초 통합 후보의 drawCalls=422가 420 밴드를 초과했다. `metrics/head-integrated.json`과 실패 compare를 보존한다. 실제 평면인 적 예고/마커·봉인/룬만 양면 단일 패스로 바꿔 중복 드로우를 줄였고 최종 415로 다시 통과했다. 밴드·표본·피해·VFX 수량을 완화하지 않았다.
- 실제 넉백이 준비 몰이에 지워지는 테스트 실패를 수정했다. 해당 공격의 명중·취소·공격 serial 전환에서 몰이를 끝내는 소유권을 추가했다. 30/60/120Hz 충돌·취소·중복 명중·진동 회귀 검사가 통과했다.
- 새 카탈로그가 최근 기록/재도전 비용에서 거부되는 리뷰 P2를 공통 실제 출격 카탈로그로 수정했다. 기간 의뢰·발견·RPG 위치까지 같은 ID를 받는다.
- field QA v1은 카드의 에너지 아이콘까지 선택한 strict selector 오류였다. v2는 AUTO 스킬 중 10회 입력을 보낸 검사 오류였다. 직접 카드 이미지를 선택하고 행동 완료/연계 가능 시점을 관측하는 입력 절차로 수정한 v3가 통과했다. 두 실패의 원본 report·driver·failure image를 보존한다.
- 기본 공격 발동의 진동을 제거한 기존 기대값, 자체 테스트의 nullable 타입, 기존 의뢰 카탈로그 기대값을 실제 새 계약에 맞췄다. 보상 검사의 세이브 재사용으로 레벨업 골드가 섞인 fixture는 독립 초기 상태로 수정했다. 2000회 장기 로스터 테스트의 5040ms 타임아웃은 동시 실행을 직렬화해 해결했다. 기존 제한 시간을 늘리지 않았다.
- 별도 exec 사이의 localhost 연결 실패, 캡처 타임아웃, 오래된 dist의 미등록 필드 ID, Node JSON import 오류도 `failures/`와 `logs/`에 보존한다. 브라우저와 서버를 같은 프로세스에서 실행하고 올바른 빌드·Bun 런타임으로 다시 검증했다.
- 이전 `fields-candidate-v1`의 RUNNING 영수증은 중단된 미완료 자료이며 통과 근거가 아니다. 카드 v7 provenance는 교체 이력으로만 `cards/superseded-v7-provenance.json`에 남기고, 최종 배송 원본은 v8 기반 `art/open-fields-v1/cards-provenance.json`만 따른다.

브라우저 지역 전환 시 취소된 BGM 요청 다섯 개는 삭제하지 않았다. 각 응답을 다시 가져와 HTTP 200, 비어 있지 않은 바이트, 배송 원본 SHA-256 일치를 검증해 `mediaCancellations`로 구분했다. 그 외 실패 요청·HTTP 오류·런타임 오류는 0이다. Playwright SW 차단과 SwiftShader extension 경고는 기록한다.

## 출시 상태

코드의 커밋·PR·머지는 사용자 승인 범위다. 공개 배포는 별도 정확한 HEAD 빌드와 `tools/deploy.mjs`의 D1 소유 잠금·rollback·영수증 검사를 거친다. 현재 환경에는 `apex-vault`가 설치되어 있지 않고 연결된 PC 세 개가 모두 offline이므로 인증된 PC 배포를 실행할 수 없다. 이는 출시 완료가 아니다. 실제 머지 SHA·최종 clean 빌드·컨트롤러 실행/차단 상태는 출시 단계의 별도 영수증을 따른다. raw Wrangler 배포·인증 fallback·키 추출·잠금 탈취는 사용하지 않는다.

원본 파일 해시는 `files.json`을 따른다. gzip 파일은 원본 전체를 보존하며 실패 표본을 요약으로 대체하지 않는다.
