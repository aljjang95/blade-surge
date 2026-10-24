# 등급 갑옷 파츠(투구·어깨·장갑) 원본를 docs/GEAR_VISUAL_PIPELINE.md 5절 계약으로 정규화해
# public/models/gear-parts/parts_<n|e|l>.glb 로 쓰고 src/data/hero-gear-parts.json 의 sets·grades 를 갱신한다.
# 원본: art/gear-parts-art-src 브랜치 art-src/gear-parts/tripo-lite/<helm|pauldron|gauntlet>_<n|e|l>.glb
#       (Tripo 정적 메시 → 3만 삼각형 감량본, 입력 sha256 은 아래 SOURCES 와 정확히 같아야 한다).
# 사용(Blender 4.5 LTS 헤드리스, 같은 입력이면 같은 출력):
#   blender -b --factory-startup -noaudio -P tools/art/normalize-gear-parts.py -- \
#       --src <원본 폴더> --out public/models/gear-parts --data src/data/hero-gear-parts.json --report <보고 JSON> [--only n]
#
# 출력 GLB 한 개(등급당) = 정적 메시 3개 `helm`·`pauldron`·`gauntlet` + 재질 하나(1024x1024 아틀라스 한 장, WEBP q82).
#   아틀라스: 투구 왼쪽 위 512, 어깨 오른쪽 위 512, 장갑 아래 절반(1024x512).
# 좌표(저작): 캐릭터 정면 +Z, 위 +Y, 캐릭터 오른쪽 = -X. 오른쪽 한 짝만 둔다(왼쪽은 런타임이 x 반전).
import bpy, sys, os, json, math, hashlib, argparse
import numpy as np
from mathutils import Matrix, Euler, Vector

# ── 입력 고정 ────────────────────────────────────────────────────────────────────────────────
SOURCES = {
    'helm_n': 'cb2c82f9d164cd93e299618cf1ecfa7bc7c25941dfba079525f8825696540b14',
    'helm_e': '3196ca05d3bbf24e4eb2baff061702f692dd4f9dd38ef54a3958d94337d1a8b6',
    'helm_l': '5b7f7a4c4336f5dd417d55ceec8bbeb023f07bf0e6c69a1cb7bd37209b73d97a',
    'pauldron_n': '41851f24f972f76b2e919a16a9d26dd9356b55cd712aacc31f429671e6f5df98',
    'pauldron_e': '78c2c873e5685a34d2cca5146cff114875a267cbb8925df08957074f0fb91f63',
    'pauldron_l': 'c54f014af30754939e744c699f18f5b31acad7bc71cc9d0965ac07e0881a6293',
    'gauntlet_n': '9c5c6804348fed5568f7661f854da5a9d2a37608d9e98050488d84d9bde069dc',
    'gauntlet_e': 'a350b1cfc5261f8ecee4e67285709466327f4fbf728e75fb8d92e71f1bb361bd',
    'gauntlet_l': 'c4edc01cac127e9ef854a406229275c84b3c2ead9aaa339721c98963ecc071dc',
}
SLOTS = ('helm', 'pauldron', 'gauntlet')
TRI_BUDGET = {'helm': 2000, 'pauldron': 1300, 'gauntlet': 1300}       # 세트 합계 6000 = 런타임 GEAR_PARTS_TRIANGLE_LIMIT
TRI_TARGET = {'helm': 1900, 'pauldron': 1250, 'gauntlet': 1250}
ATLAS = 1024
WEBP_QUALITY = 82
METALLIC, ROUGHNESS = 0.6, 0.5

