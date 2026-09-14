# Seasonal FlowMusic brief

The runtime now has fifteen replacement cue slots: twelve deep-dungeon routes, lobby, six-rank arena, and the signature-boss set. The current shipped mix keeps each scene on a verified, non-overlapping regional fallback while a new master is exported.

| Slot | Runtime fallback | FLOW target | Musical brief |
| --- | --- | --- | --- |
| Lobby | `regions/lobby` | `lobby` | Quiet glass chimes, warm low strings, a 20-second loop-safe bed |
| 유리정원 · 종의 뿌리 | `regions/garden` | `garden` | 118 BPM leaf percussion, root chimes, a warm sanctuary lift |
| 잿불금고 · 침몰한 운반선 | `regions/forge` | `forge` | 138 BPM anvil pulse, clipped chain hits, molten sub impact |
| 별빛서고 · 귀환의 관측소 | `regions/frost` | `frost` | 112 BPM frozen piano, granular page turns, wide star swell |
| 종락 회랑 · 멈춘 합창 | `regions/garden` | `garden` | 108 BPM bell choir, ticking glass, one restrained choral return |
| 재의 밀물 · 냉각선 붕괴 | `regions/tide` | `tide` | 128 BPM undertow percussion, coolant hiss, a pressure-release lift |
| 밤유리 관측소 · 역행의 눈 | `regions/frost` | `frost` | 116 BPM reversed piano, granular page turns, a narrow star pulse |
| 일식의 심연 수문 | `regions/tide` | `tide` | 128 BPM undertow percussion, teal choir, one readable boss lift |
| 재벼림 지하 제련소 | `regions/forge` | `forge` | 138 BPM anvil pulse, clipped chain hits, molten sub impact |
| 성운의 레비아탄 첨탑 | `regions/frost` | `frost` | 112 BPM frozen piano, granular page turns, wide star swell |
| 녹청의 성역 | `regions/garden` | `garden` | 118 BPM leaf percussion, root chimes, a warm sanctuary lift |
| 흑사막 환영 분지 | `regions/crown` | `crown` | 124 BPM mirrored hand drums, glass arpeggios, one false-court stinger |
| 혜성의 유성 요새 | `regions/frost` | `frost` | 136 BPM orbital pulse, comet risers, a wide blue impact tail |
| 결투장 6계급 | `regions/arena` | `arena` | 132 BPM short competitive motif, clear one-bar transition |
| 시그니처 보스 3종 | `regions/boss` | `boss` | 96 BPM threat ostinato, three phase stingers, no loudness jump |

## Export gate

The authenticated FlowMusic web GUI is not callable in this execution context, so no new FlowMusic audio file is claimed in this patch. The exact cue IDs and fallback paths are recorded in `src/data/music.js` as `FLOWMUSIC_CUE_PLAN`. Once the GUI export is available, replace the fallback files atomically, measure integrated loudness/true peak, and update the audio manifest; until then the deployed build remains playable and has no broken media URLs.

The current local audio skill also records that FlowMusic does not provide isolated dry SFX one-shots. Existing Kenney/CC0 SFX and the verified `flow-impact-light`/`flow-impact-heavy` accents remain in use; no synthetic audio is mislabeled as a FlowMusic SFX export.
