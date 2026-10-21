# FlowMusic 생성 브리프 — 지역 보스곡·중간 보스곡·마을곡 (2026-10-22, 사운드 레인 h2)

**PC 단계.** FlowMusic 은 대표님 PLUS 계정의 로그인된 브라우저 세션에서만 생성·다운로드된다(`game-audio-forge` 스킬 2장).
클라우드 세션은 이 문서를 만들고 엔진 쪽 라우팅과 대체 곡만 준비했다. 생성 전에는 아래 "대체 곡"이 재생되므로 빈 소리나 깨진 URL 은 없다.

## 지금 상태(코드)

- 캠페인 보스: `src/data/music.js` 의 `BOSS_CUE_PLAN` 12칸(6지역 × 최종/중간). 최종 보스(X-10)는 `regions/boss`,
  중간 보스(X-5)·수문장(X-3, X-7)은 `expansion/flow-combat`(2026-09-09 FlowMusic 생성, 62.7초)으로 이미 서로 다르다.
- 마을: 캠페인 마을 레인(c3)의 `campaignTownMusic` 이 1지역은 `regions/lobby`, 2~6지역은 그 지역 던전 곡을 쓴다.
  마을 전용 곡이 오면 그 함수의 반환값만 바꾸면 된다.
- 등장 스팅어(보스·중간 보스)는 Mirelo 효과음으로 이미 들어갔다(`public/sfx/mirelo-v1/event/`). 곡에 인트로 스팅어를 넣지 않는다.

## 공통 지시(Compose 패널)

Instrumental 켬. 모바일 액션 RPG 루프용. 3분 안팎, **끝을 페이드아웃하지 말고 첫 마디로 자연스럽게 이어지게(loopable ending)**.
보컬·합창 가사 없음, 실존 곡·작곡가 흉내 금지. 다운로드는 WAV(48kHz). 생성 카드 URL(`flowmusic.app/song/<id>`)을 영수증에 남긴다.

## 보스곡 12개

| cue id | 지역 | 등급 | Sound description |
|---|---|---|---|
| boss-garden-finale | 잊힌 종의 정원 | 최종(종왕 에일른) | dark fantasy boss battle, 150 BPM, D minor, tolling bronze bells as percussion, low strings ostinato, taiko, choir pads without words, loopable |
| boss-garden-midboss | 잊힌 종의 정원 | 중간(애도의 기사 세렌) | mournful knight duel, 138 BPM, D minor, solo cello lead over driving drums, glassy bell accents, loopable |
| boss-forge-finale | 불씨 왕국의 용광로 | 최종(화왕 발드) | volcanic forge boss battle, 156 BPM, C minor, anvil hits, heavy taiko, distorted low brass, roaring fire textures, loopable |
| boss-forge-midboss | 불씨 왕국의 용광로 | 중간(대장장이 이그란) | blacksmith combat, 144 BPM, C minor, rhythmic hammer percussion, low strings, brass stabs, loopable |
| boss-frost-finale | 서리 도서관 | 최종(서리왕 이셀) | icy reversed-time boss battle, 148 BPM, F# minor, reversed piano swells, celesta, staccato strings, deep sub drums, loopable |
| boss-frost-midboss | 서리 도서관 | 중간(기록관 오르딘) | arcane librarian duel, 136 BPM, F# minor, ticking clock percussion, harpsichord ostinato, strings, loopable |
| boss-tide-finale | 별이 잠긴 심해 | 최종(해왕 네레이스) | deep sea leviathan boss battle, 146 BPM, E minor, surging low strings like waves, whale-like brass, war drums, loopable |
| boss-tide-midboss | 별이 잠긴 심해 | 중간(등대지기 마렌) | storm lighthouse duel, 140 BPM, E minor, foghorn brass, rolling toms, string tremolo, loopable |
| boss-crown-finale | 새벽을 먹는 왕관 | 최종(빈 왕관) | apocalyptic final boss, 160 BPM, B minor, massive orchestral hits, organ, epic drums, golden brass fanfare motifs, loopable |
| boss-crown-midboss | 새벽을 먹는 왕관 | 중간(첫 기사 아스텔) | royal knight duel, 150 BPM, B minor, heroic brass vs dark strings, snare marches, loopable |
| boss-homecoming-finale | 함께 잇는 귀환로 | 최종 | bittersweet heroic final battle, 152 BPM, G minor to G major lift, full orchestra, warm horns, drums, loopable |
| boss-homecoming-midboss | 함께 잇는 귀환로 | 중간 | echoes of past regions, 142 BPM, G minor, bell, anvil and ice motifs layered over drums, loopable |

## 마을곡 6개(캠페인 마을, c3 `CAMPAIGN_TOWNS`)

| cue id | 마을 | Sound description |
|---|---|---|
| town-bellgarden | 종지기 정원 마을 | peaceful garden town, 92 BPM, D major, harp, soft bells, flute, light strings, warm and safe, loopable |
| town-emberforge | 불씨 용광로 마을 | cozy forge town, 96 BPM, C major/mixolydian, hand percussion, plucked lute, gentle anvil ticks, warm brass pads, loopable |
| town-frostarchive | 서리 서고 마을 | quiet snowy library town, 84 BPM, F# minor (calm), celesta, music box, soft strings, loopable |
| town-tidelight | 별잠 등대 마을 | harbor lighthouse town, 90 BPM, E major, accordion, acoustic guitar, gentle waves texture, loopable |
| town-dawncrown | 새벽 성문 마을 | solemn dawn gate town, 88 BPM, B minor (hopeful), choir pads without words, harp, horn melody, loopable |
| town-homeward | 함께 잇는 귀환 마을 | warm homecoming town, 94 BPM, G major, folk ensemble, fiddle, flute, light percussion, loopable |

## 받은 뒤(클라우드 세션에서 가능)

1. 원본 WAV 는 Drive 원본 폴더에 보존하고, 게임용은 `public/bgm/regions/<cue>.mp3` 로 넣는다(-18 LUFS, -1.5 dBTP,
   48kHz 스테레오 — 기존 `docs/media/region-audio.json` 과 같은 기준). Android 채널용 Opus 는 자산 압축 레인(f5)의 도구로 만든다.
2. `python3 tools/audio/bgm-loop-points.py public/bgm/regions/<cue>.mp3` 로 루프 지점·이득을 재서 `BGM_LOOPS` 에 넣는다.
3. 보스곡은 `BOSS_CUE_PLAN` 해당 칸에 `file: 'regions/<cue>', status: 'shipped'` 를 적는다. 마을곡은 `campaignTownMusic` 반환값을 바꾼다.
4. `bun test test/audio-forge-h2.test.ts test/music-scenes.test.ts` 와 `node tools/audio/audio-capture-qa.mjs` 로 확인한다.