# ── 파츠별 회전(원본 → 저작 축). Blender 좌표(Z 위, 정면 -Y) 오일러 XYZ 도 ────────────────────────────
# Blender→glTF 변환은 내보내기가 한다(Blender +Z = glTF +Y, Blender -Y = glTF +Z).
#  helm   : 원본이 이미 위 +Z·얼굴 열린 쪽 -Y(= glTF +Z) 이라 회전 없음(정면·옆 정사영으로 확인).
#  pauldron: 원본 정면 렌더에서 돔이 위·오른쪽, 겹판이 아래·왼쪽(-X)으로 흘러 이미 "위 +Z, 바깥 -X" 이다. 회전 없음.
#  gauntlet: 원본은 손이 사선(손가락이 아래·왼쪽·보는 쪽)이다. 정점 주성분(PCA)으로 손가락 쪽 축 f(=-e0)와 손등 법선 n(e2 중
#            -Y 쪽)을 구해 f → -X, n → +Z(손등 위) 로 보내는 회전을 풀어 5도 단위로 반올림했다.
ROTATION = {
    'helm_n': (0, 0, 0), 'helm_e': (0, 0, 0), 'helm_l': (0, 0, 0),
    'pauldron_n': (0, 0, 0), 'pauldron_e': (0, 0, 0), 'pauldron_l': (0, 0, 0),
    'gauntlet_n': (-32.5, -3.5, -52.5), 'gauntlet_e': (-46, -9, -61), 'gauntlet_l': (-29.5, 25.5, -26.5),
}
# ── 크기·원점 규칙(회전 뒤 정점 기준, Blender 좌표). 런타임이 영웅마다 배율을 다시 맞추므로 여기선 "기준값 ref" 에 맞춘다. ──
# 값은 실제 영웅 5명 몸의 슬롯 치수 중간값(투구 머리 관절→머리 꼭대기 약 0.55, 반 어깨폭 약 0.27, 아래팔 약 0.25)이다.
# 처음 문서값(0.2·0.18)이면 배율이 2.5~3.6 이 돼 런타임 범위(0.3~3)를 넘어 투구가 빠졌다.
REF = {'helm': 0.55, 'pauldron': 0.27, 'gauntlet': 0.25}
HELM_ORIGIN_Z = 0.18      # 투구 높이의 이 비율 = 머리 관절(아래 얼굴 보호판이 관절 아래로 내려온다)
HELM_FIT = 1.20          # 영웅 머리(머리카락 포함)가 투구 껍질을 뚫지 않게 투구를 ref 보다 이만큼 크게
HELM_SHELL = 0.07         # 윗면 껍질 두께(투구 높이 비율): 안쪽 꼭대기 = 맨 위 - 껍질
PAULDRON_WIDTH = 1.10     # 어깨 보호대 가로 폭 = ref x 이 값
PAULDRON_ORIGIN_Z = 0.35  # 돔 꼭대기에서 아래로 이 비율(높이) = 위팔 관절
GAUNTLET_LENGTH = 1.15    # 손목→손끝 = ref x 이 값
GAUNTLET_WRIST = 0.20     # 소매 끝에서 손끝 쪽으로 가로 길이의 이 비율 = 손목

