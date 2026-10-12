import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=sys.argv[-1])
print('ACTIONS', [a.name for a in bpy.data.actions])
print('ARM', [(o.name, len(o.data.bones)) for o in bpy.data.objects if o.type == 'ARMATURE'])
print('MESH', [(o.name, len(o.data.polygons), [m.type for m in o.modifiers], o.parent.name if o.parent else None) for o in bpy.data.objects if o.type == 'MESH'])
print('NLA', [(o.name, [t.name for t in o.animation_data.nla_tracks], o.animation_data.action.name if o.animation_data.action else None) for o in bpy.data.objects if o.animation_data])

