# Seasonal FlowMusic brief

The runtime now has six replacement cue slots: lobby, tide eclipse, ash forge, astral frost, six-rank arena, and the signature-boss set. The current shipped mix keeps each scene on a verified, non-overlapping regional fallback while a new master is exported.

| Slot | Runtime fallback | FLOW target | Musical brief |
| --- | --- | --- | --- |
| Lobby | `regions/lobby` | `lobby` | Quiet glass chimes, warm low strings, a 20-second loop-safe bed |
| 일식의 심연 수문 | `regions/tide` | `tide` | 128 BPM undertow percussion, teal choir, one readable boss lift |
| 재벼림 지하 제련소 | `regions/forge` | `forge` | 138 BPM anvil pulse, clipped chain hits, molten sub impact |
| 성운의 레비아탄 첨탑 | `regions/frost` | `frost` | 112 BPM frozen piano, granular page turns, wide star swell |
| 결투장 6계급 | `regions/arena` | `arena` | 132 BPM short competitive motif, clear one-bar transition |
| 시그니처 보스 3종 | `regions/boss` | `boss` | 96 BPM threat ostinato, three phase stingers, no loudness jump |

## Export gate

The authenticated FlowMusic web GUI is not callable in this execution context, so no new FlowMusic audio file is claimed in this patch. The exact cue IDs and fallback paths are recorded in `src/data/music.js` as `FLOWMUSIC_CUE_PLAN`. Once the GUI export is available, replace the fallback files atomically, measure integrated loudness/true peak, and update the audio manifest; until then the deployed build remains playable and has no broken media URLs.

The current local audio skill also records that FlowMusic does not provide isolated dry SFX one-shots. Existing Kenney/CC0 SFX and the verified `flow-impact-light`/`flow-impact-heavy` accents remain in use; no synthetic audio is mislabeled as a FlowMusic SFX export.
