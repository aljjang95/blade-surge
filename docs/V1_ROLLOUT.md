# V1(서버 저장) 롤아웃 실행 직전 준비 — 2026-10-25

> 이 문서는 **집행 직전 준비**다. 문서를 쓴 세션은 원격 D1 마이그레이션, 시크릿·변수 변경, 배포, 플래그 켜기를 하지 않았다.
> 모든 집행은 사람이(PC, `C:\Work\tasks\blade-art-deploy`) 명령을 복사해 실행하고, 각 단계 직전에 대표님 한 줄 확인을 받는다(7장).
> 단계별 명령·SQL은 `node tools/v1-rollout.mjs --stage <단계>`로 출력할 수 있다(dry-run, 아무것도 실행하지 않음). 정본 코드: `worker/v1/auth.ts`(maybeCutover), `worker/v1/db.ts`, `worker/v1/router.ts`, `tools/deploy.mjs`.

## 1. 선행 조건(게이트) — 하나라도 안 되면 다음으로 가지 않는다

| # | 게이트 | 확인 방법 |
|---|---|---|
| G1 | **기존 이용자 보호 PR(`claude/monetize-2-legacy-guard`: 소셜 프로필 시각 증거 + 소환권 10 보상, 컷오버 뒤 첫 세션에서 1회)이 main에 머지되고 배포까지 끝났을 것.** 안 됐으면 컷오버(퍼센트 > 0) 금지: 서버 가져오기가 항상 정책 2(시작 영웅 1명)로 만들어 기존 이용자가 영웅 4명을 잃는다(BM_DESIGN 11.6-1, 11.7-3-1). p0(그림자 모드)까지는 이 PR 없이도 가능하지만 가져오기(`/import`)는 컷오버 전 그림자 상태로만 쌓인다. | `git log origin/main`에 그 PR 머지 커밋, `/version.json`의 sha가 그 커밋의 후손 |
| G2 | **서버 권위 소환이 "서버 결과 먼저 받고 연출"일 것**(BM_DESIGN 12.7-1, GACHA_HANDOFF 남은 것 1). 지금은 클라이언트가 먼저 굴리고 서버가 같은 상수로 재실행하는 그림자 패리티뿐이다. | 구현 PR 머지 확인. 미완이면 p0까지만 |
| G3 | 운영 D1 스키마 v4(0003·0004 적용, 3장) | 2장 SQL |
| G4 | Worker 시크릿 `SESSION_HMAC`(32자 이상, 없으면 `session-unavailable`로 세션 발급 불가) | 2장 `secret list`(이름만) |
| G5 | 결제 플래그(`IAP_ENABLED`, `WEB_BILLING_ENABLED`)는 이 롤아웃 내내 `false`. 결제 개방은 별도(`docs/PLAY_INTERNAL_TEST.md`, BM_DESIGN 9·11.7). | wrangler.jsonc |
| G6 | 직전 단계가 24시간(가능하면 48시간) 이상 합격 기준을 채움 | 5장 SQL |

참고: `SCHEMA_VERSION = 2`(`worker/v1/db.ts`)라서 **0001·0002만 적용돼도 V1 본체는 열린다.** 0003(스키마 v3)은 Play 결제·퍼널, 0004(v4)는 웹 결제만 닫는다(`iap-schema-missing`/`web-schema-missing`). 즉 0003·0004는 V1 컷오버의 필수 조건이 아니라 결제 개방의 선행 조건이다. 그래도 한 번에 적용해 두는 이유: 결제가 켜질 때 마이그레이션과 롤아웃이 겹치지 않게 하려는 것이다(추가형이라 위험이 낮다).

## 2. 현재 운영 상태 확인(모두 읽기 전용)

### 2.1 공개 HTTP

```sh
node tools/v1-rollout.mjs --check https://blade.tllhouse.com
# 같은 내용을 직접:
curl -s https://blade.tllhouse.com/version.json
curl -s -i https://blade.tllhouse.com/api/v1/me                                    # 토큰 없음
curl -s -H "Authorization: Bearer v1.x" https://blade.tllhouse.com/api/v1/me       # 잘못된 토큰(SESSION_HMAC 판독용, 값은 안 보임)
```

