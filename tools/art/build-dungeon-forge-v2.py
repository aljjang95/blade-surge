"""기존 리그를 보존하는 던전 병사 장식과 직업 무기 자체 제작.
실행: blender --background --factory-startup --python-exit-code 1 --python tools/art/build-dungeon-forge-v2.py
좌표는 게임의 X 오른쪽, Y 위, Z 정면. 원본 모델/얼굴/리그를 쓰거나 수정하지 않는다.
"""
import bpy, math, json, hashlib, subprocess
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/dungeon-forge-v2'
FITTINGS = ROOT / 'public/models/tll/encounters'
SOURCE = ROOT / 'tools/art/source/dungeon-forge-v2'
for folder in [OUT, FITTINGS, SOURCE]: folder.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
manifest = {'revision': 'dungeon-forge-v2', 'authoring': 'Blender headless', 'blender': bpy.app.version_string, 'license': 'Original project-authored geometry; source character rigs unchanged', 'files': []}
colors = {'iron': (.065,.095,.14), 'steel': (.43,.57,.68), 'gold': (.78,.48,.17), 'jade': (.07,.68,.51), 'violet': (.44,.19,.69), 'ivory': (.73,.79,.83), 'leather': (.085,.046,.039), 'ember': (.83,.20,.055)}

def xyz(p): return (p[0], -p[2], p[1])
def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)
    m=bpy.data.materials.new('forge_vertex_metal'); m.use_nodes=True
    bsdf=m.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Metallic'].default_value=.48; bsdf.inputs['Roughness'].default_value=.46
    attr=m.node_tree.nodes.new('ShaderNodeVertexColor'); attr.layer_name='ForgeColor'; m.node_tree.links.new(attr.outputs['Color'],bsdf.inputs['Base Color'])
    return m

def finish(o, name, color, bone=None, bevel=0):
    o.name=name
    if bone and name not in ['어깨 외곽','흉갑 외곽']:bevel=0
    if bevel:
        mod=o.modifiers.new('단조 모서리','BEVEL'); mod.width=bevel; mod.segments=1
        bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.clear(); o.data.materials.append(material)
    attr=o.data.color_attributes.new(name='ForgeColor',type='FLOAT_COLOR',domain='CORNER')
    for item in attr.data: item.color=(*colors[color],1)
    o.data.color_attributes.active_color=attr
    if bone: o['tllBone']=bone
    return o

def mesh(name, vertices, faces, color, bone=None, bevel=0):
    me=bpy.data.meshes.new(name); me.from_pydata([xyz(p) for p in vertices],[],faces); me.update()
    o=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    return finish(o,name,color,bone,bevel)

def plate(name, points, depth, color, bone=None, bevel=.008):
    n=len(points); verts=[(x,y,z+d) for d in [-depth/2,depth/2] for x,y,z in points]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,verts,faces,color,bone,bevel)

def box(name, p, size, color, bone=None, bevel=.01):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p)); o=bpy.context.object; o.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,color,bone,bevel)

def rod(name, a, b, radius, color, bone=None, tip=None):
    start,end=Vector(xyz(a)),Vector(xyz(b)); delta=end-start
    bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=radius,radius2=radius if tip is None else tip,depth=delta.length,location=(start+end)/2)
    o=bpy.context.object; o.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
    return finish(o,name,color,bone)

def jewel(name,p,size,color,bone=None):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=xyz(p));o=bpy.context.object;o.scale=(size[0],size[2],size[1])
    return finish(o,name,color,bone)

def halo(name,p,r,color,bone):
    # 정면에서 읽히는 열린 후광, 눈/해골을 덮지 않는다.
    for i in range(10):
        a=math.pi*.08+i*math.pi*1.84/10; b=math.pi*.08+(i+1)*math.pi*1.84/10
        rod(name,(p[0]+math.sin(a)*r,p[1]+math.cos(a)*r,p[2]),(p[0]+math.sin(b)*r,p[1]+math.cos(b)*r,p[2]),.038,color,bone)

def pauldron(side,color,kind):
    bone='upperarm.'+('r' if side<0 else 'l'); x=side*.34
    plate('어깨 외곽',[(x-side*.12,1.18,-.10),(x+side*.16,1.22,-.09),(x+side*.29,.97,-.015),(x+side*.08,.91,.06),(x-side*.10,1.0,.055)],.24,'iron',bone)
    plate('어깨 면',[(x-side*.07,1.18,.05),(x+side*.12,1.19,.06),(x+side*.22,1.01,.13),(x+side*.08,.97,.18)],.028,color,bone)
    if kind=='bulwark':
        for j in range(2):rod('성벽 어깨 첨탑',(side*(.45+j*.10),1.12,-.07),(side*(.57+j*.16),1.38-j*.03,-.06),.065,'steel',bone,tip=.007)

