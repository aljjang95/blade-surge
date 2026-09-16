"""Run with Blender --background art/oathhall-v1/oathhall-v1.blend --python this.py."""
import bpy,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=root/'work/visual-v1';out.mkdir(parents=True,exist_ok=True)
source=bpy.data.collections.get('OATH_HALL | editable stonework')
batch=bpy.data.collections.get('RUNTIME | material batches')
assert source and batch and len(source.objects)>200 and len(batch.objects)==8
assert bpy.context.scene.camera is not None
bpy.ops.object.select_all(action='DESELECT')
for obj in batch.objects:obj.hide_set(False);obj.select_set(True)
file=out/'reopened-export.glb'
bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_yup=True)
original=root/'public/models/oathhall-v1/oathhall-v1.glb'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
receipt={'opened_blend':bpy.data.filepath,'blender':bpy.app.version_string,'editable_objects':len(source.objects),'batches':len(batch.objects),'original_sha256':sha(original),'reexport_sha256':sha(file),'same_bytes':original.read_bytes()==file.read_bytes()}
(out/'blender-reopen.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print(json.dumps(receipt))
assert receipt['same_bytes'],'Reopened source produced different export; inspect before claiming reproducibility'
