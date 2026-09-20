"""공통 원본에서 다섯 장비를 제작한다. 원본 불변·실행별 새 폴더·기계 시간 기록."""
from pathlib import Path
import argparse, hashlib, json, math, re, sys, time
import bpy, bmesh
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--out',required=True)
a=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(a.out).resolve();allowed=(ROOT/'public/models/armor-pilot').resolve()
assert out.parent==allowed and re.fullmatch(r'[a-z0-9-]+',out.name), 'Output must be a new armor-pilot revision'
assert not out.exists(), 'Existing revision is immutable; choose a new revision'
recipes_path=ROOT/'art/armor-pilot/recipes.json'
recipes=json.loads(recipes_path.read_text(encoding='utf-8'))
assert len(recipes['variants'])<=5 and len(recipes['variants'])>0, 'Bounded batch size exceeded'
assert recipes['source']=='source-r2.blend', 'Unregistered source'
assert len(set(r['id'] for r in recipes['variants']))==len(recipes['variants']), 'Duplicate recipe ID'
for r in recipes['variants']:
    assert r['id'] in {'a_leather','a_bronze','a_knight','a_rime','a_king'}, 'Unknown appearance ID'
    assert type(r['rank']) is int and 0<=r['rank']<=4
    assert type(r['layers']) is int and 0<=r['layers']<=3
    assert all(type(r[k]) is bool for k in ['crystals','engraving','royal'])
    assert all(len(r[k])==3 and all(type(c) in (int,float) and math.isfinite(c) and 0<=c<=1 for c in r[k]) for k in ['body','trim','cloth'])
source=ROOT/'art/armor-pilot'/recipes['source']
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
source_hash=sha(source);start=time.perf_counter()
bpy.ops.wm.open_mainfile(filepath=str(source));assert bpy.app.version[:3]==(5,2,1)
scene=bpy.context.scene;rig=next(o for o in scene.objects if o.type=='ARMATURE')
source_objects=[o for o in scene.objects if o.type=='MESH' and o.get('tllBone') and not o.hide_render]
assert len(source_objects)>50 and any(o.name=='R2_Heart crystal' for o in source_objects)
for o in source_objects:
    for m in o.modifiers:
        if m.type=='ARMATURE':m.show_viewport=False;m.show_render=False
bpy.context.view_layer.update()
out.mkdir();master_dir=ROOT/'art/armor-pilot'/out.name;master_dir.mkdir()
reports=[]
def material(name,c,metal=0,rough=.6):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*c,1)
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
def include(o,r):
    n=o.name
    if not n.startswith('R2_'):return not (r['rank']<2 and n.startswith('Coat gold edge'))
    if ('crystal' in n.lower() or 'glacier' in n.lower()) and not r['crystals']:return False
    if ('engraved' in n or 'engraving' in n or 'chevron' in n) and not r['engraving']:return False
    if n.startswith(('R2_Shoulder silver rim','R2_Shoulder blue plate')):return int(n.rsplit(' ',1)[-1])<r['layers']
    if r['rank']==0 and n.startswith(('R2_Tasset','R2_Rib silver','R2_Side rib')):return False
    return True
