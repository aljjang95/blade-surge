# Blade Surge visual coherence recovery

Branch baseline: `eb66884181598d88191576b8d221dadb4d62a126` (V3 hero/combat overhaul). Live production observed at task start: `1fcd4d82679b24c8073d2fc27631e2664840ad3f`.

This patch is deliberately presentation-focused. It does not import the separate combo-link gameplay work.

## Locked hierarchy

1. Hero, enemies, telegraphs and traversable space.
2. HP/MP, attack/dodge, unlocked skills and boss HP.
3. Stage, objective, combo, proc notices and damage numbers.
4. Decorative glow and repeated labels must never outrank combat.

## Changes

- Replace the pale Oath Hall V2 runtime environment with the authored Sanctuary V2 scene and darker split lighting.
- Remove the floating-ring lobby composition that intersects the hero silhouette.
- Bound simultaneous damage-number presentation to 4 ordinary / 8 critical-or-finisher labels without changing damage.
- Reduce combo, wave banner, combat-notice and idle HUD emphasis.
- Preserve V3 hero assets, camera/input policy, contact tiers/VFX, combat mechanics, progression, saves, economy and controls.

Primary review viewport is 640x360 landscape; 880x400 and 360x740 remain regression layouts.
