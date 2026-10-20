# 20261020-hero-sfx-autotarget-vfx — 영웅별 Mirelo 효과음·자동 타겟 평타·AUTO 클리어·스킬 VFX·SP 성장

- 저장소/기준: aljjang95/blade-surge @ origin/main 85c0e1f · 2026-10-20T04:29:30.723Z · 점유 01a14eb3-327e-7bd0-9a8e-199ea8030e8e (루프 영웅별-mirelo-효과음등급-과금자동-타겟-평타auto-클리어스킬-vf, 지휘 01a15674-a908-7b63-8bfd-ac335363916a)
- 왜 지금: 대표님 요청(2026-10-20) 효과음 전면 교체·자동 타겟 평타·AUTO 클리어 버그·전장 장악 VFX·레벨업 SP 스킬이 통합 브랜치에 모였고 배포 전 실제 화면 확인이 남았다.
- 이번에 하지 않는 것: 등급 과금 흐름(소환·초월·상점)과 스킬 초기화 캐시템(D2a·D2b·D6b), 드랍·지역 진행(D7·D8), S26 실기기(D10). 1280x590 추천 던전 패널 겹침은 다른 세션 소유 파일이라 기록만.
- 환경 개선: 브라우저 QA를 한 스크립트(tools/gogo-qa-20261020.mjs)로 묶어 증거 파일을 evidenceDir에 바로 쓰게 한다.
- 설계도: work/blueprint progression-20261019 그룹(skill-tree-screen·transcend-screen) 재사용, 전투 화면은 없음(작은 수정).

## 사용자 관찰 결과
- 전: 효과음이 예전 합성음·공용 샘플이라 영웅 구분이 안 되고, 평타가 바라보는 방향으로만 나가며, AUTO가 일부 보스전에서 끝나지 않고, 스킬 연출이 전장을 덮는 느낌이 약하다.
- 후: 다섯 영웅이 각자 다른 Mirelo 휘두름·타격·스킬 소리를 내고, 평타는 가까운 적에게 자동으로 돌아가 맞으며(설정에서 끌 수 있음), AUTO가 스테이지를 무사망으로 끝내고, 스킬마다 바닥 룬·텍스처 연출, 궁극기·각성은 전장 반경 링이 퍼진다. 레벨업 SP로 스킬을 배우고 저장이 유지된다.

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | 전투·UI 효과음이 모두 Mirelo 라이브러리(/sfx/mirelo-v1)에서 재생되고 Sonniss 출처 파일은 런타임에 요청되지 않는다 | 브라우저 844x390 전투 중 네트워크 요청 목록·재생 이름 로그 | 통합 | D1a (대표님 2026-10-20 "효과음 소니스 개념 전부 빼고 미렐로로 대체") |
| A2 | 다섯 영웅의 휘두름·타격·스킬 효과음이 서로 다른 파일이고 파티 호스트에서 다른 멤버 소리가 섞이지 않는다 | 브라우저 영웅 5명 평타·스킬 재생 이름 로그 + 파티 무기 전달 단위 테스트 | 통합 | D1b (대표님 2026-10-20 "캐릭터마다 효과음 전부 달리") |
| A3 | 기본 공격을 누르면 반대쪽을 보고 있어도 가까운 적에게 자동으로 돌아 실제 피해가 들어간다(조이스틱 입력 중 우선순위를 기록) | 브라우저 844x390 첫 스테이지 실제 공격 버튼 탭, 각도·적 체력 측정 | 통합 | D3a (대표님 2026-10-20 "기본 어택은 자동으로 타겟팅") |
| A4 | 설정의 공격 자동 타겟팅을 끄면 새로고침 뒤에도 꺼져 있고 바라보는 방향으로 공격한다 | 브라우저 설정 토글 실제 탭·새로고침·같은 픽스처 비교 | 통합 | D3b (대표님 2026-10-20 "옵션에서 토글 방식") |
| A5 | AUTO로 캠페인 스테이지를 무사망 클리어한다 | auto-clear-qa 27개 동일 시드 결과 + 브라우저 실제 AUTO 버튼 1회 승리 | 통합 | D4 (대표님 2026-10-20 "오토 버튼 클리어 버그 수정") |
| A6 | 40개 스킬 시전 시 VFX 레이어가 나오고 궁극기·각성은 전장 반경 링이 퍼진다 | 브라우저 844x390 영웅별 스킬·궁극기 캡처 + skill-vfx 단위 테스트 | 통합 | D5a (대표님 2026-10-20 "전장을 좌지우지하는 VFX") |
| A7 | SSR/SSSR 영웅 오라가 보이고 플레이 화면 중앙을 가리지 않는다 | 브라우저 844x390 SSSR 영웅 전투 캡처·중앙 보호 영역 측정 | 통합 | D5b (대표님 2026-10-20 등급별 강함, 전역 규칙 2026-10-18 UI가 플레이를 가리지 않음) |
| A8 | 레벨업 SP로 스킬을 배우고 올리며, 배우지 않은 각성 스킬은 Q/E에 장착되지 않고, 새로고침 뒤에도 유지된다 | 브라우저 스킬 트리 실제 탭·새로고침 + 경제 단위 테스트 | 통합 | D6a (대표님 2026-10-20 "레벨을 올리고 스킬을 배우고") |
| A9 | 같은 SHA가 정식 호스트 blade.tllhouse.com에 배포돼 다시 읽힌다 | tools/deploy.mjs 영수증·정식 호스트 version.json 읽기 | 통합 | D9 (AGENTS.md 배포 계약) |

