# 유리 정원 소품 키트 v1

첫 던전 '유리 정원'(`glass_garden`, 기본·심층 모두)의 방 가장자리를 채우는 Blender 제작 소품 6종과 그 배치 계약이다. 외부 모델·텍스처·생성 서비스 없이 정점 색만 쓰며, 기존 영웅·적 리그·충돌 마스크·던전 킷·`buildRegionArchitecture` 지오메트리 해시는 건드리지 않는다.

## 소품

| 소품 | LOD0 / LOD1 삼각형 | 파일 크기(LOD0) | 높이 |
| --- | --- | --- | --- |
| `crystal-cluster-s` 작은 수정 군집 | 230 / 92 | 18.5 KB | 0.97 m |
| `crystal-cluster-l` 큰 수정 군집 | 334 / 116 | 24.7 KB | 1.99 m |
| `trellis-arch` 깨진 유리 격자 아치 | 777 / 316 | 43.0 KB | 3.84 m |
| `planter-crystal` 수정 잎 화분 | 328 / 120 | 23.4 KB | 1.50 m |
| `moss-edging` 이끼 돌 테두리(2 m 모듈) | 288 / 116 | 21.5 KB | 0.76 m |
| `hanging-lantern` 걸이 유리 등(발광) | 287 / 99 | 17.5 KB | 2.42 m |

12개 GLB 합계 219,344 바이트(meshopt 무손실 압축). 파일별 바이트·SHA-256·삼각형·경계는 `public/models/glass-garden-kit-v1/manifest.json`, 제작은 `tools/art/build-glass-garden-kit-v1.py`(Blender 5.2 LTS), 편집 원본과 미리보기 렌더는 `art/glass-garden-kit-v1/`.

## 배치(`src/game/glass-garden-decor.js`)

방마다 `planGlassGardenDecor(floor)`가 층 시드만으로 배치를 정하고(층 난수·아레나 난수를 쓰지 않는다), `buildGlassGardenDecor`가 방별로 재질당 한 번 병합한다. 방마다 메시는 최대 2개(`gg_matte`, `gg_glow`)이며 그림자는 던지지 않는다. 시선 가림 처리(`BattleOcclusion`)에 묶여 영웅을 덮는 조각은 기존 벽처럼 비워진다. 키트가 없으면 장식만 건너뛴다. 렌더 품질이 높음이 아니면 LOD1을 쓴다.

여유 규칙(`GLASS_GARDEN_DECOR`, 모든 후보에 적용되고 `test/glass-garden-decor.test.ts`가 기본·심층·여러 시드 월드에서 검증):

- 발자국 전체가 보이는 벽(마스크 경계)에서 0.3 m 이상, 2.45 m 이하 띠 안. 적 스폰 여백(`randomIn` 2.5 m)과 겹치지 않는다.
- 벽 바깥 셀이 열린 구간(복도·열린 봉인)에서 발자국 반경 + 1.1 m, 보스 봉인 사각형에서 2.5 m 이상.
- 기존 방 장식의 실제 위치(모서리 기둥, 동서 횃불, 보스 깃발, 보스·정예·보물방 북쪽 랜드마크)와 환경 제어 조작판·종착점을 비운다. 목표 장치(`objectiveProp`)가 붙은 방은 장식하지 않는다.
- 카메라 쪽(남쪽) 띠에는 높이 1.55 m 이하 소품만. 키 큰 소품(아치·등·큰 수정)은 북쪽과 동서 벽에 둔다.
- 무리 대형: `planRoomPacks`·`pickRoomPack`(Battle.roomPackFor와 같은 함수)·`packSlot`을 진입 위치 × 영웅 위치 × 명단 수로 돌려 얻은 모든 적 생성 자리와 발자국 사이 0.9 m 이상(`packSlotPoints`). 일반·정예·보물방 가장자리는 이 자리에서 비켜난 구간에만 놓는다.
- 발자국을 전부 막힌 칸으로 가정해도 모든 방이 시작방에서 이어지고, 방 중앙 이동 영역과 복도 중심선은 한 칸도 막히지 않는다.

기본 원정 한 층의 배치는 40개(큰 수정 4, 작은 수정 13, 등 7, 화분 4, 아치 6, 이끼 테두리 6)이고 방당 삼각형은 747~6,066이다.

## 렌더 비용(Chromium SwiftShader, 844×390, 품질 높음)

무리 대형 여유 규칙을 넣기 전 배치(58개) 기준 측정이며, 이후 배치(40개)는 같은 소품·재질이라 이 값 이하다. 같은 프레임을 한 동기 호출 안에서 장식을 켠 채·끈 채 `renderer.render()` 한 번씩 그린 `info.render` 차이(5개 방 × 중앙·동·서·북·남 25지점):

- draw call: 장식 없음 67~173(평균 122.7) → 장식 있음 71~177(평균 126.4). 증가 +2~+8(평균 +3.7). 보이는 방마다 최대 2개.
- 삼각형: 장식 없음 약 24만~106만 → 증가 +2.2천~+14.8천(평균 +6.5천).
- 지오메트리 메모리: 방별 병합 버퍼 10개, 텍스처 추가 없음.

이 값은 소프트웨어 렌더 한 프레임의 호출 수·삼각형 수이며 실제 Android GPU 프레임 시간·발열 증거가 아니다. 실기기 확인은 남은 게이트다.

## 다시 만들기·검증

```sh
blender --background --python-exit-code 1 --python tools/art/build-glass-garden-kit-v1.py   # GLB·manifest·미리보기 (GG_RENDER=0이면 렌더 생략)
bun test test/glass-garden-kit-asset.test.ts test/glass-garden-decor.test.ts
node tools/glass-garden-decor-qa.mjs --url=http://127.0.0.1:5186/ --label=<이름> --quality=high   # 실제 화면 점검
```

실제 화면 증거는 `docs/qa/glass-garden-kit-20261021/`(스크린샷 10장, draw call 표본). 영웅 위치는 QA 스크립트가 직접 놓았고 실제 터치 이동·GPU·발열 증거가 아니다.
