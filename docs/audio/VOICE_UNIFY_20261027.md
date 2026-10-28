# 보이스 통일 (2026-10-27)

대표님 지적: 직업별 TTS에 영어·한국어가 섞이고 목소리가 달라진다. 결과: **전 153개 한국어, 소유자(직업 5·아나운서 1·공용 보스 3·챕터 보스 14)당 목소리 1개.**

## 조사 결과 (변경 전, faster-whisper small 전수 받아쓰기)
- 영어 파일 35개(1.5초 이상 기준): 아나운서 27개(welcome, floor_*, boss_found/kill/appear/phase/enrage, enh_*, set_*, ult 등) + 보스 12개(boss_warlord/demon/dragon_*) 전부 영어. 영웅 대사 100개는 한국어였으나 짧은 기합(atk/fin/hurt)은 목소리가 매번 흔들려 ja/en으로 인식됨.
- 런타임 경로: 영어/한국어 파일을 고르는 접미사·폴백은 없다(`audio.voice(name)`가 `/sfx/voice/<name>.mp3` 하나만 부름). 섞임은 파일 내용 자체였다. 영웅 대사(한국어)와 아나운서(영어)가 한 전투에서 연달아 나오는 것이 "섞임"의 정체.
- kit를 빌리는 영웅: blackcat → ranger 보이스, werewolf → barbarian 보이스(`voiceId`). 별도 파일 없음.

## 정한 목소리 (Fish Audio S2.1 Pro 계열, ICL 레퍼런스 1개 고정)
| 소유자 | voice id | 레퍼런스 |
|---|---|---|
| knight | `fish-icl:hero-knight` | `public/sfx/voice/hero_knight_select.mp3` |
| barbarian | `fish-icl:hero-barbarian` | `public/sfx/voice/hero_barbarian_select.mp3` |
| mage | `fish-icl:hero-mage` | `public/sfx/voice/hero_mage_select.mp3` |
| rogue | `fish-icl:hero-rogue` | `public/sfx/voice/hero_rogue_select.mp3` |
| ranger | `fish-icl:hero-ranger` | `public/sfx/voice/hero_ranger_select.mp3` |
| announcer | `fish-icl:announcer` | `tools/voice/refs/narrator.mp3` |
| boss_warlord | `fish-icl:boss-warlord` | `tools/voice/refs/boss_warlord.mp3` |
| boss_demon | `fish-icl:boss-demon` | `tools/voice/refs/boss_demon.mp3` |
| boss_dragon | `fish-icl:boss-dragon` | `tools/voice/refs/boss_dragon.mp3` |
| boss_c1_mid | `fish-lib:a9574d6184714eac96a0a892b719289f` | 세렌 세렌(남) · Fish 라이브러리 reference_id `a9574d6184714eac96a0a892b719289f` |
| boss_c1_fin | `fish-lib:bb07cfc53e0f4e3d91ee823a825c35d4` | 에일른 에일른(남·노년) · Fish 라이브러리 reference_id `bb07cfc53e0f4e3d91ee823a825c35d4` |
| boss_c2_mid | `fish-lib:7b0e100da67d49ad81bd63a407d2f964` | 이그란 이그란(남·노년) · Fish 라이브러리 reference_id `7b0e100da67d49ad81bd63a407d2f964` |
| boss_c2_fin | `fish-lib:fa7d528141974d3ba794e4482b153dc6` | 발드 발드(남) · Fish 라이브러리 reference_id `fa7d528141974d3ba794e4482b153dc6` |
| boss_c3_mid | `fish-lib:73da877014f349c0ad3eb136c7f1a0c7` | 오르딘 오르딘(남) · Fish 라이브러리 reference_id `73da877014f349c0ad3eb136c7f1a0c7` |
| boss_c3_fin | `fish-lib:2f06c7a428e9431fadd60af4dfe91763` | 이셀 이셀(여) · Fish 라이브러리 reference_id `2f06c7a428e9431fadd60af4dfe91763` |
| boss_c4_mid | `fish-lib:ff2945cbfd274c85b440bd39d8cb3729` | 마렌 마렌(여) · Fish 라이브러리 reference_id `ff2945cbfd274c85b440bd39d8cb3729` |
| boss_c4_fin | `fish-lib:d4c65d5860504eb197b6943c3ff0f289` | 네레이스 네레이스(남) · Fish 라이브러리 reference_id `d4c65d5860504eb197b6943c3ff0f289` |
| boss_c5_mid | `fish-lib:29da56534ac84ccd81092be4359a1639` | 아스텔 아스텔(남) · Fish 라이브러리 reference_id `29da56534ac84ccd81092be4359a1639` |
| boss_c5_fin | `fish-lib:d5a885f492854e068d8a72e14c851771` | 빈 왕관 빈 왕관(무성·낮게) · Fish 라이브러리 reference_id `d5a885f492854e068d8a72e14c851771` |
| boss_c6_mid | `fish-lib:ddda1d00f3684054a7e971b2dde89b5f` | 빈 의자의 증인 빈 의자의 증인(중성) · Fish 라이브러리 reference_id `ddda1d00f3684054a7e971b2dde89b5f` |
| boss_c6_fin | `fish-lib:9aae54921dd944948ee08d35f6b5f984` | 고립의 잔향 고립의 잔향(중성) · Fish 라이브러리 reference_id `9aae54921dd944948ee08d35f6b5f984` |
| boss_c7_mid | `fish-lib:061a013646d04f0297560d4354d595fd` | 오르벤 오르벤(남) · Fish 라이브러리 reference_id `061a013646d04f0297560d4354d595fd` |
| boss_c7_fin | `fish-lib:35856f20bd4a4896af91cee863519e6a` | 카델 카델(남·거인) · Fish 라이브러리 reference_id `35856f20bd4a4896af91cee863519e6a` |

