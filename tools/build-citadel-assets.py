"""Original Citadel hub geometry, authored and exported with Blender 5.2.1.

Run: source /workspace/.blade-surge-tools/env.sh
     "$BLENDER_BIN" --background --python-exit-code 1 --python tools/build-citadel-assets.py
GPT sheets are visual references, never represented as TRELLIS geometry.
"""
import bpy, json, math, hashlib, random, time, struct
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/citadel-hub-v1'
ART = ROOT / 'work/art/citadel-hub-v1'
REF = ROOT / 'docs/assets/citadel-hub-v1/reference-source'
OUT.mkdir(parents=True, exist_ok=True); ART.mkdir(parents=True, exist_ok=True)
# These two optional source recipes are retained below for future scene use,
# but their unreferenced exports are intentionally excluded from the public pack.
for retired in ('stairs.glb','stairs-lod1.glb','alchemy-counter.glb','alchemy-counter-lod1.glb'):
    stale=OUT/retired
    if stale.is_file():stale.unlink()
START = time.perf_counter()
random.seed(10203)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 12
scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
scene.world = bpy.data.worlds.new('Citadel studio world'); scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.35,.41,.49,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .55
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'

def rgb(h):
    v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return [((x+.055)/1.055)**2.4 if x>.04045 else x/12.92 for x in v]

def material(name, h, rough=.75, metal=0, emission=0):
    m=bpy.data.materials.new('Citadel '+name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); c=(*rgb(h),1)
    p.inputs['Base Color'].default_value=c; m.diffuse_color=c
    p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    if emission:
        p.inputs['Emission Color'].default_value=c; p.inputs['Emission Strength'].default_value=emission
    m['authorship']='Original Blender material / Citadel hub v1'
    return m

M={
 'stone':material('blue slate limestone','536870',.83),
 'ivory':material('warm carved ivory','CECFB7',.78),
 'gold':material('aged brushed brass','BD9957',.48,.7),
 'teal':material('woven teal wool','2D646C',.92),
 'leather':material('saddle brown leather','74503B',.82),
 'skin':material('merchant warm skin','C38C67',.9),
 'skin2':material('trainer warm skin','D8A888',.89),
 'skin3':material('steward dark skin','775345',.9),
 'hair':material('salt and pepper hair','514B46',.92),
 'hair2':material('trainer silver hair','B4AEA1',.94),
 'dark':material('deep navy undercloth','23383F',.9),
 'eyes':material('dark expressive eyes','202A2E',.48),
 'green':material('cut leaf glass','60B696',.32,.18,.12),
 'ember':material('amber furnace stone','DC8145',.42,.1,.2),
 'blue':material('frosted blue glass','72A7C8',.3,.2,.15),
 'violet':material('polished mirage glass','A47CBD',.35,.16,.12),
 'foliage':material('living garden sage','688964',.93),
}

# Bake portable micro-surface detail in Blender. Procedural shaders alone are
# not supported by glTF: each shared tile has a real base-color and normal map.
def bake_surface(key, kind):
    m=M[key]; nodes=m.node_tree.nodes; links=m.node_tree.links; p=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexCoord'); noise=nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=45 if kind=='cloth' else 12
    noise.inputs['Detail'].default_value=2; noise.inputs['Roughness'].default_value=.72
    links.new(tex.outputs['UV'],noise.inputs['Vector'])
    mix=nodes.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'
    mix.inputs[1].default_value=p.inputs['Base Color'].default_value[:]
    mix.inputs[2].default_value=(.52,.52,.52,1)
    links.new(noise.outputs['Fac'],mix.inputs[0]); links.new(mix.outputs[0],p.inputs['Base Color'])
    bump=nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.15 if kind=='cloth' else .23
    bump.inputs['Distance'].default_value=.015 if kind=='cloth' else .028
    links.new(noise.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs['Normal'],p.inputs['Normal'])
    bpy.ops.mesh.primitive_plane_add(size=2)
    plane=bpy.context.object; plane.name='BAKE_ONLY'; plane.data.materials.append(m)
    for bake_type in ('DIFFUSE','NORMAL'):
        img=bpy.data.images.new('Citadel '+key+' '+bake_type,256,256)
        if bake_type=='NORMAL': img.colorspace_settings.name='Non-Color'
        target=nodes.new('ShaderNodeTexImage'); target.image=img; nodes.active=target
        scene.cycles.samples=4
        bpy.ops.object.bake(type=bake_type,pass_filter={'COLOR'} if bake_type=='DIFFUSE' else set(),margin=4)
        img.filepath_raw=str(ART/(key+'-'+bake_type.lower()+'.png')); img.file_format='PNG'; img.save(); img.pack()
        if bake_type=='DIFFUSE': base_img=img
        else: normal_img=img
        nodes.remove(target)
    bpy.data.objects.remove(plane,do_unlink=True)
    for n in [tex,noise,mix,bump]: nodes.remove(n)
    tx=nodes.new('ShaderNodeTexImage'); tx.image=base_img; links.new(tx.outputs['Color'],p.inputs['Base Color'])
    nm=nodes.new('ShaderNodeTexImage'); nm.image=normal_img
    ns=nodes.new('ShaderNodeNormalMap'); ns.inputs['Strength'].default_value=.55
    links.new(nm.outputs['Color'],ns.inputs['Color']); links.new(ns.outputs['Normal'],p.inputs['Normal'])

for k,kind in [('stone','stone'),('ivory','stone'),('teal','cloth'),('leather','leather')]:
    bake_surface(k,kind)
scene.cycles.samples=12

def root(name,role):
    o=bpy.data.objects.new(name,None); scene.collection.objects.link(o)
    o['citadelVersion']='citadel-hub-v1'; o['role']=role
    o['authorship']='Original Blender authored; GPT visual development; TRELLIS unavailable'
    o['units']='metres'; o['runtimeForward']='+Z'; return o

active_root=None
def finish(o,name,mat,smooth=False):
    o.name=name; o.parent=active_root; o.data.materials.append(M[mat] if isinstance(mat,str) else mat)
    if smooth:
        for f in o.data.polygons:f.use_smooth=True
    return o

def bevel(o,amount=.025):
    if amount:
        b=o.modifiers.new('Carved edge radius','BEVEL'); b.width=amount; b.segments=1
        bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=b.name)
    return o

