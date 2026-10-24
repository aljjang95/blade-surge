# 등급 부츠 런타임 설계와 아트 수용 기준 (art-plan-gear-appearance.md 6번 덩어리)

요청: `docs/gear-appearance-avatar.md` 5절 3항 — 신발 등급별 발밑 실루엣 차이.
상태(2026-10-24): **런타임 부착 경로 구현 완료, 아트 없음**. `src/data/hero-boots.json`의 `boots`가 비어 있어 지금 화면은 이전과 완전히 같다.
**PC Tripo 작업 브리프는 `art-src/t5-pc/PC_BRIEF.md` A절**(브랜치 `claude/blade-art-t5-brief`)이 정본이다. 이 문서는 런타임 설계와 그 브리프가 따라야 할 수용 기준만 둔다.

## 1. 확정된 아트 계약 (t5 브리프 A절)
- 리그 없는 **정적 메시 한 짝(오른발)**, GLB 텍스처 2K, 삼각형 약 3,000, 발목 위 짧은 목(정강이 1/3 이하)까지.
- 등급 매핑: `boots_n` = S, `boots_e` = E·U, `boots_l` = L. **N 등급은 부츠 없음**(몸의 원래 발).

## 2. 런타임 경로 (`src/engine/hero-boots.js`)
| 항목 | 선택 | 이유 |
|---|---|---|
| 데이터 | `src/data/hero-boots.json` (`blade-surge.hero-boots.v1`), 항목 `{ id: boots_n/e/l, grades: [...], path: /models/boots/<id>.glb, triangles, sha256 }` | `asset-library/manifest.json`은 모든 항목을 클립 있는 캐릭터/프롭으로 검증하고 ingest·로스터·QA 도구가 순회한다. 파츠를 넣으면 이 소비자들이 깨진다. `validateBootsData`가 경로 고정·삼각형 ≤3,200·등급 중복 금지·SHA를 번들 로드 시 검사 |
| 등급 → 부츠 | `pickBootsEntry(rarity)`: 그 등급을 가진 항목, 없으면 null(원래 발) | 낮은 단계로 대체하지 않는다(예측 가능). 신발 미착용·아바타도 부츠 없음 |
| 부착 | 정적 한 짝을 **x 반전 복제(감김 뒤집기 포함)** 해 두 짝을 한 지오메트리로 합친 `SkinnedMesh` 하나(드로우콜 1). 본 슬롯 0 = `RightFoot`, 1 = `LeftFoot`(mixamorig 접두·기호 무시), 정점은 해당 슬롯에 가중치 1 | 달리기·구르기·사망 클립을 몸 스킨과 같은 수학으로 따른다. 본 로컬축을 추측하지 않으려고 Object3D 부모 방식 대신 1본 강체 스킨을 쓴다. 역바인드·`bindMatrix`는 **영웅 현재 몸 스킨에서** 복제 |
| 크기 자동 | `scale = 영웅 발목 높이 ÷ 부츠 발목 높이(−bbox.min.y)`. 영웅 발목 높이 = `RightFoot` rest 위치 y − 몸 지오메트리 바닥 y. 범위 0.3~3 밖이면 거절 | 영웅마다 키가 달라도 밑창이 바닥에 닿고 발목이 관절에 맞는다 |
| 몸 교체 | `swapLibraryHeroBody` 끝에서 `refitHeroBoots` | 몸 개정마다 역바인드·발목 높이가 다르다. 다시 계산하고, 발 관절이 없거나 계약에 맞지 않으면 부츠를 치우고 원래 발을 되돌린다 |
| 재질·사망 | 영웅 몸과 같은 마감의 인스턴스별 복제(`createBootsMaterial`). 부착 뒤 `onLibraryBodySwap`으로 `Player.mats`(피격 발광·사망 페이드)를 재수집 | `disposeCharacter`가 모든 SkinnedMesh의 스켈레톤·재질을 정리한다. 로드가 늦게 끝나면 `libraryDisposed`·대상 id를 확인해 버린다 |
| 호출 | `look.js` `applyLook`: 라이브러리 영웅이고 아바타가 아니면 `syncHeroBoots`, 아니면 `removeHeroBoots`. 장비 외형 토글·시착도 같은 경로 | 같은 부츠면 즉시 끝나 프레임 할당 없음 |