# 세트별 맞춤 보정(런타임 set.fit: 배율 배수·저작 단위 이동 [x,y,z], 오른쪽 기준). 화면 촬영(tools/art/hero-gear-parts-shots.mjs)으로 정했다.
#  parts_e 장갑: 실제 손보다 팔쪽(근위)에 앉아 손가락 방향(-X)으로 당긴다. parts_l 투구: 눈썹 가리개가 눈을 덮어 위로 올린다.
SET_FIT = {
    'parts_e': {'gauntlet': {'offset': [-0.06, 0, 0]}},
    'parts_l': {'helm': {'offset': [0, 0.07, 0]}, 'gauntlet': {'offset': [-0.03, 0, 0]}},
}


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def import_part(path):
    """GLB 를 가져와 메시 오브젝트 하나로(부모·빈 오브젝트 제거, 월드 변환을 정점에 구움)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    if len(meshes) != 1:
        raise SystemExit(f'{path}: 메시 1개가 아님({len(meshes)})')
    obj = meshes[0]
    matrix = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(matrix)
    for o in new:
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    if len(obj.data.materials) != 1:
        raise SystemExit(f'{path}: 재질 1개가 아님')
    return obj


def base_color_image(obj):
    nodes = obj.data.materials[0].node_tree.nodes
    for node in nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            return node.image
    raise SystemExit('기본색 텍스처 없음')


def verts(obj):
    arr = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get('co', arr)
    return arr.reshape(-1, 3).astype(np.float64)


def set_verts(obj, arr):
    obj.data.vertices.foreach_set('co', arr.astype(np.float32).ravel())
    obj.data.update()


def frame(slot, grade, v):
    """회전된 정점 v → (원점 Vector, 배율). 규칙은 파일 상단 상수. 보고용 사실도 돌려준다."""
    lo, hi = v.min(0), v.max(0)
    size = hi - lo
    if slot == 'helm':
        height = size[2]
        cx = (lo[0] + hi[0]) / 2
        cy = (lo[1] + hi[1]) / 2
        origin = np.array([cx, cy, lo[2] + HELM_ORIGIN_Z * height])
        inner_top = hi[2] - HELM_SHELL * height
        scale = REF['helm'] * HELM_FIT / (inner_top - origin[2])
        return origin, scale, {'innerTopAbove': REF['helm']}
    if slot == 'pauldron':
        top = v[np.argmax(v[:, 2])]
        height = size[2]
        origin = np.array([top[0], (lo[1] + hi[1]) / 2, hi[2] - PAULDRON_ORIGIN_Z * height])
        scale = REF['pauldron'] * PAULDRON_WIDTH / size[0]
        return origin, scale, {'domeTopX': round(float(top[0]), 4)}
    # gauntlet: 손가락 쪽 -X, 소매 쪽 +X. 소매 끝 고리(가장 +X 쪽 8%) 중심의 YZ = 손목 축.
    cuff = v[v[:, 0] > hi[0] - 0.08 * size[0]]
    wrist_x = hi[0] - GAUNTLET_WRIST * size[0]
    origin = np.array([wrist_x, (cuff[:, 1].min() + cuff[:, 1].max()) / 2, (cuff[:, 2].min() + cuff[:, 2].max()) / 2])
    scale = REF['gauntlet'] * GAUNTLET_LENGTH / (origin[0] - lo[0])
    return origin, scale, {}


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimate(obj, target):
    """COLLAPSE 로 삼각형을 target 아래로. 비율을 조금씩 낮춰 상한 안에 넣는다."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.use_collapse_triangulate = True
    ratio = target / triangles(obj)
    graph = bpy.context.evaluated_depsgraph_get()
    for _ in range(6):
        mod.ratio = ratio
        graph.update()
        count = sum(len(p.vertices) - 2 for p in obj.evaluated_get(graph).data.polygons)
        if count <= target:
            break
        ratio *= target / count * 0.97
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def clean_shading(obj):
    me = obj.data
    if me.has_custom_normals:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for poly in me.polygons:
        poly.use_smooth = True


def uv_remap(obj, ox, oy, sx, sy):
    uv = obj.data.uv_layers.active.data
    arr = np.empty(len(uv) * 2, dtype=np.float32)
    uv.foreach_get('uv', arr)
    arr = arr.reshape(-1, 2)
    out_of_range = float(np.maximum(np.maximum(-arr.min(0), arr.max(0) - 1), 0).max())
    arr = np.clip(arr, 0, 1)
    arr[:, 0] = ox + arr[:, 0] * sx
    arr[:, 1] = oy + arr[:, 1] * sy
    uv.foreach_set('uv', arr.ravel())
    return out_of_range


def pixels(image, width, height):
    """이미지를 (height,width,4) 선형 float 배열로(행 0 = 아래). 원본은 건드리지 않는다."""
    copy = image.copy()
    copy.scale(width, height)
    arr = np.empty(width * height * 4, dtype=np.float32)
    copy.pixels.foreach_get(arr)
    bpy.data.images.remove(copy)
    return arr.reshape(height, width, 4)


def build_atlas(images):
    half = ATLAS // 2
    atlas = np.zeros((ATLAS, ATLAS, 4), dtype=np.float32)
    atlas[..., 3] = 1
    atlas[half:, :half] = pixels(images['helm'], half, half)
    atlas[half:, half:] = pixels(images['pauldron'], half, half)
    atlas[:half, :] = pixels(images['gauntlet'], ATLAS, half)
    atlas[..., 3] = 1
    image = bpy.data.images.new('gear_parts_atlas', ATLAS, ATLAS, alpha=False)
    image.pixels.foreach_set(atlas.ravel())
    image.pack()
    return image


