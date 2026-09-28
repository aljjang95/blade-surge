"""TLL 밤유리 기록 복원대: 원본 메시, 편집 원본, GLB 재수입 렌더 검증.

실행: work/local-engine/blender-5.2.1-windows-x64/blender.exe
      --background --factory-startup --python-exit-code 1
      --python tools/art/build-nightglass-record-v1.py
외부 자산/텍스처/네트워크 없이 제작한다. Blender Z-up -> glTF Y-up.
"""
import hashlib
import json
import math
import struct
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Euler, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/tll/props'
PROOF = ROOT / 'work/nightglass-record-proof'
GLB = OUT / 'nightglass-record-v1.glb'
BLEND = OUT / 'nightglass-record-v1.blend'
LEAVES = ('LeafA', 'LeafB', 'LeafC')
CENTERS = (-.68, 0, .68)
PIVOTS = {name: (x, -.55, 1.59 + .14 * abs(x)) for name, x in zip(LEAVES, CENTERS)}
PIVOTS['StateLens'] = (0, .27, 2.21)
TAU = math.tau
PARTS = {}
OUT.mkdir(parents=True, exist_ok=True)
PROOF.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


def linear(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb)


def material(name, color, roughness, metallic=0, emission=0, vertex=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*linear(color), 1)
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear(color), 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    if vertex:
        node = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        node.layer_name = 'RecordPigment'
        mat.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
    if emission:
        shader.inputs['Emission Color'].default_value = (*linear(color), 1)
        shader.inputs['Emission Strength'].default_value = emission
    mat['tllAuthored'] = True
    mat['provenance'] = 'Original TLL PBR; geometry and vertex pigments; no image textures'
    return mat


MATS = {
    'Nightglass': material('TLL_Record_NightglassEnamel', '254F65', .3, .48),
    'Brass': material('TLL_Record_AgedBrass', 'BC9257', .36, .76),
    'BookBlock': material('TLL_Record_ClosedPageEdges', 'ACC5CD', .7, .05),
    'Leaf': material('TLL_Record_FrostPagePigment', 'FFFFFF', .43, .16, vertex=True),
    'StateLens': material('TLL_Record_StateFrost', '72E7EF', .24, .15, .65),
}


def register(obj, name, bucket, pigment='C1E4ED'):
    obj.name = name
    obj.data.materials.clear()
    obj.data.materials.append(MATS['Leaf' if bucket in LEAVES else bucket])
    if bucket in LEAVES:
        colors = obj.data.color_attributes.new(name='RecordPigment', type='FLOAT_COLOR', domain='CORNER')
        for entry in colors.data:
            entry.color = (*linear(pigment), 1)
    PARTS.setdefault(bucket, []).append(obj)
    return obj


def mesh(name, vertices, faces, bucket, pigment='C1E4ED'):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return register(obj, name, bucket, pigment)


def box(name, center, size, bucket='Nightglass', bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('수작업 모서리', 'BEVEL')
        # 판 두께의 절반까지 깎으면 옆면이 붕괴하므로 여유를 남긴다.
        mod.width, mod.segments = min(bevel, min(size) * .4), 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return register(obj, name, bucket)


def lathe(name, center, profile, bucket='Brass', sides=12, axis=(0, 0, 1)):
    rotation = Vector(axis).to_track_quat('Z', 'Y')
    vertices = [Vector(center) + rotation @ Vector((r * math.cos(TAU * i / sides),
                r * math.sin(TAU * i / sides), h)) for h, r in profile for i in range(sides)]
    faces = []
    for j in range(len(profile) - 1):
        for i in range(sides):
            a, b = j * sides + i, j * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(profile) - 1) * sides + i for i in range(sides))])
    return mesh(name, vertices, faces, bucket)


def tube(name, points, radius, bucket='Brass', sides=5, pigment='C1E4ED'):
    vertices, faces = [], []
    for i, point in enumerate(points):
        tangent = (Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(0, i - 1)])).normalized()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((0, 1, 0))
        normal = tangent.cross(reference).normalized()
        bitangent = tangent.cross(normal).normalized()
        for j in range(sides):
            vertices.append(Vector(point) + radius * (math.cos(TAU * j / sides) * normal + math.sin(TAU * j / sides) * bitangent))
    for i in range(len(points) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + i for i in range(sides))])
    return mesh(name, vertices, faces, bucket, pigment)


