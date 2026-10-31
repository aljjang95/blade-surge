# 아바타 풀셋 (던파식, 2026-10-27)

대표님 요청: 투구·갑옷을 몸 위에 입히니 착용이 어색해 디자인이 떨어진다. 외형은 아바타로, 풀셋에는 기능 효과도.

## 구조

- 방어구·반지·신발은 능력치 장비로만 남고 몸 외형을 바꾸지 않는다(`docs/WEAPON_GLOW.md`). 무기만 보이고 강화 단계에 따라 빛난다.
- 아바타 = 머리·상의·하의·외투 네 부위(`AVATAR_PARTS`)가 한 몸으로 만들어진 전신 몸체. 부위 메시를 몸에 따로 입히지 않는다. 체형과 어긋나 깨지는 문제를 처음부터 피하려는 것이다.
- 부위는 수집 단위다. 이벤트·업적은 `economy.grantAvatarPart(avatarId, part)`로 부위 하나를 주고, 네 부위가 모이면 풀셋으로 소유된다. 모으는 중인 부위는 `s.avatars.parts`에 저장되고, 저장 정규화가 알 수 없는 값과 네 부위가 다 찬 비정상 값을 버린다(부위 저장만으로 소유를 만들 수 없다).
- 보석 구매(`buyAvatar`, 2,980)와 유료 상품은 풀셋을 한 번에 준다.

## 풀셋 효과

착용 중인 영웅에게만 적용된다. 장비 외형 표시를 켜도 착용은 유지되므로 효과도 유지된다.

| 효과 | 값 | 적용 위치 |
|---|---|---|
| 이동속도 | +5% | `withAvatarSpeed`: 출격(`battle-base.start`)과 전투 중 레벨업 재계산(`rpg-battle`) 모두(혼자 하는 전투) |
| 줍기 범위 | +30% | `player.magnetMul` |

- 공격·체력·방어·드랍·골드·경험치는 건드리지 않는다. 그래서 전투력 계산과 `sim:90d` 진행 밴드에 영향이 없다(sim은 아바타를 모델링하지 않는다).
- 대안이던 '스킬 +1'과 '골드 +5%'는 유료 상품이 전투·경제 우위를 갖게 되어 고르지 않았다.
- 기존 아바타 10종도 풀셋으로 보고 같은 효과를 준다(설명 문구 갱신).
- 파티 모드는 장비를 싣지 않는 기존 규칙대로 효과를 적용하지 않는다.

## 유료 풀셋 지급 계약 (BM 레인과 공유)

