# fox 접지 v2 후보: 원본 하체 fit + 명시적 팔/손 외피 피팅. 원본 리그/웨이트 불변.
# 사용: blender -b --factory-startup --python-exit-code 1 --python author_body_contact_v2.py -- --input <fox.glb> --reference <t1.glb> --output <patch.json> --blend <candidate.blend> --anchors <anchors.json> --stage fit-arms --target-sole .016
import argparse
import bpy
import hashlib
import json
import math
import struct
import statistics
import sys
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector
from mathutils.kdtree import KDTree

FOX_SHA = 'ec4858d8ad8ae69ef8bb0729b613891120eee33b1d95bb6fef824ece0eb47903'
COMPONENTS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--stage', choices=['fit-arms'], default='fit-arms')
    parser.add_argument('--reference', required=True)
    parser.add_argument('--blend', required=True)
    parser.add_argument('--anchors', required=True)
    parser.add_argument('--target-sole', type=float, default=.016)
    parser.add_argument('--rest-tolerance', type=float, default=.0001)
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:])

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def read_glb(path):
    raw = Path(path).read_bytes()
    require(len(raw) >= 28 and raw[:4] == b'glTF', 'invalid GLB')
    version, length = struct.unpack_from('<II', raw, 4)
    require(version == 2 and length == len(raw), 'GLB length/version mismatch')
    chunks = []
    at = 12
    while at < len(raw):
        size, kind = struct.unpack_from('<II', raw, at)
        require(at + 8 + size <= len(raw), 'GLB chunk truncated')
        chunks.append((kind, raw[at + 8:at + 8 + size]))
        at += 8 + size
    require(len(chunks) == 2 and chunks[0][0] == 0x4E4F534A and chunks[1][0] == 0x004E4942, 'requires JSON+BIN GLB')
    return raw, json.loads(chunks[0][1]), chunks[1][1]

def read_accessor(doc, binary, index):
    accessor = doc['accessors'][index]
    require('sparse' not in accessor, 'sparse accessor unsupported')
    view = doc['bufferViews'][accessor['bufferView']]
    require(view.get('buffer', 0) == 0 and 'EXT_meshopt_compression' not in view.get('extensions', {}), 'compressed/external accessor unsupported')
    fmt, size = COMPONENTS[accessor['componentType']]
    width = WIDTHS[accessor['type']]
    stride = view.get('byteStride', width * size)
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    require(stride >= width * size, 'bad accessor stride')
    rows = []
    for i in range(accessor['count']):
        require(offset + stride * i + width * size <= len(binary), 'accessor exceeds BIN')
        row = list(struct.unpack_from('<' + fmt * width, binary, offset + stride * i))
        if accessor.get('normalized', False):
            kind = accessor['componentType']
            require(kind in [5121, 5123], 'unsupported normalized component')
            denom = 255 if kind == 5121 else 65535
            row = [value / denom for value in row]
        rows.append(row)
    return rows

def column_matrix(values):
    return Matrix([[values[col * 4 + row] for col in range(4)] for row in range(4)])

def node_matrix(node):
    if 'matrix' in node:
        return column_matrix(node['matrix'])
    t = Matrix.Translation(Vector(node.get('translation', [0, 0, 0])))
    q = node.get('rotation', [0, 0, 0, 1])
    r = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
    scale = node.get('scale', [1, 1, 1])
    s = Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1)))
    return t @ r @ s

def world_nodes(doc):
    parents = {}
    for i, node in enumerate(doc['nodes']):
        for child in node.get('children', []):
            require(child not in parents, 'node has multiple parents')
            parents[child] = i
    cache = {}
    visiting = set()
    def world(index):
        if index in cache:
            return cache[index]
        require(index not in visiting, 'node cycle')
        visiting.add(index)
        local = node_matrix(doc['nodes'][index])
        cache[index] = world(parents[index]) @ local if index in parents else local
        visiting.remove(index)
        return cache[index]
    return [world(i) for i in range(len(doc['nodes']))]

def weighted_matrix(joints, weights, matrices):
    result = Matrix(((0., 0., 0., 0.), (0., 0., 0., 0.), (0., 0., 0., 0.), (0., 0., 0., 0.)))
    for joint, weight in zip(joints, weights):
        if weight:
            result += matrices[joint] * weight
    return result

def skin_world(position, joints, weights, matrices):
    value = weighted_matrix(joints, weights, matrices) @ Vector((*position, 1))
    return Vector(value[:3])

def to_blender(value):
    return Vector((value[0], -value[2], value[1]))

def from_blender(value):
    return Vector((value[0], value[2], -value[1]))

def canon_name(name):
    return name.replace(':', '').replace('_', '')

def leg_side(name):
    name = canon_name(name)
    for side in ['Left', 'Right']:
        if name.startswith('mixamorig' + side):
            suffix = name[len('mixamorig' + side):]
            if suffix in ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'ToeEnd', 'ToeBaseEnd']:
                return side
    return None

