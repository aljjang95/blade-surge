# Blade Surge MMO 설계서 — 핵앤슬래시 + MMO 레이어

> 상태: 설계 확정안(구현 전). 작성일 2026-10-22. 기준 소스: `claude/blade-playstore-launch-3ol9gu` @ `639fc96`.
> 근거: 대표님 2026-10-22 지시 "핵앤슬래시와 MMORPG를 결합해서 만들거라".
> 목표: ① 전투의 손맛은 지금 그대로 ② 같이 있는 마을, 같이 깨는 파티, 같이 이루는 길드·레이드, 겨루는 랭킹·아레나 ③ 계정 진행을 서버가 보증(기기 이동 가능, 부정 저항) ④ 약 3개월 분량 콘텐츠 ⑤ 결제 전환 약 1%(Play Billing), 한국 시장 우선.
> 이 문서는 코드를 바꾸지 않는다. 구현은 5장의 레인 단위로 나눠 진행한다. 수치 중 "가정"으로 표시한 것은 측정 전 값이며 6·7장의 도구로 베타에서 보정한다.

## 0. 요약과 핵심 결정 10가지

| # | 결정 | 이유(한 줄) |
|---|---|---|
| 1 | **전투 시뮬은 클라이언트에 둔다. 보상·재화·가챠·IAP 지급은 100% 서버가 발급한다.** 검증은 3단: T0 서버 발급 티켓·시계 / T1 개연성 검사 / T2 입력 리플레이 감사(상위 랭킹·의심 건, 지급 전). | 손맛(로컬 60fps 입력)과 부정 방지를 동시에. 서버 전투 시뮬은 비용·구현 모두 비현실적. |
| 2 | **정본 저장소는 기존 D1 하나**(`COMMERCE_DB`를 게임 DB로 확장). 계정 상태는 `account_docs.core` JSON 문서 + 조회·원자성이 필요한 관계형 테이블 혼합. 서버가 **기존 `Economy` 규칙을 그대로 실행**(`EconomyCore` 추출)한다. 모든 계정 테이블의 선두 키는 `account_id`(N-샤딩 가능). | 600줄 경제 규칙을 서버에 다시 쓰지 않는다. 행 쓰기 수가 적어 비용이 낮다. IAP 지급과 원자 처리가 가능(분리 DB의 사가 회피). |
| 3 | **신원**: 서버가 확인하는 랜덤 게스트 비밀(기존 `deviceKey` 재사용) → 계정 id = 기존 SocialHub `playerId`. Google(OIDC)·Play Games·Toss 연동. **첫 결제·랭킹 보상 수령 전 연동 필수.** 계정 병합 금지(충돌 시 택1, 나머지 보관). 기기 ID는 인증 수단이 아니다. | 기존 친구·칭호·명예 기록을 잃지 않으면서 유실·이중 계정 악용을 막는다. |
| 4 | **마을**: `TownDirectory` + `TownShard` Durable Object. 샤드 소프트캡 30/하드캡 40, 5Hz 이진 위치 패킷, 최근접 24명만 전송, 클라이언트는 16명만 풀 렌더. 채팅은 기존 SocialHub 소켓 유지(소켓 2개). | 허브가 24×24 유닛 광장이라 소규모 샤드가 맞다. 이미 검증된 SocialHub를 재작성하지 않는다. |
| 5 | **파티 던전**: 호스트 권위 + PartyRoom 중계 유지(기존 자산 보존) + **서버 서명 attestation** + 멤버별 서버 정산. 게스트 이탈은 진행 계속, 호스트 이탈은 부분 보상(호스트 이전은 v1에서 하지 않음). 스냅샷은 델타·이진화(P3). | 서버 권위 전투는 불가. 보상이 서버 상한·티켓에 묶이면 호스트 부정의 피해가 제한된다. |
| 6 | **길드**는 D1(길드 DO 없음) + SocialHub 채널. 길드 거점(마을 인스턴스)은 P5에서 `TownShard` 재사용. | 길드는 검색·정렬·트랜잭션 쓰기가 본업이라 SQL이 맞다. |
| 7 | **월드 보스**: "인스턴스 도전 + 서버 공유 HP". 보스별·주별 `WorldBossDO` 하나가 피해를 집계, 리셋은 기존 `periodAt`(KST 월요일 05:00). 보상은 **지연 생성 우편**(팬아웃 쓰기 없음). | 실시간 공유 전투 없이 "서버 전체가 한 보스를 잡는" 감각. 비용 최소. |
| 8 | **랭킹**: D1 + KV 캐시. 정확 순위는 상위 1,000명, 나머지는 백분위(히스토그램). **파워 랭킹은 만들지 않는다.** 상위 지급은 T2 감사 통과 후. | 순위 조회가 행 읽기 폭탄이 되지 않게. 과금 격차를 순위로 드러내지 않는다. |
| 9 | **PvP**: 비동기 아레나. 상대 빌드 스냅샷을 **기존 AUTO AI가 조종**(고스트 리플레이 기각). 아레나 전용 정규화(등급 배율 SSR 고정·Lv60·강화+12·소모품 금지). | 고스트는 결정성이 없고 반응하지 않아 재미없다. 기존 `ARENA_RIVALS` 흐름 재사용. |
| 10 | **수익화**는 외형·마을 존재감·시즌 패스·월정액·광고 제거·편의. PvP/레이드 능력치 상품 금지. 확률형은 한국 확률정보 공개 요건을 서버 로그·공개 확률표 해시로 충족. **콘텐츠**: 챕터 12개(런칭 9 + 라이브 3), 무한의 성(타워), 균열, 12주 레이드 로테이션. 90일 페이싱은 `tools/mmo-pacing-sim.mjs`로 밴드 검증. | 전환 1% 목표는 "마을에서 보이는 것"과 "시즌 가치 체감"이 레버. |

추가 확정: 플레이어 간 아이템·재화 **거래 없음**, 웹(PWA) 빌드는 PvE·열람 가능하되 **랭킹 보상은 감사 통과 시에만**, 보상 실행 런은 서버 티켓 필수(오프라인은 연습 모드 + **프리페치 티켓 3장·12시간**), 14세 미만은 자유 채팅·연동·결제 비활성.

### 0.1 먼저 알아야 할 사실 (코드에서 확인)

1. **현재 캠페인은 약 7일치다.** `tools/progression-estimate.mjs` 결과: 하루 30분 기준 1~6장이 7일 안에 끝나고 Lv.44에 도달한다. 3개월(≈45시간)은 "새 챕터 목록"이 아니라 **영웅 등급(SR→SSR 26일, →SSSR 64~82일, `tools/economy-estimate.mjs`) + 장비 강화 + 반복·주간 콘텐츠**가 만든다. 따라서 7장의 설계는 자원 게이트와 주간 신규 콘텐츠를 중심으로 한다.
2. **전투 난수가 고정되지 않는다.** `src/game`·`src/party`·`src/main.js`에 `Math.random` 68곳(skills 10, drops 10, economy 9, battle-base 8, enemies 7, player 4 …). `app.step(dt)`는 dt에 대해 결정적이지만 난수가 전역이라 입력 리플레이로 결과를 재현할 수 없다(LESSONS 2026-09-05도 같은 지적). 입력 리플레이 감사(T2)는 **P4의 난수 주입 리팩터가 선행 조건**이다. 그 전에는 랭킹 보상을 지급하지 않는다.
3. **PRD §5 "서버·계정 시스템 하지 않음"과 충돌한다.** 대표님 2026-10-22 지시가 우선하며 9장에 개정 목록을 둔다. AGENTS.md의 "서버 없는 정적 게임으로 축소하지 않는다"와는 일치한다.
4. **파티 스냅샷이 모바일에는 무겁다(추정).** `validPartySnapshot`의 적 1개 JSON이 약 150B, 동시 생존 24~34 + 플레이어·이벤트 포함 시 스냅샷 약 6~8KB × 10Hz = 게스트 하향 60~80KB/s(10분 판 약 40~50MB). 실측 전 추정이며 P3에서 `tools/mobile-party-qa.mjs`로 실측하고 델타·이진화로 40KB/s 이하(목표 10~15KB/s)로 낮춘다.

## 1. 현황 인벤토리 (소스 기준)

### 1.1 이미 동작하는 것

| 영역 | 동작하는 것 | 근거 |
|---|---|---|
| Worker 라우팅 | `/api/store/*`, `/api/party[/CODE]`, `/api/social/*`, `/api/companion`(Workers AI 동행 대화, 기본 비활성, `DIALOGUE_BUDGET` DO가 호출 예산 직렬화), 정적 자산(SPA). 앱(Capacitor) 출처 CORS 허용 목록. 시간당 cron `17 * * * *`이 상점 임시 기록 정리. | `worker/index.ts`, `worker/native-cors.ts`, `wrangler.jsonc` |
| 바인딩 | `ASSETS`, `AI`, DO `DIALOGUE_BUDGET`·`PARTIES`(PartyRoom)·`SOCIAL`(SocialHub), D1 `COMMERCE_DB`(`blade-surge-commerce-production`), mTLS `TOSS_MTLS`. **KV·R2·Queues·Analytics 바인딩은 없다.** | `wrangler.jsonc` |
| 파티 던전(협동) | 호스트 브라우저가 적·피해·방·보스를 시뮬레이션, DO가 초대(80비트 코드)·인원 4·역할·준비·실행 ID·메시지 형태/크기/빈도·45분 TTL을 검증. IP당 방 생성 5/분·참가 30/분 게이트. 스냅샷 10Hz/입력 20Hz/메시지 40/s/768KB/s/적 180. 시각 효과·아바타·타격 영웅 능력 협상, 구버전 호환(필드 제거). 연결 상태 핑·60초 호스트 무응답 종료. | `worker/party.ts`, `worker/party-state.ts`, `src/party/protocol.js`·`session.js`·`presence.js`·`replication.js`·`visual-protocol.js`, `docs/party-dungeons.md`, `test/party-*.test.ts`, `tools/party-relay-proof.mjs`(실제 로컬 workerd) |
| 커뮤니티 | SocialHub DO(SQLite, WebSocket 하이버네이션): `deviceKey` 신원, Google 연동/복구/해제(30일 쿨다운), 친구 100·차단 200, 광장 채팅 3채널×150(120자, 1.2초 간격, 10초 5회), 귓속말·파티 초대·모집 목록(TTL 10분), 서버 `runs/start`·`runs/clear`(최소 클리어 시간·summary 검사)로 명예의 전당·칭호·창립 번호, 게시판, 신고(채팅은 ref 필수·3명 자동 음소거), 관리자 mute/ban/revoke, 디스코드 웹훅. | `packages/tll-social/*`(CONTRACT.md, `server/core.ts`·`hub.ts`·`schema.ts`), `src/social/config.js`·`integration.js`·`google-signin.js` |
| 결제 서버 | 채널 `web/apps-in-toss/googleplay/onestore`, 세션(Google ID 토큰 또는 Toss 익명 키 교환), 주문 의도·영수증 검증(Google Play productsv2, ONE Store, Toss 주문 API)·복원·환불 상태 `store_ledger`(불변 트리거). **상품은 `remove_ads_v1` 하나**(CHECK 제약). `STORE_BILLING_ENABLED=false`. | `worker/store.ts`, `worker/store.sql`, `docs/COMMERCE-SERVER-CONTRACT-20260923.md`, `docs/STORE_RELEASE_20261012.md` |
| 진행 저장 | `localStorage` `bladesurge_save_v1`(+`_backup`·`_recovery`), `Economy.load/save/migrate`. 지급·소비 로직은 전부 `Economy` 클래스(재화 `addRewards`, `completeStage`, `pull`, `enhance`, 에너지 `tickEnergy` …). 가챠 확률표 `gachaRates()/gachaContents()`는 실제 소환 코드와 같은 식으로 계산(공개 확률 UI 기반). `createSeededRng` 지원. | `src/game/economy.js`, `save.js`, `save-base.js`, `src/data/shop.js` |
| 시간 | `periodAt()`: 일 경계 KST 05:00, 주 경계 월요일 05:00. 일일/주간 계약·계절 프런티어 효과. | `src/game/journey-core.js`, `src/data/journey.js`, `src/data/seasonal-content.js` |
| 콘텐츠 | 챕터 6×스테이지 10(=60). X-3·X-7 수문장, **X-5 중간 보스, X-10 최종 보스**(`stageDef`의 rank). 난이도 story/adept/nightmare. 재료 던전 20 + 심층 12, 필드 던전, 마을 3(서약의 성채·잿불 항구·별마루 설원, 의뢰·상점·대장간), 일일 균열, 아레나 AI 상대 6(`ARENA_RIVALS`, 에너지 0). 영웅 5직업, 등급 SR/SSR/SSSR, 레벨 상한 80, 강화 +20. | `src/data/stages.js`, `difficulty.js`, `expansion.js`, `towns.js`, `rift-encounters.js` |
| 마을 장면 | 성채 광장(경계 ±12, 이동속도 4.2, 문 12개) 단독 보행. | `src/data/citadel-hub.js`, `src/game/hub-movement.js` |
| 검증 도구 | 헤드리스 전투 런타임(실제 Player/Enemy/battle-base 사용), AUTO 클리어 QA, 경제·성장 추정기. 로컬 workerd 증명, 실제 로컬 Worker·2클라이언트 Playwright 패턴. D1을 `bun:sqlite`로 흉내 내는 테스트 패턴. 테스트 파일 345개(`bun test`). | `tools/combat-flow-sim.mjs`, `auto-clear-qa.mjs`, `economy-estimate.mjs`, `progression-estimate.mjs`, `party-*-qa.mjs`, `packages/tll-social/test/*` |

### 1.2 없는 것 (이번 설계의 대상)

| 영역 | 빠진 것 |
|---|---|
| 신원 | 소셜 `playerId`(DO 안), 스토어 `subject`(`sha256(채널:sub)`), 로컬 세이브가 **서로 연결돼 있지 않다.** 서버가 아는 "한 사람"이 없다. 연동 제공자는 `google`뿐(`AUTH_PROVIDERS`). |
| 서버 권위 | 서버 진행 저장, 서버 발급 보상/드랍, 서버 에너지·시계, 서버 가챠. 지금은 개발자 도구로 `localStorage`를 고치면 모든 것을 바꿀 수 있다. 가챠·강화 난수가 클라이언트에 있다. |
| 결제 | 현금 SKU 서버 카탈로그·주문/지급 원장·환불 후속 처리(보석/VIP/패스). `Economy.paymentAvailable()`은 항상 false. |
| 마을 | 다른 플레이어 위치·외형 동기화, 샤드, 이모트, 마을 내 존재감. |
| 파티 | 보상 지급(현재 "개인 장비·경험치·재화 보상 없음"), 계정 바인딩, 게스트 이탈 시 진행 지속(현재 누구든 나가면 전원 종료), 호스트 이전, 자동 매칭, 델타/이진 스냅샷. |
| 길드·레이드·랭킹·PvP | 길드, 월드 보스, 타워, 리더보드(명예의 전당 외), 실제 플레이어 대상 PvP(현재는 AI 상대 6명, 로컬 정산). |
| 결정성·감사 | 전투 난수 주입, 입력 기록/리플레이, R2 보관, 감사 러너. |
| 운영 | 한국어 우회 욕설 필터, 연령 확인, 계정 삭제(Google Play 정책 요구), 약관·확률 고지 페이지, 서버 KPI(현재 퍼널은 로컬 링 버퍼뿐), 킬스위치. |

## 2. 제품 기둥과 코어 루프

### 2.1 기둥 5개

| 기둥 | 내용 | 지키는 것 |
|---|---|---|
| P-A 몹몰이 전투 | 5~6타 콤보·진공·히트스탑 등 PRD 도파민 3축. 클라이언트 60fps 로컬 시뮬. | 지연 없는 손맛. 서버 왕복이 전투 프레임에 끼지 않는다. |
| P-B 같이 있는 마을 | 광장에서 다른 모험가가 걷고 이모트하고 외형이 보인다. 문(게이트)=콘텐츠 입구. | 마을은 게임플레이에 영향이 없다(보안·비용 단순). |
| P-C 같이 깨는 던전 | 2~4인 협동, 보상 지급, 빠른 매칭, 부족하면 동행(네브) 채움. | 기존 파티 자산 재사용. |
| P-D 같이 이루는 목표 | 길드 주간 목표, 주간 월드 보스(서버 전체 HP), 시즌 랭킹. | 능력치 격차를 보여주는 파워 랭킹 없음. |
| P-E 내 것임을 보증 | 서버가 지급·소비를 기록. 기기 변경·재설치에도 복구. | 보상은 서버만 발급. 오프라인은 연습. |

