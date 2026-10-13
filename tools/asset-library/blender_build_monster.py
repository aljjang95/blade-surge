# Tripo+Mixamo 인간형 몬스터를 한 번에 빌드한다: 리깅 FBX + Mixamo 클립 → 논리 클립 NLA → 타격 프레임 측정 → 정규화 GLB.
# 사용: blender -b --factory-startup --python-exit-code 1 --python blender_build_monster.py -- --spec <spec.json> --report <report.json>
import bpy, json, math, os, sys
from pathlib import Path
from mathutils import Vector

LOOP_KEYS = ('idle', 'walk', 'run')
HAND_SUFFIX = ('LeftHand', 'RightHand')


def arg(name):
  argv = sys.argv[sys.argv.index('--') + 1:]
  return argv[argv.index('--' + name) + 1]


def curves(action):
  for layer in action.layers:
    for strip in layer.strips:
      for bag in strip.channelbags:
        yield from bag.fcurves


def suffix(name):
  return name.split(':', 1)[1] if ':' in name else name


def bone_of(path):
  if not path.startswith('pose.bones["'):
    return None
  return path[len('pose.bones["'):path.index('"]')]


def triangle_count(meshes):
  depsgraph = bpy.context.evaluated_depsgraph_get()
  total = 0
  for obj in meshes:
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh(); mesh.calc_loop_triangles(); total += len(mesh.loop_triangles); ev.to_mesh_clear()
  return total


def import_fbx(path):
  before = set(bpy.data.objects)
  # 25본 Mixamo 리그는 손이 말단 본이다. 말단 본을 지우면 손 소켓·타격 측정이 사라진다.
  # Tripo FBX 는 내장 텍스처와 함께 존재하지 않는 외부 경로를 기록한다. 이미지 탐색을 켜면 디스크 전체를 재귀 탐색해 멈춘다.
  bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False, use_image_search=False)
  return [o for o in bpy.data.objects if o not in before]


def assign(arm, action):
  ad = arm.animation_data or arm.animation_data_create()
  ad.action = action
  if len(action.slots):
    ad.action_slot = action.slots[0]