def box(name,p,size,mat,b=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p); o=finish(bpy.context.object,name,mat)
    o.scale=size; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return bevel(o,b)

def mesh(name,verts,faces,mat,smooth=False):
    d=bpy.data.meshes.new(name); d.from_pydata(verts,[],faces);d.update()
    o=bpy.data.objects.new(name,d); scene.collection.objects.link(o)
    return finish(o,name,mat,smooth)

def sphere(name,p,size,mat,n=16,r=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=n,ring_count=r,radius=1,location=p)
    o=finish(bpy.context.object,name,mat,True);o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return o

def cyl(name,p,r,d,mat,n=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=d,location=p)
    return finish(bpy.context.object,name,mat)

def cone(name,p,r1,r2,d,mat,n=12):
    bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r1,radius2=r2,depth=d,location=p)
    return finish(bpy.context.object,name,mat)

def rod(name,a,b,r,mat,n=8,r2=None):
    a,b=Vector(a),Vector(b);d=b-a
    o=cone(name,(a+b)/2,r,r if r2 is None else r2,d.length,mat,n)
    o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o

def curve(name,points,r,mat,n=8):
    for i,(a,b) in enumerate(zip(points,points[1:])):rod(name+'_%02d'%i,a,b,r,mat,n)

def ring(name,p,R,r,mat,n=28,rot=(math.pi/2,0,0),arc=math.tau):
    verts=[];faces=[];steps=n if arc==math.tau else n+1
    for i in range(steps):
        a=arc*i/n
        for j in range(6):
            b=math.tau*j/6; verts.append(((R+r*math.cos(b))*math.cos(a), (R+r*math.cos(b))*math.sin(a), r*math.sin(b)))
    for i in range(n):
        ni=(i+1)%steps
        for j in range(6):faces.append((i*6+j,ni*6+j,ni*6+(j+1)%6,i*6+(j+1)%6))
    o=mesh(name,verts,faces,mat,True);o.location=p;o.rotation_euler=rot;return o

def profile(name,rings,mat,n=20,start=0,end=math.tau,caps=True,smooth=True):
    verts=[];faces=[];open=end-start<math.tau-.01;nn=n+1 if open else n
    for z,rx,ry,cx,cy in rings:
        for i in range(nn):
            a=start+(end-start)*i/n;verts.append((cx+rx*math.cos(a),cy+ry*math.sin(a),z))
    for k in range(len(rings)-1):
        for i in range(n):faces.append((k*nn+i,k*nn+(i+1)%nn,(k+1)*nn+(i+1)%nn,(k+1)*nn+i))
    if caps and not open:faces.extend([tuple(reversed(range(nn))),tuple((len(rings)-1)*nn+i for i in range(nn))])
    o=mesh(name,verts,faces,mat,smooth)
    if open:
        s=o.modifiers.new('Tailored garment thickness','SOLIDIFY');s.thickness=.012
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=s.name)
    return o

def leaf(name,p,size,mat,rotate=0):
    # Convex raised sculpted leaf or glass diamond, not a flat plane.
    w,h,d=size;x,y,z=p
    verts=[(-w/2,0,0),(0,0,h/2),(w/2,0,0),(0,0,-h/2),(0,-d,0),(0,d*.35,0)]
    o=mesh(name,verts,[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(1,0,5),(2,1,5),(3,2,5),(0,3,5)],mat)
    o.location=p;o.rotation_euler.y=rotate;return o

def star(name,p,r,mat,points=5):
    vs=[]
    for i in range(points*2):
        a=math.pi/2+math.tau*i/(points*2);R=r if i%2==0 else r*.42
        vs.append((math.cos(a)*R,-.08,math.sin(a)*R))
    vs.append((0,-.15,0));faces=[(i,(i+1)%(points*2),points*2) for i in range(points*2)]
    o=mesh(name,vs,faces,mat);o.location=p;return o

def arch_block(name,a,b,Rin,Rout,z,mat):
    vs=[]
    for y in (-.23,.23):
        for R,A in [(Rin,a),(Rout,a),(Rout,b),(Rin,b)]:vs.append((R*math.cos(A),y,z+R*math.sin(A)))
    o=mesh(name,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)
    return bevel(o,.01)

ROUTES=[
 ('glass_garden','leaf','green'),('ember_vault','furnace','ember'),('star_archive','book','blue'),
 ('bellfall_crypt','bell','green'),('cinder_tide_lock','wheel','ember'),('nightglass_observatory','scope','blue'),
 ('eclipse_hydra_vault','hydra','green'),('ashforge_catacomb','hammers','ember'),('astral_leviathan_spire','spire','blue'),
 ('verdigris_sanctum','root','green'),('sable_mirage_basin','mirror','violet'),('comet_bastion','comet','blue')]

def hammer(name,p,angle):
    o=rod(name+' haft',(-.31,-.34,2.88),(.31,-.34,3.29),.035,'leather')
    o.rotation_euler.y+=angle
    head=box(name+' hammer head',p,(.31,.16,.14),'gold',.025);head.rotation_euler.y=angle

