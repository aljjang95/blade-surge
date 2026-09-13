"""Versioned solid Blender fittings for the shipped KayKit/Quaternius rigs.
Coordinates in recipes: x right, y up, z front, original GLB rest-world units.
The runtime binds named rigid parts to preserved deform bones and batches materials.
Never overwrites a master revision or the shipped source character.
"""
import argparse, hashlib, json, math, os, shutil, sys
import bpy
from mathutils import Vector
parser=argparse.ArgumentParser()
parser.add_argument('--masters',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
with open(os.path.join(ROOT,'tools/art/encounter-sources.json')) as f:sources=json.load(f)
for name,expected in sources.items():
 with open(os.path.join(ROOT,'public/models',name+'.glb'),'rb') as f:actual=hashlib.sha256(f.read()).hexdigest()
 if actual!=expected:raise RuntimeError('Reinspect changed rest-pose source: '+name)
if os.path.exists(args.masters) and os.listdir(args.masters): raise RuntimeError('Use a new empty master revision')
os.makedirs(args.masters,exist_ok=True);os.makedirs(args.output,exist_ok=True)
def xyz(p): return (p[0],-p[2],p[1])
def mat(name,color,metal=.45,rough=.48,emission=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
 p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emission: p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 return m
def mesh(name,vertices,faces,material,bone,bevel=0):
 me=bpy.data.meshes.new(name);me.from_pydata([xyz(p) for p in vertices],[],faces);me.update()
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(material);o['tllBone']=bone
 if bevel:
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
  mod=o.modifiers.new('Forged edge','BEVEL');mod.width=bevel;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def plate(name,points,depth,material,bone,bevel=.009):
 n=len(points);verts=[(x,y,z+d) for d in [-depth/2,depth/2] for x,y,z in points]
 faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh(name,verts,faces,material,bone,bevel)
def lathe(name,center,profile,material,bone,segments=24):
 verts=[(center[0]+r*math.cos(i*math.tau/segments),center[1]+h,center[2]+r*math.sin(i*math.tau/segments)) for r,h in profile for i in range(segments)]
 faces=[]
 for j in range(len(profile)-1):
  for i in range(segments):a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
 return mesh(name,verts,faces,material,bone)
def ball(name,p,scale,material,bone):
 bpy.ops.object.select_all(action='DESELECT');bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,location=xyz(p))
 o=bpy.context.object;o.name=name;o.scale=(scale[0],scale[2],scale[1]);o.data.materials.append(material);o['tllBone']=bone
 return o
def spike(name,a,b,r,material,bone,sides=6):
 start,end=Vector(xyz(a)),Vector(xyz(b));axis=end-start
 bpy.ops.object.select_all(action='DESELECT');bpy.ops.mesh.primitive_cone_add(vertices=sides,radius1=r,radius2=.003,depth=axis.length,location=(start+end)/2)
 o=bpy.context.object;o.name=name;o.rotation_euler=axis.to_track_quat('Z','Y').to_euler();o.data.materials.append(material);o['tllBone']=bone
 return o
def ring(name,p,r,width,height,material,bone):
 return lathe(name,p,[(r-width,0),(r,0),(r,height),(r-width,height),(r-width,0)],material,bone)
def bell(name,p,r,h,material,bone):
 profile=[(r,0),(r*.98,h*.12),(r*.73,h*.25),(r*.56,h*.72),(r*.23,h),(r*.12,h),(r*.4,h*.7),(r*.58,h*.25),(r*.85,h*.08),(r*.85,0),(r,0)]
 lathe(name,p,profile,material,bone);ball(name+' clapper',(p[0],p[1]+h*.12,p[2]),(r*.17,r*.2,r*.17),material,bone)
def crown(material,glow,kind='bell'):
 ring('Crown band',(0,2.025,0),.47,.055,.09,material,'head')
 for i in range(7):
  a=i*math.tau/7;r=.445;x,z=r*math.sin(a),r*math.cos(a)
  spike('Crown spire',(x,2.09,z),(x*1.08,2.41+(i%2)*.07,z*1.08),.083,material,'head')
  ball('Crown inlay',(x*1.065,2.105,z*1.065),(.034,.044,.034),glow,'head')
def make_bell():
 bronze=mat('bronze_metal',(.32,.185,.063),.72,.48);dark=mat('patina_metal',(.032,.10,.085),.48,.66)
 glow=mat('jade_glow',(.04,.72,.46),.15,.38,1.4)
 crown(bronze,glow)
 for side,bone in [(-1,'upperarm.r'),(1,'upperarm.l')]:
  bell('Bell pauldron',(side*.36,.96,-.025),.235,.33,bronze,bone)
  ring('Pauldron engraving',(side*.36,.967,-.025),.231,.016,.026,dark,bone)
  ball('Resonant seal',(side*.36,1.10,.182),(.060,.073,.025),glow,bone)
 plate('Breast reliquary',[(-.17,1.13,.44),(.17,1.13,.44),(.20,.78,.40),(0,.67,.36),(-.20,.78,.40)],.06,bronze,'chest')
 plate('Breast jade',[(-.047,.99,.475),(0,1.055,.475),(.047,.99,.475),(0,.89,.455)],.025,glow,'chest')
 for side in [-1,1]:
  plate('Ceremonial skirt',[(side*.04,.58,.22),(side*.23,.58,.17),(side*.28,.29,.23),(side*.07,.25,.29)],.04,dark,'hips')
  bell('Belt chime',(side*.14,.39,.285),.058,.13,bronze,'hips')
 ring('Waist girdle',(0,.54,0),.28,.035,.08,bronze,'hips')
 bell('Great back bell',(0,.72,-.38),.31,.59,bronze,'chest')
 return 'bell-king-v1'
def make_forge():
 iron=mat('kiln_stone',(.035,.046,.060),.35,.71);brass=mat('copper_metal',(.43,.19,.062),.68,.44)
 fire=mat('ember_glow',(1,.135,.012),.1,.4,2.0)
 ball('Furnace cuirass',(0,1.20,.52),(.52,.57,.18),iron,'Torso')
 ball('Furnace opening',(0,1.22,.71),(.30,.34,.035),brass,'Torso')
 ball('Burning chamber',(0,1.22,.75),(.22,.26,.04),fire,'Torso')
 for x in [-.14,0,.14]:
  plate('Fire grille',[(x-.022,.98,.80),(x+.022,.98,.80),(x+.022,1.46,.80),(x-.022,1.46,.80)],.04,iron,'Torso')
 for s,b in [(-1,'UpperArm.R'),(1,'UpperArm.L')]:
  ball('Kiln pauldron',(s*.62,1.51,-.06),(.39,.26,.37),iron,b)
  for i in range(3):spike('Vent fin',(s*(.53+i*.13),1.6,-.06),(s*(.58+i*.15),1.93-i*.07,-.10),.095,brass,b)
  lathe('Chimney',(s*.30,1.72,-.57),[(.19,0),(.17,.70),(.22,.75),(.22,.84),(.13,.84),(.13,.72),(.11,.08),(.19,0)],iron,'Torso',16)
  ring('Hot chimney rim',(s*.30,2.50,-.57),.215,.042,.05,fire,'Torso')
  plate('Shin forge',[(s*.18,.45,.12),(s*.48,.45,.12),(s*.45,.10,.18),(s*.23,.10,.18)],.07,brass,'LowerLeg.'+('R' if s<0 else 'L'))
 return 'kiln-tyrant-v1'
def make_frost():
 ice=mat('frost_metal',(.22,.58,.72),.12,.37);silver=mat('silver_metal',(.48,.64,.72),.68,.4)
 blue=mat('rune_glow',(.18,.65,1),.0,.5,1.25)
 for i in range(7):
  a=math.pi*(i/6-.5);x=.43*math.sin(a);z=-.02-.29*math.cos(a)
  spike('Frozen crown',(x,2.48,z),(x*1.5,2.92+(.15 if i%2 else 0),z-.1),.125,ice,'Head')
 for s,b in [(-1,'UpperArm.R'),(1,'UpperArm.L')]:
  ball('Ice mantle',(s*.58,1.56,.03),(.31,.20,.33),silver,b)
  for i in range(3):spike('Shoulder ice',(s*(.50+i*.14),1.67,-.08),(s*(.59+i*.22),2.02-i*.07,-.16),.125,ice,b)
  # Solid book covers, page block and spine; a readable scholar silhouette.
  x=s*.99
  plate('Frozen tome cover',[(x-.18,.96,.15),(x+.18,.96,.15),(x+.18,.51,.17),(x-.18,.51,.17)],.17,ice,'LowerArm.'+('R' if s<0 else 'L'))
  plate('Tome seal',[(x-.048,.83,.252),(x+.048,.83,.252),(x+.048,.65,.267),(x-.048,.65,.267)],.015,blue,'LowerArm.'+('R' if s<0 else 'L'))
 for i in range(3):
  y=1.4-i*.15
  plate('Archive breast rune',[(-.075,y,.685),(0,y+.07,.69),(.075,y,.685),(0,y-.07,.69)],.035,blue,'Torso')
 plate('Archive tablet',[(-.22,1.52,.645),(.22,1.52,.645),(.22,.95,.645),(-.22,.95,.645)],.035,ice,'Torso')
 return 'archive-monarch-v1'
def make_tide():
 coral=mat('coral_stone',(.18,.48,.49),.16,.63);shell=mat('pearl_metal',(.52,.71,.65),.38,.44)
 glow=mat('ocean_glow',(.05,.55,.78),.1,.45,1.2)
 for s in [-1,1]:
  a=(s*.38,2.60,.02);b=(s*.62,3.00,-.04);c=(s*.80,3.34,-.10)
  spike('Antler trunk',a,c,.15,coral,'Head');spike('Antler fork',b,(s*1.04,3.15,.02),.085,coral,'Head')
  spike('Antler tine',b,(s*.40,3.27,.02),.07,shell,'Head')
  for i in range(3):
   x=s*(.44+i*.20)
   plate('Tidal wing shell',[(x-s*.14,2.02,-.31),(x+s*.17,2.10,-.33),(x+s*.20,1.68,-.24),(x,1.55,-.22)],.07,shell,'Wing1.'+('R' if s<0 else 'L'))
  ball('Sea pearl',(s*.35,2.68,.34),(.075,.075,.065),glow,'Head')
 plate('Abyss breastplate',[(-.37,1.73,.26),(0,1.88,.46),(.37,1.73,.26),(.27,1.2,.44),(0,1.04,.51),(-.27,1.2,.44)],.07,coral,'Torso')
 for i in range(3):
  y=1.61-i*.16;plate('Abyss scale',[(-.18,y,.49),(0,y+.05,.57),(.18,y,.49),(0,y-.13,.57)],.05,shell,'Torso')
 return 'abyss-regent-v1'
def make_crown():
 gold=mat('eclipse_metal',(.48,.31,.075),.75,.38);void=mat('void_stone',(.019,.026,.047),.2,.77)
 star=mat('star_glow',(.72,.42,1),.1,.4,1.2)
 # Open-sided mask retains the original skull silhouette; the star aperture is a void inset.
 for s in [-1,1]:
  plate('Sun mask',[(s*.14,2.16,.32),(s*.39,2.03,.35),(s*.36,1.44,.30),(s*.26,1.50,.43),(s*.28,1.88,.47),(s*.11,1.95,.44)],.06,gold,'head')
  spike('Solar horn',(s*.34,2.03,.05),(s*.68,2.48,-.12),.13,gold,'head')
  spike('Shoulder ray',(s*.31,1.13,-.08),(s*.75,1.36,-.18),.14,gold,'upperarm.'+('r' if s<0 else 'l'))
  plate('Royal mantle',[(s*.17,1.22,-.25),(s*.50,1.09,-.30),(s*.50,.42,-.32),(s*.19,.34,-.39)],.045,void,'chest')
 plate('Crown breastplate',[(-.24,1.20,.47),(.24,1.20,.47),(.26,.74,.41),(0,.59,.39),(-.26,.74,.41)],.075,gold,'chest')
 plate('Void heart',[(-.12,.95,.515),(0,1.13,.525),(.12,.95,.515),(0,.77,.49)],.025,void,'chest')
 ball('Eclipse eye',(0,1.81,.47),(.037,.13,.028),star,'head')
 ring('Orbit diadem',(0,2.29,0),.48,.035,.038,gold,'head')
 return 'hollow-regent-v1'
def make_homecoming():
 ivory=mat('oath_metal',(.64,.65,.59),.42,.62);dark=mat('worn_metal',(.13,.20,.20),.55,.67)
 green=mat('oath_glow',(.20,.70,.50),.05,.45,1.0)
 for s in [-1,1]:
  plate('Broken visor',[(s*.045,2.17,.30),(s*.38,2.05,.30),(s*.38,1.69,.35),(s*.27,1.72,.39),(s*.20,1.93,.42)],.075,ivory,'head')
  plate('Oath pauldron',[(s*.21,1.26,.14),(s*.52,1.25,.12),(s*.65,1.03,.19),(s*.28,.98,.21)],.16,ivory,'upperarm.'+('r' if s<0 else 'l'))
  plate('Return tabard',[(s*.04,.64,.27),(s*.24,.64,.22),(s*.24,.16,.31),(s*.10,.22,.34)],.032,ivory,'hips')
 plate('High broken crest',[(-.075,2.07,.02),(.075,2.07,.02),(.06,2.48,-.03),(-.02,2.63,-.03),(-.06,2.30,.02)],.13,dark,'head')
 plate('Split oath plate',[(-.22,1.20,.48),(.24,1.20,.48),(.19,.71,.44),(-.23,.71,.44)],.055,ivory,'chest')
 plate('Visible fracture',[(-.02,1.20,.515),(.028,1.20,.515),(.075,1.04,.50),(.02,.94,.493),(.07,.71,.475),(.025,.71,.475),(-.025,.96,.493),(.025,1.04,.50)],.008,dark,'chest',0)
 ball('Oath seal',(-.13,1.09,.515),(.037,.067,.025),green,'chest')
 return 'oath-remnant-v1'
receipts=[]
for author in [make_bell,make_forge,make_frost,make_tide,make_crown,make_homecoming]:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 name=author()
 blend=os.path.join(args.masters,name+'.blend');bpy.ops.wm.save_as_mainfile(filepath=blend)
 output=os.path.join(args.output,name+'.glb')
 bpy.ops.export_scene.gltf(filepath=output,export_format='GLB',export_extras=True,export_animations=False)
 shutil.copyfile(output,os.path.join(args.masters,name+'.glb'))
 receipts.append({'id':name,'blender':bpy.app.version_string,'blend':os.path.abspath(blend),'blendSha256':hashlib.sha256(open(blend,'rb').read()).hexdigest(),'glbSha256':hashlib.sha256(open(output,'rb').read()).hexdigest(),'bytes':os.path.getsize(output),'objects':len([o for o in bpy.data.objects if o.type=='MESH'])})
with open(os.path.join(args.masters,'receipt.json'),'w') as f:json.dump(receipts,f,indent=2)
print(json.dumps(receipts))
