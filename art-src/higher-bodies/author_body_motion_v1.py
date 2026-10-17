"""상위 몸체의 승인된 고정 artist 키만 Blender에서 저작한다. 접지값으로 곡선을 계산하지 않는다."""
import hashlib
import importlib.util
import json
import math
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
COMMON_DIR = Path('C:/Users/heart/.codex/skills/blender-headless/scripts/tasks')
sys.path.insert(0, str(COMMON_DIR))
from _common import task_args, run, file_record, drop_import_helpers

GLB_HELPER_SHA = '78ec15dfeb5e5908237586bc77f8b3e8a8e291efcc24fd35f35627088c5eaab1'
MOTION_HELPER_SHA = '8f9e9f080162cc27a2f3202f914d83388bbcf18296c7a8c814ae8f318920ba36'
CANONICAL = {
    'ranger': ('/models/heroes-next/ranger-library-t1-v4.glb', '0a008c410e2e3df74b87ba7e00f317f4266c1edc0eda2951e43f8a9a6dce43d0'),
    'rogue': ('/models/heroes-next/rogue-library-t1-v2.glb', '19f7e1492d947c6055cbbd8b51f3ee355c5c72f8ec4ab6296be32fb9d1e1c846'),
}
TARGETS = {
    'hero_ranger_t2': ('ranger', 'ranger-t2', 'e90f6b9c23458d26b47f9718803430c8efbd537740765f472fa48b80c79429db'),
    'hero_ranger_t3': ('ranger', 'ranger-t3', '41a3a8cd9310ed8620f5a30cab45df1b20a29cb2055f7d35c1c3caaa12d4ad72'),
    'hero_rogue_t2': ('rogue', 'rogue-t2', '73459cf328b31d53a8068ef6ed7e81b5d8a6da515fdb03a14e7e63344e22a48a'),
    'hero_rogue_t3': ('rogue', 'rogue-t3', '78fad9b7e5386e0d35fc0ea96214c7bc46aa7528771d1aa0c6885c6c69664c08'),
    'avatar_rogue_crow': ('rogue', 'rogue-crow', 'a5d5e919156669f243c93e483543ecc00b21f1a82a3a88efbe6772f0bb5a259b'),
}
DURATIONS = {'dodge': .5, 'death': 1.25}
TOLERANCE = 1e-4


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def write_new(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)


def import_helper(path, digest, name):
    require(sha(path) == digest, '읽기 전용 helper SHA 불일치: ' + str(path))
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # 기존 main/author_clip은 호출하지 않는다.
    return module


def build_args(parser):
    parser.add_argument('--repo', required=True)
    parser.add_argument('--profiles', required=True)
    parser.add_argument('--out-dir', required=True)