def emblem(motif,accent):
    y=-.31
    if motif in ('leaf','root'):
        leaf('Leaf crown',(0,y,3.08),(.43,.56,.1),accent)
        rod('Leaf midrib',(0,y-.11,2.87),(0,y-.11,3.32),.015,'gold')
        for s in (-1,1):
            leaf('Side leaf',(s*.21,y,3),(.18,.32,.055),'gold',s*.45)
        if motif=='root':
            for s in (-1,1):
                curve('Living root buttress',[(s*1.28,-.31,.14),(s*1.12,-.34,.74),(s*1.34,-.31,1.24),(s*1.18,-.31,1.87),(s*.89,-.32,2.37),(s*.33,-.34,2.96)],.056,'leather')
                for z in (.54,1.34,2.04):leaf('Root foliage',(s*1.3,y-.04,z),(.12,.2,.06),'foliage',s*.4)
    elif motif=='furnace':
        box('Furnace crown plate',(0,-.29,3.09),(.43,.18,.5),'gold',.035)
        leaf('Furnace coal',(0,-.40,3.08),(.19,.28,.05),accent)
        for s in (-1,1):
            cone('Brazier bowl',(s*1.31,-.13,2.23),.12,.2,.18,'gold')
            leaf('Sculpted ember',(s*1.31,-.14,2.43),(.19,.34,.05),accent,s*.15)
        for a in range(5):
            A=.35+a*.61;arch_block('Amber arch recess',A,A+.33,1.01,1.115,1.86,accent)
    elif motif=='book':
        for s in (-1,1):
            o=box('Open book pages',(s*.18,-.28,3.14),(.35,.21,.22),'ivory',.01);o.rotation_euler.y=s*-.18
            for j in range(4):rod('Raised page lines',(s*.03,-.396,3.1+j*.035),(s*.32,-.396,3.14+j*.035),.006,'gold',6)
        ring('Astrolabe',(0,-.38,2.93),.30,.015,'gold',24);star('Archive star',(0,-.43,2.94),.23,'gold')
    elif motif=='bell':
        rod('Bell hanger',(0,-.12,2.99),(0,-.12,2.76),.045,'gold')
        profile('Bronze hanging bell',[(2.5,.19,.15,0,-.10),(2.55,.16,.13,0,-.1),(2.73,.105,.10,0,-.1),(2.8,.07,.06,0,-.1)],'gold',16)
        sphere('Bell clapper',(0,-.1,2.48),(.047,.047,.053),'dark',10,6)
        box('Crypt lintel',(0,0,2.93),(1.65,.53,.17),'ivory')
        box('Crypt stepped crown',(0,0,3.10),(1.05,.48,.18),'stone')
        box('Crypt stepped cap',(0,0,3.25),(.46,.44,.13),'ivory')
    elif motif=='wheel':
        ring('Sluice handwheel',(0,y,3.07),.235,.035,'gold',24)
        cyl('Handwheel hub',(0,y,3.07),.066,.14,'gold').rotation_euler.x=math.pi/2
        for i in range(6):
            a=math.tau*i/6;rod('Handwheel spoke',(0,y,3.07),(.225*math.cos(a),y,3.07+.225*math.sin(a)),.014,'gold')
        for s in (-1,1):
            for z in (.65,1,1.35,1.7):box('Sluice teeth',(s*1.16,-.35,z),(.23,.09,.1),'gold',.008)
    elif motif=='scope':
        ring('Crescent outer',(0,y,3.10),.27,.037,'gold',24,arc=math.pi*1.55)
        scope=rod('Telescope',(-.14,y-.07,2.99),(.3,y-.07,3.17),.073,'gold',12)
        leaf('Nightglass lens',(.3,y-.07,3.17),(.09,.14,.03),accent)
        rod('Scope tripod',(-.13,y,2.89),(.06,y,3.09),.025,'gold')
    elif motif=='hydra':
        ring('Eclipse halo',(0,y,3.01),.225,.035,'gold',28)
        o=cyl('Eclipse disc',(0,y,3.01),.20,.08,'dark',24);o.rotation_euler.x=math.pi/2
        for s in (-1,0,1):
            pts=[(s*.56,y,2.82),(s*.46,y,3.02),(s*.46,y,3.19),(s*.24,y,3.27)]
            curve('Hydra wave neck',pts,.05,'gold',8)
            leaf('Hydra head',(s*.24,y-.03,3.27),(.18,.10,.07),accent,math.pi/2)
    elif motif=='hammers':
        rod('Hammer A',(-.24,y,2.83),(.26,y,3.23),.034,'leather')
        rod('Hammer B',(.24,y-.09,2.83),(-.26,y-.09,3.23),.034,'leather')
        for s in (-1,1):
            o=box('Forging hammer head',(s*.25,y-(.09 if s<0 else 0),3.23),(.29,.15,.13),'gold',.02);o.rotation_euler.y=s*.63
        box('Anvil crown',(0,0,3.11),(.6,.28,.11),'stone');box('Anvil foot',(0,0,3.01),(.22,.25,.18),'gold')
    elif motif=='spire':
        for x in (-.43,-.2,0,.2,.43):
            h=.42 if x==0 else .3 if abs(x)<.3 else .18
            leaf('Ascending stellar fin',(x,-.08,3.07+h*.35),(.10,h,.09),accent)
        o=ring('Orbital stellar ring',(0,y-.07,3.0),.27,.019,'gold',28);o.rotation_euler.y=.36
        sphere('Stellar core',(0,y,3.0),(.11,.1,.11),'gold',12,6)
    elif motif=='mirror':
        leaf('Split mirror diamond',(0,y,3.09),(.42,.58,.1),accent)
        for s in (-1,1):curve('Dune crown',[(s*.72,0,2.94),(s*.35,0,3.05),(s*.10,0,3.37)],.035,'gold')
        rod('Mirror split seam',(0,y-.115,2.8),(0,y-.115,3.38),.012,'gold')
    elif motif=='comet':
        for x in (-.6,-.3,0,.3,.6):box('Fortified crenel',(x,0,3.17),(.18,.45,.34),'stone',.02)
        sphere('Comet head',(-.22,y,2.97),(.15,.08,.15),'gold',12,6)
        for i in range(3):curve('Diagonal comet trails',[(-.11+i*.035,y,3.03),(.25+i*.05,y,3.19),(.52+i*.04,y,3.38)],.021,'gold')

