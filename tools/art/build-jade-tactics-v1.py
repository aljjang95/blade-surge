"""Original landmark-only jade tactical kit; Blender 5.2.1 LTS, one thread.

Writes ignored Blender artifacts and reproducible authored runtime geometry JSON. No render, texture bake or API.
Runtime coordinates: metres, +Y up, +Z toward the operator/room. Both models are
outside-mask decorative backings; they do not create doors, pads or collision.
"""
from pathlib import Path
import hashlib
import json
import math
import struct

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'work/art/jade-tactics-v1'
OUT.mkdir(parents=True, exist_ok=True)
REFERENCE = ROOT / 'work/art-jade-next-20261004/dungeon-modular-concept.png'
REFERENCE_SHA = 'f9c29de159b2ef630668a14e324676a49adb873cd3dce0c4f5e45a7fce1d0568'
assert bpy.app.version[:3] == (5, 2, 1), 'Blender 5.2.1 LTS required'
if REFERENCE.is_file():
  assert hashlib.sha256(REFERENCE.read_bytes()).hexdigest() == REFERENCE_SHA
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'
scene.render.threads = 1
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene['author'] = 'TLL original authored geometry'
scene['referenceSha256'] = REFERENCE_SHA
scene['noRuntimeIntegration'] = True


def digest(path):
  return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def linear(hex_color):
  rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
  return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


def runtime_to_blender(point):
  x, y, z = point
  return x, -z, y


def blender_to_runtime(point):
  return point[0], point[2], -point[1]


ROLE_SPECS = [
  {'index': 0, 'name': 'TLL_Tactics_Role0_Stone', 'roughness': .88, 'metalness': 0},
  {'index': 1, 'name': 'TLL_Tactics_Role1_Brass', 'roughness': .52, 'metalness': .35},
  {'index': 2, 'name': 'TLL_Tactics_Role2_IvoryJade', 'roughness': .88, 'metalness': 0},
]
MATERIALS = []
for spec in ROLE_SPECS:
  material = bpy.data.materials.new(spec['name'])
  material.use_nodes = True
  material.use_backface_culling = True
  material.diffuse_color = (1, 1, 1, 1)
  shader = material.node_tree.nodes.get('Principled BSDF')
  shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
  shader.inputs['Roughness'].default_value = spec['roughness']
  shader.inputs['Metallic'].default_value = spec['metalness']
  shader.inputs['Emission Strength'].default_value = 0
  color = material.node_tree.nodes.new('ShaderNodeVertexColor')
  color.layer_name = 'TLLColor'
  material.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])
  material['tllMaterialRole'] = spec['index']
  material['provenance'] = 'Original TLL vertex-color surface; same existing tactics shader feature class'
  MATERIALS.append(material)

PARTS = {}
ROOTS = {}


def root(name, kind):
  obj = bpy.data.objects.new(name, None)
  scene.collection.objects.link(obj)
  obj['tllKind'] = kind
  obj['authorship'] = 'Original Blender mesh authored from original imagegen reference'
  obj['referenceSha256'] = REFERENCE_SHA
  obj['units'] = 'metres'
  obj['forward'] = '+Z'
  obj['castShadow'] = False
  obj['receiveShadow'] = False
  obj['placement'] = 'Only at an outside-walk-mask backing selected by existing map-tactics-view'
  PARTS[name] = [[], [], []]
  ROOTS[name] = obj
  return obj


def piece(owner, name, vertices, faces, role, color, bevel=0):
  geometry = bpy.data.meshes.new(name)
  geometry.from_pydata([runtime_to_blender(p) for p in vertices], [], faces)
  geometry.update()
  obj = bpy.data.objects.new(name, geometry)
  scene.collection.objects.link(obj)
  obj.data.materials.append(MATERIALS[role])
  colors = obj.data.color_attributes.new(name='TLLColor', type='FLOAT_COLOR', domain='POINT')
  rgba = linear(color)
  for value in colors.data:
    value.color = rgba
  obj.data.color_attributes.active_color = colors
  if bevel:
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Original one-segment carved bevel', 'BEVEL')
    modifier.width = bevel
    modifier.segments = 1
    modifier.affect = 'EDGES'
    modifier.limit_method = 'ANGLE'
    modifier.angle_limit = math.radians(25)
    modifier.use_clamp_overlap = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
  PARTS[owner.name][role].append(obj)
  return obj


