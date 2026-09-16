# Oath Expedition / 서약 원정대 V3

Blender 5.2.1 LTS (`9e2066aef7ef`)로 제작한 다섯 영웅의 복장 후보. 기존 KayKit/프로젝트 얼굴·리그·클립·장비 소켓을 보존한다. 완전 신규 얼굴 또는 독점 원작 캐릭터라는 주장은 하지 않는다. 원본 라이선스와 크레딧은 `public/models/KAYKIT_ADVENTURERS_LICENSE.txt` 및 `public/models/tll/README.md`를 따른다.

- `*-v3.blend`: 복장과 원본 얼굴/리그 참고, 스튜디오 조명과 카메라가 있는 편집 원본.
- `../../public/models/heroes-v3/*-v3.glb`: 뼈 부착 이름 `tllBone`을 가진 복장. 게임 로더가 원래 skeleton에 skin을 바인딩한다. Ranger는 기존 의상에 장식만 추가한다.
- `*-baseline.png`, `*-three-quarter.png`: 같은 Blender 카메라/조명에서의 복장 비교. **게임 화면이 아니다.**
- `*-front.png`, `*-profile.png`, `*-clay.png`: 형태·표면 검사.
- `manifest.json`: Blender 버전, 원본/출력 SHA-256, 부착 관절, 파일 크기.

재현: 저장소 루트에서 `node tools/art/decode-v3-sources.mjs`, 그다음 Blender `--background --factory-startup --python-exit-code 1 --python tools/art/build-heroes-v3.py`.

원본 `public/models/*.glb`와 `public/models/tll/*`는 수정하지 않는다. 디코딩 복사본은 `work/overhaul-v3/sources`에만 둔다. CPU 포즈 검사는 `bun test test/heroes-v3.test.ts`; 실제 게임 렌더·터치·음성·체감 및 출시 판정은 별도다.
