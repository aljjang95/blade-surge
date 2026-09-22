# Dream Loop — bounded source candidate, 2026-09-22

Status: **review-required**. This change is not a visual PASS, release, or running background job.

## Reuse the original skill

The repository pins `achimala/dream-loop` at `9bddb901f7d071cfefdd21e264267c757177a9df` as `.agents/skills/dream-loop`. Initialize only this dependency with:

```sh
git submodule update --init --checkout -- .agents/skills/dream-loop
git -C .agents/skills/dream-loop rev-parse HEAD
```

The second command must report the pinned commit. Do not use `--remote`, `--force`, copy credentials, or change the model/provider/effort settings. A recorded gitlink does not prove checkout initialization or runtime skill discovery. Read its `SKILL.md` and Pro workflow. This is a reused skill inside APEX Universal Harness, not a second game harness.

Authority: `aljjang95/apex-skill-forge@main:runtime/portable/owner-goal.v1.json`, `docs/APEX_GLOBAL_LIVING_CONSTITUTION.md`, and `workspace/living-constitution.json`; current owner routing instructions override historical model names. The builder cannot approve this candidate.

## Applied source changes

- Preserve the bloom input aspect with one scale for both axes. At 1920x1080, the previous 320x320 input becomes 320x180 within the existing cap. This is a buffer-pixel reduction, not a measured FPS gain.
- Use exponential FOV interpolation. No camera preset, target framing, gameplay RNG, full-screen shake, bloom strength, or asset is changed.

## Verified here

`node --test tools/render-math.test.mjs`: 16 tests passed in the ChatGPT Linux container with Node 22.16.0. Only the new pure module and its tests were executed. The full repository could not be cloned or dependencies fetched because container DNS/network access failed. No existing game build/test result is attributed to this candidate.

## Required next verification

Use an exact-tree checkout of this candidate and the rollback baseline `73cd2fc0f647828336a7cba87a75681d08c85dbe`. Preserve any unrelated local work. Run `bun run check`, then capture the same lobby and combat scene at 1920x1080, 844x390, 640x360 and portrait fallback. Bind camera, scene, seed, graphics settings, GPU and frame-time samples to the respective SHA. No current live baseline/target is available from this GitHub-only run: capture baseline before generating a refined in-engine target. Do not substitute concept art or a fabricated screenshot.

Compare baseline, target and candidate in a fresh independent review: composition 0–3, lighting 0–3, materials 0–3, detail 0–1. Score >=8 is not sufficient without acceptable target-runtime performance and regressions. At most two bounded rounds before re-evaluating the approach; never endless polling. Retain only independently verified net gains.

The canonical merge gates still require exact-tree CI/build, independent review and signed Proof. No GitHub Actions, production deployment, permission change, real spend, raw session IDs or transcripts were added. Rollback is a reviewed revert of this scoped commit; no forced reset/push. Rehydrate the existing session from repository state when execution is available; this document does not dispatch it.
