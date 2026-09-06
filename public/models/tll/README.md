# Oathbound appearance, v1

TLL-authored headwear, armour, clothing and articulated limbs, produced in Blender 5.1 by `tools/art/author-identity.py`.
These GLBs are fittings, not standalone animated characters. `assembleHeroIdentity` binds them to the original shipped skeleton.

The final composite preserves KayKit CC0 faces, skeletons, animation and selectable weapons. It is a derivative character redesign, not a claim of exclusive ownership over the original assets. Original GLBs and source credit remain available. Monsters and the skeletal companion retain their original designs in this change.

Reproduce with Blender background mode and `--python-exit-code 1 --python tools/art/author-identity.py -- --masters <new revision directory>`. A nonempty masters directory is rejected. Headband contours are measured from the original source geometry and bound to its SHA-256 in `tools/art/head-profiles.json`. The shipped square PNG portraits are UI avatar textures rendered from the assembled runtime models, using `tools/art/render-portraits.js`; they do not define the landscape game viewport.

Visual decisions: Arca — ivory crown and split cuirass; Drakan — exposed torso, war harness and asymmetric shoulder armour; Ria — long astral robe and star diadem; Cain — dark hood, lower-face mask and diagonal baldric. Their names, combat roles and statistics are unchanged.
