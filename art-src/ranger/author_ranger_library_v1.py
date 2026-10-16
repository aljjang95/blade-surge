"""궁수 라이브러리 몸체(hero_ranger_t1) 팔·활 교정 — Blender 4.3 배경 실행.

원인: tools/asset-library/blender_merge_mixamo.py 가 Mixamo FBX 액션을 리타깃 없이 복사했다.
Blender 포즈 회전은 본 rest 기준 상대값이라 rest 축이 다른 Tripo 팔 사슬(특히 왼팔)에서 팔이 머리 위로 솟고,
그 손에 붙은 활이 클립마다 따로 튀었다. 이 스크립트는 몸통·다리는 원본 클립을 유지하고 양팔을 가슴 기준 IK
목표로 다시 저작한 뒤 시각 키로 굽는다. 활은 왼손 본에 고정된 그립 소켓(RangerBowGrip_L)으로 한 번만 정의하고,
손 회전은 '활의 자세 → 고정 그립의 역'으로 유도하므로 클립이 바뀌어도 손-활 상대 좌표가 같다.

실행: blender -b --factory-startup --python art-src/ranger/author_ranger_library_v1.py -- <원본.glb> <출력폴더>
출력: ranger-library-anim-v1.glb(뼈대·클립·소켓만), ranger-library-v1.blend, ranger-library-author-report.json
원본 GLB 는 읽기만 하며 메시·스킨 바이트는 tools/art/pack-ranger-library.mjs 가 원본 그대로 보존한다.
"""
import bpy, json, math, os, sys
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SOURCE, OUT = argv[0], argv[1]
BOW_OBJ = argv[2] if len(argv) > 2 else None   # 미리보기 전용 런타임 활 형상(OBJ, 내보내지 않음)
os.makedirs(OUT, exist_ok=True)
FPS = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SOURCE)
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
W = arm.matrix_world.copy()
P = 'mixamorig:'
SOURCE_ACTIONS = {a.name.replace('_Armature', ''): a for a in bpy.data.actions}

def bone_world_rest(name):
    m = W @ arm.data.bones[P + name].matrix_local
    return m.to_translation(), m.to_3x3().normalized()

# ---- 1) IK 가 쓰는 팔 본 길이만 자식 머리까지로 맞춘다. 머리·Y축·롤(=내보내는 rest 행렬)은 그대로다. ----
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
for side in ('Left', 'Right'):
    for bone, child in (('Arm', 'ForeArm'), ('ForeArm', 'Hand'), ('Hand', 'HandMiddle1')):
        b, c = eb[P + side + bone], eb[P + side + child]
        roll = b.roll
        b.tail = b.head + (b.tail - b.head).normalized() * (c.head - b.head).length
        b.roll = roll
bpy.ops.object.mode_set(mode='OBJECT')

# ---- 2) 손 의미 축(손가락·손바닥)을 rest 에서 측정한다. T포즈 손바닥은 아래(-Z)를 향한다. ----
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
GRIP_ALONG, GRIP_PALM = 0.08, 0.03      # 손목 → 손바닥 중심 (m)
NOCK_ALONG, NOCK_PALM = 0.12, 0.03      # 손목 → 시위 거는 손가락 마디 (m)
BOW_WORLD_SCALE = 0.7619                # 런타임 Bow 월드 배율(소켓 58.79 × 0.72 × 0.018)
BOW_NOCK_LOCAL = Vector((0.177, 0, 0))  # forge-bow-v2 적합 형상의 시위 중앙(활 로컬, +x=사수 쪽)

def bow_axes(limb, shot):
    """활 미리보기/그립 empty 축: 활 로컬 z(림)=empty -Y, 활 로컬 -x(표적)=empty -X, 활 로컬 y=empty +Z."""
    limb = Vector(limb).normalized(); shot = Vector(shot); shot = (shot - limb * shot.dot(limb)).normalized()
    X = -shot; Y = -limb; Z = X.cross(Y)
    return Matrix((X, Y, Z)).transposed()

def left_hand_from_bow(E):
    # 왼손: 손가락 = 표적 방향(-X_e), 손바닥 = 활 로컬 y(+Z_e). 같은 대응을 모든 자세에 쓰므로 그립이 고정된다.
    return frame(-E.col[0], E.col[2]) @ HAND['Left']['L'].transposed()

