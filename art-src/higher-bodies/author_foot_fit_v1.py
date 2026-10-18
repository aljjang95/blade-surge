"""실제 입력 3몸체의 발만 고정 REST affine/C1 field로 저작한다. 실행 모션/본/가중치 변경 없음."""
import hashlib
import heapq
import importlib.util
import json
import math
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

sys.path.insert(0, 'C:/Users/heart/.codex/skills/blender-headless/scripts/tasks')
from _common import task_args, run, file_record

ASSETS = {'hero_rogue_t2': 16299, 'hero_rogue_t3': 15728, 'avatar_rogue_crow': 14697}
REFERENCE = 'public/models/heroes-next/rogue-library-t1-v2.glb'
REFERENCE_SHA = '19f7e1492d947c6055cbbd8b51f3ee355c5c72f8ec4ab6296be32fb9d1e1c846'
LOWER_SHA = '64505e29fd7040b2fe774720f63064359e9cca84445f7bc60744103784bfd003'
HELPER_SHA = '78ec15dfeb5e5908237586bc77f8b3e8a8e291efcc24fd35f35627088c5eaab1'
PARAMS = {'targetSole': .006, 'anchorMass': .30, 'shapeCeiling': .06, 'soleCeiling': .02,
          'boundaryWidths': {'hero_rogue_t2': .10, 'hero_rogue_t3': .20, 'avatar_rogue_crow': .15}, 'heightFade': [.03, .22], 'maximumMove': .15,
          'quantile': 'linear-(n-1)*p', 'xzScale': 'min(1,referenceP95P05/sourceP95P05)',
          'frame': 'same-side-ankle-relative-world-axes', 'seamTolerance': .00002}
SIDES = ['Left', 'Right']


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def load_helper(name, path, expected):
    require(sha(path) == expected, '읽기 전용 helper SHA 불일치: '+str(path))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_args(parser):
    parser.add_argument('--repo', required=True)
    parser.add_argument('--profiles', required=True)
    parser.add_argument('--out-dir', required=True)


def validate_profiles(path):
    packet = json.loads(path.read_text(encoding='utf-8'))
    require(packet.get('schema') == 'blade-surge.foot-fit-inputs.v1', '발 입력 schema 불일치')
    rows = packet.get('inputs')
    require(isinstance(rows, list) and len(rows) == 3, '실제 3몸체 입력이 모두 필요합니다.')
    require({r.get('asset') for r in rows} == set(ASSETS), '누락/중복/범위 밖 몸체')
    paths = set()
    for row in rows:
        require(isinstance(row.get('path'), str) and row['path'], '실제 입력 경로 누락')
        require(isinstance(row.get('sha256'), str) and re.fullmatch('[a-f0-9]{64}', row['sha256']), '실제 입력 SHA 누락')
        source = Path(row['path']).resolve()
        require(source not in paths and source.is_file() and source.suffix.lower() == '.glb', '중복/없는 GLB 입력')
        require(sha(source) == row['sha256'], '실제 입력 SHA 불일치')
        paths.add(source)
    return rows


