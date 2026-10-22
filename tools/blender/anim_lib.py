# Blade Surge 애니메이션 팩 저작 공용 도구(Blender 5.2 헤드리스 안에서 import 한다).
# 원칙: 원본 GLB 의 메시·스킨·재질·텍스처는 건드리지 않는다. 원본 클립을 프레임마다 표본으로 읽고
# 절차적으로 고친 새 클립만 뼈대(노드)와 함께 '애니메이션 팩' GLB 로 내보낸다. 같은 입력이면 같은 출력(난수 없음).
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

FPS = 24  # glTF 가져오기 기본 프레임률. 원본 키(초)를 이 단위의 프레임으로 다룬다.


# ---------------------------------------------------------------- 가져오기
def load(path):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.context.scene.render.fps = FPS
  bpy.ops.import_scene.gltf(filepath=str(path))
  helper = bpy.data.collections.get('glTF_not_exported')
  if helper:
    for obj in list(helper.objects): bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(helper)
  arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
  for pb in arm.pose.bones:
    pb.custom_shape = None
    pb.rotation_mode = 'QUATERNION'
  ad = arm.animation_data or arm.animation_data_create()
  for track in list(ad.nla_tracks): ad.nla_tracks.remove(track)
  ad.action = None
  for action in bpy.data.actions: action.use_fake_user = True
  return arm


def source_actions():
  return {a.name: a for a in bpy.data.actions}


def assign(arm, action):
  ad = arm.animation_data
  ad.action = action
  if action is not None and len(action.slots) and ad.action_slot is None: ad.action_slot = action.slots[0]


# ---------------------------------------------------------------- 표본(포즈 = 뼈별 basis)
class Rig:
  """수동 FK. basis(뼈 로컬 휴지 기준 변환)로부터 아마추어 공간 포즈 행렬을 계산한다."""

  def __init__(self, arm):
    self.arm = arm
    self.bones = []
    def walk(bone):
      self.bones.append(bone.name)
      for child in bone.children: walk(child)
    for bone in arm.data.bones:
      if bone.parent is None: walk(bone)
    self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
    self.rest_rel = {}
    for b in arm.data.bones:
      self.rest_rel[b.name] = (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local.copy()
    self.world = arm.matrix_world.copy()
    self.world_inv3 = self.world.to_3x3().inverted()
    self.children = {name: [c.name for c in arm.data.bones[name].children] for name in self.bones}

  def find(self, *suffixes):
    for s in suffixes:
      for name in self.bones:
        if name.split(':')[-1] == s or name.endswith(s): return name
    return None

  def pose(self, basis):
    out = {}
    for name in self.bones:
      loc, rot, scale = basis[name]
      local = self.rest_rel[name] @ Matrix.LocRotScale(loc, rot, scale)
      parent = self.parent[name]
      out[name] = (out[parent] @ local) if parent else local
    return out

  def head_world(self, pose, name):
    return self.world @ pose[name].translation

  def arm_dir(self, world_vec):
    return (self.world_inv3 @ Vector(world_vec)).normalized()

  def arm_vec(self, world_vec):
    return self.world_inv3 @ Vector(world_vec)


def copy_basis(basis):
  return {k: (v[0].copy(), v[1].copy(), v[2].copy()) for k, v in basis.items()}


def sample(arm, action, times):
  """초 단위 times 에서 원본 action 의 뼈별 basis 를 읽는다(부분 프레임 보간)."""
  assign(arm, action)
  scene = bpy.context.scene
  frames = []
  for t in times:
    f = t * FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
    frames.append({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy().normalized(), pb.scale.copy()) for pb in arm.pose.bones})
  assign(arm, None)
  return frames


def duration(action):
  s, e = action.frame_range
  return (e - s) / FPS


def grid(dur, fps=FPS):
  n = max(1, int(round(dur * fps)))
  return [i / fps for i in range(n + 1)]


# ---------------------------------------------------------------- 포즈 연산
def smooth(x):
  x = min(1.0, max(0.0, x))
  return x * x * (3 - 2 * x)


def bell(t, start, peak, end):
  """start→peak 로 0→1, peak→end 로 1→0 (부드러운 종 모양)."""
  if t <= start or t >= end: return 0.0
  if t <= peak: return smooth((t - start) / max(1e-6, peak - start))
  return 1.0 - smooth((t - peak) / max(1e-6, end - peak))