### 2.2 루프

| 주기 | 루프 | MMO 기능 연결 |
|---|---|---|
| **세션 5~15분** | 마을 입장(샤드 배정) → 문/의뢰 선택 → 던전 1~2판(솔로 3~6분 또는 파티 8~10분, AUTO 가능) → **서버 정산 영수증** → 마을에서 강화·장비·소환 → 친구 초대/길드 채팅 → 다음 판 | 마을 존재감(P-B), 파티 즉석 매칭(P-C), 정산=서버 |
| **일 (KST 05:00)** | 일일 계약 6종(기존 `DAILY_CONTRACTS`), 출석, 길드 출석·기부, 월드 보스 3회, 아레나 5회, 균열 1회, 에너지 소진 | 길드·레이드·아레나가 "오늘 할 일"을 만든다 |
| **주 (월 05:00)** | 주간 계약 5종, 주간 월드 보스 결산(개인 상위%·서버 마일스톤), 길드 주간 목표 상자, 타워 층 개방 | 레이드 로테이션, 길드 목표 |
| **시즌 (12주)** | 시즌 패스 40단계, 아레나 시즌(4주×3), 타워 시즌 랭킹, 칭호·외형 보상, 신규 챕터·보스 로테이션 | 랭킹·패스·콘텐츠 케이던스 |

### 2.3 결정적 클라이언트 vs 서버 주도

| 항목 | 클라이언트(결정적 시뮬/로컬) | 서버 |
|---|---|---|
| 전투 판정·AI·콤보·VFX·카메라 | O (`app.step`) | 개연성 검사만 |
| 필드 드랍의 **모양/연출** | O (서버가 준 `lootSeed`로 미리 그린다) | 정산 때 같은 시드로 **재생성하여 발급** |
| 재화·인벤토리·영웅 성장·진행도 | 예측 표시(결정적 연산만) | **정본** (`/cmd`로 규칙 실행) |
| 난수 연산(가챠·강화·드랍) | 연출만 | **서버 난수**가 결정 |
| 에너지·타이머·일/주 경계 | 표시 | **서버 시계** |
| 마을 위치·이모트 | 자기 이동 예측, 타인 보간 | 속도·경계 검증, 방송 |
| 파티 전투 시뮬 | 호스트 | 중계·검증·attestation 서명 |
| 랭킹/레이드/아레나 결과 | 전투 실행 | 점수·순위·보상 확정(감사 후) |
| 채팅·친구·길드 | 표시 | 필터·저장·제재 |

## 3. Cloudflare 아키텍처

### 3.1 구성

```
 [Android(Capacitor) / PWA / Apps in Toss]
    │ HTTPS  /api/v1/*            Bearer 세션 토큰 (60분)
    │ WSS    /api/v1/town/<id>    TownShard  (이진 5Hz)         ← 신규
    │ WSS    /api/party/<code>    PartyRoom v2                  ← 기존 확장
    │ WSS    /api/social/ws       SocialHub  (채팅·친구·명예)    ← 기존
    ▼
 [Worker blade-surge]  라우터 · 세션 검증 · 레이트리밋 · 규칙 엔진(EconomyCore) · 정산/검증
    ├─ D1  COMMERCE_DB (기존, 정본)   : 계정·문서·원장·티켓·길드·랭킹·주문
    ├─ KV  CACHE        (신규)        : 리더보드 상위, 원격 설정/플래그, 필터 단어, 레이드 상태
    ├─ R2  REPLAYS      (신규)        : 입력 로그(상위/의심/표본만)
    ├─ Queue JOBS       (신규)        : 감사 러너 호출, 시즌 결산, 알림
    ├─ DO  TownDirectory(마을별 1) / TownShard(샤드별)        ← 신규
    ├─ DO  PartyRoom(기존) / MatchQueue(콘텐츠별)            ← 확장/신규
    ├─ DO  WorldBoss(주×보스별 1)                             ← 신규
    └─ DO  SocialHub (기존, 채팅·친구·명예·게시판)
 [감사 러너]  Bun/Node 헤드리스(PC 또는 클라우드 세션) — `combat-flow-sim` 런타임으로 T2 리플레이
```

신규 바인딩은 부록 B의 `wrangler.jsonc` 스케치와 같다. 리소스 생성(KV·R2·Queue)과 시크릿 등록은 코디네이터 소유 작업이며 이 문서의 레인은 코드·테스트만 만든다(AGENTS.md).

### 3.2 신원

**원칙**: 서버가 발급·확인하는 비밀만 인증 수단이다. 기기 ID(ANDROID_ID, 광고 ID 등)는 인증에도 계정 식별에도 쓰지 않는다.

1. **게스트 계정**: 첫 실행에서 클라이언트가 이미 만드는 `deviceKey`(32바이트 난수, 43자)를 쓴다(`packages/tll-social/src/client/identity.js`). 네이티브 빌드는 Keystore 기반 보안 저장소에 두고 `localStorage`는 사본으로만 쓴다(앱 데이터 삭제 시 둘 다 사라지므로 복구 수단은 연동뿐이다).
2. **계정 id = 기존 SocialHub `playerId`(`p_` + 24hex)**. `POST /api/v1/auth/session`이 `key_hash = SHA256('blade-surge:' + deviceKey)`(소셜과 같은 식)로 `account_keys`를 조회 → 없으면 SocialHub 내부 엔드포인트(`resolveByKeyHash`, Worker→DO 전용, 라우팅 불가)로 기존 프로필을 **입양**하고, 소셜 프로필도 없으면 새 `p_…`를 만들고 SocialHub에 `ensureProfile(accountId, keyHash)`를 호출한다. 이렇게 기존 친구·칭호·창립 번호가 그대로 새 계정에 붙는다.
3. **세션 토큰**(무상태 HMAC): `v1.<payload>.<sig>`, payload `{aid, ch(web|googleplay|onestore|toss), ver(accounts.token_ver), iat, exp(60분), att(0|1)}`, 서명 키 `SESSION_HMAC`(Secrets Store). 상태 변경 요청은 D1 배치 안에서 `accounts.token_ver`·`status`를 같이 읽어 차단/로그아웃을 즉시 반영한다. WebSocket은 60초 1회용 서명 티켓(`aud=town|party`)을 쓴다(소셜의 `ws-ticket` 패턴 동일).
4. **연동(`/auth/link`, `/auth/recover`, `/auth/unlink`)**: 제공자 `google`(OIDC ID 토큰, `social/server/google.ts`와 `worker/store.ts`의 `googleSubject` 검증 로직을 `worker/v1/idp.ts`로 통합), `play_games`(Android: 서버 측 접근 코드 → 토큰 교환 → `playerId`; 구현 시 현행 Play Games Services v2 문서 확인), `toss`(앱인토스: 기존 `users/anon-key/exchange`). 저장은 `subject_hash`(SHA-256)만, 이메일·이름 저장 없음(소셜 계약 유지).
5. **병합 금지**: 이미 다른 계정에 연결된 제공자 subject를 연결하려 하면 409 `linked-elsewhere` + 양쪽 요약(레벨·진행·마지막 접속)을 보여 준다. 사용자가 고를 수 있는 것은 "그 계정으로 전환(현재 게스트 계정은 90일 보관)"뿐이다. 두 진행을 합치는 기능은 만들지 않는다(자원 복제 악용 차단).

| 계정 상태 | 할 수 있는 것 | 못 하는 것 |
|---|---|---|
| 게스트 | PvE 전체, 파티, 마을, 길드 가입(계정 Lv.10↑), 아레나, 무료 재화 소환, 광고 | **첫 결제**, 랭킹/레이드 순위 보상 수령, 길드장, 계정 복구 |
| 연동 | 위 전부 + 결제, 순위 보상, 길드장, 다른 기기 복구 | — |
| 14세 미만 (`age_band=u14`) | 게스트 PvE·파티·마을(프리셋 이모트만) | 자유 채팅·귓속말, 연동, 결제, 길드장 |
| 제재(`muted`/`banned`) | 소셜 규칙 그대로(소셜 `players.muted_until/banned`와 `accounts.status` 동기화) | — |

연령 확인은 출생 연도 선택 한 화면(편향 없는 중립 문구)으로 `age_band`만 저장한다(생년월일 비저장). 이후 변경은 24시간 대기. 한국 개인정보보호법상 만 14세 미만 법정대리인 동의 절차는 v1에서 구현하지 않고 **기능을 끄는 쪽**으로 해결한다(법무 확인 항목).

계정 삭제 `DELETE /api/v1/account`: 즉시 `status='deleting'`(로그인 차단), 30일 유예 후 익명화(표시명 → "탈퇴한 모험가", 연동·키·친구 삭제). 결제·환불 원장은 법정 보존기간(전자상거래법상 결제 기록; 기간은 법무 확인) 동안 해시 식별자로 남긴다. Google Play의 계정 삭제 요구(앱 내 + 웹 링크)를 충족하도록 `public/privacy.html`·`support.html`에 같은 절차를 안내한다.

### 3.3 서버 권위 진행 (D1)

**저장 방식 결정**: 정본은 단일 D1이다. 계정 상태는 두 층으로 나눈다.
- **`account_docs.core`** — 현재 세이브(`normalizeSave` 스키마)와 같은 JSON 문서 1행. **서버가 `EconomyCore`(5장 P1-C가 `economy.js`에서 저장 코드를 떼어 낸 순수 규칙 클래스)로만 변경**한다. 규칙을 서버에 다시 쓰지 않고 클라이언트와 한 소스를 공유한다. 서버 난수는 `crypto.getRandomValues` 기반 주입 RNG다.
- **관계형 테이블** — 질의·감사·원자성이 필요한 것(티켓, 원장, 가챠 로그, 주문/권한, 길드, 랭킹, 레이드, 아레나, 우편, 제재).

왜 완전 정규화(인벤토리 행 단위)가 아닌가: 한 번의 판 정산이 인벤토리·영웅·재화·진행·계약을 동시에 바꾼다. 정규화하면 판당 쓰기 약 16행, 문서 방식은 약 4행(문서·티켓·원장·계정 투영, 인덱스 갱신 별도). D1 쓰기 과금이 행 단위(3.14)라 문서 방식이 약 4배 싸고 `UPDATE ... WHERE rev=?` 한 번으로 원자적이다. 대신 GM 조회는 `json_extract`와 투영 컬럼(`accounts.level/power/gold…`)으로 한다. 문서 상한 256KB(초과 시 자동 분해·우편 정리 규칙).

**CAS 배치 패턴**(모든 변경 공통). D1 `batch`는 한 트랜잭션이지만 "0행이면 중단"이 없으므로 모든 문장에 같은 `rev` 조건을 건다.

```sql
-- 1) 원장: 같은 rev일 때만 들어간다. op_id 중복 = 제약 위반 = 배치 전체 롤백(= 멱등)
INSERT INTO wallet_ledger(op_id, account_id, kind, delta, rev_after, at)
  SELECT ?1, ?2, ?3, ?4, ?5 + 1, ?6
  WHERE EXISTS (SELECT 1 FROM account_docs WHERE account_id=?2 AND doc_name='core' AND rev=?5);
-- 2) 문서: 같은 rev일 때만 바뀐다 (changes=0이면 동시 변경 → 409, 클라이언트가 재조회)
UPDATE account_docs SET doc=?7, rev=rev+1, bytes=?8, updated_at=?6
  WHERE account_id=?2 AND doc_name='core' AND rev=?5;
-- 3) 투영
UPDATE accounts SET level=?9, power=?10, stage_idx=?11, gold=?12, gems_free=?13, gems_paid=?14, last_seen=?6 WHERE account_id=?2;
```

**명령 API**: `POST /api/v1/cmd {cid(uuid 멱등키), op, args, baseRev}` → `{rev, doc|patch, receipt}`. 클라이언트 `Economy`는 **결정적 연산**(장착·스킬 배우기·레벨업·판매…)을 낙관적으로 즉시 반영하고 명령을 큐에 보낸다. **난수 연산 3종(가챠·강화·전투 정산)만 비동기**이며 이미 "연출 후 공개" 구간이라 UI 변경이 작다. 서버 결과의 상태 해시가 다르면 서버 문서로 덮어쓴다.

| op 그룹 | 예 | 난수 | 단계 |
|---|---|---|---|
| 성장 | `levelUpHero` `promoteHero` `transcend` `learnSkill` `resetSkills` `setSkillLoadout` | 없음 | P1 |
| 장비 | `equip` `unequip` `sellItem` `salvage` `craftSetItem` | 없음 | P1 |
| 장비(난수) | `enhance`(성공/파괴) | **서버** | P1 |
| 일일 | `claimDaily` `claimMonthly` `claimPass` `claimMail` `claimQuest` `claimJourney` | 없음 | P1 |
| 원정/마을 | `expedition.*`(begin/settle/claimQuest/craft/consume), 마을 의뢰·상점·대장간 | 정산은 서버 | P1~P2 |
| 소환 | `pull`(단일/10연), 확정권 | **서버** | P2 |
| 상점 | 보석 소비 SKU(`kind:'gem'`) | 없음 | P2 |
| 현금 | `/api/v1/store/*`(주문→검증→지급) | — | P2 |

오프라인에서 허용하는 명령은 "설정 값을 덮어쓰는" 멱등형(장착, 스킬 슬롯, 환경 설정)뿐이며 재접속 시 재생한다.

**서버 시계**: 에너지 회복(`tickEnergy`)·일/주 경계(`periodAt`)·쿨다운은 모두 서버 `Date.now()`로 계산한다. 응답에 `serverTime`을 실어 클라이언트가 오프셋만 보정한다. 기기 시계를 바꿔도 얻는 것이 없다.

**DDL 스케치**(SQLite/D1, `worker/v1/migrations/*.sql`). 선두 키는 항상 `account_id` — 나중에 `crc32(account_id) % N`으로 D1을 N개로 쪼갤 수 있다(전역 테이블은 별도 DB).