def main():
  spec = json.loads(Path(arg('spec')).read_text(encoding='utf-8'))
  bpy.ops.wm.read_factory_settings(use_empty=True)
  scene = bpy.context.scene
  scene.render.fps = 30
  objs = import_fbx(spec['rigged'])
  arms = [o for o in objs if o.type == 'ARMATURE']
  if len(arms) != 1:
    raise RuntimeError('expected one armature, got %d' % len(arms))
  arm = arms[0]; arm.name = 'Armature'
  for o in objs:
    if o.type == 'MESH':
      skinned = any(m.type == 'ARMATURE' for m in o.modifiers)
      if not skinned:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type not in ('ARMATURE', 'MESH'):
      bpy.data.objects.remove(o, do_unlink=True)
  meshes = [o for o in bpy.data.objects if o.type == 'MESH']
  if not meshes:
    raise RuntimeError('no skinned mesh')
  if arm.animation_data:
    arm.animation_data_clear()
  for act in list(bpy.data.actions):
    bpy.data.actions.remove(act)
  bones = {suffix(b.name): b.name for b in arm.data.bones}
  hips = bones.get('Hips') or [b.name for b in arm.data.bones if b.parent is None][0]
  target_hips_h = arm.data.bones[hips].head_local.length
  hb = arm.data.bones[hips]
  world3 = arm.matrix_world.to_3x3() @ hb.matrix_local.to_3x3()
  up = Vector((0, 0, 1))
  horizontal = [i for i in range(3) if abs(world3.col[i].normalized().dot(up)) < 0.7]
  report = {'id': spec['id'], 'bones': len(arm.data.bones), 'hips': hips, 'clips': {}, 'impacts': {}}

  arm_w = arm.matrix_world.copy(); arm_wi = arm_w.inverted(); arm_r = arm_w.to_3x3().normalized(); arm_ri = arm_r.inverted()
  t_rest = {b.name: b.matrix_local.to_3x3().normalized() for b in arm.data.bones}
  t_rest_world = {n: arm_r @ m for n, m in t_rest.items()}
  order = []
  def walk(b):
    order.append(b); [walk(c) for c in b.children]
  for b in arm.data.bones:
    if b.parent is None: walk(b)
  t_hips_world0 = arm_w @ arm.data.bones[hips].head_local
  for logical, path in spec['clips'].items():
    new = import_fbx(path)
    carms = [o for o in new if o.type == 'ARMATURE']
    if len(carms) != 1 or not carms[0].animation_data or not carms[0].animation_data.action:
      raise RuntimeError('clip has no armature action: ' + path)
    carm = carms[0]
    src = carm.animation_data.action
    start, end = [int(round(x)) for x in src.frame_range]
    cmap = {suffix(b.name): b.name for b in carm.data.bones}
    c_w = carm.matrix_world.copy(); c_r = c_w.to_3x3().normalized()
    # 휴지 자세 차이(축 규약·A/T 포즈)를 본마다 보정한다: 대상 월드 회전 = 클립 월드 회전 @ (C^-1 T)
    offset = {}
    for b in arm.data.bones:
      cn = cmap.get(suffix(b.name))
      if cn:
        C = c_r @ carm.data.bones[cn].matrix_local.to_3x3().normalized()
        offset[b.name] = (cn, C.inverted() @ t_rest_world[b.name])
    ch = cmap.get('Hips')
    c_hips0 = c_w @ carm.data.bones[ch].head_local
    ratio = t_hips_world0.z / c_hips0.z if c_hips0.z > 1e-6 else 1.0
    frames = list(range(start, end + 1))
    rots = {b.name: [] for b in order}; disp = []
    for f in frames:
      scene.frame_set(f)
      posed = {}
      for b in order:
        if b.name in offset:
          cn, O = offset[b.name]
          posed[b.name] = arm_ri @ ((c_w @ carm.pose.bones[cn].matrix).to_3x3().normalized() @ O)
        elif b.parent:
          posed[b.name] = posed[b.parent.name] @ t_rest[b.parent.name].inverted() @ t_rest[b.name]
        else:
          posed[b.name] = t_rest[b.name]
        if b.parent:
          q = (t_rest[b.name].inverted() @ t_rest[b.parent.name] @ posed[b.parent.name].inverted() @ posed[b.name]).to_quaternion()
        else:
          q = (t_rest[b.name].inverted() @ posed[b.name]).to_quaternion()
        prev = rots[b.name][-1] if rots[b.name] else None
        if prev is not None and prev.dot(q) < 0: q.negate()
        rots[b.name].append(q)
      disp.append((c_w @ carm.pose.bones[ch].head - c_hips0) * ratio)
    # 수평 이동이 크면(걷기 진행·돌진) 제자리로 만든다. 수직(웅크림·점프·쓰러짐)은 남긴다.
    xs = [d.x for d in disp]; ys = [d.y for d in disp]; h = t_hips_world0.z
    travel = math.hypot(xs[-1] - xs[0], ys[-1] - ys[0]); span = max(max(xs) - min(xs), max(ys) - min(ys))
    inplace = travel > 0.12 * h or span > 0.3 * h
    if inplace:
      for d in disp: d.x = xs[0]; d.y = ys[0]
    if logical in LOOP_KEYS:
      for n in rots: rots[n][-1] = rots[n][0].copy()
      disp[-1] = disp[0].copy()
    act = bpy.data.actions.new(logical)
    ad = arm.animation_data or arm.animation_data_create(); ad.action = act
    for b in order:
      pb = arm.pose.bones[b.name]; pb.rotation_mode = 'QUATERNION'
    rest_head = arm.data.bones[hips].head_local; hips_rest_rot_i = t_rest[hips].inverted()
    for i, f in enumerate(frames):
      for b in order:
        pb = arm.pose.bones[b.name]; pb.rotation_quaternion = rots[b.name][i]
        pb.keyframe_insert('rotation_quaternion', frame=f)
      head_arm = arm_wi @ (t_hips_world0 + disp[i])
      arm.pose.bones[hips].location = hips_rest_rot_i @ (head_arm - rest_head)
      arm.pose.bones[hips].keyframe_insert('location', frame=f)
    for fc in (c for layer in act.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves):
      for k in fc.keyframe_points: k.interpolation = 'LINEAR'
    ad.action = None
    for o in new:
      bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.actions.remove(src)
    report['clips'][logical] = {'frames': [start, end], 'seconds': round((end - start) / 30, 3), 'hipsRatio': round(ratio, 3), 'inPlace': inplace, 'mapped': len(offset), 'source': os.path.basename(path)}



    if logical in spec.get('impactKeys', []):
      assign(arm, act)
      limbs = [bones[s] for s in HAND_SUFFIX if s in bones]
      prev = None; speeds = []; hips_z = []
      frames = list(range(int(start), int(end) + 1))
      for f in frames:
        scene.frame_set(f)
        hp = arm.matrix_world @ arm.pose.bones[hips].head
        # 손 속도는 엉덩이 기준 상대 위치로 잰다(발 내딛기·몸 이동을 타격으로 오인하지 않는다).
        pos = [(arm.matrix_world @ arm.pose.bones[n].head) - hp for n in limbs]
        hips_z.append(hp.z)
        if prev is None:
          speeds.append([0.0] * len(pos))
        else:
          speeds.append([(a - b).length for a, b in zip(pos, prev)])
        prev = pos
      best_limb, best_peak, best_i = 0, 0.0, 0
      for li in range(len(limbs)):
        for i, row in enumerate(speeds):
          if row[li] > best_peak:
            best_peak, best_limb, best_i = row[li], li, i
      contact = best_i
      raw_peak = speeds[best_i][best_limb]
      for i in range(best_i, len(frames)):
        if speeds[i][best_limb] < raw_peak * 0.55:
          contact = i; break
      if logical == 'attackJump':
        top = max(range(len(hips_z)), key=lambda i: hips_z[i])
        land = min(range(top, len(hips_z)), key=lambda i: hips_z[i]) if top < len(hips_z) - 1 else contact
        contact = land
      total = max(1, len(frames) - 1)
      ratio_c = min(0.9, max(0.1, contact / total))
      report['impacts'][logical] = round(ratio_c, 3)
      report['clips'][logical].update({'contactFrame': frames[contact], 'peakFrame': frames[best_i], 'limb': suffix(limbs[best_limb])})
      arm.animation_data.action = None

    track = arm.animation_data_create().nla_tracks.new(); track.name = logical; track.mute = True
    strip = track.strips.new(logical, int(start), act)
    if len(act.slots):
      strip.action_slot = act.slots[0]
    strip.action_frame_start = start; strip.action_frame_end = end

  missing = [k for k in spec['clips'] if k not in report['clips']]
  if missing:
    raise RuntimeError('missing clips: %s' % missing)

  # 재질·텍스처·삼각형 예산
  mats = {m for o in meshes for m in o.data.materials if m}
  if len(mats) > 2:
    raise RuntimeError('material budget exceeded')
  limit_tex = spec.get('texLimit', 1024)
  for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > limit_tex:
      f = limit_tex / max(w, h); img.scale(max(1, round(w * f)), max(1, round(h * f))); img.pack()
  arm.data.pose_position = 'REST'
  bpy.context.view_layer.update()
  limit = spec.get('triLimit', 12000)
  report['trianglesSource'] = triangle_count(meshes)
  for _ in range(6):
    n = triangle_count(meshes)
    if n <= limit:
      break
    for o in meshes:
      bpy.context.view_layer.objects.active = o
      mod = o.modifiers.new('Budget', 'DECIMATE'); mod.ratio = max(0.01, limit / n * 0.96)
      # 휴지 자세(REST)라 아마추어 변형은 항등이다. 감면은 정점 그룹 가중치를 보간해 보존한다.
      bpy.ops.object.modifier_apply(modifier=mod.name)
  if triangle_count(meshes) > limit:
    raise RuntimeError('triangle budget exceeded')

  corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
  min_z = min(p.z for p in corners); max_z = max(p.z for p in corners)
  scale = spec['height'] / (max_z - min_z)
  cx = (min(p.x for p in corners) + max(p.x for p in corners)) / 2
  cy = (min(p.y for p in corners) + max(p.y for p in corners)) / 2
  pivot = bpy.data.objects.new('LibraryPivot', None); scene.collection.objects.link(pivot)
  for o in [o for o in bpy.data.objects if o.parent is None and o is not pivot]:
    mw = o.matrix_world.copy(); o.parent = pivot; o.matrix_world = mw
  pivot.scale = (scale, scale, scale)
  pivot.rotation_euler.z = math.radians(spec.get('yaw', 0))
  pivot.location = pivot.rotation_euler.to_matrix() @ Vector((-cx * scale, -cy * scale, -min_z * scale))
  arm.data.pose_position = 'POSE'
  for pb in arm.pose.bones:
    pb.matrix_basis.identity()
  scene.frame_set(0); bpy.context.view_layer.update()
  os.makedirs(os.path.dirname(spec['output']), exist_ok=True)
  bpy.ops.export_scene.gltf(filepath=spec['output'], export_format='GLB', export_yup=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_anim_slide_to_zero=True, export_apply=False,
    export_cameras=False, export_lights=False, export_image_format='WEBP', export_image_quality=82)
  report.update({'ok': True, 'triangles': triangle_count(meshes), 'materials': len(mats), 'images': [list(i.size) for i in bpy.data.images if i.size[0]],
    'height': spec['height'], 'sourceHeight': round(max_z - min_z, 4), 'bytes': os.path.getsize(spec['output'])})
  Path(arg('report')).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')


try:
  main()
except Exception as e:
  Path(arg('report')).write_text(json.dumps({'ok': False, 'error': repr(e)}), encoding='utf-8')
  raise

