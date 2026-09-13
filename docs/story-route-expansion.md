# Story route expansion acceptance

Scope: six new authored intermediate campaign maps. Preserve the existing six map definitions, chapter entry/final maps, combat/reward systems and supported landmark builders.

Before implementation, acceptance is:
- Twelve distinct coordinate/edge graphs, including six additions with different connectivity and geometry (not rotations or reflections).
- Each new map has 10–14 rooms, one treasure room, a final degree-one boss room and exactly one working boss gate.
- Every non-boss room is reachable while sealed; the boss is unreachable. After unsealing every room is reachable.
- Existing radius 0.56 AUTO collision simulation reaches every room; corridors remain width 8 and room sizes are at least 16 units.
- All 60 campaign stage mappings remain valid, and chapter stages 1 and 10 keep their existing maps.
- Names, route copy and room labels refer to the selected existing story scene. Reuse only memorial/kiln/archive/beacon/tribunal/confluence architecture; no claim of newly authored landmark art.
- Run targeted story/campaign/world checks with logs in work/story-route-expansion. Main agent owns actual app/visual QA; graph tests are not visual approval or evidence of a year of content.

## Implemented scene assignments

| Scene | Map | Rooms / edges / independent cycles | Connectivity | Reused landmark |
|---|---|---|---|---|
| 1-4 거짓 봄의 온실 | greenhouse / 발자국의 온실 격자 | 10 / 13 / 4 | Three rows joined through a central four-way junction | memorial |
| 2-4 무기 없는 반란 | uprising / 장인들의 탈출 작업장 | 12 / 11 / 0 | Branching workshop spine, three work alcoves, bent exit chain | kiln |
| 3-8 뒤로 흐르는 강 | reverseRiver / 계약 아래의 역류 | 13 / 14 / 2 | Four-room western loop and six-room eastern loop joined by a bridge | archive |
| 4-8 돌아오지 않은 배 | lostShip / 기다리는 배의 선실 | 11 / 12 / 2 | Two parallel deck rows with unequal loops and a long stern exit | beacon |
| 5-4 네 개의 빈 왕좌 | emptyThrones / 네 왕좌의 회합 회랑 | 14 / 17 / 4 | Outer circuit and two inner cross corridors leading to a shared exit | tribunal |
| 6-3 내일의 주소록 | addresses / 생존자의 주소 갈림길 | 12 / 12 / 1 | Small reception loop with branching address wings | archive |

Only these six slots changed. All twelve entry/finale assignments remain unchanged. Decks and rivers are narrative room labels on the existing flat collision floor, not new elevation or water traversal mechanics. The existing architecture builders supply the listed landmarks; this change does not add greenhouse, ship or throne models.

## Verification

Command: `bun test test/story-dungeons.test.ts test/campaign-world.test.ts test/campaign-data.test.ts test/campaign-combat.test.ts`

Result: **142 passed, 0 failed, 74,582 assertions**, four files. Log: `work/story-route-expansion/targeted-tests.log`.

Checks cover all 60 actual campaign Floor layouts, one treasure, final degree-one boss, one gate, sealed non-boss reachability, sealed boss exclusion and unsealed reachability. All twelve routes pass radius 0.56 movement through the production flow-field/collision resolver. Distinct degree/distance graph fingerprints prove the twelve connectivity graphs cannot be mere rotations, reflections or room renumberings of one another. New edges join adjacent orthogonal cells, avoiding crossing or long corridors through unrelated rooms.

Topology boundary: these checks use actual deterministic campaign seeds and an additional shared Floor seed for AUTO traversal. Arbitrary future spacing/room changes need reruns. Multi-cycle routes permit route choice and the workshop requires backtracking; no new interaction or forced objective order is implied. Actual visual readability, combat pacing, mixed enemies and device performance remain the primary agent's app QA responsibility. No Git operation or deployment was performed.