def multiply(a, b):
    return [[sum(a[r][k]*b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def inverse(a):
    rows = [list(row)+[float(r == c) for c in range(4)] for r, row in enumerate(a)]
    for c in range(4):
        pivot = max(range(c, 4), key=lambda r: abs(rows[r][c]))
        require(abs(rows[pivot][c]) > 1e-12, 'weighted REST 특이점')
        rows[c], rows[pivot] = rows[pivot], rows[c]
        scale = rows[c][c]
        rows[c] = [v/scale for v in rows[c]]
        for r in range(4):
            if r != c:
                factor = rows[r][c]
                rows[r] = [x-factor*y for x, y in zip(rows[r], rows[c])]
    return [row[4:] for row in rows]


def transform(matrix, point):
    return [sum(matrix[r][k]*v for k, v in enumerate([*point, 1.])) for r in range(3)]


def precise_data(lib, low, path, exact_sha, count=None):
    data = low.primitive_data(lib, path, exact_sha, count)
    doc = data['doc']
    for field in ['POSITION', 'NORMAL', 'WEIGHTS_0']:
        a = doc['accessors'][data['attributes'][field]]
        require(a['componentType'] == 5126 and not a.get('normalized') and not a.get('sparse'), 'F32 속성 필요')
    require(all(all(math.isfinite(v) for v in row) for field in ['POSITION', 'NORMAL', 'WEIGHTS_0'] for row in data['rows'][field]), '비유한 원본 속성')
    require(all(all(0 <= w <= 1.000001 for w in row) and abs(sum(row)-1) <= .000001 for row in data['rows']['WEIGHTS_0']), '4슬롯 가중치 합/범위 오류')
    parents, cache, visiting = {}, {}, set()
    for i, node in enumerate(doc['nodes']):
        for child in node.get('children', []):
            require(child not in parents, '중복 본 부모')
            parents[child] = i
    def column(values):
        return [[values[c*4+r] for c in range(4)] for r in range(4)]
    def world(i):
        if i in cache:
            return cache[i]
        require(i not in visiting, '본 계층 순환')
        visiting.add(i)
        node = doc['nodes'][i]
        if 'matrix' in node:
            m = column(node['matrix'])
        else:
            x, y, z, w = node.get('rotation', [0., 0., 0., 1.])
            sx, sy, sz = node.get('scale', [1., 1., 1.])
            tx, ty, tz = node.get('translation', [0., 0., 0.])
            m = [[(1-2*(y*y+z*z))*sx, 2*(x*y-z*w)*sy, 2*(x*z+y*w)*sz, tx],
                 [2*(x*y+z*w)*sx, (1-2*(x*x+z*z))*sy, 2*(y*z-x*w)*sz, ty],
                 [2*(x*z-y*w)*sx, 2*(y*z+x*w)*sy, (1-2*(x*x+y*y))*sz, tz], [0., 0., 0., 1.]]
        if i in parents:
            m = multiply(world(parents[i]), m)
        visiting.remove(i)
        cache[i] = m
        return m
    ibms = lib.read_accessor(doc, data['binary'], data['skin']['inverseBindMatrices'])
    matrices = [multiply(world(i), column(ibm)) for i, ibm in zip(data['skin']['joints'], ibms)]
    weighted = [[[sum(w*matrices[j][r][c] for j, w in zip(js, ws)) for c in range(4)] for r in range(4)]
                for js, ws in zip(data['rows']['JOINTS_0'], data['rows']['WEIGHTS_0'])]
    data['rest64'] = [transform(m, p) for m, p in zip(weighted, data['rows']['POSITION'])]
    data['weighted64'] = weighted
    data['names'] = [lib.canon_name(n) for n in data['names']]
    data['bones64'] = {name: [world(i)[r][3] for r in range(3)] for name, i in zip(data['names'], data['skin']['joints'])}
    require(all(all(math.isfinite(v) for v in p) for p in data['rest64']), '비유한 REST 좌표')
    return data


def foot_mass(data, i, side):
    allowed = {'mixamorig'+side+name for name in ['Foot', 'ToeBase', 'Toe_End']}
    # canon_name은 underscore를 제거한다.
    allowed = {name.replace('_', '') for name in allowed}
    return sum(w for j, w in zip(data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]) if data['names'][j] in allowed)


def semantic_side(data, i):
    names = {data['names'][j] for j, w in zip(data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]) if w > 1e-8}
    allowed = {'mixamorigHips'} | {'mixamorig'+side+part for side in SIDES for part in ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'ToeEnd']}
    if not names <= allowed:
        return None
    masses = [foot_mass(data, i, side) for side in SIDES]
    if (masses[0] > 1e-8) == (masses[1] > 1e-8):
        return None
    return SIDES[0 if masses[0] > 1e-8 else 1]


def quantile(values, fraction):
    values = sorted(values)
    at = (len(values)-1)*fraction
    low = math.floor(at)
    return values[low]+(values[min(low+1, len(values)-1)]-values[low])*(at-low)


