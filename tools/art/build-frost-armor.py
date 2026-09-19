"""서리결정 원화를 기존 검성 리그에 맞춘 입체 갑주로 제작한다. 원본 불변."""
import bpy, math, os, json, hashlib
from mathutils import Vector
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
ART = os.path.join(ROOT, 'art/frost-armor-v1')
OUT = os.path.join(ROOT, 'public/models/frost-armor-v1')
os.makedirs(ART, exist_ok=True); os.makedirs(OUT, exist_ok=True)
SOURCE = os.path.join(ROOT, 'art/heroes-v3/knight-v3.blend')
REF = os.path.join(ROOT, 'public/img/it_frost_armor.webp')
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
source_hash, ref_hash = sha(SOURCE), sha(REF)
bpy.ops.wm.open_mainfile(filepath=SOURCE)
assert bpy.app.version[:3] == (5, 2, 1)
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
authored = []
def v(p): return (p[0], -p[2], p[1])
def material(name, color, metal, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.diffuse_color = (*color, 1)
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    return m
steel = material('Frost_darksteel', (.025, .095, .145), .48, .46)
silver = material('Frost_silver', (.48, .66, .72), .68, .33)
ice = material('Frost_crystal', (.035, .39, .57), .08, .23)
ice.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value = (.01, .06, .08, 1)
def mesh(name, verts, faces, mat, bone):
    me = bpy.data.meshes.new(name); me.from_pydata([v(p) for p in verts], [], faces); me.update()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    o.data.materials.append(mat); o['tllBone'] = bone; authored.append(o)
    return o
def plate(name, outline, depth, mat, bone='chest'):
    n = len(outline); verts = outline + [(x, y, z-depth) for x, y, z in outline]
    faces = [tuple(range(n)), tuple(range(n, 2*n))[::-1]]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    o = mesh(name, verts, faces, mat, bone)
    bpy.context.view_layer.objects.active = o
    bevel = o.modifiers.new('Forged edge', 'BEVEL'); bevel.width = .006; bevel.segments = 2
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    return o
def gem(name, x, y, z, width, height, bone):
    # 앞뒤로 두께가 있는 결정. 투명 재질 정렬 문제를 만들지 않는다.
    ring = [(x,y+height,z),(x+width,y+.1*height,z),(x+.68*width,y-.62*height,z),(x,y-height,z),(x-.68*width,y-.62*height,z),(x-width,y+.1*height,z)]
    verts = ring + [(x+.02,y+.08*height,z+.09),(x,y,z-.035)]
    faces = [(i,(i+1)%6,6) for i in range(6)] + [(i,7,(i+1)%6) for i in range(6)]
    return mesh(name, verts, faces, ice, bone)
# 원화의 은색 윤곽·가슴 결정·분절 어깨를 따른다. 얼굴·머리·리그는 보존한다.
outline = [(-.27,1.235,.31),(-.13,1.28,.33),(0,1.225,.35),(.13,1.28,.33),(.27,1.235,.31),(.26,1.05,.355),(.18,.90,.37),(0,.785,.385),(-.18,.90,.37),(-.26,1.05,.355)]
plate('Silver breastplate silhouette', outline, .07, silver)
plate('Blue steel breastplate', [(x*.91,(y-1.04)*.86+1.04,z+.015) for x,y,z in outline], .045, steel)
gem('Heart of rime', 0,1.07,.405,.14,.205,'chest')
for side in [-1,1]:
    bone = 'upperarm.' + ('l' if side > 0 else 'r'); cx = side*.355
    for layer in range(3):
        pts = [(cx+side*x,y,z) for x,y,z in [(-.145,1.36-layer*.075,.155),(.015,1.425-layer*.075,.135),(.175,1.35-layer*.075,.125),(.225,1.245-layer*.075,.15),(.065,1.18-layer*.075,.24),(-.12,1.25-layer*.075,.245)]]
        plate('Scalloped shoulder rim',pts,.20,silver,bone)
        center = (cx+side*.04,1.3-layer*.075)
        plate('Shoulder enamel',[(center[0]+(x-center[0])*.86,center[1]+(y-center[1])*.77,z+.012) for x,y,z in pts],.04,steel,bone)
    gem('Shoulder ice crystal',cx+side*.04,1.29,.282,.082,.125,bone)
    # 옆구리를 감싸는 세 겹 판금. 앞면만 붙인 평면 장식으로 끝내지 않는다.
    for row in range(3):
        y = 1.14-row*.105
        plate('Articulated flank',[(side*.23,y+.055,.34),(side*.33,y+.025,.16),(side*.30,y-.07,-.07),(side*.25,y-.08,.29)],.025,silver if row==2 else steel)
    # 다리 동작을 방해하지 않는 짧은 분할 허리 보호판.
    x = side*.19; bone = 'hips'
    pts = [(x-.115,.825,.36),(x+.115,.825,.36),(x+.09,.63,.38),(x,.565,.39),(x-.09,.63,.38)]
    plate('Waist silver tasset',pts,.03,silver,bone)
    plate('Waist blue inlay',[(x+(px-x)*.74,(py-.72)*.82+.72,pz+.012) for px,py,pz in pts],.022,steel,bone)
# 뒷면의 어깨날·등뼈와 양옆 체결부를 실제 볼륨으로 제작한다.
back = [(-.255,1.235,-.19),(.255,1.235,-.19),(.245,1.01,-.245),(.15,.845,-.24),(0,.82,-.27),(-.15,.845,-.24),(-.245,1.01,-.245)]
plate('Backplate silver silhouette',back,-.07,silver)
plate('Backplate darksteel',[(x*.88,(y-1.04)*.85+1.04,z-.015) for x,y,z in back],-.04,steel)
for y in [1.20,1.10,1.0,.90]:
    plate('Spine articulated ridge',[(-.045,y+.05,-.286),(.045,y+.05,-.286),(.032,y-.04,-.31),(-.032,y-.04,-.31)],-.022,silver)
# 메시만 내보내고 편집 원본의 기존 카메라·참고 리그는 공개 런타임에 넣지 않는다.
bpy.ops.object.select_all(action='DESELECT')
for o in authored: o.select_set(True)
output = os.path.join(OUT,'knight-rime.glb')
bpy.ops.export_scene.gltf(filepath=output,export_format='GLB',use_selection=True,export_extras=True,export_animations=False)
for o in authored:
    wanted = o['tllBone'].replace('.','')
    bone = next(b.name for b in rig.data.bones if b.name.replace('.','') == wanted)
    group = o.vertex_groups.new(name=bone); group.add(list(range(len(o.data.vertices))),1,'REPLACE')
    modifier = o.modifiers.new('Retained game rig','ARMATURE'); modifier.object = rig
    world = o.matrix_world.copy(); o.parent = rig; o.matrix_world = world
reference = bpy.data.images.load(REF,check_existing=True); reference.pack()
scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.use_denoising = True
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for d in prefs.devices: d.use = d.type == 'OPTIX'
    if any(d.type == 'OPTIX' for d in prefs.devices): scene.cycles.device = 'GPU'
except Exception: scene.cycles.device = 'CPU'
scene.render.resolution_x = 768; scene.render.resolution_y = 768; scene.render.resolution_percentage = 100
cam = scene.camera; target = Vector(v((0,1.15,0))); cam.data.ortho_scale = 2.7
for view,pos in [('front',(0,2.05,6.5)),('side',(6.5,2.05,0)),('back',(0,2.05,-6.5))]:
    cam.location=v(pos); cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=os.path.join(ART,view+'.png'); bpy.ops.render.render(write_still=True)
cam.location=v((3.2,2.3,6.5)); cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
for enabled,name in [(False,'before'),(True,'after')]:
    for o in authored: o.hide_render = not enabled
    scene.render.filepath=os.path.join(ART,name+'.png'); bpy.ops.render.render(write_still=True)
for o in authored: o.hide_render=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART,'knight-rime.blend'))
assert sha(SOURCE)==source_hash and sha(REF)==ref_hash
receipt={'blender':bpy.app.version_string,'image_reference':'public/img/it_frost_armor.webp','reference_sha256':ref_hash,'retained_source':'art/heroes-v3/knight-v3.blend','retained_source_sha256':source_hash,'output':'public/models/frost-armor-v1/knight-rime.glb','sha256':sha(output),'bytes':os.path.getsize(output),'meshes':len(authored),'vertices':sum(len(o.data.vertices) for o in authored),'bones':sorted(set(o['tllBone'] for o in authored)),'materials':[m.name for m in [steel,silver,ice]],'scope':'Authored armor only. Original face, hair, rig and animations retained. Studio images are not game screenshots.'}
with open(os.path.join(ART,'manifest.json'),'w',encoding='utf-8') as f: json.dump(receipt,f,indent=2)
print('FROST_ARMOR_CREATED',json.dumps(receipt),flush=True)
