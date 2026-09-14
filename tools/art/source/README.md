# Armory v1 source

`armory-v1.blend` is the editable source for 24 original low-poly equipment objects arranged in a four-column, six-row layout. It contains the studio camera, materials and lights used for the isolated icon renders. No purchased, downloaded or generated-provider assets were used.

Reproduce from the repository root with the installed Blender 5.2 executable:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python tools/art/build-armory-v1.py
```

The script exports individual GLBs to `public/models/armory-v1`, 256×256 transparent PNG renders to `public/img/armory-v1`, the source here, and SHA-256 provenance to `work/owner-expansion-20260914/asset-manifest.json`. It does not touch the existing character or weapon sources. Treat an edited source or regenerated export as a new candidate and rerun asset and visual checks.
