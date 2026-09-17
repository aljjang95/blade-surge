"""TLL Sanctuary V2. Original authored geometry with baked vertex shading; no downloaded art."""
import bpy, math, json, hashlib, random
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];ART=ROOT/'art/sanctuary-v2';OUT=ROOT/'public/models/sanctuary-v2'
for p in [ART,OUT]:p.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;random.seed(270916)
source=bpy.data.collections.new('SANCTUARY | hand-authored components');scene.collection.children.link(source)
export=bpy.data.collections.new('RUNTIME | material batches');scene.collection.children.link(export)
rig=bpy.data.collections.new('STUDIO | not exported');scene.collection.children.link(rig)
def material(name,color,rough=.8,metal=0,emission=0,double=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=not double
 n=m.node_tree.nodes.get('Principled BSDF');rgb=[int(color[i:i+2],16)/255 for i in (0,2,4)]
 col=[((v+.055)/1.055)**2.4 if v>.04045 else v/12.92 for v in rgb];m.diffuse_color=(*col,1)
 n.inputs['Base Color'].default_value=(*col,1);n.inputs['Roughness'].default_value=rough;n.inputs['Metallic'].default_value=metal
 if emission:n.inputs['Emission Color'].default_value=(*col,1);n.inputs['Emission Strength'].default_value=emission
 return m
mats=[material('S2 | Night limestone','6C807C'),material('S2 | Ivory carved stone','BCC3AB'),material('S2 | Worn bronze','B99250',.4,.6),material('S2 | Dark teal velvet','193D36',.97,0,0,True),material('S2 | Evergreen','385D49',.95,0,0,True),material('S2 | Amber lamps','F4C57D',.5,0,1.5,True),material('S2 | Glass and distant light','64A9AF',.6,0,.45,True),material('S2 | Blue shadow stone','243D42',.9)]
def own(o,name,mat):
 o.name=name
 for c in list(o.users_collection):c.objects.unlink(o)
 source.objects.link(o);o.data.materials.append(mats[mat]);return o
def box(name,loc,scale,mat=0,bevel=.035):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=own(bpy.context.object,name,mat);o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:b=o.modifiers.new('Carved edges','BEVEL');b.width=bevel;b.segments=2;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
 return o
def mesh(name,verts,faces,mat):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);source.objects.link(o);d.materials.append(mats[mat]);return o
def cylinder(name,loc,radius,depth,mat=0,n=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=radius,depth=depth,location=loc);return own(bpy.context.object,name,mat)
def ring(name,loc,r,tube,mat=2,rotate=None,n=64):
 bpy.ops.mesh.primitive_torus_add(major_segments=n,minor_segments=5,location=loc,major_radius=r,minor_radius=tube);o=own(bpy.context.object,name,mat)
 if rotate:o.rotation_euler=rotate
 return o
def branch(name,a,b,r0,r1,mat=7,n=7):
 d=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r0,radius2=r1,depth=d.length,location=(Vector(a)+Vector(b))/2);o=own(bpy.context.object,name,mat);o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def arc(name,x,y,r,spring,mat=1,depth=.5):
 for sign in [-1,1]:
  box(name+' pier',(x+sign*r,y,spring/2),(.33,depth,spring),mat,.05)
  for z,w in [(.15,.64),(.42,.47),(spring-.2,.54)]:box(name+' capital',(x+sign*r,y,z),(w,depth+.25,.15),2 if z==.42 else mat,.018)
 for j in range(20):
  a0=j*math.pi/20+.004;a1=(j+1)*math.pi/20-.004;vs=[]
  for yy in [y-depth/2,y+depth/2]:
   for rr,aa in [(r-.16,a0),(r+.16,a0),(r+.16,a1),(r-.16,a1)]:vs.append((x+rr*math.cos(aa),yy,spring+rr*math.sin(aa)))
  mesh(name+' carved arch',vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)