- 상품 id: `avatar_fullset_<heroId>_v1` (`avatarFullsetSku(heroId)`). 가격 후보 ₩14,900, 카탈로그·결제·환불·상점 UI는 BM 레인 소유.
- 지급: 결제 확인 뒤 `economy.grantAvatarFullset(heroId)`만 부른다. 영웅마다 지급할 아바타는 `AVATAR_PREMIUM_BY_HERO`에 있고, 몸체 자산이 준비된 영웅만 들어간다. 준비 전이면 `{ ok: false, reason: 'not-ready' }`.
- 반환 `{ ok, avatarId, already }`. 이미 소유면 `already: true`로 중복 지급하지 않는다(보상 처리는 BM 레인).
- 저장 실패면 소유를 되돌리고 `{ ok: false, reason: 'storage' }`. 영웅을 소유하지 않았으면 `{ ok: false, reason: 'locked' }`(결제 전에 BM이 같은 값을 확인).
- **유료 SKU를 켜기 전 필수(PR #321 리뷰):** `avatars`는 서버 소유 키(`src/shared/state-hash.js` `SERVER_OWNED_KEYS`)라 서버 권위 계정에서는 클라이언트 `grantAvatarFullset`·`grantAvatarPart` 결과가 다음 동기화 때 서버 문서로 덮인다. 결제 지급과 부위 지급은 서버 명령(`src/shared/v1-ops.js`, `worker/v1`)으로 영수증 검증 뒤 같은 규칙을 적용해야 하고, 클라이언트에서 직접 부르는 것은 로컬 권위 계정의 개발·테스트 경로로만 쓴다. 또 로컬 저장 가져오기(`worker/v1/import.ts`가 `normalizeSave` 재사용)는 `avatars.owned`를 아바타 id 존재만으로 받으므로, 유료 풀셋 SKU 활성화 전에 서버 지급 기록과 대조해야 한다(기존부터 있던 구조).

## 외형 제작

- 기존 아바타와 같은 경로: Codex 이미지 생성 컨셉 → 무기 없는 T포즈 원화 → Tripo Studio H3.1 이미지→3D → 리토폴로지(약 10k 삼각형) → 자동 리그(Mixamo 프리셋) → `tools/asset-library/blender_retarget_tier.py`로 영웅 1단계 골격에 다시 묶기(클립 공유) → `assets:ingest`(`--avatar`) → `assets:verify` → 초상 굽기(`tools/art/avatar-portrait/render.mjs`).
- 첫 대상: 광전사 드라칸 풀셋 1종. 운영 화면에서 확인한 뒤 다른 영웅으로 넓힌다.

## 입기/벗기 실시간 전환 (2026-10-29)

대표님: "착용했을 때 변화가 자연스러워야, 탈착이 실시간으로 보여야 사람들이 좋아한다."

- 영웅 화면 옷장(`src/expansion/wardrobe.jsx`)은 캔버스를 영웅 단위로 유지한다. 아바타 입기·벗기·미리보기는 인스턴스를 다시 만들지 않고 `applyLook` 재적용으로 같은 인스턴스 안에서 몸만 바꾼다(`applyLibraryHeroBody`). 믹서·재생 중 동작·무기·강화 빛(광륜·불씨)이 그대로라 포즈와 애니메이션 시간이 이어진다. 장비가 바뀔 때만 인스턴스를 새로 만든다.
- 전환 연출은 빛 실루엣 와이프 0.4초(`src/engine/body-wipe.js`): 발밑→머리로 빛띠가 오르며 실루엣이 밝아지고, 가장 밝은 순간 몸을 바꾼 뒤 걷힌다. 가산 셰이더 평면 하나, 화면 흔들림·카메라 이동 없음. 몸이 아직 받아지지 않았으면 최대 1.2초 밝은 채 기다린다. 동작 줄이기면 연출 없이 바로 바꾼다.
- 프리로드(`src/engine/avatar-preload.js`): 영웅 화면에 들어오면 그 영웅의 판매·보유 아바타 몸을 보이는 것·고른 것 순서로 하나씩 받고, 옷장·본 화면 GL 컨텍스트에 텍스처를 한 프레임에 하나씩 미리 올린다. 상한 4개(최근 영웅 순)를 넘으면 오래된 것부터 `releaseAvatarBody`로 해제한다. 입은 인스턴스가 있는 몸, 영웅 기본 몸(`bodyAvatar`), 공유 클립 원본은 해제하지 않는다(`assets.js` 몸체 사용 수).
- 로비 쇼케이스도 아바타 입기/벗기·장비 외형 표시 전환은 `app.refreshShowcaseAvatar`로 같은 인스턴스에서 몸만 바꾼다(재생성·기둥 연출 없음).
- 상점 아바타 카드의 **입어 보기**: 구매 없이 모달 3D로 원래 모습→입어 본 모습 와이프를 보여 주고 '원래 모습 보기'로 오간다. 저장·보석·착용·가격·결제 플래그는 건드리지 않으며, 닫으면 미리보기 루트를 정리한다.
- 전투 입장은 기존대로 `displayAvatar` → `preloadHeroBody` → `Player` `applyLook`이라 영웅 화면에 보이던 몸과 같다(`test/avatar-body-cache.test.ts`, `tools/avatar-tryon-qa.mjs`).
- 검증: `node tools/avatar-tryon-qa.mjs <출력폴더>` — 844×390 영상·전후 스크린샷·전환 중 프레임 간격(frames.json). 헤드리스 swiftshader라 프레임 수치는 상대 비교용이며 실기기 GPU 성능 증거가 아니다.
