# Live release verification

Run `node tools/live-release-qa.mjs <exact-deployed-commit-sha>` from a checkout containing the exact deployed `dist/version.json` and assets. The installed Playwright browser or existing `CHROME_PATH` is reused; no browser login/profile or credential is copied. Evidence is written to a new timestamped `work/live-release-qa/` directory.

This is a runtime adapter using the existing metrics driver and Chrome launcher, not another outer orchestration harness. It verifies the fixed Blade Surge public origin against local version, service worker, manifest, entry assets, and all 48 armory PNG/GLB files. Browser POST/non-read requests are blocked and reported as failures. External font CSS is isolated and recorded.

The gameplay sample starts from a new isolated browser save and uses the real departure button and keyboard movement, followed by bounded deterministic AUTO steps and existing offered choices. No enemy, damage, reward, level or victory values are assigned. It waits for the game's actual delayed result panel before capturing victory and checks next-stage, inventory and level persistence after reload.

Crowd evidence requires at least five live enemies within five game units after a fresh rendered step. A total enemy count elsewhere in the dungeon is not enough. This avoids naming a stale or empty frame as crowd proof.

The initial 2026-09-15 release probe stopped stepping at `battle.active === false`, while the result panel was still queued for 1.6 seconds later. Its data result/save checks passed, but its screenshots were stale. Those original records remain unchanged under `work/release-rsi-20260915/live-dogfood/`. The capture adapter fixes evidence synchronization; it does not change game mechanics or synthesize a result panel.

This is desktop software-rendering evidence, not physical-phone frame rate, heat, multitouch, audio listening or human manual-completion proof. API helpers, unit checks and screenshots alone do not approve a release.
