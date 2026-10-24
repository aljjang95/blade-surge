# 소환 구조 재설계 인계 (2026-10-24, gogo-chunk:gacha-bm)

설계 정본: `docs/BM_DESIGN.md` 12장. 머지 PR #279(squash `2b561e0`), 운영 `https://blade.tllhouse.com/version.json` = `2b561e0`(2026-10-24 13:06 UTC 빌드).

## 끝난 것
- 배너 3종(`src/data/gacha-banners.js`): 영웅(SSR 2%, 80회 확정, 픽업 50%+실패 뒤 확정, SR 영웅 34%) / 장비(SSR 3% L 장비, 60회 확정, 픽업 세트 50%+확정) / 초보자(10회 1,350, 20회 안 SSR 영웅 확정, 미보유 SR 우선, 10회 마지막 칸 미보유 SR 확정). 2주 교대 픽업(기준 2026-10-26 00:00 KST).
- 소환 마일리지(영웅 배너 1회=1점, 200점=지금 픽업 SSR 교환), 영웅은 소환으로만(첫 획득 해금·중복 조각 40), 보석 해금 사다리 닫음(`HERO_UNLOCK_VIA_GACHA`).
- 영웅 직접 판매 상품 `enabled:false, gate:'gacha-only'` — 신규 판매만 막고 기존 영수증 검증·지급·앱 복구는 유지(`verifiableProduct`, Android `CATALOG_TYPES`).
- 유료/무료 보석 분리(`paidGems`, 무료부터 소비, 결제 지급만 유료·부채 상계 뒤 순 지급, 환불 역분개 유료 먼저, 서버 투영 `gems_free/gems_paid`, 서버 소유·패리티 필드, 가져오기는 서버 값만).
- 서버 명령 `pull`·`pullSSR`·`exchangeMileage`(같은 배너 표, 서버 난수·시계).
- 출석 7일째 SSR 확정권 → 소환권 5. SSR 확정권은 SSR 영웅 균등.
- 소환 탭 UI(시안 A): 배너 탭(방향키), 픽업 카운트다운, 천장 바·픽업 확정 배지·마일리지 교환, 배너별 확률·구성품(함수 값만, 초보자는 계정 기준 조건부 확률), 유료/무료 보석 표시, 세로·짧은 가로 레이아웃.
- 도구: `bun tools/gacha-sim.mjs --assert`(90일 페르소나 밴드), 추정기 픽업 확정·확정권 균등 반영, `economy-pace.js` 재생성.
- 문서: BM 12장(12.8 흥행작 구조 채택표, 12.9 배너 그림체 규칙), `docs/GRAC_RATING_DRAFT.md`(등급분류 초안, 제출 안 함).
- 시안: 브랜치 `claude/gacha-concepts` `docs/concepts/gacha/`(A 왕좌의 문 = 기본, B 별의 제단, C2 할로윈 치비).

