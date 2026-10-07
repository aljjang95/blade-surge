"""Blender로 직접 제작하는 성채 마을·숲 재사용 키트.

실행: blender --background --python-exit-code 1 --python tools/art/build-environment-kit.py
편집 원본과 실제 렌더는 /workspace/scratch/bladesurge-environment-kit에 보관한다.
외부 모델·텍스처·유료 생성 없이 정점 색을 가진 한 메시/재질로 내보낸다.
"""
import bpy
import bmesh
import hashlib
import json
import math
import random
import struct
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/environment/studio-kit'
ART = Path('/workspace/scratch/bladesurge-environment-kit')
OUT.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)
SEED = 20261007
VERSION = 'studio-environment-v1'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


def linear_hex(value):
    rgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb)


PALETTE = {key: linear_hex(value) for key, value in {
    'bark': '635344', 'barkLight': '86745B', 'barkDark': '423D35',
    'pine': '355A4D', 'pineLight': '58826A', 'pineTip': '769077',
    'leaf': '5D7D56', 'leafLight': '86A06D', 'leafDark': '3F634C',
    'stone': '677E7B', 'stoneLight': '95A59A', 'stoneDark': '475F61',
    'moss': '688552', 'mossLight': '90A566', 'plaster': 'C6C5A7',
    'plasterShadow': 'A5AF99', 'roof': '375D66', 'roofLight': '517681',
    'roofDark': '294950', 'brass': 'AD925E', 'window': 'D1BC7F',
    'glass': '8AA9A4', 'dark': '263E43', 'cloth': '547D77',
}.items()}

material = bpy.data.materials.new('Studio kit · matte vertex surface')
material.use_nodes = True
principled = material.node_tree.nodes.get('Principled BSDF')
principled.inputs['Base Color'].default_value = (1, 1, 1, 1)
principled.inputs['Roughness'].default_value = .88
principled.inputs['Metallic'].default_value = 0
vertex_color = material.node_tree.nodes.new('ShaderNodeVertexColor')
vertex_color.layer_name = 'Color'
material.node_tree.links.new(vertex_color.outputs['Color'], principled.inputs['Base Color'])
material['authorship'] = 'Original Blender geometry and vertex palette; no imported media'