def right_hand(finger, palm):
    return frame(Vector(finger), Vector(palm)) @ HAND['Right']['L'].transposed()

# ---- 3) 고정 그립·노크 소켓을 rest 에서 손 본에 붙인다. ----
arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
def bone_empty(name, bone, matrix_world, size=0.05):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e)
    e.empty_display_size = size; e.parent = arm; e.parent_type = 'BONE'; e.parent_bone = P + bone
    bpy.context.view_layer.update(); e.matrix_world = matrix_world; bpy.context.view_layer.update()
    return e
hl = HAND['Left']
# rest 손 회전 hl['R'] 에서 같은 대응으로 활 축을 만든다: E = R_hand · L · Pᵀ
Pm = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0))).transposed()
E_rest = hl['R'] @ hl['L'] @ Pm.transposed()
grip_pos = hl['head'] + hl['finger_w'] * GRIP_ALONG + hl['palm_w'] * GRIP_PALM
grip = bone_empty('RangerBowGrip_L', 'LeftHand', Matrix.Translation(grip_pos) @ E_rest.to_4x4() @ Matrix.Diagonal((BOW_WORLD_SCALE,) * 3 + (1,)))
hr = HAND['Right']
nock = bone_empty('RangerDrawNock_R', 'RightHand', Matrix.Translation(hr['head'] + hr['finger_w'] * NOCK_ALONG + hr['palm_w'] * NOCK_PALM), 0.03)
# 검증: rest 손 회전에서 만든 활 축으로 다시 손 회전을 유도하면 rest 손 회전과 같아야 한다(고정 그립 대응의 자기 일관성).
assert hl['R'].to_quaternion().rotation_difference(left_hand_from_bow(E_rest).to_quaternion()).angle < 1e-4

# ---- 4) 가슴 기준 목표 empty 와 제약 ----
chest_head, _ = bone_world_rest('Spine2')
chest = bone_empty('Ranger_ChestFrame', 'Spine2', Matrix.Translation(chest_head), 0.1)
def child_empty(name):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e); e.parent = chest
    e.matrix_parent_inverse = Matrix.Identity(4); e.rotation_mode = 'QUATERNION'; return e
T = {k: child_empty(k) for k in ('wrist_L', 'wrist_R', 'pole_L', 'pole_R')}
arm.data.pose_position = 'POSE'
pb = arm.pose.bones
for side in ('Left', 'Right'):
    s = side[0]
    pb[P + side + 'Shoulder'].lock_ik_x = pb[P + side + 'Shoulder'].lock_ik_y = pb[P + side + 'Shoulder'].lock_ik_z = True
    lim = pb[P + side + 'Shoulder'].constraints.new('LIMIT_ROTATION'); lim.owner_space = 'LOCAL'
    lim.use_limit_x = lim.use_limit_y = lim.use_limit_z = True
    ik = pb[P + side + 'ForeArm'].constraints.new('IK'); ik.name = 'Ranger arm IK'
    ik.target = T['wrist_' + s]; ik.pole_target = T['pole_' + s]; ik.chain_count = 2; ik.iterations = 200
    cr = pb[P + side + 'Hand'].constraints.new('COPY_ROTATION'); cr.target = T['wrist_' + s]; cr.target_space = cr.owner_space = 'WORLD'

# ---- 5) 클립별 자세 (월드 정렬 가슴 좌표, m; 앞=-Y, 왼쪽=+X, 위=+Z, 원점=Spine2 rest) ----
C = chest_head
def at(x, y, z): return Vector((x, y, z))
DRAW_GRIP = at(0.07, -0.58, 1.17)
DRAW_LIMB, DRAW_SHOT = (-0.17, 0, 0.98), (0, -1, 0)
REST_NOCK = DRAW_GRIP + Vector((0, 1, 0)) * (BOW_NOCK_LOCAL.x * BOW_WORLD_SCALE)
ANCHOR = DRAW_GRIP + Vector((0, 1, 0)) * 0.42
READY = dict(grip=at(0.27, -0.16, 0.86), limb=(0.12, -0.8, 0.62), shot=(0, -0.6, -0.8),
             pinch=at(-0.27, -0.12, 0.86), finger=(0.05, -0.25, -1), palm=(1, 0, 0), poleL=at(0.7, 0.5, 0.8), poleR=at(-0.7, 0.5, 0.8))
