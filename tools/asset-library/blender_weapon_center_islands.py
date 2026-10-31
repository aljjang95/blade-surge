"""떠 있는 장식 덩어리(헤일로 등)를 무기 본체의 두께 중심으로 옮긴다(Tripo 대검 헤일로가 날 뒤에 떨어져 생성되는 경우).

사용: blender -b --python tools/asset-library/blender_weapon_center_islands.py -- <prepped.glb> <out.glb> 후 blender_weapon_prep 을 다시 돌린다.
연결 판정은 위치(소수 4자리)로 이은 덩어리 기준(UV 이음매로 갈라진 정점은 같은 덩어리). 본체 bbox 와 겹치지 않는 덩어리만 길이축(Z) 외 두 축 중심을 맞춘다.
"""
import bpy,bmesh,sys
from mathutils import Vector
a=sys.argv[sys.argv.index('--')+1:];inp,out=a[0],a[1]
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=inp)
o=[x for x in bpy.context.scene.objects if x.type=='MESH'][0]
bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table()
key=lambda v:(round(v.co.x,4),round(v.co.y,4),round(v.co.z,4))
par={}
def f(x):
  while par.setdefault(x,x)!=x: par[x]=par[par[x]];x=par[x]
  return x
for e in bm.edges:
  a,b=f(key(e.verts[0])),f(key(e.verts[1]))
  if a!=b: par[a]=b
groups={}
for v in bm.verts: groups.setdefault(f(key(v)),[]).append(v)
islands=list(groups.values())
islands.sort(key=len,reverse=True)
def bb(isl):
  return Vector((min(v.co.x for v in isl),min(v.co.y for v in isl),min(v.co.z for v in isl))),Vector((max(v.co.x for v in isl),max(v.co.y for v in isl),max(v.co.z for v in isl)))
mn,mx=bb(islands[0]);c=(mn+mx)/2;moved=0
for isl in islands[1:]:
  a1,b1=bb(isl)
  overlap=all(a1[i]<=mx[i]+1e-4 and b1[i]>=mn[i]-1e-4 for i in range(3))
  if overlap: continue
  cc=(a1+b1)/2;d=Vector((c.x-cc.x,c.y-cc.y,0))
  for v in isl: v.co+=d
  moved+=len(isl)
bm.to_mesh(o.data);bm.free()
print('FIX islands',len(islands),'moved verts',moved)
props=bpy.ops.export_scene.gltf.get_rna_type().properties
w={'filepath':out,'export_format':'GLB','export_yup':True,'export_apply':True,'export_animations':False,'export_skins':False,'export_vertex_color':'NONE','export_image_format':'JPEG'}
bpy.ops.export_scene.gltf(**{k:v for k,v in w.items() if k in props})
