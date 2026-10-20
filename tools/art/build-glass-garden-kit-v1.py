"""유리 정원(glass_garden) 첫 던전용 Blender 소품 키트 v1.

실행: blender --background --python-exit-code 1 --python tools/art/build-glass-garden-kit-v1.py
편집 원본(.blend)·미리보기 PNG는 art/glass-garden-kit-v1/, 런타임 GLB·manifest는
public/models/glass-garden-kit-v1/ 에 둔다. 외부 모델·텍스처·생성 서비스 없이 정점 색만 쓴다.

소품 6종(각각 LOD0 / LOD1 ≈ 40 %)
  crystal-cluster-s  작은 민트 수정 군집        crystal-cluster-l  큰 수정 군집
  trellis-arch       깨진 유리 격자 아치 조각    planter-crystal    수정 잎 화분
  moss-edging        이끼 돌 테두리 모듈         hanging-lantern    걸이 유리 등(발광)

좌표 계약: 미터, glTF Y-up, 전면 +Z(Blender -Y), 지면 중앙 피벗.
재질은 둘뿐이다. gg_matte(정점 색 석재·이끼·황동)와 gg_glow(정점 색 × 발광, 런타임이 이름으로 식별).
GLB는 Blender 출력 뒤 tools/art/compress-dungeon-forge.mjs 로 무손실 meshopt 압축한다.
"""
import bpy
import bmesh
import hashlib
import json
import math
import random
import struct
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/glass-garden-kit-v1'
ART = ROOT / 'art/glass-garden-kit-v1'
OUT.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)
SEED = 20261021
VERSION = 'glass-garden-kit-v1'
TRI_BUDGET = 1500
LOD1_RATIO = (.30, .50)  # LOD1/LOD0 삼각형 비율 허용 범위(목표 ≈ .40)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1


def linear_hex(value):
    rgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb)


# 기존 정원 팔레트(대리석 크림·회녹 석재·황동·민트)에 맞춘 정점 색.
PAL = {key: linear_hex(value) for key, value in {
    'marble': 'D6D2BA', 'marbleShade': 'B3B8A4', 'stone': '6E8A83', 'stoneDark': '3F5853',
    'stoneLight': '93A89C', 'gold': 'C9A04E', 'goldDark': '8C6E34',
    'moss': '5E8A48', 'mossLight': '88B35C', 'mossDark': '3C6340',
    'leaf': '4F8F5A', 'soil': '4B5A3E', 'iron': '2F3F40',
    'mintDeep': '1FA588', 'mint': '62EFBD', 'mintPale': 'C8FFEA', 'mintWhite': 'F0FFF8',
    'glassPane': '9FE8D4', 'warm': 'FFE9A8',
}.items()}

matte = bpy.data.materials.new('gg_matte')
matte.use_nodes = True
bsdf = matte.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = .86
bsdf.inputs['Metallic'].default_value = 0
vc = matte.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Color'
matte.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
matte['authorship'] = 'Original Blender geometry and vertex palette; no imported media'

glow = bpy.data.materials.new('gg_glow')
glow.use_nodes = True
gb = glow.node_tree.nodes.get('Principled BSDF')
gb.inputs['Roughness'].default_value = .3
vc2 = glow.node_tree.nodes.new('ShaderNodeVertexColor')
vc2.layer_name = 'Color'
glow.node_tree.links.new(vc2.outputs['Color'], gb.inputs['Base Color'])
glow.node_tree.links.new(vc2.outputs['Color'], gb.inputs['Emission Color'])
gb.inputs['Emission Strength'].default_value = 1.4
glow['authorship'] = 'Original Blender geometry; runtime multiplies emissive by vertex colour'

LIGHT_DIR = Vector((-.35, -.45, .82)).normalized()  # 앞(-Y) 위쪽 광원으로 발광면 면별 음영을 정점 색에 굽는다.


