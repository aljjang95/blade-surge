# Mirelo 효과음 변형 브리프 — 라운드로빈 진짜 변형·가챠 공개음 (2026-10-22, 사운드 레인 h2)

**PC 단계(또는 대표님이 지정한 Mirelo 경로).** 효과음은 Mirelo 로 만든다. 클라우드 레인은 지금 이 브리프와
원본에서 파생한 임시 변형(`public/sfx/derived-v1/`, `tools/audio/fx-variants.py`)만 만들었다. 파생본은 같은 원본에서
피치·EQ·꼬리만 바꾼 것이라 "다른 녹음"만큼 다르지 않다. 아래가 도착하면 파생본을 대체한다.

## 왜 필요한가(실녹음 근거)

`tools/audio/audio-capture-qa.mjs` 로 1-5 전투 40초를 녹음한 재생 기록(capture-log.json)에서 한 파일짜리 효과가
쿵 38번, 적 근접 예고 20번, 팅 19번, 충전 18번 그대로 반복됐다. 런타임 피치 흔들림(±5%)만으로는 스펙트럼 차이가
0.6~1.4dB 라서 "같은 소리"로 들린다.

## 생성 목록(공통 꼬리말: `, fantasy action game sound effect, close-miked, punchy and clean, dry, no music, no voice, no speech`)

| 파일 | 길이 | 프롬프트 |
|---|---|---|
| fx/thump_1 | 0.8s | deep low body thump on armor, slightly darker and heavier |
| fx/thump_2 | 0.7s | short tight low thump with a woody knock |
| fx/ting_1 | 0.7s | small bright metallic ting, higher and glassier |
| fx/ting_2 | 0.8s | small metallic ting with a softer bell ring |
| fx/charge_1 | 1.1s | short magical energy charge-up, rising whoosh with sparkle |
| fx/tele_melee_1 | 1.0s | enemy wind-up before a melee strike, quick rising swish and grunt-less tension |
| fx/tele_magic_1 | 0.6s | enemy spell telegraph, short eerie rising shimmer |
| event/gacha_reveal_r | 0.8s | card flip reveal, soft bright whoosh with a small sparkle |
| event/gacha_reveal_ssr | 2.6s | legendary card reveal, powerful golden radiant burst with a deep boom and bright shimmering bell tail |

각 항목 후보 3개를 만들고 `tools/audio/mirelo-event-forge.py` 의 후보 기준(끝 25% 에너지 < 0.35, 중간 무음 < 0.45초,
정점 > -12dB 중 크레스트 최대)으로 고른다.

## 받은 뒤(클라우드 세션에서 가능)

1. 원본 WAV 와 영수증(taskUUID·seed·비용)은 `work/audio/mirelo-variant-raw/` 에 둔다(덮어쓰지 않는다).
2. fx 변형: `public/sfx/mirelo-v1/fx/<family>_<n>.mp3` 로 넣고 `FX_VARIANTS` 수를 올리고 `FX_DERIVED` 에서 그만큼 뺀다.
   `public/sfx/mirelo-v1/manifest.json` 에 항목을 더하고 `test/combat-sound-library.test.ts` 의 개수(178)를 함께 고친다.
3. 가챠 R/SSR: `public/sfx/mirelo-v1/event/` 에 넣고 `EVENT_SOUNDS` 와 `audio.gachaReveal/gachaCard` 에 잇는다(지금 R 은 ui_bong,
   SSR 은 jingle_legend + 합성 저역 충격).
4. `bun test test/audio-forge-h2.test.ts test/combat-sound-library.test.ts` 와 `node tools/audio/audio-capture-qa.mjs` 로 확인한다.
   사람 청취 전에는 `humanListening: pending`.
