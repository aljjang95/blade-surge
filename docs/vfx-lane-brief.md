# 영웅 스킬 VFX 강화 레인 브리프 (2026-10-29, blade-combat#readability)

대표님 피드백(원문): "스킬 VFX가 다른 캐릭터들도 화려함, 동적인 움직임이 대폭 강화 필요. 적과 싸우다 보면 식별이 잘 안 된다 — 내가 적을 쏘는 건지 허공에 쏘는 건지 구분이 안 감."

## 목표
한 영웅(아래 HERO)의 스킬 8종(기본 3 + 궁극 1 + 각성 4, 우선순위: 슬롯 0~3)을 **더 화려하고 동적으로**. 단, 적 몸·피해 숫자·조준 표식이 묻히지 않게(가독성 계약 `docs/COMBAT_READABILITY.md`).
- 화려함 = 채도 높은 영웅 고유 색 언어 + 여러 박자(예비 → 발동 → 잔광) + 움직이는 요소(휘두름 궤적이 실제로 쓸고 지나감, 전진하는 충격파, 회전·나선, 튀는 파편, 잔상).
- 지금 많은 스킬이 "영웅 둘레 원형 문양 + 섬광"으로 비슷해 보인다. 스킬마다 **실루엣이 다르게**(선·부채·나선·기둥·궤적·낙하).
- 시전 동작 강화: 예비 동작(모으는 빛·발밑 압축), 돌진 잔상(`fx.ghost`), 휘두름 궤적. 판정 시각은 바꾸지 않는다.

## 쓰기 범위 (겹침 방지 — 반드시 지킨다)
- 소유 파일: `src/engine/sig-<HERO>.js`(궁수는 `src/engine/sig-ranger.js`), 필요하면 새 파일 `src/engine/sig-<HERO>-*.js`, 해당 테스트 `test/*<HERO>*`.
- `src/engine/skill-vfx.js`의 `SKILL_VFX` 표에서 **자기 영웅 줄만** 수정 가능.
- `src/game/skills.js`는 **자기 영웅 스킬 함수 안의 시각 호출만**(fx 호출 추가·조정). 판정·피해·타이밍·난수 소비 순서 변경 금지.
- 공용 파일(`impact-vfx.js`, `fx.js`, `battle-base.js`, `rpg-battle.js`, `combat-readability.js`, 다른 영웅 sig 파일) **수정 금지**. 새 공용 원시 기능이 꼭 필요하면 구현하지 말고 보고에 "필요한 원시 기능"으로 적는다.

## 지켜야 할 기술 규칙
- 인스턴스 임팩트 층(`fx.impact`: beam/mark/_emit/burst/glint/arrowStreak)과 기존 풀(`emitIfFree`)을 쓴다. 프레임당 할당 금지, `Math.random` 금지(castSkillVfx가 vfxRandom으로 바꿔 주지만 서명 안에서는 결정적 수식만). 시드 전투 결정성 유지.
- 예산: 서명 한 번 ≤ 60칸(IMPACT_FRAME_BUDGET 72 안), 텍스처 빌보드 지름 ≤ 10m(TEX_FLASH_MAX_DIAMETER), 노출 예산(FX_EXPOSURE) 유지. 흰/크림 큰 덩어리 금지 — 가산 혼합에서 밝은 큰 면적은 블룸과 합쳐 적을 지운다. 넓은 범위는 얇은 선·표식으로.
- 화면 전체 흔들림 금지(renderer.shake는 no-op 유지). 무게는 정지·섬광·반동.
- 기존 테스트의 예산·가드는 약하게 하지 않는다. 서명 칸 수·타이밍 테스트가 바뀌면 같은 엄격도로 갱신.
- 주석·커밋은 한국어, 식별자 영어, 2스페이스·작은따옴표·세미콜론. 작은 단위마다 커밋.

## 절차 (game-vfx-forge · action-feel-director 요약)
1. `~/.claude/skills/game-vfx-forge/SKILL.md`, `~/.claude/skills/action-feel-director/SKILL.md`를 읽는다(텍스처 생성 단계는 이번엔 생략 — 새 텍스처가 필요하면 목록·규격을 보고에 적는다).
2. 기준: `work/skill-vfx-gallery/before/<HERO>-sheet.jpg`(행 = 슬롯 0~3, 열 = 시전 후 0.12/0.3/0.55/0.9초, 844×390). 먼저 보고 스킬별 목표(한 줄: 실루엣·색·박자)를 정한다.
3. 수정 → `bun install --frozen-lockfile`(워크트리 처음 한 번) → `node tools/skill-vfx-gallery.mjs --dev --tag <HERO>-iterN --heroes <HERO>` → `work/skill-vfx-gallery/<HERO>-iterN/<HERO>-sheet.jpg`를 직접 보고 판정 → 반복(최대 4회). CPU가 4코어뿐이라 갤러리는 한 번에 하나만 돌린다. 각성 스킬(슬롯 4~7)은 `--slots 4,5` 등으로.
4. `bun run typecheck && bun test` 통과(전체 빌드 `bun run check`는 지휘가 통합 때 돌린다).
5. 브랜치를 커밋하고 끝낸다(푸시는 지휘가). 보고(한국어, 300단어 이내): 스킬별 바꾼 점, 마지막 iter 시트 경로, 남은 문제, 필요한 원시 기능/텍스처.
