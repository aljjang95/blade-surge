# 장비 아트 레인 인계 (2026-10-29)

레인: `[gogo-chunk:blade-gear#art]`, 지휘 세션 `session_01H8mx3U9qK3w3SjT5hPBKSr`. 작업 브랜치 `claude/gear-weapon-glb`(이 문서 포함).

## 끝난 것
- 장비 아이콘 새 톤 전부 운영 반영: 60종(외형 레인 PR #380) + 나머지 139종(PR #385, main 4498c65, blade.tllhouse.com version.json 일치, 아이콘 200 확인). 남은 옛 그림은 영웅 형태별 무기 `public/img/item-renders/forms/` 215장뿐.
- 도구: `tools/art/gear-icon-brief.mjs`(콜라주 요청서), `tools/art/icon-collage-split.py`(흰 배경 콜라주 → id별 투명 PNG; 진주처럼 큰 흰 하이라이트는 `--hole 0.012`), `tools/art/import-icon-batch.py`(표시 경로 판정·webp 변환·매니페스트 갱신).

## 진행 중
- 무기 3D 1차 4자루(w_rusty N · w_hunter S · w_frost E · w_king L): 지휘가 Tripo 생성 중 → R2 `blade-surge-handoff/tripo-3d/weapons/<id>/`.
- 코드 경로는 이 브랜치에 준비됨(미머지, PR 없음): `src/engine/item-weapon-glb.js` + `src/data/item-weapon-glb.json`(items 비어 있음 → 지금은 기존 절차적 무기), `tools/asset-library/blender_weapon_prep.py`, `tools/art/register-item-weapon.mjs`, `test/item-weapon-glb.test.ts`, 문서 `docs/ITEM_WEAPON_3D.md`. 검성(knight) sword/greatsword 형태만 GLB, 다른 직업·로딩 실패는 절차적 폴백. main 병합 후 렌더 매니페스트 소스 해시 재계산까지 됨(9f211b3).

## 다음 행동 (GLB 도착 후)
1. R2에서 4자루 받기 → 아이콘과 정체성 대조(실루엣·색·장식).
2. Blender 5.x(공식 tarball, 스크래치)로 `blender_weapon_prep.py`(+Y 날, 손잡이 원점, ≤4000 삼각형, 텍스처 ≤1024) → `register-item-weapon.mjs --id <id> --form <sword|greatsword> --taskId <t>`.
3. `bun run check`, 로컬 preview에서 검성 장착·강화 단계별 빛·광륜 위치 확인(전투·로비 844×390 캡처).
4. PR → Codex 리뷰 → squash 머지 → PC `node tools/deploy.mjs --auth=wrangler`(깨끗한 detached worktree) → version.json readback → 지휘 보고.
5. 대표님 확인 뒤 나머지 38자루: `art-src/gear-icons/weapon-3d-queue.json`(2차 기본 드롭 11 → 3차 U 테마 9 → 4차 도감·마을 15 → 5차 원정 3). 참조 아이콘 R2 `tripo-image/A|C|D-split/<id>.png`.

## 남은 후보
- 다른 직업 형태(도끼·지팡이·쌍단검·활) 3D와 `forms/` 215장 재작화 — 매니페스트 키를 `{id, form}`으로 확장.
- 주의: 핫픽스 PR #397 등 items.js·item-forge.js를 바꾸는 PR과 렌더 매니페스트 sourceHashes가 겹친다. 병합 시 현재 파일로 해시 재계산.
