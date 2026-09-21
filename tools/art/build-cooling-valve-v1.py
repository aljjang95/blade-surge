"""TLL 냉각 밸브 원본 메시 제작, GLB 계약 검증, 스튜디오 렌더.

실행: blender --background --factory-startup --python-exit-code 1
      --python tools/art/build-cooling-valve-v1.py
외부 모델/텍스처/네트워크 없이 제작한다. Blender Z-up -> glTF Y-up.
"""
import hashlib
import json
import math
import struct
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/tll/props'
PROOF = ROOT / 'work/cooling-valve-proof'
OUT.mkdir(parents=True, exist_ok=True)
PROOF.mkdir(parents=True, exist_ok=True)
GLB = OUT / 'cooling-valve-v1.glb'
BLEND = OUT / 'cooling-valve-v1.blend'
TAU = math.tau
WHEEL_CENTER = (0, -.65, 1.69)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
parts = {}


def material(name, color, roughness, metallic=0, emission=0):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*rgb, 1)
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    if emission:
        shader.inputs['Emission Color'].default_value = (*rgb, 1)
        shader.inputs['Emission Strength'].default_value = emission
    mat['tllAuthored'] = True
    mat['provenance'] = 'Original TLL cooling-valve material; no texture inputs'
    return mat


MATS = {
    'Iron': material('TLL_Valve_ForgedIron', '344750', .57, .72),
    'Brass': material('TLL_Valve_BrushedBrass', 'C59850', .36, .72),
    'Enamel': material('TLL_Valve_PetrolEnamel', '225D62', .4, .35),
    'Dial': material('TLL_Valve_IvoryDial', 'EADAA5', .67),
    'Amber': material('TLL_Valve_PressureAmber', 'FF9B32', .4, .1, .45),
    'Coolant': material('TLL_Valve_CoolantTeal', '49D9CB', .27, .15, 1.15),
}


def register(obj, name, bucket, mat):
    obj.name = name
    obj.data.materials.clear()
    obj.data.materials.append(MATS[mat])
    parts.setdefault(bucket, []).append(obj)
    return obj


def mesh(name, vertices, faces, bucket, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return register(obj, name, bucket, mat)


def box(name, center, size, bucket='Iron', mat='Iron', bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('단조 모서리', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return register(obj, name, bucket, mat)


def lathe(name, center, profile, bucket='Iron', mat='Iron', sides=12, axis=(0, 0, 1), caps=True):
    # 단순 원통 대신 반경/높이 단면으로 플랜지, 너트, 단조 소켓을 깎는다.
    rotation = Vector(axis).to_track_quat('Z', 'Y')
    origin = Vector(center)
    verts = []
    for height, radius in profile:
        for i in range(sides):
            angle = TAU * i / sides
            verts.append(origin + rotation @ Vector((radius * math.cos(angle), radius * math.sin(angle), height)))
    faces = []
    for ring in range(len(profile) - 1):
        for i in range(sides):
            a = ring * sides + i
            b = ring * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if caps:
        faces.extend([tuple(reversed(range(sides))), tuple((len(profile) - 1) * sides + i for i in range(sides))])
    return mesh(name, verts, faces, bucket, mat)


def pipe(name, points, radius, bucket='Iron', mat='Iron', sides=12):
    verts = []
    for i, point in enumerate(points):
        tangent = Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)])
        direction = tangent.normalized()
        normal = direction.cross(Vector((0, 1, 0))).normalized()
        binormal = direction.cross(normal).normalized()
        for j in range(sides):
            angle = TAU * j / sides
            verts.append(Vector(point) + radius * (math.cos(angle) * normal + math.sin(angle) * binormal))
    faces = []
    for i in range(len(points) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + i for i in range(sides))])
    return mesh(name, verts, faces, bucket, mat)


def ring(name, center, radius, thickness, bucket='Brass', mat='Brass', sides=24, cross=6):
    # 앞쪽(-Y)을 향한 실제 열린 핸드휠 단면.
    x, y, z = center
    verts = []
    for i in range(sides):
        a = TAU * i / sides
        for j in range(cross):
            b = TAU * j / cross
            r = radius + thickness * math.cos(b)
            verts.append((x + r * math.cos(a), y + thickness * math.sin(b), z + r * math.sin(a)))
    faces = []
    for i in range(sides):
        for j in range(cross):
            faces.append((i * cross + j, ((i + 1) % sides) * cross + j,
                          ((i + 1) % sides) * cross + (j + 1) % cross, i * cross + (j + 1) % cross))
    # XZ 평면의 링은 위의 인덱스가 바깥 법선을 향한다.
    return mesh(name, verts, faces, bucket, mat)


