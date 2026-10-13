# GLB 의 지정 클립·프레임 포즈를 정사영으로 렌더해 PNG 들로 남긴다(타격 프레임 육안 검증용).
# 사용: blender -b --python blender_pose_sheet.py -- --input x.glb --out-dir d --plan '{"attack":[0,0.3,0.56,0.8]}' [--view 34|side|front]
import bpy, json, math, os, sys
from mathutils import Vector

def arg(n, d=None):
  a = sys.argv[sys.argv.index('--') + 1:]
  return a[a.index('--' + n) + 1] if '--' + n in a else d

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=arg('input'))
for c in list(bpy.data.collections):
  if c.name == 'glTF_not_exported':
    for o in list(c.objects): bpy.data.objects.remove(o, do_unlink=True)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'TEXTURE'
scene.render.film_transparent = True
size = int(arg('size', '320')); scene.render.resolution_x = size; scene.render.resolution_y = size
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'
h = max((o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box)
cam.data.ortho_scale = h * 1.55
view = arg('view', '34')
ang = {'34': math.radians(35), 'side': math.radians(90), 'front': 0.0}[view]
# glTF 정면 +Z(three) == Blender -Y. 정면에서 보도록 -Y 쪽에 카메라를 둔다.
d = h * 3
cam.location = (math.sin(ang) * d, -math.cos(ang) * d, h * 0.55)
cam.rotation_euler = (math.radians(90), 0, ang)
plan = json.loads(arg('plan'))
ad = arm.animation_data or arm.animation_data_create()
out = arg('out-dir'); os.makedirs(out, exist_ok=True)
for name, fracs in plan.items():
  act = bpy.data.actions.get(name) or next((a for a in bpy.data.actions if a.name.startswith(name + '_') or a.name == name), None)
  if act is None: print('NOACTION', name); continue
  ad.action = act
  if len(act.slots): ad.action_slot = act.slots[0]
  s, e = act.frame_range
  for i, fr in enumerate(fracs):
    f = s + (e - s) * fr
    scene.frame_set(int(f), subframe=f - int(f))
    scene.render.filepath = os.path.join(out, '%s_%02d.png' % (name, i))
    bpy.ops.render.render(write_still=True)
print('POSE_SHEET_OK')

