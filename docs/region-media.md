# Regional music and encounter art

This release replaces repeated arena and campaign portraits with 30 independent GUI-generated illustrations and gives the lobby, six campaign regions, arena and boss combat nine distinct FlowMusic tracks. It also preserves chapter-six discovery/floor progress after reload and fixes missing or horizontally split fire pillars during dense combat.

## Media provenance

- [Portrait manifest](media/encounter-art.json): 3 GUI batches of 10 independent originals, authenticated IAB downloads, shot-to-encounter mapping, dimensions and source/output SHA-256. Each 1254×1254 original is preserved under `work/media-20260913/sets/`; production uses whole-image 768×768 WebP quality 90. Inspection contact sheets are review artifacts only.
- [Audio manifest](media/region-audio.json): nine separate FlowMusic song IDs, source/output hashes, full decode results, duration and measured final loudness. Complete compositions are retained, normalized around −18 LUFS, and encoded as stereo 48 kHz MP3. The 5 ms edge fades prevent clicks; they are not evidence of a seamless musical loop.
- FlowMusic generation used its authenticated GUI. IAB could not export its audio media through `pageAssets`; the exact public generated file URLs observed in audio elements were transferred with authorized development tools. The image assets used authenticated IAB `pageAssets` throughout.
- FlowMusic explicitly confirmed on 2026-09-13 that its current generation tools cannot create isolated dry short game SFX one-shots. Existing score-derived impact accents remain musical accents; primary hit sounds remain Kenney CC0 samples plus procedural transients. No new isolated FlowMusic Foley is claimed.

## Runtime behavior

`musicForScene` is the single route for lobby, dungeon start, boss entry, revival and expedition intro completion. Chapter six has a dedicated homecoming cue even though its world theme inherits garden. Arena keeps its own cue during boss/respawn states. A late intro completion cannot replace a newer battle or lobby track. BGM is streamed only when its scene is entered and is not bulk-preloaded or precached by the PWA service worker.

Arena cards and in-battle opponent portraits use the same rival identity. All 24 campaign encounter identities and the three base bosses have distinct images. The illustrations are 2D UI assets; this patch does not turn them into new animated 3D actors.

Arena portrait sizing is limited to the direct portrait image, so nested reward icons keep their compact size. Duel buttons retain a minimum 44 px touch target on mobile.

Fire pillars share the original texture and use a per-effect UV uniform, so more than 16 simultaneous pillars remain visible. The non-tileable flame image keeps its top and bottom fixed while the interior flows; its original color, opacity curve and two crossed planes remain. The material participates in `FX.prepare` shader warmup, and cleanup preserves shared source textures.

## Verification and limits

Reproduction commands: `bun run check`, `node tools/fx-runtime-qa.mjs`, `node tools/region-audio-qa.mjs`, and `node tools/app-screen-qa.mjs --url=http://127.0.0.1:5225/` against a local build preview. Runtime reports and PNGs are saved under `work/`.

The real-file audio run verified all nine tracks in Chromium and Firefox, including time advancement, nonzero analyser signal after the preceding fade ended, bounded scene transitions, silence on mute and correct resume. This host's Playwright WebKit 26.5 exposes neither `AudioContext` nor `webkitAudioContext`; its audio run is **unsupported**, and the three-engine audio command deliberately does not report an overall pass. That limitation does not substitute for an iPhone/Safari audio test.

Software GPU browser rendering and mobile viewport tests do not certify physical Android/iOS GPU performance, installed PWA launch, temperature or subjective audio quality. New 3D actors, more independent boss behaviors, deeper dungeon objectives and long-term progression remain part of the active content goal. The current 60-stage campaign is not represented as a year of completed content.