class Builder:
    def __init__(self, key):
        self.key = key
        self.verts = []
        self.faces = []
        self.colors = []
        self.random = random.Random(SEED + sum(ord(c) for c in key))

    def add(self, verts, faces, color, variation=.035):
        offset = len(self.verts)
        self.verts.extend(verts)
        base = PALETTE[color] if isinstance(color, str) else color
        for face in faces:
            self.faces.append(tuple(offset + i for i in face))
            shade = 1 + self.random.uniform(-variation, variation)
            self.colors.append(tuple(min(1, max(0, v * shade)) for v in base))

    def box(self, center, size, color, rotation=0):
        x, y, z = center
        w, d, h = (s * .5 for s in size)
        ca, sa = math.cos(rotation), math.sin(rotation)
        corners = [(-w, -d, -h), (w, -d, -h), (w, d, -h), (-w, d, -h),
                   (-w, -d, h), (w, -d, h), (w, d, h), (-w, d, h)]
        verts = [(x + vx * ca - vy * sa, y + vx * sa + vy * ca, z + vz)
                 for vx, vy, vz in corners]
        self.add(verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], color)

    def rod(self, a, b, radius, color, sides=8, tip=None):
        a, b = Vector(a), Vector(b)
        axis = b - a
        rot = axis.to_track_quat('Z', 'Y')
        verts = []
        for end, r in ((a, radius), (b, radius if tip is None else tip)):
            for i in range(sides):
                angle = math.tau * i / sides
                point = end + rot @ Vector((math.cos(angle) * r, math.sin(angle) * r, 0))
                verts.append(tuple(point))
        faces = [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides)
                 for i in range(sides)]
        faces.extend([tuple(reversed(range(sides))), tuple(range(sides, sides * 2))])
        self.add(verts, faces, color)

    def crown(self, center, size, color, subdivisions=1, noise=.13):
        # 가지를 따라 서로 다른 잎 덩어리를 배치하여 자연스러운 윤곽을 만든다.
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1)
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        verts = []
        for vertex in bm.verts:
            p = vertex.co * (1 + self.random.uniform(-noise, noise))
            verts.append(tuple(center[i] + p[i] * size[i] for i in range(3)))
        faces = [tuple(v.index for v in face.verts) for face in bm.faces]
        bm.free()
        self.add(verts, faces, color, .11)

    def foliage_tier(self, center, radius, height, color, sides=14):
        x, y, z = center
        verts = []
        for level, multiplier in ((0, .84), (.24, 1), (.73, .40), (1, .025)):
            for i in range(sides):
                angle = math.tau * i / sides
                r = radius * multiplier * (1 + self.random.uniform(-.11, .11))
                verts.append((x + math.cos(angle) * r, y + math.sin(angle) * r,
                              z + level * height + self.random.uniform(-.08, .08)))
        faces = [tuple(reversed(range(sides)))]
        for row in range(3):
            for i in range(sides):
                a = row * sides + i
                b = row * sides + (i + 1) % sides
                faces.extend([(a, b, b + sides), (a, b + sides, a + sides)])
        faces.append(tuple(3 * sides + i for i in range(sides)))
        self.add(verts, faces, color, .13)

    def leaf(self, a, b, width, color):
        a, b = Vector(a), Vector(b)
        axis = b - a
        side = axis.cross(Vector((0, 0, 1)))
        if side.length < .001:
            side = Vector((1, 0, 0))
        side = side.normalized() * width
        mid = a.lerp(b, .52)
        ridge = mid + Vector((0, 0, width * .45))
        self.add([tuple(a), tuple(mid - side), tuple(b), tuple(mid + side), tuple(ridge)],
                 [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], color, .08)

    def finish(self):
        mesh = bpy.data.meshes.new(self.key + ' geometry')
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        colors = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
        for face, color in zip(mesh.polygons, self.colors):
            for index in face.loop_indices:
                colors.data[index].color = (*color, 1)
        mesh.materials.append(material)
        obj = bpy.data.objects.new(self.key, mesh)
        scene.collection.objects.link(obj)
        obj['studioVersion'] = VERSION
        obj['authorship'] = 'Original Blender-authored geometry; vertex colors; no external inputs'
        obj['units'] = 'metres'
        obj['runtimeForward'] = '+Z'
        # 제작 중 형상 높이와 무관하게 모든 에셋을 지면 중앙 피벗으로 맞춘다.
        low = [min(v.co[i] for v in mesh.vertices) for i in range(3)]
        high = [max(v.co[i] for v in mesh.vertices) for i in range(3)]
        for vertex in mesh.vertices:
            vertex.co.x -= (low[0] + high[0]) / 2
            vertex.co.y -= (low[1] + high[1]) / 2
            vertex.co.z -= low[2]
        mesh.update()
        return obj


def evergreen():
    b = Builder('evergreen-tree')
    b.rod((0, 0, 0), (.13, -.05, 7.2), .28, 'bark', 10, .07)
    for i in range(5):
        angle = i * math.tau / 5 + .2
        b.rod((0, 0, .38), (math.cos(angle) * .75, math.sin(angle) * .75, .03), .12, 'barkDark', 6, .02)
    for row, (z, r, h) in enumerate(((1.25, 2.13, 2.45), (2.65, 1.86, 2.36),
                                   (4.05, 1.48, 2.15), (5.4, 1.05, 1.8))):
        b.foliage_tier((.11 * math.sin(row * 2), .06 * math.cos(row), z), r, h,
                       ['pine', 'pine', 'pineLight', 'pineTip'][row])
        for i in range(3 if row < 3 else 2):
            angle = i * math.tau / 3 + row * .6
            a = (math.cos(angle) * r * .46, math.sin(angle) * r * .46, z + .35)
            tip = (math.cos(angle) * r * .94, math.sin(angle) * r * .94, z + .23)
            b.rod((.05, 0, z + .4), tip, .06, 'barkDark', 5, .02)
            b.crown(a, (r * .38, r * .38, .37), 'pineLight', 1)
    return b.finish()


