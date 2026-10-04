# Original Jade tactics models v1

The gathering arch and release obelisk are original Blender-authored low-poly landmarks, based on the future dungeon concept sheet SHA256 `f9c29de159b2ef630668a14e324676a49adb873cd3dce0c4f5e45a7fce1d0568`. The image was generated through OpenAI imagegen for this project; its provider terms apply to that reference. No third-party meshes, textures, IP, TRELLIS conversion, or downloaded asset geometry enter these models. The original mesh recipe and resulting vertex data are project-authored assets under the repository's license; no independent third-party license is introduced.

Reproduce with Blender 5.2.1 LTS, one thread: `blender --background --factory-startup --threads 1 --python-exit-code 1 --python tools/art/build-jade-tactics-v1.py`. The source writes ignored GLB, blend, export/reimport receipts to `work/art/jade-tactics-v1/`, and tracked runtime data to `src/data/jade-tactics-geometry-v1.json`. It needs no reference pixels, network, random values, external packages, or render. Provenance source SHA is embedded in the runtime data.

| Model | Triangles | Width × height × depth (metres) |
| --- | ---: | --- |
| Gathering split arch | 508 | 2.080 × 2.673 × 0.760 |
| Release obelisk | 288 | 0.860 × 2.900 × 0.760 |

Both original models together use 796 triangles and three shared surface roles: stone, brass and ivory/jade. Runtime imports copied position/normal/RGB vertex colors and index data into the view's existing three merged static surfaces. UV zeros solely match the other floor geometry attribute layout; no texture/map feature is enabled. FrontSide, opaque, RGB rather than RGBA, roughness/metalness and receiveShadow preserve existing material flags. No lights, render targets, shader features, animations or shadow casters are added.

The complete current view is six mesh submissions and 1,126 triangles when both landmarks fit (local hard cap 1,600). This does not relax the game's global draw, CPU, or mobile budgets. Original ownership/disposal remains per-view geometry and material sets. The accepted full 2.2 × 1.1 metre footprint sampling, rear/side/corner relocation and omission rule remain unchanged; actual model coordinates fit inside that conservative footprint at scale/orientation 1. Tall meshes stay outside the existing Floor walk mask. Pads, inward anchor, eligibility radius, arrows, collision/player radius and controller state remain unchanged.

An ignored 512×512 Workbench preview uses an orthographic studio camera and preview-only model separation. It verifies authored shape only, not actual game framing, draw cost, reachable routes, crowd visibility or device performance. Fresh root-owned typecheck/build/full tests and runtime image/performance/native acceptance are required for this next branch; candidate67 evidence is not reused.
