# MMO P1 구현 기록 — 서버 계정 + 서버 권위 캠페인 루프

> 기준: `docs/MMO_DESIGN.md` 5장 P1 (P1-A~G). 브랜치 `claude/mmo-p1-server-accounts`. 운영 배포·D1 운영 마이그레이션은 하지 않았다(코디네이터 순서).

## 1. 무엇이 들어갔나

| 레인 | 파일 | 요지 |
|---|---|---|
| P1-A | `worker/v1/migrations/0001_accounts.sql`, `worker/v1/db.ts`, `test/helpers/d1-shim.ts` | 3.3 DDL 중 P1 범위(계정·키·연동·보관·문서·원장·레거시·우편·런 티켓·제재·감사) + `parity_log`·`v1_schema`. CAS 배치는 부가 쓰기→원장→투영→문서(마지막) 순서로 모두 같은 `rev` 가드. `op_id` 중복은 배치 전체 롤백(멱등). 런타임은 DDL을 실행하지 않고 `v1_schema.version` 확인만 한다. |
| P1-B | `worker/v1/{token,auth,http,router}.ts`, `packages/tll-social/src/server/{core,hub,router}.ts` | HMAC 세션 토큰 `v1.<payload>.<sig>`(60분, `token_ver`로 즉시 폐기). `deviceKey` → `sha256('blade-surge:'+key)`(소셜과 같은 식). SocialHub 내부 전용 `/internal/account`로 기존 playerId 입양, 소셜 프로필이 없으면 **id만 예약**(이름·창립 번호를 소비하지 않음, 나중에 같은 키로 만든 소셜 프로필이 같은 id 사용). 구글 연동/복구/해제, 병합 금지 409(양쪽 요약), 복구 시 연동 없는 게스트 90일 보관. |
| P1-C | `src/game/economy.js`(최소 수정), `src/game/economy-core.js`, `src/shared/rng.js` | `Economy`에 `{storage, now, rng}` 주입. `EconomyCore.fromState(state, {rng, now})`가 localStorage 없이 같은 규칙을 실행. 규칙 본문은 이동하지 않았다(동시 편집 레인 충돌 방지). |
| P1-D | `worker/v1/{state,cmd}.ts`, `src/shared/{v1-ops,state-hash}.js` | `/cmd` 허용 op 표(성장·장비·강화·수령·외형·난이도), cid 멱등, `baseRev` 409, 256KB 상한, 서버 시계 에너지. 패리티 해시는 시계·로컬 필드를 뺀 경제 필드만 비교. |
| P1-E | `worker/v1/runs.ts`, `src/shared/{settlement,loot-roll}.js`, `src/game/drops.js`(시드 분기만), `src/data/plausibility-table.json`, `tools/mmo-calibrate.mjs` | 티켓(서버 seed·lootSeed, 2시간, 미정산 5개), 정산은 서버 데이터 + lootSeed 재생성으로만 지급. T1: 서버 시계 대비 경과, 처치 상한, 피해 상한(공격력×dps×시간), 부활·피격·소모품. `rejected`=지급 0 + 감사 플래그, `soft`=50%. |
| P1-G | `worker/v1/import.ts`, `src/shared/legacy-sanitize.js`, `test/fixtures/saves/*`, `tools/v1-golden-saves.mjs` | 원문 `legacy_saves` 보존, `normalizeSave` 재사용 + 재화 상한 절삭 보고서, 결제 필드 제외, 100배 초과는 감사 + 30일 `payout_hold`. 설치·계정당 1회. 서버에서 이미 진행한 계정(rev>1)은 덮어쓰지 않음. |
| P1-F | `src/net/{account,account-client,command-queue,import,secure-storage}.js`, `src/ui/account.js`, `src/main.js`(부트 한 줄) | 서버가 v1을 닫으면(503) 아무 변화 없음. 그림자: 기존 Economy 메서드를 인스턴스에서 감싸 결정적 명령을 `/cmd`(패리티 해시)로, 전투 보상 뒤 `/shadow/snapshot`으로 재동기화. 서버 권위: 부트 때 서버 문서로 복구, 캠페인 판은 티켓·영수증 정산, 결과 화면에 서버 영수증 표시. 기기 키는 localStorage + IndexedDB 사본. |

## 2. 검증 (로컬·miniflare)

- `bun run check`: typecheck + 전체 테스트 + 빌드 통과.
- 단위·통합: `test/v1-{db,auth,cmd,runs,import,client}.test.ts`, `test/economy-core.test.ts` — CAS 동시성, 토큰 변조·만료·폐기, 입양·예약, 연동 충돌·복구, `/cmd` 멱등·409·허용 op·256KB, **패리티 200명령 불일치 0**, **서버 시계(기기 +1일 → 추가 에너지 0, 서버 시계 역행 → 증가 없음)**, **위조 정산 10종(중복·만료·타인 티켓·초단시간·처치 초과·피해 초과·소모품·음수·NaN·알 수 없는 필드) 지급 0**, 미리보기 드랍 = 서버 드랍, 골든 세이브 6종.
- `node tools/v1-proof.mjs`: 실제 workerd + D1 + SocialHub에서 스키마 미적용 503 → 마이그레이션 2회 → 소셜 playerId 입양 → 임포트 → 티켓 → 위조 정산 0 → 정상 정산 → `/me` rev·해시·골드 일치 → 재전송 멱등 → 내부 API 공개 차단.
- `bun run build && node tools/v1-account-qa.mjs`(Chromium: 이 컨테이너는 `V1_QA_CHROMIUM=/opt/pw-browsers/chromium`): 그림자 패리티 0 불일치, 서버 권위 1-1 AUTO 클리어 → 서버 영수증 표시 → localStorage 삭제 후 새로고침 → 서버에서 복구.

