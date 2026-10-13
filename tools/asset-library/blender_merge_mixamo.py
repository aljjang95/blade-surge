import bpy, json, os, sys
from pathlib import Path
from mathutils import Vector

def args_after_dash():
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith('--') and i + 1 < len(argv):
            out[argv[i][2:]] = argv[i + 1]; i += 2
        else: i += 1
    return out

def main():
    a = args_after_dash(); report_path = a['report']; rigged = a['rigged']; clips_dir = Path(a['clips']); output = a['output']
    raw_map = a['mapping']
    mapping = json.loads(Path(raw_map).read_text(encoding='utf-8')) if raw_map.endswith('.json') else json.loads(raw_map)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=rigged)
    armatures = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(armatures) != 1: raise RuntimeError(f'expected one rigged armature, got {len(armatures)}')
    target = armatures[0]
    target.name = 'Armature'
    if target.animation_data:
        target.animation_data_clear()
    for logical, source in mapping.items():
        path = clips_dir / (source + '.fbx')
        if not path.is_file(): raise RuntimeError(f'missing clip {source}: {path}')
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.fbx(filepath=str(path))
        imported = [o for o in bpy.context.scene.objects if o not in before and o.type == 'ARMATURE']
        if len(imported) != 1: raise RuntimeError(f'clip armature missing {source}')
        clip_arm = imported[0]
        action = clip_arm.animation_data.action if clip_arm.animation_data else None
        if action is None: raise RuntimeError(f'clip action missing {source}')
        copied = action.copy(); copied.name = logical
        track = target.animation_data_create().nla_tracks.new(); track.name = logical; track.mute = True
        start, end = copied.frame_range
        strip = track.strips.new(logical, int(start), copied); strip.action_frame_start = start; strip.action_frame_end = end; strip.frame_start = start; strip.frame_end = end; strip.action_slot = copied.slots[0] if len(copied.slots) else None
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', export_yup=True, export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_anim_slide_to_zero=False, export_apply=False, export_cameras=False, export_lights=False, export_image_format='WEBP', export_image_quality=82)
    result={'ok':True,'rigged':rigged,'output':output,'logicalClips':sorted(mapping),'bones':len(target.data.bones),'bytes':os.path.getsize(output)}
    Path(report_path).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')

try: main()
except Exception as e:
    Path(args_after_dash()['report']).write_text(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False),encoding='utf-8')
    raise
