# 2026-09-11 QA release

## Changes
- All five base classes are selectable immediately. Clicking a hero card commits the actual sortie selection and preserves it after save reload; legacy growth and equipment remain intact.
- Ten independent original GUI images supply six unique ranger skill icons, cloth/metal/stone surface maps and the sanctuary vista. See `rsi-gui-art.json` for source pixels and hashes. Authored face/skin materials remain intact.
- Dropped equipment now has sword, cuirass, boots and ring geometry with shared textured materials. Lobby architecture gains carved columns, wall panels, metal trim, banners and the sanctuary vista. Missing tower crypt/throne/abyss architecture is restored.
- Battle camera supports right drag, wheel, keyboard-accessible rotation pad, zoom and reset. Movement follows the actual camera bearing. Lobby camera controls move away from the upper-right menu.
- Garden expands to 13 rooms through two side chapels and alternate loops. Combat XP runs at 20% of authored rewards; rank bosses recover the original first boss HP baseline with increasing rank values.
- Empty boon summaries no longer reopen after all offers are consumed. Closing Chronicle releases only its own pause synchronously.
- PWA manifest, explicit update flow, bounded asset cache and offline explanation added. Gameplay requires internet. Purchase/ads remain unavailable until real providers and validation exist; no simulated paid rewards are granted.

## Evidence
- Local `bun run check`: 401 tests, 18,459 assertions before final loot-light/material and product-copy edits; final check receipt is in the local release evidence.
- 2,000 deterministic first-floor roster samples stay at level 3–5. This is a progression simulation, not 2,000 complete battles.
- Native IAB actual 13/13-room AUTO victory: 163.15s, 204 kills, 22 peak enemies, 48 equipment pickups, maximum reward drought 14s, peak missing-health ratio .128; level 1→4. Boot 1.72s, peak draw calls 297. All existing numeric bands pass. Baseline was 112.85s/168 kills/11 rooms and already failed the duration band.
- Same host baseline/head draw calls 265→297 (+12.1%, allowed +20%). CPU submission averages .23→.22ms. These are native IAB GPU measurements; they do not establish SwiftShader cost, real-device FPS, or GPU completion time. Choice trace matches the seven recorded baseline UI choices. Baseline HP used 2s sampling, final HP is sampled every simulation step to retain damage before healing.
- Actual UI: mage selection→home model→battle identity; mouse camera rotates without movement; 1280×720, 740×360 and 390×844 portrait continuation inspected. Four slot silhouettes and actual hero UV/map presence inspected. Generated scene assets are visible in runtime.
- PWA old/new worker wait and explicit update→reload verified. Old caches removed. Local preview server stopped during test: navigation showed the offline page, then returned after server restart. No fake network-offline emulation result used.
- Independent reviews: no P1/P2 found in hero save/selection or PWA/commerce patch. Balance review found genuine pre-existing progression/encounter debt and two QA/UI pause issues, all addressed.

## Remaining release work
- Actual touch events are unavailable through this IAB CDP implementation. Physical Android input/performance remains unverified.
- In-app ads, IAP receipt validation, One Store and Google Play packages/submissions are pending. Web/PWA comes first, followed by One Store then Play.
- Existing Flow score and score-derived impact clips plus the existing Veo 3.1 garden film remain. No new Flow Music generation, isolated Foley, Omni1.1 or Blender/Unity production output is claimed in this patch. This is a Three.js/WebGL2 web project, with its existing React Three Fiber companion surface; there is no Unity project to migrate blindly.
- Future RSI heartbeat: `bladesurge-qa-rsi`, every 2 hours, current task, meaningful changes only. One bounded improvement per cycle with real checks before release.