`/api/v1/me`는 GET이라 Origin 없이 받고(router.ts), 상태를 바꾸지 않는다.

| 토큰 없음 | 잘못된 토큰 | 뜻 |
|---|---|---|
| 503 `unavailable` | (같음) | `V1_ENABLED`가 `true`가 아니거나, D1이 없거나 `v1_schema.version < 2`. **응답으로는 둘을 구분할 수 없다** -> 2.2 SQL로 가른다. 2026-10-24 운영은 이 상태(GACHA_HANDOFF 검증 절). |
| 401 `token` | 503 `session-unavailable` | V1 열림, 스키마 OK, `SESSION_HMAC` 없음/32자 미만 |
| 401 `token` | 401 `token` | 정상(열림 + 스키마 + SESSION_HMAC) |
| 429 | | 비인증 경로 IP 제한. 잠시 후 |

(근거: `requireSession`이 토큰 없으면 `secret()` 전에 401, 토큰이 있으면 `secret()` 먼저 호출하므로 `SESSION_HMAC` 부재가 503으로 드러난다.)

`version.json`의 `sha`가 배포하려는 main 커밋과 같고 `dirty=false`인지 본다(`tools/deploy-guard.mjs`가 같은 곳을 읽는다).

### 2.2 D1 `blade-surge-commerce-production`(PC, SELECT만)

`--remote` 명령은 PC의 기존 Wrangler OAuth로 한다(클라우드 apex 프록시는 Worker가 Secrets Store 바인딩을 가진 뒤로 `protected_resource`로 막힐 수 있다 — AGENTS.md 배포 절). 아래 `<DB>`는 `blade-surge-commerce-production`.

```sh
cd C:\Work\tasks\blade-art-deploy
npx wrangler d1 execute <DB> --remote --command "SELECT version, applied_at FROM v1_schema WHERE singleton = 1"
npx wrangler d1 execute <DB> --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"
npx wrangler d1 migrations list <DB> --remote
```

- `v1_schema`가 없다는 오류(`no such table`) = 0001 미적용. `version`이 1/2/3/4 = 마지막으로 적용된 마이그레이션 번호.
- 기대 표(0001~0004 적용 후 25개): `account_archive`, `account_docs`, `account_keys`, `account_links`, `accounts`, `audit_flags`, `funnel_active`, `funnel_milestones`, `iap_debt`, `iap_entitlements`, `iap_grants`, `iap_meta`, `iap_obf`, `iap_purchases`, `iap_refund_guard`, `iap_rtdn`, `iap_web_payments`, `legacy_saves`, `mail`, `parity_log`, `run_tickets`, `sanctions`, `v1_rate`, `v1_schema`, `wallet_ledger`. (`test/v1-rollout.test.ts`가 마이그레이션 파일과 이 목록의 일치를 고정한다.)
- 결제 표 행 수: `SELECT (SELECT COUNT(*) FROM iap_purchases), (SELECT COUNT(*) FROM iap_grants), (SELECT COUNT(*) FROM iap_web_payments)` — 0003/0004 적용 전엔 `no such table`이 정상.
- 2026-10-24 기록: 운영 D1에는 결제 표가 없다(GACHA_HANDOFF).

### 2.3 SESSION_HMAC 바인딩 존재(값은 보지 않는다)

```sh
npx wrangler secret list --name blade-surge
```

이름만 나온다. `SESSION_HMAC`가 있으면 존재 확인 끝(길이는 값을 봐야 알 수 있으므로 2.1의 "잘못된 토큰 -> 401" 판독이 길이까지 포함한 증거: 32자 미만이면 `session-unavailable`). 값은 어떤 명령·로그·채팅에도 남기지 않는다. 시크릿이 없으면 **사람이 PC에서** `npx wrangler secret put SESSION_HMAC`로 직접 입력한다(32바이트 이상 무작위 값, 에이전트는 값을 만들지도 보지도 않는다). 시크릿은 vars와 달리 이후 배포에서 덮어써지지 않는다.

Secrets Store 쪽(`PLAY_SA_JSON`, `PORTONE_API_SECRET`)은 wrangler.jsonc의 `secrets_store_secrets` 바인딩이며, 읽기 전용 조회는 BM_DESIGN 9장 2번의 방식(이름·상태만).

