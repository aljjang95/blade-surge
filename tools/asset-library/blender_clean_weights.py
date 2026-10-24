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
#     [--decor-hue 60-160[,340-20…]] [--decor-sat 0.25] [--decor-val 0.12] [--smooth-cape 0] [--merge-bone neutral_bone] [--braid-hue 60-160] [--pauldron 0.5] [--head-rigid 1]
#   장식 색 범위: 기본은 궁수 1단계의 초록(60–160°). 궁수 2단계 붉은 후드는 --decor-hue 60-160,340-25 처럼 여러 구간(도, 360 을 넘는
#   구간은 340-25 처럼 감아 쓴다)을 준다. 범위에 드는 정점이 몸 앞이면 땋은 머리 규칙, 몸 뒤면 망토 규칙을 받는다.
#   --smooth-cape N: 망토 규칙을 받은 정점의 가중치를 메시 이웃 평균으로 N 번 고른다(망토 밖 이웃은 고정 기준). 2026-10-23 기사 S등급:
#   망토 밑단 이웃 정점끼리 다리·골반 가중치가 들쭉날쭉해 달리기에서 밑단이 가시처럼 찢어져 보였다. 기본 0 은 이전과 같은 출력.
#   --braid-hue 60-160 [--braid-sat 0.25] [--braid-val 0.12]: 땋은 머리 규칙(몸 앞 장식 → 가슴 아래는 Spine2 100%)을 이 색에만 준다. 2026-10-24 궁수 U 불사조:
#   망토 불꽃(주황)을 장식 범위에 넣자 골반 앞 불꽃 깃털까지 땋은 머리 규칙으로 Spine2 에 굳어, 구르기에서 0.39m 바닥을 팠다.
#   기본(없음)은 장식 범위 전체로 이전과 같은 출력.
#   --pauldron 0.5: 어깨(LeftShoulder·RightShoulder)+팔 가중치 합이 0.5 이상인 장식 정점은 땋은 머리·망토 규칙을 받지 않는다. 2026-10-24
#   궁수 U 불사조: 왼어깨 불꽃 깃털 견갑(어깨 .49·팔 .47)이 망토 규칙으로 어깨·팔을 잃고 Spine2 에 굳어 구르기에서 0.39m 바닥을 팠다.
#   기본(없음)은 이전과 같은 출력.
#   --head-rigid 1: 목 관절보다 높은 정점과, 목 관절~가슴 중간(Spine1·Spine2 중간) 높이 중 목 앞쪽·몸 축 옆으로 (목−가슴 중간)×1.2 안의
#   정점(치비 얼굴 아래쪽·턱)을 모두 Head 100% 로 묶는다. 2026-10-24 흡혈 백작: Tripo 목 관절이 눈 아래 높이라 아랫눈꺼풀·볼·턱이 목 아래였고,
#   거기에 Spine·Spine1·어깨 가중치가 섞여(Head 0~0.35) 대기 자세에서 얼굴 아래쪽이 7cm 따로 움직여 눈이 찌그러지고 한쪽 눈이 가렸다.
#   기본(없음)은 이전과 같은 출력.
#   --head-min 0.2: 머리 영역 규칙을 받는 Head 가중치 하한. 2026-10-24 야만전사 늑대인간: 어깨를 덮은 늑대 가죽(Head .1~.5·어깨 .5)이
#   머리 영역 규칙으로 어깨·팔을 잃고 Head 에 붙어, 이웃 가죽(어깨·팔 그대로)과 공격에서 0.36m 찢어졌다. 기본 0.2 는 이전과 같은 출력.
#   --merge-bone a,b: 이름의 (자식 없는) 관절을 지우고 그 가중치를 메시 이웃 평균으로 넘긴다(merge_bones). 기본은 아무것도 지우지 않는다.
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

def smooth_weights(mesh, idx, rounds):
    # 정점×관절 가중치 행렬에서 idx 정점만 이웃 평균(자기 포함)으로 rounds 번 바꾸고, 관절 4개까지 남겨 다시 정규화한다.
    me = mesh.data; V = len(me.vertices); G = len(mesh.vertex_groups)
    W = np.zeros((V, G), dtype=np.float64)
    for v in me.vertices:
        for g in v.groups: W[v.index, g.group] = g.weight
    nb = [[] for _ in range(V)]
    for e in me.edges:
        i, j = e.vertices; nb[i].append(j); nb[j].append(i)
    idx = sorted(set(idx))
    for _ in range(rounds):
        N = W.copy()
        for i in idx:
            ring = [i] + nb[i]; N[i] = W[ring].mean(axis=0)
        W = N
    for i in idx:
        row = W[i]; keep = np.argsort(row)[-4:]; out = np.zeros(G); out[keep] = row[keep]
        tot = out.sum()
        if tot <= 1e-6: continue
        out /= tot
        # 정점이 실제로 속한 관절만 지운다(속하지 않은 그룹 remove 는 Blender 판에 따라 오류).
        for g in list(me.vertices[i].groups): mesh.vertex_groups[g.group].remove([i])
        for gi in np.nonzero(out > 1e-4)[0]: mesh.vertex_groups[int(gi)].add([i], float(out[gi]), 'REPLACE')
    return len(idx)