def side_stats(data, side):
    ankle = data['bones64']['mixamorig'+side+'Foot']
    ids = [i for i, p in enumerate(data['rest64']) if semantic_side(data, i) == side and foot_mass(data, i, side) >= .30 and p[1] < ankle[1]+.06]
    require(len(ids) >= 3, '같은 쪽 실제 foot shape 표본 부족')
    axes = []
    for k in range(3):
        values = [data['rest64'][i][k]-ankle[k] for i in ids]
        axes.append({'min': min(values), 'p05': quantile(values, .05), 'median': quantile(values, .5), 'p95': quantile(values, .95), 'max': max(values)})
    sole_ids = [i for i in ids if data['rest64'][i][1] < ankle[1]+.02]
    require(sole_ids, 'QA sole 기준 정점 없음')
    return {'ankle': ankle, 'shapeVertices': ids, 'soleVertices': sole_ids, 'axes': axes}


def profile(data, reference):
    require(data['names'] == reference['names'], 'canonical bone 이름/순서 불일치')
    records = {}
    for side in SIDES:
        source, ref = side_stats(data, side), side_stats(reference, side)
        require(math.dist(source['ankle'], ref['ankle']) <= .0001, 'canonical Foot REST 위치 불일치')
        scales, offsets = [], []
        for k in range(3):
            s, r = source['axes'][k], ref['axes'][k]
            width = s['p95']-s['min'] if k == 1 else s['p95']-s['p05']
            ref_width = r['p95']-r['min'] if k == 1 else r['p95']-r['p05']
            require(width > 1e-7 and ref_width > 1e-7, '퇴화한 foot quantile 범위')
            scale = ref_width/width if k == 1 else min(1., ref_width/width)
            require(math.isfinite(scale) and scale > 0, '비양수 foot affine scale')
            offset = .006-source['ankle'][1]-scale*s['min'] if k == 1 else r['median']-scale*s['median']
            scales.append(scale)
            offsets.append(offset)
        records[side] = {'source': source, 'reference': ref, 'scale': scales, 'offset': offsets}
    return records


def smooth(value):
    value = min(1., max(0., value))
    return value*value*(3-2*value)