def rotate_world(rig, basis, bone, axis_world, angle, pose=None):
  """bone 을 머리 위치 기준으로 월드 축 둘레 angle(라디안) 만큼 돌린다. 자식은 따라온다.
  부모 공간에서 앞곱하므로 뼈에 비균일 배율(찌그러짐) 키가 있어도 모양 그대로 강체 회전한다."""
  if not bone or abs(angle) < 1e-9: return
  pose = pose or rig.pose(basis)
  parent = rig.parent[bone]
  frame = (pose[parent] if parent else Matrix.Identity(4)) @ rig.rest_rel[bone]
  axis = frame.to_quaternion().inverted() @ rig.arm_dir(axis_world)
  loc, rot, scale = basis[bone]
  basis[bone] = (loc, (Quaternion(axis.normalized(), angle) @ rot).normalized(), scale)


def translate_world(rig, basis, bone, delta_world, pose=None):
  if not bone: return
  pose = pose or rig.pose(basis)
  parent = rig.parent[bone]
  frame = (pose[parent] if parent else Matrix.Identity(4)) @ rig.rest_rel[bone]
  d = rig.arm_vec(delta_world)
  local = frame.to_3x3().inverted() @ d
  loc, rot, scale = basis[bone]
  basis[bone] = (loc + local, rot, scale)


def set_world_rotation(rig, basis, bone, target_rot_arm, pose=None):
  """bone 의 아마추어 공간 회전을 target 으로(부모는 그대로)."""
  pose = pose or rig.pose(basis)
  parent = rig.parent[bone]
  frame = (pose[parent] if parent else Matrix.Identity(4)) @ rig.rest_rel[bone]
  loc, rot, scale = basis[bone]
  basis[bone] = (loc, (frame.to_quaternion().inverted() @ target_rot_arm).normalized(), scale)


def swing_to(rig, basis, bone, from_vec_arm, to_vec_arm, pose=None):
  """bone 을 돌려 아마추어 공간 방향 from→to 로 맞춘다(머리 기준)."""
  a, b = from_vec_arm.normalized(), to_vec_arm.normalized()
  axis = a.cross(b)
  if axis.length < 1e-8: return
  angle = math.atan2(axis.length, a.dot(b))
  pose = pose or rig.pose(basis)
  local_axis = pose[bone].to_quaternion().inverted() @ axis.normalized()
  loc, rot, scale = basis[bone]
  basis[bone] = (loc, (rot @ Quaternion(local_axis, angle)).normalized(), scale)