def ring(name, center, radius, thickness, bucket='Brass', sides=40, cross=4):
    x, y, z = center
    vertices = []
    for i in range(sides):
        a = TAU * i / sides
        for j in range(cross):
            b = TAU * j / cross
            r = radius + thickness * math.cos(b)
            vertices.append((x + r * math.cos(a), y + thickness * math.sin(b), z + r * math.sin(a)))
    faces = [(i * cross + j, ((i + 1) % sides) * cross + j,
              ((i + 1) % sides) * cross + (j + 1) % cross, i * cross + (j + 1) % cross)
             for i in range(sides) for j in range(cross)]
    return mesh(name, vertices, faces, bucket)


def page_surface(x, v, layer=0):
    # 열린 책의 골과 앞쪽 기울기. 가장자리 곡률로 세 잎의 윤곽을 분리한다.
    return (x, -.59 + .94 * v, 1.57 + .39 * v + .15 * abs(x) + layer)


def page_block(name, x0, x1, layer, thickness, bucket, nx=5, ny=7, curl=0):
    vertices, faces = [], []
    for side in (0, 1):
        for j in range(ny + 1):
            v = j / ny
            for i in range(nx + 1):
                u = i / nx
                # 기록 조각의 절단면에도 작은 굴곡을 준다.
                x = x0 + (x1 - x0) * u + (math.sin(v * math.pi) * .018 if bucket in LEAVES else 0)
                z = layer + curl * (u * u + .25 * math.sin(v * math.pi)) - side * thickness
                vertices.append(page_surface(x, v, z))
    stride, count = nx + 1, (nx + 1) * (ny + 1)
    for j in range(ny):
        for i in range(nx):
            a = j * stride + i
            faces.append((a, a + 1, a + stride + 1, a + stride))
            faces.append((a + count + stride, a + count + stride + 1, a + count + 1, a + count))
    boundary = list(range(stride)) + [j * stride + nx for j in range(1, ny + 1)] + \
        [ny * stride + i for i in range(nx - 1, -1, -1)] + [j * stride for j in range(ny - 1, 0, -1)]
    for i, a in enumerate(boundary):
        b = boundary[(i + 1) % len(boundary)]
        faces.append((a, a + count, b + count, b))
    return mesh(name, vertices, faces, bucket)