# Slate floor and ivory dais: locally bright subject, not a washed-out world.
box('Foundation',(0,5,-.30),(22,24,.4),7,.06)
for x in range(-5,6):
 for y in range(-2,10):
  shift=.6 if y%2 else 0;box('Slate flags',(x*1.9+shift,y*1.65,-.07),(1.87,1.62,.09),0 if (x+2*y)%7 else 7,.024)
cylinder('Ivory dais base',(0,0,-.035),2.22,.16,1,80);cylinder('Carved jade inset',(0,0,.055),2.05,.03,0,80)
ring('Thin brass outer rim',(0,0,.077),2.03,.022);ring('Silver inner rim',(0,0,.078),1.72,.012,1)
for j in range(12):
 a=j*math.pi/6;r0=1.62;r1=1.9;span=.045
 mesh('Dais compass inlay',[(r0*math.cos(a-span),r0*math.sin(a-span),.076),(r1*math.cos(a),r1*math.sin(a),.076),(r0*math.cos(a+span),r0*math.sin(a+span),.076)],[(0,1,2)],2)
for j in range(3):box('Carved approach stair',(0,-2.15-j*.34,-.04-j*.045),(3.5+j*.4,.36,.10),1,.028)
# Sanctuary apse: asymmetric layered depth, frame with real carved ribs.
arc('Inner vault',.65,4.7,3.1,2.6,1,.54);arc('Receding vault',.8,7.9,3.05,2.7,0,.5)
for x in [-5,4.8]:
 for y in [1.8,5.5,9.2]:
  cylinder('Column foot',(x,y,.18),.55,.35,1,8);cylinder('Fluted column',(x,y,2.58),.3,4.65,0,12)
  for z in [.42,.55,4.72,4.92]:cylinder('Column moulding',(x,y,z),.39,.10,1,12)
  box('Sculpted abacus',(x,y,5.13),(1,.86,.26),1,.05)
  for j in range(6):
   a=j*math.pi/3;branch('Flute inlay',(x+math.cos(a)*.303,y+math.sin(a)*.303,.76),(x+math.cos(a)*.303,y+math.sin(a)*.303,4.55),.013,.013,2,5)
  if y<8:box('Vault soffit',(x,y+1.8,5.18),(.65,3.85,.3),7,.04)
# Rear wall panels frame windows; broad stone planes preserve contrast.
for x in [-4.8,-3.6,3.8,5.0]:box('Apse buttress',(x,10.4,3.0),(1.08,.8,6.0),7,.045)
box('Rear sill',(.65,10.15,.6),(7.8,1.3,1.2),0,.08)
for x,r in [(-1.8,1.03),(.65,1.03),(3.1,1.03)]:
 arc('Lancet',x,10.0,r,3.1,1,.22)
 mesh('Cobalt window glass',[(x-r+.2,10.10,1.4),(x+r-.2,10.10,1.4),(x+r-.2,10.10,3.05),(x,10.10,4.08),(x-r+.2,10.10,3.05)],[(0,1,2,3,4)],6)
 for offset in [-.43,0,.43]:box('Window mullion',(x+offset,9.95,2.85),(.055,.09,2.8),2,.007)
 for z in [1.6,2.4,3.2]:box('Window transom',(x,9.95,z),(1.73,.09,.047),2,.005)
 for z in [2.0,2.8,3.52]:
  size=.30;mesh('Amber glass diamond',[(x,9.91,z-size),(x+size*.65,9.91,z),(x,9.91,z+size),(x-size*.65,9.91,z)],[(0,1,2,3)],5)
# Lamps and velvet banners tell the story of an inhabited hall.
for x,y,z in [(-2.7,3.15,2.55),(3.5,4.3,2.7),(-4.8,7.6,2.8),(5.0,8.9,2.8)]:
 branch('Lamp bracket',(x,y+.2,z-.35),(x,y-.25,z),.045,.045,2);cylinder('Lamp base',(x,y,z),.18,.1,2,10)
 cylinder('Warm glass lantern',(x,y,z+.26),.125,.44,5,8)
 bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=.27,radius2=.035,depth=.20,location=(x,y,z+.56));own(bpy.context.object,'Lantern crown',2)
 for j in range(4):
  a=j*math.pi/2;branch('Lantern cage',(x+.137*math.cos(a),y+.137*math.sin(a),z+.07),(x+.137*math.cos(a),y+.137*math.sin(a),z+.48),.014,.014,2,5)
