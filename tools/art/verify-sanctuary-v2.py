import bpy,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=root/'work/experience-v2';out.mkdir(exist_ok=True,parents=True)
source=bpy.data.collections.get('SANCTUARY | hand-authored components');batch=bpy.data.collections.get('RUNTIME | material batches')
assert source and len(source.objects)==588 and batch and len(batch.objects)==8
assert bpy.context.scene.camera is not None
bpy.ops.object.select_all(action='DESELECT')
for obj in batch.objects:obj.hide_set(False);obj.select_set(True)
file=out/'sanctuary-reopened.glb'
bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_yup=True)
original=root/'public/models/sanctuary-v2/sanctuary-v2.glb';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
receipt={'blender':bpy.app.version_string,'editable_objects':len(source.objects),'batches':len(batch.objects),'original_sha256':sha(original),'reopened_sha256':sha(file),'same_bytes':original.read_bytes()==file.read_bytes()}
(out/'blender-reopen.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt));assert receipt['same_bytes']
