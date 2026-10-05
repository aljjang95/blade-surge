"""Blender 5.2.1 LTS: 기존 V3 리그용 후면 문장 피팅을 저비용으로 추가한다.

재현: blender --background --factory-startup --threads 2 --python-exit-code 1
      --python tools/art/build-jade-heraldry-v1.py -- --preview
기존 GLB 버퍼는 보존하고 새 Blender 메시만 덧붙인다. 얼굴/리그/클립 원본은 수정하지 않는다.
"""
import argparse
import copy
import hashlib
import json
import math
import os
import struct
import subprocess
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
BASELINE = 'ccd41255f58c17b105882260a66dfcf3d97beadc'
HEROES = ['knight', 'barbarian', 'mage', 'rogue', 'ranger']
WORK = os.path.join(ROOT, 'work/jade-heraldry-v1')
OUT = os.path.join(ROOT, 'public/models/heroes-v3')
ART = os.path.join(ROOT, 'art/heroes-v3')
os.makedirs(WORK, exist_ok=True)
assert bpy.app.version[:3] == (5, 2, 1), 'Blender 5.2.1 LTS required'
parser = argparse.ArgumentParser()
parser.add_argument('--hero', choices=HEROES)
parser.add_argument('--preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def digest(data):
  return hashlib.sha256(data).hexdigest()


def unpack(data):
  assert struct.unpack_from('<III', data)[:2] == (0x46546c67, 2)
  json_size = struct.unpack_from('<I', data, 12)[0]
  doc = json.loads(data[20:20 + json_size])
  binary = data[28 + json_size:]
  return doc, binary[:doc['buffers'][0]['byteLength']]


def pack(doc, binary):
  text = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
  text += b' ' * (-len(text) % 4)
  binary += b'\0' * (-len(binary) % 4)
  return (struct.pack('<IIIII', 0x46546c67, 2, 28 + len(text) + len(binary), len(text), 0x4e4f534a)
          + text + struct.pack('<II', len(binary), 0x004e4942) + binary)


def role(name):
  label = name.lower()
  if any(word in label for word in ['skin', 'porcelain', 'hair', 'gemstone']):
    return 'skin'
  return 'metal' if any(word in label for word in ['metal', 'steel', 'gold', 'brass', 'enamel', 'forged']) else 'cloth'


def vertex_count(doc):
  return sum(doc['accessors'][part['attributes']['POSITION']]['count']
             for mesh in doc['meshes'] for part in mesh['primitives'])


def triangle_count(doc):
  return sum(doc['accessors'][part['indices']]['count'] // 3
             for mesh in doc['meshes'] for part in mesh['primitives'])


def merge_fitting(base, addition):
  doc, binary = unpack(base)
  extra, payload = unpack(addition)
  doc = copy.deepcopy(doc)
  assert not extra.get('skins') and not extra.get('animations') and not extra.get('textures')
  mapping = {i: next(j for j, item in enumerate(doc['materials']) if item['name'] == material['name'])
             for i, material in enumerate(extra['materials'])}
  offsets = {key: len(doc[key]) for key in ['accessors', 'bufferViews', 'meshes', 'nodes']}
  aligned = binary + b'\0' * (-len(binary) % 4)
  for view in extra['bufferViews']:
    view = copy.deepcopy(view)
    view['buffer'] = 0
    view['byteOffset'] = len(aligned) + view.get('byteOffset', 0)
    doc['bufferViews'].append(view)
  for accessor in extra['accessors']:
    accessor = copy.deepcopy(accessor)
    assert 'sparse' not in accessor
    accessor['bufferView'] += offsets['bufferViews']
    doc['accessors'].append(accessor)
  for mesh in extra['meshes']:
    mesh = copy.deepcopy(mesh)
    for part in mesh['primitives']:
      part['attributes'] = {key: value + offsets['accessors'] for key, value in part['attributes'].items()}
      part['indices'] += offsets['accessors']
      part['material'] = mapping[part['material']]
    doc['meshes'].append(mesh)
  for node in extra['nodes']:
    node = copy.deepcopy(node)
    if 'mesh' in node:
      node['mesh'] += offsets['meshes']
    if 'children' in node:
      node['children'] = [index + offsets['nodes'] for index in node['children']]
    doc['nodes'].append(node)
  doc['scenes'][doc.get('scene', 0)]['nodes'].extend(index + offsets['nodes'] for index in extra['scenes'][extra.get('scene', 0)]['nodes'])
  doc['buffers'] = [{'byteLength': len(aligned) + len(payload)}]
  assert doc['materials'] == unpack(base)[0]['materials'], 'No material additions or changes'
  assert unpack(base)[1] == aligned[:len(binary)], 'Original geometry bytes must stay exact'
  return pack(doc, aligned + payload)


def v(point):
  return (point[0], -point[2], point[1])


def create_material(material):
  pbr = material.get('pbrMetallicRoughness', {})
  item = bpy.data.materials.new(material['name'])
  item.diffuse_color = pbr.get('baseColorFactor', [1, 1, 1, 1])
  item.use_nodes = True
  shader = item.node_tree.nodes.get('Principled BSDF')
  shader.inputs['Base Color'].default_value = item.diffuse_color
  shader.inputs['Metallic'].default_value = pbr.get('metallicFactor', 1)
  shader.inputs['Roughness'].default_value = pbr.get('roughnessFactor', 1)
  return item


def plate(name, points, material, bone='chest', thickness=.028):
  n = len(points)
  vertices = points + [(x, y, z + thickness) for x, y, z in points]
  faces = [tuple(range(n)), tuple(range(n, 2 * n))[::-1]]
  faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
  mesh = bpy.data.meshes.new(name)
  mesh.from_pydata([v(p) for p in vertices], [], faces)
  mesh.update()
  bm = bmesh.new()
  bm.from_mesh(mesh)
  bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
  bm.to_mesh(mesh)
  bm.free()
  obj = bpy.data.objects.new(name, mesh)
  bpy.context.collection.objects.link(obj)
  obj.data.materials.append(material)
  obj['tllBone'] = bone
  obj['tllHeraldry'] = 'jade-v1'
  parts.append(obj)
  return obj


def mirrored(points, side):
  return [(side * x, y, z) for x, y, z in points]


def author(hero, materials):
  cloth = materials['V3 Woven cloth']
  brass = materials['V3 Brushed gold']
  ivory = materials.get('V3 Ivory enamel', brass)
  steel = materials.get('V3 Blackened steel', cloth)
  silver = materials.get('V3 Silver steel', ivory)
  if hero == 'knight':
    plate('Jade Knight dorsal shadow seam', [(-.30, 1.19, -.278), (.30, 1.19, -.278), (.30, .80, -.285), (0, .66, -.28), (-.30, .80, -.285)], steel)
    for side in [-1, 1]:
      plate('Jade Knight split oath crest ' + str(side), mirrored([(.055, 1.17, -.315), (.30, 1.17, -.315), (.26, .86, -.32), (.065, .73, -.30)], side), ivory)
      plate('Jade Knight shoulder oath ' + str(side), mirrored([(.22, 1.235, -.17), (.44, 1.24, -.13), (.49, 1.10, -.20), (.29, 1.07, -.265)], side), ivory, 'upperarm.' + ('l' if side > 0 else 'r'))
    plate('Jade Knight oath fastener', [(-.055, 1.03, -.35), (0, 1.09, -.35), (.055, 1.03, -.35), (0, .96, -.35)], brass)
  elif hero == 'barbarian':
    plate('Jade Barbarian mantle shadow', [(-.48, 1.23, -.17), (-.06, 1.17, -.30), (.09, .93, -.31), (-.17, .59, -.30), (-.42, .80, -.27)], steel)
    plate('Jade Barbarian asymmetric war mantle', [(-.435, 1.21, -.208), (-.10, 1.155, -.334), (.035, .94, -.35), (-.18, .64, -.342), (-.375, .82, -.31)], cloth)
    plate('Jade Barbarian brass shoulder band', [(-.445, 1.22, -.248), (-.085, 1.165, -.37), (-.052, 1.09, -.37), (-.443, 1.13, -.282)], brass)
    plate('Jade Barbarian mantle broken edge', [(-.25, .88, -.36), (-.22, .80, -.37), (-.10, .66, -.362), (-.18, .645, -.365), (-.32, .82, -.35)], brass)
  elif hero == 'mage':
    # 열린 초승달 끝은 기존 어깨 망토로 이어지고 머리 위로 올라가지 않는다.
    n = 10
    outer = [(.48 * math.cos(i * math.pi / n), 1.26 - .29 * math.sin(i * math.pi / n), -.26) for i in range(n + 1)]
    inner = [(.34 * math.cos(i * math.pi / n), 1.26 - .16 * math.sin(i * math.pi / n), -.292) for i in reversed(range(n + 1))]
    plate('Jade Mage lunar crescent back collar', outer + inner, silver, thickness=.035)
    plate('Jade Mage astral star shadow', [(0, .74, -.336), (.06, .59, -.36), (.205, .53, -.36), (.06, .465, -.375), (0, .32, -.384), (-.06, .465, -.375), (-.205, .53, -.36), (-.06, .59, -.36)], steel, 'hips')
    plate('Jade Mage ivory four point back star', [(0, .715, -.385), (.035, .58, -.40), (.165, .53, -.40), (.035, .49, -.415), (0, .36, -.42), (-.035, .49, -.415), (-.165, .53, -.40), (-.035, .58, -.40)], ivory, 'hips')
  elif hero == 'rogue':
    for side in [-1, 1]:
      plate('Jade Rogue twin tail silhouette ' + str(side), mirrored([(.08, .82, -.28), (.28, .80, -.28), (.455, .435, -.40), (.34, .265, -.43), (.17, .42, -.39)], side), steel, 'hips')
      plate('Jade Rogue twin teal tail ' + str(side), mirrored([(.115, .79, -.316), (.254, .77, -.316), (.412, .435, -.436), (.337, .315, -.465), (.20, .435, -.426)], side), cloth, 'hips')
      plate('Jade Rogue tail pale seam ' + str(side), mirrored([(.26, .78, -.355), (.287, .78, -.355), (.445, .44, -.475), (.421, .415, -.475)], side), silver, 'hips', .015)
      plate('Jade Rogue rear harness ' + str(side), mirrored([(.15, 1.16, -.276), (.28, 1.16, -.245), (.13, .86, -.31), (.075, .885, -.31)], side), ivory)
  else:
    # 화살통 중심은 비워 두고 양쪽 어깨 바깥쪽에 읽히는 잎을 배치한다.
    for side in [-1, 1]:
      plate('Jade Ranger leaf yoke shadow ' + str(side), mirrored([(.12, 1.23, -.16), (.31, 1.28, -.13), (.58, 1.135, -.20), (.44, .92, -.30), (.25, 1.03, -.315)], side), cloth)
      plate('Jade Ranger ivory leaf yoke ' + str(side), mirrored([(.17, 1.20, -.20), (.30, 1.24, -.17), (.525, 1.13, -.238), (.419, .98, -.34), (.28, 1.055, -.354)], side), ivory)
      plate('Jade Ranger leaf central vein ' + str(side), mirrored([(.28, 1.20, -.226), (.307, 1.21, -.226), (.434, 1.04, -.386), (.414, 1.015, -.386)], side), brass, thickness=.012)


def preview(hero, addition_path):
  bpy.ops.wm.open_mainfile(filepath=os.path.join(ART, hero + '-v3.blend'))
  scene = bpy.context.scene
  previous = set(scene.objects)
  bpy.ops.import_scene.gltf(filepath=addition_path)
  additions = [o for o in scene.objects if o not in previous and o.type == 'MESH']
  rig = next(o for o in scene.objects if o.type == 'ARMATURE')
  for obj in additions:
    wanted = obj.get('tllBone')
    bone = next(b.name for b in rig.data.bones if b.name.replace('.', '') == wanted.replace('.', ''))
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    modifier = obj.modifiers.new('Retained source rig', 'ARMATURE')
    modifier.object = rig
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world
  scene.render.resolution_x = 512
  scene.render.resolution_y = 512
  scene.render.resolution_percentage = 100
  scene.render.engine = 'CYCLES'
  scene.cycles.samples = 16
  scene.cycles.device = 'CPU'
  scene.camera.data.ortho_scale = 3.5
  # 카메라 고도는 전투 기본 오프셋 12.5/8.5에서 얻으며 배율은 형태 검사용이다.
  elevation = math.atan2(12.5, 8.5)
  for label, yaw in [('rear', 145), ('front', 35)]:
    radius = 6.2
    angle = math.radians(yaw)
    scene.camera.location = v((radius * math.sin(angle), .95 + radius * math.tan(elevation), radius * math.cos(angle)))
    scene.camera.rotation_euler = (Vector(v((0, .95, 0))) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
    for stage in ['before', 'after']:
      for obj in additions:
        obj.hide_render = stage == 'before'
      scene.render.filepath = os.path.join(WORK, hero + '-' + label + '-' + stage + '.png')
      bpy.ops.render.render(write_still=True)
  bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, hero + '-jade-v1.blend'))