def is_foot(name):
    name = canon_name(name)
    return any(name == 'mixamorig' + side + suffix for side in ['Left', 'Right'] for suffix in ['Foot', 'ToeBase', 'ToeEnd', 'ToeBaseEnd'])

def nearest_error(points, reference):
    require(len(points) > 0 and len(reference) > 0, 'empty comparison mesh')
    tree = KDTree(len(reference))
    for i, point in enumerate(reference):
        tree.insert(point, i)
    tree.balance()
    maximum = 0.
    worst = None
    for i, point in enumerate(points):
        co, index, distance = tree.find(point)
        if distance > maximum:
            maximum, worst = distance, {'vertex': i, 'nearest': index, 'distance': distance}
    return {'maximum': maximum, 'worst': worst}

T1_SHA = '2c88389c285019a4b2b0e948736f6f01b1a1a173f28b2dcac054981b45e99b23'
FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']

def smooth(value):
    value = max(0., min(1., value))
    return value * value * (3 - 2 * value)

def arm_suffix(name, side):
    prefix = 'mixamorig' + side
    value = canon_name(name)
    return value[len(prefix):] if value.startswith(prefix) else ''

def arm_mass(names, js, ws, side):
    return sum(w for j, w in zip(js, ws) if arm_suffix(names[j], side) in ['Arm', 'ForeArm'] or arm_suffix(names[j], side).startswith('Hand'))

def protected_mass(names, js, ws):
    return sum(w for j, w in zip(js, ws) if any(part in canon_name(names[j]) for part in ['Spine', 'Neck', 'Head']))

def reference_data(path):
    raw, doc, binary = read_glb(path)
    require(hashlib.sha256(raw).hexdigest() == T1_SHA, 'exact canonical t1 SHA mismatch')
    nodes = [(i, n) for i, n in enumerate(doc['nodes']) if 'mesh' in n and 'skin' in n]
    require(len(nodes) == 1, 'reference must contain one skinned mesh')
    _, node = nodes[0]
    primitives = doc['meshes'][node['mesh']]['primitives']
    require(len(primitives) == 1, 'reference primitive count mismatch')
    attrs = primitives[0]['attributes']
    positions, joints, weights = [read_accessor(doc, binary, attrs[k]) for k in ['POSITION', 'JOINTS_0', 'WEIGHTS_0']]
    skin = doc['skins'][node['skin']]
    world = world_nodes(doc)
    inverse = read_accessor(doc, binary, skin['inverseBindMatrices'])
    names = [doc['nodes'][i].get('name', '') for i in skin['joints']]
    matrices = [world[i] @ column_matrix(m) for i, m in zip(skin['joints'], inverse)]
    points = [skin_world(p, j, w, matrices) for p, j, w in zip(positions, joints, weights)]
    return points, joints, weights, names

def anchors_for(points, joints, weights, names, side):
    sign = 1 if side == 'Left' else -1
    def mass(i, group):
        return sum(w for j, w in zip(joints[i], weights[i]) if arm_suffix(names[j], side) == group or (group == 'Hand' and arm_suffix(names[j], side).startswith('Hand')))
    result = {}
    for label, group_a, group_b in [('elbow', 'Arm', 'ForeArm'), ('wrist', 'ForeArm', 'Hand')]:
        ids = [i for i in range(len(points)) if mass(i, group_a) >= .15 and mass(i, group_b) >= .15]
        require(len(ids) >= 8, 'insufficient adjacent-group anchor: ' + side + label)
        products = [mass(i, group_a) * mass(i, group_b) for i in ids]
        center = sum((points[i] * w for i, w in zip(ids, products)), Vector()) / sum(products)
        result[label] = {'point': list(center), 'vertices': ids, 'products': products, 'rule': 'adjacent group masses >=.15; center weighted by wA*wB'}
    for finger in FINGERS:
        ids = [i for i in range(len(points)) if sum(w for j, w in zip(joints[i], weights[i]) if arm_suffix(names[j], side).startswith('Hand' + finger)) >= .5]
        require(len(ids) >= 3, 'missing finger anchor: ' + side + finger)
        ordered = sorted(ids, key=lambda i: sign * points[i].x)
        tip_ids = ordered[max(0, int(len(ordered) * .95)):]
        # 길이는 원위 최대, y/z는 동일 원위 표본 중앙값. 전체 Hand 중앙값은 사용하지 않는다.
        point = [points[ordered[-1]].x, statistics.median(points[i].y for i in tip_ids), statistics.median(points[i].z for i in tip_ids)]
        result[finger] = {'point': point, 'vertices': tip_ids, 'maximumVertex': ordered[-1], 'rule': 'finger mass>=.5; maximal signed x; distal top5% median y/z'}
    return result