def plate(name, polygon, y, depth, bucket, mat):
    # 다각형 장식, 곡선형 스포크, 주조 보강대의 입체 단면.
    n = len(polygon)
    verts = [(x, y - depth / 2, z) for x, z in polygon] + [(x, y + depth / 2, z) for x, z in polygon]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    faces.extend((i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n))
    return mesh(name, verts, faces, bucket, mat)


def bolt(name, center, axis=(0, -1, 0), radius=.044, bucket='Brass', mat='Brass'):
    return lathe(name, center, [(-.02, radius * .83), (0, radius), (.026, radius), (.038, radius * .8)],
                 bucket, mat, sides=6, axis=axis)


def author():
    # 넓고 낮은 고정판, 잘린 코너와 실제 볼트 홈.
    box('팔각 받침판', (0, .02, .105), (2.5, 1.3, .21), bevel=.105)
    box('주조 상판', (0, .04, .23), (1.64, .94, .13), 'Enamel', 'Enamel', .07)
    for x in (-1.02, 1.02):
        for y in (-.43, .43):
            lathe('고정판 볼트 와셔', (x, y, .212), [(0, .102), (.024, .102)], sides=10)
            bolt('바닥 앵커 육각머리', (x, y, .245), (0, 0, 1), .068)

    # 측면이 벌어지는 보강 리브와 중앙 냉각 관찰창.
    plate('테이퍼 주철 받침', [(-.65, .28), (.65, .28), (.43, 1.15), (-.43, 1.15)], .08, .66, 'Iron', 'Iron')
    for side in (-1, 1):
        plate('가새 보강대', [(side * .48, .29), (side * .85, .29), (side * .52, .99)], .13, .22, 'Enamel', 'Enamel')
    box('냉각창 황동 액자', (0, -.286, .65), (.43, .11, .57), 'Brass', 'Brass', .06)
    box('냉각창 깊은 홈', (0, -.35, .65), (.32, .026, .47), bevel=.028)
    for i in range(3):
        box('냉각창 분할 렌즈', (0, -.373, .50 + i * .15), (.245, .031, .11), 'StatusLens', 'Coolant', .017)
    for x in (-.255, .255):
        for z in (.43, .89):
            bolt('창 고정 리벳', (x, -.318, z), radius=.028)

    # 양쪽으로 꺾이는 배관과 여러 단의 플랜지. 전체 폭 3.10m.
    for side in (-1, 1):
        pipe('주 냉각 배관', [(side * .25, .12, 1.09), (side * 1.04, .12, 1.09),
                            (side * 1.23, .12, 1.04), (side * 1.35, .12, .87), (side * 1.35, .12, .45)], .20)
        lathe('바닥 배관 소켓', (side * 1.35, .12, .22), [(0, .17), (.035, .20), (.19, .20), (.24, .17)], sides=12)
        lathe('황동 이음 플랜지', (side * .86, .12, 1.09),
              [(-.085, .225), (-.055, .292), (.055, .292), (.085, .225)], 'Brass', 'Brass', 12, (side, 0, 0))
        for i in range(6):
            a = TAU * i / 6
            bolt('플랜지 육각볼트', (side * .923, .12 + .251 * math.cos(a), 1.09 + .251 * math.sin(a)),
                 (side, 0, 0), .029, 'Iron', 'Iron')
        lathe('배관 냉각 띠', (side * 1.35, .12, .51), [(-.055, .203), (.055, .203)], 'StatusLens', 'Coolant', 12)
        for z in (.43, .59):
            lathe('냉각 띠 보호턱', (side * 1.35, .12, z), [(-.025, .224), (.025, .224)], 'Brass', 'Brass', 12)

    # 12각 몸체와 작은 턱, 휠 뒤쪽 밸브 패킹.
    lathe('밸브 주조 하우징', (0, .10, .99), [(0, .4), (.09, .46), (.40, .46), (.58, .32), (.72, .26)], sides=12)
    lathe('밸브 상단 덮개', (0, .10, 1.69), [(0, .28), (.06, .32), (.13, .27)], 'Enamel', 'Enamel', 12)
    lathe('휠 패킹 황동 링', (0, -.26, 1.69), [(-.02, .23), (.03, .27), (.10, .27), (.15, .17)],
          'Brass', 'Brass', 12, (0, -1, 0))
    lathe('휠 축', (0, -.43, 1.69), [(0, .095), (.22, .095)], sides=12, axis=(0, -1, 0))
    for side in (-1, 1):
        box('측면 주조 명판', (side * .34, -.325, 1.17), (.16, .08, .23), 'Enamel', 'Enamel', .03)
        bolt('명판 리벳', (side * .34, -.38, 1.22), radius=.025)

    # 지름 1.50m, 6개 휘어진 스포크. 휠 전체를 단일 재질 메시로 병합한다.
    ring('육각 단면 황동 핸드휠', WHEEL_CENTER, .64, .085, 'Wheel', 'Brass', 32, 6)
    for i in range(6):
        a = TAU * i / 6
        profile = [(.105, -.058), (.30, -.068), (.58, -.006), (.63, .070), (.49, .078), (.24, .03), (.105, .058)]
        polygon = [(r * math.cos(a) - t * math.sin(a), 1.69 + r * math.sin(a) + t * math.cos(a)) for r, t in profile]
        plate('휜 단조 스포크', polygon, -.65, .082, 'Wheel', 'Brass')
        bolt('휠 조립 리벳', (.52 * math.cos(a), -.707, 1.69 + .52 * math.sin(a)), radius=.031, bucket='Wheel')
    lathe('황동 휠 허브', WHEEL_CENTER, [(-.05, .16), (.02, .19), (.10, .19), (.15, .13)],
          'Wheel', 'Brass', 12, (0, -1, 0))
    bolt('중심 고정 너트', (0, -.81, 1.69), radius=.087, bucket='Wheel')
    lathe('조작 손잡이', (.64 * math.cos(math.pi / 3), -.68, 1.69 + .64 * math.sin(math.pi / 3)),
          [(0, .061), (.16, .053), (.19, .071), (.23, .071), (.26, .047)], 'Wheel', 'Brass', 8, (0, -1, 0))

    # 휠과 떨어져 읽히는 압력계: 실제 눈금, 경고 구간, 바늘, 온색 신호등.
    pipe('압력계 구리목', [(.42, .10, 1.42), (.82, .10, 1.63), (.94, .10, 1.9)], .072, 'Brass', 'Brass', 8)
    gauge = (.94, -.03, 2.17)
    lathe('압력계 뒤통', gauge, [(-.12, .22), (-.06, .31), (.06, .31), (.105, .285)], sides=24, axis=(0, -1, 0))
    ring('압력계 황동 테두리', (.94, -.152, 2.17), .273, .028, sides=24, cross=6)
    lathe('압력계 도자기 다이얼', (.94, -.161, 2.17), [(0, .253), (.012, .253)], 'Dial', 'Dial', 24, (0, -1, 0))
    for i in range(13):
        a = math.radians(-35 + i * 250 / 12)
        r = .216
        tick = box('압력 눈금', (.94 + r * math.cos(a), -.18, 2.17 + r * math.sin(a)),
                   (.035 if i % 3 == 0 else .023, .014, .011), bevel=0)
        tick.rotation_euler.y = -a
    for i in range(4):
        a = math.radians(-35 + i * 12)
        obj = box('압력 경고 띠', (.94 + .24 * math.cos(a), -.179, 2.17 + .24 * math.sin(a)),
                  (.022, .012, .044), 'Amber', 'Amber', 0)
        obj.rotation_euler.y = -a
    plate('압력 바늘', [(.905, 2.146), (.796, 2.332), (.954, 2.196)], -.20, .014, 'Iron', 'Iron')
    bolt('압력 바늘 핀', (.94, -.209, 2.17), radius=.028)
    box('압력계 하단 표시판', (.94, -.18, 2.04), (.106, .014, .035), 'Enamel', 'Enamel', .009)
    lathe('온색 압력 표시등', (.94, -.192, 2.085), [(0, .026), (.018, .026)], 'Amber', 'Amber', 10, (0, -1, 0))

    # 뒤쪽 냉각 매니폴드와 동일 재질의 두꺼운 열교환 핀.
    for z in (.61, .78, .95):
        box('후면 열교환 핀', (0, .48, z), (.94, .22, .065), 'Enamel', 'Enamel', .02)
    for x in (-.31, .31):
        box('뒤쪽 보호대', (x, .40, 1.29), (.10, .15, .43), bevel=.02)


