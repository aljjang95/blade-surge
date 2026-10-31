"""활 GLB 를 템플릿 규약(손잡이가 활 끝보다 +X 쪽, 활 평면 = XY)으로 돌린다.

사용: blender -b --python tools/asset-library/blender_bow_align.py -- <prepped.glb> <out.glb>
그 뒤 blender_weapon_prep.py 를 --grip-ratio 0.5 로 다시 돌린다(--wide-x/--face-x 없이).
판정: 길이축(glTF Y) 기준 손잡이 구간(|y| < 길이 5%)과 활 끝 구간(|y| > 길이 44%)의 가로 중심 차이 벡터를
+X 로 맞춘다. 활 끝은 시위가 걸리는 쪽이라 이 벡터가 활의 볼록한 방향이다(forge-bow-v2 는 +X).
"""
import math
import sys

import bpy
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
inp, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=inp)
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
mesh = obj.data
# Blender 는 Z-up: glTF Y == Blender Z(길이축), glTF X == Blender X, glTF Z == -Blender Y.
zs = [v.co.z for v in mesh.vertices]
length = max(zs) - min(zs)
grip, tips = [0.0, 0.0, 0], [0.0, 0.0, 0]
for v in mesh.vertices:
  t = abs(v.co.z) / length
  bucket = grip if t < 0.05 else tips if t > 0.44 else None
  if bucket is not None:
    bucket[0] += v.co.x; bucket[1] += v.co.y; bucket[2] += 1
if not grip[2] or not tips[2]:
  raise SystemExit('손잡이 또는 활 끝 구간 정점이 없음')
dx = grip[0] / grip[2] - tips[0] / tips[2]
dy = grip[1] / grip[2] - tips[1] / tips[2]
angle = math.atan2(dy, dx)
mesh.transform(Matrix.Rotation(-angle, 4, 'Z'))
mesh.update()
print(f'BOW_ALIGN rotated {-math.degrees(angle):.1f} deg (grip-tip {dx:.3f},{dy:.3f})')
props = bpy.ops.export_scene.gltf.get_rna_type().properties
wanted = {'filepath': out, 'export_format': 'GLB', 'export_yup': True, 'export_apply': True, 'export_animations': False,
          'export_skins': False, 'export_vertex_color': 'NONE', 'export_image_format': 'JPEG'}
bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in props})
