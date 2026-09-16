"""Blender-authored editable Oath Hall. No external asset or character mutation."""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'art/oathhall-v2'; OUT=ROOT/'public/models/oathhall-v2'; EVIDENCE=ROOT/'work/visual-v1'
for p in [ART,OUT,EVIDENCE]: p.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
source=bpy.data.collections.new('OATH_HALL_V2 | editable stonework');scene.collection.children.link(source)
export=bpy.data.collections.new('RUNTIME_V2 | material batches');scene.collection.children.link(export)
rig=bpy.data.collections.new('STUDIO | camera and lights');scene.collection.children.link(rig)
def material(name,hexcolor,rough=.8,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True; n=m.node_tree.nodes.get('Principled BSDF')
 rgb=[int(hexcolor[i:i+2],16)/255 for i in (0,2,4)]; col=[((v+.055)/1.055)**2.4 if v>.04045 else v/12.92 for v in rgb]
 n.inputs['Base Color'].default_value=(*col,1);n.inputs['Roughness'].default_value=rough;n.inputs['Metallic'].default_value=metal;m.diffuse_color=(*col,1);return m
mats=[material('01 | Grey sage limestone','A7B3A0'),material('02 | Warm cut stone','DFD8BF'),material('03 | Aged bronze inlay','AC8850',.36,.65),material('04 | Deep oath textile','274942',.95),material('05 | Stone shadow','566F65'),material('06 | Warm edge','C6BFA7'),material('07 | Quiet leaves','54755A'),material('08 | Distant ridge','8DAA9E')]
def own(o,name,mat):
 o.name=name
 for c in list(o.users_collection):c.objects.unlink(o)
 source.objects.link(o);o.data.materials.append(mats[mat]);return o
counter=0
def box(name,loc,scale,mat=0,bevel=.04):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=own(bpy.context.object,name,mat);o.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  b=o.modifiers.new('Soft carved edge','BEVEL');b.width=bevel;b.segments=2
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
 return o
def cylinder(name,loc,radius,depth,mat,vertices=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc);return own(bpy.context.object,name,mat)
def mesh(name,verts,faces,mat):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();o=bpy.data.objects.new(name,data);source.objects.link(o);o.data.materials.append(mats[mat]);return o
def arch(name,x,y,r,spring,depth=.62):
 for side in [-1,1]:
  for row in range(5):box(name+' pier',(x+side*r,y,(spring/5)*(row+.5)),(.48,depth,spring/5-.024),1 if row%3 else 5,.04)
  box(name+' foot',(x+side*r,y,.13),(.78,.85,.26),5,.035)
  box(name+' capital',(x+side*r,y,spring-.13),(.76,.8,.2),1,.04)
 for j in range(17):
  a0=j*math.pi/17+.007;a1=(j+1)*math.pi/17-.007;vs=[]
  for yy in [y-depth/2,y+depth/2]:
   for rr,aa in [(r-.24,a0),(r+.24,a0),(r+.24,a1),(r-.24,a1)]:vs.append((x+rr*math.cos(aa),yy,spring+rr*math.sin(aa)))
  mesh(name+' voussoir',vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],1 if j%4 else 5)
def band(name,r,z,mat=2,tube=.015):
 bpy.ops.mesh.primitive_torus_add(major_segments=80,minor_segments=5,location=(0,0,z),major_radius=r,minor_radius=tube);return own(bpy.context.object,name,mat)
# Quiet foreground: large planes, shallow bevels, a single understated dais.
box('Foundation',(0,3,-.38),(24,28,.4),4,.07)
for xx in range(-4,5):
 for yy in range(-2,7):box('Wide flagstone',(xx*2.8,yy*2.6,-.155),(2.78,2.58,.05),0 if (xx+yy)%5 else 5,.018)
