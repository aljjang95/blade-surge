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
