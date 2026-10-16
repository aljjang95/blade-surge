"""Tripo 리그 영웅(도적 등) 전신 rest 축 리타깃 v1 — Blender 4.3 배경 실행. 궁수 v2(art-src/ranger/author_ranger_library_v2.py)와 같은 방식이며 활·팔 IK 는 없다.

원인(궁수와 공통, 실측): blender_merge_mixamo.py 가 Mixamo 쿼터니언을 롤이 다른 Tripo 리그에 그대로 복사해 몸통·다리가 옆으로 꺾이고,
blender_normalize.py 가 Hips 위치 본 로컬 인덱스 0·1 을 평탄화해 수직 골반 이동이 사라졌다.
교정: 기준 리그(knight 1단계)의 본별 X 축으로 '같은 본 방향 + Mixamo 롤' 가상 rest 를 만들고 q' = C·q·C⁻¹ 로 모든 회전 키를 옮긴다.
골반 수직은 실제 스킨 최저점 접지로 다시 풀고(달리기는 보폭 리듬), 전투 자세 클립의 몸 방위(-54°)를 대기와 맞춘다.
회피는 원본 구르기 본동작을 게임에 보이는 0.5초(96fps 48키)로, 피격은 0.5초로 리타이밍한다. 백스텝은 다리 IK 뒤로 뛰기를 새로 저작한다.

실행: blender -b --factory-startup --python art-src/hero-axis/author_hero_axis_v1.py -- <원본.glb> <기준 knight.glb> <출력폴더> <영웅 id>
출력: <id>-library-anim-v1.glb(24fps 클립), <id>-library-anim-v1-96fps.glb(회피), <id>-library-v1.blend, <id>-library-author-report-v1.json
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SOURCE, REFERENCE, OUT, HERO = argv[0], argv[1], argv[2], argv[3]
os.makedirs(OUT, exist_ok=True)
FPS = 24
P = 'mixamorig:'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=REFERENCE)
_ref = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
_rw = _ref.matrix_world.to_3x3().normalized()
REF_X = {b.name: (_rw @ b.matrix_local.to_3x3()).normalized().col[0].copy() for b in _ref.data.bones}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene; scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SOURCE)
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH' and o.find_armature() == arm)
W = arm.matrix_world.copy(); ARM_SCALE = W.to_scale().x; Wr = W.to_3x3().normalized()
SOURCE_ACTIONS = {a.name.replace('_Armature', ''): a for a in bpy.data.actions}
pb = arm.pose.bones

AXIS = {}
for b in arm.data.bones:
    side = 'Left' if 'Left' in b.name else 'Right'
    ref = REF_X.get(b.name) or REF_X.get(P + side + 'HandIndex1')
    R = (Wr @ b.matrix_local.to_3x3()).normalized(); y = R.col[1]; x = ref - y * ref.dot(y)
    if x.length < 1e-3: continue
    x.normalize(); AXIS[b.name] = (R.transposed() @ Matrix((x, y, x.cross(y))).transposed()).to_quaternion()

def retarget_action(act):
    for name, c in AXIS.items():
        fq = [act.fcurves.find(f'pose.bones["{name}"].rotation_quaternion', index=i) for i in range(4)]
        if fq[0] is not None:
            ci = c.inverted()
            for k in range(len(fq[0].keyframe_points)):
                q2 = c @ Quaternion([fq[i].keyframe_points[k].co[1] for i in range(4)]) @ ci
                for i in range(4): kp = fq[i].keyframe_points[k]; kp.co[1] = q2[i]; kp.interpolation = 'LINEAR'
        for path, value in (('location', 0.0), ('scale', 1.0)):
            for i in range(3):
                fc = act.fcurves.find(f'pose.bones["{name}"].{path}', index=i)
                if fc is not None:
                    for kp in fc.keyframe_points: kp.co[1] = value; kp.interpolation = 'LINEAR'
    for fc in act.fcurves: fc.update()
for a in SOURCE_ACTIONS.values(): retarget_action(a)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for side in ('Left', 'Right'):
    for bone, child in (('UpLeg', 'Leg'), ('Leg', 'Foot')):
        b, c = arm.data.edit_bones[P + side + bone], arm.data.edit_bones[P + side + child]
        roll = b.roll; b.tail = b.head + (b.tail - b.head).normalized() * (c.head - b.head).length; b.roll = roll
bpy.ops.object.mode_set(mode='OBJECT')

def bone_world_rest(name):
    m = W @ arm.data.bones[P + name].matrix_local
    return m.to_translation(), m.to_3x3().normalized()
def free_empty(name):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e); return e
TW = {k: free_empty(k) for k in ('ankle_L', 'ankle_R', 'knee_L', 'knee_R')}
LEG = {}
for side in ('Left', 'Right'):
    lik = pb[P + side + 'Leg'].constraints.new('IK'); lik.chain_count = 2; lik.iterations = 200
    lik.target = TW['ankle_' + side[0]]; lik.pole_target = TW['knee_' + side[0]]; LEG[side[0]] = lik
def set_legs(on):
    for c in LEG.values(): c.mute = not on
arm.animation_data.action = None
for b in pb: b.rotation_quaternion = Quaternion(); b.location = Vector(); b.scale = Vector((1, 1, 1))
def calibrate(side):
    lik = LEG[side[0]]; foot, _ = bone_world_rest(side + 'Foot'); knee, _ = bone_world_rest(side + 'Leg')
    TW['ankle_' + side[0]].location = foot; TW['knee_' + side[0]].location = knee + Vector((0, -0.6, 0)); best = None
    for deg in range(-180, 180, 5):
        lik.pole_angle = math.radians(deg); lik.mute = False; bpy.context.view_layer.update()
        dev = ((W @ pb[P + side + 'Leg'].head) - knee).length
        if best is None or dev < best[0]: best = (dev, deg)
    lik.pole_angle = math.radians(best[1]); lik.mute = True; return best[1]
LEG_POLE = {s: calibrate(s) for s in ('Left', 'Right')}

def fcurves_of(act, bone, path, n): return [act.fcurves.find(f'pose.bones["{P + bone}"].{path}', index=i) for i in range(n)]
def renorm_quats(act):
    for b in arm.data.bones:
        fq = [act.fcurves.find(f'pose.bones["{b.name}"].rotation_quaternion', index=i) for i in range(4)]
        if fq[0] is None: continue
        for k in range(len(fq[0].keyframe_points)):
            q = Quaternion([fq[i].keyframe_points[k].co[1] for i in range(4)]); q.normalize()
            for i in range(4): fq[i].keyframe_points[k].co[1] = q[i]
def prepare_source(clip, spec):
    act = SOURCE_ACTIONS[spec['source']].copy(); act.name = '_src_' + clip
    if spec.get('window'):
        a0, a1 = spec['window']; out = spec['out']; k = out / (a1 - a0)
        for fc in act.fcurves:
            vals = {f: fc.evaluate(a0 + f / k) for f in range(out + 1)}
            fc.keyframe_points.clear()
            for f, v in vals.items(): fc.keyframe_points.insert(f, v).interpolation = 'LINEAR'
            fc.update()
    return act
def frame_range(act, spec):
    return (0, spec['out']) if spec.get('window') else (int(act.frame_range[0]), int(act.frame_range[1]))
def evaluate_frames(act, f0, f1, fn):
    arm.animation_data.action = act; out = {}
    for f in range(f0, f1 + 1): scene.frame_set(f); bpy.context.view_layer.update(); out[f] = fn(f)
    return out
def hips_world_rot(act, f, axis_world, deg):
    rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
    ax = (rest.transposed() @ (Wr.transposed() @ axis_world)).normalized(); fq = fcurves_of(act, 'Hips', 'rotation_quaternion', 4)
    for i_k in range(len(fq[0].keyframe_points)):
        if int(round(fq[0].keyframe_points[i_k].co[0])) != f: continue
        q = Quaternion(ax, math.radians(deg)) @ Quaternion([fq[i].keyframe_points[i_k].co[1] for i in range(4)])
        for i in range(4): fq[i].keyframe_points[i_k].co[1] = q[i]
def bone_local_rot(act, bone, f, axis_world, deg):
    rest = arm.data.bones[P + bone].matrix_local.to_3x3().normalized()
    ax = (rest.transposed() @ (Wr.transposed() @ axis_world)).normalized(); fq = fcurves_of(act, bone, 'rotation_quaternion', 4)
    for i_k in range(len(fq[0].keyframe_points)):
        if int(round(fq[0].keyframe_points[i_k].co[0])) != f: continue
        q = Quaternion([fq[i].keyframe_points[i_k].co[1] for i in range(4)]) @ Quaternion(ax, math.radians(deg))
        for i in range(4): fq[i].keyframe_points[i_k].co[1] = q[i]
def hips_lat(f):
    rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
    return ((W @ pb[P + 'Hips'].matrix).to_3x3().normalized() @ rest.transposed() @ Vector((1, 0, 0))).normalized()
def align_yaw(act, f0, f1, mode):
    set_legs(False); lats = evaluate_frames(act, f0, f1, hips_lat)
    if mode == 'start':
        y0 = math.degrees(math.atan2(lats[f0].y, lats[f0].x))
        for f in lats: hips_world_rot(act, f, Vector((0, 0, 1)), -y0)
    else:
        raw = {f: l.rotation_difference(Vector((1, 0, 0))) for f, l in lats.items()}
        for f in raw:
            q = Quaternion((0, 0, 0, 0))
            for g, w in ((max(f0, f - 1), .25), (f, .5), (min(f1, f + 1), .25)):
                r = raw[g] if raw[g].dot(raw[f]) >= 0 else -raw[g]; q = Quaternion([q[i] + w * r[i] for i in range(4)])
            q.normalize(); ax, ang = q.to_axis_angle(); hips_world_rot(act, f, ax, math.degrees(ang))
    renorm_quats(act)
    for fc in act.fcurves: fc.update()
def set_hips_height(act, f0, f1, dz_of):
    rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized(); fl = fcurves_of(act, 'Hips', 'location', 3)
    for i in range(3):
        if fl[i] is None: fl[i] = act.fcurves.new(f'pose.bones["{P}Hips"].location', index=i, action_group=P + 'Hips')
    for f in range(f0, f1 + 1):
        loc = rest.transposed() @ Vector((0, 0, dz_of(f) / ARM_SCALE))
        for i in range(3):
            ex = [kp for kp in fl[i].keyframe_points if int(round(kp.co[0])) == f]
            if ex: ex[0].co[1] = loc[i]; ex[0].interpolation = 'LINEAR'
            else: fl[i].keyframe_points.insert(f, loc[i]).interpolation = 'LINEAR'
    for fc in fl: fc.update()
def mesh_min_z():
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
    n = len(me.vertices); co = np.empty(n * 3); me.vertices.foreach_get('co', co); ev.to_mesh_clear()
    M = np.array(body.matrix_world); return float((co.reshape(n, 3) @ M[2, :3] + M[2, 3]).min())

BACKSTEP = [(0, -0.03, 5, -2, 0.00), (1, -0.08, 9, -4, 0.00), (2, 0.03, -12, 5, 0.03), (3, 0.12, -18, 7, 0.10), (4, 0.15, -17, 7, 0.14),
            (5, 0.14, -14, 6, 0.14), (6, 0.10, -10, 4, 0.10), (7, 0.04, -5, 2, 0.05), (8, -0.09, 8, -4, 0.00), (9, -0.10, 10, -4, 0.00),
            (10, -0.06, 6, -3, 0.00), (11, -0.02, 2, -1, 0.00), (12, 0.0, 0, 0, 0.00)]
CLIPS = {name: dict(source=name, ground='contact') for name in SOURCE_ACTIONS}
CLIPS['run'] = dict(source='run', ground='stride')
CLIPS['dodge'] = dict(source='dodge', window=(6, 46), out=48, fps=96, ground='contact', yaw='track')
CLIPS['hit'] = dict(source='hit', window=(0, 23), out=12, ground='contact', yaw='start')
# 게임은 사망 1.2초 뒤 몸을 내리고 2.4초에 치운다 → 원본 3.9초 쓰러짐을 1.25초(30f)에 담는다.
CLIPS['death'] = dict(source='death', window=(0, 93), out=30, ground='contact', yaw='start')
CLIPS['Dodge_Backward'] = dict(source='idle', window=(0, 12), out=12, ground='authored', backstep=True)

report = {'blender': bpy.app.version_string, 'source': os.path.basename(SOURCE), 'reference': os.path.basename(REFERENCE), 'hero': HERO,
          'axisRollDeg': {n[len(P):]: round(math.degrees(q.angle), 1) for n, q in AXIS.items() if not any(s in n for s in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'))},
          'legPole': LEG_POLE, 'clips': {}}
baked = {}
for clip, spec in CLIPS.items():
    act = prepare_source(clip, spec); f0, f1 = frame_range(act, spec)
    for e in TW.values(): e.animation_data_clear()
    set_legs(False)
    if spec.get('yaw'): align_yaw(act, f0, f1, spec['yaw'])
    if spec.get('backstep'):
        for f, hz, pitch, spine, lift in BACKSTEP:
            hips_world_rot(act, f, Vector((1, 0, 0)), pitch); bone_local_rot(act, 'Spine1', f, Vector((1, 0, 0)), spine)
        renorm_quats(act)
        for side in ('Left', 'Right'):
            foot, _ = bone_world_rest(side + 'Foot'); knee, _ = bone_world_rest(side + 'Leg')
            for f, hz, pitch, spine, lift in BACKSTEP:
                a = TW['ankle_' + side[0]]; a.location = foot + Vector((0, 0.02 if side == 'Left' else -0.02, lift)); a.keyframe_insert('location', frame=f)
                k = TW['knee_' + side[0]]; k.location = knee + Vector((0, -0.6, 0)); k.keyframe_insert('location', frame=f)
        set_hips_height(act, f0, f1, lambda f: BACKSTEP[min(f, len(BACKSTEP) - 1)][1]); set_legs(True)
    arm.animation_data.action = act; scene.frame_start, scene.frame_end = f0, f1
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=1, only_selected=False, visual_keying=True, clear_constraints=False,
                     clear_parents=False, use_current_action=False, clean_curves=False, bake_types={'POSE'})
    out = arm.animation_data.action; out.name = clip
    for fc in out.fcurves:
        if fc.data_path.endswith('.scale'):
            for kp in fc.keyframe_points: kp.co[1] = 1.0
            fc.update()
    set_legs(False)
    mins = evaluate_frames(out, f0, f1, lambda f: mesh_min_z())
    mode = spec['ground']
    if mode == 'contact' and (spec.get('window') or clip in ('death',)):
        dz = {f: -mins[f] for f in mins} if spec.get('window') else {f: 0.25 * -mins[max(f0, f - 1)] + 0.5 * -mins[f] + 0.25 * -mins[min(f1, f + 1)] for f in mins}
    elif mode == 'contact':
        dz = {f: 0.25 * -mins[max(f0, f - 1)] + 0.5 * -mins[f] + 0.25 * -mins[min(f1, f + 1)] for f in mins}
    elif mode == 'stride':
        bob = {f: -0.022 * math.cos(2 * math.pi * f / 8) for f in mins}; c = -min(mins[f] + bob[f] for f in mins); dz = {f: bob[f] + c for f in mins}
    else:
        c = -mins[f0]; fl = fcurves_of(out, 'Hips', 'location', 3); rest = arm.data.bones[P + 'Hips'].matrix_local.to_3x3().normalized()
        cur = {f: (W.to_3x3() @ (rest @ Vector([fl[i].evaluate(f) for i in range(3)]))).z for f in mins}
        dz = {f: cur[f] + c + max(0.0, -(mins[f] + c)) for f in mins}
    set_hips_height(out, f0, f1, lambda f: dz[f])
    after = evaluate_frames(out, f0, f1, lambda f: mesh_min_z())
    report['clips'][clip] = {'frames': [f0, f1], 'fps': spec.get('fps', FPS), 'seconds': round((f1 - f0) / spec.get('fps', FPS), 4),
        'hipsDzRange': [round(min(dz.values()), 3), round(max(dz.values()), 3)], 'skinMinZ': [round(min(after.values()), 3), round(max(after.values()), 3)]}
    baked[clip] = out

for b in pb:
    for c in list(b.constraints): b.constraints.remove(c)
for e in TW.values(): bpy.data.objects.remove(e, do_unlink=True)
for a in list(bpy.data.actions):
    if a.name not in baked: bpy.data.actions.remove(a)
for a in baked.values(): a.use_fake_user = True
arm.animation_data.action = baked['idle']
BLEND = os.path.join(OUT, f'{HERO}-library-v1.blend')
bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
with open(os.path.join(OUT, f'{HERO}-library-author-report-v1.json'), 'w') as fp: json.dump(report, fp, indent=1, ensure_ascii=False)
def export(path, keep, fps):
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    s = bpy.context.scene; s.render.fps = fps; s.render.fps_base = 1
    a = next(o for o in s.objects if o.type == 'ARMATURE')
    for act in list(bpy.data.actions):
        if act.name not in keep: bpy.data.actions.remove(act)
    a.animation_data.action = bpy.data.actions[sorted(keep)[0]]
    bpy.ops.object.select_all(action='DESELECT'); a.select_set(True); bpy.context.view_layer.objects.active = a
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_anim_slide_to_zero=False, export_skins=False, export_morph=False, export_def_bones=False,
        export_apply=False, export_cameras=False, export_lights=False, export_optimize_animation_size=True, export_reset_pose_bones=True)
fine = {c for c, s in CLIPS.items() if s.get('fps')}
export(os.path.join(OUT, f'{HERO}-library-anim-v1.glb'), set(CLIPS) - fine, FPS)
export(os.path.join(OUT, f'{HERO}-library-anim-v1-96fps.glb'), fine, 96)
print('REPORT ' + json.dumps({k: {'skinMinZ': v['skinMinZ'], 'hipsDz': v['hipsDzRange']} for k, v in report['clips'].items()}))
