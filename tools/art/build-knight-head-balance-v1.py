"""Blender 5.2.1 소스 제작안이며, 실제 제작은 ROOT가 별도로 승인한다.

동결 원본을 decode-knight-head-balance-v1.mjs로 새 제외 디렉터리에 디코딩한다.
이후 Blender --background --factory-startup --threads 1 --python-exit-code 1
--python tools/art/build-knight-head-balance-v1.py -- --input <head-input.json>
--output <새 제외 디렉터리>로 제작하며 렌더·원본 덮어쓰기·자동 편입은 하지 않는다.
원본 기본 모델의 바이너리에 POSITION/NORMAL만 추가하고 리그·클립은 보존한다.
"""
import argparse
import copy
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path

import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / 'src/data/knight-head-balance-v1.json'
assert bpy.app.version[:3] == (5, 2, 1), 'Blender 5.2.1 LTS required'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unpack(data):
    assert struct.unpack_from('<III', data) == (0x46546C67, 2, len(data))
    length, tag = struct.unpack_from('<II', data, 12)
    assert tag == 0x4E4F534A
    binary_length, binary_tag = struct.unpack_from('<II', data, 20 + length)
    assert binary_tag == 0x004E4942
    doc = json.loads(data[20:20 + length])
    binary = data[28 + length:28 + length + binary_length]
    assert len(binary) == binary_length and doc['buffers'][0]['byteLength'] <= len(binary)
    return doc, binary


def pack(doc, binary):
    encoded = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    return (struct.pack('<IIIII', 0x46546C67, 2, 28 + len(encoded) + len(binary), len(encoded), 0x4E4F534A)
            + encoded + struct.pack('<II', len(binary), 0x004E4942) + binary)


FORMATS = {5120: ('b', 1), 5121: ('B', 1), 5123: ('H', 2), 5126: ('f', 4)}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def packed_rows(rows, component):
    return b''.join(struct.pack('<' + FORMATS[component][0] * len(row), *row) for row in rows)


def append_stream(doc, binary, rows, component, kind, normalized=False, bounds=False):
    """새 뷰는 실제 BIN 버퍼0을 쓰고 기존 meshopt 대체 뷰는 보존한다."""
    width, size = WIDTHS[kind], FORMATS[component][1]
    target = 34963 if kind == 'SCALAR' else 34962
    stride = width * size if kind == 'SCALAR' else (width * size + 3) // 4 * 4
    raw = b''.join(struct.pack('<' + FORMATS[component][0] * width, *row)
                   + b'\0' * (stride - width * size) for row in rows)
    binary += b'\0' * (-len(binary) % 4)
    view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(raw), 'target': target}
    if kind != 'SCALAR':
        view['byteStride'] = stride
    accessor = {'bufferView': len(doc['bufferViews']), 'componentType': component, 'count': len(rows), 'type': kind}
    if normalized:
        accessor['normalized'] = True
    if bounds:
        accessor['min'] = [min(row[k] for row in rows) for k in range(width)]
        accessor['max'] = [max(row[k] for row in rows) for k in range(width)]
    doc['bufferViews'].append(view)
    doc['accessors'].append(accessor)
    binary += raw
    doc['buffers'][0]['byteLength'] = len(binary)
    return len(doc['accessors']) - 1, binary


def compact(position, normal, shape):
    x, y, z = position
    neck, end = shape['neckMaxY'], shape['transitionEndY']
    if y <= neck:
        return position, normal
    t = max(0.0, min(1.0, (y - neck) / (end - neck)))
    reduction = 1.0 - shape['upperXZ']
    scale = 1.0 - reduction * t * t * (3.0 - 2.0 * t)
    derivative = -reduction * 6.0 * t * (1.0 - t) / (end - neck) if t < 1.0 else 0.0
    changed = (x * scale, neck + shape['upperY'] * (y - neck), z * scale)
    # 변형 야코비안의 역전치로 UV 이음매·각진 경계의 법선을 보존한다.
    nx, ny, nz = normal
    mapped = (nx / scale, (ny - derivative * (x * nx + z * nz) / scale) / shape['upperY'], nz / scale)
    length = math.sqrt(sum(value * value for value in mapped))
    assert length > 0 and all(math.isfinite(value) for value in changed + mapped)
    return changed, tuple(value / length for value in mapped)