def field(data, records, asset):
    # 가중치 크기는 강도가 아니다. 같은 쪽 Foot 양수 영역의 공간 경계로 완화한다.
    groups, lookup, vertex_groups = [], {}, []
    for i, p in enumerate(data['rows']['POSITION']):
        key = tuple(round(v, 6) for v in p)
        if key not in lookup:
            lookup[key] = len(groups)
            groups.append({'members': [], 'point': data['rest64'][i], 'side': None, 'edges': {}})
        g = lookup[key]
        groups[g]['members'].append(i)
        vertex_groups.append(g)
    for g in groups:
        sides = [semantic_side(data, i) for i in g['members']]
        side = sides[0]
        if side and all(s == side for s in sides) and all(data['rest64'][i][1] < records[side]['source']['ankle'][1]+.22 for i in g['members']):
            g['side'] = side
    for face in data['faces']:
        for k in range(3):
            a, b = vertex_groups[face[k]], vertex_groups[face[(k+1) % 3]]
            if a == b:
                continue
            distance = math.dist(groups[a]['point'], groups[b]['point'])
            if distance < groups[a]['edges'].get(b, math.inf):
                groups[a]['edges'][b] = groups[b]['edges'][a] = distance
    distances, heap = [math.inf]*len(groups), []
    for i, g in enumerate(groups):
        if not g['side']:
            continue
        for j, distance in g['edges'].items():
            if groups[j]['side'] != g['side']:
                distances[i] = min(distances[i], distance)
        if math.isfinite(distances[i]):
            heapq.heappush(heap, (distances[i], i))
    while heap:
        distance, i = heapq.heappop(heap)
        if distance != distances[i]:
            continue
        for j, edge in groups[i]['edges'].items():
            if groups[j]['side'] != groups[i]['side']:
                continue
            candidate = distance+edge
            if candidate < distances[j]:
                distances[j] = candidate
                heapq.heappush(heap, (candidate, j))
    width = PARAMS['boundaryWidths'][asset]
    rows, desired, normals, unreachable = [], [list(p) for p in data['rest64']], set(), []
    for index, g in enumerate(groups):
        side, p = g['side'], g['point']
        if not side:
            continue
        if not math.isfinite(distances[index]):
            unreachable.extend(g['members'])
            continue
        normals.update(g['members'])
        r, distance = records[side], distances[index]
        ankle = r['source']['ankle']
        factors = [smooth(distance/width), 1-smooth((p[1]-ankle[1]-.03)/.19)]
        alpha = factors[0]*factors[1]
        if alpha <= 1e-10:
            continue
        delta = [(ankle[k]+r['scale'][k]*(p[k]-ankle[k])+r['offset'][k]-p[k])*alpha for k in range(3)]
        require(math.sqrt(sum(v*v for v in delta)) <= .15, 'foot 최대 변위 .15m 초과')
        for i in g['members']:
            desired[i] = [data['rest64'][i][k]+delta[k] for k in range(3)]
            rows.append({'vertex': i, 'side': side, 'mass': foot_mass(data, i, side), 'distance': distance, 'factors': factors, 'alpha': alpha, 'delta': delta})
    require(rows, '실제 foot 편집 영역 없음')
    for g in groups:
        j = g['members'][0]
        for i in g['members'][1:]:
            di = [desired[i][k]-data['rest64'][i][k] for k in range(3)]
            dj = [desired[j][k]-data['rest64'][j][k] for k in range(3)]
            require(math.dist(di, dj) <= .00002, 'seam delta 불일치: '+str((i, j)))
    domain = {'width': width, 'groups': len(groups), 'eligibleGroups': sum(bool(g['side']) for g in groups), 'unreachableVertices': sorted(unreachable)}
    return sorted(rows, key=lambda r: r['vertex']), desired, normals, domain


def triangle_gate(before, after, faces, changed):
    minimum_ratio, minimum_dot = 1., 1.
    for t, face in enumerate(faces):
        if not any(i in changed for i in face):
            continue
        a, b, c = [Vector(before[i]) for i in face]
        aa, bb, cc = [Vector(after[i]) for i in face]
        old, new = (b-a).cross(c-a), (bb-aa).cross(cc-aa)
        if old.length > 1e-10:
            ratio, dot = new.length/old.length, old.normalized().dot(new.normalized())
            require(.03 < ratio < 25 and dot > 0, 'REST 삼각형 붕괴/뒤집힘: '+str(t))
            minimum_ratio, minimum_dot = min(minimum_ratio, ratio), min(minimum_dot, dot)
    return {'minimumAreaRatio': minimum_ratio, 'minimumNormalDot': minimum_dot}


