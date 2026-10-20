"""상위 몸체 접촉 v2 초안. 정확 lower03에서 국소 팔/뒤자락 및 까마귀 발바닥을 저작한다. 실행 승인은 별도다."""
import hashlib
import heapq
import importlib.util
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, 'C:/Users/heart/.codex/skills/blender-headless/scripts/tasks')
from _common import task_args, run, file_record

LOWER_AUTHOR_SHA = '64505e29fd7040b2fe774720f63064359e9cca84445f7bc60744103784bfd003'
LOWER_OUTPUT_SHA = {
    'hero_ranger_t2': '391a51e693835244e05976c401c2372995a888199124ed4ff56f7f403dbaaafa',
    'hero_ranger_t3': '4d5e67cf27ba378ca41611ff21bf74b52114c88a86748fab1c10516765ee6e10',
    'hero_rogue_t2': '5410f6ab88abb42c452ad1314585eb417e39e413fe1aff364edc743cb749e81c',
    'hero_rogue_t3': 'c48e61c7a55a67ccb33061691d534b63ef8ea77143cb7e4acd46b5c042da34f7',
    'avatar_rogue_crow': 'd4385d9dde29808ea142cbc74efe1680e3d7503a624177d6d65ebf8ad5acbc85',
}
ARM_ASSETS = {'hero_ranger_t2', 'avatar_rogue_crow'}
COAT_ASSETS = {'hero_rogue_t2', 'hero_rogue_t3'}
COAT_PARAMS = {'posteriorStart': .30, 'posteriorWidth': .12, 'lowFromAnkle': .04, 'lowWidth': .06,
               'highFromHips': -.20, 'highWidth': .12, 'boundaryWidth': .10}
ARM_PARAMS = {'minimumMass': .5, 'lowFromHips': .10, 'lowWidth': .08, 'zInner': .12, 'zWidth': .08,
              'protectedMargin': .005, 'minimumFadeWidth': .08}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def load_module(name, path, exact_sha):
    require(sha(path) == exact_sha, '읽기 전용 helper SHA 불일치: '+str(path))
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_args(parser):
    parser.add_argument('--repo', required=True)
    parser.add_argument('--lower-dir', required=True)
    parser.add_argument('--out-dir', required=True)


def bone_world(lib, data, suffix):
    ni = next(i for i in data['skin']['joints'] if lib.canon_name(data['doc']['nodes'][i].get('name', '')) == 'mixamorig'+suffix)
    return data['world'][ni].translation.copy()


def lower_scope(original, lower):
    # 고정 SHA뿐 아니라 실제 원본 대비 허용 성분 바이트도 확인한다.
    before, after = original['doc'], json.loads(json.dumps(lower['doc']))
    pa = original['attributes']['POSITION']
    for key in ['min', 'max']:
        if key in before['accessors'][pa]: after['accessors'][pa][key] = before['accessors'][pa][key]
        else: after['accessors'][pa].pop(key, None)
    require(after == before, 'lower03 POSITION bounds 밖 JSON 변경')
    allowed = set()
    for field in ['POSITION', 'NORMAL']:
        accessor = before['accessors'][original['attributes'][field]]
        view = before['bufferViews'][accessor['bufferView']]
        start = view.get('byteOffset', 0)+accessor.get('byteOffset', 0)
        stride = view.get('byteStride', 12)
        for i in range(accessor['count']):
            allowed.update(range(start+i*stride, start+i*stride+12))
    require(len(original['binary']) == len(lower['binary']), 'lower03 BIN 길이 변경')
    require(all(a == b or i in allowed for i, (a, b) in enumerate(zip(original['binary'], lower['binary']))), 'lower03 허용 성분 밖 BIN 변경')
    for field in ['JOINTS_0', 'WEIGHTS_0']:
        require(original['rows'][field] == lower['rows'][field], 'lower03 원본 영향 변경')
    return {'inputExactSha': True, 'binOutsidePositionNormalExact': True, 'jsonOutsidePositionBoundsExact': True}