## 계약
- 효과음: src/engine/combat-sound-library.js(HERO_BY_WEAPON, hitLayers, heroHitSound), src/engine/audio.js, public/sfx/mirelo-v1/manifest.json. audio.hit의 weapon은 공격자(p.def.weapon).
- 자동 타겟: settings.autoTarget(기본 true, save-base 정규화), Player.basicAutoTarget.
- VFX: src/engine/skill-vfx.js(SKILL_VFX, castSkillVfx), src/engine/grade-aura.js, skills.js 끝의 cast 래퍼.
- SP: src/data/skill-tree.js(spBudget, spBonus), Economy.skillPoints/learnSkill.

## 레인
| lane | 모델·effort | 도구·스킬(tool-routing.md 행) | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| vfx | Sonnet high (Arendt, 종료) | game-vfx-forge | wt/20261019-lane-vfx | src/engine/skill-vfx.js, grade-aura.js, skills.js 끝, player.js 오라 연결, test | 5edb4bd까지 커밋 완료 |
| qa | Sonnet high | live-look-dev·playwright | wt/20261020-qa | tools/gogo-qa-20261020.mjs, work/qa | A1~A8 측정 JSON·캡처 |

## 검증 계획
- 정적: bun run typecheck, bun test --timeout 30000, bun run build
- 런타임: bun run dev(전용 포트) + playwright 844x390·1280x590 hasTouch, 실제 탭 입력. 상태 준비 주입은 보고서에 구분.
- 실기기: 이번 덩어리 제외(D10, 다음 덩어리). 입력 변경이 있어 출시 묶음에서 S26으로 본다.

## 배포 계획
- 경로: origin/main fetch·merge → 재검사 → pdev land(잠금) → main 착지 → deploy-check → tools/deploy.mjs(DEPLOY-blade-surge 잠금) → deployed
- 정식 표면 확인: https://blade.tllhouse.com/version.json SHA 일치, 첫 화면 로드
- 롤백: tools/deploy.mjs 영수증의 직전 버전(85c0e1f, Worker b5001175-3d43-440d-ade5-aa8520c62fb8)으로 되돌림

## 위험
- origin/main이 20커밋 이상 앞서 skills.js·player.js에서 충돌 가능. 양쪽 의도를 보존해 푼다.
- 저장 스키마: spBonus 필드 추가(레거시 보상). 저장 이관 단위 테스트로 확인.

## 한도
capacity CONTINUE(gogo-context 2026-10-20T04:26Z)