## 3. D1 0003·0004 원격 적용 계획

0003(`iap_funnel`), 0004(`web_payments`)는 전부 `CREATE TABLE/INDEX IF NOT EXISTS` + `UPDATE v1_schema SET version = N WHERE version < N`이라 **추가형·재적용 무해**다. 기존 표를 바꾸거나 지우지 않는다. 적용 중에도 V1은 닫혀 있고(`V1_ENABLED=false`) 클라이언트에는 영향이 없다.

1. **사전 백업(Time Travel 북마크, 읽기 전용)** — 적용 직전 시점 기록:
   ```sh
   npx wrangler d1 time-travel info <DB>
   ```
   출력된 `bookmark`(비밀 아님)와 시각을 PR/영수증에 적는다.
2. **적용 대상 확인**: `npx wrangler d1 migrations list <DB> --remote`
3. **적용(대표님 확인 후, PC)**:
   ```sh
   cd C:\Work\tasks\blade-art-deploy
   npx wrangler d1 migrations apply <DB> --remote
   ```
   `migrations_dir`는 wrangler.jsonc의 `worker/v1/migrations`. 0001·0002가 이미 `execute`로 들어갔고 `d1_migrations` 기록이 없으면 wrangler가 0001부터 다시 실행하는데, 전부 가드가 있어 무해하다.
   클라우드 세션은 apex-cloud 정책상 D1 쓰기가 막힐 수 있으므로 이 명령은 PC 경로로만 한다. 클라우드에서 쓰려면 PC에서 권한을 얻은 뒤 저장소 경로로 옮긴다(전역 지침 50번).
4. **적용 후 확인(SELECT)**:
   ```sh
   npx wrangler d1 execute <DB> --remote --command "SELECT version FROM v1_schema WHERE singleton = 1"      # 4
   npx wrangler d1 execute <DB> --remote --command "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"   # 25
   npx wrangler d1 migrations list <DB> --remote                                                             # 남은 항목 없음
   ```
   `/api/v1/me`는 여전히 503 `unavailable`이어야 한다(`V1_ENABLED` 아직 false).
5. **롤백**: 보통 하지 않는다(추가형이고 코드가 쓰지 않으면 무해). 꼭 필요하면 Time Travel:
   ```sh
   npx wrangler d1 time-travel restore <DB> --bookmark=<1번의 북마크>
   ```
   데이터베이스 **전체**가 그 시점으로 돌아가 이후의 세션·계정·원장 행이 모두 사라진다. V1이 켜지기 전(트래픽 0)이라는 전제에서만 쓴다. V1이 켜진 뒤의 문제는 6장 롤백으로 푼다.

## 4. 단계 롤아웃

### 4.1 전환 방법(코드로 확인한 사실)

- `V1_ENABLED`, `V1_SERVER_AUTHORITY_PERCENT`는 **wrangler.jsonc `vars`**다. 정본 배포 경로는 `tools/deploy.mjs`(유일한 공개 배포 컨트롤러)이고 `wrangler deploy`가 config의 vars를 그대로 올린다. 그러므로 변경 = 새 브랜치에서 wrangler.jsonc 한 줄 수정 -> PR -> 리뷰 -> main 머지 -> PC에서 깨끗한 worktree로 `node tools/deploy.mjs --auth=wrangler` -> `version.json` readback.
- 다른 방법은 쓰지 않는다. 대시보드 변수 편집은 `deploy.mjs` 계약(HEAD·잠금·영수증) 밖이고 다음 배포가 config 값으로 덮어쓴다. 시크릿(`SESSION_HMAC`)만 예외로 `wrangler secret put`을 쓴다.
- `maybeCutover`는 **세션 생성 때만**(`POST /auth/session`) 돈다: `authority='shadow'`이고 `shard < percent`인 계정이 `server`로 바뀐다(`shard = parseInt(account_id 마지막 6자리 hex, 16) % 100`, 0~99). 세션 토큰 수명이 1시간이므로 percent를 올린 뒤 대상 계정이 **다음 세션 갱신 때** 전환된다(최대 약 1시간 + 접속 시점). 이미 만든 계정도 shard로 정해지므로 5% 코호트는 단계가 올라가도 그대로 포함된다(0->5->25->100은 누적, 임의 재추첨 없음).
- `/me` 플래그: `serverAuthority = percent > 0`(router.ts `v1Flags`). 웹 결제/영웅 판매는 server 계정에만 열리지만 영웅 직접 판매는 소환 전용 결정으로 판매 안 함.

