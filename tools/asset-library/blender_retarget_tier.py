# 갑옷 단계 메시를 1단계 정규화 골격에 다시 묶는다(본 이름·결합 자세를 1단계와 동일하게 맞춘다).
import bpy, json, sys
from pathlib import Path
from mathutils import Matrix, Vector

def args():
    a = sys.argv[sys.argv.index('--') + 1:]; out = {}; i = 0
    while i < len(a):
        if a[i].startswith('--') and i + 1 < len(a): out[a[i][2:]] = a[i + 1]; i += 2
        else: i += 1
    return out

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def find_bone(arm, suffix):
    for b in arm.data.bones:
        n = b.name.replace(':', '')
        if n.endswith(suffix) and n.lower().startswith('mixamorig'): return b
    raise RuntimeError('bone not found ' + suffix)

def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    t1 = import_glb(a['t1'])
    arm1 = [o for o in t1 if o.type == 'ARMATURE'][0]
    m1 = [o for o in t1 if o.type == 'MESH']
    tier = import_glb(a['tier'])
    arm2 = [o for o in tier if o.type == 'ARMATURE'][0]
    m2 = [o for o in tier if o.type == 'MESH']
    for o in (arm1, arm2):
        o.data.pose_position = 'REST'
        if o.animation_data: o.animation_data_clear()
    bpy.context.view_layer.update()
    def world(arm, suffix):
        b = find_bone(arm, suffix); return arm.matrix_world @ b.head_local
    h1, d1 = world(arm1, 'Hips'), world(arm1, 'Head')
    h2, d2 = world(arm2, 'Hips'), world(arm2, 'Head')
    s = (d1 - h1).length / (d2 - h2).length
    # 어깨선(오른팔→왼팔) 수평 방향을 1단계와 맞춘다. Tripo 리깅 GLB 는 정면 축이 90° 돌아 나오기도 한다.
    import math
    def yaw(arm):
        v = world(arm, 'LeftArm') - world(arm, 'RightArm'); return math.atan2(v.y, v.x)
    # 팔 본 위치는 리그마다 조금씩 달라 측정값을 가장 가까운 90° 배수로 맞춘다.
    turn = round((yaw(arm1) - yaw(arm2)) / (math.pi / 2)) * (math.pi / 2)
    align = Matrix.Translation(h1) @ Matrix.Scale(s, 4) @ Matrix.Rotation(turn, 4, 'Z') @ Matrix.Translation(-h2)
    names1 = {b.name for b in arm1.data.bones}
    parent2 = {b.name: (b.parent.name if b.parent else None) for b in arm2.data.bones}
    remap = {}
    for name in parent2:
        cur = name
        while cur and cur not in names1: cur = parent2.get(cur)
        remap[name] = cur
    merged = 0
    for mesh in m2:
        mw = mesh.matrix_world.copy()
        for mod in list(mesh.modifiers):
            if mod.type == 'ARMATURE': mesh.modifiers.remove(mod)
        mesh.parent = None; mesh.matrix_world = align @ mw
        bpy.context.view_layer.objects.active = mesh
        for o in bpy.context.selected_objects: o.select_set(False)
        mesh.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # 1단계 골격에 없는 본(손가락 등)의 가중치는 가장 가까운 상위 본으로 합친다.
        for vg in list(mesh.vertex_groups):
            target = remap.get(vg.name, vg.name if vg.name in names1 else None)
            if target == vg.name: continue
            if target is None: mesh.vertex_groups.remove(vg); continue
            tg = mesh.vertex_groups.get(target) or mesh.vertex_groups.new(name=target)
            for v in mesh.data.vertices:
                for g in v.groups:
                    if g.group == vg.index and g.weight > 0: tg.add([v.index], g.weight, 'ADD')
            mesh.vertex_groups.remove(vg); merged += 1
        # 가중치가 없는 정점(떠 있는 장식 등)은 내보낼 때 neutral_bone 이 생겨 1단계 골격과 어긋나므로, 가장 가까운 가중치 정점의 값을 복사한다.
        from mathutils.kdtree import KDTree
        weighted = [v for v in mesh.data.vertices if any(g.weight > 0 for g in v.groups)]
        loose = [v for v in mesh.data.vertices if not any(g.weight > 0 for g in v.groups)]
        if loose and weighted:
            kd = KDTree(len(weighted))
            for i, v in enumerate(weighted): kd.insert(v.co, i)
            kd.balance()
            for v in loose:
                src = weighted[kd.find(v.co)[1]]
                for g in src.groups: mesh.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')
        filled = len(loose)
        mesh.parent = arm1; mesh.matrix_parent_inverse = arm1.matrix_world.inverted()
        mod = mesh.modifiers.new('Armature', 'ARMATURE'); mod.object = arm1
    for o in m1: bpy.data.objects.remove(o, do_unlink=True)
    for o in tier:
        if o not in m2 and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
    keep = a.get('keepAnim')
    if keep:
        act = next((x for x in bpy.data.actions if x.name.startswith(keep)), None)
        arm1.animation_data_create().action = act
        for x in list(bpy.data.actions):
            if x is not act: bpy.data.actions.remove(x)
    else:
        for act in list(bpy.data.actions): bpy.data.actions.remove(act)
    arm1.data.pose_position = 'POSE'
    # 기존 정규화와 같은 텍스처 예산(1024px)으로 줄인다.
    for image in bpy.data.images:
        w, h = image.size
        if max(w, h) > 1024:
            f = 1024 / max(w, h); image.scale(max(1, round(w * f)), max(1, round(h * f))); image.pack()
    tris = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in m2)
    bpy.ops.export_scene.gltf(filepath=a['output'], export_format='GLB', export_yup=True, export_animations=bool(keep), export_apply=False,
        export_cameras=False, export_lights=False, export_image_format='WEBP', export_image_quality=82)
    Path(a['report']).write_text(json.dumps({'ok': True, 'scale': s, 'yawDeg': math.degrees(turn), 'mergedGroups': merged, 'filledVertices': filled, 'bones': len(arm1.data.bones), 'triangles': tris}), encoding='utf-8')

try: main()
except Exception as e:
    Path(args()['report']).write_text(json.dumps({'ok': False, 'error': repr(e)}), encoding='utf-8'); raise

