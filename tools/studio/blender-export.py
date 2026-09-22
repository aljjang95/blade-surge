"""수동 편집한 본 부착 메시를 별도 GLB로 내보내고 다시 가져와 검증한다."""
import argparse, hashlib, json, math, os, sys
from pathlib import Path
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
p.add_argument('--receipt', required=True)
a = p.parse_args(args)
output, receipt = Path(a.output).resolve(), Path(a.receipt).resolve()
source = Path(bpy.data.filepath).resolve()
assert source.is_file() and source.suffix.lower() == '.blend', 'Saved Blender source required'
assert output.suffix.lower() == '.glb' and not output.exists(), 'New GLB output required'
assert not receipt.exists(), 'Refusing to overwrite an existing receipt'
digest = lambda f: hashlib.sha256(Path(f).read_bytes()).hexdigest()
source_hash = digest(source)
collection = bpy.data.collections.get('TLL_EXPORT')
objects = list(collection.all_objects) if collection else list(bpy.context.selected_objects)
objects = [o for o in objects if o.type == 'MESH']
assert objects, 'Select the authored meshes or create a TLL_EXPORT collection before saving'
allowed = {'chest', 'hips', 'upperarm.l', 'upperarm.r', 'lowerarm.l', 'lowerarm.r', 'foot.l', 'foot.r', 'head'}
assert all(o.get('tllBone') in allowed for o in objects), 'Every export mesh needs an allowed tllBone tag'
assert sum(len(o.data.vertices) for o in objects) <= 100000, 'Review required: vertex budget exceeded'
assert len(objects) <= 128, 'Review required: mesh budget exceeded'
expected = sorted(o.get('tllBone') for o in objects)
exported = []
for o in objects:
    armatures = [m for m in o.modifiers if m.type == 'ARMATURE']
    states = [(m, m.show_viewport, m.show_render) for m in armatures]
    try:
        for m, _, _ in states: m.show_viewport = False; m.show_render = False
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        evaluated = o.evaluated_get(graph)
        mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=graph)
        clone = bpy.data.objects.new(o.name + '_export', mesh)
        bpy.context.scene.collection.objects.link(clone)
        clone.matrix_world = o.matrix_world.copy()
        clone['tllBone'] = o['tllBone']
        assert all(math.isfinite(c) for v in mesh.vertices for c in v.co), 'Nonfinite vertex'
        exported.append(clone)
    finally:
        for m, visible, render in states: m.show_viewport = visible; m.show_render = render
bpy.ops.object.select_all(action='DESELECT')
for o in exported: o.select_set(True)
bpy.context.view_layer.objects.active = exported[0]
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
                          export_extras=True, export_animations=False, export_skins=False)
assert output.is_file() and output.stat().st_size > 100, 'Missing GLB export'
assert digest(source) == source_hash, 'Input Blender master changed unexpectedly'
original_names = [o.name for o in objects]
original_count = len(objects)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(output))
imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(imported) == original_count, 'Reimported mesh count mismatch'
actual = sorted(o.get('tllBone', '') for o in imported)
assert actual == expected, 'Reimported attachment tags mismatch'
assert all(math.isfinite(c) for o in imported for v in o.data.vertices for c in v.co), 'Reimported nonfinite vertex'
triangles = 0
for o in imported:
    o.data.calc_loop_triangles()
    triangles += len(o.data.loop_triangles)
result = {'schema': 'tll.blender-manual-export/v1', 'passed': True,
          'source': str(source), 'source_sha256': source_hash,
          'output': str(output), 'output_sha256': digest(output),
          'bytes': output.stat().st_size, 'blender': bpy.app.version_string,
          'meshes': len(imported), 'triangles': triangles,
          'bone_tags': sorted(set(actual)), 'source_objects': original_names,
          'source_unchanged': digest(source) == source_hash,
          'reimport_verified': True, 'game_adopted': False,
          'note': 'Tagged attachment meshes only. Preview rig deformation omitted. No game or production change.'}
receipt.parent.mkdir(parents=True, exist_ok=True)
receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print('TLL_BLENDER_EXPORT_PASS', json.dumps({'meshes':len(imported),'triangles':triangles,'bytes':result['bytes']}))
