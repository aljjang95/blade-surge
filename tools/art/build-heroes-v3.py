"""Blender 5.2.1: separately versioned fitted costumes, retained faces and rigs.
Run after decode-v3-sources.mjs. No input asset is overwritten.
"""
import bpy, math, os, json, hashlib, sys
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'public/models/heroes-v3')
ART=os.path.join(ROOT,'art/heroes-v3')
os.makedirs(OUT,exist_ok=True);os.makedirs(ART,exist_ok=True)
assert bpy.app.version[:3]==(5,2,1), 'This revision requires Blender 5.2.1 LTS'

def v(p):return (p[0],-p[2],p[1])
def mat(name,c,metal=0,rough=.6):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*c,1)
 bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
 return m
def mesh(name,verts,faces,m,bone):
 me=bpy.data.meshes.new(name);me.from_pydata([v(p) for p in verts],[],faces);me.update()
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(m);o['tllBone']=bone
 authored.append(o);return o
def plate(name,pts,m,bone='chest',thick=.045):
 n=len(pts);verts=pts+[(x,y,z-thick) for x,y,z in pts]
 o=mesh(name,verts,[tuple(range(n)),tuple(range(n,n*2))[::-1]]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],m,bone)
 b=o.modifiers.new('Hand finished edge','BEVEL');b.width=.012;b.segments=2
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
 # Consistent outward normals on closed original geometry.
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
 return o
def ribbon(name,points,width,m,bone='hips'):
 pts=[(x-width,y,z) for x,y,z in points]+[(x+width,y,z) for x,y,z in reversed(points)]
 return plate(name,pts,m,bone,.018)
def pauldron(side,m,trim,layers=3,wide=1):
 # A fitted curved cap replaces the overlapping sphere + flat plates.
 bone='upperarm.'+('l' if side>0 else 'r');cx=side*.34
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=v((cx,1.09,0)))
 sleeve=bpy.context.object;sleeve.name='Articulated undersleeve';sleeve.scale=(.145,.13,.15)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 sleeve.data.materials.append(cloth);sleeve['tllBone']=bone;authored.append(sleeve)
 for poly in sleeve.data.polygons:poly.use_smooth=True
 for k in range(layers):
  # Staggered elliptical caps form broad readable lames, without floating spikes.
  a0=.06+k*.34;a1=.47+k*.34;verts=[];n=18
  for a in [a0,a1]:
   for j in range(n+1):
    t=j*math.tau/n
    verts.append((cx+math.cos(t)*math.sin(a)*.25*wide,1.12+math.cos(a)*.205,math.sin(t)*math.sin(a)*.235))
  faces=[(j,j+1,j+n+2,j+n+1) for j in range(n)]
  o=mesh('Curved shoulder lame '+str(side)+' '+str(k),verts,faces,m if k<layers-1 else trim,bone)
  solid=o.modifiers.new('Forged thickness','SOLIDIFY');solid.thickness=.018
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=solid.name)
  for poly in o.data.polygons:poly.use_smooth=True
def light(name,pos,power,color,size):
 data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
 o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=v(pos);o.rotation_euler=(Vector(v((0,1.1,0)))-o.location).to_track_quat('-Z','Y').to_euler()
def render(scene,hero,suffix,clay=False):
 scene.render.filepath=os.path.join(ART,hero+'-'+suffix+'.png')
 scene.view_layers[0].material_override=claymat if clay else None
 bpy.ops.render.render(write_still=True)
 scene.view_layers[0].material_override=None

receipt={'blender':bpy.app.version_string,'build_hash':bpy.app.build_hash.decode(),'assets':[],'scope':'Fitted costume revision; retained original faces, rigs and animations. Blender studio renders are not game QA.'}
heroes=['knight','barbarian','mage','rogue','ranger']
only=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--hero=')),None)
if only:
 assert only in heroes
 heroes=[only]
 with open(os.path.join(ART,'manifest.json')) as f:receipt=json.load(f)
 receipt['assets']=[a for a in receipt['assets'] if a['hero']!=only]
