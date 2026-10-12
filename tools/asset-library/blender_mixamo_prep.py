# Tripo GLB -> Mixamo 업로드용 FBX 정리(원본은 건드리지 않는다)
# 사용: blender -b -P blender_mixamo_prep.py -- <in.glb> <out.fbx> [height_m]
import bpy, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
height = float(argv[2]) if len(argv) > 2 else 1.8

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# 메시 외 오브젝트 제거, 메시는 하나로 합친다
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    o.parent = None
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 경계 상자 기준: 발바닥을 원점, 수평 중심을 원점으로, 키를 height 로
co = [obj.matrix_world @ v.co for v in obj.data.vertices]
mn = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
mx = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
h = mx.z - mn.z
s = height / h if h > 0 else 1.0
obj.location = (-(mn.x + mx.x) / 2 * s, -(mn.y + mx.y) / 2 * s, -mn.z * s)
obj.scale = (s, s, s)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 노멀 정리
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
obj.name = os.path.splitext(os.path.basename(dst))[0]

os.makedirs(os.path.dirname(dst), exist_ok=True)
bpy.ops.export_scene.fbx(filepath=dst, use_selection=False, path_mode='COPY', embed_textures=True,
                         apply_scale_options='FBX_SCALE_ALL', axis_forward='-Z', axis_up='Y', add_leaf_bones=False)
print('PREP_OK', dst, 'tris', sum(len(p.vertices) - 2 for p in obj.data.polygons), 'scale', round(s, 4))

