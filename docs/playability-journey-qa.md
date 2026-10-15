# 실제 사용자 여정 E2E QA — 궁수 자연 플레이

`tools/playability-journey-qa.mjs` 는 새 브라우저 프로필에서 사용자가 실제로 하는 순서대로 궁수를 고르고 던전에 들어가 수동 실시간 전투를 한 뒤, 결과·장비·재입장까지 이어서 검사한다. 고정 스텝·무적·적 주입 fixture 인 `tools/art/ranger-playability-smoke.mjs` 와는 별개다. 그 스모크는 입력 단위·포즈 근거로 유효하지만 이 자연 여정을 대신하지 않는다.

이 결과는 Playwright/CDP 자동화 터치다. 실제 Android Chrome·삼성 인터넷 물리 기기, 사람 조작감, GPU 발열 결과가 아니다. 보고서에는 `notPhysicalDevice: true` 와 `fixture: false` 가 함께 기록된다.

## 실행

빌드한 dist 를 루프백으로 띄운다(`dist/version.json` 의 sha·dirty 를 확인한다).

```powershell
bun run build
bunx vite preview --host 127.0.0.1 --port 4173 --strictPort
# 다른 창(Windows, 설치된 Chrome):
node tools/playability-journey-qa.mjs --url http://127.0.0.1:4173/ --label journey-<sha7>-r1 --expected-sha <40자리 sha> --chrome-executable "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

| 옵션 | 기본 | 뜻 |
|---|---|---|
| `--url` | http://127.0.0.1:4173/ | localhost·127.0.0.1·[::1] 만 허용 |
| `--label` | 시각 | `work/qa/playability-journey/<label>/` 를 새로 만든다. 이미 있으면 덮어쓰지 않고 exit 2 |
| `--expected-sha` | 없음 | 제공된 version.json 의 sha 와 dirty=false, git HEAD 가 같아야 PASS. 없으면 이 단계는 NOT_RUN(전체 PASS 불가) |
| `--chrome-executable` | 없음 | 주면 그 Chrome 을 `headless: true` 로만 띄운다(SwiftShader 강제 없음). 없으면 `tools/chrome.mjs` launchOpts(컨테이너 SwiftShader) |
| `--manual-sec` | 150 | 수동 구간 최대 시간. 판정이 모두 충족되면 일찍 끝낸다 |
| `--finish` | auto | auto: 수동 구간 뒤 실제 AUTO 버튼을 켜고 정상 종료까지 '자동 완주'. manual: 같은 실제 입력 제어로 끝까지. none: 시도 안 함 |
| `--finish-sec` | 240 | 정상 종료 대기 한도. 넘으면 실제 일시정지 → 포기로 끝내고 승리는 NOT_RUN |
| `--deadline-sec` | 1500 | 전체 한도. 넘은 단계는 NOT_RUN, +120초에 강제 종료하며 보고서를 남긴다 |

exit 0 은 필수 단계가 모두 PASS 일 때뿐이다. FAIL 이 있으면 `fail`, NOT_RUN 만 있으면 `partial` 로 exit 1. 인자 오류·출력 폴더 중복은 exit 2.

## 흐름과 단계

1. 버전 결합(--expected-sha, served clean, git HEAD).
2. 부팅: `#boot-start` 탭 → 회전 안내가 보이면 `#btn-ignore-rotate` → 자연 팝업(출석 등)은 `#m-cancel`(닫기)로 닫는다. 보상 받기는 누르지 않는다.
3. 영웅 탭 → `#hero-list [data-hero-id=ranger]` → `#h-sel`(보이면) → '출전 중' 확인. 착용 모습 준비(R3F 인스턴스·캔버스 크기)를 기다린 뒤 캡처한다(선택 단계).
4. 홈 → 강조 CTA 가 정확히 1개인지 → `#citadel-dungeon-prepare` → 준비창 → `.citadel-hub-cancel`(에너지 그대로) → 다시 열어 같은 던전 확인.
5. `.citadel-hub-go` → 입장 영상이 뜨면 실제 '건너뛰기' → 전투 준비. 에너지가 카탈로그 비용만큼 정확히 1회 줄었는지(180초 자연 회복은 energyT 로 보정해 기록).
6. AUTO 꺼짐 확인(켜져 있으면 실제 버튼으로 끈다). 교정 궁수 소켓(`RangerBowGrip_L`, `RangerDrawNock_R`, `Bow_String_Upper/Lower`)·`RangerBowUpper` 클립을 이름 탐색으로만 확인하고, 네트워크의 궁수 GLB 경로를 기록한다.
7. 수동 구간(아래). 9개 판정을 개별 단계로 남긴다.
8. 정상 종료: 기본은 실제 `#btn-auto` 를 켠 '자동 완주'이며 보고서 `journey.completion.label` 에 그대로 적는다. HP 35% 미만이면 보유한 `hp_tonic` 만 실제 물약 버튼으로 쓴다. 사망하면 보석 부활 대신 `#r-no`(전투 마치기) → 패배는 FAIL. 시간 초과는 실제 일시정지·포기로 결과 화면까지 이어가고 승리는 NOT_RUN.
9. 결과 화면: 승패·저장·전리품(uid/id)·버튼을 기록하고, 전리품이 있으면 실제 '전리품 보기' 를 펼쳐 그림 속성을 읽는다.
10. 결과 → 장비: `.exp-result-gear` 가 보이면 그 버튼, 없으면 결과 '로비' → 하단 '영웅'. 쓴 경로를 `journey.equipment.route` 에 남긴다.
11. 전리품을 가방에서 열어 '장착하기' → 같은 uid 가 궁수 장착 칸에 들어갔는지, 가방·시트·장착 칸 그림 src 가 같은지 확인. 그림의 `src` 와 모든 `data-*`(새 정체성 레인 속성 포함), 시트의 형태 안내 문구, 착용 모습 상태를 그대로 기록한다. 결과 전리품 그림과 장착 그림이 같은지는 별도 필수 단계다.
12. 같은 던전 준비(영웅 머리글 `#h-next` 또는 홈 CTA) → 재입장 → 1회 차감.
13. 페이지 오류 없음.