for x,y,z in [(-3.65,4.5,4.05),(3.95,5.3,4.4)]:
 verts=[]
 for row in range(7):
  for col in range(5):
   yy=y+.035*math.cos(col*math.pi);zz=z-row*.32-(.23 if row==6 and col==2 else 0);verts.append((x+(col-2)*.22,yy,zz))
 faces=[(r*5+c,r*5+c+1,(r+1)*5+c+1,(r+1)*5+c) for r in range(6) for c in range(4)]
 mesh('Draped oath velvet',verts,faces,3);box('Banner crossbar',(x,y,z+.045),(1.18,.09,.06),2,.015)
 for sign in [-1,1]:mesh('Inlaid split blade',[(x+sign*.04,y-.06,z-.38),(x+sign*.17,y-.06,z-.6),(x+sign*.10,y-.06,z-1.53),(x+sign*.04,y-.06,z-1.74)],[(0,1,2,3)],2)
# Hand-authored tree clusters and climbing vines; no 2D forest wall.
for cx,cy,h in [(-5.0,4.0,3.8),(5.6,7.0,4.8),(-4.9,9.5,5.5)]:
 cylinder('Carved planter',(cx,cy,.38),.7,.5,0,10);ring('Planter bronze rim',(cx,cy,.65),.65,.03,2)
 branch('Olive trunk',(cx,cy,.62),(cx+.22,cy+.05,h*.68),.15,.07)
 for j in range(7):
  a=j*2.399;end=(cx+math.cos(a)*(1.0+(j%2)*.35),cy+math.sin(a)*.95,h*.72+(j%3)*.38)
  branch('Olive bough',(cx+.15,cy,h*.47),end,.065,.016)
  for k in range(4):
   loc=(end[0]+random.uniform(-.48,.48),end[1]+random.uniform(-.32,.32),end[2]+random.uniform(-.20,.25))
   bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.52,location=loc);o=own(bpy.context.object,'Sculpted olive canopy',4);o.scale=(1.1,.75,.6)
# Wide low walls and scattered work objects create a lived-in sanctuary.
for x in [-7.0,6.7]:
 box('Side retaining wall',(x,5.5,.6),(1.8,16,1.2),7,.075);box('Side coping',(x,5.5,1.27),(1.95,16,.14),1,.05)
for x,y in [(-3.8,2.8),(4.45,4.1)]:
 box('Stone bench',(x,y,.65),(1.4,.55,.14),1,.035)
 for dx in [-.5,.5]:box('Bench support',(x+dx,y,.34),(.18,.45,.55),7,.02)
for x,y in [(-2.7,5.4),(3.1,8.0)]:
 box('Reliquary',(x,y,.42),(1.0,.7,.8),7,.055);box('Reliquary bronze lip',(x,y,.84),(1.07,.77,.07),2,.01)
 for k in range(3):box('Closed book',(x,y-.02+k*.035,.90+k*.095),(.68-k*.05,.44,.075),3 if k%2 else 1,.01)
# Background dome has depth from actual curved geometry rather than a flat mountain sheet.
for i in range(5):
 y=15+i*3.7;x=(-1)**i*(7+i*.6);bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=2.8+i*.35,location=(x,y,1.8+i*.28));o=own(bpy.context.object,'Distant weathered sanctuary rock',7);o.scale=(1.45,1,.9)
