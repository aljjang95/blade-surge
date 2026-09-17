# TLL Sanctuary V2

`sanctuary-v2.blend` is the editable Blender source (588 objects, studio camera/light separate).
`sanctuary-v2-beauty.png` is a real Blender environment render, not a runtime screenshot.
`before-game-lobby.png` and `candidate-game-lobby.png` are actual same-size game screenshots.
`candidate-link-ready.png` shows a real Lv1 campaign input sequence; no high-level equipment was injected.
The original hero model/skin/rig files are unchanged. All new environment geometry was authored in this task.
Export: `blender --background --factory-startup --python tools/art/build-sanctuary-v2.py`.
Verify: `blender --background art/sanctuary-v2/sanctuary-v2.blend --python tools/art/verify-sanctuary-v2.py`.
Runtime GLB and SHA256 manifest: `public/models/sanctuary-v2/`.