def gate(key,motif,accent):
    global active_root
    active_root=root('Citadel_Gate_'+key,'dungeon-gateway');o=active_root
    o['dungeonId']=key;o['openPassageMetres']=1.9
    for s in (-1,1):
        for i in range(6):
            z=.23+i*.295
            box('Jointed slate pier',(s*1.17,0,z),(.43,.44,.282),'stone',.018)
        box('Broad pier footing',(s*1.2,0,.09),(.6,.54,.18),'ivory',.018)
        box('Footing slate plinth',(s*1.2,0,.23),(.52,.5,.12),'stone',.015)
        box('Ivory pilaster',(s*1.2,-.249,1.14),(.12,.065,1.5),'ivory',.012)
        rod('Gold pilaster inlay',(s*1.2,-.29,.48),(s*1.2,-.29,1.79),.009,'gold',6)
        box('Carved capital',(s*1.2,0,1.93),(.59,.52,.19),'ivory',.02)
        leaf('Pier route lozenge',(s*1.2,-.29,.54),(.13,.23,.025),accent)
        # Raised shoulder architecture reaches arch spring without center occlusion.
        box('Stepped shoulder',(s*1.3,.055,2.31),(.31,.41,.55),'stone',.02)
        box('Shoulder cornice',(s*1.3,.055,2.6),(.39,.49,.13),'ivory',.012)
    for i in range(14):
        a=math.pi*i/14+.005;b=math.pi*(i+1)/14-.005
        arch_block('Radial carved voussoir',a,b,.955,1.17,1.89,'ivory' if i%4==0 else 'stone')
    ring('Inner gold archivolt',(0,-.26,1.89),.966,.012,'gold',32,arc=math.pi)
    ring('Outer ivory archivolt',(0,-.259,1.89),1.14,.019,'ivory',32,arc=math.pi)
    # Route crowns deliberately change the outside silhouette, rather than
    # relying on small colored tokens when viewed from the walking camera.
    for s in (-1,1):
        if motif in ('leaf','root'):
            cone('Garden tapered buttress finial',(s*1.30,.045,2.82),.15,.025,.37,'ivory',6)
        elif motif in ('furnace','hammers'):
            box('Industrial chimney shoulder',(s*1.30,.055,2.82),(.28,.37,.38),'stone',.013)
            box('Chimney brass coping',(s*1.30,.055,3.03),(.34,.42,.10),'gold',.01)
        elif motif=='book':
            cone('Archive scholarly spire',(s*1.30,.055,2.86),.14,0,.43,'ivory',6)
            star('Archive shoulder star',(s*1.30,-.19,2.68),.105,'gold')
        elif motif=='bell':
            box('Crypt square battlement',(s*1.30,.055,2.77),(.38,.43,.25),'stone',.016)
        elif motif=='wheel':
            box('Sluice stepped shoulder',(s*1.30,.055,2.76),(.34,.41,.25),'gold',.01)
        elif motif=='scope':
            sphere('Observatory domed shoulder',(s*1.30,.055,2.71),(.18,.18,.18),'blue',16,8)
            cone('Observatory finial',(s*1.30,.055,2.90),.06,0,.23,'gold',8)
        elif motif=='hydra':
            curve('Outer hydra swept horn',[(s*1.28,0,2.6),(s*1.42,0,2.8),(s*1.36,0,3.05)],.065,'gold')
        elif motif=='spire':
            leaf('Spire shoulder sky fin',(s*1.3,.06,2.84),(.15,.5,.08),'blue')
        elif motif=='mirror':
            leaf('Dune shoulder peak',(s*1.3,.06,2.84),(.25,.4,.08),'ivory')
        elif motif=='comet':
            box('Bastion upper battlement',(s*1.30,.055,2.79),(.34,.44,.27),'stone',.013)
    before=set(descendants(o))
    emblem(motif,accent)
    for part in set(descendants(o))-before:
        if part.name.startswith(('Living root','Root foliage','Brazier','Sculpted ember','Amber arch')):
            continue
        # Enlarge the book/bell/wheel/creature/comet shape above the opening.
        for v in part.data.vertices:
            w=part.matrix_world@v.co
            if w.z>2.36:
                w.x*=1.48;w.z=2.9+(w.z-2.9)*1.24
                v.co=part.matrix_world.inverted()@w
    return o

