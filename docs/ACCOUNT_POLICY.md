# 계정 정책 — 로그인·연동·리세마라·비용·탈퇴 (정책 초안)

> 상태: **정책 초안** (2026-10-29). 코드에 이미 있는 것은 "현재", 없는 것은 "제안"으로 구분한다. 외부 사실의 확인일은 모두 2026-10-29.
> 근거 코드: `worker/v1/auth.ts`, `worker/v1/limit.ts`, `worker/v1/migrations/0001_accounts.sql`, `docs/MMO_DESIGN.md` 3장. 결제 보존기간은 `docs/PAYMENT_COMPLIANCE.md` 2.3과 현재 `public/privacy.html`의 5년 표기를 따른다.
> 보관·파기·남용 방지는 **지휘 결정 2026-10-29 시행**(7장 표). `public/privacy.html`·`support.html`의 보관·파기 문구는 7장 표와 일치시켰다. 부록 A는 최초 초안이라 7장 표가 우선한다.

## 1. 로그인 구조

**결정**: 첫 화면 버튼은 `Google로 계속 / 카카오로 계속 / ChatGPT로 계속(가능 시) / 게스트로 시작` 네 개. ChatGPT는 서버에 `CHATGPT_CLIENT_ID`가 없으면 버튼 자체를 숨긴다.

| 항목 | 결정 | 이유 |
|---|---|---|
| 게스트 | 서버 계정으로 만든다(`deviceKey` → `SHA256('blade-surge:'+deviceKey)` = `account_keys.key_hash`). D1에 진행을 저장하고 언제든 연동한다 | 현재 `createSession`이 이미 그렇게 동작. 게스트가 로컬에만 있으면 연동 시 진행 이관이 별도 경로가 된다 |
| 연동 | 로그인 중인 계정에 `account_links(provider, subject_hash)` 추가. 이미 다른 계정에 묶인 제공자면 409 `linked-elsewhere` | 현재 `link()` 동작 |
| 제공자 식별자 | 원문 `sub`는 저장하지 않고 `sha256(provider + ':' + sub)`만 (현재 `subjectHash`) | 유출돼도 제공자 계정을 특정할 수 없다. 이메일·이름·사진도 저장하지 않는다 |
| 다기기 | 같은 제공자 계정으로 다른 기기에서 로그인 → `recover`로 같은 진행 복원. **병합 없음**. 그 기기에 있던 연동 없는 게스트 진행은 `account_archive`에 90일 보관 후 파기 | `recover()`가 이미 이 방식(`ARCHIVE_MS`=90일, 연동된 계정을 가진 기기 키는 409 `key-in-use`). 병합은 자원 복제 악용 통로라 만들지 않는다(MMO_DESIGN 3.2) |
| 연동 보상 | 무료 다이아 소량. **수치는 랄프 레인이 결정**(경제 밸런스 소관). 계정당 1회, 제공자 수와 무관하게 첫 연동에만 | 연동은 복구·결제 안전의 전제라 유도할 가치가 있다. 제공자마다 주면 다계정 연동 반복으로 악용 가능 |
| 키 개수 | 계정당 기기 키 최대 5개, 초과 시 가장 오래 안 쓴 키부터 삭제(현재 `KEYS_PER_ACCOUNT`) | 현재 동작 유지 |

**다른 선택지**: (a) 게스트를 로컬 전용으로 두고 연동 때 업로드 — 서버 비용은 줄지만 이관 경로와 유실 위험이 늘어 기각. (b) 이메일/비밀번호 자체 로그인 — 비밀번호 보관 책임과 유출 위험, 한국 개인정보 부담 때문에 기각. (c) 연동 필수 — 첫 진입 이탈이 커서 기각(대신 첫 결제·순위 보상 수령 전 연동 필수는 MMO_DESIGN 대로 유지).

**코드 영향(제안)**: `account_links.provider`의 CHECK가 `('google','play_games','toss')`라서 `kakao`·`chatgpt` 추가에는 새 마이그레이션이 필요하다(SQLite는 CHECK 변경을 테이블 재작성으로 해야 함). `PROVIDERS`와 `subjectHash`의 `provider !== 'google'` 분기도 확장 대상.

