"""초보자 마을 Tripo 소품 8종을 게임용 GLB 로 정규화한다 (Blender 5.2.1 헤드리스).

실행(저장소 루트에서):
  1) 원본 풀기(커밋하지 않음, work/ 는 gitignore):
       for n in cottage forge board dummy portal statue fountain stall; do
         mkdir -p work/tripo-src/sv_$n
         for f in model.glb front.png top.png; do
           git show origin/art/starter-village-concepts:tripo/sv_$n/$f > work/tripo-src/sv_$n/$f; done; done
  2) Blender 5.2.1 Linux x64 (https://download.blender.org/release/Blender5.2/) 를 ~/.local/blender 에 풀어 둔다.
       ~/.local/blender/blender-5.2.1-linux-x64/blender --background --python-exit-code 1 \
         --python tools/build-starter-village-props.py [-- 이름 ...]
산출: public/models/starter-village-v1/<이름>.glb (sv_ 접두사 뺌), work/art/starter-village-v1/<이름>-{front,top}.png,
      work/art/starter-village-v1/report.json (docs/starter-village-props.md 표의 원본 수치).
규약: 바닥 중앙 피벗(최저 y=0, x/z 중심 0), 앞면 +Z(three.js 기본), 단위 m.
텍스처: 베이스컬러 1024(소품 512) + 러프니스/메탈릭 512, 노멀 맵 제거, WebP(EXT_texture_webp).
"""
import bpy, json, math, hashlib, sys, time
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'work/tripo-src'
OUT = ROOT / 'public/models/starter-village-v1'
ART = ROOT / 'work/art/starter-village-v1'
OUT.mkdir(parents=True, exist_ok=True); ART.mkdir(parents=True, exist_ok=True)

HERO_H = 1.8  # 비교용 영웅 키(KayKit 계열, 본 최고 높이 약 1.5 + 머리). 미리보기에 기준 막대로 그린다.

# 이름: (한도 폭 x, 깊이 z, 높이 y [m], 삼각형 예산, 베이스컬러 px, 높이 기준 맞춤 여부)
# 한도는 src/game/starter-village-scene.js 의 절차 모델과 src/data/starter-village.js 충돌값에서 뽑았다(docs 표 참고).
# 균등 스케일은 폭·깊이·높이 한도 중 가장 먼저 닿는 축에 맞춘다. fit_h=True 는 높이를 우선(허수아비·영웅상: 충돌이 작은 기둥/받침뿐).
SPECS = {
    'sv_cottage':  dict(box=(5.4, 4.2, 7.0), tris=6000, tex=1024),
    'sv_forge':    dict(box=(6.2, 4.6, 4.8), tris=6000, tex=1024),
    'sv_board':    dict(box=(2.3, 1.4, 2.8), tris=3000, tex=512),
    'sv_dummy':    dict(box=(1.5, 0.8, 1.86), tris=3000, tex=512, fit_h=True),
    'sv_portal':   dict(box=(4.8, 2.0, 5.6), tris=6000, tex=1024),
    'sv_statue':   dict(box=(1.9, 1.9, 3.7), tris=3000, tex=512),
    'sv_fountain': dict(box=(3.3, 3.3, 2.3), tris=6000, tex=1024),
    'sv_stall':    dict(box=(2.6, 2.1, 2.6), tris=6000, tex=1024),
}
names = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(SPECS)


def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def tri_count(o):
    me = o.data; me.calc_loop_triangles(); return len(me.loop_triangles)


def bbox(o):
    ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector(min(w[i] for w in ws) for i in range(3)), Vector(max(w[i] for w in ws) for i in range(3))


def shrink_images(mat, px):
    """베이스컬러는 px, 러프니스/메탈릭은 512 로 줄이고 노멀 맵과 노드를 지운다."""
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' and n.image and n.image.name.endswith('_normal'):
            nt.nodes.remove(n)
    for n in list(nt.nodes):
        if n.type == 'NORMAL_MAP': nt.nodes.remove(n)
    for n in nt.nodes:
        if n.type != 'TEX_IMAGE' or not n.image: continue
        size = px if n.image.name.endswith('_basecolor') else 512
        if n.image.size[0] > size: n.image.scale(size, size)


