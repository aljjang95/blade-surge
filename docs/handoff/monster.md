# 몬스터·던전 정체성 레인 인계 (blade-monster#identity, 2026-10-29)

지휘 세션: session_01H8mx3U9qK3w3SjT5hPBKSr. 이 레인 세션: session_01H8mx3Qmgim4GfXxszFJ9VJ → 2026-10-29 aljjang95 계정 session_014oud8HPNiGnSaVgRW6tjZe(보드 레인 `aj-monster`)가 이어받음. 2차(blade-monster#identity2, 지휘 session_014oud8EofNnQrhudKTfesHw)는 session_014oud8DMA9RDDKZdCbHpfeW(보드 레인 `aj-monster2`).
대표님 피드백(2026-10-28): "던전 몬스터들이 컨셉 없이 정체성 없는 애들로만 나온다 → 스테이지별 몬스터·던전 생김새와 정체성".

## 끝난 것 (운영 배포·readback 완료)
| PR | 내용 | main |
|---|---|---|
| #360~#368 | 1~7장 의상(뼈 소켓 소품·색 재배치)·장별 던전 소품 키트·조명 등급, 1·2장 Tripo 몸 6종 | 54b7201 |
| #369 | 1·2장 일반 방 주력을 전용 몸 갈래 10종으로, 2장 가시 방벽(나무 몸) 제거, 1장 망각의 잔향 판정 | 9ce8f98 |
| #372 | 3장 사서·검열관·오르딘(frost_midboss), 일반 방 93~100% | e34503e |
| #379 | 4장 따개비 수부·미끼등 아귀·등대지기 마렌(tide_midboss), 촉수 낚아채기 원본 id 해석 | 1764d41 |
| #393 | 5장 닌자·병사·주술사·아스텔, 6장 승객 잔향·빈 의자의 증인 | 0da70b4 |
| #414 | 7장 해골 시민·굽쇠 주술사 갈래(일반 방 88~100%) | f38a10e |
| #415 | 가독성 소품: 4장 빛주머니 아귀(큰 주머니), 5장 견습 닌자(작은 키·목검)·새벽불 주술사(화로 장대), 6장 짐꾼(가방)·길 잃은 승객(서리빛 등) | 3d44ce6 |
| 2차 | 가독성 2차: 6장 서두르는(회중시계)·바닷길(노·부표)·이끼(버섯 갓) 승객, 7장 늦은 시민(붉은 목도리+손종)·짐꾼(밧줄 타래)·폭음 시민(불 붙은 종 폭약통), 울림 잔향(음파 고리)·떠도는 조율사(풍경 장대). 6장 심층 원정(별빛서고 등)도 경로 고향 장 몸+6장 승객·의상(`speciesStageOf`, 전술 공략 표식은 원래 종 id로 비교). 5장 소환 졸병(던전 대장의 환영 사냥개·종의 잔영·혜성 불씨·해골 병사, 주술사의 부유 촉수·꼬마 오크)도 5장 몸 | e39c5b4 (#419, 운영 readback 2026-10-29 21:18 KST) |

공통 구조: `src/data/stages.js` `CHAPTER_SPECIES`(장별 원본 id → 새 id, 전투 편성·소환만 교체, 보상 rosterFor 불변. 소환 전용 갈래는 도감에 싣지 않는다) · `speciesStageOf`(캠페인 관문과 6장 심층 원정의 장·경로 던전) · `CHAPTER_SPECIES_DEFS`(원본 정의 복사 + 이름·모델) · `speciesSourceId`(원본 id 역참조) · `BODY_TINTS`·`OPAQUE_SPIRIT_BODIES`. 몸·소켓은 `src/data/monster-roster.js`, 의상은 `src/data/chapter-dress.js`, 도감은 `src/data/lore.js`(전투 편성에 나오는 id만), 에셋 출처는 `docs/asset-library/ch*-tripo.md`.

## 진행 중
- 없음(1~7장 전용 몸 전부 운영 반영).

## 남은 일
- 실기기 GPU 화면 확인(지금까지 swiftshader 근접 캡처뿐).
- 가독성: 2차로 6·7장 같은 몸 갈래까지 실루엣 소품을 붙였다(근접 캡처 `work/qa/dress2`, swiftshader). 실기기 GPU에서 소품 크기·발광 확인은 남음.
- 다른 장 심층 원정(1~5장)·표준 원정은 설계대로 전용 로스터·옛 몸 그대로다(6장 심층만 장 몸). 1~4·6·7장의 던전 대장 소환 졸병 중 옛 몸이 남은 자리는 점검하지 않았다(5장만 전부 확인·테스트).
- Tripo HD 원본 유실: 2장 장인, 3장 검열관, 4장 아귀·마렌(문서 기록).

## 배포 방법
PC: `C:\Work\tasks\logs\blade-mon-deploy.ps1`의 SHA·로그 이름을 바꾼 사본을 Start-Process로 띄움(깨끗한 detached worktree에서 `node tools/deploy.mjs --auth=wrangler`, 로그 `C:\Work\tasks\logs\blade-mon-<sha7>.log`, 끝에 `DEPLOY-EXIT`). readback은 `https://blade.tllhouse.com/version.json`.