def torso_badge(color,kind):
    if kind=='skirmisher':
        for s in [-1,1]:plate('사냥꾼 가슴띠',[(s*.08,1.21,.39),(s*.16,1.18,.40),(-s*.17,.71,.33),(-s*.23,.73,.33)],.035,'leather','chest')
    else:
        plate('흉갑 외곽',[(-.22,1.15,.36),(.22,1.15,.36),(.19,.79,.35),(0,.69,.39),(-.19,.79,.35)],.045,'iron','chest')
        plate('흉갑 봉인',[(0,1.10,.41),(.10,.98,.41),(0,.80,.415),(-.10,.98,.41)],.03,color,'chest')
    for s in [-1,1]:
        plate('허리 파편',[(s*.06,.60,.23),(s*.22,.60,.20),(s*.25,.29,.26),(s*.07,.35,.30)],.038,'iron','hips')
        rod('허리 테두리',(s*.07,.56,.26),(s*.08,.36,.31),.019,color,'hips')

def fitting(kind):
    color={'vanguard':'ember','skirmisher':'jade','runekeeper':'violet','bulwark':'gold'}[kind]
    torso_badge(color,kind)
    for s in [-1,1]:pauldron(s,color,kind)
    if kind=='vanguard':
        plate('깃 없는 투구 마루',[(-.065,2.04,-.13),(.065,2.04,-.13),(.052,2.33,-.17),(0,2.43,-.17),(-.052,2.33,-.17)],.09,'steel','head')
        for s in [-1,1]:plate('투구 옆 철판',[(s*.33,1.98,-.03),(s*.43,1.90,-.05),(s*.40,1.65,-.06),(s*.32,1.70,-.025)],.08,'iron','head')
    elif kind=='skirmisher':
        for s in [-1,1]:
            plate('암살자 후면 칼날',[(s*.07,1.18,-.32),(s*.18,1.14,-.31),(s*.40,1.62,-.30),(s*.36,1.68,-.30)],.035,'steel','chest')
            plate('암살자 꼬리천',[(s*.05,.58,-.25),(s*.18,.58,-.26),(s*.34,.12,-.30),(s*.21,.23,-.31)],.018,'jade','hips')
    elif kind=='runekeeper':
        halo('룬 후광',(0,1.85,-.30),.52,'gold','head')
        for x,y in [(-.43,2.25),(0,2.45),(.43,2.25)]:jewel('룬 결정',(x,y,-.28),(.075,.14,.06),color,'head')
        box('등 장서',(0,1.00,-.35),(.36,.48,.12),'iron','chest')
        for y in [.87,1.00,1.13]:box('장서 금속등',(0,y,-.43),(.32,.026,.035),'gold','chest')
    elif kind=='bulwark':
        for s in [-1,1]:
            plate('전투 깃발',[(s*.12,1.34,-.29),(s*.36,1.35,-.28),(s*.42,1.80,-.30),(s*.18,1.73,-.32)],.026,'iron','chest')
            rod('깃대',(s*.11,1.18,-.34),(s*.20,1.87,-.34),.025,'gold','chest')
            plate('깃발 표식',[(s*.19,1.46,-.305),(s*.28,1.47,-.305),(s*.30,1.67,-.305),(s*.20,1.64,-.305)],.008,'gold','chest')

def grip(top=.36,bottom=-.18):
    rod('가죽 손잡이',(0,bottom,0),(0,top,0),.052,'leather')
    for j in range(5):box('손잡이 감개',(0,bottom+.08+j*.085,0),(.112,.025,.115),'gold',bevel=.002)
    jewel('검끝 추',(0,bottom-.025,0),(.088,.085,.077),'gold')

def blade(kind):
    grip()
    scale=1.35 if kind=='greatsword' else 1
    pts=[(-.075,.33,0),(-.14,.55,0),(-.12,1.28*scale,0),(0,1.58*scale,0),(.12,1.28*scale,0),(.14,.55,0),(.075,.33,0)]
    plate('날의 단조면',pts,.068,'steel',bevel=.012)
    plate('중앙 검집 홈',[(-.035,.52,.047),(-.027,1.24*scale,.047),(0,1.40*scale,.047),(.027,1.24*scale,.047),(.035,.52,.047)],.012,'jade',bevel=.002)
    for s in [-1,1]:rod('날개 가드',(0,.34,0),(s*.30,.48,0),.053,'gold',tip=.025)
    jewel('가드 봉인',(0,.39,.075),(.065,.09,.035),'jade')