def precise_rest(data):
    # mask는 decoded glTF의 float64 REST로 계산한다. 실제 Bpy REST parity와 별도다.
    doc = data['doc']
    def multiply(a, b): return [[sum(a[r][k]*b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]
    def column(values): return [[values[c*4+r] for c in range(4)] for r in range(4)]
    parents = {child: i for i, node in enumerate(doc['nodes']) for child in node.get('children', [])}
    cache = {}
    def world(i):
        if i in cache: return cache[i]
        node = doc['nodes'][i]
        if 'matrix' in node: m = column(node['matrix'])
        else:
            x, y, z, w = node.get('rotation', [0., 0., 0., 1.]); sx, sy, sz = node.get('scale', [1., 1., 1.]); tx, ty, tz = node.get('translation', [0., 0., 0.])
            m = [[(1-2*(y*y+z*z))*sx, 2*(x*y-z*w)*sy, 2*(x*z+y*w)*sz, tx],
                 [2*(x*y+z*w)*sx, (1-2*(x*x+z*z))*sy, 2*(y*z-x*w)*sz, ty],
                 [2*(x*z-y*w)*sx, 2*(y*z+x*w)*sy, (1-2*(x*x+y*y))*sz, tz], [0., 0., 0., 1.]]
        if i in parents: m = multiply(world(parents[i]), m)
        cache[i] = m
        return m
    matrices = [multiply(world(i), column(values)) for i, values in zip(data['skin']['joints'], data['ibms64'])]
    points = []
    for p, js, ws in zip(data['rows']['POSITION'], data['rows']['JOINTS_0'], data['rows']['WEIGHTS_0']):
        points.append(tuple(sum(w*sum(matrices[j][r][k]*v for k, v in enumerate([*p, 1.])) for j, w in zip(js, ws)) for r in range(3)))
    bones = {data['names'][k].replace(':', '').replace('_', ''): tuple(world(i)[r][3] for r in range(3)) for k, i in enumerate(data['skin']['joints'])}
    return points, bones


def boundary_distances(data, permitted, width):
    points = data['rest64']
    edges = [dict() for _ in points]
    def edge(a, b, distance):
        edges[a][b] = min(edges[a].get(b, float('inf')), distance)
        edges[b][a] = min(edges[b].get(a, float('inf')), distance)
    for face in data['faces']:
        for a, b in [(face[0], face[1]), (face[1], face[2]), (face[2], face[0])]: edge(a, b, math.dist(points[a], points[b]))
    seams = {}
    for i, p in enumerate(data['rows']['POSITION']):
        key = tuple(round(v, 6) for v in p)
        if key in seams: edge(i, seams[key], 0.)
        else: seams[key] = i
    distances, queue = [float('inf')]*len(points), []
    for i in range(len(points)):
        if i not in permitted: distances[i] = 0.; heapq.heappush(queue, (0., i))
    while queue:
        distance, i = heapq.heappop(queue)
        if distance != distances[i] or distance >= width: continue
        for j, length in edges[i].items():
            candidate = distance+length
            if candidate < distances[j]: distances[j] = candidate; heapq.heappush(queue, (candidate, j))
    return distances


def garment_mask(lib, original, hips, ankle_y):
    names, rows, points = original['names'], original['rows'], original['rest64']
    hips = original['bones64']['mixamorigHips']
    ankle_y = max(original['bones64']['mixamorig'+s+'Foot'][1] for s in ['Left', 'Right'])
    allowed_names = {'mixamorigHips', 'mixamorigLeftUpLeg', 'mixamorigRightUpLeg', 'mixamorigLeftLeg', 'mixamorigRightLeg'}
    permitted, hip_slots = set(), {}
    for i, (js, ws) in enumerate(zip(rows['JOINTS_0'], rows['WEIGHTS_0'])):
        slots = [k for k, (j, w) in enumerate(zip(js, ws)) if w > 1e-8 and lib.canon_name(names[j]) == 'mixamorigHips']
        if slots and all(w <= 1e-8 or lib.canon_name(names[j]) in allowed_names for j, w in zip(js, ws)):
            permitted.add(i); hip_slots[i] = slots[0]
    distances = boundary_distances(original, permitted, .10)
    records = []
    for i in sorted(permitted):
        p = points[i]
        factors = [lib.smooth((hips[2]-p[2]-.30)/.12), lib.smooth((p[1]-ankle_y-.04)/.06),
                   1-lib.smooth((p[1]-hips[1]+.20)/.12), lib.smooth(distances[i]/.10)]
        alpha = math.prod(factors)
        if alpha <= 1e-10: continue
        records.append({'vertex': i, 'alpha': alpha, 'factors': factors, 'boundaryDistance': distances[i] if math.isfinite(distances[i]) else None,
                        'hipSlot': hip_slots[i], 'sourceRestWorld': list(p), 'region': 'rearcoat'})
    return records


def forearm_mask(lib, original, reference):
    names, rows, points = original['names'], original['rows'], original['rest64']
    allowed = {'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand', 'mixamorigLeftHandThumb1'}
    permitted, slots, nearest = set(), {}, {}
    ref_index = reference['names'].index(next(n for n in reference['names'] if lib.canon_name(n) == 'mixamorigLeftForeArm'))
    for i, (js, ws) in enumerate(zip(rows['JOINTS_0'], rows['WEIGHTS_0'])):
        slot = next((k for k, (j, w) in enumerate(zip(js, ws)) if w > 1e-8 and lib.canon_name(names[j]) == 'mixamorigLeftForeArm'), None)
        if slot is None or not all(w <= 1e-8 or lib.canon_name(names[j]) in allowed for j, w in zip(js, ws)): continue
        # 각 순수 좌측 전완 후보만 reference와 비교한다. 전신 가중치를 이식하지 않는다.
        distance, rid = min((math.dist(points[i], rp), j) for j, rp in enumerate(reference['rest64']))
        ref_mass = sum(w for j, w in zip(reference['rows']['JOINTS_0'][rid], reference['rows']['WEIGHTS_0'][rid]) if j == ref_index)
        if distance >= .06 or ref_mass < .95: continue
        permitted.add(i); slots[i] = slot
        nearest[i] = {'referenceVertex': rid, 'referenceDistance': distance, 'referenceForeArmMass': ref_mass}
    # 거리/영향 금지 경계도 4cm surface fade로 보호한다.
    distances = boundary_distances(original, permitted, .04)
    elbow, wrist = [original['bones64']['mixamorigLeft'+name] for name in ['ForeArm', 'Hand']]
    segment = [b-a for a, b in zip(elbow, wrist)]; denominator = sum(v*v for v in segment)
    records = []
    for i in sorted(permitted):
        p = points[i]
        t = max(0., min(1., sum((v-a)*s for v, a, s in zip(p, elbow, segment))/denominator))
        radial = math.dist(p, [a+t*s for a, s in zip(elbow, segment)])
        ref = nearest[i]
        factors = [lib.smooth((p[0]-elbow[0]-.02)/.04), 1-lib.smooth((p[0]-wrist[0]+.10)/.06),
                   1-lib.smooth((radial-.08)/.05), 1-lib.smooth((ref['referenceDistance']-.03)/.03), lib.smooth(distances[i]/.04)]
        alpha = .6*math.prod(factors)
        if alpha <= 1e-10: continue
        records.append({'vertex': i, 'alpha': alpha, 'factors': factors, 'boundaryDistance': distances[i] if math.isfinite(distances[i]) else None,
                        'targetSlot': slots[i], 'sourceRestWorld': list(p), 'radialDistance': radial, 'region': 'left-forearm', **ref})
    return records


def precise_anchors(lib, data, side):
    # 원위 표본의 nanometer 차이가 median 표본을 뒤바꾸지 않도록 명시적 grid/ID 순서를 쓴다.
    import statistics
    points, js_rows, ws_rows, names = data['rest64'], data['rows']['JOINTS_0'], data['rows']['WEIGHTS_0'], data['names']
    sign = 1 if side == 'Left' else -1
    def mass(i, group):
        return sum(w for j, w in zip(js_rows[i], ws_rows[i]) if lib.arm_suffix(names[j], side) == group or (group == 'Hand' and lib.arm_suffix(names[j], side).startswith('Hand')))
    result = {}
    for label, ga, gb in [('elbow', 'Arm', 'ForeArm'), ('wrist', 'ForeArm', 'Hand')]:
        ids = [i for i in range(len(points)) if mass(i, ga) >= .15 and mass(i, gb) >= .15]
        require(len(ids) >= 8, '인접 arm anchor 표본 부족')
        products = [mass(i, ga)*mass(i, gb) for i in ids]
        center = [sum(points[i][k]*w for i, w in zip(ids, products))/sum(products) for k in range(3)]
        result[label] = {'point': center, 'vertices': ids, 'products': products, 'rule': 'adjacent group masses >=.15; float64 center weighted by wA*wB'}
    for finger in lib.FINGERS:
        ids = [i for i in range(len(points)) if sum(w for j, w in zip(js_rows[i], ws_rows[i]) if lib.arm_suffix(names[j], side).startswith('Hand'+finger)) >= .5]
        require(len(ids) >= 3, '손가락 anchor 표본 부족')
        ordered = sorted(ids, key=lambda i: (round(sign*points[i][0]*1e7), i))
        distal = ordered[int(len(ordered)*.95):]
        maximum = max(ids, key=lambda i: (sign*points[i][0], i))
        result[finger] = {'point': [points[maximum][0], statistics.median(points[i][1] for i in distal), statistics.median(points[i][2] for i in distal)],
                          'vertices': distal, 'maximumVertex': maximum, 'rule': 'finger mass>=.5; max unquantized signedX; top5% order=(round(signedWorldX*1e7),vertexId)'}
    return result


def arm_profile(lib, data, reference, hips):
    curves, records = {}, {}
    ref_hips = bone_world(lib, reference, 'Hips')
    for side, sign in [('Left', 1), ('Right', -1)]:
        source = precise_anchors(lib, data, side)
        target = precise_anchors(lib, reference, side)
        shoulder = bone_world(lib, data, side+'Arm')
        hand = bone_world(lib, data, side+'Hand')
        start = sign*(shoulder.x-hips.x)
        common_x = [start]+[sign*(source[k]['point'][0]-hips.x) for k in ['elbow', 'wrist']]
        common_y = [start]+[sign*(target[k]['point'][0]-ref_hips.x) for k in ['elbow', 'wrist']]
        base_x = common_x+[sign*(source['Middle']['point'][0]-hips.x)]
        base_y = common_y+[sign*(target['Middle']['point'][0]-ref_hips.x)]
        shared = lib.pchip_slopes(base_x, base_y)
        shared[0] = 1.
        transverse = {}
        for axis in [1, 2]:
            vals = [0.]+[target[k]['point'][axis]-source[k]['point'][axis] for k in ['elbow', 'wrist', 'Middle']]
            slopes = lib.pchip_slopes(base_x, vals)
            slopes[0] = 0.
            transverse[axis] = (vals, slopes)
        protected_x = [start]
        for i, p in enumerate(data['rest']):
            js, ws = data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]
            if p.y > hips.y+.10 and abs(p.z-hand.z) < .20 and lib.arm_mass(data['names'], js, ws, side) > .5 and lib.protected_mass(data['names'], js, ws) > 1e-8:
                protected_x.append(sign*(p.x-hips.x))
        protected_stop = max(protected_x)+.005
        require(common_x[2]-protected_stop >= .08, '보호된 팔 경계에 C1 fade 길이가 부족합니다: '+side)
        curves[side] = {}
        for finger in lib.FINGERS:
            xs = common_x+[sign*(source[finger]['point'][0]-hips.x)]
            ys = common_y+[sign*(target[finger]['point'][0]-ref_hips.x)]
            require(all(b-a > 1e-5 for a, b in zip(xs, xs[1:])), '손가락 anchor 순서 오류')
            secant = (ys[-1]-ys[-2])/(xs[-1]-xs[-2])
            slopes = shared[:3]+[secant]
            require(secant > .05 and 0 < slopes[2] < 3*secant, '손가락 단조성 경계 오류')
            channels = [(xs, ys, slopes)]
            for axis in [1, 2]:
                values, derivatives = transverse[axis]
                channels.append((xs, values[:3]+[target[finger]['point'][axis]-source[finger]['point'][axis]], derivatives[:3]+[0.]))
            for j in range(301):
                x = start+(xs[-1]-start)*j/300
                require((lib.hermite(*channels[0], x+1e-5)-lib.hermite(*channels[0], x-1e-5))/2e-5 > .05, '팔 x 곡선 단조성 실패')
            curves[side][finger] = channels
        records[side] = {'source': source, 'target': target, 'curves': curves[side], 'shoulderStart': start,
                         'protectedFadeStart': protected_stop, 'protectedFadeEnd': common_x[2], 'handZ': hand.z,
                         'sourceHipsX': hips.x, 'referenceHipsX': ref_hips.x}
    def deform(i):
        before = data['rest'][i]
        js, ws = data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]
        if lib.protected_mass(data['names'], js, ws) > 1e-8: return before.copy(), None
        side = 'Left' if before.x >= hips.x else 'Right'
        sign = 1 if side == 'Left' else -1
        mass = lib.arm_mass(data['names'], js, ws, side)
        r = records[side]
        factors = [lib.smooth((mass-.5)/.5), lib.smooth((sign*(before.x-hips.x)-r['protectedFadeStart'])/(r['protectedFadeEnd']-r['protectedFadeStart'])),
                   lib.smooth((before.y-hips.y-.10)/.08), 1-lib.smooth((abs(before.z-r['handZ'])-.12)/.08)]
        alpha = math.prod(factors)
        if alpha <= 1e-10: return before.copy(), None
        finger_weights = {finger: sum(w for j, w in zip(js, ws) if lib.arm_suffix(data['names'][j], side).startswith('Hand'+finger)) for finger in lib.FINGERS}
        total = sum(finger_weights.values())
        require(total <= 1.000001, '손가락 가중치 합 초과')
        finger_weights['Middle'] += max(0., 1-total)
        mapped = Vector()
        x = sign*(before.x-hips.x)
        for finger, weight in finger_weights.items():
            cx, cy, cz = curves[side][finger]
            mapped += Vector((hips.x+sign*lib.hermite(*cx, x), before.y+lib.hermite(*cy, x), before.z+lib.hermite(*cz, x)))*weight
        return before.lerp(mapped, alpha), {'vertex': i, 'side': side, 'alpha': alpha, 'factors': factors, 'armMass': mass}
    return deform, records