def validate_profiles(repo, path):
    profiles = json.loads(path.read_text(encoding='utf-8'))
    require(profiles.get('schema') == 'blade-surge.higher-body-motion-profiles.v1', '프로필 schema 불일치')
    bodies = profiles.get('bodies')
    require(isinstance(bodies, list) and 1 <= len(bodies) <= 5, '빈 프로필 또는 대상 수 오류: 산출물을 만들지 않습니다.')
    seen = set()
    for body in bodies:
        asset = body.get('asset')
        require(asset in TARGETS and asset not in seen, '대상 몸체 중복·범위 오류')
        seen.add(asset)
        hero, prefix, source_sha = TARGETS[asset]
        require(body.get('heroId') == hero and body.get('revisionId') == prefix + '-body-fit-v1', '몸체 직업·revision 불일치')
        source = body.get('source', {})
        require(source.get('path') == 'asset-library/normalized/' + asset + '.glb' and source.get('sha256') == source_sha,
                '고정 원본 출처 불일치')
        require(sha(repo / source['path']) == source_sha, '실제 원본 GLB SHA 불일치')
        base_path, base_sha = CANONICAL[hero]
        require(body.get('base') == {'path': base_path, 'sha256': base_sha}, '공유 클립 GLB 계약 불일치')
        require(sha(repo / 'public' / base_path.lstrip('/')) == base_sha, '실제 canonical GLB SHA 불일치')
        candidate = body.get('body', {})
        require(candidate.get('path') == '/models/heroes-next/' + prefix + '-body-fit-v1.glb'
                and re.fullmatch(r'[a-f0-9]{64}', candidate.get('sha256', '')) is not None, '후보 public 경로·SHA 불일치')
        local = Path(candidate.get('inputPath', '')).resolve()
        require(local.is_file() and sha(local) == candidate['sha256'], '실제 후보 GLB 파일·SHA 불일치')
        require(local != (repo / source['path']).resolve() and candidate['sha256'] != source_sha, '교정 후보가 원본과 같습니다.')
        clips = body.get('clips')
        require(isinstance(clips, list) and 1 <= len(clips) <= 2, '빈 clip 프로필 또는 개수 오류')
        names = set()
        for clip in clips:
            name = clip.get('clip')
            require(name in DURATIONS and name not in names, '회피·사망 외 clip 또는 중복')
            names.add(name)
            require(isinstance(clip.get('profileId'), str) and clip['profileId'].strip(), '실제 승인 profileId가 필요합니다.')
            require(clip.get('interpolation') == 'SMOOTHSTEP', '고정 C1 artist 키만 지원합니다.')
            keys = clip.get('keysMeters')
            require(isinstance(keys, list) and 2 <= len(keys) <= 128
                    and all(isinstance(key, list) and len(key) == 2 and all(finite(v) for v in key) for key in keys), 'artist 키 형식 오류')
            require(keys[0][0] == 0 and keys[-1][0] == DURATIONS[name]
                    and all(a[0] < b[0] for a, b in zip(keys, keys[1:])), 'artist 시간·양 끝 오류')
            require(all(0 <= value <= .35 for _, value in keys), 'artist 높이 .35m 범위 초과')
            require(max(value for _, value in keys) - min(value for _, value in keys) > 2e-6, '상수 lift는 허용하지 않습니다.')
    return bodies


def profile_value(keys, time):
    if time <= keys[0][0]:
        return keys[0][1]
    if time >= keys[-1][0]:
        return keys[-1][1]
    for (ta, va), (tb, vb) in zip(keys, keys[1:]):
        if time <= tb:
            u = (time-ta)/(tb-ta)
            return va + (vb-va)*u*u*(3-2*u)
    raise RuntimeError('artist 키 구간 없음')


def runtime_row(times, rows, time):
    # Three LinearInterpolant의 계산 순서와 Float32 resultBuffer를 재현한다.
    if time <= times[0]:
        return list(rows[0])
    if time >= times[-1]:
        return list(rows[-1])
    for i in range(len(times)-1):
        if time < times[i+1]:
            alpha = (time-times[i])/(times[i+1]-times[i])
            return [f32(b*alpha+a*(1-alpha)) for a, b in zip(rows[i], rows[i+1])]
    raise RuntimeError('원본 LINEAR 구간 없음')


def evaluated_points(mesh):
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ vertex.co for vertex in data.vertices]
    finally:
        evaluated.to_mesh_clear()


def parity(lib, expected, actual):
    require(len(expected) == len(actual), 'REST 정점 수 변경')
    forward, reverse = lib.nearest_error(expected, actual), lib.nearest_error(actual, expected)
    require(max(forward['maximum'], reverse['maximum']) <= TOLERANCE, 'REST 스킨 양방향 parity 실패')
    return {'sourceToBlender': forward, 'blenderToSource': reverse, 'tolerance': TOLERANCE}


def mesh_snapshot(mesh):
    return {'positions': [tuple(v.co) for v in mesh.data.vertices],
            'weights': [[(g.group, g.weight) for g in v.groups] for v in mesh.data.vertices],
            'groups': [g.name for g in mesh.vertex_groups], 'loops': [l.vertex_index for l in mesh.data.loops],
            'uv': [[tuple(v.uv) for v in layer.data] for layer in mesh.data.uv_layers],
            'normals': [tuple(n.vector) for n in mesh.data.corner_normals],
            'materials': [m.name if m else None for m in mesh.data.materials]}


def bone_snapshot(arm):
    return [(b.name, b.parent.name if b.parent else None, [list(row) for row in b.matrix_local]) for b in arm.data.bones]


