# TLL 게임 에셋 라이브러리 계약 v1 (Blade Surge 2026-10-12)

## 목표
Tripo Studio(대표님 구독 계정)로 만든 리깅·애니메이션 3D 에셋을 Blender로 정규화해 `public/models/library/`에 넣고, 기존 몬스터 슬롯을 실제 게임에서 교체한다. 아트 방향은 넥슨 "용사X용사"류 동화풍 캐주얼 3D: SD 비율, 밝고 채도 높은 색, 손그림 질감, 큰 실루엣.

## 디렉터리
- `asset-library/raw/<assetId>/` : Tripo Studio에서 내려받은 원본(GLB/FBX), Git 제외(.gitignore). 원본 해시는 manifest에 기록.
- `asset-library/manifest.json` : 라이브러리 정본 목록(아래 스키마).
- `tools/asset-library/blender_normalize.py` : Blender 5.2 백그라운드 정규화.
- `tools/asset-library/ingest.mjs` : raw → Blender → 검증 → `public/models/library/<assetId>.glb` + manifest 갱신.
- `public/models/library/<assetId>.glb` : 게임이 읽는 결과물.

## manifest 스키마 (schema: "tll.game-asset-library.v1")
```json
{ "schema": "tll.game-asset-library.v1", "assets": [ {
  "id": "bone_knight", "kind": "character|prop", "body": "biped|quadruped|none",
  "replaces": "Skeleton_Warrior",            // 기존 MONSTER_MODELS 이름 또는 null
  "file": "/models/library/bone_knight.glb",
  "heightM": 1.6, "triangles": 0, "bytes": 0, "sha256": "",
  "clips": { "idle": "idle", "walk": "walk", "run": "run", "attack": "attack", "attackHeavy": "attackHeavy", "hit": "hit", "death": "death" },
  "provenance": { "tool": "Tripo Studio", "account": "owner subscription", "taskId": "", "prompt": "", "createdAt": "", "rawSha256": "" },
  "license": "owner-generated (Tripo subscription)", "shared": true
} ] }
```

## 정규화 규칙 (Blender)
- 단위 m, +Y up(glTF), 정면 +Z(기존 KayKit/Quaternius와 동일), 발바닥 피벗 원점, 목표 키(heightM)로 균일 스케일.
- 캐릭터 삼각형 ≤ 12,000, 보스 ≤ 20,000, 소품 ≤ 4,000. 초과 시 Decimate.
- 텍스처 최대 1024(보스 2048), 재질 1~2개, 스킨 본 ≤ 64.
- 애니메이션 액션 이름을 논리 키로 바꾼다: idle, walk, run, attack, attackHeavy, hit, death (+ 선택 spawn, cast). Tripo 원본 이름→논리 키 매핑은 ingest 인자로 받는다.
- root motion 제거(in-place), 루프 클립(idle/walk/run)은 첫·끝 포즈 일치.

## 게임 연동 계약
- `src/data/rigs.js`에 `library` 리그 추가: 논리 키 = 클립 이름(idle→'idle' 등), scale 1, faceFlip false.
- 몬스터 교체는 manifest의 `replaces`로만 한다. 라이브러리 파일 로드 실패 시 원래 모델로 폴백(콘솔 경고 1회, 게임 오류 0).
- 프레임 루프 할당 금지, drawCalls ≤ 420 밴드 유지. 기존 테스트 전부 통과.

## 공용 라이브러리 지침
여러 게임이 같이 쓸 에셋은 manifest의 `shared: true`로 표시한다. 공용 저장소/카탈로그 승격은 `C:/Work/tools/game-development-studio`(game-dev CLI 1.5.0)의 catalog/package/vendor 흐름을 표준으로 삼고, 이 저장소의 manifest를 그 패키지 입력으로 쓴다.