def pose(base=READY, **kw): d = dict(base); d.update(kw); return d
AIM = pose(grip=DRAW_GRIP, limb=DRAW_LIMB, shot=DRAW_SHOT, poleL=at(0.8, 0.0, 0.55), poleR=at(-0.75, 0.55, 1.45))
NOCKED = pose(AIM, pinch=REST_NOCK, finger=(0, -1, 0), palm=(1, 0, 0))
DRAWN = pose(AIM, pinch=ANCHOR, finger=(0, -1, 0), palm=(1, 0, 0))
LOOSE = pose(AIM, pinch=ANCHOR + Vector((-0.22, 0.12, 0.08)), finger=(-0.4, -0.6, 0.3), palm=(0.6, 0, 0.4), poleR=at(-0.8, 0.4, 1.3))
FOLLOW = pose(AIM, pinch=at(-0.24, -0.05, 1.02), finger=(0.1, -0.4, -1), palm=(1, 0, 0), poleR=at(-0.7, 0.5, 0.9))
TUCK = pose(grip=at(0.12, -0.32, 1.02), limb=(0.0, -0.15, 1.0), shot=(0, -1, 0), pinch=at(-0.12, -0.28, 0.98), finger=(0.3, -0.5, -0.6), palm=(1, 0, 0),
            poleL=at(0.7, 0.2, 0.7), poleR=at(-0.7, 0.2, 0.7))
def swing(base, d): return pose(base, grip=base['grip'] + Vector((0, d, 0.02 * abs(d) / 0.07)), pinch=base['pinch'] + Vector((0, -1.6 * d, 0.03)))
RUN = pose(grip=at(0.27, -0.14, 0.74), limb=(0.08, -0.9, 0.45), shot=(0, -0.45, -0.9), pinch=at(-0.26, -0.10, 0.78), finger=(0.05, -0.4, -1))
GUARD = pose(READY, grip=at(0.2, -0.36, 1.0), limb=(0.05, -0.5, 0.86), shot=(0, -0.86, -0.5), pinch=at(-0.2, -0.3, 0.98), finger=(0.2, -0.5, -0.6))
CHEER = pose(READY, pinch=at(-0.24, -0.14, 1.56), finger=(0, 0, 1), palm=(0, -1, 0), poleR=at(-0.8, 0.3, 1.2))
REACH = pose(READY, pinch=at(-0.1, -0.5, 1.02), finger=(0, -1, -0.2), palm=(0.3, 0, -1), poleR=at(-0.7, 0.3, 0.8))

def keys_for(seq):
    return [(int(round(f)), p) for f, p in seq]
CLIPS = {
    'idle':      dict(source='idle', frames=None, keys=[(0, READY), (119, pose(READY, grip=READY['grip'] + Vector((0, 0, 0.012)), pinch=READY['pinch'] + Vector((0, 0, 0.012)))), (238, READY)]),
    'run':       dict(source='run', frames=None, keys=[(0, swing(RUN, 0.07)), (4, RUN), (8, swing(RUN, -0.07)), (12, RUN), (16, swing(RUN, 0.07))]),
    # 게임 회피는 0.32초 × 1.6배속 = 클립 0.51초만 보인다. 원본 2.33초 구르기를 12프레임(0.5초)에 담는다.
    'dodge':     dict(source='dodge', retime=12, frames=(0, 12), keys=[(0, TUCK), (12, TUCK)]),
    'Dodge_Backward': dict(source='dodge', retime=12, reverse=True, frames=(0, 12), keys=[(0, TUCK), (12, TUCK)]),
    # 1초 클립. combat-motion attackPhase 의 접촉 위상 0.42 = 10.08프레임에서 발사한다.
    'bow_shoot': dict(source='idle', frames=(0, 24), keys=[(0, READY), (3, NOCKED), (7, DRAWN), (10, DRAWN), (11, LOOSE), (14, pose(LOOSE, pinch=LOOSE['pinch'] + Vector((-0.03, 0.04, -0.06)))), (18, FOLLOW), (24, READY)]),
    'hit':       dict(source='hit', frames=None, keys=[(0, GUARD), (6, pose(GUARD, grip=GUARD['grip'] + Vector((0.03, 0.06, 0.03)))), (23, GUARD)]),
    'death':     dict(source='death', frames=None, keys=[(0, GUARD), (93, GUARD)]),
    'cheer':     dict(source='cheer', frames=None, keys=[(0, READY), (24, CHEER), (180, CHEER), (204, READY)]),
    'interact':  dict(source='interact', frames=None, keys=[(0, READY), (20, REACH), (60, REACH), (82, READY)]),
    'cast_shoot': dict(source='cast_shoot', frames=None, keys=[(0, READY), (55, READY)]),
}