def pchip_slopes(xs, ys):
    h = [b-a for a, b in zip(xs, xs[1:])]
    require(all(v > 1e-5 for v in h), 'anchor x order invalid')
    d = [(b-a)/step for a, b, step in zip(ys, ys[1:], h)]
    result = [d[0]]
    for i in range(1, len(xs)-1):
        if d[i-1]*d[i] <= 0:
            result.append(0.)
        else:
            a, b = 2*h[i]+h[i-1], h[i]+2*h[i-1]
            result.append((a+b)/(a/d[i-1]+b/d[i]))
    result.append(d[-1])
    return result

def hermite(xs, ys, slopes, x):
    if x <= xs[0]:
        return ys[0] + slopes[0]*(x-xs[0])
    if x >= xs[-1]:
        return ys[-1] + slopes[-1]*(x-xs[-1])
    i = next(i for i in range(len(xs)-1) if x <= xs[i+1])
    h = xs[i+1]-xs[i]
    t = (x-xs[i])/h
    return (2*t**3-3*t*t+1)*ys[i] + (t**3-2*t*t+t)*h*slopes[i] + (-2*t**3+3*t*t)*ys[i+1] + (t**3-t*t)*h*slopes[i+1]

def build_arm_fit(old_world, joints, weights, names, world, skin, doc, reference):
    ref_points, ref_joints, ref_weights, ref_names = reference
    records, curves = {}, {}
    for side in ['Left', 'Right']:
        sign = 1 if side == 'Left' else -1
        source = anchors_for(old_world, joints, weights, names, side)
        target = anchors_for(ref_points, ref_joints, ref_weights, ref_names, side)
        arm_node = next(i for i in skin['joints'] if canon_name(doc['nodes'][i].get('name', '')) == 'mixamorig'+side+'Arm')
        start = abs(world[arm_node].translation.x)
        require(.1 < start < .32, 'shoulder identity anchor outside expected range')
        common_x = [start, sign*source['elbow']['point'][0], sign*source['wrist']['point'][0]]
        common_y = [start, sign*target['elbow']['point'][0], sign*target['wrist']['point'][0]]
        base_x = common_x + [sign*source['Middle']['point'][0]]
        base_y = common_y + [sign*target['Middle']['point'][0]]
        base_slopes = pchip_slopes(base_x, base_y)
        base_slopes[0] = 1.
        channels = {}
        for axis in [1, 2]:
            vals = [0.] + [target[k]['point'][axis]-source[k]['point'][axis] for k in ['elbow', 'wrist', 'Middle']]
            slopes = pchip_slopes(base_x, vals)
            slopes[0] = 0.
            channels[axis] = (vals, slopes)
        curves[side] = {}
        for finger in FINGERS:
            xs = common_x + [sign*source[finger]['point'][0]]
            ys = common_y + [sign*target[finger]['point'][0]]
            secant = (ys[-1]-ys[-2])/(xs[-1]-xs[-2])
            slopes = base_slopes[:3] + [secant]
            require(secant > .05 and slopes[2] < 3*secant, 'nonmonotone distal anchor slope')
            # 공통 shoulder/elbow/wrist 값과 도함수를 사용하여 손가락 혼합 경계도 C1이다.
            records_for_axes = [(xs, ys, slopes)]
            for axis in [1, 2]:
                vals, shared_slopes = channels[axis]
                values = vals[:3] + [target[finger]['point'][axis]-source[finger]['point'][axis]]
                records_for_axes.append((xs, values, shared_slopes[:3]+[0.]))
            for sample in range(301):
                x = start+(xs[-1]-start)*sample/300
                derivative = (hermite(xs, ys, slopes, x+1e-5)-hermite(xs, ys, slopes, x-1e-5))/2e-5
                require(derivative > .05, 'arm x Hermite derivative collapsed')
            curves[side][finger] = records_for_axes
        protected_ids = [i for i, point in enumerate(old_world) if arm_mass(names, joints[i], weights[i], side) > .5 and protected_mass(names, joints[i], weights[i]) > 1e-8]
        protected_stop = max([start] + [abs(old_world[i].x) for i in protected_ids]) + .005
        fade_end = abs(source['wrist']['point'][0])
        require(protected_stop + .15 < fade_end, 'insufficient protected shoulder fade length')
        records[side] = {'identityStart': start, 'protectedFadeStart': protected_stop, 'protectedFadeEnd': fade_end,
            'protectedVertices': protected_ids, 'source': source, 'target': target, 'curves': curves[side]}
    def deform(i, before):
        side = 'Left' if before.x > 0 else 'Right'
        mass = arm_mass(names, joints[i], weights[i], side)
        if protected_mass(names, joints[i], weights[i]) > 1e-8 or mass <= .5 or abs(before.x) <= records[side]['protectedFadeStart'] or before.y < .86:
            return before.copy(), None
        spatial_mask = smooth((abs(before.x)-records[side]['protectedFadeStart'])/(records[side]['protectedFadeEnd']-records[side]['protectedFadeStart']))
        mask = smooth((mass-.5)/.5) * spatial_mask
        finger_weights = {finger: sum(w for j, w in zip(joints[i], weights[i]) if arm_suffix(names[j], side).startswith('Hand'+finger)) for finger in FINGERS}
        finger_weights['Middle'] += max(0., 1-sum(finger_weights.values()))
        sign = 1 if side == 'Left' else -1
        x = sign*before.x
        mapped = Vector()
        for finger, weight in finger_weights.items():
            if not weight:
                continue
            cx, cy, cz = curves[side][finger]
            mapped += Vector((sign*hermite(*cx, x), before.y+hermite(*cy, x), before.z+hermite(*cz, x))) * weight
        after = before.lerp(mapped, mask)
        return after, {'region': 'arm-hand', 'side': side, 'armMass': mass, 'mask': mask, 'spatialMask': spatial_mask, 'protectedMass': 0., 'jointNames': [names[j] for j in joints[i]]}
    return deform, records

