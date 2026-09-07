# BLADE SURGE — Combat & RPG foundation candidate

Status: **review-required / target-runtime activation-required**. This is source implementation, not a released or playtested patch.

## Contract

Goal: improve readable melee contact and connect the existing hero growth model to combat, monster levels, a bestiary and a stat sheet. Preserve approved character assets, skills, item economy, stage-clear rewards and old saves. No deployment, paid generation, production data changes, GitHub Actions or automatic merge.

Base/rollback: `068e1fc2344fa62d8b2fb899d06bce340221691d` (tree `a2278fd102c9a75488a2df43338622187428cce8`). Existing art PR #12 is not included.

Inherits `aljjang95/apex-skill-forge@main` owner-goal (`runtime/portable/owner-goal.v1.json`, blob `a0b07dc7b4809e4c4e4202832e931c16ccae2f0d`) and living constitution (`docs/APEX_GLOBAL_LIVING_CONSTITUTION.md`, blob `838271878f64523b19b3d93ee85190f69a21b61e`; `workspace/living-constitution.json`, blob `f6f56f31a155519520aea90fd8b27d03abef26ed`). No new outer harness or supervisor dispatch is introduced.

## Implemented candidate

- Actor render-only pivot: readable anticipation, accelerated strike, recovery and directional recoil. Single-hit basic attack animation time still passes through the original hitAt. Spin/multi-hit clips retain linear timing. Model identity, bone sockets, collider and attack damage remain unchanged.
- Bounded shared contact clock and six impact bursts/one impact sound per simulation update; no new random camera shake. Boss and elite recoil resistance. Existing unrelated spell/camera effects are not globally rewritten.
- Existing hero level/EXP record and existing levelExp curve reused, cap 80. Authored monster EXP is granted immediately on death, with an instance receipt preventing duplicate settlement. Summons created via the existing near-spawn route grant zero combat EXP. Stage completion XP remains separately owned by the existing reward path.
- Mid-battle stats and awakened skill locks update without resetting cooldowns. Missing HP is preserved; a dead player is never revived by a level-up.
- Monster level metadata uses floor + rank (normal +0, elite +2, boss +4). HP and attack still use the original authored rank and stage scaling, not an additional level multiplier. These levels are informational difficulty labels in v1, not a new independent combat formula.
- Save-whitelisted bestiary: actual encounters, kills, highest encountered level and last floor. Tier labels are informational, not invented reward claims. No retroactive reconstruction of historical kills.
- Lobby/battle codex, search, rank filter, undiscovered states, source-derived stats/regions/behaviors, hero stat sheet, live EXP and target HP/level, result XP labelled already granted. Text-only insertion for data, native dialog focus/Escape, separate pause ownership.
- XP persistence is batched up to one second while running, with flush on pause, hidden/pagehide, stop and result. Failed saves remain dirty and show one warning until recovery.

## Structure and rollback

`battle-base.js` is the byte-identical original `battle.js` blob `9caec8380a913c23380fbd9bd0cba7750bdb959a`. `save-base.js` is the original `save.js` blob `5f12edbbdc7728bfd117eb4a61ad2392506b77e9`. Public entry points now delegate to additive extensions. No gameplay asset binaries changed. Revert the candidate commit as a unit to restore the original paths and actor. Keep a copy of the browser save before comparative playtesting; the older normalizer drops unknown RPG records if it saves again.

## Evidence actually executed

ChatGPT sandbox Node 22.16.0: 30 pure rule/timing tests + 10 battle-boundary unit tests with explicit fakes, **40 passed / 0 failed**. Syntax checks passed for candidate JavaScript. Boundary fakes are not the real Three.js renderer, base Battle implementation or runtime assets. The original actor blob was reconstructed and checked against its Git blob SHA before editing.

Reproduce additional tests from a real checkout:

```sh
node --test tools/tests/rpg-foundation.test.mjs tools/tests/rpg-battle-contract.test.mjs
bun run check
```

`tools/tests/rpg-view.fixture.html` is a DOM component fixture, NOT gameplay footage or a production page. Serve the checkout locally to exercise it. An attempted sandbox headless Chromium session timed out before returning DOM output; no browser/render PASS is asserted. Existing baseline tests, full TypeScript checking, Vite build, real gameplay and mobile performance were **not executed** here. Owner-local checkout/terminal execution was not exposed by the connected action registry.

## Required gate before merge

Run exact-tree `bun run check` in Codex, including pre-existing source-contract tests that may depend on the Battle/Save file locations. Compare base and candidate with the same approved hero, map seed, device, camera and inputs. Check four heroes; single-hit versus multi-hit/spin/projectile attacks; air swings versus confirmed contacts; blocked/dodged attacks; 30-enemy crowd; boss phases; level 9→10 and 19→20; cap 80; save reload, quota failure, defeat/retry, manual pause plus codex, hidden tab and portrait fallback. Assess original clip contact frame alignment, actual weapon trajectory, audio peaks, cooldown continuity and 10-minute frame-time/memory behavior.

Experience gain rate, informational enemy levels and the new HUD/dialog layout require real balance/visual review. No measured improvement score or device pass rate is invented. Fresh independent read-only review, signed proof and live base/head checks remain missing. Do not merge until these gates pass; deployment remains separately owner-gated.
