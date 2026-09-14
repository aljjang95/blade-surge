# Ability VFX signatures

Elemental skills now use a small authored signature table in `src/engine/fx.js`.
Each school selects its own atlas pair, palette, radius and particle profile while
reusing the existing FX scheduler, particle pools and VFX textures.

## Runtime contract

- `FX.prototype.abilitySignature(position, profile, options)` clamps scale and
  lifetime so scripted skill data cannot create unbounded effects.
- Heavy casts add a larger ring, flash and light cue. Fire may add the existing
  fire pillar on the normal quality tier; the low quality tier omits that pillar.
- Projectile impacts pass `explode.profile` to `Battle.explode`, so legacy
  projectiles keep their generic effect and profiled impacts do not stack a
  second generic explosion over the authored silhouette.
- The method uses the existing elapsed-time FX cleanup path. No new renderer or
  external asset dependency is introduced.

## QA evidence

`tools/ability-vfx-qa.mjs` boots the compiled Vite bundle in Chromium, starts a
real Mage battle from the acquired save, invokes five real skill state
transitions, and captures each rendered frame. It does not modify HP, damage,
position, kills or victory state. The generated report and PNGs live under
`work/ability-vfx-qa/` and are local QA evidence, not shipped assets.
