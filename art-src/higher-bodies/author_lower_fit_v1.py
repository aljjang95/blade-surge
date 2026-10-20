"""상위 몸체 첫 후보: 실제 Blender에서 하체만 C1 피팅한다. 기존 여우 저작 파일은 읽기 전용이다."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

# 설치된 runner의 표준 인자/실패 보고서/파일 기록 계약을 직접 사용한다.
COMMON_DIR = Path("C:/Users/heart/.codex/skills/blender-headless/scripts/tasks")
sys.path.insert(0, str(COMMON_DIR))
from _common import task_args, run, file_record, drop_import_helpers

HELPER_SHA = '78ec15dfeb5e5908237586bc77f8b3e8a8e291efcc24fd35f35627088c5eaab1'
REFERENCES = {
    'ranger': ('hero_ranger_t1', '2c88389c285019a4b2b0e948736f6f01b1a1a173f28b2dcac054981b45e99b23'),
    'rogue': ('hero_rogue_t1', '9d2dab5e01dd9df6b80f6343a1d32820772ca21080468011473893a009ea0539'),
}
ASSETS = [
    ('hero_ranger_t2', 'ranger', 'e90f6b9c23458d26b47f9718803430c8efbd537740765f472fa48b80c79429db', 16675, -.0224214),
    ('hero_ranger_t3', 'ranger', '41a3a8cd9310ed8620f5a30cab45df1b20a29cb2055f7d35c1c3caaa12d4ad72', 17408, .0304797),
    ('hero_rogue_t2', 'rogue', '73459cf328b31d53a8068ef6ed7e81b5d8a6da515fdb03a14e7e63344e22a48a', 16299, -.1173232),
    ('hero_rogue_t3', 'rogue', '78fad9b7e5386e0d35fc0ea96214c7bc46aa7528771d1aa0c6885c6c69664c08', 15728, -.1002497),
    ('avatar_rogue_crow', 'rogue', 'a5d5e919156669f243c93e483543ecc00b21f1a82a3a88efbe6772f0bb5a259b', 14697, -.1660811),
]
TOLERANCE = .0001
TARGET_SOLE = .012


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_new(path, data):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)


def build_args(parser):
    parser.add_argument('--repo', required=True)
    parser.add_argument('--out-dir', required=True)


def primitive_data(lib, path, expected_sha, expected_vertices=None):
    raw, doc, binary = lib.read_glb(path)
    require(hashlib.sha256(raw).hexdigest() == expected_sha, '정확한 원본 SHA 불일치: ' + str(path))
    nodes = [(i, n) for i, n in enumerate(doc['nodes']) if 'mesh' in n]
    require(len(nodes) == 1 and 'skin' in nodes[0][1], '단일 스킨 메시가 필요합니다.')
    ni, node = nodes[0]
    primitives = doc['meshes'][node['mesh']]['primitives']
    require(len(primitives) == 1, '단일 primitive가 필요합니다.')
    primitive = primitives[0]
    require(primitive.get('mode', 4) == 4 and not primitive.get('targets') and not primitive.get('extensions'), '지원하지 않는 primitive')
    a = primitive['attributes']
    require(not any(k in a for k in ['JOINTS_1', 'WEIGHTS_1', 'TANGENT']), '추가 가중치/탄젠트는 별도 계약이 필요합니다.')
    for name in ['POSITION', 'NORMAL']:
        require(doc['accessors'][a[name]]['componentType'] == 5126, 'float32 위치/법선이 필요합니다.')
    rows = {name: lib.read_accessor(doc, binary, a[name]) for name in ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']}
    count = len(rows['POSITION'])
    require(all(len(v) == count for v in rows.values()), '속성 정점 수 불일치')
    require(expected_vertices is None or count == expected_vertices, '계약 정점 수 불일치')
    require(all(len(w) == 4 and abs(sum(w)-1) < .001 for w in rows['WEIGHTS_0']), '정규화된 네 영향이 필요합니다.')
    skin = doc['skins'][node['skin']]
    require(len(skin['joints']) == 65, '계약 본 수 불일치')
    names = [doc['nodes'][j].get('name', '') for j in skin['joints']]
    world = lib.world_nodes(doc)
    ibms = lib.read_accessor(doc, binary, skin['inverseBindMatrices'])
    require(len(ibms) == len(names), '역바인드 수 불일치')
    matrices = [world[j] @ lib.column_matrix(ibm) for j, ibm in zip(skin['joints'], ibms)]
    require(all(0 <= j < len(names) for row in rows['JOINTS_0'] for j in row), '본 인덱스 범위 초과')
    rest = [lib.skin_world(p, j, w, matrices) for p, j, w in zip(rows['POSITION'], rows['JOINTS_0'], rows['WEIGHTS_0'])]
    flat = [r[0] for r in lib.read_accessor(doc, binary, primitive['indices'])]
    require(len(flat) % 3 == 0 and all(0 <= i < count for i in flat), '삼각형 인덱스 오류')
    return {'doc': doc, 'binary': binary, 'nodeIndex': ni, 'node': node, 'primitive': primitive, 'attributes': a,
            'rows': rows, 'skin': skin, 'names': names, 'world': world, 'matrices': matrices, 'rest': rest,
            'faces': [flat[i:i+3] for i in range(0, len(flat), 3)]}


def import_body(lib, path, data):
    # _common.import_any/drop_import_helpers보다 엄격하게 실제 custom-shape 참조만 분류한다.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path.resolve()), merge_vertices=False)
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    require(len(arms) == 1, '단일 원본 armature가 필요합니다.')
    source_names = {data['node'].get('name'), data['doc']['meshes'][data['node']['mesh']].get('name')} - {None, ''}
    selected, metadata, helpers = [], [], []
    for mesh in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        rigged = any(m.type == 'ARMATURE' and m.object in arms for m in mesh.modifiers)
        match = mesh.name in source_names or mesh.data.name in source_names
        owners = [b.name for a in arms for b in a.pose.bones if b.custom_shape == mesh]
        body = match and rigged
        helper = not match and not rigged and bool(owners)
        metadata.append({'name': mesh.name, 'vertices': len(mesh.data.vertices), 'body': body, 'helper': helper, 'owners': owners})
        require(body or helper, '분류되지 않은 importer 메시: ' + mesh.name)
        if body: selected.append(mesh)
        else: helpers.append(mesh)
    require(len(selected) == 1, '원본 identity와 armature가 일치하는 몸체 한 개가 필요합니다.')
    for arm in arms:
        arm.data.pose_position = 'REST'
        require(not arm.animation_data or not arm.animation_data.action, 'mesh-only 원본에 실행 action이 있습니다.')
        for bone in arm.pose.bones:
            if bone.custom_shape in helpers: bone.custom_shape = None
    # 분류가 끝난 뒤 설치된 공통 helper 제거 함수를 호출한다.
    helper_names = [obj.name for obj in helpers]
    drop_import_helpers()
    for name in helper_names:
        helper = bpy.data.objects.get(name)
        if helper is not None: bpy.data.objects.remove(helper, do_unlink=True)
    bpy.context.view_layer.update()
    return selected[0], arms[0], metadata


def evaluated_points(mesh):
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = evaluated.to_mesh()
    points = [evaluated.matrix_world @ vertex.co for vertex in data.vertices]
    evaluated.to_mesh_clear()
    return points


def parity(lib, wanted, actual):
    forward, reverse = lib.nearest_error(wanted, actual), lib.nearest_error(actual, wanted)
    require(max(forward['maximum'], reverse['maximum']) <= TOLERANCE, '실제 Blender REST 양방향 일치 실패')
    return {'sourceToBlender': forward, 'blenderToSource': reverse, 'tolerance': TOLERANCE}


def protected_vertex(lib, names, js, ws):
    return any(w > 1e-8 and any(k in lib.canon_name(names[j]) for k in ['Head', 'Neck', 'Spine']) for j, w in zip(js, ws))


def author_asset(lib, repo, out, contract):
    asset, hero, source_sha, count, expected_sole = contract
    source = repo / 'asset-library' / 'normalized' / (asset + '.glb')
    ref_id, ref_sha = REFERENCES[hero]
    reference = repo / 'asset-library' / 'normalized' / (ref_id + '.glb')
    data = primitive_data(lib, source, source_sha, count)
    ref = primitive_data(lib, reference, ref_sha)
    require(not data['doc'].get('animations'), '출력은 원래 mesh-only이어야 합니다.')
    require([lib.canon_name(n) for n in data['names']] == [lib.canon_name(n) for n in ref['names']], '직업별 reference 본 이름 불일치')
    rows, names, world = data['rows'], data['names'], data['world']
    joints, weights = rows['JOINTS_0'], rows['WEIGHTS_0']
    hip = next(i for i in data['skin']['joints'] if lib.canon_name(data['doc']['nodes'][i].get('name', '')) == 'mixamorigHips')
    feet = [i for i in data['skin']['joints'] if lib.canon_name(data['doc']['nodes'][i].get('name', '')) in ['mixamorigLeftFoot', 'mixamorigRightFoot']]
    require(len(feet) == 2, '좌우 발 본 식별 실패')
    hips_y, ankle_y = world[hip].translation.y, max(world[i].translation.y for i in feet)
    require(abs(hips_y - (.840235 if hero == 'ranger' else .798047)) < .0001, '직업별 원본 골반 기준 불일치')
    protected = {i for i in range(count) if protected_vertex(lib, names, joints[i], weights[i])}
    require(protected, '보호 정점 집합이 없습니다.')
    protected_min_y = min(data['rest'][i].y for i in protected)
    fit_stop_y = min(hips_y, protected_min_y)
    # 보호 정점 전부가 변위와 도함수 0 영역에 들도록 공간 곡선의 끝을 제한한다.
    eligible = {i for i, p in enumerate(data['rest']) if i not in protected and p.y < fit_stop_y}
    # 고정 경계 정점도 인접한 변형 면의 법선 회전이 필요하므로 위치 집합과 분리한다.
    normal_eligible = {i for i, p in enumerate(data['rest']) if i not in protected and p.y < hips_y}
    foot_ids = [i for i in eligible if data['rest'][i].y < ankle_y+.02 and sum(w for j, w in zip(joints[i], weights[i]) if lib.is_foot(names[j])) >= .30]
    require(foot_ids, '원본 발바닥 정점 집합이 없습니다.')
    sole = min(data['rest'][i].y for i in foot_ids)
    require(abs(sole - expected_sole) < .001, 'asset별 원본 sole 기준 불일치')
    require(abs(TARGET_SOLE-sole) <= .20 and fit_stop_y > sole, '국소 피팅 범위 초과')
    min_y_derivative = min(1., 1.-1.5*(TARGET_SOLE-sole)/(fit_stop_y-sole))
    require(min_y_derivative > .05, '보호 cutoff 공간 곡선의 단조성 붕괴')
    actual, arm, import_info = import_body(lib, source, data)
    expected = [lib.to_blender(p) for p in data['rest']]
    rest_validation = parity(lib, expected, evaluated_points(actual))
    require(len(actual.data.vertices) == count, 'importer 정점 수 변경')
    rest_bones = [(b.name, [list(r) for r in b.matrix_local]) for b in arm.data.bones]
    original_groups = [[(g.group, g.weight) for g in v.groups] for v in actual.data.vertices]
    original_uv = [[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers]
    original_loops = [loop.vertex_index for loop in actual.data.loops]
    # Blender 편집본은 원본 corner normals를 유지한다. GLB 하체 normals는 별도 명시 패치다.
    original_corner_normals = [tuple(n.vector) for n in actual.data.corner_normals]
    final_raw = [list(p) for p in rows['POSITION']]
    final_world = [p.copy() for p in data['rest']]
    position_changes = []
    for i in sorted(eligible):
        before = data['rest'][i]
        u = max(0., min(1., (before.y-sole)/(fit_stop_y-sole)))
        after = before.copy()
        after.y += (TARGET_SOLE-sole)*(1-u*u*(3-2*u))
        require((after-before).length <= .20, '정점 변위 .20m 초과')
        if (after-before).length <= 1e-10: continue
        matrix = lib.weighted_matrix(joints[i], weights[i], data['matrices'])
        require(abs(matrix.determinant()) > 1e-10, '특이 REST 스킨 행렬')
        raw_new = list((matrix.inverted() @ Vector((*after, 1)))[:3])
        require((lib.skin_world(raw_new, joints[i], weights[i], data['matrices'])-after).length < 2e-6, 'REST 역변환 일치 실패')
        final_raw[i], final_world[i] = raw_new, after
        position_changes.append({'vertex': i, 'old': rows['POSITION'][i], 'new': raw_new,
                                 'restWorldBefore': list(before), 'restWorldAfter': list(after), 'region': 'lower-only'})
    require(position_changes, '피팅 변화가 없습니다.')
    changed = {r['vertex'] for r in position_changes}
    normal_changes, triangle_validation = lib.corrected_normals(rows['POSITION'], final_raw, rows['NORMAL'], data['faces'], changed, normal_eligible, joints, weights, names)
    require(not (changed & protected) and not ({r['vertex'] for r in normal_changes} & protected), '보호 위치/법선 변경')
    tree = KDTree(count)
    for i, p in enumerate(expected): tree.insert(p, i)
    tree.balance()
    mapping = []
    for vertex in actual.data.vertices:
        point = actual.matrix_world @ vertex.co
        nearest, sid, error = tree.find(point)
        require(error <= TOLERANCE, '편집 원본과 평가 REST가 다릅니다.')
        neighbors = tree.find_range(point, max(1e-6, error+1e-7))
        require(all((final_world[j]-final_world[sid]).length < 2e-5 for _, j, _ in neighbors), '겹친 원본 정점의 편집 결과가 다릅니다.')
        mapping.append(sid)
    inverse_object = actual.matrix_world.inverted()
    for vertex, sid in zip(actual.data.vertices, mapping):
        if sid in changed: vertex.co = inverse_object @ lib.to_blender(final_world[sid])
    ids = actual.data.attributes.new('source_vertex_id', 'INT', 'POINT')
    for i, sid in enumerate(mapping): ids.data[i].value = sid
    actual.data.update()
    actual.data.normals_split_custom_set(original_corner_normals)
    require(original_groups == [[(g.group, g.weight) for g in v.groups] for v in actual.data.vertices], 'Blender 가중치 변경')
    require(original_uv == [[list(v.uv) for v in layer.data] for layer in actual.data.uv_layers], 'Blender UV 변경')
    require(original_loops == [loop.vertex_index for loop in actual.data.loops], 'Blender topology 변경')
    require(rest_bones == [(b.name, [list(r) for r in b.matrix_local]) for b in arm.data.bones], 'Blender 본 REST 변경')
    bpy.context.view_layer.update()
    blend_validation = parity(lib, [lib.to_blender(p) for p in final_world], evaluated_points(actual))
    blend_path = out / (asset + '.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    patch = {'schema': 'blade-surge.higher-lower-patch.v1', 'ok': True, 'asset': asset, 'stage': 'lower-only',
             'source': file_record(source), 'reference': file_record(reference), 'author': file_record(__file__),
             'blender': bpy.app.version_string, 'helperSha256': HELPER_SHA,
             'primitive': {'node': data['nodeIndex'], 'mesh': data['node']['mesh'], 'primitive': 0, 'vertexCount': count,
                           'positionAccessor': data['attributes']['POSITION'], 'normalAccessor': data['attributes']['NORMAL']},
             'fit': {'sourceSole': sole, 'targetSole': TARGET_SOLE, 'hipsY': hips_y, 'ankleY': ankle_y,
                     'profile': 'protected-cutoff-c1-v3', 'fitStopY': fit_stop_y, 'protectedMinY': protected_min_y,
                     'minimumYDerivative': min_y_derivative, 'maxDisplacementMeters': .20, 'footVertices': foot_ids, 'protectedVertices': sorted(protected),
                     'eligibleVertices': sorted(eligible), 'normalEligibleVertices': sorted(normal_eligible),
                     'normalEligibility': '!protected && restY<hipsY; only changed face/seam area-normal rotation', 'formula': 'deltaY=(targetSole-sourceSole)*(1-smoothstep(clamp((y-sourceSole)/(fitStopY-sourceSole),0,1)))'},
             'restValidation': rest_validation, 'blendValidation': blend_validation, 'blend': file_record(blend_path),
             'importIdentity': import_info, 'triangleValidation': triangle_validation,
             'changes': {'positions': position_changes, 'normals': normal_changes, 'weights': []},
             'preserved': ['WEIGHTS_0', 'JOINTS_0', 'head/neck/spine POSITION and NORMAL', 'UV', 'indices', 'materials', 'textures', 'nodes', 'skins', 'animations'],
             'limitations': ['candidate only; root must measure 301 samples+all keys direct/swap and inspect actual visuals',
                             'blend keeps imported corner normals; packed GLB lower normals use explicit seam rotation; identical shading is not claimed']}
    patch_path = out / (asset + '.patch.json')
    write_new(patch_path, patch)
    report = {'ok': True, 'asset': asset, 'patch': file_record(patch_path), 'blend': file_record(blend_path),
              'normalEligibility': '!protected && restY<hipsY; only changed face/seam area-normal rotation',
              'normalEligibleCount': len(normal_eligible), 'fitStopY': fit_stop_y, 'protectedMinY': protected_min_y, 'minimumYDerivative': min_y_derivative,
              'positionChanges': len(position_changes), 'normalChanges': len(normal_changes), 'weightChanges': 0,
              'maximumWorldMove': max((Vector(r['restWorldAfter'])-Vector(r['restWorldBefore'])).length for r in position_changes),
              'restValidation': rest_validation, 'blendValidation': blend_validation}
    write_new(out / (asset + '.author.json'), report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


def main(args):
    results = []
    require(bpy.app.version >= (5, 2, 0), '실제 Blender 5.2 이상이 필요합니다.')
    repo, out = Path(args.repo).resolve(), Path(args.out_dir).resolve()
    require(out != repo and repo not in out.parents, '산출물은 저장소 밖 새 디렉터리를 사용합니다.')
    require(not out.exists() or (out.is_dir() and not any(out.iterdir())), '산출물 디렉터리가 비어 있지 않습니다.')
    out.mkdir(parents=True, exist_ok=True)
    helper = repo / 'art-src/avatar-fox/author_body_contact_v3.py'
    require(sha(helper) == HELPER_SHA, '읽기 전용 여우 helper SHA 불일치')
    spec = importlib.util.spec_from_file_location('original_fox_glb_helpers', str(helper))
    lib = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lib)  # fox main()은 호출하지 않는다.
    for contract in ASSETS:
        results.append(author_asset(lib, repo, out, contract))
    return {'ok': True, 'schema': 'blade-surge.higher-lower-author.v1', 'assets': results,
            'author': file_record(__file__), 'outDir': str(out), 'targetSole': TARGET_SOLE}


if __name__ == '__main__':
    args = task_args(build_args)
    # 공통 run은 report를 쓰므로 호출 전에 기존 파일을 거부한다.
    report_path = Path(args.report).resolve()
    require(not report_path.exists(), 'report가 이미 존재합니다.')
    require(report_path.parent.is_dir(), 'runner report 부모 디렉터리가 필요합니다.')
    run(main, args)
