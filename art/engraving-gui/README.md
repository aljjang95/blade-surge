# ChatGPT GUI engraving sources

Ten 1086 x 1448 PNG sheets created in one authenticated ChatGPT web chat and one image-generation batch. The owner explicitly requested 12-cell collages, one set of ten sheets. Files were saved through the browser pageAssets capability. No Codex image_gen or direct image API was used.

`sources.json` maps visually verified content families to source SHA-256 hashes. `catalogue.json` records row-major cell names and existing gameplay roles. Private chat and account metadata are excluded from the published sources and manifest.

`tools/art/import-engraving-gui.mjs <absolute-output-directory>` mechanically extracts all cells, preserves native PNG crops, and creates 320x320 WebP with aspect ratio preserved. Install the pinned dependencies with `bun install --frozen-lockfile`; sharp 0.35.2 is a direct development dependency. It makes no network or generation calls.

The 120 icons are derivatives of ten original collages. Only twelve existing boons and three existing combat arts are mapped into gameplay; the other 105 are reserve artwork. Original seven prior WebP assets are preserved and checked by tests. Rejected SVG files and their generator are archived under work/rejected-svg-engraving and are not shipped.
