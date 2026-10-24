# 등급 부츠 N/E/L 아트·런타임 계획 (art-plan-gear-appearance.md 6번 덩어리)

요청: `docs/gear-appearance-avatar.md` 5절 3항 — 신발 등급별 발밑 실루엣 차이. 5영웅 공용, 발 본 스킨 단독 파츠, N/E/L 3단계.
상태(2026-10-24): **런타임 부착 경로 구현 완료, 아트 없음**(PC 꺼짐). `src/data/hero-boots.json`의 `boots`가 비어 있어 지금 화면은 이전과 완전히 같다.

## 1. 런타임 경로 설계

기존 구조: 영웅마다 1단계 Mixamo 골격을 공유하고, 몸(N/S=t1, E/U=t2, L=t3, 아바타)은 `swapLibraryHeroBody`(`src/engine/assets.js`)가 같은 이름의 본으로 메시를 다시 묶어 바꾼다. 윤곽광(`gear-accents.js`)은 몸 재질에 훅을 건다. 부츠는 이 경로 옆에 별도 파츠로 붙인다.

| 항목 | 선택 | 이유 |
|---|---|---|
| 데이터 | `src/data/hero-boots.json` (`blade-surge.hero-boots.v1`) | `asset-library/manifest.json`은 모든 항목을 클립을 가진 캐릭터/프롭으로 검증하고 ingest·몬스터 로스터·QA 도구가 순회한다. 클립 없는 파츠를 넣으면 이 소비자들이 깨진다. 아트가 들어오면 항목만 채운다 |
| 항목 형태 | `{ id, tier: N/E/L, path: /models/boots/<id>.glb, triangles, sha256, fit?: { <heroId>: { scale } } }` | `validateBootsData`가 경로 고정, 삼각형 ≤3,000, 단계 중복 금지, SHA 형식을 번들 로드 시 검사 |
| 등급 → 부츠 | 신발 장비 등급 N→N, **S→N**, E→E, **U→E**, L→L | 몸 단계 규칙과 같다(S는 N과, U는 E와 같은 외형 공유). 그 단계 부츠가 없으면 한 단계씩 낮춘다(L→E→N). 신발 미착용·아바타는 부츠 없음 |
| 부착 | `SkinnedMesh`를 영웅 **현재 몸 스킨**의 본 노드·역바인드(`boneInverses`)·`bindMatrix`로 새 `Skeleton`에 묶는다. 본은 `mixamorig` 접두·기호를 무시한 이름(`LeftFoot`)으로 짝짓는다 | 소켓(rigid attach)이 아니라 스킨이라 달리기·구르기·사망 클립을 몸과 똑같이 따라간다. 부츠 본 하나라도 영웅 몸에 없으면 부착 거절 + 경고(기존 몸 유지) |
| 부츠 정점 공간 | 영웅 몸 바인드 공간에 저작 | 역바인드를 부츠 GLB가 아니라 영웅 몸에서 가져오므로, 부츠 정점이 그 공간에 있어야 한다. 이것이 아트 수용 기준 4절의 근거 |
| 몸 교체 | `swapLibraryHeroBody` 끝에서 `refitHeroBoots` 호출 | 몸 개정마다 역바인드가 다르다(궁수 v6 등). 새 몸의 값으로 부츠를 다시 묶는다. 맞지 않으면 부츠를 치운다 |
| 재질 | 영웅 몸과 같은 마감(`cloneCharacterMaterial` + `normalizeLibrarySkinMaterial` + 텍스처 샘플링)의 인스턴스별 복제 | 피격 발광·사망 페이드는 `Player.mats`가 재질을 모으므로 부츠 부착 뒤 `onLibraryBodySwap`을 불러 재수집한다 |
| 사망·해제 | `disposeCharacter`가 모든 SkinnedMesh의 스켈레톤·재질을 정리하므로 부츠도 같이 정리된다. 로드가 늦게 끝나면 `libraryDisposed`·대상 id를 확인하고 버린다 | |
| 호출 지점 | `look.js` `applyLook`: 라이브러리 영웅이고 아바타가 아니면 `syncHeroBoots`, 아니면 `removeHeroBoots` | 장비 외형 토글(아바타 + 장비 외형 표시)·시착도 `applyLook`을 거치므로 같은 경로다. 같은 부츠면 즉시 끝나 프레임 할당이 없다 |

### 몸 발 부분과의 겹침(z-fighting) 방지
검토한 안:
1. **부츠 정점을 법선 방향으로 부풀림 + polygonOffset (구현)**: 부츠 키(bbox 높이)의 1.2%(`BOOTS_INFLATE_RATIO`, 0.35m 부츠 기준 약 4mm)를 로드 시 한 번 복제 지오메트리에 구워 넣고, 재질에 `polygonOffset(-1,-1)`을 준다. 몸 메시와 지오메트리를 건드리지 않아 가장 안전하고, 몸 개정과 무관하게 동작한다.
2. 몸의 발 영역 숨김(발·발끝·정강이 가중치 정점을 셰이더에서 `discard`): `gear-accents.js`가 이미 같은 가중치 마스크(`vGearZone.x`)를 계산한다. 몸 안쪽 면이 보이지 않아 겹침이 원천 차단되지만, 부츠가 발목보다 짧으면 맨살 구멍이 생기고 셰이더 키가 바뀐다. **v2 후보**: 아트가 들어와 부츠 높이가 확정된 뒤 필요하면 적용한다.
3. 몸 메시 편집: 몸 개정이 많아 부적합.

