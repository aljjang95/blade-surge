import bpy, sys, os, json
# usage: blender -b -P lite.py -- <in_dir> <out_dir> <part> [<part> ...]
args = sys.argv[sys.argv.index("--") + 1:]
in_dir, out_dir, parts = args[0], args[1], args[2:]
TARGET_TRIS = 30000
MAX_TEX = 1024
os.makedirs(out_dir, exist_ok=True)
report = {}
for part in parts:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(in_dir, part + ".glb"))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # bake parent transforms is avoided: join keeps world transform of each object
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    dg = bpy.context.evaluated_depsgraph_get()
    def tris(o):
        m = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        n = sum(len(p.vertices) - 2 for p in m.polygons)
        o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
        return n
    before = tris(obj)
    mod = obj.modifiers.new("dec", 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, TARGET_TRIS / max(before, 1))
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = tris(obj)
    for img in bpy.data.images:
        if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
            w, h = img.size
            s = MAX_TEX / max(w, h)
            img.scale(max(1, int(w * s)), max(1, int(h * s)))
    out = os.path.join(out_dir, part + ".glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB',
                              export_image_format='JPEG', export_image_quality=90,
                              use_selection=False)
    report[part] = {"tris_before": before, "tris_after": after, "bytes": os.path.getsize(out),
                    "objects_joined": len(meshes)}
    print("LITE_RESULT", part, json.dumps(report[part]), flush=True)
with open(os.path.join(out_dir, "_report_" + parts[0] + ".json"), "w") as f:
    json.dump(report, f)
