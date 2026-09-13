# Field material accounting

Elite enemies drop one advanced stone; bosses drop two advanced stones and one legendary stone. The visual item kinds are `stone2` and `stone3`, while the run counters and save fields are `stones2` and `stones3`. Pickup must increment the latter before the campaign or expedition result settles the run.

The September 2026 regression displayed the correct pickup message but incremented undefined singular properties. A fresh knight's actual first campaign victory collected eight advanced stones and one legendary stone, while both settlement counters stayed zero. The fix maps each visual kind to its existing saved counter. It does not change reward quantities, drop rates, enhancement prices or party/arena reward boundaries. Past missing pickups were not stored, so the patch cannot reconstruct their quantities.

## Reproduce and verify

```powershell
bun run check
node tools/field-loot-qa.mjs --tag=knight
node tools/field-loot-qa.mjs --hero=mage --seed=20261031 --runs=10 --tag=campaign
```

The browser tool serves the production build on an owned ephemeral port and creates an isolated save. It selects an initially owned hero, uses game AUTO and the first offered choices, and advances the actual simulation at 1/60 second. The wrappers observe original spawn/collection calls without replacing their behavior. Assertions compare physical pickup quantities, run counters, account increments, the victory receipt, and a real page reload.

For consecutive stages, only equipment already earned into the inventory is equipped through the existing comparison/equipment API when its power improves. The tool grants no resources, levels, stars or items; it does not set HP, damage, position or victory, or advance the account clock. It stops at insufficient energy instead of filling it. Seeded randomness and fixed stepping are measurement conditions; wall-clock UI/audio scheduling can still produce timing differences between runs. A failed AUTO run is evidence to investigate, not proof that a human cannot clear the stage.

Reports and result screenshots are written to ignored `work/field-loot-<hero>-<seed>-<tag>/`. Each report identifies the source hashes and served build. A pass covers the executed stages and reload only; it does not certify manual combat balance, physical-phone performance, installed PWA behavior, or the full long-term progression curve.

The unit regression separately runs actual kill drops through meshes, flight and magnet collection into campaign, basic expedition and deep expedition settlement. It also covers reset/recollection, duplicate expedition settlement rejection and stale party/arena pickup suppression.