def npc(role):
    global active_root
    names={'merchant':'Merchant','alchemist':'Alchemist','arena-steward':'ArenaSteward'}
    active_root=root('Citadel_NPC_'+names[role],{'merchant':'merchant','alchemist':'trainer','arena-steward':'steward'}[role]);o=active_root
    o['animation']='Static environmental NPC; runtime may animate root idle'
    female=role!='merchant'; skin='skin2' if role=='alchemist' else 'skin3' if female else 'skin'
    hair='hair2' if role=='alchemist' else 'hair'
    cloth='ivory' if role=='alchemist' else 'teal' if role=='merchant' else 'stone'
    waist=.9;shoulder=1.27
    for s in (-1,1):
        x=s*.13
        profile('Tailored trouser leg',[(.25,.083,.083,x,0),(.56,.087,.09,x,0),(.85,.106,.104,x,0),(.96,.11,.11,x,0)],'dark',12)
        profile('Boot shaft',[(.075,.105,.13,x,-.015),(.19,.1,.11,x,0),(.36,.093,.105,x,0),(.41,.108,.11,x,0)],'leather',12)
        sphere('Shaped boot toe',(x,-.105,.11),(.112,.18,.091),'leather',16,6)
        box('Grounded boot sole',(x,-.08,.033),(.235,.32,.065),'dark',.018)
        box('Boot ankle strap',(x,-.025,.23),(.22,.23,.038),'gold',.008)
    profile('Layered tailored body',[(.88,.205,.12,0,0),(1.01,.198,.12,0,0),(1.15,.246,.142,0,0),(1.26,.225,.13,0,0),(1.31,.16,.1,0,0)],cloth,24)
    # Front shirt/tabard and split flared garment are sculpted surfaces.
    panel=mesh('Ivory layered front', [(-.14,-.155,1.26),(.14,-.155,1.26),(.10,-.139,.93),(-.10,-.139,.93)],[(0,1,2,3)],'ivory')
    sol=panel.modifiers.new('Front panel thickness','SOLIDIFY');sol.thickness=.015
    bpy.context.view_layer.objects.active=panel;bpy.ops.object.modifier_apply(modifier=sol.name)
    hem=.63 if role=='merchant' else .43 if role=='alchemist' else .61
    profile('Split flared coat',[(hem,.30 if female else .31,.18,0,.015),(.72,.26,.16,0,.01),(.94,.215,.137,0,0),(1.11,.25,.146,0,0),(1.28,.243,.14,0,0)],cloth,24,start=-math.pi/2+.24,end=math.pi*1.5-.24,caps=False)
    for s in (-1,1):
        curve('Gold coat piping',[(s*.071,-.183,hem),(s*.056,-.153,.72),(s*.052,-.14,.94),(s*.06,-.15,1.1),(s*.14,-.143,1.27)],.007,'gold',6)
        lapel=mesh('Folded wide lapel',[(s*.07,-.18,1.02),(s*.11,-.16,1.29),(s*.19,-.152,1.27),(s*.13,-.177,1.1)],[(0,1,2,3)],cloth)
        so=lapel.modifiers.new('Lapel thickness','SOLIDIFY');so.thickness=.014;bpy.context.view_layer.objects.active=lapel;bpy.ops.object.modifier_apply(modifier=so.name)
        # Arm profile follows anatomical shoulder, elbow and wrist, no stick limbs.
        pts=[(s*.218,0,1.23),(s*.29,-.015,1.10),(s*.345,-.015,.965)]
        for k in range(2):
            rod('Tailored upper sleeve' if k==0 else 'Tailored fore sleeve',pts[k],pts[k+1],.09 if k==0 else .076,cloth,12,.076 if k==0 else .061)
        sphere('Rounded shoulder seam',pts[0],(.096,.091,.092),cloth,12,6)
        rod('Rolled ivory cuff',(s*.337,-.015,.99),(s*.355,-.015,.94),.082,'ivory',12)
        rod('Leather wrist band',(s*.355,-.015,.94),(s*.365,-.022,.893),.053,'leather',12)
        sphere('Sculpted palm',(s*.37,-.032,.853),(.052,.041,.069),skin,12,6)
        for f in range(4):
            x=s*(.342+f*.019)
            rod('Relaxed separated finger',(x,-.045,.84),(x+s*.006,-.05,.791+(f%3)*.007),.011,skin,6,.008)
        rod('Thumb',(s*.331,-.045,.871),(s*.315,-.076,.826),.017,skin,8,.013)
    profile('Leather waist belt',[(.922,.223,.145,0,0),(.974,.223,.145,0,0)],'leather',24)
    box('Brass square belt buckle',(0,-.155,.95),(.078,.022,.055),'gold',.008)
    box('Buckle inset',(0,-.17,.95),(.048,.015,.028),'dark',.004)
    cyl('Neck',(0,0,1.337),.085,.11,skin,14)
    # Custom jaw/cheek/head profile: 5.2 heads tall, compatible heroic proportion.
    profile('Sculpted human head',[(1.36,.083,.08,0,-.006),(1.395,.132,.098,0,-.015),(1.48,.157,.132,0,-.009),(1.55,.159,.134,0,0),(1.62,.134,.11,0,.012),(1.67,.065,.06,0,.017)],skin,24)
    for s in (-1,1):
        sphere('Shaped ear',(s*.157,0,1.49),(.024,.021,.053),skin,10,6)
        sphere('Warm cheek',(s*.073,-.126,1.465),(.055,.025,.03),skin,12,6)
        # Eye socket, whites and small pupil visible from close walk camera.
        sphere('Recessed skin eyelid',(s*.066,-.129,1.522),(.035,.009,.015),skin,12,6)
        sphere('Eye white',(s*.064,-.137,1.52),(.022,.006,.008),'ivory',12,6)
        sphere('Eye pupil',(s*.064,-.143,1.521),(.008,.003,.008),'eyes',10,6)
        curve('Expressive eyebrow',[(s*.033,-.143,1.551),(s*.066,-.147,1.556),(s*.102,-.134,1.547)],.011,hair,8)
    # Nose built as closed sculpted wedge plus soft nostrils.
    mesh('Sculpted nose',[(-.023,-.133,1.536),(.023,-.133,1.536),(-.027,-.172,1.463),(.027,-.172,1.463),(0,-.195,1.475),(0,-.132,1.451)],[(0,1,4),(1,3,4),(3,5,4),(5,2,4),(2,0,4),(0,2,5,3,1)],skin,True)
    curve('Gentle mouth',[(-.043,-.128,1.426),(0,-.142,1.423),(.043,-.128,1.426)],.007,'leather',8)
    # Hair cap respects an actual face opening. Swept locks follow skull contours.
    profile('Sculpted hair cap',[(1.56,.16,.139,0,.006),(1.62,.15,.125,0,.009),(1.69,.087,.086,0,.011),(1.714,.016,.023,0,.014)],hair,24)
    for i in range(6):
        # Low conforming sculpted ribbons, never protruding comb-like rods.
        x=-.115+i*.043
        points=[(x,-.117,1.606),(x*.88,-.090,1.652),(x*.55,-.042,1.692),(x*.25,.012,1.716),(x*.43,.055,1.689)]
        verts=[]
        for xx,yy,zz in points:
            verts.extend([(xx-.011,yy+.001,zz),(xx,yy-.003,zz+.004),(xx+.011,yy+.001,zz)])
        faces=[]
        for j in range(4):
            for k in range(2):faces.append((j*3+k,(j+1)*3+k,(j+1)*3+k+1,j*3+k+1))
        mesh('Low swept hair sculpt ribbon',verts,faces,hair,True)
    if role=='merchant':
        profile('Shaped salt pepper beard',[(1.344,.085,.072,0,-.052),(1.382,.13,.099,0,-.052),(1.442,.14,.1,0,-.035)],hair,20,start=math.pi-.18,end=math.tau+.18,caps=False)
        for s in (-1,1):rod('Moustache',(s*.008,-.154,1.446),(s*.06,-.141,1.443),.013,hair,8)
        box('Split work apron',(0,-.16,.755),(.32,.025,.33),'leather',.025)
        rod('Apron split seam',(0,-.18,.6),(0,-.18,.87),.006,'gold',6)
        sat=box('Travel satchel',(.259,.03,.83),(.17,.16,.23),'leather',.035)
        box('Satchel folded flap',(.26,-.068,.881),(.17,.025,.11),'leather',.022)
        curve('Diagonal travel baldric',[(-.19,-.161,1.26),(.01,-.188,1.09),(.18,-.158,.91),(.23,-.06,.85)],.023,'leather')
        for z in (1,1.065,1.13):sphere('Waistcoat brass button',(0,-.172,z),(.011,.011,.011),'gold',8,4)
    elif role=='alchemist':
        profile('Teal folded scarf',[(1.275,.18,.13,0,0),(1.323,.145,.108,0,0),(1.351,.116,.097,0,0)],'teal',20)
        scarf=mesh('Hanging scarf',[(-.08,-.159,1.33),(.027,-.17,1.30),(.003,-.17,1.09),(-.083,-.15,1.19)],[(0,1,2,3)],'teal')
        for i in range(4):
            x=.1+i*.046
            cyl('Amber potion vial',(x,-.155,.858),.018,.10,'ember',10)
            cyl('Brass vial cap',(x,-.155,.918),.018,.02,'gold',10)
        profile('Rounded alchemist cap',[(1.635,.159,.133,0,.01),(1.696,.151,.126,0,.01),(1.743,.10,.09,0,.01),(1.765,.034,.03,0,.01)],'dark',24)
        for s in (-1,1):
            ring('Brass goggles',(s*.054,-.108,1.706),.035,.009,'gold',14)
            sphere('Goggle glass',(s*.054,-.11,1.706),(.026,.01,.026),'blue',12,6)
    else:
        for s in (-1,1):
            sphere('Rounded steward pauldron',(s*.239,-.008,1.26),(.11,.123,.083),'gold',14,6)
            box('Steward bracer',(s*.349,-.03,.993),(.107,.13,.123),'gold',.02)
        leaf('Steward tabard insignia',(0,-.193,.77),(.12,.23,.015),'gold')
        book=box('Bound arena ledger',(.37,-.035,.93),(.09,.19,.26),'leather',.014)
        box('Ledger ivory pages',(.383,-.035,.935),(.012,.16,.22),'ivory',.005)
        rod('Steward training baton',(-.39,-.05,.81),(-.51,-.05,.42),.017,'leather',10)
        sphere('Baton brass pommel',(-.51,-.05,.42),(.024,.024,.024),'gold',10,6)
    return o