def leg_ik(rig, basis, upleg, leg, foot, target_arm, pole_arm, foot_rot_arm):
  """해석적 2관절 IK: 발목(foot 머리)을 target 으로, 무릎은 pole 쪽 평면에, 발 회전은 원래 월드 회전으로."""
  pose = rig.pose(basis)
  h, k, a = pose[upleg].translation, pose[leg].translation, pose[foot].translation
  l1, l2 = (k - h).length, (a - k).length
  to_t = target_arm - h
  d = min(max(to_t.length, 1e-4), (l1 + l2) * 0.9999)
  dir_t = to_t.normalized()
  pole = pole_arm - h
  pole = (pole - dir_t * pole.dot(dir_t))
  if pole.length < 1e-6: pole = (k - h) - dir_t * (k - h).dot(dir_t)
  pole.normalize()
  cos_a = max(-1.0, min(1.0, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
  knee = h + dir_t * (l1 * cos_a) + pole * (l1 * math.sqrt(max(0.0, 1 - cos_a * cos_a)))
  swing_to(rig, basis, upleg, k - h, knee - h, pose)
  pose = rig.pose(basis)
  k2, a2 = pose[leg].translation, pose[foot].translation
  target = h + dir_t * d
  swing_to(rig, basis, leg, a2 - k2, target - k2, pose)
  set_world_rotation(rig, basis, foot, foot_rot_arm)


class Legs:
  def __init__(self, rig):
    self.rig = rig
    self.sides = []
    for side in ('Left', 'Right'):
      names = (rig.find(side + 'UpLeg'), rig.find(side + 'Leg'), rig.find(side + 'Foot'))
      if all(names): self.sides.append(names)

  def capture(self, basis):
    pose = self.rig.pose(basis)
    out = []
    for up, leg, foot in self.sides:
      knee = pose[leg].translation
      h, a = pose[up].translation, pose[foot].translation
      mid = h.lerp(a, 0.5)
      out.append((pose[foot].translation.copy(), knee + (knee - mid) * 2.0, pose[foot].to_quaternion()))
    return out

  def plant(self, basis, captured):
    for (up, leg, foot), (target, pole, rot) in zip(self.sides, captured):
      leg_ik(self.rig, basis, up, leg, foot, target, pole, rot)


def blend_basis(a, b, w):
  """두 포즈 basis 를 뼈별로 섞는다(회전 slerp, 위치·배율 lerp)."""
  out = {}
  for k in a:
    la, ra, sa = a[k]; lb, rb, sb = b[k]
    rb = rb.copy()
    if ra.dot(rb) < 0: rb.negate()
    out[k] = (la.lerp(lb, w), ra.slerp(rb, w).normalized(), sa.lerp(sb, w))
  return out


# ---------------------------------------------------------------- 측정
def hips_world(rig, basis, hips):
  return rig.head_world(rig.pose(basis), hips)


def root_lock(rig, frames, times, hips, keep_vertical=True, window=0.45, amount=1.0):
  """골반 수평 이동의 큰 흐름(이동 평균)을 빼서 제자리로 만든다. 작은 체중 이동은 남긴다.
  끝 표본의 남은 수평 이동은 선형으로 0 이 되게 보정한다."""
  pos = [hips_world(rig, f, hips) for f in frames]
  p0 = pos[0]
  rel = [Vector((p.x - p0.x, p.y - p0.y, 0.0)) for p in pos]
  n = len(rel)
  half = max(1, int(round(window * FPS / 2)))
  trend = []
  for i in range(n):
    lo, hi = max(0, i - half), min(n - 1, i + half)
    acc = Vector((0, 0, 0))
    for j in range(lo, hi + 1): acc += rel[j]
    trend.append(acc / (hi - lo + 1))
  # 시작은 0, 끝은 전부 빼도록 보정
  t0, t1 = trend[0], trend[-1]
  end_resid = rel[-1] - t1
  out = []
  for i, f in enumerate(frames):
    u = times[i] / max(1e-6, times[-1])
    corr = (trend[i] - t0 * (1 - u)) + end_resid * u
    corr = corr * amount
    nf = copy_basis(f)
    translate_world(rig, nf, hips, -corr)
    out.append(nf)
  return out


def seam_blend(frames, times, target, start_frac):
  """끝 구간(start_frac 이후)을 target 포즈로 부드럽게 수렴시킨다(반복·콤보 이음새)."""
  T = times[-1]
  out = []
  for f, t in zip(frames, times):
    w = smooth((t / T - start_frac) / max(1e-6, 1 - start_frac)) if T > 0 else 0
    out.append(blend_basis(f, target, w) if w > 0 else copy_basis(f))
  return out


def max_angle_deg(a, b):
  m = 0.0
  for k in a:
    qa, qb = a[k][1], b[k][1]
    d = min(1.0, abs(qa.dot(qb)))
    m = max(m, math.degrees(2 * math.acos(d)))
  return m


def drift_m(rig, frames, hips):
  a, b = hips_world(rig, frames[0], hips), hips_world(rig, frames[-1], hips)
  return math.hypot(b.x - a.x, b.y - a.y)


def range_m(rig, frames, hips):
  ps = [hips_world(rig, f, hips) for f in frames]
  xs, ys = [p.x for p in ps], [p.y for p in ps]
  return math.hypot(max(xs) - min(xs), max(ys) - min(ys))


def resample(arm, action, out_dur, warp=None):
  """원본 action 을 out_dur 초로 다시 표본한다. warp(u)->u' 로 시간 재배치(0..1)."""
  src = duration(action)
  times = grid(out_dur)
  st = [src * (warp(t / out_dur) if warp else t / out_dur) for t in times]
  return times, sample(arm, action, st)


# ---------------------------------------------------------------- 메시 접지
def mesh_min_z(arm, rig, basis):
  apply_pose(arm, basis)
  dg = bpy.context.evaluated_depsgraph_get()
  low = 1e9
  for obj in bpy.data.objects:
    if obj.type != 'MESH' or obj.parent is None: continue
    ev = obj.evaluated_get(dg)
    mesh = ev.to_mesh()
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    mw = np.array(ev.matrix_world)
    z = co @ mw[2, :3] + mw[2, 3]
    low = min(low, float(z.min()))
    ev.to_mesh_clear()
  return low


def apply_pose(arm, basis):
  assign(arm, None)
  for pb in arm.pose.bones:
    loc, rot, scale = basis[pb.name]
    pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scale
  bpy.context.view_layer.update()


def ground_fix(arm, rig, frames, times, hips, floor=0.0, only_when=None, smooth_win=2):
  """실제 스키닝 메시 최저점이 바닥(floor) 아래로 뚫거나(항상) only_when(t) 구간에서 뜨면 골반 높이로 맞춘다."""
  lows = [mesh_min_z(arm, rig, f) for f in frames]
  delta = []
  for t, low in zip(times, lows):
    d = floor - low
    if d < 0 and not (only_when and only_when(t)): d = 0.0
    delta.append(d)
  n = len(delta)
  sm = []
  for i in range(n):
    lo, hi = max(0, i - smooth_win), min(n - 1, i + smooth_win)
    sm.append(max(delta[i], sum(delta[lo:hi + 1]) / (hi - lo + 1)))
  out = []
  for f, d in zip(frames, sm):
    nf = copy_basis(f)
    if abs(d) > 1e-5: translate_world(rig, nf, hips, Vector((0, 0, d)))
    out.append(nf)
  return out, lows


# ---------------------------------------------------------------- 쓰기·내보내기
def write_action(arm, name, frames, times):
  action = bpy.data.actions.new(name)
  action.use_fake_user = True
  assign(arm, action)
  prev = {}
  data = {}
  for i, (f, t) in enumerate(zip(frames, times)):
    for bone, (loc, rot, scale) in f.items():
      q = rot.copy()
      if bone in prev and prev[bone].dot(q) < 0: q.negate()
      prev[bone] = q
      data.setdefault(bone, []).append((t * FPS, loc, q, scale))
  for bone, keys in data.items():
    for path, size, pick in (('location', 3, lambda k: k[1]), ('rotation_quaternion', 4, lambda k: k[2]), ('scale', 3, lambda k: k[3])):
      dp = f'pose.bones["{bone}"].{path}'
      for idx in range(size):
        fc = action.fcurve_ensure_for_datablock(arm, dp, index=idx, group_name=bone)
        fc.keyframe_points.add(len(keys))
        co = []
        for k in keys: co += [k[0], pick(k)[idx]]
        fc.keyframe_points.foreach_set('co', co)
        for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
        fc.update()
  assign(arm, None)
  return action


def export_pack(arm, actions, out_path):
  """새 클립만 NLA 트랙으로 걸어 뼈대(메시·스킨·재질 없이)와 함께 GLB 로 내보낸다."""
  ad = arm.animation_data
  for track in list(ad.nla_tracks): ad.nla_tracks.remove(track)
  for action in actions:
    track = ad.nla_tracks.new(); track.name = action.name
    strip = track.strips.new(action.name, int(action.frame_range[0]), action)
    track.mute = False
  assign(arm, None)
  for o in bpy.data.objects: o.select_set(False)
  obj = arm
  while obj:
    obj.select_set(True); obj = obj.parent
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  bpy.ops.export_scene.gltf(filepath=str(out_path), export_format='GLB', use_selection=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_def_bones=False, export_skins=False,
    export_morph=False, export_materials='NONE', export_yup=True, export_apply=False, export_extras=False,
    export_optimize_animation_size=False)
  for track in list(ad.nla_tracks): ad.nla_tracks.remove(track)


# ---------------------------------------------------------------- 미리보기 띠
_render_ready = {}


def setup_render(arm, size=256, view='side'):
  scene = bpy.context.scene
  scene.render.engine = 'BLENDER_WORKBENCH'
  scene.display.shading.light = 'STUDIO'
  scene.display.shading.color_type = 'TEXTURE'
  scene.render.film_transparent = False
  scene.world = scene.world or bpy.data.worlds.new('W')
  scene.display.shading.background_type = 'VIEWPORT'
  scene.display.shading.background_color = (0.16, 0.17, 0.2)
  scene.render.resolution_x = size; scene.render.resolution_y = size
  meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name != 'PreviewFloor']
  if 'h' not in _render_ready:
    rest = {pb.name: (Vector(), Quaternion(), Vector((1, 1, 1))) for pb in arm.pose.bones}
    apply_pose(arm, rest)
    dg = bpy.context.evaluated_depsgraph_get()
    zs = []
    for o in meshes:
      ev = o.evaluated_get(dg); me = ev.to_mesh()
      zs += [(ev.matrix_world @ v.co).z for i, v in enumerate(me.vertices) if i % 7 == 0]
      ev.to_mesh_clear()
    _render_ready['h'] = max(zs)
  h = _render_ready['h']
  cam = bpy.data.objects.get('PreviewCam')
  if cam is None:
    cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
    scene.collection.objects.link(cam)
    # 바닥 판(접지·관통 확인용)
    bpy.ops.mesh.primitive_plane_add(size=h * 6, location=(0, 0, 0))
    plane = bpy.context.active_object; plane.name = 'PreviewFloor'
    mat = bpy.data.materials.new('PreviewFloorMat'); mat.diffuse_color = (0.32, 0.34, 0.38, 1)
    plane.data.materials.append(mat)
  scene.camera = cam
  cam.data.type = 'ORTHO'
  cam.data.ortho_scale = h * 1.75
  ang = {'34': math.radians(40), 'side': math.radians(90), 'front': 0.0, 'back34': math.radians(140)}[view]
  d = h * 6
  # 수평에서 12도 내려다본다. 화면 중심은 키의 절반 높이, 원점 앞쪽 약간.
  tilt = math.radians(4 if view in ('side', 'front') else 12)
  cam.location = (math.sin(ang) * d * math.cos(tilt), -math.cos(ang) * d * math.cos(tilt), h * 0.42 + d * math.sin(tilt))
  cam.rotation_euler = (math.radians(90) - tilt, 0, ang)


def render_strip(arm, frames, times, out_png, n=8, size=256, view='side', label_times=True):
  """frames(basis 목록)에서 n 장을 골라 가로 띠 PNG 하나로 저장한다."""
  setup_render(arm, size, view)
  scene = bpy.context.scene
  idx = [round(i * (len(frames) - 1) / max(1, n - 1)) for i in range(n)]
  tiles = []
  tmp = out_png + '.tmp.png'
  for i in idx:
    apply_pose(arm, frames[i])
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp, check_existing=False)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    # 시각 눈금: 아래쪽에 진행 막대
    u = times[i] / max(1e-6, times[-1])
    px[0:4, :, :] = (0.1, 0.1, 0.1, 1)
    px[0:4, :max(1, int(u * img.size[0])), :] = (0.95, 0.75, 0.2, 1)
    px[:, 0:1, :] = (0, 0, 0, 1)
    tiles.append(px)
    bpy.data.images.remove(img)
  strip = np.concatenate(tiles, axis=1)
  out = bpy.data.images.new('strip', strip.shape[1], strip.shape[0], alpha=True)
  out.pixels[:] = strip.ravel()
  out.filepath_raw = out_png; out.file_format = 'PNG'; out.save()
  bpy.data.images.remove(out)
  if os.path.exists(tmp): os.remove(tmp)
  return out_png


def aim(rig, basis, bone, tip, target_world, weight=1.0):
  """bone 을 돌려 (bone 머리→tip 머리) 방향이 월드 방향 target 쪽으로 weight 만큼 향하게 한다(머리 기준, 자식은 따라온다)."""
  if not bone or not tip or weight <= 0: return
  pose = rig.pose(basis)
  v = pose[tip].translation - pose[bone].translation
  t = rig.arm_dir(target_world)
  a = v.normalized()
  axis = a.cross(t)
  if axis.length < 1e-8: return
  angle = math.atan2(axis.length, a.dot(t)) * min(1.0, weight)
  local_axis = pose[bone].to_quaternion().inverted() @ axis.normalized()
  loc, rot, scale = basis[bone]
  basis[bone] = (loc, (rot @ Quaternion(local_axis, angle)).normalized(), scale)
