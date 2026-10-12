# TLL 게임 에셋 라이브러리 파이프라인

## 테스트 GLB

Blender 5.2로 본 2~3개와 `idle`, `attack` 액션을 가진 작은 GLB를 준비한다. 원본은 `asset-library/raw/<id>/<id>.glb`에 둔다. `raw/`는 Git에서 제외된다.

## ingest

```powershell
bun run assets:ingest -- --id bone-knight-test --input asset-library/raw/bone-knight-test/bone-knight-test.glb --replaces Skeleton_Warrior --height 1.6 --idle idle --attack attack
```

ingest는 Blender 5.2 백그라운드 정규화, 단위·발바닥 정렬, root motion 제거, 액션 이름 매핑, GLB 해시·크기·삼각형 예산 검사를 수행하고 `asset-library/normalized/<id>.glb`와 manifest를 갱신한다. `--map`은 JSON 객체로 원본 액션을 논리 키에 매핑한다. 예를 들어 테스트 fixture는 `{"idle":"idle","walk":"idle","run":"idle","attack":"attack","attackHeavy":"attack","hit":"attack","death":"attack"}`를 사용한다. 통합 단계에서 검증된 결과물을 `public/models/library/<id>.glb`에 배치한다.

실제 Tripo 원본은 동일한 명령에 `--input`과 `--taskId`, `--prompt`를 추가해 provenance를 보존한다. 캐릭터는 12,000, 소품은 4,000 삼각형을 넘으면 ingest가 실패한다.

## verify

```powershell
bun run assets:verify
```

verify는 manifest의 schema, 중복 id, 파일 크기·SHA-256, 필수 clip 키, 삼각형 예산을 다시 검사한다. 게임은 `replaces`가 현재 모델명과 일치하는 항목을 우선 로드하고 실패하면 기존 GLB를 사용한다.