cylinder('Lower ceremonial step',(0,0,-.10),2.13,.2,1,80)
cylinder('Sage centre',(0,0,.015),1.93,.055,0,80)
band('Fine bronze edge',1.92,.047);band('Outer step edge',2.08,.005,tube=.012)
for i in range(8):
 a=i*math.pi/4;o=box('Dais seam',(math.cos(a)*1.67,math.sin(a)*1.67,.044),(.013,.28,.008),2,0);o.rotation_euler.z=a-math.pi/2
for i in range(3):box('Approach step',(0,-2.12-i*.32,-.13-i*.04),(3.8+i*.32,.35,.12),1,.03)
# Open architecture with clear depth, not rings around the hero's face.
arch('Near sanctuary',-.6,5.1,3.25,3.5)
arch('Distant sanctuary',.4,10.8,3.7,4.0,.5)
arch('Left cloister',-6.25,6.9,1.9,2.9,.5)
for x in [-5.0,5.25]:
 for y in [3.2,8.0]:
  cylinder('Octagonal plinth',(x,y,.18),.55,.35,1,8);cylinder('Pier',(x,y,2.34),.28,4.0,0,8)
  cylinder('Pier neck',(x,y,4.38),.42,.16,5,8);box('Pier cap',(x,y,4.6),(1.05,.9,.25),1,.06)
  for z in [.46,4.12]:cylinder('Bronze collar',(x,y,z),.32,.06,2,8)
# Limited textile. Heraldry is geometry; never raster text.
for x,y,top in [(-4.0,4.1,4.8),(3.2,5.35,4.35)]:
 vs=[(x-.45,y,top),(x+.45,y,top),(x+.45,y-.055,top-1.8),(x,y-.09,top-2.2),(x-.45,y-.055,top-1.8)]
 mesh('Oath banner',vs,[(0,4,3,2,1)],3);box('Banner rail',(x,y,top+.055),(1.15,.12,.07),2,.02)
 for sign in [-1,1]:
  vx=[(x+sign*.035,y-.035,top-.37),(x+sign*.17,y-.035,top-.62),(x+sign*.12,y-.08,top-1.58),(x+sign*.035,y-.08,top-1.77)]
  mesh('Split blade heraldry',vx,[(0,1,2,3)],2)
for side in [-1,1]:
 box('Cloister base',(side*7.5,5,.28),(2.1,18,.56),4,.05)
 for y in [0,3,6,9,12]:box('Parapet stone',(side*7.5,y,.74),(1.65,2.6,.3),0,.04)
# Receding planar silhouette and distant half-height stonework.
for layer,y in enumerate([18,25,34]):
 heights=[[3,5,4,7,5,3,4,6,4,5,3],[5,7,9,7,11,8,9,6,10,7,5],[9,11,8,13,10,15,12,9,13,11,8]][layer]
 verts=[]
 for j,h in enumerate(heights): verts.extend([(-30+j*6,y,-2),(-30+j*6,y,h)])
 faces=[(j*2,j*2+1,j*2+3,j*2+2) for j in range(len(heights)-1)]
 mesh('Distant sanctuary ridge '+str(layer),verts,faces,6 if layer==0 else 7)
# Limited sculptural greenery. Source shapes remain individually editable.
for cx,cy in [(-4.8,6.4),(5.8,8.8),(-7.2,10.2)]:
 cylinder('Stone planter',(cx,cy,.48),.55,.45,1,10)
 for j in range(9):
  a=j*2.399;z=.76+(j%3)*.20;r=.55+(j%4)*.13
  centre=Vector((cx+math.cos(a)*r*.45,cy+math.sin(a)*r*.45,z+.2))
  tip=Vector((cx+math.cos(a)*r,cy+math.sin(a)*r,z+.65))
  side=Vector((-math.sin(a)*.2,math.cos(a)*.2,0));stem=Vector((cx,cy,.68))
  mesh('Sculpted olive leaf',[tuple(stem),tuple(centre+side),tuple(tip),tuple(centre-side),tuple(centre+Vector((0,0,.12)))],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],6)

