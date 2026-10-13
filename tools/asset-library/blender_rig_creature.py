# 비인간형 Tripo 생물(슬라임·비행체·드레이크)을 직접 리깅하고 전투 동작을 키프레임으로 작성한다.
# 형태 측정 → 본 배치 → 거리 기반 부드러운 가중치 → 예비동작/타격/회복 클립 → 정규화 GLB.
# 사용: blender -b --factory-startup --python-exit-code 1 --python blender_rig_creature.py -- --spec s.json --report r.json
import bpy, json, math, os, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

FPS = 30


def arg(n):
  a = sys.argv[sys.argv.index('--') + 1:]
  return a[a.index('--' + n) + 1]


def smooth(t):
  t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


EASE = {'s': smooth, 'i': lambda t: max(0.0, min(1.0, t)) ** 2.2, 'o': lambda t: 1 - (1 - max(0.0, min(1.0, t))) ** 2.2, 'l': lambda t: max(0.0, min(1.0, t))}


def track(t, pts):
  """pts=[(t, v, ease)] — ease 는 이전 점에서 이 점으로 가는 구간의 곡선."""
  if t <= pts[0][0]:
    return pts[0][1]
  for (t0, v0, _), (t1, v1, e) in zip(pts, pts[1:]):
    if t <= t1:
      k = EASE[e]((t - t0) / max(1e-6, t1 - t0)); return v0 + (v1 - v0) * k
  return pts[-1][1]


def seg_dist(p, a, b):
  ab = b - a; L = ab.length_squared
  t = 0.0 if L < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L))
  return (a + ab * t - p).length


# ---------- 형태 측정과 본 배치 ----------

def load_mesh(spec):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=spec['input'])
  for c in list(bpy.data.collections):
    if c.name == 'glTF_not_exported':
      for o in list(c.objects): bpy.data.objects.remove(o, do_unlink=True)
  for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
  meshes = [o for o in bpy.data.objects if o.type == 'MESH']
  for o in meshes: o.parent = None
  bpy.ops.object.select_all(action='DESELECT')
  for o in meshes: o.select_set(True)
  bpy.context.view_layer.objects.active = meshes[0]
  if len(meshes) > 1: bpy.ops.object.join()
  obj = bpy.context.view_layer.objects.active
  obj.rotation_euler.z = math.radians(spec.get('yaw', 0))
  bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
  co = [v.co for v in obj.data.vertices]
  mn = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
  mx = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
  s = spec['height'] / (mx.z - mn.z)
  obj.location = (-(mn.x + mx.x) / 2 * s, -(mn.y + mx.y) / 2 * s, -mn.z * s); obj.scale = (s, s, s)
  bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
  obj.name = spec['id']
  return obj


def landmarks(obj, spec):
  vs = [v.co.copy() for v in obj.data.vertices]
  H = max(v.z for v in vs); W = max(v.x for v in vs) - min(v.x for v in vs); D = max(v.y for v in vs) - min(v.y for v in vs)
  def centroid(pred, fallback):
    sel = [v for v in vs if pred(v)]
    if len(sel) < 12: return fallback
    return sum(sel, Vector()) / len(sel)
  core = centroid(lambda v: abs(v.x) < 0.2 * W, Vector((0, 0, 0.45 * H)))
  head = centroid(lambda v: v.z > 0.7 * H and abs(v.x) < 0.25 * W, Vector((0, core.y, 0.85 * H)))
  m = {'H': H, 'W': W, 'D': D, 'core': core, 'head': head}
  if spec.get('wings'):
    wz = spec.get('wingMinZ', 0.3)
    for side, sg in (('L', 1), ('R', -1)):
      m['wing' + side] = centroid(lambda v: v.x * sg > 0.3 * W and v.z > wz * H, Vector((sg * 0.38 * W, core.y, 0.6 * H)))
  if spec.get('tail'):
    tip = max(vs, key=lambda v: v.y - 0.3 * abs(v.x))
    m['tailTip'] = tip
  if spec['profile'] == 'golem':
    for side, sg in (('L', 1), ('R', -1)):
      m['hand' + side] = centroid(lambda v: v.x * sg > 0.28 * W and v.z < 0.5 * H, Vector((sg * 0.38 * W, core.y, 0.25 * H)))
      m['foot' + side] = centroid(lambda v: v.x * sg > 0.04 * W and abs(v.x) < 0.26 * W and v.z < 0.12 * H, Vector((sg * 0.14 * W, core.y, 0.03 * H)))
  return m


