# 여우 외형·동작 저작 원본

실제 Windows Blender 5.2.2 LTS에서 생성했다. 원본은 asset-library/normalized/avatar_ranger_fox.glb, 기준 골격은 같은 라이브러리의 hero_ranger_t1.glb, 동작 기준은 public/models/heroes-next/ranger-library-t1-v4.glb다. 원본 GLB·manifest와 기본 궁수 v4를 보존한다. 새 유료 생성이나 계정/크레딧 작업은 없다.

몸체 재생성은 새 빈 출력 경로를 사용한다. Blender를 --background --factory-startup --python-exit-code 1 --python art-src/avatar-fox/author_body_contact_v3.py 로 실행하고, -- 뒤에 --input <원본여우> --reference <원본궁수t1> --output <새patch.json> --blend <새.blend> --anchors <새anchors.json> --stage fit-arms-leg --target-sole .016 을 전달한다. 이어 node art-src/avatar-fox/pack-body-contact-v3.mjs <원본여우> <새patch.json> <새.glb>로 정해진 성분만 패치한다. 기존 출력을 덮지 않는다.

두 동작은 먼저 author_fox_body_motion_v2.py를 실제 Blender에서 실행해 원래 고정 artist 궤적을 생성한다. --input <궁수v4> --helper <이폴더/author_body_contact_v2.py> --output <새initial.json> --blend <새initial.blend> --report <새initial.report.json>을 사용한다. 이 폴더의 fox-body-motion-initial.json은 실제 검증된 이전 입력과 정확히 같다. 최종 author_fox_body_motion_v3.py는 같은 인자에 --previous <fox-body-motion-initial.json>을 추가해 별도 새 JSON/blend/report를 만든다. 회피의 출발/착지 artist 곡선을 보완하고 이전 사망 트랙 전체가 같은지 강제한다. 최종 선택 데이터는 src/data/fox-body-motion-v1.json이며 실제 편집 원본은 fox-body-motion-v2.blend다.

fox-body-fit-v1.blend는 실제 원본 몸체·리그·재질/UV 및 국소 피팅/가중치를 보존한다. 편집 blend의 normals가 패치된 GLB의 explicit normals와 동일 shading이라고 주장하지 않는다. pack.json과 patch.json은 허용 성분/정점·원본 본·기타 BIN/JSON 불변을 기록한다. runtime-contact-v1.json은 실제 로더 direct/swap 301 균등·모든 키의 수치검사이며 미술 승인·실제 Android·발열 또는 다른 아바타 완료 증거가 아니다. 최종 정확 HEAD의 실제 렌더·strict media·플레이 증거는 릴리스 작업 영수증과 연결한다.