```sql
-- ── 신원 ──────────────────────────────────────────────
CREATE TABLE accounts (
  account_id   TEXT PRIMARY KEY,                 -- = SocialHub playerId 'p_<24hex>'
  created_at   INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','muted','banned','deleting','deleted')),
  token_ver    INTEGER NOT NULL DEFAULT 1,
  age_band     TEXT CHECK (age_band IN ('u14','14_17','18p')),
  authority    TEXT NOT NULL DEFAULT 'shadow' CHECK (authority IN ('shadow','server')),
  channel_first TEXT NOT NULL CHECK (channel_first IN ('web','googleplay','onestore','apps-in-toss')),
  -- 조회용 투영 (정본은 account_docs.core)
  level INTEGER NOT NULL DEFAULT 1, power INTEGER NOT NULL DEFAULT 0, stage_idx INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 0, gems_free INTEGER NOT NULL DEFAULT 0, gems_paid INTEGER NOT NULL DEFAULT 0,
  guild_id TEXT, shard INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX accounts_guild ON accounts(guild_id) WHERE guild_id IS NOT NULL;
CREATE INDEX accounts_seen  ON accounts(last_seen);
CREATE TABLE account_keys  (key_hash TEXT PRIMARY KEY CHECK (length(key_hash)=64), account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE INDEX account_keys_acct ON account_keys(account_id, last_seen);
CREATE TABLE account_links (provider TEXT NOT NULL CHECK (provider IN ('google','play_games','toss')),
  subject_hash TEXT NOT NULL, account_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(provider, subject_hash), UNIQUE(provider, account_id));
CREATE TABLE account_archive (archive_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, reason TEXT NOT NULL,
  doc TEXT NOT NULL, archived_at INTEGER NOT NULL, purge_at INTEGER NOT NULL);   -- 전환/삭제 시 90일 보관

-- ── 진행 문서와 원장 ───────────────────────────────────
CREATE TABLE account_docs (account_id TEXT NOT NULL, doc_name TEXT NOT NULL DEFAULT 'core',
  rev INTEGER NOT NULL, doc TEXT NOT NULL, bytes INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(account_id, doc_name), CHECK (bytes <= 262144));
CREATE TABLE wallet_ledger (op_id TEXT PRIMARY KEY,            -- cid / run:<id> / iap:<hash> / pull:<id>
  account_id TEXT NOT NULL, kind TEXT NOT NULL, delta TEXT NOT NULL, rev_after INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX wallet_ledger_acct ON wallet_ledger(account_id, at);
CREATE TABLE legacy_saves (legacy_id TEXT PRIMARY KEY,          -- sha256(installId)
  account_id TEXT UNIQUE NOT NULL, uploaded_at INTEGER NOT NULL, doc TEXT NOT NULL, report TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('shadow','imported','rejected','restored')));
CREATE TABLE mail (mail_id TEXT PRIMARY KEY,                    -- 'raid:w03:<acct>' 처럼 결정적 → 지연 생성 멱등
  account_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, rewards TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, claimed_at INTEGER);
CREATE INDEX mail_acct ON mail(account_id, claimed_at, created_at);

-- ── 런(전투) 티켓 ─────────────────────────────────────
CREATE TABLE run_tickets (run_id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('campaign','expedition','deep','rift','tower','raid','arena','party')),
  content_id TEXT NOT NULL, difficulty TEXT NOT NULL, hero_id TEXT NOT NULL,
  seed INTEGER NOT NULL, loot_seed INTEGER NOT NULL, hero_hash TEXT NOT NULL,   -- 시작 시 서버가 본 영웅/장비 요약 해시
  energy_spent INTEGER NOT NULL, party_run_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('open','settled','expired','refunded','rejected')),
  started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, settled_at INTEGER, verdict TEXT, result TEXT);
CREATE INDEX run_tickets_acct ON run_tickets(account_id, state, started_at);

-- ── 소환 ──────────────────────────────────────────────
CREATE TABLE gacha_log (pull_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, banner_id TEXT NOT NULL,
  odds_rev TEXT NOT NULL,                       -- 공개 확률표 해시(6.3). 로그와 공개표가 같은 해시여야 한다
  pity_before INTEGER NOT NULL, rarity TEXT NOT NULL, result TEXT NOT NULL, cost TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX gacha_log_acct ON gacha_log(account_id, at);

-- ── 판매/권한 (기존 store_* 확장: product_id CHECK 완화 마이그레이션 필요) ──
CREATE TABLE catalog_skus (sku_id TEXT PRIMARY KEY, kind TEXT NOT NULL, price_krw INTEGER NOT NULL,
  channels TEXT NOT NULL,                       -- JSON: {"googleplay":"<productId>","onestore":"..","apps-in-toss":".."}
  grant_json TEXT NOT NULL, season_id TEXT, limits TEXT, active INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL);
CREATE TABLE entitlements (account_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,   -- 'ad_free','monthly','vip','pass:s1'
  starts_at INTEGER NOT NULL, until INTEGER, source_order TEXT NOT NULL, revoked_at INTEGER,
  PRIMARY KEY(account_id, kind, ref));

-- ── 길드 ──────────────────────────────────────────────
CREATE TABLE guilds (guild_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, tag TEXT NOT NULL, leader_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1, gp INTEGER NOT NULL DEFAULT 0, notice TEXT NOT NULL DEFAULT '',
  join_mode TEXT NOT NULL DEFAULT 'approve' CHECK (join_mode IN ('open','approve','closed')),
  min_level INTEGER NOT NULL DEFAULT 1, member_count INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE guild_members (account_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL,   -- 계정당 길드 1개
  role TEXT NOT NULL CHECK (role IN ('leader','officer','member')), gp_week INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL, last_active INTEGER NOT NULL);
CREATE INDEX guild_members_guild ON guild_members(guild_id, role);
CREATE TABLE guild_log (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  kind TEXT NOT NULL,                       -- join/leave/kick/promote/transfer/donate/disband
  detail TEXT, at INTEGER NOT NULL);
CREATE INDEX guild_log_guild ON guild_log(guild_id, at);
CREATE TABLE guild_applications (guild_id TEXT NOT NULL, account_id TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY(guild_id, account_id));

-- ── 랭킹 / 레이드 / 아레나 ────────────────────────────
CREATE TABLE lb_scores (board_id TEXT NOT NULL, account_id TEXT NOT NULL, score INTEGER NOT NULL,
  tiebreak INTEGER NOT NULL DEFAULT 0, meta TEXT, verified INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY(board_id, account_id));
CREATE INDEX lb_scores_rank ON lb_scores(board_id, score DESC, tiebreak, account_id);
CREATE TABLE lb_hist (board_id TEXT NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(board_id, bucket));
CREATE TABLE raid_weeks (week_id TEXT PRIMARY KEY, boss_id TEXT NOT NULL, hp_total INTEGER NOT NULL,
  starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE raid_scores (week_id TEXT NOT NULL, account_id TEXT NOT NULL, total INTEGER NOT NULL,
  best TEXT NOT NULL,                              -- 상위 10회 피해 배열
  attempts INTEGER NOT NULL, tier INTEGER, claimed_at INTEGER, PRIMARY KEY(week_id, account_id));
CREATE TABLE arena_snapshots (account_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 1000,
  league TEXT NOT NULL, hero_id TEXT NOT NULL, build TEXT NOT NULL, ai_profile TEXT NOT NULL,
  shield_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE INDEX arena_rating ON arena_snapshots(season_id, rating);
CREATE TABLE arena_matches (match_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, attacker TEXT NOT NULL, defender TEXT NOT NULL,
  ra_before INTEGER NOT NULL, rd_before INTEGER NOT NULL, result TEXT, run_id TEXT, at INTEGER NOT NULL);
CREATE INDEX arena_matches_pair ON arena_matches(attacker, defender, at);

-- ── 제재 / 감사 ───────────────────────────────────────
CREATE TABLE sanctions (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mute','ban','rank_ban','payout_hold')), until INTEGER, reason TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE audit_flags (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, run_id TEXT,
  kind TEXT NOT NULL, severity INTEGER NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL, resolved_at INTEGER);
CREATE TABLE replay_index (run_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, r2_key TEXT NOT NULL, sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL, verdict TEXT CHECK (verdict IN ('pending','pass','fail','error')), verified_at INTEGER);
```

### 3.4 서버가 검증하는 것

#### 3.4.1 신뢰 단계

| 단계 | 내용 | 적용 |
|---|---|---|
| **T0 발급** | 런은 서버가 시작 시 티켓(`run_id`, `seed`, `loot_seed`, 영웅/장비 해시, 에너지 차감)을 발급. 정산은 티켓당 1회, 유효 2시간. 보상 수치는 **클라이언트 입력이 아니라 서버 규칙으로 계산**. | 모든 런 |
| **T1 개연성** | 경과 시간(서버 시계 대비 80~120%, 콘텐츠별 최소 클리어 시간), 처치 수 ≤ 시드 로스터 상한, 총 피해 ≤ 영웅 이론 최대 DPS × 경과 × 1.5, 소모품 사용 ≤ 보유, 부활 ≤ 상한, 피격량 ≤ 최대 체력 × (부활+1) 등. 표는 `tools/mmo-calibrate.mjs`가 헤드리스 AUTO 전투로 산출한 `src/shared/plausibility-table.json`(데이터 버전별). | 모든 런 |
| **T2 감사** | 입력 로그(20Hz 양자화, 평균 약 20~50KB/판)를 R2에 올리고 감사 러너가 같은 시드로 재생해 결과 해시를 대조. **랭킹 상위 100·레이드 상위 1%·아레나 레이팅 급상승·T1 경고 건**과 무작위 표본 1% 대상. 통과 전 보상은 "검증 대기". | 경쟁 콘텐츠, 선행: P4 난수 주입 |
| 플랫폼 증명 | Android는 Play Integrity 판정을 설정한 엔드포인트(런 정산, 랭킹 제출, 아레나)에 첨부. 웹은 증명 없음 → **랭킹 지급은 T2 통과 필수**(Android도 상위는 동일). | 경쟁 콘텐츠 |

현재 코드는 입력 리플레이로 결과를 재현할 수 없으므로(0.1절 2번) **P4 이전에는 T0+T1만 있고 순위 기반 보상은 지급하지 않는다.** PvE 지급은 상한이 있어 T0+T1로 충분하다(가장 큰 부정 이득 = "소탕과 같은 보상을 더 빨리 받기").

#### 3.4.2 런 시작/정산 파이프라인

```
POST /api/v1/runs/start {kind, contentId, difficulty, heroId, partyRunId?, cid}
  1) 세션·토큰 버전, 계정 상태, 연령/제재 확인
  2) /cmd와 같은 CAS 배치: 에너지 서버 계산 후 차감, run_tickets INSERT(open)
  3) 응답 {runId, seed, lootSeed, expiresAt, serverTime, rulesVersion}
     - 비경쟁 콘텐츠: seed = 기존 stage seed (재현·QA 용이), 경쟁 콘텐츠: 서버 난수 seed
     - lootSeed는 항상 서버 난수 (미리 계산 불가)

POST /api/v1/runs/{runId}/settle {win, elapsedMs, kills:{normal,elite,boss}, roomsCleared, hpLost, revives,
                                  consumables:{...}, damageDealt, inputDigest, attest?, integrity?}
  T0: 티켓 open·소유·만료 확인 (멱등: 이미 settled면 같은 영수증 반환)
  T1: 3.4.1 표의 검사. 위반 → verdict 'rejected' + audit_flags, 에너지 환불 없음(고의 의심) 또는
      'soft'(경계 초과 소폭)면 보상 50% 지급 + 플래그
  지급: settlement(ticket, verifiedFacts) = 순수 함수
      - 기본 보상 = 서버 데이터의 stage.rewards × 난이도 배율 (applyDifficulty와 동일 규칙 공유)
      - 필드 드랍 = rollKillLoot(table, rng(lootSeed, rank, killIndex)) 을 k=0..min(reportedKills, cap)-1 에 대해 재생성
      - 일일/주간 카운터, 패스 XP, 영웅 EXP도 EconomyCore가 같은 트랜잭션에서 처리
  배치: CAS 문서 갱신 + wallet_ledger('run:<id>') + run_tickets UPDATE(settled) + (경쟁이면) lb_scores / replay_index
  응답 {receiptId, got[], loot[], levelUps[], verdict}   ← 결과 화면은 이 영수증으로만 그린다
```

**전투 중 드랍 연출 보존**: 지금의 "드랍 우수수"는 전투 중 `drops.js`가 `Math.random()`으로 굴려 그 자리에서 보인다. 이를 `rollKillLoot(table, rng)` 순수 함수로 분리하고, `rng = mulberry32(hash(lootSeed, rank, killIndex))`로 호출한다. 클라이언트는 서버가 준 `lootSeed`로 **정산 때 서버가 줄 것과 정확히 같은 드랍**을 미리 보여 주고, 서버는 보고된 처치 수(상한 내)만큼 같은 시퀀스를 재생성해 지급한다. 클라이언트가 속일 수 있는 것은 처치 수뿐이고 그것은 T1 상한이 막는다. 전투 난수와 분리돼 있어 P4 난수 주입 이전에도 적용 가능하다.

**프리페치 티켓**: 전철·엘리베이터 오프라인을 위해 온라인일 때 `POST /runs/prefetch`로 최대 3장을 미리 받아 둘 수 있다(에너지는 발급 시 예약 차감, 12시간 후 미사용분 자동 환불). 오프라인에서 이 티켓으로 플레이하고 재접속 때 정산한다. 티켓이 없으면 연습 모드(보상 없음).

#### 3.4.3 소환(가챠)

`POST /api/v1/cmd {op:'pull', banner, count, cid}` — 서버가 현재 `GACHA`·`gachaChances()`·`rollResult()` 로직을 `src/shared/gacha-core.js`(P2-D가 `economy.js`에서 순수 부분 추출)로 호출해 **서버 난수**로 굴린다. 천장 카운터는 문서에, 각 소환은 `gacha_log`에 `odds_rev`(확률표 해시)와 함께 남긴다. 10연은 한 트랜잭션. 공개 확률표는 같은 모듈의 `gachaRates()/gachaContents()` 출력이며 `GET /api/v1/odds/{banner}`가 표와 해시를 돌려준다(클라이언트 표시·웹 페이지·로그가 한 해시로 맞물린다 — 6.3).

#### 3.4.4 IAP

`docs/COMMERCE-SERVER-CONTRACT-20260923.md`의 8개 요구를 그대로 채택하고 다음만 더한다.
- Play Billing 구매는 `obfuscatedExternalAccountId = accountId`로 열고, 서버 검증(`purchases.productsv2`)에서 같은 값이 돌아와야 지급한다(남의 영수증 재사용 차단).
- `store_ledger`의 `product_id CHECK ('remove_ads_v1')`를 카탈로그 기반으로 완화하는 마이그레이션(P2-E), `subject`(해시)를 `account_links`로 계정에 매핑, 지급은 **같은 D1 배치**에서 `wallet_ledger('iap:<purchase_hash>')` + 문서 갱신 + `entitlements`로 원자 처리한다(그래서 DB를 나누지 않는다).
- 환불/취소: 기존 시간당 cron에 `purchases.voidedpurchases` 조회를 추가(RTDN Pub/Sub 푸시는 선택, v1 불필요). 환불 시 지급 라인별 역분개: 유료 보석 잔액 차감(부족하면 **음수 허용 + 소비 차단**, 상습 시 `payout_hold`), 기간제(월정액·패스·VIP)는 `revoked_at` 설정. 부분/중복 이벤트는 `wallet_ledger` 멱등 키로 무해.
- 채널 간 결제는 섞지 않는다(웹 결제 영수증을 Play 증거로 쓰지 않음). 대신 **권한은 계정 단위**로 모든 채널에서 유효하다.

### 3.5 마을 샤드 (TownDirectory + TownShard)

**목적**: 광장에서 사람이 보이는 존재감. 게임플레이 효과 없음(상점·의뢰·문 입장은 REST/명령). 그래서 서버 신뢰 모델은 "속도·경계·빈도 검사"면 충분하다.

| 항목 | 값 | 근거 |
|---|---|---|
| 샤드 id | `town:<townId>:<n>` (`townId` ∈ oathhold/emberport/starcrest, 길드 거점은 P5 `guild:<id>`) | `src/data/towns.js` |
| 정원 | 소프트 30(배정 기준) / 하드 40 | 광장 24×24, 풀 렌더 16 + 라이트 24 |
| 배정 | `TownDirectory`(마을당 1 DO)가 **채우기 우선**: ① 친구/파티/길드 힌트가 있는 샤드 ② 가장 낮은 번호의 소프트캡 미만 샤드 ③ 새 샤드. 샤드는 5초마다 인원 하트비트. 입장 1회 DO 호출. | 활성 샤드 수 최소화 = 비용 최소 |
| 틱 | 서버 5Hz(200ms) 방송, 클라이언트는 5Hz 입력 + 보간 | 모바일 데이터·배터리 |
| 하이버네이션 | 사용 안 함(틱 타이머가 있는 동안 깨어 있음). 샤드가 비면 타이머를 끄고 DO가 퇴출. AFK 60초↑는 1Hz로 강등 | 비용 3.14 |
| 상태 저장 | 없음(메모리). 재시작 시 클라이언트가 `/town/enter`를 다시 호출 | 단순 |
| 관심 영역 | 광장이 작아 반경 대신 **가장 가까운 K=24명**만 전송, 나머지는 닉네임 점/목록 | 대역폭 상한 |

**입장**: `POST /api/v1/town/enter {townId, hint?}` → `{shardId, wsUrl, ticket(60s), roster?}`. 티켓 클레임에 서버가 계정 데이터에서 만든 **외형 블롭 `look`**(≤48B: `hero, weaponTier, armorTier, avatarId, auraGrade, emotes[≤3], frame`)이 들어 있어 클라이언트가 외형을 속일 수 없다.

**프로토콜**: WebSocket, 제어는 JSON 텍스트, 위치는 이진 프레임.

```
C→S  이진  MOVE   [0x01][seq u16][x i16][z i16][yaw u8][anim u8][flags u8]          = 9 B,  ≤5Hz, 정지 시 2초 하트비트
             x,z = 0.01 유닛 양자화(경계 ±12 → ±1200), yaw = 2π/256, anim = 0 idle 1 walk 2 emote 3 sit …
C→S  JSON  {"t":"emote","id":<emoteId>}                      ≤1/2s,  {"t":"ping"}  {"t":"leave"}
S→C  이진  SNAP   [0x02][tick u16][n u8] n×[slot u8][x i16][z i16][yaw u8][anim u8]   = 3 + 7n B, 5Hz, 변경분만(+2초 키프레임)
S→C  JSON  {"t":"enter","slot":7,"acct":"p_…","name":"이름#1234","look":{…},"guild":"TAG","title":"…"}
S→C  JSON  {"t":"leave","slot":7}   {"t":"emote","slot":7,"id":3}   {"t":"banner","kind":"raid","hp":0.62}   {"t":"err","code":"rate"}
```

