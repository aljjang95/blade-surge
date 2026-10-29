"""Tripo 무기 GLB를 장비 무기 규약(손잡이 원점 · +Y 날 · 단일 메시/재질 · 3000삼각형)으로 정리한다.

사용: blender -b --python-exit-code 1 --python tools/asset-library/blender_weapon_prep.py -- \
  --input <tripo.glb> --output <prepped.glb> [--report <report.json>] [--target 3000] [--max 4000] \
  [--grip-ratio 0.18] [--grip-end bottom|top] [--flip] [--texture-max 1024] [--image-format JPEG|PNG|WEBP]

순서: 모든 메시 합치기(재질 1개) → 가장 긴 축을 +Y(glTF)로 → --flip / --grip-end 로 손잡이를 아래로
→ 원점을 손잡이 끝에서 전체 길이 * grip-ratio 지점(손잡이 중간)으로 → 삼각형 감축 → 정점색·스킨·애니 제거 → 내보내기.
Blender 는 Z-up 이라 내부에서는 길이축을 +Z 로 맞추고, glTF 내보내기(+Y up)에서 +Y 가 된다.
보고 JSON 의 bbox 는 glTF 좌표(x, y, z)다. 규약 위반이면 ok=false 이고 종료 코드 1.
"""
import json
import math
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

LENGTH_AXIS = 2  # Blender Z == glTF Y


def parse_args():
  argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
  args = {'--target': '3000', '--max': '4000', '--grip-ratio': '0.18', '--grip-end': 'bottom',
          '--texture-max': '1024', '--image-format': 'JPEG'}
  flags = {'--flip'}
  out = {'--flip': False}
  i = 0
  while i < len(argv):
    key = argv[i]
    if key in flags:
      out[key] = True; i += 1
    else:
      args[key] = argv[i + 1]; i += 2
  args.update(out)
  for required in ('--input', '--output'):
    if required not in args:
      raise SystemExit(f'missing {required}')
  if args['--grip-end'] not in ('bottom', 'top'):
    raise SystemExit('--grip-end must be bottom|top')
  return args


def to_gltf(vec):
  """Blender(x, y, z) → glTF(x, z, -y)."""
  return [round(vec.x, 5), round(vec.z, 5), round(-vec.y, 5)]


def world_points(obj):
  return [obj.matrix_world @ v.co for v in obj.data.vertices]


def bounds(points):
  lo = Vector((min(p[i] for p in points) for i in range(3)))
  hi = Vector((max(p[i] for p in points) for i in range(3)))
  return lo, hi


def join_meshes():
  meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
  if not meshes:
    raise SystemExit('no mesh in input')
  materials_seen = []
  for obj in meshes:
    # 스킨·셰이프키·정점 그룹 제거. 월드 변환을 굽고 부모를 끊는다.
    for mod in list(obj.modifiers):
      obj.modifiers.remove(mod)
    obj.shape_key_clear()
    obj.vertex_groups.clear()
    for slot in obj.material_slots:
      if slot.material and slot.material not in materials_seen:
        materials_seen.append(slot.material)
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(mw)
    obj.matrix_world = Matrix.Identity(4)
  bpy.ops.object.select_all(action='DESELECT')
  for obj in meshes:
    obj.select_set(True)
  bpy.context.view_layer.objects.active = meshes[0]
  if len(meshes) > 1:
    bpy.ops.object.join()
  merged = bpy.context.view_layer.objects.active
  # 재질 1개: 첫 재질(텍스처가 있는 것 우선)만 남긴다.
  keep = next((m for m in materials_seen if m.use_nodes and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes)), materials_seen[0] if materials_seen else None)
  merged.data.materials.clear()
  if keep is None:
    keep = bpy.data.materials.new('WeaponMaterial')
    keep.use_nodes = True
  merged.data.materials.append(keep)
  for poly in merged.data.polygons:
    poly.material_index = 0
  # 정점색 제거(런타임 재질은 정점색을 쓰지 않는다).
  for attr in list(merged.data.color_attributes):
    merged.data.color_attributes.remove(attr)
  merged.name = 'Weapon'
  merged.data.name = 'Weapon'
  for obj in list(bpy.context.scene.objects):
    if obj is not merged:
      bpy.data.objects.remove(obj, do_unlink=True)
  return merged, len(materials_seen)


def apply_matrix(obj, matrix):
  obj.data.transform(matrix)
  obj.data.update()


