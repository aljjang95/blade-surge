# 영웅 애니메이션 전신 축 교정 v2 (궁수 ranger-library-v2 · 도적 rogue-library-axis-v1)

2026-10-16. 궁수 v1(`docs/ranger-playability.md`)은 팔·활만 다시 저작했다. 사용자 재신고("몸이 꺾인다")를 따라 원인을 전신에서 다시 찾았고, 같은 원인을 가진 도적 1단계도 함께 교정했다. 원본 정규화 GLB 와 manifest 는 바꾸지 않았고, 버전이 붙은 교정본·기록·로더로만 연결한다.

> 후속(2026-10-17): 게임은 이 저작을 Blender 5.2.2 에서 다시 구운 `ranger-library-v3`와 axis-v1 클립 그대로인 `rogue-library-v2`(둘 다 재질 마감)를 쓴다. 아래 v2·axis-v1 기록·파일·해시는 이력으로 그대로 남는다. [hero-library-blender52-finish.md](hero-library-blender52-finish.md)

## 원인(실측)

- 축: `tools/asset-library/blender_merge_mixamo.py`가 Mixamo 쿼터니언을 롤이 다른 Tripo 리그에 그대로 복사했다. Hips·Spine·다리의 로컬 X(Mixamo 굽힘 축)가 이 리그에서는 앞뒤 축이라 무릎 굽힘이 옆꺾임, 상체 숙임이 옆기울기가 된다. 본별 롤 차이는 Hips·Spine 90°, 다리 87–96°, 어깨·팔 최대 177°다(`art-src/ranger/ranger-library-author-report-v2.json`의 `axisRollDeg`).
- 접지: `blender_normalize.py`가 Hips 위치의 수직 성분을 평탄화했다. 공개 v1(`5bbc7e7b…`) 사망 끝 자세는 스킨 최저점이 0.3m 이상 떠 있었고, 구르기도 떴다.
- 방위: 피격·사망·전투 자세 클립이 대기보다 약 −54° 돌아간 방위에서 시작해 전환 때 몸 전체가 스냅했다.

## 교정

| 항목 | 내용 |
| --- | --- |
| 전신 축 리타깃 | 기준 리그(`hero_knight_t1`, 읽기 전용)의 본별 X 축으로 "같은 본 방향 + Mixamo 롤" 가상 rest 를 만들고 모든 회전 키를 q' = C·q·C⁻¹ 로 옮긴다. rest TRS·역바인드는 그대로이며 packer 가 드리프트를 검사한다. |
| 접지 | 수평 루트 이동은 게임 담당이라 0, 수직은 실제 스킨 최저점으로 다시 푼다. 달리기는 지지 단계 최저·공중 단계 최고의 보폭 리듬을 남긴다(최저점 0–0.108m). |
| 리타이밍 | 사망 3.875초 → 1.25초(24fps 30키, 직립→무릎→상체→누움), 피격 0.96초 반응 → 0.5초, 앞구르기 → 게임에 보이는 0.5초(96fps 48키, 키 사이 반 프레임에서도 ±3cm). |
| 백스텝 | 앞구르기의 역재생을 지우고 다리 IK 로 서 있는 뒤로 뛰기를 새로 저작했다(`Dodge_Backward`, 0.5초, 실제로 발이 뜬다). |
| 활(궁수) | v1 소켓(`RangerBowGrip_L`·`RangerDrawNock_R`) 정의를 유지한다. `bow_shoot`는 상체를 과녁 쪽으로 비튼 옆선 자세로 다시 저작했고, 연속 발사 스킬용 `bow_shoot_rapid`(세 번 당김)를 추가했다. 모든 키에서 손목·활 축 오차 0. |
| 런타임 | `player.js`: 활 스킬은 상체 사격 층과 속도 맞춤 다리 층으로 재생하고, `ranger_quickshot`·`gale_hunt`는 rapid 클립과 +0.12·+0.24초 발사에 맞춘 시위 놓기를 쓴다. `actor.js`: 궁수만 렌더 피벗 방향을 시간상수 0.045초로 보간한다. 판정 yaw·위치·난수는 즉시 값 그대로다. |
| 도적 | 같은 리타깃·접지·방위 정렬·백스텝을 `art-src/hero-axis/author_hero_axis_v1.py`로 적용했다. 활·팔 IK 는 없다. 다른 영웅의 기존 클립은 건드리지 않았다. |
| 정체성 | 카드·상단 초상 `/img/ranger-portrait.webp`는 KayKit 갈색 머리 남성이라 현행 3D(초록 머리 엘프 여성)와 달랐다. 게임 로더 그대로 렌더한 `/img/tll/ranger-render-v2.webp`(1122×1402, 다른 영웅 초상과 같은 구도)로 `heroes.js` 참조를 바꿨다. 옛 파일은 저장소에 남겨 두되 참조하지 않는다. |

## 재현

