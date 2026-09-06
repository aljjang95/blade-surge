"""TLL Oathbound v1: separately authored fittings; original faces and rig retained.
Coordinates use x/right, y/up, z/front; converted to Blender at construction.
"""
import bpy, math, os, json, sys, argparse, hashlib
from mathutils import Vector
parser=argparse.ArgumentParser()
parser.add_argument('--masters',required=True,help='Directory for editable Blender masters')
parser.add_argument('--output',default=os.path.abspath(os.path.join(os.path.dirname(__file__),'../../public/models/tll')))
parser.add_argument('--casual',action='store_true',help='Rounded matte casual-v2 appearance')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
BASE=os.path.abspath(args.masters);OUT=os.path.abspath(args.output)
if os.path.exists(BASE) and os.listdir(BASE):
 raise FileExistsError('Use a new empty masters revision directory; existing editable work is preserved.')
os.makedirs(BASE,exist_ok=True)
os.makedirs(OUT,exist_ok=True)
with open(os.path.join(os.path.dirname(__file__),'head-profiles.json')) as profile_file:HEAD_PROFILES=json.load(profile_file)
for model_name in ['Knight','Barbarian','Mage']:
 source_path=os.path.abspath(os.path.join(os.path.dirname(__file__),'../../public/models',model_name+'.glb'))
 with open(source_path,'rb') as source_file:source_sha=hashlib.sha256(source_file.read()).hexdigest()
 if source_sha!=HEAD_PROFILES[model_name.lower()]['sourceSha256']:raise ValueError('Head profile source has changed; measure the new source first.')
def v(p): return (p[0],-p[2],p[1])
def material(name,c,metal=0,rough=.5):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*c,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough
 return m
def mesh(name,verts,faces,mat,bone='head',bevel=0):
 me=bpy.data.meshes.new(name);me.from_pydata([v(p) for p in verts],[],faces);me.update()
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(mat);o['tllBone']=bone
 if bevel:
  mod=o.modifiers.new('Forged edge','BEVEL');mod.width=bevel;mod.segments=2
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def plate(name,points,depth,mat,bone='head',bevel=.008):
 # Front polygon, with real side walls and a bevel to catch light.
 if sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))<0: points=list(reversed(points))
 verts=points+[(x,y,z-depth) for x,y,z in points];n=len(points)
 faces=[tuple(range(n)),tuple(range(n,2*n))[::-1]]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return mesh(name,verts,faces,mat,bone,bevel)
def ellipsoid(name,p,s,mat,bone='head',segments=24,rings=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=v(p))
 o=bpy.context.object;o.name=name;o.scale=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 o.data.materials.append(mat);o['tllBone']=bone
 for poly in o.data.polygons:poly.use_smooth=True
 return o
def strip(name,centers,widths,mat,bone='head'):
 verts=[]
 for (x,y,z),w in zip(centers,widths): verts.extend([(x-w,y,z),(x,y+.016,z+.02),(x+w,y,z)])
 faces=[]
 for i in range(len(centers)-1):
  for j in range(2):a=i*3+j;faces.append((a+3,a+4,a+1,a))
 o=mesh(name,verts,faces,mat,bone);mod=o.modifiers.new('Leather thickness','SOLIDIFY');mod.thickness=.018
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def hairlock(name,controls,width,mat):
 verts=[];rings=14;sides=8
 for i in range(rings):
  t=i/(rings-1);u=1-t
  p=Vector(controls[0])*u**3+Vector(controls[1])*3*u*u*t+Vector(controls[2])*3*u*t*t+Vector(controls[3])*t**3
  tangent=(Vector(controls[1])-Vector(controls[0]))*3*u*u+(Vector(controls[2])-Vector(controls[1]))*6*u*t+(Vector(controls[3])-Vector(controls[2]))*3*t*t
  tangent.normalize();a=Vector((1,0,0));b=tangent.cross(a).normalized();w=width*(1-t**3)+.002
  for j in range(sides):
   q=p+a*(math.cos(j*2*math.pi/sides)*w)+b*(math.sin(j*2*math.pi/sides)*w*.45);verts.append(tuple(q))
 faces=[]
 for i in range(rings-1):
  for j in range(sides):a=i*sides+j;b=i*sides+(j+1)%sides;faces.append((a,b,b+sides,a+sides))
 o=mesh(name,verts,faces,mat)
 for poly in o.data.polygons:poly.use_smooth=True
 return o