def candidate_rest(lib, doc, binary):
    nodes = [(i, n) for i, n in enumerate(doc['nodes']) if 'mesh' in n]
    require(len(nodes) == 1 and 'skin' in nodes[0][1] and not doc.get('animations'), '단일 mesh-only 후보가 필요합니다.')
    _, node = nodes[0]
    primitives = doc['meshes'][node['mesh']]['primitives']
    require(len(primitives) == 1 and not primitives[0].get('targets'), '단일 primitive·morph 없음이 필요합니다.')
    attributes = primitives[0]['attributes']
    require(not any(name in attributes for name in ['JOINTS_1', 'WEIGHTS_1']), '추가 스킨 영향은 별도 계약입니다.')
    rows = {name: lib.read_accessor(doc, binary, attributes[name]) for name in ['POSITION', 'JOINTS_0', 'WEIGHTS_0']}
    skin = doc['skins'][node['skin']]
    require(len(skin['joints']) == 65, '후보 본 수 불일치')
    world = lib.world_nodes(doc)
    ibms = lib.read_accessor(doc, binary, skin['inverseBindMatrices'])
    require(len(ibms) == 65 and len(rows['POSITION']) == len(rows['JOINTS_0']) == len(rows['WEIGHTS_0']), '스킨 속성 크기 오류')
    matrices = [world[j] @ lib.column_matrix(ibm) for j, ibm in zip(skin['joints'], ibms)]
    rest = [lib.skin_world(p, j, w, matrices) for p, j, w in zip(rows['POSITION'], rows['JOINTS_0'], rows['WEIGHTS_0'])]
    return rest


def import_attached_body(lib, canonical_path, candidate_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(canonical_path), merge_vertices=False)
    drop_import_helpers()
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    require(len(arms) == 1, 'canonical armature가 한 개여야 합니다.')
    arm = arms[0]
    arm.data.pose_position = 'REST'
    canonical_rest = bone_snapshot(arm)
    # canonical 몸체를 교정 몸체로 오인하지 않도록 해당 메시를 제거한다. action/armature는 보존한다.
    for mesh in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        require(any(mod.type == 'ARMATURE' and mod.object == arm for mod in mesh.modifiers), '분류되지 않은 canonical 메시')
        bpy.data.objects.remove(mesh, do_unlink=True)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(candidate_path), merge_vertices=False)
    added = set(bpy.context.scene.objects) - before
    body_arms = [o for o in added if o.type == 'ARMATURE']
    require(len(body_arms) == 1, '후보 armature가 한 개여야 합니다.')
    body_arm = body_arms[0]
    body_arm.data.pose_position = 'REST'
    require(not body_arm.animation_data or (not body_arm.animation_data.action and not body_arm.animation_data.nla_tracks), '후보에 실행 action이 있습니다.')
    meshes = [o for o in added if o.type == 'MESH' and any(mod.type == 'ARMATURE' and mod.object == body_arm for mod in o.modifiers)]
    require(len(meshes) == 1, '후보 스킨 메시가 한 개여야 합니다.')
    mesh = meshes[0]
    for extra in [o for o in added if o.type == 'MESH' and o != mesh]:
        require(any(b.custom_shape == extra for b in body_arm.pose.bones), '분류되지 않은 후보 메시')
    drop_import_helpers()
    bpy.context.view_layer.update()
    bones = {lib.canon_name(b.name): b for b in arm.data.bones}
    candidate_bones = {lib.canon_name(b.name): b for b in body_arm.data.bones}
    require(len(bones) == len(candidate_bones) == 65 and set(bones) == set(candidate_bones), '본 identity 불일치')
    maximum_bone_error = 0.
    for name, source in candidate_bones.items():
        target = bones[name]
        require((lib.canon_name(source.parent.name) if source.parent else None)
                == (lib.canon_name(target.parent.name) if target.parent else None), '본 부모 불일치')
        a, b = body_arm.matrix_world @ source.matrix_local, arm.matrix_world @ target.matrix_local
        error = max(abs(a[r][c]-b[r][c]) for r in range(4) for c in range(4))
        maximum_bone_error = max(maximum_bone_error, error)
        require(error <= TOLERANCE, 'canonical/candidate Blender 본 REST 축 불일치: ' + name)
    # 그룹 이름 변경 없이 실제 canonical 본에 대응할 때만 재연결한다.
    require(all(group.name in arm.data.bones for group in mesh.vertex_groups), '정확한 본 이름에 없는 후보 그룹')
    require(len(mesh.modifiers) == 1 and mesh.modifiers[0].type == 'ARMATURE', '단일 armature modifier가 필요합니다.')
    snapshot = mesh_snapshot(mesh)
    world = mesh.matrix_world.copy()
    mesh.parent = arm
    mesh.matrix_world = world
    mesh.modifiers[0].object = arm
    bpy.data.objects.remove(body_arm, do_unlink=True)
    bpy.context.view_layer.update()
    require(mesh_snapshot(mesh) == snapshot, '연결 중 후보 형상·가중치·UV·법선·재질 변경')
    require(bone_snapshot(arm) == canonical_rest, 'canonical 본 REST 변경')
    raw, doc, binary = lib.read_glb(candidate_path)
    rest = candidate_rest(lib, doc, binary)
    rest_validation = parity(lib, [lib.to_blender(p) for p in rest], evaluated_points(mesh))
    feet = {group.index for group in mesh.vertex_groups if lib.is_foot(group.name)}
    require(feet, '발 그룹 없음')
    ankle_bones = [bone for bone in arm.data.bones if lib.canon_name(bone.name) in ['mixamorigLeftFoot', 'mixamorigRightFoot']]
    require(len(ankle_bones) == 2, '좌우 발 본 식별 실패')
    ankle_y = max(lib.from_blender(arm.matrix_world @ bone.head_local).y for bone in ankle_bones)
    foot_ids = [v.index for v in mesh.data.vertices
                if sum(g.weight for g in v.groups if g.group in feet) >= .30
                and lib.from_blender(mesh.matrix_world @ v.co).y < ankle_y+.02]
    require(foot_ids, '발 평가 정점 집합 없음')
    mesh['motion_candidate_body_sha256'] = hashlib.sha256(raw).hexdigest()
    mesh['motion_candidate_body_path'] = str(candidate_path)
    return arm, mesh, foot_ids, {'restValidation': rest_validation, 'maximumBoneRestMatrixError': maximum_bone_error,
                                'actualCandidateAttached': True, 'footVertexCount': len(foot_ids),
                                'footVertices': foot_ids, 'footSelection': 'REST y<max(LeftFoot,RightFoot)+.02 and foot influence>=.30'}, snapshot