# Bake broad material colour and actual geometric ambient occlusion into vertices.
bpy.context.view_layer.update();verts=[];faces=[]
for o in source.objects:
 if o.type!='MESH':continue
 off=len(verts);verts.extend(tuple(o.matrix_world@v.co) for v in o.data.vertices);faces.extend(tuple(off+i for i in p.vertices) for p in o.data.polygons)
bvh=BVHTree.FromPolygons(verts,faces);light=Vector((-4,-6,8)).normalized()
for o in source.objects:
 if o.type!='MESH':continue
 mat=o.data.materials[0];idx=mats.index(mat)
 if idx in [5,6]:continue
 shade=o.data.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER');colour=mat.diffuse_color[:3];variation=random.uniform(.90,1.06)
 for poly in o.data.polygons:
  n=(o.matrix_world.to_3x3().inverted().transposed()@poly.normal).normalized();centre=o.matrix_world@poly.center+n*.035
  tangent=n.cross(Vector((0,0,1)) if abs(n.z)<.85 else Vector((1,0,0))).normalized();bit=n.cross(tangent)
  blocked=0
  for j in range(5):
   a=j*2.399;ray=(n*.7+tangent*math.cos(a)*.65+bit*math.sin(a)*.65).normalized();hit=bvh.ray_cast(centre,ray,1.6)[0]
   if hit is not None:blocked+=1
  value=max(.34,(1-blocked*.075)*(.77+.23*max(0,n.dot(light)))*variation)
  for loop in poly.loop_indices:shade.data[loop].color=(*(min(1,c*value) for c in colour),1)
for idx,m in enumerate(mats):
 if idx in [5,6]:continue
 nodes=m.node_tree.nodes;vc=nodes.new('ShaderNodeVertexColor');vc.layer_name='Col';m.node_tree.links.new(vc.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
world=bpy.data.worlds.new('Night blue sanctuary');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.11,.20,.23,1);world.node_tree.nodes['Background'].inputs[1].default_value=.45;scene.world=world
for name,loc,power,col,size in [('Warm window',(-4,-3,6),1500,(1,.78,.52),5),('Apse rim',(2,5,6),2100,(.45,.78,1),5),('Face bounce',(0,-5,3),350,(1,.89,.7),4)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.color=col;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);rig.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,2,1))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('Editorial sanctuary');o=bpy.data.objects.new('Editorial sanctuary',d);rig.objects.link(o);o.location=(6,-9,5);o.rotation_euler=(Vector((0,4,1.6))-o.location).to_track_quat('-Z','Y').to_euler();d.lens=31;scene.camera=o
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ART/'sanctuary-v2-beauty.png')
exports=[]
for index,mat in enumerate(mats):
 bpy.ops.object.select_all(action='DESELECT');copies=[]
 for obj in list(source.objects):
  if obj.type!='MESH' or obj.data.materials[0]!=mat:continue
  c=obj.copy();c.data=obj.data.copy();export.objects.link(c);c.select_set(True);copies.append(c)
 if not copies:continue
 bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();o=bpy.context.object;o.name='TLL_SanctuaryV2_'+str(index);exports.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in exports:o.select_set(True)
file=OUT/'sanctuary-v2.glb'
bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_yup=True)
for o in exports:o.hide_render=True;o.hide_set(True)
bpy.ops.object.select_all(action='DESELECT');scene['description']='TLL Sanctuary V2 / original authored environment / baked vertex AO / original heroes unmodified'
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'sanctuary-v2.blend'));bpy.ops.render.render(write_still=True)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in exports)
receipt={'blender':bpy.app.version_string,'generator':str(Path(__file__).relative_to(ROOT)),'licence':'Original authored for TLL; no external models or textures','mesh_batches':len(exports),'materials':len(mats),'triangles':triangles,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'editable':str((ART/'sanctuary-v2.blend').relative_to(ROOT)),'source_object_count':len(source.objects),'hero_modified':False,'vertex_shading':'Per-face five-ray geometric occlusion with large-scale material variation'}
(OUT/'manifest.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8');print('SANCTUARY_RECEIPT '+json.dumps(receipt))