- **검증**: 경계 ±12 클램프, 속도 ≤ `HubMovement.speed(4.2)` × 1.3, 위반 3회/10초 → 서버가 스냅백 좌표를 보내고 `audit_flags`. 메시지 ≤ 10/s, ≤ 64B(텍스트)·16B(이진), 위반 시 1008 종료. 이모트 쿨다운 서버 적용.
- **채팅 말풍선**: 채팅은 SocialHub 소켓이 담당(채널 id = 샤드 id로 일반화, P2-C). 클라이언트가 해당 `slot`의 말풍선으로 표시. 소켓이 2개지만 둘 다 유휴 시 경량이고 SocialHub는 하이버네이션한다.
- **대역폭 예산(예상)**: 하향 5Hz × (3 + 7×24=171B) ≤ 855 B/s, 평균(델타) 약 450 B/s + JSON 이벤트 약 300 B/s → **평균 1KB/s 미만, 상한 4KB/s**(시간당 약 3.6MB). 상향 5Hz × 9B + 프레임 오버헤드 ≈ 100 B/s. 초과 시 서버가 K를 줄여(24→16→8) 자동 강등.
- **클라이언트 렌더**: 풀 렌더는 가까운 16명(영웅 GLB는 이미 로드된 5종 재사용, 스킨드 메시라 인스턴싱 불가), 나머지는 닉네임 빌보드. 마을 장면의 드로우콜은 PRD 상한(≤420) 안에서 측정한다.
- **빈 마을 문제**: 샤드 인원이 8 미만이면 클라이언트가 "NPC 모험가"를 배경으로 걷게 한다(이름 앞에 NPC 표시, 플레이어 사칭 금지, 서버 통신 없음).
- **실패 처리**: 연결이 끊기면 지수 백오프로 `/town/enter` 재호출(최대 5회) 후 "오프라인 마을(싱글)"로 복귀 — 지금의 선택형 허브가 폴백이다.

### 3.6 파티 던전 — 호스트 권위 유지 (선택과 이유)

| 대안 | 판단 |
|---|---|
| A. 서버 권위 시뮬(DO가 적·피해를 계산) | **기각.** 전투 코드가 Three.js 객체·애니메이션 상태에 얽혀 있어 DO로 옮기려면 대규모 분리가 필요하고, 10Hz×180 적 시뮬이 DO CPU/시간 비용을 키운다. 지금 구조와 전투 손맛(호스트 로컬 60fps)을 해친다. |
| B. 호스트 권위 + 중계(현행) 그대로 | 보상이 없는 지금은 충분. 보상을 붙이면 호스트가 가짜 결과를 낼 수 있다. |
| **C. B + 서버 attestation + 멤버별 정산 (채택)** | PartyRoom DO(신뢰 가능한 서버 구성요소)가 방의 실제 지속 시간·인원·최종 상태·마지막 스냅샷 틱을 **서명 기록**으로 남기고, 멤버 각자가 자기 티켓으로 정산할 때 이 기록이 필요하다. 가짜 파티·너무 짧은 판·인원 위조를 막고, 호스트가 거짓 승리를 보고해도 보상은 T0/T1 상한(=소탕 수준)으로 제한된다. |

**PartyRoom v2 변경**(`worker/party-state.ts`, `worker/party.ts` — P3-A):
1. **계정 바인딩**: 참가는 서명 WS 토큰(`aud=party`)으로. 이름·영웅·아바타는 쿼리가 아니라 토큰의 서버 데이터에서 읽는다. 방 생성도 인증된 API로.
2. **시작**: `start`가 멤버별 `run_tickets(kind='party')` 발급(에너지 차감)을 DO가 같은 모듈(`worker/v1/tickets.ts`)로 D1에 직접 수행. 한 명이라도 에너지 부족이면 `start` 거부.
3. **이탈**: 게스트가 나가면 **런 계속**(현재는 전원 종료; 스냅샷 멤버 검증을 "전체 일치"에서 "활성 멤버 ⊆ 스냅샷 플레이어"로 완화해야 한다). 남은 인원이 1명이면 동행(네브) 계승을 제안. 호스트가 나가면 `partial` 종료 — 호스트 이전은 v1에서 하지 않는다(시뮬 상태가 호스트 메모리에만 있다).
4. **종료/attestation**: `finish`/`abort` 시 DO가 `{roomCode, runId, stageIdx, difficulty, seed, startedAt, endedAt, win, partial?:{roomsCleared}, members:[{accountId, heroId}], stats, lastSnapshotTick, hostId}`를 `ATTEST_HMAC`로 서명해 각 멤버에게 전달. 멤버는 `POST /runs/{id}/settle {attest}`로 정산. 서버는 서명·런 일치·`endedAt - startedAt`·인원 수를 검증.
5. **부분 보상**: 호스트 이탈·만료(`partial`) = 기본 보상 × `roomsCleared/총 방` × 0.5, 에너지 50% 환불. 완주 = 솔로 동등 보상 + 협동 보너스(일 3회까지 +20%, 서버 카운터).
6. **정규화**: 현재는 전원 Lv.20 고정(`partyHeroState`). v2는 **콘텐츠 권장 레벨/전투력으로 동기화(상향·하향)** — 실제 장비는 쓰되 콘텐츠 상한 `power × 1.3`으로 클램프. 과잉 전투력의 "버스" 방지와 저전투력 참여 가능을 동시에.
7. **스냅샷 델타/이진화**(P3-C): `pv` 협상은 **방 단위**다(방 생성 시 호스트의 `pv`가 방의 `pv`, 입장 시 `pv`가 다르면 `409 protocol`로 업데이트 안내 — 기존 `visuals/avatars/heroHits`처럼 클라이언트별로 변환하지 않는다. 배포 직후에는 `pv=1` 방도 허용하고 점유율이 낮아지면 닫는다). 목표 게스트 하향 ≤ 15KB/s, 상한 40KB/s. 필드: 전체 키프레임 2초마다, 그 사이 변경된 적/플레이어/이벤트만, 위치는 0.01 양자화.
8. **자동 매칭**(P3-D): `MatchQueue` DO(콘텐츠 id별 1개). 클라이언트가 2초 간격 폴링(`POST /match/join`, `GET /match/status`), 20초 안에 2~4명 채우고 못 채우면 **네브(동행)로 빈자리 채움**. 방장은 `hostScore`(최근 RTT·프레임 시간·배터리) 최고 멤버. 방은 기존 `PartyRoom`을 서버가 직접 만든다. 기존 코드 초대/모집(SocialHub `listings`)도 유지.

레이트 한계(기존 유지): 방 생성 5/분·참가 30/분 IP 게이트, 계정 단위 `start` 분당 6회 추가.

**v2 메시지 변경 요약**(기존 `type` 필드·검증 패턴 유지, 새 필드는 협상된 클라이언트에만):

```jsonc
// WS 입장: GET /api/party/<code>?auth=<서명 티켓>&pv=2&visuals=1&avatars=1&heroHits=1   (name/hero/avatar 쿼리 폐지)
// S→C  start   {"type":"start","run":{...},"members":[...],"ticket":{"runId":"…","expiresAt":…}}   ← ticket은 수신자 본인 것만
// S→C  attest  {"type":"attest","attest":{"roomCode","runId","stageIdx","difficulty","seed","startedAt","endedAt","win",
//               "partial":{"roomsCleared":4}|null,"members":[{"accountId","heroId"}],"stats":{...},"lastSnapshotTick","hostId"},"sig":"<hmac>"}
// S→C  member  {"type":"member","event":"left","playerId":"…","continues":true}     ← 게스트 이탈 시 abort 대신
// S→C  snap(v2) {"type":"snap","v":2,"seq":812,"base":800,"tick":9120,
//               "p":[[slot,x,z,yaw,hp,state,anim,ult]],              // 플레이어(0.01 양자화)
//               "e":{"add":[[id,key,x,z,yaw,hp,maxHp,flags]],"upd":[[id,x,z,yaw,hp,state]],"del":[id]},
//               "ev":[...],"vis":[...]}                               // base=0이면 키프레임(2초마다)
// C→S  input   기존과 동일 (seq, x, y, attack, actions)
```

같은 방에 구/신 프로토콜을 섞지 않는다.

### 3.7 길드

- **저장**: D1(`guilds`, `guild_members`, `guild_applications`; 3.3 DDL) — 길드 DO는 두지 않는다. 검색(이름/레벨/모집 중)·정렬·트랜잭션이 본업이고 쓰기 충돌은 길드당 30명이라 낮다. 채팅은 SocialHub 채널 `guild:<id>`(P3-E). 실시간 길드 거점은 P5에서 `TownShard`를 `guild:<id>` 인스턴스로 재사용.
- **규모/역할**: 길드당 최대 30명(레벨 상승 시 +5, 최대 50), 역할 leader/officer(최대 3)/member. 계정당 1길드(PK로 강제). 가입 Lv.10↑, 길드 창설 골드 50,000(유료 불가), 길드장은 **연동 계정만**. 탈퇴 후 다른 길드 보너스 수령 24시간 쿨다운. 길드장 14일 미접속 시 부길드장→활동 순 자동 위임.
- **진행**: 길드 포인트(GP)는 ① 일일 출석 ② 골드 기부(일 3회, 골드 소각) ③ 레이드/아레나/타워 참여로 쌓인다. 길드 레벨은 GP 구간. **혜택은 PvP 능력치가 아닌 편의**: 골드 +5%/+10%, 일일 계약 보상 소폭 가산, 기부 상한, 길드 상자(주간 목표), 거점 꾸미기. 길드 대항 레이드 점수 = 멤버 주간 레이드 점수 합(보드 `guild_raid:wNN`).
- **동시성**: 모든 변경은 단일 D1 배치 + `member_count`·역할 조건부 UPDATE(`WHERE member_count < cap`). 중복 가입/동시 위임 테스트를 P3 수용 기준에 둔다.
- **남용 방지**: 길드명 필터(3.11), 개설 레이트 계정당 일 1회, 신규 계정(가입 24시간 미만) 길드 개설 금지, 강퇴/탈퇴 로그 `guild_log`.

### 3.8 월드 보스 / 주간 레이드

**모델: 인스턴스 도전 + 서버 공유 HP.** 실시간 동시 전투가 아니라, 모든 플레이어가 각자(솔로 또는 파티) 120초 인스턴스에서 같은 주간 보스를 공격하고 **누적 피해가 서버 전체 HP를 깎는다.** 이유: 수만 명 실시간 동기화 없이 "서버 전체가 한 보스를 잡는" 감각을 얻고, 기존 보스 시그니처·전투 코드를 그대로 쓰며, 서버 부하는 "피해 보고" 요청뿐이다.

| 항목 | 설계 |
|---|---|
| 주기 | 주 1 보스, KST 월 05:00 시작 ~ 다음 월 05:00 종료(`periodAt().nextWeekResetAt`) |
| 시도 | 일 무료 3회(리셋 05:00) + 이벤트/패스 보너스 최대 일 6회. 한 시도 = 120초(90초에 격노). 입장 `POST /raid/attempt/start`(티켓 `kind='raid'`) → 클라이언트 전투 → `POST /raid/attempt/settle {damage, elapsedMs, inputDigest, integrity}` |
| 검증 | T0 티켓 + T1: `damage ≤ maxDps(hero power) × elapsed × 1.5`. 상위 1%·격노 이후 비정상 곡선은 T2 감사 대기. |
| 집계 | `WorldBossDO`(id `raid:<weekId>`)가 `addDamage(accountId, damage, runId)`를 직렬 처리: 전체 누적 피해, 개인 상위 10회 합(= 개인 점수), 참가자 수. SQLite 저장 + 5초 알람으로 KV `raid:<weekId>:state`(HP%, 마일스톤, 상위 100)에 스냅샷. 클라이언트는 10초 폴링(KV 캐시). |
| 보스 HP | `hpTotal(w) = clamp(1.1 × 전주 누적피해 × √(전주 대비 DAU 증가율), 0.8×, 1.5×)`, 첫 주는 베타 데이터로 설정. 마일스톤 20/40/60/80/100%마다 **전 서버 참가자 보상**(참가 1회 이상). |
| 결산 | 종료 알람 → 순위 확정 → 지급은 **지연 생성**: 플레이어가 `GET /raid/result/{week}`를 열 때 서버가 개인 점수의 백분위로 등급을 정하고 `mail('raid:<week>:<acct>')` 한 건을 INSERT OR IGNORE (팬아웃 쓰기 0). 상위 1% 등급은 감사 통과 후 해제. |
| 보상 | 등급별(참가/20%/5%/1%) 재료·영웅 조각·**외형/칭호**(능력치 상품 아님), 서버 처치 시 전원 추가 상자. 수치는 페이싱 시뮬이 정한다(7.6). |
| 파티 모드 | P5: 2~4인 파티가 하나의 인스턴스에서 도전. 피해는 호스트 보고 + 파티 attestation 사용, 인원 보정 계수 적용. v1은 솔로만. |
| 길드 연동 | 길드 점수 = 멤버 개인 점수 합 → `guild_raid` 보드, 길드 상자 지급 |
| 연출 | 마을 `banner` 방송(HP%·"격파!"), SocialHub 시스템 메시지, 디스코드 명예 웹훅(서버 첫 격파) |
| 부하 | 10만 DAU에서도 일 3회×10만 = 30만 요청/일(평균 3.5rps, 피크 약 35rps) — 단일 DO 충분 |

### 3.9 랭킹

| 보드 | 점수 | 주기 | 지급 전 검증 |
|---|---|---|---|
| `tower:s{n}` | 무한의 성(타워) 최고 도달 층, 동점은 먼저 도달한 순 | 시즌(12주) | 상위 100 T2 |
| `raid:w{nn}` | 개인 주간 점수(상위 10회 피해 합) | 주 | 상위 1% T2 |
| `guild_raid:w{nn}` | 길드원 개인 점수 합 | 주 | 길드 상위 10 중 상위 멤버 T2 |
| `arena:s{n}` | 레이팅 | 아레나 시즌(4주) | 상위 100 T2 + 급상승 건 |
| `speed:{contentId}` | 최단 클리어 ms | 상시 | **기존 SocialHub 명예의 전당 유지**(최초/최단) |
| (없음) | **전투력/장비 점수 랭킹은 만들지 않는다** | — | 과금 격차 노출·자동화 부정 유인 |

- **쓰기**: 점수가 올랐을 때만 `INSERT … ON CONFLICT DO UPDATE SET score=excluded.score WHERE excluded.score > lb_scores.score`. `verified=0`으로 들어가고 T2 통과 시 1. 지급 계산은 `verified=1`만 본다.
- **읽기**: 상위 100은 `lb:<board>:top100`을 KV에 30~60초 캐시(크론/큐 갱신). "내 순위"는 정확한 순번이 **상위 1,000위까지만** — `SELECT COUNT(*) FROM (SELECT 1 FROM lb_scores WHERE board_id=? AND (score>?1 OR (score=?1 AND tiebreak<?2)) LIMIT 1001)`로 스캔을 1,001행으로 자른다. 1,000위 밖은 `lb_hist`(점수 로그 버킷 1,000개, 5분 크론이 갱신) 백분위로 "상위 12%"를 표시한다. 정확 순위를 매번 `COUNT(*)`로 구하면 D1이 행 읽기를 순위 범위만큼 과금하므로 피한다.
- **시즌 종료**: 알람/크론이 보드를 동결(`status='frozen'`)하고 보상은 레이드와 같이 지연 생성 우편. 보드 행은 시즌 후 90일 보관.
- **명예의 전당 연동**: 시즌 1위·최초 격파는 기존 `fame` 시스템(디스코드 웹훅 포함)에 칭호로 남긴다.

### 3.10 PvP 비동기 아레나 — AI 조종 빌드 스냅샷 (선택과 이유)

| 대안 | 판단 |
|---|---|
| 입력 고스트 재생(상대의 기록된 입력을 재생) | **기각.** ① 결정성이 없다(0.1절 2번). ② 상대는 내 행동에 반응하지 않아 "빈 샌드백"이다. ③ 입력 로그 보관·전송 비용. |
| 실시간 1:1 | **기각(v1).** 지연 보상·동기화·부정 방지가 별도 프로젝트. 5G 환경이 아닌 곳에서 손맛 저하. |
| **상대 빌드 스냅샷 + 기존 AUTO AI 조종 (채택)** | `ARENA_RIVALS`(AI 상대 6명)와 `Player.auto`·AUTO 조준/회복 AI가 이미 있다. 서버가 보관한 상대의 영웅·장비·스킬 로드아웃·각성·외형으로 `Player`를 구성하고 AUTO가 조종한다. 상대가 오프라인이어도 되고, 전투는 클라이언트 로컬이라 손맛이 같다. |

