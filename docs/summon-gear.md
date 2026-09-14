# Summon gear

The loot table now contains eight summon pieces across weapon, armor, ring and boots. Four Uniques and four Legendaries use the existing rarity palette and inventory/save contract, so old saves remain valid and no missing icon URL is introduced.

When equipped, each piece contributes one familiar definition to the battle bonus. Up to four orbiting Three.js familiars can follow the player, pulse their authored atlas cue and strike the nearest live enemy on a bounded interval. The Moonward Aegis also returns a small heal on its strike. Summon damage uses the player attack stat, is marked as a quiet non-recursive proc, and does not create an extra drop or XP loop.

Field drops use separate procedural low-poly silhouettes (`lantern`, `grimoire`, `aegis`, `prism`, `treads`) in `src/game/loot-visual.js`. They are real Three.js meshes with rarity-coloured trim and do not depend on a missing Blender export. The same rarity colour appears in the inventory, detail sheet, pickup beam and result reward chip.

## Verification

- `bun test test/summon-gear.test.ts test/surface-loot.test.ts test/progression-preview.test.ts`
- `node tools/summon-gear-qa.mjs` — compiled Chromium battle with four equipped Unique summon pieces, four familiar nodes and active FX pulses.

The QA screenshot/report under `work/summon-gear-qa/` is local evidence and is not shipped as content.