def build_armature(obj, spec, m):
  H, W, D = m['H'], m['W'], m['D']
  prof = spec['profile']
  arm_data = bpy.data.armatures.new('Armature'); arm = bpy.data.objects.new('Armature', arm_data)
  bpy.context.scene.collection.objects.link(arm)
  bpy.context.view_layer.objects.active = arm
  bpy.ops.object.mode_set(mode='EDIT')
  eb = arm_data.edit_bones
  def bone(name, a, b, parent=None, deform=True):
    e = eb.new(name); e.head = a; e.tail = b; e.roll = 0
    if parent: e.parent = eb[parent]; e.use_connect = False
    e.use_deform = deform
    return e
  c = m['core']; hd = m['head']
  segs = {}
  bone('root', Vector((0, 0, 0)), Vector((0, 0, 0.12 * H)), deform=False)
  if prof == 'drake':
    back = Vector((0, c.y + 0.16 * D, 0.38 * H)); chest = Vector((0, c.y - 0.12 * D, 0.45 * H))
    neck = Vector((0, (chest.y + hd.y) / 2, 0.62 * H))
    bone('body', back, chest, 'root'); segs['body'] = (back, chest, 0.2 * H)
    bone('neck', chest, neck, 'body'); segs['neck'] = (chest, neck, 0.12 * H)
    top = Vector((0, hd.y, H)); base = Vector((0, hd.y, max(neck.z, 0.7 * H) - 0.05 * H))
    bone('head', base, top, 'neck'); segs['head'] = (base, top, 0.16 * H)
  elif prof == 'golem':
    pel = Vector((0, c.y, 0.3 * H)); ch = Vector((0, c.y, 0.58 * H)); nk = Vector((0, (c.y + hd.y) / 2, 0.78 * H)); top = Vector((0, hd.y, 1.02 * H))
    bone('body', pel, ch, 'root'); segs['body'] = (pel, ch, 0.17 * H)
    bone('chest', ch, nk, 'body'); segs['chest'] = (ch, nk, 0.15 * H)
    bone('head', nk, top, 'chest'); segs['head'] = (nk, top, 0.12 * H)
    for side, sg in (('L', 1), ('R', -1)):
      sh = Vector((sg * 0.27 * W, c.y, 0.72 * H)); hand = m['hand' + side]
      bone('arm_' + side, sh, hand, 'chest'); segs['arm_' + side] = (sh, hand, 0.085 * H)
      hip = Vector((sg * 0.13 * W, c.y, 0.3 * H)); foot = m['foot' + side]
      bone('leg_' + side, hip, Vector((foot.x, foot.y, 0.02 * H)), 'body'); segs['leg_' + side] = (hip, Vector((foot.x, foot.y, 0.0)), 0.075 * H)
  else:
    b0 = Vector((0, c.y, 0.05 * H)); b1 = Vector((0, c.y, 0.5 * H)); b2 = Vector((0, (c.y + hd.y) / 2, 0.72 * H)); b3 = Vector((0, hd.y, 1.02 * H))
    bone('body', b0, b1, 'root'); segs['body'] = (b0, b1, 0.24 * H)
    bone('chest', b1, b2, 'body'); segs['chest'] = (b1, b2, 0.16 * H)
    bone('head', b2, b3, 'chest'); segs['head'] = (b2, b3, 0.16 * H)
  if spec.get('wings'):
    parent = 'body' if prof == 'drake' else 'chest'
    for side, sg in (('L', 1), ('R', -1)):
      tipc = m['wing' + side]
      sh = Vector((sg * 0.12 * W, tipc.y, tipc.z))
      tip = Vector((tipc.x * 1.25, tipc.y, tipc.z + 0.05 * H))
      bone('wing_' + side, sh, tip, parent)
  if spec.get('tail'):
    tip = m['tailTip']; start = Vector((0, c.y + 0.22 * D, 0.3 * H)); mid = start.lerp(tip, 0.5)
    bone('tail1', start, mid, 'body'); bone('tail2', mid, tip, 'tail1')
    segs['tail1'] = (start, mid, 0.1 * H); segs['tail2'] = (mid, tip, 0.1 * H)
  bpy.ops.object.mode_set(mode='OBJECT')
  return arm, segs


def skin(obj, arm, spec, m, segs):
  H, W, D = m['H'], m['W'], m['D']
  groups = {n: obj.vertex_groups.new(name=n) for n in [b.name for b in arm.data.bones if b.use_deform]}
  wing = spec.get('wings'); tail = spec.get('tail')
  wz = spec.get('wingMinZ', 0.3)
  tail_names = [n for n in ('tail1', 'tail2') if n in segs]
  chain = [n for n in segs if n not in tail_names]
  for v in obj.data.vertices:
    p = v.co
    w = {}
    mw = 0.0
    if wing:
      mw = smooth((abs(p.x) - 0.17 * W) / (0.13 * W)) * smooth((p.z - (wz - 0.08) * H) / (0.1 * H))
    mt = 0.0
    if tail:
      mt = smooth((p.y - (m['core'].y + 0.14 * D)) / (0.12 * D)) * (1 - smooth((p.z - 0.6 * H) / (0.1 * H)))
    total_body = max(0.0, 1 - mw - mt)
    ws = {n: math.exp(-(seg_dist(p, a, b) / s) ** 2) + 1e-6 for n, (a, b, s) in segs.items() if n in chain}
    z = sum(ws.values())
    for n, x in ws.items(): w[n] = x / z * total_body
    if mt > 0 and tail_names:
      ts = {n: math.exp(-(seg_dist(p, segs[n][0], segs[n][1]) / segs[n][2]) ** 2) + 1e-6 for n in tail_names}
      tz = sum(ts.values())
      for n, x in ts.items(): w[n] = w.get(n, 0) + x / tz * mt
    if mw > 0:
      w['wing_L' if p.x > 0 else 'wing_R'] = mw
    for n, x in w.items():
      if x > 0.003: groups[n].add([v.index], x, 'REPLACE')
  obj.parent = arm
  mod = obj.modifiers.new('Armature', 'ARMATURE'); mod.object = arm