### 4.2 단계표

| 단계 | wrangler.jsonc | 대상 | 최소 관찰 | 대표님 확인 |
|---|---|---|---|---|
| p0 | `V1_ENABLED: "true"`, percent `"0"` | 전원 그림자(로컬이 정본, 서버는 기록·패리티만) | 24시간 | "/api/v1을 엽니다" |
| p5 | percent `"5"` | shard 0~4 | 24~48시간 | 5% 컷오버 |
| p25 | percent `"25"` | shard 0~24 | 24~48시간 | 25% 컷오버 |
| p100 | percent `"100"` | 전원 | 7일 관찰 후 안정 판정 | 전체 컷오버 |

p0 전에 SESSION_HMAC·스키마(G3·G4)를 갖춘다. p5부터는 G1·G2 필수. 각 단계의 정확한 명령은 `node tools/v1-rollout.mjs --stage p0|p5|p25|p100`.

### 4.3 단계별 합격 기준(다음 단계로 가는 조건)

p0:
- `/api/v1/me` 두 요청 모두 401 `token`(SESSION_HMAC 정상).
- 5xx 0.5% 미만, `authority='server'` 계정 0개 유지, 새 계정 생성 429(IP 30개/시간) 비율 낮음.
- 그림자 패리티: `parity_log` 불일치율 1% 미만(표본 n >= 200).

p5 / p25 / p100(공통):
- 5xx(내부 오류 `internal`) 0.5% 미만, 401/403 비율이 직전 단계와 유사.
- 패리티 불일치율 1% 미만이고 특정 `op`에 몰리지 않음.
- 미해결 `audit_flags` severity >= 2 가 0건(원인 확인·무해 판정은 허용).
- `legacy_saves.status='rejected'` 비율 5% 미만, `legacy-comp` 원장이 계정당 최대 1행.
- "진행이 사라졌다/재화가 줄었다" 신고 0건.
- p100은 위를 7일 유지.

### 4.4 중단 기준(즉시 6장)

- 5xx 2% 이상이 15분 지속 또는 D1 오류 급증.
- 패리티 불일치율 5% 이상, 또는 특정 op 불일치가 몰림(클라이언트·서버 규칙 불일치 의심).
- severity >= 3 `audit_flags` 신규, `legacy-comp`가 한 계정에 2행(원장 `op_id` UNIQUE라 불가능해야 함 = 코드 이상).
- 재화 증발·중복 지급 신고가 1건이라도 사실로 확인될 때.

## 5. 관찰 지표와 SQL(전부 SELECT, 집계라 계정 id가 나오지 않는다)

```sh
npx wrangler d1 execute <DB> --remote --command "<SQL>"
```

