import bpy
import math
import sys
from mathutils import Vector


def action(name, pose):
    armature = bpy.data.objects['TestRig']
    bpy.context.view_layer.objects.active = armature
    armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions.new(name)
    armature.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    bone = armature.pose.bones['root']
    bone.rotation_mode = 'XYZ'
    bone.rotation_euler = pose
    bone.keyframe_insert('rotation_euler', frame=1)
    bone.rotation_euler = Vector((pose[0], pose[1], pose[2] + math.radians(20)))
    bone.keyframe_insert('rotation_euler', frame=12)
    bpy.ops.object.mode_set(mode='OBJECT')
    armature.animation_data.action.use_fake_user = True


def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    output = args[args.index('--output') + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bpy.data.meshes.new('TestMesh')
    mesh.from_pydata([(-0.3, 0, 0), (0.3, 0, 0), (0, 0, 1.2)], [], [(0, 1, 2)])
    mesh.update()
    armature_data = bpy.data.armatures.new('TestRigData')
    armature = bpy.data.objects.new('TestRig', armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    root = armature_data.edit_bones.new('root')
    root.head = (0, 0, 0)
    root.tail = (0, 0, 0.6)
    hand = armature_data.edit_bones.new('hand')
    hand.head = root.tail
    hand.tail = (0, 0, 1.2)
    hand.parent = root
    bpy.ops.object.mode_set(mode='OBJECT')
    obj = bpy.data.objects.new('TestCharacter', mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = armature
    modifier = obj.modifiers.new('Armature', 'ARMATURE')
    modifier.object = armature
    root_group = obj.vertex_groups.new(name='root')
    hand_group = obj.vertex_groups.new(name='hand')
    root_group.add([0, 1], 1.0, 'REPLACE')
    hand_group.add([2], 1.0, 'REPLACE')
    bpy.context.view_layer.objects.active = armature
    action('idle', (0, 0, 0))
    action('attack', (0, 0, math.radians(35)))
    bpy.ops.wm.save_as_mainfile(filepath=output + '.blend')
    bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_apply=True)


if __name__ == '__main__':
    main()