# ---------- 클립 작성 ----------

def world_rot(pitch=0.0, yaw=0.0, roll=0.0):
  return (Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Matrix.Rotation(math.radians(pitch), 3, 'X') @ Matrix.Rotation(math.radians(roll), 3, 'Y'))


class Clip:
  def __init__(self, name, seconds, loop=False, impact=None):
    self.name, self.seconds, self.loop, self.impact = name, seconds, loop, impact
    self.ch = []  # (bone, kind, fn)
  def add(self, bone, kind, fn):
    self.ch.append((bone, kind, fn)); return self


def bake(arm, clip):
  act = bpy.data.actions.new(clip.name)
  ad = arm.animation_data or arm.animation_data_create(); ad.action = act
  frames = max(2, round(clip.seconds * FPS))
  pb = arm.pose.bones
  for pbone in pb:
    pbone.rotation_mode = 'QUATERNION'
  used = {b for b, _, _ in clip.ch}
  for f in range(frames + 1):
    t = f / frames
    state = {}
    for bname, kind, fn in clip.ch:
      if bname not in pb: continue
      st = state.setdefault(bname, {'pitch': 0.0, 'yaw': 0.0, 'roll': 0.0, 'loc': Vector(), 'squash': 0.0, 'scale': 1.0})
      val = fn(t)
      if kind == 'loc': st['loc'] = st['loc'] + Vector(val)
      else: st[kind] += val
    for bname in used:
      if bname not in pb: continue
      st = state.get(bname)
      p = pb[bname]; B = arm.data.bones[bname].matrix_local.to_3x3(); Bi = B.inverted()
      R = world_rot(st['pitch'], st['yaw'], st['roll'])
      p.rotation_quaternion = (Bi @ R @ B).to_quaternion()
      p.location = Bi @ st['loc']
      s = st['squash']; k = st['scale']
      p.scale = (k * (1 + 0.5 * s), k * (1 - s), k * (1 + 0.5 * s))
      for path in ('rotation_quaternion', 'location', 'scale'):
        p.keyframe_insert(path, frame=f + 1)
  for fc in (c for layer in act.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves):
    for k in fc.keyframe_points: k.interpolation = 'LINEAR'
  ad.action = None
  tr = ad.nla_tracks.new(); tr.name = clip.name; tr.mute = True
  st = tr.strips.new(clip.name, 1, act)
  if len(act.slots): st.action_slot = act.slots[0]
  return frames


def S(t, f=1.0, ph=0.0):
  return math.sin(2 * math.pi * (f * t + ph))