## 검증
- `bun run check` exit 0(5,298 통과) · `sim:90d` 통과 · `gacha-sim --assert` 통과(head `944ad64`; 이후 CSS만 변경, 빌드 재확인).
- 교차 리뷰 3회(PC OpenCodex gpt-6.1-sol xhigh; GitHub Codex는 사용량 한도로 실패): 1차 P2 7, 2차 P1 1(가져오기 마일리지 위조)+P2 3, 3차 P2 2 — 전부 수정 또는 근거 기록(PR #279 댓글).
- Playwright 로컬: 844x390·1280x720·800x360·390x844·360x800·640x320.
- 운영 readback·촬영(2026-10-24 22:1x KST): version.json `2b561e0`(dirty=false). 영웅·장비·초보자 배너·확률 모달 × 360x800·390x844·1280x720 겹침·잘림 없음, pageerror 없음. 콘솔의 `POST /api/v1/auth/session` 503(`unavailable`)은 v1 서버가 켜지지 않은 기존 상태(`V1_ENABLED`·스키마 게이트, 운영 D1에 결제 표 없음)이며 이 변경과 무관. `/api/social/me` 401은 비로그인 응답.

## 결정과 버린 안(요약)
- 영웅 배너 SR 영웅 몫 0.75 → 0.34: 0.75는 무과금 SR→SSR 14일(대역 3~4주 이탈)·sim:90d 정체 밴드 파손. 0.34에서 26일·SSSR 63일(기존과 동일).
- 무과금 픽업 획득 밴드: 평균 1.5 이상(실측 1.7) — 처음 잡은 '중앙값 2'는 정수 경계에서 시드마다 흔들려 평균으로.
- 기존 구매 보석 유료 이관: 운영 D1에 `iap_grants` 테이블이 없어(결제 미개시) 대상 0건 → 코드 없음, 결제 개시 게이트에 '개시 전 지급 0건 확인'.

## 남은 것(우선순위)
1. 서버 권위 모드 전에 소환을 "서버 결과 먼저 받고 연출"로(지금은 클라이언트 선굴림 + 서버 재실행 패리티).
2. 신규 SSR 3명(늑대인간 족장은 2차, 검은 고양이 사냥꾼은 3차에서 완료 — 밤까마귀·벚꽃 무사·용암 오니 군주) 영웅 정의·스킬·초상 → `HERO_PICKUP_ROTATION`에 추가(BM 12.5).
3. 설계만 된 상품 SKU(성장 펀드·스텝업·첫 충전 2배·픽업 기간 패키지·복귀·초대·선택권) 구현 — 판매·가격 공개는 대표님 확인.
4. 월정액 일일 100 보석 유료/무료 분류 법무 확인, 운영 사이트 확률 공개 페이지(`/odds`).
5. 등급분류 초안의 '확인 필요' 항목(웹 게임 직접 신청 대상, 수수료, 중소기업 확률 공개 예외), 보석 팩 구성(카탈로그 3종 vs 목업 6종) 정리.
6. 초보자 배너 전용 일러스트(지금 검성 아르카 초상 임시).

## 소환 2차 (2026-10-24, gogo-chunk:summon-2, PR #282)
- 소환 화면 결함: 개발용 경제 추정치 줄(소환 배너 아래·상점 카드 `.si-pace`) 제거, 배너 일러스트 규칙 `src/data/banner-art.js`(치비가 있으면 그것, 없으면 3D 렌더), 초보자 배너 사실풍 초상 → 3D 렌더, 장비 배너 1280 좌우 여백 채움, 간격 8px.
- 늑대인간 족장(SSR, 소환 전용, `kit:'barbarian'`·`bodyAvatar`) + 고유 스킬 핏빛 포효·월광 사냥(`src/game/werewolf-kit.js`), 균형 `bun tools/hero-balance-sim.mjs --assert`(광전사 대비 무리 1.03·단일 1.00).
- 소유 정책: 정책 1 무료 범위·영웅 상품·시작 후보 = `HERO_LEGACY_IDS`(원래 다섯).
- 교대: `['werewolf','knight','barbarian']`, 기준 시각 전 회차 -1 = 광전사, 10-26~11-09 늑대인간 할로윈 픽업(`PICKUP_THEMES`). 경계 테스트 `test/gacha-rotation.test.ts`.
- 리뷰: GitHub Codex 한도 소진, PC OpenCodex 풀 OpenAI 계정 재인증 필요 → Sonnet 독립 리뷰 1회(P0/P1 없음, P2 2건 수정: 정책 1 해금 견적·로비 자세 kit). 남긴 P2: 사냥 본능 처치 회복이 파티원 처치에도 걸릴 수 있음(기존 blood_leech·궁극기 충전과 같은 규칙, 처치자 추적 없음).
- **남은 것**: 치비 배너 4장(늑대인간·초보자·광전사·검성) — PC `C:\Work\tasks\summon2-art-src\gen.ps1` 준비됨, 대표님 `ocx account reauth openai` 뒤 생성 → `public/img/tll/banners/<id>-chibi-v1.webp` → `HERO_BANNER_ART`/`BEGINNER_BANNER_ART`에 한 줄. 검성 픽업(11-09) 전에 필요(검성 대체 이미지는 사실풍 초상). 늑대인간 전용 스킬 아이콘·음성(지금 광전사 것 빌림), 옛 QA 도구 `tools/gogo-qa-20261020-drops.mjs`의 `.si-pace` 항목.

## 대표님 확인 사항(집행 안 함)
가격 공개·판매 시작(`IAP_ENABLED`, `webBilling`), 포트원 채널, 등급분류 제출·수수료.

## 보상 고리 (2026-10-25, gogo-chunk:reward-loop, PR #286)
- 결과 화면 맨 아래(버튼 줄 위)에 "이 보상으로 지금 할 것" 버튼 하나를 둔다. 판정은 순수 모듈 `src/game/reward-next-action.js`, 이동은 `src/ui/reward-next.js`.
  - 캠페인·무한의 성: 보석이나 소환권을 받았고 지금 1회 이상 소환할 수 있으면 소환 탭으로 간다. 배너는 영웅 픽업 → 초보자 → 장비 순으로 고른다.
  - 던전·결투장: 강화석을 받았고 착용 장비를 확정 강화할 수 있으면 영웅 탭의 강화 시트를 연다.
  - 1순위가 안 되면 주간 보급 상자 → 패스 보상 → (캠페인·탑은 강화, 던전·결투장은 소환) 순으로 넘어간다. 아무것도 안 되면 버튼을 숨긴다.
- 상점·결제 화면으로는 절대 가지 않는다(시험으로 확인). 이동만 하고 재화는 쓰지 않는다. 정산 저장 전에는 비활성이고, 누르는 순간 다시 판정한다.
- 임무·시즌 이벤트는 결과 화면이 없어서 뺐다. 한정 재화(이벤트 토큰) 모드도 코드에 없다.
- 같은 PR에서 좁은 화면의 결과 제목 "VICTORY"가 글자 중간에서 줄바꿈되던 문제를 고쳤다(`src/ui/storybook.css`).
- 리뷰: GitHub Codex는 한도 소진이라 Sonnet이 독립 리뷰를 했다. P2 2건은 수정했다.
- 남은 것:
  - 원정(던전·결투장) 결과 버튼은 시험과 코드 리뷰로만 확인했다. 운영 촬영은 캠페인 결과만 했다.
  - 헤드리스 브라우저에서는 게임 시계가 멈춰 `victory()`의 1.6초 지연이 흐르지 않는다. 그래서 촬영할 때는 `app.ui.showResult(app.battle, true)`를 직접 불렀다.
  - 시즌 이벤트 한정 재화가 생기면 `rewardNextAction`에 갈래 하나를 추가한다.

## 소환 3차 (2026-10-25, gogo-chunk:summon-3)
- **선택 근거**: 현 SSR 셋(검성·광전사·늑대인간)이 전부 근접이다. 2호는 첫 원거리 SSR(궁수 kit, 검은 고양이 사냥꾼)로 골라 늑대인간의 근접 돌격과 겹치지 않게 했다. 밤까마귀(rogue kit)는 근접 암살이라 다음 칸으로 미뤘다. 다른 선택지: 밤까마귀 먼저(역할이 늑대인간과 겹침), 벚꽃 무사(knight 반격, 검성과 겹침)로 보류.
- **영웅**: `blackcat`(`kit:'ranger'`·`bodyAvatar:'avatar_ranger_blackcat'`·`gachaOnly`), 몸·무기·애니메이션·소리 세트·보이스·집중(`jobId:'ranger'`)은 명사수 것. 소유 정책은 늑대인간과 같다(정책 1 무료 범위·영웅 상품·시작 후보는 원래 다섯).
- **스킬 요약**(`src/game/blackcat-kit.js`, 명사수 스킬 여섯은 공유): 불길한 징조(삼중 추적화살 자리) = 위협이 큰 적 셋(정예·보스 우선)에 저주 화살, 맞은 적은 6초간 내게 받는 피해 +15%, 집중 +1. 궁극기 아홉 목숨의 밤(폭풍의 일곱 화살 자리) = 무적으로 물러나며 그림자 화살 9발을 표적마다 돌려 쏘고 끝에 표식 적마다 그믐 폭발(집중 3 소비 시 폭발 +50%). 소리는 명사수 삼중 추적화살·폭풍의 일곱 화살을 빌린다(`SKILL_SOUND_ALIAS`), 연출은 보라 0xb070ff 계열(`skill-vfx.js`·`skill-signatures.js`).
- **sim(8시드, `bun tools/hero-balance-sim.mjs --assert`)**: 명사수@SSR(같은 kit을 SSR 등급으로 올린 가상 영웅) 대비 무리 0.975배·단일 1.028배. 테스트(`test/hero-balance-sim.test.ts`)는 4시드로 같은 판정을 약 3초에 돌린다.
- **데뷔 전 비공개**: `HERO_DEBUT = { blackcat: 2026-11-09 00:00 KST }`와 `heroReleased(id, now)`(`src/data/gacha-banners.js`, 표에 없는 id는 항상 true). 클라이언트 `Economy`와 서버 `EconomyCore`가 같은 `economy.js`의 `heroesOf(rarity, now)`·`validSsrHero(id, now)`로 영웅 배너 비픽업 SSR·초보자 SSR·SSR 확정권·마일리지 교환·확률/구성품 공개 표를 모두 같은 시계로 거른다(패리티 시험은 `test/gacha-rotation.test.ts`). 데뷔 정각부터는 자기 픽업 칸이라 풀에도 픽업으로 들어간다. 이미 공개된 것: 아바타 상점의 같은 이름 외형(`avatars.js`)은 이전부터 판매 목록에 있어 영웅 이름은 비밀이 아니다. 영웅 탭 목록도 미보유·데뷔 전 영웅은 숨긴다(`meta.js renderHeroes`, `heroReleased`).
- **교대**: `['werewolf','blackcat','knight','barbarian']` — ~10-26 광전사(회차 -1) / 10-26 늑대인간 / 11-09 검은 고양이(주제 `newmoon` '신규 SSR · 그믐밤 픽업') / 11-23 검성 / 12-07 광전사 / 12-21 늑대인간. 배너 그림은 치비가 없어 늑대인간과 같은 방식(영웅 초상 = 아바타 초상 `avatar_ranger_blackcat-v1.webp`)이다.
- **남은 것**: ① 치비 배너(아래 프롬프트)를 만들어 `HERO_BANNER_ART.blackcat`에 한 줄 — 11-09 전에. ② 다음 신규 칸(11-23 이후)은 밤까마귀·벚꽃 무사·용암 오니 군주 후보, 구현은 다음 덩어리. ③ 검은 고양이 전용 스킬 아이콘(지금 명사수 것)·음성(지금 명사수 것).
- **치비 배너 프롬프트**(BM 12.9 그림체 규칙: 큰 머리·짧은 몸의 귀여운 체형, 밝은 금빛 하이라이트, 시즌 색만 배경·배지에, 사실풍 금지, 화면 이름은 게임 데이터 이름만. 16:9 가로, 캐릭터는 가운데 40% 띠. 늑대인간 PC 스크립트 `C:\Work\tasks\summon2-art-src\gen.ps1`는 이 환경에서 읽을 수 없어 형식만 맞췄다. 출력 `public/img/tll/banners/blackcat-chibi-v1.webp`):
  ```
  Cute chibi gacha banner illustration, 16:9 landscape. A black-cat hunter archer "검은 고양이 사냥꾼":
  oversized head, short stubby body, big glossy eyes, small black cat ears and a thin curled tail, midnight-black hooded
  cloak with violet inner lining and a tiny crescent-moon clasp, holding a compact dark recurve bow with glowing violet
  string, a nocking arrow with violet curse-mark glow, confident playful smile. Pose: leaping back mid-shot, one foot
  lifted, cloak flaring. Warm bright golden rim light and gold sparkle highlights on the character (same chibi style as the
  other SSR banners). Background: new-moon night sky, deep indigo to violet gradient, a thin crescent moon, soft violet
  and gold bokeh stars, faint nine glowing cat-eye marks drifting around. Season palette only in background and badge area
  (violet 0xb070ff family). Character fully inside the central 40% horizontal band, empty decorative space left and right.
  No text, no letters, no logo, no watermark, no realistic proportions, no photoreal style, plain clean edges.
  ```