def world_position(encoded, node):
    return tuple(encoded[k] * node['scale'][k] + node['translation'][k] for k in range(3))


def head_derivative(base_doc, base_binary, source, contract):
    node = base_doc['nodes'][source['nodeIndex']]
    assert node == source['node'] and node['skin'] == 0 and node['mesh'] == 11
    assert len(set(node['scale'])) == 1 and node['scale'][0] > 0 and not node.get('rotation') and not node.get('matrix')
    streams = source['streams']
    for name, stream in streams.items():
        assert stream['sha256'] == contract['headStreams'][name]
        assert digest(packed_rows(stream['rows'], stream['accessor']['componentType'])) == stream['sha256']
    positions, normals, world, world_normals, anchored = [], [], [], [], []
    for index, (encoded, old_normal) in enumerate(zip(streams['POSITION']['rows'], streams['NORMAL']['rows'])):
        point = world_position(encoded, node)
        normal = tuple(max(-1.0, value / 127.0) for value in old_normal)
        assert streams['JOINTS_0']['rows'][index][0] == 14 and streams['WEIGHTS_0']['rows'][index] == [255, 0, 0, 0]
        changed, changed_normal = compact(point, normal, contract['shape'])
        if point[1] <= contract['shape']['neckMaxY']:
            new_position, new_normal = list(encoded), list(old_normal)
            anchored.append(index)
        else:
            new_position = [round((changed[k] - node['translation'][k]) / node['scale'][k]) for k in range(3)]
            new_normal = [round(max(-1.0, min(1.0, value)) * 127) for value in changed_normal]
        assert all(0 <= value <= 65535 for value in new_position)
        positions.append(new_position); normals.append(new_normal)
        world.append(world_position(new_position, node)); world_normals.append(changed_normal)
    assert len(positions) == 727 and len(anchored) == 81
    bounds = {'min': [min(point[k] for point in world) for k in range(3)],
              'max': [max(point[k] for point in world) for k in range(3)]}
    for side in ['min', 'max']:
        assert all(abs(bounds[side][k] - contract['predictedQuantizedHeadBounds'][side][k]) < 1e-9 for k in range(3))
    doc = copy.deepcopy(base_doc)
    position_id, binary = append_stream(doc, base_binary, positions, 5123, 'VEC3', bounds=True)
    normal_id, binary = append_stream(doc, binary, normals, 5120, 'VEC3', normalized=True)
    primitive = doc['meshes'][11]['primitives'][0]
    primitive['attributes']['POSITION'] = position_id; primitive['attributes']['NORMAL'] = normal_id
    assert doc['nodes'] == base_doc['nodes'] and doc['skins'] == base_doc['skins'] and doc['animations'] == base_doc['animations']
    assert doc['materials'] == base_doc['materials'] and binary[:len(base_binary)] == base_binary
    return doc, binary, world, world_normals, anchored, bounds


def blender_point(point):
    return point[0], -point[2], point[1]


