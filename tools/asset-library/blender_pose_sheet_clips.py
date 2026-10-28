"""라이브러리 GLB 의 클립을 지정한 진행 비율로 세워 정면·측면 워크벤치 스틸을 찍는다(이식 클립 육안 점검용).

사용: blender -b --python tools/asset-library/blender_pose_sheet_clips.py -- --input <glb> --out-dir <dir> \
        [--clips idle:0,walk:0.25,attack:0.5] [--views front,side] [--size 384]
출력: <dir>/<stem>__<clip>_<pct>_<view>.png. 여러 장을 한 장으로 모으는 일은 호출 쪽(montage 등)이 한다.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

VIEWS = {'front': (0, -1, 0), 'back': (0, 1, 0), 'side': (1, 0, 0), '34': (0.7071, -0.7071, 0)}


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--input', required=True)
  parser.add_argument('--out-dir', required=True)
  parser.add_argument('--clips', default='idle:0')
  parser.add_argument('--views', default='front,side')
  parser.add_argument('--size', type=int, default=384)
  args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=args.input)
  for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH' and not (obj.parent and obj.parent.type == 'ARMATURE') and not any(m.type == 'ARMATURE' for m in obj.modifiers):
      bpy.data.objects.remove(obj, do_unlink=True)
  scene = bpy.context.scene
  arm = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
  meshes = [obj for obj in scene.objects if obj.type == 'MESH']
  if arm.animation_data:
    for track in arm.animation_data.nla_tracks:
      track.mute = True
  actions = {action.name: action for action in bpy.data.actions}
  scene.render.engine = 'BLENDER_WORKBENCH'
  scene.display.shading.light = 'STUDIO'
  scene.display.shading.color_type = 'TEXTURE'
  scene.render.resolution_x = scene.render.resolution_y = args.size
  scene.render.film_transparent = False
  scene.world = bpy.data.worlds.new('w')
  scene.world.color = (0.82, 0.82, 0.82)
  cam_data = bpy.data.cameras.new('cam')
  cam_data.type = 'ORTHO'
  cam = bpy.data.objects.new('cam', cam_data)
  scene.collection.objects.link(cam)
  scene.camera = cam
  # 휴식 자세 경계로 화면 크기를 고정해 클립끼리 키 비교가 되게 한다.
  bpy.context.view_layer.update()
  corners = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
  lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
  hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
  height = hi.z - lo.z
  center = Vector((0, 0, lo.z + height * 0.5))
  cam_data.ortho_scale = height * 1.5
  cam_data.clip_end = height * 30
  out = Path(args.out_dir).resolve()
  out.mkdir(parents=True, exist_ok=True)
  stem = Path(args.input).stem
  files = []
  for spec in args.clips.split(','):
    name, _, pct = spec.partition(':')
    action = actions.get(name)
    if not action:
      raise RuntimeError('missing clip ' + name)
    arm.animation_data_create()
    arm.animation_data.action = action
    if arm.animation_data.action_slot is None and action.slots:
      arm.animation_data.action_slot = action.slots[0]
    start, end = action.frame_range
    frame = start + (end - start) * float(pct or 0)
    whole = int(frame)
    scene.frame_set(whole, subframe=frame - whole)
    for view in args.views.split(','):
      direction = Vector(VIEWS[view]).normalized()
      cam.location = center + direction * height * 6
      cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
      path = out / f'{stem}__{name}_{int(float(pct or 0) * 100):02d}_{view}.png'
      scene.render.filepath = str(path)
      bpy.ops.render.render(write_still=True)
      files.append(str(path))
  print('POSE_SHEET ' + json.dumps({'files': files, 'height': round(height, 4)}))


if __name__ == '__main__':
  main()