def creature_clips(prof, m, spec):
  H, D = m['H'], m['D']
  fwd = lambda d: (0.0, -d, 0.0)  # Blender -Y == glTF +Z (게임 정면)
  up = lambda d: (0.0, 0.0, d)
  hov = spec.get('hover', 0.0)
  wings = bool(spec.get('wings')); tail = bool(spec.get('tail'))
  clips = []
  head = 'head'; mid = 'neck' if prof == 'drake' else 'chest'
  def flap(c, amp, freq, bias=0.0, ph=0.0):
    if not wings: return c
    c.add('wing_L', 'roll', lambda t: -(bias + amp * S(t, freq, ph)))
    c.add('wing_R', 'roll', lambda t: (bias + amp * S(t, freq, ph)))
    return c
  def wing_pose(c, pts):
    if not wings: return c
    c.add('wing_L', 'roll', lambda t: -track(t, pts)); c.add('wing_R', 'roll', lambda t: track(t, pts)); return c
  def sway_tail(c, amp, freq, ph=0.0):
    if not tail: return c
    c.add('tail1', 'yaw', lambda t: amp * S(t, freq, ph)); c.add('tail2', 'yaw', lambda t: amp * 1.4 * S(t, freq, ph - 0.12)); return c

  if prof == 'blob':
    clips.append(Clip('idle', 2.0, True).add('root', 'squash', lambda t: 0.045 * S(t)).add(head, 'roll', lambda t: 3 * S(t, 1, 0.25)).add(mid, 'pitch', lambda t: 2 * S(t, 1, 0.1)))
    for name, sec, hop, lean in (('walk', 0.9, 0.12, 6), ('run', 0.56, 0.17, 13)):
      c = Clip(name, sec, True)
      c.add('root', 'loc', lambda t, hop=hop: up(hop * H * abs(math.sin(2 * math.pi * t))))
      c.add('root', 'squash', lambda t: 0.16 * max(0, math.cos(4 * math.pi * t)) ** 6 - 0.07 * abs(math.sin(2 * math.pi * t)))
      c.add('root', 'pitch', lambda t, lean=lean: lean + 3 * S(t, 2))
      c.add(head, 'pitch', lambda t: -4 * S(t, 2, 0.15))
      clips.append(c)
    a = Clip('attack', 1.0, impact=0.55)
    a.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.4, 0.26, 'o'), (0.55, -0.24, 'i'), (0.64, 0.2, 'o'), (0.8, -0.05, 's'), (1, 0, 's')]))
    a.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -14, 'o'), (0.55, 30, 'i'), (0.72, 18, 's'), (1, 0, 's')]))
    a.add('root', 'loc', lambda t: fwd(track(t, [(0, 0, 's'), (0.4, -0.06 * D, 's'), (0.55, 0.32 * D, 'i'), (0.75, 0.24 * D, 's'), (1, 0, 's')])))
    a.add(head, 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -10, 'o'), (0.55, 16, 'i'), (1, 0, 's')]))
    clips.append(a)
    b = Clip('attack2', 0.9, impact=0.5)
    b.add('root', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.36, -34, 'o'), (0.5, 38, 'i'), (0.7, 22, 's'), (1, 0, 's')]))
    b.add('root', 'roll', lambda t: track(t, [(0, 0, 's'), (0.36, 8, 'o'), (0.5, -14, 'i'), (1, 0, 's')]))
    b.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.36, 0.18, 'o'), (0.5, -0.16, 'i'), (0.62, 0.1, 'o'), (1, 0, 's')]))
    clips.append(b)
    h = Clip('attackHeavy', 1.4, impact=0.62)
    h.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.3, 0, 's'), (0.48, 0.62 * H, 'o'), (0.62, 0, 'i'), (1, 0, 's')])))
    h.add('root', 'loc', lambda t: fwd(track(t, [(0, 0, 's'), (0.3, 0, 's'), (0.62, 0.3 * D, 's'), (1, 0, 's')])))
    h.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.3, 0.34, 'o'), (0.4, -0.3, 'i'), (0.55, -0.12, 's'), (0.62, -0.2, 'l'), (0.66, 0.42, 'i'), (0.78, -0.12, 'o'), (0.9, 0.06, 's'), (1, 0, 's')]))
    h.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.3, -8, 's'), (0.5, -12, 's'), (0.62, 16, 'i'), (1, 0, 's')]))
    clips.append(h)
    j = Clip('attackJump', 1.2, impact=0.6)
    j.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.25, 0, 's'), (0.42, 0.45 * H, 'o'), (0.6, 0, 'i'), (1, 0, 's')])))
    j.add('root', 'loc', lambda t: fwd(track(t, [(0, 0, 's'), (0.25, 0, 's'), (0.6, 0.55 * D, 's'), (1, 0, 's')])))
    j.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.25, 0.3, 'o'), (0.34, -0.26, 'i'), (0.6, -0.12, 's'), (0.64, 0.38, 'i'), (0.78, -0.1, 'o'), (1, 0, 's')]))
    clips.append(j)
    sp = Clip('attackSpin', 1.2, impact=0.5)
    sp.add('root', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.2, -25, 'o'), (0.75, 400, 's'), (1, 360, 's')]))
    sp.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.2, 0.2, 'o'), (0.35, -0.18, 'i'), (0.75, -0.1, 's'), (0.85, 0.12, 'o'), (1, 0, 's')]))
    clips.append(sp)
    for name in ('cast', 'roar'):
      cc = Clip(name, 1.5, impact=0.55)
      cc.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.3, 0.2, 'o'), (0.55, -0.3, 'i'), (0.8, -0.2, 's'), (1, 0, 's')]))
      cc.add(head, 'roll', lambda t: 7 * math.sin(40 * t) * math.exp(-((t - 0.65) / 0.18) ** 2))
      cc.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.3, -10, 'o'), (0.55, 8, 'i'), (1, 0, 's')]))
      clips.append(cc)
    for name, sec, amp in (('hit', 0.42, 1.0), ('hitHeavy', 0.75, 1.8)):
      c = Clip(name, sec)
      c.add('root', 'pitch', lambda t, a=amp: -16 * a * math.sin(math.pi * min(1, t / 0.45)) * (1 - smooth(t)) - 4 * a * math.sin(t * 18) * math.exp(-4 * t) * (t > 0.45))
      c.add('root', 'squash', lambda t, a=amp: track(t, [(0, 0, 's'), (0.12, 0.26 * a, 'o'), (0.3, -0.14 * a, 's'), (0.55, 0.06 * a, 's'), (1, 0, 's')]))
      c.add('root', 'loc', lambda t, a=amp: fwd(-0.12 * D * (a - 0.6) * math.sin(math.pi * min(1, t / 0.6))))
      clips.append(c)
    d = Clip('death', 1.2)
    d.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.15, -0.2, 'o'), (0.5, 0.7, 'i'), (0.62, 0.64, 's'), (0.72, 0.84, 's'), (1, 0.82, 's')]))
    d.add('root', 'roll', lambda t: track(t, [(0, 0, 's'), (0.5, 12, 's'), (1, 10, 's')]))
    clips.append(d)
    clips.append(Clip('spawn', 0.8).add('root', 'scale', lambda t: track(t, [(0, -0.85, 's'), (0.55, 0.12, 'o'), (0.75, -0.05, 's'), (1, 0, 's')])).add('root', 'squash', lambda t: track(t, [(0, 0.3, 's'), (0.5, -0.25, 'o'), (0.75, 0.1, 's'), (1, 0, 's')])))
    return clips

  if prof == 'golem':
    def arms(c, lp, rp, lr=None, rr=None):
      c.add('arm_L', 'pitch', lp); c.add('arm_R', 'pitch', rp)
      if lr: c.add('arm_L', 'roll', lr)
      if rr: c.add('arm_R', 'roll', rr)
      return c
    c = Clip('idle', 2.4, True).add('chest', 'pitch', lambda t: 2.5 * S(t)).add('head', 'pitch', lambda t: -2 * S(t, 1, 0.2)).add('root', 'squash', lambda t: 0.012 * S(t))
    arms(c, lambda t: -5 * S(t, 1, 0.1), lambda t: -5 * S(t, 1, 0.15)); clips.append(c)
    for name, sec, amp, lean in (('walk', 1.2, 22, 6), ('run', 0.75, 32, 13)):
      c = Clip(name, sec, True)
      c.add('leg_L', 'pitch', lambda t, a=amp: -a * S(t)).add('leg_R', 'pitch', lambda t, a=amp: a * S(t))
      arms(c, lambda t, a=amp: 0.65 * a * S(t), lambda t, a=amp: -0.65 * a * S(t))
      c.add('root', 'roll', lambda t, a=amp: 0.2 * a * S(t, 1, 0.25)).add('root', 'pitch', lambda t, l=lean: l)
      c.add('root', 'loc', lambda t, a=amp: up(0.0011 * a * H * (1 - math.cos(4 * math.pi * t)) / 2))
      c.add('chest', 'yaw', lambda t, a=amp: 0.25 * a * S(t))
      clips.append(c)
    a = Clip('attack', 1.2, impact=0.55)
    arms(a, lambda t: track(t, [(0, 0, 's'), (0.25, 10, 's'), (0.55, 18, 'i'), (1, 0, 's')]),
         lambda t: track(t, [(0, 0, 's'), (0.42, -108, 'o'), (0.55, -38, 'i'), (0.72, -44, 's'), (1, 0, 's')]))
    a.add('chest', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.42, -15, 'o'), (0.55, 24, 'i'), (0.75, 12, 's'), (1, 0, 's')]))
    a.add('chest', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.42, 18, 'o'), (0.55, -14, 'i'), (1, 0, 's')]))
    a.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.5, 0.02 * H, 's'), (0.58, -0.05 * H, 'i'), (0.8, 0, 's')])))
    a.add('leg_R', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.42, 8, 's'), (0.55, -22, 'i'), (1, 0, 's')]))
    clips.append(a)
    b = Clip('attack2', 1.0, impact=0.5)
    arms(b, lambda t: track(t, [(0, 0, 's'), (0.36, -40, 'o'), (0.5, -62, 'i'), (0.66, -45, 's'), (1, 0, 's')]),
         lambda t: track(t, [(0, 0, 's'), (0.36, 12, 's'), (1, 0, 's')]),
         lambda t: track(t, [(0, 0, 's'), (0.36, -55, 'o'), (0.5, 12, 'i'), (1, 0, 's')]))
    b.add('chest', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.36, 38, 'o'), (0.5, -48, 'i'), (0.66, -30, 's'), (1, 0, 's')]))
    b.add('root', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.36, 10, 'o'), (0.5, -14, 'i'), (1, 0, 's')]))
    clips.append(b)
    h = Clip('attackHeavy', 1.5, impact=0.6)
    arms(h, lambda t: track(t, [(0, 0, 's'), (0.45, -118, 'o'), (0.6, -28, 'i'), (0.78, -34, 's'), (1, 0, 's')]),
         lambda t: track(t, [(0, 0, 's'), (0.45, -118, 'o'), (0.6, -28, 'i'), (0.78, -34, 's'), (1, 0, 's')]))
    h.add('chest', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.45, -20, 'o'), (0.6, 30, 'i'), (0.8, 14, 's'), (1, 0, 's')]))
    h.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.45, 0.04 * H, 'o'), (0.62, -0.09 * H, 'i'), (0.85, 0, 's')])))
    h.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.58, 0, 's'), (0.63, 0.1, 'i'), (0.8, 0, 'o'), (1, 0, 's')]))
    clips.append(h)
    j = Clip('attackJump', 1.4, impact=0.6)
    j.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.22, -0.05 * H, 's'), (0.42, 0.32 * H, 'o'), (0.6, -0.06 * H, 'i'), (0.85, 0, 's')])))
    arms(j, lambda t: track(t, [(0, 0, 's'), (0.22, 25, 's'), (0.42, -110, 'o'), (0.6, -30, 'i'), (1, 0, 's')]),
         lambda t: track(t, [(0, 0, 's'), (0.22, 25, 's'), (0.42, -110, 'o'), (0.6, -30, 'i'), (1, 0, 's')]))
    j.add('leg_L', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.42, -30, 'o'), (0.6, 0, 'i'), (1, 0, 's')]))
    j.add('leg_R', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.42, -18, 'o'), (0.6, 0, 'i'), (1, 0, 's')]))
    j.add('chest', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.42, -12, 'o'), (0.6, 26, 'i'), (1, 0, 's')]))
    clips.append(j)
    sp = Clip('attackSpin', 1.4, impact=0.5)
    sp.add('root', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.2, -30, 'o'), (0.8, 390, 's'), (1, 360, 's')]))
    arms(sp, lambda t: track(t, [(0, 0, 's'), (0.25, -20, 's'), (0.8, -20, 's'), (1, 0, 's')]), lambda t: track(t, [(0, 0, 's'), (0.25, -20, 's'), (0.8, -20, 's'), (1, 0, 's')]),
         lambda t: track(t, [(0, 0, 's'), (0.25, -78, 'o'), (0.8, -78, 's'), (1, 0, 's')]), lambda t: track(t, [(0, 0, 's'), (0.25, 78, 'o'), (0.8, 78, 's'), (1, 0, 's')]))
    clips.append(sp)
    for name in ('cast', 'roar'):
      cc = Clip(name, 1.6, impact=0.55)
      arms(cc, lambda t: track(t, [(0, 0, 's'), (0.4, -35, 'o'), (0.55, -60, 'i'), (1, 0, 's')]), lambda t: track(t, [(0, 0, 's'), (0.4, -35, 'o'), (0.55, -60, 'i'), (1, 0, 's')]),
           lambda t: track(t, [(0, 0, 's'), (0.4, -70, 'o'), (0.55, -40, 'i'), (1, 0, 's')]), lambda t: track(t, [(0, 0, 's'), (0.4, 70, 'o'), (0.55, 40, 'i'), (1, 0, 's')]))
      cc.add('chest', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -20, 'o'), (0.55, 12, 'i'), (1, 0, 's')]) + 3 * math.sin(50 * t) * math.exp(-((t - 0.62) / 0.15) ** 2))
      cc.add('head', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -24, 'o'), (0.55, 12, 'i'), (1, 0, 's')]))
      clips.append(cc)
    for name, sec, amp in (('hit', 0.45, 1.0), ('hitHeavy', 0.8, 1.8)):
      c = Clip(name, sec)
      c.add('chest', 'pitch', lambda t, a=amp: -14 * a * math.sin(math.pi * min(1, t / 0.5)) * (1 - smooth(t)))
      c.add('head', 'pitch', lambda t, a=amp: -12 * a * math.sin(math.pi * min(1, t / 0.4)))
      c.add('root', 'pitch', lambda t, a=amp: -4 * (a - 0.5) * math.sin(math.pi * min(1, t / 0.6)))
      c.add('root', 'loc', lambda t, a=amp: fwd(-0.08 * D * (a - 0.6) * math.sin(math.pi * min(1, t / 0.6))))
      arms(c, lambda t, a=amp: 18 * a * math.sin(math.pi * min(1, t / 0.45)), lambda t, a=amp: 22 * a * math.sin(math.pi * min(1, t / 0.45)))
      clips.append(c)
    d = Clip('death', 1.8)
    d.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.18, 10, 's'), (0.7, -88, 'i'), (0.78, -82, 'o'), (0.86, -88, 'i'), (1, -88, 's')]))
    arms(d, lambda t: track(t, [(0, 0, 's'), (0.18, -30, 's'), (0.7, -55, 's'), (1, -50, 's')]), lambda t: track(t, [(0, 0, 's'), (0.18, -20, 's'), (0.7, -60, 's'), (1, -55, 's')]),
         lambda t: track(t, [(0, 0, 's'), (0.7, -40, 's'), (1, -45, 's')]), lambda t: track(t, [(0, 0, 's'), (0.7, 40, 's'), (1, 45, 's')]))
    d.add('head', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.18, 15, 's'), (0.7, -20, 's'), (1, -15, 's')]))
    clips.append(d)
    clips.append(Clip('spawn', 1.0).add('root', 'scale', lambda t: track(t, [(0, -0.85, 's'), (0.6, 0.06, 'o'), (0.8, -0.03, 's'), (1, 0, 's')])).add('chest', 'pitch', lambda t: track(t, [(0, 20, 's'), (0.6, -15, 'o'), (1, 0, 's')])))
    return clips

  # ---- 비행체·드레이크: 지면 원점 기준 모델을 게임이 hover 만큼 띄운다. ----
  bob = 0.035 * H
  c = Clip('idle', 1.2, True).add('root', 'loc', lambda t: up(bob * S(t))).add('root', 'pitch', lambda t: 3 * S(t, 1, 0.2)).add(head, 'pitch', lambda t: -3 * S(t, 1, 0.35))
  flap(c, 32, 2, 8); sway_tail(c, 10, 1); clips.append(c)
  for name, sec, lean, amp in (('walk', 0.8, 12, 40), ('run', 0.5, 22, 48)):
    c = Clip(name, sec, True).add('root', 'loc', lambda t: up(bob * 1.3 * S(t, 2))).add('root', 'pitch', lambda t, l=lean: l + 3 * S(t, 2, 0.2))
    c.add(head, 'pitch', lambda t, l=lean: -0.6 * l)
    flap(c, amp, 2, 10); sway_tail(c, 14, 1); clips.append(c)
  a = Clip('attack', 1.0, impact=0.55)
  a.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -26, 'o'), (0.55, 34, 'i'), (0.72, 20, 's'), (1, 0, 's')]))
  a.add('root', 'loc', lambda t: fwd(track(t, [(0, 0, 's'), (0.4, -0.15 * D, 'o'), (0.55, 0.42 * D, 'i'), (0.75, 0.3 * D, 's'), (1, 0, 's')])))
  a.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.4, 0.12 * H, 'o'), (0.55, -0.1 * H, 'i'), (1, 0, 's')])))
  a.add(head, 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -18, 'o'), (0.55, 26, 'i'), (0.7, 10, 's'), (1, 0, 's')]))
  wing_pose(a, [(0, 0, 's'), (0.4, 62, 'o'), (0.55, -38, 'i'), (0.75, -20, 's'), (1, 0, 's')])
  sway_tail(a, 12, 1.5); clips.append(a)
  b = Clip('attack2', 0.85, impact=0.5)
  if prof == 'drake' and tail:
    b.add('root', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.35, 40, 'o'), (0.5, -95, 'i'), (0.7, -70, 's'), (1, 0, 's')]))
    b.add('tail1', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.35, -30, 'o'), (0.5, 40, 'i'), (1, 0, 's')]))
    b.add('tail2', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.38, -40, 'o'), (0.54, 55, 'i'), (1, 0, 's')]))
  else:
    b.add(head, 'pitch', lambda t: track(t, [(0, 0, 's'), (0.35, -30, 'o'), (0.5, 48, 'i'), (0.62, 30, 's'), (1, 0, 's')]))
    b.add(mid, 'pitch', lambda t: track(t, [(0, 0, 's'), (0.35, -12, 'o'), (0.5, 22, 'i'), (1, 0, 's')]))
    b.add('root', 'loc', lambda t: fwd(track(t, [(0, 0, 's'), (0.35, -0.08 * D, 'o'), (0.5, 0.3 * D, 'i'), (1, 0, 's')])))
  flap(b, 26, 2, 6); clips.append(b)
  h = Clip('attackHeavy', 1.4, impact=0.62)
  h.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.42, 0.42 * H, 'o'), (0.62, -hov, 'i'), (0.75, -hov * 0.85, 's'), (1, 0, 's')])))
  h.add('root', 'loc', lambda t: fwd(track(t, [(0, 0, 's'), (0.42, -0.1 * D, 's'), (0.62, 0.45 * D, 'i'), (1, 0, 's')])))
  h.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.42, -22, 'o'), (0.62, 28, 'i'), (0.8, 10, 's'), (1, 0, 's')]))
  h.add('root', 'squash', lambda t: track(t, [(0, 0, 's'), (0.6, -0.08, 's'), (0.66, 0.22, 'i'), (0.8, -0.04, 'o'), (1, 0, 's')]))
  wing_pose(h, [(0, 0, 's'), (0.42, 75, 'o'), (0.62, -45, 'i'), (0.8, -10, 's'), (1, 0, 's')])
  sway_tail(h, 16, 1.2); clips.append(h)
  j = Clip('attackJump', 1.2, impact=0.58)
  j.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.35, 0.3 * H, 'o'), (0.58, -hov, 'i'), (0.72, -hov * 0.8, 's'), (1, 0, 's')])))
  j.add('root', 'loc', lambda t: fwd(track(t, [(0, 0, 's'), (0.58, 0.6 * D, 's'), (1, 0, 's')])))
  j.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.35, -15, 'o'), (0.58, 36, 'i'), (1, 0, 's')]))
  wing_pose(j, [(0, 0, 's'), (0.35, 70, 'o'), (0.58, -40, 'i'), (1, 0, 's')]); clips.append(j)
  sp = Clip('attackSpin', 1.2, impact=0.5)
  sp.add('root', 'yaw', lambda t: track(t, [(0, 0, 's'), (0.2, -30, 'o'), (0.78, 400, 's'), (1, 360, 's')]))
  sp.add('root', 'roll', lambda t: 14 * math.sin(math.pi * t))
  wing_pose(sp, [(0, 0, 's'), (0.2, 30, 's'), (0.4, -10, 's'), (0.8, -10, 's'), (1, 0, 's')])
  sway_tail(sp, 20, 2); clips.append(sp)
  for name in ('cast', 'roar'):
    cc = Clip(name, 1.5, impact=0.55)
    cc.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -24, 'o'), (0.55, 18, 'i'), (0.75, 8, 's'), (1, 0, 's')]))
    cc.add(head, 'pitch', lambda t: track(t, [(0, 0, 's'), (0.4, -24, 'o'), (0.55, 20, 'i'), (1, 0, 's')]) + 4 * math.sin(48 * t) * math.exp(-((t - 0.62) / 0.15) ** 2))
    cc.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.4, 0.14 * H, 'o'), (0.55, 0.02 * H, 'i'), (1, 0, 's')])))
    wing_pose(cc, [(0, 0, 's'), (0.4, 40, 'o'), (0.55, 4, 'i'), (0.75, 6, 's'), (1, 0, 's')])
    sway_tail(cc, 12, 1.5); clips.append(cc)
  for name, sec, amp in (('hit', 0.42, 1.0), ('hitHeavy', 0.75, 1.7)):
    c = Clip(name, sec)
    c.add('root', 'pitch', lambda t, a=amp: -18 * a * math.sin(math.pi * min(1, t / 0.5)) * (1 - smooth(t)))
    c.add('root', 'loc', lambda t, a=amp: fwd(-0.16 * D * a * math.sin(math.pi * min(1, t / 0.55))))
    c.add('root', 'loc', lambda t, a=amp: up(0.06 * H * a * math.sin(math.pi * min(1, t / 0.4))))
    c.add(head, 'pitch', lambda t, a=amp: -14 * a * math.sin(math.pi * min(1, t / 0.4)))
    wing_pose(c, [(0, 0, 's'), (0.15, -30 * amp, 'o'), (0.5, 10, 's'), (1, 0, 's')])
    clips.append(c)
  d = Clip('death', 1.4)
  d.add('root', 'loc', lambda t: up(track(t, [(0, 0, 's'), (0.2, 0.08 * H, 'o'), (0.62, -hov, 'i'), (0.72, -hov + 0.05 * H, 'o'), (0.82, -hov, 'i'), (1, -hov, 's')])))
  d.add('root', 'roll', lambda t: track(t, [(0, 0, 's'), (0.2, -10, 's'), (0.62, 78, 'i'), (0.72, 70, 's'), (1, 80, 's')]))
  d.add('root', 'pitch', lambda t: track(t, [(0, 0, 's'), (0.2, -20, 's'), (0.62, 10, 's'), (1, 6, 's')]))
  wing_pose(d, [(0, 0, 's'), (0.2, 50, 'o'), (0.62, -60, 'i'), (1, -55, 's')])
  sway_tail(d, 6, 1); clips.append(d)
  clips.append(Clip('spawn', 0.8).add('root', 'scale', lambda t: track(t, [(0, -0.85, 's'), (0.55, 0.1, 'o'), (0.8, -0.04, 's'), (1, 0, 's')])))
  if wings: flap(clips[-1], 50, 2, 10)
  return clips


