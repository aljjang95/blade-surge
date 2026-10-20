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

영웅 2·3단계 몸체는 1단계 골격의 본 이름만 써야 한다. verify는 단계 GLB의 skin joint 이름이 같은 영웅 1단계에 모두 있는지 검사한다. 하나라도 없으면 런타임이 조용히 1단계 몸체를 유지하기 때문이다.

## Mixamo 클립 병합

리그 FBX(Mixamo 또는 Tripo Mixamo 규격)와 스킨 없는 Mixamo 클립 FBX를 NLA 트랙으로 합쳐 GLB를 만든다. 매핑 JSON은 `{"논리키":"클립파일명"}` 형식이다.

```powershell
python <blender-headless>/scripts/blender_run.py tools/asset-library/blender_merge_mixamo.py --report <r.json> -- --rigged <rig.fbx> --clips work/mixamo/clips --mapping <map.json> --output <merged.glb> --report <r.json>
```

그다음 ingest에 `--map`으로 논리 키를 같은 이름에 매핑해 넣는다. 몬스터는 대형 3종이 Mixamo Mutant 세트, 해골 2종이 좀비 걷기/검방패 걷기와 기존 마법·검 클립을 쓴다.

## 영웅 갑옷 2·3단계

1. GPT Image 2.5 원화(1단계와 같은 얼굴·비율, 무기 없는 T포즈)를 Tripo H3.1 이미지→3D로 생성한다. 손에 무기를 든 원화는 리그가 틀어진다.
2. Tripo Retopology(Triangle, 11,000)로 줄이고 Humanoid·Mixamo 프리셋으로 리깅한 FBX를 받는다.
3. 1단계와 같은 클립으로 병합한 GLB를 `tools/asset-library/blender_retarget_tier.py`에 넣어 1단계 정규화 골격에 다시 묶는다. Hips·Head 거리로 배율을 맞추고, 1단계에 없는 본의 가중치는 상위 본으로 합치며, 가중치 없는 정점은 가장 가까운 정점 값을 복사한다. 텍스처는 1024px로 줄인다.

```powershell
python <blender-headless>/scripts/blender_run.py tools/asset-library/blender_retarget_tier.py --report <r.json> -- --t1 asset-library/normalized/hero_<id>_t1.glb --tier <merged.glb> --output <tier.glb> --report <r.json>
node tools/asset-library/ingest.mjs --id hero_<id>_t<n> --input <tier.glb> --role hero --heroId <id> --armorTier <n> --prenormalized true --map "{}" --taskId <tripo-task>
```

`--prenormalized`는 재정규화로 골격 배율·원점이 1단계와 어긋나지 않도록 파일을 그대로 들인다. 단계 몸체는 클립 없이 1단계 클립을 공유한다. `--keepAnim <clip>`을 주면 확인용으로 1단계 클립 하나를 붙여 내보내므로 Blender preview `--frame`으로 변형을 볼 수 있다.
