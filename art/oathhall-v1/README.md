# 서약의 전당 · Oath Hall V1

Blender에서 직접 제작한 블레이드 서지 로비 환경입니다. 화면 이미지를 3D처럼 붙인 배경이 아닙니다.
원래 영웅의 얼굴·헤어·형상·스켈레톤·애니메이션은 수정하지 않았습니다.

## 편집 원본

`oathhall-v1.blend`를 Blender 5.2.1 LTS에서 열 수 있습니다.
- `OATH_HALL | editable stonework`: 석재, 단상, 기둥, 아치, 문장 깃발, 조경 등 267개 개별 편집 오브젝트.
- `RUNTIME | material batches`: 내보내기용 8개 재질 배치. 편집 화면에서 중복 표시되지 않도록 숨겨져 있습니다.
- `STUDIO | camera and lights`: 환경 확인용 카메라와 조명. 게임용 GLB에는 포함하지 않습니다.

`oathhall-beauty.png`는 이 파일에서 실제 렌더링한 환경 검토 이미지입니다. 인게임 스크린샷과 구분합니다.

## 게임 파일

`public/models/oathhall-v1/oathhall-v1.glb`: 19,450 triangles / 8 mesh batches / 8 materials / 1,352,084 bytes.
`public/models/oathhall-v1/manifest.json`: 실제 파일 해시, 제작 도구와 예산 기록.
코드는 `src/engine/oathhall-asset.js`를 통해 로드합니다. 실패하면 기존 로비 건축으로 돌아갑니다.
카메라·충돌·전투 권한을 GLB에 넣지 않았습니다.

## 다시 만들기

```sh
blender --background --factory-startup --python tools/art/build-oathhall-v1.py
blender --background art/oathhall-v1/oathhall-v1.blend --python tools/art/verify-oathhall-v1.py
```

이 전당 형상은 이번 작업에서 직접 작성한 지오메트리입니다. 외부 모델을 다운로드하지 않았습니다.
원래 게임의 캐릭터·소스·기존 이미지의 권리나 라이선스를 이 문서로 변경하지 않습니다.