```sh
blender -b --factory-startup --python art-src/ranger/author_ranger_library_v2.py -- asset-library/normalized/hero_ranger_t1.glb asset-library/normalized/hero_knight_t1.glb <out> art-src/ranger/runtime-bow-preview.obj
node tools/art/pack-ranger-library.mjs asset-library/normalized/hero_ranger_t1.glb <out>/ranger-library-anim-v2.glb,<out>/ranger-library-anim-v2-96fps.glb public/models/heroes-next/ranger-library-t1-v2.glb ranger-library-v2 art-src/ranger/author_ranger_library_v2.py
node tools/art/update-ranger-revision.mjs src/data/ranger-library-revision-v2.json

blender -b --factory-startup --python art-src/hero-axis/author_hero_axis_v1.py -- asset-library/normalized/hero_rogue_t1.glb asset-library/normalized/hero_knight_t1.glb <out> rogue
node tools/art/pack-ranger-library.mjs asset-library/normalized/hero_rogue_t1.glb <out>/rogue-library-anim-v1.glb,<out>/rogue-library-anim-v1-96fps.glb public/models/heroes-next/rogue-library-t1-axis-v1.glb rogue-library-axis-v1 art-src/hero-axis/author_hero_axis_v1.py
node tools/art/update-ranger-revision.mjs src/data/rogue-library-revision-v1.json

# 런타임 연속 캡처(로컬 dev 서버 필요, 진단 픽스처)
node tools/art/ranger-motion-capture.mjs <origin> <outDir> after                      # 7개 시퀀스
RANGER_MOTION_ONLY=07 node tools/art/ranger-motion-capture.mjs <origin> <outDir> after # 사망만, 꼬리 260스텝·deathT 기록
node tools/art/ranger-motion-capture.mjs <origin> <outDir> after hero_ranger_t3,avatar_ranger_fox  # 실제 몸체 교체
node tools/art/ranger-portrait-capture.mjs <origin> <out.png> draw                     # 초상 렌더
```

| 파일 | SHA256 |
| --- | --- |
| 원본 `hero_ranger_t1.glb`(변경 없음) | `2c88389c285019a4b2b0e948736f6f01b1a1a173f28b2dcac054981b45e99b23` |
| 원본 `hero_rogue_t1.glb`(변경 없음) | `9d2dab5e01dd9df6b80f6343a1d32820772ca21080468011473893a009ea0539` |
| `public/models/heroes-next/ranger-library-t1-v2.glb` | `7c694b6cdf7987897f042602842328fe94f2f0ffd5ebfd66ede105ae79ad4884` |
| `public/models/heroes-next/rogue-library-t1-axis-v1.glb` | `c24b8eab468924a07c2c23bda9feddc51ea25cc6024321f9e2eccc6e46a88ead` |
| `public/img/tll/ranger-render-v2.webp` | `cb7d2d5263ed7a2049dd5adcd5f99858cf9488235ffc874a52738832214a14d2` |

## 검사

- `test/ranger-library-model.test.ts`: v1 계약(메시·스킨·rest 보존, 활=그립 ≤0.5°, 시위 소켓) + v2 원인 재현(원본 달리기 무릎 굽힘의 60% 이상이 옆 방향)과 교정(정면 굽힘, 옆 성분 45% 미만), 실제 스킨 접지(대기·사격·피격·구르기 중간·사망 끝 ±3cm, 구르기 49시점), 공개 v1 사망 부유 재현, 백스텝이 역재생이 아님·머리가 골반 위, 피격·사망·구르기 시작 방위가 대기와 12° 이내, 만작 상체 비틀기, rapid 세 번 당김.
- `test/rogue-library-axis.test.ts`: 도적 교정본이 원본 SHA 에서 생성된 정확한 파일이고 메시·스킨·rest 가 원본 그대로인지, 원본 달리기 무릎 옆꺾임 재현과 교정본의 정면 굽힘·발 접지, 2·3단계와 까마귀 아바타의 교정 클립 공유.

## 한계(정직한 범위)

- 사망 경계 미검증: 클립은 1.25초이고 `Actor`는 deathT>1.2초부터 몸 전체를 가라앉힌다. 1.2초 시점에 이미 쓰러져 있어야 하지만, 실제 런타임의 deathT 0→1.32 연속 프레임은 아직 없다(`Battle.onPlayerDeath`의 dt×0.3 때문에 기존 캡처는 클립 0.767초에서 끝남). 통합 빌드에서 root 가 확인한다.
- Blender 렌더와 스킨 접지 단위 테스트는 진단 증거다. 런타임 캡처는 실제 앱·Player·카메라·키 입력이지만 적 배치·피해·스킬 개방은 고정 스텝 픽스처라 자연 UI 여정·사람 조작감 증거가 아니다.
- 도적은 Blender 대표 프레임과 단위 테스트만 있고 런타임 연속 캡처는 없다. 궁수 2단계는 Blender, 3단계·여우 아바타는 런타임 몸체 교체 캡처만 있다.
- 실기기(Android GPU·터치·발열) 검증과 공개 호스트 확인은 하지 않았다. 모델 해시·스킨 계약 테스트는 시각 품질 승인을 대신하지 않는다.