## 수동 구간 — 실제 입력과 관측 경계

입력은 모두 CDP `Input.dispatchTouchEvent` 다. 조이스틱(`#joy`) 손가락을 누른 채 둘째 손가락으로 `#btn-attack`·`#btn-dodge` 를 누른다. touchEnd 에는 떼는 손가락만 보낸다(root PC 보정). 모든 탭은 요소 중심의 elementFromPoint 가 그 요소인지 확인한 뒤에만 보내며, 가려졌으면 누르지 않고 기록한다.

이동 방향은 관측한 상태로 정한다. 보행 마스크(`world.mask/inner`)를 문자열 사본으로 읽어 Node 에서 BFS 한다(`world.buildFlow` 는 AUTO 캐시를 바꾸므로 부르지 않는다). 월드 방향은 게임 `cameraRelativeMove` 의 역변환으로 조이스틱 오프셋이 된다. 시야가 열린 9.5 유닛 안의 적에게는 옆걸음 사격 → 후퇴 사격 → 회피 버튼→사격을 반복하고, 아니면 다가가거나 다음 미정화 방(포털·보스방 순서는 AUTO 탐색과 같은 규칙)으로 간다.

페이지 JS 는 읽기만 한다. `requestAnimationFrame` 콜백 하나가 게임 루프 다음에 `battle.elapsed`·플레이어·적 HP·플레이어 화살(`projectiles` 중 owner=player, arrowVisual)·`rangerAim.target`·`bowStringHeld` 를 `window.__journeyObs` 에 기록한다. app.step·testPause·무적·적 생성·순간이동·시간·경제·선택 영웅 쓰기·함수 교체는 하지 않는다.

| 판정 | 기준(`playability-journey-assess.mjs`) |
|---|---|
| 조이스틱 이동 | AUTO 꺼진 채 조이스틱을 누른 동안 누적 이동 ≥ 3 유닛 |
| 조준 방향 | 대상이 잡힌 수동 기본 사격 ≥ 3, 발사 순간 화살 방향과 대상 방향 차이 ≤ 0.15 rad |
| 옆걸음 사격 | 이동 입력 ≥ 0.3, 속도 ≥ 0.5, 이동-화살 각 45~135° |
| 후퇴 사격 | 같은 조건, 각 ≥ 120° |
| 회피→사격 | dodge 상태에서 곧바로 attack 으로 바뀌어 0.8 게임초 안에 발사 |
| 기본 1발 | 데이터상 1발인 사격 ≥ 3 이고, 모든 기본 사격의 화살 수가 콤보 데이터(arrowCount)와 같다 |
| 실제 피해 | 수동 화살의 hit 집합에 든 적의 HP 가 같은 프레임에 줄었다 |
| 게임 시계 | 수동 구간 동안 battle.elapsed 가 줄지 않고 ≥ 5초 흘렀다(벽시계 대비 비율 기록) |
| 이동 중 시위 | 조이스틱 이동 중 attack 상태에서 bowStringHeld 프레임 ≥ 1 |

