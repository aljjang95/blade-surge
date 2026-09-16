"""Reopen all editable masters and reimport every delivery fitting in Blender."""
import bpy, os, json, hashlib, struct
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
ART=os.path.join(ROOT,'art/heroes-v3')
with open(os.path.join(ART,'manifest.json')) as f:manifest=json.load(f)
assert {a['hero'] for a in manifest['assets']}=={'knight','barbarian','mage','rogue','ranger'}
digest=lambda p:hashlib.sha256(open(p,'rb').read()).hexdigest()
report={'blender':bpy.app.version_string,'status':'pass','scope':'Blender file reopen, packed references, GLB reimport and output hashes; not game or device QA','assets':[]}
for asset in manifest['assets']:
 hero=asset['hero'];delivery=os.path.join(ROOT,asset['path']);source=os.path.join(ROOT,asset['source'])
 assert digest(delivery)==asset['sha256'];assert digest(source)==asset['source_sha256']
 master=os.path.join(ART,hero+'-v3.blend');bpy.ops.wm.open_mainfile(filepath=master)
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
 assert meshes and rigs and bpy.context.scene.camera
 missing=[]
 for image in bpy.data.images:
  if image.source=='FILE' and not image.packed_file and image.filepath and not os.path.isfile(bpy.path.abspath(image.filepath)):missing.append(image.name)
 assert not missing, str(missing)
 renders=[]
 for view in ['baseline','three-quarter','front','profile','clay']:
  p=os.path.join(ART,hero+'-'+view+'.png')
  with open(p,'rb') as f:header=f.read(24)
  assert header[:8]==b'\x89PNG\r\n\x1a\n';size=struct.unpack('>II',header[16:24]);assert size==(768,768)
  renders.append({'view':view,'sha256':digest(p),'width':size[0],'height':size[1]})
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=delivery)
 count=0
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  count+=1;p=o;bone=None
  while p and not bone:bone=p.get('tllBone');p=p.parent
  assert bone in asset['bones'], str(bone)
 assert count>0
 report['assets'].append({'hero':hero,'glb_sha256':digest(delivery),'blend_sha256':digest(master),'imported_meshes':count,'missing_references':missing,'renders':renders})
os.makedirs(os.path.join(ROOT,'work/overhaul-v3'),exist_ok=True)
with open(os.path.join(ROOT,'work/overhaul-v3/blender-verification.json'),'w') as f:json.dump(report,f,indent=2)
print('V3_BLENDER_REOPEN_PASS',len(report['assets']))