| 지표 | SQL | 해석 |
|---|---|---|
| 권위 분포 | `SELECT authority, COUNT(*) AS accounts FROM accounts GROUP BY authority` | server 수가 percent 비율과 비슷한지 |
| 컷오버 커버리지 | `SELECT COUNT(*) total, SUM(authority='server') server, SUM(authority='shadow' AND shard < <P>) pending_cutover, SUM(authority='server' AND shard >= <P>) server_above_percent FROM accounts` | `pending_cutover`는 아직 세션을 갱신하지 않은 계정. `server_above_percent`가 0이 아니면 percent를 낮춘 뒤 남은 server 계정(6장) |
| 패리티 불일치율(24h) | `SELECT COUNT(*) n, SUM(match=0) mismatch, ROUND(100.0*SUM(match=0)/MAX(COUNT(*),1),2) mismatch_pct FROM parity_log WHERE at >= (strftime('%s','now')-86400)*1000` | 1% 미만 합격, 5% 이상 중단 |
| 패리티 op별 | `SELECT op, COUNT(*) n, SUM(match=0) mismatch FROM parity_log WHERE at >= (strftime('%s','now')-86400)*1000 GROUP BY op ORDER BY mismatch DESC` | 불일치가 한 op에 몰리면 그 규칙 점검 |
| 감사 플래그 | `SELECT kind, severity, COUNT(*) n FROM audit_flags WHERE resolved_at IS NULL AND at >= (strftime('%s','now')-86400)*1000 GROUP BY kind, severity ORDER BY severity DESC, n DESC` | `import-clamped`(severity 2) 등 |
| 가져오기 상태 | `SELECT status, COUNT(*) n FROM legacy_saves GROUP BY status` | shadow/imported/rejected/restored. rejected 5% 미만 |
| 기존 이용자 보상 | `SELECT COUNT(*) legacy_comp_rows, COUNT(DISTINCT account_id) accounts FROM wallet_ledger WHERE op_id LIKE 'legacy-comp:%'` | 두 수가 같아야 한다(계정당 1회). G1 PR의 `LEGACY_COMP_OP`(`legacy-comp:<계정>`, kind `legacy-compensation`) 기준 — 머지 후 op_id 규칙을 코드로 재확인 |
| 절삭 보류 | `SELECT COUNT(*) FROM sanctions WHERE kind='payout_hold' AND reason='import-clamped'` | 가져오기 때 상한을 크게 넘은 계정 수 |
| 런 티켓 | `SELECT state, COUNT(*) n FROM run_tickets WHERE started_at >= (strftime('%s','now')-86400)*1000 GROUP BY state` | rejected/expired 비율 급등은 서버 판정 이상 신호 |
| 원장 종류 | `SELECT kind, COUNT(*) n FROM wallet_ledger WHERE at >= (strftime('%s','now')-86400)*1000 GROUP BY kind ORDER BY n DESC LIMIT 20` | cmd:*, run-settle, import, shadow-snapshot 등 |
| 제재 | `SELECT kind, COUNT(*) n FROM sanctions WHERE at >= (strftime('%s','now')-86400)*1000 GROUP BY kind` | 급증하면 오탐 의심 |
| 5xx | `npx wrangler tail blade-surge --status error --format pretty`(잠깐 켜고 끝나면 반드시 멈춘다) + 대시보드 Workers Metrics | 본문의 `v1 error`는 오류 이름만 남는다(SQL·식별자 없음) |

관찰 주기: 단계 적용 직후 1시간은 15분마다, 이후 하루 2회. `node tools/v1-rollout.mjs --stage p5`(등)가 같은 SQL을 `<P>` 채워 출력한다.

## 6. 롤백

### 6.1 핵심: 퍼센트를 낮춰도 이미 server가 된 계정은 shadow로 안 돌아간다

`maybeCutover`(auth.ts)는 `authority !== 'shadow'`이면 계정을 그대로 돌려준다. 즉 **shadow -> server 방향만** 있고 되돌리는 코드는 없다. percent를 0으로 내리면 *새로* server가 되는 계정이 멈출 뿐이다. 코드 주석도 "되돌릴 때는 운영자가 `accounts.authority='shadow'`로 복귀시키고 legacy_saves를 복원한다"고 정한다(MMO_DESIGN 4장 M2 롤백도 같음).

### 6.2 절차(순서 중요: 1 -> 2)

1. **신규 컷오버부터 멈춘다**: wrangler.jsonc `V1_SERVER_AUTHORITY_PERCENT: "0"` -> PR -> 머지 -> `deploy.mjs` 배포 -> readback. SQL을 먼저 하면 대상 계정이 다음 세션 생성에서 `maybeCutover`로 다시 server가 된다. 배포 후 약 1시간(토큰 수명)이 지나야 "새로 server가 되는 계정 없음"이 확정된다. 전체를 닫아야 하면 `V1_ENABLED: "false"`(모든 `/api/v1`이 503, 클라이언트는 로컬 연습으로 폴백 — 폴백 동작은 실기기에서 한 번 확인해 둔다).
2. **영향 범위를 SELECT로 확인**: 5장의 권위 분포·`server_above_percent`·최근 원장.
3. **운영자 SQL(사람이, `<ids>`를 채운 뒤. 먼저 `SELECT COUNT(*)`로 대상 수 확인)**:
   ```sql
   UPDATE accounts SET authority = 'shadow' WHERE authority = 'server' AND account_id IN (<ids>);
   UPDATE legacy_saves SET status = 'shadow' WHERE status = 'imported' AND account_id IN (<ids>);
   ```
   전체 되돌림이면 `account_id IN (...)` 대신 `shard < <되돌릴 퍼센트>`(예: 5% 코호트 `shard < 5`). 이 도구는 이 SQL을 **실행하지 않는다**(출력만).