- 영웅: 출시된 한국어 선택 대사(`hero_<id>_select`)를 레퍼런스로 재사용(기존 좋은 목소리 1순위). 선택 대사는 다시 만들지 않음.
- 아나운서·보스: 기존 영어판과 같은 캐릭터 레퍼런스(`tools/voice/refs/`)로 한국어 생성. 라이브러리 유명인 보이스는 쓰지 않음.
- 호출: Cloud TLL 프록시 `/p/fish/v1/tts`, 모델 헤더 `s2.1-pro-free`(유료 `s2.1-pro`는 API 크레딧 0으로 402), 포맷 mp3 직출력, 후처리 없음.
- 호출 수 172회(재생성 106개 + ASR 불합격 재시도), 비용 0(무료 티어).
- 유지 47개: 기존 한국어 대사 중 ASR 일치도가 충분한 것 + 선택 대사 5개.
- 챕터 보스 14명(lore.js CHAPTER_LORE): 보스마다 라이브러리 보이스 1개(유명인·캐릭터 클론 제외, 영웅과 겹치지 않음). 파일 `boss_c<장>_<mid|fin>_appear`, 런타임은 `src/engine/boss-voice.js`(`bossAppearVoiceName`)가 X-5/X-10 관문에서만 이 파일을 부르고, 그 밖은 기존 `${bossKey}_appear`. 2페이즈·광폭화·사망은 공용 보스 파일 그대로(챕터 보스 전용 대사는 이번 범위 밖).
- 대사 변경: 광전사 fin0 `으아아아!`→`박살이다!`, 실바 fin0 `꿰뚫어라!`→`받아라!`(비어휘 외침이 ASR·발음 모두 불안정), boss_appear `보스가 나타났다!`.

## 증명
- `node tools/voice/voice-audit.mjs` / `bun test test/voice-unify.test.ts`: 영어 0건, 목소리 2개 이상 소유자 0건, 파일·해시·계획 대사·레퍼런스 해시 일치.
- ASR 표본(`tools/voice/voice-asr.json`): 1.5초 이상 65개가 한국어(짧은 기합은 언어 판정 불가라 텍스트·한국어 강제 받아쓰기로 확인).
- 한계: 사람이 귀로 듣는 목소리 일관성 검수는 아직 안 했다(humanListening: pending). 화자 임베딩 비교도 환경에 도구가 없어 못 했다.
- 재현: `node tools/voice/fish-unify.mjs --outdir <dir> --only <파일들>`(NODE_USE_ENV_PROXY=1) → 재받아쓰기 → `build-voice-manifest.mjs`.