- **스냅샷**: `arena_snapshots`에 서버가 소유한 데이터(`account_docs.core`)로 생성/갱신(빌드 변경 시, 일 1회). 클라이언트가 보낸 값이 아니므로 위조 불가. `ai_profile`은 최근 PvE 정산 통계에서 서버가 계산한 성향(공격성, 회피 빈도, 궁극기 사용 시점 지연)이며 기본값은 중립.
- **매칭**: `GET /arena/opponents` → 레이팅 ±100 범위에서 3명(낮음/비슷/높음), 최근 24시간 내 2번 싸운 상대 제외, `shield_until`(방어 후 30분 보호) 제외. 같은 상대 일 2회 제한(승부 조작 방지).
- **전투**: 90초 1:1. 시작 `POST /arena/start`(티켓 `kind='arena'`, 일 무료 5회 + 2시간마다 1회 충전, 유료 추가 일 5회 한도), 정산 `POST /arena/settle`. 승리 = 상대 처치 또는 시간 종료 시 잔여 HP% 우위.
- **레이팅**: Elo 변형(K=24)을 공격자에게 적용. 방어자는 패배 시 최대 −8, 승리 시 +0, 리그 하한 아래로 내려가지 않음. 하위 상대 승리 이득은 감쇠. 리그: 브론즈·실버·골드·플래티넘·다이아·챔피언.
- **정규화(과금 격차 억제)**: 아레나 전용 규칙 `ARENA_RULES = {levelCap:60, enhCap:12, gradeBonus:'SSR 고정(skillMul≤1.2, cdMul≥0.92)', consumables:false, awakening:'허용', cosmetics:'전부 표시'}`. SSSR의 능력치 배율(2.6)·스킬 배율(1.45)은 아레나에서 SSR 수준으로 눌린다. 외형·오라는 그대로 보이므로 과금 동기는 유지된다.
- **감사**: 레이팅 상승폭 상위/급상승, 초단시간 승리는 T2 대상(P4 이후). P4 이전에는 지급 보상 없이 레이팅만 표시한다.
- **UI**: 기존 아레나 로비 화면(`ARENA_RIVALS` 카드)의 데이터 소스만 서버 상대 3명으로 교체, 6명의 AI 상대는 "연습" 탭으로 유지(오프라인 가능, 보상 없음).

### 3.11 채팅·모더레이션·법규

**구조**: 기존 SocialHub를 유지하되 (a) 채널 모델을 `world-N` 고정에서 **임의 채널 id**(`town:<id>:<n>`, `guild:<id>`, `party:<code>`)로 일반화(`packages/tll-social` 설정 `channelResolver`), (b) 단일 DO 한계 대비 트리거를 둔다: **동시접속 300 초과 또는 DO 요청 p95 > 150ms가 3일 지속되면 채널별 `ChatChannel` DO로 분리**(친구·명예·게시판은 SocialHub에 남김).

| 항목 | 설계 |
|---|---|
| 필터 | 현행 `maskBanned`(짧은 기본 단어 + 구분자 허용)에 **한국어 정규화** 추가: NFKC → 제로폭 제거 → 3회↑ 반복 문자 축약 → 한글 자모 분해 매칭(초성 `ㅅㅂ`·`ㅂㅅ`·`ㅈㄹ`) → 숫자·기호 치환(`시1발`, `ㅅ1ㅂㅏㄹ`) → 띄어쓰기 무시. 단어 목록은 KV `moderation:wordlist:v{n}`(3단계: 차단/마스킹/경고)에서 60초마다 핫리로드(배포 불필요). 현행 URL 마스킹 유지(허용 목록: `blade.tllhouse.com`). |
| 개인정보 | 전화번호(`01x-xxxx-xxxx`), 이메일, 카카오톡/오픈채팅 ID 문구, 계좌번호 패턴은 **전송 차단**("개인정보는 보낼 수 없습니다"). |
| 연령 | `u14`: 자유 채팅·귓속말·길드 채팅 비활성(프리셋 이모트·정형 문구만). `14_17`: 엄격 필터 단계. `18p`: 표준. 서버가 `age_band`로 채널 입장을 제한. |
| 신규 계정 제한 | 광장(월드/마을) 채팅은 계정 Lv.10 + 누적 플레이 30분 이후. 친구/파티/길드 채팅은 제한 없음. 스팸 신규 계정 방어. |
| 신고 | 기존 `reports`(채팅 ref 필수·작성자 검증, 시간당 10, 서로 다른 신고자 3명 자동 음소거 1시간) 유지. 중대 카테고리(성적, 개인정보, 자해, 아동)는 즉시 큐 + 디스코드 운영 웹훅. 신고 대상 메시지와 앞뒤 10건을 **90일 보관**(그 외 채팅 로그는 기존 채널별 최근 50건만). |
| 차단 | 기존 서버측 차단(채팅·귓속말·초대·친구·모집 필터링) 유지. 클라이언트 설정: 광장 채팅 끄기, 말풍선 끄기. |
| 제재 | `sanctions`(mute/ban/rank_ban/payout_hold)는 **계정·연동 subject** 단위(기기 식별자 비사용). 제재 후 새 게스트 계정으로 우회해도 위 "신규 계정 제한"(Lv.10·30분)이 광장 채팅을 막는다. |
| 운영 도구 | 기존 `/admin/*`(mute/ban/revoke-clear) + P5-B 관리자 콘솔(신고 큐, 제재 이력, 계정 조회, 원장 조회, 제재 해제, 보상 회수). |
| 자동 점검(선택) | 신고된 메시지 비동기 분류에 Workers AI 안전 분류 모델을 쓰는 안은 P5 이후 검토(오탐 시 자동 제재 금지, 사람 큐로만). |
| 앱인토스 채널 | 토스 정책 확인 전까지 **프리셋 이모트/정형 문구만**. 확인되면 플래그로 해제. |

**한국 규정 반영 요구(개발 요구사항 수준 — 조항·수치·고지 문구는 출시 전 법무 확인)**

| 규정 | 개발 반영 |
|---|---|
| 게임산업법상 확률형 아이템 정보공개 | 유상 판매되는 모든 확률형 상품(소환, 랜덤 박스 형태 패키지 `boss_pack`의 "SSR 장비 상자" 등)의 종류별 확률·천장/픽업 규칙을 **게임 안(구매 직전 화면 + 상시 메뉴)과 공식 웹 페이지에 동시 게시**하고, 실제 서버 확률과 일치함을 로그로 증명(6.3). 확률표 변경 이력 보관. 컴플리트(콤플리트) 가챠 형태 운영 금지. |
| 전자상거래법(청약철회, 환불) | 결제 화면에 철회 제한 고지, 미사용 유료 재화 환불 가능(유료/무료 재화 분리 저장: `gems_paid`/`gems_free`, 무료 먼저 소모해 유료 잔액 보존), 기간제 상품 해지 처리, 결제·환불 원장 법정 기간 보관. |
| 청소년 보호 | `age_band`별 결제 한도 정책을 KV 설정으로(값은 운영 정책), 스토어 부모 동의 기능과 병행. 강제 셧다운은 폐지되어 별도 구현 없음(확인 필요). |
| 개인정보보호법 | 최소 수집(이메일·이름 비저장, subject 해시), 14세 미만 연동·결제 차단, 처리방침 갱신(`public/privacy.html`), 삭제권(3.2). |
| 정보통신망법(불법정보) | 신고·조치 체계(위 표), 임시 조치 요청 접수 창구(`support.html`). |
| 게임물 등급 | 오픈마켓 자체등급분류 설문에 "사용자 간 채팅·상호작용, 확률형 아이템, 사용자 생성 이름" 항목 갱신(`docs/STORE_RELEASE_20261012.md` 설문 초안 개정). |
| 스토어 정책 | Google Play: 랜덤 아이템 구매 전 확률 공개, 계정 삭제 경로. Apps in Toss / ONE Store: 각 채널 약관 확인(채널별 설문 별도). |

### 3.12 안티치트·레이트 리밋

**레이트 한계 구현**: 고빈도·민감 엔드포인트는 `RateGate` DO 64개(계정/IP 해시로 분산, SQLite 카운터 — 기존 파티 IP 게이트와 같은 패턴), `/cmd`는 `rev` CAS가 자연스러운 직렬화다. D1로 매 요청을 세지 않는다(쓰기 과금).

| 대상 | 한계(계정 기준, 별도 표기 제외) |
|---|---|
| `POST /auth/session` | 키당 10/시간, IP당 30/시간 |
| 새 계정 생성 | IP당 5/시간(소셜 프로필 생성과 동일) |
| `/cmd` | 20/s(버스트 40), 연속 409 5회 시 1초 백오프 지시 |
| `/runs/start` | 120/시간(에너지·티켓이 실제 한도), 미정산 티켓 동시 5개 |
| `/runs/settle` | 티켓당 1회, 60/시간 |
| `pull` | 20/분 |
| 링크/복구 | 소셜 계약 유지(IP당 10/시간 등) |
| 마을 | 3.5절 |
| 채팅/신고 | 소셜 계약 유지 |
| 레이드 시도 | 티켓 수(일 3~6), 정산 중복 불가 |
| 아레나 | 티켓, 같은 상대 일 2회 |
| 길드 | 창설 일 1회, 가입 신청 일 10건, 기부 일 3회 |

**부정 탐지**
1. **경제 이상치**: 큐 작업이 매일 계정별 시간당 골드·드랍·EXP 생산량을 계산, 참조 분포의 p99.9×3 초과 시 `audit_flags`(severity 2), 합산 발행량이 모델 대비 ±30% 벗어나면 운영 경고.
2. **정산 이상**: T1 위반 유형별 집계, 같은 `inputDigest` 반복(재전송), 시드 재사용, 시간대 편중(봇 의심: 24시간 중 22시간 이상 정산).
3. **봇/자동화**: 마을 이동의 비인간 패턴(직선·고정 간격), 아레나 같은 상대 반복. 자동 제재 없이 `payout_hold` + 사람 검토.
4. **클라이언트 무결성**: Android는 Play Integrity(앱 인식, 기기 무결성)를 랭킹/레이드/아레나 정산에 첨부, 실패해도 PvE는 허용(경쟁 보상만 보류). APK 서명 해시 허용 목록은 KV.
5. **서버측 제재 철회**: 오탐 복구용 `sanctions` 해제와 보상 회수/지급을 `wallet_ledger` 보정 라인(`kind='gm_adjust'`)으로 감사 가능하게.
6. **개발자 도구 노출 차단**: `window.app`·`__EN` 등 디버그 노출(`src/main.js`)을 프로덕션 번들에서는 서버 권위 모드일 때 읽기 전용 최소 집합으로 제한(권위는 서버에 있으므로 보안 경계는 아니고 부정 난이도만 올린다).

### 3.13 운영·관측·킬스위치

- **원격 설정**: KV `CACHE:flags` — `town, party_rewards, raid, arena, iap, chat, ranked_payout` 개별 on/off, 샤드 캡/틱/K, 필터 버전, 보상 배율, 계정 `authority` 컷오버 비율. 클라이언트는 `/me`에서 받음. 장애 시 기능 단위로 끄고 PvE 로컬 연습으로 폴백.
- **서버 KPI**: Analytics Engine 데이터셋 `blade_events`(스키마 고정, 자유 문자열·개인정보 금지 — 현행 `funnel-events.js`의 철학을 서버로 확장): 설치/세션/퍼널/결제 노출·시작·성공/D1·D7·D30/DAU·MAU/마을 체류/파티 매칭 시간/레이드 참여율/길드 가입률/신고율/지연. 일일 요약을 D1 `kpi_daily`에 크론으로.
- **알림**: 크론이 지표(오류율, D1 지연, 샤드 포화, 큐 적체, 경제 이상치)를 점검해 디스코드 운영 웹훅.
- **백업/복구**: D1 Time Travel(30일) + 주 1회 R2 내보내기. 계정 단위 복구는 `wallet_ledger` 재생 + `legacy_saves`. 배포는 기존 컨트롤러(`tools/deploy.mjs`)·롤백 규칙을 그대로 따르고 DO 마이그레이션은 새 태그로만 추가한다.
- **점검 공지·롤링**: 신규 기능은 `accounts.shard`(0~99) 기반 점진 개방.

### 3.14 비용 추정 (Cloudflare Workers Paid)

**가정**(측정 전 값; 베타에서 교체): MAU = DAU ÷ 0.28. 피크 동접 = DAU × 6%. 1인 일 플레이 35분 = 솔로 55% / 마을 25%(약 9분) / 파티 20%(약 7분). Worker API 요청 60건/DAU/일, 평균 CPU 5ms. D1 쓰기 170행/DAU/일(문서 방식 판당 약 4행 + 명령·소환 로그·길드·랭킹·인덱스 갱신을 포함한 보수 추정), 읽기 400행/DAU/일. 파티 1판 10분·4인, 입력 20Hz+스냅샷 10Hz → DO 수신 70msg/s(WebSocket 수신 20:1 청구), 128MB. 마을 샤드 평균 충원 15명, 5Hz 수신. 단가는 기억 기준이며 **출시 전 Cloudflare 요금표로 재확인**: Workers 요청 $0.30/M(1천만 포함)·CPU $0.02/M ms(3천만 포함), DO 요청 $0.15/M(100만 포함)·지속시간 $12.50/M GB-s(40만 포함), D1 쓰기 $1.00/M행(5천만 포함)·읽기 $0.001/M행(250억 포함)·저장 $0.75/GB(5GB 포함), KV 읽기 $0.50/M(1천만)·쓰기 $5/M(100만), 기본 $5/월. R2/Queues/Analytics Engine/Workers AI는 사용량이 작아 표에서 제외(합계 월 $10 미만으로 가정).

| 항목 | 1k DAU | 10k DAU | 100k DAU |
|---|---:|---:|---:|
| Worker 요청+CPU | $0 | $4 | $68 |
| D1 쓰기 | $0 | $1 | $460 |
| DO 요청(파티·마을·기타) | $2 | $23 | $229 |
| DO 지속시간(파티·마을·소셜) | $6 | $65 | $660 |
| KV | $0 | $0 | $7 |
| 기본료 | $5 | $5 | $5 |
| **월 합계(계산값)** | **약 $13** | **약 $98** | **약 $1,430** |
| 안전 계수 ×2 (예산 책정) | $26 | $200 | $2,900 |

산출 근거 일부: 10k DAU 월 파티 판 약 5.25만 판, 마을 샤드 가동 약 3,000 샤드·시간, Worker 요청 1.8천만, D1 쓰기 5,100만 행. 100k DAU는 D1 쓰기(5.1억 행)와 DO 지속시간이 지배한다.
**매출 대비**: 결제자 = MAU의 1%, ARPPU ₩25,000/월(가정), ₩1,400/$ → 1k DAU 월 약 $650, 10k DAU 약 $6,400, 100k DAU 약 $64,000(스토어 수수료 전). 인프라 비중은 1.5~2.2% 수준이라 **비용이 제약이 아니다. 제약은 운영 인력과 콘텐츠 제작이다.**

**스케일 트리거**: ① D1 쓰기 지속 150 TPS 또는 p95 쿼리 > 30ms → 계정 테이블을 `crc32(account_id)%4` D1 4개로 분할(전역 테이블은 별도 DB) ② SocialHub 동접 300↑ → 채널 DO 분리(3.11) ③ 마을 샤드 평균 충원 < 10이 7일 지속 → 소프트캡 상향·틱 완화 ④ 파티 하향 평균 > 40KB/s → 델타 정책 재검토.

## 4. 로컬 세이브 → 서버 계정 이전 (손실 없음)

**원칙**: ① 어느 시점에도 사용자의 로컬 세이브를 지우거나 덮어쓰지 않는다 ② 서버 권위로의 전환은 계정 단위·되돌릴 수 있게 ③ 현금으로 산 것은 아직 없다(`STORE_BILLING_ENABLED=false`, 유일한 상품 `remove_ads_v1`은 스토어 원장이 이미 정본)이므로 이전의 위험은 "정당한 진행의 과도한 삭감"과 "부정 진행의 합법화"뿐이다.