def axe(kind):
    grip(.28,-.25); height=1.25 if kind=='greataxe' else 1.00
    rod('도끼 자루',(0,.17,0),(0,height,0),.052,'leather')
    for s in [-1,1] if kind=='greataxe' else [1]:
        plate('초승달 도끼날',[(s*.03,height-.28,0),(s*.24,height-.42,0),(s*.46,height-.27,0),(s*.52,height+.12,0),(s*.32,height+.02,0),(s*.04,height+.07,0)],.12,'steel',bevel=.015)
        plate('도끼날 금속 이음',[(s*.06,height-.22,.075),(s*.24,height-.32,.075),(s*.32,height-.23,.075),(s*.18,height-.10,.075),(s*.06,height-.07,.075)],.018,'gold',bevel=.005)
    box('도끼 머리',(0,height-.08,0),(.15,.36,.20),'iron',bevel=.018)
    jewel('도끼 봉인',(0,height-.08,.13),(.055,.09,.03),'ember')

def dagger():
    grip(.16,-.20)
    plate('곡선 단검',[(-.055,.14,0),(-.09,.33,0),(-.065,.88,0),(.04,1.13,0),(.135,.78,0),(.13,.36,0),(.055,.14,0)],.055,'steel')
    plate('단검 금속등',[(-.028,.30,.035),(-.012,.84,.035),(.035,.99,.035),(.048,.75,.035),(.03,.32,.035)],.01,'jade',bevel=.002)
    box('단검 가드',(0,.17,0),(.30,.07,.11),'gold')

def staff(kind):
    low,high=(-.23,.75) if kind=='wand' else (-.48,1.42)
    rod('지팡이 몸체',(0,low,0),(0,high,0),.038,'leather')
    for y in [low+.05,.05,.28,high-.05]:box('마도 결속',(0,y,0),(.11,.06,.11),'gold')
    for s in [-1,1]:
        rod('수정 받침',(0,high-.12,0),(s*.16,high+.14,0),.045,'gold',tip=.025)
        rod('수정 갈래',(s*.16,high+.14,0),(s*.12,high+.34,0),.025,'steel',tip=.005)
    jewel('마도 수정',(0,high+.17,0),(.105,.22,.095),'violet')

def bow():
    for s in [-1,1]:
        points=[(0,0,0),(-.18,s*.30,0),(-.27,s*.63,0),(-.15,s*.85,0),(.02,s*.98,0)]
        for a,b in zip(points,points[1:]):rod('활대',a,b,.045,'leather')
        for a,b in zip(points[1:],points[2:]):rod('활대 금속등',(a[0],a[1],.038),(b[0],b[1],.038),.017,'gold')
        rod('시위',(.02,s*.98,0),(.15,0,0),.008,'ivory')
    rod('활 손잡이',(0,-.12,0),(0,.12,0),.06,'jade')

def export(name,folder,join=False):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if not join:
        groups={}
        for o in objects:groups.setdefault(o.get('tllBone'),[]).append(o)
        for bone,parts in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in parts:o.select_set(True)
            bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();bpy.context.object['tllBone']=bone
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if join:
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects=[bpy.context.object];objects[0].name=name
    bpy.context.scene.cursor.location=(0,0,0)
    for o in objects:
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        # 하나의 색 속성/PBR 재질이 런타임의 단일 드로우 배치로 합쳐진다.
        o.data.materials.clear();o.data.materials.append(material)
        for p in o.data.polygons:p.material_index=0
    bpy.ops.object.select_all(action='SELECT')
    glb=folder/(name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_animations=False,export_extras=True,export_materials='EXPORT')
    subprocess.run(['node',str(ROOT/'tools/art/compress-dungeon-forge.mjs'),str(glb)],check=True,cwd=ROOT)
    source=SOURCE/(name+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source))
    for p in [glb,source]:manifest['files'].append({'path':str(p.relative_to(ROOT)), 'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})

for kind in ['vanguard','skirmisher','runekeeper','bulwark']:
    material=clear();fitting(kind);export('forge-'+kind+'-v2',FITTINGS)
for kind in ['sword','greatsword','axe','greataxe','dagger','wand','staff','bow']:
    material=clear()
    if kind in ['sword','greatsword']:blade(kind)
    elif kind in ['axe','greataxe']:axe(kind)
    elif kind=='dagger':dagger()
    elif kind in ['wand','staff']:staff(kind)
    else:bow()
    export('forge-'+kind+'-v2',OUT,True)
manifest['deliveryCompression']='EXT_meshopt_compression, lossless meshoptimizer'
manifest['compressionScript']={'path':'tools/art/compress-dungeon-forge.mjs','sha256':hashlib.sha256((ROOT/'tools/art/compress-dungeon-forge.mjs').read_bytes()).hexdigest()}
manifest['sourceScript']={'path':str(Path(__file__).relative_to(ROOT)),'sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
manifest['preservedSources']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'public/models'/f'{n}.glb' for n in ['Knight','Barbarian','Mage','Rogue','Ranger','Skeleton_Minion','Skeleton_Warrior','Skeleton_Rogue','Skeleton_Mage']]}
(ROOT/'docs/assets/dungeon-forge-v2.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'status':'PASS','blender':bpy.app.version_string,'files':len(manifest['files'])}))