def prism(owner, name, outline, z, depth, role, color, side=1, bevel=0):
  points = [(side * x, y) for x, y in outline]
  count = len(points)
  vertices = [(x, y, z - depth / 2) for x, y in points] + [(x, y, z + depth / 2) for x, y in points]
  faces = [tuple(range(count))[::-1], tuple(range(count, count * 2))]
  faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
  obj = piece(owner, name, vertices, faces, role, color, bevel)
  if side < 0:
    # A mirror reverses winding; restore outward normals without runtime scale tricks.
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
  return obj


def box(owner, name, center, size, role, color, bevel=0):
  x, y, z = center
  w, h, d = (v / 2 for v in size)
  vertices = [(x + sx * w, y + sy * h, z + sz * d) for sx, sy, sz in [
    (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
    (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1),
  ]]
  faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
  return piece(owner, name, vertices, faces, role, color, bevel)


def chamfered_rect(width, depth, cut):
  x, z = width / 2, depth / 2
  return [(-x + cut, -z), (x - cut, -z), (x, -z + cut), (x, z - cut),
    (x - cut, z), (-x + cut, z), (-x, z - cut), (-x, -z + cut)]


def obelisk(owner):
  rings = [( .36, .50, .42, .045), (2.26, .42, .34, .045),
    (2.60, .25, .22, .030), (2.90, .022, .022, .004)]
  vertices = []
  for y, width, depth, cut in rings:
    vertices.extend((x, y, z) for x, z in chamfered_rect(width, depth, cut))
  faces = [tuple(range(8))[::-1], tuple(range(24, 32))]
  for level in range(3):
    for i in range(8):
      faces.append((level * 8 + i, level * 8 + (i + 1) % 8, (level + 1) * 8 + (i + 1) % 8, (level + 1) * 8 + i))
  return piece(owner, 'Release_faceted_tapered_basalt', vertices, faces, 0, '303c43')


def diamond_ring(owner, name, y, outer, inner, z, depth, role, color):
  ow, oh = outer
  iw, ih = inner
  outline = [(0, y - oh), (ow, y), (0, y + oh), (-ow, y)]
  inside = [(0, y - ih), (iw, y), (0, y + ih), (-iw, y)]
  vertices = [(x, h, zz) for zz in [z - depth / 2, z + depth / 2] for loop in [outline, inside] for x, h in loop]
  faces = []
  for i in range(4):
    j = (i + 1) % 4
    faces += [(i, j, j + 4, i + 4), (i + 8, i + 12, j + 12, j + 8),
      (i, i + 8, j + 8, j), (i + 4, j + 4, j + 12, i + 12)]
  return piece(owner, name, vertices, faces, role, color)


gather = root('TLL_JadeGatherArch', 'gather')
blade = [(.65, .16), (.97, .16), (1.04, 1.30), (.96, 2.05), (.70, 2.47),
  (.33, 2.68), (.25, 2.49), (.63, 2.08), (.64, 1.21)]
ivory = [(.72, .33), (.83, .33), (.89, 1.38), (.81, 2.03), (.56, 2.40),
  (.24, 2.61), (.29, 2.47), (.64, 2.06), (.72, 1.38)]
inlay = [(.65, .60), (.72, .60), (.72, 1.26), (.64, 1.87), (.60, 1.82), (.65, 1.23)]
binding = [(.63, 2.39), (.79, 2.36), (.81, 2.40), (.65, 2.45)]
for side in [-1, 1]:
  suffix = 'left' if side < 0 else 'right'
  box(gather, 'Gather_basalt_shoe_' + suffix, (side * .82, .06, 0), (.36, .12, .76), 0, '303c43', .018)
  box(gather, 'Gather_brass_binding_' + suffix, (side * .82, .19, 0), (.34, .14, .64), 1, 'b39156', .015)
  prism(gather, 'Gather_split_jade_blade_' + suffix, blade, 0, .36, 0, '3f6e61', side, .015)
  prism(gather, 'Gather_carved_ivory_leaf_' + suffix, ivory, .2075, .055, 2, 'b7d2b8', side)
  prism(gather, 'Gather_opaque_jade_inlay_' + suffix, inlay, .25, .028, 2, '7fb8a0', side)
  prism(gather, 'Gather_brass_upper_binding_' + suffix, binding, .25, .036, 1, 'b39156', side)
prism(gather, 'Gather_small_high_keystone', [(0, 2.37), (.09, 2.48), (0, 2.60), (-.09, 2.48)], .10, .09, 2, 'b7d2b8')

release = root('TLL_BasaltReleaseObelisk', 'release')
box(release, 'Release_basalt_lower_plinth', (0, .065, 0), (.86, .13, .76), 0, '25343c', .025)
box(release, 'Release_brass_tier', (0, .15, 0), (.74, .04, .64), 1, 'b39156', .010)
box(release, 'Release_basalt_upper_plinth', (0, .28, 0), (.60, .22, .50), 0, '303c43', .022)
obelisk(release)
prism(release, 'Release_long_brass_seam', [(-.034, .55), (.034, .55), (.030, 2.36), (0, 2.55), (-.030, 2.36)], .231, .024, 1, 'b39156')
for side in [-1, 1]:
  prism(release, 'Release_brass_split_yoke_' + str(side), [(.24, 1.10), (.40, 1.20), (.39, 1.94), (.29, 1.84)], .10, .08, 1, 'b39156', side)
diamond_ring(release, 'Release_brass_diamond_frame', 1.74, (.18, .34), (.12, .24), .26, .035, 1, 'b39156')
prism(release, 'Release_ivory_center_sigil', [(0, 1.50), (.09, 1.74), (0, 1.93), (-.09, 1.74)], .282, .065, 2, 'c5b58e')
prism(release, 'Release_rear_ivory_sigil', [(0, 2.10), (.07, 2.24), (0, 2.45), (-.07, 2.24)], -.18, .035, 2, 'c5b58e')


def merge_surfaces(owner):
  for role, objects in enumerate(PARTS[owner.name]):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
      obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = owner.name + '__Role' + str(role)
    obj.data.name = obj.name + '_Geometry'
    obj.parent = owner
    # Only one slot per role/mesh; six model surfaces total with shared materials.
    obj.data.materials.clear()
    obj.data.materials.append(MATERIALS[role])
    for face in obj.data.polygons:
      face.material_index = 0
      face.use_smooth = False
    obj['tllMaterialRole'] = role
    obj['castShadow'] = False
    obj['receiveShadow'] = False
    obj.visible_shadow = False
    obj['authorship'] = 'Original TLL authored geometry; no imported asset'
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


for owner in ROOTS.values():
  merge_surfaces(owner)
bpy.context.view_layer.update()


def model_stats(owner):
  meshes = [obj for obj in owner.children if obj.type == 'MESH']
  points = [blender_to_runtime(obj.matrix_world @ vertex.co) for obj in meshes for vertex in obj.data.vertices]
  bounds = {'min': [min(point[i] for point in points) for i in range(3)],
    'max': [max(point[i] for point in points) for i in range(3)]}
  bounds['size'] = [bounds['max'][i] - bounds['min'][i] for i in range(3)]
  surfaces = []
  for obj in meshes:
    obj.data.calc_loop_triangles()
    surfaces.append({'name': obj.name, 'role': obj['tllMaterialRole'], 'vertices': len(obj.data.vertices),
      'triangles': len(obj.data.loop_triangles), 'vertexColor': obj.data.color_attributes.active_color.name})
  return {'name': owner.name, 'kind': owner['tllKind'], 'boundsRuntimeXYZ': bounds, 'surfaces': surfaces,
    'meshCount': len(meshes), 'vertices': sum(item['vertices'] for item in surfaces),
    'triangles': sum(item['triangles'] for item in surfaces)}


stats = [model_stats(owner) for owner in ROOTS.values()]
assert sum(item['triangles'] for item in stats) <= 1600
assert sum(item['meshCount'] for item in stats) == 6
for item in stats:
  bounds = item['boundsRuntimeXYZ']
  assert bounds['min'][1] >= -1e-6
  assert max(abs(bounds['min'][0]), abs(bounds['max'][0])) <= 1.1 + 1e-6
  assert max(abs(bounds['min'][2]), abs(bounds['max'][2])) <= .55 + 1e-6
  assert bounds['max'][1] <= (2.68 if item['kind'] == 'gather' else 2.90) + 1e-6
assert len(bpy.data.materials) == 3
assert not any(obj.type in {'LIGHT', 'CAMERA', 'ARMATURE'} for obj in scene.objects)
assert not bpy.data.images


def lower_opening(owner, ceiling=2.08):
  nearest = math.inf
  for obj in owner.children:
    obj.data.calc_loop_triangles()
    for triangle in obj.data.loop_triangles:
      points = [blender_to_runtime(obj.matrix_world @ obj.data.vertices[i].co) for i in triangle.vertices]
      candidates = [p for p in points if 0 <= p[1] <= ceiling]
      for i, a in enumerate(points):
        b = points[(i + 1) % 3]
        for plane in [0, ceiling]:
          if (a[1] < plane < b[1]) or (b[1] < plane < a[1]):
            t = (plane - a[1]) / (b[1] - a[1])
            candidates.append(tuple(a[c] + (b[c] - a[c]) * t for c in range(3)))
      if not candidates:
        continue
      minimum, maximum = min(p[0] for p in candidates), max(p[0] for p in candidates)
      nearest = min(nearest, 0 if minimum <= 0 <= maximum else min(abs(minimum), abs(maximum)))
  return nearest * 2


opening_width = lower_opening(gather)
assert opening_width >= 1.2 - 1e-6, f'Actual lower opening {opening_width}m must retain 1.2m clearance'

# Selection-bounded individual GLBs; no renderer, light, texture or animation export.
gltf_props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
settings = {'export_format': 'GLB', 'use_selection': True, 'export_yup': True,
  'export_normals': True, 'export_texcoords': False, 'export_tangents': False,
  'export_colors': True, 'export_all_vertex_colors': True, 'export_materials': 'EXPORT',
  'export_extras': True, 'export_cameras': False, 'export_lights': False, 'export_animations': False}
settings = {key: value for key, value in settings.items() if key in gltf_props}
FILES = {'TLL_JadeGatherArch': 'jade-gather-arch.glb', 'TLL_BasaltReleaseObelisk': 'basalt-release-obelisk.glb'}
for owner in ROOTS.values():
  bpy.ops.object.select_all(action='DESELECT')
  owner.select_set(True)
  for obj in owner.children:
    obj.select_set(True)
  bpy.context.view_layer.objects.active = owner
  bpy.ops.export_scene.gltf(filepath=str(OUT / FILES[owner.name]), **settings)

blend_path = OUT / 'jade-tactical-kit.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)


def glb_json(path):
  data = path.read_bytes()
  assert struct.unpack_from('<III', data) == (0x46546c67, 2, len(data))
  size, kind = struct.unpack_from('<II', data, 12)
  assert kind == 0x4e4f534a
  return json.loads(data[20:20 + size])


exports = []
for name, filename in FILES.items():
  path = OUT / filename
  doc = glb_json(path)
  assert len(doc.get('materials', [])) == 3
  assert len(doc.get('meshes', [])) == 3
  assert not any(doc.get(key) for key in ['textures', 'images', 'samplers', 'skins', 'animations', 'cameras', 'extensionsUsed', 'extensionsRequired'])
  primitives = [part for mesh in doc['meshes'] for part in mesh['primitives']]
  assert len(primitives) == 3
  assert all(set(part['attributes']) == {'POSITION', 'NORMAL', 'COLOR_0'} for part in primitives)
  assert all(doc['accessors'][part['attributes']['COLOR_0']]['type'] == 'VEC3' for part in primitives)
  assert all(not material.get('doubleSided', False) and material.get('alphaMode', 'OPAQUE') == 'OPAQUE' for material in doc['materials'])
  assert all(len(mesh['primitives']) == 1 for mesh in doc['meshes'])
  triangles = sum(doc['accessors'][part['indices']]['count'] // 3 for part in primitives)
  assert triangles == next(item['triangles'] for item in stats if item['name'] == name)
  exports.append({'file': filename, 'sha256': digest(path), 'bytes': path.stat().st_size,
    'triangles': triangles, 'meshes': 3, 'primitives': 3, 'materials': [m['name'] for m in doc['materials']],
    'exportedVertices': sum(doc['accessors'][part['attributes']['POSITION']]['count'] for part in primitives),
    'attributes': ['POSITION', 'NORMAL', 'COLOR_0'], 'vertexColorType': 'VEC3', 'frontSideOpaque': True,
    'shaderExtensions': [], 'textures': 0, 'lights': 0})

# Actual .blend reopen and actual GLB reimport are separate mesh checks, never renders.
bpy.ops.wm.open_mainfile(filepath=str(blend_path))
assert sum(obj.type == 'MESH' for obj in bpy.context.scene.objects) == 6
assert len(bpy.data.materials) == 3
assert not any(obj.type in {'LIGHT', 'CAMERA', 'ARMATURE'} for obj in bpy.context.scene.objects)
assert all(not obj.visible_shadow for obj in bpy.context.scene.objects if obj.type == 'MESH')
reimports = []
for item in exports:
  bpy.ops.wm.read_factory_settings(use_empty=True)
  bpy.ops.import_scene.gltf(filepath=str(OUT / item['file']))
  objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
  assert len(objects) == 3
  bpy.context.view_layer.update()
  points = [blender_to_runtime(obj.matrix_world @ vertex.co) for obj in objects for vertex in obj.data.vertices]
  bounds = {'min': [min(point[i] for point in points) for i in range(3)],
    'max': [max(point[i] for point in points) for i in range(3)]}
  expected = next(model for model in stats if FILES[model['name']] == item['file'])['boundsRuntimeXYZ']
  assert all(abs(bounds[key][i] - expected[key][i]) < 1e-5 for key in ['min', 'max'] for i in range(3))
  triangles = 0
  for obj in objects:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
    assert obj.data.color_attributes
    assert len(obj.data.materials) == 1
  assert triangles == item['triangles']
  reimports.append({'file': item['file'], 'meshCount': 3, 'triangles': triangles,
    'boundsRuntimeXYZ': bounds, 'verticesFinite': all(math.isfinite(c) for point in points for c in point),
    'vertexColorPreserved': True, 'shadowExtrasFalse': all(obj.get('castShadow') is False and obj.get('receiveShadow') is False for obj in objects)})

report = {
  'schema': 1, 'stage': 'ACTUAL_ORIGINAL_BLENDER_AUTHORSHIP_EXPORT_REOPEN_REIMPORT_NOT_RUNTIME',
  'blender': {'version': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(), 'threads': 1, 'renderRun': False},
  'provenance': {'author': 'TLL original geometry and vertex colors', 'reference': str(REFERENCE), 'referenceSha256': REFERENCE_SHA,
    'originalAIReference': True, 'thirdPartyMeshesOrTexturesImported': False, 'trellisUsed': False,
    'rights': 'Original TLL authored geometry; native generated concept under applicable provider terms; no third-party model or texture incorporated.'},
  'sourceGenerator': {'file': 'generate.py', 'sha256': digest(__file__)},
  'editableBlend': {'file': blend_path.name, 'sha256': digest(blend_path), 'reopened': True},
  'sharedMaterialRoles': ROLE_SPECS, 'sameExistingShaderFeatures': 'opaque Standard PBR + vertex colors only; no map/bump/normal/roughness texture features',
  'models': stats, 'exports': exports, 'reimportChecks': reimports,
  'totals': {'meshes': 6, 'materialRoles': 3, 'triangles': sum(item['triangles'] for item in exports), 'textures': 0, 'lights': 0, 'renderTargets': 0, 'shadowCasters': 0},
  'placementContract': {'landmarkOnly': True, 'outsideMaskRequired': True,
    'existingAcceptedBackingRectangle': {'halfX': 1.1, 'halfZ': .55},
    'existingMaximumHeight': {'gather': 2.68, 'release': 2.90},
    'gatherLowerOpening': {'widthAtLeast': opening_width, 'measuredFromActualClippedTriangles': True,
      'fromY': 0, 'toY': 2.08, 'playerRadius': .56, 'clearancePerSide': opening_width / 2 - .56},
    'backingWallClearance': [{'name': item['name'],
      'sideCandidate': 1.6 - max(abs(item['boundsRuntimeXYZ']['min'][0]), abs(item['boundsRuntimeXYZ']['max'][0])),
      'rearCandidate': 1.25 - max(abs(item['boundsRuntimeXYZ']['min'][2]), abs(item['boundsRuntimeXYZ']['max'][2]))} for item in stats],
    'operatorRadius': 1.4, 'operatorToEffectAnchor': {'x': 0, 'y': 0, 'z': 2},
    'modelsContainOperatorOrEffectVisuals': False,
    'directionsAndPositionsRemainControllerAuthority': True,
    'noNewDoorRouteCollisionOrWalkMask': True,
    'futureIntegration': 'Replace outside-mask backings only. Rebind existing three material roles and merge both backings with floor/seam static surfaces to retain total6 view draws (3static+2operator+1effect). Raw separate GLBs are not a measured runtime budget pass.',
    'gltfShadowFlagCaveat': 'GLTF shadow booleans are extras only; future caller must explicitly keep mesh.castShadow=false and avoid assigning new lights or shadow passes.'},
  'acceptanceLimits': {'triangleTarget': 1600, 'modelSurfaceMaximum': 6, 'sharedMaterialRoleMaximum': 3},
  'notRun': ['CPU render', 'viewport screenshots', 'browser/runtime integration', 'runtime performance/disposal gate', 'primary source or GLB mutation'],
}
(OUT / 'vertex-material-role-report.json').write_text(json.dumps(report, indent=2) + '\n')
print('TLL_KIT_READY ' + json.dumps({'triangles': report['totals']['triangles'], 'models': [{'name': item['name'], 'size': item['boundsRuntimeXYZ']['size'], 'triangles': item['triangles']} for item in stats], 'report': str(OUT / 'vertex-material-role-report.json')}))


def runtime_surfaces(path):
  data = path.read_bytes()
  doc = glb_json(path)
  json_size = struct.unpack_from('<I', data, 12)[0]
  binary = data[28 + json_size:]
  types = {5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
  sizes = {'SCALAR': 1, 'VEC3': 3}

  def attribute(index):
    accessor = doc['accessors'][index]
    view = doc['bufferViews'][accessor['bufferView']]
    code, width = types[accessor['componentType']]
    count = sizes[accessor['type']]
    stride = view.get('byteStride', width * count)
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    values = []
    for i in range(accessor['count']):
      values.extend(struct.unpack_from('<' + code * count, binary, offset + i * stride))
    assert all(math.isfinite(value) for value in values)
    return values

  surfaces = []
  for mesh in doc['meshes']:
    part = mesh['primitives'][0]
    role = doc['materials'][part['material']]['extras']['tllMaterialRole']
    surface = {'role': role, 'position': attribute(part['attributes']['POSITION']),
      'normal': attribute(part['attributes']['NORMAL']), 'color': attribute(part['attributes']['COLOR_0']),
      'index': attribute(part['indices'])}
    assert len(surface['position']) == len(surface['normal']) == len(surface['color'])
    assert max(surface['index']) < len(surface['position']) // 3
    surfaces.append(surface)
  return sorted(surfaces, key=lambda surface: surface['role'])


runtime = {'schema': 1,
  'provenance': {'author': 'TLL original Blender-authored geometry', 'blender': bpy.app.version_string,
    'source': 'tools/art/build-jade-tactics-v1.py', 'sourceSha256': digest(__file__), 'referenceSha256': REFERENCE_SHA,
    'thirdPartyMeshesOrTextures': False, 'trellisUsed': False},
  'materialRoles': ROLE_SPECS, 'backingTriangleTotal': report['totals']['triangles'], 'models': {}}
for model in stats:
  filename = FILES[model['name']]
  surfaces = runtime_surfaces(OUT / filename)
  positions = [value for surface in surfaces for value in zip(*[iter(surface['position'])] * 3)]
  actual = {'min': [min(point[i] for point in positions) for i in range(3)],
    'max': [max(point[i] for point in positions) for i in range(3)]}
  assert all(abs(actual[key][i] - model['boundsRuntimeXYZ'][key][i]) < 1e-5 for key in ['min', 'max'] for i in range(3))
  runtime['models'][model['kind']] = {'name': model['name'], 'triangles': model['triangles'],
    'bounds': actual, 'sourceGlbSha256': digest(OUT / filename), 'surfaces': surfaces}
runtime_path = ROOT / 'src/data/jade-tactics-geometry-v1.json'
runtime_path.write_text(json.dumps(runtime, separators=(',', ':')) + '\n')
print('TLL_RUNTIME_GEOMETRY_READY ' + json.dumps({'file': str(runtime_path), 'sha256': digest(runtime_path),
  'bytes': runtime_path.stat().st_size, 'backingTriangles': runtime['backingTriangleTotal']}))