for r in recipes['variants']:
    clock=time.perf_counter();selected=[o for o in source_objects if include(o,r)]
    body=material(r['id']+'_body',r['body'],0 if r['rank']==0 else .25,.8 if r['rank']==0 else .4)
    trim=material(r['id']+'_trim',r['trim'],.15 if r['rank']==0 else .68,.6 if r['rank']==0 else .34)
    cloth=material(r['id']+'_cloth',r['cloth'],0,.9)
    enamel=bpy.data.materials['R2_Midnight_Enamel'] if r['id']=='a_rime' else body
    ice=bpy.data.materials['R2_Glacier_Crystal'] if r['id']=='a_rime' else material(r['id']+'_garnet',(.35,.008,.033),.05,.22)
    edge=bpy.data.materials['R2_Ice_Edge'] if r['id']=='a_rime' else trim
    replacements={'R2_Burnished_Silver':trim,'R2_Midnight_Enamel':enamel,'R2_Glacier_Crystal':ice,'R2_Ice_Edge':edge,
                  'V3 Woven cloth':cloth,'V3 Brushed gold':trim,'V3 Ivory enamel':body,'V3 Blackened steel':body}
    clones=[];graph=bpy.context.evaluated_depsgraph_get()
    for o in selected:
        me=bpy.data.meshes.new_from_object(o.evaluated_get(graph),depsgraph=graph)
        clone=bpy.data.objects.new(o.name+'_delivery',me);scene.collection.objects.link(clone)
        clone.matrix_world=o.matrix_world.copy();clone['tllBone']=o['tllBone']
        for slot in clone.material_slots:
            if o['tllBone']!='head':slot.material=replacements.get(slot.material.name,slot.material)
        if not me.uv_layers:
            uv=me.uv_layers.new(name='UVMap')
            for li,loop in enumerate(me.loops):p=me.vertices[loop.vertex_index].co;uv.data[li].uv=(p.x+.5,p.z)
        clones.append(clone)
    if r['royal']:
        for side in [-1,1]:
            # 왕의 갑주는 색뿐 아니라 쇄골과 가슴의 별도 문장으로 식별한다.
            for k in range(3):
                x=side*(.055+k*.035);y=1.17-k*.04;z=.425
                pts=[(x-side*.028,y-.10,z),(x+side*.012,y-.13,z+.015),(x+side*.085,y+.03,z),(x+side*.008,y,z+.02)]
                verts=[(px,-pz,py) for px,py,pz in pts]+[(px,-pz+.017,py) for px,py,pz in pts]
                faces=[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)]
                me=bpy.data.meshes.new('Royal heraldry');me.from_pydata(verts,[],faces);me.update()
                o=bpy.data.objects.new('Royal_wing_'+str(side)+'_'+str(k),me);scene.collection.objects.link(o)
                me.materials.append(trim);o['tllBone']='chest';me.uv_layers.new(name='UVMap');clones.append(o)
    for o in clones:
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bmesh.ops.dissolve_degenerate(bm,dist=1e-7,edges=list(bm.edges))
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
        assert all(math.isfinite(c) for v in o.data.vertices for c in v.co)
    bpy.ops.object.select_all(action='DESELECT')
    for o in clones:o.select_set(True)
    bpy.context.view_layer.objects.active=clones[0]
    path=out/(r['id']+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_extras=True,
                             export_animations=False,export_skins=False,export_tangents=False)
    triangles=sum(len(o.data.polygons) for o in clones);vertices=sum(len(o.data.vertices) for o in clones)
    material_count=len(set(m for o in clones for m in o.data.materials))
    assert vertices<=recipes['constraints']['max_vertices']
    assert material_count<=recipes['constraints']['max_materials']
    report=dict(id=r['id'],rarity=r['rarity'],file=path.name,sha256=sha(path),bytes=path.stat().st_size,
                parts=len(clones),triangles=triangles,vertices=vertices,materials=material_count,
                bones=sorted(set(o['tllBone'] for o in clones)),geometry_parts=[o.name for o in clones])
    # 납품 GLB는 바인드 자세. 편집 원본에는 같은 리그의 미리보기 수정자를 붙인다.
    states={o.name:o.hide_render for o in source_objects}
    for o in source_objects:o.hide_render=True
    collection=bpy.data.collections.new('TLL_EXPORT');scene.collection.children.link(collection)
    for o in clones:
        collection.objects.link(o);scene.collection.objects.unlink(o)
        bone=next(b.name for b in rig.data.bones if b.name.replace('.','')==o['tllBone'].replace('.',''))
        group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
        mod=o.modifiers.new('Preview existing animation rig','ARMATURE');mod.object=rig
    master=master_dir/(r['id']+'.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(master))
    report['master_sha256']=sha(master);report['machine_seconds']=round(time.perf_counter()-clock,3)
    reports.append(report)
    for o in clones:
        me=o.data;bpy.data.objects.remove(o,do_unlink=True);bpy.data.meshes.remove(me)
    bpy.data.collections.remove(collection)
    for o in source_objects:o.hide_render=states[o.name]
    print('ARMOR_VARIANT',json.dumps({k:report[k] for k in ['id','parts','triangles','bytes','machine_seconds']}),flush=True)
assert sha(source)==source_hash
receipt={'schema':'tll.armor-production-pilot/v1','source_sha256':source_hash,'recipe_sha256':sha(recipes_path),
         'blender':bpy.app.version_string,'variants':reports,'source_unchanged':True,
         'machine_total_seconds':round(time.perf_counter()-start,3),'scope':'Five fitted visual variants, not five from-scratch creations.',
         'animation_approved':False,'art_approved':False,'production_changed':False}
(out/'manifest.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
(master_dir/'manifest.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print('ARMOR_BATCH_COMPLETE',receipt['machine_total_seconds'],flush=True)
