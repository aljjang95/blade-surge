"""Build the TLL authored dungeon landmark pack with Blender 5.2.1 LTS.

The runtime dungeon kit remains collision-safe and shared. These six authored
landmarks provide a strong silhouette and a visual subject for each dungeon
family without changing the existing hero or enemy rigs.
"""
import bpy, hashlib, json, math, random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'art' / 'dungeon-landmarks-v1'
OUT = ROOT / 'public' / 'models' / 'tll' / 'dungeons'
ART.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
random.seed(210921)

source = bpy.data.collections.new('TLL DUNGEONS | authored source')
scene.collection.children.link(source)
studio = bpy.data.collections.new('STUDIO | preview only')
scene.collection.children.link(studio)

def mat(name, color, rough=.75, metal=0, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes.get('Principled BSDF')
    rgb = [int(color[i:i+2], 16) / 255 for i in (0, 2, 4)]
    linear = [((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in rgb]
    m.diffuse_color = (*linear, 1)
    n.inputs['Base Color'].default_value = (*linear, 1)
    n.inputs['Roughness'].default_value = rough
    n.inputs['Metallic'].default_value = metal
    if emission:
        n.inputs['Emission Color'].default_value = (*linear, 1)
        n.inputs['Emission Strength'].default_value = emission
    return m

def move_to(o, collection):
    for c in list(o.users_collection): c.objects.unlink(o)
    collection.objects.link(o)
    return o

def box(name, loc, scale, material, bevel=.06, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = move_to(bpy.context.object, source)
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('TLL soft carved edge', 'BEVEL')
        b.width = bevel; b.segments = 2
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=b.name)
    o.data.materials.append(material)
    if parent: o.parent = parent
    return o

def cylinder(name, loc, radius, depth, material, vertices=20, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o = move_to(bpy.context.object, source); o.name = name; o.data.materials.append(material)
    if parent: o.parent = parent
    return o

def torus(name, loc, major, minor, material, rotation=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=32, minor_segments=6, major_radius=major, minor_radius=minor, location=loc, rotation=rotation)
    o = move_to(bpy.context.object, source); o.name = name; o.data.materials.append(material)
    if parent: o.parent = parent
    return o

def cone(name, loc, r1, r2, depth, material, vertices=12, parent=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc)
    o = move_to(bpy.context.object, source); o.name = name; o.data.materials.append(material)
    if parent: o.parent = parent
    return o

def branch(name, start, end, r1, r2, material, parent=None):
    a, b = Vector(start), Vector(end); d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=r1, radius2=r2, depth=d.length, location=(a + b) / 2)
    o = move_to(bpy.context.object, source); o.name = name; o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler(); o.data.materials.append(material)
    if parent: o.parent = parent
    return o

def orb(name, loc, radius, material, parent=None):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=loc)
    o = move_to(bpy.context.object, source); o.name = name; o.data.materials.append(material)
    if parent: o.parent = parent
    return o

def make_root(key):
    root = bpy.data.objects.new(f'TLL_Dungeon_{key}_Landmark', None)
    source.objects.link(root)
    root['tllIdentity'] = 'dungeon-landmark-v1'
    root['environmentKey'] = key
    root['authoring'] = 'Blender 5.2.1 LTS / original TLL geometry'
    return root

def materials_for(key):
    palettes = {
        'memorial': ('506b67', 'b4c4b0', 'c39b5c', '6be0c0', '253938'),
        'kiln': ('493b3b', 'c28b57', 'ff6d32', 'ffd06a', '241619'),
        'archive': ('354762', 'a4c8e6', '75b8ff', 'e0f5ff', '182136'),
        'beacon': ('294f5a', '8fbfc2', '52e4dc', 'd1fbf0', '142b35'),
        'tribunal': ('55465a', 'c6aa78', 'e7b7e9', 'ffe0b8', '241b2d'),
        'confluence': ('3c5f4e', '9ec38c', '78e6ad', 'd9ffb4', '1c322b'),
    }
    a, b, c, glow, dark = palettes[key]
    return [mat(f'TLL {key} stone', a), mat(f'TLL {key} trim', b, .42, .45), mat(f'TLL {key} glow', c, .35, .15, 1.8), mat(f'TLL {key} light', glow, .3, 0, 3), mat(f'TLL {key} shadow', dark)]

def build_memorial(root, m):
    # Bell memorial with broken chapel silhouette.
    box('Memorial plinth', (0, .3, 0), (8, .6, 3.2), m[4], .12, root)
    for x in (-3.1, 3.1):
        box('Memorial pillar', (x, 3.4, 0), (.7, 6.2, .9), m[0], .08, root)
        box('Memorial capital', (x, 6.5, 0), (1.15, .35, 1.2), m[1], .06, root)
    box('Memorial lintel', (0, 6.25, 0), (6.5, .65, .9), m[1], .08, root)
    torus('Memory bell rim', (0, 4.8, 0), 1.55, .18, m[2], (math.pi / 2, 0, 0), root)
    cone('Memory bell', (0, 4.25, 0), 1.35, .62, 1.25, m[1], 24, root)
    cylinder('Bell clapper', (0, 3.55, 0), .16, 1.2, m[2], 12, root)
    for x in (-2.0, 2.0):
        box('Memorial slate', (x, 1.15, -.8), (1.05, 1.7, .18), m[1], .05, root)
        torus('Memorial rune', (x, 1.2, -.58), .42, .045, m[3], (math.pi / 2, 0, 0), root)
    for x in (-3.8, 3.8):
        branch('Memorial vine', (x, .5, 1.0), (x * .72, 3.0, .8), .11, .025, m[2], root)

def build_kiln(root, m):
    # Twin furnace mouths and an overhead pipe spine.
    box('Kiln plinth', (0, .25, 0), (8.6, .5, 4.1), m[4], .12, root)
    for x in (-2.4, 2.4):
        box('Kiln furnace', (x, 2.5, 0), (2.4, 4.6, 2.6), m[0], .1, root)
        box('Kiln mouth frame', (x, 1.9, -1.35), (1.35, 1.65, .22), m[1], .04, root)
        box('Kiln mouth', (x, 1.9, -1.58), (1.0, 1.2, .08), m[2], .02, root)
        cylinder('Kiln chimney', (x, 6.0, .25), .7, 3.7, m[1], 16, root)
        torus('Kiln collar', (x, 5.7, .25), .74, .1, m[2], parent=root)
    for x in (-1.2, 0, 1.2):
        branch('Kiln overhead pipe', (x - .8, 6.8, 0), (x + .8, 6.8, .3), .18, .18, m[1], root)
        torus('Kiln pipe ring', (x, 6.8, .12), .24, .055, m[3], parent=root)
    for x in (-3.2, 3.2): orb('Kiln ember', (x, 2.0, -1.75), .28, m[3], root)

def build_archive(root, m):
    # Tall shelves frame a suspended celestial index.
    box('Archive plinth', (0, .25, 0), (8.4, .5, 3.8), m[4], .1, root)
    for x in (-3.0, 3.0):
        box('Archive shelf', (x, 3.3, .25), (1.4, 5.8, 1.8), m[0], .06, root)
        for z in (1.1, 2.2, 3.3, 4.4, 5.5):
            box('Archive shelf board', (x, z, -.7), (1.25, .12, 1.8), m[1], .02, root)
            for i in range(4): box('Archive volume', (x - .82 + i * .55, z + .35, -.62), (.32, .58 + (i % 2) * .2, .38), m[1 if i % 3 else 2], .015, root)
    torus('Archive celestial ring', (0, 4.2, -.1), 2.2, .12, m[2], (math.pi / 2, 0, 0), root)
    torus('Archive celestial orbit', (0, 4.2, -.1), 1.45, .08, m[3], (math.pi / 3, 0, math.pi / 7), root)
    orb('Archive star core', (0, 4.2, -.1), .42, m[3], root)
    for x in (-2.0, 2.0): branch('Archive hanging chain', (x, 7.0, .3), (x, 4.9, .1), .05, .025, m[1], root)

def build_beacon(root, m):
    # A sea gate / lighthouse hybrid with a visible horizon-facing lens.
    box('Beacon pier', (0, .2, 0), (8.8, .4, 4.2), m[4], .12, root)
    cylinder('Beacon tower', (0, 3.4, 0), 1.45, 6.4, m[0], 20, root)
    for y in (1.2, 3.0, 4.8): torus('Beacon tower brace', (0, y, 0), 1.5, .1, m[1], parent=root)
    cylinder('Beacon lens', (0, 5.4, -1.2), .8, .35, m[3], 20, root)
    torus('Beacon lens ring', (0, 5.4, -1.38), .9, .1, m[2], (math.pi / 2, 0, 0), root)
    for x in (-3.2, 3.2):
        branch('Beacon seawall', (x, .5, -1), (x * .65, 2.5, 1), .22, .1, m[1], root)
        orb('Beacon sea crystal', (x * .72, 1.2, 1.1), .4, m[2], root)

def build_tribunal(root, m):
    # Four witness monoliths and a high empty throne.
    box('Tribunal plinth', (0, .2, 0), (9.0, .4, 4.6), m[4], .12, root)
    for x in (-3.0, 3.0):
        for z in (-1.0, 1.5):
            box('Tribunal monolith', (x, 2.8, z), (1.0, 5.2, .7), m[0], .08, root)
            torus('Tribunal oath mark', (x, 3.3, z - .4), .42, .06, m[2], (math.pi / 2, 0, 0), root)
    box('Empty throne back', (0, 3.4, 1.0), (3.0, 5.5, .35), m[1], .08, root)
    box('Empty throne seat', (0, 1.45, .2), (3.4, .4, 2.4), m[1], .06, root)
    for x in (-1.6, 1.6): box('Empty throne arm', (x, 2.1, .2), (.35, 1.3, 2.3), m[1], .05, root)
    cone('Crown shard', (0, 5.9, .6), .75, .12, 1.5, m[3], 6, root)

def build_confluence(root, m):
    # Three root bridges converge on a return gate and a living crystal.
    box('Confluence plinth', (0, .2, 0), (9.2, .4, 4.4), m[4], .12, root)
    for x in (-3.0, 0, 3.0):
        branch('Confluence root arch', (x, .6, -1.0), (x * .45, 5.4, .6), .38, .08, m[0], root)
        branch('Confluence root branch', (x * .45, 3.7, .4), (x * .2, 5.5, -1.1), .14, .03, m[1], root)
    torus('Return gate', (0, 3.8, .2), 2.5, .18, m[1], (math.pi / 2, 0, 0), root)
    torus('Return gate glow', (0, 3.8, .18), 2.1, .08, m[2], (math.pi / 2, 0, 0), root)
    orb('Living return crystal', (0, 3.8, .1), .64, m[3], root)
    for x in (-3.8, 3.8):
        for z in (-1.2, 1.2): orb('Confluence moss light', (x, .8, z), .3, m[2], root)

BUILDERS = {'memorial': build_memorial, 'kiln': build_kiln, 'archive': build_archive, 'beacon': build_beacon, 'tribunal': build_tribunal, 'confluence': build_confluence}
roots = []
for key, builder in BUILDERS.items():
    root = make_root(key); builder(root, materials_for(key)); roots.append(root)

# A studio preview camera is kept in the editable source but excluded from GLB.
world = bpy.data.worlds.new('TLL dungeon studio world'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.025, .04, .07, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .35
scene.world = world
light_data = bpy.data.lights.new('TLL preview key', 'AREA'); light_data.energy = 1600; light_data.shape = 'DISK'; light_data.size = 8
light = bpy.data.objects.new('TLL preview key', light_data); studio.objects.link(light); light.location = (8, 12, -10); light.rotation_euler = (Vector((0, 2, 0)) - light.location).to_track_quat('-Z', 'Y').to_euler()
cam_data = bpy.data.cameras.new('TLL dungeon preview'); cam = bpy.data.objects.new('TLL dungeon preview', cam_data); studio.objects.link(cam); cam.location = (14, 12, 18); cam.rotation_euler = (Vector((0, 3, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam_data.lens = 42; scene.camera = cam
scene.render.engine = 'BLENDER_EEVEE'; scene.render.resolution_x = 1600; scene.render.resolution_y = 900; scene.render.resolution_percentage = 100; scene.render.image_settings.file_format = 'PNG'; scene.render.filepath = str(ART / 'dungeon-landmarks-v1-beauty.png')

# Export only authored landmark meshes. All source objects are selected, but
# preview camera and lights live in a separate collection.
bpy.ops.object.select_all(action='DESELECT')
for obj in source.objects: obj.select_set(True)
bpy.context.view_layer.objects.active = roots[0]
file = OUT / 'dungeon-landmarks-v1.glb'
bpy.ops.export_scene.gltf(filepath=str(file), export_format='GLB', use_selection=True, export_animations=False, export_cameras=False, export_lights=False, export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'dungeon-landmarks-v1.blend'))
bpy.ops.render.render(write_still=True)

triangles = 0
object_count = 0
for o in roots:
    object_count += 1
    for child in o.children_recursive:
        if child.type == 'MESH': triangles += sum(max(0, len(p.vertices) - 2) for p in child.data.polygons)
receipt = {
    'blender': bpy.app.version_string,
    'generator': str(Path(__file__).relative_to(ROOT)),
    'licence': 'Original authored TLL environment geometry; no external models or textures',
    'landmarks': list(BUILDERS), 'object_count': object_count, 'triangles': triangles,
    'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
    'editable': str((ART / 'dungeon-landmarks-v1.blend').relative_to(ROOT)),
    'runtime': str(file.relative_to(ROOT)), 'heroes_modified': False,
}
(OUT / 'manifest.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print('DUNGEON_LANDMARK_RECEIPT ' + json.dumps(receipt))