def key_targets(frame_no, p):
    E = bow_axes(p['limb'], p['shot'])
    Rl = left_hand_from_bow(E)
    wl = p['grip'] - (-E.col[0]) * GRIP_ALONG - E.col[2] * GRIP_PALM
    fr, pr = Vector(p['finger']).normalized(), Vector(p['palm'])
    Rr = right_hand(fr, pr)
    pr_o = (pr - fr * pr.dot(fr)).normalized()
    wr = p['pinch'] - fr * NOCK_ALONG - pr_o * NOCK_PALM
    for name, loc, rot in (('wrist_L', wl, Rl), ('wrist_R', wr, Rr), ('pole_L', p['poleL'], None), ('pole_R', p['poleR'], None)):
        e = T[name]; e.location = loc - C; e.keyframe_insert('location', frame=frame_no)
        if rot is not None: e.rotation_quaternion = rot.to_quaternion(); e.keyframe_insert('rotation_quaternion', frame=frame_no)
    return {'wristL': wl, 'wristR': wr, 'grip': p['grip'], 'pinch': p['pinch'], 'E': E}

def prepare_source(spec):
    src = SOURCE_ACTIONS[spec['source']]
    act = src.copy(); act.name = '_src_' + spec['source']
    if spec.get('retime'):
        a0, a1 = src.frame_range; k = spec['retime'] / (a1 - a0)
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                for attr in ('co', 'handle_left', 'handle_right'):
                    v = getattr(kp, attr); x = (v.x - a0) * k
                    v.x = spec['retime'] - x if spec.get('reverse') else x
            fc.update()
    return act

# 손가락: 원본 손가락 회전도 어긋나 있으므로 고정 쥠 자세로 덮는다.
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
RELAX_FINGERS = finger_pose('Right', 22, 8)

