# 영웅 몸체 교체 — 리깅·애니메이션 검사표 (2026-10-23)

Tripo로 다시 만든 몸(궁수 v5부터)을 게임에 넣기 전에 아래를 모두 증거로 닫는다. 각 줄은 도구와 합격선이 있다. 느슨하게 바꾸지 않는다.

## 경로
1. Tripo Studio(대표님 평소 PC Chrome): 컨셉 원화 → H3.1 이미지→3D → Retopology Triangle 11,000 → Auto Rig(Humanoid, Mixamo 프리셋) → GLB·FBX 내려받기. 원본은 받자마자 `archive_asset.py`로 TLL-Asset-Foundry에 보관.
2. 클라우드 Blender 5.2.2: `tools/asset-library/blender_swap_body.py`가 새 몸을 현재 1단계 런타임 골격(예: `ranger-library-t1-v4.glb`)에 다시 묶어 몸만 내보낸다(Hips→Head 배율, 어깨선 90° 정렬, 없는 본 가중치는 상위 본으로, 무가중치 정점은 최근접 복사).
3. `tools/art/swap-library-body.mjs`가 base GLB의 골격·클립·활 소켓·역바인드 바이트를 그대로 두고 몸 메시·재질·텍스처만 바꾼다. 관절 이름 누락·역바인드 차이 0.01 초과면 실패한다.
4. `tools/art/finish-library-materials.mjs`로 재질 마감(금속도 0.22 상한, MASK 0.5) → 기록 JSON(`src/data/ranger-library-revision-v5.json`) → 런타임 연결.
5. Mixamo 클립은 1단계 골격과 이름·rest가 같으므로 다시 받지 않는다. 몸이 바뀌어 클립이 맞지 않는 경우(관통·접지)만 Mixamo(PC Chrome)에서 다시 받아 `blender_merge_mixamo.py` → 저작 스크립트로 굽는다.

## 검사 항목
| # | 항목 | 도구 | 합격 |
|---|---|---|---|
| R1 | 두 눈·눈썹 가림 없음(정면·3/4·전투 55°) | `tools/art/face-audit/run.mjs` | 시트에서 머리카락·장식이 홍채를 가리지 않음 |
| R2 | 골격 동일(관절 이름·순서·rest) | `swap-library-body.mjs` | 누락 0, 역바인드 차 ≤ 0.01 |
| R3 | 삼각형·재질·본 예산 | `bun run assets:verify`, `validateLibraryModel` | ≤ 12,000 tris, 재질 ≤ 2, 본 ≤ 80 |
| R4 | 관절 꺾임(팔꿈치·무릎·어깨·손목) — 사탕 껍질 비틀림·부피 꺼짐 | `face-audit`/임시 촬영기로 idle·run·bow_shoot·death·dodge 표본 | 꺾인 관절 바깥 면이 접히거나 뚫리지 않음 |
| R5 | 손 소켓·무기 잡기: 활 그립이 왼손 바닥, 시위 노크가 오른손 | `tools/combat-pose-qa.mjs` | 무기 손잡이-손 거리·무기-머리 겹침이 기존 기준 이내 |
| R6 | 몸통 관통(팔·활이 가슴·망토를 뚫음) | `tools/combat-pose-qa.mjs` | 기존 cm 기준 이내 |
| R7 | 접지·발 미끄러짐·반복 이음새 | `tools/anim-audit-qa.mjs` | 기존 기준 이내, 사망 정착 시 활·발이 바닥 아래 -0.01m 미만 금지 |
| R8 | 이음새(목·손목·허리 텍스처 경계, 무가중치 정점 떠다님) | 근접 촬영 + `filledVertices` 기록 | 갈라짐·떠다니는 조각 없음 |
| R9 | 실제 게임 화면 전후 비교(로비·영웅 화면·전투) | Playwright 실제 빌드 촬영(360·390·1280px) | 대표님 확인용 전후 이미지 첨부 |
| R10 | 실기기 | S26/Tab S7+ | 남은 게이트로 보고(클라우드에서 닫지 않음) |