def create_mesh(name, points, faces, material, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([blender_point(point) for point in points], [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    mesh.materials.append(material); obj['tllBone'] = 'head'
    for polygon in mesh.polygons:
        polygon.use_smooth = smooth
    return obj


def make_material(name, color, metal=0.0, rough=.85):
    material = bpy.data.materials.new(name); material.diffuse_color = (*color[:3], 1); material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Metallic'].default_value = metal; shader.inputs['Roughness'].default_value = rough
    return material


def original_crown(profiles, shape, material):
    # 측정한 CC0 머리 단면에서 24점 링 네 개를 취해 닫힌 띠192삼각형을 만든다.
    profile = profiles['knight']; assert len(profile['bottom']) == len(profile['top']) == 48
    points = []
    for label, sign in [('bottom', -1), ('top', 1)]:
        old_y = profile['y'] + sign * profile['height'] / 2
        y = shape['neckMaxY'] + shape['upperY'] * (old_y - shape['neckMaxY'])
        for offset in [.014, -.010]:
            for x, z in profile[label][::2]:
                radius = math.hypot(x, z); assert radius > 0
                factor = shape['upperXZ'] + offset / radius
                points.append((x * factor, y, z * factor))
    faces=[]; n=24
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,2*n+j,2*n+i), (n+i,3*n+i,3*n+j,n+j),
                      (i,n+i,n+j,j), (2*n+i,2*n+j,3*n+j,3*n+i)])
    front=[(-.16,2.045,.372),(-.16,2.145,.372),(-.085,2.095,.372),(0,2.185,.372),
           (.085,2.095,.372),(.16,2.145,.372),(.16,2.045,.372),(0,2.025,.372)]
    start=len(points); points.extend(front+[(x,y,z-.028) for x,y,z in front])
    faces.extend([tuple(start+i for i in reversed(range(8))),tuple(start+8+i for i in range(8))])
    faces.extend((start+i,start+(i+1)%8,start+(i+1)%8+8,start+i+8) for i in range(8))
    obj=create_mesh('TLL compact three-lobe coronet',points,faces,material)
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(obj.data);bm.free()
    obj.data.calc_loop_triangles()
    assert len(obj.data.vertices)==112 and len(obj.data.loop_triangles)==220
    return obj