def author():
    # 모서리를 깎은 바닥판, 세 단의 발, 천문대의 가느다란 기둥.
    box('모서리를 깎은 접지대', (0, 0, .085), (1.76, 1.3, .17), bevel=.14)
    box('받침의 황동 테두리', (0, 0, .17), (1.58, 1.15, .07), 'Brass', .11)
    box('밤빛 상단', (0, 0, .245), (1.30, .94, .09), bevel=.09)
    lathe('팔각 기둥의 밑단', (0, .06, .29), [(0, .4), (.10, .37), (.20, .25), (.31, .18)], sides=8)
    lathe('잘록한 밤빛 기둥', (0, .06, .55), [(0, .22), (.13, .17), (.55, .12), (.78, .24), (1.12, .13)], 'Nightglass', 8)
    for z, r in ((.56, .23), (.66, .18), (1.22, .19), (1.56, .29)):
        lathe('기둥의 띠', (0, .06, z), [(0, r), (.04, r)], sides=12)
    for side in (-1, 1):
        tube('곡선 측면 보강대', [(side * .5, .05, .3), (side * .35, .05, .48),
             (side * .26, .05, .84), (side * .39, .05, 1.17), (side * .78, .05, 1.81)], .035, sides=6)
        tube('책받침 지지 팔', [(side * .10, .02, 1.24), (side * .33, -.13, 1.42),
             (side * .77, -.21, 1.70)], .064, 'Nightglass', 6)
    for x in (-.58, .58):
        for y in (-.4, .4):
            lathe('받침의 고정 나사', (x, y, .291), [(0, .045), (.022, .045), (.032, .035)], sides=6)
    # 두 표지와 종이 단면을 실제 형상으로 만들어 책의 윤곽을 보존한다.
    for side, limits in (('왼쪽', (-1.10, -.015)), ('오른쪽', (.015, 1.10))):
        page_block(side + ' 두꺼운 표지', *limits, -.10, .065, 'Nightglass', 3, 4)
        page_block(side + ' 종이 묶음', limits[0] + .025, limits[1] - .025, -.041, .055, 'BookBlock', 3, 4)
        for v in (0, 1):
            pts = [page_surface(limits[0] + (limits[1] - limits[0]) * i / 8, v, -.027) for i in range(9)]
            tube(side + ' 금빛 단면', pts, .016, sides=4)
        for x in limits:
            tube(side + ' 표지 테두리', [page_surface(x, v / 6, -.047) for v in range(7)], .018, sides=4)
        for layer in (-.054, -.072):
            tube(side + ' 종이층 단면', [page_surface(limits[0] + (limits[1] - limits[0]) * i / 4, 0, layer)
                 for i in range(5)], .005, 'Nightglass', 4)
    tube('가운데 제본 등', [page_surface(0, v / 6, -.052) for v in range(7)], .045, sides=6)
    # 이중 천구 고리, 눈금, 바늘, 페이지와 겹치지 않는 상태 렌즈.
    ring('천구 바깥 고리', (0, .33, 1.95), .43, .021)
    ring('천구 안쪽 고리', (0, .33, 1.95), .34, .012, sides=32)
    for i in range(16):
        angle = TAU * i / 16
        r0, r1 = (.35, .42) if i % 4 == 0 else (.39, .423)
        tube('천구 눈금', [(r * math.sin(angle), .328, 1.95 + r * math.cos(angle)) for r in (r0, r1)], .009, sides=4)
    tube('북쪽 바늘', [(0, .31, 2.18), (0, .31, 2.41)], .016, sides=4)
    for sign in (-1, 1):
        tube('비스듬한 천구 축', [(sign * .25, .33, 1.7), (sign * .13, .33, 1.83),
             (-sign * .13, .33, 2.09), (-sign * .29, .33, 2.23)], .012, sides=4)
    lathe('상태 렌즈 받침', (0, .30, 2.21), [(0, .13), (.045, .14), (.068, .112)], sides=16, axis=(0, -1, 0))
    lathe('상태 렌즈', (0, .23, 2.21), [(0, .099), (.025, .105), (.055, .078), (.07, .012)],
          'StateLens', 16, (0, -1, 0))
    # 같은 재질을 쓰는 개별 기록 잎. 색상 속성으로 무늬도 한 드로에 통합한다.
    for index, (name, center) in enumerate(zip(LEAVES, CENTERS)):
        left, right = center - .30, center + .30
        curl = (.07, .04, .09)[index]
        page_block(name + '_curvedSheet', left, right, .045, .026, name, 6, 8, curl)

        def point(x, v, offset=.006):
            u = (x - left) / (right - left)
            return page_surface(x + math.sin(v * math.pi) * .018, v,
                                .045 + curl * (u * u + .25 * math.sin(v * math.pi)) + offset)

        for x in (left + .035, right - .035):
            tube('기록 잎의 연금빛 테두리', [point(x, j / 8) for j in range(9)], .009, name, 4, 'D1B879')
        for v in (.04, .96):
            tube('기록 잎의 단면선', [point(left + .035 + .53 * j / 6, v) for j in range(7)], .008, name, 4, 'D1B879')
        # 1/2/3 눈금과 각기 다른 별자리로 세 기록을 구별한다.
        for i in range(index + 1):
            x = center + (i - index / 2) * .073
            tube('기록 번호', [point(x, .12), point(x, .22)], .012, name, 4, '305C73')
        constellation = [(-.19, .56), (-.10, .75), (.04, .62), (.17, .81)]
        if index == 1:
            constellation = [(-.19, .78), (-.04, .64), (.09, .78), (.19, .56)]
        if index == 2:
            constellation = [(-.18, .62), (-.08, .8), (.04, .70), (.19, .81)]
        tube('별의 연결선', [point(center + dx, v) for dx, v in constellation], .01, name, 4, '305C73')
        for dx, v in constellation:
            star = point(center + dx, v, .014)
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.025, location=star)
            register(bpy.context.object, '별점 상감', name, '4A8C9C')
        for row, width in ((.31, .32), (.38, .39), (.45, .26)):
            tube('기록의 짧은 각인선', [point(center - width / 2 + width * j / 4, row) for j in range(5)],
                 .006, name, 4, '638A99')