def source_track(lib, doc, binary, name):
    animations = [a for a in doc['animations'] if a.get('name') == name]
    require(len(animations) == 1, 'canonical clip identity 오류')
    hips = [i for i, node in enumerate(doc['nodes']) if lib.canon_name(node.get('name', '')) == 'mixamorigHips']
    require(len(hips) == 1, 'canonical Hips identity 오류')
    animation, hips_node = animations[0], hips[0]
    channels = [c for c in animation['channels'] if c['target'].get('node') == hips_node and c['target'].get('path') == 'translation']
    require(len(channels) == 1, 'canonical Hips translation 개수 오류')
    sampler = animation['samplers'][channels[0]['sampler']]
    require(sampler.get('interpolation', 'LINEAR') == 'LINEAR', 'canonical Hips LINEAR가 필요합니다.')
    times = [row[0] for row in lib.read_accessor(doc, binary, sampler['input'])]
    values = lib.read_accessor(doc, binary, sampler['output'])
    require(times[0] == 0 and times[-1] == DURATIONS[name] and len(times) == len(values)
            and all(a < b for a, b in zip(times, times[1:])), 'canonical 시간·크기 오류')
    parents = {child: i for i, node in enumerate(doc['nodes']) for child in node.get('children', [])}
    require(hips_node in parents, 'Hips 부모 없음')
    ancestors, node = [], hips_node
    while node in parents:
        node = parents[node]
        require(node not in ancestors, '부모 cycle')
        ancestors.append(node)
    require(not any(channel['target'].get('node') in ancestors for channel in animation['channels']), '움직이는 Hips 부모는 별도 저작 계약입니다.')
    parent_world = lib.world_nodes(doc)[parents[hips_node]]
    inverse_up = parent_world.to_3x3().inverted() @ Vector((0, 1, 0))
    require(abs(inverse_up.x) < 1e-8 and abs(inverse_up.z) < 1e-8 and parent_world[1][1] > 0
            and abs(parent_world[1][0]) < 1e-7 and abs(parent_world[1][2]) < 1e-7, '부모 world/native Y 축 불일치')
    return times, values, parent_world