- `bun run build && bun tools/mmo-calibrate.mjs --verify 100`: 권장 레벨 AUTO 캠페인 클리어 102판(1장 전 스테이지 + 2~6장 표본) 모두 승리, T1 판정 102/102 ok. 표는 `--calibrate` 관측값(처치 ×1.5, 엘리트 방 수×2 이상).

이 검증은 로컬·에뮬레이터 증거다. 실제 Cloudflare 운영 D1·Android 실기기·실제 구글 ID 토큰 검증은 포함하지 않는다.

## 3. 코디네이터 적용 순서 (운영)

1. D1 `blade-surge-commerce-production`에 `worker/v1/migrations/0001_accounts.sql`·`0002_rate_limits.sql`(스키마 v2, 레이트 카운터) 적용(`wrangler d1 migrations apply`, `migrations_dir` 설정 추가됨). 재적용 무해.
2. 시크릿 `SESSION_HMAC`(32자 이상) 등록. 없으면 v1은 `session-unavailable` 503으로 닫힌다.
3. `V1_ENABLED=true`로 그림자 모드 개방(M1). `V1_SERVER_AUTHORITY_PERCENT`는 **0 유지**(아래 4장 이전에는 컷오버 금지).
4. 그림자 기간 `parity_log`(match=0)·`audit_flags`·`legacy_saves.report` 모니터링.

## 4. 남은 것 (P1 밖이거나 의도적으로 미룬 것)

- **서버 권위 컷오버 전 필수**: 원정·마을·여정·장인·소탕(`sweep`)·부활 보석 차감·가챠·보석 상점은 아직 `/cmd`가 없다. 서버 권위 계정에서는 이 경로의 로컬 변화가 서버 문서 적용 때 사라질 수 있어(서버 소유 필드만 덮어쓰도록 줄였지만 골드·보석 등은 서버 소유) 컷오버 비율은 0으로 둔다. 가챠는 P2-D, 원정은 `expedition-economy.js`의 `Date.now()` 직접 호출을 주입 시계로 바꾸는 작업이 선행.
- 강화(서버 난수)는 클라이언트가 먼저 로컬 결과를 보이고 서버 결과로 정정한다(서버 권위 모드). 연출 후 공개 흐름으로 바꾸는 UI 작업이 필요.
- 서버 권위 모드에서 패배 판은 패배 정산을 보내지만, 앱 종료로 정산되지 않은 티켓은 2시간 뒤 만료(에너지 환불 없음). 프리페치 티켓(오프라인 3장)은 미구현.
- 레이트 리밋은 D1 고정 창 카운터(`worker/v1/limit.ts`, `v1_rate`)로 구현: `/auth/session` IP당 60/10분(새 계정 생성 30/시간), `/auth/recover` 20/10분, `/import` 20/시간(모두 `cf-connecting-ip` 해시), 계정별 `/cmd` 240/분·`/runs/start` 30/분. 초과 시 429 + `Retry-After`. 별도 바인딩이 없어 폴백 걱정이 없고, 수치는 베타 지표로 보정한다. 0002 미적용이면 `schemaReady`가 닫혀 전체 503이다.
- 별·풀클리어는 서버가 `hpLost`·`revives`·`roomsCleared`로 계산한다(`serverRating`). 방 배치는 클라이언트가 만들어 서버가 총 방 수를 모르므로 기준 방 수를 개연성 표의 `maxRooms - 4`로 대신한다. 후속: 방 배치를 티켓 `seed`에서 결정적으로 만들면 총 방 수를 서버가 알 수 있다.
- 임포트·스냅샷 정화 상한의 경과일은 세이브의 `created`가 아니라 서버 계정 생성 시각 기준이다. 오래 해 온 로컬 세이브를 방금 만든 계정에 올리면 상한(1일치)으로 절삭되고 원문은 `legacy_saves`에 보존된다(복원 절차는 운영 몫). 정당한 장기 플레이어의 절삭이 베타 지표에서 문제로 보이면 상한식을 조정한다.
- Play Games·토스 연동은 501(`provider-unavailable`). 소셜 허브의 구글 연동 테이블과 v1 `account_links`는 아직 별개다.
- 네이티브 Keystore 보안 저장소는 `src/net/secure-storage.js` 인터페이스 뒤에 붙일 예정(현재 localStorage + IndexedDB).
- 정화 상한·T1 표의 수치는 "가정" + 헤드리스 보정값이다. 베타 지표로 다시 맞춘다.
- 설계 3.3 DDL의 가챠·카탈로그·길드·랭킹·레이드·아레나 테이블은 해당 레인(P2~P4)의 마이그레이션으로 추가한다.

## 5. 다른 레인과 겹치는 파일

`src/game/economy.js`(주입 시계·난수·저장소, 본문 이동 없음), `src/game/drops.js`(서버 티켓이 있을 때만 타는 시드 분기 +15줄), `src/main.js`(부트 3줄), `worker/index.ts`(마운트 1줄), `worker/native-cors.ts`(v1 경로), `wrangler.jsonc`(vars·migrations_dir·CSS Text 규칙), `packages/tll-social/src/server/*`(내부 입양 API). UI 파일은 수정하지 않았다(`src/ui/account.js`는 신규).
