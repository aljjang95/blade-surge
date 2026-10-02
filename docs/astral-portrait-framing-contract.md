# Astral standard portrait framing prerequisite

This source-only candidate consciously replaces the earlier camera-unmodified limitation with a narrowly scoped aspect-fitting requirement. The original quality gates are unchanged: actual phone-context images must show the complete required physical circles, readable letter/glyph/one-second labels, unobscured hero feet and readable hourglass clue, with actual input/selection/reset/seal/victory/settlement/cleanup proof. The prior portrait rejection remains a rejection; no old capture is promoted.

## Exact scope and geometry

Only normal solo `astral_leviathan_spire`, dungeon kind, explicit standard depth, with no party/rift/conquest, receives `battleMinimumAspect = 0.8`. All other stages and missing/invalid scope receive zero. The visual profile is shared by other routes/deep and cannot activate this feature alone.

At actual projection aspect below0.8, scale is `min(2.4, 0.8/aspect)`. At/above0.8 or invalid aspect/minimum it is exactly1 and returns the existing controlled offset without further arithmetic. Desktop and all other routes preserve existing camera results.

The fit moves only the camera along its existing camera-to-look-point ray. If the existing target-relative controlled offset is `O` and lookOffset is `L`, the new offset is `L + s*(O-L)`. This preserves the actual optical yaw/pitch; uniformly multiplying O alone would tilt the view because L is nonzero. The normal target, threat/boss tracking, lookOffset, rig/base/preset offset, authored camera, user yaw/pitch/zoom, normal FOV/resize behavior, lag and gameplay remain their current owners. User zoom retains its original relative effect on camera-to-look-point distance. No shake/impact zoom/fullscreen pulse, new render target, actor or circle/layout mutation is introduced.

`setBattleVisual(visual, stage)` sets/reset the field before the missing-camera return. Normal start passes its explicit stage after its existing generation guard. `stop()` resets the one scalar field synchronously and preserves other visual/user settings. A stopped stale start cannot re-enable it after its awaited view preparation. The existing pose interpolation remains; the first-frame/orientation transition must therefore be checked as well as the settled frame. The cap protects exceptionally narrow layouts and is not proof of full coverage at all aspect ratios or user-chosen zoom settings.

## PAD-only density

The hourglass boards retain512×176 canvases and their existing fonts/placements. Only the12 pad canvases become256×88 with bold32 identity / bold28 instruction fonts and baselines34/70. Their existing2.35×0.8 world size, glyph/ring geometry, colors, normal blending and code/actual hold content are unchanged. Metadata drives canvas dimensions, full background clearing/fill and text center/baselines; no512-size drawing is left on a256-size canvas. The texture count remains16; source base pixel storage decreases without claiming measured GPU bytes or improved performance. Actual readability after increased distance is a fresh image gate.

## Source-only regressions and remaining proof

Prepared tests cover exact scope exclusions, invalid/bounded aspect, optical direction and zoom preservation, actual authored/default ground circle frustum samples, repeated pose update and portrait↔landscape behavior, missing-camera/deep/other-route reset, actual start→renderer wiring, stop/stale async preparation, and PAD-only drawing/identity/hold/resource count. The preexisting outside-pad-radius assertion and all prior assertions remain. These sources were not executed, typechecked or built.

The owning helper must settle the camera through real native RAF time using renderer.update(0, realDt) and draw the current GPU frame while proving gameplay elapsed, HP, position, phase/read/hold/progress, economy and outcomes do not advance. It must dismiss portrait orientation UI through the actual native continue control. No synthetic Date, actor/target write or changed outcome can create a PASS.

Fresh exact-clean production SHA, desktop and390×844 actual phone-context image/input proof, full unit/type/build checks, actual resource disposal/lifetime and appropriate performance verification remain required in the owning loop. Generic main-campaign strict5pairs do not exercise this Astral-specific framing/view. No browser/metrics/job/test/build ran in this source-only preparation; no visual, resource, AAA or retention approval is claimed.

## Companion occlusion repair

The first aspect-fit candidate passed native inputs/AUTO/settlement/lifetime but its actual C instruction was hidden by a companion hat. That visual rejection and original images are retained. Only the quiet-phase A/C pad boards are raised from1.0 to2.25m; the B board retains its original1.0m height to clear the A selection circle and hero feet. All compact boards are drawn with depthTest=false/renderOrder20 so code, glyph and actual hold time stay readable behind companions. Circle/glyph ground geometry retains normal depth, world coordinates and selection radius; a standing actor can still occupy/obscure a ground symbol, so the corresponding visible overhead code/glyph must provide the same unambiguous identity. The number/clue board, combat visibility gate, user controls and mechanics are unchanged. New actual centre/selected-pad images must verify labels do not cover the hero/feet or overlap other labels/HUD; source flags alone are not visual approval.

The intermediate all-labels-raised candidate was rejected because its B board covered the A circle and hero foot ring. That raw rejection remains preserved. The retained B height and raised A/C anchors require fresh exact-head images and actual-input validation.

## Native resize boundary

In the exact fitted battle scope, resize now applies the new/previous aspect-scale ratio to the current rig and camera positions around the unchanged look point before another input frame. Quaternion, target, lookOffset, base/controlled offsets, user controls and game clock/actors are unchanged. Ratio1, disabled routes, lobby and quality-only/same-aspect resize preserve the pose exactly; subsequent normal camera lag remains. This addresses orientation resize, not same-aspect battle entry. Earlier testPause first-resize PNGs are first GPU observations after native continuation, not proof of a normal-loop one-second occlusion. Fresh boundary and settled images must be reviewed separately.

## Desktop HUD clearance

The intermediate boundary candidate passed native neighboring combat/35HP loss/read recovery and the requested mobile image cases, but desktop medicine buttons covered the B circle edge. That original rejection is retained. Only the Astral-standard controller scopes a persistent HUD class, cleared when the HUD closes; landscape viewports at least800px wide and551px high place the existing medicine row at150px plus safe inset rather than at screen centre. Controls, items, cooldowns and phone layouts keep their owners. Fresh actual desktop/mobile images, observed DOM rectangle, lobby class cleanup and existing regressions remain required.