## 표 (파일 → 소유자 → 대사 → 언어 → voice id → 출처)
| 파일 | 소유자 | 대사 | 언어 | voice id | 출처 | ASR |
|---|---|---|---|---|---|---|
| hero_knight_select | knight | 나는 검성 아르카다. 모두를 지키기 위해, 이 성검과 함께 끝까지 싸우겠다. | ko | fish-icl:hero-knight | 유지 | 나는 검성 아르카다 모두를 지키기 위해 이 선검과 함께 끝까지 싸우겠다 |
| hero_knight_atk0 | knight | 하! | ko | fish-icl:hero-knight | 재생성 | 흐흐흐 (ko강제) |
| hero_knight_atk1 | knight | 타앗! | ko | fish-icl:hero-knight | 재생성 | 하! (ko강제) |
| hero_knight_atk2 | knight | 흐읍! | ko | fish-icl:hero-knight | 재생성 | 흐흐.. (ko강제) |
| hero_knight_atk3 | knight | 하아앗! | ko | fish-icl:hero-knight | 재생성 | 하... (ko강제) |
| hero_knight_fin0 | knight | 하앗! | ko | fish-icl:hero-knight | 재생성 | 하아앟 (ko강제) |
| hero_knight_fin1 | knight | 쓰러져라! | ko | fish-icl:hero-knight | 재생성 | 쓰러져라 |
| hero_knight_skill0 | knight | 성검 일섬! | ko | fish-icl:hero-knight | 재생성 | 성검 1섬 |
| hero_knight_skill1 | knight | 철벽 강타! | ko | fish-icl:hero-knight | 유지 | 철벽 강타! |
| hero_knight_skill2 | knight | 심판의 빛! | ko | fish-icl:hero-knight | 유지 | 심판의 빛! |
| hero_knight_skill6 | knight | 성검, 태양파쇄! | ko | fish-icl:hero-knight | 유지 | 성검 태양파쇠 |
| hero_knight_ult | knight | 용살검, 천공! | ko | fish-icl:hero-knight | 재생성 | 용살검 천공 |
| hero_knight_hurt0 | knight | 윽! | ko | fish-icl:hero-knight | 재생성 | 으흐... (ko강제) |
| hero_knight_hurt1 | knight | 큭! | ko | fish-icl:hero-knight | 재생성 | 크 (ko강제) |
| hero_knight_hurt2 | knight | 흣! | ko | fish-icl:hero-knight | 재생성 | 흐! (ko강제) |
| hero_knight_low_hp | knight | 아직… 쓰러질 수 없어. 모두를 지켜야 해. | ko | fish-icl:hero-knight | 유지 | 아직 쓰러질 수 없어 모두를 지켜야 해 |
| hero_knight_perfect | knight | 느려! | ko | fish-icl:hero-knight | 유지 | 느려! |
| hero_knight_win | knight | 빛은 꺼지지 않는다. 다음 전장으로 가자. | ko | fish-icl:hero-knight | 유지 | 빛은 꺼지지 않는다. 다음 전장으로 가자! |
| hero_knight_death | knight | 미안해… 여기까지인가… | ko | fish-icl:hero-knight | 유지 | 미안해... 여기까지인가... |
| hero_knight_revive | knight | 다시 일어선다! 아직 끝나지 않았어! | ko | fish-icl:hero-knight | 유지 | 다시 일어선다! 아직 끝나지 않았어! |
| hero_barbarian_select | barbarian | 나는 광전사 드라칸이다. 피가 끓는구나. 오늘 이 전장을 전부 부숴 버리겠다. | ko | fish-icl:hero-barbarian | 유지 | 나는 광전사 드라칸이다! 피가 끓는구나! 오늘 이 전장을 전부 부숴버리겠다! |
| hero_barbarian_atk0 | barbarian | 라아! | ko | fish-icl:hero-barbarian | 재생성 | 나! (ko강제) |
| hero_barbarian_atk1 | barbarian | 흐읏! | ko | fish-icl:hero-barbarian | 재생성 | 흐! (ko강제) |
| hero_barbarian_atk2 | barbarian | 그라아! | ko | fish-icl:hero-barbarian | 재생성 | 그래 (ko강제) |
| hero_barbarian_atk3 | barbarian | 으랴아! | ko | fish-icl:hero-barbarian | 재생성 | 우려! (ko강제) |
| hero_barbarian_fin0 | barbarian | 박살이다! | ko | fish-icl:hero-barbarian | 재생성 | 박살이다! (ko강제) |
| hero_barbarian_fin1 | barbarian | 부숴라! | ko | fish-icl:hero-barbarian | 재생성 | 푸셔라! |
| hero_barbarian_skill0 | barbarian | 회오리 참격! | ko | fish-icl:hero-barbarian | 유지 | 회오리 참격! |
| hero_barbarian_skill1 | barbarian | 대지 분쇄! | ko | fish-icl:hero-barbarian | 유지 | 돼지 분쇄! |
| hero_barbarian_skill2 | barbarian | 광폭화! | ko | fish-icl:hero-barbarian | 재생성 | 광포과! (ko강제) |
| hero_barbarian_skill6 | barbarian | 혈왕, 대지붕괴! | ko | fish-icl:hero-barbarian | 유지 | 혈왕! 대지 붕괴! |
| hero_barbarian_ult | barbarian | 지옥의 도끼다! | ko | fish-icl:hero-barbarian | 유지 | 지옥의 토끼다! |
| hero_barbarian_hurt0 | barbarian | 크윽! | ko | fish-icl:hero-barbarian | 재생성 | 크 (ko강제) |
| hero_barbarian_hurt1 | barbarian | 그흑! | ko | fish-icl:hero-barbarian | 재생성 | 크흐! (ko강제) |
| hero_barbarian_hurt2 | barbarian | 아악! | ko | fish-icl:hero-barbarian | 재생성 | 어?! (ko강제) |
| hero_barbarian_low_hp | barbarian | 피가 더 필요해… 좋아, 이제 진짜 화가 났다! | ko | fish-icl:hero-barbarian | 유지 | 피가 더 필요해 좋아 이제 진짜 화가 났다 |
| hero_barbarian_perfect | barbarian | 하! 그게 전부냐? | ko | fish-icl:hero-barbarian | 유지 | 그게 전부냐? |
| hero_barbarian_win | barbarian | 하하하! 이 정도로는 배가 안 차는군. 다음은 누구냐! | ko | fish-icl:hero-barbarian | 유지 | 하하하! 이 정도는 배가 안 차는군! 다음은 누구냐! |
| hero_barbarian_death | barbarian | 이런… 아직… 더 부술 수 있는데… | ko | fish-icl:hero-barbarian | 유지 | 이런.. 아직.. 더 부술 수 있는데 |
| hero_barbarian_revive | barbarian | 아직 안 끝났다! 다시 간다! | ko | fish-icl:hero-barbarian | 유지 | 아직 안 끝났다! 다시 간다! |
| hero_mage_select | mage | 나는 대마도사 리아. 별의 흐름은 이미 정해졌다. 이제 조용히, 내 마법을 지켜봐. | ko | fish-icl:hero-mage | 유지 | 나는 대마도사 리아 별의 흐름은 이미 정해졌다 이제 조용히 내 마법을 지켜봐 |
| hero_mage_atk0 | mage | 하! | ko | fish-icl:hero-mage | 재생성 | 하.. (ko강제) |
| hero_mage_atk1 | mage | 흐읍! | ko | fish-icl:hero-mage | 재생성 | 하.. (ko강제) |
| hero_mage_atk2 | mage | 가라! | ko | fish-icl:hero-mage | 재생성 | 카라 (ko강제) |
| hero_mage_atk3 | mage | 지금이야! | ko | fish-icl:hero-mage | 재생성 | 지금이야. |
| hero_mage_fin0 | mage | 끝내! | ko | fish-icl:hero-mage | 재생성 | 끝내 |
| hero_mage_fin1 | mage | 부서져! | ko | fish-icl:hero-mage | 재생성 | 불사자 |
| hero_mage_skill0 | mage | 화염구! | ko | fish-icl:hero-mage | 재생성 | 화염고 |
| hero_mage_skill1 | mage | 번개 사슬! | ko | fish-icl:hero-mage | 유지 | 번개 사슬 |
| hero_mage_skill2 | mage | 빙결 폭풍! | ko | fish-icl:hero-mage | 유지 | 빈결 폭풍 |
| hero_mage_skill6 | mage | 성좌, 별감옥! | ko | fish-icl:hero-mage | 재생성 | 성자 별감옥 |
| hero_mage_ult | mage | 메테오 스톰! | ko | fish-icl:hero-mage | 유지 | 메테오 스톰 |
| hero_mage_hurt0 | mage | 아! | ko | fish-icl:hero-mage | 재생성 | 아.. (ko강제) |
| hero_mage_hurt1 | mage | 큭! | ko | fish-icl:hero-mage | 재생성 | 그.. (ko강제) |
| hero_mage_hurt2 | mage | 흣! | ko | fish-icl:hero-mage | 재생성 |  (ko강제) |
| hero_mage_low_hp | mage | 마력이… 아직 남아 있어. 조금만 더 버티면 돼. | ko | fish-icl:hero-mage | 유지 | 마력이 아직 남아있어 조금만 더 버티면 돼 |
| hero_mage_perfect | mage | 예측했어. | ko | fish-icl:hero-mage | 유지 | 예측했어 |
| hero_mage_win | mage | 계산대로야. 별들이 조용해졌네. | ko | fish-icl:hero-mage | 유지 | 계산대로야. 별들이 조용해졌네. |
| hero_mage_death | mage | 별빛이… 보이지 않아… | ko | fish-icl:hero-mage | 유지 | 별빛이 보이지 않아 |
| hero_mage_revive | mage | 아직 내 마법은 끝나지 않았어. | ko | fish-icl:hero-mage | 유지 | 아직 내 마법은 끝나지 않았어 |
| hero_rogue_select | rogue | 나는 암살자 카인. 조용히 다가가, 한 번에 끝내겠어. | ko | fish-icl:hero-rogue | 유지 | 나는 암살자 카인! 조용히 다가가 한 번에 끝내겠어? |
| hero_rogue_atk0 | rogue | 쳇! | ko | fish-icl:hero-rogue | 재생성 | 찰 (ko강제) |
| hero_rogue_atk1 | rogue | 흣! | ko | fish-icl:hero-rogue | 재생성 | 흐흐 (ko강제) |
| hero_rogue_atk2 | rogue | 하! | ko | fish-icl:hero-rogue | 재생성 | ㅋㅋ (ko강제) |
| hero_rogue_atk3 | rogue | 쉿! | ko | fish-icl:hero-rogue | 재생성 | 슈이 (ko강제) |
| hero_rogue_fin0 | rogue | 끝이야. | ko | fish-icl:hero-rogue | 재생성 | 좋지 (ko강제) |
| hero_rogue_fin1 | rogue | 사라져. | ko | fish-icl:hero-rogue | 재생성 | 사라져 |
| hero_rogue_skill0 | rogue | 그림자 질주! | ko | fish-icl:hero-rogue | 유지 | 그림자 질주 |
| hero_rogue_skill1 | rogue | 독무 폭탄! | ko | fish-icl:hero-rogue | 유지 | 동무 폭탄 |
| hero_rogue_skill2 | rogue | 환영 난무! | ko | fish-icl:hero-rogue | 유지 | 환영 난 모 |
| hero_rogue_skill6 | rogue | 야행, 그림자연무! | ko | fish-icl:hero-rogue | 유지 | 여행, 그림자 연모 |
| hero_rogue_ult | rogue | 천 개의 칼날! | ko | fish-icl:hero-rogue | 재생성 | 전개의 칼날 |
| hero_rogue_hurt0 | rogue | 큭! | ko | fish-icl:hero-rogue | 재생성 | 크 (ko강제) |
| hero_rogue_hurt1 | rogue | 칫! | ko | fish-icl:hero-rogue | 재생성 | 쯧! |
| hero_rogue_hurt2 | rogue | 아! | ko | fish-icl:hero-rogue | 재생성 | 어? (ko강제) |
| hero_rogue_low_hp | rogue | 방심했어… 하지만 아직 내 그림자는 살아 있어. | ko | fish-icl:hero-rogue | 유지 | 당심했어. 하지만 아직 내 그림자는 살아 있어. |
| hero_rogue_perfect | rogue | 아쉽네. | ko | fish-icl:hero-rogue | 유지 | 아쉽네 |
| hero_rogue_win | rogue | 깔끔하네. 다음 목표로 가자. | ko | fish-icl:hero-rogue | 유지 | 깔끔하네. 다음 목표로 가자 |
| hero_rogue_death | rogue | 이게… 마지막 그림자인가… | ko | fish-icl:hero-rogue | 유지 | 이게 마지막 그림자인가 |
| hero_rogue_revive | rogue | 죽음아, 조금만 기다려. | ko | fish-icl:hero-rogue | 유지 | 죽음아 조금만 기다려 |
| hero_ranger_select | ranger | 나는 바람추적자 실바. 숲의 바람이 길을 알려 주는 한, 내 화살은 한 번도 빗나가지 않아. | ko | fish-icl:hero-ranger | 유지 | 나는 바람추적자 실패바라 수폐바람이 길을 알려주는 한 내 화살은 한 번도 빗나가지 않아 |
| hero_ranger_atk0 | ranger | 하! | ko | fish-icl:hero-ranger | 재생성 | 흐흐... (ko강제) |
| hero_ranger_atk1 | ranger | 타앗! | ko | fish-icl:hero-ranger | 재생성 |  (ko강제) |
| hero_ranger_atk2 | ranger | 흐읍! | ko | fish-icl:hero-ranger | 재생성 |  (ko강제) |
| hero_ranger_atk3 | ranger | 놓치지 않아! | ko | fish-icl:hero-ranger | 재생성 | 놓치지 않아 |
| hero_ranger_fin0 | ranger | 받아라! | ko | fish-icl:hero-ranger | 재생성 | 받아라 |
| hero_ranger_fin1 | ranger | 바람과 함께! | ko | fish-icl:hero-ranger | 재생성 | 바람과 함께 |
| hero_ranger_skill0 | ranger | 바람 관통화살! | ko | fish-icl:hero-ranger | 유지 | 바람 권통화살 |
| hero_ranger_skill1 | ranger | 삼중 추적화살! | ko | fish-icl:hero-ranger | 유지 | 3중 추적 화살 |
| hero_ranger_skill2 | ranger | 바람의 이탈! | ko | fish-icl:hero-ranger | 유지 | 바람의 이탈 |
| hero_ranger_skill6 | ranger | 질풍, 사냥각인! | ko | fish-icl:hero-ranger | 재생성 | 질품 사냥각인 |
| hero_ranger_ult | ranger | 폭풍의 일곱 화살! | ko | fish-icl:hero-ranger | 재생성 | 폭풍의 7파살 |
| hero_ranger_hurt0 | ranger | 아! | ko | fish-icl:hero-ranger | 재생성 |  (ko강제) |
| hero_ranger_hurt1 | ranger | 큭! | ko | fish-icl:hero-ranger | 재생성 | 크 (ko강제) |
| hero_ranger_hurt2 | ranger | 흣! | ko | fish-icl:hero-ranger | 재생성 | 아! (ko강제) |
| hero_ranger_low_hp | ranger | 바람이 흔들려… 그래도 내 활은 아직 멈추지 않아. | ko | fish-icl:hero-ranger | 유지 | 바람이 흔들려 그래도 내 화른 아직 멈추지 않아 |
| hero_ranger_perfect | ranger | 바람이 먼저 알려 줬어. | ko | fish-icl:hero-ranger | 유지 | 바람이 먼저 알려줬어 |
| hero_ranger_win | ranger | 숲의 바람이 다시 고요해졌네. 잘했어. | ko | fish-icl:hero-ranger | 유지 | 숲의 바람이 다시 고요해졌네. 잘했어. |
| hero_ranger_death | ranger | 숲이… 멀어져… | ko | fish-icl:hero-ranger | 유지 | 숲이 멀어져 |
| hero_ranger_revive | ranger | 바람이 다시 불어. 이번엔 내가 길을 열게! | ko | fish-icl:hero-ranger | 유지 | 바람이 다시 불어 이번에는 내가 길을 열게 |
| welcome | announcer | 돌아왔군, 전사여. 끝없는 성이 기다린다. | ko | fish-icl:announcer | 재생성 | 돌아왔군, 전사여! 끝없는 성이 기다린다! |
| floor_start | announcer | 성이 깨어난다. 모든 구역을 정화하라. | ko | fish-icl:announcer | 재생성 | 성이 깨어난다. 모든 구역을 청화하라. |
| floor_clear | announcer | 층 돌파! 훌륭하다! | ko | fish-icl:announcer | 재생성 | 정돌파! 훌륭하다! |
| boss_found | announcer | 보스가 가깝다. 정신 차려라. | ko | fish-icl:announcer | 재생성 | 포스가 가깝다 정신 차려라 |
| boss_kill | announcer | 보스 처치! 영광은 네 것이다! | ko | fish-icl:announcer | 재생성 | 포스 철치! 영광은 내 것이다! |
| elite | announcer | 정예가 다가온다! | ko | fish-icl:announcer | 재생성 | 정의가 다가온다! |
| treasure | announcer | 보물방이다! 전부 챙겨라. | ko | fish-icl:announcer | 재생성 | 보물빵이다! 전부 챙겨라! |
| reinforce | announcer | 증원이다! 전열을 지켜라! | ko | fish-icl:announcer | 재생성 | 증언이다! 전여를 지켜라! |
| legend_drop | announcer | 전설이다! 전설 장비 획득! | ko | fish-icl:announcer | 재생성 | 천설이다! 천설 장비 획득! |
| unique_drop | announcer | 유니크 장비! 행운이 함께한다. | ko | fish-icl:announcer | 재생성 | 유니크 장비! 행운이 함께 한다! |
| low_hp | announcer | 위험하다! 물러서라, 지금! | ko | fish-icl:announcer | 재생성 | 위험하다! 물러서라! 지금! |
| perfect | announcer | 완벽한 회피! | ko | fish-icl:announcer | 재생성 | 완벽한 회피! |
| defeat | announcer | 쓰러졌다… 하지만 성은 네 이름을 기억한다. | ko | fish-icl:announcer | 재생성 | 쓰러졌다. 하지만 성은 네 이름을 기억한다. |
| rebirth | announcer | 불사조가 일어선다! 오늘은 아니다, 죽음아! | ko | fish-icl:announcer | 재생성 | 풀사조가 일어선다! 오늘은 아니다! 죽으면! |
| ult | announcer | 궁극기! | ko | fish-icl:announcer | 재생성 | 공급기! |
| enh_success | announcer | 강화 성공! | ko | fish-icl:announcer | 재생성 | 강화 성공! |
| enh_fail | announcer | 강화 실패. 강화석이 부서진다. | ko | fish-icl:announcer | 재생성 | 강화 실패! 강화석이 부서진다! |
| enh_destroy | announcer | 산산조각… 무기가 사라졌다. | ko | fish-icl:announcer | 재생성 | 산산조각 무기가 사라졌다 (ko강제) |
| set_blood | announcer | 흡혈 세트 각성. 피를 마셔라. | ko | fish-icl:announcer | 재생성 | 별세트 각성! 피를 마셔라! |
| set_gravity | announcer | 중력 세트 각성. 아무것도 벗어날 수 없다. | ko | fish-icl:announcer | 재생성 | 중력 세트 각성 아무것도 벗어날 수 없다 |
| set_phoenix | announcer | 불사조 세트 각성. 타올라 다시 태어나라. | ko | fish-icl:announcer | 재생성 | 불사조 세트 각성! 타올라 다시 태어나라! |
| set_storm | announcer | 폭풍 세트 각성. 번개를 타라. | ko | fish-icl:announcer | 재생성 | 폭풍 세트 각성. 번개를 타라! |
| boss_appear | announcer | 보스가 나타났다! | ko | fish-icl:announcer | 재생성 | 호스가 나타났다! (ko강제) |
| boss_phase | announcer | 보스가 강해진다! | ko | fish-icl:announcer | 재생성 | 보스가 강해진다! |
| boss_enrage | announcer | 보스가 폭주한다! | ko | fish-icl:announcer | 재생성 | 포스가 폭주한다! |
| seal_break | announcer | 모든 구역 정화 완료. 봉인이 깨진다! | ko | fish-icl:announcer | 재생성 | 모든 구역청화 완료! 봉인이 깨진다! |
| portal | announcer | 포탈이 열렸다. 준비되면 들어가라. | ko | fish-icl:announcer | 재생성 | 포탈이 열렸다. 준비되면 들어가라! |
| boss_warlord_appear | boss_warlord | 내 왕좌에 바칠 해골이 또 왔구나! | ko | fish-icl:boss-warlord | 재생성 | 내 왕자에 바칠 해골이 또 왔구나! |
| boss_warlord_phase | boss_warlord | 감히 나를 베다니! | ko | fish-icl:boss-warlord | 재생성 | 감히 나를 배다니 |
| boss_warlord_enrage | boss_warlord | 충분하다! 군단이여, 일어나라! | ko | fish-icl:boss-warlord | 재생성 | 충분하다! 군단이여! 일어나라! |
| boss_warlord_death | boss_warlord | 말도 안 돼… 내 군단이… 무너진다… | ko | fish-icl:boss-warlord | 재생성 | 말도 안 돼 내 군단이 무너진다 |
| boss_demon_appear | boss_demon | 아아… 싱싱한 영혼이로군. 가까이 오너라. | ko | fish-icl:boss-demon | 재생성 | 아, 싱싱한 영혼이로군. 가까이 오너라. |
| boss_demon_phase | boss_demon | 이제야 나의 관심을 끄는군. | ko | fish-icl:boss-demon | 재생성 | 이제야 나의 관심을 끄는군 |
| boss_demon_enrage | boss_demon | 통째로 삼켜 주마! | ko | fish-icl:boss-demon | 재생성 | 통째로 삼켜주마 |
| boss_demon_death | boss_demon | 안 돼… 심연으로 돌아가다니… 안 돼! | ko | fish-icl:boss-demon | 재생성 | 안돼...시면으로 돌아가다니... 안돼... |
| boss_dragon_appear | boss_dragon | 천 년의 잠을… 고작 이것 때문에 깨우느냐? | ko | fish-icl:boss-dragon | 재생성 | 천 년의 잠을 고작 이것 때문에 깨우느냐? |
| boss_dragon_phase | boss_dragon | 하찮은 것. 불타라. | ko | fish-icl:boss-dragon | 재생성 | 하찮은 것 불타라 |
| boss_dragon_enrage | boss_dragon | 하늘이 네놈 위로 무너지리라! | ko | fish-icl:boss-dragon | 재생성 | 하늘이 내 놈 위로 무너지리라 |
| boss_dragon_death | boss_dragon | 천 년이… 네놈 손에… 끝나는구나… | ko | fish-icl:boss-dragon | 재생성 | 천 년이 네 놈 손에 끝나는구나 |
| boss_c1_mid_appear | boss_c1_mid | 다시는 보내지 않는다! | ko | fish-lib:a9574d6184714eac96a0a892b719289f | 재생성 | 다시는 보내지 않는다. |
| boss_c1_fin_appear | boss_c1_fin | 아무도 잊지 않게, 가둔다. | ko | fish-lib:bb07cfc53e0f4e3d91ee823a825c35d4 | 재생성 | 아무도 있지 않게 가둔다 |
| boss_c2_mid_appear | boss_c2_mid | 살아 돌아와라…! | ko | fish-lib:7b0e100da67d49ad81bd63a407d2f964 | 재생성 | 살아 돌아와라 |
| boss_c2_fin_appear | boss_c2_fin | 불이 꺼지면 다 죽는다! | ko | fish-lib:fa7d528141974d3ba794e4482b153dc6 | 재생성 | 불이 꺼지면 다 죽는다 |
| boss_c3_mid_appear | boss_c3_mid | 읽히지 않으면 안전하다. | ko | fish-lib:73da877014f349c0ad3eb136c7f1a0c7 | 재생성 | 읽히지 않으면 안전하다. |
| boss_c3_fin_appear | boss_c3_fin | 쓰지 않은 내일도 지킨다. | ko | fish-lib:2f06c7a428e9431fadd60af4dfe91763 | 재생성 | 쓰지 않은 내일도 지킨다 |
| boss_c4_mid_appear | boss_c4_mid | 불빛을 따라와… 제발. | ko | fish-lib:ff2945cbfd274c85b440bd39d8cb3729 | 재생성 | 불빛을 따라와 제발 |
| boss_c4_fin_appear | boss_c4_fin | 다시는 잃지 않는다! | ko | fish-lib:d4c65d5860504eb197b6943c3ff0f289 | 재생성 | 다시는 잃지 않는다! |
| boss_c5_mid_appear | boss_c5_mid | 한 사람이면 모두가 산다. | ko | fish-lib:29da56534ac84ccd81092be4359a1639 | 재생성 | 한 사람이면 모두가 산다 |
| boss_c5_fin_appear | boss_c5_fin | 바쳐라. 그러면 끝난다. | ko | fish-lib:d5a885f492854e068d8a72e14c851771 | 재생성 | 바쳐라. 그러면 끝난다. |
| boss_c6_mid_appear | boss_c6_mid | 누구를 앉히겠는가? | ko | fish-lib:ddda1d00f3684054a7e971b2dde89b5f | 재생성 | 누구를 안 치겠는가 |
| boss_c6_fin_appear | boss_c6_fin | 혼자 남아라. 그게 명령이다. | ko | fish-lib:9aae54921dd944948ee08d35f6b5f984 | 재생성 | 혼자 남아라. 그게 명령이다. |
| boss_c7_mid_appear | boss_c7_mid | 이 문은 내가 닫는다! | ko | fish-lib:061a013646d04f0297560d4354d595fd | 재생성 | 이문은 내가 닿는다 |
| boss_c7_fin_appear | boss_c7_fin | 모두 같은 박자로 울려라. | ko | fish-lib:35856f20bd4a4896af91cee863519e6a | 재생성 | 모두 같은 박자로 올려라 |