### 원래 발 숨김 (z-fighting 방지)
검토한 안:
1. **몸 셰이더 `discard` (구현)**: `gear-accents.js` 몸 재질 훅에 발·발끝 본(`LeftFoot/RightFoot/LeftToeBase/RightToeBase`) 가중치 합 > 0.5인 조각을 버리는 코드를 추가했다(유니폼 `gearHideFeet`, 부츠 부착·제거 때 `setGearFeetHidden`이 켜고 끈다). 정강이(`*Leg`) 가중치는 남아 부츠 목 아래로 다리가 이어진다. 몸 메시·지오메트리·역바인드를 건드리지 않아 기존 몸 개정 구조(재결합 몸 교체)와 충돌하지 않고, 훅은 이미 윤곽광으로 재질마다 한 번만 걸린다(재컴파일은 장비 변경이 아니라 첫 훅 때만, 캐시 키 `gear-rim-v2`).
2. 몸 메시에서 발 정점 삭제: 몸 개정마다 다시 해야 해서 제외.
3. 부츠만 부풀리기: 보조 안으로 같이 구현(부츠 키의 1%만큼 법선 방향 + `polygonOffset(-1,-1)`). 훅이 걸리지 않는 재질에서도 겹침이 줄어든다.
한계: 몸 그림자는 숨긴 발 모양 그대로 남는다(부츠 그림자와 거의 겹침). 실기기·블룸 아래 확인은 남은 게이트.

## 3. 수용 기준 (클라우드가 t5 결과 GLB를 정규화해 게임에 넣는 최종 형태)
PC 결과의 축·크기는 Tripo 출력 그대로일 수 있으므로 클라우드 Blender 단계에서 아래 계약으로 맞춘 뒤 `public/models/boots/<id>.glb`에 둔다. 런타임은 `bootsGeometryContract`로 이 범위를 검사하고 어기면 경고 후 부착하지 않는다.
- **원점 = 발목 관절**(발 관절 `RightFoot`의 위치). 영웅 몸 오른발과 같은 쪽(오른발)을 만든다.
- **축**: +Y 위, +Z 발끝(앞), 밑창이 수평. 영웅 몸의 바인드 자세(발이 바닥에 평행)와 같은 방향.
- **스케일**: 1 단위 = 1m. 밑창 최저점 y ∈ [−0.22, −0.03](발목에서 바닥까지), 윗단 y ∈ (0, 0.34]. 이 범위 안이면 밑창 높이가 곧 "부츠 발목 높이"가 되어 영웅별 자동 배율의 기준이 된다.
- 오른발 한 짝, 메시 1개, 재질 1개(2K 텍스처 1장). 삼각형 ≤ 3,200(데이터 상한), 목표 약 3,000. 스킨·본 없음.
- 실루엣: 세 단계의 높이·밑창 두께·발목 장식이 구분될 것(색만 다르면 실패). 부츠 발길이는 영웅 발의 약 1.25배 이하(이동 판독·접지를 가리지 않게).
- 접지: 구르기·사망·달리기에서 밑창이 바닥을 뚫거나 뜨지 않을 것(`tools/art/measure-body-contact.mjs`).

## 4. 클라우드 후처리 순서
1. `art/t5-pc-results`에서 `boots_n/e/l` `model.glb`를 받아 삼각형·재질 수 확인.
2. Blender 헤드리스: 오른발 정렬(원점·축·스케일, 3절) → 밑창 평탄 확인 → 스킨 없는 GLB 내보내기(텍스처 2K 유지).
3. `public/models/boots/boots_n.glb` · `boots_e.glb` · `boots_l.glb` 배치, `src/data/hero-boots.json`에 항목 추가(`grades`: n=[S], e=[E,U], l=[L], 삼각형·sha256).
4. 검증: 영웅 5명 × S·E·U·L 로비·전투 390·1280 촬영, 구르기·사망 접지, 발목·발등 겹침(z-fighting) 육안, 몸 교체(E→L) 뒤 재결합, 신발 해제·아바타 전환 때 원래 발 복귀. 영웅별 어긋남이 있으면 발목 높이 산정(`heroAnkleHeight`)을 먼저 점검. 실기기는 남은 게이트.
