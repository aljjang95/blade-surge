# Tripo 자동 리그(Humanoid+Mixamo 프리셋) 가중치에서 몸 밖 장식(머리카락·땋은 머리·망토)에 섞인 팔·어깨 가중치를 걷어 낸다.
# 2026-10-23 궁수 v5: 왼쪽 머리카락·땋은 머리에 Head .45 / LeftShoulder .33 / LeftArm .17, 망토에 양팔 .6 이 섞여 있어
# 팔을 내리거나 활을 당기면 땋은 머리가 어깨로 끌려가고 망토가 몸 안으로 말려 들어갔다. 메시 모양·뼈는 건드리지 않는다.
# 규칙(정점별, 몸 장식 색은 기본색 텍스처의 초록(머리카락·망토)으로 가른다):
#   1) 머리 영역(Head 가중치 ≥ 0.2) 또는 몸 앞쪽 초록(땋은 머리·목깃): 팔·어깨 가중치를 뺀다. 목 관절보다 아래 정점은
#      높이에 따라 Head → Spine2 로 넘긴다(가슴 중간 높이부터 Spine2 100%). 땋은 머리가 고개·가슴을 따라가고 팔은 따라가지 않는다.
#   2) 몸 뒤쪽 초록(망토): 팔·어깨 가중치를 뺀다.
#   3) 그 밖: 팔 뼈 선분보다 몸통 축(Hips→HeadTop)에 더 가깝고, 팔 가중치가 0.5 미만이거나 몸 뒤쪽이면 팔 가중치를 뺀다.
#   4) 남은 가중치를 다시 정규화한다. 하나도 안 남으면 가장 가까운 몸통 뼈 1.
#   blender -b -P tools/asset-library/blender_clean_weights.py -- --input <rigged.glb> --output <cleaned.glb> --report <r.json>
#     [--decor-hue 60-160[,340-20…]] [--decor-sat 0.25] [--decor-val 0.12]
#   장식 색 범위: 기본은 궁수 1단계의 초록(60–160°). 궁수 2단계 붉은 후드는 --decor-hue 60-160,340-25 처럼 여러 구간(도, 360 을 넘는
#   구간은 340-25 처럼 감아 쓴다)을 준다. 범위에 드는 정점이 몸 앞이면 땋은 머리 규칙, 몸 뒤면 망토 규칙을 받는다.
import bpy, colorsys, json, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import intersect_point_line

def args():
    a = sys.argv[sys.argv.index('--') + 1:]; out = {}; i = 0
    while i < len(a):
        if a[i].startswith('--') and i + 1 < len(a): out[a[i][2:]] = a[i + 1]; i += 2
        else: i += 1
    return out

def norm(n): return n.replace('mixamorig:', '').replace('mixamorig', '')
ARM = ('Arm', 'ForeArm', 'Hand')
def is_arm(n): return any(norm(n).startswith(s + k) for s in ('Left', 'Right') for k in ARM)
def is_shoulder(n): return norm(n) in ('LeftShoulder', 'RightShoulder')
def is_head(n): return norm(n) in ('Head', 'HeadTop_End', 'LeftEye', 'RightEye')
TORSO = ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck')

def seg_dist(p, a, b):
    t = intersect_point_line(p, a, b)[1]; t = max(0.0, min(1.0, t))
    return (p - a.lerp(b, t)).length

def hue_ranges(text):
    out = []
    for part in text.split(','):
        lo, hi = (float(x) for x in part.strip().split('-'))
        if not (0 <= lo <= 360 and 0 <= hi <= 360): raise ValueError('--decor-hue must be degrees 0-360: ' + part)
        out.append((lo / 360, hi / 360))
    return out

def in_hue(h, ranges): return any((lo <= h <= hi) if lo <= hi else (h >= lo or h <= hi) for lo, hi in ranges)

def vertex_decor(mesh, ranges, sat, val):
    # 정점마다 기본색 텍스처를 UV 로 읽어 장식 색(기본: 색상 60–160°, 채도 0.25 이상, 명도 0.12 이상)인지 돌려준다.
    me = mesh.data; uv = me.uv_layers.active.data
    img = None
    for mat in me.materials:
        for node in (mat.node_tree.nodes if mat and mat.use_nodes else []):
            if node.type == 'TEX_IMAGE' and node.image and any(l.to_socket.name == 'Base Color' for l in node.outputs['Color'].links): img = node.image
    out = [False] * len(me.vertices)
    if img is None: return out
    w, h = img.size; px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    acc = [[0.0, 0.0, 0.0, 0] for _ in me.vertices]
    for loop in me.loops:
        u, t = uv[loop.index].uv; x = min(w - 1, max(0, int(u % 1.0 * w))); y = min(h - 1, max(0, int(t % 1.0 * h)))
        c = px[y, x]; a = acc[loop.vertex_index]; a[0] += c[0]; a[1] += c[1]; a[2] += c[2]; a[3] += 1
    for i, a in enumerate(acc):
        if not a[3]: continue
        hh, ss, vv = colorsys.rgb_to_hsv(a[0] / a[3], a[1] / a[3], a[2] / a[3])
        out[i] = bool(in_hue(hh, ranges) and ss >= sat and vv >= val)
    return out