def make_material(atlas):
    mat = bpy.data.materials.new('gear_parts')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = atlas
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = METALLIC
    bsdf.inputs['Roughness'].default_value = ROUGHNESS
    return mat


def normalize_grade(grade, src_dir, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    report = {'id': f'parts_{grade}', 'inputs': {}, 'parts': {}}
    objs, images = {}, {}
    for slot in SLOTS:
        key = f'{slot}_{grade}'
        path = os.path.join(src_dir, f'{key}.glb')
        digest = sha(read(path))
        if digest != SOURCES[key]:
            raise SystemExit(f'{key}: 입력 sha256 불일치 {digest}')
        report['inputs'][key] = digest
        obj = import_part(path)
        obj.name = obj.data.name = slot
        objs[slot] = obj
        images[slot] = base_color_image(obj)
    atlas = build_atlas(images)
    material = make_material(atlas)
    half = 0.5
    uv_box = {'helm': (0, half, half, half), 'pauldron': (half, half, half, half), 'gauntlet': (0, 0, 1, half)}
    total = 0
    for slot, obj in objs.items():
        key = f'{slot}_{grade}'
        v = verts(obj)
        rot = Euler([math.radians(a) for a in ROTATION[key]], 'XYZ').to_matrix()
        v = v @ np.array(rot).T
        origin, scale, extra = frame(slot, grade, v)
        v = (v - origin) * scale
        set_verts(obj, v)
        clean_shading(obj)
        source_tris = triangles(obj)
        decimate(obj, TRI_TARGET[slot])
        clean_shading(obj)
        tris = triangles(obj)
        if tris > TRI_BUDGET[slot]:
            raise SystemExit(f'{key}: 삼각형 예산 초과 {tris}')
        oor = uv_remap(obj, *uv_box[slot])
        obj.data.materials.clear()
        obj.data.materials.append(material)
        total += tris
        final = verts(obj)
        report['parts'][slot] = {
            'rotationDeg': list(ROTATION[key]), 'origin': [round(float(x), 4) for x in origin], 'scale': round(float(scale), 5),
            'sourceTriangles': source_tris, 'triangles': tris, 'uvOutOfRange': round(oor, 4),
            'bboxMin': [round(float(x), 4) for x in final.min(0)], 'bboxMax': [round(float(x), 4) for x in final.max(0)], **extra,
        }
    if total > 6000:
        raise SystemExit(f'세트 삼각형 합계 초과 {total}')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs.values():
        obj.select_set(True)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f'parts_{grade}.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_image_format='WEBP', export_image_quality=WEBP_QUALITY, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials='EXPORT', export_cameras=False, export_lights=False, export_animations=False,
        export_skins=False, export_morph=False, export_extras=False,
    )
    data = read(out)
    report.update({'file': f'parts_{grade}.glb', 'bytes': len(data), 'sha256': sha(data), 'triangles': total})
    return report


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='public/models/gear-parts')
    ap.add_argument('--data', default=None)
    ap.add_argument('--report', default=None)
    ap.add_argument('--only', default=None)
    args = ap.parse_args(argv)
    grades = [g for g in 'nel' if not args.only or args.only == g]
    reports = [normalize_grade(g, args.src, args.out) for g in grades]
    if args.data and not args.only:
        with open(args.data, encoding='utf-8') as f:
            data = json.load(f)
        data['sets'] = [{'id': r['id'], 'path': f"/models/gear-parts/{r['id']}.glb", 'parts': list(SLOTS), 'triangles': r['triangles'], 'sha256': r['sha256'], **({'fit': SET_FIT[r['id']]} if r['id'] in SET_FIT else {})} for r in reports]
        for slot in SLOTS:
            data['slots'][slot]['ref'] = REF[slot]
        data['grades'] = {'N': None, 'S': 'parts_n', 'E': 'parts_e', 'U': 'parts_e', 'L': 'parts_l'}
        with open(args.data, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
    text = json.dumps(reports, ensure_ascii=False, indent=2)
    if args.report:
        with open(args.report, 'w', encoding='utf-8') as f:
            f.write(text)
    print('REPORT_BEGIN\n' + text + '\nREPORT_END')


main()