## 2. 제공자별 상태와 근거

### 2.1 Google — 사용 가능
- 기존 GIS id_token 방식. 웹 클라이언트 ID `898058209232-qr2isup4rafe3fhhgt5e1vvntu267sf3.apps.googleusercontent.com`(공개값)이 `wrangler.jsonc`의 `GOOGLE_CLIENT_IDS`와 `src/social/google-signin.js`에 이미 있다.
- 서버는 id_token 서명·aud 검증 후 `sub`만 해시한다(현재 코드).

### 2.2 카카오 — 대표님 등록 대기
- 방식: Kakao Login **OIDC**. 인가 코드 → 서버가 토큰 교환 → id_token 서명 검증.
- 공식 문서 확인(확인일 2026-10-29):
  - OIDC 문서 <https://developers.kakao.com/docs/ko/kakaologin/utilize> (OpenID Connect 절): id_token은 RS256 서명, `iss`는 `https://kauth.kakao.com`와 일치, `aud`는 서비스 앱 키와 일치, `exp`는 현재보다 뒤, 요청에 보낸 `nonce`와 일치해야 한다. 공개키는 `kid`로 고르고 일정 기간 캐싱을 권장. [카카오 로그인]에서 [OpenID Connect]를 활성화해야 id_token이 발급된다. 추가 동의 요청에서 `scope`를 쓰면 `openid`를 포함해야 한다.
  - client_secret: 같은 문서에 따르면 기능이 켜져 있으면 토큰 요청에 필수이고 신규 앱에서는 기본 켜짐, 누락·오류 시 `KOE010`. 2년 안에 회전 권장.
  - JWKS URL `https://kauth.kakao.com/.well-known/jwks.json`, 디스커버리 `https://kauth.kakao.com/.well-known/openid-configuration`: 위 문서 본문에는 URL이 직접 적혀 있지 않고 "공개키 목록 조회 API"로 링크돼 있다. 웹 검색으로 카카오 개발자 문서(<https://developers.kakao.com/docs/latest/en/kakaologin/rest-api>, <https://developers.kakao.com/docs/latest/en/rest-api/reference>)가 해당 엔드포인트와 `jwks_uri`를 안내함을 확인했다. 구현 때 디스커버리 문서를 직접 호출해 한 번 더 대조한다.
- 필요한 것(전부 대표님 계정·약관 몫 → 2.5 목록):
  1. Kakao Developers 앱 등록(사업자 정보, 앱 키 발급)
  2. 카카오 로그인 활성화
  3. OpenID Connect 활성화
  4. Redirect URI 등록: `https://blade.tllhouse.com/api/v1/auth/oauth/callback/kakao`
  5. REST API 키 → Worker 변수 `KAKAO_REST_KEY`(비밀은 아니지만 레포에는 넣지 않고 wrangler 변수로). client_secret을 쓰면 `KAKAO_CLIENT_SECRET`은 **Worker secret 또는 Secrets Store**로만 둔다.
- 서버 흐름(구현됨, `worker/v1/oidc.ts`): `POST /api/v1/auth/oauth/start {provider:'kakao', mode}`가 1회용 `state`(해시만 저장)·`nonce`를 D1 `oauth_states`에 10분 만료로 저장하고 인가 URL을 돌려줌. 카카오는 서버 기밀 교환이라 PKCE를 쓰지 않는다(state·nonce·선택 client_secret) → `callback/kakao`에서 state 검증, 코드 교환, id_token의 iss/aud/exp/nonce/서명 검증 → `sub` 해시 → link 또는 recover. 닉네임·이메일·프로필 사진 동의항목은 요청하지 않는다(필요 최소).
- 카카오 비즈 앱 전환·동의항목 심사가 필요한지는 이번에 문서로 확인하지 못했다(**확인 못 함**). `openid`와 기본 식별만 쓰는 구성에서 필요한지 대표님 앱 등록 때 콘솔에서 확인한다.

### 2.3 ChatGPT — 서버 슬롯만, 기본 꺼짐
- 공식 문서(확인일 2026-10-29):
  - <https://developers.openai.com/siwc/website>: "limited trial", 선택된 상업 파트너에게만 제공, 대기자 명단은 OpenAI 담당자를 통해. issuer `https://auth.openai.com`, 엔드포인트는 `/.well-known/openid-configuration`에서 읽는다(authorize `https://auth.openai.com/api/accounts/authorize`, token `.../api/accounts/oauth/token`, JWKS `https://auth.openai.com/.well-known/jwks.json`). Authorization Code + PKCE(S256), scope `openid profile email`, 서버가 state·verifier·nonce를 보관하고 id_token의 서명·iss·aud·exp·nonce를 검증. 클라이언트 ID는 보통 `oaiapp_` 접두사이고 환경마다 콜백 URL을 정확히 등록. 공개 클라이언트는 인증 방식 `none`, 기밀 클라이언트는 `client_secret_basic`.
  - <https://developers.openai.com/siwc/request-client-id>: 대기자 명단은 "Sign in with ChatGPT interest form"으로 시작, 현재 선택된 상업 파트너에게만 제공. 폼: <https://openai.com/form/sign-in-with-chatgpt-interest/> (이 폼 URL 자체는 이번에 열어 보지 않았고 위 문서 안내를 따른 것).
  - 인게임에서 사용자의 ChatGPT 플랜을 쓰는 token sharing(예: scope `chatgpt.tokens.use.direct`)은 이번에 문서 본문을 확인하지 못했다(**확인 못 함**). 별도 파트너 승인이 필요하다는 전제로 **장래 계획**으로만 둔다.
- 결정(구현됨): 서버 코드 슬롯(`chatgpt` provider, OIDC 콜백, PKCE S256, 기밀이면 HTTP Basic)을 만들고 `CHATGPT_CLIENT_ID`가 없으면 꺼짐(`/auth/providers`가 false, start는 501 `provider-unavailable`), 클라이언트도 버튼을 숨긴다. 승인 후 클라이언트 ID와 콜백 URL(`.../callback/chatgpt`)만 등록하면 켜진다.
- **금지(명시)**: 쿠키 재사용, Codex/CLI 토큰 재사용, 세션 캡처 등 비공식 경로로 ChatGPT 로그인을 흉내 내지 않는다. 공식 OIDC 승인 전에는 버튼이 없다.
- 다른 선택지: 승인 전에도 데모용 우회 로그인 — 약관 위반 소지로 기각.

### 2.4 요약

| 제공자 | 현재 상태 | 켜는 조건 |
|---|---|---|
| 게스트 | 동작 | — |
| Google | 동작(연동·복구) | — |
| 카카오 | 서버·클라이언트 구현됨, `KAKAO_REST_KEY` 비어 있어 꺼짐 | 대표님 앱 등록·키 → wrangler `KAKAO_REST_KEY`(+ 필요 시 secret `KAKAO_CLIENT_SECRET`) |
| ChatGPT | 서버 슬롯 구현됨(PKCE), 꺼짐 | OpenAI 대기자 승인 후 `CHATGPT_CLIENT_ID` |

### 2.5 대표님 몫
1. 카카오 앱 등록, 카카오 로그인·OIDC 활성화, Redirect URI 등록, REST API 키(와 client_secret) 발급·전달 경로 결정(비밀은 채팅·Git에 쓰지 않고 Secrets Store/Worker secret).
2. ChatGPT 대기자 신청 여부(신청 시 폼 제출 내용에 회사·서비스 정보가 들어가므로 대표님 확인 필요). 승인이 나기 전에는 이 기능을 약속하지 않는다.

## 3. 리세마라 정책

**결정**: 막지도 장려도 하지 않고 **할 이유가 없게** 만든다.

- 시작 영웅은 가챠가 아니라 직접 선택 → 리세마라로 얻을 첫 결과의 분산이 없다.
- 권고(랄프 레인 소관, 수치·적용은 그쪽): 첫 뽑기 보장, 천장 카운트를 계정 이월(연동·복구 시 유지).
- 서버 비용 방어:
  1. **게스트 서버 행 지연 생성(구현됨, 클라이언트)** — 1-1 클리어 또는 연동 시작 전에는 `/auth/session`을 부르지 않아 D1 행이 생기지 않는다(`src/net/account.js`). 서버는 요청이 오면 만든다(서버만으로는 진행을 알 수 없음).
  2. **IP 해시 기준 새 계정 생성 한도** — 현재 `LIMITS.sessionNew` = 시간당 30(IP 해시당). 하루 100 `sessionNewDay`(구현됨). 기기 키 1개 = 계정 1개(이미 `account_keys` PK). 한도 숫자는 모바일 회선 공유(CGNAT) 오차단을 감안해 넉넉하게 잡았고, 429 응답에 `retryAfter`가 이미 있다.
  3. **미접속 게스트 보관(구현, `worker/v1/archive.ts`, 시간당 크론 최대 100건)** — 지휘 결정(2026-10-29)으로 시행. 연동 없음·무결제(gems_paid 0, 결제 기록 없음)·레벨 5 이하·180일 미접속·테스트 표시 없음인 계정의 진행 문서를 `account_archive`(reason `idle`)로 옮기고 `account_flags`에 `idle-archived`를 남긴다. 계정 행·기기 키는 그대로라 같은 기기로 돌아오면 세션 생성 때 같은 rev로 복원한다. 보관본 파기(1년)는 7장 `worker/v1/retention.ts`가 맡는다(시행). 원래 초안: 연동 없음·무결제·저레벨(레벨 5 이하) 게스트가 180일 미접속이면 `account_archive`로 옮기고 계정 행 정리. 영구 삭제가 아니라 보관이며, 보관 후 파기 시점은 개인정보처리방침 기준(부록 A: 보관 90일 후 파기 제안). 복구 수단이 기기 키뿐이라 돌아오면 보관분에서 복원 가능해야 한다.
- 다른 선택지: 기기 지문/광고 ID로 재가입 차단 — 기기 ID를 인증·식별에 쓰지 않는다는 MMO_DESIGN 원칙과 개인정보 부담 때문에 기각. 본인확인(휴대폰) 강제 — 이탈 비용이 커서 기각.
- 한계: IP 해시 한도는 우회 가능하며 목적은 대량 생성 비용 방어이지 개인 리세 차단이 아니다.

## 4. D1 비용 추정 (계정 10만 개)

**요금 근거**: <https://developers.cloudflare.com/d1/platform/pricing/>, 확인일 2026-10-29. Workers Paid 플랜 포함량과 초과 단가: 행 읽기 월 250억 포함, 초과 $0.001/백만 행 / 행 쓰기 월 5천만 포함, 초과 $1.00/백만 행 / 저장 5GB 포함, 초과 $0.75/GB-월. (Workers Paid 기본료 $5/월은 D1 외 서비스와 공유하므로 추가 비용에서 제외.) D1은 인덱스 갱신도 쓴 행으로 센다(MMO_DESIGN 3.14 전제).

### 가정
- 계정 10만, **DAU 10% = 1만**.
- 계정당 저장: accounts+인덱스+키+링크 ≈ 1.5KB, `account_docs.core` 평균 20KB, `legacy_saves` ≈ 22KB(문서 사본+리포트), 원장·런 티켓·우편·속도제한 등 누적 ≈ 30KB(보관 정책 전 값, 가정).
- 활성 1인당 하루 쓰기(인덱스 포함 행): 세션 1.5회 × ≈5 = 8, 명령 50회 × ≈6(원장 1 + 문서 1 + accounts 투영 1+인덱스 + rev) = 300, 런 20회 × (시작 2 + 정산 ≈6, 정산 일부는 위 명령과 겹치지 않는 별도 경로로 가정) = 160 → **약 470행/일**.
- 활성 1인당 하루 읽기: 세션 3 + 명령 50×3 + 런 20×8 ≈ **320행/일**.

### 계산

| 항목 | 계산 | 결과 | 포함량 | 추가 비용 |
|---|---|---|---|---|
| 저장(레거시 사본 유지) | (1.5+20+22+30)KB × 10만 | ≈ 7.3GB | 5GB | 2.3GB × $0.75 ≈ **$1.7** |
| 저장(레거시 사본 이관 후 파기) | (1.5+20+30)KB × 10만 | ≈ 5.2GB | 5GB | ≈ **$0.15** |
| 월 쓰기 행 | 470 × 1만 × 30 | 1.41억 | 5천만 | 9.1천만 × $1/백만 ≈ **$91** |
| 월 읽기 행 | 320 × 1만 × 30 | 0.96억 | 250억 | **$0** |
| 합계 | | | | **약 $93/월** (저장 포함 시 $93~$95) |

민감도(쓰기만): DAU 5% → 0.70억 행 → 초과 2천만 → **$20**, DAU 20% → 2.82억 → **$232**. 명령 쓰기가 전체의 64%이므로 **클라이언트 명령 묶음 전송/무변경 명령 생략으로 하루 명령 50→25**면 월 약 0.88억 행, 초과 3.8천만 → **약 $38**. 비용의 대부분은 계정 수가 아니라 DAU × 명령 빈도다. 위 숫자는 가정이며 실측(그림자 모드 `parity_log` 포함 쓰기량)으로 교체해야 한다. 참고로 읽기 사용량은 포함량의 0.4%라 읽기 비용은 무시 가능.

### 리세마라 계정 1만 개 추가 시
- **지연 생성 적용 시**: 서버 행 생성 전까지 쓰기는 속도 제한 카운터(`v1_rate`, 요청당 1행 안팎)뿐이다. 1-1 클리어 전에 버린 계정은 사실상 **$0**.
- **지연 생성 없을 때(현재 코드)**: 생성 배치 ≈ 8행(accounts 2 + docs 1 + keys 2 + 속도제한 등) × 1만 = 8만 행 ≈ **$0.08**, 저장 1만 × 약 22KB ≈ 0.2GB ≈ **$0.16/월**. 그 계정이 튜토리얼을 실제로 플레이하면 계정당 약 150~200행 × 1만 = 약 200만 행 ≈ **$2**.
- 결론: 리세마라 때문에 D1 비용이 크게 늘지는 않는다. 지연 생성의 실제 이유는 비용보다 **랭킹·길드 후보·GM 조회에 쌓이는 죽은 계정 정리 부담**이다. 그래서 우선순위는 낮음~중간.

## 5. 회원 탈퇴

**결정(1단계 구현됨)**: `POST /api/v1/auth/delete {confirm:'DELETE'}`(세션 토큰 + 2단계 확인 UI). 경로는 이것으로 확정하고 MMO_DESIGN 3.2의 `DELETE /api/v1/account`는 대체한다. 제공자 재인증은 아직 요구하지 않는다(후속). 스키마는 `accounts.status`에 `deleting`/`deleted`가 이미 있고 `assertActive`가 로그인을 막는다.

1. [구현됨] 즉시 `status='deleting'`, `token_ver` 증가(모든 세션 폐기), 로그인·복구 차단.
2. [구현됨] 즉시 제거: `account_links`(연동), `account_keys`(기기 키). 진행 문서 사본을 `account_archive`(reason `deleted-by-user`, purge_at = 30일)에 남김. [구현] 소셜 허브의 기기 키·연동·친구·친구 요청·차단·파티 모집·쪽지 삭제와 이름 익명화(`탈퇴한 모험가`, 플레이어 id는 게시글·명예 기록 참조용으로 유지). 허브가 응답하지 않으면 탈퇴를 진행하지 않는다(503, 재시도). 열린 소셜 소켓은 4003으로 닫고, 가입 IP 해시·대표 영웅·명예 기록 주체 해시는 비운다. 익명 태그는 `x<가입 순번>`(일반 숫자 태그와 겹치지 않음). **알려진 한계**: 게스트 A로 시작한 기기가 연동 계정 B로 복구(recover)한 뒤 B를 탈퇴하면, 허브의 그 기기 키→A 매핑과 A의 이름·친구는 남는다(허브는 계정 id 기준으로만 지움). 후속: 탈퇴 직전 그 계정의 `account_keys` 해시로 허브 `player_keys`를 찾아 함께 지우기.
3. [지휘 결정 2026-10-29 시행] 진행 문서(`account_docs`, `legacy_saves`)는 **30일 보관** 후 파기(실수 탈퇴 복구용). 30일 안에 고객센터로 요청하면 복구 가능.
4. [지휘 결정 2026-10-29 시행] 30일 후 시간당 크론이 우편·런 티켓·탈퇴 보관본까지 지우고 `status='deleted'`로 바꾸며 레벨·재화 투영값을 비운다. 표시명("탈퇴한 모험가")은 탈퇴 때 소셜 허브에서 이미 익명화됐다. 연동 해시는 90일 묘비로 옮겨진다(7장).
5. **결제·환불 기록은 법정 보존**: 현재 `privacy.html`과 `PAYMENT_COMPLIANCE.md`(전자상거래법 제17조·시행령 기준)에 맞춰 계약·청약철회 및 대금결제·공급 기록 5년, 소비자 불만·분쟁 처리 기록 3년. 해시 식별자로만 남기고 목적을 제한해 보관 후 파기. 탈퇴 시 유료 재화 잔액 처리(`PAYMENT_COMPLIANCE.md` 체크리스트의 "계정 삭제 시 잔액 처리")는 약관에 명시해야 하며 이 문서에서 수치로 정하지 않는다.
6. 스토어 계정(Google·카카오·OpenAI) 자체는 삭제되지 않는다.

다른 선택지: 즉시 파기(복구 불가) — 오조작 피해가 크고 CS 부담이 커서 기각. 90일 유예 — 개인정보 최소 보관 원칙상 30일로 기각. Google Play 정책이 앱 내 삭제 경로와 웹 링크를 요구하므로(MMO_DESIGN 3.2) 앱 설정 메뉴와 `support.html` 양쪽에 둔다.

### 고객센터(support.html) 문구 초안
> **계정 삭제(회원 탈퇴)**
> 게임 설정 → 계정 → 계정 삭제에서 직접 신청할 수 있습니다. 신청 즉시 로그인이 막히고 연동·기기 정보가 삭제되며, 게임 진행 기록은 30일 보관 후 파기됩니다(30일 안에는 고객센터 이메일로 취소를 요청할 수 있습니다). 앱을 사용할 수 없는 경우 aljjang95@gmail.com 으로 이용한 로그인 방식과 요청 내용을 알려 주세요. 본인 확인 후 처리합니다. 전자상거래법에 따라 결제·환불 기록은 5년(분쟁 처리 기록은 3년) 보관되며, Google·카카오·OpenAI 등 로그인 제공자 계정은 삭제되지 않습니다. 비밀번호·인증 토큰은 보내지 마세요.

## 6. 운영 켜기 조건과 남은 일

**운영 켜기 조건**
1. 운영 D1에 0001~0005 적용. 2026-10-29 조회 결과 운영 D1에는 `store_*` 표만 있고 V1 표가 하나도 없다(0001부터 미적용). `SCHEMA_VERSION = 5`라 다섯 개가 모두 있어야 V1이 열린다. 절차는 `docs/V1_ROLLOUT.md` 3장.
2. `V1_ENABLED` 켜기, `SESSION_HMAC` 시크릿 확인, 컷오버는 `V1_SERVER_AUTHORITY_PERCENT`로 점진.
3. **결제 플래그는 별도로 꺼짐 유지**(계정 켜기와 묶지 않음).
4. 개인정보처리방침·고객센터를 부록 문구로 갱신한 뒤 새 로그인 제공자를 켠다(제3자 제공자 고지 선행).
5. 카카오는 대표님 등록 완료 후, ChatGPT는 OpenAI 승인 후에만.

**구현 현황(2026-10-29, 브랜치 `claude/account-login`)**: 구현 — 0005 마이그레이션(제공자 확장·oauth_states), 카카오·ChatGPT OIDC 콜백, `/auth/providers`, `sessionNewDay`, 게스트 지연 생성, 탈퇴 1단계, 첫 화면 로그인 시트. 후속(2026-10-29 2차 PR) — 구현: 탈퇴 시 소셜 허브 정리, 미접속 게스트 보관 크론·복원, 계정 표시 표(`account_flags`: test·idle-archived, 0006), privacy/support 문구. 시행(2026-10-29, 브랜치 `claude/account-retention-purge`, 마이그레이션 0007): 보관본·탈퇴 문서 파기 크론, 남용 방지 묘비(7장). 남음: 연동 보상(저장 정규화가 제품 우편 목록 밖 항목을 버려서 저장 스키마에 1회 표시 필드가 필요 → 성장·경제 레인에 명세 전달), 탈퇴 제공자 재인증.

## 7. 보관·파기·남용 방지 표 (지휘 결정 2026-10-29 시행)

모든 파기는 시간당 크론(`worker/index.ts` `scheduled` → `purgeRetention`)이 `runRetention`으로 돌리며 단계마다 1회 최대 100건이다. 각 삭제 문장에 상태·기한 가드가 붙어 조회와 삭제 사이에 상태가 바뀌면 0행으로 끝난다. 운영 적용은 마이그레이션 0007 먼저(`SCHEMA_VERSION = 7`).

| 항목 | 기간 | 근거 | 구현 위치 |
|---|---|---|---|
| 탈퇴 계정의 진행 데이터(`account_docs`·`legacy_saves`·`mail`·`run_tickets`·`parity_log`·`oauth_states`·탈퇴 보관본) | 탈퇴 후 30일, 이후 파기하고 `accounts.status='deleted'`로 익명화 | 실수 탈퇴 복구 + 개인정보 최소 보관 | `retention.ts` `purgeWithdrawnAccounts`, 탈퇴는 `auth.ts` `deleteAccount` |
| 기기 이관(`switched:*`) 보관본 | 90일 | 다기기 복원 정책(1장) | `retention.ts` `purgeExpiredArchives`, 기간 `auth.ts` `ARCHIVE_MS` |
| 미접속 게스트 보관본(`idle`) | 보관 후 1년(`IDLE_PURGE_MS`), 보관 자체는 180일 미접속·무연동·무결제·레벨 5 이하·test 표시 없음 | 개인정보처리방침 기준 | 보관 `archive.ts`, 파기 `retention.ts` |
| 탈퇴 연동의 제공자 식별자 해시(묘비 `withdrawn`) | 90일 | 부정이용(1회 보상 반복 수령) 방지 | `tombstone.ts` `WITHDRAWN_TOMBSTONE_SQL`(탈퇴 배치) |
| 정지(banned) 계정 연동의 해시(묘비 `banned`) | 정지 후 1년(마지막 ban 제재 시각, 없으면 last_seen 기준) | 같은 목적, 정지 회피 방지 | `tombstone.ts` `syncBannedTombstones`(크론이 연동을 묘비로 올림) |
| 만료된 묘비 | 만료 즉시 | 최소 보관 | `tombstone.ts` `purgeExpiredTombstones` |
| 결제·환불 기록(`wallet_ledger`의 결제분, `iap_*`, 포트원 결제) | 5년(분쟁 처리 3년) | 전자상거래법 | **이번 범위 밖**. 파기 코드 없음. 후속: 5년 경과 결제 기록의 해시화·파기 작업 |
| `audit_flags`·`sanctions` | 현행 유지(이번 파기 대상 아님) | 부정행위 판정·제재 근거 | 후속: 보관 기간 결정 필요 |

**미접속 게스트 파기의 계정 처리(결정 2)**: 보관본이 사라지면 복원이 불가능하므로 `accounts`를 `deleted`로 익명화하고 기기 키와 `idle-archived` 표시를 지운다. 단 소셜 허브는 같은 기기 키에 같은 플레이어 id를 계속 돌려주므로 `deleted` 행을 그대로 두면 돌아온 기기가 영구히 403이 된다. 그래서 `ensureAccount`(`auth.ts`)가 연동·결제 이력 없는 `deleted` 계정을 새 계정으로 되살린다(진행은 새로 시작, 가입은 막지 않음). 탈퇴 계정은 허브 매핑이 지워져 새 id를 받으므로 이 경로에 오지 않는다. 복원(`restoreIdle`)이 끝나면 쓴 보관본을 지워 재보관 시 옛 `purge_at`이 남지 않게 했다.

**남용 방지 묘비 연결 지점**: 서버에는 아직 연동 보상 지급 코드가 없다(1장: 저장 스키마에 1회 표시 필드가 필요해 성장·경제 레인 소관). 지급 코드를 만들 때 `linkSubject`가 새 연동을 만든 직후, 보상 지급 직전에 `hasRecentTombstone(db, provider, subjectHash, now)`를 부르고 true면 '1회 보상 이미 받음'으로 처리한다. 이 함수는 가입·연동·진행을 막는 데 쓰지 않는다(리세마라를 막지 않는 결정). 저장 값은 `account_links.subject_hash`(= `sha256(provider:sub)`)뿐이며 원문 식별자는 어디에도 없다.

---

## 부록 A. 개인정보처리방침 추가 문구 초안 (`public/privacy.html`에 아직 반영하지 않음)

> **계정·로그인**
> 게스트로 시작하면 기기에서 만든 임의의 기기 키가 서버에 전달되며, 서버에는 그 해시만 저장합니다. Google, 카카오, (제공 시) OpenAI 계정으로 계속하면 해당 제공자가 확인한 계정 고유 식별자(sub)를 서버가 받아 **해시만** 저장하고 원문은 저장하지 않습니다. 이메일·이름·프로필 사진은 저장하지 않습니다. 이 해시는 다른 기기에서 같은 진행을 복원하고 중복 계정을 막는 데만 사용합니다.
>
> **수집 항목** 제공자 식별자 해시 / 기기 키 해시 / IP 해시(새 계정 생성·로그인 시도 속도 제한 목적, 원문 IP는 저장하지 않으며 해시 카운터는 만료 후 삭제) / 게임 진행 기록 / 결제·환불 기록(유료 구매 시).
>
> **제3자 로그인 제공자** Google LLC, 주식회사 카카오, OpenAI(제공 시)는 사용자가 선택한 로그인의 인증을 위해 해당 서비스의 개인정보처리방침에 따라 정보를 처리합니다. 로그인 방식은 선택 사항이며 게스트로도 이용할 수 있습니다.
>
> **보관·파기** 계정 정보와 진행 기록은 회원 탈퇴 시까지 보관합니다. 탈퇴를 신청하면 연동·기기 키 정보는 즉시 삭제하고 진행 기록은 30일 보관 후 파기합니다. 연동 없는 기기 계정을 연동 계정으로 전환한 경우 이전 기기 진행은 90일 보관 후 파기합니다. 연동 없고 결제 이력 없는 저레벨 게스트 계정이 180일 이상 접속하지 않으면 보관 처리하고 90일 후 파기합니다(정책 초안, 시행 시 확정). 전자상거래법에 따라 결제·환불 기록은 5년, 분쟁 처리 기록은 3년 보관합니다.
>
> **삭제·열람 요청** 설정 → 계정 → 계정 삭제 또는 aljjang95@gmail.com.

주의: 현재 `privacy.html`의 "구글 계정 연결 시 고유 식별자 해시만 저장"(커뮤니티 절)과 일관되게 병합하고, 카카오·OpenAI 문구는 실제로 켜는 시점에 함께 공개한다.

## 부록 B. 확인 한계
- 카카오 비즈 앱·동의항목 심사 필요 여부, ChatGPT token sharing 상세 scope, OpenAI 관심 폼 URL 자체는 이번에 직접 확인하지 못했다.
- D1 비용은 가정 기반 추정이며 실측 전 확정 수치가 아니다.