def mix(a, b, t):
    t = min(1, max(0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


class Kit:
    def __init__(self, key, lod):
        self.key, self.lod = key, lod
        self.verts, self.faces, self.fmat, self.fcol = [], [], [], []
        self.rng = random.Random(SEED + sum(ord(c) for c in key))

    def add(self, verts, faces, color, mat=0, grad=None, jitter=.05):
        """color: 이름 또는 (r,g,b). grad=(색A, 색B, z0, z1)이면 높이로 보간한다."""
        offset = len(self.verts)
        self.verts.extend(tuple(v) for v in verts)
        base = PAL[color] if isinstance(color, str) else color
        if grad:
            ca = PAL[grad[0]] if isinstance(grad[0], str) else grad[0]
            cb = PAL[grad[1]] if isinstance(grad[1], str) else grad[1]
        for face in faces:
            shade = 1 + self.rng.uniform(-jitter, jitter)
            if mat == 1:  # 발광면: 면 법선으로 음영을 굽는다.
                pts = [Vector(verts[i]) for i in face]
                n = Vector((0, 0, 0))
                for i in range(len(pts)):
                    p, q = pts[i], pts[(i + 1) % len(pts)]
                    n += Vector(((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y)))
                if n.length > 1e-9:
                    shade *= .62 + .6 * max(0, n.normalized().dot(LIGHT_DIR))
            corner = []
            for i in face:
                c = mix(ca, cb, (verts[i][2] - grad[2]) / (grad[3] - grad[2])) if grad else base
                corner.append(tuple(min(1.6, max(0, v * shade)) for v in c))
            self.faces.append(tuple(offset + i for i in face))
            self.fmat.append(mat)
            self.fcol.append(corner)

    # ---------- 기본 형상 ----------
    def block(self, center, size, color, top=None, yaw=0, mat=0, grad=None, jitter=.05):
        """직육면체(top=(w,d)이면 윗면이 줄어드는 절두체). center는 바닥 중심."""
        x, y, z = center
        w, d, h = size
        tw, td = (w, d) if top is None else top
        c, s = math.cos(yaw), math.sin(yaw)
        ring = lambda ww, dd, zz: [(x + (px * ww / 2) * c - (py * dd / 2) * s,
                                    y + (px * ww / 2) * s + (py * dd / 2) * c, z + zz)
                                   for px, py in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        verts = ring(w, d, 0) + ring(tw, td, h)
        self.add(verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)],
                 color, mat, grad, jitter)

    def pyramid(self, center, base_r, height, sides, color, mat=0, grad=None, jitter=.05, yaw=0):
        x, y, z = center
        verts = [(x + math.cos(yaw + math.tau * i / sides) * base_r,
                  y + math.sin(yaw + math.tau * i / sides) * base_r, z) for i in range(sides)] + [(x, y, z + height)]
        faces = [(i, (i + 1) % sides, sides) for i in range(sides)] + [tuple(reversed(range(sides)))]
        self.add(verts, faces, color, mat, grad, jitter)

    def frustum(self, center, r0, r1, height, sides, color, mat=0, grad=None, jitter=.05, yaw=0, cap=True):
        x, y, z = center
        verts = []
        for r, zz in ((r0, 0), (r1, height)):
            verts += [(x + math.cos(yaw + math.tau * i / sides) * r, y + math.sin(yaw + math.tau * i / sides) * r, z + zz)
                      for i in range(sides)]
        faces = [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
        if cap:
            faces.append(tuple(range(sides, sides * 2)))
        self.add(verts, faces, color, mat, grad, jitter)

    def rod(self, a, b, r0, color, sides=5, r1=None, mat=0, jitter=.04, grad=None):
        a, b = Vector(a), Vector(b)
        rot = (b - a).to_track_quat('Z', 'Y')
        r1 = r0 if r1 is None else r1
        verts = []
        for end, r in ((a, r0), (b, r1)):
            for i in range(sides):
                ang = math.tau * i / sides
                verts.append(tuple(end + rot @ Vector((math.cos(ang) * r, math.sin(ang) * r, 0))))
        faces = [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
        faces.append(tuple(range(sides, sides * 2)))
        self.add(verts, faces, color, mat, grad, jitter)

    def crystal(self, base, r, h, tip, sides, lean=0, lean_dir=0, yaw=0, mat=1, grad=('mintDeep', 'mintPale'), sink=.08):
        """육각 수정: 아래가 살짝 좁고 윗면에서 뾰족하게 끝난다. 아래 sink만큼 바닥에 묻는다."""
        pts = []
        for rr, zz in ((r * .78, -sink), (r, h)):
            pts += [(math.cos(math.tau * i / sides) * rr, math.sin(math.tau * i / sides) * rr, zz) for i in range(sides)]
        pts.append((r * .12, 0, h + tip))
        axis = Vector((-math.sin(lean_dir), math.cos(lean_dir), 0))
        m = Matrix.Rotation(lean, 3, axis) @ Matrix.Rotation(yaw, 3, 'Z')
        verts = [tuple(Vector(base) + m @ Vector(p)) for p in pts]
        faces = [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
        faces += [((i + 1) % sides + sides, i + sides, sides * 2) for i in range(sides)]
        zs = [v[2] for v in verts]
        self.add(verts, faces, grad[0], mat, (grad[0], grad[1], min(zs), max(zs)), .06)

    def blade(self, a, b, width, thick, color, mat=0, grad=None, jitter=.06, bend=0.0):
        """마름모 단면 잎/수정잎. a 밑동, b 끝."""
        a, b = Vector(a), Vector(b)
        axis = b - a
        side = axis.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(axis).normalized()
        mid = a.lerp(b, .42) + up * bend
        verts = [a, mid + side * width, mid + up * thick, mid - side * width, mid - up * thick * .6, b + up * bend * 1.6]
        faces = [(0, 2, 1), (0, 3, 2), (1, 2, 5), (2, 3, 5), (0, 1, 4), (0, 4, 3), (1, 5, 4), (4, 5, 3)]
        self.add([tuple(v) for v in verts], faces, color, mat, grad, jitter)

    def rock(self, center, size, color, noise=.2, yaw=0, mat=0, grad=None, flat=.6, jitter=.07, subdiv=0):
        """저폴리 깎은 돌덩이(ico 구 변형). 아래 flat 비율만큼 잘라 바닥에 붙인다."""
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1 + subdiv if self.lod == 0 else 1, radius=1)
        bm.verts.ensure_lookup_table()
        c, s = math.cos(yaw), math.sin(yaw)
        verts = []
        for v in bm.verts:
            p = v.co * (1 + self.rng.uniform(-noise, noise))
            pz = max(p.z, -flat) if p.z < 0 else p.z
            lx, ly = p.x * size[0], p.y * size[1]
            verts.append((center[0] + lx * c - ly * s, center[1] + lx * s + ly * c, center[2] + (pz + flat) * size[2]))
        faces = [tuple(v.index for v in f.verts) for f in bm.faces]
        bm.free()
        self.add(verts, faces, color, mat, grad, jitter)

    def sweep(self, pts, width, depth, color, mat=0, jitter=.04, closed_ends=True, grad=None, normal_up=(0, -1, 0)):
        """중심선 pts를 따라 직사각 단면(width: 반경 방향, depth: y 방향)을 쓸어 만든 띠."""
        rings = []
        up = Vector(normal_up)
        for i, p in enumerate(pts):
            p = Vector(p)
            t = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
            side = t.cross(up).normalized()
            rings.append([p + side * width / 2 + up * depth / 2, p - side * width / 2 + up * depth / 2,
                          p - side * width / 2 - up * depth / 2, p + side * width / 2 - up * depth / 2])
        verts = [tuple(v) for ring in rings for v in ring]
        faces = []
        for i in range(len(rings) - 1):
            for k in range(4):
                a, b = i * 4 + k, i * 4 + (k + 1) % 4
                faces.append((a, b, b + 4, a + 4))
        if closed_ends:
            faces.append((0, 3, 2, 1))
            n = (len(rings) - 1) * 4
            faces.append((n, n + 1, n + 2, n + 3))
        self.add(verts, faces, color, mat, grad, jitter)

    def finish(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        attr = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
        for poly, corner in zip(mesh.polygons, self.fcol):
            poly.material_index = self.fmat[poly.index]
            for loop, color in zip(poly.loop_indices, corner):
                attr.data[loop].color = (*color, 1)
            poly.use_smooth = False
        mesh.materials.append(matte)
        mesh.materials.append(glow)
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
        # 지면 중앙 피벗: XY는 경계 중심, Z는 바닥(0). 걸이 등은 base를 원점에 두기 위해 xy_pivot 지정.
        low = [min(v.co[i] for v in mesh.vertices) for i in range(3)]
        high = [max(v.co[i] for v in mesh.vertices) for i in range(3)]
        pivot = PIVOT_XY.get(self.key)
        cx = (low[0] + high[0]) / 2 if pivot is None else pivot[0]
        cy = (low[1] + high[1]) / 2 if pivot is None else pivot[1]
        for vertex in mesh.vertices:
            vertex.co.x -= cx
            vertex.co.y -= cy
            vertex.co.z -= min(0, low[2]) if self.key in KEEP_SINK else low[2]
        mesh.update()
        obj['tllIdentity'] = VERSION
        obj['authorship'] = 'Original Blender-authored geometry; vertex colours; no external inputs'
        obj['units'] = 'metres'
        obj['runtimeForward'] = '+Z'
        obj['lod'] = self.lod
        return obj


PIVOT_XY = {'hanging-lantern': (0, 0)}  # 기둥 밑동이 원점
KEEP_SINK = set()


# ====================== 소품 ======================
def crystal_cluster(kit, big):
    rng = kit.rng
    lod0 = kit.lod == 0
    sides = 6 if lod0 else 4
    s = 1.0 if big else .5
    # 이끼 돌 받침 (돌 + 위에 얹힌 이끼 덩어리)
    kit.rock((0, 0, 0), (.95 * s + (.1 if big else .12), .85 * s + .1, .26 * s + .07), 'stone', .16, 0.4, grad=('stoneDark', 'stoneLight', -.05, .5), flat=.2)
    top = 1.2 * (.26 * s + .07)
    kit.rock((.12 * s, -.1 * s, top - .1), (.62 * s, .54 * s, .13), 'moss', .2, 1.0, grad=('mossDark', 'mossLight', top - .1, top + .12), flat=.1)
    # (dx, dy, 반경, 높이, 끝, 기울기, 기울임 방향, 색조)
    plan = [
        (0, 0, .15, 1.15, .62, .05, .6, 0),
        (.30, .14, .11, .72, .40, .30, .35, 0),
        (-.30, .18, .10, .62, .36, .33, 2.5, 0),
        (.05, -.34, .09, .46, .30, .38, -1.5, 1),
        (-.26, -.22, .075, .36, .24, .42, -2.4, 0),
        (.40, -.20, .06, .30, .20, .45, -.5, 1),
        (-.08, .36, .06, .28, .2, .4, 1.7, 0),
        (.2, .42, .05, .22, .16, .5, 1.1, 1),
        (-.46, -.02, .05, .24, .16, .5, 3.0, 0),
    ]
    if big:
        plan = plan[:9] if lod0 else [plan[i] for i in (0, 1, 2, 3, 5)]
    else:
        plan = plan[:7] if lod0 else [plan[i] for i in (0, 1, 2)]
    for dx, dy, r, h, tip, lean, direction, tone in plan:
        grad = ('mintDeep', 'mintPale') if tone else ('mintDeep', 'mint')
        kit.crystal((dx * s, dy * s, .18 * s), r * s, h * s, tip * s, sides, lean, direction, rng.uniform(0, 1), 1, grad)
    if big and lod0:
        for i in range(4):  # 발치의 작은 파편
            ang = rng.uniform(0, math.tau)
            kit.crystal((math.cos(ang) * .66, math.sin(ang) * .6, .05), .05, .14, .1, 4, .5, ang, 0, 1, ('mintDeep', 'mint'))
    if lod0:  # 발치 자갈
        for i in range(3 if big else 2):
            ang = 1.3 + i * 2.2
            kit.rock((math.cos(ang) * (.78 * s + .08), math.sin(ang) * (.7 * s + .08), 0), (.14 * s + .04, .12 * s + .04, .1), 'stoneLight', .22, i, flat=.3)
    for i in range(3 if lod0 else 2):
        ang = i * 2.1 + .6
        kit.blade((math.cos(ang) * .45 * s, math.sin(ang) * .42 * s, .14 * s), (math.cos(ang) * .75 * s, math.sin(ang) * .7 * s, .34 * s),
                  .07 * s, .02, 'mossLight', grad=('moss', 'mossLight', .14 * s, .34 * s))


def broken_arch(kit):
    lod0 = kit.lod == 0
    h_spring, s, apex = 2.05, 1.1, 1.3          # 스프링 높이, 반 경간, 정점 높이(스프링 위)
    rib_w = .22
    R = (s * s + apex * apex) / (2 * s)         # 두 중심 뾰족 아치의 반지름
    base_z = h_spring + .14
    # 받침/기둥(왼쪽 온전, 오른쪽은 부러짐)
    for side, broken in ((-1, False), (1, True)):
        x = side * 1.22
        kit.block((x, 0, 0), (.86, .5, .26), 'stoneDark', top=(.78, .44))
        kit.block((x, 0, .26), (.64, .38, .16), 'marbleShade', top=(.6, .34))
        top_h = 1.45 if broken else h_spring
        kit.block((x, 0, .42), (.5, .3, top_h - .42), 'marble', top=(.46, .28))
        if lod0:
            kit.block((x - side * .26, 0, .55), (.04, .16, top_h - .8), 'goldDark')           # 안쪽 금테
            top_leaf = (1.05 if not broken else .5)
            kit.blade((x, -.17, .72), (x, -.17, .72 + top_leaf), .1, .03, 'mint', 1, grad=('mintDeep', 'mintWhite', .72, .72 + top_leaf))  # 기둥 잎 문양
            for k, sgn in enumerate((-1, 1)):
                kit.blade((x, -.17, .92 + k * .0), (x + sgn * .13, -.17, 1.2), .05, .02, 'mint', 1, grad=('mintDeep', 'mint', .9, 1.2))
            kit.block((x, 0, 1.28), (.56, .36, .05), 'gold', top=(.54, .34))                                  # 중간 금 띠
        if not broken:
            kit.block((x, 0, h_spring), (.66, .4, .14), 'gold', top=(.6, .36))
            kit.pyramid((x, 0, h_spring + .14), .27, .55, 4, 'marble', yaw=math.pi / 4)
            kit.crystal((x, 0, h_spring + .62), .07, .04, .3, 4, 0, 0, math.pi / 4, 1, ('mintDeep', 'mintWhite'), sink=0)
        else:
            kit.block((x, 0, top_h), (.5, .3, .1), 'marbleShade', top=(.3, .2), yaw=.2)
            kit.block((x + .08, .04, top_h + .1), (.2, .14, .16), 'marble', top=(.06, .06), yaw=-.4)
            if lod0:
                kit.rock((.74, -.34, .0), (.28, .22, .2), 'marbleShade', .2, .5, flat=.3)
                kit.rock((1.75, -.22, .0), (.2, .16, .12), 'stone', .2, 1.2, flat=.3)
                kit.rock((1.38, -.52, .0), (.16, .13, .1), 'marble', .2, 2.2, flat=.3)

    def arch(side, t0, t1, n, grow=0.0):
        cx = side * (s - R)                      # 반대쪽 스프링을 지나는 중심의 x
        a_apex = math.atan2(apex, -cx)
        a_start = math.pi if side < 0 else 0
        pts = []
        for i in range(n + 1):
            ang = a_start + (a_apex - a_start) * (t0 + (t1 - t0) * i / n)
            pts.append((cx + math.cos(ang) * (R + grow), 0, base_z + math.sin(ang) * (R + grow)))
        return pts

    def arch_z(x, grow=0.0):
        cx = (s - R) if x > 0 else (R - s)
        return base_z + math.sqrt(max(0, (R + grow) ** 2 - (x - cx) ** 2))

    n_left, n_right = (8 if lod0 else 5), (3 if lod0 else 2)
    # 왼쪽 기둥에서 올라온 리브는 정점을 지나 오른쪽으로 조금 내려오다 들쭉날쭉하게 끊긴다.
    t_cut = .72
    kit.sweep(arch(-1, 0, 1, n_left), rib_w, .26, 'marble')
    kit.sweep(arch(1, t_cut, 1, n_right), rib_w, .26, 'marble')
    if lod0:
        kit.sweep(arch(-1, 0, 1, n_left, -rib_w / 2 - .02), .05, .3, 'gold')
        kit.sweep(arch(1, t_cut, 1, n_right, -rib_w / 2 - .02), .05, .3, 'gold')
    end = arch(1, t_cut, 1, n_right)[0]
    kit.block((end[0] - .02, -.1, end[2] - .12), (.22, .24, .12), 'marbleShade', top=(.06, .1), yaw=.3)   # 부러진 리브 끝
    kit.block((1.12, -.52, 0), (.9, .3, .26), 'marbleShade', top=(.7, .24), yaw=.5)                   # 떨어져 누운 리브 토막
    if lod0:
        kit.block((1.12, -.52, .26), (.6, .24, .1), 'marble', top=(.4, .2), yaw=.5)
    # 트렐리스: 금 문설주 + 유리(왼쪽은 남고 오른쪽은 대부분 사라짐)
    low = h_spring + .24
    cols = [-1.0, -.62, -.24] if lod0 else [-1.0, -.45]
    for x in cols:
        top = arch_z(x, -rib_w / 2 - .03)
        kit.block((x, 0, low), (.045, .09, top - low), 'goldDark')
    kit.block((-.62, 0, low + .62), (.78 + (0 if lod0 else .0), .09, .045), 'goldDark')
    glass = [(-1.0, -.62), (-.62, -.24)] if lod0 else [(-1.0, -.45)]
    for x0, x1 in glass:
        z0, z1 = low + .03, low + .55
        top0, top1 = arch_z(x0 + .03, -rib_w / 2 - .04), arch_z(x1 - .03, -rib_w / 2 - .04)
        # 아래 칸(사각)과 위 칸(아치를 따라 오르는 사다리꼴)
        for lo, hi0, hi1, cl in ((z0, z1, z1, ('mintDeep', 'mint')), (z1 + .05, top0, top1, ('mint', 'mintPale'))):
            if hi0 - lo < .06 or hi1 - lo < .06:
                continue
            q = [(x0 + .03, lo), (x1 - .03, lo), (x1 - .03, hi1), (x0 + .03, hi0)]
            kit.add([(px, .0, pz) for px, pz in q], [(0, 1, 2, 3), (3, 2, 1, 0)], 'glassPane', 1,
                    grad=(cl[0], cl[1], lo, max(hi0, hi1)), jitter=.03)
    if lod0:  # 오른쪽 칸에 남은 한 장은 금이 간 삼각형 조각
        kit.add([(.22, 0, low + .02), (.62, 0, low + .02), (.22, 0, low + .75)], [(0, 1, 2), (2, 1, 0)], 'glassPane', 1,
                grad=('mintDeep', 'mintPale', low, low + .8), jitter=.03)
        kit.block((.22, 0, low), (.045, .09, .75), 'goldDark')
    # 정점 잎 문양: 수정 잎 3장(왼쪽 리브 끝)
    ax, az = arch(-1, 0, 1, n_left)[-2][0], arch(-1, 0, 1, n_left)[-2][2]
    leaves = ((0, .5), (.55, .38), (-.55, .38)) if lod0 else ((0, .5),)
    for ang, ln in leaves:
        kit.blade((ax + .05, -.08, az - .1), (ax + .05 + math.sin(ang) * ln, -.08, az - .1 + math.cos(ang) * ln), .1, .03, 'mint', 1,
                  grad=('mintDeep', 'mintWhite', az - .1, az + ln))
    if lod0:  # 허공에 매달린 유리 파편
        for px, pz, ln in ((.5, base_z + .95, .34), (.85, base_z + .7, .26)):
            kit.blade((px, -.02, pz), (px, -.02, pz - ln), .06, .02, 'mint', 1, grad=('mintDeep', 'mintPale', pz - ln, pz))
    # 덩굴: 왼쪽 기둥과 아치를 타고 오른다
    vine = [(-1.52, -.2, .1), (-1.46, -.22, .6), (-1.52, -.2, 1.1), (-1.44, -.22, 1.5), (-1.32, -.2, 1.95)]
    for a, b in zip(vine[:-1], vine[1:]):
        kit.rod(a, b, .035, 'leaf', 4)
    for p in (vine[1:] if lod0 else vine[1::2]):
        kit.blade(p, (p[0] + .22, p[1] - .08, p[2] - .18), .07, .02, 'mossLight', grad=('moss', 'mossLight', p[2] - .18, p[2]))
        if lod0:
            kit.blade(p, (p[0] - .16, p[1] - .08, p[2] + .1), .06, .02, 'moss')
    if lod0:
        kit.rock((1.0, -.22, 0), (.34, .22, .14), 'moss', .25, .6, grad=('mossDark', 'mossLight', 0, .3), flat=.2)
        for k, (px, pz, ln) in enumerate(((.2, -.45, .22), (.5, -.4, .16), (-.5, -.5, .14))):  # 바닥 유리 파편
            kit.crystal((px, pz, .02), .045, ln, .08, 4, 1.2, k * 2.0, 0, 1, ('mintDeep', 'mintPale'), sink=0)


def planter(kit):
    lod0 = kit.lod == 0
    rng = kit.rng
    sides = 8 if lod0 else 6
    ph = math.pi / sides
    kit.frustum((0, 0, 0), .5, .62, .56, sides, 'stone', grad=('stoneDark', 'stoneLight', 0, .56), yaw=ph, cap=False)
    kit.frustum((0, 0, .56), .66, .66, .1, sides, 'gold', grad=('goldDark', 'gold', .56, .66), yaw=ph, cap=False)
    kit.frustum((0, 0, .66), .6, .6, .0, sides, 'soil', yaw=ph, cap=True)
    if not lod0:
        kit.rock((.38, -.36, .5), (.22, .16, .14), 'moss', .2, .5, grad=('mossDark', 'mossLight', .5, .72), flat=.1)
    if lod0:
        kit.frustum((0, 0, 0), .56, .5, .1, sides, 'stoneDark', yaw=ph, cap=False)   # 받침 띠
        kit.frustum((0, 0, .3), .56, .575, .06, sides, 'goldDark', yaw=ph, cap=False)  # 몸통 금 띠
        kit.rock((.38, -.36, .5), (.22, .16, .14), 'moss', .2, .5, grad=('mossDark', 'mossLight', .5, .72), flat=.1)
        kit.rock((-.42, -.2, .56), (.18, .14, .12), 'moss', .2, 1.5, flat=.1)
        kit.rock((.1, .52, .6), (.2, .14, .1), 'moss', .2, 2.2, flat=.1)
    # 흙 위의 수정 잎
    blades = 11 if lod0 else 6
    for i in range(blades):
        ang = i * math.tau / blades + rng.uniform(-.2, .2)
        ln = rng.uniform(.55, .95) if i % 2 == 0 else rng.uniform(.4, .62)
        lean = .55 + (i % 3) * .2
        base = (math.cos(ang) * .12, math.sin(ang) * .12, .66)
        tip = (base[0] + math.cos(ang) * math.sin(lean) * ln, base[1] + math.sin(ang) * math.sin(lean) * ln, .66 + math.cos(lean) * ln)
        kit.blade(base, tip, .1 if i % 2 == 0 else .08, .03, 'mint', 1, grad=('mintDeep', 'mintPale', .66, .66 + ln), bend=.04)
    # 가운데 솟은 수정
    kit.crystal((0, 0, .66), .1, .5, .34, 6 if lod0 else 4, .04, 0.4, 0, 1, ('mintDeep', 'mintWhite'))
    if lod0:
        # 늘어진 푸른 잎과 작은 수정 꽃봉오리
        for i in range(5):
            ang = i * math.tau / 5 + .5
            a = (math.cos(ang) * .6, math.sin(ang) * .6, .62)
            b = (math.cos(ang) * .72, math.sin(ang) * .72, .24)
            kit.blade(a, b, .07, .02, 'leaf', grad=('moss', 'leaf', .24, .62))
        for i in range(3):
            ang = i * 2.3 + 1.0
            kit.crystal((math.cos(ang) * .38, math.sin(ang) * .38, .66), .045, .14, .1, 4, .3, ang, 0, 1, ('mint', 'mintWhite'), sink=0)


def moss_edging(kit):
    lod0 = kit.lod == 0
    rng = kit.rng
    # 길이 2.0 m 모듈: 양 끝이 x=±1.0에서 맞물린다. 앞면은 Blender -Y.
    blocks = [(-.66, .62, .4, 'stone'), (-.02, .66, .52, 'stoneLight'), (.64, .64, .36, 'stone')] if lod0 else \
        [(-.6, .8, .42, 'stone'), (.35, 1.1, .42, 'stoneLight')]
    for cx, w, h, tone in blocks:
        kit.block((cx, 0, 0), (w, .46, h), tone, top=(w * .92, .4), yaw=rng.uniform(-.03, .03), grad=('stoneDark', tone, 0, h), jitter=.09)
        kit.block((cx, 0, h - .02), (w * .98, .48, .07), 'stoneLight', top=(w * .9, .42), jitter=.08)  # 윗면 턱
        kit.rock((cx + rng.uniform(-.05, .05), .03, h + .02), (w * .52, .24, .13), 'moss', .22, rng.uniform(0, 3),
                 grad=('mossDark', 'mossLight', h, h + .2), flat=.15)
    if lod0:
        # 블록 사이 이음새를 덮는 이끼와 앞면으로 흘러내린 이끼 덩어리, 작은 부서진 돌
        for x, z in ((-.34, .32), (.3, .38)):
            kit.rock((x, -.1, z), (.14, .1, .16), 'mossDark', .2, x * 5, grad=('mossDark', 'moss', z - .1, z + .2), flat=.2)
        kit.rock((-.2, -.34, 0), (.1, .08, .07), 'stoneLight', .22, 1, flat=.3)
        kit.rock((.98, -.12, 0), (.1, .08, .07), 'stone', .22, 2, flat=.3)
    for i in range(5 if lod0 else 2):
        x = -.85 + i * .42 + rng.uniform(-.06, .06)
        kit.blade((x, -.2, .06), (x + rng.uniform(-.08, .08), -.3, .36 + rng.uniform(0, .1)), .06, .02, 'mossLight', grad=('moss', 'mossLight', .06, .46))
    # 작은 민트 꽃눈
    for x, z in ((-.2, .56), (.55, .46), (-.7, .46)) if lod0 else ((.2, .52),):
        kit.crystal((x, .02, z), .045, .1, .1, 4, .15, 1.0, 0, 1, ('mint', 'mintWhite'), sink=0)


def hanging_lantern(kit):
    lod0 = kit.lod == 0
    n = 6 if lod0 else 4
    # 돌 밑동 + 가는 철제 기둥 + 위에서 휘어 나온 걸이
    kit.frustum((0, 0, 0), .24, .15, .3, n, 'stone', grad=('stoneDark', 'stoneLight', 0, .3))
    kit.frustum((0, 0, .3), .18, .18, .06, n, 'gold', cap=True)
    kit.rod((0, 0, .34), (0, 0, 2.2), .05, 'iron', 5 if lod0 else 4, .035, grad=('iron', 'goldDark', .3, 2.2))
    steps = 5 if lod0 else 3
    arc = []
    hook = .19
    for i in range(steps):  # 양치기 지팡이형 걸이: 기둥 끝에서 위로 휘어 +x로 넘어가며 끝이 아래를 향한다
        phi = i / (steps - 1) * math.pi * .92
        arc.append((hook - math.cos(phi) * hook, 0, 2.2 + math.sin(phi) * hook))
    for a, b in zip(arc[:-1], arc[1:]):
        kit.rod(a, b, .032, 'goldDark', 4)
    end = arc[-1]
    if lod0:
        for z in (.9, 1.5):  # 기둥 금 고리
            kit.frustum((0, 0, z), .06, .06, .05, 6, 'gold', cap=False)
    top = end[2] - .02
    kit.rod((end[0], 0, top), (end[0], 0, top - .22), .018, 'gold', 4)
    # 등: 윗갓 - 유리 몸체(발광) - 금 프레임 - 아랫갓
    lx, lz = end[0], top - .22
    kit.pyramid((lx, 0, lz - .12), .2, .2, n, 'gold', grad=('goldDark', 'gold', lz - .12, lz + .08), yaw=math.pi / 6)
    kit.frustum((lx, 0, lz - .56), .13, .2, .44, n, 'glassPane', mat=1, grad=('warm', 'mintPale', lz - .56, lz - .12), yaw=math.pi / 6, cap=False)
    if lod0:
        for i in range(n):
            ang = math.pi / 6 + math.tau * i / n
            a = (lx + math.cos(ang) * .135, math.sin(ang) * .135, lz - .56)
            b = (lx + math.cos(ang) * .205, math.sin(ang) * .205, lz - .12)
            kit.rod(a, b, .014, 'gold', 4)
        kit.crystal((lx, 0, lz + .06), .05, .0, .2, 4, 0, 0, 0, 1, ('mintDeep', 'mintWhite'), sink=0)  # 윗갓 위 수정 꼭지
    kit.frustum((lx, 0, lz - .62), .09, .15, .06, n, 'gold', yaw=math.pi / 6)
    kit.pyramid((lx, 0, lz - .62), .09, -.14, n, 'goldDark', yaw=math.pi / 6)
    kit.crystal((lx, 0, lz - .46), .06, .12, .1, 4 if lod0 else 3, 0, 0, 0, 1, ('mintPale', 'mintWhite'), sink=0)   # 내부 핵
    if lod0:  # 밑동 이끼
        kit.blade((.14, -.14, .1), (.3, -.22, .34), .06, .02, 'mossLight', grad=('moss', 'mossLight', .1, .34))
        kit.blade((-.13, -.13, .1), (-.26, -.2, .3), .05, .02, 'moss')
        kit.rock((.06, -.2, 0), (.1, .08, .08), 'moss', .2, 1, flat=.2)


PROPS = [
    ('crystal-cluster-s', lambda k: crystal_cluster(k, False), '작은 민트 수정 군집', 'crystal'),
    ('crystal-cluster-l', lambda k: crystal_cluster(k, True), '큰 민트 수정 군집', 'crystal'),
    ('trellis-arch', broken_arch, '깨진 유리 격자 아치', 'architecture'),
    ('planter-crystal', planter, '수정 잎 화분', 'planting'),
    ('moss-edging', moss_edging, '이끼 돌 테두리 모듈', 'edging'),
    ('hanging-lantern', hanging_lantern, '걸이 유리 등', 'light'),
]


def count_tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def inspect_export(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    assert (magic, version, length) == (0x46546C67, 2, len(data))
    json_length, json_type = struct.unpack_from('<II', data, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(data[20:20 + json_length])
    primitives = [p for mesh in doc['meshes'] for p in mesh['primitives']]
    assert len(doc['meshes']) == 1 and len(primitives) <= 2
    assert not any(doc.get(key) for key in ('images', 'textures', 'animations', 'skins', 'cameras'))
    assert all(p.get('mode', 4) == 4 and 'COLOR_0' in p['attributes'] for p in primitives), 'COLOR_0 필요'
    names = [m.get('name') for m in doc['materials']]
    position_min, position_max = [999] * 3, [-999] * 3
    for p in primitives:
        acc = doc['accessors'][p['attributes']['POSITION']]
        position_min = [min(a, b) for a, b in zip(position_min, acc['min'])]
        position_max = [max(a, b) for a, b in zip(position_max, acc['max'])]
    triangles = sum(doc['accessors'][p['indices']]['count'] // 3 for p in primitives)
    vertices = sum(doc['accessors'][p['attributes']['POSITION']]['count'] for p in primitives)
    return {'triangles': triangles, 'vertices': vertices, 'draws': len(primitives), 'materials': names,
            'boundsGltf': {'min': position_min, 'max': position_max}, 'nodes': [n.get('name') for n in doc['nodes']]}


# ---------- 제작과 내보내기 ----------
objects = {}
for key, build, label, category in PROPS:
    for lod in (0, 1):
        kit = Kit(key, lod)
        build(kit)
        name = 'gg_' + key.replace('-', '_') + ('_lod1' if lod else '')
        objects[(key, lod)] = kit.finish(name)

files = []
for (key, lod), obj in objects.items():
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = OUT / (key + ('-lod1' if lod else '') + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_normals=True, export_texcoords=False, export_animations=False, export_extras=True,
                              export_materials='EXPORT', export_vertex_color='ACTIVE', export_all_vertex_colors=True)
    files.append(path)

# 무손실 meshopt 전달 압축(기존 던전 포지 키트와 같은 도구).
node = subprocess.run(['node', '--version'], capture_output=True, text=True)
if node.returncode == 0:
    subprocess.run(['node', str(ROOT / 'tools/art/compress-dungeon-forge.mjs'), *map(str, files)], check=True, cwd=ROOT)
else:
    print('경고: node가 없어 meshopt 압축을 건너뜀', file=sys.stderr)

assets = []
labels = {key: (label, category) for key, _, label, category in PROPS}
for (key, lod), obj in objects.items():
    path = OUT / (key + ('-lod1' if lod else '') + '.glb')
    info = inspect_export(path)
    tris_blender = count_tris(obj)
    assert info['triangles'] == tris_blender, (key, info['triangles'], tris_blender)
    assert info['triangles'] < TRI_BUDGET, (key, info['triangles'])
    assets.append({'id': key, 'lod': lod, 'file': path.name, 'url': '/models/glass-garden-kit-v1/' + path.name,
                   'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                   'triangles': info['triangles'], 'vertices': info['vertices'], 'draws': info['draws'],
                   'materials': info['materials'], 'boundsGltf': info['boundsGltf'],
                   'meshoptCompressed': node.returncode == 0, 'vertexColors': True, 'textures': 0,
                   'labelKo': labels[key][0], 'category': labels[key][1]})
for key, _, _, _ in PROPS:
    print('TRIS', key, [a['triangles'] for a in assets if a['id'] == key])
    lod0 = next(a for a in assets if a['id'] == key and a['lod'] == 0)
    lod1 = next(a for a in assets if a['id'] == key and a['lod'] == 1)
    ratio = lod1['triangles'] / lod0['triangles']
    lod1['lodRatio'] = round(ratio, 3)
    if os.environ.get("GG_TUNE") != "1": assert LOD1_RATIO[0] <= ratio <= LOD1_RATIO[1], (key, ratio)

catalog = {
    'version': VERSION, 'schema': 1, 'blender': bpy.app.version_string,
    'generator': 'tools/art/build-glass-garden-kit-v1.py',
    'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'seed': SEED, 'rights': 'Original authored geometry and palette; no external assets or generation providers',
    'license': 'Project-owned original assets',
    'runtime': {'units': 'metres', 'up': '+Y', 'forward': '+Z', 'pivot': 'ground-centred', 'static': True,
                'materialRoles': {'gg_matte': 'lit vertex-colour surface', 'gg_glow': 'emissive x vertex colour, double sided'}},
    'policy': {'maxTrianglesPerAsset': TRI_BUDGET, 'lod1Ratio': list(LOD1_RATIO), 'maxDrawsPerAsset': 2,
               'textures': False, 'transparentSurfaces': False, 'lights': False, 'skins': False, 'animations': False},
    'reference': ['public/img/expansion/glass_garden.webp',
                  'docs/assets/citadel-hub-v1/reference-source/glass-garden-trellis-reference.png'],
    'assets': assets,
    'evidence': {'sourceBlend': 'art/glass-garden-kit-v1/glass-garden-kit-v1.blend',
                 'preview': 'art/glass-garden-kit-v1/glass-garden-kit-v1-preview.png',
                 'turntable': 'art/glass-garden-kit-v1/glass-garden-kit-v1-turntable.png',
                 'runtimeVisualReview': 'Separate game camera verification required'},
}
(OUT / 'manifest.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')

# ---------- 미리보기 렌더(편집 원본에만 남는 스튜디오) ----------
def linear_srgb(hex_value):
    return linear_hex(hex_value)


scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = int(os.environ.get('GG_SAMPLES', '24'))
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.render.image_settings.file_format = 'PNG'
scene.render.dither_intensity = 0  # 디더 잡음이 PNG 크기를 키운다
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
world = bpy.data.worlds.new('GG preview world')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*linear_hex('2A4A48'), 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
scene.world = world
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -.01))
floor = bpy.context.object
floor.name = 'PREVIEW_ONLY_ground'
ground = bpy.data.materials.new('PREVIEW_ONLY_garden slate')
ground.use_nodes = True
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*linear_hex('5E7A72'), 1)
ground.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1
floor.data.materials.append(ground)
for name, p, energy, size in (('Key', (-6, -9, 11), 2400, 7), ('Fill', (9, -4, 6), 900, 8), ('Rim', (2, 9, 8), 1500, 6)):
    bpy.ops.object.light_add(type='AREA', location=p)
    lamp = bpy.context.object
    lamp.name = 'PREVIEW_ONLY_' + name
    lamp.data.energy = energy
    lamp.data.size = size
    lamp.rotation_euler = (Vector((0, 0, 1)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()

row0 = [objects[(key, 0)] for key, *_ in PROPS]
row1 = [objects[(key, 1)] for key, *_ in PROPS]
xs = [-6.4, -4.0, .3, 4.1, 6.4, 8.4]
for obj0, obj1, x in zip(row0, row1, xs):
    obj0.location = (x, 0, 0)
    obj1.location = (x, -4.6, 0)
bpy.ops.object.camera_add(location=(1.0, -27, 10.5))
camera = bpy.context.object
camera.name = 'PREVIEW_ONLY_camera'
camera.data.lens = 44
camera.rotation_euler = (Vector((1.0, -2.4, 1.2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
scene.render.resolution_x = 2000
scene.render.resolution_y = 900
bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'glass-garden-kit-v1.blend'))
RENDER = os.environ.get('GG_RENDER', '1') == '1'
scene.render.filepath = str(ART / 'glass-garden-kit-v1-preview.png')
if RENDER:
    bpy.ops.render.render(write_still=True)

# 소품별 4방향 턴테이블(정면·우·후·좌). 줄마다 한 소품, 칸마다 90도씩 돌린다.
camera.data.type = 'ORTHO'
for obj in row1 + row0:
    obj.hide_render = True
CELL = 340
scene.render.resolution_x = CELL
scene.render.resolution_y = CELL
TURN = Path(tempfile.mkdtemp(prefix='gg-turn-'))
rows = []
for (key, *_), obj in zip(PROPS, row0):
    obj.hide_render = False
    obj.location = (0, 0, 0)
    dims = obj.dimensions
    size = max(dims.x, dims.y, dims.z)
    camera.data.ortho_scale = size * 1.35
    cells = []
    for yaw in (0, 90, 180, 270):
        obj.rotation_euler = (0, 0, math.radians(yaw))
        elev, dist = math.radians(30), 30
        camera.location = (0, -math.cos(elev) * dist, dims.z * .5 + math.sin(elev) * dist)
        camera.rotation_euler = (Vector((0, 0, dims.z * .46)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        path = TURN / f'{key}-{yaw:03d}.png'
        scene.render.filepath = str(path)
        if RENDER:
            bpy.ops.render.render(write_still=True)
        cells.append(path)
    row_path = TURN / f'row-{key}.png'
    if RENDER:
        subprocess.run(['convert', *map(str, cells), '+append', str(row_path)], check=True)
    rows.append(row_path)
    obj.hide_render = True
turn_paths = rows
# 네 장을 세로로 이어 붙여 한 장의 턴테이블 시트로 둔다(ImageMagick이 없으면 낱장을 남긴다).
sheet = ART / 'glass-garden-kit-v1-turntable.png'
if RENDER and subprocess.run(['convert', *map(str, turn_paths), '-append', '-quality', '95', str(sheet)]).returncode != 0:
    print('경고: convert가 없어 턴테이블 낱장을 합치지 못함', file=sys.stderr)
(ART / 'glass-garden-kit-v1.blend1').unlink(missing_ok=True)
print(json.dumps({'version': VERSION, 'assets': len(assets), 'triangles': {a['file']: a['triangles'] for a in assets},
                  'bytes': sum(a['bytes'] for a in assets), 'turn': [str(p) for p in turn_paths]}, ensure_ascii=False))
