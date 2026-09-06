# Casual v2 — 가로 로비와 영웅

- 대표님 요청: PR9보다 더 캐주얼한 디자인으로 코드 변경. 기준 f21cc272918a04e43f079858d0dbe4b1dbcf4003.
- 방향: 뾰족한 관/어깨판을 둥근 왕관·꽃·패딩으로, 검은 금속을 무광 파스텔로. 로비는 낮은 둥근 아치와 세이지·크림 팔레트. 얼굴·직업·전투·가로 구성·자원 회수는 유지.
- 구현: --casual 제작 옵션과 casual-v2 신규 GLB/초상 경로. oath-v1 원본 파일을 보존. casual은 금속성0/거칠기0.85와 1배치, v1의 2배치 계약은 별도 유지/검증.
- 실행 표면: 1280×720 및 740×360 가로 WebGL, 실제 입력·전투·복귀. 기존 Game Studio의 세로 폭 조건을 이 작업에 강제하지 않는다.
- SDK 판단: 새 패키지 없음. 기존 Blender GLB/Three.js SkinnedMesh·TorusGeometry·PBR 경계로 충분하며 모델의 bone/scale와 shared-resource 계약을 유지한다.
- 검증: 99 tests/696 assertions·typecheck/build 통과, 전투 하네스160초/157처치/44드랍/전밴드 통과. 상세 현재 근거는 _autopipe/evidence/casual/에 보존. 이전 PR9 matrix를 이번 검증으로 재사용하지 않는다.
- 환경 오류: 개발 서버 재기동 뒤 Chromium ERR_CACHE_READ_FAILURE를 Network 이벤트로 확인. 해당 개발 탭의 캐시를 일시 비활성화해 정상 로딩을 확인했고 제품 코드의 결함으로 둔갑시키지 않는다.
- 리뷰·릴리스 결과는 이 폴더의 생성 영수증과 현재 live version으로 확인한다. 물리 기기 성능·대표님 최종 FELT는 별도.

- 최종 실표면: casual-v2로 실제2층 157처치/3별 승리 후 복귀. 3회 재출격/포기/복귀에서 geometry65/texture73/program72 동일. 저사양 가로 화면 확인.
- 독립 Pro 리뷰: 코드·시각 PASS. 동일 masters 폴더 혼합을 요구한 M1은 실제 새 revision 디렉터리 계약을 확인하고 INVALID FINDING으로 철회됐다.
