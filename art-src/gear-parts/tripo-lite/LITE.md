# Tripo 媛먮웾 ?щ낯 ?곸닔利?n
- ?꾧뎄: Blender 5.2 (?ㅻ뱶由ъ뒪 `blender -b -P lite.py`)
- 泥섎━: glTF 媛?몄삤湲?-> 硫붿떆 蹂묓빀 -> Decimate(COLLAPSE, ?쇨컖?? ??30,000 tri -> ?띿뒪泥?理쒕? 1024px 異뺤냼 -> GLB ?대낫?닿린(JPEG q90). 異??먯젏/?ㅼ???誘몃?寃??뺢퇋?붾뒗 ?대씪?곕뱶).
- ?먮낯: PC `C:\Work\tasks\blade-gear-art\tripo\` ??洹몃?濡?蹂댁〈.

| ?뚰듃 | ?먮낯 sha256 | 媛먮웾蹂?sha256 | ?ш린(byte) | ?쇨컖??|
|---|---|---|---|---|
| helm_n | 684f6bf36ebe441e327f683b1afa9d78f92f3ae76ac03bd2b5d3c68c116e393d | cb2c82f9d164cd93e299618cf1ecfa7bc7c25941dfba079525f8825696540b14 | 1407720 | 1954808 -> 30000 |
| helm_e | 35d37dc801f50297998c11a70a872ae76b2b567af99d4ac46cdced8c495b0ada | 3196ca05d3bbf24e4eb2baff061702f692dd4f9dd38ef54a3958d94337d1a8b6 | 1521356 | 1892535 -> 30000 |
| helm_l | 1eec820df81b5fa06759a347bbc6a8320b5e7e9a63ca8b94b84c6d907ff91dcc | 5b7f7a4c4336f5dd417d55ceec8bbeb023f07bf0e6c69a1cb7bd37209b73d97a | 1555284 | 1935498 -> 29999 |
| pauldron_n | 903a7b65b44a265572154dfc35c0a01c0641c9a54fb9f08cb1ea00e1d3558f0b | 41851f24f972f76b2e919a16a9d26dd9356b55cd712aacc31f429671e6f5df98 | 1384412 | 1916300 -> 30000 |
| pauldron_e | 34f082840bb7bf3b83ba59767d9beb1b96af6fa3fefc9117c2b60c36c52e5213 | 78c2c873e5685a34d2cca5146cff114875a267cbb8925df08957074f0fb91f63 | 1424272 | 1895446 -> 30000 |
| pauldron_l | e015ba09063a2a1f5ffed9466f60d82149c1af1d65c37d4634f3c375a1b82f0f | c54f014af30754939e744c699f18f5b31acad7bc71cc9d0965ac07e0881a6293 | 1528328 | 1938742 -> 29999 |
| gauntlet_n | 6cd7c9c9b0c0cc0017b9862d24ea36f9a488b1c59a2e0aea791a41c3814386cb | 9c5c6804348fed5568f7661f854da5a9d2a37608d9e98050488d84d9bde069dc | 1309236 | 1925988 -> 30000 |
| gauntlet_e | cde88d5b0c3a64099925f11b5665e58289bb90b06c402bfd593c825d9c9a36c9 | a350b1cfc5261f8ecee4e67285709466327f4fbf728e75fb8d92e71f1bb361bd | 1505112 | 1965634 -> 30000 |
| gauntlet_l | d178373ac5c45875f35856cb3350fb9f1ff40a3658769e98f306fc29496f70ed | c4edc01cac127e9ef854a406229275c84b3c2ead9aaa339721c98963ecc071dc | 1530592 | 1896362 -> 29999 |

## ?ㅽ겕由쏀듃 ?꾨Ц (lite.py)

```python
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

```n