영웅마다 다리 비율이 다르므로 공용 부츠는 `fit.<heroId>.scale`(몸 바인드 공간 원점 기준 균일 배율, 0.5~2)로 맞춘다. 기본 1.

## 2. 아트 수용 기준 (최종 산출물: 스킨드 GLB, 클라우드 후처리 뒤)
- 파일: `public/models/boots/boots_n.glb`, `boots_e.glb`, `boots_l.glb`. 오른발·왼발 한 메시에 함께(재질 1개).
- 삼각형: 단계당 2,000 이하 목표, 하드 상한 3,000(`BOOTS_TRIANGLE_LIMIT`). 한 켤레.
- 텍스처: 2K 1장(PBR 베이스컬러 + 필요하면 ORM). 8K 금지.
- 본: Mixamo 하체 `LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, (Right 동일)` + 부모 `Hips`를 포함. 가중치는 정강이 아래쪽 ~ 발끝만 실리고 `LeftUpLeg`는 0에 가깝다. 본 이름은 `mixamorig` 접두 유무와 무관(런타임이 정규화)하지만 영웅 골격에 없는 이름은 금지(예: `neutral_bone`, 접두 다른 본 — t4 rogue_t2u가 이 문제였다).
- 정점 공간: **knight_t1 바인드 자세 기준**(발이 바닥 y=0, 발끝 +z). 발목 높이는 바닥에서 약 0.10m(knight 키 1.8m 기준), 부츠 상단은 정강이 중간(바닥 위 0.30~0.38m)을 넘지 않는다. 원점 = 두 발 사이 바닥 중심.
- 스케일: 1 단위 = 1m. 영웅별 보정은 데이터의 `fit`으로 하고 GLB는 knight 기준 하나만 만든다.
- 실루엣: N 평범한 가죽 장화, E 금속 보강 + 파란 포인트, L 발목 장식 + 주황 포인트(등급색은 `RARITY_INFO`). 단계끼리 실루엣(높이·밑창 두께·발목 장식)이 구분돼야 한다(색만 다르면 실패). 발이 지나치게 커져 이동 판독·접지를 가리지 않게 한다(발 길이 ≤ 몸 발의 1.25배).
- 접지: 구르기·사망·달리기에서 부츠가 바닥을 뚫지 않을 것(`tools/art/measure-body-contact.mjs`).

## 3. PC Tripo 브리프 요약 (실행본: `art-src/boots/BRIEF.md`)
부츠만 따로 만든 메시는 Mixamo/Tripo 휴머노이드 리그를 받을 수 없다. 그래서 PC는 **리그 없는 부츠 한 켤레**(생성 55 + 리토폴 35 = 90 크레딧/건, 리그 20 절약)를 만들고, 스킨 가중치는 클라우드 Blender가 knight_t1 몸의 발 영역에서 전이한다. 대안(b안): 부츠를 신은 전신 캐릭터를 t4와 같은 흐름(H3.1, 리토폴 11k, Humanoid+Mixamo)으로 만들어 클라우드가 다리 아래만 잘라내는 방법 — 가중치가 이미 있으나 크레딧이 건당 110이고 몸이 섞여 와서 정리가 더 든다. a안이 실패하면 b안.

원화 프롬프트 초안(Codex CLI 이미지 생성, 공통: 흰 단색 배경, 정사영 3/4 위에서 본 한 켤레 + 옆모습, 그림자·글자 없음, 고품질 3D 렌더풍 치비 비율, 과한 금속 광택 없음, 1:1):
- **N**: "A pair of plain brown leather adventurer boots, ankle-high, simple stitched seam, thin dark sole, small round toe, no metal, no glow, game asset, stylized chibi 3D render, white background."
- **E**: "A pair of mid-calf steel-reinforced leather boots, riveted steel toe cap and shin plate, thick dark sole, thin sky-blue rune line along the ankle strap, game asset, stylized chibi 3D render, white background."
- **L**: "A pair of tall ornate legendary boots, golden-orange trimmed dark plate greaves, winged ankle fins, thick layered sole, glowing orange gem on each ankle, game asset, stylized chibi 3D render, white background."

## 4. 클라우드 후처리 순서
1. PC 결과 받기(`art/boots-pc-results`), `check` 대신 삼각형·재질 수 확인.
2. Blender: knight_t1 정규화 몸을 바인드 자세로 열고 부츠 한 켤레를 발 위치·스케일에 정렬(발목 높이·원점 4절 기준).
3. 몸의 `LeftUpLeg~LeftToeBase`·`Right…` 정점에서 가중치 전이(Data Transfer, 가장 가까운 면 보간) → 가중치 정리(`blender_clean_weights.py` 계열) → 영웅 본 65개 이름 그대로 Armature에 묶음.
4. 2K 텍스처 내보내기(스킨드 GLB, 애니메이션 0) → 단계별 3개.
5. `src/data/hero-boots.json`에 항목(sha256·삼각형) 추가, 파일을 `public/models/boots/`에 배치.
6. 검증: 영웅 5명 × N/E/L 로비·전투 390·1280 촬영, 구르기·사망 접지, z-fighting 육안(발목·발등), 몸 교체(E→L) 뒤 재결합, face-audit 영향 없음. 필요하면 영웅별 `fit.scale` 조정. 실기기는 남은 게이트.
