# Campaign defeat preparation

The death dialog now offers **정비하기**, which ends the current campaign battle without buying a revive. The defeat result lists independently affordable next steps for the selected hero: a guaranteed equipment enhancement through +8, an unlocked skill upgrade, and a prerequisite-valid mastery node. Opening one only navigates to its existing cost/confirmation screen. It does not spend currency, batch-upgrade, or restart a battle. Each action rechecks current resources and selection before navigating.

Defeat hides the previous victory's reward bars and loot area. Actual combat EXP/renown notices remain visible. Victory restores its normal reward presentation. Short landscape layouts put the three optional preparation actions in a row; lobby/retry controls stay at the result panel's bottom while its content scrolls. Expedition settlement, revival cost, energy charges and combat balance retain their existing behavior.

## Reproduction and evidence boundary

An isolated mage played the production `bc345e8f052618648742d392daca673237f493d3` build with actual AUTO, earned inventory, and fixed 1/60-second stepping. It completed campaign 1-1 through 3-10 without enhancements, then died in 4-1 while holding enough ordinary resources to improve its build. The exact acquired pre-4-1 profile is retained at:

`work/natural-progression-mage-20261031-chapter-four/before-10-4-1.json`

SHA-256: `49b502d631dd6419db9f298efb18db175ecc189abd53e1faa7244cf4708fb24e`.

The separate control (`four-one-control/report.json`) records native give-up after actual death. A prepared run spent 45,148 gold, 20 basic stones and 96 renown through existing enhancement, skill and mastery APIs, then completed all remaining campaign stages through 6-10 and the three deep routes across the retained acquisition chain. No paid purchases, injected gear/stats/victories, star upgrades or energy clock adjustment were used. When needed, energy was bought from the existing `en2` catalog using owned free gems. Saves, parent hashes, stage outcomes, purchases and reload checks are retained under `work/natural-progression-*`.

This establishes one executed acquisition path and a discoverability problem. It is not proof of manual balance, retention, physical-phone FPS, or a year of content.

## Local checks

```powershell
bun run check
node tools/defeat-growth-qa.mjs --save=work/natural-progression-mage-20261031-chapter-four/before-10-4-1.json --sha256=49b502d631dd6419db9f298efb18db175ecc189abd53e1faa7244cf4708fb24e
```

The browser command requires the local synthetic checkpoint and its adjacent acquisition report; it rejects other input identities and changed acquisition gameplay sources. These large generated artifacts are not committed. It serves the local build on an owned ephemeral port and closes its own browser/server afterward.

- Unit regression compares suggested prices with real economy operations, checks guaranteed enhancement boundaries, selected equipment, skill unlocks, mastery prerequisites, missing resources and read-only evaluation.
- Chromium reproduces actual 4-1 death, clicks the native preparation button without spending gems, and later wins a completed stage with the earned hero to verify victory restoration.
- Chromium, Firefox and WebKit replay explicitly labeled result fixtures at 320×568, 390×844 and 667×375, checking clipping, hit targets, scroll reachability, keyboard activation/close and unchanged save values after each destination opens. Chromium also checks stale resources and hero selection.
- The existing PWA fullscreen/standalone manifest, install instructions/focus return and absence of Neve during active combat are checked locally.

Output is `work/defeat-growth-qa/report.json` with source/build hashes and screenshots. Viewport/touch emulation and `scrollIntoViewIfNeeded` do not certify physical touch scrolling, Android/iOS installation, audio output or thermal performance. Actual OS-installed PWA, real-network party completion and store/payment/ad release remain separate unfinished work.