def triangle_count(obj):
  dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles(); n = len(me.loop_triangles); ev.to_mesh_clear(); return n


def main():
  spec = json.loads(Path(arg('spec')).read_text(encoding='utf-8'))
  obj = load_mesh(spec)
  limit = spec.get('triLimit', 12000)
  n = triangle_count(obj)
  if n > limit:
    mod = obj.modifiers.new('Budget', 'DECIMATE'); mod.ratio = limit / n * 0.96
    bpy.context.view_layer.objects.active = obj; bpy.ops.object.modifier_apply(modifier=mod.name)
  mats = [m for m in obj.data.materials if m]
  if len(mats) > 2: raise RuntimeError('material budget exceeded')
  for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > spec.get('texLimit', 1024):
      f = spec.get('texLimit', 1024) / max(w, h); img.scale(max(1, round(w * f)), max(1, round(h * f))); img.pack()
  m = landmarks(obj, spec)
  arm, segs = build_armature(obj, spec, m)
  skin(obj, arm, spec, m, segs)
  report = {'id': spec['id'], 'profile': spec['profile'], 'bones': [b.name for b in arm.data.bones], 'clips': {}, 'impacts': {},
            'landmarks': {k: (list(map(lambda x: round(x, 3), v)) if hasattr(v, 'x') else round(v, 3)) for k, v in m.items()}}
  for clip in creature_clips(spec['profile'], m, spec):
    frames = bake(arm, clip)
    report['clips'][clip.name] = {'seconds': clip.seconds, 'frames': frames, 'loop': clip.loop}
    if clip.impact is not None and clip.name in ('attack', 'attack2', 'attackHeavy', 'attackSpin', 'attackJump', 'cast'):
      report['impacts'][clip.name] = clip.impact
  for pb in arm.pose.bones:
    pb.rotation_quaternion = Quaternion(); pb.location = Vector(); pb.scale = Vector((1, 1, 1))
  bpy.context.scene.frame_set(0)
  os.makedirs(os.path.dirname(spec['output']), exist_ok=True)
  bpy.ops.export_scene.gltf(filepath=spec['output'], export_format='GLB', export_yup=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_anim_slide_to_zero=True, export_apply=False,
    export_cameras=False, export_lights=False, export_image_format='WEBP', export_image_quality=82)
  report.update({'ok': True, 'triangles': triangle_count(obj), 'materials': len(mats), 'bytes': os.path.getsize(spec['output']), 'height': spec['height']})
  Path(arg('report')).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')


try:
  main()
except Exception as e:
  Path(arg('report')).write_text(json.dumps({'ok': False, 'error': repr(e)}), encoding='utf-8')
  raise