def merge_parts():
    root = bpy.data.objects.new('TLL_CoolingValve_v1', None)
    scene.collection.objects.link(root)
    root['tllIdentity'] = 'cooling-valve-v1'
    root['authoring'] = 'Original TLL Blender geometry; no external models or textures'
    root['units'] = 'meters; glTF Y-up; origin at ground'
    result = []
    for bucket, objects in parts.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.convert(target='MESH')
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = bucket if bucket in ('Wheel', 'StatusLens') else 'TLL_Valve_' + bucket
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        scene.cursor.location = WHEEL_CENTER if bucket == 'Wheel' else (0, 0, 0)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        # 단일 재질 슬롯으로 합쳐 GLB primitive = drawcall을 유지한다.
        mat = obj.data.materials[0]
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for polygon in obj.data.polygons:
            polygon.material_index = 0
            polygon.use_smooth = False
        # 직접 만든 단면의 winding을 일관되게 보정한다.
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.015)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.parent = root
        obj['tllAuthored'] = True
        if bucket == 'Wheel':
            obj['runtimeRotationAxis'] = 'local +Z in glTF (front-facing shaft)'
        if bucket == 'StatusLens':
            obj['runtimeControl'] = 'Clone instance material before changing emissive/color'
        obj.data.calc_loop_triangles()
        result.append(obj)
    scene.cursor.location = (0, 0, 0)
    return root, result


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    lo = [min(v[i] for v in points) for i in range(3)]
    hi = [max(v[i] for v in points) for i in range(3)]
    return {'min': lo, 'max': hi, 'size': [hi[i] - lo[i] for i in range(3)]}


