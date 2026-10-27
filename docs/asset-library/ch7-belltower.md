# 7장 종탑 3D 에셋 (tll_ch7_*)

7장(종탑) 일반 몬스터 1종, 중간 보스 1종, 최종 보스 1종. 생성일 2026-10-27. 게임 코드 연결은 별도 PR(#300)이 맡고, 이 문서는 에셋 출처·검증·연결 값만 기록한다.

## 요약

| 키 | 역할 | 높이 | 삼각형 / 예산 | 크기 | 뼈 | 리깅 | 프로필 |
|---|---|---|---|---|---|---|---|
| `tll_ch7_bellringer` | 일반 몬스터(종지기 구울) | 1.8 m | 9,097 / 12,000 | 2,190,032 B | 65 | Tripo 자동 리깅 + 라이브러리 클립 이식 | caster |
| `tll_ch7_midboss` | 중간 보스(수문 기사) | 2.6 m | 12,879 / 20,000 | 2,827,508 B | 25 | Tripo 자동 리깅 + 라이브러리 클립 이식 | soldier |
| `tll_ch7_finalboss` | 최종 보스(대종의 주인) | 4.2 m | 17,974 / 20,000 | 3,344,736 B | 7(root·body·tongue·fist_1~4) | Blender 직접 리깅 + 절차 생성 클립 | brute |

- 삼각형 예산은 `tools/asset-library/manifest.mjs`의 `triangleLimit`: 일반 12,000, `boss: true` 20,000. 중간·최종 보스는 `boss: true`다.
- GLB는 `asset-library/normalized/<키>.glb`에 있고, 런타임은 `src/engine/library-assets.js`가 이 폴더를 번들로 읽는다(기존 라이브러리 관례와 같음. `public/models/library/` 폴더는 이 저장소에 없고 만들지 않았다). manifest `file`은 기존 항목과 같은 `/models/library/<키>.glb` 형식이다.
- `bun run assets:verify` 통과(54개).

## 원화와 3D 생성 기록

원화는 Tripo Studio의 GPT Image 2.5로 키마다 3안(a·b·c)을 만들어 하나를 골랐다. 선택안은 아래와 같다(전 안의 sha·후보는 작업 폴더 `concepts/index.json`에 있고 저장소에는 넣지 않았다).

| 키 | 선택 원화 | 원화 sha256 | 이미지 작업 id | 방향 |
|---|---|---|---|---|
| `tll_ch7_bellringer` | b | `f39d64da93d875bd5e5bbf17ff60f979d399787948389d403154b2a68421927b` | `800636ea-3cd5-4357-914d-fb746493fe84` | 마른 구부정한 구울이 금 간 청동 종을 투구처럼 쓰고 노란 눈빛, 종추 곤봉은 몸에서 분리 |
| `tll_ch7_midboss` | b | `d0461f31f56ae8819fe233095afeeacb86894b7927fb60af51eb9c1af6c12432` | `c817dc9f-c723-495d-a1cc-b4029db7ee7e` | 키 큰 비대칭 수문장, 왼쪽 어깨가 거대한 금 간 청동 종, 등에 문짝 같은 탑 방패, 종 플레일은 분리 |
| `tll_ch7_finalboss` | c | `e351f347a0c180d529525e4f285d1035a72267544566f7dc5d7a1d2614312f28` | `082a2718-0315-495a-a85b-24e7feaf7226` | 입을 아래로 향한 금 간 대종에 돌 얼굴, 종추가 혀, 사슬로 묶인 쇠 주먹 4개가 둘레를 떠다니는 부유 괴수 |

프롬프트 전문은 manifest의 각 항목 `provenance.prompt`에 있다(원화 프롬프트 + `[GPT Image 2.5 원화 … Tripo H3.1 이미지→3D, Tripo 리토폴로지]` 머리말).

| 키 | manifest `provenance.taskId` | 리토폴 원본 `rawSha256` (`tripo_retopo.glb`) |
|---|---|---|
| `tll_ch7_bellringer` | `ef98f4ca-9215-4142-b30c-c7cd9b00e6cb` | `cb07ac72794c6b0605b88a25740ea81f4d3e8eb3227c842f66f77161d2e7292a` |
| `tll_ch7_midboss` | `93d87883-c2f8-4213-951d-af76c7144938` | `8dea21f6abc0f8564c6c8f303f6e29e550fda4c296a13749ea601557b19addb8` |
| `tll_ch7_finalboss` | `30fa0411-117e-40bc-a382-f19d62e84ae1` | `4a1511318741661fb5fae75794830fab576771d5cf3366206ea42141418dd67b` |

- `rawSha256`은 작업 폴더 `raw/<키>/tripo_retopo.glb`를 직접 sha256 계산한 값이다(2026-10-27 재계산, manifest와 일치).
- manifest `taskId`는 ingest 때 기록한 Tripo 작업 id다. 이 id가 이미지→3D 작업인지 리토폴 작업인지는 작업 폴더 기록만으로 확정하지 못했다(미확정). 일반 몬스터 a안의 원본 모델 작업(`7e18c63f-1c47-4dfa-a40e-aa93eb9c5f98`, sha `9afa8439…df239f`)은 선택안이 아니라 1차 시안이다.
- Tripo 리토폴로지 원본은 `raw/`에 있고 Git에서 제외된다(`asset-library/raw/.gitignore`).

## 리깅 방식 (사실 기록)

- 일반 몬스터·중간 보스(인간형 둘): Mixamo 웹을 쓰지 않았다. 리토폴 메시에서 무기(몸 옆에 따로 선 조각)를 x 기준으로 잘라 내고(`prep_humanoid.py`) Tripo 리깅(Mixamo 규격 뼈대, A자세)을 받았다. 작업 폴더 `raw/<키>/tripo_rigged.glb`와 `rigged/tripo_convert_*.fbx`가 그 결과다. 잘라 낸 무기(종추 곤봉, 사슬 종 플레일)는 별도 GLB로 보관했고 이번 GLB에는 포함되지 않는다.
- 클립: Mixamo에서 새로 받은 것이 아니라, 이미 라이브러리에 있는 정규화 GLB의 Mixamo 계열 클립을 월드 회전 기준으로 이식했다(`retarget_clips.py`, 팔은 T→A자세 보정 회전 적용). 기증자는 `gb` = `goblin_brute.glb`, `hk` = `hero_knight_t1.glb`.
- 최종 보스: 인간형이 아니라 Tripo 리깅을 쓰지 않았다. Blender에서 몸·종추 혀·주먹 4개를 분리하고 본 `root → body → {tongue, fist_1..4}`에 묶은 뒤 14개 클립을 절차적으로 키프레임했다(`build_finalboss.py`).
- 쓴 크레딧: 미기록(작업 폴더에 크레딧 소모 기록이 없다). 이번 재개 작업에서는 새로 생성하지 않았고 크레딧을 쓰지 않았다.

## 클립 출처

논리 키는 manifest `clips`에서 이름이 같게 매핑된다(14개 모두). 기증자의 클립 이름과 프레임 수는 작업 폴더 `log/merge_*.json`.

| 논리 키 | 종지기 | 수문 기사 | 대종 |
|---|---|---|---|
| idle | gb idle | hk idle | 절차 |
| walk | gb walk | hk run ×1.7배속 느리게 | 절차 |
| run | gb run | hk run | 절차 |
| attack | hk slash_h | hk slash_h | 절차 |
| attack2 | hk slash_d(힙 이동 제거) | hk slash_d(힙 이동 제거) | 절차 |
| attackHeavy | hk chop | hk chop | 절차 |
| attackSpin | gb attackSpin | hk spin(힙 이동 제거) | 절차 |
| attackJump | gb attackJump | gb attackJump | 절차 |
| cast | gb cast | hk cast_shoot | 절차 |
| raise | hk cast_raise | hk cast_raise | 절차 |
| summon | gb roar | hk cast_raise | 절차 |
| hit | hk hit | hk hit | 절차 |
| hitHeavy | gb hitHeavy | gb hitHeavy | 절차 |
| death | gb death | hk death | 절차 |

`impacts`(타격 시점, 0~1)는 manifest에 클립별로 기록했다.

## 게임 연결 값 (코드는 PR #300 소유, 이 PR에서 고치지 않음)

- 키·경로: `tll_ch7_bellringer`, `tll_ch7_midboss`, `tll_ch7_finalboss` / `asset-library/normalized/<키>.glb` (manifest `file`은 `/models/library/<키>.glb`).
- `monster-roster` `scale`은 라이브러리 `heightM`에 곱하는 배율이다. 기존 항목의 게임 안 실효 높이는 약 1.0~2.6 m(goblin_brute 1.77, demon_lord 1.66, bone_knight 2.58)다. 제안값(실제 카메라 확인 전 초기값, 적 정의의 `def.scale`이 그 위에 곱해진다):

| 키 | heightM | 최종 roster scale | 적 정의 scale | 실효 높이(영웅 1.8m 대비) |
|---|---|---|---|---|
| `tll_ch7_bellringer` (Bell_Ringer) | 1.8 | 1.05 | 1.05 | 1.98 m (1.10배) |
| `tll_ch7_midboss` (Bell_Warden) | 2.6 | 0.53 | 1.95(중간 보스 계급) | 2.69 m (1.5배) |
| `tll_ch7_finalboss` (Bell_Sovereign) | 4.2 | 0.5 | 2.25(최종 보스 계급) | 4.73 m (2.6배) |

- 2026-10-27 실화면 조정: 중간·최종 보스는 계급 scale(1.95/2.25) 때문에 5.6 m·6.8 m 로 화면 밖까지 커서 roster scale 만 낮췄다. 피격 반경(`0.7 × def.scale`)은 게임 규칙이라 건드리지 않았고 그대로 1.36/1.57 이다(시각 반경보다 넉넉하다).
- 던전 보스(`bell_gate_warden` 2.25, `bell_tollmaster` 2.2, `bell_nave_guardian` 2.4)도 같은 모델을 쓰므로 같은 비율로 줄어든다.
- 모델 로드 확인: `node tools/ch7-shots.mjs` 가 7-1·7-5·7-10 에서 `enemy.libraryAsset.id`(대체 실루엣이 아닌 `tll_ch7_*`)와 영웅 대비 높이를 JSON 으로 남기고 844×390·640×360 캡처를 찍는다.

## 분리 무기 (손 소켓)

- 종추 곤봉 `tll_ch7_bellringer_club`(2,107 삼각형)과 쌍종 플레일 `tll_ch7_midboss_flail`(2,337)은 `kind: 'prop'` 으로 수집했다(`BLENDER=/opt/blender/blender node tools/asset-library/ingest.mjs --kind prop --height <무기 길이>`; prep 좌표 그대로라 몸과 같은 배율이다).
- `monster-roster.js` 의 `weapon: { asset, hand, grip, at, rot }` 항목을 `src/game/monster-weapon.js` 가 읽어 Tripo 몸(대체 실루엣이 아닌 경우만)의 `mixamorig*RightHand` 본 아래 소켓에 얹는다. 손 본의 cm 배율은 소켓 배율로 상쇄한다. `grip` 은 무기 로컬에서 손에 쥘 점, `at`/`rot` 는 손 본 기준 위치(m)·오일러(도)다.
- 같은 모델을 쓰는 던전 보스 정의도 무기를 든다. 최종 보스(대종)는 무기가 없다.

- 최종 보스는 몸 중심이 공중에 뜬 괴수라 발바닥 접지 정규화 기준이 일반 인간형과 다르다. 그림자·피격 반경은 body 본 기준으로 잡는 편이 맞다.
- 클립 키 14개: idle, walk, run, attack, attack2, attackHeavy, attackSpin, attackJump, cast, raise, summon, hit, hitHeavy, death.