for hero in heroes:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 scene=bpy.context.scene;scene.name='Oath Expedition '+hero
 authored=[];name=hero.capitalize()
 source=os.path.join(ROOT,'public/models/tll',hero+'-casual-v2.glb')
 if hero!='ranger':
  bpy.ops.import_scene.gltf(filepath=source)
  authored=[o for o in scene.objects if o.type=='MESH']
 baseline_objects=list(authored)
 baseline_materials={o.name:[s.material for s in o.material_slots] for o in authored}
 # Light/dark area hierarchy remains visible when the actor is small.
 palette={'knight':(.025,.09,.15),'barbarian':(.28,.035,.018),'mage':(.12,.055,.29),'rogue':(.02,.13,.14),'ranger':(.045,.17,.07)}
 cloth=mat('V3 Woven cloth',palette[hero],0,.88)
 steel=mat('V3 Blackened steel',(.085,.13,.17),.62,.37)
 ivory=mat('V3 Ivory enamel',(.82,.78,.62),.28,.32)
 gold=mat('V3 Brushed gold',(.57,.34,.095),.70,.31)
 silver=mat('V3 Silver steel',(.43,.58,.64),.62,.29)
 jewel=mat('V3 House gemstone',{'knight':(.02,.4,.42),'barbarian':(.5,.055,.018),'mage':(.20,.09,.62),'rogue':(.045,.45,.34),'ranger':(.36,.52,.08)}[hero],.25,.25)
 for o in authored:
  for slot in o.material_slots:
   m=slot.material;n=m.name.lower()
   if 'woven' in n:slot.material=cloth
   elif 'enamel' in n:slot.material=ivory
   elif 'steel' in n:slot.material=steel
   elif 'gold' in n:slot.material=gold
 retired=[]
 replaced={'knight':['upperarm.l','upperarm.r'],'barbarian':['upperarm.r'],'rogue':['upperarm.l']}.get(hero,[])
 for o in list(authored):
  if o.get('tllBone') in replaced:
   retired.append(o);authored.remove(o);o.hide_render=True
 # New geometry changes the class silhouette, not just its palette.
 if hero=='knight':
  plate('Oath cuirass',[(-.24,1.22,.21),(.24,1.22,.21),(.25,.94,.29),(.13,.79,.27),(0,.75,.29),(-.13,.79,.27),(-.25,.94,.29)],ivory)
  for s in [-1,1]:
   pauldron(s,ivory,gold)
   ribbon('Split navy coat',[(s*.15,.79,.30),(s*.17,.50,.30),(s*.23,.15,.22)],.095,cloth)
   ribbon('Coat gold edge',[(s*.23,.77,.32),(s*.25,.50,.32),(s*.31,.15,.24)],.009,gold)
  plate('Split blade chest oath',[(-.025,1.16,.315),(-.065,1.095,.33),(-.025,.87,.34),(0,.85,.34),(0,1.16,.315)],gold)
  plate('Split blade chest oath right',[(.025,1.16,.315),(.065,1.095,.33),(.025,.87,.34),(.012,.85,.34),(.012,1.16,.315)],gold)
 elif hero=='barbarian':
  pauldron(-1,steel,gold,4,1.5)
  ribbon('War sash',[(-.25,1.20,.22),(0,.98,.285),(.23,.78,.23)],.055,cloth,'chest')
  for s in [-1,1]:
   ribbon('Heavy belt tab',[(s*.15,.71,.24),(s*.20,.32,.25)],.095,cloth)
 elif hero=='mage':
  for s in [-1,1]:
   plate('Lunar mantle '+str(s),[(s*.12,1.28,.10),(s*.32,1.40,.03),(s*.56,1.32,-.025),(s*.41,1.12,.17),(s*.16,1.10,.26)],silver,'chest',.08)
   ribbon('Astral stole',[(s*.17,1.13,.28),(s*.14,.76,.29),(s*.25,.22,.33)],.045,ivory,'hips')
  plate('Astral diamond',[(0,1.2,.32),(.082,1.09,.35),(0,.96,.35),(-.082,1.09,.35)],jewel)
  belt=[];n=32
  for y in [.68,.80]:
   for j in range(n):
    a=j*math.tau/n;belt.append((math.sin(a)*.292,y,math.cos(a)*.236-.015))
  mesh('Continuous astral belt',belt,[(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)],cloth,'hips')
 elif hero=='rogue':
  pauldron(1,steel,silver,2,.85)
  ribbon('Night diagonal harness',[(-.22,1.21,.235),(0,1.04,.30),(.22,.80,.265)],.035,ivory,'chest')
  for s in [-1,1]:
   ribbon('Split stealth tail',[(s*.19,.75,-.17),(s*.25,.40,-.26),(s*.34,.18,-.37)],.065,cloth)
  plate('Night clasp',[(.08,1.11,.33),(.13,1.07,.35),(.08,1.0,.35),(.03,1.07,.35)],jewel)
 else:
  for s in [-1,1]:
   for k in range(3):
    x=s*(.30+k*.037);y=1.20-k*.065
    plate('Warden leaf '+str(s)+' '+str(k),[(x-s*.12,y,.08),(x+s*.10,y+.02,.08),(x+s*.24,y-.14,.06),(x+s*.015,y-.15,.21)],ivory if k==0 else cloth,'upperarm.'+('l' if s>0 else 'r'),.04)
  plate('Warden brooch',[(0,1.18,.30),(.07,1.10,.33),(0,1.02,.33),(-.07,1.1,.33)],gold)
 # Export only fitted surfaces; preview face/rig is a retained reference collection.
 bpy.ops.object.select_all(action='DESELECT')
 for o in authored:o.select_set(True)
 output=os.path.join(OUT,hero+'-v3.glb')
 bpy.ops.export_scene.gltf(filepath=output,export_format='GLB',use_selection=True,export_extras=True,export_animations=False)
 # Retained face and weapon at their original rest transforms for a same-angle studio review.
 before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'work/overhaul-v3/sources',name+'.glb'))
 source_objects=set(scene.objects)-before
 for o in source_objects:
  if o.animation_data:o.animation_data_clear()
  if o.type=='MESH' and hero!='ranger' and not any(k in o.name for k in ['_Head','1H_Sword','1H_Shield','2H_Axe','2H_Staff','1H_Dagger']):o.hide_render=True
  if o.type=='MESH' and any(k in o.name for k in ['1H_Crossbow','2H_Crossbow','1H_Shuriken']):o.hide_render=True
 # Avoid previewing all optional weapons at once.
 chosen={'knight':['Knight_Head','1H_Sword','Round_Shield'],'barbarian':['Barbarian_Head','2H_Axe'],'mage':['Mage_Head','2H_Staff'],'rogue':['Rogue_Head','Knife','Knife_Offhand']}.get(hero)
 if chosen:
  for o in source_objects:
   if o.type=='MESH':
    label=o.parent.name if o.parent and o.parent.type=='EMPTY' else o.name
    o.hide_render=not any(label==k or label.startswith(k+'.') for k in chosen)
 assert any(o.type=='MESH' and 'Head' in o.name and not o.hide_render for o in source_objects), 'Retained face must be visible in the studio review'
 # Blender imports a sampled source pose. Apply that same armature to the
 # fitted costume for the studio view; otherwise its unbound T-pose would
 # falsely appear to have detached hands beside the animated original weapons.
 rig=next(o for o in source_objects if o.type=='ARMATURE')
 for o in authored+retired:
  wanted=o.get('tllBone')
  bone=next((b.name for b in rig.data.bones if b.name.replace('.','')==wanted.replace('.','')),None)
  assert bone, 'Missing preview attachment '+str(wanted)
  group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
  modifier=o.modifiers.new('Preview source rig','ARMATURE');modifier.object=rig
  world=o.matrix_world.copy();o.parent=rig;o.matrix_world=world
 floor=mat('Studio graphite',(.025,.035,.047),0,.85);claymat=mat('Neutral clay',(.45,.45,.45),0,.85)
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));bpy.context.object.data.materials.append(floor)
 light('Warm key',(-3,5,5),500,(1,.88,.71),4);light('Cool fill',(4,3,2),350,(.56,.76,1),3);light('Rim',(-1,3,-4),700,(.60,.86,1),3)
 camdata=bpy.data.cameras.new('Review camera');cam=bpy.data.objects.new('Review camera',camdata);scene.collection.objects.link(cam);scene.camera=cam
 cam.location=v((3.25,2.7,6.3));cam.rotation_euler=(Vector(v((0,1.20,0)))-cam.location).to_track_quat('-Z','Y').to_euler();camdata.type='ORTHO';camdata.ortho_scale=3.25
 scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
 scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100
 scene.world=bpy.data.worlds.new('Studio world');scene.world.color=(.11,.11,.11);scene.view_settings.view_transform='AgX'
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART,hero+'-v3.blend'))
 candidate_materials={o.name:[s.material for s in o.material_slots] for o in baseline_objects}
 for o in authored:
  if o not in baseline_objects:o.hide_render=True
 for o in baseline_objects:
  o.hide_render=False
  for slot,m in zip(o.material_slots,baseline_materials[o.name]):slot.material=m
 render(scene,hero,'baseline')
 for o in authored:o.hide_render=False
 for o in retired:o.hide_render=True
 for o in baseline_objects:
  for slot,m in zip(o.material_slots,candidate_materials[o.name]):slot.material=m
 render(scene,hero,'three-quarter');render(scene,hero,'clay',True)
 cam.location=v((0,2.7,6.5));cam.rotation_euler=(Vector(v((0,1.20,0)))-cam.location).to_track_quat('-Z','Y').to_euler();render(scene,hero,'front')
 cam.location=v((6.5,2.7,0));cam.rotation_euler=(Vector(v((0,1.20,0)))-cam.location).to_track_quat('-Z','Y').to_euler();render(scene,hero,'profile')
 digest=lambda p:hashlib.sha256(open(p,'rb').read()).hexdigest()
 receipt['assets'].append({'hero':hero,'path':os.path.relpath(output,ROOT).replace('\\','/'),'sha256':digest(output),'bytes':os.path.getsize(output),'source':('public/models/Ranger.glb' if hero=='ranger' else os.path.relpath(source,ROOT).replace('\\','/')),'source_sha256':digest(os.path.join(ROOT,'public/models/Ranger.glb') if hero=='ranger' else source),'vertices':sum(len(o.data.vertices) for o in authored),'bones':sorted(set(o.get('tllBone','') for o in authored))})
 with open(os.path.join(ART,'manifest.json'),'w') as f:json.dump(receipt,f,indent=2)
 print('V3_HERO_COMPLETE',hero,flush=True)