def author_asset(low, lib, repo, lower_dir, out, contract):
    asset, hero, source_sha, count, _ = contract
    source_path = repo/'asset-library/normalized'/(asset+'.glb')
    lower_path = lower_dir/(asset+'.glb')
    ref_id, ref_sha = low.REFERENCES[hero]
    ref_path = repo/'asset-library/normalized'/(ref_id+'.glb')
    original = low.primitive_data(lib, source_path, source_sha, count)
    data = low.primitive_data(lib, lower_path, LOWER_OUTPUT_SHA[asset], count)
    reference = low.primitive_data(lib, ref_path, ref_sha)
    for item in [original, data, reference]:
        item['ibms64'] = lib.read_accessor(item['doc'], item['binary'], item['skin']['inverseBindMatrices'])
        item['rest64'], item['bones64'] = precise_rest(item)
    input_scope = lower_scope(original, data)
    protected = {i for i in range(count) if low.protected_vertex(lib, data['names'], data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i])}
    for i in protected:
        require(original['rows']['POSITION'][i] == data['rows']['POSITION'][i] and original['rows']['NORMAL'][i] == data['rows']['NORMAL'][i], 'lower03 보호 영역 변경')
    actual, arm, import_info = low.import_body(lib, lower_path, data)
    expected = [lib.to_blender(p) for p in data['rest']]
    initial_parity = low.parity(lib, expected, low.evaluated_points(actual))
    require(len(actual.data.vertices) == count, 'importer 정점 수 변경')
    original_uv = [[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers]
    original_loops = [loop.vertex_index for loop in actual.data.loops]
    bone_rest = [(b.name, [list(r) for r in b.matrix_local]) for b in arm.data.bones]
    corner_normals = [tuple(n.vector) for n in actual.data.corner_normals]
    hips = bone_world(lib, original, 'Hips')
    ankle_y = max(bone_world(lib, original, s+'Foot').y for s in ['Left', 'Right'])
    garment = garment_mask(lib, original, hips, ankle_y) if asset in COAT_ASSETS else []
    forearm = forearm_mask(lib, original, reference) if asset == 'hero_ranger_t3' else []
    if asset in COAT_ASSETS: require(garment, '승인된 뒤자락 mask가 비어 있습니다.')
    if asset == 'hero_ranger_t3': require(forearm, '승인된 전완 mask가 비어 있습니다.')
    final_weights = [list(w) for w in data['rows']['WEIGHTS_0']]
    weight_rows = []
    for record in garment+forearm:
        i, alpha = record['vertex'], record['alpha']
        js, old = data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]
        new, removed = list(old), 0.
        for k, (joint, w) in enumerate(zip(js, old)):
            target_name = 'mixamorigHips' if record['region'] == 'rearcoat' else 'mixamorigLeftForeArm'
            if lib.canon_name(data['names'][joint]) != target_name:
                new[k] = w*(1-alpha)
                removed += w-new[k]
        new[record.get('hipSlot', record.get('targetSlot'))] += removed
        new = [f32(w) for w in new]
        require(all(0 <= w <= 1.000001 for w in new) and abs(sum(new)-sum(old)) <= 2e-7, '새 가중치 합/범위 오류')
        if new == old: continue
        final_weights[i] = new
        weight_rows.append({**record, 'old': old, 'new': new, 'jointNames': [data['names'][j] for j in js]})
    foot_profile, foot_ids = None, set()
    if asset == 'avatar_rogue_crow':
        stop = min(original['bones64']['mixamorigHips'][1], min(data['rest64'][i][1] for i in protected))
        foot_ids = {i for i, p in enumerate(data['rest64']) if i not in protected and p[1] < stop}
        soles = [i for i in foot_ids if data['rest64'][i][1] < max(original['bones64']['mixamorig'+side+'Foot'][1] for side in ['Left', 'Right'])+.02 and sum(w for j, w in zip(data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]) if lib.is_foot(data['names'][j])) >= .30]
        require(soles, 'crow03 sole 정점 없음')
        sole = min(data['rest64'][i][1] for i in soles)
        require(abs(sole-.012) <= 3e-6 and stop > sole and 1-1.5*(.018-sole)/(stop-sole) > .05, 'crow03 추가 sole 계약 오류')
        foot_profile = {'targetSole': .018, 'sourceSole': sole, 'fitStopY': stop, 'footVertices': sorted(soles), 'positionEligibleVertices': sorted(foot_ids),
                        'formula': 'deltaY=(.018-sourceSole)*(1-smoothstep((y-sourceSole)/(fitStopY-sourceSole)))'}
    arm_deform, arm_records = arm_profile(lib, data, reference, hips) if asset in ARM_ASSETS else (None, {})
    final_raw = [list(p) for p in data['rows']['POSITION']]
    final_world = [p.copy() for p in data['rest']]
    arm_mask, position_rows = [], []
    weight_ids = {r['vertex'] for r in weight_rows}
    for i in range(count):
        after, arm_row = arm_deform(i) if arm_deform else (data['rest'][i].copy(), None)
        if arm_row is not None: arm_mask.append(arm_row)
        foot_row = i in foot_ids
        if foot_row:
            before = data['rest'][i]
            after.y += (.018-foot_profile['sourceSole'])*(1-lib.smooth((data['rest64'][i][1]-foot_profile['sourceSole'])/(foot_profile['fitStopY']-foot_profile['sourceSole'])))
        if arm_row is None and not foot_row and i not in weight_ids: continue
        if i not in weight_ids and (after-data['rest'][i]).length <= 1e-10: continue
        require(i not in protected, '보호 위치/가중치 변경')
        require((after-data['rest'][i]).length <= .20, '팔 변위 .20m 초과')
        matrix = lib.weighted_matrix(data['rows']['JOINTS_0'][i], final_weights[i], data['matrices'])
        require(abs(matrix.determinant()) > 1e-10, '새 weighted REST 행렬 특이점')
        value = list((matrix.inverted() @ Vector((*after, 1)))[:3])
        value = [f32(v) for v in value]
        require((lib.skin_world(value, data['rows']['JOINTS_0'][i], final_weights[i], data['matrices'])-after).length <= 2e-6, '가중치/위치 역변환 검증 실패')
        if i in weight_ids: require((Vector(value)-Vector(data['rows']['POSITION'][i])).length <= .001, 'REST 보존 재표현 보정량 .001m 초과')
        final_world[i] = after
        if value != data['rows']['POSITION'][i]:
            final_raw[i] = value
            position_rows.append({'vertex': i, 'old': data['rows']['POSITION'][i], 'new': value, 'restWorldBefore': list(data['rest'][i]),
                                  'restWorldAfter': list(after), 'region': 'arm' if arm_row else ('crow-sole' if foot_row else 'weight-rest-preservation')})
    if asset in ARM_ASSETS: require(arm_mask, '승인된 팔 mask가 비어 있습니다.')
    changed = {r['vertex'] for r in position_rows}
    normal_eligible = {i for i, p in enumerate(data['rest']) if i not in protected and p.y > hips.y+.10 and
                       max(lib.arm_mass(data['names'], data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i], side) for side in ['Left', 'Right']) > .5} if asset in ARM_ASSETS else set()
    if foot_profile:
        foot_normal_ids = {i for i, p in enumerate(data['rest']) if i not in protected and p.y < hips.y}
        normal_eligible |= foot_normal_ids
        foot_profile['normalEligibleVertices'] = sorted(foot_normal_ids)
    normal_rows, triangle_report = lib.corrected_normals(data['rows']['POSITION'], final_raw, data['rows']['NORMAL'], data['faces'], changed, normal_eligible,
                                                        data['rows']['JOINTS_0'], data['rows']['WEIGHTS_0'], data['names']) if changed else ([], {'affectedTriangles': [], 'minimumAreaRatio': 1., 'minimumOldNewNormalDot': 1.})
    tree = KDTree(count)
    for i, p in enumerate(expected): tree.insert(p, i)
    tree.balance()
    def weight_map(sid, values):
        result = {}
        for j, w in zip(data['rows']['JOINTS_0'][sid], values):
            name = lib.canon_name(data['names'][j]); result[name] = result.get(name, 0.)+w
        return result
    mapping = []
    for vertex in actual.data.vertices:
        p = actual.matrix_world @ vertex.co
        _, nearest_id, error = tree.find(p)
        require(error <= .0001, '실제 import 정점 대응 실패')
        actual_map = {lib.canon_name(actual.vertex_groups[g.group].name): g.weight for g in vertex.groups if g.weight > 1e-8}
        neighbors = tree.find_range(p, max(1e-6, error+1e-7))
        matching = []
        for _, candidate, _ in neighbors:
            expected_map = weight_map(candidate, data['rows']['WEIGHTS_0'][candidate])
            if all(abs(actual_map.get(n, 0.)-expected_map.get(n, 0.)) <= 2e-7 for n in set(actual_map)|set(expected_map)): matching.append(candidate)
        require(matching, '원본 위치와 가중치를 모두 만족하는 대응 정점 없음')
        sid = min(matching)
        desired_map = weight_map(sid, final_weights[sid])
        for other in matching:
            require((final_world[sid]-final_world[other]).length < 2e-5, '겹친 원본 정점의 피팅 결과 불일치')
            other_map = weight_map(other, final_weights[other])
            require(all(abs(desired_map.get(n, 0.)-other_map.get(n, 0.)) <= 2e-7 for n in set(desired_map)|set(other_map)), '겹친 원본 정점의 새 영향 불일치')
        mapping.append(sid)
    groups = {lib.canon_name(g.name): g for g in actual.vertex_groups}
    inverse_object = actual.matrix_world.inverted()
    for vertex, sid in zip(actual.data.vertices, mapping):
        if sid in changed: vertex.co = inverse_object @ lib.to_blender(final_world[sid])
        if sid in weight_ids:
            desired = {}
            for joint, weight in zip(data['rows']['JOINTS_0'][sid], final_weights[sid]):
                name = lib.canon_name(data['names'][joint]); desired[name] = desired.get(name, 0.)+weight
            for name, weight in desired.items():
                require(name in groups, '원본 Blender 영향 group 누락')
                if weight > 0: groups[name].add([vertex.index], weight, 'REPLACE')
                else: groups[name].remove([vertex.index])
    attr = actual.data.attributes.new('source_vertex_id', 'INT', 'POINT')
    for i, sid in enumerate(mapping): attr.data[i].value = sid
    actual.data.update(); actual.data.normals_split_custom_set(corner_normals)
    require(original_uv == [[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers], 'Blender UV 변경')
    require(original_loops == [loop.vertex_index for loop in actual.data.loops], 'Blender topology 변경')
    require(bone_rest == [(b.name, [list(r) for r in b.matrix_local]) for b in arm.data.bones], 'Blender 본 REST 변경')
    for vertex, sid in zip(actual.data.vertices, mapping):
        desired = {}
        for j, w in zip(data['rows']['JOINTS_0'][sid], final_weights[sid]):
            name = lib.canon_name(data['names'][j]); desired[name] = desired.get(name, 0.)+w
        actual_weights = {lib.canon_name(actual.vertex_groups[g.group].name): g.weight for g in vertex.groups if g.weight > 1e-8}
        require(all(abs(actual_weights.get(n, 0.)-desired.get(n, 0.)) <= 2e-7 for n in set(actual_weights)|set(desired)), '실제 Blender 전정점 가중치 불일치')
    bpy.context.view_layer.update()
    final_parity = low.parity(lib, [lib.to_blender(p) for p in final_world], low.evaluated_points(actual))
    blend_path = out/(asset+'.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    patch = {'schema': 'blade-surge.higher-contact-patch.v2', 'asset': asset, 'ok': True,
             'source': file_record(source_path), 'lowerInput': file_record(lower_path), 'reference': file_record(ref_path), 'author': file_record(__file__),
             'lowerAuthorSha256': LOWER_AUTHOR_SHA, 'helperSha256': low.HELPER_SHA, 'inputScope': input_scope,
             'blender': bpy.app.version_string, 'blend': file_record(blend_path), 'restValidation': initial_parity, 'blendValidation': final_parity,
             'primitive': {'node': data['nodeIndex'], 'mesh': data['node']['mesh'], 'primitive': 0, 'vertexCount': count},
             'protectedVertices': sorted(protected), 'normalEligibleVertices': sorted(normal_eligible), 'importIdentity': import_info,
             'profile': {'armAssets': sorted(ARM_ASSETS), 'coatAssets': sorted(COAT_ASSETS), 'armParameters': ARM_PARAMS, 'coatParameters': COAT_PARAMS,
                         'hipsWorld': list(hips), 'ankleY': ankle_y, 'armAnchors': arm_records, 'armMask': arm_mask, 'garmentMask': garment, 'forearmMask': forearm,
                         'weightMaskCoordinates': 'decodedGLTF_float64_weightedREST', 'armAnchorCoordinates': 'decodedGLTF_float64_weightedREST',
                         'armDistalOrder': 'round(signedWorldX*1e7),vertexId; top5%; unquantized maximum signedX', 'footAdjustment': foot_profile,
                         'forearmParameters': {'maximumAlpha': .6, 'referenceDistanceInner': .03, 'referenceDistanceOuter': .06, 'minimumReferenceForeArmMass': .95, 'boundaryWidth': .04},
                         'garmentFormula': 'newLeg=oldLeg*(1-alpha); existingHips+=removedLeg; desiredLower03RestWorld unchanged'},
             'changes': {'positions': position_rows, 'normals': normal_rows, 'weights': weight_rows}, 'triangleValidation': triangle_report,
             'limitations': ['candidate only; no dense/visual pass implied', 'blend preserves imported corner normals; GLB arm normals use explicit seam rotation'],
             'preserved': ['JOINTS_0', 'protected POSITION/NORMAL/WEIGHTS', 'Foot/Toe WEIGHTS', 'UV', 'indices', 'materials', 'textures', 'nodes', 'skins', 'animations']}
    patch_path = out/(asset+'.patch.json'); low.write_new(patch_path, patch)
    report = {'ok': True, 'asset': asset, 'patch': file_record(patch_path), 'blend': file_record(blend_path),
              'positionChanges': len(position_rows), 'normalChanges': len(normal_rows), 'weightChanges': len(weight_rows),
              'restValidation': initial_parity, 'blendValidation': final_parity}
    low.write_new(out/(asset+'.author.json'), report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main(args):
    require(bpy.app.version >= (5, 2, 0), '실제 Blender 5.2 이상 필요')
    repo, lower_dir, out = Path(args.repo).resolve(), Path(args.lower_dir).resolve(), Path(args.out_dir).resolve()
    require(out != lower_dir and out != repo and repo not in out.parents, '새 저장소 밖 출력 디렉터리 필요')
    require(not out.exists() or (out.is_dir() and not any(out.iterdir())), '출력 디렉터리가 비어 있지 않습니다.')
    out.mkdir(parents=True, exist_ok=True)
    low = load_module('readonly_lower03_author', repo/'art-src/higher-bodies/author_lower_fit_v1.py', LOWER_AUTHOR_SHA)
    lib = load_module('readonly_fox_glb_helpers', repo/'art-src/avatar-fox/author_body_contact_v3.py', low.HELPER_SHA)
    results = [author_asset(low, lib, repo, lower_dir, out, contract) for contract in low.ASSETS]
    return {'ok': True, 'schema': 'blade-surge.higher-contact-author.v2', 'assets': results, 'author': file_record(__file__)}


if __name__ == '__main__':
    args = task_args(build_args)
    require(not Path(args.report).exists(), 'report 덮어쓰기 금지')
    require(Path(args.report).parent.is_dir(), 'runner report 부모 디렉터리 필요')
    run(main, args)