| 단계 | 서버 | 클라이언트 | 롤백 |
|---|---|---|---|
| **M0 어두운 배포** | `/api/v1/*`, 스키마, `authority='shadow'`, 플래그 off | 신규 클라이언트가 `installId`(랜덤 UUID)를 세이브에 추가, 게스트 계정 생성 | 플래그 off |
| **M1 그림자 모드**(권장 2~3주) | 클라이언트가 세이브 스냅샷(`POST /import`)과 **명령 로그+상태 해시**를 업로드. 서버는 `legacy_saves`에 원문 보관, 정화(아래) 결과와 이상치 보고서 생성, 서버 규칙을 재생해 **클라이언트 규칙과 패리티 측정**(결정적 연산은 해시 일치, 난수 연산은 결과 집합 검증). 로컬이 여전히 권위. | 동작 변화 없음 | 서버 데이터 폐기 가능 |
| **M2 계정 컷오버** | 계정별 `authority='server'` 전환(비율 배포: `shard` 기준 5% → 25% → 100%). 정화된 문서가 `account_docs.core`. | `/me`로 서버 문서를 받아 화면 갱신. 로컬은 캐시 + 오프라인 연습. 컷오버 화면에 "이 기기의 진행: Lv.X / 서버 계정: Lv.Y" 표시 | 계정 단위로 `authority='shadow'` 복귀 + `legacy_saves` 복원(`status='restored'`) |
| **M3 신규 기본** | 신규 설치는 처음부터 `server` | 로컬은 캐시 | — |
| **M4 로컬 쓰기 차단** | 서버 권위 계정의 클라이언트 로컬 지급 경로 제거(`Economy`는 예측기만) | 개발자 도구 변조 무효 | — |

**정화(sanitize) 규칙**(`worker/v1/import.ts`, `normalizeSave`를 서버에서 재사용):
1. 구조·ID 검증: 알 수 없는 아이템/영웅/스테이지 키 제거, `enh ≤ 20`, 레벨 ≤ 80, `progress.unlocked ≤ 60`(챕터 확장 시 상수 반영), 인벤토리 ≤ 상한.
2. **재화 상한**: `상한 = 시작 재화 + Σ(일회성 원천: 환영 우편·임무·첫 클리어·패스 무료 트랙) + 일 최대 획득률 × 경과일`. 일 최대 획득률은 `economy-estimate`의 8시간/일 연속 플레이 상한 × 1.5로 넉넉히 잡는다(정당한 헤비 플레이어를 깎지 않는 쪽으로 보수). `경과일 = (now − save.created)`이며 `created`를 조작하면 `legacy_saves.uploaded_at`과 `installId` 첫 보고 시각으로 하한을 둔다. 상한 초과분은 **절삭하고 `report.clamped`에 기록**, 원문은 `legacy_saves`에 보존.
3. `purchases[]`·`spentKRW`·`vip`·`monthlyUntil`·유료 패스는 가져오지 않는다(결제가 없었음). `remove_ads_v1` 권한은 스토어 원장에서 별도로.
4. 영웅 조각·초월석 등 장기 재화도 같은 상한 규칙. 비정상(예: 1e15 골드)은 절삭 + `audit_flags` + **랭킹/레이드 보상 30일 보류**(`payout_hold`).
5. 아바타 보유·장착, 칭호, 소셜 식별은 보존.
6. **유예 보상**: 컷오버 시 정화로 깎인 정당 사용자가 있을 수 있으므로 문의 대응용 `legacy_restore` 운영 도구(P5-B)와 "진행 확인 요청" 버튼을 제공한다.

**한 기기·여러 기기**: 같은 `installId`는 한 번만 임포트(`legacy_id` PK). 두 번째 기기의 로컬 세이브는 임포트하지 않는다(계정 중복 이득 차단) — 컷오버 화면에서 "이 기기의 진행을 서버 진행으로 대체합니다(이 기기 기록은 90일 보관)"로 안내하고 로컬 원문은 `bladesurge_save_v1_legacy`로 이름만 바꿔 남긴다. 두 기기가 따로 게스트였다가 같은 Google 계정을 연동하는 경우는 3.2의 병합 금지·택1 규칙을 따른다.

**동기화 중 충돌**: 서버 `rev`가 기준. 클라이언트 명령에 `baseRev`가 오래돼 409면 클라이언트가 `/me`로 재조회 후 미전송 낙관 변경을 버린다(서버 규칙 재생이 정본). 오프라인 큐는 멱등형 설정 명령만 허용.

**웹 ↔ 안드로이드 ↔ 토스**: 계정은 Google 연동(토스는 토스 연동)으로 연결. 권한(광고 제거, 월정액 등)은 계정 단위, 영수증 검증은 채널별로 따로.

## 5. 단계별 제공 계획 (P1~P5)

**진행 방식**: 레인 1개 ≈ 1일, 파일 범위는 서로 겹치지 않는다. 각 레인은 `lane/<id>` 브랜치·worktree에서 작업하고 `parallel-dev` 규칙(최신 기본 브랜치에서 시작, 착지 전 overlaps 확인)을 따른다. 전투 코드를 건드리는 레인(P1-C, P1-E, P4-A)은 **동결 창**을 잡아 다른 전투 작업과 겹치지 않게 한다. 게이트는 `bun run check` + 레인별 수용 테스트.

**테스트 도구 3종**(기존 패턴 재사용): ① 순수 규칙·상태기계 `bun test`(D1은 `bun:sqlite` 어댑터 `test/helpers/d1-shim.ts`, `packages/tll-social/test`와 `PartyState` 패턴) ② 실제 workerd + SQLite DO 증명 `tools/*-proof.mjs`(`party-relay-proof.mjs` 패턴, miniflare) ③ 2클라이언트 Playwright 실시간 QA `tools/*-qa.mjs`(`party-presence-qa.mjs`, `mobile-party-qa.mjs` 패턴, 실제 로컬 Worker + 두 브라우저 컨텍스트).

### P1 — 서버 계정 + 서버 권위 캠페인 루프 (실시간 없음) · 7레인

| 레인 | 범위(파일) | 선행 | 수용 |
|---|---|---|---|
| **P1-A DB 기반** | `worker/v1/migrations/0001_*.sql`(3.3 DDL), `worker/v1/db.ts`(D1 타입, CAS 배치 헬퍼, 마이그레이터), `test/helpers/d1-shim.ts` | — | CAS 배치: 동시 2회 중 1회만 반영·원장 멱등(op_id 중복 → 롤백), 마이그레이션 재적용 무해 |
| **P1-B 신원/세션** | `worker/v1/{router,auth,token,idp}.ts`(라우터는 `worker/index.ts`에 **마운트 한 줄**만 추가), `packages/tll-social/src/server/internal.ts`(키 해시→playerId 해석, ensureProfile), 테스트 | A | 게스트 생성→세션 토큰→연동/복구/충돌 409, 토큰 변조·만료·`token_ver` 불일치 거부, 기존 deviceKey가 기존 playerId로 입양되고 친구·칭호 유지(소셜 기존 테스트 전부 통과) |
| **P1-C EconomyCore 추출** | 신규 `src/game/economy-core.js`(저장 제외 규칙 클래스; RNG·시계 주입), `src/game/economy.js`(얇은 서브클래스), `src/shared/rng.js` | — | **기존 경제 테스트 전부 무수정 통과**(economy-*·expedition-*·journey 등), `Economy.fromState(s,{rng,now})`로 localStorage 없이 서버 실행 |
| **P1-D 서버 규칙 엔진** | `worker/v1/{state,cmd,me,energy}.ts` | A, B(토큰), C | `/cmd` 멱등(같은 cid 2회→효과 1회), 동시 변경 409 후 재조회 성공, 서버 시계 에너지(기기 시계 +1일 조작→추가 에너지 0), 허용 op만 실행, 문서 256KB 상한 |
| **P1-E 런 티켓/정산** | `worker/v1/runs.ts`, `src/shared/{settlement,loot-roll}.js`, `src/game/drops.js`(roll 부분만 순수 함수 분리), `src/data/plausibility-table.json`, `tools/mmo-calibrate.mjs` | D | 위조 정산 매트릭스 10종(중복·만료·타인 티켓·초단시간·처치 수 초과·피해 초과·소모품 초과·음수·NaN·알 수 없는 필드) 모두 지급 0, 정상 AUTO 클리어 100판(헤드리스) 모두 통과, 클라이언트 미리보기 드랍 = 서버 지급 드랍(시드 동일) |
| **P1-G 임포트/정화** | `worker/v1/import.ts`, `test/fixtures/saves/*.json`(신규·중반·후반·변조 골드 1e15·손상 JSON·구버전) | C, D | 골든 세이브 5종 기대 결과, 재임포트 거부(`legacy_id` 중복), 절삭 보고서, 원문 보존 |
| **P1-F 클라이언트 연결** | `src/net/{account-client,command-queue,import,secure-storage}.js`, `src/main.js`(부트 훅 최소), 계정 화면 최소 UI(`src/ui/account.js`), `tools/v1-account-qa.mjs` | B, D, E, G | Playwright: 신규 설치 → 게스트 생성 → 1-1 AUTO 클리어 → 보상이 서버 영수증으로 표시 → `localStorage` 삭제 후 새로고침 → 서버에서 복구, 그림자 모드 패리티 로그 0 불일치 |

의존 그래프: `A → B → D → E → F`(임계 경로 약 5일), `C`는 A·B와 병렬, `G`는 E와 병렬. 병렬도 3이면 달력 5~6일.
**P1 완료 게이트**: `bun run check` 통과 · `node tools/v1-proof.mjs`(miniflare E2E: 게스트→임포트→런 시작→정산→`/me` 일치) · 패리티 테스트(녹화된 명령열 200개를 클라이언트 `Economy`와 서버 `/cmd`에 흘려 상태 해시 일치) · 위조 매트릭스 0 지급 · 서버 시계 테스트.

### P2 — 마을 + 소환/상점 서버화 + 결제 기반 · 6레인

| 레인 | 범위 | 선행 | 수용 |
|---|---|---|---|
| **P2-A TownShard/Directory DO** | `worker/town/{shard-state,shard,directory}.ts`(순수 상태 + DO 어댑터), 프로토콜 `src/town/protocol.js` | P1-B | DO 단위 테스트: 속도·경계 클램프·스냅백, 변경분 스냅샷, 하드캡 40 → 41번째 입장은 다음 샤드, 메시지 한계, 빈 샤드 정리 |
| **P2-B 마을 클라이언트** | `src/town/{net,remote-players,town-view}.js`, `lobby-hall`/허브 연결 훅 | A | 2클라이언트 Playwright(`tools/town-two-client-qa.mjs`): 서로 1초 안에 보임, 이동 보간, 이모트, 퇴장 제거, 대역폭 측정 평균 < 1.5KB/s·최대 < 4KB/s, 풀 렌더 16 상한 드로우콜 ≤ 420 |
| **P2-C 소셜 채널 일반화 + 필터 + 연령** | `packages/tll-social/src/server/*`(채널 resolver, 필터), `src/shared/ko-filter.js`, `public/` 정책 문구 | P1-B | 우회 욕설 표본 200개 차단률 ≥ 95%·정상 문장 오탐 < 1%, 개인정보 패턴 차단, `u14` 입장 거부, 기존 소셜 테스트 무수정 통과 |
| **P2-D 소환 서버화 + 확률 공개** | `src/shared/gacha-core.js`(economy.js에서 순수 부분 추출), `worker/v1/gacha.ts`, `GET /api/v1/odds`, 공개 확률 페이지 | P1-C/D | 서버 소환 100만 회 몬테카를로 vs 공개 확률표 오차 허용 범위, 천장 80·소프트 60·10연 보장, 화면 표 해시 = 서버 `odds_rev` = 로그 |
| **P2-E 카탈로그/주문/권한** | `worker/v1/catalog.ts`, `store.sql` 마이그레이션(product CHECK 완화), `worker/store.ts` 연결, voided purchases 크론 | P1-D | `COMMERCE-SERVER-CONTRACT` 수용 항목 전부(중복 주문·위조·타임아웃·환불·재청구) 0 지급/1 지급 검증, 플래그 off 기본 |
| **P2-F 외형(마을 존재감)** | `src/data/cosmetics.js`, `look` 블롭 서버 생성, 이모트·네임플레이트 | P2-A | 서버 `look`과 렌더 일치, 미보유 외형 위조 입장 거부 |

**P2 완료 게이트**: 2클라이언트 마을 QA · 41번째 접속 샤드 분할 · 소환 확률 검증 · IAP 샌드박스 시나리오 통과 · **이 시점에 현금 상품 개방 판단**(스타터/월정액/패스는 서버 지급 확인 뒤에만).

### P3 — 협동 던전 v2 + 길드 + 매칭 · 6레인

| 레인 | 범위 | 수용 |
|---|---|---|
| **P3-A PartyRoom v2** | `worker/party-state.ts`, `worker/party.ts`, `src/party/protocol.js`(버전 필드) | 계정 바인딩, 게스트 이탈 시 진행 계속, 호스트 이탈 partial, attestation 서명, 기존 `party-*` 테스트 호환 유지, `tools/party-relay-proof.mjs` 확장 |
| **P3-B 파티 티켓/정산/정규화** | `worker/v1/party-runs.ts`, `src/party/replication.js`(동기화 규칙) | 위조 attestation·재사용·시간 미달 거부, 부분 보상 공식, 에너지 부족 시 시작 거부, 협동 보너스 일 3회 |
| **P3-C 스냅샷 델타/이진화** | `src/party/{session,view,protocol}.js` 협상, `worker/party.ts` 라우팅(P3-A와 파일 순서 조정) | 구버전 클라이언트 호환, 180 적 픽스처 게스트 하향 ≤ 40KB/s(목표 ≤ 15KB/s) **실측**, 10분 판 누적 데이터량 보고 |
| **P3-D MatchQueue + 동행 채움** | `worker/match/*.ts`, `src/party/quick-match.js`, 동행 연동 | 20초 내 매칭 또는 네브 채움, 호스트 선정, 중복 대기열 방지 |
| **P3-E 길드 서버** | `worker/v1/guild.ts`, SocialHub 채널 연결 | 동시 가입/위임/강퇴 경쟁 테스트, 정원·쿨다운, 길드장 연동 요건 |
| **P3-F 길드 UI** | `src/ui/guild.js`, `src/ui/guild.css` | 360×740·1280×720 겹침 0, 전투 중 UI 가림 없음(대표님 전역 규칙) |

**P3 완료 게이트**: 4클라이언트 Playwright(호스트/게스트 이탈 시나리오 포함) · 길드 경쟁 테스트 · 파티 대역폭 실측 보고 → **비공개 베타 시작 가능**.

### P4 — 레이드 · 랭킹 · 아레나 · 감사 · 7레인

| 레인 | 범위 | 수용 |
|---|---|---|
| **P4-A 난수 주입 리팩터** | `src/game/{skills,enemies,battle-base,player,actor,burrow,comet-boss-orbit,ashforge-chain-break,bellfall-deep-counter,rpg-battle}.js` — 전투 판정용 `Math.random` ~47곳을 주입된 스트림(전투/AI/드랍 분리)으로. VFX 난수는 기존 `combat-vfx.js`처럼 분리 유지 | 동일 시드+동일 입력 → 동일 최종 해시(헤드리스, 서로 다른 머신 2대에서 100회), `bun test` 345 파일 통과, 프레임 비용 회귀 없음(할당 제한 AGENTS 유지) |
| **P4-B 입력 기록 + 감사 러너** | `src/net/replay-recorder.js`, `worker/v1/replay.ts`(R2 업로드), `tools/audit-runner.mjs`(`combat-flow-sim` 런타임) | 기록 20~50KB/판, 감사 러너가 정상 런 통과·변조 런(입력 삽입, 스킬 쿨다운 위반) 실패 |
| **P4-C 월드 보스** | `worker/raid/{world-boss,api}.ts`, `src/ui/raid.js`, 보스 레이드 변형 데이터 | 동시 보고 경쟁에서 합계 정확, 주 경계(KST 월 05:00) 전환, 지연 우편 멱등, HP 마일스톤, 상한 위반 거부 |
| **P4-D 리더보드** | `worker/v1/leaderboard.ts`, `lb_hist` 크론, UI | 상위 1,000 정확 순위, 이후 백분위, 행 읽기 ≤ 1,001/요청 확인, 캐시 TTL |
| **P4-E 아레나 서버** | `worker/v1/arena.ts`, 스냅샷 생성, 레이팅 | 위조 스냅샷 불가(서버 데이터), 방어 보호, 같은 상대 제한, 정규화 규칙 적용 |
| **P4-F 아레나 클라이언트** | `src/game/arena-duel.js`(AUTO 조종 상대 구성), `src/ui/arena.js` | 상대 빌드 재현(영웅·장비·각성·외형), 90초 판정, 연습 탭 유지 |
| **P4-G 이상치 탐지 + 무결성** | `worker/v1/anticheat.ts`, Play Integrity 검증, 경제 감사 큐 | 합성 부정 시나리오 탐지, 오탐 해제 도구 |