def corrected_normals(positions, final_positions, normals, faces, changed_ids, eligible_ids, joints, weights, bone_names):
    # 같은 위치+원본 normal만 묶는다. UV seam은 평활화를 공유하고 hard normal seam은 분리한다.
    keys = [tuple(round(v, 7) for v in list(p)+list(n)) for p, n in zip(positions, normals)]
    group_old, group_new, touched_keys = {}, {}, set()
    affected_faces = []
    minimum_ratio, minimum_dot = float('inf'), 1.
    for face_id, face in enumerate(faces):
        a,b,c = [Vector(positions[i]) for i in face]
        aa,bb,cc = [Vector(final_positions[i]) for i in face]
        old, new = (b-a).cross(c-a), (bb-aa).cross(cc-aa)
        changed = any(i in changed_ids for i in face)
        if changed:
            affected_faces.append(face_id)
            touched_keys.update(keys[i] for i in face)
            if old.length > 1e-10:
                ratio = new.length/old.length
                dot = old.normalized().dot(new.normalized()) if new.length else -1.
                if not (.03 < ratio < 25 and dot > 0.):
                    print(json.dumps({'event':'body-contact-triangle-rejected', 'triangle': face_id, 'areaRatio': ratio, 'oldNewNormalDot': dot,
                        'oldAreaVector':list(old), 'newAreaVector':list(new), 'vertices':[{'vertex':i,'old':positions[i],'new':final_positions[i],
                        'jointNames':[bone_names[j] for j in joints[i]],'weights':weights[i], 'positionChanged':i in changed_ids, 'normalEligible':i in eligible_ids} for i in face]}, ensure_ascii=False), flush=True)
                require(.03 < ratio < 25 and dot > 0., 'triangle collapse/flip: '+str(face_id))
                minimum_ratio, minimum_dot = min(minimum_ratio, ratio), min(minimum_dot, dot)
        for i in face:
            key = keys[i]
            group_old[key] = group_old.get(key, Vector())+old
            group_new[key] = group_new.get(key, Vector())+new
    rows = []
    for i, (normal, key) in enumerate(zip(normals, keys)):
        if key not in touched_keys or i not in eligible_ids:
            continue
        old, new = group_old[key], group_new[key]
        if min(old.length, new.length) <= 1e-10:
            continue
        rotation = old.normalized().rotation_difference(new.normalized())
        value = (rotation @ Vector(normal)).normalized()
        if (value-Vector(normal)).length > 1e-7:
            rows.append({'vertex': i, 'old': normal, 'new': list(value), 'method': 'original-normal rotated by old/new area-weighted seam-group geometric normal'})
    return rows, {'affectedTriangles': affected_faces, 'minimumAreaRatio': minimum_ratio, 'minimumOldNewNormalDot': minimum_dot, 'groupRule': 'original POSITION and NORMAL rounded to 1e-7; original hard seams stay separate'}


