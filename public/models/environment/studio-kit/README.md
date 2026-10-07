# 성채 마을·숲 제작 키트

Blender에서 직접 만든 재사용 환경 에셋 6종입니다. 외부 모델·텍스처·생성 서비스를 사용하지 않았습니다. 캐릭터 리그와 애니메이션은 이 키트에 포함하지 않습니다.

| 파일 | 용도 |
| --- | --- |
| `evergreen-tree.glb` | 원경 침엽수 숲 |
| `broadleaf-tree.glb` | 정원 수목·활엽수 숲 |
| `mossy-rock-cluster.glb` | 이끼 바위·숲 가장자리 |
| `timber-cottage.glb` | 청기와 목조 마을 가옥 |
| `village-gate.glb` | 개방 통로를 가진 마을 문 |
| `lantern.glb` | 황동 길안내 등 |

모든 파일은 미터 단위, glTF Y-up, +Z 전면, 지면 중앙 피벗입니다. 각각 한 메시·한 불투명 재질·정점 색을 사용하며 이미지·외부 파일·조명·스킨·클립은 없습니다. 침엽수와 활엽수는 각각 1,000 삼각형 이내입니다. `manifest.json`에 파일별 실제 바이트·SHA-256·경계·삼각형 수와 제작 스크립트 해시를 기록했습니다.

저장소 루트에서 다시 제작합니다.

```sh
blender --background --python-exit-code 1 --python tools/art/build-environment-kit.py
```

편집 가능한 `.blend`와 실제 Blender preview는 `/workspace/scratch/bladesurge-environment-kit/`에 보관합니다. 생성기는 GLB를 내보낸 직후 정적 파일 정책을 확인합니다. 실제 게임 카메라의 가림·배치·성능 검수는 별도로 수행해야 합니다.

이 모델과 색상은 프로젝트에서 직접 제작한 원본입니다. 기존 KayKit·Quaternius·Kenney 모델과 권리 표기는 각각 원래 위치에 보존합니다.
