import bpy, sys
from mathutils import Vector
for path in sys.argv[sys.argv.index('--')+1:]:
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=path)
  bpy.context.view_layer.update()
  zs = [(o.matrix_world @ Vector(c)).z for o in bpy.data.objects if o.type == 'MESH' for c in o.bound_box]
  print('HEIGHT', path, round(max(zs) - min(zs), 3))