def band(name,y,rx,rz,height,mat,profile=None):
 verts=[];faces=[];n=48
 for row,(radius,dy) in enumerate([(1,-height/2),(1,height/2),(.93,height/2),(.93,-height/2)]):
  for i in range(n):
   a=2*math.pi*i/n
   if profile:
    x,z=profile['bottom' if row in (0,3) else 'top'][i];r=math.hypot(x,z);padding=.012 if row<2 else -.007
    verts.append((x*(r+padding)/r,y+dy,z*(r+padding)/r))
   else:verts.append((math.sin(a)*rx*radius,y+dy,math.cos(a)*rz*radius))
 for row in range(4):
  for i in range(n):a=row*n+i;b=row*n+(i+1)%n;c=((row+1)%4)*n+(i+1)%n;d=((row+1)%4)*n+i;faces.append((a,b,c,d))
 return mesh(name,verts,faces,mat,'head',.004)
def fitted_headwear(hero,steel,ivory,brass,cloth,hair,gem):
 # Bound to measured original face bounds (x ~ +/- .54, top 2.19--2.31).
 if hero=='knight':
  band('Continuous coronet',2.16,.45,.48,.105,brass,HEAD_PROFILES[hero])
  plate('Ivory oath crest',[(-.14,2.12,.488),(0,2.43,.488),(.14,2.12,.488)],.035,ivory,bevel=.012)
  for s in [-1,1]:
   plate('Attached crown wing',[(s*.405,2.12,-.045),(s*.44,2.23,-.03),(s*.60,2.43,-.24),(s*.55,2.12,-.27)],.085,ivory,bevel=.012)
 elif hero=='barbarian':
  band('War circlet',2.075,.392,.392,.095,steel,HEAD_PROFILES[hero])
  plate('War circlet clasp',[(-.10,2.02,.40),(-.075,2.13,.40),(.075,2.13,.40),(.10,2.02,.40)],.02,brass,bevel=.008)
  profile=[(2.08,.23),(2.30,.15),(2.39,-.03),(2.31,-.30),(2.06,-.47)]
  verts=[(x,y,z) for x in [-.07,.07] for y,z in profile];n=len(profile)
  faces=[tuple(range(n))[::-1],tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  mesh('Attached crimson crest',verts,faces,cloth,'head',.025)
  for s in [-1,1]:hairlock('Side war braid',[(s*.38,2.055,-.08),(s*.52,1.87,-.08),(s*.54,1.50,-.05),(s*.48,1.30,.02)],.06,hair)
 elif hero=='mage':
  band('Astral circlet',2.065,.38,.39,.065,brass,HEAD_PROFILES[hero])
  plate('Joined star setting',[(0,2.035,.407),(-.115,2.16,.407),(0,2.385,.407),(.115,2.16,.407)],.03,brass,bevel=.009)
  plate('Set astral stone',[(0,2.08,.442),(-.075,2.17,.442),(0,2.32,.442),(.075,2.17,.442)],.022,gem,bevel=.007)
 else:
  # One continuous cap and rear shell; the lower front is deliberately open for the face.
  levels=[(2.36,.02,.02),(2.32,.29,.28),(2.20,.52,.47),(2.04,.60,.55),(1.62,.61,.55),(1.24,.52,.46)]
  verts=[];faces=[];n=48
  for y,rx,rz in levels:
   for i in range(n):a=2*math.pi*i/n;verts.append((math.sin(a)*rx,y,math.cos(a)*rz-.045))
  for row in range(len(levels)-1):
   for i in range(n):
    a=(i+.5)*2*math.pi/n
    if row>=2 and math.cos(a)>.38:continue
    k=row*n+i;j=row*n+(i+1)%n;faces.append((k+n,j+n,j,k))
  shell=mesh('Continuous shadow hood',verts,faces,cloth)
  mod=shell.modifiers.new('Hood thickness','SOLIDIFY');mod.thickness=.025
  bpy.context.view_layer.objects.active=shell;bpy.ops.object.modifier_apply(modifier=mod.name)
  for p in shell.data.polygons:p.use_smooth=True
  plate('Cloth half mask',[(-.44,1.54,.28),(0,1.48,.56),(.44,1.54,.28),(.34,1.30,.32),(0,1.245,.49),(-.34,1.30,.32)],.024,cloth,bevel=.008)
  for s in [-1,1]:
   plate('Mask side wrap',[(s*.44,1.54,.28),(s*.52,1.55,-.03),(s*.52,1.40,-.03),(s*.43,1.40,.27)],.012,cloth,bevel=.004)
  plate('Mask oath mark',[(0,1.47,.579),(.03,1.40,.566),(0,1.31,.535),(-.03,1.40,.566)],.007,brass,bevel=.003)
for hero in ['knight','barbarian','mage','rogue']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 skin=material('Warm porcelain' if hero=='mage' else 'Skin',(.58,.35,.24) if hero=='barbarian' else (.76,.54,.41),0,.8)
 steel=material('Oath blackened steel',(.055,.085,.105),.7,.32)
 ivory=material('Ivory enamel',(.73,.71,.59),.45,.3)
 brass=material('Brushed pale gold',(.57,.36,.12),.78,.27)
 cloth=material('Woven mantle',{'knight':(.035,.16,.18),'barbarian':(.23,.045,.026),'mage':(.035,.08,.22),'rogue':(.05,.025,.085)}[hero],0,.95)
 hair=material('Hair',{'knight':(.52,.49,.4),'barbarian':(.5,.48,.41),'mage':(.035,.027,.021),'rogue':(.46,.16,.075)}[hero],.05,.62)
 dark=material('Lash and pupil',(.012,.016,.02),0,.8)
 eye=material('Eye',(.71,.69,.58),0,.36)
 gem=material('House gemstone',{'knight':(.03,.36,.33),'barbarian':(.43,.06,.02),'mage':(.075,.27,.65),'rogue':(.29,.075,.38)}[hero],.4,.2)
 if args.casual:
  palette=[(steel,(.18,.29,.34)),(ivory,(.88,.80,.60)),(brass,(.70,.43,.18)),(cloth,{'knight':(.20,.48,.39),'barbarian':(.56,.22,.12),'mage':(.27,.38,.65),'rogue':(.36,.23,.46)}[hero])]
  for mat,col in palette:
   mat.diffuse_color=(*col,1);bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*col,1);bs.inputs['Metallic'].default_value=0;bs.inputs['Roughness'].default_value=.85
  gem.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=0
 ellipsoid('Neck',(0,1.335,-.025),(.135,.19,.13),skin,'chest')
 ellipsoid('Padded torso',(0,.975,-.02),(.34 if hero=='barbarian' else .25 if hero=='rogue' else .28,.29,.22),skin if hero=='barbarian' else cloth,'chest')
 ellipsoid('Waist',(0,.715,-.015),(.25,.105,.19),steel,'hips')
 # Contoured head, with distinct chin/jaw/cheek/temple rings; no donor head.
 levels=[(1.39,.12,.14),(1.46,.23,.24),(1.59,.30,.28),(1.76,.33,.29),(1.92,.30,.25),(2.03,.20,.17),(2.065,.02,.03)]
 if hero=='barbarian':levels=[(y,rx*1.1,rz*1.06) for y,rx,rz in levels]
 if hero=='mage':levels=[(y,rx*.94,rz) for y,rx,rz in levels]
 verts=[];segments=24
 for y,rx,rz in levels:
  for i in range(segments):
   a=2*math.pi*i/segments;verts.append((math.sin(a)*rx,y,math.cos(a)*rz-.015))
 faces=[]
 for j in range(len(levels)-1):
  for i in range(segments):a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
 face=mesh('TLL_Face',verts,faces,skin)
 for p in face.data.polygons:p.use_smooth=True
 # Sculpted small wedge nose and an understated mouth.
 plate('Nose',[(-.046,1.72,.264),(.046,1.72,.264),(.052,1.60,.292),(0,1.585,.325),(-.052,1.60,.292)],.04,skin,bevel=.01)
 plate('Mouth',[(-.073,1.515,.252),(0,1.522,.268),(.073,1.515,.252),(0,1.505,.263)],.006,hair,bevel=.002)
 for side in [-1,1]:
  x=side*.135
  ellipsoid('Eye socket',(x,1.727,.249),(.083,.049,.031),dark,segments=24,rings=12)
  ellipsoid('Eye white',(x,1.727,.266),(.071,.039,.022),eye,segments=24,rings=12)
  ellipsoid('Iris',(x,1.725,.286),(.028,.033,.012),gem,segments=20,rings=12)
  ellipsoid('Pupil',(x,1.725,.296),(.014,.026,.006),dark,segments=16,rings=8)
  ellipsoid('Catchlight',(x-.009,1.740,.303),(.006,.007,.003),ivory,segments=12,rings=8)
  plate('Brow',[(x-.1,1.80,.249),(x+.075,1.784,.266),(x+.07,1.765,.268),(x-.097,1.778,.255)],.012,hair,bevel=.003)
  ellipsoid('Ear',(side*.309,1.65,-.01),(.054,.088,.045),skin,segments=12,rings=8)
 # Hair is a fitted swept cap with layered tapered locks.
 ellipsoid('Hair crown',(0,1.905,-.06),(.335,.202,.285),hair,segments=24,rings=12)
 for i in range(-2,3):
  x=i*.105
  hairlock('Sculpted swept lock',[(x-.075,2.015,.08),(x-.04,2.095,.26),(x+.055,1.985,.325),(x+.13,1.79+abs(i)*.04,.28)],.074,hair)
 # Articulated sleeves, gloves and greaves use the same joint pivots as combat.
 for s,side in [(1,'l'),(-1,'r')]:
  ellipsoid('Upper sleeve',(s*.33,1.10,0),(.17,.17,.17) if hero=='barbarian' else (.15,.12,.12),skin if hero=='barbarian' else cloth,'upperarm.'+side)
  ellipsoid('Forearm bracer',(s*.59,1.10,0),(.145,.112,.115),steel,'lowerarm.'+side)
  ellipsoid('Glove',(s*.80,1.085,.02),(.095,.10,.10),steel,'hand.'+side)
  ellipsoid('Thigh',(s*.17,.46,0),(.13,.14,.14),cloth,'upperleg.'+side)
  ellipsoid('Greave',(s*.17,.24,.015),(.135,.15,.14),steel,'lowerleg.'+side)
  ellipsoid('Sabatons',(s*.17,.085,.09),(.145,.08,.23),steel,'foot.'+side)
  plate('Greave inlay',[(s*.17-.035,.36,.143),(s*.17+.035,.36,.143),(s*.17+.025,.13,.16),(s*.17,.09,.185),(s*.17-.025,.13,.16)],.015,brass,'lowerleg.'+side,.004)
 # Torso armour is a shaped cuirass, kept out of elbow and hip deformation zones.
 if hero!='barbarian':plate('Cuirass',[(-.27,1.17,.19),(0,1.24,.255),(.27,1.17,.19),(.235,.83,.21),(0,.72,.27),(-.235,.83,.21)],.12,cloth if hero=='mage' else steel,'chest',.018)
 for side in [-1,1]:
  if hero=='knight':plate('Breastplate facet',[(side*.027,1.17,.279),(side*.237,1.125,.235),(side*.207,.92,.25),(side*.027,.84,.302)],.025,ivory,'chest',.008)
  # Signature split blade on breastplate.
  plate('Split blade',[(side*.018,1.17,.307),(side*.05,1.105,.311),(side*.043,.90,.329),(side*.018,.84,.322)],.014,brass,'chest',.003)
  # Layered pauldrons are rigid to the upper arm and remain small enough to swing.
  for layer in range(3 if hero=='knight' or (hero=='barbarian' and side==1) else 1):
   x=side*(.28+layer*.067); y=1.205-layer*.045
   plate('Laminated pauldron',[(x-side*.09,y+.08,.12),(x+side*.10,y+.055,.08),(x+side*.14,y-.1,.13),(x,y-.14,.20),(x-side*.09,y-.035,.19)],.21,brass if layer==0 else steel,'upperarm.'+('l' if side==1 else 'r'),.014)
 # Long split tabard replaces the source cape and breaks the toy silhouette.
 for side in [-1,1]:
  strip('Oath tabard',[(side*.11,.80,.235),(side*.135,.57,.24),(side*.18,.24,.18),(side*.17,.13,.13)],[.095,.10,.12,.075],cloth,'hips')
  strip('Tabard welt',[(side*.19,.79,.256),(side*.22,.57,.26),(side*.29,.24,.20),(side*.23,.15,.15)],[.012,.012,.012,.008],brass,'hips')
 # Bespoke head silhouettes for each unchanged character archetype.
 if hero=='knight':
  for s in [-1,1]:
   plate('Crown cheek',[(s*.26,1.93,.15),(s*.37,1.90,.08),(s*.345,1.52,.18),(s*.25,1.40,.20),(s*.255,1.65,.25)],.1,steel,bevel=.012)
   plate('Crown swept wing',[(s*.28,1.89,.07),(s*.49,2.18,-.16),(s*.43,1.78,-.12),(s*.32,1.66,.025)],.06,ivory,bevel=.01)
   strip('Crown edge',[(s*.28,1.9,.105),(s*.49,2.18,-.13),(s*.43,1.78,-.09)],[.014,.012,.012],brass)
  plate('Oath crown',[(-.28,1.93,.25),(-.09,1.99,.30),(0,2.13,.245),(.09,1.99,.30),(.28,1.93,.25),(.24,1.865,.29),(0,1.91,.324),(-.24,1.865,.29)],.055,ivory,bevel=.008)
 elif hero=='barbarian':
  strip('War harness',[(-.24,1.20,.22),(-.09,1.045,.27),(.08,.86,.28),(.23,.73,.21)],[.058,.054,.05,.06],steel,'chest')
  for s in [-1,1]:
   plate('Beard jaw',[(s*.27,1.62,.16),(s*.24,1.44,.24),(s*.06,1.31,.27),(s*.015,1.47,.3)],.06,hair,bevel=.012)
   strip('War braid',[(s*.3,1.82,.025),(s*.37,1.51,.035),(s*.38,1.23,.07)],[.06,.065,.018],hair)
   plate('Iron temple',[(s*.28,1.86,.18),(s*.33,1.98,.06),(s*.38,1.88,-.03),(s*.32,1.70,.11)],.035,brass,bevel=.006)
  strip('Crimson crest',[(0,1.94,.16),(0,2.15,.05),(0,2.11,-.25),(0,1.87,-.30)],[.11,.095,.08,.03],cloth)
 elif hero=='mage':
  # A full bell robe, rather than the knight's split armour panels.
  rv=[];rf=[];rn=32
  for y,r in [(.80,.24),(.58,.32),(.20,.43),(.12,.43)]:
   for i in range(rn):
    a=i*2*math.pi/rn;fold=1+.035*math.cos(a*8);rv.append((math.sin(a)*r*fold,y,math.cos(a)*r*.72*fold-.04))
  for j in range(3):
   for i in range(rn):a=j*rn+i;b=j*rn+(i+1)%rn;rf.append((a+rn,b+rn,b,a))
  mesh('Astral robe',rv,rf,cloth,'hips')
  plate('Astral chest stone',[(0,1.18,.31),(.10,1.065,.33),(0,.92,.335),(-.10,1.065,.33)],.045,gem,'chest')
  for s in [-1,1]:
   hairlock('Silver long hair',[(s*.28,1.96,-.015),(s*.40,1.72,-.07),(s*.39,1.3,-.13),(s*.29,1.10,-.05)],.12,hair)
   plate('Star diadem',[(s*.22,1.95,.245),(s*.37,2.23,.04),(s*.30,1.91,.135),(s*.25,1.82,.22)],.025,brass,bevel=.008)
  plate('Diadem star',[(0,2.14,.22),(.065,2.02,.285),(0,1.90,.31),(-.065,2.02,.285)],.05,gem)
 else:
  strip('Shadow baldric',[(-.24,1.18,.24),(-.08,1.05,.31),(.08,.9,.31),(.22,.75,.23)],[.048,.045,.042,.04],hair,'chest')
  # Angular hood over the back of the head and a half-mask across the jaw.
  for s in [-1,1]:
   plate('Hood blade',[(s*.04,2.13,-.13),(s*.37,2.03,.10),(s*.40,1.48,.05),(s*.29,1.35,.16),(s*.29,1.87,.27)],.15,cloth,bevel=.016)
  plate('Night half mask',[(-.27,1.63,.24),(0,1.59,.34),(.27,1.63,.24),(.20,1.43,.23),(0,1.36,.27),(-.20,1.43,.23)],.04,steel,bevel=.01)
  for s in [-1,1]: strip('Mask seam',[(s*.022,1.57,.358),(s*.08,1.45,.29),(s*.02,1.39,.30)],[.01,.009,.006],brass)
 # Retain the original face and construct fitted, connected headwear in measured coordinates.
 for o in list(bpy.data.objects):
  if o.type!='MESH':continue
  if o.get('tllBone')=='head':
   bpy.data.objects.remove(o,do_unlink=True)
 fitted_headwear(hero,steel,ivory,brass,cloth,hair,gem)
 if args.casual:
  removed=('Ivory oath crest','Attached crown wing','Attached crimson crest','War circlet clasp','Joined star setting','Set astral stone','Cuirass','Breastplate facet','Laminated pauldron','Astral chest stone','Mask oath mark')
  for o in list(bpy.data.objects):
   if any(o.name==name or o.name.startswith(name+'.') for name in removed):bpy.data.objects.remove(o,do_unlink=True)
  if hero=='knight':
   plate('Soft three-lobed crown',[(-.18,2.12,.49),(-.18,2.24,.49),(-.14,2.26,.49),(-.07,2.21,.49),(0,2.32,.49),(.07,2.21,.49),(.14,2.26,.49),(.18,2.24,.49),(.18,2.12,.49)],.04,brass,bevel=.025)
   for x,y in [(-.14,2.26),(0,2.32),(.14,2.26)]:ellipsoid('Crown rounded tip',(x,y,.49),(.035,.035,.025),brass)
  elif hero=='barbarian':
   ellipsoid('Round headband clasp',(0,2.075,.403),(.10,.065,.027),brass)
  elif hero=='mage':
   for i in range(5):
    a=i*2*math.pi/5;ellipsoid('Astral flower petal',(math.sin(a)*.072,2.13+math.cos(a)*.072,.415),(.052,.055,.022),ivory)
   ellipsoid('Astral flower center',(0,2.13,.445),(.043,.043,.02),gem)
  else:
   ellipsoid('Scarf button',(0,1.385,.54),(.027,.027,.012),brass)
  if hero!='barbarian':
   ellipsoid('Quilted jacket',(0,.98,-.005),(.29,.285,.23),cloth,'chest')
   ellipsoid('Soft chest patch',(0,1.025,.235),(.18,.195,.05),ivory if hero=='knight' else cloth,'chest')
  for s,side in [(1,'l'),(-1,'r')]:
   if hero=='barbarian' and s==-1:continue
   ellipsoid('Padded shoulder',(s*.29,1.15,0),(.17,.145,.17),ivory if hero=='knight' else cloth,'upperarm.'+side)
  if hero=='mage':ellipsoid('Robe brooch',(0,1.07,.297),(.06,.075,.025),gem,'chest')
  for o in bpy.data.objects:
   if o.type=='MESH' and o.name.startswith('Astral robe'):
    for poly in o.data.polygons:poly.use_smooth=True
 # Join by bone: the runtime binds these authored surfaces into one batched skin.
 groups={}
 for o in list(bpy.data.objects):
  if o.type=='MESH':groups.setdefault(o.get('tllBone','head'),[]).append(o)
 for bone,objects in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
  o=bpy.context.object;o.name='TLL_'+bone.replace('.','');o['tllBone']=bone
 version='casual-v2' if args.casual else 'oath-v1'
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE,hero+'-'+version+'.blend'))
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,hero+'-'+version+'.glb'),export_format='GLB',export_extras=True,export_animations=False)
 print('TLL_AUTHORED',hero)
