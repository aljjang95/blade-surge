# 블레이드 서지 지휘 인계 (2026-10-29 14:40 KST 기준)

이 파일 하나로 다른 Claude 계정이 지휘를 이어받는다. 지휘 세션: `session_01H8mx3U9qK3w3SjT5hPBKSr`(계정 theluxurylord2).
레인별 상세는 각 레인이 `docs/handoff/<레인>.md`(레인 브랜치)에 남긴다. 장부는 `apex resume-all`/`apex latest`로 본다.

## 이어받는 법 (새 계정)
1. `apex latest` → 열린 PR·머지 상태 확인(아래 표는 스냅샷이다).
2. 아래 레인 세션은 theluxurylord2 계정 소유라 다른 계정에서 `send_message`가 안 될 수 있다. 그때는 레인마다 새 클라우드 세션을 만들고 첫 프롬프트에 "`docs/handoff/<레인>.md`와 이 파일을 읽고 `<브랜치>`에서 이어서"를 준다(모델 Opus 5.5 레인 리드, 실행·캡처는 Haiku, 테스트·문서는 Sonnet 하위 에이전트).
3. 레인 세션이 살아 있으면(같은 계정 복귀) `send_message`로 "한도 재설정됨 — 중단 지점부터 재개"만 보낸다.
4. 한 계정 5시간 한도를 모든 레인이 공유한다 → 동시에 6개 이하로 돌리고 나머지는 1시간 뒤 재개.