**P4 완료 게이트**: 난수 주입 해시 일치 · 감사 러너 변조 탐지 · 레이드 주 경계 시뮬 · 랭킹 지급 파이프라인(T2 통과분만) 시험 → **랭킹 보상 지급 개시 가능**. (P4-A 이전에는 순위 보상 없음.)

### P5 — 라이브 운영 · 규정 · 스케일 · 6레인

| 레인 | 범위 | 수용 |
|---|---|---|
| **P5-A 시즌 엔진** | `worker/v1/live-events.ts`(`live_events` 테이블: 이벤트 데이터 구동), 시즌 패스(40단계), 달력 | 12주 달력을 데이터로 로드, 주 경계 전환 시뮬, 패스 XP 이중 지급 불가 |
| **P5-B 운영 콘솔** | `worker/admin/*`, 신고 큐, 계정·원장 조회, 제재/보상 회수, `legacy_restore` | 권한 분리(관리자 id 목록), 모든 변경 감사 로그 |
| **P5-C 법규 흐름** | 연령 확인 UI, 약관/처리방침 동의 로그, 계정 삭제, 확률 공개 페이지, 환불/철회 고지 | 법무 체크리스트 항목별 화면 존재, 삭제 유예·익명화 테스트 |
| **P5-D 부하·장애 시험 + D1 분할** | `tools/load/*.mjs`(봇 N), 샤드 분할 스위치 | 동시 2,000 봇: 마을 지연 p95 < 250ms, 파티 200방, 레이드 보고 3,000/분, DO 강제 재시작 복구, 비용 모델 ±30% 확인 |
| **P5-E 길드 거점 + 마을 보강** | `TownShard` 길드 인스턴스, 마을 장식 | 길드 전용 인스턴스 입장 제한, 샤드 정원 |
| **P5-F 콘텐츠 파이프라인 + 페이싱 CI** | 챕터 7~12 데이터, 타워 규칙, `tools/mmo-pacing-sim.mjs --assert` | 7.6절 밴드 CI 통과 |

레인 합계 32개(P1 7 + P2 6 + P3 6 + P4 7 + P5 6). 임계 경로 기준 달력 약 6~8주(AI 레인 병렬도 3~4 가정, 리뷰·배포 포함). **비공개 베타는 P3 말, 소프트 런칭은 P4 말, 정식은 P5 + 베타 KPI 달성 후.**

## 6. 수익화 설계 — MMO 레이어와 전환 1%

### 6.1 목표의 정의와 퍼널 가정

- **전환율 = 월간 결제자 ÷ MAU, 목표 1.0%(스트레치 2.0%).** 한국 모바일 RPG 평균보다 낮게 잡은 보수 목표이며, 재현 가능한 레버(마을 존재감·시즌 가치·정기 상품)로 달성한다.
- 가정(베타에서 교체): 설치 → D1 40% → D7 17% → D30 8%, DAU/MAU 0.28, ARPPU ₩25,000/월, 결제자의 정기형(월정액·패스) 비중 ≥ 50%, 첫 결제 중앙값 D3~D7, 첫 결제 상품은 ₩1,200 스타터가 과반.
- 측정은 P1 이후 서버 KPI(3.13)로: 결제 화면 노출 → 시작 → 영수증 검증 성공 퍼널, 첫 결제까지 일수, 상품별 비중. **결제 "성공"은 서버 영수증 검증 후에만 기록·표시한다**(AGENTS.md 유지).

### 6.2 무엇을 판매하나 / 판매하지 않나

| 상품 | 가격(기존 값 또는 가정) | 유형 | MMO 연결 | 비고 |
|---|---|---|---|---|
| 광고 제거 `remove_ads_v1` | 스토어 콘솔 값 | 비소모 | — | 현재 유일한 서버 검증 상품 |
| 스타터 팩 | ₩1,200 (가입 후 72시간 창, 1회) | 번들 | 한정 외형 **"출정 망토"**(마을·파티·레이드에서 보임) + SSR 확정권 1·보석 1,000·골드 50,000 | `shop.js` `starter` 확장, 보이는 보상이 핵심 |
| 월정액 카드 | ₩5,900 | 30일 | 즉시 보석 1,200 + 매일 100, 닉네임 프레임, 길드 기부 일 +1회 | 기존 `monthly`, 환불 시 잔여일 취소 |
| 시즌 패스 | ₩9,900 (12주, 40단계) | 시즌 | 프리미엄 트랙: 외형 세트·편의(소탕 슬롯, 인벤토리 +50)·**보석 환급 일부** | `BATTLE_PASS` 30→40단계, XP 원천: 일일/주간 계약·레이드·타워·아레나 |
| 외형 상품 | ₩2,200~₩6,600 | 비소모 | 영웅 아바타(5종, 현재 보석 2,980 SKU와 병행), 마을 오라·이모트 세트·네임플레이트 프레임·마을 펫(비전투), 길드 깃발(길드장 구매 → 길드원 전원에게 표시) | **전환 1% 핵심 레버**: 마을/파티/레이드에서 남들에게 보인다 |
| 보석 팩 6단계 | ₩3,900~₩129,000 | 소모 | 소환 재화 | `gem1~gem6`, 첫 구매 보너스(서버 계정당 1회 기록) |
| VIP 30일 | ₩19,000 | 기간 | 에너지 최대 +50, **PvE 골드 +30%**(아레나·랭킹 보드 제외) | 편의 재정의 |
| 편의 상품 | ₩1,200~₩2,200 | 소모/비소모 | 인벤토리 +50칸, 소탕권 팩, 레이드 추가 입장권(일 6회 한도 내) | 한도가 있어 격차 제한 |

**판매하지 않는 것**: ① 아레나·레이드·랭킹에서 직접 능력치를 올리는 소모품(강화 성공률 상품 `enh_pack`의 보호·축복 주문서는 **PvE 성장에만** 쓰이고 아레나 정규화에서 무시) ② 레이드 입장 횟수의 무제한 구매 ③ 순위 보상 구매 ④ 유료 전용 영웅(영웅은 소환/조각으로만, 픽업 주기는 공개 고정) ⑤ 플레이어 간 거래·선물(RMT 방지) ⑥ 길드 능력치 판매. **아레나 정규화(3.10)** 덕에 과금 격차가 PvP 승패에 직접 반영되지 않는다.

### 6.3 확률형 공개와 로그 일치

1. 서버 소환은 `src/shared/gacha-core.js` 한 모듈이 공개 확률표(`gachaRates()/gachaContents()`)와 실제 추첨을 **같은 식**으로 계산한다(현행 코드의 성질을 유지).
2. 확률표의 정규화된 JSON의 SHA-256이 `odds_rev`. 소환마다 `gacha_log.odds_rev` 기록, `GET /api/v1/odds/{banner}`가 표+`odds_rev`+발효 시각을 반환, 게임 안 확률 화면과 `blade.tllhouse.com/odds` 페이지가 같은 응답을 렌더한다. 표가 바뀌면 이력 보관(고지 의무 대응).
3. 구매 직전 화면에 확률 링크와 천장 규칙(소프트 60 / 확정 80 / 10연 SR 보장 / 픽업 비율)을 표시한다. 랜덤 박스형 패키지(`boss_pack` 등)도 구성품과 확률을 같은 방식으로.
4. 월 1회 자동 감사: 로그 집계 등급 분포가 공개 확률과 통계적으로 일치하는지 검사(P2-D 몬테카를로 테스트를 운영 크론으로 이식).

### 6.4 환불·철회·분쟁

- 유료/무료 재화를 분리 저장(`gems_paid`, `gems_free`), **무료 먼저 소모**해 환불 가능한 유료 잔액을 보존한다. 원장(`wallet_ledger`, `store_ledger`)이 환불 계산의 근거.
- Google Play 환불·취소: 시간당 크론이 `voidedpurchases`를 조회해 지급 라인을 역분개한다(3.4.4). 소비된 재화가 있으면 음수 허용·소비 차단, 상습 환불 계정은 `payout_hold` 후 운영자 검토. 기간제는 `revoked_at`.
- 청약철회/미사용 환불 요청: 운영 콘솔(P5-B)에서 계정 원장을 보고 처리, 처리 이력은 법정 기간 보관.
- 스토어 채널 분리(ONE Store·Google Play·Apps in Toss)는 `STORE_RELEASE` 계약대로 유지, 영수증은 채널 안에서만 검증.

## 7. 3개월 콘텐츠 케이던스

### 7.1 구조 — X-1 ~ X-10, X-5 중간 보스, X-10 최종 보스

대표님 구조는 이미 `stageDef`에 있다(`st===5` 중간 보스, `st===10` 최종 보스, `3·7` 수문장). 챕터를 6 → 12개로 늘리고 같은 틀을 쓴다. 신규 6개 챕터는 엔진에 이미 있는 테마 팔레트(`arena.js THEMES`의 `crypt/throne/abyss`, `DUNGEON_ATMOSPHERES`의 `glacier/quarry`)와 기존 몬스터 로스터 26종(Quaternius) 재조합으로 제작 비용을 줄인다.

| 챕터 | 이름(기존/가칭) | 테마 | 권장 Lv | 개방 | X-5 중간 | X-10 최종 |
|---|---|---|---|---|---|---|
| 1~6 | 잊힌 종의 정원 · 불씨 왕국의 용광로 · 거꾸로 흐르는 서리 도서관 · 별이 잠긴 심해 · 새벽을 먹는 왕관 · 함께 잇는 귀환로 | garden·forge·frost·tide·crown·garden | 1→46 | 런칭(기존) | 기존 `*_midboss` | 기존 `*_finalboss` |
| 7 | 금 간 종탑의 도시(가칭) | crypt | 46→50 | W1 | 신규 | 신규 |
| 8 | 빈 왕좌의 평원(가칭) | throne | 50→55 | W1 | 신규 | 신규 |
| 9 | 심연으로 열린 문(가칭) | abyss | 55→60 | W1 | 신규 | 신규 |
| 10 | 빙하 아래의 별(가칭) | glacier | 60→66 | **W5** | 신규 | 신규 |
| 11 | 황동 채석장의 노을(가칭) | quarry | 66→72 | **W8** | 신규 | 신규 |
| 12 | 균열의 중심(가칭) | crown 변형 | 72→78 | **W11** | 신규 | 신규(시즌 파이널과 연결) |

서사: 1~6장은 기존 완결(귀환로)을 유지하고, 7~12장은 "귀환 이후 균열이 마을을 습격한다"는 2막으로 **레이드 보스 = 균열 군주**와 이어 붙인다(마을 배너·길드 목표의 서사 연결). 새 보스 12체 중 레이드 변형 2체(W11, W12)를 공유 제작한다.
코드 상수: 챕터/스테이지 수가 하드코딩된 곳을 P5-F에서 일괄 정리한다 — `worker/party-state.ts`(`stageIdx ≤ 60` 두 곳), `src/data/loot-tables.js`(`length: 6`, `Math.min(6, …)` 세 곳, `CHAPTER_START_LEVEL`), 서버 임포트 정화(`unlocked ≤ 60`), `CHAPTERS.length * STAGES_PER_CHAPTER` 파생 8곳은 자동 확장되는지 테스트로 고정.

### 7.2 난이도(하드 모드)

현행 story/adept(숙련)/nightmare(악몽: 해당 스테이지 별 3개 필요)는 유지한다. 추가: **지옥(HELL)** — 챕터 전체 악몽 클리어 + 권장 전투력 이상 필요, 적 HP ×2.1·공격 ×1.7, 보상 ×2.2, 강화석 상위 등급·초월석 드랍 가중. **주간 모디파이어** — 매주 균열/타워에 규칙 1~2개(`seasonal-content.js` 프런티어 효과 구조 재사용). 모든 난이도 보상은 서버 규칙(`applyDifficulty`)이 계산한다.

### 7.3 엔드게임 (캠페인 이후의 90일)

| 콘텐츠 | 내용 | 주기·한도 |
|---|---|---|
| **무한의 성(타워)** | 시드 기반 층 생성(PRD 원안의 "무한의 성"), 5층마다 중간 보스·10층마다 보스(X-5/X-10 규칙), 시즌 층 상한이 주 +20층씩 확장(W2: 1~40 → W12: 1~240), 일 입장권 5장, 도달 층 랭킹 | 시즌 |
| **균열(Rift)** | 기존 일일 균열(`rift-encounters.js`)을 단계(R1~R30)로 확장, 일일 모디파이어, 재료·소환 조각 | 일 |
| **심층 원정** | 기존 12개(`expedition-depths.js`) | 상시 |
| **주간 월드 보스** | 3.8절 | 주 |
| **아레나** | 3.10절 | 4주 시즌 |
| **길드 주간 목표** | 길드 GP·길드 레이드 점수 상자 | 주 |

### 7.4 주간 레이드 로테이션 (W2~W12)

기존 보스 9종의 레이드 변형 + 신규 2종. 순서는 지역 테마가 겹치지 않게 배치한다.

| 주 | 보스 | 비고 |
|---|---|---|
| W2 | 시계종의 주권자 (`glass_hour_sovereign`) | 첫 레이드, 낮은 HP, 튜토리얼성 마일스톤 |
| W3 | 녹청 온실의 성역수 (`verdigris_sentinel`) | |
| W4 | 쌍화구 쇠사슬 집행자 (`cinder_chain_executor`) | |
| W5 | 밤유리 기록관 (`nightglass_archivist`) | 챕터 10 개방 주 |
| W6 | 흑요룡 삼두 (`obsidian_hydra`) | |
| W7 | 합류 수로의 유성기사 (`comet_bastion`) | 길드 레이드 첫 보상 상자 |
| W8 | 네 왕좌의 환영 여왕 (`sable_mirage_empress`) | 챕터 11 개방 주 |
| W9 | 성운 레비아탄 (`astral_leviathan`) | |
| W10 | 재벼림 거수 (`ash_colossus`) | |
| W11 | 균열 군주 I (신규) | 챕터 12 개방 주 |
| W12 | 균열 군주 II — 시즌 파이널 (신규) | 시즌 랭킹 결산 |

### 7.5 12주 이벤트 달력

시즌 1은 출시 후 첫 월요일 05:00(KST)에 시작한다. 이벤트는 `live_events` 테이블(P5-A)에 데이터로 넣어 배포 없이 켜고 끈다.

| 주 | 신규 콘텐츠 | 이벤트 | 수익화 | 주요 지표 |
|---|---|---|---|---|
| W1 | 런칭: 챕터 1~9, 마을 3, 파티 보상, 일일/주간 계약 | **출정식** 7일 출석(7일 보상을 외형으로), 신규 가입 72시간 스타터 | 스타터, 광고 제거 | FTUE 완주율, D1 |
| W2 | 길드 개설 열림, 타워 1~40, **레이드 #1** | 길드 창설 지원(수수료 면제 주말) | 월정액 노출 | 길드 가입률, 레이드 참여율 |
| W3 | **아레나 시즌 1(4주)** | 주말 재료 +50% | 시즌 패스(12주) 판매 중심 | 아레나 참여, 패스 전환 |
| W4 | 타워 1~80 | 이벤트 던전 #1(한정 재료로 외형 교환) | 외형 상점 | 외형 구매율 |
| W5 | **챕터 10**, 타워 1~100 | 길드 대항전(레이드 점수 합) | 소환 픽업 교체(공개 고정 일정) | D7→D14 |
| W6 | 주간 모디파이어 시작 | 파티 보너스 주(협동 보상 +30%) | 편의 상품 | 파티 매칭 시간 |
| W7 | **아레나 시즌 2**, 타워 1~140 | 이벤트 던전 #2 | 시즌 패스 중간 점검 보너스 | 아레나 재참여 |
| W8 | **챕터 11** | 길드 하우스 꾸미기 이벤트 | 길드 깃발 | 길드 유지율 D30 |
| W9 | 타워 1~180 | 복귀 이벤트(14일↑ 미접속 우편) | 복귀 번들 | 복귀율 |
| W10 | **아레나 시즌 3** | 이벤트 던전 #3 | 월정액 재노출 | D60 |
| W11 | **챕터 12**, **레이드 균열 군주 I** | 서버 연합 마일스톤(전 서버 격파 목표) | 시즌 마감 외형 | 서버 목표 달성 |
| W12 | 타워 1~240, **시즌 파이널 레이드** | 시즌 결산(랭킹 보상·칭호), 시즌 2 예고 | 다음 시즌 패스 선판매 | 시즌 말 이탈, 재구매 |

