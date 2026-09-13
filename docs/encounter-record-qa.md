# Encounter location and level records

Campaign enemy levels and saved floors now follow the full authored campaign. Previously the record rules capped every floor at 50: both 6-1 and 6-10 bosses displayed Lv.54 and stored floor 50. The cap now comes from the chapter catalogue, preserving the existing elite/boss offsets. The actual 6-1 boss displays Lv.55 and the 6-10 boss Lv.64.

Expeditions use template stages that are not equivalent campaign levels. Their HUD now names the actual mode: 원정, 심층, 균열 or AI 결투. The bestiary stores the latest actual catalogue location, including the dungeon depth and daily rift rule. Its reference statistics explicitly identify their campaign context. HP, ATK, combat EXP, difficulty, settlement and party combat behavior are unchanged.

Existing discoveries, kills, combat EXP and numeric records survive normalization. Expedition visits do not overwrite the last campaign floor or inflate a numeric high-water record. Old saves gain no invented encounter history: previously truncated floors and unrecorded expedition locations cannot be reconstructed. New locations accept catalogue identifiers only; invalid and inherited required fields are rejected, and inherited optional rift identifiers are ignored.

## Local verification

```powershell
bun run check
bun test test/encounter-records.test.ts
node tools/encounter-record-qa.mjs --save=work/natural-progression-mage-20261031-chapter-six/after-21-star_archive-deep.json --sha256=93ef4b18a148b9f343228324e6d22142b11b65fd1d01ebf9bfe5344bde5964a2
```

The baseline receipt `work/encounter-record-baseline.json` evaluates the exact committed rules at `d09e1345354542b04474da281ca778eba7fa60c7`; it is not a baseline browser run. The final local check passes TypeScript, 672 tests / 93,731 assertions and the production build. Ten focused record tests include 93 assertions through actual save normalization, mode transitions and invalid input boundaries.

The browser driver requires a named, hashed synthetic free-play acquisition checkpoint and its successful parent receipt. It restores that profile into an isolated local browser, then runs 6-1, 6-10, all three deep expeditions, a standard expedition, an AI duel and the current daily rift. The acquired profile was earned on the separately retained `bc345e8` build; this run does not claim to have replayed its whole acquisition history on the candidate.

The driver uses existing stage entry, fixed 1/60-second AUTO and the first offered choice. It observes the original spawn function, actual wins, settlement, boss/target HUD, the native bestiary dialog and a real page reload. Expected locations come from the requested routes, and every dungeon spawn must preserve the requested depth. HP/ATK are compared with the authored definition, scale and existing challenge factors. No stats, kills, gear, currency or victories are granted; an existing energy SKU can spend the profile's owned free gems, with each purchase recorded.

`work/encounter-record-qa/report.json` binds the source files, compiled entry and outcomes. Screenshots cover late campaign, deep and AI bestiary dialogs at 390×844, plus actual boss encounters. Initial object-key ordering and rotation-dialog automation failures are retained separately. They were harness failures, not failed combat outcomes; no failing report was relabeled as passing. Independent read-only review found and closed own-property validation and route-depth assertion gaps.

This is local compiled Chromium and viewport/touch emulation. It does not establish physical-phone scrolling/FPS, installed Android/iPhone behavior, sound output, real-network party completion or year-long retention. Earlier PWA/Neve changes remain shipped and separately evidenced. Clean feature/merge binding and deployed asset verification are recorded under `_autopipe/evidence/encounter-record-*` when the release completes.
