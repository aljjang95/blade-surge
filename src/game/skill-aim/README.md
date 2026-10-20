# 드래그 스킬 조준 core 인계

지정 core 브랜치에서 입력·시전·표시를 구현했다. 변경 소유 파일은 `src/engine/input.js`, `src/game/player.js`, `src/game/skills.js`, `src/game/skill-aim/`, `test/skill-aim.test.ts`다. HTML·CSS·ui.js·battle-base.js는 수정하지 않았다.

## integration 마크업 계약

- 각 `.skill-btn[data-skill="0"~"5"]` 안에 `<i class="aim-knob" aria-hidden="true"></i>`.
- 입력은 드래그 중 버튼에 `.aiming`, 버튼 중심 기준 `--aim-x`, `--aim-y`를 px로 설정한다. 벡터 길이는 버튼 반지름 이내다. `.aim-knob`는 CSS에서 이 변수를 적용한다.
- `#skill-aim-cancel`은 드래그 중 `.on`, 손가락이 사각형 안이면 `.hot`. 취소 판단은 원형 장식이 아닌 `getBoundingClientRect()`다.
- 놓기·touchcancel·clear에서 `.aiming`, 두 CSS 변수, `.on`·`.hot`을 제거한다. 다른 스킬 손가락이 남아 있으면 그 조준과 취소 표시는 유지한다.
- 미해금·쿨다운도 입력 표시를 허용하며 기존 Player 거부 검사를 유지한다. 취소 요소가 없어도 입력은 동작한다.

## 검증

- `bun run check`: 타입 검사·전체 테스트·빌드 통과(2341 통과, 4 건너뜀, 0 실패, 마지막 코드 수정 이후 실행).
- 새 단위 테스트 16개: 전체 42개 스킬, 탭/드래그, 취소, clear, 마크업 누락, 원점 복귀, Q/E 슬롯, 거부 경계, AUTO 우선순위, 카메라 yaw, 지점 판정, 투사체 수치, 표시 재사용/폐기.
- 격리 Chromium + 실제 CDP 터치: 1280×590, 844×390, 800×360. 세 크기 모두 탭·드래그 시전·취소·이동+조준, CSS 변수/클래스 해제 검사 통과. 해제 시점 aim 대비 Player yaw 오차 0. 브라우저 JS 예외 0.
- 브라우저는 초기 전투 상태를 주입하고 `testPause`, `app.step(0, true)`, 실제 `Player.handleInput`을 사용한 제어 시험이다. 자연 진행 전투 완주·실기기·GPU 성능·발열·공개 배포 증거가 아니다.
- 취소 구역과 knob 마크업은 테스트 DOM에만 주입했다. 최종 integration CSS의 흰 원·빨간 X·배치와 목표 이미지 전체 일치는 병합 뒤 검증해야 한다.

## 스킬 모양과 근거

단위는 월드 단위, a는 도다. R은 지점 중심 선택 거리/투사체 이동 거리/자기 중심 탐색 거리, w는 전체 폭, r은 피해 반경이다. 투사체 시작 오프셋은 별도 `origin`이며 활은 기본 0.8, 성검/화염구 1, 반사탄 1.2다. 출처는 별도 파일명이 없으면 `src/game/skills.js` 줄이다. `sunbreaker`는 파일 끝에서 덮어쓰는 실제 AWAKENING_III 구현을 사용한다.

