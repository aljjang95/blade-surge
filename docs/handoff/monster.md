# 몬스터·던전 정체성 레인 인계 (blade-monster#identity, 2026-10-29)

지휘 세션: session_01H8mx3U9qK3w3SjT5hPBKSr. 이 레인 세션: session_01H8mx3Qmgim4GfXxszFJ9VJ.
대표님 피드백(2026-10-28): "던전 몬스터들이 컨셉 없이 정체성 없는 애들로만 나온다 → 스테이지별 몬스터·던전 생김새와 정체성".

## 끝난 것 (운영 배포·readback 완료)
| PR | 내용 | main |
|---|---|---|
| #360~#368 | 1~7장 의상(뼈 소켓 소품·색 재배치)·장별 던전 소품 키트·조명 등급, 1·2장 Tripo 몸 6종 | 54b7201 |
| #369 | 1·2장 일반 방 주력을 전용 몸 갈래 10종으로, 2장 가시 방벽(나무 몸) 제거, 1장 망각의 잔향 판정 | 9ce8f98 |
| #372 | 3장 사서·검열관·오르딘(frost_midboss), 일반 방 93~100% | e34503e |
| #379 | 4장 따개비 수부·미끼등 아귀·등대지기 마렌(tide_midboss), 촉수 낚아채기 원본 id 해석 | 1764d41 |

공통 구조: `src/data/stages.js` `CHAPTER_SPECIES`(장별 원본 id → 새 id, 전투 편성만 교체, 보상 rosterFor 불변) · `CHAPTER_SPECIES_DEFS`(원본 정의 복사 + 이름·모델) · `speciesSourceId`(원본 id 역참조) · `BODY_TINTS`·`OPAQUE_SPIRIT_BODIES`. 몸·소켓은 `src/data/monster-roster.js`, 의상은 `src/data/chapter-dress.js`, 도감은 `src/data/lore.js`(전투 편성에 나오는 id만), 에셋 출처는 `docs/asset-library/ch*-tripo.md`.

## 진행 중
1. **PR #393 5·6장**(claude/tripo-ch5-ch6-ingest): 5장 닌자·병사·주술사·아스텔(crown_midboss) 일반 방 100%, 6장 승객 잔향 41~63% + 고향 장 Tripo 몸 잔향(`chapterSpeciesSwap`), 빈 의자의 증인(homecoming_midboss). 리뷰(Codex·Sonnet) 막는 지적 없음, 망각의 잔향은 `isSkeletalSpecies`(원본 종이 해골일 때만)로 정리. main #409(레벨 곡선) 합친 뒤 check·sim 재확인 중 → 머지 → PC 배포 → readback.
2. **7장 해골 시민·굽쇠 주술사**(claude/tripo-ch7-ingest, #393 위에 쌓음): 연결 진행 중. #393 머지 뒤 main 합치고 PR.

## 남은 일
- 실기기 GPU 화면 확인(지금까지 swiftshader 근접 캡처뿐).
- 가독성 약한 갈래: 6장 청록 조명에서 승객 갈래 몸빛 차이, 5장 견습 닌자·새벽불 주술사(색만 다름), 4장 빛주머니 아귀 소품 작음.
- 6장 심층 원정(dungeon 없는 스테이지)은 고향 장 몸 교체가 빠짐, 5장 tribunal 경로는 일부 옛 몸이 섞임(비치명).
- Tripo HD 원본 유실: 2장 장인, 3장 검열관, 4장 아귀·마렌(문서 기록).

## 배포 방법
PC: `C:\Work\tasks\logs\blade-mon-deploy.ps1`의 SHA·로그 이름을 바꾼 사본을 Start-Process로 띄움(깨끗한 detached worktree에서 `node tools/deploy.mjs --auth=wrangler`, 로그 `C:\Work\tasks\logs\blade-mon-<sha7>.log`, 끝에 `DEPLOY-EXIT`). readback은 `https://blade.tllhouse.com/version.json`.