def author_clip(lib, motion, doc, binary, arm, mesh, foot_ids, spec):
    name, duration, keys = spec['clip'], DURATIONS[spec['clip']], spec['keysMeters']
    original_times, original_values, parent_world = source_track(lib, doc, binary, name)
    times = list(original_times)
    for time in [i/120 for i in range(round(duration*120)+1)] + [key[0] for key in keys]:
        if not any(abs(time-old) < 1e-7 for old in times):
            times.append(time)
    times.sort()
    require(len(times) <= 1000, '저작 키 수 범위 초과')
    profile = lambda time: profile_value(keys, time)
    gain = parent_world[1][1]
    rows = [runtime_row(original_times, original_values, time) for time in times]
    outputs = [[row[0], f32(row[1] + profile(time)/gain), row[2]] for time, row in zip(times, rows)]
    for time, row, output in zip(times, rows, outputs):
        require(output[0] == row[0] and output[2] == row[2], '출력 native X/Z 변경')
        require(abs((output[1]-row[1])*gain-profile(time)) <= 2e-6, 'Float32 저작 높이 계약 오류')
    arm.data.pose_position = 'POSE'
    hips = [b for b in arm.pose.bones if lib.canon_name(b.name) == 'mixamorigHips']
    require(len(hips) == 1 and not arm.constraints and not hips[0].constraints, 'Hips·constraint 계약 오류')
    hip = hips[0]
    candidates = {}
    if arm.animation_data:
        for track in arm.animation_data.nla_tracks:
            for strip in track.strips:
                action = strip.action
                if action and name in action.name.lower() and 'backward' not in action.name.lower() and 'authored' not in action.name.lower():
                    candidates[action.name] = (action, getattr(strip, 'action_slot', None))
    require(len(candidates) == 1, '실제 canonical action identity가 유일하지 않습니다.')
    source, slot = next(iter(candidates.values()))
    motion.set_action(arm, source, slot)
    path = hip.path_from_id('location')
    hip_curves = [curve for curve in motion.curves(source) if curve.data_path == path]
    require(len(hip_curves) == 3, 'Hips location 세 FCurve 필요')
    fps = bpy.context.scene.render.fps/bpy.context.scene.render.fps_base
    start = min(key.co.x for curve in hip_curves for key in curve.keyframe_points)
    require(abs(max(key.co.x for curve in hip_curves for key in curve.keyframe_points)-start-fps*duration) <= 1e-4, 'action 시간 변환 오류')
    all_sources = {action.name: motion.curve_snapshot(action) for action in bpy.data.actions}
    other_curves, rest_before = motion.curve_snapshot(source, path), bone_snapshot(arm)
    samples, maximum_import_error = [], 0.
    for time, row in zip(times, rows):
        frame = start+time*fps
        bpy.context.scene.frame_set(math.floor(frame), subframe=frame-math.floor(frame))
        bpy.context.view_layer.update()
        actual_world = arm.matrix_world @ hip.matrix.translation
        expected_world = lib.to_blender(parent_world @ Vector(row))
        error = (actual_world-expected_world).length
        maximum_import_error = max(maximum_import_error, error)
        require(error <= TOLERANCE, 'Blender 원본 Hips와 raw canonical 불일치: ' + str((time, error)))
        parent_basis = hip.parent.matrix @ hip.parent.bone.matrix_local.inverted() if hip.parent else Matrix.Identity(4)
        basis_world = arm.matrix_world @ parent_basis @ hip.bone.matrix_local
        local_delta = basis_world.to_3x3().inverted() @ lib.to_blender(Vector((0, profile(time), 0)))
        samples.append((time, frame, hip.location.copy(), local_delta, actual_world.copy()))
    authored = source.copy()
    authored.name = 'Higher_' + spec['profileId'] + '_' + name + '_Authored_v1'
    authored.use_fake_user = True
    motion.set_action(arm, authored, slot)
    for _, frame, location, delta, _ in samples:
        hip.location = location+delta
        hip.keyframe_insert(data_path='location', frame=frame, group=hip.name)
    for curve in motion.curves(authored):
        if curve.data_path == path:
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
    require(motion.curve_snapshot(authored, path) == other_curves, 'Hips.location 외 FCurve 변경')
    errors, endpoints = [], {}
    for time, frame, _, _, baseline_world in samples:
        bpy.context.scene.frame_set(math.floor(frame), subframe=frame-math.floor(frame))
        bpy.context.view_layer.update()
        actual_delta = lib.from_blender(arm.matrix_world @ hip.matrix.translation-baseline_world)
        error = (actual_delta-Vector((0, profile(time), 0))).length
        require(error <= TOLERANCE, '실제 Blender world delta 오차 초과')
        errors.append({'time': time, 'worldDelta': list(actual_delta), 'error': error})
        if time == 0 or time == duration:
            points = evaluated_points(mesh)
            require(len(points) == len(mesh.data.vertices), '평가 메시 topology 변경')
            endpoints[str(time)] = {'footMinY': min(lib.from_blender(points[i]).y for i in foot_ids),
                                    'bodyMinY': min(lib.from_blender(point).y for point in points)}
    for action_name, snapshot in all_sources.items():
        require(motion.curve_snapshot(bpy.data.actions[action_name]) == snapshot, '기존 action 변경: ' + action_name)
    require(bone_snapshot(arm) == rest_before, 'canonical 본 REST 변경')
    begin, end = endpoints['0.0' if '0.0' in endpoints else '0'], endpoints[str(duration)]
    validation = {'supportStartMeters': begin['footMinY'],
                  'supportEndMeters': end['bodyMinY'] if name == 'death' else end['footMinY']}
    if name == 'death':
        validation['deathEndMeters'] = end['bodyMinY']
    override = {'base': {'clip': name, 'duration': duration, 'hipsTrack': 'mixamorigHips.position', 'interpolation': 'LINEAR',
                        'sourceTrackSha256': motion.decoded_track_sha('mixamorigHips.position', original_times, original_values),
                        'times': original_times, 'values': [v for row in original_values for v in row]},
                'outputTrack': {'name': 'mixamorigHips.position', 'type': 'vector', 'interpolation': 'LINEAR',
                                'times': times, 'values': [v for row in outputs for v in row]},
                'authoring': {'profileId': spec['profileId'], 'parentWorldYGain': gain, 'initialOffsetMeters': profile(0),
                              'finalOffsetMeters': profile(duration), 'maxOffsetMeters': max(value for _, value in keys),
                              'artistKeysMeters': keys, 'interpolation': 'SMOOTHSTEP', 'bakeHz': 120,
                              'sourceAction': source.name, 'authoredAction': authored.name,
                              'sourceFrameStart': start, 'sceneFPS': fps, 'parentWorldMatrix': [list(row) for row in parent_world],
                              'maximumImportHipsErrorMeters': maximum_import_error,
                              'maximumAuthoredDeltaErrorMeters': max(item['error'] for item in errors),
                              'fixedProfileNotSkinMinCompensation': True},
                'validation': validation}
    return override, {'clip': name, 'samples': errors, 'endpoints': endpoints,
                      'endpointMetadataWithinRuntimeGate': all(abs(value) <= .02 for value in validation.values()),
                      'otherCurvesExactUnchanged': True, 'allSourceActionsExactUnchanged': True, 'skeletonRestExactUnchanged': True}