report_path = os.path.join(ART, 'jade-heraldry-v1.json')
report = {'schema': 'blade-surge.jade-heraldry.v1', 'blender': bpy.app.version_string,
          'baseline_commit': BASELINE, 'source_credit': 'KayKit Adventurers CC0; existing TLL original derivative Blender costume; new original rear fittings',
          'license_file': 'public/models/KAYKIT_ADVENTURERS_LICENSE.txt',
          'authoring_script': 'tools/art/build-jade-heraldry-v1.py',
          'reproduction': 'blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/art/build-jade-heraldry-v1.py -- --preview',
          'draw_budget_basis': 'assembleHeroIdentity in src/engine/hero-identity.js merges all fitting meshes into existing cloth/metal/skin roles; this revision preserves the complete input material array and role set. Runtime frame counters are separate QA.',
          'scope': 'Original Blender-authored rear/shoulder fittings. Existing faces, animation rigs, sockets, source GLBs and original fitting buffers preserved. Blender review images are not runtime or device QA.',
          'runtime_contract': {'additional_draws_per_hero': 0, 'additional_shader_programs_per_hero': 0,
                               'new_material_roles': 0, 'vertex_delta_limit': 800, 'byte_delta_limit': 75000}, 'assets': []}
if args.hero and os.path.isfile(report_path):
  with open(report_path) as handle:
    report = json.load(handle)
  report['assets'] = [asset for asset in report['assets'] if asset['hero'] != args.hero]