def author_asset(lib, low, repo, out, profiles_path, row, reference):
    asset, source = row['asset'], Path(row['path']).resolve()
    data = precise_data(lib, low, source, row['sha256'], ASSETS[asset])
    require(not data['doc'].get('animations'), '입력은 mesh-only 몸체여야 합니다.')
    records = profile(data, reference)
    mask, desired, normal_ids, domain = field(data, records, asset)
    final_raw = [list(p) for p in data['rows']['POSITION']]
    changes = []
    for entry in mask:
        i = entry['vertex']
        # skinning은 weighted xyz를 사용하며 마지막 w로 나누지 않는다. F32 weights 합이
        # 정확히 1이 아닐 수도 있으므로 xyz affine 역산의 마지막 행은 [0,0,0,1]로 둔다.
        affine_matrix = [list(r) for r in data['weighted64'][i]]
        affine_matrix[3] = [0., 0., 0., 1.]
        value = [f32(v) for v in transform(inverse(affine_matrix), desired[i])]
        require(math.dist(transform(data['weighted64'][i], value), desired[i]) <= 2e-6, 'F32 REST 역변환 오차')
        if value != final_raw[i]:
            changes.append({**entry, 'old': final_raw[i], 'new': value})
            final_raw[i] = value
    changed = {r['vertex'] for r in changes}
    require(changed, 'Float32 위치 변화 없음')
    final_world = [transform(m, p) for m, p in zip(data['weighted64'], final_raw)]
    rest_triangles = triangle_gate(data['rest64'], final_world, data['faces'], changed)
    normal_rows, raw_triangles = lib.corrected_normals(data['rows']['POSITION'], final_raw, data['rows']['NORMAL'], data['faces'], changed, normal_ids, data['rows']['JOINTS_0'], data['rows']['WEIGHTS_0'], data['names'])
    actual, arm, import_info = low.import_body(lib, source, data)
    expected = [lib.to_blender(p) for p in data['rest64']]
    initial_parity = low.parity(lib, expected, low.evaluated_points(actual))
    require(len(actual.data.vertices) == ASSETS[asset], '실제 import vertex 수 변경')
    bone_rest = [(b.name, [list(r) for r in b.matrix_local]) for b in arm.data.bones]
    original_weights = [[(g.group, g.weight) for g in v.groups] for v in actual.data.vertices]
    original_uv = [[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers]
    original_loops = [loop.vertex_index for loop in actual.data.loops]
    corner_normals = [tuple(n.vector) for n in actual.data.corner_normals]
    tree = KDTree(len(expected))
    for i, p in enumerate(expected):
        tree.insert(p, i)
    tree.balance()
    mapping = []
    for vertex in actual.data.vertices:
        p = actual.matrix_world @ vertex.co
        _, _, error = tree.find(p)
        require(error <= .0001, '실제 import 정점 대응 오차')
        actual_map = {lib.canon_name(actual.vertex_groups[g.group].name): g.weight for g in vertex.groups if g.weight > 1e-8}
        matches = []
        for _, i, _ in tree.find_range(p, max(1e-6, error+1e-7)):
            wanted_map = {}
            for j, w in zip(data['rows']['JOINTS_0'][i], data['rows']['WEIGHTS_0'][i]):
                name = data['names'][j]
                wanted_map[name] = wanted_map.get(name, 0.)+w
            if all(abs(actual_map.get(n, 0.)-wanted_map.get(n, 0.)) <= 2e-7 for n in set(actual_map)|set(wanted_map)):
                matches.append(i)
        require(matches, '위치와 weights가 모두 일치하는 원본 정점 없음')
        sid = min(matches)
        require(all(math.dist(final_world[sid], final_world[j]) <= .00002 for j in matches), '겹친 importer 정점의 목표 불일치')
        mapping.append(sid)
    inverse_object = actual.matrix_world.inverted()
    for vertex, sid in zip(actual.data.vertices, mapping):
        if sid in changed:
            vertex.co = inverse_object @ lib.to_blender(final_world[sid])
    attribute = actual.data.attributes.get('source_vertex_id') or actual.data.attributes.new('source_vertex_id', 'INT', 'POINT')
    for i, sid in enumerate(mapping):
        attribute.data[i].value = sid
    actual.data.update()
    actual.data.normals_split_custom_set(corner_normals)
    require(original_weights == [[(g.group, g.weight) for g in v.groups] for v in actual.data.vertices], 'Blender weights 변경')
    require(original_uv == [[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers], 'Blender UV 변경')
    require(original_loops == [loop.vertex_index for loop in actual.data.loops], 'Blender topology 변경')
    require(bone_rest == [(b.name, [list(r) for r in b.matrix_local]) for b in arm.data.bones], 'Blender bone REST 변경')
    bpy.context.view_layer.update()
    final_parity = low.parity(lib, [lib.to_blender(p) for p in final_world], low.evaluated_points(actual))
    blend = out/(asset+'.blend')
    require(not blend.exists(), 'blend 덮어쓰기 금지')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    final_sole = {side: min(final_world[i][1] for i in records[side]['source']['soleVertices']) for side in SIDES}
    patch = {'schema': 'blade-surge.foot-fit-patch.v1', 'ok': True, 'candidateOnly': True, 'asset': asset,
             'source': file_record(source), 'reference': file_record(repo/REFERENCE), 'profiles': file_record(profiles_path),
             'author': file_record(__file__), 'lowerAuthorSha256': LOWER_SHA, 'helperSha256': HELPER_SHA,
             'blender': bpy.app.version_string, 'blend': file_record(blend), 'importIdentity': import_info,
             'restValidation': initial_parity, 'blendValidation': final_parity,
             'primitive': {'node': data['nodeIndex'], 'mesh': data['node']['mesh'], 'primitive': 0, 'vertexCount': ASSETS[asset]},
             'profile': {'parameters': PARAMS, 'sides': records, 'mask': mask, 'domain': domain}, 'normalEligibleVertices': sorted(normal_ids),
             'changes': {'positions': changes, 'normals': normal_rows}, 'triangleValidation': {'raw': raw_triangles, 'rest': rest_triangles},
             'actualRestSole': final_sole,
             'limitations': ['artist .006 is affine target, not a dense contact PASS', 'blend keeps imported corner normals; GLB rotates affected seam normals', 'runtime motion packet body SHA must be revalidated']}
    patch_path = out/(asset+'.patch.json')
    low.write_new(patch_path, patch)
    require(sha(source) == row['sha256'] and sha(repo/REFERENCE) == REFERENCE_SHA, '저작 중 입력 변경')
    return {'asset': asset, 'patch': file_record(patch_path), 'blend': file_record(blend), 'positionChanges': len(changes), 'normalChanges': len(normal_rows), 'actualRestSole': final_sole}


def main(args):
    require(bpy.app.version >= (5, 2, 0), '실제 Blender 5.2 이상 필요')
    repo, profiles_path, out = Path(args.repo).resolve(), Path(args.profiles).resolve(), Path(args.out_dir).resolve()
    profiles_sha = sha(profiles_path)
    rows = validate_profiles(profiles_path)
    require(sha(repo/REFERENCE) == REFERENCE_SHA, 'public canonical rogue T1 SHA 불일치')
    require(out != repo and repo not in out.parents and not out.exists(), '저장소 밖 새 출력 디렉터리 필요')
    require(out not in profiles_path.parents and all(out not in Path(row['path']).resolve().parents for row in rows), '입력 안/밖 출력 충돌')
    require(out not in Path(args.report).resolve().parents, 'runner report는 산출물 밖이어야 합니다.')
    low = load_helper('readonly_lower03_foot', repo/'art-src/higher-bodies/author_lower_fit_v1.py', LOWER_SHA)
    lib = load_helper('readonly_fox_foot_glb', repo/'art-src/avatar-fox/author_body_contact_v3.py', HELPER_SHA)
    reference = precise_data(lib, low, repo/REFERENCE, REFERENCE_SHA)
    # 파일은 모든 프로필/원본 SHA 검사 이후에만 생성한다.
    out.mkdir(parents=True, exist_ok=False)
    reports = [author_asset(lib, low, repo, out, profiles_path, row, reference) for row in rows]
    require(sha(profiles_path) == profiles_sha, '저작 중 profiles 변경')
    return {'ok': True, 'candidateOnly': True, 'schema': 'blade-surge.foot-fit-author.v1', 'author': file_record(__file__), 'profiles': file_record(profiles_path), 'assets': reports}


if __name__ == '__main__':
    args = task_args(build_args)
    report = Path(args.report).resolve()
    require(not report.exists() and report.parent.is_dir(), 'runner report는 기존 부모 안의 새 파일이어야 합니다.')
    require(report != Path(args.profiles).resolve() and Path(args.repo).resolve() not in report.parents, 'runner report가 입력/저장소를 덮을 수 없습니다.')
    run(main, args)
