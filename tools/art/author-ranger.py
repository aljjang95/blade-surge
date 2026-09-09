"""Run through Blender MCP in an isolated factory-startup workshop.

Keeps the CC0 KayKit Ranger head, medium rig and quiver; authors a fitted
forest outfit and a two-handed bow pose. SOURCE and OUTPUT are caller supplied.
Existing scenes and source assets are preserved.
"""
import bpy, math, os
from mathutils import Vector, Matrix

scene = bpy.data.scenes.new('Silva_Forest_Warden')
bpy.context.window.scene = scene
bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCE, 'Characters/gltf/Ranger.glb'))
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
rig.name = 'Ranger_Rig'
for o in list(scene.objects):
    if o.type == 'MESH' and o.name.split('.')[0] not in ['Ranger_Head', 'Ranger_Quiver']:
        o.hide_render = True
        o.hide_set(True)

def v(p): return Vector((p[0], -p[2], p[1]))
def mat(name, color, rough=.85, metal=0):
    m = bpy.data.materials.new(name); m.diffuse_color = (*color, 1); m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    return m

forest = mat('Silva • soft forest cloth', (.115,.29,.19))
sage = mat('Silva • sage lining', (.34,.47,.25))
leather = mat('Silva • saddle leather', (.29,.15,.065))
gold = mat('Silva • warm brass seam', (.70,.45,.18), .55, .18)
dark = mat('Silva • deep boots', (.065,.115,.09))
skin = mat('Silva • warm skin', (.72,.48,.31))
ivory = mat('Silva • linen scarf', (.75,.70,.47))
created=[]
def bind(o, bone, material):
    o.data.materials.append(material); o.name='TLL_Silva_'+o.name
    o['tllBone']=bone
    group=o.vertex_groups.new(name=bone); group.add(list(range(len(o.data.vertices))),1,'REPLACE')
    mod=o.modifiers.new('KayKit articulation','ARMATURE'); mod.object=rig
    o.parent=rig
    created.append(o)
    return o
def ball(name, p, s, material, bone):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,location=v(p))
    o=bpy.context.object; o.name=name; o.scale=(s[0],s[2],s[1])
    bpy.ops.object.transform_apply(location=True,rotation=False,scale=True)
    for f in o.data.polygons: f.use_smooth=True
    return bind(o,bone,material)
def panel(name, points, depth, material, bone, bevel=.012):
    points=list(points); n=len(points)
    me=bpy.data.meshes.new(name)
    me.from_pydata([v(p) for p in points]+[v((x,y,z-depth)) for x,y,z in points],[],[tuple(range(n)),tuple(range(n,n*2))[::-1]]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])
    me.update(); o=bpy.data.objects.new(name,me);scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o; o.select_set(True)
    mod=o.modifiers.new('Soft tailored edge','BEVEL'); mod.width=bevel;mod.segments=3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return bind(o,bone,material)

ball('Neck',(0,1.335,-.025),(.135,.19,.13),skin,'chest')
ball('Quilted jacket',(0,.98,-.005),(.285,.285,.225),forest,'chest')
ball('Linen shirt',(0,1.10,.195),(.16,.125,.04),ivory,'chest')
ball('Waist',(0,.715,-.015),(.25,.105,.19),leather,'hips')
for side,s in [('l',1),('r',-1)]:
    ball('Sleeve',(s*.33,1.10,0),(.15,.12,.12),forest,'upperarm.'+side)
    ball('Bracer',(s*.59,1.10,0),(.145,.112,.115),leather,'lowerarm.'+side)
    ball('Glove',(s*.80,1.085,.02),(.095,.10,.10),dark,'hand.'+side)
    ball('Thigh',(s*.17,.46,0),(.13,.14,.14),forest,'upperleg.'+side)
    ball('Boot',(s*.17,.24,.015),(.135,.15,.14),leather,'lowerleg.'+side)
    ball('Toe',(s*.17,.085,.09),(.145,.08,.23),dark,'foot.'+side)
    ball('Shoulder capelet',(s*.29,1.15,0),(.17,.145,.17),sage,'upperarm.'+side)
    panel('Boot stitched cuff',[(s*.17-.11,.36,.10),(s*.17+.11,.36,.10),(s*.17+.10,.31,.13),(s*.17-.10,.31,.13)],.03,gold,'lowerleg.'+side)
    panel('Split coat tail',[(s*.015,.79,.18),(s*.26,.79,.14),(s*.29,.39,.11),(s*.13,.32,.18),(s*.035,.47,.21)],.055,forest,'hips')
    panel('Tail piping',[(s*.24,.77,.175),(s*.266,.77,.175),(s*.296,.40,.145),(s*.273,.405,.145)],.012,gold,'hips',.004)