def crown_derivative(fitting_doc, fitting_binary, obj, contract):
    positions=[];normals=[]
    for triangle in obj.data.loop_triangles:
        normal=triangle.normal
        for index in triangle.vertices:
            point=obj.data.vertices[index].co
            positions.append((point.x,point.z,-point.y));normals.append((normal.x,normal.z,-normal.y))
    assert len(positions)==660 and max(point[1] for point in positions)<=contract['crown']['maximumY']
    doc=copy.deepcopy(fitting_doc)
    old=doc['meshes'][20]['primitives'][0]
    assert len(doc['meshes'][20]['primitives'])==1 and old['material']==1
    assert doc['materials'][1]['name']=='V3 Brushed gold'
    p,binary=append_stream(doc,fitting_binary,positions,5126,'VEC3',bounds=True)
    n,binary=append_stream(doc,binary,normals,5126,'VEC3')
    uv,binary=append_stream(doc,binary,[(0.0,0.0)]*660,5126,'VEC2')
    indices,binary=append_stream(doc,binary,[(index,) for index in range(660)],5123,'SCALAR')
    doc['meshes'][20]['primitives']=[{'attributes':{'POSITION':p,'NORMAL':n,'TEXCOORD_0':uv},'indices':indices,'material':old['material']}]
    assert doc['nodes']==fitting_doc['nodes'] and doc['materials']==fitting_doc['materials']
    assert all(doc['meshes'][i]==mesh for i,mesh in enumerate(fitting_doc['meshes']) if i!=20)
    assert binary[:len(fitting_binary)]==fitting_binary
    bounds={'min':[min(point[k] for point in positions) for k in range(3)],'max':[max(point[k] for point in positions) for k in range(3)]}
    return doc,binary,bounds


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output=Path(args.output).resolve();assert output.is_relative_to(ROOT/'work'), 'New authoring output belongs in ignored work'
    output.mkdir()  # No rerun/overwrite. Tracked source and previous evidence are never destinations.
    contract=json.loads(CONTRACT_PATH.read_text());source=json.loads(Path(args.input).read_text())
    originals={key:(ROOT/value['path']).read_bytes() for key,value in contract['sources'].items()}
    for key,value in contract['sources'].items():assert digest(originals[key])==value['sha256'], key
    assert source['sourceSha256']==contract['sources']['base']['sha256']
    base_doc,base_binary=unpack(originals['base']);fitting_doc,fitting_binary=unpack(originals['fitting'])
    assert len(base_doc['skins'][0]['joints'])==41 and len(base_doc['animations'])==40
    result_doc,result_binary,points,normals,anchored,head_bounds=head_derivative(base_doc,base_binary,source,contract)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    skin=make_material('CC0 source face preview',(.76,.54,.41))
    head_faces=[tuple(row[0] for row in source['streams']['INDICES']['rows'][i:i+3]) for i in range(0,2868,3)]
    head=create_mesh('CC0-derived compact Knight head',points,head_faces,skin,True)
    head.data.normals_split_custom_set_from_vertices([blender_point(normal) for normal in normals])
    head['source_sha256']=contract['sources']['base']['sha256'];head['rig_joint']='head / source skin joint14'
    original_points=[world_position(row,source['node']) for row in source['streams']['POSITION']['rows']]
    before=create_mesh('UNCHANGED CC0 head reference',original_points,head_faces,skin,True);before.hide_render=True;before.hide_set(True)
    brass_spec=fitting_doc['materials'][1]['pbrMetallicRoughness']
    brass=make_material('V3 Brushed gold',brass_spec['baseColorFactor'],brass_spec['metallicFactor'],brass_spec['roughnessFactor'])
    crown=original_crown(json.loads(originals['headProfiles']),contract['shape'],brass)
    new_fit_doc,new_fit_binary,crown_bounds=crown_derivative(fitting_doc,fitting_binary,crown,contract)
    note=bpy.data.texts.new('PROVENANCE_AND_RIG_SCOPE')
    note.write('KayKit Adventurers2.0 CC0-derived head; original TLL compact crown. This is a geometry authoring master, not a new animated rig or runtime proof. Actual exported base keeps source41 joints/40 clips and all unchanged binary-prefix streams. UV/material atlas stays in the GLB source; preview material is neutral and cannot establish final face texture quality. No render was requested.')
    base_output=pack(result_doc,result_binary);fit_output=pack(new_fit_doc,new_fit_binary)
    assert len(base_output)-len(originals['base'])<16000 and len(fit_output)-len(originals['fitting'])<40000
    (output/'knight-head-balance-v1.glb').write_bytes(base_output)
    (output/'knight-fitting-head-balance-v1.glb').write_bytes(fit_output)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'knight-head-balance-v1.blend'))
    receipt={'schema':1,'status':'GENERATED_NOT_RUNTIME_REVIEWED','blender':bpy.app.version_string,
             'sourceGeneratorSha256':digest(Path(__file__).read_bytes()),'inputSha256':digest(Path(args.input).read_bytes()),
             'sourceContractSha256':digest(CONTRACT_PATH.read_bytes()),'sources':contract['sources'],
             'assets':{'base':{'file':'knight-head-balance-v1.glb','sha256':digest(base_output),'bytes':len(base_output)},
                       'fitting':{'file':'knight-fitting-head-balance-v1.glb','sha256':digest(fit_output),'bytes':len(fit_output)}},
             'preserved':{'originalBaseBinaryPrefix':True,'originalFittingBinaryPrefix':True,'nodesSkinsClipsUVJointsWeightsWeapons':True,'anchoredNeckVertices':anchored},
             'geometry':{'headVertices':727,'headTriangles':956,'headBounds':head_bounds,'crownBlenderVertices':112,'crownExportedVertices':660,'crownTriangles':220,'crownBounds':crown_bounds,'fittingTriangleReduction':2764},
             'license':contract['license'],'newMaterialsTexturesShadersLightsShadowPasses':0,
             'scope':'Actual Blender-authored geometry output only. No runtime activation, render, clip evaluation, wholeframe counters or pixels; root decides paired integration separately.'}
    for key,value in contract['sources'].items():assert digest((ROOT/value['path']).read_bytes())==value['sha256'], 'Original mutated: '+key
    (output/'generation-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'status':receipt['status'],'output':str(output),'headBounds':head_bounds,'crownBounds':crown_bounds}))


if __name__ == '__main__':
    main()
