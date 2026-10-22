# 저작이 끝난 1단계 런타임 GLB(골격·클립·소켓)의 골격에 새 Tripo 리깅 몸 메시를 다시 묶어 '몸만' GLB 로 내보낸다.
# 궁수 v5(2026-10-23 '애꾸' 얼굴 교정)처럼 몸을 다시 만든 경우에 쓴다. Blender 왕복은 뼈 자식 소켓 위치를 뼈 길이만큼 밀어 버리므로
# 클립·소켓은 여기서 내보내지 않고 tools/art/swap-library-body.mjs 가 base GLB 바이트에서 그대로 가져온다.
#   blender -b -P tools/asset-library/blender_swap_body.py -- --base <v4.glb> --body <rigged.glb|fbx> --output <v5.glb> --report <r.json>
import bpy, json, math, sys
from pathlib import Path
from mathutils import Matrix
from mathutils.kdtree import KDTree

def args():
    a = sys.argv[sys.argv.index('--') + 1:]; out = {}; i = 0
    while i < len(a):
        if a[i].startswith('--') and i + 1 < len(a): out[a[i][2:]] = a[i + 1]; i += 2
        else: i += 1
    return out

def import_any(path):
    before = set(bpy.data.objects)
    if path.lower().endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    else: bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def bone(arm, suffix):
    for b in arm.data.bones:
        n = b.name.replace(':', '')
        if n.lower().startswith('mixamorig') and n.endswith(suffix): return b
    raise RuntimeError('bone not found ' + suffix)

def world(arm, suffix): return arm.matrix_world @ bone(arm, suffix).head_local

def norm(name): return name.replace(':', '')

def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    base = import_any(a['base'])
    arm1 = [o for o in base if o.type == 'ARMATURE'][0]
    old = [o for o in base if o.type == 'MESH']
    actions1 = set(bpy.data.actions)
    keep_action = arm1.animation_data.action if arm1.animation_data else None
    body = import_any(a['body'])
    arm2 = [o for o in body if o.type == 'ARMATURE'][0]
    meshes = [o for o in body if o.type == 'MESH']
    arm1.data.pose_position = 'REST'; arm2.data.pose_position = 'REST'
    if arm2.animation_data: arm2.animation_data_clear()
    bpy.context.view_layer.update()
    # Hips→Head 길이로 배율, 어깨선 방향으로 90° 단위 회전을 맞춘다(blender_retarget_tier.py 와 같은 규칙).
    s = (world(arm1, 'Head') - world(arm1, 'Hips')).length / (world(arm2, 'Head') - world(arm2, 'Hips')).length
    yaw = lambda arm: math.atan2(*reversed(((world(arm, 'LeftArm') - world(arm, 'RightArm')).xy)))
    turn = round((yaw(arm1) - yaw(arm2)) / (math.pi / 2)) * (math.pi / 2)
    h1, h2 = world(arm1, 'Hips'), world(arm2, 'Hips')
    align = Matrix.Translation(h1) @ Matrix.Scale(s, 4) @ Matrix.Rotation(turn, 4, 'Z') @ Matrix.Translation(-h2)
    names1 = {b.name for b in arm1.data.bones}
    by_norm = {norm(n): n for n in names1}
    parent2 = {b.name: (b.parent.name if b.parent else None) for b in arm2.data.bones}
    def target(name):
        cur = name
        while cur:
            if norm(cur) in by_norm: return by_norm[norm(cur)]
            cur = parent2.get(cur)
        return None
    merged = dropped = filled = 0
    for mesh in meshes:
        mw = mesh.matrix_world.copy()
        for mod in list(mesh.modifiers):
            if mod.type == 'ARMATURE': mesh.modifiers.remove(mod)
        mesh.parent = None; mesh.matrix_world = align @ mw
        for o in bpy.context.selected_objects: o.select_set(False)
        bpy.context.view_layer.objects.active = mesh; mesh.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for vg in list(mesh.vertex_groups):
            t = target(vg.name)
            if t == vg.name: continue
            if t is None: mesh.vertex_groups.remove(vg); dropped += 1; continue
            tg = mesh.vertex_groups.get(t) or mesh.vertex_groups.new(name=t)
            for v in mesh.data.vertices:
                for g in v.groups:
                    if g.group == vg.index and g.weight > 0: tg.add([v.index], g.weight, 'ADD')
            mesh.vertex_groups.remove(vg); merged += 1
        weighted = [v for v in mesh.data.vertices if any(g.weight > 0 for g in v.groups)]
        loose = [v for v in mesh.data.vertices if not any(g.weight > 0 for g in v.groups)]
        if loose and weighted:
            kd = KDTree(len(weighted))
            for i, v in enumerate(weighted): kd.insert(v.co, i)
            kd.balance()
            for v in loose:
                src = weighted[kd.find(v.co)[1]]
                for g in src.groups: mesh.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')
        filled += len(loose)
        mesh.parent = arm1; mesh.matrix_parent_inverse = arm1.matrix_world.inverted()
        mesh.modifiers.new('Armature', 'ARMATURE').object = arm1
    for o in old: bpy.data.objects.remove(o, do_unlink=True)
    for o in body:
        if o not in meshes and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
    for act in list(bpy.data.actions):
        if act not in actions1: bpy.data.actions.remove(act)
    arm1.data.pose_position = 'POSE'
    if keep_action: arm1.animation_data.action = keep_action
    for image in bpy.data.images:
        w, h = image.size
        if max(w, h) > 1024:
            f = 1024 / max(w, h); image.scale(max(1, round(w * f)), max(1, round(h * f))); image.pack()
    tris = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)
    bpy.ops.export_scene.gltf(filepath=a['output'], export_format='GLB', export_yup=True, export_animations=False, export_apply=False, export_cameras=False, export_lights=False,
        export_image_format='WEBP', export_image_quality=82)
    Path(a['report']).write_text(json.dumps({'ok': True, 'scale': s, 'yawDeg': math.degrees(turn), 'mergedGroups': merged,
        'droppedGroups': dropped, 'filledVertices': filled, 'bones': len(arm1.data.bones), 'triangles': tris,
        'actions': sorted(x.name for x in bpy.data.actions)}, ensure_ascii=False), encoding='utf-8')

try: main()
except Exception as e:
    Path(args()['report']).write_text(json.dumps({'ok': False, 'error': repr(e)}), encoding='utf-8'); raise