## 산출물

`work/qa/playability-journey/<label>/` 에 `report.json`(label, head, servedVersion, versionBinding, browser launch/args/version/UA/GPU 문자열, scope, notPhysicalDevice, fixture=false, realInputs 개수와 앞 800개, steps PASS/FAIL/NOT_RUN, errors, consoleErrors, screenshots, started/finished, journey 세부), `samples.json`(원시 관측), PNG 가 남는다. 캡처는 00 로비, 01 선택한 궁수, 02 준비창, 03 전투 시작, 04 이동 중 당김, 05 발사, 06 회피→사격, 07 자동 완주 시작, 08 결과·08b 전리품, 09 장비, 10 아이템 시트·10b 장착 후, 11 재입장 준비, 12 재입장 전투, 실패 시 zz-*. 04~06 은 캡처 직전 상태(state·조이스틱·관측 사격 수)를 note 로 함께 남긴다.

## 기대하는 DOM 과 한계

의존 선택자: `#boot-start`, `#rotate-hint #btn-ignore-rotate`, `#modal.show #m-cancel`, `#meta .bottomnav [data-tab=heroes|home]`, `#hero-list [data-hero-id]`, `#h-sel`, `#hero-detail .hs-go`, `#hero-wardrobe canvas`, `#tab-home .dl-cta`, `#citadel-dungeon-prepare`, `.citadel-hub-dialog[open]`(`#citadel-destination-title`, `[data-citadel-cost]`, `.citadel-hub-cancel`, `.citadel-hub-go`), `.exp-cinematic button`, `#joy`, `#btn-attack`, `#btn-dodge`, `#btn-auto`, `#btn-pause`, `#btn-giveup`, `.exp-potions [data-potion]`, `#modal.show #r-no`, `.exp-result-shell`, `.exp-result-header .exp-close`, `.exp-result-gear`(선택), `.exp-loot-reveal article img`, `#hero-bag [data-inv]`, `#hs-tab-gear`, `#modal.show .is-head` · `.is-head-art img` · `#i-eq` · `#i-close`, `.hs-slot[data-uid] img`, `#h-next`. 읽는 상태: `app.mode/meta.tab/meta.heroSel/eco.s.(selected|energy|energyT|inventory|heroes.ranger.equip)/eco.energyMax/journey.s.autoBattle/battle.(active|paused|elapsed|enemies|projectiles|player|world|portal|kills|dmgDealt)/expeditionUI.result/wardrobe.instance/renderer.camera`.

- 전투 결과는 자연 난수·적 AI·기기 속도에 따라 달라진다. 패배·시간 초과·무전리품은 FAIL 또는 NOT_RUN 으로 남기며 다시 실행할 때는 새 label 을 쓴다.
- 자동 완주는 사람이 끝까지 수동으로 이긴 증거가 아니다. `--finish manual` 은 같은 제어기로 끝까지 시도하지만 퍼즐형 목표(제단 공명 등)는 방 중심 이동으로만 다룬다.
- 결과 전리품 그림(`hub.jsx` LootReveal)은 기준선에서 `ITEM_ICON` 을 써서 장비 그림과 다를 수 있다(UX R2). 다르면 해당 필수 단계가 FAIL 로 남는다.
- 키보드 이동·공격은 이 도구의 필수 경로가 아니다(모바일 터치가 대상). 3D 아이템 보기 버튼은 존재만 기록한다.
- 클라우드 컨테이너에서는 실제 게임으로 끝까지 실행하지 않았다. 도구 자체는 순수 함수 검사와, 게임을 흉내 낸 작은 stub 페이지(게임 아님)에서 단계 흐름·관측·판정을 확인했다.
