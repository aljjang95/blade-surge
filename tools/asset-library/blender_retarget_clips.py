"""Tripo Mixamo 규격 리그(클립 없음)에 기존 라이브러리 GLB 의 Mixamo 계열 클립을 월드 회전 기준으로 이식한다.

7장 종탑 선례(docs/asset-library/ch7-belltower.md)의 retarget 방식을 저장소 스크립트로 옮긴 것이다.
  - 본 이름이 같은(접두사 mixamorig 변형 무시) 본끼리 매 프레임 월드 회전 변화량(기증자 포즈 × 기증자 휴식⁻¹)을 옮긴다.
  - 휴식 자세 차이(T자세 대 A자세 팔, 고개 기울기)는 본 방향을 기증자 휴식 방향으로 돌리는 정렬 회전으로 보정한다.
    결과적으로 대상 본의 월드 방향이 기증자 본의 월드 방향을 그대로 따른다(팔 T→A 보정 포함).
  - 엉덩이 이동은 엉덩이 높이 비율로 줄여 옮긴다. --lockHips 클립은 수평 이동을 지운다.
  - --freeze 정규식에 맞는 본은 휴식 자세(부모 기준)로 둔다(다리 없는 원령의 꼬리 자락 등).
  - --erase 는 지정한 월드 상자 안의 앞면 면들이 쓰는 텍스처 영역을 주변 색으로 덮는다(세계관상 종교 상징 제거).
결과는 논리 키 이름의 NLA 트랙을 가진 GLB 이고, ingest.mjs 가 그대로 정규화한다.

사용(Blender 5.2):
  blender -b --python-exit-code 1 --python tools/asset-library/blender_retarget_clips.py -- \
    --target <rigged.glb> --donor asset-library/normalized/bone_knight.glb --output <out.glb> --report <r.json> \
    [--clips '{"idle":"idle",...}'] [--speed '{"walk":0.6}'] [--lockHips attack2,attackSpin] [--freeze 'UpLeg|Leg|Foot|Toe'] \
    [--erase '{"box":[x0,y0,z0,x1,y1,z1],"ref":[x0,y0,z0,x1,y1,z1]}']
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

PREFIX = re.compile(r'^mixamorig\d*[:_]?', re.I)


def key(name):
  return PREFIX.sub('', name).lower()


def import_glb(path):
  before = set(bpy.data.objects)
  actions_before = set(bpy.data.actions)
  bpy.ops.import_scene.gltf(filepath=str(path))
  objects = [obj for obj in bpy.data.objects if obj not in before]
  actions = [action for action in bpy.data.actions if action not in actions_before]
  # glTF 가져오기가 만드는 본 표시용 Icosphere 등 스킨 없는 보조 메시는 버린다.
  for obj in list(objects):
    if obj.type == 'MESH' and not (obj.parent and obj.parent.type == 'ARMATURE') and not any(m.type == 'ARMATURE' for m in obj.modifiers):
      objects.remove(obj)
      bpy.data.objects.remove(obj, do_unlink=True)
  armatures = [obj for obj in objects if obj.type == 'ARMATURE']
  if len(armatures) != 1:
    raise RuntimeError(f'expected one armature in {path}, got {len(armatures)}')
  return armatures[0], [obj for obj in objects if obj.type == 'MESH'], actions


def clear_anim(obj):
  data = obj.animation_data
  if not data:
    return
  data.action = None
  for track in list(data.nla_tracks):
    data.nla_tracks.remove(track)


def rot_of(matrix):
  return matrix.decompose()[1]


def mesh_min_z(meshes):
  bpy.context.view_layer.update()
  depsgraph = bpy.context.evaluated_depsgraph_get()
  low = math.inf
  for obj in meshes:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    for vertex in mesh.vertices:
      low = min(low, (obj.matrix_world @ vertex.co).z)
    evaluated.to_mesh_clear()
  return low


def ordered(bones):
  out = []
  def walk(bone):
    out.append(bone)
    for child in bone.children:
      walk(child)
  for bone in bones:
    if bone.parent is None:
      walk(bone)
  return out


def erase_texture(meshes, spec, report):
  """상자 안 앞면(-Y) 면들의 UV 삼각형을 참조 상자 평균색으로 칠한다."""
  import numpy as np
  box, ref = spec['box'], spec['ref']
  inside = lambda p, b: b[0] <= p.x <= b[3] and b[1] <= p.y <= b[4] and b[2] <= p.z <= b[5]
  painted = 0
  for obj in meshes:
    mesh = obj.data
    uv = mesh.uv_layers.active
    image = None
    for material in mesh.materials:
      if material and material.use_nodes:
        for node in material.node_tree.nodes:
          if node.type == 'TEX_IMAGE' and node.image and any(link.to_socket.name == 'Base Color' for link in node.outputs['Color'].links):
            image = node.image
    if not uv or not image:
      continue
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)
    mesh.calc_loop_triangles()
    world = obj.matrix_world
    normal_m = world.to_3x3().inverted().transposed()
    targets, refs = [], []
    for tri in mesh.loop_triangles:
      center = world @ tri.center
      normal = (normal_m @ tri.normal).normalized()
      uvs = [uv.data[i].uv.copy() for i in tri.loops]
      if inside(center, box) and normal.y < -0.15:
        targets.append(uvs)
      elif inside(center, ref) and normal.y < -0.15:
        refs.append(uvs)
    if not targets or not refs:
      raise RuntimeError(f'erase: target faces {len(targets)}, reference faces {len(refs)}')
    samples = []
    for uvs in refs:
      c = sum((Vector(u) for u in uvs), Vector((0, 0))) / 3
      x, y = min(width - 1, max(0, int(c.x * width))), min(height - 1, max(0, int(c.y * height)))
      samples.append(pixels[y, x, :3])
    fill = np.median(np.array(samples), axis=0)
    if spec.get('debugColor'):
      fill = np.array(spec['debugColor'], dtype=np.float32)
    mask = np.zeros((height, width), dtype=bool)
    for uvs in targets:
      pts = np.array([[u.x * width, u.y * height] for u in uvs])
      x0, y0 = np.floor(pts.min(axis=0)).astype(int) - 2
      x1, y1 = np.ceil(pts.max(axis=0)).astype(int) + 2
      x0, y0, x1, y1 = max(0, x0), max(0, y0), min(width - 1, x1), min(height - 1, y1)
      if x1 < x0 or y1 < y0:
        continue
      gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
      (ax, ay), (bx, by), (cx, cy) = pts
      det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if abs(det) < 1e-9:
        continue
      l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / det
      l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / det
      l3 = 1 - l1 - l2
      # 이음새가 남지 않게 삼각형 밖 약 2픽셀까지 넓힌다.
      pad = 2.5 / max(1.0, math.sqrt(abs(det)))
      hit = (l1 >= -pad) & (l2 >= -pad) & (l3 >= -pad)
      mask[y0:y1 + 1, x0:x1 + 1] |= hit
    # 손으로 칠한 질감이 남도록 원래 밝기 변화를 조금 섞는다.
    lum = pixels[..., :3].mean(axis=2, keepdims=True)
    base = lum[mask].mean() if mask.any() else 0.5
    shaded = np.clip(fill[None, :] * (1 + np.clip(lum[mask] - base, -0.15, 0.05) * 0.5), 0, 1) if not spec.get('debugColor') else fill[None, :]
    pixels[mask, :3] = shaded
    image.pixels.foreach_set(pixels.ravel())
    image.update()
    image.pack()
    painted += int(mask.sum())
    report['erase'] = {'mesh': obj.name, 'image': image.name, 'faces': len(targets), 'pixels': int(mask.sum()), 'fill': [round(float(v), 4) for v in fill]}
  if not painted:
    raise RuntimeError('erase: no texture painted')


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--target', required=True)
  parser.add_argument('--donor', required=True)
  parser.add_argument('--output', required=True)
  parser.add_argument('--report', required=True)
  parser.add_argument('--clips', default='')
  parser.add_argument('--speed', default='{}')
  parser.add_argument('--lockHips', default='')
  parser.add_argument('--freeze', default='')
  parser.add_argument('--erase', default='')
  args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
  report = {'ok': False, 'target': args.target, 'donor': args.donor}
  try:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    target, target_meshes, _ = import_glb(args.target)
    clear_anim(target)
    donor, donor_meshes, donor_actions = import_glb(args.donor)
    clear_anim(donor)
    if args.erase:
      erase_texture(target_meshes, json.loads(args.erase), report)
    by_name = {action.name: action for action in donor_actions}
    clips = json.loads(args.clips) if args.clips else {name: name for name in sorted(by_name)}
    speed = json.loads(args.speed)
    lock_hips = {name for name in args.lockHips.split(',') if name}
    freeze = re.compile(args.freeze) if args.freeze else None

    donor_bones = {key(bone.name): bone for bone in donor.data.bones}
    t_obj, d_obj = target.matrix_world.copy(), donor.matrix_world.copy()
    t_rot, d_rot = rot_of(t_obj), rot_of(d_obj)
    t_rot_inv = t_rot.inverted()
    t_bones = ordered(target.data.bones)
    hips = next(bone for bone in t_bones if bone.parent is None)
    d_hips = donor_bones.get(key(hips.name))
    if not d_hips:
      raise RuntimeError('donor has no matching root bone: ' + hips.name)

    # 휴식 자세 정보(기증자 몸은 휴식 자세로 측정한다).
    donor.data.pose_position = 'REST'
    target.data.pose_position = 'REST'
    t_ground, d_ground = mesh_min_z(target_meshes), mesh_min_z(donor_meshes)
    t_hips_h = (t_obj @ hips.head_local).z - t_ground
    d_hips_h = (d_obj @ d_hips.head_local).z - d_ground
    ratio = t_hips_h / d_hips_h
    donor.data.pose_position = 'POSE'
    target.data.pose_position = 'POSE'

    plan = {}
    for bone in t_bones:
      d_bone = donor_bones.get(key(bone.name))
      if not d_bone or (freeze and freeze.search(bone.name)):
        continue
      t_dir = (t_obj.to_3x3() @ (bone.tail_local - bone.head_local)).normalized()
      d_dir = (d_obj.to_3x3() @ (d_bone.tail_local - d_bone.head_local)).normalized()
      align = t_dir.rotation_difference(d_dir)
      plan[bone.name] = {
        'donor': d_bone.name,
        'rest_w': align @ t_rot @ bone.matrix_local.to_quaternion(),
        'd_rest_inv': (d_rot @ d_bone.matrix_local.to_quaternion()).inverted(),
        'align_deg': round(math.degrees(align.angle), 1),
      }
    local_rest = {bone.name: (bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local.copy()) for bone in t_bones}
    for pose_bone in target.pose.bones:
      pose_bone.rotation_mode = 'QUATERNION'

    target.animation_data_create()
    made = {}
    for logical, source in clips.items():
      donor_action = by_name.get(source)
      if not donor_action:
        raise RuntimeError(f'donor clip missing: {source}')
      donor.animation_data_create()
      donor.animation_data.action = donor_action
      if donor.animation_data.action_slot is None and donor_action.slots:
        donor.animation_data.action_slot = donor_action.slots[0]
      start, end = donor_action.frame_range
      step = float(speed.get(logical, 1.0))
      frames = max(1, round((end - start) / step))
      samples = {name: [] for name in plan}
      hips_loc = []
      for index in range(frames + 1):
        source_frame = start + index * step
        whole = math.floor(source_frame)
        scene.frame_set(int(whole), subframe=source_frame - whole)
        poses = {}
        for bone in t_bones:
          parent_pose = poses[bone.parent.name] if bone.parent else Matrix.Identity(4)
          candidate = parent_pose @ local_rest[bone.name]
          item = plan.get(bone.name)
          if not item:
            poses[bone.name] = candidate
            continue
          d_pose = donor.pose.bones[item['donor']]
          delta = (d_rot @ rot_of(d_pose.matrix)) @ item['d_rest_inv']
          rot_arm = t_rot_inv @ (delta @ item['rest_w'])
          head = candidate.translation.copy()
          if bone is hips:
            move = (d_obj @ d_pose.head) - (d_obj @ d_hips.head_local)
            move *= ratio
            if logical in lock_hips:
              move.x = move.y = 0
            head = t_obj.inverted() @ ((t_obj @ hips.head_local) + move)
          desired = Matrix.Translation(head) @ rot_arm.to_matrix().to_4x4()
          poses[bone.name] = desired
          basis = candidate.inverted() @ desired
          quat = basis.to_quaternion()
          if samples[bone.name]:
            quat.make_compatible(samples[bone.name][-1])
          samples[bone.name].append(quat)
          if bone is hips:
            hips_loc.append(basis.translation.copy())

      action = bpy.data.actions.new(logical)
      slot = action.slots.new('OBJECT', target.name)
      layer = action.layers.new('Layer')
      strip = layer.strips.new(type='KEYFRAME')
      bag = strip.channelbag(slot, ensure=True)
      def write(path, index, values, group):
        curve = bag.fcurves.new(path, index=index, group_name=group)
        curve.keyframe_points.add(len(values))
        coords = []
        for frame, value in enumerate(values):
          coords += [1 + frame, value]
        curve.keyframe_points.foreach_set('co', coords)
        for point in curve.keyframe_points:
          point.interpolation = 'LINEAR'
        curve.update()
      for name, quats in samples.items():
        path = f'pose.bones[{json.dumps(name)}].rotation_quaternion'
        for i in range(4):
          write(path, i, [q[i] for q in quats], name)
      for i in range(3):
        write(f'pose.bones[{json.dumps(hips.name)}].location', i, [v[i] for v in hips_loc], hips.name)
      track = target.animation_data.nla_tracks.new()
      track.name = logical
      track.mute = True
      nla = track.strips.new(logical, 1, action)
      nla.action_slot = slot
      made[logical] = {'source': source, 'frames': frames + 1, 'speed': step, 'lockHips': logical in lock_hips}

    # 기증자를 지우고 대상만 내보낸다.
    for obj in [donor, *donor_meshes]:
      bpy.data.objects.remove(obj, do_unlink=True)
    for obj in list(bpy.data.objects):
      if obj.type == 'MESH' and obj not in target_meshes:
        bpy.data.objects.remove(obj, do_unlink=True)
    target.animation_data.action = None
    for pose_bone in target.pose.bones:
      pose_bone.matrix_basis.identity()
    scene.frame_set(1)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.output, export_format='GLB', export_yup=True,
      export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
      export_anim_slide_to_zero=True, export_apply=False, export_cameras=False, export_lights=False)
    report.update({'ok': True, 'clips': made, 'hipsRatio': round(ratio, 4), 'mapped': len(plan), 'bones': len(t_bones),
      'align': {name: item['align_deg'] for name, item in plan.items() if item['align_deg'] >= 10}})
  except Exception as error:  # noqa: BLE001 - 보고서에 남기고 실패 종료
    report['error'] = f'{type(error).__name__}: {error}'
    raise
  finally:
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
  main()