# Authored warm studio illumination is reference-only, not exported into runtime.
world=bpy.data.worlds.new('Oath sky');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.28,.40,.37,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55;scene.world=world
def light(name,kind,loc,energy,color,size=5):
 data=bpy.data.lights.new(name,kind);data.energy=energy;data.color=color
 if kind=='AREA':data.shape='DISK';data.size=size
 o=bpy.data.objects.new(name,data);rig.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,2,1))-o.location).to_track_quat('-Z','Y').to_euler();return o
light('Warm window','AREA',(-4,-1,7),1400,(1,.83,.63),6)
light('Cool sanctuary fill','AREA',(5,7,6),1000,(.64,.83,1),7)
camdata=bpy.data.cameras.new('Editorial view');cam=bpy.data.objects.new('Editorial view',camdata);rig.objects.link(cam)
cam.location=(7,-11,7);cam.rotation_euler=(Vector((0,4,1.5))-cam.location).to_track_quat('-Z','Y').to_euler();camdata.lens=35;scene.camera=cam
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1200;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ART/'oathhall-beauty.png')
# V2 focal sanctuary: raised oath altar, flanking braziers, stained-glass fins and radial floor inlay.
box('Oath altar base',(0,-7.9,.02),(4.8,3.2,.32),1,.03)
box('Oath altar cap',(0,-7.9,.30),(4.25,2.7,.24),2,.03)
cylinder('Oath altar dais',(0,-7.9,.62),1.25,.55,1,32)
band('Oath altar outer',1.12,.91,2,.045)
band('Oath altar inner',.72,.94,2,.025)
box('Oath crest spine',(0,-7.72,2.15),(.16,.16,2.3),2,.02)
box('Oath crest bar',(0,-7.72,3.18),(.72,.16,.12),2,.02)
for x in [-4.2,-2.8,2.8,4.2]:
 box('Sanctuary light fin',(x,-10.15,3.15),(.16,.08,5.4),4,.01)
 box('Sanctuary stained fin',(x,-10.10,3.15),(.42,.05,5.7),7,.01)
for x in [-4.8,4.8]:
 cylinder('Brazier base',(x,-7.35,.16),.48,.22,2,16)
 cylinder('Brazier stem',(x,-7.35,.70),.22,.90,1,16)
 cylinder('Brazier bowl',(x,-7.35,1.20),.55,.18,2,16)
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.28,location=(x,-7.35,1.47))
 own(bpy.context.object,'Brazier ember',4)
for i in range(4):
 box('Ceremonial approach',(0,-5.1-i*.62,-.22-i*.05),(5.8-i*.45,.7,.12),1,.03)
 band('Approach inlay',2.3-i*.28,-.15-i*.05,2,.022)
# Export owns six merged meshes. Source objects remain individually editable in .blend.
exports=[]
for index,mat in enumerate(mats):
 bpy.ops.object.select_all(action='DESELECT');copies=[]
 for obj in list(source.objects):
  if obj.type!='MESH' or obj.data.materials[0]!=mat:continue
  c=obj.copy();c.data=obj.data.copy();export.objects.link(c);c.select_set(True);copies.append(c)
 if not copies:continue
 bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();o=bpy.context.object;o.name='TLL_HallV1_'+str(index);exports.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in exports:o.select_set(True)
file=OUT/'oathhall-v2.glb'
bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_yup=True)
for o in exports:o.hide_render=True;o.hide_set(True)
bpy.ops.object.select_all(action='DESELECT');scene['description']='Oath Hall V2 / TLL / original authored architecture; character assets unmodified'
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'oathhall-v2.blend'))
bpy.ops.render.render(write_still=True)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in exports)
receipt={'blender':bpy.app.version_string,'generator':str(Path(__file__).relative_to(ROOT)),'licence':'Original authored for TLL; no external assets','mesh_batches':len(exports),'materials':len(mats),'triangles':triangles,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'editable':str((ART/'oathhall-v2.blend').relative_to(ROOT)),'source_object_count':len(source.objects),'hero_modified':False}
(OUT/'manifest.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print('OATH_HALL_RECEIPT '+json.dumps(receipt))