## 레인 현황
| 레인 | 세션 | 브랜치 / PR | 상태 | 다음 행동 |
|---|---|---|---|---|
| 핫픽스 | session_01H8mx3RytDNuuwrUtqdGjkp | claude/hotfix-gear-warrior | #397 유니크 장비 역전 수정 머지·배포(2022df2) | ② 전사 막타 때 캐릭터 사라짐 ③ 전사 팔자걸음(5영웅 점검) 재현·수정·배포, 반지 탭 전후 캡처 |
| 계정·로그인 | session_01H8mx3Spgr2DSBbxfUT2sQM | claude/account-login-fixes / #402 | #392 운영 개방(D1 v5, 결제 꺼짐 확인). **운영 결함: 첫 화면 구글 대화상자가 시트 뒤에 가려짐** | #402 리뷰(30분 넘으면 Sonnet 독립 리뷰로 대체) → 머지·배포. 이어서 개인정보 문구·탈퇴 소셜 정리·게스트 보관 크론(삭제 아님)·연동 보상·테스트 계정 3행 test 표시 |
| 성장·경제(랄프) | session_01H8mx3TeJYskLe6WcYcWaAt | claude/hero-join-toast 외 / #398 강화 전승, #399 하네스 | #391 보석 영웅 영입 머지(숨김), #389·#386 배포 | 레벨링 곡선(1-1 Lv3, Lv10≈1h, 1장 전투력 1.6~1.9배) → 강화 전승 머지 → 스탯/스킬 포인트 |
| 클리어 루프 | session_01H8mx3UASGXz4DYVpZN6AoE | claude/clear-loop / #401(draft) | #390 전투 중 가방·네브 소개 배포(d144d25) | #401 카드 3택·정비소·내구도/수리 리뷰·머지·배포, 정비소에 meta.openTransfer(uid)로 강화 전승 버튼 |
| 첫인상·연출 | session_01H8mx3S5dVwQn1Kp3bRMzM7 | claude/first-impression / #395(draft) | C안 선택 화면·전용 곡·레벨업 오로라·궁수 VFX 1차 | #395 머지·배포. **셰이더 회귀**("Shader program did not link", d047c7d엔 없고 b3fcf47엔 있음, #397~#400 사이) bisect → 원인 레인 통보·핫픽스 |
| 전투 가독성·스킬 VFX | session_01H8mx3T8m3fjgvtaxE3nZSR | claude/combat-vfx / #394 머지(f554dbc) | 적 붉은 고리·체력막대·조준·빗나감 먼지 | #394 배포 readback, 검성·광전사·대마도사·암살자 스킬 VFX, 궁수 VFX 이어받기 |
| 외형(아바타) | session_01H8mx3TzVjMPpUykqBjUJZe | claude/vault-inherit-core 외 | #396 여우 v2 다리 분리, #400 흡혈 백작 목 찢김 8.26→5.62% 배포 | 여우 v3 3D 수신 → blender_clean_weights → rebind-library-body --no-clips --scale=height. 리아 B3 풀셋은 5등신 원화 먼저 → 3D |
| 장비 아트 | session_01H8mx3T7tCXqRTttP1Mst6M | claude/gear-art-icons | 아이콘 60+139 배포 | 무기 4자루 3D 수신 → 소켓 장착·강화 빛, 나머지 무기 3D 목록 |
| 몬스터 정체성 | session_01H8mx3Qmgim4GfXxszFJ9VJ | claude/tripo-ch5-ch6-ingest / #393 | 5·6장 전용 몸 PR(리뷰 대기). **한도로 일시정지** | #393 머지·배포 → 7장(claude/tripo-ch7-belltower 85ce4957) 통합 |
| RPG 필수 시스템 | session_01H8mx3Rudj5mKyNJjqeM4Di | claude/rpg-essentials | 감사(docs/RPG_ESSENTIALS.md) 진행. **한도로 일시정지** | 감사 표 → Top 5(출석·퀘스트·우편함·소탕·방치 보상 등) |
| BM·KG | session_01H8mx3SKmnsC35B9NZCgXoQ | claude/kg-multi-app | KG 추가 MID 신청 문서(#388) | 대표님 KG 메일 발송 승인 대기 |

기타 열린 PR: #298(perf 착용 화면 지연 로딩, 10-25 draft, 손대지 않음).

## Tripo (이 지휘 세션의 하위 에이전트가 ego-browser로 작업)
- 대표님 승인(2026-10-29 원문): "만들어 크레딧 사용해 전부 사용해도 괜찮아" → 진행 중: ① 실바 여우 아바타 v3(원화 R2 `blade-surge-handoff/tripo-image/avatar/ranger_fox_v3_tpose.png`) 3D·리토폴로지·리깅 → `tripo-originals/avatar_ranger_fox_v3/` ② 무기 w_rusty·w_hunter·w_frost·w_king 3D(PBR 45)+리토폴로지 → `tripo-3d/weapons/<id>/`. 상한 450크레딧. 원화·스크립트는 이 컨테이너 scratchpad `tripo-w/`(컨테이너가 사라지면 R2 원화 기준으로 다시).
- 끝난 것: 1~7장 몬스터·prop(raw는 R2 `tripo-originals/ch1~ch7/`, 4장 lurer·maren raw 유실), 선택 화면 시안 `tripo-image/starter-select/concept-{a,b,c}.png`·`stage-bg.png`.
- 규칙: 치비 비율은 무료 원화로 먼저 확인 → 3D. raw는 3D 완료 후에만 내보내기. prop ≤3,900삼각형. Upgrade·충전 버튼 금지. 쿠키 복사·새 프로필 우회 금지. GLB는 52본(끝 관절 생략) — 65본 판정은 FBX 기준. 텍스처 2K → ingest --texLimit 1K.

## 지휘 결정(상시값 — 다시 묻지 않음)
- 리세마라: 막지 않고 이유를 없앤다(시작 영웅 직접 선택, 첫 뽑기 보장, 게스트 서버 행은 1-1 클리어/연동 뒤, 생성 속도 제한, 비활성 게스트 보관).
- 로그인: Google + 게스트 개방. 카카오(대표님 앱 등록 후 KAKAO_REST_KEY), ChatGPT(OpenAI 상업 파트너 대기자 전용 → 슬롯만, 꺼 둠).
- 영웅 직접 구매: 1명 = 30,000원 상당 = 유료 보석 2,308(무료 보석 불가), 기본 해금만(중복·각성 재료는 소환에서만). hero_<id>_v1 30,000원, hero_all_v1 89,000원. 모두 꺼짐 — 결제 개방 직전 대표님 가격 확인.
- 강화 전승: 골드 19,000×1.5^(lv−5)×등급·il 계수, 기본 −1단계, 보호 주문서(보석 500)로 무손실.
- 선택 화면: C안(전장 쇼케이스) + A안 룬 서클·빛기둥, 영웅은 일러스트 배경 제거.
- 1장 난이도: 전투력/권장 1.6~1.9배.

## 대표님 대기(대표님만 할 수 있음)
1. 카카오 Developers 앱 등록(카카오 로그인+OIDC, Redirect URI `https://blade.tllhouse.com/api/v1/auth/oauth/callback/kakao`) — 등록됐다고만 하면 키 연결은 에이전트.
2. ChatGPT 로그인 대기자 신청 여부(추천: 신청).
3. KG이니시스 문의 메일(ch@kggroup.co.kr) 발송 승인 — BM 레인 초안 준비됨.
4. 결제 개방 시 가격 최종 확인.

## 운영 규칙(모든 레인 공통)
- 배포: PC 깨끗한 detached worktree `C:\Work\tasks\blade-deploy-<sha7>`에서 막 fetch한 origin/main 최신 SHA만, `node tools/deploy.mjs --auth=wrangler`만(raw wrangler·rollback·대시보드 금지). 잠금 거부(exit 1)는 원격 변경 없음 → 앞 배포 끝난 뒤 1회 재시도. readback `https://blade.tllhouse.com/version.json` sha·dirty=false 확인. 확인 폴링 시간초과는 실패로 본다.
- 검사: `bun install --frozen-lockfile && bun run check`, 필요 시 `bun run sim:90d`, `assets:verify`.
- 리뷰: Codex GitHub 리뷰를 기다린다(돌고 있음). 30분 넘게 안 오면 독립 Sonnet 리뷰로 대체. 로그인·결제·DB는 교차 리뷰 1회.
- 금지: 결제 플래그(WEB_BILLING_ENABLED·IAP_ENABLED·STORE_BILLING_ENABLED·PORTONE_CHANNEL_KEY) 변경, 가격 공개, 외부 게시·메시지, 비밀값 출력, force push, 영구 삭제.
- 보고: 대표님께 한국어, 새 버전이 올라가면 "어디서 무엇을 해 보면 되는지" 한 줄.
