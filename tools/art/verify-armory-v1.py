import bpy, json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
items = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('arm_')]
assert len(items) == 24, len(items)
assert all(len(o.data.polygons) > 0 and len(o.data.materials) > 0 for o in items)
result = {'opened': bpy.data.filepath, 'blender': bpy.app.version_string, 'editable_meshes': len(items),
          'items': [{'id': o.name, 'vertices': len(o.data.vertices), 'polygons': len(o.data.polygons)} for o in items]}
(root / 'work/owner-expansion-20260914/blend-reopen.json').write_text(json.dumps(result, indent=2), encoding='utf8')
print('Verified reopened Blender source:', len(items), 'editable equipment meshes')