def broadleaf():
    b = Builder('broadleaf-tree')
    b.rod((0, 0, 0), (.15, .03, 2.7), .43, 'bark', 10, .23)
    b.rod((.15, .03, 2.3), (-.26, .08, 5.6), .25, 'barkLight', 8, .10)
    for i in range(6):
        angle = i * math.tau / 6 + .2
        b.rod((0, 0, .5), (math.cos(angle) * .85, math.sin(angle) * .85, .03), .18, 'barkDark', 6, .04)
    for i in range(7):
        angle = i * 2.39996
        r = 1.55 + (i % 3) * .3
        z = 3.7 + (i % 3) * .56
        p = (math.cos(angle) * r, math.sin(angle) * r, z)
        b.rod((.05, 0, 2.3 + i * .19), (p[0], p[1], z + .3), .14, 'bark', 7, .035)
        b.crown((p[0], p[1], z + .62), (1.2, 1.08, .98),
                ['leaf', 'leafLight', 'leafDark'][i % 3], 2, .10)
    b.crown((-.1, .1, 5.55), (1.53, 1.52, 1.25), 'leafLight', 2, .085)
    return b.finish()


def rock_cluster():
    b = Builder('mossy-rock-cluster')
    for i, (p, size) in enumerate((((-.48, .15, .55), (.86, .77, .78)),
                                   ((.73, -.22, .29), (.62, .53, .46)),
                                   ((.33, .79, .13), (.40, .35, .26)))):
        b.crown(p, size, 'stone' if i == 0 else 'stoneLight', 2, .16)
        b.crown((p[0] -.10, p[1] + .04, p[2] + size[2] * .77),
                (size[0] * .73, size[1] * .61, .12), 'moss', 1, .15)
    for i in range(9):
        a = i * 2.39996
        center = (math.cos(a) * 1.05, math.sin(a) * .84, .01)
        for j in range(3):
            angle = a + j * .65
            tip = (center[0] + math.cos(angle) * .42, center[1] + math.sin(angle) * .42, .39 + j * .10)
            b.leaf(center, tip, .09, 'mossLight' if j == 1 else 'moss')
    return b.finish()