def studio_render():
    world = bpy.data.worlds.new('검증 스튜디오')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.075, .11, .16, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .55
    scene.world = world
    for name, position, energy, color, size in [
        ('큰 정면 소프트박스', (-3.5, -4.5, 6), 800, (1, .87, .69), 5),
        ('냉각 림 조명', (4, 2, 4.5), 1050, (.51, .85, 1), 3),
        ('정면 보조', (3, -4, 2.8), 330, (.75, .9, 1), 4),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, color, 'DISK', size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (Vector((0, 0, 1.1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera = bpy.data.objects.new('검증 카메라', bpy.data.cameras.new('검증 카메라'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type, camera.data.ortho_scale = 'ORTHO', 4.3
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1000, 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    for view, position in [('beauty', (4, -7, 4.1)), ('front', (0, -8, 1.5)), ('back', (-4, 7, 3.9))]:
        camera.location = position
        camera.rotation_euler = (Vector((0, 0, 1.16)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(PROOF / ('asset-' + view + '.png'))
        bpy.ops.render.render(write_still=True)


def verify_export():
    blob = GLB.read_bytes()
    magic, version, length = struct.unpack_from('<III', blob)
    assert (magic, version, length) == (0x46546C67, 2, len(blob))
    json_length, chunk_type = struct.unpack_from('<II', blob, 12)
    assert chunk_type == 0x4E4F534A
    doc = json.loads(blob[20:20 + json_length])
    assert not doc.get('cameras') and not doc.get('animations') and not doc.get('skins')
    assert 'KHR_lights_punctual' not in doc.get('extensionsUsed', [])
    assert not doc.get('images') and not doc.get('textures')
    primitives = [p for m in doc['meshes'] for p in m['primitives']]
    triangles = sum(doc['accessors'][p['indices']]['count'] // 3 for p in primitives)
    assert len(primitives) <= 8 and triangles <= 6000, (len(primitives), triangles)
    assert all(p.get('mode', 4) == 4 for p in primitives)
    nodes = {n['name']: n for n in doc['nodes']}
    assert all('mesh' in nodes[name] for name in ('Wheel', 'StatusLens'))
    wheel = nodes['Wheel']
    assert wheel.get('rotation', [0, 0, 0, 1]) == [0, 0, 0, 1], wheel
    assert all(m.get('extras', {}).get('tllAuthored') for m in doc['materials'])
    return {'triangles': triangles, 'materialDrawcalls': len(primitives),
            'materials': len(doc['materials']), 'meshNodes': list(nodes),
            'wheelGltfTranslation': wheel['translation'], 'wheelLocalRotationAxis': [0, 0, 1],
            'noCamerasLightsSkinsAnimationsTextures': True}


def main():
    author()
    root, objects = merge_parts()
    bpy.context.view_layer.update()
    source_bounds = bounds(objects)
    source_tris = sum(len(obj.data.loop_triangles) for obj in objects)
    assert source_tris <= 6000, source_tris
    assert abs(source_bounds['min'][2]) < 1e-5, source_bounds
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *objects]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_yup=True, export_extras=True, export_apply=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    verification = verify_export()
    studio_render()
    # 전달 GLB 자체를 다시 읽어 원본 편집 장면의 통계와 비교한다.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.context.view_layer.update()
    imported_bounds = bounds(imported)
    for key in ('min', 'max', 'size'):
        assert max(abs(a - b) for a, b in zip(source_bounds[key], imported_bounds[key])) < 1e-5
    for obj in imported:
        obj.data.calc_loop_triangles()
    assert sum(len(o.data.loop_triangles) for o in imported) == verification['triangles']
    assert bpy.data.objects['Wheel'].type == bpy.data.objects['StatusLens'].type == 'MESH'
    width, depth, height = source_bounds['size']
    assert 2.9 <= width <= 3.4 and 2.35 <= height <= 2.7
    receipt = {
        'asset': 'cooling-valve-v1', 'status': 'generated-and-structurally-verified',
        'createdUtc': datetime.now(timezone.utc).isoformat(), 'blender': bpy.app.version_string,
        'blenderBuildHash': bpy.app.build_hash.decode(),
        'generator': Path(__file__).relative_to(ROOT).as_posix(),
        'runtime': GLB.relative_to(ROOT).as_posix(), 'editable': BLEND.relative_to(ROOT).as_posix(),
        'licence': 'Original authored TLL geometry and PBR materials; no external models or textures',
        'provenance': {'geometry': 'Authored cross-sections, extrusions, swept pipes, bevels and hardware in this script',
                       'materials': 'Six original PBR materials', 'externalTextures': [], 'generatedTextures': False},
        'units': 'meters', 'up': 'Y', 'front': '+Z', 'origin': [0, 0, 0],
        'dimensions': {'width': width, 'height': height, 'depth': depth},
        'boundsYUp': {'min': [source_bounds['min'][0], source_bounds['min'][2], -source_bounds['max'][1]],
                       'max': [source_bounds['max'][0], source_bounds['max'][2], -source_bounds['min'][1]]},
        'interface': {'Wheel': {'type': 'Mesh', 'rotationAxis': 'local Z', 'pivot': verification['wheelGltfTranslation']},
                      'StatusLens': {'type': 'Mesh', 'control': 'Clone material per instance; edit emissive/color'},
                      'loadName': 'tllCoolingValve', 'scale': 1,
                      'materialSharing': 'Object3D.clone shares materials; clone StatusLens material before mutation'},
        'verification': {**verification, 'blenderReimport': 'PASS'},
        'bytes': len(GLB.read_bytes()), 'sha256': hashlib.sha256(GLB.read_bytes()).hexdigest(),
        'blendSha256': hashlib.sha256(BLEND.read_bytes()).hexdigest(),
        'limitations': ['Studio renders are asset previews, not game screenshots.',
                        'Runtime gameplay, FPS, draw submissions and independent art approval belong to integration owner.',
                        'Main owns tllCoolingValve SPECIAL_MODELS registration; load without hero/companion ModelContract.',
                        'UVs are provided for optional runtime surface maps; no texture has been generated or baked.'],
    }
    (OUT / 'cooling-valve-v1.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    (PROOF / 'asset-structural-proof.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print('COOLING_VALVE_RECEIPT ' + json.dumps(receipt))


if __name__ == '__main__':
    main()
