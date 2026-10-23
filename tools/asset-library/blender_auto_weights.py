# Tripo 내보내기에 스킨 가중치가 빠진 경우(정점 전부 관절 하나에 1) 같은 Tripo 뼈대로 Blender 자동 가중치(뼈 열 확산)를 다시 입힌다.
# 2026-10-23 궁수 3단계 t3 PC 결과에서 발견. 메시 모양·뼈는 건드리지 않는다. 열 확산이 실패한 정점은 가장 가까운 뼈 1로 채운다.
#   blender -b -P tools/asset-library/blender_auto_weights.py -- --input <rigged.glb> --output <weighted.glb> --report <r.json>
import bpy, json, sys
from pathlib import Path

def args():
    a = sys.argv[sys.argv.index('--') + 1:]; out = {}; i = 0
    while i < len(a):
        if a[i].startswith('--') and i + 1 < len(a): out[a[i][2:]] = a[i + 1]; i += 2
        else: i += 1
    return out

def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a['input'])
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    mesh = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
    arm.data.pose_position = 'REST'
    before = sum(1 for v in mesh.data.vertices if sum(1 for g in v.groups if g.weight > 0) > 1)
    mesh.vertex_groups.clear()
    for m in list(mesh.modifiers):
        if m.type == 'ARMATURE': mesh.modifiers.remove(m)
    mesh.parent = None
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    empty = 0
    for v in mesh.data.vertices:
        if not any(g.weight > 0 for g in v.groups):
            p = mesh.matrix_world @ v.co
            bone = min(arm.data.bones, key=lambda b: ((arm.matrix_world @ b.head_local) - p).length)
            mesh.vertex_groups[bone.name].add([v.index], 1.0, 'REPLACE'); empty += 1
    multi = sum(1 for v in mesh.data.vertices if sum(1 for g in v.groups if g.weight > 0) > 1)
    for image in bpy.data.images:
        w, h = image.size
        if max(w, h) > 2048:
            f = 2048 / max(w, h); image.scale(max(1, round(w * f)), max(1, round(h * f))); image.pack()
    bpy.ops.export_scene.gltf(filepath=a['output'], export_format='GLB', export_animations=False, export_cameras=False, export_lights=False,
        export_image_format='WEBP', export_image_quality=90, export_yup=True)
    Path(a['report']).write_text(json.dumps({'ok': True, 'multiInfluenceBefore': before, 'multiInfluenceAfter': multi, 'filledNearest': empty,
        'vertices': len(mesh.data.vertices)}), encoding='utf-8')

try: main()
except Exception as e:
    Path(args()['report']).write_text(json.dumps({'ok': False, 'error': repr(e)[:2000]}), encoding='utf-8'); raise