def roof(b, width, depth, z, peak, color='roof', rows=7):
    # 처마 두께·겹친 기와·용마루를 한 메시로 만들어 원경에서도 집을 읽게 한다.
    w, d = width * .5, depth * .5
    b.add([(-w, -d, z), (w, -d, z), (w, d, z), (-w, d, z), (0, -d, peak), (0, d, peak)],
          [(1, 4, 0), (5, 2, 3), (4, 5, 3, 0), (2, 5, 4, 1), (3, 2, 1, 0)], 'roofDark')
    columns = max(6, int(depth / .49))
    for sign in (-1, 1):
        for row in range(rows):
            f0, f1 = row / rows, min(1, (row + 1.1) / rows)
            x0, x1 = sign * w * (1 - f0), sign * w * (1 - f1)
            z0, z1 = z + (peak - z) * f0 + .07, z + (peak - z) * f1 + .07
            for col in range(columns):
                y0 = -d + col * depth / columns + .018
                y1 = -d + (col + 1) * depth / columns - .018
                shade = 'roofLight' if (row * 7 + col * 3) % 11 < 3 else color
                top = [(x0, y0, z0), (x0, y1, z0), (x1, y1, z1), (x1, y0, z1)]
                bottom = [(x, y, zz - .06) for x, y, zz in top]
                # 양쪽 경사에 대해 면 방향을 각각 보존한다.
                faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
                         (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
                if sign == -1:
                    faces = [tuple(reversed(face)) for face in faces]
                b.add(top + bottom, faces, shade, .06)
    b.rod((0, -d - .10, peak + .07), (0, d + .10, peak + .07), .105, 'roofLight', 8)
    for yy in (-d, d):
        b.rod((-w, yy, z), (0, yy, peak), .085, 'barkDark', 6)
        b.rod((0, yy, peak), (w, yy, z), .085, 'barkDark', 6)


def cottage():
    b = Builder('timber-cottage')
    b.box((0, 0, .22), (5.35, 4.25, .44), 'stoneDark')
    b.box((0, 0, 1.94), (4.95, 3.95, 3.2), 'plaster')
    for yy in (-1.99, 1.99):
        b.add([(-2.475, yy, 3.54), (2.475, yy, 3.54), (0, yy, 5.45)],
              [(2, 1, 0)] if yy > 0 else [(0, 1, 2)], 'plasterShadow')
    for x in (-2.49, -1.12, 1.12, 2.49):
        for y in (-2.015, 2.015):
            b.box((x, y, 1.97), (.15, .17, 3.28), 'barkDark')
    for y in (-2.03, 2.03):
        for z in (.56, 2.25, 3.50):
            b.box((0, y, z), (5.15, .16, .16), 'bark')
        for x in (-2.15, 1.38):
            b.rod((x, y, .66), (x + .6, y, 2.20), .065, 'barkDark', 5)
        b.box((0, y, 4.33), (.17, .17, 1.78), 'barkDark')
    for x in (-2.53, 2.53):
        for z in (.58, 2.25, 3.48):
            b.box((x, 0, z), (.13, 4.15, .14), 'bark')
        for y in (-1.2, 0, 1.2):
            b.box((x, y, 1.92), (.14, .14, 3.16), 'barkDark')
    # 앞면은 glTF +Z이며 Blender -Y에 해당한다.
    b.box((0, -2.05, 1.13), (1.05, .17, 1.52), 'dark')
    for x in (-.36, -.18, 0, .18, .36):
        b.box((x, -2.15, 1.13), (.15, .035, 1.44), 'bark')
    for x in (-.56, .56):
        b.box((x, -2.16, 1.14), (.11, .09, 1.64), 'barkDark')
    b.box((0, -2.16, 1.92), (1.2, .12, .12), 'barkDark')
    b.box((.31, -2.21, 1.12), (.085, .055, .085), 'brass')
    for x in (-1.66, 1.66):
        b.box((x, -2.08, 1.70), (.88, .08, 1.02), 'dark')
        b.box((x, -2.14, 1.73), (.71, .035, .85), 'window')
        for xx in (x - .41, x, x + .41):
            b.box((xx, -2.18, 1.73), (.055, .08, .96), 'barkDark')
        b.box((x, -2.19, 1.73), (.86, .09, .065), 'barkDark')
        b.box((x, -2.22, 1.15), (1.05, .38, .19), 'bark')
        for j in range(4):
            b.crown((x - .34 + j * .23, -2.32, 1.3), (.19, .15, .15), 'leaf', 1)
    for x in (-2.58, 2.58):
        b.box((x, .46, 1.72), (.06, .83, .92), 'glass')
        b.box((x, .46, 1.72), (.13, .045, 1.06), 'barkDark')
        b.box((x, .46, 1.72), (.13, .95, .06), 'barkDark')
    roof(b, 5.8, 4.75, 3.49, 5.49)
    b.box((1.58, .86, 4.87), (.65, .67, 1.44), 'stone')
    b.box((1.58, .86, 5.62), (.86, .85, .15), 'stoneLight')
    b.box((1.58, .86, 5.71), (.48, .47, .04), 'dark')
    b.box((0, -2.31, .13), (1.56, .55, .25), 'stone')
    b.box((0, -2.64, .07), (1.85, .46, .13), 'stoneLight')
    return b.finish()


def village_gate():
    b = Builder('village-gate')
    for sign in (-1, 1):
        x = sign * 2.55
        b.box((x, 0, .53), (1.20, 1.38, 1.06), 'stoneDark')
        b.box((x, 0, 1.23), (1.04, 1.2, .35), 'stoneLight')
        for z in (1.62, 2.23, 2.84):
            b.box((x, 0, z), (.84, .88, .57), 'stone')
        b.box((x, 0, 3.26), (1.12, 1.18, .23), 'stoneLight')
        b.box((x, 0, 3.69), (.64, .66, .72), 'bark')
        b.rod((x, -.51, 3.29), (sign * 1.24, -.51, 4.27), .105, 'barkLight', 6)
        b.box((sign * 3.41, .18, 1.3), (1.24, .28, 2.6), 'barkDark')
        for z in (.54, 1.42, 2.31):
            b.box((sign * 3.45, -.04, z), (1.17, .19, .11), 'barkLight')
        b.box((x, -.66, 2.74), (.61, .055, .71), 'cloth')
        b.add([(x - .27, -.70, 2.41), (x + .27, -.70, 2.41), (x, -.70, 2.14)],
              [(0, 2, 1)], 'cloth')
    b.box((0, 0, 4.17), (6.25, .71, .45), 'barkDark')
    b.box((0, -.41, 4.19), (5.93, .12, .16), 'barkLight')
    roof(b, 7.25, 1.97, 4.33, 5.62, rows=6)
    # 나뭇잎 문장을 깎아 넣고 전투 포탈과 구별되는 무광 표면을 유지한다.
    b.box((0, -.53, 4.13), (.83, .15, .88), 'brass')
    b.box((0, -.64, 4.13), (.67, .035, .72), 'cloth')
    b.leaf((0, -.675, 3.90), (0, -.675, 4.39), .20, 'stoneLight')
    return b.finish()


def lantern():
    b = Builder('lantern')
    b.box((0, 0, .12), (.55, .55, .24), 'stoneDark')
    b.box((0, 0, .32), (.37, .37, .20), 'stoneLight')
    b.rod((0, 0, .43), (0, 0, 2.12), .095, 'barkDark', 8, .085)
    b.rod((0, 0, 1.90), (0, -.50, 2.27), .055, 'brass', 6)
    b.box((0, -.47, 2.14), (.47, .47, .52), 'window')
    for x in (-.25, .25):
        for y in (-.72, -.22):
            b.box((x, y, 2.14), (.055, .055, .63), 'dark')
    for z in (1.84, 2.44):
        b.box((0, -.47, z), (.61, .61, .09), 'brass')
    b.add([(-.39, -.86, 2.48), (.39, -.86, 2.48), (.39, -.08, 2.48), (-.39, -.08, 2.48), (0, -.47, 2.84)],
          [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], 'roof')
    b.rod((0, -.47, 2.79), (0, -.47, 2.96), .045, 'brass', 6, .025)
    return b.finish()


def inspect_export(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    assert (magic, version, length) == (0x46546C67, 2, len(data))
    json_length, json_type = struct.unpack_from('<II', data, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(data[20:20 + json_length])
    primitives = [p for mesh in doc['meshes'] for p in mesh['primitives']]
    assert len(doc['meshes']) == len(primitives) == len(doc['materials']) == 1
    assert not any(doc.get(key) for key in ('images', 'textures', 'animations', 'skins', 'cameras'))
    assert not doc.get('extensions', {}).get('KHR_lights_punctual')
    assert all(p.get('mode', 4) == 4 and 'COLOR_0' in p['attributes'] for p in primitives)
    assert all(m.get('alphaMode', 'OPAQUE') == 'OPAQUE' for m in doc['materials'])
    assert not any('uri' in buffer for buffer in doc.get('buffers', []))
    triangles = sum(doc['accessors'][p['indices']]['count'] // 3 for p in primitives)
    position = doc['accessors'][primitives[0]['attributes']['POSITION']]
    assert triangles <= 5500 and len(data) < 900000
    assert all(math.isfinite(v) for v in position['min'] + position['max'])
    return {'file': path.name, 'url': '/models/environment/studio-kit/' + path.name,
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'triangles': triangles, 'draws': 1, 'materials': 1,
            'boundsGltf': {'min': position['min'], 'max': position['max']},
            'vertexColors': True, 'textures': 0, 'validation': 'passed-static-glb-contract'}


sources = [evergreen(), broadleaf(), rock_cluster(), cottage(), village_gate(), lantern()]
labels = {
    'evergreen-tree': ('성채 침엽수', 'forest'),
    'broadleaf-tree': ('정원 활엽수', 'forest'),
    'mossy-rock-cluster': ('이끼 바위 군집', 'forest'),
    'timber-cottage': ('청기와 목조 가옥', 'village'),
    'village-gate': ('숲길 마을 문', 'village'),
    'lantern': ('황동 길안내 등', 'village'),
}
assets = []
for obj in sources:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = OUT / (obj.name + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_normals=True,
                              export_texcoords=False, export_animations=False, export_extras=True,
                              export_materials='EXPORT', export_all_vertex_colors=True)
    info = inspect_export(path)
    info['labelKo'], info['category'] = labels[obj.name]
    if info['category'] == 'forest' and obj.name.endswith('tree'):
        assert info['triangles'] <= 1000
    assets.append(info)

catalog = {
    'version': VERSION, 'schema': 1, 'blender': bpy.app.version_string,
    'generator': 'tools/art/build-environment-kit.py',
    'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'seed': SEED, 'rights': 'Original authored geometry and palette; no external assets or generation providers',
    'license': 'Project-owned original assets', 'runtime': {'units': 'metres', 'up': '+Y', 'forward': '+Z',
                                                          'pivot': 'ground-centred', 'static': True},
    'policy': {'maxTrianglesPerAsset': 5500, 'maxBytesPerAsset': 900000, 'maxDrawsPerAsset': 1,
               'textures': False, 'transparentSurfaces': False, 'lights': False, 'skins': False},
    'assets': assets,
    'evidence': {'staticBytes': 'checked after each Blender GLB export',
                 'sourceBlend': str(ART / 'studio-environment-v1.blend'),
                 'blenderPreview': str(ART / 'studio-environment-preview.png'),
                 'runtimeVisualReview': 'Separate game camera verification required'},
}
(OUT / 'manifest.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')

# 실제 Blender 렌더를 만들고 지면 중앙 모델은 GLB를 내보낸 뒤에만 이동한다.
positions = [(-8.2, 2.1, 0), (-2.2, 2.3, 0), (5.3, -5.5, 0),
             (5.4, 2.2, 0), (-5.0, -5.4, 0), (1.2, -5.4, 0)]
for obj, p in zip(sources, positions):
    obj.location = p
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.use_denoising = False
scene.view_layers[0].cycles.use_denoising = False
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.render.resolution_x = 1600
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.world = bpy.data.worlds.new('Studio preview world')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.24, .32, .34, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .65
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.035))
floor = bpy.context.object
floor.name = 'PREVIEW_ONLY_ground'
ground = bpy.data.materials.new('PREVIEW_ONLY_muted slate')
ground.use_nodes = True
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*linear_hex('617478'), 1)
ground.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1
floor.data.materials.append(ground)
for name, p, energy, size in (('Key', (-8, -12, 16), 3200, 9), ('Fill', (11, -4, 10), 1800, 8),
                              ('Rim', (2, 10, 13), 2700, 7)):
    bpy.ops.object.light_add(type='AREA', location=p)
    light = bpy.context.object
    light.name = 'PREVIEW_ONLY_' + name
    light.data.energy = energy
    light.data.size = size
    light.rotation_euler = (Vector((0, 0, 2)) - light.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add(location=(16, -25, 20))
camera = bpy.context.object
camera.name = 'PREVIEW_ONLY_camera'
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 26
camera.rotation_euler = (Vector((0, -.5, 2.3)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'studio-environment-v1.blend'))
scene.render.filepath = str(ART / 'studio-environment-preview.png')
bpy.ops.render.render(write_still=True)
print(json.dumps({'version': VERSION, 'assets': len(assets), 'triangles': sum(a['triangles'] for a in assets),
                  'bytes': sum(a['bytes'] for a in assets), 'preview': scene.render.filepath}, ensure_ascii=False))