def prop(key):
    global active_root
    active_root=root('Citadel_Plaza_'+key,'plaza-prop');o=active_root
    if key=='paving':
        box('Slate paving foundation',(0,0,-.07),(2.4,2.4,.14),'stone',.025)
        for i in range(4):
            for j in range(4):box('Carved paving joint',(-.89+i*.595,-.89+j*.595,.012),(.576,.576,.034),'stone',.012)
        for s in (-1,1):
            box('Tone matched paving border',(s*1.17,0,.016),(.045,2.4,.026),'stone',.008)
            box('Tone matched paving border',(0,s*1.17,.016),(2.4,.045,.026),'stone',.008)
    elif key=='stairs':
        for i in range(3):box('Ivory civic step',(0,.2*i,.09+i*.16),(2,.8-.2*i,.18+i*.16),'ivory',.02)
        for s in (-1,1):box('Stair side curb',(s*1.08,0,.31),(.15,1.0,.62),'stone',.025)
    elif key=='planter':
        box('Planter stone body',(0,0,.27),(2,.56,.54),'stone',.03)
        box('Soil inset',(0,0,.55),(1.85,.42,.04),'dark',.012)
        for s in (-1,1):box('Ivory planter rim',(0,s*.27,.58),(2.04,.055,.10),'ivory',.018)
        for s in (-1,1):box('Ivory planter end',(s*.99,0,.58),(.07,.54,.1),'ivory',.018)
        for i in range(9):
            x=-.84+i*.21
            rod('Plant stalk',(x,0,.55),(x,.015,.88+(i%3)*.04),.012,'foliage',6)
            for s in (-1,1):leaf('Planted sage leaf',(x+s*.07,-.025,.73),(.15,.22,.037),'foliage',s*.8)
            if i%2==0:sphere('Ivory small flower',(x,0,.95),(.035,.03,.025),'ivory',8,4)
        for x in (-.65,0,.65):leaf('Raised planter relief',(x,-.306,.3),(.35,.24,.026),'gold',math.pi/2)
    elif key=='bench':
        box('Bench carved support',(0,0,.44),(1.9,.53,.13),'stone',.025)
        box('Teal padded leather seat',(0,-.02,.53),(1.84,.51,.16),'teal',.05)
        box('Bench padded back',(0,.26,.77),(1.85,.10,.35),'teal',.03)
        for s in (-1,1):
            for yy in (-.22,.22):rod('Curved brass leg',(s*.82,yy,.06),(s*.76,yy,.49),.035,'gold')
            curve('Bench arm curl',[(s*.95,-.2,.56),(s*.97,-.19,.78),(s*.97,.24,.79),(s*.95,.28,.5)],.035,'gold')
        for x in (-.5,0,.5):box('Seat stitched channel',(x,-.02,.616),(.012,.47,.008),'gold',0)
    elif key=='lamp':
        profile('Lamp civic pedestal',[(0,.15,.15,0,0),(.08,.16,.16,0,0),(.16,.11,.11,0,0),(.34,.055,.055,0,0)],'gold',16)
        rod('Lamp tapered shaft',(0,0,.3),(0,0,2.05),.038,'gold',12,.023)
        curve('Articulated swan lamp arm',[(0,0,2.05),(-.1,0,2.3),(-.34,0,2.40),(-.55,0,2.3),(-.65,0,2.15)],.027,'gold',10)
        rod('Lantern suspension',(-.65,0,2.15),(-.65,0,2.0),.017,'gold')
        profile('Lamp glass housing',[(1.65,.05,.05,-.65,0),(1.73,.10,.10,-.65,0),(1.94,.075,.075,-.65,0),(1.99,.03,.03,-.65,0)],'ember',12)
        for a in range(4):
            t=math.tau*a/4;rod('Lamp brass cage',(-.65+.08*math.cos(t),.08*math.sin(t),1.73),(-.65+.07*math.cos(t),.07*math.sin(t),1.96),.009,'gold',6)
    elif key in ('stall','alchemy-counter'):
        w=1.9 if key=='stall' else 1.5
        box('Service counter body',(0,0,.51),(w,.63,1.02),'stone',.04)
        box('Ivory counter slab',(0,0,1.07),(w+.12,.76,.12),'ivory',.02)
        for x in (-w*.37,0,w*.37):
            box('Service cabinet carved panel',(x,-.331,.52),(w*.27,.035,.73),'leather' if key=='stall' else 'teal',.018)
            leaf('Raised service diamond',(x,-.363,.52),(.19,.27,.023),'gold')
        if key=='stall':
            for s in (-1,1):rod('Stall awning support',(s*.94,.27,.05),(s*.94,.27,2.28),.035,'gold',10)
            # Fabric awning uses repeated curved strip surfaces and sculpted scallops.
            for i in range(8):
                x=-1.06+i*.265;v=[]
                for xx in (x,x+.265):
                    for yy,zz in [(.4,2.27),(.14,2.23),(-.18,2.13),(-.52,1.96),(-.7,1.9)]:v.append((xx,yy,zz))
                mesh('Teal striped curved awning',v,[(j,j+1,6+j,5+j) for j in range(4)],'teal' if i%2==0 else 'ivory')
                leaf('Awning scallop',(x+.132,-.7,1.865),(.262,.14,.006),'teal' if i%2==0 else 'ivory')
            for x in (-.6,-.25,.4):
                box('Traded goods parcel',(x,.04,1.22),(.22,.23,.18),'leather',.018)
                box('Parcel brass ribbon',(x,-.076,1.22),(.024,.015,.18),'gold',0)
        else:
            for i in range(5):
                x=-.5+i*.24
                sphere('Alchemy flask belly',(x,0,1.24),(.067,.067,.08),'green' if i%2==0 else 'ember',12,6)
                cyl('Flask brass neck',(x,0,1.32),.023,.06,'gold',10)
            box('Alchemy open notebook',(.12,-.19,1.154),(.35,.2,.03),'ivory',.012)
    return o

