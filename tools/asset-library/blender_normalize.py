import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def curves(action):
  for layer in action.layers:
    for strip in layer.strips:
      for bag in strip.channelbags:
        yield from bag.fcurves


def triangle_count():
  depsgraph = bpy.context.evaluated_depsgraph_get()
  count = 0
  for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
      continue
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count += len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
  return count


def mapped_actions(mapping):
  bindings = []
  for obj in bpy.context.scene.objects:
    data = obj.animation_data
    if not data:
      continue
    for track in data.nla_tracks:
      for strip in track.strips:
        bindings.append((obj, track.name, strip.action, strip.action_slot))
  for obj in bpy.context.scene.objects:
    if obj.animation_data:
      obj.animation_data.action = None
      for track in list(obj.animation_data.nla_tracks):
        obj.animation_data.nla_tracks.remove(track)
  root_paths = {'location'}
  for obj in bpy.context.scene.objects:
    if obj.type == 'ARMATURE':
      for bone in obj.data.bones:
        if bone.parent is None:
          root_paths.add('pose.bones[' + json.dumps(bone.name) + '].location')
  for logical, source in mapping.items():
    matched = [item for item in bindings if item[1] == source or item[2].name == source]
    if not matched:
      raise RuntimeError('missing source clip: ' + source)
    for obj, _, original, slot in matched:
      action = original.copy()
      start, end = action.frame_range
      for curve in curves(action):
        if curve.data_path in root_paths and curve.array_index in (0, 1):
          first = curve.evaluate(start)
          for point in curve.keyframe_points:
            point.co.y = first
            point.handle_left.y = first
            point.handle_right.y = first
        elif logical in ('idle', 'walk', 'run'):
          first = curve.evaluate(start)
          for point in list(curve.keyframe_points):
            if abs(point.co.x - end) < 0.001:
              curve.keyframe_points.remove(point)
          point = curve.keyframe_points.insert(end, first)
          point.interpolation = 'LINEAR'
        curve.update()
      track = obj.animation_data.nla_tracks.new()
      track.name = logical
      track.mute = True
      strip = track.strips.new(logical, int(start), action)
      slot_index = list(original.slots).index(slot)
      strip.action_slot = action.slots[slot_index]
      strip.action_frame_start = start
      strip.action_frame_end = end


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--source', required=True)
  parser.add_argument('--output', required=True)
  parser.add_argument('--height', type=float, required=True)
  parser.add_argument('--kind', choices=('character', 'prop'), default='character')
  parser.add_argument('--boss', action='store_true')
  parser.add_argument('--yaw', type=float, default=0)
  parser.add_argument('--map', default='{}')
  args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
  bpy.ops.wm.read_factory_settings(use_empty=True)
  if Path(args.source).suffix.lower() == '.fbx':
    bpy.ops.import_scene.fbx(filepath=args.source)
  else:
    bpy.ops.import_scene.gltf(filepath=args.source)
  bpy.context.scene.unit_settings.system = 'METRIC'
  bpy.context.scene.unit_settings.scale_length = 1
  armatures = [obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE']
  for armature in armatures:
    # Tripo Mixamo 리그는 65본이다. three.js 본 텍스처 경로로 80본까지 허용한다.
    if len(armature.data.bones) > 80:
      raise RuntimeError('bone budget exceeded: ' + armature.name)
  if armatures:
    # Tripo 내보내기에 섞여 오는 스킨 없는 보조 메시(Icosphere 등)를 제거해 높이·예산 계산을 보호한다.
    for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
      skinned = any(m.type == 'ARMATURE' for m in obj.modifiers) or (obj.parent and obj.parent.type == 'ARMATURE')
      if not skinned:
        bpy.data.objects.remove(obj, do_unlink=True)
  meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
  if not meshes:
    raise RuntimeError('normalization requires a mesh')
  materials = {material for obj in meshes for material in obj.data.materials if material}
  if len(materials) > 2:
    raise RuntimeError('material budget exceeded; atlas authoring required')
  texture_limit = 2048 if args.boss else 1024
  for image in bpy.data.images:
    width, height = image.size
    if max(width, height) > texture_limit:
      factor = texture_limit / max(width, height)
      image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
      image.pack()
  for armature in armatures:
    armature.data.pose_position = 'REST'
  limit = 4000 if args.kind == 'prop' else 20000 if args.boss else 12000
  for _ in range(5):
    count = triangle_count()
    if count <= limit:
      break
    for obj in meshes:
      bpy.context.view_layer.objects.active = obj
      modifier = obj.modifiers.new('LibraryBudget', 'DECIMATE')
      modifier.ratio = max(0.01, limit / count * 0.95)
      bpy.ops.object.modifier_apply(modifier=modifier.name)
  if triangle_count() > limit:
    raise RuntimeError('triangle budget exceeded after decimation')
  bpy.context.view_layer.update()
  corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
  min_z, max_z = min(point.z for point in corners), max(point.z for point in corners)
  if max_z - min_z <= 0 or not math.isfinite(args.height) or args.height <= 0:
    raise RuntimeError('invalid target/source height')
  scale = args.height / (max_z - min_z)
  center_x = (min(point.x for point in corners) + max(point.x for point in corners)) / 2
  center_y = (min(point.y for point in corners) + max(point.y for point in corners)) / 2
  roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
  pivot = bpy.data.objects.new('LibraryPivot', None)
  bpy.context.collection.objects.link(pivot)
  for obj in roots:
    matrix = obj.matrix_world.copy()
    obj.parent = pivot
    obj.matrix_world = matrix
  pivot.scale = (scale, scale, scale)
  pivot.rotation_euler.z = math.radians(args.yaw)
  pivot.location = pivot.rotation_euler.to_matrix() @ Vector((-center_x * scale, -center_y * scale, -min_z * scale))
  mapped_actions(json.loads(args.map))
  for armature in armatures:
    armature.data.pose_position = 'POSE'
    for bone in armature.pose.bones:
      bone.matrix_basis.identity()
  bpy.context.scene.frame_set(0)
  bpy.context.view_layer.update()
  bpy.ops.export_scene.gltf(filepath=args.output, export_format='GLB', export_yup=True,
    export_animations=args.kind == 'character', export_animation_mode='NLA_TRACKS',
    export_force_sampling=True, export_anim_slide_to_zero=True, export_apply=False,
    export_cameras=False, export_lights=False, export_image_format='WEBP', export_image_quality=82)
  print('LIBRARY_NORMALIZED ' + json.dumps({'triangles': triangle_count(), 'bones': sum(len(obj.data.bones) for obj in armatures), 'materials': len(materials)}))


if __name__ == '__main__':
  main()