def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a['input'])
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    mesh = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
    arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
    J = {norm(b.name): arm.matrix_world @ b.head_local for b in arm.data.bones}
    up = (J['Head'] - J['Hips']).normalized()
    # 몸 앞쪽: 어깨선과 위 방향의 외적. 발끝이 앞이므로 부호를 발끝으로 맞춘다.
    side = (J['LeftArm'] - J['RightArm']).normalized(); front = side.cross(up).normalized()
    if (J['LeftToeBase'] - J['LeftFoot']).dot(front) < 0: front = -front
    body = [J[n] for n in ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End')]
    arms = []
    for s in ('Left', 'Right'):
        # 어깨 관절에서 위팔 25% 지점부터를 팔로 본다(어깨 바로 옆 머리카락이 팔로 잡히지 않게).
        a0 = J[s + 'Arm'].lerp(J[s + 'ForeArm'], 0.25)
        arms += [(a0, J[s + 'ForeArm']), (J[s + 'ForeArm'], J[s + 'Hand']), (J[s + 'Hand'], J[s + 'HandMiddle4'] if s + 'HandMiddle4' in J else J[s + 'Hand'])]
    zn = J['Neck'].dot(up); zc = (J['Spine1'].dot(up) + J['Spine2'].dot(up)) / 2
    gi = {g.name: g.index for g in mesh.vertex_groups}
    names = {g.index: g.name for g in mesh.vertex_groups}
    def group(n):
        full = next((k for k in gi if norm(k) == n), None)
        if full is None: full = mesh.vertex_groups.new(name='mixamorig:' + n).name; gi[full] = mesh.vertex_groups[full].index; names[gi[full]] = full
        return mesh.vertex_groups[full]
    spine2 = group('Spine2'); stats = {'headRegion': 0, 'hanging': 0, 'braid': 0, 'cape': 0, 'armStripped': 0, 'empty': 0, 'decorOnArm': 0}
    decor = dict(hue=a.get('decor-hue', '60-160'), sat=float(a.get('decor-sat', 0.25)), val=float(a.get('decor-val', 0.12)))
    green = vertex_decor(mesh, hue_ranges(decor['hue']), decor['sat'], decor['val'])
    mw = mesh.matrix_world
    for v in mesh.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups if g.weight > 0}
        if not w: continue
        p = mw @ v.co
        head_w = sum(x for n, x in w.items() if is_head(n))
        arm_w = sum(x for n, x in w.items() if is_arm(n))
        new = dict(w)
        front_side = (p - J['Spine1']).dot(front)
        d_body = min(seg_dist(p, body[i], body[i + 1]) for i in range(len(body) - 1)) if arm_w > 0 else 0.0
        d_arm = min(seg_dist(p, s0, s1) for s0, s1 in arms) if arm_w > 0 else 1e9
        # 장식 색이 넓은 경우(붉은 갑옷 전체 등) 팔 소매·팔 갑옷을 장식으로 오판하지 않게: 팔 선분에 더 가깝고 팔 가중치가 주인 정점은 장식 규칙에서 뺀다.
        on_arm = arm_w >= 0.5 and d_arm < d_body
        if green[v.index] and on_arm: stats['decorOnArm'] += 1
        braid = green[v.index] and not on_arm and front_side > 0 and zc - 1.6 * (zn - zc) < p.dot(up) < zn and head_w < 0.2
        if head_w >= 0.2 or braid:
            new = {n: x for n, x in w.items() if not is_arm(n) and not is_shoulder(n)}
            stats['headRegion'] += 1
            z = p.dot(up)
            if z < zn:
                k = min(1.0, (zn - z) / max(1e-6, zn - zc))
                tot = sum(new.values()) or 1.0
                new = {n: x / tot * (1 - k) for n, x in new.items()}
                new[spine2.name] = new.get(spine2.name, 0) + k
                stats['hanging'] += 1
            if braid: stats['braid'] += 1
        elif green[v.index] and not on_arm and front_side < -0.02:
            new = {n: x for n, x in w.items() if not is_arm(n) and not is_shoulder(n)}
            stats['cape'] += 1
        elif arm_w > 0:
            behind = (p - J['Spine1']).dot(front) < -0.02
            if d_body < d_arm and (arm_w < 0.5 or behind):
                new = {n: x for n, x in w.items() if not is_arm(n)}
                stats['armStripped'] += 1
        tot = sum(new.values())
        if tot <= 1e-6:
            near = min(TORSO, key=lambda n: (p - J[n]).length); new = {group(near).name: 1.0}; tot = 1.0; stats['empty'] += 1
        for n in w: mesh.vertex_groups[n].remove([v.index])
        for n, x in new.items():
            if x / tot > 1e-4: mesh.vertex_groups[n].add([v.index], x / tot, 'REPLACE')
    # 전달 크기: blender_swap_body.py 와 같이 텍스처를 1024px·WEBP 82 로 줄인다.
    for image in bpy.data.images:
        w, h = image.size
        if max(w, h) > 1024:
            f = 1024 / max(w, h); image.scale(max(1, round(w * f)), max(1, round(h * f))); image.pack()
    bpy.ops.export_scene.gltf(filepath=a['output'], export_format='GLB', export_animations=False, export_cameras=False, export_lights=False,
        export_image_format='WEBP', export_image_quality=82, export_yup=True)
    Path(a['report']).write_text(json.dumps({'ok': True, **stats, 'decor': decor, 'decorVertices': int(sum(green)), 'vertices': len(mesh.data.vertices)}, ensure_ascii=False), encoding='utf-8')

try: main()
except Exception as e:
    Path(args()['report']).write_text(json.dumps({'ok': False, 'error': repr(e)}), encoding='utf-8'); raise