def merge_bones(arm, mesh, bone_names):
    # Tripo 리그가 가끔 덧붙이는 이동값 없는 뿌리 관절(예: 2026-10-23 도적 U 의 neutral_bone, 오른 허벅지 정점 6개가 가중치 1)을 없앤다.
    # 그 관절에 묶인 정점은 메시 이웃(그 관절에 안 묶인 정점) 가중치 평균을 받고, 이웃이 없으면 가장 가까운 관절 1.
    # 그 관절이 그대로 남으면 움직이지 않는 뿌리에 붙은 정점이 다리를 따라가지 않아 가시처럼 늘어진다.
    out = []
    for bone_name in bone_names:
        g = mesh.vertex_groups.get(bone_name)
        if bone_name not in arm.data.bones:
            out.append({'bone': bone_name, 'found': False}); continue
        if arm.data.bones[bone_name].children: raise ValueError('--merge-bone: child joints exist under ' + bone_name)
        moved = {}; fallback = 0; S = set()
        if g is not None:
            names = {x.index: x.name for x in mesh.vertex_groups}
            S = {v.index for v in mesh.data.vertices if any(x.group == g.index and x.weight > 0 for x in v.groups)}
            nb = {}
            for e in mesh.data.edges:
                i, j = e.vertices; nb.setdefault(i, []).append(j); nb.setdefault(j, []).append(i)
            heads = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones if b.name != bone_name}
            for vi in sorted(S):
                v = mesh.data.vertices[vi]
                own = {names[x.group]: x.weight for x in v.groups if x.group != g.index and x.weight > 0}
                ring = [j for j in nb.get(vi, ()) if j not in S]
                acc = {}
                for j in ring:
                    for x in mesh.data.vertices[j].groups:
                        if x.weight > 0 and x.group != g.index: acc[names[x.group]] = acc.get(names[x.group], 0) + x.weight / len(ring)
                # 이웃 평균의 자잘한 몫(손이 허벅지 옆이라 묻은 0.004 엄지 등)은 버리고 큰 몫만 남긴다.
                acc = {n: x for n, x in acc.items() if x >= 0.05}
                if not acc:
                    p = mesh.matrix_world @ v.co; acc = {min(heads, key=lambda n: (p - heads[n]).length): 1.0}; fallback += 1
                share = next(x.weight for x in v.groups if x.group == g.index)
                new = dict(own)
                for n, x in acc.items(): new[n] = new.get(n, 0) + share * x
                tot = sum(new.values())
                for n in new:
                    if n not in mesh.vertex_groups: mesh.vertex_groups.new(name=n)
                    mesh.vertex_groups[n].add([vi], new[n] / tot, 'REPLACE')
                for n, x in acc.items(): moved[n] = moved.get(n, 0) + 1
            mesh.vertex_groups.remove(g)
        bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
        arm.data.edit_bones.remove(arm.data.edit_bones[bone_name]); bpy.ops.object.mode_set(mode='OBJECT')
        out.append({'bone': bone_name, 'found': True, 'vertices': len(S),
                    'mergedInto': moved, 'nearestFallback': fallback})
    return out