def build(name):
    spec = SPECS[name]; t0 = time.perf_counter()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = SRC / name / 'model.glb'
    bpy.ops.import_scene.gltf(filepath=str(src))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:  # 부모 변환 굽기
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:
        o.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in list(bpy.context.scene.objects):
        if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
    ob.name = name[3:]
    src_tris = tri_count(ob); notes = []

    # 삼각형 예산: 넘으면 Decimate(collapse). UV 이음선은 collapse 가 유지한다.
    if src_tris > spec['tris']:
        mod = ob.modifiers.new('Decimate', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'
        mod.ratio = spec['tris'] * .985 / src_tris; mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if name == 'sv_stall': notes += fix_stall(ob)
    res_tris = tri_count(ob)

    # 균등 스케일: 폭(x)·깊이(y, Blender)·높이(z) 한도 중 가장 먼저 닿는 축. Blender 의 -Y 가 glTF +Z(앞면)다.
    lo, hi = bbox(ob); size = hi - lo
    bw, bd, bh = spec['box']
    cand = {'폭': bw / size.x, '깊이': bd / size.y, '높이': bh / size.z}
    if spec.get('fit_h'): bound = '높이'
    else: bound = min(cand, key=cand.get)
    s = cand[bound]
    ob.scale = (s, s, s); bpy.ops.object.transform_apply(scale=True)
    # 피벗: 바닥 중앙. x/y 는 바운딩 중심, z 는 최저점.
    lo, hi = bbox(ob)
    ob.location = (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z); bpy.ops.object.transform_apply(location=True)
    lo, hi = bbox(ob); dims = hi - lo

    mat = ob.active_material
    shrink_images(mat, spec['tex'])
    out = OUT / (name[3:] + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', export_yup=True, use_selection=False,
        export_image_format='WEBP', export_image_quality=82, export_materials='EXPORT', export_apply=True,
        export_cameras=False, export_lights=False, export_animations=False, export_tangents=False)
    render_previews(ob, name[3:])
    data = out.read_bytes()
    exts = json.loads(data[20:20 + int.from_bytes(data[12:16], 'little')])
    rec = dict(name=name, src_sha256=sha(src), src_tris=src_tris, res_tris=res_tris,
        tex=[{'name': t.name, 'px': list(t.size)} for t in bpy.data.images if t.users and t.name != 'Render Result'],
        bytes=out.stat().st_size, sha256=sha(out), dims_whd=[round(dims.x, 3), round(dims.z, 3), round(dims.y, 3)],
        scale=round(s, 4), bound_by=bound, extensions=exts.get('extensionsUsed', []), notes=notes,
        seconds=round(time.perf_counter() - t0, 1))
    print('BUILD', json.dumps(rec, ensure_ascii=False))
    return rec


def inpaint_cloth_blobs(ob, img):
    """UV 가 쓰는 칸 안의 검은 얼룩 중 둘레가 천 색(흰·파랑)인 것을 둘레 색으로 메운다(2048 원본에서, 줄이기 전).
    반환: 메운 얼룩 수와 픽셀 수."""
    import numpy as np
    W, H = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    cover = np.zeros((H, W), bool)
    me = ob.data; me.calc_loop_triangles(); uvl = me.uv_layers.active.data
    for t in me.loop_triangles:
        P = np.array([uvl[i].uv for i in t.loops]) * [W, H]
        x0, y0 = np.floor(P.min(0)).astype(int) - 1; x1, y1 = np.ceil(P.max(0)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        d = (P[1, 1] - P[2, 1]) * (P[0, 0] - P[2, 0]) + (P[2, 0] - P[1, 0]) * (P[0, 1] - P[2, 1])
        if abs(d) < 1e-9: continue
        l1 = ((P[1, 1] - P[2, 1]) * (gx - P[2, 0]) + (P[2, 0] - P[1, 0]) * (gy - P[2, 1])) / d
        l2 = ((P[2, 1] - P[0, 1]) * (gx - P[2, 0]) + (P[0, 0] - P[2, 0]) * (gy - P[2, 1])) / d
        m = (l1 >= -.02) & (l2 >= -.02) & (l1 + l2 <= 1.02)
        cover[y0:y1 + 1, x0:x1 + 1] |= m
    rgb = a[..., :3]; dark = cover & (rgb.max(2) < .06)
    lab = np.zeros((H, W), np.int32); n = 0; fixed = np.zeros((H, W), bool); blobs = []
    ys, xs = np.nonzero(dark)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]: continue
        n += 1; lab[y0, x0] = n; st = [(y0, x0)]; pts = []
        while st:
            y, x = st.pop(); pts.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and dark[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; st.append((yy, xx))
        blobs.append(pts)
    count = pix = 0
    for pts in blobs:
        if len(pts) < 20: continue
        m = np.zeros((H, W), bool); yy, xx = zip(*pts); m[list(yy), list(xx)] = True
        y0, y1, x0, x1 = max(min(yy) - 6, 0), min(max(yy) + 7, H), max(min(xx) - 6, 0), min(max(xx) + 7, W)
        sub = m[y0:y1, x0:x1]; grow = sub.copy()
        for _ in range(4):
            g = grow.copy(); g[1:] |= grow[:-1]; g[:-1] |= grow[1:]; g[:, 1:] |= grow[:, :-1]; g[:, :-1] |= grow[:, 1:]; grow = g
        ring = grow & ~sub & cover[y0:y1, x0:x1] & ~dark[y0:y1, x0:x1]
        if ring.sum() < 8: continue
        c = rgb[y0:y1, x0:x1][ring]
        if not (c[:, 2].mean() >= .9 * c[:, 0].mean() and c.mean() > .2): continue   # 둘레가 천이 아니면(나무·그림자) 건드리지 않는다
        # 바깥 픽셀에서 안쪽으로 한 겹씩 평균으로 번지게 채운다.
        todo = grow & ~ring & cover[y0:y1, x0:x1] & ~ring; todo = sub | (grow & dark[y0:y1, x0:x1])
        reg = rgb[y0:y1, x0:x1].copy(); known = ~todo & cover[y0:y1, x0:x1]
        for _ in range(40):
            if not (todo & ~known).any(): break
            acc = np.zeros_like(reg); cnt = np.zeros(reg.shape[:2], np.float32)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                k = np.roll(known, (dy, dx), (0, 1)); v = np.roll(reg, (dy, dx), (0, 1))
                acc += v * k[..., None]; cnt += k
            new = todo & ~known & (cnt > 0)
            reg[new] = acc[new] / cnt[new][:, None]; known |= new
        rgb[y0:y1, x0:x1][todo] = reg[todo]; count += 1; pix += int(todo.sum())
    a[..., :3] = rgb; img.pixels = a.ravel().tolist(); img.update()
    return count, pix


def fix_stall(ob):
    """sv_stall 결함: 차양 윗면(약 0.7x0.3 m)과 앞 장식 깃발에 뚫린 메시 구멍.
    정점을 병합한 뒤 경계 변을 연결 덩어리로 묶고, 변 3~16개 덩어리를 triangle_fill 로 메운다.
    새 면의 UV 는 구멍 가장자리 면의 UV 를 그대로 쓴다(차양 줄무늬가 이어진다)."""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    uv = bm.loops.layers.uv.active
    border = [e for e in bm.edges if e.is_boundary]
    seen, groups = set(), []
    for e in border:
        if e in seen: continue
        stack, grp = [e], []
        while stack:
            x = stack.pop()
            if x in seen: continue
            seen.add(x); grp.append(x)
            for v in x.verts:
                stack += [y for y in v.link_edges if y.is_boundary and y not in seen]
        groups.append(grp)
    # 구멍 가장자리 UV 가 나무 조각(병합으로 같은 자리에 겹친 이웃 부품) 쪽일 수 있어, 천 색(흰·파랑, b>=0.9r)인 후보만 쓴다.
    img = next(i for i in bpy.data.images if i.name.endswith('_basecolor'))
    px = img.pixels[:]; W, H = img.size
    def color(u, v):
        x = min(W - 1, max(0, int(u * W))); y = min(H - 1, max(0, int(v * H))); k = (y * W + x) * 4
        return px[k], px[k + 1], px[k + 2]
    filled = []
    for grp in groups:
        if not 3 <= len(grp) <= 16: continue
        cand = []  # (정점 좌표, UV): 천 색인 가장자리 UV
        for e in grp:
            for lp in e.link_faces[0].loops:
                if lp.vert in e.verts:
                    r, g, b = color(*lp[uv].uv)
                    if b >= .9 * r and max(r, g, b) > .08: cand.append((lp.vert.co.copy(), lp[uv].uv.copy()))
        # 구멍 덩어리가 열린 사슬이라 triangle_fill 이 일부만 덮는다 → 무게중심 부채꼴(별 모양 구멍 가정)로 덮는다.
        verts = list({v for e in grp for v in e.verts})
        cen = sum((v.co for v in verts), Vector()) / len(verts)
        ext = [max(v.co[i] for v in verts) - min(v.co[i] for v in verts) for i in range(3)]
        ax, ay = sorted(range(3), key=lambda i: -ext[i])[:2]
        verts.sort(key=lambda v: math.atan2(v.co[ay] - cen[ay], v.co[ax] - cen[ax]))
        nrm = sum((f.normal for e in grp for f in e.link_faces), Vector())
        awning = cen.z > .55   # 차양 윗면은 위(+Z)를 보게, 그 아래 장식 깃발은 아래 삼각형 채우기를 쓴다
        if awning: nrm = Vector((0, 0, 1))
        before = {f for f in bm.faces}
        if not awning:
            try: bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=grp)
            except Exception: pass
        hub = bm.verts.new(cen) if awning else None; new = [f for f in bm.faces if f not in before]
        if not awning: verts = []
        for i, v in enumerate(verts):
            w = verts[(i + 1) % len(verts)]
            try: f = bm.faces.new((hub, v, w))
            except ValueError: continue
            if f.normal.dot(nrm) < 0: f.normal_flip()
            f.smooth = False; new.append(f)
        for f in new:
            if not cand: continue
            c = f.calc_center_median()
            best = min(cand, key=lambda t: (t[0] - c).length)[1]
            for lp in f.loops: lp[uv].uv = best
        filled.append((len(grp), len(new), len(cand)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    after = sum(1 for e in bm.edges if e.is_boundary)
    bm.to_mesh(ob.data); bm.free()
    blobs = inpaint_cloth_blobs(ob, img)
    return [f'천 검은 얼룩 {blobs[0]}개({blobs[1]}px) 둘레 색으로 메움', f'경계 변 {len(border)}개(정점 병합 후) 덩어리 {len(groups)}개, 메운 구멍(변수,새 면,천 색 후보) {filled}, 남은 경계 변 {after}']


def render_previews(ob, short):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 16
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('w'); scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.55, .62, .72, 1)
    scene.view_settings.view_transform = 'AgX'
    lo, hi = bbox(ob); c = (lo + hi) / 2; ext = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    # 기준 막대(영웅 키 1.8m): 정면 사진에서 비례 판단용, 소품 오른쪽에 둔다.
    ref = bpy.data.objects.new('hero', bpy.data.meshes.new('hero')); scene.collection.objects.link(ref)
    import bmesh
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=.28, radius2=.28, depth=HERO_H)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, HERO_H / 2)); bm.to_mesh(ref.data); bm.free()
    ref.location = (hi.x + .5 + .3, -(hi.y - lo.y) / 2 - .0, 0)
    hm = bpy.data.materials.new('h'); hm.diffuse_color = (.9, .2, .2, 1); hm.use_nodes = True
    hm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.9, .15, .15, 1)
    ref.data.materials.append(hm)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
    sun.data.energy = 3.2; sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; scene.camera = cam
    span = max(ext, HERO_H) * 1.25 + (1.4 if ext > 1 else .7)
    cam.data.ortho_scale = span * 1.15
    # 정면: Blender -Y 쪽(= glTF +Z)에서 +Y 로 바라본다.
    mid_x = (lo.x + hi.x + 1.1) / 2
    cam.location = (mid_x, -30, c.z); cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.filepath = str(ART / f'{short}-front.png'); bpy.ops.render.render(write_still=True)
    cam.location = (c.x, c.y, 30); cam.rotation_euler = (0, 0, 0)
    ref.hide_render = True
    cam.data.ortho_scale = ext * 1.35
    scene.render.filepath = str(ART / f'{short}-top.png'); bpy.ops.render.render(write_still=True)


results = [build(n) for n in names]
rp = ART / 'report.json'
old = json.loads(rp.read_text()) if rp.exists() else {}
for r in results: old[r['name']] = r
rp.write_text(json.dumps(old, ensure_ascii=False, indent=1))
