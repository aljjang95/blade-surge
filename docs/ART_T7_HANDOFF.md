# 아트 t7 인계 (2026-10-25, gogo-chunk:blade-art-t7)

## 끝난 것
| 항목 | 결과(측정은 `tools/art/measure-hem.mjs`, 실제 게임 경로) |
|---|---|
| 1. 기사 2·3단계 망토 밑단 | bind 자세 밑단 −5.6 / −8.8cm → +1.0cm. `tools/art/fit-cape-hem.mjs`: 골반 관절 rest 아래, 다리 밖 정점만 세로 배율(0.91 / 0.87)로 누름, 다리 가중치에 비례해 줄여 이음매 유지, 법선 역전치 보정, 재적용 거절. 대기·달리기 밑단은 원래 바닥 위(+29·+9cm → +33·+13cm) |
| 1-1. 벚꽃 무사 | bind 밑단 +47cm, 대기·달리기도 바닥 위라 손대지 않음(t6 기록의 '벚꽃 무사 망토'는 재현 안 됨) |
| 2. 별빛 천문 예복 발 | bind −7.0 → +0.2cm, 대기 −5.9 → +1.4cm(마법사 1단계 +1.6cm). `fit-leg-rest.mjs`에 `--min-fit`·`--max-ratio` 옵션(허벅지 1.05~1.08, 정강이 0.75~0.77) |
| 3. 야만전사 L 투구 | 원인은 3단계 몸의 내장 투구 V 장식. `bodyCovers.hero_barbarian_t3 = [helm]`으로 이중 투구 제거. 기사 L 투구 +0.06(`heroSetFit` 신설) |
| 4. 건틀릿 아래 손 | 야만전사만 맨주먹 보임 → `heroFit.barbarian.gauntlet` 손목 쪽 +0.08·1.15배로 덮음 |
| 5. 늑대인간 이마 점 | 정면 정사영 래스터로 점 텍셀(22개, 팽창 60 중 48 수정)만 주변 피부 중앙값으로. `tools/art/replace-glb-image.mjs`로 기본색 이미지만 교체(webp q86, 2.27→2.29MB). 왼쪽 머리선 붉은 흔적 조금 남음 |
| 6. 구르기·공격 촬영 | `hero-gear-parts-shots.mjs --poses` 5영웅 × E·L, 파츠가 관절을 따라감, 불일치 0, 드로우콜 +2 |

## 발견(별도 덩어리 제안)
- 기사 계열 구르기(원본 클립)는 1단계 몸도 상체가 바닥 아래 19cm, 2·3단계 25~30cm, 벚꽃 무사 35cm까지 내려간다. 망토가 아니라 클립 자체라 밑단 수정으로 줄지 않는다. 궁수·도적처럼 회피 골반 높이 띠 곡선(`author-tier-body-motion.mjs`)이 필요하고, `hero-body-motion.js`(보호 파일)의 `registerHeroBodyMotion`이 궁수·도적만 받으므로 기사·야만전사·마법사 확장이 함께 필요하다.
- 야만전사 3단계 몸의 투구 V 장식이 눈 윗부분을 덮는 것은 몸 메시 디자인이다. 바꾸려면 Tripo 재생성 또는 몸 메시 정리가 필요하다.

## 검증
`bun run check` 통과, `test/art-t7-fit.test.ts`(별빛 예복 발·기사 밑단), `test/hero-gear-parts.test.ts`(heroSetFit). 촬영은 SwiftShader라 실기기 GPU 증거가 아니다.