def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a['input'])
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    mesh = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
    merged = merge_bones(arm, mesh, [x for x in a.get('merge-bone', '').split(',') if x]) if a.get('merge-bone') else []
    arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
    J = {norm(b.name): arm.matrix_world @ b.head_local for b in arm.data.bones}
    up = (J['Head'] - J['Hips']).normalized()
    # 몸 앞쪽: 어깨선과 위 방향의 외적. 발끝이 앞이므로 부호를 발끝으로 맞춘다.
    side = (J['LeftArm'] - J['RightArm']).normalized(); front = side.cross(up).normalized()
    if (J['LeftToeBase'] - J['LeftFoot']).dot(front) < 0: front = -front
    # Tripo 55관절 프리셋에는 HeadTop_End 가 없다: 목→머리 방향으로 머리 길이만큼 늘려 만든다.
    if 'HeadTop_End' not in J: J['HeadTop_End'] = J['Head'] + (J['Head'] - J['Neck']).normalized() * (J['Head'] - J['Neck']).length * 1.6
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
    capeIdx = []
    spine2 = group('Spine2'); stats = {'headRegion': 0, 'hanging': 0, 'braid': 0, 'cape': 0, 'armStripped': 0, 'empty': 0, 'decorOnArm': 0}
    decor = dict(hue=a.get('decor-hue', '60-160'), sat=float(a.get('decor-sat', 0.25)), val=float(a.get('decor-val', 0.12)))
    green = vertex_decor(mesh, hue_ranges(decor['hue']), decor['sat'], decor['val'])
    # --braid-hue: 땋은 머리 규칙(앞쪽 장식 → Head/Spine2)을 받을 색을 따로 정한다(채도·명도는 --braid-sat 0.25·--braid-val 0.12).
    # 없으면 장식 범위 전체(이전과 같은 출력).
    braidMask = green
    pauldron = float(a['pauldron']) if 'pauldron' in a else None
    head_rigid = a.get('head-rigid', '0') == '1'
    if head_rigid: decor['headRigid'] = True; head_group = group('Head')
    if pauldron is not None: decor['pauldron'] = pauldron
    if 'braid-hue' in a:
        decor.update(braidHue=a['braid-hue'], braidSat=float(a.get('braid-sat', 0.25)), braidVal=float(a.get('braid-val', 0.12)))
        braidMask = vertex_decor(mesh, hue_ranges(decor['braidHue']), decor['braidSat'], decor['braidVal'])
    # --head-min X: 머리 영역 규칙(팔·어깨를 빼고 목 아래는 Spine2 로)을 받을 Head 가중치 하한(기본 0.2 = 이전과 같은 출력).
    head_min = float(a.get('head-min', 0.2))
    if 'head-min' in a: decor['headMin'] = head_min
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
        # --pauldron X: 어깨+팔 가중치 합이 X 이상인 장식(어깨 견갑 깃털 등)은 장식 규칙에서 빼고 팔·어깨를 따라가게 둔다(기본 끔).
        # --braid-hue 를 함께 주면 땋은 머리 색(머리카락)은 빼고 나머지 장식에만 적용한다(머리카락은 어깨를 따라가면 안 된다).
        if pauldron is not None and green[v.index] and not (braidMask is not green and braidMask[v.index]) and arm_w + sum(x for n, x in w.items() if is_shoulder(n)) >= pauldron: on_arm = True
        if green[v.index] and on_arm: stats['decorOnArm'] += 1
        braid = braidMask[v.index] and not on_arm and front_side > 0 and zc - 1.6 * (zn - zc) < p.dot(up) < zn and head_w < 0.2
        chin = head_rigid and zc <= p.dot(up) < zn and (p - J['Neck']).dot(front) > 0 \
            and abs((p - J['Neck']).dot(side)) < 1.2 * (zn - zc)
        if head_rigid and (p.dot(up) >= zn or chin):
            new = {head_group.name: 1.0}; stats['headRigid'] = stats.get('headRigid', 0) + 1
            if arm_w > 0.05: stats['headRigidArm'] = stats.get('headRigidArm', 0) + 1
            if chin: stats['headRigidChin'] = stats.get('headRigidChin', 0) + 1
        elif head_w >= head_min or braid:
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
            stats['cape'] += 1; capeIdx.append(v.index)
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
    rounds = int(a.get('smooth-cape', 0))
    if rounds > 0 and capeIdx:
        # 망토 테두리(금장 등 장식 색 밖) 정점도 같이 고르도록 몸 뒤쪽 이웃으로 rounds//2 고리 넓힌다. 팔 가중치가 있는 정점은 넣지 않는다.
        behind = {v.index for v in mesh.data.vertices if ((mw @ v.co) - J['Spine1']).dot(front) < -0.02
                  and not any(is_arm(names[g.group]) and g.weight > 0 for g in v.groups)}
        grown = set(capeIdx); nb = {}
        for e in mesh.data.edges:
            i, j = e.vertices; nb.setdefault(i, []).append(j); nb.setdefault(j, []).append(i)
        ring = set(capeIdx)
        for _ in range(max(1, rounds // 2)):
            ring = {j for i in ring for j in nb.get(i, ()) if j in behind and j not in grown}; grown |= ring
        stats['capeSmoothed'] = smooth_weights(mesh, sorted(grown), rounds)
    # 전달 크기: blender_swap_body.py 와 같이 텍스처를 1024px·WEBP 82 로 줄인다.
    for image in bpy.data.images:
        w, h = image.size
        if max(w, h) > 1024:
            f = 1024 / max(w, h); image.scale(max(1, round(w * f)), max(1, round(h * f))); image.pack()
    bpy.ops.export_scene.gltf(filepath=a['output'], export_format='GLB', export_animations=False, export_cameras=False, export_lights=False,
        export_image_format='WEBP', export_image_quality=82, export_yup=True)
    Path(a['report']).write_text(json.dumps({'ok': True, **stats, 'mergedBones': merged, 'decor': decor, 'decorVertices': int(sum(green)), 'vertices': len(mesh.data.vertices)}, ensure_ascii=False), encoding='utf-8')

try: main()
except Exception as e:
    Path(args()['report']).write_text(json.dumps({'ok': False, 'error': repr(e)}), encoding='utf-8'); raise
