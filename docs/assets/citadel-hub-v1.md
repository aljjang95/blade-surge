# Citadel hub assets v1

The pack contains twelve distinct dungeon gateways, three civilian NPCs and five modular plaza props, each with a lower-detail GLB. Geometry is authored in Blender 5.2.1 LTS from original GPT visual references. Gateways are 3 × 3.4 × 0.55 metres with an open passage; NPCs are 1.75 metres tall. All models use a ground-centred origin, glTF Y-up and a visible front toward +Z.

The exact gateway paths are `/models/citadel-hub-v1/gate-<id>.glb`, where `<id>` is `glass_garden`, `ember_vault`, `star_archive`, `bellfall_crypt`, `cinder_tide_lock`, `nightglass_observatory`, `eclipse_hydra_vault`, `ashforge_catacomb`, `astral_leviathan_spire`, `verdigris_sanctum`, `sable_mirage_basin` or `comet_bastion`. Each is tied to an existing `DUNGEONS` entry, with an enlarged physical crown and route-specific shoulder silhouette.

`merchant.glb` serves the potion merchant, `alchemist.glb` serves the trainer and `arena-steward.glb` serves the arena steward. These are complete static environmental characters; they are not combat rigs. The prop paths are `paving.glb`, `planter.glb`, `bench.glb`, `lamp.glb` and `stall.glb`. Append `-lod1` before `.glb` for the reduced variant. Quiet slate paving leaves the live compass and route inlays to the scene. Stair and alchemy-counter recipes remain in the generator but their unused exports are excluded from the public pack.

Shared 256 px base-color and tangent-space normal maps are baked in Blender and referenced through standard relative GLB image URIs in `textures/`. Preserve that folder with the models. Materials use authored roughness and metalness; static surfaces are batched by material. Every runtime file, shared texture, bounds, triangle count, draw count and hash is recorded in `public/models/citadel-hub-v1/manifest.json`.

Rebuild from the repository root:

```bash
source /workspace/.blade-surge-tools/env.sh
"$BLENDER_BIN" --background --python-exit-code 1 --python tools/build-citadel-assets.py
```

The three GPT reference images, sheet prompts and tool-run provenance are tracked in `docs/assets/citadel-hub-v1/reference-source/`. The generator hashes those retained files when rebuilding. The editable `citadel-hub-v1.blend` and actual Blender preview renders remain locally under `work/art/citadel-hub-v1/`; the original imagegen outputs remain in `/workspace/generated_images/`. Rebuild does not submit further generation requests.

The sheets and isolated transparent gateway were generated through the native `image_gen.imagegen` tool, then visually inspected. An independent critic accepted the direction before the full sheet batch and reviewed the revised Blender previews. Character proportions, recessed eyes and sculpted hair were adjusted to fit the current heroes. Gate crowns were enlarged after silhouette review; repeating gold paving motifs and bright tile borders were removed after actual runtime review.

TRELLIS is not represented as completed geometry. This machine has no local TRELLIS/torch installation or detected GPU. One authorized anonymous run against the official Microsoft TRELLIS.2 Hugging Face Space accepted and preprocessed the isolated RGBA reference, then `image_to_3d` failed with a provider quota response. No GLB was produced, no retry or paid fallback ran. Exact evidence and the Space revision are in the manifest. A separate, explicit free quota or approved inference route is needed to continue that step; the Blender pack is independently usable.

Rights: original authored geometry and native generated visual references; no third-party model or texture is imported. Existing heroes and their KayKit/TLL rights remain in their own source assets. Runtime integration and final walking-camera approval are recorded separately from image generation and successful export.
