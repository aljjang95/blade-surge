# 인계: 전투 가독성·스킬 VFX 레인 (blade-combat#readability, 2026-10-29)

## 끝난 것
- PR #394 머지(f554dbc): 공용 전투 가독성 층(적 붉은 발밑 고리, 맞은 적 체력 막대, 조준 꺾쇠·머리 위 표식, 원거리 조준선, 화면 밖 대상 가장자리 화살, 빗나감 회색 먼지, 모든 명중 최소 섬광). `docs/COMBAT_READABILITY.md`.
- 운영 배포: 77b83ab(#394 포함) PC `node tools/deploy.mjs --auth=wrangler` 성공, version.json readback 일치(2026-10-29 05:00Z). 실서버 Playwright 전투 진입 확인은 타임아웃 2회로 미완.

## 진행 중
- 브랜치 `claude/combat-vfx`(푸시됨, c7412b18): 궁수 서명 분리(sig-ranger.js) + 검성·광전사·대마도사 스킬 VFX 강화 병합. PR 미생성. 전체 `bun run check` 미실행.
- 암살자·바람추적자 VFX: Opus 하위 레인이 이 세션 워크트리(`.claude/worktrees/agent-*`)에서 작업 중 — 끝나면 claude/combat-vfx에 병합.
- 각성 스킬 아이콘 16종(대표님 "퀄떨어지는 아이콘 변경" 지시): PC ocx-dispatch runId 20261029-141551-aea1b7 → 브랜치 `claude/ocx-skill-icons`(Codex 이미지 생성).

## 남은 일
1. 암살자·궁수 레인 결과 병합 → `bun run check` → PR → 독립 리뷰 → 머지 → PC 배포·readback.
2. 공용: 화염구·운석 착탄 크림 번짐(fx `abilitySignature('fire', heavy)`·dustPuff) 밝기 상한, 용살검 균열 가림, 시전 직후 파랑 소용돌이 출처(ultCinematic castCircle / combo-link 추정).
3. 각성 스킬(슬롯 4~7) VFX는 대부분 미착수.
4. 아이콘 브랜치 확인(16장 시트 검수) → 머지·배포.
5. 밀집 무리 속 영웅 비컨 가림.
6. 궁수 화살 몸통 발광은 인스턴스 방식으로 이 레인 소관(첫인상 PR #395에서 뺌).

## 도구
- `node tools/skill-vfx-gallery.mjs --dev --tag <tag> --heroes <hero> [--times ...] [--slots ...]`
- `node tools/combat-readability-qa.mjs --tag <tag> [--dist <outDir>]`

## 2차 다듬기 (blade-combat#vfx2, 2026-10-30, 브랜치 claude/combat-vfx2)
- ① 대지붕괴(bloodquake)·그림자 표식(shadow_mark)·일식(eclipse_edge)의 영웅 둘레 크림 고리·흰 폭발 원화(castCircle·shockTex·explosion)를 `knightRetiredDraws`로 난수 소비만 남기고 뺐다(`KNIGHT_RETIRED_DRAWS.explosion = 8` 추가). 혈왕 1차 판정 테는 서명 가시 고리(4.5m 상한)가 맡는다.
- ② 화면 가로 진행 공용 원시 `src/engine/sig-screen.js` `screenSweep` — 질풍·연속 관통이 정면 카메라에서 좁은 세로 띠로 몰리던 것을 경로 위 가로 빗장으로 보인다.
- ③ 서명 ctx `targets(max, range, sorted)`(`skill-vfx.js` `sigTargets`, skills.js `targets`와 같은 규칙) — 그림자 표식은 실제 표적 위 표식·표적 평균 당김 중심, 공허 보법은 점멸 표적 순번대로 획.
- ④ 숲의 속박 백화의 주 원인: 조준 고리(readability-view reticle)의 명중 맥박이 깊이 검사 없이 적 위에 흰 원판(r .3~1)을 그렸다 → 바깥 테만. 그 밖에 속박 화살 명중 섬광·몸 번쩍임 덩굴빛(battle-base·rpg-battle `tint`, 호출 수 그대로), 속박 매듭 적·시전당 1회, 조이는 고리 가운데만, 화살 심 연두, 가시 둘. 실측(3회 평균, 적 영역 흰 픽셀): .45초 15.6→9.0%, .55초 17.6→12.2%, .7초 14.1→5.2%.
- 검사: `tools/skill-rng-parity.mjs`(5영웅 40스킬 × lite × 조준 160경우 main 대비 불일치 0), `bun run check` 6363 pass, `bun run qa:inapp` 통과.
- 갤러리 도구: `--dump`(프레임별 fx 항목·반투명 물체 목록), `--probe "<식>"`(시전 직전 평가, 층 끄기로 원인 추적).

### 남은 것
- 광전사 혈왕 시전 순간 영웅 중심의 크림 원판은 흡인된 적 다수 동시 접촉 섬광(fx.contact) — 군중 접촉 섬광 상한 별도 검토.
- 숲의 속박 .55초 잔여 밝기는 다섯 갈래 서명+화살 궤적의 가산 합(층을 모두 끄면 깨끗) — 더 줄이려면 갈래 수·심 밝기 조정.
- 실기기 프레임·밝기 미확인(SwiftShader 갤러리로 "보이는지"만).
