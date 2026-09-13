# Regional encounter surfaces

Six separately authored solid Blender fittings for the six campaign final bosses.
These GLBs contain geometry and PBR materials, with named-bone `tllBone` metadata.
They are assembled by `src/engine/encounter-identity.js` onto the unchanged CC0
KayKit / Quaternius character rigs. They are not standalone animated characters.

| Runtime model | Original rig | Distinguishing geometry |
| --- | --- | --- |
| Skeleton_BellKing | Skeleton_Warrior | Crown, hollow shoulder/back bells, clappers and belt chimes |
| Big_KilnTyrant | Big_Demon | Furnace chamber/grille, chimney pair and forged pauldrons |
| Big_ArchiveMonarch | Big_Yeti | Ice crown, mantle, books and rune tablet |
| Flying_AbyssRegent | Flying_Dragon_Evolved | Branched coral antlers, wing shells and layered chest scales |
| Skeleton_HollowRegent | Skeleton_Warrior | Open eye mask, diadem, shoulder rays and dark mantle |
| Skeleton_OathRemnant | Skeleton_Warrior | Broken crest, split breastplate and tabard |

Authored with installed Blender **5.1**, using `tools/art/author-encounters.py`.
Original source hashes are pinned in `tools/art/encounter-sources.json`. Every
master revision is kept locally in `work/encounter-models/rev-*/` as blend + GLB.
Use a new empty masters directory for each run. Do not overwrite originals.

The game shares original textures, buffers and animation clips and loads less
than 1 MB of extra delivery geometry for all six bosses. Authored surfaces batch
to three skinned meshes per boss and use the existing GUI-authored material maps.
Standalone inspection exports in `work/encounter-models/preview/*-assembled.glb`
are for TLL/Blender reimport, not additional production downloads.

The underlying source licenses remain in `public/models/`. These are new visual
variants of the existing rigs; they do not represent six newly animated skeletons,
a measured year of content, owner art approval, or physical-phone performance proof.
