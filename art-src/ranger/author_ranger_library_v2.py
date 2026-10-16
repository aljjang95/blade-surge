"""궁수 라이브러리 몸체(hero_ranger_t1) 전신 리타깃·활 동작 재저작 v2 — Blender 4.3 배경 실행.

v1 의 한계(실측): Mixamo 쿼터니언을 롤이 다른 Tripo 리그에 그대로 복사해(blender_merge_mixamo.py action.copy) 몸통·다리 축이
돌아갔다. Hips/Spine/다리 로컬 X(Mixamo 의 굽힘 축)가 ranger 에서는 앞뒤 축이라, 무릎 굽힘이 옆꺾임이 되고 상체 숙임이 옆기울기가 된다.
v1 은 팔만 IK 로 덮었다. 또 blender_normalize.py 가 Hips 위치의 본 로컬 인덱스 0·1 을 평탄화해 수직 골반 이동이 사라졌다(구르기·사망 부유).

v2:
 1) 전신 축 리타깃: 기준 리그(knight 1단계, Mixamo 관례 축)의 본별 X 축을 ranger 본 Y 축에 투영해 '같은 본 방향 + Mixamo 롤' 가상 rest 를 만들고,
    C = R_ranger⁻¹·R_mixamo 로 모든 회전 키를 q' = C·q·C⁻¹ 로 옮긴다. 스킨 변형은 가상 rest 에 값을 그대로 쓴 것과 같다(rest·역바인드 불변).
 2) 골반 높이: 수평 루트 이동은 게임이 맡으므로 0, 수직은 실제 스킨 최저점 접지로 다시 푼다. 달리기는 접지 고정 대신 보폭 리듬(지지 최저·공중 최고).
 3) 활: 왼손 고정 그립(RangerBowGrip_L)·오른손 노크(RangerDrawNock_R) 소켓은 v1 정의 그대로. 활 팔은 가슴 기준 IK + 원본 팔 흔들림 일부,
    오른팔은 리타깃된 원본 동작. bow_shoot 는 상체를 과녁 쪽으로 비틀어(옆선 자세) 화살선이 정면인 당김→만작→발사(위상 0.42)→팔로스루를 새로 저작.
 4) 회피: 앞구르기 = 리타깃된 원본 구르기 구간을 게임에 보이는 0.5초에 맞춤 + 실제 접지. 백스텝 = 역재생이 아닌 새 뒤로 뛰기(다리 IK).
 5) 피격: 0.96초 반응을 게임에 보이는 0.5초 안에 끝나게 리타이밍.

실행: blender -b --factory-startup --python art-src/ranger/author_ranger_library_v2.py -- <원본.glb> <기준 knight.glb> <출력폴더> [활 미리보기.obj]
출력: ranger-library-anim-v2.glb(뼈대·클립·소켓만), ranger-library-v2.blend, ranger-library-author-report-v2.json
원본 GLB 는 읽기만 하며 메시·스킨 바이트는 tools/art/pack-ranger-library.mjs 가 원본 그대로 보존한다.
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SOURCE, REFERENCE, OUT = argv[0], argv[1], argv[2]
BOW_OBJ = argv[3] if len(argv) > 3 else None
os.makedirs(OUT, exist_ok=True)
FPS = 24
P = 'mixamorig:'

# ---- 0) 기준 축: Mixamo 관례 리그(knight 1단계)의 본별 월드 X 축 ----
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=REFERENCE)
_ref = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
_rw = _ref.matrix_world.to_3x3().normalized()
REF_X = {b.name: (_rw @ b.matrix_local.to_3x3()).normalized().col[0].copy() for b in _ref.data.bones}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SOURCE)
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH' and o.find_armature() == arm)
for o in scene.objects:
    if o.type == 'MESH' and o is not body: o.hide_render = True
W = arm.matrix_world.copy()
ARM_SCALE = W.to_scale().x
Wr = W.to_3x3().normalized()
SOURCE_ACTIONS = {a.name.replace('_Armature', ''): a for a in bpy.data.actions}
pb = arm.pose.bones

def bone_world_rest(name):
    m = W @ arm.data.bones[P + name].matrix_local
    return m.to_translation(), m.to_3x3().normalized()

# ---- 1) 전신 축 리타깃 ----
AXIS = {}
for b in arm.data.bones:
    side = 'Left' if 'Left' in b.name else 'Right'
    ref = REF_X.get(b.name) or REF_X.get(P + side + 'HandIndex1')
    R = (Wr @ b.matrix_local.to_3x3()).normalized()
    y = R.col[1]; x = ref - y * ref.dot(y)
    if x.length < 1e-3: continue
    x.normalize()
    AXIS[b.name] = (R.transposed() @ Matrix((x, y, x.cross(y))).transposed()).to_quaternion()

def retarget_action(act):
    for name, c in AXIS.items():
        fq = [act.fcurves.find(f'pose.bones["{name}"].rotation_quaternion', index=i) for i in range(4)]
        if fq[0] is not None:
            ci = c.inverted()
            for k in range(len(fq[0].keyframe_points)):
                q = Quaternion([fq[i].keyframe_points[k].co[1] for i in range(4)])
                q2 = c @ q @ ci
                for i in range(4):
                    kp = fq[i].keyframe_points[k]; kp.co[1] = q2[i]; kp.interpolation = 'LINEAR'
        # 위치: 수평 루트 이동은 게임이 맡고, 원본 수직은 평탄화되어 없다(접지로 다시 푼다). 다른 본 위치·배율 키는 rest 로.
        for path, value in (('location', 0.0), ('scale', 1.0)):
            for i in range(3):
                fc = act.fcurves.find(f'pose.bones["{name}"].{path}', index=i)
                if fc is not None:
                    for kp in fc.keyframe_points: kp.co[1] = value; kp.interpolation = 'LINEAR'
    for fc in act.fcurves: fc.update()
for a in SOURCE_ACTIONS.values(): retarget_action(a)

# ---- 2) IK 가 쓰는 팔·다리 본 길이만 자식 머리까지로 맞춘다(머리·Y축·롤 = 내보내는 rest 행렬은 그대로) ----
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
for side in ('Left', 'Right'):
    for bone, child in (('Arm', 'ForeArm'), ('ForeArm', 'Hand'), ('Hand', 'HandMiddle1'), ('UpLeg', 'Leg'), ('Leg', 'Foot')):
        b, c = eb[P + side + bone], eb[P + side + child]
        roll = b.roll
        b.tail = b.head + (b.tail - b.head).normalized() * (c.head - b.head).length
        b.roll = roll
bpy.ops.object.mode_set(mode='OBJECT')

# ---- 3) 손 의미 축과 v1 과 같은 고정 그립·노크 소켓 ----
def hand_semantics(side):
    head, R = bone_world_rest(side + 'Hand')
    finger = (bone_world_rest(side + 'HandMiddle1')[0] - head).normalized()
    palm = Vector((0, 0, -1)); palm = (palm - finger * palm.dot(finger)).normalized()
    Rt = R.transposed()
    return {'head': head, 'R': R, 'f_l': (Rt @ finger).normalized(), 'p_l': (Rt @ palm).normalized(), 'finger_w': finger, 'palm_w': palm}

def frame(f, p):
    f = f.normalized(); p = (p - f * p.dot(f)).normalized()
    return Matrix((f, p, f.cross(p))).transposed()

HAND = {s: hand_semantics(s) for s in ('Left', 'Right')}
for s in HAND: HAND[s]['L'] = frame(HAND[s]['f_l'], HAND[s]['p_l'])
GRIP_ALONG, GRIP_PALM = 0.08, 0.03
NOCK_ALONG, NOCK_PALM = 0.12, 0.03
BOW_WORLD_SCALE = 0.7619
BOW_NOCK_LOCAL = Vector((0.177, 0, 0))
BOW_TIP_LOCAL = 1.1386
NOCK_BACK = BOW_NOCK_LOCAL.x * BOW_WORLD_SCALE

def bow_axes(limb, shot):
    limb = Vector(limb).normalized(); shot = Vector(shot); shot = (shot - limb * shot.dot(limb)).normalized()
    X = -shot; Y = -limb; Z = X.cross(Y)
    return Matrix((X, Y, Z)).transposed()

def left_hand_from_bow(E):
    return frame(-E.col[0], E.col[2]) @ HAND['Left']['L'].transposed()

def right_hand(finger, palm):
    return frame(Vector(finger), Vector(palm)) @ HAND['Right']['L'].transposed()

arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
def bone_empty(name, bone, matrix_world, size=0.05):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e)
    e.empty_display_size = size; e.parent = arm; e.parent_type = 'BONE'; e.parent_bone = P + bone
    bpy.context.view_layer.update(); e.matrix_world = matrix_world; bpy.context.view_layer.update()
    return e
hl = HAND['Left']
Pm = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0))).transposed()
E_rest = hl['R'] @ hl['L'] @ Pm.transposed()
grip_pos = hl['head'] + hl['finger_w'] * GRIP_ALONG + hl['palm_w'] * GRIP_PALM
grip = bone_empty('RangerBowGrip_L', 'LeftHand', Matrix.Translation(grip_pos) @ E_rest.to_4x4() @ Matrix.Diagonal((BOW_WORLD_SCALE,) * 3 + (1,)))
hr = HAND['Right']
nock = bone_empty('RangerDrawNock_R', 'RightHand', Matrix.Translation(hr['head'] + hr['finger_w'] * NOCK_ALONG + hr['palm_w'] * NOCK_PALM), 0.03)
assert hl['R'].to_quaternion().rotation_difference(left_hand_from_bow(E_rest).to_quaternion()).angle < 1e-4

# ---- 4) 목표 empty 와 제약 ----
chest_head, _ = bone_world_rest('Spine2')
C = chest_head
chest = bone_empty('Ranger_ChestFrame', 'Spine2', Matrix.Translation(chest_head), 0.1)
def free_empty(name, parent=None):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e)
    if parent is not None: e.parent = parent; e.matrix_parent_inverse = Matrix.Identity(4)
    e.rotation_mode = 'QUATERNION'; return e
# 가슴 기준(활을 몸에 붙여 다니는 동작)과 월드 기준(화살선을 정면에 고정하는 사격) 두 벌
T = {k: free_empty(k, chest) for k in ('wrist_L', 'wrist_R', 'pole_L', 'pole_R')}
TW = {k: free_empty(k + '_world') for k in ('wrist_L', 'wrist_R', 'pole_L', 'pole_R', 'ankle_L', 'ankle_R', 'knee_L', 'knee_R')}
arm.data.pose_position = 'POSE'
CON = {}
for side in ('Left', 'Right'):
    s = side[0]
    ik = pb[P + side + 'ForeArm'].constraints.new('IK'); ik.name = 'Ranger arm IK'
    ik.chain_count = 2; ik.iterations = 200
    cr = pb[P + side + 'Hand'].constraints.new('COPY_ROTATION'); cr.target_space = cr.owner_space = 'WORLD'
    CON['arm_' + s] = (ik, cr)
    lik = pb[P + side + 'Leg'].constraints.new('IK'); lik.name = 'Ranger leg IK'
    lik.chain_count = 2; lik.iterations = 200; lik.target = TW['ankle_' + s]; lik.pole_target = TW['knee_' + s]
    lik.pole_angle = 0.0
    CON['leg_' + s] = (lik,)

def set_arm(side, mode):
    """mode: None(원본 FK) | 'chest' | 'world'"""
    ik, cr = CON['arm_' + side]
    if mode is None:
        ik.mute = cr.mute = True; return
    src = T if mode == 'chest' else TW
    ik.target = src['wrist_' + side]; ik.pole_target = src['pole_' + side]; cr.target = src['wrist_' + side]
    ik.mute = cr.mute = False

def set_legs(on):
    for s in ('L', 'R'): CON['leg_' + s][0].mute = not on

def mute_all():
    set_arm('L', None); set_arm('R', None); set_legs(False)

# 다리 IK 극 각도: rest 에서 무릎이 극 방향을 향하도록 실측으로 맞춘다(Blender IK 극 각도는 본 롤에 의존).
def calibrate_leg_pole(side):
    lik = CON['leg_' + side[0]][0]
    foot, _ = bone_world_rest(side + 'Foot'); knee, _ = bone_world_rest(side + 'Leg')
    TW['ankle_' + side[0]].location = foot; TW['knee_' + side[0]].location = knee + Vector((0, -0.6, 0))
    best = None
    for deg in range(-180, 180, 5):
        lik.pole_angle = math.radians(deg); lik.mute = False; bpy.context.view_layer.update()
        dev = ((W @ pb[P + side + 'Leg'].head) - knee).length
        if best is None or dev < best[0]: best = (dev, deg)
    lik.pole_angle = math.radians(best[1]); lik.mute = True
    return best
arm.animation_data.action = None
for b in pb: b.rotation_quaternion = Quaternion(); b.location = Vector(); b.scale = Vector((1, 1, 1))
LEG_POLE = {s: calibrate_leg_pole(s) for s in ('Left', 'Right')}
mute_all()

# ---- 5) 자세 정의 (월드 좌표 m; 앞=-Y, 왼쪽=+X, 위=+Z) ----
def at(x, y, z): return Vector((x, y, z))
def pose(base=None, **kw): d = dict(base or {}); d.update(kw); return d
READY = dict(grip=at(0.27, -0.16, 0.86), limb=(0.12, -0.8, 0.62), shot=(0, -0.6, -0.8), poleL=at(0.7, 0.5, 0.8))
RUN = pose(READY, grip=at(0.27, -0.14, 0.78), limb=(0.08, -0.9, 0.45), shot=(0, -0.45, -0.9))
GUARD = pose(READY, grip=at(0.2, -0.36, 1.0), limb=(0.05, -0.5, 0.86), shot=(0, -0.86, -0.5))
# 구르기·사망: 활을 몸 앞에 가로로 쥔다. 앞구르기는 좌우 축으로 돌므로 가로 활은 회전 내내 수평이고, 누운 몸에서도 가슴 위에 놓여 바닥을 뚫지 않는다.
TUCK = pose(READY, grip=at(0.14, -0.30, 0.94), limb=(1.0, 0.0, 0.12), shot=(0, -1, 0.15), poleL=at(0.6, 0.3, 0.7))
FALL = pose(READY, grip=at(0.12, -0.32, 0.98), limb=(1.0, 0.05, 0.2), shot=(0, -1, 0.1), poleL=at(0.6, 0.3, 0.7))

# 사격(월드 기준, 화살선 = 몸 정면 -Y). 화살선 높이 Z_A, 그립 x 로 선이 지난다.
Z_A = 1.10
DRAW_GRIP = at(0.07, -0.64, Z_A)
DRAW_LIMB, DRAW_SHOT = (-0.16, 0, 0.99), (0, -1, 0)
REST_NOCK = DRAW_GRIP + Vector((0, 1, 0)) * NOCK_BACK
ANCHOR = DRAW_GRIP + Vector((0, 1, 0)) * 0.44
PULL = dict(finger=(0, -1, 0), palm=(1, 0, 0))
POLE_BOW = at(0.55, -0.25, 0.80)
POLE_DRAW = at(-0.45, 0.45, 1.30)
def nock_of(grip_pos, limb, shot):
    E = bow_axes(limb, shot); return grip_pos + E @ (BOW_NOCK_LOCAL * BOW_WORLD_SCALE)
AIM_GRIP, AIM_LIMB, AIM_SHOT = at(0.12, -0.52, 0.98), (-0.30, -0.25, 0.92), (0, -1, -0.12)
AIM_READY = dict(grip=AIM_GRIP, limb=AIM_LIMB, shot=AIM_SHOT, pinch=nock_of(AIM_GRIP, AIM_LIMB, AIM_SHOT) + Vector((0, 0.02, 0)),
                 finger=(0.1, -1, -0.15), palm=(1, 0, 0), poleL=POLE_BOW, poleR=at(-0.5, 0.35, 1.0), twist=34)
NOCKED = pose(AIM_READY, grip=DRAW_GRIP, limb=DRAW_LIMB, shot=DRAW_SHOT, pinch=REST_NOCK, poleR=POLE_DRAW, twist=48, **PULL)
DRAWN = pose(NOCKED, pinch=ANCHOR, twist=56)
LOOSE = pose(DRAWN, pinch=ANCHOR + Vector((-0.10, 0.10, 0.04)), finger=(-0.35, -0.7, 0.3), palm=(0.7, 0, 0.4), twist=58)
FOLLOW = pose(LOOSE, pinch=ANCHOR + Vector((-0.13, 0.12, 0.01)), grip=DRAW_GRIP + Vector((0, 0.02, -0.02)), twist=55)
SHOT_KEYS = [(0, AIM_READY), (3, NOCKED), (7, DRAWN), (10, DRAWN), (11, LOOSE), (14, FOLLOW), (18, AIM_READY), (24, AIM_READY)]
# 연속 관통(quickshot·gale_hunt): 시전 0.42 뒤 +0.12·+0.24초에 화살이 더 나간다(스킬 dur .8/.9 → 클립 위상 ≈0.57·0.71).
# 같은 그립·화살선에서 짧게 놓고(LOOSE_S) 쉼 노크로 돌아와(NOCKED_R) 다시 당긴다. 세 번 당기고 세 번 놓는다.
LOOSE_S = pose(DRAWN, pinch=ANCHOR + Vector((-0.07, 0.06, 0.03)), finger=(-0.3, -0.75, 0.25), palm=(0.75, 0, 0.35), twist=57)
NOCKED_R = pose(NOCKED, twist=54)
RAPID_KEYS = [(0, AIM_READY), (3, NOCKED), (7, DRAWN), (10, DRAWN), (11, LOOSE_S), (12, NOCKED_R), (13, DRAWN), (14, LOOSE_S),
              (15, NOCKED_R), (17, DRAWN), (18, LOOSE), (21, FOLLOW), (24, AIM_READY)]
RAPID_LINEAR = (3, 7, 10, 12, 13, 15, 17)

# ---- 6) 클립 사양 ----
# window: 리타깃 원본에서 쓸 프레임 구간, out: 내보낼 프레임 수(리타이밍), k: 원본 왼팔 흔들림 비율(가슴 기준 델타)
CLIPS = {
    'idle':       dict(source='idle', ground='contact', left=dict(keys=[(0, READY)], k=0.6)),
    'run':        dict(source='run', ground='stride', left=dict(keys=[(0, RUN)], k=0.55)),
    # 게임 회피 0.32초 × 1.6배속 = 클립 0.51초. 구르기 본동작(원본 6–46f)을 0.5초에 담아 끝까지 보이게 한다.
    # 한 바퀴 구르기는 24fps 12키면 키 사이 회전이 30–40°라 보간 중 몸이 ±12cm 뜨거나 묻힌다(48fps 24키도 ±4.7cm).
    # 96fps 48키로 굽는다(별도 내보내기). 게임은 60Hz×1.6배속으로 임의 시점을 샘플하므로 키 사이 오차가 곧 화면 오차다.
    'dodge':      dict(source='dodge', window=(6, 46), out=48, fps=96, ground='contact', yaw='track', left=dict(keys=[(0, TUCK)], k=0.0)),
    'Dodge_Backward': dict(source='idle', window=(0, 12), out=12, ground='authored', backstep=True, left=dict(keys=[(0, GUARD)], k=0.0)),
    'bow_shoot':  dict(source='idle', window=(0, 24), out=24, ground='contact', shoot=True),
    'bow_shoot_rapid': dict(source='idle', window=(0, 24), out=24, ground='contact', shoot=True, keys=RAPID_KEYS, linear=RAPID_LINEAR),
    # 피격 상태는 0.32초 × 1.6배속 = 0.51초만 보인다. 0.96초 반응 전체를 12프레임에 담아 회복까지 보이게 한다.
    'hit':        dict(source='hit', window=(0, 23), out=12, ground='contact', yaw='start', left=dict(keys=[(0, GUARD)], k=0.5)),
    # 사망: 게임은 사망 1.2초 뒤 몸을 바닥으로 내리고 2.4초에 치운다(actor.js). 원본 3.9초 쓰러짐은 무릎 꿇은 채 가라앉았다 → 1.25초(30f)에 담는다.
    # 쓰러지는 동안은 가로 활(FALL), 누운 뒤(18→24f)에는 실제 마지막 가슴 자세에서 계산한 '가슴 위에 평평히 놓인 활'로 옮긴다.
    'death':      dict(source='death', window=(0, 93), out=30, ground='contact', yaw='start', left=dict(keys=[(0, FALL)], k=0.0, settle=(18, 24))),
    'cheer':      dict(source='cheer', ground='contact', left=dict(keys=[(0, READY)], k=0.5)),
    'interact':   dict(source='interact', ground='contact', left=dict(keys=[(0, READY)], k=0.3)),
    'cast_shoot': dict(source='cast_shoot', ground='contact', left=dict(keys=[(0, READY)], k=0.3)),
}

def fcurves_of(act, bone, path, n):
    return [act.fcurves.find(f'pose.bones["{P + bone}"].{path}', index=i) for i in range(n)]

def prepare_source(clip, spec):
    src = SOURCE_ACTIONS[spec['source']]
    act = src.copy(); act.name = '_src_' + clip
    if spec.get('window'):
        a0, a1 = spec['window']; out = spec.get('out', a1 - a0); k = out / (a1 - a0)
        for fc in act.fcurves:
            pts = [(kp.co[0], kp.co[1]) for kp in fc.keyframe_points]
            vals = {}
            for f in range(out + 1):
                x = a0 + f / k
                vals[f] = fc.evaluate(x)
            fc.keyframe_points.clear()
            for f, v in vals.items():
                kp = fc.keyframe_points.insert(f, v); kp.interpolation = 'LINEAR'
            fc.update()
    return act

def frame_range(act, spec):
    if spec.get('window'): return 0, spec.get('out', spec['window'][1] - spec['window'][0])
    return int(act.frame_range[0]), int(act.frame_range[1])

def renorm_quats(act):
    for b in arm.data.bones:
        fq = [act.fcurves.find(f'pose.bones["{b.name}"].rotation_quaternion', index=i) for i in range(4)]
        if fq[0] is None: continue
        for k in range(len(fq[0].keyframe_points)):
            q = Quaternion([fq[i].keyframe_points[k].co[1] for i in range(4)]); q.normalize()
            for i in range(4): fq[i].keyframe_points[k].co[1] = q[i]

def lerp_keys(keys, f, field):
    """키 사이 smoothstep 보간(스칼라)."""
    for (f0, a), (f1, b) in zip(keys, keys[1:]):
        if f0 <= f <= f1:
            t = 0 if f1 == f0 else (f - f0) / (f1 - f0); t = t * t * (3 - 2 * t)
            return a[field] * (1 - t) + b[field] * t
    return keys[-1][1][field]

def twist_spine(act, f0, f1, keys):
    """상체를 과녁 쪽으로 비튼다(왼어깨 전방). 척추 3본에 나누고 목·머리는 반대로 돌려 얼굴은 정면을 본다."""
    share = {'Spine': 0.30, 'Spine1': 0.35, 'Spine2': 0.35, 'Neck': -0.45, 'Head': -0.55}
    for bone, w in share.items():
        fq = fcurves_of(act, bone, 'rotation_quaternion', 4)
        for kp_i in range(len(fq[0].keyframe_points)):
            f = fq[0].keyframe_points[kp_i].co[0]
            if f < f0 or f > f1: continue
            ang = math.radians(lerp_keys(keys, f, 'twist')) * w * TWIST_SIGN
            q = Quaternion([fq[i].keyframe_points[kp_i].co[1] for i in range(4)]) @ Quaternion((0, 1, 0), ang)
            for i in range(4): fq[i].keyframe_points[kp_i].co[1] = q[i]
    for fc in act.fcurves: fc.update()

# 비틀기 방향을 실측으로 정한다: 왼어깨(LeftArm 머리)가 앞(-Y)으로 가는 부호.
def _probe_twist(sign):
    for b in pb: b.rotation_quaternion = Quaternion()
    for bone in ('Spine', 'Spine1', 'Spine2'): pb[P + bone].rotation_quaternion = Quaternion((0, 1, 0), math.radians(20) * sign)
    bpy.context.view_layer.update(); return (W @ pb[P + 'LeftArm'].head).y
arm.animation_data.action = None
TWIST_SIGN = 1 if _probe_twist(1) < _probe_twist(-1) else -1
for b in pb: b.rotation_quaternion = Quaternion()

def hips_world_rot(act, f, axis_world, deg):
    rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
    ax = (rest.transposed() @ (Wr.transposed() @ axis_world)).normalized()
    fq = fcurves_of(act, 'Hips', 'rotation_quaternion', 4)
    for kp_i in range(len(fq[0].keyframe_points)):
        if int(round(fq[0].keyframe_points[kp_i].co[0])) != f: continue
        q = Quaternion(ax, math.radians(deg)) @ Quaternion([fq[i].keyframe_points[kp_i].co[1] for i in range(4)])
        for i in range(4): fq[i].keyframe_points[kp_i].co[1] = q[i]

def hips_yaw(f):
    """골반 좌우축의 지면 투영 방위(°). 대기 자세의 골반이 0° 다."""
    rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
    M = (W @ pb[P + 'Hips'].matrix).to_3x3().normalized() @ rest.transposed()
    lat = M @ Vector((1, 0, 0))
    return math.degrees(math.atan2(lat.y, lat.x))

def align_yaw(act, f0, f1, mode):
    """Mixamo 전투 자세 클립은 몸이 45–55° 돌아 시작한다(대기→피격·회피 진입 때 몸 전체가 튄다).
    start: 첫 프레임 방위만큼 클립 전체를 되돌린다. track: 프레임마다 되돌려 구르기 축을 진행 방향에 고정한다."""
    mute_all()
    yaws = evaluate_frames(act, f0, f1, hips_yaw)
    if mode == 'start':
        for f in yaws: hips_world_rot(act, f, Vector((0, 0, 1)), -yaws[f0])
    else:
        # 구르기: 골반 좌우축을 프레임마다 월드 좌우축(X)으로 돌린다. 어깨 넘기(옆 기울기 ±30°)와 방위 흔들림을 함께 없애
        # 진행 방향으로 곧게 앞구르기 하고, 가로로 쥔 활이 회전 내내 수평을 유지한다.
        rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
        def lat_of(f):
            M = (W @ pb[P + 'Hips'].matrix).to_3x3().normalized() @ rest.transposed(); return (M @ Vector((1, 0, 0))).normalized()
        lats = evaluate_frames(act, f0, f1, lat_of)
        raw = {f: l.rotation_difference(Vector((1, 0, 0))) for f, l in lats.items()}
        for f in raw:
            q = Quaternion((0, 0, 0, 0))
            for g, w in ((max(f0, f - 1), .25), (f, .5), (min(f1, f + 1), .25)):
                r = raw[g] if raw[g].dot(raw[f]) >= 0 else -raw[g]
                q = Quaternion([q[i] + w * r[i] for i in range(4)])
            q.normalize()
            ax, ang = q.to_axis_angle()
            hips_world_rot(act, f, ax, math.degrees(ang))
    renorm_quats(act)
    for fc in act.fcurves: fc.update()
    return {'mode': mode, 'before': [round(yaws[f], 1) for f in sorted(yaws)][::max(1, (f1 - f0) // 8)]}

def bone_local_rot(act, bone, f, axis_world, deg):
    rest = arm.data.bones[P + bone].matrix_local.to_3x3().normalized()
    ax = (rest.transposed() @ (Wr.transposed() @ axis_world)).normalized()
    fq = fcurves_of(act, bone, 'rotation_quaternion', 4)
    for kp_i in range(len(fq[0].keyframe_points)):
        if int(round(fq[0].keyframe_points[kp_i].co[0])) != f: continue
        q = Quaternion([fq[i].keyframe_points[kp_i].co[1] for i in range(4)]) @ Quaternion(ax, math.radians(deg))
        for i in range(4): fq[i].keyframe_points[kp_i].co[1] = q[i]

def set_hips_height(act, f0, f1, dz_of):
    rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
    fl = fcurves_of(act, 'Hips', 'location', 3)
    for i in range(3):
        if fl[i] is None: fl[i] = act.fcurves.new(f'pose.bones["{P}Hips"].location', index=i, action_group=P + 'Hips')
    for f in range(f0, f1 + 1):
        loc = rest.transposed() @ Vector((0, 0, dz_of(f) / ARM_SCALE))
        for i in range(3):
            fc = fl[i]
            existing = [kp for kp in fc.keyframe_points if int(round(kp.co[0])) == f]
            if existing: existing[0].co[1] = loc[i]; existing[0].interpolation = 'LINEAR'
            else: kp = fc.keyframe_points.insert(f, loc[i]); kp.interpolation = 'LINEAR'
    for fc in fl: fc.update()

# 백스텝(뒤로 뛰기) 키: (프레임, 골반 높이 m, 골반 앞뒤 기울기°(+앞), 척추 보정°, 발 들림 m, 무릎 앞 극)
# 웅크림(0–1f) → 밀어내며 뒤로 젖힘(2–3f) → 체공·무릎 당김(3–6f) → 착지 흡수(8–9f) → 대기 자세 복귀(12f)
BACKSTEP = [(0, -0.03, 5, -2, 0.00), (1, -0.08, 9, -4, 0.00), (2, 0.03, -12, 5, 0.03), (3, 0.12, -18, 7, 0.10), (4, 0.15, -17, 7, 0.14),
            (5, 0.14, -14, 6, 0.14), (6, 0.10, -10, 4, 0.10), (7, 0.04, -5, 2, 0.05), (8, -0.09, 8, -4, 0.00), (9, -0.10, 10, -4, 0.00),
            (10, -0.06, 6, -3, 0.00), (11, -0.02, 2, -1, 0.00), (12, 0.0, 0, 0, 0.00)]

def evaluate_frames(act, f0, f1, fn):
    arm.animation_data.action = act
    out = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(f); bpy.context.view_layer.update(); out[f] = fn(f)
    return out

def mesh_min_z():
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
    n = len(me.vertices); co = np.empty(n * 3, dtype=np.float64); me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    M = np.array(body.matrix_world); co = co.reshape(n, 3)
    z = co @ M[2, :3] + M[2, 3]
    return float(z.min())

def chest_local_left_wrist(f):
    cm = chest.matrix_world
    return cm.inverted() @ (W @ pb[P + 'LeftHand'].head)

report = {'blender': bpy.app.version_string, 'source': os.path.basename(SOURCE), 'reference': os.path.basename(REFERENCE),
          'axisRollDeg': {n[len(P):]: round(math.degrees(q.angle), 1) for n, q in AXIS.items() if not any(s in n for s in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'))},
          'twistSign': TWIST_SIGN, 'legPole': {s: v[1] for s, v in LEG_POLE.items()}, 'clips': {}}

def key_left_chest(f, p, delta=Vector()):
    E = bow_axes(p['limb'], p['shot'])
    Rl = left_hand_from_bow(E)
    wl = p['grip'] - (-E.col[0]) * GRIP_ALONG - E.col[2] * GRIP_PALM
    e = T['wrist_L']; e.location = wl - C + delta; e.keyframe_insert('location', frame=f)
    e.rotation_quaternion = Rl.to_quaternion(); e.keyframe_insert('rotation_quaternion', frame=f)
    e = T['pole_L']; e.location = p['poleL'] - C; e.keyframe_insert('location', frame=f)
    return wl

def key_shot(f, p):
    E = bow_axes(p['limb'], p['shot'])
    Rl = left_hand_from_bow(E)
    wl = p['grip'] - (-E.col[0]) * GRIP_ALONG - E.col[2] * GRIP_PALM
    fr, prm = Vector(p['finger']).normalized(), Vector(p['palm'])
    Rr = right_hand(fr, prm); pr_o = (prm - fr * prm.dot(fr)).normalized()
    wr = p['pinch'] - fr * NOCK_ALONG - pr_o * NOCK_PALM
    for name, loc, rot in (('wrist_L', wl, Rl), ('wrist_R', wr, Rr), ('pole_L', p['poleL'], None), ('pole_R', p['poleR'], None)):
        e = TW[name]; e.location = loc; e.keyframe_insert('location', frame=f)
        if rot is not None: e.rotation_quaternion = rot.to_quaternion(); e.keyframe_insert('rotation_quaternion', frame=f)
    return {'E': E, 'grip': p['grip'], 'pinch': p['pinch'], 'wl': wl, 'wr': wr}

def finger_pose(side, curl, thumb):
    out = {}
    palm = HAND[side]['palm_w']
    for b in arm.data.bones:
        n = b.name
        if not n.startswith(P + side + 'Hand') or n == P + side + 'Hand' or n.endswith('4'): continue
        head, R = bone_world_rest(n[len(P):])
        d = (R @ Vector((0, 1, 0))).normalized()
        axis = d.cross(palm)
        if axis.length < 1e-4: continue
        ang = thumb if 'Thumb' in n else curl * (1.15 if 'Pinky' in n else 1)
        out[n] = Quaternion((R.transposed() @ axis).normalized(), math.radians(ang))
    return out
GRIP_FINGERS = finger_pose('Left', 62, 28)
DRAW_FINGERS = finger_pose('Right', 48, 18)

def clear_targets():
    for e in list(T.values()) + list(TW.values()): e.animation_data_clear()

baked = {}
for clip, spec in CLIPS.items():
    act = prepare_source(clip, spec)
    f0, f1 = frame_range(act, spec)
    clear_targets(); mute_all()
    targets = {}
    yaw_info = align_yaw(act, f0, f1, spec['yaw']) if spec.get('yaw') else None
    if spec.get('shoot'):
        keys = spec.get('keys', SHOT_KEYS); linear = spec.get('linear', (3, 7, 10))
        twist_spine(act, f0, f1, keys)
        renorm_quats(act)
        for f, p in keys: targets[f] = key_shot(f, p)
        for e in TW.values():
            if e.animation_data and e.animation_data.action:
                for fc in e.animation_data.action.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = 'LINEAR' if int(round(kp.co[0])) in linear else 'BEZIER'
        set_arm('L', 'world'); set_arm('R', 'world')
    if spec.get('backstep'):
        for f, hz, pitch, spine, lift in BACKSTEP:
            hips_world_rot(act, f, Vector((1, 0, 0)), pitch)
            bone_local_rot(act, 'Spine1', f, Vector((1, 0, 0)), spine)
        renorm_quats(act)
        # 다리 IK: rest 발목 위치 + 들림, 무릎 극은 앞쪽
        for side in ('Left', 'Right'):
            foot, _ = bone_world_rest(side + 'Foot'); knee, _ = bone_world_rest(side + 'Leg')
            for f, hz, pitch, spine, lift in BACKSTEP:
                a = TW['ankle_' + side[0]]; a.location = foot + Vector((0, 0.02 if side == 'Left' else -0.02, lift)); a.keyframe_insert('location', frame=f)
                k = TW['knee_' + side[0]]; k.location = knee + Vector((0, -0.6, 0)); k.keyframe_insert('location', frame=f)
        set_hips_height(act, f0, f1, lambda f: BACKSTEP[min(f, len(BACKSTEP) - 1)][1])
        set_legs(True)
    if spec.get('left'):
        # 원본(리타깃) 왼손의 가슴 기준 움직임을 비율 k 로 활 팔 목표에 더한다.
        k = spec['left']['k']; base = spec['left']['keys'][0][1]
        deltas = {}
        if k > 0:
            mute_all()
            if spec.get('backstep'): set_legs(True)
            loc = evaluate_frames(act, f0, f1, chest_local_left_wrist)
            mean = sum(loc.values(), Vector()) / len(loc)
            deltas = {f: (v - mean) * k for f, v in loc.items()}
        step = 1 if k > 0 else max(1, f1 - f0)
        settle = spec['left'].get('settle')
        if settle:
            s0, s1 = settle
            mute_all()
            chest_rot = evaluate_frames(act, f1, f1, lambda f: chest.matrix_world.to_3x3().normalized())[f1]
            lat_w = chest_rot @ Vector(base['limb']); lat_w.z = 0; lat_w.normalize()
            flat = pose(base, limb=tuple(chest_rot.transposed() @ lat_w), shot=tuple(chest_rot.transposed() @ Vector((0, 0, 1))))
            key_left_chest(f0, base); key_left_chest(s0, base); key_left_chest(s1, flat); key_left_chest(f1, flat)
        else:
            for f in range(f0, f1 + 1, step): key_left_chest(f, base, deltas.get(f, Vector()))
            if f1 not in range(f0, f1 + 1, step): key_left_chest(f1, base, deltas.get(f1, Vector()))
        set_arm('L', 'chest')
    arm.animation_data.action = act
    scene.frame_start, scene.frame_end = f0, f1
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=1, only_selected=False, visual_keying=True, clear_constraints=False,
                     clear_parents=False, use_current_action=False, clean_curves=False, bake_types={'POSE'})
    out = arm.animation_data.action; out.name = clip
    # 시각 키 굽기가 본 배율에 1e-3 수준 잡음을 남긴다(갑옷 단계 소켓 각도 0.08° 오차). 이 리그는 배율 애니메이션이 없으므로 정확히 1 로 둔다.
    for fc in out.fcurves:
        if fc.data_path.endswith('.scale'):
            for kp in fc.keyframe_points: kp.co[1] = 1.0
            fc.update()
    # 손가락 고정 자세(활 쥠·시위 당김)
    fingers = dict(GRIP_FINGERS)
    if spec.get('shoot'): fingers.update(DRAW_FINGERS)
    for n, q in fingers.items():
        for i in range(4):
            fc = out.fcurves.find(f'pose.bones["{n}"].rotation_quaternion', index=i)
            if fc is None: fc = out.fcurves.new(f'pose.bones["{n}"].rotation_quaternion', index=i, action_group=n)
            fc.keyframe_points.clear(); fc.keyframe_points.insert(f0, q[i]); fc.keyframe_points.insert(f1, q[i])
    # 측정: 제약이 살아 있는 굽기 직후(목표 오차)
    errs = []
    for f, tgt in targets.items():
        scene.frame_set(f); bpy.context.view_layer.update()
        wl = W @ pb[P + 'LeftHand'].head; wr = W @ pb[P + 'RightHand'].head
        gw = grip.matrix_world
        want_E = tgt['E']; got_E = gw.to_3x3().normalized()
        ang = math.degrees(want_E.to_quaternion().rotation_difference(got_E.to_quaternion()).angle)
        errs.append({'frame': f, 'wristL_err': round((wl - tgt['wl']).length, 4), 'wristR_err': round((wr - tgt['wr']).length, 4), 'bowAxisErrDeg': round(ang, 2)})
    # 접지: 제약을 끄고 구운 동작 그대로 실제 스킨 최저점을 잰다
    mute_all()
    arm.animation_data.action = out
    mins = evaluate_frames(out, f0, f1, lambda f: mesh_min_z())
    mode = spec['ground']
    if mode == 'contact' and spec.get('window'):
        # 리타이밍한 클립(구르기·피격·사망·사격)은 프레임마다 실제 최저점을 그대로 쓴다(평균하면 빠른 동작에서 순간 부유·관통이 생긴다).
        dz = {f: -mins[f] for f in mins}
    elif mode == 'contact':
        raw = {f: -mins[f] for f in mins}
        dz = {f: 0.25 * raw[max(f0, f - 1)] + 0.5 * raw[f] + 0.25 * raw[min(f1, f + 1)] for f in raw}
    elif mode == 'stride':
        # 지지 중간(0·8·16f) 최저, 공중(4·12f) 최고. 지지 발이 지면에 닿도록 상수만 맞춘다.
        bob = {f: -0.022 * math.cos(2 * math.pi * f / 8) for f in mins}
        c = -min(mins[f] + bob[f] for f in mins)
        dz = {f: bob[f] + c for f in mins}
    else:   # authored: 저작한 높이 위에서 첫 프레임(양발 지지) 접지만 맞춘다
        c = -mins[f0]
        fl = fcurves_of(out, 'Hips', 'location', 3)
        rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
        cur = {f: (W.to_3x3() @ (rest @ Vector([fl[i].evaluate(f) for i in range(3)]))).z for f in mins}
        # 착지 웅크림에서 발끝이 바닥 아래로 내려가는 프레임만 그만큼 올린다(체공 높이는 그대로).
        dz = {f: cur[f] + c + max(0.0, -(mins[f] + c)) for f in mins}
    set_hips_height(out, f0, f1, lambda f: dz[f])
    # 활 끝: 활 로컬 z(림) = 그립 empty 의 -Y 축이다(glTF 축 변환). v1 보고서는 empty Z(활 두께 축)로 재서 실제 끝 높이가 아니었다.
    after = evaluate_frames(out, f0, f1, lambda f: (mesh_min_z(), (grip.matrix_world @ Vector((0, -BOW_TIP_LOCAL, 0))).z, (grip.matrix_world @ Vector((0, BOW_TIP_LOCAL, 0))).z))
    report['clips'][clip] = {'frames': [f0, f1], 'fps': spec.get('fps', FPS), 'seconds': round((f1 - f0) / spec.get('fps', FPS), 4), 'keys': errs,
        'yawAlign': yaw_info,
        'hipsDzRange': [round(min(dz.values()), 3), round(max(dz.values()), 3)],
        'skinMinZ': [round(min(v[0] for v in after.values()), 3), round(max(v[0] for v in after.values()), 3)],
        'bowTipMinZ': round(min(min(v[1], v[2]) for v in after.values()), 3)}
    baked[clip] = out
    clear_targets()

# ---- 7) 내보내기: 제약·목표를 지우고 구운 액션만 남긴다 ----
for b in pb:
    for c in list(b.constraints): b.constraints.remove(c)
for e in list(T.values()) + list(TW.values()) + [chest]: bpy.data.objects.remove(e, do_unlink=True)
for a in list(bpy.data.actions):
    if a.name not in baked: bpy.data.actions.remove(a)
for a in baked.values(): a.use_fake_user = True
arm.animation_data.action = baked['idle']
report['grip'] = {'name': grip.name, 'parent': grip.parent_bone, 'matrix_parent_space': [list(r) for r in grip.matrix_local]}
report['nock'] = {'name': nock.name, 'parent': nock.parent_bone}

if BOW_OBJ:
    bpy.ops.wm.obj_import(filepath=BOW_OBJ, forward_axis='Y', up_axis='Z')
    prev = bpy.context.selected_objects[0]; prev.name = 'Preview_RuntimeBow (not exported)'
    prev.parent = grip; prev.matrix_parent_inverse = Matrix.Identity(4)
    prev.matrix_basis = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_4x4()

BLEND = os.path.join(OUT, 'ranger-library-v2.blend')
bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
with open(os.path.join(OUT, 'ranger-library-author-report-v2.json'), 'w') as fp: json.dump(report, fp, indent=1, ensure_ascii=False)

def export(path, keep, fps):
    """keep 에 든 클립만 남겨 fps 로 내보낸다(.blend 를 다시 열어 쓰므로 원본 저작 상태는 그대로)."""
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    s = bpy.context.scene; s.render.fps = fps; s.render.fps_base = 1
    a = next(o for o in s.objects if o.type == 'ARMATURE')
    for act in list(bpy.data.actions):
        if act.name not in keep: bpy.data.actions.remove(act)
    a.animation_data.action = bpy.data.actions[sorted(keep)[0]]
    bpy.ops.object.select_all(action='DESELECT')
    for o in (a, s.objects['RangerBowGrip_L'], s.objects['RangerDrawNock_R']): o.select_set(True)
    bpy.context.view_layer.objects.active = a
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_anim_slide_to_zero=False,
        export_skins=False, export_morph=False, export_def_bones=False, export_apply=False, export_cameras=False, export_lights=False,
        export_optimize_animation_size=True, export_reset_pose_bones=True)
fine = {c for c, s in CLIPS.items() if s.get('fps')}
export(os.path.join(OUT, 'ranger-library-anim-v2.glb'), set(CLIPS) - fine, FPS)
for rate in sorted({CLIPS[c]['fps'] for c in fine}):
    export(os.path.join(OUT, f'ranger-library-anim-v2-{rate}fps.glb'), {c for c in fine if CLIPS[c]['fps'] == rate}, rate)
print('REPORT ' + json.dumps({k: {'skinMinZ': v['skinMinZ'], 'bowTipMinZ': v['bowTipMinZ'], 'hipsDz': v['hipsDzRange'],
      'err': [max([e['wristL_err'] for e in v['keys']] or [0]), max([e['wristR_err'] for e in v['keys']] or [0]), max([e['bowAxisErrDeg'] for e in v['keys']] or [0])]} for k, v in report['clips'].items()}))
