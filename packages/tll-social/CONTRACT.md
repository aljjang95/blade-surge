# 커뮤니티 시스템 Task Brief (tll-social v1)

대표님 요청(2026-10-19): 게임 중인 사람들과 채팅, 파티 사냥·친구 추가, 커뮤니티 활성화, 먼저 하고 먼저 깬 사람이 자부심을 느끼는 구조, 이슈·버그·업데이트 희망·아이디어 공유 창구(디스코드 포함). 다른 게임에서도 재사용한다.

## 원칙

- 재사용 패키지 'packages/tll-social/'는 게임 비종속이다. 블레이드 서지 코드를 import하지 않는다. 게임은 설정 객체(GameConfig)로 콘텐츠 목록·칭호·제한을 넘긴다.
- 서버는 Cloudflare Durable Object 하나(SocialHub, 이름 'hub:<gameId>')에 SQLite(ctx.storage.sql)로 저장하고 절전형 WebSocket(ctx.acceptWebSocket, webSocketMessage, webSocketClose, serializeAttachment)을 쓴다. 새 Cloudflare 리소스(D1/KV) 생성 없이 Worker 배포의 DO 마이그레이션만으로 동작해야 한다.
- 로직은 순수 클래스 SocialCore(Sql 인터페이스·시계·난수 주입)에 두고 DO는 얇은 어댑터로 만든다. 테스트는 bun:sqlite로 Sql 인터페이스를 흉내 내 'bun test'로 돌린다(기존 worker/party-state.ts 패턴과 같다).
- 클라이언트 입력은 모두 검증한다: 문자열 NFKC 정규화·길이 제한, 정수 범위, 알 수 없는 키 거부. 응답은 Cache-Control: no-store, X-Content-Type-Options: nosniff.
- 모든 /api/social/* 요청은 기존 파티와 같은 origin 검사(APP_ORIGIN, origin 헤더, sec-fetch-site cross-site 거부)를 거친다. 로컬 개발(http://localhost:*, http://127.0.0.1:*)은 env.SOCIAL_DEV_ORIGINS === 'true'일 때만 허용한다. GET 공개 조회(fame, board 읽기)도 같은 검사를 하되 origin 헤더가 없는 GET은 sec-fetch-site가 cross-site가 아니면 허용한다.
- 비밀값(디스코드 웹훅 URL)은 env에서만 읽고 로그·응답에 넣지 않는다. 설정되지 않으면 그 기능만 조용히 꺼진다.

## 신원 (고위험: 계정·세션 → 교차 리뷰 1회 대상)

- 클라이언트가 32바이트 난수 deviceKey(base64url 43자)를 만들어 localStorage 'tll-social:<gameId>:key'에 보관한다. 키 자체가 기기 이전 코드다.
- 서버는 keyHash = SHA-256(gameId + ':' + deviceKey) hex만 저장한다. playerId는 프로필 생성 때 서버가 발급하는 난수('p_' + 24 hex)다.
- REST 인증: 'Authorization: Bearer <deviceKey>'. 형식 오류 401 'bad-key', 프로필 없음 401 'no-profile'(POST /profile만 예외), 차단(ban) 403 'banned'.
- WebSocket 인증: POST /api/social/ws-ticket → 60초 유효·1회용 티켓(16바이트 hex) → GET /api/social/ws?ticket=... 업그레이드. 키를 URL에 넣지 않는다. 한 플레이어 소켓 최대 3개, 넘으면 가장 오래된 것을 닫는다.
- 프로필 생성은 IP(cf-connecting-ip의 SHA-256)당 시간당 5개로 제한한다.

### 계정 결정: 게스트 우선 + 구글 연동은 선택 (대표님 질문 2026-10-19 "구글 로그인 계정 진행해야하나?")

- 출시 시점에는 로그인 없이 바로 시작한다(기기 키 = 게스트 신원). 채팅·친구·파티·기록 모두 게스트로 쓸 수 있다. 첫 화면에 로그인 벽을 두면 신규 유입이 크게 떨어지고, 지금 게임 진행 저장도 기기(localStorage)에 있으므로 커뮤니티만 로그인을 요구할 이유가 약하다.
- 구글 연동이 필요한 이유는 세 가지다: (1) 폰 분실·앱 재설치·웹↔안드로이드 이동 때 친구·칭호·창립 번호를 되찾는 기록 보호, (2) 한 사람이 여러 기기 키로 명예의 전당을 채우는 부정 방지, (3) 나중에 결제·구매 복원에 쓸 같은 계정 축. 그래서 "선택 연동"으로 붙이고, 가치 있는 순간(첫 칭호 획득, 창립 모험가 번호 확정, 친구 3명 달성, 첫 결제 전)에 "기록 보호하기" 안내를 띄운다.
- 명예의 전당: 게스트도 순위·칭호를 받는다. 구글 연동한 사람은 이름 옆에 '인증' 표시가 붙고, 관리자는 부정 의심 시 미연동 기록부터 검토한다. (대표님이 "순위는 연동 필수"로 바꾸고 싶으면 설정값 `fame.requireLinked` 하나로 바꾼다.)
- 서버 구조: 신원과 키를 분리한다. `player_keys(key_hash PK, player_id, created_at, last_seen)` — 한 플레이어가 기기 키 여러 개(최대 5)를 가질 수 있다. `account_links(provider, subject_hash, player_id, created_at, PK(provider, subject_hash))` — provider는 'google'부터, 나중에 'apple'·'toss'(앱인토스 채널은 토스 로그인 사용)를 같은 표로 더한다. 이메일·이름 같은 개인정보는 저장하지 않고 구글 `sub`의 SHA-256만 저장한다(개인정보 처리 최소화).
- API(env.GOOGLE_CLIENT_IDS가 비어 있으면 503 'link-disabled'로 꺼짐):
  - `POST /auth/link {provider:'google', idToken}` (키 인증) — 현재 플레이어에 구글 계정을 연결. 이미 다른 플레이어에 연결된 계정이면 409 'linked-elsewhere'.
  - `POST /auth/recover {provider:'google', idToken}` (키 인증 불필요, 대신 새 deviceKey를 본문 `deviceKey`로 받음) — 연결된 플레이어를 찾아 그 deviceKey를 player_keys에 추가하고 Profile 반환. 키가 5개를 넘으면 가장 오래 안 쓴 키를 지운다. IP당 시간당 10회 제한.
  - `POST /auth/unlink {provider}` (키 인증) — 연결 해제.
  - ID 토큰 검증: Google JWKS(`https://www.googleapis.com/oauth2/v3/certs`, Cache-Control max-age 동안 캐시)로 RS256 서명, `iss` ∈ {accounts.google.com, https://accounts.google.com}, `aud` ∈ GOOGLE_CLIENT_IDS(쉼표 구분: 웹·안드로이드), `exp` 미래, `iat` 10분 이내, `email_verified`는 요구하지 않음(sub만 씀). WebCrypto `crypto.subtle.importKey('jwk', ..., {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'})`로 검증하고 외부 라이브러리를 쓰지 않는다.
- 클라이언트: 웹은 Google Identity Services 버튼(gsi/client 스크립트를 연동 버튼을 누를 때만 지연 로드), 안드로이드 앱(Capacitor)은 Credential Manager 기반 플러그인으로 같은 ID 토큰을 받는다. SDK는 `linkGoogle(idToken)`, `recoverWithGoogle(idToken)`, `unlink(provider)`만 제공하고 버튼·스크립트 로드는 UI 쪽 책임이다.
- 대표님이 할 일(에이전트가 대신 준비 가능): Google Cloud 콘솔에서 OAuth 클라이언트 ID(웹: 승인된 출처 https://blade.tllhouse.com, 안드로이드: 패키지명 + 서명 SHA-1)를 만들고 Worker 변수 GOOGLE_CLIENT_IDS에 넣는다. 범위는 openid만 쓰므로 Google 앱 검증 심사가 필요 없는 기본 범위다. 동의 화면에 넣을 개인정보처리방침 URL은 tllhouse.com 하위에 둔다.

## 데이터 모델 (SQLite, schema_version 테이블로 마이그레이션)

- players(id PK, name, tag, no, created_at, renamed_at, title_id, muted_until, banned). name 2~12자(한글·영문·숫자·_), tag 4자리 숫자(같은 name 안에서 유일, 무작위), no는 1부터 증가하는 가입 순번(창립 모험가 번호). 키는 player_keys, 외부 계정은 account_links(위 '계정 결정' 참고).
- friends(a, b, created_at, PK(a,b)) 양방향 두 행, 최대 100명. friend_requests(from_id, to_id, created_at) 받은 요청 최대 50개.
- blocks(owner, target) 최대 200명. 차단 관계의 채팅·귓속말·초대·친구요청·모집 목록은 서버가 걸러서 보내지 않는다.
- runs(id PK, player_id, content_id, mode, started_at, cleared_at NULL). 2시간 지나면 무효·정리. 플레이어당 열린 런 최대 5개(넘으면 가장 오래된 것 폐기).
- clears(content_id, player_id, first_at, best_ms, count, rank, revoked 0/1, PK(content_id, player_id)). rank는 그 콘텐츠를 처음 깬 순서(1부터, 상한 없음).
- titles(player_id, title_id, earned_at, PK).
- dm_inbox(id autoinc, to_id, payload JSON, created_at) 오프라인 귓속말·초대·친구 알림, 1인 최대 100개, 접속 시 전달 후 삭제.
- chat_log(channel, id, at, payload) 광장 채널별 최근 history개.
- listings(id, host_id UNIQUE, party_code, content_id, note, slots, members, created_at, expires_at) 파티 모집, TTL 10분(호스트가 다시 POST하면 갱신).
- posts(id autoinc, author_id, category, title, body, diag JSON, status, votes, comments, created_at, updated_at, dev_reply, hidden). category: bug | idea | request | question | notice(notice는 관리자만). status: open | reviewing | planned | done | wontfix.
- votes(post_id, player_id), comments(id autoinc, post_id, author_id, body, created_at, dev 0/1).
- reports(id, reporter, target, kind, ref, reason, created_at). 1시간 안에 서로 다른 3명이 같은 대상을 채팅 신고하면 대상 10분 자동 음소거.
- 속도 제한은 메모리 맵(DO 인스턴스 수명) + 시간 단위 제한(글·신고·프로필 생성)은 SQLite.

## GameConfig (게임이 넘김)

    {
      gameId: 'blade-surge',
      worldChannels: 3, worldCapacity: 150,
      contents: [{ id: 'emberwake_drydock', name: '불씨항 건선거', minClearSec: 40 }],
      titleTiers: [
        { id: 'first', maxRank: 1, label: '최초 정복자' },
        { id: 'pioneer', maxRank: 10, label: '선구자' },
        { id: 'vanguard', maxRank: 100, label: '개척자' },
      ],
      founders: { maxNo: 1000, titleId: 'founder', label: '창립 모험가' },
      completion: { titleId: 'conqueror', label: '전 지역 정복자' },
      dmFriendsOnly: true,
      chat: { maxLen: 120, minGapMs: 1200, burst: 5, burstWindowMs: 10000, history: 50 },
      bannedWords: [],
    }

칭호 id: '<tierId>:<contentId>'(예: first:emberwake_drydock), 'founder', 'conqueror'. 서버가 표시 문구를 붙여 준다(예: '최초 정복자 · 불씨항 건선거'). 한 콘텐츠에서는 가장 높은 구간 칭호 하나만 준다. 패키지는 기본 한국어·영어 금칙어 목록을 제공하고 게임 목록을 더한다.

## REST API (/api/social 접두사, JSON 본문 최대 8KB)

| 메서드 경로 | 인증 | 설명 |
|---|---|---|
| POST /profile {name} | 키 | 없으면 생성(no·tag 배정, no ≤ founders.maxNo면 founder 칭호), 있으면 이름 변경(24시간 1회, tag 재배정). 응답 Profile |
| GET /me | 키 | Profile, 친구(온라인·presence 포함), 받은·보낸 요청, 차단 목록, 칭호, 대표 칭호, isAdmin |
| POST /me/title {titleId or null} | 키 | 보유한 칭호만 대표로 |
| GET /players/lookup?code=이름#1234 | 키 | 공개 프로필 |
| GET /players/:id | 키 | 공개 프로필(이름·태그·no·대표 칭호·칭호 목록·클리어 수·가입일, 친구면 온라인 여부) |
| POST /friends/request {code or playerId} | 키 | 상대가 이미 요청했으면 바로 친구. 자기 자신·차단 관계 거부 |
| POST /friends/respond {playerId, accept} | 키 | |
| POST /friends/remove {playerId} | 키 | |
| POST /blocks {playerId, blocked} | 키 | 차단 시 친구·요청 정리 |
| POST /ws-ticket | 키 | {ticket, expiresAt} |
| GET /listings | 키 | 살아 있는 모집 최신순 50(차단 관계 제외) |
| POST /listings {partyCode, contentId or null, note(≤40), slots(2~4), members(1~4)} | 키 | partyCode는 ^[A-F0-9]{20}$. 처음 만들 때만 광장 채널 전체에 kind:'listing' 시스템 메시지 |
| DELETE /listings | 키 | 내 모집 삭제 |
| POST /runs/start {contentId, mode: solo or party} | 키 | {runId}. 모르는 contentId 400 |
| POST /runs/clear {runId} | 키 | 서버 시각 기준 경과 ≥ minClearSec, ≤ 2h, 1회만. 응답 {contentId, elapsedMs, firstClear, rank, bestMs, newBest, newTitles[]}. 칭호 구간에 들면 모든 소켓에 kind:'fame' 시스템 메시지 + 디스코드 명예 웹훅. 모든 콘텐츠를 처음 다 깨면 conqueror 칭호와 fame 메시지 |
| GET /fame | 없어도 됨 | 콘텐츠별 최초 상위 10(rank·이름#태그·시각)·최단 상위 10, 정복 순위 상위 50(깬 콘텐츠 수 내림차순, 마지막 달성 시각 오름차순), 가입자 수, 창립 모험가 남은 자리 |
| GET /fame/:contentId | 없어도 됨 | 최초 100명, 최단 50명 |
| GET /board?category=&sort=new or top&cursor= | 없어도 됨 | 20개씩, hidden 제외. 각 글에 작성자 PublicMini, 내 공감 여부(키 있으면) |
| GET /board/:id | 없어도 됨 | 글 + 댓글 |
| POST /board {category, title 2~40, body 1~1000, diag?} | 키 | 시간당 3개. diag는 문자열·숫자 값만 있는 평면 객체 1KB 이하 |
| POST /board/:id/vote | 키 | 토글 |
| POST /board/:id/comment {body 1~300} | 키 | 시간당 20개. 관리자면 dev=1 |
| POST /board/:id/moderate {status?, devReply?, hidden?} | 관리자 | env.SOCIAL_ADMIN_IDS(쉼표 구분 playerId) |
| POST /report {kind: chat or post or player, target, ref?, reason ≤ 100} | 키 | 시간당 10개 |
| POST /admin/mute {playerId, minutes}, /admin/ban {playerId, banned}, /admin/revoke-clear {playerId, contentId} | 관리자 | revoke는 그 사람 기록을 revoked=1로 숨기고 해당 칭호를 회수(다른 사람 rank는 그대로) |

새 글(bug, idea, request)은 env.DISCORD_WEBHOOK_BOARD가 있으면 embed로, 칭호 구간 최초 클리어는 env.DISCORD_WEBHOOK_FAME으로 보낸다. 웹훅 실패는 무시하고 응답을 막지 않는다(ctx.waitUntil). 웹훅 본문의 사용자 문자열은 @everyone·@here·멘션을 무력화한다(allowed_mentions: {parse: []}).

## WebSocket 프로토콜 (JSON 텍스트, 메시지 최대 2KB, 초당 10개)

클라이언트 → 서버
- {t:'hello', presence:{state:'lobby'|'battle'|'party', where?: ≤24자}} 접속 직후. 서버는 welcome.
- {t:'presence', presence} 친구에게 전달(2초에 1회 제한)
- {t:'join', channel} channel = 'world-1'..'world-N' 또는 'party:<20자 파티코드>'. 광장은 하나만, 파티 채널은 하나만 추가로.
- {t:'leave', channel}
- {t:'say', channel, text, nonce} nonce 8~32자 [A-Za-z0-9_-], 같은 nonce 무시
- {t:'whisper', to, text, nonce} dmFriendsOnly면 친구만. 오프라인이면 inbox.
- {t:'invite', to, partyCode} 친구에게 파티 초대(오프라인이면 inbox)
- {t:'ping'}

서버 → 클라이언트
- {t:'welcome', me: PublicMini, world: 'world-1', channels: [{id, count}], history: {'world-1': [Msg]}, inbox: [Msg], friends: [{id, online, presence}]}
- {t:'msg', m: Msg} Msg = {id, channel or null, kind: chat|whisper|system|invite|fame|listing, from?: PublicMini, to?: id, text, at, data?}
- {t:'history', channel, items:[Msg]} 채널을 옮겼을 때
- {t:'presence', id, online, presence}
- {t:'friend', event: request|accepted|removed, player: PublicMini}
- {t:'channels', channels:[{id, count}]}
- {t:'error', code, retryAfterMs?} rate, muted, length, blocked, not-friend, banned 등
- {t:'pong'}

PublicMini = {id, name, tag, no, title: {id, label} or null}.

채팅 필터: 금칙어는 같은 길이의 '*'로 가린다(공백·특수문자 끼워 넣기 일부 대응). URL(http, www., 도메인 형태)은 '[링크]'로 바꾼다. 같은 내용 연속 3회 거부. 음소거·차단(ban)이면 거부. 공백만 있는 메시지 거부.

## Blade Surge 통합

- src/social/config.js(GameConfig, contents는 ALL_DUNGEONS에서 생성), src/social/integration.js(앱 연결).
- worker/index.ts에 /api/social 라우팅 + SocialHub export, wrangler.jsonc에 DO 바인딩 SOCIAL과 마이그레이션 태그 social-hub-v1(new_sqlite_classes: SocialHub).
- 던전 출격 시 runs/start, settle() 승리 시 runs/clear. 네트워크 실패는 게임 진행·보상을 절대 막지 않는다(커뮤니티는 부가 기능이며 오프라인에서도 게임은 그대로).
- 화면 규칙(대표님 전역 규칙): 전투 중에는 플레이 영역을 가리지 않는다. 전투 중 채팅은 가장자리 얇은 띠(최대 2줄, 4초 후 흐려짐)와 미확인 배지만.