def orient(obj, args):
  lo, hi = bounds(world_points(obj))
  size = hi - lo
  axis_index = max(range(3), key=lambda i: size[i])
  axis = Vector((0, 0, 0)); axis[axis_index] = 1.0
  rotation = axis.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
  apply_matrix(obj, rotation)
  half_turn = Matrix.Rotation(math.pi, 4, 'X')  # 길이축(Z)을 뒤집는다.
  if args['--flip']:
    apply_matrix(obj, half_turn)
  if args['--grip-end'] == 'top':
    apply_matrix(obj, half_turn)
  return 'xyz'[axis_index]


def move_origin(obj, ratio):
  points = [v.co.copy() for v in obj.data.vertices]
  lo, hi = bounds(points)
  length = hi.z - lo.z
  origin_z = lo.z + ratio * length
  # 가로 중심은 손잡이 구간(아래 30%)의 상자 중심으로 잡는다. 칼날이 한쪽으로 치우쳐도 손잡이가 원점에 오게.
  grip = [p for p in points if p.z <= lo.z + 0.30 * length] or points
  glo, ghi = bounds(grip)
  offset = Vector(((glo.x + ghi.x) / 2, (glo.y + ghi.y) / 2, origin_z))
  apply_matrix(obj, Matrix.Translation(-offset))
  return length


def triangulate(obj):
  mesh = bmesh.new()
  mesh.from_mesh(obj.data)
  bmesh.ops.triangulate(mesh, faces=mesh.faces[:])
  mesh.to_mesh(obj.data)
  mesh.free()
  obj.data.update()


def decimate(obj, target, maximum):
  triangulate(obj)
  for _ in range(4):
    count = len(obj.data.polygons)
    if count <= target:
      break
    mod = obj.modifiers.new('Decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = max(0.02, min(1.0, target / count))
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    triangulate(obj)
  return len(obj.data.polygons)


def shrink_textures(limit):
  sizes = []
  for image in bpy.data.images:
    if image.users == 0 or image.size[0] == 0:
      continue
    width, height = image.size
    biggest = max(width, height)
    if biggest > limit:
      scale = limit / biggest
      image.scale(max(1, int(width * scale)), max(1, int(height * scale)))
    sizes.append([image.name, image.size[0], image.size[1]])
  return sizes


def export(path, image_format):
  props = bpy.ops.export_scene.gltf.get_rna_type().properties
  wanted = {
    'filepath': path, 'export_format': 'GLB', 'export_yup': True, 'export_apply': True,
    'export_animations': False, 'export_skins': False, 'export_morph': False, 'export_cameras': False,
    'export_lights': False, 'export_vertex_color': 'NONE', 'export_image_format': image_format,
    'export_active_vertex_color_when_no_material': False,
  }
  bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in props})


def main():
  args = parse_args()
  ratio = float(args['--grip-ratio'])
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=args['--input'])
  obj, material_count = join_meshes()
  long_axis = orient(obj, args)
  length = move_origin(obj, ratio)
  triangles = decimate(obj, int(args['--target']), int(args['--max']))
  # 감축 뒤 형태가 바뀌었을 수 있어 원점을 한 번 더 같은 규칙으로 맞춘다.
  length = move_origin(obj, ratio)
  textures = shrink_textures(int(args['--texture-max']))
  export(args['--output'], args['--image-format'])

  lo, hi = bounds([v.co for v in obj.data.vertices])
  grip_fraction = (0 - lo.z) / (hi.z - lo.z) if hi.z > lo.z else None
  errors = []
  if not (lo.z < 0 < hi.z):
    errors.append('origin-not-inside-length-axis')
  if grip_fraction is None or abs(grip_fraction - ratio) > 0.02:
    errors.append('grip-ratio-mismatch')
  if triangles > int(args['--max']):
    errors.append('triangle-budget-exceeded')
  if any(max(w, h) > int(args['--texture-max']) for _, w, h in textures):
    errors.append('texture-too-large')
  report = {
    'ok': not errors, 'errors': errors, 'input': args['--input'], 'output': args['--output'],
    'sourceLongAxis': long_axis, 'materialsMerged': material_count, 'triangles': triangles,
    'bboxGltf': {'min': to_gltf(Vector((lo.x, hi.y, lo.z))), 'max': to_gltf(Vector((hi.x, lo.y, hi.z)))},
    'lengthM': round(length, 5), 'gripFraction': None if grip_fraction is None else round(grip_fraction, 4),
    'originInside': lo.z < 0 < hi.z, 'textures': textures,
  }
  text = json.dumps(report, ensure_ascii=False)
  if '--report' in args:
    with open(args['--report'], 'w', encoding='utf8') as handle:
      handle.write(text + '\n')
  print('WEAPON_PREP ' + text)
  if errors:
    sys.exit(1)


main()