| id | kind | 수치 | 출처 줄 |
|---|---|---|---|
| guardian_guard | self | R 0 (자기 방어) | 87 |
| guardian_rebuke | self | R/r 4; 강화 6 | 97 |
| ranger_pierce | line | R 22.95, w 1.3; 강화 2.6, 교관 ×1.4 | 110 |
| ranger_volley | cone | R 18.4, a 27.50°, w 1.6; 교관 a 41.25° | 120,122 |
| ranger_retreat | line | R 21, w 1.4 | 16,130 |
| ranger_tempest | cone | R 21, a 61.88°, w 1.9 | 15,16,141 |
| ranger_quickshot | line | R 21, w 1.4 | 16,147,149 |
| ranger_binding | cone | R 21, a 41.25°, w 1.4 | 15,16,160 |
| holy_slash | line | R 15.4, w 4; 집중 관통 R 27.2, w 1.44 | 176; knight-builds.js:50 |
| shield_bash | circle | R 1.2, r 5 | 184,192 |
| judgment | self | 탐색 R 12, 각 낙하 r 2.2 | 208,217 |
| dragon_slash | cone | R 7.2, a 130°; 파동 16, w 3, 분산 36.67° | 239,245 |
| whirlwind | self | R/r 3.8; 교관 4.8 | 267 |
| quake | circle | R 1.5, r 8 | 278,282 |
| berserk | self | R 0 (자기 강화) | 296 |
| hell_axe | circle | R 13, r 6 | 311,320 |
| fireball | line | R 15, w 2, 폭발 r 4.2; 교관 r 5.2 | 340 |
| chain | self | 첫 탐색 R 12, 후속 연쇄 7 | 352 |
| blizzard | self | R/r 6.8; 교관 8.6 | 379 |
| meteor | circle | R 15, 외곽 r 7.8 = 산포 4.4 + 타격 3.4 | 392,394,401 |
| shadow_dash | line | R 약 14.64 (감속 적분), w 5.2 | 417,424,425 |
| poison_bomb | circle | R 13, r 4.2; 교관 5.4 | 432,443,445 |
| flurry | cone | 마지막 타격 R 4, a 180° (연타 R 3.4, a 150°) | 463,467 |
| thousand | self | 탐색 R 8, 각 타격 r 1.8 | 484,488 |
| chain_bind | self | 탐색 R 12, 폭발 r 7.5 | 511,537 |
| sanctuary | self | R/r 8 | 553,577 |
| bull_rush | line | R 약 13.95 (감속 적분), w 7.2; 끝 +2.4에서 r 6.2 | 595,607,621,626 |
| magma_zone | self | 외곽 R 7.5 = 4.6+2.9, 지속 장판 r 6.4 | 646,650,668 |
| arc_reflect | line | 무반사 경로 R 78 = 30×2.6, w 3.4, 폭발 r 4.5 | 685,691,702,734 |
| chrono_seal | self | 탐색 R 9.5, 각 폭발 r 3.8 | 751,783 |
| shadow_mark | self | 탐색 R 13, 폭발 r 5.5 | 796,821 |
| void_step | self | 탐색 R 18, 마무리 r 7.5 | 848,874 |
| sunbreaker | line | 중심 경로 R 10, w 6.4 (4×간격2.5, 각 원 r3.2) | awakening-iii.js:9,17 |
| heavenfall | circle | R 15, r 8 | 886 |
| bloodquake | self | R/r 8; 교관 9.5 | 888 |
| cataclysm | circle | R 2, r 9 | 889 |
| star_prison | circle | R 16, r 7 | 890 |
| absolute_zero | circle | R 17, r 9 | 892 |
| night_parade | circle | R 13, r 5; 교관 6.5 | 894 |
| eclipse_edge | circle | R 16, r 8 | 895 |
| gale_hunt | cone | R 21, a 20.63°, w 1.8 | 15,16,896 |
| skyfall_arrows | circle | R 18, 외곽 r 6.4 = 2.2+4.2 | 897 |

## 남은 검증과 표현 한계

- 갈라지는 다발(화살 부채 ranger_volley·tempest·binding·gale_hunt, 용살검 파동, 분열 화염)은 부채꼴로 채우지 않고 발마다 좁은 레인으로 그려 발 사이 틈을 비운다(shapes.js lanes 필드, aim-view.js 레인 풀). 화살 시작점은 활 소켓(앞 .64·오른쪽 .07) + 화살 방향 × .35 실측값이다. tools/aim-hitbox-truth-qa.mjs가 레인별 안/밖과 레인 사이 틈 표본을 잰다.
- A6의 모든 복합 판정과 표시의 완전 일치는 아직 입증하지 않았다. meteor·skyfall_arrows·magma_zone은 다중 원의 외곽, self 탐색 스킬은 표적 선택 반경이다. 반사·연쇄·벽 충돌·흡인·이동하는 적의 결과를 확정 적중 면적으로 표시하지 않는다.
- `dragon_slash`의 세 파동 중 표시 레인은 중앙 경로이며, `sunbreaker`의 네 원은 직선 외곽으로 표시한다. 일부 추가 장비 효과(귀환/균열/분열탄)까지 개별 윤곽으로 그리지는 않는다. 이 제한을 A6 완료로 승격하면 안 된다.
- 돌진 거리는 감속의 연속 적분 근사다. 실제 dt, 이동 해석, 충돌에 따라 끝 위치가 달라질 수 있다. 활은 발사 애니메이션의 실제 소켓 위치와 기본 origin에 차이가 있다. hitRadius/hitArea의 적 몸체 반경 보정도 링 자체와 별도다.
- 사거리가 긴 스킬의 링·화살촉은 카메라 밖으로 나갈 수 있다. 실제 범위를 화면에 맞춰 축소하지 않았다.
- 직접 시전 목표는 수락 순간에 고정한다. 조준 중 yaw·MP·쿨다운은 변경하지 않는다. aim 없는 시전은 기존 경로다.
- 물리 Android, 최종 integration 마크업/스타일 및 정식 호스트 수용은 지휘 레인의 후속 작업이다. 푸시·배포는 하지 않았다.