def main():
    args = parse_args()
    input_path, output_path = Path(args.input).resolve(), Path(args.output).resolve()
    require(all(not Path(p).exists() for p in [args.output, args.blend, args.anchors]), 'output/blend/anchors already exists')
    require(len({str(Path(p).resolve()) for p in [args.input, args.reference, args.output, args.blend, args.anchors]}) == 5, 'input/output paths overlap')
    require(bpy.app.version >= (5, 2, 0), 'requires actual Blender 5.2+')
    require(0 <= args.target_sole <= .02, 'target sole outside candidate range')
    require(0 < args.rest_tolerance <= .0001, 'rest tolerance outside supported range')
    raw, doc, binary = read_glb(input_path)
    source_sha = hashlib.sha256(raw).hexdigest()
    require(source_sha == FOX_SHA, 'only exact original avatar_ranger_fox is authorized')
    require(not doc.get('animations'), 'candidate must remain mesh-only')
    nodes = [(i, node) for i, node in enumerate(doc['nodes']) if 'mesh' in node]
    require(len(nodes) == 1, 'requires one mesh node')
    node_index, mesh_node = nodes[0]
    require('skin' in mesh_node, 'mesh is not skinned')
    primitives = doc['meshes'][mesh_node['mesh']]['primitives']
    require(len(primitives) == 1, 'requires one primitive')
    primitive = primitives[0]
    require(primitive.get('mode', 4) == 4 and not primitive.get('targets'), 'requires triangles without morphs')
    require(not primitive.get('extensions'), 'compressed primitive unsupported')
    attributes = primitive['attributes']
    require('JOINTS_1' not in attributes and 'WEIGHTS_1' not in attributes, 'more than four influences unsupported')
    position_id, joints_id, weights_id = (attributes[k] for k in ['POSITION', 'JOINTS_0', 'WEIGHTS_0'])
    require(doc['accessors'][position_id]['componentType'] == 5126, 'POSITION must be float32')
    positions = read_accessor(doc, binary, position_id)
    joints = read_accessor(doc, binary, joints_id)
    weights = read_accessor(doc, binary, weights_id)
    require(len(positions) == len(joints) == len(weights), 'attribute count mismatch')
    normal_id = attributes['NORMAL']
    normals = read_accessor(doc, binary, normal_id)
    require(doc['accessors'][normal_id]['componentType'] == 5126 and 'TANGENT' not in attributes, 'requires float normals and no stored tangents')
    require(len(normals) == len(positions), 'normal count mismatch')
    require(all(len(w) == 4 and abs(sum(w) - 1) < .001 for w in weights), 'weights are not normalized VEC4')
    skin = doc['skins'][mesh_node['skin']]
    world = world_nodes(doc)
    inverse = read_accessor(doc, binary, skin['inverseBindMatrices'])
    require(len(inverse) == len(skin['joints']), 'inverse bind count mismatch')
    bone_names = [doc['nodes'][i].get('name', '') for i in skin['joints']]
    matrices = [world[i] @ column_matrix(ibm) for i, ibm in zip(skin['joints'], inverse)]
    require(all(0 <= index < len(matrices) for row in joints for index in row), 'joint index out of range')
    hips_index = next(i for i in skin['joints'] if canon_name(doc['nodes'][i].get('name', '')) == 'mixamorigHips')
    hips_y = world[hips_index].translation.y
    feet_nodes = {side: next(i for i in skin['joints'] if canon_name(doc['nodes'][i].get('name', '')) == 'mixamorig' + side + 'Foot') for side in ['Left', 'Right']}
    ankle_y = max(world[i].translation.y for i in feet_nodes.values())
    center_x = sum(world[i].translation.x for i in feet_nodes.values()) / 2
    require(world[feet_nodes['Left']].translation.x > world[feet_nodes['Right']].translation.x, 'unexpected side axis')
    old_world = [skin_world(p, j, w, matrices) for p, j, w in zip(positions, joints, weights)]
    foot_mass = [sum(w for j, w in zip(js, ws) if is_foot(bone_names[j])) for js, ws in zip(joints, weights)]
    foot_ids = [i for i, p in enumerate(old_world) if p.y < ankle_y + .02 and foot_mass[i] >= .30]
    require(foot_ids, 'no foot patch')
    sole = min(old_world[i].y for i in foot_ids)
    require(-.33 < sole < -.28 and .80 < hips_y < .88, 'fox landmark baseline mismatch')

    # 공식 Blender importer의 평가 REST와 자체 GLB 스킨 식을 양방향 대조한다.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(input_path), merge_vertices=False)
    imported_meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    imported_arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    source_identity = {'nodeIndex': node_index, 'nodeName': mesh_node.get('name'),
        'meshIndex': mesh_node['mesh'], 'meshName': doc['meshes'][mesh_node['mesh']].get('name'),
        'skinIndex': mesh_node['skin'], 'sourceVertexCount': len(positions)}
    source_names = {name for name in [source_identity['nodeName'], source_identity['meshName']] if name}
    import_metadata, imported, unknown = [], [], []
    for mesh in imported_meshes:
        arm_modifiers = [mod for mod in mesh.modifiers if mod.type == 'ARMATURE']
        rigged = any(mod.object in imported_arms for mod in arm_modifiers)
        identity_match = mesh.name in source_names or mesh.data.name in source_names
        custom_shape_owners = [arm.name + '/' + bone.name for arm in imported_arms for bone in arm.pose.bones
            if bone.custom_shape == mesh]
        found_arm = mesh.find_armature()
        selected = identity_match and rigged
        # helper는 본의 custom_shape로 실제 참조되는 경우만 인정한다. 가시성만으로 버리지 않는다.
        helper = not identity_match and not rigged and bool(custom_shape_owners)
        metadata = {'name': mesh.name, 'dataName': mesh.data.name, 'vertexCount': len(mesh.data.vertices),
            'sourceIdentityMatch': identity_match, 'armatureModifierMatch': rigged,
            'findArmature': found_arm.name if found_arm else None,
            'modifiers': [{'name': mod.name, 'type': mod.type,
                'object': getattr(getattr(mod, 'object', None), 'name', None),
                'showViewport': mod.show_viewport, 'showRender': mod.show_render} for mod in mesh.modifiers],
            'hideRender': mesh.hide_render, 'hideViewport': mesh.hide_viewport, 'hideGet': mesh.hide_get(),
            'collections': [collection.name for collection in mesh.users_collection],
            'customShapeOwners': custom_shape_owners, 'selectedBody': selected, 'recognizedHelper': helper}
        import_metadata.append(metadata)
        if selected:
            imported.append(mesh)
        elif not helper:
            unknown.append(mesh.name)
    print(json.dumps({'event': 'body-contact-import-identity', 'source': source_identity,
        'armatures': [{'name': arm.name, 'boneCount': len(arm.data.bones)} for arm in imported_arms],
        'meshes': import_metadata, 'unknownMeshes': unknown}, ensure_ascii=False), flush=True)
    require(source_names, 'source GLB has no mesh/node name for identity verification')
    require(len(imported) == 1, 'expected exactly one source-identity + Armature-modifier body')
    require(not unknown, 'unclassified imported mesh; refusing to exclude geometry: ' + str(unknown))
    for arm in imported_arms:
        arm.data.pose_position = 'REST'
        if arm.animation_data:
            arm.animation_data_clear()
    bpy.context.view_layer.update()
    evaluated_points = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for mesh in imported:
        evaluated = mesh.evaluated_get(depsgraph)
        data = evaluated.to_mesh()
        evaluated_points.extend(evaluated.matrix_world @ vertex.co for vertex in data.vertices)
        evaluated.to_mesh_clear()
    expected_points = [to_blender(p) for p in old_world]
    a = nearest_error(expected_points, evaluated_points)
    b = nearest_error(evaluated_points, expected_points)
    print(json.dumps({'event': 'body-contact-rest-parity', 'sourceVertexCount': len(expected_points),
        'selectedBodyVertexCount': len(evaluated_points), 'tolerance': args.rest_tolerance,
        'sourceToBlender': a, 'blenderToSource': b}, ensure_ascii=False), flush=True)
    require(max(a['maximum'], b['maximum']) <= args.rest_tolerance, 'Blender import REST differs from source skin formula: ' + str((a, b)))

    # 편집 mesh는 원본 accessor 순서를 직접 유지한다. importer의 병합/분할 인덱스에 의존하지 않는다.
    if 'indices' in primitive:
        flat_indices = [row[0] for row in read_accessor(doc, binary, primitive['indices'])]
    else:
        flat_indices = list(range(len(positions)))
    require(len(flat_indices) % 3 == 0, 'triangle indices invalid')
    faces = [tuple(flat_indices[i:i + 3]) for i in range(0, len(flat_indices), 3)]
    require(all(0 <= i < len(positions) for i in flat_indices), 'triangle index out of range')
    authored_data = bpy.data.meshes.new('FoxContactCanonicalIndexMesh')
    authored_data.from_pydata(expected_points, [], faces)
    authored = bpy.data.objects.new('FoxContactCanonicalIndexMesh', authored_data)
    bpy.context.scene.collection.objects.link(authored)
    ids = authored_data.attributes.new('source_vertex_id', 'INT', 'POINT')
    require(len(authored_data.vertices) == len(positions), 'canonical vertex count changed')
    for i, vertex in enumerate(authored_data.vertices):
        ids.data[i].value = i
        require((vertex.co - expected_points[i]).length <= 1e-7, 'canonical vertex coordinate mismatch')

    reference = reference_data(Path(args.reference))
    deform_arm, anchor_records = build_arm_fit(old_world, joints, weights, bone_names, world, skin, doc, reference)
    final_raw = [list(p) for p in positions]
    final_world = [p.copy() for p in old_world]
    eligible_ids = set()
    foot_id_set = set(foot_ids)
    position_changes, weight_changes = [], []
    maximum_world_move = 0.
    maximum_raw_move = 0.
    fixed_upper_count = 0
    for i, vertex in enumerate(authored_data.vertices):
        require(ids.data[i].value == i, 'source vertex ID lost')
        before = old_world[i]
        after = before.copy()
        new_weights = list(weights[i])
        region = {'region': 'lower'}
        arm_after, arm_region = deform_arm(i, before)
        if arm_region:
            after = arm_after
            require((after-before).length < .30, 'arm displacement exceeds .30m')
            region = arm_region
            eligible_ids.add(i)
        # 골반 및 그 위는 고정. 발끝/골반에서 기울기 1인 연속 변위로 하체만 맞춘다.
        if before.y < hips_y:
            require(not arm_region, 'arm/lower regions overlap')
            eligible_ids.add(i)
            u = max(0., min(1., (before.y - sole) / (hips_y - sole)))
            smooth = u * u * (3 - 2 * u)
            after.y += (args.target_sole - sole) * (1 - smooth)
        elif not arm_region:
            fixed_upper_count += 1
        if args.stage == 'fit-cross' and i in foot_id_set:
            side = 'Left' if before.x > center_x + .02 else 'Right' if before.x < center_x - .02 else None
            side_mass = sum(w for j, w in zip(joints[i], weights[i]) if leg_side(bone_names[j]) == side) if side else 0
            if side and side_mass > .5:
                opposite = 'Right' if side == 'Left' else 'Left'
                removed = sum(w for j, w in zip(joints[i], weights[i]) if leg_side(bone_names[j]) == opposite)
                if removed > 1e-8:
                    new_weights = [0. if leg_side(bone_names[j]) == opposite else w for j, w in zip(joints[i], weights[i])]
                    total = sum(new_weights)
                    require(total > .5, 'cross-side removal leaves insufficient weights')
                    new_weights = [w / total for w in new_weights]
                    weight_changes.append({'vertex': i, 'old': weights[i], 'new': new_weights,
                        'jointNames': [bone_names[j] for j in joints[i]], 'side': side, 'removed': removed})
        vertex.co = to_blender(after)
        moved = (after - before).length
        if moved > 1e-10 or new_weights != weights[i]:
            skin_matrix = weighted_matrix(joints[i], new_weights, matrices)
            require(abs(skin_matrix.determinant()) > 1e-10, 'singular rest skin matrix')
            raw_new = skin_matrix.inverted() @ Vector((*after, 1))
            raw_new = list(raw_new[:3])
            roundtrip = skin_world(raw_new, joints[i], new_weights, matrices)
            require((roundtrip - after).length < 2e-6, 'POSITION rest roundtrip mismatch')
            raw_distance = (Vector(raw_new) - Vector(positions[i])).length
            if raw_distance > 1e-10:
                require(before.y < hips_y or arm_region, 'POSITION outside lower/explicit arm patch')
                position_changes.append({'vertex': i, 'old': positions[i], 'new': raw_new,
                    'restWorldBefore': list(before), 'restWorldAfter': list(after), **region})
                final_raw[i] = raw_new
                final_world[i] = after.copy()
                maximum_raw_move = max(maximum_raw_move, raw_distance)
            maximum_world_move = max(maximum_world_move, moved)

    require(position_changes, 'empty position candidate')
    require(not weight_changes, 'v2 first candidate preserves every weight')
    normal_changes, triangle_report = corrected_normals(positions, final_raw, normals, faces, {r['vertex'] for r in position_changes}, eligible_ids, joints, weights, bone_names)
    require(normal_changes, 'empty corrected normal patch')
    require(args.stage != 'fit-cross' or weight_changes, 'fit-cross candidate removed no cross-side weights')
    require(maximum_world_move < .33, 'candidate displacement exceeds bounded repair')
    # 패커가 성분 타입에 맞춰 양자화한다. geometry/UV/normal/이미지/본을 GLB 재수출하지 않는다.
    result = {
        'schema': 'blade-surge.body-contact-patch.v2', 'ok': True,
        'asset': 'avatar_ranger_fox', 'stage': args.stage,
        'reference': {'path': str(Path(args.reference).resolve()), 'sha256': T1_SHA},
        'armFit': {'anchors': anchor_records, 'method': 'shared C1 cubic Hermite shoulder/elbow/wrist; monotone PCHIP slopes; finger-specific distal endpoints; smooth influence mask plus protected-shoulder spatial fade; protected Spine/Neck/Head exact-fixed'},
        'normalFit': triangle_report,
        'source': {'path': str(input_path), 'sha256': source_sha, 'bytes': len(raw)},
        'authoring': {'blender': bpy.app.version_string, 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
        'primitive': {'node': node_index, 'mesh': mesh_node['mesh'], 'primitive': 0,
            'normalAccessor': normal_id, 'positionAccessor': position_id, 'jointsAccessor': joints_id, 'weightsAccessor': weights_id, 'vertexCount': len(positions)},
        'restValidation': {'tolerance': args.rest_tolerance, 'sourceToBlender': a, 'blenderToSource': b,
            'sourceVertices': len(positions), 'importedVertices': len(evaluated_points),
            'sourceIdentity': source_identity, 'importedMeshes': import_metadata,
            'canonicalIndexAttribute': 'source_vertex_id', 'mapping': 'direct accessor-order canonical mesh; Blender-import geometric parity checked bidirectionally'},
        'fit': {'space': 'evaluated glTF rest world, Y-up', 'formula': 'y + (targetSole-sourceSole)*(1-smoothstep(clamp((y-sourceSole)/(hips-sourceSole)))) for y<hips',
            'sourceSole': sole, 'targetSole': args.target_sole, 'v2SoleRangeExtension': 'explicit [0,.02]m; v1 [0,.01]m unchanged; support target abs<=.02 retained', 'hips': hips_y,
            'footRegionCount': len(foot_ids), 'footCriterion': 'restY<maxFootBoneY+.02 and Foot/Toe mass>=.30',
            'weightRule': 'all original WEIGHTS_0 unchanged; fit-cross not combined',
            'fixedUpperVertices': fixed_upper_count, 'maximumWorldDisplacement': maximum_world_move, 'maximumRawDisplacement': maximum_raw_move},
        'changes': {'positions': position_changes, 'weights': weight_changes, 'normals': normal_changes},
        'preserved': ['source GLB', 'JOINTS_0', 'WEIGHTS_0', 'indices', 'UV', 'TANGENT', 'textures', 'materials', 'nodes', 'skins', 'animations', 'POSITION outside explicit lower/arm patch', 'head/neck/spine POSITION'],
        'limitations': ['fit candidate requires numeric+visual review', 'local normals use seam-preserving geometric rotation; visual shading review pending', 'cape weights unchanged', 'no whole-body transfer', 'no runtime compensation'],
    }
    # 원본 importer 몸체만 실제 수정하고 원래 리그/재질/UV를 .blend에 보존한다.
    # REST armature가 identity인 것을 수정 전후 평가 좌표로 검사하며 임의로 가정하지 않는다.
    tree = KDTree(len(expected_points))
    for i, point in enumerate(expected_points):
        tree.insert(point, i)
    tree.balance()
    actual_body = imported[0]
    require(len(actual_body.data.vertices) == len(expected_points), 'blend body vertex count differs')
    mapping = []
    for vertex in actual_body.data.vertices:
        point = actual_body.matrix_world @ vertex.co
        nearest, source_id, error = tree.find(point)
        require(error <= args.rest_tolerance, 'blend unevaluated REST differs from evaluated source')
        neighbors = tree.find_range(point, max(1e-6, error+1e-7))
        require(all((final_world[j]-final_world[source_id]).length < 2e-5 for _, j, _ in neighbors), 'ambiguous source mapping has different fitted positions')
        mapping.append(source_id)
    inverse_object = actual_body.matrix_world.inverted()
    for vertex, source_id in zip(actual_body.data.vertices, mapping):
        vertex.co = inverse_object @ to_blender(final_world[source_id])
    source_ids = actual_body.data.attributes.get('source_vertex_id') or actual_body.data.attributes.new('source_vertex_id', 'INT', 'POINT')
    for i, source_id in enumerate(mapping):
        source_ids.data[i].value = source_id
    actual_body.data.update()
    bpy.data.objects.remove(authored, do_unlink=True)
    bpy.context.view_layer.update()
    evaluated = actual_body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    check_mesh = evaluated.to_mesh()
    check_points = [evaluated.matrix_world @ v.co for v in check_mesh.vertices]
    evaluated.to_mesh_clear()
    final_expected = [to_blender(p) for p in final_world]
    forward, reverse = nearest_error(final_expected, check_points), nearest_error(check_points, final_expected)
    require(max(forward['maximum'], reverse['maximum']) <= args.rest_tolerance, 'authored blend REST parity failed')
    result['blendValidation'] = {'sourceToBlend': forward, 'blendToSource': reverse, 'path': str(Path(args.blend).resolve()), 'originalImportedRigMaterialsUVPreserved': True, 'normals': 'Blender imported mesh normals are recalculated for editing; GLB custom normals use explicit seam-preserving patch'}
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.blend).resolve()))
    result['blendValidation']['sha256'] = hashlib.sha256(Path(args.blend).read_bytes()).hexdigest()
    Path(args.anchors).write_text(json.dumps({'schema':'blade-surge.arm-anchors.v2', 'sourceSha256': source_sha, 'referenceSha256': T1_SHA, 'space':'evaluated glTF rest-world Y-up', 'sides': anchor_records}, ensure_ascii=False, indent=2), encoding='utf-8')
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'output': str(output_path), 'stage': args.stage,
        'positions': len(position_changes), 'weights': len(weight_changes), 'normals': len(normal_changes),
        'restMaximum': max(a['maximum'], b['maximum']), 'maxWorldMove': maximum_world_move}))

if __name__ == '__main__':
    # foot patch 집합은 main 안에서만 생성한다.
    main()