# Collapse static surface parts by material to bounded draw counts; preserve a
# named semantic mesh per material rather than hundreds of runtime objects.
def descendants(o):return [x for x in o.children_recursive if x.type=='MESH']
def batch(o):
    meshes=descendants(o);bins={}
    for x in meshes:bins.setdefault(x.data.materials[0].name,[]).append(x)
    for key,items in bins.items():
        bpy.ops.object.select_all(action='DESELECT')
        for x in items:x.select_set(True)
        bpy.context.view_layer.objects.active=items[0];bpy.ops.object.join()
        obj=bpy.context.object;obj.name=o.name+'__'+key.removeprefix('Citadel ').replace(' ','_')
        # Apply location and rotation so material meshes share the semantic root.
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        if not obj.data.uv_layers:obj.data.uv_layers.new(name='UVMap')
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(angle_limit=1.15192,island_margin=.025)
        bpy.ops.object.mode_set(mode='OBJECT')
        tri=obj.modifiers.new('Export triangulation','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
    return o

def normalize_asset(o,key):
    verts=[v for obj in descendants(o) for v in obj.data.vertices]
    lo=[min(v.co[i] for v in verts) for i in range(3)];hi=[max(v.co[i] for v in verts) for i in range(3)]
    if key.startswith('gate-'):
        sx=3/(hi[0]-lo[0]);sy=.55/(hi[1]-lo[1]);sz=3.4/(hi[2]-lo[2]);cy=(hi[1]+lo[1])/2
        for v in verts:v.co.x*=sx;v.co.y=(v.co.y-cy)*sy;v.co.z=(v.co.z-lo[2])*sz
    elif key in ('merchant','alchemist','arena-steward'):
        f=1.75/(hi[2]-lo[2])
        for v in verts:v.co.x*=f;v.co.y*=f;v.co.z=(v.co.z-lo[2])*f

def share_texture_images(path):
    """Deduplicate portable glTF images across the pack; compact GLB buffers.

    Standard GLBs may use external image URIs. All geometry remains in each GLB
    and shared texture files live next to the models under textures/.
    """
    raw=path.read_bytes();jlen,jtyp=struct.unpack_from('<II',raw,12)
    doc=json.loads(raw[20:20+jlen]);binstart=20+jlen+8
    binary=raw[binstart:];views=doc.get('bufferViews',[])
    images=doc.get('images',[]);image_views={i['bufferView'] for i in images if 'bufferView' in i}
    if not image_views:return
    texdir=OUT/'textures';texdir.mkdir(exist_ok=True)
    for im in images:
        if 'bufferView' not in im:continue
        view=views[im.pop('bufferView')];off=view.get('byteOffset',0);data=binary[off:off+view['byteLength']]
        digest=hashlib.sha256(data).hexdigest()[:24];ext='.png' if im.get('mimeType')=='image/png' else '.jpg'
        target=texdir/(digest+ext)
        if not target.exists():target.write_bytes(data)
        im['uri']='textures/'+target.name
    compact=bytearray();mapping={};newviews=[]
    for idx,view in enumerate(views):
        if idx in image_views:continue
        while len(compact)%4:compact.append(0)
        off=view.get('byteOffset',0);data=binary[off:off+view['byteLength']]
        updated=dict(view);updated['byteOffset']=len(compact);updated['buffer']=0
        mapping[idx]=len(newviews);newviews.append(updated);compact.extend(data)
    for ac in doc.get('accessors',[]):
        if 'bufferView' in ac:ac['bufferView']=mapping[ac['bufferView']]
        for item in ac.get('sparse',{}).values():
            if isinstance(item,dict) and 'bufferView' in item:item['bufferView']=mapping[item['bufferView']]
    doc['bufferViews']=newviews;doc['buffers'][0]['byteLength']=len(compact)
    js=json.dumps(doc,separators=(',',':')).encode()
    js+=b' '*((-len(js))%4);compact.extend(b'\0'*((-len(compact))%4))
    final=struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(compact))
    final+=struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(compact),0x004e4942)+compact
    path.write_bytes(final)

