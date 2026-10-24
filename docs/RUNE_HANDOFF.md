# 룬 소켓 강화 · 전운 굴리기 인계 (2026-10-24)

덩어리 `[gogo-chunk:rune-blessing]`. 설계는 `docs/RUNE_AND_BLESSING_DESIGN.md`(설계도 묶음 rune-20261024·blessing-20261024)를 따른다.

## 끝난 것(main 머지 + 운영 배포)
| PR | 내용 |
|---|---|
| #254 | 효과음 7종(Mirelo, `public/sfx/mirelo-v1/event/blessing_*`·`rune_*`) |
| #255 | R1 룬 규칙 `src/data/runes.js`·`src/game/rune-core.js` |
| #256 | R4 전운 규칙 `src/data/blessing.js`·`src/game/blessing-core.js`, 확률 공개표 `oddsTable()` |
| #260 | R2 저장·경제·전투 연동 `src/game/rune-economy.js`, 룬 배율 I ×0.5 · II ×1 · III ×1.5(`RUNE_GRADE_MUL`), 공방 룬 제작, 90일 곡선 밴드 |
| #264 | R3 화면: 장비 상세 `룬 소켓` 탭·룬 고르기·룬 각인판·공방 `룬 가방 · 합성` |
| #265 | R5 화면: 원정 준비 창 `전운` 칸·슬롯머신 릴(1.2/1.7/2.2s 멈춤, 탭 건너뛰기)·확률 시트, 공통 출격 경로(`app.startExpedition` → `startPersonalExpedition`) |

운영 배포: 745d519(룬 화면), 7985c65(전운). 두 번 모두 `node tools/deploy.mjs --auth=wrangler`(PC `C:\Work\tasks\blade-rune-deploy`)로 배포했다. 배포 후 `blade.tllhouse.com/version.json`의 sha가 각 커밋과 일치했다.

운영 실제 확인(Playwright, 844×390·1280×720):
- 룬 박기 → 전투력 9,654→9,879, 합성 I×3+골드 1,000 → II
- 전운 III 선택 → 출격 후 `run.picked`에 같은 id 3개, 보관 각인 소모

## 결정(지휘 판단, 근거)
- **룬 효과 배율 ×0.5/×1/×1.5:** 같은 룬 2개 상한에서 공격력 최대 +27%로, 옛 출격 중 각인 3랭크 수준이다. 버린 안은 ×1/×1.5/×2(+36%)다.
- **90일 시뮬레이터:** 룬은 숙련·세트·옛 각인과 같은 보너스층이라 `POWER_NEED` 진행 판정에서 뺀다. 대신 룬 전투력 몫에 상·하한 밴드를 둔다(미드 D30 10~25%, D90 20~35%). 기존 D8·D9 밴드는 바꾸지 않았다.
- **연쇄(chain) 효과:** 정수 올림(I·II 1명, III 2명).
- **각인 소모 순서:** 출격 전에 소모를 먼저 저장하고, 저장에 실패하면 출격하지 않는다. 출격 시작이 실패하면 소모 직전 스냅샷(보관 각인·후보·굴림 수)을 복원한다.
- **레거시 import:** 서버 소유 룬 명령이 생기기 전까지 `sanitizeLegacySave`가 runes·blessing·sockets를 기본값으로 버린다(보안 리뷰 지적).
- **리뷰 경로:** GitHub Codex 코드 리뷰가 사용량 한도에 걸린 뒤에는 PC OpenCodex(`ocx-dispatch.ps1 -Mode review`)로 대체 리뷰했다.

## 남은 것(우선순위순)
1. (해결) 룬 박기 안내 띠가 전투력 숫자를 가리던 문제: 안내를 룬 소켓 탭의 공명 줄 자리로 옮겼다(`setRuneNotice`, `tools/rune-ui-polish-qa.mjs`로 겹침 0 측정).
2. 서버 권위 이관: 룬 드랍(정예·보스)은 아직 클라이언트에서만 굴린다(`shared/settlement.js`에 장부 없음). 굴림·합성·소켓 명령을 v1 OPS로 옮긴다.
3. 무한의 성 층 정산에는 룬 드랍이 없다.
4. 룬 아이콘은 CSS/SVG 육각이라 시안보다 단순하다. Codex 이미지 아이콘으로 바꾸고, 각인판 영웅을 전신으로 바꾸고, 룬 고르기 격자 가로 스크롤을 정리한다.
5. 844×390에서 공방 룬 칸이 허브 머리글 아래로 밀린다.
6. 효과음 길이: lever 0.22s(목표 0.6), rune_insert 1.47s(목표 0.7). 사람 청취를 아직 하지 않았다(`humanListening: pending`).
7. 실기기(S26·Tab S7+) 터치·프레임 확인을 아직 하지 않았다. 클라우드 컨테이너는 GPU가 없어 프레임 판단을 할 수 없다.
8. (해결) HUD "각인" 버튼 크기 0: 원인은 CSS가 아니라 `layoutControls`가 버튼을 일시정지 창 정보 묶음(전투 중 `display:none`)으로 옮겨 둔 것이다. HUD 우상단 묶음에 두어 전운 각인이 있을 때 44px 이상으로 보인다.
9. 전운 소모 시점: `startExpedition`이 입장 영상 뒤 true를 반환한다. 영상 중 실패하면 복원되므로 손실은 없다.