def author_body(repo, out, profiles_path, body, lib, motion):
    asset, prefix = body['asset'], TARGETS[body['asset']][1]
    canonical_path = repo / 'public' / body['base']['path'].lstrip('/')
    candidate_path = Path(body['body']['inputPath']).resolve()
    raw, doc, binary = lib.read_glb(canonical_path)
    require(hashlib.sha256(raw).hexdigest() == body['base']['sha256'] and sha(candidate_path) == body['body']['sha256'], '저작 직전 실제 입력 SHA 변경')
    arm, mesh, foot_ids, attachment, mesh_before = import_attached_body(lib, canonical_path, candidate_path)
    overrides, reports = [], []
    for spec in body['clips']:
        override, report = author_clip(lib, motion, doc, binary, arm, mesh, foot_ids, spec)
        overrides.append(override)
        reports.append(report)
    require(mesh_snapshot(mesh) == mesh_before, '저작 중 후보 몸체 형상·가중치·UV·법선·재질 변경')
    bpy.context.scene['motion_asset'] = asset
    bpy.context.scene['motion_candidate_sha256'] = body['body']['sha256']
    bpy.context.scene['motion_profile_sha256'] = sha(profiles_path)
    bpy.context.scene['motion_status'] = 'CANDIDATE_REQUIRES_DENSE_AND_GPU'
    blend_path = out / (prefix + '-body-motion-v1.blend')
    require(not blend_path.exists(), '기존 blend 덮어쓰기 금지')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    packet = {'schema': 'blade-surge.higher-body-motion-packet.v1', 'asset': asset, 'heroId': body['heroId'],
              'revisionId': body['revisionId'], 'body': {key: body['body'][key] for key in ['path', 'sha256']},
              'source': body['source'], 'base': body['base'], 'motionRevisionId': prefix + '-body-motion-v1',
              'clipOverrides': overrides,
              'provenance': {'author': file_record(__file__), 'profiles': file_record(profiles_path), 'blend': file_record(blend_path),
                             'candidateInput': file_record(candidate_path), 'canonicalInput': file_record(canonical_path),
                             'blender': bpy.app.version_string, 'glbHelperSha256': GLB_HELPER_SHA, 'motionHelperSha256': MOTION_HELPER_SHA},
              'attachment': attachment,
              'limitations': ['candidate only; root must run actual 301 samples+all keys direct/swap and GPU review',
                              'endpoint measurements are actual Blender values, not a claim of runtime acceptance',
                              'runtime bundle output.path/SHA is added by root after hashing this independent packet']}
    packet_path = out / (prefix + '-body-motion-v1.json')
    write_new(packet_path, packet)
    report = {'asset': asset, 'packet': file_record(packet_path), 'blend': file_record(blend_path), 'attachment': attachment,
              'clips': reports, 'endpointMetadataWithinRuntimeGate': all(item['endpointMetadataWithinRuntimeGate'] for item in reports),
              'candidateOnly': True, 'sourceBytesUnchanged': sha(canonical_path) == body['base']['sha256'] and sha(candidate_path) == body['body']['sha256']}
    require(report['sourceBytesUnchanged'], '저작 후 입력 GLB SHA 변경')
    write_new(out / (asset + '.motion-author.json'), report)
    print(json.dumps({'event': 'higher-body-motion-authored', 'asset': asset, 'packet': report['packet'],
                      'candidateOnly': True, 'endpointMetadataWithinRuntimeGate': report['endpointMetadataWithinRuntimeGate']}, ensure_ascii=False), flush=True)
    return report