def export(o,key,lod=0):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True)
    for x in descendants(o):x.select_set(True)
    path=OUT/(key+('-lod1' if lod else '')+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
        export_apply=True,export_yup=True,export_texcoords=True,export_normals=True,
        export_materials='EXPORT',export_extras=True,export_animations=False)
    share_texture_images(path)
    tris=sum(len(x.data.polygons) for x in descendants(o))
    coords=[o.matrix_world.inverted() @ (x.matrix_world@Vector(c)) for x in descendants(o) for c in x.bound_box]
    lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
    return {'file':path.name,'root':o.name,'triangles':tris,'draws':len(descendants(o)),'bytes':path.stat().st_size,
        'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'boundsBlender':{'min':lo,'max':hi},'lod':lod}

ASSETS=[];SOURCES=[]
for key,motif,accent in ROUTES:SOURCES.append(('gate-'+key,batch(gate(key,motif,accent))))
for key in ('merchant','alchemist','arena-steward'):SOURCES.append((key,batch(npc(key))))
for key in ('paving','planter','bench','lamp','stall'):SOURCES.append((key,batch(prop(key))))

for key,o in SOURCES:
    normalize_asset(o,key)
    hi=export(o,key)
    copies=[]
    original=descendants(o)[:]
    for obj in original:
        cp=obj.copy();cp.data=obj.data.copy();scene.collection.objects.link(cp);cp.parent=o
        copies.append(cp)
    for obj in original:
        if obj not in copies:obj.hide_set(True);obj.hide_render=True
    for obj in copies:
        d=obj.modifiers.new('Mobile LOD silhouette reduction','DECIMATE');d.ratio=.42 if key.startswith('gate') else .48
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=d.name)
    lo=export(o,key,1)
    # Export helper explicitly selected descendants; remove originals from the
    # LOD export before its final write to avoid duplication of hidden meshes.
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True)
    for obj in copies:obj.select_set(True)
    path=OUT/(key+'-lod1.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
        export_apply=True,export_yup=True,export_extras=True,export_animations=False)
    share_texture_images(path)
    lo.update(triangles=sum(len(x.data.polygons) for x in copies),draws=len(copies),bytes=path.stat().st_size,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    for obj in copies:bpy.data.objects.remove(obj,do_unlink=True)
    for obj in original:obj.hide_set(False);obj.hide_render=False
    hi['lod1']=lo;ASSETS.append(hi)

def studio_camera(location,target,scale):
    bpy.ops.object.camera_add(location=location);cam=bpy.context.object;cam.name='PREVIEW_ONLY_Camera'
    cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=scale;scene.camera=cam
    return cam
def light(name,p,energy,size):
    bpy.ops.object.light_add(type='AREA',location=p);o=bpy.context.object;o.name=name;o.data.energy=energy;o.data.shape='DISK';o.data.size=size
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()

light('PREVIEW_ONLY_Key',(-3,-6,9),1900,7);light('PREVIEW_ONLY_Fill',(5,-2,5),1000,6)
light('PREVIEW_ONLY_Rim',(0,7,8),1500,5)
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='PREVIEW_ONLY_Floor'
floor.location.z=-.03;floor.data.materials.append(material('studio background','ADAAA0',.9))

for key,o in SOURCES:
    o.hide_render=key not in ('merchant','alchemist','arena-steward')
    if key in ('merchant','alchemist','arena-steward'):o.location.x={'merchant':-1.25,'alchemist':0,'arena-steward':1.25}[key]
    for obj in descendants(o):obj.hide_render=o.hide_render
cam=studio_camera((3,-7,3.2),(0,0,.95),4.9)
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.filepath=str(ART/'npc-blender-preview.png');bpy.ops.render.render(write_still=True)

for idx,(key,o) in enumerate(SOURCES):
    o.hide_render=not key.startswith('gate-')
    if key.startswith('gate-'):
        o.location=( (idx%3-1)*3.85,(idx//3)*4.4,0)
    for obj in descendants(o):obj.hide_render=o.hide_render
cam.location=(7,-14,15);target=Vector((0,6.6,1.5));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=21
scene.render.resolution_x=1300;scene.render.resolution_y=1300
scene.render.filepath=str(ART/'gate-blender-preview.png');bpy.ops.render.render(write_still=True)

for idx,(key,o) in enumerate(SOURCES):
    for obj in descendants(o):obj.hide_render=False
    o.hide_render=False
    if not key.startswith('gate-'):o.location=((idx-12)%4*3.3-5,(idx-12)//4*-3.3-4,0)
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'citadel-hub-v1.blend'))
elapsed=time.perf_counter()-START
texture_metadata=[]
texture_uris=set()
for path in OUT.glob('*.glb'):
    raw=path.read_bytes();jlen=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+jlen])
    texture_uris.update(im['uri'] for im in doc.get('images',[]) if 'uri' in im)
for uri in sorted(texture_uris):
    path=OUT/uri
    texture_metadata.append({'file':uri,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
for path in (OUT/'textures').glob('*'):
    if 'textures/'+path.name not in texture_uris:path.unlink()
manifest={'version':'citadel-hub-v1','blender':bpy.app.version_string,'buildSeconds':round(elapsed,2),
 'generator':'tools/build-citadel-assets.py','referenceSheets':[
  {'file':'docs/assets/citadel-hub-v1/reference-source/character-sheet-gpt.png','sha256':hashlib.sha256((REF/'character-sheet-gpt.png').read_bytes()).hexdigest()},
  {'file':'docs/assets/citadel-hub-v1/reference-source/terrain-sheet-gpt.png','sha256':hashlib.sha256((REF/'terrain-sheet-gpt.png').read_bytes()).hexdigest()},
  {'file':'docs/assets/citadel-hub-v1/reference-source/glass-garden-trellis-reference.png','sha256':hashlib.sha256((REF/'glass-garden-trellis-reference.png').read_bytes()).hexdigest()}],
 'rights':'Original authored Blender geometry and generated visual references; no external geometry or textures imported',
 'trellis':{'localStatus':'unavailable','hostedStatus':'quota-blocked','outputGlb':None,
  'reason':'No local TRELLIS/torch or GPU. One authorized anonymous official TRELLIS.2 run accepted and preprocessed reference, then image_to_3d failed provider quota; no GLB produced and no paid fallback used.',
  'source':'https://microsoft-trellis-2.hf.space',
  'spaceRevision':'ebf60b20fc5a4607f90a1c11c0aab0ceeda5429d',
  'referenceSha256':'2f2b397e30aa742346c1dea4097470667fddcf65984803c1359342880bf02fa0',
  'evidence':'/workspace/.blade-surge-tools/trellis-citadel/090408fc-b5ed-4408-975a-ed1f0c97804b/result.json'},
 'coordinateContract':{'up':'+Y','forward':'+Z','origin':'ground center','units':'metres'},
 'npcRoles':{'merchant':'merchant','alchemist':'trainer','arena-steward':'steward'},
 'sharedTextures':texture_metadata,
 'budgets':{'fullMeshBytes':sum(a['bytes'] for a in ASSETS),'lodMeshBytes':sum(a['lod1']['bytes'] for a in ASSETS),
  'sharedTextureBytes':sum(t['bytes'] for t in texture_metadata),'gateMaxDraws':max(a['draws'] for a in ASSETS if a['file'].startswith('gate-'))},
 'assets':ASSETS,'runtimeIntegration':'pending scene owner integration and walking camera observation'}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('CITADEL_BUILD '+json.dumps({'assets':len(ASSETS),'bytes':sum(a['bytes'] for a in ASSETS),'seconds':elapsed}))
