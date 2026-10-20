# 유리 정원 소품 키트 v1

첫 던전 '유리 정원'(`glass_garden`)의 방 가장자리를 채우는 Blender 제작 소품 6종입니다. 외부 모델·텍스처·생성 서비스 없이 정점 색만 씁니다. 기존 영웅·적 리그, 충돌 마스크, 던전 킷은 건드리지 않습니다.

| 소품 | 용도 | LOD0 / LOD1 삼각형 |
| --- | --- | --- |
| `crystal-cluster-s` | 작은 민트 수정 군집(이끼 돌 받침) | 230 / 92 |
| `crystal-cluster-l` | 큰 민트 수정 군집 | 334 / 116 |
| `trellis-arch` | 깨진 유리 격자 아치 조각(한쪽 기둥 부러짐, 덩굴·유리 파편) | 777 / 316 |
| `planter-crystal` | 수정 잎 화분(황동 띠 석재 화분) | 328 / 120 |
| `moss-edging` | 이끼 돌 테두리 2 m 모듈 | 288 / 116 |
| `hanging-lantern` | 걸이 유리 등(양치기 지팡이형 철제 기둥, 발광 유리) | 287 / 99 |

- `glass-garden-kit-v1.blend` 편집 원본, `glass-garden-kit-v1-preview.png` LOD0(뒷줄)·LOD1(앞줄) 비교 렌더, `glass-garden-kit-v1-turntable.png` 소품별 4방향 턴테이블.
- 런타임 GLB와 `manifest.json`(바이트·SHA-256·삼각형·경계·제작 스크립트 해시)은 `public/models/glass-garden-kit-v1/`.
- 단위 미터, glTF Y-up, 전면 +Z(방 안쪽), 지면 중앙 피벗(걸이 등은 기둥 밑동). 재질은 `gg_matte`(조명 받는 정점 색)와 `gg_glow`(발광 × 정점 색) 둘뿐.
- 다시 만들기: 저장소 루트에서 `blender --background --python-exit-code 1 --python tools/art/build-glass-garden-kit-v1.py` (Blender 5.2 LTS, 무손실 meshopt 압축에 `node`와 `meshoptimizer`가 필요). 렌더 없이 GLB만 갱신하려면 `GG_RENDER=0`.
- 룩 기준: `public/img/expansion/glass_garden.webp`, `docs/assets/citadel-hub-v1/reference-source/glass-garden-trellis-reference.png`.

배치는 `src/game/glass-garden-decor.js`가 정하고 방마다 두 재질로 한 번씩 병합해 그립니다. 여유 규칙과 검증은 `test/glass-garden-decor.test.ts`.