report = {'blender': bpy.app.version_string, 'source': os.path.basename(SOURCE), 'clips': {}}
baked = {}
for clip, spec in CLIPS.items():
    act = prepare_source(spec)
    arm.animation_data.action = act
    for e in T.values():
        e.animation_data_clear()
    targets = {f: key_targets(f, p) for f, p in spec['keys']}
    for e in T.values():
        if e.animation_data and e.animation_data.action:
            for fc in e.animation_data.action.fcurves:
                for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'; kp.easing = 'AUTO'
            if clip == 'bow_shoot':   # 발사 순간(10→11)은 끊어 친다
                for fc in e.animation_data.action.fcurves:
                    for kp in fc.keyframe_points:
                        if int(kp.co.x) in (7, 10): kp.interpolation = 'LINEAR'
    f0, f1 = spec['frames'] or (int(act.frame_range[0]), int(act.frame_range[1]))
    scene.frame_start, scene.frame_end = f0, f1
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=1, only_selected=False, visual_keying=True, clear_constraints=False,
                     clear_parents=False, use_current_action=False, clean_curves=False, bake_types={'POSE'})
    out = arm.animation_data.action; out.name = clip
    # 손가락 고정 자세
    fingers = dict(GRIP_FINGERS); fingers.update(DRAW_FINGERS if clip == 'bow_shoot' else RELAX_FINGERS)
    for n, q in fingers.items():
        for i in range(4):
            fc = out.fcurves.find(f'pose.bones["{n}"].rotation_quaternion', index=i)
            if fc is None: fc = out.fcurves.new(f'pose.bones["{n}"].rotation_quaternion', index=i, action_group=n)
            fc.keyframe_points.clear(); fc.keyframe_points.insert(f0, q[i]); fc.keyframe_points.insert(f1, q[i])
    # 측정(제약이 살아 있는 굽기 직후 평가): 손목 목표 오차·활 축 오차. 제약을 지운 뒤의 실제 런타임 값은 test/ranger-library-model.test.ts 가 잰다.
    errs = []
    for f, tgt in targets.items():
        scene.frame_set(f); bpy.context.view_layer.update()
        wl = W @ pb[P + 'LeftHand'].head; wr = W @ pb[P + 'RightHand'].head
        # 굽힌 위치는 가슴 기준 목표이므로 현재 가슴 변환으로 비교한다
        chest_now = chest.matrix_world.to_translation(); chest_rot = chest.matrix_world.to_3x3().normalized()
        want_l = chest_now + chest_rot @ (tgt['wristL'] - C); want_r = chest_now + chest_rot @ (tgt['wristR'] - C)
        gw = grip.matrix_world; nk = nock.matrix_world.to_translation()
        bow_nock = gw @ BOW_NOCK_LOCAL
        tips = [gw @ Vector((0, 0, z)) for z in (-1.1386, 1.1386)]
        want_E = chest_rot @ tgt['E']; got_E = gw.to_3x3().normalized()
        ang = math.degrees((want_E.to_quaternion().rotation_difference(got_E.to_quaternion())).angle)
        errs.append({'frame': f, 'wristL_err': round((wl - want_l).length, 4), 'wristR_err': round((wr - want_r).length, 4), 'bowAxisErrDeg': round(ang, 2),
                     'pinchToRestNock': round((nk - bow_nock).length, 4), 'minTipZ': round(min(t.z for t in tips), 3), 'gripZ': round(gw.to_translation().z, 3)})
    report['clips'][clip] = {'frames': [f0, f1], 'seconds': round((f1 - f0) / FPS, 4), 'keys': errs}
    baked[clip] = out
    for e in T.values(): e.animation_data_clear()

# ---- 6) 내보내기: 제약·목표를 지우고 굽힌 액션만 남긴다 ----
for side in ('Left', 'Right'):
    for b in ('Shoulder', 'ForeArm', 'Hand'):
        for c in list(pb[P + side + b].constraints): pb[P + side + b].constraints.remove(c)
for e in list(T.values()) + [chest]: bpy.data.objects.remove(e, do_unlink=True)
for a in list(bpy.data.actions):
    if a.name not in baked: bpy.data.actions.remove(a)
for a in baked.values(): a.use_fake_user = True
arm.animation_data.action = baked['idle']
report['grip'] = {'name': grip.name, 'parent': grip.parent_bone, 'matrix_parent_space': [list(r) for r in grip.matrix_local]}
report['nock'] = {'name': nock.name, 'parent': nock.parent_bone}

if BOW_OBJ:   # .blend 미리보기용 활(내보내기 제외)
    # OBJ 좌표는 런타임(glTF) 활 로컬 그대로다. glTF→Blender 축 변환 (x,y,z)→(x,-z,y) 을 기본 변환으로 둔다.
    bpy.ops.wm.obj_import(filepath=BOW_OBJ, forward_axis='Y', up_axis='Z')
    prev = bpy.context.selected_objects[0]; prev.name = 'Preview_RuntimeBow (not exported)'
    prev.parent = grip; prev.matrix_parent_inverse = Matrix.Identity(4)
    prev.matrix_basis = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_4x4()

bpy.ops.object.select_all(action='DESELECT')
for o in (arm, grip, nock): o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'ranger-library-anim-v1.glb'), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_anim_slide_to_zero=False,
    export_skins=False, export_morph=False, export_def_bones=False, export_apply=False, export_cameras=False, export_lights=False,
    export_optimize_animation_size=True, export_reset_pose_bones=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ranger-library-v1.blend'), compress=True)
with open(os.path.join(OUT, 'ranger-library-author-report.json'), 'w') as fp: json.dump(report, fp, indent=1, ensure_ascii=False)
print('REPORT ' + json.dumps({k: [max(e['wristL_err'] for e in v['keys']), max(e['wristR_err'] for e in v['keys']), max(e['bowAxisErrDeg'] for e in v['keys'])] for k, v in report['clips'].items()}))






