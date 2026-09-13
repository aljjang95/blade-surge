# Rift encounters and regional bosses

Daily rifts now change combat decisions. Iron enemies block 45% of incoming
damage until the existing combo/finisher system opens BREAK. Fury fixes a warning
disk at the player's position; leaving the radius or successfully evading the
blast exposes its caster for 2.5 seconds. Siege marks a herald for five seconds;
defeating it prevents two reinforcements. Reinforcements use the existing active
enemy limit and room accounting and grant no extra rewards.

The dungeon rotates daily and the rule every three days, covering all nine pairs
in nine days. A ticket's rule does not change at midnight. Full-page reload still
cancels/refunds an unfinished expedition; this patch does not add resumable runs.
Warnings pause with the battle and disappear when the room or run ends. Reentering
a siege room keeps its herald/countdown and cannot trigger a second call.

All six campaign finales now select different Blender-authored 3D fittings and
keep their established combat stats, reward contracts and original animation
clips. Boss portraits and BGM continue to use the preceding regional media patch.
Model details and source attribution are in `public/models/tll/encounters/README.md`.

An additional dogfooding fix removes an incorrect 180-degree visual turn from all
26 original Quaternius monsters. Their inspected original meshes face +Z, matching
the game's attack/movement direction. Both local actors and party replicas read
the corrected rig flags. Damage, projectile direction and movement rules are unchanged.

Reproduce local checks:

```
bun run check
node tools/rift-runtime-qa.mjs
node tools/encounter-runtime-qa.mjs
node tools/art/encounter-preview.mjs Skeleton_BellKing Big_KilnTyrant Big_ArchiveMonarch Flying_AbyssRegent Skeleton_HollowRegent Skeleton_OathRemnant
node tools/app-screen-qa.mjs --url=http://127.0.0.1:5225/
```

The final command needs a local production preview. Runtime tools use isolated
browser saves, actual app code and rendered WebGL, with controlled setup and time
steps. They do not certify an organic playthrough, reward settlement, physical
Android/iPhone rendering, installed PWA behavior, thermal load or sustainable
year-long content. Chromium here reports a SwiftShader software GPU.

Asset byte hashes are in `docs/media/encounter-models.json`; source-bound local
evidence is in `docs/qa/encounter-models-20260913.json` and the rift QA packet.
After the guarded deployment, `node tools/verify-encounter-live.mjs <full-sha>`
checks the clean version, actual HTML entry bytes and all six new GLB hashes on
both production origins. It requires the matching local production build.