with open(os.path.join(ART, 'manifest.json')) as handle:
  existing_manifest = json.load(handle)
for hero in ([args.hero] if args.hero else HEROES):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  relative = 'public/models/heroes-v3/' + hero + '-v3.glb'
  baseline = subprocess.check_output(['git', 'show', BASELINE + ':' + relative], cwd=ROOT)
  doc, binary = unpack(baseline)
  materials = {item['name']: create_material(item) for item in doc['materials']}
  parts = []
  author(hero, materials)
  bpy.ops.object.select_all(action='DESELECT')
  for obj in parts:
    obj.select_set(True)
  addition_path = os.path.join(WORK, hero + '-addition.glb')
  bpy.ops.export_scene.gltf(filepath=addition_path, export_format='GLB', use_selection=True,
                            export_extras=True, export_animations=False, export_texcoords=False)
  with open(addition_path, 'rb') as handle:
    addition = handle.read()
  output = merge_fitting(baseline, addition)
  result_doc, result_binary = unpack(output)
  added = vertex_count(result_doc) - vertex_count(doc)
  assert 0 < added <= 800, str((hero, added))
  assert 0 < len(output) - len(baseline) <= 75000, str((hero, len(output) - len(baseline)))
  original_roles = sorted(set(role(item['name']) for item in doc['materials']))
  result_roles = sorted(set(role(item['name']) for item in result_doc['materials']))
  assert original_roles == result_roles
  allowed_bones = {node.get('extras', {}).get('tllBone') for node in doc['nodes']}
  assert all(obj['tllBone'] in allowed_bones for obj in parts)
  with open(os.path.join(ROOT, relative), 'wb') as handle:
    handle.write(output)
  asset = {'hero': hero, 'path': relative, 'sha256': digest(output), 'baseline_sha256': digest(baseline),
           'baseline_bytes': len(baseline), 'bytes': len(output), 'added_bytes': len(output) - len(baseline),
           'baseline_exported_vertices': vertex_count(doc), 'exported_vertices': vertex_count(result_doc),
           'added_exported_vertices': added, 'added_blender_vertices': sum(len(obj.data.vertices) for obj in parts),
           'added_triangles': triangle_count(result_doc) - triangle_count(doc),
           'original_geometry_buffer_preserved': binary == result_binary[:len(binary)],
           'source_material_count': len(doc['materials']), 'output_material_count': len(result_doc['materials']),
           'runtime_material_roles': result_roles, 'added_draws': 0, 'added_programs': 0,
           'bones': sorted({obj['tllBone'] for obj in parts}), 'parts': [obj.name for obj in parts]}
  report['assets'].append(asset)
  entry = next(item for item in existing_manifest['assets'] if item['hero'] == hero)
  entry['sha256'] = asset['sha256']
  entry['bytes'] = len(output)
  if 'jade_heraldry_v1' not in entry:
    entry['vertices'] += asset['added_blender_vertices']
  else:
    entry['vertices'] += asset['added_blender_vertices'] - entry['jade_heraldry_v1']['added_blender_vertices']
  entry['jade_heraldry_v1'] = {'baseline_sha256': asset['baseline_sha256'], 'added_blender_vertices': asset['added_blender_vertices'],
                               'added_exported_vertices': added, 'added_bytes': asset['added_bytes'], 'provenance': 'art/heroes-v3/jade-heraldry-v1.json'}
  if args.preview:
    preview(hero, addition_path)
    master_path = os.path.join(WORK, hero + '-jade-v1.blend')
    asset['review_master'] = os.path.relpath(master_path, ROOT)
    asset['review_master_sha256'] = digest(open(master_path, 'rb').read())
    asset['review_renders'] = []
    for view in ['rear', 'front']:
      for stage in ['before', 'after']:
        render_path = os.path.join(WORK, hero + '-' + view + '-' + stage + '.png')
        asset['review_renders'].append({'path': os.path.relpath(render_path, ROOT), 'sha256': digest(open(render_path, 'rb').read())})
  print('JADE_HERALDRY_COMPLETE', hero, json.dumps(asset), flush=True)
report['assets'].sort(key=lambda item: HEROES.index(item['hero']))
with open(report_path, 'w') as handle:
  json.dump(report, handle, indent=2, ensure_ascii=False)
  handle.write('\n')
with open(os.path.join(ART, 'manifest.json'), 'w') as handle:
  json.dump(existing_manifest, handle, indent=2, ensure_ascii=False)
  handle.write('\n')