## 몰이(끌어당김) 한계 점선 원 (envelope, kind=pull)

몰이 스킬은 표시 반지름 밖의 적도 끌어와 맞힌다. 그 바깥 한계를 호박색 점선 원으로 그리며 값은 shapes.js의 PULL_REACH에 있고 tools/aim-hitbox-truth-qa.mjs의 몰이 물리 실측(기본 PULL_SKILLS)으로 정한다.

| 스킬 | 확정 반지름 | 몰이 한계 | 비고 |
|---|---|---|---|
| shield_bash / quake / whirlwind / hell_axe | 5 / 8 / 3.8 / 6 | 7 / 9 / 5.5 / 7.5 | 기존 |
| heavenfall | 8 | 12 | 2026-10-19 재감사 D2d, vacuum 12 |
| star_prison | 7 | 12 | vacuum 13이지만 힘 28·.24초 안에 끌려와 맞는 한계는 12 |
| absolute_zero | 9 | 12 | |
| night_parade | 5 (교관 확장 6.5) | 9 (교관 확장 10.5) | 교관 확장 vacuum 13 중 실측 한계 10.5 |
| eclipse_edge | 8 | 10 | |
| bloodquake | 8 | 9 | 교관 혈진(확정 9.5)은 한계 안에 들어 점선을 그리지 않음 |

정예는 몰이 속도 절반, 보스는 15%라 이 한계까지 끌려오지 못할 수 있다(일반 적 기준).


### 2026-10-19 2차 재감사 후 추가(영웅 중심 몰이와 sunbreaker)

전 스킬에 몰이 물리를 켠 검사(tools/aim-hitbox-truth-qa.mjs 기본 AIM_PULL='*')에서 아래가 추가로 드러났다.

| 스킬 | 확정 | 몰이 한계 | 비고 |
|---|---|---|---|
| dragon_slash | 부채꼴 7.2 | 12 | 채널 vacuum 12. 이미 부채꼴 안에 든 적은 끌지 않도록 skills.js를 바꿨다(정면 표본이 영웅을 지나쳐 빠지는 문제) |
| flurry | 부채꼴 4 | 4.5 | vacuum 4.5 |
| blizzard | 6.8 (교관 확장 8.6) | 8.5 (교관 확장 10.5) | gatherEnemies |
| sanctuary | 8 | 11.5 | 경계 벽 R+3.5 |
| sunbreaker | 낙점 원 3.2 | 점선 없음 | 각성 III 귀환 vacuum 반경을 4.5→3.2로 줄여 끌림이 표시된 낙점 원 안에 머문다(표시 밖 좌우 4m 적이 끌려와 맞던 문제) |


### 2026-10-19 3차 재감사 후: 표적 의존 스킬

shadow_mark(표식 대상이 있어야 몰이·폭발 실행)와 chrono_seal(봉인된 적마다 3.8m 폭발)은 표시 안 앵커 적 하나를 함께 둔 검사(tools/aim-hitbox-truth-qa.mjs)로 확인한다.

| 스킬 | 표시 | 변경 |
|---|---|---|
| shadow_mark | 자기 중심 13m | 몰이와 폭발 피해를 영웅 13m 안 적으로 제한(skills.js hitWithin). 먼 표식 대상 때문에 표시 밖 19m 적이 끌려와 맞던 문제 |
| chrono_seal | 자기 중심 9.5m | 봉인 폭발이 표시 밖 최대 13.3m까지 닿으므로 chance 띠(점선 원)로 표시 |

void_step(2026-10-20 대표님 결정): 점멸 표적과 점멸 중 피해·마지막 폭발을 시전 지점 18m 안으로 묶어 표시와 맞췄다(점멸이 이어져 표시 밖까지 닿던 것을 제거, 게임플레이 약간 감소). 표시 안 앵커 적을 함께 둔 검사에 포함한다.