def merge_parts():
    root = bpy.data.objects.new('TLL_NightglassRecord_v1', None)
    scene.collection.objects.link(root)
    root['tllIdentity'] = 'nightglass-record-v1'
    root['provenance'] = 'Original TLL self-authored geometry/PBR (no external models/textures)'
    root['units'] = 'meters; glTF Y-up; front +Z; grounded origin'
    result = []
    for bucket, objects in PARTS.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = bucket if bucket in (*LEAVES, 'StateLens') else 'TLL_Record_' + bucket
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        scene.cursor.location = PIVOTS.get(bucket, (0, 0, 0))
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        mat = obj.data.materials[0]
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for poly in obj.data.polygons:
            poly.material_index = 0
            poly.use_smooth = False
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.015)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.parent = root
        obj['tllAuthored'] = True
        obj['role'] = 'animated-record-leaf' if bucket in LEAVES else 'state-lens' if bucket == 'StateLens' else 'static'
        if bucket in LEAVES:
            obj['pivotMeaning'] = 'Front lower edge of curved leaf; identity restored rotation/scale'
            obj['recordIndex'] = LEAVES.index(bucket)
        if bucket == 'StateLens':
            obj['runtimeControl'] = 'Clone this material per instance before editing emissive/color'
        obj.data.calc_loop_triangles()
        for triangle in obj.data.loop_triangles:
            a, b, c = (obj.data.vertices[i].co for i in triangle.vertices)
            assert (b - a).cross(c - a).length_squared > 1e-16, (bucket, triangle.index)
        result.append(obj)
    scene.cursor.location = (0, 0, 0)
    return root, result


def bounds(objects):
    # 회전된 바운드박스의 모서리 대신 실제 정점으로 치수를 측정한다.
    points = [obj.matrix_world @ v.co for obj in objects for v in obj.data.vertices]
    lo = [min(v[i] for v in points) for i in range(3)]
    hi = [max(v[i] for v in points) for i in range(3)]
    return {'min': lo, 'max': hi, 'size': [hi[i] - lo[i] for i in range(3)]}


def yup_bounds(box):
    lo, hi = box['min'], box['max']
    return {'min': [lo[0], lo[2], -hi[1]], 'max': [hi[0], hi[2], -lo[1]],
            'size': [box['size'][0], box['size'][2], box['size'][1]]}