### 6.3 영향(정직하게)

- 서버 문서(`account_docs`)와 원장은 그대로 남는다. 되돌린 계정의 클라이언트는 다시 **로컬이 정본**이 되므로 server 기간에 서버에서만 쌓인 진행(명령·정산·소환 결과)은 로컬에 없을 수 있다. 서버 기간이 짧을수록(5%/1~2일) 손실이 작다 -> 큰 퍼센트로 올리기 전에 롤백 훈련으로 클라이언트 동작을 실기기에서 확인한다.
- `legacy_saves`의 원문 `doc`은 보존된다(지원 복구용). 로컬 세이브는 서버가 지운 적이 없다(import.ts 주석). 상태는 `restored`가 아니라 `shadow`로 되돌린다(결정 2026-10-25): `restored`면 `shadowSnapshot`이 `import-required`(409)로 거절해 그 계정의 그림자 동기화가 멈추기 때문이다. `shadow`면 계정이 다시 그림자 계정과 같은 상태가 되어 동기화가 이어지고, 퍼센트를 다시 올릴 때 그대로 컷오버된다(기존 이용자 보상은 원장 `legacy-comp`로 이미 받았으면 다시 주지 않는다). MMO_DESIGN M2의 `restored` 표기는 이 결정으로 대체한다.
- 결제로 지급된 재화·권한(`iap_*`)은 서버 기록이라 권위와 무관하게 유지된다.
- 되돌린 계정이 다음에 `percent`가 다시 오르면 같은 shard 규칙으로 다시 server가 된다(5% 코호트는 항상 같은 계정들).
- D1 Time Travel 전체 복원은 마지막 수단이다(3장 5번): 컷오버 이후 모든 계정의 모든 쓰기가 되돌려진다.

## 7. 대표님 한 줄 확인이 필요한 지점(각 집행 직전)

| # | 시점 | 한 줄 |
|---|---|---|
| 1 | 3장 D1 0003·0004 적용 | "운영 D1에 결제·웹결제 표를 추가합니다(추가형, 기존 영향 없음)." |
| 2 | `SESSION_HMAC` 시크릿 입력(없을 때) | "서명 키를 PC에서 직접 입력합니다(값은 기록되지 않음)." — 값 입력은 대표님/사람이 |
| 3 | p0: `V1_ENABLED=true` 배포 | "/api/v1을 엽니다. 퍼센트 0이라 모두 그림자입니다." |
| 4 | p5 | "서버 저장을 5% 계정에 적용합니다(G1·G2 완료 확인 후)." |
| 5 | p25 | "25%로 올립니다(5% 결과: 불일치율 N%, 5xx N%)." |
| 6 | p100 | "전체 적용합니다(25% 결과 …)." |
| 7 | 롤백 6.2 | "컷오버를 멈추고 지정 계정을 그림자로 되돌립니다(서버 기간 진행은 화면에 안 보일 수 있음)." |
| 8 | 결제 플래그(`IAP_ENABLED`, `IAP_ALLOW_TEST`, `WEB_BILLING_ENABLED`) 켜기/원복, Play 상품 `--apply`, 가격 공개 | 별도: `docs/PLAY_INTERNAL_TEST.md`, BM_DESIGN 9·11.7 |

그 밖의 읽기 전용 확인(2장, 5장 SELECT, `--check`)은 확인 없이 해도 된다.

## 8. 이 문서를 쓰면서 한 일과 못 한 일

- 한 일: 코드·문서 읽기, `node tools/play-iap-register.mjs` dry-run(네트워크 없음), 단위 테스트.
- 하지 않은 일: 운영 조회(클라우드에서 D1·시크릿 접근 없음), D1 적용, 시크릿·변수 변경, 배포, 플래그 변경, Play `--apply`.
- 가정(코드로만 확인, 운영 미확인): 운영 D1에 0001·0002가 이미 들어갔는지, `SESSION_HMAC`가 Worker에 있는지. 2장 명령으로 먼저 확인한다.