def main(args):
    require(bpy.app.version >= (5, 2, 0), '실제 Blender 5.2 이상이 필요합니다.')
    repo, profiles_path, out = Path(args.repo).resolve(), Path(args.profiles).resolve(), Path(args.out_dir).resolve()
    # 전체 프로필·실제 입력을 먼저 검사한다. 빈 프로필은 .blend/packet 없이 실패 보고서만 남긴다.
    profiles_sha = sha(profiles_path)
    bodies = validate_profiles(repo, profiles_path)
    require(out != repo and repo not in out.parents, '산출물은 저장소 밖 새 디렉터리여야 합니다.')
    require(not out.exists(), '산출물 디렉터리는 새 이름이어야 합니다.')
    require(out not in profiles_path.parents and out not in Path(args.report).resolve().parents, '입력·runner report는 산출물 디렉터리 밖이어야 합니다.')
    lib = import_helper(repo / 'art-src/avatar-fox/author_body_contact_v3.py', GLB_HELPER_SHA, 'readonly_higher_glb')
    motion = import_helper(repo / 'art-src/avatar-fox/author_fox_body_motion_v3.py', MOTION_HELPER_SHA, 'readonly_fox_motion_primitives')
    out.mkdir(parents=True, exist_ok=False)
    reports = [author_body(repo, out, profiles_path, body, lib, motion) for body in bodies]
    require(sha(profiles_path) == profiles_sha, '저작 중 입력 프로필 파일 변경')
    return {'ok': True, 'schema': 'blade-surge.higher-body-motion-author.v1', 'candidateOnly': True,
            'author': file_record(__file__), 'profiles': file_record(profiles_path), 'outDir': str(out), 'bodies': reports}


if __name__ == '__main__':
    args = task_args(build_args)
    report = Path(args.report).resolve()
    require(not report.exists() and report.parent.is_dir(), 'runner report는 기존 부모 안의 새 파일이어야 합니다.')
    require(report != Path(args.profiles).resolve(), 'report가 입력 프로필과 같습니다.')
    require(Path(args.repo).resolve() not in report.parents, 'runner report는 저장소 밖이어야 합니다.')
    run(main, args)