def verify_export():
    blob = GLB.read_bytes()
    assert struct.unpack_from('<III', blob) == (0x46546C67, 2, len(blob))
    json_length, chunk_type = struct.unpack_from('<II', blob, 12)
    assert chunk_type == 0x4E4F534A
    doc = json.loads(blob[20:20 + json_length])
    assert not any(doc.get(key) for key in ('cameras', 'animations', 'skins', 'images', 'textures'))
    assert 'KHR_lights_punctual' not in doc.get('extensionsUsed', [])
    assert all('uri' not in buffer for buffer in doc['buffers'])
    primitives = [p for mesh_data in doc['meshes'] for p in mesh_data['primitives']]
    triangles = sum(doc['accessors'][p['indices']]['count'] // 3 for p in primitives)
    assert triangles <= 6000 and len(primitives) <= 8, (triangles, len(primitives))
    assert all(p.get('mode', 4) == 4 for p in primitives)
    nodes = {node['name']: node for node in doc['nodes']}
    root = nodes['TLL_NightglassRecord_v1']
    assert root.get('translation', [0, 0, 0]) == [0, 0, 0]
    assert len(root['children']) == 7
    interface = {}
    for index, name in enumerate(LEAVES):
        node = nodes[name]
        assert 'mesh' in node
        assert node.get('rotation', [0, 0, 0, 1]) == [0, 0, 0, 1]
        assert node.get('scale', [1, 1, 1]) == [1, 1, 1]
        primitive = doc['meshes'][node['mesh']]['primitives']
        assert len(primitive) == 1 and 'COLOR_0' in primitive[0]['attributes']
        restored = {'translation': node['translation'], 'quaternionXYZW': [0, 0, 0, 1], 'scale': [1, 1, 1]}
        delta = ((-.16, .18, .12), (.025, .26, -.07), (.16, .12, .10))[index]
        q = Euler(tuple(math.radians(v) for v in ((-9, -12, -12), (14, 5, 8), (-7, 14, 13))[index]), 'XYZ').to_quaternion()
        scattered = {'translation': [a + b for a, b in zip(restored['translation'], delta)],
                     'quaternionXYZW': [q.x, q.y, q.z, q.w], 'scale': [1, 1, 1]}
        interface[name] = {'type': 'Mesh', 'recordIndex': index, 'pivot': restored['translation'],
                           'restored': restored, 'scattered': scattered}
    lens = nodes['StateLens']
    assert 'mesh' in lens
    interface['StateLens'] = {'type': 'Mesh', 'pivot': lens['translation'],
                              'control': 'Clone material per instance, then edit emissive/color'}
    assert all(m.get('extras', {}).get('tllAuthored') for m in doc['materials'])
    return {'triangles': triangles, 'primitiveSubmissionsPerInstance': len(primitives),
            'materials': len(doc['materials']), 'meshNodes': [n['name'] for n in doc['nodes'] if 'mesh' in n],
            'allSingleMaterialMeshNodes': all(len(m['primitives']) == 1 for m in doc['meshes']),
            'embeddedBuffersOnly': True, 'noCamerasLightsSkinsAnimationsTextures': True}, interface


def apply_pose(interface, pose):
    # 공개 glTF 변환 계약을 Blender로 변환한다. 런타임에서 그대로 보간한다.
    basis = Quaternion((1, 0, 0), math.pi / 2)
    for name in LEAVES:
        transform = interface[name][pose]
        x, y, z = transform['translation']
        obj = bpy.data.objects[name]
        obj.location = (x, -z, y)
        qx, qy, qz, qw = transform['quaternionXYZW']
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = basis @ Quaternion((qw, qx, qy, qz)) @ basis.conjugated()
        obj.scale = transform['scale']
    bpy.context.view_layer.update()


def studio_render(interface):
    scene = bpy.context.scene
    world = bpy.data.worlds.new('새벽 검증 스튜디오')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.04, .063, .095, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .5
    scene.world = world
    for name, position, energy, color, size in [
        ('큰 온색 주광', (-3.5, -4.5, 6), 850, (1, .87, .70), 4),
        ('푸른 림 조명', (3, 2, 4), 1000, (.59, .83, 1), 3),
        ('정면 보조광', (3, -4, 3), 380, (.75, .9, 1), 3),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, color, 'DISK', size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (Vector((0, 0, 1.2)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera = bpy.data.objects.new('검증 카메라', bpy.data.cameras.new('검증 카메라'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    renders = []
    for name, position, target, scale, pose in [
        ('restored-beauty', (3.1, -6, 3.8), (0, 0, 1.24), 3.18, 'restored'),
        ('restored-front', (0, -7, 3.1), (0, 0, 1.24), 3.08, 'restored'),
        ('restored-back', (-3.2, 6, 3.6), (0, 0, 1.24), 3.18, 'restored'),
        ('scattered-beauty', (3.1, -6, 3.8), (0, 0, 1.24), 3.18, 'scattered'),
        ('restored-detail', (.3, -5, 5.2), (0, -.1, 1.93), 2.65, 'restored'),
    ]:
        apply_pose(interface, pose)
        camera.location, camera.data.ortho_scale = position, scale
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        path = PROOF / ('asset-' + name + '.png')
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        renders.append({'path': path.relative_to(ROOT).as_posix(), 'pose': pose, 'width': 1000, 'height': 1000,
                        'sha256': digest(path), 'subject': 'Reimported delivery GLB; studio geometry/render proof only'})
    return renders


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def main():
    assert bpy.app.version[:3] == (5, 2, 1), bpy.app.version_string
    write_json(PROOF / 'asset-build-checkpoint.json', {'asset': 'nightglass-record-v1', 'status': 'BUILDING',
        'startedUtc': datetime.now(timezone.utc).isoformat(), 'scope': 'Owned generator/model/proof only; geometry/render only',
        'nextAction': 'Export budget-constrained model, reimport GLB, validate transforms and render'})
    author()
    root, objects = merge_parts()
    bpy.context.view_layer.update()
    source_bounds = bounds(objects)
    source_tris = sum(len(obj.data.loop_triangles) for obj in objects)
    assert source_tris <= 6000, source_tris
    assert abs(source_bounds['min'][2]) < 1e-5, source_bounds
    width, depth, height = source_bounds['size']
    assert width <= 3 and depth <= 3 and 2.3 <= height <= 2.5, source_bounds
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *objects]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_yup=True, export_extras=True, export_apply=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    verification, interface = verify_export()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    imported = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bpy.context.view_layer.update()
    imported_bounds = bounds(imported)
    for key in ('min', 'max', 'size'):
        assert max(abs(a - b) for a, b in zip(source_bounds[key], imported_bounds[key])) < 1e-5
    for obj in imported:
        obj.data.calc_loop_triangles()
    assert sum(len(obj.data.loop_triangles) for obj in imported) == verification['triangles'] == source_tris
    apply_pose(interface, 'scattered')
    scatter_bounds = yup_bounds(bounds(imported))
    assert scatter_bounds['size'][0] <= 3 and scatter_bounds['size'][2] <= 3
    assert scatter_bounds['min'][1] >= -1e-5
    apply_pose(interface, 'restored')
    restored_bounds = bounds(imported)
    assert max(abs(a - b) for a, b in zip(restored_bounds['max'], imported_bounds['max'])) < 1e-5
    renders = studio_render(interface)
    receipt = {
        'asset': 'nightglass-record-v1', 'status': 'generated-and-structurally-verified',
        'proofScope': 'GEOMETRY_AND_RENDER_ONLY',
        'createdUtc': datetime.now(timezone.utc).isoformat(),
        'blender': bpy.app.version_string, 'blenderBuildHash': bpy.app.build_hash.decode(),
        'generator': Path(__file__).relative_to(ROOT).as_posix(), 'generatorSha256': digest(Path(__file__)),
        'runtime': GLB.relative_to(ROOT).as_posix(), 'editable': BLEND.relative_to(ROOT).as_posix(),
        'license': 'Original TLL self-authored geometry/PBR (no external models/textures)',
        'provenance': {'geometry': 'Original curved sheets, book covers, turned pedestal, swept braces, astrolabe and inlaid asterisms authored in this script',
                       'materials': 'Five original PBR materials; frost leaf vertex pigments retained',
                       'externalReferences': [], 'externalTextures': [], 'paidGeneration': False},
        'units': 'meters', 'up': 'Y', 'front': '+Z', 'origin': [0, 0, 0],
        'dimensions': {'width': width, 'height': height, 'depth': depth},
        'boundsYUp': yup_bounds(source_bounds), 'scatteredBoundsYUp': scatter_bounds,
        'interface': {'root': 'TLL_NightglassRecord_v1', 'scale': 1, 'defaultPose': 'restored',
                      'transformSpace': 'Absolute local transforms relative to identity root, glTF Y-up, quaternion [x,y,z,w]',
                      'animation': 'Lerp scattered.translation to restored.translation and slerp scattered.quaternionXYZW to restored.quaternionXYZW; scale stays [1,1,1]. No baked clips.',
                      'materialSharing': 'Clone hierarchy per instance; share geometry. Clone StateLens material before mutation. Keep leaf COLOR_0 / vertexColors and original PBR. Optional existing surface bump must not replace baseColor.',
                      'loadNameSuggestion': 'tllNightglassRecord', 'nodes': interface},
        'verification': {**verification, 'blenderReimport': 'PASS', 'sourceReimportBoundsAndTriangleParity': 'PASS',
                         'restoredScatteredPoseRoundtrip': 'PASS', 'meshCount': len(imported)},
        'bytes': GLB.stat().st_size, 'sha256': digest(GLB), 'blendSha256': digest(BLEND),
        'renders': renders,
        'limitations': ['Geometry/render evidence only. No playable integration, GUI, game screenshot, or performance proof.',
                        'Primitive submission count is structural, per instance per pass; renderer passes/shadows may add submissions.',
                        'No runtime/source/assets.js registration, gameplay integration, browser operation, or production work performed.',
                        'Independent art review and same-view Dream Loop target/FPS remain integration-owner gates.',
                        'UVs provided for optional existing bump detail; no image textures generated or downloaded.'],
    }
    write_json(OUT / 'nightglass-record-v1.json', receipt)
    write_json(PROOF / 'asset-structural-proof.json', receipt)
    write_json(PROOF / 'asset-build-checkpoint.json', {'asset': 'nightglass-record-v1', 'status': 'GEOMETRY_RENDER_VERIFIED',
        'checkpointUtc': datetime.now(timezone.utc).isoformat(), 'triangles': verification['triangles'],
        'primitiveSubmissionsPerInstance': verification['primitiveSubmissionsPerInstance'],
        'nextAction': 'Inspect rendered previews; parent owns later runtime integration and independent review'})
    print('NIGHTGLASS_RECORD_RECEIPT ' + json.dumps({'triangles': verification['triangles'],
          'submissions': verification['primitiveSubmissionsPerInstance'], 'dimensions': receipt['dimensions'],
          'sha256': receipt['sha256'], 'renders': len(renders)}))


if __name__ == '__main__':
    main()