panel('Diagonal satchel strap',[(-.225,1.19,.205),(-.16,1.205,.225),(.255,.82,.21),(.185,.80,.245)],.025,leather,'chest')
panel('Forest leaf clasp',[(-.045,1.145,.262),(0,1.19,.27),(.048,1.13,.265),(0,1.055,.275)],.025,gold,'chest')
ball('Hip pouch',(-.27,.735,.06),(.095,.105,.08),leather,'hips')
ball('Pouch stud',(-.27,.76,.137),(.017,.02,.009),gold,'hips')

# Original CC0 weapon, attached at the actual left-hand socket.
bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCE,'Assets/gltf/bow_withString.gltf'))
bow=next(o for o in bpy.context.selected_objects if o.type=='MESH')
bow.name='Bow'
bow.parent=rig;bow.parent_type='BONE';bow.parent_bone='handslot.l'
bow.matrix_parent_inverse=Matrix.Identity(4)
bow.location=(0,0,0);bow.rotation_euler=(0,0,0)
bpy.context.view_layer.update()
bow_rotation=Matrix(((0,0,-1),(-1,0,0),(0,1,0))).to_4x4()
bow.matrix_world=Matrix.Translation(rig.pose.bones['handslot.l'].head)@bow_rotation@Matrix.Diagonal((.72,.72,.72,1))
bpy.context.view_layer.update()

# Author the draw/release on the actual medium rig. Target helpers remain in
# the editable studio; visual baking exports only the resulting joint motion.
scene.render.fps=30;scene.frame_start=1;scene.frame_end=25
targets={}
for side,pos in [('l',(.24,-.48,1.2)),('r',(-.13,-.17,1.29))]:
    target=bpy.data.objects.new('Silva aim wrist '+side,None);scene.collection.objects.link(target);target.location=pos;targets[side]=target
    pole=bpy.data.objects.new('Silva aim elbow '+side,None);scene.collection.objects.link(pole);pole.location=(.8 if side=='l' else -.8,0,1.1)
    ik=rig.pose.bones['lowerarm.'+side].constraints.new('IK');ik.name='Silva aim';ik.target=target;ik.pole_target=pole;ik.chain_count=2;ik.iterations=100
positions={1:((.28,-.40,1.13),(-.15,-.20,1.23)),6:((.24,-.48,1.20),(-.16,-.10,1.31)),11:((.24,-.48,1.20),(-.12,-.32,1.24)),14:((.24,-.47,1.18),(-.12,-.33,1.23)),25:((.28,-.40,1.13),(-.15,-.20,1.23))}
for frame,(left,right) in positions.items():
    for side,pos in [('l',left),('r',right)]:targets[side].location=pos;targets[side].keyframe_insert('location',frame=frame)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.nla.bake(frame_start=1,frame_end=25,only_selected=False,visual_keying=True,clear_constraints=True,use_current_action=False,bake_types={'POSE'})
rig.animation_data.action.name='Bow_Shoot';scene.frame_set(1)

# Export selected source head/quiver, custom fitted outfit, rig and bow only.
export_objects=[rig,bow]+created+[o for o in scene.objects if o.name.split('.')[0] in ['Ranger_Head','Ranger_Quiver']]
for o in export_objects: o.hide_set(False); o.hide_render=False
rig['tllIdentity']='casual-v2'; rig['character']='Silva'; rig['source']='KayKit Adventurers 2.0 FREE / CC0'
bpy.ops.object.select_all(action='DESELECT')
for o in export_objects:o.select_set(True)
bpy.context.view_layer.objects.active=rig
os.makedirs(OUTPUT,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT,'silva-workshop.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUTPUT,'Ranger-authored.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_extras=True,export_animations=True,export_animation_mode='ACTIONS')
result={'scene':scene.name,'file':bpy.data.filepath,'objects':len(export_objects),'mesh_vertices':sum(len(o.data.vertices) for o in export_objects if o.type=='MESH'),'bow_bounds':list(bow.dimensions),'rig_bones':len(rig.data.bones)}
