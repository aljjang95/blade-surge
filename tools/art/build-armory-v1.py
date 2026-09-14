"""Original low-poly equipment, editable source, GLB and isolated renders.
Run with Blender 5.2 --background --python tools/art/build-armory-v1.py.
No external assets, downloads or paid providers.
"""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/armory-v1'
ICONS = ROOT / 'public/img/armory-v1'
SOURCE = ROOT / 'tools/art/source'
for p in [OUT, ICONS, SOURCE]: p.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 16
scene.render.resolution_x = 256; scene.render.resolution_y = 256; scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'; scene.render.film_transparent = True
scene.world.color = (.25, .25, .25)
scene.view_settings.view_transform = 'AgX'
names = ['anchor','echo','mercy','lance','relay','aegis']
colors = [(0.10,.55,.48),(.40,.25,.69),(.83,.48,.12),(.28,.48,.15),(.68,.24,.19),(.22,.39,.65)]
objects = []

def mat(name, color, metal):
    m = bpy.data.materials.new(name); m.diffuse_color = (*color,1); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*color,1)
    p.inputs['Metallic'].default_value = metal; p.inputs['Roughness'].default_value = .4 if metal else .7
    return m

trim = mat('Brushed brass', (.65,.47,.22), .7)
dark = mat('Dark grip', (.045,.07,.08), 0)
def box(pos, size, material, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos); o=bpy.context.object; o.scale=size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod=o.modifiers.new('Forged edges','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(material); return o
def orb(pos, size, material, vertices=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=vertices, radius=1, location=pos)
    o=bpy.context.object; o.scale=size; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(material); return o
def ring(pos, major, minor, material, rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=16, minor_segments=6, location=pos, rotation=rot)
    o=bpy.context.object; o.data.materials.append(material); return o
def motif(parts, d, material, z, scale=1):
    # Six geometrically distinct crests, also used as physical set identifiers.
    if d==0:
        parts += [ring((0,-.16,z),.18*scale,.035*scale,trim,(math.pi/2,0,0)), box((0,-.19,z-.11*scale),(.06*scale,.06*scale,.36*scale),material)]
    elif d==1:
        for x in [-.13,.13]: parts.append(box((x*scale,-.18,z),(.06*scale,.08*scale,.44*scale),trim))
        parts.append(box((0,-.18,z-.2*scale),(.31*scale,.08*scale,.07*scale),material))
    elif d==2:
        parts += [box((0,-.18,z),(.26*scale,.14*scale,.32*scale),trim),orb((0,-.28,z),(.09*scale,.07*scale,.15*scale),material)]
    elif d==3:
        for side in [-1,1]:
            for j in range(3):
                o=box((side*(.1+j*.07)*scale,-.18,z-j*.055*scale),(.07*scale,.10*scale,(.3-j*.06)*scale),trim); o.rotation_euler.y=side*.55; parts.append(o)
    elif d==4:
        parts += [ring((0,-.2,z),.15*scale,.045*scale,material,(math.pi/2,0,0)),box((0,-.25,z),(.36*scale,.06*scale,.06*scale),trim)]
    else:
        parts.append(box((0,-.18,z),(.32*scale,.1*scale,.25*scale),material))
        for x in [-.13,0,.13]: parts.append(box((x*scale,-.18,z+.16*scale),(.075*scale,.12*scale,.12*scale),trim))

for d,key in enumerate(names):
    body=mat(key, colors[d], .45)
    for slot in ['weapon','armor','ring','boots']:
        parts=[]
        if slot=='weapon':
            parts += [box((0,0,.18),(.10,.11,.48),dark),box((0,0,.42),(.43,.15,.08),trim)]
            if d==0: # wide anchor flukes
                parts.append(box((0,0,.9),(.14,.12,1),body))
                for s in [-1,1]:
                    o=box((s*.21,0,.66),(.13,.15,.52),trim); o.rotation_euler.y=s*.65; parts.append(o)
            elif d==1: # tuning-fork blade
                for s in [-1,1]: parts.append(box((s*.12,0,1),(.10,.12,1.1),body))
            elif d==2: # lantern staff
                parts.append(box((0,0,.83),(.09,.1,.85),dark)); motif(parts,d,body,1.28,1.3)
            elif d==3: # winged spear
                parts += [box((0,0,.8),(.08,.09,.9),dark),orb((0,0,1.5),(.21,.09,.46),body)]
                motif(parts,d,body,1.14,.7)
            elif d==4: # hooked shuttle
                parts += [orb((0,0,.94),(.26,.11,.6),body),ring((0,0,.74),.14,.045,trim,(math.pi/2,0,0))]
            else: # crenellated cleaver
                parts.append(box((0,0,.95),(.39,.14,.95),body))
                for x in [-.15,0,.15]: parts.append(box((x,0,1.48),(.1,.14,.17),trim))
        elif slot=='armor':
            parts += [box((0,0,.1),(.7,.28,.64),body,.08),box((0,-.02,-.25),(.75,.3,.09),trim)]
            for s in [-1,1]: parts.append(orb((s*.43,0,.28),(.22,.24,.15 if d%2 else .23),body))
            motif(parts,d,body,.1,.8)
        elif slot=='ring':
            parts.append(ring((0,0,0),.26,.055,trim,(math.pi/2,0,0))); motif(parts,d,body,.23,.8)
        else:
            for s in [-1,1]:
                parts += [box((s*.21,0,.05),(.29,.3,.51),body,.04),box((s*.21,-.12,-.22),(.31,.53,.19),dark,.04),box((s*.21,0,.32),(.33,.34,.07),trim)]
            motif(parts,d,body,.08,.55)
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts: o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join(); o=bpy.context.object
        bpy.context.scene.cursor.location=(0,0,0); bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        o.name=f'arm_{key}_{slot}'; objects.append(o)
        bpy.ops.export_scene.gltf(filepath=str(OUT/(o.name+'.glb')),export_format='GLB',use_selection=True,export_animations=False)

# Single studio rig; isolated renders of the actual exported geometry.
bpy.ops.object.camera_add(location=(2.5,-5,2.5)); camera=bpy.context.object; scene.camera=camera; camera.data.type='ORTHO'
for loc,power,size in [((2,-3,5),550,4),((-3,-2,2),350,3),((0,3,4),600,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc); light=bpy.context.object; light.data.energy=power; light.data.shape='DISK'; light.data.size=size
    light.rotation_euler=(Vector((0,0,.3))-light.location).to_track_quat('-Z','Y').to_euler()
for o in objects: o.hide_render=True
for o in objects:
    o.hide_render=False
    bounds=[o.matrix_world@Vector(c) for c in o.bound_box]; center=sum(bounds,Vector())/8
    height=max(v.z for v in bounds)-min(v.z for v in bounds); width=max(v.x for v in bounds)-min(v.x for v in bounds)
    camera.location=center+Vector((2.3,-5,2.5)); camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.ortho_scale=max(height,width)*1.35+.15
    scene.render.filepath=str(ICONS/(o.name+'.png')); bpy.ops.render.render(write_still=True); o.hide_render=True
for i,o in enumerate(objects): o.hide_render=False; o.location=(i%4*2.6,i//4*2.6,0)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'armory-v1.blend'))
files=[p for root in [OUT,ICONS,SOURCE] for p in root.glob('*') if p.suffix in ['.glb','.png','.blend']]
manifest={'revision':'armory-v1','blender':bpy.app.version_string,'license':'Original project-authored geometry; no third-party inputs','files':[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
(ROOT/'work/owner-expansion-20260914/asset-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