### 7.6 90일 페이싱 시뮬레이션 방법

**왜 필요한가**: 0.1절의 실측대로 캠페인은 7일이다. 3개월을 결정하는 것은 영웅 등급 조각·강화 자원·주간 신규 콘텐츠이며, 신규 원천(레이드·아레나·길드·타워)이 조각 획득을 가속하면 현재의 SSSR 64~82일이 늘어난 콘텐츠 없이 단축될 수 있다. 그래서 **MMO 콘텐츠의 보상은 시뮬레이터가 정한다.**

**도구**: `tools/mmo-pacing-sim.mjs`(P5-F). 기존 `tools/economy-estimate.mjs`·`progression-estimate.mjs`의 export(`perRun`, `startingState`, `questTable`, `TOTAL_STAGES`)와 실제 데이터 모듈(`shop.js`, `hero-grades.js`, `loot-tables.js`, `items.js`)을 읽는 방식을 확장한다. 숫자를 코드에 하드코딩하지 않는다.
1. **입력**: `data/mmo-content.json` — 콘텐츠별 `{개방일, 최소 전투력, 소요 분, 에너지/입장권 비용, 보상(골드·EXP·조각·강화석·초월석·재료), 일/주 한도}`.
2. **행동 모델**: 일 단위. 아키타입 A 라이트(15분) / B 표준(30분, 기준) / C 헤비(60분) / D 소과금(스타터+월정액+패스) / E 고과금(60분+월 ₩100k). 하루 시간 배분 우선순위: 일일 계약 → 신규 콘텐츠 → 레이드·아레나 한도 → 성장 구간 반복. 에너지는 `ENERGY`(최대 100, 180초 회복) 그대로.
3. **난수**: 소환(천장)·강화(성공/파괴)는 시드 몬테카를로 500회, 나머지는 기댓값.
4. **출력**: 마일스톤별 도달일의 p10/p50/p90, 콘텐츠 고갈일, 주별 "신규 콘텐츠 비율".
5. **판정(PRD 방식 — 밴드 밖이면 그 회전은 실패)**:

| 지표 (B 표준 기준, p50) | 밴드 | 현행 근거 |
|---|---|---|
| 1~6장 클리어 | 6~10일 | 현행 7일 |
| 7~9장 클리어 | 18~28일 | 신규 |
| 12장 클리어 | **개방 주 + 3~10일** (출시 일정에 묶임) | 신규 |
| 주력 영웅 SSR | 24~30일 | 현행 26~28일 |
| 주력 영웅 SSSR | 78~95일 | 현행 64~82일 → 신규 원천분 보정 |
| 영웅 Lv.80 | 55~70일 | 신규 |
| 타워 100층 | 60~80일 | 신규 |
| 아레나 골드 리그 | 25~40일 | 신규 |
| 레이드 개인 상위 20% 진입 | 21일 이후 | 신규 |
| p10~p90 폭 | p50의 ±30% 이내 | |
| 소과금(D) SSSR 단축 | B 대비 0.65~0.8배 | 격차 완만 |
| 고과금(E) SSSR 단축 | B 대비 ≥ 0.5배 | 상한 |
| 30일차 전투력 비(D/B, E/B) | ≤ 1.25 / ≤ 1.6 | |
| 아레나(정규화) 전투력 비(E/B) | ≤ 1.1 | 정규화 검증 |
| 주별 신규 콘텐츠 비율 | W1~2 ≥ 80%, W3~12 ≥ 30% | 이탈 방지 |
| C(60분) 콘텐츠 고갈 | W6 이후에도 일일 콘텐츠 ≥ 60분 | |

6. **CI**: `bun tools/mmo-pacing-sim.mjs --assert`가 밴드를 검사한다(P5-F). 보상 수치를 바꾸는 PR은 시뮬 결과 표를 PR 본문에 첨부한다.
7. **실측 보정**: 베타 서버 KPI(마일스톤 도달일 분포)와 시뮬 p50이 ±20%를 넘으면 상수(조각 드랍, 주간 상한)를 재조정하고 시뮬 가정을 갱신한다. 한 번의 성공으로 속도·품질 향상을 선언하지 않고 증거(분포)로만 바꾼다.

## 8. 리스크와 결정

| # | 리스크 / 미결 | 결정 | 이유 |
|---|---|---|---|
| 1 | D1 단일 DB 한계(쓰기 TPS, 10GB) | 지금은 단일 D1. 계정 키 선두 설계 + 스케일 트리거(3.14)로 4분할 | 소규모에서 분할은 낭비, 설계만 선반영 |
| 2 | 전투 난수 비결정(T2 불가) | P4-A에서 난수 주입. 그 전엔 순위 보상 없음 | 인정 가능한 감사가 없으면 지급하지 않는다 |
| 3 | 파티 대역폭·배터리 | 델타/이진화로 ≤ 15KB/s 목표, 실측 후 확정 | 모바일 데이터 부담이 이탈 원인 |
| 4 | 호스트 부정/이탈 | attestation + 멤버별 정산 + 부분 보상, 호스트 이전은 v1 제외 | 시뮬 상태가 호스트 메모리에만 있다 |
| 5 | SocialHub 단일 DO | 동접 300 / p95 150ms 트리거로 채널 DO 분리 | 지금 분리는 과설계 |
| 6 | 오프라인 플레이 | 보상 런은 서버 티켓 필수, 프리페치 3장(12시간) + 연습 모드 | 전철 플레이 유지와 부정 방지 절충 |
| 7 | 빈 서버(초기 동접 부족) | 샤드 채우기 우선 배정, NPC 모험가 표시, 매칭 20초 후 네브 채움 | "텅 빈 MMO" 인상 방지 |
| 8 | 웹(PWA) 부정 | PvE/열람 허용, 랭킹 지급은 T2 통과 필수 | 증명 수단이 없음 |
| 9 | 14세 미만 | 자유 채팅·연동·결제 비활성(기능 차단), 법정대리인 동의 흐름은 v1 제외 | 구현·운영 부담 대비 효과 |
| 10 | 앱인토스 채널 채팅 | 정책 확인 전 프리셋만 | 심사 리스크 회피 |
| 11 | 거래 | 없음(재화·아이템·선물 모두) | RMT·봇 유인 제거 |
| 12 | 챕터 제작 용량 | 7~9 런칭 필수, 10~12는 라이브(W5/W8/W11). 용량 부족 시 10~12를 타워 시즌 구간으로 대체하되 일정은 유지 | 콘텐츠 케이던스가 리텐션의 핵심 |
| 13 | 환불 후 소비된 유료 재화 | 음수 잔액 허용 + 소비 차단, 상습은 payout_hold | 단순·감사 가능 |
| 14 | 계정 병합 | 금지(택1, 나머지 90일 보관) | 자원 복제 악용 차단 |
| 15 | 시즌 FOMO | 시즌 외형은 다음 시즌 상점에 1회 복각(가격 유지), 패스 보상 중 능력치는 없음 | 이탈·불만 완화 |
| 16 | 한국 규정 해석 | 3.11 표는 개발 요구사항. 출시 전 법무 확인 항목으로 `docs/LEGAL_CHECKLIST.md`를 P5-C가 작성 | 문서가 법률 자문을 대신하지 않는다 |
| 17 | 비용 단가 변동 | 3.14는 기억 기반 단가. P5-D에서 요금표로 재계산, 안전 계수 ×2 | |
| 18 | 전투 코드 동결 충돌 | P1-C/E, P4-A에 동결 창, 다른 전투 PR은 그 사이 대기 | 중앙 파일(`economy.js`, 전투 코어) 동시 편집 방지 |
| 19 | 서버 권위 전환 중 데이터 신뢰 | 그림자 모드 2~3주, 계정 단위 컷오버·롤백 | 3장 4번 |
| 20 | 무료 동행 AI 대화 | 기본 비활성 유지(AGENTS), 매칭 채움용 네브는 기존 로컬 전술 규칙만 사용 | 비용·승인 계약 유지 |

## 9. 기존 계약과의 충돌 — 개정 필요 목록

| 문서 | 현재 문구 | 개정 |
|---|---|---|
| `PRD.md` §5 | "서버·계정 시스템 (localStorage 세이브 유지)" 하지 않을 것 | 대표님 2026-10-22 지시로 폐기. 서버 권위 계정 도입, 로컬은 캐시·연습 |
| `PRD.md` §3.3 | "실제 결제·광고 SDK와 영수증 검증 전에는 …지급하지 않는다" | 유지(서버 검증 후에만 지급). 목업 SKU는 서버 카탈로그로 이관 |
| `PRD.md` §0·§1 | 핵앤슬래시 단독 정의 | MMO 레이어(마을·협동·길드·레이드·랭킹·아레나)를 도파민 3축 아래 확장으로 명시. 새 기능은 3축 중 하나에 기여해야 한다는 규칙은 유지 |
| `docs/party-dungeons.md` | "협동 원정은 …보상은 지급하지 않는다", 방장 이탈/파티원 이탈 시 종료 | P3-A 이후 보상 지급·게스트 이탈 시 진행 지속으로 개정 |
| `docs/COMMERCE-SERVER-CONTRACT-20260923.md` | 현금 상품 비활성 경계 | 8개 요구를 유지하되 3.4.4의 계정 매핑·카탈로그 확장 추가 |
| `packages/tll-social/CONTRACT.md` | `world-1..N` 채널, deviceKey만 신원 | 임의 채널 id, 외부 계정 입양(내부 API), 한국어 필터 확장 반영 |
| `docs/CURRENT_STACK.md` | 바인딩 `ASSETS·AI·DIALOGUE_BUDGET·PARTIES` | KV·R2·Queue·신규 DO·Analytics 바인딩 목록 갱신 |
| `AGENTS.md` | 실제 결제·광고 전 성공 표시 금지 | 유지. "서버 없는 정적 게임으로 축소 금지"와 일치 |
| `src/social/config.js` | `worldChannels: 3, worldCapacity: 150` | 마을 샤드 채널로 대체(광장 채널 폐기 또는 마을 채널로 흡수) |
| `public/privacy.html`·`support.html`, `docs/STORE_RELEASE_20261012.md` | 설문·방침 | 수집 항목(계정 id, 연동 subject 해시, 채팅 로그 보관), 삭제 절차, 사용자 간 상호작용·확률형 항목 갱신 |

## 부록 A. API 표면 (`/api/v1`, 모두 `Cache-Control: no-store`, JSON ≤ 8KB, 기존 origin 검사 재사용)

| 메서드 경로 | 인증 | 요약 |
|---|---|---|
| `POST /auth/session` | deviceKey | 계정 생성/입양 + 토큰 발급 |
| `POST /auth/link` · `/auth/recover` · `/auth/unlink` | 키/없음 | 연동(google·play_games·toss), 복구, 해제 |
| `POST /account/age` · `DELETE /account` | 토큰 | 연령대 저장, 삭제 요청 |
| `GET /me` | 토큰 | 문서·플래그·서버 시간·권한 |
| `POST /import` | 토큰 | 로컬 세이브 정화·보관(1회) |
| `POST /cmd` | 토큰 | 멱등 명령 실행(3.3 표) |
| `POST /runs/start` · `/runs/prefetch` · `/runs/{id}/settle` | 토큰 | 3.4.2 |
| `POST /town/enter` | 토큰 | 샤드 배정 + WS 티켓 |
| `POST /match/join` · `GET /match/status` · `DELETE /match` | 토큰 | 빠른 매칭 |
| `POST /guild` · `GET /guild/{id}` · `POST /guild/{id}/join` 외 | 토큰 | 길드 CRUD, 가입/탈퇴/강퇴/위임, 기부, 출석 |
| `GET /raid/status` · `POST /raid/attempt/start` · `/raid/attempt/settle` · `GET /raid/result/{week}` | 토큰 | 3.8 |
| `GET /lb/{board}` · `GET /lb/{board}/me` | 토큰/공개(상위) | 3.9 |
| `GET /arena/opponents` · `POST /arena/start` · `/arena/settle` | 토큰 | 3.10 |
| `GET /odds/{banner}` | 공개 | 확률표 + `odds_rev` |
| `POST /store/orders` · `/store/verify` · `/store/restore` | 토큰 | 기존 `/api/store/*` 흡수(P2-E) |
| WS `/town/{shard}`, `/party/{code}`, `/social/ws` | 서명 티켓 | 실시간 |

## 부록 B. `wrangler.jsonc` 변경 스케치 (리소스 생성·시크릿 등록은 코디네이터 작업)

```jsonc
{
  "durable_objects": { "bindings": [
    /* 기존: DIALOGUE_BUDGET, PARTIES, SOCIAL */
    { "name": "TOWN_DIR",  "class_name": "TownDirectory" },
    { "name": "TOWNS",     "class_name": "TownShard" },
    { "name": "MATCH",     "class_name": "MatchQueue" },
    { "name": "RAID",      "class_name": "WorldBoss" },
    { "name": "RATE",      "class_name": "RateGate" }
  ] },
  "migrations": [ /* 기존 태그 유지 */
    { "tag": "town-v1",  "new_sqlite_classes": ["TownDirectory", "TownShard"] },
    { "tag": "match-v1", "new_sqlite_classes": ["MatchQueue"] },
    { "tag": "raid-v1",  "new_sqlite_classes": ["WorldBoss"] },
    { "tag": "rate-v1",  "new_sqlite_classes": ["RateGate"] }
  ],
  "kv_namespaces": [{ "binding": "CACHE", "id": "<생성 후 기입>" }],
  "r2_buckets": [{ "binding": "REPLAYS", "bucket_name": "blade-surge-replays" }],
  "queues": { "producers": [{ "binding": "JOBS", "queue": "blade-surge-jobs" }],
              "consumers": [{ "queue": "blade-surge-jobs", "max_batch_size": 50 }] },
  "analytics_engine_datasets": [{ "binding": "EVENTS", "dataset": "blade_events" }],
  "vars": { "V1_ENABLED": "false", "TOWN_ENABLED": "false", "PARTY_REWARDS_ENABLED": "false",
            "RAID_ENABLED": "false", "ARENA_ENABLED": "false", "RANKED_PAYOUT_ENABLED": "false" }
  /* Secrets Store 바인딩(값은 코드·로그에 없음): SESSION_HMAC, ATTEST_HMAC, PLAY_INTEGRITY_SA(또는 기존 GOOGLE_PUBLISHER 재사용 판단) */
}
```
기능 플래그 기본값은 모두 `false`이고 KV 원격 설정이 우선한다. DO 마이그레이션은 새 태그만 추가하며 기존 `party-dungeons-v1`·`social-hub-v1`은 건드리지 않는다.

## 부록 C. 레이드·아레나 메시지 요약

```jsonc
// POST /raid/attempt/start  →  { runId, seed, bossId, weekId, limitMs: 120000, enrageAtMs: 90000, serverTime }
// POST /raid/attempt/settle {runId, damage, elapsedMs, inputDigest, integrity?} → { receiptId, counted, myTotal, hpPct, verdict }
// GET  /raid/status → { weekId, bossId, hpPct, milestones:[{at:0.2,reached:true}], participants, top100Ref, endsAt }
// GET  /arena/opponents → { season, myRating, league, candidates:[{matchToken, name, tag, hero, power, rating, look, shieldUntil}] }
// POST /arena/start {matchToken} → { runId, seed, opponentBuild:{...서버 스냅샷...}, aiProfile, limitMs: 90000 }
// POST /arena/settle {runId, result:'win'|'lose'|'draw', hpPct:{me,foe}, elapsedMs, inputDigest} → { ratingBefore, ratingAfter, league }
```

## 부록 D. 용어

- **T0/T1/T2**: 3.4.1의 발급 / 개연성 / 감사 단계.
- **권위(authority)**: 계정 진행의 정본이 서버(`server`)인지 로컬(`shadow`)인지.
- **attestation**: PartyRoom DO가 방의 실제 지속 시간·인원·결과를 서명한 기록.
- **지연 생성 우편**: 순위 확정 후 대량 지급 대신, 수령 화면을 열 때 결정적 id로 우편 1건을 만드는 방식.
